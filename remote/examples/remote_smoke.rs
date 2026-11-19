use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use anyhow::{bail, ensure, Context};
use base64::Engine;
use eukhe_client::daemon_client::DaemonClient;
use eukhe_types::daemon::DaemonCommand;
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use local_studio_core::{
    AccessMode, Approval, Connection, DaemonLaunch, Item, ItemKind, Studio, StudioConfig, ThreadRow, ThreadSettings,
    ThreadStatus, TranscriptOp, Update, UsagePeriod, UsageReport, Waker, WorktreeChoice,
};
use serde_json::{json, Map, Value};
use snow::TransportState;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Notify};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::{Error as SocketError, Message};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

const VERSION: &str = env!("LOCAL_STUDIO_BUILD_VERSION");
const CHANNEL: &str = env!("LOCAL_STUDIO_BUILD_CHANNEL");
const XX: &str = "Noise_XXpsk3_25519_ChaChaPoly_SHA256";
const KK: &str = "Noise_KK_25519_ChaChaPoly_SHA256";
const PROLOGUE: &[u8] = b"local-studio-remote/1\n";
const QUICK: Duration = Duration::from_secs(20);
const SETUP: Duration = Duration::from_secs(120);
const MODEL_STEP: Duration = Duration::from_mins(40);
const ABORT_BOUND: Duration = Duration::from_secs(20);
const PING_EVERY: Duration = Duration::from_secs(20);
const TUNNEL: &str = "tunnel.smoke.test";
/// The tunnel listener's port; `Route::tunnel` connects there (docs/remote.md: one listener per route).
static TUNNEL_PORT: OnceLock<u16> = OnceLock::new();
const ONCE_TEXT: &str = "Reply with only the word once.";
const SLEEP_COMMAND: &str = "sleep 60 && echo slept";
const UPDATE_TYPES: [&str; 28] = [
    "connection",
    "projects",
    "threads",
    "thread_started",
    "models",
    "daemon_default",
    "notification",
    "theme",
    "notice",
    "request_done",
    "request_failed",
    "thread",
    "transcript",
    "approvals",
    "questions",
    "questions_settled",
    "queue",
    "subagents",
    "worktree_setup",
    "thread_search",
    "archived_threads",
    "commands",
    "skills",
    "git_status",
    "diff",
    "pull_requests",
    "pull_request_detail",
    "blob",
];

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

fn bash_prompt(command: &str) -> String {
    format!("Use the bash tool to run exactly this command once: `{command}`. Then reply with only the word done.")
}

fn scheme() -> String {
    if CHANNEL == "stable" {
        "localstudio".to_string()
    } else {
        format!("localstudio-{CHANNEL}")
    }
}

fn prompt(text: &str) -> Value {
    json!({ "text": text, "images": [], "files": [] })
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut text, byte| {
        write!(text, "{byte:02x}").ok();
        text
    })
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 { (crc >> 1) ^ 0xedb8_8320 } else { crc >> 1 };
        }
    }
    !crc
}

fn png(size: u32) -> Vec<u8> {
    let mut raw = Vec::new();
    for y in 0..size {
        raw.push(0u8);
        for x in 0..size {
            let on = (x / 8 + y / 8) % 2 == 0;
            raw.extend_from_slice(if on { &[220, 40, 40] } else { &[250, 250, 250] });
        }
    }
    let mut zlib = vec![0x78, 0x01];
    let blocks: Vec<&[u8]> = raw.chunks(65_535).collect();
    for (at, block) in blocks.iter().enumerate() {
        zlib.push(u8::from(at + 1 == blocks.len()));
        let length = u16::try_from(block.len()).unwrap_or(u16::MAX);
        zlib.extend_from_slice(&length.to_le_bytes());
        zlib.extend_from_slice(&(!length).to_le_bytes());
        zlib.extend_from_slice(block);
    }
    let (mut a, mut b) = (1u32, 0u32);
    for byte in &raw {
        a = (a + u32::from(*byte)) % 65_521;
        b = (b + a) % 65_521;
    }
    zlib.extend_from_slice(&((b << 16) | a).to_be_bytes());
    let mut file = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut chunk = |kind: &[u8], data: &[u8]| {
        file.extend_from_slice(&u32::try_from(data.len()).unwrap_or_default().to_be_bytes());
        let mut body = kind.to_vec();
        body.extend_from_slice(data);
        file.extend_from_slice(&body);
        file.extend_from_slice(&crc32(&body).to_be_bytes());
    };
    let mut header = Vec::new();
    header.extend_from_slice(&size.to_be_bytes());
    header.extend_from_slice(&size.to_be_bytes());
    header.extend_from_slice(&[8, 2, 0, 0, 0]);
    chunk(b"IHDR", &header);
    chunk(b"IDAT", &zlib);
    chunk(b"IEND", &[]);
    file
}

struct Received {
    request: String,
    size: usize,
    mime: String,
    data: Vec<u8>,
    done: bool,
    extra: Value,
}

#[derive(Default)]
struct View {
    hello: Option<Value>,
    incompatible: Option<Value>,
    closed: bool,
    close_code: Option<u16>,
    broken: Option<String>,
    seq: u64,
    seq_gaps: u32,
    updates: u32,
    replies: HashMap<u64, Value>,
    named: HashMap<String, Value>,
    pongs: u32,
    kinds: HashSet<String>,
    connection: Option<Connection>,
    projects: Vec<String>,
    threads: Vec<ThreadRow>,
    started: HashMap<String, String>,
    items: HashMap<String, Vec<Item>>,
    earlier: HashMap<String, usize>,
    streamed: HashMap<String, Vec<ItemKind>>,
    transcript_frames: HashMap<String, u32>,
    thread_updates: HashMap<String, u32>,
    first_text_at: HashMap<String, Instant>,
    busy: HashMap<String, bool>,
    access: HashMap<String, AccessMode>,
    approvals: HashMap<String, Vec<Approval>>,
    answers: HashMap<String, String>,
    answer_counts: HashMap<String, u32>,
    models: u32,
    git_status: u32,
    notifications: u32,
    needs_approval: HashMap<String, u32>,
    blobs: HashMap<String, Received>,
}

impl View {
    fn items(&self, thread: &str) -> &[Item] {
        self.items.get(thread).map_or(&[], Vec::as_slice)
    }

    fn row(&self, thread: &str) -> Option<&ThreadRow> {
        self.threads.iter().find(|row| row.id == thread)
    }

    fn working(&self, thread: &str) -> bool {
        self.row(thread).is_some_and(|row| matches!(row.status, ThreadStatus::Working))
    }

    fn idle(&self, thread: &str) -> bool {
        !self.working(thread) && self.busy.get(thread) == Some(&false)
    }

    fn tools(&self, thread: &str) -> usize {
        self.items(thread).iter().filter(|item| matches!(&item.kind, ItemKind::Tool { .. })).count()
    }

    fn replies_done(&self, thread: &str) -> usize {
        self.items(thread)
            .iter()
            .filter(|item| matches!(&item.kind, ItemKind::Assistant { streaming: false, error: None, .. }))
            .count()
    }

    fn users_saying(&self, thread: &str, text: &str) -> usize {
        self.items(thread)
            .iter()
            .filter(|item| matches!(&item.kind, ItemKind::User { text: said, .. } if said.contains(text)))
            .count()
    }

    fn streamed(&self, thread: &str, kind: fn(&ItemKind) -> bool) -> bool {
        self.streamed.get(thread).is_some_and(|kinds| kinds.iter().any(kind))
    }

    fn apply_frame(&mut self, text: &str) -> anyhow::Result<()> {
        let frame: Value = serde_json::from_str(text).context("a frame is not JSON")?;
        match frame.get("op").and_then(Value::as_str) {
            Some("hello") => {
                self.seq = frame.get("seq").and_then(Value::as_u64).context("hello has no seq")?;
                for update in frame.get("snapshot").and_then(Value::as_array).context("hello has no snapshot")? {
                    self.apply_update(update)?;
                }
                self.hello = Some(frame);
            }
            Some("update") => {
                let seq = frame.get("seq").and_then(Value::as_u64).context("an update has no seq")?;
                if seq != self.seq + 1 {
                    self.seq_gaps += 1;
                }
                self.seq = seq;
                self.updates += 1;
                self.apply_update(frame.get("update").context("an update frame has no update")?)?;
            }
            Some("pong") => self.pongs += 1,
            _ => match frame.get("re") {
                Some(Value::String(name)) => {
                    self.named.insert(name.clone(), frame);
                }
                re => {
                    let id = re.and_then(Value::as_u64).with_context(|| format!("unexpected frame {text}"))?;
                    self.replies.insert(id, frame);
                }
            },
        }
        Ok(())
    }

    fn apply_update(&mut self, raw: &Value) -> anyhow::Result<()> {
        let kind = raw.get("type").and_then(Value::as_str).unwrap_or_default().to_string();
        ensure!(UPDATE_TYPES.contains(&kind.as_str()), "an update type outside the protocol 2 table: {kind}");
        self.kinds.insert(kind.clone());
        if ["thread", "transcript", "approvals", "queue", "subagents", "worktree_setup"].contains(&kind.as_str()) {
            if let Some(thread) = raw.get("thread").and_then(Value::as_str) {
                *self.thread_updates.entry(thread.to_string()).or_default() += 1;
            }
        }
        if kind == "blob" {
            let blob = raw.get("blob").and_then(Value::as_str).context("a blob update has no id")?.to_string();
            self.blobs.insert(
                blob,
                Received {
                    request: raw.get("request").and_then(Value::as_str).unwrap_or_default().to_string(),
                    size: raw
                        .get("size")
                        .and_then(Value::as_u64)
                        .and_then(|size| usize::try_from(size).ok())
                        .unwrap_or_default(),
                    mime: raw.get("mime").and_then(Value::as_str).unwrap_or_default().to_string(),
                    data: Vec::new(),
                    done: false,
                    extra: raw.clone(),
                },
            );
            return Ok(());
        }
        if let Some(request) = raw.get("request").and_then(Value::as_str) {
            self.answers.insert(request.to_string(), kind.clone());
            *self.answer_counts.entry(request.to_string()).or_default() += 1;
        }
        let update: Update = serde_json::from_value(raw.clone()).with_context(|| format!("decode update {raw}"))?;
        match update {
            Update::Connection { state } => self.connection = Some(state),
            Update::Projects { projects } => self.projects = projects.into_iter().map(|project| project.id).collect(),
            Update::Threads { threads } => self.threads = threads,
            Update::ThreadStarted { draft, thread } => {
                self.started.insert(draft, thread);
            }
            Update::Thread { thread, info } => {
                self.busy.insert(thread.clone(), info.busy);
                self.access.insert(thread, info.access);
            }
            Update::Transcript { thread, op } => {
                *self.transcript_frames.entry(thread.clone()).or_default() += 1;
                self.transcript(raw, &thread, op);
            }
            Update::Approvals { thread, approvals } => {
                self.approvals.insert(thread, approvals);
            }
            Update::Models { .. } => self.models += 1,
            Update::GitStatus { .. } => self.git_status += 1,
            Update::Notification { thread, kind, .. } => {
                self.notifications += 1;
                if matches!(kind, local_studio_core::NotificationKind::NeedsApproval) {
                    *self.needs_approval.entry(thread).or_default() += 1;
                }
            }
            Update::Notice { level, text } => println!("     notice {level:?}: {text}"),
            Update::RequestFailed { request, message } => println!("     request {request} failed: {message}"),
            _ => {}
        }
        Ok(())
    }

    fn chunk(&mut self, blob: &[u8], last: bool, data: &[u8]) -> anyhow::Result<()> {
        let received =
            self.blobs.get_mut(&hex(blob)).with_context(|| format!("a chunk for unknown blob {}", hex(blob)))?;
        ensure!(!received.done, "a chunk after blob {} was complete", hex(blob));
        received.data.extend_from_slice(data);
        ensure!(received.data.len() <= received.size, "blob {} is longer than announced", hex(blob));
        received.done = last;
        Ok(())
    }

    fn transcript(&mut self, raw: &Value, thread: &str, op: TranscriptOp) {
        match op {
            TranscriptOp::Reset { items } => {
                let earlier = raw.pointer("/op/earlier").and_then(Value::as_u64).unwrap_or_default();
                self.earlier.insert(thread.to_string(), usize::try_from(earlier).unwrap_or_default());
                self.items.insert(thread.to_string(), items);
            }
            TranscriptOp::Insert { index, item } | TranscriptOp::Update { index, item } => {
                let insert = raw.pointer("/op/type").and_then(Value::as_str) == Some("insert");
                if matches!(&item.kind, ItemKind::Assistant { .. }) {
                    self.first_text_at.entry(thread.to_string()).or_insert_with(Instant::now);
                }
                self.streamed.entry(thread.to_string()).or_default().push(item.kind.clone());
                let earlier = self.earlier.get(thread).copied().unwrap_or_default();
                let at = usize::try_from(index).unwrap_or(usize::MAX).saturating_sub(earlier);
                let items = self.items.entry(thread.to_string()).or_default();
                if insert {
                    items.insert(at.min(items.len()), item);
                } else if let Some(slot) = items.get_mut(at) {
                    *slot = item;
                }
            }
        }
    }
}

#[derive(Default, Clone)]
struct Route {
    tunnel: bool,
    host: Option<String>,
    origin: Option<String>,
    from: Option<String>,
    forwarded_host: Option<String>,
    login: Option<String>,
}

impl Route {
    fn tunnel(address: &str) -> Self {
        Self { tunnel: true, host: Some(TUNNEL.to_string()), from: Some(address.to_string()), ..Self::default() }
    }

    fn login(login: &str) -> Self {
        Self { login: Some(login.to_string()), ..Self::default() }
    }
}

fn tunnel_port() -> u16 {
    TUNNEL_PORT.get().copied().unwrap_or_default()
}

async fn connect(port: u16, route: &Route) -> anyhow::Result<Result<Socket, u16>> {
    let port = if route.tunnel { tunnel_port() } else { port };
    let mut request = format!("ws://127.0.0.1:{port}/v1/ws").into_client_request()?;
    for (name, value) in [
        ("host", &route.host),
        ("origin", &route.origin),
        ("cf-connecting-ip", &route.from),
        ("x-forwarded-host", &route.forwarded_host),
        ("tailscale-user-login", &route.login),
    ] {
        if let Some(value) = value {
            request.headers_mut().insert(name, HeaderValue::from_str(value)?);
        }
    }
    match tokio_tungstenite::connect_async(request).await {
        Ok((socket, _)) => Ok(Ok(socket)),
        Err(SocketError::Http(response)) => Ok(Err(response.status().as_u16())),
        Err(error) => Err(error.into()),
    }
}

enum Raw {
    Binary(Vec<u8>),
    Text(String),
    Closed(Option<u16>),
}

async fn raw_next(socket: &mut Socket, bound: Duration) -> anyhow::Result<Raw> {
    let deadline = Instant::now() + bound;
    loop {
        let left = deadline.checked_duration_since(Instant::now()).context("no message from the server in time")?;
        let message = tokio::time::timeout(left, socket.next()).await.context("no message from the server in time")?;
        return Ok(match message {
            Some(Ok(Message::Binary(bytes))) => Raw::Binary(bytes.to_vec()),
            Some(Ok(Message::Text(text))) => Raw::Text(text.to_string()),
            Some(Ok(Message::Close(frame))) => Raw::Closed(frame.map(|frame| u16::from(frame.code))),
            None | Some(Err(_)) => Raw::Closed(None),
            Some(Ok(_)) => continue,
        });
    }
}

fn header_text(pattern: &str, id_key: &str, id: &str, protocol: u64, min_protocol: u64) -> String {
    json!({ "v": 1, "pattern": pattern, id_key: id, "protocol": protocol, "min_protocol": min_protocol }).to_string()
}

fn prologue(header: &str) -> Vec<u8> {
    let mut bytes = PROLOGUE.to_vec();
    bytes.extend_from_slice(header.as_bytes());
    bytes
}

fn noise_write(state: &mut snow::HandshakeState, payload: &[u8]) -> anyhow::Result<Vec<u8>> {
    let mut message = vec![0u8; 65_535];
    let length = state.write_message(payload, &mut message)?;
    message.truncate(length);
    Ok(message)
}

