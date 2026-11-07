use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;

use super::git;

const QUIET: Duration = Duration::from_millis(300);

type Routes = Arc<Mutex<HashMap<PathBuf, BTreeSet<String>>>>;

pub(crate) struct GitWatcher {
    watcher: Mutex<Option<RecommendedWatcher>>,
    routes: Routes,
    watched: Mutex<HashMap<String, Vec<(PathBuf, RecursiveMode)>>>,
}

fn relevant(path: &Path) -> bool {
    let text = path.to_string_lossy();
    if text.contains("/logs/") || text.contains("/objects/") {
        return false;
    }
    let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    name == "HEAD" || name == "index" || name == "packed-refs" || text.contains("/refs/")
}

impl GitWatcher {
    pub(crate) fn new(changed: mpsc::UnboundedSender<String>) -> Self {
        let routes: Routes = Arc::default();
        let lookup = Arc::clone(&routes);
        let watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            let Ok(event) = event else { return };
            let routes = lookup.lock().unwrap_or_else(PoisonError::into_inner);
            let mut projects = BTreeSet::new();
            for path in event.paths.iter().filter(|path| relevant(path)) {
                for (root, owners) in routes.iter() {
                    if path.starts_with(root) {
                        projects.extend(owners.iter().cloned());
                    }
                }
            }
            for project in projects {
                let _ = changed.send(project);
            }
        })
        .ok();
        Self { watcher: Mutex::new(watcher), routes, watched: Mutex::new(HashMap::new()) }
    }

    pub(crate) async fn set_projects(&self, projects: Vec<String>) {
        let wanted: BTreeSet<String> = projects.into_iter().collect();
        let current: BTreeSet<String> =
            self.watched.lock().unwrap_or_else(PoisonError::into_inner).keys().cloned().collect();
        for project in current.difference(&wanted) {
            self.unwatch(project);
        }
        for project in wanted.difference(&current) {
            let Some((git_dir, common)) = git::watch_dirs(Path::new(project)).await else { continue };
            let mut targets =
                vec![(git_dir.clone(), RecursiveMode::NonRecursive), (common.join("refs"), RecursiveMode::Recursive)];
            if common != git_dir {
                targets.push((common, RecursiveMode::NonRecursive));
            }
            self.watch(project, targets);
        }
    }

    fn watch(&self, project: &str, targets: Vec<(PathBuf, RecursiveMode)>) {
        let mut watcher = self.watcher.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(watcher) = watcher.as_mut() else { return };
        let mut routes = self.routes.lock().unwrap_or_else(PoisonError::into_inner);
        let mut added = Vec::new();
        for (path, mode) in targets {
            if watcher.watch(&path, mode).is_ok() {
                routes.entry(path.clone()).or_default().insert(project.to_string());
                added.push((path, mode));
            }
        }
        self.watched.lock().unwrap_or_else(PoisonError::into_inner).insert(project.to_string(), added);
    }

    fn unwatch(&self, project: &str) {
        let Some(targets) = self.watched.lock().unwrap_or_else(PoisonError::into_inner).remove(project) else { return };
        let mut watcher = self.watcher.lock().unwrap_or_else(PoisonError::into_inner);
        let mut routes = self.routes.lock().unwrap_or_else(PoisonError::into_inner);
        for (path, _) in targets {
            let empty = routes.get_mut(&path).is_some_and(|owners| {
                owners.remove(project);
                owners.is_empty()
            });
            if empty {
                routes.remove(&path);
                if let Some(watcher) = watcher.as_mut() {
                    let _ = watcher.unwatch(&path);
                }
            }
        }
    }

    pub(crate) fn stop(&self) {
        self.watcher.lock().unwrap_or_else(PoisonError::into_inner).take();
        self.routes.lock().unwrap_or_else(PoisonError::into_inner).clear();
        self.watched.lock().unwrap_or_else(PoisonError::into_inner).clear();
    }
}

pub(crate) async fn debounce(mut changed: mpsc::UnboundedReceiver<String>, mut emit: impl FnMut(String)) {
    while let Some(first) = changed.recv().await {
        let mut pending = BTreeSet::from([first]);
        while let Ok(Some(project)) = tokio::time::timeout(QUIET, changed.recv()).await {
            pending.insert(project);
        }
        for project in pending {
            emit(project);
        }
    }
}
