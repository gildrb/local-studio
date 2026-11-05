use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Bounds, ElementId, Entity, FontWeight, InteractiveElement, IntoElement,
    MouseButton, ParentElement, Pixels, SharedString, StatefulInteractiveElement, Styled, canvas,
    div, px,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::pull_requests::{
    PullRequestGroupModel, PullRequestRowModel, PullRequestStackPopoverModel,
};
use crate::features::chat::toolbar_parts::act;
use crate::features::pull_requests::presentation::{
    TEXT_2XS, TEXT_3XS, avatar, diff_stat, glyph_path, label_chip, lucide_path, path_icon,
    provider_icon, signal_icon, tone,
};
use crate::platform::MONO_FONT;
use crate::ui::theme;
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

pub const ROW_HEIGHT: f32 = 56.;
pub const ROW_GAP: f32 = 2.;
pub const GROUP_HEADER_HEIGHT: f32 = 20.;
pub const GROUP_GAP: f32 = 12.;
const ROW_PADDING_X: f32 = 12.;
const ROW_PADDING_Y: f32 = 10.;
const ROW_RADIUS: f32 = 8.;
const ROW_GAP_X: f32 = 8.;
const GLYPH: f32 = 16.;
const GLYPH_TOP: f32 = 3.;
const CONFLICT: f32 = 12.;
const CONFLICT_OFFSET: f32 = -4.;
const LINE_GAP: f32 = 6.;
const SIGNAL_GAP: f32 = 4.;
const SIGNAL_ICON: f32 = 14.;
const STACK_ICON: f32 = 12.;
const META_ICON: f32 = 12.;
const AVATAR: f32 = 14.;
const AUTHOR_MAX: f32 = 160.;
const ENVIRONMENT_MAX: f32 = 128.;
const LABEL_MAX: f32 = 160.;
const LABEL_GAP: f32 = 4.;
const META_XS: f32 = 320.;
const META_XL: f32 = 576.;
const META_3XL: f32 = 768.;
const CHIP_MIN: f32 = 24.;

pub type AnchorBounds = Rc<RefCell<HashMap<String, Bounds<Pixels>>>>;

pub fn row_anchor(key: &str) -> String {
    format!("row:{key}")
}

fn record_anchor(anchors: &AnchorBounds, anchor: String) -> impl IntoElement {
    let anchors = anchors.clone();
    canvas(
        move |bounds, _, _| {
            anchors.borrow_mut().insert(anchor, bounds);
        },
        |_, _, _, _| {},
    )
    .absolute()
    .size_full()
}

pub struct RowContext<'a> {
    pub client: &'a Entity<CoreClient>,
    pub anchors: &'a AnchorBounds,
    pub stack_triggers: &'a HashMap<String, PullRequestStackPopoverModel>,
    pub open_anchor: Option<&'a str>,
    pub meta_width: f32,
    pub tokens: &'a Tokens,
}

fn trigger_popover(
    client: &Entity<CoreClient>,
    cx: &mut App,
    open: bool,
    action: &'static str,
    key: &str,
) {
    if open {
        act(client, cx, "pullRequestPopoverClose", json!({}));
    } else {
        act(client, cx, action, json!({ "key": key }));
    }
}

fn text(value: &str) -> SharedString {
    SharedString::from(value.to_string())
}

