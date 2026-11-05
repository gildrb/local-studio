use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, Entity, InteractiveElement, IntoElement, ParentElement, SharedString,
    StatefulInteractiveElement, Styled, div, px, svg,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::ui::button::DISABLED_OPACITY;
use crate::ui::theme::tokens::Tokens;
use crate::ui::tooltip::Tooltip;

const SIZE: f32 = 24.;
const RADIUS: f32 = 8.;
const ICON: f32 = 12.;

pub fn revert_user_message_button(
    row_id: &str,
    turn_count: u32,
    message_id: &str,
    disabled: bool,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    let hover_bg = t.accent;
    let client = client.clone();
    let message_id = message_id.to_string();
    div()
        .id(SharedString::from(format!("revert-{row_id}")))
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .size(px(SIZE))
        .rounded(px(RADIUS))
        .when(disabled, |this| this.opacity(DISABLED_OPACITY))
        .when(!disabled, |this| {
            this.cursor_pointer()
                .hover(move |s| s.bg(hover_bg))
                .on_click(move |_, _, cx| {
                    client.update(cx, |client, _| {
                        client.act(
                            "revertToTurnCount",
                            json!({ "turnCount": turn_count, "messageId": message_id }),
                        )
                    });
                })
        })
        .tooltip(Tooltip::text("Edit from here"))
        .child(
            svg()
                .path("icons/undo-2.svg")
                .size(px(ICON))
                .text_color(t.muted_foreground),
        )
        .into_any_element()
}
