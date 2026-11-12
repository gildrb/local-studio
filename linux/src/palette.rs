use std::cell::{Cell, RefCell};
use std::rc::Rc;

use adw::prelude::*;
use gtk::{gdk, gio, glib, graphene};

use crate::app::App;
use crate::format;
use crate::state::State;

#[derive(Clone)]
struct Entry {
    group: &'static str,
    title: String,
    subtitle: String,
    action: String,
    target: Option<String>,
}

impl Entry {
    fn new(group: &'static str, title: &str, subtitle: &str, action: &str, target: Option<String>) -> Self {
        Self { group, title: title.to_string(), subtitle: subtitle.to_string(), action: action.to_string(), target }
    }

    fn matches(&self, query: &str) -> bool {
        query.is_empty() || self.title.to_lowercase().contains(query) || self.subtitle.to_lowercase().contains(query)
    }
}

pub fn open(app: &Rc<App>) {
    let mut entries = entries(&app.state.borrow());
    entries.retain(|entry| enabled(app, &entry.action));
    let search = gtk::SearchEntry::builder()
        .placeholder_text("Search actions, threads and projects")
        .search_delay(0)
        .hexpand(true)
        .build();
    search.add_css_class("ls-palette-search");
    let list = gtk::ListBox::new();
    list.add_css_class("ls-palette-list");
    list.set_selection_mode(gtk::SelectionMode::Single);
    list.set_focusable(false);
    let scroller = gtk::ScrolledWindow::builder()
        .hscrollbar_policy(gtk::PolicyType::Never)
        .propagate_natural_height(true)
        .max_content_height(400)
        .child(&list)
        .build();
    let column = gtk::Box::new(gtk::Orientation::Vertical, 0);
    column.set_size_request(600, -1);
    column.append(&search);
    column.append(&gtk::Separator::new(gtk::Orientation::Horizontal));
    column.append(&scroller);
    let popover =
        gtk::Popover::builder().child(&column).has_arrow(false).position(gtk::PositionType::Bottom).build();
    popover.add_css_class("ls-palette");
    popover.set_parent(&app.toasts);
    popover.set_pointing_to(Some(&gdk::Rectangle::new(app.toasts.width() / 2, 60, 1, 1)));
    popover.connect_closed(|popover| {
        let popover = popover.clone();
        glib::idle_add_local_once(move || popover.unparent());
    });

    let visible: Rc<RefCell<Vec<Entry>>> = Rc::default();
    let headers = Rc::clone(&visible);
    list.set_header_func(move |row, before| {
        let visible = headers.borrow();
        let group = usize::try_from(row.index()).ok().and_then(|index| visible.get(index)).map(|entry| entry.group);
        let previous = before
            .and_then(|before| usize::try_from(before.index()).ok())
            .and_then(|index| visible.get(index))
            .map(|entry| entry.group);
        match group.filter(|group| Some(*group) != previous) {
            Some(group) => {
                let label = gtk::Label::new(Some(group));
                label.add_css_class("ls-palette-group");
                label.set_xalign(0.0);
                row.set_header(Some(&label));
            }
            None => row.set_header(None::<&gtk::Widget>),
        }
    });
    fill(&list, &scroller, &entries, "", &visible);
    let refill_list = list.clone();
    let refill_scroller = scroller.clone();
    let refill_visible = Rc::clone(&visible);
    search.connect_search_changed(move |search| {
        fill(&refill_list, &refill_scroller, &entries, &search.text().to_lowercase(), &refill_visible);
    });

    let keys = gtk::EventControllerKey::new();
    keys.set_propagation_phase(gtk::PropagationPhase::Capture);
    let key_list = list.clone();
    let key_scroller = scroller.clone();
    let key_popover = popover.clone();
    let key_visible = Rc::clone(&visible);
    keys.connect_key_pressed(move |_, key, _, modifiers| {
        let control = modifiers.contains(gdk::ModifierType::CONTROL_MASK);
        let current = key_list.selected_row().map_or(0, |row| row.index());
        let last = i32::try_from(key_visible.borrow().len()).unwrap_or(i32::MAX) - 1;
        let page = page_rows(&key_list, &key_scroller);
        let target = match key {
            gdk::Key::Escape => {
                key_popover.popdown();
                return glib::Propagation::Stop;
            }
            gdk::Key::Down | gdk::Key::KP_Down => current + 1,
            gdk::Key::Up | gdk::Key::KP_Up => current - 1,
            gdk::Key::n | gdk::Key::N if control => current + 1,
            gdk::Key::p | gdk::Key::P if control => current - 1,
            gdk::Key::Page_Down | gdk::Key::KP_Page_Down => current + page,
            gdk::Key::Page_Up | gdk::Key::KP_Page_Up => current - page,
            gdk::Key::Home | gdk::Key::KP_Home => 0,
            gdk::Key::End | gdk::Key::KP_End => last,
            _ => return glib::Propagation::Proceed,
        };
        if last >= 0 {
            select(&key_list, &key_scroller, target.clamp(0, last));
        }
        glib::Propagation::Stop
    });
    search.add_controller(keys);

    let pointer: Rc<Cell<Option<(f64, f64)>>> = Rc::default();
    let motion = gtk::EventControllerMotion::new();
    let resting = Rc::clone(&pointer);
    motion.connect_enter(move |_, x, y| {
        resting.set(Some((x, y)));
    });
    let hover_list = list.clone();
    let hover_column = column.clone();
    motion.connect_motion(move |_, x, y| {
        let previous = pointer.replace(Some((x, y)));
        if previous.is_none_or(|point| point == (x, y)) {
            return;
        }
        #[allow(clippy::cast_possible_truncation)]
        let point = graphene::Point::new(x as f32, y as f32);
        let Some(point) = hover_column.compute_point(&hover_list, &point) else { return };
        #[allow(clippy::cast_possible_truncation)]
        let row = hover_list.row_at_y(point.y() as i32);
        if let Some(row) = row.filter(|row| !row.is_selected()) {
            hover_list.select_row(Some(&row));
        }
    });
    column.add_controller(motion);

    let weak = Rc::downgrade(app);
    let run = Rc::new(move |popover: &gtk::Popover, entry: &Entry| {
        popover.popdown();
        if let Some(app) = weak.upgrade() {
            let detailed = format!("win.{}", entry.action);
            let (name, parsed) = gio::Action::parse_detailed_name(&detailed)
                .map_or_else(|_| (detailed.clone(), None), |(name, target)| (name.to_string(), target));
            let target = entry.target.as_ref().map(ToVariant::to_variant).or(parsed);
            WidgetExt::activate_action(&app.window, &name, target.as_ref()).ok();
        }
    });
    let activate_list = list.clone();
    let activate_visible = Rc::clone(&visible);
    let activate_popover = popover.clone();
    let activate_run = Rc::clone(&run);
    search.connect_activate(move |_| {
        let index = activate_list.selected_row().map_or(0, |row| row.index());
        let entry = usize::try_from(index).ok().and_then(|index| activate_visible.borrow().get(index).cloned());
        if let Some(entry) = entry {
            activate_run(&activate_popover, &entry);
        }
    });
    let row_popover = popover.clone();
    list.connect_row_activated(move |_, row| {
        let entry = usize::try_from(row.index()).ok().and_then(|index| visible.borrow().get(index).cloned());
        if let Some(entry) = entry {
            run(&row_popover, &entry);
        }
    });
    popover.popup();
    search.grab_focus();
}

