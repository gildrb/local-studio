use eukhe_types::ai::{
    AssistantContentBlock, AssistantMessage, StopReason, ToolCall, ToolResultMessage, UserContent, UserContentBlock,
};
use eukhe_types::daemon::{SessionEvent, StreamUpdate};
use eukhe_types::session::AgentMessage;
use serde_json::Value;

use crate::images;
use crate::model::{Block, FileChange, ImageThumbnail, Item, ItemKind, NoticeLevel, ToolKind, ToolState, TranscriptOp};

const NO_REPLY: &str = "The turn ended without a reply.";
const ABORTED: &str = "Operation aborted";
const SUMMARY_LIMIT: usize = 160;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SettledTurn {
    pub(crate) turn: u64,
    pub(crate) files: Vec<String>,
    pub(crate) additions: u32,
    pub(crate) deletions: u32,
}

#[derive(Debug, Default)]
struct OpenTurn {
    started_at: Option<i64>,
    last_at: Option<i64>,
    files: Vec<FileChange>,
    absolute: Vec<String>,
}

#[derive(Debug, Default)]
pub(crate) struct Transcript {
    items: Vec<Item>,
    next_id: u64,
    streaming: Option<usize>,
    run_answered: bool,
    run_failure_shown: bool,
    turn: u64,
    open: Option<OpenTurn>,
    settled: Vec<SettledTurn>,
}

struct AssistantParts<'a> {
    blocks: Vec<Block>,
    calls: Vec<&'a ToolCall>,
    error: Option<String>,
}

impl Transcript {
    pub(crate) fn reset(&mut self, messages: &[AgentMessage], run_open: bool) -> TranscriptOp {
        self.items.clear();
        self.streaming = None;
        self.run_answered = false;
        self.run_failure_shown = false;
        self.turn = 0;
        self.open = None;
        let ordered = ordered_for_display(messages);
        for message in &ordered {
            match message {
                AgentMessage::User(user) => {
                    self.user(&user.content, millis(user.timestamp));
                }
                AgentMessage::Assistant(assistant) => {
                    let at = millis(assistant.timestamp);
                    self.touch(at);
                    self.touch(answered_at(assistant));
                    let parts = assistant_parts(assistant);
                    if !parts.blocks.is_empty() || parts.error.is_some() {
                        self.push(
                            ItemKind::Assistant {
                                blocks: parts.blocks,
                                streaming: false,
                                error: parts.error,
                                changed_files: Vec::new(),
                            },
                            Some(at),
                        );
                    }
                    for call in parts.calls {
                        self.upsert_call(call, at);
                    }
                }
                AgentMessage::ToolResult(result) => {
                    self.tool_result(result);
                }
                AgentMessage::Custom(custom) => {
                    if custom.display {
                        let (text, _) = user_parts(&custom.content);
                        if !text.trim().is_empty() {
                            self.push(ItemKind::Notice { level: NoticeLevel::Info, text }, None);
                        }
                    }
                }
                AgentMessage::CompactionSummary(summary) => {
                    self.push(
                        ItemKind::Compaction { summary: summary.summary.clone(), tokens_before: summary.tokens_before },
                        None,
                    );
                }
                AgentMessage::BashExecution(_) | AgentMessage::BranchSummary(_) => {}
            }
        }
        if run_open {
            if let Some(AgentMessage::Assistant(last)) = ordered.last() {
                self.adopt_partial(last);
            }
        } else {
            self.settle();
        }
        TranscriptOp::Reset { items: self.items.clone() }
    }

    pub(crate) fn items(&self) -> &[Item] {
        &self.items
    }

    pub(crate) fn take_settled(&mut self) -> Vec<SettledTurn> {
        std::mem::take(&mut self.settled)
    }

    pub(crate) fn last_user_at(&self) -> Option<i64> {
        self.items.iter().rev().find(|item| matches!(item.kind, ItemKind::User { .. })).and_then(|item| item.created_at)
    }

