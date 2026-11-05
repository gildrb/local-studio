use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, Context, Div, FontWeight, InteractiveElement, IntoElement, ParentElement,
    SharedString, StatefulInteractiveElement, Styled, Window, div, px, relative, svg,
};
use serde_json::json;

use super::chart::UsageProviderChart;
use super::colors::css_color;
use super::page::UsagePage;
use super::{TEXT_2XS, TEXT_2XS_LINE, act, inline_button, provider_mark, text};
use crate::app_core::views::usage::{
    UsageBreakdownView, UsageCursorButtonView, UsageDataView, UsageSummaryRowView, UsageView,
};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::skeleton::{Skeleton, SkeletonShape};
use crate::ui::theme;
use crate::ui::theme::metrics::text as type_scale;
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::toggle::{Toggle, ToggleVariant};
use crate::ui::toggle_group::ToggleGroup;
use crate::ui::tooltip::Tooltip;

const LG: f32 = 1024.;
const MD: f32 = 768.;
const SUMMARY_WIDTH: f32 = 288.;
const SECTION_GAP: f32 = 24.;
const LEFT_GAP: f32 = 20.;
const HEADLINE_GAP: f32 = 4.;
const HEADLINE_TEXT: f32 = 36.;
const HEADLINE_LINE: f32 = 40.;
const INFO_ICON: f32 = 12.;
const ROW_GAP: f32 = 4.;
const ROW_SPLIT_GAP: f32 = 16.;
const ROW_LEFT_GAP: f32 = 8.;
const ROW_LABEL_GAP: f32 = 6.;
const DOT: f32 = 8.;
const MARK: f32 = 16.;
const SHARING_GAP: f32 = 8.;
const CHART_GAP: f32 = 12.;
const TOTALS_GAP: f32 = 8.;
const TOTALS_GAP_X: f32 = 24.;
const TOTALS_GAP_Y: f32 = 16.;
const TOTALS_PADDING_Y: f32 = 4.;
const METRIC_GAP: f32 = 2.;
const BREAKDOWN_GAP: f32 = 12.;
const CELL_PADDING_Y: f32 = 8.;
const TABLE_MARK: f32 = 14.;
const TABLE_MARK_GAP: f32 = 8.;
const EMPTY_PADDING_Y: f32 = 24.;
const SOURCE_MARGIN: f32 = 16.;
const STACK_GAP: f32 = 24.;

fn heading(t: &Tokens, label: impl Into<SharedString>) -> Div {
    text(type_scale::SM, type_scale::SM_LINE)
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.foreground)
        .child(label.into())
}

fn muted_xs(t: &Tokens) -> Div {
    text(type_scale::XS, type_scale::XS_LINE).text_color(t.muted_foreground)
}

fn fraction(width: &str) -> f32 {
    width
        .trim()
        .trim_end_matches('%')
        .parse::<f32>()
        .map_or(0.2, |value| value / 100.)
}

fn two_columns(width: f32) -> bool {
    width >= LG
}

fn totals_grid(width: f32, items: Vec<AnyElement>) -> Div {
    let columns = if width >= MD { 5 } else { 2 };
    let mut rows = Vec::new();
    let mut items = items.into_iter().peekable();
    while items.peek().is_some() {
        let mut row = div().flex().gap_x(px(TOTALS_GAP_X));
        for _ in 0..columns {
            row = row.child(div().flex_1().min_w_0().children(items.next()));
        }
        rows.push(row);
    }
    div()
        .flex()
        .flex_col()
        .gap_y(px(TOTALS_GAP_Y))
        .py(px(TOTALS_PADDING_Y))
        .children(rows)
}

