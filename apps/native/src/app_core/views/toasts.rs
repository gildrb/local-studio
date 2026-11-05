use serde::Deserialize;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CoreToastKind {
    Error,
    Warning,
    Success,
    Info,
    Loading,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CoreToastActionKey {
    Action,
    SecondaryAction,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CoreToastAction {
    pub key: CoreToastActionKey,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CoreToast {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: CoreToastKind,
    pub title: String,
    pub description: Option<String>,
    pub actions: Vec<CoreToastAction>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToastsView {
    pub toasts: Vec<CoreToast>,
}
