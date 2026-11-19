use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};

use eukhe_types::daemon::{SessionEvent, StreamUpdate};
use eukhe_types::session::AgentMessage;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot};

use super::{
    assistant, command, diff_details, emit_message, notice, now_ms, program, stop_reason, tool_result, user, Event,
    Image, Launch, Sink, Spend, CLAUDE_PROVIDER,
};
use crate::model::{AccessMode, Approval, ApprovalAnswer, ContextUsage, ModelOption};

const MODELS: [(&str, &str, &str); 8] = [
    ("opus", "Opus (Claude Code)", "claude-opus-5-5"),
    ("sonnet", "Sonnet (Claude Code)", "claude-sonnet-5-5"),
    ("haiku", "Haiku (Claude Code)", "claude-haiku-5-5"),
    ("fable", "Fable (Claude Code)", "claude-fable-5-1"),
    ("claude-opus-5-5", "Claude Opus 5.5 (Claude Code)", ""),
    ("claude-sonnet-5-5", "Claude Sonnet 5.5 (Claude Code)", ""),
    ("claude-haiku-5-5", "Claude Haiku 5.5 (Claude Code)", ""),
    ("claude-fable-5-1", "Claude Fable 5.1 (Claude Code)", ""),
];
const EFFORTS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];
const CONTEXT_WINDOW: u64 = 200_000;
const QUIET_STDERR: [&str; 1] = ["mcp server blocked by enterprise policy"];
const INTERRUPTED: &str = "[Request interrupted";

pub(crate) struct Claude {
    lines: mpsc::UnboundedSender<String>,
    pending: Arc<Mutex<HashMap<String, Value>>>,
    kill: Option<oneshot::Sender<()>>,
    counter: u64,
}

pub(crate) fn models() -> Vec<ModelOption> {
    MODELS
        .iter()
        .map(|(id, name, _)| ModelOption {
            provider: CLAUDE_PROVIDER.to_string(),
            id: (*id).to_string(),
            name: (*name).to_string(),
            reasoning: true,
            thinking_levels: EFFORTS.iter().map(|effort| (*effort).to_string()).collect(),
            context_window: CONTEXT_WINDOW,
            configured: true,
            service_tiers: Vec::new(),
        })
        .collect()
}

fn mode(access: AccessMode) -> &'static str {
    match access {
        AccessMode::Supervised => "manual",
        AccessMode::AutoAcceptEdits => "acceptEdits",
        AccessMode::Auto => "auto",
        AccessMode::FullAccess => "bypassPermissions",
    }
}

