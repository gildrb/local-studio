use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::PoisonError;
use std::time::Duration;

use super::time::{now_ms, DAY_MS};
use super::{git, Workspace};
use crate::model::{NoticeLevel, Update};

const SWEEP_INTERVAL: Duration = Duration::from_secs(3600);
const FIRST_SWEEP: Duration = Duration::from_secs(120);

fn canonical(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

impl Workspace {
    pub(crate) fn protect_worktrees(&self, paths: Vec<String>) {
        let canonical: Vec<PathBuf> = paths.into_iter().map(|path| canonical(Path::new(&path))).collect();
        *self.inner.protected.lock().unwrap_or_else(PoisonError::into_inner) = canonical;
    }

    fn worktree_root(&self) -> PathBuf {
        canonical(&self.inner.data_dir.join("worktrees"))
    }

    fn is_protected(&self, worktree: &Path) -> bool {
        self.inner.protected.lock().unwrap_or_else(PoisonError::into_inner).iter().any(|path| path == worktree)
    }

    fn owned_worktree(&self, worktree: &Path) -> Option<PathBuf> {
        let worktree = canonical(worktree);
        let root = self.worktree_root();
        (worktree != root && worktree.starts_with(&root)).then_some(worktree)
    }

    pub(crate) fn thread_deleted(&self, worktree: Option<String>) {
        let Some(worktree) = worktree.and_then(|path| self.owned_worktree(Path::new(&path))) else { return };
        if !self.current_settings().worktree_cleanup_on_delete || self.is_protected(&worktree) {
            return;
        }
        let workspace = self.clone();
        self.inner.runtime.spawn(async move {
            if let Err(error) = workspace.remove_owned(&worktree).await {
                workspace.inner.mailbox.notice(NoticeLevel::Warning, format!("Worktree kept: {error}"));
            }
        });
    }

    async fn remove_owned(&self, worktree: &Path) -> Result<(), String> {
        if !git::is_clean(worktree).await {
            return Err(format!("{} has uncommitted changes.", worktree.display()));
        }
        let main =
            git::worktree_main(worktree).await.ok_or_else(|| format!("{} is not a worktree.", worktree.display()))?;
        git::remove_clean_worktree(&main, worktree).await?;
        if let Some(parent) = worktree.parent() {
            let _ = std::fs::remove_dir(parent);
        }
        Ok(())
    }

    async fn should_remove(&self, worktree: &Path) -> bool {
        let settings = self.current_settings();
        if !git::is_clean(worktree).await {
            return false;
        }
        if settings.worktree_cleanup_unchanged && git::head_is_merged_into_default(worktree).await {
            return true;
        }
        if settings.worktree_cleanup_on_merge {
            if let Some(branch) = git::current_branch(worktree).await {
                let dir = worktree.to_string_lossy().into_owned();
                let merged = match self.inner.links.merged(&dir, &branch) {
                    Some(merged) => merged,
                    None => git::branch_pull_request_list(worktree, &branch)
                        .await
                        .ok()
                        .flatten()
                        .is_some_and(|pull| pull.state.eq_ignore_ascii_case("MERGED")),
                };
                if merged {
                    return true;
                }
            }
        }
        if let Some(days) = settings.worktree_cleanup_after_days {
            let age_limit = i64::from(days) * DAY_MS;
            if git::last_activity_ms(worktree).await.is_some_and(|last| now_ms() - last > age_limit) {
                return true;
            }
        }
        false
    }

    async fn sweep(&self) -> Vec<PathBuf> {
        let root = self.worktree_root();
        let mut candidates = Vec::new();
        for project in std::fs::read_dir(&root).into_iter().flatten().flatten() {
            for worktree in std::fs::read_dir(project.path()).into_iter().flatten().flatten() {
                if worktree.path().join(".git").is_file() {
                    candidates.push(canonical(&worktree.path()));
                }
            }
        }
        let mut removed = Vec::new();
        for worktree in candidates {
            if self.is_protected(&worktree) || !self.should_remove(&worktree).await {
                continue;
            }
            if self.remove_owned(&worktree).await.is_ok() {
                removed.push(worktree);
            }
        }
        removed
    }

    fn cleanup_enabled(&self) -> bool {
        let settings = self.current_settings();
        settings.worktree_cleanup_unchanged
            || settings.worktree_cleanup_on_merge
            || settings.worktree_cleanup_after_days.is_some()
    }

    pub(crate) async fn cleanup_loop(&self) {
        tokio::time::sleep(FIRST_SWEEP).await;
        loop {
            if self.inner.stopped.load(Ordering::SeqCst) {
                return;
            }
            if self.cleanup_enabled() {
                let removed = self.sweep().await;
                if !removed.is_empty() {
                    self.inner.mailbox.notice(
                        NoticeLevel::Info,
                        format!("Removed {} Local Studio worktree(s) per the retention settings.", removed.len()),
                    );
                }
            }
            tokio::time::sleep(SWEEP_INTERVAL).await;
        }
    }

    pub(crate) fn cleanup_worktrees(&self, request: String) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            if !workspace.cleanup_enabled() {
                return Err("Turn on a worktree cleanup rule in Settings → Storage first.".to_string());
            }
            let removed = workspace.sweep().await;
            let message = match removed.len() {
                0 => "No worktrees matched the cleanup rules.".to_string(),
                count => format!(
                    "Removed {count} worktree(s): {}",
                    removed.iter().map(|path| path.display().to_string()).collect::<Vec<_>>().join(", ")
                ),
            };
            Ok(vec![Update::RequestDone { request: reply, message }])
        });
    }
}
