use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use eukhe_types::daemon::{SessionEvent, StreamUpdate};
use eukhe_types::session::AgentMessage;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot};

use super::{
    assistant, command, diff_details, emit_message, notice, now_ms, output, program, stop_reason, tool_result, user,
    Event, Image, Launch, Sink, Spend, CODEX_PROVIDER,
};
use crate::model::{AccessMode, Approval, ApprovalAnswer, ContextUsage, ModelOption};

const CALL_TIMEOUT: Duration = Duration::from_secs(60);
const CONTEXT_WINDOW: u64 = 272_000;

type Replies = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

#[derive(Clone)]
struct Rpc {
    lines: mpsc::UnboundedSender<String>,
    replies: Replies,
    next: Arc<AtomicU64>,
}

impl Rpc {
    async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (reply, answer) = oneshot::channel();
        self.replies.lock().unwrap_or_else(PoisonError::into_inner).insert(id, reply);
        self.lines
            .send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string())
            .map_err(|_| "Codex has stopped.".to_string())?;
        match tokio::time::timeout(CALL_TIMEOUT, answer).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("Codex stopped before it answered.".to_string()),
            Err(_) => {
                self.replies.lock().unwrap_or_else(PoisonError::into_inner).remove(&id);
                Err(format!("Codex did not answer {method} within {} s.", CALL_TIMEOUT.as_secs()))
            }
        }
    }

    fn notify(&self, method: &str, params: &Value) {
        self.lines.send(json!({ "jsonrpc": "2.0", "method": method, "params": params }).to_string()).ok();
    }

    fn respond(&self, id: &Value, result: &Value) -> Result<(), String> {
        self.lines
            .send(json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string())
            .map_err(|_| "Codex has stopped.".to_string())
    }

    fn refuse(&self, id: &Value, message: &str) {
        self.lines
            .send(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": message } }).to_string())
            .ok();
    }
}

struct Process {
    rpc: Rpc,
    kill: Option<oneshot::Sender<()>>,
}

#[derive(Clone)]
struct PendingApproval {
    id: Value,
    legacy: bool,
}

pub(crate) struct Codex {
    rpc: Rpc,
    thread: String,
    turn: Arc<Mutex<Option<String>>>,
    approvals: Arc<Mutex<HashMap<String, PendingApproval>>>,
    access: AccessMode,
    model: Option<String>,
    effort: Option<String>,
    cwd: String,
    kill: Option<oneshot::Sender<()>>,
}

fn approval_policy(access: AccessMode) -> Value {
    match access {
        AccessMode::Supervised => json!("untrusted"),
        AccessMode::AutoAcceptEdits | AccessMode::Auto => json!("on-request"),
        AccessMode::FullAccess => json!({
            "granular": {
                "mcp_elicitations": true,
                "request_permissions": false,
                "rules": false,
                "sandbox_approval": false,
                "skill_approval": false,
            }
        }),
    }
}

fn sandbox(access: AccessMode) -> &'static str {
    match access {
        AccessMode::Supervised => "read-only",
        AccessMode::AutoAcceptEdits | AccessMode::Auto => "workspace-write",
        AccessMode::FullAccess => "danger-full-access",
    }
}

fn sandbox_policy(access: AccessMode) -> Value {
    match access {
        AccessMode::Supervised => json!({ "type": "readOnly" }),
        AccessMode::AutoAcceptEdits | AccessMode::Auto => json!({ "type": "workspaceWrite" }),
        AccessMode::FullAccess => json!({ "type": "dangerFullAccess" }),
    }
}

fn reviewer(access: AccessMode) -> &'static str {
    match access {
        AccessMode::Auto => "auto_review",
        AccessMode::Supervised | AccessMode::AutoAcceptEdits | AccessMode::FullAccess => "user",
    }
}

