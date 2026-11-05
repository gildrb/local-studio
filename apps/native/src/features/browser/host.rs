use std::collections::HashMap;
use std::sync::Arc;

use futures::StreamExt;
use futures::channel::mpsc::{UnboundedSender, unbounded};
use gpui::{
    App, AppContext, Bounds, Context, Entity, Global, Image, ImageFormat, Pixels, Window, point,
    px, size,
};
use serde_json::{Value, json};
use wry::dpi::{LogicalPosition, LogicalSize};
use wry::{PageLoadEvent, Rect, WebView};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::browser::{
    BrowserHostCommand, BrowserHostCommandEntry, BrowserHostTab, BrowserHostView,
    BrowserStoreCommand, BrowserStoreCommandEntry,
};
use crate::platform::webview;
use crate::ui::overlay_bounds::{OpenOverlays, open_overlays};

const SNAPSHOT_MAX_WIDTH: f64 = 1280.;
const ABOUT_BLANK: &str = "about:blank";

#[derive(Clone, Debug, PartialEq)]
enum Nav {
    Idle,
    Loading { url: String, title: String },
    Success { url: String, title: String },
}

impl Nav {
    fn json(&self) -> Value {
        match self {
            Nav::Idle => json!({ "kind": "Idle" }),
            Nav::Loading { url, title } => json!({ "kind": "Loading", "url": url, "title": title }),
            Nav::Success { url, title } => json!({ "kind": "Success", "url": url, "title": title }),
        }
    }

    fn title(&self) -> String {
        match self {
            Nav::Idle => String::new(),
            Nav::Loading { title, .. } | Nav::Success { title, .. } => title.clone(),
        }
    }
}

enum HostEvent {
    Started(String, String),
    Finished(String, String),
    Title(String, String),
    Ipc(String, String),
    Snapshot {
        id: u64,
        path: Option<String>,
        result: Result<webview::Snapshot, String>,
    },
    Cover(String, Result<webview::Snapshot, String>),
    Store(u64, Result<Value, String>),
}

enum Cover {
    None,
    Pending,
    Shown(Option<Arc<Image>>),
}

type Frame = (f32, f32, f32, f32);

struct HostTab {
    webview: WebView,
    nav: Nav,
    zoom: f64,
    color_scheme: String,
    muted: bool,
    shown: Option<Frame>,
    frame: Option<Frame>,
    radius: f32,
    cover: Cover,
    last_report: Option<Value>,
}

#[derive(Clone, Copy, PartialEq)]
pub enum SlotKind {
    Panel { device_toolbar: bool },
    MiniPlayer { corner_radius: f32 },
}

#[derive(Clone, Copy, PartialEq)]
struct Slot {
    bounds: Bounds<Pixels>,
    kind: SlotKind,
}

type ReportedSlot = (String, i32, i32, bool, bool);

pub struct BrowserHostHandle(pub Entity<BrowserHost>);

impl Global for BrowserHostHandle {}

pub struct BrowserHost {
    client: Entity<CoreClient>,
    view: Entity<ViewState<BrowserHostView>>,
    tabs: HashMap<String, HostTab>,
    slots: HashMap<String, Slot>,
    reported_slots: Vec<ReportedSlot>,
    last_command: u64,
    last_store_command: u64,
    stores: webview::ProfileStores,
    events: UnboundedSender<HostEvent>,
    content_zoom: f32,
}

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(char::from(TABLE[(n >> 18) as usize & 63]));
        out.push(char::from(TABLE[(n >> 12) as usize & 63]));
        out.push(if chunk.len() > 1 {
            char::from(TABLE[(n >> 6) as usize & 63])
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            char::from(TABLE[n as usize & 63])
        } else {
            '='
        });
    }
    out
}

impl BrowserHost {
    pub fn install(client: &Entity<CoreClient>, window: &mut Window, cx: &mut App) {
        let host_client = client.clone();
        let host = cx.new(|cx| BrowserHost::new(host_client, window, cx));
        cx.set_global(BrowserHostHandle(host));
        crate::features::browser::mini_player::MiniPlayer::install(client, cx);
    }

