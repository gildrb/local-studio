use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, Context, Focusable, FontWeight, InteractiveElement, IntoElement, KeyDownEvent,
    MouseButton, ParentElement, SharedString, StatefulInteractiveElement, Styled, Window, canvas,
    div, px, relative, svg,
};
use serde_json::json;

use super::page::{LocalMenu, UsagePage};
use super::{act, text};
use crate::app_core::views::usage::{UsagePriceRowView, UsagePricesView};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::dialog::{
    DialogDescription, DialogFooter, DialogFooterVariant, DialogHeader, DialogPanel, DialogPopup,
    DialogTitle,
};
use crate::ui::input::{Input, InputFont, InputSize};
use crate::ui::menu::{MenuCheckboxItem, MenuItem, MenuPopup, MenuSeparator};
use crate::ui::popover::{Align, dropdown_glass};
use crate::ui::theme::metrics::{radius, text as type_scale};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const DIALOG_WIDTH: f32 = 768.;
const ROW_GAP: f32 = 8.;
const HEADER_HEIGHT: f32 = 40.;
const CELL_PADDING: f32 = 8.;
const MODEL_SHARE: f32 = 0.34;
const ACTION_WIDTH: f32 = 40.;
const ERROR_MARGIN: f32 = 4.;
const EMPTY_PADDING_Y: f32 = 24.;
const STATUS_GAP_X: f32 = 12.;
const STATUS_GAP_Y: f32 = 4.;
const CHEVRON: f32 = 14.;
const SUGGESTION_MAX_HEIGHT: f32 = 200.;
const SUGGESTION_PADDING: f32 = 4.;

impl UsagePage {
    pub(super) fn prices_dialog(
        &mut self,
        prices: &UsagePricesView,
        t: &Tokens,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let model = &prices.model;
        let client = self.client.clone();
        let close = self.client.clone();
        let escape = self.client.clone();
        let apply_open = self.open_menu == Some(LocalMenu::PricesApply);
        let bounds = self.menu_bounds.clone();
        let toggle_page = cx.entity().downgrade();
        let apply_trigger = div()
            .relative()
            .min_w_0()
            .child(
                Button::new("usage-prices-apply")
                    .variant(ButtonVariant::Outline)
                    .size(ButtonSize::Sm)
                    .min_w_0()
                    .disabled(model.selection.disabled)
                    .on_click(move |_, _, cx| {
                        let _ = toggle_page
                            .update(cx, |page, cx| page.toggle_menu(LocalMenu::PricesApply, cx));
                    })
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .child(model.selection.label.clone()),
                    )
                    .child(
                        svg()
                            .path("icons/chevron-down.svg")
                            .flex_none()
                            .size(px(CHEVRON))
                            .text_color(t.muted_foreground),
                    ),
            )
            .child(
                canvas(
                    move |trigger, _, _| {
                        bounds.borrow_mut().insert("prices", trigger);
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .inset_0()
                .size_full(),
            );
        let menu = apply_open.then(|| self.prices_menu(prices, t, cx));
        let header_row = div()
            .flex()
            .flex_wrap()
            .items_center()
            .justify_between()
            .gap(px(ROW_GAP))
            .child(
                div()
                    .flex()
                    .min_w_0()
                    .items_center()
                    .gap(px(ROW_GAP))
                    .child(
                        text(type_scale::SM, 16.)
                            .flex_none()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.foreground)
                            .child(model.apply_label.clone()),
                    )
                    .child(apply_trigger)
                    .children(menu),
            )
            .child(
                text(type_scale::XS, type_scale::XS_LINE)
                    .text_color(t.muted_foreground)
                    .child(model.unit_label.clone()),
            );
        let body: Vec<AnyElement> = match &model.empty_message {
            Some(message) => vec![
                text(type_scale::SM, type_scale::SM_LINE)
                    .text_color(t.muted_foreground)
                    .child(message.clone())
                    .into_any_element(),
            ],
            None => vec![
                self.prices_table(prices, t, window, cx),
                text(type_scale::XS, type_scale::XS_LINE)
                    .text_color(t.muted_foreground)
                    .child(model.table.footnote.clone())
                    .into_any_element(),
            ],
        };
        let statuses = model.save_statuses.as_ref().map(|statuses| {
            text(type_scale::XS, type_scale::XS_LINE)
                .flex()
                .flex_col()
                .gap(px(STATUS_GAP_Y))
                .children(statuses.iter().map(|status| {
                    div()
                        .flex()
                        .justify_between()
                        .gap(px(STATUS_GAP_X))
                        .child(
                            div()
                                .min_w_0()
                                .truncate()
                                .text_color(t.muted_foreground)
                                .child(status.label.clone()),
                        )
                        .child(
                            div()
                                .when(status.failed, |this| {
                                    this.text_color(t.destructive_foreground)
                                })
                                .when(!status.failed, |this| this.text_color(t.muted_foreground))
                                .child(status.status_label.clone()),
                        )
                }))
        });
        let discard = model.footer.discard_button.clone().map(|button| {
            let client = self.client.clone();
            Button::new("usage-prices-discard")
                .variant(ButtonVariant::Ghost)
                .label(button.label)
                .disabled(button.disabled)
                .on_click(move |_, _, cx| act(&client, cx, "usagePricesDiscard", json!({})))
        });
        let save_button = &model.footer.save_button;
        div()
            .on_key_down(move |event: &KeyDownEvent, _, cx| {
                if event.keystroke.key == "escape" {
                    cx.stop_propagation();
                    act(&escape, cx, "usagePricesClose", json!({}));
                }
            })
            .child(
                DialogPopup::new("usage-prices")
                    .max_width(DIALOG_WIDTH)
                    .on_close(move |_, cx| act(&close, cx, "usagePricesClose", json!({})))
                    .child(
                        DialogHeader::new()
                            .with_panel(true)
                            .child(DialogTitle::new(model.title.clone()))
                            .child(DialogDescription::new(model.description.clone())),
                    )
                    .child(
                        DialogPanel::new("usage-prices-panel")
                            .after_header(true)
                            .before_bare_footer(true)
                            .child(header_row)
                            .children(body)
                            .children(statuses),
                    )
                    .child(
                        DialogFooter::new()
                            .variant(DialogFooterVariant::Bare)
                            .child(
                                div()
                                    .flex()
                                    .flex_1()
                                    .min_w_0()
                                    .items_center()
                                    .justify_between()
                                    .gap(px(ROW_GAP))
                                    .child(
                                        text(type_scale::XS, type_scale::XS_LINE)
                                            .text_color(t.muted_foreground)
                                            .child(model.footer.destination_note.clone()),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .flex_wrap()
                                            .justify_end()
                                            .gap(px(ROW_GAP))
                                            .children(discard)
                                            .child(
                                                Button::new("usage-prices-save")
                                                    .label(save_button.label.clone())
                                                    .disabled(save_button.disabled)
                                                    .on_click(move |_, _, cx| {
                                                        act(
                                                            &client,
                                                            cx,
                                                            "usagePricesSave",
                                                            json!({}),
                                                        )
                                                    }),
                                            ),
                                    ),
                            ),
                    ),
            )
            .into_any_element()
    }