    pub(crate) fn first_user_text(&self) -> Option<String> {
        self.items.iter().find_map(|item| match &item.kind {
            ItemKind::User { text, .. } if !text.trim().is_empty() => Some(text.clone()),
            ItemKind::User { .. }
            | ItemKind::Assistant { .. }
            | ItemKind::Tool { .. }
            | ItemKind::TurnSummary { .. }
            | ItemKind::Notice { .. }
            | ItemKind::Compaction { .. } => None,
        })
    }

    pub(crate) fn last_answer(&self) -> Option<String> {
        self.items.iter().rev().find_map(|item| match &item.kind {
            ItemKind::Assistant { blocks, .. } => blocks.iter().rev().find_map(|block| match block {
                Block::Text { text } => Some(text.clone()),
                Block::Thinking { .. } => None,
            }),
            ItemKind::User { .. }
            | ItemKind::Tool { .. }
            | ItemKind::TurnSummary { .. }
            | ItemKind::Notice { .. }
            | ItemKind::Compaction { .. } => None,
        })
    }

    pub(crate) fn set_entries(&mut self, entries: &[(String, String)]) -> Vec<TranscriptOp> {
        let users: Vec<usize> = self
            .items
            .iter()
            .enumerate()
            .filter(|(_, item)| matches!(item.kind, ItemKind::User { .. }))
            .map(|(index, _)| index)
            .collect();
        let mut ops = Vec::new();
        for (index, (entry, text)) in users.into_iter().rev().zip(entries.iter().rev()) {
            let matches =
                matches!(&self.items[index].kind, ItemKind::User { text: shown, .. } if shown.trim() == text.trim());
            if !matches {
                break;
            }
            ops.extend(self.modify(index, |kind| {
                if let ItemKind::User { entry: slot, .. } = kind {
                    *slot = Some(entry.clone());
                }
            }));
        }
        ops
    }

    pub(crate) fn apply(&mut self, event: &SessionEvent) -> Vec<TranscriptOp> {
        match event {
            SessionEvent::AgentStart => {
                self.run_answered = false;
                self.run_failure_shown = false;
                Vec::new()
            }
            SessionEvent::MessageStart { message, assistant_message_event } => {
                self.message_start(message, assistant_message_event.as_ref())
            }
            SessionEvent::MessageUpdate { message, .. } => self.message_update(message),
            SessionEvent::MessageEnd { message } => self.message_end(message),
            SessionEvent::ToolExecutionStart { tool_call_id, tool_name, args } => {
                self.tool_started(tool_call_id, tool_name, args)
            }
            SessionEvent::ToolExecutionUpdate { tool_call_id, partial_result, .. } => {
                let output = output_text(&partial_result.content);
                self.live_card(tool_call_id)
                    .and_then(|index| {
                        self.modify(index, |kind| {
                            if let ItemKind::Tool { output: slot, .. } = kind {
                                *slot = output;
                            }
                        })
                    })
                    .into_iter()
                    .collect()
            }
            SessionEvent::ToolExecutionEnd { tool_call_id, result, is_error, .. } => {
                let state = if *is_error { ToolState::Failed } else { ToolState::Succeeded };
                let output = output_text(&result.content);
                self.live_card(tool_call_id)
                    .and_then(|index| {
                        self.modify(index, |kind| {
                            if let ItemKind::Tool { state: slot, output: text, .. } = kind {
                                *slot = state;
                                *text = output;
                            }
                        })
                    })
                    .into_iter()
                    .collect()
            }
            SessionEvent::TurnEnd { error, .. } => {
                let mut ops: Vec<TranscriptOp> = self.close_streaming().into_iter().collect();
                if let Some(error) = error {
                    if !self.run_failure_shown {
                        self.run_failure_shown = true;
                        ops.push(self.push(ItemKind::Notice { level: NoticeLevel::Error, text: error.clone() }, None));
                    }
                }
                ops
            }
            SessionEvent::AgentEnd { .. } => {
                let mut ops: Vec<TranscriptOp> = self.close_streaming().into_iter().collect();
                if !self.run_answered && !self.run_failure_shown {
                    ops.push(
                        self.push(ItemKind::Notice { level: NoticeLevel::Info, text: NO_REPLY.to_string() }, None),
                    );
                }
                self.run_answered = true;
                ops.extend(self.settle());
                ops
            }
            SessionEvent::CompactionEnd { result: Some(result), .. } => vec![self.push(
                ItemKind::Compaction { summary: result.summary.clone(), tokens_before: result.tokens_before },
                None,
            )],
            SessionEvent::AutoRetryEnd { success: false, final_error: Some(error), .. } => {
                self.run_failure_shown = true;
                vec![self.push(ItemKind::Notice { level: NoticeLevel::Error, text: error.clone() }, None)]
            }
            SessionEvent::CompactionEnd { result: None, .. }
            | SessionEvent::AutoRetryEnd { .. }
            | SessionEvent::TurnStart
            | SessionEvent::PromptProgress { .. }
            | SessionEvent::AutoRetryStart { .. }
            | SessionEvent::CompactionStart { .. }
            | SessionEvent::CompactionSummaryDelta { .. }
            | SessionEvent::SessionInfoChanged { .. }
            | SessionEvent::ServiceTierChanged { .. }
            | SessionEvent::SessionActionUpdate { .. }
            | SessionEvent::GoalUpdate { .. }
            | SessionEvent::MemoryUpdate { .. }
            | SessionEvent::AgentRelay(_)
            | SessionEvent::BashStart { .. }
            | SessionEvent::BashOutput { .. }
            | SessionEvent::BashEnd { .. }
            | SessionEvent::RefineComplete { .. }
            | SessionEvent::RefineFailed { .. }
            | SessionEvent::IpythonSentAgentMessage { .. } => Vec::new(),
        }
    }