    fn new(client: Entity<CoreClient>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<BrowserHostView>(&client, "browserHost", json!({}), cx);
        cx.observe_in(&view, window, |host, _, window, cx| host.sync(window, cx))
            .detach();
        cx.observe_window_activation(window, |host, window, cx| {
            act(
                &host.client,
                cx,
                "browserHostWindowFocus",
                json!({ "focused": window.is_window_active() }),
            );
        })
        .detach();
        cx.observe_global::<OpenOverlays>(|host, cx| host.place_all(cx))
            .detach();
        let (events, mut inbox) = unbounded();
        cx.spawn(async move |host, cx| {
            while let Some(event) = inbox.next().await {
                if host.update(cx, |host, cx| host.handle(event, cx)).is_err() {
                    return;
                }
            }
        })
        .detach();
        Self {
            client,
            view,
            tabs: HashMap::new(),
            slots: HashMap::new(),
            reported_slots: Vec::new(),
            last_command: 0,
            last_store_command: 0,
            stores: webview::ProfileStores::default(),
            events,
            content_zoom: 1.,
        }
    }

    pub fn set_slot(
        &mut self,
        runtime_tab_id: &str,
        bounds: Bounds<Pixels>,
        kind: SlotKind,
        cx: &mut Context<Self>,
    ) {
        let slot = Slot { bounds, kind };
        let zoom_changed = (crate::platform::appearance::content_zoom(cx) - self.content_zoom)
            .abs()
            > f32::EPSILON;
        if self.slots.get(runtime_tab_id) == Some(&slot) && !zoom_changed {
            return;
        }
        self.slots.insert(runtime_tab_id.to_string(), slot);
        self.place_all(cx);
        self.report_slots(cx);
    }

    pub fn cover(&self, runtime_tab_id: &str) -> Option<(Arc<Image>, Bounds<Pixels>)> {
        let tab = self.tabs.get(runtime_tab_id)?;
        let Cover::Shown(Some(image)) = &tab.cover else {
            return None;
        };
        let (x, y, width, height) = tab.frame?;
        let origin = self.slots.get(runtime_tab_id)?.bounds.origin;
        Some((
            image.clone(),
            Bounds::new(
                point(px(x) - origin.x, px(y) - origin.y),
                size(px(width), px(height)),
            ),
        ))
    }

    fn report_slots(&mut self, cx: &mut Context<Self>) {
        let mut slots: Vec<ReportedSlot> = self
            .slots
            .iter()
            .map(|(id, slot)| {
                let (device_toolbar, fit_source) = match slot.kind {
                    SlotKind::Panel { device_toolbar } => (device_toolbar, false),
                    SlotKind::MiniPlayer { .. } => (false, true),
                };
                (
                    id.clone(),
                    f32::from(slot.bounds.size.width).round() as i32,
                    f32::from(slot.bounds.size.height).round() as i32,
                    device_toolbar,
                    fit_source,
                )
            })
            .collect();
        slots.sort();
        if slots == self.reported_slots {
            return;
        }
        self.reported_slots = slots.clone();
        let payload: Vec<Value> = slots
            .into_iter()
            .map(|(id, width, height, device_toolbar, fit_source)| {
                json!({
                    "runtimeTabId": id,
                    "width": width,
                    "height": height,
                    "deviceToolbar": device_toolbar,
                    "fitSource": fit_source,
                })
            })
            .collect();
        act(
            &self.client,
            cx,
            "browserHostSlots",
            json!({ "slots": payload }),
        );
    }

    fn data(&self, cx: &App) -> Option<BrowserHostView> {
        self.view.read(cx).data.clone()
    }

