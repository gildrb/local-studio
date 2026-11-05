use std::time::Duration;

use gpui::prelude::FluentBuilder;
use gpui::{
    Animation, AnimationExt, AnyElement, App, Context, ElementId, Entity, FontWeight,
    InteractiveElement, IntoElement, MouseButton, ObjectFit, ParentElement, Render, Rgba,
    SharedString, StatefulInteractiveElement, Styled, StyledImage, Subscription, Transformation,
    Window, div, img, percentage, pulsating_between, px, svg,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::timeline::TimelineRowView;
use crate::app_core::views::timeline_work::{
    ActivityDetailView, ChangedFilesCardView, ChangedFilesNodeView, DiffStatView, FolderIcon,
    LiveActivityView, ReasoningTraceView, ToggleAllIcon, WorkEntryView, WorkHeadingTone,
    WorkIconName, WorkIconTone, WorkIconView, WorkingView,
};
use crate::features::chat::chat_markdown::markdown_document;
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::pierre_icon::pierre_icon;
use crate::ui::theme::tokens::{Appearance, Tokens, fade};
use crate::ui::tooltip::Tooltip;

const BODY_TEXT: f32 = 14.;
const BODY_LINE: f32 = 22.75;
const META_TEXT: f32 = 12.;
const META_LINE: f32 = 16.;
const ROW_RADIUS: f32 = 8.;
const ROW_GAP: f32 = 6.;
const ROW_PADDING: f32 = 2.;
const ROW_MIN_HEIGHT: f32 = 24.;
const ICON_BOX: f32 = 24.;
const ICON: f32 = 16.;
const ICON_OPACITY: f32 = 0.7;
const IMAGE_ICON_RADIUS: f32 = 2.;
const FAILURE_MARK: f32 = 12.;
const FAILED_ICON_OPACITY: f32 = 0.4;
const HOVER_ACCENT_OPACITY: f32 = 0.2;
const TIMESTAMP_MARGIN_RIGHT: f32 = 4.;
const CHEVRON_BOX: f32 = 16.;
const CHEVRON: f32 = 12.;
const ENTRY_EXPANDED_MARGIN: f32 = 4.;
const ENTRY_GAP: f32 = 1.;
const BODY_MARGIN_TOP: f32 = 4.;
const BODY_INDENT: f32 = 28.;
const BODY_PADDING_X: f32 = 12.;
const BODY_PADDING_Y: f32 = 8.;
const BODY_SURFACE_OPACITY: f32 = 0.4;
const BODY_MAX_HEIGHT: f32 = 256.;
const CODE_LINE_RATIO: f32 = 1.625;
const GROUP_MAX_HEIGHT: f32 = 288.;
const GROUP_SCROLLBAR_GUTTER: f32 = 6.;
const DETAILS_MARGIN_TOP: f32 = 8.;
const TRACE_PADDING_END: f32 = 8.;
const TRACE_BODY_MAX_HEIGHT: f32 = 384.;
const TRACE_BODY_GAP: f32 = 12.;
const TRACE_BODY_PADDING_Y: f32 = 4.;
const WORKING_PADDING_TOP: f32 = 4.;
const WORKING_PADDING_BOTTOM: f32 = 8.;
const WORKING_PADDING_X: f32 = 4.;
const WORKING_GAP: f32 = 8.;
const WORKING_BORDER_OPACITY: f32 = 0.6;
const THINKING_MIN_HEIGHT: f32 = 28.;
const COMPACTION_GAP: f32 = 12.;
const COMPACTION_PADDING_Y: f32 = 4.;
const COMPACTION_ICON: f32 = 12.;
const COMPACTION_RULE_OPACITY: f32 = 0.7;
const ACTIVITY_CYCLE: Duration = Duration::from_millis(2200);
const ACTIVITY_DIM: f32 = 0.45;
const CARD_MARGIN_TOP: f32 = 16.;
const CARD_RADIUS: f32 = 10.;
const CARD_SURFACE_OPACITY: f32 = 0.2;
const CARD_HEADER_PADDING_X: f32 = 12.;
const CARD_HEADER_PADDING_Y: f32 = 8.;
const CARD_HEADER_GAP: f32 = 8.;
const CARD_SUMMARY_GAP_X: f32 = 12.;
const CARD_SUMMARY_GAP_Y: f32 = 4.;
const CARD_ACTIONS_GAP: f32 = 4.;
const CARD_ACTION_ICON: f32 = 12.;
const CARD_STAT_GAP: f32 = 4.;
const TREE_PADDING: f32 = 8.;
const TREE_ROW_GAP: f32 = 8.;
const TREE_ROW_PADDING_Y: f32 = 6.;
const TREE_ROW_PADDING_END: f32 = 8.;
const TREE_HOVER_OPACITY: f32 = 0.6;
const TREE_ICON: f32 = 14.;
const TREE_CHEVRON_OPACITY: f32 = 0.7;
const TREE_CHEVRON_HOVER_OPACITY: f32 = 0.8;
const TREE_FOLDER_OPACITY: f32 = 0.75;
const TREE_DIRECTORY_TEXT: f32 = 11.;
const TREE_DIRECTORY_OPACITY: f32 = 0.9;
const TREE_FILE_OPACITY: f32 = 0.85;
const TREE_STAT_TEXT: f32 = 10.;
const TREE_STAT_LINE: f32 = 14.;
const TREE_STAT_COLUMN: f32 = 24.1;
const TREE_STAT_GAP: f32 = 8.;

fn act(
    client: &Entity<CoreClient>,
    action: &'static str,
    params: Value,
) -> impl Fn(&mut App) + 'static + use<> {
    let client = client.clone();
    move |cx: &mut App| client.update(cx, |client, _| client.act(action, params.clone()))
}

