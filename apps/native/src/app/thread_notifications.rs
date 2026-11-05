use std::collections::HashSet;

use futures::StreamExt;
use futures::channel::mpsc;
use gpui::{App, AppContext, Context, Entity, Global, Window};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::platform::notifications::{self, COMPLETION_SOUND, INPUT_SOUND, Permission};

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct NotificationRequestView {
    id: u64,
    tag: String,
    title: String,
    body: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ClosedNotificationView {
    id: u64,
    tag: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SoundRequestView {
    id: u64,
    kind: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ThreadNotificationsView {
    notifications: Vec<NotificationRequestView>,
    closed: Vec<ClosedNotificationView>,
    badge: usize,
    sound: Option<SoundRequestView>,
    permission_request: Option<u64>,
}

struct ThreadNotificationsHandle(#[allow(dead_code)] Entity<ThreadNotificationsHost>);

impl Global for ThreadNotificationsHandle {}

pub struct ThreadNotificationsHost {
    client: Entity<CoreClient>,
    view: Entity<ViewState<ThreadNotificationsView>>,
    posted: HashSet<u64>,
    closed: u64,
    badge: usize,
    sound: Option<u64>,
    permission_request: Option<u64>,
}

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

fn report_permission(client: Entity<CoreClient>, permission: Permission, cx: &mut App) {
    act(
        &client,
        cx,
        "threadNotificationsPermission",
        json!({ "permission": permission.as_str() }),
    );
}

impl ThreadNotificationsHost {
    pub fn install(client: &Entity<CoreClient>, window: &mut Window, cx: &mut App) {
        if cx.has_global::<ThreadNotificationsHandle>() {
            return;
        }
        let host = cx.new(|cx| Self::new(client.clone(), window, cx));
        cx.set_global(ThreadNotificationsHandle(host));
    }

    fn new(client: Entity<CoreClient>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<ThreadNotificationsView>(
            &client,
            "threadNotifications",
            json!({}),
            cx,
        );
        cx.observe(&view, |host, _, cx| host.apply(cx)).detach();

        let (clicks, mut clicked) = mpsc::unbounded::<String>();
        notifications::init(Box::new(move |tag| {
            let _ = clicks.unbounded_send(tag);
        }));
        let click_client = client.clone();
        cx.spawn(async move |_, cx| {
            while let Some(tag) = clicked.next().await {
                let client = click_client.clone();
                cx.update(|cx| {
                    cx.activate(true);
                    act(
                        &client,
                        cx,
                        "threadNotificationsOpen",
                        json!({ "tag": tag }),
                    );
                });
            }
        })
        .detach();

        Self::query_permission(&client, false, cx);

        act(
            &client,
            cx,
            "threadNotificationsWindowFocus",
            json!({ "focused": window.is_window_active() }),
        );
        let focus_client = client.clone();
        cx.observe_window_activation(window, move |_, window, cx| {
            act(
                &focus_client,
                cx,
                "threadNotificationsWindowFocus",
                json!({ "focused": window.is_window_active() }),
            );
        })
        .detach();

        Self {
            client,
            view,
            posted: HashSet::new(),
            closed: 0,
            badge: 0,
            sound: None,
            permission_request: None,
        }
    }

    fn query_permission(client: &Entity<CoreClient>, request: bool, cx: &mut Context<Self>) {
        let (sender, receiver) = futures::channel::oneshot::channel::<Permission>();
        let done: notifications::PermissionCallback = Box::new(move |permission| {
            let _ = sender.send(permission);
        });
        if request {
            notifications::request_permission(done);
        } else {
            notifications::authorization(done);
        }
        let client = client.clone();
        cx.spawn(async move |_, cx| {
            let permission = receiver.await.unwrap_or(Permission::Error);
            cx.update(|cx| report_permission(client, permission, cx));
        })
        .detach();
    }

    fn apply(&mut self, cx: &mut Context<Self>) {
        let Some(view) = self.view.read(cx).data.clone() else {
            return;
        };
        let removed: Vec<String> = view
            .closed
            .iter()
            .filter(|closed| closed.id > self.closed)
            .map(|closed| closed.tag.clone())
            .collect();
        if let Some(last) = view.closed.last() {
            self.closed = self.closed.max(last.id);
        }
        if !removed.is_empty() {
            notifications::remove(&removed);
        }
        for request in &view.notifications {
            if self.posted.insert(request.id) {
                notifications::post(&request.tag, &request.title, &request.body);
            }
        }
        let live: HashSet<u64> = view
            .notifications
            .iter()
            .map(|request| request.id)
            .collect();
        self.posted.retain(|id| live.contains(id));
        if view.badge != self.badge {
            self.badge = view.badge;
            notifications::set_badge(view.badge);
        }
        if let Some(sound) = view.sound.as_ref()
            && self.sound != Some(sound.id)
        {
            self.sound = Some(sound.id);
            notifications::play(if sound.kind == "completion" {
                COMPLETION_SOUND
            } else {
                INPUT_SOUND
            });
        }
        if let Some(request) = view.permission_request
            && self.permission_request != Some(request)
        {
            self.permission_request = Some(request);
            let client = self.client.clone();
            Self::query_permission(&client, true, cx);
        }
    }
}
