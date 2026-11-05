use gpui::{AnyView, AppContext, Context, Entity, ScrollHandle};

use crate::app_core::client::CoreClient;
use crate::features::pull_requests::code::PullRequestCodeTab;
use crate::features::pull_requests::detail::PullRequestDetailSurface;
use crate::features::pull_requests::summary::PullRequestSummaryTab;
use crate::features::pull_requests::timeline::PullRequestTimelineTab;

pub fn owns_scroll(tab: &str) -> bool {
    tab == "code" || tab == "summary"
}

pub fn tab_view(
    tab: &str,
    client: Entity<CoreClient>,
    scroll: ScrollHandle,
    cx: &mut Context<PullRequestDetailSurface>,
) -> Option<AnyView> {
    match tab {
        "summary" => Some(
            cx.new(|cx| PullRequestSummaryTab::new(client, scroll, cx))
                .into(),
        ),
        "timeline" => Some(cx.new(|cx| PullRequestTimelineTab::new(client, cx)).into()),
        "code" => Some(
            cx.new(|cx| PullRequestCodeTab::new(client, scroll, cx))
                .into(),
        ),
        _ => None,
    }
}