fn state_glyph(row: &PullRequestRowModel, t: &Tokens) -> impl IntoElement {
    let state_tone = tone(&row.state.tone_class_name, t);
    let background = t.background;
    div()
        .flex()
        .flex_col()
        .flex_none()
        .items_center()
        .w(px(GLYPH))
        .mt(px(GLYPH_TOP))
        .self_start()
        .child(
            div()
                .relative()
                .flex()
                .child(
                    div()
                        .id(ElementId::Name(text(&format!("pr-state-{}", row.key))))
                        .flex()
                        .flex_none()
                        .tooltip(Tooltip::text(row.state.label.clone()))
                        .child(path_icon(glyph_path(row.state.icon), GLYPH, state_tone)),
                )
                .when_some(row.conflict.as_ref(), |this, conflict| {
                    let conflict_tone = tone(&conflict.tone_class_name, t);
                    this.child(
                        div()
                            .id(ElementId::Name(text(&format!("pr-conflict-{}", row.key))))
                            .absolute()
                            .right(px(CONFLICT_OFFSET))
                            .bottom(px(CONFLICT_OFFSET))
                            .size(px(CONFLICT))
                            .tooltip(Tooltip::text(conflict.label.clone()))
                            .child(
                                path_icon(
                                    "icons/pull-requests/triangle-fill.svg",
                                    CONFLICT,
                                    background,
                                )
                                .absolute()
                                .top_0()
                                .left_0(),
                            )
                            .child(
                                path_icon(
                                    "icons/pull-requests/triangle-alert-bold.svg",
                                    CONFLICT,
                                    conflict_tone,
                                )
                                .absolute()
                                .top_0()
                                .left_0(),
                            ),
                    )
                }),
        )
}

fn checks_trigger(row: &PullRequestRowModel, cx: &RowContext) -> Option<AnyElement> {
    let checks = row.checks.as_ref()?;
    let client = cx.client.clone();
    let key = row.key.clone();
    let open = cx.open_anchor == Some(row_anchor(&row.key).as_str());
    Some(
        div()
            .id(ElementId::Name(text(&format!("pr-checks-{}", row.key))))
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .cursor_pointer()
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_click(move |_, _, cx| {
                cx.stop_propagation();
                trigger_popover(&client, cx, open, "pullRequestsChecksOpen", &key);
            })
            .child(signal_icon(
                ElementId::Name(text(&format!("pr-checks-spin-{}", row.key))),
                &checks.icon,
                SIGNAL_ICON,
                tone(&checks.tone_class_name, cx.tokens),
            ))
            .child(record_anchor(cx.anchors, row_anchor(&row.key)))
            .into_any_element(),
    )
}

fn review_glyph(row: &PullRequestRowModel, t: &Tokens) -> Option<AnyElement> {
    let review = row.review_decision.as_ref()?;
    Some(
        div()
            .id(ElementId::Name(text(&format!("pr-review-{}", row.key))))
            .flex()
            .flex_none()
            .tooltip(Tooltip::text(review.label.clone()))
            .child(signal_icon(
                ElementId::Name(text(&format!("pr-review-spin-{}", row.key))),
                &review.icon,
                SIGNAL_ICON,
                tone(&review.tone_class_name, t),
            ))
            .into_any_element(),
    )
}

fn stack_trigger(row: &PullRequestRowModel, cx: &RowContext) -> Option<AnyElement> {
    let membership = row.stack.as_ref()?;
    let trigger = cx.stack_triggers.get(&row.key);
    let position = trigger.map_or_else(
        || format!("{}/{}", membership.position, membership.size),
        |trigger| trigger.position_label.clone(),
    );
    let client = cx.client.clone();
    let key = row.key.clone();
    let open = cx.open_anchor == Some(row_anchor(&row.key).as_str());
    let t = cx.tokens;
    Some(
        div()
            .id(ElementId::Name(text(&format!("pr-stack-{}", row.key))))
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(SIGNAL_GAP))
            .cursor_pointer()
            .text_size(px(theme::metrics::text::XS))
            .line_height(px(theme::metrics::text::XS_LINE))
            .font_weight(FontWeight::NORMAL)
            .text_color(t.muted_foreground)
            .when_some(trigger, |this, trigger| {
                this.tooltip(Tooltip::text(trigger.tooltip.clone()))
            })
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_click(move |_, _, cx| {
                cx.stop_propagation();
                trigger_popover(&client, cx, open, "pullRequestsStackOpen", &key);
            })
            .child(path_icon(
                glyph_path(crate::app_core::views::pull_requests::PullRequestGlyphId::Stack),
                STACK_ICON,
                t.muted_foreground,
            ))
            .child(SharedString::from(position))
            .child(record_anchor(cx.anchors, row_anchor(&row.key)))
            .into_any_element(),
    )
}

