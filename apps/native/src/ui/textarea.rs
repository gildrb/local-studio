use gpui::component::Sizable;
use gpui::component::input::{Textarea as KitTextarea, TextareaState};
use gpui::prelude::FluentBuilder;
use gpui::{
    App, Entity, Focusable, IntoElement, ParentElement, Refineable, RenderOnce, StyleRefinement,
    Styled, Window, div, px,
};

use super::button::{DISABLED_OPACITY, resolve_corners, rounded};
use super::input::{decorate, field_look};
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};

pub const MAX_HEIGHT: f32 = 256.;
pub const EDITOR_INSET_X: f32 = 4.;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TextareaSize {
    Sm,
    #[default]
    Default,
    Lg,
}

pub struct TextareaMetrics {
    pub min_height: f32,
    pub padding_x: f32,
    pub padding_y: f32,
}

impl TextareaSize {
    pub const fn metrics(self) -> TextareaMetrics {
        let (min_height, padding_x, padding_y) = match self {
            TextareaSize::Sm => (66., 9., 3.),
            TextareaSize::Default => (70., 11., 5.),
            TextareaSize::Lg => (74., 11., 7.),
        };
        TextareaMetrics {
            min_height,
            padding_x,
            padding_y,
        }
    }
}

pub(crate) fn bare_textarea(
    state: &Entity<TextareaState>,
    min_height: f32,
    max_height: f32,
    padding_x: f32,
    padding_y: f32,
    disabled: bool,
) -> KitTextarea {
    KitTextarea::new(state)
        .appearance(false)
        .disabled(disabled)
        .xsmall()
        .w_full()
        .min_h(px(min_height))
        .max_h(px(max_height))
        .px(px(padding_x - EDITOR_INSET_X))
        .py(px(padding_y))
        .text_size(px(text::SM))
        .line_height(px(text::SM_LINE))
}

#[derive(IntoElement)]
pub struct Textarea {
    state: Entity<TextareaState>,
    size: TextareaSize,
    invalid: bool,
    disabled: bool,
    style: StyleRefinement,
}

impl Textarea {
    pub fn new(state: &Entity<TextareaState>) -> Self {
        Self {
            state: state.clone(),
            size: TextareaSize::default(),
            invalid: false,
            disabled: false,
            style: StyleRefinement::default(),
        }
    }

    pub fn size(mut self, size: TextareaSize) -> Self {
        self.size = size;
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

impl Styled for Textarea {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for Textarea {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let m = self.size.metrics();
        let focused = !self.disabled && self.state.focus_handle(cx).is_focused(window);
        let look = field_look(&t, focused, self.invalid, self.disabled);
        let corners = resolve_corners(radius::LG, &self.style, window);
        let frame = div()
            .relative()
            .flex()
            .w_full()
            .border_1()
            .border_color(look.border)
            .bg(look.bg)
            .shadow(look.shadows.clone())
            .text_color(t.foreground)
            .text_size(px(text::SM))
            .when(self.disabled, |f| f.opacity(DISABLED_OPACITY))
            .child(bare_textarea(
                &self.state,
                m.min_height,
                MAX_HEIGHT,
                m.padding_x,
                m.padding_y,
                self.disabled,
            ));
        let mut frame = decorate(rounded(frame, corners), &t, &look, corners);
        frame.style().refine(&self.style);
        frame
    }
}
