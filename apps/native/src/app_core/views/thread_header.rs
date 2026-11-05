use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ThreadTitleModel {
    Renaming {
        draft: String,
        aria_label: String,
    },
    Menu {
        text: String,
        aria_label: String,
        tooltip: String,
    },
    Static {
        text: String,
        aria_label: String,
        tooltip: String,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum HeaderContextMenuAction {
    Ignore,
    ProjectSettingsMenu,
    ThreadMenu,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThreadTitleView {
    pub thread_key: String,
    pub title: ThreadTitleModel,
    pub rename_revision: u64,
    pub context_menu: HeaderContextMenuAction,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
pub struct MenuPosition {
    pub x: f32,
    pub y: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuItemView {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub destructive: bool,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub header: bool,
    #[serde(default)]
    pub separator_before: bool,
    #[serde(default)]
    pub checked: Option<bool>,
    #[serde(default)]
    pub children: Option<Vec<ContextMenuItemView>>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ContextMenuRequestView {
    pub id: u64,
    pub position: MenuPosition,
    pub items: Vec<ContextMenuItemView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ClipboardWriteView {
    pub id: u64,
    pub text: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CustomSnoozeMode {
    Date,
    Duration,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CustomSnoozeUnitOption {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CustomSnoozeCalendarDay {
    pub date: String,
    pub day: u32,
    pub outside: bool,
    pub disabled: bool,
    pub selected: bool,
    pub today: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct CustomSnoozeCalendar {
    pub caption: String,
    pub weekdays: Vec<String>,
    pub weeks: Vec<Vec<CustomSnoozeCalendarDay>>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CustomSnoozeView {
    pub request_key: u64,
    pub mode: CustomSnoozeMode,
    pub date_label: String,
    pub time: String,
    pub amount: String,
    pub unit: String,
    pub unit_label: String,
    pub units: Vec<CustomSnoozeUnitOption>,
    pub error: Option<String>,
    pub calendar: CustomSnoozeCalendar,
}
