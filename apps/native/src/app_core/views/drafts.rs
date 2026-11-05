use serde::Deserialize;

use super::sidebar::{EnvironmentMachineKind, ProjectIconView};

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentBadgeView {
    pub kind: EnvironmentMachineKind,
    pub description: String,
}

impl EnvironmentMachineKind {
    pub fn icon_path(self) -> &'static str {
        match self {
            EnvironmentMachineKind::Server => "icons/server.svg",
            EnvironmentMachineKind::Cloud => "icons/cloud.svg",
            EnvironmentMachineKind::Linux => "icons/terminal.svg",
            EnvironmentMachineKind::Desktop => "icons/monitor.svg",
            EnvironmentMachineKind::Laptop => "icons/laptop.svg",
            EnvironmentMachineKind::MacMini => "icons/square.svg",
            EnvironmentMachineKind::MacStudio => "icons/box.svg",
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DraftHeroEntryView {
    pub value: String,
    pub label: String,
    pub icon: Option<ProjectIconView>,
    pub selected: bool,
    pub environment: Option<EnvironmentBadgeView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DraftHeroPickerView {
    pub entries: Vec<DraftHeroEntryView>,
    pub show_separator: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DraftHeroTriggerView {
    pub label: String,
    pub tooltip: Option<String>,
    pub picker: Option<DraftHeroPickerView>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DraftHeroSentence {
    Scratch,
    BuildIn,
    Choose,
    Add,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DraftHeroSublineContent {
    Picker,
    StartWithout,
    Empty,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DraftHeroSublineView {
    pub content: DraftHeroSublineContent,
    pub shortcut: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DraftHeroView {
    pub heading_label: String,
    pub sentence: DraftHeroSentence,
    pub project_trigger: DraftHeroTriggerView,
    pub subline: Option<DraftHeroSublineView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoProjectsHeroView {
    pub title: String,
    pub description: String,
    pub add_project_label: String,
    pub start_without_project_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum HomeView {
    None,
    NoProjects(NoProjectsHeroView),
    StartError {
        title: String,
        description: String,
        retry_label: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScopeItemView {
    pub value: String,
    pub label: String,
    pub icon: Option<ProjectIconView>,
    pub selected: bool,
    pub environment: Option<EnvironmentBadgeView>,
    pub settings_title: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScopeView {
    pub open: bool,
    pub query: String,
    pub placeholder: String,
    pub empty_label: String,
    pub items: Vec<ProjectScopeItemView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FolderPickerRequestView {
    pub id: u64,
    pub prompt: String,
}
