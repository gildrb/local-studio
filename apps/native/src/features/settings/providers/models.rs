use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Context, InteractiveElement, IntoElement, KeyDownEvent, ParentElement,
    SharedString, StatefulInteractiveElement, Styled, Window, div, px, svg,
};
use serde_json::{Value, json};

use super::{InputMode, InputSpec, ProvidersSection, act, click, muted, tip};
use crate::app_core::client::CoreClient;
use crate::app_core::views::settings_providers::{
    CustomModelEditorView, EditorDescriptorRow, ModelRow, ProviderModelsView,
};
use crate::features::settings::primitives::{
    SettingsControlWidth, SettingsSelect, SettingsSelectOption, settings_switch,
};
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::input::{Input, InputFont, InputSize};
use crate::ui::switch::SwitchSize;
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};

const MODELS_ACTION: &str = "settingsProvidersModels";
const EDITOR_ACTION: &str = "settingsProvidersModelEditor";
const WRAP_PADDING_X: f32 = 8.;
const WRAP_PADDING_Y: f32 = 12.;
const INNER_INSET: f32 = 8.;
const DESCRIPTION_GAP: f32 = 12.;
const TOOLBAR_GAP: f32 = 8.;
const FILTER_WIDTH: f32 = 224.;
const LIST_TOP: f32 = 8.;
const LIST_MAX_HEIGHT: f32 = 256.;
const ROW_HEIGHT: f32 = 28.;
const ROW_GAP: f32 = 8.;
const ROW_PADDING_X: f32 = 8.;
const STAR_COLUMN: f32 = 24.;
const ACTIONS_MIN: f32 = 88.;
const MICRO_ICON: f32 = 12.;
const TEXT_2XS: f32 = 11.;
const GROUP_LABEL_FIRST_TOP: f32 = 4.;
const GROUP_LABEL_TOP: f32 = 20.;
const GROUP_LABEL_BOTTOM: f32 = 6.;
const FORM_TOP: f32 = 12.;
const ERROR_TOP: f32 = 8.;
const EDITOR_GAP: f32 = 12.;
const EDITOR_PADDING: f32 = 12.;
const EDITOR_NAME_WIDTH: f32 = 288.;
const COPY_FROM_WIDTH: f32 = 176.;
const DESCRIPTOR_PADDING: f32 = 10.;
const POSITION_WIDTH: f32 = 56.;
const ID_SELECT_WIDTH: f32 = 160.;
const ID_INPUT_WIDTH: f32 = 144.;
const TYPE_SELECT_WIDTH: f32 = 96.;
const CHOICES_INSET: f32 = 64.;
const CHOICE_VALUE_WIDTH: f32 = 112.;
const CHOICE_GAP: f32 = 6.;

fn models_params(instance_id: &str, intent: Value) -> Value {
    json!({ "instanceId": instance_id, "intent": intent })
}

fn row_action_button(
    id: String,
    icon: &'static str,
    action: &crate::app_core::views::settings_providers::ModelRowAction,
    on_click: impl Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static,
) -> AnyElement {
    tip(
        format!("{id}-tip"),
        action.tooltip.clone(),
        Button::new(SharedString::from(id))
            .size(ButtonSize::IconMicro)
            .variant(ButtonVariant::GhostMuted)
            .icon(icon)
            .icon_size(MICRO_ICON)
            .disabled(action.disabled)
            .accessibility_label(action.aria_label.clone())
            .on_click(on_click),
    )
}

