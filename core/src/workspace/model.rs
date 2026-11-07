use serde::{Deserialize, Serialize};

use crate::model::AccessMode;

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum DiffScope {
    WorkingTree,
    Branch { base: Option<String> },
    LatestTurn { thread: String },
    Turn { thread: String, turn: u64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum UsagePeriod {
    Day,
    Week,
    Month,
    Quarter,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum LocalAction {
    ScanTailnet,
    Deploy { ip: String, name: String },
    Connect { url: String },
    Disconnect { url: String },
    Rename { controller: String, name: String },
    RunRecipe { controller: String, recipe: String, replace: bool },
    StopRun { controller: String, run: String },
    StopPort { controller: String, port: u16 },
    Registry { controller: String, all: bool },
    Inspect { controller: String, record: String },
    Download { controller: String, record: String },
    PreviewShare { controller: String, port: u16 },
    Share { controller: String, port: u16 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct GitStatus {
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub dirty: bool,
    pub default_branch: Option<String>,
    pub pull_request: Option<PullRequest>,
    pub is_repo: bool,
    pub changed_files: u32,
    pub has_remote: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct Branch {
    pub name: String,
    pub remote: bool,
    pub current: bool,
    pub worktree: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct DiffHunk {
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct DiffLine {
    pub kind: DiffLineKind,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum DiffLineKind {
    Context,
    Added,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct FileEntry {
    pub name: String,
    pub relative: String,
    pub directory: bool,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum FileContent {
    Text { text: String, language: Option<String> },
    Image { mime_type: String, data: Vec<u8> },
    Binary { size: u64 },
    TooLarge { size: u64 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct SearchHit {
    pub relative: String,
    pub line: Option<u32>,
    pub preview: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub state: String,
    pub checks: String,
    pub head: String,
    pub base: String,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct UsageReport {
    pub period: UsagePeriod,
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
    pub requests: u64,
    pub by_model: Vec<UsageByModel>,
    pub daily: Vec<UsageDay>,
    pub limits: Vec<UsageLimit>,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct UsageLimit {
    pub provider: String,
    pub window: String,
    pub used_percent: Option<f64>,
    pub resets_at: Option<i64>,
    pub parked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct PullRequestDetail {
    pub pull: PullRequest,
    pub body: String,
    pub author: Option<String>,
    pub created_at: Option<i64>,
    pub files: Vec<FileDiff>,
    pub comments: Vec<PrComment>,
    pub timeline: Vec<PrEvent>,
    pub checks: Vec<PrCheck>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct PrComment {
    pub author: String,
    pub body: String,
    pub created_at: Option<i64>,
    pub path: Option<String>,
    pub line: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct PrEvent {
    pub kind: String,
    pub actor: Option<String>,
    pub created_at: Option<i64>,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct PrCheck {
    pub name: String,
    pub state: String,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum DevicePlatform {
    IosSimulator,
    AndroidEmulator,
    AndroidDevice,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct Device {
    pub id: String,
    pub name: String,
    pub platform: DevicePlatform,
    pub state: String,
    pub runtime: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
#[serde(default, rename_all = "camelCase")]
pub struct ProjectScript {
    pub id: String,
    pub name: String,
    pub command: String,
    pub icon: Option<String>,
    pub keybinding: Option<String>,
    pub run_on_worktree_setup: bool,
    pub wait_for_setup: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
#[serde(default, rename_all = "camelCase")]
pub struct ProjectSettings {
    pub default_provider: Option<String>,
    pub default_model: Option<String>,
    pub default_thinking_level: Option<String>,
    pub default_access: Option<AccessMode>,
    pub new_thread_workspace: Option<NewThreadWorkspace>,
    pub new_worktrees_start_from_origin: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum SetupStageState {
    Pending,
    Running,
    Done,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct SetupStage {
    pub name: String,
    pub state: SetupStageState,
    pub output_tail: String,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct UsageByModel {
    pub provider: String,
    pub model: String,
    pub tokens: u64,
    pub cost_usd: f64,
    pub requests: u64,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct UsageDay {
    pub day: String,
    pub tokens: u64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct ProviderStatus {
    pub id: String,
    pub name: String,
    pub configured: bool,
    pub model_count: u32,
    pub auth: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct Keybinding {
    pub command: String,
    pub title: String,
    pub shortcut: Option<String>,
    pub default_shortcut: Option<String>,
    pub when: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
#[serde(rename_all = "camelCase")]
pub enum NewThreadWorkspace {
    #[default]
    Local,
    Worktree,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
#[serde(rename_all = "camelCase")]
pub enum NotificationMode {
    #[default]
    Off,
    Notifications,
    Sound,
    NotificationsAndSound,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
#[serde(rename_all = "camelCase")]
pub enum TimeFormat {
    #[default]
    Locale,
    TwelveHour,
    TwentyFourHour,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
#[serde(rename_all = "camelCase")]
pub enum ResponseStreaming {
    Turn,
    #[default]
    Paragraph,
    Token,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
#[serde(rename_all = "camelCase")]
pub enum DiffLayout {
    #[default]
    Stacked,
    Split,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
#[serde(rename_all = "camelCase")]
pub enum SendShortcut {
    #[default]
    Enter,
    ModEnterMultiline,
    ModEnter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
#[serde(rename_all = "camelCase")]
pub enum FollowUpBehavior {
    #[default]
    Queue,
    Steer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
#[serde(rename_all = "camelCase")]
pub enum QuitConfirmation {
    Direct,
    #[default]
    Hold,
    DoubleClick,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
#[serde(rename_all = "camelCase")]
pub enum ColorScheme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
#[serde(rename_all = "camelCase")]
pub enum DiffColors {
    #[default]
    RedGreen,
    BlueOrange,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
#[serde(rename_all = "camelCase")]
pub enum ChatWidth {
    #[default]
    Normal,
    Wide,
    Full,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
#[serde(rename_all = "camelCase")]
pub enum LinkTarget {
    #[default]
    System,
    App,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
#[serde(rename_all = "camelCase")]
pub enum MergeMethod {
    #[default]
    RepositoryDefault,
    Merge,
    Squash,
    Rebase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
#[serde(rename_all = "camelCase")]
pub enum WritingStyle {
    #[default]
    RepoConventions,
    ConventionalCommits,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
#[serde(rename_all = "camelCase")]
pub enum SnapshotSound {
    #[default]
    SoftPop,
    CameraShutter,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
#[serde(default, rename_all = "camelCase")]
#[allow(clippy::struct_excessive_bools)]
pub struct Settings {
    pub default_provider: Option<String>,
    pub default_model: Option<String>,
    pub default_thinking_level: Option<String>,
    pub default_access: AccessMode,
    pub new_thread_workspace: NewThreadWorkspace,
    pub new_worktrees_start_from_origin: bool,
    pub working_section: bool,
    pub auto_settle_merged: bool,
    pub auto_settle_inactive: bool,
    pub auto_settle_inactive_days: u32,
    pub notifications: NotificationMode,
    pub in_app_notifications: bool,
    pub time_format: TimeFormat,
    pub response_streaming: ResponseStreaming,
    pub hide_whitespace: bool,
    pub diff_files_collapsed: bool,
    pub diff_layout: DiffLayout,
    pub proactive_panels: bool,
    pub show_skills_in_slash_menu: bool,
    pub rich_text_composer: bool,
    pub collapse_composer_on_scroll: bool,
    pub send_shortcut: SendShortcut,
    pub vim_mode: bool,
    pub follow_up_behavior: FollowUpBehavior,
    pub continue_threads_after_restart: bool,
    pub add_project_base_directory: String,
    pub confirm_unpin: bool,
    pub confirm_archive: bool,
    pub confirm_delete: bool,
    pub quit_confirmation: QuitConfirmation,
    pub text_generation_provider: Option<String>,
    pub text_generation_model: Option<String>,
    pub context_window_meter: bool,
    pub color_scheme: ColorScheme,
    pub theme: Option<String>,
    pub contrast: u32,
    pub diff_colors: DiffColors,
    pub chat_width: ChatWidth,
    pub interface_font: String,
    pub interface_font_size: u32,
    pub prompt_font: String,
    pub prompt_font_size: u32,
    pub code_font: String,
    pub code_font_size: u32,
    pub terminal_font: String,
    pub terminal_font_size: u32,
    pub terminal_scrollback: u32,
    pub terminal_cursor_blink: bool,
    pub font_smoothing: bool,
    pub word_wrap: bool,
    pub open_links_in: LinkTarget,
    pub auto_pull: bool,
    pub merge_method: MergeMethod,
    pub git_fetch_interval_seconds: u32,
    pub writing_style: WritingStyle,
    pub writing_instructions: String,
    pub follow_pr_templates: bool,
    pub source_control_provider: Option<String>,
    pub source_control_model: Option<String>,
    pub worktree_cleanup_after_days: Option<u32>,
    pub worktree_cleanup_on_merge: bool,
    pub worktree_cleanup_on_delete: bool,
    pub worktree_cleanup_unchanged: bool,
    pub local_controller_url: String,
    pub fleet_key: String,
    pub start_controller: bool,
    pub onboarding_completed: bool,
    pub custom_themes: String,
    pub glass_opacity: u32,
    pub snapshot_enabled: bool,
    pub snapshot_include_text: bool,
    pub snapshot_play_sound: bool,
    pub snapshot_sound: SnapshotSound,
    pub snapshot_flash: bool,
    pub snapshot_animations: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            default_provider: None,
            default_model: None,
            default_thinking_level: None,
            default_access: AccessMode::default(),
            new_thread_workspace: NewThreadWorkspace::Local,
            new_worktrees_start_from_origin: true,
            working_section: false,
            auto_settle_merged: true,
            auto_settle_inactive: true,
            auto_settle_inactive_days: 3,
            notifications: NotificationMode::Off,
            in_app_notifications: false,
            time_format: TimeFormat::Locale,
            response_streaming: ResponseStreaming::Paragraph,
            hide_whitespace: true,
            diff_files_collapsed: true,
            diff_layout: DiffLayout::Stacked,
            proactive_panels: false,
            show_skills_in_slash_menu: true,
            rich_text_composer: true,
            collapse_composer_on_scroll: true,
            send_shortcut: SendShortcut::Enter,
            vim_mode: false,
            follow_up_behavior: FollowUpBehavior::Queue,
            continue_threads_after_restart: false,
            add_project_base_directory: String::new(),
            confirm_unpin: false,
            confirm_archive: false,
            confirm_delete: true,
            quit_confirmation: QuitConfirmation::Hold,
            text_generation_provider: None,
            text_generation_model: None,
            context_window_meter: false,
            color_scheme: ColorScheme::System,
            theme: None,
            contrast: 100,
            diff_colors: DiffColors::RedGreen,
            chat_width: ChatWidth::Normal,
            interface_font: String::new(),
            interface_font_size: 13,
            prompt_font: String::new(),
            prompt_font_size: 14,
            code_font: String::new(),
            code_font_size: 12,
            terminal_font: String::new(),
            terminal_font_size: 12,
            terminal_scrollback: 10_000,
            terminal_cursor_blink: false,
            font_smoothing: true,
            word_wrap: true,
            open_links_in: LinkTarget::System,
            auto_pull: false,
            merge_method: MergeMethod::RepositoryDefault,
            git_fetch_interval_seconds: 30,
            writing_style: WritingStyle::RepoConventions,
            writing_instructions: String::new(),
            follow_pr_templates: true,
            source_control_provider: None,
            source_control_model: None,
            worktree_cleanup_after_days: None,
            worktree_cleanup_on_merge: false,
            worktree_cleanup_on_delete: false,
            worktree_cleanup_unchanged: false,
            local_controller_url: String::new(),
            fleet_key: String::new(),
            start_controller: true,
            onboarding_completed: false,
            custom_themes: String::new(),
            glass_opacity: 80,
            snapshot_enabled: false,
            snapshot_include_text: true,
            snapshot_play_sound: true,
            snapshot_sound: SnapshotSound::SoftPop,
            snapshot_flash: true,
            snapshot_animations: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct LocalSnapshot {
    pub controllers: Vec<LocalController>,
    pub registry: Option<LocalRegistry>,
    pub usage: LocalUsage,
    pub tailnet: Option<LocalTailnet>,
    pub record: Option<LocalRecord>,
    pub share: Option<LocalShare>,
    pub auto_model: Option<String>,
    pub generated_at: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct LocalController {
    pub target: String,
    pub url: String,
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub local: bool,
    pub reachable: bool,
    pub error: Option<String>,
    pub version: Option<String>,
    pub hardware: Option<LocalHardware>,
    pub endpoints: Vec<LocalEndpoint>,
    pub jobs: Vec<LocalJob>,
    pub recipes: Vec<LocalRecipe>,
    pub requests: u64,
    pub tokens: u64,
    pub measured_requests: u64,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct LocalHardware {
    pub cpus: u32,
    pub memory_total_bytes: u64,
    pub memory_free_bytes: u64,
    pub gpus: Vec<LocalGpu>,
    pub memory_used_bytes: u64,
    pub memory_capacity_bytes: u64,
    pub memory_label: String,
    pub gpu_summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct LocalGpu {
    pub index: u32,
    pub name: String,
    pub card: Option<String>,
    pub memory_used_mib: u64,
    pub memory_total_mib: u64,
    pub busy: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct LocalEndpoint {
    pub id: String,
    pub controller_id: String,
    pub port: u16,
    pub pid: Option<u32>,
    pub models: Vec<String>,
    pub live: bool,
    pub job_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct LocalJob {
    pub id: String,
    pub recipe_id: String,
    pub port: u16,
    pub phase: String,
    pub progress: Option<f64>,
    pub message: Option<String>,
    pub failed: bool,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct LocalRecipe {
    pub id: String,
    pub model: String,
    pub card: String,
    pub engine: String,
    pub cards: u32,
    pub context: u64,
    pub tokens_per_second: Option<f64>,
    pub fits: bool,
    pub blocked: Option<String>,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct LocalRegistry {
    pub controller: String,
    pub all: bool,
    pub commit: Option<String>,
    pub error: Option<String>,
    pub matches: Vec<LocalRegistryMatch>,
    pub total: u32,
    pub models: Vec<RegistryModel>,
    pub downloads: Vec<LocalDownload>,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct LocalRegistryMatch {
    pub name: String,
    pub memory_gb: Option<f64>,
    pub count: u32,
    pub hardware_id: Option<String>,
    pub hardware_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct RegistryModel {
    pub repo: String,
    pub variants: Vec<RegistryVariant>,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct RegistryVariant {
    pub id: String,
    pub status: String,
    pub engine: String,
    pub hardware_id: String,
    pub hardware_count: u32,
    pub format: Option<String>,
    pub precision: Option<String>,
    pub size_gb: Option<f64>,
    pub launch_kind: String,
    pub evidence: bool,
    pub recommended: bool,
    pub fits: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct LocalDownload {
    pub recipe: String,
    pub state: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct LocalRecord {
    pub controller: String,
    pub id: String,
    pub command: Option<String>,
    pub weights_repo: Option<String>,
    pub weights_revision: Option<String>,
    pub weights_include: Option<String>,
    pub recipe_json: String,
    pub model_instance_json: String,
    pub model_json: String,
    pub hardware_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct LocalShare {
    pub controller: String,
    pub port: u16,
    pub target: String,
    pub branch: String,
    pub title: String,
    pub body: String,
    pub files: Vec<String>,
    pub reused: Vec<String>,
    pub redactions: Vec<String>,
    pub issues: Vec<String>,
    pub blockers: Vec<String>,
    pub pull_request_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Default)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct LocalUsage {
    pub today_tokens: u64,
    pub week_tokens: u64,
    pub all_tokens: u64,
    pub requests: u64,
    pub measured_requests: u64,
    pub daily: Vec<UsageDay>,
    pub models: Vec<LocalModelUsage>,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct LocalModelUsage {
    pub model: String,
    pub requests: u64,
    pub share_percent: f64,
    pub tokens: u64,
    pub measured: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct LocalTailnet {
    pub available: bool,
    pub devices: Vec<TailnetDevice>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct TailnetDevice {
    pub name: String,
    pub ip: String,
    pub os: String,
    pub controller_url: Option<String>,
    pub controller_name: Option<String>,
    pub linked: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum TerminalColor {
    Default,
    Palette { index: u8 },
    Rgb { red: u8, green: u8, blue: u8 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum TerminalUnderline {
    None,
    Single,
    Double,
    Curly,
    Dotted,
    Dashed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
#[allow(clippy::struct_excessive_bools)]
pub struct TerminalStyle {
    pub foreground: TerminalColor,
    pub background: TerminalColor,
    pub underline_color: TerminalColor,
    pub underline: TerminalUnderline,
    pub bold: bool,
    pub italic: bool,
    pub faint: bool,
    pub blink: bool,
    pub inverse: bool,
    pub invisible: bool,
    pub strikethrough: bool,
    pub overline: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct TerminalRun {
    pub column: u16,
    pub cells: u16,
    pub wide: bool,
    pub text: String,
    pub style: TerminalStyle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct TerminalSpan {
    pub start: u16,
    pub end: u16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct TerminalRow {
    pub index: u16,
    pub runs: Vec<TerminalRun>,
    pub selection: Option<TerminalSpan>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum TerminalCursorShape {
    Block,
    Bar,
    Underline,
    BlockHollow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct TerminalCursor {
    pub column: u16,
    pub row: u16,
    pub visible: bool,
    pub shape: TerminalCursorShape,
    pub blinking: bool,
    pub wide: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
#[allow(clippy::struct_excessive_bools)]
pub struct TerminalFrame {
    pub cols: u16,
    pub rows: u16,
    pub full: bool,
    pub dirty: Vec<TerminalRow>,
    pub cursor: TerminalCursor,
    pub scrollback_len: u64,
    pub viewport_offset: u64,
    pub title: Option<String>,
    pub bell: bool,
    pub has_selection: bool,
    pub mouse_tracking: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct TerminalSize {
    pub cols: u16,
    pub rows: u16,
    pub cell_width: u32,
    pub cell_height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
#[allow(clippy::struct_excessive_bools)]
pub struct TerminalMods {
    pub shift: bool,
    pub control: bool,
    pub alt: bool,
    pub super_key: bool,
    pub caps_lock: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum TerminalKeyAction {
    Press,
    Release,
    Repeat,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct TerminalKey {
    pub action: TerminalKeyAction,
    pub code: u32,
    pub mods: TerminalMods,
    pub text: Option<String>,
    pub unshifted: u32,
    pub composing: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum TerminalMouseAction {
    Press,
    Release,
    Motion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum TerminalMouseButton {
    Left,
    Right,
    Middle,
}

#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct TerminalMouse {
    pub action: TerminalMouseAction,
    pub button: Option<TerminalMouseButton>,
    pub x: f64,
    pub y: f64,
    pub mods: TerminalMods,
}

#[derive(Debug, Clone, Copy, PartialEq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct TerminalScroll {
    pub lines: i32,
    pub x: f64,
    pub y: f64,
    pub mods: TerminalMods,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct TerminalPoint {
    pub column: u16,
    pub row: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum TerminalSelect {
    All,
    Clear,
    Range { start: TerminalPoint, end: TerminalPoint },
    Word { at: TerminalPoint },
    Line { at: TerminalPoint },
}

#[derive(Debug, Clone, PartialEq, Default)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct LocalDashboard {
    pub controller: String,
    pub error: Option<String>,
    pub engines: Vec<LocalEngineTelemetry>,
    pub decode_tps: Option<f64>,
    pub per_request_tps: Option<f64>,
    pub running: Option<u32>,
    pub running_peak: Option<u32>,
    pub waiting: Option<u32>,
    pub kv_percent: Option<f64>,
    pub kv_peak_percent: Option<f64>,
    pub first_token_ms: Option<f64>,
    pub first_token_best_ms: Option<f64>,
    pub power_watts: Option<f64>,
    pub power_limit_watts: Option<f64>,
    pub gpu_name: String,
    pub gpus: Vec<LocalGpuTelemetry>,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
    pub decode_series: Vec<f64>,
    pub decode_series_start_ms: i64,
    pub decode_series_step_ms: i64,
    pub tokens: LocalTokenHistory,
    pub generated_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct LocalEngineTelemetry {
    pub port: u16,
    pub models: Vec<String>,
    pub kind: Option<String>,
    pub loaded_at_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct LocalGpuTelemetry {
    pub index: u32,
    pub name: String,
    pub memory_used_mib: u64,
    pub memory_total_mib: u64,
    pub power_watts: Option<f64>,
    pub power_limit_watts: Option<f64>,
    pub temperature_c: Option<f64>,
    pub utilization: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct LocalTokenHistory {
    pub since_day: Option<String>,
    pub total: u64,
    pub read: u64,
    pub written: u64,
    pub last_week: u64,
    pub busiest_day: Option<String>,
    pub busiest_tokens: u64,
    pub active_days: u32,
    pub tracked_days: u32,
    pub daily: Vec<u64>,
    pub last_day: String,
}
