use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

use anyhow::{bail, Context};
use eukhe_client::daemon_client::DaemonClient;
use eukhe_types::daemon::DaemonCommand;
use local_studio_core::{
    AccessMode, ApprovalAnswer, Block, CommandKind, Connection, DaemonLaunch, Delivery, FollowUpBehavior,
    ImageAttachment, Item, ItemKind, ModelKey, ModelOption, NotificationKind, Project, PromptDraft, ResponseStreaming,
    Settings, Shelf, SkillEntry, SkillSource, SlashCommand, Studio, StudioConfig, ThreadRow, ThreadSearchHit,
    ThreadSettings, ThreadStatus, ToolState, TranscriptOp, Update, Waker, WorktreeChoice,
};
use serde_json::Map;

const STEP_TIMEOUT: Duration = Duration::from_secs(60);
const FAUX_SCRIPT: &str = r#"{"modelId":"faux-1","responses":[{"content":[{"type":"thinking","thinking":"planning the smoke"},{"type":"text","text":"Running the smoke command."},{"type":"toolCall","name":"bash","arguments":{"i":"run the smoke","script":"echo smoke-ok > smoke.txt && cat smoke.txt"},"id":"call-1"}]},"Done: smoke-ok",{"content":[{"type":"text","text":"Second answer"},{"type":"toolCall","name":"bash","arguments":{"i":"run it again","script":"echo again-ok > again.txt && cat again.txt"},"id":"call-2"}]},"Second done","\"Smoke Title From The Model.\"","Skill answer","Template answer","Image answer",{"text":"Slow answer","delayMs":4000},"After steer"]}"#;
const GENERATED_TITLE: &str = "Smoke Title From The Model";

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
            | Update::TerminalOutput { .. }
            | Update::TerminalExited { .. }
            | Update::Usage { .. }
            | Update::Local { .. }
            | Update::Providers { .. }
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

fn finished_tool(items: &[Item]) -> bool {
    items.iter().any(|item| {
        matches!(&item.kind, ItemKind::Tool { state: ToolState::Succeeded, output, summary, .. } if output.contains("smoke-ok") && summary.starts_with("echo smoke-ok"))
    })
}

fn turn_summary_before_answer(items: &[Item]) -> bool {
    let Some(summary) = items.iter().position(|item| matches!(item.kind, ItemKind::TurnSummary { tool_count: 1, .. }))
    else {
        return false;
    };
    items.get(summary + 1).is_some_and(
        |item| matches!(&item.kind, ItemKind::Assistant { blocks, .. } if blocks.iter().any(|block| matches!(block, Block::Text { text } if text.contains("Done: smoke-ok")))),
    )
}

fn turn_done(view: &View, thread: &str) -> bool {
    let items = view.items(thread);
    answer_text(items).contains("Done: smoke-ok") && finished_tool(items) && turn_summary_before_answer(items)
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
    ThreadSettings { provider: None, model: None, thinking_level: None, access, worktree: WorktreeChoice::Local }
}

fn main() -> anyhow::Result<()> {
    let usage = "usage: smoke <eukhe-daemon> <scratch dir> | smoke --stop <socket>";
    let mut args = std::env::args_os().skip(1);
    let first = PathBuf::from(args.next().context(usage)?);
    if first.as_os_str() == "--stop" {
        return stop_daemon(&PathBuf::from(args.next().context(usage)?));
    }
    let daemon = first;
    let root = PathBuf::from(args.next().context(usage)?);
    let agent_dir = root.join("agent");
    let work = root.join("work");
    let data = root.join("data");
    std::fs::create_dir_all(&work)?;
    std::fs::create_dir_all(agent_dir.join("skills").join("smoke-skill"))?;
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
    let outcome = drive(&config, &work);
    let stopped = stop_daemon(&socket);
    outcome?;
    stopped?;
    println!("PASS core smoke");
    Ok(())
}

