use gpui::component::input::{InputEvent, InputState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, Bounds, ClickEvent, Context, Corners, Entity, FontWeight, Global,
    InteractiveElement, IntoElement, KeyDownEvent, ParentElement, Pixels, Render, SharedString,
    StatefulInteractiveElement, Styled, Window, anchored, canvas, deferred, div, point, px,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::thread_header::{
    CustomSnoozeCalendarDay, CustomSnoozeMode, CustomSnoozeView,
};
use crate::features::chat::toolbar_parts::act;
use crate::ui::button::{Button, ButtonVariant, rounded};
use crate::ui::dialog::{
    DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle,
};
use crate::ui::input::{Input, decorate, field_look};
use crate::ui::label::Label;
use crate::ui::menu::icon;
use crate::ui::number_field::NumberField;
use crate::ui::popover::{
    Align, DROPDOWN_LAYER, PopoverPadding, PopoverPopup, Side, dropdown_glass, dropdown_shadow,
    top_highlight,
};
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::toggle::Toggle;
use crate::ui::toggle_group::ToggleGroup;

const DIALOG_WIDTH: f32 = 384.;
const COLUMN_GAP: f32 = 12.;
const DATE_LABEL_GAP: f32 = 6.;
const FIELD_LABEL_GAP: f32 = 8.;
const DATE_ICON: f32 = 16.;
const CALENDAR_PADDING: f32 = 8.;
const CELL: f32 = 36.;
const DAY_ROW: f32 = 38.;
const CAPTION_GAP: f32 = 4.;
const NAV_ICON: f32 = 16.;
const NAV_ICON_OPACITY: f32 = 0.8;
const MUTED_TEXT_ALPHA: f32 = 0.72;
const DISABLED_DAY_OPACITY: f32 = 0.64;
const TODAY_DOT: f32 = 3.;
const TODAY_DOT_BOTTOM: f32 = 4.;
const DISABLED_DOT_ALPHA: f32 = 0.3;
const SELECT_HEIGHT: f32 = 32.;
const SELECT_PADDING_X: f32 = 11.;
const SELECT_CHEVRON: f32 = 12.;
const SELECT_CHEVRON_OPACITY: f32 = 0.5;
const LISTBOX_PADDING: f32 = 4.;
const OPTION_HEIGHT: f32 = 28.;
const OPTION_PADDING_X: f32 = 8.;
const OPTION_WIDTH_EXTRA: f32 = 20.;
const OPTION_HIGHLIGHT_ALPHA: f32 = 0.08;

struct CustomSnoozeHandle(Entity<CustomSnoozeHost>);

impl Global for CustomSnoozeHandle {}

/// The web's custom snooze dialog, driven by the core `customSnooze` view.
pub struct CustomSnoozeHost {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<CustomSnoozeView>>>,
    time: Entity<InputState>,
    amount: Entity<InputState>,
    request_key: u64,
    sent_time: String,
    sent_amount: String,
    calendar_open: bool,
    date_trigger: Bounds<Pixels>,
    unit_open: bool,
    unit_trigger: Bounds<Pixels>,
}

impl CustomSnoozeHost {
    pub fn install(client: &Entity<CoreClient>, window: &mut Window, cx: &mut App) {
        if cx.has_global::<CustomSnoozeHandle>() {
            return;
        }
        let host = cx.new(|cx| Self::new(client.clone(), window, cx));
        cx.set_global(CustomSnoozeHandle(host));
    }

    pub fn global(cx: &App) -> Option<Entity<CustomSnoozeHost>> {
        cx.try_global::<CustomSnoozeHandle>()
            .map(|handle| handle.0.clone())
    }

    fn new(client: Entity<CoreClient>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<CustomSnoozeView>>(
            &client,
            "customSnooze",
            json!({}),
            cx,
        );
        let time = cx.new(|cx| InputState::new(window, cx));
        let amount = cx.new(|cx| InputState::new(window, cx));
        cx.observe(&time, |host, time, cx| {
            let value = time.read(cx).value().to_string();
            if value != host.sent_time {
                host.sent_time = value.clone();
                act(
                    &host.client,
                    cx,
                    "customSnoozeUpdate",
                    json!({ "time": value }),
                );
            }
        })
        .detach();
        cx.observe(&amount, |host, amount, cx| {
            let value = amount.read(cx).value().to_string();
            if value != host.sent_amount {
                host.sent_amount = value.clone();
                act(
                    &host.client,
                    cx,
                    "customSnoozeUpdate",
                    json!({ "amount": value }),
                );
            }
        })
        .detach();
        for state in [&time, &amount] {
            cx.subscribe(state, |host, _, event: &InputEvent, cx| {
                if let InputEvent::PressEnter { .. } = event {
                    act(&host.client, cx, "customSnoozeSubmit", json!({}));
                }
            })
            .detach();
        }
        cx.observe_in(&view, window, |host, _, window, cx| host.sync(window, cx))
            .detach();
        Self {
            client,
            view,
            time,
            amount,
            request_key: 0,
            sent_time: String::new(),
            sent_amount: String::new(),
            calendar_open: false,
            date_trigger: Bounds::default(),
            unit_open: false,
            unit_trigger: Bounds::default(),
        }
    }

    fn data(&self, cx: &App) -> Option<CustomSnoozeView> {
        self.view.read(cx).data.clone().flatten()
    }

    fn sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(view) = self.data(cx) else {
            self.request_key = 0;
            self.calendar_open = false;
            self.unit_open = false;
            cx.notify();
            return;
        };
        if view.request_key != self.request_key {
            self.request_key = view.request_key;
            self.calendar_open = false;
            self.unit_open = false;
            self.sent_time = view.time.clone();
            self.sent_amount = view.amount.clone();
            self.time.update(cx, |state, cx| {
                state.set_value(view.time.clone(), window, cx)
            });
            self.amount.update(cx, |state, cx| {
                state.set_value(view.amount.clone(), window, cx)
            });
        }
        cx.notify();
    }

    fn update(host: &Entity<Self>, cx: &mut App, params: Value) {
        let client = host.read(cx).client.clone();
        act(&client, cx, "customSnoozeUpdate", params);
    }

    fn send(
        host: &Entity<Self>,
        action: &'static str,
        params: Value,
    ) -> impl Fn(&ClickEvent, &mut Window, &mut App) + 'static {
        let host = host.clone();
        move |_, _, cx| {
            let client = host.read(cx).client.clone();
            act(&client, cx, action, params.clone());
        }
    }

    fn set_calendar(host: &Entity<Self>, open: bool, cx: &mut App) {
        host.update(cx, |host, cx| {
            host.calendar_open = open;
            if open {
                act(
                    &host.client,
                    cx,
                    "customSnoozeCalendarMonth",
                    json!({ "delta": 0 }),
                );
            }
            cx.notify();
        });
    }

    fn date_field(
        host: &Entity<Self>,
        view: &CustomSnoozeView,
        t: &Tokens,
        cx: &mut App,
    ) -> AnyElement {
        let open = host.read(cx).calendar_open;
        let toggle = host.clone();
        let measure = host.clone();
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .gap(px(DATE_LABEL_GAP))
            .child(Label::new("Date"))
            .child(
                div()
                    .relative()
                    .w_full()
                    .child(
                        Button::new("custom-snooze-date")
                            .variant(ButtonVariant::Outline)
                            .w_full()
                            .justify_between()
                            .label(view.date_label.clone())
                            .icon_end("calendar")
                            .icon_size(DATE_ICON)
                            .icon_color(t.muted_foreground)
                            .on_click(move |_, _, cx| Self::set_calendar(&toggle, !open, cx)),
                    )
                    .child(
                        canvas(
                            move |bounds, _, cx| {
                                measure.update(cx, |host, _| host.date_trigger = bounds);
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full(),
                    ),
            )
            .into_any_element()
    }

    fn day_cell(host: &Entity<Self>, day: &CustomSnoozeCalendarDay, t: &Tokens) -> AnyElement {
        let muted = fade(t.muted_foreground, MUTED_TEXT_ALPHA);
        let color = if day.selected {
            t.primary_foreground
        } else if day.disabled || day.outside {
            muted
        } else {
            t.foreground
        };
        let dot = if day.selected {
            t.background
        } else if day.disabled {
            fade(t.foreground, DISABLED_DOT_ALPHA)
        } else {
            t.primary
        };
        let accent = t.accent;
        let pick = host.clone();
        let date = day.date.clone();
        let button = div()
            .id(SharedString::from(format!(
                "custom-snooze-day-{}",
                day.date
            )))
            .relative()
            .flex()
            .items_center()
            .justify_center()
            .size(px(CELL))
            .rounded(px(radius::LG))
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .text_color(color)
            .when(day.selected, |b| b.bg(t.primary))
            .when(day.disabled, |b| {
                b.opacity(DISABLED_DAY_OPACITY).line_through()
            })
            .when(!day.disabled, |b| {
                b.cursor_pointer()
                    .when(!day.selected, |b| b.hover(move |s| s.bg(accent)))
                    .on_click(move |_, _, cx| {
                        pick.update(cx, |host, cx| {
                            host.calendar_open = false;
                            act(
                                &host.client,
                                cx,
                                "customSnoozeUpdate",
                                json!({ "date": date }),
                            );
                            cx.notify();
                        })
                    })
            })
            .child(SharedString::from(day.day.to_string()))
            .when(day.today, |b| {
                b.child(
                    div()
                        .absolute()
                        .bottom(px(TODAY_DOT_BOTTOM))
                        .left(px((CELL - TODAY_DOT) / 2.))
                        .size(px(TODAY_DOT))
                        .rounded_full()
                        .bg(dot),
                )
            });
        div()
            .flex()
            .flex_none()
            .items_center()
            .size(px(CELL))
            .h(px(DAY_ROW))
            .child(button)
            .into_any_element()
    }

    fn calendar(host: &Entity<Self>, view: &CustomSnoozeView, t: &Tokens) -> AnyElement {
        let calendar = &view.calendar;
        let nav = |id: &'static str, glyph: &'static str, delta: i32| {
            let accent = t.accent;
            div()
                .id(id)
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(CELL))
                .rounded(px(radius::LG))
                .cursor_pointer()
                .hover(move |s| s.bg(accent))
                .on_click(Self::send(
                    host,
                    "customSnoozeCalendarMonth",
                    json!({ "delta": delta }),
                ))
                .child(icon(glyph, NAV_ICON, t.foreground).opacity(NAV_ICON_OPACITY))
        };
        let weekdays = calendar.weekdays.iter().map(|weekday| {
            div()
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(CELL))
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .font_weight(FontWeight::MEDIUM)
                .text_color(fade(t.muted_foreground, MUTED_TEXT_ALPHA))
                .child(SharedString::from(weekday.clone()))
        });
        div()
            .flex()
            .flex_col()
            .p(px(CALENDAR_PADDING))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .h(px(CELL))
                    .mb(px(CAPTION_GAP))
                    .child(nav("custom-snooze-prev-month", "chevron-left", -1))
                    .child(
                        div()
                            .text_size(px(text::SM))
                            .line_height(px(text::SM_LINE))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.foreground)
                            .child(SharedString::from(calendar.caption.clone())),
                    )
                    .child(nav("custom-snooze-next-month", "chevron-right", 1)),
            )
            .child(div().flex().children(weekdays))
            .children(calendar.weeks.iter().map(|week| {
                div()
                    .flex()
                    .children(week.iter().map(|day| Self::day_cell(host, day, t)))
            }))
            .into_any_element()
    }

    fn fields(
        host: &Entity<Self>,
        view: &CustomSnoozeView,
        t: &Tokens,
        cx: &mut App,
    ) -> AnyElement {
        let (time, amount) = {
            let this = host.read(cx);
            (this.time.clone(), this.amount.clone())
        };
        let row = div().flex().w_full().gap(px(COLUMN_GAP));
        match view.mode {
            CustomSnoozeMode::Date => row
                .child(Self::date_field(host, view, t, cx))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .gap(px(FIELD_LABEL_GAP))
                        .child(Label::new("Time"))
                        .child(Input::new(&time).font_weight(FontWeight::MEDIUM)),
                )
                .into_any_element(),
            CustomSnoozeMode::Duration => row
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .gap(px(FIELD_LABEL_GAP))
                        .child(Label::new("Snooze for"))
                        .child(NumberField::new("custom-snooze-amount", &amount).min(0.)),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .gap(px(FIELD_LABEL_GAP))
                        .child(Label::new("Unit"))
                        .child(Self::unit_trigger(host, view, t, cx)),
                )
                .into_any_element(),
        }
    }

    fn unit_trigger(
        host: &Entity<Self>,
        view: &CustomSnoozeView,
        t: &Tokens,
        cx: &mut App,
    ) -> AnyElement {
        let open = host.read(cx).unit_open;
        let look = field_look(t, open, false, false);
        let corners = Corners::all(px(radius::LG));
        let toggle = host.clone();
        let measure = host.clone();
        let accent = t.accent;
        let trigger = div()
            .id("custom-snooze-unit")
            .relative()
            .flex()
            .items_center()
            .gap(px(8.))
            .w_full()
            .h(px(SELECT_HEIGHT))
            .px(px(SELECT_PADDING_X))
            .border_1()
            .border_color(look.border)
            .bg(look.bg)
            .shadow(look.shadows.clone())
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .font_weight(FontWeight::MEDIUM)
            .text_color(t.foreground)
            .cursor_pointer()
            .hover(move |s| s.bg(fade(accent, 0.5)))
            .on_click(move |_, _, cx| {
                toggle.update(cx, |host, cx| {
                    host.unit_open = !host.unit_open;
                    cx.notify();
                })
            })
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .child(SharedString::from(view.unit_label.clone())),
            )
            .child(
                icon("chevron-down", SELECT_CHEVRON, t.muted_foreground)
                    .flex_none()
                    .opacity(SELECT_CHEVRON_OPACITY),
            )
            .child(
                canvas(
                    move |bounds, _, cx| {
                        measure.update(cx, |host, _| host.unit_trigger = bounds);
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            );
        decorate(rounded(trigger, corners), t, &look, corners).into_any_element()
    }

    /// Base UI's select aligns the chosen option over the trigger.
    fn unit_listbox(
        host: &Entity<Self>,
        view: &CustomSnoozeView,
        t: &Tokens,
        trigger: Bounds<Pixels>,
        cx: &App,
    ) -> AnyElement {
        let selected = view
            .units
            .iter()
            .position(|unit| unit.value == view.unit)
            .unwrap_or(0) as f32;
        let top = f32::from(trigger.top()) - 1. - LISTBOX_PADDING - selected * OPTION_HEIGHT
            + (SELECT_HEIGHT - OPTION_HEIGHT) / 2.;
        let left = f32::from(trigger.left()) - 1.;
        let width = f32::from(trigger.size.width) + OPTION_WIDTH_EXTRA + 2. * LISTBOX_PADDING + 2.;
        let highlight = fade(t.foreground, OPTION_HIGHLIGHT_ALPHA);
        let dismiss = host.clone();
        let options = view.units.iter().map(|unit| {
            let pick = host.clone();
            let value = unit.value.clone();
            div()
                .id(SharedString::from(format!(
                    "custom-snooze-unit-{}",
                    unit.value
                )))
                .flex()
                .items_center()
                .h(px(OPTION_HEIGHT))
                .px(px(OPTION_PADDING_X))
                .rounded(px(radius::SM))
                .text_size(px(text::SM))
                .line_height(px(text::SM_LINE))
                .text_color(t.foreground)
                .cursor_pointer()
                .hover(move |s| s.bg(highlight))
                .on_click(move |_, _, cx| {
                    pick.update(cx, |host, cx| {
                        host.unit_open = false;
                        act(
                            &host.client,
                            cx,
                            "customSnoozeUpdate",
                            json!({ "unit": value }),
                        );
                        cx.notify();
                    })
                })
                .child(SharedString::from(unit.label.clone()))
        });
        deferred(
            anchored().position(point(px(left), px(top))).child(
                dropdown_glass(cx)
                    .occlude()
                    .shadow(
                        dropdown_shadow(t)
                            .into_iter()
                            .chain(std::iter::once(top_highlight(t)))
                            .collect::<Vec<_>>(),
                    )
                    .w(px(width))
                    .on_mouse_down_out(move |_, _, cx| {
                        dismiss.update(cx, |host, cx| {
                            host.unit_open = false;
                            cx.notify();
                        })
                    })
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .p(px(LISTBOX_PADDING))
                            .children(options),
                    ),
            ),
        )
        .with_priority(DROPDOWN_LAYER)
        .into_any_element()
    }
}

