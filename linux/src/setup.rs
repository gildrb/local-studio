use adw::prelude::*;
use local_studio_core::SetupStageState;

use crate::state::State;

pub struct SetupCard {
    pub root: gtk::Box,
    title: gtk::Label,
    stages: gtk::Box,
    error: gtk::Label,
}

impl SetupCard {
    pub fn new() -> Self {
        let root = gtk::Box::new(gtk::Orientation::Vertical, 4);
        root.add_css_class("ls-setup");
        root.set_visible(false);
        let title = gtk::Label::new(None);
        title.set_xalign(0.0);
        title.add_css_class("heading");
        let stages = gtk::Box::new(gtk::Orientation::Vertical, 2);
        let error = gtk::Label::new(None);
        error.set_xalign(0.0);
        error.set_wrap(true);
        error.add_css_class("error");
        root.append(&title);
        root.append(&stages);
        root.append(&error);
        Self { root, title, stages, error }
    }

    pub fn render(&self, state: &State) {
        let setup = state.selected.as_ref().and_then(|thread| state.setup.get(thread));
        let Some(setup) = setup.filter(|setup| !setup.done || setup.error.is_some()) else {
            self.root.set_visible(false);
            return;
        };
        self.root.set_visible(true);
        self.title.set_label(if setup.error.is_some() {
            "Worktree setup failed"
        } else {
            "Setting up the worktree…"
        });
        while let Some(child) = self.stages.first_child() {
            self.stages.remove(&child);
        }
        for stage in &setup.stages {
            let row = gtk::Box::new(gtk::Orientation::Horizontal, 8);
            let (icon, class) = match stage.state {
                SetupStageState::Pending => ("content-loading-symbolic", "dim-label"),
                SetupStageState::Running => ("media-playback-start-symbolic", "accent"),
                SetupStageState::Done => ("object-select-symbolic", "success"),
                SetupStageState::Failed => ("dialog-error-symbolic", "error"),
                SetupStageState::Skipped => ("action-unavailable-symbolic", "dim-label"),
            };
            let image = gtk::Image::from_icon_name(icon);
            image.add_css_class(class);
            row.append(&image);
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
