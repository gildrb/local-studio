use std::cell::RefCell;
use std::rc::Weak;

use adw::prelude::*;
use local_studio_core::SearchHit;

use crate::app::{App, Target};
use crate::format;

pub struct ProjectSearch {
    pub dialog: adw::Dialog,
    entry: gtk::SearchEntry,
    list: gtk::ListBox,
    status: gtk::Label,
    pending: RefCell<String>,
    hits: RefCell<Vec<SearchHit>>,
}

impl ProjectSearch {
    pub fn new(app: Weak<App>) -> Self {
        let dialog = adw::Dialog::builder().title("Search Project").content_width(720).content_height(560).build();
        let entry = gtk::SearchEntry::builder().placeholder_text("Search project contents").hexpand(true).build();
        let header = adw::HeaderBar::new();
        header.set_title_widget(Some(&entry));
        let list = gtk::ListBox::new();
        list.add_css_class("navigation-sidebar");
        let status = gtk::Label::new(Some("Type to search the files of the current project."));
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
            let Some(root) = root.filter(|_| !query.is_empty()) else {
                app.search.list.remove_all();
                return;
            };
            if !app.core.is_live() {
                return;
            }
            let request = app.ask(Target::ProjectSearch);
            app.search.pending.replace(request.clone());
            app.search.status.set_label("Searching…");
            app.search.status.set_visible(true);
            app.core.run(|studio| studio.search_text(request, root, query, 200));
        });
        let weak = app;
        list.connect_row_activated(move |_, row| {
            let Some(app) = weak.upgrade() else { return };
            let hit = usize::try_from(row.index()).ok().and_then(|index| app.search.hits.borrow().get(index).cloned());
            if let Some(hit) = hit {
                app.search.dialog.close();
                app.panel.show("files");
                app.panel.files.open_file(&app, &hit.relative);
            }
        });
        Self { dialog, entry, list, status, pending: RefCell::new(String::new()), hits: RefCell::new(Vec::new()) }
    }

    pub fn present(&self, app: &App) {
        self.dialog.present(Some(&app.window));
        self.entry.grab_focus();
    }

    pub fn loaded(&self, request: &str, hits: &[SearchHit]) {
        if *self.pending.borrow() != request {
            return;
        }
        self.list.remove_all();
        self.status.set_visible(hits.is_empty());
        self.status.set_label("No matches in this project.");
        for hit in hits {
            let location = hit.line.map_or_else(|| hit.relative.clone(), |line| format!("{}:{line}", hit.relative));
            let row = adw::ActionRow::builder()
                .title(format::escape(&hit.preview))
                .subtitle(format::escape(&location))
                .title_lines(1)
                .activatable(true)
                .build();
            row.add_css_class("ls-search-hit");
            self.list.append(&row);
        }
        self.hits.replace(hits.to_vec());
    }

    pub fn set_fixture(&self, query: &str, hits: &[SearchHit]) {
        self.entry.set_text(query);
        self.pending.replace("fixture".to_string());
        self.loaded("fixture", hits);
    }
}
