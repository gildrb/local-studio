use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FirstRunRecoveryAction {
    pub kind: String,
    pub label: String,
    pub enabled: bool,
    pub refreshing: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum FirstRunGateView {
    App,
    Blank,
    Recovery {
        title: String,
        description: String,
        action: FirstRunRecoveryAction,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WizardStage {
    pub index: usize,
    pub label: String,
    pub current: bool,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WizardHeader {
    pub title: String,
    pub brand_label: String,
    pub stage_index: usize,
    pub stages: Vec<WizardStage>,
    pub hold_height: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ButtonModel {
    pub label: String,
    pub enabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandBlock {
    pub prompt: String,
    pub command: String,
    pub copy_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextSegment {
    pub kind: String,
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PairingForm {
    pub label: String,
    pub placeholder: String,
    pub value: String,
    pub read_only: bool,
    pub invalid: bool,
    pub error_message: Option<String>,
    pub help_toggle_label: String,
    pub help_text: String,
    pub help_command: CommandBlock,
    pub help_footnote: Vec<TextSegment>,
    pub submit: ButtonModel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PairingOption {
    pub label: String,
    pub open: bool,
    pub trigger_disabled: bool,
    pub form: PairingForm,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionRow {
    pub environment_id: String,
    pub label: String,
    pub status_label: String,
    pub display_url: Option<String>,
    pub checked: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionBody {
    pub heading: String,
    pub description: String,
    pub rows: Vec<ConnectionRow>,
    pub pairing: PairingOption,
    pub continue_button: ButtonModel,
    pub pairing_help_open: bool,
    pub pairing_value_revision: u64,
    pub copied_command: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentCardStatus {
    Ready { label: String },
    Text { label: String },
    Action { label: String, enabled: bool },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentCard {
    pub icon: String,
    pub icon_filled: bool,
    pub display_name: String,
    pub description: String,
    pub status: AgentCardStatus,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentCardEntry {
    Card {
        key: String,
        driver: String,
        provider_instance_id: Option<String>,
        card: AgentCard,
    },
    CodexSetup {
        key: String,
        host_key: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentTerminalMessage {
    RunCommand { command: String },
    Text { text: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentTerminalModel {
    pub message: AgentTerminalMessage,
    pub retry_label: Option<String>,
    pub close_label: String,
    pub show_viewport: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentTerminal {
    pub model: AgentTerminalModel,
    pub session_key: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentsSection {
    pub environment_id: String,
    pub heading: String,
    pub cards: Vec<AgentCardEntry>,
    pub add_account_label: Option<String>,
    pub terminal: Option<AgentTerminal>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentsBody {
    pub heading: String,
    pub description: String,
    pub sections: Vec<AgentsSection>,
    pub continue_button: ButtonModel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportSourceSlot {
    pub icon: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportRowMeta {
    pub source_slots: Vec<Option<ImportSourceSlot>>,
    pub thread_count: String,
    pub age: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportRow {
    pub key: String,
    pub label: String,
    pub secondary: Option<String>,
    pub tooltip: String,
    pub nested: bool,
    pub checked: bool,
    pub meta: ImportRowMeta,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ImportGroup {
    Row {
        row: ImportRow,
    },
    Group {
        key: String,
        label: String,
        keys: Vec<String>,
        checked: bool,
        indeterminate: bool,
        meta: ImportRowMeta,
        rows: Vec<ImportRow>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportOther {
    pub label: String,
    pub count_label: String,
    pub keys: Vec<String>,
    pub checked: bool,
    pub indeterminate: bool,
    pub rows: Vec<ImportRow>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportList {
    pub groups: Vec<ImportGroup>,
    pub other: Option<ImportOther>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ImportSectionStatus {
    Pending {
        label: String,
    },
    Error {
        message: String,
        retry_label: String,
    },
    Empty {
        label: String,
    },
    None,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportSection {
    pub environment_id: String,
    pub legend: Option<String>,
    pub disabled: bool,
    pub status: ImportSectionStatus,
    pub truncated_message: Option<String>,
    pub list: ImportList,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportSelection {
    pub summary: String,
    pub select_all: ButtonModel,
    pub select_none: ButtonModel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportBody {
    pub heading: String,
    pub description: String,
    pub selection: Option<ImportSelection>,
    pub sections: Vec<ImportSection>,
    pub skip_button: ButtonModel,
    pub import_button: ButtonModel,
    pub collapsed_groups: Vec<String>,
    pub open_other: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportLoadingBody {
    pub heading: String,
    pub message: String,
    pub skip_button: ButtonModel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WizardBody {
    Connection(Box<ConnectionBody>),
    Agents(Box<AgentsBody>),
    Import(Box<ImportBody>),
    ImportLoading(Box<ImportLoadingBody>),
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WelcomeWizardView {
    pub header: WizardHeader,
    pub body: WizardBody,
}
