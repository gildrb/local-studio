use std::cell::RefCell;
use std::rc::Rc;

use adw::prelude::*;
use gtk::{gdk, gio, glib};

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
    let entries = entries(&app.state.borrow());
    let dialog = adw::Dialog::builder().title("Command Palette").content_width(600).content_height(460).build();
    let search =
        gtk::SearchEntry::builder().placeholder_text("Search actions, threads and projects").hexpand(true).build();
    let list = gtk::ListBox::new();
    list.add_css_class("navigation-sidebar");
    list.set_selection_mode(gtk::SelectionMode::Browse);
    let scroller =
        gtk::ScrolledWindow::builder().hscrollbar_policy(gtk::PolicyType::Never).vexpand(true).child(&list).build();
    let header = adw::HeaderBar::new();
    header.set_title_widget(Some(&search));
    let view = adw::ToolbarView::new();
    view.add_top_bar(&header);
    view.set_content(Some(&scroller));
    dialog.set_child(Some(&view));

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
    fill(&list, &entries, "", &visible);
    let refill_list = list.clone();
    let refill_visible = Rc::clone(&visible);
    search.connect_search_changed(move |search| {
        fill(&refill_list, &entries, &search.text().to_lowercase(), &refill_visible);
    });
    let keys = gtk::EventControllerKey::new();
    let move_list = list.clone();
    keys.connect_key_pressed(move |_, key, _, _| {
        let step = match key {
            gdk::Key::Down => 1,
            gdk::Key::Up => -1,
            _ => return glib::Propagation::Proceed,
        };
        let current = move_list.selected_row().map_or(-1, |row| row.index());
        if let Some(row) = move_list.row_at_index((current + step).max(0)) {
            move_list.select_row(Some(&row));
            row.grab_focus();
        }
        glib::Propagation::Stop
    });
    search.add_controller(keys);
    let weak = Rc::downgrade(app);
    let run = Rc::new(move |dialog: &adw::Dialog, entry: &Entry| {
        dialog.close();
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
    let activate_dialog = dialog.clone();
    let activate_run = Rc::clone(&run);
    search.connect_activate(move |_| {
        let index = activate_list.selected_row().map_or(0, |row| row.index());
        let entry = usize::try_from(index).ok().and_then(|index| activate_visible.borrow().get(index).cloned());
        if let Some(entry) = entry {
            activate_run(&activate_dialog, &entry);
        }
    });
    let row_dialog = dialog.clone();
    list.connect_row_activated(move |_, row| {
        let entry = usize::try_from(row.index()).ok().and_then(|index| visible.borrow().get(index).cloned());
        if let Some(entry) = entry {
            run(&row_dialog, &entry);
        }
    });
    dialog.present(Some(&app.window));
    search.grab_focus();
}

fn fill(list: &gtk::ListBox, entries: &[Entry], query: &str, visible: &Rc<RefCell<Vec<Entry>>>) {
    list.remove_all();
    let matched: Vec<Entry> = entries.iter().filter(|entry| entry.matches(query)).take(80).cloned().collect();
    visible.borrow_mut().clone_from(&matched);
    for entry in &matched {
        let row = adw::ActionRow::builder().title(format::escape(&entry.title)).activatable(true).build();
        if !entry.subtitle.is_empty() {
            row.set_subtitle(&format::escape(&entry.subtitle));
        }
        list.append(&row);
    }
    list.invalidate_headers();
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
