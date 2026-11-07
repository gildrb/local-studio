use std::time::{SystemTime, UNIX_EPOCH};

use gtk::glib;
use local_studio_core::{AccessMode, NoticeLevel, ThreadStatus, ToolKind, ToolState};

pub const ACCESS_MODES: [AccessMode; 4] =
    [AccessMode::Supervised, AccessMode::AutoAcceptEdits, AccessMode::Auto, AccessMode::FullAccess];

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX))
}

pub fn escape(text: &str) -> String {
    glib::markup_escape_text(text).to_string()
}

pub fn capitalize(text: &str) -> String {
    let mut chars = text.chars();
    chars.next().map_or_else(String::new, |first| first.to_uppercase().chain(chars).collect())
}

pub fn relative(at: i64, now: i64) -> String {
    let seconds = (now - at).max(0) / 1000;
    match seconds {
        0..60 => "now".to_string(),
        60..3_600 => format!("{}m", seconds / 60),
        3_600..86_400 => format!("{}h", seconds / 3_600),
        86_400..604_800 => format!("{}d", seconds / 86_400),
        _ => format!("{}w", seconds / 604_800),
    }
}

pub fn countdown(until: i64, now: i64) -> String {
    let seconds = (until - now).max(0) / 1000;
    match seconds {
        0..60 => "soon".to_string(),
        60..3_600 => format!("{}m", seconds / 60),
        3_600..86_400 => format!("{}h", seconds / 3_600),
        _ => format!("{}d", seconds / 86_400),
    }
}

pub fn duration(millis: u64) -> String {
    let seconds = millis / 1000;
    match seconds {
        0..60 => format!("{seconds}s"),
        60..3_600 => format!("{}m {}s", seconds / 60, seconds % 60),
        _ => format!("{}h {}m", seconds / 3_600, (seconds % 3_600) / 60),
    }
}

#[allow(clippy::cast_precision_loss)]
pub fn tokens(count: u64) -> String {
    match count {
        0..1_000 => count.to_string(),
        1_000..1_000_000 => format!("{:.1}k", count as f64 / 1_000.0),
        1_000_000..1_000_000_000 => format!("{:.1}M", count as f64 / 1_000_000.0),
        _ => format!("{:.1}B", count as f64 / 1_000_000_000.0),
    }
}

#[allow(clippy::cast_precision_loss)]
pub fn gigabytes(bytes: u64) -> String {
    format!("{:.0} GB", bytes as f64 / 1_000_000_000.0)
}

pub fn cost(usd: f64) -> String {
    if usd >= 100.0 {
        format!("${usd:.0}")
    } else {
        format!("${usd:.2}")
    }
}

pub fn access_label(mode: AccessMode) -> &'static str {
    match mode {
        AccessMode::Supervised => "Supervised",
        AccessMode::AutoAcceptEdits => "Auto-accept edits",
        AccessMode::Auto => "Auto",
        AccessMode::FullAccess => "Full access",
    }
}

pub fn access_detail(mode: AccessMode) -> &'static str {
    match mode {
        AccessMode::Supervised => "Ask before commands and file changes.",
        AccessMode::AutoAcceptEdits => "Apply edits without asking; ask before commands.",
        AccessMode::Auto => "Supported providers approve routine actions; others still ask.",
        AccessMode::FullAccess => "Allow commands and edits without prompts.",
    }
}

pub fn access_index(mode: AccessMode) -> u32 {
    match mode {
        AccessMode::Supervised => 0,
        AccessMode::AutoAcceptEdits => 1,
        AccessMode::Auto => 2,
        AccessMode::FullAccess => 3,
    }
}

pub fn status(status: ThreadStatus) -> Option<(&'static str, &'static str, &'static str)> {
    match status {
        ThreadStatus::Idle => None,
        ThreadStatus::Working => Some(("content-loading-symbolic", "Working", "status-working")),
        ThreadStatus::Approval => Some(("dialog-question-symbolic", "Approval", "status-approval")),
        ThreadStatus::Failed => Some(("dialog-error-symbolic", "Failed", "status-failed")),
        ThreadStatus::Done => Some(("object-select-symbolic", "Done", "status-done")),
        ThreadStatus::Woke => Some(("alarm-symbolic", "Woke", "status-woke")),
    }
}

