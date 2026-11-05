use std::time::Duration;

use gpui::Refineable;
use gpui::{
    Animation, AnimationExt, App, ElementId, IntoElement, RenderOnce, StyleRefinement, Styled,
    Window, div, px,
};

use crate::ui::theme;
use crate::ui::theme::metrics::radius;
use crate::ui::theme::tokens::fade;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SkeletonShape {
    #[default]
    Block,
    Card,
    Pill,
}

impl SkeletonShape {
    pub fn radius(self) -> f32 {
        match self {
            SkeletonShape::Block => radius::SM,
            SkeletonShape::Card => radius::LG,
            SkeletonShape::Pill => radius::FULL,
        }
    }
}

pub const CYCLE: Duration = Duration::from_millis(2400);

fn stepped(from: f32, to: f32, progress: f32) -> f32 {
    from + (to - from) * (progress * 4.).floor() / 4.
}

pub fn breath(delta: f32) -> f32 {
    const DIM: f32 = 0.55;
    match delta {
        d if d < 0.42 => 1.,
        d if d < 0.5 => stepped(1., DIM, (d - 0.42) / 0.08),
        d if d < 0.92 => DIM,
        d => stepped(DIM, 1., (d - 0.92) / 0.08),
    }
}

#[derive(IntoElement)]
pub struct Skeleton {
    id: ElementId,
    shape: SkeletonShape,
    style: StyleRefinement,
}

impl Skeleton {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            shape: SkeletonShape::Block,
            style: StyleRefinement::default(),
        }
    }

    pub fn shape(mut self, shape: SkeletonShape) -> Self {
        self.shape = shape;
        self
    }
}

impl Styled for Skeleton {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for Skeleton {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let mut bar = div()
            .rounded(px(self.shape.radius()))
            .bg(fade(theme::active(cx).muted_foreground, 0.15));
        bar.style().refine(&self.style);
        bar.with_animation(self.id, Animation::new(CYCLE).repeat(), |bar, delta| {
            bar.opacity(breath(delta))
        })
    }
}
