use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewMiniPlayerFrame {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewMiniPlayerPictureInPicture {
    pub active: bool,
    pub disabled: bool,
    pub label: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PreviewMiniPlayerSource {
    Browser {
        runtime_tab_id: String,
        reconnecting: bool,
        picture_in_picture: PreviewMiniPlayerPictureInPicture,
    },
    Device {
        environment_id: String,
        host_id: String,
        device_id: String,
        platform: String,
        name: String,
        description: String,
        stream: Box<crate::app_core::views::device_stream::DeviceStreamView>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewMiniPlayerView {
    pub source_key: String,
    pub label: String,
    pub frame: Option<PreviewMiniPlayerFrame>,
    pub radius: f32,
    pub pill_inset: f32,
    pub recording: bool,
    pub source: PreviewMiniPlayerSource,
}
