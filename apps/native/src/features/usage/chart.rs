use std::collections::HashMap;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Bounds, ElementId, InteractiveElement, IntoElement, MouseMoveEvent,
    ParentElement, PathBuilder, Pixels, Point, RenderOnce, Rgba, SharedString, Size,
    StatefulInteractiveElement, Styled, Window, canvas, div, fill, point, px, size, svg,
};

use super::colors::css_color;
use crate::app_core::views::usage::{UsageChartColumnView, UsageProviderChartView};
use crate::features::chat::provider_instance_icon::ProviderInstanceIcon;
use crate::ui::popover::{black, shadow};
use crate::ui::theme;
use crate::ui::theme::Tokens;
use crate::ui::theme::metrics::radius;
use crate::ui::theme::tokens::fade;

const PLOT_HEIGHT: f32 = 224.;
const AXIS_WIDTH: f32 = 56.;
const AXIS_GAP: f32 = 8.;
const AXIS_ROW_GAP: f32 = 4.;
const AXIS_TEXT: f32 = 10.;
const AXIS_LINE: f32 = 14.;
const STROKE: f32 = 2.;
const AREA_OPACITY: f32 = 0.12;
const TOOLTIP_GAP: f32 = 12.;
const TOOLTIP_MIN_WIDTH: f32 = 144.;
const TOOLTIP_PADDING_X: f32 = 10.;
const TOOLTIP_PADDING_Y: f32 = 8.;
const TOOLTIP_TEXT: f32 = 12.;
const TOOLTIP_LINE: f32 = 16.;
const TOOLTIP_ROW_GAP: f32 = 12.;
const TOOLTIP_MARK: f32 = 12.;
const TOOLTIP_MARK_GAP: f32 = 6.;
const TOOLTIP_SECTION_GAP: f32 = 4.;
const TOOLTIP_GLASS: f32 = 0.8;

pub fn provider_driver(provider: &str) -> &str {
    match provider {
        "claude" => "claudeAgent",
        other => other,
    }
}

#[derive(Default)]
struct ChartHover {
    plot: Bounds<Pixels>,
    pointer: Option<Point<Pixels>>,
    tooltip: Size<Pixels>,
}

enum Segment {
    Move(Point<f32>),
    Line(Point<f32>),
    Cubic(Point<f32>, Point<f32>, Point<f32>),
    Close,
}

fn parse_path(data: &str) -> Vec<Segment> {
    let mut segments = Vec::new();
    let mut command = ' ';
    let mut numbers: Vec<f32> = Vec::new();
    let flush = |command: char, numbers: &mut Vec<f32>, segments: &mut Vec<Segment>| {
        let pair = |index: usize| point(numbers[index], numbers[index + 1]);
        match command {
            'M' if numbers.len() >= 2 => segments.push(Segment::Move(pair(0))),
            'L' if numbers.len() >= 2 => segments.push(Segment::Line(pair(0))),
            'C' if numbers.len() >= 6 => {
                segments.push(Segment::Cubic(pair(0), pair(2), pair(4)));
            }
            'Z' => segments.push(Segment::Close),
            _ => {}
        }
        numbers.clear();
    };
    for token in data
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter(|token| !token.is_empty())
    {
        let mut rest = token;
        while let Some(first) = rest.chars().next() {
            if first.is_ascii_alphabetic() {
                flush(command, &mut numbers, &mut segments);
                command = first;
                rest = &rest[first.len_utf8()..];
                if command == 'Z' || command == 'z' {
                    flush('Z', &mut numbers, &mut segments);
                    command = ' ';
                }
                continue;
            }
            if let Ok(value) = rest.parse::<f32>() {
                numbers.push(value);
            }
            break;
        }
    }
    flush(command, &mut numbers, &mut segments);
    segments
}

fn build_path(
    segments: &[Segment],
    mut builder: PathBuilder,
    map: &impl Fn(Point<f32>) -> Point<Pixels>,
) -> Option<gpui::Path<Pixels>> {
    if segments.is_empty() {
        return None;
    }
    for segment in segments {
        match segment {
            Segment::Move(to) => builder.move_to(map(*to)),
            Segment::Line(to) => builder.line_to(map(*to)),
            Segment::Cubic(c1, c2, to) => builder.cubic_bezier_to(map(*to), map(*c1), map(*c2)),
            Segment::Close => builder.close(),
        }
    }
    builder.build().ok()
}

struct PaintedPath {
    color: Rgba,
    area: Vec<Segment>,
    line: Vec<Segment>,
}

#[derive(IntoElement)]
pub struct UsageProviderChart {
    id: ElementId,
    model: UsageProviderChartView,
    marks: HashMap<String, SharedString>,
}

impl UsageProviderChart {
    pub fn new(id: impl Into<ElementId>, model: UsageProviderChartView) -> Self {
        Self {
            id: id.into(),
            model,
            marks: HashMap::new(),
        }
    }

