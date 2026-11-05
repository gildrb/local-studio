use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitMenuItemView {
    pub key: String,
    pub id: String,
    pub label: String,
    pub disabled: bool,
    pub icon_id: String,
    pub disabled_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitPublishItemView {
    pub label: String,
    pub icon: String,
    pub disabled: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitNoticeTone {
    Warning,
    Destructive,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitMenuNoticeView {
    pub id: String,
    pub tone: GitNoticeTone,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitMenuView {
    pub items: Vec<GitMenuItemView>,
    pub publish_item: Option<GitPublishItemView>,
    pub notices: Vec<GitMenuNoticeView>,
    pub source_control_icon: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitFileView {
    pub path: String,
    pub insertions: u64,
    pub deletions: u64,
    pub excluded: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffTotals {
    pub insertions: u64,
    pub deletions: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDialogView {
    pub title: String,
    pub description: String,
    pub branch_label: String,
    pub branch_caption: String,
    pub is_default_ref: bool,
    pub default_branch_label: String,
    pub files_label: String,
    pub files: Vec<GitCommitFileView>,
    pub all_selected: bool,
    pub none_selected: bool,
    pub selection_summary: Option<String>,
    pub show_empty: bool,
    pub empty_label: String,
    pub excluded_label: String,
    pub totals: GitDiffTotals,
    pub edit_files_label: String,
    pub message_label: String,
    pub message_placeholder: String,
    pub cancel_label: String,
    pub commit_on_new_branch_label: String,
    pub commit_label: String,
    pub is_editing_files: bool,
    pub revision: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitDefaultBranchDialogView {
    pub title: String,
    pub description: Option<String>,
    pub continue_label: String,
    pub abort_label: String,
    pub feature_branch_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitPublishStepView {
    pub label: String,
    pub summary: Option<String>,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitPublishProviderView {
    pub value: String,
    pub label: String,
    pub ready: bool,
    pub hint: String,
    pub selected: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitPublishVisibilityView {
    pub value: String,
    pub label: String,
    pub description: String,
    pub icon: String,
    pub selected: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitPublishResultView {
    pub title: String,
    pub description: String,
    pub name_with_owner: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitPublishDialogView {
    pub step: usize,
    pub steps: Vec<GitPublishStepView>,
    pub providers: Vec<GitPublishProviderView>,
    pub provider: String,
    pub provider_label: String,
    pub host: String,
    pub path_placeholder: String,
    pub repository: String,
    pub visibility_options: Vec<GitPublishVisibilityView>,
    pub advanced_open: bool,
    pub remote_name: String,
    pub protocol: String,
    pub is_pending: bool,
    pub error: Option<String>,
    pub result: Option<GitPublishResultView>,
    pub can_submit: bool,
    pub next_disabled: bool,
    pub revision: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitActionsView {
    pub menu_open: bool,
    pub menu: Option<GitMenuView>,
    pub commit_dialog: Option<GitCommitDialogView>,
    pub default_branch_dialog: Option<GitDefaultBranchDialogView>,
    pub publish_dialog: Option<GitPublishDialogView>,
}