impl Claude {
    pub(crate) fn spawn(launch: &Launch, sink: Sink) -> Result<Self, String> {
        let binary = program("LOCAL_STUDIO_CLAUDE_BIN", "claude");
        let mut command = command(&binary, &launch.cwd);
        command.args([
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--replay-user-messages",
            "--permission-prompts",
            "host",
            "--permission-prompt-tool",
            "stdio",
            "--permission-mode",
            mode(launch.access),
        ]);
        if let Some(model) = launch.model.as_deref().filter(|model| !model.is_empty()) {
            command.args(["--model", model]);
        }
        if let Some(effort) = launch.effort.as_deref().filter(|effort| EFFORTS.contains(effort)) {
            command.args(["--effort", effort]);
        }
        command.args([if launch.resume { "--resume" } else { "--session-id" }, launch.native.as_str()]);
        let mut child = command.spawn().map_err(|error| format!("Could not start {}: {error}", binary.display()))?;
        let stdin = child.stdin.take().ok_or_else(|| "Claude Code has no input pipe.".to_string())?;
        let stdout = child.stdout.take().ok_or_else(|| "Claude Code has no output pipe.".to_string())?;
        let stderr = child.stderr.take().ok_or_else(|| "Claude Code has no error pipe.".to_string())?;
        let (lines, mut outgoing) = mpsc::unbounded_channel::<String>();
        let (kill, killed) = oneshot::channel::<()>();
        let pending = Arc::new(Mutex::new(HashMap::new()));
        tokio::spawn(async move {
            let mut stdin = stdin;
            while let Some(line) = outgoing.recv().await {
                if stdin.write_all(line.as_bytes()).await.is_err() || stdin.write_all(b"\n").await.is_err() {
                    break;
                }
                if stdin.flush().await.is_err() {
                    break;
                }
            }
        });
        let tail = Arc::new(Mutex::new(Vec::<String>::new()));
        let errors = Arc::clone(&tail);
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let lower = line.to_ascii_lowercase();
                if line.trim().is_empty() || QUIET_STDERR.iter().any(|quiet| lower.contains(quiet)) {
                    continue;
                }
                let mut tail = errors.lock().unwrap_or_else(PoisonError::into_inner);
                tail.push(line);
                if tail.len() > 8 {
                    tail.remove(0);
                }
            }
        });
        let mut translator = Translator::new(sink.clone(), lines.clone(), Arc::clone(&pending), launch.model.clone());
        let done = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if let Ok(frame) = serde_json::from_str::<Value>(&line) {
                    translator.frame(&frame);
                }
            }
            translator.finish();
        });
        tokio::spawn(async move {
            let status = tokio::select! {
                status = child.wait() => status.ok(),
                _ = killed => {
                    child.kill().await.ok();
                    None
                }
            };
            done.await.ok();
            let failure = status.filter(|status| !status.success()).map(|status| {
                let tail = tail.lock().unwrap_or_else(PoisonError::into_inner).join("\n");
                if tail.is_empty() {
                    format!("Claude Code exited ({status}).")
                } else {
                    format!("Claude Code exited ({status}): {tail}")
                }
            });
            sink.send(Event::Exited(failure));
        });
        Ok(Self { lines, pending, kill: Some(kill), counter: 0 })
    }

    fn write(&self, frame: &Value) -> Result<(), String> {
        self.lines.send(frame.to_string()).map_err(|_| "Claude Code has stopped.".to_string())
    }

    fn control(&mut self, request: &Value) -> Result<(), String> {
        self.counter += 1;
        let id = format!("ls-{}", self.counter);
        self.write(&json!({ "type": "control_request", "request_id": id, "request": request }))
    }

    pub(crate) fn send(&self, text: &str, images: &[Image]) -> Result<(), String> {
        let content = if images.is_empty() {
            Value::String(text.to_string())
        } else {
            let mut blocks: Vec<Value> = images
                .iter()
                .map(|image| {
                    json!({ "type": "image", "source": { "type": "base64", "media_type": image.mime_type, "data": image.data } })
                })
                .collect();
            blocks.push(json!({ "type": "text", "text": text }));
            Value::Array(blocks)
        };
        self.write(&json!({ "type": "user", "message": { "role": "user", "content": content } }))
    }

    pub(crate) fn interrupt(&mut self) -> Result<(), String> {
        self.control(&json!({ "subtype": "interrupt" }))
    }

    pub(crate) fn set_access(&mut self, access: AccessMode) -> Result<(), String> {
        self.control(&json!({ "subtype": "set_permission_mode", "mode": mode(access) }))
    }

    pub(crate) fn set_model(&mut self, model: &str) -> Result<(), String> {
        self.control(&json!({ "subtype": "set_model", "model": model }))
    }

    pub(crate) fn answer(&self, request: &str, answer: ApprovalAnswer) -> Result<(), String> {
        let input = self
            .pending
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(request)
            .ok_or_else(|| "That approval is no longer pending.".to_string())?;
        let response = match answer {
            ApprovalAnswer::Approve => json!({ "behavior": "allow", "updatedInput": input["input"] }),
            ApprovalAnswer::AlwaysAllowSession => {
                let suggestions: Vec<Value> = input
                    .get("suggestions")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|suggestion| {
                        let mut suggestion = suggestion.as_object()?.clone();
                        suggestion.insert("destination".to_string(), json!("session"));
                        Some(Value::Object(suggestion))
                    })
                    .collect();
                json!({ "behavior": "allow", "updatedInput": input["input"], "updatedPermissions": suggestions })
            }
            ApprovalAnswer::Deny => json!({ "behavior": "deny", "message": "The user denied this in Local Studio." }),
        };
        self.write(&json!({
            "type": "control_response",
            "response": { "subtype": "success", "request_id": request, "response": response },
        }))
    }

    pub(crate) fn kill(&mut self) {
        if let Some(kill) = self.kill.take() {
            kill.send(()).ok();
        }
    }
}

