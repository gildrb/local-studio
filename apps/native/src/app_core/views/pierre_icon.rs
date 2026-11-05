use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PierreIconPaint {
    pub asset: String,
    pub color: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PierreIconView {
    pub dark: PierreIconPaint,
    pub light: PierreIconPaint,
}