#[allow(clippy::too_many_lines)]
fn start(
    cwd: &str,
    sink: Option<Sink>,
    approvals: Arc<Mutex<HashMap<String, PendingApproval>>>,
    turn: Arc<Mutex<Option<String>>>,
) -> Result<Process, String> {
    let binary = program("LOCAL_STUDIO_CODEX_BIN", "codex");
    let mut command = command(&binary, cwd);
    command.arg("app-server");
    let mut child = command.spawn().map_err(|error| format!("Could not start {}: {error}", binary.display()))?;
    let stdin = child.stdin.take().ok_or_else(|| "Codex has no input pipe.".to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "Codex has no output pipe.".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "Codex has no error pipe.".to_string())?;
    let (lines, mut outgoing) = mpsc::unbounded_channel::<String>();
    let (kill, killed) = oneshot::channel::<()>();
    let replies: Replies = Arc::new(Mutex::new(HashMap::new()));
    let rpc = Rpc { lines, replies: Arc::clone(&replies), next: Arc::new(AtomicU64::new(1)) };
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
    let error_sink = sink.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            if let (Some(sink), Some(reason)) = (error_sink.as_ref(), stop_reason(&line)) {
                if line.contains("ERROR") || line.contains("error") {
                    sink.send(Event::Stopped(reason));
                }
            }
            let mut tail = errors.lock().unwrap_or_else(PoisonError::into_inner);
            tail.push(line);
            if tail.len() > 8 {
                tail.remove(0);
            }
        }
    });
    let mut translator = sink.clone().map(|sink| Translator::new(sink, rpc.clone(), approvals, turn));
    let reader_replies = Arc::clone(&replies);
    let reader_rpc = rpc.clone();
    let done = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let Ok(frame) = serde_json::from_str::<Value>(&line) else { continue };
            let method = frame.get("method").and_then(Value::as_str);
            match (frame.get("id"), method) {
                (Some(id), None) => {
                    let Some(id) = id.as_u64() else { continue };
                    let Some(reply) = reader_replies.lock().unwrap_or_else(PoisonError::into_inner).remove(&id) else {
                        continue;
                    };
                    let result = match frame.get("error") {
                        Some(error) => Err(error
                            .get("message")
                            .and_then(Value::as_str)
                            .map_or_else(|| error.to_string(), str::to_string)),
                        None => Ok(frame.get("result").cloned().unwrap_or(Value::Null)),
                    };
                    reply.send(result).ok();
                }
                (Some(id), Some(method)) => match translator.as_mut() {
                    Some(translator) => translator.request(id, method, frame.get("params").unwrap_or(&Value::Null)),
                    None => reader_rpc.refuse(id, "Local Studio does not handle this request."),
                },
                (None, Some(method)) => {
                    if let Some(translator) = translator.as_mut() {
                        translator.notification(method, frame.get("params").unwrap_or(&Value::Null));
                    }
                }
                (None, None) => {}
            }
        }
        if let Some(translator) = translator.as_mut() {
            translator.finish();
        }
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
        replies.lock().unwrap_or_else(PoisonError::into_inner).clear();
        if let Some(sink) = sink {
            let failure = status.filter(|status| !status.success()).map(|status| {
                let tail = tail.lock().unwrap_or_else(PoisonError::into_inner).join("\n");
                format!("Codex exited ({status}): {tail}")
            });
            sink.send(Event::Exited(failure));
        }
    });
    Ok(Process { rpc, kill: Some(kill) })
}

async fn initialize(rpc: &Rpc) -> Result<(), String> {
    rpc.call(
        "initialize",
        json!({ "clientInfo": { "name": "local-studio", "title": "Local Studio", "version": env!("CARGO_PKG_VERSION") } }),
    )
    .await?;
    rpc.notify("initialized", &json!({}));
    Ok(())
}

pub(crate) async fn models() -> Result<Vec<ModelOption>, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let mut process = start(&home, None, Arc::default(), Arc::default())?;
    let listed = async {
        initialize(&process.rpc).await?;
        process.rpc.call("model/list", json!({})).await
    }
    .await;
    if let Some(kill) = process.kill.take() {
        kill.send(()).ok();
    }
    let data = listed?;
    Ok(data
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|model| model.get("hidden").and_then(Value::as_bool) != Some(true))
        .filter_map(|model| {
            let id = model.get("id").and_then(Value::as_str)?;
            let name = model.get("displayName").and_then(Value::as_str).unwrap_or(id);
            Some(ModelOption {
                provider: CODEX_PROVIDER.to_string(),
                id: id.to_string(),
                name: format!("{name} (Codex)"),
                reasoning: true,
                thinking_levels: model
                    .get("supportedReasoningEfforts")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|effort| effort.get("reasoningEffort").and_then(Value::as_str).map(str::to_string))
                    .collect(),
                context_window: CONTEXT_WINDOW,
                configured: true,
                service_tiers: Vec::new(),
            })
        })
        .collect())
}

