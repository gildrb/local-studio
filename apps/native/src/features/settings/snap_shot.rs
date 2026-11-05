use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Bounds, Context, Entity, FocusHandle, FontWeight, InteractiveElement,
    IntoElement, KeyDownEvent, Keystroke, ModifiersChangedEvent, ParentElement, Pixels, Render,
    SharedString, StatefulInteractiveElement, Styled, Task, Window, canvas, div, img, px,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::settings_snap_shot::{
    SettingsSnapShotView, SnapShotActionButtonView, SnapShotButtonView, SnapShotConfigView,
    SnapShotDialogAccessView, SnapShotDialogAdvancedView, SnapShotDialogModelView,
    SnapShotDialogPrimaryView, SnapShotDialogShortcutView, SnapShotDialogView, SnapShotDiffView,
    SnapShotRecorderContentView, SnapShotRecorderView, SnapShotSoundOptionView,
    SnapShotSoundRowView, SnapShotSwitchRowView,
};
use crate::features::settings::primitives::{
    SettingsRow, SettingsSection, SettingsUnavailableGroup, settings_stack, settings_switch,
};
use crate::platform::MONO_FONT;
use crate::platform::snap_shot::held_modifier_codes;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::dialog::{
    DialogDescription, DialogFooter, DialogFooterVariant, DialogHeader, DialogPopup, DialogTitle,
};
use crate::ui::kbd::{Kbd, KbdGroup};
use crate::ui::menu::{MenuItem, MenuPopup, MenuRadioItem, icon};
use crate::ui::popover::{Align, black, dark, shadow, white};
use crate::ui::select::{SelectButton, SelectSize};
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};

const SECTION_ACTION_PREFIX: &str = "settingsSnapShot";
const DIALOG_WIDTH: f32 = 576.;
const PANEL_PADDING_X: f32 = 24.;
const PANEL_PADDING_Y: f32 = 20.;
const STACK_GAP: f32 = 16.;
const TIGHT_GAP: f32 = 12.;
const HEADING_GAP: f32 = 8.;
const STEP_CIRCLE: f32 = 20.;
const PERMISSION_ICON: f32 = 32.;
const PERMISSION_ICON_RADIUS: f32 = 7.;
const CONTROL_GAP: f32 = 8.;
const DIFF_MAX_HEIGHT: f32 = 320.;
const BINDING_MAX_HEIGHT: f32 = 160.;
const DIFF_LINE_HEIGHT: f32 = 20.;
const DIFF_GUTTER_PADDING: f32 = 8.;
const DIFF_DIGIT_WIDTH: f32 = 7.3;
const DIFF_TINT: f32 = 0.1;
const MODIFIER_POLL_MS: u64 = 16;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Target {
    Inline,
    Config,
}

impl Target {
    fn name(self) -> &'static str {
        match self {
            Target::Inline => "inline",
            Target::Config => "config",
        }
    }
}

fn action(name: &str) -> String {
    format!("{SECTION_ACTION_PREFIX}{name}")
}

fn act(client: &Entity<CoreClient>, cx: &mut App, name: &str, params: Value) {
    let action = action(name);
    client.update(cx, |client, _| client.act(&action, params));
}

fn on_click(
    client: &Entity<CoreClient>,
    name: &'static str,
    params: Value,
) -> impl Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static {
    let client = client.clone();
    move |_, _, cx| act(&client, cx, name, params.clone())
}

fn modifier_key(code: &str) -> &'static str {
    if code.starts_with("Shift") {
        "Shift"
    } else if code.starts_with("Control") {
        "Control"
    } else if code.starts_with("Alt") {
        "Alt"
    } else {
        "Meta"
    }
}

fn fallback_codes(modifiers: &gpui::Modifiers) -> Vec<&'static str> {
    [
        (modifiers.shift, "ShiftLeft"),
        (modifiers.control, "ControlLeft"),
        (modifiers.alt, "AltLeft"),
        (modifiers.platform, "MetaLeft"),
    ]
    .into_iter()
    .filter(|(held, _)| *held)
    .map(|(_, code)| code)
    .collect()
}

fn named_key(key: &str) -> Option<(&'static str, &'static str)> {
    Some(match key {
        "enter" => ("Enter", "Enter"),
        "escape" => ("Escape", "Escape"),
        "backspace" => ("Backspace", "Backspace"),
        "tab" => ("Tab", "Tab"),
        "space" => ("Space", " "),
        "delete" => ("Delete", "Delete"),
        "insert" => ("Insert", "Insert"),
        "up" => ("ArrowUp", "ArrowUp"),
        "down" => ("ArrowDown", "ArrowDown"),
        "left" => ("ArrowLeft", "ArrowLeft"),
        "right" => ("ArrowRight", "ArrowRight"),
        "home" => ("Home", "Home"),
        "end" => ("End", "End"),
        "pageup" => ("PageUp", "PageUp"),
        "pagedown" => ("PageDown", "PageDown"),
        _ => return None,
    })
}

fn punctuation_code(ch: char) -> Option<&'static str> {
    Some(match ch {
        '-' => "Minus",
        '=' => "Equal",
        '[' => "BracketLeft",
        ']' => "BracketRight",
        '\\' => "Backslash",
        ';' => "Semicolon",
        '\'' => "Quote",
        '`' => "Backquote",
        ',' => "Comma",
        '.' => "Period",
        '/' => "Slash",
        _ => return None,
    })
}

