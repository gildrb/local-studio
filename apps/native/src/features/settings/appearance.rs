use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::time::Duration;

use gpui::component::input::{Enter, InputEvent, InputState, MoveDown, MoveUp, TextareaState};
use gpui::prelude::FluentBuilder;
use gpui::{
    Animation, AnimationExt, AnyElement, App, AppContext, Bounds, ClickEvent, Context, Entity,
    Focusable, FontWeight, InteractiveElement, IntoElement, KeyDownEvent, ParentElement, Pixels,
    Render, SharedString, StatefulInteractiveElement, Styled, Window, canvas, div, font, px,
    relative, svg,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::settings_appearance::{
    AppearanceFontPreviewView, AppearanceFontRowView, AppearanceSelectRowView,
    AppearanceSettingsView, AppearanceSliderRowView, AppearanceSwitchRowView,
};
use crate::features::chat::composer_input::{prompt_content, static_token_renderer};
use crate::features::right_panel::diff::static_diff_rows;
use crate::features::settings::primitives::{
    SettingResetButton, SettingsControlWidth, SettingsGroupVariant, SettingsRow, SettingsSection,
    SettingsSelect, SettingsSelectOption, SettingsSlider, settings_stack, settings_switch,
    settings_target,
};
use crate::features::settings::themes::ThemesBlock;
use crate::features::terminal::{TerminalViewport, session};
use crate::platform::appearance::content_zoom;
use crate::platform::{DEFAULT_MONO_FONT, UI_FONT};
use crate::ui::input::bare_input;
use crate::ui::popover::{Align, Side, dropdown_glass, positioned};
use crate::ui::select::{SelectButton, SelectSize};
use crate::ui::textarea::bare_textarea;
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};

const SWATCH: f32 = 8.;
const SWATCH_GAP: f32 = 4.;
const MOTION_PREVIEW_WIDTH: f32 = 112.;
const MOTION_SLIDER_WIDTH: f32 = 208.;
const MOTION_GAP: f32 = 16.;
const MOTION_VALUE_MIN_WIDTH: f32 = 64.;
const PREVIEW_HEIGHT: f32 = 40.;
const PREVIEW_PADDING: f32 = 4.;
const PREVIEW_RADIUS: f32 = 10.;
const PREVIEW_PANEL_RADIUS: f32 = 8.;
const PREVIEW_LEFT_WIDTH: f32 = 16.;
const PREVIEW_RIGHT_WIDTH: f32 = 20.;
const PREVIEW_BAR_HEIGHT: f32 = 8.;
const PREVIEW_LINE: f32 = 2.;
const PREVIEW_LINE_GAP: f32 = 4.;
const PREVIEW_CONTENT_PADDING_X: f32 = 4.;
const PREVIEW_BAR_PADDING_X: f32 = 8.;
const ADVANCED_GAP: f32 = 8.;
const FAMILY_WIDTH: f32 = 176.;
const SIZE_WIDTH: f32 = 88.;
const FONT_CONTROL_GAP: f32 = 8.;
const PICKER_WIDTH: f32 = 288.;
const PICKER_LIST_MAX_HEIGHT: f32 = 288.;
const PICKER_SIDE_OFFSET: f32 = 4.;
const PICKER_SEARCH_PADDING_X: f32 = 12.;
const PICKER_SEARCH_PADDING_TOP: f32 = 10.;
const PICKER_SEARCH_PADDING_BOTTOM: f32 = 6.;
const PICKER_SEARCH_HEIGHT: f32 = 26.;
const PICKER_SEARCH_ICON: f32 = 16.;
const PICKER_SEARCH_ICON_TOP: f32 = 6.;
const PICKER_SEARCH_INSET: f32 = 20.;
const PICKER_LIST_PADDING: f32 = 4.;
const PICKER_ITEM_MIN_HEIGHT: f32 = 32.;
const PICKER_ITEM_PADDING_X: f32 = 8.;
const PICKER_ITEM_PADDING_Y: f32 = 4.;
const PICKER_ITEM_GAP: f32 = 8.;
const PICKER_BADGE_GAP: f32 = 6.;
const PICKER_BADGE_TEXT: f32 = 10.;
const PICKER_BADGE_LINE: f32 = 14.;
const PICKER_CHECK: f32 = 14.;
const PICKER_EMPTY_PADDING: f32 = 8.;
const PREVIEW_MARGIN_TOP: f32 = 4.;
const PREVIEW_MARGIN_BOTTOM: f32 = 8.;
const PROMPT_PADDING_X: f32 = 12.;
const PROMPT_PADDING_Y: f32 = 8.;
const PROMPT_MIN_HEIGHT: f32 = 56.;
const PROMPT_MAX_HEIGHT: f32 = 168.;
const PROMPT_LINE_RATIO: f32 = 1.625;
const TERMINAL_PREVIEW_HEIGHT: f32 = 208.;
const MONOSPACE_PROBE: f32 = 16.;

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

