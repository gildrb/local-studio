use serde::Deserialize;

use crate::app_core::views::sidebar::ProjectIconView;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedThreadsEmptyStateView {
    pub section_id: Option<String>,
    pub section_title: String,
    pub icon: String,
    pub title: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedThreadPrimaryActionView {
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedThreadRowView {
    pub id: String,
    pub environment_id: String,
    pub title: String,
    pub description: String,
    pub primary_action: ArchivedThreadPrimaryActionView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedThreadGroupView {
    pub id: String,
    pub section_id: Option<String>,
    pub title: String,
    pub icon: ProjectIconView,
    pub threads: Vec<ArchivedThreadRowView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsArchivedView {
    pub empty_state: Option<ArchivedThreadsEmptyStateView>,
    pub groups: Vec<ArchivedThreadGroupView>,
}