impl Drop for Claude {
    fn drop(&mut self) {
        self.kill();
    }
}

#[derive(Default)]
struct Open {
    id: String,
    blocks: Vec<Value>,
    json: HashMap<usize, String>,
    spend: Spend,
    stop: Option<String>,
    timestamp: u64,
}

struct Translator {
    sink: Sink,
    lines: mpsc::UnboundedSender<String>,
    pending: Arc<Mutex<HashMap<String, Value>>>,
    model: String,
    busy: bool,
    open: Option<Open>,
    closed: HashSet<String>,
    names: HashMap<String, String>,
    inputs: HashMap<String, Value>,
    totals: HashMap<String, Spend>,
    stopped: bool,
}

impl Translator {
    fn new(
        sink: Sink,
        lines: mpsc::UnboundedSender<String>,
        pending: Arc<Mutex<HashMap<String, Value>>>,
        model: Option<String>,
    ) -> Self {
        Self {
            sink,
            lines,
            pending,
            model: model.unwrap_or_default(),
            busy: false,
            open: None,
            closed: HashSet::new(),
            names: HashMap::new(),
            inputs: HashMap::new(),
            totals: HashMap::new(),
            stopped: false,
        }
    }

    fn frame(&mut self, frame: &Value) {
        match frame.get("type").and_then(Value::as_str).unwrap_or_default() {
            "system" => self.system(frame),
            "user" => self.user(frame),
            "stream_event" => {
                if let Some(event) = frame.get("event") {
                    self.stream(event);
                }
            }
            "assistant" => self.assistant(frame),
            "control_request" => self.control(frame),
            "control_cancel_request" => {
                if let Some(id) = frame.get("request_id").and_then(Value::as_str) {
                    self.pending.lock().unwrap_or_else(PoisonError::into_inner).remove(id);
                    self.sink.send(Event::ApprovalSettled(id.to_string()));
                }
            }
            "result" => self.result(frame),
            "rate_limit_event" => {
                let info = frame.get("rate_limit_info");
                if info.and_then(|info| info.get("status")).and_then(Value::as_str) == Some("rejected") {
                    self.stop("Claude Code reports the usage limit is reached.".to_string());
                }
            }
            _ => {}
        }
    }

    fn system(&mut self, frame: &Value) {
        if frame.get("subtype").and_then(Value::as_str) == Some("init") {
            if let Some(model) = frame.get("model").and_then(Value::as_str).filter(|model| !model.is_empty()) {
                self.model = model.to_string();
                self.sink.send(Event::Model(model.to_string()));
            }
        }
    }

    fn start(&mut self) {
        if !self.busy {
            self.busy = true;
            self.sink.session(SessionEvent::AgentStart);
        }
    }

    fn user(&mut self, frame: &Value) {
        let content = frame.get("message").and_then(|message| message.get("content")).cloned().unwrap_or(Value::Null);
        let at = now_ms();
        if frame.get("isReplay").and_then(Value::as_bool) == Some(true) {
            let text = match &content {
                Value::String(text) => text.clone(),
                _ => String::new(),
            };
            if text.starts_with("<local-command") || text.starts_with("<command-") {
                return;
            }
            self.start();
            if let Some(message) = user(&user_content(&content), at) {
                emit_message(&self.sink, message);
            }
            return;
        }
        let Value::Array(blocks) = content else { return };
        let details = frame.get("tool_use_result");
        for block in &blocks {
            if block.get("type").and_then(Value::as_str) != Some("tool_result") {
                continue;
            }
            let call = block.get("tool_use_id").and_then(Value::as_str).unwrap_or_default();
            let name = self.names.get(call).cloned().unwrap_or_default();
            let text = block_text(block.get("content"));
            let error = block.get("is_error").and_then(Value::as_bool).unwrap_or(false);
            let changes = details.and_then(|details| file_change(details, self.inputs.get(call)));
            if let Some(message) = tool_result(call, &name, &text, changes, error, at) {
                emit_message(&self.sink, message);
            }
        }
    }