fn change(client: &Entity<CoreClient>, cx: &mut App, intent: Value) {
    act(
        client,
        cx,
        "settingsAppearanceChange",
        json!({ "intent": intent }),
    );
}

fn reset_button(
    client: &Entity<CoreClient>,
    id: &str,
    label: &str,
    changed: bool,
    intent: Value,
) -> Option<AnyElement> {
    changed.then(|| {
        let client = client.clone();
        SettingResetButton::new(SharedString::from(format!("{id}-reset")), label.to_string())
            .on_click(move |_, cx| change(&client, cx, intent.clone()))
            .into_any_element()
    })
}

fn installed_fonts(cx: &App) -> (Vec<String>, Vec<String>) {
    let system = cx.text_system();
    let families: Vec<String> = system
        .all_font_names()
        .into_iter()
        .filter(|name| !name.starts_with('.') && !name.is_empty())
        .collect();
    let monospace = families
        .iter()
        .filter(|family| {
            let id = system.resolve_font(&font(SharedString::from(family.to_string())));
            let narrow = system.advance(id, px(MONOSPACE_PROBE), 'i');
            let wide = system.advance(id, px(MONOSPACE_PROBE), 'W');
            match (narrow, wide) {
                (Ok(narrow), Ok(wide)) => (narrow.width - wide.width).abs() < px(0.01),
                _ => false,
            }
        })
        .cloned()
        .collect();
    (families, monospace)
}

struct MotionPreview {
    open: bool,
    toggles: u64,
}

pub struct AppearanceSection {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<AppearanceSettingsView>>>,
    prompt_editor: Option<Entity<TextareaState>>,
    terminal: Option<Entity<TerminalViewport>>,
    font_search: Option<Entity<InputState>>,
    picker_bounds: Rc<RefCell<HashMap<String, Bounds<Pixels>>>>,
    shown_picker: Option<String>,
    highlighted: usize,
    motion: MotionPreview,
    themes: Entity<ThemesBlock>,
}

