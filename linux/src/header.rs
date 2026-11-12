use adw::prelude::*;

use crate::actions;
use crate::icons;
use crate::state::{Page, State};

pub struct Header {
    pub bar: adw::HeaderBar,
    toggle: gtk::ToggleButton,
    back: gtk::Button,
    crumb: gtk::MenuButton,
    project: gtk::Label,
    slash: gtk::Label,
    title: gtk::Label,
    chevron: gtk::Image,
    page_title: gtk::Label,
    branch: gtk::Label,
    panel: gtk::Overlay,
    badge: gtk::Label,
    terminal: gtk::Button,
    git: adw::SplitButton,
    open: adw::SplitButton,
    scripts: gtk::MenuButton,
}

impl Header {
    #[allow(clippy::too_many_lines)]
    pub fn build(editors: &gtk::gio::Menu) -> Self {
        let bar = adw::HeaderBar::new();
        let toggle = gtk::ToggleButton::builder().icon_name(icons::SIDEBAR).build();
        icons::describe(&toggle, "Toggle Sidebar (Ctrl+B)");
        bar.pack_start(&toggle);
        let back = icons::button(icons::BACK, "Back to Threads");
        back.set_action_name(Some("win.back-to-thread"));
        back.set_visible(false);
        bar.pack_start(&back);
        let project = gtk::Label::new(None);
        project.add_css_class("ls-crumb-project");
        let slash = gtk::Label::new(Some("/"));
        slash.add_css_class("dim-label");
        let title = gtk::Label::new(None);
        title.add_css_class("ls-crumb-title");
        title.set_ellipsize(gtk::pango::EllipsizeMode::End);
        title.set_max_width_chars(48);
        let chevron = icons::image(icons::EXPANDED);
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
        let terminal = icons::button(icons::TERMINAL, "Terminal (Ctrl+J)");
        terminal.set_action_name(Some("win.toggle-terminal"));
        let panel_button = icons::button(icons::PANEL, "Right Panel (Ctrl+Alt+B)");
        panel_button.set_action_name(Some("win.toggle-panel"));
        let badge = gtk::Label::new(None);
        badge.add_css_class("ls-badge");
        badge.set_halign(gtk::Align::End);
        badge.set_valign(gtk::Align::Start);
        badge.set_can_target(false);
        badge.set_visible(false);
        let panel = gtk::Overlay::new();
        panel.set_child(Some(&panel_button));
        panel.add_overlay(&badge);
        let open = adw::SplitButton::builder()
            .label("Open")
            .tooltip_text("Open in Editor (Ctrl+O)")
            .action_name("win.open-editor")
            .menu_model(editors)
            .build();
        let branch = gtk::Label::new(None);
        branch.add_css_class("ls-pill");
        branch.add_css_class("ls-mono");
        let menu = gtk::gio::Menu::new();
        menu.append(Some("Commit"), Some("win.git-commit"));
        menu.append(Some("Pull"), Some("win.git-pull"));
        menu.append(Some("Push"), Some("win.git-push"));
        menu.append(Some("Create Pull Request…"), Some("win.git-pr"));
        menu.append(Some("View Pull Request"), Some("win.git-view-pr"));
        menu.append(Some("Publish Repository…"), Some("win.git-publish"));
        let git = adw::SplitButton::builder().label("Commit").menu_model(&menu).build();
        git.set_visible(false);
        bar.pack_end(&panel);
        bar.pack_end(&terminal);
        bar.pack_end(&git);
        let scripts = gtk::MenuButton::builder().icon_name(icons::RUN).visible(false).build();
        icons::describe(&scripts, "Run Project Script");
        bar.pack_end(&scripts);
        bar.pack_end(&open);
        bar.pack_end(&branch);
        Self {
            bar,
            toggle,
            back,
            crumb,
            project,
            slash,
            title,
            chevron,
            page_title,
            branch,
            panel,
            badge,
            terminal,
            git,
            open,
            scripts,
        }
    }

    pub fn set_agents(&self, running: usize) {
        self.badge.set_visible(running > 0);
        self.badge.set_label(&running.to_string());
    }

    pub fn bind_split(&self, split: &adw::OverlaySplitView) {
        split.bind_property("show-sidebar", &self.toggle, "active").bidirectional().sync_create().build();
        split.bind_property("show-sidebar", &self.toggle, "visible").invert_boolean().sync_create().build();
        let title = self.bar.title_widget();
        let gap = move |split: &adw::OverlaySplitView| {
            if let Some(title) = &title {
                title.set_margin_start(if split.shows_sidebar() { 0 } else { 22 });
            }
        };
        gap(split);
        split.connect_show_sidebar_notify(gap);
    }

    fn render_scripts(&self, state: &State, project: Option<&str>, workspace: bool) {
        let scripts = project.and_then(|project| state.scripts.get(project)).filter(|scripts| !scripts.is_empty());
        self.scripts.set_visible(workspace && scripts.is_some());
        if let Some(scripts) = scripts {
            let menu = gtk::gio::Menu::new();
            for script in scripts {
                let item = gtk::gio::MenuItem::new(Some(&script.name), None);
                item.set_action_and_target_value(Some("win.run-script"), Some(&script.id.to_variant()));
                menu.append_item(&item);
            }
            self.scripts.set_menu_model(Some(&menu));
        }
    }

    pub fn render(&self, state: &State) {
        let on_thread = state.page == Page::Thread;
        self.crumb.set_visible(on_thread);
        self.page_title.set_visible(!on_thread);
        self.back.set_visible(!on_thread);
        let workspace = on_thread && state.workspace_dir().is_some();
        self.panel.set_visible(on_thread);
        self.terminal.set_visible(workspace);
        self.open.set_visible(workspace);
        self.page_title.set_label(match state.page {
            Page::Thread => "",
            Page::Local => "Local",
            Page::Usage => "Usage",
            Page::PullRequests => "Pull Requests",
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
        self.slash.set_visible(project_name.is_some());
        self.render_scripts(state, project.as_deref(), workspace);
        self.project.set_visible(project_name.is_some());
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
            } else if status.behind > 0 {
                Some(("Pull", "win.git-pull", "Fast-forward this branch from its upstream"))
            } else if !status.has_remote {
                Some(("Publish", "win.git-publish", "Create a GitHub repository for this project"))
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