fn element_id(prefix: &str, id: &str) -> ElementId {
    ElementId::Name(SharedString::from(format!("{prefix}-{id}")))
}

fn glyph_path(name: WorkIconName) -> &'static str {
    match name {
        WorkIconName::Bot => "icons/bot.svg",
        WorkIconName::Brain => "icons/brain.svg",
        WorkIconName::Browser => "icons/timeline/browser.svg",
        WorkIconName::Check => "icons/check.svg",
        WorkIconName::CircleAlert => "icons/circle-alert.svg",
        WorkIconName::Computer => "icons/timeline/computer-use.svg",
        WorkIconName::Device => "icons/smartphone.svg",
        WorkIconName::Eye => "icons/eye.svg",
        WorkIconName::Globe => "icons/globe.svg",
        WorkIconName::Hammer => "icons/hammer.svg",
        WorkIconName::MessageCircle => "icons/message-circle.svg",
        WorkIconName::Search => "icons/search.svg",
        WorkIconName::SquarePen => "icons/square-pen.svg",
        WorkIconName::Terminal => "icons/terminal.svg",
        WorkIconName::PullRequest => "icons/git-pull-request-arrow.svg",
        WorkIconName::T3Code => "icons/box.svg",
        WorkIconName::Wrench => "icons/wrench.svg",
        WorkIconName::X => "icons/x.svg",
        WorkIconName::Zap => "icons/zap.svg",
    }
}

fn glyph(name: WorkIconName, color: Rgba) -> AnyElement {
    match name {
        WorkIconName::Computer => img(glyph_path(name))
            .flex_none()
            .size(px(ICON))
            .opacity(ICON_OPACITY)
            .into_any_element(),
        _ => svg()
            .path(glyph_path(name))
            .flex_none()
            .size(px(ICON))
            .text_color(color)
            .opacity(ICON_OPACITY)
            .into_any_element(),
    }
}

fn work_icon(icon: &WorkIconView, color: Rgba, t: &Tokens) -> AnyElement {
    let url = match t.appearance {
        Appearance::Dark => icon.image_url_dark.clone(),
        Appearance::Light => icon.image_url.clone(),
    };
    let name = icon.name;
    let icon_box = div()
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .size(px(ICON_BOX))
        .text_color(color);
    match url {
        Some(url) => icon_box
            .child(
                div()
                    .flex_none()
                    .size(px(ICON))
                    .overflow_hidden()
                    .rounded(px(IMAGE_ICON_RADIUS))
                    .bg(t.background)
                    .opacity(ICON_OPACITY)
                    .child(
                        img(SharedString::from(url))
                            .size(px(ICON))
                            .object_fit(ObjectFit::Contain)
                            .with_fallback(move || glyph(name, color))
                            .with_loading(move || glyph(name, color)),
                    ),
            )
            .into_any_element(),
        None => icon_box.child(glyph(name, color)).into_any_element(),
    }
}

fn failed_color(t: &Tokens) -> Rgba {
    fade(t.tool_error_icon, FAILED_ICON_OPACITY)
}

fn icon_tone_color(tone: WorkIconTone, t: &Tokens) -> Rgba {
    match tone {
        WorkIconTone::Warning => t.warning,
        WorkIconTone::Destructive => t.destructive,
        WorkIconTone::Failed => failed_color(t),
        WorkIconTone::IconMuted => t.icon_muted,
        WorkIconTone::Foreground => t.foreground,
    }
}

fn failure_mark(t: &Tokens) -> AnyElement {
    svg()
        .path("icons/x.svg")
        .flex_none()
        .size(px(FAILURE_MARK))
        .text_color(failed_color(t))
        .into_any_element()
}

