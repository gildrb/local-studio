use gpui::component::input::{InputEvent, InputState, TextareaState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, Bounds, ClickEvent, Context, Entity, FocusHandle, Global,
    InteractiveElement, IntoElement, KeyDownEvent, MouseButton, ParentElement, Pixels, Render,
    SharedString, StatefulInteractiveElement, Styled, Window, canvas, div, px,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::project_scripts::{
    ProjectScriptEditorView, ProjectScriptsToolbarModel, ProjectScriptsView,
};
use crate::platform::MONO_FONT;
use crate::ui::alert_dialog::{
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup,
    AlertDialogTitle,
};
use crate::ui::button::{
    Button, ButtonSize, ButtonVariant, DISABLED_OPACITY, is_dark, resolve_corners, rounded,
};
use crate::ui::dialog::{
    DialogDescription, DialogFooter, DialogFooterVariant, DialogHeader, DialogPanel, DialogPopup,
    DialogTitle,
};
use crate::ui::input::{Input, decorate, field_look};
use crate::ui::label::Label;
use crate::ui::menu::icon;
use crate::ui::popover::{Align, PopoverPopup, Side};
use crate::ui::switch::Switch;
use crate::ui::textarea::Textarea;
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};

const COMMAND_MAX_ROWS: usize = 12;
const FIELD_GAP: f32 = 6.;
const NAME_ROW_GAP: f32 = 8.;
const ICON_BUTTON_WIDTH: f32 = 36.;
const ICON_BUTTON_GLYPH: f32 = 18.;
const FIELD_HEIGHT: f32 = 32.;
const FIELD_PADDING_X: f32 = 11.;
const TOGGLE_ROW_GAP: f32 = 12.;
const TOGGLE_ROW_PADDING_X: f32 = 12.;
const TOGGLE_ROW_PADDING_Y: f32 = 8.;
const TOGGLE_ROW_DISABLED_OPACITY: f32 = 0.6;
const TOGGLE_ROW_DARK_FILL: f32 = 0.035;
const PICKER_CELL_WIDTH: f32 = 73.5;
const PICKER_GAP: f32 = 8.;
const PICKER_CELL_PADDING: f32 = 8.;
const PICKER_GLYPH: f32 = 16.;
const PICKER_COLUMNS: usize = 3;

pub fn script_icon(icon: &str) -> &'static str {
    match icon {
        "test" => "flask-conical",
        "lint" => "list-checks",
        "configure" => "wrench",
        "build" => "hammer",
        "debug" => "bug",
        _ => "play",
    }
}

pub fn send(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

fn on_click(
    client: &Entity<CoreClient>,
    action: &'static str,
    params: Value,
) -> impl Fn(&ClickEvent, &mut Window, &mut App) + 'static {
    let client = client.clone();
    move |_, _, cx| send(&client, cx, action, params.clone())
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
        other => other.into(),
    }
}

pub struct ProjectScriptsHostHandle(pub Entity<ProjectScriptsHost>);

impl Global for ProjectScriptsHostHandle {}

pub struct ProjectScriptsHost {
    client: Entity<CoreClient>,
    view: Entity<ViewState<ProjectScriptsView>>,
    name: Entity<InputState>,
    command: Entity<TextareaState>,
    preview_url: Entity<InputState>,
    keybinding_focus: FocusHandle,
    editor_id: Option<u64>,
    icon_trigger: Bounds<Pixels>,
}

impl ProjectScriptsHost {
    pub fn install(client: &Entity<CoreClient>, window: &mut Window, cx: &mut App) {
        if cx.has_global::<ProjectScriptsHostHandle>() {
            return;
        }
        let host = cx.new(|cx| Self::new(client.clone(), window, cx));
        cx.set_global(ProjectScriptsHostHandle(host));
    }

    pub fn global(cx: &App) -> Option<Entity<ProjectScriptsHost>> {
        cx.try_global::<ProjectScriptsHostHandle>()
            .map(|handle| handle.0.clone())
    }

    pub fn toolbar(&self, cx: &App) -> Option<ProjectScriptsToolbarModel> {
        self.view
            .read(cx)
            .data
            .as_ref()
            .and_then(|view| view.toolbar.clone())
    }

