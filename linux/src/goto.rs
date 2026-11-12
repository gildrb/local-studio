use std::cell::RefCell;
use std::rc::Weak;

use adw::prelude::*;
use gtk::{gdk, glib};
use local_studio_core::SearchHit;

use crate::app::{App, Target};
use crate::format;
use crate::icons;

pub struct GotoFile {
    pub dialog: adw::Dialog,
    entry: gtk::SearchEntry,
    list: gtk::ListBox,
    status: gtk::Label,
    pending: RefCell<String>,
    hits: RefCell<Vec<SearchHit>>,
}

impl GotoFile {
    pub fn new(app: Weak<App>) -> Self {
        let dialog = adw::Dialog::builder().title("Go to File").content_width(620).content_height(460).build();
        let entry = gtk::SearchEntry::builder().placeholder_text("Go to file").hexpand(true).build();
        let header = adw::HeaderBar::new();
        header.set_title_widget(Some(&entry));
        let list = gtk::ListBox::new();
        list.add_css_class("navigation-sidebar");
        list.set_selection_mode(gtk::SelectionMode::Browse);
        let status = gtk::Label::new(Some("Type a file name."));
        status.add_css_class("dim-label");
        status.set_margin_top(18);
        let column = gtk::Box::new(gtk::Orientation::Vertical, 0);
        column.append(&status);
        column.append(&list);
        let scroller = gtk::ScrolledWindow::builder()
            .hscrollbar_policy(gtk::PolicyType::Never)
            .vexpand(true)
            .child(&column)
            .build();
        let view = adw::ToolbarView::new();
        view.add_top_bar(&header);
        view.set_content(Some(&scroller));
        dialog.set_child(Some(&view));
        let weak = app.clone();
        entry.connect_search_changed(move |entry| {
            let Some(app) = weak.upgrade() else { return };
            let query = entry.text().trim().to_string();
            let root = app.state.borrow().workspace_dir();
            let Some(root) = root.filter(|_| !query.is_empty() && app.core.is_live()) else { return };
            let request = app.ask(Target::GotoFile);
            app.goto.pending.replace(request.clone());
            app.core.run(|studio| studio.search_files(request, root, query, 40));
        });
        let weak = app.clone();
        entry.connect_activate(move |_| {
            let Some(app) = weak.upgrade() else { return };
            let index = app.goto.list.selected_row().map_or(0, |row| row.index());
            app.goto.open(&app, index);
        });
        let keys = gtk::EventControllerKey::new();
        let moving = list.clone();
        keys.connect_key_pressed(move |_, key, _, _| {
            let step = match key {
                gdk::Key::Down => 1,
                gdk::Key::Up => -1,
                _ => return glib::Propagation::Proceed,
            };
            let current = moving.selected_row().map_or(-1, |row| row.index());
            if let Some(row) = moving.row_at_index((current + step).max(0)) {
                moving.select_row(Some(&row));
            }
            glib::Propagation::Stop
        });
        entry.add_controller(keys);
        let weak = app;
        list.connect_row_activated(move |_, row| {
            if let Some(app) = weak.upgrade() {
                app.goto.open(&app, row.index());
            }
        });
        Self { dialog, entry, list, status, pending: RefCell::new(String::new()), hits: RefCell::new(Vec::new()) }
    }

    pub fn present(&self, app: &App) {
        if app.state.borrow().workspace_dir().is_none() {
            app.toast("Open a project thread to go to its files.");
            return;
        }
        self.dialog.present(Some(&app.window));
        self.entry.grab_focus();
    }

    fn open(&self, app: &std::rc::Rc<App>, index: i32) {
        let hit = usize::try_from(index).ok().and_then(|index| self.hits.borrow().get(index).cloned());
        let Some(hit) = hit else { return };
        self.dialog.close();
        app.panel.show("files");
        app.panel.files.open_file(app, &hit.relative);
    }

    pub fn loaded(&self, request: &str, hits: &[SearchHit]) {
        if *self.pending.borrow() != request {
            return;
        }
        self.list.remove_all();
        self.status.set_visible(hits.is_empty());
        self.status.set_label("No matching files.");
        for hit in hits {
            let row = adw::ActionRow::builder()
                .title(format::escape(&crate::state::short_path(&hit.relative)))
                .subtitle(format::escape(&hit.relative))
                .activatable(true)
                .build();
            row.add_prefix(&icons::image(icons::FILE));
            self.list.append(&row);
        }
        if let Some(first) = self.list.row_at_index(0) {
            self.list.select_row(Some(&first));
        }
        self.hits.replace(hits.to_vec());
    }

    pub fn set_fixture(&self, query: &str, hits: &[SearchHit]) {
        self.entry.set_text(query);
        self.pending.replace("fixture".to_string());
        self.loaded("fixture", hits);
    }
}