fn model_row(
    instance_id: &str,
    row: &ModelRow,
    client: &gpui::Entity<CoreClient>,
    read_only: bool,
    t: &Tokens,
) -> AnyElement {
    let key = format!("model-{instance_id}-{}", row.slug);
    let send = |intent: Value| click(client, MODELS_ACTION, models_params(instance_id, intent));
    let star = tip(
        format!("{key}-star-tip"),
        row.favorite.tooltip.clone(),
        Button::new(SharedString::from(format!("{key}-star")))
            .size(ButtonSize::IconMicro)
            .variant(ButtonVariant::GhostMuted)
            .when(!row.favorite.active, |button| {
                button.icon("star").icon_size(MICRO_ICON)
            })
            .when(row.favorite.active, |button| {
                button.child(
                    svg()
                        .path("icons/star-filled.svg")
                        .size(px(MICRO_ICON))
                        .text_color(t.warning),
                )
            })
            .disabled(read_only)
            .on_click(send(json!({ "kind": "toggle-favorite", "slug": row.slug }))),
    );
    let mut actions: Vec<AnyElement> = Vec::new();
    if let (Some(up), Some(down)) = (&row.move_up, &row.move_down) {
        actions.push(row_action_button(
            format!("{key}-up"),
            "arrow-up",
            up,
            send(json!({ "kind": "move", "slug": row.slug, "direction": -1 })),
        ));
        actions.push(row_action_button(
            format!("{key}-down"),
            "arrow-down",
            down,
            send(json!({ "kind": "move", "slug": row.slug, "direction": 1 })),
        ));
    }
    if let (Some(edit), Some(remove)) = (&row.edit, &row.remove) {
        actions.push(row_action_button(
            format!("{key}-edit"),
            "pencil",
            edit,
            send(json!({ "kind": "toggle-edit", "slug": row.slug })),
        ));
        actions.push(row_action_button(
            format!("{key}-remove"),
            "x",
            remove,
            send(json!({ "kind": "remove-custom-model", "slug": row.slug })),
        ));
    }
    let switch_client = client.clone();
    let switch_instance = instance_id.to_string();
    let switch_slug = row.slug.clone();
    let picker = tip(
        format!("{key}-picker-tip"),
        row.picker_switch.tooltip.clone(),
        settings_switch(
            SharedString::from(format!("{key}-picker")),
            row.picker_switch.checked,
        )
        .size(SwitchSize::Sm)
        .disabled(row.picker_switch.disabled || read_only)
        .on_change(move |checked, _, _, cx| {
            act(
                &switch_client,
                cx,
                MODELS_ACTION,
                models_params(
                    &switch_instance,
                    json!({ "kind": "set-hidden", "slug": switch_slug, "hidden": !checked }),
                ),
            )
        }),
    );
    let hover = fade(t.muted, 0.3);
    div()
        .id(SharedString::from(format!("{key}-row")))
        .flex()
        .h(px(ROW_HEIGHT))
        .items_center()
        .gap(px(ROW_GAP))
        .px(px(ROW_PADDING_X))
        .rounded(px(radius::SM))
        .hover(move |style| style.bg(hover))
        .when(row.is_hidden, |this| this.opacity(0.5))
        .child(div().w(px(STAR_COLUMN)).flex_none().child(star))
        .child(
            div()
                .flex()
                .flex_1()
                .min_w_0()
                .items_baseline()
                .gap(px(8.))
                .child(
                    div()
                        .min_w_0()
                        .truncate()
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .text_color(if row.is_hidden {
                            t.muted_foreground
                        } else {
                            fade(t.foreground, 0.9)
                        })
                        .child(row.name.clone()),
                )
                .when(row.show_slug, |this| {
                    this.child(
                        div()
                            .min_w_0()
                            .truncate()
                            .font_family(MONO_FONT)
                            .text_size(px(TEXT_2XS))
                            .text_color(fade(t.muted_foreground, 0.7))
                            .child(row.slug.clone()),
                    )
                })
                .children(row.custom_badge.clone().map(|badge| {
                    div()
                        .flex_none()
                        .text_size(px(TEXT_2XS))
                        .text_color(fade(t.muted_foreground, 0.7))
                        .child(badge)
                })),
        )
        .child(
            div()
                .flex_none()
                .text_size(px(TEXT_2XS))
                .text_color(fade(t.muted_foreground, 0.7))
                .children(row.capability_summary.clone()),
        )
        .child(
            div()
                .flex()
                .flex_none()
                .min_w(px(ACTIONS_MIN))
                .items_center()
                .justify_end()
                .gap(px(2.))
                .children(actions),
        )
        .child(div().flex().flex_none().items_center().child(picker))
        .into_any_element()
}

fn editor_input(
    section: &mut ProvidersSection,
    key: String,
    value: &str,
    placeholder: &str,
    on_value: super::ValueHandler,
    window: &mut Window,
    cx: &mut Context<ProvidersSection>,
) -> gpui::Entity<gpui::component::input::InputState> {
    section.input(
        InputSpec {
            key,
            value: value.to_string(),
            placeholder: placeholder.to_string(),
            masked: false,
            mode: InputMode::Live,
            on_value,
            on_enter: None,
            on_blur: None,
        },
        window,
        cx,
    )
}