fn enabled(app: &App, action: &str) -> bool {
    let name = action.split("::").next().unwrap_or(action);
    app.window.lookup_action(name).is_some_and(|action| action.is_enabled())
}

fn page_rows(list: &gtk::ListBox, scroller: &gtk::ScrolledWindow) -> i32 {
    let height = list.row_at_index(0).map_or(1, |row| row.height().max(1));
    #[allow(clippy::cast_possible_truncation)]
    let rows = (scroller.vadjustment().page_size() / f64::from(height)).floor() as i32;
    rows.max(1)
}

fn select(list: &gtk::ListBox, scroller: &gtk::ScrolledWindow, index: i32) {
    let Some(row) = list.row_at_index(index) else { return };
    list.select_row(Some(&row));
    let Some(bounds) = row.compute_bounds(list) else { return };
    let adjustment = scroller.vadjustment();
    let header = row.header().map_or(0, |header| header.height());
    let top = f64::from(bounds.y()) - f64::from(header);
    let bottom = f64::from(bounds.y() + bounds.height());
    let (value, page) = (adjustment.value(), adjustment.page_size());
    if index == 0 || top < value {
        adjustment.set_value(if index == 0 { 0.0 } else { top });
    } else if bottom > value + page {
        adjustment.set_value(bottom - page);
    }
}

fn fill(
    list: &gtk::ListBox,
    scroller: &gtk::ScrolledWindow,
    entries: &[Entry],
    query: &str,
    visible: &Rc<RefCell<Vec<Entry>>>,
) {
    list.remove_all();
    let matched: Vec<Entry> = entries.iter().filter(|entry| entry.matches(query)).take(80).cloned().collect();
    visible.borrow_mut().clone_from(&matched);
    for entry in &matched {
        let row = adw::ActionRow::builder().title(format::escape(&entry.title)).activatable(true).build();
        row.set_focusable(false);
        if !entry.subtitle.is_empty() {
            row.set_subtitle(&format::escape(&entry.subtitle));
        }
        list.append(&row);
    }
    list.invalidate_headers();
    scroller.vadjustment().set_value(0.0);
    if let Some(first) = list.row_at_index(0) {
        list.select_row(Some(&first));
    }
}

