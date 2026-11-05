use serde::Deserialize;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ProjectIconColor {
    Gray,
    Red,
    Orange,
    Amber,
    Yellow,
    Lime,
    Green,
    Emerald,
    Teal,
    Cyan,
    Sky,
    Blue,
    Indigo,
    Violet,
    Purple,
    Fuchsia,
    Pink,
    Rose,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum EnvironmentMachineKind {
    Server,
    Cloud,
    Linux,
    Desktop,
    Laptop,
    MacMini,
    MacStudio,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct MonogramFallback {
    pub text: String,
    pub color: ProjectIconColor,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ProjectIconView {
    Monogram {
        text: String,
        color: ProjectIconColor,
    },
    Emoji {
        emoji: String,
    },
    Lucide {
        name: String,
        color: ProjectIconColor,
    },
    Image {
        url: String,
        fallback: Option<MonogramFallback>,
    },
    Folder,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SidebarView {
    pub header: SidebarHeaderView,
    pub items: Vec<SidebarItemView>,
    pub empty_state: Option<SidebarEmptyStateView>,
    pub footer: SidebarFooterView,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StageBackdrop {
    Dev,
    Nightly,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SidebarSearchView {
    pub placeholder: String,
    pub query: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScopedProjectView {
    pub project_key: String,
    pub display_name: String,
    pub icon: ProjectIconView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScopeView {
    pub label: String,
    pub scoped_project: Option<ScopedProjectView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LabelView {
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NewThreadView {
    pub label: String,
    pub tooltip: String,
    pub in_project_hint: Option<String>,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SidebarHeaderView {
    pub brand_label: String,
    pub stage_backdrop: Option<StageBackdrop>,
    pub stage_pill: Option<String>,
    pub search: SidebarSearchView,
    pub has_projects: bool,
    pub project_scope: ProjectScopeView,
    pub add_project: LabelView,
    pub new_thread: NewThreadView,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SidebarSection {
    Pinned,
    Active,
    Working,
    Snoozed,
    Settled,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Shelf {
    Working,
    Snoozed,
    Settled,
}

impl Shelf {
    pub fn key(self) -> &'static str {
        match self {
            Shelf::Working => "working",
            Shelf::Snoozed => "snoozed",
            Shelf::Settled => "settled",
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SidebarItemView {
    Thread(Box<SidebarThreadRowView>),
    Draft(SidebarDraftRowView),
    DraftDivider,
    ShelfHeader(SidebarShelfHeaderView),
    ShowMore { label: String, count: u32 },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DraftRowProjectView {
    pub display_name: Option<String>,
    pub icon: Option<ProjectIconView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SidebarDraftRowView {
    pub key: String,
    pub draft_id: String,
    pub preview: String,
    pub accessibility_label: String,
    pub is_active: bool,
    pub project: DraftRowProjectView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnoozeMenuItemView {
    pub id: String,
    pub label: String,
    pub shortcut: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnoozeMenuView {
    pub items: Vec<SnoozeMenuItemView>,
    pub custom_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SidebarRenameView {
    pub thread_key: String,
    pub title: String,
    pub revision: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SidebarShelfHeaderView {
    pub shelf: Shelf,
    pub label: String,
    pub count: u32,
    pub expanded: bool,
    pub push_to_bottom: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SidebarThreadStatusKind {
    Working,
    Monitoring,
    Approval,
    Input,
    Failed,
    Woke,
    Done,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SidebarRowSurface {
    Active,
    Selected,
    Draft,
    Recede,
    Default,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SidebarTitleTone {
    Foreground,
    #[serde(rename = "foreground-95")]
    Foreground95,
    #[serde(rename = "foreground-90")]
    Foreground90,
    Secondary,
    #[serde(rename = "secondary-70")]
    Secondary70,
    Muted,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TitleWeight {
    Normal,
    Medium,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PullRequestGlyphKind {
    PullRequest,
    Draft,
    Closed,
    Merged,
    Stack,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PullRequestTone {
    Open,
    Draft,
    Closed,
    Merged,
    Muted,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RowVariant {
    Card,
    Slim,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RowAction {
    Settle,
    Unsettle,
    Unsnooze,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RowProjectView {
    pub display_name: Option<String>,
    pub icon: Option<ProjectIconView>,
    pub dimmed: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RowStatusView {
    pub kind: SidebarThreadStatusKind,
    pub label: String,
    pub working_started_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RowPinView {
    pub can_unpin: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RowActionsView {
    pub settle: bool,
    pub unsettle: bool,
    pub unsnooze: bool,
    pub snooze: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RowWorktreeView {
    pub display_path: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RowTerminalView {
    pub count: u32,
    pub label: String,
    pub pulse: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RowPullRequestView {
    pub glyph: PullRequestGlyphKind,
    pub tone: PullRequestTone,
    pub text: String,
    pub label: String,
    pub opens_list: bool,
    pub url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RowProviderView {
    pub driver_kind: String,
    pub display_name: String,
    pub initials: String,
    pub accent_color: Option<String>,
    pub show_badge: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SidebarThreadRowView {
    pub key: String,
    pub environment_id: String,
    pub thread_id: String,
    pub section: SidebarSection,
    pub variant: RowVariant,
    pub action: RowAction,
    pub title: String,
    pub title_tone: SidebarTitleTone,
    pub title_weight: TitleWeight,
    pub regenerating_title: bool,
    pub renaming: bool,
    pub accessibility_label: String,
    pub is_active: bool,
    pub surface: SidebarRowSurface,
    pub has_unsent_draft: bool,
    pub fade_row: bool,
    pub settled_dim: bool,
    pub project: RowProjectView,
    pub status: Option<RowStatusView>,
    pub time_label: String,
    pub snooze_wake_label: Option<String>,
    pub woke_at: Option<String>,
    pub pin: Option<RowPinView>,
    pub actions: RowActionsView,
    pub snooze_menu: Option<SnoozeMenuView>,
    pub branch: Option<String>,
    pub worktree: Option<RowWorktreeView>,
    pub terminal: Option<RowTerminalView>,
    pub pull_request: Option<RowPullRequestView>,
    pub remote_machine: Option<EnvironmentMachineKind>,
    pub provider: Option<RowProviderView>,
    pub jump_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SidebarEmptyStateView {
    NoProjects { label: String, action_label: String },
    NoThreads { label: String },
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FooterItemId {
    Settings,
    PullRequests,
    Usage,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FooterItemView {
    pub id: FooterItemId,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UndoNoticeView {
    pub text: String,
    pub action_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SidebarFooterView {
    pub undo_notice: Option<UndoNoticeView>,
    pub back: Option<FooterBackView>,
    pub items: Vec<FooterItemView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FooterBackView {
    pub label: String,
}
