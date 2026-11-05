use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Entity, FontWeight, InteractiveElement, IntoElement, ParentElement,
    SharedString, StatefulInteractiveElement, Styled, Window, div, px, svg,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::sidebar::SidebarDraftRowView;
use crate::features::sidebar::sidebar_row_parts::{RowHover, act};
use crate::ui::project_favicon::ProjectFavicon;
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const CARD_HEIGHT: f32 = 78.;
const ROW_CONTENT_INSET: f32 = 10.;
const CONTENT_INSET: f32 = 8.;
const META_HEIGHT: f32 = 20.;
const DRAFT_SURFACE: f32 = 0.04;
const DRAFT_SURFACE_HOVER: f32 = 0.08;
const PREVIEW_TEXT: f32 = 0.9;
const DIVIDER: f32 = 0.6;

pub fn draft_row(
    row: &SidebarDraftRowView,
    client: &Entity<CoreClient>,
    t: &Tokens,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let hover = RowHover::new(&row.key, window, cx);
    let open = client.clone();
    let open_params = json!({ "draftId": row.draft_id });
    let discard = client.clone();
    let discard_params = json!({ "draftId": row.draft_id });
    let foreground = t.foreground;
    let hover_bg = fade(t.warning, DRAFT_SURFACE_HOVER);
    let surface = div()
        .id(SharedString::from(format!("sidebar-draft-row-{}", row.key)))
        .relative()
        .w_full()
        .cursor_pointer()
        .overflow_hidden()
        .rounded(px(8.))
        .text_color(t.sidebar_foreground)
        .map(|this| {
            if row.is_active {
                this.bg(t.sidebar_row_active)
            } else {
                this.bg(fade(t.warning, DRAFT_SURFACE))
                    .hover(move |style| style.bg(hover_bg))
            }
        })
        .on_hover(hover.listener())
        .on_click(move |_, _, cx| act(&open, cx, "sidebarDraftOpen", open_params.clone()));
    let discard_button = div()
        .id(SharedString::from(format!(
            "sidebar-draft-discard-{}",
            row.key
        )))
        .flex()
        .items_center()
        .px(px(4.))
        .rounded(px(8.))
        .cursor_pointer()
        .when(!hover.hovered, |this| this.opacity(0.))
        .tooltip(Tooltip::text("Discard draft"))
        .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .on_click(move |_, _, cx| {
            cx.stop_propagation();
            act(&discard, cx, "sidebarDraftDiscard", discard_params.clone());
        })
        .child(
            svg()
                .path("icons/x.svg")
                .size(px(12.))
                .text_color(t.muted_foreground)
                .hover(move |style| style.text_color(foreground)),
        );
    let line_one = div()
        .flex()
        .h(px(META_HEIGHT))
        .min_w_0()
        .items_center()
        .gap(px(6.))
        .child(
            svg()
                .path("icons/square-pen.svg")
                .flex_none()
                .size(px(12.))
                .text_color(t.warning_foreground),
        )
        .children(
            row.project
                .icon
                .as_ref()
                .map(|icon| ProjectFavicon::new(icon, 16.)),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .truncate()
                .text_size(px(12.))
                .line_height(px(16.))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.secondary_label)
                .children(row.project.display_name.clone()),
        )
        .child(
            div()
                .ml_auto()
                .flex()
                .flex_none()
                .h(px(META_HEIGHT))
                .min_w(px(20.))
                .items_center()
                .justify_end()
                .child(discard_button),
        );
    div()
        .py(px(2.))
        .child(
            surface.child(
                div()
                    .relative()
                    .h(px(CARD_HEIGHT))
                    .px(px(ROW_CONTENT_INSET))
                    .py(px(CONTENT_INSET))
                    .child(line_one)
                    .child(
                        div()
                            .mt(px(2.))
                            .truncate()
                            .text_size(px(14.))
                            .line_height(px(20.))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(fade(t.foreground, PREVIEW_TEXT))
                            .child(row.preview.clone()),
                    ),
            ),
        )
        .into_any_element()
}

pub fn draft_divider(t: &Tokens) -> AnyElement {
    div()
        .flex_none()
        .mx(px(10.))
        .my(px(6.))
        .h(px(1.))
        .bg(fade(t.sidebar_border, DIVIDER))
        .into_any_element()
}
