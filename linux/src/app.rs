use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use adw::prelude::*;
use gtk::{gio, glib};
use local_studio_core::{
    ChatWidth, Connection, Delivery, FollowUpBehavior, NewThreadWorkspace, NotificationKind, NotificationMode,
    PromptDraft, Shelf, ThreadSettings, TranscriptOp, Update, WorktreeChoice,
};

use crate::composer::Composer;
use crate::core::Core;
use crate::format;
use crate::header::Header;
use crate::pages::{LocalPage, UsagePage};
use crate::panels::Panel;
use crate::settings::SettingsDialog;
use crate::sidebar::Sidebar;
use crate::state::{Page, State};
use crate::theme;
use crate::timeline::Timeline;

pub type Hook = Rc<dyn Fn(&Rc<App>)>;

#[derive(Default, Clone, Copy)]
#[allow(clippy::struct_excessive_bools)]
pub struct Dirty {
    pub sidebar: bool,
    pub header: bool,
    pub composer: bool,
    pub local: bool,
    pub usage: bool,
    pub settings: bool,
    pub page: bool,
}

impl Dirty {
    pub fn all() -> Self {
        Self { sidebar: true, header: true, composer: true, local: true, usage: true, settings: true, page: true }
    }
}

pub struct App {
    pub core: Core,
    pub state: RefCell<State>,
    pub syncing: Cell<bool>,
    pub application: adw::Application,
    pub window: adw::ApplicationWindow,
    pub toasts: adw::ToastOverlay,
    pub split: adw::OverlaySplitView,
    pub stack: gtk::Stack,
    pub conversation: gtk::Stack,
    pub banner: adw::Banner,
    pub sidebar: Sidebar,
    pub header: Header,
    pub timeline: Timeline,
    pub composer: Composer,
    pub panel: Panel,
    pub local: LocalPage,
    pub usage: UsagePage,
    pub hero: Hero,
    pub settings: RefCell<Option<SettingsDialog>>,
    pub on_tick: RefCell<Option<Hook>>,
}

pub struct Hero {
    pub root: gtk::Box,
    title: gtk::Label,
    subtitle: gtk::Label,
    actions: gtk::Box,
}

impl App {
    pub fn build(application: &adw::Application) -> Rc<Self> {
        theme::install();
        let app = Rc::new_cyclic(|weak: &Weak<App>| {
            let window = adw::ApplicationWindow::builder()
                .application(application)
                .title("Local Studio")
                .default_width(1280)
                .default_height(820)
                .build();
            let split = adw::OverlaySplitView::builder()
                .min_sidebar_width(264.0)
                .max_sidebar_width(320.0)
                .sidebar_width_fraction(0.24)
                .build();
            let sidebar = Sidebar::new(weak.clone());
            let header = Header::build();
            let timeline = Timeline::new(weak.clone());
            let composer = Composer::new(weak.clone());
            let panel = Panel::new(weak.clone());
            let local = LocalPage::new(weak.clone());
            let usage = UsagePage::new(weak.clone());
            let hero = Hero::new(weak.clone());
            let banner = adw::Banner::new("");
            let conversation = gtk::Stack::new();
            conversation.add_named(&hero.root, Some("hero"));
            conversation.add_named(&timeline.root, Some("timeline"));
            conversation.set_vexpand(true);
            let column = gtk::Box::new(gtk::Orientation::Vertical, 0);
            column.append(&conversation);
            column.append(&composer.root);
            let columns = gtk::Paned::new(gtk::Orientation::Horizontal);
            columns.set_start_child(Some(&column));
            columns.set_end_child(Some(&panel.root));
            columns.set_resize_end_child(false);
            columns.set_shrink_end_child(false);
            columns.set_shrink_start_child(false);
            columns.set_position(760);
            let stack = gtk::Stack::new();
            stack.add_named(&columns, Some("thread"));
            stack.add_named(&local.root, Some("local"));
            stack.add_named(&usage.root, Some("usage"));
            let sidebar_view = adw::ToolbarView::new();
            sidebar_view.add_top_bar(&sidebar.header);
            sidebar_view.set_content(Some(&sidebar.root));
            sidebar_view.add_css_class("ls-sidebar");
            let content_view = adw::ToolbarView::new();
            content_view.add_top_bar(&header.bar);
            content_view.add_top_bar(&banner);
            content_view.set_content(Some(&stack));
            split.set_sidebar(Some(&sidebar_view));
            split.set_content(Some(&content_view));
            let toasts = adw::ToastOverlay::new();
            toasts.set_child(Some(&split));
            window.set_content(Some(&toasts));
            let breakpoint = adw::Breakpoint::new(adw::BreakpointCondition::new_length(
                adw::BreakpointConditionLengthType::MaxWidth,
                760.0,
                adw::LengthUnit::Sp,
            ));
            breakpoint.add_setter(&split, "collapsed", Some(&true.to_value()));
            window.add_breakpoint(breakpoint);
            App {
                core: Core::default(),
                state: RefCell::new(State::default()),
                syncing: Cell::new(false),
                application: application.clone(),
                window,
                toasts,
                split,
                stack,
                conversation,
                banner,
                sidebar,
                header,
                timeline,
                composer,
                panel,
                local,
                usage,
                hero,
                settings: RefCell::new(None),
                on_tick: RefCell::new(None),
            }
        });
        app.sidebar.bind_split(&app.split);
        app.header.bind_split(&app.split);
        crate::actions::install(&app);
        app.render(Dirty::all());
        app
    }

