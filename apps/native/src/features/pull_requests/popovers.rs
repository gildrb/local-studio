use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Bounds, ElementId, Entity, FontWeight, InteractiveElement, IntoElement,
    ParentElement, Pixels, SharedString, StatefulInteractiveElement, Styled, Window, div, px,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::pull_requests::{
    PullRequestCheckRowModel, PullRequestChecksPopoverBody, PullRequestChecksPopoverModel,
    PullRequestPopoverView, PullRequestStackLayerView,
};
use crate::features::chat::toolbar_parts::act;
use crate::features::pull_requests::presentation::{glyph_path, path_icon, signal_icon, tone};
use crate::ui::menu::{MenuGroupLabel, MenuItem, MenuPopup};
use crate::ui::popover::{Align, PopoverPopup, PopoverWidth, Side};
use crate::ui::theme;
use crate::ui::theme::metrics::text;
use crate::ui::tooltip::Tooltip;

const ROW_GAP: f32 = 4.;
const CELL_GAP: f32 = 8.;
const STATUS_ICON: f32 = 14.;
const LAYER_ICON: f32 = 16.;
const LAYERS_MAX_HEIGHT: f32 = 320.;

fn dismiss(
    client: &Entity<CoreClient>,
    trigger: Bounds<Pixels>,
) -> impl Fn(&mut Window, &mut App) + 'static + use<> {
    let client = client.clone();
    move |window, cx| {
        if trigger.contains(&window.mouse_position()) {
            return;
        }
        act(&client, cx, "pullRequestPopoverClose", json!({}));
    }
}

fn muted_text(value: &str, cx: &App) -> gpui::Div {
    let t = theme::active(cx);
    div()
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .text_color(t.muted_foreground)
        .child(SharedString::from(value.to_string()))
}

fn check_row(row: &PullRequestCheckRowModel, client: &Entity<CoreClient>, cx: &App) -> AnyElement {
    let t = theme::active(cx);
    let primary = t.primary;
    div()
        .flex()
        .items_center()
        .gap(px(CELL_GAP))
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .child(signal_icon(
            ElementId::Name(SharedString::from(format!("pr-check-status-{}", row.key))),
            &row.status.icon,
            STATUS_ICON,
            tone(&row.status.tone_class_name, &t),
        ))
        .child(
            div()
                .id(ElementId::Name(SharedString::from(format!(
                    "pr-check-name-{}",
                    row.key
                ))))
                .flex_1()
                .min_w_0()
                .truncate()
                .tooltip(Tooltip::text(row.tooltip.clone()))
                .child(SharedString::from(row.name.clone())),
        )
        .child(
            div()
                .flex_none()
                .text_color(t.muted_foreground)
                .child(SharedString::from(row.status_label.clone())),
        )
        .when_some(row.details_url.clone(), |this, url| {
            let client = client.clone();
            this.child(
                div()
                    .id(ElementId::Name(SharedString::from(format!(
                        "pr-check-details-{}",
                        row.key
                    ))))
                    .flex_none()
                    .cursor_pointer()
                    .text_color(primary)
                    .hover(move |style| style.underline().text_decoration_color(primary))
                    .on_click(move |_, _, cx| {
                        act(
                            &client,
                            cx,
                            "pullRequestPopoverOpenCheck",
                            json!({ "url": url }),
                        )
                    })
                    .child(SharedString::from(row.details_label.clone())),
            )
        })
        .into_any_element()
}

fn checks_popover(
    model: &PullRequestChecksPopoverModel,
    trigger: Bounds<Pixels>,
    client: &Entity<CoreClient>,
    cx: &App,
) -> AnyElement {
    let body = match &model.body {
        PullRequestChecksPopoverBody::None | PullRequestChecksPopoverBody::Lazy => None,
        PullRequestChecksPopoverBody::Message { message }
        | PullRequestChecksPopoverBody::Stale { message } => {
            Some(muted_text(message, cx).into_any_element())
        }
        PullRequestChecksPopoverBody::Rows { rows } => Some(
            div()
                .flex()
                .flex_col()
                .gap(px(ROW_GAP))
                .children(rows.iter().map(|row| check_row(row, client, cx)))
                .into_any_element(),
        ),
    };
    PopoverPopup::new("pr-checks-popover", trigger)
        .side(Side::Bottom)
        .align(Align::Start)
        .width(PopoverWidth::Md)
        .on_dismiss(dismiss(client, trigger))
        .child(
            div()
                .mb(px(8.))
                .text_size(px(text::SM))
                .line_height(px(text::SM_LINE))
                .font_weight(FontWeight::MEDIUM)
                .child(SharedString::from(model.title.clone())),
        )
        .when_some(model.summary.as_ref(), |this, summary| {
            this.child(muted_text(summary, cx).mb(px(8.)))
        })
        .children(body)
        .into_any_element()
}