struct Phone {
    id: String,
    name: String,
    private: Vec<u8>,
    public: Vec<u8>,
}

impl Phone {
    fn new(id: &str, name: &str) -> anyhow::Result<Self> {
        let pair = snow::Builder::new(KK.parse()?).generate_keypair()?;
        Ok(Self { id: id.to_string(), name: name.to_string(), private: pair.private, public: pair.public })
    }

    fn record(&self) -> Value {
        json!({ "id": self.id, "name": self.name, "platform": "ios", "app": "0.4.0", "channel": CHANNEL })
    }
}

#[allow(clippy::large_enum_variant)]
enum Opened {
    Ready(Socket, TransportState, Vec<u8>),
    Closed(Option<u16>),
}

async fn pair_handshake(
    port: u16,
    route: &Route,
    phone: &Phone,
    pairing: &str,
    psk: &[u8; 32],
) -> anyhow::Result<Opened> {
    let mut socket =
        connect(port, route).await?.map_err(|status| anyhow::anyhow!("the upgrade was refused: {status}"))?;
    let header = header_text("XXpsk3", "pair", pairing, 2, 2);
    socket.send(Message::text(header.clone())).await?;
    let mut state = snow::Builder::new(XX.parse()?)
        .local_private_key(&phone.private)?
        .psk(3, psk)?
        .prologue(&prologue(&header))?
        .build_initiator()?;
    socket.send(Message::binary(noise_write(&mut state, &[])?)).await.ok();
    let second = match raw_next(&mut socket, QUICK).await? {
        Raw::Binary(bytes) => bytes,
        Raw::Closed(code) => return Ok(Opened::Closed(code)),
        Raw::Text(text) => bail!("a text message during the handshake: {text}"),
    };
    let mut scratch = vec![0u8; 65_535];
    state.read_message(&second, &mut scratch)?;
    let server = state.get_remote_static().context("the server sent no static key")?.to_vec();
    socket.send(Message::binary(noise_write(&mut state, phone.record().to_string().as_bytes())?)).await?;
    Ok(Opened::Ready(socket, state.into_transport_mode()?, server))
}

async fn kk_handshake(port: u16, route: &Route, device: &str, private: &[u8], server: &[u8]) -> anyhow::Result<Opened> {
    let mut socket =
        connect(port, route).await?.map_err(|status| anyhow::anyhow!("the upgrade was refused: {status}"))?;
    let header = header_text("KK", "device", device, 2, 2);
    socket.send(Message::text(header.clone())).await?;
    let mut state = snow::Builder::new(KK.parse()?)
        .local_private_key(private)?
        .remote_public_key(server)?
        .prologue(&prologue(&header))?
        .build_initiator()?;
    socket.send(Message::binary(noise_write(&mut state, &[])?)).await.ok();
    match raw_next(&mut socket, QUICK).await? {
        Raw::Binary(bytes) => {
            let mut scratch = vec![0u8; 65_535];
            state.read_message(&bytes, &mut scratch)?;
            Ok(Opened::Ready(socket, state.into_transport_mode()?, server.to_vec()))
        }
        Raw::Closed(code) => Ok(Opened::Closed(code)),
        Raw::Text(text) => bail!("a text message during the handshake: {text}"),
    }
}

fn records(kind: u8, payload: &[u8], room: usize) -> Vec<Vec<u8>> {
    let chunks: Vec<&[u8]> = if payload.is_empty() { vec![payload] } else { payload.chunks(room).collect() };
    let last = chunks.len() - 1;
    chunks
        .into_iter()
        .enumerate()
        .map(|(at, chunk)| {
            let mut record = vec![if kind == 1 && at != last { 2 } else { kind }];
            record.extend_from_slice(chunk);
            record
        })
        .collect()
}

struct Client {
    name: String,
    out: mpsc::UnboundedSender<Vec<u8>>,
    view: Arc<Mutex<View>>,
    changed: Arc<Notify>,
    next: u64,
}

type Sink = SplitSink<Socket, Message>;

fn seal(transport: &Mutex<TransportState>, record: &[u8]) -> Option<Vec<u8>> {
    let mut message = vec![0u8; record.len() + 16];
    let length = transport.lock().unwrap_or_else(PoisonError::into_inner).write_message(record, &mut message).ok()?;
    message.truncate(length);
    Some(message)
}

async fn reader(
    mut stream: SplitStream<Socket>,
    transport: Arc<Mutex<TransportState>>,
    view: Arc<Mutex<View>>,
    changed: Arc<Notify>,
) {
    let mut joined: Vec<u8> = Vec::new();
    while let Some(message) = stream.next().await {
        let mut view_now = view.lock().unwrap_or_else(PoisonError::into_inner);
        match message {
            Ok(Message::Binary(bytes)) => {
                let mut record = vec![0u8; bytes.len()];
                let opened = transport.lock().unwrap_or_else(PoisonError::into_inner).read_message(&bytes, &mut record);
                let Ok(length) = opened else {
                    view_now.broken.get_or_insert_with(|| "a record failed to decrypt".to_string());
                    break;
                };
                record.truncate(length);
                let outcome = match record.first() {
                    Some(1) => {
                        joined.extend_from_slice(&record[1..]);
                        let text = String::from_utf8(std::mem::take(&mut joined)).unwrap_or_default();
                        view_now.apply_frame(&text)
                    }
                    Some(2) => {
                        joined.extend_from_slice(&record[1..]);
                        Ok(())
                    }
                    Some(3) if record.len() >= 18 => {
                        let last = record[17] & 1 == 1;
                        let (head, data) = record.split_at(18);
                        view_now.chunk(&head[1..17], last, data)
                    }
                    other => Err(anyhow::anyhow!("an unknown record {other:?}")),
                };
                if let Err(error) = outcome {
                    view_now.broken.get_or_insert(format!("{error:#}"));
                }
            }
            Ok(Message::Text(text)) => {
                let frame: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                if frame.get("op").and_then(Value::as_str) == Some("incompatible") {
                    view_now.incompatible = Some(frame);
                } else {
                    view_now.broken.get_or_insert(format!("a text message inside the channel: {text}"));
                }
            }
            Ok(Message::Close(frame)) => {
                view_now.close_code = frame.map(|frame| u16::from(frame.code));
                break;
            }
            Err(_) => break,
            Ok(_) => {}
        }
        drop(view_now);
        changed.notify_waiters();
    }
    view.lock().unwrap_or_else(PoisonError::into_inner).closed = true;
    changed.notify_waiters();
}

async fn writer(mut sink: Sink, mut rx: mpsc::UnboundedReceiver<Vec<u8>>, transport: Arc<Mutex<TransportState>>) {
    let mut ping = tokio::time::interval(PING_EVERY);
    ping.tick().await;
    loop {
        let record = tokio::select! {
            record = rx.recv() => {
                let Some(record) = record else {
                    sink.close().await.ok();
                    return;
                };
                record
            }
            _ = ping.tick() => {
                let mut record = vec![1u8];
                record.extend_from_slice(json!({ "op": "ping" }).to_string().as_bytes());
                record
            }
        };
        let Some(message) = seal(&transport, &record) else { return };
        if sink.send(Message::binary(message)).await.is_err() {
            return;
        }
    }
}

impl Client {
    fn spawn(name: &str, socket: Socket, transport: TransportState) -> Self {
        let (sink, stream) = socket.split();
        let transport = Arc::new(Mutex::new(transport));
        let (out, rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let view = Arc::new(Mutex::new(View::default()));
        let changed = Arc::new(Notify::new());
        tokio::spawn(reader(stream, Arc::clone(&transport), Arc::clone(&view), Arc::clone(&changed)));
        tokio::spawn(writer(sink, rx, transport));
        Self { name: name.to_string(), out, view, changed, next: 0 }
    }

    fn view(&self) -> MutexGuard<'_, View> {
        self.view.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn frame(&self, frame: &Value) {
        for record in records(1, frame.to_string().as_bytes(), 65_000) {
            self.out.send(record).ok();
        }
    }

    fn blob(&self, id: &[u8; 16], data: &[u8]) {
        let chunks: Vec<&[u8]> = if data.is_empty() { vec![data] } else { data.chunks(60_000).collect() };
        let last = chunks.len() - 1;
        for (at, chunk) in chunks.into_iter().enumerate() {
            let mut record = vec![3u8];
            record.extend_from_slice(id);
            record.push(u8::from(at == last));
            record.extend_from_slice(chunk);
            self.out.send(record).ok();
        }
    }

    async fn hello(&self, resume: Value) -> anyhow::Result<Duration> {
        let started = Instant::now();
        self.frame(&json!({ "op": "hello", "device": { "name": format!("{} (renamed)", self.name), "app": "0.4.1", "channel": CHANNEL }, "resume": resume }));
        self.until("hello answered", QUICK, |view| view.hello.is_some() || view.closed).await?;
        ensure!(
            self.view().hello.is_some(),
            "{}: closed with {:?} instead of hello",
            self.name,
            self.view().close_code
        );
        Ok(started.elapsed())
    }

    async fn until(&self, step: &str, bound: Duration, done: impl Fn(&View) -> bool) -> anyhow::Result<Duration> {
        let started = Instant::now();
        let deadline = started + bound;
        loop {
            let notified = self.changed.notified();
            {
                let view = self.view();
                if let Some(broken) = &view.broken {
                    bail!("{}: the wire broke: {broken}", self.name);
                }
                if done(&view) {
                    let took = started.elapsed();
                    println!("ok   {}: {step} ({:.1} s)", self.name, took.as_secs_f64());
                    return Ok(took);
                }
            }
            let Some(left) = deadline.checked_duration_since(Instant::now()) else {
                bail!("{}: timed out after {} s waiting for: {step}", self.name, bound.as_secs());
            };
            tokio::time::timeout(left.min(Duration::from_millis(200)), notified).await.ok();
        }
    }

    async fn reply(&mut self, op: &str, args: Value) -> anyhow::Result<Value> {
        self.next += 1;
        let id = self.next;
        self.frame(&json!({ "id": id, "op": op, "args": args }));
        self.reply_to(id, op).await
    }

    async fn reply_to(&self, id: u64, op: &str) -> anyhow::Result<Value> {
        let deadline = Instant::now() + QUICK;
        loop {
            let notified = self.changed.notified();
            if let Some(reply) = self.view().replies.remove(&id) {
                return Ok(reply);
            }
            if self.view().closed {
                bail!("{}: the socket closed before a reply to {op}", self.name);
            }
            let Some(left) = deadline.checked_duration_since(Instant::now()) else {
                bail!("{}: no reply to {op}", self.name);
            };
            tokio::time::timeout(left.min(Duration::from_millis(200)), notified).await.ok();
        }
    }

    async fn call(&mut self, op: &str, args: Value) -> anyhow::Result<Value> {
        let reply = self.reply(op, args).await?;
        if let Some(error) = reply.get("error") {
            bail!("{}: {op} was refused: {error}", self.name);
        }
        Ok(reply.get("result").cloned().unwrap_or(Value::Null))
    }

    async fn refused(&mut self, op: &str, args: Value, code: &str) -> anyhow::Result<()> {
        let reply = self.reply(op, args).await?;
        let got = reply.pointer("/error/code").and_then(Value::as_str);
        ensure!(got == Some(code), "{}: {op} answered {reply}, expected error {code}", self.name);
        println!(
            "ok   {}: {op} is refused with {code}: {}",
            self.name,
            reply.pointer("/error/message").unwrap_or(&Value::Null)
        );
        Ok(())
    }

    async fn answered(&mut self, op: &str, args: Value, request: &str) -> anyhow::Result<String> {
        self.call(op, args).await?;
        self.until(&format!("{op} answered over the wire"), SETUP, |view| view.answers.contains_key(request)).await?;
        Ok(self.view().answers[request].clone())
    }

    async fn upload(&mut self, data: &[u8], mime: &str) -> anyhow::Result<String> {
        let id = rand_bytes::<16>()?;
        self.next += 1;
        let ask = self.next;
        self.frame(
            &json!({ "id": ask, "op": "blob_put", "args": { "blob": hex(&id), "size": data.len(), "mime": mime } }),
        );
        self.blob(&id, data);
        let reply = self.reply_to(ask, "blob_put").await?;
        ensure!(reply.get("ok") == Some(&json!(true)), "{}: the upload was not acknowledged: {reply}", self.name);
        Ok(hex(&id))
    }

    async fn closed_with(&self, step: &str, code: u16) -> anyhow::Result<()> {
        self.until(step, QUICK, |view| view.closed).await?;
        let got = self.view().close_code;
        ensure!(got == Some(code), "{}: closed with {got:?}, expected {code}", self.name);
        Ok(())
    }
}

fn rand_bytes<const N: usize>() -> anyhow::Result<[u8; N]> {
    let pair = snow::Builder::new(KK.parse()?).generate_keypair()?;
    let mut bytes = [0u8; N];
    for (at, byte) in bytes.iter_mut().enumerate() {
        *byte = pair.private[at % pair.private.len()] ^ u8::try_from(at).unwrap_or_default();
    }
    Ok(bytes)
}

struct Serve {
    bin: PathBuf,
    root: PathBuf,
    data: PathBuf,
    port: u16,
    child: Option<Child>,
}

fn free_port() -> anyhow::Result<u16> {
    Ok(std::net::TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}

fn isolate(command: &mut Command, root: &Path, data: &Path) {
    command
        .env("HOME", root.join("home"))
        .env("EUKHE_DAEMON_SOCKET", root.join("d.sock"))
        .env("EUKHE_CODING_AGENT_DIR", root.join("agent"))
        .env("LOCAL_STUDIO_DATA_DIR", data);
}

impl Serve {
    fn command(&self) -> Command {
        let mut command = Command::new(&self.bin);
        isolate(&mut command, &self.root, &self.data);
        command
    }

    fn start(&mut self, eukhe: &Path, hook: &str) -> anyhow::Result<()> {
        let log = std::fs::OpenOptions::new().create(true).append(true).open(self.root.join("serve.log"))?;
        let child = self
            .command()
            .args(["serve", "--port", &self.port.to_string(), "--name", "smoke-box"])
            .args(["--tunnel-port", &tunnel_port().to_string(), "--allow-tunnel-host", TUNNEL])
            .arg("--eukhe")
            .arg(eukhe)
            .args(["--notify", hook])
            .arg("--data-dir")
            .arg(&self.data)
            .stdout(Stdio::null())
            .stderr(log)
            .spawn()
            .context("start local-studio-serve")?;
        println!("     serve pid {} on 127.0.0.1:{}", child.id(), self.port);
        self.child = Some(child);
        Ok(())
    }

    fn log(&self) -> String {
        std::fs::read_to_string(self.root.join("serve.log")).unwrap_or_default()
    }

    fn log_tail(&self) -> String {
        let log = self.log();
        let lines: Vec<&str> = log.lines().collect();
        lines[lines.len().saturating_sub(25)..].join("\n")
    }

    fn exited(&mut self) -> anyhow::Result<bool> {
        Ok(match self.child.as_mut() {
            Some(child) => child.try_wait()?.is_some(),
            None => true,
        })
    }

    fn run(&self, args: &[&str]) -> anyhow::Result<String> {
        let output = self.command().args(args).arg("--data-dir").arg(&self.data).output()?;
        ensure!(output.status.success(), "{args:?} failed: {}", String::from_utf8_lossy(&output.stderr));
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    fn pairing(&self) -> anyhow::Result<(String, [u8; 32])> {
        let url = format!("ws://127.0.0.1:{}/v1/ws", self.port);
        let printed = self.run(&["pair", "--url", &url, "--name", "smoke-box"])?;
        let link = printed
            .lines()
            .find(|line| line.starts_with(&format!("{}://pair?", scheme())))
            .context("pair printed no link")?;
        ensure!(printed.contains('\u{2588}') || printed.contains('\u{2580}'), "pair printed no QR code");
        let (query, secret) = link.split_once('#').context("the pairing link has no secret")?;
        let id = query
            .split(['?', '&'])
            .find_map(|part| part.strip_prefix("id="))
            .context("the pairing link has no id")?
            .to_string();
        let secret = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(secret)?;
        let secret = <[u8; 32]>::try_from(secret).map_err(|_| anyhow::anyhow!("the pairing secret is not 32 bytes"))?;
        ensure!(id.len() == 16 && id.bytes().all(|byte| byte.is_ascii_hexdigit()), "pairing id {id}");
        Ok((id, secret))
    }

    fn stop(&mut self) -> anyhow::Result<()> {
        let Some(mut child) = self.child.take() else { return Ok(()) };
        let pid = child.id().to_string();
        Command::new("kill").args(["-TERM", &pid]).status()?;
        let deadline = Instant::now() + Duration::from_secs(15);
        while child.try_wait()?.is_none() {
            if Instant::now() >= deadline {
                Command::new("kill").args(["-KILL", &pid]).status()?;
                child.wait()?;
                bail!("serve {pid} ignored SIGTERM for 15 s and was killed");
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        println!("ok   serve {pid} stopped by PID");
        Ok(())
    }
}

async fn http_get(port: u16, host: &str, path: &str, extra: &str) -> anyhow::Result<(u16, String)> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await?;
    let request = format!("GET {path} HTTP/1.1\r\nHost: {host}\r\n{extra}Connection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).await?;
    let mut answer = String::new();
    stream.read_to_string(&mut answer).await?;
    let status = answer.split_whitespace().nth(1).and_then(|code| code.parse().ok()).context("no status")?;
    let body = answer.split_once("\r\n\r\n").map(|(_, body)| body.to_string()).unwrap_or_default();
    Ok((status, body))
}

async fn hook_listener() -> anyhow::Result<(String, Arc<Mutex<Vec<Value>>>)> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let url = format!("http://127.0.0.1:{}/hook", listener.local_addr()?.port());
    let posts = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&posts);
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let seen = Arc::clone(&seen);
            tokio::spawn(async move {
                let mut buffer = Vec::new();
                let mut chunk = [0u8; 4096];
                loop {
                    let Ok(read) = stream.read(&mut chunk).await else { return };
                    if read == 0 {
                        return;
                    }
                    buffer.extend_from_slice(&chunk[..read]);
                    let text = String::from_utf8_lossy(&buffer).into_owned();
                    let Some((head, body)) = text.split_once("\r\n\r\n") else { continue };
                    let length = head
                        .lines()
                        .find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length:").map(str::to_string))
                        .and_then(|length| length.trim().parse::<usize>().ok())
                        .unwrap_or_default();
                    if body.len() < length {
                        continue;
                    }
                    if let Ok(value) = serde_json::from_str::<Value>(body) {
                        seen.lock().unwrap_or_else(PoisonError::into_inner).push(value);
                    }
                    stream.write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 0\r\nconnection: close\r\n\r\n").await.ok();
                    return;
                }
            });
        }
    });
    Ok((url, posts))
}