fn hover_timestamp(label: &str, group: SharedString, t: &Tokens) -> AnyElement {
    div()
        .absolute()
        .flex_none()
        .mr(px(TIMESTAMP_MARGIN_RIGHT))
        .whitespace_nowrap()
        .text_size(px(META_TEXT))
        .line_height(px(META_LINE))
        .text_color(t.muted_foreground)
        .opacity(0.)
        .group_hover(group, |s| s.relative().opacity(1.))
        .child(SharedString::from(label.to_owned()))
        .into_any_element()
}

fn chevron(expanded: bool, visible: bool, color: Rgba, size: f32) -> gpui::Svg {
    svg()
        .path("icons/chevron-right.svg")
        .flex_none()
        .size(px(size))
        .text_color(color)
        .when(expanded, |this| {
            this.with_transformation(Transformation::rotate(percentage(0.25)))
        })
        .when(!visible, |this| this.opacity(0.))
}

fn chevron_box(expanded: bool, visible: bool, t: &Tokens) -> AnyElement {
    div()
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .size(px(CHEVRON_BOX))
        .child(
            chevron(expanded, visible, t.icon_muted, CHEVRON)
                .when(visible, |this| this.opacity(ICON_OPACITY)),
        )
        .into_any_element()
}

fn activity_pulse(id: ElementId, content: gpui::Div) -> AnyElement {
    content
        .with_animation(
            id,
            Animation::new(ACTIVITY_CYCLE)
                .repeat()
                .with_easing(pulsating_between(ACTIVITY_DIM, 1.)),
            |content, delta| content.opacity(delta),
        )
        .into_any_element()
}

fn stop_row_toggle(element: gpui::Stateful<gpui::Div>) -> gpui::Stateful<gpui::Div> {
    element
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .on_click(|_, _, cx| cx.stop_propagation())
}

fn work_entry(
    client: &Entity<CoreClient>,
    entry: &WorkEntryView,
    in_group: bool,
    t: &Tokens,
) -> AnyElement {
    let group = SharedString::from(format!("work-entry-{}", entry.id));
    let heading = match entry.heading_tone {
        WorkHeadingTone::Warning => t.warning,
        WorkHeadingTone::Destructive => t.destructive,
        WorkHeadingTone::SecondaryLabel => t.secondary_label,
        WorkHeadingTone::Foreground80 => fade(t.foreground, 0.8),
    };
    let emphasized = matches!(
        entry.heading_tone,
        WorkHeadingTone::Warning | WorkHeadingTone::Destructive
    );
    let has_answer = entry.answer_preview.is_some();
    let hover = fade(t.accent, HOVER_ACCENT_OPACITY);
    let toggle = act(client, "toggleWorkEntry", json!({ "entryId": entry.id }));
    let label = div()
        .min_w_0()
        .when(!has_answer, |this| this.flex_1())
        .text_color(heading)
        .when(emphasized, |this| this.font_weight(FontWeight::MEDIUM))
        .map(|this| {
            if entry.expanded {
                this.whitespace_normal()
            } else {
                this.truncate()
            }
        })
        .child(SharedString::from(entry.label.clone()));
    div()
        .id(element_id("work-entry", &entry.id))
        .group(group.clone())
        .relative()
        .flex()
        .flex_col()
        .rounded(px(ROW_RADIUS))
        .px(px(ROW_PADDING))
        .when(!in_group, |this| this.py(px(ROW_PADDING)))
        .when(entry.expanded, |this| this.mb(px(ENTRY_EXPANDED_MARGIN)))
        .when(entry.can_expand, |this| {
            this.cursor_pointer()
                .hover(move |s| s.bg(hover))
                .on_click(move |_, _, cx| toggle(cx))
        })
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(ROW_GAP))
                .child(work_icon(
                    &entry.icon,
                    icon_tone_color(entry.icon_tone, t),
                    t,
                ))
                .child(
                    div()
                        .relative()
                        .flex()
                        .min_w_0()
                        .flex_1()
                        .items_center()
                        .gap(px(ROW_GAP))
                        .child(
                            div().min_w_0().flex_1().overflow_hidden().child(
                                div()
                                    .flex()
                                    .min_w_0()
                                    .w_full()
                                    .items_start()
                                    .gap(px(ROW_GAP))
                                    .text_size(px(BODY_TEXT))
                                    .line_height(px(BODY_LINE))
                                    .child(label)
                                    .when_some(entry.answer_preview.clone(), |this, answer| {
                                        this.child(
                                            div()
                                                .min_w_0()
                                                .truncate()
                                                .text_color(if entry.answer_highlighted {
                                                    t.foreground
                                                } else {
                                                    t.muted_foreground
                                                })
                                                .child(SharedString::from(answer)),
                                        )
                                    }),
                            ),
                        )
                        .when(entry.show_trailing_failure_mark, |this| {
                            this.child(failure_mark(t))
                        })
                        .child(hover_timestamp(&entry.time_label, group, t))
                        .child(chevron_box(entry.expanded, entry.can_expand, t)),
                ),
        )
        .when_some(entry.expanded_body.clone(), |this, body| {
            this.child(
                div()
                    .mt(px(BODY_MARGIN_TOP))
                    .ml(px(BODY_INDENT))
                    .rounded(px(ROW_RADIUS))
                    .bg(fade(t.muted, BODY_SURFACE_OPACITY))
                    .px(px(BODY_PADDING_X))
                    .py(px(BODY_PADDING_Y))
                    .cursor_default()
                    .child(stop_row_toggle(
                        div()
                            .id(element_id("work-entry-body", &entry.id))
                            .max_h(px(BODY_MAX_HEIGHT))
                            .overflow_y_scroll()
                            .font_family(MONO_FONT)
                            .text_size(px(t.code_font_size))
                            .line_height(px(t.code_font_size * CODE_LINE_RATIO))
                            .text_color(t.secondary_label)
                            .child(SharedString::from(body)),
                    )),
            )
        })
        .into_any_element()
}

