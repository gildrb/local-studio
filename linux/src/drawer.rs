use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use adw::prelude::*;
use gtk::{gdk, gio, glib};
use vte::prelude::*;

use crate::app::App;

const PALETTE: [&str; 16] = [
    "#1c1c1e", "#f85149", "#3fb950", "#d29922", "#6e9cf7", "#bc8cff", "#39c5cf", "#c9d1d9", "#6e7681", "#ff7b72",
    "#56d364", "#e3b341", "#8fb2ff", "#d2a8ff", "#56d4dd", "#f0f6fc",
];
const CONTEXT_LINES: usize = 40;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Layout {
    Stacked,
    SideBySide,
}

pub struct Pane {
    pub terminal: vte::Terminal,
    id: RefCell<Option<String>>,
    request: RefCell<Option<String>>,
    size: Cell<(i64, i64)>,
    startup: RefCell<Option<String>>,
}

pub struct Drawer {
    pub root: gtk::Box,
    area: adw::Bin,
    empty: gtk::Box,
    panes: RefCell<Vec<Rc<Pane>>>,
    layout: Cell<Layout>,
    focused: Cell<usize>,
    font: RefCell<String>,
    app: Weak<App>,
}

impl Drawer {
    pub fn new(app: Weak<App>) -> Self {
        let root = gtk::Box::new(gtk::Orientation::Vertical, 0);
        root.add_css_class("ls-drawer");
        root.set_visible(false);
        let bar = gtk::Box::new(gtk::Orientation::Horizontal, 2);
        bar.add_css_class("ls-drawer-bar");
        let title = gtk::Label::new(Some("Terminal"));
        title.add_css_class("ls-meta");
        title.set_hexpand(true);
        title.set_xalign(0.0);
        bar.append(&title);
        for (icon, tooltip, action) in [
            ("list-add-symbolic", "New Terminal (Ctrl+Shift+T)", "win.terminal-new"),
            ("view-dual-symbolic", "Split Side by Side (Ctrl+Shift+D)", "win.terminal-split"),
            ("view-continuous-symbolic", "Split Stacked (Ctrl+Shift+E)", "win.terminal-split-vertical"),
            ("window-close-symbolic", "Close Terminal (Ctrl+Shift+W)", "win.terminal-close"),
            ("pan-down-symbolic", "Hide Terminal (Ctrl+J)", "win.toggle-terminal"),
        ] {
            let button = gtk::Button::builder().icon_name(icon).tooltip_text(tooltip).action_name(action).build();
            button.add_css_class("flat");
            bar.append(&button);
        }
        let empty = gtk::Box::new(gtk::Orientation::Vertical, 8);
        empty.set_valign(gtk::Align::Center);
        let message = gtk::Label::new(Some("No terminal sessions for this thread yet."));
        message.add_css_class("dim-label");
        let start = gtk::Button::builder().label("New Terminal").action_name("win.terminal-new").build();
        start.add_css_class("pill");
        start.set_halign(gtk::Align::Center);
        empty.append(&message);
        empty.append(&start);
        let area = adw::Bin::new();
        area.set_vexpand(true);
        area.set_child(Some(&empty));
        root.append(&bar);
        root.append(&area);
        let weak = app.clone();
        glib::timeout_add_local(std::time::Duration::from_millis(400), move || {
            let Some(app) = weak.upgrade() else { return glib::ControlFlow::Break };
            for pane in app.drawer.panes.borrow().iter() {
                let size = (pane.terminal.column_count(), pane.terminal.row_count());
                if size == pane.size.get() {
                    continue;
                }
                pane.size.set(size);
                let id = pane.id.borrow().clone();
                if let (Some(id), Ok(cols), Ok(rows)) = (id, u16::try_from(size.0), u16::try_from(size.1)) {
                    app.core.run(|studio| studio.resize_terminal(id, cols, rows));
                }
            }
            glib::ControlFlow::Continue
        });
        Self {
            root,
            area,
            empty,
            panes: RefCell::new(Vec::new()),
            layout: Cell::new(Layout::SideBySide),
            focused: Cell::new(0),
            font: RefCell::new("Monospace 10".to_string()),
            app,
        }
    }