fn editor_handler(
    client: &gpui::Entity<CoreClient>,
    instance_id: &str,
    build: impl Fn(String) -> Value + 'static,
) -> super::ValueHandler {
    let client = client.clone();
    let instance_id = instance_id.to_string();
    Rc::new(move |value, cx| {
        act(
            &client,
            cx,
            EDITOR_ACTION,
            json!({ "instanceId": instance_id, "intent": build(value) }),
        )
    })
}

fn select_handler(
    client: &gpui::Entity<CoreClient>,
    instance_id: &str,
    build: impl Fn(String) -> Value + 'static,
) -> impl Fn(&SharedString, &mut Window, &mut App) + 'static {
    let handler = editor_handler(client, instance_id, build);
    move |value, _, cx| handler(value.to_string(), cx)
}

fn descriptor_box(
    section: &mut ProvidersSection,
    instance_id: &str,
    descriptor: &EditorDescriptorRow,
    window: &mut Window,
    cx: &mut Context<ProvidersSection>,
) -> AnyElement {
    let t = theme::active(cx);
    let client = section.client.clone();
    let key = descriptor.key.clone();
    let prefix = format!("descriptor:{instance_id}:{key}");
    let id_input = descriptor.id_input.visible.then(|| {
        let key = key.clone();
        let state = editor_input(
            section,
            format!("{prefix}:id"),
            &descriptor.id_input.value,
            &descriptor.id_input.placeholder,
            editor_handler(
                &client,
                instance_id,
                move |id| json!({ "kind": "set-descriptor-id", "descriptorKey": key, "id": id }),
            ),
            window,
            cx,
        );
        div().w(px(ID_INPUT_WIDTH)).flex_none().child(
            Input::new(&state)
                .size(InputSize::Compact)
                .font(InputFont::Mono),
        )
    });
    let label_key = key.clone();
    let label = editor_input(
        section,
        format!("{prefix}:label"),
        &descriptor.label.value,
        &descriptor.label.placeholder,
        editor_handler(
            &client,
            instance_id,
            move |label| json!({ "kind": "set-descriptor-label", "descriptorKey": label_key, "label": label }),
        ),
        window,
        cx,
    );
    let id_select = descriptor.id_select.visible.then(|| {
        let key = key.clone();
        SettingsSelect::new(SharedString::from(format!("{prefix}:preset")))
            .options(
                descriptor
                    .id_select
                    .preset_options
                    .iter()
                    .map(|option| {
                        SettingsSelectOption::new(
                            option.value.clone(),
                            format!("{}  {}", option.value, option.label),
                        )
                    })
                    .chain(std::iter::once(SettingsSelectOption::new(
                        descriptor.id_select.custom_option.value.clone(),
                        descriptor.id_select.custom_option.label.clone(),
                    ))),
            )
            .value(Some(descriptor.id_select.value.clone()))
            .value_label(descriptor.id_select.display_label.clone())
            .width(SettingsControlWidth::Fixed(ID_SELECT_WIDTH))
            .on_change(select_handler(&client, instance_id, move |value| {
                json!({ "kind": "select-descriptor-preset", "descriptorKey": key, "value": value })
            }))
    });
    let type_key = key.clone();
    let type_select = SettingsSelect::new(SharedString::from(format!("{prefix}:type")))
        .options(
            descriptor
                .kind
                .options
                .iter()
                .map(|option| SettingsSelectOption::new(option.value.clone(), option.label.clone())),
        )
        .value(Some(descriptor.kind.value.clone()))
        .value_label(descriptor.kind.display_label.clone())
        .width(SettingsControlWidth::Fixed(TYPE_SELECT_WIDTH))
        .on_change(select_handler(&client, instance_id, move |value| {
            json!({ "kind": "set-descriptor-type", "descriptorKey": type_key, "value": value })
        }));
    let remove = Button::new(SharedString::from(format!("{prefix}:remove")))
        .size(ButtonSize::IconMicro)
        .variant(ButtonVariant::GhostMuted)
        .icon("x")
        .icon_size(MICRO_ICON)
        .on_click(click(
            &client,
            EDITOR_ACTION,
            json!({ "instanceId": instance_id, "intent": { "kind": "remove-descriptor", "descriptorKey": key } }),
        ));
    let choices = descriptor.choices.as_ref().map(|choices| {
        let rows: Vec<AnyElement> = choices
            .iter()
            .map(|choice| {
                let choice_prefix = format!("{prefix}:choice:{}", choice.key);
                let (descriptor_key, choice_key) = (key.clone(), choice.key.clone());
                let value = editor_input(
                    section,
                    format!("{choice_prefix}:value"),
                    &choice.value,
                    &choice.value_placeholder,
                    editor_handler(&client, instance_id, move |id| {
                        json!({ "kind": "set-choice-id", "descriptorKey": descriptor_key, "choiceKey": choice_key, "id": id })
                    }),
                    window,
                    cx,
                );
                let (descriptor_key, choice_key) = (key.clone(), choice.key.clone());
                let label = editor_input(
                    section,
                    format!("{choice_prefix}:label"),
                    &choice.label,
                    &choice.label_placeholder,
                    editor_handler(&client, instance_id, move |label| {
                        json!({ "kind": "set-choice-label", "descriptorKey": descriptor_key, "choiceKey": choice_key, "label": label })
                    }),
                    window,
                    cx,
                );
                let default_client = client.clone();
                let default_instance = instance_id.to_string();
                let (descriptor_key, choice_key) = (key.clone(), choice.key.clone());
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(
                        div()
                            .w(px(CHOICE_VALUE_WIDTH))
                            .flex_none()
                            .child(Input::new(&value).size(InputSize::Compact).font(InputFont::Mono)),
                    )
                    .child(div().flex_1().min_w_0().child(Input::new(&label).size(InputSize::Compact)))
                    .child(
                        div()
                            .flex()
                            .flex_none()
                            .items_center()
                            .gap(px(CHOICE_GAP))
                            .text_size(px(TEXT_2XS))
                            .text_color(t.muted_foreground)
                            .child(
                                settings_switch(
                                    SharedString::from(format!("{choice_prefix}:default")),
                                    choice.is_default,
                                )
                                .size(SwitchSize::Sm)
                                .on_change(move |checked, _, _, cx| {
                                    act(
                                        &default_client,
                                        cx,
                                        EDITOR_ACTION,
                                        json!({ "instanceId": default_instance, "intent": {
                                            "kind": "set-choice-default",
                                            "descriptorKey": descriptor_key,
                                            "choiceKey": choice_key,
                                            "isDefault": checked,
                                        } }),
                                    )
                                }),
                            )
                            .child(choice.default_label.clone()),
                    )
                    .child(
                        Button::new(SharedString::from(format!("{choice_prefix}:remove")))
                            .size(ButtonSize::IconMicro)
                            .variant(ButtonVariant::GhostMuted)
                            .icon("x")
                            .icon_size(MICRO_ICON)
                            .on_click(click(
                                &client,
                                EDITOR_ACTION,
                                json!({ "instanceId": instance_id, "intent": {
                                    "kind": "remove-choice",
                                    "descriptorKey": key,
                                    "choiceKey": choice.key,
                                } }),
                            )),
                    )
                    .into_any_element()
            })
            .collect();
        div()
            .flex()
            .flex_col()
            .gap(px(CHOICE_GAP))
            .pl(px(CHOICES_INSET))
            .children(rows)
            .child(
                div().flex().child(
                    Button::new(SharedString::from(format!("{prefix}:add-choice")))
                        .size(ButtonSize::Xs)
                        .variant(ButtonVariant::GhostMuted)
                        .icon("plus")
                        .icon_size(MICRO_ICON)
                        .label(descriptor.add_choice_label.clone())
                        .on_click(click(
                            &client,
                            EDITOR_ACTION,
                            json!({ "instanceId": instance_id, "intent": { "kind": "add-choice", "descriptorKey": key } }),
                        )),
                ),
            )
    });
    div()
        .flex()
        .flex_col()
        .gap(px(8.))
        .rounded(px(radius::SM))
        .border_1()
        .border_color(fade(t.border, 0.6))
        .bg(fade(t.background, 0.4))
        .p(px(DESCRIPTOR_PADDING))
        .child(
            div()
                .flex()
                .flex_wrap()
                .items_center()
                .gap(px(8.))
                .child(
                    div()
                        .w(px(POSITION_WIDTH))
                        .flex_none()
                        .text_size(px(TEXT_2XS))
                        .text_color(t.muted_foreground)
                        .child(descriptor.position_label.clone()),
                )
                .children(id_select)
                .children(id_input)
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .child(Input::new(&label).size(InputSize::Compact)),
                )
                .child(type_select)
                .child(remove),
        )
        .children(choices)
        .into_any_element()
}

