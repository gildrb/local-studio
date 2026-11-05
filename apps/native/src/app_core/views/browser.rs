use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHostLayout {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub page_zoom: f64,
    pub fills_panel: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHostStore {
    pub id: String,
    pub persistent: bool,
    pub data_directory: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHostTab {
    pub runtime_tab_id: String,
    pub initial_url: Option<String>,
    pub zoom_factor: f64,
    pub color_scheme: String,
    pub audio_muted: bool,
    pub store: BrowserHostStore,
    pub layout: Option<BrowserHostLayout>,
    pub visible: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BrowserHostCommand {
    Navigate { url: String },
    Back,
    Forward,
    Reload,
    HardReload,
    Stop,
    OpenDevTools,
    Evaluate { script: String },
    Screenshot { path: Option<String> },
    Focus,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHostCommandEntry {
    pub id: u64,
    pub runtime_tab_id: String,
    pub command: BrowserHostCommand,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHostCookie {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    pub secure: bool,
    pub http_only: bool,
    pub expires: Option<f64>,
    pub same_site: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BrowserStoreCommand {
    ClearCookies,
    ClearCache,
    SetCookies { cookies: Vec<BrowserHostCookie> },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStoreCommandEntry {
    pub id: u64,
    pub store: BrowserHostStore,
    pub command: BrowserStoreCommand,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHostView {
    pub init_script: String,
    pub tabs: Vec<BrowserHostTab>,
    pub commands: Vec<BrowserHostCommandEntry>,
    pub store_commands: Vec<BrowserStoreCommandEntry>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserToggleView {
    pub active: bool,
    pub disabled: bool,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserButtonView {
    pub disabled: bool,
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub recording: bool,
    pub label: String,
    #[serde(default)]
    pub tooltip: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserChromeView {
    pub url: String,
    pub loading: bool,
    pub can_go_back: bool,
    pub can_go_forward: bool,
    pub refresh_disabled: bool,
    pub refresh_label: String,
    pub refresh_tooltip: String,
    pub profile_badge: Option<String>,
    pub open_in_browser: bool,
    pub capture: Option<BrowserButtonView>,
    pub picture_in_picture: Option<BrowserToggleView>,
    pub pick: Option<BrowserButtonView>,
    pub more_menu: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserRecentView {
    pub url: String,
    pub title: String,
    pub subtitle: String,
    pub remove_label: String,
    pub favicon_data_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserServerView {
    pub key: String,
    pub url: String,
    pub title: String,
    pub description: String,
    pub favicon_data_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum BrowserContentView {
    None,
    Webview,
    EmptyHint,
    EmptyList {
        recents: Vec<BrowserRecentView>,
        servers: Vec<BrowserServerView>,
    },
    Unreachable {
        host: String,
        friendly: String,
        error_label: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDeviceToolbarView {
    pub preset_label: String,
    pub width: String,
    pub height: String,
    pub custom_valid: bool,
    pub aspect_locked: bool,
    pub aspect_label: String,
    pub aspect_tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSurfaceView {
    pub thread_key: String,
    pub tab_id: Option<String>,
    pub runtime_tab_id: Option<String>,
    pub chrome: BrowserChromeView,
    pub content: BrowserContentView,
    pub webview: bool,
    pub device_toolbar: Option<BrowserDeviceToolbarView>,
    pub focus_url_nonce: u64,
}
