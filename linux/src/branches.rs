use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use adw::prelude::*;
use gtk::glib;
use local_studio_core::{Branch, NewThreadWorkspace, WorktreeChoice};

use crate::app::{App, Target};
use crate::picker::{Picker, Row, Spec};
use crate::state::{Page, State};

const LOCAL: &str = "local";
const WORKTREE: &str = "worktree";
const FRESH: &str = "fresh";

#[derive(Clone, PartialEq, Eq)]
enum Pick {
    Fresh,
    Branch(Branch),
    Create(String),
}

pub struct BranchBar {
    pub root: adw::Clamp,
    mode: Picker,
    branch: Picker,
    use_worktree: Cell<bool>,
    pick: RefCell<Pick>,
    touched: Cell<bool>,
    rows: RefCell<Vec<Pick>>,
}

impl BranchBar {
    pub fn new(app: Weak<App>) -> Self {
        let mode = mode_picker(&app);
        let branch = branch_picker(app);
        let row = gtk::Box::new(gtk::Orientation::Horizontal, 4);
        row.add_css_class("ls-branchbar");
        row.append(&mode.button);
        row.append(&branch.button);
        let root = adw::Clamp::builder().maximum_size(820).tightening_threshold(640).child(&row).build();
        root.set_margin_start(26);
        root.set_margin_end(20);
        root.set_margin_bottom(10);
        root.set_visible(false);
        Self {
            root,
            mode,
            branch,
            use_worktree: Cell::new(false),
            pick: RefCell::new(Pick::Fresh),
            touched: Cell::new(false),
            rows: RefCell::new(Vec::new()),
        }
    }

    pub fn open_mode(&self) {
        if self.root.is_visible() {
            self.mode.popup();
        }
    }

    pub fn open_branch(&self) {
        if self.root.is_visible() {
            self.branch.popup();
        }
    }

    pub fn reset(&self) {
        self.pick.replace(Pick::Fresh);
        self.touched.set(false);
        self.branch.set_search_text("");
    }

    fn worktree(&self) -> bool {
        self.use_worktree.get()
    }

    fn request(&self, app: &Rc<App>) {
        let project = app.state.borrow().current_project();
        let Some(project) = project else { return };
        let request = app.ask(Target::Branches);
        let query = self.branch.search_text();
        self.branch.set_note(Some("Loading refs…"));
        app.core.run(|studio| studio.list_branches(request, project, query, 50));
    }

    pub fn loaded(&self, branches: &[Branch], total: u32) {
        let query = self.branch.search_text().trim().to_string();
        let pick = self.pick.borrow().clone();
        let mut choices = Vec::new();
        let mut items = Vec::new();
        if query.is_empty() {
            items.push(Row::new(FRESH, "New branch").subtitle("Named automatically").checked(pick == Pick::Fresh));
        } else if !branches.iter().any(|branch| branch.name == query) {
            let create = Pick::Create(query.clone());
            items.push(
                Row::new(choices.len().to_string(), format!("Create branch “{query}”"))
                    .icon("list-add-symbolic")
                    .checked(pick == create),
            );
            choices.push(create);
        }
        for branch in branches {
            let chosen = matches!(&pick, Pick::Branch(current) if current.name == branch.name);
            let mut row = Row::new(choices.len().to_string(), &branch.name).checked(chosen);
            let badges: Vec<&str> =
                [(branch.current, "current"), (branch.remote, "remote"), (branch.worktree.is_some(), "worktree")]
                    .into_iter()
                    .filter_map(|(show, text)| show.then_some(text))
                    .collect();
            if !badges.is_empty() {
                row = row.detail(badges.join(" · "));
            }
            if let Some(worktree) = &branch.worktree {
                row = row.subtitle(worktree);
            }
            items.push(row);
            choices.push(Pick::Branch(branch.clone()));
        }
        self.branch.set_note(Some(&format!("Showing {} of {total} refs", branches.len())));
        self.rows.replace(choices);
        self.branch.set_rows(items);
    }

