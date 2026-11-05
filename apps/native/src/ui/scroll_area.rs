use gpui::Refineable;
use gpui::component::scroll::{Scrollbar, ScrollbarAxis, ScrollbarMode};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, ElementId, InteractiveElement, IntoElement, ParentElement, RenderOnce, Rgba,
    ScrollHandle, StatefulInteractiveElement, StyleRefinement, Styled, Window, div,
    linear_color_stop, linear_gradient, px,
};

use crate::ui::theme;
use crate::ui::theme::color::{alpha, hsla};
use crate::ui::theme::metrics::workspace;

pub const FADE_SIZE: f32 = 24.;
pub const SCROLLBAR_MARGIN: f32 = 4.;
pub const SCROLLBAR_EDGE: f32 = 1.;

#[derive(IntoElement)]
pub struct ScrollArea {
    id: ElementId,
    handle: Option<ScrollHandle>,
    axis: ScrollbarAxis,
    hide_scrollbars: bool,
    fade: Option<Rgba>,
    fade_size: f32,
    children: Vec<AnyElement>,
    style: StyleRefinement,
}

impl ScrollArea {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            handle: None,
            axis: ScrollbarAxis::Vertical,
            hide_scrollbars: false,
            fade: None,
            fade_size: FADE_SIZE,
            children: Vec::new(),
            style: StyleRefinement::default(),
        }
    }

    pub fn track_scroll(mut self, handle: &ScrollHandle) -> Self {
        self.handle = Some(handle.clone());
        self
    }

    pub fn axis(mut self, axis: ScrollbarAxis) -> Self {
        self.axis = axis;
        self
    }

    pub fn hide_scrollbars(mut self, hide: bool) -> Self {
        self.hide_scrollbars = hide;
        self
    }

    pub fn scroll_fade(mut self, surface: Rgba) -> Self {
        self.fade = Some(surface);
        self
    }

    pub fn fade_size(mut self, size: f32) -> Self {
        self.fade_size = size;
        self
    }
}

impl ParentElement for ScrollArea {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl Styled for ScrollArea {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

fn fade_edge(surface: Rgba, size: f32, top: bool) -> impl IntoElement {
    div()
        .absolute()
        .left_0()
        .right_0()
        .h(px(size))
        .map(|this| if top { this.top_0() } else { this.bottom_0() })
        .bg(linear_gradient(
            if top { 180. } else { 0. },
            linear_color_stop(hsla(surface), 0.),
            linear_color_stop(hsla(alpha(surface, 0.)), 1.),
        ))
}

impl RenderOnce for ScrollArea {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let handle = match self.handle {
            Some(handle) => handle,
            None => window
                .use_keyed_state(self.id.clone(), cx, |_, _| ScrollHandle::new())
                .read(cx)
                .clone(),
        };
        let t = theme::active(cx);
        let (thumb, thumb_hover) = (t.scrollbar_thumb, t.scrollbar_thumb_hover);
        let viewport = div()
            .id(self.id.clone())
            .size_full()
            .map(|this| match self.axis {
                ScrollbarAxis::Vertical => this.overflow_y_scroll(),
                ScrollbarAxis::Horizontal => this.overflow_x_scroll(),
                ScrollbarAxis::Both => this.overflow_scroll(),
            })
            .track_scroll(&handle)
            .children(self.children);
        let fades = self.fade.map(|surface| {
            let offset = handle.offset();
            let max = handle.max_offset();
            let size = self.fade_size;
            let top = offset.y < px(0.);
            let bottom = -offset.y < max.y;
            (
                top.then(|| fade_edge(surface, size, true)),
                bottom.then(|| fade_edge(surface, size, false)),
            )
        });
        let (top, bottom) = fades.unwrap_or((None, None));
        let mut root = div().relative().size_full().min_h_0().overflow_hidden();
        root.style().refine(&self.style);
        root.child(viewport)
            .children(top)
            .children(bottom)
            .when(!self.hide_scrollbars, |this| {
                this.child(
                    div().absolute().inset_0().child(
                        Scrollbar::new(&handle)
                            .id((self.id.clone(), "scrollbar"))
                            .axis(self.axis)
                            .mode(ScrollbarMode::Hover)
                            .styles(|styles| {
                                styles
                                    .thumb(|style| {
                                        style
                                            .bg(hsla(thumb))
                                            .width(px(workspace::SCROLLBAR_WIDTH))
                                            .inset(px(SCROLLBAR_EDGE))
                                            .radius(px(workspace::SCROLLBAR_WIDTH / 2.))
                                    })
                                    .thumb_hover(|style| style.bg(hsla(thumb_hover)))
                                    .thumb_active(|style| style.bg(hsla(thumb_hover)))
                            }),
                    ),
                )
            })
    }
}
