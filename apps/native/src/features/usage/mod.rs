pub mod chart;
pub mod colors;
mod content;
mod limits;
mod page;
mod prices;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Div, ElementId, Entity, FontWeight, InteractiveElement, IntoElement,
    ParentElement, Rgba, SharedString, Stateful, StatefulInteractiveElement, Styled, Window, div,
    px,
};
use serde_json::Value;

use crate::app_core::client::CoreClient;
use crate::features::chat::provider_instance_icon::ProviderInstanceIcon;
use crate::ui::button::DISABLED_OPACITY;

pub use page::UsagePage;

pub(crate) const TEXT_4XS: f32 = 8.;
pub(crate) const TEXT_3XS: f32 = 10.;
pub(crate) const TEXT_2XS: f32 = 11.;
pub(crate) const TEXT_2XS_LINE: f32 = 16.;

pub(crate) fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

pub(crate) fn text(size: f32, line: f32) -> Div {
    div().text_size(px(size)).line_height(px(line))
}

pub(crate) fn provider_mark(provider: &str, color: Rgba, size: f32) -> AnyElement {
    ProviderInstanceIcon::new(chart::provider_driver(provider).to_string(), "", color)
        .icon_size(size)
        .into_any_element()
}

pub(crate) fn inline_button(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    color: Rgba,
    disabled: bool,
    on_click: impl Fn(&mut Window, &mut App) + 'static,
) -> Stateful<Div> {
    div()
        .id(id.into())
        .flex()
        .flex_none()
        .min_w_0()
        .items_center()
        .font_weight(FontWeight::MEDIUM)
        .text_color(color)
        .when(disabled, |this| this.opacity(DISABLED_OPACITY))
        .when(!disabled, move |this| {
            this.cursor_pointer()
                .hover(move |style| style.underline().text_decoration_color(color))
                .on_click(move |_, window, cx| on_click(window, cx))
        })
        .child(div().min_w_0().truncate().child(label.into()))
}