    pub fn client(&self) -> &Entity<CoreClient> {
        &self.client
    }

    fn new(client: Entity<CoreClient>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let view =
            CoreClient::subscribe::<ProjectScriptsView>(&client, "projectScripts", json!({}), cx);
        let name = cx.new(|cx| InputState::new(window, cx));
        let command = cx.new(|cx| TextareaState::new(window, cx).auto_grow(1, COMMAND_MAX_ROWS));
        let preview_url = cx.new(|cx| InputState::new(window, cx));
        for (state, field) in [(&name, "name"), (&preview_url, "previewUrl")] {
            let target = client.clone();
            cx.subscribe_in(
                state,
                window,
                move |_, state: &Entity<InputState>, event: &InputEvent, _, cx| match event {
                    InputEvent::Change => {
                        let value = state.read(cx).value().to_string();
                        send(
                            &target,
                            cx,
                            "projectScriptEditorUpdate",
                            json!({ field: value }),
                        );
                    }
                    InputEvent::PressEnter { .. } => {
                        send(&target, cx, "projectScriptEditorSubmit", json!({}));
                    }
                    _ => {}
                },
            )
            .detach();
        }
        let target = client.clone();
        cx.subscribe_in(
            &command,
            window,
            move |_, state: &Entity<TextareaState>, event: &InputEvent, _, cx| {
                if let InputEvent::Change = event {
                    let value = state.read(cx).value().to_string();
                    send(
                        &target,
                        cx,
                        "projectScriptEditorUpdate",
                        json!({ "command": value }),
                    );
                }
            },
        )
        .detach();
        cx.observe_in(&view, window, |host, _, window, cx| host.sync(window, cx))
            .detach();
        Self {
            client,
            view,
            name,
            command,
            preview_url,
            keybinding_focus: cx.focus_handle(),
            editor_id: None,
            icon_trigger: Bounds::default(),
        }
    }

    fn editor(&self, cx: &App) -> Option<ProjectScriptEditorView> {
        self.view
            .read(cx)
            .data
            .as_ref()
            .and_then(|view| view.editor.clone())
    }

