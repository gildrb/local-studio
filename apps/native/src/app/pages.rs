use gpui::{AnyElement, App, IntoElement, div};

use crate::app::root::Connected;
use crate::app_core::views::app_shell::AppShellRoute;

pub fn page_content(route: Option<&AppShellRoute>, connected: &Connected, cx: &App) -> AnyElement {
    match route {
        Some(AppShellRoute::Settings { .. } | AppShellRoute::Project { .. }) => {
            connected.settings_page.clone().into_any_element()
        }
        Some(AppShellRoute::PullRequests) => {
            connected.pull_requests_page.clone().into_any_element()
        }
        Some(AppShellRoute::Usage) => connected.usage_page.clone().into_any_element(),
        Some(AppShellRoute::Welcome) => crate::features::onboarding::welcome_page(
            &connected.onboarding,
            connected.onboarding.read(cx).collapsed_inset,
            cx,
        ),
        Some(
            AppShellRoute::Home
            | AppShellRoute::Thread { .. }
            | AppShellRoute::Draft { .. }
            | AppShellRoute::Pair
            | AppShellRoute::Connect,
        )
        | None => div().into_any_element(),
    }
}
