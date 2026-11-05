use serde::Deserialize;

use crate::app_core::views::pierre_icon::PierreIconView;
use crate::app_core::views::settings::{SettingsRowScopeView, SettingsScopeNoticeChoiceView};
use crate::app_core::views::settings_general::{
    ProjectDefaultsRowView, SettingsModelPickerControlView, SettingsModelPickerPopupView,
};
use crate::app_core::views::sidebar::{ProjectIconColor, ProjectIconView};

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsProjectDefaultsView {
    pub section_id: String,
    pub section_title: String,
    pub rows: Vec<ProjectDefaultsRowView>,
    pub model_picker: Option<SettingsModelPickerControlView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SettingsProjectsView {
    ChooseProject {
        message: String,
        choices: Vec<SettingsScopeNoticeChoiceView>,
    },
    Unavailable {
        message: String,
    },
    Empty {
        centered: bool,
        message: String,
    },
    Detail(Box<ProjectDetailView>),
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetailView {
    pub detail_key: String,
    pub notice: String,
    pub overview_section_id: String,
    pub overview_title: String,
    pub name: ProjectNameView,
    pub icon: ProjectIconRowView,
    pub icon_preview: ProjectIconView,
    pub checkouts: Option<ProjectCheckoutsView>,
    pub danger: ProjectDangerView,
    pub defaults: SettingsProjectDefaultsView,
    pub actions: ProjectActionsView,
    pub model_picker: Option<SettingsModelPickerPopupView>,
    pub icon_picker: Option<ProjectIconPickerView>,
    pub favicon_picker: Option<ProjectFaviconPickerView>,
    pub external_request: Option<ProjectExternalRequestView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNameView {
    pub title: String,
    pub description: String,
    pub value: String,
    pub input_key: String,
    pub aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectButtonView {
    pub label: String,
    pub aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIconRowView {
    pub title: String,
    pub description: String,
    pub resettable: bool,
    pub reset_label: String,
    pub disabled: bool,
    pub choose_icon: ProjectButtonView,
    pub choose_file: ProjectButtonView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCheckoutsView {
    pub title: String,
    pub rows: Vec<ProjectCheckoutRowView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCheckoutRowView {
    pub id: String,
    pub title: String,
    pub description: String,
    pub remove_label: String,
    pub remove_aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDangerView {
    pub section_title: String,
    pub title: String,
    pub description: String,
    pub action_label: String,
    pub action_icon: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectExternalRequestView {
    pub id: u64,
    pub prompt: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActionsView {
    pub section_id: String,
    pub title: String,
    pub header: ProjectActionsHeaderView,
    pub header_row_scope: SettingsRowScopeView,
    pub import_menu: Option<ProjectActionsImportMenuView>,
    pub add_action: ProjectActionsAddView,
    pub mixed_notice: Option<ProjectNoticeView>,
    pub rows: Vec<ProjectActionRowView>,
    pub empty_label: Option<String>,
    pub invalid_file_notice: Option<ProjectNoticeView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActionsHeaderView {
    pub title: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActionsImportMenuView {
    pub button_id: String,
    pub label: String,
    pub disabled: bool,
    pub group_label: String,
    pub description: String,
    pub items: Vec<ProjectActionImportItemView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActionImportItemView {
    pub key: String,
    pub name: String,
    pub command: String,
    pub icon: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActionsAddView {
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectNoticeView {
    pub title: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActionRowView {
    pub id: String,
    pub name: String,
    pub command: String,
    pub icon: String,
    pub shortcut_label: Option<String>,
    pub badges: Vec<ProjectActionBadgeView>,
    pub edit_aria_label: String,
    pub edit_disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActionBadgeView {
    pub id: String,
    pub label: String,
    pub hide_on_small_screens: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIconPickerView {
    pub title: String,
    pub description: String,
    pub mode: String,
    pub mode_aria_label: String,
    pub mode_options: Vec<ProjectIconPickerOptionView>,
    pub colors: Option<ProjectIconPickerColorsView>,
    pub icons: Option<ProjectIconPickerIconsView>,
    pub monogram: Option<ProjectIconPickerMonogramView>,
    pub emojis: Option<ProjectIconPickerEmojisView>,
    pub cancel_label: String,
    pub save_label: String,
    pub save_disabled: bool,
    pub custom_emoji: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIconPickerOptionView {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIconPickerColorsView {
    pub label: String,
    pub aria_label: String,
    pub options: Vec<ProjectIconPickerColorView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIconPickerColorView {
    pub value: ProjectIconColor,
    pub label: String,
    pub selected: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIconPickerIconsView {
    pub search_aria_label: String,
    pub search_placeholder: String,
    pub icons: Vec<ProjectIconPickerIconView>,
    pub empty_label: Option<String>,
    pub query: String,
    pub color: ProjectIconColor,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIconPickerIconView {
    pub name: String,
    pub label: String,
    pub selected: bool,
    pub asset: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIconPickerMonogramView {
    pub label: String,
    pub hint: String,
    pub preview_text: String,
    pub color: ProjectIconColor,
    pub valid: bool,
    pub letters: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIconPickerEmojisView {
    pub options: Vec<ProjectIconPickerEmojiView>,
    pub custom_label: String,
    pub custom_aria_label: String,
    pub custom_placeholder: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIconPickerEmojiView {
    pub emoji: String,
    pub label: String,
    pub selected: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFaviconPickerView {
    pub title: String,
    pub escape_label: String,
    pub footer_action_label: String,
    pub placeholder: String,
    pub group_label: String,
    pub files: Vec<ProjectFaviconFileView>,
    pub empty_state_message: String,
    pub external_action: Option<ProjectFaviconExternalView>,
    pub query: String,
    pub highlighted: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFaviconFileView {
    pub value: String,
    pub path: String,
    pub title: String,
    pub description: String,
    pub icon: PierreIconView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFaviconExternalView {
    pub label: String,
    pub disabled: bool,
}
