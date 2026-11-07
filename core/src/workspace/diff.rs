use super::model::{DiffHunk, DiffLine, DiffLineKind, FileDiff};

pub(crate) fn parse(text: &str) -> Vec<FileDiff> {
    let mut files = Vec::new();
    let mut current: Option<Builder> = None;
    for line in text.split('\n') {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            if let Some(builder) = current.take() {
                files.push(builder.finish());
            }
            current = Some(Builder::new(rest));
            continue;
        }
        if let Some(builder) = current.as_mut() {
            builder.line(line);
        }
    }
    if let Some(builder) = current {
        files.push(builder.finish());
    }
    files
}

struct Builder {
    old_path: Option<String>,
    new_path: Option<String>,
    status: &'static str,
    binary: bool,
    additions: u32,
    deletions: u32,
    hunks: Vec<DiffHunk>,
    in_hunk: bool,
    old_line: u32,
    new_line: u32,
}

impl Builder {
    fn new(header: &str) -> Self {
        let (old_path, new_path) = split_header(header);
        Self {
            old_path,
            new_path,
            status: "modified",
            binary: false,
            additions: 0,
            deletions: 0,
            hunks: Vec::new(),
            in_hunk: false,
            old_line: 0,
            new_line: 0,
        }
    }

    fn line(&mut self, line: &str) {
        if self.in_hunk {
            if let Some(hunk) = self.hunks.last_mut() {
                if let Some(text) = line.strip_prefix('+') {
                    hunk.lines.push(DiffLine {
                        kind: DiffLineKind::Added,
                        old_line: None,
                        new_line: Some(self.new_line),
                        text: text.to_string(),
                    });
                    self.new_line += 1;
                    self.additions += 1;
                    return;
                }
                if let Some(text) = line.strip_prefix('-') {
                    hunk.lines.push(DiffLine {
                        kind: DiffLineKind::Removed,
                        old_line: Some(self.old_line),
                        new_line: None,
                        text: text.to_string(),
                    });
                    self.old_line += 1;
                    self.deletions += 1;
                    return;
                }
                if let Some(text) = line.strip_prefix(' ') {
                    hunk.lines.push(DiffLine {
                        kind: DiffLineKind::Context,
                        old_line: Some(self.old_line),
                        new_line: Some(self.new_line),
                        text: text.to_string(),
                    });
                    self.old_line += 1;
                    self.new_line += 1;
                    return;
                }
                if line.starts_with('\\') {
                    return;
                }
            }
            self.in_hunk = false;
        }
        if let Some(header) = line.strip_prefix("@@ ") {
            let (old_start, new_start) = hunk_starts(header);
            self.old_line = old_start;
            self.new_line = new_start;
            self.in_hunk = true;
            self.hunks.push(DiffHunk { header: line.to_string(), lines: Vec::new() });
        } else if line.starts_with("new file mode") {
            self.status = "added";
        } else if line.starts_with("deleted file mode") {
            self.status = "deleted";
        } else if let Some(path) = line.strip_prefix("rename from ") {
            self.status = "renamed";
            self.old_path = Some(unquote(path));
        } else if let Some(path) = line.strip_prefix("rename to ") {
            self.status = "renamed";
            self.new_path = Some(unquote(path));
        } else if let Some(path) = line.strip_prefix("copy from ") {
            self.status = "copied";
            self.old_path = Some(unquote(path));
        } else if let Some(path) = line.strip_prefix("copy to ") {
            self.status = "copied";
            self.new_path = Some(unquote(path));
        } else if let Some(path) = line.strip_prefix("--- ") {
            if let Some(path) = strip_side(path, "a/") {
                self.old_path = Some(path);
            }
        } else if let Some(path) = line.strip_prefix("+++ ") {
            if let Some(path) = strip_side(path, "b/") {
                self.new_path = Some(path);
            }
        } else if line.starts_with("Binary files ") || line.starts_with("GIT binary patch") {
            self.binary = true;
        }
    }

