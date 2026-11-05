use serde::Deserialize;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum DevicePlatform {
    Ios,
    Android,
}

impl DevicePlatform {
    pub fn as_str(self) -> &'static str {
        match self {
            DevicePlatform::Ios => "ios",
            DevicePlatform::Android => "android",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DeviceStreamStatus {
    Connecting,
    Streaming,
    Error,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStreamTarget {
    pub key: String,
    pub generation: u64,
    pub platform: DevicePlatform,
    pub video: String,
    pub mjpeg: String,
    pub ios_input: String,
    pub android_socket: String,
    pub ticketed: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFrameSize {
    pub width: f32,
    pub height: f32,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceMediaBox {
    pub width: f32,
    pub height: f32,
    pub left: f32,
    pub top: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStreamLoading {
    pub name: String,
    pub description: String,
    pub message: String,
    pub error: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceAxElement {
    pub id: String,
    pub label: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStreamView {
    pub key: String,
    pub platform: DevicePlatform,
    pub compact: bool,
    pub target: Option<DeviceStreamTarget>,
    pub status: DeviceStreamStatus,
    pub mjpeg: bool,
    pub controls_inset: f32,
    pub frame: DeviceFrameSize,
    pub media: DeviceMediaBox,
    pub rotation: i32,
    pub input_notice: Option<String>,
    pub loading: Option<DeviceStreamLoading>,
    pub ax_elements: Vec<DeviceAxElement>,
}
