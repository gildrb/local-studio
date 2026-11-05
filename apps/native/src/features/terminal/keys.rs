use alacritty_terminal::term::TermMode;
use gpui::{Keystroke, Modifiers};

pub fn dom_key(keystroke: &Keystroke) -> String {
    let named = match keystroke.key.as_str() {
        "left" => "ArrowLeft",
        "right" => "ArrowRight",
        "up" => "ArrowUp",
        "down" => "ArrowDown",
        "backspace" => "Backspace",
        "delete" => "Delete",
        "enter" => "Enter",
        "escape" => "Escape",
        "tab" => "Tab",
        "space" => " ",
        "home" => "Home",
        "end" => "End",
        "pageup" => "PageUp",
        "pagedown" => "PageDown",
        "insert" => "Insert",
        key if key.len() > 1 && key.starts_with('f') && key[1..].parse::<u8>().is_ok() => {
            return key.to_uppercase();
        }
        key => return key.to_string(),
    };
    named.to_string()
}

fn modifier_code(keystroke: &Keystroke) -> u8 {
    let m = &keystroke.modifiers;
    1 + u8::from(m.shift) + 2 * u8::from(m.alt) + 4 * u8::from(m.control)
}

fn cursor_key(letter: char, keystroke: &Keystroke, mode: TermMode) -> String {
    let code = modifier_code(keystroke);
    if code > 1 {
        format!("\x1b[1;{code}{letter}")
    } else if mode.contains(TermMode::APP_CURSOR) {
        format!("\x1bO{letter}")
    } else {
        format!("\x1b[{letter}")
    }
}

fn tilde_key(number: u8, keystroke: &Keystroke) -> String {
    let code = modifier_code(keystroke);
    if code > 1 {
        format!("\x1b[{number};{code}~")
    } else {
        format!("\x1b[{number}~")
    }
}

fn control_byte(ch: char) -> Option<char> {
    let byte = match ch.to_ascii_lowercase() {
        c @ 'a'..='z' => c as u8 - b'a' + 1,
        '@' | ' ' | '2' => 0,
        '[' | '3' => 27,
        '\\' | '4' => 28,
        ']' | '5' => 29,
        '^' | '6' => 30,
        '_' | '-' | '7' => 31,
        '?' | '8' => 127,
        _ => return None,
    };
    Some(byte as char)
}

pub fn encode(keystroke: &Keystroke, mode: TermMode) -> Option<String> {
    let m = &keystroke.modifiers;
    if m.platform {
        return None;
    }
    let alt_prefix = |text: &str| {
        if m.alt {
            format!("\x1b{text}")
        } else {
            text.to_string()
        }
    };
    let encoded = match keystroke.key.as_str() {
        "enter" => alt_prefix("\r"),
        "backspace" if m.control => "\x08".to_string(),
        "backspace" => alt_prefix("\x7f"),
        "tab" if m.shift => "\x1b[Z".to_string(),
        "tab" => "\t".to_string(),
        "escape" => "\x1b".to_string(),
        "space" if m.control => "\0".to_string(),
        "up" => cursor_key('A', keystroke, mode),
        "down" => cursor_key('B', keystroke, mode),
        "right" => cursor_key('C', keystroke, mode),
        "left" => cursor_key('D', keystroke, mode),
        "home" => cursor_key('H', keystroke, mode),
        "end" => cursor_key('F', keystroke, mode),
        "insert" => tilde_key(2, keystroke),
        "delete" => tilde_key(3, keystroke),
        "pageup" => tilde_key(5, keystroke),
        "pagedown" => tilde_key(6, keystroke),
        "f1" => "\x1bOP".to_string(),
        "f2" => "\x1bOQ".to_string(),
        "f3" => "\x1bOR".to_string(),
        "f4" => "\x1bOS".to_string(),
        "f5" => tilde_key(15, keystroke),
        "f6" => tilde_key(17, keystroke),
        "f7" => tilde_key(18, keystroke),
        "f8" => tilde_key(19, keystroke),
        "f9" => tilde_key(20, keystroke),
        "f10" => tilde_key(21, keystroke),
        "f11" => tilde_key(23, keystroke),
        "f12" => tilde_key(24, keystroke),
        key if m.control => {
            let mut chars = key.chars();
            let ch = chars.next()?;
            if chars.next().is_some() {
                return None;
            }
            alt_prefix(&control_byte(ch)?.to_string())
        }
        "space" => " ".to_string(),
        _ => keystroke.key_char.clone()?,
    };
    Some(encoded)
}

pub fn paste(text: &str, mode: TermMode) -> String {
    let normalized = text.replace("\r\n", "\r").replace('\n', "\r");
    if mode.contains(TermMode::BRACKETED_PASTE) {
        format!("\x1b[200~{}\x1b[201~", normalized.replace('\x1b', ""))
    } else {
        normalized
    }
}

pub fn wheel_arrows(rows: i32, mode: TermMode) -> String {
    let letter = if rows > 0 { 'A' } else { 'B' };
    let sequence = if mode.contains(TermMode::APP_CURSOR) {
        format!("\x1bO{letter}")
    } else {
        format!("\x1b[{letter}")
    };
    sequence.repeat(rows.unsigned_abs() as usize)
}

pub fn mouse_report(
    button: u8,
    modifiers: Modifiers,
    cell: (usize, usize),
    pressed: bool,
    mode: TermMode,
) -> String {
    let (col, row) = cell;
    let mods = 4 * u8::from(modifiers.shift)
        + 8 * u8::from(modifiers.alt)
        + 16 * u8::from(modifiers.control);
    if mode.contains(TermMode::SGR_MOUSE) {
        let suffix = if pressed { 'M' } else { 'm' };
        format!("\x1b[<{};{};{}{suffix}", button + mods, col + 1, row + 1)
    } else {
        let code = if pressed { button } else { 3 } + mods;
        let clamp = |value: usize| char::from((32 + 1 + value.min(222)) as u8);
        format!(
            "\x1b[M{}{}{}",
            char::from(32 + code),
            clamp(col),
            clamp(row)
        )
    }
}