pub(super) fn cursor_button(
    page: &UsagePage,
    view: &UsageView,
    button: &UsageCursorButtonView,
    t: &Tokens,
) -> AnyElement {
    let pending = view.cursor_pending.contains(&button.environment_id);
    let client = page.client.clone();
    let environment_id = button.environment_id.clone();
    let enable = move |cx: &mut gpui::App| {
        act(
            &client,
            cx,
            "usageEnableCursor",
            json!({ "environmentId": environment_id }),
        );
    };
    let id = SharedString::from(format!("usage-cursor-{}", button.environment_id));
    match &button.tooltip {
        Some(tooltip) => inline_button(
            id,
            button.text.clone(),
            t.foreground,
            pending,
            move |_, cx| enable(cx),
        )
        .tooltip(Tooltip::text(tooltip.clone()))
        .into_any_element(),
        None => Button::new(id)
            .variant(ButtonVariant::Outline)
            .size(ButtonSize::Sm)
            .label(button.text.clone())
            .disabled(pending)
            .accessibility_label(button.aria_label.clone())
            .on_click(move |_, _, cx| enable(cx))
            .into_any_element(),
    }
}

fn summary_left(t: &Tokens, color: &str, provider: &str, label: Div) -> Div {
    div()
        .flex()
        .min_w_0()
        .items_center()
        .gap(px(ROW_LEFT_GAP))
        .text_size(px(type_scale::SM))
        .line_height(px(type_scale::SM_LINE))
        .text_color(t.foreground)
        .child(
            div()
                .flex_none()
                .size(px(DOT))
                .rounded_full()
                .bg(css_color(color, t)),
        )
        .child(provider_mark(provider, t.foreground, MARK))
        .child(label)
}