fn dom_key(keystroke: &Keystroke) -> (String, String) {
    if let Some((code, key)) = named_key(keystroke.key.as_str()) {
        return (key.to_string(), code.to_string());
    }
    if let Some(number) = keystroke
        .key
        .strip_prefix('f')
        .filter(|number| !number.is_empty() && number.parse::<u8>().is_ok())
    {
        let name = format!("F{number}");
        return (name.clone(), name);
    }
    let mut chars = keystroke.key.chars();
    let single = chars.next().filter(|_| chars.next().is_none());
    let code = match single {
        Some(ch) if ch.is_ascii_alphabetic() => format!("Key{}", ch.to_ascii_uppercase()),
        Some(ch) if ch.is_ascii_digit() => format!("Digit{ch}"),
        Some(ch) => punctuation_code(ch).map(str::to_string).unwrap_or_default(),
        None => String::new(),
    };
    let key = match single {
        Some(ch) if keystroke.modifiers.shift => ch.to_uppercase().collect(),
        _ => keystroke.key.clone(),
    };
    (key, code)
}

fn recording_target(view: &SettingsSnapShotView) -> Option<Target> {
    if view.model.shortcut.recorder.pressed {
        return Some(Target::Inline);
    }
    view.dialog
        .as_ref()
        .and_then(|dialog| dialog.config.as_ref())
        .filter(|config| config.recorder.pressed)
        .map(|_| Target::Config)
}

fn xs_muted(t: &Tokens, content: impl Into<SharedString>) -> gpui::Div {
    div()
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .text_color(t.muted_foreground)
        .child(content.into())
}

fn alert(t: &Tokens, content: &str) -> gpui::Div {
    div()
        .text_color(t.destructive)
        .child(SharedString::from(content.to_string()))
}

fn medium_foreground(t: &Tokens, content: &str) -> gpui::Div {
    div()
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.foreground)
        .child(SharedString::from(content.to_string()))
}

fn button(
    id: impl Into<SharedString>,
    view: &SnapShotButtonView,
    size: ButtonSize,
    variant: ButtonVariant,
) -> Button {
    Button::new(gpui::ElementId::Name(id.into()))
        .size(size)
        .variant(variant)
        .disabled(view.disabled)
        .label(view.label.clone())
}

fn sound_label(option: &SnapShotSoundOptionView, t: &Tokens) -> gpui::Div {
    div()
        .flex()
        .min_w_0()
        .items_center()
        .gap(px(4.))
        .child(
            div()
                .min_w_0()
                .truncate()
                .child(SharedString::from(option.label.clone())),
        )
        .children(option.badge.clone().map(|badge| {
            div()
                .flex_none()
                .text_color(t.muted_foreground)
                .child(SharedString::from(badge))
        }))
}

pub struct SnapShotSection {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<SettingsSnapShotView>>>,
    row_focus: FocusHandle,
    dialog_focus: FocusHandle,
    config_focus: FocusHandle,
    wired: bool,
    held: Rc<RefCell<Vec<&'static str>>>,
    poll: Option<Task<()>>,
    sound_open: bool,
    sound_bounds: Rc<Cell<Bounds<Pixels>>>,
    sound_focus: FocusHandle,
    dialog_advanced_open: bool,
    config_advanced_open: bool,
}

