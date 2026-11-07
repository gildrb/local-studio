use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::{Rc, Weak};

use adw::prelude::*;
use gtk::gio;
use local_studio_core::{
    ChatWidth, Connection, Delivery, FollowUpBehavior, NotificationKind, NotificationMode, PromptDraft, Shelf,
    ThreadSettings, TranscriptOp, Update,
};

use crate::branches::BranchBar;
use crate::composer::Composer;
use crate::core::Core;
use crate::drawer::Drawer;
use crate::editor::Editors;
use crate::format;
use crate::goto::GotoFile;
use crate::header::Header;
use crate::pages::{LocalPage, UsagePage};
use crate::panels::Panel;
use crate::pulls::PullsPage;
use crate::search::ProjectSearch;
use crate::settings::SettingsDialog;
use crate::sidebar::Sidebar;
use crate::state::{Page, State};
use crate::theme;
use crate::timeline::Timeline;

pub type Hook = Rc<dyn Fn(&Rc<App>)>;
pub type SavedAccels = Vec<(String, Vec<String>)>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    Commands,
    Mentions,
    Branches,
    Files,
    Preview,
    PanelPulls,
    PanelPull,
    PagePulls,
    PagePull,
    Devices,
    ThreadSearch,
    ProjectSearch,
    DiffBases,
    GotoFile,
    HashPulls,
    Skills,
    MessageImage,
    CommitFiles,
    TerminalCopy,
    TerminalChat,
}

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
    pub banners: crate::banners::Banners,
    pub sidebar: Sidebar,
    pub header: Header,
    pub timeline: Timeline,
    pub composer: Composer,
    pub panel: Panel,
    pub drawer: Drawer,
    pub columns: gtk::Paned,
    pub goto: GotoFile,
    pub editors: Editors,
    pub saved_accels: RefCell<Option<SavedAccels>>,
    pub history: RefCell<(Vec<String>, usize)>,
    pub navigating: Cell<bool>,
    pub interactive: Cell<bool>,
    pub force_steer: Cell<bool>,
    pub wizard_shown: Cell<bool>,
    pub local: LocalPage,
    pub usage: UsagePage,
    pub pulls: PullsPage,
    pub branches: BranchBar,
    pub search: ProjectSearch,
    pub hero: Hero,
    pub settings: RefCell<Option<SettingsDialog>>,
    pub on_tick: RefCell<Option<Hook>>,
    pub requests: RefCell<HashMap<String, Target>>,
    pub undo: RefCell<Option<Hook>>,
}

pub struct Hero {
    pub root: gtk::Box,
    title: gtk::Label,
    subtitle: gtk::Label,
    actions: gtk::Box,
}

