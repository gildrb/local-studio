use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Axis, ClickEvent, ElementId, IntoElement, ParentElement, RenderOnce,
    SharedString, Styled, Window, div, px,
};

use super::button::{
    DISABLED_OPACITY, edge_highlight, is_dark, is_focus_visible, keyed_focus, outset, shadow_xs,
    uniform,
};
use crate::ui::theme;
use crate::ui::theme::metrics::radius;
use crate::ui::theme::tokens::fade;

pub const SIZE: f32 = 16.;
pub const DOT: f32 = 6.;
pub const GAP: f32 = 12.;

#[derive(IntoElement)]
pub struct RadioGroup {
    id: ElementId,
    axis: Axis,
    children: Vec<AnyElement>,
}

impl RadioGroup {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            axis: Axis::Vertical,
            children: Vec::new(),
        }
    }

    pub fn axis(mut self, axis: Axis) -> Self {
        self.axis = axis;
        self
    }
}

impl ParentElement for RadioGroup {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for RadioGroup {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        gpui::base::RadioGroup::new(self.id)
            .axis(self.axis)
            .flex()
            .when(self.axis == Axis::Vertical, |g| g.flex_col())
            .gap(px(GAP))
            .children(self.children)
    }
}

type ChangeHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Radio {
    id: ElementId,
    checked: bool,
    disabled: bool,
    invalid: bool,
    position: Option<(usize, usize)>,
    accessibility_label: Option<SharedString>,
    on_select: Option<ChangeHandler>,
}

impl Radio {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            checked: false,
            disabled: false,
            invalid: false,
            position: None,
            accessibility_label: None,
            on_select: None,
        }
    }

    pub fn checked(mut self, checked: bool) -> Self {
        self.checked = checked;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn invalid(mut self, invalid: bool) -> Self {
        self.invalid = invalid;
        self
    }

    pub fn position(mut self, index: usize, count: usize) -> Self {
        self.position = Some((index, count));
        self
    }

    pub fn accessibility_label(mut self, label: impl Into<SharedString>) -> Self {
        self.accessibility_label = Some(label.into());
        self
    }

    pub fn on_select(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_select = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for Radio {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let dark = is_dark(&t);
        let handle = keyed_focus(&self.id, window, cx);
        let focused = !self.disabled && is_focus_visible(&handle, window);
        let corners = uniform(radius::FULL);
        let border = match (self.invalid, focused) {
            (true, true) => fade(t.destructive, 0.64),
            (true, false) => fade(t.destructive, 0.36),
            _ => t.input,
        };
        let ring = if self.invalid {
            fade(t.destructive, if dark { 0.24 } else { 0.48 })
        } else {
            t.ring
        };
        let bg = if !self.checked && dark {
            fade(t.input, 0.32)
        } else {
            t.background
        };
        let plain = !self.disabled && !self.checked && !self.invalid;
        gpui::base::Radio::new(self.id)
            .track_focus(&handle)
            .checked(self.checked)
            .disabled(self.disabled)
            .when_some(self.position, |r, (index, count)| {
                r.set_position(index, count)
            })
            .when_some(self.accessibility_label, |r, label| {
                r.accessibility_label(label)
            })
            .when_some(self.on_select, |r, on_select| {
                r.on_change(move |checked, event, window, cx| {
                    if checked {
                        on_select(event, window, cx);
                    }
                })
            })
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .size(px(SIZE))
            .rounded(px(radius::FULL))
            .border_1()
            .border_color(border)
            .bg(bg)
            .when(plain, |r| r.shadow(vec![shadow_xs(0.05)]))
            .when(!self.disabled, |r| r.cursor_pointer())
            .when(self.disabled, |r| r.opacity(DISABLED_OPACITY))
            .when(plain, |r| r.child(edge_highlight(&t, corners, 1., false)))
            .when(self.checked, |r| {
                r.child(
                    div()
                        .absolute()
                        .top(px(-1.))
                        .left(px(-1.))
                        .size(px(SIZE))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(px(radius::FULL))
                        .bg(t.primary)
                        .child(
                            div()
                                .size(px(DOT))
                                .rounded(px(radius::FULL))
                                .bg(t.primary_foreground),
                        ),
                )
            })
            .when(focused, |r| r.child(outset(corners, 1., 1., 2., ring)))
    }
}