fn labels(row: &PullRequestRowModel, meta_width: f32) -> Option<AnyElement> {
    if row.labels.is_empty() {
        return None;
    }
    let shown = if meta_width >= META_3XL {
        3
    } else if meta_width >= META_XL {
        2
    } else {
        1
    };
    let visible = row.labels.len().min(shown);
    Some(
        div()
            .flex()
            .min_w_0()
            .items_center()
            .gap(px(LABEL_GAP))
            .children(
                row.labels
                    .iter()
                    .take(visible)
                    .enumerate()
                    .map(|(index, label)| {
                        let last = index + 1 == visible;
                        let overflow = label.overflow_label.as_deref().filter(|_| last);
                        label_chip(&label.name, label.color.as_deref(), overflow, LABEL_MAX)
                    }),
            )
            .into_any_element(),
    )
}

fn meta_line(row: &PullRequestRowModel, cx: &RowContext) -> impl IntoElement {
    let t = cx.tokens;
    let wide = cx.meta_width >= META_XS;
    div()
        .flex()
        .min_w_0()
        .items_center()
        .gap(px(LINE_GAP))
        .overflow_hidden()
        .text_size(px(TEXT_2XS))
        .line_height(px(16.))
        .text_color(t.muted_foreground)
        .when_some(row.matched_elsewhere.as_ref(), |this, matched| {
            this.child(
                div()
                    .id(ElementId::Name(text(&format!("pr-matched-{}", row.key))))
                    .flex()
                    .min_w(px(CHIP_MIN))
                    .items_center()
                    .gap(px(4.))
                    .overflow_hidden()
                    .rounded_full()
                    .border_1()
                    .border_color(fade(t.border, 0.6))
                    .px(px(4.))
                    .text_size(px(TEXT_3XS))
                    .line_height(px(14.))
                    .tooltip(Tooltip::text(matched.tooltip.clone()))
                    .child(path_icon("icons/search.svg", META_ICON, t.muted_foreground))
                    .when(wide, |this| {
                        this.child(div().min_w_0().truncate().child(text(&matched.label)))
                    }),
            )
        })
        .when_some(row.provider.as_ref(), |this, provider| {
            this.child(
                div()
                    .id(ElementId::Name(text(&format!("pr-provider-{}", row.key))))
                    .flex()
                    .flex_none()
                    .tooltip(Tooltip::text(provider.name.clone()))
                    .child(provider_icon(&provider.icon, META_ICON, t.muted_foreground)),
            )
        })
        .child(
            div()
                .id(ElementId::Name(text(&format!("pr-author-{}", row.key))))
                .flex()
                .min_w(px(AVATAR))
                .max_w(px(AUTHOR_MAX))
                .items_center()
                .gap(px(4.))
                .tooltip(Tooltip::text(row.author.tooltip.clone()))
                .child(avatar(&row.author, AVATAR, t))
                .when(wide, |this| {
                    this.child(div().min_w_0().truncate().child(text(&row.author.login)))
                }),
        )
        .when_some(row.repository_label.as_ref(), |this, repository| {
            this.child(div().min_w_0().truncate().child(text(repository)))
        })
        .when_some(row.environment_label.as_ref(), |this, environment| {
            this.child(
                div()
                    .min_w_0()
                    .max_w(px(ENVIRONMENT_MAX))
                    .truncate()
                    .child(text(environment)),
            )
        })
        .children(labels(row, cx.meta_width))
        .when_some(row.updated_label.as_ref(), |this, updated| {
            this.child(
                div()
                    .ml_auto()
                    .flex_none()
                    .whitespace_nowrap()
                    .font_features(theme::tabular())
                    .child(text(updated)),
            )
        })
}

