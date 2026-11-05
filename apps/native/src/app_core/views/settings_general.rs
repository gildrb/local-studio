use std::collections::HashMap;

use serde::Deserialize;

use super::composer::TraitsMenuView;
use super::model_picker::ModelPickerView;
use super::settings::SettingsRowScopeView;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum GeneralLayoutItemView {
    Embedded { panel: String },
    Section { key: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum GeneralSectionItemView {
    Row { key: String },
    Embedded { panel: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSectionView {
    pub key: String,
    pub anchor_id: Option<String>,
    pub title: String,
    pub collapsible: bool,
    pub items: Vec<GeneralSectionItemView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GeneralOptionView {
    pub value: String,
    pub label: String,
    pub description: Option<String>,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GeneralIconButtonView {
    pub icon: String,
    pub aria_label: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSelectControlView {
    pub aria_label: String,
    pub value: Option<String>,
    pub value_label: String,
    pub options: Vec<GeneralOptionView>,
    pub show_selected_indicator: bool,
    pub disabled: bool,
    pub accessory: Option<GeneralIconButtonView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GeneralModelPickerControlView {
    pub unavailable_message: Option<String>,
    pub active_instance_id: String,
    pub model: String,
    pub driver_kind: String,
    pub trigger_label: Option<String>,
    pub show_traits_picker: bool,
    pub can_open_provider_setup: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum GeneralControlView {
    Switch {
        aria_label: String,
        checked: bool,
        mixed: bool,
        disabled: bool,
        disabled_reason: Option<String>,
    },
    Select(Box<GeneralSelectControlView>),
    NumberInput {
        aria_label: String,
        value: f64,
        min: f64,
        max: f64,
    },
    TextInput {
        aria_label: String,
        value: String,
        placeholder: String,
    },
    Link {
        label: String,
        route: String,
        machine: Option<String>,
    },
    ModelPicker(Box<GeneralModelPickerControlView>),
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GeneralRowView {
    pub key: String,
    pub anchor_id: Option<String>,
    pub title: String,
    pub title_tooltip: Option<String>,
    pub description: String,
    pub status: Option<String>,
    pub server_scoped: bool,
    pub setting_keys: Vec<String>,
    pub reset_label: Option<String>,
    pub control: GeneralControlView,
    pub row_scope: Option<SettingsRowScopeView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TokenStreamingWarningView {
    pub title: String,
    pub description: String,
    pub confirm_label: String,
    pub cancel_label: String,
    pub use_paragraphs_label: String,
    pub open: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundSharedPolicyView {
    pub title: String,
    pub description: String,
    pub aria_label: String,
    pub value: String,
    pub value_label: String,
    pub options: Vec<GeneralOptionView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundIntervalView {
    pub key: String,
    pub title: String,
    pub description: String,
    pub value_seconds: f64,
    pub min: f64,
    pub step: f64,
    pub unit_label: String,
    pub decrement_aria_label: String,
    pub input_aria_label: String,
    pub increment_aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundPauseToggleView {
    pub key: String,
    pub label: String,
    pub checked: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundActivityAdvancedView {
    pub title: String,
    pub description: String,
    pub shared_policy: BackgroundSharedPolicyView,
    pub intervals: Vec<BackgroundIntervalView>,
    pub pause_toggles: Vec<BackgroundPauseToggleView>,
    pub reset_label: String,
    pub done_label: String,
    pub open: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotificationOptionView {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSettingsView {
    pub anchor_id: String,
    pub title: String,
    pub description: String,
    pub aria_label: String,
    pub value: String,
    pub value_label: String,
    pub options: Vec<NotificationOptionView>,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AboutButtonView {
    pub label: String,
    pub disabled: bool,
    pub tooltip: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AboutVersionRowView {
    pub title: String,
    pub version: String,
    pub description: String,
    pub button: Option<AboutButtonView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AboutUpdateTrackView {
    pub source: String,
    pub title: String,
    pub description: String,
    pub aria_label: String,
    pub value: String,
    pub value_label: String,
    pub options: Vec<GeneralOptionView>,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AboutVersionView {
    pub version: AboutVersionRowView,
    pub update_track: Option<AboutUpdateTrackView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDefaultsResetView {
    pub label: String,
    pub tooltip: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDefaultsOptionView {
    pub value: String,
    pub label: String,
    pub description: Option<String>,
    pub icon: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ProjectDefaultsRowKindView {
    Model {
        status: Option<String>,
        available: bool,
        trigger_label: Option<String>,
        show_traits: bool,
        empty_label: String,
    },
    Select {
        aria_label: String,
        value: Option<String>,
        value_label: String,
        fallback_label: String,
        trigger_icon: Option<String>,
        options: Vec<ProjectDefaultsOptionView>,
    },
    Switch {
        aria_label: String,
        checked: bool,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDefaultsRowView {
    pub key: String,
    pub id: String,
    pub title: String,
    pub description: String,
    pub setting_keys: Vec<String>,
    pub mixed: bool,
    pub reset: Option<ProjectDefaultsResetView>,
    pub row_scope: SettingsRowScopeView,
    #[serde(flatten)]
    pub kind: ProjectDefaultsRowKindView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDefaultsView {
    pub section_id: String,
    pub section_title: String,
    pub rows: Vec<ProjectDefaultsRowView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsModelPickerTriggerView {
    pub label: String,
    pub tooltip: String,
    pub driver_kind: Option<String>,
    pub initials: String,
    pub accent_color: Option<String>,
    pub show_instance_badge: bool,
    pub unavailable: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsTraitsView {
    pub label: String,
    pub speed_icon: Option<String>,
    pub menu: TraitsMenuView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsModelPickerControlView {
    pub trigger: SettingsModelPickerTriggerView,
    pub traits: Option<SettingsTraitsView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsModelPickerPopupView {
    pub picker: String,
    #[serde(flatten)]
    pub view: ModelPickerView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettingsView {
    pub layout: Vec<GeneralLayoutItemView>,
    pub sections: HashMap<String, GeneralSectionView>,
    pub rows: HashMap<String, Option<GeneralRowView>>,
    pub token_streaming_warning: TokenStreamingWarningView,
    pub background_activity_advanced: BackgroundActivityAdvancedView,
    pub notifications: NotificationSettingsView,
    pub about: AboutVersionView,
    pub project_defaults: ProjectDefaultsView,
    pub text_generation_picker: Option<SettingsModelPickerControlView>,
    pub default_model_picker: Option<SettingsModelPickerControlView>,
    pub model_picker: Option<SettingsModelPickerPopupView>,
    pub legacy_open: bool,
}
