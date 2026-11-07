use std::cell::{Cell, RefCell};
use std::rc::Rc;

use adw::prelude::*;
use gtk::{gdk, gio, glib};
use local_studio_core::{Settings, ThreadStatus, Update};

use crate::app::App;
use crate::state::Page;

pub const NEW_THREAD_HERE: &str = "win.new-thread-here";
pub const TERMINAL_ACCELS: [&str; 5] =
    ["win.toggle-terminal", "win.focus-next", "win.focus-previous", "win.focus-cycle", "win.focus-cycle-back"];
pub const SCENES: [&str; 3] = ["vim-indicator", "sidebar-keyboard-focus", "timeline-focus"];

const RECENT_LIMIT: usize = 50;

type AppAction = fn(&Rc<App>);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Region {
    Sidebar,
    Timeline,
    Composer,
    Panel,
    Terminal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Nav {
    Up,
    Down,
    Left,
    Right,
    Enter,
    Space,
    Delete,
    Escape,
    Home,
    End,
    Text(char),
}

#[derive(Default)]
pub struct Keys {
    recent: RefCell<Vec<String>>,
    cycle: RefCell<Option<(Vec<String>, usize)>>,
    pending_g: Cell<bool>,
    region: Cell<Option<Region>>,
}

impl Keys {
    pub fn visited(&self, thread: Option<&str>) {
        let Some(thread) = thread else { return };
        if self.cycle.borrow().is_some() {
            return;
        }
        let mut recent = self.recent.borrow_mut();
        recent.retain(|known| known != thread);
        recent.insert(0, thread.to_string());
        recent.truncate(RECENT_LIMIT);
    }
}

pub fn install(app: &Rc<App>) {
    let plain: [(&str, AppAction); 13] = [
        ("new-thread-here", new_thread_here),
        ("thread-close", close_thread),
        ("thread-recent-next", |app| cycle_recent(app, 1)),
        ("thread-recent-previous", |app| cycle_recent(app, -1)),
        ("focus-next", |app| cycle_focus(app, 1)),
        ("focus-previous", |app| cycle_focus(app, -1)),
        ("focus-cycle", |app| cycle_focus(app, 1)),
        ("focus-cycle-back", |app| cycle_focus(app, -1)),
        ("focus-composer", |app| focus(app, Region::Composer)),
        ("panel-previous-tab", |app| app.panel.step_tab(-1)),
        ("panel-next-tab", |app| app.panel.step_tab(1)),
        ("timeline-copy-message", |app| {
            if !copy_message(app) {
                app.toast("Move to a message in the timeline first.");
            }
        }),
        ("vim-toggle", toggle_vim),
    ];
    for (name, activate) in plain {
        let action = gio::SimpleAction::new(name, None);
        let weak = Rc::downgrade(app);
        action.connect_activate(move |_, _| {
            if let Some(app) = weak.upgrade() {
                activate(&app);
            }
        });
        app.window.add_action(&action);
    }
    for (action, accels) in [
        (NEW_THREAD_HERE, &["<Control>t"][..]),
        ("win.thread-close", &["<Control>w"][..]),
        ("win.thread-recent-next", &["<Control>Tab"][..]),
        ("win.thread-recent-previous", &["<Control><Shift>Tab", "<Control><Shift>ISO_Left_Tab"][..]),
        ("win.focus-next", &["<Control><Alt>Right"][..]),
        ("win.focus-previous", &["<Control><Alt>Left"][..]),
        ("win.focus-cycle", &["F6"][..]),
        ("win.focus-cycle-back", &["<Shift>F6"][..]),
        ("win.focus-composer", &["<Control>l"][..]),
        ("win.panel-previous-tab", &["<Control><Super>Left"][..]),
        ("win.panel-next-tab", &["<Control><Super>Right"][..]),
        ("win.close-tab", &[][..]),
    ] {
        app.application.set_accels_for_action(action, accels);
    }
    install_release(app);
    install_panel_escape(app);
}

fn install_release(app: &Rc<App>) {
    let keys = gtk::EventControllerKey::new();
    keys.set_propagation_phase(gtk::PropagationPhase::Capture);
    let weak = Rc::downgrade(app);
    keys.connect_key_released(move |_, key, _, _| {
        if !matches!(key, gdk::Key::Control_L | gdk::Key::Control_R | gdk::Key::Super_L | gdk::Key::Super_R) {
            return;
        }
        if let Some(app) = weak.upgrade() {
            end_recent_cycle(&app);
        }
    });
    app.window.add_controller(keys);
    let weak = Rc::downgrade(app);
    app.window.connect_is_active_notify(move |window| {
        if window.is_active() {
            return;
        }
        if let Some(app) = weak.upgrade() {
            end_recent_cycle(&app);
        }
    });
}

fn install_panel_escape(app: &Rc<App>) {
    let keys = gtk::EventControllerKey::new();
    let weak = Rc::downgrade(app);
    keys.connect_key_pressed(move |_, key, _, modifiers| {
        let Some(app) = weak.upgrade() else { return glib::Propagation::Proceed };
        if key != gdk::Key::Escape || !plain(modifiers) {
            return glib::Propagation::Proceed;
        }
        let editing = gtk::prelude::GtkWindowExt::focus(&app.window)
            .is_some_and(|widget| widget.is::<gtk::Text>() || widget.is::<gtk::TextView>());
        if editing {
            return glib::Propagation::Proceed;
        }
        focus(&app, if has_thread(&app) { Region::Timeline } else { Region::Composer });
        glib::Propagation::Stop
    });
    app.panel.root.add_controller(keys);
}

pub fn plain(modifiers: gdk::ModifierType) -> bool {
    !modifiers.intersects(
        gdk::ModifierType::CONTROL_MASK
            | gdk::ModifierType::ALT_MASK
            | gdk::ModifierType::SUPER_MASK
            | gdk::ModifierType::META_MASK
            | gdk::ModifierType::HYPER_MASK,
    )
}

pub fn nav(key: gdk::Key, modifiers: gdk::ModifierType) -> Option<Nav> {
    if !plain(modifiers) {
        return None;
    }
    Some(match key {
        gdk::Key::Up | gdk::Key::KP_Up => Nav::Up,
        gdk::Key::Down | gdk::Key::KP_Down => Nav::Down,
        gdk::Key::Left | gdk::Key::KP_Left => Nav::Left,
        gdk::Key::Right | gdk::Key::KP_Right => Nav::Right,
        gdk::Key::Return | gdk::Key::KP_Enter | gdk::Key::ISO_Enter => Nav::Enter,
        gdk::Key::space | gdk::Key::KP_Space => Nav::Space,
        gdk::Key::BackSpace | gdk::Key::Delete | gdk::Key::KP_Delete => Nav::Delete,
        gdk::Key::Escape => Nav::Escape,
        gdk::Key::Home | gdk::Key::KP_Home => Nav::Home,
        gdk::Key::End | gdk::Key::KP_End => Nav::End,
        _ => Nav::Text(key.to_unicode().filter(|ch| !ch.is_control())?),
    })
}

fn vim_on(app: &App) -> bool {
    app.state.borrow().settings.vim_mode
}

fn has_thread(app: &App) -> bool {
    let state = app.state.borrow();
    state.page == Page::Thread && state.selected.is_some()
}

pub fn current(app: &App) -> Option<Region> {
    if let Some(widget) = gtk::prelude::GtkWindowExt::focus(&app.window) {
        let areas: [(Region, &gtk::Widget); 5] = [
            (Region::Composer, app.composer.root.upcast_ref()),
            (Region::Terminal, app.drawer.root.upcast_ref()),
            (Region::Panel, app.panel.root.upcast_ref()),
            (Region::Sidebar, app.sidebar.root.upcast_ref()),
            (Region::Timeline, app.timeline.root.upcast_ref()),
        ];
        for (region, area) in areas {
            if widget == *area || widget.is_ancestor(area) {
                return Some(region);
            }
        }
    }
    app.keys.region.get()
}

pub fn available(app: &App) -> Vec<Region> {
    let state = app.state.borrow();
    let mut regions = Vec::new();
    if app.split.shows_sidebar() {
        regions.push(Region::Sidebar);
    }
    if state.page != Page::Thread {
        return regions;
    }
    if state.selected.is_some() {
        regions.push(Region::Timeline);
    }
    regions.push(Region::Composer);
    if app.panel.root.is_visible() {
        regions.push(Region::Panel);
    }
    if app.drawer.root.is_visible() {
        regions.push(Region::Terminal);
    }
    regions
}

pub fn cycle_focus(app: &Rc<App>, offset: isize) {
    let order = available(app);
    let count = order.len();
    if count == 0 {
        return;
    }
    let index = current(app).and_then(|here| order.iter().position(|known| *known == here));
    let next = match index {
        Some(index) => (index + count).checked_add_signed(offset).map_or(0, |next| next % count),
        None if offset > 0 => 0,
        None => count - 1,
    };
    focus(app, order[next]);
}

pub fn focus(app: &Rc<App>, region: Region) {
    app.keys.pending_g.set(false);
    if region == Region::Timeline && !has_thread(app) {
        focus(app, Region::Composer);
        return;
    }
    app.sidebar.set_ring(region == Region::Sidebar);
    app.timeline.set_ring(region == Region::Timeline);
    match region {
        Region::Sidebar => {
            if !app.split.shows_sidebar() {
                app.split.set_show_sidebar(true);
            }
            app.sidebar.focus_list(app);
        }
        Region::Timeline => app.timeline.focus_list(&app.window),
        Region::Composer => {
            if app.state.borrow().page != Page::Thread {
                app.open_page(Page::Thread);
            }
            app.composer.focus();
        }
        Region::Panel => {
            if !app.panel.root.is_visible() {
                app.panel.toggle_panel();
            }
            app.panel.root.child_focus(gtk::DirectionType::TabForward);
        }
        Region::Terminal => app.drawer.show(app),
    }
    app.keys.region.set(Some(region));
}

pub fn focus_search(app: &Rc<App>) {
    if !app.split.shows_sidebar() {
        app.split.set_show_sidebar(true);
    }
    app.sidebar.set_ring(false);
    app.timeline.set_ring(false);
    app.keys.region.set(Some(Region::Sidebar));
    app.sidebar.focus_search();
}

pub fn composer_escape(app: &Rc<App>) -> bool {
    if !has_thread(app) {
        return false;
    }
    focus(app, Region::Timeline);
    true
}

fn new_thread_here(app: &Rc<App>) {
    let project = app.state.borrow().current_project();
    app.new_thread(project);
    focus(app, Region::Composer);
}

fn close_thread(app: &Rc<App>) {
    if app.panel.root.is_visible() {
        if !app.panel.close_active() {
            app.panel.hide();
        }
        return;
    }
    if !has_thread(app) {
        return;
    }
    let project = app.state.borrow().current_project();
    app.new_thread(project);
    focus(app, Region::Composer);
}

pub fn cycle_recent(app: &Rc<App>, step: isize) {
    let target = {
        let mut cycle = app.keys.cycle.borrow_mut();
        if cycle.is_none() {
            let state = app.state.borrow();
            let threads: Vec<String> = app
                .keys
                .recent
                .borrow()
                .iter()
                .filter(|id| state.threads.iter().any(|row| row.id == **id && !row.archived))
                .cloned()
                .collect();
            if threads.len() < 2 {
                return;
            }
            *cycle = Some((threads, 0));
        }
        let Some((threads, index)) = cycle.as_mut() else { return };
        let count = threads.len();
        *index = (*index + count).checked_add_signed(step).map_or(0, |next| next % count);
        threads[*index].clone()
    };
    app.select_thread(Some(target));
}

pub fn end_recent_cycle(app: &Rc<App>) {
    let ended = app.keys.cycle.borrow_mut().take().is_some();
    if ended {
        let selected = app.state.borrow().selected.clone();
        app.keys.visited(selected.as_deref());
    }
}

fn toggle_vim(app: &Rc<App>) {
    let on = !vim_on(app);
    crate::settings::change(app, |settings| settings.vim_mode = on);
    app.toast(if on { "Vim keys on" } else { "Vim keys off" });
}

pub fn copy_message(app: &Rc<App>) -> bool {
    let text = app.timeline.cursor_text();
    if text.trim().is_empty() {
        return false;
    }
    app.window.clipboard().set_text(&text);
    app.toast("Message copied");
    true
}

fn matches_binding(app: &App, command: &str, fallback: &str, key: gdk::Key, modifiers: gdk::ModifierType) -> bool {
    let shortcut = app
        .state
        .borrow()
        .keybindings
        .iter()
        .find(|binding| binding.command == command)
        .map_or_else(|| Some(fallback.to_string()), |binding| binding.shortcut.clone());
    let Some(shortcut) = shortcut else { return false };
    let accelerator = crate::format::accelerator(&shortcut);
    let Some((keyval, wanted)) = gtk::accelerator_parse(&accelerator) else { return false };
    let mask = gdk::ModifierType::CONTROL_MASK
        | gdk::ModifierType::ALT_MASK
        | gdk::ModifierType::SUPER_MASK
        | gdk::ModifierType::SHIFT_MASK
        | gdk::ModifierType::META_MASK;
    key.to_lower() == keyval.to_lower() && (modifiers & mask) == wanted
}

fn move_cursor(app: &Rc<App>, region: Region, offset: isize) {
    match region {
        Region::Sidebar => app.sidebar.move_cursor(offset),
        Region::Timeline => app.timeline.move_cursor(offset),
        Region::Composer | Region::Panel | Region::Terminal => {}
    }
}

fn cursor_edge(app: &Rc<App>, region: Region, top: bool) {
    match region {
        Region::Sidebar => app.sidebar.cursor_edge(top),
        Region::Timeline => app.timeline.cursor_edge(top),
        Region::Composer | Region::Panel | Region::Terminal => {}
    }
}

fn vim_list_key(app: &Rc<App>, input: char, region: Region) -> bool {
    if !vim_on(app) {
        return false;
    }
    let pending = app.keys.pending_g.replace(false);
    match input {
        'j' => move_cursor(app, region, 1),
        'k' => move_cursor(app, region, -1),
        'G' => cursor_edge(app, region, false),
        'g' => {
            if pending {
                cursor_edge(app, region, true);
            } else {
                app.keys.pending_g.set(true);
            }
        }
        'h' => cycle_focus(app, -1),
        'l' => cycle_focus(app, 1),
        '/' => focus_search(app),
        'i' | 'a' => focus(app, Region::Composer),
        _ => return false,
    }
    true
}

pub fn sidebar_key(app: &Rc<App>, nav: Nav) -> glib::Propagation {
    match nav {
        Nav::Down => app.sidebar.move_cursor(1),
        Nav::Up => app.sidebar.move_cursor(-1),
        Nav::Home => app.sidebar.cursor_edge(true),
        Nav::End => app.sidebar.cursor_edge(false),
        Nav::Right => cycle_focus(app, 1),
        Nav::Left => return glib::Propagation::Proceed,
        Nav::Enter => open_sidebar_cursor(app, false),
        Nav::Space => open_sidebar_cursor(app, true),
        Nav::Delete => archive_sidebar_cursor(app),
        Nav::Escape => focus(app, if has_thread(app) { Region::Timeline } else { Region::Composer }),
        Nav::Text(input) => {
            if !vim_list_key(app, input, Region::Sidebar) && !vim_on(app) {
                if input == '/' {
                    focus(app, Region::Composer);
                } else {
                    app.sidebar.type_search(input);
                }
            }
        }
    }
    glib::Propagation::Stop
}

pub fn search_key(app: &Rc<App>, key: gdk::Key, empty: bool) -> glib::Propagation {
    let leave = matches!(key, gdk::Key::Down | gdk::Key::KP_Down) || (key == gdk::Key::Escape && empty);
    if !leave {
        return glib::Propagation::Proceed;
    }
    focus(app, Region::Sidebar);
    glib::Propagation::Stop
}

fn open_sidebar_cursor(app: &Rc<App>, peek: bool) {
    let Some(thread) = app.sidebar.cursor_thread() else { return };
    app.sidebar.clear_marks();
    app.select_thread(Some(thread));
    if peek {
        app.sidebar.focus_list(app);
        app.keys.region.set(Some(Region::Sidebar));
    } else {
        focus(app, Region::Composer);
    }
}

fn archive_sidebar_cursor(app: &Rc<App>) {
    let Some(thread) = app.sidebar.cursor_thread() else { return };
    let working = app.state.borrow().row(&thread).is_some_and(|row| row.status == ThreadStatus::Working);
    if !working {
        crate::actions::confirm_archive(app, thread);
    }
}

pub fn timeline_key(app: &Rc<App>, key: gdk::Key, modifiers: gdk::ModifierType) -> glib::Propagation {
    if matches_binding(app, "timeline.copyMessage", "cmd+c", key, modifiers) {
        return if copy_message(app) { glib::Propagation::Stop } else { glib::Propagation::Proceed };
    }
    let Some(nav) = nav(key, modifiers) else { return glib::Propagation::Proceed };
    match nav {
        Nav::Down => app.timeline.move_cursor(1),
        Nav::Up => app.timeline.move_cursor(-1),
        Nav::Home => app.timeline.cursor_edge(true),
        Nav::End => app.timeline.cursor_edge(false),
        Nav::Left => cycle_focus(app, -1),
        Nav::Right | Nav::Delete => return glib::Propagation::Proceed,
        Nav::Enter | Nav::Space => app.timeline.activate_cursor(),
        Nav::Escape => focus(app, Region::Composer),
        Nav::Text(input) => {
            if !vim_list_key(app, input, Region::Timeline) && !vim_on(app) {
                focus(app, Region::Composer);
                if input != '/' {
                    let view = app.composer.view();
                    view.buffer().insert_interactive_at_cursor(&input.to_string(), view.is_editable());
                }
            }
        }
    }
    glib::Propagation::Stop
}

pub fn stage(app: &Rc<App>, scene: &str) {
    match scene {
        "vim-indicator" => {
            crate::fixtures::conversation(app, false);
            app.apply(vec![Update::Settings { settings: Settings { vim_mode: true, ..Settings::default() } }]);
            app.composer.set_text("Keep the sidebar toggle visible\nwhen the window is narrow");
            focus(app, Region::Composer);
            crate::vim::vim_feed(app, "\u{1b}gg");
        }
        "sidebar-keyboard-focus" => {
            crate::fixtures::conversation(app, false);
            later(app, |app| {
                focus(app, Region::Sidebar);
                app.sidebar.move_cursor(2);
            });
        }
        "timeline-focus" => {
            crate::fixtures::conversation(app, false);
            later(app, |app| {
                focus(app, Region::Timeline);
                app.timeline.move_cursor(-2);
            });
        }
        _ => {}
    }
}

fn later(app: &Rc<App>, run: fn(&Rc<App>)) {
    let weak = Rc::downgrade(app);
    glib::timeout_add_local_once(std::time::Duration::from_millis(350), move || {
        if let Some(app) = weak.upgrade() {
            run(&app);
        }
    });
}
