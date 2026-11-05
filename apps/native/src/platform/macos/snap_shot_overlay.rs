use gpui::{Bounds, Pixels, Point, Window, point, px};
use objc2::runtime::{AnyObject, Bool};
use objc2::{class, msg_send};
use objc2_foundation::{NSPoint, NSRect, NSSize};
use wry::raw_window_handle::{HasWindowHandle, RawWindowHandle};

const STYLE_BORDERLESS_NONACTIVATING: usize = 1 << 7;
const POP_UP_MENU_WINDOW_LEVEL: isize = 101;
const EVENT_SOURCE_HID_SYSTEM_STATE: i32 = 1;
const DEVICE_MODIFIER_CODES: [(u64, &str); 8] = [
    (0x1, "ControlLeft"),
    (0x2000, "ControlRight"),
    (0x2, "ShiftLeft"),
    (0x4, "ShiftRight"),
    (0x8, "MetaLeft"),
    (0x10, "MetaRight"),
    (0x20, "AltLeft"),
    (0x40, "AltRight"),
];

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventSourceFlagsState(state: i32) -> u64;
}

fn ns_window(window: &Window) -> Option<&AnyObject> {
    let handle = HasWindowHandle::window_handle(window).ok()?;
    let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
        return None;
    };
    let view = handle.ns_view.as_ptr().cast::<AnyObject>();
    let ns_window: *mut AnyObject = unsafe { msg_send![view, window] };
    unsafe { ns_window.as_ref() }
}

fn primary_screen_height() -> Option<f64> {
    let screens: *mut AnyObject = unsafe { msg_send![class!(NSScreen), screens] };
    let screens = unsafe { screens.as_ref() }?;
    let count: usize = unsafe { msg_send![screens, count] };
    if count == 0 {
        return None;
    }
    let primary: *mut AnyObject = unsafe { msg_send![screens, objectAtIndex: 0usize] };
    let primary = unsafe { primary.as_ref() }?;
    let frame: NSRect = unsafe { msg_send![primary, frame] };
    Some(frame.size.height)
}

pub fn configure_overlay(window: &Window, frame: Bounds<Pixels>) -> bool {
    let (Some(ns_window), Some(primary_height)) = (ns_window(window), primary_screen_height())
    else {
        return false;
    };
    let width = f64::from(f32::from(frame.size.width));
    let height = f64::from(f32::from(frame.size.height));
    let rect = NSRect::new(
        NSPoint::new(
            f64::from(f32::from(frame.origin.x)),
            primary_height - f64::from(f32::from(frame.origin.y)) - height,
        ),
        NSSize::new(width, height),
    );
    let clear: *mut AnyObject = unsafe { msg_send![class!(NSColor), clearColor] };
    unsafe {
        let _: () = msg_send![ns_window, setStyleMask: STYLE_BORDERLESS_NONACTIVATING];
        let _: () = msg_send![ns_window, setOpaque: Bool::NO];
        let _: () = msg_send![ns_window, setBackgroundColor: clear];
        let _: () = msg_send![ns_window, setHasShadow: Bool::NO];
        let _: () = msg_send![ns_window, setIgnoresMouseEvents: Bool::YES];
        let _: () = msg_send![ns_window, setHidesOnDeactivate: Bool::NO];
        let _: () = msg_send![ns_window, setLevel: POP_UP_MENU_WINDOW_LEVEL];
        let _: () = msg_send![ns_window, setFrame: rect, display: Bool::YES];
        let _: () = msg_send![ns_window, orderFrontRegardless];
    }
    true
}

pub fn content_origin(window: &Window) -> Option<Point<Pixels>> {
    let ns_window = ns_window(window)?;
    let primary_height = primary_screen_height()?;
    let frame: NSRect = unsafe { msg_send![ns_window, frame] };
    let content: NSRect = unsafe { msg_send![ns_window, contentRectForFrameRect: frame] };
    Some(point(
        px(content.origin.x as f32),
        px((primary_height - content.origin.y - content.size.height) as f32),
    ))
}

pub fn held_modifier_codes() -> Vec<&'static str> {
    let flags = unsafe { CGEventSourceFlagsState(EVENT_SOURCE_HID_SYSTEM_STATE) };
    DEVICE_MODIFIER_CODES
        .iter()
        .filter(|(mask, _)| flags & mask != 0)
        .map(|(_, code)| *code)
        .collect()
}
