use std::collections::HashMap;

use gpui::component::input::{InputEvent, InputState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, ClickEvent, Context, Entity, FocusHandle, Focusable, FontWeight,
    InteractiveElement, IntoElement, KeyDownEvent, ParentElement, Render, SharedString,
    StatefulInteractiveElement, Styled, Window, div, px, svg,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::settings_general::{
    AboutVersionView, BackgroundActivityAdvancedView, GeneralControlView, GeneralLayoutItemView,
    GeneralOptionView, GeneralRowView, GeneralSectionItemView, GeneralSectionView,
    GeneralSettingsView, NotificationSettingsView, ProjectDefaultsRowKindView,
    ProjectDefaultsRowView, TokenStreamingWarningView,
};
use crate::features::chat::model_picker::ModelPickerActions;
use crate::features::settings::model_controls::{
    SettingsModelActions, SettingsModelMenus, settings_model_controls, settings_model_picker,
    settings_traits_menu,
};
use crate::features::settings::primitives::{
    PolicyTooltip, SECTION_INSET_X, SECTION_STACK_GAP, SettingResetButton, SettingsControlWidth,
    SettingsDraftInput, SettingsGroup, SettingsRow, SettingsSection, SettingsSelect,
    SettingsSelectOption, TEXT_INPUT_WIDTH, settings_button, settings_number_input, settings_stack,
    settings_switch,
};
use crate::platform::MONO_FONT;
use crate::ui::alert_dialog::{
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup,
    AlertDialogTitle,
};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::dialog::{
    DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle,
};
use crate::ui::number_field::{NumberField, NumberFieldSize};
use crate::ui::theme;
use crate::ui::theme::metrics::text;
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const TEXT_GENERATION_PICKER: &str = "text-generation-model";
const DEFAULT_MODEL_PICKER: &str = "default-model";
const WIDE_SELECT_WIDTH: f32 = 224.;
const LEGACY_HEADER_MIN_HEIGHT: f32 = 32.;
const LEGACY_HEADER_GAP: f32 = 8.;
const LEGACY_CHEVRON: f32 = 16.;
const LEGACY_TITLE_OPACITY: f32 = 0.7;
const ABOUT_VERSION_TEXT: f32 = 11.;
const ABOUT_VERSION_LINE: f32 = 16.;
const ABOUT_VERSION_GAP: f32 = 8.;
const ACCESSORY_ICON: f32 = 16.;
const BACKGROUND_DIALOG_WIDTH: f32 = 576.;
const BACKGROUND_CARD_RADIUS: f32 = 12.;
const BACKGROUND_ROW_PADDING_X: f32 = 16.;
const BACKGROUND_ROW_PADDING_Y: f32 = 12.;
const BACKGROUND_ROW_GAP: f32 = 12.;
const BACKGROUND_TEXT_GAP: f32 = 4.;
const BACKGROUND_DESCRIPTION_LINE: f32 = 19.5;
const BACKGROUND_NUMBER_WIDTH: f32 = 128.;
const BACKGROUND_UNIT_GAP: f32 = 8.;
const INLINE_TEXT_LINE: f32 = 20.;

const MODEL_ACTIONS: SettingsModelActions = SettingsModelActions {
    open: "settingsGeneralPickerOpen",
    close: "settingsGeneralPickerClose",
    search: "settingsGeneralPickerSearch",
    traits: "settingsGeneralTraitsSelect",
    picker: ModelPickerActions {
        rail: "settingsGeneralPickerRail",
        select: "settingsGeneralPickerSelect",
        favorite: "settingsGeneralPickerFavorite",
        toggle_legacy: "settingsGeneralPickerToggleLegacy",
        close: "settingsGeneralPickerClose",
        setup: Some("settingsGeneralPickerSetup"),
    },
};

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

fn change(client: &Entity<CoreClient>, cx: &mut App, intent: Value) {
    act(
        client,
        cx,
        "settingsGeneralChange",
        json!({ "intent": intent }),
    );
}

fn select_width(key: &str) -> SettingsControlWidth {
    match key {
        "responseStreaming" => SettingsControlWidth::Fixed(WIDE_SELECT_WIDTH),
        "sendShortcut" | "followUpBehavior" => SettingsControlWidth::Auto,
        _ => SettingsControlWidth::Fixed(crate::features::settings::primitives::SELECT_WIDTH),
    }
}

fn options(options: &[GeneralOptionView]) -> Vec<SettingsSelectOption> {
    options
        .iter()
        .map(|option| {
            SettingsSelectOption::new(option.value.clone(), option.label.clone())
                .disabled(option.disabled)
        })
        .collect()
}

fn muted_text(text_value: &str, t: &Tokens) -> AnyElement {
    div()
        .text_size(px(text::SM))
        .line_height(px(INLINE_TEXT_LINE))
        .text_color(t.muted_foreground)
        .child(SharedString::from(text_value.to_string()))
        .into_any_element()
}

pub struct GeneralSection {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<GeneralSettingsView>>>,
    dialog_focus: FocusHandle,
    auto_settle: Option<Entity<InputState>>,
    auto_settle_value: Option<String>,
    base_directory: Option<Entity<SettingsDraftInput>>,
    intervals: HashMap<String, (Entity<InputState>, f64)>,
    picker_search: Option<Entity<InputState>>,
    menus: Entity<SettingsModelMenus>,
    dialog_open: bool,
}

impl GeneralSection {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<GeneralSettingsView>>(
            &client,
            "settingsGeneral",
            json!({}),
            cx,
        );
        cx.observe(&view, |_, _, cx| cx.notify()).detach();
        let menus = cx.new(|_| SettingsModelMenus::default());
        cx.observe(&menus, |_, _, cx| cx.notify()).detach();
        act(&client, cx, "settingsGeneralMount", json!({}));
        Self {
            client,
            view,
            dialog_focus: cx.focus_handle(),
            auto_settle: None,
            auto_settle_value: None,
            base_directory: None,
            intervals: HashMap::new(),
            picker_search: None,
            menus,
            dialog_open: false,
        }
    }

    fn sync_inputs(
        &mut self,
        view: &GeneralSettingsView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(Some(row)) = view.rows.get("autoSettleDays")
            && let GeneralControlView::NumberInput { value, .. } = &row.control
        {
            let value = format!("{value}");
            let state = match &self.auto_settle {
                Some(state) => state.clone(),
                None => {
                    let state = cx.new(|cx| InputState::new(window, cx));
                    let client = self.client.clone();
                    cx.subscribe_in(
                        &state,
                        window,
                        move |section: &mut Self, state, event: &InputEvent, window, cx| match event
                        {
                            InputEvent::Change => {
                                let draft = state.read(cx).value().to_string();
                                act(
                                    &client,
                                    cx,
                                    "settingsGeneralAutoSettleDraft",
                                    json!({ "draft": draft }),
                                );
                            }
                            InputEvent::Blur => {
                                if let Some(value) = section.auto_settle_value.clone() {
                                    state.update(cx, |state, cx| {
                                        if state.value() != value.as_str() {
                                            state.set_value(value, window, cx);
                                        }
                                    });
                                }
                            }
                            _ => {}
                        },
                    )
                    .detach();
                    self.auto_settle = Some(state.clone());
                    state
                }
            };
            if self.auto_settle_value.as_deref() != Some(value.as_str()) {
                self.auto_settle_value = Some(value.clone());
                let focused = state.read(cx).focus_handle(cx).is_focused(window);
                if !focused {
                    state.update(cx, |state, cx| state.set_value(value, window, cx));
                }
            }
        }
        if let Some(Some(row)) = view.rows.get("addProjectBaseDirectory")
            && let GeneralControlView::TextInput {
                value, placeholder, ..
            } = &row.control
        {
            match &self.base_directory {
                Some(input) => input.update(cx, |input, cx| input.sync(value, window, cx)),
                None => {
                    let client = self.client.clone();
                    let input = cx.new(|cx| {
                        SettingsDraftInput::new(
                            value.clone(),
                            placeholder.clone(),
                            move |next, _, cx| {
                                change(
                                    &client,
                                    cx,
                                    json!({ "kind": "commit-add-project-base-directory", "value": next }),
                                );
                            },
                            window,
                            cx,
                        )
                    });
                    self.base_directory = Some(input);
                }
            }
        }
        let dialog = &view.background_activity_advanced;
        if dialog.open {
            for interval in &dialog.intervals {
                let entry = self.intervals.get(&interval.key).cloned();
                let state = match entry {
                    Some((state, shown)) => {
                        if shown != interval.value_seconds
                            && !state.read(cx).focus_handle(cx).is_focused(window)
                        {
                            let next = format!("{}", interval.value_seconds);
                            state.update(cx, |state, cx| state.set_value(next, window, cx));
                        }
                        state
                    }
                    None => {
                        let initial = format!("{}", interval.value_seconds);
                        let state = cx.new(|cx| {
                            let mut state = InputState::new(window, cx);
                            state.set_value(initial, window, cx);
                            state
                        });
                        let client = self.client.clone();
                        let key = interval.key.clone();
                        cx.subscribe_in(
                            &state,
                            window,
                            move |_: &mut Self, state, event: &InputEvent, _, cx| {
                                if let InputEvent::Change = event {
                                    let raw = state.read(cx).value().trim().to_string();
                                    let value = if raw.is_empty() {
                                        Some(Value::Null)
                                    } else {
                                        raw.parse::<f64>().ok().map(|number| json!(number))
                                    };
                                    if let Some(value) = value {
                                        act(
                                            &client,
                                            cx,
                                            "settingsGeneralBackgroundActivity",
                                            json!({ "intent": {
                                                "kind": "set-interval",
                                                "key": key,
                                                "value": value,
                                            }}),
                                        );
                                    }
                                }
                            },
                        )
                        .detach();
                        state
                    }
                };
                self.intervals
                    .insert(interval.key.clone(), (state, interval.value_seconds));
            }
        } else if !self.intervals.is_empty() {
            self.intervals.clear();
        }
        let search = match &self.picker_search {
            Some(search) => search.clone(),
            None => {
                let search = cx.new(|cx| InputState::new(window, cx));
                let client = self.client.clone();
                cx.subscribe_in(
                    &search,
                    window,
                    move |_: &mut Self, search, event: &InputEvent, _, cx| {
                        if let InputEvent::Change = event {
                            let query = search.read(cx).value().to_string();
                            act(&client, cx, MODEL_ACTIONS.search, json!({ "query": query }));
                        }
                    },
                )
                .detach();
                self.picker_search = Some(search.clone());
                search
            }
        };
        let popup = view.model_picker.as_ref();
        self.menus.update(cx, |menus, cx| {
            menus.sync_search(popup, &search, window, cx)
        });
        let dialog_open = view.token_streaming_warning.open || dialog.open;
        if dialog_open && !self.dialog_open {
            self.dialog_focus.focus(window, cx);
        }
        self.dialog_open = dialog_open;
    }

    fn reset_button(&self, key: &str, row: &GeneralRowView) -> Option<AnyElement> {
        let label = row.reset_label.clone()?;
        let client = self.client.clone();
        let key = key.to_string();
        Some(
            SettingResetButton::new(SharedString::from(format!("general-reset-{key}")), label)
                .on_click(move |_, cx| change(&client, cx, json!({ "kind": "reset", "key": key })))
                .into_any_element(),
        )
    }

    fn control(
        &self,
        key: &str,
        row: &GeneralRowView,
        view: &GeneralSettingsView,
        cx: &App,
    ) -> Option<AnyElement> {
        let t = theme::active(cx);
        let client = self.client.clone();
        let id = format!("general-{key}");
        match &row.control {
            GeneralControlView::Switch {
                aria_label,
                checked,
                mixed,
                disabled,
                ..
            } => {
                let key = key.to_string();
                Some(
                    settings_switch(SharedString::from(id), *checked && !*mixed)
                        .mixed(*mixed)
                        .disabled(*disabled)
                        .accessibility_label(aria_label.clone())
                        .on_change(move |checked, _, _, cx| {
                            change(
                                &client,
                                cx,
                                json!({ "kind": "toggle", "key": key, "checked": checked }),
                            );
                        })
                        .into_any_element(),
                )
            }
            GeneralControlView::Select(control) => {
                let select_key = key.to_string();
                let select = SettingsSelect::new(SharedString::from(id))
                    .options(options(&control.options))
                    .value(control.value.clone())
                    .value_label(control.value_label.clone())
                    .width(select_width(key))
                    .check_selected(control.show_selected_indicator)
                    .disabled(control.disabled)
                    .accessibility_label(control.aria_label.clone())
                    .on_change(move |value, _, cx| {
                        change(
                            &client,
                            cx,
                            json!({ "kind": "select", "key": select_key, "value": value.to_string() }),
                        );
                    });
                let accessory = control.accessory.as_ref().map(|accessory| {
                    let client = self.client.clone();
                    div()
                        .id(SharedString::from(format!("general-{key}-accessory")))
                        .flex_none()
                        .tooltip(Tooltip::text(accessory.tooltip.clone()))
                        .child(
                            Button::new(SharedString::from(format!(
                                "general-{key}-accessory-button"
                            )))
                            .size(ButtonSize::IconSm)
                            .variant(ButtonVariant::Outline)
                            .icon(accessory.icon.clone())
                            .icon_size(ACCESSORY_ICON)
                            .accessibility_label(accessory.aria_label.clone())
                            .on_click(
                                move |_: &ClickEvent, _, cx| {
                                    change(
                                        &client,
                                        cx,
                                        json!({ "kind": "configure-background-activity" }),
                                    );
                                },
                            ),
                        )
                });
                Some(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(select)
                        .children(accessory)
                        .into_any_element(),
                )
            }
            GeneralControlView::NumberInput { .. } => self
                .auto_settle
                .as_ref()
                .map(|state| settings_number_input(state).into_any_element()),
            GeneralControlView::TextInput { .. } => self.base_directory.as_ref().map(|input| {
                div()
                    .w(px(TEXT_INPUT_WIDTH))
                    .child(input.clone())
                    .into_any_element()
            }),
            GeneralControlView::Link { label, route, .. } => {
                let route = route.clone();
                Some(
                    settings_button(SharedString::from(id), label.clone())
                        .on_click(move |_: &ClickEvent, _, cx| {
                            act(
                                &client,
                                cx,
                                "settingsGeneralOpenLink",
                                json!({ "route": route }),
                            );
                        })
                        .into_any_element(),
                )
            }
            GeneralControlView::ModelPicker(control) => {
                if let Some(message) = control.unavailable_message.as_deref() {
                    return Some(muted_text(message, &t));
                }
                view.text_generation_picker.as_ref().map(|picker| {
                    settings_model_controls(
                        TEXT_GENERATION_PICKER,
                        picker,
                        &self.menus,
                        &self.client,
                        MODEL_ACTIONS,
                        cx,
                    )
                })
            }
        }
    }

    fn row(
        &self,
        key: &str,
        row: &GeneralRowView,
        view: &GeneralSettingsView,
        cx: &App,
    ) -> AnyElement {
        let id = row
            .anchor_id
            .clone()
            .unwrap_or_else(|| format!("general-row-{key}"));
        let mut settings_row = SettingsRow::new(id.clone(), row.title.clone());
        if let Some(tooltip) = row.title_tooltip.clone() {
            settings_row = settings_row.title_element(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .child(SharedString::from(row.title.clone()))
                    .child(PolicyTooltip::new(format!("{id}-policy"), tooltip)),
            );
        }
        if !row.description.is_empty() {
            settings_row = settings_row.description(row.description.clone());
        }
        if let Some(status) = row.status.clone() {
            settings_row = settings_row.status(SharedString::from(status));
        }
        if let Some(reset) = self.reset_button(key, row) {
            settings_row = settings_row.reset_action(reset);
        }
        if let Some(scope) = row.row_scope.as_ref() {
            settings_row = settings_row.scope(scope, &self.client);
        }
        if let Some(control) = self.control(key, row, view, cx) {
            settings_row = settings_row.control(control);
        }
        settings_row.into_any_element()
    }

    fn notifications(&self, model: &NotificationSettingsView) -> AnyElement {
        let client = self.client.clone();
        SettingsRow::new(model.anchor_id.clone(), model.title.clone())
            .description(model.description.clone())
            .control(
                SettingsSelect::new("general-notifications")
                    .options(model.options.iter().map(|option| {
                        SettingsSelectOption::new(option.value.clone(), option.label.clone())
                    }))
                    .value(Some(model.value.clone()))
                    .value_label(model.value_label.clone())
                    .width(SettingsControlWidth::Fixed(WIDE_SELECT_WIDTH))
                    .disabled(model.disabled)
                    .accessibility_label(model.aria_label.clone())
                    .on_change(move |value, _, cx| {
                        act(
                            &client,
                            cx,
                            "settingsGeneralNotificationMode",
                            json!({ "value": value.to_string() }),
                        );
                    }),
            )
            .into_any_element()
    }

    fn about(&self, about: &AboutVersionView, cx: &App) -> Vec<AnyElement> {
        let t = theme::active(cx);
        let version = &about.version;
        let mut rows = Vec::new();
        let mut version_row = SettingsRow::new("about-version", version.title.clone())
            .title_element(
                div()
                    .flex()
                    .items_baseline()
                    .gap(px(ABOUT_VERSION_GAP))
                    .child(SharedString::from(version.title.clone()))
                    .child(
                        div()
                            .font_family(MONO_FONT)
                            .text_size(px(ABOUT_VERSION_TEXT))
                            .line_height(px(ABOUT_VERSION_LINE))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.muted_foreground)
                            .child(SharedString::from(version.version.clone())),
                    ),
            )
            .description(version.description.clone());
        if let Some(button) = version.button.as_ref() {
            let client = self.client.clone();
            let control = settings_button("about-version-button", button.label.clone())
                .disabled(button.disabled)
                .on_click(move |_: &ClickEvent, _, cx| {
                    act(
                        &client,
                        cx,
                        "settingsGeneralAbout",
                        json!({ "kind": "button" }),
                    );
                });
            version_row = version_row.control(match button.tooltip.clone() {
                Some(tooltip) => div()
                    .id("about-version-button-tooltip")
                    .tooltip(Tooltip::text(tooltip))
                    .child(control)
                    .into_any_element(),
                None => control.into_any_element(),
            });
        }
        rows.push(version_row.into_any_element());
        if let Some(track) = about.update_track.as_ref() {
            let client = self.client.clone();
            rows.push(
                SettingsRow::new("about-update-track", track.title.clone())
                    .description(track.description.clone())
                    .control(
                        SettingsSelect::new("about-update-track-select")
                            .options(options(&track.options))
                            .value(Some(track.value.clone()))
                            .value_label(track.value_label.clone())
                            .disabled(track.disabled)
                            .accessibility_label(track.aria_label.clone())
                            .on_change(move |value, _, cx| {
                                act(
                                    &client,
                                    cx,
                                    "settingsGeneralAbout",
                                    json!({ "kind": "track", "value": value.to_string() }),
                                );
                            }),
                    )
                    .into_any_element(),
            );
        }
        rows
    }

    fn project_defaults_row(
        &self,
        row: &ProjectDefaultsRowView,
        view: &GeneralSettingsView,
        cx: &App,
    ) -> AnyElement {
        let t = theme::active(cx);
        let mut settings_row = SettingsRow::new(row.id.clone(), row.title.clone())
            .description(row.description.clone())
            .scope(&row.row_scope, &self.client);
        if let Some(reset) = row.reset.as_ref() {
            let client = self.client.clone();
            let key = row.key.clone();
            let mut button = SettingResetButton::new(
                SharedString::from(format!("project-defaults-reset-{}", row.key)),
                reset.label.clone(),
            )
            .on_click(move |_, cx| {
                act(
                    &client,
                    cx,
                    "settingsGeneralProjectDefaults",
                    json!({ "intent": { "kind": "reset", "key": key } }),
                );
            });
            if let Some(tooltip) = reset.tooltip.clone() {
                button = button.tooltip(tooltip);
            }
            settings_row = settings_row.reset_action(button);
        }
        let client = self.client.clone();
        let key = row.key.clone();
        let control = match &row.kind {
            ProjectDefaultsRowKindView::Model {
                status,
                available,
                empty_label,
                ..
            } => {
                if let Some(status) = status.clone() {
                    settings_row = settings_row.status(SharedString::from(status));
                }
                match view.default_model_picker.as_ref().filter(|_| *available) {
                    Some(picker) => settings_model_controls(
                        DEFAULT_MODEL_PICKER,
                        picker,
                        &self.menus,
                        &self.client,
                        MODEL_ACTIONS,
                        cx,
                    ),
                    None => muted_text(empty_label, &t),
                }
            }
            ProjectDefaultsRowKindView::Select {
                aria_label,
                value,
                value_label,
                fallback_label,
                trigger_icon,
                options,
            } => {
                let mut select = SettingsSelect::new(SharedString::from(format!(
                    "project-defaults-{}",
                    row.key
                )))
                .options(options.iter().map(|option| {
                    let item = SettingsSelectOption::new(option.value.clone(), option.label.clone())
                        .description(option.description.clone());
                    match option.icon.clone() {
                        Some(icon) => item.icon(icon),
                        None => item,
                    }
                }))
                .value(value.clone())
                .value_label(if value.is_some() {
                    value_label.clone()
                } else {
                    fallback_label.clone()
                })
                .show_selected_icon(false)
                .accessibility_label(aria_label.clone())
                .on_change(move |value, _, cx| {
                    act(
                        &client,
                        cx,
                        "settingsGeneralProjectDefaults",
                        json!({ "intent": { "kind": "select", "key": key, "value": value.to_string() } }),
                    );
                });
                if let Some(icon) = trigger_icon.clone() {
                    select = select.leading(
                        svg()
                            .path(SharedString::from(format!("icons/{icon}.svg")))
                            .flex_none()
                            .size(px(14.))
                            .text_color(t.muted_foreground),
                    );
                }
                select.into_any_element()
            }
            ProjectDefaultsRowKindView::Switch {
                aria_label,
                checked,
            } => settings_switch(
                SharedString::from(format!("project-defaults-{}", row.key)),
                *checked && !row.mixed,
            )
            .mixed(row.mixed)
            .accessibility_label(aria_label.clone())
            .on_change(move |checked, _, _, cx| {
                act(
                    &client,
                    cx,
                    "settingsGeneralProjectDefaults",
                    json!({ "intent": { "kind": "toggle", "key": key, "checked": checked } }),
                );
            })
            .into_any_element(),
        };
        settings_row.control(control).into_any_element()
    }

    fn section_items(
        &self,
        section: &GeneralSectionView,
        view: &GeneralSettingsView,
        cx: &App,
    ) -> Vec<AnyElement> {
        let mut items = Vec::new();
        for item in &section.items {
            match item {
                GeneralSectionItemView::Row { key } => {
                    if let Some(Some(row)) = view.rows.get(key) {
                        items.push(self.row(key, row, view, cx));
                    }
                }
                GeneralSectionItemView::Embedded { panel } => match panel.as_str() {
                    "thread-notifications" => items.push(self.notifications(&view.notifications)),
                    "about" => items.extend(self.about(&view.about, cx)),
                    "project-defaults" => items.extend(
                        view.project_defaults
                            .rows
                            .iter()
                            .map(|row| self.project_defaults_row(row, view, cx)),
                    ),
                    _ => {}
                },
            }
        }
        items
    }

    fn legacy_section(
        &self,
        section: &GeneralSectionView,
        view: &GeneralSettingsView,
        cx: &App,
    ) -> AnyElement {
        let t = theme::active(cx);
        let open = view.legacy_open;
        let client = self.client.clone();
        let title_color = fade(t.foreground, LEGACY_TITLE_OPACITY);
        let hover_color = t.foreground;
        let id = section
            .anchor_id
            .clone()
            .unwrap_or_else(|| section.key.clone());
        div()
            .flex()
            .flex_col()
            .gap(px(SECTION_STACK_GAP))
            .child(
                div()
                    .id(SharedString::from(format!("{id}-trigger")))
                    .flex()
                    .items_center()
                    .min_h(px(LEGACY_HEADER_MIN_HEIGHT))
                    .w_full()
                    .gap(px(LEGACY_HEADER_GAP))
                    .px(px(SECTION_INSET_X))
                    .cursor_pointer()
                    .text_color(title_color)
                    .hover(move |s| s.text_color(hover_color))
                    .on_click(move |_: &ClickEvent, _, cx| {
                        act(
                            &client,
                            cx,
                            "settingsGeneralLegacyOpen",
                            json!({ "open": !open }),
                        );
                    })
                    .child(
                        div()
                            .text_size(px(text::SM))
                            .line_height(px(text::SM_LINE))
                            .child(SharedString::from(section.title.clone())),
                    )
                    .child(
                        svg()
                            .path(if open {
                                "icons/chevron-down.svg"
                            } else {
                                "icons/chevron-right.svg"
                            })
                            .flex_none()
                            .size(px(LEGACY_CHEVRON))
                            .text_color(t.muted_foreground),
                    ),
            )
            .when(open, |this| {
                this.child(SettingsGroup::new().children(self.section_items(section, view, cx)))
            })
            .into_any_element()
    }

    fn token_streaming_dialog(&self, model: &TokenStreamingWarningView) -> AnyElement {
        let confirm = self.client.clone();
        let cancel = self.client.clone();
        let paragraphs = self.client.clone();
        let dismiss = self.client.clone();
        AlertDialogPopup::new("general-token-streaming-warning")
            .on_dismiss(move |_, cx| {
                act(
                    &dismiss,
                    cx,
                    "settingsGeneralTokenStreamingWarning",
                    json!({ "open": false }),
                );
            })
            .child(
                AlertDialogHeader::new()
                    .child(AlertDialogTitle::new(model.title.clone()))
                    .child(AlertDialogDescription::new(model.description.clone())),
            )
            .child(
                AlertDialogFooter::new()
                    .child(
                        Button::new("general-token-streaming-confirm")
                            .variant(ButtonVariant::GhostMuted)
                            .label(model.confirm_label.clone())
                            .on_click(move |_: &ClickEvent, _, cx| {
                                change(&confirm, cx, json!({ "kind": "confirm-token-streaming" }));
                            }),
                    )
                    .child(div().flex_1())
                    .child(
                        Button::new("general-token-streaming-cancel")
                            .variant(ButtonVariant::Outline)
                            .label(model.cancel_label.clone())
                            .on_click(move |_: &ClickEvent, _, cx| {
                                act(
                                    &cancel,
                                    cx,
                                    "settingsGeneralTokenStreamingWarning",
                                    json!({ "open": false }),
                                );
                            }),
                    )
                    .child(
                        Button::new("general-token-streaming-paragraphs")
                            .label(model.use_paragraphs_label.clone())
                            .on_click(move |_: &ClickEvent, _, cx| {
                                change(
                                    &paragraphs,
                                    cx,
                                    json!({ "kind": "use-paragraph-streaming" }),
                                );
                            }),
                    ),
            )
            .into_any_element()
    }

    fn background_dialog(&self, model: &BackgroundActivityAdvancedView, cx: &App) -> AnyElement {
        let t = theme::active(cx);
        let close = self.client.clone();
        let done = self.client.clone();
        let reset = self.client.clone();
        let policy_client = self.client.clone();
        let policy = &model.shared_policy;
        let border = t.border;
        let text_block = |title: &str, description: &str| {
            div()
                .flex()
                .flex_col()
                .min_w_0()
                .gap(px(BACKGROUND_TEXT_GAP))
                .child(
                    div()
                        .text_size(px(text::SM))
                        .line_height(px(text::SM_LINE))
                        .font_weight(FontWeight::MEDIUM)
                        .child(SharedString::from(title.to_string())),
                )
                .child(
                    div()
                        .text_size(px(text::XS))
                        .line_height(px(BACKGROUND_DESCRIPTION_LINE))
                        .text_color(t.muted_foreground)
                        .child(SharedString::from(description.to_string())),
                )
        };
        let row = || {
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap(px(BACKGROUND_ROW_GAP))
                .px(px(BACKGROUND_ROW_PADDING_X))
                .py(px(BACKGROUND_ROW_PADDING_Y))
        };
        let shared = row()
            .border_b_1()
            .border_color(border)
            .child(text_block(&policy.title, &policy.description))
            .child(
                SettingsSelect::new("background-shared-policy")
                    .options(options(&policy.options))
                    .value(Some(policy.value.clone()))
                    .value_label(policy.value_label.clone())
                    .accessibility_label(policy.aria_label.clone())
                    .on_change(move |value, _, cx| {
                        act(
                            &policy_client,
                            cx,
                            "settingsGeneralBackgroundActivity",
                            json!({ "intent": { "kind": "set-shared-policy", "value": value.to_string() } }),
                        );
                    }),
            );
        let intervals = model.intervals.iter().map(|interval| {
            let control = self.intervals.get(&interval.key).map(|(state, _)| {
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(BACKGROUND_UNIT_GAP))
                    .child(
                        NumberField::new(
                            SharedString::from(format!("background-{}", interval.key)),
                            state,
                        )
                        .size(NumberFieldSize::Sm)
                        .min(interval.min)
                        .step(interval.step)
                        .w(px(BACKGROUND_NUMBER_WIDTH)),
                    )
                    .child(
                        div()
                            .text_size(px(text::XS))
                            .line_height(px(text::XS_LINE))
                            .text_color(t.muted_foreground)
                            .child(SharedString::from(interval.unit_label.clone())),
                    )
            });
            let bordered = matches!(
                interval.key.as_str(),
                "hostPowerMonitorActiveInterval" | "hostPowerMonitorIdleInterval"
            );
            let bottom = interval.key == "automaticGitFetchInterval";
            row()
                .when(bordered, |this| this.border_t_1().border_color(border))
                .when(bottom, |this| this.border_b_1().border_color(border))
                .child(text_block(&interval.title, &interval.description))
                .children(control)
        });
        let count = model.pause_toggles.len();
        let toggles = model.pause_toggles.iter().enumerate().map(|(index, toggle)| {
            let client = self.client.clone();
            let key = toggle.key.clone();
            let right = index % 2 == 0;
            let last_row = index + 2 > count + (count % 2);
            div()
                .flex()
                .flex_1()
                .min_w_0()
                .items_center()
                .justify_between()
                .gap(px(BACKGROUND_ROW_GAP))
                .px(px(BACKGROUND_ROW_PADDING_X))
                .py(px(BACKGROUND_ROW_PADDING_Y))
                .when(!last_row, |this| this.border_b_1().border_color(border))
                .when(right, |this| this.border_r_1().border_color(border))
                .child(
                    div()
                        .text_size(px(text::SM))
                        .line_height(px(text::SM_LINE))
                        .font_weight(FontWeight::MEDIUM)
                        .child(SharedString::from(toggle.label.clone())),
                )
                .child(
                    settings_switch(SharedString::from(format!("background-{}", toggle.key)), toggle.checked)
                        .accessibility_label(toggle.label.clone())
                        .on_change(move |checked, _, _, cx| {
                            act(
                                &client,
                                cx,
                                "settingsGeneralBackgroundActivity",
                                json!({ "intent": { "kind": "set-pause", "key": key, "checked": checked } }),
                            );
                        }),
                )
                .into_any_element()
        });
        let toggles: Vec<AnyElement> = toggles.collect();
        let mut grid_rows = Vec::new();
        let mut iter = toggles.into_iter();
        while let Some(first) = iter.next() {
            let second = iter.next();
            grid_rows.push(
                div()
                    .flex()
                    .w_full()
                    .child(first)
                    .children(second)
                    .into_any_element(),
            );
        }
        DialogPopup::new("general-background-activity")
            .max_width(BACKGROUND_DIALOG_WIDTH)
            .on_close(move |_, cx| {
                act(
                    &close,
                    cx,
                    "settingsGeneralBackgroundActivityDialog",
                    json!({ "open": false }),
                );
            })
            .child(
                DialogHeader::new()
                    .with_panel(true)
                    .child(DialogTitle::new(model.title.clone()))
                    .child(DialogDescription::new(model.description.clone())),
            )
            .child(
                DialogPanel::new("general-background-activity-panel")
                    .after_header(true)
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .overflow_hidden()
                            .rounded(px(BACKGROUND_CARD_RADIUS))
                            .border_1()
                            .border_color(border)
                            .bg(t.card)
                            .text_color(t.card_foreground)
                            .child(shared)
                            .children(intervals)
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .border_t_1()
                                    .border_color(border)
                                    .children(grid_rows),
                            ),
                    ),
            )
            .child(
                DialogFooter::new()
                    .child(
                        Button::new("general-background-reset")
                            .variant(ButtonVariant::Outline)
                            .label(model.reset_label.clone())
                            .on_click(move |_: &ClickEvent, _, cx| {
                                act(
                                    &reset,
                                    cx,
                                    "settingsGeneralBackgroundActivity",
                                    json!({ "intent": { "kind": "reset-all" } }),
                                );
                            }),
                    )
                    .child(
                        Button::new("general-background-done")
                            .label(model.done_label.clone())
                            .on_click(move |_: &ClickEvent, _, cx| {
                                act(
                                    &done,
                                    cx,
                                    "settingsGeneralBackgroundActivityDialog",
                                    json!({ "open": false }),
                                );
                            }),
                    ),
            )
            .into_any_element()
    }
}

