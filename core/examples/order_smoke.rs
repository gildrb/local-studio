use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

use anyhow::{bail, Context};
use eukhe_client::daemon_client::DaemonClient;
use eukhe_types::daemon::DaemonCommand;
use local_studio_core::{
    AccessMode, Connection, Delivery, PromptDraft, Studio, StudioConfig, ThreadRow, ThreadStatus, TranscriptOp, Update,
    UsagePeriod, UsageReport, Waker, WorktreeChoice,
};
use serde_json::Map;

#[path = "support/real_model.rs"]
mod real_model;

const STEP_TIMEOUT: Duration = Duration::from_secs(120);
const HOLD: Duration = Duration::from_secs(3);
const SLOW: &str = "Use the bash tool to run exactly this command once: `sleep 6 && echo slow-done`. After it finishes, reply with only the word done.";
const QUICK: &str = "Reply with only the word ok.";
const AGAIN: &str = "Reply with only the word again.";
const RENAMED: &str = "order-renamed";

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
    started: HashMap<String, String>,
    names: Vec<(String, &'static str)>,
    opened: Vec<String>,
    orders: Vec<Vec<&'static str>>,
    usage: Option<UsageReport>,
}

impl Watch {
    fn row(&self, name: &str) -> Option<&ThreadRow> {
        let id = &self.names.iter().find(|(_, known)| *known == name)?.0;
        self.threads.iter().find(|row| &row.id == id)
    }

    fn order(&self) -> Vec<&'static str> {
        self.threads
            .iter()
            .filter_map(|row| self.names.iter().find(|(id, _)| *id == row.id).map(|(_, name)| *name))
            .collect()
    }

    fn status(&self, name: &str) -> Option<ThreadStatus> {
        self.row(name).map(|row| row.status)
    }
}

