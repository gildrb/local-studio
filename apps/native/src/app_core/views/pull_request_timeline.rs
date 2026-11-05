use std::collections::HashMap;

use serde::Deserialize;

use super::pull_request_summary::{BodyView, MarkdownEditorView, ReactionBarModel};
use super::pull_requests::{PullRequestActorModel, PullRequestDiffStatModel, PullRequestGlyphId};

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineBodyModel {
    pub text: String,
    pub markdown: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineReactionsModel {
    pub visible: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineCardModel {
    pub key: String,
    pub id: String,
    pub actor_login: String,
    pub title: String,
    pub review_state_label: Option<String>,
    pub time: String,
    pub path: Option<String>,
    pub editable: bool,
    pub edit_aria_label: String,
    pub url: Option<String>,
    pub open_aria_label: String,
    pub body: Option<TimelineBodyModel>,
    pub reactions: TimelineReactionsModel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum TimelineRowModel {
    Conversation {
        key: String,
        count_label: String,
        authors_label: String,
        cards: Vec<TimelineCardModel>,
    },
    Commit {
        key: String,
        oid: String,
        aria_label: String,
        title: String,
        short_oid: String,
        time: String,
        diff_stat: Option<PullRequestDiffStatModel>,
    },
    Verdict {
        key: String,
        id: String,
        actor_login: String,
        outcome: String,
        label: String,
        tone_class_name: String,
        stale: bool,
        stale_tooltip: String,
        time: String,
        path: Option<String>,
        url: Option<String>,
        open_aria_label: String,
        body: Option<TimelineBodyModel>,
        reactions: TimelineReactionsModel,
    },
    Lifecycle {
        key: String,
        icon: PullRequestGlyphId,
        label: String,
        actor_login: Option<String>,
        time: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineModel {
    pub rows: Vec<TimelineRowModel>,
    pub empty_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestTimelineView {
    pub url: String,
    pub active: bool,
    pub model: TimelineModel,
    pub markers: HashMap<String, PullRequestActorModel>,
    pub bodies: HashMap<String, BodyView>,
    pub reactions: HashMap<String, ReactionBarModel>,
    pub reaction_picker: Option<String>,
    pub editor: Option<MarkdownEditorView>,
    pub saving: bool,
}
