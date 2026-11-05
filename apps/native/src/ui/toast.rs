use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, ClickEvent, ElementId, FontWeight, Hsla, InteractiveElement, IntoElement,
    ParentElement, RenderOnce, Rgba, SharedString, StatefulInteractiveElement, Styled, Window,
    anchored, deferred, div, point, px, relative,
};

use super::menu::icon;
use super::popover::HoverHandler;
use super::popover::{black, dropdown_glass, shadow};
use crate::ui::theme::metrics::{radius, text, workspace};
use crate::ui::theme::tokens::fade;
use crate::ui::theme::{Tokens, active};

pub const TOAST_LAYER: usize = 100;
pub const VIEWPORT_INSET: f32 = 32.;
pub const MAX_WIDTH: f32 = 360.;
pub const GAP: f32 = 12.;
pub const PEEK: f32 = 12.;
pub const SCALE_STEP: f32 = 0.1;
pub const CONTENT_PADDING_LEFT: f32 = 14.;
pub const CONTENT_PADDING_Y: f32 = 12.;
pub const STACKED_PADDING_Y: f32 = 10.;
pub const END_PADDING: f32 = 40.;
pub const END_PADDING_WITH_CONTROLS: f32 = 24.;
pub const ORB_SIZE: f32 = 24.;
pub const ORB_OFFSET: f32 = -6.;
pub const VISIBLE_LIMIT: usize = 3;

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

fn c(color: Rgba) -> Hsla {
    color.into()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum ToastKind {
    #[default]
    Default,
    Success,
    Error,
    Info,
    Warning,
    Loading,
}

impl ToastKind {
    fn icon(self, t: &Tokens) -> Option<(&'static str, Rgba, f32)> {
        match self {
            ToastKind::Default => None,
            ToastKind::Success => Some(("circle-check", t.success, 1.)),
            ToastKind::Error => Some(("circle-alert", t.destructive, 1.)),
            ToastKind::Info => Some(("info", t.info, 1.)),
            ToastKind::Warning => Some(("triangle-alert", t.warning, 1.)),
            ToastKind::Loading => Some(("loader-circle", t.foreground, 0.8)),
        }
    }
}

#[derive(Clone)]
pub struct ToastAction {
    pub label: SharedString,
    pub on_click: ClickHandler,
}

#[derive(IntoElement)]
pub struct Toast {
    id: ElementId,
    kind: ToastKind,
    title: SharedString,
    description: Option<SharedString>,
    action: Option<ToastAction>,
    stacked: bool,
    on_dismiss: Option<ClickHandler>,
}

impl Toast {
    pub fn new(id: impl Into<ElementId>, title: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            kind: ToastKind::Default,
            title: title.into(),
            description: None,
            action: None,
            stacked: false,
            on_dismiss: None,
        }
    }

    pub fn kind(mut self, kind: ToastKind) -> Self {
        self.kind = kind;
        self
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }

    pub fn action(
        mut self,
        label: impl Into<SharedString>,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.action = Some(ToastAction {
            label: label.into(),
            on_click: Rc::new(handler),
        });
        self
    }

    pub fn stacked(mut self, stacked: bool) -> Self {
        self.stacked = stacked;
        self
    }

    pub fn on_dismiss(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_dismiss = Some(Rc::new(handler));
        self
    }
}

fn dismiss_orb(id: ElementId, t: &Tokens, handler: Option<ClickHandler>) -> impl IntoElement {
    let hover_bg = c(t.popover);
    let hover_fg = c(t.foreground);
    div()
        .absolute()
        .top(px(ORB_OFFSET))
        .right(px(ORB_OFFSET))
        .child(
            div()
                .id(id)
                .flex()
                .items_center()
                .justify_center()
                .size(px(ORB_SIZE))
                .rounded(px(radius::FULL))
                .backdrop_blur(px(8.))
                .border_1()
                .border_color(c(fade(t.border, 0.6)))
                .bg(c(fade(t.popover, 0.92)))
                .text_color(c(t.muted_foreground))
                .shadow(vec![
                    shadow(0., 1., 3., 0., black(0.1)),
                    shadow(0., 1., 2., -1., black(0.1)),
                ])
                .cursor_pointer()
                .hover(move |s| s.bg(hover_bg).text_color(hover_fg))
                .child(
                    gpui::svg()
                        .path("icons/x.svg")
                        .size(px(12.))
                        .text_color(c(t.muted_foreground)),
                )
                .when_some(handler, |s, handler| {
                    s.on_click(move |event, window, cx| handler(event, window, cx))
                }),
        )
}