    fn stream(&mut self, event: &Value) {
        let index = event.get("index").and_then(Value::as_u64).and_then(|index| usize::try_from(index).ok());
        match event.get("type").and_then(Value::as_str).unwrap_or_default() {
            "message_start" => {
                self.start();
                self.close(None);
                let message = event.get("message");
                let id = message.and_then(|message| message.get("id")).and_then(Value::as_str).unwrap_or_default();
                if let Some(model) = message.and_then(|message| message.get("model")).and_then(Value::as_str) {
                    self.model = model.to_string();
                }
                self.open = Some(Open { id: id.to_string(), timestamp: now_ms(), ..Open::default() });
                if let Some(message) = self.partial() {
                    self.sink.session(SessionEvent::MessageStart {
                        message,
                        assistant_message_event: Some(StreamUpdate::Start),
                    });
                }
            }
            "content_block_start" => {
                let Some(index) = index else { return };
                let block = event.get("content_block").cloned().unwrap_or(Value::Null);
                let (block, update) = match block.get("type").and_then(Value::as_str).unwrap_or_default() {
                    "text" => (json!({ "type": "text", "text": "" }), StreamUpdate::TextStart),
                    "thinking" | "redacted_thinking" => {
                        (json!({ "type": "thinking", "thinking": "" }), StreamUpdate::ThinkingStart)
                    }
                    "tool_use" | "server_tool_use" => {
                        let id = block.get("id").and_then(Value::as_str).unwrap_or_default();
                        let name = block.get("name").and_then(Value::as_str).unwrap_or_default();
                        self.names.insert(id.to_string(), name.to_string());
                        (
                            json!({ "type": "toolCall", "id": id, "name": name, "arguments": {} }),
                            StreamUpdate::ToolcallStart,
                        )
                    }
                    _ => return,
                };
                let Some(open) = self.open.as_mut() else { return };
                if open.blocks.len() <= index {
                    open.blocks.resize(index + 1, Value::Null);
                }
                open.blocks[index] = block;
                self.update(update);
            }
            "content_block_delta" => {
                let (Some(index), Some(delta)) = (index, event.get("delta")) else { return };
                let Some(open) = self.open.as_mut() else { return };
                let Some(block) = open.blocks.get_mut(index) else { return };
                let piece = |key: &str| delta.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
                let update = match delta.get("type").and_then(Value::as_str).unwrap_or_default() {
                    "text_delta" => {
                        let text = piece("text");
                        append(block, "text", &text);
                        StreamUpdate::TextDelta { delta: text }
                    }
                    "thinking_delta" => {
                        let text = piece("thinking");
                        append(block, "thinking", &text);
                        StreamUpdate::ThinkingDelta { delta: text }
                    }
                    "input_json_delta" => {
                        let text = piece("partial_json");
                        let buffer = open.json.entry(index).or_default();
                        buffer.push_str(&text);
                        if let Ok(Value::Object(arguments)) = serde_json::from_str::<Value>(buffer) {
                            block["arguments"] = Value::Object(arguments);
                        }
                        StreamUpdate::ToolcallDelta { delta: text }
                    }
                    _ => return,
                };
                self.update(update);
            }
            "content_block_stop" => {
                let Some(index) = index else { return };
                let Some(open) = self.open.as_mut() else { return };
                let kind = open.blocks.get(index).and_then(|block| block.get("type")).and_then(Value::as_str);
                let update = match kind {
                    Some("text") => StreamUpdate::TextEnd,
                    Some("thinking") => StreamUpdate::ThinkingEnd,
                    Some("toolCall") => StreamUpdate::ToolcallEnd,
                    _ => return,
                };
                self.update(update);
            }
            "message_delta" => {
                let Some(open) = self.open.as_mut() else { return };
                if let Some(stop) =
                    event.get("delta").and_then(|delta| delta.get("stop_reason")).and_then(Value::as_str)
                {
                    open.stop = Some(stop.to_string());
                }
                if let Some(usage) = event.get("usage") {
                    open.spend = frame_spend(usage);
                }
            }
            "message_stop" => self.close(None),
            _ => {}
        }
    }