fn custom_editor(
    section: &mut ProvidersSection,
    instance_id: &str,
    editor: &CustomModelEditorView,
    window: &mut Window,
    cx: &mut Context<ProvidersSection>,
) -> AnyElement {
    let t = theme::active(cx);
    let client = section.client.clone();
    let name = editor_input(
        section,
        format!("editor-name:{instance_id}:{}", editor.slug),
        &editor.name.value,
        &editor.name.placeholder,
        editor_handler(
            &client,
            instance_id,
            |name| json!({ "kind": "set-name", "name": name }),
        ),
        window,
        cx,
    );
    section.focus_input_once(
        format!("editor:{instance_id}:{}", editor.slug),
        &name,
        window,
        cx,
    );
    let copy_from = editor.copy_from.as_ref().map(|copy| {
        SettingsSelect::new(SharedString::from(format!("editor-copy:{instance_id}")))
            .options(copy.options.iter().map(|option| {
                SettingsSelectOption::new(option.value.clone(), option.label.clone())
            }))
            .value(None::<SharedString>)
            .placeholder(copy.placeholder.clone())
            .width(SettingsControlWidth::Fixed(COPY_FROM_WIDTH))
            .on_change(select_handler(
                &client,
                instance_id,
                |slug| json!({ "kind": "copy-from-model", "slug": slug }),
            ))
    });
    let descriptors: Vec<AnyElement> = editor
        .descriptors
        .iter()
        .map(|descriptor| descriptor_box(section, instance_id, descriptor, window, cx))
        .collect();
    let presets = editor.preset_buttons.iter().map(|preset| {
        Button::new(SharedString::from(format!("editor-preset:{instance_id}:{}", preset.value)))
            .size(ButtonSize::Xs)
            .variant(ButtonVariant::GhostMuted)
            .icon("plus")
            .icon_size(MICRO_ICON)
            .label(preset.label.clone())
            .on_click(click(
                &client,
                EDITOR_ACTION,
                json!({ "instanceId": instance_id, "intent": { "kind": "add-preset-descriptor", "presetId": preset.value } }),
            ))
    });
    let escape_client = client.clone();
    let escape_instance = instance_id.to_string();
    div()
        .id(SharedString::from(format!("custom-model-editor-{instance_id}")))
        .mx(px(ROW_PADDING_X))
        .mt(px(4.))
        .mb(px(8.))
        .flex()
        .flex_col()
        .gap(px(EDITOR_GAP))
        .rounded(px(radius::SM))
        .border_1()
        .border_color(t.border)
        .bg(fade(t.muted, 0.2))
        .p(px(EDITOR_PADDING))
        .on_key_down(move |event: &KeyDownEvent, _, cx| {
            if event.keystroke.key == "escape" {
                cx.stop_propagation();
                act(
                    &escape_client,
                    cx,
                    EDITOR_ACTION,
                    json!({ "instanceId": escape_instance, "intent": { "kind": "cancel" } }),
                );
            }
        })
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(4.))
                .child(muted(editor.name.label.clone(), &t))
                .child(div().w(px(EDITOR_NAME_WIDTH)).max_w_full().child(Input::new(&name).size(InputSize::Sm))),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .justify_between()
                        .gap(px(8.))
                        .child(muted(editor.options_heading.clone(), &t))
                        .children(copy_from),
                )
                .children(editor.empty_message.clone().map(|message| {
                    div()
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .text_color(fade(t.muted_foreground, 0.7))
                        .child(message)
                }))
                .children(descriptors)
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap(px(4.))
                        .children(presets)
                        .child(
                            Button::new(SharedString::from(format!("editor-custom:{instance_id}")))
                                .size(ButtonSize::Xs)
                                .variant(ButtonVariant::GhostMuted)
                                .icon("plus")
                                .icon_size(MICRO_ICON)
                                .label(editor.custom_option_label.clone())
                                .on_click(click(
                                    &client,
                                    EDITOR_ACTION,
                                    json!({ "instanceId": instance_id, "intent": { "kind": "add-custom-descriptor" } }),
                                )),
                        ),
                ),
        )
        .children(editor.error.clone().map(|error| {
            div()
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .text_color(t.destructive_foreground)
                .child(error)
        }))
        .child(
            div()
                .flex()
                .gap(px(8.))
                .child(
                    Button::new(SharedString::from(format!("editor-save:{instance_id}")))
                        .size(ButtonSize::Sm)
                        .variant(ButtonVariant::Outline)
                        .label(editor.save_label.clone())
                        .on_click(click(
                            &client,
                            EDITOR_ACTION,
                            json!({ "instanceId": instance_id, "intent": { "kind": "save" } }),
                        )),
                )
                .child(
                    Button::new(SharedString::from(format!("editor-cancel:{instance_id}")))
                        .size(ButtonSize::Sm)
                        .variant(ButtonVariant::Ghost)
                        .label(editor.cancel_label.clone())
                        .on_click(click(
                            &client,
                            EDITOR_ACTION,
                            json!({ "instanceId": instance_id, "intent": { "kind": "cancel" } }),
                        )),
                ),
        )
        .into_any_element()
}

