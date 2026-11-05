use gpui::{App, IntoElement, ParentElement, RenderOnce, Styled, Window, div, img, px};

use crate::app_core::views::sidebar::StageBackdrop;
use crate::ui::theme;
use crate::ui::theme::Appearance;

pub const HEIGHT: f32 = 80.;
const ART_WIDTH: f32 = 1024. * HEIGHT / 96.;

fn art_path(variant: StageBackdrop, appearance: Appearance) -> &'static str {
    match (variant, appearance) {
        (StageBackdrop::Dev, Appearance::Dark) => "stage/dev-dark.svg",
        (StageBackdrop::Dev, Appearance::Light) => "stage/dev-light.svg",
        (StageBackdrop::Nightly, Appearance::Dark) => "stage/nightly-dark.svg",
        (StageBackdrop::Nightly, Appearance::Light) => "stage/nightly-light.svg",
    }
}

#[derive(IntoElement)]
pub struct SidebarStageBackdrop {
    variant: StageBackdrop,
}

impl SidebarStageBackdrop {
    pub fn new(variant: StageBackdrop) -> Self {
        Self { variant }
    }
}

impl RenderOnce for SidebarStageBackdrop {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let appearance = theme::active(cx).appearance;
        div()
            .absolute()
            .top_0()
            .left_0()
            .right_0()
            .h(px(HEIGHT))
            .overflow_hidden()
            .child(
                img(art_path(self.variant, appearance))
                    .absolute()
                    .top_0()
                    .left_0()
                    .w(px(ART_WIDTH))
                    .h(px(HEIGHT)),
            )
    }
}
