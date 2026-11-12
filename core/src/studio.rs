use std::collections::{HashMap, HashSet};
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use eukhe_client::daemon_client::{DaemonClient, DaemonClientEvent};
use eukhe_client::saved_sessions;
use eukhe_types::ai::{ServiceTier, UserContent, UserContentBlock};
use eukhe_types::daemon::{
    DaemonClientKind, DaemonCommand, DaemonSessionLifecycle, DaemonSessionSnapshot, DetachReason, ForkPosition,
    PromptInput, SessionEvent, StreamingBehavior,
};
use eukhe_types::session::AgentMessage;
use eukhe_types::shell::ShellVerdict;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use tokio::sync::{mpsc, watch};
use tokio::time::Instant;

use crate::daemon::{self, DaemonQuery};
use crate::images;
use crate::model::{
    AccessMode, Approval, ApprovalAnswer, Block, Connection, Delivery, ItemKind, ModelKey, ModelOption, NoticeLevel,
    NotificationKind, PromptDraft, Subagent, ThreadInfo, ThreadRow, ThreadSettings, TranscriptOp, Update,
    WorktreeChoice,
};
use crate::oneshot::TextGen;
use crate::session::{self, LiveState};
use crate::skills::Resources;
use crate::store::{self, Store, StoredProject};
use crate::threads::{self, ChildRow, Facts, GitHead, InboxPrefs, RosterRow, SavedRow, SearchDoc};
use crate::transcript::Transcript;
use crate::workspace::model::{FollowUpBehavior, NewThreadWorkspace, ResponseStreaming, Settings, TerminalFrame};
use crate::workspace::{PreparedWorktree, Workspace};

const RECONNECT_DELAY: Duration = Duration::from_secs(1);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);
const TIMER_PERIOD: Duration = Duration::from_secs(15);
const EVENT_BURST: usize = 512;
const NEW_THREAD_TITLE: &str = "New thread";
const BODY_LIMIT: usize = 140;
const GRANTABLE_EFFECTS: [&str; 6] = ["read", "write", "exec", "net", "outside", "protected"];
const GENERATED_TITLE_LIMIT: usize = 80;
const TITLE_QUESTION: &str =
    "Reply with a concise 3-7 word title for this conversation, no punctuation. Reply with the title only.";
const TITLE_CONTEXT_LIMIT: usize = 4000;

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct DaemonLaunch {
    pub program: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct StudioConfig {
    pub socket_path: Option<String>,
    pub session_dir: Option<String>,
    pub data_dir: Option<String>,
    pub launch: Option<DaemonLaunch>,
    pub controller_main: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Error))]
pub enum StudioError {
    Runtime { message: String },
    Config { message: String },
}

impl fmt::Display for StudioError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Runtime { message } => write!(formatter, "could not start the Local Studio core: {message}"),
            Self::Config { message } => write!(formatter, "invalid Local Studio configuration: {message}"),
        }
    }
}

impl std::error::Error for StudioError {}

#[cfg_attr(feature = "ffi", uniffi::export(with_foreign))]
pub trait Waker: Send + Sync {
    fn wake(&self);
}

pub(crate) struct Mailbox {
    updates: Mutex<Vec<Update>>,
    waker: Arc<dyn Waker>,
}

impl Mailbox {
    pub(crate) fn push(&self, update: Update) {
        let was_empty = {
            let mut updates = self.updates.lock().unwrap_or_else(PoisonError::into_inner);
            let was_empty = updates.is_empty();
            updates.push(update);
            was_empty
        };
        if was_empty {
            self.waker.wake();
        }
    }

    pub(crate) fn notice(&self, level: NoticeLevel, text: impl Into<String>) {
        self.push(Update::Notice { level, text: text.into() });
    }

    fn push_threads(&self, threads: Vec<ThreadRow>) {
        let was_empty = {
            let mut updates = self.updates.lock().unwrap_or_else(PoisonError::into_inner);
            updates.retain(|update| !matches!(update, Update::Threads { .. }));
            let was_empty = updates.is_empty();
            updates.push(Update::Threads { threads });
            was_empty
        };
        if was_empty {
            self.waker.wake();
        }
    }

    pub(crate) fn push_frame(&self, terminal: &str, frame: TerminalFrame) {
        let was_empty = {
            let mut updates = self.updates.lock().unwrap_or_else(PoisonError::into_inner);
            let was_empty = updates.is_empty();
            let pending = updates.iter_mut().rev().find_map(|update| match update {
                Update::TerminalFrame { terminal: id, frame } if id == terminal => Some(frame),
                _ => None,
            });
            match pending {
                Some(pending) => merge_frame(pending, frame),
                None => updates.push(Update::TerminalFrame { terminal: terminal.to_owned(), frame }),
            }
            was_empty
        };
        if was_empty {
            self.waker.wake();
        }
    }

    fn drain(&self) -> Vec<Update> {
        std::mem::take(&mut *self.updates.lock().unwrap_or_else(PoisonError::into_inner))
    }
}

fn merge_frame(pending: &mut TerminalFrame, mut next: TerminalFrame) {
    let title = next.title.take().or_else(|| pending.title.take());
    let bell = pending.bell || next.bell;
    if next.full || next.cols != pending.cols || next.rows != pending.rows {
        *pending = next;
    } else {
        for row in next.dirty {
            match pending.dirty.iter_mut().find(|existing| existing.index == row.index) {
                Some(existing) => *existing = row,
                None => pending.dirty.push(row),
            }
        }
        pending.cursor = next.cursor;
        pending.scrollback_len = next.scrollback_len;
        pending.viewport_offset = next.viewport_offset;
        pending.has_selection = next.has_selection;
        pending.mouse_tracking = next.mouse_tracking;
    }
    pending.title = title;
    pending.bell = bell;
}

enum Command {
    AddProject {
        path: String,
    },
    RemoveProject {
        project: String,
    },
    RenameProject {
        project: String,
        name: String,
    },
    SetProjectIcon {
        project: String,
        icon: Option<String>,
    },
    ReorderProjects {
        projects: Vec<String>,
    },
    SelectThread {
        thread: Option<String>,
    },
    StartThread {
        draft: String,
        project: Option<String>,
        prompt: PromptDraft,
        settings: ThreadSettings,
    },
    StartThreads {
        draft: String,
        project: Option<String>,
        prompt: PromptDraft,
        settings: ThreadSettings,
        models: Vec<ModelKey>,
    },
    Send {
        request: String,
        thread: String,
        prompt: PromptDraft,
        delivery: Delivery,
    },
    Abort {
        thread: String,
    },
    SendQueuedNow {
        thread: String,
        queued: String,
    },
    RemoveQueued {
        thread: String,
        queued: String,
    },
    AnswerApproval {
        thread: String,
        request: String,
        answer: ApprovalAnswer,
    },
    RenameThread {
        thread: String,
        title: String,
    },
    DeleteThread {
        thread: String,
    },
    SetArchived {
        thread: String,
        archived: bool,
    },
    SetPinned {
        thread: String,
        pinned: bool,
    },
    SetSettled {
        thread: String,
        settled: bool,
    },
    Snooze {
        thread: String,
        until: Option<i64>,
    },
    MarkUnread {
        thread: String,
        unread: bool,
    },
    EditFromHere {
        thread: String,
        entry: String,
    },
    ForkThread {
        thread: String,
    },
    Compact {
        thread: String,
    },
    SetModel {
        thread: String,
        provider: String,
        model: String,
    },
    SetThinkingLevel {
        thread: String,
        level: String,
    },
    SetAccessMode {
        thread: String,
        mode: AccessMode,
    },
    LoadModels {
        answer: Option<(String, String)>,
    },
    SetFavoriteModel {
        provider: String,
        model: String,
        favorite: bool,
    },
    ListCommands {
        request: String,
        project: Option<String>,
    },
    ListSkills {
        request: String,
        project: Option<String>,
    },
    ListArchived {
        request: String,
    },
    SearchThreads {
        request: String,
        query: String,
        limit: u32,
    },
    ReorderPinned {
        threads: Vec<String>,
    },
    SetAutoSettle {
        thread: String,
        enabled: bool,
    },
    SetHiddenModel {
        provider: String,
        model: String,
        hidden: bool,
    },
    RegenerateTitle {
        thread: String,
    },
    TitleGenerated {
        thread: String,
        result: Result<String, String>,
    },
    SetServiceTier {
        thread: String,
        tier: Option<String>,
    },
    RestartThread {
        thread: String,
    },
    CancelSubagent {
        thread: String,
        child: String,
    },
    LoadMessageImage {
        request: String,
        thread: String,
        entry: String,
        index: u32,
    },
    Shutdown {
        done: std::sync::mpsc::Sender<()>,
    },
}

#[cfg_attr(feature = "ffi", derive(uniffi::Object))]
pub struct Studio {
    commands: mpsc::UnboundedSender<Command>,
    mailbox: Arc<Mailbox>,
    pub(crate) workspace: Workspace,
    _runtime: tokio::runtime::Runtime,
}

#[cfg_attr(feature = "ffi", uniffi::export)]
impl Studio {
    #[cfg_attr(feature = "ffi", uniffi::constructor)]
    pub fn new(config: StudioConfig, waker: Arc<dyn Waker>) -> Result<Arc<Self>, StudioError> {
        let socket = daemon::socket_path(config.socket_path.as_deref());
        let data_dir =
            store::data_dir(config.data_dir.as_deref()).map_err(|message| StudioError::Config { message })?;
        std::fs::create_dir_all(&data_dir)
            .map_err(|error| StudioError::Config { message: format!("create {}: {error}", data_dir.display()) })?;
        let store = Store::open(&data_dir).map_err(|error| StudioError::Config { message: format!("{error:#}") })?;
        let home = store::home_dir().ok_or_else(|| StudioError::Config { message: "HOME is not set".to_string() })?;
        let session_dir = config.session_dir.filter(|value| !value.is_empty()).map(PathBuf::from);
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("local-studio-core")
            .enable_all()
            .build()
            .map_err(|error| StudioError::Runtime { message: error.to_string() })?;
        let mailbox = Arc::new(Mailbox { updates: Mutex::new(Vec::new()), waker });
        let (client_slot, client_watch) = watch::channel(None);
        let query = DaemonQuery::new(client_watch.clone(), session_dir.clone());
        let home = home.to_string_lossy().into_owned();
        let text = TextGen::new(client_watch, session_dir.clone(), home.clone());
        let controller_main = config.controller_main.filter(|value| !value.is_empty()).map(PathBuf::from);
        let workspace = Workspace::new(
            runtime.handle().clone(),
            Arc::clone(&mailbox),
            data_dir,
            daemon::agent_dir(),
            query,
            controller_main,
            text.clone(),
        );
        workspace.start_kernel(daemon::kernel_program(config.launch.as_ref()));
        let settings = workspace.settings();
        let pull_requests = workspace.pull_requests_changed();
        let (commands, receiver) = mpsc::unbounded_channel();
        let adder = commands.clone();
        workspace.set_project_adder(Arc::new(move |path: String| {
            adder.send(Command::AddProject { path }).ok();
        }));
        let reloader = commands.clone();
        workspace.set_models_reloader(Arc::new(move |answer| {
            reloader.send(Command::LoadModels { answer }).ok();
        }));
        let actor = Actor {
            socket,
            session_dir,
            launch: config.launch,
            home,
            mailbox: Arc::clone(&mailbox),
            workspace: workspace.clone(),
            settings,
            pull_requests,
            text,
            itself: commands.clone(),
            client_slot,
            client: None,
            store,
            saved: HashMap::new(),
            roster: HashMap::new(),
            first_seen: HashMap::new(),
            children: HashMap::new(),
            threads: HashMap::new(),
            by_active: HashMap::new(),
            focused: None,
            heads: HashMap::new(),
            models: Vec::new(),
            models_waiting: Vec::new(),
            utility: None,
            titles: HashMap::new(),
            last_rows: None,
            protected: Vec::new(),
            dirty: true,
        };
        runtime.spawn(actor.run(receiver));
        Ok(Arc::new(Self { commands, mailbox, workspace, _runtime: runtime }))
    }

    pub fn tick(&self) -> Vec<Update> {
        self.mailbox.drain()
    }

    pub fn shutdown(&self) {
        self.workspace.shutdown();
        let (done, finished) = std::sync::mpsc::channel();
        if self.commands.send(Command::Shutdown { done }).is_ok() {
            if let Err(error) = finished.recv_timeout(SHUTDOWN_TIMEOUT) {
                self.mailbox.notice(NoticeLevel::Warning, format!("The core did not stop cleanly: {error}"));
            }
        }
    }

    pub fn add_project(&self, path: String) {
        self.send_command(Command::AddProject { path });
    }

    pub fn remove_project(&self, project: String) {
        self.send_command(Command::RemoveProject { project });
    }

    pub fn rename_project(&self, project: String, name: String) {
        self.send_command(Command::RenameProject { project, name });
    }

    pub fn set_project_icon(&self, project: String, icon: Option<String>) {
        self.send_command(Command::SetProjectIcon { project, icon });
    }

    pub fn reorder_projects(&self, projects: Vec<String>) {
        self.send_command(Command::ReorderProjects { projects });
    }

    pub fn select_thread(&self, thread: Option<String>) {
        self.send_command(Command::SelectThread { thread });
    }

    pub fn start_thread(&self, draft: String, project: Option<String>, prompt: PromptDraft, settings: ThreadSettings) {
        self.send_command(Command::StartThread { draft, project, prompt, settings });
    }