fn apply(watch: &mut Watch, update: Update) {
    match update {
        Update::Usage { report, .. } => watch.usage = Some(report),
        Update::Connection { state } => watch.connection = Some(state),
        Update::Projects { projects } => watch.projects = projects.into_iter().map(|project| project.id).collect(),
        Update::Threads { threads } => {
            watch.threads = threads;
            let order = watch.order();
            if order.len() == watch.names.len() && watch.orders.last() != Some(&order) {
                watch.orders.push(order);
            }
        }
        Update::ThreadStarted { draft, thread } => {
            watch.started.insert(draft, thread);
        }
        Update::Transcript { thread, op: TranscriptOp::Reset { .. } } => watch.opened.push(thread),
        Update::Notice { level, text } => println!("     notice {level:?}: {text}"),
        Update::Transcript { .. }
        | Update::Thread { .. }
        | Update::Approvals { .. }
        | Update::ArchivedThreads { .. }
        | Update::ThreadSearch { .. }
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

struct Session {
    studio: Arc<Studio>,
    signal: Arc<Signal>,
    watch: Watch,
}

impl Session {
    fn open(config: StudioConfig, names: Vec<(String, &'static str)>) -> anyhow::Result<Self> {
        let signal = Arc::new(Signal::default());
        let studio = Studio::new(config, Arc::clone(&signal) as Arc<dyn Waker>)?;
        let mut session = Self { studio, signal, watch: Watch { names, ..Watch::default() } };
        session.pump("daemon connected", |watch| matches!(watch.connection, Some(Connection::Ready)))?;
        Ok(session)
    }

    fn pump(&mut self, step: &str, done: impl Fn(&Watch) -> bool) -> anyhow::Result<()> {
        let deadline = Instant::now() + STEP_TIMEOUT;
        loop {
            for update in self.studio.tick() {
                apply(&mut self.watch, update);
            }
            if done(&self.watch) {
                println!("ok   {step}");
                return Ok(());
            }
            let Some(left) = deadline.checked_duration_since(Instant::now()) else {
                bail!("timed out waiting for: {step}");
            };
            self.signal.wait(left.min(Duration::from_millis(100)));
        }
    }

    fn hold(&mut self, step: &str, expected: &[&str]) -> anyhow::Result<()> {
        let from = self.watch.orders.len().saturating_sub(1);
        let until = Instant::now() + HOLD;
        while let Some(left) = until.checked_duration_since(Instant::now()) {
            for update in self.studio.tick() {
                apply(&mut self.watch, update);
            }
            self.signal.wait(left.min(Duration::from_millis(100)));
        }
        let seen = &self.watch.orders[from..];
        if seen.iter().any(|order| order != expected) {
            bail!("{step}: the sidebar order changed with no new user message: expected {expected:?}, saw {seen:?}");
        }
        println!("ok   {step}: order stays {expected:?}");
        Ok(())
    }

    fn close(self) {
        self.studio.shutdown();
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

fn prompt(text: &str) -> PromptDraft {
    PromptDraft { text: text.to_string(), images: Vec::new(), files: Vec::new() }
}

fn settled(watch: &Watch, name: &str) -> bool {
    watch.status(name).is_some_and(|status| matches!(status, ThreadStatus::Done | ThreadStatus::Idle))
}

fn first_run(config: StudioConfig, work: &Path) -> anyhow::Result<Vec<(String, &'static str)>> {
    let mut session = Session::open(config, Vec::new())?;
    let outcome = (|| {
        session.studio.add_project(work.to_string_lossy().into_owned());
        session.pump("project added", |watch| watch.projects.len() == 1)?;
        let project = session.watch.projects[0].clone();
        let settings = || real_model::thread_settings(AccessMode::FullAccess, WorktreeChoice::Local);
        session.studio.start_thread("draft-slow".to_string(), Some(project.clone()), prompt(SLOW), settings());
        session.pump("slow thread started", |watch| watch.started.contains_key("draft-slow"))?;
        let slow = session.watch.started["draft-slow"].clone();
        session.watch.names.push((slow, "slow"));
        session.pump("slow thread working", |watch| watch.status("slow") == Some(ThreadStatus::Working))?;
        std::thread::sleep(Duration::from_secs(1));
        session.studio.start_thread("draft-quick".to_string(), Some(project), prompt(QUICK), settings());
        session.pump("quick thread started", |watch| watch.started.contains_key("draft-quick"))?;
        let quick = session.watch.started["draft-quick"].clone();
        session.watch.names.push((quick, "quick"));
        session.pump("quick thread answered before the slow one", |watch| {
            settled(watch, "quick") && watch.status("slow") == Some(ThreadStatus::Working)
        })?;
        session.pump("slow thread answered after its tool step", |watch| settled(watch, "slow"))?;
        session.hold("both answered", &["quick", "slow"])?;
        Ok(session.watch.names.clone())
    })();
    session.close();
    outcome
}

fn second_run(config: StudioConfig, names: Vec<(String, &'static str)>) -> anyhow::Result<()> {
    let mut session = Session::open(config, names)?;
    let outcome = (|| {
        session.pump("both threads listed after a restart", |watch| watch.order().len() == 2)?;
        session.hold("restart with both threads unloaded", &["quick", "slow"])?;
        let slow = session.watch.names[0].0.clone();
        let quick = session.watch.names[1].0.clone();
        session.studio.rename_thread(slow.clone(), RENAMED.to_string());
        session.pump("slow thread renamed", |watch| watch.row("slow").is_some_and(|row| row.title == RENAMED))?;
        session.hold("title write", &["quick", "slow"])?;
        session.studio.select_thread(Some(slow.clone()));
        let opened = slow.clone();
        session.pump("slow thread opened", move |watch| watch.opened.contains(&opened))?;
        session.hold("slow thread opened (attach)", &["quick", "slow"])?;
        session.studio.select_thread(Some(quick.clone()));
        let opened = quick.clone();
        session.pump("quick thread opened", move |watch| watch.opened.contains(&opened))?;
        session.hold("quick thread opened, slow detached", &["quick", "slow"])?;
        session.studio.select_thread(None);
        session.hold("selection cleared", &["quick", "slow"])?;
        session.studio.send("send-again".to_string(), slow, prompt(AGAIN), Delivery::Queue);
        session
            .pump("new user message in the slow thread", |watch| watch.status("slow") == Some(ThreadStatus::Working))?;
        session.pump("slow thread answered again and moved to the top", |watch| {
            settled(watch, "slow") && watch.order() == ["slow", "quick"]
        })?;
        session.hold("after the new user message", &["slow", "quick"])?;
        Ok(())
    })();
    session.close();
    outcome
}

fn third_run(config: StudioConfig, names: Vec<(String, &'static str)>) -> anyhow::Result<()> {
    let mut session = Session::open(config, names)?;
    let outcome = (|| {
        session.pump("both threads listed after a second restart", |watch| watch.order().len() == 2)?;
        session.hold("restart keeps the last user message order", &["slow", "quick"])?;
        session.studio.load_usage("usage-1".to_string(), UsagePeriod::Day);
        session.pump("usage report loaded", |watch| watch.usage.is_some())?;
        real_model::check_usage(session.watch.usage.as_ref().context("usage")?)
    })();
    session.close();
    outcome
}

fn main() -> anyhow::Result<()> {
    let usage = "usage: order_smoke <eukhe> <scratch dir>";
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
    let config = || StudioConfig {
        socket_path: Some(socket.to_string_lossy().into_owned()),
        session_dir: Some(agent_dir.join("sessions").to_string_lossy().into_owned()),
        data_dir: None,
        controller_main: None,
        launch: Some(local_studio_core::DaemonLaunch { program: daemon.to_string_lossy().into_owned() }),
    };
    let outcome = first_run(config(), &work)
        .and_then(|names| second_run(config(), names.clone()).map(|()| names))
        .and_then(|names| third_run(config(), names));
    let stopped = stop_daemon(&socket);
    outcome?;
    stopped?;
    println!("PASS order smoke");
    Ok(())
}
