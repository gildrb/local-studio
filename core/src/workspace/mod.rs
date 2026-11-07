mod api;
mod cleanup;
mod devices;
mod diff;
mod files;
mod forge;
mod git;
mod links;
mod local;
pub mod model;
mod process;
mod projects;
mod providers;
mod settings;
mod setup;
mod terminal;
mod time;
mod usage;
mod watch;
mod writer;

pub use self::api::terminal_preview;
pub use self::providers::endpoint_presets;
pub(crate) use self::setup::PreparedWorktree;

use std::collections::{BTreeMap, HashMap};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use tokio::runtime::Handle;
use tokio::sync::{mpsc, watch as channel};

use self::devices::Devices;
use self::links::Links;
use self::local::Local;
use self::model::{DiffScope, LocalAction, MergeMethod, PullRequest, Settings, TerminalSize, UsagePeriod};
use self::projects::ProjectFile;
use self::setup::Setups;
use self::terminal::{Launch, Message, Terminals};
use self::watch::GitWatcher;
use crate::daemon::DaemonQuery;
use crate::model::{NoticeLevel, Update};
use crate::oneshot::TextGen;
use crate::studio::Mailbox;

const PULL_REQUEST_TTL: Duration = Duration::from_secs(60);
const DASHBOARD_EVERY: Duration = Duration::from_secs(3);

type ProjectAdder = Arc<dyn Fn(String) + Send + Sync>;

type ModelsReloader = Arc<dyn Fn(Option<(String, String)>) + Send + Sync>;

type CachedPullRequest = (Instant, Option<PullRequest>);

struct Inner {
    runtime: Handle,
    mailbox: Arc<Mailbox>,
    data_dir: PathBuf,
    agent_dir: Option<PathBuf>,
    daemon: DaemonQuery,
    settings: channel::Sender<Settings>,
    save_lock: tokio::sync::Mutex<()>,
    keybindings: Mutex<BTreeMap<String, Option<String>>>,
    turn_files: Mutex<HashMap<String, BTreeMap<u64, Vec<String>>>>,
    projects: Mutex<Vec<String>>,
    terminals: Terminals,
    devices: Devices,
    local: Local,
    dashboard: Mutex<Option<tokio::task::AbortHandle>>,
    watcher: GitWatcher,
    watch_lock: tokio::sync::Mutex<()>,
    pull_requests: Mutex<HashMap<(String, String), CachedPullRequest>>,
    providers: Mutex<providers::ProviderState>,
    providers_lock: tokio::sync::Mutex<()>,
    models_reloader: Mutex<Option<ModelsReloader>>,
    stopped: AtomicBool,
    project_file: Mutex<ProjectFile>,
    setups: Setups,
    links: Links,
    protected: Mutex<Vec<PathBuf>>,
    project_adder: Mutex<Option<ProjectAdder>>,
    text: TextGen,
}

#[derive(Clone)]
pub(crate) struct Workspace {
    inner: Arc<Inner>,
}

