use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::rc::Rc;
use std::sync::mpsc;

use futures::StreamExt;
use futures::channel::mpsc::{UnboundedSender, unbounded};
use gpui::{App, AppContext, Context, Entity};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use crate::app_core::backend::{CoreProcess, ServerInfo};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TerminalStreamOp {
    Reset,
    Append,
    Paste,
    ClearSelection,
    Focus,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "t", rename_all = "camelCase")]
enum Inbound {
    Ready,
    Status {
        phase: String,
        detail: Option<String>,
    },
    View {
        id: u64,
        data: Value,
    },
    Result {
        id: u64,
        ok: bool,
        #[serde(default)]
        error: Option<String>,
    },
    Log {
        level: String,
        msg: String,
    },
    Term {
        key: String,
        op: TerminalStreamOp,
        data: String,
    },
    Device {
        stream: u64,
        packet: Value,
    },
}

pub struct Hello<'a> {
    pub server: Option<&'a ServerInfo>,
    pub t3_home: &'a str,
    pub platform: &'a str,
    pub appearance: &'a str,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CoreStatus {
    pub phase: String,
    pub detail: Option<String>,
}

type ViewHandler = Rc<dyn Fn(Value, &mut App)>;

pub struct CoreClient {
    outbox: mpsc::Sender<String>,
    next_id: u64,
    views: HashMap<u64, ViewHandler>,
    pub ready: bool,
    pub status: Option<CoreStatus>,
}

pub struct ViewState<V> {
    pub data: Option<V>,
    id: u64,
}

impl<V> ViewState<V> {
    pub fn id(&self) -> u64 {
        self.id
    }
}

fn spawn_writer(mut stdin: std::process::ChildStdin) -> mpsc::Sender<String> {
    let (outbox, lines) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in lines {
            if stdin.write_all(line.as_bytes()).is_err() || stdin.write_all(b"\n").is_err() {
                eprintln!("core: stdin closed");
                return;
            }
            if stdin.flush().is_err() {
                return;
            }
        }
    });
    outbox
}

fn spawn_reader(stdout: std::process::ChildStdout, inbox: UnboundedSender<Inbound>) {
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else {
                break;
            };
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<Inbound>(&line) {
                Ok(message) => {
                    if inbox.unbounded_send(message).is_err() {
                        return;
                    }
                }
                Err(error) => eprintln!("core: unreadable line ({error}): {line}"),
            }
        }
        eprintln!("core: stdout closed");
    });
}

impl CoreClient {
    pub fn start(process: CoreProcess, hello: Hello, cx: &mut App) -> Entity<Self> {
        let outbox = spawn_writer(process.stdin);
        let (inbox, mut messages) = unbounded();
        spawn_reader(process.stdout, inbox);
        let first = json!({
            "t": "hello",
            "server": hello.server.map(|server| json!({
                "httpUrl": server.http_url,
                "wsUrl": server.ws_url,
                "bootstrapToken": server.bootstrap_token,
            })),
            "t3Home": hello.t3_home,
            "platform": hello.platform,
            "appearance": hello.appearance,
        });
        let _ = outbox.send(first.to_string());
        let client = cx.new(|_| CoreClient {
            outbox,
            next_id: 1,
            views: HashMap::new(),
            ready: false,
            status: None,
        });
        let weak = client.downgrade();
        cx.spawn(async move |cx| {
            while let Some(message) = messages.next().await {
                let Some(client) = weak.upgrade() else {
                    return;
                };
                cx.update(|cx| Self::receive(&client, message, cx));
            }
        })
        .detach();
        client
    }

    fn receive(client: &Entity<Self>, message: Inbound, cx: &mut App) {
        match message {
            Inbound::Ready => client.update(cx, |client, cx| {
                client.ready = true;
                cx.notify();
            }),
            Inbound::Status { phase, detail } => client.update(cx, |client, cx| {
                client.status = Some(CoreStatus { phase, detail });
                cx.notify();
            }),
            Inbound::View { id, data } => {
                let handler = client.read(cx).views.get(&id).cloned();
                if let Some(handler) = handler {
                    handler(data, cx);
                }
            }
            Inbound::Result { id, ok, error } => {
                if !ok {
                    eprintln!(
                        "core: action {id} failed: {}",
                        error.unwrap_or_else(|| "unknown error".into())
                    );
                }
            }
            Inbound::Log { level, msg } => eprintln!("core {level}: {msg}"),
            Inbound::Term { key, op, data } => {
                crate::features::terminal::receive_output(client, key, op, data, cx)
            }
            Inbound::Device { stream, packet } => {
                crate::features::device::stream::receive_packet(stream, packet)
            }
        }
    }

    fn send(&self, message: Value) {
        if self.outbox.send(message.to_string()).is_err() {
            eprintln!("core: cannot send, writer stopped");
        }
    }

    fn allocate(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    pub fn subscribe<V: DeserializeOwned + 'static>(
        client: &Entity<Self>,
        view: &'static str,
        params: Value,
        cx: &mut App,
    ) -> Entity<ViewState<V>> {
        let id = client.update(cx, |client, _| client.allocate());
        let state = cx.new(|cx: &mut Context<ViewState<V>>| {
            let weak = client.downgrade();
            cx.on_release(move |_, cx| {
                if let Some(client) = weak.upgrade() {
                    client.update(cx, |client, _| {
                        client.views.remove(&id);
                        client.send(json!({ "t": "unsub", "id": id }));
                    });
                }
            })
            .detach();
            ViewState { data: None, id }
        });
        let target = state.downgrade();
        let handler: ViewHandler = Rc::new(move |data, cx| {
            let Some(target) = target.upgrade() else {
                return;
            };
            match serde_json::from_value::<V>(data) {
                Ok(value) => target.update(cx, |state, cx| {
                    state.data = Some(value);
                    cx.notify();
                }),
                Err(error) => eprintln!("core: view {view} does not match its contract: {error}"),
            }
        });
        client.update(cx, |client, _| {
            client.views.insert(id, handler);
            client.send(json!({ "t": "sub", "id": id, "view": view, "params": params }));
        });
        state
    }

    pub fn act(&mut self, action: &str, params: Value) {
        let id = self.allocate();
        self.send(json!({ "t": "act", "id": id, "action": action, "params": params }));
    }
}
