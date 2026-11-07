use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::rc::{Rc, Weak};

use adw::prelude::*;
use gtk::{gdk, gio, glib};
use local_studio_core::{Shelf, ThreadRow, ThreadSearchHit, ThreadStatus};

use crate::actions;
use crate::app::{App, Dirty, Target};
use crate::format;
use crate::state::{initials, Page, State};

const SETTLED_PAGE: usize = 8;

#[derive(Clone, PartialEq)]
#[allow(clippy::struct_excessive_bools)]
struct Card {
    row: ThreadRow,
    project: Option<String>,
    slim: bool,
    selected: bool,
    marked: bool,
    renaming: bool,
    hint: Option<u8>,
    when: String,
}

#[derive(Clone, PartialEq)]
enum Entry {
    Shelf { shelf: Shelf, label: &'static str, count: usize, collapsed: bool },
    Thread(Box<Card>),
    Hit { hit: ThreadSearchHit, project: Option<String>, query: String, selected: bool },
    More { remaining: usize },
    Empty(String),
}

pub struct Sidebar {
    pub header: adw::HeaderBar,
    pub root: gtk::Box,
    toggle: gtk::ToggleButton,
    search: gtk::SearchEntry,
    filter: gtk::MenuButton,
    projects: gtk::ListBox,
    store: gio::ListStore,
    bulk: gtk::Box,
    bulk_label: gtk::Label,
    bulk_unpin: gtk::Button,
    entries: RefCell<Vec<Entry>>,
    collapsed: RefCell<HashSet<String>>,
    show_all_settled: Cell<bool>,
    footer: Vec<(Page, gtk::Button)>,
    hits: RefCell<Option<(String, Vec<ThreadSearchHit>)>>,
    pending: RefCell<String>,
    marked: RefCell<Vec<String>>,
    anchor: RefCell<Option<String>>,
    renaming: RefCell<Option<String>>,
    hints: Cell<bool>,
}

impl Sidebar {
    #[allow(clippy::too_many_lines)]
    pub fn new(app: Weak<App>) -> Self {
        let header = adw::HeaderBar::new();
        header.set_show_end_title_buttons(false);
        let toggle = gtk::ToggleButton::builder()
            .icon_name("sidebar-show-symbolic")
            .tooltip_text("Toggle Sidebar (Ctrl+B)")
            .active(true)
            .build();
        let new_thread = gtk::Button::builder()
            .icon_name("list-add-symbolic")
            .tooltip_text("New Thread (Ctrl+N)")
            .action_name("win.new-thread")
            .build();
        header.pack_start(&toggle);
        header.pack_start(&new_thread);
        crate::flows::new_thread_in_on_shift(&app, &new_thread);
        let brand = gtk::Label::new(Some("Local Studio"));
        brand.add_css_class("ls-brand");
        header.set_title_widget(Some(&brand));

        let search = gtk::SearchEntry::builder().placeholder_text("Search").hexpand(true).build();
        search.add_css_class("ls-search");
        let projects = gtk::ListBox::new();
        projects.set_selection_mode(gtk::SelectionMode::None);
        projects.add_css_class("navigation-sidebar");
        let popover = gtk::Popover::new();
        let scroller = gtk::ScrolledWindow::builder()
            .hscrollbar_policy(gtk::PolicyType::Never)
            .propagate_natural_height(true)
            .max_content_height(360)
            .min_content_width(240)
            .child(&projects)
            .build();
        popover.set_child(Some(&scroller));
        let filter = gtk::MenuButton::builder()
            .icon_name("folder-symbolic")
            .tooltip_text("Filter by Project")
            .popover(&popover)
            .build();
        filter.add_css_class("flat");
        let add_menu = gio::Menu::new();
        add_menu.append(Some("Add Folder…"), Some("win.add-project"));
        add_menu.append(Some("Clone Repository…"), Some("win.clone-project"));
        let add = gtk::MenuButton::builder()
            .icon_name("folder-new-symbolic")
            .tooltip_text("Add Project")
            .menu_model(&add_menu)
            .build();
        add.add_css_class("flat");
        let search_row = gtk::Box::new(gtk::Orientation::Horizontal, 4);
        search_row.set_margin_start(8);
        search_row.set_margin_end(8);
        search_row.set_margin_bottom(6);
        search_row.append(&search);
        search_row.append(&filter);
        search_row.append(&add);

        let store = gio::ListStore::new::<glib::BoxedAnyObject>();
        let factory = gtk::SignalListItemFactory::new();
        let weak = app.clone();
        factory.connect_setup(move |_, object| {
            let Some(item) = object.downcast_ref::<gtk::ListItem>() else { return };
            let holder = adw::Bin::new();
            install_row_controllers(&weak, item, &holder);
            item.set_child(Some(&holder));
        });
        let weak = app.clone();
        factory.connect_bind(move |_, object| {
            let Some(item) = object.downcast_ref::<gtk::ListItem>() else { return };
            let Some(holder) = item.child().and_downcast::<adw::Bin>() else { return };
            let Some(entry) = entry_of(item) else { return };
            item.set_activatable(!matches!(entry, Entry::Empty(_)));
            holder.set_child(Some(&entry_widget(&weak, &entry)));
        });
        let list = gtk::ListView::new(Some(gtk::NoSelection::new(Some(store.clone()))), Some(factory));
        list.add_css_class("ls-list");
        let weak = app.clone();
        list.connect_activate(move |list, position| {
            let Some(app) = weak.upgrade() else { return };
            let entry = list
                .model()
                .and_then(|model| model.item(position))
                .and_downcast::<glib::BoxedAnyObject>()
                .map(|object| object.borrow::<Entry>().clone());
            if let Some(entry) = entry {
                activate(&app, &entry, gdk::ModifierType::empty());
            }
        });
        let scroller =
            gtk::ScrolledWindow::builder().hscrollbar_policy(gtk::PolicyType::Never).vexpand(true).child(&list).build();

        let bulk = gtk::Box::new(gtk::Orientation::Horizontal, 2);
        bulk.add_css_class("ls-bulk");
        bulk.set_visible(false);
        let bulk_label = gtk::Label::new(None);
        bulk_label.set_hexpand(true);
        bulk_label.set_xalign(0.0);
        bulk_label.add_css_class("ls-meta");
        bulk.append(&bulk_label);
        let mut bulk_unpin = None;
        for (icon, tooltip, action) in [
            ("mail-unread-symbolic", "Mark Unread", "bulk-unread"),
            ("view-pin-symbolic", "Unpin", "bulk-unpin"),
            ("object-select-symbolic", "Settle", "bulk-settle"),
            ("folder-download-symbolic", "Archive", "bulk-archive"),
            ("user-trash-symbolic", "Delete", "bulk-delete"),
            ("window-close-symbolic", "Clear Selection (Esc)", "bulk-clear"),
        ] {
            let button = gtk::Button::builder()
                .icon_name(icon)
                .tooltip_text(tooltip)
                .action_name(format!("win.{action}"))
                .build();
            button.add_css_class("flat");
            if action == "bulk-unpin" {
                bulk_unpin = Some(button.clone());
            }
            bulk.append(&button);
        }
        let bulk_unpin = bulk_unpin.unwrap_or_default();

        let footer_box = gtk::Box::new(gtk::Orientation::Horizontal, 2);
        footer_box.add_css_class("ls-footer");
        let settings = gtk::Button::builder()
            .icon_name("emblem-system-symbolic")
            .tooltip_text("Settings (Ctrl+,)")
            .action_name("win.settings")
            .build();
        settings.add_css_class("flat");
        footer_box.append(&settings);
        let mut footer = Vec::new();
        for (page, icon, tooltip) in [
            (Page::Usage, "power-profile-performance-symbolic", "Usage (Ctrl+U)"),
            (Page::PullRequests, "preferences-system-sharing-symbolic", "Pull Requests"),
            (Page::Local, "network-server-symbolic", "Local"),
        ] {
            let button = gtk::Button::builder().icon_name(icon).tooltip_text(tooltip).build();
            button.add_css_class("flat");
            let weak = app.clone();
            button.connect_clicked(move |_| {
                let Some(app) = weak.upgrade() else { return };
                let current = app.state.borrow().page;
                app.open_page(if current == page { Page::Thread } else { page });
            });
            footer_box.append(&button);
            footer.push((page, button));
        }

        let root = gtk::Box::new(gtk::Orientation::Vertical, 0);
        root.append(&search_row);
        root.append(&scroller);
        root.append(&bulk);
        root.append(&footer_box);

        let weak = app.clone();
        search.connect_search_changed(move |entry| {
            let Some(app) = weak.upgrade() else { return };
            let query = entry.text().trim().to_string();
            app.state.borrow_mut().search.clone_from(&query);
            if !query.is_empty() && app.core.is_live() {
                let request = app.ask(Target::ThreadSearch);
                app.sidebar.pending.replace(request.clone());
                app.core.run(|studio| studio.search_threads(request, query, 50));
            }
            app.render(Dirty { sidebar: true, ..Dirty::default() });
        });
        let weak = app;
        projects.connect_row_activated(move |_, row| {
            let Some(app) = weak.upgrade() else { return };
            let project = row.widget_name().to_string();
            app.sidebar.filter.popdown();
            if project == "add" {
                app.add_project();
                return;
            }
            app.state.borrow_mut().filter = Some(project).filter(|project| !project.is_empty());
            app.render(Dirty { sidebar: true, ..Dirty::default() });
        });

        Self {
            header,
            root,
            toggle,
            search,
            filter,
            projects,
            store,
            bulk,
            bulk_label,
            bulk_unpin,
            entries: RefCell::new(Vec::new()),
            collapsed: RefCell::new(HashSet::new()),
            show_all_settled: Cell::new(false),
            footer,
            hits: RefCell::new(None),
            pending: RefCell::new(String::new()),
            marked: RefCell::new(Vec::new()),
            anchor: RefCell::new(None),
            renaming: RefCell::new(None),
            hints: Cell::new(false),
        }
    }

