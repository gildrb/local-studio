use std::rc::Rc;

use gpui::base::CheckboxState;
use gpui::prelude::FluentBuilder;
use gpui::{
    App, ClickEvent, ElementId, IntoElement, ParentElement, RenderOnce, SharedString, Styled,
    Window, div, px,
};

use super::button::{
    DISABLED_OPACITY, edge_highlight, icon, is_dark, is_focus_visible, keyed_focus, outset,
    shadow_xs, uniform,
};
use crate::ui::theme;
use crate::ui::theme::tokens::fade;

pub const SIZE: f32 = 16.;
pub const RADIUS: f32 = 4.;
pub const ICON: f32 = 12.;
pub const CHECK_ICON: &str = "checkbox-check";
pub const INDETERMINATE_ICON: &str = "checkbox-indeterminate";

type ChangeHandler = Rc<dyn Fn(CheckboxState, &ClickEvent, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Checkbox {
    id: ElementId,
    state: CheckboxState,
    disabled: bool,
    invalid: bool,
    accessibility_label: Option<SharedString>,
    on_change: Option<ChangeHandler>,
}

impl Checkbox {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            state: CheckboxState::Unchecked,
            disabled: false,
            invalid: false,
            accessibility_label: None,
            on_change: None,
        }
    }

    pub fn checked(mut self, checked: bool) -> Self {
        self.state = if checked {
            CheckboxState::Checked
        } else {
            CheckboxState::Unchecked
        };
        self
    }

    pub fn indeterminate(mut self, indeterminate: bool) -> Self {
        if indeterminate {
            self.state = CheckboxState::Indeterminate;
        }
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

    pub fn accessibility_label(mut self, label: impl Into<SharedString>) -> Self {
        self.accessibility_label = Some(label.into());
        self
    }

    pub fn on_change(
        mut self,
        handler: impl Fn(CheckboxState, &ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_change = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for Checkbox {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let dark = is_dark(&t);
        let handle = keyed_focus(&self.id, window, cx);
        let focused = !self.disabled && is_focus_visible(&handle, window);
        let checked = self.state == CheckboxState::Checked;
        let indeterminate = self.state == CheckboxState::Indeterminate;
        let corners = uniform(RADIUS);
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
        let bg = if checked {
            t.background
        } else if dark {
            fade(t.input, 0.32)
        } else {
            t.background
        };
        let plain = !self.disabled && !checked && !self.invalid;
        gpui::base::Checkbox::new(self.id)
            .track_focus(&handle)
            .state(self.state)
            .disabled(self.disabled)
            .when_some(self.accessibility_label, |c, label| {
                c.accessibility_label(label)
            })
            .when_some(self.on_change, |c, on_change| {
                c.on_change(move |state, event, window, cx| on_change(state, event, window, cx))
            })
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .size(px(SIZE))
            .rounded(px(RADIUS))
            .border_1()
            .border_color(border)
            .bg(bg)
            .when(plain, |c| c.shadow(vec![shadow_xs(0.05)]))
            .when(!self.disabled, |c| c.cursor_pointer())
            .when(self.disabled, |c| c.opacity(DISABLED_OPACITY))
            .when(plain, |c| c.child(edge_highlight(&t, corners, 1., false)))
            .when(checked, |c| {
                c.child(
                    div()
                        .absolute()
                        .top(px(-1.))
                        .left(px(-1.))
                        .size(px(SIZE))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(px(RADIUS))
                        .bg(t.primary)
                        .child(icon(CHECK_ICON, ICON, t.primary_foreground)),
                )
            })
            .when(indeterminate, |c| {
                c.child(icon(INDETERMINATE_ICON, ICON, t.foreground))
            })
            .when(focused, |c| c.child(outset(corners, 1., 1., 2., ring)))
    }
}
