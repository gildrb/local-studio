use std::collections::HashMap;

use local_studio_core::{
    AccessMode, Approval, Connection, GitStatus, KernelState, Keybinding, LocalDashboard, LocalEngine, LocalSnapshot,
    ModelKey, ModelOption, Project, ProjectScript, ProjectSettings, ProviderStatus, QueuedMessage, Settings,
    SetupStage, Subagent, ThreadInfo, ThreadRow, UsagePeriod, UsageReport,
};

#[derive(Clone, Default)]
pub struct Setup {
    pub stages: Vec<SetupStage>,
    pub done: bool,
    pub error: Option<String>,
}

#[derive(Clone, Default)]
pub struct DaemonInfo {
    pub socket: String,
    pub version: Option<String>,
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Page {
    #[default]
    Thread,
    Local,
    Usage,
    PullRequests,
}

#[derive(Debug, Clone, Default)]
pub struct DraftSettings {
    pub model: Option<ModelKey>,
    pub thinking: Option<String>,
    pub access: Option<AccessMode>,
    pub compare: Vec<ModelKey>,
}

#[derive(Debug, Clone)]
pub struct PendingSend {
    pub request: String,
    pub thread: String,
    pub text: String,
    pub draft: String,
    pub queued: bool,
    pub images: u32,
    pub baseline: usize,
    pub queue_baseline: usize,
}

#[derive(Default)]
pub struct State {
    pub connection: Option<Connection>,
    pub projects: Vec<Project>,
    pub threads: Vec<ThreadRow>,
    pub selected: Option<String>,
    pub draft: Option<String>,
    pub draft_project: Option<String>,
    pub drafts: u64,
    pub draft_settings: DraftSettings,
    pub info: Option<ThreadInfo>,
    pub approvals: Vec<Approval>,
    pub queue: Vec<QueuedMessage>,
    pub models: Vec<ModelOption>,
    pub favorites: Vec<ModelKey>,
    pub hidden: Vec<ModelKey>,
    pub settings: Settings,
    pub keybindings: Vec<Keybinding>,
    pub scripts: HashMap<String, Vec<ProjectScript>>,
    pub project_settings: HashMap<String, ProjectSettings>,
    pub setup: HashMap<String, Setup>,
    pub daemon: Option<DaemonInfo>,
    pub kernel: Option<KernelState>,
    pub subagents: HashMap<String, Vec<Subagent>>,
    pub effective: HashMap<String, Settings>,
    pub providers: Vec<ProviderStatus>,
    pub archived: Vec<ThreadRow>,
    pub git: HashMap<String, GitStatus>,
    pub filter: Option<String>,
    pub search: String,
    pub page: Page,
    pub local: Option<LocalSnapshot>,
    pub dashboard: Option<LocalDashboard>,
    pub engines: Vec<LocalEngine>,
    pub provider_errors: Vec<String>,
    pub provider_pending: std::collections::HashSet<String>,
    pub provider_error: Option<String>,
    pub providers_loaded: bool,
    pub usage: Option<UsageReport>,
    pub usage_period: Option<UsagePeriod>,
    pub pending: Vec<PendingSend>,
}

impl State {
    pub fn row(&self, thread: &str) -> Option<&ThreadRow> {
        self.threads.iter().find(|row| row.id == thread).or_else(|| self.archived.iter().find(|row| row.id == thread))
    }

    pub fn project(&self, project: &str) -> Option<&Project> {
        self.projects.iter().find(|candidate| candidate.id == project)
    }

    pub fn project_name(&self, project: Option<&str>) -> Option<String> {
        let project = project?;
        Some(self.project(project).map_or_else(|| short_path(project), |project| project.name.clone()))
    }

