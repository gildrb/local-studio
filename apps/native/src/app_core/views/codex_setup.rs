use std::collections::HashMap;

use serde::Deserialize;
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexButton {
    pub label: String,
    pub disabled: bool,
    pub intent: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum CodexControl {
    Ready {
        label: String,
    },
    Status {
        label: String,
    },
    Connect {
        label: String,
        disabled: bool,
        intent: Option<Value>,
    },
    Button {
        label: String,
        disabled: bool,
        emphasized: bool,
        intent: Option<Value>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexHelpToggle {
    pub expanded: bool,
    pub aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexEmail {
    pub text: String,
    pub revealed: bool,
    pub tooltip: String,
    pub aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum CodexDescription {
    Text {
        text: String,
    },
    SignedIn {
        prefix: String,
        suffix: String,
        email: Option<CodexEmail>,
    },
    SignInHelp {
        label: String,
        toggle: Option<CodexHelpToggle>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexSubmit {
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexBrowserRetry {
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexHandoffLink {
    pub summary: String,
    pub label: String,
    pub href: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexCallback {
    pub flow_id: String,
    pub prompt: String,
    pub input_label: String,
    pub placeholder: String,
    pub value: String,
    pub max_length: usize,
    pub input_disabled: bool,
    pub submit: CodexSubmit,
    pub browser_retry: Option<CodexBrowserRetry>,
    pub handoff: Option<CodexHandoffLink>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum CodexFooter {
    Completion {
        bordered: bool,
        callback: CodexCallback,
    },
    Help {
        label: String,
        toggle: Option<CodexHelpToggle>,
        content: Option<CodexCallback>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexCard {
    pub key: String,
    pub title: String,
    pub description: CodexDescription,
    pub control: CodexControl,
    pub secondary: Option<CodexButton>,
    pub footer: Option<CodexFooter>,
    pub setup_error: Option<String>,
}

pub type CodexCards = HashMap<String, CodexCard>;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexAddAccountForm {
    pub title: String,
    pub description: String,
    pub input_label: String,
    pub placeholder: String,
    pub value: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexAddAccountPreparing {
    pub title: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexFinishLater {
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexAddAccount {
    pub revision: u64,
    pub title: String,
    pub description: String,
    pub form: Option<CodexAddAccountForm>,
    pub preparing: Option<CodexAddAccountPreparing>,
    pub setup_key: Option<String>,
    pub cancel: Option<CodexSubmit>,
    pub submit: Option<CodexSubmit>,
    pub finish_later: Option<CodexFinishLater>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum CodexSettingsControls {
    AuthActive {
        waiting: CodexWaitingButton,
        cancel: Option<CodexButton>,
    },
    InstallActive {
        cancel: CodexButton,
    },
    Authenticated {
        change_account: CodexButton,
        disconnect: CodexButton,
    },
    Connect {
        connect: CodexButton,
        different_account: Option<CodexButton>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexWaitingButton {
    pub label: String,
    pub disabled: bool,
    pub emphasized: bool,
    pub intent: Option<Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum CodexSettingsSection {
    Preparing {
        key: String,
        title: String,
        description: String,
    },
    Managed {
        key: String,
        title: String,
        description: Box<CodexDescription>,
        controls: Box<CodexSettingsControls>,
        usage_label: Option<String>,
        logout_warning: Option<String>,
        fallback: Option<Box<CodexFooter>>,
        error: Option<String>,
    },
}

pub type CodexSettingsSections = HashMap<String, CodexSettingsSection>;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexAccountOption {
    pub kind: String,
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexAccountPicker {
    pub key: String,
    pub title: String,
    pub description: String,
    pub group_label: String,
    pub selected_method_id: String,
    pub options: Vec<CodexAccountOption>,
    pub confirm_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexWelcome {
    pub title: String,
    pub description: String,
    pub detail: String,
    pub usage_label: String,
    pub continue_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexDialogs {
    pub add_account: Option<CodexAddAccount>,
    pub account_picker: Option<CodexAccountPicker>,
    pub welcome: Option<CodexWelcome>,
}
