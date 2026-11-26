use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tokio::time::Duration;
use tokio_tungstenite::MaybeTlsStream;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::http::Request;

pub const INITIAL_BACKOFF: Duration = Duration::from_millis(250);
pub const MAX_BACKOFF: Duration = Duration::from_secs(5);
pub const UNAVAILABLE_MESSAGE: &str = "bridge unavailable";

pub type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ControlMessage {
    NodeInfoRequest,
    NodeInfo { node_id: String },
    OpRequest { id: u64, payload: Value },
    OpResponse { id: u64, payload: Value },
    StreamAttach {
        id: u64,
        agent: String,
        token: String,
        resume_last_seq: Option<u64>,
    },
    StreamAttached { id: u64, payload: Value },
}

#[derive(Debug, Clone)]
pub enum Bridge {
    Pipe(PipeBridge),
}

impl Bridge {
    pub async fn op_request(&self, payload: Value) -> Result<Value, String> {
        match self {
            Self::Pipe(bridge) => bridge.op_request(payload).await,
        }
    }

    pub async fn stream_attach(
        &self,
        agent: &str,
        token: &str,
        resume_last_seq: Option<u64>,
    ) -> Result<(u64, Value), String> {
        match self {
            Self::Pipe(bridge) => bridge.stream_attach(agent, token, resume_last_seq).await,
        }
    }

    pub async fn open_stream(&self, id: u64) -> Result<StreamPipe, String> {
        match self {
            Self::Pipe(bridge) => bridge.open_stream(id).await,
        }
    }
}

#[derive(Debug)]
struct BridgeCommand {
    id: u64,
    message: Message,
    reply: Option<oneshot::Sender<Result<Value, String>>>,
}

impl BridgeCommand {
    fn take_reply(&mut self) -> oneshot::Sender<Result<Value, String>> {
        self.reply.take().expect("reply consumed once")
    }
}

#[derive(Debug, Clone)]
pub struct PipeBridge {
    url: Arc<String>,
    token: Arc<String>,
    commands: mpsc::Sender<BridgeCommand>,
    next_id: Arc<AtomicU64>,
}

impl PipeBridge {
    pub fn spawn(url: String, token: String) -> Self {
        let (commands, receiver) = mpsc::channel(64);
        let bridge = Self {
            url: Arc::new(url),
            token: Arc::new(token),
            commands,
            next_id: Arc::new(AtomicU64::new(1)),
        };
        tokio::spawn(supervise(bridge.clone(), receiver));
        bridge
    }

    fn next_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    fn ws_request(&self, suffix: &str) -> Result<Request<()>, String> {
        let url = format!("{}{}", self.url.trim_end_matches('/'), suffix);
        let mut request = url
            .as_str()
            .into_client_request()
            .map_err(|error| format!("invalid pipe url {url}: {error}"))?;
        let token = HeaderValue::from_str(&self.token)
            .map_err(|error| format!("invalid pipe token: {error}"))?;
        request.headers_mut().insert("x-pipe-token", token);
        Ok(request)
    }

    async fn connect_control(&self) -> Result<WsStream, String> {
        let request = self.ws_request("/control")?;
        let (ws, _) =
            tokio_tungstenite::connect_async(request).await.map_err(|error| error.to_string())?;
        Ok(ws)
    }

    async fn dispatch(
        &self,
        command: BridgeCommand,
        reply_rx: oneshot::Receiver<Result<Value, String>>,
    ) -> Result<Value, String> {
        self.commands
            .send(command)
            .await
            .map_err(|_| UNAVAILABLE_MESSAGE.to_string())?;
        reply_rx.await.map_err(|_| UNAVAILABLE_MESSAGE.to_string())?
    }

    pub async fn op_request(&self, payload: Value) -> Result<Value, String> {
        let (reply, reply_rx) = oneshot::channel();
        let id = self.next_id();
        let message = ControlMessage::OpRequest { id, payload };
        let command = BridgeCommand {
            id,
            message: encode_message(&message),
            reply: Some(reply),
        };
        self.dispatch(command, reply_rx).await
    }

    pub async fn stream_attach(
        &self,
        agent: &str,
        token: &str,
        resume_last_seq: Option<u64>,
    ) -> Result<(u64, Value), String> {
        let (reply, reply_rx) = oneshot::channel();
        let id = self.next_id();
        let message = ControlMessage::StreamAttach {
            id,
            agent: agent.to_string(),
            token: token.to_string(),
            resume_last_seq,
        };
        let command = BridgeCommand {
            id,
            message: encode_message(&message),
            reply: Some(reply),
        };
        let payload = self.dispatch(command, reply_rx).await?;
        Ok((id, payload))
    }

    pub async fn open_stream(&self, id: u64) -> Result<StreamPipe, String> {
        let request = self.ws_request(&format!("/stream/{id}"))?;
        let (ws, _) =
            tokio_tungstenite::connect_async(request).await.map_err(|error| error.to_string())?;
        Ok(StreamPipe::ws(ws))
    }
}