impl App {
    #[allow(clippy::too_many_lines)]
    pub fn build(application: &adw::Application) -> Rc<Self> {
        theme::install();
        let app = Rc::new_cyclic(|weak: &Weak<App>| {
            let window = adw::ApplicationWindow::builder()
                .application(application)
                .title("Local Studio")
                .default_width(1280)
                .default_height(820)
                .build();
            let width = crate::prefs::get("sidebar-width").and_then(|value| value.parse::<f64>().ok()).unwrap_or(288.0);
            let split = adw::OverlaySplitView::builder()
                .min_sidebar_width(width)
                .max_sidebar_width(width)
                .sidebar_width_fraction(1.0)
                .build();
            let sidebar = Sidebar::new(weak.clone());
            let editors = Editors::detect();
            let header = Header::build(&editors.menu());
            crate::flows::new_thread_in_on_shift(weak, header.new_thread());
            let timeline = Timeline::new(weak.clone());
            let composer = Composer::new(weak.clone());
            let panel = Panel::new(weak.clone());
            let drawer = Drawer::new(weak.clone());
            let goto = GotoFile::new(weak.clone());
            let local = LocalPage::new(weak.clone());
            let usage = UsagePage::new(weak.clone());
            let hero = Hero::new(weak.clone());
            let pulls = PullsPage::new(weak.clone());
            let branches = BranchBar::new(weak.clone());
            let search = ProjectSearch::new(weak.clone());
            let banner = adw::Banner::new("");
            let banners = crate::banners::Banners::new();
            let conversation = gtk::Stack::new();
            conversation.add_named(&hero.root, Some("hero"));
            conversation.add_named(&timeline.root, Some("timeline"));
            conversation.set_vexpand(true);
            let chat = gtk::Box::new(gtk::Orientation::Vertical, 0);
            chat.append(&conversation);
            chat.append(&composer.root);
            chat.append(&branches.root);
            let drop = crate::extras::drop_target(weak);
            let hint = gtk::Label::new(Some("Drop files to attach"));
            hint.add_css_class("ls-drop-hint");
            hint.set_can_target(false);
            hint.set_visible(false);
            let shown = hint.clone();
            drop.connect_current_drop_notify(move |target| shown.set_visible(target.current_drop().is_some()));
            chat.add_controller(drop);
            let chat_overlay = gtk::Overlay::new();
            chat_overlay.set_child(Some(&chat));
            chat_overlay.add_overlay(&hint);
            let column = gtk::Paned::new(gtk::Orientation::Vertical);
            column.set_start_child(Some(&chat_overlay));
            column.set_end_child(Some(&drawer.root));
            column.set_resize_end_child(false);
            column.set_shrink_end_child(false);
            column.set_shrink_start_child(false);
            column.set_position(520);
            column.connect_position_notify(|paned| {
                let height = paned.height();
                if height <= 0 {
                    return;
                }
                let minimum = height / 4;
                let maximum = height - 180;
                if maximum > minimum {
                    let position = paned.position().clamp(minimum, maximum);
                    if position != paned.position() {
                        paned.set_position(position);
                    }
                }
            });
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
            stack.add_named(&pulls.root, Some("pulls"));
            let sidebar_view = adw::ToolbarView::new();
            sidebar_view.add_top_bar(&sidebar.header);
            sidebar_view.set_content(Some(&sidebar.root));
            sidebar_view.add_css_class("ls-sidebar");
            let sidebar_overlay = gtk::Overlay::new();
            sidebar_overlay.set_child(Some(&sidebar_view));
            sidebar_overlay.add_overlay(&sidebar_handle(&split));
            let content_view = adw::ToolbarView::new();
            content_view.add_top_bar(&header.bar);
            content_view.add_top_bar(&banner);
            content_view.add_top_bar(&banners.notice);
            content_view.add_top_bar(&banners.provider);
            content_view.set_content(Some(&stack));
            split.set_sidebar(Some(&sidebar_overlay));
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
                banners,
                sidebar,
                header,
                timeline,
                composer,
                panel,
                drawer,
                columns,
                goto,
                editors,
                saved_accels: RefCell::new(None),
                history: RefCell::new((Vec::new(), 0)),
                navigating: Cell::new(false),
                interactive: Cell::new(false),
                force_steer: Cell::new(false),
                wizard_shown: Cell::new(false),
                local,
                usage,
                hero,
                settings: RefCell::new(None),
                on_tick: RefCell::new(None),
                requests: RefCell::new(HashMap::new()),
                undo: RefCell::new(None),
                pulls,
                branches,
                search,
            }
        });
        app.sidebar.bind_split(&app.split);
        app.header.bind_split(&app.split);
        crate::actions::install(&app);
        let weak = Rc::downgrade(&app);
        theme::on_colors(move |colors| {
            if let Some(app) = weak.upgrade() {
                app.drawer.set_colors(colors);
                crate::highlight::recolor(&colors.syntax);
                app.panel.diff.set_colors();
                app.timeline.recolor();
            }
        });
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
                let unloaded: Vec<String> = projects
                    .iter()
                    .filter(|project| !state.scripts.contains_key(&project.id))
                    .map(|project| project.id.clone())
                    .collect();
                state.projects = projects;
                drop(state);
                for project in unloaded {
                    self.core.run(|studio| studio.load_project_settings(project));
                }
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
                    self.timeline.refresh_minimap();
                }
            }
            Update::Subagents { thread, agents } => {
                let focused = self.state.borrow().selected.as_deref() == Some(thread.as_str());
                let running = agents.iter().filter(|agent| agent.running).count();
                self.state.borrow_mut().subagents.insert(thread, agents);
                if focused {
                    self.header.set_agents(running);
                    if self.panel.showing("agents") {
                        self.panel.agents.render(self);
                    }
                }
            }
            Update::Skills { request, skills } => {
                if self.take_request(&request) == Some(Target::Skills) {
                    self.composer.extras.skills_loaded(&skills);
                }
            }
            Update::MessageImage { request, mime_type: _, data } => {
                if self.take_request(&request) == Some(Target::MessageImage) {
                    crate::images::show(self, &data);
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
            Update::Models { models, favorites, hidden } => {
                let mut state = self.state.borrow_mut();
                state.models = models;
                state.favorites = favorites;
                state.hidden = hidden;
                dirty.composer = true;
                dirty.settings = true;
            }
            Update::Commands { request, commands } => {
                if self.take_request(&request) == Some(Target::Commands) {
                    self.composer.extras.commands_loaded(commands);
                }
            }
            Update::Branches { request, branches, total } => match self.take_request(&request) {
                Some(Target::Branches) => self.branches.loaded(&branches, total),
                Some(Target::DiffBases) => {
                    self.panel.diff.bases_loaded(branches.into_iter().map(|branch| branch.name).collect());
                }
                _ => {}
            },
            Update::Files { request, entries } => {
                if self.take_request(&request) == Some(Target::Files) {
                    self.panel.files.loaded(&entries);
                }
            }
            Update::FileContent { request, path, content } => {
                if self.take_request(&request) == Some(Target::Preview) {
                    self.panel.files.preview(&path, &content);
                }
            }
            Update::SearchResults { request, results } => match self.take_request(&request) {
                Some(Target::Mentions) => self.composer.extras.mentions_loaded(&request, &results),
                Some(Target::ProjectSearch) => self.search.loaded(&request, &results),
                Some(Target::GotoFile) => self.goto.loaded(&request, &results),
                _ => {}
            },
            Update::PullRequests { request, pulls } => match self.take_request(&request) {
                Some(Target::PanelPulls) => self.panel.pulls.loaded(&pulls),
                Some(Target::PagePulls) => self.pulls.loaded(&pulls),
                Some(Target::HashPulls) => self.composer.extras.pulls_loaded(&pulls),
                _ => {}
            },
            Update::PullRequestDetail { request, detail } => match self.take_request(&request) {
                Some(Target::PanelPull) => self.panel.pulls.detail(&detail),
                Some(Target::PagePull) => self.pulls.detail(&detail),
                _ => {}
            },
            Update::Devices { request, devices } => {
                if self.take_request(&request) == Some(Target::Devices) {
                    self.panel.devices.loaded(&devices);
                }
            }
            Update::ThreadSearch { request, hits } => {
                if self.take_request(&request) == Some(Target::ThreadSearch) {
                    self.sidebar.search_loaded(&request, hits);
                    dirty.sidebar = true;
                }
            }
            Update::Notification { thread, kind, title, body } => self.notify(&thread, kind, &title, &body),
            Update::GitStatus { project, status } => {
                self.state.borrow_mut().git.insert(project, status);
                dirty.header = true;
            }
            Update::Diff { request, files } => {
                if self.take_request(&request) == Some(Target::CommitFiles) {
                    crate::commit::files_loaded(&files);
                } else {
                    self.panel.diff.loaded(&request, &files);
                }
            }
            Update::TerminalOpened { request, terminal } => {
                self.drawer.opened(&request, &terminal);
            }
            Update::TerminalFrame { terminal, frame } => self.drawer.frame(&terminal, &frame),
            Update::TerminalText { request, terminal: _, text } => {
                if let Some(target @ (Target::TerminalCopy | Target::TerminalChat)) = self.take_request(&request) {
                    Drawer::text_arrived(self, target, &text);
                }
            }
            Update::TerminalExited { terminal, code } => self.drawer.exited(&terminal, code),
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
                dirty.header = true;
            }
            Update::Settings { settings } => {
                self.apply_settings(&settings);
                let onboard =
                    self.interactive.get() && !settings.onboarding_completed && !self.wizard_shown.replace(true);
                self.state.borrow_mut().settings = settings;
                if onboard {
                    let weak = Rc::downgrade(self);
                    gtk::glib::idle_add_local_once(move || {
                        if let Some(app) = weak.upgrade() {
                            crate::wizard::present(&app);
                        }
                    });
                }
                dirty.composer = true;
                dirty.sidebar = true;
                dirty.settings = true;
            }
            Update::Keybindings { bindings } => {
                self.state.borrow_mut().keybindings = bindings;
                crate::bindings::apply(self);
                dirty.settings = true;
            }
            Update::ProjectScripts { project, scripts } => {
                for script in scripts.iter().filter(|script| !script.id.contains('\'')) {
                    let accel = script.keybinding.as_deref().map(crate::format::accelerator);
                    let accels: Vec<&str> = accel.iter().map(String::as_str).collect();
                    self.application.set_accels_for_action(&format!("win.run-script('{}')", script.id), &accels);
                }
                self.state.borrow_mut().scripts.insert(project, scripts);
                dirty.header = true;
                crate::project::refresh(self);
            }
            Update::ProjectSettings { project, settings, effective } => {
                let mut state = self.state.borrow_mut();
                state.project_settings.insert(project.clone(), settings);
                state.effective.insert(project, effective);
                drop(state);
                crate::project::refresh(self);
                dirty.composer = true;
            }
            Update::WorktreeSetup { thread, stages, done, error } => {
                self.state.borrow_mut().setup.insert(thread, crate::state::Setup { stages, done, error });
                dirty.composer = true;
            }
            Update::Daemon { socket, version, pid } => {
                self.state.borrow_mut().daemon = Some(crate::state::DaemonInfo { socket, version, pid });
                dirty.settings = true;
            }
            Update::RequestDone { request: _, message } => self.toast(&message),
            Update::RequestFailed { request, message } => {
                self.local.request_failed();
                match self.take_request(&request) {
                    Some(Target::Mentions | Target::Commands | Target::ThreadSearch) => {}
                    Some(Target::PanelPulls | Target::PanelPull) => self.panel.pulls.failed(&message),
                    Some(Target::PagePulls | Target::PagePull) => self.pulls.failed(&message),
                    Some(Target::Files | Target::Preview) => self.panel.files.failed(&message),
                    Some(Target::Devices) => self.panel.devices.failed(&message),
                    _ => self.toast(&message),
                }
            }
            Update::Notice { level, text } => match level {
                local_studio_core::NoticeLevel::Error | local_studio_core::NoticeLevel::Warning => {
                    self.show_notice(&text);
                }
                local_studio_core::NoticeLevel::Info => self.toast(&text),
            },
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
                self.banners.render(&state);
            }
            if dirty.composer || dirty.page || dirty.header {
                self.composer.render(&state);
                self.branches.render(&state);
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
            Page::PullRequests => "pulls",
        };
        self.stack.set_visible_child_name(page);
        let show_hero = state.selected.is_none();
        self.conversation.set_visible_child_name(if show_hero { "hero" } else { "timeline" });
        if show_hero {
            self.hero.render(state);
        }
    }

    pub fn navigate(self: &Rc<Self>, delta: isize) {
        let target = {
            let mut history = self.history.borrow_mut();
            let Some(next) = history.1.checked_add_signed(delta).filter(|next| *next < history.0.len()) else {
                return;
            };
            history.1 = next;
            history.0.get(next).cloned()
        };
        if let Some(thread) = target {
            self.navigating.set(true);
            self.select_thread(Some(thread));
            self.navigating.set(false);
        }
    }

    pub fn select_thread(self: &Rc<Self>, thread: Option<String>) {
        if let (Some(id), false) = (&thread, self.navigating.get()) {
            let mut history = self.history.borrow_mut();
            let keep = (history.1 + 1).min(history.0.len());
            history.0.truncate(keep);
            if history.0.last() != Some(id) {
                history.0.push(id.clone());
            }
            history.1 = history.0.len() - 1;
        }
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
        self.composer.reset();
        self.core.run(|studio| studio.select_thread(thread.clone()));
        let running = thread.as_deref().map_or(0, |id| {
            self.state
                .borrow()
                .subagents
                .get(id)
                .map_or(0, |agents| agents.iter().filter(|agent| agent.running).count())
        });
        self.header.set_agents(running);
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
        self.branches.reset();
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
            Page::PullRequests => self.pulls.refresh(self),
        }
        self.render(Dirty { page: true, header: true, sidebar: true, ..Dirty::default() });
    }

    pub fn ask(&self, target: Target) -> String {
        let request = self.core.request();
        self.requests.borrow_mut().insert(request.clone(), target);
        request
    }

    fn take_request(&self, request: &str) -> Option<Target> {
        self.requests.borrow_mut().remove(request)
    }

    pub fn send(self: &Rc<Self>, prompt: PromptDraft) {
        let mut state = self.state.borrow_mut();
        if let Some(thread) = state.selected.clone() {
            let busy = state.info.as_ref().is_some_and(|info| info.busy);
            let forced = self.force_steer.take();
            let steer = busy && (forced || state.settings.follow_up_behavior == FollowUpBehavior::Steer);
            drop(state);
            self.core.run(|studio| studio.send(thread, prompt, if steer { Delivery::Steer } else { Delivery::Queue }));
            return;
        }
        state.drafts += 1;
        let draft = format!("gtk-draft-{}", state.drafts);
        state.draft = Some(draft.clone());
        let project = state.draft_project.clone().or_else(|| state.current_project());
        let model = state.active_model();
        let model_key = model.clone();
        let worktree = self.branches.choice(&state, &draft);
        let settings = ThreadSettings {
            provider: model.as_ref().map(|model| model.provider.clone()),
            model: model.map(|model| model.model),
            thinking_level: state.active_thinking(),
            access: state.active_access(),
            worktree,
        };
        let compare = std::mem::take(&mut state.draft_settings.compare);
        let models: Vec<local_studio_core::ModelKey> = model_key.into_iter().chain(compare).collect();
        drop(state);
        if models.len() > 1 {
            self.core.run(|studio| studio.start_threads(draft, project, prompt, settings, models));
        } else {
            self.core.run(|studio| studio.start_thread(draft, project, prompt, settings));
        }
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

    pub fn apply_settings(&self, settings: &local_studio_core::Settings) {
        theme::color_scheme(settings.color_scheme);
        theme::apply(settings);
        let width = match settings.chat_width {
            ChatWidth::Normal => 820,
            ChatWidth::Wide => 1150,
            ChatWidth::Full => 4000,
        };
        self.timeline.set_width(width);
        self.composer.root.set_maximum_size(width);
        self.branches.root.set_maximum_size(width);
        self.panel.diff.apply_settings(settings);
        self.drawer.set_font(&settings.terminal_font, settings.terminal_font_size);
        self.drawer.set_blink(settings.terminal_cursor_blink);
    }

    pub fn open_surface(self: &Rc<Self>, kind: &str) {
        if kind == "terminal" {
            self.drawer.show(self);
        } else {
            self.panel.show(kind);
        }
    }

    pub fn set_panel_maximized(&self, maximized: bool) {
        if let Some(start) = self.columns.start_child() {
            start.set_visible(!maximized);
        }
        self.panel.set_maximized(maximized);
    }

    pub fn terminal_focus(&self, focused: bool) {
        if focused == self.saved_accels.borrow().is_some() {
            return;
        }
        if focused {
            let saved: Vec<(String, Vec<String>)> = self
                .application
                .list_action_descriptions()
                .iter()
                .map(|action| {
                    let accels = self.application.accels_for_action(action).iter().map(ToString::to_string).collect();
                    (action.to_string(), accels)
                })
                .filter(|(action, accels): &(String, Vec<String>)| {
                    !accels.is_empty() && action != "win.toggle-terminal"
                })
                .collect();
            for (action, _) in &saved {
                self.application.set_accels_for_action(action, &[]);
            }
            self.saved_accels.replace(Some(saved));
        } else if let Some(saved) = self.saved_accels.take() {
            for (action, accels) in saved {
                let accels: Vec<&str> = accels.iter().map(String::as_str).collect();
                self.application.set_accels_for_action(&action, &accels);
            }
        }
    }

    pub fn toast(&self, text: &str) {
        let toast = adw::Toast::new(&format::escape(text));
        toast.set_timeout(4);
        self.toasts.add_toast(toast);
    }

    pub fn show_notice(&self, text: &str) {
        self.banners.show_notice(text);
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
            crate::sound::play(match kind {
                NotificationKind::TurnDone => crate::sound::Sound::Completion,
                NotificationKind::NeedsApproval | NotificationKind::Failed => crate::sound::Sound::Input,
            });
        }
    }

    pub fn shelf_of(&self, thread: &str) -> Option<Shelf> {
        self.state.borrow().row(thread).map(|row| row.shelf)
    }
}