fn action_button(id: ElementId, t: &Tokens, action: ToastAction) -> impl IntoElement {
    let hover = c(t.primary_hover);
    let handler = action.on_click;
    div()
        .id(id)
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .h(px(24.))
        .px(px(7.))
        .rounded(px(radius::CONTROL))
        .border_1()
        .border_color(c(t.primary))
        .bg(c(t.primary))
        .text_color(c(t.primary_foreground))
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .font_weight(FontWeight::MEDIUM)
        .cursor_pointer()
        .hover(move |s| s.bg(hover))
        .child(action.label)
        .on_click(move |event, window, cx| handler(event, window, cx))
}

impl RenderOnce for Toast {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        let orb_id = ElementId::Name(SharedString::from(format!("{}-dismiss", self.id)));
        let action_id = ElementId::Name(SharedString::from(format!("{}-action", self.id)));
        let has_action = self.action.is_some();
        let body = div()
            .flex()
            .flex_col()
            .min_w_0()
            .gap(px(2.))
            .when(!self.stacked, |s| s.flex_1())
            .when(self.stacked, |s| s.pr(px(20.)))
            .child(
                div()
                    .flex()
                    .min_w_0()
                    .gap(px(8.))
                    .when_some(self.kind.icon(&t), |s, (name, color, opacity)| {
                        s.child(
                            div()
                                .flex()
                                .flex_none()
                                .items_center()
                                .justify_center()
                                .w(px(16.))
                                .h(px(text::SM_LINE))
                                .opacity(opacity)
                                .child(icon(name, 16., color)),
                        )
                    })
                    .child(
                        div()
                            .min_w_0()
                            .font_weight(FontWeight::MEDIUM)
                            .child(self.title),
                    ),
            )
            .when_some(self.description, |s, description| {
                s.child(
                    div()
                        .min_w_0()
                        .text_color(c(t.muted_foreground))
                        .child(description),
                )
            });
        let content = div()
            .min_h_0()
            .pl(px(CONTENT_PADDING_LEFT))
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .map(|s| {
                if self.stacked {
                    s.flex()
                        .flex_col()
                        .gap(px(8.))
                        .py(px(STACKED_PADDING_Y))
                        .pr(px(CONTENT_PADDING_LEFT))
                } else {
                    s.flex()
                        .items_center()
                        .justify_between()
                        .gap(px(6.))
                        .py(px(CONTENT_PADDING_Y))
                        .pr(px(if has_action {
                            END_PADDING_WITH_CONTROLS
                        } else {
                            END_PADDING
                        }))
                }
            })
            .child(body)
            .when_some(self.action, |s, action| {
                s.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .map(|d| {
                            if self.stacked {
                                d.w_full().justify_end()
                            } else {
                                d.flex_none()
                            }
                        })
                        .child(action_button(action_id, &t, action)),
                )
            });
        dropdown_glass(cx)
            .id(self.id)
            .w_full()
            .flex_col()
            .shadow(vec![
                shadow(0., 20., 25., -5., black(0.25)),
                shadow(0., 8., 10., -6., black(0.25)),
            ])
            .child(dismiss_orb(orb_id, &t, self.on_dismiss))
            .child(content)
    }
}

#[derive(IntoElement)]
pub struct ToastViewport {
    id: ElementId,
    expanded: bool,
    on_hover: Option<HoverHandler>,
    toasts: Vec<Toast>,
}

impl ToastViewport {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            expanded: false,
            on_hover: None,
            toasts: Vec::new(),
        }
    }

    pub fn expanded(mut self, expanded: bool) -> Self {
        self.expanded = expanded;
        self
    }

    pub fn on_hover(mut self, handler: impl Fn(&bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_hover = Some(Rc::new(handler));
        self
    }

    pub fn toast(mut self, toast: Toast) -> Self {
        self.toasts.push(toast);
        self
    }

    pub fn toasts(mut self, toasts: impl IntoIterator<Item = Toast>) -> Self {
        self.toasts.extend(toasts);
        self
    }
}

