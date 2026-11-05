use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, FontWeight, InteractiveElement, IntoElement, ParentElement, SharedString,
    StatefulInteractiveElement, Styled, div, px, svg,
};
use serde_json::json;

use crate::features::chat::thread_interactions_host::{ThreadInteractionsHost, on_click};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::theme;
use crate::ui::theme::tokens::{fade, glass_blur, glass_saturation};
use crate::ui::tooltip::Tooltip;

const MAX_WIDTH: f32 = 768.;
const SIDE_GUTTER: f32 = 16.;
const TOP: f32 = 12.;
const RADIUS: f32 = 14.;
const PADDING_X: f32 = 14.;
const PADDING_Y: f32 = 12.;
const GAP: f32 = 8.;
const ICON: f32 = 16.;
const TEXT: f32 = 14.;
const LINE: f32 = 20.;
const BORDER_OPACITY: f32 = 0.32;
const TINT_OPACITY: f32 = 0.04;
const DESCRIPTION_OPACITY: f32 = 0.8;
const ACTION_MIN_HEIGHT: f32 = 24.;
const ACTION_TOP: f32 = 2.;
const DISMISS_ICON: f32 = 14.;
const LINE_CLAMP: usize = 3;
const DESCRIPTION_GAP: f32 = 4.;

pub fn thread_error_overlay(cx: &App) -> Option<AnyElement> {
    let host = ThreadInteractionsHost::global(cx)?;
    let client = host.read(cx).client().clone();
    let error = ThreadInteractionsHost::current(cx)?.thread_error?;
    let t = theme::active(cx);
    let description_color = fade(t.error_foreground, DESCRIPTION_OPACITY);
    let usage = error.usage_button.clone();
    let icon = if usage.is_some() {
        svg()
            .path("icons/providers/openai.svg")
            .size(px(ICON))
            .text_color(t.foreground)
    } else {
        svg()
            .path("icons/circle-alert.svg")
            .size(px(ICON))
            .text_color(t.error)
    };
    let description = if usage.is_some() {
        div()
            .flex()
            .flex_col()
            .gap(px(DESCRIPTION_GAP))
            .child(
                div()
                    .font_weight(FontWeight::MEDIUM)
                    .child("ChatGPT usage limit reached"),
            )
            .child(div().child("Review your usage settings in ChatGPT to continue."))
            .into_any_element()
    } else {
        div()
            .id("thread-error-text")
            .line_clamp(LINE_CLAMP)
            .tooltip(Tooltip::text(error.message.clone()))
            .child(SharedString::from(error.message.clone()))
            .into_any_element()
    };
    Some(
        div()
            .absolute()
            .top_0()
            .left_0()
            .right_0()
            .flex()
            .flex_col()
            .items_center()
            .px(px(SIDE_GUTTER))
            .child(
                div().pt(px(TOP)).max_w(px(MAX_WIDTH)).child(
                    div()
                        .relative()
                        .rounded(px(RADIUS))
                        .backdrop_blur(px(glass_blur(&t)))
                        .backdrop_saturate(glass_saturation(&t))
                        .border_1()
                        .border_color(fade(t.error, BORDER_OPACITY))
                        .bg(fade(t.background, t.glass_opacity))
                        .px(px(PADDING_X))
                        .py(px(PADDING_Y))
                        .text_size(px(TEXT))
                        .line_height(px(LINE))
                        .text_color(t.error_foreground)
                        .child(
                            div()
                                .absolute()
                                .inset_0()
                                .rounded(px(RADIUS))
                                .bg(fade(t.error, TINT_OPACITY)),
                        )
                        .child(
                            div()
                                .relative()
                                .flex()
                                .items_start()
                                .gap(px(GAP))
                                .min_h(px(ACTION_MIN_HEIGHT))
                                .pt(px(ACTION_TOP))
                                .child(
                                    div()
                                        .flex()
                                        .flex_none()
                                        .h(px(LINE))
                                        .w(px(ICON))
                                        .items_center()
                                        .justify_center()
                                        .child(icon),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .flex_col()
                                        .flex_1()
                                        .min_w_0()
                                        .text_color(description_color)
                                        .child(description),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .flex_none()
                                        .h(px(LINE))
                                        .items_center()
                                        .gap(px(DESCRIPTION_GAP))
                                        .when_some(usage, |this, usage| {
                                            let url = usage.url.clone();
                                            this.child(
                                                Button::new("thread-error-chatgpt-usage")
                                                    .variant(ButtonVariant::Default)
                                                    .size(ButtonSize::Sm)
                                                    .label(usage.label.clone())
                                                    .icon_end("icons/external-link.svg")
                                                    .icon_size(DISMISS_ICON)
                                                    .on_click(move |_, _, cx| cx.open_url(&url)),
                                            )
                                        })
                                        .child(
                                            Button::new("thread-error-dismiss")
                                                .variant(ButtonVariant::Ghost)
                                                .size(ButtonSize::IconXs)
                                                .icon("icons/x.svg")
                                                .icon_size(DISMISS_ICON)
                                                .icon_color(t.destructive)
                                                .accessibility_label("Dismiss error")
                                                .on_click(on_click(
                                                    &client,
                                                    "dismissThreadError",
                                                    json!({}),
                                                )),
                                        ),
                                ),
                        ),
                ),
            )
            .into_any_element(),
    )
}
