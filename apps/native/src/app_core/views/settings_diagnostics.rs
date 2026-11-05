use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsStatView {
    pub id: String,
    pub label: String,
    pub value: String,
    pub tooltip: Option<String>,
    pub tone: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum DiagnosticsLastCheckedView {
    Missing {
        label: String,
    },
    Invalid {
        label: String,
    },
    Relative {
        label: String,
        value: String,
        suffix: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsMessageView {
    pub id: String,
    pub message: String,
    pub tone: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsRefreshButtonView {
    pub target: String,
    pub label: String,
    pub is_pending: bool,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsOpenLogsView {
    pub label: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsOptionView {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsWindowSelectorView {
    pub aria_label: String,
    pub value: String,
    pub options: Vec<DiagnosticsOptionView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExpandableTextView {
    pub text: String,
    pub can_expand: bool,
    pub collapsed: bool,
    pub expanded: bool,
    pub toggle_label: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsExpandableCellView {
    pub id: String,
    pub collapsed_lines: usize,
    pub content: ExpandableTextView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TraceIdCellView {
    pub trace_id: String,
    pub short_trace_id: String,
    pub copied: bool,
    pub copy_aria_label: String,
    pub copy_tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessSignalActionView {
    pub signal: String,
    pub label: String,
    pub aria_label: String,
    pub tooltip: String,
    pub tone: String,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessSignalActionsView {
    pub actions: Vec<ProcessSignalActionView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsProcessToggleView {
    pub aria_label: String,
    pub icon: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsProcessRowView {
    pub id: String,
    pub pid: f64,
    pub pid_label: String,
    pub name: String,
    pub command: String,
    pub indent_level: f32,
    pub toggle: Option<DiagnosticsProcessToggleView>,
    pub cpu: String,
    pub memory: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub signal_actions: ProcessSignalActionsView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsProcessTableView {
    pub headers: Vec<String>,
    pub rows: Vec<DiagnosticsProcessRowView>,
    pub empty_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsLiveProcessesView {
    pub title: String,
    pub refresh: DiagnosticsRefreshButtonView,
    pub stats: Vec<DiagnosticsStatView>,
    pub messages: Vec<DiagnosticsMessageView>,
    pub table: DiagnosticsProcessTableView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsResourceBarView {
    pub id: String,
    pub peak_height_percent: f32,
    pub average_height_percent: f32,
    pub tooltip: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsResourceRowView {
    pub id: String,
    pub pid_label: String,
    pub name: String,
    pub command: String,
    pub indent_level: f32,
    pub status_tone: String,
    pub cpu_time: String,
    pub current_cpu: String,
    pub average_cpu: String,
    pub peak_cpu: String,
    pub max_memory: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsResourceTableView {
    pub headers: Vec<String>,
    pub rows: Vec<DiagnosticsResourceRowView>,
    pub empty_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsChartView {
    pub bars: Vec<DiagnosticsResourceBarView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsResourceHistoryView {
    pub title: String,
    pub window_selector: DiagnosticsWindowSelectorView,
    pub refresh: DiagnosticsRefreshButtonView,
    pub stats: Vec<DiagnosticsStatView>,
    pub messages: Vec<DiagnosticsMessageView>,
    pub chart: DiagnosticsChartView,
    pub table: DiagnosticsResourceTableView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsTraceView {
    pub title: String,
    pub open_logs: DiagnosticsOpenLogsView,
    pub refresh: DiagnosticsRefreshButtonView,
    pub stats: Vec<DiagnosticsStatView>,
    pub messages: Vec<DiagnosticsMessageView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsTableSectionView<Row> {
    pub id: String,
    pub title: String,
    pub headers: Vec<String>,
    pub rows: Vec<Row>,
    pub empty_label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LatestFailureRowView {
    pub id: String,
    pub name: String,
    pub cause: DiagnosticsExpandableCellView,
    pub duration: String,
    pub ended: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CommonFailureRowView {
    pub id: String,
    pub name: String,
    pub count: String,
    pub cause: DiagnosticsExpandableCellView,
    pub last_seen: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SlowSpanRowView {
    pub id: String,
    pub name: String,
    pub duration: String,
    pub ended: String,
    pub trace: TraceIdCellView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SpanLogRowView {
    pub id: String,
    pub time: String,
    pub level: String,
    pub span_name: String,
    pub message: DiagnosticsExpandableCellView,
    pub trace: TraceIdCellView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TopSpanRowView {
    pub id: String,
    pub name: String,
    pub count: String,
    pub failures: String,
    pub average: String,
    pub max: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsModelView {
    pub live_processes: DiagnosticsLiveProcessesView,
    pub resource_history: DiagnosticsResourceHistoryView,
    pub trace: DiagnosticsTraceView,
    pub latest_failures: DiagnosticsTableSectionView<LatestFailureRowView>,
    pub common_failures: DiagnosticsTableSectionView<CommonFailureRowView>,
    pub slowest_spans: DiagnosticsTableSectionView<SlowSpanRowView>,
    pub span_logs: DiagnosticsTableSectionView<SpanLogRowView>,
    pub top_span_names: DiagnosticsTableSectionView<TopSpanRowView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceBadgeView {
    pub prefix: String,
    pub text: String,
    pub tone: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceRefreshControlView {
    pub disabled: bool,
    pub refreshing: bool,
    pub aria_label: String,
    pub tooltip: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceStatView {
    pub id: String,
    pub icon: String,
    pub label: String,
    pub value: String,
    pub detail: Option<String>,
    pub tone: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceMetricPairView {
    pub id: String,
    pub label: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceAggregateCardView {
    pub id: String,
    pub label: String,
    pub accent: String,
    pub process_count_label: String,
    pub metrics: Vec<ResourceMetricPairView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceMonitorView {
    pub title: String,
    pub icon: String,
    pub native_badge: Option<ResourceBadgeView>,
    pub refresh: ResourceRefreshControlView,
    pub footprint_title: String,
    pub footprint_description: String,
    pub sampling_label: String,
    pub stats: Vec<ResourceStatView>,
    pub error: Option<String>,
    pub aggregates: Option<Vec<ResourceAggregateCardView>>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDetailRowView {
    pub id: String,
    pub label: String,
    pub value: String,
    pub tone: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceHealthSourceView {
    pub id: String,
    pub label: String,
    pub description: String,
    pub badge: ResourceBadgeView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ResourceHostStateView {
    Signals { rows: Vec<ResourceDetailRowView> },
    Disconnected { title: String, description: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ResourceCollectionView {
    Ready {
        sources: Vec<ResourceHealthSourceView>,
        rows: Vec<ResourceDetailRowView>,
    },
    Waiting {
        label: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceRetryView {
    pub visible: bool,
    pub disabled: bool,
    pub refreshing: bool,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceHostView {
    pub title: String,
    pub icon: String,
    pub retry: ResourceRetryView,
    pub host_state_title: String,
    pub host_state_icon: String,
    pub host_state: ResourceHostStateView,
    pub collection_title: String,
    pub collection_icon: String,
    pub collection: ResourceCollectionView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceLegendItemView {
    pub id: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceHistoryBarView {
    pub id: String,
    pub cpu_height_percent: f32,
    pub read_height_percent: f32,
    pub write_height_percent: f32,
    pub tooltip_lines: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceColumnView {
    pub id: String,
    pub label: String,
    pub align: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceHistoryProcessRowView {
    pub id: String,
    pub pid: f64,
    pub name: String,
    pub command_tooltip: String,
    pub category_label: String,
    pub cpu_time: String,
    pub peak_cpu: String,
    pub peak_memory: String,
    pub read: String,
    pub write: String,
    pub sample_count: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceTimelineView {
    pub title: String,
    pub icon: String,
    pub window_selector: DiagnosticsWindowSelectorView,
    pub refresh: ResourceRefreshControlView,
    pub error: Option<String>,
    pub legend: Vec<ResourceLegendItemView>,
    pub bars: Vec<ResourceHistoryBarView>,
    pub process_columns: Vec<ResourceColumnView>,
    pub process_empty_label: Option<String>,
    pub process_rows: Vec<ResourceHistoryProcessRowView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSignalView {
    pub available: bool,
    pub disabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceLiveProcessRowView {
    pub id: String,
    pub pid: f64,
    pub start_time_ms: f64,
    pub name: String,
    pub command_tooltip: String,
    pub indent_px: f32,
    pub has_children: bool,
    pub collapsed: bool,
    pub toggle_label: String,
    pub category_label: String,
    pub category_dot: String,
    pub cpu: String,
    pub cpu_time: String,
    pub memory: String,
    pub read_rate: String,
    pub write_rate: String,
    pub read_total: String,
    pub write_total: String,
    pub io_semantics_label: String,
    pub signal: ResourceSignalView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceIdentityHintView {
    pub label: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceProcessTreeView {
    pub title: String,
    pub icon: String,
    pub identity_hint: Option<ResourceIdentityHintView>,
    pub columns: Vec<ResourceColumnView>,
    pub empty_label: Option<String>,
    pub rows: Vec<ResourceLiveProcessRowView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceAttributionRowView {
    pub id: String,
    pub component: String,
    pub operation: String,
    pub logical_read: String,
    pub logical_write: String,
    pub count: f64,
    pub duration: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceAttributionView {
    pub title: String,
    pub icon: String,
    pub header_note: String,
    pub description: String,
    pub columns: Vec<ResourceColumnView>,
    pub empty_label: Option<String>,
    pub rows: Vec<ResourceAttributionRowView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceTelemetryView {
    pub monitor: ResourceMonitorView,
    pub host: ResourceHostView,
    pub timeline: ResourceTimelineView,
    pub process_tree: ResourceProcessTreeView,
    pub attribution: ResourceAttributionView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDiagnosticsView {
    pub telemetry: ResourceTelemetryView,
    pub diagnostics: DiagnosticsModelView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ResourceLastSampleView {
    Waiting {
        label: String,
    },
    Relative {
        prefix: String,
        value: String,
        suffix: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDiagnosticsClockView {
    pub last_sample: ResourceLastSampleView,
    pub processes: DiagnosticsLastCheckedView,
    pub resources: DiagnosticsLastCheckedView,
    pub trace: DiagnosticsLastCheckedView,
}