impl Workspace {
    pub(crate) fn new(
        runtime: Handle,
        mailbox: Arc<Mailbox>,
        data_dir: PathBuf,
        agent_dir: Option<PathBuf>,
        daemon: DaemonQuery,
        controller_main: Option<PathBuf>,
        text: TextGen,
    ) -> Self {
        let (loaded, settings_error) = settings::load_json::<Settings>(&data_dir.join("settings.json"));
        let (overrides, keybindings_error) =
            settings::load_json::<BTreeMap<String, Option<String>>>(&data_dir.join("keybindings.json"));
        for error in [settings_error, keybindings_error].into_iter().flatten() {
            mailbox.notice(NoticeLevel::Warning, error);
        }
        let loaded = settings::sanitize(loaded);
        let (project_file, projects_error) =
            settings::load_json::<ProjectFile>(&data_dir.join("project-workspace.json"));
        if let Some(error) = projects_error {
            mailbox.notice(NoticeLevel::Warning, error);
        }
        mailbox.push(Update::Settings { settings: loaded.clone() });
        mailbox.push(Update::Keybindings { bindings: settings::keybindings(&overrides) });
        let (notify, notifications) = mpsc::unbounded_channel();
        let inner = Arc::new(Inner {
            local: Local::new(&data_dir, controller_main),
            dashboard: Mutex::new(None),
            devices: Devices::default(),
            runtime,
            mailbox,
            data_dir,
            agent_dir,
            daemon,
            settings: channel::Sender::new(loaded),
            save_lock: tokio::sync::Mutex::new(()),
            keybindings: Mutex::new(overrides),
            turn_files: Mutex::new(HashMap::new()),
            projects: Mutex::new(Vec::new()),
            terminals: Terminals::default(),
            watcher: GitWatcher::new(notify),
            watch_lock: tokio::sync::Mutex::new(()),
            pull_requests: Mutex::new(HashMap::new()),
            providers: Mutex::new(providers::ProviderState::default()),
            providers_lock: tokio::sync::Mutex::new(()),
            models_reloader: Mutex::new(None),
            stopped: AtomicBool::new(false),
            project_file: Mutex::new(project_file),
            setups: Setups::default(),
            links: Links::default(),
            protected: Mutex::new(Vec::new()),
            project_adder: Mutex::new(None),
            text,
        });
        let workspace = Self { inner };
        let refresher = workspace.clone();
        workspace.inner.runtime.spawn(watch::debounce(notifications, move |project| refresher.git_status(project)));
        let fetcher = workspace.clone();
        workspace.inner.runtime.spawn(async move { fetcher.fetch_loop().await });
        let sweeper = workspace.clone();
        workspace.inner.runtime.spawn(async move { sweeper.cleanup_loop().await });
        workspace
    }

    pub(crate) fn settings(&self) -> channel::Receiver<Settings> {
        self.inner.settings.subscribe()
    }

    fn current_settings(&self) -> Settings {
        self.inner.settings.borrow().clone()
    }

    pub(crate) fn watch_projects(&self, projects: Vec<String>) {
        projects.clone_into(&mut self.inner.projects.lock().unwrap_or_else(PoisonError::into_inner));
        let workspace = self.clone();
        self.inner.runtime.spawn(async move {
            let _guard = workspace.inner.watch_lock.lock().await;
            workspace.inner.watcher.set_projects(projects).await;
        });
    }

    pub(crate) fn record_turn_files(&self, thread: String, turn: u64, files: Vec<String>) {
        let projects = self.inner.projects.lock().unwrap_or_else(PoisonError::into_inner).clone();
        let touched: Vec<String> = projects
            .into_iter()
            .filter(|project| files.iter().any(|file| Path::new(file).starts_with(project)))
            .collect();
        self.inner
            .turn_files
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .entry(thread)
            .or_default()
            .insert(turn, files);
        for project in touched {
            self.git_status(project);
        }
    }

    pub(crate) async fn create_worktree_path(
        &self,
        project: &Path,
        branch: &str,
        base: Option<&str>,
    ) -> Result<PathBuf, String> {
        git::create_worktree(project, &self.inner.data_dir.join("worktrees"), branch, base).await
    }

    pub(crate) fn shutdown(&self) {
        self.inner.stopped.store(true, Ordering::SeqCst);
        self.inner.terminals.close_all();
        self.inner.watcher.stop();
        self.inner.local.shutdown();
        self.inner.devices.shutdown_all();
        self.inner.setups.stop_all();
    }

    fn push(&self, update: Update) {
        self.inner.mailbox.push(update);
    }

    fn error(&self, text: impl Into<String>) {
        self.inner.mailbox.notice(NoticeLevel::Error, text);
    }

    fn answer<F>(&self, request: String, work: F)
    where
        F: Future<Output = Result<Vec<Update>, String>> + Send + 'static,
    {
        let mailbox = Arc::clone(&self.inner.mailbox);
        self.inner.runtime.spawn(async move {
            match work.await {
                Ok(updates) => {
                    for update in updates {
                        mailbox.push(update);
                    }
                }
                Err(message) => mailbox.push(Update::RequestFailed { request, message }),
            }
        });
    }

