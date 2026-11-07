use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::rc::{Rc, Weak};

use adw::prelude::*;
use local_studio_core::{DiffColors, DiffLayout, DiffLine, DiffLineKind, DiffScope, FileDiff, Settings};

use crate::app::{App, Target};

const SCOPES: [&str; 3] = ["Working tree", "Branch changes", "Latest turn"];

pub struct DiffView {
    pub root: gtk::Box,
    scope: gtk::DropDown,
    base: gtk::DropDown,
    bases: gtk::StringList,
    base_names: RefCell<Vec<String>>,
    split: gtk::ToggleButton,
    whitespace: gtk::ToggleButton,
    wrap: gtk::ToggleButton,
    collapse: gtk::ToggleButton,
    summary: gtk::Label,
    stack: gtk::Stack,
    stacked: gtk::TextView,
    left: gtk::TextView,
    right: gtk::TextView,
    files: RefCell<Vec<FileDiff>>,
    collapsed: RefCell<HashSet<String>>,
    headers: RefCell<Vec<(i32, String)>>,
    request: RefCell<Option<String>>,
    message: RefCell<Option<String>>,
    syncing: Cell<bool>,
    app: Weak<App>,
}

impl DiffView {
    #[allow(clippy::too_many_lines)]
    pub fn new(app: &Weak<App>) -> Self {
        let scope = gtk::DropDown::from_strings(&SCOPES);
        scope.add_css_class("flat");
        let bases = gtk::StringList::new(&["Default branch"]);
        let base = gtk::DropDown::new(Some(bases.clone()), None::<gtk::Expression>);
        base.add_css_class("flat");
        base.set_tooltip_text(Some("Base ref"));
        base.set_visible(false);
        let summary = gtk::Label::new(None);
        summary.add_css_class("ls-meta");
        summary.set_hexpand(true);
        summary.set_xalign(1.0);
        let top = gtk::Box::new(gtk::Orientation::Horizontal, 4);
        top.append(&scope);
        top.append(&base);
        top.append(&summary);
        let toggle = |label: &str, tooltip: &str| {
            let button = gtk::ToggleButton::builder().label(label).tooltip_text(tooltip).build();
            button.add_css_class("flat");
            button.add_css_class("ls-small-toggle");
            button
        };
        let split = toggle("Split", "Side-by-side layout");
        let whitespace = toggle("Hide whitespace", "Ignore whitespace-only changes");
        let wrap = toggle("Wrap", "Wrap long lines");
        let collapse = toggle("Collapse all", "Collapse every file");
        let tools = gtk::Box::new(gtk::Orientation::Horizontal, 2);
        for button in [&split, &whitespace, &wrap, &collapse] {
            tools.append(button);
        }
        let bar = gtk::Box::new(gtk::Orientation::Vertical, 2);
        bar.set_margin_start(8);
        bar.set_margin_end(10);
        bar.append(&top);
        bar.append(&tools);
        let view = || {
            let view = gtk::TextView::builder()
                .editable(false)
                .cursor_visible(false)
                .monospace(true)
                .wrap_mode(gtk::WrapMode::None)
                .left_margin(10)
                .right_margin(10)
                .top_margin(6)
                .bottom_margin(10)
                .build();
            view.add_css_class("ls-diff");
            view
        };
        let stacked = view();
        let left = view();
        let right = view();
        left.set_hexpand(true);
        right.set_hexpand(true);
        let pair = gtk::Box::new(gtk::Orientation::Horizontal, 0);
        pair.append(&left);
        pair.append(&gtk::Separator::new(gtk::Orientation::Vertical));
        pair.append(&right);
        let stack = gtk::Stack::new();
        stack.add_named(&gtk::ScrolledWindow::builder().vexpand(true).child(&stacked).build(), Some("stacked"));
        stack.add_named(&gtk::ScrolledWindow::builder().vexpand(true).child(&pair).build(), Some("split"));
        let root = gtk::Box::new(gtk::Orientation::Vertical, 4);
        root.append(&bar);
        root.append(&stack);
        let diff = Self {
            root,
            scope,
            base,
            bases,
            base_names: RefCell::new(Vec::new()),
            split,
            whitespace,
            wrap,
            collapse,
            summary,
            stack,
            stacked,
            left,
            right,
            files: RefCell::new(Vec::new()),
            collapsed: RefCell::new(HashSet::new()),
            headers: RefCell::new(Vec::new()),
            request: RefCell::new(None),
            message: RefCell::new(None),
            syncing: Cell::new(false),
            app: app.clone(),
        };
        diff.install_tags(DiffColors::RedGreen);
        diff.connect(app);
        diff
    }

