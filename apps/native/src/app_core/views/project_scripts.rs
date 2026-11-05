use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScriptRef {
    pub id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScriptPrimary {
    pub script: ProjectScriptRef,
    pub name: String,
    pub icon: String,
    pub run_label: String,
    pub shortcut_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ProjectScriptsToolbar {
    Split { primary: ProjectScriptPrimary },
    ImportMenu,
    AddButton,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScriptMenuItem {
    pub script_id: String,
    pub label: String,
    pub icon: String,
    pub shortcut_label: Option<String>,
    pub edit_aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScriptImportItem {
    pub key: String,
    pub label: String,
    pub icon: String,
    pub import_aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScriptsToolbarModel {
    pub toolbar: ProjectScriptsToolbar,
    pub menu_kind: String,
    pub primary: Option<ProjectScriptPrimary>,
    pub add_project_action_label: String,
    pub submenu_label: String,
    pub submenu_icon: String,
    pub script_items: Vec<ProjectScriptMenuItem>,
    pub import_items: Vec<ProjectScriptImportItem>,
    pub show_import_separator: bool,
    pub import_group_label: String,
    pub add_action_label: String,
    pub menu_trigger_aria_label: String,
    pub import_menu_trigger_aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScriptEditorCopy {
    pub title: String,
    pub description: String,
    pub submit_label: String,
    pub cancel_label: String,
    pub delete_label: String,
    pub delete_confirm_title: String,
    pub delete_confirm_description: String,
    pub delete_confirm_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScriptEditorForm {
    pub name: String,
    pub command: String,
    pub icon: String,
    pub run_on_worktree_create: bool,
    pub wait_for_setup: bool,
    pub keybinding: String,
    pub preview_url: String,
    pub auto_open_preview: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScriptEditorToggles {
    pub wait_for_setup_disabled: bool,
    pub auto_open_preview_disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScriptIconOption {
    pub id: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScriptEditorView {
    pub id: u64,
    pub is_editing: bool,
    pub is_saving: bool,
    pub copy: ProjectScriptEditorCopy,
    pub form: ProjectScriptEditorForm,
    pub toggles: ProjectScriptEditorToggles,
    pub icon_options: Vec<ProjectScriptIconOption>,
    pub icon_picker_open: bool,
    pub validation_error: Option<String>,
    pub delete_confirm_open: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScriptsView {
    pub toolbar: Option<ProjectScriptsToolbarModel>,
    pub editor: Option<ProjectScriptEditorView>,
}
