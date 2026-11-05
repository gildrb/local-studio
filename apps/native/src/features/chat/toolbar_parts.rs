use gpui::{
    AnyElement, App, ClickEvent, Entity, IntoElement, SharedString, Styled, Window, div, img, px,
    svg,
};
use serde_json::{Value, json};

use crate::app_core::client::CoreClient;
use crate::ui::button::{Button, ButtonSize, ButtonVariant, ICON_PULL};
use crate::ui::theme::tokens::Tokens;

pub const BRAND_ICON: f32 = 14.;
pub const MENU_CHEVRON: f32 = 16.;
pub const SPLIT_RADIUS: f32 = 8.;
pub const CHILD_ICON_PADDING_LEFT: f32 = 7. - ICON_PULL;

pub fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

pub fn unavailable(
    client: &Entity<CoreClient>,
    feature: &'static str,
) -> impl Fn(&ClickEvent, &mut Window, &mut App) + 'static {
    let client = client.clone();
    move |_, _, cx| act(&client, cx, "unavailable", json!({ "feature": feature }))
}

pub fn asset_icon(dir: &str, id: &str, mono: &[&str], color: gpui::Rgba) -> AnyElement {
    let path = SharedString::from(format!("icons/{dir}/{id}.svg"));
    if mono.contains(&id) {
        svg()
            .path(path)
            .flex_none()
            .size(px(BRAND_ICON))
            .text_color(color)
            .into_any_element()
    } else {
        img(path)
            .flex_none()
            .size(px(BRAND_ICON))
            .into_any_element()
    }
}

pub fn split_main(button: Button) -> Button {
    button
        .variant(ButtonVariant::Outline)
        .size(ButtonSize::Xs)
        .rounded_l(px(SPLIT_RADIUS))
        .rounded_r_none()
        .border_r_0()
}

pub fn split_chevron(id: impl Into<gpui::ElementId>, t: &Tokens) -> Button {
    Button::new(id)
        .variant(ButtonVariant::Outline)
        .size(ButtonSize::IconXs)
        .icon("chevron-down")
        .icon_size(MENU_CHEVRON)
        .icon_color(t.muted_foreground)
        .rounded_r(px(SPLIT_RADIUS))
        .rounded_l_none()
        .border_l_0()
}

pub fn divider(t: &Tokens) -> gpui::Div {
    div().w(px(1.)).h_full().bg(t.input)
}