fn work_group(
    client: &Entity<CoreClient>,
    id: &str,
    entries: &[WorkEntryView],
    t: &Tokens,
) -> AnyElement {
    div()
        .id(element_id("work-group", id))
        .flex()
        .flex_col()
        .max_h(px(GROUP_MAX_HEIGHT))
        .overflow_y_scroll()
        .rounded(px(ROW_RADIUS))
        .pr(px(GROUP_SCROLLBAR_GUTTER))
        .children(
            entries
                .iter()
                .map(|entry| work_entry(client, entry, true, t)),
        )
        .into_any_element()
}

fn standalone_work(
    client: &Entity<CoreClient>,
    entries: &[WorkEntryView],
    t: &Tokens,
) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .py(px(ROW_PADDING))
        .gap(px(ENTRY_GAP))
        .children(
            entries
                .iter()
                .map(|entry| work_entry(client, entry, false, t)),
        )
        .into_any_element()
}

fn live_activity(id: &str, activity: &LiveActivityView, t: &Tokens) -> AnyElement {
    let icon_color = if activity.failed {
        failed_color(t)
    } else {
        t.icon_muted
    };
    let label = match activity.answer_preview.clone() {
        Some(answer) => div()
            .flex()
            .min_w_0()
            .flex_1()
            .gap(px(ROW_GAP))
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .child(SharedString::from(activity.label.clone())),
            )
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .text_color(t.foreground)
                    .child(SharedString::from(answer)),
            ),
        None => div()
            .min_w_0()
            .flex_1()
            .truncate()
            .child(SharedString::from(activity.label.clone())),
    };
    let content = div()
        .flex()
        .min_h(px(ROW_MIN_HEIGHT))
        .min_w_0()
        .items_center()
        .gap(px(ROW_GAP))
        .py(px(ROW_PADDING))
        .px(px(ROW_PADDING))
        .text_color(t.secondary_label)
        .child(work_icon(&activity.icon, icon_color, t))
        .child(label)
        .when(activity.show_trailing_failure_mark, |this| {
            this.child(failure_mark(t))
        });
    div()
        .relative()
        .flex()
        .min_h(px(ROW_MIN_HEIGHT))
        .max_w_full()
        .min_w_0()
        .overflow_hidden()
        .rounded(px(ROW_RADIUS))
        .text_size(px(BODY_TEXT))
        .line_height(px(BODY_LINE))
        .child(if activity.shimmer || activity.shine {
            activity_pulse(element_id("live-activity-pulse", id), content)
        } else {
            content.into_any_element()
        })
        .into_any_element()
}

fn live_button(
    id: &str,
    activity: &LiveActivityView,
    on_click: impl Fn(&mut App) + 'static,
    t: &Tokens,
) -> AnyElement {
    div()
        .id(element_id("live-activity", id))
        .flex()
        .min_h(px(ROW_MIN_HEIGHT))
        .w_full()
        .max_w_full()
        .items_center()
        .rounded(px(ROW_RADIUS))
        .cursor_pointer()
        .on_click(move |_, _, cx| on_click(cx))
        .child(live_activity(id, activity, t))
        .into_any_element()
}

