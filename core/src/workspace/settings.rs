use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::Serialize;

use super::model::{Keybinding, Settings};

const DEFAULT_KEYBINDINGS: &[(&str, &str, Option<&str>)] = &[
    ("sidebar.toggle", "cmd+b", None),
    ("navigation.back", "cmd+[", Some("!terminalFocus")),
    ("navigation.forward", "cmd+]", Some("!terminalFocus")),
    ("terminal.toggle", "cmd+j", None),
    ("rightPanel.toggle", "cmd+option+b", None),
    ("terminal.split", "cmd+d", Some("terminalFocus")),
    ("terminal.splitVertical", "cmd+shift+d", Some("terminalFocus")),
    ("terminal.new", "cmd+n", Some("terminalFocus")),
    ("terminal.close", "cmd+w", Some("terminalFocus")),
    ("rightPanel.close", "cmd+w", Some("!terminalFocus")),
    ("diff.toggle", "cmd+d", Some("!terminalFocus")),
    ("preview.toggle", "cmd+shift+j", None),
    ("preview.refresh", "cmd+r", Some("previewFocus")),
    ("preview.focusUrl", "cmd+l", Some("previewFocus")),
    ("preview.zoomIn", "cmd+=", Some("previewFocus")),
    ("preview.zoomOut", "cmd+-", Some("previewFocus")),
    ("preview.resetZoom", "cmd+0", Some("previewFocus")),
    ("commandPalette.toggle", "cmd+k", Some("!terminalFocus")),
    ("filePicker.toggle", "cmd+p", Some("!terminalFocus")),
    ("projectSearch.toggle", "cmd+shift+f", Some("!terminalFocus")),
    ("usage.open", "cmd+u", Some("!terminalFocus")),
    ("theme.select", "cmd+option+a", Some("!terminalFocus")),
    ("appearance.cycle", "cmd+option+shift+a", Some("!terminalFocus")),
    ("themeEditor.toggle", "cmd+option+shift+t", None),
    ("composer.stash", "cmd+s", Some("!terminalFocus")),
    ("thread.steerQueuedMessage", "cmd+shift+return", Some("!terminalFocus")),
    ("chat.new", "cmd+n", Some("!terminalFocus")),
    ("chat.newLocal", "cmd+shift+n", Some("!terminalFocus")),
    ("chat.newWithoutProject", "cmd+option+n", Some("!terminalFocus")),
    ("modelPicker.toggle", "cmd+shift+m", Some("!terminalFocus")),
    ("composer.host", "cmd+shift+h", Some("!terminalFocus")),
    ("composer.effort", "cmd+shift+e", Some("!terminalFocus")),
    ("composer.mode", "cmd+shift+a", Some("!terminalFocus")),
    ("composer.workspace", "cmd+shift+x", Some("!terminalFocus")),
    ("composer.branch", "cmd+shift+g", Some("!terminalFocus")),
    ("composer.previousWorktree", "cmd+shift+l", Some("!terminalFocus")),
    ("pullRequest.copyNumber", "cmd+shift+k", Some("!terminalFocus")),
    ("modelPicker.previousProvider", "cmd+shift+up", Some("modelPickerOpen")),
    ("modelPicker.nextProvider", "cmd+shift+down", Some("modelPickerOpen")),
    ("editor.openFavorite", "cmd+o", None),
    ("thread.previous", "cmd+shift+[", None),
    ("thread.next", "cmd+shift+]", None),
    ("thread.copyReference", "cmd+shift+c", Some("!terminalFocus")),
    ("thread.settle", "cmd+shift+s", Some("!terminalFocus")),
    ("thread.pin", "cmd+shift+p", Some("!terminalFocus")),
    ("thread.undo", "cmd+z", Some("!terminalFocus && !editableFocus")),
    ("thread.jump.1", "cmd+1", Some("isDesktop")),
    ("thread.jump.2", "cmd+2", Some("isDesktop")),
    ("thread.jump.3", "cmd+3", Some("isDesktop")),
    ("thread.jump.4", "cmd+4", Some("isDesktop")),
    ("thread.jump.5", "cmd+5", Some("isDesktop")),
    ("thread.jump.6", "cmd+6", Some("isDesktop")),
    ("thread.jump.7", "cmd+7", Some("isDesktop")),
    ("thread.jump.8", "cmd+8", Some("isDesktop")),
    ("thread.jump.9", "cmd+9", Some("isDesktop")),
    ("modelPicker.jump.1", "cmd+1", Some("modelPickerOpen && isDesktop")),
    ("modelPicker.jump.2", "cmd+2", Some("modelPickerOpen && isDesktop")),
    ("modelPicker.jump.3", "cmd+3", Some("modelPickerOpen && isDesktop")),
    ("modelPicker.jump.4", "cmd+4", Some("modelPickerOpen && isDesktop")),
    ("modelPicker.jump.5", "cmd+5", Some("modelPickerOpen && isDesktop")),
    ("modelPicker.jump.6", "cmd+6", Some("modelPickerOpen && isDesktop")),
    ("modelPicker.jump.7", "cmd+7", Some("modelPickerOpen && isDesktop")),
    ("modelPicker.jump.8", "cmd+8", Some("modelPickerOpen && isDesktop")),
    ("modelPicker.jump.9", "cmd+9", Some("modelPickerOpen && isDesktop")),
    ("usage.cost", "c", Some("usagePageOpen")),
    ("usage.tokens", "t", Some("usagePageOpen")),
    ("usage.limits", "l", Some("usagePageOpen")),
    ("usage.period.day", "cmd+shift+1", Some("usagePageOpen")),
    ("usage.period.week", "cmd+shift+2", Some("usagePageOpen")),
    ("usage.period.month", "cmd+shift+3", Some("usagePageOpen")),
    ("usage.period.quarter", "cmd+shift+4", Some("usagePageOpen")),
    ("snapshot.capture", "cmd+option+shift+s", None),
];