fn stack_header(number: u64, notice: Option<&String>, stale: bool, cx: &App) -> AnyElement {
    let t = theme::active(cx);
    div()
        .flex()
        .items_center()
        .justify_between()
        .gap(px(CELL_GAP))
        .px(px(8.))
        .py(px(6.))
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.muted_foreground)
        .child(SharedString::from(format!("Stack #{number}")))
        .when_some(notice, |this, notice| {
            this.child(
                div()
                    .id("pr-stack-notice")
                    .font_weight(FontWeight::NORMAL)
                    .tooltip(Tooltip::text(notice.clone()))
                    .child(if stale {
                        "May be stale"
                    } else {
                        "Refreshing…"
                    }),
            )
        })
        .into_any_element()
}

fn stack_layer(
    layer: &PullRequestStackLayerView,
    client: &Entity<CoreClient>,
    cx: &App,
) -> AnyElement {
    let t = theme::active(cx);
    let client = client.clone();
    let number = layer.number;
    MenuItem::new(ElementId::Name(SharedString::from(format!(
        "pr-stack-layer-{}",
        layer.number
    ))))
    .disabled(layer.disabled)
    .on_click(move |_, _, cx| {
        act(
            &client,
            cx,
            "pullRequestPopoverSelectLayer",
            json!({ "number": number }),
        )
    })
    .child(path_icon(
        glyph_path(layer.state.icon),
        LAYER_ICON,
        tone(&layer.state.tone_class_name, &t),
    ))
    .child(
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .child(SharedString::from(layer.title.clone())),
            )
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .font_weight(FontWeight::NORMAL)
                    .text_color(t.muted_foreground)
                    .child(SharedString::from(layer.subtitle.clone())),
            ),
    )
    .when(layer.current, |this| {
        this.child(path_icon("icons/check.svg", STATUS_ICON, t.foreground))
    })
    .into_any_element()
}

pub fn pull_request_popover(
    view: &PullRequestPopoverView,
    trigger: Bounds<Pixels>,
    client: &Entity<CoreClient>,
    cx: &App,
) -> AnyElement {
    match view {
        PullRequestPopoverView::Checks { model, .. } => checks_popover(model, trigger, client, cx),
        PullRequestPopoverView::Stack {
            number,
            notice,
            stale,
            retry_label,
            message,
            layers,
            base,
            ..
        } => {
            let retry_client = client.clone();
            MenuPopup::new("pr-stack-popover", trigger)
                .side(Side::Bottom)
                .align(Align::Start)
                .on_dismiss(dismiss(client, trigger))
                .child(stack_header(*number, notice.as_ref(), *stale, cx))
                .when_some(retry_label.clone(), |this, label| {
                    this.child(MenuItem::new("pr-stack-retry").label(label).on_click(
                        move |_, _, cx| {
                            act(&retry_client, cx, "pullRequestPopoverRetry", json!({}))
                        },
                    ))
                })
                .when_some(message.clone(), |this, message| {
                    this.child(MenuGroupLabel::new(message))
                })
                .when(!layers.is_empty(), |this| {
                    this.child(
                        div()
                            .id("pr-stack-layers")
                            .flex()
                            .flex_col()
                            .max_h(px(LAYERS_MAX_HEIGHT))
                            .overflow_y_scroll()
                            .children(layers.iter().map(|layer| stack_layer(layer, client, cx))),
                    )
                })
                .when_some(base.as_ref(), |this, base| {
                    this.child(MenuGroupLabel::new(format!("↳ {base}")))
                })
                .into_any_element()
        }
    }
}