fn reasoning_trace(
    client: &Entity<CoreClient>,
    trace: &ReasoningTraceView,
    t: &Tokens,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let ReasoningTraceView {
        id,
        message_id,
        show_header,
        expanded,
        streaming,
        header_text,
        documents,
    } = trace;
    let (show_header, expanded, streaming) = (*show_header, *expanded, *streaming);
    let hover = fade(t.accent, HOVER_ACCENT_OPACITY);
    let toggle = act(
        client,
        "toggleReasoning",
        json!({ "messageId": message_id }),
    );
    let header_label = div()
        .relative()
        .min_w_0()
        .flex_1()
        .truncate()
        .text_color(t.secondary_label)
        .child(SharedString::from(header_text.clone()));
    let bodies: Vec<AnyElement> = if expanded {
        documents
            .iter()
            .enumerate()
            .map(|(index, document)| {
                markdown_document(
                    &format!("{id}-trace-{index}"),
                    document,
                    t.foreground,
                    client,
                    t,
                    window,
                    cx,
                )
            })
            .collect()
    } else {
        Vec::new()
    };
    div()
        .flex()
        .flex_col()
        .when(show_header, |this| {
            this.child(
                div()
                    .id(element_id("reasoning-trace", id))
                    .flex()
                    .min_h(px(ROW_MIN_HEIGHT))
                    .cursor_pointer()
                    .items_center()
                    .gap(px(ROW_GAP))
                    .rounded(px(ROW_RADIUS))
                    .pl(px(ROW_PADDING))
                    .pr(px(TRACE_PADDING_END))
                    .text_size(px(BODY_TEXT))
                    .line_height(px(BODY_LINE))
                    .hover(move |s| s.bg(hover))
                    .on_click(move |_, _, cx| toggle(cx))
                    .child(work_icon(
                        &WorkIconView {
                            name: WorkIconName::Brain,
                            image_url: None,
                            image_url_dark: None,
                        },
                        t.icon_muted,
                        t,
                    ))
                    .child(if streaming {
                        activity_pulse(element_id("reasoning-trace-pulse", id), header_label)
                    } else {
                        header_label.into_any_element()
                    })
                    .child(chevron_box(expanded, true, t)),
            )
        })
        .when(expanded, |this| {
            this.child(
                div()
                    .id(element_id("reasoning-trace-body", id))
                    .ml(px(BODY_INDENT))
                    .flex()
                    .flex_col()
                    .max_h(px(TRACE_BODY_MAX_HEIGHT))
                    .overflow_y_scroll()
                    .gap(px(TRACE_BODY_GAP))
                    .px(px(ROW_PADDING))
                    .py(px(TRACE_BODY_PADDING_Y))
                    .children(bodies),
            )
        })
        .into_any_element()
}

pub(crate) struct WorkingTimerText {
    view: Entity<ViewState<Option<String>>>,
    prefix: String,
    fallback: String,
    _observe: Subscription,
}

impl WorkingTimerText {
    fn new(client: &Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view =
            CoreClient::subscribe::<Option<String>>(client, "timelineWorkingTimer", json!({}), cx);
        let observe = cx.observe(&view, |_, _, cx| cx.notify());
        Self {
            view,
            prefix: String::new(),
            fallback: String::new(),
            _observe: observe,
        }
    }
}

impl Render for WorkingTimerText {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let timer = self
            .view
            .read(cx)
            .data
            .clone()
            .flatten()
            .unwrap_or_else(|| self.fallback.clone());
        div()
            .whitespace_nowrap()
            .child(SharedString::from(format!("{}{timer}", self.prefix)))
    }
}

fn working_row(
    client: &Entity<CoreClient>,
    id: &str,
    working: &WorkingView,
    t: &Tokens,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let label: AnyElement = match (&working.timer_started_at, &working.timer_text) {
        (Some(_), Some(timer_text)) => {
            let timer = window.use_keyed_state(element_id("working-timer", id), cx, |_, cx| {
                WorkingTimerText::new(client, cx)
            });
            let prefix = working.label.clone();
            let fallback = timer_text.clone();
            timer.update(cx, |timer, _| {
                timer.prefix = prefix;
                timer.fallback = fallback;
            });
            timer.into_any_element()
        }
        _ if working.compacting => div()
            .flex()
            .items_center()
            .gap(px(ROW_GAP))
            .child(
                svg()
                    .path("icons/minimize-2.svg")
                    .flex_none()
                    .size(px(COMPACTION_ICON))
                    .text_color(t.muted_foreground),
            )
            .child(SharedString::from(working.label.clone()))
            .into_any_element(),
        _ => div()
            .child(SharedString::from(working.label.clone()))
            .into_any_element(),
    };
    let label_box = div()
        .relative()
        .flex_none()
        .overflow_hidden()
        .whitespace_nowrap()
        .child(label);
    div()
        .border_b_1()
        .border_color(fade(t.border, WORKING_BORDER_OPACITY))
        .pt(px(WORKING_PADDING_TOP))
        .pb(px(WORKING_PADDING_BOTTOM))
        .child(
            div()
                .flex()
                .h(px(ROW_MIN_HEIGHT))
                .min_w_0()
                .items_start()
                .gap(px(WORKING_GAP))
                .px(px(WORKING_PADDING_X))
                .text_size(px(BODY_TEXT))
                .line_height(px(BODY_LINE))
                .text_color(t.muted_foreground)
                .child(if working.shimmer {
                    activity_pulse(element_id("working-pulse", id), label_box)
                } else {
                    label_box.into_any_element()
                }),
        )
        .into_any_element()
}