    fn message_start(&mut self, message: &AgentMessage, stream: Option<&StreamUpdate>) -> Vec<TranscriptOp> {
        match message {
            AgentMessage::User(user) => self.user(&user.content, millis(user.timestamp)),
            AgentMessage::Assistant(assistant) => {
                if matches!(stream, Some(StreamUpdate::Start)) {
                    self.streaming = None;
                }
                self.assistant(assistant, true)
            }
            AgentMessage::Custom(custom) if custom.display => {
                let (text, _) = user_parts(&custom.content);
                if text.trim().is_empty() {
                    Vec::new()
                } else {
                    vec![self.push(ItemKind::Notice { level: NoticeLevel::Info, text }, None)]
                }
            }
            AgentMessage::Custom(_)
            | AgentMessage::ToolResult(_)
            | AgentMessage::BashExecution(_)
            | AgentMessage::BranchSummary(_)
            | AgentMessage::CompactionSummary(_) => Vec::new(),
        }
    }

    fn message_update(&mut self, message: &AgentMessage) -> Vec<TranscriptOp> {
        match message {
            AgentMessage::Assistant(assistant) => self.assistant(assistant, true),
            AgentMessage::User(_)
            | AgentMessage::ToolResult(_)
            | AgentMessage::BashExecution(_)
            | AgentMessage::Custom(_)
            | AgentMessage::BranchSummary(_)
            | AgentMessage::CompactionSummary(_) => Vec::new(),
        }
    }

    fn message_end(&mut self, message: &AgentMessage) -> Vec<TranscriptOp> {
        match message {
            AgentMessage::Assistant(assistant) => {
                let mut ops = self.assistant(assistant, false);
                self.streaming = None;
                if matches!(assistant.stop_reason, StopReason::Aborted | StopReason::Error) {
                    ops.extend(self.abort_pending_cards());
                }
                ops
            }
            AgentMessage::ToolResult(result) => self.tool_result(result),
            AgentMessage::User(_)
            | AgentMessage::BashExecution(_)
            | AgentMessage::Custom(_)
            | AgentMessage::BranchSummary(_)
            | AgentMessage::CompactionSummary(_) => Vec::new(),
        }
    }

