use std::collections::HashMap;

use serde::Deserialize;

use super::markdown::MarkdownDocView;
use super::media::MediaVideoView;
use super::pull_request_detail::ActivityUnavailableModel;
use super::pull_requests::{PullRequestActorModel, PullRequestSignalModel};

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum BodySegmentView {
    Markdown {
        id: String,
        document: MarkdownDocView,
    },
    Video {
        id: String,
        video: MediaVideoView,
    },
    Attachment {
        id: String,
        url: String,
        label: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BodyView {
    pub segments: Vec<BodySegmentView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditorModeModel {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownEditorModel {
    pub mode_label: String,
    pub modes: Vec<EditorModeModel>,
    pub mode: String,
    pub mode_disabled: bool,
    pub empty: bool,
    pub empty_preview_label: String,
    pub cancel_label: String,
    pub cancel_disabled: bool,
    pub save_label: String,
    pub save_disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownEditorView {
    pub target: String,
    pub revision: u64,
    pub initial: String,
    pub label: String,
    pub placeholder: Option<String>,
    pub model: MarkdownEditorModel,
    pub preview: Option<BodyView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PickerRowModel {
    pub key: String,
    #[serde(default)]
    pub actor: Option<PullRequestActorModel>,
    #[serde(default)]
    pub kind_label: Option<String>,
    #[serde(default)]
    pub requested: Option<bool>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub applied: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PickerBodyModel {
    Loading,
    Message { message: String },
    Rows,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PickerModel {
    Disabled {
        icon: String,
        label: String,
        tooltip: String,
    },
    Enabled {
        icon: String,
        label: String,
        search_label: String,
        body: PickerBodyModel,
        rows: Vec<PickerRowModel>,
        rows_disabled: bool,
        truncated_notice: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PickerView {
    pub open: bool,
    pub query: String,
    pub model: PickerModel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReactionPillModel {
    pub content: String,
    pub emoji: String,
    pub count: u64,
    pub pressed: bool,
    pub aria_label: String,
    pub tooltip: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReactionOptionModel {
    pub content: String,
    pub emoji: String,
    pub aria_label: String,
    pub pressed: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReactionPickerModel {
    pub visible: bool,
    pub aria_label: String,
    pub options: Vec<ReactionOptionModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReactionBarModel {
    pub visible: bool,
    pub pills: Vec<ReactionPillModel>,
    pub picker: ReactionPickerModel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimeModel {
    pub iso: String,
    pub relative: String,
    pub absolute: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FixButtonModel {
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OutcomeBadgeModel {
    pub outcome: String,
    pub label: String,
    pub badge_variant: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommentLocationModel {
    pub label: String,
    pub outdated: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommentCardModel {
    pub key: String,
    pub id: String,
    pub author: PullRequestActorModel,
    pub author_profile_url: Option<String>,
    pub time: TimeModel,
    pub time_url: Option<String>,
    pub time_tooltip: String,
    pub outcome: Option<OutcomeBadgeModel>,
    pub review_state_label: Option<String>,
    pub location: Option<CommentLocationModel>,
    pub fix: Option<FixButtonModel>,
    pub body: Option<String>,
    pub body_visible: bool,
    pub can_edit: bool,
    pub edit_aria_label: String,
    #[serde(default)]
    pub status_label: Option<String>,
    #[serde(default)]
    pub preview: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GroupAvatarModel {
    pub key: String,
    pub profile_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommentGroupModel {
    pub label: String,
    pub avatars: Vec<GroupAvatarModel>,
    pub overflow_label: Option<String>,
    pub authors_label: String,
    pub files_label: Option<String>,
    pub latest: Option<TimeModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PagerModel {
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BotCommentsModel {
    pub group: CommentGroupModel,
    pub visible: Vec<CommentCardModel>,
    pub show_older: Option<PagerModel>,
    pub show_recent: Option<PagerModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FinishedCommentsModel {
    pub group: CommentGroupModel,
    pub items: Vec<CommentCardModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommentOrderModel {
    pub label: String,
    pub aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommentsModel {
    pub title: String,
    pub order: CommentOrderModel,
    pub state: String,
    pub truncated_notice: Option<String>,
    pub empty_label: Option<String>,
    pub visible: Vec<CommentCardModel>,
    pub show_older: Option<PagerModel>,
    pub show_recent: Option<PagerModel>,
    pub bots: Option<BotCommentsModel>,
    pub finished: Option<FinishedCommentsModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CheckRowModel {
    pub key: String,
    pub name: String,
    pub status: PullRequestSignalModel,
    pub status_label: String,
    pub url: Option<String>,
    pub fix: Option<FixButtonModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ChecksBodyModel {
    Stale {
        message: String,
        refresh_label: String,
    },
    Empty {
        message: String,
    },
    Rows {
        rows: Vec<CheckRowModel>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChecksModel {
    pub title: String,
    pub body: ChecksBodyModel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DescriptionModel {
    pub title: String,
    pub editing: bool,
    pub can_edit: bool,
    pub edit_aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PickerFlags {
    pub visible: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewerEntryModel {
    pub key: String,
    pub avatar: PullRequestActorModel,
    pub outcome: Option<String>,
    pub stale: bool,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewersModel {
    pub label: String,
    pub empty_label: Option<String>,
    pub entries: Vec<ReviewerEntryModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LabelChipModel {
    pub name: String,
    pub color: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LabelsModel {
    pub visible: bool,
    pub label: String,
    pub empty_label: Option<String>,
    pub chips: Vec<LabelChipModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SummaryModel {
    pub reviewers: ReviewersModel,
    pub labels: LabelsModel,
    pub description: DescriptionModel,
    pub checks: ChecksModel,
    pub comments: CommentsModel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestSummaryView {
    pub url: String,
    pub active: bool,
    pub model: SummaryModel,
    pub description: BodyView,
    pub bodies: HashMap<String, BodyView>,
    pub reactions: HashMap<String, ReactionBarModel>,
    pub reaction_picker: Option<String>,
    pub fixable: HashMap<String, bool>,
    pub editor: Option<MarkdownEditorView>,
    pub saving: bool,
    pub reviewers: Option<PickerView>,
    pub labels: Option<PickerView>,
    pub activity_unavailable: Option<ActivityUnavailableModel>,
    pub group_actors: HashMap<String, PullRequestActorModel>,
}
