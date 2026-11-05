use gpui::{
    AnyElement, BoxShadow, Div, Entity, FontWeight, IntoElement, ParentElement, Rgba, SharedString,
    Styled, div, px, svg,
};
use serde_json::json;

use super::act;
use crate::app_core::client::CoreClient;
use crate::app_core::views::onboarding::CommandBlock;
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::popover::{black, dark, shadow, white};
use crate::ui::theme::Tokens;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::fade;

const COMMAND_PADDING_X: f32 = 12.;
const COMMAND_PADDING_Y: f32 = 10.;
const COMMAND_GAP: f32 = 12.;
const PROMPT_GAP: f32 = 8.;
const COPY_ICON: f32 = 14.;

pub fn ring(color: Rgba) -> BoxShadow {
    shadow(0., 0., 0., 1., color)
}

pub fn soft_ring(t: &Tokens) -> BoxShadow {
    ring(if dark(t) { white(0.05) } else { black(0.05) })
}

pub fn icon(path: &'static str, size: f32, color: Rgba) -> impl IntoElement {
    svg()
        .path(path)
        .flex_none()
        .size(px(size))
        .text_color(color)
}

pub fn heading(t: &Tokens, label: impl Into<SharedString>) -> Div {
    div()
        .text_size(px(text::XXL))
        .line_height(px(text::XXL_LINE))
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(t.foreground)
        .child(label.into())
}

pub fn lead(t: &Tokens, label: impl Into<SharedString>) -> Div {
    div()
        .mt(px(10.))
        .text_size(px(text::SM))
        .line_height(px(text::SM * text::LEADING_RELAXED))
        .text_color(t.muted_foreground)
        .child(label.into())
}

pub fn surface_card(t: &Tokens) -> Div {
    div()
        .rounded(px(radius::LG))
        .border_1()
        .border_color(t.border)
        .bg(t.background)
}

pub fn command_block(
    id: &'static str,
    model: &CommandBlock,
    copied: bool,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    let client = client.clone();
    let command = model.command.clone();
    div()
        .flex()
        .items_center()
        .justify_between()
        .gap(px(COMMAND_GAP))
        .px(px(COMMAND_PADDING_X))
        .py(px(COMMAND_PADDING_Y))
        .rounded(px(radius::LG))
        .border_1()
        .border_color(t.border)
        .bg(fade(t.muted, 0.5))
        .font_family(MONO_FONT)
        .text_size(px(text::SM))
        .line_height(px(text::SM_LINE))
        .child(
            div()
                .flex()
                .min_w_0()
                .truncate()
                .child(
                    div()
                        .flex_none()
                        .mr(px(PROMPT_GAP))
                        .text_color(t.muted_foreground)
                        .child(model.prompt.clone()),
                )
                .child(div().text_color(t.foreground).child(model.command.clone())),
        )
        .child(
            Button::new(id)
                .size(ButtonSize::IconXs)
                .variant(ButtonVariant::Ghost)
                .icon(if copied { "check" } else { "copy" })
                .icon_size(COPY_ICON)
                .accessibility_label(model.copy_label.clone())
                .on_click(move |_, _, cx| {
                    act(
                        &client,
                        cx,
                        "welcomeCopyCommand",
                        json!({ "command": command }),
                    )
                }),
        )
        .into_any_element()
}