#[derive(Default)]
struct Signal {
    pending: Mutex<bool>,
    ready: Condvar,
}

impl Waker for Signal {
    fn wake(&self) {
        *self.pending.lock().unwrap_or_else(PoisonError::into_inner) = true;
        self.ready.notify_one();
    }
}

fn desktop(
    eukhe: &Path,
    data: &Path,
    step: &str,
    done: impl FnMut(&Studio, Update) -> anyhow::Result<bool>,
    start: impl FnOnce(&Studio),
) -> anyhow::Result<Option<u32>> {
    tokio::task::block_in_place(|| desktop_run(eukhe, data, step, done, start))
}

fn desktop_run(
    eukhe: &Path,
    data: &Path,
    step: &str,
    mut done: impl FnMut(&Studio, Update) -> anyhow::Result<bool>,
    start: impl FnOnce(&Studio),
) -> anyhow::Result<Option<u32>> {
    let signal = Arc::new(Signal::default());
    let config = StudioConfig {
        socket_path: None,
        session_dir: None,
        data_dir: Some(data.to_string_lossy().into_owned()),
        launch: Some(DaemonLaunch { program: eukhe.to_string_lossy().into_owned() }),
        controller_main: None,
    };
    let studio =
        Studio::new(config, Arc::clone(&signal) as Arc<dyn Waker>).map_err(|error| anyhow::anyhow!("{error}"))?;
    start(&studio);
    let deadline = Instant::now() + SETUP;
    let mut pid = None;
    let mut finished = false;
    while !finished {
        for update in studio.tick() {
            if let Update::Daemon { pid: Some(known), .. } = &update {
                pid = Some(*known);
            }
            finished = finished || done(&studio, update)?;
        }
        if finished {
            break;
        }
        let Some(left) = deadline.checked_duration_since(Instant::now()) else {
            studio.shutdown();
            bail!("the desktop side timed out: {step}");
        };
        let pending = signal.pending.lock().unwrap_or_else(PoisonError::into_inner);
        let (mut pending, _) = signal
            .ready
            .wait_timeout_while(pending, left.min(Duration::from_millis(500)), |pending| !*pending)
            .unwrap_or_else(PoisonError::into_inner);
        *pending = false;
    }
    println!("ok   desktop: {step}");
    studio.shutdown();
    drop(studio);
    Ok(pid)
}

fn git(work: &Path, args: &[&str]) -> anyhow::Result<()> {
    let status = Command::new("git")
        .args(["-c", "user.name=Smoke", "-c", "user.email=smoke@example.invalid", "-c", "commit.gpgsign=false"])
        .args(args)
        .current_dir(work)
        .env("HOME", work.join("../home"))
        .stdout(Stdio::null())
        .status()?;
    ensure!(status.success(), "git {args:?} failed");
    Ok(())
}

fn seed_work(work: &Path) -> anyhow::Result<String> {
    std::fs::create_dir_all(work)?;
    let big = (0..6000).fold(String::new(), |mut big, line| {
        writeln!(big, "line {line:05} of a file long enough to need several blob records").ok();
        big
    });
    std::fs::write(work.join("notes.txt"), "remote smoke notes\n")?;
    std::fs::write(work.join("big.txt"), &big)?;
    git(work, &["init", "-q", "-b", "main"])?;
    git(work, &["add", "."])?;
    git(work, &["commit", "-q", "-m", "seed"])?;
    std::fs::write(work.join("notes.txt"), "remote smoke notes\nchanged on the box\n")?;
    Ok(big)
}

struct Target {
    provider: String,
    model: String,
    thinking: String,
    /// The model takes image input. A text-only model gets the tool turn without the image, and
    /// the image round trip runs on a thread of the unreachable provider instead.
    images: bool,
}

fn refuse_links(path: &Path) -> anyhow::Result<()> {
    use std::os::unix::fs::MetadataExt;
    let metadata = std::fs::symlink_metadata(path)?;
    ensure!(
        !metadata.file_type().is_symlink(),
        "{} is a symlink; remote_smoke writes its own scratch agent files and never through a link",
        path.display()
    );
    if metadata.is_dir() {
        for entry in std::fs::read_dir(path)? {
            refuse_links(&entry?.path())?;
        }
    } else {
        ensure!(
            metadata.nlink() == 1,
            "{} has {} hard links; remote_smoke writes its own scratch agent files and never through a link",
            path.display(),
            metadata.nlink()
        );
    }
    Ok(())
}

