use gpui::{Keystroke, Modifiers};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DomKey {
    pub code: String,
    pub key: String,
    pub meta_key: bool,
    pub ctrl_key: bool,
}

fn named(key: &str) -> Option<(&'static str, &'static str)> {
    Some(match key {
        "enter" => ("Enter", "Enter"),
        "escape" => ("Escape", "Escape"),
        "backspace" => ("Backspace", "Backspace"),
        "tab" => ("Tab", "Tab"),
        "space" => ("Space", " "),
        "delete" => ("Delete", "Delete"),
        "insert" => ("Insert", "Insert"),
        "up" => ("ArrowUp", "ArrowUp"),
        "down" => ("ArrowDown", "ArrowDown"),
        "left" => ("ArrowLeft", "ArrowLeft"),
        "right" => ("ArrowRight", "ArrowRight"),
        "home" => ("Home", "Home"),
        "end" => ("End", "End"),
        "pageup" => ("PageUp", "PageUp"),
        "pagedown" => ("PageDown", "PageDown"),
        _ => return None,
    })
}

fn punctuation_code(ch: char) -> Option<&'static str> {
    Some(match ch {
        '-' | '_' => "Minus",
        '=' | '+' => "Equal",
        '[' | '{' => "BracketLeft",
        ']' | '}' => "BracketRight",
        '\\' | '|' => "Backslash",
        ';' | ':' => "Semicolon",
        '\'' | '"' => "Quote",
        '`' | '~' => "Backquote",
        ',' | '<' => "Comma",
        '.' | '>' => "Period",
        '/' | '?' => "Slash",
        '!' => "Digit1",
        '@' => "Digit2",
        '#' => "Digit3",
        '$' => "Digit4",
        '%' => "Digit5",
        '^' => "Digit6",
        '&' => "Digit7",
        '*' => "Digit8",
        '(' => "Digit9",
        ')' => "Digit0",
        _ => return None,
    })
}

fn char_code(ch: char) -> Option<String> {
    if ch.is_ascii_alphabetic() {
        Some(format!("Key{}", ch.to_ascii_uppercase()))
    } else if ch.is_ascii_digit() {
        Some(format!("Digit{ch}"))
    } else {
        punctuation_code(ch).map(str::to_string)
    }
}

pub fn dom_key(keystroke: &Keystroke) -> DomKey {
    let modifiers = &keystroke.modifiers;
    let (code, key) = if let Some((code, key)) = named(keystroke.key.as_str()) {
        (code.to_string(), key.to_string())
    } else if let Some(function) = keystroke
        .key
        .strip_prefix('f')
        .filter(|number| !number.is_empty() && number.parse::<u8>().is_ok())
    {
        let name = format!("F{function}");
        (name.clone(), name)
    } else {
        let mut chars = keystroke.key.chars();
        let single = chars.next().filter(|_| chars.next().is_none());
        let code = single.and_then(char_code).unwrap_or_default();
        let key = match keystroke.key_char.as_deref() {
            Some(text) if !text.is_empty() && !modifiers.control && !modifiers.platform => {
                text.to_string()
            }
            _ => match single {
                Some(ch) if modifiers.shift => ch.to_uppercase().collect(),
                _ => keystroke.key.clone(),
            },
        };
        (code, key)
    };
    DomKey {
        code,
        key,
        meta_key: modifiers.platform,
        ctrl_key: modifiers.control,
    }
}

pub fn modifier_keys(previous: Modifiers, next: Modifiers) -> Vec<(bool, DomKey)> {
    let changes = [
        (previous.shift, next.shift, "ShiftLeft", "Shift"),
        (previous.control, next.control, "ControlLeft", "Control"),
        (previous.alt, next.alt, "AltLeft", "Alt"),
        (previous.platform, next.platform, "MetaLeft", "Meta"),
    ];
    changes
        .into_iter()
        .filter(|(before, after, _, _)| before != after)
        .map(|(_, down, code, key)| {
            (
                down,
                DomKey {
                    code: code.to_string(),
                    key: key.to_string(),
                    meta_key: next.platform,
                    ctrl_key: next.control,
                },
            )
        })
        .collect()
}