    fn user(&mut self, content: &UserContent, at: i64) -> Vec<TranscriptOp> {
        let mut ops = self.settle();
        self.turn += 1;
        self.open = Some(OpenTurn { started_at: Some(at), last_at: Some(at), ..OpenTurn::default() });
        let (text, images) = user_parts(content);
        let thumbnails = user_thumbnails(content);
        ops.push(self.push(ItemKind::User { text, images, entry: None, thumbnails }, Some(at)));
        ops
    }

    fn touch(&mut self, at: i64) {
        if let Some(open) = self.open.as_mut() {
            open.started_at = Some(open.started_at.map_or(at, |first| first.min(at)));
            open.last_at = Some(open.last_at.map_or(at, |last| last.max(at)));
        }
    }

    fn tool_started(&mut self, call_id: &str, name: &str, args: &Value) -> Vec<TranscriptOp> {
        let arguments = arguments_text(args);
        match self.live_card(call_id) {
            Some(index) => self
                .modify(index, |kind| {
                    if let ItemKind::Tool { arguments: slot, summary, kind: tool_kind, name, state, .. } = kind {
                        if arguments != "null" {
                            *slot = arguments;
                            *tool_kind = classify(name, args);
                            *summary = summarize(name, args);
                        }
                        *state = ToolState::Running;
                    }
                })
                .into_iter()
                .collect(),
            None => vec![self.push(
                ItemKind::Tool {
                    call_id: call_id.to_string(),
                    name: name.to_string(),
                    kind: classify(name, args),
                    summary: summarize(name, args),
                    arguments,
                    state: ToolState::Running,
                    output: String::new(),
                    file_change: None,
                    started_at: None,
                    ended_at: None,
                },
                None,
            )],
        }
    }

    fn tool_result(&mut self, result: &ToolResultMessage) -> Vec<TranscriptOp> {
        let at = millis(result.timestamp);
        self.touch(at);
        let output = output_text(&result.content);
        let state = if result.is_error { ToolState::Failed } else { ToolState::Succeeded };
        let changes = file_changes(result.details.as_ref());
        let file_change = combine(&changes);
        if let Some(open) = self.open.as_mut() {
            for (change, absolute) in changes {
                if !open.absolute.contains(&absolute) {
                    open.absolute.push(absolute);
                }
                match open.files.iter_mut().find(|file| file.path == change.path) {
                    Some(file) => {
                        file.additions = file.additions.saturating_add(change.additions);
                        file.deletions = file.deletions.saturating_add(change.deletions);
                        if !file.diff.is_empty() {
                            file.diff.push('\n');
                        }
                        file.diff.push_str(&change.diff);
                    }
                    None => open.files.push(change),
                }
            }
        }
        if let Some(index) = self.pending_card(&result.tool_call_id).or_else(|| self.live_card(&result.tool_call_id)) {
            return self
                .modify(index, |kind| {
                    if let ItemKind::Tool { state: slot, output: text, file_change: change, ended_at, .. } = kind {
                        *slot = state;
                        *text = output;
                        *change = file_change;
                        *ended_at = Some(at);
                    }
                })
                .into_iter()
                .collect();
        }
        let name = result.tool_name.clone();
        vec![self.push(
            ItemKind::Tool {
                call_id: result.tool_call_id.clone(),
                kind: classify(&name, &Value::Null),
                summary: String::new(),
                name,
                arguments: String::new(),
                state,
                output,
                file_change,
                started_at: None,
                ended_at: Some(at),
            },
            None,
        )]
    }