fn agent_dir(root: &Path) -> anyhow::Result<Option<Target>> {
    let agent = root.join("agent");
    if std::fs::symlink_metadata(&agent).is_ok() {
        refuse_links(&agent)?;
        for name in ["auth.json", "models.json", "settings.json"] {
            if std::fs::symlink_metadata(agent.join(name)).is_ok() {
                std::fs::remove_file(agent.join(name))?;
            }
        }
    }
    std::fs::create_dir_all(&agent)?;
    let write = |name: &str, data: &[u8]| -> anyhow::Result<()> {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(agent.join(name))
            .with_context(|| format!("create {}", agent.join(name).display()))?
            .write_all(data)?;
        Ok(())
    };
    write("auth.json", b"{}")?;
    local_studio_core::check_scratch_agent(&agent).map_err(|error| anyhow::anyhow!(error))?;
    let absent = json!({
        "baseUrl": format!("http://127.0.0.1:{}/v1", free_port()?),
        "api": "openai-completions",
        "apiKey": "absent",
        "models": [{ "id": "absent", "input": ["text", "image"], "contextWindow": 8192 }]
    });
    let Some(source) = std::env::var_os("LOCAL_STUDIO_SMOKE_AGENT").map(PathBuf::from) else {
        write("models.json", &serde_json::to_vec(&json!({ "providers": { "remote-smoke-absent": absent } }))?)?;
        write("settings.json", br#"{"onboardingShown":true}"#)?;
        return Ok(None);
    };
    let models = std::fs::read(source.join("models.json"))
        .with_context(|| format!("read {}", source.join("models.json").display()))?;
    let mut scratch: Value = serde_json::from_slice(&models)?;
    scratch
        .get_mut("providers")
        .and_then(Value::as_object_mut)
        .context("models.json has no providers")?
        .insert("remote-smoke-absent".to_string(), absent);
    write("models.json", &serde_json::to_vec(&scratch)?)?;
    write(
        "settings.json",
        &std::fs::read(source.join("settings.json")).unwrap_or_else(|_| br#"{"onboardingShown":true}"#.to_vec()),
    )?;
    let chosen = std::env::var("REMOTE_SMOKE_MODEL").ok();
    let catalog: Value = serde_json::from_slice(&models)?;
    let (provider, model) = if let Some((provider, model)) = chosen.as_deref().and_then(|chosen| chosen.split_once('/'))
    {
        (provider.to_string(), model.to_string())
    } else {
        let (provider, entry) = catalog
            .get("providers")
            .and_then(Value::as_object)
            .and_then(|providers| providers.iter().next())
            .context("models.json names no provider")?;
        let model = entry.pointer("/models/0/id").and_then(Value::as_str).context("the provider names no model")?;
        (provider.clone(), model.to_string())
    };
    let base = catalog.pointer(&format!("/providers/{provider}/baseUrl")).and_then(Value::as_str).unwrap_or("?");
    let thinking = std::env::var("REMOTE_SMOKE_THINKING").unwrap_or_else(|_| "off".to_string());
    let images = catalog
        .pointer(&format!("/providers/{provider}/models"))
        .and_then(Value::as_array)
        .and_then(|models| models.iter().find(|entry| entry["id"] == model.as_str()))
        .and_then(|entry| entry["input"].as_array())
        .is_some_and(|input| input.iter().any(|kind| kind == "image"));
    println!(
        "     model {provider}/{model} at {base}, thinking {thinking}, {}; auth.json is a scratch {{}} (no sign-in)",
        if images { "takes images" } else { "text only" }
    );
    Ok(Some(Target { provider, model, thinking, images }))
}

struct Run {
    serve: Serve,
    work: PathBuf,
    project: String,
    big: String,
    hook: String,
    posts: Arc<Mutex<Vec<Value>>>,
    server_key: Vec<u8>,
    epoch: String,
    report: Vec<String>,
}

async fn expect_closed(opened: Opened, step: &str, code: u16) -> anyhow::Result<()> {
    match opened {
        Opened::Closed(got) => {
            ensure!(got == Some(code), "{step}: closed with {got:?}, expected {code}");
        }
        Opened::Ready(socket, transport, _) => {
            let client = Client::spawn(step, socket, transport);
            client.frame(&json!({ "op": "hello", "device": {}, "resume": {} }));
            client.until("the server closes", QUICK, |view| view.closed || view.hello.is_some()).await?;
            let view = client.view();
            ensure!(view.hello.is_none(), "{step}: the server answered hello");
            ensure!(view.close_code == Some(code), "{step}: closed with {:?}, expected {code}", view.close_code);
        }
    }
    println!("ok   {step}: closed with {code}");
    Ok(())
}

async fn transport_checks(run: &mut Run, eukhe: &Path) -> anyhow::Result<()> {
    let port = run.serve.port;
    let host = format!("127.0.0.1:{port}");
    let deadline = Instant::now() + SETUP;
    let health = loop {
        if let Ok(answer) = http_get(port, &host, "/v1/health", "").await {
            break answer;
        }
        if run.serve.exited()? || Instant::now() >= deadline {
            bail!("serve did not come up:\n{}", run.serve.log_tail());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    };
    ensure!(
        health.0 == 200 && health.1.contains("\"protocol\":2") && health.1.contains("\"min_protocol\":2"),
        "health answered {health:?}"
    );
    println!("ok   /v1/health answers {} without auth", health.1);
    for (path, host, extra, why) in [
        ("/v1/health", "evil.example".to_string(), String::new(), "a foreign Host"),
        ("/v1/health", format!("127.0.0.1:{}", port + 1), String::new(), "a loopback Host on another port"),
        (
            "/v1/health",
            "evil.example".to_string(),
            format!("X-Forwarded-Host: 127.0.0.1:{port}\r\n"),
            "a foreign Host with an allowed X-Forwarded-Host",
        ),
        ("/v1/ws", "evil.example".to_string(), String::new(), "a socket for a foreign Host"),
        ("/nope", "evil.example".to_string(), String::new(), "any path on a foreign Host"),
    ] {
        let answer = http_get(port, &host, path, &extra).await?;
        ensure!(answer.0 == 403, "{why} got {}", answer.0);
        println!("ok   {why} gets 403 on {path}");
    }
    let tunnel = http_get(tunnel_port(), TUNNEL, "/v1/health", "").await?;
    ensure!(tunnel.0 == 200, "the tunnel host got {} on the tunnel listener", tunnel.0);
    let crossed = http_get(port, TUNNEL, "/v1/health", "").await?;
    ensure!(crossed.0 == 403, "the tunnel host got {} on the local listener", crossed.0);
    let loopback = format!("127.0.0.1:{}", tunnel_port());
    let crossed = http_get(tunnel_port(), &loopback, "/v1/health", "").await?;
    ensure!(crossed.0 == 403, "a loopback Host got {} on the tunnel listener", crossed.0);
    println!("ok   one listener per route: {TUNNEL} is allowed only on the tunnel listener, a loopback Host only on the local one");
    let bare = connect(port, &Route { tunnel: true, host: Some(TUNNEL.to_string()), ..Route::default() }).await?;
    ensure!(matches!(bare, Err(400)), "a tunnel socket without CF-Connecting-IP was not refused with 400");
    println!("ok   a tunnel socket without CF-Connecting-IP gets 400");
    let cross = connect(port, &Route { origin: Some("https://evil.example".to_string()), ..Route::default() }).await?;
    ensure!(matches!(cross, Err(403)), "a socket with a mismatched Origin was not refused");
    println!("ok   a socket with a mismatched Origin gets 403");

    let rival_port = free_port()?;
    let mut rival = run.serve.command();
    let mut rival = rival
        .args(["serve", "--port", &rival_port.to_string(), "--eukhe"])
        .arg(eukhe)
        .arg("--data-dir")
        .arg(&run.serve.data)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()?;
    let deadline = Instant::now() + QUICK;
    while rival.try_wait()?.is_none() {
        if Instant::now() >= deadline {
            Command::new("kill").args(["-KILL", &rival.id().to_string()]).status()?;
            rival.wait()?;
            bail!("a second serve on the same data dir kept running");
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let output = rival.wait_with_output()?;
    let said = String::from_utf8_lossy(&output.stderr);
    ensure!(!output.status.success() && said.contains("already owns"), "a second serve said: {said}");
    println!("ok   a second serve on the data dir is refused: {}", said.trim());

    for (protocol, min_protocol) in [(3, 3), (1, 1)] {
        let mut socket =
            connect(port, &Route::default()).await?.map_err(|status| anyhow::anyhow!("refused {status}"))?;
        socket.send(Message::text(header_text("KK", "device", "phone-x", protocol, min_protocol))).await?;
        let Raw::Text(text) = raw_next(&mut socket, QUICK).await? else {
            bail!("no incompatible frame for protocol {protocol}")
        };
        let answer: Value = serde_json::from_str(&text)?;
        ensure!(
            answer == json!({ "op": "incompatible", "protocol": 2, "min_protocol": 2 }),
            "incompatible answered {answer}"
        );
        let Raw::Closed(_) = raw_next(&mut socket, QUICK).await? else { bail!("no close after incompatible") };
        println!(
            "ok   a phone on protocols {min_protocol} to {protocol} gets {text} before any handshake, then a close"
        );
    }
    let mut socket =
        connect(port, &Route::tunnel("198.51.100.10")).await?.map_err(|status| anyhow::anyhow!("refused {status}"))?;
    socket.send(Message::text("{\"v\":1,\"pattern\":\"NN\"}")).await?;
    let Raw::Closed(code) = raw_next(&mut socket, QUICK).await? else { bail!("a bad header was not closed") };
    ensure!(code == Some(1002), "a bad header closed with {code:?}");
    println!("ok   a bad opening header is closed with 1002");
    Ok(())
}

async fn pair(run: &mut Run, phone: &Phone) -> anyhow::Result<Client> {
    let (id, psk) = run.serve.pairing()?;
    let Opened::Ready(socket, transport, server) =
        pair_handshake(run.serve.port, &Route::default(), phone, &id, &psk).await?
    else {
        bail!("pairing {} was refused:\n{}", phone.id, run.serve.log_tail());
    };
    ensure!(run.server_key.is_empty() || run.server_key == server, "the machine's static key changed");
    run.server_key = server;
    let client = Client::spawn(&phone.name, socket, transport);
    client.hello(json!({ "watch": [] })).await?;
    Ok(client)
}

async fn reconnect(run: &Run, phone: &Phone, resume: Value) -> anyhow::Result<(Client, Duration)> {
    let started = Instant::now();
    let opened = kk_handshake(run.serve.port, &Route::default(), &phone.id, &phone.private, &run.server_key).await?;
    let Opened::Ready(socket, transport, _) = opened else {
        bail!("{}: KK was refused:\n{}", phone.id, run.serve.log_tail())
    };
    let client = Client::spawn(&phone.name, socket, transport);
    client.hello(resume).await?;
    Ok((client, started.elapsed()))
}

#[allow(clippy::too_many_lines)]
async fn pairing_checks(run: &mut Run, a: &Phone) -> anyhow::Result<Client> {
    let port = run.serve.port;
    let (stale, stale_psk) = run.serve.pairing()?;
    let (id, psk) = run.serve.pairing()?;
    let opened = pair_handshake(port, &Route::tunnel("198.51.100.11"), a, &stale, &stale_psk).await?;
    expect_closed(opened, "a pairing cancelled by a newer one is refused", 4401).await?;
    let mut wrong = psk;
    wrong[0] ^= 0xff;
    let opened = pair_handshake(port, &Route::tunnel("198.51.100.12"), a, &id, &wrong).await?;
    expect_closed(opened, "a wrong pairing secret fails at the third message", 4401).await?;
    let started = Instant::now();
    let Opened::Ready(socket, transport, server) = pair_handshake(port, &Route::default(), a, &id, &psk).await? else {
        bail!("the right secret was refused:\n{}", run.serve.log_tail());
    };
    run.server_key = server;
    let client = Client::spawn(&a.name, socket, transport);
    client.hello(json!({ "watch": [] })).await?;
    println!("ok   phone A paired through XXpsk3 and got hello in {} ms", started.elapsed().as_millis());
    {
        let view = client.view();
        let hello = view.hello.as_ref().context("no hello")?;
        let kinds: Vec<&str> =
            hello["snapshot"].as_array().into_iter().flatten().filter_map(|update| update["type"].as_str()).collect();
        ensure!(
            hello["protocol"] == json!(2)
                && hello["resume"] == json!("snapshot")
                && hello.pointer("/machine/version") == Some(&json!(VERSION))
                && hello.pointer("/machine/channel") == Some(&json!(CHANNEL))
                && hello.pointer("/machine/urls") == Some(&json!([format!("wss://{TUNNEL}/v1/ws")]))
                && hello["epoch"].as_str().is_some_and(|epoch| !epoch.is_empty()),
            "hello: {hello}"
        );
        ensure!(
            kinds.contains(&"connection") && kinds.contains(&"projects") && kinds.contains(&"threads"),
            "snapshot kinds {kinds:?}"
        );
        run.epoch = hello["epoch"].as_str().unwrap_or_default().to_string();
        println!("ok   hello: protocol 2, epoch {}, machine {}, snapshot {kinds:?}", run.epoch, hello["machine"]);
        let missing: Vec<&str> = ["models", "theme"].into_iter().filter(|kind| !kinds.contains(kind)).collect();
        if !missing.is_empty() {
            println!(
                "     snapshot lacks {missing:?} (models arrive as an update once loaded; theme is not built in core)"
            );
        }
    }
    let remote = run.serve.data.join("remote");
    let mode = |name: &str| -> anyhow::Result<u32> {
        use std::os::unix::fs::PermissionsExt;
        Ok(std::fs::metadata(remote.join(name))?.permissions().mode() & 0o777)
    };
    ensure!(mode("static.key")? == 0o600 && mode("devices.json")? == 0o600, "remote files are not 0600");
    ensure!(!remote.join("pairing.json").exists(), "the used pairing was not burned");
    let ledger: Value = serde_json::from_slice(&std::fs::read(remote.join("devices.json"))?)?;
    let device = ledger["devices"]
        .as_array()
        .and_then(|devices| devices.iter().find(|device| device["id"] == json!(a.id)))
        .context("phone A is not in devices.json")?;
    let fields: HashSet<&str> =
        device.as_object().map(|fields| fields.keys().map(String::as_str).collect()).unwrap_or_default();
    ensure!(device["key"] == json!(hex(&a.public)), "devices.json holds the wrong key for phone A");
    ensure!(
        fields == HashSet::from(["id", "name", "platform", "app", "channel", "key", "firstSeen", "lastSeen"]),
        "devices.json fields {fields:?}"
    );
    ensure!(
        device["name"] == json!(format!("{} (renamed)", a.name)) && device["app"] == json!("0.4.1"),
        "hello did not update the record: {device}"
    );
    println!("ok   static.key and devices.json are 0600; devices.json holds phone A's public key and no secret; pairing.json is gone");
    let opened = pair_handshake(port, &Route::tunnel("198.51.100.13"), a, &id, &psk).await?;
    expect_closed(opened, "a burned pairing secret is refused", 4401).await?;
    let opened =
        kk_handshake(port, &Route::tunnel("198.51.100.14"), "phone-nobody", &a.private, &run.server_key).await?;
    expect_closed(opened, "KK for an unknown device is refused", 4401).await?;
    let mut socket =
        connect(port, &Route::tunnel("198.51.100.17")).await?.map_err(|status| anyhow::anyhow!("refused {status}"))?;
    socket.send(Message::text(header_text("KK", "device", "phone-nobody", 2, 2))).await?;
    let Raw::Closed(code) = raw_next(&mut socket, QUICK).await? else {
        bail!("a KK header for an unknown device got a handshake message instead of a close")
    };
    ensure!(code == Some(4401), "a KK header for an unknown device closed with {code:?}");
    println!("ok   a KK header naming an unknown device is closed with 4401 before any handshake message");
    let (again, again_psk) = run.serve.pairing()?;
    let impostor = Phone::new(&a.id, "Impostor")?;
    let opened = pair_handshake(port, &Route::default(), &impostor, &again, &again_psk).await?;
    expect_closed(opened, "a pairing that names an already paired device id is refused", 4401).await?;
    let ledger: Value = serde_json::from_slice(&std::fs::read(remote.join("devices.json"))?)?;
    let keys: Vec<&Value> = ledger["devices"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|device| device["id"] == json!(a.id))
        .map(|device| &device["key"])
        .collect();
    ensure!(keys == [&json!(hex(&a.public))], "the refused pairing changed phone A's record: {keys:?}");
    println!("ok   phone A's record and key are unchanged");
    let stranger = Phone::new(&a.id, "Stranger")?;
    let opened = kk_handshake(port, &Route::tunnel("198.51.100.15"), &a.id, &stranger.private, &run.server_key).await?;
    expect_closed(opened, "KK with another key for a known device id fails the handshake", 4401).await?;
    Ok(client)
}

#[allow(clippy::too_many_lines)]
async fn op_checks(run: &mut Run, a: &mut Client) -> anyhow::Result<()> {
    a.until("daemon connected", SETUP, |view| matches!(view.connection, Some(Connection::Ready))).await?;
    a.until("the desktop's project is in the snapshot", QUICK, |view| view.projects.len() == 1).await?;
    run.project.clone_from(&a.view().projects[0]);
    let project = run.project.clone();
    a.refused("add_project", json!({ "path": "/tmp" }), "not_remote").await?;
    a.refused("load_usage", json!({ "request": "u", "period": "day" }), "not_remote").await?;
    a.refused("delete_thread", json!({ "thread": "x" }), "not_remote").await?;
    a.refused("answer_questions", json!({ "thread": "x", "request": "q", "answers": {} }), "not_built").await?;
    a.refused("rename_thread", json!({ "thread": 7 }), "bad_args").await?;
    a.refused("hello", json!({}), "bad_state").await?;
    a.refused("load_earlier", json!({ "thread": "nope" }), "not_watched").await?;
    a.refused("blob_put", json!({ "blob": hex(&[1u8; 16]), "size": 26 << 20, "mime": "image/png" }), "too_large")
        .await?;
    a.frame(&json!({ "op": "ping" }));
    a.until("ping answered with pong", QUICK, |view| view.pongs >= 1).await?;
    let pongs = a.view().pongs;
    let reply = a.reply("ping", json!({})).await?;
    ensure!(reply.get("ok") == Some(&json!(true)) && a.view().pongs == pongs, "a ping with an id answered {reply}");
    println!("ok   a ping with an id is answered {reply}, a ping without one with pong");
    let models = a.view().models;
    a.call("load_models", json!({})).await?;
    a.until("load_models brings a models update", SETUP, |view| view.models > models).await?;
    for (op, args, request) in [
        ("list_commands", json!({ "request": "q-commands", "project": project }), "q-commands"),
        ("list_skills", json!({ "request": "q-skills", "project": project }), "q-skills"),
        ("search_threads", json!({ "request": "q-search", "query": "smoke", "limit": 10 }), "q-search"),
        ("list_archived", json!({ "request": "q-archived" }), "q-archived"),
        (
            "load_diff",
            json!({ "request": "q-diff", "project": project, "scope": { "type": "working_tree" } }),
            "q-diff",
        ),
        ("list_pull_requests", json!({ "request": "q-prs", "project": project }), "q-prs"),
        ("load_pull_request", json!({ "request": "q-pr", "project": project, "number": 1 }), "q-pr"),
    ] {
        let kind = a.answered(op, args, request).await?;
        println!("     {op} answered with {kind}");
    }
    ensure!(a.view().answers["q-diff"] == "diff", "load_diff did not answer with a diff");
    let git = a.view().git_status;
    a.call("git_status", json!({ "project": project })).await?;
    a.until("git_status answers with git_status", SETUP, |view| view.git_status > git).await?;
    a.call("read_file", json!({ "request": "q-file", "project": project, "relative": "big.txt" })).await?;
    a.until("read_file answers with a blob and all its chunks", SETUP, |view| {
        view.blobs.values().any(|blob| blob.request == "q-file" && blob.done)
    })
    .await?;
    {
        let view = a.view();
        let blob = view.blobs.values().find(|blob| blob.request == "q-file").context("no file blob")?;
        ensure!(blob.data == run.big.as_bytes() && blob.size == run.big.len(), "the file blob differs from big.txt");
        ensure!(
            blob.mime.starts_with("text/plain")
                && blob.extra["path"].as_str().is_some_and(|path| path.ends_with("big.txt")),
            "file blob header {}",
            blob.extra
        );
        println!(
            "ok   read_file sent big.txt ({} bytes, {} records) as a blob, byte for byte",
            blob.size,
            blob.size.div_ceil(65_499)
        );
    }
    let image = png(64);
    let id = a.upload(&image, "image/png").await?;
    println!("ok   blob_put of a {} byte PNG is acknowledged after its final chunk ({id})", image.len());
    let short = rand_bytes::<16>()?;
    a.next += 1;
    let ask = a.next;
    a.frame(
        &json!({ "id": ask, "op": "blob_put", "args": { "blob": hex(&short), "size": 1000, "mime": "image/png" } }),
    );
    a.blob(&short, &[0u8; 10]);
    let reply = a.reply_to(ask, "blob_put").await?;
    ensure!(reply.pointer("/error/code") == Some(&json!("bad_blob")), "a short blob answered {reply}");
    println!("ok   a blob that ends short of its declared size is refused with bad_blob");
    a.refused("send", json!({ "request": "r-x", "thread": "nope", "prompt": { "text": "x", "images": [hex(&[9u8; 16])], "files": [] }, "delivery": "queue" }), "bad_blob").await?;
    run.report.push(format!("blob upload id {id}"));
    Ok(())
}

async fn resume_checks(run: &mut Run, a: Client, a_phone: &Phone, c: &mut Client) -> anyhow::Result<Client> {
    let seq = a.view().seq;
    let gaps = a.view().seq_gaps;
    ensure!(gaps == 0, "phone A saw {gaps} seq gaps");
    drop(a);
    tokio::time::sleep(Duration::from_millis(500)).await;
    let models = c.view().models;
    c.call("load_models", json!({})).await?;
    c.until("phone C's load_models brings a models update", SETUP, |view| view.models > models).await?;
    let (a, latency) = reconnect(run, a_phone, json!({ "seq": seq, "epoch": run.epoch, "watch": [] })).await?;
    a.until("the missed models update is replayed after hello", QUICK, |view| view.models >= 1).await?;
    {
        let view = a.view();
        let hello = view.hello.as_ref().context("no hello")?;
        ensure!(
            hello["resume"] == json!("delta") && hello["seq"] == json!(seq) && hello["snapshot"] == json!([]),
            "resume hello {hello}"
        );
        ensure!(view.seq_gaps == 0 && view.seq > seq, "the replay skipped a seq (from {seq} to {})", view.seq);
        println!(
            "ok   KK reconnect resumed by seq: delta from {seq} to {}, hello in {} ms",
            view.seq,
            latency.as_millis()
        );
    }
    run.report.push(format!("KK reconnect to hello latency {} ms", latency.as_millis()));
    drop(a);
    let (mut a, _) = reconnect(run, a_phone, json!({ "seq": 3, "epoch": "not-this-epoch", "watch": [] })).await?;
    ensure!(
        a.view().hello.as_ref().is_some_and(|hello| hello["resume"] == json!("snapshot")),
        "a foreign epoch did not get a snapshot"
    );
    println!("ok   a resume from another epoch gets a full snapshot");
    let replay = "r".repeat(1_500_000);
    std::fs::write(run.work.join("replay.txt"), &replay)?;
    let before = a.view().seq;
    for at in 1..=48 {
        a.call(
            "read_file",
            json!({ "request": format!("q-replay-{at}"), "project": run.project, "relative": "replay.txt" }),
        )
        .await?;
    }
    a.until("48 reads of replay.txt answer with blobs", SETUP, |view| {
        view.blobs.values().filter(|blob| blob.request.starts_with("q-replay-") && blob.done).count() == 48
    })
    .await?;
    let recent = a.view().seq - 2;
    drop(a);
    let (a, _) = reconnect(run, a_phone, json!({ "seq": before, "epoch": run.epoch, "watch": [] })).await?;
    ensure!(
        a.view().hello.as_ref().is_some_and(|hello| hello["resume"] == json!("snapshot")),
        "a resume from before 72 MB of read_file blobs did not fall back to a snapshot"
    );
    drop(a);
    let (a, _) = reconnect(run, a_phone, json!({ "seq": recent, "epoch": run.epoch, "watch": [] })).await?;
    ensure!(
        a.view().hello.as_ref().is_some_and(|hello| hello["resume"] == json!("delta")),
        "a resume from the newest blobs did not get a delta"
    );
    println!("ok   the replay buffer holds a byte budget: 72 MB of blobs push an old seq to a snapshot, a recent one still gets a delta");
    Ok(a)
}

async fn bad_headers(port: u16, route: &Route, count: usize) -> anyhow::Result<()> {
    for attempt in 1..=count {
        let mut socket = connect(port, route).await?.map_err(|status| anyhow::anyhow!("refused {status}"))?;
        socket.send(Message::text(format!("not a header {attempt}"))).await?;
        let Raw::Closed(code) = raw_next(&mut socket, QUICK).await? else {
            bail!("bad header {attempt} was not closed")
        };
        ensure!(code == Some(1002), "bad header {attempt} closed with {code:?}");
    }
    Ok(())
}

async fn first_close(port: u16, route: &Route) -> anyhow::Result<Option<u16>> {
    let mut socket = connect(port, route).await?.map_err(|status| anyhow::anyhow!("refused {status}"))?;
    let Raw::Closed(code) = raw_next(&mut socket, QUICK).await? else { bail!("the socket was not closed") };
    Ok(code)
}

#[allow(clippy::too_many_lines)]
async fn limit_checks(run: &Run, a: Client, a_phone: &Phone) -> anyhow::Result<Client> {
    let port = run.serve.port;
    let open = |address: &'static str| async move {
        connect(port, &Route::tunnel(address)).await?.map_err(|status| anyhow::anyhow!("refused {status}"))
    };
    let mut held = vec![open("192.0.2.50").await?, open("192.0.2.50").await?];
    ensure!(
        first_close(port, &Route::tunnel("192.0.2.50")).await? == Some(1013),
        "a third pending socket from one address was not closed with 1013"
    );
    println!("ok   a third socket mid-handshake from one client address is closed with 1013");
    for address in ["192.0.2.51", "192.0.2.52", "192.0.2.53"] {
        held.push(open(address).await?);
        held.push(open(address).await?);
    }
    ensure!(
        first_close(port, &Route::tunnel("192.0.2.54")).await? == Some(1013),
        "a ninth pending socket was not closed with 1013"
    );
    println!("ok   a ninth socket mid-handshake is closed with 1013 while 8 are open");
    let started = Instant::now();
    for (at, socket) in held.iter_mut().take(2).enumerate() {
        let Raw::Closed(code) = raw_next(socket, QUICK).await? else { bail!("silent socket {at} was not closed") };
        ensure!(
            code == Some(1002) && started.elapsed() < Duration::from_secs(7),
            "a silent socket closed with {code:?} after {:?}",
            started.elapsed()
        );
    }
    println!("ok   a socket with no opening header is closed after 5 s");
    drop(held);
    let mut socket = open("192.0.2.50").await?;
    socket.send(Message::text(header_text("KK", "device", &a_phone.id, 2, 2))).await?;
    tokio::time::sleep(Duration::from_millis(300)).await;
    drop(socket);
    tokio::time::sleep(Duration::from_millis(300)).await;
    bad_headers(port, &Route::tunnel("192.0.2.50"), 2).await?;
    let code = first_close(port, &Route::tunnel("192.0.2.50")).await?;
    ensure!(
        code == Some(4429),
        "after 2 timeouts, 1 close mid-handshake and 2 bad headers, 192.0.2.50 closed with {code:?}"
    );
    println!(
        "ok   timeouts and a close mid-handshake count as failures: 2 + 1 + 2 bad headers refuse 192.0.2.50 with 4429"
    );
    let spoof = Route { from: Some("192.0.2.50".to_string()), ..Route::default() };
    let opened = kk_handshake(port, &spoof, &a_phone.id, &a_phone.private, &run.server_key).await?;
    let Opened::Ready(socket, transport, _) = opened else {
        bail!("CF-Connecting-IP on the local listener was honored")
    };
    let probe = Client::spawn(&a_phone.name, socket, transport);
    probe.hello(json!({ "watch": [] })).await?;
    println!("ok   the local listener ignores CF-Connecting-IP: a socket naming the banned address still connects");
    a.closed_with("the older socket of phone A is replaced with 4409", 4409).await?;
    drop(probe);

    bad_headers(port, &Route::login("mallory@example.com"), 5).await?;
    let code = first_close(port, &Route::login("mallory@example.com")).await?;
    ensure!(code == Some(4429), "5 failures from one Tailscale login closed with {code:?}");
    println!("ok   5 bad headers from one Tailscale-User-Login refuse that login with 4429");
    bad_headers(port, &Route::default(), 6).await?;
    let mut last = None;
    for (route, who) in
        [(Route::login("alice@example.com"), "another Tailscale login"), (Route::default(), "a plain loopback client")]
    {
        let opened = kk_handshake(port, &route, &a_phone.id, &a_phone.private, &run.server_key).await?;
        let Opened::Ready(socket, transport, _) = opened else { bail!("{who} was refused after other clients failed") };
        let client = Client::spawn(&a_phone.name, socket, transport);
        client.hello(json!({ "watch": [] })).await?;
        if let Some(previous) = last.replace(client) {
            drop(previous);
        }
        println!("ok   {who} still connects");
    }
    println!("ok   6 bad headers from a plain loopback client never refuse loopback");
    let log = run.serve.log();
    ensure!(
        log.contains("refused cf:192.0.2.50 (-)") && log.contains("refused cf:198.51.100.12 (XXpsk3)"),
        "the failures are not logged with client and pattern"
    );
    println!("ok   each refusal is logged with its client and pattern");
    last.context("no client")
}

async fn quiet(socket: &mut Socket) -> bool {
    tokio::time::timeout(Duration::from_millis(400), socket.next()).await.is_err()
}

/// docs/remote.md, Limits: a KK socket is authenticated only once its hello decrypts, pending caps are per
/// listener with 2 local slots kept for loopback, and IPv6 clients bucket by /64.
#[allow(clippy::too_many_lines)]
async fn listener_checks(run: &Run, a: Client, a_phone: &Phone) -> anyhow::Result<Client> {
    let port = run.serve.port;
    let mut socket = connect(port, &Route::default()).await?.map_err(|status| anyhow::anyhow!("refused {status}"))?;
    let header = header_text("KK", "device", &a_phone.id, 2, 2);
    socket.send(Message::text(header.clone())).await?;
    let mut state = snow::Builder::new(KK.parse()?)
        .local_private_key(&a_phone.private)?
        .remote_public_key(&run.server_key)?
        .prologue(&prologue(&header))?
        .build_initiator()?;
    let first = noise_write(&mut state, &[])?;
    socket.send(Message::binary(first.clone())).await?;
    let Raw::Binary(second) = raw_next(&mut socket, QUICK).await? else { bail!("KK as phone A got no reply") };
    let mut scratch = vec![0u8; 65_535];
    state.read_message(&second, &mut scratch)?;
    let live = Client::spawn(&a_phone.name, socket, state.into_transport_mode()?);
    live.hello(json!({ "watch": [] })).await?;
    a.closed_with("the hello of a new socket replaces phone A with 4409", 4409).await?;

    let mut replay =
        connect(port, &Route::tunnel("192.0.2.60")).await?.map_err(|status| anyhow::anyhow!("refused {status}"))?;
    replay.send(Message::text(header)).await?;
    replay.send(Message::binary(first)).await?;
    let Raw::Binary(_) = raw_next(&mut replay, QUICK).await? else {
        bail!("a replayed KK first message got no second message")
    };
    tokio::time::sleep(Duration::from_millis(300)).await;
    ensure!(!live.view().closed, "a replayed KK handshake closed the live socket before any hello");
    replay.send(Message::binary(rand_bytes::<64>()?.to_vec())).await?;
    let Raw::Closed(code) = raw_next(&mut replay, QUICK).await? else { bail!("the replayed socket was not closed") };
    ensure!(code == Some(1002), "a replayed KK handshake with no valid hello closed with {code:?}");
    tokio::time::sleep(Duration::from_millis(300)).await;
    ensure!(!live.view().closed, "a replayed KK handshake closed the live socket with {:?}", live.view().close_code);
    ensure!(
        run.serve.log().contains("refused cf:192.0.2.60 (KK)"),
        "a replayed KK handshake was not counted as a failure:\n{}",
        run.serve.log_tail()
    );
    println!(
        "ok   a replayed KK first message completes the handshake, never closes the live socket, and fails with 1002"
    );

    let open = |route: Route| async move {
        connect(port, &route).await?.map_err(|status| anyhow::anyhow!("refused {status}"))
    };
    let mut held = Vec::new();
    for address in ["192.0.2.70", "192.0.2.71", "192.0.2.72", "192.0.2.73"] {
        held.push(open(Route::tunnel(address)).await?);
        held.push(open(Route::tunnel(address)).await?);
    }
    ensure!(
        first_close(port, &Route::tunnel("192.0.2.74")).await? == Some(1013),
        "the tunnel listener took a ninth pending socket"
    );
    for login in ["p1@example.com", "p2@example.com", "p3@example.com"] {
        for _ in 0..2 {
            let mut socket = open(Route::login(login)).await?;
            ensure!(
                quiet(&mut socket).await,
                "a local socket from {login} was refused while the tunnel listener was full"
            );
            held.push(socket);
        }
    }
    ensure!(
        first_close(port, &Route::login("p4@example.com")).await? == Some(1013),
        "a seventh non-loopback pending socket on the local listener took a slot kept for loopback"
    );
    let opened = kk_handshake(port, &Route::default(), &a_phone.id, &a_phone.private, &run.server_key).await?;
    let Opened::Ready(socket, transport, _) = opened else {
        bail!("a plain loopback client was refused while the kept slots were free")
    };
    let a = Client::spawn(&a_phone.name, socket, transport);
    a.hello(json!({ "watch": [] })).await?;
    live.closed_with("the loopback hello replaces the live socket with 4409", 4409).await?;
    drop(held);
    tokio::time::sleep(Duration::from_millis(300)).await;
    println!("ok   a full tunnel listener leaves the local listener open, and 6 non-loopback sockets leave 2 slots for loopback");

    let mut held =
        vec![open(Route::tunnel("2001:db8:1:2::1")).await?, open(Route::tunnel("2001:db8:1:2:ffff::2")).await?];
    ensure!(
        first_close(port, &Route::tunnel("2001:db8:1:2::3")).await? == Some(1013),
        "a third pending socket inside one IPv6 /64 was not closed with 1013"
    );
    for socket in &mut held {
        ensure!(quiet(socket).await, "a pending IPv6 socket was closed early");
    }
    drop(held);
    for host in 1..=5 {
        bad_headers(port, &Route::tunnel(&format!("2001:db8:1:3::{host:x}")), 1).await?;
    }
    let code = first_close(port, &Route::tunnel("2001:db8:1:3:abcd::99")).await?;
    ensure!(code == Some(4429), "5 failures from rotating addresses in one IPv6 /64 closed with {code:?}");
    ensure!(run.serve.log().contains("cf:2001:db8:1:3::/64"), "the IPv6 failures are not logged by /64");
    println!("ok   sockets rotating inside one IPv6 /64 share one pending cap and one failure count");
    Ok(a)
}

async fn revoke_one(run: &mut Run) -> anyhow::Result<()> {
    let s_phone = Phone::new("phone-s", "Smoke Phone S")?;
    let s = pair(run, &s_phone).await?;
    let ledger = run.serve.data.join("remote").join("devices.json");
    let text = std::fs::read_to_string(&ledger)?;
    let parsed: Value = serde_json::from_str(&text)?;
    let key = parsed["devices"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|device| device.to_string().contains("phone-s"))
        .and_then(|device| device["key"].as_str())
        .context("phone-s has no key in the ledger")?
        .to_string();
    let flipped = format!("{}{}", &key[..key.len() - 1], if key.ends_with('0') { '1' } else { '0' });
    let stamp = std::fs::metadata(&ledger)?.modified()?;
    std::fs::write(&ledger, text.replacen(&key, &flipped, 1))?;
    std::fs::File::options().write(true).open(&ledger)?.set_modified(stamp)?;
    s.closed_with("a device whose key changes under an unchanged ledger stamp closes with 4401", 4401).await?;
    let b_phone = Phone::new("phone-b", "Smoke Phone B")?;
    let b = pair(run, &b_phone).await?;
    let started = Instant::now();
    run.serve.run(&["revoke", "phone-b"])?;
    b.closed_with("a revoked device's open socket closes with 4401", 4401).await?;
    println!("     revoke to close {} ms", started.elapsed().as_millis());
    let opened =
        kk_handshake(run.serve.port, &Route::tunnel("198.51.100.16"), &b_phone.id, &b_phone.private, &run.server_key)
            .await?;
    expect_closed(opened, "a revoked device's KK is refused", 4401).await
}

async fn shared_ids(project: &str, a: &mut Client, c: &mut Client) -> anyhow::Result<()> {
    let settings = json!({ "provider": "remote-smoke-absent", "model": "absent", "thinkingLevel": "off", "access": "supervised", "worktree": { "type": "local" } });
    let mut threads = Vec::new();
    for (client, draft) in [(&mut *a, "d-shared-a"), (&mut *c, "d-shared-c")] {
        client
            .call(
                "start_thread",
                json!({ "draft": draft, "project": project, "prompt": prompt("shared start"), "settings": settings }),
            )
            .await?;
        client.until("a thread of its own for the shared ids", SETUP, |view| view.started.contains_key(draft)).await?;
        let thread = client.view().started[draft].clone();
        client.call("watch", json!({ "thread": thread })).await?;
        client.call("abort", json!({ "thread": thread })).await?;
        client.until("its thread idle before the shared sends", SETUP, |view| view.idle(&thread)).await?;
        threads.push(thread);
    }
    let mut replies = Vec::new();
    for ((client, thread), (text, unknown)) in [&mut *a, &mut *c]
        .into_iter()
        .zip(&threads)
        .zip([("shared id from A", "no-such-thread-a"), ("shared id from C", "no-such-thread-c")])
    {
        let args = json!({ "request": "r1", "thread": thread, "prompt": prompt(text), "delivery": "queue" });
        replies.push(client.reply("send", args).await?);
        let args = json!({ "request": "r2", "thread": unknown, "prompt": prompt(text), "delivery": "queue" });
        replies.push(client.reply("send", args).await?);
        client.call("list_commands", json!({ "request": "q-shared", "project": project })).await?;
    }
    ensure!(
        replies.iter().all(|reply| reply.get("ok") == Some(&json!(true)) && reply.get("duplicate").is_none()),
        "a send with another phone's request id was dropped as a duplicate: {replies:?}"
    );
    for ((client, thread), (mine, theirs)) in [&*a, &*c]
        .into_iter()
        .zip(&threads)
        .zip([("shared id from A", "shared id from C"), ("shared id from C", "shared id from A")])
    {
        client
            .until("its own send r1 in its own thread and its own answers to r2 and q-shared", QUICK, |view| {
                view.users_saying(thread, mine) == 1
                    && view.answers.get("r2").is_some_and(|kind| kind == "request_failed")
                    && view.answers.contains_key("q-shared")
            })
            .await?;
        ensure!(client.view().users_saying(thread, theirs) == 0, "{}'s thread holds the other phone's r1", client.name);
    }
    tokio::time::sleep(Duration::from_secs(2)).await;
    for (id, (client, thread)) in [&*a, &*c].into_iter().zip(&threads).enumerate() {
        let view = client.view();
        let counts = (
            view.answer_counts.get("r1").copied(),
            view.answer_counts.get("r2").copied(),
            view.answer_counts.get("q-shared").copied(),
        );
        ensure!(
            counts == (None, Some(1), Some(1)),
            "{} got {counts:?} answers to r1, r2 and q-shared, not none, one and one",
            client.name
        );
        client.frame(&json!({ "id": 920 + id, "op": "abort", "args": { "thread": thread } }));
        client.frame(&json!({ "id": 910 + id, "op": "unwatch", "args": { "thread": thread } }));
    }
    println!("ok   two phones sharing request ids: each send r1 runs in its own thread only, and each phone gets exactly its own request_failed r2 and list_commands q-shared");
    Ok(())
}

async fn restart_watch(
    run: &mut Run,
    eukhe: &Path,
    a_phone: &Phone,
    c_phone: &Phone,
    a: &mut Client,
) -> anyhow::Result<(Client, Client)> {
    let settings = json!({ "provider": "remote-smoke-absent", "model": "absent", "thinkingLevel": "off", "access": "supervised", "worktree": { "type": "local" } });
    a.call("start_thread", json!({ "draft": "d-restart", "project": run.project, "prompt": prompt("restart watch"), "settings": settings })).await?;
    a.until("a thread for the restart check", SETUP, |view| view.started.contains_key("d-restart")).await?;
    let thread = a.view().started["d-restart"].clone();
    // A worker still starting its first turn can outlive a forced Shutdown, so settle it first.
    a.call("watch", json!({ "thread": thread })).await?;
    a.call("abort", json!({ "thread": thread })).await?;
    a.until("the restart thread idle before serve stops", SETUP, |view| view.idle(&thread)).await?;
    a.call("unwatch", json!({ "thread": thread })).await?;
    let seq = a.view().seq;
    run.serve.stop()?;
    let root = run.serve.root.clone();
    stop_daemon(&root.join("d.sock"), None).await?;
    let later = root.join("eukhe-later");
    std::fs::remove_file(&later).ok();
    std::os::unix::fs::symlink(root.join("eukhe-not-yet"), &later)?;
    run.serve.start(&later, &run.hook.clone())?;
    let restarted = Instant::now();
    let deadline = restarted + SETUP;
    let resume = json!({ "seq": seq, "epoch": run.epoch, "watch": [thread.clone()] });
    let fresh = loop {
        match reconnect(run, a_phone, resume.clone()).await {
            Ok((client, _)) => break client,
            Err(error) => ensure!(
                !run.serve.exited()? && Instant::now() < deadline,
                "serve did not come back: {error:#}\n{}",
                run.serve.log_tail()
            ),
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    };
    let epoch = fresh.view().hello.as_ref().and_then(|hello| hello["epoch"].as_str()).unwrap_or_default().to_string();
    ensure!(epoch != run.epoch, "the restarted serve kept epoch {epoch}");
    ensure!(
        fresh.view().hello.as_ref().is_some_and(|hello| hello["resume"] == json!("snapshot")),
        "a resume across a serve restart was not a snapshot"
    );
    run.epoch = epoch;
    println!(
        "     phone A resumed {} ms after serve started with no daemon to reach, watching {thread}",
        restarted.elapsed().as_millis()
    );
    std::fs::remove_file(&later)?;
    std::os::unix::fs::symlink(eukhe, &later)?;
    fresh
        .until("the watched thread streams its transcript after a serve restart", SETUP, |view| {
            view.transcript_frames.get(&thread).copied().unwrap_or_default() > 0 && !view.items(&thread).is_empty()
        })
        .await?;
    fresh.frame(&json!({ "id": 900, "op": "unwatch", "args": { "thread": thread } }));
    let (c, _) = reconnect(run, c_phone, json!({ "watch": [] })).await?;
    Ok((fresh, c))
}

type Hold = (tokio::net::UnixListener, tokio::net::UnixStream, Instant);

async fn hold_core(run: &Run) -> anyhow::Result<Hold> {
    let root = run.serve.root.clone();
    let later = root.join("eukhe-later");
    std::fs::remove_file(&later)?;
    std::os::unix::fs::symlink(root.join("eukhe-not-yet"), &later)?;
    let socket = root.join("d.sock");
    stop_daemon(&socket, None).await?;
    std::fs::remove_file(&socket).ok();
    let listener = tokio::net::UnixListener::bind(&socket)?;
    let (held, _) = tokio::time::timeout(SETUP, listener.accept())
        .await
        .context("the core never came back to the daemon socket")??;
    Ok((listener, held, Instant::now()))
}

async fn release_core(run: &Run, eukhe: &Path, hold: Hold) -> anyhow::Result<Duration> {
    let held_for = hold.2.elapsed();
    drop(hold);
    let root = run.serve.root.clone();
    let socket = root.join("d.sock");
    std::fs::remove_file(&socket).ok();
    let later = root.join("eukhe-later");
    std::fs::remove_file(&later)?;
    std::os::unix::fs::symlink(eukhe, &later)?;
    ensure!(
        held_for < Duration::from_secs(14),
        "the core was held {} ms, too close to eukhe-client's 15 s hello timeout to be sure it was held throughout",
        held_for.as_millis()
    );
    let deadline = Instant::now() + SETUP;
    while DaemonClient::connect(&socket).await.is_err() {
        ensure!(Instant::now() < deadline, "the daemon did not come back after the hold:\n{}", run.serve.log_tail());
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Ok(held_for)
}

async fn upload_caps(c: &mut Client) -> anyhow::Result<()> {
    let mime = format!("image/{}", "x".repeat(294));
    c.refused("blob_put", json!({ "blob": hex(&rand_bytes::<16>()?), "size": 0, "mime": mime }), "bad_args").await?;
    let long = "r".repeat(70);
    c.frame(&json!({ "id": long, "op": "blob_put", "args": { "blob": hex(&rand_bytes::<16>()?), "size": 0, "mime": "image/png" } }));
    c.until("a blob_put with a 70-byte request id answered", SETUP, |view| view.named.contains_key(&long)).await?;
    let reply = c.view().named.remove(&long).context("no answer to the long request id")?;
    ensure!(
        reply.pointer("/error/code") == Some(&json!("bad_args")),
        "a blob_put with a 70-byte request id answered {reply}"
    );
    println!(
        "ok   C: blob_put with a 70-byte request id is refused with bad_args: {}",
        reply.pointer("/error/message").unwrap_or(&Value::Null)
    );
    let mut pending = Vec::new();
    for _ in 0..16 {
        let blob = rand_bytes::<16>()?;
        c.next += 1;
        c.frame(
            &json!({ "id": c.next, "op": "blob_put", "args": { "blob": hex(&blob), "size": 0, "mime": "image/png" } }),
        );
        pending.push((c.next, blob));
    }
    c.refused("blob_put", json!({ "blob": hex(&rand_bytes::<16>()?), "size": 0, "mime": "image/png" }), "too_many")
        .await?;
    ensure!(
        pending.iter().all(|(ask, _)| !c.view().replies.contains_key(ask)),
        "one of the first 16 pending blob_put calls was answered before its bytes: {:?}",
        c.view().replies
    );
    for (ask, blob) in pending {
        c.blob(&blob, &[]);
        let reply = c.reply_to(ask, "blob_put").await?;
        ensure!(reply.get("ok") == Some(&json!(true)), "a pending zero-size blob did not complete: {reply}");
    }
    println!("ok   upload caps: a 300-byte mime and a 70-byte request id are bad_args, and the 17th pending blob_put is too_many");
    Ok(())
}

async fn prompt_backlog(run: &Run, eukhe: &Path, a: &mut Client) -> anyhow::Result<()> {
    let hold = hold_core(run).await?;
    let mut busy = None;
    for at in 1..=70 {
        let args = json!({ "request": format!("r-backlog-{at}"), "thread": "no-such-thread-backlog", "prompt": prompt("backlog"), "delivery": "queue" });
        let reply = a.reply("send", args).await?;
        if reply.pointer("/error/code") == Some(&json!("busy")) {
            busy = Some(at);
            break;
        }
        ensure!(reply.get("ok") == Some(&json!(true)), "send {at} while the core was held answered {reply}");
    }
    let held_for = release_core(run, eukhe, hold).await?;
    let Some(busy) = busy else {
        bail!(
            "all 70 sends were accepted while the core was held for {} ms; none was refused busy",
            held_for.as_millis()
        )
    };
    ensure!(busy >= 65, "send {busy} was refused busy, before the core held 64 prompts");
    let deadline = Instant::now() + SETUP;
    loop {
        let args = json!({ "request": "r-backlog-after", "thread": "no-such-thread-backlog", "prompt": prompt("backlog after"), "delivery": "queue" });
        let reply = a.reply("send", args).await?;
        if reply.get("ok") == Some(&json!(true)) {
            break;
        }
        ensure!(
            reply.pointer("/error/code") == Some(&json!("busy")) && Instant::now() < deadline,
            "a send after the daemon came back answered {reply}"
        );
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    println!(
        "ok   prompt backlog: with the core held {} ms, send {busy} of 70 was refused busy, and a send after the daemon came back was accepted",
        held_for.as_millis()
    );
    Ok(())
}

async fn tag_isolation(run: &Run, eukhe: &Path, a: &mut Client, c: &mut Client) -> anyhow::Result<()> {
    let flood = 3000;
    let long = "r".repeat(65);
    let reply = c.reply("list_archived", json!({ "request": long })).await?;
    ensure!(reply.pointer("/error/code") == Some(&json!("bad_args")), "a 65 byte request id answered {reply}");
    let known: HashSet<String> = c.view().answers.keys().cloned().collect();
    let hold = hold_core(run).await?;
    a.call("send", json!({ "request": "r-own", "thread": "no-such-thread-tags", "prompt": prompt("tag isolation"), "delivery": "queue" })).await?;
    c.call("list_archived", json!({ "request": "q-first" })).await?;
    let first = c.next + 1;
    for at in 0..flood {
        c.next += 1;
        c.frame(&json!({ "id": c.next, "op": "list_archived", "args": { "request": format!("q-flood-{at}") } }));
    }
    let last = c.next;
    c.until("3,000 flood requests answered while the core holds phone A's send", QUICK, |view| {
        (first..=last).all(|id| view.replies.contains_key(&id))
    })
    .await?;
    let accepted: Vec<usize> =
        (0..flood).filter(|at| c.view().replies[&(first + *at as u64)].get("ok") == Some(&json!(true))).collect();
    let busy = (first..=last).filter(|id| c.view().replies[id].pointer("/error/code") == Some(&json!("busy"))).count();
    ensure!(
        accepted.len() == 63 && busy == flood - 63,
        "with q-first waiting, {} flood requests were accepted and {busy} refused busy, expected 63 and {}",
        accepted.len(),
        flood - 63
    );
    let held_for = release_core(run, eukhe, hold).await?;
    a.until("its own request_failed for r-own after the flood", SETUP, |view| {
        view.answers.get("r-own").is_some_and(|kind| kind == "request_failed")
    })
    .await?;
    c.until("the answer to q-first, sent before the flood", SETUP, |view| {
        view.answers.contains_key("q-first") || view.closed
    })
    .await?;
    let tail = format!("q-flood-{}", accepted.last().copied().unwrap_or_default());
    c.until("the answer to its last accepted flood request", SETUP, |view| {
        view.answers.contains_key(&tail) || view.closed
    })
    .await?;
    let reply = c.reply("list_archived", json!({ "request": "q-after" })).await?;
    ensure!(reply.get("ok") == Some(&json!(true)), "a request after the answers came back answered {reply}");
    tokio::time::sleep(Duration::from_secs(2)).await;
    let view = c.view();
    ensure!(!view.closed, "phone C was disconnected during the flood: {:?}", view.close_code);
    let foreign: Vec<&String> =
        view.answers.keys().filter(|request| !known.contains(*request) && !request.starts_with("q-")).collect();
    ensure!(foreign.is_empty(), "phone C saw request outcomes that were not its own: {foreign:?}");
    println!(
        "ok   tag isolation: with the core held {} ms, phone C's q-first and its 63 accepted flood requests were answered, the other {busy} were refused busy, a 65 byte id was refused, and phone A's request_failed r-own reached only phone A",
        held_for.as_millis()
    );
    drop(view);
    c.view().replies.clear();
    Ok(())
}

fn serve_fd(pid: u32, serve_port: u16, socket: &Socket) -> anyhow::Result<(String, impl Fn() -> anyhow::Result<bool>)> {
    let MaybeTlsStream::Plain(tcp) = socket.get_ref() else { bail!("the phone's socket is not plain TCP") };
    let local = tcp.local_addr()?.port();
    let port = |field: &str| field.rsplit(':').next().and_then(|hex| u16::from_str_radix(hex, 16).ok());
    let table = std::fs::read_to_string(format!("/proc/{pid}/net/tcp"))?;
    let rows: Vec<&str> = table
        .lines()
        .skip(1)
        .filter_map(|line| {
            let fields: Vec<&str> = line.split_whitespace().collect();
            let ours = port(fields.get(1)?)? == serve_port && port(fields.get(2)?)? == local;
            (ours && *fields.get(3)? == "01" && *fields.get(9)? != "0").then(|| fields[9])
        })
        .collect();
    let [inode] = rows[..] else {
        bail!(
            "{} established rows in /proc/net/tcp for serve's end of the phone's connection, expected one",
            rows.len()
        )
    };
    let link = format!("socket:[{inode}]");
    let target = link.clone();
    let held = move || -> anyhow::Result<bool> {
        let entries = std::fs::read_dir(format!("/proc/{pid}/fd")).context("serve's fd table is gone")?;
        Ok(entries
            .filter_map(Result::ok)
            .any(|entry| std::fs::read_link(entry.path()).is_ok_and(|to| to.as_os_str() == target.as_str())))
    };
    Ok((link, held))
}

async fn writer_abort(run: &Run, c_phone: &Phone) -> anyhow::Result<Client> {
    let pid = run.serve.child.as_ref().context("serve is not running")?.id();
    let huge = (0..23_000).fold(String::new(), |mut huge, line| {
        writeln!(huge, "line {line:05} of a file that fills the socket while nobody reads it").ok();
        huge
    });
    std::fs::write(run.work.join("huge.txt"), &huge)?;
    let Opened::Ready(mut socket, transport, _) =
        kk_handshake(run.serve.port, &Route::default(), &c_phone.id, &c_phone.private, &run.server_key).await?
    else {
        bail!("phone C's KK was refused:\n{}", run.serve.log_tail())
    };
    let (link, held) = serve_fd(pid, run.serve.port, &socket)?;
    let transport = Mutex::new(transport);
    let mut frames = vec![
        json!({ "op": "hello", "device": { "name": "Smoke Phone C", "app": "0.4.1", "channel": CHANNEL }, "resume": { "watch": [] } }),
    ];
    frames.extend((1..=12).map(|at| json!({ "id": at, "op": "read_file", "args": { "request": format!("q-huge-{at}"), "project": run.project, "relative": "huge.txt" } })));
    for frame in frames {
        for record in records(1, frame.to_string().as_bytes(), 65_000) {
            let message = seal(&transport, &record).context("seal")?;
            socket.send(Message::binary(message)).await?;
        }
    }
    tokio::time::sleep(Duration::from_secs(3)).await;
    ensure!(held()?, "serve holds no fd for the unread socket {link} after 3 s");
    socket.send(Message::binary(vec![0u8; 64])).await?;
    let sent = Instant::now();
    while held()? {
        ensure!(
            sent.elapsed() < Duration::from_secs(5),
            "5 s after a bad record ended the reader, serve still holds {link}: the writer is stuck on the unread socket"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    println!(
        "ok   writer abort: {} KiB of read_file blobs left unread on {link}, and serve closed its fd {} ms after a bad record",
        12 * huge.len() / 1024,
        sent.elapsed().as_millis()
    );
    drop(socket);
    let (c, _) = reconnect(run, c_phone, json!({ "watch": [] })).await?;
    Ok(c)
}

async fn revoke_blocked(run: &mut Run) -> anyhow::Result<()> {
    let pid = run.serve.child.as_ref().context("serve is not running")?.id();
    let r_phone = Phone::new("phone-r", "Smoke Phone R")?;
    drop(pair(run, &r_phone).await?);
    let Opened::Ready(mut socket, transport, _) =
        kk_handshake(run.serve.port, &Route::default(), &r_phone.id, &r_phone.private, &run.server_key).await?
    else {
        bail!("phone R's KK was refused:\n{}", run.serve.log_tail())
    };
    let (link, held) = serve_fd(pid, run.serve.port, &socket)?;
    let transport = Mutex::new(transport);
    let mut frames = vec![
        json!({ "op": "hello", "device": { "name": "Smoke Phone R", "app": "0.4.1", "channel": CHANNEL }, "resume": { "watch": [] } }),
    ];
    frames.extend((1..=12).map(|at| json!({ "id": at, "op": "read_file", "args": { "request": format!("q-revoked-{at}"), "project": run.project, "relative": "huge.txt" } })));
    for frame in frames {
        for record in records(1, frame.to_string().as_bytes(), 65_000) {
            let message = seal(&transport, &record).context("seal")?;
            socket.send(Message::binary(message)).await?;
        }
    }
    tokio::time::sleep(Duration::from_secs(3)).await;
    ensure!(held()?, "serve holds no fd for phone R's unread socket {link} after 3 s");
    run.serve.run(&["revoke", "phone-r"])?;
    let revoked = Instant::now();
    while held()? {
        ensure!(
            revoked.elapsed() < Duration::from_secs(4),
            "4 s after revoke, serve still holds {link}: the revoked socket's blocked writer kept it open"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    println!(
        "ok   revoke ends a socket whose writer is blocked on unread blobs: its fd closed {} ms after revoke",
        revoked.elapsed().as_millis()
    );
    drop(socket);
    Ok(())
}

async fn watch_churn(run: &mut Run, eukhe: &Path) -> anyhow::Result<()> {
    let w_phone = Phone::new("phone-w", "Smoke Phone W")?;
    drop(pair(run, &w_phone).await?);
    let hold = hold_core(run).await?;
    let mut refused = None;
    let mut clients = Vec::new();
    for at in 0..12 {
        let watch: Vec<String> = (0..64).map(|thread| format!("churn-{}-{thread}", at % 2)).collect();
        let Opened::Ready(socket, transport, _) =
            kk_handshake(run.serve.port, &Route::default(), &w_phone.id, &w_phone.private, &run.server_key).await?
        else {
            bail!("phone W's KK was refused:\n{}", run.serve.log_tail())
        };
        let client = Client::spawn(&w_phone.name, socket, transport);
        client.frame(&json!({ "op": "hello", "device": { "name": "Smoke Phone W", "app": "0.4.1", "channel": CHANNEL }, "resume": { "watch": watch } }));
        client.until("hello or a close", QUICK, |view| view.hello.is_some() || view.closed).await?;
        if client.view().hello.is_none() {
            let code = client.view().close_code;
            ensure!(code == Some(1013), "churn reconnect {at} closed with {code:?}, expected 1013");
            refused = Some(at);
            break;
        }
        clients.push(client);
    }
    drop(clients);
    let held_for = release_core(run, eukhe, hold).await?;
    let Some(refused) = refused else {
        bail!(
            "all 12 reconnects with alternating 64-thread watch sets were accepted while the core was held {} ms",
            held_for.as_millis()
        )
    };
    ensure!(refused >= 2, "churn reconnect {refused} was refused before the core queue could be near full");
    println!(
        "ok   watch churn: with the core held {} ms, reconnect {refused} of 12 that would grow the core queue past its cap was refused with 1013",
        held_for.as_millis()
    );
    Ok(())
}

#[allow(clippy::too_many_lines)]
async fn model_stage(run: &mut Run, model: &Target, a: &mut Client, c: &Client) -> anyhow::Result<()> {
    let settings = serde_json::to_value(ThreadSettings {
        provider: Some(model.provider.clone()),
        model: Some(model.model.clone()),
        thinking_level: Some(model.thinking.clone()),
        access: AccessMode::FullAccess,
        worktree: WorktreeChoice::Local,
    })?;
    let image = png(64);
    let blob = a.upload(&image, "image/png").await?;
    let text = bash_prompt("printf remote-ok > remote-proof.txt");
    let started = Instant::now();
    let images = if model.images { vec![blob.clone()] } else { Vec::new() };
    a.call("start_thread", json!({ "draft": "d-tool", "project": run.project, "prompt": { "text": text, "images": images, "files": [] }, "settings": settings })).await?;
    a.until("thread_started", MODEL_STEP, |view| view.started.contains_key("d-tool")).await?;
    let thread = a.view().started["d-tool"].clone();
    a.call("watch", json!({ "thread": thread })).await?;
    a.until("a streamed turn with a tool call and a reply", MODEL_STEP, |view| {
        view.streamed(&thread, |kind| matches!(kind, ItemKind::Tool { .. }))
            && view.streamed(&thread, |kind| matches!(kind, ItemKind::Assistant { .. }))
            && view.replies_done(&thread) >= 1
            && view.idle(&thread)
    })
    .await?;
    let proof = std::fs::read_to_string(run.work.join("remote-proof.txt"))
        .context("the tool call wrote no remote-proof.txt")?;
    ensure!(proof.contains("remote-ok"), "remote-proof.txt holds {proof:?}");
    println!(
        "PASS model stage: a streamed turn with a real tool call over the wire\nok   the real bash call wrote remote-proof.txt ({:.0} s for the first turn)",
        started.elapsed().as_secs_f64()
    );
    let image_thread = if model.images {
        thread.clone()
    } else {
        // Eukhe refuses an image turn on a text-only model, so the image goes to a thread of the
        // unreachable provider: its user item still holds the image for load_message_image.
        let blob = a.upload(&image, "image/png").await?;
        let absent = json!({ "provider": "remote-smoke-absent", "model": "absent", "thinkingLevel": "off", "access": "supervised", "worktree": { "type": "local" } });
        a.call("start_thread", json!({ "draft": "d-image", "project": run.project, "prompt": { "text": "image round trip", "images": [blob], "files": [] }, "settings": absent })).await?;
        a.until("a thread for the image round trip", MODEL_STEP, |view| view.started.contains_key("d-image")).await?;
        let image_thread = a.view().started["d-image"].clone();
        a.call("watch", json!({ "thread": image_thread })).await?;
        image_thread
    };
    a.until("the user item with the image", MODEL_STEP, |view| {
        view.items(&image_thread)
            .iter()
            .any(|item| matches!(&item.kind, ItemKind::User { images, entry: Some(_), .. } if *images > 0))
    })
    .await?;
    let entry = a.view().items(&image_thread).iter().find_map(|item| match &item.kind {
        ItemKind::User { images, entry: Some(entry), .. } if *images > 0 => Some(entry.clone()),
        _ => None,
    });
    let entry = entry.context("the user item carries no image")?;
    a.call("load_message_image", json!({ "request": "q-image", "thread": image_thread, "entry": entry, "index": 0 }))
        .await?;
    a.until("load_message_image answers with a blob", MODEL_STEP, |view| {
        view.blobs.values().any(|blob| blob.request == "q-image" && blob.done)
    })
    .await?;
    {
        let view = a.view();
        let got = view.blobs.values().find(|blob| blob.request == "q-image").context("no image blob")?;
        ensure!(
            got.mime.starts_with("image/") && got.data.len() == got.size && got.size > 0,
            "image blob {} {}",
            got.mime,
            got.size
        );
        println!("ok   the uploaded image went into the turn and came back as a {} byte {} blob", got.size, got.mime);
    }

    let replies = a.view().replies_done(&thread);
    let frames = a.view().transcript_frames.get(&thread).copied().unwrap_or_default();
    let updates = a.view().thread_updates.get(&thread).copied().unwrap_or_default();
    a.view().first_text_at.remove(&thread);
    let sent = Instant::now();
    let args = json!({ "request": "r-once", "thread": thread, "prompt": prompt(ONCE_TEXT), "delivery": "queue" });
    a.call("send", args.clone()).await?;
    let retry = a.reply("send", args).await?;
    ensure!(
        retry.get("ok") == Some(&json!(true)) && retry.get("duplicate") == Some(&json!(true)),
        "the retried send was not answered as a duplicate: {retry}"
    );
    a.until("first update for the thread after send", MODEL_STEP, |view| {
        view.thread_updates.get(&thread).copied().unwrap_or_default() > updates
    })
    .await?;
    let first_thread_update = sent.elapsed();
    a.until("first transcript update after send", MODEL_STEP, |view| {
        view.transcript_frames.get(&thread).copied().unwrap_or_default() > frames
    })
    .await?;
    let first_update = sent.elapsed();
    a.until("the once turn finished", MODEL_STEP, |view| view.replies_done(&thread) > replies && view.idle(&thread))
        .await?;
    let first_text = a.view().first_text_at.get(&thread).map(|at| at.duration_since(sent));
    tokio::time::sleep(Duration::from_secs(2)).await;
    let once = a.view().users_saying(&thread, ONCE_TEXT);
    ensure!(once == 1, "the retried send ran {once} times");
    println!("ok   a retried send with the same request id ran once");
    run.report.push(format!("phone: send to first update for the thread {} ms", first_thread_update.as_millis()));
    run.report.push(format!("phone: send to first transcript update {} ms", first_update.as_millis()));
    for line in run.serve.log().lines().filter(|line| line.contains("send r-once ")) {
        run.report.push(format!("server: {}", line.trim_start_matches("local-studio-serve: ")));
    }
    if let Some(first_text) = first_text {
        run.report
            .push(format!("phone: send to first streamed assistant text {} ms (model time)", first_text.as_millis()));
    }

    a.call("rename_thread", json!({ "thread": thread, "title": "Remote smoke thread" })).await?;
    a.until("rename_thread shows in the row", QUICK, |view| {
        view.row(&thread).is_some_and(|row| row.title == "Remote smoke thread")
    })
    .await?;
    a.call("set_pinned", json!({ "thread": thread, "pinned": true })).await?;
    a.until("set_pinned shows in the row", QUICK, |view| view.row(&thread).is_some_and(|row| row.pinned)).await?;
    a.call("set_pinned", json!({ "thread": thread, "pinned": false })).await?;
    a.call("mark_unread", json!({ "thread": thread, "unread": true })).await?;
    a.until("mark_unread shows in the row", QUICK, |view| view.row(&thread).is_some_and(|row| row.unread)).await?;
    let until =
        i64::try_from(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_millis())? + 3_600_000;
    a.call("snooze", json!({ "thread": thread, "until": until })).await?;
    a.until("snooze shows in the row", QUICK, |view| view.row(&thread).is_some_and(|row| row.snoozed_until.is_some()))
        .await?;
    a.call("snooze", json!({ "thread": thread, "until": null })).await?;
    a.call("set_settled", json!({ "thread": thread, "settled": true })).await?;
    a.call("set_settled", json!({ "thread": thread, "settled": false })).await?;
    a.call("set_archived", json!({ "thread": thread, "archived": true })).await?;
    a.until("set_archived shows in the row", QUICK, |view| view.row(&thread).is_none_or(|row| row.archived)).await?;
    a.call("set_archived", json!({ "thread": thread, "archived": false })).await?;
    a.until("the thread is back from the archive", QUICK, |view| view.row(&thread).is_some_and(|row| !row.archived))
        .await?;
    a.call("set_model", json!({ "thread": thread, "provider": model.provider, "model": model.model })).await?;
    a.call("set_thinking_level", json!({ "thread": thread, "level": model.thinking })).await?;
    a.call("set_access_mode", json!({ "thread": thread, "mode": "supervised" })).await?;
    a.until("set_access_mode shows on the thread", QUICK, |view| {
        view.access.get(&thread) == Some(&AccessMode::Supervised)
    })
    .await?;
    a.call("set_access_mode", json!({ "thread": thread, "mode": "fullAccess" })).await?;
    a.until("full access again", QUICK, |view| view.access.get(&thread) == Some(&AccessMode::FullAccess)).await?;
    for (op, args) in [
        ("answer_approval", json!({ "thread": thread, "request": "no-such-approval", "answer": "deny" })),
        ("send_queued_now", json!({ "thread": thread, "queued": "no-such-message" })),
        ("remove_queued", json!({ "thread": thread, "queued": "no-such-message" })),
        ("cancel_subagent", json!({ "thread": thread, "child": "no-such-child" })),
    ] {
        a.call(op, args).await?;
        println!("ok   {op} is accepted over the wire");
    }
    let kind = a.answered("load_diff", json!({ "request": "q-turn-diff", "project": run.project, "scope": { "type": "latest_turn", "thread": thread } }), "q-turn-diff").await?;
    println!("     load_diff for the latest turn answered with {kind}");
    let rows = a.view().threads.len();
    a.call("fork_thread", json!({ "thread": thread })).await?;
    a.until("fork_thread adds a row", MODEL_STEP, |view| view.threads.len() > rows).await?;
    a.until("the thread is idle before the abort check", MODEL_STEP, |view| view.idle(&thread)).await?;
    let tools = a.view().tools(&thread);

    a.call("send", json!({ "request": "r-sleep", "thread": thread, "prompt": prompt(&bash_prompt(SLEEP_COMMAND)), "delivery": "queue" })).await?;
    a.until("the sleep turn is running its bash call", MODEL_STEP, |view| {
        view.working(&thread) && view.tools(&thread) > tools
    })
    .await?;
    a.call("abort", json!({ "thread": thread })).await?;
    a.until("abort: the thread leaves Working within 20 s", ABORT_BOUND, |view| view.idle(&thread)).await?;
    a.call("regenerate_title", json!({ "thread": thread })).await?;
    println!("ok   regenerate_title is accepted over the wire");
    a.call("compact", json!({ "thread": thread })).await?;
    println!("ok   compact is accepted over the wire");
    a.call("unwatch", json!({ "thread": thread })).await?;

    let leaked = c.view().transcript_frames.get(&thread).copied().unwrap_or_default();
    ensure!(leaked == 0, "phone C got {leaked} transcript updates for a thread it never watched");
    ensure!(!c.view().answers.contains_key("q-image") && c.view().blobs.is_empty(), "phone C got phone A's answers");
    println!("ok   phone C got none of phone A's transcript updates, answers or blobs");
    ensure!(a.view().seq_gaps == 0 && c.view().seq_gaps == 0, "update seq skipped");
    println!("ok   update seq rose by one per frame on every socket ({} updates on phone A)", a.view().updates);
    let posts = run.posts.lock().unwrap_or_else(PoisonError::into_inner).clone();
    ensure!(!posts.is_empty(), "the notify hook got no notification");
    for post in &posts {
        let keys: HashSet<&str> =
            post.as_object().map(|post| post.keys().map(String::as_str).collect()).unwrap_or_default();
        ensure!(keys == HashSet::from(["machine", "kind", "thread"]), "a notify post carries {keys:?}");
        ensure!(
            !post.to_string().contains("remote-ok") && !post.to_string().contains("once"),
            "a notify post carries message text: {post}"
        );
    }
    println!("ok   the notify webhook got {} posts with only machine, kind and thread: {}", posts.len(), posts[0]);
    Ok(())
}

async fn duplicate_replay(a: &mut Client) -> anyhow::Result<()> {
    let args = json!({ "request": "r-dup", "thread": "no-such-thread-dup", "prompt": prompt("duplicate"), "delivery": "queue" });
    let first = a.reply("send", args.clone()).await?;
    ensure!(
        first.get("ok") == Some(&json!(true)) && first.get("duplicate").is_none(),
        "the first send answered {first}"
    );
    a.until("request_failed for r-dup", SETUP, |view| view.answer_counts.get("r-dup") == Some(&1)).await?;
    let again = a.reply("send", args).await?;
    ensure!(
        again.get("ok") == Some(&json!(true)) && again.get("duplicate") == Some(&json!(true)),
        "a second send r-dup answered {again}"
    );
    a.until("the duplicate's outcome is sent again", QUICK, |view| view.answer_counts.get("r-dup") == Some(&2)).await?;
    ensure!(a.view().answers["r-dup"] == "request_failed", "the replayed outcome is {}", a.view().answers["r-dup"]);
    println!("ok   a duplicate send is answered {again} and its request_failed is sent again");
    let settings = serde_json::to_value(ThreadSettings {
        provider: None,
        model: None,
        thinking_level: None,
        access: AccessMode::Supervised,
        worktree: WorktreeChoice::Local,
    })?;
    let args = json!({ "draft": "d-dup", "project": "/no-such-project-dup", "prompt": prompt("duplicate start"), "settings": settings });
    let first = a.reply("start_thread", args.clone()).await?;
    ensure!(
        first.get("ok") == Some(&json!(true)) && first.get("duplicate").is_none(),
        "the first start_thread answered {first}"
    );
    a.until("request_failed for d-dup", SETUP, |view| view.answer_counts.get("d-dup") == Some(&1)).await?;
    let again = a.reply("start_thread", args).await?;
    ensure!(
        again.get("ok") == Some(&json!(true)) && again.get("duplicate") == Some(&json!(true)),
        "a second start_thread d-dup answered {again}"
    );
    a.until("the failed start_thread's outcome is sent again", QUICK, |view| {
        view.answer_counts.get("d-dup") == Some(&2)
    })
    .await?;
    ensure!(a.view().answers["d-dup"] == "request_failed", "the replayed outcome is {}", a.view().answers["d-dup"]);
    println!("ok   a duplicate of a failed start_thread is answered {again} and its request_failed is sent again");
    Ok(())
}

fn pending(view: &View, thread: &str) -> bool {
    view.approvals.get(thread).is_some_and(|approvals| !approvals.is_empty())
}

async fn approve_and_finish(a: &mut Client, thread: &str, proof: &Path, step: &str) -> anyhow::Result<()> {
    let request = a.view().approvals[thread][0].request_id.clone();
    let replies = a.view().replies_done(thread);
    a.call("answer_approval", json!({ "thread": thread, "request": request, "answer": "approve" })).await?;
    a.until(&format!("{step}: the approved turn finishes"), MODEL_STEP, |view| {
        !pending(view, thread) && view.replies_done(thread) > replies && view.idle(thread)
    })
    .await?;
    ensure!(proof.is_file(), "{step}: the approved command wrote no {}", proof.display());
    Ok(())
}

/// C raises an approval on `thread` while A has no socket.
async fn approval_while_away(c: &mut Client, thread: &str, request: &str, file: &str) -> anyhow::Result<()> {
    let before = c.view().needs_approval.get(thread).copied().unwrap_or_default();
    let command = format!("printf {request} > {file}");
    c.call(
        "send",
        json!({ "request": request, "thread": thread, "prompt": prompt(&bash_prompt(&command)), "delivery": "queue" }),
    )
    .await?;
    c.until(&format!("needs_approval for {request} while phone A is away"), MODEL_STEP, |view| {
        view.needs_approval.get(thread).copied().unwrap_or_default() > before
    })
    .await?;
    Ok(())
}

/// docs/remote.md, Session: an approval reaches the phone on `watch`, after a `delta` resume, after a
/// `snapshot` resume, and after a `serve` restart.
#[allow(clippy::too_many_lines)]
async fn approval_recovery(
    run: &mut Run,
    eukhe: &Path,
    model: &Target,
    a_phone: &Phone,
    c_phone: &Phone,
    mut a: Client,
    mut c: Client,
) -> anyhow::Result<(Client, Client)> {
    let settings = serde_json::to_value(ThreadSettings {
        provider: Some(model.provider.clone()),
        model: Some(model.model.clone()),
        thinking_level: Some(model.thinking.clone()),
        access: AccessMode::Supervised,
        worktree: WorktreeChoice::Local,
    })?;
    let text = bash_prompt("printf one > approval-1.txt");
    a.call(
        "start_thread",
        json!({ "draft": "d-approve", "project": run.project, "prompt": prompt(&text), "settings": settings }),
    )
    .await?;
    a.until("thread_started for the approval thread", MODEL_STEP, |view| view.started.contains_key("d-approve"))
        .await?;
    let thread = a.view().started["d-approve"].clone();
    a.until("needs_approval while phone A does not watch the thread", MODEL_STEP, |view| {
        view.needs_approval.get(&thread).copied().unwrap_or_default() >= 1
    })
    .await?;
    ensure!(!a.view().approvals.contains_key(&thread), "phone A got approvals for a thread it does not watch");
    a.call("watch", json!({ "thread": thread })).await?;
    a.until("watch sends the approval that was already pending", QUICK, |view| pending(view, &thread)).await?;
    println!("ok   an approval pending before watch arrives on watch");
    approve_and_finish(&mut a, &thread, &run.work.join("approval-1.txt"), "pending before watch").await?;

    for (mode, file) in [("delta", "approval-2.txt"), ("snapshot", "approval-3.txt")] {
        let seq = a.view().seq;
        drop(a);
        tokio::time::sleep(Duration::from_millis(300)).await;
        approval_while_away(&mut c, &thread, &format!("r-away-{mode}"), file).await?;
        let epoch = if mode == "delta" { run.epoch.clone() } else { "not-this-epoch".to_string() };
        let (back, _) =
            reconnect(run, a_phone, json!({ "seq": seq, "epoch": epoch, "watch": [thread.clone()] })).await?;
        a = back;
        let said = a.view().hello.as_ref().map(|hello| hello["resume"].clone()).unwrap_or_default();
        ensure!(said == json!(mode), "the resume answered {said}, expected {mode}");
        a.until(&format!("the approval raised while away arrives after a {mode} resume"), QUICK, |view| {
            pending(view, &thread)
        })
        .await?;
        println!("ok   an approval raised during a disconnect arrives after a {mode} resume");
        approve_and_finish(&mut a, &thread, &run.work.join(file), mode).await?;
    }

    a.call("unwatch", json!({ "thread": thread })).await?;
    let seq = a.view().seq;
    drop(a);
    tokio::time::sleep(Duration::from_millis(300)).await;
    approval_while_away(&mut c, &thread, "r-away-unwatched", "approval-5.txt").await?;
    let (back, _) = reconnect(run, a_phone, json!({ "seq": seq, "epoch": run.epoch, "watch": [] })).await?;
    a = back;
    let said = a.view().hello.as_ref().map(|hello| hello["resume"].clone()).unwrap_or_default();
    ensure!(said == json!("delta"), "the resume answered {said}, expected delta");
    a.until("needs_approval on an unwatched thread replays after a delta resume", QUICK, |view| {
        view.needs_approval.get(&thread).copied().unwrap_or_default() >= 1
    })
    .await?;
    println!("ok   an approval raised on an unwatched thread during a disconnect shows on Home after a delta resume");
    a.call("watch", json!({ "thread": thread })).await?;
    a.until("watch sends the approval raised while away", QUICK, |view| pending(view, &thread)).await?;
    approve_and_finish(&mut a, &thread, &run.work.join("approval-5.txt"), "unwatched delta").await?;

    drop(a);
    tokio::time::sleep(Duration::from_millis(300)).await;
    approval_while_away(&mut c, &thread, "r-away-restart", "approval-4.txt").await?;
    c.call("watch", json!({ "thread": thread })).await?;
    c.until("phone C sees the approval pending before the serve stop", QUICK, |view| pending(view, &thread)).await?;
    let original = c.view().approvals[&thread][0].request_id.clone();
    drop(c);
    run.serve.stop()?;
    run.serve.start(eukhe, &run.hook.clone())?;
    let deadline = Instant::now() + SETUP;
    let resume = json!({ "seq": 1, "epoch": run.epoch, "watch": [thread.clone()] });
    a = loop {
        match reconnect(run, a_phone, resume.clone()).await {
            Ok((client, _)) => break client,
            Err(error) => ensure!(
                !run.serve.exited()? && Instant::now() < deadline,
                "serve did not come back: {error:#}\n{}",
                run.serve.log_tail()
            ),
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    };
    let (said, epoch) = a
        .view()
        .hello
        .as_ref()
        .map(|hello| (hello["resume"].clone(), hello["epoch"].as_str().unwrap_or_default().to_string()))
        .unwrap_or_default();
    ensure!(
        said == json!("snapshot") && epoch != run.epoch,
        "after a serve restart the resume answered {said} in epoch {epoch}"
    );
    run.epoch = epoch;
    a.until("the thread's full state after a serve restart", SETUP, |view| {
        !view.items(&thread).is_empty() && view.busy.contains_key(&thread)
    })
    .await?;
    let proof = run.work.join("approval-4.txt");
    let settle = Instant::now() + MODEL_STEP;
    let mut denied = 0;
    loop {
        let state = {
            let view = a.view();
            format!(
                "busy {:?}, working {}, {} items, approvals {:?}",
                view.busy.get(&thread),
                view.working(&thread),
                view.items(&thread).len(),
                view.approvals.get(&thread)
            )
        };
        ensure!(
            Instant::now() < settle && denied < 4,
            "after the serve restart the thread never settled ({denied} retried approvals denied): {state}"
        );
        let next = a
            .until("the restarted thread settles or asks again", MODEL_STEP, |view| {
                view.idle(&thread) || pending(view, &thread)
            })
            .await;
        if let Err(error) = next {
            bail!("{error:#}; {state}");
        }
        if !pending(&a.view(), &thread) {
            break;
        }
        let request = a.view().approvals[&thread][0].request_id.clone();
        ensure!(
            request != original,
            "the approval {original} pending at the serve stop is still pending after the restart: {state}"
        );
        println!("     the model asked again after the restart; denying {request}");
        a.call("answer_approval", json!({ "thread": thread, "request": request, "answer": "deny" })).await?;
        a.until("the denied retry clears", QUICK, |view| {
            view.approvals.get(&thread).is_none_or(|list| list.iter().all(|item| item.request_id != request))
        })
        .await?;
        denied += 1;
    }
    ensure!(!proof.exists(), "the step whose approval was pending at the serve stop ran anyway: {}", proof.display());
    println!("ok   after a serve restart the phone gets the thread's full state, and the approval pending at the stop was denied");
    a.call("fork_thread", json!({ "thread": thread })).await?;
    a.until("thread_started for a fork the phone asked for", SETUP, |view| {
        view.started.keys().any(|draft| draft.starts_with("fork:"))
    })
    .await?;
    a.call("unwatch", json!({ "thread": thread })).await?;
    let (c, _) = reconnect(run, c_phone, json!({ "watch": [] })).await?;
    Ok((a, c))
}

fn alive(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

async fn stop_daemon(socket: &Path, known: Option<u32>) -> anyhow::Result<()> {
    let mut pid = known;
    if let Ok((client, _events)) = DaemonClient::connect(socket).await {
        pid =
            client.hello().get("supervisorPid").and_then(Value::as_u64).and_then(|pid| u32::try_from(pid).ok()).or(pid);
        let command = DaemonCommand::Shutdown { id: None, force: Some(true), if_idle: None, rest: Map::default() };
        client.request_ok(command).await.ok();
        client.close();
    }
    let Some(pid) = pid else {
        println!("ok   no daemon was running");
        return Ok(());
    };
    let deadline = Instant::now() + Duration::from_secs(15);
    while alive(pid) {
        if Instant::now() >= deadline {
            bail!("daemon {pid} is still running after Shutdown");
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    println!("ok   daemon {pid} stopped");
    Ok(())
}

fn usage_check(eukhe: &Path, data: &Path, model: &Target) -> anyhow::Result<()> {
    let mut report: Option<UsageReport> = None;
    desktop(
        eukhe,
        data,
        "usage report loaded",
        |studio, update| match update {
            Update::Connection { state: local_studio_core::Connection::Ready } => {
                studio.load_usage("usage-1".to_string(), UsagePeriod::Day);
                Ok(false)
            }
            Update::Usage { report: loaded, .. } => {
                report = Some(loaded);
                Ok(true)
            }
            Update::RequestFailed { request, message } if request == "usage-1" => {
                bail!("the usage report failed: {message}")
            }
            _ => Ok(false),
        },
        |_| {},
    )?;
    let report = report.context("no usage report")?;
    let entry = report.by_model.iter().find(|entry| entry.provider == model.provider && entry.model == model.model);
    println!(
        "     usage: {} sessions, {} tokens (in {} out {}), ${:.4}; {}/{} {} tokens ${:.4}",
        report.sessions,
        report.total_tokens,
        report.input_tokens,
        report.output_tokens,
        report.cost_usd,
        model.provider,
        model.model,
        entry.map_or(0, |entry| entry.tokens),
        entry.map_or(0.0, |entry| entry.cost_usd),
    );
    let entry = entry.context("the usage report has no entry for the model")?;
    ensure!(
        report.input_tokens > 0 && report.output_tokens > 0 && entry.tokens > 0,
        "the usage report counts no real tokens"
    );
    println!("ok   usage counts real tokens for {}/{} (a local model is priced at $0)", model.provider, model.model);
    Ok(())
}

#[allow(clippy::too_many_lines)]
async fn drive(run: &mut Run, eukhe: &Path, model: Option<&Target>) -> anyhow::Result<()> {
    run.serve.start(eukhe, &run.hook.clone())?;
    transport_checks(run, eukhe).await?;
    let a_phone = Phone::new("phone-a", "Smoke Phone A")?;
    let mut a = pairing_checks(run, &a_phone).await?;
    op_checks(run, &mut a).await?;
    let c_phone = Phone::new("phone-c", "Smoke Phone C")?;
    let mut c = pair(run, &c_phone).await?;
    let a = resume_checks(run, a, &a_phone, &mut c).await?;
    let a = limit_checks(run, a, &a_phone).await?;
    let mut a = listener_checks(run, a, &a_phone).await?;
    revoke_one(run).await?;
    shared_ids(&run.project.clone(), &mut a, &mut c).await?;
    duplicate_replay(&mut a).await?;
    let (mut a, mut c) = restart_watch(run, eukhe, &a_phone, &c_phone, &mut a).await?;
    let steps = std::env::var("REMOTE_SMOKE_STEPS").unwrap_or_default();
    let step = |name: &str| steps.is_empty() || steps.split(',').any(|chosen| chosen == name);
    if step("caps") {
        upload_caps(&mut c).await?;
    }
    if step("backlog") {
        prompt_backlog(run, eukhe, &mut a).await?;
        watch_churn(run, eukhe).await?;
    }
    if step("tags") {
        tag_isolation(run, eukhe, &mut a, &mut c).await?;
    }
    let mut c = if step("writer") {
        drop(c);
        let c = writer_abort(run, &c_phone).await?;
        revoke_blocked(run).await?;
        c
    } else {
        c
    };
    println!("PASS remote smoke: non-model stages");
    let model_outcome = match model {
        Some(model) => match model_stage(run, model, &mut a, &c).await {
            Ok(()) => {
                let (new_a, new_c) = approval_recovery(run, eukhe, model, &a_phone, &c_phone, a, c).await?;
                a = new_a;
                c = new_c;
                Ok(())
            }
            Err(error) => Err(error),
        },
        None => Err(anyhow::anyhow!(
            "model stage: LOCAL_STUDIO_SMOKE_AGENT is unset. Point it at a creds dir whose models.json names a local provider (abbey1: ~/.cache/ls-creds, Ollama qwen3-vl:4b)"
        )),
    };
    let started = Instant::now();
    run.serve.run(&["revoke", "--all"])?;
    a.closed_with("revoke --all closes phone A with 4401", 4401).await?;
    c.closed_with("revoke --all closes phone C with 4401", 4401).await?;
    println!("     revoke --all to close {} ms", started.elapsed().as_millis());
    ensure!(run.serve.run(&["devices"])?.contains("No paired devices"), "devices are left after revoke --all");
    println!("ok   no devices are left after revoke --all");
    model_outcome?;
    run.serve.stop()?;
    if let Some(model) = model {
        usage_check(eukhe, &run.serve.data, model)?;
    }
    Ok(())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let usage = "usage: remote_smoke <eukhe> <scratch dir>";
    let mut args = std::env::args_os().skip(1);
    let eukhe = std::fs::canonicalize(PathBuf::from(args.next().context(usage)?))?;
    let root = PathBuf::from(args.next().context(usage)?);
    std::fs::create_dir_all(&root)?;
    let root = std::fs::canonicalize(root)?;
    let bin = std::env::current_exe()?
        .parent()
        .and_then(Path::parent)
        .map(|dir| dir.join("local-studio-serve"))
        .filter(|bin| bin.is_file())
        .context("build local-studio-serve first: cargo build -p local-studio-remote --bins --examples")?;
    let data = root.join("data");
    let work = root.join("work");
    std::fs::create_dir_all(root.join("home"))?;
    std::env::set_var("HOME", root.join("home"));
    std::env::set_var("EUKHE_DAEMON_SOCKET", root.join("d.sock"));
    std::env::set_var("EUKHE_CODING_AGENT_DIR", root.join("agent"));
    std::env::set_var("LOCAL_STUDIO_DATA_DIR", &data);
    let model = agent_dir(&root)?;
    let big = seed_work(&work)?;
    let project_path = work.to_string_lossy().into_owned();
    let daemon = desktop(
        &eukhe,
        &data,
        "the desktop adds the project, then quits",
        |_, update| {
            Ok(
                matches!(&update, Update::Projects { projects } if projects.iter().any(|project| project.path == project_path)),
            )
        },
        |studio| studio.add_project(work.to_string_lossy().into_owned()),
    )?;
    let (hook, posts) = hook_listener().await?;
    let port = free_port()?;
    let tunnel = loop {
        let tunnel = free_port()?;
        if tunnel != port {
            break tunnel;
        }
    };
    TUNNEL_PORT.set(tunnel).ok();
    let serve = Serve { bin, root: root.clone(), data, port, child: None };
    let mut run = Run {
        serve,
        work,
        project: String::new(),
        big,
        hook,
        posts,
        server_key: Vec::new(),
        epoch: String::new(),
        report: Vec::new(),
    };
    let outcome = drive(&mut run, &eukhe, model.as_ref()).await;
    if outcome.is_err() {
        println!("     serve log tail:\n{}", run.serve.log_tail());
    }
    let stopped = run.serve.stop();
    let stopped_daemon = stop_daemon(&root.join("d.sock"), daemon).await;
    for line in &run.report {
        println!("     {line}");
    }
    outcome?;
    stopped?;
    stopped_daemon?;
    println!("PASS remote smoke");
    Ok(())
}
