use std::collections::HashMap;

use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEditorInspectView {
    pub active: bool,
    pub label: String,
    pub aria_label: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEditorMinimizeView {
    pub minimized: bool,
    pub aria_label: String,
    pub icon: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEditorNameFieldView {
    pub label: String,
    pub placeholder: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEditorAppearanceOptionView {
    pub value: String,
    pub label: String,
    pub locked: bool,
    pub lock_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEditorAppearanceView {
    pub label: String,
    pub aria_label: String,
    pub value: String,
    pub options: Vec<ThemeEditorAppearanceOptionView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeColorFieldView {
    pub id: String,
    pub role: String,
    pub label: String,
    pub value: String,
    pub selected: bool,
    pub valid: bool,
    pub swatch_value: String,
    pub editor_value: String,
    pub toggle_aria_label: String,
    pub toggle_tooltip: String,
    pub hex_aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEditorFieldGroupView {
    pub id: String,
    pub title: String,
    pub fields: Vec<ThemeColorFieldView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEditorFilterView {
    pub aria_label: String,
    pub placeholder: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEditorColorsView {
    pub title: String,
    pub subtitle: Option<String>,
    pub advanced: bool,
    pub advanced_label: String,
    pub advanced_aria_label: String,
    pub filter: Option<ThemeEditorFilterView>,
    pub groups: Vec<ThemeEditorFieldGroupView>,
    pub guided_fields: Vec<ThemeColorFieldView>,
    pub empty_message: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEditorFooterView {
    pub cancel_label: String,
    pub submit_label: String,
    pub submit_icon: Option<String>,
    pub submit_disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEditorModelView {
    pub title: String,
    pub is_editing: bool,
    pub status_text: Option<String>,
    pub inspect: ThemeEditorInspectView,
    pub minimize: ThemeEditorMinimizeView,
    pub name_field: ThemeEditorNameFieldView,
    pub error: Option<String>,
    pub appearance: ThemeEditorAppearanceView,
    pub colors: ThemeEditorColorsView,
    pub highlight_roles: Vec<String>,
    pub footer: ThemeEditorFooterView,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
pub struct HsvView {
    pub h: f64,
    pub s: f64,
    pub v: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEditorPickerView {
    pub role: String,
    pub label: String,
    pub subtitle: String,
    pub hue_label: String,
    pub hex_label: String,
    pub rgb_label: String,
    pub hsv: HsvView,
    pub hue_color: String,
    pub current_color: String,
    pub hex_draft: String,
    pub rgb_draft: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEditorRevealView {
    pub role: String,
    pub revision: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeEditorView {
    pub session_id: u64,
    pub model: ThemeEditorModelView,
    pub role_labels: HashMap<String, String>,
    pub reveal: Option<ThemeEditorRevealView>,
    pub picker: Option<ThemeEditorPickerView>,
    pub field_tooltips: HashMap<String, String>,
}
