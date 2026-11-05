use serde::Deserialize;

use crate::app_core::views::device_stream::DeviceStreamView;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChoiceOption {
    pub value: String,
    pub label: String,
    pub selected: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHostRetry {
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHostUpdate {
    pub host_id: String,
    pub label: String,
    pub failed: bool,
    pub detail: String,
    pub hint: Option<String>,
    pub retry: Option<DeviceHostRetry>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSetupStatus {
    pub pending: bool,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlatformStatus {
    pub platform: String,
    pub ready: bool,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupStep {
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupSwitch {
    pub description: String,
    pub enabled: bool,
    pub disabled: bool,
    pub status: Option<DeviceSetupStatus>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupCheck {
    pub disabled: bool,
    pub checking: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupBack {
    pub kind: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupNext {
    pub kind: String,
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSetupDialogView {
    pub environment_id: String,
    pub step: usize,
    pub steps: Vec<SetupStep>,
    pub host_updates: Vec<DeviceHostUpdate>,
    pub hub: SetupSwitch,
    pub platforms: Vec<PlatformStatus>,
    pub check: SetupCheck,
    pub agent: SetupSwitch,
    pub failed_detail: Option<String>,
    pub back: SetupBack,
    pub next: SetupNext,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceListRow {
    pub host_id: String,
    pub device_id: String,
    pub title: String,
    pub description: String,
    pub action: String,
    pub pending: bool,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceListGroup {
    pub label: String,
    pub rows: Vec<DeviceListRow>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceListRefresh {
    pub variant: String,
    pub align: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RailRotate {
    pub kind: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RailAppearance {
    pub label: String,
    pub icon: String,
    pub next: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RailTextSize {
    pub disabled: bool,
    pub options: Vec<ChoiceOption>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RailScreenshot {
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RailPhoneView {
    pub disabled: bool,
    pub description: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RailFold {
    pub closed: bool,
    pub opened: bool,
    pub disabled: bool,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceRailView {
    pub input_disabled: bool,
    pub rotate: RailRotate,
    pub appearance: RailAppearance,
    pub text_size: RailTextSize,
    pub tools_open: bool,
    pub screenshot: RailScreenshot,
    pub phone_view: RailPhoneView,
    pub flat_view_disabled: bool,
    pub fold: Option<RailFold>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolsSubmitField {
    pub value: String,
    pub submit_disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolsLaunchApp {
    pub placeholder: String,
    pub value: String,
    pub submit_disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolsLiquidGlass {
    pub value: Option<String>,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolsColorFilter {
    pub options: Vec<ChoiceOption>,
    pub label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolsSwitch {
    pub setting: String,
    pub label: String,
    pub checked: bool,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolsAxOverlay {
    pub checked: bool,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolsLocation {
    pub latitude: String,
    pub longitude: String,
    pub presets: Vec<String>,
    pub set_disabled: bool,
    pub can_clear: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolsPermissions {
    pub app_id: String,
    pub placeholder: String,
    pub options: Vec<ChoiceOption>,
    pub label: String,
    pub decide_disabled: bool,
    pub can_reset: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolsPush {
    pub value: String,
    pub input_disabled: bool,
    pub submit_disabled: bool,
    pub hint: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolsEventLogEntry {
    pub id: u64,
    pub time: String,
    pub summary: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolsEventLog {
    pub open: bool,
    pub entries: Vec<ToolsEventLogEntry>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceToolsView {
    pub is_ios: bool,
    pub pending: bool,
    pub error: Option<String>,
    pub loading: bool,
    pub host_diagnostics: Option<String>,
    pub disabled: bool,
    pub foreground: Option<String>,
    pub open_url: ToolsSubmitField,
    pub launch_app: ToolsLaunchApp,
    pub settings_title: String,
    pub appearance: Option<String>,
    pub text_size: Vec<ChoiceOption>,
    pub text_size_label: Option<String>,
    pub liquid_glass: Option<ToolsLiquidGlass>,
    pub color_filter: Option<ToolsColorFilter>,
    pub orientations: Option<Vec<ChoiceOption>>,
    pub switches: Vec<ToolsSwitch>,
    pub ax_overlay: ToolsAxOverlay,
    pub location: ToolsLocation,
    pub permissions: ToolsPermissions,
    pub push: Option<ToolsPush>,
    pub event_log: Option<ToolsEventLog>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceWorkspaceBody {
    pub key: String,
    pub error_banner: Option<String>,
    pub stream: DeviceStreamView,
    pub rail: DeviceRailView,
    pub tools: Option<DeviceToolsView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum DevicePanelBody {
    Setup,
    Workspace(Box<DeviceWorkspaceBody>),
    Loading {
        name: String,
        description: String,
        message: String,
    },
    List {
        empty_message: Option<String>,
        groups: Vec<DeviceListGroup>,
        android_hint: bool,
        refresh: Option<DeviceListRefresh>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DevicePanelView {
    pub surface_id: String,
    pub environment_id: String,
    pub host_notice: Option<String>,
    pub host_updates: Vec<DeviceHostUpdate>,
    pub booting_notice: Option<String>,
    pub operation_error: Option<String>,
    pub body: DevicePanelBody,
}
