use gpui::component::input::InputState;
use gpui::prelude::FluentBuilder;
use gpui::{
    App, Corners, ElementId, Entity, Focusable, InteractiveElement, IntoElement, ParentElement,
    Refineable, RenderOnce, StyleRefinement, Styled, TextAlign, Window, div, px,
};

use super::button::{DISABLED_OPACITY, icon, rounded};
use super::input::{bare_input, decorate, field_look};
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};

pub const ICON: f32 = 16.;
pub const DECREMENT_ICON: &str = "minus";
pub const INCREMENT_ICON: &str = "plus";

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NumberFieldSize {
    Sm,
    #[default]
    Default,
    Lg,
}

pub struct NumberFieldMetrics {
    pub height: f32,
    pub padding_x: f32,
}

impl NumberFieldSize {
    pub const fn metrics(self) -> NumberFieldMetrics {
        let (inner, padding_x) = match self {
            NumberFieldSize::Sm => (26., 9.),
            NumberFieldSize::Default => (30., 11.),
            NumberFieldSize::Lg => (34., 11.),
        };
        NumberFieldMetrics {
            height: inner + 2.,
            padding_x,
        }
    }
}

#[derive(IntoElement)]
pub struct NumberField {
    id: ElementId,
    state: Entity<InputState>,
    size: NumberFieldSize,
    step: f64,
    min: Option<f64>,
    max: Option<f64>,
    invalid: bool,
    disabled: bool,
    style: StyleRefinement,
}

impl NumberField {
    pub fn new(id: impl Into<ElementId>, state: &Entity<InputState>) -> Self {
        Self {
            id: id.into(),
            state: state.clone(),
            size: NumberFieldSize::default(),
            step: 1.,
            min: None,
            max: None,
            invalid: false,
            disabled: false,
            style: StyleRefinement::default(),
        }
    }

    pub fn size(mut self, size: NumberFieldSize) -> Self {
        self.size = size;
        self
    }

    pub fn step(mut self, step: f64) -> Self {
        self.step = step;
        self
    }

    pub fn min(mut self, min: f64) -> Self {
        self.min = Some(min);
        self
    }

    pub fn max(mut self, max: f64) -> Self {
        self.max = Some(max);
        self
    }

    pub fn invalid(mut self, invalid: bool) -> Self {
        self.invalid = invalid;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}

impl Styled for NumberField {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

fn stepped(text: &str, delta: f64, min: Option<f64>, max: Option<f64>) -> String {
    let current = text.trim().parse::<f64>().unwrap_or(0.);
    let mut next = current + delta;
    if let Some(min) = min {
        next = next.max(min);
    }
    if let Some(max) = max {
        next = next.min(max);
    }
    let rounded = (next * 1e9).round() / 1e9;
    format!("{rounded}")
}

impl RenderOnce for NumberField {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let m = self.size.metrics();
        let focused = !self.disabled && self.state.focus_handle(cx).is_focused(window);
        let look = field_look(&t, focused, self.invalid, self.disabled);
        let corners = Corners::all(px(radius::LG));
        let inner_radius = px(radius::LG - 1.);
        let disabled = self.disabled;
        let stepper = |id: &'static str, glyph: &'static str, delta: f64, left: bool| {
            let state = self.state.clone();
            let (min, max) = (self.min, self.max);
            gpui::base::Button::new((self.id.clone(), id))
                .focusable(false)
                .disabled(disabled)
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .h_full()
                .px(px(m.padding_x))
                .map(|b| {
                    if left {
                        b.rounded_tl(inner_radius).rounded_bl(inner_radius)
                    } else {
                        b.rounded_tr(inner_radius).rounded_br(inner_radius)
                    }
                })
                .when(!disabled, |b| {
                    b.cursor_pointer()
                        .hover(|s| s.bg(t.accent))
                        .on_click(move |_, window, cx| {
                            state.update(cx, |state, cx| {
                                let next = stepped(&state.value(), delta, min, max);
                                state.set_value(next, window, cx);
                            });
                        })
                })
                .child(icon(glyph, ICON, t.foreground))
        };
        let frame = div()
            .relative()
            .flex()
            .justify_between()
            .items_center()
            .w_full()
            .h(px(m.height))
            .border_1()
            .border_color(look.border)
            .bg(look.bg)
            .shadow(look.shadows.clone())
            .text_color(t.foreground)
            .text_size(px(text::SM))
            .when(disabled, |f| f.opacity(DISABLED_OPACITY))
            .child(stepper("decrement", DECREMENT_ICON, -self.step, true))
            .child(
                bare_input(
                    &self.state,
                    m.height - 2.,
                    m.padding_x,
                    m.padding_x,
                    text::SM,
                    disabled,
                )
                .flex_1()
                .min_w_0()
                .text_align(TextAlign::Center),
            )
            .child(stepper("increment", INCREMENT_ICON, self.step, false));
        let mut frame = decorate(rounded(frame, corners), &t, &look, corners);
        frame.style().refine(&self.style);
        frame
    }
}