impl RenderOnce for ToastViewport {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        let size = window.viewport_size();
        let width = (size.width - px(VIEWPORT_INSET * 2.)).min(px(MAX_WIDTH));
        let left = size.width - px(VIEWPORT_INSET) - width;
        let top = px(VIEWPORT_INSET + workspace::TOPBAR_HEIGHT);
        let mut toasts = self.toasts;
        toasts.truncate(VISIBLE_LIMIT);
        let count = toasts.len();
        let expanded = self.expanded;
        let stack = div()
            .id(self.id)
            .relative()
            .w(width)
            .flex()
            .flex_col()
            .when(expanded, |s| s.gap(px(GAP)))
            .when_some(self.on_hover, |s, handler| {
                s.on_hover(move |hovered, window, cx| handler(hovered, window, cx))
            });
        let stack = if expanded {
            stack.children(toasts)
        } else {
            let mut iter = toasts.into_iter();
            let front = iter.next();
            stack
                .children((1..count).rev().map(|index| {
                    let shrink = SCALE_STEP * index as f32;
                    div()
                        .absolute()
                        .left(relative(shrink / 2.))
                        .right(relative(shrink / 2.))
                        .top(relative(shrink))
                        .bottom(px(-PEEK * index as f32))
                        .child(
                            dropdown_glass(cx)
                                .size_full()
                                .shadow(vec![
                                    shadow(0., 20., 25., -5., black(0.25)),
                                    shadow(0., 8., 10., -6., black(0.25)),
                                ])
                                .text_color(c(t.popover_foreground)),
                        )
                }))
                .when_some(front, |s, front| s.child(front))
        };
        deferred(
            anchored()
                .position(point(left, top))
                .child(super::overlay_bounds::tracked(stack)),
        )
        .with_priority(TOAST_LAYER)
    }
}

#[derive(IntoElement)]
pub struct AnchoredToast {
    id: ElementId,
    trigger: gpui::Bounds<gpui::Pixels>,
    title: SharedString,
    tooltip_style: bool,
    side_offset: f32,
    on_dismiss: Option<ClickHandler>,
    children: Vec<AnyElement>,
}

impl AnchoredToast {
    pub fn new(
        id: impl Into<ElementId>,
        trigger: gpui::Bounds<gpui::Pixels>,
        title: impl Into<SharedString>,
    ) -> Self {
        Self {
            id: id.into(),
            trigger,
            title: title.into(),
            tooltip_style: false,
            side_offset: 4.,
            on_dismiss: None,
            children: Vec::new(),
        }
    }

    pub fn tooltip_style(mut self, tooltip_style: bool) -> Self {
        self.tooltip_style = tooltip_style;
        self
    }

    pub fn side_offset(mut self, offset: f32) -> Self {
        self.side_offset = offset;
        self
    }

    pub fn on_dismiss(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_dismiss = Some(Rc::new(handler));
        self
    }
}

impl ParentElement for AnchoredToast {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for AnchoredToast {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        let orb_id = ElementId::Name(SharedString::from(format!("{}-dismiss", self.id)));
        let surface = dropdown_glass(cx)
            .id(self.id)
            .max_w(px(256.))
            .flex_col()
            .text_size(px(text::XS))
            .shadow(vec![
                shadow(0., 20., 25., -5., black(0.25)),
                shadow(0., 8., 10., -6., black(0.25)),
            ])
            .when(self.tooltip_style, |s| {
                s.rounded(px(radius::MD))
                    .child(div().px(px(8.)).py(px(4.)).child(self.title.clone()))
            });
        let surface = if self.tooltip_style {
            surface
        } else {
            surface
                .child(dismiss_orb(orb_id, &t, self.on_dismiss))
                .child(
                    div()
                        .pl(px(CONTENT_PADDING_LEFT))
                        .pr(px(END_PADDING))
                        .py(px(CONTENT_PADDING_Y))
                        .text_size(px(text::SM))
                        .line_height(px(text::SM_LINE))
                        .font_weight(FontWeight::MEDIUM)
                        .child(self.title)
                        .children(self.children),
                )
        };
        super::popover::positioned_with_priority(
            self.trigger,
            super::popover::Side::Bottom,
            super::popover::Align::Center,
            self.side_offset,
            0.,
            TOAST_LAYER,
            surface,
        )
    }
}
