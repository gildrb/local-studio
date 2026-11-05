use serde::Deserialize;

use crate::app_core::views::usage::UsageProviderChartView;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LocalDotTone {
    Destructive,
    Success,
    Muted,
    Warning,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalDotView {
    pub tone: LocalDotTone,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalMetricView {
    pub label: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalMemoryView {
    pub percent: f32,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalEndpointRowView {
    pub id: String,
    pub port: u32,
    pub port_label: String,
    pub models: String,
    pub dot: LocalDotView,
    pub unload_label: String,
    pub unload_variant: String,
    pub unload_disabled: bool,
    pub sharing: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalJobRowView {
    pub id: String,
    pub recipe_id: String,
    pub detail: String,
    pub dot: LocalDotView,
    pub button_label: String,
    pub button_disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalOptionView {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalRecipeOptionView {
    pub id: String,
    pub model: String,
    pub detail: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalRecipeGroupView {
    pub label: String,
    pub recipes: Vec<LocalRecipeOptionView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalRecipePickerView {
    pub items: Vec<LocalOptionView>,
    pub value: Option<String>,
    pub groups: Vec<LocalRecipeGroupView>,
    pub load_label: String,
    pub load_variant: String,
    pub load_disabled: bool,
    pub note: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalMachineDetailsView {
    pub metrics: Vec<LocalMetricView>,
    pub endpoints: Vec<LocalEndpointRowView>,
    pub jobs: Vec<LocalJobRowView>,
    pub picker: Option<LocalRecipePickerView>,
    pub empty_recipes_message: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalMachineView {
    pub url: String,
    pub name: String,
    pub host: String,
    pub controller: String,
    pub open: bool,
    pub reachable: bool,
    pub dot: LocalDotView,
    pub can_rename: bool,
    pub rename_label: String,
    pub editing: Option<String>,
    pub reveal_address: bool,
    pub address_toggle_label: String,
    pub subtitle: String,
    pub memory: Option<LocalMemoryView>,
    pub details: Option<Box<LocalMachineDetailsView>>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalTailnetRowView {
    pub ip: String,
    pub title: String,
    pub description: String,
    pub button_label: String,
    pub button_disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalMachinesView {
    pub title: String,
    pub scan_label: String,
    pub scan_disabled: bool,
    pub rows: Vec<LocalMachineView>,
    pub tailnet: Vec<LocalTailnetRowView>,
    pub loading_message: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalUsageRowView {
    pub model: String,
    pub requests: String,
    pub share: String,
    pub tokens: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalUsageView {
    pub metrics: Vec<LocalMetricView>,
    pub chart_title: String,
    pub chart: UsageProviderChartView,
    pub columns: Vec<String>,
    pub rows: Vec<LocalUsageRowView>,
    pub footnote: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalLinkView {
    pub label: String,
    pub href: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalAboutView {
    pub title: String,
    pub paragraphs: Vec<String>,
    pub link: LocalLinkView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalPageModelView {
    pub error: Option<String>,
    pub machines: LocalMachinesView,
    pub usage: Box<LocalUsageView>,
    pub about: LocalAboutView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryVariantRowView {
    pub id: String,
    pub summary: String,
    pub fits: bool,
    pub inspect_label: String,
    pub inspecting: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryModelRowView {
    pub repo: String,
    pub expanded: bool,
    pub summary: String,
    pub variant_count: String,
    pub variants: Vec<RegistryVariantRowView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryShowMoreView {
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RegistrySectionView {
    pub title: String,
    pub show_machine_picker: bool,
    pub machines: Vec<LocalOptionView>,
    pub controller: String,
    pub all_hardware: bool,
    pub all_hardware_label: String,
    pub filter_placeholder: String,
    pub filter_label: String,
    pub status: String,
    pub empty_message: Option<String>,
    pub models: Vec<RegistryModelRowView>,
    pub show_more: Option<RegistryShowMoreView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryJsonView {
    pub label: String,
    pub json: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum RegistryInspectView {
    Error {
        message: String,
    },
    Loading {
        message: String,
    },
    Ready {
        command: Option<String>,
        copy_label: String,
        copy_disabled: bool,
        download_label: String,
        download_disabled: bool,
        weights: Option<LocalLinkView>,
        sections: Vec<RegistryJsonView>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SharePreviewView {
    pub title: String,
    pub issues: Vec<String>,
    pub scrubbed: String,
    pub files: Vec<RegistryJsonView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SharePanelView {
    pub preparing_message: Option<String>,
    pub error: Option<String>,
    pub preview: Option<SharePreviewView>,
    pub pull_request: Option<LocalLinkView>,
    pub confirm_message: Option<String>,
    pub primary_label: String,
    pub primary_disabled: bool,
    pub decline_label: String,
    pub decline_disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalShareView {
    pub url: String,
    pub panel: SharePanelView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalPageView {
    pub page: LocalPageModelView,
    pub registry: RegistrySectionView,
    pub inspect: Option<RegistryInspectView>,
    pub shares: Vec<LocalShareView>,
}
