use std::cell::{Cell, RefCell};
use std::rc::Weak;

use adw::prelude::*;
use gtk::{gdk, glib};
use local_studio_core::{DiffLineKind, DiffScope, FileDiff};
use vte::prelude::*;

use crate::app::App;

const SCOPES: [&str; 3] = ["Working tree", "Branch changes", "Latest turn"];
const PALETTE: [&str; 16] = [
    "#1c1c1e", "#f85149", "#3fb950", "#d29922", "#6e9cf7", "#bc8cff", "#39c5cf", "#c9d1d9", "#6e7681", "#ff7b72",
    "#56d364", "#e3b341", "#8fb2ff", "#d2a8ff", "#56d4dd", "#f0f6fc",
];

pub struct Panel {
    pub root: gtk::Box,
    tabs: adw::ToggleGroup,
    stack: gtk::Stack,
    scope: gtk::DropDown,
    diff: gtk::TextView,
    summary: gtk::Label,
    diff_request: RefCell<Option<String>>,
    terminal: vte::Terminal,
    terminal_id: RefCell<Option<String>>,
    terminal_request: RefCell<Option<String>>,
    terminal_size: Cell<(i64, i64)>,
    app: Weak<App>,
}

impl Panel {
    #[allow(clippy::too_many_lines)]
    pub fn new(app: Weak<App>) -> Self {
        let root = gtk::Box::new(gtk::Orientation::Vertical, 0);
        root.add_css_class("ls-panel");
        root.set_size_request(420, -1);
        root.set_visible(false);
        let tabs = adw::ToggleGroup::new();
        tabs.add(adw::Toggle::builder().name("diff").label("Diff").build());
        tabs.add(adw::Toggle::builder().name("terminal").label("Terminal").build());
        tabs.set_active_name(Some("diff"));
        tabs.add_css_class("round");
        let refresh = gtk::Button::builder().icon_name("view-refresh-symbolic").tooltip_text("Refresh").build();
        refresh.add_css_class("flat");
        let close = gtk::Button::builder().icon_name("window-close-symbolic").tooltip_text("Close Panel").build();
        close.add_css_class("flat");
        let bar = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        bar.set_margin_start(10);
        bar.set_margin_end(6);
        bar.set_margin_top(8);
        bar.set_margin_bottom(8);
        bar.append(&tabs);
        let spacer = gtk::Box::new(gtk::Orientation::Horizontal, 0);
        spacer.set_hexpand(true);
        bar.append(&spacer);
        bar.append(&refresh);
        bar.append(&close);

        let scope = gtk::DropDown::from_strings(&SCOPES);
        scope.add_css_class("flat");
        let summary = gtk::Label::new(None);
        summary.add_css_class("ls-meta");
        summary.set_hexpand(true);
        summary.set_xalign(1.0);
        let diff_bar = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        diff_bar.set_margin_start(8);
        diff_bar.set_margin_end(10);
        diff_bar.append(&scope);
        diff_bar.append(&summary);
        let diff = gtk::TextView::builder()
            .editable(false)
            .cursor_visible(false)
            .monospace(true)
            .wrap_mode(gtk::WrapMode::None)
            .left_margin(10)
            .right_margin(10)
            .top_margin(6)
            .bottom_margin(10)
            .build();
        diff.add_css_class("ls-diff");
        let buffer = diff.buffer();
        let table = buffer.tag_table();
        for (name, foreground, background, weight) in [
            ("file", None, Some("rgba(128,128,128,0.10)"), 700),
            ("hunk", Some("#8b949e"), Some("rgba(56,189,248,0.06)"), 400),
            ("add", Some("#3fb950"), Some("rgba(63,185,80,0.10)"), 400),
            ("del", Some("#f85149"), Some("rgba(248,81,73,0.10)"), 400),
            ("empty", Some("#8b949e"), None, 400),
        ] {
            let tag = gtk::TextTag::new(Some(name));
            if let Some(color) = foreground {
                tag.set_foreground(Some(color));
            }
            if let Some(color) = background {
                tag.set_paragraph_background(Some(color));
            }
            tag.set_weight(weight);
            table.add(&tag);
        }
        let diff_scroller = gtk::ScrolledWindow::builder().vexpand(true).child(&diff).build();
        let diff_page = gtk::Box::new(gtk::Orientation::Vertical, 4);
        diff_page.append(&diff_bar);
        diff_page.append(&diff_scroller);

        let terminal = vte::Terminal::new();
        terminal.set_vexpand(true);
        terminal.set_hexpand(true);
        terminal.set_margin_start(8);
        terminal.set_margin_end(4);
        terminal.set_margin_bottom(6);
        let palette: Vec<gdk::RGBA> = PALETTE.iter().filter_map(|color| gdk::RGBA::parse(*color).ok()).collect();
        let palette: Vec<&gdk::RGBA> = palette.iter().collect();
        if let (Ok(foreground), Ok(background)) = (gdk::RGBA::parse("#ececec"), gdk::RGBA::parse("#111111")) {
            terminal.set_colors(Some(&foreground), Some(&background), &palette);
        }
        terminal.set_font(Some(&gtk::pango::FontDescription::from_string("Monospace 10")));

        let stack = gtk::Stack::new();
        stack.add_named(&diff_page, Some("diff"));
        stack.add_named(&terminal, Some("terminal"));
        root.append(&bar);
        root.append(&gtk::Separator::new(gtk::Orientation::Horizontal));
        root.append(&stack);

        let weak = app.clone();
        tabs.connect_active_name_notify(move |tabs| {
            let Some(app) = weak.upgrade() else { return };
            let name = tabs.active_name().map(|name| name.to_string()).unwrap_or_default();
            app.panel.stack.set_visible_child_name(&name);
            app.panel.refresh(&name, false);
        });
        let weak = app.clone();
        refresh.connect_clicked(move |_| {
            let Some(app) = weak.upgrade() else { return };
            let name = app.panel.stack.visible_child_name().map(|name| name.to_string()).unwrap_or_default();
            app.panel.refresh(&name, true);
        });
        let weak = app.clone();
        close.connect_clicked(move |_| {
            if let Some(app) = weak.upgrade() {
                app.panel.root.set_visible(false);
            }
        });
        let weak = app.clone();
        scope.connect_selected_notify(move |_| {
            if let Some(app) = weak.upgrade() {
                app.panel.refresh("diff", true);
            }
        });
        let weak = app.clone();
        terminal.connect_commit(move |_, text, _| {
            let Some(app) = weak.upgrade() else { return };
            let id = app.panel.terminal_id.borrow().clone();
            if let Some(id) = id {
                let data = text.as_bytes().to_vec();
                app.core.run(|studio| studio.write_terminal(id, data));
            }
        });
        let weak = app.clone();
        glib::timeout_add_local(std::time::Duration::from_millis(400), move || {
            let Some(app) = weak.upgrade() else { return glib::ControlFlow::Break };
            let panel = &app.panel;
            let size = (panel.terminal.column_count(), panel.terminal.row_count());
            if size != panel.terminal_size.get() {
                panel.terminal_size.set(size);
                let id = panel.terminal_id.borrow().clone();
                if let (Some(id), Ok(cols), Ok(rows)) = (id, u16::try_from(size.0), u16::try_from(size.1)) {
                    app.core.run(|studio| studio.resize_terminal(id, cols, rows));
                }
            }
            glib::ControlFlow::Continue
        });

        Self {
            root,
            tabs,
            stack,
            scope,
            diff,
            summary,
            diff_request: RefCell::new(None),
            terminal,
            terminal_id: RefCell::new(None),
            terminal_request: RefCell::new(None),
            terminal_size: Cell::new((0, 0)),
            app,
        }
    }

