use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerModeOption {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerModeToggle {
    pub aria_label: String,
    pub options: Vec<ComposerModeOption>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerDiscard {
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerModel {
    pub can_comment: bool,
    pub mode: String,
    pub trigger_label: String,
    pub pending_badge: Option<String>,
    pub mode_toggle: Option<ComposerModeToggle>,
    pub title: String,
    pub discard: Option<ComposerDiscard>,
    pub close_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommentFollowUp {
    pub action: String,
    pub label: String,
    pub destructive: bool,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommentSubmit {
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommentFormModel {
    pub placeholder: String,
    pub aria_label: String,
    pub disabled: bool,
    pub follow_up: Option<CommentFollowUp>,
    pub submit: CommentSubmit,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerCommentView {
    pub model: CommentFormModel,
    pub revision: u64,
    pub body: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VerdictOption {
    pub value: String,
    pub label: String,
    pub icon: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFormModel {
    pub summary_placeholder: String,
    pub summary_aria_label: String,
    pub verdict_aria_label: String,
    pub verdict_disabled: bool,
    pub options: Vec<VerdictOption>,
    pub selected: Option<VerdictOption>,
    pub submit_label: String,
    pub submit_disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerReviewView {
    pub model: ReviewFormModel,
    pub summary: String,
    pub revision: u64,
    pub pending: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestComposerView {
    pub open: bool,
    pub model: ComposerModel,
    pub comment: ComposerCommentView,
    pub review: Option<ComposerReviewView>,
}