impl Render for GeneralSection {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return div().into_any_element();
        };
        self.sync_inputs(&view, window, cx);
        let mut stack: Vec<AnyElement> = Vec::new();
        for item in &view.layout {
            match item {
                GeneralLayoutItemView::Embedded { panel } if panel == "project-defaults" => {
                    let defaults = &view.project_defaults;
                    stack.push(
                        SettingsSection::new(defaults.section_title.clone())
                            .id(defaults.section_id.clone())
                            .children(
                                defaults
                                    .rows
                                    .iter()
                                    .map(|row| self.project_defaults_row(row, &view, cx)),
                            )
                            .into_any_element(),
                    );
                }
                GeneralLayoutItemView::Embedded { .. } => {}
                GeneralLayoutItemView::Section { key } => {
                    let Some(section) = view.sections.get(key) else {
                        continue;
                    };
                    if section.collapsible {
                        stack.push(self.legacy_section(section, &view, cx));
                        continue;
                    }
                    let mut settings_section = SettingsSection::new(section.title.clone());
                    if let Some(anchor) = section.anchor_id.clone() {
                        settings_section = settings_section.id(anchor);
                    }
                    stack.push(
                        settings_section
                            .children(self.section_items(section, &view, cx))
                            .into_any_element(),
                    );
                }
            }
        }
        let overlays: Vec<AnyElement> = [
            (TEXT_GENERATION_PICKER, view.text_generation_picker.as_ref()),
            (DEFAULT_MODEL_PICKER, view.default_model_picker.as_ref()),
        ]
        .into_iter()
        .filter_map(|(picker, control)| {
            control.and_then(|control| {
                settings_traits_menu(
                    picker,
                    control,
                    &self.menus,
                    &self.client,
                    MODEL_ACTIONS,
                    cx,
                )
            })
        })
        .chain(view.model_picker.as_ref().and_then(|popup| {
            let search = self.picker_search.clone()?;
            settings_model_picker(popup, &self.menus, &search, &self.client, MODEL_ACTIONS, cx)
        }))
        .collect();
        let token_dialog = view
            .token_streaming_warning
            .open
            .then(|| self.token_streaming_dialog(&view.token_streaming_warning));
        let background_dialog = view
            .background_activity_advanced
            .open
            .then(|| self.background_dialog(&view.background_activity_advanced, cx));
        let escape = self.client.clone();
        let token_open = view.token_streaming_warning.open;
        let background_open = view.background_activity_advanced.open;
        let dialogs = (token_open || background_open).then(|| {
            div()
                .track_focus(&self.dialog_focus)
                .on_key_down(move |event: &KeyDownEvent, _, cx| {
                    if event.keystroke.key != "escape" {
                        return;
                    }
                    cx.stop_propagation();
                    if token_open {
                        act(
                            &escape,
                            cx,
                            "settingsGeneralTokenStreamingWarning",
                            json!({ "open": false }),
                        );
                    } else {
                        act(
                            &escape,
                            cx,
                            "settingsGeneralBackgroundActivityDialog",
                            json!({ "open": false }),
                        );
                    }
                })
                .children(token_dialog)
                .children(background_dialog)
        });
        settings_stack()
            .children(stack)
            .children(overlays)
            .children(dialogs)
            .into_any_element()
    }
}