    fn sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        match self.editor(cx) {
            Some(editor) if self.editor_id != Some(editor.id) => {
                self.editor_id = Some(editor.id);
                let form = editor.form;
                self.name.update(cx, |state, cx| {
                    state.set_value(form.name, window, cx);
                    state.set_placeholder("Test", window, cx);
                    state.focus(window, cx);
                });
                self.command.update(cx, |state, cx| {
                    state.set_value(form.command, window, cx);
                    state.set_placeholder("bun test", window, cx);
                });
                self.preview_url.update(cx, |state, cx| {
                    state.set_value(form.preview_url, window, cx);
                    state.set_placeholder("http://localhost:5173", window, cx);
                });
            }
            Some(_) => {}
            None => self.editor_id = None,
        }
        cx.notify();
    }

    fn keybinding_field(
        &self,
        editor: &ProjectScriptEditorView,
        t: &Tokens,
        window: &Window,
    ) -> AnyElement {
        let focus = self.keybinding_focus.clone();
        let focused = focus.is_focused(window);
        let disabled = editor.is_saving;
        let look = field_look(t, focused, false, disabled);
        let corners = resolve_corners(radius::LG, &Default::default(), window);
        let value = editor.form.keybinding.clone();
        let empty = value.is_empty();
        let client = self.client.clone();
        let click_focus = focus.clone();
        let frame = div()
            .id("project-script-keybinding")
            .relative()
            .flex()
            .items_center()
            .w_full()
            .h(px(FIELD_HEIGHT))
            .px(px(FIELD_PADDING_X))
            .border_1()
            .border_color(look.border)
            .bg(look.bg)
            .shadow(look.shadows.clone())
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .text_color(if empty { t.placeholder } else { t.foreground })
            .when(disabled, |f| f.opacity(DISABLED_OPACITY))
            .track_focus(&focus)
            .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                click_focus.focus(window, cx);
            })
            .on_key_down(move |event: &KeyDownEvent, _, cx| {
                let keystroke = &event.keystroke;
                let key = dom_key(&keystroke.key);
                if key == "Tab" {
                    return;
                }
                cx.stop_propagation();
                let modifiers = keystroke.modifiers;
                send(
                    &client,
                    cx,
                    "projectScriptEditorKey",
                    json!({
                        "key": key,
                        "code": "",
                        "metaKey": modifiers.platform,
                        "ctrlKey": modifiers.control,
                        "altKey": modifiers.alt,
                        "shiftKey": modifiers.shift,
                    }),
                );
            })
            .child(SharedString::from(if empty {
                "Press shortcut".to_string()
            } else {
                value
            }));
        decorate(rounded(frame, corners), t, &look, corners).into_any_element()
    }

    fn toggle_row(
        id: &'static str,
        label: &'static str,
        checked: bool,
        disabled: bool,
        field: &'static str,
        client: &Entity<CoreClient>,
        t: &Tokens,
    ) -> AnyElement {
        let dark = is_dark(t);
        let row_client = client.clone();
        let switch_client = client.clone();
        div()
            .id(id)
            .flex()
            .items_center()
            .justify_between()
            .gap(px(TOGGLE_ROW_GAP))
            .px(px(TOGGLE_ROW_PADDING_X))
            .py(px(TOGGLE_ROW_PADDING_Y))
            .rounded(px(radius::MD))
            .border_1()
            .border_color(if dark {
                fade(t.border, 0.)
            } else {
                fade(t.border, 0.7)
            })
            .when(dark, |row| row.bg(fade(t.foreground, TOGGLE_ROW_DARK_FILL)))
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .when(disabled, |row| row.opacity(TOGGLE_ROW_DISABLED_OPACITY))
            .when(!disabled, |row| {
                row.cursor_pointer().on_click(move |_, _, cx| {
                    send(
                        &row_client,
                        cx,
                        "projectScriptEditorUpdate",
                        json!({ field: !checked }),
                    );
                })
            })
            .child(label)
            .child(
                Switch::new(SharedString::from(format!("{id}-switch")))
                    .checked(checked)
                    .disabled(disabled)
                    .on_change(move |value, _, _, cx| {
                        cx.stop_propagation();
                        send(
                            &switch_client,
                            cx,
                            "projectScriptEditorUpdate",
                            json!({ field: value }),
                        );
                    }),
            )
            .into_any_element()
    }

    fn icon_picker(&self, editor: &ProjectScriptEditorView, t: &Tokens) -> AnyElement {
        let dark = is_dark(t);
        let cells: Vec<AnyElement> = editor
            .icon_options
            .iter()
            .map(|option| {
                let selected = option.id == editor.form.icon;
                let client = self.client.clone();
                let id = option.id.clone();
                let hover_bg = fade(t.accent, 0.6);
                div()
                    .id(SharedString::from(format!(
                        "project-script-icon-{}",
                        option.id
                    )))
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(PICKER_GAP))
                    .w(px(PICKER_CELL_WIDTH))
                    .p(px(PICKER_CELL_PADDING))
                    .rounded(px(radius::MD))
                    .border_1()
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .cursor_pointer()
                    .when(selected, |cell| {
                        cell.bg(fade(t.primary, 0.1)).border_color(if dark {
                            fade(t.primary, 0.3)
                        } else {
                            fade(t.primary, 0.7)
                        })
                    })
                    .when(!selected, |cell| {
                        cell.border_color(if dark {
                            fade(t.border, 0.)
                        } else {
                            fade(t.border, 0.7)
                        })
                        .when(dark, |cell| {
                            cell.bg(fade(t.foreground, TOGGLE_ROW_DARK_FILL))
                        })
                        .hover(move |cell| cell.bg(hover_bg))
                    })
                    .on_click(move |_, _, cx| {
                        send(
                            &client,
                            cx,
                            "projectScriptEditorUpdate",
                            json!({ "icon": id }),
                        );
                    })
                    .child(icon(script_icon(&option.id), PICKER_GLYPH, t.foreground))
                    .child(option.label.clone())
                    .into_any_element()
            })
            .collect();
        let mut rows: Vec<AnyElement> = Vec::new();
        let mut cells = cells.into_iter().peekable();
        while cells.peek().is_some() {
            rows.push(
                div()
                    .flex()
                    .gap(px(PICKER_GAP))
                    .children(cells.by_ref().take(PICKER_COLUMNS))
                    .into_any_element(),
            );
        }
        let trigger = self.icon_trigger;
        let client = self.client.clone();
        PopoverPopup::new("project-script-icon-picker", trigger)
            .side(Side::Bottom)
            .align(Align::Start)
            .on_dismiss(move |window, cx| {
                if !trigger.contains(&window.mouse_position()) {
                    send(
                        &client,
                        cx,
                        "projectScriptEditorIconPicker",
                        json!({ "open": false }),
                    );
                }
            })
            .child(div().flex().flex_col().gap(px(PICKER_GAP)).children(rows))
            .into_any_element()
    }

    fn editor_dialog(
        &self,
        editor: &ProjectScriptEditorView,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = theme::active(cx);
        let client = &self.client;
        let saving = editor.is_saving;
        let form = &editor.form;
        let measure = cx.entity();
        let icon_open = editor.icon_picker_open;
        let icon_button = div()
            .relative()
            .flex_none()
            .child(
                Button::new("project-script-icon")
                    .variant(ButtonVariant::Outline)
                    .size(ButtonSize::Default)
                    .w(px(ICON_BUTTON_WIDTH))
                    .disabled(saving)
                    .accessibility_label("Choose icon")
                    .icon(script_icon(&form.icon))
                    .icon_size(ICON_BUTTON_GLYPH)
                    .icon_color(t.muted_foreground)
                    .on_click(on_click(
                        client,
                        "projectScriptEditorIconPicker",
                        json!({ "open": !icon_open }),
                    )),
            )
            .child(
                canvas(
                    move |bounds, _, cx| {
                        measure.update(cx, |host, _| host.icon_trigger = bounds);
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            );
        let hint = |content: AnyElement| {
            div()
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .text_color(t.muted_foreground)
                .child(content)
        };
        let keybinding_hint = div()
            .flex()
            .flex_wrap()
            .child("Press a shortcut. Use\u{a0}")
            .child(div().font_family(MONO_FONT).child("Backspace"))
            .child("\u{a0}to clear. Shortcuts are environment-wide. Projects using the same action share its shortcut.")
            .into_any_element();
        let section = |label: &'static str, field: AnyElement| {
            div()
                .flex()
                .flex_col()
                .gap(px(FIELD_GAP))
                .child(Label::new(label))
                .child(field)
        };
        let close = client.clone();
        let mut footer = DialogFooter::new().variant(DialogFooterVariant::Bare);
        if editor.is_editing {
            footer = footer.child(
                div().flex().flex_1().items_center().child(
                    Button::new("project-script-delete")
                        .variant(ButtonVariant::DestructiveOutline)
                        .disabled(saving)
                        .label(editor.copy.delete_label.clone())
                        .on_click(on_click(
                            client,
                            "projectScriptEditorRequestDelete",
                            json!({}),
                        )),
                ),
            );
        }
        let escape = client.clone();
        let escape_action = if editor.delete_confirm_open {
            ("projectScriptEditorCancelDelete", json!({}))
        } else if editor.icon_picker_open {
            ("projectScriptEditorIconPicker", json!({ "open": false }))
        } else {
            ("projectScriptEditorClose", json!({}))
        };
        DialogPopup::new("project-script-editor")
            .on_close(move |_, cx| send(&close, cx, "projectScriptEditorClose", json!({})))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .min_h_0()
                    .on_key_down(move |event: &KeyDownEvent, _, cx| {
                        if event.keystroke.key == "escape" {
                            cx.stop_propagation();
                            send(&escape, cx, escape_action.0, escape_action.1.clone());
                        }
                    })
                    .child(
                DialogHeader::new()
                    .with_panel(true)
                    .child(DialogTitle::new(editor.copy.title.clone()))
                    .child(DialogDescription::new(editor.copy.description.clone())),
            )
            .child(
                DialogPanel::new("project-script-editor-panel")
                    .after_header(true)
                    .before_bare_footer(true)
                    .child(section(
                        "Name",
                        div()
                            .flex()
                            .items_center()
                            .gap(px(NAME_ROW_GAP))
                            .child(icon_button)
                            .child(Input::new(&self.name).disabled(saving))
                            .into_any_element(),
                    ))
                    .child(
                        section("Keybinding", self.keybinding_field(editor, &t, window))
                            .child(hint(keybinding_hint)),
                    )
                    .child(section(
                        "Command",
                        Textarea::new(&self.command)
                            .disabled(saving)
                            .into_any_element(),
                    ))
                    .child(
                        section(
                            "Preview URL (optional)",
                            Input::new(&self.preview_url)
                                .disabled(saving)
                                .into_any_element(),
                        )
                        .child(hint(
                            div()
                                .child("Open this URL in the in-app preview when this action runs.")
                                .into_any_element(),
                        )),
                    )
                    .child(Self::toggle_row(
                        "project-script-run-on-create",
                        "Run automatically on worktree creation",
                        form.run_on_worktree_create,
                        saving,
                        "runOnWorktreeCreate",
                        client,
                        &t,
                    ))
                    .child(Self::toggle_row(
                        "project-script-wait-for-setup",
                        "Wait for it to finish before the agent starts",
                        form.wait_for_setup,
                        saving || editor.toggles.wait_for_setup_disabled,
                        "waitForSetup",
                        client,
                        &t,
                    ))
                    .child(Self::toggle_row(
                        "project-script-auto-open-preview",
                        "Open preview automatically when this action runs",
                        form.auto_open_preview,
                        saving || editor.toggles.auto_open_preview_disabled,
                        "autoOpenPreview",
                        client,
                        &t,
                    ))
                    .when_some(editor.validation_error.clone(), |panel, error| {
                        panel.child(
                            div()
                                .text_size(px(text::SM))
                                .line_height(px(text::SM_LINE))
                                .text_color(t.destructive)
                                .child(error),
                        )
                    }),
            )
            .child(
                footer
                    .child(
                        Button::new("project-script-cancel")
                            .variant(ButtonVariant::Outline)
                            .label(editor.copy.cancel_label.clone())
                            .on_click(on_click(client, "projectScriptEditorClose", json!({}))),
                    )
                    .child(
                        Button::new("project-script-submit")
                            .disabled(saving)
                            .label(editor.copy.submit_label.clone())
                            .on_click(on_click(client, "projectScriptEditorSubmit", json!({}))),
                    ),
            ))
            .into_any_element()
    }

    fn delete_confirm(&self, editor: &ProjectScriptEditorView) -> AnyElement {
        let client = &self.client;
        let dismiss = client.clone();
        AlertDialogPopup::new("project-script-delete-confirm")
            .on_dismiss(move |_, cx| {
                send(&dismiss, cx, "projectScriptEditorCancelDelete", json!({}))
            })
            .child(
                AlertDialogHeader::new()
                    .child(AlertDialogTitle::new(
                        editor.copy.delete_confirm_title.clone(),
                    ))
                    .child(AlertDialogDescription::new(
                        editor.copy.delete_confirm_description.clone(),
                    )),
            )
            .child(
                AlertDialogFooter::new()
                    .child(
                        Button::new("project-script-delete-cancel")
                            .variant(ButtonVariant::Outline)
                            .label(editor.copy.cancel_label.clone())
                            .on_click(on_click(
                                client,
                                "projectScriptEditorCancelDelete",
                                json!({}),
                            )),
                    )
                    .child(
                        Button::new("project-script-delete-confirm-button")
                            .variant(ButtonVariant::Destructive)
                            .disabled(editor.is_saving)
                            .label(editor.copy.delete_confirm_label.clone())
                            .on_click(on_click(
                                client,
                                "projectScriptEditorConfirmDelete",
                                json!({}),
                            )),
                    ),
            )
            .into_any_element()
    }
}

impl Render for ProjectScriptsHost {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(editor) = self.editor(cx) else {
            return div();
        };
        let t = theme::active(cx);
        div()
            .child(self.editor_dialog(&editor, window, cx))
            .when(editor.icon_picker_open, |root| {
                root.child(self.icon_picker(&editor, &t))
            })
            .when(editor.delete_confirm_open, |root| {
                root.child(self.delete_confirm(&editor))
            })
    }
}