fn title_case_segment(segment: &str) -> String {
    let mut spaced = String::new();
    let mut previous: Option<char> = None;
    for character in segment.chars() {
        if character.is_uppercase()
            && previous.is_some_and(|previous| previous.is_lowercase() || previous.is_ascii_digit())
        {
            spaced.push(' ');
        }
        spaced.push(character);
        previous = Some(character);
    }
    spaced
        .split(['-', '_', ' '])
        .filter(|word| !word.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            chars.next().map(|first| first.to_uppercase().collect::<String>() + chars.as_str()).unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn command_title(command: &str) -> String {
    match command {
        "thread.copyReference" => return "Pull Request: Copy Link or Thread ID".to_string(),
        "usage.cost" => return "Usage: Cost".to_string(),
        "usage.tokens" => return "Usage: Tokens".to_string(),
        "usage.limits" => return "Usage: Limits".to_string(),
        "usage.period.day" => return "Usage: Period: Past 24h".to_string(),
        "usage.period.week" => return "Usage: Period: 7 days".to_string(),
        "usage.period.month" => return "Usage: Period: 30 days".to_string(),
        "usage.period.quarter" => return "Usage: Period: 90 days".to_string(),
        "snapshot.capture" => return "SnapShot: Capture".to_string(),
        _ => {}
    }
    command.split('.').map(title_case_segment).collect::<Vec<_>>().join(": ")
}

pub(crate) fn is_known_command(command: &str) -> bool {
    DEFAULT_KEYBINDINGS.iter().any(|(known, _, _)| *known == command)
}

pub(crate) fn keybindings(overrides: &BTreeMap<String, Option<String>>) -> Vec<Keybinding> {
    DEFAULT_KEYBINDINGS
        .iter()
        .map(|(command, shortcut, when)| Keybinding {
            command: (*command).to_string(),
            title: command_title(command),
            shortcut: overrides.get(*command).cloned().unwrap_or_else(|| Some((*shortcut).to_string())),
            default_shortcut: Some((*shortcut).to_string()),
            when: when.map(str::to_string),
        })
        .collect()
}

pub(crate) fn normalize_shortcut(shortcut: &str) -> Result<String, String> {
    let lowered = shortcut.trim().to_lowercase();
    if lowered.is_empty() {
        return Err("Shortcut is empty.".to_string());
    }
    let (body, plus_key) = match lowered.strip_suffix("++") {
        Some(body) => (body.to_string(), true),
        None if lowered == "+" => (String::new(), true),
        None => (lowered.clone(), false),
    };
    let mut modifiers = [false; 4];
    let mut key: Option<String> = if plus_key { Some("+".to_string()) } else { None };
    for token in body.split('+').filter(|token| !token.is_empty()) {
        let index = match token {
            "cmd" | "command" | "meta" | "mod" | "⌘" => Some(0),
            "ctrl" | "control" | "⌃" => Some(1),
            "option" | "opt" | "alt" | "⌥" => Some(2),
            "shift" | "⇧" => Some(3),
            _ => None,
        };
        if let Some(index) = index {
            modifiers[index] = true;
            continue;
        }
        if key.is_some() {
            return Err(format!("`{shortcut}` has more than one key."));
        }
        let name = match token {
            "enter" => "return",
            "esc" => "escape",
            "arrowup" => "up",
            "arrowdown" => "down",
            "arrowleft" => "left",
            "arrowright" => "right",
            "backspace" => "delete",
            other => other,
        };
        key = Some(name.to_string());
    }
    let key = key.ok_or_else(|| format!("`{shortcut}` has no key."))?;
    let mut parts: Vec<&str> =
        ["cmd", "ctrl", "option", "shift"].iter().zip(modifiers).filter(|(_, on)| *on).map(|(name, _)| *name).collect();
    parts.push(&key);
    Ok(parts.join("+"))
}

pub(crate) fn load_json<T: DeserializeOwned + Default>(path: &Path) -> (T, Option<String>) {
    match std::fs::read(path) {
        Ok(bytes) => match serde_json::from_slice(&bytes) {
            Ok(value) => (value, None),
            Err(error) => (T::default(), Some(format!("{} is invalid and was ignored: {error}", path.display()))),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (T::default(), None),
        Err(error) => (T::default(), Some(format!("could not read {}: {error}", path.display()))),
    }
}

pub(crate) fn save_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let file_name = path.file_name().map_or_else(|| "settings".into(), |name| name.to_string_lossy().into_owned());
    let temporary: PathBuf = path.with_file_name(format!(".{file_name}.{}.tmp", std::process::id()));
    std::fs::write(&temporary, bytes).map_err(|error| format!("could not write {}: {error}", temporary.display()))?;
    std::fs::rename(&temporary, path).map_err(|error| {
        let _ = std::fs::remove_file(&temporary);
        format!("could not save {}: {error}", path.display())
    })
}

pub(crate) fn sanitize(mut settings: Settings) -> Settings {
    settings.auto_settle_inactive_days = settings.auto_settle_inactive_days.clamp(1, 90);
    settings.contrast = settings.contrast.clamp(50, 200);
    settings.glass_opacity = settings.glass_opacity.min(100);
    settings.interface_font_size = settings.interface_font_size.clamp(9, 24);
    settings.prompt_font_size = settings.prompt_font_size.clamp(9, 24);
    settings.code_font_size = settings.code_font_size.clamp(8, 24);
    settings.terminal_font_size = settings.terminal_font_size.clamp(8, 24);
    settings.terminal_scrollback = settings.terminal_scrollback.min(1_000_000);
    settings.worktree_cleanup_after_days = settings.worktree_cleanup_after_days.map(|days| days.max(1));
    settings.local_controller_url = settings.local_controller_url.trim().trim_end_matches('/').to_string();
    settings.fleet_key = settings.fleet_key.trim().to_string();
    settings
}