    fn assistant(&mut self, assistant: &AssistantMessage, streaming: bool) -> Vec<TranscriptOp> {
        let at = millis(assistant.timestamp);
        self.touch(at);
        self.touch(answered_at(assistant));
        let parts = assistant_parts(assistant);
        if parts.blocks.iter().any(|block| matches!(block, Block::Text { .. })) || !parts.calls.is_empty() {
            self.run_answered = true;
        }
        if parts.error.is_some() {
            self.run_failure_shown = true;
        }
        let mut ops = Vec::new();
        let has_body = !parts.blocks.is_empty() || parts.error.is_some();
        let blocks = parts.blocks;
        let error = parts.error;
        if let Some(index) = self.streaming {
            ops.extend(self.modify(index, |kind| {
                if let ItemKind::Assistant { blocks: slot, streaming: live, error: failure, .. } = kind {
                    *slot = blocks;
                    *live = streaming;
                    *failure = error;
                }
            }));
        } else if has_body {
            ops.push(self.push(ItemKind::Assistant { blocks, streaming, error, changed_files: Vec::new() }, Some(at)));
            self.streaming = Some(self.items.len() - 1);
        }
        for call in parts.calls {
            ops.extend(self.upsert_call(call, at));
        }
        ops
    }

    fn adopt_partial(&mut self, last: &AssistantMessage) {
        let Some(index) = self.items.iter().rposition(|item| matches!(item.kind, ItemKind::Assistant { .. })) else {
            return;
        };
        self.streaming = Some(index);
        if matches!(last.stop_reason, StopReason::Stop) {
            if let ItemKind::Assistant { streaming, .. } = &mut self.items[index].kind {
                *streaming = true;
            }
        }
    }

    fn close_streaming(&mut self) -> Option<TranscriptOp> {
        let index = self.streaming.take()?;
        self.modify(index, |kind| {
            if let ItemKind::Assistant { streaming, .. } = kind {
                *streaming = false;
            }
        })
    }

    fn settle(&mut self) -> Vec<TranscriptOp> {
        let Some(open) = self.open.take() else { return Vec::new() };
        let turn = self.turn;
        let in_turn = |item: &Item| item.turn == turn;
        let tool_count =
            self.items.iter().filter(|item| in_turn(item) && matches!(item.kind, ItemKind::Tool { .. })).count();
        let last_tool = self.items.iter().rposition(|item| in_turn(item) && matches!(item.kind, ItemKind::Tool { .. }));
        let answer = self
            .items
            .iter()
            .enumerate()
            .rev()
            .find(|(index, item)| {
                in_turn(item)
                    && last_tool.is_none_or(|tool| *index > tool)
                    && matches!(&item.kind, ItemKind::Assistant { blocks, .. } if blocks.iter().any(|block| matches!(block, Block::Text { .. })))
            })
            .map(|(index, _)| index);
        let mut ops = Vec::new();
        let mut target = answer.or_else(|| {
            self.items.iter().rposition(|item| in_turn(item) && matches!(item.kind, ItemKind::Assistant { .. }))
        });
        if tool_count > 0 {
            let duration = match (open.started_at, open.last_at) {
                (Some(start), Some(end)) => u64::try_from(end.saturating_sub(start)).unwrap_or(0),
                _ => 0,
            };
            let position = answer
                .unwrap_or_else(|| self.items.iter().rposition(in_turn).map_or(self.items.len(), |index| index + 1));
            ops.push(self.insert(
                position,
                ItemKind::TurnSummary {
                    turn,
                    duration_ms: duration,
                    tool_count: u32::try_from(tool_count).unwrap_or(u32::MAX),
                },
                open.last_at,
            ));
            target = target.map(|index| if index >= position { index + 1 } else { index });
        }
        if let (Some(index), false) = (target, open.files.is_empty()) {
            let files = open.files.clone();
            ops.extend(self.modify(index, |kind| {
                if let ItemKind::Assistant { changed_files, .. } = kind {
                    *changed_files = files;
                }
            }));
        }
        self.settled.push(SettledTurn {
            turn,
            additions: open.files.iter().map(|file| file.additions).sum(),
            deletions: open.files.iter().map(|file| file.deletions).sum(),
            files: open.absolute,
        });
        ops
    }

