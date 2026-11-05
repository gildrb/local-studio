use std::collections::HashMap;

use serde::Deserialize;

use crate::app_core::views::pierre_icon::PierreIconView;
use crate::app_core::views::timeline::TimelineSnapShotView;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ComposerIconView {
    Pierre { icon: PierreIconView },
    Lucide { asset: String },
    Image { path: String },
    PullRequest { state: PullRequestStateKey },
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PullRequestStateKey {
    Open,
    Draft,
    Closed,
    Merged,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ComposerChipKind {
    Mention,
    Skill,
    Image,
    Video,
    File,
    Terminal,
    ReviewComment,
    PreviewAnnotation,
    PrOpen,
    PrDraft,
    PrMerged,
    PrClosed,
    PullRequest,
    Unresolved,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerTokenView {
    pub id: String,
    pub start: usize,
    pub end: usize,
    pub text: String,
    pub label: String,
    pub chip: ComposerChipKind,
    pub icon: Option<ComposerIconView>,
    pub detail: Option<String>,
    pub attachment_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerMenuBadge {
    pub label: String,
    pub asset: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerMenuItemView {
    pub id: String,
    pub label: String,
    pub label_prefix: Option<String>,
    pub description: String,
    pub icon: Option<ComposerIconView>,
    pub badge: Option<ComposerMenuBadge>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerMenuView {
    pub trigger_kind: String,
    pub list_label: String,
    pub items: Vec<ComposerMenuItemView>,
    pub active_item_id: Option<String>,
    pub status_text: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerEditView {
    pub seq: u64,
    pub thread_key: String,
    pub range_start: usize,
    pub range_end: usize,
    pub expected_text: String,
    pub text: String,
    pub tokens: Vec<ComposerTokenView>,
    pub focus: bool,
    pub caret: Option<usize>,
    pub follow_up_action: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerImageView {
    pub id: String,
    pub name: String,
    pub path: Option<String>,
    pub snap_shot: Option<TimelineSnapShotView>,
    pub animation_pending: bool,
    pub animate_arrival: bool,
    pub upload: Option<ComposerImageUploadView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ComposerImageUploadView {
    Uploading {
        label: String,
    },
    Failed {
        reason: String,
        retry_aria_label: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerInteractionModeView {
    pub mode: String,
    pub label: String,
    pub tooltip: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerFooterLayoutView {
    pub hidden_count: usize,
    pub icon_only_count: usize,
    pub visible: bool,
    pub compact: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerInputView {
    pub thread_key: String,
    pub prompt: String,
    pub tokens: Vec<ComposerTokenView>,
    pub upload_suffixes: HashMap<String, String>,
    pub menu: Option<ComposerMenuView>,
    pub edit: Option<ComposerEditView>,
    pub images: Vec<ComposerImageView>,
    pub pending_snap_shots: Vec<String>,
    pub snap_shot_shelf: bool,
    pub interaction_mode: Option<ComposerInteractionModeView>,
    pub can_attach: bool,
    pub footer: ComposerFooterLayoutView,
    pub focus_seq: u64,
}