fn context_compaction(label: &str, t: &Tokens) -> AnyElement {
    let rule = || {
        div()
            .h(px(1.))
            .flex_1()
            .bg(fade(t.border, COMPACTION_RULE_OPACITY))
    };
    div()
        .flex()
        .w_full()
        .items_center()
        .gap(px(COMPACTION_GAP))
        .py(px(COMPACTION_PADDING_Y))
        .text_size(px(META_TEXT))
        .line_height(px(META_LINE))
        .text_color(t.muted_foreground)
        .child(rule())
        .child(
            div()
                .flex()
                .flex_none()
                .items_center()
                .gap(px(ROW_GAP))
                .child(
                    svg()
                        .path("icons/minimize-2.svg")
                        .flex_none()
                        .size(px(COMPACTION_ICON))
                        .text_color(t.muted_foreground),
                )
                .child(SharedString::from(label.to_owned())),
        )
        .child(rule())
        .into_any_element()
}

pub(crate) fn work_row(
    client: &Entity<CoreClient>,
    row: &TimelineRowView,
    t: &Tokens,
    window: &mut Window,
    cx: &mut App,
) -> Option<AnyElement> {
    match row {
        TimelineRowView::WorkToggle(toggle) => {
            let group = SharedString::from(format!("work-toggle-{}", toggle.id));
            let hover = fade(t.accent, HOVER_ACCENT_OPACITY);
            let on_click = act(
                client,
                "toggleWorkGroup",
                json!({ "groupId": toggle.group_id }),
            );
            Some(
                div()
                    .id(element_id("work-toggle", &toggle.id))
                    .group(group.clone())
                    .relative()
                    .flex()
                    .min_h(px(ROW_MIN_HEIGHT))
                    .w_full()
                    .cursor_pointer()
                    .items_center()
                    .gap(px(ROW_GAP))
                    .rounded(px(ROW_RADIUS))
                    .p(px(ROW_PADDING))
                    .text_size(px(BODY_TEXT))
                    .line_height(px(BODY_LINE))
                    .hover(move |s| s.bg(hover))
                    .on_click(move |_, _, cx| on_click(cx))
                    .child(work_icon(&toggle.icon, t.icon_muted, t))
                    .child(
                        div()
                            .min_w_0()
                            .flex_1()
                            .truncate()
                            .text_color(t.secondary_label)
                            .child(SharedString::from(toggle.summary.clone())),
                    )
                    .child(hover_timestamp(&toggle.time_label, group, t))
                    .into_any_element(),
            )
        }
        TimelineRowView::Work(work) => Some(if work.entries.is_empty() {
            div().into_any_element()
        } else if work.expanded_group {
            work_group(client, &work.id, &work.entries, t)
        } else {
            standalone_work(client, &work.entries, t)
        }),
        TimelineRowView::WorkLive(live) => Some(live_button(
            &live.id,
            &live.activity,
            act(
                client,
                "toggleWorkGroup",
                json!({ "groupId": live.group_id }),
            ),
            t,
        )),
        TimelineRowView::ActivityGroup(group) => {
            let details: Vec<AnyElement> = group
                .details
                .iter()
                .map(|detail| match detail {
                    ActivityDetailView::Work { id, entries } => work_group(client, id, entries, t),
                    ActivityDetailView::Reasoning(trace) => {
                        reasoning_trace(client, trace, t, window, cx)
                    }
                })
                .collect();
            Some(
                div()
                    .flex()
                    .flex_col()
                    .child(live_button(
                        &group.id,
                        &group.activity,
                        act(
                            client,
                            "toggleWorkGroup",
                            json!({ "groupId": group.group_id }),
                        ),
                        t,
                    ))
                    .when(group.expanded, |this| {
                        this.child(div().mt(px(DETAILS_MARGIN_TOP)).children(details))
                    })
                    .into_any_element(),
            )
        }
        TimelineRowView::Working(row) => {
            Some(working_row(client, &row.id, &row.working, t, window, cx))
        }
        TimelineRowView::Thinking { id, visible } => Some(
            div()
                .min_h(px(THINKING_MIN_HEIGHT))
                .when(*visible, |this| {
                    this.child(live_activity(
                        id,
                        &LiveActivityView {
                            label: "Thinking".into(),
                            answer_preview: None,
                            icon: WorkIconView {
                                name: WorkIconName::Brain,
                                image_url: None,
                                image_url_dark: None,
                            },
                            failed: false,
                            show_trailing_failure_mark: false,
                            shine: false,
                            shimmer: true,
                        },
                        t,
                    ))
                })
                .into_any_element(),
        ),
        TimelineRowView::ContextCompaction { label, .. } => Some(context_compaction(label, t)),
        TimelineRowView::User { .. }
        | TimelineRowView::Assistant { .. }
        | TimelineRowView::AssistantMeta { .. }
        | TimelineRowView::Reasoning { .. }
        | TimelineRowView::TurnFold { .. }
        | TimelineRowView::ProposedPlan(_) => None,
    }
}

