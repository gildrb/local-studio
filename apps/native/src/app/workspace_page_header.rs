use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, InteractiveElement, IntoElement, MouseButton, ParentElement, RenderOnce,
    Styled, Window, div, px,
};

use crate::ui::theme;
use crate::ui::theme::metrics::workspace;

pub const GUTTER: f32 = 20.;

#[derive(IntoElement)]
pub struct WorkspacePageHeader {
    inset_left: Option<f32>,
    auto_height: bool,
    children: Vec<AnyElement>,
}

impl WorkspacePageHeader {
    pub fn new() -> Self {
        Self {
            inset_left: None,
            auto_height: false,
            children: Vec::new(),
        }
    }

    pub fn collapsed_sidebar_inset(mut self, inset: Option<f32>) -> Self {
        self.inset_left = inset;
        self
    }

    pub fn auto_height(mut self, auto_height: bool) -> Self {
        self.auto_height = auto_height;
        self
    }
}

impl Default for WorkspacePageHeader {
    fn default() -> Self {
        Self::new()
    }
}

impl ParentElement for WorkspacePageHeader {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for WorkspacePageHeader {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        div()
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(12.))
            .when(!self.auto_height, |this| {
                this.h(px(workspace::TOPBAR_HEIGHT))
            })
            .min_h(px(workspace::TOPBAR_HEIGHT))
            .pl(px(self.inset_left.unwrap_or(GUTTER)))
            .pr(px(GUTTER))
            .bg(t.background)
            .on_mouse_down(MouseButton::Left, |_, window, _| window.start_window_move())
            .children(self.children)
    }
}
