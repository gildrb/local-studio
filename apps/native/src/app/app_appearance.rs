use gpui::{AnyWindowHandle, App, Entity};
use serde_json::json;

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::app_theme::{AppAppearanceView, AppChatWidth, AppDiffColorScheme};
use crate::platform::appearance;
use crate::ui::theme::{self, Adjustments, ChatWidth, DiffColors};

pub fn subscribe(
    client: &Entity<CoreClient>,
    window: AnyWindowHandle,
    cx: &mut App,
) -> Entity<ViewState<AppAppearanceView>> {
    let view = CoreClient::subscribe::<AppAppearanceView>(client, "appAppearance", json!({}), cx);
    cx.observe(&view, move |view, cx| {
        if let Some(view) = view.read(cx).data.clone() {
            apply(&view, window, cx);
        }
    })
    .detach();
    view
}

fn apply(view: &AppAppearanceView, window: AnyWindowHandle, cx: &mut App) {
    appearance::set_font_smoothing(view.font_smoothing, cx);
    appearance::set_font_families(
        &view.sans_families,
        &view.mono_families,
        &view.composer_families,
        cx,
    );
    theme::set_adjustments(
        Adjustments {
            zoom: view.zoom,
            contrast: view.contrast,
            glass_opacity: view.glass_opacity,
            chat_width: match view.chat_width {
                AppChatWidth::Comfortable => ChatWidth::Comfortable,
                AppChatWidth::Wide => ChatWidth::Wide,
                AppChatWidth::Full => ChatWidth::Full,
            },
            diff_colors: match view.diff_color_scheme {
                AppDiffColorScheme::RedGreen => DiffColors::RedGreen,
                AppDiffColorScheme::BlueOrange => DiffColors::BlueOrange,
            },
            prompt_font_size: view.prompt_font_size,
            code_font_size: view.code_font_size,
        },
        cx,
    );
    let zoom = view.zoom;
    cx.defer(move |cx| {
        let _ = window.update(cx, |_, window, cx| {
            appearance::set_content_zoom(zoom, window, cx)
        });
    });
    cx.refresh_windows();
}
