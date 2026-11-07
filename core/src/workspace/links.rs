use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use tokio::sync::watch;

use super::model::PullRequest;
use super::{git, process, Workspace};

const FRESH: Duration = Duration::from_secs(120);

struct Entry {
    fetched: Option<Instant>,
    pull: Option<PullRequest>,
    loading: bool,
}

pub(crate) struct Links {
    cache: Mutex<HashMap<(String, String), Entry>>,
    changed: watch::Sender<u64>,
}

impl Default for Links {
    fn default() -> Self {
        Self { cache: Mutex::new(HashMap::new()), changed: watch::Sender::new(0) }
    }
}

impl Links {
    pub(crate) fn merged(&self, dir: &str, branch: &str) -> Option<bool> {
        let cache = self.cache.lock().unwrap_or_else(PoisonError::into_inner);
        let entry = cache.get(&(dir.to_string(), branch.to_string()))?;
        entry.fetched?;
        Some(entry.pull.as_ref().is_some_and(|pull| pull.state.eq_ignore_ascii_case("MERGED")))
    }
}

impl Workspace {
    pub(crate) fn pull_requests_changed(&self) -> watch::Receiver<u64> {
        self.inner.links.changed.subscribe()
    }

    pub(crate) fn thread_pull_request(&self, dir: &str, branch: &str) -> Option<PullRequest> {
        if branch.trim().is_empty() || process::which("gh").is_none() {
            return None;
        }
        let key = (dir.to_string(), branch.to_string());
        let (pull, stale) = {
            let mut cache = self.inner.links.cache.lock().unwrap_or_else(PoisonError::into_inner);
            let entry = cache.entry(key.clone()).or_insert(Entry { fetched: None, pull: None, loading: false });
            let stale = !entry.loading && entry.fetched.is_none_or(|at| at.elapsed() > FRESH);
            if stale {
                entry.loading = true;
            }
            (entry.pull.clone(), stale)
        };
        if stale {
            self.fetch_link(key);
        }
        pull
    }

    pub(crate) fn refresh_links_for(&self, dir: &str) {
        let keys: Vec<(String, String)> = {
            let mut cache = self.inner.links.cache.lock().unwrap_or_else(PoisonError::into_inner);
            cache
                .iter_mut()
                .filter(|((owner, _), entry)| owner == dir && !entry.loading)
                .map(|(key, entry)| {
                    entry.loading = true;
                    key.clone()
                })
                .collect()
        };
        for key in keys {
            self.fetch_link(key);
        }
    }

    fn fetch_link(&self, key: (String, String)) {
        let workspace = self.clone();
        self.inner.runtime.spawn(async move {
            let found = git::branch_pull_request_list(Path::new(&key.0), &key.1).await;
            let changed = {
                let mut cache = workspace.inner.links.cache.lock().unwrap_or_else(PoisonError::into_inner);
                let entry = cache.entry(key).or_insert(Entry { fetched: None, pull: None, loading: false });
                entry.loading = false;
                entry.fetched = Some(Instant::now());
                found.is_ok_and(|pull| {
                    let changed = entry.pull != pull;
                    entry.pull = pull;
                    changed
                })
            };
            if changed {
                workspace.inner.links.changed.send_modify(|version| *version += 1);
            }
        });
    }
}
