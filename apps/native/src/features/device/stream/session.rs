use std::collections::HashMap;
use std::io::{self, Read};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, LazyLock, Mutex, Weak};
use std::thread;
use std::time::{Duration, Instant};

use futures::channel::mpsc::UnboundedSender;
use serde_json::{Value, json};
use tungstenite::Message;

use super::decoder::{H264Decoder, avc_codec_string};
use super::frame::{FrameSlot, JpegFrames, Rotation, Rotator, VideoFrame};
use super::h264::{AvccDemuxer, AvccTag, parse_semu_packet, scan_access_unit};
use super::http;
use super::net::{self, Waker};
use super::socket::{self, Closed, Opened};
use crate::app_core::views::device_stream::{DevicePlatform, DeviceStreamTarget};

const RETRY_DELAY: Duration = Duration::from_secs(1);
const FIRST_FRAME_TIMEOUT: Duration = Duration::from_secs(15);
const PRIME_TIMEOUT: Duration = Duration::from_secs(2);
const NO_VIDEO: &str = "No video received from the device. Reconnect to try again.";
const VIDEO_STALLED: &str = "Device stream stopped receiving video. Reconnect to try again.";
const MJPEG_FAILED: &str = "Could not receive the device stream. Reconnect to try again.";

#[derive(Clone, Debug, PartialEq)]
pub enum StreamEvent {
    Status {
        status: &'static str,
        detail: Option<String>,
    },
    Input {
        connected: bool,
        detail: Option<String>,
    },
    Message {
        tag: u8,
        payload: Value,
    },
    FrameSize {
        width: u32,
        height: u32,
    },
    Mjpeg,
    Unauthorized,
    Stopped,
}

impl StreamEvent {
    pub fn to_json(&self) -> Value {
        let with_detail = |mut value: Value, detail: &Option<String>| {
            if let (Some(detail), Some(object)) = (detail, value.as_object_mut()) {
                object.insert("detail".into(), json!(detail));
            }
            value
        };
        match self {
            StreamEvent::Status { status, detail } => {
                with_detail(json!({ "kind": "status", "status": status }), detail)
            }
            StreamEvent::Input { connected, detail } => {
                with_detail(json!({ "kind": "input", "connected": connected }), detail)
            }
            StreamEvent::Message { tag, payload } => {
                json!({ "kind": "message", "tag": tag, "payload": payload })
            }
            StreamEvent::FrameSize { width, height } => {
                json!({ "kind": "frameSize", "width": width, "height": height })
            }
            StreamEvent::Mjpeg => json!({ "kind": "mjpeg" }),
            StreamEvent::Unauthorized => json!({ "kind": "unauthorized" }),
            StreamEvent::Stopped => json!({ "kind": "stopped" }),
        }
    }
}

pub enum Signal {
    Frame,
    Event(StreamEvent),
}

pub type Signals = UnboundedSender<(u64, Signal)>;

enum Control {
    Connecting(Option<String>),
    FirstFrame,
    Fail(String),
    Unauthorized,
    Event(StreamEvent),
    Stop,
}

type InputChannel = (mpsc::Sender<Message>, Arc<Waker>);

pub struct Shared {
    id: u64,
    ticketed: bool,
    stopped: AtomicBool,
    first_frame: AtomicBool,
    control: mpsc::Sender<Control>,
    sockets: Mutex<HashMap<u64, TcpStream>>,
    next_socket: AtomicU64,
    input: Mutex<Option<InputChannel>>,
    slot: FrameSlot,
}

pub struct SocketGuard {
    shared: Weak<Shared>,
    token: u64,
}

impl Drop for SocketGuard {
    fn drop(&mut self) {
        if let Some(shared) = self.shared.upgrade()
            && let Ok(mut sockets) = shared.sockets.lock()
        {
            sockets.remove(&self.token);
        }
    }
}