    pub fn start_threads(
        &self,
        draft: String,
        project: Option<String>,
        prompt: PromptDraft,
        settings: ThreadSettings,
        models: Vec<ModelKey>,
    ) {
        self.send_command(Command::StartThreads { draft, project, prompt, settings, models });
    }

    pub fn send(&self, request: String, thread: String, prompt: PromptDraft, delivery: Delivery) {
        self.send_command(Command::Send { request, thread, prompt, delivery });
    }

    pub fn abort(&self, thread: String) {
        self.send_command(Command::Abort { thread });
    }

    pub fn send_queued_now(&self, thread: String, queued: String) {
        self.send_command(Command::SendQueuedNow { thread, queued });
    }

    pub fn remove_queued(&self, thread: String, queued: String) {
        self.send_command(Command::RemoveQueued { thread, queued });
    }

    pub fn answer_approval(&self, thread: String, request: String, answer: ApprovalAnswer) {
        self.send_command(Command::AnswerApproval { thread, request, answer });
    }

    pub fn rename_thread(&self, thread: String, title: String) {
        self.send_command(Command::RenameThread { thread, title });
    }

    pub fn delete_thread(&self, thread: String) {
        self.send_command(Command::DeleteThread { thread });
    }

    pub fn set_archived(&self, thread: String, archived: bool) {
        self.send_command(Command::SetArchived { thread, archived });
    }

    pub fn set_pinned(&self, thread: String, pinned: bool) {
        self.send_command(Command::SetPinned { thread, pinned });
    }

    pub fn set_settled(&self, thread: String, settled: bool) {
        self.send_command(Command::SetSettled { thread, settled });
    }

    pub fn snooze(&self, thread: String, until: Option<i64>) {
        self.send_command(Command::Snooze { thread, until });
    }

    pub fn mark_unread(&self, thread: String, unread: bool) {
        self.send_command(Command::MarkUnread { thread, unread });
    }

    pub fn edit_from_here(&self, thread: String, entry: String) {
        self.send_command(Command::EditFromHere { thread, entry });
    }

    pub fn fork_thread(&self, thread: String) {
        self.send_command(Command::ForkThread { thread });
    }

    pub fn compact(&self, thread: String) {
        self.send_command(Command::Compact { thread });
    }

    pub fn set_model(&self, thread: String, provider: String, model: String) {
        self.send_command(Command::SetModel { thread, provider, model });
    }

    pub fn set_thinking_level(&self, thread: String, level: String) {
        self.send_command(Command::SetThinkingLevel { thread, level });
    }

    pub fn set_access_mode(&self, thread: String, mode: AccessMode) {
        self.send_command(Command::SetAccessMode { thread, mode });
    }

    pub fn load_models(&self) {
        self.send_command(Command::LoadModels { answer: None });
    }

    pub fn set_favorite_model(&self, provider: String, model: String, favorite: bool) {
        self.send_command(Command::SetFavoriteModel { provider, model, favorite });
    }

    pub fn list_commands(&self, request: String, project: Option<String>) {
        self.send_command(Command::ListCommands { request, project });
    }

    pub fn list_skills(&self, request: String, project: Option<String>) {
        self.send_command(Command::ListSkills { request, project });
    }

    pub fn list_archived(&self, request: String) {
        self.send_command(Command::ListArchived { request });
    }

    pub fn search_threads(&self, request: String, query: String, limit: u32) {
        self.send_command(Command::SearchThreads { request, query, limit });
    }

    pub fn reorder_pinned(&self, threads: Vec<String>) {
        self.send_command(Command::ReorderPinned { threads });
    }

    pub fn set_auto_settle(&self, thread: String, enabled: bool) {
        self.send_command(Command::SetAutoSettle { thread, enabled });
    }

    pub fn set_hidden_model(&self, provider: String, model: String, hidden: bool) {
        self.send_command(Command::SetHiddenModel { provider, model, hidden });
    }

    pub fn regenerate_title(&self, thread: String) {
        self.send_command(Command::RegenerateTitle { thread });
    }

    pub fn set_service_tier(&self, thread: String, tier: Option<String>) {
        self.send_command(Command::SetServiceTier { thread, tier });
    }

    pub fn restart_thread(&self, thread: String) {
        self.send_command(Command::RestartThread { thread });
    }

    pub fn cancel_subagent(&self, thread: String, child: String) {
        self.send_command(Command::CancelSubagent { thread, child });
    }

    pub fn load_message_image(&self, request: String, thread: String, entry: String, index: u32) {
        self.send_command(Command::LoadMessageImage { request, thread, entry, index });
    }
}

