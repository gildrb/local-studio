use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

use anyhow::{bail, Context};
use eukhe_client::daemon_client::DaemonClient;
use eukhe_types::daemon::DaemonCommand;
use local_studio_core::{
    AccessMode, Connection, DaemonLaunch, ItemKind, PromptDraft, Studio, StudioConfig, ThreadRow, ThreadStatus,
    ToolState, TranscriptOp, Update, UsagePeriod, UsageReport, Waker, WorktreeChoice,
};
use serde_json::{Map, Value};

#[path = "support/real_model.rs"]
mod real_model;

const STEP_TIMEOUT: Duration = Duration::from_secs(120);
const STOP_BOUND: Duration = Duration::from_secs(20);
const CRASH_BOUND: Duration = Duration::from_secs(45);
const DELETE_BOUND: Duration = Duration::from_secs(20);
const PROMPT: &str =
    "Use the bash tool to run exactly this command once: `sleep 90 && echo slept`. Then reply with only the word done.";

#[derive(Default)]
struct Signal {
    pending: Mutex<bool>,
    ready: Condvar,
}

impl Waker for Signal {
    fn wake(&self) {
        *self.pending.lock().unwrap_or_else(PoisonError::into_inner) = true;
        self.ready.notify_one();
    }
}

impl Signal {
    fn wait(&self, timeout: Duration) {
        let pending = self.pending.lock().unwrap_or_else(PoisonError::into_inner);
        let (mut pending, _) = self
            .ready
            .wait_timeout_while(pending, timeout, |pending| !*pending)
            .unwrap_or_else(PoisonError::into_inner);
        *pending = false;
    }
}

#[derive(Default)]
struct Watch {
    connection: Option<Connection>,
    projects: Vec<String>,
    threads: Vec<ThreadRow>,
    started: Vec<String>,
    focused: Option<String>,
    tool_running: bool,
    busy: Option<bool>,
    usage: Option<UsageReport>,
}

impl Watch {
    fn row(&self, thread: &str) -> Option<&ThreadRow> {
        self.threads.iter().find(|row| row.id == thread)
    }

    fn working(&self, thread: &str) -> bool {
        self.row(thread).is_some_and(|row| matches!(row.status, ThreadStatus::Working))
    }
}

fn observe(watch: &mut Watch, kind: &ItemKind) {
    if let ItemKind::Tool { state, .. } = kind {
        watch.tool_running = matches!(state, ToolState::Running | ToolState::Pending);
    }
}

fn apply(watch: &mut Watch, update: Update) {
    match update {
        Update::Transcript { thread, op } if watch.focused.as_deref() == Some(thread.as_str()) => match op {
            TranscriptOp::Reset { items } => {
                watch.tool_running = false;
                for item in &items {
                    observe(watch, &item.kind);
                }
            }
            TranscriptOp::Insert { item, .. } | TranscriptOp::Update { item, .. } => observe(watch, &item.kind),
        },
        Update::Thread { thread, info } if watch.focused.as_deref() == Some(thread.as_str()) => {
            watch.busy = Some(info.busy);
        }
        Update::Usage { report, .. } => watch.usage = Some(report),
        Update::Connection { state } => watch.connection = Some(state),
        Update::Projects { projects } => watch.projects = projects.into_iter().map(|project| project.id).collect(),
        Update::Threads { threads } => watch.threads = threads,
        Update::ThreadStarted { thread, .. } => watch.started.push(thread),
        Update::Notice { level, text } => println!("     notice {level:?}: {text}"),
        _ => {}
    }
}

fn pump(
    studio: &Studio,
    signal: &Signal,
    watch: &mut Watch,
    step: &str,
    bound: Duration,
    done: impl Fn(&Watch) -> bool,
) -> anyhow::Result<Duration> {
    let started = Instant::now();
    let deadline = started + bound;
    loop {
        for update in studio.tick() {
            apply(watch, update);
        }
        if done(watch) {
            let took = started.elapsed();
            println!("ok   {step} ({:.1} s)", took.as_secs_f64());
            return Ok(took);
        }
        let Some(left) = deadline.checked_duration_since(Instant::now()) else {
            bail!("timed out after {} s waiting for: {step}", bound.as_secs());
        };
        signal.wait(left.min(Duration::from_millis(100)));
    }
}

fn daemon_call(socket: &Path, command: DaemonCommand) -> anyhow::Result<(Value, Value)> {
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    runtime.block_on(async {
        let (client, _events) = DaemonClient::connect(socket).await?;
        let hello = client.hello().clone();
        let data = client.request_ok(command).await;
        client.close();
        anyhow::Ok((hello, data?))
    })
}

fn roster_summary(socket: &Path, thread: &str) -> anyhow::Result<(Value, Option<Value>)> {
    let (hello, data) = daemon_call(socket, DaemonCommand::RosterSubscribe { id: None, rest: Map::default() })?;
    let summary = data
        .get("roster")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.get("summary"))
        .find(|summary| summary.get("sessionId").and_then(Value::as_str) == Some(thread))
        .cloned();
    Ok((hello, summary))
}