impl Shared {
    pub fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::Acquire)
    }

    pub fn register(self: &Arc<Self>, stream: &TcpStream) -> io::Result<SocketGuard> {
        let token = self.next_socket.fetch_add(1, Ordering::Relaxed);
        let clone = stream.try_clone()?;
        if let Ok(mut sockets) = self.sockets.lock() {
            sockets.insert(token, clone);
        }
        if self.is_stopped() {
            net::shutdown(stream);
        }
        Ok(SocketGuard {
            shared: Arc::downgrade(self),
            token,
        })
    }

    pub fn set_input(&self, channel: Option<InputChannel>) {
        if let Ok(mut input) = self.input.lock() {
            *input = channel;
        }
    }

    fn send_input(&self, message: Message) {
        if let Ok(input) = self.input.lock()
            && let Some((queue, waker)) = input.as_ref()
            && queue.send(message).is_ok()
        {
            waker.wake();
        }
    }

    fn stop(&self) {
        if self.stopped.swap(true, Ordering::AcqRel) {
            return;
        }
        if let Ok(sockets) = self.sockets.lock() {
            for stream in sockets.values() {
                net::shutdown(stream);
            }
        }
        if let Ok(input) = self.input.lock()
            && let Some((_, waker)) = input.as_ref()
        {
            waker.wake();
        }
        let _ = self.control.send(Control::Stop);
    }

    fn send(&self, control: Control) {
        if !self.is_stopped() {
            let _ = self.control.send(control);
        }
    }

    fn event(&self, event: StreamEvent) {
        self.send(Control::Event(event));
    }

    fn connecting(&self, detail: Option<String>) {
        self.first_frame.store(false, Ordering::Release);
        self.send(Control::Connecting(detail));
    }

    fn fail(&self, detail: impl Into<String>) {
        self.send(Control::Fail(detail.into()));
    }

    fn present(&self, frame: VideoFrame, rotator: &mut Rotator) {
        if self.is_stopped() {
            return;
        }
        self.slot.publish(frame, rotator);
        if !self.first_frame.swap(true, Ordering::AcqRel) {
            self.send(Control::FirstFrame);
        }
    }

    fn sleep(&self, duration: Duration) -> bool {
        let deadline = Instant::now() + duration;
        while Instant::now() < deadline {
            if self.is_stopped() {
                return false;
            }
            thread::sleep(Duration::from_millis(50));
        }
        !self.is_stopped()
    }

    fn unauthorized_close(&self, closed: &Closed) -> bool {
        closed.code == 1008 || closed.code == 4401 || (closed.code == 1006 && self.ticketed)
    }
}

static STREAMS: LazyLock<Mutex<HashMap<u64, Weak<Shared>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static NEXT_STREAM: AtomicU64 = AtomicU64::new(1);

pub fn send_packet(stream: u64, message: Message) {
    let shared = STREAMS
        .lock()
        .ok()
        .and_then(|streams| streams.get(&stream).and_then(Weak::upgrade));
    if let Some(shared) = shared {
        shared.send_input(message);
    }
}

pub struct StreamHandle {
    pub id: u64,
    pub target: DeviceStreamTarget,
    pub slot: FrameSlot,
    shared: Arc<Shared>,
}

impl Drop for StreamHandle {
    fn drop(&mut self) {
        self.shared.stop();
        if let Ok(mut streams) = STREAMS.lock() {
            streams.remove(&self.id);
        }
    }
}

