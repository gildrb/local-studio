use std::cell::RefCell;
use std::rc::{Rc, Weak};

use adw::prelude::*;
use local_studio_core::SetupStageState;

use crate::app::App;
use crate::icons;
use crate::state::State;

pub struct SetupCard {
    pub root: gtk::Box,
    title: gtk::Label,
    stages: gtk::Box,
    error: gtk::Label,
    actions: gtk::Box,
    thread: Rc<RefCell<Option<String>>>,
}

impl SetupCard {
    pub fn new(app: &Weak<App>) -> Self {
        let root = gtk::Box::new(gtk::Orientation::Vertical, 4);
        root.add_css_class("ls-setup");
        root.set_visible(false);
        let title = gtk::Label::new(None);
        title.set_xalign(0.0);
        title.set_hexpand(true);
        title.add_css_class("heading");
        let thread: Rc<RefCell<Option<String>>> = Rc::new(RefCell::new(None));
        let actions = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        for (label, skip) in [("Work Locally", true), ("Cancel", false)] {
            let button = gtk::Button::with_label(label);
            button.add_css_class("flat");
            button.add_css_class("ls-small-toggle");
            let (weak, thread) = (app.clone(), Rc::clone(&thread));
            button.connect_clicked(move |_| {
                let (Some(app), Some(thread)) = (weak.upgrade(), thread.borrow().clone()) else { return };
                if skip {
                    app.core.run(|studio| studio.skip_worktree_setup(thread));
                } else {
                    app.core.run(|studio| studio.cancel_worktree_setup(thread));
                }
            });
            actions.append(&button);
        }
        let top = gtk::Box::new(gtk::Orientation::Horizontal, 8);
        top.append(&title);
        top.append(&actions);
        let stages = gtk::Box::new(gtk::Orientation::Vertical, 2);
        let error = gtk::Label::new(None);
        error.set_xalign(0.0);
        error.set_wrap(true);
        error.add_css_class("error");
        root.append(&top);
        root.append(&stages);
        root.append(&error);
        Self { root, title, stages, error, actions, thread }
    }

    pub fn render(&self, state: &State) {
        let key = state.selected.clone().or_else(|| state.draft.clone());
        let setup = key.as_ref().and_then(|thread| state.setup.get(thread));
        let Some(setup) = setup.filter(|setup| !setup.done || setup.error.is_some()) else {
            self.root.set_visible(false);
            return;
        };
        self.thread.replace(key);
        self.root.set_visible(true);
        self.actions.set_visible(!setup.done);
        self.title.set_label(match (&setup.error, setup.done) {
            (Some(_), _) => "Worktree setup stopped",
            (None, true) => "Worktree ready",
            (None, false) => "Setting up the worktree…",
        });
        while let Some(child) = self.stages.first_child() {
            self.stages.remove(&child);
        }
        for stage in &setup.stages {
            let row = gtk::Box::new(gtk::Orientation::Horizontal, 8);
            let (icon, class) = match stage.state {
                SetupStageState::Pending => (icons::TIME, "dim-label"),
                SetupStageState::Running => (icons::WORKING, "accent"),
                SetupStageState::Done => (icons::DONE, "success"),
                SetupStageState::Failed => (icons::ERROR, "error"),
                SetupStageState::Skipped => (icons::NONE, "dim-label"),
            };
            row.append(&icons::styled(icon, class));
            let name = gtk::Label::new(Some(&stage.name));
            name.set_xalign(0.0);
            row.append(&name);
            let tail = stage.output_tail.lines().last().unwrap_or_default();
            if !tail.is_empty() {
                let output = gtk::Label::new(Some(tail));
                output.add_css_class("ls-meta");
                output.add_css_class("monospace");
                output.set_ellipsize(gtk::pango::EllipsizeMode::End);
                output.set_hexpand(true);
                output.set_xalign(1.0);
                row.append(&output);
            }
            self.stages.append(&row);
        }
        self.error.set_visible(setup.error.is_some());
        self.error.set_label(setup.error.as_deref().unwrap_or_default());
    }
}
