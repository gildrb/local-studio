use gpui::{AnyElement, App, IntoElement, Pixels, Rgba, Styled, img, svg};

use crate::app_core::views::pierre_icon::PierreIconView;
use crate::ui::theme;
use crate::ui::theme::tokens::Appearance;

pub fn pierre_icon(icon: &PierreIconView, size: Pixels, cx: &App) -> AnyElement {
    let t = theme::active(cx);
    let paint = match t.appearance {
        Appearance::Dark => &icon.dark,
        Appearance::Light => &icon.light,
    };
    let color = paint
        .color
        .as_deref()
        .and_then(|color| Rgba::try_from(color).ok());
    match color {
        Some(color) => svg()
            .path(paint.asset.clone())
            .flex_none()
            .size(size)
            .text_color(color)
            .into_any_element(),
        None => img(paint.asset.clone())
            .flex_none()
            .size(size)
            .into_any_element(),
    }
}
