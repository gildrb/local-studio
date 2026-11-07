use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use adw::prelude::*;
use gtk::glib;
use local_studio_core::{Branch, NewThreadWorkspace, WorktreeChoice};

use crate::app::{App, Target};
use crate::format;
use crate::state::{Page, State};

#[derive(Clone, PartialEq, Eq)]
enum Pick {
    Fresh,
    Branch(Branch),
    Create(String),
}

pub struct BranchBar {
    pub root: adw::Clamp,
    mode: gtk::DropDown,
    branch: gtk::MenuButton,
    branch_label: gtk::Label,
    search: gtk::SearchEntry,
    list: gtk::ListBox,
    status: gtk::Label,
    pick: RefCell<Pick>,
    touched: Cell<bool>,
    rows: RefCell<Vec<Pick>>,
}

impl BranchBar {
    pub fn new(app: Weak<App>) -> Self {
        let mode = gtk::DropDown::from_strings(&["Local checkout", "New worktree"]);
        mode.add_css_class("flat");
        mode.set_tooltip_text(Some("Where the new thread works (Ctrl+Shift+X)"));
        let branch_label = gtk::Label::new(None);
        branch_label.add_css_class("ls-mono");
        branch_label.set_ellipsize(gtk::pango::EllipsizeMode::Middle);
        branch_label.set_max_width_chars(36);
        let branch_box = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        branch_box.append(&gtk::Image::from_icon_name("media-record-symbolic"));
        branch_box.append(&branch_label);
        let search = gtk::SearchEntry::builder().placeholder_text("Search or create a branch").build();
        let list = gtk::ListBox::new();
        list.add_css_class("navigation-sidebar");
        list.set_selection_mode(gtk::SelectionMode::None);
        let status = gtk::Label::new(None);
        status.add_css_class("ls-meta");
        status.set_xalign(0.0);
        let scroller = gtk::ScrolledWindow::builder()
            .hscrollbar_policy(gtk::PolicyType::Never)
            .propagate_natural_height(true)
            .max_content_height(320)
            .min_content_width(320)
            .child(&list)
            .build();
        let column = gtk::Box::new(gtk::Orientation::Vertical, 6);
        column.append(&search);
        column.append(&scroller);
        column.append(&status);
        let popover = gtk::Popover::new();
        popover.set_child(Some(&column));
        let branch = gtk::MenuButton::builder().child(&branch_box).popover(&popover).build();
        branch.add_css_class("flat");
        let row = gtk::Box::new(gtk::Orientation::Horizontal, 4);
        row.add_css_class("ls-branchbar");
        row.append(&mode);
        row.append(&branch);
        let root = adw::Clamp::builder().maximum_size(820).tightening_threshold(640).child(&row).build();
        root.set_margin_start(26);
        root.set_margin_end(20);
        root.set_margin_bottom(10);
        root.set_visible(false);

        let weak = app.clone();
        mode.connect_selected_notify(move |_| {
            let Some(app) = weak.upgrade() else { return };
            if app.syncing.get() {
                return;
            }
            app.branches.touched.set(true);
            let state = app.state.borrow();
            app.branches.render(&state);
        });
        let weak = app.clone();
        popover.connect_show(move |_| {
            if let Some(app) = weak.upgrade() {
                app.branches.request(&app);
            }
        });
        let weak = app.clone();
        search.connect_search_changed(move |_| {
            if let Some(app) = weak.upgrade() {
                app.branches.request(&app);
            }
        });
        let weak = app;
        list.connect_row_activated(move |_, row| {
            let Some(app) = weak.upgrade() else { return };
            let pick =
                usize::try_from(row.index()).ok().and_then(|index| app.branches.rows.borrow().get(index).cloned());
            if let Some(pick) = pick {
                app.branches.pick.replace(pick);
                app.branches.branch.popdown();
                let state = app.state.borrow();
                app.branches.render(&state);
            }
        });
        Self {
            root,
            mode,
            branch,
            branch_label,
            search,
            list,
            status,
            pick: RefCell::new(Pick::Fresh),
            touched: Cell::new(false),
            rows: RefCell::new(Vec::new()),
        }
    }

    pub fn open_mode(&self) {
        if self.root.is_visible() {
            self.mode.activate();
        }
    }

    pub fn open_branch(&self) {
        if self.root.is_visible() && self.branch.is_sensitive() {
            self.branch.popup();
        }
    }

    pub fn reset(&self) {
        self.pick.replace(Pick::Fresh);
        self.touched.set(false);
        self.search.set_text("");
    }

    fn worktree(&self) -> bool {
        self.mode.selected() == 1
    }