    fn connect(&self, app: &Weak<App>) {
        let weak = app.clone();
        self.scope.connect_selected_notify(move |scope| {
            let Some(app) = weak.upgrade() else { return };
            app.panel.diff.base.set_visible(scope.selected() == 1);
            if scope.selected() == 1 {
                DiffView::load_bases(&app);
            }
            app.panel.diff.refresh(&app);
        });
        let weak = app.clone();
        self.base.connect_selected_notify(move |_| {
            if let Some(app) = weak.upgrade() {
                if !app.panel.diff.syncing.get() {
                    app.panel.diff.refresh(&app);
                }
            }
        });
        let weak = app.clone();
        self.split.connect_toggled(move |button| {
            let Some(app) = weak.upgrade() else { return };
            if app.panel.diff.syncing.get() {
                return;
            }
            let layout = if button.is_active() { DiffLayout::Split } else { DiffLayout::Stacked };
            update_setting(&app, |settings| settings.diff_layout = layout);
            app.panel.diff.render();
        });
        let weak = app.clone();
        self.whitespace.connect_toggled(move |button| {
            let Some(app) = weak.upgrade() else { return };
            if app.panel.diff.syncing.get() {
                return;
            }
            let hide = button.is_active();
            update_setting(&app, |settings| settings.hide_whitespace = hide);
            app.panel.diff.refresh(&app);
        });
        let weak = app.clone();
        self.wrap.connect_toggled(move |button| {
            let Some(app) = weak.upgrade() else { return };
            let mode = if button.is_active() { gtk::WrapMode::WordChar } else { gtk::WrapMode::None };
            for view in [&app.panel.diff.stacked, &app.panel.diff.left, &app.panel.diff.right] {
                view.set_wrap_mode(mode);
            }
        });
        let weak = app.clone();
        self.collapse.connect_toggled(move |button| {
            let Some(app) = weak.upgrade() else { return };
            if app.panel.diff.syncing.get() {
                return;
            }
            let diff = &app.panel.diff;
            let all: HashSet<String> = if button.is_active() {
                diff.files.borrow().iter().map(|file| file.path.clone()).collect()
            } else {
                HashSet::new()
            };
            diff.collapsed.replace(all);
            diff.render();
        });
        for view in [&self.stacked, &self.left, &self.right] {
            let click = gtk::GestureClick::new();
            let weak = app.clone();
            let clicked = view.downgrade();
            click.connect_released(move |_, _, x, y| {
                let (Some(app), Some(view)) = (weak.upgrade(), clicked.upgrade()) else { return };
                #[allow(clippy::cast_possible_truncation)]
                let (bx, by) = view.window_to_buffer_coords(gtk::TextWindowType::Widget, x as i32, y as i32);
                let Some(iter) = view.iter_at_location(bx, by) else { return };
                let line = iter.line();
                let path = app
                    .panel
                    .diff
                    .headers
                    .borrow()
                    .iter()
                    .find(|(header, _)| *header == line)
                    .map(|(_, path)| path.clone());
                if let Some(path) = path {
                    {
                        let mut collapsed = app.panel.diff.collapsed.borrow_mut();
                        if !collapsed.remove(&path) {
                            collapsed.insert(path);
                        }
                    }
                    app.panel.diff.render();
                }
            });
            view.add_controller(click);
        }
    }

