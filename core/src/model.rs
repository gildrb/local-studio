use crate::workspace::model::{
    Branch, FileContent, FileDiff, FileEntry, GitStatus, Keybinding, LocalSnapshot, ProviderStatus, PullRequest,
    SearchHit, Settings, UsageReport,
};

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct ModelRef {
    pub provider: String,
    pub id: String,
    pub name: Option<String>,
    pub reasoning: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct ContextUsage {
    pub tokens: u64,
    pub window: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum AccessMode {
    #[default]
    Supervised,
    AutoAcceptEdits,
    Auto,
    FullAccess,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub icon: Option<String>,
    pub is_git: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum Shelf {
    Pinned,
    Active,
    Working,
    Snoozed,
    Settled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum ThreadStatus {
    Idle,
    Working,
    Approval,
    Failed,
    Done,
    Woke,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct ThreadRow {
    pub id: String,
    pub project: Option<String>,
    pub title: String,
    pub shelf: Shelf,
    pub status: ThreadStatus,
    pub status_since: Option<i64>,
    pub updated_at: i64,
    pub snoozed_until: Option<i64>,
    pub pinned: bool,
    pub unread: bool,
    pub branch: Option<String>,
    pub worktree: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub additions: u32,
    pub deletions: u32,
    pub note: Option<String>,
    pub archived: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct ThreadInfo {
    pub thread: String,
    pub project: Option<String>,
    pub title: String,
    pub cwd: String,
    pub model: Option<ModelRef>,
    pub thinking_level: String,
    pub thinking_levels: Vec<String>,
    pub access: AccessMode,
    pub busy: bool,
    pub run_started_at: Option<i64>,
    pub compacting: bool,
    pub retry_attempt: u32,
    pub queued: u32,
    pub context: Option<ContextUsage>,
    pub branch: Option<String>,
    pub worktree: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct QueuedMessage {
    pub id: String,
    pub text: String,
    pub steering: bool,
    pub sending: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct ModelKey {
    pub provider: String,
    pub model: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct SlashCommand {
    pub name: String,
    pub description: String,
    pub source: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum NotificationKind {
    TurnDone,
    NeedsApproval,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct ImageAttachment {
    pub mime_type: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct PromptDraft {
    pub text: String,
    pub images: Vec<ImageAttachment>,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum Delivery {
    Queue,
    Steer,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum WorktreeChoice {
    Local,
    NewWorktree { branch: String, base: Option<String> },
    Existing { path: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct ThreadSettings {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub thinking_level: Option<String>,
    pub access: AccessMode,
    pub worktree: WorktreeChoice,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum ApprovalAnswer {
    Approve,
    Deny,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum Block {
    Text { text: String },
    Thinking { text: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum ToolState {
    Pending,
    Running,
    Succeeded,
    Failed,
    Aborted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum ToolKind {
    Read,
    Edit,
    Command,
    Search,
    Web,
    Agent,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct FileChange {
    pub path: String,
    pub additions: u32,
    pub deletions: u32,
    pub diff: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum NoticeLevel {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum ItemKind {
    User {
        text: String,
        images: u32,
        entry: Option<String>,
    },
    Assistant {
        blocks: Vec<Block>,
        streaming: bool,
        error: Option<String>,
        changed_files: Vec<FileChange>,
    },
    Tool {
        call_id: String,
        name: String,
        kind: ToolKind,
        summary: String,
        arguments: String,
        state: ToolState,
        output: String,
        file_change: Option<FileChange>,
        started_at: Option<i64>,
        ended_at: Option<i64>,
    },
    TurnSummary {
        turn: u64,
        duration_ms: u64,
        tool_count: u32,
    },
    Notice {
        level: NoticeLevel,
        text: String,
    },
    Compaction {
        summary: String,
        tokens_before: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct Item {
    pub id: u64,
    pub turn: u64,
    pub created_at: Option<i64>,
    pub kind: ItemKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum TranscriptOp {
    Reset { items: Vec<Item> },
    Insert { index: u64, item: Item },
    Update { index: u64, item: Item },
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct Approval {
    pub request_id: String,
    pub step: u64,
    pub command: String,
    pub effects: Vec<String>,
    pub agent: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct ModelOption {
    pub provider: String,
    pub id: String,
    pub name: String,
    pub reasoning: bool,
    pub thinking_levels: Vec<String>,
    pub context_window: u64,
    pub configured: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum Connection {
    Connecting,
    Ready,
    Lost { reason: String },
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
#[allow(clippy::large_enum_variant)]
pub enum Update {
    Connection { state: Connection },
    Projects { projects: Vec<Project> },
    Threads { threads: Vec<ThreadRow> },
    ArchivedThreads { request: String, threads: Vec<ThreadRow> },
    ThreadStarted { draft: String, thread: String },
    Thread { thread: String, info: ThreadInfo },
    Transcript { thread: String, op: TranscriptOp },
    Approvals { thread: String, approvals: Vec<Approval> },
    Queue { thread: String, queued: Vec<QueuedMessage> },
    ComposerText { thread: String, text: String },
    Models { models: Vec<ModelOption>, favorites: Vec<ModelKey> },
    Commands { request: String, commands: Vec<SlashCommand> },
    Notification { thread: String, kind: NotificationKind, title: String, body: String },
    GitStatus { project: String, status: GitStatus },
    Branches { request: String, branches: Vec<Branch>, total: u32 },
    Diff { request: String, files: Vec<FileDiff> },
    Files { request: String, entries: Vec<FileEntry> },
    FileContent { request: String, path: String, content: FileContent },
    SearchResults { request: String, results: Vec<SearchHit> },
    PullRequests { request: String, pulls: Vec<PullRequest> },
    TerminalOpened { request: String, terminal: String },
    TerminalOutput { terminal: String, data: Vec<u8> },
    TerminalExited { terminal: String, code: Option<i32> },
    Usage { request: String, report: UsageReport },
    Local { request: String, snapshot: LocalSnapshot },
    Providers { providers: Vec<ProviderStatus> },
    Settings { settings: Settings },
    Keybindings { bindings: Vec<Keybinding> },
    RequestDone { request: String, message: String },
    RequestFailed { request: String, message: String },
    Notice { level: NoticeLevel, text: String },
}
