use std::cell::RefCell;
use std::rc::Weak;

use adw::prelude::*;
use gtk::{gdk, gio, glib};

use crate::app::App;
use crate::diffview::DiffView;
use crate::surfaces::{AgentsSurface, BrowserSurface, DevicesSurface, FilesSurface, PullsSurface};

pub const SURFACES: [(&str, &str, &str, char); 7] = [
    ("browser", "Browser", "web-browser-symbolic", 'b'),
    ("terminal", "Terminal", "utilities-terminal-symbolic", 't'),
    ("files", "Files", "folder-symbolic", 'f'),
    ("diff", "Diff", "view-dual-symbolic", 'd'),
    ("pulls", "Pull requests", "preferences-system-sharing-symbolic", 'p'),
    ("agents", "Agents", "avatar-default-symbolic", 'a'),
    ("devices", "Device", "phone-symbolic", 'm'),
];

pub struct Panel {
    pub root: gtk::Box,
    strip: gtk::Box,
    stack: gtk::Stack,
    launcher: gtk::Box,
    maximize: gtk::ToggleButton,
    open: RefCell<Vec<&'static str>>,
    active: RefCell<Option<&'static str>>,
    pub diff: DiffView,
    pub files: FilesSurface,
    pub pulls: PullsSurface,
    pub agents: AgentsSurface,
    pub devices: DevicesSurface,
    pub browser: BrowserSurface,
    app: Weak<App>,
}

impl Panel {
    #[allow(clippy::too_many_lines)]
    pub fn new(app: Weak<App>) -> Self {
        let root = gtk::Box::new(gtk::Orientation::Vertical, 0);
        root.add_css_class("ls-panel");
        root.set_size_request(360, -1);
        root.set_visible(false);
        let strip = gtk::Box::new(gtk::Orientation::Horizontal, 2);
        let strip_scroller = gtk::ScrolledWindow::builder()
            .vscrollbar_policy(gtk::PolicyType::Never)
            .hexpand(true)
            .child(&strip)
            .build();
        let add = gtk::MenuButton::builder().icon_name("list-add-symbolic").tooltip_text("Open a Surface").build();
        add.add_css_class("flat");
        let menu = gio::Menu::new();
        for (kind, title, _, letter) in SURFACES {
            let item = gio::MenuItem::new(Some(&format!("{title}  ({})", letter.to_ascii_uppercase())), None);
            item.set_action_and_target_value(Some("win.panel-open"), Some(&kind.to_variant()));
            menu.append_item(&item);
        }
        add.set_menu_model(Some(&menu));
        let refresh = gtk::Button::builder().icon_name("view-refresh-symbolic").tooltip_text("Refresh").build();
        refresh.add_css_class("flat");
        let maximize =
            gtk::ToggleButton::builder().icon_name("view-fullscreen-symbolic").tooltip_text("Maximize Panel").build();
        maximize.add_css_class("flat");
        let close = gtk::Button::builder().icon_name("window-close-symbolic").tooltip_text("Hide Panel").build();
        close.add_css_class("flat");
        let bar = gtk::Box::new(gtk::Orientation::Horizontal, 4);
        bar.add_css_class("ls-panel-bar");
        bar.append(&strip_scroller);
        bar.append(&add);
        bar.append(&refresh);
        bar.append(&maximize);
        bar.append(&close);

        let launcher = gtk::Box::new(gtk::Orientation::Vertical, 4);
        launcher.add_css_class("ls-launcher");
        launcher.set_valign(gtk::Align::Center);
        launcher.set_halign(gtk::Align::Center);
        launcher.set_focusable(true);
        let heading = gtk::Label::new(Some("Open a surface"));
        heading.add_css_class("title-4");
        heading.set_margin_bottom(8);
        launcher.append(&heading);
        for (kind, title, icon, letter) in SURFACES {
            let row = gtk::Box::new(gtk::Orientation::Horizontal, 10);
            row.append(&gtk::Image::from_icon_name(icon));
            let label = gtk::Label::new(Some(title));
            label.set_hexpand(true);
            label.set_xalign(0.0);
            row.append(&label);
            let key = gtk::Label::new(Some(&letter.to_ascii_uppercase().to_string()));
            key.add_css_class("ls-keycap");
            row.append(&key);
            let button = gtk::Button::builder().child(&row).action_name("win.panel-open").build();
            button.set_action_target_value(Some(&kind.to_variant()));
            button.add_css_class("flat");
            button.set_size_request(260, -1);
            launcher.append(&button);
        }
        let keys = gtk::EventControllerKey::new();
        let weak = app.clone();
        keys.connect_key_pressed(move |_, key, _, modifiers| {
            if !modifiers.is_empty() {
                return glib::Propagation::Proceed;
            }
            let Some(app) = weak.upgrade() else { return glib::Propagation::Proceed };
            let Some(letter) = key.to_unicode().map(|letter| letter.to_ascii_lowercase()) else {
                return glib::Propagation::Proceed;
            };
            match SURFACES.iter().find(|surface| surface.3 == letter) {
                Some((kind, ..)) => {
                    app.open_surface(kind);
                    glib::Propagation::Stop
                }
                None => glib::Propagation::Proceed,
            }
        });
        launcher.add_controller(keys);

        let diff = DiffView::new(&app);
        let files = FilesSurface::new(&app);
        let pulls = PullsSurface::new(&app);
        let agents = AgentsSurface::new();
        let devices = DevicesSurface::new(&app);
        let browser = BrowserSurface::new();
        let stack = gtk::Stack::new();
        stack.add_named(&launcher, Some("launcher"));
        stack.add_named(&diff.root, Some("diff"));
        stack.add_named(&files.root, Some("files"));
        stack.add_named(&pulls.root, Some("pulls"));
        stack.add_named(&agents.root, Some("agents"));
        stack.add_named(&devices.root, Some("devices"));
        stack.add_named(&browser.root, Some("browser"));
        root.append(&bar);
        root.append(&gtk::Separator::new(gtk::Orientation::Horizontal));
        root.append(&stack);

        let weak = app.clone();
        refresh.connect_clicked(move |_| {
            let Some(app) = weak.upgrade() else { return };
            let active = *app.panel.active.borrow();
            if let Some(kind) = active {
                app.panel.refresh(kind, true);
            }
        });
        let weak = app.clone();
        maximize.connect_toggled(move |button| {
            if let Some(app) = weak.upgrade() {
                app.set_panel_maximized(button.is_active());
            }
        });
        let weak = app.clone();
        close.connect_clicked(move |_| {
            if let Some(app) = weak.upgrade() {
                app.panel.hide();
            }
        });
        Self {
            root,
            strip,
            stack,
            launcher,
            maximize,
            open: RefCell::new(Vec::new()),
            active: RefCell::new(None),
            diff,
            files,
            pulls,
            agents,
            devices,
            browser,
            app,
        }
    }

