use serde::Deserialize;

use super::branch_toolbar::MiddleTruncateSplit;
use super::pull_requests::{
    PullRequestActorModel, PullRequestConflictModel, PullRequestDiffStatModel,
    PullRequestSignalModel, PullRequestStateModel,
};

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThreadPullRequestStackView {
    pub size_label: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThreadPullRequestRepositoryView {
    pub label: String,
    pub split: Option<MiddleTruncateSplit>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThreadPullRequestBranchesView {
    pub head: String,
    pub head_split: Option<MiddleTruncateSplit>,
    pub base: String,
    pub base_split: Option<MiddleTruncateSplit>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThreadPullRequestRowView {
    pub key: String,
    pub indent: f32,
    pub shows_connector: bool,
    pub waiting_aria_label: Option<String>,
    pub state: Option<PullRequestStateModel>,
    pub conflict: Option<PullRequestConflictModel>,
    pub number_label: String,
    pub number_tooltip: String,
    pub title: String,
    pub checks: Option<PullRequestSignalModel>,
    pub review_decision: Option<PullRequestSignalModel>,
    pub diff_stat: Option<PullRequestDiffStatModel>,
    pub stack: Option<ThreadPullRequestStackView>,
    pub author: Option<PullRequestActorModel>,
    pub repository: Option<ThreadPullRequestRepositoryView>,
    pub branches: Option<ThreadPullRequestBranchesView>,
    pub host_repository_label: Option<String>,
    pub updated_label: Option<String>,
    pub actions_aria_label: String,
    pub copy_label: String,
    pub open_label: String,
    pub unlink_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ThreadPullRequestsView {
    Unsupported {
        title: String,
        description: String,
    },
    Empty {
        title: String,
        description: String,
        action_label: String,
    },
    List {
        rows: Vec<ThreadPullRequestRowView>,
        footer_summary: String,
        action_label: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LinkPullRequestDialogView {
    pub revision: u64,
    pub title: String,
    pub description: String,
    pub input_placeholder: String,
    pub preview: Option<String>,
    pub error: Option<String>,
    pub cancel_label: String,
    pub cancel_disabled: bool,
    pub submit_label: String,
    pub submit_disabled: bool,
    pub dismissible: bool,
}
