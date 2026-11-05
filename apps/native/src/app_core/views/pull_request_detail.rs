use serde::Deserialize;

use super::branch_toolbar::MiddleTruncateSplit;
use super::pull_requests::{
    PullRequestActorModel, PullRequestChecksTriggerModel, PullRequestDiffStatModel,
    PullRequestGlyphId, PullRequestStackLayerView, PullRequestStateModel,
};
use super::sidebar::EnvironmentMachineKind;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetailTabModel {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetailButtonModel {
    pub label: String,
    pub aria_label: String,
    pub tooltip: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GhostSeedModel {
    pub repository: String,
    pub number: u64,
    pub url: String,
    pub open_aria_label: String,
    pub state: PullRequestStateModel,
    pub title: String,
    pub author: PullRequestActorModel,
    pub updated_label: String,
    pub base_branch: String,
    pub head_branch: String,
    pub additions: u64,
    pub deletions: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GhostChecksModel {
    pub label: String,
    pub tone_class_name: String,
    pub icon: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GhostLabelModel {
    pub name: String,
    pub color: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetailGhostModel {
    pub seed: Option<GhostSeedModel>,
    pub number_label: String,
    pub checks: Option<GhostChecksModel>,
    pub checkout_command: Option<String>,
    pub changed_files_label: Option<String>,
    pub tabs: Vec<DetailTabModel>,
    pub selected_tab: String,
    pub labels: Option<Vec<GhostLabelModel>>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum DetailGateView {
    Ghost { ghost: Box<DetailGhostModel> },
    Unavailable { title: String, description: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GhostActionsModel {
    pub visible: bool,
    pub resolve_conflicts: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChromeBackModel {
    pub visible: bool,
    pub aria_label: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChromeModel {
    pub visible: bool,
    pub bordered: bool,
    pub back: ChromeBackModel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryModel {
    pub label: String,
    pub url: Option<String>,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NumberModel {
    pub label: String,
    pub aria_label: String,
    pub tooltip: String,
    pub url: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BranchesModel {
    pub base: String,
    pub head: String,
    pub stacked: bool,
    pub stacked_aria_label: String,
    pub base_tooltip: String,
    pub head_copy_label: String,
    pub head_copied_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FreshnessMethodModel {
    pub method: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FreshnessModel {
    pub summary: String,
    pub note: String,
    pub disabled: bool,
    pub methods: Vec<FreshnessMethodModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFilesModel {
    pub count: String,
    pub aria_label: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TitleEditorModel {
    pub editing: bool,
    pub draft: String,
    pub can_edit: bool,
    pub edit_aria_label: String,
    pub input_aria_label: String,
    pub input_disabled: bool,
    pub cancel_label: String,
    pub cancel_disabled: bool,
    pub save_label: String,
    pub save_disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetailHeaderModel {
    pub repository: RepositoryModel,
    pub number: NumberModel,
    pub state: PullRequestStateModel,
    pub title: String,
    pub author: PullRequestActorModel,
    pub author_profile_url: Option<String>,
    pub updated_relative: String,
    pub updated_label: String,
    pub checkout_command: Option<String>,
    pub branches: BranchesModel,
    pub freshness: Option<FreshnessModel>,
    pub changed_files: ChangedFilesModel,
    pub diff_stat: Option<PullRequestDiffStatModel>,
    pub title_editor: TitleEditorModel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VisibleLabelModel {
    pub visible: bool,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StackMenuFlags {
    pub visible: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutOptionModel {
    pub mode: String,
    pub icon: String,
    pub title: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentOptionModel {
    pub environment_id: String,
    pub label: String,
    pub machine: EnvironmentMachineKind,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentPickerModel {
    pub visible: bool,
    pub value: String,
    pub disabled: bool,
    pub options: Vec<EnvironmentOptionModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutControlModel {
    pub label: String,
    pub aria_label: String,
    pub tooltip: String,
    pub disabled: bool,
    pub visible: bool,
    pub options: Vec<CheckoutOptionModel>,
    pub environments: EnvironmentPickerModel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BadgeTipModel {
    pub label: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PrimaryModel {
    Resolve { button: DetailButtonModel },
    Ready { button: DetailButtonModel },
    EnableAutoMerge { button: DetailButtonModel },
    AutoMergeArmed { label: String, tooltip: String },
    Merge { button: DetailButtonModel },
    State { state: PullRequestStateModel },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetailActionsModel {
    pub retry_stack: VisibleLabelModel,
    pub stack_menu: StackMenuFlags,
    pub checkout: CheckoutControlModel,
    pub armed_badge: Option<BadgeTipModel>,
    pub primary: Option<PrimaryModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MenuItemModel {
    pub visible: bool,
    pub label: String,
    pub disabled: bool,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActionMenuItemModel {
    pub visible: bool,
    pub label: String,
    pub disabled: bool,
    pub action: String,
    #[serde(default)]
    pub icon: Option<PullRequestGlyphId>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MergeMethodOptionModel {
    pub method: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MergeMethodsModel {
    pub visible: bool,
    pub separator_before: bool,
    pub value: String,
    pub disabled: bool,
    pub options: Vec<MergeMethodOptionModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActionGroupModel {
    pub visible: bool,
    pub draft_toggle: ActionMenuItemModel,
    pub merge_now: MenuItemModel,
    pub auto_merge: ActionMenuItemModel,
    pub merge_methods: MergeMethodsModel,
    pub separator_after: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LinkItemModel {
    pub label: String,
    pub url: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CopyItemModel {
    pub label: String,
    pub shortcut: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleModel {
    pub label: String,
    pub icon: String,
    pub destructive: bool,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MenuTriggerModel {
    pub aria_label: String,
    pub refreshing: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetailMenuModel {
    pub trigger: MenuTriggerModel,
    pub refresh: MenuItemModel,
    pub ask: MenuItemModel,
    pub explain: MenuItemModel,
    pub fix_findings: MenuItemModel,
    pub environments: EnvironmentPickerModel,
    pub action_group: ActionGroupModel,
    pub open_on_host: LinkItemModel,
    pub copy_link: CopyItemModel,
    pub copy_number: CopyItemModel,
    pub lifecycle: Option<LifecycleModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TabsModel {
    pub items: Vec<DetailTabModel>,
    pub active: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NavChecksModel {
    pub state: Option<String>,
    pub summary: Option<String>,
    pub aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NavLabelModel {
    pub label: String,
    pub aria_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NavApprovalsModel {
    pub label: String,
    pub tone_class_name: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum DetailNavModel {
    Summary {
        approve_workflows: Option<DetailButtonModel>,
        checks: NavChecksModel,
    },
    Timeline {
        dimmed: bool,
        comments: NavLabelModel,
        commits: NavLabelModel,
        approvals: Option<NavApprovalsModel>,
        order: NavLabelModel,
    },
    Code,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum DetailBodyModel {
    Unavailable { error: String },
    Detail { timeline: String },
    Empty,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmationModel {
    pub title: String,
    pub description: String,
    pub cancel_label: String,
    pub confirm_label: String,
    pub destructive: bool,
    pub confirm_disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetailModel {
    pub loading: bool,
    pub ghost_actions: GhostActionsModel,
    pub chrome: ChromeModel,
    pub header: Option<DetailHeaderModel>,
    pub actions: DetailActionsModel,
    pub resolve_conflicts: DetailButtonModel,
    pub menu: Option<DetailMenuModel>,
    pub tabs: TabsModel,
    pub nav: Option<DetailNavModel>,
    pub body: DetailBodyModel,
    pub confirmation: ConfirmationModel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StackMenuItemModel {
    pub visible: bool,
    pub label: String,
    pub disabled: bool,
    #[serde(default)]
    pub tooltip: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StackTriggerModel {
    pub aria_label: String,
    pub position_label: String,
    pub warning: bool,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StackDialogModel {
    pub open: bool,
    pub title: String,
    pub description: String,
    pub dismissible: bool,
    pub cancel_label: String,
    pub confirm_label: String,
    pub buttons_disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StackMenuModel {
    pub trigger: StackTriggerModel,
    pub retry_label: Option<String>,
    pub actions_visible: bool,
    pub merge_item: StackMenuItemModel,
    pub rebase_item: StackMenuItemModel,
    pub blocked_note: Option<String>,
    pub merge_button: StackMenuItemModel,
    pub dialog: StackDialogModel,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetailStackMenuView {
    pub model: StackMenuModel,
    pub notice: Option<String>,
    pub stale: bool,
    pub layers: Vec<PullRequestStackLayerView>,
    pub dialog_layers: Vec<PullRequestStackLayerView>,
    pub base: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThreadLinksCountModel {
    pub aria_label: String,
    pub count_label: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThreadLinksMenuItemModel {
    pub label: String,
    pub icon: PullRequestGlyphId,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThreadLinksModel {
    pub count: ThreadLinksCountModel,
    pub menu_item: ThreadLinksMenuItemModel,
    pub picker_title: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThreadPickerRowModel {
    pub id: String,
    pub title: String,
    pub project_title: Option<String>,
    pub linked: bool,
    pub linked_label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThreadPickerModel {
    pub search_placeholder: String,
    pub search_disabled: bool,
    pub empty_label: Option<String>,
    pub rows: Vec<ThreadPickerRowModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetailThreadLinksView {
    pub model: ThreadLinksModel,
    pub count_visible: bool,
    pub picker: Option<ThreadPickerModel>,
    pub picker_query: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UnavailableExtras {
    pub refreshing: bool,
    pub git_hub_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestDetailShellView {
    pub surface_id: String,
    pub context: String,
    pub gate: Option<DetailGateView>,
    pub ghost: Option<Box<DetailGhostModel>>,
    pub model: Option<Box<DetailModel>>,
    pub confirmation_open: bool,
    pub mounted_tabs: Vec<String>,
    pub unavailable: UnavailableExtras,
    pub stack_menu: Option<Box<DetailStackMenuView>>,
    pub thread_links: Option<Box<DetailThreadLinksView>>,
    pub title_revision: u64,
    pub checks_trigger: Option<PullRequestChecksTriggerModel>,
    pub activity_unavailable: Option<ActivityUnavailableModel>,
    pub branch_splits: BranchSplits,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BranchSplits {
    pub base: Option<MiddleTruncateSplit>,
    pub head: Option<MiddleTruncateSplit>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActivityUnavailableModel {
    pub title: String,
    pub message: String,
    pub retry_label: String,
}
