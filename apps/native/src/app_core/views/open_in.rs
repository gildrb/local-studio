use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenInOption {
    pub label: String,
    pub icon: String,
    pub kind: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum OpenInMenuItem {
    Editor {
        id: String,
        label: String,
        icon: String,
        icon_kind: String,
        shortcut_label: Option<String>,
    },
    Notice {
        id: String,
        label: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenInPickerModel {
    pub primary: Option<OpenInOption>,
    pub primary_menu_label: Option<String>,
    pub primary_button_label: String,
    pub primary_button_disabled: bool,
    pub primary_menu_item_disabled: bool,
    pub compact_aria_label: String,
    pub favorite_shortcut_label: Option<String>,
    pub submenu_label: String,
    pub choose_editor_aria_label: String,
    pub menu_items: Vec<OpenInMenuItem>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenInUrlRequest {
    pub id: u64,
    pub url: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenInView {
    pub picker: Option<OpenInPickerModel>,
    pub url_request: Option<OpenInUrlRequest>,
}
