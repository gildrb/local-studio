use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use adw::prelude::*;
use gtk::{gdk, gio, pango};
use local_studio_core::{TerminalFrame, TerminalSize};

use crate::app::{App, Target};
use crate::terminal::{Input, Sink, TerminalView};

const CONTEXT_LINES: u32 = 40;
const RECENT_LINES: u32 = 200;
const PREVIEW_COLS: u16 = 100;
const PREVIEW_ROWS: u16 = 14;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Layout {
    Stacked,
    SideBySide,
}

pub struct Pane {
    pub view: TerminalView,
    root: gtk::Overlay,
    status: gtk::Label,
    id: Rc<RefCell<Option<String>>>,
    request: RefCell<Option<String>>,
    size: Rc<Cell<Option<TerminalSize>>>,
    has_selection: Cell<bool>,
}

pub struct Drawer {
    pub root: gtk::Box,
    area: adw::Bin,
    empty: gtk::Box,
    panes: RefCell<Vec<Rc<Pane>>>,
    layout: Cell<Layout>,
    focused: Cell<usize>,
    font: RefCell<pango::FontDescription>,
    blink: Cell<bool>,
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
        Self {
            root,
            area,
            empty,
            panes: RefCell::new(Vec::new()),
            layout: Cell::new(Layout::SideBySide),
            focused: Cell::new(0),
            font: RefCell::new(pango::FontDescription::from_string("Monospace 10")),
            blink: Cell::new(true),
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
            pane.view.area.grab_focus();
        }
    }

    pub fn set_font(&self, family: &str, size: u32) {
        let family = if family.trim().is_empty() { "Monospace" } else { family.trim() };
        let font = pango::FontDescription::from_string(&format!("{family} {size}"));
        for pane in self.panes.borrow().iter() {
            pane.view.set_font(&font);
        }
        self.font.replace(font);
    }

    pub fn set_blink(&self, enabled: bool) {
        self.blink.set(enabled);
        for pane in self.panes.borrow().iter() {
            pane.view.set_blink(enabled);
        }
    }

    pub fn set_colors(&self, colors: &crate::colors::Colors) {
        for pane in self.panes.borrow().iter() {
            pane.view.set_colors(colors);
        }
    }

    fn attach(&self, layout: Layout) -> Rc<Pane> {
        let pane = self.pane();
        self.layout.set(layout);
        self.panes.borrow_mut().push(Rc::clone(&pane));
        self.focused.set(self.panes.borrow().len() - 1);
        self.relayout();
        self.root.set_visible(true);
        pane.view.area.grab_focus();
        pane
    }

    pub fn add(&self, app: &Rc<App>, layout: Layout) {
        let pane = self.attach(layout);
        let dir = app.state.borrow().workspace_dir();
        let Some(dir) = dir else {
            pane.status.set_label("Open a project thread to start a shell in it.");
            pane.status.set_visible(true);
            return;
        };
        let request = app.core.request();
        pane.request.replace(Some(request.clone()));
        let (cols, rows) = pane.view.grid();
        app.core.run(|studio| studio.open_terminal(request, dir, cols, rows));
    }

    pub fn run_script(&self, app: &Rc<App>, project: &str, script: &str) {
        let pane = self.attach(Layout::SideBySide);
        let name = app
            .state
            .borrow()
            .scripts
            .get(project)
            .and_then(|scripts| scripts.iter().find(|known| known.id == script).map(|known| known.name.clone()))
            .unwrap_or_else(|| script.to_string());
        pane.status.set_label(&format!("▶ {name}"));
        pane.status.set_visible(true);
        let request = app.core.request();
        pane.request.replace(Some(request.clone()));
        let (project, script) = (project.to_string(), script.to_string());
        app.core.run(|studio| studio.run_project_script(request, project, script));
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
            pane.view.area.grab_focus();
        }
    }

    fn relayout(&self) {
        let panes = self.panes.borrow();
        let widgets: Vec<gtk::Widget> = panes.iter().map(|pane| pane.root.clone().upcast()).collect();
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

    fn pane(&self) -> Rc<Pane> {
        let id: Rc<RefCell<Option<String>>> = Rc::new(RefCell::new(None));
        let size: Rc<Cell<Option<TerminalSize>>> = Rc::new(Cell::new(None));
        let sink: Sink = {
            let (weak, id, size) = (self.app.clone(), Rc::clone(&id), Rc::clone(&size));
            Rc::new(move |input| {
                if let Some(app) = weak.upgrade() {
                    handle(&app, &id, &size, input);
                }
            })
        };
        let view = TerminalView::new(&crate::colors::current(), &sink);
        view.set_font(&self.font.borrow());
        view.set_blink(self.blink.get());
        let status = gtk::Label::new(None);
        status.add_css_class("ls-terminal-status");
        status.set_halign(gtk::Align::End);
        status.set_valign(gtk::Align::End);
        status.set_margin_end(10);
        status.set_margin_bottom(8);
        status.set_can_target(false);
        status.set_visible(false);
        let root = gtk::Overlay::new();
        root.set_child(Some(&view.area));
        root.add_overlay(&status);
        let actions = gio::SimpleActionGroup::new();
        for name in ["copy", "paste", "copy-recent", "add-to-chat"] {
            let action = gio::SimpleAction::new(name, None);
            let (weak, id) = (self.app.clone(), Rc::clone(&id));
            action.connect_activate(move |action, _| {
                if let Some(app) = weak.upgrade() {
                    command(&app, &id, action.name().as_str());
                }
            });
            actions.add_action(&action);
        }
        root.insert_action_group("term", Some(&actions));
        Rc::new(Pane { view, root, status, id, request: RefCell::new(None), size, has_selection: Cell::new(false) })
    }

    fn pane_by_id(&self, terminal: &str) -> Option<Rc<Pane>> {
        self.panes.borrow().iter().find(|pane| pane.id.borrow().as_deref() == Some(terminal)).cloned()
    }

    fn pane_for(&self, id: &Rc<RefCell<Option<String>>>) -> Option<(usize, Rc<Pane>)> {
        self.panes
            .borrow()
            .iter()
            .enumerate()
            .find(|(_, pane)| Rc::ptr_eq(&pane.id, id))
            .map(|(index, pane)| (index, Rc::clone(pane)))
    }

    pub fn opened(&self, request: &str, terminal: &str) -> bool {
        let pane = self.panes.borrow().iter().find(|pane| pane.request.borrow().as_deref() == Some(request)).cloned();
        let Some(pane) = pane else { return false };
        pane.request.replace(None);
        pane.id.replace(Some(terminal.to_string()));
        if let Some(app) = self.app.upgrade() {
            let size = pane.size.get().unwrap_or_else(|| pane.view.size());
            let id = terminal.to_string();
            app.core.run(|studio| studio.resize_terminal(id, size));
            if pane.view.area.has_focus() {
                let id = terminal.to_string();
                app.core.run(|studio| studio.terminal_focus(id, true));
            }
        }
        true
    }

    pub fn frame(&self, terminal: &str, frame: &TerminalFrame) {
        if let Some(pane) = self.pane_by_id(terminal) {
            pane.has_selection.set(frame.has_selection);
            if let Some(title) = frame.title.as_deref().filter(|title| !title.is_empty()) {
                pane.root.set_tooltip_text(Some(title));
            }
            pane.view.apply(frame);
        }
    }

    pub fn exited(&self, terminal: &str, code: Option<i32>) {
        let Some(pane) = self.pane_by_id(terminal) else { return };
        pane.id.replace(None);
        pane.status.set_label(&match code {
            Some(code) if code != 0 => format!("Process exited with code {code}"),
            _ => "Process exited".to_string(),
        });
        pane.status.set_visible(true);
    }

    pub fn text_arrived(app: &Rc<App>, target: Target, text: &str) {
        match target {
            Target::TerminalCopy => {
                if text.is_empty() {
                    app.toast("Nothing to copy.");
                } else {
                    app.window.clipboard().set_text(text);
                }
            }
            _ => add_to_chat(app, text),
        }
    }

    pub fn focused_text(&self) -> String {
        self.panes.borrow().get(self.focused.get()).map(|pane| pane.view.text()).unwrap_or_default()
    }

    pub fn type_text(&self, app: &Rc<App>, text: &str) {
        let id = self.panes.borrow().get(self.focused.get()).and_then(|pane| pane.id.borrow().clone());
        let Some(id) = id else { return };
        for ch in text.chars() {
            let (id, key) = (id.clone(), crate::terminal::text_key(&ch.to_string()));
            app.core.run(|studio| studio.terminal_key(id, key));
        }
        let key = crate::terminal::return_key();
        app.core.run(|studio| studio.terminal_key(id, key));
    }

    pub fn add_focused_to_chat(&self, app: &Rc<App>) {
        let pane = self.panes.borrow().get(self.focused.get()).cloned();
        if let Some(pane) = pane {
            command(app, &pane.id, "add-to-chat");
        }
    }

    pub fn fixture(&self, texts: &[&str], layout: Layout) {
        self.panes.borrow_mut().clear();
        self.layout.set(layout);
        for text in texts {
            let pane = self.pane();
            if let Some(frame) =
                local_studio_core::terminal_preview(PREVIEW_COLS, PREVIEW_ROWS, text.as_bytes().to_vec())
            {
                pane.view.apply(&frame);
            }
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

fn handle(app: &Rc<App>, id: &Rc<RefCell<Option<String>>>, size: &Rc<Cell<Option<TerminalSize>>>, input: Input) {
    let terminal = id.borrow().clone();
    match input {
        Input::Key(key) => {
            if let Some(terminal) = terminal {
                app.core.run(|studio| studio.terminal_key(terminal, key));
            }
        }
        Input::Mouse(mouse) => {
            if let Some(terminal) = terminal {
                app.core.run(|studio| studio.terminal_mouse(terminal, mouse));
            }
        }
        Input::Scroll(scroll) => {
            if let Some(terminal) = terminal {
                app.core.run(|studio| studio.terminal_scroll(terminal, scroll));
            }
        }
        Input::Focus(focused) => {
            if focused {
                if let Some((index, _)) = app.drawer.pane_for(id) {
                    app.drawer.focused.set(index);
                }
            }
            app.terminal_focus(focused);
            if let Some(terminal) = terminal {
                app.core.run(|studio| studio.terminal_focus(terminal, focused));
            }
        }
        Input::Resize(next) => {
            size.set(Some(next));
            if let Some(terminal) = terminal {
                app.core.run(|studio| studio.resize_terminal(terminal, next));
            }
        }
        Input::Menu(x, y) => {
            let Some((_, pane)) = app.drawer.pane_for(id) else { return };
            let model = gio::Menu::new();
            model.append(Some("Add to Chat"), Some("term.add-to-chat"));
            model.append(Some("Copy"), Some("term.copy"));
            model.append(Some("Paste"), Some("term.paste"));
            model.append(Some("Copy Recent Output"), Some("term.copy-recent"));
            crate::actions::popup_menu(&pane.root, &model, x, y);
        }
        Input::Shortcut(key) => match key {
            gdk::Key::c => command(app, id, "copy"),
            gdk::Key::v => command(app, id, "paste"),
            gdk::Key::t => app.drawer.add(app, app.drawer.layout.get()),
            gdk::Key::d => app.drawer.add(app, Layout::SideBySide),
            gdk::Key::e => app.drawer.add(app, Layout::Stacked),
            gdk::Key::w => app.drawer.close_focused(app),
            _ => command(app, id, "add-to-chat"),
        },
    }
}

fn command(app: &Rc<App>, id: &Rc<RefCell<Option<String>>>, name: &str) {
    let terminal = id.borrow().clone();
    let selected = app.drawer.pane_for(id).is_some_and(|(_, pane)| pane.has_selection.get());
    let Some(terminal) = terminal else {
        let text = app.drawer.pane_for(id).map(|(_, pane)| pane.view.text()).unwrap_or_default();
        match name {
            "copy" | "copy-recent" => app.window.clipboard().set_text(&text),
            "add-to-chat" => add_to_chat(app, &text),
            _ => {}
        }
        return;
    };
    match name {
        "paste" => {
            let weak = Rc::downgrade(app);
            app.window.clipboard().read_text_async(None::<&gio::Cancellable>, move |result| {
                let (Some(app), Ok(Some(text))) = (weak.upgrade(), result) else { return };
                let text = text.to_string();
                app.core.run(|studio| studio.terminal_paste(terminal, text));
            });
        }
        "copy" => {
            let request = app.ask(Target::TerminalCopy);
            app.core.run(|studio| studio.terminal_selection_text(request, terminal));
        }
        "copy-recent" => {
            let request = app.ask(Target::TerminalCopy);
            app.core.run(|studio| studio.terminal_recent_output(request, terminal, RECENT_LINES));
        }
        _ => {
            let request = app.ask(Target::TerminalChat);
            if selected {
                app.core.run(|studio| studio.terminal_selection_text(request, terminal));
            } else {
                app.core.run(|studio| studio.terminal_recent_output(request, terminal, CONTEXT_LINES));
            }
        }
    }
}

fn add_to_chat(app: &Rc<App>, text: &str) {
    let text = text.trim_end();
    if text.trim().is_empty() {
        app.toast("The terminal has no output to add yet.");
        return;
    }
    app.composer.extras.add_context("Terminal", text);
    app.composer.focus();
}