    fn assistant(&mut self, frame: &Value) {
        let Some(message) = frame.get("message") else { return };
        let id = message.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
        let blocks = message.get("content").and_then(Value::as_array).cloned().unwrap_or_default();
        for block in &blocks {
            if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                let call = block.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
                if let Some(name) = block.get("name").and_then(Value::as_str) {
                    self.names.insert(call.clone(), name.to_string());
                }
                self.inputs.insert(call, block.get("input").cloned().unwrap_or(Value::Null));
            }
        }
        if let Some(error) = frame.get("error").and_then(Value::as_str) {
            let text: String = blocks.iter().map(|block| block_text(Some(block))).collect::<Vec<_>>().join("\n");
            if let Some(reason) = stop_reason(&format!("{error} {text}")) {
                self.stop(reason);
                return;
            }
        }
        if self.closed.contains(&id) || self.open.as_ref().is_some_and(|open| open.id == id) {
            return;
        }
        self.start();
        let converted: Vec<Value> = blocks.iter().filter_map(convert_block).collect();
        let spend = message.get("usage").map(frame_spend).unwrap_or_default();
        if let Some(message) = assistant(CLAUDE_PROVIDER, &self.model, &converted, &spend, "stop", None, now_ms()) {
            emit_message(&self.sink, message);
        }
        self.started_tools(&converted);
    }

    fn control(&mut self, frame: &Value) {
        let id = frame.get("request_id").and_then(Value::as_str).unwrap_or_default().to_string();
        let request = frame.get("request").cloned().unwrap_or(Value::Null);
        if request.get("subtype").and_then(Value::as_str) != Some("can_use_tool") {
            let response = json!({
                "type": "control_response",
                "response": { "subtype": "error", "request_id": id, "error": "Local Studio does not handle this request." },
            });
            self.lines.send(response.to_string()).ok();
            return;
        }
        let tool = request.get("tool_name").and_then(Value::as_str).unwrap_or_default();
        let input = request.get("input").cloned().unwrap_or(Value::Null);
        let summary = request
            .get("description")
            .or_else(|| request.get("title"))
            .and_then(Value::as_str)
            .map_or_else(|| describe(tool, &input), str::to_string);
        self.pending.lock().unwrap_or_else(PoisonError::into_inner).insert(
            id.clone(),
            json!({ "input": input, "suggestions": request.get("permission_suggestions").cloned().unwrap_or(json!([])) }),
        );
        self.sink.send(Event::Approval(Approval {
            request_id: id,
            step: 0,
            command: format!("{tool}: {summary}"),
            effects: vec![effect(tool).to_string()],
            agent: None,
        }));
    }

    fn result(&mut self, frame: &Value) {
        let aborted =
            frame.get("terminal_reason").and_then(Value::as_str).is_some_and(|reason| reason.contains("abort"));
        self.close(aborted.then_some("aborted"));
        for (model, totals) in frame.get("modelUsage").and_then(Value::as_object).into_iter().flatten() {
            let number = |key: &str| totals.get(key).and_then(Value::as_u64).unwrap_or(0);
            let now = Spend {
                model: model.clone(),
                input: number("inputTokens"),
                cache_read: number("cacheReadInputTokens"),
                cache_write: number("cacheCreationInputTokens"),
                output: number("outputTokens"),
                cost: totals.get("costUSD").and_then(Value::as_f64).unwrap_or(0.0),
            };
            let before = self.totals.insert(model.clone(), now.clone()).unwrap_or_default();
            let delta = Spend {
                model: model.clone(),
                input: now.input.saturating_sub(before.input),
                cache_read: now.cache_read.saturating_sub(before.cache_read),
                cache_write: now.cache_write.saturating_sub(before.cache_write),
                output: now.output.saturating_sub(before.output),
                cost: (now.cost - before.cost).max(0.0),
            };
            if delta.input + delta.output + delta.cache_read + delta.cache_write > 0 {
                self.sink.send(Event::Usage(delta));
            }
            if *model == self.model
                || self.model.is_empty()
                || MODELS.iter().any(|(alias, _, id)| *alias == self.model && id == model)
            {
                if let (Some(window), Some(usage)) =
                    (totals.get("contextWindow").and_then(Value::as_u64), frame.get("usage"))
                {
                    let spend = frame_spend(usage);
                    let tokens = spend.input + spend.cache_read + spend.cache_write + spend.output;
                    self.sink.send(Event::Context(ContextUsage { tokens, window }));
                }
            }
        }
        let error = frame.get("is_error").and_then(Value::as_bool) == Some(true);
        let text = frame.get("result").and_then(Value::as_str).unwrap_or_default();
        let failure = if error && !aborted {
            if let Some(reason) = stop_reason(text) {
                self.stop(reason);
                return;
            }
            Some(if text.is_empty() {
                "Claude Code ended the turn with an error.".to_string()
            } else {
                text.to_string()
            })
        } else {
            None
        };
        self.end(failure);
    }

    fn end(&mut self, failure: Option<String>) {
        if !self.busy {
            return;
        }
        self.busy = false;
        self.sink.session(SessionEvent::TurnEnd { answer: None, error: failure });
        self.sink.session(SessionEvent::AgentEnd { messages: Vec::new() });
    }

    fn stop(&mut self, reason: String) {
        if self.stopped {
            return;
        }
        self.stopped = true;
        self.close(Some("error"));
        if let Some(message) = notice(&reason, now_ms()) {
            emit_message(&self.sink, message);
        }
        self.end(Some(reason.clone()));
        self.sink.send(Event::Stopped(reason));
    }

    fn finish(&mut self) {
        self.close(Some("aborted"));
        self.end(None);
    }

    fn partial(&self) -> Option<AgentMessage> {
        let open = self.open.as_ref()?;
        let blocks: Vec<Value> = open.blocks.iter().filter(|block| !block.is_null()).cloned().collect();
        assistant(CLAUDE_PROVIDER, &self.model, &blocks, &open.spend, "stop", None, open.timestamp)
    }

    fn update(&self, update: StreamUpdate) {
        if let Some(message) = self.partial() {
            self.sink.session(SessionEvent::MessageUpdate {
                message,
                assistant_message_event: update,
                output_tokens: None,
            });
        }
    }

    fn close(&mut self, forced: Option<&str>) {
        let Some(open) = self.open.take() else { return };
        let blocks: Vec<Value> = open
            .blocks
            .into_iter()
            .filter(|block| !block.is_null())
            .map(|mut block| {
                if block.get("type").and_then(Value::as_str) == Some("toolCall") && !block["arguments"].is_object() {
                    block["arguments"] = json!({});
                }
                block
            })
            .collect();
        let stop = forced.unwrap_or(match open.stop.as_deref() {
            Some("tool_use") => "toolUse",
            Some("max_tokens") => "length",
            _ => "stop",
        });
        self.closed.insert(open.id.clone());
        if let Some(message) = assistant(CLAUDE_PROVIDER, &self.model, &blocks, &open.spend, stop, None, open.timestamp)
        {
            self.sink.session(SessionEvent::MessageEnd { message });
        }
        if forced.is_none() {
            self.started_tools(&blocks);
        }
    }

    fn started_tools(&self, blocks: &[Value]) {
        for block in blocks.iter().filter(|block| block.get("type").and_then(Value::as_str) == Some("toolCall")) {
            let id = block.get("id").and_then(Value::as_str).unwrap_or_default();
            let name = block.get("name").and_then(Value::as_str).unwrap_or_default();
            self.sink.session(SessionEvent::ToolExecutionStart {
                tool_call_id: id.to_string(),
                tool_name: name.to_string(),
                args: block.get("arguments").cloned().unwrap_or(Value::Null),
            });
        }
    }
}

