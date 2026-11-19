use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

use anyhow::{bail, ensure, Context};
use eukhe_client::daemon_client::DaemonClient;
use eukhe_types::daemon::DaemonCommand;
use local_studio_core::{
    AccessMode, Approval, ApprovalAnswer, Block, Connection, DaemonLaunch, Delivery, Harness, Item, ItemKind,
    ModelOption, NoticeLevel, PromptDraft, Studio, StudioConfig, ThreadRow, ThreadSettings, ThreadStatus, TranscriptOp,
    Update, UsagePeriod, UsageReport, Waker, WorktreeChoice,
};
use serde_json::Map;

const STEP_TIMEOUT: Duration = Duration::from_secs(240);
const WORD: &str = "zeppelin";
const LONG: &str = "Write a 3000 word short story about a lighthouse keeper on a northern island, in plain prose.";

pub struct Target {
    pub name: &'static str,
    pub harness: Harness,
    pub provider: &'static str,
    pub model: fn(&[ModelOption]) -> Option<String>,
}

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
    models: Vec<ModelOption>,
    thread: Option<String>,
    busy: bool,
    finished: u32,
    approvals: Vec<Approval>,
    answers: BTreeMap<u64, String>,
    users: BTreeMap<u64, String>,
    latest: Option<String>,
    streamed: bool,
    failure: Option<String>,
    resets: u32,
    errors: Vec<String>,
    usage: Option<UsageReport>,
    resources: u32,
}

impl Watch {
    fn row(&self) -> Option<&ThreadRow> {
        let thread = self.thread.as_deref()?;
        self.threads.iter().find(|row| row.id == thread)
    }

    fn begin(&mut self) -> u32 {
        self.latest = None;
        self.streamed = false;
        self.failure = None;
        self.finished
    }

    fn reply(&self, step: &str) -> anyhow::Result<String> {
        if let Some(failure) = &self.failure {
            bail!("{step}: the reply ended with an error: {failure}");
        }
        let reply = self.latest.clone().unwrap_or_default();
        println!("     {step} reply: {}", reply.trim());
        Ok(reply)
    }
}

fn observe(watch: &mut Watch, item: &Item, live: bool) {
    match &item.kind {
        ItemKind::Assistant { blocks, streaming, error, .. } => {
            let text: String = blocks
                .iter()
                .filter_map(|block| match block {
                    Block::Text { text } => Some(text.as_str()),
                    Block::Thinking { .. } => None,
                })
                .collect();
            let said = !text.trim().is_empty();
            if *streaming {
                watch.streamed |= live && said;
                return;
            }
            if let (true, Some(error)) = (live, error) {
                println!("     assistant error: {error}");
                watch.failure = Some(error.clone());
            }
            if said {
                watch.answers.insert(item.id, text.clone());
                if live {
                    watch.latest = Some(text);
                }
            }
        }
        ItemKind::User { text, .. } => {
            watch.users.insert(item.id, text.clone());
        }
        ItemKind::Tool { .. }
        | ItemKind::TurnSummary { .. }
        | ItemKind::Notice { .. }
        | ItemKind::Compaction { .. } => {}
    }
}

