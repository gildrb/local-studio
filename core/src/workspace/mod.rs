mod api;
mod diff;
mod files;
mod git;
mod local;
pub mod model;
mod process;
mod providers;
mod settings;
mod terminal;
mod time;
mod usage;
mod watch;

use std::collections::{BTreeMap, HashMap};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use tokio::runtime::Handle;
use tokio::sync::{mpsc, watch as channel};

use self::local::Local;
use self::model::{DiffScope, LocalAction, PullRequest, Settings, UsagePeriod};
use self::terminal::Terminals;
use self::watch::GitWatcher;
use crate::daemon::DaemonQuery;
use crate::model::{ModelOption, NoticeLevel, Update};
use crate::studio::Mailbox;

const PULL_REQUEST_TTL: Duration = Duration::from_secs(60);

type CachedPullRequest = (Instant, Option<PullRequest>);

struct Inner {
    runtime: Handle,
    mailbox: Arc<Mailbox>,
    data_dir: PathBuf,
    daemon: DaemonQuery,
    settings: channel::Sender<Settings>,
    save_lock: tokio::sync::Mutex<()>,
    keybindings: Mutex<BTreeMap<String, Option<String>>>,
    turn_files: Mutex<HashMap<String, BTreeMap<u64, Vec<String>>>>,
    projects: Mutex<Vec<String>>,
    terminals: Terminals,
    local: Local,
    watcher: GitWatcher,
    watch_lock: tokio::sync::Mutex<()>,
    pull_requests: Mutex<HashMap<(String, String), CachedPullRequest>>,
    providers: Mutex<Option<Vec<model::ProviderStatus>>>,
    stopped: AtomicBool,
}

#[derive(Clone)]
pub(crate) struct Workspace {
    inner: Arc<Inner>,
}

impl Workspace {
    pub(crate) fn new(runtime: Handle, mailbox: Arc<Mailbox>, data_dir: PathBuf, daemon: DaemonQuery) -> Self {
        let (loaded, settings_error) = settings::load_json::<Settings>(&data_dir.join("settings.json"));
        let (overrides, keybindings_error) =
            settings::load_json::<BTreeMap<String, Option<String>>>(&data_dir.join("keybindings.json"));
        for error in [settings_error, keybindings_error].into_iter().flatten() {
            mailbox.notice(NoticeLevel::Warning, error);
        }
        let loaded = settings::sanitize(loaded);
        mailbox.push(Update::Settings { settings: loaded.clone() });
        mailbox.push(Update::Keybindings { bindings: settings::keybindings(&overrides) });
        let (notify, notifications) = mpsc::unbounded_channel();
        let inner = Arc::new(Inner {
            local: Local::new(&data_dir),
            runtime,
            mailbox,
            data_dir,
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
            providers: Mutex::new(None),
            stopped: AtomicBool::new(false),
        });
        let workspace = Self { inner };
        let refresher = workspace.clone();
        workspace.inner.runtime.spawn(watch::debounce(notifications, move |project| refresher.git_status(project)));
        let fetcher = workspace.clone();
        workspace.inner.runtime.spawn(async move { fetcher.fetch_loop().await });
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

    pub(crate) fn models_loaded(&self, models: &[ModelOption]) {
        let statuses = providers::statuses(models);
        *self.inner.providers.lock().unwrap_or_else(PoisonError::into_inner) = Some(statuses.clone());
        self.inner.mailbox.push(Update::Providers { providers: statuses });
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
            let pull = git::create_pull_request(Path::new(&project), &title, &body, draft).await?;
            workspace.forget_pull_requests(&project);
            let status = workspace.status_update(&project).await?;
            Ok(vec![status, Update::PullRequests { request: reply, pulls: vec![pull] }])
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
        self.inner.runtime.spawn_blocking(move || {
            let inner = &workspace.inner;
            let opened = files::root(&project).and_then(|root| {
                inner.terminals.open(&inner.runtime, &inner.mailbox, request.clone(), &root, cols, rows)
            });
            if let Err(message) = opened {
                workspace.push(Update::RequestFailed { request, message });
            }
        });
    }

    pub(crate) fn write_terminal(&self, terminal: String, data: Vec<u8>) {
        if let Err(message) = self.inner.terminals.write(terminal, data) {
            self.error(message);
        }
    }

    pub(crate) fn resize_terminal(&self, terminal: String, cols: u16, rows: u16) {
        if let Err(message) = self.inner.terminals.resize(terminal, cols, rows) {
            self.error(message);
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
            Ok(vec![Update::Local { request: reply, snapshot }])
        });
    }

    pub(crate) fn local_action(&self, request: String, action: LocalAction) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let snapshot = workspace.inner.local.act(&workspace.current_settings(), action).await?;
            Ok(vec![Update::Local { request: reply, snapshot }])
        });
    }

    pub(crate) fn push_cached_providers(&self) {
        let cached = self.inner.providers.lock().unwrap_or_else(PoisonError::into_inner).clone();
        if let Some(providers) = cached {
            self.push(Update::Providers { providers });
        }
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
