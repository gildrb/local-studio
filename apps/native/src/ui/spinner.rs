use std::time::Duration;

use gpui::{
    Animation, AnimationExt, App, ElementId, Hsla, IntoElement, RenderOnce, Styled, Transformation,
    Window, percentage, px, svg,
};

use crate::ui::theme;
use crate::ui::theme::color::hsla;

pub const ICON: &str = "icons/loader-circle.svg";
pub const TURN: Duration = Duration::from_secs(1);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SpinnerSize {
    Xs,
    Sm,
    #[default]
    Md,
    Lg,
}

impl SpinnerSize {
    pub fn px(self) -> f32 {
        match self {
            SpinnerSize::Xs => 12.,
            SpinnerSize::Sm => 14.,
            SpinnerSize::Md => 16.,
            SpinnerSize::Lg => 20.,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SpinnerTone {
    #[default]
    Current,
    Muted,
}

#[derive(IntoElement)]
pub struct Spinner {
    id: ElementId,
    size: SpinnerSize,
    tone: SpinnerTone,
}

impl Spinner {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            size: SpinnerSize::default(),
            tone: SpinnerTone::default(),
        }
    }

    pub fn size(mut self, size: SpinnerSize) -> Self {
        self.size = size;
        self
    }

    pub fn tone(mut self, tone: SpinnerTone) -> Self {
        self.tone = tone;
        self
    }
}

impl RenderOnce for Spinner {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let color: Hsla = match self.tone {
            SpinnerTone::Current => window.text_style().color,
            SpinnerTone::Muted => hsla(theme::active(cx).muted_foreground),
        };
        svg()
            .path(ICON)
            .size(px(self.size.px()))
            .flex_none()
            .text_color(color)
            .with_animation(self.id, Animation::new(TURN).repeat(), |icon, delta| {
                icon.with_transformation(Transformation::rotate(percentage(delta)))
            })
    }
}
