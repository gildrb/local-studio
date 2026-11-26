use crate::bridge::{Bridge, PipeReader, PipeWriter};
use crate::wire::{
    FrameError, LineReader, PROTOCOL_VERSION, Request, Response, read_frame, write_frame,
};
use iroh::endpoint::{Connection, RecvStream, SendStream};
use iroh::protocol::{AcceptError, ProtocolHandler};
use serde_json::Value;
use std::time::Duration;

const PIPE_DRAIN_GRACE: Duration = Duration::from_secs(1);

#[derive(Debug)]
pub struct AlleycatHandler {
    bridge: Bridge,
}

impl AlleycatHandler {
    pub fn new(bridge: Bridge) -> Self {
        Self { bridge }
    }
}

impl ProtocolHandler for AlleycatHandler {
    async fn accept(&self, connection: Connection) -> Result<(), AcceptError> {
        loop {
            let Ok((mut send, mut recv)) = connection.accept_bi().await else {
                return Ok(());
            };
            self.handle_stream(&mut send, &mut recv).await;
        }
    }
}

impl AlleycatHandler {
    async fn handle_stream(&self, send: &mut SendStream, recv: &mut RecvStream) {
        let frame = match read_frame(recv).await {
            Ok(frame) => frame,
            Err(FrameError::Eof) => return,
            Err(error) => {
                reject(send, format!("frame error: {error}")).await;
                return;
            }
        };
        let request: Request = match serde_json::from_slice(&frame) {
            Ok(request) => request,
            Err(error) => {
                reject(send, format!("invalid request: {error}")).await;
                return;
            }
        };
        if request.version() != PROTOCOL_VERSION {
            reject(
                send,
                format!("unsupported protocol version {}", request.version()),
            )
            .await;
            return;
        }
        if request.token().trim().is_empty() {
            reject(send, "missing token".into()).await;
            return;
        }
        match request {
            Request::ListAgents { .. } | Request::RestartAgent { .. } => {
                self.simple_op(send, request).await;
            }
            Request::Connect { token, agent, resume, .. } => {
                self.connect_op(send, recv, token, agent, resume.map(|r| r.last_seq))
                    .await;
            }
        }
    }

    async fn simple_op(&self, send: &mut SendStream, request: Request) {
        let op = request.op_name();
        let payload =
            serde_json::to_value(&request).expect("request serializes");
        let response = match self.bridge.op_request(payload).await {
            Ok(value) => value,
            Err(error) => serde_json::to_value(Response::error(error))
                .expect("error response serializes"),
        };
        let bytes = serde_json::to_vec(&response).expect("response serializes");
        if write_frame(send, &bytes).await.is_ok() {
            log_op(op, &response);
        }
        let _ = send.finish();
    }

    async fn connect_op(
        &self,
        send: &mut SendStream,
        recv: &mut RecvStream,
        token: String,
        agent: String,
        resume_last_seq: Option<u64>,
    ) {
        let (stream_id, payload) =
            match self.bridge.stream_attach(&agent, &token, resume_last_seq).await {
                Ok(attach) => attach,
                Err(error) => {
                    eprintln!("op connect agent={agent} failed: {error}");
                    reject(send, error).await;
                    return;
                }
            };
        let bytes = serde_json::to_vec(&payload).expect("response serializes");
        if write_frame(send, &bytes).await.is_err() {
            return;
        }
        eprintln!("op connect agent={agent} attach={}", attach_mode(&payload));
        let pipe = match self.bridge.open_stream(stream_id).await {
            Ok(pipe) => pipe,
            Err(error) => {
                eprintln!("op connect agent={agent} stream failed: {error}");
                let _ = send.finish();
                return;
            }
        };
        let (mut writer, mut reader) = pipe.split();
        let mut line_reader = LineReader::new();
        pump(&mut line_reader, recv, send, &mut writer, &mut reader).await;
    }
}

async fn pump(
    line_reader: &mut LineReader,
    recv: &mut RecvStream,
    send: &mut SendStream,
    writer: &mut PipeWriter,
    reader: &mut PipeReader,
) {
    loop {
        tokio::select! {
            line = line_reader.next_line(recv) => match line {
                Some(line) => {
                    if line.is_empty() {
                        continue;
                    }
                    if writer.send_line(&line).await.is_err() {
                        return;
                    }
                }
                None => break,
            },
            text = reader.next_line() => match text {
                Some(text) => {
                    let mut frame = text.into_bytes();
                    frame.push(b'\n');
                    if send.write_all(&frame).await.is_err() {
                        return;
                    }
                }
                None => break,
            },
        }
    }
    let drain = async {
        while let Some(text) = reader.next_line().await {
            let mut frame = text.into_bytes();
            frame.push(b'\n');
            if send.write_all(&frame).await.is_err() {
                return;
            }
        }
    };
    let _ = tokio::time::timeout(PIPE_DRAIN_GRACE, drain).await;
    writer.close().await;
    let _ = send.finish();
}

async fn reject(send: &mut SendStream, message: String) {
    let bytes =
        serde_json::to_vec(&Response::error(message)).expect("error response serializes");
    let _ = write_frame(send, &bytes).await;
    let _ = send.finish();
}

fn attach_mode(payload: &Value) -> &str {
    payload
        .get("session")
        .and_then(|session| session.get("attached"))
        .and_then(Value::as_str)
        .unwrap_or("unknown")
}

fn log_op(op: &str, response: &Value) {
    let ok = response.get("ok").and_then(Value::as_bool).unwrap_or(false);
    if ok {
        eprintln!("op {op} ok");
    } else {
        let error =
            response.get("error").and_then(Value::as_str).unwrap_or("unknown error");
        eprintln!("op {op} failed: {error}");
    }
}
