use iroh::endpoint::{ReadExactError, RecvStream, SendStream};
use serde::{Deserialize, Serialize};
use std::fmt;

pub const ALPN: &[u8] = b"alleycat/1";
pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_FRAME_BYTES: u32 = 1_048_576;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    ListAgents { v: u32, token: String },
    RestartAgent { v: u32, token: String, agent: String },
    Connect {
        v: u32,
        token: String,
        agent: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resume: Option<Resume>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resume {
    pub last_seq: u64,
}

impl Request {
    pub fn version(&self) -> u32 {
        match self {
            Self::ListAgents { v, .. } | Self::RestartAgent { v, .. } | Self::Connect { v, .. } => {
                *v
            }
        }
    }

    pub fn token(&self) -> &str {
        match self {
            Self::ListAgents { token, .. }
            | Self::RestartAgent { token, .. }
            | Self::Connect { token, .. } => token,
        }
    }

    pub fn op_name(&self) -> &'static str {
        match self {
            Self::ListAgents { .. } => "list_agents",
            Self::RestartAgent { .. } => "restart_agent",
            Self::Connect { .. } => "connect",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Response {
    pub v: u32,
    pub ok: bool,
    #[serde(default)]
    pub agents: Vec<AgentInfoWire>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session: Option<SessionInfoWire>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Response {
    pub fn error(message: impl Into<String>) -> Self {
        Self {
            v: PROTOCOL_VERSION,
            ok: false,
            agents: Vec::new(),
            session: None,
            error: Some(message.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentInfoWire {
    pub name: String,
    pub display_name: String,
    pub wire: WireKind,
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presentation: Option<AgentPresentationWire>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<AgentCapabilitiesWire>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WireKind {
    Websocket,
    Jsonl,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentPresentationWire {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default)]
    pub is_beta: bool,
    #[serde(default)]
    pub sort_order: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentCapabilitiesWire {
    #[serde(default)]
    pub locks_reasoning_effort_after_activity: bool,
    #[serde(default)]
    pub visible_modes: Option<Vec<String>>,
    #[serde(default)]
    pub supports_ssh_bridge: bool,
    #[serde(default)]
    pub uses_direct_codex_port: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_thread_permission_overrides: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reports_effective_thread_permissions: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionInfoWire {
    pub attached: AttachKindWire,
    pub current_seq: u64,
    pub floor_seq: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AttachKindWire {
    Fresh,
    Resumed,
    DriftReload,
}

#[derive(Debug)]
pub enum FrameError {
    Eof,
    Read(String),
    Write(String),
    TooLarge,
}

impl fmt::Display for FrameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Eof => write!(f, "stream ended between frames"),
            Self::Read(error) => write!(f, "read: {error}"),
            Self::Write(error) => write!(f, "write: {error}"),
            Self::TooLarge => write!(f, "frame exceeds {} bytes", MAX_FRAME_BYTES),
        }
    }
}

pub async fn read_frame(stream: &mut RecvStream) -> Result<Vec<u8>, FrameError> {
    let mut prefix = [0u8; 4];
    match stream.read_exact(&mut prefix).await {
        Ok(()) => {}
        Err(ReadExactError::FinishedEarly(0)) => return Err(FrameError::Eof),
        Err(error) => return Err(FrameError::Read(error.to_string())),
    }
    let length = u32::from_be_bytes(prefix);
    if length > MAX_FRAME_BYTES {
        return Err(FrameError::TooLarge);
    }
    let mut payload = vec![0u8; length as usize];
    stream
        .read_exact(&mut payload)
        .await
        .map_err(|error| FrameError::Read(error.to_string()))?;
    Ok(payload)
}

pub async fn write_frame(stream: &mut SendStream, payload: &[u8]) -> Result<(), FrameError> {
    let prefix = (payload.len() as u32).to_be_bytes();
    stream
        .write_all(&prefix)
        .await
        .map_err(|error| FrameError::Write(error.to_string()))?;
    stream
        .write_all(payload)
        .await
        .map_err(|error| FrameError::Write(error.to_string()))?;
    Ok(())
}

#[derive(Default)]
pub struct LineReader {
    buffer: Vec<u8>,
}

impl LineReader {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn next_line(&mut self, stream: &mut RecvStream) -> Option<Vec<u8>> {
        loop {
            if let Some(position) = self.buffer.iter().position(|&byte| byte == b'\n') {
                let mut line = self.buffer.drain(..position).collect::<Vec<u8>>();
                self.buffer.remove(0);
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                return Some(line);
            }
            let mut chunk = [0u8; 8192];
            match stream.read(&mut chunk).await {
                Ok(Some(n)) => self.buffer.extend_from_slice(&chunk[..n]),
                _ => return None,
            }
        }
    }
}

pub fn hex_encode(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

pub fn hex_decode_32(text: &str) -> Result<[u8; 32], String> {
    let text = text.trim();
    if text.len() != 64 {
        return Err(format!("expected 64 hex characters, got {}", text.len()));
    }
    let mut out = [0u8; 32];
    for (index, chunk) in text.as_bytes().chunks_exact(2).enumerate() {
        let high = hex_value(chunk[0])?;
        let low = hex_value(chunk[1])?;
        out[index] = high << 4 | low;
    }
    Ok(out)
}

fn hex_value(byte: u8) -> Result<u8, String> {
    match byte {
        b'0'..=b'9' => Ok(byte - b'0'),
        b'a'..=b'f' => Ok(byte - b'a' + 10),
        b'A'..=b'F' => Ok(byte - b'A' + 10),
        _ => Err(format!("invalid hex character {}", byte as char)),
    }
}