fn encode_message(message: &ControlMessage) -> Message {
    let line =
        serde_json::to_string(message).expect("control message serializes");
    Message::text(line)
}

async fn supervise(bridge: PipeBridge, mut commands: mpsc::Receiver<BridgeCommand>) {
    let mut backoff = INITIAL_BACKOFF;
    loop {
        match bridge.connect_control().await {
            Ok(ws) => {
                backoff = INITIAL_BACKOFF;
                run_control(ws, &mut commands).await;
            }
            Err(error) => eprintln!("bridge connect failed: {error}"),
        }
        let deadline = tokio::time::Instant::now() + backoff;
        loop {
            match tokio::time::timeout_at(deadline, commands.recv()).await {
                Ok(Some(mut command)) => {
                    let _ = command.take_reply().send(Err(UNAVAILABLE_MESSAGE.to_string()));
                }
                Ok(None) => return,
                Err(_) => break,
            }
        }
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}

async fn run_control(
    mut ws: WsStream,
    commands: &mut mpsc::Receiver<BridgeCommand>,
) {
    if ws.send(encode_message(&ControlMessage::NodeInfoRequest)).await.is_err() {
        return;
    }
    let mut pending = HashMap::<u64, oneshot::Sender<Result<Value, String>>>::new();
    loop {
        tokio::select! {
            command = commands.recv() => {
                let Some(mut command) = command else {
                    let _ = ws.close(None).await;
                    return;
                };
                let id = command.id;
                if ws.send(command.message.clone()).await.is_ok() {
                    pending.insert(id, command.take_reply());
                } else {
                    let _ = command.take_reply().send(Err(UNAVAILABLE_MESSAGE.to_string()));
                    return;
                }
            }
            incoming = ws.next() => match incoming {
                Some(Ok(Message::Text(text))) => route_control_message(&text, &mut pending),
                Some(Ok(_)) => {}
                _ => return,
            },
        }
    }
}

fn route_control_message(text: &str, pending: &mut HashMap<u64, oneshot::Sender<Result<Value, String>>>) {
    match serde_json::from_str::<ControlMessage>(text) {
        Ok(ControlMessage::OpResponse { id, payload })
        | Ok(ControlMessage::StreamAttached { id, payload }) => {
            if let Some(reply) = pending.remove(&id) {
                let _ = reply.send(Ok(payload));
            }
        }
        Ok(ControlMessage::NodeInfo { node_id }) => eprintln!("bridge node_id {node_id}"),
        Ok(_) => {}
        Err(error) => eprintln!("bridge message ignored: {error}"),
    }
}

pub enum StreamPipe {
    Ws(WsPipe),
}

impl StreamPipe {
    fn ws(ws: WsStream) -> Self {
        Self::Ws(WsPipe::new(ws))
    }

    pub fn split(self) -> (PipeWriter, PipeReader) {
        match self {
            Self::Ws(pipe) => pipe.split(),
        }
    }
}

pub struct WsPipe {
    sink: futures_util::stream::SplitSink<WsStream, Message>,
    incoming: futures_util::stream::SplitStream<WsStream>,
}

impl WsPipe {
    fn new(ws: WsStream) -> Self {
        let (sink, incoming) = ws.split();
        Self { sink, incoming }
    }

    fn split(self) -> (PipeWriter, PipeReader) {
        (
            PipeWriter(PipeWriterKind::Ws(self.sink)),
            PipeReader(PipeReaderKind::Ws(self.incoming)),
        )
    }
}

pub struct PipeWriter(PipeWriterKind);

enum PipeWriterKind {
    Ws(futures_util::stream::SplitSink<WsStream, Message>),
}

impl PipeWriter {
    pub async fn send_line(&mut self, line: &[u8]) -> Result<(), String> {
        match &mut self.0 {
            PipeWriterKind::Ws(sink) => {
                let text = String::from_utf8_lossy(line);
                sink.send(Message::text(text.as_ref()))
                    .await
                    .map_err(|error| error.to_string())
            }
        }
    }

    pub async fn close(&mut self) {
        match &mut self.0 {
            PipeWriterKind::Ws(sink) => {
                let _ = sink.send(Message::Close(None)).await;
            }
        }
    }
}

pub struct PipeReader(PipeReaderKind);

enum PipeReaderKind {
    Ws(futures_util::stream::SplitStream<WsStream>),
}

impl PipeReader {
    pub async fn next_line(&mut self) -> Option<String> {
        match &mut self.0 {
            PipeReaderKind::Ws(incoming) => loop {
                match incoming.next().await {
                    Some(Ok(Message::Text(text))) => return Some(text.to_string()),
                    Some(Ok(_)) => continue,
                    _ => return None,
                }
            },
        }
    }
}
