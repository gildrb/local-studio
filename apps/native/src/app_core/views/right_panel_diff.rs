use serde::Deserialize;

use crate::app_core::views::pierre_icon::PierreIconView;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyntaxToken {
    pub text: String,
    pub dark: Option<String>,
    pub light: Option<String>,
    #[serde(default)]
    pub font_style: Option<u8>,
    #[serde(default)]
    pub emphasis: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffStatView {
    pub additions_text: String,
    pub deletions_text: String,
    pub aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffScopeOptionView {
    pub value: String,
    pub label: String,
    pub selected: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffTurnOptionView {
    pub value: String,
    pub label: String,
    pub timestamp_label: String,
    pub selected: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffScopeView {
    pub label: String,
    pub aria_label: String,
    pub options: Vec<DiffScopeOptionView>,
    pub turn_menu_label: String,
    pub turn_options: Vec<DiffTurnOptionView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum DiffRemoteToggleView {
    Switch { checked: bool, aria_label: String },
    RemoteOnly { label: String },
    None,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffBaseRefChoiceView {
    pub id: String,
    pub value: String,
    pub label: String,
    pub selected: bool,
    pub remote_toggle: DiffRemoteToggleView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffBaseRefAutomaticView {
    pub value: String,
    pub label: String,
    pub selected: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffBaseRefView {
    pub head_label: String,
    pub base_ref: String,
    pub tooltip: String,
    pub trigger_aria_label: String,
    pub query: String,
    pub search_placeholder: String,
    pub empty_label: String,
    pub branch_column_label: String,
    pub remote_column_label: String,
    pub automatic: Option<DiffBaseRefAutomaticView>,
    pub choices: Vec<DiffBaseRefChoiceView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffRefreshView {
    pub refreshing: bool,
    pub aria_label: String,
    pub tooltip: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DiffCollapseIcon {
    ChevronsUpDown,
    ChevronsDownUp,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffCollapseAllView {
    pub icon: DiffCollapseIcon,
    pub aria_label: String,
    pub tooltip: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DiffLayoutValue {
    Stacked,
    Split,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DiffLayoutIcon {
    #[serde(rename = "rows-3")]
    Rows3,
    #[serde(rename = "columns-2")]
    Columns2,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffLayoutOptionView {
    pub value: DiffLayoutValue,
    pub aria_label: String,
    pub icon: DiffLayoutIcon,
    pub selected: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffLayoutView {
    pub value: DiffLayoutValue,
    pub options: Vec<DiffLayoutOptionView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffToggleView {
    pub pressed: bool,
    pub aria_label: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffHeaderView {
    pub scope: DiffScopeView,
    pub base_ref: Option<DiffBaseRefView>,
    pub stat: Option<DiffStatView>,
    pub refresh: Option<DiffRefreshView>,
    pub collapse_all: Option<DiffCollapseAllView>,
    pub layout: DiffLayoutView,
    pub word_wrap: DiffToggleView,
    pub whitespace: DiffToggleView,
    pub file_tree: Option<DiffToggleView>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DiffLineKind {
    Context,
    Addition,
    Deletion,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DiffFileTone {
    Addition,
    Deletion,
    Modified,
    Muted,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DiffChangeIcon {
    Added,
    Deleted,
    Modified,
    Moved,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffSideLine {
    pub line_kind: DiffLineKind,
    pub number: Option<u32>,
    pub tokens: Vec<SyntaxToken>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "style",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum DiffFileStatView {
    Label {
        additions_text: String,
        deletions_text: String,
    },
    Counts {
        additions_text: String,
        deletions_text: String,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DiffLoadStatusKind {
    Error,
    Truncated,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffLoadStatusView {
    pub kind: DiffLoadStatusKind,
    pub tooltip: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DiffCopyIcon {
    Copy,
    Check,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffCopyView {
    pub aria_label: String,
    pub tooltip: String,
    pub icon: DiffCopyIcon,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffSeparatorExpand {
    pub hunk_index: u32,
    pub buttons: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum DiffCommentEntry {
    Comment {
        id: String,
        range_label: String,
        text: String,
        delete_label: String,
    },
    Draft {
        id: String,
        range_label: String,
        aria_label: String,
        placeholder: String,
        submit_label: String,
        cancel_label: String,
        send_hint: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum DiffRow {
    FileHeader {
        file_key: String,
        path: String,
        tone: DiffFileTone,
        change_icon: DiffChangeIcon,
        collapsed: bool,
        toggle_disabled: bool,
        toggle_tooltip: String,
        copy: DiffCopyView,
        stat: DiffFileStatView,
        load_status: Option<DiffLoadStatusView>,
    },
    Separator {
        label: String,
        #[serde(default)]
        expand: Option<DiffSeparatorExpand>,
    },
    Line {
        gutter_digits: u32,
        line: DiffSideLine,
    },
    Split {
        gutter_digits: u32,
        left: Option<DiffSideLine>,
        right: Option<DiffSideLine>,
    },
    Comments {
        file_key: String,
        has_draft: bool,
        entries: Vec<DiffCommentEntry>,
    },
    FileEnd,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum DiffTreeRow {
    Directory {
        path: String,
        name: String,
        depth: u32,
        expanded: bool,
    },
    File {
        path: String,
        name: String,
        depth: u32,
        status_letter: Option<String>,
        status_title: String,
        icon: PierreIconView,
        tone: String,
        selected: bool,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffTreeToggleAllView {
    pub icon: DiffCollapseIcon,
    pub aria_label: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffFileTreeView {
    pub title: String,
    pub file_count: u32,
    pub toggle_all: Option<DiffTreeToggleAllView>,
    pub rows: Vec<DiffTreeRow>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DiffViewLayout {
    Unified,
    Split,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiffScrollTarget {
    pub file_key: String,
    pub key: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum DiffContentView {
    Loading {
        label: String,
    },
    Empty {
        message: String,
    },
    Raw {
        reason: String,
        text: String,
    },
    Files {
        layout: DiffViewLayout,
        wrap: bool,
        rows: Vec<DiffRow>,
        line_selection: bool,
        pending_count: u32,
        load_more_key: Option<String>,
        scroll_target: Option<DiffScrollTarget>,
        file_tree: Option<DiffFileTreeView>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum DiffBodyView {
    Message {
        message: String,
    },
    Content {
        notice: Option<String>,
        error: Option<String>,
        view: Box<DiffContentView>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RightPanelDiffView {
    pub thread_key: String,
    pub header: DiffHeaderView,
    pub body: DiffBodyView,
}
