use futures::StreamExt;
use futures::channel::mpsc;
use gpui::{AnyWindowHandle, App, AppContext, Context, Entity, Global, Window};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::snap_shot::SnapShotHostView;
use crate::features::snap_shot_overlay::{OverlayEvent, SnapShotOverlays};
use crate::platform::snap_shot::{HotKey, register_hot_key};

struct SnapShotHostHandle(Entity<SnapShotHost>);

impl Global for SnapShotHostHandle {}

pub struct SnapShotHost {
    client: Entity<CoreClient>,
    view: Entity<ViewState<SnapShotHostView>>,
    window: AnyWindowHandle,
    hotkey: Option<(String, HotKey)>,
    hotkey_presses: mpsc::UnboundedSender<String>,
    activate_seq: Option<u64>,
    overlays: SnapShotOverlays,
}

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

impl SnapShotHost {
    pub fn install(client: &Entity<CoreClient>, window: &mut Window, cx: &mut App) {
        if let Some(SnapShotHostHandle(_host)) = cx.try_global::<SnapShotHostHandle>() {
            return;
        }
        let host = cx.new(|cx| Self::new(client.clone(), window, cx));
        cx.set_global(SnapShotHostHandle(host));
    }

    fn new(client: Entity<CoreClient>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let view =
            CoreClient::subscribe::<SnapShotHostView>(&client, "snapShotHost", json!({}), cx);
        cx.observe(&view, |host, _, cx| host.apply(cx)).detach();

        let (hotkey_presses, mut pressed) = mpsc::unbounded::<String>();
        let press_client = client.clone();
        cx.spawn(async move |_, cx| {
            while let Some(accelerator) = pressed.next().await {
                let client = press_client.clone();
                cx.update(|cx| {
                    act(
                        &client,
                        cx,
                        "snapShotHotkeyPressed",
                        json!({ "accelerator": accelerator }),
                    )
                });
            }
        })
        .detach();

        let focus_client = client.clone();
        cx.observe_window_activation(window, move |_, window, cx| {
            act(
                &focus_client,
                cx,
                "snapShotWindowFocus",
                json!({ "focused": window.is_window_active() }),
            );
        })
        .detach();

        Self {
            client,
            view,
            window: window.window_handle(),
            hotkey: None,
            hotkey_presses,
            activate_seq: None,
            overlays: SnapShotOverlays::default(),
        }
    }

    fn apply(&mut self, cx: &mut Context<Self>) {
        let Some(view) = self.view.read(cx).data.clone() else {
            return;
        };
        let registered = self
            .hotkey
            .as_ref()
            .map(|(accelerator, _)| accelerator.as_str());
        if registered != view.hotkey.as_deref() {
            self.hotkey = None;
            if let Some(accelerator) = view.hotkey {
                let sender = self.hotkey_presses.clone();
                let pressed = accelerator.clone();
                self.hotkey = register_hot_key(
                    &accelerator,
                    Box::new(move || {
                        let _ = sender.unbounded_send(pressed.clone());
                    }),
                )
                .map(|hotkey| (accelerator, hotkey));
            }
        }
        self.overlays.sync_flash(view.flash.as_ref(), cx);
        if let Some(OverlayEvent::FlightStarted { id, duration }) =
            self.overlays.sync_transition(view.transition.as_ref(), cx)
        {
            let client = self.client.clone();
            cx.spawn(async move |_, cx| {
                cx.background_executor().timer(duration).await;
                cx.update(|cx| act(&client, cx, "snapShotTransitionLanded", json!({ "id": id })));
            })
            .detach();
        }
        let previous = self.activate_seq.replace(view.activate_seq);
        if previous.is_some_and(|seq| seq != view.activate_seq) {
            cx.activate(true);
            let _ = self
                .window
                .update(cx, |_, window, _| window.activate_window());
        }
    }
}
