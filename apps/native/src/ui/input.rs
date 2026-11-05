use gpui::component::input::{Input as KitInput, InputState};
use gpui::prelude::FluentBuilder;
use gpui::{
    App, BoxShadow, Corners, Entity, Focusable, IntoElement, ParentElement, Pixels, Refineable,
    RenderOnce, Rgba, StyleRefinement, Styled, Window, div, px,
};

use super::button::{
    DISABLED_OPACITY, edge_highlight, field_ring, is_dark, resolve_corners, rounded, shadow_xs,
};
use crate::platform::MONO_FONT;
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};

pub(crate) struct FieldLook {
    pub bg: Rgba,
    pub border: Rgba,
    pub shadows: Vec<BoxShadow>,
    pub edge: bool,
    pub ring: Option<Rgba>,
}

pub(crate) fn field_bg(t: &Tokens) -> Rgba {
    if is_dark(t) {
        fade(t.input, 0.32)
    } else {
        t.background
    }
}

pub(crate) fn field_look(t: &Tokens, focused: bool, invalid: bool, disabled: bool) -> FieldLook {
    let dark = is_dark(t);
    let border = match (invalid, focused) {
        (true, true) => fade(t.destructive, 0.64),
        (true, false) => fade(t.destructive, 0.36),
        (false, true) => t.ring,
        (false, false) => t.input,
    };
    let ring = match (focused, invalid) {
        (true, true) => Some(fade(t.destructive, if dark { 0.24 } else { 0.16 })),
        (true, false) => Some(fade(t.ring, 0.24)),
        _ => None,
    };
    let plain = !focused && !invalid && !disabled;
    FieldLook {
        bg: field_bg(t),
        border,
        shadows: if plain {
            vec![shadow_xs(0.05)]
        } else {
            Vec::new()
        },
        edge: plain,
        ring,
    }
}

pub(crate) fn decorate<E: ParentElement + FluentBuilder>(
    element: E,
    t: &Tokens,
    look: &FieldLook,
    corners: Corners<Pixels>,
) -> E {
    element
        .when(look.edge, |e| {
            e.child(edge_highlight(t, corners, 1., false))
        })
        .when_some(look.ring, |e, ring| e.child(field_ring(ring, corners, 1.)))
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum InputSize {
    Sm,
    Compact,
    #[default]
    Default,
    Lg,
}

pub struct InputMetrics {
    pub height: f32,
    pub padding_x: f32,
    pub font: f32,
    pub radius: f32,
}

impl InputSize {
    pub const fn metrics(self) -> InputMetrics {
        let (inner, padding_x, font, r) = match self {
            InputSize::Sm => (26., 9., text::SM, radius::LG),
            InputSize::Compact => (28., 9., text::XS, radius::MD),
            InputSize::Default => (30., 11., text::SM, radius::LG),
            InputSize::Lg => (34., 11., text::SM, radius::LG),
        };
        InputMetrics {
            height: inner + 2.,
            padding_x,
            font,
            radius: r,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum InputFont {
    #[default]
    Default,
    Mono,
}

#[derive(IntoElement)]
pub struct Input {
    state: Entity<InputState>,
    size: InputSize,
    font: InputFont,
    invalid: bool,
    disabled: bool,
    style: StyleRefinement,
}

impl Input {
    pub fn new(state: &Entity<InputState>) -> Self {
        Self {
            state: state.clone(),
            size: InputSize::default(),
            font: InputFont::default(),
            invalid: false,
            disabled: false,
            style: StyleRefinement::default(),
        }
    }

    pub fn size(mut self, size: InputSize) -> Self {
        self.size = size;
        self
    }

    pub fn font(mut self, font: InputFont) -> Self {
        self.font = font;
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

impl Styled for Input {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

pub(crate) fn bare_input(
    state: &Entity<InputState>,
    height: f32,
    padding_left: f32,
    padding_right: f32,
    font: f32,
    disabled: bool,
) -> KitInput {
    KitInput::new(state)
        .appearance(false)
        .disabled(disabled)
        .h(px(height))
        .pl(px(padding_left))
        .pr(px(padding_right))
        .py(px(0.))
        .text_size(px(font))
        .line_height(px(text::SM_LINE))
}

impl RenderOnce for Input {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let m = self.size.metrics();
        let focused = !self.disabled && self.state.focus_handle(cx).is_focused(window);
        let look = field_look(&t, focused, self.invalid, self.disabled);
        let corners = resolve_corners(m.radius, &self.style, window);
        let inner = m.height - 2.;
        let frame = div()
            .relative()
            .flex()
            .items_center()
            .w_full()
            .h(px(m.height))
            .border_1()
            .border_color(look.border)
            .bg(look.bg)
            .shadow(look.shadows.clone())
            .text_color(t.foreground)
            .text_size(px(m.font))
            .when(self.font == InputFont::Mono, |f| f.font_family(MONO_FONT))
            .when(self.disabled, |f| f.opacity(DISABLED_OPACITY))
            .child(bare_input(
                &self.state,
                inner,
                m.padding_x,
                m.padding_x,
                m.font,
                self.disabled,
            ));
        let mut frame = decorate(rounded(frame, corners), &t, &look, corners);
        frame.style().refine(&self.style);
        frame
    }
}
