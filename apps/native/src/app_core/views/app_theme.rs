use std::collections::HashMap;

use serde::Deserialize;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AppThemeAppearance {
    Light,
    Dark,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppThemePaletteView {
    pub theme_id: String,
    pub colors: HashMap<String, String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppThemeView {
    pub appearance: AppThemeAppearance,
    pub palette: Option<AppThemePaletteView>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AppChatWidth {
    Comfortable,
    Wide,
    Full,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AppDiffColorScheme {
    RedGreen,
    BlueOrange,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppAppearanceView {
    pub zoom: f32,
    pub font_smoothing: bool,
    pub sans_families: Vec<String>,
    pub mono_families: Vec<String>,
    pub composer_families: Vec<String>,
    pub prompt_font_size: f32,
    pub code_font_size: f32,
    pub contrast: f32,
    pub glass_opacity: f32,
    pub chat_width: AppChatWidth,
    pub diff_color_scheme: AppDiffColorScheme,
}