    pub fn bind_split(&self, split: &adw::OverlaySplitView) {
        split.bind_property("show-sidebar", &self.toggle, "active").bidirectional().sync_create().build();
    }

    pub fn focus_search(&self) {
        self.search.grab_focus();
    }

    pub fn search_loaded(&self, request: &str, hits: Vec<ThreadSearchHit>) {
        if *self.pending.borrow() == request {
            self.hits.replace(Some((self.search.text().trim().to_string(), hits)));
        }
    }

    pub fn search_text(&self, query: &str) {
        self.search.set_text(query);
    }

    pub fn hit_count(&self) -> usize {
        self.hits.borrow().as_ref().map_or(0, |(_, hits)| hits.len())
    }

    pub fn marked(&self) -> Vec<String> {
        self.marked.borrow().clone()
    }

    pub fn clear_marks(&self) -> bool {
        let had = !self.marked.borrow().is_empty();
        self.marked.borrow_mut().clear();
        had
    }

    pub fn set_hints(&self, on: bool) -> bool {
        self.hints.replace(on) != on
    }

    pub fn start_rename(&self, thread: &str) {
        self.renaming.replace(Some(thread.to_string()));
    }

    pub fn finish_rename(&self) -> Option<String> {
        self.renaming.take()
    }

    pub fn thread_at(&self, index: usize) -> Option<String> {
        self.entries
            .borrow()
            .iter()
            .filter_map(|entry| match entry {
                Entry::Thread(card) => Some(card.row.id.clone()),
                Entry::Hit { hit, .. } => Some(hit.thread.clone()),
                _ => None,
            })
            .nth(index)
    }

