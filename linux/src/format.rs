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
        ThreadStatus::Monitoring => Some(("view-reveal-symbolic", "Monitoring", "status-monitoring")),
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
    if function_key(key) {
        accelerator.push_str(&key.to_uppercase());
    } else {
        accelerator.push_str(key);
    }
    accelerator
}

pub fn function_key(key: &str) -> bool {
    key.strip_prefix(['f', 'F'])
        .is_some_and(|number| !number.is_empty() && number.chars().all(|ch| ch.is_ascii_digit()))
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct Style {
    pub bold: bool,
    pub italic: bool,
    pub code: bool,
}

pub struct Span {
    pub text: String,
    pub style: Style,
    pub link: Option<String>,
}

pub enum Markdown {
    Paragraph(Vec<Span>),
    Heading(u8, Vec<Span>),
    Bullet(usize, String, Vec<Span>),
    Quote(Vec<Span>),
    Code(Option<String>, String),
    Table(Vec<Vec<Vec<Span>>>),
    Rule,
}

pub fn markdown(text: &str) -> Vec<Markdown> {
    let mut blocks = Vec::new();
    let mut paragraph: Vec<&str> = Vec::new();
    let mut table: Vec<Vec<Vec<Span>>> = Vec::new();
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
        let cells = row(trimmed.trim_end());
        if cells.is_none() && !table.is_empty() {
            blocks.push(Markdown::Table(std::mem::take(&mut table)));
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
        if let Some(cells) = cells {
            flush(&mut paragraph, &mut blocks);
            if !divider(&cells) {
                table.push(cells.into_iter().map(inline).collect());
            }
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
            let indent: usize =
                line[..line.len() - trimmed.len()].chars().map(|ch| if ch == '\t' { 4 } else { 1 }).sum();
            blocks.push(Markdown::Bullet((indent / 2).min(3), marker, inline(item)));
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
    if !table.is_empty() {
        blocks.push(Markdown::Table(table));
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

fn row(line: &str) -> Option<Vec<&str>> {
    let inner = line.strip_prefix('|')?;
    let inner = inner.strip_suffix('|').unwrap_or(inner);
    Some(inner.split('|').map(str::trim).collect())
}

fn divider(cells: &[&str]) -> bool {
    cells.iter().all(|cell| {
        let dashes = cell.trim_matches(':');
        !dashes.is_empty() && dashes.chars().all(|ch| ch == '-')
    })
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

fn inline(text: &str) -> Vec<Span> {
    let mut spans = Vec::new();
    push_inline(text, Style::default(), None, &mut spans);
    spans
}

fn push_inline(text: &str, style: Style, link: Option<&str>, spans: &mut Vec<Span>) {
    let mut plain = String::new();
    let mut rest = text;
    while let Some(ch) = rest.chars().next() {
        if let Some(after) = rest.strip_prefix('`') {
            if let Some(end) = after.find('`') {
                push_span(spans, &std::mem::take(&mut plain), style, link);
                push_span(spans, &after[..end], Style { code: true, ..style }, link);
                rest = &after[end + 1..];
                continue;
            }
        }
        if let Some(after) = rest.strip_prefix("**").or_else(|| rest.strip_prefix("__")) {
            let marker = &rest[..2];
            if let Some(end) = after.find(marker).filter(|end| *end > 0) {
                push_span(spans, &std::mem::take(&mut plain), style, link);
                push_inline(&after[..end], Style { bold: true, ..style }, link, spans);
                rest = &after[end + 2..];
                continue;
            }
        }
        if let Some(after) = rest.strip_prefix('[') {
            if let Some((label, url, consumed)) = self::link(after) {
                push_span(spans, &std::mem::take(&mut plain), style, link);
                push_inline(label, style, Some(url), spans);
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
                        push_span(spans, &std::mem::take(&mut plain), style, link);
                        push_inline(&after[..end], Style { italic: true, ..style }, link, spans);
                        rest = &after[end + 1..];
                        continue;
                    }
                }
            }
        }
        plain.push(ch);
        rest = &rest[ch.len_utf8()..];
    }
    push_span(spans, &plain, style, link);
}

fn push_span(spans: &mut Vec<Span>, text: &str, style: Style, link: Option<&str>) {
    if text.is_empty() {
        return;
    }
    if let Some(last) = spans.last_mut().filter(|last| last.style == style && last.link.as_deref() == link) {
        last.text.push_str(text);
        return;
    }
    spans.push(Span { text: text.to_string(), style, link: link.map(str::to_string) });
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