impl Codex {
    pub(crate) async fn spawn(launch: &Launch, sink: Sink) -> Result<(Self, String, Vec<AgentMessage>), String> {
        let approvals = Arc::new(Mutex::new(HashMap::new()));
        let turn = Arc::new(Mutex::new(None));
        let mut process = start(&launch.cwd, Some(sink), Arc::clone(&approvals), Arc::clone(&turn))?;
        let opened = async {
            initialize(&process.rpc).await?;
            let mut params = json!({
                "cwd": launch.cwd,
                "approvalPolicy": approval_policy(launch.access),
                "approvalsReviewer": reviewer(launch.access),
                "sandbox": sandbox(launch.access),
            });
            if let Some(model) = launch.model.as_deref().filter(|model| !model.is_empty()) {
                params["model"] = json!(model);
            }
            if launch.resume {
                params["threadId"] = json!(launch.native);
                let resumed = process.rpc.call("thread/resume", params).await?;
                let thread = resumed.get("thread").cloned().unwrap_or(Value::Null);
                Ok::<_, String>((launch.native.clone(), history(&thread)))
            } else {
                let started = process.rpc.call("thread/start", params).await?;
                let id = started
                    .get("thread")
                    .and_then(|thread| thread.get("id"))
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Codex started a thread without an id.".to_string())?;
                Ok((id.to_string(), Vec::new()))
            }
        }
        .await;
        let (thread, history) = match opened {
            Ok(opened) => opened,
            Err(error) => {
                if let Some(kill) = process.kill.take() {
                    kill.send(()).ok();
                }
                return Err(error);
            }
        };
        let codex = Self {
            rpc: process.rpc.clone(),
            thread: thread.clone(),
            turn,
            approvals,
            access: launch.access,
            model: launch.model.clone(),
            effort: launch.effort.clone(),
            cwd: launch.cwd.clone(),
            kill: process.kill.take(),
        };
        Ok((codex, thread, history))
    }

    pub(crate) async fn send(&mut self, text: &str, images: &[Image], steer: bool) -> Result<(), String> {
        if !images.is_empty() {
            return Err("Codex threads in Local Studio do not take images yet.".to_string());
        }
        let input = json!([{ "type": "text", "text": text, "text_elements": [] }]);
        let running = self.turn.lock().unwrap_or_else(PoisonError::into_inner).clone();
        if let Some(turn) = running.filter(|_| steer) {
            self.rpc
                .call("turn/steer", json!({ "threadId": self.thread, "expectedTurnId": turn, "input": input }))
                .await?;
            return Ok(());
        }
        let mut params = json!({
            "threadId": self.thread,
            "input": input,
            "cwd": self.cwd,
            "approvalPolicy": approval_policy(self.access),
            "approvalsReviewer": reviewer(self.access),
            "sandboxPolicy": sandbox_policy(self.access),
        });
        if let Some(model) = self.model.as_deref().filter(|model| !model.is_empty()) {
            params["model"] = json!(model);
        }
        if let Some(effort) = self.effort.as_deref().filter(|effort| !effort.is_empty()) {
            params["effort"] = json!(effort);
        }
        let started = self.rpc.call("turn/start", params).await?;
        if let Some(id) = started.get("turn").and_then(|turn| turn.get("id")).and_then(Value::as_str) {
            *self.turn.lock().unwrap_or_else(PoisonError::into_inner) = Some(id.to_string());
        }
        Ok(())
    }

    pub(crate) async fn interrupt(&mut self) -> Result<(), String> {
        let turn = self.turn.lock().unwrap_or_else(PoisonError::into_inner).clone();
        let turn = turn.ok_or_else(|| "Codex has no turn running.".to_string())?;
        self.rpc.call("turn/interrupt", json!({ "threadId": self.thread, "turnId": turn })).await.map(|_| ())
    }

    pub(crate) fn answer(&mut self, request: &str, answer: ApprovalAnswer) -> Result<(), String> {
        let pending = self
            .approvals
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(request)
            .ok_or_else(|| "That approval is no longer pending.".to_string())?;
        let decision = match (answer, pending.legacy) {
            (ApprovalAnswer::Approve, false) => "accept",
            (ApprovalAnswer::AlwaysAllowSession, false) => "acceptForSession",
            (ApprovalAnswer::Deny, false) => "decline",
            (ApprovalAnswer::Approve, true) => "approved",
            (ApprovalAnswer::AlwaysAllowSession, true) => "approved_for_session",
            (ApprovalAnswer::Deny, true) => "denied",
        };
        self.rpc.respond(&pending.id, &json!({ "decision": decision }))
    }

