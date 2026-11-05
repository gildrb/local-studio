use serde::Deserialize;

use crate::app_core::views::settings::{SettingsRowScopeView, SettingsScopeNoticeChoiceView};

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StorageRetentionControlView {
    pub label: String,
    pub value: Option<f64>,
    pub enabled: bool,
    pub off_label: String,
    pub unit_label: String,
    pub min: f64,
    pub max: f64,
    pub step: f64,
    pub decrement_label: String,
    pub increment_label: String,
    pub input_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "control",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum StorageRuleRowView {
    Switch {
        id: String,
        title: String,
        description: String,
        status: Option<String>,
        aria_label: String,
        checked: bool,
        row_scope: SettingsRowScopeView,
    },
    Retention {
        id: String,
        title: String,
        description: String,
        status: Option<String>,
        retention: StorageRetentionControlView,
        row_scope: SettingsRowScopeView,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StorageModeOptionView {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StorageModeRowView {
    pub id: String,
    pub title: String,
    pub description: String,
    pub aria_label: String,
    pub mixed: bool,
    pub value: Option<String>,
    pub value_label: String,
    pub options: Vec<StorageModeOptionView>,
    pub row_scope: SettingsRowScopeView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StorageSectionView {
    pub id: String,
    pub title: String,
    pub mode_row: Option<StorageModeRowView>,
    pub rows: Vec<StorageRuleRowView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SettingsStorageView {
    Notice {
        message: String,
        choices: Vec<SettingsScopeNoticeChoiceView>,
    },
    Settings {
        sections: Vec<StorageSectionView>,
    },
}
