#[cfg(target_os = "macos")]
pub use super::macos::snap_shot::{HotKey, register_hot_key};
#[cfg(target_os = "macos")]
pub use super::macos::snap_shot_overlay::{configure_overlay, content_origin, held_modifier_codes};

pub const OVERLAYS: bool = cfg!(target_os = "macos");

#[cfg(not(target_os = "macos"))]
pub struct HotKey;

#[cfg(not(target_os = "macos"))]
pub fn register_hot_key(_accelerator: &str, _trigger: Box<dyn Fn()>) -> Option<HotKey> {
    None
}

#[cfg(not(target_os = "macos"))]
pub fn configure_overlay(_window: &gpui::Window, _frame: gpui::Bounds<gpui::Pixels>) -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn content_origin(window: &gpui::Window) -> Option<gpui::Point<gpui::Pixels>> {
    Some(window.bounds().origin)
}

#[cfg(not(target_os = "macos"))]
pub fn held_modifier_codes() -> Vec<&'static str> {
    Vec::new()
}
