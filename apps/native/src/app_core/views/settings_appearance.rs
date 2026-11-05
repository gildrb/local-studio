use serde::Deserialize;

use super::composer_input::ComposerTokenView;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PromptPreviewView {
    pub prompt: String,
    pub tokens: Vec<ComposerTokenView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceOptionView {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSliderRowView {
    pub id: String,
    pub title: String,
    pub description: String,
    pub setting: String,
    pub input_id: String,
    pub aria_label: String,
    pub value: f64,
    pub value_label: String,
    pub min: f64,
    pub max: f64,
    pub step: f64,
    pub progress_ratio: f64,
    pub changed: bool,
    pub reset_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSelectRowView {
    pub id: String,
    pub title: String,
    pub description: String,
    pub setting: String,
    pub aria_label: String,
    pub value: String,
    pub value_label: String,
    pub options: Vec<AppearanceOptionView>,
    pub changed: bool,
    pub reset_label: String,
    #[serde(default)]
    pub swatches_reversed: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSwitchRowView {
    pub id: String,
    pub title: String,
    pub description: String,
    pub setting: String,
    pub aria_label: String,
    pub checked: bool,
    pub changed: bool,
    pub reset_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceFontSizeView {
    pub aria_label: String,
    pub selected_value: String,
    pub value_label: String,
    pub options: Vec<AppearanceOptionView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum AppearanceFontPreviewView {
    Prompt,
    Code,
    Terminal { family: String, size: f32 },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FontFamilyPickerItemView {
    pub value: String,
    pub family: String,
    pub is_default: bool,
    pub selected: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FontFamilyPickerView {
    pub trigger_label: String,
    pub open: bool,
    pub query: String,
    pub search_placeholder: String,
    pub empty_label: String,
    pub default_badge_label: String,
    pub items: Vec<FontFamilyPickerItemView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceFontRowView {
    pub id: String,
    pub title: String,
    pub description: String,
    pub font: String,
    pub value: String,
    pub trimmed_value: String,
    pub default_family: String,
    pub require_monospace: bool,
    pub family_aria_label: String,
    pub size: AppearanceFontSizeView,
    pub changed: bool,
    pub reset_label: String,
    pub previews: Vec<AppearanceFontPreviewView>,
    pub picker: FontFamilyPickerView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceThemeSectionView {
    pub section_id: String,
    pub section_title: String,
    pub anchor_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceInterfaceView {
    pub section_id: String,
    pub title: String,
    pub contrast: AppearanceSliderRowView,
    pub glass_opacity: AppearanceSliderRowView,
    pub environment_identification: Option<AppearanceSelectRowView>,
    pub diff_colors: AppearanceSelectRowView,
    pub chat_width: AppearanceSelectRowView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceMotionView {
    pub section_id: String,
    pub title: String,
    pub panel_animations: AppearanceSliderRowView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceTypographyView {
    pub section_id: String,
    pub title: String,
    pub advanced: bool,
    pub advanced_label: String,
    pub advanced_aria_label: String,
    pub font_rows: Vec<AppearanceFontRowView>,
    pub font_smoothing: Option<AppearanceSwitchRowView>,
    pub word_wrap: AppearanceSwitchRowView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettingsView {
    pub themes: AppearanceThemeSectionView,
    pub interface: AppearanceInterfaceView,
    pub motion: AppearanceMotionView,
    pub typography: AppearanceTypographyView,
    pub terminal_preview_key: String,
    pub prompt_preview: PromptPreviewView,
    pub code_preview: Vec<super::right_panel_diff::DiffRow>,
}
