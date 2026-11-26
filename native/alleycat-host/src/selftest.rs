use crate::bridge::{
    Bridge, ControlMessage, PipeBridge, mock_agent, mock_attach_response, mock_op_response,
};
use crate::host::AlleycatHandler;
use crate::keys;
use crate::wire::{
    ALPN, MAX_FRAME_BYTES, PROTOCOL_VERSION, LineReader, Request, Response, Resume, read_frame,
    write_frame,
};
use futures_util::{SinkExt, StreamExt};
use iroh::Endpoint;
use iroh::EndpointAddr;
use iroh::endpoint::Connection;
use iroh::endpoint::presets;
use iroh::protocol::Router;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::net::TcpListener;
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::handshake::server::ErrorResponse;

pub const MOCK_PIPE_TOKEN: &str = "test-pipe-token";
pub const TEST_TIMEOUT: Duration = Duration::from_secs(30);

pub struct Fixture {
    pub server: Endpoint,
    pub server_addr: EndpointAddr,
    pub client: Endpoint,
    router: Router,
    _guard: TempGuard,
}

impl Fixture {
    pub async fn shutdown(self) {
        let _ = self.router.shutdown().await;
        self.client.close().await;
        self.server.close().await;
    }
}

struct TempGuard(PathBuf);

impl Drop for TempGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn unique_suffix() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}-{nanos}-{counter}", std::process::id())
}

pub async fn spawn_fixture() -> Result<Fixture, String> {
    let mock_addr = spawn_mock_bridge().await?;
    let dir = std::env::temp_dir().join(format!("alleycat-host-selftest-{}", unique_suffix()));
    let key_file = dir.join("host.key");
    let key = keys::load_or_create(&key_file).map_err(|error| format!("key: {error}"))?;
    let pipe_url = format!("ws://{mock_addr}");
    let bridge = Bridge::Pipe(PipeBridge::spawn(pipe_url, MOCK_PIPE_TOKEN.to_string()));
    let server = Endpoint::builder(presets::Minimal)
        .secret_key(key)
        .bind()
        .await
        .map_err(|error| format!("server bind: {error}"))?;
    let router = Router::builder(server.clone())
        .accept(ALPN, AlleycatHandler::new(bridge))
        .spawn();
    let port = server
        .bound_sockets()
        .first()
        .map(|socket| socket.port())
        .ok_or("server bound without sockets")?;
    let server_addr =
        EndpointAddr::new(server.id()).with_ip_addr(SocketAddr::from(([127, 0, 0, 1], port)));
    let client = Endpoint::builder(presets::Minimal)
        .bind()
        .await
        .map_err(|error| format!("client bind: {error}"))?;
    Ok(Fixture {
        server,
        server_addr,
        client,
        router,
        _guard: TempGuard(dir),
    })
}

pub async fn spawn_mock_bridge() -> Result<SocketAddr, String> {
    let listener =
        TcpListener::bind("127.0.0.1:0").await.map_err(|error| format!("mock bind: {error}"))?;
    let addr = listener.local_addr().map_err(|error| error.to_string())?;
    tokio::spawn(mock_accept_loop(listener));
    Ok(addr)
}

async fn mock_accept_loop(listener: TcpListener) {
    while let Ok((stream, _)) = listener.accept().await {
        tokio::spawn(handle_mock_connection(stream));
    }
}

async fn handle_mock_connection(stream: tokio::net::TcpStream) {
    let path = Arc::new(Mutex::new(None::<String>));
    let token_ok = Arc::new(AtomicBool::new(false));
    let handshake = accept_hdr_async(stream, {
        let path = path.clone();
        let token_ok = token_ok.clone();
        move |request: &tokio_tungstenite::tungstenite::http::Request<()>, response| {
            *path.lock().expect("path lock") = Some(request.uri().path().to_owned());
            let token = request
                .headers()
                .get("x-pipe-token")
                .and_then(|value| value.to_str().ok());
            token_ok.store(token == Some(MOCK_PIPE_TOKEN), Ordering::Release);
            Ok::<_, ErrorResponse>(response)
        }
    })
    .await;
    let Ok(mut ws) = handshake else { return };
    if !token_ok.load(Ordering::Acquire) {
        return;
    }
    let Some(served_path) = path.lock().expect("path lock").clone() else { return };
    if served_path == "/control" {
        mock_control(&mut ws).await;
    } else if served_path.starts_with("/stream/") {
        mock_stream(&mut ws).await;
    }
}

