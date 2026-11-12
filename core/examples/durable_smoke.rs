use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

use anyhow::{bail, ensure, Context};
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
const MARK: &str = "durable-ok";
const PROMPT: &str =
    "Use the bash tool to run exactly this command once: `sleep 8 && echo durable-ok`. Then reply with only the word finished.";
const CLOSED_FOR: Duration = Duration::from_secs(20);

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
struct View {
    connection: Option<Connection>,
    projects: Vec<String>,
    threads: Vec<ThreadRow>,
    started: Option<String>,
    items: Vec<Item>,
    usage: Option<UsageReport>,
}

impl View {
    fn row(&self, thread: &str) -> Option<&ThreadRow> {
        self.threads.iter().find(|row| row.id == thread)
    }
}

struct Harness {
    studio: Arc<Studio>,
    signal: Arc<Signal>,
    view: View,
}

impl Harness {
    fn new(config: StudioConfig) -> anyhow::Result<Self> {
        let signal = Arc::new(Signal::default());
        let studio = Studio::new(config, Arc::clone(&signal) as Arc<dyn Waker>)?;
        Ok(Self { studio, signal, view: View::default() })
    }

    fn pump_until(&mut self, step: &str, done: impl Fn(&View) -> bool) -> anyhow::Result<()> {
        let deadline = Instant::now() + STEP_TIMEOUT;
        loop {
            for update in self.studio.tick() {
                self.apply(update)?;
            }
            if done(&self.view) {
                println!("ok   {step}");
                return Ok(());
            }
            let Some(left) = deadline.checked_duration_since(Instant::now()) else {
                bail!("timed out waiting for: {step}");
            };
            self.signal.wait(left.min(Duration::from_millis(250)));
        }
    }

    fn apply(&mut self, update: Update) -> anyhow::Result<()> {
        match update {
            Update::Connection { state } => self.view.connection = Some(state),
            Update::Projects { projects } => {
                self.view.projects = projects.into_iter().map(|project| project.id).collect();
            }
            Update::Threads { threads } => self.view.threads = threads,
            Update::ThreadStarted { thread, .. } => self.view.started = Some(thread),
            Update::Transcript { thread, op } => {
                if self.view.started.as_deref() == Some(thread.as_str()) {
                    apply_op(&mut self.view.items, op)?;
                }
            }
            Update::Notice { level, text } => println!("     notice {level:?}: {text}"),
            Update::RequestFailed { request, message } => println!("     request {request} failed: {message}"),
            Update::Usage { report, .. } => self.view.usage = Some(report),
            Update::ArchivedThreads { .. }
            | Update::ThreadSearch { .. }
            | Update::Thread { .. }
            | Update::Approvals { .. }
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
            | Update::RequestDone { .. } => {}
        }
        Ok(())
    }
}

fn apply_op(items: &mut Vec<Item>, op: TranscriptOp) -> anyhow::Result<()> {
    match op {
        TranscriptOp::Reset { items: fresh } => *items = fresh,
        TranscriptOp::Insert { index, item } => {
            let index = usize::try_from(index)?;
            if index > items.len() {
                bail!("insert at {index} past {} items", items.len());
            }
            items.insert(index, item);
        }
        TranscriptOp::Update { index, item } => {
            let index = usize::try_from(index)?;
            let Some(slot) = items.get_mut(index) else {
                bail!("update at {index} past {} items", items.len());
            };
            *slot = item;
        }
    }
    Ok(())
}

fn tool_ran(items: &[Item]) -> Option<usize> {
    items.iter().position(
        |item| matches!(&item.kind, ItemKind::Tool { state: ToolState::Succeeded, output, .. } if output.contains(MARK)),
    )
}

fn answered(items: &[Item]) -> bool {
    let Some(tool) = tool_ran(items) else { return false };
    items[tool + 1..].iter().any(|item| match &item.kind {
        ItemKind::Assistant { blocks, streaming, .. } => {
            !streaming && blocks.iter().any(|block| matches!(block, Block::Text { text } if !text.trim().is_empty()))
        }
        ItemKind::User { .. }
        | ItemKind::Tool { .. }
        | ItemKind::TurnSummary { .. }
        | ItemKind::Notice { .. }
        | ItemKind::Compaction { .. } => false,
    })
}

fn quit_mid_turn(harness: &mut Harness, work: &Path) -> anyhow::Result<String> {
    let studio = Arc::clone(&harness.studio);
    harness.pump_until("daemon launched and connected", |view| matches!(view.connection, Some(Connection::Ready)))?;
    studio.add_project(work.to_string_lossy().into_owned());
    harness.pump_until("project added", |view| view.projects.len() == 1)?;
    let project = harness.view.projects[0].clone();
    studio.start_thread(
        "draft-durable".to_string(),
        Some(project),
        PromptDraft { text: PROMPT.to_string(), images: Vec::new(), files: Vec::new() },
        real_model::thread_settings(AccessMode::FullAccess, WorktreeChoice::Local),
    );
    harness.pump_until("thread started and working", |view| {
        view.started
            .as_deref()
            .and_then(|thread| view.row(thread))
            .is_some_and(|row| row.status == ThreadStatus::Working)
    })?;
    let thread = harness.view.started.clone().context("thread id")?;
    if tool_ran(&harness.view.items).is_some() {
        bail!("the tool finished before the app quit; the turn was not in flight");
    }
    Ok(thread)
}

fn daemon_alive(socket: &Path) -> anyhow::Result<()> {
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    runtime.block_on(async {
        let (_client, _events) =
            DaemonClient::connect(socket).await.context("the Eukhe daemon stopped when the app quit")?;
        anyhow::Ok(())
    })
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

fn drive(config: &StudioConfig, socket: &Path, work: &Path) -> anyhow::Result<()> {
    let mut first = Harness::new(config.clone())?;
    let started = quit_mid_turn(&mut first, work);
    first.studio.shutdown();
    let thread = started?;
    println!("ok   app quit while the turn was still running");
    daemon_alive(socket)?;
    println!("ok   the Eukhe daemon kept running after the app quit");
    std::thread::sleep(CLOSED_FOR);
    let mut reopened = Harness::new(config.clone())?;
    let outcome = reopened
        .pump_until("reopened app connected", |view| matches!(view.connection, Some(Connection::Ready)))
        .and_then(|()| {
            reopened.view.started = Some(thread.clone());
            reopened.studio.select_thread(Some(thread.clone()));
            reopened.pump_until("the turn kept running while the app was closed and its answer is shown", |view| {
                answered(&view.items)
                    && view
                        .row(&thread)
                        .is_some_and(|row| !matches!(row.status, ThreadStatus::Working | ThreadStatus::Approval))
            })
        })
        .and_then(|()| {
            ensure!(
                reopened.view.items.iter().filter(|item| matches!(item.kind, ItemKind::User { .. })).count() == 1,
                "the reopened thread replayed its prompt"
            );
            reopened.studio.load_usage("usage-1".to_string(), UsagePeriod::Day);
            reopened.pump_until("usage report loaded", |view| view.usage.is_some())?;
            real_model::check_usage(reopened.view.usage.as_ref().context("usage")?)
        });
    reopened.studio.shutdown();
    outcome
}

fn main() -> anyhow::Result<()> {
    let usage = "usage: durable_smoke <eukhe> <scratch dir>";
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
    let outcome = drive(&config, &socket, &work);
    let stopped = stop_daemon(&socket);
    outcome?;
    stopped?;
    println!("PASS durable smoke");
    Ok(())
}