    pub fn start_core(self: &Rc<Self>) {
        let weak = Rc::downgrade(self);
        let started = self.core.start(move || {
            if let Some(app) = weak.upgrade() {
                app.tick();
            }
        });
        if let Err(error) = started {
            self.show_banner(&error.to_string());
        }
    }

    pub fn tick(self: &Rc<Self>) {
        let updates = self.core.tick();
        if !updates.is_empty() {
            self.apply(updates);
        }
        let hook = self.on_tick.borrow().clone();
        if let Some(hook) = hook {
            hook(self);
        }
    }

    pub fn apply(self: &Rc<Self>, updates: Vec<Update>) {
        let mut dirty = Dirty::default();
        for update in updates {
            self.apply_one(update, &mut dirty);
        }
        self.render(dirty);
    }

    #[allow(clippy::too_many_lines)]
    fn apply_one(self: &Rc<Self>, update: Update, dirty: &mut Dirty) {
        match update {
            Update::Connection { state } => {
                match &state {
                    Connection::Ready => {
                        self.banner.set_revealed(false);
                        self.core.run(|studio| {
                            studio.load_models();
                            studio.load_providers();
                        });
                    }
                    Connection::Lost { reason } => {
                        self.show_banner(&format!("Disconnected from the Eukhe daemon: {reason}"));
                    }
                    Connection::Connecting => {}
                }
                self.state.borrow_mut().connection = Some(state);
                dirty.composer = true;
            }
            Update::Projects { projects } => {
                let mut state = self.state.borrow_mut();
                if let Some(filter) = &state.filter {
                    if !projects.iter().any(|project| &project.id == filter) {
                        state.filter = None;
                    }
                }
                state.projects = projects;
                dirty.sidebar = true;
                dirty.header = true;
                dirty.page = true;
            }
            Update::Threads { threads } => {
                self.state.borrow_mut().threads = threads;
                dirty.sidebar = true;
                dirty.header = true;
                dirty.page = true;
            }
            Update::ArchivedThreads { request: _, threads } => {
                self.state.borrow_mut().archived = threads;
                dirty.settings = true;
            }
            Update::ThreadStarted { draft, thread } => {
                let ours = {
                    let mut state = self.state.borrow_mut();
                    let ours = state.draft.as_deref() == Some(draft.as_str()) || draft.starts_with("fork:");
                    if ours {
                        state.draft = None;
                    }
                    ours
                };
                if ours {
                    self.select_thread(Some(thread));
                }
            }
            Update::Thread { thread, info } => {
                let mut state = self.state.borrow_mut();
                if state.selected.as_deref() == Some(thread.as_str()) {
                    state.info = Some(info);
                    dirty.header = true;
                    dirty.composer = true;
                }
            }
            Update::Transcript { thread, op } => {
                let focused = self.state.borrow().selected.as_deref() == Some(thread.as_str());
                if focused {
                    if matches!(op, TranscriptOp::Reset { .. }) {
                        dirty.page = true;
                    }
                    self.timeline.apply(op);
                }
            }
            Update::Approvals { thread, approvals } => {
                let mut state = self.state.borrow_mut();
                if state.selected.as_deref() == Some(thread.as_str()) {
                    state.approvals = approvals;
                    dirty.composer = true;
                }
            }
            Update::Queue { thread, queued } => {
                let mut state = self.state.borrow_mut();
                if state.selected.as_deref() == Some(thread.as_str()) {
                    state.queue = queued;
                    dirty.composer = true;
                }
            }
            Update::ComposerText { thread, text } => {
                if self.state.borrow().selected.as_deref() == Some(thread.as_str()) {
                    self.composer.set_text(&text);
                }
            }
            Update::Models { models, favorites } => {
                let mut state = self.state.borrow_mut();
                state.models = models;
                state.favorites = favorites;
                dirty.composer = true;
                dirty.settings = true;
            }
            Update::Commands { .. }
            | Update::Branches { .. }
            | Update::Files { .. }
            | Update::FileContent { .. }
            | Update::SearchResults { .. }
            | Update::PullRequests { .. } => {}
            Update::Notification { thread, kind, title, body } => self.notify(&thread, kind, &title, &body),
            Update::GitStatus { project, status } => {
                self.state.borrow_mut().git.insert(project, status);
                dirty.header = true;
            }
            Update::Diff { request, files } => self.panel.set_diff(&request, &files),
            Update::TerminalOpened { request, terminal } => self.panel.terminal_opened(&request, &terminal),
            Update::TerminalOutput { terminal, data } => self.panel.terminal_output(&terminal, &data),
            Update::TerminalExited { terminal, code } => self.panel.terminal_exited(&terminal, code),
            Update::Usage { request: _, report } => {
                self.state.borrow_mut().usage = Some(report);
                dirty.usage = true;
            }
            Update::Local { request: _, snapshot } => {
                self.state.borrow_mut().local = Some(snapshot);
                dirty.local = true;
            }
            Update::Providers { providers } => {
                self.state.borrow_mut().providers = providers;
                dirty.settings = true;
            }
            Update::Settings { settings } => {
                theme::color_scheme(settings.color_scheme);
                let width = match settings.chat_width {
                    ChatWidth::Normal => 820,
                    ChatWidth::Wide => 1150,
                    ChatWidth::Full => 4000,
                };
                self.timeline.set_width(width);
                self.composer.root.set_maximum_size(width);
                self.state.borrow_mut().settings = settings;
                dirty.composer = true;
                dirty.sidebar = true;
                dirty.settings = true;
            }
            Update::Keybindings { bindings } => {
                self.state.borrow_mut().keybindings = bindings;
                dirty.settings = true;
            }
            Update::RequestDone { request: _, message } => self.toast(&message),
            Update::RequestFailed { request: _, message } => {
                self.local.request_failed();
                self.toast(&message);
            }
            Update::Notice { level: _, text } => self.toast(&text),
        }
    }

