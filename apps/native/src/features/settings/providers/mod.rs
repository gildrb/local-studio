pub mod accent;
pub mod card;
pub mod codex;
pub mod dialogs;
pub mod models;
pub mod setup;

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use gpui::component::input::{InputEvent, InputState, TextareaState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, Bounds, ClickEvent, Context, Entity, Focusable,
    InteractiveElement, IntoElement, ParentElement, Pixels, Render, SharedString,
    StatefulInteractiveElement, Styled, Window, canvas, div, px,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::settings_providers::{
    ExpandableTextView, HealthIntervalView, LastCheckedView, ProviderPlaceholderView,
    ProviderUsageView, ProvidersSettingsBody, SettingsProvidersView,
};
use crate::features::settings::primitives::{
    PolicyTooltip, SettingResetButton, SettingsGroup, SettingsGroupVariant, SettingsRow,
    SettingsSection, group_surface, settings_stack, settings_switch,
};
use crate::features::sidebar::machine_icon;
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::empty::{Empty, EmptyMedia};
use crate::ui::number_field::{NumberField, NumberFieldSize};
use crate::ui::theme;
use crate::ui::theme::metrics::text;
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const CHANGE: &str = "settingsProvidersChange";
const CARD_WIDE_MIN: f32 = 768.;
const CARD_MAX_HEIGHT: f32 = 704.;
const CARD_MIN_HEIGHT: f32 = 512.;
const CARD_VIEWPORT_INSET: f32 = 176.;
const LIST_WIDTH: f32 = 272.;
const EDITOR_PADDING: f32 = 16.;
const EDITOR_GAP: f32 = 24.;
const EMPTY_PADDING: f32 = 24.;
const HEADER_GAP: f32 = 8.;
const HEALTH_FIELD_WIDTH: f32 = 128.;
const HEALTH_UNIT_GAP: f32 = 8.;
const MESSAGE_PADDING: f32 = 32.;
const ERROR_TOGGLE_GAP: f32 = 4.;
const MAX_EMPTY_CONTENT: f32 = 576.;

pub(super) type ValueHandler = Rc<dyn Fn(String, &mut App)>;
pub(super) type UnitHandler = Rc<dyn Fn(&mut App)>;

pub(super) fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

pub(super) fn click(
    client: &Entity<CoreClient>,
    action: &'static str,
    params: Value,
) -> impl Fn(&ClickEvent, &mut Window, &mut App) + 'static {
    let client = client.clone();
    move |_, _, cx| act(&client, cx, action, params.clone())
}

pub(super) fn change_click(
    client: &Entity<CoreClient>,
    change: Value,
) -> impl Fn(&ClickEvent, &mut Window, &mut App) + 'static {
    click(client, CHANGE, json!({ "change": change }))
}

pub(super) fn send_change(client: &Entity<CoreClient>, cx: &mut App, change: Value) {
    act(client, cx, CHANGE, json!({ "change": change }));
}