    pub fn mark_override(mut self, provider: &str, icon: impl Into<SharedString>) -> Self {
        self.marks.insert(provider.to_string(), icon.into());
        self
    }
}

fn mark(
    provider: &str,
    marks: &HashMap<String, SharedString>,
    color: Rgba,
    icon_size: f32,
) -> AnyElement {
    match marks.get(provider) {
        Some(path) => svg()
            .path(path.clone())
            .flex_none()
            .size(px(icon_size))
            .text_color(color)
            .into_any_element(),
        None => ProviderInstanceIcon::new(provider_driver(provider).to_string(), "", color)
            .icon_size(icon_size)
            .into_any_element(),
    }
}

fn tooltip(
    column: &UsageChartColumnView,
    marks: &HashMap<String, SharedString>,
    t: &Tokens,
) -> gpui::Div {
    let row = |label: AnyElement, value: String| {
        div()
            .flex()
            .items_center()
            .justify_between()
            .gap(px(TOOLTIP_ROW_GAP))
            .child(label)
            .child(
                div()
                    .text_color(t.foreground)
                    .font_features(theme::tabular())
                    .child(value),
            )
    };
    div()
        .flex()
        .flex_col()
        .min_w(px(TOOLTIP_MIN_WIDTH))
        .px(px(TOOLTIP_PADDING_X))
        .py(px(TOOLTIP_PADDING_Y))
        .rounded(px(radius::XL))
        .border_1()
        .border_color(fade(t.border, 0.5))
        .bg(fade(t.background, TOOLTIP_GLASS))
        .shadow(vec![
            shadow(0., 10., 15., -3., black(0.1)),
            shadow(0., 4., 6., -4., black(0.1)),
        ])
        .text_size(px(TOOLTIP_TEXT))
        .line_height(px(TOOLTIP_LINE))
        .child(
            div()
                .mb(px(TOOLTIP_SECTION_GAP))
                .text_color(t.muted_foreground)
                .child(column.tooltip_title.clone()),
        )
        .children(column.rows.iter().map(|entry| {
            row(
                div()
                    .flex()
                    .items_center()
                    .gap(px(TOOLTIP_MARK_GAP))
                    .text_color(t.muted_foreground)
                    .child(mark(
                        &entry.provider,
                        marks,
                        t.muted_foreground,
                        TOOLTIP_MARK,
                    ))
                    .child(entry.label.clone())
                    .into_any_element(),
                entry.value_label.clone(),
            )
        }))
        .child(
            row(
                div()
                    .text_color(t.muted_foreground)
                    .child("Total")
                    .into_any_element(),
                column.total_label.clone(),
            )
            .mt(px(TOOLTIP_SECTION_GAP))
            .pt(px(TOOLTIP_SECTION_GAP))
            .border_t_1()
            .border_color(t.border),
        )
}

fn tooltip_origin(
    pointer: Point<Pixels>,
    plot: Size<Pixels>,
    tooltip: Size<Pixels>,
) -> Point<Pixels> {
    let gap = px(TOOLTIP_GAP);
    let left = if pointer.x + gap + tooltip.width <= plot.width {
        pointer.x + gap
    } else {
        pointer.x - gap - tooltip.width
    };
    let top = if pointer.y + gap + tooltip.height <= plot.height {
        pointer.y + gap
    } else {
        pointer.y - gap - tooltip.height
    };
    let max_left = (plot.width - tooltip.width).max(px(0.));
    let max_top = (plot.height - tooltip.height).max(px(0.));
    point(left.max(px(0.)).min(max_left), top.max(px(0.)).min(max_top))
}