    pub fn render(self: &Rc<Self>, dirty: Dirty) {
        self.syncing.set(true);
        {
            let state = self.state.borrow();
            if dirty.sidebar {
                self.sidebar.render(&state);
            }
            if dirty.header || dirty.page {
                self.header.render(&state);
            }
            if dirty.composer {
                self.composer.render(&state);
            }
            if dirty.page {
                self.render_page(&state);
            }
            if dirty.local {
                self.local.render(&state);
            }
            if dirty.usage {
                self.usage.render(&state);
            }
        }
        self.syncing.set(false);
        if dirty.settings {
            let dialog = self.settings.borrow().clone();
            if let Some(dialog) = dialog {
                dialog.refresh(self);
            }
        }
    }

    fn render_page(&self, state: &State) {
        let page = match state.page {
            Page::Thread => "thread",
            Page::Local => "local",
            Page::Usage => "usage",
        };
        self.stack.set_visible_child_name(page);
        let show_hero = state.selected.is_none();
        self.conversation.set_visible_child_name(if show_hero { "hero" } else { "timeline" });
        if show_hero {
            self.hero.render(state);
        }
    }

    pub fn select_thread(self: &Rc<Self>, thread: Option<String>) {
        {
            let mut state = self.state.borrow_mut();
            if state.selected == thread && state.page == Page::Thread {
                return;
            }
            if let Some(thread) = &thread {
                state.draft_project = state.row(thread).and_then(|row| row.project.clone());
            }
            state.selected.clone_from(&thread);
            state.page = Page::Thread;
            state.info = None;
            state.approvals.clear();
            state.queue.clear();
        }
        self.timeline.clear();
        self.composer.set_text("");
        self.core.run(|studio| studio.select_thread(thread.clone()));
        self.render(Dirty::all());
        let unread = thread.as_deref().and_then(|id| self.state.borrow().row(id).map(|row| row.unread));
        if let (Some(thread), Some(true)) = (thread, unread) {
            self.core.run(|studio| studio.mark_unread(thread, false));
        }
    }