pub(super) fn value_handler(
    client: &Entity<CoreClient>,
    build: impl Fn(String) -> (&'static str, Value) + 'static,
) -> ValueHandler {
    let client = client.clone();
    Rc::new(move |value, cx| {
        let (action, params) = build(value);
        act(&client, cx, action, params);
    })
}

pub(super) fn tip(
    id: impl Into<SharedString>,
    text: impl Into<SharedString>,
    child: impl IntoElement,
) -> AnyElement {
    let text: SharedString = text.into();
    div()
        .id(gpui::ElementId::Name(id.into()))
        .flex()
        .flex_none()
        .tooltip(Tooltip::text(text))
        .child(child)
        .into_any_element()
}

pub(super) fn muted(label: impl Into<SharedString>, t: &Tokens) -> gpui::Div {
    div()
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .text_color(t.muted_foreground)
        .child(label.into())
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum InputMode {
    Live,
    Draft,
}

pub(super) struct InputSpec {
    pub key: String,
    pub value: String,
    pub placeholder: String,
    pub masked: bool,
    pub mode: InputMode,
    pub on_value: ValueHandler,
    pub on_enter: Option<UnitHandler>,
    pub on_blur: Option<UnitHandler>,
}

struct InputEntry {
    state: Entity<InputState>,
    shown: Rc<RefCell<String>>,
}

struct TextareaEntry {
    state: Entity<TextareaState>,
    shown: Rc<RefCell<String>>,
}

pub struct ProvidersSection {
    pub(super) client: Entity<CoreClient>,
    view: Entity<ViewState<Option<SettingsProvidersView>>>,
    inputs: HashMap<String, InputEntry>,
    textareas: HashMap<String, TextareaEntry>,
    touched: HashSet<String>,
    card_width: f32,
    pub(super) accent_bounds: HashMap<String, Bounds<Pixels>>,
    focus_marks: HashSet<String>,
    focus_seen: HashSet<String>,
    pub(super) accent_drag: Option<accent::AccentDrag>,
}

impl ProvidersSection {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<SettingsProvidersView>>(
            &client,
            "settingsProviders",
            json!({}),
            cx,
        );
        cx.observe(&view, |_, _, cx| cx.notify()).detach();
        if let Some(host) = crate::features::onboarding::codex_setup::CodexSetupHost::global(cx) {
            cx.observe(&host, |_, _, cx| cx.notify()).detach();
        }
        act(&client, cx, "settingsProvidersMount", json!({}));
        Self {
            client,
            view,
            inputs: HashMap::new(),
            textareas: HashMap::new(),
            touched: HashSet::new(),
            card_width: CARD_WIDE_MIN,
            accent_bounds: HashMap::new(),
            focus_marks: HashSet::new(),
            focus_seen: HashSet::new(),
            accent_drag: None,
        }
    }

    pub(super) fn input(
        &mut self,
        spec: InputSpec,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<InputState> {
        self.touched.insert(spec.key.clone());
        if let Some(entry) = self.inputs.get(&spec.key) {
            let state = entry.state.clone();
            let shown = entry.shown.clone();
            let focused = state.read(cx).focus_handle(cx).is_focused(window);
            if !focused && *shown.borrow() != spec.value {
                *shown.borrow_mut() = spec.value.clone();
                let value = spec.value.clone();
                state.update(cx, |state, cx| state.set_value(value, window, cx));
            }
            let placeholder = spec.placeholder.clone();
            state.update(cx, |state, cx| {
                state.set_placeholder(placeholder, window, cx)
            });
            return state;
        }
        let initial = spec.value.clone();
        let placeholder = spec.placeholder.clone();
        let masked = spec.masked;
        let state = cx.new(|cx| {
            let mut state = InputState::new(window, cx).placeholder(placeholder);
            state.set_value(initial, window, cx);
            if masked {
                state.set_masked(true, window, cx);
            }
            state
        });
        let shown = Rc::new(RefCell::new(spec.value.clone()));
        let handler_shown = shown.clone();
        let on_value = spec.on_value.clone();
        let on_enter = spec.on_enter.clone();
        let on_blur = spec.on_blur.clone();
        let mode = spec.mode;
        cx.subscribe_in(
            &state,
            window,
            move |_, state: &Entity<InputState>, event: &InputEvent, window, cx| match event {
                InputEvent::Change if mode == InputMode::Live => {
                    let value = state.read(cx).value().to_string();
                    if *handler_shown.borrow() == value {
                        return;
                    }
                    *handler_shown.borrow_mut() = value.clone();
                    on_value(value, cx);
                }
                InputEvent::PressEnter { .. } => match (&on_enter, mode) {
                    (Some(on_enter), _) => on_enter(cx),
                    (None, InputMode::Draft) => window.blur(cx),
                    (None, InputMode::Live) => {}
                },
                InputEvent::Blur => {
                    if mode == InputMode::Draft {
                        let value = state.read(cx).value().to_string();
                        if *handler_shown.borrow() != value {
                            *handler_shown.borrow_mut() = value.clone();
                            on_value(value, cx);
                        }
                    }
                    if let Some(on_blur) = &on_blur {
                        on_blur(cx);
                    }
                }
                _ => {}
            },
        )
        .detach();
        self.inputs.insert(
            spec.key,
            InputEntry {
                state: state.clone(),
                shown,
            },
        );
        state
    }

    pub(super) fn textarea(
        &mut self,
        key: String,
        value: &str,
        placeholder: &str,
        on_value: ValueHandler,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<TextareaState> {
        self.touched.insert(key.clone());
        if let Some(entry) = self.textareas.get(&key) {
            let state = entry.state.clone();
            let focused = state.read(cx).focus_handle(cx).is_focused(window);
            if !focused && *entry.shown.borrow() != value {
                *entry.shown.borrow_mut() = value.to_string();
                let value = value.to_string();
                state.update(cx, |state, cx| state.set_value(value, window, cx));
            }
            return state;
        }
        let initial = value.to_string();
        let placeholder = placeholder.to_string();
        let state = cx.new(|cx| {
            let mut state = TextareaState::new(window, cx).auto_grow(3, 12);
            state.set_value(initial, window, cx);
            state.set_placeholder(placeholder, window, cx);
            state
        });
        let shown = Rc::new(RefCell::new(value.to_string()));
        let handler_shown = shown.clone();
        cx.subscribe_in(
            &state,
            window,
            move |_, state: &Entity<TextareaState>, event: &InputEvent, _, cx| {
                if let InputEvent::Change = event {
                    let value = state.read(cx).value().to_string();
                    if *handler_shown.borrow() == value {
                        return;
                    }
                    *handler_shown.borrow_mut() = value.clone();
                    on_value(value, cx);
                }
            },
        )
        .detach();
        self.textareas.insert(
            key,
            TextareaEntry {
                state: state.clone(),
                shown,
            },
        );
        state
    }

    pub(super) fn focus_input_once(
        &mut self,
        marker: String,
        state: &Entity<InputState>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.focus_seen.insert(marker.clone());
        if self.focus_marks.insert(marker) {
            state.update(cx, |state, cx| state.focus(window, cx));
        }
    }

    fn header_action(&self, body: &ProvidersSettingsBody, t: &Tokens) -> AnyElement {
        let client = &self.client;
        let update_all = body.update_all.as_ref().map(|update| {
            tip(
                "providers-update-all-tip",
                update.tooltip_lines.join("\n"),
                Button::new("providers-update-all")
                    .size(ButtonSize::Xs)
                    .variant(ButtonVariant::GhostMuted)
                    .label(update.label.clone())
                    .disabled(update.disabled)
                    .on_click(change_click(client, json!({ "kind": "update-all" }))),
            )
        });
        let checked = last_checked(&body.last_checked, t);
        let trailing = match &body.refresh_action {
            None => div()
                .min_w_0()
                .truncate()
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .text_color(t.muted_foreground)
                .children(checked)
                .into_any_element(),
            Some(refresh) => {
                let label: AnyElement = match &refresh.busy_text {
                    Some(busy) => div().child(busy.clone()).into_any_element(),
                    None => div().children(checked).into_any_element(),
                };
                div()
                    .flex()
                    .items_center()
                    .gap(px(HEADER_GAP))
                    .child(tip(
                        "providers-refresh-tip",
                        refresh.label.clone(),
                        Button::new("providers-refresh")
                            .size(ButtonSize::Xs)
                            .variant(ButtonVariant::GhostMuted)
                            .icon(if refresh.busy {
                                "loader-circle"
                            } else {
                                "refresh-cw"
                            })
                            .disabled(refresh.disabled)
                            .accessibility_label(refresh.label.clone())
                            .on_click(change_click(client, json!({ "kind": "refresh" })))
                            .child(div().min_w_0().truncate().child(label)),
                    ))
                    .children(body.add_action.as_ref().map(|add| {
                        tip(
                            "providers-add-tip",
                            add.label.clone(),
                            Button::new("providers-add")
                                .size(ButtonSize::IconXs)
                                .variant(ButtonVariant::GhostMuted)
                                .icon("plus")
                                .accessibility_label(add.label.clone())
                                .on_click(change_click(client, json!({ "kind": "add-instance" }))),
                        )
                    }))
                    .into_any_element()
            }
        };
        div()
            .flex()
            .min_w_0()
            .items_center()
            .gap(px(HEADER_GAP))
            .children(update_all)
            .child(trailing)
            .into_any_element()
    }

    fn card_height(&self, window: &Window) -> Option<f32> {
        if self.card_width < CARD_WIDE_MIN {
            return None;
        }
        let viewport = f32::from(window.viewport_size().height);
        Some((viewport - CARD_VIEWPORT_INSET).clamp(CARD_MIN_HEIGHT, CARD_MAX_HEIGHT))
    }

    fn width_probe(&self, cx: &mut Context<Self>) -> AnyElement {
        let entity = cx.entity().downgrade();
        canvas(
            move |bounds, _, cx| {
                let width = f32::from(bounds.size.width);
                if let Some(entity) = entity.upgrade() {
                    entity.update(cx, |section, cx| {
                        if (section.card_width - width).abs() > 0.5 {
                            section.card_width = width;
                            cx.notify();
                        }
                    });
                }
            },
            |_, _, _, _| {},
        )
        .absolute()
        .top_0()
        .left_0()
        .size_full()
        .into_any_element()
    }

    fn placeholder_card(
        &self,
        placeholder: &ProviderPlaceholderView,
        error: Option<&ExpandableTextView>,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = theme::active(cx);
        let error = error.map(|error| {
            let toggle = error.toggle_label.clone().map(|label| {
                div()
                    .id("providers-placeholder-error-toggle")
                    .mt(px(ERROR_TOGGLE_GAP))
                    .cursor_pointer()
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.muted_foreground)
                    .hover(|style| style.text_color(t.foreground))
                    .on_click(change_click(
                        &self.client,
                        json!({ "kind": "toggle-placeholder-error" }),
                    ))
                    .child(label)
            });
            div()
                .w_full()
                .max_w(px(MAX_EMPTY_CONTENT))
                .min_w_0()
                .font_family(MONO_FONT)
                .text_size(px(text::XS))
                .line_height(px(text::XS * text::LEADING_RELAXED))
                .text_color(t.muted_foreground)
                .child(
                    div()
                        .whitespace_normal()
                        .when(error.collapsed, |this| this.line_clamp(3))
                        .child(error.text.clone()),
                )
                .children(toggle)
        });
        let height = self.card_height(window);
        group_surface(&t)
            .overflow_hidden()
            .when_some(height, |this, height| this.h(px(height)))
            .items_center()
            .justify_center()
            .child(self.width_probe(cx))
            .child(
                Empty::new()
                    .media(EmptyMedia::Icon(SharedString::from(machine_icon(
                        placeholder.machine_kind,
                    ))))
                    .title(placeholder.title.clone())
                    .description(placeholder.description.clone())
                    .children(error),
            )
            .into_any_element()
    }

    fn settings_body(
        &mut self,
        body: &ProvidersSettingsBody,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = theme::active(cx);
        let client = self.client.clone();
        let read_only = body.read_only;
        let rows: Vec<AnyElement> = body
            .rows
            .iter()
            .map(|row| card::list_row(row, &client, &t))
            .collect();
        let editor = match &body.editor {
            Some(editor) => card::editor(self, editor, read_only, window, cx),
            None => div()
                .p(px(EMPTY_PADDING))
                .text_size(px(text::SM))
                .line_height(px(text::SM_LINE))
                .text_color(t.muted_foreground)
                .children(body.empty_message.clone())
                .into_any_element(),
        };
        let height = self.card_height(window);
        let wide = height.is_some();
        let list = div()
            .id("providers-list")
            .flex()
            .flex_col()
            .bg(fade(t.muted, 0.1))
            .border_color(fade(t.border, 0.6))
            .map(|this| {
                if wide {
                    this.w(px(LIST_WIDTH))
                        .flex_none()
                        .h_full()
                        .border_r_1()
                        .overflow_y_scroll()
                } else {
                    this.w_full().border_b_1()
                }
            })
            .children(rows.into_iter().enumerate().map(|(index, row)| {
                div()
                    .when(index > 0, |this| {
                        this.border_t_1().border_color(fade(t.border, 0.5))
                    })
                    .child(row)
            }));
        let editor_column = div()
            .id("providers-editor")
            .flex_1()
            .min_w_0()
            .when(wide, |this| this.h_full().overflow_y_scroll())
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(EDITOR_GAP))
                    .when(body.editor.is_some(), |this| this.p(px(EDITOR_PADDING)))
                    .child(editor),
            );
        let card = group_surface(&t)
            .overflow_hidden()
            .when(wide, |this| this.flex_row())
            .when_some(height, |this, height| this.h(px(height)))
            .child(self.width_probe(cx))
            .child(list)
            .child(editor_column);
        let read_only_notice = body.read_only_notice.as_ref().map(|notice| {
            SettingsGroup::new().divided(false).child(
                SettingsRow::new("providers-read-only", notice.title.clone())
                    .description(notice.description.clone()),
            )
        });
        let providers = SettingsSection::new(body.section.title.clone())
            .id(body.section.id.clone())
            .variant(SettingsGroupVariant::Plain)
            .header_action(self.header_action(body, &t))
            .children(read_only_notice)
            .child(card);
        let usage = usage_section(&body.usage, &client, &t);
        let health = self.health_section(&body.health, window, cx);
        let add_instance = body
            .add_instance
            .as_ref()
            .map(|add| dialogs::add_instance(self, add, &body.environment_id, window, cx));
        let add_hub = body
            .usage
            .add_dialog
            .as_ref()
            .map(|dialog| dialogs::add_hub(self, dialog, window, cx));
        let remove_hub = body
            .usage
            .remove_confirmation
            .as_ref()
            .map(|hub| dialogs::remove_hub(hub, &client));
        let accent = body
            .accent_popover
            .as_ref()
            .and_then(|popover| accent::popover(self, popover, window, cx));
        settings_stack()
            .child(providers)
            .child(usage)
            .child(health)
            .children(add_instance)
            .children(add_hub)
            .children(remove_hub)
            .children(accent)
            .into_any_element()
    }

    fn health_section(
        &mut self,
        health: &HealthIntervalView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = theme::active(cx);
        let client = self.client.clone();
        let state = self.input(
            InputSpec {
                key: "health-interval".into(),
                value: format_number(health.value),
                placeholder: String::new(),
                masked: false,
                mode: InputMode::Live,
                on_value: {
                    let client = client.clone();
                    Rc::new(move |raw: String, cx: &mut App| {
                        let trimmed = raw.trim();
                        let seconds = if trimmed.is_empty() {
                            Some(Value::Null)
                        } else {
                            trimmed.parse::<f64>().ok().map(|number| json!(number))
                        };
                        if let Some(seconds) = seconds {
                            send_change(
                                &client,
                                cx,
                                json!({ "kind": "set-health-interval", "seconds": seconds }),
                            );
                        }
                    })
                },
                on_enter: None,
                on_blur: None,
            },
            window,
            cx,
        );
        let reset = health.reset_label.clone().map(|label| {
            let reset_client = client.clone();
            div().when(health.disabled, |this| this.opacity(0.5)).child(
                SettingResetButton::new("provider-health-reset", label)
                    .disabled(health.disabled)
                    .on_click(move |_, cx| {
                        send_change(
                            &reset_client,
                            cx,
                            json!({ "kind": "reset-health-interval" }),
                        )
                    }),
            )
        });
        let title = div()
            .flex()
            .items_center()
            .gap(px(6.))
            .child(health.title.clone())
            .child(PolicyTooltip::new(
                "provider-health-policy",
                health.policy_tooltip.clone(),
            ));
        let control = div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(HEALTH_UNIT_GAP))
            .when(health.disabled, |this| this.opacity(0.5))
            .child(
                NumberField::new("provider-health-interval", &state)
                    .size(NumberFieldSize::Sm)
                    .min(health.min)
                    .step(health.step)
                    .disabled(health.disabled)
                    .w(px(HEALTH_FIELD_WIDTH)),
            )
            .child(muted(health.unit_label.clone(), &t));
        SettingsSection::new(health.section_title.clone())
            .child(
                SettingsRow::new(health.id.clone(), health.title.clone())
                    .title_element(title)
                    .description(health.description.clone())
                    .when_some(reset, |row, reset| row.reset_action(reset))
                    .control(control),
            )
            .into_any_element()
    }
}

