use serde::Deserialize;

use crate::app_core::views::markdown::MarkdownDocView;
use crate::app_core::views::pierre_icon::PierreIconView;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WorkIconName {
    Bot,
    Brain,
    Browser,
    Check,
    CircleAlert,
    Computer,
    Device,
    Eye,
    Globe,
    Hammer,
    MessageCircle,
    Search,
    SquarePen,
    Terminal,
    PullRequest,
    #[serde(rename = "t3-code")]
    T3Code,
    Wrench,
    X,
    Zap,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WorkIconTone {
    Warning,
    Destructive,
    Failed,
    IconMuted,
    Foreground,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WorkHeadingTone {
    Warning,
    Destructive,
    SecondaryLabel,
    #[serde(rename = "foreground-80")]
    Foreground80,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkIconView {
    pub name: WorkIconName,
    pub image_url: Option<String>,
    pub image_url_dark: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkEntryView {
    pub id: String,
    pub label: String,
    pub answer_preview: Option<String>,
    pub answer_highlighted: bool,
    pub icon: WorkIconView,
    pub icon_tone: WorkIconTone,
    pub heading_tone: WorkHeadingTone,
    pub show_trailing_failure_mark: bool,
    pub can_expand: bool,
    pub expanded: bool,
    pub expanded_body: Option<String>,
    pub time_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiveActivityView {
    pub label: String,
    pub answer_preview: Option<String>,
    pub icon: WorkIconView,
    pub failed: bool,
    pub show_trailing_failure_mark: bool,
    pub shine: bool,
    pub shimmer: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ActivityDetailView {
    Work {
        id: String,
        entries: Vec<WorkEntryView>,
    },
    Reasoning(Box<ReasoningTraceView>),
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReasoningTraceView {
    pub id: String,
    pub message_id: String,
    pub show_header: bool,
    pub expanded: bool,
    pub streaming: bool,
    pub header_text: String,
    pub documents: Vec<MarkdownDocView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkingView {
    pub label: String,
    pub compacting: bool,
    pub shimmer: bool,
    pub timer_started_at: Option<String>,
    pub timer_text: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkToggleRowView {
    pub id: String,
    pub group_id: String,
    pub summary: String,
    pub icon: WorkIconView,
    pub expanded: bool,
    pub has_failure: bool,
    pub time_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkRowView {
    pub id: String,
    pub expanded_group: bool,
    pub entries: Vec<WorkEntryView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkLiveRowView {
    pub id: String,
    pub group_id: String,
    pub expanded: bool,
    pub activity: LiveActivityView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActivityGroupRowView {
    pub id: String,
    pub group_id: String,
    pub expanded: bool,
    pub activity: LiveActivityView,
    pub details: Vec<ActivityDetailView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkingRowView {
    pub id: String,
    pub working: WorkingView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffStatView {
    pub additions_text: String,
    pub deletions_text: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FolderIcon {
    FolderOpen,
    FolderClosed,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ChangedFilesNodeView {
    Directory {
        key: String,
        path: String,
        name: String,
        indent_px: f32,
        expanded: bool,
        icon: FolderIcon,
        stat: Option<DiffStatView>,
        children: Vec<ChangedFilesNodeView>,
    },
    File {
        key: String,
        path: String,
        name: String,
        indent_px: f32,
        show_leading_spacer: bool,
        icon: PierreIconView,
        stat: Option<DiffStatView>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ToggleAllIcon {
    ChevronsDownUp,
    ChevronsUpDown,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFilesToggleAllView {
    pub expanded: bool,
    pub tooltip: String,
    pub icon: ToggleAllIcon,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFilesOpenDiffView {
    pub label: String,
    pub tooltip: String,
    pub file_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFilesCardView {
    pub turn_id: String,
    pub count_label: String,
    pub stat: Option<DiffStatView>,
    pub toggle_all: Option<ChangedFilesToggleAllView>,
    pub open_diff: ChangedFilesOpenDiffView,
    pub all_directories_expanded: bool,
    pub expansion_key: String,
    pub nodes: Vec<ChangedFilesNodeView>,
}