impl UsagePage {
    fn summary_row(&self, view: &UsageView, row: &UsageSummaryRowView, t: &Tokens) -> AnyElement {
        match row {
            UsageSummaryRowView::Usage {
                provider,
                label,
                color,
                session_label,
                value_label,
                detail_label,
                ..
            } => div()
                .flex()
                .flex_col()
                .gap(px(ROW_GAP))
                .child(
                    div()
                        .flex()
                        .items_baseline()
                        .justify_between()
                        .gap(px(ROW_SPLIT_GAP))
                        .child(summary_left(
                            t,
                            color,
                            provider,
                            div()
                                .flex()
                                .min_w_0()
                                .items_baseline()
                                .gap(px(ROW_LABEL_GAP))
                                .child(div().min_w_0().truncate().child(label.clone()))
                                .child(
                                    text(TEXT_2XS, TEXT_2XS_LINE)
                                        .flex_none()
                                        .whitespace_nowrap()
                                        .text_color(t.muted_foreground)
                                        .font_features(theme::tabular())
                                        .child(session_label.clone()),
                                ),
                        ))
                        .child(
                            text(type_scale::SM, type_scale::SM_LINE)
                                .flex_none()
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.foreground)
                                .font_features(theme::tabular())
                                .child(value_label.clone()),
                        ),
                )
                .child(muted_xs(t).child(detail_label.clone()))
                .into_any_element(),
            UsageSummaryRowView::Enable {
                label,
                color,
                button,
                ..
            } => div()
                .flex()
                .min_w_0()
                .items_baseline()
                .justify_between()
                .gap(px(ROW_SPLIT_GAP))
                .text_size(px(type_scale::SM))
                .line_height(px(type_scale::SM_LINE))
                .child(summary_left(
                    t,
                    color,
                    "cursor",
                    div().min_w_0().truncate().child(label.clone()),
                ))
                .child(cursor_button(self, view, button, t))
                .into_any_element(),
        }
    }

    pub(super) fn usage_content(
        &mut self,
        view: &UsageView,
        data: &UsageDataView,
        width: f32,
        t: &Tokens,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> AnyElement {
        let headline = &data.headline;
        let sessions = muted_xs(t)
            .flex()
            .items_center()
            .child(headline.sessions_label.clone())
            .when_some(headline.estimate_note.clone(), |this, note| {
                this.child(note)
                    .when_some(headline.unpriced.clone(), |this, unpriced| {
                        this.child(" ").child(
                            div()
                                .id("usage-unpriced")
                                .flex()
                                .flex_none()
                                .cursor_pointer()
                                .tooltip(Tooltip::text(unpriced.message.clone()))
                                .child(
                                    svg()
                                        .path("icons/info.svg")
                                        .size(px(INFO_ICON))
                                        .text_color(t.muted_foreground),
                                ),
                        )
                    })
            });
        let sharing = data.chat_gpt_sharing.as_ref().map(|sharing| {
            let client = self.client.clone();
            let url = view.chat_gpt_button.url.clone();
            muted_xs(t)
                .flex()
                .items_center()
                .justify_between()
                .gap(px(SHARING_GAP))
                .child(sharing.label.clone())
                .child(
                    Button::new("usage-chatgpt-manage")
                        .variant(ButtonVariant::GhostMuted)
                        .size(ButtonSize::Xs)
                        .label(view.chat_gpt_button.label.clone())
                        .icon_end("external-link")
                        .icon_size(14.)
                        .on_click(move |_, _, cx| {
                            act(&client, cx, "usageOpenExternal", json!({ "url": url }));
                        }),
                )
        });
        let left = div()
            .flex()
            .flex_col()
            .min_w_0()
            .gap(px(LEFT_GAP))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(HEADLINE_GAP))
                    .child(
                        text(HEADLINE_TEXT, HEADLINE_LINE)
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(t.foreground)
                            .font_features(theme::tabular())
                            .child(headline.value.clone()),
                    )
                    .child(sessions),
            )
            .children(sharing)
            .children(
                data.summary_rows
                    .iter()
                    .map(|row| self.summary_row(view, row, t)),
            );
        let chart = div()
            .flex()
            .flex_col()
            .min_w_0()
            .gap(px(CHART_GAP))
            .child(heading(t, data.chart_title.clone()))
            .child(UsageProviderChart::new(
                "usage-provider-chart",
                data.chart.clone(),
            ));
        let section = if two_columns(width) {
            div()
                .flex()
                .gap(px(SECTION_GAP))
                .child(left.flex_none().w(px(SUMMARY_WIDTH)))
                .child(chart.flex_1())
        } else {
            div()
                .flex()
                .flex_col()
                .gap(px(SECTION_GAP))
                .child(left)
                .child(chart)
        };
        let totals = div()
            .flex()
            .flex_col()
            .gap(px(TOTALS_GAP))
            .child(heading(t, data.totals_title.clone()))
            .child(totals_grid(
                width,
                data.totals
                    .iter()
                    .map(|metric| {
                        div()
                            .flex()
                            .flex_col()
                            .min_w_0()
                            .gap(px(METRIC_GAP))
                            .child(muted_xs(t).child(metric.label.clone()))
                            .child(
                                text(type_scale::BASE, type_scale::BASE_LINE)
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(t.foreground)
                                    .font_features(theme::tabular())
                                    .child(metric.value.clone()),
                            )
                            .into_any_element()
                    })
                    .collect(),
            ));
        div()
            .flex()
            .flex_col()
            .gap(px(STACK_GAP))
            .children(data.source_messages.iter().map(|message| {
                text(type_scale::SM, type_scale::SM_LINE)
                    .mb(px(SOURCE_MARGIN))
                    .text_color(t.muted_foreground)
                    .child(message.clone())
            }))
            .child(section)
            .child(totals)
            .child(self.breakdown(&data.breakdown, t))
            .into_any_element()
    }

    fn breakdown(&self, breakdown: &UsageBreakdownView, t: &Tokens) -> AnyElement {
        let client = self.client.clone();
        let toggles = ToggleGroup::new("usage-breakdown")
            .variant(ToggleVariant::Segmented)
            .items(breakdown.options.iter().map(|option| {
                let client = client.clone();
                let value = option.value.clone();
                Toggle::new(SharedString::from(format!(
                    "usage-breakdown-{}",
                    option.value
                )))
                .label(option.label.clone())
                .pressed(option.value == breakdown.selected)
                .on_change(move |_, _, _, cx| {
                    act(
                        &client,
                        cx,
                        "usageSelectBreakdown",
                        json!({ "breakdown": value.clone() }),
                    );
                })
            }));
        let header_cell = |label: String, share: f32, right: bool| {
            text(type_scale::XS, type_scale::XS_LINE)
                .flex_none()
                .w(relative(share))
                .py(px(CELL_PADDING_Y))
                .text_color(t.muted_foreground)
                .when(right, |this| this.flex().justify_end())
                .child(label)
        };
        let cell = |content: AnyElement, share: f32, right: bool, color| {
            div()
                .flex()
                .flex_none()
                .min_w_0()
                .items_center()
                .w(relative(share))
                .py(px(CELL_PADDING_Y))
                .text_color(color)
                .font_features(theme::tabular())
                .when(right, |this| this.justify_end())
                .child(content)
        };
        let body_row = |id: SharedString| {
            div()
                .id(id)
                .flex()
                .w_full()
                .border_b_1()
                .border_color(fade(t.border, 0.5))
                .hover(|style| style.bg(fade(t.muted, 0.5)))
        };
        let empty = || {
            div()
                .flex()
                .w_full()
                .justify_center()
                .py(px(EMPTY_PADDING_Y))
                .text_color(t.muted_foreground)
                .child(breakdown.empty_message.clone())
        };
        let table = if breakdown.selected == "model" {
            let shares = [0.4, 0.2, 0.2, 0.2];
            let rows: Vec<AnyElement> = if breakdown.model.rows.is_empty() {
                vec![empty().into_any_element()]
            } else {
                breakdown
                    .model
                    .rows
                    .iter()
                    .map(|row| {
                        body_row(SharedString::from(format!("usage-model-{}", row.key)))
                            .child(cell(
                                div()
                                    .flex()
                                    .min_w_0()
                                    .items_center()
                                    .gap(px(TABLE_MARK_GAP))
                                    .child(provider_mark(&row.provider, t.foreground, TABLE_MARK))
                                    .child(div().min_w_0().truncate().child(row.model.clone()))
                                    .into_any_element(),
                                shares[0],
                                false,
                                t.foreground,
                            ))
                            .child(cell(
                                row.cost_label.clone().into_any_element(),
                                shares[1],
                                true,
                                if row.cost_unknown {
                                    t.muted_foreground
                                } else {
                                    t.foreground
                                },
                            ))
                            .child(cell(
                                row.share_label.clone().into_any_element(),
                                shares[2],
                                true,
                                t.muted_foreground,
                            ))
                            .child(cell(
                                row.tokens_label.clone().into_any_element(),
                                shares[3],
                                true,
                                t.muted_foreground,
                            ))
                            .into_any_element()
                    })
                    .collect()
            };
            div()
                .flex()
                .flex_col()
                .w_full()
                .child(
                    div()
                        .flex()
                        .w_full()
                        .border_b_1()
                        .border_color(t.border)
                        .children(breakdown.model.headings.iter().enumerate().map(
                            |(index, heading)| {
                                header_cell(heading.clone(), shares[index.min(3)], index > 0)
                            },
                        )),
                )
                .children(rows)
        } else {
            let time = &breakdown.time;
            let value_share = fraction(&time.value_column_width);
            let rows: Vec<AnyElement> = if time.rows.is_empty() {
                vec![empty().into_any_element()]
            } else {
                time.rows
                    .iter()
                    .map(|row| {
                        body_row(SharedString::from(format!("usage-period-{}", row.key)))
                            .child(cell(
                                row.period_label.clone().into_any_element(),
                                0.4,
                                false,
                                t.foreground,
                            ))
                            .children(row.provider_costs.iter().map(|cost| {
                                cell(
                                    cost.label.clone().into_any_element(),
                                    value_share,
                                    true,
                                    t.muted_foreground,
                                )
                            }))
                            .child(cell(
                                row.total_label.clone().into_any_element(),
                                value_share,
                                true,
                                t.foreground,
                            ))
                            .child(cell(
                                row.tokens_label.clone().into_any_element(),
                                value_share,
                                true,
                                t.muted_foreground,
                            ))
                            .into_any_element()
                    })
                    .collect()
            };
            div()
                .flex()
                .flex_col()
                .w_full()
                .child(
                    div()
                        .flex()
                        .w_full()
                        .border_b_1()
                        .border_color(t.border)
                        .child(header_cell(time.period_heading.clone(), 0.4, false))
                        .children(
                            time.provider_columns
                                .iter()
                                .map(|column| header_cell(column.label.clone(), value_share, true)),
                        )
                        .child(header_cell(time.total_heading.clone(), value_share, true))
                        .child(header_cell(time.tokens_heading.clone(), value_share, true)),
                )
                .children(rows)
        };
        div()
            .flex()
            .flex_col()
            .gap(px(BREAKDOWN_GAP))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(BREAKDOWN_GAP))
                    .child(heading(t, breakdown.title.clone()))
                    .child(toggles),
            )
            .child(
                table
                    .text_size(px(type_scale::SM))
                    .line_height(px(type_scale::SM_LINE)),
            )
            .into_any_element()
    }
}