async fn mock_control<S>(ws: &mut WebSocketStream<S>)
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    loop {
        let Some(Ok(Message::Text(text))) = ws.next().await else { return };
        let Ok(message) = serde_json::from_str::<ControlMessage>(&text) else { continue };
        let reply = match message {
            ControlMessage::NodeInfoRequest => {
                ControlMessage::NodeInfo { node_id: "0".repeat(64) }
            }
            ControlMessage::OpRequest { id, payload } => ControlMessage::OpResponse {
                id,
                payload: mock_op_response(&payload, id),
            },
            ControlMessage::StreamAttach { id, agent: _, resume_last_seq, .. } => {
                ControlMessage::StreamAttached {
                    id,
                    payload: serde_json::to_value(mock_attach_response(resume_last_seq))
                        .expect("attach response serializes"),
                }
            }
            _ => continue,
        };
        let line = serde_json::to_string(&reply).expect("mock reply serializes");
        if ws.send(Message::text(line)).await.is_err() {
            return;
        }
    }
}

async fn mock_stream<S>(ws: &mut WebSocketStream<S>)
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    loop {
        let Some(Ok(Message::Text(text))) = ws.next().await else { return };
        if ws.send(Message::Text(text.clone())).await.is_err() {
            return;
        }
    }
}

pub async fn dial(fixture: &Fixture) -> Result<Connection, String> {
    fixture
        .client
        .connect(fixture.server_addr.clone(), ALPN)
        .await
        .map_err(|error| format!("dial: {error}"))
}

pub async fn check_frame_round_trip(fixture: &Fixture) -> Result<(), String> {
    let connection = dial(fixture).await?;
    let (mut send, mut recv) =
        connection.open_bi().await.map_err(|error| format!("open: {error}"))?;
    let request = serde_json::to_vec(&Request::ListAgents {
        v: PROTOCOL_VERSION,
        token: MOCK_PIPE_TOKEN.into(),
    })
    .expect("request serializes");
    write_frame(&mut send, &request)
        .await
        .map_err(|error| format!("write request: {error}"))?;
    let mut prefix = [0u8; 4];
    recv.read_exact(&mut prefix)
        .await
        .map_err(|error| format!("read prefix: {error}"))?;
    let length = u32::from_be_bytes(prefix);
    let mut payload = vec![0u8; length as usize];
    recv.read_exact(&mut payload)
        .await
        .map_err(|error| format!("read payload: {error}"))?;
    let expected_prefix = (payload.len() as u32).to_be_bytes();
    if prefix != expected_prefix {
        return Err(format!(
            "frame prefix mismatch: got {prefix:?}, want {expected_prefix:?}"
        ));
    }
    let response: Response = serde_json::from_slice(&payload)
        .map_err(|error| format!("parse response: {error}"))?;
    if !response.ok || response.v != PROTOCOL_VERSION {
        return Err(format!("list_agents response not ok: {response:?}"));
    }
    let oversized_len = MAX_FRAME_BYTES + 1;
    let (mut oversized_send, mut oversized_recv) =
        connection.open_bi().await.map_err(|error| format!("open: {error}"))?;
    oversized_send
        .write_all(&oversized_len.to_be_bytes())
        .await
        .map_err(|error| format!("write oversized prefix: {error}"))?;
    let oversized = vec![0u8; oversized_len as usize];
    let _ = oversized_send.write_all(&oversized).await;
    let error_frame = read_frame(&mut oversized_recv)
        .await
        .map_err(|error| format!("read error response: {error}"))?;
    let error: Response = serde_json::from_slice(&error_frame)
        .map_err(|error| format!("parse error response: {error}"))?;
    if error.ok {
        return Err("oversized frame was accepted".into());
    }
    if !error.error.as_deref().is_some_and(|message| message.contains("frame")) {
        return Err(format!("unexpected error for oversized frame: {error:?}"));
    }
    let _ = oversized_send.finish();
    let _ = send.finish();
    Ok(())
}

pub async fn check_list_agents(fixture: &Fixture) -> Result<(), String> {
    let connection = dial(fixture).await?;
    let (mut send, mut recv) =
        connection.open_bi().await.map_err(|error| format!("open: {error}"))?;
    let request = serde_json::to_vec(&Request::ListAgents {
        v: PROTOCOL_VERSION,
        token: MOCK_PIPE_TOKEN.into(),
    })
    .expect("request serializes");
    write_frame(&mut send, &request).await.map_err(|error| format!("write: {error}"))?;
    let payload =
        read_frame(&mut recv).await.map_err(|error| format!("read response: {error}"))?;
    let response: Response =
        serde_json::from_slice(&payload).map_err(|error| format!("parse response: {error}"))?;
    if !response.ok {
        return Err(format!("list_agents failed: {response:?}"));
    }
    if response.agents != vec![mock_agent()] {
        return Err(format!("agent mismatch: {:?}", response.agents));
    }
    let _ = send.finish();
    Ok(())
}

