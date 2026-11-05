use serde::Deserialize;

use super::sidebar::ProjectIconView;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectionPhase {
    Connecting,
    Ready,
    Reconnecting,
    Failed,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionView {
    pub phase: ConnectionPhase,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActiveEnvironmentView {
    pub environment_id: String,
    pub label: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum AppShellRoute {
    Home,
    Thread {
        environment_id: String,
        thread_id: String,
    },
    Draft {
        draft_id: String,
    },
    Settings {
        section: String,
    },
    Usage,
    PullRequests,
    Project {
        project_key: String,
    },
    Welcome,
    Pair,
    Connect,
}

impl AppShellRoute {
    pub fn is_chat(&self) -> bool {
        matches!(
            self,
            AppShellRoute::Home | AppShellRoute::Thread { .. } | AppShellRoute::Draft { .. }
        )
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ThreadHeaderProjectView {
    pub name: String,
    pub icon: ProjectIconView,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppShellThreadHeaderView {
    pub project: Option<ThreadHeaderProjectView>,
    pub title: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppShellView {
    pub connection: ConnectionView,
    pub active_environment: Option<ActiveEnvironmentView>,
    pub primary_server_version: Option<String>,
    pub route: AppShellRoute,
    pub thread_header: Option<AppShellThreadHeaderView>,
}
