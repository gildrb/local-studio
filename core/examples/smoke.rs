use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

use anyhow::{bail, ensure, Context};
use eukhe_client::daemon_client::DaemonClient;
use eukhe_types::daemon::DaemonCommand;
use local_studio_core::{
    highlight, highlight_lines, AccessMode, ApprovalAnswer, Block, CodeSegment, CommandKind, Connection, DaemonLaunch,
    Delivery, FollowUpBehavior, ImageAttachment, Item, ItemKind, ModelKey, ModelOption, NotificationKind, Project,
    PromptDraft, ResponseStreaming, Settings, Shelf, SkillEntry, SkillSource, SlashCommand, Studio, StudioConfig,
    SyntaxKind, ThreadRow, ThreadSearchHit, ThreadSettings, ThreadStatus, ToolState, TranscriptOp, Update, UsagePeriod,
    UsageReport, Waker, WorktreeChoice,
};
use serde_json::Map;

#[path = "support/real_model.rs"]
mod real_model;

const STEP_TIMEOUT: Duration = Duration::from_secs(150);
const MARK: &str = "smoke-ok";
const RENAMED: &str = "Renamed smoke";
const STEER: &str = "Also include the word steered in your final reply.";

fn bash_prompt(command: &str) -> String {
    format!("Use the bash tool to run exactly this command once: `{command}`. Then reply with only the word done.")
}

fn first_prompt() -> String {
    bash_prompt("echo smoke-ok > smoke.txt && cat smoke.txt")
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
struct View {
    connection: Option<Connection>,
    projects: Vec<Project>,
    threads: Vec<ThreadRow>,
    thread_updates: u32,
    started: HashMap<String, String>,
    transcripts: HashMap<String, Vec<Item>>,
    resets: HashMap<String, u32>,
    answered: HashSet<String>,
    approvals: u32,
    always: HashSet<String>,
    approvals_by_thread: HashMap<String, u32>,
    done_by_thread: HashMap<String, u32>,
    notices: Vec<String>,
    settings: Option<Settings>,
    commands: Option<Vec<SlashCommand>>,
    skills: Option<Vec<SkillEntry>>,
    steered: HashSet<String>,
    image: Option<Vec<u8>>,
    partial_text: bool,
    composer: Vec<(String, String)>,
    models: Option<Vec<ModelOption>>,
    hidden: Vec<ModelKey>,
    search: Option<Vec<ThreadSearchHit>>,
    archived: Option<Vec<ThreadRow>>,
    statuses: HashMap<String, Vec<ThreadStatus>>,
    notifications: Vec<String>,
    usage: Option<UsageReport>,
}

impl View {
    fn row(&self, thread: &str) -> Option<&ThreadRow> {
        self.threads.iter().find(|row| row.id == thread)
    }

    fn items(&self, thread: &str) -> &[Item] {
        self.transcripts.get(thread).map_or(&[], Vec::as_slice)
    }

    fn thread(&self, draft: &str) -> Option<String> {
        self.started.get(draft).cloned()
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
            self.signal.wait(left.min(Duration::from_millis(500)));
        }
    }

    fn apply(&mut self, update: Update) -> anyhow::Result<()> {
        match update {
            Update::Connection { state } => {
                println!("     connection {state:?}");
                self.view.connection = Some(state);
            }
            Update::Projects { projects } => self.view.projects = projects,
            Update::Threads { threads } => {
                self.view.thread_updates += 1;
                for row in &threads {
                    let history = self.view.statuses.entry(row.id.clone()).or_default();
                    if history.last() != Some(&row.status) {
                        history.push(row.status);
                    }
                }
                self.view.threads = threads;
            }
            Update::ArchivedThreads { threads, .. } => self.view.archived = Some(threads),
            Update::ThreadSearch { hits, .. } => self.view.search = Some(hits),
            Update::ThreadStarted { draft, thread } => {
                println!("     started {draft} -> {thread}");
                self.view.started.insert(draft, thread);
            }
            Update::Transcript { thread, op } => self.transcript(&thread, op)?,
            Update::Approvals { thread, approvals } => {
                for approval in approvals {
                    if self.view.answered.insert(format!("{thread}/{}", approval.request_id)) {
                        println!("     approval {} {:?}", approval.command, approval.effects);
                        self.view.approvals += 1;
                        *self.view.approvals_by_thread.entry(thread.clone()).or_default() += 1;
                        let always =
                            self.view.always.iter().any(|draft| self.view.thread(draft).as_ref() == Some(&thread));
                        let answer = if always { ApprovalAnswer::AlwaysAllowSession } else { ApprovalAnswer::Approve };
                        self.studio.answer_approval(thread.clone(), approval.request_id, answer);
                    }
                }
            }
            Update::ComposerText { thread, text } => self.view.composer.push((thread, text)),
            Update::Models { models, hidden, .. } => {
                self.view.models = Some(models);
                self.view.hidden = hidden;
            }
            Update::Notification { thread, kind, title, body } => {
                println!("     notification {kind:?} {title}: {body}");
                self.view.notifications.push(format!("{kind:?}"));
                if kind == NotificationKind::TurnDone {
                    *self.view.done_by_thread.entry(thread).or_default() += 1;
                }
            }
            Update::Notice { level, text } => {
                println!("     notice {level:?}: {text}");
                self.view.notices.push(text);
            }
            Update::RequestFailed { request, message } => println!("     request {request} failed: {message}"),
            Update::Settings { settings } => self.view.settings = Some(settings),
            Update::Commands { commands, .. } => self.view.commands = Some(commands),
            Update::Skills { skills, .. } => self.view.skills = Some(skills),
            Update::Queue { thread, queued } => {
                if queued.iter().any(|message| message.steering) {
                    self.view.steered.insert(thread);
                }
            }
            Update::MessageImage { data, .. } => self.view.image = Some(data),
            Update::Usage { report, .. } => self.view.usage = Some(report),
            Update::Thread { .. }
            | Update::Subagents { .. }
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
            | Update::Keybindings { .. }
            | Update::RequestDone { .. }
            | Update::ProjectScripts { .. }
            | Update::ProjectSettings { .. }
            | Update::WorktreeSetup { .. }
            | Update::Daemon { .. } => {}
        }
        Ok(())
    }

    fn transcript(&mut self, thread: &str, op: TranscriptOp) -> anyhow::Result<()> {
        let items = self.view.transcripts.entry(thread.to_string()).or_default();
        let partial = match &op {
            TranscriptOp::Insert { item, .. } | TranscriptOp::Update { item, .. } => {
                matches!(&item.kind, ItemKind::Assistant { streaming: true, blocks, .. } if blocks.iter().any(|block| matches!(block, Block::Text { .. })))
            }
            TranscriptOp::Reset { .. } => false,
        };
        if partial {
            self.view.partial_text = true;
        }
        match op {
            TranscriptOp::Reset { items: fresh } => {
                *self.view.resets.entry(thread.to_string()).or_default() += 1;
                *items = fresh;
            }
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
                if slot.id != item.id {
                    bail!("update at {index} changed item id {} to {}", slot.id, item.id);
                }
                *slot = item;
            }
        }
        Ok(())
    }
}

