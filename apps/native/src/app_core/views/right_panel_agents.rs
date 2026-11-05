use serde::Deserialize;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AgentStatusTone {
    Working,
    Idle,
    Success,
    Failed,
    Stopped,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AgentPhaseTone {
    Info,
    Success,
    Muted,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AgentActivityTone {
    Failed,
    Muted,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentElapsedView {
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRowView {
    pub id: String,
    pub title: String,
    pub role: Option<String>,
    pub status_tone: AgentStatusTone,
    pub activity_tone: AgentActivityTone,
    pub activity_text: String,
    pub metadata_text: String,
    pub elapsed: Option<AgentElapsedView>,
    pub show_completed_check: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemberDotView {
    pub tone: AgentStatusTone,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentPhaseRailSegmentView {
    pub index: u32,
    pub label: String,
    pub tone: AgentPhaseTone,
    pub show_separator: bool,
    pub member_dots: Vec<AgentMemberDotView>,
    pub empty_members_text: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentPhaseView {
    pub index: u32,
    pub title: String,
    pub tone: AgentPhaseTone,
    pub show_done_check: bool,
    pub summary_text: String,
    pub open: bool,
    pub member_dots: Vec<AgentMemberDotView>,
    pub rows: Vec<AgentRowView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum WorkflowScriptBodyView {
    Success { text: String },
    Failure { text: String },
    Loading { text: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowScriptView {
    pub file_name: String,
    pub close_aria_label: String,
    pub body: WorkflowScriptBodyView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum AgentWorkflowView {
    Expanded {
        id: String,
        status_tone: AgentStatusTone,
        title: String,
        script_toggle_label: String,
        settled_text: String,
        collapse_aria_label: String,
        can_show_script: bool,
        script_open: bool,
        script: Option<Box<WorkflowScriptView>>,
        phase_rail: Vec<AgentPhaseRailSegmentView>,
        phases: Vec<AgentPhaseView>,
        unphased_rows: Vec<AgentRowView>,
        fallback_row: Option<Box<AgentRowView>>,
    },
    Collapsed {
        id: String,
        status_tone: AgentStatusTone,
        title: String,
        failed_text: Option<String>,
        agents_text: String,
        tokens_text: String,
        elapsed_text: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentDirectSectionView {
    pub title: String,
    pub rows: Vec<AgentRowView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentsFooterView {
    pub working_text: Option<String>,
    pub idle_text: Option<String>,
    pub settled_text: Option<String>,
    pub total_tokens_text: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentsEmptyView {
    pub title: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum RightPanelAgentsView {
    Empty {
        empty: AgentsEmptyView,
    },
    Agents {
        workflows: Vec<AgentWorkflowView>,
        direct: Option<AgentDirectSectionView>,
        footer: AgentsFooterView,
    },
}
