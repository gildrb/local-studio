use serde::Deserialize;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotRect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotFlashView {
    pub seq: u64,
    pub bounds: SnapShotRect,
    pub animated: bool,
    pub duration_ms: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotTransitionDetailsView {
    pub app_name: String,
    pub app_initial: String,
    pub window_title: String,
    pub app_icon_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotTransitionDestinationView {
    pub frame: SnapShotRect,
    pub background_color: String,
    pub border_color: String,
    pub border_width: f32,
    pub corner_radius: f32,
    pub scale_factor: f32,
    pub duration_ms: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotTransitionView {
    pub id: String,
    pub source: SnapShotRect,
    pub image_path: String,
    pub flash: bool,
    pub details: Option<SnapShotTransitionDetailsView>,
    pub destination: Option<SnapShotTransitionDestinationView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotHostView {
    pub hotkey: Option<String>,
    pub activate_seq: u64,
    pub flash: Option<SnapShotFlashView>,
    pub transition: Option<SnapShotTransitionView>,
}