pub(super) fn format_number(value: f64) -> String {
    if value.fract() == 0. {
        format!("{}", value as i64)
    } else {
        format!("{value}")
    }
}

fn last_checked(model: &LastCheckedView, t: &Tokens) -> Option<AnyElement> {
    match model {
        LastCheckedView::Missing => None,
        LastCheckedView::Invalid { text: label } => {
            Some(div().child(label.clone()).into_any_element())
        }
        LastCheckedView::Relative {
            prefix,
            value,
            suffix,
        } => Some(
            div()
                .flex()
                .items_baseline()
                .gap(px(4.))
                .child(prefix.clone())
                .child(
                    div()
                        .when(suffix.is_some(), |this| this.font_family(MONO_FONT))
                        .child(value.clone()),
                )
                .children(suffix.clone())
                .text_color(t.muted_foreground)
                .into_any_element(),
        ),
    }
}

fn usage_section(usage: &ProviderUsageView, client: &Entity<CoreClient>, t: &Tokens) -> AnyElement {
    let add = usage.add_action.as_ref().map(|add| {
        Button::new("usage-add-hub")
            .size(ButtonSize::Xs)
            .variant(ButtonVariant::Outline)
            .icon("plus")
            .icon_size(12.)
            .label(add.label.clone())
            .on_click(click(
                client,
                "settingsProvidersUsage",
                json!({ "intent": { "kind": "open-add" } }),
            ))
    });
    let cursor = usage.cursor_keychain_row.as_ref().map(|row| {
        let toggle_client = client.clone();
        SettingsRow::new(row.id.clone(), row.title.clone())
            .description(row.description.clone())
            .control(
                settings_switch("cursor-keychain-usage", row.value)
                    .disabled(row.disabled)
                    .accessibility_label(row.aria_label.clone())
                    .on_change(move |enabled, _, _, cx| {
                        act(
                            &toggle_client,
                            cx,
                            "settingsProvidersUsage",
                            json!({ "intent": { "kind": "set-cursor", "enabled": enabled } }),
                        )
                    }),
            )
            .into_any_element()
    });
    let hubs: Vec<AnyElement> = match &usage.empty_label {
        Some(empty) => vec![SettingsRow::new("usage-empty", empty.clone()).into_any_element()],
        None => usage
            .hubs
            .iter()
            .map(|hub| {
                SettingsRow::new(format!("usage-hub-{}", hub.id), hub.label.clone())
                    .description_element(
                        div()
                            .text_size(px(text::XS))
                            .line_height(px(18.))
                            .text_color(fade(t.muted_foreground, 0.8))
                            .whitespace_normal()
                            .child(hub.description.clone()),
                    )
                    .when(hub.removable, |row| {
                        row.control(
                            Button::new(SharedString::from(format!("usage-remove-{}", hub.id)))
                                .size(ButtonSize::Xs)
                                .variant(ButtonVariant::Ghost)
                                .label(hub.remove_label.clone())
                                .on_click(click(
                                    client,
                                    "settingsProvidersUsage",
                                    json!({ "intent": { "kind": "request-remove", "id": hub.id } }),
                                )),
                        )
                    })
                    .into_any_element()
            })
            .collect(),
    };
    SettingsSection::new(usage.section.title.clone())
        .id(usage.section.id.clone())
        .when_some(add, |section, add| section.header_action(add))
        .children(cursor)
        .children(hubs)
        .into_any_element()
}

impl Render for ProvidersSection {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.touched.clear();
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return div().into_any_element();
        };
        let t = theme::active(cx);
        let element = match &view {
            SettingsProvidersView::Message { message } => div()
                .p(px(MESSAGE_PADDING))
                .text_size(px(text::SM))
                .line_height(px(text::SM_LINE))
                .text_color(t.muted_foreground)
                .child(message.clone())
                .into_any_element(),
            SettingsProvidersView::Placeholder { placeholder, error } => {
                let card = self.placeholder_card(placeholder, error.as_ref(), window, cx);
                settings_stack()
                    .child(
                        SettingsSection::new(placeholder.section.title.clone())
                            .id(placeholder.section.id.clone())
                            .variant(SettingsGroupVariant::Plain)
                            .child(card),
                    )
                    .into_any_element()
            }
            SettingsProvidersView::Settings(body) => self.settings_body(body, window, cx),
        };
        let touched = std::mem::take(&mut self.touched);
        self.inputs.retain(|key, _| touched.contains(key));
        self.textareas.retain(|key, _| touched.contains(key));
        let seen = std::mem::take(&mut self.focus_seen);
        self.focus_marks.retain(|marker| seen.contains(marker));
        self.touched = touched;
        element
    }
}