    pub fn visible_threads(&self) -> Vec<String> {
        self.entries
            .borrow()
            .iter()
            .filter_map(|entry| match entry {
                Entry::Thread(card) => Some(card.row.id.clone()),
                _ => None,
            })
            .collect()
    }

    pub fn reset(&self) {
        self.marked.borrow_mut().clear();
        self.renaming.replace(None);
        self.hints.set(false);
        self.hits.replace(None);
        self.search.set_text("");
    }

    pub fn set_fixture_marks(&self, marked: &[&str]) {
        self.marked.replace(marked.iter().map(ToString::to_string).collect());
    }

    pub fn set_fixture_search(&self, query: &str, hits: Vec<ThreadSearchHit>) {
        self.search.set_text(query);
        self.hits.replace(Some((query.to_string(), hits)));
    }

    pub fn render(&self, state: &State) {
        let entries = self.entries_for(state);
        let mut current = self.entries.borrow_mut();
        let prefix = current.iter().zip(&entries).take_while(|(old, new)| old == new).count();
        let suffix = current[prefix..]
            .iter()
            .rev()
            .zip(entries[prefix..].iter().rev())
            .take_while(|(old, new)| old == new)
            .count();
        let removed = current.len() - prefix - suffix;
        let added: Vec<glib::BoxedAnyObject> = entries[prefix..entries.len() - suffix]
            .iter()
            .map(|entry| glib::BoxedAnyObject::new(entry.clone()))
            .collect();
        if removed > 0 || !added.is_empty() {
            self.store.splice(
                u32::try_from(prefix).unwrap_or(u32::MAX),
                u32::try_from(removed).unwrap_or(u32::MAX),
                &added,
            );
        }
        *current = entries;
        drop(current);
        self.render_projects(state);
        for (page, button) in &self.footer {
            if state.page == *page {
                button.add_css_class("active");
            } else {
                button.remove_css_class("active");
            }
        }
        self.filter.set_icon_name(if state.filter.is_some() { "folder-open-symbolic" } else { "folder-symbolic" });
        let marked = self.marked.borrow();
        self.bulk.set_visible(!marked.is_empty());
        self.bulk_label.set_label(&format!("{} selected", marked.len()));
        self.bulk_unpin.set_visible(marked.iter().any(|id| state.row(id).is_some_and(|row| row.pinned)));
    }