    pub fn toggle(&self, app: &Rc<App>) {
        if self.root.is_visible() {
            self.root.set_visible(false);
            app.composer.focus();
            return;
        }
        self.show(app);
    }

    pub fn show(&self, app: &Rc<App>) {
        self.root.set_visible(true);
        if self.panes.borrow().is_empty() {
            self.add(app, self.layout.get());
        } else if let Some(pane) = self.panes.borrow().get(self.focused.get()) {
            pane.terminal.grab_focus();
        }
    }

    pub fn set_font(&self, family: &str, size: u32) {
        let family = if family.trim().is_empty() { "Monospace" } else { family.trim() };
        let font = format!("{family} {size}");
        for pane in self.panes.borrow().iter() {
            pane.terminal.set_font(Some(&gtk::pango::FontDescription::from_string(&font)));
        }
        self.font.replace(font);
    }

    pub fn add(&self, app: &Rc<App>, layout: Layout) {
        let pane = Rc::new(self.pane());
        self.layout.set(layout);
        self.panes.borrow_mut().push(Rc::clone(&pane));
        self.focused.set(self.panes.borrow().len() - 1);
        self.relayout();
        self.root.set_visible(true);
        pane.terminal.grab_focus();
        let dir = app.state.borrow().workspace_dir();
        let Some(dir) = dir else {
            pane.terminal.feed(b"\x1b[2mOpen a project thread to start a shell in it.\x1b[0m\r\n");
            return;
        };
        let request = app.core.request();
        pane.request.replace(Some(request.clone()));
        let cols = u16::try_from(pane.terminal.column_count()).unwrap_or(80);
        let rows = u16::try_from(pane.terminal.row_count()).unwrap_or(24);
        app.core.run(|studio| studio.open_terminal(request, dir, cols, rows));
    }

    pub fn run(&self, app: &Rc<App>, name: &str, command: &str) {
        self.add(app, Layout::SideBySide);
        let pane = self.panes.borrow().last().cloned();
        if let Some(pane) = pane {
            pane.terminal.feed(format!("\x1b[2m▶ {name}\x1b[0m\r\n").as_bytes());
            pane.startup.replace(Some(command.to_string()));
        }
    }

    pub fn close_focused(&self, app: &Rc<App>) {
        let index = self.focused.get();
        let pane = {
            let mut panes = self.panes.borrow_mut();
            if index >= panes.len() {
                return;
            }
            panes.remove(index)
        };
        let id = pane.id.borrow().clone();
        if let Some(id) = id {
            app.core.run(|studio| studio.close_terminal(id));
        }
        let remaining = self.panes.borrow().len();
        self.focused.set(index.min(remaining.saturating_sub(1)));
        self.relayout();
        if remaining == 0 {
            app.terminal_focus(false);
        } else if let Some(pane) = self.panes.borrow().get(self.focused.get()) {
            pane.terminal.grab_focus();
        }
    }

    fn relayout(&self) {
        let panes = self.panes.borrow();
        let widgets: Vec<gtk::Widget> = panes.iter().map(|pane| pane.terminal.clone().upcast()).collect();
        for widget in &widgets {
            if let Some(parent) = widget.parent() {
                if let Some(paned) = parent.downcast_ref::<gtk::Paned>() {
                    if paned.start_child().as_ref() == Some(widget) {
                        paned.set_start_child(None::<&gtk::Widget>);
                    } else {
                        paned.set_end_child(None::<&gtk::Widget>);
                    }
                } else if let Some(bin) = parent.downcast_ref::<adw::Bin>() {
                    bin.set_child(None::<&gtk::Widget>);
                }
            }
        }
        let orientation = match self.layout.get() {
            Layout::Stacked => gtk::Orientation::Vertical,
            Layout::SideBySide => gtk::Orientation::Horizontal,
        };
        let content = widgets.into_iter().rev().fold(None::<gtk::Widget>, |rest, widget| match rest {
            None => Some(widget),
            Some(rest) => {
                let split = gtk::Paned::new(orientation);
                split.set_start_child(Some(&widget));
                split.set_end_child(Some(&rest));
                split.set_wide_handle(false);
                Some(split.upcast())
            }
        });
        match content {
            Some(content) => self.area.set_child(Some(&content)),
            None => self.area.set_child(Some(&self.empty)),
        }
    }