    fn upsert_call(&mut self, call: &ToolCall, at: i64) -> Option<TranscriptOp> {
        if call.id.is_empty() || call.name.is_empty() {
            return None;
        }
        let args = Value::Object(call.arguments.clone());
        let arguments = arguments_text(&args);
        match self.live_card(&call.id) {
            Some(index) => self.modify(index, |kind| {
                if let ItemKind::Tool { arguments: slot, summary, kind: tool_kind, name, started_at, .. } = kind {
                    *slot = arguments;
                    *tool_kind = classify(name, &args);
                    *summary = summarize(name, &args);
                    started_at.get_or_insert(at);
                }
            }),
            None => Some(self.push(
                ItemKind::Tool {
                    call_id: call.id.clone(),
                    name: call.name.clone(),
                    kind: classify(&call.name, &args),
                    summary: summarize(&call.name, &args),
                    arguments,
                    state: ToolState::Pending,
                    output: String::new(),
                    file_change: None,
                    started_at: Some(at),
                    ended_at: None,
                },
                Some(at),
            )),
        }
    }

    fn abort_pending_cards(&mut self) -> Vec<TranscriptOp> {
        let pending: Vec<usize> = self
            .items
            .iter()
            .enumerate()
            .filter(|(_, item)| {
                matches!(item.kind, ItemKind::Tool { state: ToolState::Pending | ToolState::Running, .. })
            })
            .map(|(index, _)| index)
            .collect();
        pending
            .into_iter()
            .filter_map(|index| {
                self.modify(index, |kind| {
                    if let ItemKind::Tool { state, output, .. } = kind {
                        *state = ToolState::Aborted;
                        *output = ABORTED.to_string();
                    }
                })
            })
            .collect()
    }

    fn live_card(&self, call_id: &str) -> Option<usize> {
        self.items.iter().rposition(|item| {
            matches!(&item.kind, ItemKind::Tool { call_id: id, state, .. } if id == call_id && *state != ToolState::Aborted)
        })
    }

    fn pending_card(&self, call_id: &str) -> Option<usize> {
        self.items.iter().rposition(|item| {
            matches!(&item.kind, ItemKind::Tool { call_id: id, state: ToolState::Pending | ToolState::Running, .. } if id == call_id)
        })
    }

    fn modify(&mut self, index: usize, change: impl FnOnce(&mut ItemKind)) -> Option<TranscriptOp> {
        let item = self.items.get_mut(index)?;
        let before = item.kind.clone();
        change(&mut item.kind);
        if item.kind == before {
            return None;
        }
        Some(TranscriptOp::Update { index: to_u64(index), item: item.clone() })
    }

    fn push(&mut self, kind: ItemKind, created_at: Option<i64>) -> TranscriptOp {
        self.insert(self.items.len(), kind, created_at)
    }

    fn insert(&mut self, index: usize, kind: ItemKind, created_at: Option<i64>) -> TranscriptOp {
        self.next_id += 1;
        let item = Item { id: self.next_id, turn: self.turn, created_at, kind };
        let index = index.min(self.items.len());
        self.items.insert(index, item.clone());
        if let Some(streaming) = self.streaming.as_mut() {
            if *streaming >= index && index + 1 < self.items.len() {
                *streaming += 1;
            }
        }
        TranscriptOp::Insert { index: to_u64(index), item }
    }
}

pub(crate) fn classify(name: &str, args: &Value) -> ToolKind {
    let lower = name.to_ascii_lowercase();
    match lower.as_str() {
        "read" => ToolKind::Read,
        "edit" | "write" => ToolKind::Edit,
        "grep" | "glob" | "find" | "search" => ToolKind::Search,
        "bash" => ToolKind::Command,
        "ipython" => {
            let code = args.get("code").and_then(Value::as_str).unwrap_or_default();
            if code.contains("rlm.spawn") {
                ToolKind::Agent
            } else {
                ToolKind::Command
            }
        }
        "workflow" | "worker_assign" | "worker_forward" | "worker_status" => ToolKind::Agent,
        _ if lower.contains("web") || lower.contains("fetch") || lower.contains("browser") => ToolKind::Web,
        _ => ToolKind::Other,
    }
}