pub fn start(target: DeviceStreamTarget, rotation: Rotation, signals: Signals) -> StreamHandle {
    let id = NEXT_STREAM.fetch_add(1, Ordering::Relaxed);
    let wake = signals.clone();
    let slot = FrameSlot::new(rotation, move || {
        let _ = wake.unbounded_send((id, Signal::Frame));
    });
    let (control, inbox) = mpsc::channel();
    let shared = Arc::new(Shared {
        id,
        ticketed: target.ticketed,
        stopped: AtomicBool::new(false),
        first_frame: AtomicBool::new(false),
        control,
        sockets: Mutex::new(HashMap::new()),
        next_socket: AtomicU64::new(0),
        input: Mutex::new(None),
        slot: slot.clone(),
    });
    if let Ok(mut streams) = STREAMS.lock() {
        streams.insert(id, Arc::downgrade(&shared));
    }
    {
        let shared = shared.clone();
        thread::Builder::new()
            .name(format!("device-stream-{id}"))
            .spawn(move || supervise(&shared, &inbox, &signals))
            .ok();
    }
    shared.connecting(None);
    match target.platform {
        DevicePlatform::Ios => {
            spawn_worker(&shared, "input", {
                let url = target.ios_input.clone();
                let mjpeg = target.mjpeg.clone();
                move |shared| ios_input(shared, &url, &mjpeg)
            });
            spawn_worker(&shared, "video", {
                let video = target.video.clone();
                let mjpeg = target.mjpeg.clone();
                move |shared| ios_video(shared, &video, &mjpeg)
            });
        }
        DevicePlatform::Android => spawn_worker(&shared, "android", {
            let url = target.android_socket.clone();
            move |shared| android(shared, &url)
        }),
    }
    StreamHandle {
        id,
        target,
        slot,
        shared,
    }
}

fn spawn_worker(
    shared: &Arc<Shared>,
    name: &str,
    work: impl FnOnce(&Arc<Shared>) + Send + 'static,
) {
    let shared = shared.clone();
    let spawned = thread::Builder::new()
        .name(format!("device-{name}-{}", shared.id))
        .spawn({
            let shared = shared.clone();
            move || work(&shared)
        });
    if spawned.is_err() {
        shared.fail("Could not start the device stream. Reconnect to try again.");
    }
}

fn supervise(shared: &Arc<Shared>, inbox: &mpsc::Receiver<Control>, signals: &Signals) {
    let emit = |event: StreamEvent| {
        let _ = signals.unbounded_send((shared.id, Signal::Event(event)));
    };
    let mut deadline: Option<Instant> = None;
    let mut last_status: Option<(&'static str, Option<String>)> = None;
    let mut status = |status: &'static str, detail: Option<String>| {
        let next = Some((status, detail.clone()));
        if last_status != next {
            last_status = next;
            emit(StreamEvent::Status { status, detail });
        }
    };
    loop {
        let wait = deadline
            .map(|deadline| deadline.saturating_duration_since(Instant::now()))
            .unwrap_or(Duration::from_secs(3_600));
        let control = match inbox.recv_timeout(wait) {
            Ok(control) => control,
            Err(RecvTimeoutError::Timeout) => {
                if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                    Control::Fail(NO_VIDEO.into())
                } else {
                    continue;
                }
            }
            Err(RecvTimeoutError::Disconnected) => return,
        };
        if shared.is_stopped() && !matches!(control, Control::Stop) {
            continue;
        }
        match control {
            Control::Stop => return,
            Control::Connecting(detail) => {
                if deadline.is_none() {
                    deadline = Some(Instant::now() + FIRST_FRAME_TIMEOUT);
                }
                status("connecting", detail);
            }
            Control::FirstFrame => {
                deadline = None;
                status("streaming", None);
            }
            Control::Event(event) => emit(event),
            Control::Fail(detail) => {
                shared.stop();
                emit(StreamEvent::Input {
                    connected: false,
                    detail: Some(detail.clone()),
                });
                status("error", Some(detail));
                return;
            }
            Control::Unauthorized => {
                shared.stop();
                emit(StreamEvent::Input {
                    connected: false,
                    detail: None,
                });
                emit(StreamEvent::Unauthorized);
                return;
            }
        }
    }
}

fn unauthorized_status(status: u16) -> bool {
    status == 401 || status == 403
}

fn prime_ios_helper(shared: &Arc<Shared>, mjpeg: &str) -> bool {
    let started = Instant::now();
    let Ok(mut response) = http::get(shared, mjpeg, Some(PRIME_TIMEOUT)) else {
        return true;
    };
    if unauthorized_status(response.status) {
        shared.send(Control::Unauthorized);
        return false;
    }
    if started.elapsed() < PRIME_TIMEOUT {
        let mut buf = [0u8; 4096];
        let _ = response.read(&mut buf);
    }
    true
}