    pub(crate) fn set_access(&mut self, access: AccessMode) {
        self.access = access;
    }

    pub(crate) fn set_model(&mut self, model: &str) {
        self.model = Some(model.to_string());
    }

    pub(crate) fn set_effort(&mut self, effort: &str) {
        self.effort = Some(effort.to_string());
    }

    pub(crate) async fn rename(&mut self, title: &str) -> Result<(), String> {
        self.rpc.call("thread/name/set", json!({ "threadId": self.thread, "name": title })).await.map(|_| ())
    }

    pub(crate) async fn compact(&mut self) -> Result<(), String> {
        self.rpc.call("thread/compact/start", json!({ "threadId": self.thread })).await.map(|_| ())
    }

    pub(crate) fn kill(&mut self) {
        if let Some(kill) = self.kill.take() {
            kill.send(()).ok();
        }
    }
}

impl Drop for Codex {
    fn drop(&mut self) {
        self.kill();
    }
}

struct Live {
    kind: String,
    text: String,
    started: u64,
}

struct Translator {
    sink: Sink,
    rpc: Rpc,
    approvals: Arc<Mutex<HashMap<String, PendingApproval>>>,
    turn: Arc<Mutex<Option<String>>>,
    busy: bool,
    model: String,
    items: HashMap<String, Live>,
    commands: HashMap<String, String>,
    failure: Option<String>,
    total: Option<Spend>,
    stopped: bool,
}

impl Translator {
    fn new(
        sink: Sink,
        rpc: Rpc,
        approvals: Arc<Mutex<HashMap<String, PendingApproval>>>,
        turn: Arc<Mutex<Option<String>>>,
    ) -> Self {
        Self {
            sink,
            rpc,
            approvals,
            turn,
            busy: false,
            model: String::new(),
            items: HashMap::new(),
            commands: HashMap::new(),
            failure: None,
            total: None,
            stopped: false,
        }
    }

    fn begin(&mut self) {
        if !self.busy {
            self.busy = true;
            self.failure = None;
            self.sink.session(SessionEvent::AgentStart);
        }
    }

    fn end(&mut self, error: Option<String>) {
        *self.turn.lock().unwrap_or_else(PoisonError::into_inner) = None;
        if !self.busy {
            return;
        }
        self.busy = false;
        self.items.clear();
        self.sink.session(SessionEvent::TurnEnd { answer: None, error });
        self.sink.session(SessionEvent::AgentEnd { messages: Vec::new() });
    }

    fn stop(&mut self, reason: String) {
        if self.stopped {
            return;
        }
        self.stopped = true;
        if let Some(message) = notice(&reason, now_ms()) {
            emit_message(&self.sink, message);
        }
        self.end(Some(reason.clone()));
        self.sink.send(Event::Stopped(reason));
    }

    fn finish(&mut self) {
        self.end(None);
    }

    fn message(&self, kind: &str, text: &str, stop: &str, at: u64) -> Option<AgentMessage> {
        let block = if kind == "reasoning" {
            json!({ "type": "thinking", "thinking": text })
        } else {
            json!({ "type": "text", "text": text })
        };
        assistant(CODEX_PROVIDER, &self.model, &[block], &Spend::default(), stop, None, at)
    }

