use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Entity, InteractiveElement, IntoElement, ListState, ParentElement, RenderOnce,
    SharedString, StatefulInteractiveElement, Styled, Window, div, list, px, relative, svg,
};
use serde_json::json;
use std::rc::Rc;

use crate::app_core::client::CoreClient;
use crate::app_core::views::timeline::{TimelineRow, TimelineRowView};
use crate::features::chat::chat_markdown::markdown_document;
use crate::features::chat::message_copy_button::MessageCopyButton;
use crate::features::chat::revert_user_message_button::revert_user_message_button;
use crate::features::chat::timeline_work::{changed_files_card, work_row};
use crate::features::chat::user_message_parts::{UserBubble, user_bubble_children};
use crate::ui::theme;
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const SCROLL_PADDING_X: f32 = 20.;
const TOP_PADDING: f32 = 24.;
const BODY_TEXT: f32 = 14.;
const BODY_LINE: f32 = 22.75;
const META_TEXT: f32 = 12.;
const META_LINE: f32 = 16.;
const BUBBLE_RADIUS: f32 = 18.;
const BUBBLE_PADDING: f32 = 12.;
const BUBBLE_MAX_WIDTH: f32 = 0.8;
const FOLD_RADIUS: f32 = 8.;
const FOLD_PADDING_X: f32 = 4.;
const FOLD_GAP: f32 = 4.;
const CHEVRON: f32 = 14.;
const TURN_FOLD_PADDING_TOP: f32 = 4.;
const TURN_FOLD_PADDING_BOTTOM: f32 = 8.;
const TURN_FOLD_PADDING_RIGHT: f32 = 2.;
const USER_FOOTER_GAP: f32 = 4.;
const USER_FOOTER_PADDING_RIGHT: f32 = 4.;
const FOOTER_GAP: f32 = 8.;
const FOOTER_ACTIONS_GAP: f32 = 2.;
const ASSISTANT_PADDING_X: f32 = 4.;
const ASSISTANT_PADDING_Y: f32 = 2.;
const ASSISTANT_META_MARGIN: f32 = 6.;
const ASSISTANT_META_ROW_MARGIN: f32 = 2.;
const ASSISTANT_TEXT_OPACITY: f32 = 0.8;
const REASONING_GAP: f32 = 6.;
const REASONING_PADDING: f32 = 2.;
const REASONING_ICON_BOX: f32 = 24.;
const REASONING_ICON: f32 = 16.;
const REASONING_ICON_OPACITY: f32 = 0.7;
const REASONING_CHEVRON_BOX: f32 = 16.;
const REASONING_CHEVRON: f32 = 12.;
const REASONING_EXPANDED_MARGIN: f32 = 4.;
const REASONING_BODY_MARGIN_TOP: f32 = 4.;
const REASONING_BODY_INDENT: f32 = 28.;
const REASONING_BODY_MAX_HEIGHT: f32 = 384.;
const REASONING_BODY_PADDING_Y: f32 = 4.;

#[derive(IntoElement)]
pub struct MessagesTimeline {
    rows: Rc<Vec<TimelineRow>>,
    client: Entity<CoreClient>,
    list: ListState,
    bottom_inset: f32,
}

impl MessagesTimeline {
    pub fn new(rows: Rc<Vec<TimelineRow>>, client: Entity<CoreClient>, list: ListState) -> Self {
        Self {
            rows,
            client,
            list,
            bottom_inset: 0.,
        }
    }

    pub fn bottom_inset(mut self, inset: f32) -> Self {
        self.bottom_inset = inset;
        self
    }
}

fn meta(id: String, text: &str, tooltip: &str, t: &Tokens) -> gpui::Stateful<gpui::Div> {
    div()
        .id(SharedString::from(id))
        .flex_none()
        .text_size(px(META_TEXT))
        .line_height(px(META_LINE))
        .text_color(t.muted_foreground)
        .tooltip(Tooltip::text(tooltip.to_string()))
        .child(text.to_string())
}

fn fold_button(
    id: String,
    label: String,
    expanded: bool,
    t: &Tokens,
    on_click: impl Fn(&mut App) + 'static,
) -> AnyElement {
    let hover = t.foreground;
    div()
        .id(SharedString::from(id))
        .flex()
        .flex_none()
        .items_center()
        .gap(px(FOLD_GAP))
        .px(px(FOLD_PADDING_X))
        .rounded(px(FOLD_RADIUS))
        .cursor_pointer()
        .text_size(px(BODY_TEXT))
        .line_height(px(BODY_LINE))
        .text_color(t.muted_foreground)
        .hover(move |style| style.text_color(hover))
        .child(label)
        .child(
            svg()
                .path(if expanded {
                    "icons/chevron-down.svg"
                } else {
                    "icons/chevron-right.svg"
                })
                .size(px(CHEVRON))
                .text_color(t.muted_foreground),
        )
        .on_click(move |_, _, cx| on_click(cx))
        .into_any_element()
}

