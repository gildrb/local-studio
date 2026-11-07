use eukhe_types::ai::CatalogModel;
use eukhe_types::daemon::{SessionActionSnapshot, SessionEvent};
use serde::Deserialize;
use serde_json::Value;

use crate::model::{AccessMode, ContextUsage, ModelOption, ModelRef, QueuedMessage, ThreadInfo};

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct LiveState {
    pub(crate) session_id: String,
    pub(crate) session_file: Option<String>,
    pub(crate) name: Option<String>,
    pub(crate) cwd: String,
    pub(crate) model: Option<ModelRef>,
    pub(crate) thinking_level: String,
    pub(crate) thinking_levels: Vec<String>,
    pub(crate) busy: bool,
    pub(crate) compacting: bool,
    pub(crate) retry_attempt: u32,
    pub(crate) context: Option<ContextUsage>,
    pub(crate) queue: Queue,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct Queue {
    pub(crate) steering: Vec<String>,
    pub(crate) follow_ups: Vec<String>,
}

impl Queue {
    fn from_snapshot(actions: &SessionActionSnapshot) -> Self {
        Self {
            steering: actions.steering.iter().map(|item| item.text.clone()).collect(),
            follow_ups: actions.follow_ups.iter().map(|item| item.text.clone()).collect(),
        }
    }

    pub(crate) fn len(&self) -> u32 {
        u32::try_from(self.steering.len() + self.follow_ups.len()).unwrap_or(u32::MAX)
    }

    pub(crate) fn messages(&self, sending: &[String]) -> Vec<QueuedMessage> {
        let lane = |name: &str, texts: &[String], steering: bool| {
            texts
                .iter()
                .enumerate()
                .map(|(index, text)| {
                    let id = format!("{name}:{index}");
                    QueuedMessage { sending: sending.contains(&id), id, text: text.clone(), steering }
                })
                .collect::<Vec<_>>()
        };
        let mut messages = lane("steering", &self.steering, true);
        messages.extend(lane("followUp", &self.follow_ups, false));
        messages
    }

    pub(crate) fn find(&self, id: &str) -> Option<(&'static str, u64, String)> {
        let (lane, index) = id.split_once(':')?;
        let index: usize = index.parse().ok()?;
        let (lane, texts) = match lane {
            "steering" => ("steering", &self.steering),
            "followUp" => ("followUp", &self.follow_ups),
            _ => return None,
        };
        Some((lane, u64::try_from(index).ok()?, texts.get(index)?.clone()))
    }
}

impl LiveState {
    pub(crate) fn merge(&mut self, state: &Value) {
        let text = |key: &str| state.get(key).and_then(Value::as_str).map(str::to_string);
        let flag = |key: &str| state.get(key).and_then(Value::as_bool);
        if let Some(value) = text("sessionId") {
            self.session_id = value;
        }
        if let Some(value) = text("sessionFile") {
            self.session_file = Some(value);
        }
        if state.get("sessionName").is_some() {
            self.name = text("sessionName").filter(|name| !name.trim().is_empty());
        }
        if let Some(value) = text("cwd") {
            self.cwd = value;
        }
        if let Some(model) = state.get("model") {
            self.model = model_ref(model);
        }
        if let Some(value) = text("thinkingLevel") {
            self.thinking_level = value;
        }
        if let Some(levels) = state.get("availableThinkingLevels").and_then(Value::as_array) {
            self.thinking_levels = levels.iter().filter_map(Value::as_str).map(str::to_string).collect();
        }
        if let Some(value) = flag("isStreaming") {
            self.busy = value;
        }
        if let Some(value) = flag("isCompacting") {
            self.compacting = value;
        }
        if let Some(value) = state.get("retryAttempt").and_then(Value::as_u64) {
            self.retry_attempt = u32::try_from(value).unwrap_or(u32::MAX);
        }
        if let Some(actions) = state.get("sessionActions") {
            if let Ok(actions) = SessionActionSnapshot::deserialize(actions) {
                self.queue = Queue::from_snapshot(&actions);
            }
        }
        if let Some(usage) = state.get("contextUsage") {
            self.context = context_usage(usage);
        }
    }

    pub(crate) fn apply(&mut self, event: &SessionEvent) -> bool {
        match event {
            SessionEvent::AgentStart => replace(&mut self.busy, true),
            SessionEvent::AgentEnd { .. } => replace(&mut self.busy, false),
            SessionEvent::CompactionStart { .. } => replace(&mut self.compacting, true),
            SessionEvent::CompactionEnd { .. } => replace(&mut self.compacting, false),
            SessionEvent::SessionInfoChanged { name } => {
                replace(&mut self.name, name.clone().filter(|name| !name.trim().is_empty()))
            }
            SessionEvent::SessionActionUpdate { actions } => replace(&mut self.queue, Queue::from_snapshot(actions)),
            SessionEvent::AutoRetryStart { attempt, .. } => {
                replace(&mut self.retry_attempt, u32::try_from(*attempt).unwrap_or(u32::MAX))
            }
            SessionEvent::AutoRetryEnd { .. } => replace(&mut self.retry_attempt, 0),
            SessionEvent::TurnStart
            | SessionEvent::TurnEnd { .. }
            | SessionEvent::PromptProgress { .. }
            | SessionEvent::MessageStart { .. }
            | SessionEvent::MessageUpdate { .. }
            | SessionEvent::MessageEnd { .. }
            | SessionEvent::ToolExecutionStart { .. }
            | SessionEvent::ToolExecutionUpdate { .. }
            | SessionEvent::ToolExecutionEnd { .. }
            | SessionEvent::CompactionSummaryDelta { .. }
            | SessionEvent::ServiceTierChanged { .. }
            | SessionEvent::GoalUpdate { .. }
            | SessionEvent::MemoryUpdate { .. }
            | SessionEvent::AgentRelay(_)
            | SessionEvent::BashStart { .. }
            | SessionEvent::BashOutput { .. }
            | SessionEvent::BashEnd { .. }
            | SessionEvent::RefineComplete { .. }
            | SessionEvent::RefineFailed { .. }
            | SessionEvent::IpythonSentAgentMessage { .. } => false,
        }
    }

    pub(crate) fn info(&self, thread: &str, title: String, access: AccessMode) -> ThreadInfo {
        ThreadInfo {
            thread: thread.to_string(),
            project: None,
            title,
            cwd: self.cwd.clone(),
            model: self.model.clone(),
            thinking_level: self.thinking_level.clone(),
            thinking_levels: self.thinking_levels.clone(),
            access,
            busy: self.busy,
            run_started_at: None,
            compacting: self.compacting,
            retry_attempt: self.retry_attempt,
            queued: self.queue.len(),
            context: self.context,
            branch: None,
            worktree: None,
        }
    }
}

pub(crate) fn context_usage(value: &Value) -> Option<ContextUsage> {
    Some(ContextUsage { tokens: value.get("tokens")?.as_u64()?, window: value.get("contextWindow")?.as_u64()? })
}

pub(crate) fn model_options(data: &Value) -> anyhow::Result<Vec<ModelOption>> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Catalog {
        models: Vec<CatalogModel>,
        #[serde(default)]
        configured_providers: Vec<String>,
    }
    let catalog = Catalog::deserialize(data)?;
    let mut options: Vec<ModelOption> = faux_option().into_iter().collect();
    options.extend(catalog.models.into_iter().map(|entry| {
        ModelOption {
            configured: catalog.configured_providers.contains(&entry.model.provider),
            thinking_levels: entry
                .thinking_levels
                .iter()
                .filter_map(|level| serde_json::to_value(level).ok())
                .filter_map(|level| level.as_str().map(str::to_string))
                .collect(),
            context_window: entry.model.context_window,
            reasoning: entry.model.reasoning,
            provider: entry.model.provider,
            id: entry.model.id,
            name: entry.model.name,
        }
    }));
    Ok(options)
}