    #[allow(clippy::too_many_lines)]
    fn entries_for(&self, state: &State) -> Vec<Entry> {
        let now = format::now_ms();
        let query = state.search.trim().to_lowercase();
        let selected = |id: &str| state.page == Page::Thread && state.selected.as_deref() == Some(id);
        if !query.is_empty() {
            if let Some((searched, hits)) = &*self.hits.borrow() {
                if searched.to_lowercase() == query {
                    let mut entries: Vec<Entry> = hits
                        .iter()
                        .filter(|hit| state.filter.is_none() || hit.project == state.filter)
                        .map(|hit| Entry::Hit {
                            hit: hit.clone(),
                            project: state.project_name(hit.project.as_deref()),
                            query: query.clone(),
                            selected: selected(&hit.thread),
                        })
                        .collect();
                    if entries.is_empty() {
                        entries.push(Entry::Empty("No threads found".to_string()));
                    }
                    return entries;
                }
            }
        }
        let collapsed = self.collapsed.borrow();
        let marked = self.marked.borrow();
        let renaming = self.renaming.borrow();
        let visible: Vec<&ThreadRow> = state
            .threads
            .iter()
            .filter(|row| !row.archived)
            .filter(|row| state.filter.is_none() || row.project == state.filter)
            .filter(|row| query.is_empty() || row.title.to_lowercase().contains(&query))
            .collect();
        let mut entries = Vec::new();
        if state.projects.is_empty() && visible.is_empty() {
            entries.push(Entry::Empty("No projects yet".to_string()));
            return entries;
        }
        if visible.is_empty() {
            let text = if !query.is_empty() {
                "No threads found".to_string()
            } else if let Some(name) = state.project_name(state.filter.as_deref()) {
                format!("No threads in {name} yet")
            } else {
                "No threads yet".to_string()
            };
            entries.push(Entry::Empty(text));
            return entries;
        }
        let mut hint = 0_u8;
        for (shelf, label) in [
            (Shelf::Pinned, ""),
            (Shelf::Active, ""),
            (Shelf::Working, "Working"),
            (Shelf::Snoozed, "Snoozed"),
            (Shelf::Settled, "Settled"),
        ] {
            let rows: Vec<&&ThreadRow> = visible.iter().filter(|row| row.shelf == shelf).collect();
            if rows.is_empty() {
                continue;
            }
            let slim = matches!(shelf, Shelf::Snoozed | Shelf::Settled);
            let is_collapsed = collapsed.contains(&format!("{shelf:?}"));
            if !label.is_empty() {
                entries.push(Entry::Shelf { shelf, label, count: rows.len(), collapsed: is_collapsed });
            }
            if is_collapsed {
                continue;
            }
            let limit = if shelf == Shelf::Settled && !self.show_all_settled.get() && query.is_empty() {
                SETTLED_PAGE
            } else {
                usize::MAX
            };
            for row in rows.iter().take(limit) {
                let when = if row.shelf == Shelf::Snoozed {
                    row.snoozed_until.map(|until| format::countdown(until, now)).unwrap_or_default()
                } else {
                    format::relative(row.status_since.unwrap_or(row.updated_at).max(row.updated_at), now)
                };
                hint += 1;
                entries.push(Entry::Thread(Box::new(Card {
                    row: (**row).clone(),
                    project: state.project_name(row.project.as_deref()),
                    slim,
                    selected: selected(&row.id),
                    marked: marked.contains(&row.id),
                    renaming: renaming.as_deref() == Some(row.id.as_str()),
                    hint: (self.hints.get() && hint <= 9).then_some(hint),
                    when,
                })));
            }
            if rows.len() > limit {
                entries.push(Entry::More { remaining: rows.len() - limit });
            }
        }
        entries
    }