impl AppearanceSection {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<AppearanceSettingsView>>(
            &client,
            "settingsAppearance",
            json!({}),
            cx,
        );
        cx.observe(&view, |_, _, cx| cx.notify()).detach();
        let (families, monospace) = installed_fonts(cx);
        act(
            &client,
            cx,
            "settingsAppearanceFonts",
            json!({ "families": families, "monospace": monospace }),
        );
        act(&client, cx, "settingsAppearanceMount", json!({}));
        let themes_client = client.clone();
        let themes = cx.new(|cx| ThemesBlock::new(themes_client, cx));
        cx.observe(&themes, |_, _, cx| cx.notify()).detach();
        Self {
            client,
            view,
            prompt_editor: None,
            terminal: None,
            font_search: None,
            picker_bounds: Rc::new(RefCell::new(HashMap::new())),
            shown_picker: None,
            highlighted: 0,
            motion: MotionPreview {
                open: true,
                toggles: 0,
            },
            themes,
        }
    }

    fn sync(&mut self, view: &AppearanceSettingsView, window: &mut Window, cx: &mut Context<Self>) {
        if self.prompt_editor.is_none() {
            let preview = &view.prompt_preview;
            let content = prompt_content(&preview.prompt, &preview.tokens);
            let editor = cx.new(|cx| {
                let mut state = TextareaState::new(window, cx);
                state.set_value(content, window, cx);
                state
            });
            self.prompt_editor = Some(editor);
        }
        let terminal_font = view
            .typography
            .font_rows
            .iter()
            .flat_map(|row| row.previews.iter())
            .find_map(|preview| match preview {
                AppearanceFontPreviewView::Terminal { family, size } => {
                    Some((family.clone(), *size))
                }
                _ => None,
            });
        if let Some((family, size)) = terminal_font {
            let family = SharedString::from(if family.trim().is_empty() {
                DEFAULT_MONO_FONT.to_string()
            } else {
                family
            });
            match &self.terminal {
                Some(viewport) => {
                    viewport.update(cx, |viewport, cx| viewport.set_font(family, size, cx));
                }
                None => {
                    let terminal_session = session(&self.client, &view.terminal_preview_key, cx);
                    self.terminal = Some(
                        cx.new(|cx| TerminalViewport::new(terminal_session, family, size, cx)),
                    );
                }
            }
        }
        let search = match &self.font_search {
            Some(search) => search.clone(),
            None => {
                let search = cx.new(|cx| InputState::new(window, cx));
                let client = self.client.clone();
                cx.subscribe_in(
                    &search,
                    window,
                    move |section: &mut Self, search, event: &InputEvent, _, cx| {
                        if let InputEvent::Change = event {
                            section.highlighted = 0;
                            let query = search.read(cx).value().to_string();
                            act(
                                &client,
                                cx,
                                "settingsAppearanceFontQuery",
                                json!({ "query": query }),
                            );
                        }
                    },
                )
                .detach();
                self.font_search = Some(search.clone());
                search
            }
        };
        let open = view
            .typography
            .font_rows
            .iter()
            .find(|row| row.picker.open)
            .map(|row| (row.font.clone(), row.picker.search_placeholder.clone()));
        let open_font = open.as_ref().map(|(font, _)| font.clone());
        if open_font != self.shown_picker {
            self.shown_picker = open_font;
            if let Some((_, placeholder)) = open {
                self.highlighted = 0;
                search.update(cx, |state, cx| {
                    state.set_value("", window, cx);
                    state.set_placeholder(placeholder, window, cx);
                    state.focus(window, cx);
                });
            }
        }
    }

    fn slider_row(&self, row: &AppearanceSliderRowView) -> SettingsRow {
        let client = self.client.clone();
        let setting = row.setting.clone();
        let mut settings_row = SettingsRow::new(row.id.clone(), row.title.clone())
            .description(row.description.clone());
        if let Some(reset) = reset_button(
            &self.client,
            &row.id,
            &row.reset_label,
            row.changed,
            json!({ "kind": "reset", "setting": row.setting }),
        ) {
            settings_row = settings_row.reset_action(reset);
        }
        settings_row.control(
            SettingsSlider::new(row.input_id.clone(), row.value, row.min, row.max, row.step)
                .value_label(row.value_label.clone())
                .accessibility_label(row.aria_label.clone())
                .on_change(move |value, _, cx| {
                    change(
                        &client,
                        cx,
                        json!({ "kind": "slider", "setting": setting, "value": value }),
                    );
                }),
        )
    }

    fn select_row(&self, row: &AppearanceSelectRowView, leading: Option<AnyElement>) -> AnyElement {
        let client = self.client.clone();
        let setting = row.setting.clone();
        let mut settings_row = SettingsRow::new(row.id.clone(), row.title.clone())
            .description(row.description.clone());
        if let Some(reset) = reset_button(
            &self.client,
            &row.id,
            &row.reset_label,
            row.changed,
            json!({ "kind": "reset", "setting": row.setting }),
        ) {
            settings_row = settings_row.reset_action(reset);
        }
        let mut select = SettingsSelect::new(SharedString::from(format!("{}-select", row.id)))
            .options(row.options.iter().map(|option| {
                SettingsSelectOption::new(option.value.clone(), option.label.clone())
            }))
            .value(Some(row.value.clone()))
            .value_label(row.value_label.clone())
            .accessibility_label(row.aria_label.clone())
            .on_change(move |value, _, cx| {
                change(
                    &client,
                    cx,
                    json!({ "kind": "select", "setting": setting, "value": value.to_string() }),
                );
            });
        if let Some(leading) = leading {
            select = select.leading(leading);
        }
        settings_row.control(select).into_any_element()
    }

    fn switch_row(&self, row: &AppearanceSwitchRowView) -> AnyElement {
        let client = self.client.clone();
        let setting = row.setting.clone();
        let mut settings_row = SettingsRow::new(row.id.clone(), row.title.clone())
            .description(row.description.clone());
        if let Some(reset) = reset_button(
            &self.client,
            &row.id,
            &row.reset_label,
            row.changed,
            json!({ "kind": "reset", "setting": row.setting }),
        ) {
            settings_row = settings_row.reset_action(reset);
        }
        settings_row
            .control(
                settings_switch(
                    SharedString::from(format!("{}-switch", row.id)),
                    row.checked,
                )
                .accessibility_label(row.aria_label.clone())
                .on_change(move |checked, _, _, cx| {
                    change(
                        &client,
                        cx,
                        json!({ "kind": "toggle", "setting": setting, "checked": checked }),
                    );
                }),
            )
            .into_any_element()
    }

    fn swatches(reversed: bool, t: &Tokens) -> AnyElement {
        let dot = |color| {
            div()
                .flex_none()
                .size(px(SWATCH))
                .rounded(px(radius::FULL))
                .bg(color)
        };
        div()
            .flex()
            .flex_none()
            .gap(px(SWATCH_GAP))
            .when(reversed, |this| this.flex_row_reverse())
            .child(dot(t.diff_deletion))
            .child(dot(t.diff_addition))
            .into_any_element()
    }

    fn motion_preview(&self, duration_ms: f64, cx: &mut Context<Self>) -> AnyElement {
        let t = theme::active(cx);
        let open = self.motion.open;
        let toggles = self.motion.toggles;
        let duration = Duration::from_millis(duration_ms.max(0.) as u64);
        let animate = toggles > 0 && !duration.is_zero();
        let target = |open: bool, size: f32| if open { size } else { 0. };
        let panel = |id: &'static str, width: f32, color: gpui::Rgba| {
            let base = div()
                .h_full()
                .flex_none()
                .overflow_hidden()
                .rounded(px(PREVIEW_PANEL_RADIUS))
                .bg(color);
            if animate {
                let from = target(!open, width);
                let to = target(open, width);
                base.with_animation(
                    SharedString::from(format!("motion-{id}-{toggles}")),
                    Animation::new(duration).with_easing(gpui::ease_out_quint()),
                    move |this, delta| this.w(px(from + (to - from) * delta)),
                )
                .into_any_element()
            } else {
                base.w(px(target(open, width))).into_any_element()
            }
        };
        let bar_base = div()
            .flex()
            .flex_none()
            .items_center()
            .overflow_hidden()
            .bg(fade(t.foreground, 0.05))
            .px(px(PREVIEW_BAR_PADDING_X))
            .child(
                div()
                    .h(px(1.))
                    .w(relative(2. / 3.))
                    .rounded(px(radius::FULL))
                    .bg(fade(t.muted_foreground, 0.25)),
            );
        let bar_border = fade(t.border, 0.7);
        let bar = if animate {
            let from = target(!open, PREVIEW_BAR_HEIGHT);
            let to = target(open, PREVIEW_BAR_HEIGHT);
            bar_base
                .with_animation(
                    SharedString::from(format!("motion-bar-{toggles}")),
                    Animation::new(duration).with_easing(gpui::ease_out_quint()),
                    move |this, delta| {
                        let height = from + (to - from) * delta;
                        this.h(px(height)).when(height > 0., |this| {
                            this.border_t_1().border_color(bar_border)
                        })
                    },
                )
                .into_any_element()
        } else {
            bar_base
                .h(px(target(open, PREVIEW_BAR_HEIGHT)))
                .when(open, |this| this.border_t_1().border_color(bar_border))
                .into_any_element()
        };
        let line = |fraction: f32, opacity: f32| {
            div()
                .h(px(PREVIEW_LINE))
                .w(relative(fraction))
                .rounded(px(radius::FULL))
                .bg(fade(t.muted_foreground, opacity))
        };
        div()
            .id("panel-animations-preview")
            .flex()
            .flex_none()
            .w(px(MOTION_PREVIEW_WIDTH))
            .h(px(PREVIEW_HEIGHT))
            .p(px(PREVIEW_PADDING))
            .overflow_hidden()
            .rounded(px(PREVIEW_RADIUS))
            .border_1()
            .border_color(t.border)
            .bg(t.background)
            .cursor_pointer()
            .on_click(cx.listener(|section, _: &ClickEvent, _, cx| {
                section.motion.open = !section.motion.open;
                section.motion.toggles += 1;
                cx.notify();
            }))
            .child(panel("left", PREVIEW_LEFT_WIDTH, t.sidebar))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .px(px(PREVIEW_CONTENT_PADDING_X))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_h_0()
                            .gap(px(PREVIEW_LINE_GAP))
                            .pt(px(PREVIEW_LINE_GAP))
                            .child(line(1., 0.25))
                            .child(line(0.8, 0.2))
                            .child(line(0.6, 0.15)),
                    )
                    .child(bar),
            )
            .child(panel("right", PREVIEW_RIGHT_WIDTH, t.muted))
            .into_any_element()
    }

    fn font_picker(
        &self,
        row: &AppearanceFontRowView,
        t: &Tokens,
        window: &mut Window,
        cx: &App,
    ) -> Option<AnyElement> {
        if !row.picker.open {
            return None;
        }
        let bounds = self.picker_bounds.borrow().get(&row.font).copied()?;
        let search = self.font_search.clone()?;
        let focused = search.read(cx).focus_handle(cx).is_focused(window);
        let picker = &row.picker;
        let count = picker.items.len();
        let highlighted = self.highlighted.min(count.saturating_sub(1));
        let items = picker.items.iter().enumerate().map(|(index, item)| {
            let client = self.client.clone();
            let font_key = row.font.clone();
            let value = item.value.clone();
            let lit = index == highlighted;
            let hover_bg = t.accent;
            div()
                .id(SharedString::from(format!(
                    "font-picker-{}-{}",
                    row.font, item.value
                )))
                .flex()
                .items_center()
                .min_h(px(PICKER_ITEM_MIN_HEIGHT))
                .px(px(PICKER_ITEM_PADDING_X))
                .py(px(PICKER_ITEM_PADDING_Y))
                .rounded(px(radius::SM))
                .text_size(px(text::SM))
                .line_height(px(text::SM_LINE))
                .text_color(t.foreground)
                .cursor_pointer()
                .when(item.selected, |this| this.bg(fade(t.foreground, 0.08)))
                .when(lit, |this| {
                    this.bg(t.accent).text_color(t.accent_foreground)
                })
                .hover(move |s| s.bg(hover_bg))
                .on_click(move |_: &ClickEvent, _, cx| {
                    act(
                        &client,
                        cx,
                        "settingsAppearanceFontPick",
                        json!({ "font": font_key, "value": value }),
                    );
                })
                .child(
                    div()
                        .flex()
                        .w_full()
                        .min_w_0()
                        .items_center()
                        .justify_between()
                        .gap(px(PICKER_ITEM_GAP))
                        .child(
                            div()
                                .min_w_0()
                                .truncate()
                                .font_family(SharedString::from(item.family.clone()))
                                .child(SharedString::from(item.family.clone())),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_none()
                                .items_center()
                                .gap(px(PICKER_BADGE_GAP))
                                .when(item.is_default, |this| {
                                    this.child(
                                        div()
                                            .text_size(px(PICKER_BADGE_TEXT))
                                            .line_height(px(PICKER_BADGE_LINE))
                                            .text_color(fade(t.muted_foreground, 0.6))
                                            .child(SharedString::from(
                                                picker.default_badge_label.clone(),
                                            )),
                                    )
                                })
                                .when(item.selected, |this| {
                                    this.child(
                                        svg()
                                            .path("icons/check.svg")
                                            .flex_none()
                                            .size(px(PICKER_CHECK))
                                            .text_color(t.muted_foreground),
                                    )
                                }),
                        ),
                )
                .into_any_element()
        });
        let list: AnyElement = if count == 0 {
            div()
                .p(px(PICKER_EMPTY_PADDING))
                .text_center()
                .text_size(px(text::SM))
                .line_height(px(text::SM_LINE))
                .text_color(t.muted_foreground)
                .child(SharedString::from(picker.empty_label.clone()))
                .into_any_element()
        } else {
            div()
                .id(SharedString::from(format!("font-picker-list-{}", row.font)))
                .flex()
                .flex_col()
                .max_h(px(PICKER_LIST_MAX_HEIGHT))
                .overflow_y_scroll()
                .p(px(PICKER_LIST_PADDING))
                .children(items)
                .into_any_element()
        };
        let items_for_enter: Vec<String> =
            picker.items.iter().map(|item| item.value.clone()).collect();
        let close = self.client.clone();
        let dismiss = self.client.clone();
        let enter = self.client.clone();
        let font_key = row.font.clone();
        let surface = dropdown_glass(cx)
            .id(SharedString::from(format!("font-picker-{}", row.font)))
            .occlude()
            .flex()
            .flex_col()
            .w(px(PICKER_WIDTH))
            .overflow_hidden()
            .on_mouse_down_out(move |event, _, cx| {
                if !bounds.contains(&event.position) {
                    act(
                        &dismiss,
                        cx,
                        "settingsAppearanceFontPicker",
                        json!({ "font": null }),
                    );
                }
            })
            .on_key_down(move |event: &KeyDownEvent, _, cx| {
                if event.keystroke.key == "escape" {
                    cx.stop_propagation();
                    act(
                        &close,
                        cx,
                        "settingsAppearanceFontPicker",
                        json!({ "font": null }),
                    );
                }
            })
            .capture_action(move |_: &Enter, _, cx| {
                cx.stop_propagation();
                if let Some(value) = items_for_enter.get(highlighted) {
                    act(
                        &enter,
                        cx,
                        "settingsAppearanceFontPick",
                        json!({ "font": font_key, "value": value }),
                    );
                }
            })
            .child(
                div()
                    .flex_none()
                    .min_w_0()
                    .px(px(PICKER_SEARCH_PADDING_X))
                    .pt(px(PICKER_SEARCH_PADDING_TOP))
                    .child(
                        div()
                            .relative()
                            .pb(px(PICKER_SEARCH_PADDING_BOTTOM))
                            .border_b_1()
                            .border_color(if focused { t.ring } else { fade(t.border, 0.7) })
                            .child(
                                svg()
                                    .path("icons/search.svg")
                                    .absolute()
                                    .left_0()
                                    .top(px(PICKER_SEARCH_ICON_TOP))
                                    .size(px(PICKER_SEARCH_ICON))
                                    .text_color(fade(t.muted_foreground, 0.55)),
                            )
                            .child(bare_input(
                                &search,
                                PICKER_SEARCH_HEIGHT,
                                PICKER_SEARCH_INSET,
                                0.,
                                text::SM,
                                false,
                            )),
                    ),
            )
            .child(list);
        Some(
            positioned(
                bounds,
                Side::Bottom,
                Align::End,
                PICKER_SIDE_OFFSET,
                0.,
                surface,
            )
            .into_any_element(),
        )
    }

    fn font_row(
        &self,
        row: &AppearanceFontRowView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let client = self.client.clone();
        let font_key = row.font.clone();
        let open = row.picker.open;
        let bounds_store = self.picker_bounds.clone();
        let measure_key = row.font.clone();
        let family = div()
            .relative()
            .flex_none()
            .w(px(FAMILY_WIDTH))
            .child(
                SelectButton::new(SharedString::from(format!("{}-family", row.id)))
                    .size(SelectSize::Sm)
                    .label(row.picker.trigger_label.clone())
                    .pressed(open)
                    .on_click(move |_, _, cx| {
                        act(
                            &client,
                            cx,
                            "settingsAppearanceFontPicker",
                            json!({ "font": if open { Value::Null } else { json!(font_key) } }),
                        );
                    }),
            )
            .child(
                canvas(
                    move |bounds, _, _| {
                        bounds_store
                            .borrow_mut()
                            .insert(measure_key.clone(), bounds);
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .top_0()
                .left_0()
                .size_full(),
            );
        let size_client = self.client.clone();
        let size_font = row.font.clone();
        let size = SettingsSelect::new(SharedString::from(format!("{}-size", row.id)))
            .options(row.size.options.iter().map(|option| {
                SettingsSelectOption::new(option.value.clone(), option.label.clone())
            }))
            .value(Some(row.size.selected_value.clone()))
            .value_label(row.size.value_label.clone())
            .width(SettingsControlWidth::Fixed(SIZE_WIDTH))
            .accessibility_label(row.size.aria_label.clone())
            .on_change(move |value, _, cx| {
                change(
                    &size_client,
                    cx,
                    json!({ "kind": "fontSize", "font": size_font, "value": value.to_string() }),
                );
            });
        let mut settings_row = SettingsRow::new(row.id.clone(), row.title.clone())
            .description(row.description.clone())
            .control(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(FONT_CONTROL_GAP))
                    .child(family)
                    .child(size),
            );
        if let Some(reset) = reset_button(
            &self.client,
            &row.id,
            &row.reset_label,
            row.changed,
            json!({ "kind": "resetFont", "font": row.font }),
        ) {
            settings_row = settings_row.reset_action(reset);
        }
        let previews = row
            .previews
            .iter()
            .filter_map(|preview| self.preview(row, preview, t, cx));
        settings_row.children(previews).into_any_element()
    }

    fn preview(
        &self,
        row: &AppearanceFontRowView,
        preview: &AppearanceFontPreviewView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        match preview {
            AppearanceFontPreviewView::Prompt => {
                let editor = self.prompt_editor.clone()?;
                let view = self.view.read(cx).data.clone().flatten()?;
                let family = if row.trimmed_value.is_empty() {
                    UI_FONT.to_string()
                } else {
                    row.trimmed_value.clone()
                };
                let size = row.size.selected_value.parse::<f32>().unwrap_or(text::SM);
                Some(
                    div()
                        .mt(px(PREVIEW_MARGIN_TOP))
                        .mb(px(PREVIEW_MARGIN_BOTTOM))
                        .rounded(px(PREVIEW_RADIUS))
                        .border_1()
                        .border_color(t.border)
                        .bg(t.background)
                        .px(px(PROMPT_PADDING_X))
                        .py(px(PROMPT_PADDING_Y))
                        .font_family(SharedString::from(family))
                        .child(
                            bare_textarea(
                                &editor,
                                PROMPT_MIN_HEIGHT,
                                PROMPT_MAX_HEIGHT,
                                0.,
                                0.,
                                false,
                            )
                            .items_start()
                            .text_size(px(size / content_zoom(cx)))
                            .line_height(px(size / content_zoom(cx) * PROMPT_LINE_RATIO))
                            .token(static_token_renderer(&view.prompt_preview.tokens)),
                        )
                        .into_any_element(),
                )
            }
            AppearanceFontPreviewView::Code => {
                let view = self.view.read(cx).data.clone().flatten()?;
                if view.code_preview.is_empty() {
                    return None;
                }
                let client = self.client.clone();
                Some(
                    div()
                        .mt(px(PREVIEW_MARGIN_TOP))
                        .mb(px(PREVIEW_MARGIN_BOTTOM))
                        .child(static_diff_rows(&view.code_preview, &client, cx))
                        .into_any_element(),
                )
            }
            AppearanceFontPreviewView::Terminal { .. } => {
                let viewport = self.terminal.clone()?;
                Some(
                    div()
                        .relative()
                        .mt(px(PREVIEW_MARGIN_TOP))
                        .mb(px(PREVIEW_MARGIN_BOTTOM))
                        .h(px(TERMINAL_PREVIEW_HEIGHT))
                        .overflow_hidden()
                        .rounded(px(PREVIEW_RADIUS))
                        .border_1()
                        .border_color(t.border)
                        .bg(t.terminal_background)
                        .child(viewport)
                        .into_any_element(),
                )
            }
        }
    }
}

