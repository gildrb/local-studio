use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotButtonView {
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotActionButtonView {
    pub label: String,
    pub disabled: bool,
    pub action: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SnapShotRecorderContentView {
    Text { text: String },
    Keys { key_labels: Vec<String> },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotRecorderView {
    pub aria_label: String,
    pub pressed: bool,
    pub disabled: bool,
    pub content: SnapShotRecorderContentView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotSwitchRowView {
    pub id: String,
    pub description: String,
    pub status: Option<String>,
    pub checked: bool,
    pub disabled: bool,
    pub aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotEnabledRowView {
    pub id: String,
    pub description: String,
    pub status: Option<String>,
    pub checked: bool,
    pub disabled: bool,
    pub aria_label: String,
    pub setup_button: Option<SnapShotButtonView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotShortcutRowView {
    pub id: String,
    pub description: String,
    pub managed: bool,
    pub change_button: Option<SnapShotButtonView>,
    pub recorder: SnapShotRecorderView,
    pub save_button: Option<SnapShotButtonView>,
    pub cancel_button: Option<SnapShotButtonView>,
    pub permissions_button: Option<SnapShotButtonView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotSoundPreviewView {
    pub sound: String,
    pub aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotSoundOptionView {
    pub value: String,
    pub label: String,
    pub badge: Option<String>,
    pub preview: Option<SnapShotSoundPreviewView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotSoundRowView {
    pub id: String,
    pub description: String,
    pub value: String,
    pub selected_option: SnapShotSoundOptionView,
    pub trigger_aria_label: String,
    pub disabled: bool,
    pub options: Vec<SnapShotSoundOptionView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotSettingsModelView {
    pub section_id: String,
    pub title: String,
    pub unavailable_message: Option<String>,
    pub shortcut_status: Option<String>,
    pub enabled: SnapShotEnabledRowView,
    pub show_capture_options: bool,
    pub accessibility: SnapShotSwitchRowView,
    pub shortcut: SnapShotShortcutRowView,
    pub sound: SnapShotSoundRowView,
    pub flash: SnapShotSwitchRowView,
    pub animations: SnapShotSwitchRowView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotTitlesView {
    pub enabled: String,
    pub accessibility: String,
    pub shortcut: String,
    pub sound: String,
    pub flash: String,
    pub animations: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotDialogStepView {
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotCopyView {
    pub title: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotPermissionView {
    pub id: String,
    pub icon: String,
    pub title: String,
    pub description: String,
    pub granted: bool,
    pub action: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotDialogAccessView {
    pub check_message: Option<String>,
    pub permissions: Option<Vec<SnapShotPermissionView>>,
    pub permission_error: Option<String>,
    pub reinstall_helper_button: Option<SnapShotActionButtonView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SnapShotDialogShortcutView {
    Config {
        disabled: bool,
    },
    Inline {
        status: Option<String>,
        retry_button: Option<SnapShotActionButtonView>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotDialogAdvancedView {
    pub summary: String,
    pub details: Vec<String>,
    pub included_note: Option<String>,
    pub disable_extension_button: Option<SnapShotActionButtonView>,
    pub remove_helper_button: Option<SnapShotActionButtonView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SnapShotDialogPrimaryView {
    Button { label: String, disabled: bool },
    PermissionContinue { label: String, disabled: bool },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotDialogModelView {
    pub title: String,
    pub busy: bool,
    pub dismissible: bool,
    pub steps: Vec<SnapShotDialogStepView>,
    pub current_step_index: usize,
    pub heading: SnapShotCopyView,
    pub access: Option<SnapShotDialogAccessView>,
    pub shortcut: Option<SnapShotDialogShortcutView>,
    pub access_alert: Option<String>,
    pub error_alert: Option<String>,
    pub advanced: Option<SnapShotDialogAdvancedView>,
    pub back_button: Option<SnapShotButtonView>,
    pub close_button: SnapShotButtonView,
    pub primary_button: Option<SnapShotDialogPrimaryView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotConfigPreviewView {
    pub message: String,
    pub note: Option<String>,
    pub primary_button: Option<SnapShotButtonView>,
    pub cancel_button: SnapShotButtonView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotConfigReviewView {
    pub intro: String,
    pub button: SnapShotButtonView,
    pub unsupported_note: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotRegistrationStatusView {
    pub message: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotConfigAdvancedView {
    pub summary: String,
    pub troubleshooting_title: String,
    pub troubleshooting: Option<String>,
    pub settings_file_title: String,
    pub settings_file_path: String,
    pub include_note: Option<String>,
    pub link_note: Option<String>,
    pub choose_file_button: SnapShotButtonView,
    pub remove_button: SnapShotButtonView,
    pub review_button: Option<SnapShotButtonView>,
    pub settings_file_help: String,
    pub config_location_note: String,
    pub backup_label: Option<String>,
    pub manual_setup_title: String,
    pub manual_setup_instructions: String,
    pub binding: Option<String>,
    pub copy_button: SnapShotButtonView,
    pub turn_off_note: String,
    pub registration_status: Option<SnapShotRegistrationStatusView>,
    pub complete_button: Option<SnapShotButtonView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotConfigModelView {
    pub shortcut_label: Option<String>,
    pub recording_status: Option<String>,
    pub result_message: Option<String>,
    pub preview: Option<SnapShotConfigPreviewView>,
    pub review: Option<SnapShotConfigReviewView>,
    pub error_message: Option<String>,
    pub connection_status: Option<String>,
    pub advanced: SnapShotConfigAdvancedView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotDiffLineView {
    pub kind: String,
    pub text: String,
    pub old_line_number: Option<u32>,
    pub new_line_number: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotDiffHunkView {
    pub header: String,
    pub lines: Vec<SnapShotDiffLineView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotDiffView {
    pub path: String,
    pub hunks: Vec<SnapShotDiffHunkView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotConfigView {
    pub model: SnapShotConfigModelView,
    pub recorder: SnapShotRecorderView,
    pub diff: Option<SnapShotDiffView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapShotDialogView {
    pub model: SnapShotDialogModelView,
    pub config: Option<SnapShotConfigView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapShotView {
    pub model: SnapShotSettingsModelView,
    pub titles: SnapShotTitlesView,
    pub dialog: Option<SnapShotDialogView>,
}