    fn render_projects(&self, state: &State) {
        while let Some(child) = self.projects.first_child() {
            self.projects.remove(&child);
        }
        let mut rows: Vec<(String, String, Option<String>)> = vec![(String::new(), "All projects".to_string(), None)];
        rows.extend(
            state.projects.iter().map(|project| (project.id.clone(), project.name.clone(), Some(project.path.clone()))),
        );
        for (id, name, path) in rows {
            let row = adw::ActionRow::builder().title(format::escape(&name)).activatable(true).build();
            row.set_widget_name(&id);
            if let Some(path) = &path {
                row.set_subtitle(&format::escape(path));
                row.set_subtitle_lines(1);
                let tile = gtk::Label::new(Some(&initials(&name)));
                tile.add_css_class("ls-tile");
                tile.set_valign(gtk::Align::Center);
                row.add_prefix(&tile);
                let menu = gio::Menu::new();
                let item = gio::MenuItem::new(Some("New Thread"), None);
                item.set_action_and_target_value(Some("win.project-new-thread"), Some(&id.to_variant()));
                menu.append_item(&item);
                let item = gio::MenuItem::new(Some("Remove Project"), None);
                item.set_action_and_target_value(Some("win.project-remove"), Some(&id.to_variant()));
                menu.append_item(&item);
                let item = gio::MenuItem::new(Some("Project Settings…"), None);
                item.set_action_and_target_value(Some("win.project-settings"), Some(&id.to_variant()));
                menu.append_item(&item);
                let more = gtk::MenuButton::builder().icon_name("view-more-symbolic").menu_model(&menu).build();
                more.add_css_class("flat");
                more.set_valign(gtk::Align::Center);
                row.add_suffix(&more);
            } else {
                row.add_prefix(&gtk::Image::from_icon_name("view-grid-symbolic"));
            }
            if state.filter.as_deref().unwrap_or_default() == id {
                row.add_suffix(&gtk::Image::from_icon_name("object-select-symbolic"));
            }
            self.projects.append(&row);
        }
        let add = adw::ActionRow::builder().title("Add Project…").activatable(true).build();
        add.set_widget_name("add");
        add.add_prefix(&gtk::Image::from_icon_name("folder-new-symbolic"));
        self.projects.append(&add);
    }
}

fn install_row_controllers(app: &Weak<App>, item: &gtk::ListItem, holder: &adw::Bin) {
    let menu = gtk::GestureClick::builder().button(3).build();
    let (weak, item_ref, holder_ref) = (app.clone(), item.downgrade(), holder.downgrade());
    menu.connect_pressed(move |_, _, x, y| {
        let (Some(app), Some(item), Some(holder)) = (weak.upgrade(), item_ref.upgrade(), holder_ref.upgrade()) else {
            return;
        };
        let id = match entry_of(&item) {
            Some(Entry::Thread(card)) => card.row.id,
            Some(Entry::Hit { hit, .. }) => hit.thread,
            _ => return,
        };
        let marked = app.sidebar.marked();
        let menu = if marked.len() > 1 && marked.contains(&id) {
            crate::commands::bulk_menu()
        } else {
            actions::thread_menu(&app.state.borrow(), &id)
        };
        actions::popup_menu(&holder, &menu, x, y);
    });
    holder.add_controller(menu);
    let click = gtk::GestureClick::builder().button(1).build();
    let (weak, item_ref) = (app.clone(), item.downgrade());
    click.connect_released(move |gesture, presses, _, _| {
        let (Some(app), Some(item)) = (weak.upgrade(), item_ref.upgrade()) else { return };
        let Some(entry) = entry_of(&item) else { return };
        if matches!(&entry, Entry::Thread(card) if card.renaming) {
            return;
        }
        if presses == 2 {
            if let Entry::Thread(card) = entry {
                app.sidebar.start_rename(&card.row.id);
                app.render(Dirty { sidebar: true, ..Dirty::default() });
            }
            return;
        }
        if presses == 1 {
            activate(&app, &entry, gesture.current_event_state());
        }
    });
    holder.add_controller(click);
    install_row_dnd(app, item, holder);
}

fn install_row_dnd(app: &Weak<App>, item: &gtk::ListItem, holder: &adw::Bin) {
    let drag = gtk::DragSource::new();
    drag.set_actions(gdk::DragAction::MOVE);
    let item_ref = item.downgrade();
    drag.connect_prepare(move |_, _, _| {
        let item = item_ref.upgrade()?;
        match entry_of(&item) {
            Some(Entry::Thread(card)) if !card.renaming => {
                Some(gdk::ContentProvider::for_value(&card.row.id.to_value()))
            }
            _ => None,
        }
    });
    holder.add_controller(drag);
    let drop = gtk::DropTarget::new(String::static_type(), gdk::DragAction::MOVE);
    let item_ref = item.downgrade();
    let badge_holder = holder.downgrade();
    drop.connect_enter(move |_, _, _| {
        let (Some(item), Some(holder)) = (item_ref.upgrade(), badge_holder.upgrade()) else {
            return gdk::DragAction::empty();
        };
        let verb = match entry_of(&item) {
            Some(Entry::Thread(card)) => Some(drop_verb(card.row.shelf)),
            Some(Entry::Shelf { shelf, .. }) => Some(drop_verb(shelf)),
            _ => None,
        };
        match verb {
            Some(verb) => {
                holder.set_tooltip_text(Some(verb));
                holder.add_css_class("ls-drop-target");
                gdk::DragAction::MOVE
            }
            None => gdk::DragAction::empty(),
        }
    });
    let badge_holder = holder.downgrade();
    drop.connect_leave(move |_| {
        if let Some(holder) = badge_holder.upgrade() {
            holder.remove_css_class("ls-drop-target");
            holder.set_tooltip_text(None);
        }
    });
    let (weak, item_ref, badge_holder) = (app.clone(), item.downgrade(), holder.downgrade());
    drop.connect_drop(move |_, value, _, _| {
        if let Some(holder) = badge_holder.upgrade() {
            holder.remove_css_class("ls-drop-target");
            holder.set_tooltip_text(None);
        }
        let (Some(app), Some(item), Ok(dragged)) = (weak.upgrade(), item_ref.upgrade(), value.get::<String>()) else {
            return false;
        };
        let source = app.state.borrow().row(&dragged).map(|row| row.shelf);
        let Some(source) = source else { return false };
        match entry_of(&item) {
            Some(Entry::Thread(card)) if card.row.id != dragged => {
                if card.row.pinned && source == Shelf::Pinned {
                    crate::commands::move_pinned(&app, &dragged, &card.row.id);
                } else {
                    move_to_shelf(&app, &dragged, source, card.row.shelf);
                }
                true
            }
            Some(Entry::Shelf { shelf, .. }) => {
                move_to_shelf(&app, &dragged, source, shelf);
                true
            }
            _ => false,
        }
    });
    holder.add_controller(drop);
}

fn drop_verb(shelf: Shelf) -> &'static str {
    match shelf {
        Shelf::Pinned => "Pin",
        Shelf::Snoozed => "Snooze for a day",
        Shelf::Settled => "Settle",
        _ => "Move to Active",
    }
}