    fn prices_menu(
        &self,
        prices: &UsagePricesView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let selection = &prices.model.selection;
        let trigger = self
            .menu_bounds
            .borrow()
            .get("prices")
            .copied()
            .unwrap_or_default();
        let dismiss = cx.entity().downgrade();
        let all_client = self.client.clone();
        let all_checked = selection.all_selected;
        MenuPopup::new("usage-prices-menu", trigger)
            .align(Align::Start)
            .on_dismiss(move |_, cx| {
                let _ =
                    dismiss.update(cx, |page, cx| page.dismiss_menu(LocalMenu::PricesApply, cx));
            })
            .child(
                MenuCheckboxItem::new("usage-prices-all", selection.all_label.clone())
                    .checked(selection.all_selected)
                    .on_click(move |_, _, cx| {
                        act(
                            &all_client,
                            cx,
                            "usagePricesSelectAll",
                            json!({ "checked": !all_checked }),
                        );
                    }),
            )
            .child(MenuSeparator)
            .children(selection.options.iter().map(|option| {
                let client = self.client.clone();
                let environment_id = option.environment_id.clone();
                let checked = option.checked;
                MenuCheckboxItem::new(
                    SharedString::from(format!("usage-prices-{}", option.environment_id)),
                    option.label.clone(),
                )
                .checked(option.checked)
                .when_some(option.unavailable.clone(), |this, unavailable| {
                    this.status(unavailable, t.muted_foreground)
                })
                .on_click(move |_, _, cx| {
                    act(
                        &client,
                        cx,
                        "usagePricesToggleEnvironment",
                        json!({ "environmentId": environment_id, "checked": !checked }),
                    );
                })
            }))
            .into_any_element()
    }

