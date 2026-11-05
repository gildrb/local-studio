use gpui::prelude::FluentBuilder;
use gpui::{AnyElement, App, Div, FontWeight, IntoElement, ParentElement, Styled, div, px, svg};

use crate::app_core::views::sidebar::EnvironmentMachineKind;
use crate::features::sidebar::machine_icon;
use crate::ui::theme;
use crate::ui::theme::metrics::text;

const ROW_PADDING_X: f32 = 16.;
const ROW_PADDING_Y: f32 = 10.;
const ROW_GAP: f32 = 12.;
const ICON: f32 = 16.;
const TRAILING_GAP: f32 = 4.;
const DIMMED_OPACITY: f32 = 0.6;

pub struct EnvironmentRow {
    kind: EnvironmentMachineKind,
    label: String,
    subtitle: AnyElement,
    below: Option<AnyElement>,
    dimmed: bool,
    trailing: Vec<AnyElement>,
}

impl EnvironmentRow {
    pub fn new(
        kind: EnvironmentMachineKind,
        label: impl Into<String>,
        subtitle: impl IntoElement,
    ) -> Self {
        Self {
            kind,
            label: label.into(),
            subtitle: subtitle.into_any_element(),
            below: None,
            dimmed: false,
            trailing: Vec::new(),
        }
    }

    pub fn below(mut self, below: impl IntoElement) -> Self {
        self.below = Some(below.into_any_element());
        self
    }

    pub fn dimmed(mut self, dimmed: bool) -> Self {
        self.dimmed = dimmed;
        self
    }

    pub fn trailing(mut self, element: impl IntoElement) -> Self {
        self.trailing.push(element.into_any_element());
        self
    }

    pub fn render(self, cx: &App) -> Div {
        let t = theme::active(cx);
        div()
            .flex()
            .items_center()
            .gap(px(ROW_GAP))
            .px(px(ROW_PADDING_X))
            .py(px(ROW_PADDING_Y))
            .when(self.dimmed, |row| row.opacity(DIMMED_OPACITY))
            .child(
                svg()
                    .path(machine_icon(self.kind))
                    .flex_none()
                    .size(px(ICON))
                    .text_color(t.muted_foreground),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .child(
                        div()
                            .truncate()
                            .text_size(px(text::SM))
                            .line_height(px(text::SM_LINE))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.foreground)
                            .child(self.label),
                    )
                    .child(
                        div()
                            .truncate()
                            .text_size(px(text::XS))
                            .line_height(px(text::XS_LINE))
                            .text_color(t.muted_foreground)
                            .child(self.subtitle),
                    )
                    .children(self.below),
            )
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(TRAILING_GAP))
                    .children(self.trailing),
            )
    }
}