struct Ids {
    first: String,
    second: String,
    project: String,
    hidden: ModelKey,
}

fn drive(config: &StudioConfig, work: &Path) -> anyhow::Result<()> {
    let mut harness = Harness::new(config.clone())?;
    let outcome = first_run(&mut harness, work).and_then(|ids| curate(&mut harness, &ids).map(|()| ids));
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
        prompt("run the smoke command"),
        settings(AccessMode::Supervised),
    );
    harness.pump_until("first thread started", |view| view.thread("draft-1").is_some())?;
    let first = harness.view.thread("draft-1").context("no first thread")?;
    studio.select_thread(Some(first.clone()));
    studio.start_thread(
        "draft-2".to_string(),
        Some(project.clone()),
        prompt("run it again in the background"),
        settings(AccessMode::FullAccess),
    );
    harness.pump_until("second thread started while the first runs", |view| {
        view.thread("draft-2").is_some()
            && view.statuses.get(&first).is_some_and(|history| {
                history.iter().any(|status| matches!(status, ThreadStatus::Working | ThreadStatus::Approval))
            })
    })?;
    let second = harness.view.thread("draft-2").context("no second thread")?;
    harness.pump_until("focused turn streamed a tool card, a turn summary and the reply", |view| {
        turn_done(view, &first) && idle(view, &first)
    })?;
    harness.pump_until("background thread finished as Done", |view| {
        view.row(&second).is_some_and(|row| row.status == ThreadStatus::Done && row.unread)
    })?;
    for item in harness.view.items(&first) {
        println!("     item {:?}", item.kind);
    }
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
    studio.load_models();
    harness.pump_until("model catalog loaded", |view| view.models.is_some())?;
    let models = harness.view.models.clone().unwrap_or_default();
    println!(
        "     {} models from {:?}",
        models.len(),
        models.iter().map(|model| &model.provider).collect::<BTreeSet<_>>()
    );
    let first_model = models.first().context("the catalog is empty")?;
    let hidden = ModelKey { provider: first_model.provider.clone(), model: first_model.id.clone() };
    Ok(Ids { first, second, project, hidden })
}