    pub fn current_project(&self) -> Option<String> {
        if let Some(selected) = &self.selected {
            let project = self.info.as_ref().and_then(|info| info.project.clone());
            if project.is_some() {
                return project;
            }
            if let Some(project) = self.row(selected).and_then(|row| row.project.clone()) {
                return Some(project);
            }
        }
        if self.selected.is_none() && self.draft_project.is_some() {
            return self.draft_project.clone();
        }
        self.filter
            .clone()
            .or_else(|| self.threads.iter().find_map(|row| row.project.clone()))
            .or_else(|| self.projects.first().map(|project| project.id.clone()))
    }

    pub fn workspace_dir(&self) -> Option<String> {
        if self.selected.is_some() {
            if let Some(info) = &self.info {
                if let Some(worktree) = info.worktree.clone().filter(|path| !path.is_empty()) {
                    return Some(worktree);
                }
                if !info.cwd.is_empty() {
                    return Some(info.cwd.clone());
                }
            }
        }
        self.current_project()
    }

    pub fn model_option(&self, key: &ModelKey) -> Option<&ModelOption> {
        self.models.iter().find(|model| model.provider == key.provider && model.id == key.model)
    }

    pub fn active_model(&self) -> Option<ModelKey> {
        if self.selected.is_some() {
            return self
                .info
                .as_ref()
                .and_then(|info| info.model.as_ref())
                .map(|model| ModelKey { provider: model.provider.clone(), model: model.id.clone() });
        }
        self.draft_settings.model.clone().or_else(|| {
            match (&self.settings.default_provider, &self.settings.default_model) {
                (Some(provider), Some(model)) => Some(ModelKey { provider: provider.clone(), model: model.clone() }),
                _ => None,
            }
        })
    }

    pub fn active_access(&self) -> AccessMode {
        if self.selected.is_some() {
            if let Some(info) = &self.info {
                return info.access;
            }
        }
        self.draft_settings.access.unwrap_or(self.settings.default_access)
    }

    pub fn thinking_levels(&self) -> Vec<String> {
        if self.selected.is_some() {
            if let Some(info) = &self.info {
                if !info.thinking_levels.is_empty() {
                    return info.thinking_levels.clone();
                }
            }
        }
        self.active_model()
            .and_then(|key| self.model_option(&key).map(|model| model.thinking_levels.clone()))
            .unwrap_or_default()
    }

    pub fn active_thinking(&self) -> Option<String> {
        if self.selected.is_some() {
            return self.info.as_ref().map(|info| info.thinking_level.clone()).filter(|level| !level.is_empty());
        }
        self.draft_settings.thinking.clone().or_else(|| self.settings.default_thinking_level.clone())
    }

    pub fn run_start(&self, thread: &str, reported: Option<i64>) -> Option<i64> {
        let reported = reported?;
        let shown = self
            .info
            .as_ref()
            .filter(|info| info.busy && info.thread == thread && self.selected.as_deref() == Some(thread))
            .and_then(|info| info.run_started_at);
        match shown {
            Some(start) if start <= reported && reported - start < START_SKEW => Some(start),
            _ => Some(reported),
        }
    }
}

pub fn short_path(path: &str) -> String {
    std::path::Path::new(path).file_name().map_or_else(|| path.to_string(), |name| name.to_string_lossy().into_owned())
}

pub fn initials(name: &str) -> String {
    name.chars().find(|ch| ch.is_alphanumeric()).map(|ch| ch.to_uppercase().collect()).unwrap_or_default()
}

const START_SKEW: i64 = 2_000;

pub fn continued(mut info: ThreadInfo, previous: Option<&ThreadInfo>) -> ThreadInfo {
    if !info.busy {
        return info;
    }
    let earlier = previous
        .filter(|previous| previous.thread == info.thread && previous.busy)
        .and_then(|previous| previous.run_started_at);
    info.run_started_at = match (info.run_started_at, earlier) {
        (Some(start), Some(earlier)) if start > earlier && start - earlier < START_SKEW => Some(earlier),
        (None, Some(earlier)) => Some(earlier),
        (None, None) => Some(crate::format::now_ms()),
        (start, _) => start,
    };
    info
}