impl Render for AppearanceSection {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return div().into_any_element();
        };
        self.sync(&view, window, cx);
        let t = theme::active(cx);
        let interface = &view.interface;
        let mut interface_rows: Vec<AnyElement> = vec![
            self.slider_row(&interface.contrast).into_any_element(),
            self.slider_row(&interface.glass_opacity).into_any_element(),
        ];
        if let Some(row) = interface.environment_identification.as_ref() {
            interface_rows.push(self.select_row(row, None));
        }
        interface_rows.push(self.select_row(
            &interface.diff_colors,
            Some(Self::swatches(interface.diff_colors.swatches_reversed, &t)),
        ));
        interface_rows.push(self.select_row(&interface.chat_width, None));
        let motion_row = &view.motion.panel_animations;
        let motion_client = self.client.clone();
        let motion_setting = motion_row.setting.clone();
        let mut motion = SettingsRow::new(motion_row.id.clone(), motion_row.title.clone())
            .description(motion_row.description.clone())
            .control(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(MOTION_GAP))
                    .child(self.motion_preview(motion_row.value, cx))
                    .child(
                        SettingsSlider::new(
                            motion_row.input_id.clone(),
                            motion_row.value,
                            motion_row.min,
                            motion_row.max,
                            motion_row.step,
                        )
                        .value_label(motion_row.value_label.clone())
                        .value_min_width(MOTION_VALUE_MIN_WIDTH)
                        .width(MOTION_SLIDER_WIDTH)
                        .accessibility_label(motion_row.aria_label.clone())
                        .on_change(move |value, _, cx| {
                            change(
                                &motion_client,
                                cx,
                                json!({ "kind": "slider", "setting": motion_setting, "value": value }),
                            );
                        }),
                    ),
            );
        if let Some(reset) = reset_button(
            &self.client,
            &motion_row.id,
            &motion_row.reset_label,
            motion_row.changed,
            json!({ "kind": "reset", "setting": motion_row.setting }),
        ) {
            motion = motion.reset_action(reset);
        }
        let typography = &view.typography;
        let advanced_client = self.client.clone();
        let advanced = typography.advanced;
        let header_action = div()
            .flex()
            .items_center()
            .gap(px(ADVANCED_GAP))
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .font_weight(FontWeight::MEDIUM)
            .text_color(t.muted_foreground)
            .child(SharedString::from(typography.advanced_label.clone()))
            .child(
                settings_switch("typography-advanced", advanced)
                    .accessibility_label(typography.advanced_aria_label.clone())
                    .on_change(move |checked, _, _, cx| {
                        act(
                            &advanced_client,
                            cx,
                            "settingsAppearanceAdvanced",
                            json!({ "advanced": checked }),
                        );
                    }),
            );
        let mut typography_rows: Vec<AnyElement> = typography
            .font_rows
            .iter()
            .map(|row| self.font_row(row, &t, cx))
            .collect();
        if let Some(row) = typography.font_smoothing.as_ref() {
            typography_rows.push(self.switch_row(row));
        }
        typography_rows.push(self.switch_row(&typography.word_wrap));
        let pickers: Vec<AnyElement> = typography
            .font_rows
            .iter()
            .filter_map(|row| self.font_picker(row, &t, window, cx))
            .collect();
        let up_count = typography
            .font_rows
            .iter()
            .find(|row| row.picker.open)
            .map_or(0, |row| row.picker.items.len());
        settings_stack()
            .capture_action(cx.listener(move |section, _: &MoveUp, _, cx| {
                if section.shown_picker.is_some() && up_count > 0 {
                    cx.stop_propagation();
                    section.highlighted = section.highlighted.saturating_sub(1);
                    cx.notify();
                }
            }))
            .capture_action(cx.listener(move |section, _: &MoveDown, _, cx| {
                if section.shown_picker.is_some() && up_count > 0 {
                    cx.stop_propagation();
                    section.highlighted = (section.highlighted + 1).min(up_count - 1);
                    cx.notify();
                }
            }))
            .child(
                SettingsSection::new(view.themes.section_title.clone())
                    .id(view.themes.section_id.clone())
                    .hide_title()
                    .variant(SettingsGroupVariant::Plain)
                    .child(settings_target(
                        view.themes.anchor_id.clone(),
                        self.themes.clone(),
                        cx,
                    )),
            )
            .child(
                SettingsSection::new(interface.title.clone())
                    .id(interface.section_id.clone())
                    .children(interface_rows),
            )
            .child(
                SettingsSection::new(view.motion.title.clone())
                    .id(view.motion.section_id.clone())
                    .child(motion),
            )
            .child(
                SettingsSection::new(typography.title.clone())
                    .id(typography.section_id.clone())
                    .header_action(header_action)
                    .children(typography_rows),
            )
            .children(pickers)
            .into_any_element()
    }
}
