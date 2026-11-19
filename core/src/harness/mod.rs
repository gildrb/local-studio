mod claude;
mod codex;

use std::fmt::Write as _;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};

use eukhe_types::daemon::{SessionEvent, StreamUpdate, ToolOutput};
use eukhe_types::session::AgentMessage;
use serde_json::{json, Value};
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::model::{AccessMode, Approval, ApprovalAnswer, ContextUsage, Harness, ModelOption};

pub(crate) use claude::session_exists as claude_session_exists;

pub(crate) const CLAUDE_PROVIDER: &str = "claude-code";
pub(crate) const CODEX_PROVIDER: &str = "codex";
const STRIPPED_ENV: [&str; 5] =
    ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"];
const STOP_WORDS: [&str; 16] = [
    "please run /login",
    "/login",
    "not logged in",
    "log in again",
    "sign in again",
    "authentication_error",
    "authentication failed",
    "invalid api key",
    "oauth token",
    "refresh token",
    "unauthorized",
    "credit balance",
    "billing",
    "usage limit",
    "quota",
    "out of extra usage",
];

pub(crate) enum Event {
    Session(Box<SessionEvent>),
    Approval(Approval),
    ApprovalSettled(String),
    Context(ContextUsage),
    Model(String),
    Usage(Spend),
    Stopped(String),
    Exited(Option<String>),
}

pub(crate) struct Envelope {
    pub(crate) thread: String,
    pub(crate) generation: u64,
    pub(crate) event: Event,
}

#[derive(Clone)]
pub(crate) struct Sink {
    thread: String,
    generation: u64,
    sender: mpsc::UnboundedSender<Envelope>,
}

impl Sink {
    pub(crate) fn new(thread: &str, generation: u64, sender: mpsc::UnboundedSender<Envelope>) -> Self {
        Self { thread: thread.to_string(), generation, sender }
    }

    fn send(&self, event: Event) {
        self.sender.send(Envelope { thread: self.thread.clone(), generation: self.generation, event }).ok();
    }

