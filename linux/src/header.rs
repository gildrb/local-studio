use adw::prelude::*;

use crate::actions;
use crate::state::{Page, State};

pub struct Header {
    pub bar: adw::HeaderBar,
    toggle: gtk::ToggleButton,
    new_thread: gtk::Button,
    crumb: gtk::MenuButton,
    project: gtk::Label,
    slash: gtk::Label,
    title: gtk::Label,
    chevron: gtk::Image,
    page_title: gtk::Label,
    branch: gtk::Label,
    diff: gtk::Button,
    terminal: gtk::Button,
    git: adw::SplitButton,
}

impl Header {
    pub fn build() -> Self {
        let bar = adw::HeaderBar::new();
        let toggle = gtk::ToggleButton::builder()
            .icon_name("sidebar-show-symbolic")
            .tooltip_text("Toggle Sidebar (Ctrl+B)")
            .build();
        let new_thread = gtk::Button::builder()
            .icon_name("list-add-symbolic")
            .tooltip_text("New Thread (Ctrl+N)")
            .action_name("win.new-thread")
            .build();
        bar.pack_start(&toggle);
        bar.pack_start(&new_thread);
        let project = gtk::Label::new(None);
        project.add_css_class("ls-crumb-project");
        let slash = gtk::Label::new(Some("/"));
        slash.add_css_class("dim-label");
        let title = gtk::Label::new(None);
        title.add_css_class("ls-crumb-title");
        title.set_ellipsize(gtk::pango::EllipsizeMode::End);
        title.set_max_width_chars(48);
        let chevron = gtk::Image::from_icon_name("pan-down-symbolic");
        chevron.add_css_class("dim-label");
        let crumb_box = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        crumb_box.append(&project);
        crumb_box.append(&slash);
        crumb_box.append(&title);
        crumb_box.append(&chevron);
        let crumb = gtk::MenuButton::builder().child(&crumb_box).build();
        crumb.add_css_class("flat");
        let page_title = gtk::Label::new(None);
        page_title.add_css_class("ls-crumb-title");
        let titles = gtk::Box::new(gtk::Orientation::Horizontal, 0);
        titles.append(&crumb);
        titles.append(&page_title);
        bar.set_title_widget(Some(&titles));
        bar.set_centering_policy(adw::CenteringPolicy::Loose);
        let terminal = gtk::Button::builder()
            .icon_name("utilities-terminal-symbolic")
            .tooltip_text("Terminal (Ctrl+J)")
            .action_name("win.toggle-terminal")
            .build();
        let diff = gtk::Button::builder()
            .icon_name("sidebar-show-right-symbolic")
            .tooltip_text("Diff (Ctrl+D)")
            .action_name("win.toggle-diff")
            .build();
        let branch = gtk::Label::new(None);
        branch.add_css_class("ls-pill");
        branch.add_css_class("ls-mono");
        let menu = gtk::gio::Menu::new();
        menu.append(Some("Commit"), Some("win.git-commit"));
        menu.append(Some("Push"), Some("win.git-push"));
        menu.append(Some("Create Pull Request…"), Some("win.git-pr"));
        menu.append(Some("View Pull Request"), Some("win.git-view-pr"));
        let git = adw::SplitButton::builder().label("Commit").menu_model(&menu).build();
        git.set_visible(false);
        bar.pack_end(&diff);
        bar.pack_end(&terminal);
        bar.pack_end(&git);
        bar.pack_end(&branch);
        Self { bar, toggle, new_thread, crumb, project, slash, title, chevron, page_title, branch, diff, terminal, git }
    }

    pub fn bind_split(&self, split: &adw::OverlaySplitView) {
        split.bind_property("show-sidebar", &self.toggle, "active").bidirectional().sync_create().build();
        for widget in [self.toggle.upcast_ref::<gtk::Widget>(), self.new_thread.upcast_ref()] {
            split.bind_property("show-sidebar", widget, "visible").invert_boolean().sync_create().build();
        }
    }

    pub fn render(&self, state: &State) {
        let on_thread = state.page == Page::Thread;
        self.crumb.set_visible(on_thread);
        self.page_title.set_visible(!on_thread);
        let workspace = on_thread && state.workspace_dir().is_some();
        self.diff.set_visible(workspace);
        self.terminal.set_visible(workspace);
        self.page_title.set_label(match state.page {
            Page::Thread => "",
            Page::Local => "Local",
            Page::Usage => "Usage",
        });
        let project = match &state.selected {
            Some(thread) => state
                .info
                .as_ref()
                .and_then(|info| info.project.clone())
                .or_else(|| state.row(thread).and_then(|row| row.project.clone())),
            None => state.draft_project.clone(),
        };
        let project_name = state.project_name(project.as_deref());
        self.project.set_label(project_name.as_deref().unwrap_or_default());
        self.project.set_visible(project_name.is_some());
        self.slash.set_visible(project_name.is_some());
        let title = match &state.selected {
            Some(thread) => state
                .info
                .as_ref()
                .map(|info| info.title.clone())
                .filter(|title| !title.is_empty())
                .or_else(|| state.row(thread).map(|row| row.title.clone()))
                .unwrap_or_else(|| "Thread".to_string()),
            None => "New thread".to_string(),
        };
        self.title.set_label(&title);
        let menu = match state.selected.as_deref() {
            Some(thread) => Some(actions::thread_menu(state, thread)),
            None if !state.projects.is_empty() => Some(actions::draft_menu(state)),
            None => None,
        };
        self.chevron.set_visible(menu.is_some());
        self.crumb.set_menu_model(menu.as_ref());
        let status = state
            .workspace_dir()
            .and_then(|dir| state.git.get(&dir).cloned())
            .or_else(|| state.current_project().and_then(|project| state.git.get(&project).cloned()));
        let branch = status.as_ref().and_then(|status| {
            let mut parts = vec![status.branch.clone()?];
            if status.ahead > 0 {
                parts.push(format!("↑{}", status.ahead));
            }
            if status.behind > 0 {
                parts.push(format!("↓{}", status.behind));
            }
            if status.changed_files > 0 {
                parts.push(format!("· {} changed", status.changed_files));
            }
            Some(parts.join(" "))
        });
        let branch = branch.or_else(|| {
            state.selected.as_deref().and_then(|thread| state.row(thread)).and_then(|row| row.branch.clone())
        });
        self.branch.set_visible(on_thread && branch.is_some());
        self.branch.set_label(branch.as_deref().unwrap_or_default());
        let primary = status.as_ref().filter(|status| status.is_repo).and_then(|status| {
            if status.dirty || status.changed_files > 0 {
                Some(("Commit", "win.git-commit", "Commit every change (message generated from the changed paths)"))
            } else if status.ahead > 0 || (status.upstream.is_none() && status.branch.is_some()) {
                Some(("Push", "win.git-push", "Push this branch"))
            } else if status.pull_request.is_some() {
                Some(("View PR", "win.git-view-pr", "Open the pull request"))
            } else if status.branch.is_some() && status.branch != status.default_branch {
                Some(("Create PR", "win.git-pr", "Create a pull request for this branch"))
            } else {
                None
            }
        });
        self.git.set_visible(on_thread && primary.is_some());
        if let Some((label, action, tooltip)) = primary {
            self.git.set_label(label);
            self.git.set_action_name(Some(action));
            self.git.set_tooltip_text(Some(tooltip));
        }
    }
}