fn closed_detail(closed: &Closed, refused: &str) -> String {
    if !closed.reason.is_empty() {
        closed.reason.clone()
    } else if closed.code == 1006 {
        refused.to_string()
    } else {
        format!("closed {}", closed.code)
    }
}

fn ios_input(shared: &Arc<Shared>, url: &str, mjpeg: &str) {
    while !shared.is_stopped() {
        if !prime_ios_helper(shared, mjpeg) || shared.is_stopped() {
            return;
        }
        let closed = match socket::open(shared, url) {
            Opened::Socket(mut ws, _guard) => {
                let opened = || {
                    shared.event(StreamEvent::Input {
                        connected: true,
                        detail: None,
                    })
                };
                let closed = socket::run(shared, &mut ws, opened, |message, _| {
                    if let Message::Binary(bytes) = message
                        && let Some((&tag, json)) = bytes.split_first()
                        && let Ok(payload) = serde_json::from_slice::<Value>(json)
                    {
                        shared.event(StreamEvent::Message { tag, payload });
                    }
                });
                match closed {
                    Some(closed) => closed,
                    None => return,
                }
            }
            Opened::Refused { status } => {
                if status.is_some_and(unauthorized_status) {
                    shared.event(StreamEvent::Input {
                        connected: false,
                        detail: Some("input socket refused".into()),
                    });
                    shared.send(Control::Unauthorized);
                    return;
                }
                Closed {
                    code: 1006,
                    reason: String::new(),
                }
            }
        };
        if shared.is_stopped() {
            return;
        }
        shared.event(StreamEvent::Input {
            connected: false,
            detail: Some(closed_detail(&closed, "input socket refused")),
        });
        if shared.unauthorized_close(&closed) {
            shared.send(Control::Unauthorized);
            return;
        }
        if !shared.sleep(RETRY_DELAY) {
            return;
        }
    }
}

enum VideoOutcome {
    Retry(Option<String>),
    Fail(String),
    Mjpeg,
    Unauthorized,
    Stopped,
}

fn ios_video(shared: &Arc<Shared>, video: &str, mjpeg: &str) {
    let mut rotator = Rotator::default();
    let mut jpeg = JpegFrames::default();
    loop {
        if shared.is_stopped() {
            return;
        }
        match read_ios_video(shared, video, &mut rotator, &mut jpeg) {
            VideoOutcome::Retry(detail) => {
                shared.connecting(detail);
                if !shared.sleep(RETRY_DELAY) {
                    return;
                }
            }
            VideoOutcome::Fail(detail) => return shared.fail(detail),
            VideoOutcome::Unauthorized => return shared.send(Control::Unauthorized),
            VideoOutcome::Stopped => return,
            VideoOutcome::Mjpeg => {
                shared.event(StreamEvent::Mjpeg);
                shared.connecting(None);
                return read_mjpeg(shared, mjpeg, &mut rotator, &mut jpeg);
            }
        }
    }
}