    fn session(&self, event: SessionEvent) {
        self.send(Event::Session(Box::new(event)));
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Spend {
    pub(crate) model: String,
    pub(crate) input: u64,
    pub(crate) cache_read: u64,
    pub(crate) cache_write: u64,
    pub(crate) output: u64,
    pub(crate) cost: f64,
}

#[derive(Clone)]
pub(crate) struct Launch {
    pub(crate) harness: Harness,
    pub(crate) native: String,
    pub(crate) resume: bool,
    pub(crate) cwd: String,
    pub(crate) model: Option<String>,
    pub(crate) effort: Option<String>,
    pub(crate) access: AccessMode,
}

pub(crate) struct Image {
    pub(crate) mime_type: String,
    pub(crate) data: String,
}

pub(crate) enum Driver {
    Claude(claude::Claude),
    Codex(codex::Codex),
}

pub(crate) struct Opened {
    pub(crate) driver: Driver,
    pub(crate) native: String,
    pub(crate) history: Vec<AgentMessage>,
}

impl Driver {
    pub(crate) async fn open(launch: Launch, sink: Sink) -> Result<Opened, String> {
        match launch.harness {
            Harness::ClaudeCode => {
                let native = launch.native.clone();
                let history = if launch.resume { claude::history(&launch.cwd, &native) } else { Vec::new() };
                let driver = claude::Claude::spawn(&launch, sink)?;
                Ok(Opened { driver: Self::Claude(driver), native, history })
            }
            Harness::Codex => {
                let (driver, native, history) = codex::Codex::spawn(&launch, sink).await?;
                Ok(Opened { driver: Self::Codex(driver), native, history })
            }
            Harness::Eukhe => Err("Eukhe threads run in the Eukhe daemon.".to_string()),
        }
    }

    pub(crate) async fn send(&mut self, text: &str, images: Vec<Image>, steer: bool) -> Result<(), String> {
        match self {
            Self::Claude(driver) => driver.send(text, &images),
            Self::Codex(driver) => driver.send(text, &images, steer).await,
        }
    }

    pub(crate) async fn interrupt(&mut self) -> Result<(), String> {
        match self {
            Self::Claude(driver) => driver.interrupt(),
            Self::Codex(driver) => driver.interrupt().await,
        }
    }

    pub(crate) fn answer(&mut self, request: &str, answer: ApprovalAnswer) -> Result<(), String> {
        match self {
            Self::Claude(driver) => driver.answer(request, answer),
            Self::Codex(driver) => driver.answer(request, answer),
        }
    }

    pub(crate) fn set_access(&mut self, access: AccessMode) -> Result<(), String> {
        match self {
            Self::Claude(driver) => driver.set_access(access),
            Self::Codex(driver) => {
                driver.set_access(access);
                Ok(())
            }
        }
    }

    pub(crate) fn set_model(&mut self, model: &str) -> Result<(), String> {
        match self {
            Self::Claude(driver) => driver.set_model(model),
            Self::Codex(driver) => {
                driver.set_model(model);
                Ok(())
            }
        }
    }

    pub(crate) fn set_effort(&mut self, effort: &str) -> Result<(), String> {
        match self {
            Self::Claude(_) => Err("Claude Code takes its effort level when the thread opens; it applies after the next restart of the thread.".to_string()),
            Self::Codex(driver) => {
                driver.set_effort(effort);
                Ok(())
            }
        }
    }

    pub(crate) async fn rename(&mut self, title: &str) -> Result<(), String> {
        match self {
            Self::Claude(_) => Ok(()),
            Self::Codex(driver) => driver.rename(title).await,
        }
    }

    pub(crate) async fn compact(&mut self) -> Result<(), String> {
        match self {
            Self::Claude(driver) => driver.send("/compact", &[]),
            Self::Codex(driver) => driver.compact().await,
        }
    }

    pub(crate) fn kill(&mut self) {
        match self {
            Self::Claude(driver) => driver.kill(),
            Self::Codex(driver) => driver.kill(),
        }
    }
}

pub(crate) fn models(harness: Harness) -> Vec<ModelOption> {
    match harness {
        Harness::ClaudeCode => claude::models(),
        Harness::Codex | Harness::Eukhe => Vec::new(),
    }
}

pub(crate) async fn codex_models() -> Result<Vec<ModelOption>, String> {
    codex::models().await
}

pub(crate) fn usage_ledger(data_dir: &Path) -> PathBuf {
    data_dir.join("harness").join("usage.jsonl")
}

pub(crate) fn record_usage(data_dir: &Path, thread: &str, harness: Harness, spend: &Spend) -> Result<(), String> {
    let path = usage_ledger(data_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("create {}: {error}", parent.display()))?;
    }
    let line = json!({
        "at": i64::try_from(now_ms()).unwrap_or(i64::MAX),
        "provider": provider_of(harness),
        "model": spend.model,
        "thread": thread,
        "input": spend.input,
        "cacheRead": spend.cache_read,
        "cacheWrite": spend.cache_write,
        "output": spend.output,
        "cost": spend.cost,
    });
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("open {}: {error}", path.display()))?;
    writeln!(file, "{line}").map_err(|error| format!("write {}: {error}", path.display()))
}

pub(crate) fn harness_of(provider: &str) -> Harness {
    match provider {
        CLAUDE_PROVIDER => Harness::ClaudeCode,
        CODEX_PROVIDER => Harness::Codex,
        _ => Harness::Eukhe,
    }
}

pub(crate) fn provider_of(harness: Harness) -> &'static str {
    match harness {
        Harness::ClaudeCode => CLAUDE_PROVIDER,
        Harness::Codex => CODEX_PROVIDER,
        Harness::Eukhe => "",
    }
}

pub(crate) fn new_session_id() -> String {
    let mut bytes = [0_u8; 16];
    let filled = std::fs::File::open("/dev/urandom")
        .and_then(|mut file| std::io::Read::read_exact(&mut file, &mut bytes))
        .is_ok();
    if !filled {
        let seed = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_nanos());
        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = u8::try_from((seed >> ((index % 16) * 8)) & 0xff).unwrap_or(0) ^ u8::try_from(index).unwrap_or(0);
        }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex = bytes.iter().fold(String::new(), |mut hex, byte| {
        write!(hex, "{byte:02x}").ok();
        hex
    });
    format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
}