fn entries(state: &State) -> Vec<Entry> {
    const ACTIONS: &str = "Actions";
    let mut entries = vec![
        Entry::new(ACTIONS, "New thread", "Ctrl+N · Shift-click the + button to pick a project", "new-thread", None),
        Entry::new(ACTIONS, "New thread without a project", "Ctrl+Alt+N", "new-thread-without-project", None),
        Entry::new(ACTIONS, "Go to file…", "Ctrl+P", "go-to-file", None),
        Entry::new(ACTIONS, "Search project contents", "Ctrl+Shift+F", "project-search", None),
        Entry::new(ACTIONS, "Search threads", "Ctrl+F", "search", None),
        Entry::new(ACTIONS, "Add project folder…", "", "add-project", None),
        Entry::new(ACTIONS, "Clone repository…", "GitHub owner/name or a git URL", "clone-project", None),
        Entry::new(ACTIONS, "Open usage", "Ctrl+U", "usage", None),
        Entry::new(ACTIONS, "Open Local", "Live figures for each machine in the fleet", "local", None),
        Entry::new(ACTIONS, "Toggle sidebar", "Ctrl+B", "toggle-sidebar", None),
        Entry::new(ACTIONS, "Toggle terminal", "Ctrl+J", "toggle-terminal", None),
        Entry::new(ACTIONS, "Toggle diff", "Ctrl+D", "toggle-diff", None),
        Entry::new(ACTIONS, "Toggle right panel", "", "toggle-panel", None),
        Entry::new(ACTIONS, "Clean up worktrees now", "Storage retention rules", "cleanup-worktrees", None),
    ];
    if state.workspace_dir().is_some() {
        entries.push(Entry::new(ACTIONS, "Commit changes…", "Source control", "git-commit", None));
        entries.push(Entry::new(ACTIONS, "Push branch", "Source control", "git-push", None));
        entries.push(Entry::new(ACTIONS, "Create pull request…", "Source control", "git-pr", None));
        entries.push(Entry::new(ACTIONS, "Open in editor", "Ctrl+O", "open-editor", None));
    }
    if let Some(thread) = &state.selected {
        entries.push(Entry::new(
            ACTIONS,
            "Restart agent session",
            "Current thread",
            "thread-restart",
            Some(thread.clone()),
        ));
        entries.push(Entry::new(ACTIONS, "Fork thread", "Current thread", "thread-fork", Some(thread.clone())));
        entries.push(Entry::new(ACTIONS, "Compact context", "Current thread", "thread-compact", Some(thread.clone())));
    }
    let mut recent: Vec<&local_studio_core::ThreadRow> = state.threads.iter().filter(|row| !row.archived).collect();
    recent.sort_by_key(|row| std::cmp::Reverse(row.updated_at));
    let thread_entry = |group: &'static str, row: &local_studio_core::ThreadRow| {
        Entry::new(
            group,
            if row.title.is_empty() { "New thread" } else { &row.title },
            &state.project_name(row.project.as_deref()).unwrap_or_else(|| "No project".to_string()),
            "thread-open",
            Some(row.id.clone()),
        )
    };
    entries.extend(recent.iter().take(5).map(|row| thread_entry("Recent", row)));
    for project in &state.projects {
        entries.push(Entry::new(
            "Projects",
            &format!("New thread in {}", project.name),
            &project.path,
            "project-new-thread",
            Some(project.id.clone()),
        ));
        entries.push(Entry::new(
            "Projects",
            &format!("{} settings…", project.name),
            "Name, icon, defaults and scripts",
            "project-settings",
            Some(project.id.clone()),
        ));
    }
    entries.extend(recent.iter().skip(5).map(|row| thread_entry("Threads", row)));
    for (name, title) in [
        ("general", "General"),
        ("appearance", "Appearance"),
        ("keybindings", "Keybindings"),
        ("providers", "Providers"),
        ("source-control", "Source Control"),
        ("storage", "Storage"),
        ("local", "Local"),
        ("archive", "Archive"),
    ] {
        entries.push(Entry::new("Settings", title, "Settings", "settings-page", Some(name.to_string())));
    }
    commands(state, &mut entries);
    entries
}

fn commands(state: &State, entries: &mut Vec<Entry>) {
    const COMMANDS: &str = "Commands";
    let vim = state.settings.vim_mode;
    entries.push(Entry::new(
        COMMANDS,
        if vim { "Turn vim keys off" } else { "Turn vim keys on" },
        "Vim keys: modal composer and j/k in lists",
        "vim-toggle",
        None,
    ));
    for binding in &state.keybindings {
        let Some(action) = crate::bindings::action_for(&binding.command) else { continue };
        let Some(action) = action.strip_prefix("win.") else { continue };
        let shortcut = binding.shortcut.as_deref().map(format::shortcut_label).unwrap_or_default();
        entries.push(Entry::new(COMMANDS, &binding.title, &shortcut, action, None));
    }
}