    fn answer_blocking<F>(&self, request: String, work: F)
    where
        F: FnOnce() -> Result<Update, String> + Send + 'static,
    {
        self.answer(request, async move {
            tokio::task::spawn_blocking(work).await.map_err(|error| error.to_string())?.map(|update| vec![update])
        });
    }

    async fn status_update(&self, project: &str) -> Result<Update, String> {
        let mut status = git::status(Path::new(project)).await?;
        if let Some(branch) = status.branch.clone().filter(|_| status.upstream.is_some()) {
            status.pull_request = self.pull_request_for(project, &branch).await;
        }
        self.refresh_links_for(project);
        Ok(Update::GitStatus { project: project.to_string(), status })
    }

    async fn pull_request_for(&self, project: &str, branch: &str) -> Option<PullRequest> {
        let key = (project.to_string(), branch.to_string());
        if let Some((at, cached)) = self.inner.pull_requests.lock().unwrap_or_else(PoisonError::into_inner).get(&key) {
            if at.elapsed() < PULL_REQUEST_TTL {
                return cached.clone();
            }
        }
        let found = git::branch_pull_request(Path::new(project), branch).await;
        self.inner
            .pull_requests
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(key, (Instant::now(), found.clone()));
        found
    }

    fn forget_pull_requests(&self, project: &str) {
        self.inner
            .pull_requests
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .retain(|(owner, _), _| owner != project);
    }

    pub(crate) fn git_status(&self, project: String) {
        let workspace = self.clone();
        self.inner.runtime.spawn(async move {
            match workspace.status_update(&project).await {
                Ok(update) => workspace.push(update),
                Err(message) => workspace.error(format!("Git status for {project}: {message}")),
            }
        });
    }

    async fn fetch_loop(&self) {
        loop {
            let interval = u64::from(self.current_settings().git_fetch_interval_seconds);
            tokio::time::sleep(Duration::from_secs(if interval == 0 { 30 } else { interval.max(10) })).await;
            if self.inner.stopped.load(Ordering::SeqCst) {
                return;
            }
            let settings = self.current_settings();
            if settings.git_fetch_interval_seconds == 0 {
                continue;
            }
            let projects = self.inner.projects.lock().unwrap_or_else(PoisonError::into_inner).clone();
            for project in projects {
                if self.inner.stopped.load(Ordering::SeqCst) {
                    return;
                }
                if git::fetch(Path::new(&project), settings.auto_pull).await {
                    self.git_status(project);
                }
            }
        }
    }

    pub(crate) fn list_branches(&self, request: String, project: String, query: String, limit: u32) {
        let reply = request.clone();
        self.answer(request, async move {
            let (branches, total) = git::branches(Path::new(&project), &query, limit).await?;
            Ok(vec![Update::Branches { request: reply, branches, total }])
        });
    }