    fn request(&self, app: &Rc<App>) {
        let project = app.state.borrow().current_project();
        let Some(project) = project else { return };
        let request = app.ask(Target::Branches);
        let query = self.search.text().to_string();
        self.status.set_label("Loading refs…");
        app.core.run(|studio| studio.list_branches(request, project, query, 50));
    }

    pub fn loaded(&self, branches: &[Branch], total: u32) {
        let query = self.search.text().trim().to_string();
        self.list.remove_all();
        let mut rows = Vec::new();
        if !query.is_empty() && !branches.iter().any(|branch| branch.name == query) {
            let row = adw::ActionRow::builder()
                .title(format::escape(&format!("Create branch “{query}”")))
                .activatable(true)
                .build();
            row.add_prefix(&gtk::Image::from_icon_name("list-add-symbolic"));
            self.list.append(&row);
            rows.push(Pick::Create(query));
        }
        for branch in branches {
            let row = adw::ActionRow::builder().title(format::escape(&branch.name)).activatable(true).build();
            for (show, text) in
                [(branch.current, "current"), (branch.remote, "remote"), (branch.worktree.is_some(), "worktree")]
            {
                if show {
                    let badge = gtk::Label::new(Some(text));
                    badge.add_css_class("ls-pill");
                    badge.set_valign(gtk::Align::Center);
                    row.add_suffix(&badge);
                }
            }
            if let Some(worktree) = &branch.worktree {
                row.set_subtitle(&format::escape(worktree));
                row.set_subtitle_lines(1);
            }
            self.list.append(&row);
            rows.push(Pick::Branch(branch.clone()));
        }
        self.status.set_label(&format!("Showing {} of {total} refs", branches.len()));
        self.rows.replace(rows);
    }

    pub fn render(&self, state: &State) {
        let project = state.current_project();
        let is_git =
            project.as_deref().and_then(|project| state.project(project)).is_some_and(|project| project.is_git);
        self.root.set_visible(state.page == Page::Thread && state.selected.is_none() && is_git);
        if !self.touched.get() {
            let worktree = state.settings.new_thread_workspace == NewThreadWorkspace::Worktree;
            self.mode.set_selected(u32::from(worktree));
        }
        let current =
            project.as_deref().and_then(|project| state.git.get(project)).and_then(|status| status.branch.clone());
        if self.worktree() {
            self.branch.set_sensitive(true);
            self.branch.set_tooltip_text(Some("Branch for the new worktree"));
            self.branch_label.set_label(&match &*self.pick.borrow() {
                Pick::Fresh => "New branch".to_string(),
                Pick::Branch(branch) => branch
                    .worktree
                    .as_ref()
                    .map_or_else(|| branch.name.clone(), |_| format!("{} (existing worktree)", branch.name)),
                Pick::Create(name) => format!("{name} (new)"),
            });
        } else {
            self.branch.set_sensitive(false);
            self.branch.set_tooltip_text(Some("The local checkout stays on its current branch"));
            self.branch_label.set_label(current.as_deref().unwrap_or("Current branch"));
        }
    }

    pub fn choice(&self, state: &State, draft: &str) -> WorktreeChoice {
        let project = state.current_project();
        let is_git =
            project.as_deref().and_then(|project| state.project(project)).is_some_and(|project| project.is_git);
        if !is_git || !self.worktree() {
            return WorktreeChoice::Local;
        }
        let default = project
            .as_deref()
            .and_then(|project| state.git.get(project))
            .and_then(|status| status.default_branch.clone());
        let base = default.map(|default| {
            if state.settings.new_worktrees_start_from_origin && !default.starts_with("origin/") {
                format!("origin/{default}")
            } else {
                default
            }
        });
        match self.pick.borrow().clone() {
            Pick::Branch(branch) => match branch.worktree {
                Some(path) => WorktreeChoice::Existing { path },
                None if branch.remote => {
                    let name = branch.name.split_once('/').map_or(branch.name.as_str(), |(_, name)| name).to_string();
                    WorktreeChoice::NewWorktree { branch: name, base: Some(branch.name) }
                }
                None => WorktreeChoice::NewWorktree { branch: branch.name, base: None },
            },
            Pick::Create(name) => WorktreeChoice::NewWorktree { branch: name, base },
            Pick::Fresh => WorktreeChoice::NewWorktree {
                branch: format!(
                    "local-studio/{}",
                    glib::DateTime::now_local()
                        .ok()
                        .and_then(|now| now.format("%Y%m%d-%H%M%S").ok())
                        .map_or_else(|| draft.to_string(), |text| text.to_string())
                ),
                base,
            },
        }
    }

    pub fn set_fixture(&self, worktree: bool, branch: Option<Branch>) {
        self.touched.set(true);
        self.mode.set_selected(u32::from(worktree));
        self.pick.replace(branch.map_or(Pick::Fresh, Pick::Branch));
    }
}