    fn pane(&self) -> Pane {
        let terminal = vte::Terminal::new();
        terminal.set_vexpand(true);
        terminal.set_hexpand(true);
        terminal.add_css_class("ls-terminal");
        let palette: Vec<gdk::RGBA> = PALETTE.iter().filter_map(|color| gdk::RGBA::parse(*color).ok()).collect();
        let palette: Vec<&gdk::RGBA> = palette.iter().collect();
        if let (Ok(foreground), Ok(background)) = (gdk::RGBA::parse("#ececec"), gdk::RGBA::parse("#0d0d0d")) {
            terminal.set_colors(Some(&foreground), Some(&background), &palette);
        }
        terminal.set_font(Some(&gtk::pango::FontDescription::from_string(&self.font.borrow())));
        let weak = self.app.clone();
        terminal.connect_commit(move |terminal, text, _| {
            let Some(app) = weak.upgrade() else { return };
            let id = app.drawer.pane_for(terminal).and_then(|pane| pane.id.borrow().clone());
            if let Some(id) = id {
                let data = text.as_bytes().to_vec();
                app.core.run(|studio| studio.write_terminal(id, data));
            }
        });
        let focus = gtk::EventControllerFocus::new();
        let (weak, watched) = (self.app.clone(), terminal.downgrade());
        focus.connect_enter(move |_| {
            let (Some(app), Some(terminal)) = (weak.upgrade(), watched.upgrade()) else { return };
            let index = app.drawer.panes.borrow().iter().position(|pane| pane.terminal == terminal);
            if let Some(index) = index {
                app.drawer.focused.set(index);
            }
            app.terminal_focus(true);
        });
        let weak = self.app.clone();
        focus.connect_leave(move |_| {
            if let Some(app) = weak.upgrade() {
                app.terminal_focus(false);
            }
        });
        terminal.add_controller(focus);
        let keys = gtk::EventControllerKey::new();
        keys.set_propagation_phase(gtk::PropagationPhase::Capture);
        let (weak, watched) = (self.app.clone(), terminal.downgrade());
        keys.connect_key_pressed(move |_, key, _, modifiers| {
            let (Some(app), Some(terminal)) = (weak.upgrade(), watched.upgrade()) else {
                return glib::Propagation::Proceed;
            };
            let wanted = gdk::ModifierType::CONTROL_MASK | gdk::ModifierType::SHIFT_MASK;
            if !modifiers.contains(wanted) {
                return glib::Propagation::Proceed;
            }
            match key.to_lower() {
                gdk::Key::c => terminal.copy_clipboard_format(vte::Format::Text),
                gdk::Key::v => terminal.paste_clipboard(),
                gdk::Key::t => app.drawer.add(&app, app.drawer.layout.get()),
                gdk::Key::d => app.drawer.add(&app, Layout::SideBySide),
                gdk::Key::e => app.drawer.add(&app, Layout::Stacked),
                gdk::Key::w => app.drawer.close_focused(&app),
                gdk::Key::a => add_to_chat(&app, &terminal),
                _ => return glib::Propagation::Proceed,
            }
            glib::Propagation::Stop
        });
        terminal.add_controller(keys);
        let actions = gio::SimpleActionGroup::new();
        for name in ["copy", "paste", "add-to-chat"] {
            let action = gio::SimpleAction::new(name, None);
            let (weak, watched) = (self.app.clone(), terminal.downgrade());
            action.connect_activate(move |action, _| {
                let (Some(app), Some(terminal)) = (weak.upgrade(), watched.upgrade()) else { return };
                match action.name().as_str() {
                    "copy" => terminal.copy_clipboard_format(vte::Format::Text),
                    "paste" => terminal.paste_clipboard(),
                    _ => add_to_chat(&app, &terminal),
                }
            });
            actions.add_action(&action);
        }
        terminal.insert_action_group("term", Some(&actions));
        let menu = gtk::GestureClick::builder().button(3).build();
        let watched = terminal.downgrade();
        menu.connect_pressed(move |gesture, _, x, y| {
            let Some(terminal) = watched.upgrade() else { return };
            gesture.set_state(gtk::EventSequenceState::Claimed);
            let model = gio::Menu::new();
            model.append(Some("Add to Chat"), Some("term.add-to-chat"));
            model.append(Some("Copy"), Some("term.copy"));
            model.append(Some("Paste"), Some("term.paste"));
            crate::actions::popup_menu(&terminal, &model, x, y);
        });
        terminal.add_controller(menu);
        Pane {
            terminal,
            id: RefCell::new(None),
            request: RefCell::new(None),
            size: Cell::new((0, 0)),
            startup: RefCell::new(None),
        }
    }

