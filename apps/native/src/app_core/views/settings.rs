use serde::{Deserialize, Serialize};

use super::sidebar::{EnvironmentMachineKind, ProjectIconView};

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsNavSectionView {
    pub id: String,
    pub section: String,
    pub label: String,
    pub icon: String,
    pub active: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSearchResultView {
    pub id: String,
    pub element_id: String,
    pub title: String,
    pub section_label: String,
    pub icon: String,
    pub to: String,
    pub target_id: String,
    pub active: bool,
    pub section: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsNavSearchView {
    pub query: String,
    pub placeholder: String,
    pub aria_label: String,
    pub clear_label: String,
    pub shortcut_hint: String,
    pub results_label: String,
    pub is_searching: bool,
    pub has_results: bool,
    pub expanded: bool,
    pub active_result_index: usize,
    pub active_descendant_id: Option<String>,
    pub empty_message: Option<String>,
    pub results: Vec<SettingsSearchResultView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsNavView {
    pub active_section: Option<String>,
    pub sections: Vec<SettingsNavSectionView>,
    pub search: SettingsNavSearchView,
    pub back_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsBreadcrumbItemView {
    pub label: String,
    pub current: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsBreadcrumbView {
    pub aria_label: String,
    pub section_label: Option<String>,
    pub items: Vec<SettingsBreadcrumbItemView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsRestoreView {
    pub action_label: String,
    pub changed_setting_labels: Vec<String>,
    pub can_restore: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsScopeSearchView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub machine: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkout: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SettingsScopeIconView {
    Layers,
    EnvironmentMachine {
        machine: EnvironmentMachineKind,
    },
    ProjectFavicon {
        project_key: String,
        icon: ProjectIconView,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsScopeMenuOptionView {
    pub value: String,
    pub label: String,
    pub icon: Option<SettingsScopeIconView>,
    pub badge: Option<String>,
    pub separator_after: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsScopeMenuView {
    pub axis: String,
    pub aria_label: String,
    pub label: String,
    pub icon: Option<SettingsScopeIconView>,
    pub value: String,
    pub options: Vec<SettingsScopeMenuOptionView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsScopeSentenceView {
    pub lead: String,
    pub connective: String,
    pub project: SettingsScopeMenuView,
    pub environment: SettingsScopeMenuView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsScopeNoticeChoiceView {
    pub id: String,
    pub label: String,
    pub search: SettingsScopeSearchView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SettingsBoundaryView {
    Content,
    Notice {
        message: String,
        target_id: String,
        choices: Vec<SettingsScopeNoticeChoiceView>,
    },
    Message {
        message: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsTargetView {
    pub target_id: Option<String>,
    pub highlight: bool,
    pub revision: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsChromeView {
    pub section: String,
    pub pathname: String,
    pub native: bool,
    pub breadcrumb: SettingsBreadcrumbView,
    pub restore: Option<SettingsRestoreView>,
    pub scope_sentence: Option<SettingsScopeSentenceView>,
    pub boundary: SettingsBoundaryView,
    pub target: SettingsTargetView,
    pub content_key: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SettingsRowResetView {
    RowAction,
    None,
    ClearOverrides { tooltip: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingInheritanceStatusView {
    pub state: String,
    pub summary: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingInheritanceLayerView {
    pub key: String,
    pub label: String,
    pub value: String,
    pub effective: bool,
    pub set: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingInheritanceOverrideRowView {
    pub environment_id: String,
    pub project_id: String,
    pub label: String,
    pub value: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingInheritanceOverridesView {
    pub heading: String,
    pub reset_label: Option<String>,
    pub projects: Vec<SettingInheritanceOverrideRowView>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectOverrideEntryView {
    pub environment_id: String,
    pub project_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SettingInheritanceResetView {
    ClearProjectOverrides {
        entries: Vec<ProjectOverrideEntryView>,
    },
    None,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingInheritanceChainView {
    pub id: String,
    pub environment_id: String,
    pub project_id: Option<String>,
    pub title: String,
    pub machine: EnvironmentMachineKind,
    pub layers: Vec<SettingInheritanceLayerView>,
    pub overrides: Option<SettingInheritanceOverridesView>,
    pub reset: SettingInheritanceResetView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingInheritanceModelView {
    pub visible: bool,
    pub state: String,
    pub tone: String,
    pub summary: String,
    pub trigger_aria_label: String,
    pub chains: Vec<SettingInheritanceChainView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsRowOverridingProjectView {
    pub environment_id: String,
    pub project_id: String,
    pub label: String,
    pub project_key: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsRowScopeView {
    pub is_project_scope: bool,
    pub scoped_keys: Vec<String>,
    pub environment_wide: bool,
    pub mixed: bool,
    pub source: Option<String>,
    pub unavailable: bool,
    pub inert_message: Option<String>,
    pub reset: SettingsRowResetView,
    pub inheritance: Option<SettingInheritanceStatusView>,
    pub setting_keys: Vec<String>,
    pub inheritance_model: Option<SettingInheritanceModelView>,
    pub overriding_projects: Vec<SettingsRowOverridingProjectView>,
}
