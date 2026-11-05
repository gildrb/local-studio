use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerModelView {
    pub label: String,
    pub driver_kind: Option<String>,
    pub initials: String,
    pub accent_color: Option<String>,
    pub show_instance_badge: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerAccessView {
    pub mode: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerAccessOption {
    pub mode: String,
    pub label: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TraitsUnavailableItem {
    pub id: String,
    pub label: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TraitsOption {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TraitsSelectSection {
    pub id: String,
    pub label: String,
    pub notice: Option<String>,
    pub selected_value: String,
    pub disabled: bool,
    pub options: Vec<TraitsOption>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TraitsBooleanSection {
    pub id: String,
    pub label: String,
    pub selected_value: String,
    pub options: Vec<TraitsOption>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum TraitsMenuView {
    Unavailable {
        items: Vec<TraitsUnavailableItem>,
    },
    Controls {
        selects: Vec<TraitsSelectSection>,
        booleans: Vec<TraitsBooleanSection>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerPendingAction {
    pub compact: bool,
    pub show_previous: bool,
    pub previous_disabled: bool,
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ComposerPlanActionKind {
    Refine,
    Implement,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerPlanAction {
    pub compact: bool,
    pub kind: ComposerPlanActionKind,
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ComposerView {
    pub thread_key: Option<String>,
    pub placeholder: String,
    pub prompt: String,
    pub prompt_revision: u64,
    pub thread_error: Option<String>,
    pub provider_input_error: Option<String>,
    pub approval_pending: bool,
    pub editor_disabled: bool,
    pub pending_action: Option<ComposerPendingAction>,
    pub plan_action: Option<ComposerPlanAction>,
    pub has_sendable_content: bool,
    pub running: bool,
    pub can_interrupt: bool,
    pub working: bool,
    pub model: Option<ComposerModelView>,
    pub traits: Option<String>,
    pub traits_menu: Option<TraitsMenuView>,
    pub access: ComposerAccessView,
    pub access_options: Vec<ComposerAccessOption>,
}