    fn notification(&mut self, method: &str, params: &Value) {
        let item = params.get("item");
        let text = |value: Option<&Value>, key: &str| {
            value.and_then(|value| value.get(key)).and_then(Value::as_str).unwrap_or_default().to_string()
        };
        match method {
            "turn/started" => {
                if let Some(id) = params.get("turn").and_then(|turn| turn.get("id")).and_then(Value::as_str) {
                    *self.turn.lock().unwrap_or_else(PoisonError::into_inner) = Some(id.to_string());
                }
                self.begin();
            }
            "turn/completed" => {
                let turn = params.get("turn");
                let status = text(turn, "status");
                let error = turn.and_then(|turn| turn.get("error")).filter(|error| !error.is_null()).map(|error| {
                    error.get("message").and_then(Value::as_str).map_or_else(|| error.to_string(), str::to_string)
                });
                let failure = if status == "failed" {
                    let reason = error
                        .or_else(|| self.failure.take())
                        .unwrap_or_else(|| "Codex ended the turn with an error.".to_string());
                    if let Some(stop) = stop_reason(&reason) {
                        self.stop(stop);
                        return;
                    }
                    Some(reason)
                } else {
                    None
                };
                self.end(failure);
            }
            "item/started" => self.item_started(item),
            "item/completed" => self.item_completed(item),
            "item/agentMessage/delta" | "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" => {
                let id = text(Some(params), "itemId");
                let delta = text(Some(params), "delta");
                let Some(live) = self.items.get_mut(&id) else { return };
                live.text.push_str(&delta);
                let (kind, current, started) = (live.kind.clone(), live.text.clone(), live.started);
                let update = if kind == "reasoning" {
                    StreamUpdate::ThinkingDelta { delta }
                } else {
                    StreamUpdate::TextDelta { delta }
                };
                if let Some(message) = self.message(&kind, &current, "stop", started) {
                    self.sink.session(SessionEvent::MessageUpdate {
                        message,
                        assistant_message_event: update,
                        output_tokens: None,
                    });
                }
            }
            "item/commandExecution/outputDelta" => {
                let id = text(Some(params), "itemId");
                let Some(live) = self.items.get_mut(&id) else { return };
                live.text.push_str(&text(Some(params), "delta"));
                let current = live.text.clone();
                self.sink.session(SessionEvent::ToolExecutionUpdate {
                    tool_call_id: id,
                    tool_name: "bash".to_string(),
                    args: Value::Null,
                    partial_result: output(&current),
                });
            }
            "thread/tokenUsage/updated" => self.usage(params.get("tokenUsage")),
            "error" => {
                let message = params
                    .get("error")
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("Codex reported an error.")
                    .to_string();
                if params.get("willRetry").and_then(Value::as_bool) == Some(true) {
                    return;
                }
                if let Some(reason) = stop_reason(&message) {
                    self.stop(reason);
                    return;
                }
                self.failure = Some(message);
            }
            _ => {}
        }
    }

    fn item_started(&mut self, item: Option<&Value>) {
        let Some(item) = item else { return };
        let id = item.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
        let at = now_ms();
        match item.get("type").and_then(Value::as_str).unwrap_or_default() {
            "userMessage" => {
                self.begin();
                if let Some(message) = user(&user_text(item), at) {
                    emit_message(&self.sink, message);
                }
            }
            kind @ ("agentMessage" | "reasoning") => {
                self.begin();
                self.items.insert(id, Live { kind: kind.to_string(), text: String::new(), started: at });
                if let Some(message) = self.message(kind, "", "stop", at) {
                    self.sink.session(SessionEvent::MessageStart {
                        message,
                        assistant_message_event: Some(StreamUpdate::Start),
                    });
                }
            }
            kind => {
                let Some((name, arguments)) = tool_call(kind, item) else { return };
                self.begin();
                if kind == "commandExecution" {
                    self.commands.insert(id.clone(), arguments["command"].as_str().unwrap_or_default().to_string());
                }
                self.items.insert(id.clone(), Live { kind: kind.to_string(), text: String::new(), started: at });
                let block = json!({ "type": "toolCall", "id": id, "name": name, "arguments": arguments });
                if let Some(message) =
                    assistant(CODEX_PROVIDER, &self.model, &[block], &Spend::default(), "toolUse", None, at)
                {
                    emit_message(&self.sink, message);
                }
                self.sink.session(SessionEvent::ToolExecutionStart {
                    tool_call_id: id,
                    tool_name: name,
                    args: arguments,
                });
            }
        }
    }

    fn item_completed(&mut self, item: Option<&Value>) {
        let Some(item) = item else { return };
        let id = item.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
        let live = self.items.remove(&id);
        let at = now_ms();
        match item.get("type").and_then(Value::as_str).unwrap_or_default() {
            "userMessage" => {}
            "agentMessage" => {
                let text = item.get("text").and_then(Value::as_str).unwrap_or_default();
                if let Some(message) = self.message("agentMessage", text, "stop", live.map_or(at, |live| live.started))
                {
                    self.sink.session(SessionEvent::MessageEnd { message });
                }
            }
            "reasoning" => {
                let summary = reasoning_text(item);
                let text = if summary.is_empty() {
                    live.as_ref().map(|live| live.text.clone()).unwrap_or_default()
                } else {
                    summary
                };
                if let Some(message) = self.message("reasoning", &text, "stop", live.map_or(at, |live| live.started)) {
                    self.sink.session(SessionEvent::MessageEnd { message });
                }
            }
            kind => {
                let Some((name, _)) = tool_call(kind, item) else { return };
                let status = item.get("status").and_then(Value::as_str).unwrap_or_default();
                let (text, details, failed) = tool_outcome(kind, item, live.map(|live| live.text));
                let error = failed || matches!(status, "failed" | "declined");
                if let Some(message) = tool_result(&id, &name, &text, details, error, at) {
                    emit_message(&self.sink, message);
                }
            }
        }
    }