    fn install_tags(&self, colors: DiffColors) {
        let (add, del, add_bg, del_bg) = match colors {
            DiffColors::RedGreen => ("#3fb950", "#f85149", "rgba(63,185,80,0.10)", "rgba(248,81,73,0.10)"),
            DiffColors::BlueOrange => ("#58a6ff", "#f0883e", "rgba(88,166,255,0.12)", "rgba(240,136,62,0.12)"),
        };
        for view in [&self.stacked, &self.left, &self.right] {
            let table = view.buffer().tag_table();
            for (name, foreground, background, weight) in [
                ("file", None, Some("rgba(128,128,128,0.10)"), 700),
                ("hunk", Some("#8b949e"), Some("rgba(56,189,248,0.06)"), 400),
                ("add", Some(add), Some(add_bg), 400),
                ("del", Some(del), Some(del_bg), 400),
                ("blank", None, Some("rgba(128,128,128,0.05)"), 400),
                ("empty", Some("#8b949e"), None, 400),
            ] {
                let tag = table.lookup(name).unwrap_or_else(|| {
                    let tag = gtk::TextTag::new(Some(name));
                    table.add(&tag);
                    tag
                });
                tag.set_foreground(foreground);
                tag.set_paragraph_background(background);
                tag.set_weight(weight);
            }
        }
    }

    pub fn apply_settings(&self, settings: &Settings) {
        self.syncing.set(true);
        self.split.set_active(settings.diff_layout == DiffLayout::Split);
        self.whitespace.set_active(settings.hide_whitespace);
        self.wrap.set_active(settings.word_wrap);
        self.syncing.set(false);
        self.install_tags(settings.diff_colors);
        self.render();
    }

    fn load_bases(app: &Rc<App>) {
        let Some(dir) = app.state.borrow().workspace_dir() else { return };
        let request = app.ask(Target::DiffBases);
        app.core.run(|studio| studio.list_branches(request, dir, String::new(), 100));
    }

    pub fn bases_loaded(&self, names: Vec<String>) {
        self.syncing.set(true);
        let mut labels = vec!["Default branch".to_string()];
        labels.extend(names.iter().cloned());
        let refs: Vec<&str> = labels.iter().map(String::as_str).collect();
        self.bases.splice(0, self.bases.n_items(), &refs);
        self.base.set_selected(0);
        self.base_names.replace(names);
        self.syncing.set(false);
    }

    pub fn refresh(&self, app: &Rc<App>) {
        let (dir, thread) = {
            let state = app.state.borrow();
            (state.workspace_dir(), state.selected.clone())
        };
        let Some(dir) = dir else {
            self.message("Open a project thread to see its changes.");
            return;
        };
        let scope = match (self.scope.selected(), thread) {
            (1, _) => {
                let base = usize::try_from(self.base.selected())
                    .ok()
                    .and_then(|index| index.checked_sub(1))
                    .and_then(|index| self.base_names.borrow().get(index).cloned());
                DiffScope::Branch { base }
            }
            (2, Some(thread)) => DiffScope::LatestTurn { thread },
            (2, None) => {
                self.message("No completed turns yet.");
                return;
            }
            _ => DiffScope::WorkingTree,
        };
        let request = app.core.request();
        self.request.replace(Some(request.clone()));
        if !app.core.is_live() {
            return;
        }
        self.summary.set_label("Loading…");
        app.core.run(|studio| studio.load_diff(request, dir, scope));
    }

    pub fn loaded(&self, request: &str, files: &[FileDiff]) {
        if self.request.borrow().as_deref() != Some(request) {
            return;
        }
        self.show(files);
    }

    pub fn show(&self, files: &[FileDiff]) {
        let collapse_default = self.app.upgrade().is_some_and(|app| app.state.borrow().settings.diff_files_collapsed);
        self.collapsed.replace(if collapse_default && files.len() > 3 {
            files.iter().map(|file| file.path.clone()).collect()
        } else {
            HashSet::new()
        });
        self.syncing.set(true);
        self.collapse.set_active(!self.collapsed.borrow().is_empty());
        self.syncing.set(false);
        self.files.replace(files.to_vec());
        self.message.replace(if files.is_empty() {
            Some("No net changes in this selection.".to_string())
        } else {
            None
        });
        self.render();
    }

    pub fn message(&self, text: &str) {
        self.files.borrow_mut().clear();
        self.message.replace(Some(text.to_string()));
        self.render();
    }