    pub fn new_thread(self: &Rc<Self>, project: Option<String>) {
        {
            let mut state = self.state.borrow_mut();
            let project = project.or_else(|| state.current_project());
            state.selected = None;
            state.info = None;
            state.approvals.clear();
            state.queue.clear();
            state.draft_project = project;
            state.page = Page::Thread;
        }
        self.timeline.clear();
        self.core.run(|studio| studio.select_thread(None));
        self.render(Dirty::all());
        self.composer.focus();
    }

    pub fn open_page(self: &Rc<Self>, page: Page) {
        self.state.borrow_mut().page = page;
        match page {
            Page::Thread => {}
            Page::Local => self.local.refresh(self),
            Page::Usage => self.usage.refresh(self),
        }
        self.render(Dirty { page: true, header: true, sidebar: true, ..Dirty::default() });
    }

    pub fn send(self: &Rc<Self>, text: &str) -> bool {
        let text = text.trim();
        if text.is_empty() {
            return false;
        }
        let prompt = PromptDraft { text: text.to_string(), images: Vec::new(), files: Vec::new() };
        let mut state = self.state.borrow_mut();
        if let Some(thread) = state.selected.clone() {
            let busy = state.info.as_ref().is_some_and(|info| info.busy);
            let steer = busy && state.settings.follow_up_behavior == FollowUpBehavior::Steer;
            drop(state);
            self.core.run(|studio| studio.send(thread, prompt, if steer { Delivery::Steer } else { Delivery::Queue }));
            return true;
        }
        state.drafts += 1;
        let draft = format!("gtk-draft-{}", state.drafts);
        state.draft = Some(draft.clone());
        let project = state.draft_project.clone().or_else(|| state.current_project());
        let model = state.active_model();
        let worktree = match state.settings.new_thread_workspace {
            NewThreadWorkspace::Local => WorktreeChoice::Local,
            NewThreadWorkspace::Worktree => WorktreeChoice::NewWorktree {
                branch: format!(
                    "local-studio/{}",
                    glib::DateTime::now_local().map_or_else(
                        |_| draft.clone(),
                        |now| now.format("%Y%m%d-%H%M%S").map_or_else(|_| draft.clone(), |text| text.to_string())
                    )
                ),
                base: None,
            },
        };
        let settings = ThreadSettings {
            provider: model.as_ref().map(|model| model.provider.clone()),
            model: model.map(|model| model.model),
            thinking_level: state.active_thinking(),
            access: state.active_access(),
            worktree,
        };
        drop(state);
        self.core.run(|studio| studio.start_thread(draft, project, prompt, settings));
        true
    }

    pub fn add_project(self: &Rc<Self>) {
        let dialog = gtk::FileDialog::builder().title("Add Project").modal(true).build();
        let base = self.state.borrow().settings.add_project_base_directory.clone();
        if !base.is_empty() {
            dialog.set_initial_folder(Some(&gio::File::for_path(base)));
        }
        let weak = Rc::downgrade(self);
        dialog.select_folder(Some(&self.window), None::<&gio::Cancellable>, move |result| {
            let Some(app) = weak.upgrade() else { return };
            if let Ok(folder) = result {
                if let Some(path) = folder.path() {
                    app.core.run(|studio| studio.add_project(path.to_string_lossy().into_owned()));
                }
            }
        });
    }