    pub fn render(&self, state: &State) {
        let project = state.current_project();
        let is_git =
            project.as_deref().and_then(|project| state.project(project)).is_some_and(|project| project.is_git);
        self.root.set_visible(state.page == Page::Thread && state.selected.is_none() && is_git);
        if !self.touched.get() {
            self.use_worktree.set(state.settings.new_thread_workspace == NewThreadWorkspace::Worktree);
        }
        let worktree = self.worktree();
        self.mode.set_rows(vec![
            Row::new(LOCAL, "Local checkout").icon("folder-symbolic").checked(!worktree),
            Row::new(WORKTREE, "New worktree").icon("folder-new-symbolic").checked(worktree),
        ]);
        self.mode.set_label(if worktree { "New worktree" } else { "Local checkout" });
        self.mode.set_icon(Some(if worktree { "folder-new-symbolic" } else { "folder-symbolic" }));
        let current =
            project.as_deref().and_then(|project| state.git.get(project)).and_then(|status| status.branch.clone());
        if worktree {
            self.branch.button.set_sensitive(true);
            self.branch.button.set_tooltip_text(Some("Branch for the new worktree"));
            self.branch.set_label(&match &*self.pick.borrow() {
                Pick::Fresh => "New branch".to_string(),
                Pick::Branch(branch) => branch
                    .worktree
                    .as_ref()
                    .map_or_else(|| branch.name.clone(), |_| format!("{} (existing worktree)", branch.name)),
                Pick::Create(name) => format!("{name} (new)"),
            });
        } else {
            self.branch.button.set_sensitive(false);
            self.branch.button.set_tooltip_text(Some("The local checkout stays on its current branch"));
            self.branch.set_label(current.as_deref().unwrap_or("Current branch"));
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

    pub fn preset(&self, worktree: bool, branch: Option<Branch>) {
        self.touched.set(true);
        self.use_worktree.set(worktree);
        self.pick.replace(branch.map_or(Pick::Fresh, Pick::Branch));
    }
}

fn mode_picker(app: &Weak<App>) -> Picker {
    let weak = app.clone();
    let spec = Spec {
        tooltip: "Where the new thread works (Ctrl+Shift+X)",
        title: Some("Workspace"),
        width: 220,
        ..Spec::default()
    };
    Picker::new(&spec, move |id| {
        let Some(app) = weak.upgrade() else { return };
        if app.syncing.get() {
            return;
        }
        app.branches.use_worktree.set(id == WORKTREE);
        app.branches.touched.set(true);
        let state = app.state.borrow();
        app.branches.render(&state);
    })
}

fn branch_picker(app: Weak<App>) -> Picker {
    let weak = app.clone();
    let spec = Spec {
        tooltip: "Branch for the new worktree",
        search: Some("Search or create a branch"),
        empty: Some("Loading branches…"),
        width: 320,
        max_height: 320,
        ..Spec::default()
    };
    let picker = Picker::new(&spec, move |id| {
        let Some(app) = weak.upgrade() else { return };
        let pick = if id == FRESH {
            Some(Pick::Fresh)
        } else {
            id.parse::<usize>().ok().and_then(|index| app.branches.rows.borrow().get(index).cloned())
        };
        let Some(pick) = pick else { return };
        app.branches.pick.replace(pick);
        let state = app.state.borrow();
        app.branches.render(&state);
    });
    picker.set_icon(Some("media-record-symbolic"));
    picker.label.add_css_class("ls-mono");
    let weak = app.clone();
    picker.popover.connect_show(move |_| {
        if let Some(app) = weak.upgrade() {
            app.branches.request(&app);
        }
    });
    picker.connect_search(move || {
        if let Some(app) = app.upgrade() {
            app.branches.request(&app);
        }
    });
    picker
}