fn move_to_shelf(app: &Rc<App>, thread: &str, from: Shelf, to: Shelf) {
    if from == to {
        return;
    }
    let thread = thread.to_string();
    app.core.run(|studio| {
        match from {
            Shelf::Pinned => studio.set_pinned(thread.clone(), false),
            Shelf::Settled => studio.set_settled(thread.clone(), false),
            Shelf::Snoozed => studio.snooze(thread.clone(), None),
            _ => {}
        }
        match to {
            Shelf::Pinned => studio.set_pinned(thread, true),
            Shelf::Settled => studio.set_settled(thread, true),
            Shelf::Snoozed => studio.snooze(thread, Some(crate::format::now_ms() + 24 * 60 * 60 * 1000)),
            _ => {}
        }
    });
}

fn activate(app: &Rc<App>, entry: &Entry, modifiers: gdk::ModifierType) {
    match entry {
        Entry::Thread(card) => {
            let id = card.row.id.clone();
            if modifiers.contains(gdk::ModifierType::CONTROL_MASK) {
                {
                    let mut marked = app.sidebar.marked.borrow_mut();
                    if marked.is_empty() {
                        if let Some(selected) = app.state.borrow().selected.clone().filter(|selected| *selected != id) {
                            marked.push(selected);
                        }
                    }
                    if let Some(index) = marked.iter().position(|known| *known == id) {
                        marked.remove(index);
                    } else {
                        marked.push(id.clone());
                    }
                }
                app.sidebar.anchor.replace(Some(id));
                app.render(Dirty { sidebar: true, ..Dirty::default() });
                return;
            }
            if modifiers.contains(gdk::ModifierType::SHIFT_MASK) {
                let anchor = app.sidebar.anchor.borrow().clone().or_else(|| app.state.borrow().selected.clone());
                let order = app.sidebar.visible_threads();
                let (Some(from), Some(to)) = (
                    anchor.and_then(|anchor| order.iter().position(|known| *known == anchor)),
                    order.iter().position(|known| *known == id),
                ) else {
                    return;
                };
                let (low, high) = if from <= to { (from, to) } else { (to, from) };
                app.sidebar.marked.replace(order[low..=high].to_vec());
                app.render(Dirty { sidebar: true, ..Dirty::default() });
                return;
            }
            app.sidebar.clear_marks();
            app.sidebar.anchor.replace(Some(id.clone()));
            app.select_thread(Some(id));
            app.render(Dirty { sidebar: true, ..Dirty::default() });
        }
        Entry::Hit { hit, .. } => app.select_thread(Some(hit.thread.clone())),
        Entry::Shelf { shelf, .. } => {
            let key = format!("{shelf:?}");
            {
                let mut collapsed = app.sidebar.collapsed.borrow_mut();
                if !collapsed.remove(&key) {
                    collapsed.insert(key);
                }
            }
            app.render(Dirty { sidebar: true, ..Dirty::default() });
        }
        Entry::More { .. } => {
            app.sidebar.show_all_settled.set(true);
            app.render(Dirty { sidebar: true, ..Dirty::default() });
        }
        Entry::Empty(_) => {}
    }
}

fn entry_of(item: &gtk::ListItem) -> Option<Entry> {
    item.item().and_downcast::<glib::BoxedAnyObject>().map(|object| object.borrow::<Entry>().clone())
}

fn entry_widget(app: &Weak<App>, entry: &Entry) -> gtk::Widget {
    match entry {
        Entry::Shelf { label, count, collapsed, .. } => {
            let row = gtk::Box::new(gtk::Orientation::Horizontal, 6);
            row.add_css_class("ls-shelf");
            let text = gtk::Label::new(Some(&format!("{label} ({count})")));
            text.set_xalign(0.0);
            text.set_hexpand(true);
            row.append(&text);
            row.append(&gtk::Image::from_icon_name(if *collapsed { "pan-end-symbolic" } else { "pan-down-symbolic" }));
            row.upcast()
        }
        Entry::More { remaining } => {
            let label = gtk::Label::new(Some(&format!("Show {remaining} more")));
            label.add_css_class("ls-meta");
            label.set_xalign(0.0);
            label.set_margin_start(16);
            label.set_margin_top(4);
            label.set_margin_bottom(4);
            label.upcast()
        }
        Entry::Empty(text) => {
            let label = gtk::Label::new(Some(text));
            label.add_css_class("dim-label");
            label.set_margin_top(24);
            label.upcast()
        }
        Entry::Hit { hit, project, query, selected } => hit_widget(hit, project.as_deref(), query, *selected),
        Entry::Thread(card) => thread_widget(app, card),
    }
}

