use gpui::{
    App, FontWeight, IntoElement, ObjectFit, ParentElement, RenderOnce, Rgba, SharedString, Styled,
    StyledImage, Window, div, img, px, svg,
};

use crate::app_core::views::sidebar::ProjectIconView;
use crate::platform::MONO_FONT;
use crate::ui::theme;
use crate::ui::theme::palette::project_icon;
use crate::ui::theme::tokens::fade;

const MONOGRAM_FONT_RATIO: f32 = 8.25 / 16.;
const MONOGRAM_BASELINE_RATIO: f32 = 10.8 / 16.;
const MONOGRAM_ASCENT: f32 = 0.76;
const MONOGRAM_TINT: f32 = 0.14;
const LUCIDE_SCALE: f32 = 14. / 16.;
const EMOJI_SCALE: f32 = 0.8;

#[derive(IntoElement)]
pub struct ProjectFavicon {
    icon: ProjectIconView,
    size: f32,
}

impl ProjectFavicon {
    pub fn new(icon: &ProjectIconView, size: f32) -> Self {
        Self {
            icon: icon.clone(),
            size,
        }
    }
}

fn monogram(text: SharedString, ink: Rgba, size: f32) -> gpui::Div {
    let font = size * MONOGRAM_FONT_RATIO;
    let line = font * 1.2;
    let top = size * MONOGRAM_BASELINE_RATIO - font * MONOGRAM_ASCENT - (line - font) / 2.;
    div()
        .relative()
        .flex_none()
        .size(px(size))
        .rounded(px(size / 4.))
        .overflow_hidden()
        .bg(fade(ink, MONOGRAM_TINT))
        .child(
            div()
                .absolute()
                .left_0()
                .right_0()
                .top(px(top))
                .flex()
                .justify_center()
                .font_family(MONO_FONT)
                .font_weight(FontWeight::BOLD)
                .text_size(px(font))
                .line_height(px(line))
                .text_color(ink)
                .child(text),
        )
}

impl RenderOnce for ProjectFavicon {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let size = self.size;
        match self.icon {
            ProjectIconView::Monogram { text, color } => {
                monogram(text.into(), project_icon(color, t.appearance), size)
            }
            ProjectIconView::Emoji { emoji } => div()
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(size))
                .text_size(px(size * EMOJI_SCALE))
                .line_height(px(size))
                .child(SharedString::from(emoji)),
            ProjectIconView::Lucide { name, color } => div()
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(size))
                .child(
                    svg()
                        .path(SharedString::from(format!("icons/{name}.svg")))
                        .size(px(size * LUCIDE_SCALE))
                        .text_color(project_icon(color, t.appearance)),
                ),
            ProjectIconView::Image { url, fallback } => {
                let fallback = fallback.map(|fallback| {
                    (
                        SharedString::from(fallback.text),
                        project_icon(fallback.color, t.appearance),
                    )
                });
                let muted = t.icon_muted;
                let placeholder = move || match &fallback {
                    Some((text, ink)) => monogram(text.clone(), *ink, size).into_any_element(),
                    None => svg()
                        .path("icons/folder-code.svg")
                        .size(px(size))
                        .text_color(muted)
                        .into_any_element(),
                };
                let loading = placeholder.clone();
                div().flex_none().size(px(size)).child(
                    img(SharedString::from(url))
                        .size(px(size))
                        .rounded(px(size / 4.))
                        .object_fit(ObjectFit::Contain)
                        .with_fallback(placeholder)
                        .with_loading(loading),
                )
            }
            ProjectIconView::Folder => div().flex_none().size(px(size)).child(
                svg()
                    .path("icons/folder-code.svg")
                    .size(px(size))
                    .text_color(t.icon_muted),
            ),
        }
    }
}