    pub fn toggle(&self, tab: &str) {
        let current = self.tabs.active_name().map(|name| name.to_string()).unwrap_or_default();
        if self.root.is_visible() && current == tab {
            self.root.set_visible(false);
            return;
        }
        self.show(tab);
    }

    pub fn show(&self, tab: &str) {
        self.root.set_visible(true);
        let current = self.tabs.active_name().map(|name| name.to_string()).unwrap_or_default();
        if current == tab {
            self.stack.set_visible_child_name(tab);
            self.refresh(tab, false);
        } else {
            self.tabs.set_active_name(Some(tab));
        }
        if tab == "terminal" {
            self.terminal.grab_focus();
        }
    }

    fn refresh(&self, tab: &str, force: bool) {
        let Some(app) = self.app.upgrade() else { return };
        let (dir, thread) = {
            let state = app.state.borrow();
            (state.workspace_dir(), state.selected.clone())
        };
        let Some(dir) = dir else {
            if tab == "diff" {
                self.show_message("Open a project thread to see its changes.");
            }
            return;
        };
        match tab {
            "diff" => {
                let scope = match (self.scope.selected(), thread) {
                    (1, _) => DiffScope::Branch { base: None },
                    (2, Some(thread)) => DiffScope::LatestTurn { thread },
                    (2, None) => {
                        self.show_message("No completed turns yet.");
                        return;
                    }
                    _ => DiffScope::WorkingTree,
                };
                let request = app.core.request();
                self.diff_request.replace(Some(request.clone()));
                if !app.core.is_live() {
                    return;
                }
                self.summary.set_label("Loading…");
                app.core.run(|studio| studio.load_diff(request, dir, scope));
            }
            "terminal" => {
                if self.terminal_id.borrow().is_some() && !force {
                    return;
                }
                if self.terminal_request.borrow().is_some() {
                    return;
                }
                let request = app.core.request();
                self.terminal_request.replace(Some(request.clone()));
                let cols = u16::try_from(self.terminal.column_count()).unwrap_or(80);
                let rows = u16::try_from(self.terminal.row_count()).unwrap_or(24);
                app.core.run(|studio| studio.open_terminal(request, dir, cols, rows));
            }
            _ => {}
        }
    }