fn hit_widget(hit: &ThreadSearchHit, project: Option<&str>, query: &str, selected: bool) -> gtk::Widget {
    let card = gtk::Box::new(gtk::Orientation::Vertical, 2);
    card.add_css_class("ls-thread");
    if selected {
        card.add_css_class("selected");
    }
    let top = gtk::Box::new(gtk::Orientation::Horizontal, 6);
    let badge = gtk::Label::new(Some(&initials(project.unwrap_or("·"))));
    badge.add_css_class("ls-tile");
    top.append(&badge);
    let title = gtk::Label::new(None);
    title.set_markup(&highlight(&hit.title, query));
    title.add_css_class("title");
    title.set_xalign(0.0);
    title.set_hexpand(true);
    title.set_ellipsize(gtk::pango::EllipsizeMode::End);
    top.append(&title);
    card.append(&top);
    if !hit.snippet.is_empty() {
        let snippet = gtk::Label::new(None);
        snippet.set_markup(&highlight(&hit.snippet, query));
        snippet.add_css_class("ls-meta");
        snippet.set_xalign(0.0);
        snippet.set_wrap(true);
        snippet.set_lines(2);
        snippet.set_ellipsize(gtk::pango::EllipsizeMode::End);
        card.append(&snippet);
    }
    card.upcast()
}

fn highlight(text: &str, query: &str) -> String {
    let lower = text.to_lowercase();
    if query.is_empty() || lower.len() != text.len() {
        return format::escape(text);
    }
    let mut out = String::new();
    let mut cursor = 0;
    while let Some(found) = lower[cursor..].find(query) {
        let start = cursor + found;
        let end = start + query.len();
        if !text.is_char_boundary(start) || !text.is_char_boundary(end) {
            break;
        }
        out.push_str(&format::escape(&text[cursor..start]));
        out.push_str("<b>");
        out.push_str(&format::escape(&text[start..end]));
        out.push_str("</b>");
        cursor = end;
    }
    out.push_str(&format::escape(&text[cursor..]));
    out
}