pub(super) fn section(
    section: &mut ProvidersSection,
    instance_id: &str,
    model: &ProviderModelsView,
    read_only: bool,
    window: &mut Window,
    cx: &mut Context<ProvidersSection>,
) -> AnyElement {
    let t = theme::active(cx);
    let client = section.client.clone();
    let filter = model.filter.visible.then(|| {
        let filter_client = client.clone();
        let filter_instance = instance_id.to_string();
        let state = section.input(
            InputSpec {
                key: format!("models-filter:{instance_id}"),
                value: model.filter.value.clone(),
                placeholder: model.filter.placeholder.clone(),
                masked: false,
                mode: InputMode::Live,
                on_value: Rc::new(move |value, cx| {
                    act(
                        &filter_client,
                        cx,
                        MODELS_ACTION,
                        models_params(
                            &filter_instance,
                            json!({ "kind": "set-filter", "value": value }),
                        ),
                    )
                }),
                on_enter: None,
                on_blur: None,
            },
            window,
            cx,
        );
        div()
            .w(px(FILTER_WIDTH))
            .max_w_full()
            .child(Input::new(&state).size(InputSize::Sm).disabled(read_only))
    });
    let add = &model.add_custom_model;
    let toolbar = div()
        .flex()
        .flex_wrap()
        .items_center()
        .justify_between()
        .gap(px(TOOLBAR_GAP))
        .px(px(INNER_INSET))
        .children(filter)
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(TOOLBAR_GAP))
                .children(model.bulk_toggle.as_ref().map(|bulk| {
                    Button::new(SharedString::from(format!("models-bulk:{instance_id}")))
                        .size(ButtonSize::Xs)
                        .variant(ButtonVariant::GhostMuted)
                        .label(bulk.label.clone())
                        .disabled(read_only)
                        .on_click(click(
                            &client,
                            MODELS_ACTION,
                            models_params(instance_id, json!({ "kind": "bulk-toggle-hidden" })),
                        ))
                }))
                .child(muted(model.summary.clone(), &t)),
        )
        .when(add.show_add_button, |this| {
            this.child(
                div().ml_auto().child(
                    Button::new(SharedString::from(format!("models-add:{instance_id}")))
                        .size(ButtonSize::Xs)
                        .variant(ButtonVariant::GhostMuted)
                        .icon("plus")
                        .icon_size(MICRO_ICON)
                        .label(add.add_button_label.clone())
                        .disabled(read_only)
                        .on_click(click(
                            &client,
                            MODELS_ACTION,
                            models_params(instance_id, json!({ "kind": "start-add" })),
                        )),
                ),
            )
        });
    let mut rows: Vec<AnyElement> = Vec::new();
    for row in &model.rows {
        if let Some(label) = &row.group_label {
            rows.push(
                div()
                    .px(px(ROW_PADDING_X))
                    .pb(px(GROUP_LABEL_BOTTOM))
                    .pt(px(if row.group_label_is_first {
                        GROUP_LABEL_FIRST_TOP
                    } else {
                        GROUP_LABEL_TOP
                    }))
                    .text_size(px(TEXT_2XS))
                    .text_color(t.muted_foreground)
                    .child(label.clone())
                    .into_any_element(),
            );
        }
        rows.push(model_row(instance_id, row, &client, read_only, &t));
        if let Some(editor) = model
            .editor
            .as_ref()
            .filter(|editor| editor.slug == row.slug)
        {
            rows.push(custom_editor(section, instance_id, editor, window, cx));
        }
    }
    let form = add.show_form.then(|| {
        let input_client = client.clone();
        let input_instance = instance_id.to_string();
        let enter_client = client.clone();
        let enter_instance = instance_id.to_string();
        let state = section.input(
            InputSpec {
                key: format!("models-add-input:{instance_id}:{}", model.add_revision),
                value: String::new(),
                placeholder: add.placeholder.clone().unwrap_or_default(),
                masked: false,
                mode: InputMode::Live,
                on_value: Rc::new(move |value, cx| {
                    act(
                        &input_client,
                        cx,
                        MODELS_ACTION,
                        models_params(
                            &input_instance,
                            json!({ "kind": "set-input", "value": value }),
                        ),
                    )
                }),
                on_enter: Some(Rc::new(move |cx| {
                    act(
                        &enter_client,
                        cx,
                        MODELS_ACTION,
                        models_params(&enter_instance, json!({ "kind": "submit-add" })),
                    )
                })),
                on_blur: None,
            },
            window,
            cx,
        );
        section.focus_input_once(
            format!("models-add:{instance_id}:{}", model.add_revision),
            &state,
            window,
            cx,
        );
        let escape_client = client.clone();
        let escape_instance = instance_id.to_string();
        div()
            .id(SharedString::from(format!("models-add-form:{instance_id}")))
            .mt(px(FORM_TOP))
            .px(px(INNER_INSET))
            .flex()
            .gap(px(8.))
            .on_key_down(move |event: &KeyDownEvent, _, cx| {
                if event.keystroke.key == "escape" {
                    cx.stop_propagation();
                    act(
                        &escape_client,
                        cx,
                        MODELS_ACTION,
                        models_params(&escape_instance, json!({ "kind": "cancel-add" })),
                    );
                }
            })
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .child(Input::new(&state).size(InputSize::Sm)),
            )
            .child(
                div()
                    .flex()
                    .flex_none()
                    .gap(px(8.))
                    .child(
                        Button::new(SharedString::from(format!("models-submit:{instance_id}")))
                            .size(ButtonSize::Sm)
                            .variant(ButtonVariant::Outline)
                            .label(add.submit_label.clone())
                            .on_click(click(
                                &client,
                                MODELS_ACTION,
                                models_params(instance_id, json!({ "kind": "submit-add" })),
                            )),
                    )
                    .child(
                        Button::new(SharedString::from(format!("models-cancel:{instance_id}")))
                            .size(ButtonSize::Sm)
                            .variant(ButtonVariant::Ghost)
                            .label(add.cancel_label.clone())
                            .on_click(click(
                                &client,
                                MODELS_ACTION,
                                models_params(instance_id, json!({ "kind": "cancel-add" })),
                            )),
                    ),
            )
    });
    div()
        .px(px(WRAP_PADDING_X))
        .py(px(WRAP_PADDING_Y))
        .child(
            div()
                .px(px(INNER_INSET))
                .mb(px(DESCRIPTION_GAP))
                .child(muted(model.description.clone(), &t)),
        )
        .child(toolbar)
        .child(
            div()
                .id(SharedString::from(format!("models-list:{instance_id}")))
                .mt(px(LIST_TOP))
                .max_h(px(LIST_MAX_HEIGHT))
                .overflow_y_scroll()
                .children(model.empty_message.clone().map(|message| {
                    div()
                        .px(px(ROW_PADDING_X))
                        .py(px(8.))
                        .child(muted(message, &t))
                }))
                .children(rows),
        )
        .children(form)
        .children(add.error.clone().map(|error| {
            div()
                .mt(px(ERROR_TOP))
                .px(px(INNER_INSET))
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .text_color(t.destructive_foreground)
                .child(error)
        }))
        .into_any_element()
}