fn read_ios_video(
    shared: &Arc<Shared>,
    url: &str,
    rotator: &mut Rotator,
    jpeg: &mut JpegFrames,
) -> VideoOutcome {
    let mut response = match http::get(shared, url, Some(FIRST_FRAME_TIMEOUT)) {
        Ok(response) => response,
        Err(error) => return VideoOutcome::Retry(Some(error)),
    };
    if shared.is_stopped() {
        return VideoOutcome::Stopped;
    }
    if unauthorized_status(response.status) {
        return VideoOutcome::Unauthorized;
    }
    if !response.ok() {
        return VideoOutcome::Retry(Some(format!("stream {}", response.status)));
    }
    let mut demuxer = AvccDemuxer::default();
    let mut decoder: Option<H264Decoder> = None;
    let mut awaiting_keyframe = true;
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let read = match response.read(&mut buf) {
            Ok(0) => return VideoOutcome::Retry(None),
            Ok(read) => read,
            Err(_) if shared.is_stopped() => return VideoOutcome::Stopped,
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) =>
            {
                return VideoOutcome::Fail(VIDEO_STALLED.into());
            }
            Err(error) => return VideoOutcome::Retry(Some(error.to_string())),
        };
        let mut outcome = None;
        demuxer.push(&buf[..read], |tag, payload| {
            if outcome.is_some() || shared.is_stopped() {
                return;
            }
            match tag {
                AvccTag::Seed => {
                    if let Some(frame) = jpeg.decode(payload) {
                        shared.present(frame, rotator);
                    }
                }
                AvccTag::Description => {
                    awaiting_keyframe = true;
                    match H264Decoder::from_avcc_record(payload) {
                        Ok(configured) => decoder = Some(configured),
                        Err(_) => {
                            decoder = None;
                            outcome = Some(VideoOutcome::Mjpeg);
                        }
                    }
                }
                AvccTag::Keyframe | AvccTag::Delta => {
                    let Some(active) = decoder.as_mut() else {
                        return;
                    };
                    if awaiting_keyframe {
                        if tag != AvccTag::Keyframe {
                            return;
                        }
                        awaiting_keyframe = false;
                    }
                    match active.decode_avcc(payload) {
                        Ok(Some(frame)) => shared.present(frame, rotator),
                        Ok(None) => {}
                        Err(_) => outcome = Some(VideoOutcome::Mjpeg),
                    }
                }
            }
        });
        if shared.is_stopped() {
            return VideoOutcome::Stopped;
        }
        if let Some(outcome) = outcome {
            return outcome;
        }
    }
}

fn find(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    (from..=haystack.len() - needle.len()).find(|&at| &haystack[at..at + needle.len()] == needle)
}

fn read_mjpeg(shared: &Arc<Shared>, url: &str, rotator: &mut Rotator, jpeg: &mut JpegFrames) {
    let mut response = match http::get(shared, url, None) {
        Ok(response) if response.ok() => response,
        Ok(_) | Err(_) => {
            if !shared.is_stopped() {
                shared.fail(MJPEG_FAILED);
            }
            return;
        }
    };
    let boundary = response.boundary().map(|boundary| {
        let boundary = boundary.trim_start_matches("--");
        format!("--{boundary}").into_bytes()
    });
    let mut pending: Vec<u8> = Vec::with_capacity(512 * 1024);
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let read = match response.read(&mut buf) {
            Ok(0) => return,
            Ok(read) => read,
            Err(_) => {
                if !shared.is_stopped() {
                    shared.fail(MJPEG_FAILED);
                }
                return;
            }
        };
        if shared.is_stopped() {
            return;
        }
        pending.extend_from_slice(&buf[..read]);
        let mut consumed = 0;
        while let Some((start, end, next)) = next_jpeg(&pending, consumed, boundary.as_deref()) {
            if let Some(frame) = jpeg.decode(&pending[start..end]) {
                shared.present(frame, rotator);
            }
            consumed = next;
        }
        if consumed > 0 {
            pending.drain(..consumed);
        }
    }
}

fn next_jpeg(buf: &[u8], from: usize, boundary: Option<&[u8]>) -> Option<(usize, usize, usize)> {
    if let Some(boundary) = boundary {
        let part = find(buf, boundary, from)?;
        let headers_end = find(buf, b"\r\n\r\n", part)? + 4;
        let headers = String::from_utf8_lossy(&buf[part..headers_end]);
        let length = headers.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.trim()
                .eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        });
        return match length {
            Some(length) if headers_end + length <= buf.len() => {
                Some((headers_end, headers_end + length, headers_end + length))
            }
            Some(_) => None,
            None => {
                let next = find(buf, boundary, headers_end)?;
                Some((headers_end, next, next))
            }
        };
    }
    let start = find(buf, &[0xff, 0xd8], from)?;
    let end = find(buf, &[0xff, 0xd9], start + 2)? + 2;
    Some((start, end, end))
}