fn pid_of(value: Option<&Value>) -> Option<u32> {
    value.and_then(Value::as_u64).and_then(|pid| u32::try_from(pid).ok())
}

fn daemon_view(socket: &Path, thread: &str) -> anyhow::Result<(Option<u32>, bool)> {
    let (_, summary) = roster_summary(socket, thread)?;
    let worker = pid_of(summary.as_ref().and_then(|summary| summary.get("workerPid")));
    let active = summary.as_ref().and_then(|summary| summary.get("activeSessionId")).and_then(Value::as_str);
    let Some(active) = active else { return Ok((worker, false)) };
    let command = DaemonCommand::GetState { id: None, active_session_id: active.to_string(), rest: Map::default() };
    let streaming = daemon_call(socket, command)
        .is_ok_and(|(_, state)| state.get("isStreaming").and_then(Value::as_bool) == Some(true));
    Ok((worker, streaming))
}

fn parent_of(pid: u32) -> anyhow::Result<u32> {
    let output = std::process::Command::new("ps").args(["-o", "ppid=", "-p", &pid.to_string()]).output()?;
    String::from_utf8_lossy(&output.stdout).trim().parse().context("read the worker's parent pid")
}

fn kill_worker(socket: &Path, thread: &str) -> anyhow::Result<u32> {
    let (hello, summary) = roster_summary(socket, thread)?;
    let supervisor = pid_of(hello.get("supervisorPid")).context("the daemon hello names no supervisor pid")?;
    let pid = pid_of(summary.as_ref().and_then(|summary| summary.get("workerPid")))
        .context("the roster names no worker pid for the thread")?;
    let parent = parent_of(pid)?;
    if parent != supervisor {
        bail!("worker {pid} is not a child of this smoke's daemon {supervisor} (parent {parent}); not killing it");
    }
    let status = std::process::Command::new("kill").args(["-KILL", &pid.to_string()]).status()?;
    if !status.success() {
        bail!("kill -KILL {pid} failed: {status}");
    }
    println!("ok   killed session worker {pid} (child of this smoke's daemon {supervisor})");
    Ok(pid)
}

fn agree(
    studio: &Studio,
    signal: &Signal,
    watch: &mut Watch,
    socket: &Path,
    thread: &str,
    killed: u32,
) -> anyhow::Result<()> {
    let started = Instant::now();
    let deadline = started + CRASH_BOUND;
    let mut streak = 0;
    let mut polled: Option<Instant> = None;
    let mut last = (None, false, false);
    loop {
        for update in studio.tick() {
            apply(watch, update);
        }
        if polled.is_none_or(|at| at.elapsed() >= Duration::from_secs(1)) {
            polled = Some(Instant::now());
            let (worker, streaming) = daemon_view(socket, thread)?;
            let gui = watch.working(thread);
            last = (worker, streaming, gui);
            streak = if worker != Some(killed) && gui == streaming { streak + 1 } else { 0 };
            if streak >= 3 {
                println!(
                    "ok   worker killed: the row agrees with the daemon (worker {worker:?}, running {streaming}) ({:.1} s)",
                    started.elapsed().as_secs_f64()
                );
                return Ok(());
            }
        }
        if Instant::now() >= deadline {
            let (worker, streaming, gui) = last;
            bail!(
                "timed out after {} s: the row shows Working={gui} while the daemon runs the thread={streaming} (worker {worker:?})",
                CRASH_BOUND.as_secs()
            );
        }
        signal.wait(Duration::from_millis(100));
    }
}

fn stop_daemon(socket: &Path) -> anyhow::Result<()> {
    daemon_call(socket, DaemonCommand::Shutdown { id: None, force: Some(true), if_idle: None, rest: Map::default() })?;
    println!("ok   daemon stopped");
    Ok(())
}

fn start_long_turn(studio: &Studio, signal: &Signal, watch: &mut Watch, draft: &str) -> anyhow::Result<String> {
    let before = watch.started.len();
    studio.start_thread(
        draft.to_string(),
        Some(watch.projects[0].clone()),
        PromptDraft { text: PROMPT.to_string(), images: Vec::new(), files: Vec::new() },
        real_model::thread_settings(AccessMode::FullAccess, WorktreeChoice::Local),
    );
    pump(studio, signal, watch, &format!("{draft}: thread started"), STEP_TIMEOUT, |watch| {
        watch.started.len() > before
    })?;
    let thread = watch.started.last().cloned().context("thread id")?;
    watch.focused = Some(thread.clone());
    watch.tool_running = false;
    watch.busy = None;
    studio.select_thread(Some(thread.clone()));
    pump(
        studio,
        signal,
        watch,
        &format!("{draft}: the long bash step runs and the row shows Working"),
        STEP_TIMEOUT,
        |watch| watch.tool_running && watch.working(&thread),
    )?;
    Ok(thread)
}

fn delete(studio: &Studio, signal: &Signal, watch: &mut Watch, thread: &str, step: &str) -> anyhow::Result<()> {
    studio.delete_thread(thread.to_string());
    pump(studio, signal, watch, step, DELETE_BOUND, |watch| watch.row(thread).is_none())?;
    Ok(())
}