pub fn tool_icon(kind: ToolKind) -> &'static str {
    match kind {
        ToolKind::Read => "view-reveal-symbolic",
        ToolKind::Edit => "document-edit-symbolic",
        ToolKind::Command => "utilities-terminal-symbolic",
        ToolKind::Search => "system-search-symbolic",
        ToolKind::Web => "web-browser-symbolic",
        ToolKind::Agent => "avatar-default-symbolic",
        ToolKind::Other => "applications-engineering-symbolic",
    }
}

pub fn tool_state(state: ToolState) -> Option<(&'static str, &'static str)> {
    match state {
        ToolState::Pending | ToolState::Running => Some(("content-loading-symbolic", "status-working")),
        ToolState::Succeeded => None,
        ToolState::Failed => Some(("window-close-symbolic", "status-failed")),
        ToolState::Aborted => Some(("media-playback-stop-symbolic", "dim-label")),
    }
}

pub fn notice(level: NoticeLevel) -> (&'static str, &'static str) {
    match level {
        NoticeLevel::Info => ("dialog-information-symbolic", "dim-label"),
        NoticeLevel::Warning => ("dialog-warning-symbolic", "warning"),
        NoticeLevel::Error => ("dialog-error-symbolic", "error"),
    }
}

pub fn shortcut_label(binding: &str) -> String {
    let accelerator = accelerator(binding);
    gtk::accelerator_parse(&accelerator)
        .map_or(accelerator, |(key, modifiers)| gtk::accelerator_get_label(key, modifiers).to_string())
}

pub fn accelerator(binding: &str) -> String {
    let mut accelerator = String::new();
    let mut key = "";
    for part in binding.split('+').filter(|part| !part.is_empty()) {
        match part {
            "cmd" | "ctrl" | "mod" => {
                accelerator.push_str(if accelerator.contains("<Control>") { "<Super>" } else { "<Control>" });
            }
            "option" | "alt" => accelerator.push_str("<Alt>"),
            "shift" => accelerator.push_str("<Shift>"),
            other => key = other,
        }
    }
    if binding.ends_with("++") {
        key = "plus";
    }
    let key = match key {
        "return" | "enter" => "Return",
        "up" => "Up",
        "down" => "Down",
        "left" => "Left",
        "right" => "Right",
        "escape" => "Escape",
        "tab" => "Tab",
        "space" => "space",
        "delete" => "Delete",
        "[" => "bracketleft",
        "]" => "bracketright",
        "=" => "equal",
        "-" => "minus",
        "," => "comma",
        "." => "period",
        "/" => "slash",
        other => other,
    };
    accelerator.push_str(key);
    accelerator
}

pub enum Markdown {
    Paragraph(String),
    Heading(u8, String),
    Bullet(String, String),
    Quote(String),
    Code(Option<String>, String),
    Rule,
}

pub fn markdown(text: &str) -> Vec<Markdown> {
    let mut blocks = Vec::new();
    let mut paragraph: Vec<&str> = Vec::new();
    let mut code: Option<(Option<String>, Vec<&str>)> = None;
    for line in text.lines() {
        let trimmed = line.trim_start();
        if let Some((language, lines)) = code.as_mut() {
            if trimmed.starts_with("```") {
                blocks.push(Markdown::Code(language.take(), lines.join("\n")));
                code = None;
            } else {
                lines.push(line);
            }
            continue;
        }
        if let Some(fence) = trimmed.strip_prefix("```") {
            flush(&mut paragraph, &mut blocks);
            let language = Some(fence.trim().to_string()).filter(|language| !language.is_empty());
            code = Some((language, Vec::new()));
            continue;
        }
        if trimmed.is_empty() {
            flush(&mut paragraph, &mut blocks);
            continue;
        }
        if let Some((level, heading)) = heading(trimmed) {
            flush(&mut paragraph, &mut blocks);
            blocks.push(Markdown::Heading(level, inline(heading)));
            continue;
        }
        if trimmed.chars().all(|ch| matches!(ch, '-' | '*' | '_')) && trimmed.len() >= 3 {
            flush(&mut paragraph, &mut blocks);
            blocks.push(Markdown::Rule);
            continue;
        }
        if let Some((marker, item)) = bullet(trimmed) {
            flush(&mut paragraph, &mut blocks);
            blocks.push(Markdown::Bullet(marker, inline(item)));
            continue;
        }
        if let Some(quote) = trimmed.strip_prefix('>') {
            flush(&mut paragraph, &mut blocks);
            blocks.push(Markdown::Quote(inline(quote.trim_start())));
            continue;
        }
        paragraph.push(trimmed);
    }
    if let Some((language, lines)) = code {
        blocks.push(Markdown::Code(language, lines.join("\n")));
    }
    flush(&mut paragraph, &mut blocks);
    blocks
}