fn android(shared: &Arc<Shared>, url: &str) {
    let mut rotator = Rotator::default();
    let mut size: Option<(u32, u32)> = None;
    while !shared.is_stopped() {
        let closed = match socket::open(shared, url) {
            Opened::Socket(mut ws, _guard) => {
                let mut video = AndroidVideo::default();
                let opened = || {
                    shared.connecting(None);
                    shared.event(StreamEvent::Input {
                        connected: true,
                        detail: None,
                    });
                };
                let closed =
                    socket::run(shared, &mut ws, opened, |message, replies| match message {
                        Message::Text(text) => {
                            if is_video_session(text.as_str()) {
                                video.decoder = None;
                                shared.connecting(None);
                                replies.push(reset_video());
                            }
                        }
                        Message::Binary(bytes) => {
                            video.receive(shared, &bytes, &mut rotator, &mut size, replies);
                        }
                        _ => {}
                    });
                match closed {
                    Some(closed) => closed,
                    None => return,
                }
            }
            Opened::Refused { status } => Closed {
                code: if status.is_some_and(unauthorized_status) {
                    1008
                } else {
                    1006
                },
                reason: String::new(),
            },
        };
        if shared.is_stopped() {
            return;
        }
        shared.event(StreamEvent::Input {
            connected: false,
            detail: Some(if closed.reason.is_empty() {
                format!("closed {}", closed.code)
            } else {
                closed.reason.clone()
            }),
        });
        if shared.unauthorized_close(&closed) {
            shared.send(Control::Unauthorized);
            return;
        }
        shared.connecting((!closed.reason.is_empty()).then(|| closed.reason.clone()));
        if !shared.sleep(RETRY_DELAY) {
            return;
        }
    }
}

fn is_video_session(text: &str) -> bool {
    serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|message| message.get("type").cloned())
        .is_some_and(|kind| kind == "video-session")
}

fn reset_video() -> Message {
    Message::text(json!({ "type": "reset-video", "ack": false }).to_string())
}

#[derive(Default)]
struct AndroidVideo {
    decoder: Option<H264Decoder>,
    awaiting_keyframe: bool,
}

impl AndroidVideo {
    fn receive(
        &mut self,
        shared: &Arc<Shared>,
        bytes: &[u8],
        rotator: &mut Rotator,
        size: &mut Option<(u32, u32)>,
        replies: &mut Vec<Message>,
    ) {
        let packet = parse_semu_packet(bytes);
        let configured = self.decoder.is_some();
        let needs_scan = packet.is_key.is_none() || (packet.is_key == Some(true) && !configured);
        let scan = needs_scan.then(|| scan_access_unit(packet.data));
        let is_key = packet
            .is_key
            .or(scan.as_ref().map(|scan| scan.is_key))
            .unwrap_or(false);
        if !configured {
            match scan.as_ref().and_then(|scan| scan.sps.zip(scan.pps)) {
                Some((sps, pps)) => match H264Decoder::from_parameter_sets(sps, pps) {
                    Ok(decoder) => {
                        self.decoder = Some(decoder);
                        self.awaiting_keyframe = true;
                    }
                    Err(_) => {
                        shared.fail(format!("This app cannot decode {}.", avc_codec_string(sps)));
                        return;
                    }
                },
                None => {
                    if !is_key {
                        replies.push(reset_video());
                    }
                    return;
                }
            }
        }
        let Some(decoder) = self.decoder.as_mut() else {
            return;
        };
        if self.awaiting_keyframe {
            if !is_key {
                return;
            }
            self.awaiting_keyframe = false;
        }
        match decoder.decode_annexb(packet.data) {
            Ok(Some(frame)) => {
                if *size != Some((frame.width, frame.height)) {
                    *size = Some((frame.width, frame.height));
                    shared.event(StreamEvent::FrameSize {
                        width: frame.width,
                        height: frame.height,
                    });
                }
                shared.present(frame, rotator);
            }
            Ok(None) => {}
            Err(_) => {
                self.decoder = None;
                shared.connecting(Some("Video decoder restarted.".into()));
                replies.push(reset_video());
            }
        }
    }
}
