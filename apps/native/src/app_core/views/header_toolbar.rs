use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HeaderToolbarActions {
    pub show_project_scripts: bool,
    pub show_open_in_picker: bool,
    pub show_git_actions: bool,
    pub separator_before_open_in: bool,
    pub separator_before_git: bool,
    pub overflow_trigger_visible: bool,
    pub overflow_trigger_aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitQuickAction {
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum GitToolbarView {
    Hidden,
    Init {
        label: String,
        disabled: bool,
    },
    Repo {
        source_control_icon: String,
        quick_action: GitQuickAction,
        quick_action_icon: String,
        quick_action_button_disabled: bool,
        quick_action_menu_item_disabled: bool,
        quick_action_disabled_reason: Option<String>,
        menu_trigger_disabled: bool,
        submenu_label: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PanelToggleView {
    pub visible: bool,
    pub pressed: bool,
    pub disabled: bool,
    pub icon: String,
    pub badge_count: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PanelTogglesView {
    pub terminal: PanelToggleView,
    pub right_panel: PanelToggleView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HeaderToolbarView {
    pub actions: HeaderToolbarActions,
    pub layout: HeaderActionsLayoutView,
    pub git: GitToolbarView,
    pub panels: PanelTogglesView,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HeaderActionsLayoutView {
    pub collapsed: bool,
    pub expanded: bool,
    pub fade_ms: f32,
    pub transition_ms: f32,
}