    pub fn open_settings(self: &Rc<Self>, page: Option<&str>) {
        let dialog = SettingsDialog::new(self);
        if let Some(page) = page {
            dialog.show_page(page);
        }
        dialog.present(self);
        self.settings.replace(Some(dialog));
        self.core.run(|studio| {
            studio.load_providers();
        });
        let request = self.core.request();
        self.core.run(|studio| studio.list_archived(request));
    }

    pub fn toast(&self, text: &str) {
        let toast = adw::Toast::new(&format::escape(text));
        toast.set_timeout(4);
        self.toasts.add_toast(toast);
    }

    fn show_banner(&self, text: &str) {
        self.banner.set_title(&format::escape(text));
        self.banner.set_revealed(true);
    }

    fn notify(&self, thread: &str, kind: NotificationKind, title: &str, body: &str) {
        let (mode, in_app, selected) = {
            let state = self.state.borrow();
            (state.settings.notifications, state.settings.in_app_notifications, state.selected.clone())
        };
        let focused = self.window.is_active() && selected.as_deref() == Some(thread);
        if focused {
            return;
        }
        if in_app {
            self.toast(&format!("{title}: {body}"));
        }
        if matches!(mode, NotificationMode::Notifications | NotificationMode::NotificationsAndSound) {
            let notification = gio::Notification::new(title);
            notification.set_body(Some(body));
            notification.set_priority(match kind {
                NotificationKind::NeedsApproval | NotificationKind::Failed => gio::NotificationPriority::High,
                NotificationKind::TurnDone => gio::NotificationPriority::Normal,
            });
            notification.set_default_action_and_target_value("app.open-thread", Some(&thread.to_variant()));
            self.application.send_notification(Some(thread), &notification);
        }
        if matches!(mode, NotificationMode::Sound | NotificationMode::NotificationsAndSound) {
            WidgetExt::display(&self.window).beep();
        }
    }

    pub fn shelf_of(&self, thread: &str) -> Option<Shelf> {
        self.state.borrow().row(thread).map(|row| row.shelf)
    }
}

impl Hero {
    fn new(app: Weak<App>) -> Self {
        let root = gtk::Box::new(gtk::Orientation::Vertical, 10);
        root.set_valign(gtk::Align::Center);
        root.set_halign(gtk::Align::Center);
        root.set_vexpand(true);
        let title = gtk::Label::new(None);
        title.add_css_class("ls-hero");
        let subtitle = gtk::Label::new(None);
        subtitle.add_css_class("dim-label");
        let actions = gtk::Box::new(gtk::Orientation::Horizontal, 8);
        actions.set_halign(gtk::Align::Center);
        actions.set_margin_top(8);
        let add = gtk::Button::with_label("Add project");
        add.add_css_class("pill");
        add.add_css_class("suggested-action");
        let weak = app.clone();
        add.connect_clicked(move |_| {
            if let Some(app) = weak.upgrade() {
                app.add_project();
            }
        });
        let without = gtk::Button::with_label("Start without a project");
        without.add_css_class("pill");
        without.connect_clicked(move |_| {
            if let Some(app) = app.upgrade() {
                app.state.borrow_mut().draft_project = None;
                app.composer.focus();
            }
        });
        actions.append(&add);
        actions.append(&without);
        root.append(&title);
        root.append(&subtitle);
        root.append(&actions);
        Self { root, title, subtitle, actions }
    }

    fn render(&self, state: &State) {
        let project = state.draft_project.as_deref().and_then(|project| state.project_name(Some(project)));
        if state.projects.is_empty() {
            self.title.set_label("What should we work on?");
            self.subtitle.set_label("Add a project, or start without one.");
            self.subtitle.set_visible(true);
            self.actions.set_visible(true);
        } else {
            self.title.set_label(&project.map_or_else(
                || "What should we work on?".to_string(),
                |name| format!("What should we build in {name}?"),
            ));
            self.subtitle.set_visible(false);
            self.actions.set_visible(false);
        }
    }
}
