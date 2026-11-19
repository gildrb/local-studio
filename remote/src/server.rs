use std::collections::HashMap;
use std::convert::Infallible;
use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use futures_util::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use http_body_util::Full;
use hyper::body::{Bytes, Incoming};
use hyper::header::{self, HeaderMap, HeaderValue};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::upgrade::Upgraded;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use serde_json::{json, Value};
use snow::HandshakeState;
use tokio::net::TcpListener;
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::handshake::derive_accept_key;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::{CloseFrame, Role, WebSocketConfig};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use crate::devices::{hex, unhex, DeviceInfo, Devices, StaticKey};
use crate::hub::{self, ConnId, Hub, Out, Resume, Rx, Tx};
use crate::limits::{self, Client, Gate, Listener};
use crate::noise::{self, Channel, Inbound, Joiner};
use crate::{access, ops};

const SILENCE: Duration = Duration::from_secs(60);
const DRAIN: Duration = Duration::from_secs(2);
const CLOSE_WITHIN: Duration = Duration::from_secs(1);
const REVOKE_POLL: Duration = Duration::from_secs(1);
const UNPAIRED: u16 = 4401;
const BANNED: u16 = 4429;
const BUSY: u16 = 1013;
const BROKEN: u16 = 1002;

type Socket = WebSocketStream<TokioIo<Upgraded>>;
type Sink = SplitSink<Socket, Message>;
type Stream = SplitStream<Socket>;
type Reply = Response<Full<Bytes>>;

