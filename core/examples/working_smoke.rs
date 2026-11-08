use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

use anyhow::{bail, Context};
use eukhe_client::daemon_client::DaemonClient;
use eukhe_types::daemon::DaemonCommand;
use local_studio_core::{
    AccessMode, Connection, DaemonLaunch, PromptDraft, Studio, StudioConfig, ThreadRow, ThreadSettings, ThreadStatus,
    Update, Waker, WorktreeChoice,
};
use serde_json::Map;

const STEP_TIMEOUT: Duration = Duration::from_secs(90);
const FAUX_SCRIPT: &str = r#"{"modelId":"faux-1","responses":[{"content":[{"type":"text","text":"Checking first."},{"type":"toolCall","name":"bash","arguments":{"i":"wait","script":"sleep 3 && echo step-done"},"id":"call-wait"}],"delayMs":1500},{"text":"All done after the tool step.","delayMs":1500}]}"#;

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
    thread: Option<String>,
    working_seen: bool,
    busy_infos: u32,
    idle_while_working: Vec<String>,
    pending_idle: Option<String>,
    starts: Vec<i64>,
    finished: bool,
}

impl Watch {
    fn row(&self) -> Option<&ThreadRow> {
        let thread = self.thread.as_deref()?;
        self.threads.iter().find(|row| row.id == thread)
    }

    fn working(&self) -> bool {
        self.row().is_some_and(|row| matches!(row.status, ThreadStatus::Working))
    }
}

fn apply(watch: &mut Watch, update: Update) {
    match update {
        Update::Connection { state } => watch.connection = Some(state),
        Update::Projects { projects } => watch.projects = projects.into_iter().map(|project| project.id).collect(),
        Update::Threads { threads } => {
            watch.threads = threads;
            if watch.working() {
                watch.working_seen = true;
            } else if watch.working_seen && watch.row().is_some() {
                watch.finished = true;
            }
        }
        Update::ThreadStarted { thread, .. } => watch.thread = Some(thread),
        Update::Thread { thread, info } => {
            if watch.thread.as_deref() != Some(thread.as_str()) || watch.finished {
                return;
            }
            if info.busy {
                watch.busy_infos += 1;
                if let Some(problem) = watch.pending_idle.take() {
                    watch.idle_while_working.push(problem);
                }
                match info.run_started_at {
                    Some(start) if watch.starts.last() != Some(&start) => watch.starts.push(start),
                    Some(_) => {}
                    None => {
                        watch
                            .idle_while_working
                            .push("busy without a start time: the counter would vanish".to_string());
                    }
                }
            } else if watch.busy_infos > 0 {
                watch.pending_idle = Some(format!(
                    "busy=false after {} busy updates, then busy again (start {:?})",
                    watch.busy_infos, info.run_started_at
                ));
            }
        }
        Update::Notice { level, text } => println!("     notice {level:?}: {text}"),
        Update::Approvals { .. }
        | Update::ArchivedThreads { .. }
        | Update::ThreadSearch { .. }
        | Update::Transcript { .. }
        | Update::Queue { .. }
        | Update::ComposerText { .. }
        | Update::Models { .. }
        | Update::Commands { .. }
        | Update::Skills { .. }
        | Update::Subagents { .. }
        | Update::MessageImage { .. }
        | Update::Notification { .. }
        | Update::GitStatus { .. }
        | Update::Branches { .. }
        | Update::Diff { .. }
        | Update::Files { .. }
        | Update::FileContent { .. }
        | Update::SearchResults { .. }
        | Update::PullRequests { .. }
        | Update::PullRequestDetail { .. }
        | Update::Devices { .. }
        | Update::TerminalOpened { .. }
        | Update::TerminalFrame { .. }
        | Update::TerminalText { .. }
        | Update::TerminalExited { .. }
        | Update::Usage { .. }
        | Update::Local { .. }
        | Update::LocalDashboard { .. }
        | Update::Providers { .. }
        | Update::ProviderModels { .. }
        | Update::Settings { .. }
        | Update::Keybindings { .. }
        | Update::ProjectScripts { .. }
        | Update::ProjectSettings { .. }
        | Update::WorktreeSetup { .. }
        | Update::Daemon { .. }
        | Update::RequestDone { .. }
        | Update::RequestFailed { .. } => {}
    }
}