fn program(variable: &str, name: &str) -> PathBuf {
    std::env::var_os(variable).filter(|value| !value.is_empty()).map_or_else(|| PathBuf::from(name), PathBuf::from)
}

fn command(program: &PathBuf, cwd: &str) -> Command {
    let mut command = Command::new(program);
    command.current_dir(cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    for name in STRIPPED_ENV {
        command.env_remove(name);
    }
    command
}

fn stop_reason(text: &str) -> Option<String> {
    let text = plain(text);
    let lower = text.to_ascii_lowercase();
    if !STOP_WORDS.iter().any(|word| lower.contains(word)) {
        return None;
    }
    let message = ["ERROR ", "WARN "]
        .iter()
        .find_map(|level| text.split_once(level))
        .map_or(text.as_str(), |(_, rest)| rest.split_once(": ").map_or(rest, |(_, message)| message));
    Some(message.trim().trim_end_matches('.').to_string())
}

fn plain(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(next) = chars.next() {
        if next != '\u{1b}' {
            out.push(next);
            continue;
        }
        if chars.next_if_eq(&'[').is_some() {
            for code in chars.by_ref() {
                if code.is_ascii_alphabetic() {
                    break;
                }
            }
        }
    }
    out
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(0))
}

fn usage_json(spend: &Spend) -> Value {
    json!({
        "input": spend.input,
        "output": spend.output,
        "cacheRead": spend.cache_read,
        "cacheWrite": spend.cache_write,
        "totalTokens": spend.input + spend.output + spend.cache_read + spend.cache_write,
        "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": spend.cost },
    })
}

fn assistant(
    provider: &str,
    model: &str,
    blocks: &[Value],
    spend: &Spend,
    stop: &str,
    error: Option<&str>,
    timestamp: u64,
) -> Option<AgentMessage> {
    let mut message = json!({
        "role": "assistant",
        "content": blocks,
        "api": provider,
        "provider": provider,
        "model": model,
        "usage": usage_json(spend),
        "stopReason": stop,
        "timestamp": timestamp,
    });
    if let Some(error) = error {
        message["errorMessage"] = Value::String(error.to_string());
    }
    serde_json::from_value(message).ok()
}

fn user(content: &Value, timestamp: u64) -> Option<AgentMessage> {
    serde_json::from_value(json!({ "role": "user", "content": content, "timestamp": timestamp })).ok()
}

fn tool_result(
    call: &str,
    name: &str,
    text: &str,
    details: Option<Value>,
    error: bool,
    timestamp: u64,
) -> Option<AgentMessage> {
    let mut message = json!({
        "role": "toolResult",
        "toolCallId": call,
        "toolName": name,
        "content": [{ "type": "text", "text": text }],
        "isError": error,
        "timestamp": timestamp,
    });
    if let Some(details) = details {
        message["details"] = details;
    }
    serde_json::from_value(message).ok()
}

fn notice(text: &str, timestamp: u64) -> Option<AgentMessage> {
    serde_json::from_value(json!({
        "role": "custom",
        "customType": "harness",
        "content": text,
        "display": true,
        "timestamp": timestamp,
    }))
    .ok()
}

fn output(text: &str) -> ToolOutput {
    ToolOutput {
        content: serde_json::from_value(json!([{ "type": "text", "text": text }])).unwrap_or_default(),
        details: None,
    }
}

fn emit_message(sink: &Sink, message: AgentMessage) {
    let stream = matches!(message, AgentMessage::Assistant(_)).then_some(StreamUpdate::Start);
    sink.session(SessionEvent::MessageStart { message: message.clone(), assistant_message_event: stream });
    sink.session(SessionEvent::MessageEnd { message });
}

fn diff_details(path: &str, diff: &str) -> Value {
    json!({ "files": [{ "path": path, "absolute": path, "diff": diff }] })
}
