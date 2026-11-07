use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};

use ignore::WalkBuilder;

use super::model::{FileContent, FileEntry, SearchHit};

pub(crate) const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_WALK_ENTRIES: usize = 100_000;
const SEARCH_BUDGET: Duration = Duration::from_secs(10);
const PREVIEW_CHARS: usize = 200;
const DEFAULT_LIMIT: usize = 50;

pub(crate) fn root(project: &str) -> Result<PathBuf, String> {
    let root = Path::new(project).canonicalize().map_err(|error| format!("Project folder is unavailable: {error}"))?;
    if root.is_dir() {
        Ok(root)
    } else {
        Err("Project path is not a folder.".to_string())
    }
}

pub(crate) fn resolve(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative);
    if relative.components().any(|component| matches!(component, Component::RootDir | Component::Prefix(_))) {
        return Err("Path is outside the project.".to_string());
    }
    let joined = root.join(relative);
    let resolved = joined.canonicalize().map_err(|error| format!("{}: {error}", relative.display()))?;
    if resolved.starts_with(root) {
        Ok(resolved)
    } else {
        Err("Path is outside the project.".to_string())
    }
}

fn relative_of(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn walker(dir: &Path) -> WalkBuilder {
    let mut builder = WalkBuilder::new(dir);
    builder
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .parents(true)
        .follow_links(false)
        .filter_entry(|entry| entry.file_name() != ".git");
    builder
}

pub(crate) fn list_directory(project: &str, relative: &str) -> Result<Vec<FileEntry>, String> {
    let root = root(project)?;
    let dir = resolve(&root, relative)?;
    if !dir.is_dir() {
        return Err("Not a folder.".to_string());
    }
    let mut entries = Vec::new();
    for entry in walker(&dir).max_depth(Some(1)).build() {
        let Ok(entry) = entry else { continue };
        if entry.depth() == 0 {
            continue;
        }
        let directory = entry.file_type().is_some_and(|kind| kind.is_dir());
        let size = if directory { 0 } else { entry.metadata().map_or(0, |meta| meta.len()) };
        entries.push(FileEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            relative: relative_of(&root, entry.path()),
            directory,
            size,
        });
    }
    entries.sort_by(|left, right| {
        right.directory.cmp(&left.directory).then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

fn image_mime(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_string_lossy().to_lowercase();
    Some(match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "tif" | "tiff" => "image/tiff",
        "heic" => "image/heic",
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

pub(crate) fn language(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_string_lossy().to_lowercase();
    let special = match name.as_str() {
        "dockerfile" => Some("dockerfile"),
        "makefile" | "gnumakefile" => Some("makefile"),
        "cargo.lock" | "cargo.toml" => Some("toml"),
        "justfile" => Some("just"),
        _ => None,
    };
    if let Some(language) = special {
        return Some(language.to_string());
    }
    let extension = path.extension()?.to_string_lossy().to_lowercase();
    let language = match extension.as_str() {
        "rs" => "rust",
        "swift" => "swift",
        "ts" | "mts" | "cts" => "typescript",
        "tsx" => "tsx",
        "js" | "mjs" | "cjs" => "javascript",
        "jsx" => "jsx",
        "json" | "jsonc" | "jsonl" => "json",
        "md" | "markdown" | "mdx" => "markdown",
        "py" | "pyi" => "python",
        "rb" => "ruby",
        "go" => "go",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "c" | "h" => "c",
        "cc" | "cpp" | "cxx" | "hpp" | "hh" | "hxx" => "cpp",
        "m" => "objective-c",
        "mm" => "objective-cpp",
        "cs" => "csharp",
        "php" => "php",
        "sh" | "bash" | "zsh" => "shell",
        "fish" => "fish",
        "nu" => "nu",
        "ps1" => "powershell",
        "toml" => "toml",
        "yaml" | "yml" => "yaml",
        "xml" | "plist" => "xml",
        "html" | "htm" => "html",
        "css" => "css",
        "scss" => "scss",
        "less" => "less",
        "sql" => "sql",
        "lua" => "lua",
        "nix" => "nix",
        "zig" => "zig",
        "ex" | "exs" => "elixir",
        "erl" => "erlang",
        "hs" => "haskell",
        "ml" | "mli" => "ocaml",
        "scala" => "scala",
        "dart" => "dart",
        "vue" => "vue",
        "svelte" => "svelte",
        "graphql" | "gql" => "graphql",
        "proto" => "protobuf",
        "tf" => "hcl",
        "ini" | "cfg" | "conf" => "ini",
        "diff" | "patch" => "diff",
        "txt" | "log" => "text",
        _ => return None,
    };
    Some(language.to_string())
}

pub(crate) fn read_file(project: &str, relative: &str) -> Result<(String, FileContent), String> {
    let root = root(project)?;
    let path = resolve(&root, relative)?;
    let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.is_dir() {
        return Err("This is a folder.".to_string());
    }
    let size = metadata.len();
    let shown = relative_of(&root, &path);
    if size > MAX_FILE_BYTES {
        return Ok((shown, FileContent::TooLarge { size }));
    }
    let data = std::fs::read(&path).map_err(|error| error.to_string())?;
    if let Some(mime) = image_mime(&path) {
        return Ok((shown, FileContent::Image { mime_type: mime.to_string(), data }));
    }
    if data.iter().take(8192).any(|byte| *byte == 0) {
        return Ok((shown, FileContent::Binary { size }));
    }
    match String::from_utf8(data) {
        Ok(text) => Ok((shown, FileContent::Text { text, language: language(&path) })),
        Err(_) => Ok((shown, FileContent::Binary { size })),
    }
}

fn is_boundary(previous: Option<char>, current: char) -> bool {
    match previous {
        None => true,
        Some(previous) => {
            matches!(previous, '/' | '_' | '-' | '.' | ' ') || (previous.is_lowercase() && current.is_uppercase())
        }
    }
}

fn fuzzy_score(query: &[char], path: &str) -> Option<i64> {
    if query.is_empty() {
        return Some(-i64::try_from(path.len()).unwrap_or(i64::MAX));
    }
    let name_start = path.rfind('/').map_or(0, |index| index + 1);
    let characters: Vec<(usize, char)> = path.char_indices().collect();
    let mut score: i64 = 0;
    let mut query_index = 0;
    let mut last_match: Option<usize> = None;
    let mut previous: Option<char> = None;
    for (position, (byte_index, character)) in characters.iter().enumerate() {
        if query_index < query.len() && character.to_lowercase().eq(query[query_index].to_lowercase()) {
            score += 1;
            if last_match.is_some_and(|last| last + 1 == position) {
                score += 6;
            }
            if is_boundary(previous, *character) {
                score += 8;
            }
            if *byte_index >= name_start {
                score += 3;
                if *byte_index == name_start {
                    score += 6;
                }
            }
            last_match = Some(position);
            query_index += 1;
        }
        previous = Some(*character);
    }
    if query_index < query.len() {
        return None;
    }
    let name = &path[name_start..];
    let needle: String = query.iter().collect::<String>().to_lowercase();
    if name.to_lowercase().contains(&needle) {
        score += 25;
    }
    Some(score * 16 - i64::try_from(path.len()).unwrap_or(i64::MAX))
}

pub(crate) fn search_files(project: &str, query: &str, limit: u32) -> Result<Vec<SearchHit>, String> {
    let root = root(project)?;
    let limit = if limit == 0 { DEFAULT_LIMIT } else { limit as usize };
    let query: Vec<char> = query.chars().filter(|character| !character.is_whitespace()).collect();
    let mut best: BinaryHeap<Reverse<(i64, Reverse<String>, bool)>> = BinaryHeap::new();
    let started = Instant::now();
    for (visited, entry) in walker(&root).build().enumerate() {
        if visited >= MAX_WALK_ENTRIES || started.elapsed() > SEARCH_BUDGET {
            break;
        }
        let Ok(entry) = entry else { continue };
        if entry.depth() == 0 {
            continue;
        }
        let relative = relative_of(&root, entry.path());
        let directory = entry.file_type().is_some_and(|kind| kind.is_dir());
        let Some(score) = fuzzy_score(&query, &relative) else { continue };
        best.push(Reverse((score, Reverse(relative), directory)));
        if best.len() > limit {
            best.pop();
        }
    }
    let mut hits: Vec<(i64, String, bool)> =
        best.into_iter().map(|Reverse((score, Reverse(relative), directory))| (score, relative, directory)).collect();
    hits.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| left.1.cmp(&right.1)));
    Ok(hits
        .into_iter()
        .map(|(_, relative, directory)| SearchHit {
            preview: relative.rsplit_once('/').map_or("", |(parent, _)| parent).to_string(),
            relative: if directory { format!("{relative}/") } else { relative },
            line: None,
        })
        .collect())
}

fn preview(line: &str) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() <= PREVIEW_CHARS {
        return trimmed.to_string();
    }
    let mut cut: String = trimmed.chars().take(PREVIEW_CHARS).collect();
    cut.push('…');
    cut
}

pub(crate) fn search_text(project: &str, query: &str, limit: u32) -> Result<Vec<SearchHit>, String> {
    let root = root(project)?;
    let limit = if limit == 0 { DEFAULT_LIMIT } else { limit as usize };
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let case_sensitive = query.chars().any(char::is_uppercase);
    let needle = if case_sensitive { query.to_string() } else { query.to_lowercase() };
    let started = Instant::now();
    let mut hits = Vec::new();
    for entry in walker(&root).build() {
        if hits.len() >= limit || started.elapsed() > SEARCH_BUDGET {
            break;
        }
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        if entry.metadata().map_or(u64::MAX, |meta| meta.len()) > MAX_FILE_BYTES {
            continue;
        }
        let Ok(file) = std::fs::File::open(entry.path()) else { continue };
        let mut reader = BufReader::new(file);
        let Ok(head) = reader.fill_buf() else { continue };
        if head.iter().take(8192).any(|byte| *byte == 0) {
            continue;
        }
        let mut bytes = Vec::new();
        if reader.read_to_end(&mut bytes).is_err() {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        let relative = relative_of(&root, entry.path());
        for (index, line) in text.lines().enumerate() {
            let found = if case_sensitive {
                line.contains(needle.as_str())
            } else {
                line.to_lowercase().contains(needle.as_str())
            };
            if found {
                hits.push(SearchHit {
                    relative: relative.clone(),
                    line: Some(u32::try_from(index + 1).unwrap_or(u32::MAX)),
                    preview: preview(line),
                });
                if hits.len() >= limit {
                    break;
                }
            }
        }
    }
    Ok(hits)
}