fn pump(
    studio: &Studio,
    signal: &Signal,
    watch: &mut Watch,
    step: &str,
    done: impl Fn(&Watch) -> bool,
) -> anyhow::Result<()> {
    let deadline = Instant::now() + STEP_TIMEOUT;
    loop {
        for update in studio.tick() {
            apply(watch, update);
        }
        if done(watch) {
            println!("ok   {step}");
            return Ok(());
        }
        let Some(left) = deadline.checked_duration_since(Instant::now()) else {
            bail!("timed out waiting for: {step}");
        };
        signal.wait(left.min(Duration::from_millis(100)));
    }
}

fn stop_daemon(socket: &Path) -> anyhow::Result<()> {
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    runtime.block_on(async {
        let (client, _events) = DaemonClient::connect(socket).await?;
        client
            .request_ok(DaemonCommand::Shutdown { id: None, force: Some(true), if_idle: None, rest: Map::default() })
            .await?;
        println!("ok   daemon stopped");
        anyhow::Ok(())
    })
}

fn drive(config: StudioConfig, work: &Path) -> anyhow::Result<()> {
    let signal = Arc::new(Signal::default());
    let studio = Studio::new(config, Arc::clone(&signal) as Arc<dyn Waker>)?;
    let mut watch = Watch::default();
    let outcome = (|| {
        pump(&studio, &signal, &mut watch, "daemon connected", |watch| {
            matches!(watch.connection, Some(Connection::Ready))
        })?;
        studio.add_project(work.to_string_lossy().into_owned());
        pump(&studio, &signal, &mut watch, "project added", |watch| watch.projects.len() == 1)?;
        studio.start_thread(
            "draft-working".to_string(),
            Some(watch.projects[0].clone()),
            PromptDraft { text: "check, run a tool, then answer".to_string(), images: Vec::new(), files: Vec::new() },
            ThreadSettings {
                provider: None,
                model: None,
                thinking_level: None,
                access: AccessMode::FullAccess,
                worktree: WorktreeChoice::Local,
            },
        );
        pump(&studio, &signal, &mut watch, "thread started", |watch| watch.thread.is_some())?;
        let thread = watch.thread.clone().context("thread id")?;
        studio.select_thread(Some(thread));
        pump(&studio, &signal, &mut watch, "turn with a tool step finished", |watch| watch.finished)?;
        if watch.busy_infos == 0 {
            bail!("the focused thread never reported busy while it worked");
        }
        if let Some(problem) = watch.idle_while_working.first() {
            bail!("the working row would vanish mid-turn: {problem} ({} times)", watch.idle_while_working.len());
        }
        if watch.starts.len() != 1 {
            bail!("the elapsed time restarted mid-turn: starts {:?}", watch.starts);
        }
        println!("ok   busy for the whole turn ({} updates), one start time", watch.busy_infos);
        anyhow::Ok(())
    })();
    studio.shutdown();
    outcome
}

fn main() -> anyhow::Result<()> {
    let usage = "usage: working_smoke <eukhe-daemon> <scratch dir>";
    let mut args = std::env::args_os().skip(1);
    let daemon = PathBuf::from(args.next().context(usage)?);
    let root = PathBuf::from(args.next().context(usage)?);
    let agent_dir = root.join("agent");
    let work = root.join("work");
    std::fs::create_dir_all(&work)?;
    std::fs::create_dir_all(&agent_dir)?;
    std::env::set_var("LOCAL_STUDIO_DATA_DIR", root.join("data"));
    let script = root.join("faux-script.json");
    std::fs::write(&script, FAUX_SCRIPT)?;
    std::env::set_var("EUKHE_FAUX_SCRIPT", &script);
    let socket = root.join("d.sock");
    let config = StudioConfig {
        socket_path: Some(socket.to_string_lossy().into_owned()),
        session_dir: Some(agent_dir.join("sessions").to_string_lossy().into_owned()),
        data_dir: None,
        controller_main: None,
        launch: Some(DaemonLaunch {
            program: daemon.to_string_lossy().into_owned(),
            arguments: vec![
                "supervisor".to_string(),
                "--agent-dir".to_string(),
                agent_dir.to_string_lossy().into_owned(),
            ],
        }),
    };
    let outcome = drive(config, &work);
    let stopped = stop_daemon(&socket);
    outcome?;
    stopped?;
    println!("PASS working smoke");
    Ok(())
}