pub async fn check_connect_echo(fixture: &Fixture) -> Result<(), String> {
    let connection = dial(fixture).await?;
    let (mut send, mut recv) =
        connection.open_bi().await.map_err(|error| format!("open: {error}"))?;
    let request = serde_json::to_vec(&Request::Connect {
        v: PROTOCOL_VERSION,
        token: MOCK_PIPE_TOKEN.into(),
        agent: "main".into(),
        resume: None,
    })
    .expect("request serializes");
    write_frame(&mut send, &request).await.map_err(|error| format!("write: {error}"))?;
    let payload =
        read_frame(&mut recv).await.map_err(|error| format!("read response: {error}"))?;
    let response: Response =
        serde_json::from_slice(&payload).map_err(|error| format!("parse response: {error}"))?;
    if !response.ok {
        return Err(format!("connect failed: {response:?}"));
    }
    let Some(session) = &response.session else {
        return Err("connect response missing session".into());
    };
    if session.attached != crate::wire::AttachKindWire::Fresh {
        return Err(format!("expected fresh attach, got {:?}", session.attached));
    }
    let line = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
    send.write_all(line.as_bytes())
        .await
        .map_err(|error| format!("write line: {error}"))?;
    send.write_all(b"\n").await.map_err(|error| format!("write newline: {error}"))?;
    let mut line_reader = LineReader::new();
    let echoed = line_reader
        .next_line(&mut recv)
        .await
        .ok_or("bridge closed before echo")?;
    if echoed != line.as_bytes() {
        return Err(format!(
            "echo mismatch: got {:?}, want {line:?}",
            String::from_utf8_lossy(&echoed)
        ));
    }
    let _ = send.finish();
    Ok(())
}

pub async fn check_connect_resume(fixture: &Fixture) -> Result<(), String> {
    let connection = dial(fixture).await?;
    let (mut send, mut recv) =
        connection.open_bi().await.map_err(|error| format!("open: {error}"))?;
    let request = serde_json::to_vec(&Request::Connect {
        v: PROTOCOL_VERSION,
        token: MOCK_PIPE_TOKEN.into(),
        agent: "main".into(),
        resume: Some(Resume { last_seq: 10 }),
    })
    .expect("request serializes");
    write_frame(&mut send, &request).await.map_err(|error| format!("write: {error}"))?;
    let payload =
        read_frame(&mut recv).await.map_err(|error| format!("read response: {error}"))?;
    let response: Response =
        serde_json::from_slice(&payload).map_err(|error| format!("parse response: {error}"))?;
    let Some(session) = &response.session else {
        return Err("connect response missing session".into());
    };
    if session.attached != crate::wire::AttachKindWire::Resumed {
        return Err(format!("expected resumed attach, got {:?}", session.attached));
    }
    let _ = send.finish();
    Ok(())
}

pub async fn check_validation(fixture: &Fixture) -> Result<(), String> {
    let connection = dial(fixture).await?;
    let cases: [Vec<u8>; 4] = [
        serde_json::to_vec(&Request::ListAgents {
            v: PROTOCOL_VERSION + 1,
            token: MOCK_PIPE_TOKEN.into(),
        })
        .expect("request serializes"),
        serde_json::to_vec(&Request::ListAgents {
            v: PROTOCOL_VERSION,
            token: String::new(),
        })
        .expect("request serializes"),
        serde_json::to_vec(&Request::ListAgents {
            v: PROTOCOL_VERSION,
            token: "   ".into(),
        })
        .expect("request serializes"),
        b"not json".to_vec(),
    ];
    for (index, case) in cases.iter().enumerate() {
        let (mut send, mut recv) =
            connection.open_bi().await.map_err(|error| format!("open: {error}"))?;
        write_frame(&mut send, case)
            .await
            .map_err(|error| format!("write: {error}"))?;
        let payload =
            read_frame(&mut recv).await.map_err(|error| format!("read response: {error}"))?;
        let response: Response = serde_json::from_slice(&payload)
            .map_err(|error| format!("parse response: {error}"))?;
        if response.ok {
            return Err(format!("case {index} unexpectedly accepted: {response:?}"));
        }
        let _ = send.finish();
    }
    Ok(())
}

