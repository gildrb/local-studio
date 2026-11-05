use serde::Deserialize;
use serde_json::{Map, Value};

use crate::app_core::views::pierre_icon::PierreIconView;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActionRef {
    pub action: String,
    pub params: Map<String, Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestTabStatus {
    pub state: String,
    pub is_draft: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SurfaceIcon {
    Preview {
        url: Option<String>,
        captured_favicon_url: Option<String>,
    },
    Diff,
    Files,
    File {
        path: String,
    },
    Terminal,
    PullRequest {
        status: Option<PullRequestTabStatus>,
    },
    PullRequests,
    Agents,
    Device {
        platform: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SurfaceKind {
    Diff,
    Files,
    File,
    Preview,
    Device,
    Terminal,
    PullRequest,
    PullRequests,
    Agents,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RightPanelTab {
    pub id: String,
    pub kind: SurfaceKind,
    pub title: String,
    pub close_label: String,
    pub tooltip: String,
    pub active: bool,
    pub pending: bool,
    pub icon: SurfaceIcon,
    pub file_icon: Option<PierreIconView>,
    pub select: ActionRef,
    pub close: ActionRef,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceAction {
    pub key: String,
    pub label: String,
    pub description: Option<String>,
    pub shortcut: String,
    pub available: bool,
    pub disabled_reason: String,
    pub badge_count: u32,
    pub action: ActionRef,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LauncherView {
    pub title: String,
    pub actions: Vec<SurfaceAction>,
    pub highlighted_key: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MaximizeView {
    pub pressed: bool,
    pub label: String,
    pub icon: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WidthView {
    pub width: f32,
    pub min_width: f32,
    pub max_width: f32,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSurface {
    pub id: String,
    pub kind: SurfaceKind,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RightPanelView {
    pub thread_key: String,
    pub open: bool,
    pub animation_duration_ms: u64,
    pub maximized: bool,
    pub maximize: MaximizeView,
    pub width: WidthView,
    pub tabs: Vec<RightPanelTab>,
    pub show_add_surface_menu: bool,
    pub add_surface_actions: Vec<SurfaceAction>,
    pub launcher: Option<LauncherView>,
    pub active_surface: Option<ActiveSurface>,
}