#[allow(clippy::too_many_lines)]
fn thread_widget(app: &Weak<App>, card: &Card) -> gtk::Widget {
    let row = &card.row;
    let project = card.project.as_deref();
    let column = gtk::Box::new(gtk::Orientation::Vertical, 3);
    column.add_css_class("ls-thread");
    if card.selected {
        column.add_css_class("selected");
    }
    if card.marked {
        column.add_css_class("marked");
    }
    if row.unread {
        column.add_css_class("unread");
    }
    let title: gtk::Widget = if card.renaming {
        rename_entry(app, row)
    } else {
        let title = gtk::Label::new(Some(if row.title.is_empty() { "New thread" } else { &row.title }));
        title.add_css_class("title");
        title.set_xalign(0.0);
        title.set_ellipsize(gtk::pango::EllipsizeMode::End);
        title.set_hexpand(true);
        title.upcast()
    };
    let hint = card.hint.map(|hint| {
        let label = gtk::Label::new(Some(&format!("Ctrl+{hint}")));
        label.add_css_class("ls-pill");
        label.add_css_class("ls-hint");
        label
    });
    if card.slim {
        column.add_css_class("slim");
        let line = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        let badge = gtk::Label::new(Some(&initials(project.unwrap_or("·"))));
        badge.add_css_class("ls-tile");
        badge.set_opacity(0.5);
        line.append(&badge);
        line.append(&title);
        if row.pinned {
            line.append(&small_icon("view-pin-symbolic", "ls-meta"));
        }
        if let Some(hint) = &hint {
            line.append(hint);
        } else if row.status == ThreadStatus::Woke {
            let woke = gtk::Label::new(Some("Woke"));
            woke.add_css_class("ls-pill");
            woke.add_css_class("status-woke");
            line.append(&woke);
        } else {
            let stamp = gtk::Label::new(Some(&card.when));
            stamp.add_css_class("ls-meta");
            line.append(&stamp);
        }
        column.append(&line);
        return column.upcast();
    }
    let top = gtk::Box::new(gtk::Orientation::Horizontal, 6);
    let badge = gtk::Label::new(Some(&initials(project.unwrap_or("·"))));
    badge.add_css_class("ls-tile");
    top.append(&badge);
    let project_label = gtk::Label::new(Some(project.unwrap_or("No project")));
    project_label.add_css_class("ls-meta");
    project_label.set_xalign(0.0);
    project_label.set_hexpand(true);
    project_label.set_ellipsize(gtk::pango::EllipsizeMode::End);
    top.append(&project_label);
    if row.pinned {
        top.append(&small_icon("view-pin-symbolic", "ls-meta"));
    }
    if let Some(group) = &row.fan_out {
        let marker = small_icon("view-dual-symbolic", "ls-meta");
        marker.set_tooltip_text(Some(&format!("Part of a model comparison ({group})")));
        top.append(&marker);
    }
    if row.live_agents > 0 {
        let agents = gtk::Label::new(Some(&format!("{} agents", row.live_agents)));
        agents.add_css_class("ls-meta");
        agents.add_css_class("status-working");
        top.append(&agents);
    }
    if let Some(hint) = &hint {
        top.append(hint);
    } else if let Some((icon, label, class)) = format::status(row.status) {
        top.append(&small_icon(icon, class));
        let label = gtk::Label::new(Some(label));
        label.add_css_class("ls-meta");
        label.add_css_class(class);
        top.append(&label);
    } else {
        let stamp = gtk::Label::new(Some(&card.when));
        stamp.add_css_class("ls-meta");
        top.append(&stamp);
    }
    column.append(&top);
    column.append(&title);
    let branch = row.branch.clone().filter(|branch| !branch.is_empty());
    if branch.is_some() || row.additions > 0 || row.deletions > 0 || row.pull_request.is_some() {
        let bottom = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        let label = gtk::Label::new(branch.as_deref());
        label.add_css_class("ls-meta");
        label.set_xalign(0.0);
        label.set_hexpand(true);
        label.set_ellipsize(gtk::pango::EllipsizeMode::Middle);
        if row.worktree.is_some() {
            label.set_tooltip_text(row.worktree.as_deref());
        }
        bottom.append(&label);
        if let Some(pull) = &row.pull_request {
            let badge = gtk::Label::new(Some(&format!("#{}", pull.number)));
            badge.add_css_class("ls-pr-badge");
            badge.add_css_class(match pull.state.to_ascii_lowercase().as_str() {
                "merged" => "merged",
                "closed" => "closed",
                "draft" => "draft",
                _ => "open",
            });
            badge.set_tooltip_text(Some(&format!(
                "{} · {}",
                pull.title,
                format::capitalize(&pull.state.to_lowercase())
            )));
            bottom.append(&badge);
        }
        if row.additions > 0 || row.deletions > 0 {
            let add = gtk::Label::new(Some(&format!("+{}", row.additions)));
            add.add_css_class("ls-add");
            let del = gtk::Label::new(Some(&format!("−{}", row.deletions)));
            del.add_css_class("ls-del");
            bottom.append(&add);
            bottom.append(&del);
        }
        column.append(&bottom);
    }
    if let Some(note) = row.note.as_deref().filter(|note| !note.is_empty()) {
        column.set_tooltip_text(Some(note));
    }
    column.upcast()
}

fn rename_entry(app: &Weak<App>, row: &ThreadRow) -> gtk::Widget {
    let entry = gtk::Entry::builder().text(&row.title).hexpand(true).build();
    entry.add_css_class("ls-rename");
    let finish = {
        let weak = app.clone();
        let id = row.id.clone();
        let original = row.title.clone();
        move |entry: &gtk::Entry, commit: bool| {
            let Some(app) = weak.upgrade() else { return };
            if app.sidebar.finish_rename().is_none() {
                return;
            }
            let title = entry.text().trim().to_string();
            if commit && !title.is_empty() && title != original {
                let id = id.clone();
                app.core.run(|studio| studio.rename_thread(id, title));
            }
            let weak = Rc::downgrade(&app);
            glib::idle_add_local_once(move || {
                if let Some(app) = weak.upgrade() {
                    app.render(Dirty { sidebar: true, ..Dirty::default() });
                }
            });
        }
    };
    let on_activate = finish.clone();
    entry.connect_activate(move |entry| on_activate(entry, true));
    let keys = gtk::EventControllerKey::new();
    let on_escape = finish.clone();
    let escaped = entry.clone();
    keys.connect_key_pressed(move |_, key, _, _| {
        if key == gdk::Key::Escape {
            on_escape(&escaped, false);
            return glib::Propagation::Stop;
        }
        glib::Propagation::Proceed
    });
    entry.add_controller(keys);
    let focus = gtk::EventControllerFocus::new();
    let left = entry.clone();
    focus.connect_leave(move |_| finish(&left, true));
    entry.add_controller(focus);
    let focused = entry.clone();
    glib::idle_add_local_once(move || {
        focused.grab_focus();
        focused.select_region(0, -1);
    });
    entry.upcast()
}

fn small_icon(name: &str, class: &str) -> gtk::Image {
    let image = gtk::Image::from_icon_name(name);
    image.set_pixel_size(12);
    image.add_css_class(class);
    image
}
