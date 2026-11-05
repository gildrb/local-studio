use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use gpui::component::input::{InputEvent, InputState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, Bounds, Context, Entity, FocusHandle, FontWeight,
    InteractiveElement, IntoElement, KeyDownEvent, KeystrokeEvent, MouseButton, ParentElement,
    Pixels, Render, SharedString, StatefulInteractiveElement, Styled, Subscription, Window, canvas,
    div, px, svg,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::settings_keybindings::{
    KeybindingKeyInputView, KeybindingRowView, KeybindingWarningView, KeybindingWhenTriggerView,
    KeybindingsSettingsView, NewKeybindingView, WhenBuilderView, WhenNodeView,
};
use crate::features::settings::primitives::{SettingsRow, SettingsSection};
use crate::platform::MONO_FONT;
use crate::ui::badge::{Badge, BadgeSize, BadgeVariant};
use crate::ui::button::{Button, ButtonSize, ButtonVariant, resolve_corners, rounded};
use crate::ui::input::{InputSize, decorate, field_look};
use crate::ui::input_group::{AddonAlign, InputGroup, InputGroupAddon};
use crate::ui::kbd::{Kbd, KbdGroup};
use crate::ui::menu::{MenuItem, MenuItemVariant, MenuPopup, icon};
use crate::ui::popover::{Align, Side, dropdown_glass, positioned_with_priority};
use crate::ui::select::{Select, SelectItem, SelectSize};
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::toggle::{Toggle, ToggleSize, ToggleVariant};
use crate::ui::tooltip::Tooltip;

const NEW_TARGET: &str = "new";
const HEADER_GAP: f32 = 6.;
const SEARCH_WIDTH: f32 = 176.;
const KEY_INPUT_WIDTH: f32 = 176.;
const KEY_INPUT_HEIGHT: f32 = 28.;
const KEY_INPUT_PADDING_X: f32 = 9.;
const COMMAND_SELECT_WIDTH: f32 = 224.;
const CONTROL_GAP: f32 = 6.;
const NEW_CONTROL_GAP: f32 = 8.;
const PILL_HEIGHT: f32 = 28.;
const PILL_PADDING_X: f32 = 6.;
const WARNING_BOX: f32 = 20.;
const WARNING_BOX_SMALL: f32 = 18.;
const WARNING_ICON: f32 = 14.;
const WHEN_ROW_HEIGHT: f32 = 24.;
const WHEN_GAP: f32 = 6.;
const WHEN_CHEVRON: f32 = 14.;
const WHEN_CHEVRON_OPACITY: f32 = 0.6;
const WHEN_PREFIX_OPACITY: f32 = 0.7;
const EMPTY_PADDING_Y: f32 = 48.;
const EMPTY_PADDING_X: f32 = 16.;
const NEW_ROW_FILL: f32 = 0.15;
const BUILDER_WIDTH: f32 = 544.;
const BUILDER_PADDING: f32 = 16.;
const BUILDER_GAP: f32 = 12.;
const BUILDER_INPUT_GAP: f32 = 6.;
const BUILDER_SIDE_OFFSET: f32 = 6.;
const BUILDER_PRIORITY: usize = 2;
const NESTED_PRIORITY: usize = 3;
const NODE_GAP: f32 = 8.;
const NODE_PADDING: f32 = 8.;
const NODE_INDENT: f32 = 16.;
const NODE_LINE_LEFT: f32 = 6.;
const NODE_LINE_TOP: f32 = 16.;
const NODE_LINE_WIDTH: f32 = 10.;
const NEGATE_MIN_WIDTH: f32 = 40.;
const OPERATOR_WIDTH: f32 = 96.;
const REMOVE_SIZE: f32 = 28.;
const NESTED_MAX_HEIGHT: f32 = 288.;
const NESTED_ITEM_HEIGHT: f32 = 28.;
const DISMISS_SLOP: f32 = 8.;
const ICON_BUTTON_GLYPH: f32 = 14.;

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

fn dom_key(key: &str) -> String {
    match key {
        "space" => " ".into(),
        "up" => "ArrowUp".into(),
        "down" => "ArrowDown".into(),
        "left" => "ArrowLeft".into(),
        "right" => "ArrowRight".into(),
        "escape" => "Escape".into(),
        "enter" => "Enter".into(),
        "tab" => "Tab".into(),
        "backspace" => "Backspace".into(),
        "delete" => "Delete".into(),
        "home" => "Home".into(),
        "end" => "End".into(),
        "pageup" => "PageUp".into(),
        "pagedown" => "PageDown".into(),
        other => other.into(),
    }
}

#[derive(Clone, PartialEq)]
enum NestedKind {
    Identifier,
    Operator,
}

#[derive(Clone)]
struct NestedSelect {
    id: String,
    path: Vec<u32>,
    kind: NestedKind,
    value: String,
    options: Vec<(String, String)>,
}

#[derive(Default)]
struct Anchors {
    when: HashMap<String, Bounds<Pixels>>,
    menu: HashMap<String, Bounds<Pixels>>,
    nested: HashMap<String, Bounds<Pixels>>,
    nested_menu: Option<Bounds<Pixels>>,
}

type SharedAnchors = Rc<RefCell<Anchors>>;

fn measure(
    anchors: &SharedAnchors,
    slot: fn(&mut Anchors) -> &mut HashMap<String, Bounds<Pixels>>,
    key: String,
) -> impl IntoElement {
    let anchors = anchors.clone();
    canvas(
        move |bounds, _, _| {
            slot(&mut anchors.borrow_mut()).insert(key, bounds);
        },
        |_, _, _, _| {},
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full()
}

pub struct KeybindingsSection {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<KeybindingsSettingsView>>>,
    search: Option<Entity<InputState>>,
    search_revision: u64,
    key_focus: HashMap<String, FocusHandle>,
    recording: HashSet<String>,
    expression: Option<Entity<InputState>>,
    expression_value: Option<String>,
    anchors: SharedAnchors,
    nested: Option<NestedSelect>,
    this: gpui::WeakEntity<Self>,
    _keystrokes: Subscription,
}

impl KeybindingsSection {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<KeybindingsSettingsView>>(
            &client,
            "settingsKeybindings",
            json!({}),
            cx,
        );
        cx.observe(&view, |_, _, cx| cx.notify()).detach();
        act(&client, cx, "settingsKeybindingsMount", json!({}));
        let keystrokes =
            cx.observe_keystrokes(|section: &mut Self, event: &KeystrokeEvent, _, cx| {
                section.on_keystroke(event, cx)
            });
        Self {
            client,
            view,
            search: None,
            search_revision: 0,
            key_focus: HashMap::new(),
            recording: HashSet::new(),
            expression: None,
            expression_value: None,
            anchors: Rc::new(RefCell::new(Anchors::default())),
            nested: None,
            this: cx.entity().downgrade(),
            _keystrokes: keystrokes,
        }
    }

    fn on_keystroke(&mut self, event: &KeystrokeEvent, cx: &mut Context<Self>) {
        if self
            .view
            .read(cx)
            .data
            .as_ref()
            .and_then(Option::as_ref)
            .is_none()
        {
            return;
        }
        if event
            .context_stack
            .iter()
            .any(|context| context.contains("Input") || context.contains("TextArea"))
        {
            return;
        }
        let keystroke = &event.keystroke;
        let modifiers = keystroke.modifiers;
        act(
            &self.client,
            cx,
            "settingsKeybindingsSearchShortcut",
            json!({
                "key": keystroke.key,
                "metaKey": modifiers.platform,
                "ctrlKey": modifiers.control,
                "altKey": modifiers.alt,
            }),
        );
    }

    fn sync(
        &mut self,
        view: &KeybindingsSettingsView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if view.search.is_open {
            let state = match &self.search {
                Some(state) => state.clone(),
                None => {
                    let state = cx.new(|cx| InputState::new(window, cx));
                    let client = self.client.clone();
                    cx.subscribe_in(
                        &state,
                        window,
                        move |section: &mut Self, state, event: &InputEvent, _, cx| match event {
                            InputEvent::Change => {
                                let query = state.read(cx).value().to_string();
                                act(
                                    &client,
                                    cx,
                                    "settingsKeybindingsSearch",
                                    json!({ "query": query }),
                                );
                            }
                            InputEvent::Blur => {
                                let close = section
                                    .view
                                    .read(cx)
                                    .data
                                    .as_ref()
                                    .and_then(Option::as_ref)
                                    .is_some_and(|view| view.search.close_on_blur);
                                if close {
                                    act(
                                        &client,
                                        cx,
                                        "settingsKeybindingsSearchOpen",
                                        json!({ "open": false }),
                                    );
                                }
                            }
                            _ => {}
                        },
                    )
                    .detach();
                    self.search = Some(state.clone());
                    state
                }
            };
            state.update(cx, |state, cx| {
                state.set_placeholder(view.search.label.clone(), window, cx);
                if state.value() != view.search.query.as_str() {
                    state.set_value(view.search.query.clone(), window, cx);
                }
            });
            if self.search_revision != view.search_focus_revision {
                self.search_revision = view.search_focus_revision;
                state.update(cx, |state, cx| {
                    state.focus(window, cx);
                    state.select_all(window, cx);
                });
            }
        } else {
            self.search = None;
            self.search_revision = view.search_focus_revision;
        }

        let mut targets: Vec<(String, bool)> = view
            .rows
            .iter()
            .map(|row| {
                (
                    row.id.clone(),
                    row.editor.is_recording && row.editor.pill.is_none(),
                )
            })
            .collect();
        if let Some(new_binding) = &view.new_binding {
            targets.push((NEW_TARGET.to_string(), new_binding.is_recording));
        }
        let live: HashSet<String> = targets.iter().map(|(id, _)| id.clone()).collect();
        self.key_focus.retain(|id, _| live.contains(id));
        let mut recording = HashSet::new();
        for (target, is_recording) in targets {
            let handle = self.focus_for(&target, window, cx);
            if is_recording {
                if !self.recording.contains(&target) && !handle.is_focused(window) {
                    handle.focus(window, cx);
                }
                recording.insert(target);
            }
        }
        self.recording = recording;

        match &view.when_builder {
            Some(builder) => {
                let state = match &self.expression {
                    Some(state) => state.clone(),
                    None => {
                        let state = cx.new(|cx| InputState::new(window, cx));
                        let client = self.client.clone();
                        cx.subscribe_in(
                            &state,
                            window,
                            move |section: &mut Self, state, event: &InputEvent, _, cx| {
                                if let InputEvent::Change = event {
                                    let value = state.read(cx).value().to_string();
                                    if section.expression_value.as_deref() == Some(value.as_str()) {
                                        return;
                                    }
                                    section.expression_value = Some(value.clone());
                                    act(
                                        &client,
                                        cx,
                                        "settingsKeybindingsWhenExpression",
                                        json!({ "value": value }),
                                    );
                                }
                            },
                        )
                        .detach();
                        self.expression = Some(state.clone());
                        state
                    }
                };
                let value = builder.expression_input.value.clone();
                if self.expression_value.as_deref() != Some(value.as_str()) {
                    self.expression_value = Some(value.clone());
                    state.update(cx, |state, cx| {
                        state.set_placeholder(
                            builder.expression_input.placeholder.clone(),
                            window,
                            cx,
                        );
                        if state.value() != value.as_str() {
                            state.set_value(value, window, cx);
                        }
                    });
                }
            }
            None => {
                self.expression = None;
                self.expression_value = None;
                self.nested = None;
            }
        }
    }

    fn focus_for(
        &mut self,
        target: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> FocusHandle {
        if let Some(handle) = self.key_focus.get(target) {
            return handle.clone();
        }
        let handle = cx.focus_handle();
        let focus_client = self.client.clone();
        let focus_target = target.to_string();
        cx.on_focus(&handle, window, move |_, _, cx| {
            act(
                &focus_client,
                cx,
                "settingsKeybindingsDraft",
                json!({ "target": focus_target, "intent": { "kind": "startRecording" } }),
            );
        })
        .detach();
        let blur_client = self.client.clone();
        let blur_target = target.to_string();
        cx.on_blur(&handle, window, move |_, _, cx| {
            act(
                &blur_client,
                cx,
                "settingsKeybindingsDraft",
                json!({ "target": blur_target, "intent": { "kind": "stopRecording" } }),
            );
        })
        .detach();
        self.key_focus.insert(target.to_string(), handle.clone());
        handle
    }

    fn icon_button(
        &self,
        id: &'static str,
        icon_name: &'static str,
        label: &str,
        disabled: bool,
        action: &'static str,
        params: Value,
    ) -> AnyElement {
        let client = self.client.clone();
        div()
            .id(SharedString::from(format!("{id}-tip")))
            .flex_none()
            .tooltip(Tooltip::text(label.to_string()))
            .child(
                Button::new(id)
                    .size(ButtonSize::IconXs)
                    .variant(ButtonVariant::GhostMuted)
                    .icon(icon_name)
                    .disabled(disabled)
                    .accessibility_label(label.to_string())
                    .on_click(move |_, _, cx| act(&client, cx, action, params.clone())),
            )
            .into_any_element()
    }

    fn header_action(&self, view: &KeybindingsSettingsView, t: &Tokens) -> AnyElement {
        let search = match (&self.search, view.search.is_open) {
            (Some(state), true) => {
                let client = self.client.clone();
                div()
                    .w(px(SEARCH_WIDTH))
                    .flex_none()
                    .on_key_down(move |event: &KeyDownEvent, _, cx| {
                        if event.keystroke.key == "escape" {
                            cx.stop_propagation();
                            act(&client, cx, "settingsKeybindingsSearchEscape", json!({}));
                        }
                    })
                    .child(
                        InputGroup::input(state)
                            .size(InputSize::Sm)
                            .addon(InputGroupAddon::new(AddonAlign::InlineStart).icon("search")),
                    )
                    .into_any_element()
            }
            _ => div()
                .flex()
                .items_center()
                .gap(px(HEADER_GAP))
                .child(
                    div()
                        .text_size(px(text::XXS))
                        .line_height(px(text::XS_LINE))
                        .text_color(t.muted_foreground)
                        .child(view.bindings_count_label.clone()),
                )
                .child(self.icon_button(
                    "keybindings-search",
                    "search",
                    &view.search.label,
                    false,
                    "settingsKeybindingsSearchOpen",
                    json!({ "open": true }),
                ))
                .into_any_element(),
        };
        div()
            .flex()
            .items_center()
            .gap(px(HEADER_GAP))
            .child(search)
            .child(self.icon_button(
                "keybindings-add",
                "plus",
                &view.add_button_label,
                false,
                "settingsKeybindingsAdd",
                json!({}),
            ))
            .child(self.icon_button(
                "keybindings-open-file",
                "file-json",
                &view.open_file_button.label,
                view.open_file_button.disabled,
                "settingsKeybindingsOpenFile",
                json!({}),
            ))
            .into_any_element()
    }

    fn warning_icon(
        id: String,
        warning: &KeybindingWarningView,
        size: f32,
        t: &Tokens,
    ) -> AnyElement {
        let hover = fade(t.warning, 0.1);
        div()
            .id(SharedString::from(id))
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .size(px(size))
            .rounded(px(radius::XS + 2.))
            .hover(move |s| s.bg(hover))
            .tooltip(Tooltip::text(warning.tooltip.clone()))
            .child(icon("triangle-alert", WARNING_ICON, t.warning))
            .into_any_element()
    }

    fn key_field(
        &self,
        target: &str,
        input: &KeybindingKeyInputView,
        pass_tab: bool,
        t: &Tokens,
        window: &Window,
    ) -> AnyElement {
        let value = input.value.as_str();
        let placeholder = input.placeholder.as_str();
        let Some(focus) = self.key_focus.get(target).cloned() else {
            return div().into_any_element();
        };
        let focused = focus.is_focused(window);
        let look = field_look(t, focused, false, false);
        let corners = resolve_corners(radius::LG, &Default::default(), window);
        let empty = value.is_empty();
        let client = self.client.clone();
        let click_focus = focus.clone();
        let capture_target = target.to_string();
        let frame = div()
            .id(SharedString::from(format!("keybinding-capture-{target}")))
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .w(px(KEY_INPUT_WIDTH))
            .h(px(KEY_INPUT_HEIGHT))
            .px(px(KEY_INPUT_PADDING_X))
            .border_1()
            .border_color(look.border)
            .bg(look.bg)
            .shadow(look.shadows.clone())
            .font_family(MONO_FONT)
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .text_color(if empty { t.placeholder } else { t.foreground })
            .cursor_text()
            .track_focus(&focus)
            .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                click_focus.focus(window, cx);
            })
            .on_key_down(move |event: &KeyDownEvent, _, cx| {
                let keystroke = &event.keystroke;
                let key = dom_key(&keystroke.key);
                if key == "Tab" && pass_tab {
                    return;
                }
                cx.stop_propagation();
                let modifiers = keystroke.modifiers;
                act(
                    &client,
                    cx,
                    "settingsKeybindingsCapture",
                    json!({
                        "target": capture_target,
                        "event": {
                            "key": key,
                            "code": "",
                            "metaKey": modifiers.platform,
                            "ctrlKey": modifiers.control,
                            "altKey": modifiers.alt,
                            "shiftKey": modifiers.shift,
                        },
                    }),
                );
            })
            .child(div().truncate().child(SharedString::from(if empty {
                placeholder.to_string()
            } else {
                value.to_string()
            })));
        decorate(rounded(frame, corners), t, &look, corners).into_any_element()
    }

    fn when_trigger(
        &self,
        target: &str,
        trigger: &KeybindingWhenTriggerView,
        t: &Tokens,
    ) -> AnyElement {
        let client = self.client.clone();
        let target_value = target.to_string();
        div()
            .id(SharedString::from(format!("keybinding-when-{target}")))
            .relative()
            .flex()
            .min_w_0()
            .child(
                Button::new(SharedString::from(format!(
                    "keybinding-when-button-{target}"
                )))
                .size(ButtonSize::Micro)
                .variant(if trigger.is_set {
                    ButtonVariant::Ghost
                } else {
                    ButtonVariant::GhostMuted
                })
                .min_w_0()
                .on_click(move |_, _, cx| {
                    act(
                        &client,
                        cx,
                        "settingsKeybindingsWhenOpen",
                        json!({ "target": target_value }),
                    )
                })
                .child(
                    div()
                        .min_w_0()
                        .truncate()
                        .font_family(MONO_FONT)
                        .child(trigger.display.clone()),
                )
                .child(
                    svg()
                        .path("icons/chevron-down.svg")
                        .flex_none()
                        .size(px(WHEN_CHEVRON))
                        .text_color(fade(t.foreground, WHEN_CHEVRON_OPACITY)),
                ),
            )
            .child(measure(&self.anchors, |a| &mut a.when, target.to_string()))
            .into_any_element()
    }

    fn when_line(
        &self,
        target: &str,
        trigger: &KeybindingWhenTriggerView,
        t: &Tokens,
    ) -> AnyElement {
        div()
            .flex()
            .h(px(WHEN_ROW_HEIGHT))
            .items_center()
            .gap(px(WHEN_GAP))
            .child(
                div()
                    .flex_none()
                    .text_size(px(text::XS))
                    .line_height(px(text::XS))
                    .text_color(fade(t.muted_foreground, WHEN_PREFIX_OPACITY))
                    .child(trigger.prefix.clone()),
            )
            .child(self.when_trigger(target, trigger, t))
            .into_any_element()
    }

    fn row_menu(&self, row: &KeybindingRowView) -> Option<AnyElement> {
        let menu = row.menu.as_ref()?;
        let client = self.client.clone();
        let row_id = row.id.clone();
        let open = row.menu_open;
        Some(
            div()
                .id(SharedString::from(format!("keybinding-menu-{}", row.id)))
                .relative()
                .flex_none()
                .child(
                    Button::new(SharedString::from(format!(
                        "keybinding-menu-button-{}",
                        row.id
                    )))
                    .size(ButtonSize::IconSm)
                    .variant(ButtonVariant::GhostMuted)
                    .icon("ellipsis")
                    .icon_size(ICON_BUTTON_GLYPH)
                    .pressed(open)
                    .disabled(menu.disabled)
                    .accessibility_label(menu.trigger_label.clone())
                    .on_click(move |_, _, cx| {
                        let next = if open { Value::Null } else { json!(row_id) };
                        act(
                            &client,
                            cx,
                            "settingsKeybindingsMenu",
                            json!({ "rowId": next }),
                        )
                    }),
                )
                .child(measure(&self.anchors, |a| &mut a.menu, row.id.clone()))
                .into_any_element(),
        )
    }

    fn render_row(
        &self,
        index: usize,
        row: &KeybindingRowView,
        t: &Tokens,
        window: &Window,
    ) -> AnyElement {
        let group = SharedString::from(format!("keybinding-row-{index}"));
        let editor = &row.editor;
        let title = div()
            .id(SharedString::from(format!("keybinding-title-{index}")))
            .flex()
            .items_center()
            .gap(px(8.))
            .tooltip(Tooltip::text(row.command_tooltip.clone()))
            .child(row.label.clone())
            .children(row.source_badge.clone().map(|badge| {
                Badge::new()
                    .variant(BadgeVariant::Outline)
                    .size(BadgeSize::Sm)
                    .label(badge)
            }));
        let menu_open = row.menu_open;
        let hover_menu = self.row_menu(row).map(|menu| {
            div()
                .flex()
                .items_center()
                .when(!menu_open, |s| s.opacity(0.))
                .group_hover(group.clone(), |s| s.opacity(1.))
                .child(menu)
        });
        let save = editor.save_button.as_ref().map(|button| {
            let client = self.client.clone();
            let row_id = row.id.clone();
            Button::new(SharedString::from(format!("keybinding-save-{index}")))
                .size(ButtonSize::Sm)
                .label(button.label.clone())
                .disabled(button.disabled)
                .on_click(move |_, _, cx| {
                    act(
                        &client,
                        cx,
                        "settingsKeybindingsSave",
                        json!({ "rowId": row_id }),
                    )
                })
        });
        let key_control = match &editor.pill {
            Some(pill) => {
                let client = self.client.clone();
                let row_id = row.id.clone();
                let hover_border = fade(t.border, 0.7);
                let hover_bg = t.accent;
                let mut group_kbd = KbdGroup::new();
                for part in &pill.parts {
                    group_kbd = group_kbd.child(Kbd::new(part.label.clone()));
                }
                div()
                    .id(SharedString::from(format!("keybinding-pill-{index}")))
                    .flex()
                    .flex_none()
                    .items_center()
                    .h(px(PILL_HEIGHT))
                    .px(px(PILL_PADDING_X))
                    .rounded(px(radius::MD))
                    .border_1()
                    .border_color(gpui::transparent_black())
                    .cursor_pointer()
                    .hover(move |s| s.border_color(hover_border).bg(hover_bg))
                    .on_click(move |_, _, cx| {
                        act(
                            &client,
                            cx,
                            "settingsKeybindingsDraft",
                            json!({ "target": row_id, "intent": { "kind": "startRecording" } }),
                        )
                    })
                    .child(group_kbd)
                    .into_any_element()
            }
            None => self.key_field(&row.id, &editor.key_input, row.pass_tab, t, window),
        };
        let control = div()
            .flex()
            .flex_wrap()
            .items_center()
            .justify_end()
            .gap(px(CONTROL_GAP))
            .children(editor.conflict_warning.as_ref().map(|warning| {
                Self::warning_icon(
                    format!("keybinding-conflict-{index}"),
                    warning,
                    WARNING_BOX,
                    t,
                )
            }))
            .children(hover_menu)
            .children(save)
            .child(key_control);
        let id = row
            .anchor_id
            .clone()
            .unwrap_or_else(|| format!("keybinding-row-{index}"));
        div()
            .group(group)
            .child(
                SettingsRow::new(id, row.label.clone())
                    .title_element(title)
                    .description_element(self.when_line(&row.id, &editor.when, t))
                    .control(control),
            )
            .into_any_element()
    }

    fn render_new(
        &self,
        new_binding: &NewKeybindingView,
        t: &Tokens,
        window: &Window,
    ) -> AnyElement {
        let client = self.client.clone();
        let command = Select::new("keybinding-new-command")
            .size(SelectSize::Sm)
            .match_trigger_width(false)
            .w(px(COMMAND_SELECT_WIDTH))
            .flex_none()
            .placeholder(new_binding.command_select.placeholder.clone())
            .value(
                (!new_binding.command_select.value.is_empty())
                    .then(|| new_binding.command_select.value.clone()),
            )
            .items(
                new_binding
                    .command_select
                    .options
                    .iter()
                    .map(|option| SelectItem::new(option.value.clone(), option.label.clone())),
            )
            .on_change(move |value, _, cx| {
                act(
                    &client,
                    cx,
                    "settingsKeybindingsCommand",
                    json!({ "value": value.to_string() }),
                )
            });
        let save_client = self.client.clone();
        let cancel_client = self.client.clone();
        let control = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(NEW_CONTROL_GAP))
            .child(command)
            .children(new_binding.conflict_warning.as_ref().map(|warning| {
                Self::warning_icon("keybinding-new-conflict".into(), warning, WARNING_BOX, t)
            }))
            .child(self.key_field(
                NEW_TARGET,
                &new_binding.key_input,
                new_binding.pass_tab,
                t,
                window,
            ))
            .child(
                Button::new("keybinding-new-save")
                    .size(ButtonSize::Sm)
                    .label(new_binding.save_button.label.clone())
                    .disabled(new_binding.save_button.disabled)
                    .on_click(move |_, _, cx| {
                        act(
                            &save_client,
                            cx,
                            "settingsKeybindingsSave",
                            json!({ "rowId": NEW_TARGET }),
                        )
                    }),
            )
            .child(
                div()
                    .id("keybinding-new-cancel-tip")
                    .flex_none()
                    .tooltip(Tooltip::text(new_binding.cancel_button.tooltip.clone()))
                    .child(
                        Button::new("keybinding-new-cancel")
                            .size(ButtonSize::IconSm)
                            .variant(ButtonVariant::GhostMuted)
                            .icon("x")
                            .icon_size(ICON_BUTTON_GLYPH)
                            .disabled(new_binding.cancel_button.disabled)
                            .on_click(move |_, _, cx| {
                                act(
                                    &cancel_client,
                                    cx,
                                    "settingsKeybindingsCancelAdd",
                                    json!({}),
                                )
                            }),
                    ),
            );
        div()
            .bg(fade(t.muted, NEW_ROW_FILL))
            .child(
                SettingsRow::new("keybinding-new", new_binding.title.clone())
                    .description_element(self.when_line(NEW_TARGET, &new_binding.when, t))
                    .control(control),
            )
            .into_any_element()
    }

    fn row_menu_popup(&self, row: &KeybindingRowView) -> Option<AnyElement> {
        if !row.menu_open {
            return None;
        }
        let menu = row.menu.as_ref()?;
        let bounds = self.anchors.borrow().menu.get(&row.id).copied()?;
        let dismiss = self.client.clone();
        let mut popup = MenuPopup::new(
            SharedString::from(format!("keybinding-menu-popup-{}", row.id)),
            bounds,
        )
        .side(Side::Bottom)
        .align(Align::End)
        .on_dismiss(move |_, cx| {
            act(
                &dismiss,
                cx,
                "settingsKeybindingsMenu",
                json!({ "rowId": null }),
            )
        });
        if let Some(reset) = &menu.reset {
            let client = self.client.clone();
            let row_id = row.id.clone();
            popup = popup.child(
                MenuItem::new("keybinding-menu-reset")
                    .label(reset.label.clone())
                    .disabled(reset.disabled)
                    .on_click(move |_, _, cx| {
                        act(
                            &client,
                            cx,
                            "settingsKeybindingsRowAction",
                            json!({ "rowId": row_id, "action": "reset" }),
                        )
                    }),
            );
        }
        if let Some(remove) = &menu.remove {
            let client = self.client.clone();
            let row_id = row.id.clone();
            popup = popup.child(
                MenuItem::new("keybinding-menu-remove")
                    .label(remove.label.clone())
                    .variant(MenuItemVariant::Destructive)
                    .disabled(remove.disabled)
                    .on_click(move |_, _, cx| {
                        act(
                            &client,
                            cx,
                            "settingsKeybindingsRowAction",
                            json!({ "rowId": row_id, "action": "remove" }),
                        )
                    }),
            );
        }
        Some(popup.into_any_element())
    }

    fn compact_button(
        &self,
        id: String,
        label: &str,
        primary: bool,
        action: &'static str,
        params: Value,
    ) -> AnyElement {
        let client = self.client.clone();
        Button::new(SharedString::from(id))
            .size(ButtonSize::Compact)
            .variant(if primary {
                ButtonVariant::Default
            } else {
                ButtonVariant::Outline
            })
            .icon("plus")
            .icon_size(ICON_BUTTON_GLYPH)
            .label(label.to_string())
            .on_click(move |_, _, cx| act(&client, cx, action, params.clone()))
            .into_any_element()
    }

    fn remove_button(&self, id: String, label: &str, path: &[u32]) -> AnyElement {
        let client = self.client.clone();
        let path = path.to_vec();
        div()
            .id(SharedString::from(format!("{id}-tip")))
            .flex_none()
            .tooltip(Tooltip::text(label.to_string()))
            .child(
                Button::new(SharedString::from(id))
                    .size(ButtonSize::IconSm)
                    .variant(ButtonVariant::Ghost)
                    .icon("minus")
                    .icon_size(ICON_BUTTON_GLYPH)
                    .size_full()
                    .w(px(REMOVE_SIZE))
                    .h(px(REMOVE_SIZE))
                    .accessibility_label(label.to_string())
                    .on_click(move |_, _, cx| {
                        act(
                            &client,
                            cx,
                            "settingsKeybindingsWhenNodeRemove",
                            json!({ "path": path }),
                        )
                    }),
            )
            .into_any_element()
    }

    fn negate_toggle(&self, id: String, label: &str, pressed: bool, path: &[u32]) -> AnyElement {
        let client = self.client.clone();
        let path = path.to_vec();
        Toggle::new(SharedString::from(id))
            .variant(ToggleVariant::Outline)
            .size(ToggleSize::Compact)
            .pressed(pressed)
            .label(label.to_string())
            .on_change(move |next, _, _, cx| {
                act(
                    &client,
                    cx,
                    "settingsKeybindingsWhenNodeEdit",
                    json!({ "path": path, "edit": { "kind": "setNegated", "negated": next } }),
                )
            })
            .into_any_element()
    }

    fn nested_trigger(
        &self,
        nested: NestedSelect,
        label: &str,
        width: Option<f32>,
        warning: Option<&KeybindingWarningView>,
        t: &Tokens,
        window: &Window,
    ) -> AnyElement {
        let open = self
            .nested
            .as_ref()
            .is_some_and(|current| current.id == nested.id);
        let look = field_look(t, open, false, false);
        let corners = resolve_corners(radius::MD, &Default::default(), window);
        let id = nested.id.clone();
        let frame = div()
            .id(SharedString::from(format!("{id}-trigger")))
            .relative()
            .flex()
            .items_center()
            .gap(px(4.))
            .h(px(NESTED_ITEM_HEIGHT))
            .px(px(7.))
            .border_1()
            .border_color(look.border)
            .bg(look.bg)
            .shadow(look.shadows.clone())
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .text_color(t.foreground)
            .cursor_pointer()
            .map(|s| match width {
                Some(width) => s.w(px(width)).flex_none(),
                None => s.flex_1().min_w_0(),
            })
            .child(div().flex_1().min_w_0().truncate().child(label.to_string()))
            .children(warning.map(|warning| {
                Self::warning_icon(format!("{id}-warning"), warning, WARNING_BOX_SMALL, t)
            }))
            .child(
                svg()
                    .path("icons/chevron-down.svg")
                    .flex_none()
                    .size(px(12.))
                    .text_color(fade(t.icon_muted, 0.5)),
            )
            .child(measure(&self.anchors, |a| &mut a.nested, id.clone()));
        decorate(rounded(frame, corners), t, &look, corners)
            .on_mouse_down(MouseButton::Left, {
                let nested = nested.clone();
                let this = self.this.clone();
                move |_, _, cx| {
                    cx.stop_propagation();
                    if let Some(section) = this.upgrade() {
                        section.update(cx, |section, cx| {
                            let same = section
                                .nested
                                .as_ref()
                                .is_some_and(|current| current.id == nested.id);
                            section.nested = if same { None } else { Some(nested.clone()) };
                            if same {
                                section.anchors.borrow_mut().nested_menu = None;
                            }
                            cx.notify();
                        });
                    }
                }
            })
            .into_any_element()
    }

    fn render_node(
        &self,
        node: &WhenNodeView,
        removable: bool,
        t: &Tokens,
        window: &Window,
    ) -> AnyElement {
        match node {
            WhenNodeView::Condition {
                path,
                identifier,
                negated,
                negate_text,
                placeholder,
                options,
                unknown_warning,
                remove,
            } => {
                let key = path_key(path);
                let label = if identifier.is_empty() {
                    placeholder.clone()
                } else {
                    identifier.clone()
                };
                div()
                    .flex()
                    .items_center()
                    .gap(px(NODE_GAP))
                    .rounded(px(radius::MD))
                    .border_1()
                    .border_color(fade(t.border, 0.7))
                    .bg(fade(t.background, 0.6))
                    .p(px(NODE_PADDING))
                    .child(
                        div()
                            .flex_none()
                            .min_w(px(NEGATE_MIN_WIDTH))
                            .child(self.negate_toggle(
                                format!("when-negate-{key}"),
                                negate_text,
                                *negated,
                                path,
                            )),
                    )
                    .child(
                        self.nested_trigger(
                            NestedSelect {
                                id: format!("when-identifier-{key}"),
                                path: path.clone(),
                                kind: NestedKind::Identifier,
                                value: identifier.clone(),
                                options: options
                                    .iter()
                                    .map(|option| (option.clone(), option.clone()))
                                    .collect(),
                            },
                            &label,
                            None,
                            unknown_warning.as_ref(),
                            t,
                            window,
                        ),
                    )
                    .children(remove.as_ref().filter(|_| removable).map(|remove| {
                        self.remove_button(format!("when-remove-{key}"), &remove.label, path)
                    }))
                    .into_any_element()
            }
            WhenNodeView::Not {
                path,
                depth,
                negate_text,
                remove,
                child,
            } => {
                let key = path_key(path);
                let nested = *depth > 0;
                div()
                    .flex()
                    .flex_col()
                    .gap(px(NODE_GAP))
                    .rounded(px(radius::LG))
                    .border_1()
                    .border_color(fade(t.border, if nested { 0.5 } else { 0.7 }))
                    .bg(if nested {
                        fade(t.background, 0.5)
                    } else {
                        fade(t.muted, 0.2)
                    })
                    .p(px(NODE_PADDING))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(NODE_GAP))
                            .child(div().flex_none().min_w(px(NEGATE_MIN_WIDTH)).child(
                                self.negate_toggle(
                                    format!("when-negate-{key}"),
                                    negate_text,
                                    true,
                                    path,
                                ),
                            ))
                            .child(div().flex_1())
                            .children(remove.as_ref().filter(|_| removable).map(|remove| {
                                self.remove_button(
                                    format!("when-remove-{key}"),
                                    &remove.label,
                                    path,
                                )
                            })),
                    )
                    .child(self.branch(
                        self.render_node(child, false, t, window),
                        fade(t.border, 0.7),
                    ))
                    .into_any_element()
            }
            WhenNodeView::Group {
                path,
                depth,
                operator,
                operator_options,
                add_condition_label,
                add_group_label,
                remove,
                children,
            } => {
                let key = path_key(path);
                let nested = *depth > 0;
                let operator_label = operator_options
                    .iter()
                    .find(|option| &option.value == operator)
                    .map(|option| option.label.clone())
                    .unwrap_or_else(|| operator.clone());
                let line = if nested {
                    fade(t.border, 0.7)
                } else {
                    t.border
                };
                div()
                    .flex()
                    .flex_col()
                    .gap(px(NODE_GAP))
                    .rounded(px(radius::LG))
                    .border_1()
                    .border_color(fade(t.border, if nested { 0.7 } else { 0.6 }))
                    .bg(if nested {
                        fade(t.background, 0.55)
                    } else {
                        fade(t.muted, 0.1)
                    })
                    .p(px(NODE_PADDING))
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .items_center()
                            .gap(px(NODE_GAP))
                            .child(
                                self.nested_trigger(
                                    NestedSelect {
                                        id: format!("when-operator-{key}"),
                                        path: path.clone(),
                                        kind: NestedKind::Operator,
                                        value: operator.clone(),
                                        options: operator_options
                                            .iter()
                                            .map(|option| {
                                                (option.value.clone(), option.label.clone())
                                            })
                                            .collect(),
                                    },
                                    &operator_label,
                                    Some(OPERATOR_WIDTH),
                                    None,
                                    t,
                                    window,
                                ),
                            )
                            .child(self.compact_button(
                                format!("when-add-condition-{key}"),
                                add_condition_label,
                                false,
                                "settingsKeybindingsWhenNodeEdit",
                                json!({ "path": path, "edit": { "kind": "addCondition" } }),
                            ))
                            .child(self.compact_button(
                                format!("when-add-group-{key}"),
                                add_group_label,
                                false,
                                "settingsKeybindingsWhenNodeEdit",
                                json!({ "path": path, "edit": { "kind": "addGroup" } }),
                            ))
                            .child(div().flex_1())
                            .children(remove.as_ref().filter(|_| removable).map(|remove| {
                                self.remove_button(
                                    format!("when-remove-{key}"),
                                    &remove.label,
                                    path,
                                )
                            })),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(NODE_GAP))
                            .children(children.iter().map(|child| {
                                self.branch(self.render_node(&child.model, true, t, window), line)
                            })),
                    )
                    .into_any_element()
            }
        }
    }

    fn branch(&self, content: AnyElement, line: gpui::Rgba) -> AnyElement {
        div()
            .relative()
            .pl(px(NODE_INDENT))
            .child(
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .left(px(NODE_LINE_LEFT))
                    .w(px(1.))
                    .bg(line),
            )
            .child(
                div()
                    .absolute()
                    .top(px(NODE_LINE_TOP))
                    .left(px(NODE_LINE_LEFT))
                    .h(px(1.))
                    .w(px(NODE_LINE_WIDTH))
                    .bg(line),
            )
            .child(content)
            .into_any_element()
    }

    fn when_builder(
        &self,
        builder: &WhenBuilderView,
        t: &Tokens,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let bounds = self.anchors.borrow().when.get(&builder.target).copied()?;
        let expression = self.expression.clone()?;
        let header = div()
            .flex()
            .items_start()
            .justify_between()
            .gap(px(BUILDER_GAP))
            .child(
                div()
                    .min_w_0()
                    .text_size(px(text::SM))
                    .line_height(px(text::SM_LINE))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.foreground)
                    .child(builder.title.clone()),
            )
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(NODE_GAP))
                    .child(self.compact_button(
                        "when-root-condition".into(),
                        &builder.add_condition_label,
                        false,
                        "settingsKeybindingsWhenRootEdit",
                        json!({ "kind": "addRootCondition" }),
                    ))
                    .child(self.compact_button(
                        "when-root-group".into(),
                        &builder.add_group_label,
                        false,
                        "settingsKeybindingsWhenRootEdit",
                        json!({ "kind": "addRootGroup" }),
                    )),
            );
        let mut input = InputGroup::input(&expression)
            .size(InputSize::Compact)
            .invalid(builder.expression_input.invalid);
        if let Some(warning) = &builder.unknown_warning {
            input = input.addon(InputGroupAddon::new(AddonAlign::InlineEnd).child(
                Self::warning_icon(
                    "when-expression-warning".into(),
                    warning,
                    WARNING_BOX_SMALL,
                    t,
                ),
            ));
        }
        let expression_block = div()
            .flex()
            .flex_col()
            .gap(px(BUILDER_INPUT_GAP))
            .child(div().font_family(MONO_FONT).child(input))
            .children(builder.parse_error.as_ref().map(|error| {
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .text_size(px(text::XXS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.destructive_foreground)
                    .child(icon("circle-x", WARNING_ICON, t.destructive_foreground))
                    .child(error.clone())
            }));
        let tree = match &builder.tree {
            Some(tree) => self.render_node(tree, true, t, window),
            None => div()
                .rounded(px(radius::MD))
                .border_1()
                .border_dashed()
                .border_color(fade(t.border, 0.8))
                .bg(fade(t.muted, 0.15))
                .p(px(BUILDER_GAP))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap(px(NODE_GAP))
                        .child(self.compact_button(
                            "when-empty-condition".into(),
                            &builder.add_condition_label,
                            true,
                            "settingsKeybindingsWhenRootEdit",
                            json!({ "kind": "addRootCondition" }),
                        ))
                        .child(self.compact_button(
                            "when-empty-group".into(),
                            &builder.add_group_label,
                            false,
                            "settingsKeybindingsWhenRootEdit",
                            json!({ "kind": "addRootGroup" }),
                        )),
                )
                .into_any_element(),
        };
        let tree_block =
            div()
                .relative()
                .child(tree)
                .children(builder.invalid_overlay.as_ref().map(|overlay| {
                    div()
                        .absolute()
                        .top_0()
                        .left_0()
                        .size_full()
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded(px(radius::LG))
                        .border_1()
                        .border_color(fade(t.destructive, 0.3))
                        .bg(fade(t.background, 0.75))
                        .p(px(BUILDER_PADDING))
                        .occlude()
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .text_color(t.destructive_foreground)
                        .child(div().text_center().child(overlay.clone()))
                }));
        let entity = cx.entity().downgrade();
        let client = self.client.clone();
        let anchors = self.anchors.clone();
        let surface = dropdown_glass(cx)
            .id("keybinding-when-builder")
            .occlude()
            .w(px(BUILDER_WIDTH))
            .max_w(window.viewport_size().width - px(32.))
            .p(px(BUILDER_PADDING))
            .on_mouse_down_out(move |event, _, cx| {
                let inside_nested = anchors.borrow().nested_menu.is_some_and(|menu| {
                    let slop = px(DISMISS_SLOP);
                    let left = menu.left() - slop;
                    let right = menu.right() + slop;
                    let top = menu.top() - slop;
                    let bottom = menu.bottom() + slop;
                    event.position.x >= left
                        && event.position.x <= right
                        && event.position.y >= top
                        && event.position.y <= bottom
                });
                let nested_open = entity
                    .upgrade()
                    .is_some_and(|section| section.read(cx).nested.is_some());
                if inside_nested && nested_open {
                    return;
                }
                act(
                    &client,
                    cx,
                    "settingsKeybindingsWhenOpen",
                    json!({ "target": null }),
                );
            })
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(BUILDER_GAP))
                    .child(header)
                    .child(expression_block)
                    .child(tree_block),
            );
        Some(
            positioned_with_priority(
                bounds,
                Side::Bottom,
                Align::Start,
                BUILDER_SIDE_OFFSET,
                0.,
                BUILDER_PRIORITY,
                surface,
            )
            .into_any_element(),
        )
    }

    fn nested_popup(
        &self,
        t: &Tokens,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let nested = self.nested.clone()?;
        let bounds = self.anchors.borrow().nested.get(&nested.id).copied()?;
        let entity = cx.entity().downgrade();
        let dismiss_entity = entity.clone();
        let anchors = self.anchors.clone();
        let rows = nested
            .options
            .iter()
            .enumerate()
            .map(|(index, (value, label))| {
                let selected = value == &nested.value;
                let client = self.client.clone();
                let entity = entity.clone();
                let path = nested.path.clone();
                let kind = nested.kind.clone();
                let value = value.clone();
                let accent = t.accent;
                let accent_fg = t.accent_foreground;
                div()
                    .id(("when-nested-item", index))
                    .flex()
                    .items_center()
                    .min_h(px(NESTED_ITEM_HEIGHT))
                    .px(px(8.))
                    .py(px(4.))
                    .rounded(px(radius::SM))
                    .text_size(px(text::SM))
                    .line_height(px(text::SM_LINE))
                    .text_color(t.foreground)
                    .cursor_pointer()
                    .when(selected, |r| r.bg(fade(t.foreground, 0.08)))
                    .hover(move |s| s.bg(accent).text_color(accent_fg))
                    .on_click(move |_, _, cx| {
                        let edit = match kind {
                            NestedKind::Identifier => {
                                json!({ "kind": "setIdentifier", "identifier": value })
                            }
                            NestedKind::Operator => {
                                json!({ "kind": "setOperator", "operator": value })
                            }
                        };
                        act(
                            &client,
                            cx,
                            "settingsKeybindingsWhenNodeEdit",
                            json!({ "path": path, "edit": edit }),
                        );
                        if let Some(section) = entity.upgrade() {
                            section.update(cx, |section, cx| {
                                section.nested = None;
                                cx.notify();
                            });
                        }
                    })
                    .child(div().w_full().truncate().child(label.clone()))
            });
        let surface = dropdown_glass(cx)
            .id("when-nested-popup")
            .occlude()
            .relative()
            .min_w(bounds.size.width)
            .max_w(window.viewport_size().width - px(32.))
            .on_mouse_down_out(move |event, _, cx| {
                if bounds.contains(&event.position) {
                    return;
                }
                if let Some(section) = dismiss_entity.upgrade() {
                    section.update(cx, |section, cx| {
                        section.nested = None;
                        cx.notify();
                    });
                }
            })
            .child(
                canvas(
                    move |menu, _, _| {
                        anchors.borrow_mut().nested_menu = Some(menu);
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .top_0()
                .left_0()
                .size_full(),
            )
            .child(
                div()
                    .id("when-nested-list")
                    .flex()
                    .flex_col()
                    .max_h(px(NESTED_MAX_HEIGHT))
                    .overflow_y_scroll()
                    .p(px(4.))
                    .children(rows),
            );
        Some(
            positioned_with_priority(
                bounds,
                Side::Bottom,
                Align::Start,
                4.,
                0.,
                NESTED_PRIORITY,
                surface,
            )
            .into_any_element(),
        )
    }
}

fn path_key(path: &[u32]) -> String {
    if path.is_empty() {
        "root".into()
    } else {
        path.iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join("-")
    }
}

impl Render for KeybindingsSection {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return div().into_any_element();
        };
        self.sync(&view, window, cx);
        let t = theme::active(cx);
        let mut list = div().flex().flex_col();
        if let Some(new_binding) = &view.new_binding {
            list = list.child(self.render_new(new_binding, &t, window));
        }
        for (index, row) in view.rows.iter().enumerate() {
            list = list.child(self.render_row(index, row, &t, window));
        }
        if let Some(empty) = &view.empty_state {
            list = list.child(
                div()
                    .px(px(EMPTY_PADDING_X))
                    .py(px(EMPTY_PADDING_Y))
                    .text_center()
                    .text_size(px(text::SM))
                    .line_height(px(text::SM_LINE))
                    .text_color(t.muted_foreground)
                    .child(empty.clone()),
            );
        }
        let mut section = SettingsSection::new("Keybindings")
            .id("keybindings")
            .header_action(self.header_action(&view, &t));
        if let Some(notice) = &view.browser_notice {
            section = section.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .px(px(16.))
                    .py(px(10.))
                    .text_size(px(text::XS))
                    .line_height(px(18.))
                    .text_color(t.muted_foreground)
                    .child(icon("triangle-alert", WARNING_ICON, t.warning))
                    .child(notice.clone()),
            );
        }
        section = section.child(list);
        let menus: Vec<AnyElement> = view
            .rows
            .iter()
            .filter_map(|row| self.row_menu_popup(row))
            .collect();
        let builder = view
            .when_builder
            .as_ref()
            .and_then(|builder| self.when_builder(builder, &t, window, cx));
        let nested = self.nested_popup(&t, window, cx);
        div()
            .w_full()
            .child(section)
            .children(menus)
            .children(builder)
            .children(nested)
            .into_any_element()
    }
}