    fn sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(view) = self.data(cx) else {
            return;
        };
        self.tabs
            .retain(|id, _| view.tabs.iter().any(|tab| &tab.runtime_tab_id == id));
        self.slots
            .retain(|id, _| view.tabs.iter().any(|tab| &tab.runtime_tab_id == id));
        for tab in &view.tabs {
            if !self.tabs.contains_key(&tab.runtime_tab_id) {
                self.create(tab, &view.init_script, window, cx);
            }
        }
        for tab in &view.tabs {
            if let Some(host_tab) = self.tabs.get_mut(&tab.runtime_tab_id) {
                if host_tab.color_scheme != tab.color_scheme {
                    host_tab.color_scheme = tab.color_scheme.clone();
                    webview::set_color_scheme(&host_tab.webview, &tab.color_scheme);
                }
                if host_tab.muted != tab.audio_muted {
                    host_tab.muted = tab.audio_muted;
                    webview::set_audio_muted(&host_tab.webview, tab.audio_muted);
                }
            }
        }
        self.place_all(cx);
        let pending: Vec<BrowserHostCommandEntry> = view
            .commands
            .iter()
            .filter(|entry| entry.id > self.last_command)
            .cloned()
            .collect();
        for entry in pending {
            self.last_command = self.last_command.max(entry.id);
            self.execute(entry, cx);
        }
        let pending_store: Vec<BrowserStoreCommandEntry> = view
            .store_commands
            .iter()
            .filter(|entry| entry.id > self.last_store_command)
            .cloned()
            .collect();
        for entry in pending_store {
            self.last_store_command = self.last_store_command.max(entry.id);
            self.execute_store(entry, window);
        }
    }

    fn create(
        &mut self,
        tab: &BrowserHostTab,
        init_script: &str,
        window: &Window,
        cx: &mut Context<Self>,
    ) {
        let id = tab.runtime_tab_id.clone();
        let (ipc_id, load_id, title_id) = (id.clone(), id.clone(), id.clone());
        let (ipc_tx, load_tx, title_tx) = (
            self.events.clone(),
            self.events.clone(),
            self.events.clone(),
        );
        let url = tab
            .initial_url
            .clone()
            .unwrap_or_else(|| ABOUT_BLANK.to_string());
        let builder = match self.stores.builder(&tab.store) {
            Ok(builder) => builder,
            Err(error) => {
                eprintln!("browser: cannot open the profile's data store: {error}");
                return;
            }
        };
        let built = builder
            .with_url(url.clone())
            .with_initialization_script(init_script)
            .with_devtools(true)
            .with_visible(false)
            .with_accept_first_mouse(true)
            .with_bounds(Rect {
                position: LogicalPosition::new(0., 0.).into(),
                size: LogicalSize::new(1., 1.).into(),
            })
            .with_ipc_handler(move |request| {
                let _ =
                    ipc_tx.unbounded_send(HostEvent::Ipc(ipc_id.clone(), request.body().clone()));
            })
            .with_on_page_load_handler(move |event, url| {
                let event = match event {
                    PageLoadEvent::Started => HostEvent::Started(load_id.clone(), url),
                    PageLoadEvent::Finished => HostEvent::Finished(load_id.clone(), url),
                };
                let _ = load_tx.unbounded_send(event);
            })
            .with_document_title_changed_handler(move |title| {
                let _ = title_tx.unbounded_send(HostEvent::Title(title_id.clone(), title));
            })
            .build_as_child(window);
        let webview = match built {
            Ok(webview) => webview,
            Err(error) => {
                eprintln!("browser: cannot create webview: {error}");
                return;
            }
        };
        let _ = webview.zoom(tab.zoom_factor);
        webview::set_color_scheme(&webview, &tab.color_scheme);
        webview::set_audio_muted(&webview, tab.audio_muted);
        let nav = match tab.initial_url.as_ref() {
            Some(url) => Nav::Loading {
                url: url.clone(),
                title: String::new(),
            },
            None => Nav::Idle,
        };
        self.tabs.insert(
            id.clone(),
            HostTab {
                webview,
                nav,
                zoom: tab.zoom_factor,
                color_scheme: tab.color_scheme.clone(),
                muted: tab.audio_muted,
                shown: None,
                frame: None,
                radius: 0.,
                cover: Cover::None,
                last_report: None,
            },
        );
        self.report(&id, cx);
    }

    fn place_all(&mut self, cx: &mut Context<Self>) {
        let Some(view) = self.data(cx) else {
            return;
        };
        let content_zoom = crate::platform::appearance::content_zoom(cx);
        if (content_zoom - self.content_zoom).abs() > f32::EPSILON {
            self.content_zoom = content_zoom;
            for host_tab in self.tabs.values_mut() {
                host_tab.shown = None;
                host_tab.radius = -1.;
            }
        }
        let mut covers_changed = false;
        for tab in &view.tabs {
            let Some(host_tab) = self.tabs.get_mut(&tab.runtime_tab_id) else {
                continue;
            };
            let slot = self.slots.get(&tab.runtime_tab_id).filter(|_| tab.visible);
            let frame = slot.map(|slot| {
                let origin = slot.bounds.origin;
                let (x, y) = (f32::from(origin.x), f32::from(origin.y));
                match tab.layout.as_ref().filter(|layout| !layout.fills_panel) {
                    Some(layout) => (x + layout.x, y + layout.y, layout.width, layout.height),
                    None => (
                        x,
                        y,
                        f32::from(slot.bounds.size.width),
                        f32::from(slot.bounds.size.height),
                    ),
                }
            });
            let radius = match slot.map(|slot| slot.kind) {
                Some(SlotKind::MiniPlayer { corner_radius }) => corner_radius,
                _ => 0.,
            };
            if (radius - host_tab.radius).abs() > f32::EPSILON {
                host_tab.radius = radius;
                webview::set_corner_radius(&host_tab.webview, radius * content_zoom);
            }
            let zoom = tab
                .layout
                .as_ref()
                .map(|layout| layout.page_zoom)
                .unwrap_or(tab.zoom_factor);
            if (zoom - host_tab.zoom).abs() > f64::EPSILON {
                host_tab.zoom = zoom;
                let _ = host_tab.webview.zoom(zoom);
            }
            let covered = frame.is_some_and(|(x, y, width, height)| {
                open_overlays(cx).is_some_and(|overlays| {
                    overlays.intersects(Bounds::new(
                        point(px(x), px(y)),
                        size(px(width), px(height)),
                    ))
                })
            });
            if frame != host_tab.frame {
                host_tab.frame = frame;
                covers_changed |= matches!(host_tab.cover, Cover::Shown(_));
            }
            match (&host_tab.cover, covered) {
                (Cover::None, true) => {
                    host_tab.cover = Cover::Pending;
                    let events = self.events.clone();
                    let id = tab.runtime_tab_id.clone();
                    webview::snapshot(&host_tab.webview, f64::MAX, move |result| {
                        let _ = events.unbounded_send(HostEvent::Cover(id, result));
                    });
                }
                (Cover::Pending | Cover::Shown(_), false) => {
                    covers_changed |= matches!(host_tab.cover, Cover::Shown(_));
                    host_tab.cover = Cover::None;
                }
                _ => {}
            }
            let target = frame.filter(|_| !matches!(host_tab.cover, Cover::Shown(_)));
            if target == host_tab.shown {
                continue;
            }
            host_tab.shown = target;
            match target {
                Some((x, y, width, height)) => {
                    let _ = host_tab.webview.set_bounds(Rect {
                        position: LogicalPosition::new(
                            f64::from(x * content_zoom),
                            f64::from(y * content_zoom),
                        )
                        .into(),
                        size: LogicalSize::new(
                            f64::from(width.max(1.) * content_zoom),
                            f64::from(height.max(1.) * content_zoom),
                        )
                        .into(),
                    });
                    let _ = host_tab.webview.set_visible(true);
                }
                None => {
                    let _ = host_tab.webview.set_visible(false);
                }
            }
        }
        if covers_changed {
            cx.notify();
        }
    }

    fn apply_cover(
        &mut self,
        runtime_tab_id: &str,
        result: Result<webview::Snapshot, String>,
        cx: &mut Context<Self>,
    ) {
        let Some(tab) = self.tabs.get_mut(runtime_tab_id) else {
            return;
        };
        if !matches!(tab.cover, Cover::Pending) {
            return;
        }
        tab.cover = Cover::Shown(
            result
                .ok()
                .map(|snapshot| Arc::new(Image::from_bytes(ImageFormat::Png, snapshot.png))),
        );
        self.place_all(cx);
        cx.notify();
    }

    fn report(&mut self, runtime_tab_id: &str, cx: &mut Context<Self>) {
        let Some(tab) = self.tabs.get_mut(runtime_tab_id) else {
            return;
        };
        let payload = json!({
            "runtimeTabId": runtime_tab_id,
            "webviewReady": true,
            "navStatus": tab.nav.json(),
            "canGoBack": tab.webview.can_go_back().unwrap_or(false),
            "canGoForward": tab.webview.can_go_forward().unwrap_or(false),
            "audible": false,
            "favicon": Value::Null,
        });
        if tab.last_report.as_ref() == Some(&payload) {
            return;
        }
        tab.last_report = Some(payload.clone());
        act(&self.client, cx, "browserHostReport", payload);
    }

    fn handle(&mut self, event: HostEvent, cx: &mut Context<Self>) {
        match event {
            HostEvent::Started(id, url) => {
                if let Some(tab) = self.tabs.get_mut(&id) {
                    let title = tab.nav.title();
                    tab.nav = Nav::Loading { url, title };
                }
                self.report(&id, cx);
            }
            HostEvent::Finished(id, url) => {
                if let Some(tab) = self.tabs.get_mut(&id) {
                    let title = tab.nav.title();
                    tab.nav = if url == ABOUT_BLANK {
                        Nav::Idle
                    } else {
                        Nav::Success { url, title }
                    };
                }
                self.report(&id, cx);
            }
            HostEvent::Title(id, title) => {
                if let Some(tab) = self.tabs.get_mut(&id) {
                    tab.nav = match tab.nav.clone() {
                        Nav::Loading { url, .. } => Nav::Loading { url, title },
                        Nav::Success { url, .. } => Nav::Success { url, title },
                        Nav::Idle => Nav::Idle,
                    };
                }
                self.report(&id, cx);
            }
            HostEvent::Ipc(id, message) => act(
                &self.client,
                cx,
                "browserHostMessage",
                json!({ "runtimeTabId": id, "message": message }),
            ),
            HostEvent::Cover(id, result) => self.apply_cover(&id, result, cx),
            HostEvent::Store(id, result) => self.ack(id, result, cx),
            HostEvent::Snapshot { id, path, result } => {
                let outcome = result.and_then(|snapshot| match path {
                    Some(path) => std::fs::write(&path, &snapshot.png)
                        .map(|()| Value::Null)
                        .map_err(|error| error.to_string()),
                    None => Ok(Value::String(
                        json!({
                            "data": base64(&snapshot.png),
                            "width": snapshot.width,
                            "height": snapshot.height,
                        })
                        .to_string(),
                    )),
                });
                match outcome {
                    Ok(value) => self.ack(id, Ok(value), cx),
                    Err(error) => self.ack(id, Err(error), cx),
                }
            }
        }
    }

    fn ack(&self, id: u64, result: Result<Value, String>, cx: &mut Context<Self>) {
        let payload = match result {
            Ok(value) => json!({ "id": id, "ok": true, "value": value }),
            Err(error) => json!({ "id": id, "ok": false, "error": error }),
        };
        act(&self.client, cx, "browserHostCommandResult", payload);
    }

    fn execute(&mut self, entry: BrowserHostCommandEntry, cx: &mut Context<Self>) {
        let id = entry.id;
        let Some(tab) = self.tabs.get_mut(&entry.runtime_tab_id) else {
            self.ack(id, Err("The browser tab is not open.".into()), cx);
            return;
        };
        let result: Result<(), String> = match entry.command {
            BrowserHostCommand::Navigate { url } => {
                tab.nav = Nav::Loading {
                    url: url.clone(),
                    title: String::new(),
                };
                let result = tab
                    .webview
                    .load_url(&url)
                    .map_err(|error| error.to_string());
                self.report(&entry.runtime_tab_id, cx);
                result
            }
            BrowserHostCommand::Back => tab.webview.go_back().map_err(|error| error.to_string()),
            BrowserHostCommand::Forward => {
                tab.webview.go_forward().map_err(|error| error.to_string())
            }
            BrowserHostCommand::Reload => tab.webview.reload().map_err(|error| error.to_string()),
            BrowserHostCommand::HardReload => {
                webview::hard_reload(&tab.webview);
                Ok(())
            }
            BrowserHostCommand::Stop => {
                webview::stop_loading(&tab.webview);
                Ok(())
            }
            BrowserHostCommand::OpenDevTools => {
                tab.webview.open_devtools();
                Ok(())
            }
            BrowserHostCommand::Evaluate { script } => {
                if let Err(error) = tab.webview.evaluate_script(&script) {
                    self.ack(id, Err(error.to_string()), cx);
                }
                return;
            }
            BrowserHostCommand::Screenshot { path } => {
                let events = self.events.clone();
                webview::snapshot(&tab.webview, SNAPSHOT_MAX_WIDTH, move |result| {
                    let _ = events.unbounded_send(HostEvent::Snapshot { id, path, result });
                });
                return;
            }
            BrowserHostCommand::Focus => tab.webview.focus().map_err(|error| error.to_string()),
        };
        self.ack(id, result.map(|()| Value::Null), cx);
    }

    fn execute_store(&mut self, entry: BrowserStoreCommandEntry, window: &Window) {
        let id = entry.id;
        let events = self.events.clone();
        let clear = match entry.command {
            BrowserStoreCommand::ClearCookies => webview::StoreData::Cookies,
            BrowserStoreCommand::ClearCache => webview::StoreData::Cache,
            BrowserStoreCommand::SetCookies { cookies } => {
                self.stores
                    .set_cookies(&entry.store, &cookies, window, move |result| {
                        let outcome = result.and_then(|written| {
                            serde_json::to_string(&written)
                                .map(Value::String)
                                .map_err(|error| error.to_string())
                        });
                        let _ = events.unbounded_send(HostEvent::Store(id, outcome));
                    });
                return;
            }
        };
        self.stores
            .clear(&entry.store, clear, window, move |result| {
                let _ = events.unbounded_send(HostEvent::Store(id, result.map(|()| Value::Null)));
            });
    }
}