pub(crate) fn summarize(name: &str, args: &Value) -> String {
    let text = |key: &str| args.get(key).and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty());
    let first_line = |value: &str| value.lines().map(str::trim).find(|line| !line.is_empty()).map(str::to_string);
    let summary = match name {
        "bash" => text("script").and_then(first_line),
        "read" | "write" => text("path").map(str::to_string),
        "edit" => text("input").map(edited_paths).filter(|paths| !paths.is_empty()),
        "grep" => text("pattern").map(str::to_string),
        "glob" => text("pattern").or_else(|| text("path")).map(str::to_string),
        "ipython" => {
            if text("code").is_some_and(|code| code.contains("rlm.spawn")) {
                text("i").map(str::to_string)
            } else {
                text("code").and_then(first_line)
            }
        }
        _ => None,
    };
    let summary = summary.or_else(|| text("i").map(str::to_string)).unwrap_or_default();
    truncate(&summary, SUMMARY_LIMIT)
}

fn edited_paths(input: &str) -> String {
    let paths: Vec<&str> = input
        .lines()
        .filter_map(|line| line.trim().strip_prefix('['))
        .filter_map(|rest| rest.split_once('#').map(|(path, _)| path))
        .filter(|path| !path.is_empty())
        .collect();
    match paths.as_slice() {
        [] => String::new(),
        [only] => (*only).to_string(),
        [first, rest @ ..] => format!("{first} +{}", rest.len()),
    }
}

fn file_changes(details: Option<&Value>) -> Vec<(FileChange, String)> {
    let Some(files) = details.and_then(|details| details.get("files")).and_then(Value::as_array) else {
        return Vec::new();
    };
    files
        .iter()
        .filter_map(|file| {
            let diff = file.get("diff")?.as_str()?.to_string();
            let path = file.get("path").and_then(Value::as_str).unwrap_or_default().to_string();
            let absolute = file.get("absolute").and_then(Value::as_str).map_or_else(|| path.clone(), str::to_string);
            let (additions, deletions) = count_lines(&diff);
            Some((FileChange { path, additions, deletions, diff }, absolute))
        })
        .collect()
}

fn combine(changes: &[(FileChange, String)]) -> Option<FileChange> {
    match changes {
        [] => None,
        [(only, _)] => Some(only.clone()),
        [(first, _), ..] => Some(FileChange {
            path: format!("{} +{}", first.path, changes.len() - 1),
            additions: changes.iter().map(|(change, _)| change.additions).sum(),
            deletions: changes.iter().map(|(change, _)| change.deletions).sum(),
            diff: changes.iter().map(|(change, _)| change.diff.as_str()).collect::<Vec<_>>().join("\n"),
        }),
    }
}

fn count_lines(diff: &str) -> (u32, u32) {
    let mut additions = 0u32;
    let mut deletions = 0u32;
    for line in diff.lines() {
        if line.starts_with('+') && !line.starts_with("+++") {
            additions = additions.saturating_add(1);
        } else if line.starts_with('-') && !line.starts_with("---") {
            deletions = deletions.saturating_add(1);
        }
    }
    (additions, deletions)
}

fn truncate(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let mut cut: String = text.chars().take(limit).collect();
    cut.push('…');
    cut
}

fn ordered_for_display(messages: &[AgentMessage]) -> Vec<AgentMessage> {
    let mut ordered = messages.to_vec();
    let Some(position) = ordered.iter().position(|message| matches!(message, AgentMessage::CompactionSummary(_)))
    else {
        return ordered;
    };
    let summary = ordered.remove(position);
    let target = match &summary {
        AgentMessage::CompactionSummary(compaction) => compaction.retained_message_count.map_or_else(
            || ordered.iter().filter(|message| timestamp(message) < compaction.timestamp).count(),
            |count| usize::try_from(count).unwrap_or(usize::MAX),
        ),
        AgentMessage::User(_)
        | AgentMessage::Assistant(_)
        | AgentMessage::ToolResult(_)
        | AgentMessage::BashExecution(_)
        | AgentMessage::Custom(_)
        | AgentMessage::BranchSummary(_) => 0,
    };
    ordered.insert(target.min(ordered.len()), summary);
    ordered
}

