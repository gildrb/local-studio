use serde::Deserialize;
use serde_json::Value;

use crate::app_core::views::timeline::TimelineSnapShotView;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaLinkView {
    pub url: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaVideoView {
    pub src: Option<String>,
    pub source_failed: bool,
    pub label: String,
    pub unavailable_label: String,
    pub can_retry: bool,
    pub retry: Option<Value>,
    pub open_link: Option<MediaLinkView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaViewerContentsView {
    pub label: String,
    pub showing: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum MediaViewerItemView {
    Image {
        src: Option<String>,
        failure_message: String,
        open_link: Option<MediaLinkView>,
        snap_shot: Option<Box<TimelineSnapShotView>>,
        contents: Option<MediaViewerContentsView>,
    },
    Video {
        video: MediaVideoView,
        auto_play: bool,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MediaLabel {
    Image,
    Video,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaViewerView {
    pub item_key: String,
    pub media_label: MediaLabel,
    pub caption: String,
    pub count: usize,
    pub item: MediaViewerItemView,
}
