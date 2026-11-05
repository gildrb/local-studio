use std::collections::HashMap;

use gpui::component::input::{InputEvent, InputState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, Context, Corners, Entity, Focusable, InteractiveElement,
    IntoElement, ParentElement, Render, SharedString, Styled, TextAlign, Window, div, px,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::settings_storage::{
    SettingsStorageView, StorageModeRowView, StorageRetentionControlView, StorageRuleRowView,
};
use crate::features::settings::primitives::{
    SettingsRow, SettingsSection, SettingsSelect, SettingsSelectOption, settings_stack,
    settings_switch,
};
use crate::features::settings::scope_notice;
use crate::ui::button::{icon, rounded};
use crate::ui::input::{bare_input, decorate, field_look};
use crate::ui::number_field::{DECREMENT_ICON, INCREMENT_ICON, NumberFieldSize};
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};

const RETENTION_GAP: f32 = 12.;
const STEPPER_ICON: f32 = 16.;
const DIGIT_WIDTH: f32 = 8.5;
const UNIT_PADDING_RIGHT: f32 = 8.;

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

pub fn format_grouped(value: f64) -> String {
    let rounded = value.round();
    let negative = rounded < 0.;
    let digits = format!("{}", rounded.abs() as u64);
    let mut out = String::new();
    for (index, ch) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            out.push(',');
        }
        out.push(ch);
    }
    if negative { format!("-{out}") } else { out }
}

fn parse_draft(text: &str) -> Option<f64> {
    let cleaned: String = text.chars().filter(|ch| *ch != ',').collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        return None;
    }
    trimmed
        .parse::<f64>()
        .ok()
        .filter(|value| value.is_finite())
}

pub struct StorageSection {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<SettingsStorageView>>>,
    drafts: HashMap<String, Entity<InputState>>,
}