    pub(crate) fn create_worktree(&self, request: String, project: String, branch: String, base: Option<String>) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let path = workspace.create_worktree_path(Path::new(&project), &branch, base.as_deref()).await?;
            let path = path.to_string_lossy().into_owned();
            let status = workspace.status_update(&path).await?;
            Ok(vec![status, Update::RequestDone { request: reply, message: path }])
        });
    }

    fn turn_paths(&self, project: &str, thread: &str, turn: Option<u64>) -> Vec<String> {
        let root = Path::new(project).canonicalize().unwrap_or_else(|_| PathBuf::from(project));
        let turns = self.inner.turn_files.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(by_turn) = turns.get(thread) else { return Vec::new() };
        let files = match turn {
            Some(turn) => by_turn.get(&turn),
            None => by_turn.values().next_back(),
        };
        files
            .into_iter()
            .flatten()
            .filter_map(|file| {
                let path = Path::new(file);
                let relative = if path.is_absolute() {
                    path.strip_prefix(&root).or_else(|_| path.strip_prefix(project)).ok()?.to_path_buf()
                } else {
                    path.to_path_buf()
                };
                let relative = relative.to_string_lossy().into_owned();
                (!relative.is_empty()).then(|| format!(":(literal){relative}"))
            })
            .collect()
    }

    pub(crate) fn load_diff(&self, request: String, project: String, scope: DiffScope) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let whitespace = workspace.current_settings().hide_whitespace;
            let root = Path::new(&project);
            let files = match scope {
                DiffScope::WorkingTree => git::diff_against(root, None, None, whitespace).await?,
                DiffScope::Branch { base } => {
                    let base = git::merge_base(root, base).await?;
                    git::diff_against(root, Some(base), None, whitespace).await?
                }
                DiffScope::LatestTurn { thread } => {
                    let paths = workspace.turn_paths(&project, &thread, None);
                    git::diff_against(root, None, Some(&paths), whitespace).await?
                }
                DiffScope::Turn { thread, turn } => {
                    let paths = workspace.turn_paths(&project, &thread, Some(turn));
                    git::diff_against(root, None, Some(&paths), whitespace).await?
                }
            };
            Ok(vec![Update::Diff { request: reply, files }])
        });
    }

    pub(crate) fn commit(&self, request: String, project: String, message: Option<String>) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let style = workspace.current_settings().writing_style;
            let message = match message.filter(|text| !text.trim().is_empty()) {
                Some(message) => Some(message),
                None => workspace.generated_commit_message(Path::new(&project)).await,
            };
            let done = git::commit(Path::new(&project), message, style).await?;
            let status = workspace.status_update(&project).await?;
            Ok(vec![status, Update::RequestDone { request: reply, message: done }])
        });
    }

    pub(crate) fn push_branch(&self, request: String, project: String) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let done = git::push(Path::new(&project)).await?;
            workspace.forget_pull_requests(&project);
            let status = workspace.status_update(&project).await?;
            Ok(vec![status, Update::RequestDone { request: reply, message: done }])
        });
    }

    pub(crate) fn create_pull_request(
        &self,
        request: String,
        project: String,
        title: String,
        body: String,
        draft: bool,
    ) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let (title, body) = workspace.pull_request_text(Path::new(&project), &title, &body).await;
            let pull = git::create_pull_request(Path::new(&project), &title, &body, draft).await?;
            workspace.forget_pull_requests(&project);
            let status = workspace.status_update(&project).await?;
            Ok(vec![status, Update::PullRequests { request: reply, pulls: vec![pull] }])
        });
    }

    pub(crate) fn checkout_pull_request(&self, request: String, project: String, number: u64) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let root = workspace.inner.data_dir.join("worktrees");
            let path = git::checkout_pull_request(Path::new(&project), &root, number).await?;
            let path = path.to_string_lossy().into_owned();
            let status = workspace.status_update(&path).await?;
            Ok(vec![status, Update::RequestDone { request: reply, message: path }])
        });
    }

    pub(crate) fn clone_project(&self, request: String, url: String, parent_dir: String) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let path = git::clone_project(&url, Path::new(&parent_dir)).await?;
            let path = path.to_string_lossy().into_owned();
            workspace.add_project_path(path.clone());
            Ok(vec![Update::RequestDone { request: reply, message: path }])
        });
    }

    pub(crate) fn merge_pull_request(
        &self,
        request: String,
        project: String,
        number: u64,
        method: Option<MergeMethod>,
    ) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let method = method.unwrap_or_else(|| workspace.current_settings().merge_method);
            let done = git::merge_pull_request(Path::new(&project), number, method).await?;
            workspace.forget_pull_requests(&project);
            let status = workspace.status_update(&project).await?;
            Ok(vec![status, Update::RequestDone { request: reply, message: done }])
        });
    }

    pub(crate) fn load_pull_request(&self, request: String, project: String, number: u64) {
        let reply = request.clone();
        self.answer(request, async move {
            let detail = forge::pull_request_detail(Path::new(&project), number).await?;
            Ok(vec![Update::PullRequestDetail { request: reply, detail }])
        });
    }

    pub(crate) fn pull(&self, request: String, project: String) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let done = git::pull(Path::new(&project)).await?;
            let status = workspace.status_update(&project).await?;
            Ok(vec![status, Update::RequestDone { request: reply, message: done }])
        });
    }

    pub(crate) fn publish_repository(&self, request: String, project: String, name: String, private: bool) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let done = git::publish_repository(Path::new(&project), &name, private).await?;
            workspace.forget_pull_requests(&project);
            let status = workspace.status_update(&project).await?;
            Ok(vec![status, Update::RequestDone { request: reply, message: done }])
        });
    }

    pub(crate) fn list_devices(&self, request: String) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let (devices, missing) = workspace.inner.devices.list().await;
            if devices.is_empty() && !missing.is_empty() {
                workspace.inner.mailbox.notice(NoticeLevel::Info, missing.join(" "));
            }
            Ok(vec![Update::Devices { request: reply, devices }])
        });
    }

    pub(crate) fn boot_device(&self, request: String, device: String) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let done = workspace.inner.devices.boot(&device).await?;
            Ok(vec![Update::RequestDone { request: reply, message: done }])
        });
    }

    pub(crate) fn shutdown_device(&self, request: String, device: String) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let done = workspace.inner.devices.shutdown(&device).await?;
            Ok(vec![Update::RequestDone { request: reply, message: done }])
        });
    }

    pub(crate) fn list_pull_requests(&self, request: String, project: String) {
        let reply = request.clone();
        self.answer(request, async move {
            let pulls = git::list_pull_requests(Path::new(&project)).await?;
            Ok(vec![Update::PullRequests { request: reply, pulls }])
        });
    }

    pub(crate) fn list_directory(&self, request: String, project: String, relative: String) {
        let reply = request.clone();
        self.answer_blocking(request, move || {
            let entries = files::list_directory(&project, &relative)?;
            Ok(Update::Files { request: reply, entries })
        });
    }

    pub(crate) fn read_file(&self, request: String, project: String, relative: String) {
        let reply = request.clone();
        self.answer_blocking(request, move || {
            let (path, content) = files::read_file(&project, &relative)?;
            Ok(Update::FileContent { request: reply, path, content })
        });
    }

    pub(crate) fn search_files(&self, request: String, project: String, query: String, limit: u32) {
        let reply = request.clone();
        self.answer_blocking(request, move || {
            let results = files::search_files(&project, &query, limit)?;
            Ok(Update::SearchResults { request: reply, results })
        });
    }

    pub(crate) fn search_text(&self, request: String, project: String, query: String, limit: u32) {
        let reply = request.clone();
        self.answer_blocking(request, move || {
            let results = files::search_text(&project, &query, limit)?;
            Ok(Update::SearchResults { request: reply, results })
        });
    }

    pub(crate) fn open_terminal(&self, request: String, project: String, cols: u16, rows: u16) {
        let workspace = self.clone();
        let scrollback = self.current_settings().terminal_scrollback;
        self.inner.runtime.spawn_blocking(move || {
            let inner = &workspace.inner;
            let opened = files::root(&project).and_then(|root| {
                let launch = Launch { cwd: &root, cols, rows, scrollback };
                inner.terminals.open(&inner.mailbox, request.clone(), &launch)
            });
            if let Err(message) = opened {
                workspace.push(Update::RequestFailed { request, message });
            }
        });
    }

    pub(crate) fn write_terminal(&self, terminal: String, data: Vec<u8>) {
        self.terminal(terminal, Message::Write(data));
    }

    pub(crate) fn resize_terminal(&self, terminal: String, size: TerminalSize) {
        self.terminal(terminal, Message::Resize(size));
    }

    pub(crate) fn terminal(&self, terminal: String, message: Message) {
        if let Err(message) = self.inner.terminals.send(terminal, message) {
            self.error(message);
        }
    }

    pub(crate) fn terminal_request(&self, request: String, terminal: String, message: Message) {
        if let Err(message) = self.inner.terminals.send(terminal, message) {
            self.push(Update::RequestFailed { request, message });
        }
    }

    pub(crate) fn close_terminal(&self, terminal: String) {
        if let Err(message) = self.inner.terminals.close(terminal) {
            self.error(message);
        }
    }

    pub(crate) fn load_usage(&self, request: String, period: UsagePeriod) {
        let daemon = self.inner.daemon.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let report = usage::load(&daemon, period, time::now_ms()).await?;
            Ok(vec![Update::Usage { request: reply, report }])
        });
    }

    pub(crate) fn local_snapshot(&self, request: String) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let snapshot = workspace.inner.local.snapshot(&workspace.current_settings()).await?;
            workspace.fleet_seen(snapshot.controllers.clone());
            Ok(vec![Update::Local { request: reply, snapshot }])
        });
    }

    pub(crate) fn local_action(&self, request: String, action: LocalAction) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let snapshot = workspace.inner.local.act(&workspace.current_settings(), action).await?;
            workspace.fleet_seen(snapshot.controllers.clone());
            Ok(vec![Update::Local { request: reply, snapshot }])
        });
    }

    pub(crate) fn watch_local_dashboard(&self, controller: Option<String>) {
        let mut slot = self.inner.dashboard.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(previous) = slot.take() {
            previous.abort();
        }
        let Some(controller) = controller else { return };
        let workspace = self.clone();
        let task = self.inner.runtime.spawn(async move {
            let mut watch = local::dashboard::DashboardWatch::new(controller);
            while !workspace.inner.stopped.load(Ordering::SeqCst) {
                let dashboard = workspace.inner.local.dashboard(&workspace.current_settings(), &mut watch).await;
                workspace.push(Update::LocalDashboard { dashboard });
                tokio::time::sleep(DASHBOARD_EVERY).await;
            }
        });
        *slot = Some(task.abort_handle());
    }

    pub(crate) fn update_settings(&self, settings: Settings) {
        let workspace = self.clone();
        self.inner.runtime.spawn(async move {
            let settings = settings::sanitize(settings);
            let _guard = workspace.inner.save_lock.lock().await;
            let path = workspace.inner.data_dir.join("settings.json");
            let saved = settings.clone();
            let result = tokio::task::spawn_blocking(move || settings::save_json(&path, &saved))
                .await
                .map_err(|error| error.to_string())
                .and_then(|result| result);
            if let Err(message) = result {
                workspace.error(message);
            }
            workspace.inner.settings.send_replace(settings.clone());
            workspace.push(Update::Settings { settings });
            workspace.push_overridden_projects();
        });
    }

    pub(crate) fn set_keybinding(&self, command: String, shortcut: Option<String>) {
        if !settings::is_known_command(&command) {
            self.error(format!("Unknown command {command}."));
            return;
        }
        let shortcut = match shortcut.map(|shortcut| settings::normalize_shortcut(&shortcut)).transpose() {
            Ok(shortcut) => shortcut,
            Err(message) => {
                self.error(message);
                return;
            }
        };
        let overrides = {
            let mut overrides = self.inner.keybindings.lock().unwrap_or_else(PoisonError::into_inner);
            let default = settings::keybindings(&BTreeMap::new())
                .into_iter()
                .find(|binding| binding.command == command)
                .and_then(|binding| binding.default_shortcut);
            if shortcut == default {
                overrides.remove(&command);
            } else {
                overrides.insert(command, shortcut);
            }
            overrides.clone()
        };
        self.push(Update::Keybindings { bindings: settings::keybindings(&overrides) });
        let workspace = self.clone();
        self.inner.runtime.spawn(async move {
            let _guard = workspace.inner.save_lock.lock().await;
            let path = workspace.inner.data_dir.join("keybindings.json");
            let result = tokio::task::spawn_blocking(move || settings::save_json(&path, &overrides))
                .await
                .map_err(|error| error.to_string())
                .and_then(|result| result);
            if let Err(message) = result {
                workspace.error(message);
            }
        });
    }
}