impl Render for CustomSnoozeHost {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.data(cx) else {
            return div().into_any_element();
        };
        let t = theme::active(cx);
        let host = cx.entity();
        let mode = view.mode;
        let toggle = |id: &'static str, label: &'static str, value: CustomSnoozeMode| {
            let host = host.clone();
            Toggle::new(id)
                .label(label)
                .pressed(mode == value)
                .flex_1()
                .on_change(move |_, _, _, cx| {
                    let mode = match value {
                        CustomSnoozeMode::Date => "date",
                        CustomSnoozeMode::Duration => "duration",
                    };
                    Self::update(&host, cx, json!({ "mode": mode }));
                })
        };
        let cancel = host.clone();
        let escape = host.clone();
        let calendar_open = self.calendar_open;
        let dialog = DialogPopup::new("custom-snooze")
            .max_width(DIALOG_WIDTH)
            .on_close(move |_, cx| {
                let client = cancel.read(cx).client.clone();
                act(&client, cx, "customSnoozeCancel", json!({}));
            })
            .child(
                div()
                    .flex()
                    .flex_col()
                    .min_h_0()
                    .on_key_down(move |event: &KeyDownEvent, _, cx| {
                        if event.keystroke.key == "escape" {
                            cx.stop_propagation();
                            let calendar_open = escape.read(cx).calendar_open;
                            if calendar_open {
                                Self::set_calendar(&escape, false, cx);
                            } else {
                                let client = escape.read(cx).client.clone();
                                act(&client, cx, "customSnoozeCancel", json!({}));
                            }
                        }
                    })
                    .child(
                        DialogHeader::new()
                            .with_panel(true)
                            .child(DialogTitle::new("Custom snooze"))
                            .child(DialogDescription::new(
                                "Choose when snoozed threads return to your inbox.",
                            )),
                    )
                    .child(
                        DialogPanel::new("custom-snooze-panel")
                            .after_header(true)
                            .child(
                                ToggleGroup::new("custom-snooze-mode")
                                    .w_full()
                                    .item(toggle(
                                        "custom-snooze-mode-date",
                                        "Date and time",
                                        CustomSnoozeMode::Date,
                                    ))
                                    .item(toggle(
                                        "custom-snooze-mode-duration",
                                        "Duration",
                                        CustomSnoozeMode::Duration,
                                    )),
                            )
                            .child(Self::fields(&host, &view, &t, cx))
                            .when_some(view.error.clone(), |panel, error| {
                                panel.child(
                                    div()
                                        .text_size(px(text::BASE))
                                        .line_height(px(text::BASE_LINE))
                                        .text_color(t.destructive)
                                        .child(SharedString::from(error)),
                                )
                            }),
                    )
                    .child(
                        DialogFooter::new()
                            .child(
                                Button::new("custom-snooze-cancel")
                                    .variant(ButtonVariant::Outline)
                                    .label("Cancel")
                                    .on_click(Self::send(&host, "customSnoozeCancel", json!({}))),
                            )
                            .child(
                                Button::new("custom-snooze-submit")
                                    .label("Snooze")
                                    .on_click(Self::send(&host, "customSnoozeSubmit", json!({}))),
                            ),
                    ),
            );
        let dismiss = host.clone();
        div()
            .child(dialog)
            .when(calendar_open && mode == CustomSnoozeMode::Date, |root| {
                root.child(
                    PopoverPopup::new("custom-snooze-calendar", self.date_trigger)
                        .side(Side::Bottom)
                        .align(Align::Start)
                        .padding(PopoverPadding::None)
                        .on_dismiss(move |_, cx| Self::set_calendar(&dismiss, false, cx))
                        .child(Self::calendar(&host, &view, &t)),
                )
            })
            .when(
                self.unit_open && mode == CustomSnoozeMode::Duration,
                |root| root.child(Self::unit_listbox(&host, &view, &t, self.unit_trigger, cx)),
            )
            .into_any_element()
    }
}