    fn request(&mut self, id: &Value, method: &str, params: &Value) {
        let text = |key: &str| params.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
        let (summary, effect, legacy) = match method {
            "item/commandExecution/requestApproval" => {
                let command = params
                    .get("command")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| self.commands.get(&text("itemId")).cloned())
                    .unwrap_or_default();
                (format!("Run: {command}"), "exec", false)
            }
            "item/fileChange/requestApproval" => {
                let reason = text("reason");
                (
                    if reason.is_empty() { "Change files".to_string() } else { format!("Change files: {reason}") },
                    "write",
                    false,
                )
            }
            "execCommandApproval" => {
                let command = params
                    .get("command")
                    .and_then(Value::as_array)
                    .map(|parts| parts.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" "))
                    .unwrap_or_default();
                (format!("Run: {command}"), "exec", true)
            }
            "applyPatchApproval" => ("Change files".to_string(), "write", true),
            _ => {
                self.rpc.refuse(id, "Local Studio does not handle this request.");
                return;
            }
        };
        let request = match id {
            Value::String(id) => id.clone(),
            other => other.to_string(),
        };
        self.approvals
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(request.clone(), PendingApproval { id: id.clone(), legacy });
        self.sink.send(Event::Approval(Approval {
            request_id: request,
            step: 0,
            command: summary,
            effects: vec![effect.to_string()],
            agent: None,
        }));
    }

    fn usage(&mut self, usage: Option<&Value>) {
        let Some(usage) = usage else { return };
        let read = |value: Option<&Value>| {
            let number = |key: &str| value.and_then(|value| value.get(key)).and_then(Value::as_u64).unwrap_or(0);
            let cached = number("cachedInputTokens");
            Spend {
                model: String::new(),
                input: number("inputTokens").saturating_sub(cached),
                cache_read: cached,
                cache_write: 0,
                output: number("outputTokens"),
                cost: 0.0,
            }
        };
        let total = read(usage.get("total"));
        let last = read(usage.get("last"));
        let delta = match self.total.replace(total.clone()) {
            Some(before) => Spend {
                model: String::new(),
                input: total.input.saturating_sub(before.input),
                cache_read: total.cache_read.saturating_sub(before.cache_read),
                cache_write: 0,
                output: total.output.saturating_sub(before.output),
                cost: 0.0,
            },
            None => last.clone(),
        };
        if delta.input + delta.cache_read + delta.output > 0 {
            self.sink.send(Event::Usage(Spend { model: self.model.clone(), ..delta }));
        }
        let window = usage.get("modelContextWindow").and_then(Value::as_u64).unwrap_or(CONTEXT_WINDOW);
        let tokens = last.input + last.cache_read + last.output;
        if tokens > 0 {
            self.sink.send(Event::Context(ContextUsage { tokens, window }));
        }
    }
}

fn user_text(item: &Value) -> Value {
    let text: Vec<&str> = item
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect();
    Value::String(text.join("\n"))
}

fn reasoning_text(item: &Value) -> String {
    let parts = |key: &str| -> Vec<String> {
        item.get(key)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|part| {
                part.as_str()
                    .map(str::to_string)
                    .or_else(|| part.get("text").and_then(Value::as_str).map(str::to_string))
            })
            .collect()
    };
    let summary = parts("summary");
    if summary.is_empty() {
        parts("content").join("\n")
    } else {
        summary.join("\n")
    }
}