fn timeline_row(
    client: &Entity<CoreClient>,
    row: &TimelineRowView,
    t: &Tokens,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let act = |action: &'static str, params: serde_json::Value| {
        let client = client.clone();
        move |cx: &mut App| {
            client.update(cx, |client, _| client.act(action, params.clone()));
        }
    };
    match row {
        TimelineRowView::User {
            id,
            message_id,
            document,
            images,
            videos,
            files,
            unknown_attachments,
            collapsible,
            expanded,
            copy_text,
            revert_turn_count,
            revert_disabled,
            time_label,
            time_tooltip,
            ..
        } => {
            let group = SharedString::from(format!("user-row-{id}"));
            div()
                .group(group.clone())
                .flex()
                .flex_col()
                .items_end()
                .gap(px(USER_FOOTER_GAP))
                .child(
                    div()
                        .max_w(relative(BUBBLE_MAX_WIDTH))
                        .min_w_0()
                        .rounded(px(BUBBLE_RADIUS))
                        .bg(t.message_surface)
                        .p(px(BUBBLE_PADDING))
                        .text_color(t.message_foreground)
                        .children(user_bubble_children(
                            UserBubble {
                                id,
                                message_id,
                                document: document.as_ref(),
                                images,
                                videos,
                                files,
                                unknown_attachments,
                                collapsible: *collapsible,
                                expanded: *expanded,
                            },
                            client,
                            t,
                            window,
                            cx,
                        )),
                )
                .child(
                    div()
                        .flex()
                        .w_full()
                        .max_w(relative(BUBBLE_MAX_WIDTH))
                        .items_center()
                        .justify_end()
                        .pr(px(USER_FOOTER_PADDING_RIGHT))
                        .opacity(0.)
                        .group_hover(group, |s| s.opacity(1.))
                        .child(
                            div()
                                .flex()
                                .flex_none()
                                .items_center()
                                .gap(px(FOOTER_GAP))
                                .child(meta(format!("user-time-{id}"), time_label, time_tooltip, t))
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap(px(FOOTER_ACTIONS_GAP))
                                        .when_some(*revert_turn_count, |this, turn_count| {
                                            this.child(revert_user_message_button(
                                                id,
                                                turn_count,
                                                message_id,
                                                *revert_disabled,
                                                client,
                                                t,
                                            ))
                                        })
                                        .when_some(copy_text.clone(), |this, copy_text| {
                                            this.child(MessageCopyButton::new(
                                                format!("copy-{id}"),
                                                copy_text,
                                            ))
                                        }),
                                ),
                        ),
                )
                .into_any_element()
        }
        TimelineRowView::Assistant {
            id,
            document,
            copy_text,
            streaming,
            show_meta,
            time_label,
            time_tooltip,
            changed_files,
            ..
        } => {
            let group = SharedString::from(format!("assistant-row-{id}"));
            div()
                .group(group.clone())
                .min_w_0()
                .px(px(ASSISTANT_PADDING_X))
                .py(px(ASSISTANT_PADDING_Y))
                .child(markdown_document(
                    id,
                    document,
                    fade(t.foreground, ASSISTANT_TEXT_OPACITY),
                    client,
                    t,
                    window,
                    cx,
                ))
                .when_some(changed_files.as_ref(), |this, card| {
                    this.child(changed_files_card(card, client, t, cx))
                })
                .when(*show_meta, |this| {
                    this.child(
                        assistant_meta(
                            id,
                            copy_text.clone(),
                            *streaming,
                            time_label,
                            time_tooltip,
                            t,
                        )
                        .mt(px(ASSISTANT_META_MARGIN))
                        .opacity(0.)
                        .group_hover(group, |s| s.opacity(1.)),
                    )
                })
                .into_any_element()
        }
        TimelineRowView::AssistantMeta {
            id,
            copy_text,
            time_label,
            time_tooltip,
            ..
        } => div()
            .px(px(ASSISTANT_PADDING_X))
            .child(
                assistant_meta(id, copy_text.clone(), false, time_label, time_tooltip, t)
                    .mt(px(ASSISTANT_META_ROW_MARGIN)),
            )
            .into_any_element(),
        TimelineRowView::Reasoning {
            id,
            message_id,
            expanded,
            document,
            ..
        } => {
            let hover_bg = fade(t.accent, 0.2);
            let toggle = act("toggleReasoning", json!({ "messageId": message_id }));
            div()
                .flex()
                .flex_col()
                .when(*expanded, |this| this.mb(px(REASONING_EXPANDED_MARGIN)))
                .child(
                    div()
                        .id(SharedString::from(format!("reasoning-{id}")))
                        .flex()
                        .items_center()
                        .gap(px(REASONING_GAP))
                        .rounded(px(FOLD_RADIUS))
                        .px(px(REASONING_PADDING))
                        .py(px(REASONING_PADDING))
                        .cursor_pointer()
                        .hover(move |style| style.bg(hover_bg))
                        .on_click(move |_, _, cx| toggle(cx))
                        .child(
                            div()
                                .flex()
                                .flex_none()
                                .items_center()
                                .justify_center()
                                .size(px(REASONING_ICON_BOX))
                                .child(
                                    svg()
                                        .path("icons/brain.svg")
                                        .size(px(REASONING_ICON))
                                        .opacity(REASONING_ICON_OPACITY)
                                        .text_color(t.icon_muted),
                                ),
                        )
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .text_size(px(BODY_TEXT))
                                .line_height(px(BODY_LINE))
                                .text_color(t.secondary_label)
                                .child("Thought"),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_none()
                                .items_center()
                                .justify_center()
                                .size(px(REASONING_CHEVRON_BOX))
                                .child(
                                    svg()
                                        .path(if *expanded {
                                            "icons/chevron-down.svg"
                                        } else {
                                            "icons/chevron-right.svg"
                                        })
                                        .size(px(REASONING_CHEVRON))
                                        .opacity(REASONING_ICON_OPACITY)
                                        .text_color(t.icon_muted),
                                ),
                        ),
                )
                .when_some(document.as_ref(), |this, document| {
                    this.child(
                        div()
                            .id(SharedString::from(format!("reasoning-body-{id}")))
                            .mt(px(REASONING_BODY_MARGIN_TOP))
                            .ml(px(REASONING_BODY_INDENT))
                            .max_h(px(REASONING_BODY_MAX_HEIGHT))
                            .overflow_y_scroll()
                            .px(px(REASONING_PADDING))
                            .py(px(REASONING_BODY_PADDING_Y))
                            .child(markdown_document(
                                id,
                                document,
                                t.foreground,
                                client,
                                t,
                                window,
                                cx,
                            )),
                    )
                })
                .into_any_element()
        }
        TimelineRowView::TurnFold {
            id,
            turn_id,
            label,
            expanded,
            time_label,
            time_tooltip,
        } => {
            let group = SharedString::from(format!("turn-fold-{id}"));
            div()
                .group(group.clone())
                .flex()
                .items_center()
                .gap(px(FOLD_GAP))
                .border_b_1()
                .border_color(fade(t.border, 0.6))
                .pt(px(TURN_FOLD_PADDING_TOP))
                .pb(px(TURN_FOLD_PADDING_BOTTOM))
                .pr(px(TURN_FOLD_PADDING_RIGHT))
                .child(fold_button(
                    id.clone(),
                    label.clone(),
                    *expanded,
                    t,
                    act("toggleTurnFold", json!({ "turnId": turn_id })),
                ))
                .child(div().flex_1())
                .child(
                    meta(format!("turn-fold-time-{id}"), time_label, time_tooltip, t)
                        .mr(px(FOLD_PADDING_X))
                        .opacity(0.)
                        .group_hover(group, |s| s.opacity(1.)),
                )
                .into_any_element()
        }
        TimelineRowView::WorkToggle(_)
        | TimelineRowView::Work(_)
        | TimelineRowView::WorkLive(_)
        | TimelineRowView::ActivityGroup(_)
        | TimelineRowView::Working(_)
        | TimelineRowView::Thinking { .. }
        | TimelineRowView::ContextCompaction { .. } => {
            work_row(client, row, t, window, cx).unwrap_or_else(|| div().into_any_element())
        }
        TimelineRowView::ProposedPlan(plan) => {
            crate::features::chat::proposed_plan_card::ProposedPlanCard::new(plan, client.clone())
                .into_any_element()
        }
    }
}

