use std::time::Duration;

use gpui::prelude::FluentBuilder;
use gpui::{
    Animation, AnimationExt, AnyElement, App, Context, Div, ElementId, Entity, FontWeight,
    InteractiveElement, IntoElement, ParentElement, Render, Rgba, SharedString,
    StatefulInteractiveElement, Styled, Transformation, Window, div, percentage, px, relative,
    rgba, svg,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::settings_diagnostics::{
    DiagnosticsExpandableCellView, DiagnosticsLastCheckedView, DiagnosticsMessageView,
    DiagnosticsProcessRowView, DiagnosticsRefreshButtonView, DiagnosticsResourceRowView,
    DiagnosticsStatView, DiagnosticsWindowSelectorView, ProcessSignalActionsView,
    ResourceAggregateCardView, ResourceBadgeView, ResourceColumnView, ResourceDetailRowView,
    ResourceLastSampleView, ResourceLiveProcessRowView, ResourceStatView,
    SettingsDiagnosticsClockView, SettingsDiagnosticsView, TraceIdCellView,
};
use crate::features::settings::primitives::{SettingsSection, settings_stack};
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::theme;
use crate::ui::theme::color::over;
use crate::ui::theme::metrics::text;
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::toggle::Toggle;
use crate::ui::toggle_group::ToggleGroup;
use crate::ui::tooltip::{Tooltip, TooltipVariant};

const TEXT_2XS: f32 = 11.;
const TEXT_2XS_LINE: f32 = 16.;
const TEXT_3XS: f32 = 10.;
const TEXT_3XS_LINE: f32 = 14.;
const CELL_X: f32 = 16.;
const CELL_X_TIGHT: f32 = 12.;
const EDGE_X: f32 = 20.;
const SECTION_ICON: f32 = 16.;
const SPIN: Duration = Duration::from_millis(1000);
const VIOLET: u32 = 0x8b5cf6ff;
const PROCESS_TABLE_MAX_HEIGHT: f32 = 704.;
const TELEMETRY_TABLE_MAX_HEIGHT: f32 = 768.;
const HISTORY_TABLE_MAX_HEIGHT: f32 = 448.;
const LINE_CLAMP_LINE: f32 = 16.;

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

fn tone_color(tone: &str, t: &Tokens) -> Option<Rgba> {
    match tone {
        "warning" => Some(t.warning_foreground),
        "danger" => Some(t.destructive),
        _ => None,
    }
}

fn spin_icon(
    id: impl Into<ElementId>,
    name: &str,
    size: f32,
    color: Rgba,
    spin: bool,
) -> AnyElement {
    let icon = svg()
        .path(SharedString::from(format!("icons/{name}.svg")))
        .flex_none()
        .size(px(size))
        .text_color(color);
    if spin {
        icon.with_animation(id, Animation::new(SPIN).repeat(), |icon, delta| {
            icon.with_transformation(Transformation::rotate(percentage(delta)))
        })
        .into_any_element()
    } else {
        icon.into_any_element()
    }
}

fn uppercase_label(label: &str, size: f32, line: f32, color: Rgba) -> Div {
    div()
        .text_size(px(size))
        .line_height(px(line))
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(color)
        .child(label.to_uppercase())
}

fn mono(value: impl Into<SharedString>) -> Div {
    div()
        .font_family(MONO_FONT)
        .font_features(theme::tabular())
        .child(value.into())
}

fn code_tooltip(id: impl Into<ElementId>, child: Div, tooltip: &str) -> AnyElement {
    let tooltip = SharedString::from(tooltip.to_string());
    div()
        .id(id.into())
        .min_w_0()
        .overflow_hidden()
        .tooltip(Tooltip::builder(tooltip, TooltipVariant::Code))
        .child(child)
        .into_any_element()
}

fn inline_action(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    color: Rgba,
    hover: Rgba,
    disabled: bool,
    on_click: impl Fn(&mut Window, &mut App) + 'static,
) -> AnyElement {
    div()
        .id(id.into())
        .flex_none()
        .font_weight(FontWeight::MEDIUM)
        .text_color(color)
        .whitespace_nowrap()
        .when(disabled, |this| this.opacity(0.64))
        .when(!disabled, move |this| {
            this.cursor_pointer()
                .hover(move |style| style.text_color(hover).underline())
                .on_click(move |_, window, cx| on_click(window, cx))
        })
        .child(label.into())
        .into_any_element()
}

struct Column {
    frac: f32,
    right: bool,
    left_pad: f32,
    right_pad: f32,
}

const fn col(frac: f32, right: bool, left_pad: f32, right_pad: f32) -> Column {
    Column {
        frac,
        right,
        left_pad,
        right_pad,
    }
}

fn cell(column: &Column, py: f32, child: impl IntoElement) -> Div {
    div()
        .flex()
        .flex_none()
        .min_w_0()
        .overflow_hidden()
        .w(relative(column.frac))
        .pl(px(column.left_pad))
        .pr(px(column.right_pad))
        .py(px(py))
        .when(column.right, |cell| cell.justify_end())
        .child(child)
}

fn header_row(
    columns: &[Column],
    labels: &[String],
    py: f32,
    size: f32,
    line: f32,
    t: &Tokens,
) -> Div {
    div()
        .flex()
        .w_full()
        .border_b_1()
        .border_color(fade(t.border, 0.6))
        .bg(t.card)
        .children(columns.iter().zip(labels.iter()).map(|(column, label)| {
            cell(
                column,
                py,
                uppercase_label(label, size, line, fade(t.muted_foreground, 0.7))
                    .whitespace_nowrap(),
            )
        }))
}

fn table_frame(
    id: impl Into<ElementId>,
    min_width: f32,
    max_height: Option<f32>,
    header: Div,
    rows: Vec<AnyElement>,
    t: &Tokens,
) -> AnyElement {
    let id: ElementId = id.into();
    let divider = fade(t.border, 0.5);
    let count = rows.len();
    let body = div()
        .flex()
        .flex_col()
        .w_full()
        .children(rows.into_iter().enumerate().map(move |(index, row)| {
            div()
                .w_full()
                .when(index + 1 < count, |row| {
                    row.border_b_1().border_color(divider)
                })
                .child(row)
        }));
    let body = match max_height {
        Some(max) => div()
            .id(ElementId::Name(SharedString::from(format!("{id}-body"))))
            .max_h(px(max))
            .overflow_y_scroll()
            .child(body)
            .into_any_element(),
        None => body.into_any_element(),
    };
    div()
        .id(id)
        .w_full()
        .overflow_x_scroll()
        .child(
            div()
                .flex()
                .flex_col()
                .w_full()
                .min_w(px(min_width))
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .child(header)
                .child(body),
        )
        .into_any_element()
}

fn hover_row(id: impl Into<ElementId>, t: &Tokens, opacity: f32) -> gpui::Stateful<Div> {
    let hover = fade(t.muted, opacity);
    div()
        .id(id.into())
        .flex()
        .w_full()
        .items_center()
        .hover(move |style| style.bg(hover))
}

struct IconButtonSpec<'a> {
    id: &'a str,
    label: &'a str,
    tooltip: Option<&'a str>,
    disabled: bool,
    size: ButtonSize,
    variant: ButtonVariant,
}

type RowToggle = (String, bool, Box<dyn Fn(&mut App)>);

struct NameCell<'a> {
    id: &'a str,
    indent: f32,
    toggle: Option<RowToggle>,
    dot: Rgba,
    name: &'a str,
    command: &'a str,
}

pub struct DiagnosticsSection {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<SettingsDiagnosticsView>>>,
    clock: Entity<ViewState<Option<SettingsDiagnosticsClockView>>>,
}