fn sidebar_handle(split: &adw::OverlaySplitView) -> gtk::Box {
    let handle = gtk::Box::new(gtk::Orientation::Vertical, 0);
    handle.set_halign(gtk::Align::End);
    handle.set_width_request(6);
    handle.add_css_class("ls-sidebar-handle");
    handle.set_cursor_from_name(Some("col-resize"));
    let drag = gtk::GestureDrag::new();
    let start = Rc::new(Cell::new(0.0));
    let (begin, moving) = (Rc::clone(&start), split.clone());
    drag.connect_drag_begin(move |_, _, _| begin.set(moving.max_sidebar_width()));
    let resizing = split.clone();
    drag.connect_drag_update(move |_, dx, _| {
        let width = (start.get() + dx).clamp(220.0, 480.0).round();
        resizing.set_min_sidebar_width(width);
        resizing.set_max_sidebar_width(width);
    });
    let saving = split.clone();
    drag.connect_drag_end(move |_, _, _| crate::prefs::set("sidebar-width", &saving.max_sidebar_width().to_string()));
    handle.add_controller(drag);
    let reset = gtk::GestureClick::new();
    let resetting = split.clone();
    reset.connect_pressed(move |_, presses, _, _| {
        if presses == 2 {
            resetting.set_min_sidebar_width(288.0);
            resetting.set_max_sidebar_width(288.0);
            crate::prefs::set("sidebar-width", "288");
        }
    });
    handle.add_controller(reset);
    handle
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