fn timestamp(message: &AgentMessage) -> u64 {
    match message {
        AgentMessage::User(user) => user.timestamp,
        AgentMessage::Assistant(assistant) => assistant.timestamp,
        AgentMessage::ToolResult(result) => result.timestamp,
        AgentMessage::BashExecution(bash) => bash.timestamp,
        AgentMessage::Custom(custom) => custom.timestamp,
        AgentMessage::BranchSummary(summary) => summary.timestamp,
        AgentMessage::CompactionSummary(summary) => summary.timestamp,
    }
}

fn assistant_parts(assistant: &AssistantMessage) -> AssistantParts<'_> {
    let mut blocks = Vec::new();
    let mut calls = Vec::new();
    for block in &assistant.content {
        match block {
            AssistantContentBlock::Text(text) if !text.text.trim().is_empty() => {
                blocks.push(Block::Text { text: text.text.clone() });
            }
            AssistantContentBlock::Thinking(thinking) if !thinking.thinking.trim().is_empty() => {
                blocks.push(Block::Thinking { text: thinking.thinking.clone() });
            }
            AssistantContentBlock::ToolCall(call) => calls.push(call),
            AssistantContentBlock::Text(_) | AssistantContentBlock::Thinking(_) => {}
        }
    }
    let error = match assistant.stop_reason {
        StopReason::Aborted => Some(assistant.error_message.clone().unwrap_or_else(|| ABORTED.to_string())),
        StopReason::Error if calls.is_empty() => {
            Some(format!("Error: {}", assistant.error_message.as_deref().unwrap_or("Unknown error")))
        }
        StopReason::Error | StopReason::Stop | StopReason::Length | StopReason::ToolUse => None,
    };
    AssistantParts { blocks, calls, error }
}

fn user_thumbnails(content: &UserContent) -> Vec<ImageThumbnail> {
    match content {
        UserContent::Text(_) => Vec::new(),
        UserContent::Blocks(blocks) => blocks
            .iter()
            .filter_map(|block| match block {
                UserContentBlock::Image(image) => images::thumbnail(&image.mime_type, &image.data),
                UserContentBlock::Text(_) | UserContentBlock::Raw(_) => None,
            })
            .collect(),
    }
}

pub(crate) fn user_parts(content: &UserContent) -> (String, u32) {
    match content {
        UserContent::Text(text) => (text.clone(), 0),
        UserContent::Blocks(blocks) => {
            let mut texts = Vec::new();
            let mut images = 0u32;
            for block in blocks {
                match block {
                    UserContentBlock::Text(text) => texts.push(text.text.as_str()),
                    UserContentBlock::Image(_) => images = images.saturating_add(1),
                    UserContentBlock::Raw(_) => {}
                }
            }
            (texts.join("\n"), images)
        }
    }
}

fn output_text(content: &[UserContentBlock]) -> String {
    content
        .iter()
        .filter_map(|block| match block {
            UserContentBlock::Text(text) => Some(text.text.as_str()),
            UserContentBlock::Image(_) => Some("[image]"),
            UserContentBlock::Raw(_) => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn arguments_text(arguments: &Value) -> String {
    serde_json::to_string_pretty(arguments).unwrap_or_else(|_| arguments.to_string())
}

fn answered_at(assistant: &AssistantMessage) -> i64 {
    let elapsed = assistant.timing.and_then(|timing| timing.last_token_ms).unwrap_or(0);
    millis(assistant.timestamp.saturating_add(elapsed))
}

fn millis(timestamp: u64) -> i64 {
    i64::try_from(timestamp).unwrap_or(i64::MAX)
}

fn to_u64(index: usize) -> u64 {
    u64::try_from(index).unwrap_or(u64::MAX)
}