    pub fn hide(&self) {
        self.maximize.set_active(false);
        self.root.set_visible(false);
    }

    pub fn toggle_panel(&self) {
        if self.root.is_visible() {
            self.hide();
            return;
        }
        self.root.set_visible(true);
        let active = *self.active.borrow();
        match active {
            Some(kind) => self.activate(kind),
            None => self.show_launcher(),
        }
    }

    pub fn launcher_visible(&self) -> bool {
        self.root.is_visible() && self.active.borrow().is_none()
    }

    pub fn toggle(&self, kind: &'static str) {
        if self.showing(kind) {
            self.hide();
            return;
        }
        self.show(kind);
    }

    pub fn showing(&self, kind: &str) -> bool {
        self.root.is_visible() && *self.active.borrow() == Some(kind).and_then(canonical)
    }

    pub fn show(&self, kind: &str) {
        let Some(kind) = canonical(kind) else { return };
        self.root.set_visible(true);
        if !self.open.borrow().contains(&kind) {
            self.open.borrow_mut().push(kind);
        }
        self.activate(kind);
    }

    fn activate(&self, kind: &'static str) {
        self.active.replace(Some(kind));
        self.stack.set_visible_child_name(kind);
        self.render_strip();
        self.refresh(kind, false);
        if kind == "browser" {
            self.browser.focus();
        }
    }

    fn show_launcher(&self) {
        self.active.replace(None);
        self.stack.set_visible_child_name("launcher");
        self.render_strip();
        if self.root.is_visible() {
            self.launcher.grab_focus();
        }
    }

    pub fn close_tab(&self, kind: &str) {
        let position = self.open.borrow().iter().position(|open| *open == kind);
        let Some(position) = position else { return };
        self.open.borrow_mut().remove(position);
        let was_active = self.active.borrow().is_some_and(|active| active == kind);
        if was_active {
            let next = {
                let open = self.open.borrow();
                open.get(position).or_else(|| open.get(position.wrapping_sub(1))).copied()
            };
            match next {
                Some(next) => self.activate(next),
                None => self.show_launcher(),
            }
        } else {
            self.render_strip();
        }
    }