    fn prices_table(
        &mut self,
        prices: &UsagePricesView,
        t: &Tokens,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let table = &prices.model.table;
        let add_client = self.client.clone();
        let header = div()
            .flex()
            .w_full()
            .h(px(HEADER_HEIGHT))
            .items_center()
            .border_b_1()
            .border_color(t.border)
            .font_weight(FontWeight::MEDIUM)
            .text_color(t.foreground)
            .child(
                div()
                    .w(relative(MODEL_SHARE))
                    .flex_none()
                    .px(px(CELL_PADDING))
                    .whitespace_nowrap()
                    .child(table.model_heading.clone()),
            )
            .children(table.field_headings.iter().map(|field| {
                div()
                    .flex_1()
                    .min_w_0()
                    .px(px(CELL_PADDING))
                    .whitespace_nowrap()
                    .child(field.label.clone())
            }))
            .child(
                div()
                    .flex()
                    .flex_none()
                    .w(px(ACTION_WIDTH))
                    .justify_center()
                    .child(
                        Button::new("usage-prices-add")
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::IconXs)
                            .icon("plus")
                            .disabled(table.add_button.disabled)
                            .accessibility_label(table.add_button.aria_label.clone())
                            .on_click(move |_, _, cx| {
                                act(&add_client, cx, "usagePricesAddRow", json!({}))
                            }),
                    ),
            );
        let rows: Vec<AnyElement> = if table.rows.is_empty() {
            vec![
                div()
                    .flex()
                    .w_full()
                    .justify_center()
                    .p(px(CELL_PADDING))
                    .child(
                        div()
                            .py(px(EMPTY_PADDING_Y))
                            .text_color(t.muted_foreground)
                            .child(table.empty_message.clone()),
                    )
                    .into_any_element(),
            ]
        } else {
            let count = table.rows.len();
            table
                .rows
                .iter()
                .enumerate()
                .map(|(index, row)| self.price_row(prices, row, index + 1 == count, t, window, cx))
                .collect()
        };
        div()
            .min_w_0()
            .overflow_hidden()
            .rounded(px(radius::LG))
            .border_1()
            .border_color(t.border)
            .child(
                text(type_scale::XS, type_scale::XS_LINE)
                    .flex()
                    .flex_col()
                    .w_full()
                    .child(header)
                    .children(rows),
            )
            .into_any_element()
    }

    fn price_row(
        &mut self,
        prices: &UsagePricesView,
        row: &UsagePriceRowView,
        last: bool,
        t: &Tokens,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let locked = prices.model.table.locked;
        let error = row.error.clone().map(|error| {
            text(type_scale::XS, type_scale::XS_LINE)
                .mt(px(ERROR_MARGIN))
                .text_color(t.destructive_foreground)
                .child(error)
        });
        let model_cell = if row.is_new {
            let row_id = row.id.clone();
            let state = self.price_input(
                format!("{}:model", row.id),
                "Model ID",
                &row.model,
                move |client, value, cx| {
                    act(
                        client,
                        cx,
                        "usagePricesModel",
                        json!({ "rowId": row_id, "value": value }),
                    );
                },
                window,
                cx,
            );
            if prices.focus_row_id.as_deref() == Some(row.id.as_str())
                && self.focused_new_row.as_deref() != Some(row.id.as_str())
            {
                self.focused_new_row = Some(row.id.clone());
                state.update(cx, |state, cx| state.focus(window, cx));
            }
            let focused = state.focus_handle(cx).is_focused(window);
            if focused {
                self.suggestion_row = Some(row.id.clone());
            } else if self.suggestion_row.as_deref() == Some(row.id.as_str()) {
                self.suggestion_row = None;
            }
            let suggestions = prices
                .suggestions
                .get(&row.id)
                .filter(|suggestions| focused && !suggestions.is_empty() && !locked)
                .cloned();
            let bounds = self.menu_bounds.clone();
            let bounds_key: &'static str = "suggestions";
            let anchor = self.menu_bounds.borrow().get(bounds_key).copied();
            let popup = suggestions.zip(anchor).map(|(suggestions, anchor)| {
                let row_id = row.id.clone();
                let client = self.client.clone();
                let input = state.clone();
                crate::ui::popover::positioned(
                    anchor,
                    crate::ui::popover::Side::Bottom,
                    Align::Start,
                    4.,
                    0.,
                    dropdown_glass(cx)
                        .id("usage-price-suggestions")
                        .occlude()
                        .min_w(anchor.size.width)
                        .child(
                            div()
                                .id("usage-price-suggestions-scroll")
                                .w_full()
                                .max_h(px(SUGGESTION_MAX_HEIGHT))
                                .overflow_y_scroll()
                                .p(px(SUGGESTION_PADDING))
                                .flex()
                                .flex_col()
                                .children(suggestions.into_iter().map(move |suggestion| {
                                    let client = client.clone();
                                    let row_id = row_id.clone();
                                    let input = input.clone();
                                    let value = suggestion.clone();
                                    MenuItem::new(SharedString::from(format!(
                                        "usage-price-suggestion-{suggestion}"
                                    )))
                                    .label(suggestion)
                                    .on_click(
                                        move |_, window, cx| {
                                            let value = value.clone();
                                            input.update(cx, |state, cx| {
                                                state.set_value(value.clone(), window, cx)
                                            });
                                            act(
                                                &client,
                                                cx,
                                                "usagePricesModel",
                                                json!({ "rowId": row_id, "value": value }),
                                            );
                                        },
                                    )
                                })),
                        )
                        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation()),
                )
                .into_any_element()
            });
            div()
                .relative()
                .child(
                    div()
                        .relative()
                        .child(
                            Input::new(&state)
                                .size(InputSize::Compact)
                                .invalid(row.model_invalid)
                                .disabled(locked),
                        )
                        .child(
                            canvas(
                                move |trigger, _, _| {
                                    if focused {
                                        bounds.borrow_mut().insert(bounds_key, trigger);
                                    }
                                },
                                |_, _, _, _| {},
                            )
                            .absolute()
                            .inset_0()
                            .size_full(),
                        ),
                )
                .children(popup)
                .children(error)
                .into_any_element()
        } else {
            div()
                .child(
                    div()
                        .when(row.removed, |this| {
                            this.text_color(t.muted_foreground).line_through()
                        })
                        .child(row.model.clone()),
                )
                .children(error)
                .into_any_element()
        };
        let cells: Vec<AnyElement> = match &row.removed_message {
            Some(message) => vec![
                div()
                    .flex_1()
                    .min_w_0()
                    .p(px(CELL_PADDING))
                    .text_color(t.muted_foreground)
                    .child(message.clone())
                    .into_any_element(),
            ],
            None => row
                .cells
                .iter()
                .map(|cell| {
                    let row_id = row.id.clone();
                    let field = cell.field.clone();
                    let state = self.price_input(
                        format!("{}:{}", row.id, cell.field),
                        &cell.placeholder,
                        &cell.value,
                        move |client, value, cx| {
                            act(
                                client,
                                cx,
                                "usagePricesCell",
                                json!({ "rowId": row_id, "field": field, "value": value }),
                            );
                        },
                        window,
                        cx,
                    );
                    div()
                        .flex_1()
                        .min_w_0()
                        .p(px(CELL_PADDING))
                        .child(
                            Input::new(&state)
                                .size(InputSize::Compact)
                                .font(InputFont::Mono)
                                .disabled(locked),
                        )
                        .into_any_element()
                })
                .collect(),
        };
        let action_client = self.client.clone();
        let action_row = row.id.clone();
        div()
            .id(SharedString::from(format!("usage-price-row-{}", row.id)))
            .flex()
            .w_full()
            .items_center()
            .when(!last, |this| this.border_b_1().border_color(t.border))
            .hover(|style| style.bg(fade(t.muted, 0.5)))
            .child(
                div()
                    .flex_none()
                    .w(relative(MODEL_SHARE))
                    .min_w_0()
                    .p(px(CELL_PADDING))
                    .child(model_cell),
            )
            .children(cells)
            .child(
                div()
                    .id(SharedString::from(format!("usage-price-action-{}", row.id)))
                    .flex()
                    .flex_none()
                    .w(px(ACTION_WIDTH))
                    .justify_center()
                    .tooltip(Tooltip::text(row.action.tooltip.clone()))
                    .child(
                        Button::new(SharedString::from(format!(
                            "usage-price-action-button-{}",
                            row.id
                        )))
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::IconXs)
                        .icon(if row.action.icon == "remove" {
                            "x"
                        } else {
                            "rotate-ccw"
                        })
                        .disabled(locked)
                        .on_click(move |_, _, cx| {
                            act(
                                &action_client,
                                cx,
                                "usagePricesRowAction",
                                json!({ "rowId": action_row }),
                            );
                        }),
                    ),
            )
            .into_any_element()
    }
}
