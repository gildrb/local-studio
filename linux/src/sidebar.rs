use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Weak;

use adw::prelude::*;
use gtk::{gio, glib};
use local_studio_core::{Shelf, ThreadRow, ThreadStatus};

use crate::actions;
use crate::app::{App, Dirty};
use crate::format;
use crate::state::{initials, Page, State};

const SETTLED_PAGE: usize = 8;

#[derive(Clone, PartialEq)]
enum Entry {
    Shelf { shelf: Shelf, label: &'static str, count: usize, collapsed: bool },
    Thread { row: Box<ThreadRow>, project: Option<String>, slim: bool, selected: bool, when: String },
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
    entries: RefCell<Vec<Entry>>,
    collapsed: RefCell<HashSet<String>>,
    show_all_settled: std::cell::Cell<bool>,
    footer: Vec<(Page, gtk::Button)>,
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
        let add = gtk::Button::builder()
            .icon_name("folder-new-symbolic")
            .tooltip_text("Add Project")
            .action_name("win.add-project")
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
            let gesture = gtk::GestureClick::builder().button(3).build();
            let menu_app = weak.clone();
            let menu_item = item.downgrade();
            let menu_holder = holder.downgrade();
            gesture.connect_pressed(move |_, _, x, y| {
                let (Some(app), Some(item), Some(holder)) =
                    (menu_app.upgrade(), menu_item.upgrade(), menu_holder.upgrade())
                else {
                    return;
                };
                if let Some(Entry::Thread { row, .. }) = entry_of(&item) {
                    let menu = actions::thread_menu(&app.state.borrow(), &row.id);
                    actions::popup_menu(&holder, &menu, x, y);
                }
            });
            holder.add_controller(gesture);
            item.set_child(Some(&holder));
        });
        factory.connect_bind(|_, object| {
            let Some(item) = object.downcast_ref::<gtk::ListItem>() else { return };
            let Some(holder) = item.child().and_downcast::<adw::Bin>() else { return };
            let Some(entry) = entry_of(item) else { return };
            item.set_activatable(!matches!(entry, Entry::Empty(_)));
            holder.set_child(Some(&entry_widget(&entry)));
        });
        let list = gtk::ListView::new(Some(gtk::NoSelection::new(Some(store.clone()))), Some(factory));
        list.set_single_click_activate(true);
        list.add_css_class("ls-list");
        let weak = app.clone();
        list.connect_activate(move |list, position| {
            let Some(app) = weak.upgrade() else { return };
            let Some(entry) = list
                .model()
                .and_then(|model| model.item(position))
                .and_downcast::<glib::BoxedAnyObject>()
                .map(|object| object.borrow::<Entry>().clone())
            else {
                return;
            };
            match entry {
                Entry::Thread { row, .. } => app.select_thread(Some(row.id)),
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
        });
        let scroller =
            gtk::ScrolledWindow::builder().hscrollbar_policy(gtk::PolicyType::Never).vexpand(true).child(&list).build();

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
        root.append(&footer_box);

        let weak = app.clone();
        search.connect_search_changed(move |entry| {
            let Some(app) = weak.upgrade() else { return };
            app.state.borrow_mut().search = entry.text().to_string();
            app.render(Dirty { sidebar: true, ..Dirty::default() });
        });
        let weak = app;
        projects.connect_row_activated(move |_, row| {
            let Some(app) = weak.upgrade() else { return };
            let project = row.widget_name().to_string();
            if project == "add" {
                app.sidebar.filter.popdown();
                app.add_project();
                return;
            }
            app.state.borrow_mut().filter = Some(project).filter(|project| !project.is_empty());
            app.sidebar.filter.popdown();
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
            entries: RefCell::new(Vec::new()),
            collapsed: RefCell::new(HashSet::new()),
            show_all_settled: std::cell::Cell::new(false),
            footer,
        }
    }

    pub fn bind_split(&self, split: &adw::OverlaySplitView) {
        split.bind_property("show-sidebar", &self.toggle, "active").bidirectional().sync_create().build();
    }

    pub fn focus_search(&self) {
        self.search.grab_focus();
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
    }

    fn entries_for(&self, state: &State) -> Vec<Entry> {
        let now = format::now_ms();
        let query = state.search.trim().to_lowercase();
        let collapsed = self.collapsed.borrow();
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
                entries.push(Entry::Thread {
                    row: Box::new((**row).clone()),
                    project: state.project_name(row.project.as_deref()),
                    slim,
                    selected: state.page == Page::Thread && state.selected.as_deref() == Some(row.id.as_str()),
                    when,
                });
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
                let more = gtk::MenuButton::builder().icon_name("view-more-symbolic").menu_model(&menu).build();
                more.add_css_class("flat");
                more.set_valign(gtk::Align::Center);
                row.add_suffix(&more);
            } else {
                let icon = gtk::Image::from_icon_name("view-grid-symbolic");
                row.add_prefix(&icon);
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

fn entry_of(item: &gtk::ListItem) -> Option<Entry> {
    item.item().and_downcast::<glib::BoxedAnyObject>().map(|object| object.borrow::<Entry>().clone())
}

fn entry_widget(entry: &Entry) -> gtk::Widget {
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
        Entry::Thread { row, project, slim, selected, when } => {
            thread_widget(row, project.as_deref(), *slim, *selected, when)
        }
    }
}

fn thread_widget(row: &ThreadRow, project: Option<&str>, slim: bool, selected: bool, when: &str) -> gtk::Widget {
    let card = gtk::Box::new(gtk::Orientation::Vertical, 3);
    card.add_css_class("ls-thread");
    if selected {
        card.add_css_class("selected");
    }
    if row.unread {
        card.add_css_class("unread");
    }
    let title = gtk::Label::new(Some(if row.title.is_empty() { "New thread" } else { &row.title }));
    title.add_css_class("title");
    title.set_xalign(0.0);
    title.set_ellipsize(gtk::pango::EllipsizeMode::End);
    title.set_hexpand(true);
    let status = format::status(row.status);
    if slim {
        card.add_css_class("slim");
        let line = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        let badge = gtk::Label::new(Some(&initials(project.unwrap_or("·"))));
        badge.add_css_class("ls-tile");
        badge.set_opacity(0.5);
        line.append(&badge);
        line.append(&title);
        if row.pinned {
            line.append(&small_icon("view-pin-symbolic", "ls-meta"));
        }
        if row.status == ThreadStatus::Woke {
            let woke = gtk::Label::new(Some("Woke"));
            woke.add_css_class("ls-pill");
            woke.add_css_class("status-woke");
            line.append(&woke);
        } else {
            let stamp = gtk::Label::new(Some(when));
            stamp.add_css_class("ls-meta");
            line.append(&stamp);
        }
        card.append(&line);
        return card.upcast();
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
    if let Some((icon, label, class)) = status {
        top.append(&small_icon(icon, class));
        let label = gtk::Label::new(Some(label));
        label.add_css_class("ls-meta");
        label.add_css_class(class);
        top.append(&label);
    } else {
        let stamp = gtk::Label::new(Some(when));
        stamp.add_css_class("ls-meta");
        top.append(&stamp);
    }
    card.append(&top);
    card.append(&title);
    let branch = row.branch.clone().filter(|branch| !branch.is_empty());
    if branch.is_some() || row.additions > 0 || row.deletions > 0 {
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
        if row.additions > 0 || row.deletions > 0 {
            let add = gtk::Label::new(Some(&format!("+{}", row.additions)));
            add.add_css_class("ls-add");
            let del = gtk::Label::new(Some(&format!("−{}", row.deletions)));
            del.add_css_class("ls-del");
            bottom.append(&add);
            bottom.append(&del);
        }
        card.append(&bottom);
    }
    if let Some(note) = row.note.as_deref().filter(|note| !note.is_empty()) {
        card.set_tooltip_text(Some(note));
    }
    card.upcast()
}

fn small_icon(name: &str, class: &str) -> gtk::Image {
    let image = gtk::Image::from_icon_name(name);
    image.set_pixel_size(12);
    image.add_css_class(class);
    image
}
