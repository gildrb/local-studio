use serde::Deserialize;

use crate::app_core::views::settings::SettingsRowScopeView;
use crate::app_core::views::settings_general::{
    SettingsModelPickerControlView, SettingsModelPickerPopupView,
};
use crate::app_core::views::settings_projects::SettingsProjectDefaultsView;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlSettingsView {
    pub defaults: SettingsProjectDefaultsView,
    pub scan_button: SourceControlScanButtonView,
    pub discovery: SourceControlDiscoveryView,
    pub git_fetch: GitFetchIntervalView,
    pub bitbucket: Option<BitbucketCredentialsView>,
    pub writing: SourceControlWritingView,
    pub writing_row_scope: SettingsRowScopeView,
    pub templates_row_scope: SettingsRowScopeView,
    pub writer_row_scope: SettingsRowScopeView,
    pub writer_picker: Option<SettingsModelPickerControlView>,
    pub model_picker: Option<SettingsModelPickerPopupView>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlScanButtonView {
    pub tooltip: String,
    pub disabled: bool,
    pub refreshing: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SourceControlDiscoveryView {
    Disconnected {
        section_id: String,
        title: String,
        message: String,
    },
    Scanning {
        sections: Vec<SourceControlSkeletonSectionView>,
    },
    Discovered {
        sections: Vec<SourceControlSectionView>,
    },
    Empty {
        section_id: String,
        title: String,
        empty_title: String,
        empty_description: String,
        scan_label: String,
        scan_disabled: bool,
        scanning: bool,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlSkeletonSectionView {
    pub key: String,
    pub title: String,
    pub show_scan_button: bool,
    pub row_keys: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlSectionView {
    pub key: String,
    pub id: Option<String>,
    pub title: String,
    pub show_scan_button: bool,
    pub rows: Vec<SourceControlRowView>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlBadgeView {
    pub label: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SourceControlSummaryView {
    Text {
        text: String,
    },
    Authenticated {
        text: String,
        account_prefix: String,
        account: Option<String>,
    },
    CliSignIn {
        before: String,
        executable: String,
        after: String,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlDetailsView {
    pub kind: String,
    pub search_target_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlAccountView {
    pub text: String,
    pub revealed: bool,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlRowView {
    pub id: String,
    pub label: String,
    pub version: Option<String>,
    pub icon: Option<String>,
    pub status_tone: String,
    pub coming_soon: bool,
    pub badges: Vec<SourceControlBadgeView>,
    pub summary: SourceControlSummaryView,
    pub enabled: bool,
    pub show_availability_switch: bool,
    pub details: Option<SourceControlDetailsView>,
    pub expanded: bool,
    pub account: Option<SourceControlAccountView>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFetchIntervalView {
    pub id: String,
    pub title: String,
    pub policy_tooltip: String,
    pub description: String,
    pub value_seconds: f64,
    pub min_seconds: f64,
    pub step_seconds: f64,
    pub can_reset: bool,
    pub reset_label: String,
    pub unit_label: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketMethodOptionView {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketFieldView {
    pub field: String,
    pub label: String,
    pub input_type: String,
    pub placeholder: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BitbucketCredentialsView {
    pub search_target_id: String,
    pub method_options: Vec<BitbucketMethodOptionView>,
    pub method: String,
    pub description: String,
    pub link: String,
    pub link_label: String,
    pub fields: Vec<BitbucketFieldView>,
    pub footnote: Option<String>,
    pub locked: bool,
    pub show_remove: bool,
    pub remove_label: String,
    pub remove_disabled: bool,
    pub save_label: String,
    pub save_disabled: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingModeOptionView {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum InstructionsEditorView {
    None,
    BulkClosed {
        open_label: String,
    },
    BulkEditing {
        draft: String,
        placeholder: String,
        apply_label: String,
        apply_disabled: bool,
    },
    Custom {
        value: String,
        placeholder: String,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingStyleRowView {
    pub id: String,
    pub title: String,
    pub description: String,
    pub can_reset: bool,
    pub reset_label: String,
    pub value: Option<String>,
    pub value_label: String,
    pub options: Vec<WritingModeOptionView>,
    pub trigger_aria_label: String,
    pub editor: InstructionsEditorView,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplatesRowView {
    pub id: String,
    pub title: String,
    pub mixed: bool,
    pub description: String,
    pub can_reset: bool,
    pub reset_label: String,
    pub checked: bool,
    pub aria_label: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum WriterModelControlView {
    Disconnected {
        message: String,
    },
    Connected {
        unavailable_message: Option<String>,
        show_picker: bool,
        switch_checked: bool,
        switch_disabled: bool,
        switch_aria_label: String,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterModelRowView {
    pub id: String,
    pub title: String,
    pub description: String,
    pub control: WriterModelControlView,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlWritingView {
    pub section_id: String,
    pub title: String,
    pub writing_style: WritingStyleRowView,
    pub templates: TemplatesRowView,
    pub writer_model: WriterModelRowView,
}