impl DiagnosticsSection {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<SettingsDiagnosticsView>>(
            &client,
            "settingsDiagnostics",
            json!({}),
            cx,
        );
        cx.observe(&view, |_, _, cx| cx.notify()).detach();
        let clock = CoreClient::subscribe::<Option<SettingsDiagnosticsClockView>>(
            &client,
            "settingsDiagnosticsClock",
            json!({}),
            cx,
        );
        cx.observe(&clock, |_, _, cx| cx.notify()).detach();
        act(&client, cx, "settingsDiagnosticsMount", json!({}));
        Self {
            client,
            view,
            clock,
        }
    }

    fn icon_button(
        &self,
        spec: IconButtonSpec<'_>,
        icon: AnyElement,
        on_click: impl Fn(&mut Window, &mut App) + 'static,
    ) -> AnyElement {
        let IconButtonSpec {
            id,
            label,
            tooltip,
            disabled,
            size,
            variant,
        } = spec;
        let button = Button::new(SharedString::from(format!("{id}-button")))
            .size(size)
            .variant(variant)
            .disabled(disabled)
            .accessibility_label(label.to_string())
            .on_click(move |_, window, cx| on_click(window, cx))
            .child(icon);
        match tooltip {
            Some(tooltip) => div()
                .id(SharedString::from(id.to_string()))
                .tooltip(Tooltip::text(tooltip.to_string()))
                .child(button)
                .into_any_element(),
            None => button.into_any_element(),
        }
    }

    fn refresh_button(&self, button: &DiagnosticsRefreshButtonView, t: &Tokens) -> AnyElement {
        let client = self.client.clone();
        let target = button.target.clone();
        self.icon_button(
            IconButtonSpec {
                id: &format!("diagnostics-refresh-{}", button.target),
                label: &button.label,
                tooltip: Some(&button.label),
                disabled: button.disabled,
                size: ButtonSize::IconXs,
                variant: ButtonVariant::GhostMuted,
            },
            spin_icon(
                SharedString::from(format!("diagnostics-refresh-spin-{}", button.target)),
                "refresh-cw",
                14.,
                t.muted_foreground,
                button.is_pending,
            ),
            move |_, cx| {
                act(
                    &client,
                    cx,
                    "settingsDiagnosticsRefresh",
                    json!({ "target": target }),
                );
            },
        )
    }

    fn last_checked(model: Option<&DiagnosticsLastCheckedView>, t: &Tokens) -> AnyElement {
        let base = div()
            .flex()
            .items_baseline()
            .gap(px(4.))
            .text_size(px(TEXT_2XS))
            .line_height(px(TEXT_2XS_LINE))
            .whitespace_nowrap();
        match model {
            None => base.into_any_element(),
            Some(DiagnosticsLastCheckedView::Missing { label })
            | Some(DiagnosticsLastCheckedView::Invalid { label }) => base
                .text_color(fade(t.muted_foreground, 0.5))
                .child(label.clone())
                .into_any_element(),
            Some(DiagnosticsLastCheckedView::Relative {
                label,
                value,
                suffix,
            }) => {
                let base = base
                    .text_color(fade(t.muted_foreground, 0.6))
                    .child(label.clone());
                match suffix {
                    Some(suffix) => base.child(mono(value.clone())).child(suffix.clone()),
                    None => base.child(value.clone()),
                }
                .into_any_element()
            }
        }
    }

    fn window_selector(
        &self,
        id: &str,
        selector: &DiagnosticsWindowSelectorView,
        action: &'static str,
    ) -> AnyElement {
        let mut group = ToggleGroup::new(SharedString::from(id.to_string()));
        for option in &selector.options {
            let client = self.client.clone();
            let value = option.value.clone();
            group = group.item(
                Toggle::new(SharedString::from(format!("{id}-{}", option.value)))
                    .label(option.label.clone())
                    .pressed(option.value == selector.value)
                    .on_change(move |_, _, _, cx| {
                        act(&client, cx, action, json!({ "value": value }));
                    }),
            );
        }
        div()
            .id(SharedString::from(format!("{id}-wrap")))
            .flex_none()
            .child(group)
            .into_any_element()
    }

    fn stat_block(stat: &DiagnosticsStatView, t: &Tokens) -> AnyElement {
        let value_color = tone_color(&stat.tone, t).unwrap_or(t.foreground);
        div()
            .min_w_0()
            .px(px(EDGE_X))
            .py(px(12.))
            .child(
                div()
                    .flex()
                    .min_w_0()
                    .items_center()
                    .gap(px(6.))
                    .child(
                        div().min_w_0().truncate().child(
                            uppercase_label(
                                &stat.label,
                                TEXT_2XS,
                                TEXT_2XS_LINE,
                                fade(t.muted_foreground, 0.7),
                            )
                            .font_weight(FontWeight::MEDIUM),
                        ),
                    )
                    .when_some(stat.tooltip.clone(), |row, tooltip| {
                        row.child(
                            div()
                                .id(SharedString::from(format!(
                                    "diagnostics-stat-info-{}",
                                    stat.id
                                )))
                                .flex()
                                .flex_none()
                                .size(px(14.))
                                .items_center()
                                .justify_center()
                                .cursor_pointer()
                                .tooltip(Tooltip::text(tooltip))
                                .child(
                                    svg()
                                        .path("icons/info.svg")
                                        .size(px(12.))
                                        .text_color(fade(t.muted_foreground, 0.6)),
                                ),
                        )
                    }),
            )
            .child(
                mono(stat.value.clone())
                    .mt(px(4.))
                    .truncate()
                    .text_size(px(text::LG))
                    .line_height(px(text::LG_LINE))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(value_color),
            )
            .into_any_element()
    }

    fn stats_grid(stats: &[DiagnosticsStatView], t: &Tokens) -> AnyElement {
        let divider = fade(t.border, 0.6);
        let count = stats.len();
        div()
            .flex()
            .w_full()
            .children(stats.iter().enumerate().map(|(index, stat)| {
                div()
                    .flex_1()
                    .min_w_0()
                    .when(index + 1 < count, |cell| {
                        cell.border_r_1().border_color(divider)
                    })
                    .child(Self::stat_block(stat, t))
            }))
            .into_any_element()
    }

    fn messages(messages: &[DiagnosticsMessageView], t: &Tokens) -> Option<AnyElement> {
        if messages.is_empty() {
            return None;
        }
        Some(
            div()
                .flex()
                .flex_col()
                .gap(px(8.))
                .border_t_1()
                .border_color(fade(t.border, 0.6))
                .px(px(EDGE_X))
                .py(px(12.))
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .children(messages.iter().map(|message| {
                    let color = if message.tone == "warning" {
                        t.warning_foreground
                    } else {
                        t.destructive
                    };
                    div()
                        .flex()
                        .items_start()
                        .gap(px(8.))
                        .text_color(color)
                        .child(
                            svg()
                                .path("icons/triangle-alert.svg")
                                .flex_none()
                                .mt(px(2.))
                                .size(px(14.))
                                .text_color(color),
                        )
                        .child(div().min_w_0().child(message.message.clone()))
                }))
                .into_any_element(),
        )
    }

    fn empty_rows(label: &str, t: &Tokens) -> AnyElement {
        div()
            .px(px(EDGE_X))
            .py(px(16.))
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .text_color(t.muted_foreground)
            .child(label.to_string())
            .into_any_element()
    }

    fn signal_actions(
        &self,
        id: &str,
        actions: &ProcessSignalActionsView,
        t: &Tokens,
        on_signal: impl Fn(&str, &mut App) + Clone + 'static,
    ) -> AnyElement {
        div()
            .flex()
            .items_center()
            .justify_end()
            .gap(px(6.))
            .children(actions.actions.iter().map(|action| {
                let (color, hover) = if action.tone == "destructive" {
                    (fade(t.destructive, 0.8), t.destructive)
                } else {
                    (t.muted_foreground, t.foreground)
                };
                let signal = action.signal.clone();
                let on_signal = on_signal.clone();
                div()
                    .id(SharedString::from(format!("{id}-{}-tip", action.signal)))
                    .tooltip(Tooltip::text(action.tooltip.clone()))
                    .child(inline_action(
                        SharedString::from(format!("{id}-{}", action.signal)),
                        action.label.clone(),
                        color,
                        hover,
                        action.disabled,
                        move |_, cx| on_signal(&signal, cx),
                    ))
            }))
            .into_any_element()
    }

    fn name_cell(&self, spec: NameCell<'_>, t: &Tokens) -> AnyElement {
        let NameCell {
            id,
            indent,
            toggle,
            dot,
            name,
            command,
        } = spec;
        let toggle = match toggle {
            Some((label, expanded, on_toggle)) => {
                Button::new(SharedString::from(format!("{id}-toggle")))
                    .size(ButtonSize::IconMicro)
                    .variant(ButtonVariant::GhostMuted)
                    .icon(if expanded {
                        "chevron-down"
                    } else {
                        "chevron-right"
                    })
                    .icon_size(14.)
                    .accessibility_label(label)
                    .on_click(move |_, _, cx| on_toggle(cx))
                    .into_any_element()
            }
            None => div().flex_none().size(px(20.)).into_any_element(),
        };
        div()
            .flex()
            .min_w_0()
            .w_full()
            .items_center()
            .gap(px(8.))
            .pl(px(indent))
            .child(
                div()
                    .flex()
                    .flex_none()
                    .w(px(20.))
                    .justify_center()
                    .child(toggle),
            )
            .child(div().flex_none().size(px(6.)).rounded_full().bg(dot))
            .child(code_tooltip(
                SharedString::from(format!("{id}-name")),
                div()
                    .truncate()
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.foreground)
                    .child(name.to_string()),
                command,
            ))
            .into_any_element()
    }

    fn process_row(&self, row: &DiagnosticsProcessRowView, t: &Tokens) -> AnyElement {
        let columns = process_columns();
        let id = format!("diag-proc-{}", row.id);
        let pid = row.pid;
        let toggle = row.toggle.as_ref().map(|toggle| {
            let client = self.client.clone();
            let handler: Box<dyn Fn(&mut App)> = Box::new(move |cx| {
                act(
                    &client,
                    cx,
                    "settingsDiagnosticsToggleProcess",
                    json!({ "pid": pid }),
                );
            });
            (
                toggle.aria_label.clone(),
                toggle.icon == "chevron-down",
                handler,
            )
        });
        let signal_client = self.client.clone();
        hover_row(SharedString::from(id.clone()), t, 0.2)
            .child(cell(
                &columns[0],
                8.,
                self.name_cell(
                    NameCell {
                        id: &id,
                        indent: row.indent_level * 10.,
                        toggle,
                        dot: fade(t.success, 0.8),
                        name: &row.name,
                        command: &row.command,
                    },
                    t,
                ),
            ))
            .child(cell(&columns[1], 8., mono(row.cpu.clone())))
            .child(cell(&columns[2], 8., mono(row.memory.clone())))
            .child(cell(
                &columns[3],
                8.,
                code_tooltip(
                    SharedString::from(format!("{id}-cmd")),
                    div()
                        .truncate()
                        .text_color(t.muted_foreground)
                        .child(row.command.clone()),
                    &row.command,
                ),
            ))
            .child(cell(
                &columns[4],
                8.,
                mono(row.pid_label.clone()).text_color(t.muted_foreground),
            ))
            .child(cell(
                &columns[5],
                8.,
                div()
                    .truncate()
                    .text_color(t.muted_foreground)
                    .child(row.kind.clone()),
            ))
            .child(cell(
                &columns[6],
                8.,
                self.signal_actions(&id, &row.signal_actions, t, move |signal, cx| {
                    act(
                        &signal_client,
                        cx,
                        "settingsDiagnosticsSignal",
                        json!({ "pid": pid, "signal": signal }),
                    );
                }),
            ))
            .into_any_element()
    }

    fn resource_row(&self, row: &DiagnosticsResourceRowView, t: &Tokens) -> AnyElement {
        let columns = resource_columns();
        let id = format!("diag-res-{}", row.id);
        let dot = if row.status_tone == "warning" {
            fade(t.warning, 0.9)
        } else {
            fade(t.success, 0.8)
        };
        hover_row(SharedString::from(id.clone()), t, 0.2)
            .child(cell(
                &columns[0],
                8.,
                self.name_cell(
                    NameCell {
                        id: &id,
                        indent: row.indent_level * 10.,
                        toggle: None,
                        dot,
                        name: &row.name,
                        command: &row.command,
                    },
                    t,
                ),
            ))
            .child(cell(&columns[1], 8., mono(row.cpu_time.clone())))
            .child(cell(&columns[2], 8., mono(row.current_cpu.clone())))
            .child(cell(&columns[3], 8., mono(row.average_cpu.clone())))
            .child(cell(&columns[4], 8., mono(row.peak_cpu.clone())))
            .child(cell(&columns[5], 8., mono(row.max_memory.clone())))
            .child(cell(
                &columns[6],
                8.,
                code_tooltip(
                    SharedString::from(format!("{id}-cmd")),
                    div()
                        .truncate()
                        .text_color(t.muted_foreground)
                        .child(row.command.clone()),
                    &row.command,
                ),
            ))
            .child(cell(
                &columns[7],
                8.,
                mono(row.pid_label.clone()).text_color(t.muted_foreground),
            ))
            .into_any_element()
    }

    fn expandable(&self, cell_view: &DiagnosticsExpandableCellView, t: &Tokens) -> AnyElement {
        let content = &cell_view.content;
        let client = self.client.clone();
        let id = cell_view.id.clone();
        let clamp = cell_view.collapsed_lines as f32 * LINE_CLAMP_LINE;
        div()
            .min_w_0()
            .flex()
            .flex_col()
            .child(
                div()
                    .whitespace_normal()
                    .when(content.collapsed, |text| {
                        text.max_h(px(clamp)).overflow_hidden()
                    })
                    .child(content.text.clone()),
            )
            .when_some(content.toggle_label.clone(), |column, label| {
                column.child(div().mt(px(4.)).flex().child(inline_action(
                    SharedString::from(format!("diag-expand-{}", cell_view.id)),
                    label,
                    t.muted_foreground,
                    t.foreground,
                    false,
                    move |_, cx| {
                        act(
                            &client,
                            cx,
                            "settingsDiagnosticsToggleText",
                            json!({ "id": id }),
                        );
                    },
                )))
            })
            .into_any_element()
    }

    fn trace_cell(&self, id: &str, trace: &TraceIdCellView, t: &Tokens) -> AnyElement {
        let client = self.client.clone();
        let trace_id = trace.trace_id.clone();
        div()
            .flex()
            .w_full()
            .min_w_0()
            .items_center()
            .gap(px(8.))
            .child(
                div().flex_1().min_w_0().child(code_tooltip(
                    SharedString::from(format!("{id}-trace")),
                    div()
                        .truncate()
                        .font_family(MONO_FONT)
                        .text_size(px(TEXT_2XS))
                        .child(trace.short_trace_id.clone()),
                    &trace.trace_id,
                )),
            )
            .child(
                self.icon_button(
                    IconButtonSpec {
                        id: &format!("{id}-copy"),
                        label: &trace.copy_aria_label,
                        tooltip: Some(&trace.copy_tooltip),
                        disabled: false,
                        size: ButtonSize::IconMicro,
                        variant: ButtonVariant::GhostMuted,
                    },
                    svg()
                        .path("icons/copy.svg")
                        .size(px(12.))
                        .text_color(t.muted_foreground)
                        .into_any_element(),
                    move |_, cx| {
                        act(
                            &client,
                            cx,
                            "settingsDiagnosticsCopyTrace",
                            json!({ "traceId": trace_id }),
                        );
                    },
                ),
            )
            .into_any_element()
    }

    fn diagnostics_sections(
        &self,
        view: &SettingsDiagnosticsView,
        clock: Option<&SettingsDiagnosticsClockView>,
        t: &Tokens,
    ) -> Vec<AnyElement> {
        let model = &view.diagnostics;
        let mut sections = Vec::new();
        let border = fade(t.border, 0.6);

        let live = &model.live_processes;
        let process_columns = process_columns();
        let process_rows: Vec<AnyElement> = if live.table.rows.is_empty() {
            vec![Self::empty_rows(&live.table.empty_label, t)]
        } else {
            live.table
                .rows
                .iter()
                .map(|row| self.process_row(row, t))
                .collect()
        };
        sections.push(
            SettingsSection::new(live.title.clone())
                .header_action(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .child(Self::last_checked(clock.map(|clock| &clock.processes), t))
                        .child(self.refresh_button(&live.refresh, t)),
                )
                .child(Self::stats_grid(&live.stats, t))
                .children(Self::messages(&live.messages, t))
                .child(div().border_t_1().border_color(border).child(table_frame(
                    "diag-processes",
                    1040.,
                    Some(PROCESS_TABLE_MAX_HEIGHT),
                    header_row(
                        &process_columns,
                        &live.table.headers,
                        8.,
                        TEXT_2XS,
                        TEXT_2XS_LINE,
                        t,
                    ),
                    process_rows,
                    t,
                )))
                .into_any_element(),
        );

        let history = &model.resource_history;
        let resource_columns = resource_columns();
        let resource_rows: Vec<AnyElement> = if history.table.rows.is_empty() {
            vec![Self::empty_rows(&history.table.empty_label, t)]
        } else {
            history
                .table
                .rows
                .iter()
                .map(|row| self.resource_row(row, t))
                .collect()
        };
        let peak = fade(t.foreground, 0.15);
        let average = fade(t.foreground, 0.6);
        sections.push(
            SettingsSection::new(history.title.clone())
                .header_action(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .child(self.window_selector(
                            "diag-resource-window",
                            &history.window_selector,
                            "settingsDiagnosticsWindow",
                        ))
                        .child(Self::last_checked(clock.map(|clock| &clock.resources), t))
                        .child(self.refresh_button(&history.refresh, t)),
                )
                .child(Self::stats_grid(&history.stats, t))
                .children(Self::messages(&history.messages, t))
                .child(
                    div()
                        .border_t_1()
                        .border_color(border)
                        .px(px(EDGE_X))
                        .py(px(12.))
                        .child(
                            div()
                                .flex()
                                .h(px(112.))
                                .items_end()
                                .gap(px(4.))
                                .overflow_hidden()
                                .rounded(px(2.))
                                .bg(fade(t.muted, 0.1))
                                .p(px(8.))
                                .children(history.chart.bars.iter().map(|bar| {
                                    div()
                                        .id(SharedString::from(format!("diag-bar-{}", bar.id)))
                                        .flex()
                                        .h_full()
                                        .min_w(px(4.))
                                        .flex_1()
                                        .items_end()
                                        .tooltip(Tooltip::text(bar.tooltip.clone()))
                                        .child(
                                            div()
                                                .relative()
                                                .size_full()
                                                .child(
                                                    div()
                                                        .absolute()
                                                        .left_0()
                                                        .right_0()
                                                        .bottom_0()
                                                        .h(relative(bar.peak_height_percent / 100.))
                                                        .rounded_t(px(2.))
                                                        .bg(peak),
                                                )
                                                .child(
                                                    div()
                                                        .absolute()
                                                        .left_0()
                                                        .right_0()
                                                        .bottom_0()
                                                        .h(relative(
                                                            bar.average_height_percent / 100.,
                                                        ))
                                                        .rounded_t(px(2.))
                                                        .bg(average),
                                                ),
                                        )
                                })),
                        ),
                )
                .child(div().border_t_1().border_color(border).child(table_frame(
                    "diag-resources",
                    980.,
                    Some(PROCESS_TABLE_MAX_HEIGHT),
                    header_row(
                        &resource_columns,
                        &history.table.headers,
                        8.,
                        TEXT_2XS,
                        TEXT_2XS_LINE,
                        t,
                    ),
                    resource_rows,
                    t,
                )))
                .into_any_element(),
        );

        let trace = &model.trace;
        let logs_client = self.client.clone();
        sections.push(
            SettingsSection::new(trace.title.clone())
                .header_action(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .child(Self::last_checked(clock.map(|clock| &clock.trace), t))
                        .child(
                            self.icon_button(
                                IconButtonSpec {
                                    id: "diag-open-logs",
                                    label: &trace.open_logs.label,
                                    tooltip: Some(&trace.open_logs.label),
                                    disabled: trace.open_logs.disabled,
                                    size: ButtonSize::IconXs,
                                    variant: ButtonVariant::GhostMuted,
                                },
                                svg()
                                    .path("icons/folder-open.svg")
                                    .size(px(14.))
                                    .text_color(t.muted_foreground)
                                    .into_any_element(),
                                move |_, cx| {
                                    act(&logs_client, cx, "settingsDiagnosticsOpenLogs", json!({}));
                                },
                            ),
                        )
                        .child(self.refresh_button(&trace.refresh, t)),
                )
                .child(Self::stats_grid(&trace.stats, t))
                .children(Self::messages(&trace.messages, t))
                .into_any_element(),
        );

        let generic_header = |labels: &[String], columns: &[Column]| {
            header_row(columns, labels, 10., TEXT_2XS, TEXT_2XS_LINE, t)
        };

        let latest = &model.latest_failures;
        let latest_columns = [
            col(0.3, false, EDGE_X, CELL_X),
            col(0.4, false, CELL_X, CELL_X),
            col(0.12, false, CELL_X, CELL_X),
            col(0.18, false, CELL_X, EDGE_X),
        ];
        sections.push(
            SettingsSection::new(latest.title.clone())
                .child(if latest.rows.is_empty() {
                    Self::empty_rows(&latest.empty_label, t)
                } else {
                    table_frame(
                        "diag-latest",
                        640.,
                        None,
                        generic_header(&latest.headers, &latest_columns),
                        latest
                            .rows
                            .iter()
                            .map(|row| {
                                div()
                                    .flex()
                                    .w_full()
                                    .items_start()
                                    .child(cell(
                                        &latest_columns[0],
                                        12.,
                                        div()
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(t.foreground)
                                            .child(row.name.clone()),
                                    ))
                                    .child(cell(
                                        &latest_columns[1],
                                        12.,
                                        div()
                                            .text_color(t.muted_foreground)
                                            .child(self.expandable(&row.cause, t)),
                                    ))
                                    .child(cell(
                                        &latest_columns[2],
                                        12.,
                                        mono(row.duration.clone()),
                                    ))
                                    .child(cell(
                                        &latest_columns[3],
                                        12.,
                                        mono(row.ended.clone())
                                            .whitespace_nowrap()
                                            .text_color(t.muted_foreground),
                                    ))
                                    .into_any_element()
                            })
                            .collect(),
                        t,
                    )
                })
                .into_any_element(),
        );

        let common = &model.common_failures;
        let common_columns = [
            col(0.3, false, EDGE_X, CELL_X),
            col(0.1, false, CELL_X, CELL_X),
            col(0.42, false, CELL_X, CELL_X),
            col(0.18, false, CELL_X, EDGE_X),
        ];
        sections.push(
            SettingsSection::new(common.title.clone())
                .child(if common.rows.is_empty() {
                    Self::empty_rows(&common.empty_label, t)
                } else {
                    table_frame(
                        "diag-common",
                        760.,
                        None,
                        generic_header(&common.headers, &common_columns),
                        common
                            .rows
                            .iter()
                            .map(|row| {
                                div()
                                    .flex()
                                    .w_full()
                                    .items_start()
                                    .child(cell(
                                        &common_columns[0],
                                        12.,
                                        div()
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(t.foreground)
                                            .child(row.name.clone()),
                                    ))
                                    .child(cell(&common_columns[1], 12., mono(row.count.clone())))
                                    .child(cell(
                                        &common_columns[2],
                                        12.,
                                        div()
                                            .text_color(t.muted_foreground)
                                            .child(self.expandable(&row.cause, t)),
                                    ))
                                    .child(cell(
                                        &common_columns[3],
                                        12.,
                                        mono(row.last_seen.clone())
                                            .whitespace_nowrap()
                                            .text_color(t.muted_foreground),
                                    ))
                                    .into_any_element()
                            })
                            .collect(),
                        t,
                    )
                })
                .into_any_element(),
        );

        let slow = &model.slowest_spans;
        let slow_columns = [
            col(0.44, false, EDGE_X, CELL_X),
            col(0.14, false, CELL_X, CELL_X),
            col(0.12, false, CELL_X, CELL_X),
            col(0.30, false, CELL_X, EDGE_X),
        ];
        sections.push(
            SettingsSection::new(slow.title.clone())
                .child(if slow.rows.is_empty() {
                    Self::empty_rows(&slow.empty_label, t)
                } else {
                    table_frame(
                        "diag-slow",
                        900.,
                        None,
                        generic_header(&slow.headers, &slow_columns),
                        slow.rows
                            .iter()
                            .map(|row| {
                                div()
                                    .flex()
                                    .w_full()
                                    .items_start()
                                    .child(cell(
                                        &slow_columns[0],
                                        12.,
                                        div()
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(t.foreground)
                                            .child(row.name.clone()),
                                    ))
                                    .child(cell(&slow_columns[1], 12., mono(row.duration.clone())))
                                    .child(cell(
                                        &slow_columns[2],
                                        12.,
                                        mono(row.ended.clone())
                                            .whitespace_nowrap()
                                            .text_color(t.muted_foreground),
                                    ))
                                    .child(cell(
                                        &slow_columns[3],
                                        12.,
                                        self.trace_cell(
                                            &format!("diag-slow-{}", row.id),
                                            &row.trace,
                                            t,
                                        ),
                                    ))
                                    .into_any_element()
                            })
                            .collect(),
                        t,
                    )
                })
                .into_any_element(),
        );

        let logs = &model.span_logs;
        let log_columns = [
            col(0.11, false, EDGE_X, CELL_X),
            col(0.09, false, CELL_X, CELL_X),
            col(0.24, false, CELL_X, CELL_X),
            col(0.26, false, CELL_X, CELL_X),
            col(0.30, false, CELL_X, EDGE_X),
        ];
        sections.push(
            SettingsSection::new(logs.title.clone())
                .child(if logs.rows.is_empty() {
                    Self::empty_rows(&logs.empty_label, t)
                } else {
                    table_frame(
                        "diag-logs",
                        920.,
                        None,
                        generic_header(&logs.headers, &log_columns),
                        logs.rows
                            .iter()
                            .enumerate()
                            .map(|(index, row)| {
                                hover_row(SharedString::from(format!("diag-log-{index}")), t, 0.15)
                                    .items_start()
                                    .child(cell(
                                        &log_columns[0],
                                        12.,
                                        mono(row.time.clone())
                                            .whitespace_nowrap()
                                            .text_color(t.muted_foreground),
                                    ))
                                    .child(cell(
                                        &log_columns[1],
                                        12.,
                                        div()
                                            .rounded(px(4.))
                                            .bg(t.muted)
                                            .px(px(6.))
                                            .py(px(2.))
                                            .font_family(MONO_FONT)
                                            .text_size(px(TEXT_2XS))
                                            .line_height(px(TEXT_2XS_LINE))
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(fade(t.foreground, 0.8))
                                            .child(row.level.to_uppercase()),
                                    ))
                                    .child(cell(
                                        &log_columns[2],
                                        12.,
                                        div()
                                            .truncate()
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(t.foreground)
                                            .child(row.span_name.clone()),
                                    ))
                                    .child(cell(
                                        &log_columns[3],
                                        12.,
                                        div()
                                            .text_color(t.muted_foreground)
                                            .child(self.expandable(&row.message, t)),
                                    ))
                                    .child(cell(
                                        &log_columns[4],
                                        12.,
                                        self.trace_cell(
                                            &format!("diag-log-{index}"),
                                            &row.trace,
                                            t,
                                        ),
                                    ))
                                    .into_any_element()
                            })
                            .collect(),
                        t,
                    )
                })
                .into_any_element(),
        );

        let top = &model.top_span_names;
        let top_columns = [
            col(0.48, false, EDGE_X, CELL_X),
            col(0.13, false, CELL_X, CELL_X),
            col(0.13, false, CELL_X, CELL_X),
            col(0.13, false, CELL_X, CELL_X),
            col(0.13, false, CELL_X, EDGE_X),
        ];
        sections.push(
            SettingsSection::new(top.title.clone())
                .child(if top.rows.is_empty() {
                    Self::empty_rows(&top.empty_label, t)
                } else {
                    table_frame(
                        "diag-top",
                        760.,
                        None,
                        generic_header(&top.headers, &top_columns),
                        top.rows
                            .iter()
                            .map(|row| {
                                div()
                                    .flex()
                                    .w_full()
                                    .items_start()
                                    .child(cell(
                                        &top_columns[0],
                                        12.,
                                        div()
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(t.foreground)
                                            .child(row.name.clone()),
                                    ))
                                    .child(cell(&top_columns[1], 12., mono(row.count.clone())))
                                    .child(cell(&top_columns[2], 12., mono(row.failures.clone())))
                                    .child(cell(&top_columns[3], 12., mono(row.average.clone())))
                                    .child(cell(&top_columns[4], 12., mono(row.max.clone())))
                                    .into_any_element()
                            })
                            .collect(),
                        t,
                    )
                })
                .into_any_element(),
        );
        sections
    }

    fn telemetry_icon(icon: &str, size: f32, color: Rgba) -> AnyElement {
        svg()
            .path(SharedString::from(format!("icons/{icon}.svg")))
            .flex_none()
            .size(px(size))
            .text_color(color)
            .into_any_element()
    }

    fn badge(badge: &ResourceBadgeView, t: &Tokens) -> AnyElement {
        let (border, bg, fg, dot) = match badge.tone.as_str() {
            "neutral" => (
                fade(t.border, 0.7),
                fade(t.muted, 0.45),
                t.muted_foreground,
                fade(t.muted_foreground, 0.55),
            ),
            "warning" => (
                fade(t.warning, 0.3),
                fade(t.warning, 0.1),
                t.warning_foreground,
                t.warning,
            ),
            "danger" => (
                fade(t.destructive, 0.3),
                fade(t.destructive, 0.1),
                t.destructive,
                t.destructive,
            ),
            _ => (
                fade(t.success, 0.25),
                fade(t.success, 0.1),
                t.success_foreground,
                t.success,
            ),
        };
        let text_label = if badge.prefix.is_empty() {
            format!(" {}", badge.text)
        } else {
            format!("{} {}", badge.prefix, badge.text)
        };
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(6.))
            .rounded_full()
            .border_1()
            .border_color(border)
            .bg(bg)
            .px(px(10.))
            .py(px(4.))
            .text_size(px(TEXT_3XS))
            .line_height(px(TEXT_3XS_LINE))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(fg)
            .child(div().size(px(6.)).rounded_full().bg(dot))
            .child(text_label.trim_start().to_uppercase())
            .into_any_element()
    }

    fn last_sample(model: Option<&ResourceLastSampleView>, t: &Tokens) -> AnyElement {
        let base = div()
            .flex()
            .items_baseline()
            .gap(px(4.))
            .whitespace_nowrap()
            .text_size(px(TEXT_2XS))
            .line_height(px(TEXT_2XS_LINE));
        match model {
            None => base.into_any_element(),
            Some(ResourceLastSampleView::Waiting { label }) => base
                .text_color(fade(t.muted_foreground, 0.55))
                .child(label.clone())
                .into_any_element(),
            Some(ResourceLastSampleView::Relative {
                prefix,
                value,
                suffix,
            }) => base
                .text_color(fade(t.muted_foreground, 0.6))
                .child(prefix.clone())
                .child(mono(value.clone()))
                .children(suffix.clone())
                .into_any_element(),
        }
    }

    fn card(t: &Tokens) -> Div {
        div()
            .overflow_hidden()
            .rounded(px(16.))
            .border_1()
            .border_color(fade(t.border, 0.7))
            .bg(t.card)
    }

    fn icon_stat(stat: &ResourceStatView, t: &Tokens) -> Div {
        let value_color = tone_color(&stat.tone, t).unwrap_or(t.foreground);
        div()
            .min_w_0()
            .px(px(EDGE_X))
            .py(px(16.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(Self::telemetry_icon(
                        &stat.icon,
                        14.,
                        fade(t.muted_foreground, 0.55),
                    ))
                    .child(div().truncate().child(uppercase_label(
                        &stat.label,
                        TEXT_3XS,
                        TEXT_3XS_LINE,
                        fade(t.muted_foreground, 0.7),
                    ))),
            )
            .child(
                mono(stat.value.clone())
                    .mt(px(10.))
                    .truncate()
                    .text_size(px(text::XXL))
                    .line_height(px(text::XXL_LINE))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(value_color),
            )
            .when_some(stat.detail.clone(), |stat, detail| {
                stat.child(
                    div()
                        .mt(px(6.))
                        .truncate()
                        .text_size(px(TEXT_3XS))
                        .line_height(px(TEXT_3XS_LINE))
                        .text_color(fade(t.muted_foreground, 0.6))
                        .child(detail),
                )
            })
    }

    fn aggregate_card(card: &ResourceAggregateCardView, first: bool, t: &Tokens) -> Div {
        let accent = match card.accent.as_str() {
            "info" => fade(t.info, 0.8),
            "warning" => fade(t.warning, 0.8),
            _ => fade(t.success, 0.8),
        };
        div()
            .relative()
            .flex_1()
            .min_w_0()
            .overflow_hidden()
            .px(px(EDGE_X))
            .py(px(16.))
            .when(!first, |card| {
                card.border_l_1().border_color(fade(t.border, 0.6))
            })
            .child(
                div()
                    .absolute()
                    .top_0()
                    .left(px(20.))
                    .right(px(20.))
                    .h(px(2.))
                    .rounded_full()
                    .bg(accent)
                    .opacity(0.75),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(12.))
                    .child(uppercase_label(
                        &card.label,
                        TEXT_3XS,
                        TEXT_3XS_LINE,
                        fade(t.muted_foreground, 0.75),
                    ))
                    .child(
                        mono(card.process_count_label.clone())
                            .rounded(px(6.))
                            .bg(fade(t.muted, 0.55))
                            .px(px(6.))
                            .py(px(2.))
                            .text_size(px(TEXT_3XS))
                            .line_height(px(TEXT_3XS_LINE))
                            .text_color(fade(t.muted_foreground, 0.7)),
                    ),
            )
            .child(
                div()
                    .mt(px(14.))
                    .flex()
                    .flex_wrap()
                    .gap_y(px(10.))
                    .children(card.metrics.iter().map(|metric| {
                        div()
                            .w(relative(0.5))
                            .min_w_0()
                            .pr(px(16.))
                            .child(uppercase_label(
                                &metric.label,
                                TEXT_3XS,
                                TEXT_3XS_LINE,
                                fade(t.muted_foreground, 0.45),
                            ))
                            .child(
                                mono(metric.value.clone())
                                    .truncate()
                                    .text_size(px(text::XS))
                                    .line_height(px(text::XS_LINE))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(fade(t.foreground, 0.9)),
                            )
                    })),
            )
    }

    fn detail_row(row: &ResourceDetailRowView, first: bool, t: &Tokens) -> Div {
        let color = tone_color(&row.tone, t).unwrap_or(fade(t.foreground, 0.85));
        div()
            .flex()
            .items_center()
            .justify_between()
            .gap(px(16.))
            .py(px(10.))
            .when(!first, |row| {
                row.border_t_1().border_color(fade(t.border, 0.5))
            })
            .text_size(px(TEXT_2XS))
            .line_height(px(TEXT_2XS_LINE))
            .child(
                div()
                    .text_color(fade(t.muted_foreground, 0.75))
                    .child(row.label.clone()),
            )
            .child(
                mono(row.value.clone())
                    .min_w_0()
                    .truncate()
                    .text_color(color),
            )
    }

    fn panel_title(icon: &str, title: &str, t: &Tokens) -> Div {
        div()
            .mb(px(12.))
            .flex()
            .items_center()
            .gap(px(8.))
            .child(
                div()
                    .flex()
                    .size(px(24.))
                    .items_center()
                    .justify_center()
                    .rounded(px(6.))
                    .bg(fade(t.muted, 0.6))
                    .child(Self::telemetry_icon(
                        icon,
                        14.,
                        fade(t.muted_foreground, 0.7),
                    )),
            )
            .child(uppercase_label(
                title,
                TEXT_3XS,
                TEXT_3XS_LINE,
                fade(t.muted_foreground, 0.7),
            ))
    }

    fn error_banner(message: &str, top: bool, t: &Tokens) -> Div {
        div()
            .flex()
            .items_start()
            .gap(px(8.))
            .map(|banner| {
                if top {
                    banner.border_t_1()
                } else {
                    banner.border_b_1()
                }
            })
            .border_color(fade(t.destructive, 0.2))
            .bg(fade(t.destructive, 0.05))
            .px(px(EDGE_X))
            .py(px(12.))
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .text_color(t.destructive)
            .child(
                svg()
                    .path("icons/triangle-alert.svg")
                    .flex_none()
                    .mt(px(2.))
                    .size(px(14.))
                    .text_color(t.destructive),
            )
            .child(div().min_w_0().child(message.to_string()))
    }

    fn live_process_row(&self, row: &ResourceLiveProcessRowView, t: &Tokens) -> AnyElement {
        let columns = telemetry_process_columns();
        let id = format!("tel-proc-{}", row.id);
        let dot = match row.category_dot.as_str() {
            "warning" => t.warning,
            "info" => t.info,
            "violet" => rgba(VIOLET),
            _ => t.success,
        };
        let toggle = row.has_children.then(|| {
            let client = self.client.clone();
            let key = row.id.clone();
            let handler: Box<dyn Fn(&mut App)> = Box::new(move |cx| {
                act(
                    &client,
                    cx,
                    "settingsTelemetryToggleProcess",
                    json!({ "processKey": key }),
                );
            });
            (row.toggle_label.clone(), !row.collapsed, handler)
        });
        let actions = if row.signal.available {
            let client = self.client.clone();
            let (key, pid, start) = (row.id.clone(), row.pid, row.start_time_ms);
            let model = ProcessSignalActionsView {
                actions: ["SIGINT", "SIGKILL"]
                    .iter()
                    .map(|signal| {
                        crate::app_core::views::settings_diagnostics::ProcessSignalActionView {
                            signal: signal.to_string(),
                            label: if *signal == "SIGINT" { "INT" } else { "KILL" }.to_string(),
                            aria_label: format!("Send {signal}"),
                            tooltip: format!("Send {signal}"),
                            tone: if *signal == "SIGINT" {
                                "muted"
                            } else {
                                "destructive"
                            }
                            .to_string(),
                            disabled: row.signal.disabled,
                        }
                    })
                    .collect(),
            };
            self.signal_actions(&id, &model, t, move |signal, cx| {
                act(
                    &client,
                    cx,
                    "settingsTelemetrySignal",
                    json!({ "processKey": key, "pid": pid, "startTimeMs": start, "signal": signal }),
                );
            })
        } else {
            div()
                .text_size(px(TEXT_3XS))
                .text_color(fade(t.muted_foreground, 0.35))
                .child("—")
                .into_any_element()
        };
        hover_row(SharedString::from(id.clone()), t, 0.2)
            .child(cell(
                &columns[0],
                8.,
                self.name_cell(
                    NameCell {
                        id: &id,
                        indent: row.indent_px,
                        toggle,
                        dot,
                        name: &row.name,
                        command: &row.command_tooltip,
                    },
                    t,
                ),
            ))
            .child(cell(
                &columns[1],
                8.,
                div()
                    .truncate()
                    .text_size(px(TEXT_2XS))
                    .text_color(t.muted_foreground)
                    .child(row.category_label.clone()),
            ))
            .child(cell(&columns[2], 8., mono(row.cpu.clone())))
            .child(cell(&columns[3], 8., mono(row.cpu_time.clone())))
            .child(cell(&columns[4], 8., mono(row.memory.clone())))
            .child(cell(
                &columns[5],
                8.,
                mono(row.read_rate.clone()).text_color(t.info_foreground),
            ))
            .child(cell(
                &columns[6],
                8.,
                mono(row.write_rate.clone()).text_color(t.warning_foreground),
            ))
            .child(cell(
                &columns[7],
                8.,
                mono(row.read_total.clone()).text_color(t.muted_foreground),
            ))
            .child(cell(
                &columns[8],
                8.,
                div()
                    .id(SharedString::from(format!("{id}-write-total")))
                    .tooltip(Tooltip::text(row.io_semantics_label.clone()))
                    .child(mono(row.write_total.clone()).text_color(t.muted_foreground)),
            ))
            .child(cell(
                &columns[9],
                8.,
                mono(format!("{}", row.pid)).text_color(t.muted_foreground),
            ))
            .child(cell(&columns[10], 8., actions))
            .into_any_element()
    }

    fn telemetry_sections(
        &self,
        view: &SettingsDiagnosticsView,
        clock: Option<&SettingsDiagnosticsClockView>,
        t: &Tokens,
    ) -> Vec<AnyElement> {
        let model = &view.telemetry;
        let mut sections = Vec::new();
        let border = fade(t.border, 0.6);
        let section_icon =
            |icon: &str| Self::telemetry_icon(icon, SECTION_ICON, t.muted_foreground);

        let monitor = &model.monitor;
        let refresh_client = self.client.clone();
        let stats: Vec<Div> = monitor
            .stats
            .iter()
            .map(|stat| Self::icon_stat(stat, t))
            .collect();
        let mut grid_rows: Vec<AnyElement> = Vec::new();
        let stat_rows = stats.into_iter().collect::<Vec<_>>();
        let mut chunked: Vec<Vec<Div>> = Vec::new();
        for stat in stat_rows {
            match chunked.last_mut() {
                Some(row) if row.len() < 3 => row.push(stat),
                _ => chunked.push(vec![stat]),
            }
        }
        let divider = fade(t.border, 0.55);
        for (row_index, row) in chunked.into_iter().enumerate() {
            let count = row.len();
            grid_rows.push(
                div()
                    .flex()
                    .w_full()
                    .when(row_index > 0, |row| row.border_t_1().border_color(divider))
                    .children(row.into_iter().enumerate().map(|(index, stat)| {
                        div()
                            .w(relative(1. / 3.))
                            .min_w_0()
                            .when(index + 1 < count, |cell| {
                                cell.border_r_1().border_color(divider)
                            })
                            .child(stat)
                    }))
                    .into_any_element(),
            );
        }
        sections.push(
            SettingsSection::new(monitor.title.clone())
                .icon(section_icon(&monitor.icon))
                .header_action(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .children(
                            monitor
                                .native_badge
                                .as_ref()
                                .map(|badge| Self::badge(badge, t)),
                        )
                        .child(Self::last_sample(clock.map(|clock| &clock.last_sample), t))
                        .child(self.icon_button(
                            IconButtonSpec {
                                id: "tel-refresh",
                                label: &monitor.refresh.aria_label,
                                tooltip: monitor.refresh.tooltip.as_deref(),
                                disabled: monitor.refresh.disabled,
                                size: ButtonSize::IconMicro,
                                variant: ButtonVariant::Ghost,
                            },
                            spin_icon(
                                "tel-refresh-spin",
                                "refresh-cw",
                                12.,
                                t.foreground,
                                monitor.refresh.refreshing,
                            ),
                            move |_, cx| {
                                act(&refresh_client, cx, "settingsTelemetryRefresh", json!({}))
                            },
                        )),
                )
                .child(
                    Self::card(t)
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .gap(px(12.))
                                .border_b_1()
                                .border_color(border)
                                .bg(gpui::linear_gradient(
                                    90.,
                                    gpui::linear_color_stop(over(fade(t.muted, 0.45), t.card), 0.),
                                    gpui::linear_color_stop(t.card, 1.),
                                ))
                                .px(px(EDGE_X))
                                .py(px(16.))
                                .child(
                                    div()
                                        .child(uppercase_label(
                                            &monitor.footprint_title,
                                            TEXT_3XS,
                                            TEXT_3XS_LINE,
                                            fade(t.muted_foreground, 0.7),
                                        ))
                                        .child(
                                            div()
                                                .mt(px(4.))
                                                .max_w(px(576.))
                                                .text_size(px(text::XS))
                                                .line_height(px(19.5))
                                                .text_color(t.muted_foreground)
                                                .child(monitor.footprint_description.clone()),
                                        ),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .flex_none()
                                        .items_center()
                                        .gap(px(8.))
                                        .text_size(px(TEXT_3XS))
                                        .line_height(px(TEXT_3XS_LINE))
                                        .text_color(fade(t.muted_foreground, 0.65))
                                        .child(div().size(px(6.)).rounded_full().bg(t.success))
                                        .child(monitor.sampling_label.clone()),
                                ),
                        )
                        .children(grid_rows)
                        .children(
                            monitor
                                .error
                                .as_ref()
                                .map(|error| Self::error_banner(error, true, t)),
                        )
                        .children(monitor.aggregates.as_ref().map(|cards| {
                            div()
                                .flex()
                                .border_t_1()
                                .border_color(border)
                                .bg(fade(t.muted, 0.1))
                                .children(
                                    cards.iter().enumerate().map(|(index, card)| {
                                        Self::aggregate_card(card, index == 0, t)
                                    }),
                                )
                        })),
                )
                .into_any_element(),
        );

        let host = &model.host;
        let retry_client = self.client.clone();
        let host_state = match &host.host_state {
            crate::app_core::views::settings_diagnostics::ResourceHostStateView::Signals {
                rows,
            } => div()
                .children(
                    rows.iter()
                        .enumerate()
                        .map(|(index, row)| Self::detail_row(row, index == 0, t)),
                )
                .into_any_element(),
            crate::app_core::views::settings_diagnostics::ResourceHostStateView::Disconnected {
                title,
                description,
            } => div()
                .rounded(px(12.))
                .border_1()
                .border_dashed()
                .border_color(fade(t.border, 0.7))
                .bg(fade(t.muted, 0.2))
                .px(px(16.))
                .py(px(20.))
                .child(
                    div()
                        .text_size(px(text::SM))
                        .line_height(px(text::SM_LINE))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.foreground)
                        .child(title.clone()),
                )
                .child(
                    div()
                        .mt(px(6.))
                        .max_w(px(384.))
                        .text_size(px(TEXT_2XS))
                        .line_height(px(17.875))
                        .text_color(fade(t.muted_foreground, 0.7))
                        .child(description.clone()),
                )
                .into_any_element(),
        };
        let collection = match &host.collection {
            crate::app_core::views::settings_diagnostics::ResourceCollectionView::Ready {
                sources,
                rows,
            } => div()
                .children(sources.iter().enumerate().map(|(index, source)| {
                    div()
                        .flex()
                        .items_start()
                        .justify_between()
                        .gap(px(16.))
                        .py(px(12.))
                        .when(index > 0, |row| {
                            row.border_t_1().border_color(fade(t.border, 0.5))
                        })
                        .child(
                            div()
                                .min_w_0()
                                .child(
                                    div()
                                        .text_size(px(text::SM))
                                        .line_height(px(text::SM_LINE))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(t.foreground)
                                        .child(source.label.clone()),
                                )
                                .child(
                                    div()
                                        .mt(px(4.))
                                        .text_size(px(TEXT_2XS))
                                        .line_height(px(17.875))
                                        .text_color(fade(t.muted_foreground, 0.65))
                                        .child(source.description.clone()),
                                ),
                        )
                        .child(Self::badge(&source.badge, t))
                }))
                .children(rows.iter().map(|row| Self::detail_row(row, false, t)))
                .into_any_element(),
            crate::app_core::views::settings_diagnostics::ResourceCollectionView::Waiting {
                label,
            } => div()
                .py(px(16.))
                .text_size(px(text::XS))
                .text_color(t.muted_foreground)
                .child(label.clone())
                .into_any_element(),
        };
        let mut host_section =
            SettingsSection::new(host.title.clone()).icon(section_icon(&host.icon));
        if host.retry.visible {
            host_section = host_section.header_action(
                Button::new("tel-retry")
                    .size(ButtonSize::Xs)
                    .variant(ButtonVariant::Outline)
                    .disabled(host.retry.disabled)
                    .child(spin_icon(
                        "tel-retry-spin",
                        "refresh-cw",
                        12.,
                        t.foreground,
                        host.retry.refreshing,
                    ))
                    .label(host.retry.label.clone())
                    .on_click(move |_, _, cx| {
                        act(&retry_client, cx, "settingsTelemetryRetry", json!({}))
                    }),
            );
        }
        sections.push(
            host_section
                .child(
                    Self::card(t)
                        .flex()
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .px(px(EDGE_X))
                                .py(px(16.))
                                .child(Self::panel_title(
                                    &host.host_state_icon,
                                    &host.host_state_title,
                                    t,
                                ))
                                .child(host_state),
                        )
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .border_l_1()
                                .border_color(border)
                                .px(px(EDGE_X))
                                .py(px(16.))
                                .child(Self::panel_title(
                                    &host.collection_icon,
                                    &host.collection_title,
                                    t,
                                ))
                                .child(collection),
                        ),
                )
                .into_any_element(),
        );

        let timeline = &model.timeline;
        let history_refresh = self.client.clone();
        let history_columns = telemetry_history_columns();
        let history_labels: Vec<String> = timeline
            .process_columns
            .iter()
            .map(|column| column.label.clone())
            .collect();
        let history_rows: Vec<AnyElement> = match &timeline.process_empty_label {
            Some(label) => vec![Self::empty_rows(label, t)],
            None => timeline
                .process_rows
                .iter()
                .map(|row| {
                    let id = format!("tel-hist-{}", row.id);
                    hover_row(SharedString::from(id.clone()), t, 0.2)
                        .child(cell(
                            &history_columns[0],
                            8.,
                            code_tooltip(
                                SharedString::from(format!("{id}-name")),
                                div()
                                    .truncate()
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(t.foreground)
                                    .child(row.name.clone()),
                                &row.command_tooltip,
                            ),
                        ))
                        .child(cell(
                            &history_columns[1],
                            8.,
                            div()
                                .truncate()
                                .text_size(px(TEXT_2XS))
                                .text_color(t.muted_foreground)
                                .child(row.category_label.clone()),
                        ))
                        .child(cell(&history_columns[2], 8., mono(row.cpu_time.clone())))
                        .child(cell(&history_columns[3], 8., mono(row.peak_cpu.clone())))
                        .child(cell(&history_columns[4], 8., mono(row.peak_memory.clone())))
                        .child(cell(
                            &history_columns[5],
                            8.,
                            mono(row.read.clone()).text_color(t.info_foreground),
                        ))
                        .child(cell(
                            &history_columns[6],
                            8.,
                            mono(row.write.clone()).text_color(t.warning_foreground),
                        ))
                        .child(cell(
                            &history_columns[7],
                            8.,
                            mono(format!("{}", row.sample_count)).text_color(t.muted_foreground),
                        ))
                        .child(cell(
                            &history_columns[8],
                            8.,
                            mono(format!("{}", row.pid)).text_color(t.muted_foreground),
                        ))
                        .into_any_element()
                })
                .collect(),
        };
        let legend_color = |id: &str| match id {
            "read" => fade(t.info, 0.7),
            "write" => fade(t.warning, 0.8),
            _ => fade(t.foreground, 0.7),
        };
        sections.push(
            SettingsSection::new(timeline.title.clone())
                .icon(section_icon(&timeline.icon))
                .header_action(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(self.window_selector(
                            "tel-window",
                            &timeline.window_selector,
                            "settingsTelemetryWindow",
                        ))
                        .child(self.icon_button(
                            IconButtonSpec {
                                id: "tel-history-refresh",
                                label: &timeline.refresh.aria_label,
                                tooltip: None,
                                disabled: timeline.refresh.disabled,
                                size: ButtonSize::IconMicro,
                                variant: ButtonVariant::Ghost,
                            },
                            spin_icon(
                                "tel-history-spin",
                                "refresh-cw",
                                12.,
                                t.foreground,
                                timeline.refresh.refreshing,
                            ),
                            move |_, cx| {
                                act(
                                    &history_refresh,
                                    cx,
                                    "settingsTelemetryHistoryRefresh",
                                    json!({}),
                                )
                            },
                        )),
                )
                .child(
                    Self::card(t)
                        .children(
                            timeline
                                .error
                                .as_ref()
                                .map(|error| Self::error_banner(error, false, t)),
                        )
                        .child(
                            div()
                                .px(px(EDGE_X))
                                .py(px(16.))
                                .child(
                                    div()
                                        .mb(px(12.))
                                        .flex()
                                        .flex_wrap()
                                        .items_center()
                                        .gap_x(px(16.))
                                        .gap_y(px(4.))
                                        .text_size(px(TEXT_3XS))
                                        .line_height(px(TEXT_3XS_LINE))
                                        .text_color(fade(t.muted_foreground, 0.65))
                                        .children(timeline.legend.iter().map(|item| {
                                            div()
                                                .flex()
                                                .items_center()
                                                .gap(px(6.))
                                                .child(
                                                    div()
                                                        .h(px(6.))
                                                        .w(px(12.))
                                                        .rounded_full()
                                                        .bg(legend_color(&item.id)),
                                                )
                                                .child(item.label.clone())
                                        })),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .h(px(128.))
                                        .items_end()
                                        .gap(px(4.))
                                        .overflow_hidden()
                                        .rounded(px(10.))
                                        .border_1()
                                        .border_color(fade(t.border, 0.4))
                                        .bg(fade(t.muted, 0.08))
                                        .px(px(8.))
                                        .pt(px(12.))
                                        .pb(px(8.))
                                        .children(timeline.bars.iter().map(|bar| {
                                            let bar_part = |height: f32, color: Rgba| {
                                                div()
                                                    .flex_1()
                                                    .h(relative(height / 100.))
                                                    .rounded_t(px(2.))
                                                    .bg(color)
                                            };
                                            div()
                                                .id(SharedString::from(format!(
                                                    "tel-bar-{}",
                                                    bar.id
                                                )))
                                                .flex()
                                                .h_full()
                                                .min_w(px(4.))
                                                .flex_1()
                                                .items_end()
                                                .gap(px(1.))
                                                .tooltip(Tooltip::text(
                                                    bar.tooltip_lines.join("\n"),
                                                ))
                                                .child(bar_part(
                                                    bar.cpu_height_percent,
                                                    fade(t.foreground, 0.65),
                                                ))
                                                .child(bar_part(
                                                    bar.read_height_percent,
                                                    fade(t.info, 0.7),
                                                ))
                                                .child(bar_part(
                                                    bar.write_height_percent,
                                                    fade(t.warning, 0.8),
                                                ))
                                        })),
                                ),
                        )
                        .child(div().border_t_1().border_color(border).child(table_frame(
                            "tel-history",
                            1020.,
                            Some(HISTORY_TABLE_MAX_HEIGHT),
                            header_row(
                                &history_columns,
                                &history_labels,
                                8.,
                                TEXT_3XS,
                                TEXT_3XS_LINE,
                                t,
                            ),
                            history_rows,
                            t,
                        ))),
                )
                .into_any_element(),
        );

        let tree = &model.process_tree;
        let tree_columns = telemetry_process_columns();
        let tree_labels: Vec<String> = tree
            .columns
            .iter()
            .map(|column| column.label.clone())
            .collect();
        let tree_rows: Vec<AnyElement> = match &tree.empty_label {
            Some(label) => vec![Self::empty_rows(label, t)],
            None => tree
                .rows
                .iter()
                .map(|row| self.live_process_row(row, t))
                .collect(),
        };
        let mut tree_section =
            SettingsSection::new(tree.title.clone()).icon(section_icon(&tree.icon));
        if let Some(hint) = tree.identity_hint.as_ref() {
            tree_section = tree_section.header_action(
                div()
                    .flex()
                    .gap(px(4.))
                    .text_size(px(TEXT_3XS))
                    .line_height(px(TEXT_3XS_LINE))
                    .text_color(fade(t.muted_foreground, 0.55))
                    .child(hint.label.clone())
                    .child(div().font_family(MONO_FONT).child(hint.value.clone())),
            );
        }
        sections.push(
            tree_section
                .child(Self::card(t).child(table_frame(
                    "tel-tree",
                    1320.,
                    Some(TELEMETRY_TABLE_MAX_HEIGHT),
                    header_row(&tree_columns, &tree_labels, 8., TEXT_3XS, TEXT_3XS_LINE, t),
                    tree_rows,
                    t,
                )))
                .into_any_element(),
        );

        let attribution = &model.attribution;
        let attribution_columns = attribution_columns();
        let attribution_labels: Vec<String> = attribution
            .columns
            .iter()
            .map(|column: &ResourceColumnView| column.label.clone())
            .collect();
        let attribution_rows: Vec<AnyElement> = match &attribution.empty_label {
            Some(label) => vec![Self::empty_rows(label, t)],
            None => attribution
                .rows
                .iter()
                .map(|row| {
                    hover_row(SharedString::from(format!("tel-attr-{}", row.id)), t, 0.2)
                        .child(cell(
                            &attribution_columns[0],
                            8.,
                            div()
                                .truncate()
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.foreground)
                                .child(row.component.clone()),
                        ))
                        .child(cell(
                            &attribution_columns[1],
                            8.,
                            div()
                                .truncate()
                                .text_color(t.muted_foreground)
                                .child(row.operation.clone()),
                        ))
                        .child(cell(
                            &attribution_columns[2],
                            8.,
                            mono(row.logical_read.clone()).text_color(t.info_foreground),
                        ))
                        .child(cell(
                            &attribution_columns[3],
                            8.,
                            mono(row.logical_write.clone()).text_color(t.warning_foreground),
                        ))
                        .child(cell(
                            &attribution_columns[4],
                            8.,
                            mono(format!("{}", row.count)),
                        ))
                        .child(cell(
                            &attribution_columns[5],
                            8.,
                            mono(row.duration.clone()).text_color(t.muted_foreground),
                        ))
                        .into_any_element()
                })
                .collect(),
        };
        sections.push(
            SettingsSection::new(attribution.title.clone())
                .icon(section_icon(&attribution.icon))
                .header_action(
                    div()
                        .text_size(px(TEXT_3XS))
                        .line_height(px(TEXT_3XS_LINE))
                        .text_color(fade(t.muted_foreground, 0.55))
                        .child(attribution.header_note.clone()),
                )
                .child(
                    Self::card(t)
                        .child(
                            div()
                                .bg(fade(t.muted, 0.15))
                                .px(px(EDGE_X))
                                .py(px(12.))
                                .text_size(px(TEXT_2XS))
                                .line_height(px(17.875))
                                .text_color(t.muted_foreground)
                                .child(attribution.description.clone()),
                        )
                        .child(div().border_t_1().border_color(border).child(table_frame(
                            "tel-attribution",
                            720.,
                            None,
                            header_row(
                                &attribution_columns,
                                &attribution_labels,
                                8.,
                                TEXT_3XS,
                                TEXT_3XS_LINE,
                                t,
                            ),
                            attribution_rows,
                            t,
                        ))),
                )
                .into_any_element(),
        );
        sections
    }
}

