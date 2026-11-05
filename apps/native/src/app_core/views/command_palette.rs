use serde::Deserialize;

use crate::app_core::views::sidebar::{EnvironmentMachineKind, ProjectIconView};

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandPaletteView {
    pub query: String,
    pub query_revision: u64,
    pub placeholder: String,
    pub input_addon: InputAddon,
    pub is_submenu: bool,
    pub groups: Vec<PaletteGroupView>,
    pub highlighted: Option<String>,
    pub empty_state_message: String,
    pub footer_action_label: Option<String>,
    pub show_back_hint: bool,
    pub submit: Option<PaletteSubmitView>,
    pub input_padding_end: f32,
    pub new_project_header: Option<PaletteHeaderView>,
    pub repository_header: Option<PaletteRepositoryHeaderView>,
    pub file_manager_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaletteHeaderView {
    pub title: String,
    pub detail: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaletteRepositoryHeaderView {
    pub title: String,
    pub description: String,
    pub icon: PaletteIconView,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum InputAddon {
    Search,
    Back,
    FolderPlus,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaletteSubmitView {
    pub label: String,
    pub shortcut_label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaletteGroupView {
    pub value: String,
    pub label: String,
    pub rows: Vec<PaletteRowView>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PaletteRowKind {
    Action,
    Submenu,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaletteRowView {
    pub value: String,
    pub kind: PaletteRowKind,
    pub title: String,
    pub title_emphasis: Option<String>,
    pub description: Option<String>,
    pub subtitle: Option<PaletteSubtitleView>,
    pub icon: PaletteIconView,
    pub disabled: bool,
    pub accessory: Option<PaletteAccessoryView>,
    pub shortcut_label: Option<String>,
    pub timestamp: Option<String>,
    pub content_match: Option<PaletteContentMatchView>,
    pub status: Option<PaletteThreadStatusView>,
    pub remote_machine: Option<EnvironmentMachineKind>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PaletteIconView {
    Glyph { glyph: String },
    Project { icon: ProjectIconView },
    Machine { machine: EnvironmentMachineKind },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaletteHarnessView {
    pub driver_kind: String,
    pub initials: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PaletteSubtitleView {
    Thread {
        project: Option<ProjectIconView>,
        project_label: Option<String>,
        environment_label: Option<String>,
        branch_label: Option<String>,
        is_worktree: bool,
        harness: Option<PaletteHarnessView>,
        is_current: bool,
    },
    Location {
        remote_machine: Option<EnvironmentMachineKind>,
        label: String,
        workspace_root: String,
    },
    Labels {
        text: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemePreviewView {
    pub mode: String,
    pub color: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PaletteAccessoryView {
    Current,
    ThemePreviews {
        current: bool,
        previews: Vec<ThemePreviewView>,
    },
    SetupRequired {
        hint: String,
    },
    Selected,
    Chevron,
    Checkbox {
        checked: bool,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum MatchSource {
    User,
    Assistant,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaletteMatchPartView {
    pub text: String,
    pub highlighted: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaletteContentMatchView {
    pub source: MatchSource,
    pub parts: Vec<PaletteMatchPartView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaletteThreadStatusView {
    pub label: String,
    pub tone: String,
    pub pulse: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ShortcutScope {
    Global,
    Palette,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaletteShortcutBinding {
    pub command: String,
    pub keystroke: String,
    pub scope: ShortcutScope,
    pub outside_terminal: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommandPaletteBindingView {
    pub bindings: Vec<PaletteShortcutBinding>,
}
