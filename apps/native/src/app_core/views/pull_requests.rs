use std::collections::HashMap;

use serde::Deserialize;

use super::header_toolbar::PanelToggleView;
use super::sidebar::{EnvironmentMachineKind, ProjectIconView};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PullRequestGlyphId {
    PullRequest,
    Reopen,
    Draft,
    Closed,
    Merged,
    Conflicting,
    Stack,
    Link,
    Unlink,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PullRequestFilterIcon {
    Lucide { id: String },
    Glyph { id: PullRequestGlyphId },
    Provider { id: String },
    Machine { id: EnvironmentMachineKind },
    Project { project_key: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestFilterOptionModel {
    pub value: String,
    pub label: String,
    pub icon: PullRequestFilterIcon,
    pub unavailable: Option<String>,
    #[serde(default)]
    pub selected: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestFilterSubmenuModel {
    pub label: String,
    pub value: String,
    pub current: Option<PullRequestFilterOptionModel>,
    pub options: Vec<PullRequestFilterOptionModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestActorModel {
    pub login: String,
    pub initial: String,
    pub avatar_url: Option<String>,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestAuthorFilterRowModel {
    pub key: String,
    pub login: String,
    pub actor: PullRequestActorModel,
    pub merged_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestAuthorFilterModel {
    pub label: String,
    pub summary: String,
    pub search_placeholder: String,
    pub anyone_label: String,
    pub value: String,
    pub rows: Vec<PullRequestAuthorFilterRowModel>,
    pub empty_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestLabelFilterRowModel {
    pub key: String,
    pub name: String,
    pub color: Option<String>,
    pub count_label: String,
    pub checked: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestLabelFilterModel {
    pub label: String,
    pub summary: String,
    pub rows: Vec<PullRequestLabelFilterRowModel>,
    pub empty_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestFiltersMenuModel {
    pub trigger_label: String,
    pub trigger_icon: PullRequestFilterIcon,
    pub count: u32,
    pub count_label: Option<String>,
    pub state: PullRequestFilterSubmenuModel,
    pub involvement: PullRequestFilterSubmenuModel,
    pub author: PullRequestAuthorFilterModel,
    pub labels: PullRequestLabelFilterModel,
    pub draft: PullRequestFilterSubmenuModel,
    pub review: PullRequestFilterSubmenuModel,
    pub checks: PullRequestFilterSubmenuModel,
    pub host: Option<PullRequestFilterSubmenuModel>,
    pub server: Option<PullRequestFilterSubmenuModel>,
    pub project: PullRequestFilterSubmenuModel,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PullRequestCompactMenuPresentation {
    Icon,
    TriggerLabel,
    CurrentLabel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestCompactMenuModel {
    pub label: String,
    pub aria_label: String,
    pub title: Option<String>,
    pub presentation: PullRequestCompactMenuPresentation,
    pub trigger_label: Option<String>,
    pub trigger_icon: Option<PullRequestFilterIcon>,
    pub outlined: bool,
    pub value: String,
    pub current: PullRequestFilterOptionModel,
    pub options: Vec<PullRequestFilterOptionModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestCondensedMenusModel {
    pub state_menu: Option<PullRequestCompactMenuModel>,
    pub involvement_menu: Option<PullRequestCompactMenuModel>,
    pub host_menu: Option<PullRequestCompactMenuModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestStateModel {
    pub key: String,
    pub label: String,
    pub tone_class_name: String,
    pub icon: PullRequestGlyphId,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestConflictModel {
    pub label: String,
    pub tone_class_name: String,
    pub icon: PullRequestGlyphId,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestSignalModel {
    pub label: String,
    pub tone_class_name: String,
    pub icon: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestRowChecksModel {
    pub state: String,
    pub label: String,
    pub tone_class_name: String,
    pub icon: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestStackMembership {
    pub number: u64,
    pub position: u64,
    pub size: u64,
    pub base: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestDiffStatModel {
    pub additions: String,
    pub deletions: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestMatchedElsewhereModel {
    pub label: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestRowProviderModel {
    pub name: String,
    pub icon: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestRowLabelModel {
    pub name: String,
    pub color: Option<String>,
    pub overflow_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestRowModel {
    pub key: String,
    pub environment_id: String,
    pub project_id: String,
    pub host: String,
    pub repository: String,
    pub number: u64,
    pub number_label: String,
    pub title: String,
    pub url: String,
    pub open_on_host_label: String,
    pub selected: bool,
    pub state: PullRequestStateModel,
    pub conflict: Option<PullRequestConflictModel>,
    pub checks: Option<PullRequestRowChecksModel>,
    pub review_decision: Option<PullRequestSignalModel>,
    pub stack: Option<PullRequestStackMembership>,
    pub diff_stat: Option<PullRequestDiffStatModel>,
    pub matched_elsewhere: Option<PullRequestMatchedElsewhereModel>,
    pub provider: Option<PullRequestRowProviderModel>,
    pub author: PullRequestActorModel,
    pub repository_label: Option<String>,
    pub environment_label: Option<String>,
    pub labels: Vec<PullRequestRowLabelModel>,
    pub updated_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestGroupModel {
    pub key: String,
    pub label: String,
    pub show_header: bool,
    pub icon: String,
    pub count: u32,
    pub count_label: String,
    pub rows: Vec<PullRequestRowModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestListGhostModel {
    pub rows: u32,
    pub caption: Option<String>,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestsRetryModel {
    pub label: String,
    pub refreshing: bool,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestsUnavailableModel {
    pub title: String,
    pub description: String,
    pub retry: Option<PullRequestsRetryModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestsActionButtonModel {
    pub label: String,
    pub disabled: bool,
    pub busy: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PullRequestListEmptyModel {
    NoProjects {
        title: String,
        description: String,
        add_project: PullRequestsActionButtonModel,
    },
    Searching {
        ghost: PullRequestListGhostModel,
    },
    NoMatches {
        title: String,
        description: String,
        clear_search: PullRequestsActionButtonModel,
        refresh: PullRequestsActionButtonModel,
    },
    Empty {
        title: String,
        description: String,
        load_more: Option<PullRequestsActionButtonModel>,
        refresh: PullRequestsActionButtonModel,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PullRequestsBodyModel {
    Ghost {
        ghost: PullRequestListGhostModel,
    },
    Unavailable {
        unavailable: PullRequestsUnavailableModel,
    },
    Empty {
        empty: Box<PullRequestListEmptyModel>,
    },
    List {
        groups: Vec<PullRequestGroupModel>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PullRequestsFooterModel {
    Loading { label: String },
    LoadMore { label: String, disabled: bool },
    Exhausted { label: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestsErrorBannerModel {
    pub message: String,
    pub retry_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestsSearchFieldModel {
    pub value: String,
    pub busy: bool,
    pub placeholder: String,
    pub aria_label: String,
    pub expand_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestsRefreshModel {
    pub label: String,
    pub refreshing: bool,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestsPageModel {
    pub title: String,
    pub breadcrumb_label: String,
    pub condensed_breadcrumb_label: String,
    pub panel_unavailable_label: String,
    pub search: PullRequestsSearchFieldModel,
    pub sort_menu: Option<PullRequestCompactMenuModel>,
    pub provider_menu: Option<PullRequestCompactMenuModel>,
    pub condensed: PullRequestCondensedMenusModel,
    pub filters_menu: Box<PullRequestFiltersMenuModel>,
    pub host_options: Vec<PullRequestFilterOptionModel>,
    pub server_options: Vec<PullRequestFilterOptionModel>,
    pub refresh: PullRequestsRefreshModel,
    pub show_provider: bool,
    pub shown_count: u32,
    pub body: PullRequestsBodyModel,
    pub error_banner: Option<PullRequestsErrorBannerModel>,
    pub footer: Option<PullRequestsFooterModel>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PullRequestsSearchFocusTarget {
    Condensed,
    Inline,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestsSearchFocusView {
    pub revision: u64,
    pub target: PullRequestsSearchFocusTarget,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestStackPopoverModel {
    pub aria_label: String,
    pub position_label: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestsPageView {
    pub model: PullRequestsPageModel,
    pub filters_open: bool,
    pub author_query: String,
    pub author_actors: HashMap<String, PullRequestActorModel>,
    pub project_icons: HashMap<String, ProjectIconView>,
    pub stack_triggers: HashMap<String, PullRequestStackPopoverModel>,
    pub right_panel: PanelToggleView,
    pub right_panel_open: bool,
    pub search_revision: u64,
    pub search_focus: Option<PullRequestsSearchFocusView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestChecksTriggerModel {
    pub label: String,
    pub tone_class_name: String,
    pub icon: String,
    pub aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestCheckRowModel {
    pub key: String,
    pub name: String,
    pub tooltip: String,
    pub status: PullRequestSignalModel,
    pub status_key: String,
    pub status_label: String,
    pub details_url: Option<String>,
    pub details_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PullRequestChecksPopoverBody {
    None,
    Message { message: String },
    Rows { rows: Vec<PullRequestCheckRowModel> },
    Stale { message: String },
    Lazy,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestChecksPopoverModel {
    pub trigger: PullRequestChecksTriggerModel,
    pub title: String,
    pub summary: Option<String>,
    pub body: PullRequestChecksPopoverBody,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestStackLayerView {
    pub number: u64,
    pub title: String,
    pub subtitle: String,
    pub state: PullRequestStateModel,
    pub current: bool,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PullRequestPopoverView {
    Checks {
        anchor: String,
        model: PullRequestChecksPopoverModel,
    },
    Stack {
        anchor: String,
        number: u64,
        notice: Option<String>,
        stale: bool,
        retry_label: Option<String>,
        message: Option<String>,
        layers: Vec<PullRequestStackLayerView>,
        base: Option<String>,
    },
}

impl PullRequestPopoverView {
    pub fn anchor(&self) -> &str {
        match self {
            PullRequestPopoverView::Checks { anchor, .. }
            | PullRequestPopoverView::Stack { anchor, .. } => anchor,
        }
    }
}
