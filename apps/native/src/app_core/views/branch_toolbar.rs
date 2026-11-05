use serde::Deserialize;

use super::sidebar::EnvironmentMachineKind;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum BranchToolbarIcon {
    Folder,
    FolderGit,
    #[serde(rename = "folder-git-2")]
    FolderGit2,
    History,
    Scale,
    #[serde(untagged)]
    Machine(EnvironmentMachineKind),
}

impl BranchToolbarIcon {
    pub fn path(self) -> &'static str {
        match self {
            BranchToolbarIcon::Folder => "icons/folder.svg",
            BranchToolbarIcon::FolderGit => "icons/folder-git.svg",
            BranchToolbarIcon::FolderGit2 => "icons/folder-git-2.svg",
            BranchToolbarIcon::History => "icons/history.svg",
            BranchToolbarIcon::Scale => "icons/scale.svg",
            BranchToolbarIcon::Machine(kind) => kind.icon_path(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BranchToolbarSelectItem {
    pub value: String,
    pub label: String,
    pub icon: BranchToolbarIcon,
    pub detail: Option<String>,
    pub detail_truncation: Option<MiddleTruncateSplit>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BranchToolbarSelect {
    pub interactive: bool,
    pub icon: BranchToolbarIcon,
    pub label: String,
    pub tooltip: String,
    pub value: String,
    pub group_label: String,
    pub wide: bool,
    pub items: Vec<BranchToolbarSelectItem>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum BranchMenuItemKind {
    CheckoutPullRequest,
    Create,
    Ref,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MiddleTruncateSplit {
    pub head: String,
    pub tail: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BranchMenuItem {
    pub value: String,
    pub kind: BranchMenuItemKind,
    pub label: String,
    pub detail: Option<String>,
    pub truncation: Option<MiddleTruncateSplit>,
    pub badge: Option<String>,
    pub icon: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StartFromOriginView {
    pub checked: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BranchMenuView {
    pub query: String,
    pub items: Vec<BranchMenuItem>,
    pub highlighted: Option<String>,
    pub empty_text: Option<String>,
    pub status_text: Option<String>,
    pub start_from_origin: Option<StartFromOriginView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BranchSelectorView {
    pub label: String,
    pub disabled: bool,
    pub truncation: Option<MiddleTruncateSplit>,
    pub active_branch: Option<String>,
    pub menu: Option<BranchMenuView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BranchToolbarView {
    pub thread_key: String,
    pub environment: Option<BranchToolbarSelect>,
    pub separator: bool,
    pub workspace: Option<BranchToolbarSelect>,
    pub branch: Option<BranchSelectorView>,
}