fn faux_option() -> Option<ModelOption> {
    let path = std::env::var_os("EUKHE_FAUX_SCRIPT")?;
    let script: Value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    let id = script.get("modelId").and_then(Value::as_str).unwrap_or("faux-1").to_string();
    Some(ModelOption {
        provider: "faux".to_string(),
        name: "Faux Model".to_string(),
        id,
        reasoning: false,
        thinking_levels: Vec::new(),
        context_window: script.get("contextWindow").and_then(Value::as_u64).unwrap_or(128_000),
        configured: true,
    })
}

pub(crate) fn model_ref(value: &Value) -> Option<ModelRef> {
    match value {
        Value::Object(model) => Some(ModelRef {
            provider: model.get("provider")?.as_str()?.to_string(),
            id: model.get("id").or_else(|| model.get("modelId"))?.as_str()?.to_string(),
            name: model.get("name").and_then(Value::as_str).map(str::to_string),
            reasoning: model.get("reasoning").and_then(Value::as_bool).unwrap_or(false),
        }),
        Value::String(id) => Some(ModelRef { provider: String::new(), id: id.clone(), name: None, reasoning: false }),
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::Array(_) => None,
    }
}

fn replace<T: PartialEq>(slot: &mut T, value: T) -> bool {
    if *slot == value {
        return false;
    }
    *slot = value;
    true
}