fn diff_stat_inline(stat: &DiffStatView, t: &Tokens) -> AnyElement {
    div()
        .flex()
        .flex_none()
        .items_center()
        .gap(px(CARD_STAT_GAP))
        .font_family(MONO_FONT)
        .child(
            div()
                .text_color(t.diff_addition)
                .child(SharedString::from(stat.additions_text.clone())),
        )
        .child(
            div()
                .text_color(t.diff_deletion)
                .child(SharedString::from(stat.deletions_text.clone())),
        )
        .into_any_element()
}

fn diff_stat_aligned(stat: &DiffStatView, t: &Tokens) -> AnyElement {
    let column = |text: &str, color: Rgba| {
        div()
            .flex()
            .flex_none()
            .justify_end()
            .w(px(TREE_STAT_COLUMN))
            .text_color(color)
            .child(SharedString::from(text.to_owned()))
    };
    div()
        .flex()
        .flex_none()
        .ml_auto()
        .gap(px(TREE_STAT_GAP))
        .font_family(MONO_FONT)
        .text_size(px(TREE_STAT_TEXT))
        .line_height(px(TREE_STAT_LINE))
        .child(column(&stat.additions_text, t.diff_addition))
        .child(column(&stat.deletions_text, t.diff_deletion))
        .into_any_element()
}

fn tree_row(key: &str, indent: f32, t: &Tokens) -> gpui::Stateful<gpui::Div> {
    let hover = fade(t.accent, TREE_HOVER_OPACITY);
    div()
        .id(element_id("changed-file", key))
        .group(SharedString::from(format!("changed-file-{key}")))
        .flex()
        .w_full()
        .items_center()
        .gap(px(TREE_ROW_GAP))
        .rounded(px(ROW_RADIUS))
        .py(px(TREE_ROW_PADDING_Y))
        .pr(px(TREE_ROW_PADDING_END))
        .pl(px(indent))
        .cursor_pointer()
        .hover(move |s| s.bg(hover))
}

fn changed_files_node(
    client: &Entity<CoreClient>,
    card: &ChangedFilesCardView,
    node: &ChangedFilesNodeView,
    t: &Tokens,
    cx: &App,
) -> AnyElement {
    match node {
        ChangedFilesNodeView::Directory {
            key,
            path,
            name,
            indent_px,
            expanded,
            icon,
            stat,
            children,
        } => {
            let group = SharedString::from(format!("changed-file-{key}"));
            let chevron_hover = fade(t.foreground, TREE_CHEVRON_HOVER_OPACITY);
            let name_hover = fade(t.foreground, TREE_DIRECTORY_OPACITY);
            let toggle = act(
                client,
                "toggleChangedFilesDirectory",
                json!({
                    "turnId": card.turn_id,
                    "path": path,
                    "expansionKey": card.expansion_key,
                    "allDirectoriesExpanded": card.all_directories_expanded,
                }),
            );
            div()
                .child(
                    tree_row(key, *indent_px, t)
                        .on_click(move |_, _, cx| toggle(cx))
                        .child(
                            chevron(
                                *expanded,
                                true,
                                fade(t.muted_foreground, TREE_CHEVRON_OPACITY),
                                TREE_ICON,
                            )
                            .group_hover(group.clone(), move |s| s.text_color(chevron_hover)),
                        )
                        .child(
                            svg()
                                .path(match icon {
                                    FolderIcon::FolderOpen => "icons/folder.svg",
                                    FolderIcon::FolderClosed => "icons/folder-closed.svg",
                                })
                                .flex_none()
                                .size(px(TREE_ICON))
                                .text_color(fade(t.muted_foreground, TREE_FOLDER_OPACITY)),
                        )
                        .child(
                            div()
                                .min_w_0()
                                .truncate()
                                .font_family(MONO_FONT)
                                .text_size(px(TREE_DIRECTORY_TEXT))
                                .line_height(px(META_LINE))
                                .text_color(fade(t.muted_foreground, TREE_DIRECTORY_OPACITY))
                                .group_hover(group, move |s| s.text_color(name_hover))
                                .child(SharedString::from(name.clone())),
                        )
                        .when_some(stat.as_ref(), |this, stat| {
                            this.child(diff_stat_aligned(stat, t))
                        }),
                )
                .when(*expanded, |this| {
                    this.children(
                        children
                            .iter()
                            .map(|child| changed_files_node(client, card, child, t, cx)),
                    )
                })
                .into_any_element()
        }
        ChangedFilesNodeView::File {
            key,
            path,
            name,
            indent_px,
            show_leading_spacer,
            icon,
            stat,
        } => {
            let group = SharedString::from(format!("changed-file-{key}"));
            let name_hover = t.foreground;
            let open = act(
                client,
                "openTurnDiff",
                json!({ "turnId": card.turn_id, "filePath": path }),
            );
            tree_row(key, *indent_px, t)
                .on_click(move |_, _, cx| open(cx))
                .when(*show_leading_spacer, |this| {
                    this.child(div().flex_none().size(px(TREE_ICON)))
                })
                .child(pierre_icon(icon, px(TREE_ICON), cx))
                .child(
                    div()
                        .flex()
                        .min_w_0()
                        .overflow_hidden()
                        .whitespace_nowrap()
                        .text_ellipsis_middle()
                        .font_family(MONO_FONT)
                        .text_size(px(META_TEXT))
                        .line_height(px(META_LINE))
                        .text_color(fade(t.foreground, TREE_FILE_OPACITY))
                        .group_hover(group, move |s| s.text_color(name_hover))
                        .child(SharedString::from(name.clone())),
                )
                .when_some(stat.as_ref(), |this, stat| {
                    this.child(diff_stat_aligned(stat, t))
                })
                .into_any_element()
        }
    }
}