fn apply(watch: &mut Watch, update: Update) {
    match update {
        Update::Transcript { thread, op } if watch.thread.as_deref() == Some(thread.as_str()) => match op {
            TranscriptOp::Reset { items } => {
                watch.resets += 1;
                watch.answers.clear();
                watch.users.clear();
                for item in &items {
                    observe(watch, item, false);
                }
            }
            TranscriptOp::Insert { item, .. } | TranscriptOp::Update { item, .. } => observe(watch, &item, true),
        },
        Update::Thread { thread, info } if watch.thread.as_deref() == Some(thread.as_str()) => {
            if watch.busy && !info.busy {
                watch.finished += 1;
            }
            watch.busy = info.busy;
        }
        Update::Approvals { thread, approvals } if watch.thread.as_deref() == Some(thread.as_str()) => {
            watch.approvals = approvals;
        }
        Update::Usage { report, .. } => watch.usage = Some(report),
        Update::Commands { .. } | Update::Skills { .. } => watch.resources += 1,
        Update::Connection { state } => watch.connection = Some(state),
        Update::Projects { projects } => watch.projects = projects.into_iter().map(|project| project.id).collect(),
        Update::Threads { threads } => watch.threads = threads,
        Update::Models { models, .. } => watch.models = models,
        Update::ThreadStarted { thread, .. } => watch.thread = Some(thread),
        Update::Notice { level, text } => {
            println!("     notice {level:?}: {text}");
            if level == NoticeLevel::Error {
                watch.errors.push(text);
            }
        }
        Update::RequestFailed { message, .. } => {
            println!("     request failed: {message}");
            watch.errors.push(message);
        }
        Update::Transcript { .. }
        | Update::Thread { .. }
        | Update::Approvals { .. }
        | Update::ArchivedThreads { .. }
        | Update::ThreadSearch { .. }
        | Update::Queue { .. }
        | Update::ComposerText { .. }
        | Update::DaemonDefault { .. }
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
}

fn pump(
    studio: &Studio,
    signal: &Signal,
    watch: &mut Watch,
    step: &str,
    done: impl Fn(&Watch) -> bool,
) -> anyhow::Result<()> {
    let deadline = Instant::now() + STEP_TIMEOUT;
    let errors = watch.errors.len();
    loop {
        for update in studio.tick() {
            apply(watch, update);
        }
        if done(watch) {
            println!("ok   {step}");
            return Ok(());
        }
        if let Some(error) = watch.errors.get(errors) {
            bail!("{step}: {error}");
        }
        let Some(left) = deadline.checked_duration_since(Instant::now()) else {
            bail!("timed out waiting for: {step}");
        };
        signal.wait(left.min(Duration::from_millis(100)));
    }
}

fn prompt(text: &str) -> PromptDraft {
    PromptDraft { text: text.to_string(), images: Vec::new(), files: Vec::new() }
}

fn turn(
    studio: &Studio,
    signal: &Signal,
    watch: &mut Watch,
    thread: &str,
    text: &str,
    step: &str,
) -> anyhow::Result<String> {
    let finished = watch.begin();
    studio.send(format!("send-{finished}"), thread.to_string(), prompt(text), Delivery::Queue);
    pump(studio, signal, watch, &format!("{step} finished"), |watch| watch.finished > finished)?;
    watch.reply(step)
}

fn approval_turn(
    studio: &Studio,
    signal: &Signal,
    watch: &mut Watch,
    thread: &str,
    file: &str,
    answer: ApprovalAnswer,
) -> anyhow::Result<u32> {
    let finished = watch.finished;
    let text = format!(
        "Create a file named {file} in the current directory containing the single line hello. Use a file writing tool, not a shell command, and do not ask me first."
    );
    studio.send(format!("send-{file}"), thread.to_string(), prompt(&text), Delivery::Queue);
    let mut answered = 0;
    loop {
        pump(studio, signal, watch, &format!("{file}: approval asked or turn ended"), |watch| {
            !watch.approvals.is_empty() || watch.finished > finished
        })?;
        let Some(approval) = watch.approvals.first().cloned() else { break };
        println!("     approval: {} {:?}", approval.command, approval.effects);
        studio.answer_approval(thread.to_string(), approval.request_id.clone(), answer);
        answered += 1;
        let request = approval.request_id;
        pump(studio, signal, watch, &format!("{file}: approval {answered} settled"), |watch| {
            watch.approvals.iter().all(|known| known.request_id != request)
        })?;
    }
    Ok(answered)
}

fn git(work: &Path, args: &[&str]) -> anyhow::Result<()> {
    let status = Command::new("git").current_dir(work).args(args).status()?;
    ensure!(status.success(), "git {args:?} failed");
    Ok(())
}

fn scratch_repo(work: &Path) -> anyhow::Result<()> {
    if work.join(".git").is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(work)?;
    git(work, &["init", "-q", "-b", "main"])?;
    std::fs::write(work.join("README.md"), "Scratch repo for the harness smoke.\n")?;
    git(work, &["add", "README.md"])?;
    git(work, &["-c", "user.name=smoke", "-c", "user.email=smoke@localhost", "commit", "-q", "-m", "init"])
}

fn open(config: &StudioConfig) -> anyhow::Result<(Arc<Studio>, Arc<Signal>, Watch)> {
    let signal = Arc::new(Signal::default());
    let studio = Studio::new(config.clone(), Arc::clone(&signal) as Arc<dyn Waker>)?;
    let mut watch = Watch::default();
    pump(&studio, &signal, &mut watch, "daemon connected", |watch| {
        matches!(watch.connection, Some(Connection::Ready))
    })?;
    Ok((studio, signal, watch))
}

fn first_run(config: &StudioConfig, target: &Target, work: &Path) -> anyhow::Result<String> {
    let (studio, signal, mut watch) = open(config)?;
    let outcome = (|| {
        let watch = &mut watch;
        pump(&studio, &signal, watch, "models listed", |watch| {
            watch.models.iter().any(|model| model.provider == target.provider)
        })?;
        let models: Vec<ModelOption> =
            watch.models.iter().filter(|model| model.provider == target.provider).cloned().collect();
        let model = (target.model)(&models).context("no model to run")?;
        println!(
            "     {} models: {}",
            target.name,
            models.iter().map(|model| model.id.as_str()).collect::<Vec<_>>().join(", ")
        );
        println!("     running {}/{model}", target.provider);
        studio.add_project(work.to_string_lossy().into_owned());
        pump(&studio, &signal, watch, "project added", |watch| watch.projects.len() == 1)?;
        let settings = ThreadSettings {
            provider: Some(target.provider.to_string()),
            model: Some(model),
            thinking_level: None,
            access: AccessMode::Supervised,
            worktree: WorktreeChoice::Local,
        };
        let first = format!("Remember the word {WORD}. Reply with only that word, nothing else.");
        let finished = watch.begin();
        let project = watch.projects.first().cloned();
        studio.start_thread("draft-harness".to_string(), project, prompt(&first), settings);
        pump(&studio, &signal, watch, "thread started", |watch| watch.thread.is_some())?;
        let thread = watch.thread.clone().context("thread id")?;
        studio.select_thread(Some(thread.clone()));
        pump(&studio, &signal, watch, "turn 1 finished", |watch| watch.finished > finished)?;
        let reply = watch.reply("turn 1")?;
        ensure!(reply.to_ascii_lowercase().contains(WORD), "turn 1 did not answer with {WORD}");
        println!("ok   reply contains the asked word");
        let row = watch.row().context("thread row")?;
        ensure!(row.harness == target.harness, "the row shows harness {:?}", row.harness);
        println!("ok   row lists harness {:?}", row.harness);
        studio.list_commands("harness-commands".to_string(), watch.projects.first().cloned());
        pump(&studio, &signal, watch, "commands listed with the CLI thread focused", |watch| watch.resources == 1)?;
        studio.list_skills("harness-skills".to_string(), watch.projects.first().cloned());
        pump(&studio, &signal, watch, "skills listed with the CLI thread focused", |watch| watch.resources == 2)?;

        let denied = approval_turn(&studio, &signal, watch, &thread, "denied.txt", ApprovalAnswer::Deny)?;
        ensure!(denied > 0, "Supervised did not ask before writing denied.txt");
        ensure!(!work.join("denied.txt").exists(), "denied.txt was written after a deny");
        println!("ok   deny left denied.txt unwritten ({denied} approvals denied)");
        let approved = approval_turn(&studio, &signal, watch, &thread, "approved.txt", ApprovalAnswer::Approve)?;
        ensure!(approved > 0, "Supervised did not ask before writing approved.txt");
        ensure!(work.join("approved.txt").is_file(), "approved.txt is missing after an approve");
        println!("ok   approve wrote approved.txt ({approved} approvals)");

        let finished = watch.begin();
        studio.send("send-long".to_string(), thread.clone(), prompt(LONG), Delivery::Queue);
        pump(&studio, &signal, watch, "long turn is working", |watch| watch.busy)?;
        pump(&studio, &signal, watch, "long turn is streaming text", |watch| {
            watch.streamed || watch.finished > finished
        })?;
        ensure!(watch.finished == finished, "the long turn ended before the abort: {:?}", watch.failure);
        studio.abort(thread.clone());
        let aborted = Instant::now();
        pump(&studio, &signal, watch, "abort ended the turn", |watch| watch.finished > finished && !watch.busy)?;
        pump(&studio, &signal, watch, "abort took the row out of Working", |watch| {
            watch.row().is_some_and(|row| row.status != ThreadStatus::Working)
        })?;
        let status = watch.row().map(|row| row.status);
        println!("ok   aborted turn left Working in {} ms (row {status:?})", aborted.elapsed().as_millis());
        Ok(thread)
    })();
    studio.shutdown();
    outcome
}

fn second_run(config: &StudioConfig, target: &Target, thread: &str) -> anyhow::Result<()> {
    let (studio, signal, mut watch) = open(config)?;
    let outcome = (|| {
        let watch = &mut watch;
        watch.thread = Some(thread.to_string());
        pump(&studio, &signal, watch, "thread listed after the restart", |watch| watch.row().is_some())?;
        let row = watch.row().context("thread row")?;
        ensure!(row.harness == target.harness, "after the restart the row shows harness {:?}", row.harness);
        println!("ok   listed after restart: \"{}\" harness {:?}", row.title, row.harness);
        studio.select_thread(Some(thread.to_string()));
        pump(&studio, &signal, watch, "earlier turns shown", |watch| {
            watch.users.values().any(|text| text.contains(WORD))
        })?;
        println!("ok   earlier turns shown ({} user messages, {} replies)", watch.users.len(), watch.answers.len());
        let reply = turn(
            &studio,
            &signal,
            watch,
            thread,
            "What word did I ask you to remember in my first message? Reply with only that word.",
            "resumed turn",
        )?;
        ensure!(reply.to_ascii_lowercase().contains(WORD), "the resumed session did not remember {WORD}");
        println!("ok   the session resumed: turn 1 word recalled");
        studio.load_usage("usage-1".to_string(), UsagePeriod::Day);
        pump(&studio, &signal, watch, "usage report loaded", |watch| watch.usage.is_some())?;
        let report = watch.usage.as_ref().context("usage")?;
        let rows: Vec<_> = report.by_model.iter().filter(|model| model.provider == target.provider).collect();
        for row in &rows {
            println!(
                "     usage {}/{}: {} tokens, {} requests, ${:.4}",
                row.provider, row.model, row.tokens, row.requests, row.cost_usd
            );
        }
        println!(
            "     usage total: {} tokens (in {} cache read {} out {}), ${:.4}, {} sessions",
            report.total_tokens,
            report.input_tokens,
            report.cache_read_tokens,
            report.output_tokens,
            report.cost_usd,
            report.sessions
        );
        ensure!(rows.iter().any(|row| row.tokens > 0), "the usage report has no {} tokens", target.provider);
        ensure!(report.output_tokens > 0, "the usage report counts no output tokens");
        println!("ok   usage report counts real tokens");
        Ok(())
    })();
    studio.shutdown();
    outcome
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

pub fn run(target: &Target) -> anyhow::Result<()> {
    let usage = format!("usage: {} <eukhe> <scratch dir>", target.name);
    let mut args = std::env::args_os().skip(1);
    let daemon = PathBuf::from(args.next().context(usage.clone())?);
    let root = PathBuf::from(args.next().context(usage)?);
    let agent_dir = root.join("agent");
    let work = root.join("work");
    std::fs::create_dir_all(&agent_dir)?;
    scratch_repo(&work)?;
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
    let outcome = first_run(&config, target, &work).and_then(|thread| {
        println!("ok   first Studio shut down; starting a second one on the same data dir");
        second_run(&config, target, &thread)
    });
    let stopped = stop_daemon(&socket);
    outcome?;
    stopped?;
    println!("PASS {}", target.name);
    Ok(())
}