    fn render(&self) {
        let split = self.split.is_active();
        self.stack.set_visible_child_name(if split { "split" } else { "stacked" });
        for view in [&self.stacked, &self.left, &self.right] {
            view.buffer().set_text("");
        }
        self.headers.borrow_mut().clear();
        if let Some(message) = self.message.borrow().as_ref() {
            self.summary.set_label("");
            let buffer = self.stacked.buffer();
            buffer.insert_with_tags_by_name(&mut buffer.end_iter(), message, &["empty"]);
            self.stack.set_visible_child_name("stacked");
            return;
        }
        let files = self.files.borrow();
        let additions: u32 = files.iter().map(|file| file.additions).sum();
        let deletions: u32 = files.iter().map(|file| file.deletions).sum();
        self.summary.set_label(&format!(
            "{} file{} · +{additions} −{deletions}",
            files.len(),
            if files.len() == 1 { "" } else { "s" }
        ));
        let collapsed = self.collapsed.borrow();
        for file in files.iter() {
            let open = !collapsed.contains(&file.path);
            let name = match &file.old_path {
                Some(old) if old != &file.path => format!("{old} → {}", file.path),
                _ => file.path.clone(),
            };
            let header = format!(
                "{} {name}   +{} −{}  {}\n",
                if open { "▾" } else { "▸" },
                file.additions,
                file.deletions,
                file.status
            );
            if split {
                let line = self.left.buffer().line_count() - 1;
                self.headers.borrow_mut().push((line, file.path.clone()));
                push(&self.left, &header, Some("file"));
                push(&self.right, &header, Some("file"));
            } else {
                let line = self.stacked.buffer().line_count() - 1;
                self.headers.borrow_mut().push((line, file.path.clone()));
                push(&self.stacked, &header, Some("file"));
            }
            if !open {
                continue;
            }
            if file.binary {
                push(if split { &self.left } else { &self.stacked }, "Binary file\n", Some("empty"));
                if split {
                    push(&self.right, "\n", None);
                }
                continue;
            }
            for hunk in &file.hunks {
                if split {
                    push(&self.left, &format!("{}\n", hunk.header), Some("hunk"));
                    push(&self.right, &format!("{}\n", hunk.header), Some("hunk"));
                    self.split_lines(&hunk.lines);
                } else {
                    push(&self.stacked, &format!("{}\n", hunk.header), Some("hunk"));
                    for line in &hunk.lines {
                        let (prefix, tag) = match line.kind {
                            DiffLineKind::Added => ("+", Some("add")),
                            DiffLineKind::Removed => ("-", Some("del")),
                            DiffLineKind::Context => (" ", None),
                        };
                        push(&self.stacked, &format!("{prefix}{}\n", line.text), tag);
                    }
                }
            }
        }
    }

    fn split_lines(&self, lines: &[DiffLine]) {
        let mut index = 0;
        while index < lines.len() {
            if lines[index].kind == DiffLineKind::Context {
                push(&self.left, &format!(" {}\n", lines[index].text), None);
                push(&self.right, &format!(" {}\n", lines[index].text), None);
                index += 1;
                continue;
            }
            let removed: Vec<&DiffLine> =
                lines[index..].iter().take_while(|line| line.kind == DiffLineKind::Removed).collect();
            index += removed.len();
            let added: Vec<&DiffLine> =
                lines[index..].iter().take_while(|line| line.kind == DiffLineKind::Added).collect();
            index += added.len();
            for row in 0..removed.len().max(added.len()) {
                match removed.get(row) {
                    Some(line) => push(&self.left, &format!("-{}\n", line.text), Some("del")),
                    None => push(&self.left, "\n", Some("blank")),
                }
                match added.get(row) {
                    Some(line) => push(&self.right, &format!("+{}\n", line.text), Some("add")),
                    None => push(&self.right, "\n", Some("blank")),
                }
            }
        }
    }

    pub fn set_fixture(&self, files: &[FileDiff], split: bool) {
        self.syncing.set(true);
        self.split.set_active(split);
        self.syncing.set(false);
        self.request.replace(Some("fixture".to_string()));
        self.show(files);
    }
}

fn push(view: &gtk::TextView, text: &str, tag: Option<&str>) {
    let buffer = view.buffer();
    let mut end = buffer.end_iter();
    match tag {
        Some(tag) => buffer.insert_with_tags_by_name(&mut end, text, &[tag]),
        None => buffer.insert(&mut end, text),
    }
}

pub fn update_setting(app: &Rc<App>, change: impl FnOnce(&mut Settings)) {
    let settings = {
        let mut state = app.state.borrow_mut();
        change(&mut state.settings);
        state.settings.clone()
    };
    app.core.run(|studio| studio.update_settings(settings));
}