    pub fn close_active(&self) -> bool {
        let active = *self.active.borrow();
        match active {
            Some(kind) if self.root.is_visible() => {
                self.close_tab(kind);
                true
            }
            _ => false,
        }
    }

    pub fn close_where(&self, keep: impl Fn(usize, &str) -> bool) {
        let kept: Vec<&'static str> = self
            .open
            .borrow()
            .iter()
            .enumerate()
            .filter(|(index, kind)| keep(*index, kind))
            .map(|(_, kind)| *kind)
            .collect();
        self.open.replace(kept);
        let active = *self.active.borrow();
        match active {
            Some(kind) if self.open.borrow().contains(&kind) => self.render_strip(),
            _ => {
                let first = self.open.borrow().first().copied();
                match first {
                    Some(first) => self.activate(first),
                    None => self.show_launcher(),
                }
            }
        }
    }

    pub fn index_of(&self, kind: &str) -> Option<usize> {
        self.open.borrow().iter().position(|open| *open == kind)
    }

    pub fn step_tab(&self, offset: isize) {
        let open = self.open.borrow().clone();
        let count = open.len();
        if count == 0 {
            return;
        }
        let active = *self.active.borrow();
        let current = active.and_then(|active| open.iter().position(|kind| *kind == active)).unwrap_or(0);
        let next = (current + count).checked_add_signed(offset).map_or(0, |next| next % count);
        self.root.set_visible(true);
        self.activate(open[next]);
    }

    pub fn set_maximized(&self, maximized: bool) {
        if self.maximize.is_active() != maximized {
            self.maximize.set_active(maximized);
        }
    }

    fn render_strip(&self) {
        while let Some(child) = self.strip.first_child() {
            self.strip.remove(&child);
        }
        let active = *self.active.borrow();
        for kind in self.open.borrow().iter().copied() {
            let Some((_, title, icon, _)) = SURFACES.iter().find(|surface| surface.0 == kind) else { continue };
            let tab = gtk::Box::new(gtk::Orientation::Horizontal, 4);
            tab.add_css_class("ls-tab");
            if active == Some(kind) {
                tab.add_css_class("active");
            }
            let image = gtk::Image::from_icon_name(icon);
            image.set_pixel_size(14);
            tab.append(&image);
            tab.append(&gtk::Label::new(Some(title)));
            let close = gtk::Button::builder()
                .icon_name("window-close-symbolic")
                .tooltip_text("Close Tab (Ctrl+W)")
                .action_name("win.panel-close")
                .build();
            close.set_action_target_value(Some(&kind.to_variant()));
            close.add_css_class("flat");
            close.add_css_class("ls-tab-close");
            tab.append(&close);
            let click = gtk::GestureClick::builder().button(0).build();
            let weak = self.app.clone();
            let holder = tab.downgrade();
            click.connect_pressed(move |gesture, _, x, y| {
                let (Some(app), Some(tab)) = (weak.upgrade(), holder.upgrade()) else { return };
                if gesture.current_button() == gdk::BUTTON_SECONDARY {
                    crate::actions::popup_menu(&tab, &tab_menu(kind), x, y);
                } else {
                    app.panel.activate(kind);
                }
            });
            tab.add_controller(click);
            self.strip.append(&tab);
        }
    }

    pub fn refresh(&self, kind: &str, force: bool) {
        let Some(app) = self.app.upgrade() else { return };
        match kind {
            "diff" => self.diff.refresh(&app),
            "files" => self.files.open(&app, force),
            "pulls" => self.pulls.open(&app, force),
            "agents" => self.agents.render(&app),
            "devices" => self.devices.refresh(&app),
            _ => {}
        }
    }
}

fn canonical(kind: &str) -> Option<&'static str> {
    SURFACES.iter().map(|surface| surface.0).find(|known| *known == kind && *known != "terminal")
}

fn tab_menu(kind: &str) -> gio::Menu {
    let menu = gio::Menu::new();
    let target = kind.to_variant();
    let section = gio::Menu::new();
    if kind == "files" {
        section.append(Some("Copy Path"), Some("win.panel-copy-path"));
    }
    for (label, action) in [
        ("Close", "win.panel-close"),
        ("Close Others", "win.panel-close-others"),
        ("Close to the Right", "win.panel-close-right"),
    ] {
        let item = gio::MenuItem::new(Some(label), None);
        item.set_action_and_target_value(Some(action), Some(&target));
        section.append_item(&item);
    }
    section.append(Some("Close All"), Some("win.panel-close-all"));
    menu.append_section(None, &section);
    menu
}
