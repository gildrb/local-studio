use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

use anyhow::{bail, Context};
use eukhe_client::daemon_client::DaemonClient;
use eukhe_types::daemon::DaemonCommand;
use local_studio_core::{
    AccessMode, Block, Connection, DaemonLaunch, Item, ItemKind, PromptDraft, Studio, StudioConfig, ThreadRow,
    ThreadStatus, ToolState, TranscriptOp, Update, UsagePeriod, UsageReport, Waker, WorktreeChoice,
};
use serde_json::Map;

#[path = "support/real_model.rs"]
mod real_model;

const STEP_TIMEOUT: Duration = Duration::from_secs(120);
const MARK: &str = "step-done";
const PROMPT: &str = "Say one short sentence about what you will do, then use the bash tool to run exactly this command once: `sleep 3 && echo step-done`. After it finishes, reply with only the word done.";

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

#[derive(Default, Clone, Copy, PartialEq, Eq)]
enum Progress {
    #[default]
    Started,
    ToolDone,
    Answered,
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
    progress: Progress,
    usage: Option<UsageReport>,
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

fn observe(watch: &mut Watch, item: &Item) {
    match &item.kind {
        ItemKind::Tool { state: ToolState::Succeeded, output, .. }
            if output.contains(MARK) && watch.progress == Progress::Started =>
        {
            watch.progress = Progress::ToolDone;
        }
        ItemKind::Assistant { blocks, streaming: false, .. }
            if watch.progress == Progress::ToolDone
                && blocks.iter().any(|block| matches!(block, Block::Text { text } if !text.trim().is_empty())) =>
        {
            watch.progress = Progress::Answered;
        }
        ItemKind::User { .. }
        | ItemKind::Assistant { .. }
        | ItemKind::Tool { .. }
        | ItemKind::TurnSummary { .. }
        | ItemKind::Notice { .. }
        | ItemKind::Compaction { .. } => {}
    }
}

fn apply(watch: &mut Watch, update: Update) {
    match update {
        Update::Transcript { thread, op } if watch.thread.as_deref() == Some(thread.as_str()) => match op {
            TranscriptOp::Reset { items } => {
                for item in &items {
                    observe(watch, item);
                }
            }
            TranscriptOp::Insert { item, .. } | TranscriptOp::Update { item, .. } => observe(watch, &item),
        },
        Update::Usage { report, .. } => watch.usage = Some(report),
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
        | Update::DaemonDefault { .. }
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
        | Update::Kernel { .. }
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
            PromptDraft { text: PROMPT.to_string(), images: Vec::new(), files: Vec::new() },
            real_model::thread_settings(AccessMode::FullAccess, WorktreeChoice::Local),
        );
        pump(&studio, &signal, &mut watch, "thread started", |watch| watch.thread.is_some())?;
        let thread = watch.thread.clone().context("thread id")?;
        studio.select_thread(Some(thread));
        pump(&studio, &signal, &mut watch, "real turn with a tool step finished", |watch| watch.finished)?;
        pump(&studio, &signal, &mut watch, "the tool succeeded and the model answered after it", |watch| {
            watch.progress == Progress::Answered
        })?;
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
        studio.load_usage("usage-1".to_string(), UsagePeriod::Day);
        pump(&studio, &signal, &mut watch, "usage report loaded", |watch| watch.usage.is_some())?;
        real_model::check_usage(watch.usage.as_ref().context("usage")?)
    })();
    studio.shutdown();
    outcome
}

fn main() -> anyhow::Result<()> {
    let usage = "usage: working_smoke <eukhe> <scratch dir>";
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
    let outcome = drive(config, &work);
    let stopped = stop_daemon(&socket);
    outcome?;
    stopped?;
    println!("PASS working smoke");
    Ok(())
}