fn append(block: &mut Value, key: &str, text: &str) {
    let mut current = block.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
    current.push_str(text);
    block[key] = Value::String(current);
}

fn frame_spend(usage: &Value) -> Spend {
    let number = |key: &str| usage.get(key).and_then(Value::as_u64).unwrap_or(0);
    Spend {
        model: String::new(),
        input: number("input_tokens"),
        cache_read: number("cache_read_input_tokens"),
        cache_write: number("cache_creation_input_tokens"),
        output: number("output_tokens"),
        cost: 0.0,
    }
}

fn convert_block(block: &Value) -> Option<Value> {
    match block.get("type").and_then(Value::as_str)? {
        "text" => Some(json!({ "type": "text", "text": block.get("text").cloned().unwrap_or_default() })),
        "thinking" => {
            Some(json!({ "type": "thinking", "thinking": block.get("thinking").cloned().unwrap_or_default() }))
        }
        "tool_use" | "server_tool_use" => Some(json!({
            "type": "toolCall",
            "id": block.get("id").cloned().unwrap_or_default(),
            "name": block.get("name").cloned().unwrap_or_default(),
            "arguments": block.get("input").filter(|input| input.is_object()).cloned().unwrap_or_else(|| json!({})),
        })),
        _ => None,
    }
}

