use serde::Deserialize;
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeOrbView {
    pub mode: String,
    pub svg: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemePreviewView {
    pub mode: String,
    pub picked: bool,
    pub aria_label: String,
    pub tooltip: String,
    pub badge_icon: String,
    pub pick: Value,
    pub orb: ThemeOrbView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeVariantOptionView {
    pub label: String,
    pub active: bool,
    pub aria_label: String,
    pub tooltip: String,
    pub select: Value,
    pub orb: ThemeOrbView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeVariantGroupView {
    pub mode: String,
    pub active: bool,
    pub aria_label: String,
    pub tooltip: String,
    pub badge_icon: String,
    pub extra_count_label: Option<String>,
    pub selected: ThemeVariantOptionView,
    pub options: Vec<ThemeVariantOptionView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeVariantNavigationView {
    pub aria_label: String,
    pub groups: Vec<ThemeVariantGroupView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeCardActionView {
    pub aria_label: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeCardExportView {
    pub aria_label: String,
    pub tooltip: String,
    pub theme_id: String,
    pub filename: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeCardRemoveView {
    pub aria_label: String,
    pub tooltip: String,
    pub theme_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeCardView {
    pub key: String,
    pub collection_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub title_aria_label: String,
    pub tooltip: String,
    #[serde(rename = "use")]
    pub use_intent: Value,
    pub previews: Vec<ThemePreviewView>,
    pub variant_navigation: Option<ThemeVariantNavigationView>,
    pub duplicate: Option<ThemeCardActionView>,
    pub edit: Option<ThemeCardActionView>,
    pub export: Option<ThemeCardExportView>,
    pub remove: Option<ThemeCardRemoveView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemePaneColorsView {
    pub sidebar: String,
    pub canvas: String,
    pub surface: String,
    pub accent_surface: String,
    pub accent: String,
    pub message_surface: String,
    pub message_action: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeWireframePaneView {
    pub clip: Option<String>,
    pub colors: ThemePaneColorsView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeModeTileView {
    pub mode: String,
    pub label: String,
    pub aria_label: String,
    pub active: bool,
    pub panes: Vec<ThemeWireframePaneView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeRemovalOptionView {
    pub theme_id: String,
    pub label: String,
    pub checked: bool,
    pub orbs: Vec<ThemeOrbView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeRemovalView {
    pub title: String,
    pub description: String,
    pub can_remove_collection: bool,
    pub options: Vec<ThemeRemovalOptionView>,
    pub cancel_label: String,
    pub confirm_label: String,
    pub confirm_disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsThemesView {
    pub color_scheme_title: String,
    pub theme_title: String,
    pub mode_group_aria_label: String,
    pub mode_tiles: Vec<ThemeModeTileView>,
    pub create_theme_label: String,
    pub add_theme_label: String,
    pub cards: Vec<ThemeCardView>,
    pub removal: Option<ThemeRemovalView>,
}
