use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenSourceLicenseRowView {
    pub id: String,
    pub name: String,
    pub version: Option<String>,
    pub summary: String,
    pub source_url: Option<String>,
    pub source_label: String,
    pub source_title: String,
    pub open: bool,
    pub notice_text: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenSourceLicensesHeaderView {
    pub count_label: String,
    pub query: String,
    pub search_open: bool,
    pub search_label: String,
    pub search_tooltip: String,
    pub search_placeholder: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum OpenSourceLicensesBodyView {
    Loading {
        message: String,
    },
    Error {
        title: String,
        message: String,
        retry_label: String,
    },
    Ready {
        rows: Vec<OpenSourceLicenseRowView>,
        empty_message: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsLicensesView {
    pub title: String,
    pub header: Option<OpenSourceLicensesHeaderView>,
    pub body: OpenSourceLicensesBodyView,
}
