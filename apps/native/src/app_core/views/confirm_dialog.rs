use serde::Deserialize;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ConfirmDialogVariant {
    Default,
    Destructive,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmDialogView {
    pub title: String,
    pub description: Option<String>,
    pub variant: ConfirmDialogVariant,
}
