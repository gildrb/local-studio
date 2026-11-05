use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ThemeImportBodyView {
    Conflicts {
        title: String,
        theme_labels: String,
        update_label: String,
        copy_label: String,
        back_label: String,
        cancel_label: String,
    },
    Editor {
        file_title: String,
        file_subtitle: String,
        choose_label: String,
        choose_disabled: bool,
        editor_label: String,
        editor_placeholder: String,
        editor_value: String,
        editor_plain_text: bool,
        cancel_label: String,
        submit_label: String,
        submit_disabled: bool,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeImportModelView {
    pub title: String,
    pub divider_label: String,
    pub view: ThemeImportBodyView,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSearchInputView {
    pub aria_label: String,
    pub placeholder: String,
    pub value: String,
    pub icon: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSearchSuggestionView {
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSearchSortOptionView {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSearchSortView {
    pub label: String,
    pub aria_label: String,
    pub value: String,
    pub value_label: Option<String>,
    pub disabled: bool,
    pub options: Vec<ThemeSearchSortOptionView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSearchToolbarView {
    pub suggestions_label: String,
    pub suggestions: Vec<ThemeSearchSuggestionView>,
    pub sort: Option<ThemeSearchSortView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSearchEmptyView {
    pub title: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSearchResultView {
    pub id: String,
    pub name: String,
    pub meta: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub source_url: Option<String>,
    pub source_aria_label: String,
    pub source_icon: Option<String>,
    pub action_label: String,
    pub action_icon: String,
    pub action_disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSearchUpdateDialogView {
    pub open: bool,
    pub title: String,
    pub description: String,
    pub cancel_label: String,
    pub confirm_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSearchView {
    pub title: String,
    pub description: String,
    pub input: ThemeSearchInputView,
    pub toolbar: Option<ThemeSearchToolbarView>,
    pub error: Option<String>,
    pub loading_text: Option<String>,
    pub empty: Option<ThemeSearchEmptyView>,
    pub results: Option<Vec<ThemeSearchResultView>>,
    pub update_dialog: ThemeSearchUpdateDialogView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeImportView {
    pub model: ThemeImportModelView,
    pub search: ThemeSearchView,
}