fn flush(paragraph: &mut Vec<&str>, blocks: &mut Vec<Markdown>) {
    if !paragraph.is_empty() {
        blocks.push(Markdown::Paragraph(inline(&paragraph.join(" "))));
        paragraph.clear();
    }
}

fn heading(line: &str) -> Option<(u8, &str)> {
    let level = line.chars().take_while(|ch| *ch == '#').count();
    let rest = line.get(level..)?;
    (1..=6).contains(&level).then_some(())?;
    let text = rest.strip_prefix(' ')?;
    Some((u8::try_from(level).unwrap_or(6), text))
}

fn bullet(line: &str) -> Option<(String, &str)> {
    for marker in ["- ", "* ", "+ "] {
        if let Some(rest) = line.strip_prefix(marker) {
            let rest = rest.strip_prefix("[ ] ").map_or(rest, |todo| todo);
            return Some(("•".to_string(), rest));
        }
    }
    let digits = line.chars().take_while(char::is_ascii_digit).count();
    if digits > 0 {
        let rest = line.get(digits..)?;
        if let Some(item) = rest.strip_prefix(". ").or_else(|| rest.strip_prefix(") ")) {
            return Some((format!("{}.", &line[..digits]), item));
        }
    }
    None
}

pub fn inline(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(ch) = rest.chars().next() {
        if let Some(after) = rest.strip_prefix('`') {
            if let Some(end) = after.find('`') {
                out.push_str("<span font_family=\"monospace\">");
                out.push_str(&escape(&after[..end]));
                out.push_str("</span>");
                rest = &after[end + 1..];
                continue;
            }
        }
        if let Some(after) = rest.strip_prefix("**").or_else(|| rest.strip_prefix("__")) {
            let marker = &rest[..2];
            if let Some(end) = after.find(marker).filter(|end| *end > 0) {
                out.push_str("<b>");
                out.push_str(&inline(&after[..end]));
                out.push_str("</b>");
                rest = &after[end + 2..];
                continue;
            }
        }
        if let Some(after) = rest.strip_prefix('[') {
            if let Some((label, url, consumed)) = link(after) {
                out.push_str("<a href=\"");
                out.push_str(&escape(url));
                out.push_str("\">");
                out.push_str(&inline(label));
                out.push_str("</a>");
                rest = &after[consumed..];
                continue;
            }
        }
        if ch == '*' || ch == '_' {
            let after = &rest[1..];
            if after.chars().next().is_some_and(|next| !next.is_whitespace() && next != ch) {
                if let Some(end) = after.find(ch).filter(|end| *end > 0) {
                    let boundary = after[end + 1..].chars().next().is_none_or(|next| !next.is_alphanumeric());
                    if boundary && !after[..end].ends_with(' ') {
                        out.push_str("<i>");
                        out.push_str(&inline(&after[..end]));
                        out.push_str("</i>");
                        rest = &after[end + 1..];
                        continue;
                    }
                }
            }
        }
        out.push_str(&escape(&rest[..ch.len_utf8()]));
        rest = &rest[ch.len_utf8()..];
    }
    out
}

fn link(after: &str) -> Option<(&str, &str, usize)> {
    let close = after.find("](")?;
    let label = &after[..close];
    if label.contains('[') {
        return None;
    }
    let tail = &after[close + 2..];
    let end = tail.find(')')?;
    let url = &tail[..end];
    (!url.contains(char::is_whitespace)).then_some((label, url, close + 3 + end))
}