fn user_content(content: &Value) -> Value {
    match content {
        Value::Array(blocks) => Value::Array(
            blocks
                .iter()
                .filter_map(|block| match block.get("type").and_then(Value::as_str)? {
                    "text" => Some(json!({ "type": "text", "text": block.get("text").cloned().unwrap_or_default() })),
                    "image" => {
                        let source = block.get("source")?;
                        Some(json!({
                            "type": "image",
                            "data": source.get("data").cloned().unwrap_or_default(),
                            "mimeType": source.get("media_type").cloned().unwrap_or_default(),
                        }))
                    }
                    _ => None,
                })
                .collect(),
        ),
        other => other.clone(),
    }
}

fn block_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(blocks)) => {
            blocks.iter().filter_map(|block| block.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n")
        }
        Some(block @ Value::Object(_)) => block.get("text").and_then(Value::as_str).unwrap_or_default().to_string(),
        _ => String::new(),
    }
}

fn file_change(details: &Value, input: Option<&Value>) -> Option<Value> {
    let path = details
        .get("filePath")
        .and_then(Value::as_str)
        .or_else(|| input.and_then(|input| input.get("file_path")).and_then(Value::as_str))?;
    if let Some(hunks) = details.get("structuredPatch").and_then(Value::as_array).filter(|hunks| !hunks.is_empty()) {
        let mut diff = String::new();
        for hunk in hunks {
            let number = |key: &str| hunk.get(key).and_then(Value::as_u64).unwrap_or(0);
            writeln!(
                diff,
                "@@ -{},{} +{},{} @@",
                number("oldStart"),
                number("oldLines"),
                number("newStart"),
                number("newLines")
            )
            .ok();
            for line in hunk.get("lines").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
                diff.push_str(line);
                diff.push('\n');
            }
        }
        return Some(diff_details(path, &diff));
    }
    if details.get("type").and_then(Value::as_str) == Some("create") {
        let content = details.get("content").and_then(Value::as_str).unwrap_or_default();
        let diff = content.lines().fold(String::new(), |mut diff, line| {
            writeln!(diff, "+{line}").ok();
            diff
        });
        return Some(diff_details(path, &diff));
    }
    None
}

fn describe(tool: &str, input: &Value) -> String {
    let text = |key: &str| input.get(key).and_then(Value::as_str).map(str::to_string);
    text("command")
        .or_else(|| text("file_path"))
        .or_else(|| text("path"))
        .or_else(|| text("url"))
        .or_else(|| text("pattern"))
        .unwrap_or_else(|| if input.is_null() { tool.to_string() } else { input.to_string() })
}

fn effect(tool: &str) -> &'static str {
    match tool {
        "Read" | "Grep" | "Glob" | "LS" => "read",
        "Edit" | "Write" | "MultiEdit" | "NotebookEdit" => "write",
        "WebFetch" | "WebSearch" => "net",
        _ => "exec",
    }
}

fn session_file(cwd: &str, session: &str) -> Option<PathBuf> {
    let root = std::env::var_os("CLAUDE_CONFIG_DIR")
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".claude")))?;
    let escaped: String = cwd.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let direct = root.join("projects").join(&escaped).join(format!("{session}.jsonl"));
    if direct.is_file() {
        return Some(direct);
    }
    let canonical = std::fs::canonicalize(cwd).ok()?.to_string_lossy().into_owned();
    let escaped: String = canonical.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    Some(root.join("projects").join(escaped).join(format!("{session}.jsonl"))).filter(|path| path.is_file())
}

