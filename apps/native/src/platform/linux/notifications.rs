use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, LazyLock, Mutex, OnceLock};

use notify_rust::Notification;

use crate::platform::notifications::{ClickHandler, Permission, PermissionCallback};

const APP_NAME: &str = "Local Studio";
const DEFAULT_ACTION: &str = "default";

static ON_CLICK: OnceLock<Arc<ClickHandler>> = OnceLock::new();
static IDS: LazyLock<Mutex<HashMap<String, u32>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn init(on_click: ClickHandler) {
    let _ = ON_CLICK.set(Arc::new(on_click));
}

fn server_available() -> Permission {
    if notify_rust::get_server_information().is_ok() {
        Permission::Granted
    } else {
        Permission::Error
    }
}

pub fn authorization(done: PermissionCallback) {
    std::thread::spawn(move || done(server_available()));
}

pub fn request_permission(done: PermissionCallback) {
    std::thread::spawn(move || done(server_available()));
}

pub fn post(tag: &str, title: &str, body: &str) {
    let tag = tag.to_string();
    let title = title.to_string();
    let body = body.to_string();
    std::thread::spawn(move || {
        let previous = IDS.lock().ok().and_then(|ids| ids.get(&tag).copied());
        let mut notification = Notification::new();
        notification
            .appname(APP_NAME)
            .summary(&title)
            .body(&body)
            .action(DEFAULT_ACTION, "Open thread");
        if let Some(id) = previous {
            notification.id(id);
        }
        let Ok(handle) = notification.show() else {
            return;
        };
        if let Ok(mut ids) = IDS.lock() {
            ids.insert(tag.clone(), handle.id());
        }
        let on_click = ON_CLICK.get().cloned();
        handle.wait_for_action(move |action| {
            if action == DEFAULT_ACTION
                && let Some(on_click) = on_click
            {
                on_click(tag);
            }
        });
    });
}

pub fn remove(tags: &[String]) {
    let removed: Vec<u32> = match IDS.lock() {
        Ok(mut ids) => tags.iter().filter_map(|tag| ids.remove(tag)).collect(),
        Err(_) => return,
    };
    if removed.is_empty() {
        return;
    }
    std::thread::spawn(move || {
        for id in removed {
            if let Ok(handle) = Notification::new().appname(APP_NAME).id(id).show() {
                handle.close();
            }
        }
    });
}

pub fn set_badge(_count: usize) {}

fn sound_path(bytes: &'static [u8]) -> Option<PathBuf> {
    let name = format!("local-studio-notification-{}.wav", bytes.len());
    let path = std::env::temp_dir().join(name);
    if !path.exists() {
        std::fs::write(&path, bytes).ok()?;
    }
    Some(path)
}

pub fn play(bytes: &'static [u8]) {
    std::thread::spawn(move || {
        let Some(path) = sound_path(bytes) else {
            return;
        };
        for player in ["pw-play", "paplay", "aplay"] {
            let status = Command::new(player)
                .arg(&path)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            if status.is_ok_and(|status| status.success()) {
                return;
            }
        }
    });
}
