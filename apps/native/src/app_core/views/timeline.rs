use serde::Deserialize;

use crate::app_core::views::markdown::{MarkdownDocView, SyntaxTokenView};
use crate::app_core::views::media::MediaVideoView;
use crate::app_core::views::pierre_icon::PierreIconView;
use crate::app_core::views::timeline_work::{
    ActivityGroupRowView, ChangedFilesCardView, WorkLiveRowView, WorkRowView, WorkToggleRowView,
    WorkingRowView,
};

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum TimelineSnapShotAccessibilityView {
    Text { text: String },
    Json { lines: Vec<Vec<SyntaxTokenView>> },
    Unnamed,
    None,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineSnapShotView {
    pub app_name: String,
    pub app_initial: String,
    pub app_icon_path: Option<String>,
    pub window_title: String,
    pub includes_accessibility: bool,
    pub accessibility: TimelineSnapShotAccessibilityView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineUserGridImageView {
    pub id: String,
    pub name: String,
    pub url: Option<String>,
    pub snap_shot: Option<TimelineSnapShotView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineUserVideoView {
    pub id: String,
    pub name: String,
    pub video: Option<MediaVideoView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineUserFileView {
    pub id: String,
    pub name: String,
    pub icon: PierreIconView,
    pub downloadable: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum TimelineRowView {
    User {
        id: String,
        message_id: String,
        text: String,
        document: Option<MarkdownDocView>,
        images: Vec<TimelineUserGridImageView>,
        videos: Vec<TimelineUserVideoView>,
        files: Vec<TimelineUserFileView>,
        unknown_attachments: Vec<TimelineUserFileView>,
        collapsible: bool,
        expanded: bool,
        copy_text: Option<String>,
        revert_turn_count: Option<u32>,
        revert_disabled: bool,
        time_label: String,
        time_tooltip: String,
    },
    Assistant {
        id: String,
        document: MarkdownDocView,
        copy_text: Option<String>,
        streaming: bool,
        show_meta: bool,
        show_copy_button: bool,
        time_label: String,
        time_tooltip: String,
        changed_files: Option<Box<ChangedFilesCardView>>,
    },
    AssistantMeta {
        id: String,
        show_copy_button: bool,
        copy_text: Option<String>,
        time_label: String,
        time_tooltip: String,
    },
    Reasoning {
        id: String,
        message_id: String,
        expanded: bool,
        document: Option<MarkdownDocView>,
        time_label: String,
    },
    TurnFold {
        id: String,
        turn_id: String,
        label: String,
        expanded: bool,
        time_label: String,
        time_tooltip: String,
    },
    WorkToggle(Box<WorkToggleRowView>),
    Work(Box<WorkRowView>),
    WorkLive(Box<WorkLiveRowView>),
    ActivityGroup(Box<ActivityGroupRowView>),
    Working(Box<WorkingRowView>),
    Thinking {
        id: String,
        visible: bool,
    },
    ContextCompaction {
        id: String,
        label: String,
    },
    ProposedPlan(Box<ProposedPlanRowView>),
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProposedPlanRowView {
    pub id: String,
    pub plan_id: String,
    pub title: String,
    pub markdown: String,
    pub can_collapse: bool,
    pub expanded: bool,
    pub copy_text: String,
    pub download_filename: String,
    pub can_save: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineRow {
    pub padding_bottom: f32,
    #[serde(flatten)]
    pub view: TimelineRowView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineView {
    pub thread_key: Option<String>,
    pub loading: bool,
    pub scroll_revision: u64,
    pub rows: Vec<TimelineRow>,
}