pub(crate) fn session_exists(cwd: &str, session: &str) -> bool {
    session_file(cwd, session).is_some()
}

pub(crate) fn history(cwd: &str, session: &str) -> Vec<AgentMessage> {
    let Some(path) = session_file(cwd, session) else { return Vec::new() };
    let Ok(text) = std::fs::read_to_string(path) else { return Vec::new() };
    let mut messages = Vec::new();
    let mut names: HashMap<String, String> = HashMap::new();
    let mut inputs: HashMap<String, Value> = HashMap::new();
    let mut open: Option<(String, Vec<Value>, String, u64)> = None;
    let flush = |open: &mut Option<(String, Vec<Value>, String, u64)>, messages: &mut Vec<AgentMessage>| {
        if let Some((_, blocks, model, at)) = open.take() {
            let stop = if blocks.iter().any(|block| block["type"] == "toolCall") { "toolUse" } else { "stop" };
            if let Some(message) = assistant(CLAUDE_PROVIDER, &model, &blocks, &Spend::default(), stop, None, at) {
                messages.push(message);
            }
        }
    };
    for line in text.lines() {
        let Ok(entry) = serde_json::from_str::<Value>(line) else { continue };
        let kind = entry.get("type").and_then(Value::as_str).unwrap_or_default();
        if !matches!(kind, "user" | "assistant")
            || entry.get("isSidechain").and_then(Value::as_bool) == Some(true)
            || entry.get("isMeta").and_then(Value::as_bool) == Some(true)
        {
            continue;
        }
        let at = entry
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(crate::workspace::time::parse_rfc3339_ms)
            .and_then(|at| u64::try_from(at).ok())
            .unwrap_or(0);
        let Some(message) = entry.get("message") else { continue };
        let content = message.get("content").cloned().unwrap_or(Value::Null);
        if kind == "assistant" {
            let id = message.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
            let model = message.get("model").and_then(Value::as_str).unwrap_or_default().to_string();
            if open.as_ref().is_some_and(|(known, ..)| *known != id) {
                flush(&mut open, &mut messages);
            }
            let entry = open.get_or_insert_with(|| (id, Vec::new(), model, at));
            for block in content.as_array().into_iter().flatten() {
                if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                    let call = block.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
                    names.insert(
                        call.clone(),
                        block.get("name").and_then(Value::as_str).unwrap_or_default().to_string(),
                    );
                    inputs.insert(call, block.get("input").cloned().unwrap_or(Value::Null));
                }
                if let Some(block) = convert_block(block).filter(|block| {
                    block["type"] != "thinking" || block["thinking"].as_str().is_some_and(|text| !text.is_empty())
                }) {
                    entry.1.push(block);
                }
            }
            continue;
        }
        flush(&mut open, &mut messages);
        match &content {
            Value::String(text) => {
                if text.starts_with('<') || text.starts_with(INTERRUPTED) || text.trim().is_empty() {
                    continue;
                }
                if let Some(message) = user(&content, at) {
                    messages.push(message);
                }
            }
            Value::Array(blocks) => {
                let results: Vec<&Value> = blocks
                    .iter()
                    .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_result"))
                    .collect();
                if results.is_empty() {
                    let converted = user_content(&content);
                    let text = block_text(Some(&converted));
                    if text.starts_with('<') || text.starts_with(INTERRUPTED) {
                        continue;
                    }
                    if let Some(message) = user(&converted, at) {
                        messages.push(message);
                    }
                    continue;
                }
                for block in results {
                    let call = block.get("tool_use_id").and_then(Value::as_str).unwrap_or_default();
                    let name = names.get(call).cloned().unwrap_or_default();
                    let error = block.get("is_error").and_then(Value::as_bool).unwrap_or(false);
                    let changes = entry.get("toolUseResult").and_then(|details| file_change(details, inputs.get(call)));
                    if let Some(message) =
                        tool_result(call, &name, &block_text(block.get("content")), changes, error, at)
                    {
                        messages.push(message);
                    }
                }
            }
            _ => {}
        }
    }
    flush(&mut open, &mut messages);
    messages
}
