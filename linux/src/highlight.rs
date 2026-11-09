use std::cell::RefCell;
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::rc::Rc;

use gtk::prelude::*;
use gtk::{gio, glib};
use local_studio_core::{CodeSegment, SyntaxKind};

use crate::colors::Syntax;

const ASYNC_BYTES: usize = 2 * 1024;
const CACHE_LIMIT: usize = 256;

pub type Segments = Rc<Vec<CodeSegment>>;
pub type Lines = Rc<Vec<Vec<CodeSegment>>>;

const KINDS: [SyntaxKind; 14] = [
    SyntaxKind::Plain,
    SyntaxKind::Comment,
    SyntaxKind::Keyword,
    SyntaxKind::Operator,
    SyntaxKind::String,
    SyntaxKind::Function,
    SyntaxKind::Type,
    SyntaxKind::Property,
    SyntaxKind::Constant,
    SyntaxKind::Number,
    SyntaxKind::Parameter,
    SyntaxKind::Builtin,
    SyntaxKind::Punctuation,
    SyntaxKind::Variable,
];

#[derive(Clone, PartialEq, Eq, Hash)]
struct Key {
    hash: u64,
    language: Option<String>,
    path: Option<String>,
}

#[derive(Default)]
struct Store {
    segments: HashMap<Key, Segments>,
    lines: HashMap<Key, Lines>,
    pending: HashSet<Key>,
    buffers: Vec<glib::WeakRef<gtk::TextBuffer>>,
}

thread_local! {
    static STORE: RefCell<Store> = RefCell::new(Store::default());
}

fn key(text: &impl Hash, language: Option<&str>, path: Option<&str>) -> Key {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    Key { hash: hasher.finish(), language: language.map(str::to_string), path: path.map(str::to_string) }
}

pub fn color(kind: SyntaxKind, syntax: &Syntax) -> &'static str {
    match kind {
        SyntaxKind::Plain | SyntaxKind::Variable => syntax.default,
        SyntaxKind::Comment => syntax.comment,
        SyntaxKind::Keyword => syntax.keyword,
        SyntaxKind::Operator => syntax.operator,
        SyntaxKind::String => syntax.string,
        SyntaxKind::Function => syntax.function,
        SyntaxKind::Type => syntax.types,
        SyntaxKind::Property => syntax.property,
        SyntaxKind::Constant => syntax.constant,
        SyntaxKind::Number => syntax.number,
        SyntaxKind::Parameter => syntax.parameter,
        SyntaxKind::Builtin => syntax.builtin,
        SyntaxKind::Punctuation => syntax.punctuation,
    }
}

fn tag_name(kind: SyntaxKind) -> String {
    format!("syntax-{kind:?}")
}

pub fn segments(
    code: &str,
    language: Option<&str>,
    path: Option<&str>,
    ready: impl FnOnce(Segments) + 'static,
) -> Option<Segments> {
    let key = key(&code, language, path);
    if let Some(found) = STORE.with(|store| store.borrow().segments.get(&key).cloned()) {
        return Some(found);
    }
    let (code, language, path) = (code.to_string(), language.map(str::to_string), path.map(str::to_string));
    if code.len() <= ASYNC_BYTES {
        let found = Rc::new(local_studio_core::highlight(code, language, path));
        remember_segments(key, &found);
        return Some(found);
    }
    if !STORE.with(|store| store.borrow_mut().pending.insert(key.clone())) {
        return None;
    }
    let handle = gio::spawn_blocking(move || local_studio_core::highlight(code, language, path));
    glib::MainContext::default().spawn_local(async move {
        let result = handle.await;
        STORE.with(|store| store.borrow_mut().pending.remove(&key));
        if let Ok(found) = result {
            let found = Rc::new(found);
            remember_segments(key, &found);
            ready(found);
        }
    });
    None
}

