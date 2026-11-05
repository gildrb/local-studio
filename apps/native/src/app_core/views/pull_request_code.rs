use std::collections::HashMap;

use serde::Deserialize;

use super::pull_request_summary::{BodyView, MarkdownEditorView, ReactionBarModel};
use super::pull_requests::{PullRequestActorModel, PullRequestDiffStatModel};
use super::right_panel_diff::{DiffChangeIcon, DiffRow};

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScopeOptionModel {
    pub value: String,
    pub label: String,
    pub short_oid: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScopeModel {
    pub visible: bool,
    pub label: String,
    pub aria_label: String,
    pub value: String,
    pub options: Vec<ScopeOptionModel>,
    pub show_more_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WarningModel {
    pub id: String,
    pub aria_label: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ViewedCountModel {
    pub count_label: String,
    pub suffix: String,
    pub warnings: Vec<WarningModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PressedLabelModel {
    pub pressed: bool,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CollapseAllModel {
    pub visible: bool,
    pub all_collapsed: bool,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayoutOptionModel {
    pub value: String,
    pub aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayoutModel {
    pub value: String,
    pub aria_label: String,
    pub options: Vec<LayoutOptionModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WordWrapModel {
    pub pressed: bool,
    pub aria_label: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeToggleModel {
    pub visible: bool,
    pub pressed: bool,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolbarModel {
    pub scope: ScopeModel,
    pub file_count_label: String,
    pub viewed: Option<ViewedCountModel>,
    pub warnings: Vec<WarningModel>,
    pub whitespace: PressedLabelModel,
    pub collapse_all: CollapseAllModel,
    pub layout: LayoutModel,
    pub word_wrap: WordWrapModel,
    pub file_tree: FileTreeToggleModel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum CodeBodyModel {
    Loading { label: String },
    Error { message: String },
    Raw,
    Empty { message: String },
    Files,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum CodeFooterModel {
    None,
    Error {
        message: String,
        retry_label: String,
    },
    Loading {
        label: String,
    },
    Idle,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileViewedModel {
    pub checked: bool,
    pub stale: bool,
    pub aria_label: String,
    pub label: String,
    pub stale_tooltip: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileHeaderModel {
    pub diff_stat: Option<PullRequestDiffStatModel>,
    pub viewed: Option<FileViewedModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileRowModel {
    pub key: String,
    pub path: String,
    pub collapsed: bool,
    pub collapse_aria_label: String,
    pub header: FileHeaderModel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrphanThreadModel {
    pub id: String,
    pub line_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrphanFileModel {
    pub path: String,
    pub threads: Vec<OrphanThreadModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrphansModel {
    pub heading: String,
    pub count_label: String,
    pub files: Vec<OrphanFileModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TreeFooterModel {
    pub label: String,
    pub disabled: bool,
    pub action: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeMetaModel {
    pub aria_label: String,
    pub footer: Option<TreeFooterModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodeTabModel {
    pub toolbar: ToolbarModel,
    pub body: CodeBodyModel,
    pub files: Vec<FileRowModel>,
    pub orphans: Option<OrphansModel>,
    pub footer: CodeFooterModel,
    pub file_tree: FileTreeMetaModel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum CodeSegmentView {
    Rows {
        rows: Vec<DiffRow>,
        lines: Vec<Option<LineAnchorView>>,
    },
    Annotations {
        thread_ids: Vec<String>,
        pending_ids: Vec<String>,
        draft: bool,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodeFileView {
    pub key: String,
    pub path: String,
    pub change_icon: DiffChangeIcon,
    pub segments: Vec<CodeSegmentView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LabelDisabledModel {
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReplyModel {
    pub label: String,
    pub placeholder: String,
    pub aria_label: String,
    pub cancel_label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThreadCommentView {
    pub id: String,
    pub author: PullRequestActorModel,
    pub time: String,
    pub body: BodyView,
    pub can_edit: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodeThreadView {
    pub id: String,
    pub resolved: bool,
    pub status_label: String,
    pub outdated_label: Option<String>,
    pub fix: Option<LabelDisabledModel>,
    pub resolve: Option<LabelDisabledModel>,
    pub load_more: Option<LabelDisabledModel>,
    pub reply: Option<ReplyModel>,
    pub reply_revision: u64,
    pub edit_label: String,
    pub comments: Vec<ThreadCommentView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TreeToggleAllModel {
    pub expanded: bool,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TreeHeaderModel {
    pub title: String,
    pub file_count: u64,
    pub toggle_all_directories: Option<TreeToggleAllModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum TreeRowModel {
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
        tone: String,
        selected: bool,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TreeModel {
    pub header: TreeHeaderModel,
    pub rows: Vec<TreeRowModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RawSliceView {
    pub reason: String,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RevealView {
    pub key: String,
    pub revision: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestCodeView {
    pub active: bool,
    pub model: CodeTabModel,
    pub files: Vec<CodeFileView>,
    pub threads: HashMap<String, CodeThreadView>,
    pub reactions: HashMap<String, ReactionBarModel>,
    pub reaction_picker: Option<String>,
    pub raw: Vec<RawSliceView>,
    pub tree: Option<TreeModel>,
    pub word_wrap: bool,
    pub layout: String,
    pub orphans_open: bool,
    pub reveal: Option<RevealView>,
    pub editor: Option<MarkdownEditorView>,
    pub editor_thread_id: Option<String>,
    pub can_comment_on_lines: bool,
    pub pending: HashMap<String, PendingCommentView>,
    pub pending_label: String,
    pub pending_remove_label: String,
    pub draft: Option<DraftView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingCommentView {
    pub body: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DraftSelectionView {
    pub file_key: String,
    pub start_side: String,
    pub start_line: u32,
    pub side: String,
    pub line: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DraftView {
    pub revision: u64,
    pub selection: DraftSelectionView,
    pub range_label: String,
    pub aria_label: String,
    pub placeholder: String,
    pub hint: String,
    pub cancel_label: String,
    pub submit_label: String,
    pub secondary_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LineAnchorView {
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
}