fn process_columns() -> [Column; 7] {
    [
        col(0.24, false, EDGE_X, CELL_X),
        col(0.08, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.10, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.33, false, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.08, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.11, false, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.06, true, 8., CELL_X),
    ]
}

fn resource_columns() -> [Column; 8] {
    [
        col(0.24, false, EDGE_X, CELL_X),
        col(0.10, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.10, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.10, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.10, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.10, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.16, false, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.10, true, CELL_X_TIGHT, EDGE_X),
    ]
}

fn telemetry_process_columns() -> [Column; 11] {
    [
        col(0.20, false, EDGE_X, CELL_X),
        col(0.10, false, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.07, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.08, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.09, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.09, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.09, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.10, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.08, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.06, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.04, true, 8., CELL_X),
    ]
}

fn telemetry_history_columns() -> [Column; 9] {
    [
        col(0.24, false, EDGE_X, CELL_X),
        col(0.11, false, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.10, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.10, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.11, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.11, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.11, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.07, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.05, true, CELL_X_TIGHT, EDGE_X),
    ]
}

fn attribution_columns() -> [Column; 6] {
    [
        col(0.22, false, EDGE_X, CELL_X),
        col(0.28, false, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.14, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.14, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.10, true, CELL_X_TIGHT, CELL_X_TIGHT),
        col(0.12, true, CELL_X_TIGHT, EDGE_X),
    ]
}

impl Render for DiagnosticsSection {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return div().into_any_element();
        };
        let clock = self.clock.read(cx).data.clone().flatten();
        let t = theme::active(cx);
        let mut sections = self.telemetry_sections(&view, clock.as_ref(), &t);
        sections.extend(self.diagnostics_sections(&view, clock.as_ref(), &t));
        settings_stack()
            .gap(px(40.))
            .children(sections)
            .into_any_element()
    }
}