fn assistant_meta(
    id: &str,
    copy_text: Option<String>,
    streaming: bool,
    time_label: &str,
    time_tooltip: &str,
    t: &Tokens,
) -> gpui::Div {
    div()
        .flex()
        .items_center()
        .gap(px(FOOTER_GAP))
        .text_size(px(META_TEXT))
        .line_height(px(META_LINE))
        .when_some(copy_text, |this, text| {
            this.child(MessageCopyButton::new(format!("assistant-copy-{id}"), text))
        })
        .when(!streaming, |this| {
            this.child(meta(
                format!("assistant-time-{id}"),
                time_label,
                time_tooltip,
                t,
            ))
        })
}

impl RenderOnce for MessagesTimeline {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let rows = self.rows;
        let client = self.client;
        list(self.list, move |index, window, cx| {
            let t = theme::active(cx);
            let Some(row) = rows.get(index) else {
                return div().into_any_element();
            };
            let content = timeline_row(&client, &row.view, &t, window, cx);
            div()
                .w_full()
                .px(px(SCROLL_PADDING_X))
                .child(
                    div()
                        .mx_auto()
                        .w_full()
                        .min_w_0()
                        .when_some(t.chat_max_width, |this, width| this.max_w(px(width)))
                        .pb(px(row.padding_bottom))
                        .child(content),
                )
                .into_any_element()
        })
        .size_full()
        .min_h_0()
        .pt(px(TOP_PADDING))
        .pb(px(self.bottom_inset))
    }
}