pub fn lines(
    lines: &[String],
    language: Option<&str>,
    path: Option<&str>,
    ready: impl FnOnce(Lines) + 'static,
) -> Option<Lines> {
    let key = key(&lines, language, path);
    if let Some(found) = STORE.with(|store| store.borrow().lines.get(&key).cloned()) {
        return Some(found);
    }
    let bytes: usize = lines.iter().map(String::len).sum();
    let (owned, language, path) = (lines.to_vec(), language.map(str::to_string), path.map(str::to_string));
    if bytes <= ASYNC_BYTES {
        let found = Rc::new(local_studio_core::highlight_lines(owned, language, path));
        remember_lines(key, &found);
        return Some(found);
    }
    if !STORE.with(|store| store.borrow_mut().pending.insert(key.clone())) {
        return None;
    }
    let handle = gio::spawn_blocking(move || local_studio_core::highlight_lines(owned, language, path));
    glib::MainContext::default().spawn_local(async move {
        let result = handle.await;
        STORE.with(|store| store.borrow_mut().pending.remove(&key));
        if let Ok(found) = result {
            let found = Rc::new(found);
            remember_lines(key, &found);
            ready(found);
        }
    });
    None
}

fn remember_segments(key: Key, found: &Segments) {
    STORE.with(|store| {
        let mut store = store.borrow_mut();
        if store.segments.len() >= CACHE_LIMIT {
            store.segments.clear();
        }
        store.segments.insert(key, Rc::clone(found));
    });
}

fn remember_lines(key: Key, found: &Lines) {
    STORE.with(|store| {
        let mut store = store.borrow_mut();
        if store.lines.len() >= CACHE_LIMIT {
            store.lines.clear();
        }
        store.lines.insert(key, Rc::clone(found));
    });
}

pub fn ensure_tags(buffer: &gtk::TextBuffer) {
    let table = buffer.tag_table();
    if table.lookup(&tag_name(SyntaxKind::Plain)).is_none() {
        for kind in KINDS {
            let tag = gtk::TextTag::new(Some(&tag_name(kind)));
            if kind == SyntaxKind::Comment {
                tag.set_style(gtk::pango::Style::Italic);
            }
            table.add(&tag);
        }
        STORE.with(|store| {
            let mut store = store.borrow_mut();
            store.buffers.retain(|weak| weak.upgrade().is_some());
            store.buffers.push(buffer.downgrade());
        });
    }
    paint(buffer, &crate::colors::current().syntax);
}

fn paint(buffer: &gtk::TextBuffer, syntax: &Syntax) {
    let table = buffer.tag_table();
    for kind in KINDS {
        if let Some(tag) = table.lookup(&tag_name(kind)) {
            tag.set_foreground(Some(color(kind, syntax)));
        }
    }
}

pub fn recolor(syntax: &Syntax) {
    let buffers: Vec<gtk::TextBuffer> =
        STORE.with(|store| store.borrow().buffers.iter().filter_map(glib::WeakRef::upgrade).collect());
    for buffer in buffers {
        paint(&buffer, syntax);
    }
}

pub fn insert(buffer: &gtk::TextBuffer, segments: &[CodeSegment], extra: Option<&str>) {
    for segment in segments {
        let mut end = buffer.end_iter();
        let name = tag_name(segment.kind);
        match extra {
            Some(extra) => buffer.insert_with_tags_by_name(&mut end, &segment.text, &[extra, &name]),
            None => buffer.insert_with_tags_by_name(&mut end, &segment.text, &[&name]),
        }
    }
}

pub fn fill(buffer: &gtk::TextBuffer, segments: &[CodeSegment]) {
    ensure_tags(buffer);
    buffer.set_text("");
    insert(buffer, segments, None);
}

pub fn paint_plain(buffer: &gtk::TextBuffer, start: i32, end: i32) {
    buffer.apply_tag_by_name(&tag_name(SyntaxKind::Plain), &buffer.iter_at_offset(start), &buffer.iter_at_offset(end));
}

pub fn paint_segments(buffer: &gtk::TextBuffer, start: i32, segments: &[CodeSegment]) {
    let mut offset = start;
    for segment in segments {
        let end = offset + i32::try_from(segment.text.chars().count()).unwrap_or(0);
        if segment.kind != SyntaxKind::Plain {
            let name = tag_name(segment.kind);
            buffer.apply_tag_by_name(&name, &buffer.iter_at_offset(offset), &buffer.iter_at_offset(end));
        }
        offset = end;
    }
}