    fn show_message(&self, text: &str) {
        let buffer = self.diff.buffer();
        buffer.set_text("");
        let mut end = buffer.end_iter();
        buffer.insert_with_tags_by_name(&mut end, text, &["empty"]);
        self.summary.set_label("");
    }

    pub fn set_diff(&self, request: &str, files: &[FileDiff]) {
        if self.diff_request.borrow().as_deref() != Some(request) {
            return;
        }
        if files.is_empty() {
            self.show_message("No net changes in this selection.");
            return;
        }
        let additions: u32 = files.iter().map(|file| file.additions).sum();
        let deletions: u32 = files.iter().map(|file| file.deletions).sum();
        self.summary.set_label(&format!(
            "{} file{} · +{additions} −{deletions}",
            files.len(),
            if files.len() == 1 { "" } else { "s" }
        ));
        let buffer = self.diff.buffer();
        buffer.set_text("");
        let mut end = buffer.end_iter();
        for (index, file) in files.iter().enumerate() {
            if index > 0 {
                buffer.insert(&mut end, "\n");
            }
            let name = match &file.old_path {
                Some(old) if old != &file.path => format!("{old} → {}", file.path),
                _ => file.path.clone(),
            };
            buffer.insert_with_tags_by_name(
                &mut end,
                &format!("{name}   +{} −{}  {}\n", file.additions, file.deletions, file.status),
                &["file"],
            );
            if file.binary {
                buffer.insert_with_tags_by_name(&mut end, "Binary file\n", &["empty"]);
                continue;
            }
            for hunk in &file.hunks {
                buffer.insert_with_tags_by_name(&mut end, &format!("{}\n", hunk.header), &["hunk"]);
                for line in &hunk.lines {
                    let (prefix, tag) = match line.kind {
                        DiffLineKind::Added => ("+", Some("add")),
                        DiffLineKind::Removed => ("-", Some("del")),
                        DiffLineKind::Context => (" ", None),
                    };
                    let text = format!("{prefix}{}\n", line.text);
                    match tag {
                        Some(tag) => buffer.insert_with_tags_by_name(&mut end, &text, &[tag]),
                        None => buffer.insert(&mut end, &text),
                    }
                }
            }
        }
    }

    pub fn terminal_opened(&self, request: &str, terminal: &str) {
        if self.terminal_request.borrow().as_deref() != Some(request) {
            return;
        }
        self.terminal_request.replace(None);
        self.terminal_id.replace(Some(terminal.to_string()));
        self.terminal_size.set((0, 0));
    }

    pub fn terminal_output(&self, terminal: &str, data: &[u8]) {
        if self.terminal_id.borrow().as_deref() == Some(terminal) {
            self.terminal.feed(data);
        }
    }

    pub fn terminal_exited(&self, terminal: &str, code: Option<i32>) {
        if self.terminal_id.borrow().as_deref() != Some(terminal) {
            return;
        }
        self.terminal_id.replace(None);
        let message = match code {
            Some(code) if code != 0 => format!("\r\n\x1b[2m[Process exited with code {code}]\x1b[0m\r\n"),
            _ => "\r\n\x1b[2m[Process exited]\x1b[0m\r\n".to_string(),
        };
        self.terminal.feed(message.as_bytes());
    }

    pub fn feed_fixture(&self, text: &str) {
        self.terminal.feed(text.as_bytes());
    }

    pub fn set_fixture_diff(&self, files: &[FileDiff]) {
        self.diff_request.replace(Some("fixture".to_string()));
        self.set_diff("fixture", files);
    }
}
