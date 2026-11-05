use serde::Deserialize;

use crate::app_core::views::settings::SettingsRowScopeView;
use crate::app_core::views::settings_general::SettingsModelPickerPopupView;
use crate::app_core::views::settings_projects::SettingsProjectDefaultsView;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationsSectionHeaderView {
    pub id: String,
    pub title: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationsLabelView {
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationsActionView {
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationsOptionView {
    pub value: String,
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationsOptionGroupView {
    pub label: String,
    pub options: Vec<IntegrationsOptionView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserViewportRotateView {
    pub aria_label: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserViewportSizeView {
    pub width: f64,
    pub height: f64,
    pub min: f64,
    pub max: f64,
    pub width_aria_label: String,
    pub height_aria_label: String,
    pub separator: String,
    pub rotate: BrowserViewportRotateView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfileImportItemView {
    pub id: String,
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfilesAddMenuView {
    pub label: String,
    pub disabled: bool,
    pub blank_profile: IntegrationsActionView,
    pub limit_notice: Option<String>,
    pub import_group_label: String,
    pub import_placeholder: Option<String>,
    pub import_sources: Vec<BrowserProfileImportItemView>,
    pub import_notice: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfileRenameView {
    pub aria_label: String,
    pub disabled: bool,
    pub max_length: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfileMenuItemView {
    pub action: String,
    pub label: String,
    pub disabled: bool,
    pub destructive: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfileMenuView {
    pub aria_label: String,
    pub disabled: bool,
    pub items: Vec<BrowserProfileMenuItemView>,
    pub notice: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfileRowView {
    pub id: String,
    pub name: String,
    pub dimmed: bool,
    pub rename: Option<BrowserProfileRenameView>,
    pub default_badge: Option<String>,
    pub menu: BrowserProfileMenuView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfileRemovalDialogView {
    pub open: bool,
    pub title: String,
    pub description: String,
    pub error: Option<String>,
    pub unavailable_notice: Option<String>,
    pub cancel: IntegrationsActionView,
    pub confirm: IntegrationsActionView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfilesView {
    pub id: String,
    pub title: String,
    pub description: String,
    pub add_menu: BrowserProfilesAddMenuView,
    pub profiles: Vec<BrowserProfileRowView>,
    pub removal_dialog: BrowserProfileRemovalDialogView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserViewportRowView {
    pub id: String,
    pub title: String,
    pub description: String,
    pub aria_label: String,
    pub value: String,
    pub value_label: String,
    pub options: Vec<IntegrationsOptionView>,
    pub preset_group: IntegrationsOptionGroupView,
    pub disabled: bool,
    pub reset: Option<IntegrationsLabelView>,
    pub size: Option<BrowserViewportSizeView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSelectRowView {
    pub id: String,
    pub title: String,
    pub description: String,
    pub aria_label: String,
    pub value: String,
    pub value_label: String,
    pub options: Vec<IntegrationsOptionView>,
    pub disabled: bool,
    pub reset: Option<IntegrationsLabelView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSwitchRowView {
    pub id: String,
    pub title: String,
    pub description: String,
    pub aria_label: String,
    pub checked: bool,
    pub disabled: bool,
    pub reset: Option<IntegrationsLabelView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum IntegrationsBrowserRowView {
    Profiles(Box<BrowserProfilesView>),
    Viewport(Box<BrowserViewportRowView>),
    Select(BrowserSelectRowView),
    Switch(BrowserSwitchRowView),
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceToolActionsView {
    pub update: Option<IntegrationsActionView>,
    pub check: Option<IntegrationsActionView>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIntegrationSwitchView {
    pub id: String,
    pub title: String,
    pub aria_label: String,
    pub checked: bool,
    pub disabled: bool,
    pub tool_actions: DeviceToolActionsView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DevicePlatformsView {
    pub visible: bool,
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub refresh: IntegrationsActionView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceToolVersionsRowView {
    pub name: Option<String>,
    pub running: String,
    pub required: String,
    pub installed: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceToolVersionsView {
    pub trigger_label: String,
    pub aria_label: Option<String>,
    pub title: String,
    pub rows: Option<Vec<DeviceToolVersionsRowView>>,
    pub empty_message: String,
    pub footer: String,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSetupStatusView {
    pub pending: bool,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlatformStatusView {
    pub platform: String,
    pub ready: bool,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHostUpdateView {
    pub host_id: String,
    pub label: String,
    pub failed: bool,
    pub detail: String,
    pub hint: Option<String>,
    pub retry: Option<IntegrationsActionView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceControlsView {
    pub hub: DeviceIntegrationSwitchView,
    pub platforms: DevicePlatformsView,
    pub agent: DeviceIntegrationSwitchView,
    pub hub_description: String,
    pub agent_description: String,
    pub hub_row_scope: SettingsRowScopeView,
    pub agent_row_scope: SettingsRowScopeView,
    pub hub_versions: DeviceToolVersionsView,
    pub agent_versions: DeviceToolVersionsView,
    pub hub_status: Option<DeviceSetupStatusView>,
    pub agent_status: Option<DeviceSetupStatusView>,
    pub platform_statuses: Vec<PlatformStatusView>,
    pub host_updates: Vec<DeviceHostUpdateView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHostBadgeView {
    pub platform: String,
    pub icon: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHostErrorView {
    pub summary: String,
    pub detail: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHostMenuItemView {
    pub action: String,
    pub label: String,
    pub destructive: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHostMenuView {
    pub aria_label: String,
    pub disabled: bool,
    pub items: Vec<DeviceHostMenuItemView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHostActionView {
    pub kind: String,
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHostRowView {
    pub id: String,
    pub label: String,
    pub target: String,
    pub platform_badges: Vec<DeviceHostBadgeView>,
    pub local_notice: Option<String>,
    pub error: Option<DeviceHostErrorView>,
    pub progress: Option<String>,
    pub menu: DeviceHostMenuView,
    pub action: DeviceHostActionView,
    pub versions: DeviceToolVersionsView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHostGroupView {
    pub environment_id: String,
    pub heading: Option<String>,
    pub empty_message: Option<String>,
    pub hosts: Vec<DeviceHostRowView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHostFieldView {
    pub id: String,
    pub label: String,
    pub value: String,
    pub placeholder: String,
    pub required: bool,
    pub disabled: bool,
    pub input_type: String,
    pub min: Option<f64>,
    pub max: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHostFieldsView {
    pub label: DeviceHostFieldView,
    pub target: DeviceHostFieldView,
    pub identity_file: DeviceHostFieldView,
    pub port: DeviceHostFieldView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHostSshOptionsView {
    pub summary: String,
    pub open: bool,
    pub hint: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHostAvailabilityView {
    pub platform: String,
    pub available: bool,
    pub label: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHostResultView {
    pub environment_id: String,
    pub label: String,
    pub status: String,
    pub status_label: String,
    pub icon: String,
    pub platforms: Option<Vec<DeviceHostAvailabilityView>>,
    pub error: Option<DeviceHostErrorView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHostConnectionView {
    pub status: String,
    pub checking: bool,
    pub test_button: IntegrationsActionView,
    pub results: Option<Vec<DeviceHostResultView>>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHostSaveView {
    pub label: String,
    pub disabled: bool,
    pub busy: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHostEditorView {
    pub title: String,
    pub description: String,
    pub closeable: bool,
    pub fields: DeviceHostFieldsView,
    pub ssh_options: DeviceHostSshOptionsView,
    pub connection: DeviceHostConnectionView,
    pub cancel: IntegrationsActionView,
    pub save: DeviceHostSaveView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHostsAddButtonView {
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHostsView {
    pub id: String,
    pub title: String,
    pub description: String,
    pub add_button: DeviceHostsAddButtonView,
    pub unavailable_message: Option<String>,
    pub list_busy: bool,
    pub row_scope: SettingsRowScopeView,
    pub groups_view: Vec<DeviceHostGroupView>,
    pub editor: Option<Box<DeviceHostEditorView>>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WizardTileView {
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub selected: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WizardTargetSelectionView {
    pub kind: String,
    #[serde(default)]
    pub profile_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WizardTargetTileView {
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub selected: bool,
    pub selection: WizardTargetSelectionView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WizardPermissionView {
    pub title: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WizardSkippedView {
    pub label: String,
    pub domains: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WizardStepView {
    Quit {
        title: String,
        description: String,
        cancel_label: String,
        confirm_label: String,
    },
    FullDiskAccess {
        title: String,
        description: String,
        permission: WizardPermissionView,
        cancel_label: String,
        continue_label: String,
    },
    Configure {
        title: String,
        description: String,
        from_label: String,
        into_label: String,
        source_profiles: Vec<WizardTileView>,
        targets: Vec<WizardTargetTileView>,
        feedback: Option<String>,
        cancel_label: String,
        import_label: String,
        import_disabled: bool,
    },
    Importing {
        title: String,
        description: String,
        progress_label: String,
    },
    Checking {
        title: String,
        description: String,
        progress_label: String,
    },
    Done {
        title: String,
        description: String,
        skipped: Option<WizardSkippedView>,
        done_label: String,
    },
    Blocked {
        title: String,
        description: String,
        close_label: String,
        retry_label: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FullDiskAccessStatusView {
    pub notice: Option<String>,
    pub hint: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WizardFullDiskAccessView {
    pub granted: bool,
    pub busy: bool,
    pub ready: bool,
    pub allow_label: String,
    pub allowed_label: String,
    pub status: FullDiskAccessStatusView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserImportWizardView {
    pub closeable: bool,
    pub step: WizardStepView,
    pub full_disk_access: WizardFullDiskAccessView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationsSettingsView {
    pub defaults: SettingsProjectDefaultsView,
    pub model_picker: Option<SettingsModelPickerPopupView>,
    pub browser: IntegrationsSectionHeaderView,
    pub browser_unavailable_message: Option<String>,
    pub browser_rows: Vec<IntegrationsBrowserRowView>,
    pub devices: IntegrationsSectionHeaderView,
    pub device_controls: Box<DeviceControlsView>,
    pub device_hosts: Box<DeviceHostsView>,
    pub wizard: Option<Box<BrowserImportWizardView>>,
}