impl Studio {
    fn send_command(&self, command: Command) {
        if self.commands.send(command).is_err() {
            self.mailbox.notice(NoticeLevel::Error, "The Local Studio core has stopped.");
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachData {
    active_session_id: String,
    snapshot: DaemonSessionSnapshot,
}

#[derive(Deserialize)]
struct Messages {
    messages: Vec<AgentMessage>,
}

struct Live {
    active: String,
    seen: u64,
    state: LiveState,
    transcript: Transcript,
    approvals: Vec<(Approval, i64)>,
    sending: Vec<String>,
    shown: HashMap<u64, Vec<Block>>,
}

#[derive(Default)]
struct Thread {
    path: Option<String>,
    cwd: Option<String>,
    live: Option<Live>,
    title: Option<String>,
    prompt: Option<String>,
    run_started_at: Option<i64>,
    failed_at: Option<i64>,
    pending_run: bool,
    reopen: bool,
    ended_by_events: bool,
    allowed_effects: Vec<String>,
    resources: Option<Resources>,
    rlm_children: Vec<Subagent>,
}

struct Actor {
    socket: PathBuf,
    session_dir: Option<PathBuf>,
    launch: Option<DaemonLaunch>,
    home: String,
    mailbox: Arc<Mailbox>,
    workspace: Workspace,
    settings: watch::Receiver<Settings>,
    pull_requests: watch::Receiver<u64>,
    text: TextGen,
    itself: mpsc::UnboundedSender<Command>,
    client_slot: watch::Sender<Option<DaemonClient>>,
    client: Option<DaemonClient>,
    store: Store,
    saved: HashMap<String, SavedRow>,
    roster: HashMap<String, RosterRow>,
    first_seen: HashMap<String, i64>,
    children: HashMap<String, ChildRow>,
    threads: HashMap<String, Thread>,
    by_active: HashMap<String, String>,
    focused: Option<String>,
    heads: HashMap<String, GitHead>,
    models: Vec<ModelOption>,
    models_waiting: Vec<Option<(String, String)>>,
    utility: Option<String>,
    titles: HashMap<String, String>,
    last_rows: Option<Vec<ThreadRow>>,
    protected: Vec<String>,
    dirty: bool,
}

async fn next_event(events: &mut Option<mpsc::UnboundedReceiver<DaemonClientEvent>>) -> Option<DaemonClientEvent> {
    match events {
        Some(receiver) => receiver.recv().await,
        None => std::future::pending().await,
    }
}

async fn reader_died(dead: &mut Option<watch::Receiver<bool>>) {
    let Some(receiver) = dead else { return std::future::pending().await };
    loop {
        if *receiver.borrow() {
            return;
        }
        if receiver.changed().await.is_err() {
            return;
        }
    }
}

async fn wait_until(at: Option<Instant>) {
    match at {
        Some(at) => tokio::time::sleep_until(at).await,
        None => std::future::pending().await,
    }
}

impl Actor {
    async fn run(mut self, mut commands: mpsc::UnboundedReceiver<Command>) {
        self.push_projects();
        let mut events = None;
        let mut dead = None;
        let mut retry_at = Some(Instant::now());
        let mut settings_open = true;
        let mut pulls_open = true;
        let mut timer = tokio::time::interval(TIMER_PERIOD);
        loop {
            if self.client.is_none() && retry_at.is_some_and(|at| at <= Instant::now()) {
                self.mailbox.push(Update::Connection { state: Connection::Connecting });
                match daemon::connect(&self.socket, self.launch.as_ref()).await {
                    Ok((client, receiver)) => {
                        dead = Some(client.reader_dead());
                        events = Some(receiver);
                        retry_at = None;
                        self.connected(client).await;
                    }
                    Err(error) => {
                        self.mailbox
                            .push(Update::Connection { state: Connection::Lost { reason: format!("{error:#}") } });
                        retry_at = Some(Instant::now() + RECONNECT_DELAY);
                    }
                }
                self.flush();
                continue;
            }
            tokio::select! {
                command = commands.recv() => match command {
                    Some(Command::Shutdown { done }) => {
                        self.stop(&done).await;
                        return;
                    }
                    Some(command) => self.handle(command).await,
                    None => return,
                },
                event = next_event(&mut events) => if let Some(event) = event {
                    self.event(event).await;
                    for _ in 0..EVENT_BURST {
                        let Some(receiver) = events.as_mut() else { break };
                        let Ok(event) = receiver.try_recv() else { break };
                        self.event(event).await;
                    }
                } else {
                    events = None;
                    dead = None;
                    self.disconnected();
                    retry_at = Some(Instant::now() + RECONNECT_DELAY);
                },
                () = reader_died(&mut dead) => {
                    events = None;
                    dead = None;
                    self.disconnected();
                    retry_at = Some(Instant::now() + RECONNECT_DELAY);
                }
                () = wait_until(retry_at) => {}
                _ = timer.tick() => self.on_timer(),
                changed = self.settings.changed(), if settings_open => {
                    if changed.is_err() {
                        settings_open = false;
                    }
                    self.dirty = true;
                }
                changed = self.pull_requests.changed(), if pulls_open => {
                    if changed.is_err() {
                        pulls_open = false;
                    }
                    self.dirty = true;
                }
            }
            self.flush();
        }
    }

    async fn connected(&mut self, client: DaemonClient) {
        self.client = Some(client.clone());
        self.client_slot.send_replace(Some(client.clone()));
        self.mailbox.push(Update::Connection { state: Connection::Ready });
        let version = Some(client.daemon_build().version.to_string()).filter(|version| !version.is_empty());
        let pid = client.hello().get("supervisorPid").and_then(Value::as_u64).and_then(|pid| u32::try_from(pid).ok());
        self.mailbox.push(Update::Daemon { socket: self.socket.to_string_lossy().into_owned(), version, pid });
        if client.supports_server_capability("agent_roster") {
            match client.request_ok(DaemonCommand::RosterSubscribe { id: None, rest: Map::default() }).await {
                Ok(data) => self.roster_changed(data.get("roster").cloned().unwrap_or_default(), &[], true, false),
                Err(error) => self.mailbox.notice(NoticeLevel::Warning, format!("{error:#}")),
            }
        }
        self.refresh_saved().await;
        let mut reopen: Vec<String> =
            self.threads.iter().filter(|(_, thread)| thread.reopen).map(|(id, _)| id.clone()).collect();
        if let Some(focused) = self.focused.clone() {
            if !reopen.contains(&focused) {
                reopen.push(focused);
            }
        }
        for id in reopen {
            if let Some(thread) = self.threads.get_mut(&id) {
                thread.reopen = false;
            }
            if let Err(error) = self.ensure_open(&id).await {
                self.mailbox.notice(NoticeLevel::Error, error);
            }
        }
        let waiting = std::mem::take(&mut self.models_waiting);
        if !waiting.is_empty() {
            self.fetch_models().await;
            for (request, message) in waiting.into_iter().flatten() {
                self.mailbox.push(Update::RequestDone { request, message });
            }
        }
        self.dirty = true;
    }

    fn disconnected(&mut self) {
        self.client = None;
        self.client_slot.send_replace(None);
        self.by_active.clear();
        self.utility = None;
        self.roster.clear();
        for thread in self.threads.values_mut() {
            if let Some(live) = thread.live.take() {
                thread.reopen = live.state.busy || thread.pending_run;
            }
        }
        if let Some(focused) = self.focused.clone() {
            self.mailbox.push(Update::Approvals { thread: focused, approvals: Vec::new() });
        }
        self.mailbox
            .push(Update::Connection { state: Connection::Lost { reason: "The Eukhe daemon stopped.".to_string() } });
        self.dirty = true;
    }

    async fn stop(&mut self, done: &std::sync::mpsc::Sender<()>) {
        if let Some(client) = self.client.clone() {
            for live in self.threads.values().filter_map(|thread| thread.live.as_ref()) {
                let detach = DaemonCommand::Detach {
                    id: None,
                    active_session_id: Some(live.active.clone()),
                    reason: None,
                    rest: Map::default(),
                };
                if let Err(error) = client.request_ok(detach).await {
                    self.mailbox.notice(NoticeLevel::Warning, format!("{error:#}"));
                }
            }
            client.close();
        }
        if done.send(()).is_err() {
            self.mailbox.notice(NoticeLevel::Warning, "The core stopped after its caller stopped waiting.");
        }
    }

    fn on_timer(&mut self) {
        let now = now_ms();
        let woke: Vec<(String, i64)> = self
            .store
            .threads
            .iter()
            .filter_map(|(id, flags)| {
                flags.snoozed_until.filter(|until| *until <= now).map(|until| (id.clone(), until))
            })
            .collect();
        for (id, until) in &woke {
            self.store.update(id, |flags| {
                flags.snoozed_until = None;
                flags.woke_at = Some(*until);
            });
        }
        if !woke.is_empty() {
            self.save();
        }
        self.dirty = true;
    }

    #[allow(clippy::too_many_lines)]
    async fn handle(&mut self, command: Command) {
        match command {
            Command::AddProject { path } => self.add_project(&path),
            Command::RemoveProject { project } => {
                let Some(path) = self.store.project_id(&project) else {
                    self.mailbox.notice(NoticeLevel::Error, format!("Unknown project {project}."));
                    return;
                };
                self.store.projects.retain(|known| known.path != path);
                self.projects_changed();
            }
            Command::RenameProject { project, name } => {
                let name = name.trim().to_string();
                if name.is_empty() {
                    self.mailbox.notice(NoticeLevel::Warning, "A project needs a name.");
                    return;
                }
                self.edit_project(&project, |known| known.name = name);
            }
            Command::SetProjectIcon { project, icon } => {
                self.edit_project(&project, |known| known.icon = icon.filter(|icon| !icon.trim().is_empty()));
            }
            Command::ReorderProjects { projects } => {
                let mut ordered = Vec::with_capacity(self.store.projects.len());
                for path in &projects {
                    if let Some(index) = self.store.projects.iter().position(|known| &known.path == path) {
                        ordered.push(self.store.projects.remove(index));
                    }
                }
                ordered.append(&mut self.store.projects);
                self.store.projects = ordered;
                self.projects_changed();
            }
            Command::SelectThread { thread } => self.select(thread).await,
            Command::StartThread { draft, project, prompt, settings } => {
                self.start_thread(&draft, project, prompt, settings, None).await;
            }
            Command::StartThreads { draft, project, prompt, settings, models } => {
                self.start_threads(&draft, project, prompt, settings, models).await;
            }
            Command::Send { request, thread, prompt, delivery } => {
                if let Err(message) = self.send_prompt(&thread, prompt, delivery).await {
                    self.mailbox.push(Update::RequestFailed { request, message });
                }
            }
            Command::Abort { thread } => {
                let Some(active) = self.live_active(&thread) else {
                    self.mailbox.notice(NoticeLevel::Info, "That thread is not running.");
                    return;
                };
                self.report(
                    self.call(DaemonCommand::Abort { id: None, active_session_id: active, rest: Map::default() }).await,
                );
            }
            Command::SendQueuedNow { thread, queued } => self.send_queued_now(&thread, &queued).await,
            Command::RemoveQueued { thread, queued } => self.remove_queued(&thread, &queued).await,
            Command::AnswerApproval { thread, request, answer } => self.answer(&thread, request, answer).await,
            Command::RenameThread { thread, title } => self.rename(&thread, &title).await,
            Command::DeleteThread { thread } => self.delete(&thread).await,
            Command::SetArchived { thread, archived } => self.flag(&thread, |flags, _| flags.archived = archived),
            Command::SetPinned { thread, pinned } => {
                self.flag(&thread, |flags, now| flags.pin_order = pinned.then_some(now));
            }
            Command::SetSettled { thread, settled } => self.flag(&thread, |flags, now| {
                if settled {
                    flags.settled_at = Some(now);
                    flags.unsettled_at = None;
                } else {
                    flags.settled_at = None;
                    flags.unsettled_at = Some(now);
                }
            }),
            Command::Snooze { thread, until } => self.flag(&thread, |flags, _| {
                flags.snoozed_until = until;
                flags.woke_at = None;
            }),
            Command::MarkUnread { thread, unread } => self.flag(&thread, |flags, now| {
                flags.unread = unread;
                flags.done_at = unread.then_some(now);
            }),
            Command::EditFromHere { thread, entry } => {
                if let Err(error) = self.edit_from_here(&thread, entry).await {
                    self.mailbox.notice(NoticeLevel::Error, error);
                }
            }
            Command::ForkThread { thread } => {
                if let Err(error) = self.fork(&thread).await {
                    self.mailbox.notice(NoticeLevel::Error, error);
                }
            }
            Command::Compact { thread } => match self.ensure_open(&thread).await {
                Ok(active) => {
                    let command = DaemonCommand::Compact {
                        id: None,
                        active_session_id: active,
                        custom_instructions: None,
                        rest: Map::default(),
                    };
                    self.report(self.call(command).await);
                }
                Err(error) => self.mailbox.notice(NoticeLevel::Error, error),
            },
            Command::SetModel { thread, provider, model } => {
                if let Err(error) = self.apply_model(&thread, Some(provider), Some(model), None).await {
                    self.mailbox.notice(NoticeLevel::Error, error);
                }
            }
            Command::SetThinkingLevel { thread, level } => {
                if let Err(error) = self.apply_model(&thread, None, None, Some(level)).await {
                    self.mailbox.notice(NoticeLevel::Error, error);
                }
            }
            Command::SetAccessMode { thread, mode } => {
                if !self.known(&thread) {
                    self.mailbox.notice(NoticeLevel::Error, format!("Unknown thread {thread}."));
                    return;
                }
                self.store.update(&thread, |flags| flags.access = Some(mode));
                self.save();
                if let Some(active) = self.live_active(&thread) {
                    if let Err(error) = self.apply_access(&thread, &active).await {
                        self.mailbox.notice(NoticeLevel::Error, error);
                    }
                }
                self.emit_info(&thread);
            }
            Command::LoadModels { answer } if self.client.is_none() => self.models_waiting.push(answer),
            Command::LoadModels { answer } => self.load_models(answer).await,
            Command::SetFavoriteModel { provider, model, favorite } => {
                toggle_key(&mut self.store.favorites, ModelKey { provider, model }, favorite);
                self.save();
                self.push_models();
            }
            Command::SetHiddenModel { provider, model, hidden } => {
                toggle_key(&mut self.store.hidden, ModelKey { provider, model }, hidden);
                self.save();
                self.push_models();
            }
            Command::ListCommands { request, project } => {
                let update = match self.project_resources(project).await {
                    Ok(resources) => Update::Commands { request, commands: resources.commands() },
                    Err(message) => Update::RequestFailed { request, message },
                };
                self.mailbox.push(update);
            }
            Command::ListSkills { request, project } => {
                let update = match self.project_resources(project).await {
                    Ok(resources) => Update::Skills { request, skills: resources.skills() },
                    Err(message) => Update::RequestFailed { request, message },
                };
                self.mailbox.push(update);
            }
            Command::ListArchived { request } => {
                let threads = self.rows(true);
                self.mailbox.push(Update::ArchivedThreads { request, threads });
            }
            Command::SearchThreads { request, query, limit } => self.search_threads(request, &query, limit),
            Command::ReorderPinned { threads } => {
                for (rank, thread) in threads.iter().enumerate() {
                    let rank = i64::try_from(rank).unwrap_or(i64::MAX).saturating_add(1);
                    if self.store.flags(thread).pin_order.is_some() {
                        self.store.update(thread, |flags| flags.pin_order = Some(rank));
                    }
                }
                self.save();
                self.dirty = true;
            }
            Command::SetAutoSettle { thread, enabled } => {
                self.flag(&thread, |flags, _| flags.auto_settle_disabled = !enabled);
            }
            Command::RegenerateTitle { thread } => {
                if let Err(error) = self.regenerate_title(&thread).await {
                    self.mailbox.notice(NoticeLevel::Error, format!("Could not regenerate the title: {error}"));
                }
            }
            Command::TitleGenerated { thread, result } => match result.map(|answer| clean_generated_title(&answer)) {
                Ok(Some(title)) => self.rename(&thread, &title).await,
                Ok(None) => self.mailbox.notice(NoticeLevel::Warning, "The model returned no usable title."),
                Err(error) => {
                    self.mailbox.notice(NoticeLevel::Error, format!("Could not regenerate the title: {error}"));
                }
            },
            Command::SetServiceTier { thread, tier } => {
                if let Err(error) = self.set_service_tier(&thread, tier).await {
                    self.mailbox.notice(NoticeLevel::Error, error);
                }
            }
            Command::RestartThread { thread } => {
                if let Err(error) = self.restart_thread(&thread).await {
                    self.mailbox.notice(NoticeLevel::Error, format!("Could not restart the thread: {error}"));
                }
            }
            Command::CancelSubagent { thread, child } => {
                let result = match self.live_active(&thread) {
                    Some(active) => {
                        self.call(DaemonCommand::CancelRlmChild {
                            id: None,
                            active_session_id: active,
                            child_id: child,
                            rest: Map::default(),
                        })
                        .await
                    }
                    None => Err("That thread is not open.".to_string()),
                };
                self.report(result);
                self.refresh_subagents(&thread).await;
            }
            Command::LoadMessageImage { request, thread, entry, index } => {
                let update = match self.message_image(&thread, &entry, index).await {
                    Ok((mime_type, data)) => Update::MessageImage { request, mime_type, data },
                    Err(message) => Update::RequestFailed { request, message },
                };
                self.mailbox.push(update);
            }
            Command::Shutdown { done } => self.stop(&done).await,
        }
    }

    fn add_project(&mut self, path: &str) {
        let canonical = match std::fs::canonicalize(path) {
            Ok(canonical) if canonical.is_dir() => canonical,
            Ok(_) => {
                self.mailbox.notice(NoticeLevel::Error, format!("{path} is not a folder."));
                return;
            }
            Err(error) => {
                self.mailbox.notice(NoticeLevel::Error, format!("Cannot add {path}: {error}"));
                return;
            }
        };
        let path = canonical.to_string_lossy().into_owned();
        if self.store.projects.iter().any(|known| known.path == path) {
            self.mailbox.notice(NoticeLevel::Info, format!("{path} is already a project."));
            return;
        }
        let name = canonical.file_name().map_or_else(|| path.clone(), |name| name.to_string_lossy().into_owned());
        self.store.projects.push(StoredProject { path, name, icon: None });
        self.projects_changed();
    }

    fn edit_project(&mut self, project: &str, change: impl FnOnce(&mut StoredProject)) {
        let Some(path) = self.store.project_id(project) else {
            self.mailbox.notice(NoticeLevel::Error, format!("Unknown project {project}."));
            return;
        };
        let Some(known) = self.store.projects.iter_mut().find(|known| known.path == path) else { return };
        change(known);
        self.projects_changed();
    }

    fn projects_changed(&mut self) {
        self.save();
        self.push_projects();
        self.dirty = true;
    }

    fn push_projects(&self) {
        let projects = self.store.projects.iter().map(threads::project_record).collect();
        self.mailbox.push(Update::Projects { projects });
        self.workspace.watch_projects(self.store.projects.iter().map(|project| project.path.clone()).collect());
    }

    fn flag(&mut self, thread: &str, change: impl FnOnce(&mut store::ThreadFlags, i64)) {
        if !self.known(thread) {
            self.mailbox.notice(NoticeLevel::Error, format!("Unknown thread {thread}."));
            return;
        }
        let now = now_ms();
        self.store.update(thread, |flags| change(flags, now));
        self.save();
        self.dirty = true;
    }

    fn push_models(&self) {
        self.mailbox.push(Update::Models {
            models: self.models.clone(),
            favorites: self.store.favorites.clone(),
            hidden: self.store.hidden.clone(),
        });
    }

    fn search_threads(&mut self, request: String, query: &str, limit: u32) {
        let rows = self.rows(false);
        let docs: Vec<SearchDoc> = rows
            .into_iter()
            .map(|row| SearchDoc {
                text: self.saved.get(&row.id).map_or_else(|| Arc::from(""), |saved| Arc::clone(&saved.text)),
                thread: row.id,
                title: row.title,
                project: row.project,
            })
            .collect();
        let query = query.to_string();
        let limit = usize::try_from(limit).unwrap_or(usize::MAX);
        let mailbox = Arc::clone(&self.mailbox);
        tokio::task::spawn_blocking(move || {
            let hits = threads::search(&docs, &query, limit);
            mailbox.push(Update::ThreadSearch { request, hits });
        });
    }

    fn save(&self) {
        if let Err(error) = self.store.save() {
            self.mailbox.notice(NoticeLevel::Error, format!("Could not save Local Studio state: {error:#}"));
        }
    }

    fn note_user_at(&mut self, id: &str, at: Option<i64>) {
        let Some(at) = at else { return };
        if self.store.activity_at(id).is_some_and(|known| known >= at) {
            return;
        }
        self.store.update(id, |flags| flags.activity_at = Some(at));
        self.save();
        self.dirty = true;
    }

    async fn select(&mut self, thread: Option<String>) {
        if let Some(id) = thread.as_deref() {
            if !self.known(id) {
                self.mailbox.notice(NoticeLevel::Error, format!("Unknown thread {id}."));
                return;
            }
        }
        let previous = std::mem::replace(&mut self.focused, thread.clone());
        if let Some(previous) = previous.filter(|previous| Some(previous) != thread.as_ref()) {
            self.release(&previous).await;
        }
        let Some(id) = thread else { return };
        self.store.update(&id, |flags| {
            flags.unread = false;
            flags.done_at = None;
            flags.woke_at = None;
        });
        self.save();
        self.dirty = true;
        if self.client.is_none() {
            return;
        }
        match self.ensure_open(&id).await {
            Ok(_) => {
                self.emit_focus(&id);
                self.refresh_subagents(&id).await;
            }
            Err(error) => self.mailbox.notice(NoticeLevel::Error, error),
        }
    }

    fn emit_focus(&self, id: &str) {
        let Some(live) = self.threads.get(id).and_then(|thread| thread.live.as_ref()) else { return };
        if let Some(info) = self.info(id) {
            self.mailbox.push(Update::Thread { thread: id.to_string(), info });
        }
        self.mailbox.push(Update::Transcript {
            thread: id.to_string(),
            op: crate::model::TranscriptOp::Reset { items: live.transcript.items().to_vec() },
        });
        self.emit_approvals(id);
        self.emit_queue(id);
    }

    fn emit_info(&self, id: &str) {
        if self.focused.as_deref() != Some(id) {
            return;
        }
        if let Some(info) = self.info(id) {
            self.mailbox.push(Update::Thread { thread: id.to_string(), info });
        }
    }

    fn emit_approvals(&self, id: &str) {
        let approvals = self
            .threads
            .get(id)
            .and_then(|thread| thread.live.as_ref())
            .map(|live| live.approvals.iter().map(|(approval, _)| approval.clone()).collect())
            .unwrap_or_default();
        self.mailbox.push(Update::Approvals { thread: id.to_string(), approvals });
    }

    fn emit_queue(&self, id: &str) {
        let queued = self
            .threads
            .get(id)
            .and_then(|thread| thread.live.as_ref())
            .map(|live| live.state.queue.messages(&live.sending))
            .unwrap_or_default();
        self.mailbox.push(Update::Queue { thread: id.to_string(), queued });
    }

    fn info(&self, id: &str) -> Option<ThreadInfo> {
        let thread = self.threads.get(id)?;
        let live = thread.live.as_ref()?;
        let flags = self.store.flags(id);
        let mut info = live.state.info(id, self.title(id), flags.access.unwrap_or(AccessMode::FullAccess));
        info.project = threads::project_for(&live.state.cwd, &flags, &self.store.projects);
        let running = self.running(id);
        info.busy = running;
        info.run_started_at = if running { thread.run_started_at } else { None };
        let head = threads::git_head(&live.state.cwd);
        info.branch = head.branch;
        info.worktree = head.worktree;
        Some(info)
    }

    fn title(&self, id: &str) -> String {
        let thread = self.threads.get(id);
        let roster = self.roster_for(id);
        thread
            .and_then(|thread| thread.title.clone())
            .or_else(|| thread.and_then(|thread| thread.live.as_ref()).and_then(|live| live.state.name.clone()))
            .or_else(|| roster.and_then(|row| row.title.clone()))
            .or_else(|| self.saved.get(id).and_then(|row| row.title.clone()))
            .or_else(|| {
                thread.and_then(|thread| thread.live.as_ref()).and_then(|live| live.transcript.first_user_text())
            })
            .or_else(|| thread.and_then(|thread| thread.prompt.clone()))
            .map(|title| threads::clean_title(&title))
            .filter(|title| !title.is_empty())
            .unwrap_or_else(|| NEW_THREAD_TITLE.to_string())
    }

    fn roster_for(&self, id: &str) -> Option<&RosterRow> {
        self.roster.values().find(|row| row.session_id == id)
    }

    fn known(&self, id: &str) -> bool {
        self.threads.contains_key(id) || self.saved.contains_key(id) || self.roster_for(id).is_some()
    }

    fn live_active(&self, id: &str) -> Option<String> {
        self.threads.get(id).and_then(|thread| thread.live.as_ref()).map(|live| live.active.clone())
    }

    fn create_config(&self, cwd: &str) -> Value {
        let mut config = json!({ "cwd": cwd });
        if let Some(dir) = &self.session_dir {
            config["sessionDir"] = Value::String(dir.to_string_lossy().into_owned());
        }
        config
    }

    async fn call(&self, command: DaemonCommand) -> Result<Value, String> {
        let Some(client) = self.client.clone() else {
            return Err("Not connected to the Eukhe daemon yet.".to_string());
        };
        client.request_ok(command).await.map_err(|error| format!("{error:#}"))
    }

    fn report(&self, result: Result<Value, String>) {
        if let Err(error) = result {
            self.mailbox.notice(NoticeLevel::Error, error);
        }
    }

    async fn ensure_open(&mut self, id: &str) -> Result<String, String> {
        if let Some(active) = self.live_active(id) {
            return Ok(active);
        }
        let client = self.client.clone().ok_or_else(|| "Not connected to the Eukhe daemon yet.".to_string())?;
        let thread = self.threads.get(id);
        let roster = self.roster_for(id);
        let path = thread
            .and_then(|thread| thread.path.clone())
            .or_else(|| self.saved.get(id).map(|row| row.path.clone()))
            .or_else(|| roster.and_then(|row| row.session_file.clone()))
            .ok_or_else(|| format!("The session file of thread {id} is unknown."))?;
        let cwd = thread
            .and_then(|thread| thread.cwd.clone())
            .or_else(|| roster.map(|row| row.cwd.clone()))
            .or_else(|| self.saved.get(id).map(|row| row.cwd.clone()))
            .filter(|cwd| !cwd.is_empty())
            .unwrap_or_else(|| self.home.clone());
        let created = saved_sessions::create_resident(&client, Some(path.clone()), self.create_config(&cwd))
            .await
            .map_err(|error| format!("{error:#}"))?;
        let entry = self.threads.entry(id.to_string()).or_default();
        entry.path = Some(created.session_file);
        entry.cwd = Some(cwd);
        self.attach(id, &created.active_session_id).await?;
        Ok(created.active_session_id)
    }

    async fn attach(&mut self, id: &str, active: &str) -> Result<(), String> {
        let client = self.client.clone().ok_or_else(|| "Not connected to the Eukhe daemon yet.".to_string())?;
        let data = saved_sessions::attach(&client, active, DaemonClientKind::Interactive)
            .await
            .map_err(|error| format!("{error:#}"))?;
        let attach = AttachData::deserialize(&data).map_err(|error| format!("Unreadable session snapshot: {error}"))?;
        let mut state = LiveState::default();
        state.merge(&attach.snapshot.state);
        if let Some(notice) = attach.snapshot.state.get("kernelUnavailable").and_then(Value::as_str) {
            if eukhe_types::platform::agent_dir().is_none_or(|dir| eukhe_types::kernel_notice::first_showing(&dir)) {
                self.mailbox.notice(NoticeLevel::Warning, notice.to_string());
            }
        }
        let mut transcript = Transcript::default();
        transcript.reset(&attach.snapshot.messages, state.busy);
        let settled = transcript.take_settled();
        let thread = self.threads.entry(id.to_string()).or_default();
        if let Some(old) = thread.live.take() {
            self.by_active.remove(&old.active);
        }
        if let Some(file) = state.session_file.clone() {
            thread.path = Some(file);
        }
        if !state.cwd.is_empty() {
            thread.cwd = Some(state.cwd.clone());
        }
        if state.busy {
            thread.run_started_at = thread.run_started_at.or_else(|| transcript.last_user_at()).or(Some(now_ms()));
        }
        let last_user_at = transcript.last_user_at();
        thread.resources = None;
        thread.live = Some(Live {
            active: attach.active_session_id.clone(),
            seen: attach.snapshot.last_event_sequence,
            state,
            transcript,
            approvals: Vec::new(),
            sending: Vec::new(),
            shown: HashMap::new(),
        });
        self.by_active.insert(attach.active_session_id.clone(), id.to_string());
        self.note_user_at(id, last_user_at);
        for turn in settled.into_iter().filter(|turn| !turn.files.is_empty()) {
            self.workspace.record_turn_files(id.to_string(), turn.turn, turn.files);
        }
        let allowed = self.threads.get(id).is_some_and(|thread| !thread.allowed_effects.is_empty());
        if self.store.flags(id).access.is_some() || allowed {
            if let Err(error) = self.apply_access(id, &attach.active_session_id).await {
                self.mailbox.notice(NoticeLevel::Warning, error);
            }
        }
        self.fetch_entries(id, false).await;
        if self.focused.as_deref() == Some(id) {
            self.emit_focus(id);
        }
        self.dirty = true;
        Ok(())
    }

    async fn fetch_entries(&mut self, id: &str, emit: bool) {
        let Some(active) = self.live_active(id) else { return };
        let command =
            DaemonCommand::GetUserMessagesForForking { id: None, active_session_id: active, rest: Map::default() };
        let data = match self.call(command).await {
            Ok(data) => data,
            Err(error) => {
                self.mailbox.notice(NoticeLevel::Warning, error);
                return;
            }
        };
        let entries: Vec<(String, String)> = data
            .get("messages")
            .and_then(Value::as_array)
            .map(|messages| {
                messages
                    .iter()
                    .filter_map(|message| {
                        Some((
                            message.get("entryId")?.as_str()?.to_string(),
                            message.get("text").and_then(Value::as_str).unwrap_or_default().to_string(),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let focused = self.focused.as_deref() == Some(id);
        let Some(live) = self.threads.get_mut(id).and_then(|thread| thread.live.as_mut()) else { return };
        let ops = live.transcript.set_entries(&entries);
        if emit && focused {
            for op in ops {
                self.mailbox.push(Update::Transcript { thread: id.to_string(), op });
            }
        }
    }

    async fn release(&mut self, id: &str) {
        if self.focused.as_deref() == Some(id) {
            return;
        }
        let Some(thread) = self.threads.get(id) else { return };
        let Some(live) = thread.live.as_ref() else { return };
        if live.state.busy
            || thread.pending_run
            || live.state.queue.len() > 0
            || !live.approvals.is_empty()
            || self.titles.values().any(|title| title == id)
        {
            return;
        }
        let active = live.active.clone();
        let detach = DaemonCommand::Detach {
            id: None,
            active_session_id: Some(active.clone()),
            reason: Some(DetachReason::Switch),
            rest: Map::default(),
        };
        if let Err(error) = self.call(detach).await {
            self.mailbox.notice(NoticeLevel::Warning, error);
        }
        self.by_active.remove(&active);
        if let Some(thread) = self.threads.get_mut(id) {
            thread.live = None;
        }
    }

    async fn apply_access(&self, id: &str, active: &str) -> Result<(), String> {
        let mode = self.store.flags(id).access.unwrap_or(AccessMode::FullAccess);
        let mut effects: Vec<String> = access_effects(mode).iter().map(|effect| (*effect).to_string()).collect();
        for effect in self.threads.get(id).map(|thread| thread.allowed_effects.as_slice()).unwrap_or_default() {
            if !effects.contains(effect) {
                effects.push(effect.clone());
            }
        }
        let list = effects.join(",");
        let command = DaemonCommand::Cvar {
            id: None,
            active_session_id: active.to_string(),
            line: format!("set shell.autoEffects {list}"),
            global: false,
            rest: Map::default(),
        };
        let client = self.client.clone().ok_or_else(|| "Not connected to the Eukhe daemon yet.".to_string())?;
        let response =
            client.request(command).await.map_err(|error| format!("Could not set the access mode: {error:#}"))?;
        if response.success {
            return Ok(());
        }
        let reason = response
            .data
            .as_ref()
            .and_then(|data| data.get("message"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .or(response.error)
            .unwrap_or_else(|| "the daemon refused it".to_string());
        Err(format!("Could not set the access mode: {reason}"))
    }

    async fn start_thread(
        &mut self,
        draft: &str,
        project: Option<String>,
        prompt: PromptDraft,
        settings: ThreadSettings,
        fan_out: Option<String>,
    ) {
        match self.create_thread(draft, project, settings, fan_out, &prompt.text).await {
            Ok(id) => {
                if let Err(error) = self.send_prompt(&id, prompt, Delivery::Queue).await {
                    self.mailbox.notice(NoticeLevel::Error, error);
                }
            }
            Err(message) => self.mailbox.push(Update::RequestFailed { request: draft.to_string(), message }),
        }
    }

    async fn create_thread(
        &mut self,
        draft: &str,
        project: Option<String>,
        settings: ThreadSettings,
        fan_out: Option<String>,
        prompt: &str,
    ) -> Result<String, String> {
        let client = self.client.clone().ok_or_else(|| "Not connected to the Eukhe daemon yet.".to_string())?;
        let project_path = match &project {
            Some(project) => Some(self.store.project_id(project).ok_or_else(|| format!("Unknown project {project}."))?),
            None => None,
        };
        let effective = self.workspace.effective_settings(project_path.as_deref());
        let choice = match settings.worktree {
            WorktreeChoice::Default => match effective.new_thread_workspace {
                NewThreadWorkspace::Local => WorktreeChoice::Local,
                NewThreadWorkspace::Worktree => {
                    WorktreeChoice::NewWorktree { branch: format!("local-studio/{}", now_ms()), base: None }
                }
            },
            other => other,
        };
        let cwd = match (&choice, &project_path) {
            (WorktreeChoice::Existing { path }, _) => path.clone(),
            (WorktreeChoice::NewWorktree { branch, base }, Some(project)) => {
                match self.workspace.prepare_worktree(draft, Path::new(project), branch, base.as_deref()).await? {
                    PreparedWorktree::Worktree(path) => path.to_string_lossy().into_owned(),
                    PreparedWorktree::Local => project.clone(),
                }
            }
            (WorktreeChoice::NewWorktree { .. }, None) => {
                return Err("A new worktree needs a project.".to_string());
            }
            (WorktreeChoice::Local | WorktreeChoice::Default, Some(project)) => project.clone(),
            (WorktreeChoice::Local | WorktreeChoice::Default, None) => self.home.clone(),
        };
        let created = saved_sessions::create_resident(&client, None, self.create_config(&cwd))
            .await
            .map_err(|error| format!("{error:#}"))?;
        let id = created.session_id.clone();
        self.threads.insert(
            id.clone(),
            Thread {
                path: Some(created.session_file.clone()),
                cwd: Some(cwd),
                pending_run: true,
                prompt: Some(prompt.to_string()),
                ..Thread::default()
            },
        );
        let now = now_ms();
        self.store.update(&id, |flags| {
            flags.activity_at = Some(now);
            flags.project.clone_from(&project_path);
            flags.access = Some(settings.access);
            flags.fan_out = fan_out;
        });
        self.save();
        self.attach(&id, &created.active_session_id).await?;
        let provider = settings.provider.or(effective.default_provider);
        let model = settings.model.or(effective.default_model);
        let thinking = settings.thinking_level.or(effective.default_thinking_level);
        if (provider.is_some() && model.is_some()) || thinking.is_some() {
            if let Err(error) = self.apply_model(&id, provider, model, thinking).await {
                self.mailbox.notice(NoticeLevel::Warning, error);
            }
        }
        self.mailbox.push(Update::ThreadStarted { draft: draft.to_string(), thread: id.clone() });
        self.dirty = true;
        Ok(id)
    }

    async fn start_threads(
        &mut self,
        draft: &str,
        project: Option<String>,
        prompt: PromptDraft,
        settings: ThreadSettings,
        models: Vec<ModelKey>,
    ) {
        if models.is_empty() {
            self.start_thread(draft, project, prompt, settings, None).await;
            return;
        }
        let base = match &settings.worktree {
            WorktreeChoice::NewWorktree { base, .. } => base.clone(),
            WorktreeChoice::Local | WorktreeChoice::Existing { .. } | WorktreeChoice::Default => None,
        };
        let group = format!("fanout-{}", now_ms());
        for (index, key) in models.into_iter().enumerate() {
            let member = if index == 0 { draft.to_string() } else { format!("{draft}#{index}") };
            let branch =
                format!("local-studio/{group}-{index}-{}", branch_slug(&format!("{}-{}", key.provider, key.model)));
            let member_settings = ThreadSettings {
                provider: Some(key.provider),
                model: Some(key.model),
                thinking_level: settings.thinking_level.clone(),
                access: settings.access,
                worktree: if project.is_some() {
                    WorktreeChoice::NewWorktree { branch, base: base.clone() }
                } else {
                    WorktreeChoice::Local
                },
            };
            self.start_thread(&member, project.clone(), prompt.clone(), member_settings, Some(group.clone())).await;
        }
    }

    async fn send_prompt(&mut self, id: &str, prompt: PromptDraft, delivery: Delivery) -> Result<(), String> {
        if !self.known(id) {
            return Err(format!("Unknown thread {id}."));
        }
        let message = prompt_text(&prompt);
        if message.trim().is_empty() && prompt.images.is_empty() {
            return Err("Write a message first.".to_string());
        }
        let active = self.ensure_open(id).await?;
        let message = if message.starts_with('/') || message.contains('$') {
            self.resources(id, &active).await.expand(&message)
        } else {
            message
        };
        let images = (!prompt.images.is_empty()).then(|| {
            Value::Array(
                prompt
                    .images
                    .iter()
                    .map(|image| {
                        json!({ "type": "image", "data": images::encode_base64(&image.data), "mimeType": image.mime_type })
                    })
                    .collect(),
            )
        });
        let delivery = match delivery {
            Delivery::Default => {
                let project = self.thread_project(id);
                match self.workspace.effective_settings(project.as_deref()).follow_up_behavior {
                    FollowUpBehavior::Queue => Delivery::Queue,
                    FollowUpBehavior::Steer => Delivery::Steer,
                }
            }
            explicit => explicit,
        };
        let behavior = match delivery {
            Delivery::Steer => StreamingBehavior::Steer,
            Delivery::Queue | Delivery::Default => StreamingBehavior::FollowUp,
        };
        if let Some(thread) = self.threads.get_mut(id) {
            thread.pending_run = true;
            if thread.run_started_at.is_none() {
                thread.run_started_at = Some(now_ms());
            }
        }
        self.emit_info(id);
        self.store.update(id, |flags| {
            flags.settled_at = None;
            flags.unread = false;
            flags.done_at = None;
        });
        self.save();
        self.dirty = true;
        let command = DaemonCommand::Prompt {
            id: None,
            active_session_id: active,
            message,
            input: prompt_input(images, behavior),
            rest: Map::default(),
        };
        if let Err(error) = self.call(command).await {
            if let Some(thread) = self.threads.get_mut(id) {
                thread.pending_run = false;
                thread.run_started_at = None;
            }
            self.emit_info(id);
            return Err(error);
        }
        Ok(())
    }

    fn thread_project(&self, id: &str) -> Option<String> {
        let cwd = self.threads.get(id).and_then(|thread| thread.cwd.clone()).unwrap_or_default();
        threads::project_for(&cwd, &self.store.flags(id), &self.store.projects)
    }

    async fn resources(&mut self, id: &str, active: &str) -> Resources {
        if let Some(resources) = self.threads.get(id).and_then(|thread| thread.resources.clone()) {
            return resources;
        }
        let command = DaemonCommand::GetResourceSnapshot {
            id: None,
            active_session_id: active.to_string(),
            rest: Map::default(),
        };
        match self.call(command).await {
            Ok(data) => {
                let resources = Resources::parse(&data);
                if let Some(thread) = self.threads.get_mut(id) {
                    thread.resources = Some(resources.clone());
                }
                resources
            }
            Err(error) => {
                self.mailbox.notice(NoticeLevel::Warning, format!("Could not read the skills: {error}"));
                Resources::default()
            }
        }
    }

    async fn send_queued_now(&mut self, id: &str, queued: &str) {
        let Some(live) = self.threads.get(id).and_then(|thread| thread.live.as_ref()) else {
            self.mailbox.notice(NoticeLevel::Info, "Nothing is queued in that thread.");
            return;
        };
        let Some((lane, index, text)) = live.state.queue.find(queued) else {
            self.mailbox.notice(NoticeLevel::Info, "That queued message was already sent.");
            return;
        };
        let active = live.active.clone();
        let next_steering = format!("steering:{}", live.state.queue.steering.len());
        let result = if lane == "followUp" {
            self.call(DaemonCommand::MutateQueuedMessage {
                id: None,
                active_session_id: active,
                lane: json!(lane),
                index,
                expected_text: text.clone(),
                mutation: json!({ "type": "replace", "text": text, "lane": "steering" }),
                rest: Map::default(),
            })
            .await
            .map(|data| (data, next_steering))
        } else if self.client.as_ref().is_some_and(|client| client.supports_server_capability("abort_and_send_queued"))
        {
            self.call(DaemonCommand::AbortAndSendQueued { id: None, active_session_id: active, rest: Map::default() })
                .await
                .map(|data| (data, queued.to_string()))
        } else {
            Err("This daemon cannot send a steering message early.".to_string())
        };
        match result {
            Ok((data, sending)) => {
                if data.get("status").and_then(Value::as_str) == Some("rejected") {
                    self.mailbox.notice(NoticeLevel::Info, "The queue changed; try again.");
                    return;
                }
                if let Some(live) = self.threads.get_mut(id).and_then(|thread| thread.live.as_mut()) {
                    live.sending.push(sending);
                }
                self.emit_queue(id);
            }
            Err(error) => self.mailbox.notice(NoticeLevel::Error, error),
        }
    }

    async fn remove_queued(&mut self, id: &str, queued: &str) {
        let Some(live) = self.threads.get(id).and_then(|thread| thread.live.as_ref()) else {
            self.mailbox.notice(NoticeLevel::Info, "Nothing is queued in that thread.");
            return;
        };
        let Some((lane, index, text)) = live.state.queue.find(queued) else {
            self.mailbox.notice(NoticeLevel::Info, "That queued message was already sent.");
            return;
        };
        let command = DaemonCommand::MutateQueuedMessage {
            id: None,
            active_session_id: live.active.clone(),
            lane: json!(lane),
            index,
            expected_text: text.clone(),
            mutation: json!({ "type": "delete" }),
            rest: Map::default(),
        };
        match self.call(command).await {
            Ok(data) if data.get("status").and_then(Value::as_str) == Some("rejected") => {
                self.mailbox.notice(NoticeLevel::Info, "The queue changed; try again.");
            }
            Ok(_) => self.mailbox.push(Update::ComposerText { thread: id.to_string(), text }),
            Err(error) => self.mailbox.notice(NoticeLevel::Error, error),
        }
    }

    async fn answer(&mut self, id: &str, request: String, answer: ApprovalAnswer) {
        let Some(active) = self.live_active(id) else {
            self.mailbox.notice(NoticeLevel::Info, "That approval is no longer pending.");
            return;
        };
        let verdict = match answer {
            ApprovalAnswer::Approve | ApprovalAnswer::AlwaysAllowSession => ShellVerdict::Approve,
            ApprovalAnswer::Deny => ShellVerdict::Deny,
        };
        if answer == ApprovalAnswer::AlwaysAllowSession {
            let effects: Vec<String> = self
                .threads
                .get(id)
                .and_then(|thread| thread.live.as_ref())
                .and_then(|live| live.approvals.iter().find(|(approval, _)| approval.request_id == request))
                .map(|(approval, _)| approval.effects.clone())
                .unwrap_or_default();
            if let Some(thread) = self.threads.get_mut(id) {
                for effect in effects.into_iter().filter(|effect| GRANTABLE_EFFECTS.contains(&effect.as_str())) {
                    if !thread.allowed_effects.contains(&effect) {
                        thread.allowed_effects.push(effect);
                    }
                }
            }
            if let Err(error) = self.apply_access(id, &active).await {
                self.mailbox.notice(NoticeLevel::Warning, error);
            }
        }
        let command = DaemonCommand::AnswerShellApproval {
            id: None,
            active_session_id: active,
            request_id: request.clone(),
            verdict,
            rest: Map::default(),
        };
        if let Err(error) = self.call(command).await {
            self.mailbox.notice(NoticeLevel::Warning, error);
            self.settle_approval(id, &request);
        }
    }

    fn settle_approval(&mut self, id: &str, request: &str) {
        let Some(live) = self.threads.get_mut(id).and_then(|thread| thread.live.as_mut()) else { return };
        let before = live.approvals.len();
        live.approvals.retain(|(approval, _)| approval.request_id != request);
        if before != live.approvals.len() {
            self.emit_approvals(id);
            self.dirty = true;
        }
    }

    async fn rename(&mut self, id: &str, title: &str) {
        let title = title.trim().to_string();
        if title.is_empty() {
            self.mailbox.notice(NoticeLevel::Warning, "A thread needs a title.");
            return;
        }
        if !self.known(id) {
            self.mailbox.notice(NoticeLevel::Error, format!("Unknown thread {id}."));
            return;
        }
        let command = if let Some(active) = self.live_active(id) {
            DaemonCommand::SetSessionName {
                id: None,
                active_session_id: active,
                name: title.clone(),
                worker_token: None,
                rest: Map::default(),
            }
        } else {
            let Some(path) = self.session_path(id) else {
                self.mailbox.notice(NoticeLevel::Error, format!("The session file of thread {id} is unknown."));
                return;
            };
            DaemonCommand::RenameSavedSession {
                id: None,
                active_session_id: self.roster_for(id).and_then(|row| row.active_session_id.clone()),
                session_path: path,
                name: title.clone(),
                rest: Map::default(),
            }
        };
        match self.call(command).await {
            Ok(_) => {
                self.threads.entry(id.to_string()).or_default().title = Some(title);
                self.emit_info(id);
                self.refresh_saved().await;
            }
            Err(error) => self.mailbox.notice(NoticeLevel::Error, error),
        }
    }

    fn session_path(&self, id: &str) -> Option<String> {
        self.threads
            .get(id)
            .and_then(|thread| thread.path.clone())
            .or_else(|| self.saved.get(id).map(|row| row.path.clone()))
            .or_else(|| self.roster_for(id).and_then(|row| row.session_file.clone()))
    }

    async fn delete(&mut self, id: &str) {
        if !self.known(id) {
            self.mailbox.notice(NoticeLevel::Error, format!("Unknown thread {id}."));
            return;
        }
        if self.running(id) {
            self.mailbox.notice(NoticeLevel::Warning, "Stop the thread before deleting it.");
            return;
        }
        let Some(path) = self.session_path(id) else {
            self.mailbox.notice(NoticeLevel::Error, format!("The session file of thread {id} is unknown."));
            return;
        };
        let active = self.live_active(id).or_else(|| self.roster_for(id).and_then(|row| row.active_session_id.clone()));
        if let Some(active) = active {
            if let Err(error) = self
                .call(DaemonCommand::Kill { id: None, active_session_id: active.clone(), rest: Map::default() })
                .await
            {
                self.mailbox.notice(NoticeLevel::Error, error);
                return;
            }
            self.by_active.remove(&active);
            if let Some(thread) = self.threads.get_mut(id) {
                thread.live = None;
            }
        }
        let command = DaemonCommand::DeleteSavedSession {
            id: None,
            active_session_id: None,
            session_path: path,
            rest: Map::default(),
        };
        match self.call(command).await {
            Ok(data) if data.get("ok").and_then(Value::as_bool) == Some(false) => {
                let reason = data.get("error").and_then(Value::as_str).unwrap_or("unknown error");
                self.mailbox.notice(NoticeLevel::Error, format!("Could not delete the thread: {reason}"));
            }
            Ok(_) => {
                let cwd = self
                    .threads
                    .get(id)
                    .and_then(|thread| thread.cwd.clone())
                    .or_else(|| self.saved.get(id).map(|row| row.cwd.clone()));
                let worktree = cwd.and_then(|cwd| threads::git_head(&cwd).worktree);
                self.workspace.thread_deleted(worktree);
                self.threads.remove(id);
                self.saved.remove(id);
                self.roster.retain(|_, row| row.session_id != id);
                self.store.threads.remove(id);
                self.save();
                if self.focused.as_deref() == Some(id) {
                    self.focused = None;
                }
                self.dirty = true;
            }
            Err(error) => self.mailbox.notice(NoticeLevel::Error, error),
        }
    }

    async fn edit_from_here(&mut self, id: &str, entry: String) -> Result<(), String> {
        let active = self.ensure_open(id).await?;
        let command = DaemonCommand::NavigateTree {
            id: None,
            active_session_id: active,
            target_id: entry,
            summarize: None,
            custom_instructions: None,
            replace_instructions: None,
            label: None,
            rest: Map::default(),
        };
        let data = self.call(command).await?;
        self.reload_messages(id).await;
        if let Some(text) = data.get("editorText").and_then(Value::as_str) {
            self.mailbox.push(Update::ComposerText { thread: id.to_string(), text: text.to_string() });
        }
        Ok(())
    }

    async fn fork(&mut self, id: &str) -> Result<(), String> {
        let active = self.ensure_open(id).await?;
        let tree = self
            .call(DaemonCommand::GetSessionTree { id: None, active_session_id: active.clone(), rest: Map::default() })
            .await?;
        let leaf = tree
            .get("leafId")
            .and_then(Value::as_str)
            .ok_or_else(|| "The thread has nothing to fork yet.".to_string())?
            .to_string();
        self.call(DaemonCommand::Fork {
            id: None,
            active_session_id: active.clone(),
            entry_id: leaf,
            position: Some(ForkPosition::At),
            rest: Map::default(),
        })
        .await?;
        let state = self
            .call(DaemonCommand::GetState { id: None, active_session_id: active.clone(), rest: Map::default() })
            .await?;
        let fork_id = state
            .get("sessionId")
            .and_then(Value::as_str)
            .filter(|fork| *fork != id)
            .ok_or_else(|| "The daemon did not report the fork's session.".to_string())?
            .to_string();
        let cwd = state.get("cwd").and_then(Value::as_str).map(str::to_string);
        let path = state.get("sessionFile").and_then(Value::as_str).map(str::to_string);
        if let Some(original) = self.threads.get_mut(id) {
            original.live = None;
            original.pending_run = false;
            original.run_started_at = None;
        }
        self.by_active.remove(&active);
        let flags = self.store.flags(id);
        let now = now_ms();
        self.store.update(&fork_id, |fork| {
            fork.activity_at = Some(now);
            fork.project = flags.project;
            fork.access = flags.access;
        });
        self.save();
        self.threads.insert(fork_id.clone(), Thread { path, cwd, ..Thread::default() });
        self.attach(&fork_id, &active).await?;
        self.mailbox.push(Update::ThreadStarted { draft: format!("fork:{id}"), thread: fork_id });
        self.refresh_saved().await;
        Ok(())
    }

    async fn apply_model(
        &mut self,
        id: &str,
        provider: Option<String>,
        model: Option<String>,
        level: Option<String>,
    ) -> Result<(), String> {
        let mut active = self.ensure_open(id).await?;
        if let (Some(provider), Some(model)) = (provider, model) {
            let command = |active: String| DaemonCommand::SetModel {
                id: None,
                active_session_id: active,
                provider: provider.clone(),
                model_id: model.clone(),
                rest: Map::default(),
            };
            if let Err(error) = self.call(command(active.clone())).await {
                let listed = self
                    .models
                    .iter()
                    .any(|option| option.configured && option.provider == provider && option.id == model);
                if !listed || self.running(id) {
                    return Err(error);
                }
                active = self.reopen_session(id).await?;
                self.call(command(active.clone())).await?;
            }
        }
        if let Some(level) = level {
            self.call(DaemonCommand::SetThinkingLevel {
                id: None,
                active_session_id: active.clone(),
                level,
                rest: Map::default(),
            })
            .await?;
        }
        self.reload_state(id).await;
        Ok(())
    }

    async fn reload_state(&mut self, id: &str) {
        let Some(active) = self.live_active(id) else { return };
        match self.call(DaemonCommand::GetState { id: None, active_session_id: active, rest: Map::default() }).await {
            Ok(state) => {
                if let Some(live) = self.threads.get_mut(id).and_then(|thread| thread.live.as_mut()) {
                    live.state.merge(&state);
                }
                self.emit_info(id);
                self.dirty = true;
            }
            Err(error) => self.mailbox.notice(NoticeLevel::Warning, error),
        }
    }

    async fn reload_messages(&mut self, id: &str) {
        let Some(active) = self.live_active(id) else { return };
        let data = match self
            .call(DaemonCommand::GetMessages { id: None, active_session_id: active, rest: Map::default() })
            .await
        {
            Ok(data) => data,
            Err(error) => {
                self.mailbox.notice(NoticeLevel::Error, error);
                return;
            }
        };
        let messages = match Messages::deserialize(&data) {
            Ok(messages) => messages.messages,
            Err(error) => {
                self.mailbox.notice(NoticeLevel::Error, format!("Unreadable transcript: {error}"));
                return;
            }
        };
        self.reload_state(id).await;
        if let Some(live) = self.threads.get_mut(id).and_then(|thread| thread.live.as_mut()) {
            live.transcript.reset(&messages, live.state.busy);
            live.transcript.take_settled();
        }
        self.fetch_entries(id, false).await;
        if self.focused.as_deref() == Some(id) {
            if let Some(live) = self.threads.get(id).and_then(|thread| thread.live.as_ref()) {
                self.mailbox.push(Update::Transcript {
                    thread: id.to_string(),
                    op: crate::model::TranscriptOp::Reset { items: live.transcript.items().to_vec() },
                });
            }
        }
    }

    async fn reload_context(&mut self, id: &str) {
        let Some(active) = self.live_active(id) else { return };
        let command = DaemonCommand::GetSessionStats { id: None, active_session_id: active, rest: Map::default() };
        let Ok(stats) = self.call(command).await else { return };
        let context = stats.get("contextUsage").and_then(session::context_usage);
        let Some(live) = self.threads.get_mut(id).and_then(|thread| thread.live.as_mut()) else { return };
        if live.state.context != context {
            live.state.context = context;
            self.emit_info(id);
        }
    }

    async fn utility_session(&mut self) -> Result<String, String> {
        if let Some(active) = self.focused.as_deref().and_then(|id| self.live_active(id)) {
            return Ok(active);
        }
        if let Some(active) =
            self.threads.values().find_map(|thread| thread.live.as_ref().map(|live| live.active.clone()))
        {
            return Ok(active);
        }
        if let Some(active) = self.utility.clone() {
            return Ok(active);
        }
        if let Some(active) = self.roster.values().find_map(|row| row.active_session_id.clone()) {
            return Ok(active);
        }
        let created = self
            .call(DaemonCommand::Create {
                id: None,
                session_path: None,
                continue_recent: None,
                no_session: Some(true),
                name: None,
                config: Some(self.create_config(&self.home)),
                runtime_metadata: None,
                lifecycle: Some(DaemonSessionLifecycle::ClientOwned),
                env: None,
                launch_env: None,
                rest: Map::default(),
            })
            .await?;
        let active = created
            .get("activeSessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| "The daemon opened a session without an id.".to_string())?
            .to_string();
        self.utility = Some(active.clone());
        Ok(active)
    }

    async fn load_models(&mut self, answer: Option<(String, String)>) {
        self.fetch_models().await;
        if let Some((request, message)) = answer {
            self.mailbox.push(Update::RequestDone { request, message });
        }
    }

    async fn fetch_models(&mut self) {
        let active = match self.utility_session().await {
            Ok(active) => active,
            Err(error) => {
                self.mailbox.notice(NoticeLevel::Warning, format!("Could not load the models: {error}"));
                return;
            }
        };
        let catalog =
            self.call(DaemonCommand::GetModelCatalog { id: None, active_session_id: active, rest: Map::default() });
        let (catalog, default) = tokio::join!(catalog, self.daemon_default());
        match default {
            Ok((model, thinking_level)) => self.mailbox.push(Update::DaemonDefault { model, thinking_level }),
            Err(error) => {
                self.mailbox.push(Update::DaemonDefault { model: None, thinking_level: None });
                self.mailbox
                    .notice(NoticeLevel::Warning, format!("Could not read the daemon's default model: {error}"));
            }
        }
        match catalog {
            Ok(data) => match session::model_options(&data) {
                Ok((models, errors)) => {
                    self.models = models;
                    self.workspace.models_loaded(&self.models, errors);
                    self.push_models();
                }
                Err(error) => self.mailbox.notice(NoticeLevel::Error, format!("Unreadable model catalog: {error:#}")),
            },
            Err(error) => self.mailbox.notice(NoticeLevel::Error, error),
        }
    }

    async fn daemon_default(&self) -> Result<(Option<ModelKey>, Option<String>), String> {
        let created = self
            .call(DaemonCommand::Create {
                id: None,
                session_path: None,
                continue_recent: None,
                no_session: Some(true),
                name: None,
                config: Some(self.create_config(&self.home)),
                runtime_metadata: None,
                lifecycle: Some(DaemonSessionLifecycle::ClientOwned),
                env: None,
                launch_env: None,
                rest: Map::default(),
            })
            .await?;
        let active = created
            .get("activeSessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| "The daemon opened a session without an id.".to_string())?
            .to_string();
        let state = self
            .call(DaemonCommand::GetState { id: None, active_session_id: active.clone(), rest: Map::default() })
            .await;
        let killed = self.call(DaemonCommand::Kill { id: None, active_session_id: active, rest: Map::default() }).await;
        let state = state?;
        killed?;
        let model = state
            .get("model")
            .and_then(session::model_ref)
            .filter(|model| !model.provider.is_empty())
            .map(|model| ModelKey { provider: model.provider, model: model.id });
        let thinking_level = state.get("thinkingLevel").and_then(Value::as_str).map(str::to_string);
        Ok((model, thinking_level))
    }

    async fn project_resources(&mut self, project: Option<String>) -> Result<Resources, String> {
        let project = project.and_then(|project| self.store.project_id(&project));
        let in_project = project.as_ref().and_then(|project| {
            self.threads.iter().find_map(|(id, thread)| {
                let live = thread.live.as_ref()?;
                let flags = self.store.flags(id);
                (threads::project_for(&live.state.cwd, &flags, &self.store.projects).as_ref() == Some(project))
                    .then(|| live.active.clone())
            })
        });
        let active = match in_project {
            Some(active) => active,
            None => self.utility_session().await?,
        };
        let data = self
            .call(DaemonCommand::GetResourceSnapshot { id: None, active_session_id: active, rest: Map::default() })
            .await?;
        Ok(Resources::parse(&data))
    }

    async fn set_service_tier(&mut self, id: &str, tier: Option<String>) -> Result<(), String> {
        let active = self.ensure_open(id).await?;
        let service_tier = match tier {
            Some(tier) => Some(
                serde_json::from_value::<ServiceTier>(Value::String(tier.clone()))
                    .map_err(|_| format!("Unknown service tier {tier}."))?,
            ),
            None => None,
        };
        self.call(DaemonCommand::SetServiceTier {
            id: None,
            active_session_id: active,
            service_tier,
            rest: Map::default(),
        })
        .await?;
        self.reload_state(id).await;
        Ok(())
    }

    async fn restart_thread(&mut self, id: &str) -> Result<(), String> {
        if !self.known(id) {
            return Err(format!("Unknown thread {id}."));
        }
        self.reopen_session(id).await?;
        self.mailbox.notice(NoticeLevel::Info, "The agent session restarted.");
        Ok(())
    }

    fn running(&self, id: &str) -> bool {
        self.threads
            .get(id)
            .is_some_and(|thread| thread.pending_run || thread.live.as_ref().is_some_and(|live| live.state.busy))
            || self.roster_for(id).is_some_and(|row| row.running)
    }

    async fn reopen_session(&mut self, id: &str) -> Result<String, String> {
        let active = self.live_active(id).or_else(|| self.roster_for(id).and_then(|row| row.active_session_id.clone()));
        if let Some(active) = active {
            self.by_active.remove(&active);
            if let Some(thread) = self.threads.get_mut(id) {
                thread.live = None;
                thread.pending_run = false;
                thread.run_started_at = None;
            }
            self.call(DaemonCommand::Kill { id: None, active_session_id: active, rest: Map::default() }).await?;
        }
        let active = self.ensure_open(id).await?;
        self.dirty = true;
        Ok(active)
    }

    async fn refresh_subagents(&mut self, id: &str) {
        let Some(active) = self.live_active(id) else { return };
        let command = DaemonCommand::GetRlmChildren { id: None, active_session_id: active, rest: Map::default() };
        if let Ok(data) = self.call(command).await {
            let children = data
                .get("children")
                .and_then(Value::as_array)
                .map(|children| children.iter().filter_map(rlm_child).collect())
                .unwrap_or_default();
            if let Some(thread) = self.threads.get_mut(id) {
                thread.rlm_children = children;
            }
        }
        self.emit_subagents(id);
    }

    fn subagents(&self, id: &str) -> Vec<Subagent> {
        let thread = self.threads.get(id);
        let active = thread.and_then(|thread| thread.live.as_ref()).map(|live| live.active.as_str());
        let roster_active = self.roster_for(id).and_then(|row| row.active_session_id.as_deref());
        let mut agents: Vec<Subagent> = self
            .children
            .values()
            .filter(|child| {
                child.parent_session_id.as_deref() == Some(id)
                    || child
                        .parent_active_session_id
                        .as_deref()
                        .is_some_and(|parent| Some(parent) == active || Some(parent) == roster_active)
            })
            .map(|child| child.agent.clone())
            .collect();
        for known in thread.map(|thread| thread.rlm_children.as_slice()).unwrap_or_default() {
            match agents.iter_mut().find(|agent| agent.id == known.id) {
                Some(agent) => {
                    agent.duration_ms = known.duration_ms.or(agent.duration_ms);
                    agent.answer.clone_from(&known.answer);
                    if agent.model.is_none() {
                        agent.model.clone_from(&known.model);
                    }
                }
                None => agents.push(known.clone()),
            }
        }
        agents.sort_by(|left, right| right.running.cmp(&left.running).then_with(|| left.id.cmp(&right.id)));
        agents
    }

    fn emit_subagents(&self, id: &str) {
        self.mailbox.push(Update::Subagents { thread: id.to_string(), agents: self.subagents(id) });
    }

    async fn message_image(&mut self, id: &str, entry: &str, index: u32) -> Result<(String, Vec<u8>), String> {
        let active = self.ensure_open(id).await?;
        let forks = self
            .call(DaemonCommand::GetUserMessagesForForking {
                id: None,
                active_session_id: active.clone(),
                rest: Map::default(),
            })
            .await?;
        let entries: Vec<&str> = forks
            .get("messages")
            .and_then(Value::as_array)
            .map(|messages| messages.iter().filter_map(|message| message.get("entryId")?.as_str()).collect())
            .unwrap_or_default();
        let position =
            entries.iter().position(|known| *known == entry).ok_or_else(|| "Unknown message.".to_string())?;
        let from_end = entries.len() - 1 - position;
        let data =
            self.call(DaemonCommand::GetMessages { id: None, active_session_id: active, rest: Map::default() }).await?;
        let messages = Messages::deserialize(&data).map_err(|error| format!("Unreadable transcript: {error}"))?;
        let users: Vec<&UserContent> = messages
            .messages
            .iter()
            .filter_map(|message| match message {
                AgentMessage::User(user) => Some(&user.content),
                AgentMessage::Assistant(_)
                | AgentMessage::ToolResult(_)
                | AgentMessage::BashExecution(_)
                | AgentMessage::Custom(_)
                | AgentMessage::BranchSummary(_)
                | AgentMessage::CompactionSummary(_) => None,
            })
            .collect();
        let content = users
            .len()
            .checked_sub(from_end + 1)
            .and_then(|at| users.get(at))
            .ok_or_else(|| "That message is no longer in the conversation.".to_string())?;
        let UserContent::Blocks(blocks) = content else { return Err("That message has no images.".to_string()) };
        let image = blocks
            .iter()
            .filter_map(|block| match block {
                UserContentBlock::Image(image) => Some(image),
                UserContentBlock::Text(_) | UserContentBlock::Raw(_) => None,
            })
            .nth(usize::try_from(index).unwrap_or(usize::MAX))
            .ok_or_else(|| "That image is not in the message.".to_string())?;
        let bytes = images::decode_base64(&image.data).ok_or_else(|| "The image data is unreadable.".to_string())?;
        Ok((image.mime_type.clone(), bytes))
    }

    async fn refresh_saved(&mut self) {
        let command = DaemonCommand::ListSavedSessions {
            id: None,
            active_session_id: None,
            cwd: Some(self.home.clone()),
            session_dir: self.session_dir.as_ref().map(|dir| dir.to_string_lossy().into_owned()),
            scope: Value::Null,
            rest: Map::default(),
        };
        match self.call(command).await {
            Ok(data) => {
                self.saved = threads::saved_rows(&data).into_iter().map(|row| (row.id.clone(), row)).collect();
                let now = now_ms();
                let mut seeded = false;
                for row in self.saved.values() {
                    if self.store.activity_at(&row.id).is_none() {
                        let created = row.created.unwrap_or(now);
                        self.store.update(&row.id, |flags| flags.activity_at = Some(created));
                        seeded = true;
                    }
                }
                if seeded {
                    self.save();
                }
                self.heads.clear();
                for thread in self.threads.values_mut() {
                    thread.title = None;
                }
                self.dirty = true;
            }
            Err(error) => self.mailbox.notice(NoticeLevel::Error, format!("Could not list the threads: {error}")),
        }
    }

    fn roster_changed(&mut self, changed: Value, removed: &[String], resync: bool, transitions: bool) {
        let children_before = self.children.len();
        let mut children_changed = false;
        if resync {
            self.roster.clear();
            self.children.clear();
        }
        for agent in removed {
            self.roster.remove(agent);
            children_changed |= self.children.remove(agent).is_some();
        }
        let entries = match changed {
            Value::Array(entries) => entries,
            Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) | Value::Object(_) => Vec::new(),
        };
        for entry in entries {
            let Some(agent) = entry.get("agentId").and_then(Value::as_str).map(str::to_string) else { continue };
            if let Some(child) = threads::child_row(&agent, &entry) {
                self.roster.remove(&agent);
                children_changed |= self.children.get(&agent) != Some(&child);
                self.children.insert(agent, child);
                continue;
            }
            let Some(row) = threads::roster_row(&entry) else {
                self.roster.remove(&agent);
                continue;
            };
            if row.active_session_id.is_some() && row.active_session_id == self.utility {
                continue;
            }
            let was_running = self.roster.get(&agent).is_some_and(|old| old.running);
            let id = row.session_id.clone();
            let thread = self.threads.get_mut(&id);
            let attached = thread.as_ref().is_some_and(|thread| thread.live.is_some());
            let ended_by_events = thread.is_some_and(|thread| {
                let ended = thread.ended_by_events;
                if transitions && was_running != row.running {
                    thread.ended_by_events = false;
                }
                ended
            });
            if transitions && !attached {
                if !was_running && row.running {
                    self.store.update(&id, |flags| flags.settled_at = None);
                    self.save();
                }
                if was_running && !row.running && !ended_by_events {
                    self.run_finished(&id, row.failed);
                }
            }
            let flipped = was_running != row.running;
            let stopped = was_running && !row.running;
            self.roster.insert(agent, row);
            if stopped && !self.running(&id) {
                if let Some(thread) = self.threads.get_mut(&id) {
                    thread.run_started_at = None;
                }
            }
            if flipped {
                self.emit_info(&id);
            }
        }
        if children_changed || children_before != self.children.len() {
            if let Some(focused) = self.focused.clone() {
                self.emit_subagents(&focused);
            }
        }
        self.dirty = true;
    }

    fn run_finished(&mut self, id: &str, failed: bool) {
        let now = now_ms();
        if self.focused.as_deref() != Some(id) {
            self.store.update(id, |flags| {
                flags.unread = true;
                flags.done_at = Some(now);
            });
            self.save();
        }
        let title = self.title(id);
        let (kind, body) = if failed {
            (NotificationKind::Failed, "The run failed.".to_string())
        } else {
            let answer = self
                .threads
                .get(id)
                .and_then(|thread| thread.live.as_ref())
                .and_then(|live| live.transcript.last_answer())
                .map(|answer| threads::clean_title(&answer))
                .unwrap_or_default();
            (NotificationKind::TurnDone, truncate(&answer, BODY_LIMIT))
        };
        self.mailbox.push(Update::Notification { thread: id.to_string(), kind, title, body });
        self.dirty = true;
    }

    async fn event(&mut self, event: DaemonClientEvent) {
        match event {
            DaemonClientEvent::SessionEvent { active_session_id, event, meta_sequence } => {
                self.session_event(&active_session_id, &event, meta_sequence).await;
            }
            DaemonClientEvent::UndecodableSessionEvent { active_session_id, error } => {
                if self.by_active.contains_key(&active_session_id) {
                    self.mailbox.notice(NoticeLevel::Warning, format!("Skipped an unreadable session event: {error}"));
                }
            }
            DaemonClientEvent::SessionClosed { active_session_id, reason } => {
                if self.utility.as_deref() == Some(active_session_id.as_str()) {
                    self.utility = None;
                }
                let Some(id) = self.by_active.remove(&active_session_id) else { return };
                if let Some(thread) = self.threads.get_mut(&id) {
                    thread.live = None;
                    thread.pending_run = false;
                    thread.run_started_at = None;
                }
                if self.focused.as_deref() == Some(id.as_str()) {
                    self.mailbox.push(Update::Approvals { thread: id.clone(), approvals: Vec::new() });
                    if reason != "replaced" {
                        self.mailbox.notice(NoticeLevel::Info, format!("The thread's session closed ({reason})."));
                    }
                }
                self.dirty = true;
            }
            DaemonClientEvent::ShellApproval { active_session_id, request, agent } => {
                let Some(id) = self.by_active.get(&active_session_id).cloned() else { return };
                let approval = Approval {
                    request_id: request.request_id,
                    step: request.step,
                    command: request.command,
                    effects: request.effects.iter().map(|effect| effect.as_str().to_string()).collect(),
                    agent,
                };
                let body = truncate(&approval.command, BODY_LIMIT);
                let Some(live) = self.threads.get_mut(&id).and_then(|thread| thread.live.as_mut()) else { return };
                live.approvals.retain(|(known, _)| known.request_id != approval.request_id);
                live.approvals.push((approval, now_ms()));
                self.emit_approvals(&id);
                let title = self.title(&id);
                self.mailbox.push(Update::Notification {
                    thread: id,
                    kind: NotificationKind::NeedsApproval,
                    title,
                    body,
                });
                self.dirty = true;
            }
            DaemonClientEvent::ShellApprovalSettled { active_session_id, request_id } => {
                if let Some(id) = self.by_active.get(&active_session_id).cloned() {
                    self.settle_approval(&id, &request_id);
                }
            }
            DaemonClientEvent::SessionBinding { previous_active_session_id, active_session_id } => {
                if self.utility.as_deref() == Some(previous_active_session_id.as_str()) {
                    self.utility = Some(active_session_id.clone());
                }
                if let Some(id) = self.by_active.remove(&previous_active_session_id) {
                    if let Err(error) = self.attach(&id, &active_session_id).await {
                        self.mailbox.notice(NoticeLevel::Error, error);
                    }
                }
            }
            DaemonClientEvent::RosterUpdate { changed, removed, resync } => {
                self.roster_changed(Value::Array(changed), &removed, resync, true);
            }
            DaemonClientEvent::DaemonClosing { reason } => {
                self.mailbox.notice(NoticeLevel::Info, format!("The Eukhe daemon is closing ({reason})."));
            }
            DaemonClientEvent::DirectLinkLost { .. }
            | DaemonClientEvent::SessionListItem { .. }
            | DaemonClientEvent::SessionListProgress { .. }
            | DaemonClientEvent::HeartbeatsChanged
            | DaemonClientEvent::StateTreeUpdate { .. } => {}
            DaemonClientEvent::SideQuestionEvent { event, .. } => self.title_answered(&event).await,
        }
    }

    async fn regenerate_title(&mut self, id: &str) -> Result<(), String> {
        if self.titles.values().any(|title| title == id) {
            return Err("A title is already being generated for this thread.".to_string());
        }
        let project = self.thread_project(id);
        let settings = self.workspace.effective_settings(project.as_deref());
        if let (Some(provider), Some(model)) = (settings.text_generation_provider, settings.text_generation_model) {
            let excerpt: String = self
                .saved
                .get(id)
                .map(|row| row.text.chars().take(TITLE_CONTEXT_LIMIT).collect())
                .or_else(|| self.threads.get(id).and_then(|thread| thread.live.as_ref()?.transcript.first_user_text()))
                .unwrap_or_else(|| self.title(id));
            let prompt = format!("{TITLE_QUESTION}\n\nConversation:\n{excerpt}");
            let text = self.text.clone();
            let itself = self.itself.clone();
            let thread = id.to_string();
            tokio::spawn(async move {
                let result = text.one_shot(prompt, Some(provider), Some(model)).await;
                itself.send(Command::TitleGenerated { thread, result }).ok();
            });
            return Ok(());
        }
        let active = self.ensure_open(id).await?;
        let request = format!("title:{id}:{}", now_ms());
        self.titles.insert(request.clone(), id.to_string());
        let command = DaemonCommand::StartSideQuestion {
            id: None,
            active_session_id: active,
            side_question_id: request.clone(),
            question: TITLE_QUESTION.to_string(),
            previous_turns: None,
            rest: Map::default(),
        };
        if let Err(error) = self.call(command).await {
            self.titles.remove(&request);
            self.release(id).await;
            return Err(error);
        }
        Ok(())
    }

    async fn title_answered(&mut self, event: &Value) {
        let Some(request) = event.get("id").and_then(Value::as_str) else { return };
        let status = event.get("status").and_then(Value::as_str).unwrap_or_default();
        if status == "running" || !self.titles.contains_key(request) {
            return;
        }
        let Some(id) = self.titles.remove(request) else { return };
        let answer = event.get("answer").and_then(Value::as_str).unwrap_or_default();
        match (status, clean_generated_title(answer)) {
            ("complete", Some(title)) => self.rename(&id, &title).await,
            ("complete", None) => {
                self.mailbox.notice(NoticeLevel::Warning, "The model returned no usable title.");
            }
            _ => {
                let reason = event.get("errorMessage").and_then(Value::as_str).unwrap_or(status);
                self.mailbox.notice(NoticeLevel::Error, format!("Could not regenerate the title: {reason}"));
            }
        }
        self.release(&id).await;
    }

    async fn session_event(&mut self, active: &str, event: &SessionEvent, sequence: u64) {
        let Some(id) = self.by_active.get(active).cloned() else { return };
        let focused = self.focused.as_deref() == Some(id.as_str());
        let now = now_ms();
        let mode = self.settings.borrow().response_streaming;
        let Some(thread) = self.threads.get_mut(&id) else { return };
        let Some(live) = thread.live.as_mut() else { return };
        if sequence != 0 {
            if sequence <= live.seen {
                return;
            }
            live.seen = sequence;
        }
        let ops: Vec<TranscriptOp> = if focused {
            live.transcript.apply(event).into_iter().filter_map(|op| coalesce(mode, &mut live.shown, op)).collect()
        } else {
            live.transcript.apply(event);
            Vec::new()
        };
        let changed = live.state.apply(event);
        let settled = live.transcript.take_settled();
        let mut failure = None;
        let mut user_at = None;
        match event {
            SessionEvent::AgentStart => {
                thread.run_started_at = thread.run_started_at.or(Some(now));
                thread.failed_at = None;
            }
            SessionEvent::MessageStart { message: AgentMessage::User(user), .. } => {
                user_at = Some(i64::try_from(user.timestamp).unwrap_or(now));
            }
            SessionEvent::TurnEnd { error: Some(error), .. } => {
                thread.failed_at = Some(now);
                failure = Some(error.clone());
            }
            SessionEvent::AutoRetryEnd { success: false, final_error, .. } => {
                thread.failed_at = Some(now);
                failure = Some(final_error.clone().unwrap_or_else(|| "The retries ran out.".to_string()));
            }
            SessionEvent::SessionActionUpdate { .. } => live.sending.clear(),
            _ => {}
        }
        self.note_user_at(&id, user_at);
        for op in ops {
            self.mailbox.push(Update::Transcript { thread: id.clone(), op });
        }
        if changed {
            self.emit_info(&id);
            self.dirty = true;
        }
        if matches!(event, SessionEvent::SessionActionUpdate { .. }) {
            self.emit_queue(&id);
        }
        if matches!(event, SessionEvent::AgentStart) {
            self.store.update(&id, |flags| flags.settled_at = None);
            self.dirty = true;
        }
        if let Some(turn) = settled.last() {
            let (additions, deletions) = (turn.additions, turn.deletions);
            self.store.update(&id, |flags| {
                flags.additions = additions;
                flags.deletions = deletions;
            });
            self.save();
        }
        for turn in settled.into_iter().filter(|turn| !turn.files.is_empty()) {
            self.workspace.record_turn_files(id.clone(), turn.turn, turn.files);
        }
        if let Some(error) = failure {
            let title = self.title(&id);
            self.mailbox.push(Update::Notification {
                thread: id.clone(),
                kind: NotificationKind::Failed,
                title,
                body: truncate(&error, BODY_LIMIT),
            });
            self.dirty = true;
        }
        match event {
            SessionEvent::AgentEnd { .. } => self.agent_end(&id).await,
            SessionEvent::CompactionEnd { result: Some(_), .. } => self.reload_messages(&id).await,
            _ => {}
        }
    }

    async fn agent_end(&mut self, id: &str) {
        let failed = self.threads.get(id).is_some_and(|thread| thread.failed_at.is_some());
        if let Some(thread) = self.threads.get_mut(id) {
            thread.pending_run = false;
            thread.ended_by_events = true;
        }
        if !self.running(id) {
            if let Some(thread) = self.threads.get_mut(id) {
                thread.run_started_at = None;
            }
        }
        self.fetch_entries(id, true).await;
        if !failed {
            self.run_finished(id, false);
        } else if self.focused.as_deref() != Some(id) {
            let now = now_ms();
            self.store.update(id, |flags| {
                flags.unread = true;
                flags.done_at = Some(now);
            });
            self.save();
        }
        self.reload_context(id).await;
        if self.focused.as_deref() == Some(id) {
            self.refresh_subagents(id).await;
        }
        self.refresh_saved().await;
        self.emit_info(id);
        self.release(id).await;
    }

    fn rows(&mut self, archived: bool) -> Vec<ThreadRow> {
        let now = now_ms();
        let settings = self.settings.borrow().clone();
        let prefs = InboxPrefs {
            working_section: settings.working_section,
            auto_settle_inactive: settings.auto_settle_inactive,
            auto_settle_inactive_days: settings.auto_settle_inactive_days,
            auto_settle_merged: settings.auto_settle_merged,
        };
        let mut ids: HashSet<String> = self.saved.keys().cloned().collect();
        ids.extend(self.roster.values().filter(|row| row.session_file.is_some()).map(|row| row.session_id.clone()));
        ids.extend(self.threads.iter().filter(|(_, thread)| thread.path.is_some()).map(|(id, _)| id.clone()));
        let mut rows = Vec::with_capacity(ids.len());
        for id in ids {
            let flags = self.store.flags(&id);
            if flags.archived != archived {
                continue;
            }
            if self.store.activity_at(&id).is_none() {
                self.first_seen.entry(id.clone()).or_insert(now);
            }
            let mut facts = self.facts(&id, now);
            let head = self.heads.entry(facts.cwd.clone()).or_insert_with(|| threads::git_head(&facts.cwd)).clone();
            facts.pull_request =
                head.branch.as_deref().and_then(|branch| self.workspace.thread_pull_request(&facts.cwd, branch));
            rows.push(threads::row(facts, &flags, &self.store.projects, prefs, head, now));
        }
        threads::arrange(rows)
    }

    fn facts(&self, id: &str, now: i64) -> Facts {
        let thread = self.threads.get(id);
        let live = thread.and_then(|thread| thread.live.as_ref());
        let roster = self.roster_for(id);
        let saved = self.saved.get(id);
        let cwd = live
            .map(|live| live.state.cwd.clone())
            .filter(|cwd| !cwd.is_empty())
            .or_else(|| thread.and_then(|thread| thread.cwd.clone()))
            .or_else(|| roster.map(|row| row.cwd.clone()))
            .or_else(|| saved.map(|row| row.cwd.clone()))
            .unwrap_or_default();
        let activity_at = self.store.activity_at(id).or_else(|| self.first_seen.get(id).copied()).unwrap_or(now);
        let model = live.and_then(|live| live.state.model.clone());
        Facts {
            id: id.to_string(),
            title: self.title(id),
            activity_at,
            working: live.is_some_and(|live| live.state.busy)
                || thread.is_some_and(|thread| thread.pending_run)
                || roster.is_some_and(|row| row.running),
            run_started_at: thread.and_then(|thread| thread.run_started_at),
            approval_since: live.and_then(|live| live.approvals.iter().map(|(_, at)| *at).min()),
            failed_at: thread
                .and_then(|thread| thread.failed_at)
                .or_else(|| roster.filter(|row| row.failed).map(|row| row.updated_at.unwrap_or(now))),
            provider: model
                .as_ref()
                .map(|model| model.provider.clone())
                .filter(|provider| !provider.is_empty())
                .or_else(|| roster.and_then(|row| row.provider.clone()))
                .or_else(|| saved.and_then(|row| row.provider.clone())),
            model: model
                .map(|model| model.id)
                .or_else(|| roster.and_then(|row| row.model.clone()))
                .or_else(|| saved.and_then(|row| row.model.clone())),
            note: roster.and_then(|row| row.note.clone()),
            monitoring: roster.is_some_and(|row| row.monitoring),
            live_agents: u32::try_from(self.subagents(id).iter().filter(|agent| agent.running).count())
                .unwrap_or(u32::MAX),
            pull_request: None,
            cwd,
        }
    }

    fn flush(&mut self) {
        if !self.dirty {
            return;
        }
        self.dirty = false;
        let rows = self.rows(false);
        if self.last_rows.as_ref() != Some(&rows) {
            let mut protected: Vec<String> = rows.iter().filter_map(|row| row.worktree.clone()).collect();
            protected.sort();
            protected.dedup();
            if protected != self.protected {
                self.protected.clone_from(&protected);
                self.workspace.protect_worktrees(protected);
            }
            self.last_rows = Some(rows.clone());
            self.mailbox.push_threads(rows);
        }
    }
}

fn coalesce(mode: ResponseStreaming, shown: &mut HashMap<u64, Vec<Block>>, op: TranscriptOp) -> Option<TranscriptOp> {
    if mode == ResponseStreaming::Token {
        return Some(op);
    }
    let (index, mut item, insert) = match op {
        TranscriptOp::Insert { index, item } => (index, item, true),
        TranscriptOp::Update { index, item } => (index, item, false),
        TranscriptOp::Reset { .. } => return Some(op),
    };
    let ItemKind::Assistant { blocks, streaming: true, .. } = &mut item.kind else {
        shown.remove(&item.id);
        return Some(if insert { TranscriptOp::Insert { index, item } } else { TranscriptOp::Update { index, item } });
    };
    let visible: Vec<Block> = blocks
        .iter()
        .filter_map(|block| match block {
            Block::Thinking { .. } => Some(block.clone()),
            Block::Text { text } => {
                let kept = match mode {
                    ResponseStreaming::Turn => "",
                    ResponseStreaming::Paragraph => text.rfind("\n\n").map_or("", |end| &text[..end]),
                    ResponseStreaming::Token => text.as_str(),
                };
                (!kept.trim().is_empty()).then(|| Block::Text { text: kept.to_string() })
            }
        })
        .collect();
    if !insert && shown.get(&item.id) == Some(&visible) {
        return None;
    }
    shown.insert(item.id, visible.clone());
    *blocks = visible;
    Some(if insert { TranscriptOp::Insert { index, item } } else { TranscriptOp::Update { index, item } })
}

fn rlm_child(child: &Value) -> Option<Subagent> {
    let text = |key: &str| child.get(key).and_then(Value::as_str).filter(|value| !value.is_empty());
    let status = text("status").unwrap_or_default();
    Some(Subagent {
        id: text("id")?.to_string(),
        title: text("label")
            .or_else(|| text("sessionName"))
            .map_or_else(|| "Subagent".to_string(), threads::clean_title),
        status: status.to_string(),
        running: matches!(status, "running" | "queued" | "pending" | "working"),
        started_at: None,
        duration_ms: child.get("durationMs").and_then(Value::as_u64),
        tokens: 0,
        current_tool: None,
        note: None,
        model: text("model").map(str::to_string),
        answer: text("answerPreview").map(str::to_string),
    })
}

fn clean_generated_title(answer: &str) -> Option<String> {
    let line = answer.lines().map(str::trim).find(|line| !line.is_empty())?;
    let line = line.trim_start_matches(['#', '*', '-', '>', ' ']);
    let line = line.strip_prefix("Title:").unwrap_or(line).trim();
    let words: Vec<&str> = line
        .split_whitespace()
        .map(|word| word.trim_matches(|c: char| matches!(c, '"' | '\'' | '`' | '*' | '_' | '“' | '”' | '‘' | '’')))
        .filter(|word| !word.is_empty())
        .collect();
    let title = words.join(" ");
    let title = title.trim_end_matches(['.', '!', '?', ',', ';', ':']).trim();
    if title.is_empty() {
        return None;
    }
    Some(title.chars().take(GENERATED_TITLE_LIMIT).collect::<String>().trim_end().to_string())
}

fn toggle_key(keys: &mut Vec<ModelKey>, key: ModelKey, present: bool) {
    keys.retain(|known| *known != key);
    if present {
        keys.push(key);
    }
}

fn access_effects(mode: AccessMode) -> &'static [&'static str] {
    match mode {
        AccessMode::Supervised => &["read"],
        AccessMode::AutoAcceptEdits => &["read", "write"],
        AccessMode::Auto => &["read", "write", "exec"],
        AccessMode::FullAccess => &GRANTABLE_EFFECTS,
    }
}

fn prompt_text(prompt: &PromptDraft) -> String {
    let mut text = prompt.text.trim_end().to_string();
    let files: Vec<String> =
        prompt.files.iter().filter(|file| !file.trim().is_empty()).map(|file| format!("@{}", file.trim())).collect();
    if !files.is_empty() {
        if !text.is_empty() {
            text.push_str("\n\n");
        }
        text.push_str(&files.join("\n"));
    }
    text
}

fn prompt_input(images: Option<Value>, behavior: StreamingBehavior) -> PromptInput {
    PromptInput {
        content: None,
        images,
        streaming_behavior: Some(behavior),
        queue_if_busy: Some(true),
        expand_prompt_templates: None,
        source: None,
        agent_message_id: None,
        custom_message: None,
        queue_key: None,
        prefix_messages: None,
        admission_id: None,
        rlm_notice_nonce: None,
        reply_to: None,
    }
}

fn branch_slug(text: &str) -> String {
    let slug: String = text
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '_' { c.to_ascii_lowercase() } else { '-' })
        .collect();
    slug.split('-').filter(|part| !part.is_empty()).collect::<Vec<_>>().join("-")
}

fn truncate(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let mut cut: String = text.chars().take(limit).collect();
    cut.push('…');
    cut
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX))
}