impl SnapShotSection {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<SettingsSnapShotView>>(
            &client,
            "settingsSnapShot",
            json!({}),
            cx,
        );
        cx.observe(&view, |this, _, cx| {
            this.sync_polling(cx);
            cx.notify();
        })
        .detach();
        act(&client, cx, "Mount", json!({}));
        Self {
            client,
            view,
            row_focus: cx.focus_handle(),
            dialog_focus: cx.focus_handle(),
            config_focus: cx.focus_handle(),
            wired: false,
            held: Rc::new(RefCell::new(Vec::new())),
            poll: None,
            sound_open: false,
            sound_bounds: Rc::new(Cell::new(Bounds::default())),
            sound_focus: cx.focus_handle(),
            dialog_advanced_open: false,
            config_advanced_open: false,
        }
    }

    fn current(&self, cx: &App) -> Option<SettingsSnapShotView> {
        self.view.read(cx).data.clone().flatten()
    }

    fn wire(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.wired {
            return;
        }
        self.wired = true;
        for (handle, target) in [
            (self.row_focus.clone(), Target::Inline),
            (self.dialog_focus.clone(), Target::Inline),
            (self.config_focus.clone(), Target::Config),
        ] {
            cx.on_blur(&handle, window, move |this, _, cx| {
                act(
                    &this.client,
                    cx,
                    "RecorderStop",
                    json!({ "target": target.name() }),
                );
            })
            .detach();
        }
        cx.observe_window_activation(window, |this, window, cx| {
            if window.is_window_active() {
                act(&this.client, cx, "Refresh", json!({}));
            }
        })
        .detach();
    }

    fn sync_polling(&mut self, cx: &mut Context<Self>) {
        let recording = self
            .current(cx)
            .as_ref()
            .and_then(recording_target)
            .is_some();
        if !recording {
            self.poll = None;
            self.held.borrow_mut().clear();
            return;
        }
        if self.poll.is_some() || !cfg!(target_os = "macos") {
            return;
        }
        self.poll = Some(cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(MODIFIER_POLL_MS))
                    .await;
                let codes = held_modifier_codes();
                if this
                    .update(cx, |this, cx| this.sync_modifiers(codes, cx))
                    .is_err()
                {
                    break;
                }
            }
        }));
    }

    fn sync_modifiers(&mut self, codes: Vec<&'static str>, cx: &mut Context<Self>) {
        let Some(target) = self.current(cx).as_ref().and_then(recording_target) else {
            return;
        };
        let previous = self.held.replace(codes.clone());
        let held = |prefix: &str| codes.iter().any(|code| code.starts_with(prefix));
        for code in codes.iter().filter(|code| !previous.contains(code)) {
            act(
                &self.client,
                cx,
                "RecorderKeyDown",
                json!({
                    "target": target.name(),
                    "key": modifier_key(code),
                    "code": code,
                    "repeat": false,
                    "metaKey": held("Meta"),
                    "ctrlKey": held("Control"),
                    "altKey": held("Alt"),
                    "shiftKey": held("Shift"),
                }),
            );
        }
        for code in previous.iter().filter(|code| !codes.contains(code)) {
            act(
                &self.client,
                cx,
                "RecorderKeyUp",
                json!({ "target": target.name(), "code": code }),
            );
        }
    }

    fn recorder(
        &self,
        id: &str,
        target: Target,
        focus: &FocusHandle,
        recorder: &SnapShotRecorderView,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let content: AnyElement = match &recorder.content {
            SnapShotRecorderContentView::Text { text } => {
                SharedString::from(text.clone()).into_any_element()
            }
            SnapShotRecorderContentView::Keys { key_labels } => KbdGroup::new()
                .children(key_labels.iter().map(|label| Kbd::new(label.clone())))
                .into_any_element(),
        };
        let recording = recorder.pressed;
        let key_client = self.client.clone();
        let entity = cx.entity().downgrade();
        let start_client = self.client.clone();
        let start_focus = focus.clone();
        div()
            .flex_none()
            .on_key_down(move |event: &KeyDownEvent, _, cx| {
                if !recording || event.keystroke.key == "tab" {
                    return;
                }
                cx.stop_propagation();
                let (key, code) = dom_key(&event.keystroke);
                let modifiers = event.keystroke.modifiers;
                act(
                    &key_client,
                    cx,
                    "RecorderKeyDown",
                    json!({
                        "target": target.name(),
                        "key": key,
                        "code": code,
                        "repeat": event.is_held,
                        "metaKey": modifiers.platform,
                        "ctrlKey": modifiers.control,
                        "altKey": modifiers.alt,
                        "shiftKey": modifiers.shift,
                    }),
                );
            })
            .on_modifiers_changed(move |event: &ModifiersChangedEvent, _, cx| {
                if !recording {
                    return;
                }
                let mut codes = held_modifier_codes();
                if codes.is_empty() {
                    codes = fallback_codes(&event.modifiers);
                }
                let _ = entity.update(cx, |this, cx| this.sync_modifiers(codes, cx));
            })
            .child(
                Button::new(gpui::ElementId::Name(SharedString::from(id.to_string())))
                    .size(ButtonSize::Xs)
                    .variant(if recording {
                        ButtonVariant::Secondary
                    } else {
                        ButtonVariant::Outline
                    })
                    .disabled(recorder.disabled)
                    .pressed(recorder.pressed)
                    .accessibility_label(recorder.aria_label.clone())
                    .track_focus(focus)
                    .on_click(move |_, window, cx| {
                        start_focus.focus(window, cx);
                        act(
                            &start_client,
                            cx,
                            "RecorderStart",
                            json!({ "target": target.name() }),
                        );
                    })
                    .child(content),
            )
            .into_any_element()
    }

    fn switch_row(
        &self,
        row: &SnapShotSwitchRowView,
        title: &str,
        action: &'static str,
    ) -> SettingsRow {
        let client = self.client.clone();
        SettingsRow::new(row.id.clone(), title.to_string())
            .description(row.description.clone())
            .when_some(row.status.clone(), |this, status| {
                this.status(SharedString::from(status))
            })
            .control(
                settings_switch(
                    SharedString::from(format!("{}-switch", row.id)),
                    row.checked,
                )
                .disabled(row.disabled)
                .accessibility_label(row.aria_label.clone())
                .on_change(move |checked, _, _, cx| {
                    act(&client, cx, action, json!({ "checked": checked }));
                }),
            )
    }

    fn sound_control(
        &self,
        row: &SnapShotSoundRowView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let entity = cx.entity().downgrade();
        let toggle = entity.clone();
        let focus = self.sound_focus.clone();
        let open = self.sound_open;
        let measure = self.sound_bounds.clone();
        let trigger = div()
            .relative()
            .flex_none()
            .child(
                SelectButton::new("snap-shot-sound-trigger")
                    .size(SelectSize::Sm)
                    .w_auto()
                    .min_w(px(0.))
                    .pressed(open)
                    .disabled(row.disabled)
                    .on_click(move |_, window, cx| {
                        let _ = toggle.update(cx, |this, cx| {
                            this.sound_open = !this.sound_open;
                            cx.notify();
                        });
                        if !open {
                            focus.focus(window, cx);
                        }
                    })
                    .child(sound_label(&row.selected_option, t)),
            )
            .child(
                canvas(move |bounds, _, _| measure.set(bounds), |_, _, _, _| {})
                    .absolute()
                    .size_full(),
            );
        let popup = self.sound_open.then(|| {
            let bounds = self.sound_bounds.get();
            let close = entity.clone();
            let dismiss = entity.clone();
            let escape = entity.clone();
            let items = row.options.iter().map(|option| {
                let select_client = self.client.clone();
                let select_value = option.value.clone();
                let select_close = close.clone();
                let radio = MenuRadioItem::new(SharedString::from(format!(
                    "snap-shot-sound-{}",
                    option.value
                )))
                .checked(option.value == row.value)
                .on_click(move |_, _, cx| {
                    act(
                        &select_client,
                        cx,
                        "Sound",
                        json!({ "value": select_value }),
                    );
                    let _ = select_close.update(cx, |this, cx| {
                        this.sound_open = false;
                        cx.notify();
                    });
                })
                .child(sound_label(option, t));
                match &option.preview {
                    Some(preview) => {
                        let play_client = self.client.clone();
                        let sound = preview.sound.clone();
                        div()
                            .flex()
                            .items_center()
                            .child(div().flex_1().min_w_0().child(radio))
                            .child(
                                div().flex_none().child(
                                    MenuItem::new(SharedString::from(format!(
                                        "snap-shot-sound-play-{}",
                                        option.value
                                    )))
                                    .icon("play")
                                    .on_click(
                                        move |_, _, cx| {
                                            cx.stop_propagation();
                                            act(
                                                &play_client,
                                                cx,
                                                "SoundPreview",
                                                json!({ "sound": sound }),
                                            );
                                        },
                                    ),
                                ),
                            )
                            .into_any_element()
                    }
                    None => radio.into_any_element(),
                }
            });
            MenuPopup::new("snap-shot-sound-menu", bounds)
                .align(Align::End)
                .side_offset(4.)
                .on_dismiss(move |window, cx| {
                    if !bounds.contains(&window.mouse_position()) {
                        let _ = dismiss.update(cx, |this, cx| {
                            this.sound_open = false;
                            cx.notify();
                        });
                    }
                })
                .child(
                    div()
                        .track_focus(&self.sound_focus)
                        .on_key_down(move |event: &KeyDownEvent, _, cx| {
                            if event.keystroke.key == "escape" {
                                cx.stop_propagation();
                                let _ = escape.update(cx, |this, cx| {
                                    this.sound_open = false;
                                    cx.notify();
                                });
                            }
                        })
                        .flex()
                        .flex_col()
                        .children(items),
                )
        });
        div()
            .flex_none()
            .child(trigger)
            .children(popup)
            .into_any_element()
    }

    fn rows(
        &self,
        view: &SettingsSnapShotView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let model = &view.model;
        let titles = &view.titles;
        let enabled = &model.enabled;
        let enabled_client = self.client.clone();
        let mut rows = vec![
            SettingsRow::new(enabled.id.clone(), titles.enabled.clone())
                .description(enabled.description.clone())
                .when_some(enabled.status.clone(), |this, status| {
                    this.status(SharedString::from(status))
                })
                .control(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(CONTROL_GAP))
                        .children(enabled.setup_button.as_ref().map(|setup| {
                            button(
                                "snap-shot-setup",
                                setup,
                                ButtonSize::Xs,
                                ButtonVariant::Outline,
                            )
                            .on_click(on_click(
                                &self.client,
                                "OpenSetup",
                                json!({ "requested": "resume" }),
                            ))
                        }))
                        .child(
                            settings_switch("snap-shot-enabled-switch", enabled.checked)
                                .disabled(enabled.disabled)
                                .accessibility_label(enabled.aria_label.clone())
                                .on_change(move |checked, _, _, cx| {
                                    act(
                                        &enabled_client,
                                        cx,
                                        "Enabled",
                                        json!({ "checked": checked }),
                                    );
                                }),
                        ),
                )
                .into_any_element(),
        ];
        if !model.show_capture_options {
            return rows;
        }
        rows.push(
            self.switch_row(
                &model.accessibility,
                &titles.accessibility,
                "IncludeAccessibility",
            )
            .into_any_element(),
        );
        let shortcut = &model.shortcut;
        let control: AnyElement = match &shortcut.change_button {
            Some(change) => button(
                "snap-shot-change-shortcut",
                change,
                ButtonSize::Xs,
                ButtonVariant::Outline,
            )
            .on_click(on_click(
                &self.client,
                "OpenSetup",
                json!({ "requested": "shortcut" }),
            ))
            .into_any_element(),
            None => {
                let recorder = self.recorder(
                    "snap-shot-shortcut-recorder",
                    Target::Inline,
                    &self.row_focus,
                    &shortcut.recorder,
                    cx,
                );
                let trailing: Vec<AnyElement> =
                    match (&shortcut.save_button, &shortcut.cancel_button) {
                        (Some(save), Some(cancel)) => vec![
                            button(
                                "snap-shot-shortcut-save",
                                save,
                                ButtonSize::Xs,
                                ButtonVariant::Default,
                            )
                            .on_click(on_click(&self.client, "ShortcutSave", json!({})))
                            .into_any_element(),
                            button(
                                "snap-shot-shortcut-cancel",
                                cancel,
                                ButtonSize::Xs,
                                ButtonVariant::Ghost,
                            )
                            .on_click(on_click(&self.client, "ShortcutCancel", json!({})))
                            .into_any_element(),
                        ],
                        _ => shortcut
                            .permissions_button
                            .as_ref()
                            .map(|permissions| {
                                button(
                                    "snap-shot-shortcut-permissions",
                                    permissions,
                                    ButtonSize::Xs,
                                    ButtonVariant::Ghost,
                                )
                                .on_click(on_click(
                                    &self.client,
                                    "Setup",
                                    json!({ "action": "retry-shortcut" }),
                                ))
                                .into_any_element()
                            })
                            .into_iter()
                            .collect(),
                    };
                div()
                    .flex()
                    .items_center()
                    .gap(px(CONTROL_GAP))
                    .child(recorder)
                    .children(trailing)
                    .into_any_element()
            }
        };
        rows.push(
            SettingsRow::new(shortcut.id.clone(), titles.shortcut.clone())
                .description(shortcut.description.clone())
                .when_some(
                    model.shortcut_status.clone().filter(|_| !shortcut.managed),
                    |this, status| this.status(SharedString::from(status)),
                )
                .control(control)
                .into_any_element(),
        );
        let sound = &model.sound;
        rows.push(
            SettingsRow::new(sound.id.clone(), titles.sound.clone())
                .description(sound.description.clone())
                .control(self.sound_control(sound, t, cx))
                .into_any_element(),
        );
        rows.push(
            self.switch_row(&model.flash, &titles.flash, "Flash")
                .into_any_element(),
        );
        rows.push(
            self.switch_row(&model.animations, &titles.animations, "Animations")
                .into_any_element(),
        );
        rows
    }

    fn steps(&self, model: &SnapShotDialogModelView, t: &Tokens) -> AnyElement {
        let current = model.current_step_index;
        let ring = |color| shadow(0., 0., 0., 1., color);
        let strip_bg = if dark(t) { white(0.04) } else { t.background };
        let strip_ring = if dark(t) { white(0.05) } else { black(0.05) };
        let steps = model.steps.iter().enumerate().map(|(index, step)| {
            let is_current = index == current;
            let done = index < current;
            let (circle_bg, circle_fg, circle_ring) = if done {
                (t.primary, t.primary_foreground, t.primary)
            } else if is_current {
                (fade(t.primary, 0.1), t.primary, fade(t.primary, 0.3))
            } else if dark(t) {
                (white(0.05), t.muted_foreground, white(0.1))
            } else {
                (t.card, t.muted_foreground, black(0.1))
            };
            let hover_bg = t.card;
            div()
                .id(("snap-shot-step", index))
                .flex()
                .flex_1()
                .min_w_0()
                .items_center()
                .gap(px(8.))
                .px(px(10.))
                .py(px(8.))
                .rounded(px(radius::LG))
                .when(is_current, |this| {
                    this.bg(t.card).shadow(vec![
                        ring(if dark(t) { white(0.05) } else { black(0.05) }),
                        shadow(0., 1., 2., 0., black(if dark(t) { 0. } else { 0.05 })),
                    ])
                })
                .when(!step.disabled, |this| {
                    this.cursor_pointer()
                        .when(!is_current, |this| this.hover(move |s| s.bg(hover_bg)))
                        .on_click(on_click(
                            &self.client,
                            "DialogStep",
                            json!({ "index": index }),
                        ))
                })
                .child(
                    div()
                        .flex()
                        .flex_none()
                        .size(px(STEP_CIRCLE))
                        .items_center()
                        .justify_center()
                        .rounded_full()
                        .bg(circle_bg)
                        .shadow(vec![ring(circle_ring)])
                        .text_color(circle_fg)
                        .text_size(px(text::SM))
                        .font_weight(FontWeight::MEDIUM)
                        .map(|this| {
                            if done {
                                this.child(icon("check", 16., circle_fg))
                            } else {
                                this.child(SharedString::from((index + 1).to_string()))
                            }
                        }),
                )
                .child(
                    div()
                        .min_w_0()
                        .truncate()
                        .text_size(px(text::SM))
                        .line_height(px(text::SM_LINE))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(if is_current {
                            t.foreground
                        } else {
                            t.muted_foreground
                        })
                        .child(SharedString::from(step.label.clone())),
                )
        });
        div()
            .flex()
            .gap(px(4.))
            .p(px(4.))
            .rounded(px(radius::XL))
            .bg(strip_bg)
            .shadow(vec![ring(strip_ring)])
            .children(steps)
            .into_any_element()
    }

    fn action_button(
        &self,
        id: &str,
        view: &SnapShotActionButtonView,
        size: ButtonSize,
        variant: ButtonVariant,
    ) -> Button {
        Button::new(gpui::ElementId::Name(SharedString::from(id.to_string())))
            .size(size)
            .variant(variant)
            .disabled(view.disabled)
            .label(view.label.clone())
            .on_click(on_click(
                &self.client,
                "Setup",
                json!({ "action": view.action }),
            ))
    }

    fn access(
        &self,
        model: &SnapShotDialogModelView,
        access: &SnapShotDialogAccessView,
        t: &Tokens,
    ) -> Vec<AnyElement> {
        let mut children = Vec::new();
        if let Some(message) = &access.check_message {
            children.push(xs_muted(t, message.clone()).into_any_element());
        }
        if let Some(permissions) = &access.permissions {
            children.push(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .children(permissions.iter().map(|permission| {
                        let path = match permission.icon.as_str() {
                            "mac-accessibility" => "icons/mac/accessibility.svg",
                            _ => "icons/mac/screen-recording.svg",
                        };
                        let status: AnyElement = if permission.granted {
                            div()
                                .flex()
                                .flex_none()
                                .items_center()
                                .gap(px(4.))
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .text_color(t.success)
                                .child(icon("circle-check", 16., t.success))
                                .child("Allowed")
                                .into_any_element()
                        } else {
                            Button::new(gpui::ElementId::Name(SharedString::from(format!(
                                "snap-shot-allow-{}",
                                permission.id
                            ))))
                            .size(ButtonSize::Xs)
                            .variant(ButtonVariant::Outline)
                            .disabled(model.busy)
                            .label("Allow")
                            .on_click(on_click(
                                &self.client,
                                "Setup",
                                json!({ "action": permission.action }),
                            ))
                            .into_any_element()
                        };
                        div()
                            .flex()
                            .items_center()
                            .gap(px(12.))
                            .rounded(px(radius::LG))
                            .border_1()
                            .border_color(t.border)
                            .px(px(12.))
                            .py(px(8.))
                            .child(
                                div()
                                    .flex_none()
                                    .size(px(PERMISSION_ICON))
                                    .rounded(px(PERMISSION_ICON_RADIUS))
                                    .shadow(vec![shadow(0., 1., 2., 0., black(0.15))])
                                    .child(img(path).size(px(PERMISSION_ICON))),
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .flex_1()
                                    .min_w_0()
                                    .child(
                                        div()
                                            .font_weight(FontWeight::MEDIUM)
                                            .child(SharedString::from(permission.title.clone())),
                                    )
                                    .child(xs_muted(t, permission.description.clone())),
                            )
                            .child(status)
                    }))
                    .into_any_element(),
            );
        }
        if let Some(error) = &access.permission_error {
            children.push(xs_muted(t, error.clone()).into_any_element());
        }
        if let Some(reinstall) = &access.reinstall_helper_button {
            children.push(
                div()
                    .flex()
                    .child(self.action_button(
                        "snap-shot-reinstall-helper",
                        reinstall,
                        ButtonSize::Xs,
                        ButtonVariant::Outline,
                    ))
                    .into_any_element(),
            );
        }
        children
    }

    fn details(
        id: &'static str,
        summary: &str,
        open: bool,
        toggle: impl Fn(&mut Self) + 'static,
        children: Vec<AnyElement>,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let entity = cx.entity().downgrade();
        div()
            .flex()
            .flex_col()
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .text_color(t.muted_foreground)
            .child(
                div()
                    .id(id)
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .cursor_pointer()
                    .on_click(move |_, _, cx| {
                        let _ = entity.update(cx, |this, cx| {
                            toggle(this);
                            cx.notify();
                        });
                    })
                    .child(div().flex_none().text_size(px(8.)).child(if open {
                        "▼"
                    } else {
                        "▶"
                    }))
                    .child(SharedString::from(summary.to_string())),
            )
            .when(open, |this| {
                this.child(
                    div()
                        .mt(px(12.))
                        .flex()
                        .flex_col()
                        .gap(px(TIGHT_GAP))
                        .children(children),
                )
            })
            .into_any_element()
    }

    fn dialog_advanced(
        &self,
        advanced: &SnapShotDialogAdvancedView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let mut children: Vec<AnyElement> = advanced
            .details
            .iter()
            .map(|detail| {
                div()
                    .child(SharedString::from(detail.clone()))
                    .into_any_element()
            })
            .collect();
        if let Some(note) = &advanced.included_note {
            children.push(
                div()
                    .child(SharedString::from(note.clone()))
                    .into_any_element(),
            );
        }
        for (id, view) in [
            (
                "snap-shot-disable-extension",
                &advanced.disable_extension_button,
            ),
            ("snap-shot-remove-helper", &advanced.remove_helper_button),
        ] {
            if let Some(view) = view {
                children.push(
                    div()
                        .flex()
                        .child(self.action_button(id, view, ButtonSize::Xs, ButtonVariant::Ghost))
                        .into_any_element(),
                );
            }
        }
        Self::details(
            "snap-shot-dialog-advanced",
            &advanced.summary,
            self.dialog_advanced_open,
            |this| this.dialog_advanced_open = !this.dialog_advanced_open,
            children,
            t,
            cx,
        )
    }

    fn diff(&self, diff: &SnapShotDiffView, t: &Tokens) -> AnyElement {
        let digits = diff
            .hunks
            .iter()
            .flat_map(|hunk| hunk.lines.iter())
            .filter_map(|line| line.new_line_number.or(line.old_line_number))
            .max()
            .unwrap_or(1)
            .to_string()
            .len();
        let gutter = digits as f32 * DIFF_DIGIT_WIDTH + DIFF_GUTTER_PADDING * 2.;
        let mut rows: Vec<AnyElement> = vec![
            div()
                .px(px(12.))
                .py(px(6.))
                .border_b_1()
                .border_color(t.border)
                .bg(fade(t.muted, 0.5))
                .text_color(t.foreground)
                .font_weight(FontWeight::MEDIUM)
                .child(SharedString::from(diff.path.clone()))
                .into_any_element(),
        ];
        for hunk in &diff.hunks {
            rows.push(
                div()
                    .px(px(12.))
                    .min_h(px(DIFF_LINE_HEIGHT))
                    .flex()
                    .items_center()
                    .bg(fade(t.muted, 0.5))
                    .text_color(t.muted_foreground)
                    .child(SharedString::from(hunk.header.clone()))
                    .into_any_element(),
            );
            for line in &hunk.lines {
                let (tint, number_color, number) = match line.kind.as_str() {
                    "addition" => (
                        Some(t.diff_addition),
                        t.diff_addition_foreground,
                        line.new_line_number,
                    ),
                    "deletion" => (
                        Some(t.diff_deletion),
                        t.diff_deletion_foreground,
                        line.old_line_number,
                    ),
                    _ => (None, t.muted_foreground, line.new_line_number),
                };
                rows.push(
                    div()
                        .flex()
                        .min_h(px(DIFF_LINE_HEIGHT))
                        .when_some(tint, |this, tint| this.bg(fade(tint, DIFF_TINT)))
                        .child(
                            div()
                                .flex_none()
                                .w(px(gutter))
                                .px(px(DIFF_GUTTER_PADDING))
                                .flex()
                                .justify_end()
                                .text_color(number_color)
                                .when_some(tint, |this, tint| {
                                    this.bg(fade(tint, DIFF_TINT))
                                        .border_l_2()
                                        .border_color(tint)
                                })
                                .children(
                                    number.map(|number| SharedString::from(number.to_string())),
                                ),
                        )
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .px(px(8.))
                                .whitespace_normal()
                                .text_color(t.foreground)
                                .child(SharedString::from(line.text.clone())),
                        )
                        .into_any_element(),
                );
            }
        }
        div()
            .id("snap-shot-config-diff")
            .max_h(px(DIFF_MAX_HEIGHT))
            .overflow_y_scroll()
            .rounded(px(radius::LG))
            .border_1()
            .border_color(t.border)
            .font_family(MONO_FONT)
            .text_size(px(text::XS))
            .line_height(px(DIFF_LINE_HEIGHT))
            .child(div().flex().flex_col().children(rows))
            .into_any_element()
    }

    fn config(
        &self,
        config: &SnapShotConfigView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let model = &config.model;
        let mut children: Vec<AnyElement> = Vec::new();
        if let Some(label) = &model.shortcut_label {
            children.push(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(TIGHT_GAP))
                    .child(SharedString::from(label.clone()))
                    .child(self.recorder(
                        "snap-shot-config-recorder",
                        Target::Config,
                        &self.config_focus,
                        &config.recorder,
                        cx,
                    ))
                    .into_any_element(),
            );
        }
        if let Some(status) = &model.recording_status {
            children.push(xs_muted(t, status.clone()).into_any_element());
        }
        if let Some(result) = &model.result_message {
            children.push(
                div()
                    .child(SharedString::from(result.clone()))
                    .into_any_element(),
            );
        } else if let Some(preview) = &model.preview {
            children.push(
                div()
                    .text_color(t.muted_foreground)
                    .child(SharedString::from(preview.message.clone()))
                    .into_any_element(),
            );
            if let Some(diff) = &config.diff {
                children.push(self.diff(diff, t));
            }
            if let Some(note) = &preview.note {
                children.push(xs_muted(t, note.clone()).into_any_element());
            }
            children.push(
                div()
                    .flex()
                    .gap(px(8.))
                    .children(preview.primary_button.as_ref().map(|primary| {
                        button(
                            "snap-shot-config-apply",
                            primary,
                            ButtonSize::Default,
                            ButtonVariant::Default,
                        )
                        .on_click(on_click(
                            &self.client,
                            "ConfigApply",
                            json!({}),
                        ))
                    }))
                    .child(
                        button(
                            "snap-shot-config-cancel",
                            &preview.cancel_button,
                            ButtonSize::Default,
                            ButtonVariant::Ghost,
                        )
                        .on_click(on_click(
                            &self.client,
                            "ConfigCancel",
                            json!({}),
                        )),
                    )
                    .into_any_element(),
            );
        } else if let Some(review) = &model.review {
            children.push(
                div()
                    .text_color(t.muted_foreground)
                    .child(SharedString::from(review.intro.clone()))
                    .into_any_element(),
            );
            children.push(
                div()
                    .flex()
                    .child(
                        button(
                            "snap-shot-config-review",
                            &review.button,
                            ButtonSize::Default,
                            ButtonVariant::Default,
                        )
                        .on_click(on_click(
                            &self.client,
                            "ConfigRead",
                            json!({ "operation": "install" }),
                        )),
                    )
                    .into_any_element(),
            );
            if let Some(note) = &review.unsupported_note {
                children.push(xs_muted(t, note.clone()).into_any_element());
            }
        }
        if let Some(error) = &model.error_message {
            children.push(alert(t, error).into_any_element());
        }
        if let Some(status) = &model.connection_status {
            children.push(
                div()
                    .text_color(t.muted_foreground)
                    .child(SharedString::from(status.clone()))
                    .into_any_element(),
            );
        }
        let advanced = &model.advanced;
        let mut details: Vec<AnyElement> = Vec::new();
        if let Some(troubleshooting) = &advanced.troubleshooting {
            details.push(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .child(medium_foreground(t, &advanced.troubleshooting_title))
                    .child(SharedString::from(troubleshooting.clone()))
                    .into_any_element(),
            );
        }
        details.push(
            div()
                .flex()
                .flex_col()
                .gap(px(4.))
                .child(medium_foreground(t, &advanced.settings_file_title))
                .child(
                    div()
                        .font_family(MONO_FONT)
                        .child(SharedString::from(advanced.settings_file_path.clone())),
                )
                .children(
                    advanced
                        .include_note
                        .clone()
                        .map(|note| div().child(SharedString::from(note))),
                )
                .children(
                    advanced
                        .link_note
                        .clone()
                        .map(|note| div().child(SharedString::from(note))),
                )
                .into_any_element(),
        );
        details.push(
            div()
                .flex()
                .flex_wrap()
                .gap(px(8.))
                .child(
                    button(
                        "snap-shot-config-choose-file",
                        &advanced.choose_file_button,
                        ButtonSize::Sm,
                        ButtonVariant::Outline,
                    )
                    .on_click(on_click(
                        &self.client,
                        "ConfigRead",
                        json!({ "chooseFile": true, "operation": "install" }),
                    )),
                )
                .child(
                    button(
                        "snap-shot-config-remove",
                        &advanced.remove_button,
                        ButtonSize::Sm,
                        ButtonVariant::Ghost,
                    )
                    .on_click(on_click(
                        &self.client,
                        "ConfigRead",
                        json!({ "operation": "remove" }),
                    )),
                )
                .children(advanced.review_button.as_ref().map(|review| {
                    button(
                        "snap-shot-config-review-again",
                        review,
                        ButtonSize::Sm,
                        ButtonVariant::Outline,
                    )
                    .on_click(on_click(
                        &self.client,
                        "ConfigRead",
                        json!({ "operation": "install" }),
                    ))
                }))
                .into_any_element(),
        );
        details.push(
            div()
                .child(SharedString::from(format!(
                    "{} {}",
                    advanced.settings_file_help, advanced.config_location_note
                )))
                .into_any_element(),
        );
        if let Some(backup) = &advanced.backup_label {
            details.push(
                div()
                    .child(SharedString::from(backup.clone()))
                    .into_any_element(),
            );
        }
        details.push(medium_foreground(t, &advanced.manual_setup_title).into_any_element());
        details.push(
            div()
                .child(SharedString::from(
                    advanced.manual_setup_instructions.clone(),
                ))
                .into_any_element(),
        );
        details.push(
            div()
                .id("snap-shot-config-binding")
                .max_h(px(BINDING_MAX_HEIGHT))
                .overflow_y_scroll()
                .rounded(px(radius::XL))
                .bg(fade(t.muted, 0.5))
                .p(px(12.))
                .font_family(MONO_FONT)
                .whitespace_normal()
                .children(advanced.binding.clone().map(SharedString::from))
                .into_any_element(),
        );
        details.push(
            div()
                .flex()
                .child(
                    button(
                        "snap-shot-config-copy",
                        &advanced.copy_button,
                        ButtonSize::Sm,
                        ButtonVariant::Outline,
                    )
                    .on_click(on_click(&self.client, "ConfigCopy", json!({}))),
                )
                .into_any_element(),
        );
        details.push(
            div()
                .child(SharedString::from(advanced.turn_off_note.clone()))
                .into_any_element(),
        );
        if let Some(message) = advanced
            .registration_status
            .as_ref()
            .and_then(|status| status.message.clone())
        {
            details.push(div().child(SharedString::from(message)).into_any_element());
        }
        if let Some(complete) = &advanced.complete_button {
            details.push(
                div()
                    .flex()
                    .child(
                        button(
                            "snap-shot-config-complete",
                            complete,
                            ButtonSize::Sm,
                            ButtonVariant::Outline,
                        )
                        .on_click(on_click(
                            &self.client,
                            "ConfigComplete",
                            json!({}),
                        )),
                    )
                    .into_any_element(),
            );
        }
        children.push(Self::details(
            "snap-shot-config-advanced",
            &advanced.summary,
            self.config_advanced_open,
            |this| this.config_advanced_open = !this.config_advanced_open,
            details,
            t,
            cx,
        ));
        div()
            .flex()
            .flex_col()
            .gap(px(STACK_GAP))
            .children(children)
            .into_any_element()
    }

    fn dialog(
        &self,
        dialog: &SnapShotDialogView,
        view: &SettingsSnapShotView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let model = &dialog.model;
        let (panel_bg, panel_ring) = if dark(t) {
            (white(0.02), white(0.05))
        } else {
            (fade(t.background, 0.8), black(0.05))
        };
        let mut body: Vec<AnyElement> = vec![
            div()
                .flex()
                .flex_col()
                .gap(px(HEADING_GAP))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .font_weight(FontWeight::MEDIUM)
                        .child(SharedString::from(model.heading.title.clone())),
                )
                .child(DialogDescription::new(model.heading.description.clone()))
                .into_any_element(),
        ];
        if let Some(access) = &model.access {
            body.extend(self.access(model, access, t));
        } else {
            match &model.shortcut {
                Some(SnapShotDialogShortcutView::Config { .. }) => {
                    if let Some(config) = &dialog.config {
                        body.push(self.config(config, t, cx));
                    }
                }
                Some(SnapShotDialogShortcutView::Inline {
                    status,
                    retry_button,
                }) => {
                    body.push(
                        div()
                            .flex()
                            .flex_col()
                            .items_start()
                            .gap(px(TIGHT_GAP))
                            .child(self.recorder(
                                "snap-shot-dialog-recorder",
                                Target::Inline,
                                &self.dialog_focus,
                                &view.model.shortcut.recorder,
                                cx,
                            ))
                            .children(status.clone().map(|status| xs_muted(t, status)))
                            .children(retry_button.as_ref().map(|retry| {
                                self.action_button(
                                    "snap-shot-retry-shortcut",
                                    retry,
                                    ButtonSize::Sm,
                                    ButtonVariant::Ghost,
                                )
                            }))
                            .into_any_element(),
                    );
                }
                None => {}
            }
        }
        if let Some(message) = &model.access_alert {
            body.push(alert(t, message).into_any_element());
        }
        if let Some(message) = &model.error_alert {
            body.push(alert(t, message).into_any_element());
        }
        if let Some(advanced) = &model.advanced {
            body.push(self.dialog_advanced(advanced, t, cx));
        }
        let footer = DialogFooter::new()
            .variant(DialogFooterVariant::Bare)
            .children(model.back_button.as_ref().map(|back| {
                button(
                    "snap-shot-dialog-back",
                    back,
                    ButtonSize::Default,
                    ButtonVariant::Ghost,
                )
                .on_click(on_click(&self.client, "DialogBack", json!({})))
            }))
            .child(
                button(
                    "snap-shot-dialog-close",
                    &model.close_button,
                    ButtonSize::Default,
                    ButtonVariant::Ghost,
                )
                .on_click(on_click(
                    &self.client,
                    "DialogClose",
                    json!({ "completed": false }),
                )),
            )
            .children(model.primary_button.as_ref().map(|primary| {
                let (label, disabled) = match primary {
                    SnapShotDialogPrimaryView::Button { label, disabled }
                    | SnapShotDialogPrimaryView::PermissionContinue { label, disabled } => {
                        (label.clone(), *disabled)
                    }
                };
                Button::new("snap-shot-dialog-primary")
                    .disabled(disabled)
                    .label(label)
                    .on_click(on_click(&self.client, "DialogPrimary", json!({})))
            }));
        let close = self.client.clone();
        let dismissible = model.dismissible;
        DialogPopup::new("snap-shot-setup-dialog")
            .max_width(DIALOG_WIDTH)
            .show_close_button(dismissible)
            .on_close(move |_, cx| {
                if dismissible {
                    act(&close, cx, "DialogClose", json!({ "completed": false }));
                }
            })
            .child(
                div()
                    .id("snap-shot-setup-scroll")
                    .flex()
                    .flex_col()
                    .min_h_0()
                    .overflow_y_scroll()
                    .child(
                        DialogHeader::new()
                            .with_panel(true)
                            .child(DialogTitle::new(model.title.clone()))
                            .child(self.steps(model, t)),
                    )
                    .child(
                        div()
                            .min_w_0()
                            .px(px(PANEL_PADDING_X))
                            .py(px(PANEL_PADDING_Y))
                            .bg(panel_bg)
                            .shadow(vec![shadow(0., 0., 0., 1., panel_ring)])
                            .text_size(px(text::SM))
                            .line_height(px(text::SM_LINE))
                            .child(div().flex().flex_col().gap(px(STACK_GAP)).children(body)),
                    )
                    .child(footer),
            )
            .into_any_element()
    }
}

impl Render for SnapShotSection {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.wire(window, cx);
        let Some(view) = self.current(cx) else {
            return settings_stack().into_any_element();
        };
        let t = theme::active(cx);
        let rows = self.rows(&view, &t, cx);
        let section =
            SettingsSection::new(view.model.title.clone()).id(view.model.section_id.clone());
        let section = match view.model.unavailable_message.clone() {
            Some(message) => {
                section.child(SettingsUnavailableGroup::new(Some(message)).children(rows))
            }
            None => section.children(rows),
        };
        let dialog = view
            .dialog
            .as_ref()
            .map(|dialog| self.dialog(dialog, &view, &t, cx));
        settings_stack()
            .child(section)
            .children(dialog)
            .into_any_element()
    }
}