fn round_two(harness: &mut Harness, ids: &Ids) -> anyhow::Result<()> {
    let studio = Arc::clone(&harness.studio);
    let (first, second) = (ids.first.clone(), ids.second.clone());
    studio.search_threads("search-1".to_string(), "DONE: SMOKE".to_string(), 10);
    harness.pump_until("thread content search found both threads", |view| {
        view.search.as_ref().is_some_and(|hits| {
            [&first, &second].iter().all(|id| {
                hits.iter()
                    .any(|hit| &hit.thread == *id && hit.snippet.contains("Done: smoke-ok") && hit.project.is_some())
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

fn curate(harness: &mut Harness, ids: &Ids) -> anyhow::Result<()> {
    let studio = Arc::clone(&harness.studio);
    let first = ids.first.clone();
    let second = ids.second.clone();
    round_two(harness, ids)?;
    studio.set_pinned(first.clone(), true);
    studio.rename_thread(first.clone(), "Renamed smoke".to_string());
    studio.set_settled(second.clone(), true);
    harness.pump_until("pin, rename and settle applied", |view| {
        view.row(&first).is_some_and(|row| row.pinned && row.shelf == Shelf::Pinned && row.title == "Renamed smoke")
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
    harness.pump_until("edit from here rewound and filled the composer", |view| {
        view.composer.iter().any(|(thread, text)| thread == &first && text == "run the smoke command")
            && view.items(&first).is_empty()
    })?;
    studio.send(first.clone(), prompt("after the rewind"), Delivery::Queue);
    harness.pump_until("rewound thread answered again", |view| {
        answer_text(view.items(&first)).contains("Second answer") && idle(view, &first)
    })?;
    studio.regenerate_title(first.clone());
    harness.pump_until("title regenerated by a model side question", |view| {
        view.row(&first).is_some_and(|row| row.title == GENERATED_TITLE)
    })?;
    println!("     {} Threads updates, notifications {:?}", harness.view.thread_updates, harness.view.notifications);
    round_four(harness, ids)
}

fn round_four(harness: &mut Harness, ids: &Ids) -> anyhow::Result<()> {
    let studio = Arc::clone(&harness.studio);
    harness.view.always.insert("draft-always".to_string());
    studio.start_thread(
        "draft-always".to_string(),
        Some(ids.project.clone()),
        prompt("ask once, then allow"),
        settings(AccessMode::Supervised),
    );
    harness.pump_until("always-allow thread answered", |view| {
        view.thread("draft-always").is_some_and(|id| view.done_by_thread.get(&id) == Some(&1))
    })?;
    let always = harness.view.thread("draft-always").context("no always-allow thread")?;
    studio.send(always.clone(), prompt("write again without asking"), Delivery::Queue);
    harness.pump_until("second write finished", |view| view.done_by_thread.get(&always) == Some(&2))?;
    if harness.view.approvals_by_thread.get(&always) != Some(&1) {
        bail!("always-allow asked again: {:?}", harness.view.approvals_by_thread.get(&always));
    }
    println!("ok   always allow this session widened the effects (1 approval for 2 writes)");
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
    studio.send(first.clone(), prompt("/skill:smoke-skill please"), Delivery::Queue);
    harness.pump_until("skill command expanded before sending", |view| {
        user_texts(view, &first).iter().any(|text| {
            text.contains("<skill name=\"smoke-skill\"")
                && text.contains("smoke-skill-body")
                && text.ends_with("please")
        }) && answer_text(view.items(&first)).contains("Skill answer")
            && idle(view, &first)
    })?;
    studio.send(first.clone(), prompt("/smoke-template hello"), Delivery::Queue);
    harness.pump_until("prompt template expanded with its argument", |view| {
        user_texts(view, &first).iter().any(|text| text == "Template says hello")
            && answer_text(view.items(&first)).contains("Template answer")
            && idle(view, &first)
    })?;
    let mut png = Vec::new();
    image::RgbaImage::from_pixel(640, 320, image::Rgba([40, 90, 200, 255]))
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)?;
    studio.send(
        first.clone(),
        PromptDraft {
            text: "look at this".to_string(),
            images: vec![ImageAttachment { mime_type: "image/png".to_string(), data: png.clone() }],
            files: Vec::new(),
        },
        Delivery::Queue,
    );
    harness.pump_until("user image carried as a downscaled thumbnail", |view| {
        view.items(&first).iter().any(|item| matches!(&item.kind, ItemKind::User { thumbnails, entry: Some(_), .. } if thumbnails.len() == 1 && thumbnails[0].width == 512 && thumbnails[0].height == 256))
            && idle(view, &first)
    })?;
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
    studio.send(first.clone(), prompt("answer slowly"), Delivery::Queue);
    harness.pump_until("slow run started", |view| {
        view.row(&first).is_some_and(|row| row.status == ThreadStatus::Working)
    })?;
    studio.send(first.clone(), prompt("steer this"), Delivery::Default);
    harness.pump_until("default delivery followed the steer setting", |view| view.steered.contains(&first))?;
    harness.pump_until("steered run finished", |view| {
        answer_text(view.items(&first)).contains("After steer") && idle(view, &first)
    })?;
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
    let fan = ModelKey { provider: "faux".to_string(), model: "faux-1".to_string() };
    studio.start_threads(
        "draft-fan".to_string(),
        Some(ids.project.clone()),
        prompt("fan out"),
        settings(AccessMode::FullAccess),
        vec![fan.clone(), fan],
    );
    harness.pump_until("fan-out threads finished in their own worktrees", |view| {
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
            && view.row(&ids.first).is_some_and(|row| row.pinned && row.title == GENERATED_TITLE && !row.auto_settle)
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
    Ok(())
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