fn shape(items: &[Item]) -> Vec<(u64, Option<i64>, ItemKind)> {
    items.iter().map(|item| (item.turn, item.created_at, item.kind.clone())).collect()
}

fn answer_text(items: &[Item]) -> String {
    items
        .iter()
        .filter_map(|item| match &item.kind {
            ItemKind::Assistant { blocks, .. } => Some(blocks),
            ItemKind::User { .. }
            | ItemKind::Tool { .. }
            | ItemKind::TurnSummary { .. }
            | ItemKind::Notice { .. }
            | ItemKind::Compaction { .. } => None,
        })
        .flatten()
        .filter_map(|block| match block {
            Block::Text { text } => Some(text.as_str()),
            Block::Thinking { .. } => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn reply_to(items: &[Item], prompt: &str) -> String {
    let Some(start) =
        items.iter().rposition(|item| matches!(&item.kind, ItemKind::User { text, .. } if text.contains(prompt)))
    else {
        return String::new();
    };
    answer_text(&items[start + 1..])
}

fn finished_tool(items: &[Item]) -> bool {
    items.iter().any(|item| {
        matches!(&item.kind, ItemKind::Tool { state: ToolState::Succeeded, output, .. } if output.contains(MARK))
    })
}

fn turn_summary_before_answer(items: &[Item]) -> bool {
    let Some(summary) =
        items.iter().position(|item| matches!(item.kind, ItemKind::TurnSummary { tool_count, .. } if tool_count >= 1))
    else {
        return false;
    };
    items.get(summary + 1).is_some_and(
        |item| matches!(&item.kind, ItemKind::Assistant { blocks, .. } if blocks.iter().any(|block| matches!(block, Block::Text { text } if !text.trim().is_empty()))),
    )
}

fn turn_done(view: &View, thread: &str) -> bool {
    let items = view.items(thread);
    finished_tool(items) && turn_summary_before_answer(items)
}

fn file_holds(dir: &Path, name: &str, text: &str) -> anyhow::Result<()> {
    let path = dir.join(name);
    let content = std::fs::read_to_string(&path).with_context(|| format!("the tool call did not write {name}"))?;
    ensure!(content.trim() == text, "{} holds {content:?}, expected {text:?}", path.display());
    Ok(())
}

fn check_summary_covers_tools(items: &[Item]) -> anyhow::Result<()> {
    for item in items {
        let ItemKind::TurnSummary { turn, duration_ms, .. } = item.kind else { continue };
        for tool in items.iter().filter(|tool| tool.turn == turn) {
            if let ItemKind::Tool { started_at: Some(start), ended_at: Some(end), name, .. } = &tool.kind {
                let span = u64::try_from(end - start).unwrap_or(0);
                if duration_ms < span {
                    bail!("turn {turn} summary lasts {duration_ms} ms, shorter than its {name} tool ({span} ms)");
                }
            }
        }
    }
    Ok(())
}

fn idle(view: &View, thread: &str) -> bool {
    view.row(thread).is_some_and(|row| !matches!(row.status, ThreadStatus::Working | ThreadStatus::Approval))
}

fn prompt(text: &str) -> PromptDraft {
    PromptDraft { text: text.to_string(), images: Vec::new(), files: Vec::new() }
}

fn settings(access: AccessMode) -> ThreadSettings {
    real_model::thread_settings(access, WorktreeChoice::Local)
}

fn main() -> anyhow::Result<()> {
    let usage = "usage: smoke <eukhe-daemon> <scratch dir> | smoke --stop <socket>";
    let mut args = std::env::args_os().skip(1);
    let first = PathBuf::from(args.next().context(usage)?);
    if first.as_os_str() == "--stop" {
        return stop_daemon(&PathBuf::from(args.next().context(usage)?));
    }
    check_highlight()?;
    let daemon = first;
    let root = PathBuf::from(args.next().context(usage)?);
    let agent_dir = root.join("agent");
    let work = root.join("work");
    let data = root.join("data");
    std::fs::create_dir_all(&work)?;
    std::fs::create_dir_all(agent_dir.join("skills").join("smoke-skill"))?;
    let _credentials = real_model::install(&agent_dir)?;
    std::fs::create_dir_all(agent_dir.join("prompts"))?;
    std::fs::write(
        agent_dir.join("skills").join("smoke-skill").join("SKILL.md"),
        "---\nname: smoke-skill\ndescription: Answers the smoke check\n---\nSay smoke-skill-body.",
    )?;
    std::fs::write(
        agent_dir.join("prompts").join("smoke-template.md"),
        "---\ndescription: A smoke template\n---\nTemplate says $1",
    )?;
    git(&work, &["init", "-q", "-b", "main"])?;
    git(
        &work,
        &["-c", "user.name=Smoke", "-c", "user.email=smoke@example.com", "commit", "-q", "--allow-empty", "-m", "init"],
    )?;
    std::env::set_var("LOCAL_STUDIO_DATA_DIR", &data);
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
    let outcome = drive(&config, &work);
    let stopped = stop_daemon(&socket);
    outcome?;
    stopped?;
    println!("PASS core smoke");
    Ok(())
}

fn kind_of(segments: &[CodeSegment], text: &str) -> Option<SyntaxKind> {
    segments.iter().find(|segment| segment.text == text).map(|segment| segment.kind)
}

fn expect_kinds(label: &str, segments: &[CodeSegment], expected: &[(&str, SyntaxKind)]) -> anyhow::Result<()> {
    for (text, kind) in expected {
        let found = kind_of(segments, text);
        if found != Some(*kind) {
            bail!("{label}: {text:?} highlighted as {found:?}, expected {kind:?}");
        }
    }
    Ok(())
}

fn check_highlight() -> anyhow::Result<()> {
    let rust = "use std::fmt;\n// note\npub fn add(left: i32, name: &str) -> Option<String> {\n    let total = 42;\n    println!(\"sum {}\", total);\n    self.count += 1;\n    None\n}\n";
    let segments = highlight(rust.to_string(), Some("rs".to_string()), None);
    if segments.iter().map(|segment| segment.text.as_str()).collect::<String>() != rust {
        bail!("rust highlight does not cover the input");
    }
    expect_kinds(
        "rust",
        &segments,
        &[
            ("use", SyntaxKind::Keyword),
            ("// note\n", SyntaxKind::Comment),
            ("fn", SyntaxKind::Keyword),
            ("add", SyntaxKind::Function),
            ("left", SyntaxKind::Parameter),
            ("i32", SyntaxKind::Type),
            ("Option", SyntaxKind::Type),
            ("42", SyntaxKind::Number),
            ("println!", SyntaxKind::Function),
            ("\"sum ", SyntaxKind::String),
            ("self", SyntaxKind::Builtin),
            ("+=", SyntaxKind::Operator),
            ("{", SyntaxKind::Punctuation),
        ],
    )?;
    let typescript = "// greet\nexport interface User { name: string; age: number }\nconst greet = (user: User): string => `hi ${user.name}`;\nconsole.log(greet({ name: \"a\", age: 3 }), true);\n";
    let segments = highlight(typescript.to_string(), Some("ts".to_string()), None);
    expect_kinds(
        "typescript",
        &segments,
        &[
            ("// greet", SyntaxKind::Comment),
            ("export", SyntaxKind::Keyword),
            ("interface", SyntaxKind::Keyword),
            ("User", SyntaxKind::Type),
            ("name", SyntaxKind::Property),
            ("string", SyntaxKind::Type),
            ("greet", SyntaxKind::Function),
            ("user", SyntaxKind::Parameter),
            ("=>", SyntaxKind::Operator),
            ("\"a\"", SyntaxKind::String),
            ("3", SyntaxKind::Number),
            ("true", SyntaxKind::Constant),
        ],
    )?;
    let unknown = "frobnicate the widgets\n";
    let segments = highlight(unknown.to_string(), Some("zzz-unknown".to_string()), None);
    if segments != [CodeSegment { text: unknown.to_string(), kind: SyntaxKind::Plain }] {
        bail!("unknown language was not plain: {segments:?}");
    }
    let lines = highlight_lines(
        vec!["/* open".to_string(), "still */ let x = 1;".to_string()],
        None,
        Some("web/app.js".to_string()),
    );
    let continued = lines.get(1).and_then(|line| line.first()).map(|segment| (segment.text.as_str(), segment.kind));
    if continued != Some(("still */", SyntaxKind::Comment)) {
        bail!("highlight_lines lost the comment state: {lines:?}");
    }
    println!("ok   highlight: rust and typescript kinds, unknown language plain, line state carried");
    Ok(())
}

struct Ids {
    work: PathBuf,
    first: String,
    second: String,
    project: String,
    hidden: ModelKey,
    title: String,
}

const REWIND: &str = "Reply with only the word rewound.";
const IMAGE: &str = "What color fills this image? Reply with one word.";
const FAN: &str = "Reply with only the word fan.";

fn drive(config: &StudioConfig, work: &Path) -> anyhow::Result<()> {
    let mut harness = Harness::new(config.clone())?;
    let outcome = first_run(&mut harness, work).and_then(|mut ids| curate(&mut harness, &mut ids).map(|()| ids));
    harness.studio.shutdown();
    let ids = outcome?;
    let mut restarted = Harness::new(config.clone())?;
    let outcome = second_run(&mut restarted, &ids);
    restarted.studio.shutdown();
    outcome
}

fn first_run(harness: &mut Harness, work: &Path) -> anyhow::Result<Ids> {
    let studio = Arc::clone(&harness.studio);
    harness.pump_until("daemon launched and connected", |view| matches!(view.connection, Some(Connection::Ready)))?;
    studio.add_project(work.to_string_lossy().into_owned());
    harness.pump_until("project added", |view| view.projects.len() == 1)?;
    let project = harness.view.projects[0].id.clone();
    studio.start_thread(
        "draft-1".to_string(),
        Some(project.clone()),
        prompt(&first_prompt()),
        settings(AccessMode::Supervised),
    );
    harness.pump_until("first thread started", |view| view.thread("draft-1").is_some())?;
    let first = harness.view.thread("draft-1").context("no first thread")?;
    studio.select_thread(Some(first.clone()));
    studio.start_thread(
        "draft-2".to_string(),
        Some(project.clone()),
        prompt(&bash_prompt("echo smoke-ok > again.txt && cat again.txt")),
        settings(AccessMode::FullAccess),
    );
    harness.pump_until("second thread started while the first runs", |view| {
        view.thread("draft-2").is_some()
            && view.statuses.get(&first).is_some_and(|history| {
                history.iter().any(|status| matches!(status, ThreadStatus::Working | ThreadStatus::Approval))
            })
    })?;
    let second = harness.view.thread("draft-2").context("no second thread")?;
    harness.pump_until("focused turn streamed a real tool card, a turn summary and the reply", |view| {
        turn_done(view, &first) && idle(view, &first)
    })?;
    harness.pump_until("background thread finished as Done", |view| {
        view.row(&second).is_some_and(|row| row.status == ThreadStatus::Done && row.unread)
    })?;
    for item in harness.view.items(&first) {
        println!("     item {:?}", item.kind);
    }
    file_holds(work, "smoke.txt", MARK)?;
    file_holds(work, "again.txt", MARK)?;
    println!("ok   both real bash calls wrote their files");
    let asked = harness.view.approvals_by_thread.get(&first).copied().unwrap_or(0);
    ensure!(asked >= 1, "the supervised write never asked for approval");
    ensure!(!harness.view.approvals_by_thread.contains_key(&second), "the full-access thread asked for approval");
    println!("ok   supervised write asked ({asked}), full access did not");
    check_summary_covers_tools(harness.view.items(&first))?;
    println!("ok   turn summary covers every tool span of its turn");
    let rows = harness.view.threads.clone();
    for id in [&first, &second] {
        let row = rows.iter().find(|row| &row.id == id).context("thread row missing")?;
        println!(
            "     row {} {:?} {:?} project={:?} title={:?} history={:?}",
            row.id,
            row.shelf,
            row.status,
            row.project,
            row.title,
            harness.view.statuses.get(id)
        );
        if row.project.as_deref() != Some(project.as_str()) || row.shelf != Shelf::Active {
            bail!("thread {id} is not an Active row of the project: {row:?}");
        }
    }
    let first_history = harness.view.statuses.get(&first).cloned().unwrap_or_default();
    if !first_history.contains(&ThreadStatus::Working) {
        bail!("the first thread never showed Working: {first_history:?}");
    }
    println!("ok   inbox rows carry project, shelf and Working -> Done/Idle transitions");
    let live = shape(harness.view.items(&first));
    studio.select_thread(Some(second.clone()));
    harness.pump_until("second thread focused", |view| view.resets.get(&second).is_some_and(|count| *count >= 1))?;
    if !turn_done(&harness.view, &second) {
        bail!("the background thread's transcript lacks its turn: {:#?}", harness.view.items(&second));
    }
    check_summary_covers_tools(harness.view.items(&second))?;
    let before = harness.view.resets.get(&first).copied().unwrap_or(0);
    studio.select_thread(Some(first.clone()));
    harness.pump_until("first thread reopened", |view| view.resets.get(&first).copied().unwrap_or(0) > before)?;
    harness.pump_until("user entries resolved", |view| {
        view.items(&first).iter().any(|item| matches!(&item.kind, ItemKind::User { entry: Some(_), .. }))
    })?;
    let reopened = shape(harness.view.items(&first));
    if reopened != live {
        bail!("reopened transcript differs from the live fold:\nlive {live:#?}\nreopened {reopened:#?}");
    }
    println!("ok   reopened transcript equals the live fold ({} items)", live.len());
    let hidden = catalog(harness)?;
    Ok(Ids { work: work.to_path_buf(), first, second, project, hidden, title: String::new() })
}

fn catalog(harness: &mut Harness) -> anyhow::Result<ModelKey> {
    harness.studio.load_models();
    harness.pump_until("model catalog loaded", |view| view.models.is_some())?;
    let models = harness.view.models.clone().unwrap_or_default();
    println!(
        "     {} models from {:?}",
        models.len(),
        models.iter().map(|model| &model.provider).collect::<BTreeSet<_>>()
    );
    ensure!(
        models
            .iter()
            .any(|model| model.provider == real_model::PROVIDER && model.id == real_model::MODEL && model.configured),
        "{}/{} is not a configured model in the catalog",
        real_model::PROVIDER,
        real_model::MODEL
    );
    let other = models
        .iter()
        .find(|model| model.id != real_model::MODEL)
        .context("the catalog has no model besides the real one")?;
    Ok(ModelKey { provider: other.provider.clone(), model: other.id.clone() })
}

fn round_two(harness: &mut Harness, ids: &Ids) -> anyhow::Result<()> {
    let studio = Arc::clone(&harness.studio);
    let (first, second) = (ids.first.clone(), ids.second.clone());
    studio.search_threads("search-1".to_string(), MARK.to_uppercase(), 10);
    harness.pump_until("thread content search found both threads", |view| {
        view.search.as_ref().is_some_and(|hits| {
            [&first, &second].iter().all(|id| {
                hits.iter()
                    .any(|hit| &hit.thread == *id && hit.snippet.to_lowercase().contains(MARK) && hit.project.is_some())
            })
        })
    })?;
    studio.search_threads("search-2".to_string(), "no such words anywhere".to_string(), 10);
    harness.pump_until("search without a match is empty", |view| view.search.as_ref().is_some_and(Vec::is_empty))?;
    studio.set_pinned(first.clone(), true);
    studio.set_pinned(second.clone(), true);
    harness.pump_until("both pinned in pin order", |view| pinned_order(view) == [first.clone(), second.clone()])?;
    studio.reorder_pinned(vec![second.clone(), first.clone()]);
    harness.pump_until("pinned reordered", |view| pinned_order(view) == [second.clone(), first.clone()])?;
    studio.set_pinned(second.clone(), false);
    studio.set_auto_settle(first.clone(), false);
    harness.pump_until("auto-settle opt-out shows on the row", |view| {
        view.row(&first).is_some_and(|row| !row.auto_settle) && view.row(&second).is_some_and(|row| row.auto_settle)
    })?;
    studio.set_hidden_model(ids.hidden.provider.clone(), ids.hidden.model.clone(), true);
    harness.pump_until("hidden model listed", |view| view.hidden.contains(&ids.hidden))?;
    Ok(())
}

fn pinned_order(view: &View) -> Vec<String> {
    view.threads.iter().filter(|row| row.shelf == Shelf::Pinned).map(|row| row.id.clone()).collect()
}

fn curate(harness: &mut Harness, ids: &mut Ids) -> anyhow::Result<()> {
    let studio = Arc::clone(&harness.studio);
    let first = ids.first.clone();
    let second = ids.second.clone();
    round_two(harness, ids)?;
    studio.set_pinned(first.clone(), true);
    studio.rename_thread(first.clone(), RENAMED.to_string());
    studio.set_settled(second.clone(), true);
    harness.pump_until("pin, rename and settle applied", |view| {
        view.row(&first).is_some_and(|row| row.pinned && row.shelf == Shelf::Pinned && row.title == RENAMED)
            && view.row(&second).is_some_and(|row| row.shelf == Shelf::Settled)
    })?;
    studio.set_archived(second.clone(), true);
    harness.pump_until("archived thread left the inbox", |view| view.row(&second).is_none())?;
    studio.list_archived("archive-1".to_string());
    harness.pump_until("archive lists the thread", |view| {
        view.archived.as_ref().is_some_and(|rows| rows.iter().any(|row| row.id == second && row.archived))
    })?;
    let entry = harness
        .view
        .items(&first)
        .iter()
        .find_map(|item| match &item.kind {
            ItemKind::User { entry, .. } => entry.clone(),
            ItemKind::Assistant { .. }
            | ItemKind::Tool { .. }
            | ItemKind::TurnSummary { .. }
            | ItemKind::Notice { .. }
            | ItemKind::Compaction { .. } => None,
        })
        .context("the user message has no entry id")?;
    studio.edit_from_here(first.clone(), entry);
    let original = first_prompt();
    harness.pump_until("edit from here rewound and filled the composer", |view| {
        view.composer.iter().any(|(thread, text)| thread == &first && *text == original)
            && view.items(&first).is_empty()
    })?;
    studio.send("send-rewind".to_string(), first.clone(), prompt(REWIND), Delivery::Queue);
    harness.pump_until("rewound thread answered the new prompt", |view| {
        !reply_to(view.items(&first), REWIND).trim().is_empty() && idle(view, &first)
    })?;
    let texts = user_texts(&harness.view, &first);
    ensure!(texts == [REWIND], "the rewound thread still carries the old prompt: {texts:?}");
    println!("ok   the rewound thread holds only the new prompt and its answer");
    studio.regenerate_title(first.clone());
    harness.pump_until("title regenerated by a model side question", |view| {
        view.row(&first).is_some_and(|row| row.title != RENAMED && !row.title.trim().is_empty())
    })?;
    ids.title = harness.view.row(&first).map(|row| row.title.clone()).unwrap_or_default();
    println!("     generated title {:?}", ids.title);
    println!("     {} Threads updates, notifications {:?}", harness.view.thread_updates, harness.view.notifications);
    round_four(harness, ids)
}

fn round_four(harness: &mut Harness, ids: &Ids) -> anyhow::Result<()> {
    let studio = Arc::clone(&harness.studio);
    harness.view.always.insert("draft-always".to_string());
    studio.start_thread(
        "draft-always".to_string(),
        Some(ids.project.clone()),
        prompt(&bash_prompt("echo always-1 > always1.txt")),
        settings(AccessMode::Supervised),
    );
    harness.pump_until("always-allow thread answered", |view| {
        view.thread("draft-always").is_some_and(|id| view.done_by_thread.get(&id) == Some(&1) && idle(view, &id))
    })?;
    let always = harness.view.thread("draft-always").context("no always-allow thread")?;
    studio.send(
        "send-always".to_string(),
        always.clone(),
        prompt(&bash_prompt("echo always-2 > always2.txt")),
        Delivery::Queue,
    );
    harness.pump_until("second write finished", |view| {
        view.done_by_thread.get(&always) == Some(&2) && idle(view, &always)
    })?;
    file_holds(&ids.work, "always1.txt", "always-1")?;
    file_holds(&ids.work, "always2.txt", "always-2")?;
    if harness.view.approvals_by_thread.get(&always) != Some(&1) {
        bail!("always-allow asked again: {:?}", harness.view.approvals_by_thread.get(&always));
    }
    println!("ok   always allow this session widened the effects (1 approval for 2 real writes)");
    round_four_resources(harness, ids)?;
    round_four_settings(harness, ids)?;
    round_four_sessions(harness, ids, &always)
}

fn user_texts(view: &View, thread: &str) -> Vec<String> {
    view.items(thread)
        .iter()
        .filter_map(|item| match &item.kind {
            ItemKind::User { text, .. } => Some(text.clone()),
            ItemKind::Assistant { .. }
            | ItemKind::Tool { .. }
            | ItemKind::TurnSummary { .. }
            | ItemKind::Notice { .. }
            | ItemKind::Compaction { .. } => None,
        })
        .collect()
}

fn round_four_resources(harness: &mut Harness, ids: &Ids) -> anyhow::Result<()> {
    let studio = Arc::clone(&harness.studio);
    let first = ids.first.clone();
    studio.list_skills("skills-1".to_string(), Some(ids.project.clone()));
    harness.pump_until("skills listed with their source", |view| {
        view.skills.as_ref().is_some_and(|skills| {
            skills.iter().any(|skill| skill.name == "smoke-skill" && skill.source == SkillSource::Personal)
        })
    })?;
    studio.list_commands("commands-1".to_string(), Some(ids.project.clone()));
    harness.pump_until("commands listed by kind", |view| {
        view.commands.as_ref().is_some_and(|commands| {
            [
                ("skill:smoke-skill", CommandKind::Skill),
                ("smoke-template", CommandKind::Template),
                ("compact", CommandKind::Command),
            ]
            .iter()
            .all(|(name, kind)| commands.iter().any(|command| command.name == *name && command.kind == *kind))
        })
    })?;
    studio.send("send-skill".to_string(), first.clone(), prompt("/skill:smoke-skill please"), Delivery::Queue);
    harness.pump_until("skill command expanded before sending and answered", |view| {
        user_texts(view, &first).iter().any(|text| {
            text.contains("<skill name=\"smoke-skill\"")
                && text.contains("smoke-skill-body")
                && text.ends_with("please")
        }) && !reply_to(view.items(&first), "smoke-skill-body").trim().is_empty()
            && idle(view, &first)
    })?;
    studio.send("send-template".to_string(), first.clone(), prompt("/smoke-template hello"), Delivery::Queue);
    harness.pump_until("prompt template expanded with its argument and answered", |view| {
        user_texts(view, &first).iter().any(|text| text == "Template says hello")
            && !reply_to(view.items(&first), "Template says hello").trim().is_empty()
            && idle(view, &first)
    })?;
    let mut png = Vec::new();
    image::RgbaImage::from_pixel(640, 320, image::Rgba([40, 90, 200, 255]))
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)?;
    studio.send(
        "send-image".to_string(),
        first.clone(),
        PromptDraft {
            text: IMAGE.to_string(),
            images: vec![ImageAttachment { mime_type: "image/png".to_string(), data: png.clone() }],
            files: Vec::new(),
        },
        Delivery::Queue,
    );
    harness.pump_until("user image carried as a downscaled thumbnail and answered", |view| {
        view.items(&first).iter().any(|item| matches!(&item.kind, ItemKind::User { thumbnails, entry: Some(_), .. } if thumbnails.len() == 1 && thumbnails[0].width == 512 && thumbnails[0].height == 256))
            && !reply_to(view.items(&first), IMAGE).trim().is_empty()
            && idle(view, &first)
    })?;
    let seen = reply_to(harness.view.items(&first), IMAGE);
    ensure!(seen.to_lowercase().contains("blue"), "the model did not see the blue image: {seen:?}");
    println!("ok   the model saw the attached image ({})", seen.trim());
    let entry = harness
        .view
        .items(&first)
        .iter()
        .rev()
        .find_map(|item| match &item.kind {
            ItemKind::User { thumbnails, entry, .. } if !thumbnails.is_empty() => entry.clone(),
            ItemKind::User { .. }
            | ItemKind::Assistant { .. }
            | ItemKind::Tool { .. }
            | ItemKind::TurnSummary { .. }
            | ItemKind::Notice { .. }
            | ItemKind::Compaction { .. } => None,
        })
        .context("the image message has no entry")?;
    studio.load_message_image("image-1".to_string(), first.clone(), entry, 0);
    harness.pump_until("full image loaded on demand", |view| view.image.as_ref() == Some(&png))?;
    Ok(())
}

fn round_four_settings(harness: &mut Harness, ids: &Ids) -> anyhow::Result<()> {
    let studio = Arc::clone(&harness.studio);
    let first = ids.first.clone();
    let mut settings = harness.view.settings.clone().context("no settings update")?;
    settings.follow_up_behavior = FollowUpBehavior::Steer;
    settings.response_streaming = ResponseStreaming::Turn;
    studio.update_settings(settings);
    harness.pump_until("settings applied", |view| {
        view.settings.as_ref().is_some_and(|settings| {
            settings.follow_up_behavior == FollowUpBehavior::Steer
                && settings.response_streaming == ResponseStreaming::Turn
        })
    })?;
    harness.view.partial_text = false;
    let slow = bash_prompt("sleep 8 && echo slept");
    studio.send("send-slow".to_string(), first.clone(), prompt(&slow), Delivery::Queue);
    harness.pump_until("slow run started", |view| {
        view.row(&first).is_some_and(|row| row.status == ThreadStatus::Working)
    })?;
    studio.send("send-steer".to_string(), first.clone(), prompt(STEER), Delivery::Default);
    harness.pump_until("default delivery followed the steer setting", |view| view.steered.contains(&first))?;
    harness.pump_until("steered run finished", |view| {
        !reply_to(view.items(&first), STEER).trim().is_empty() && idle(view, &first)
    })?;
    let items = harness.view.items(&first);
    let user_at = |needle: &str| {
        items.iter().rposition(|item| matches!(&item.kind, ItemKind::User { text, .. } if text.contains(needle)))
    };
    let (Some(slow_at), Some(steer_at)) = (user_at(&slow), user_at(STEER)) else {
        bail!("the slow prompt or the steer is missing from the transcript");
    };
    ensure!(slow_at < steer_at, "the steer landed before the prompt it steers");
    let reply = reply_to(items, STEER);
    ensure!(reply.to_lowercase().contains("steered"), "the model never received the steer: {reply:?}");
    println!("ok   the steer landed after its prompt and reached the model ({})", reply.trim());
    if harness.view.partial_text {
        bail!("turn streaming showed partial assistant text");
    }
    println!("ok   turn streaming hid partial assistant text");
    Ok(())
}

fn round_four_sessions(harness: &mut Harness, ids: &Ids, always: &str) -> anyhow::Result<()> {
    let studio = Arc::clone(&harness.studio);
    studio.restart_thread(always.to_string());
    harness.pump_until("agent session restarted", |view| {
        view.notices.iter().any(|notice| notice == "The agent session restarted.") && view.row(always).is_some()
    })?;
    let fan = ModelKey { provider: real_model::PROVIDER.to_string(), model: real_model::MODEL.to_string() };
    studio.start_threads(
        "draft-fan".to_string(),
        Some(ids.project.clone()),
        prompt(FAN),
        settings(AccessMode::FullAccess),
        vec![fan.clone(), fan],
    );
    harness.pump_until("fan-out threads answered in their own worktrees", |view| {
        let (Some(left), Some(right)) = (view.thread("draft-fan"), view.thread("draft-fan#1")) else { return false };
        let (Some(left), Some(right)) = (view.row(&left), view.row(&right)) else { return false };
        left.fan_out.is_some()
            && left.fan_out == right.fan_out
            && left.worktree.is_some()
            && right.worktree.is_some()
            && left.worktree != right.worktree
            && left.branch != right.branch
            && view.done_by_thread.get(&left.id) == Some(&1)
            && view.done_by_thread.get(&right.id) == Some(&1)
    })?;
    Ok(())
}

fn git(dir: &Path, args: &[&str]) -> anyhow::Result<()> {
    let status = std::process::Command::new("git").args(args).current_dir(dir).status()?;
    if !status.success() {
        bail!("git {args:?} failed");
    }
    Ok(())
}

fn second_run(harness: &mut Harness, ids: &Ids) -> anyhow::Result<()> {
    harness.pump_until("restarted core connected", |view| matches!(view.connection, Some(Connection::Ready)))?;
    harness.pump_until("projects and thread state persisted across the restart", |view| {
        view.projects.iter().any(|project| project.id == ids.project)
            && view.row(&ids.first).is_some_and(|row| row.pinned && row.title == ids.title && !row.auto_settle)
            && view.row(&ids.second).is_none()
    })?;
    harness.studio.list_archived("archive-2".to_string());
    harness.pump_until("archive persisted across the restart", |view| {
        view.archived.as_ref().is_some_and(|rows| {
            rows.iter().any(|row| row.id == ids.second && row.archived && row.shelf == Shelf::Settled)
        })
    })?;
    harness.studio.load_models();
    harness.pump_until("hidden models persisted across the restart", |view| {
        view.models.is_some() && view.hidden.contains(&ids.hidden)
    })?;
    harness.studio.load_usage("usage-1".to_string(), UsagePeriod::Day);
    harness.pump_until("usage report loaded", |view| view.usage.is_some())?;
    real_model::check_usage(harness.view.usage.as_ref().context("usage")?)
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