impl RenderOnce for UsageProviderChart {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let hover = window.use_keyed_state(self.id.clone(), cx, |_, _| ChartHover::default());
        let model = self.model;
        let view_width = model.view_width.max(1.);
        let view_height = model.view_height.max(1.);
        let state = hover.read(cx);
        let plot_size = state.plot.size;
        let hovered = state.pointer.and_then(|pointer| {
            let width = f32::from(plot_size.width);
            if width <= 0. {
                return None;
            }
            let x = f32::from(pointer.x) / width * view_width;
            model
                .columns
                .iter()
                .enumerate()
                .min_by(|(_, a), (_, b)| (a.x - x).abs().total_cmp(&(b.x - x).abs()))
                .map(|(index, _)| (index, pointer))
        });
        let tooltip_size = state.tooltip;
        let painted: Vec<PaintedPath> = model
            .paths
            .iter()
            .map(|path| PaintedPath {
                color: css_color(&path.color, &t),
                area: parse_path(&path.area),
                line: parse_path(&path.line),
            })
            .collect();
        let ticks: Vec<f32> = model.ticks.iter().map(|tick| tick.y).collect();
        let hover_x =
            hovered.and_then(|(index, _)| model.columns.get(index).map(|column| column.x));
        let plot_top = model.plot_top;
        let grid = t.border;
        let cursor = t.muted_foreground;
        let prepaint_hover = hover.clone();
        let plot_canvas = canvas(
            move |bounds, _, cx| {
                prepaint_hover.update(cx, |state, _| state.plot = bounds);
            },
            move |bounds, _, window, _| {
                let origin = bounds.origin;
                let scale_x = f32::from(bounds.size.width) / view_width;
                let scale_y = f32::from(bounds.size.height) / view_height;
                let map = |p: Point<f32>| {
                    point(origin.x + px(p.x * scale_x), origin.y + px(p.y * scale_y))
                };
                window.with_content_mask(Some(gpui::ContentMask { bounds }), |window| {
                    for y in &ticks {
                        let top = origin.y + px(y * scale_y - 0.5);
                        window.paint_quad(fill(
                            Bounds::new(point(origin.x, top), size(bounds.size.width, px(1.))),
                            grid,
                        ));
                    }
                    for path in &painted {
                        if let Some(area) = build_path(&path.area, PathBuilder::fill(), &map) {
                            window.paint_path(area, fade(path.color, AREA_OPACITY));
                        }
                    }
                    for path in &painted {
                        if let Some(line) =
                            build_path(&path.line, PathBuilder::stroke(px(STROKE)), &map)
                        {
                            window.paint_path(line, path.color);
                        }
                    }
                    if let Some(x) = hover_x {
                        let left = origin.x + px(x * scale_x - 0.5);
                        let top = origin.y + px(plot_top * scale_y);
                        window.paint_quad(fill(
                            Bounds::new(
                                point(left, top),
                                size(px(1.), bounds.size.height - (top - origin.y)),
                            ),
                            cursor,
                        ));
                    }
                });
            },
        )
        .absolute()
        .inset_0()
        .size_full();
        let move_hover = hover.clone();
        let leave_hover = hover.clone();
        let measure_hover = hover.clone();
        let column_count = model.columns.len();
        let marks = self.marks;
        let tooltip_element = hovered.and_then(|(index, pointer)| {
            let column = model.columns.get(index)?;
            let origin = tooltip_origin(pointer, plot_size, tooltip_size);
            Some(
                div().absolute().left(origin.x).top(origin.y).child(
                    tooltip(column, &marks, &t).child(
                        canvas(
                            move |bounds, _, cx| {
                                measure_hover.update(cx, |state, cx| {
                                    if state.tooltip != bounds.size {
                                        state.tooltip = bounds.size;
                                        cx.notify();
                                    }
                                });
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .inset_0()
                        .size_full(),
                    ),
                ),
            )
        });
        div()
            .flex()
            .flex_col()
            .gap(px(AXIS_ROW_GAP))
            .child(
                div()
                    .flex()
                    .gap(px(AXIS_GAP))
                    .child(
                        div()
                            .relative()
                            .flex_none()
                            .w(px(AXIS_WIDTH))
                            .h(px(PLOT_HEIGHT))
                            .children(model.ticks.iter().map(|tick| {
                                div()
                                    .absolute()
                                    .right_0()
                                    .top(px(tick.y / view_height * PLOT_HEIGHT - AXIS_LINE / 2.))
                                    .text_size(px(AXIS_TEXT))
                                    .line_height(px(AXIS_LINE))
                                    .text_color(t.muted_foreground)
                                    .font_features(theme::tabular())
                                    .whitespace_nowrap()
                                    .child(tick.label.clone())
                            })),
                    )
                    .child(
                        div()
                            .id(self.id.clone())
                            .relative()
                            .flex_1()
                            .min_w_0()
                            .h(px(PLOT_HEIGHT))
                            .child(plot_canvas)
                            .on_mouse_move(move |event: &MouseMoveEvent, _, cx| {
                                move_hover.update(cx, |state, cx| {
                                    let plot = state.plot;
                                    let pointer = (column_count > 0
                                        && plot.contains(&event.position))
                                    .then(|| {
                                        let local = event.position - plot.origin;
                                        point(
                                            local.x.max(px(0.)).min(plot.size.width),
                                            local.y.max(px(0.)).min(plot.size.height),
                                        )
                                    });
                                    if state.pointer != pointer {
                                        state.pointer = pointer;
                                        cx.notify();
                                    }
                                });
                            })
                            .on_hover(move |hovered, _, cx| {
                                if !hovered {
                                    leave_hover.update(cx, |state, cx| {
                                        if state.pointer.take().is_some() {
                                            cx.notify();
                                        }
                                    });
                                }
                            })
                            .when_some(tooltip_element, |this, tooltip| this.child(tooltip)),
                    ),
            )
            .child(
                div()
                    .flex()
                    .justify_between()
                    .pl(px(AXIS_WIDTH + AXIS_GAP))
                    .text_size(px(AXIS_TEXT))
                    .line_height(px(AXIS_LINE))
                    .text_color(t.muted_foreground)
                    .child(model.axis_labels.start.to_uppercase())
                    .child(model.axis_labels.middle.to_uppercase())
                    .child(model.axis_labels.end.to_uppercase()),
            )
    }
}
