use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageButtonView {
    pub label: String,
    pub url: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThreadErrorView {
    pub message: String,
    pub usage_button: Option<UsageButtonView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalOptionView {
    pub decision: String,
    pub label: String,
    pub warning: Option<String>,
    #[serde(default)]
    pub primary: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalDetailFormat {
    Prose,
    Code,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalDrawerView {
    pub request_id: String,
    pub label: String,
    pub app_name: Option<String>,
    pub detail: String,
    pub detail_format: ApprovalDetailFormat,
    pub count_label: Option<String>,
    pub responding: bool,
    pub primary_options: Vec<ApprovalOptionView>,
    pub more_options: Vec<ApprovalOptionView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserInputOptionView {
    pub value: String,
    pub label: String,
    pub description: Option<String>,
    pub selected: bool,
    pub shortcut_key: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserInputDrawerView {
    pub request_id: String,
    pub question_id: String,
    pub header: String,
    pub question: String,
    pub multi_select: bool,
    pub collapsed: bool,
    pub count_label: Option<String>,
    pub dismissible: bool,
    pub responding: bool,
    pub options: Vec<UserInputOptionView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ThreadInteractionsDrawer {
    Approval(Box<ApprovalDrawerView>),
    UserInput(Box<UserInputDrawerView>),
    PlanFollowUp { title: Option<String> },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingRevertView {
    pub title: String,
    pub description: String,
    pub can_restore_files: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanSaveDialogView {
    pub plan_id: String,
    pub workspace_root: String,
    pub path: String,
    pub placeholder: String,
    pub saving: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThreadInteractionsView {
    pub thread_key: String,
    pub thread_error: Option<ThreadErrorView>,
    pub drawer: Option<ThreadInteractionsDrawer>,
    pub open_menu: Option<String>,
    pub copied_plan_id: Option<String>,
    pub pending_revert: Option<PendingRevertView>,
    pub plan_save_dialog: Option<PlanSaveDialogView>,
}