    fn finish(self) -> FileDiff {
        let path = match self.status {
            "deleted" => self.old_path.clone().or_else(|| self.new_path.clone()),
            _ => self.new_path.clone().or_else(|| self.old_path.clone()),
        }
        .unwrap_or_default();
        let old_path = match self.status {
            "renamed" | "copied" => self.old_path.filter(|old| *old != path),
            _ => None,
        };
        FileDiff {
            path,
            old_path,
            status: self.status.to_string(),
            additions: self.additions,
            deletions: self.deletions,
            binary: self.binary,
            hunks: self.hunks,
        }
    }
}

fn strip_side(path: &str, prefix: &str) -> Option<String> {
    let path = path.trim_end_matches('\t');
    if path == "/dev/null" {
        return None;
    }
    let path = unquote(path);
    Some(path.strip_prefix(prefix).map_or_else(|| path.clone(), str::to_string))
}

fn split_header(header: &str) -> (Option<String>, Option<String>) {
    if header.starts_with('"') {
        let (first, rest) = take_quoted(header);
        let second = rest.trim_start();
        let second = if second.starts_with('"') { take_quoted(second).0 } else { second.to_string() };
        return (first.strip_prefix("a/").map(str::to_string), second.strip_prefix("b/").map(str::to_string));
    }
    if let Some(rest) = header.strip_prefix("a/") {
        if rest.len() % 2 == 1 {
            let half = rest.len() / 2;
            if rest.is_char_boundary(half) && rest.get(half..half + 3) == Some(" b/") {
                let old = &rest[..half];
                let new = &rest[half + 3..];
                if old == new {
                    return (Some(old.to_string()), Some(new.to_string()));
                }
            }
        }
        if let Some(index) = rest.find(" b/") {
            return (Some(rest[..index].to_string()), Some(rest[index + 3..].to_string()));
        }
    }
    (None, None)
}

fn take_quoted(text: &str) -> (String, &str) {
    let mut bytes = Vec::new();
    let mut chars = text.char_indices().skip(1);
    while let Some((index, character)) = chars.next() {
        match character {
            '"' => return (String::from_utf8_lossy(&bytes).into_owned(), &text[index + 1..]),
            '\\' => {
                let Some((_, escaped)) = chars.next() else { break };
                match escaped {
                    'n' => bytes.push(b'\n'),
                    't' => bytes.push(b'\t'),
                    'r' => bytes.push(b'\r'),
                    'a' => bytes.push(0x07),
                    'b' => bytes.push(0x08),
                    'f' => bytes.push(0x0c),
                    'v' => bytes.push(0x0b),
                    '0'..='7' => {
                        let mut value = escaped.to_digit(8).unwrap_or(0);
                        for _ in 0..2 {
                            let mut lookahead = chars.clone();
                            match lookahead.next() {
                                Some((_, digit @ '0'..='7')) => {
                                    value = value * 8 + digit.to_digit(8).unwrap_or(0);
                                    chars = lookahead;
                                }
                                _ => break,
                            }
                        }
                        bytes.push(u8::try_from(value & 0xff).unwrap_or(b'?'));
                    }
                    other => {
                        let mut buffer = [0; 4];
                        bytes.extend_from_slice(other.encode_utf8(&mut buffer).as_bytes());
                    }
                }
            }
            other => {
                let mut buffer = [0; 4];
                bytes.extend_from_slice(other.encode_utf8(&mut buffer).as_bytes());
            }
        }
    }
    (String::from_utf8_lossy(&bytes).into_owned(), "")
}

fn unquote(text: &str) -> String {
    if text.starts_with('"') {
        take_quoted(text).0
    } else {
        text.to_string()
    }
}

fn hunk_starts(header: &str) -> (u32, u32) {
    let mut old = 0;
    let mut new = 0;
    for part in header.split(' ') {
        if let Some(range) = part.strip_prefix('-') {
            old = range.split(',').next().and_then(|start| start.parse().ok()).unwrap_or(0);
        } else if let Some(range) = part.strip_prefix('+') {
            new = range.split(',').next().and_then(|start| start.parse().ok()).unwrap_or(0);
        } else if part == "@@" {
            break;
        }
    }
    (old, new)
}
