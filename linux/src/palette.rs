use std::cell::RefCell;
use std::rc::Rc;

use adw::prelude::*;
use gtk::{gdk, glib};

use crate::app::App;
use crate::format;
use crate::state::State;

#[derive(Clone)]
struct Entry {
    title: String,
    subtitle: String,
    action: &'static str,
    target: Option<String>,
}

impl Entry {
    fn new(title: &str, subtitle: &str, action: &'static str, target: Option<String>) -> Self {
        Self { title: title.to_string(), subtitle: subtitle.to_string(), action, target }
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
            let target = entry.target.as_ref().map(ToVariant::to_variant);
            WidgetExt::activate_action(&app.window, &format!("win.{}", entry.action), target.as_ref()).ok();
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
    let matched: Vec<Entry> = entries.iter().filter(|entry| entry.matches(query)).take(60).cloned().collect();
    for entry in &matched {
        let row = adw::ActionRow::builder().title(format::escape(&entry.title)).activatable(true).build();
        if !entry.subtitle.is_empty() {
            row.set_subtitle(&format::escape(&entry.subtitle));
        }
        list.append(&row);
    }
    if let Some(first) = list.row_at_index(0) {
        list.select_row(Some(&first));
    }
    *visible.borrow_mut() = matched;
}

fn entries(state: &State) -> Vec<Entry> {
    let mut entries = vec![
        Entry::new("New thread", "Ctrl+N", "new-thread", None),
        Entry::new("New thread without a project", "Ctrl+Alt+N", "new-thread-without-project", None),
        Entry::new("Add project…", "", "add-project", None),
        Entry::new("Open settings", "Ctrl+,", "settings", None),
        Entry::new("Open usage", "Ctrl+U", "usage", None),
        Entry::new("Open Local", "Machines, models and the registry", "local", None),
        Entry::new("Toggle sidebar", "Ctrl+B", "toggle-sidebar", None),
        Entry::new("Toggle terminal", "Ctrl+J", "toggle-terminal", None),
        Entry::new("Toggle diff", "Ctrl+D", "toggle-diff", None),
        Entry::new("Search threads", "Ctrl+F", "search", None),
    ];
    if state.workspace_dir().is_some() {
        entries.push(Entry::new("Commit changes", "Source control", "git-commit", None));
        entries.push(Entry::new("Push branch", "Source control", "git-push", None));
        entries.push(Entry::new("Create pull request…", "Source control", "git-pr", None));
    }
    for project in &state.projects {
        entries.push(Entry::new(
            &format!("New thread in {}", project.name),
            &project.path,
            "project-new-thread",
            Some(project.id.clone()),
        ));
    }
    for row in state.threads.iter().filter(|row| !row.archived) {
        entries.push(Entry::new(
            if row.title.is_empty() { "New thread" } else { &row.title },
            &state.project_name(row.project.as_deref()).unwrap_or_else(|| "No project".to_string()),
            "thread-open",
            Some(row.id.clone()),
        ));
    }
    entries
}
