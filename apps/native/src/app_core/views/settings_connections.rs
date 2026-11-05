use serde::Deserialize;

use crate::app_core::views::sidebar::EnvironmentMachineKind;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ButtonModel {
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BusyButtonModel {
    pub label: String,
    pub busy: bool,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SwitchModel {
    pub checked: bool,
    pub disabled: bool,
    pub aria_label: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ButtonVariantView {
    Default,
    Outline,
    Destructive,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DialogModel {
    pub open: bool,
    pub title: String,
    pub description: String,
    pub cancel: ButtonModel,
    pub confirm: BusyButtonModel,
    pub confirm_variant: ButtonVariantView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AccessScopeSummary {
    pub count_label: String,
    pub aria_label: String,
    pub heading: String,
    pub scopes: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PairingEndpointOption {
    pub id: String,
    pub label: String,
    pub url: String,
    pub detail: String,
    pub selected: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PairingCodeAction {
    CopyCode,
    ShowDialog,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PairingLinkReveal {
    pub available: bool,
    pub title: String,
    pub description: String,
    pub value: String,
    pub rows: u32,
    pub show_qr: bool,
    pub done_label: String,
    pub copy_code_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PairingLinkQrPanel {
    pub visible: bool,
    pub endpoint_picker_visible: bool,
    pub endpoint_picker_label: String,
    pub url: Option<String>,
    pub copy_link_label: String,
    pub copy_code_label: String,
    pub can_render_qr: bool,
    pub no_qr_message: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PairingLinkRow {
    pub id: String,
    pub title: String,
    pub created_tooltip: String,
    pub expires_label: String,
    pub expires_tooltip: String,
    pub scope_summary: AccessScopeSummary,
    pub hint: Option<String>,
    pub share_button_label: Option<String>,
    pub code_action: Option<PairingCodeAction>,
    pub code_action_label: String,
    pub endpoint_options: Vec<PairingEndpointOption>,
    pub qr_panel: PairingLinkQrPanel,
    pub reveal: PairingLinkReveal,
    pub revoke: ButtonModel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClientSessionRow {
    pub id: String,
    pub title: String,
    pub is_live: bool,
    pub status_tooltip: String,
    pub current_badge_label: Option<String>,
    pub device_info: Option<String>,
    pub scope_summary: AccessScopeSummary,
    pub revoke: Option<ButtonModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LabelField {
    pub label: String,
    pub placeholder: String,
    pub value: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PairingScopePreset {
    pub id: String,
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PairingScopeOption {
    pub scope: String,
    pub title: String,
    pub description: String,
    pub checked: bool,
    pub disabled: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ValidationTone {
    Error,
    Warning,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Validation {
    pub tone: ValidationTone,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreatePairingLinkDialog {
    pub title: String,
    pub description: String,
    pub label_field: LabelField,
    pub permissions_title: String,
    pub permissions_description: String,
    pub presets: Vec<PairingScopePreset>,
    pub scope_options: Vec<PairingScopeOption>,
    pub validation: Option<Validation>,
    pub cancel: ButtonModel,
    pub create: ButtonModel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizedClientsHeader {
    pub revoke_others: ButtonModel,
    pub create_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizedClients {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub error: Option<String>,
    pub empty_message: Option<String>,
    pub header: AuthorizedClientsHeader,
    pub pairing_links: Vec<PairingLinkRow>,
    pub client_sessions: Vec<ClientSessionRow>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdvertisedEndpointRow {
    pub id: String,
    pub label: String,
    pub url: String,
    pub show_url: bool,
    pub available: bool,
    pub is_default: bool,
    pub setup_required_label: Option<String>,
    pub default_badge_label: Option<String>,
    pub setup_action: Option<ButtonModel>,
    pub disable_action: Option<ButtonModel>,
    pub set_default_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum NetworkAccessDescription {
    Text {
        text: String,
    },
    Endpoint {
        prefix: String,
        url: String,
        expandable: bool,
        toggle_label: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum NetworkAccessRow {
    Toggle {
        id: String,
        title: String,
        description: NetworkAccessDescription,
        status: Option<String>,
        switch: SwitchModel,
    },
    Locked {
        id: String,
        title: String,
        description: String,
        switch: SwitchModel,
        tooltip: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleRow {
    pub id: String,
    pub title: String,
    pub description: String,
    pub switch: Option<SwitchModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SelectOption {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WslSelect {
    pub value: String,
    pub label: String,
    pub aria_label: String,
    pub disabled: bool,
    pub options: Vec<SelectOption>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WslOnlyRow {
    pub title: String,
    pub description: String,
    pub switch: SwitchModel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum WslSettings {
    Hidden,
    LoadError {
        id: String,
        title: String,
        description: String,
        error: Option<String>,
        retry: ButtonModel,
    },
    Unavailable {
        id: String,
        title: String,
        description: String,
        error: Option<String>,
        switch_to_windows: ButtonModel,
    },
    Picker {
        id: String,
        title: String,
        description: String,
        status: Option<String>,
        select: WslSelect,
        wsl_only: Option<WslOnlyRow>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WslConfirmAction {
    pub id: String,
    pub label: String,
    pub busy: bool,
    pub disabled: bool,
    pub variant: ButtonVariantView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WslConfirmDialog {
    pub open: bool,
    pub title: String,
    pub description: String,
    pub cancel: ButtonModel,
    pub actions: Vec<WslConfirmAction>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleSetupDialog {
    pub open: bool,
    pub title: String,
    pub description: String,
    pub port_label: String,
    pub port_value: String,
    pub port_disabled: bool,
    pub validation_message: Option<String>,
    pub endpoint_label: String,
    pub base_url_text: String,
    pub cancel: ButtonModel,
    pub confirm: BusyButtonModel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum VersionDescription {
    Progress,
    Text { text: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum VersionControl {
    Update { label: String },
    UpToDate { text: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VersionRow {
    pub title: String,
    pub description: VersionDescription,
    pub control: Option<VersionControl>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrimaryHeader {
    pub id: String,
    pub title: String,
    pub icon_kind: EnvironmentMachineKind,
    pub menu_aria_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedPrimary {
    pub header: PrimaryHeader,
    pub version: Option<VersionRow>,
    pub network_access: Option<NetworkAccessRow>,
    pub endpoint_rows: Vec<AdvertisedEndpointRow>,
    pub tailscale: Option<TailscaleRow>,
    pub wsl: Option<WslSettings>,
    pub authorized_clients: Option<AuthorizedClients>,
    pub create_pairing_link_dialog: CreatePairingLinkDialog,
    pub network_exposure_dialog: DialogModel,
    pub wsl_confirm_dialog: WslConfirmDialog,
    pub tailscale_disable_dialog: DialogModel,
    pub tailscale_setup_dialog: TailscaleSetupDialog,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TitledText {
    pub title: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PrimarySection {
    Managed(Box<ManagedPrimary>),
    Restricted {
        id: String,
        title: String,
        administrative_access: TitledText,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum StatusTone {
    Muted,
    Error,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToggleWithTooltip {
    pub checked: bool,
    pub disabled: bool,
    pub aria_label: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CopyTraceId {
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedBackendMenu {
    pub aria_label: String,
    pub disabled: bool,
    pub copy_trace_id: Option<CopyTraceId>,
    pub remove_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedBackendRow {
    pub id: String,
    pub label: String,
    pub machine_kind: EnvironmentMachineKind,
    pub dimmed: bool,
    pub subtitle: String,
    pub subtitle_tone: StatusTone,
    pub status_tooltip: String,
    pub toggle: ToggleWithTooltip,
    pub menu: SavedBackendMenu,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SavedBackendMode {
    Remote,
    Ssh,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionModeCard {
    pub mode: SavedBackendMode,
    pub title: String,
    pub description: String,
    pub icon: String,
    pub selected: bool,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFields {
    pub host_label: String,
    pub host_placeholder: String,
    pub host_value: String,
    pub pairing_code_label: String,
    pub pairing_code_placeholder: String,
    pub pairing_code_value: String,
    pub hint: String,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SshHostSuggestion {
    pub key: String,
    pub alias: String,
    pub address: Option<String>,
    pub shortcut_label: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SuggestionsState {
    Loading,
    List,
    Empty,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SshHostSuggestions {
    pub has_content: bool,
    pub state: SuggestionsState,
    pub loading_label: String,
    pub empty_label: String,
    pub items: Vec<SshHostSuggestion>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SshFields {
    pub host_label: String,
    pub host_placeholder: String,
    pub host_value: String,
    pub username_label: String,
    pub username_placeholder: String,
    pub username_value: String,
    pub port_label: String,
    pub port_placeholder: String,
    pub port_value: String,
    pub suggestions: SshHostSuggestions,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AddEnvironmentDialog {
    pub trigger_label: String,
    pub title: String,
    pub description: String,
    pub mode: SavedBackendMode,
    pub mode_cards: Vec<ConnectionModeCard>,
    pub remote: RemoteFields,
    pub ssh: SshFields,
    pub fields_disabled: bool,
    pub submit: ButtonModel,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum EmptyMode {
    CloudRows,
    Empty,
    None,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEnvironments {
    pub id: String,
    pub title: String,
    pub add_environment_dialog: AddEnvironmentDialog,
    pub rows: Vec<SavedBackendRow>,
    pub empty_mode: EmptyMode,
    pub empty_state: TitledText,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionsModel {
    pub primary: PrimarySection,
    pub remote_environments: RemoteEnvironments,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalEnvironmentConfirm {
    pub label: String,
    pub variant: ButtonVariantView,
    pub disabled: bool,
    pub busy: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalEnvironmentDialog {
    pub open: bool,
    pub title: String,
    pub description: String,
    pub error: Option<String>,
    pub cancel_label: String,
    pub cancel_disabled: bool,
    pub confirm: LocalEnvironmentConfirm,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalEnvironmentSetting {
    pub id: String,
    pub title: String,
    pub description: String,
    pub switch: SwitchModel,
    pub dialog: LocalEnvironmentDialog,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentIconOption {
    pub value: String,
    pub label: String,
    pub icon: EnvironmentMachineKind,
    pub badge: Option<String>,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentIconMenu {
    pub label: String,
    pub icon: EnvironmentMachineKind,
    pub value: String,
    pub lock: Option<String>,
    pub options: Vec<EnvironmentIconOption>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ServerUpdateAction {
    DesktopAppRequired { text: String },
    Action { label: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerUpdateControl {
    pub environment_id: String,
    pub action: ServerUpdateAction,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ServerUpdateProgress {
    Running { label: String },
    Failed { message: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionsEnvironmentRow {
    pub environment_id: String,
    pub icon_menu: EnvironmentIconMenu,
    pub update: Option<ServerUpdateControl>,
    pub progress: Option<ServerUpdateProgress>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRoutingRow {
    pub id: String,
    pub kind: EnvironmentMachineKind,
    pub label: String,
    pub subtitle: String,
    pub value: String,
    pub options: Vec<SelectOption>,
    pub disabled: bool,
    pub aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubRouting {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub description: String,
    pub rows: Vec<GitHubRoutingRow>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsConnectionsView {
    pub model: ConnectionsModel,
    pub local_environment: Option<LocalEnvironmentSetting>,
    pub primary_environment_id: Option<String>,
    pub primary_icon_menu: Option<EnvironmentIconMenu>,
    pub primary_update: Option<ServerUpdateControl>,
    pub primary_progress: Option<ServerUpdateProgress>,
    pub rows: Vec<ConnectionsEnvironmentRow>,
    pub update_all: Option<ButtonModel>,
    pub github_routing: Option<GitHubRouting>,
    pub create_pairing_link_open: bool,
    pub reveal_pairing_link_id: Option<String>,
    pub add_environment_open: bool,
    pub ssh_suggestions_open: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SshPasswordPromptView {
    pub request_id: String,
    pub destination: String,
    pub username: Option<String>,
    pub prompt: String,
    pub expires_in_ms: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppRelaunchView {
    pub revision: u64,
}
