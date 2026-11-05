use serde::Deserialize;

use crate::app_core::views::markdown::MarkdownDocView;
use crate::app_core::views::pierre_icon::PierreIconView;
use crate::app_core::views::right_panel_diff::SyntaxToken;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilesRefreshChrome {
    pub aria_label: String,
    pub tooltip: String,
    pub refreshing: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilesSearchChrome {
    pub aria_label: String,
    pub placeholder: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilesToggleAll {
    pub label: String,
    pub icon: String,
    pub next_expanded: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilesChrome {
    pub refresh: FilesRefreshChrome,
    pub search: FilesSearchChrome,
    pub toggle_all: Option<FilesToggleAll>,
    pub error_text: Option<String>,
    pub truncated_text: Option<String>,
    pub loading_text: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FilesEntryKind {
    File,
    Directory,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilesTreeRow {
    pub path: String,
    pub name: String,
    pub kind: FilesEntryKind,
    pub depth: usize,
    pub expanded: bool,
    pub selected: bool,
    pub ignored: bool,
    pub icon: Option<PierreIconView>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FilesExplorerLayout {
    Full,
    Aside,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilesScrollRequest {
    pub path: String,
    pub id: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilesExplorerView {
    pub layout: FilesExplorerLayout,
    pub query: String,
    pub chrome: FilesChrome,
    pub rows: Vec<FilesTreeRow>,
    pub scroll_request: Option<FilesScrollRequest>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FilesCrumbKind {
    Project,
    Directory,
    File,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilesCrumb {
    pub label: String,
    pub path: String,
    pub kind: FilesCrumbKind,
    pub tooltip: String,
    pub browsable: bool,
    pub open: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilesCrumbMenuItem {
    pub path: String,
    pub label: String,
    pub kind: FilesEntryKind,
    pub current: bool,
    pub ignored: bool,
    pub icon: Option<PierreIconView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum FilesCrumbMenuContent {
    Loading { label: String },
    Retry { label: String, refreshing: bool },
    Notice { label: String },
    Items { items: Vec<FilesCrumbMenuItem> },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilesCrumbBack {
    pub path: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilesCrumbRefreshFailed {
    pub label: String,
    pub refreshing: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilesCrumbMenu {
    pub crumb_path: String,
    pub back: Option<FilesCrumbBack>,
    pub content: FilesCrumbMenuContent,
    pub refresh_failed: Option<FilesCrumbRefreshFailed>,
    pub truncated_notice: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum FilesHeaderActionId {
    Rendered,
    WordWrap,
    Explorer,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilesHeaderAction {
    pub id: FilesHeaderActionId,
    pub label: String,
    pub pressed: bool,
    pub icon: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilesHeader {
    pub crumbs: Vec<FilesCrumb>,
    pub crumb_menu: Option<FilesCrumbMenu>,
    pub open_in_path: Option<String>,
    pub actions: Vec<FilesHeaderAction>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum FilesBody {
    None,
    Loading,
    Error {
        message: String,
    },
    Unsupported {
        message: String,
    },
    Image {
        src: Option<String>,
        failed: bool,
        alt: String,
    },
    Video {
        video: crate::app_core::views::media::MediaVideoView,
    },
    Markdown {
        document: MarkdownDocView,
    },
    Table {
        label: String,
        header: Option<Vec<String>>,
        rows: Vec<Vec<String>>,
        truncated_notice: Option<String>,
    },
    Text,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RightPanelFilesView {
    pub key: String,
    pub header: Option<FilesHeader>,
    pub notice: Option<String>,
    pub preview_visible: bool,
    pub body: FilesBody,
    pub explorer: Option<FilesExplorerView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilesReveal {
    pub line: u32,
    pub request_id: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RightPanelFilesSourceView {
    pub key: String,
    pub contents: String,
    pub editable: bool,
    pub word_wrap: bool,
    pub revision: u64,
    pub lines: Option<Vec<Vec<SyntaxToken>>>,
    pub reveal: Option<FilesReveal>,
}
