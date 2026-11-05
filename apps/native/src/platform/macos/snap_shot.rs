use std::cell::RefCell;
use std::ffi::c_void;
use std::ptr;

type OsStatus = i32;
type EventTargetRef = *mut c_void;
type EventHandlerCallRef = *mut c_void;
type EventRef = *mut c_void;
type EventHandlerRef = *mut c_void;
type EventHotKeyRef = *mut c_void;
type EventHandlerProc = extern "C" fn(EventHandlerCallRef, EventRef, *mut c_void) -> OsStatus;

#[repr(C)]
struct EventTypeSpec {
    event_class: u32,
    event_kind: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct EventHotKeyId {
    signature: u32,
    id: u32,
}

#[link(name = "Carbon", kind = "framework")]
unsafe extern "C" {
    fn GetApplicationEventTarget() -> EventTargetRef;
    fn InstallEventHandler(
        target: EventTargetRef,
        handler: EventHandlerProc,
        type_count: u32,
        types: *const EventTypeSpec,
        user_data: *mut c_void,
        handler_ref: *mut EventHandlerRef,
    ) -> OsStatus;
    fn RegisterEventHotKey(
        key_code: u32,
        modifiers: u32,
        id: EventHotKeyId,
        target: EventTargetRef,
        options: u32,
        hot_key: *mut EventHotKeyRef,
    ) -> OsStatus;
    fn UnregisterEventHotKey(hot_key: EventHotKeyRef) -> OsStatus;
    fn GetEventParameter(
        event: EventRef,
        name: u32,
        desired_type: u32,
        actual_type: *mut u32,
        buffer_size: usize,
        actual_size: *mut usize,
        data: *mut c_void,
    ) -> OsStatus;
}

const EVENT_CLASS_KEYBOARD: u32 = u32::from_be_bytes(*b"keyb");
const EVENT_HOT_KEY_PRESSED: u32 = 5;
const EVENT_PARAM_DIRECT_OBJECT: u32 = u32::from_be_bytes(*b"----");
const TYPE_EVENT_HOT_KEY_ID: u32 = u32::from_be_bytes(*b"hkid");
const HOT_KEY_SIGNATURE: u32 = u32::from_be_bytes(*b"T3SS");
const CMD_KEY: u32 = 1 << 8;
const SHIFT_KEY: u32 = 1 << 9;
const OPTION_KEY: u32 = 1 << 11;
const CONTROL_KEY: u32 = 1 << 12;

type Triggers = Vec<(u32, Box<dyn Fn()>)>;

thread_local! {
    static HANDLER_INSTALLED: RefCell<bool> = const { RefCell::new(false) };
    static TRIGGERS: RefCell<Triggers> = const { RefCell::new(Vec::new()) };
    static NEXT_ID: RefCell<u32> = const { RefCell::new(1) };
}

extern "C" fn on_hot_key(_: EventHandlerCallRef, event: EventRef, _: *mut c_void) -> OsStatus {
    let mut id = EventHotKeyId {
        signature: 0,
        id: 0,
    };
    let status = unsafe {
        GetEventParameter(
            event,
            EVENT_PARAM_DIRECT_OBJECT,
            TYPE_EVENT_HOT_KEY_ID,
            ptr::null_mut(),
            std::mem::size_of::<EventHotKeyId>(),
            ptr::null_mut(),
            (&mut id as *mut EventHotKeyId).cast(),
        )
    };
    if status != 0 || id.signature != HOT_KEY_SIGNATURE {
        return status;
    }
    TRIGGERS.with(|triggers| {
        if let Some((_, trigger)) = triggers.borrow().iter().find(|(key, _)| *key == id.id) {
            trigger();
        }
    });
    0
}

fn key_code(key: &str) -> Option<u32> {
    let code = match key {
        "A" => 0x00,
        "S" => 0x01,
        "D" => 0x02,
        "F" => 0x03,
        "H" => 0x04,
        "G" => 0x05,
        "Z" => 0x06,
        "X" => 0x07,
        "C" => 0x08,
        "V" => 0x09,
        "B" => 0x0B,
        "Q" => 0x0C,
        "W" => 0x0D,
        "E" => 0x0E,
        "R" => 0x0F,
        "Y" => 0x10,
        "T" => 0x11,
        "1" | "!" => 0x12,
        "2" | "@" => 0x13,
        "3" | "#" => 0x14,
        "4" | "$" => 0x15,
        "6" | "^" => 0x16,
        "5" | "%" => 0x17,
        "=" | "Plus" => 0x18,
        "9" | "(" => 0x19,
        "7" | "&" => 0x1A,
        "-" | "_" => 0x1B,
        "8" | "*" => 0x1C,
        "0" | ")" => 0x1D,
        "]" | "}" => 0x1E,
        "O" => 0x1F,
        "U" => 0x20,
        "[" | "{" => 0x21,
        "I" => 0x22,
        "P" => 0x23,
        "ENTER" | "RETURN" => 0x24,
        "L" => 0x25,
        "J" => 0x26,
        "'" | "\"" => 0x27,
        "K" => 0x28,
        ";" | ":" => 0x29,
        "\\" | "|" => 0x2A,
        "," | "<" => 0x2B,
        "/" | "?" => 0x2C,
        "N" => 0x2D,
        "M" => 0x2E,
        "." | ">" => 0x2F,
        "TAB" => 0x30,
        "Space" => 0x31,
        "`" | "~" => 0x32,
        "BACKSPACE" => 0x33,
        "Esc" => 0x35,
        "F17" => 0x40,
        "F18" => 0x4F,
        "F19" => 0x50,
        "F20" => 0x5A,
        "F5" => 0x60,
        "F6" => 0x61,
        "F7" => 0x62,
        "F3" => 0x63,
        "F8" => 0x64,
        "F9" => 0x65,
        "F11" => 0x67,
        "F13" => 0x69,
        "F16" => 0x6A,
        "F14" => 0x6B,
        "F10" => 0x6D,
        "F12" => 0x6F,
        "F15" => 0x71,
        "HOME" => 0x73,
        "PAGEUP" => 0x74,
        "DELETE" => 0x75,
        "F4" => 0x76,
        "END" => 0x77,
        "F2" => 0x78,
        "PAGEDOWN" => 0x79,
        "F1" => 0x7A,
        "Left" => 0x7B,
        "Right" => 0x7C,
        "Down" => 0x7D,
        "Up" => 0x7E,
        _ => return None,
    };
    Some(code)
}

/// Parses an Electron accelerator into a Carbon key code and modifier mask.
fn parse_accelerator(accelerator: &str) -> Option<(u32, u32)> {
    let mut parts: Vec<&str> = accelerator.split('+').collect();
    let key = if accelerator.ends_with("++") {
        parts.truncate(parts.len().saturating_sub(2));
        "Plus"
    } else {
        parts.pop()?
    };
    let mut modifiers = 0;
    for part in parts {
        modifiers |= match part {
            "CommandOrControl" | "CmdOrCtrl" | "Command" | "Cmd" | "Super" | "Meta" => CMD_KEY,
            "Control" | "Ctrl" => CONTROL_KEY,
            "Alt" | "Option" => OPTION_KEY,
            "Shift" => SHIFT_KEY,
            _ => return None,
        };
    }
    Some((key_code(key)?, modifiers))
}

/// A system-wide hot key that stays registered until dropped.
pub struct HotKey {
    id: u32,
    handle: EventHotKeyRef,
}

impl Drop for HotKey {
    fn drop(&mut self) {
        unsafe {
            UnregisterEventHotKey(self.handle);
        }
        TRIGGERS.with(|triggers| triggers.borrow_mut().retain(|(id, _)| *id != self.id));
    }
}

/// Registers `accelerator` with the window server, the way Electron's `globalShortcut` does.
/// Must run on the main thread; `trigger` runs there too.
pub fn register_hot_key(accelerator: &str, trigger: Box<dyn Fn()>) -> Option<HotKey> {
    let (code, modifiers) = parse_accelerator(accelerator)?;
    let installed = HANDLER_INSTALLED.with(|installed| {
        if *installed.borrow() {
            return true;
        }
        let spec = EventTypeSpec {
            event_class: EVENT_CLASS_KEYBOARD,
            event_kind: EVENT_HOT_KEY_PRESSED,
        };
        let status = unsafe {
            InstallEventHandler(
                GetApplicationEventTarget(),
                on_hot_key,
                1,
                &spec,
                ptr::null_mut(),
                ptr::null_mut(),
            )
        };
        *installed.borrow_mut() = status == 0;
        status == 0
    });
    if !installed {
        return None;
    }
    let id = NEXT_ID.with(|next| {
        let mut next = next.borrow_mut();
        let id = *next;
        *next += 1;
        id
    });
    let mut handle: EventHotKeyRef = ptr::null_mut();
    let status = unsafe {
        RegisterEventHotKey(
            code,
            modifiers,
            EventHotKeyId {
                signature: HOT_KEY_SIGNATURE,
                id,
            },
            GetApplicationEventTarget(),
            0,
            &mut handle,
        )
    };
    if status != 0 || handle.is_null() {
        return None;
    }
    TRIGGERS.with(|triggers| triggers.borrow_mut().push((id, trigger)));
    Some(HotKey { id, handle })
}