fn tool_call(kind: &str, item: &Value) -> Option<(String, Value)> {
    match kind {
        "commandExecution" => {
            let command = item.get("command").cloned().unwrap_or_default();
            Some((
                "bash".to_string(),
                json!({ "command": command, "cwd": item.get("cwd").cloned().unwrap_or_default() }),
            ))
        }
        "fileChange" => {
            let paths: Vec<Value> = item
                .get("changes")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|change| change.get("path").cloned())
                .collect();
            let path = paths.first().cloned().unwrap_or_default();
            Some(("edit".to_string(), json!({ "path": path, "paths": paths })))
        }
        "mcpToolCall" => {
            let server = item.get("server").and_then(Value::as_str).unwrap_or_default();
            let tool = item.get("tool").and_then(Value::as_str).unwrap_or_default();
            Some((format!("{server}.{tool}"), item.get("arguments").cloned().unwrap_or_else(|| json!({}))))
        }
        "dynamicToolCall" => Some((
            item.get("tool").and_then(Value::as_str).unwrap_or("tool").to_string(),
            item.get("arguments").cloned().unwrap_or_else(|| json!({})),
        )),
        "webSearch" => {
            Some(("web_search".to_string(), json!({ "query": item.get("query").cloned().unwrap_or_default() })))
        }
        _ => None,
    }
}

fn tool_outcome(kind: &str, item: &Value, streamed: Option<String>) -> (String, Option<Value>, bool) {
    match kind {
        "commandExecution" => {
            let text = item
                .get("aggregatedOutput")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or(streamed)
                .unwrap_or_default();
            let failed = item.get("exitCode").and_then(Value::as_i64).is_some_and(|code| code != 0);
            (text, None, failed)
        }
        "fileChange" => {
            let changes = item.get("changes").and_then(Value::as_array).cloned().unwrap_or_default();
            let files: Vec<Value> = changes
                .iter()
                .map(|change| {
                    let path = change.get("path").and_then(Value::as_str).unwrap_or_default();
                    json!({ "path": path, "absolute": path, "diff": change.get("diff").and_then(Value::as_str).unwrap_or_default() })
                })
                .collect();
            let names: Vec<&str> =
                changes.iter().filter_map(|change| change.get("path").and_then(Value::as_str)).collect();
            let details = match files.as_slice() {
                [only] => Some(diff_details(
                    only["path"].as_str().unwrap_or_default(),
                    only["diff"].as_str().unwrap_or_default(),
                )),
                [] => None,
                _ => Some(json!({ "files": files })),
            };
            (names.join("\n"), details, false)
        }
        "mcpToolCall" => {
            let error = item.get("error").filter(|error| !error.is_null());
            let text =
                error.map(Value::to_string).or_else(|| item.get("result").map(Value::to_string)).unwrap_or_default();
            (text, None, error.is_some())
        }
        "dynamicToolCall" => {
            let text = item.get("contentItems").map(Value::to_string).unwrap_or_default();
            (text, None, item.get("success").and_then(Value::as_bool) == Some(false))
        }
        _ => (String::new(), None, false),
    }
}

fn history(thread: &Value) -> Vec<AgentMessage> {
    let mut messages = Vec::new();
    for turn in thread.get("turns").and_then(Value::as_array).into_iter().flatten() {
        let at =
            turn.get("startedAt")
                .and_then(Value::as_u64)
                .map_or(0, |at| if at < 10_000_000_000 { at * 1000 } else { at });
        for item in turn.get("items").and_then(Value::as_array).into_iter().flatten() {
            let id = item.get("id").and_then(Value::as_str).unwrap_or_default();
            let kind = item.get("type").and_then(Value::as_str).unwrap_or_default();
            match kind {
                "userMessage" => messages.extend(user(&user_text(item), at)),
                "agentMessage" => {
                    let block = json!({ "type": "text", "text": item.get("text").cloned().unwrap_or_default() });
                    messages.extend(assistant(CODEX_PROVIDER, "", &[block], &Spend::default(), "stop", None, at));
                }
                "reasoning" => {
                    let text = reasoning_text(item);
                    if !text.is_empty() {
                        let block = json!({ "type": "thinking", "thinking": text });
                        messages.extend(assistant(CODEX_PROVIDER, "", &[block], &Spend::default(), "stop", None, at));
                    }
                }
                _ => {
                    let Some((name, arguments)) = tool_call(kind, item) else { continue };
                    let block = json!({ "type": "toolCall", "id": id, "name": name, "arguments": arguments });
                    messages.extend(assistant(CODEX_PROVIDER, "", &[block], &Spend::default(), "toolUse", None, at));
                    let status = item.get("status").and_then(Value::as_str).unwrap_or_default();
                    let (text, details, failed) = tool_outcome(kind, item, None);
                    let error = failed || matches!(status, "failed" | "declined");
                    messages.extend(tool_result(id, &name, &text, details, error, at));
                }
            }
        }
    }
    messages
}