    fn pane_for(&self, terminal: &vte::Terminal) -> Option<Rc<Pane>> {
        self.panes.borrow().iter().find(|pane| &pane.terminal == terminal).cloned()
    }

    fn pane_by_id(&self, terminal: &str) -> Option<Rc<Pane>> {
        self.panes.borrow().iter().find(|pane| pane.id.borrow().as_deref() == Some(terminal)).cloned()
    }

    pub fn opened(&self, request: &str, terminal: &str) -> bool {
        let pane = self.panes.borrow().iter().find(|pane| pane.request.borrow().as_deref() == Some(request)).cloned();
        let Some(pane) = pane else { return false };
        pane.request.replace(None);
        pane.id.replace(Some(terminal.to_string()));
        pane.size.set((0, 0));
        if let (Some(command), Some(app)) = (pane.startup.take(), self.app.upgrade()) {
            let (id, data) = (terminal.to_string(), format!("{command}\n").into_bytes());
            app.core.run(|studio| studio.write_terminal(id, data));
        }
        true
    }

    pub fn output(&self, terminal: &str, data: &[u8]) {
        if let Some(pane) = self.pane_by_id(terminal) {
            pane.terminal.feed(data);
        }
    }

    pub fn exited(&self, terminal: &str, code: Option<i32>) {
        let Some(pane) = self.pane_by_id(terminal) else { return };
        pane.id.replace(None);
        let message = match code {
            Some(code) if code != 0 => format!("\r\n\x1b[2m[Process exited with code {code}]\x1b[0m\r\n"),
            _ => "\r\n\x1b[2m[Process exited]\x1b[0m\r\n".to_string(),
        };
        pane.terminal.feed(message.as_bytes());
    }

    pub fn fixture(&self, texts: &[&str], layout: Layout) {
        self.panes.borrow_mut().clear();
        self.layout.set(layout);
        for text in texts {
            let pane = Rc::new(self.pane());
            pane.terminal.feed(text.as_bytes());
            self.panes.borrow_mut().push(pane);
        }
        self.relayout();
        self.root.set_visible(true);
    }

    pub fn reset(&self) {
        self.panes.borrow_mut().clear();
        self.relayout();
        self.root.set_visible(false);
    }
}

fn add_to_chat(app: &Rc<App>, terminal: &vte::Terminal) {
    let selected =
        terminal.text_selected(vte::Format::Text).map(|text| text.to_string()).filter(|text| !text.trim().is_empty());
    let text = selected.unwrap_or_else(|| {
        let all = terminal.text_format(vte::Format::Text).map(|text| text.to_string()).unwrap_or_default();
        let lines: Vec<&str> = all.trim_end().lines().collect();
        lines[lines.len().saturating_sub(CONTEXT_LINES)..].join("\n")
    });
    if text.trim().is_empty() {
        app.toast("The terminal has no output to add yet.");
        return;
    }
    app.composer.extras.add_context("Terminal", text.trim_end());
    app.composer.focus();
}
