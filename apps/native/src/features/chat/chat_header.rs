use gpui::prelude::FluentBuilder;
use gpui::{
    App, InteractiveElement, IntoElement, MouseButton, MouseDownEvent, ParentElement, RenderOnce,
    Styled, Window, div, px,
};

use crate::app::workspace_breadcrumb::{
    WorkspaceBreadcrumb, WorkspaceBreadcrumbItem, WorkspaceBreadcrumbSeparator,
    WorkspaceBreadcrumbText,
};
use crate::app_core::views::app_shell::AppShellThreadHeaderView;
use crate::features::chat::thread_title::ThreadTitleHost;
use crate::ui::project_favicon::ProjectFavicon;

const PROJECT_FAVICON: f32 = 14.;
const PROJECT_NAME_MAX: f32 = 160.;

#[derive(IntoElement)]
pub struct ChatHeader {
    view: AppShellThreadHeaderView,
}

impl ChatHeader {
    pub fn new(view: &AppShellThreadHeaderView) -> Self {
        Self { view: view.clone() }
    }
}

impl RenderOnce for ChatHeader {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let view = self.view;
        let host = ThreadTitleHost::global(cx);
        let mut breadcrumb = WorkspaceBreadcrumb::new();
        if let Some(project) = &view.project {
            breadcrumb = breadcrumb
                .child(
                    WorkspaceBreadcrumbItem::new(false).shrink().child(
                        div()
                            .flex()
                            .min_w_0()
                            .items_center()
                            .gap(px(6.))
                            .child(ProjectFavicon::new(&project.icon, PROJECT_FAVICON))
                            .child(
                                WorkspaceBreadcrumbText::new(project.name.clone())
                                    .max_width(PROJECT_NAME_MAX),
                            ),
                    ),
                )
                .child(WorkspaceBreadcrumbSeparator);
        }
        let title = match &host {
            Some(host) if host.read(cx).view(cx).is_some() => {
                ThreadTitleHost::render_title(host, window, cx)
            }
            _ => WorkspaceBreadcrumbText::new(view.title).into_any_element(),
        };
        let breadcrumb = breadcrumb.child(WorkspaceBreadcrumbItem::new(true).grow().child(title));
        div()
            .flex()
            .flex_1()
            .min_w_0()
            .items_center()
            .gap(px(12.))
            .when_some(host, |this, host| {
                this.on_mouse_down(MouseButton::Right, move |event: &MouseDownEvent, _, cx| {
                    if ThreadTitleHost::context_menu(&host, event.position, cx) {
                        cx.stop_propagation();
                    }
                })
            })
            .child(breadcrumb)
    }
}
