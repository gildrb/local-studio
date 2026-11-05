use std::collections::HashMap;

use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageProviderChartView {
    pub view_width: f32,
    pub view_height: f32,
    pub plot_top: f32,
    pub aria_label: String,
    pub ticks: Vec<UsageChartTickView>,
    pub paths: Vec<UsageChartPathView>,
    pub columns: Vec<UsageChartColumnView>,
    pub axis_labels: UsageChartAxisLabelsView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageChartTickView {
    pub value: f64,
    pub y: f32,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageChartPathView {
    pub provider: String,
    pub color: String,
    pub area: String,
    pub line: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageChartColumnView {
    pub period: String,
    pub x: f32,
    pub tooltip_title: String,
    pub rows: Vec<UsageChartTooltipRowView>,
    pub total_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageChartTooltipRowView {
    pub provider: String,
    pub label: String,
    pub value_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageChartAxisLabelsView {
    pub start: String,
    pub middle: String,
    pub end: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageView {
    pub page: UsagePageView,
    pub initials: HashMap<String, String>,
    pub cursor_pending: Vec<String>,
    pub redeem: HashMap<String, UsageRedeemStateView>,
    pub emails: HashMap<String, UsageSegmentEmailView>,
    pub reset_confirm: Option<UsageResetConfirmView>,
    pub reset_buttons: HashMap<String, UsageFooterButtonView>,
    pub chat_gpt_button: UsageLinkButtonView,
    pub prices: Option<Box<UsagePricesView>>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageRedeemStateView {
    pub busy: bool,
    pub status: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageSegmentEmailView {
    pub hidden: UsageEmailTextView,
    pub revealed: UsageEmailTextView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageEmailTextView {
    pub text: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageResetConfirmView {
    pub title: String,
    pub description: String,
    pub cancel_label: String,
    pub confirm_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageLinkButtonView {
    pub label: String,
    pub url: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsagePageView {
    pub title: String,
    pub showing_limits: bool,
    pub environment_filter: UsageEnvironmentFilterView,
    pub window_label: Option<String>,
    pub metric: UsageSelectorView,
    pub period: UsageSelectorView,
    pub refresh: UsageRefreshView,
    pub content: UsageContentView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageEnvironmentFilterView {
    pub label: String,
    pub indicator: UsageEnvironmentIndicatorView,
    pub all_selected: bool,
    pub all_label: String,
    pub items: Vec<UsageEnvironmentItemView>,
    pub empty_message: Option<String>,
    pub partial_message: Option<String>,
    pub coverage_notices: Vec<String>,
    pub model_prices_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum UsageEnvironmentIndicatorView {
    Scanning { sr_label: String },
    Issue { aria_label: String },
    Chevron,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageEnvironmentItemView {
    pub environment_id: String,
    pub label: String,
    pub checked: bool,
    pub status: Option<String>,
    pub status_tone: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageSelectorView {
    pub aria_label: String,
    pub value: String,
    pub label: String,
    #[serde(default)]
    pub disabled: bool,
    pub options: Vec<UsageOptionView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageOptionView {
    pub value: serde_json::Value,
    pub key: String,
    pub label: String,
    pub title: String,
    pub selected: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageRefreshView {
    pub aria_label: String,
    pub busy: bool,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum UsageContentView {
    NoEnvironment {
        message: String,
    },
    Limits {
        limits: Box<UsageLimitsView>,
        cursor_prompt: Option<UsageCursorPromptView>,
    },
    Loading {
        providers: Vec<String>,
        totals_title: String,
        total_labels: Vec<String>,
        breakdown_title: String,
    },
    Usage(Box<UsageDataView>),
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageDataView {
    pub source_messages: Vec<String>,
    pub headline: UsageHeadlineView,
    pub chat_gpt_sharing: Option<UsageLabelView>,
    pub summary_rows: Vec<UsageSummaryRowView>,
    pub chart_title: String,
    pub chart: UsageProviderChartView,
    pub totals_title: String,
    pub totals: Vec<UsageMetricView>,
    pub breakdown: UsageBreakdownView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageLabelView {
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageHeadlineView {
    pub value: String,
    pub sessions_label: String,
    pub estimate_note: Option<String>,
    pub unpriced: Option<UsageUnpricedView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageUnpricedView {
    pub aria_label: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum UsageSummaryRowView {
    Usage {
        key: String,
        provider: String,
        label: String,
        color: String,
        session_label: String,
        value_label: String,
        detail_label: String,
    },
    Enable {
        key: String,
        label: String,
        color: String,
        button: UsageCursorButtonView,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageCursorButtonView {
    pub environment_id: String,
    pub text: String,
    pub aria_label: String,
    pub tooltip: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageCursorPromptView {
    pub title: String,
    pub copy: String,
    pub buttons: Vec<UsageCursorButtonView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageMetricView {
    pub label: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageBreakdownView {
    pub title: String,
    pub selected: String,
    pub options: Vec<UsageBreakdownOptionView>,
    pub empty_message: String,
    pub model: UsageModelBreakdownView,
    pub time: UsageTimeBreakdownView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageBreakdownOptionView {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageModelBreakdownView {
    pub headings: Vec<String>,
    pub rows: Vec<UsageModelRowView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageModelRowView {
    pub key: String,
    pub provider: String,
    pub model: String,
    pub cost_label: String,
    pub cost_unknown: bool,
    pub share_label: String,
    pub tokens_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageTimeBreakdownView {
    pub period_heading: String,
    pub provider_columns: Vec<UsageProviderColumnView>,
    pub total_heading: String,
    pub tokens_heading: String,
    pub value_column_width: String,
    pub rows: Vec<UsageTimeRowView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageProviderColumnView {
    pub provider: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageTimeRowView {
    pub key: String,
    pub period_label: String,
    pub provider_costs: Vec<UsageProviderColumnView>,
    pub total_label: String,
    pub tokens_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageLimitsView {
    pub empty_message: Option<String>,
    pub sections: Vec<UsageLimitSectionView>,
    pub cursor_prompt_index: usize,
    pub external_links: Vec<UsageExternalLinkView>,
    pub notices: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageLimitSectionView {
    pub driver: String,
    pub label: String,
    pub color: String,
    pub windows: Vec<UsageLimitWindowView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageLimitWindowView {
    pub key: String,
    pub label: String,
    pub remaining_label: String,
    pub left_label: String,
    pub pace: Option<UsageLimitPaceView>,
    pub next_refill_label: Option<String>,
    pub description: Option<String>,
    pub column_count: usize,
    pub segments: Vec<UsageLimitSegmentView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageLimitPaceView {
    pub label: String,
    pub icon: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageLimitSegmentView {
    pub key: String,
    pub index: usize,
    pub account: UsageLimitAccountView,
    pub remaining_percent: f32,
    pub remaining_label: String,
    pub hatch_width: Option<String>,
    pub show_account_name: bool,
    pub countdown: String,
    pub credits: u32,
    pub popover: UsageLimitPopoverView,
    pub redeem: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageLimitAccountView {
    pub driver: String,
    pub title: String,
    pub name: UsageAccountNameView,
    pub avatar: UsageAccountAvatarView,
    pub chip: Option<UsageAccountChipView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum UsageAccountNameView {
    Text { text: String },
    Chip,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum UsageAccountAvatarView {
    Instance {
        display_name: String,
        accent_color: Option<String>,
        show_badge: bool,
    },
    Chip,
    None,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageAccountChipView {
    pub initials: String,
    pub background: String,
    pub foreground: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageLimitPopoverView {
    pub identity_rows: Vec<UsageLimitPopoverRowView>,
    pub status_rows: Vec<UsageLimitPopoverRowView>,
    pub credits_summary: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageLimitPopoverRowView {
    pub label: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageExternalLinkView {
    pub url: String,
    pub label: String,
    pub icon: Option<String>,
    pub description: Option<String>,
    pub button_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsagePricesView {
    pub model: UsagePricesModelView,
    pub focus_row_id: Option<String>,
    pub suggestions: HashMap<String, Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsagePricesModelView {
    pub title: String,
    pub description: String,
    pub apply_label: String,
    pub unit_label: String,
    pub selection: UsagePricesSelectionView,
    pub empty_message: Option<String>,
    pub table: UsagePricesTableView,
    pub save_statuses: Option<Vec<UsagePriceStatusView>>,
    pub footer: UsagePricesFooterView,
    pub close_allowed: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsagePricesSelectionView {
    pub label: String,
    pub disabled: bool,
    pub all_selected: bool,
    pub all_label: String,
    pub options: Vec<UsagePriceEnvironmentView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsagePriceEnvironmentView {
    pub environment_id: String,
    pub label: String,
    pub checked: bool,
    pub unavailable: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsagePricesTableView {
    pub model_heading: String,
    pub field_headings: Vec<UsagePriceFieldHeadingView>,
    pub add_button: UsagePriceAddButtonView,
    pub rows: Vec<UsagePriceRowView>,
    pub empty_message: String,
    pub footnote: String,
    pub locked: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsagePriceFieldHeadingView {
    pub key: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsagePriceAddButtonView {
    pub aria_label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsagePriceRowView {
    pub id: String,
    pub model: String,
    pub is_new: bool,
    pub removed: bool,
    pub model_invalid: bool,
    pub error: Option<String>,
    pub removed_message: Option<String>,
    pub cells: Vec<UsagePriceCellView>,
    pub action: UsagePriceRowActionView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsagePriceCellView {
    pub field: String,
    pub value: String,
    pub placeholder: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsagePriceRowActionView {
    pub icon: String,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsagePriceStatusView {
    pub environment_id: String,
    pub label: String,
    pub status_label: String,
    pub failed: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsagePricesFooterView {
    pub destination_note: String,
    pub discard_button: Option<UsageFooterButtonView>,
    pub save_button: UsageFooterButtonView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageFooterButtonView {
    pub label: String,
    pub disabled: bool,
}