pub fn pull_request_row(row: &PullRequestRowModel, cx: &RowContext) -> AnyElement {
    let t = cx.tokens;
    let hover_bg = fade(t.accent, 0.6);
    let select_client = cx.client.clone();
    let menu_client = cx.client.clone();
    let select_key = row.key.clone();
    let menu_key = row.key.clone();
    let signals: Vec<AnyElement> = checks_trigger(row, cx)
        .into_iter()
        .chain(review_glyph(row, t))
        .collect();
    div()
        .id(ElementId::Name(text(&format!("pr-row-{}", row.key))))
        .flex()
        .w_full()
        .h(px(ROW_HEIGHT))
        .flex_none()
        .items_center()
        .gap(px(ROW_GAP_X))
        .px(px(ROW_PADDING_X))
        .py(px(ROW_PADDING_Y))
        .rounded(px(ROW_RADIUS))
        .cursor_pointer()
        .map(|this| {
            if row.selected {
                this.bg(t.accent)
            } else {
                this.hover(move |style| style.bg(hover_bg))
            }
        })
        .on_click(move |_, _, cx| {
            act(
                &select_client,
                cx,
                "pullRequestsSelect",
                json!({ "key": select_key }),
            );
        })
        .child(state_glyph(row, t))
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .child(
                    div()
                        .flex()
                        .min_w_0()
                        .items_center()
                        .gap(px(LINE_GAP))
                        .child(
                            div()
                                .id(ElementId::Name(text(&format!("pr-number-{}", row.key))))
                                .flex_none()
                                .font_family(MONO_FONT)
                                .font_features(theme::tabular())
                                .text_size(px(theme::metrics::text::XS))
                                .line_height(px(theme::metrics::text::XS_LINE))
                                .text_color(t.muted_foreground)
                                .on_mouse_down(MouseButton::Right, move |event, _, cx| {
                                    cx.stop_propagation();
                                    act(
                                        &menu_client,
                                        cx,
                                        "pullRequestsRowContextMenu",
                                        json!({
                                            "key": menu_key,
                                            "x": f32::from(event.position.x),
                                            "y": f32::from(event.position.y),
                                        }),
                                    );
                                })
                                .child(text(&row.number_label)),
                        )
                        .child(
                            div()
                                .min_w_0()
                                .truncate()
                                .text_size(px(theme::metrics::text::SM))
                                .line_height(px(theme::metrics::text::SM_LINE))
                                .text_color(t.foreground)
                                .child(text(&row.title)),
                        )
                        .when(!signals.is_empty(), |this| {
                            this.child(
                                div()
                                    .flex()
                                    .flex_none()
                                    .items_center()
                                    .gap(px(SIGNAL_GAP))
                                    .children(signals),
                            )
                        })
                        .child(
                            div()
                                .ml_auto()
                                .flex()
                                .flex_none()
                                .items_center()
                                .gap(px(LINE_GAP))
                                .children(stack_trigger(row, cx))
                                .when_some(row.diff_stat.as_ref(), |this, stat| {
                                    this.child(diff_stat(
                                        &stat.additions,
                                        &stat.deletions,
                                        TEXT_2XS,
                                        16.,
                                        t,
                                    ))
                                }),
                        ),
                )
                .child(meta_line(row, cx)),
        )
        .into_any_element()
}

pub fn group_header(group: &PullRequestGroupModel, cx: &App) -> impl IntoElement {
    let t = theme::active(cx);
    let tone = fade(t.muted_foreground, 0.7);
    div()
        .flex()
        .flex_none()
        .h(px(GROUP_HEADER_HEIGHT))
        .items_center()
        .gap(px(8.))
        .px(px(12.))
        .pb(px(4.))
        .text_size(px(theme::metrics::text::XS))
        .line_height(px(theme::metrics::text::XS_LINE))
        .font_weight(FontWeight::MEDIUM)
        .text_color(tone)
        .child(path_icon(lucide_path(&group.icon), 14., tone))
        .child(div().flex_none().child(text(&group.label)))
        .child(
            div()
                .flex_none()
                .font_features(theme::tabular())
                .text_color(fade(t.muted_foreground, 0.5))
                .child(text(&group.count_label)),
        )
        .child(div().flex_1().min_w(px(8.)).h(px(1.)).bg(t.border))
}