pub(crate) fn changed_files_card(
    card: &ChangedFilesCardView,
    client: &Entity<CoreClient>,
    t: &Tokens,
    cx: &App,
) -> AnyElement {
    let surface = match t.appearance {
        Appearance::Dark => fade(t.input, CARD_SURFACE_OPACITY),
        Appearance::Light => t.secondary,
    };
    let toggle_all = act(
        client,
        "toggleChangedFilesAll",
        json!({ "turnId": card.turn_id }),
    );
    let open_diff = act(
        client,
        "openTurnDiff",
        json!({ "turnId": card.turn_id, "filePath": card.open_diff.file_path }),
    );
    div()
        .mt(px(CARD_MARGIN_TOP))
        .rounded(px(CARD_RADIUS))
        .bg(surface)
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap(px(CARD_HEADER_GAP))
                .px(px(CARD_HEADER_PADDING_X))
                .py(px(CARD_HEADER_PADDING_Y))
                .child(
                    div()
                        .flex()
                        .min_w_0()
                        .flex_wrap()
                        .items_center()
                        .gap_x(px(CARD_SUMMARY_GAP_X))
                        .gap_y(px(CARD_SUMMARY_GAP_Y))
                        .text_size(px(META_TEXT))
                        .line_height(px(META_LINE))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.foreground)
                        .child(SharedString::from(card.count_label.clone()))
                        .when_some(card.stat.as_ref(), |this, stat| {
                            this.child(diff_stat_inline(stat, t))
                        }),
                )
                .child(
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .gap(px(CARD_ACTIONS_GAP))
                        .when_some(card.toggle_all.as_ref(), |this, toggle| {
                            this.child(
                                div()
                                    .id(element_id("changed-files-toggle-all", &card.turn_id))
                                    .flex_none()
                                    .tooltip(Tooltip::text(toggle.tooltip.clone()))
                                    .child(
                                        Button::new(element_id(
                                            "changed-files-toggle-all-button",
                                            &card.turn_id,
                                        ))
                                        .variant(ButtonVariant::GhostMuted)
                                        .size(ButtonSize::IconXs)
                                        .icon(match toggle.icon {
                                            ToggleAllIcon::ChevronsDownUp => "chevrons-down-up",
                                            ToggleAllIcon::ChevronsUpDown => "chevrons-up-down",
                                        })
                                        .icon_size(CARD_ACTION_ICON)
                                        .accessibility_label(toggle.tooltip.clone())
                                        .on_click(move |_, _, cx| toggle_all(cx)),
                                    ),
                            )
                        })
                        .child(
                            div()
                                .id(element_id("changed-files-open-diff", &card.turn_id))
                                .flex_none()
                                .tooltip(Tooltip::text(card.open_diff.tooltip.clone()))
                                .child(
                                    Button::new(element_id(
                                        "changed-files-open-diff-button",
                                        &card.turn_id,
                                    ))
                                    .variant(ButtonVariant::GhostMuted)
                                    .size(ButtonSize::Xs)
                                    .icon("file-diff")
                                    .icon_size(CARD_ACTION_ICON)
                                    .label(card.open_diff.label.clone())
                                    .on_click(move |_, _, cx| open_diff(cx)),
                                ),
                        ),
                ),
        )
        .child(
            div().p(px(TREE_PADDING)).children(
                card.nodes
                    .iter()
                    .map(|node| changed_files_node(client, card, node, t, cx)),
            ),
        )
        .into_any_element()
}
