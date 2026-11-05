#[cfg(target_os = "linux")]
use super::linux::notifications as imp;
#[cfg(target_os = "macos")]
use super::macos::notifications as imp;

pub type ClickHandler = Box<dyn Fn(String) + Send + Sync>;
pub type PermissionCallback = Box<dyn FnOnce(Permission) + Send>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Permission {
    Granted,
    Denied,
    Default,
    Error,
}

impl Permission {
    pub fn as_str(self) -> &'static str {
        match self {
            Permission::Granted => "granted",
            Permission::Denied => "denied",
            Permission::Default => "default",
            Permission::Error => "error",
        }
    }
}

pub const COMPLETION_SOUND: &[u8] =
    include_bytes!("../../assets/sounds/notification-completion.wav");
pub const INPUT_SOUND: &[u8] = include_bytes!("../../assets/sounds/notification-input.wav");

pub fn init(on_click: ClickHandler) {
    imp::init(on_click);
}

pub fn authorization(done: PermissionCallback) {
    imp::authorization(done);
}

pub fn request_permission(done: PermissionCallback) {
    imp::request_permission(done);
}

pub fn post(tag: &str, title: &str, body: &str) {
    imp::post(tag, title, body);
}

pub fn remove(tags: &[String]) {
    imp::remove(tags);
}

pub fn set_badge(count: usize) {
    imp::set_badge(count);
}

pub fn play(sound: &'static [u8]) {
    imp::play(sound);
}