impl StorageSection {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<SettingsStorageView>>(
            &client,
            "settingsStorage",
            json!({}),
            cx,
        );
        cx.observe(&view, |_, _, cx| cx.notify()).detach();
        Self {
            client,
            view,
            drafts: HashMap::new(),
        }
    }

    fn commit(client: &Entity<CoreClient>, key: &str, next: Option<f64>, value: f64, cx: &mut App) {
        act(
            client,
            cx,
            "settingsStorageRetentionCommit",
            json!({ "key": key, "next": next, "value": value }),
        );
    }

    fn sync_draft(
        &mut self,
        key: &str,
        value: f64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<InputState> {
        let state = match self.drafts.get(key) {
            Some(state) => state.clone(),
            None => {
                let state = cx.new(|cx| InputState::new(window, cx));
                let client = self.client.clone();
                let owned_key = key.to_string();
                let view = self.view.clone();
                cx.subscribe_in(
                    &state,
                    window,
                    move |_: &mut Self, state, event: &InputEvent, _, cx| {
                        if matches!(event, InputEvent::Blur | InputEvent::PressEnter { .. }) {
                            let current = view
                                .read(cx)
                                .data
                                .clone()
                                .flatten()
                                .and_then(|view| retention_value(&view, &owned_key));
                            if let Some(current) = current {
                                let next = parse_draft(&state.read(cx).value());
                                Self::commit(&client, &owned_key, next, current, cx);
                            }
                        }
                    },
                )
                .detach();
                self.drafts.insert(key.to_string(), state.clone());
                state
            }
        };
        let focused = state.read(cx).focus_handle(cx).is_focused(window);
        let formatted = format_grouped(value);
        if !focused && state.read(cx).value() != formatted.as_str() {
            state.update(cx, |state, cx| state.set_value(formatted, window, cx));
        }
        state
    }

    fn retention_control(
        &mut self,
        key: &str,
        control: &StorageRetentionControlView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = theme::active(cx);
        let toggle_client = self.client.clone();
        let toggle_key = key.to_string();
        let toggle = settings_switch(
            SharedString::from(format!("storage-{key}-toggle")),
            control.enabled,
        )
        .accessibility_label(control.label.clone())
        .on_change(move |enabled, _, _, cx| {
            act(
                &toggle_client,
                cx,
                "settingsStorageRetentionToggle",
                json!({ "key": toggle_key, "enabled": enabled }),
            );
        });
        let field = match control.value {
            None => div()
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .text_color(t.muted_foreground)
                .child(control.off_label.clone())
                .into_any_element(),
            Some(value) => {
                let state = self.sync_draft(key, value, window, cx);
                let draft_text = state.read(cx).value().to_string();
                let chars = draft_text.chars().count().max(1) as f32;
                let focused = state.read(cx).focus_handle(cx).is_focused(window);
                let look = field_look(&t, focused, false, false);
                let m = NumberFieldSize::Sm.metrics();
                let corners = Corners::all(px(radius::LG));
                let inner_radius = px(radius::LG - 1.);
                let (min, max, step) = (control.min, control.max, control.step);
                let stepper = |id: &'static str, glyph: &'static str, delta: f64, left: bool| {
                    let client = self.client.clone();
                    let key = key.to_string();
                    let state = state.clone();
                    gpui::base::Button::new(SharedString::from(format!("storage-{key}-{id}")))
                        .focusable(false)
                        .flex()
                        .flex_none()
                        .items_center()
                        .justify_center()
                        .h_full()
                        .px(px(m.padding_x))
                        .map(|b| {
                            if left {
                                b.rounded_tl(inner_radius).rounded_bl(inner_radius)
                            } else {
                                b.rounded_tr(inner_radius).rounded_br(inner_radius)
                            }
                        })
                        .cursor_pointer()
                        .hover(|s| s.bg(t.accent))
                        .on_click(move |_, _, cx| {
                            let base = parse_draft(&state.read(cx).value()).unwrap_or(value);
                            let next = (base + delta).clamp(min, max);
                            Self::commit(&client, &key, Some(next), value, cx);
                        })
                        .child(icon(glyph, STEPPER_ICON, t.foreground))
                };
                let frame = div()
                    .relative()
                    .flex()
                    .flex_none()
                    .items_center()
                    .h(px(m.height))
                    .border_1()
                    .border_color(look.border)
                    .bg(look.bg)
                    .shadow(look.shadows.clone())
                    .text_color(t.foreground)
                    .text_size(px(text::SM))
                    .child(stepper("decrement", DECREMENT_ICON, -step, true))
                    .child(
                        bare_input(&state, m.height - 2., 0., 0., text::SM, false)
                            .w(px(chars * DIGIT_WIDTH + 2.))
                            .flex_none()
                            .text_align(TextAlign::Right),
                    )
                    .child(
                        div()
                            .flex_none()
                            .pl(px(4.))
                            .pr(px(UNIT_PADDING_RIGHT))
                            .text_size(px(text::XS))
                            .child(control.unit_label.clone()),
                    )
                    .child(stepper("increment", INCREMENT_ICON, step, false));
                decorate(rounded(frame, corners), &t, &look, corners).into_any_element()
            }
        };
        div()
            .flex()
            .items_center()
            .gap(px(RETENTION_GAP))
            .child(field)
            .child(toggle)
            .into_any_element()
    }

    fn mode_row(&self, row: &StorageModeRowView) -> AnyElement {
        let client = self.client.clone();
        SettingsRow::new(row.id.clone(), row.title.clone())
            .description(row.description.clone())
            .scope(&row.row_scope, &self.client)
            .control(
                SettingsSelect::new("storage-worktree-mode")
                    .options(
                        row.options
                            .iter()
                            .map(|option| SettingsSelectOption::new(option.value.clone(), option.label.clone())),
                    )
                    .value(row.value.clone())
                    .value_label(row.value_label.clone())
                    .accessibility_label(row.aria_label.clone())
                    .on_change(move |value, _, cx| {
                        act(
                            &client,
                            cx,
                            "settingsStorageChange",
                            json!({ "intent": { "kind": "select-worktree-mode", "mode": value.to_string() } }),
                        );
                    }),
            )
            .into_any_element()
    }

    fn rule_row(
        &mut self,
        row: &StorageRuleRowView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        match row {
            StorageRuleRowView::Switch {
                id,
                title,
                description,
                status,
                aria_label,
                checked,
                row_scope,
            } => {
                let client = self.client.clone();
                let key = id.clone();
                let mut settings_row = SettingsRow::new(id.clone(), title.clone())
                    .description(description.clone())
                    .scope(row_scope, &self.client)
                    .control(
                        settings_switch(SharedString::from(format!("storage-{id}")), *checked)
                            .accessibility_label(aria_label.clone())
                            .on_change(move |checked, _, _, cx| {
                                act(
                                    &client,
                                    cx,
                                    "settingsStorageChange",
                                    json!({ "intent": { "kind": "toggle-rule", "key": key, "checked": checked } }),
                                );
                            }),
                    );
                if let Some(status) = status.clone() {
                    settings_row = settings_row.status(SharedString::from(status));
                }
                settings_row.into_any_element()
            }
            StorageRuleRowView::Retention {
                id,
                title,
                description,
                status,
                retention,
                row_scope,
            } => {
                let control = self.retention_control(id, retention, window, cx);
                let mut settings_row = SettingsRow::new(id.clone(), title.clone())
                    .description(description.clone())
                    .scope(row_scope, &self.client)
                    .control(control);
                if let Some(status) = status.clone() {
                    settings_row = settings_row.status(SharedString::from(status));
                }
                settings_row.into_any_element()
            }
        }
    }
}

fn retention_value(view: &SettingsStorageView, key: &str) -> Option<f64> {
    let SettingsStorageView::Settings { sections } = view else {
        return None;
    };
    sections
        .iter()
        .flat_map(|section| section.rows.iter())
        .find_map(|row| match row {
            StorageRuleRowView::Retention { id, retention, .. } if id == key => retention.value,
            _ => None,
        })
}

impl Render for StorageSection {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return div().into_any_element();
        };
        let t = theme::active(cx);
        match &view {
            SettingsStorageView::Notice { message, choices } => {
                scope_notice(&self.client, message, "", choices, &t).into_any_element()
            }
            SettingsStorageView::Settings { sections } => {
                let mut stack = settings_stack();
                for section in sections {
                    let mut rows: Vec<AnyElement> = Vec::new();
                    if let Some(mode_row) = section.mode_row.as_ref() {
                        rows.push(self.mode_row(mode_row));
                    }
                    for row in &section.rows {
                        rows.push(self.rule_row(row, window, cx));
                    }
                    stack = stack.child(
                        SettingsSection::new(section.title.clone())
                            .id(section.id.clone())
                            .children(rows),
                    );
                }
                stack.into_any_element()
            }
        }
    }
}
