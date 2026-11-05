use gpui::prelude::FluentBuilder;
use gpui::{App, IntoElement, RenderOnce, Rgba, Styled, Window, div, px};

use crate::ui::theme;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Orientation {
    #[default]
    Horizontal,
    Vertical,
}

#[derive(IntoElement, Default)]
pub struct Separator {
    orientation: Orientation,
    color: Option<Rgba>,
    length: Option<f32>,
}

impl Separator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn horizontal() -> Self {
        Self::default()
    }

    pub fn vertical() -> Self {
        Self::default().orientation(Orientation::Vertical)
    }

    pub fn orientation(mut self, orientation: Orientation) -> Self {
        self.orientation = orientation;
        self
    }

    pub fn color(mut self, color: Rgba) -> Self {
        self.color = Some(color);
        self
    }

    pub fn length(mut self, length: f32) -> Self {
        self.length = Some(length);
        self
    }
}

impl RenderOnce for Separator {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let color = self.color.unwrap_or(theme::active(cx).border);
        let bar = div().flex_shrink_0().bg(color);
        match self.orientation {
            Orientation::Horizontal => bar.h(px(1.)).map(|bar| match self.length {
                Some(length) => bar.w(px(length)),
                None => bar.w_full(),
            }),
            Orientation::Vertical => bar.w(px(1.)).map(|bar| match self.length {
                Some(length) => bar.h(px(length)),
                None => bar.h_full(),
            }),
        }
    }
}