pub struct Server {
    pub hub: Arc<Hub>,
    pub devices: Devices,
    pub key: StaticKey,
    pub port: u16,
    pub allowed: Vec<String>,
    pub tunnels: Vec<String>,
    pub gate: Gate,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Route {
    Local,
    Tunnel,
}

async fn accept(listener: Option<&TcpListener>) -> std::io::Result<(tokio::net::TcpStream, SocketAddr)> {
    match listener {
        Some(listener) => listener.accept().await,
        None => std::future::pending().await,
    }
}

pub async fn run(local: TcpListener, tunnel: Option<TcpListener>, server: Arc<Server>, stop: impl Future<Output = ()>) {
    tokio::spawn(revocations(Arc::clone(&server)));
    tokio::pin!(stop);
    loop {
        let (accepted, route) = tokio::select! {
            () = &mut stop => return,
            accepted = local.accept() => (accepted, Route::Local),
            accepted = accept(tunnel.as_ref()) => (accepted, Route::Tunnel),
        };
        let (stream, peer) = match accepted {
            Ok(accepted) => accepted,
            Err(error) => {
                eprintln!("local-studio-serve: accept failed: {error}");
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            }
        };
        let server = Arc::clone(&server);
        tokio::spawn(async move {
            let service = service_fn(move |request| {
                let server = Arc::clone(&server);
                async move { Ok::<_, Infallible>(handle(&server, request, peer, route)) }
            });
            http1::Builder::new()
                .timer(TokioTimer::new())
                .header_read_timeout(limits::HEADER_WITHIN)
                .serve_connection(TokioIo::new(stream), service)
                .with_upgrades()
                .await
                .ok();
        });
    }
}

async fn revocations(server: Arc<Server>) {
    let mut every = tokio::time::interval(REVOKE_POLL);
    loop {
        every.tick().await;
        match server.devices.list() {
            Ok(devices) => {
                let known: HashMap<String, String> =
                    devices.into_iter().map(|device| (device.info.id, device.key)).collect();
                server.hub.retain(&known);
            }
            Err(error) => eprintln!("local-studio-serve: could not read the device list: {error:#}"),
        }
    }
}

fn reply(status: StatusCode, body: &str) -> Reply {
    let mut response = Response::new(Full::new(Bytes::from(body.to_string())));
    *response.status_mut() = status;
    response
}

fn header(headers: &HeaderMap, name: impl header::AsHeaderName) -> Option<&str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

fn handle(server: &Arc<Server>, mut request: Request<Incoming>, peer: SocketAddr, route: Route) -> Reply {
    let host = header(request.headers(), header::HOST).unwrap_or_default().to_string();
    let allowed = match route {
        Route::Local => access::host_allowed(&host, server.port, &server.allowed),
        Route::Tunnel => access::named(&host, &server.tunnels),
    };
    if !allowed {
        eprintln!(
            "local-studio-serve: refused a request from {} on the {route:?} listener for host {host:?}",
            peer.ip()
        );
        return reply(StatusCode::FORBIDDEN, "this host is not allowed");
    }
    match (request.method(), request.uri().path()) {
        (&Method::GET, "/v1/health") => {
            let health = json!({ "ok": true, "protocol": hub::PROTOCOL, "min_protocol": hub::MIN_PROTOCOL });
            let mut response = reply(StatusCode::OK, &health.to_string());
            response.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
            response
        }
        (&Method::GET, "/v1/ws") => match client_of(route, request.headers(), peer) {
            Some(client) => upgrade(server, &mut request, &host, client, route),
            None => reply(StatusCode::BAD_REQUEST, "the tunnel sent no CF-Connecting-IP"),
        },
        (_, "/v1/health" | "/v1/ws") => reply(StatusCode::METHOD_NOT_ALLOWED, "use GET"),
        _ => reply(StatusCode::NOT_FOUND, "not found"),
    }
}

fn bucket(ip: IpAddr) -> String {
    match ip {
        IpAddr::V4(v4) => v4.to_string(),
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map_or_else(
            || {
                let s = v6.segments();
                format!("{:x}:{:x}:{:x}:{:x}::/64", s[0], s[1], s[2], s[3])
            },
            |v4| v4.to_string(),
        ),
    }
}

fn client_of(route: Route, headers: &HeaderMap, peer: SocketAddr) -> Option<Client> {
    let address = |name: &str| {
        header(headers, name)
            .and_then(|value| value.split(',').next())
            .and_then(|value| value.trim().parse::<IpAddr>().ok())
            .map(bucket)
    };
    match route {
        Route::Tunnel => address("cf-connecting-ip").map(|ip| Client::Key(format!("cf:{ip}"))),
        Route::Local => {
            let login = header(headers, "tailscale-user-login").map(str::trim).filter(|login| !login.is_empty());
            if let Some(login) = login {
                return Some(Client::Key(format!("ts:{}", login.to_ascii_lowercase())));
            }
            if let Some(ip) = address("x-forwarded-for") {
                return Some(Client::Key(format!("xff:{ip}")));
            }
            Some(if peer.ip().is_loopback() {
                Client::Loopback
            } else {
                Client::Key(format!("peer:{}", bucket(peer.ip())))
            })
        }
    }
}

fn upgrade(server: &Arc<Server>, request: &mut Request<Incoming>, host: &str, client: Client, route: Route) -> Reply {
    let listener = match route {
        Route::Local => Listener::Local,
        Route::Tunnel => Listener::Tunnel,
    };
    let headers = request.headers();
    let origin = header(headers, header::ORIGIN);
    if !access::origin_allowed(origin, host) {
        eprintln!("local-studio-serve: refused a socket from {client} with origin {origin:?} for host {host:?}");
        return reply(StatusCode::FORBIDDEN, "this origin is not allowed");
    }
    let wants_socket = header(headers, header::UPGRADE).is_some_and(|value| value.eq_ignore_ascii_case("websocket"))
        && header(headers, header::CONNECTION)
            .is_some_and(|value| value.split(',').any(|token| token.trim().eq_ignore_ascii_case("upgrade")))
        && header(headers, header::SEC_WEBSOCKET_VERSION) == Some("13");
    let key = headers.get(header::SEC_WEBSOCKET_KEY).filter(|_| wants_socket);
    let Some(key) = key else { return reply(StatusCode::BAD_REQUEST, "expected a WebSocket upgrade") };
    let accept = derive_accept_key(key.as_bytes());
    let pending = hyper::upgrade::on(request);
    let server = Arc::clone(server);
    tokio::spawn(async move {
        match pending.await {
            Ok(upgraded) => {
                let config = WebSocketConfig::default()
                    .max_message_size(Some(noise::MAX_MESSAGE))
                    .max_frame_size(Some(noise::MAX_MESSAGE));
                let socket = WebSocketStream::from_raw_socket(TokioIo::new(upgraded), Role::Server, Some(config)).await;
                session(server, socket, client, listener).await;
            }
            Err(error) => eprintln!("local-studio-serve: the socket upgrade failed: {error}"),
        }
    });
    Response::builder()
        .status(StatusCode::SWITCHING_PROTOCOLS)
        .header(header::UPGRADE, "websocket")
        .header(header::CONNECTION, "Upgrade")
        .header(header::SEC_WEBSOCKET_ACCEPT, accept)
        .body(Full::new(Bytes::new()))
        .unwrap_or_else(|_| reply(StatusCode::INTERNAL_SERVER_ERROR, "could not answer the upgrade"))
}

async fn close(sink: &mut Sink, code: u16, reason: &str) {
    sink.send(Message::Close(Some(CloseFrame { code: CloseCode::from(code), reason: reason.into() }))).await.ok();
}

enum Next {
    Text(String),
    Binary(Bytes),
    Gone,
}

async fn next(stream: &mut Stream) -> Next {
    while let Some(message) = stream.next().await {
        match message {
            Ok(Message::Text(text)) => return Next::Text(text.to_string()),
            Ok(Message::Binary(bytes)) => return Next::Binary(bytes),
            Ok(Message::Close(_)) | Err(_) => return Next::Gone,
            Ok(_) => {}
        }
    }
    Next::Gone
}

async fn next_by(stream: &mut Stream, deadline: Instant) -> Option<Next> {
    tokio::time::timeout_at(deadline, next(stream)).await.ok()
}

struct Opened {
    device: String,
    key: String,
    channel: Channel,
}

struct Refusal {
    code: u16,
    reason: String,
    counts: bool,
}

impl Refusal {
    fn failed(code: u16, reason: impl Into<String>) -> Self {
        Self { code, reason: reason.into(), counts: true }
    }
}

async fn session(server: Arc<Server>, socket: Socket, address: Client, listener: Listener) {
    let (mut sink, mut stream) = socket.split();
    if server.gate.banned(&address) {
        eprintln!("local-studio-serve: refused {address}: too many failed handshakes");
        close(&mut sink, BANNED, "too many failed handshakes; try again later").await;
        return;
    }
    let Some(opening) = server.gate.open(listener, &address) else {
        eprintln!("local-studio-serve: refused {address}: too many sockets are mid-handshake");
        close(&mut sink, BUSY, "busy").await;
        return;
    };
    let started = Instant::now();
    let header = match next_by(&mut stream, started + limits::HEADER_WITHIN).await {
        Some(Next::Text(text)) => text,
        Some(Next::Gone) => return,
        Some(Next::Binary(_)) => {
            server.gate.fail(&address, "-", "the first message was not the opening header");
            close(&mut sink, BROKEN, "expected the opening header").await;
            return;
        }
        None => {
            server.gate.fail(&address, "-", "no opening header within 5 s");
            close(&mut sink, BROKEN, "no opening header").await;
            return;
        }
    };
    let parsed = match noise::parse_header(&header) {
        Ok(parsed) => parsed,
        Err(reason) => {
            server.gate.fail(&address, "-", &reason);
            close(&mut sink, BROKEN, "bad opening header").await;
            return;
        }
    };
    let protocol = parsed.protocol.min(hub::PROTOCOL);
    if protocol < parsed.min_protocol.max(hub::MIN_PROTOCOL) {
        eprintln!(
            "local-studio-serve: {address} speaks protocols {} to {}; this server speaks {} to {}",
            parsed.min_protocol,
            parsed.protocol,
            hub::MIN_PROTOCOL,
            hub::PROTOCOL
        );
        let incompatible =
            json!({ "op": "incompatible", "protocol": hub::PROTOCOL, "min_protocol": hub::MIN_PROTOCOL });
        sink.send(Message::text(incompatible.to_string())).await.ok();
        close(&mut sink, BROKEN, "incompatible").await;
        return;
    }
    let prologue = noise::prologue(&header);
    let deadline = started + limits::HANDSHAKE_WITHIN;
    let handshake = match parsed.pattern.as_str() {
        "KK" => {
            kk(&server, &mut sink, &mut stream, parsed.device.as_deref().unwrap_or_default(), &prologue, deadline).await
        }
        _ => xx(&server, &mut sink, &mut stream, parsed.pair.as_deref().unwrap_or_default(), &prologue, deadline).await,
    };
    let opened = match handshake {
        Ok(opened) => opened,
        Err(refusal) => {
            if refusal.counts {
                server.gate.fail(&address, &parsed.pattern, &refusal.reason);
            } else {
                eprintln!("local-studio-serve: {address} ({}): {}", parsed.pattern, refusal.reason);
            }
            close(&mut sink, refusal.code, if refusal.code == UNPAIRED { "unpaired" } else { "handshake failed" })
                .await;
            return;
        }
    };
    let hello = match first_hello(&mut stream, &opened.channel, deadline).await {
        Ok(hello) => hello,
        Err(reason) => {
            server.gate.fail(&address, &parsed.pattern, &format!("device {}: {reason}", opened.device));
            close(&mut sink, BROKEN, "expected hello").await;
            return;
        }
    };
    drop(opening);
    attached(&server, sink, stream, opened, hello, protocol, address).await;
}

fn noise_error(error: &snow::Error) -> Refusal {
    Refusal::failed(BROKEN, format!("noise: {error}"))
}

async fn handshake_message(stream: &mut Stream, deadline: Instant, step: &str) -> Result<Bytes, Refusal> {
    match next_by(stream, deadline).await {
        Some(Next::Binary(bytes)) => Ok(bytes),
        Some(Next::Gone) => Err(Refusal::failed(BROKEN, format!("closed before {step}"))),
        Some(Next::Text(_)) => Err(Refusal::failed(BROKEN, format!("a text message instead of {step}"))),
        None => Err(Refusal::failed(BROKEN, "the handshake did not finish within 10 s")),
    }
}

async fn kk(
    server: &Server,
    sink: &mut Sink,
    stream: &mut Stream,
    device: &str,
    prologue: &[u8],
    deadline: Instant,
) -> Result<Opened, Refusal> {
    let known = server.devices.device(device).map_err(|error| Refusal {
        code: 1011,
        reason: format!("read the device list: {error:#}"),
        counts: false,
    })?;
    let Some(known) = known else {
        return Err(Refusal::failed(UNPAIRED, format!("unknown or revoked device {device}")));
    };
    let key = unhex(&known.key).ok_or_else(|| Refusal::failed(UNPAIRED, "the stored device key is malformed"))?;
    let mut state: HandshakeState = noise::KK.parse().map_err(|error| noise_error(&error)).and_then(|params| {
        snow::Builder::new(params)
            .local_private_key(&server.key.private)
            .and_then(|builder| builder.remote_public_key(&key))
            .and_then(|builder| builder.prologue(prologue))
            .and_then(snow::Builder::build_responder)
            .map_err(|error| noise_error(&error))
    })?;
    let first = handshake_message(stream, deadline, "the first handshake message").await?;
    noise::read(&mut state, &first)
        .map_err(|_| Refusal::failed(UNPAIRED, format!("the KK handshake for device {device} failed")))?;
    let second = noise::write(&mut state, &[]).map_err(|error| noise_error(&error))?;
    sink.send(Message::binary(second)).await.map_err(|_| Refusal::failed(BROKEN, "closed during the handshake"))?;
    let transport = state.into_transport_mode().map_err(|error| noise_error(&error))?;
    Ok(Opened { device: device.to_string(), key: known.key, channel: Channel::new(transport) })
}

async fn xx(
    server: &Server,
    sink: &mut Sink,
    stream: &mut Stream,
    pairing: &str,
    prologue: &[u8],
    deadline: Instant,
) -> Result<Opened, Refusal> {
    let unreadable = |error: anyhow::Error| Refusal { code: 1011, reason: format!("{error:#}"), counts: false };
    let psk = match server.devices.pairing(pairing).map_err(unreadable)? {
        Ok(psk) => psk,
        Err(reason) => return Err(Refusal::failed(UNPAIRED, format!("pairing {pairing}: {reason}"))),
    };
    let mut state: HandshakeState = noise::XX.parse().map_err(|error| noise_error(&error)).and_then(|params| {
        snow::Builder::new(params)
            .local_private_key(&server.key.private)
            .and_then(|builder| builder.psk(3, &psk.0))
            .and_then(|builder| builder.prologue(prologue))
            .and_then(snow::Builder::build_responder)
            .map_err(|error| noise_error(&error))
    })?;
    let first = handshake_message(stream, deadline, "the first handshake message").await?;
    noise::read(&mut state, &first).map_err(|error| noise_error(&error))?;
    let second = noise::write(&mut state, &[]).map_err(|error| noise_error(&error))?;
    sink.send(Message::binary(second)).await.map_err(|_| Refusal::failed(BROKEN, "closed during the handshake"))?;
    let third = handshake_message(stream, deadline, "the third handshake message").await?;
    let record = noise::read(&mut state, &third)
        .map_err(|_| Refusal::failed(UNPAIRED, format!("pairing {pairing}: wrong pairing secret")))?;
    let info: DeviceInfo = serde_json::from_slice(&record)
        .map_err(|error| Refusal::failed(BROKEN, format!("the device record is not valid: {error}")))?;
    let key =
        state.get_remote_static().map(<[u8]>::to_vec).ok_or_else(|| Refusal::failed(BROKEN, "no device static key"))?;
    match server.devices.complete_pairing(pairing, info.clone(), &key).map_err(unreadable)? {
        Ok(()) => eprintln!("local-studio-serve: paired {} ({}, {} {})", info.name, info.id, info.platform, info.app),
        Err(reason) => return Err(Refusal::failed(UNPAIRED, format!("pairing {pairing}: {reason}"))),
    }
    let transport = state.into_transport_mode().map_err(|error| noise_error(&error))?;
    Ok(Opened { device: info.id, key: hex(&key), channel: Channel::new(transport) })
}

fn resume_of(hello: &Value) -> Resume {
    let resume = hello.get("resume");
    Resume {
        seq: resume.and_then(|resume| resume.get("seq")).and_then(Value::as_u64),
        epoch: resume.and_then(|resume| resume.get("epoch")).and_then(Value::as_str).map(str::to_string),
        watch: resume
            .and_then(|resume| resume.get("watch"))
            .and_then(Value::as_array)
            .map(|threads| threads.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default(),
    }
}

async fn send_records(sink: &mut Sink, channel: &Channel, records: Vec<Vec<u8>>) -> bool {
    for record in records {
        let Ok(message) = channel.seal(&record) else { return false };
        if sink.send(Message::binary(message)).await.is_err() {
            return false;
        }
    }
    true
}

async fn first_hello(stream: &mut Stream, channel: &Channel, deadline: Instant) -> Result<Value, String> {
    let mut joiner = Joiner::default();
    loop {
        let Some(Next::Binary(bytes)) = next_by(stream, deadline).await else {
            return Err("no valid hello within 10 s of the opening".to_string());
        };
        let record = channel.open(&bytes).map_err(|_| "a record failed to decrypt".to_string())?;
        match joiner.feed(record)? {
            None => {}
            Some(Inbound::Json(text)) => {
                let hello: Value = serde_json::from_str(&text).map_err(|_| "the hello is not JSON".to_string())?;
                if hello.get("op").and_then(Value::as_str) != Some("hello") {
                    return Err("the first frame was not hello".to_string());
                }
                return Ok(hello);
            }
            Some(Inbound::Chunk { .. }) => return Err("a blob chunk before hello".to_string()),
        }
    }
}

async fn attached(
    server: &Arc<Server>,
    sink: Sink,
    mut stream: Stream,
    opened: Opened,
    hello: Value,
    protocol: u64,
    address: Client,
) {
    let channel = Arc::new(opened.channel);
    let said = |key: &str| hello.pointer(&format!("/device/{key}")).and_then(Value::as_str);
    if let Err(error) = server.devices.seen(&opened.device, said("name"), said("app"), said("channel")) {
        eprintln!("local-studio-serve: could not note the device as seen: {error:#}");
    }
    let name = server.devices.device(&opened.device).ok().flatten().map(|device| device.info.name).unwrap_or_default();
    let (tx, rx, cut, stop) = hub::outbound();
    let mut writer = tokio::spawn(write(sink, rx, Arc::clone(&channel)));
    let Some(conn) = server.hub.attach(&opened.device, &name, &opened.key, protocol, tx.clone(), &resume_of(&hello))
    else {
        eprintln!(
            "local-studio-serve: refused device {} from {address}: its watch changes do not fit the core's queue",
            opened.device
        );
        tx.send(Out::Close(BUSY, "busy".to_string()));
        drop(tx);
        if tokio::time::timeout(DRAIN, &mut writer).await.is_err() {
            writer.abort();
        }
        return;
    };
    let mut writing = true;
    let ended = tokio::select! {
        ended = read(server, &opened.device, conn, &tx, &mut stream, &channel) => ended,
        _ = &mut writer => {
            writing = false;
            Ok(())
        }
        () = cut.notified() => {
            writer.abort();
            writing = false;
            Err("it read too slowly and its outbound queue filled".to_string())
        }
        () = stop.notified() => {
            if tokio::time::timeout(CLOSE_WITHIN, &mut writer).await.is_err() {
                writer.abort();
            }
            writing = false;
            Ok(())
        }
    };
    if let Err(reason) = ended {
        eprintln!("local-studio-serve: closed device {} from {address}: {reason}", opened.device);
        tx.send(Out::Close(BROKEN, "protocol error".to_string()));
    }
    server.hub.detach(&opened.device, conn);
    drop(tx);
    if writing && tokio::time::timeout(DRAIN, &mut writer).await.is_err() {
        writer.abort();
        writer.await.ok();
    }
}

async fn write(mut sink: Sink, mut rx: Rx, channel: Arc<Channel>) {
    while let Some(out) = rx.recv().await {
        let sent = match out {
            Out::Frame(text) => send_records(&mut sink, &channel, noise::json_records(&text)).await,
            Out::Update { seq, text, blob } => {
                let frame = format!("{{\"op\":\"update\",\"seq\":{seq},\"update\":{text}}}");
                send_records(&mut sink, &channel, noise::json_records(&frame)).await
                    && match blob {
                        Some(blob) => {
                            send_records(&mut sink, &channel, noise::blob_records(&blob.id, &blob.data)).await
                        }
                        None => true,
                    }
            }
            Out::Close(code, reason) => {
                close(&mut sink, code, &reason).await;
                return;
            }
        };
        if !sent {
            return;
        }
    }
    close(&mut sink, 1000, "bye").await;
}

async fn read(
    server: &Arc<Server>,
    device: &str,
    conn: ConnId,
    tx: &Tx,
    stream: &mut Stream,
    channel: &Channel,
) -> Result<(), String> {
    let mut joiner = Joiner::default();
    loop {
        let bytes = match tokio::time::timeout(SILENCE, next(stream)).await {
            Err(_) => {
                tx.send(Out::Close(1000, "silent for 60 s".to_string()));
                return Ok(());
            }
            Ok(Next::Gone) => return Ok(()),
            Ok(Next::Text(_)) => return Err("a text message inside the encrypted channel".to_string()),
            Ok(Next::Binary(bytes)) => bytes,
        };
        let record = channel.open(&bytes).map_err(|_| "a record failed to decrypt".to_string())?;
        match joiner.feed(record)? {
            None => {}
            Some(Inbound::Json(text)) => {
                if let Some(reply) = answer(&server.hub, device, conn, &text) {
                    tx.send(Out::Frame(reply.to_string()));
                }
            }
            Some(Inbound::Chunk { blob, last, data }) => {
                if let Some(reply) = server.hub.blob_chunk(device, conn, blob, last, &data)? {
                    tx.send(Out::Frame(reply.to_string()));
                }
            }
        }
    }
}

fn answer(hub: &Hub, device: &str, conn: ConnId, text: &str) -> Option<Value> {
    let Ok(frame) = serde_json::from_str::<Value>(text) else {
        return Some(
            json!({ "op": "error", "error": { "code": "bad_frame", "message": "a frame must be a JSON object" } }),
        );
    };
    let op = frame.get("op").and_then(Value::as_str).unwrap_or_default();
    match op {
        "ping" => {
            return Some(match frame.get("id").filter(|id| !id.is_null()) {
                Some(id) => json!({ "re": id, "ok": true }),
                None => json!({ "op": "pong" }),
            });
        }
        "pong" => return None,
        _ => {}
    }
    let id = frame.get("id").cloned().unwrap_or(Value::Null);
    let args = frame.get("args").cloned().unwrap_or_else(|| json!({}));
    let result = match op {
        "hello" => Err(ops::OpError::new("bad_state", "hello is only valid as the first frame")),
        "watch" => {
            ops::arg::<String>(&args, "thread").and_then(|thread| hub.watch(device, conn, &thread)).map(|()| None)
        }
        "unwatch" => {
            ops::arg::<String>(&args, "thread").and_then(|thread| hub.unwatch(device, conn, &thread)).map(|()| None)
        }
        "load_earlier" => hub.load_earlier(device, conn, &args).map(Some),
        "blob_put" => match hub.blob_put(device, conn, id.clone(), &args) {
            Ok(()) => return None,
            Err(error) => Err(error),
        },
        _ => match hub.request(device, conn, op, &args) {
            Ok(true) => return Some(json!({ "re": id, "ok": true, "duplicate": true })),
            Ok(false) => Ok(None),
            Err(error) => Err(error),
        },
    };
    Some(match result {
        Ok(None) => json!({ "re": id, "ok": true }),
        Ok(Some(result)) => json!({ "re": id, "ok": true, "result": result }),
        Err(error) => json!({ "re": id, "error": error.to_value() }),
    })
}