pub(super) fn skeleton(
    providers: &[String],
    totals_title: &str,
    total_labels: &[String],
    breakdown_title: &str,
    width: f32,
    t: &Tokens,
) -> AnyElement {
    let bar = |id: String, w: Option<f32>, h: f32| {
        Skeleton::new(SharedString::from(id))
            .h(px(h))
            .when_some(w, |this, w| this.w(px(w)))
    };
    let pill = |id: String, size: f32| {
        Skeleton::new(SharedString::from(id))
            .shape(SkeletonShape::Pill)
            .flex_none()
            .size(px(size))
    };
    let left = div()
        .flex()
        .flex_col()
        .gap(px(LEFT_GAP))
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(HEADLINE_GAP))
                .child(bar("usage-skeleton-headline".into(), Some(144.), 40.))
                .child(bar("usage-skeleton-sessions".into(), Some(128.), 16.)),
        )
        .children(providers.iter().map(|provider| {
            div()
                .flex()
                .flex_col()
                .gap(px(ROW_GAP))
                .child(
                    div()
                        .flex()
                        .min_h(px(20.))
                        .items_center()
                        .justify_between()
                        .gap(px(ROW_SPLIT_GAP))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(ROW_LEFT_GAP))
                                .child(pill(format!("usage-skeleton-dot-{provider}"), DOT))
                                .child(pill(format!("usage-skeleton-mark-{provider}"), MARK))
                                .child(bar(
                                    format!("usage-skeleton-label-{provider}"),
                                    Some(80.),
                                    14.,
                                )),
                        )
                        .child(bar(
                            format!("usage-skeleton-value-{provider}"),
                            Some(56.),
                            14.,
                        )),
                )
                .child(bar(
                    format!("usage-skeleton-detail-{provider}"),
                    Some(144.),
                    16.,
                ))
        }));
    let chart = div()
        .flex()
        .flex_col()
        .gap(px(CHART_GAP))
        .child(bar("usage-skeleton-chart-title".into(), Some(96.), 20.))
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(4.))
                .child(
                    div()
                        .pl(px(64.))
                        .child(bar("usage-skeleton-plot".into(), None, 224.)),
                )
                .child(
                    div()
                        .pl(px(64.))
                        .child(bar("usage-skeleton-axis".into(), None, 16.)),
                ),
        );
    let section = if two_columns(width) {
        div()
            .flex()
            .gap(px(SECTION_GAP))
            .child(left.flex_none().w(px(SUMMARY_WIDTH)))
            .child(chart.flex_1().min_w_0())
    } else {
        div()
            .flex()
            .flex_col()
            .gap(px(SECTION_GAP))
            .child(left)
            .child(chart)
    };
    div()
        .flex()
        .flex_col()
        .gap(px(STACK_GAP))
        .child(section)
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(TOTALS_GAP))
                .child(heading(t, totals_title.to_string()))
                .child(totals_grid(
                    width,
                    total_labels
                        .iter()
                        .map(|label| {
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(METRIC_GAP))
                                .child(muted_xs(t).child(label.clone()))
                                .child(bar(format!("usage-skeleton-total-{label}"), Some(64.), 24.))
                                .into_any_element()
                        })
                        .collect(),
                )),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(BREAKDOWN_GAP))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap(px(BREAKDOWN_GAP))
                        .child(heading(t, breakdown_title.to_string()))
                        .child(
                            Skeleton::new("usage-skeleton-toggle")
                                .shape(SkeletonShape::Card)
                                .h(px(28.))
                                .w(px(112.)),
                        ),
                )
                .child(bar("usage-skeleton-table".into(), None, 176.)),
        )
        .into_any_element()
}
