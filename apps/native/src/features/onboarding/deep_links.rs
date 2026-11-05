use futures::StreamExt;
use futures::channel::mpsc::{UnboundedReceiver, unbounded};
use gpui::{App, BorrowAppContext, Entity, Global, WeakEntity};
use serde_json::json;

use crate::app_core::client::CoreClient;

pub struct DeepLinks(UnboundedReceiver<Vec<String>>);

#[derive(Default)]
struct DeepLinkTarget {
    client: Option<WeakEntity<CoreClient>>,
    pending: Vec<String>,
}

impl Global for DeepLinkTarget {}

pub fn register(app: &gpui::Application) -> DeepLinks {
    let (sender, receiver) = unbounded();
    if cfg!(target_os = "linux") {
        let urls: Vec<String> = std::env::args()
            .skip(1)
            .filter(|arg| arg.starts_with("local-studio:") || arg.starts_with("t3code:"))
            .collect();
        if !urls.is_empty() {
            let _ = sender.unbounded_send(urls);
        }
    }
    app.on_open_urls(move |urls| {
        let _ = sender.unbounded_send(urls);
    });
    DeepLinks(receiver)
}

pub fn listen(links: DeepLinks, cx: &mut App) {
    cx.set_global(DeepLinkTarget::default());
    let DeepLinks(mut receiver) = links;
    cx.spawn(async move |cx| {
        while let Some(urls) = receiver.next().await {
            cx.update(|cx| {
                for url in urls {
                    deliver(url, cx);
                }
            });
        }
    })
    .detach();
}

pub fn attach(client: &Entity<CoreClient>, cx: &mut App) {
    if !cx.has_global::<DeepLinkTarget>() {
        return;
    }
    let pending = cx.update_global::<DeepLinkTarget, _>(|target, _| {
        target.client = Some(client.downgrade());
        std::mem::take(&mut target.pending)
    });
    for url in pending {
        deliver(url, cx);
    }
}

fn deliver(url: String, cx: &mut App) {
    let client = cx
        .try_global::<DeepLinkTarget>()
        .and_then(|target| target.client.as_ref())
        .and_then(WeakEntity::upgrade);
    match client {
        Some(client) => {
            client.update(cx, |client, _| {
                client.act("openDeepLink", json!({ "url": url }))
            });
            cx.activate(true);
        }
        None => {
            if cx.has_global::<DeepLinkTarget>() {
                cx.update_global::<DeepLinkTarget, _>(|target, _| target.pending.push(url));
            }
        }
    }
}
