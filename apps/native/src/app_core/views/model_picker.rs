use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ModelPickerRailItem {
    Favorites {
        id: String,
        active: bool,
    },
    Instance {
        id: String,
        driver_kind: String,
        initials: String,
        accent_color: Option<String>,
        show_instance_badge: bool,
        active: bool,
        disabled: bool,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelPickerNewBadge {
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelPickerModelRow {
    pub key: String,
    pub instance_id: String,
    pub slug: String,
    pub driver_kind: String,
    pub label: String,
    pub provider_label: String,
    pub selected: bool,
    pub favorite: bool,
    pub new_badge: Option<ModelPickerNewBadge>,
    pub unavailable_label: Option<String>,
    pub disabled_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ModelPickerRow {
    Model(Box<ModelPickerModelRow>),
    LegacySection {
        key: String,
        instance_id: String,
        label: String,
        count_label: String,
        expanded: bool,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelPickerView {
    pub show_rail: bool,
    pub rail: Vec<ModelPickerRailItem>,
    pub search_placeholder: String,
    pub rows: Vec<ModelPickerRow>,
    pub empty_state_text: String,
    #[serde(default)]
    pub setup_items: Vec<ModelPickerSetupItem>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelPickerSetupItem {
    pub instance_id: String,
    pub message: String,
    pub action_label: String,
}
