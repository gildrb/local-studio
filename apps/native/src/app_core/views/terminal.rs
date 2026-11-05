use serde::Deserialize;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TerminalSplitDirection {
    #[default]
    Horizontal,
    Vertical,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalActionView {
    pub id: String,
    pub label: String,
    pub icon: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalViewportView {
    pub terminal_id: String,
    pub label: String,
    pub active: bool,
    pub auto_focus: bool,
    pub session_key: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalTabView {
    pub terminal_id: String,
    pub label: String,
    pub active: bool,
    pub close_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalGroupView {
    pub id: String,
    pub label: String,
    pub icon: String,
    pub active: bool,
    pub terminal_count: u32,
    pub activate_terminal_id: String,
    pub tabs: Vec<TerminalTabView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum TerminalChromeModel {
    Empty {
        message: String,
        new_action: TerminalActionView,
    },
    Ready {
        active_terminal_id: String,
        split_direction: TerminalSplitDirection,
        is_split_view: bool,
        show_sidebar: bool,
        show_group_headers: bool,
        actions: Vec<TerminalActionView>,
        viewports: Vec<TerminalViewportView>,
        groups: Vec<TerminalGroupView>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalChromeView {
    pub id: String,
    pub visible: bool,
    pub height: f32,
    pub min_height: f32,
    pub max_height: f32,
    pub font_size: f32,
    pub font_family: Option<String>,
    pub focus_revision: u64,
    pub model: TerminalChromeModel,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
pub struct TerminalCellView {
    pub x: usize,
    pub y: usize,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
pub struct TerminalCellRangeView {
    pub start: TerminalCellView,
    pub end: TerminalCellView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct TerminalLinkView {
    pub text: String,
    pub range: TerminalCellRangeView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct TerminalLinkHoverView {
    pub key: String,
    pub probe: u64,
    pub link: Option<TerminalLinkView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalFontView {
    pub font_size: f32,
    pub font_family: Option<String>,
}