fn drive(config: StudioConfig, work: &Path, socket: &Path) -> anyhow::Result<()> {
    let signal = Arc::new(Signal::default());
    let studio = Studio::new(config, Arc::clone(&signal) as Arc<dyn Waker>)?;
    let mut watch = Watch::default();
    let outcome = (|| {
        pump(&studio, &signal, &mut watch, "daemon connected", STEP_TIMEOUT, |watch| {
            matches!(watch.connection, Some(Connection::Ready))
        })?;
        studio.add_project(work.to_string_lossy().into_owned());
        pump(&studio, &signal, &mut watch, "project added", STEP_TIMEOUT, |watch| watch.projects.len() == 1)?;

        studio.start_thread(
            "draft-usage".to_string(),
            Some(watch.projects[0].clone()),
            PromptDraft { text: "Reply with only the word ok.".to_string(), images: Vec::new(), files: Vec::new() },
            real_model::thread_settings(AccessMode::FullAccess, WorktreeChoice::Local),
        );
        pump(&studio, &signal, &mut watch, "kept thread: started", STEP_TIMEOUT, |watch| !watch.started.is_empty())?;
        let kept = watch.started[0].clone();
        pump(
            &studio,
            &signal,
            &mut watch,
            "kept thread: a short real turn ends and leaves Working",
            STEP_TIMEOUT,
            |watch| watch.row(&kept).is_some_and(|row| !matches!(row.status, ThreadStatus::Working)),
        )?;

        let stopped = start_long_turn(&studio, &signal, &mut watch, "draft-stop")?;
        studio.abort(stopped.clone());
        pump(&studio, &signal, &mut watch, "Stop: the row leaves Working within the bound", STOP_BOUND, |watch| {
            !watch.working(&stopped) && watch.row(&stopped).is_some()
        })?;
        pump(&studio, &signal, &mut watch, "Stop: the thread reports not busy", STOP_BOUND, |watch| {
            watch.busy == Some(false)
        })?;
        if daemon_view(socket, &stopped)?.1 {
            bail!("the daemon still runs the thread after Stop");
        }
        println!("ok   the daemon agrees the thread stopped");
        delete(&studio, &signal, &mut watch, &stopped, "Delete after Stop removes the thread")?;

        let crashed = start_long_turn(&studio, &signal, &mut watch, "draft-crash")?;
        let killed = kill_worker(socket, &crashed)?;
        agree(&studio, &signal, &mut watch, socket, &crashed, killed)?;
        studio.abort(crashed.clone());
        pump(
            &studio,
            &signal,
            &mut watch,
            "Stop after the worker restart: the row leaves Working within the bound",
            STOP_BOUND,
            |watch| !watch.working(&crashed) && watch.row(&crashed).is_some(),
        )?;
        pump(
            &studio,
            &signal,
            &mut watch,
            "Stop after the worker restart: the thread reports not busy",
            STOP_BOUND,
            |watch| watch.busy == Some(false),
        )?;
        let (_, streaming) = daemon_view(socket, &crashed)?;
        if streaming {
            bail!("the daemon still runs the thread after Stop");
        }
        println!("ok   the daemon agrees the thread stopped");
        delete(&studio, &signal, &mut watch, &crashed, "Delete after the worker died removes the thread")?;

        let running = start_long_turn(&studio, &signal, &mut watch, "draft-running")?;
        delete(&studio, &signal, &mut watch, &running, "Stop and Delete removes a running thread")?;

        studio.load_usage("usage-1".to_string(), UsagePeriod::Day);
        pump(&studio, &signal, &mut watch, "usage report loaded", STEP_TIMEOUT, |watch| watch.usage.is_some())?;
        real_model::check_usage(watch.usage.as_ref().context("usage")?)
    })();
    studio.shutdown();
    outcome
}

fn main() -> anyhow::Result<()> {
    let usage = "usage: stuck_smoke <eukhe> <scratch dir>";
    let mut args = std::env::args_os().skip(1);
    let daemon = PathBuf::from(args.next().context(usage)?);
    let root = PathBuf::from(args.next().context(usage)?);
    let agent_dir = root.join("agent");
    let work = root.join("work");
    std::fs::create_dir_all(&work)?;
    let _credentials = real_model::install(&agent_dir)?;
    std::env::set_var("LOCAL_STUDIO_DATA_DIR", root.join("data"));
    std::env::set_var("EUKHE_CODING_AGENT_DIR", &agent_dir);
    let socket = root.join("d.sock");
    let config = StudioConfig {
        socket_path: Some(socket.to_string_lossy().into_owned()),
        session_dir: Some(agent_dir.join("sessions").to_string_lossy().into_owned()),
        data_dir: None,
        controller_main: None,
        launch: Some(DaemonLaunch { program: daemon.to_string_lossy().into_owned() }),
    };
    let outcome = drive(config, &work, &socket);
    let stopped = stop_daemon(&socket);
    outcome?;
    stopped?;
    println!("PASS stuck smoke");
    Ok(())
}