pub fn check_key_file() -> Result<(), String> {
    let dir = std::env::temp_dir().join(format!("alleycat-host-keytest-{}", unique_suffix()));
    let file = dir.join("nested").join("host.key");
    let first = keys::load_or_create(&file).map_err(|error| format!("create: {error}"))?;
    let raw = std::fs::read(&file).map_err(|error| format!("read: {error}"))?;
    if raw.len() != 32 {
        return Err(format!("key file has {} bytes, want 32", raw.len()));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let mode = std::fs::metadata(&file).map_err(|error| error.to_string())?.mode();
        if mode & 0o777 != 0o600 {
            return Err(format!("key file mode is {:o}, want 600", mode & 0o777));
        }
    }
    let second = keys::load_or_create(&file).map_err(|error| format!("reload: {error}"))?;
    if first.to_bytes() != second.to_bytes() {
        return Err("key file round-trip changed the key".into());
    }
    std::fs::write(&file, b"short").map_err(|error| format!("write: {error}"))?;
    if keys::load_or_create(&file).is_ok() {
        return Err("short key file accepted".into());
    }
    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

pub async fn run_self_test() -> Result<(), String> {
    run_step("key_file", async { check_key_file() }).await?;
    let fixture = spawn_fixture().await.map_err(|error| format!("fixture: {error}"))?;
    let steps_result: Result<(), String> = async {
        run_step("frames", check_frame_round_trip(&fixture)).await?;
        run_step("list_agents", check_list_agents(&fixture)).await?;
        run_step("connect_echo", check_connect_echo(&fixture)).await?;
        run_step("connect_resume", check_connect_resume(&fixture)).await?;
        run_step("validation", check_validation(&fixture)).await?;
        Ok(())
    }
    .await;
    fixture.shutdown().await;
    steps_result?;
    println!("self-test ok");
    Ok(())
}

async fn run_step(name: &str, step: impl Future<Output = Result<(), String>>) -> Result<(), String> {
    println!("self-test {name}");
    match tokio::time::timeout(TEST_TIMEOUT, step).await {
        Ok(Ok(())) => {
            println!("self-test {name} ok");
            Ok(())
        }
        Ok(Err(error)) => Err(format!("{name}: {error}")),
        Err(_) => Err(format!("{name}: timed out")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(flavor = "multi_thread")]
    async fn key_file_persistence_round_trip() {
        check_key_file().unwrap_or_else(|error| panic!("{error}"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn frame_round_trip_and_oversize_rejection() {
        let fixture = spawn_fixture().await.unwrap_or_else(|error| panic!("{error}"));
        let outcome = tokio::time::timeout(TEST_TIMEOUT, check_frame_round_trip(&fixture)).await;
        fixture.shutdown().await;
        outcome.expect("timed out").unwrap_or_else(|error| panic!("{error}"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn list_agents_over_real_iroh() {
        let fixture = spawn_fixture().await.unwrap_or_else(|error| panic!("{error}"));
        let outcome = tokio::time::timeout(TEST_TIMEOUT, check_list_agents(&fixture)).await;
        fixture.shutdown().await;
        outcome.expect("timed out").unwrap_or_else(|error| panic!("{error}"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn connect_jsonl_echo_over_real_iroh() {
        let fixture = spawn_fixture().await.unwrap_or_else(|error| panic!("{error}"));
        let outcome = tokio::time::timeout(TEST_TIMEOUT, check_connect_echo(&fixture)).await;
        fixture.shutdown().await;
        outcome.expect("timed out").unwrap_or_else(|error| panic!("{error}"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn connect_resume_over_real_iroh() {
        let fixture = spawn_fixture().await.unwrap_or_else(|error| panic!("{error}"));
        let outcome = tokio::time::timeout(TEST_TIMEOUT, check_connect_resume(&fixture)).await;
        fixture.shutdown().await;
        outcome.expect("timed out").unwrap_or_else(|error| panic!("{error}"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn request_validation_rejections() {
        let fixture = spawn_fixture().await.unwrap_or_else(|error| panic!("{error}"));
        let outcome = tokio::time::timeout(TEST_TIMEOUT, check_validation(&fixture)).await;
        fixture.shutdown().await;
        outcome.expect("timed out").unwrap_or_else(|error| panic!("{error}"));
    }
}
