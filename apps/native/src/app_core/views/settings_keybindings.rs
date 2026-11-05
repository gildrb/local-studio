use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingsSettingsView {
    pub bindings_count_label: String,
    pub search_focus_revision: u64,
    pub search: KeybindingsSearchView,
    pub add_button_label: String,
    pub open_file_button: KeybindingsOpenFileView,
    pub browser_notice: Option<String>,
    pub when_variables: Vec<String>,
    pub rows: Vec<KeybindingRowView>,
    pub new_binding: Option<NewKeybindingView>,
    pub empty_state: Option<String>,
    pub when_builder: Option<WhenBuilderView>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingsSearchView {
    pub is_open: bool,
    pub query: String,
    pub label: String,
    pub close_on_blur: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingsOpenFileView {
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingButtonView {
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingWarningView {
    pub label: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingWhenTriggerView {
    pub prefix: String,
    pub display: String,
    pub is_set: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingKeyInputView {
    pub value: String,
    pub placeholder: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingPillPartView {
    pub label: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingPillView {
    pub parts: Vec<KeybindingPillPartView>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingRowEditorView {
    pub is_recording: bool,
    pub when: KeybindingWhenTriggerView,
    pub conflict_warning: Option<KeybindingWarningView>,
    pub pill: Option<KeybindingPillView>,
    pub key_input: KeybindingKeyInputView,
    pub save_button: Option<KeybindingButtonView>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingRowMenuView {
    pub trigger_label: String,
    pub disabled: bool,
    pub reset: Option<KeybindingButtonView>,
    pub remove: Option<KeybindingButtonView>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingRowView {
    pub id: String,
    pub label: String,
    pub command_tooltip: String,
    pub source_badge: Option<String>,
    pub anchor_id: Option<String>,
    pub menu: Option<KeybindingRowMenuView>,
    pub editor: KeybindingRowEditorView,
    pub pass_tab: bool,
    pub menu_open: bool,
    pub when_open: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingCommandOptionView {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingCommandSelectView {
    pub value: String,
    pub placeholder: String,
    pub options: Vec<KeybindingCommandOptionView>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingCancelView {
    pub tooltip: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewKeybindingView {
    pub title: String,
    pub command_select: KeybindingCommandSelectView,
    pub when: KeybindingWhenTriggerView,
    pub is_recording: bool,
    pub conflict_warning: Option<KeybindingWarningView>,
    pub key_input: KeybindingKeyInputView,
    pub save_button: KeybindingButtonView,
    pub cancel_button: KeybindingCancelView,
    pub pass_tab: bool,
    pub when_open: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhenExpressionInputView {
    pub value: String,
    pub placeholder: String,
    pub invalid: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhenBuilderView {
    pub target: String,
    pub title: String,
    pub add_condition_label: String,
    pub add_group_label: String,
    pub expression_input: WhenExpressionInputView,
    pub unknown_warning: Option<KeybindingWarningView>,
    pub parse_error: Option<String>,
    pub tree: Option<WhenNodeView>,
    pub invalid_overlay: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhenRemoveView {
    pub label: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhenOperatorOptionView {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhenGroupChildView {
    pub key: String,
    pub model: WhenNodeView,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum WhenNodeView {
    Condition {
        path: Vec<u32>,
        identifier: String,
        negated: bool,
        negate_text: String,
        placeholder: String,
        options: Vec<String>,
        unknown_warning: Option<KeybindingWarningView>,
        remove: Option<WhenRemoveView>,
    },
    Not {
        path: Vec<u32>,
        depth: u32,
        negate_text: String,
        remove: Option<WhenRemoveView>,
        child: Box<WhenNodeView>,
    },
    Group {
        path: Vec<u32>,
        depth: u32,
        operator: String,
        operator_options: Vec<WhenOperatorOptionView>,
        add_condition_label: String,
        add_group_label: String,
        remove: Option<WhenRemoveView>,
        children: Vec<WhenGroupChildView>,
    },
}
