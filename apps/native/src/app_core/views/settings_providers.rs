use serde::Deserialize;

use crate::app_core::views::sidebar::EnvironmentMachineKind;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSectionTitle {
    pub id: String,
    pub title: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExpandableTextView {
    pub text: String,
    pub can_expand: bool,
    pub collapsed: bool,
    pub expanded: bool,
    pub toggle_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderPlaceholderView {
    pub machine_kind: EnvironmentMachineKind,
    pub title: String,
    pub description: String,
    pub section: ProviderSectionTitle,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ProviderCardIcon {
    Driver {
        driver_kind: String,
        accent_color: Option<String>,
        show_badge: bool,
    },
    DriverOption,
    Initials {
        initials: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderVersionAction {
    pub kind: String,
    pub label: String,
    pub busy: bool,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderVersionAdvisory {
    pub title: String,
    pub detail: String,
    pub emphasis: String,
    pub icon: String,
    pub compatibility_warning: bool,
    pub list_indicator: String,
    pub list_copy_command_aria_label: String,
    pub list_copy_command_tooltip: String,
    pub update_available_aria_label: String,
    pub details_aria_label: String,
    pub update_command: Option<String>,
    pub copy_command_aria_label: String,
    pub copy_command_tooltip: String,
    pub action: Option<ProviderVersionAction>,
    pub manual_update_divider_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderAuthenticatedAs {
    pub email: String,
    pub auth_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatusView {
    pub key: String,
    pub headline: String,
    pub needs_attention: bool,
    pub inline_detail: Option<String>,
    pub list_detail: Option<String>,
    pub diagnostic: Option<String>,
    pub authenticated_as: Option<ProviderAuthenticatedAs>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSwitchView {
    pub checked: bool,
    pub disabled: bool,
    pub aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderListRow {
    pub id: String,
    pub display_name: String,
    pub initials: String,
    pub icon_key: Option<String>,
    pub icon: ProviderCardIcon,
    pub selected: bool,
    pub enabled: bool,
    pub select_aria_label: String,
    pub version_label: Option<String>,
    pub version_advisory: Option<ProviderVersionAdvisory>,
    pub status: ProviderStatusView,
    pub enable_switch: ProviderSwitchView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDeleteAction {
    pub aria_label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDisplayNameRow {
    pub title: String,
    pub input_id: String,
    pub value: String,
    pub placeholder: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRuntimeSection {
    pub title: String,
    pub layout: String,
    pub folded_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCardView {
    pub display_name: String,
    pub badge_label: Option<String>,
    pub icon: ProviderCardIcon,
    pub enabled: bool,
    pub read_only: bool,
    pub status: ProviderStatusView,
    pub version_label: Option<String>,
    pub version_advisory: Option<ProviderVersionAdvisory>,
    pub delete_action: Option<ProviderDeleteAction>,
    pub display_name_row: ProviderDisplayNameRow,
    pub setup_section_title: String,
    pub runtime_section: ProviderRuntimeSection,
    pub environment_section_title: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RedactedTextView {
    pub text: String,
    pub revealed: bool,
    pub aria_label: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccentPickerModel {
    pub value: Option<String>,
    pub swatch_color: String,
    pub trigger_aria_label: String,
    pub plane_label: String,
    pub hue_label: String,
    pub hex_input_aria_label: String,
    pub clear_label: String,
    pub clear_disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LabeledOption {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderFormField {
    pub key: String,
    pub control: String,
    pub label: String,
    pub description: Option<String>,
    pub placeholder: Option<String>,
    pub options: Option<Vec<LabeledOption>>,
    pub input_id: String,
    pub text_value: String,
    pub checked: bool,
    pub selected_label: String,
    pub sensitive: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexRuntimeRow {
    pub id: String,
    pub title: String,
    pub description: String,
    pub input_label: String,
    pub value: String,
    pub tooltip: Option<String>,
    pub placeholder: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all_fields = "camelCase")]
pub enum ProviderRuntimeView {
    #[serde(rename = "codex-managed")]
    CodexManaged { rows: Vec<CodexRuntimeRow> },
    #[serde(rename = "form")]
    Form { fields: Vec<ProviderFormField> },
    #[serde(rename = "unknownDriver")]
    UnknownDriver {
        title: String,
        description_prefix: String,
        driver: String,
        description_suffix: String,
    },
    #[serde(rename = "none")]
    None,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupEnvironmentRow {
    pub title: String,
    pub description: String,
    pub value: String,
    pub enable_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SetupSectionBody {
    Notice { title: String, description: String },
    Actions,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupSectionModel {
    pub environment: SetupEnvironmentRow,
    pub body: SetupSectionBody,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupButton {
    pub kind: Option<String>,
    pub label: String,
    pub disabled: bool,
    pub variant: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupProgress {
    pub label: String,
    pub value: f64,
    pub max: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupRuntimeModel {
    pub title: String,
    pub description: String,
    pub notices: Vec<String>,
    pub status_message: String,
    pub progress: Option<SetupProgress>,
    pub detail_message: Option<String>,
    pub primary_control: Option<SetupButton>,
    pub remove: Option<SetupButton>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupSignInLinks {
    pub open_label: String,
    pub copy_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupExpiry {
    pub prefix: String,
    pub time_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SetupCallback {
    Form {
        expiry: Option<SetupExpiry>,
        prompt: String,
        placeholder: String,
        value: String,
        disabled: bool,
        submit: SetupButton,
    },
    OtherClient {
        message: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupAuthModel {
    pub title: String,
    pub description: String,
    pub status_message: String,
    pub status_visually_hidden: bool,
    pub sign_in_links: Option<SetupSignInLinks>,
    pub primary_control: Option<SetupButton>,
    pub sign_out: Option<SetupButton>,
    pub callback: Option<SetupCallback>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupAlert {
    pub message: String,
    pub retry_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SetupActionsModel {
    pub runtime: SetupRuntimeModel,
    pub auth: SetupAuthModel,
    pub alert: Option<SetupAlert>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ProviderSetupView {
    Antigravity {
        section: Box<SetupSectionModel>,
        actions: Option<Box<SetupActionsModel>>,
        callback_revision: u64,
    },
    Codex {
        key: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentVariableRow {
    pub id: String,
    pub name: String,
    pub name_placeholder: String,
    pub value: String,
    pub value_placeholder: String,
    pub sensitive: bool,
    pub sensitivity_tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentModel {
    pub title: String,
    pub description: String,
    pub add_label: String,
    pub rows: Vec<EnvironmentVariableRow>,
    pub footnote: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelsFilter {
    pub visible: bool,
    pub value: String,
    pub placeholder: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelsBulkToggle {
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelsAddCustom {
    pub show_add_button: bool,
    pub add_button_label: String,
    pub show_form: bool,
    pub placeholder: Option<String>,
    pub submit_label: String,
    pub cancel_label: String,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelRowAction {
    pub aria_label: String,
    pub tooltip: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelFavorite {
    pub active: bool,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelPickerSwitch {
    pub checked: bool,
    pub disabled: bool,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelRow {
    pub slug: String,
    pub name: String,
    pub show_slug: bool,
    pub custom_badge: Option<String>,
    pub group_label: Option<String>,
    pub group_label_is_first: bool,
    pub is_hidden: bool,
    pub capability_summary: Option<String>,
    pub favorite: ModelFavorite,
    pub move_up: Option<ModelRowAction>,
    pub move_down: Option<ModelRowAction>,
    pub edit: Option<ModelRowAction>,
    pub remove: Option<ModelRowAction>,
    pub picker_switch: ModelPickerSwitch,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditorNameField {
    pub label: String,
    pub value: String,
    pub placeholder: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditorCopyFrom {
    pub placeholder: String,
    pub options: Vec<LabeledOption>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditorIdSelect {
    pub visible: bool,
    pub value: String,
    pub display_label: String,
    pub preset_options: Vec<LabeledOption>,
    pub custom_option: LabeledOption,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditorTextField {
    #[serde(default)]
    pub visible: bool,
    pub value: String,
    pub placeholder: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditorTypeSelect {
    pub value: String,
    pub display_label: String,
    pub options: Vec<LabeledOption>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditorChoiceRow {
    pub key: String,
    pub value: String,
    pub value_placeholder: String,
    pub label: String,
    pub label_placeholder: String,
    pub is_default: bool,
    pub default_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditorDescriptorRow {
    pub key: String,
    pub position_label: String,
    pub id_select: EditorIdSelect,
    pub id_input: EditorTextField,
    pub label: EditorTextField,
    #[serde(rename = "type")]
    pub kind: EditorTypeSelect,
    pub choices: Option<Vec<EditorChoiceRow>>,
    pub add_choice_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CustomModelEditorView {
    pub slug: String,
    pub name: EditorNameField,
    pub options_heading: String,
    pub copy_from: Option<EditorCopyFrom>,
    pub empty_message: Option<String>,
    pub descriptors: Vec<EditorDescriptorRow>,
    pub preset_buttons: Vec<LabeledOption>,
    pub custom_option_label: String,
    pub error: Option<String>,
    pub save_label: String,
    pub cancel_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelsView {
    pub title: String,
    pub description: String,
    pub filter: ModelsFilter,
    pub bulk_toggle: Option<ModelsBulkToggle>,
    pub summary: String,
    pub add_custom_model: ModelsAddCustom,
    pub empty_message: Option<String>,
    pub rows: Vec<ModelRow>,
    pub add_revision: u64,
    pub editor: Option<CustomModelEditorView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderEditorView {
    pub instance_id: String,
    pub card: ProviderCardView,
    pub initials: String,
    pub icon_key: Option<String>,
    pub reset_label: Option<String>,
    pub email: Option<RedactedTextView>,
    pub accent: AccentPickerModel,
    pub can_run_version_action: bool,
    pub setup: Option<ProviderSetupView>,
    pub runtime: ProviderRuntimeView,
    pub environment: EnvironmentModel,
    pub models: Option<ProviderModelsView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum LastCheckedView {
    Missing,
    Invalid {
        text: String,
    },
    Relative {
        prefix: String,
        value: String,
        suffix: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RefreshActionView {
    pub label: String,
    pub disabled: bool,
    pub busy: bool,
    pub busy_text: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LabelView {
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAllView {
    pub label: String,
    pub disabled: bool,
    pub tooltip_lines: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TitledNotice {
    pub title: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CursorKeychainRow {
    pub id: String,
    pub title: String,
    pub description: String,
    pub aria_label: String,
    pub value: bool,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HubRemoveConfirmation {
    pub title: String,
    pub description: String,
    pub cancel_label: String,
    pub confirm_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageHubRow {
    pub id: String,
    pub label: String,
    pub description: String,
    pub removable: bool,
    pub remove_label: String,
    pub remove_confirmation: HubRemoveConfirmation,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AddHubField {
    pub key: String,
    pub label: String,
    pub placeholder: Option<String>,
    #[serde(rename = "type")]
    pub input_type: Option<String>,
    pub auto_focus: bool,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AddHubDialog {
    pub revision: u64,
    pub title: String,
    pub description: String,
    pub fields: Vec<AddHubField>,
    pub cancel_label: String,
    pub save_label: String,
    pub can_save: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsageView {
    pub section: ProviderSectionTitle,
    pub add_action: Option<LabelView>,
    pub cursor_keychain_row: Option<CursorKeychainRow>,
    pub empty_label: Option<String>,
    pub hubs: Vec<UsageHubRow>,
    pub add_dialog: Option<AddHubDialog>,
    pub remove_confirmation: Option<UsageHubRow>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HealthIntervalView {
    pub id: String,
    pub title: String,
    pub section_title: String,
    pub policy_tooltip: String,
    pub description: String,
    pub value: f64,
    pub min: f64,
    pub step: f64,
    pub unit_label: String,
    pub disabled: bool,
    pub reset_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WizardStep {
    pub label: String,
    pub summary: Option<String>,
    pub current: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DriverOptionView {
    pub value: String,
    pub label: String,
    pub icon_key: String,
    pub badge_label: Option<String>,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DriverField {
    pub label: String,
    pub value: String,
    pub options: Vec<DriverOptionView>,
    pub visible: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WizardTextField {
    pub label: String,
    pub placeholder: String,
    pub value: String,
    pub hint: String,
    pub visible: bool,
    #[serde(default)]
    pub invalid: bool,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccentSwatch {
    pub value: String,
    pub label: String,
    pub selected: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccentField {
    pub label: String,
    pub swatches: Vec<AccentSwatch>,
    pub clear_label: Option<String>,
    pub hint: String,
    pub visible: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WizardConfig {
    pub has_fields: bool,
    pub empty_message: Option<String>,
    pub visible: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WizardBack {
    pub kind: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum WizardPrimary {
    CodexChoice {
        manual_label: String,
        chat_gpt_label: String,
    },
    Next {
        label: String,
    },
    Submit {
        label: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WizardFooter {
    pub back: WizardBack,
    pub primary: WizardPrimary,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AddInstanceView {
    pub revision: u64,
    pub title: String,
    pub description: String,
    pub current_step: usize,
    pub steps: Vec<WizardStep>,
    pub driver_field: DriverField,
    pub label_field: WizardTextField,
    pub instance_id_field: WizardTextField,
    pub accent_field: AccentField,
    pub config: WizardConfig,
    pub config_fields: Vec<ProviderFormField>,
    pub accent_picker: AccentPickerModel,
    pub footer: WizardFooter,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HsvView {
    pub h: f64,
    pub s: f64,
    pub v: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccentPopoverView {
    pub target: String,
    pub model: AccentPickerModel,
    pub hsv: HsvView,
    pub hue_color: String,
    pub hex: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProvidersSettingsBody {
    pub environment_id: String,
    pub environment_label: String,
    pub read_only: bool,
    pub section: ProviderSectionTitle,
    pub update_all: Option<UpdateAllView>,
    pub last_checked: LastCheckedView,
    pub refresh_action: Option<RefreshActionView>,
    pub add_action: Option<LabelView>,
    pub read_only_notice: Option<TitledNotice>,
    pub rows: Vec<ProviderListRow>,
    pub editor: Option<ProviderEditorView>,
    pub empty_message: Option<String>,
    pub usage: ProviderUsageView,
    pub health: HealthIntervalView,
    pub add_instance: Option<AddInstanceView>,
    pub accent_popover: Option<AccentPopoverView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SettingsProvidersView {
    Message {
        message: String,
    },
    Placeholder {
        placeholder: ProviderPlaceholderView,
        error: Option<ExpandableTextView>,
    },
    Settings(Box<ProvidersSettingsBody>),
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoadBalancingOption {
    pub value: f64,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoadBalancingRow {
    pub id: String,
    pub machine_kind: EnvironmentMachineKind,
    pub label: String,
    pub subtitle: String,
    pub value: f64,
    pub aria_label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsLoadBalancingView {
    pub section: ProviderSectionTitle,
    pub summary: Option<String>,
    pub enabled: bool,
    pub toggle_aria_label: String,
    pub toggle_disabled: bool,
    pub description: String,
    pub options: Vec<LoadBalancingOption>,
    pub rows: Vec<LoadBalancingRow>,
}
