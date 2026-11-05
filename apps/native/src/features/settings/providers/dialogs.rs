use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, BoxShadow, Context, Entity, FontWeight, InteractiveElement, IntoElement,
    ParentElement, Rgba, SharedString, StatefulInteractiveElement, Styled, Window, div, img, px,
    svg,
};
use serde_json::{Value, json};

use super::card::icon_driver_kind;
use super::{InputMode, InputSpec, ProvidersSection, accent, act};
use crate::app_core::client::CoreClient;
use crate::app_core::views::settings_providers::{
    AddHubDialog, AddInstanceView, DriverOptionView, ProviderFormField, UsageHubRow, WizardPrimary,
    WizardTextField,
};
use crate::features::chat::provider_instance_icon::{ProviderInstanceIcon, parse_accent};
use crate::features::settings::primitives::{
    SettingsControlWidth, SettingsSelect, SettingsSelectOption, settings_switch,
};
use crate::ui::alert_dialog::{
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup,
    AlertDialogTitle,
};
use crate::ui::badge::{Badge, BadgeSize, BadgeVariant};
use crate::ui::button::{Button, ButtonVariant};
use crate::ui::dialog::{
    DialogDescription, DialogFooter, DialogFooterVariant, DialogHeader, DialogPanel, DialogPopup,
    DialogTitle,
};
use crate::ui::input::Input;
use crate::ui::popover::{black, dark, shadow, white};
use crate::ui::textarea::Textarea;
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};

const ADD_INSTANCE: &str = "settingsProvidersAddInstance";
const USAGE: &str = "settingsProvidersUsage";
const WIZARD_WIDTH: f32 = 768.;
const HUB_WIDTH: f32 = 448.;
const PANEL_PADDING_X: f32 = 24.;
const PANEL_PADDING_Y: f32 = 20.;
const PANEL_FIELD_GAP: f32 = 0.;
const CONFIG_LINE_LABEL: f32 = 24.;
const CONFIG_LINE_DESCRIPTION: f32 = 22.;
const PANEL_GAP: f32 = 16.;
const FIELD_GAP: f32 = 8.;
const FORM_FIELD_GAP: f32 = 6.;
const STEPS_PADDING: f32 = 4.;
const STEPS_RADIUS: f32 = 12.;
const STEP_GAP: f32 = 4.;
const STEP_PADDING_X: f32 = 10.;
const STEP_PADDING_Y: f32 = 8.;
const STEP_NUMBER: f32 = 20.;
const STEP_CHECK: f32 = 16.;
const OPTION_GAP: f32 = 12.;
const OPTION_PADDING: f32 = 12.;
const OPTION_ICON: f32 = 16.;
const OPTION_INDICATOR: f32 = 20.;
const OPTION_CHECK: f32 = 14.;
const SWATCH: f32 = 24.;
const SWATCH_GAP: f32 = 6.;
const TEXT_2XS: f32 = 11.;
const DISABLED_OPACITY: f32 = 0.64;

fn zinc_25() -> Rgba {
    gpui::rgb(0xfcfcfc)
}

fn ring(color: Rgba, width: f32) -> BoxShadow {
    shadow(0., 0., 0., width, color)
}

fn soft_ring(t: &Tokens) -> BoxShadow {
    ring(if dark(t) { white(0.05) } else { black(0.05) }, 1.)
}

fn add_click(
    client: &Entity<CoreClient>,
    intent: Value,
) -> impl Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static {
    let client = client.clone();
    move |_, _, cx| {
        act(
            &client,
            cx,
            ADD_INSTANCE,
            json!({ "intent": intent.clone() }),
        )
    }
}

fn icon(path: &str, size: f32, color: Rgba) -> AnyElement {
    svg()
        .path(SharedString::from(path.to_string()))
        .size(px(size))
        .flex_none()
        .text_color(color)
        .into_any_element()
}

fn option_icon(option: &DriverOptionView, color: Rgba) -> AnyElement {
    match option.icon_key.as_str() {
        "github-copilot" => icon("icons/providers/github-copilot.svg", OPTION_ICON, color),
        "acp-registry" => icon("icons/providers/acp-registry.svg", OPTION_ICON, color),
        "gemini" => img("icons/providers/gemini.svg")
            .size(px(OPTION_ICON))
            .flex_none()
            .into_any_element(),
        key => ProviderInstanceIcon::new(
            icon_driver_kind(key).unwrap_or_default(),
            String::new(),
            color,
        )
        .icon_size(OPTION_ICON)
        .into_any_element(),
    }
}

fn steps(add: &AddInstanceView, client: &Entity<CoreClient>, t: &Tokens) -> AnyElement {
    let dark_mode = dark(t);
    div()
        .flex()
        .gap(px(STEP_GAP))
        .p(px(STEPS_PADDING))
        .rounded(px(STEPS_RADIUS))
        .bg(if dark_mode { white(0.04) } else { zinc_25() })
        .shadow(vec![soft_ring(t)])
        .children(add.steps.iter().enumerate().map(|(index, step)| {
            let done = index < add.current_step;
            let current = step.current;
            let card = t.card;
            div()
                .id(("add-provider-step", index))
                .flex_1()
                .min_w_0()
                .flex()
                .items_center()
                .gap(px(FIELD_GAP))
                .px(px(STEP_PADDING_X))
                .py(px(STEP_PADDING_Y))
                .rounded(px(radius::LG))
                .cursor_pointer()
                .on_click(add_click(client, json!({ "kind": "step", "step": index })))
                .map(|this| {
                    if current {
                        this.bg(t.card).shadow(if dark_mode {
                            vec![soft_ring(t)]
                        } else {
                            vec![soft_ring(t), shadow(0., 1., 2., 0., black(0.05))]
                        })
                    } else {
                        this.hover(move |style| style.bg(card))
                    }
                })
                .child(
                    div()
                        .flex_none()
                        .size(px(STEP_NUMBER))
                        .rounded_full()
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(text::SM))
                        .line_height(px(text::SM_LINE))
                        .font_weight(FontWeight::MEDIUM)
                        .map(|this| {
                            if done {
                                this.bg(t.primary)
                                    .shadow(vec![ring(t.primary, 1.)])
                                    .child(icon(
                                        "icons/check.svg",
                                        STEP_CHECK,
                                        t.primary_foreground,
                                    ))
                            } else if current {
                                this.bg(fade(t.primary, 0.1))
                                    .text_color(t.primary)
                                    .shadow(vec![ring(fade(t.primary, 0.3), 1.)])
                                    .child(SharedString::from((index + 1).to_string()))
                            } else {
                                this.bg(if dark_mode { white(0.05) } else { t.card })
                                    .text_color(t.muted_foreground)
                                    .shadow(vec![ring(
                                        if dark_mode { white(0.1) } else { black(0.1) },
                                        1.,
                                    )])
                                    .child(SharedString::from((index + 1).to_string()))
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
                        .text_color(if current {
                            t.foreground
                        } else {
                            t.muted_foreground
                        })
                        .child(step.label.clone()),
                )
        }))
        .into_any_element()
}

fn driver_option(
    option: &DriverOptionView,
    selected: bool,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    let dark_mode = dark(t);
    let badge = option.badge_label.clone().map(|label| {
        Badge::new()
            .variant(BadgeVariant::Warning)
            .size(BadgeSize::Sm)
            .label(label)
    });
    let label = div()
        .min_w_0()
        .flex_1()
        .truncate()
        .text_size(px(text::SM))
        .line_height(px(text::SM_LINE))
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.foreground)
        .child(option.label.clone());
    let base = div()
        .id(SharedString::from(format!(
            "add-provider-driver-{}",
            option.value
        )))
        .relative()
        .flex()
        .items_center()
        .gap(px(OPTION_GAP))
        .p(px(OPTION_PADDING))
        .rounded(px(radius::LG));
    if option.disabled {
        return base
            .opacity(DISABLED_OPACITY)
            .bg(if dark_mode {
                white(0.02)
            } else {
                fade(t.card, 0.6)
            })
            .shadow(vec![soft_ring(t)])
            .child(option_icon(option, t.muted_foreground))
            .child(label)
            .children(badge)
            .into_any_element();
    }
    let hover = if dark_mode { white(0.05) } else { t.accent };
    let selected_bg = fade(t.primary, if dark_mode { 0.15 } else { 0.08 });
    base.cursor_pointer()
        .map(|this| {
            if selected {
                this.bg(selected_bg).shadow(vec![ring(t.primary, 2.)])
            } else {
                this.bg(if dark_mode { white(0.03) } else { t.card })
                    .shadow(vec![soft_ring(t)])
                    .hover(move |style| style.bg(hover))
            }
        })
        .on_click(add_click(
            client,
            json!({ "kind": "driver", "value": option.value }),
        ))
        .child(option_icon(
            option,
            if selected {
                t.foreground
            } else {
                t.muted_foreground
            },
        ))
        .child(label)
        .when(selected, |this| {
            this.child(
                div()
                    .size(px(OPTION_INDICATOR))
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded_full()
                    .bg(t.primary)
                    .child(icon("icons/check.svg", OPTION_CHECK, t.primary_foreground)),
            )
        })
        .children(badge)
        .into_any_element()
}

fn field_label(label: &str, t: &Tokens) -> AnyElement {
    div()
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.foreground)
        .child(label.to_string())
        .into_any_element()
}

fn hint(label: &str, color: Rgba) -> AnyElement {
    div()
        .text_size(px(TEXT_2XS))
        .line_height(px(text::XS_LINE))
        .text_color(color)
        .child(label.to_string())
        .into_any_element()
}

fn text_field(
    section: &mut ProvidersSection,
    key: &str,
    revision: u64,
    field: &WizardTextField,
    kind: &'static str,
    window: &mut Window,
    cx: &mut Context<ProvidersSection>,
) -> AnyElement {
    let t = theme::active(cx);
    let client = section.client.clone();
    let state = section.input(
        InputSpec {
            key: format!("add-provider-{key}:{revision}"),
            value: field.value.clone(),
            placeholder: field.placeholder.clone(),
            masked: false,
            mode: InputMode::Live,
            on_value: Rc::new(move |value, cx| {
                act(
                    &client,
                    cx,
                    ADD_INSTANCE,
                    json!({ "intent": { "kind": kind, "value": value } }),
                )
            }),
            on_enter: None,
            on_blur: None,
        },
        window,
        cx,
    );
    let footnote = match (&field.error, field.invalid) {
        (Some(error), true) => hint(error, t.destructive_foreground),
        _ => hint(&field.hint, t.muted_foreground),
    };
    div()
        .flex()
        .flex_col()
        .gap(px(FIELD_GAP))
        .child(field_label(&field.label, &t))
        .child(Input::new(&state).invalid(field.invalid))
        .child(footnote)
        .into_any_element()
}

fn config_field(
    section: &mut ProvidersSection,
    revision: u64,
    field: &ProviderFormField,
    window: &mut Window,
    cx: &mut Context<ProvidersSection>,
) -> AnyElement {
    let t = theme::active(cx);
    let client = section.client.clone();
    let key = field.key.clone();
    let send = Rc::new(move |kind: &'static str, value: Value, cx: &mut App| {
        act(
            &client,
            cx,
            ADD_INSTANCE,
            json!({ "intent": {
                "kind": "config",
                "key": key,
                "change": { "kind": kind, "value": value },
            } }),
        )
    });
    let description = field.description.as_ref().map(|description| {
        div()
            .text_size(px(TEXT_2XS))
            .line_height(px(CONFIG_LINE_DESCRIPTION))
            .text_color(t.muted_foreground)
            .child(description.clone())
    });
    let inline_label = |label: &str| {
        div()
            .h(px(CONFIG_LINE_LABEL))
            .flex()
            .items_center()
            .child(field_label(label, &t))
    };
    let body = match field.control.as_str() {
        "switch" => {
            let send = send.clone();
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap(px(OPTION_GAP))
                .child(
                    div()
                        .min_w_0()
                        .child(field_label(&field.label, &t))
                        .children(description),
                )
                .child(
                    settings_switch(SharedString::from(field.input_id.clone()), field.checked)
                        .accessibility_label(field.label.clone())
                        .on_change(move |checked, _, _, cx| send("switch", json!(checked), cx)),
                )
                .into_any_element()
        }
        "select" => {
            let send = send.clone();
            div()
                .flex()
                .flex_col()
                .child(inline_label(&field.label))
                .child(
                    SettingsSelect::new(SharedString::from(field.input_id.clone()))
                        .options(field.options.iter().flatten().map(|option| {
                            SettingsSelectOption::new(option.value.clone(), option.label.clone())
                        }))
                        .value(Some(field.text_value.clone()))
                        .value_label(field.selected_label.clone())
                        .width(SettingsControlWidth::Auto)
                        .accessibility_label(field.label.clone())
                        .on_change(move |value, _, cx| {
                            send("select", json!(value.to_string()), cx)
                        }),
                )
                .children(description)
                .into_any_element()
        }
        "textarea" => {
            let send = send.clone();
            let state = section.textarea(
                format!("add-provider-config:{revision}:{}", field.key),
                &field.text_value,
                field.placeholder.as_deref().unwrap_or_default(),
                Rc::new(move |value, cx| send("text", json!(value), cx)),
                window,
                cx,
            );
            div()
                .flex()
                .flex_col()
                .child(inline_label(&field.label))
                .child(Textarea::new(&state).items_start())
                .children(description)
                .into_any_element()
        }
        _ => {
            let send = send.clone();
            let state = section.input(
                InputSpec {
                    key: format!("add-provider-config:{revision}:{}", field.key),
                    value: field.text_value.clone(),
                    placeholder: field.placeholder.clone().unwrap_or_default(),
                    masked: field.sensitive,
                    mode: InputMode::Live,
                    on_value: Rc::new(move |value, cx| send("text", json!(value), cx)),
                    on_enter: None,
                    on_blur: None,
                },
                window,
                cx,
            );
            div()
                .flex()
                .flex_col()
                .child(inline_label(&field.label))
                .child(Input::new(&state))
                .children(description)
                .into_any_element()
        }
    };
    div()
        .flex()
        .flex_col()
        .gap(px(FORM_FIELD_GAP))
        .child(body)
        .into_any_element()
}

pub(super) fn add_instance(
    section: &mut ProvidersSection,
    add: &AddInstanceView,
    environment_id: &str,
    window: &mut Window,
    cx: &mut Context<ProvidersSection>,
) -> AnyElement {
    let t = theme::active(cx);
    let client = section.client.clone();
    let mut fields: Vec<AnyElement> = Vec::new();
    if add.driver_field.visible {
        let selected = add.driver_field.value.clone();
        let options: Vec<AnyElement> = add
            .driver_field
            .options
            .iter()
            .map(|option| driver_option(option, option.value == selected, &client, &t))
            .collect();
        let mut rows: Vec<AnyElement> = Vec::new();
        let mut iter = options.into_iter();
        while let Some(first) = iter.next() {
            let second = iter.next();
            rows.push(
                div()
                    .flex()
                    .gap(px(OPTION_GAP))
                    .child(div().flex_1().min_w_0().child(first))
                    .child(div().flex_1().min_w_0().children(second))
                    .into_any_element(),
            );
        }
        fields.push(
            div()
                .flex()
                .flex_col()
                .gap(px(FIELD_GAP))
                .child(
                    div()
                        .text_size(px(text::SM))
                        .line_height(px(text::SM_LINE))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.foreground)
                        .child(add.driver_field.label.clone()),
                )
                .child(div().flex().flex_col().gap(px(OPTION_GAP)).children(rows))
                .into_any_element(),
        );
    }
    if add.label_field.visible {
        fields.push(text_field(
            section,
            "label",
            add.revision,
            &add.label_field,
            "label",
            window,
            cx,
        ));
    }
    if add.instance_id_field.visible {
        fields.push(text_field(
            section,
            "instance-id",
            add.revision,
            &add.instance_id_field,
            "instance-id",
            window,
            cx,
        ));
    }
    if add.accent_field.visible {
        let trigger = accent::trigger(section, "add".into(), &add.accent_picker, false, cx);
        let swatches = add.accent_field.swatches.iter().map(|swatch| {
            let color = parse_accent(&swatch.value).unwrap_or(t.muted);
            let swatch_client = client.clone();
            let value = swatch.value.clone();
            let foreground = t.foreground;
            let ring_color = t.ring;
            let background = t.background;
            div()
                .id(SharedString::from(format!(
                    "add-provider-swatch-{}",
                    swatch.value
                )))
                .size(px(SWATCH))
                .flex_none()
                .rounded_full()
                .border_1()
                .cursor_pointer()
                .bg(color)
                .map(|this| {
                    if swatch.selected {
                        this.border_color(foreground)
                            .shadow(vec![ring(background, 1.), ring(ring_color, 3.)])
                    } else {
                        this.border_color(if dark(&t) { white(0.2) } else { black(0.1) })
                    }
                })
                .tooltip(crate::ui::tooltip::Tooltip::text(SharedString::from(
                    swatch.label.clone(),
                )))
                .on_click(move |_, _, cx| {
                    act(
                        &swatch_client,
                        cx,
                        "settingsProvidersAccent",
                        json!({ "target": "add", "intent": { "kind": "swatch", "value": value } }),
                    )
                })
        });
        let clear = add.accent_field.clear_label.clone().map(|label| {
            let clear_client = client.clone();
            Button::new("add-provider-accent-clear")
                .size(crate::ui::button::ButtonSize::Xs)
                .variant(ButtonVariant::GhostMuted)
                .label(label)
                .on_click(move |_, _, cx| {
                    act(
                        &clear_client,
                        cx,
                        "settingsProvidersAccent",
                        json!({ "target": "add", "intent": { "kind": "swatch", "value": "" } }),
                    )
                })
        });
        fields.push(
            div()
                .flex()
                .flex_col()
                .gap(px(FIELD_GAP))
                .child(field_label(&add.accent_field.label, &t))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .min_w_0()
                        .items_center()
                        .gap(px(FIELD_GAP))
                        .child(trigger)
                        .child(
                            div()
                                .flex()
                                .flex_wrap()
                                .gap(px(SWATCH_GAP))
                                .children(swatches),
                        )
                        .children(clear),
                )
                .child(hint(&add.accent_field.hint, t.muted_foreground))
                .into_any_element(),
        );
    }
    if add.config.has_fields {
        if add.config.visible {
            let config: Vec<AnyElement> = add
                .config_fields
                .iter()
                .map(|field| config_field(section, add.revision, field, window, cx))
                .collect();
            fields.push(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(PANEL_GAP))
                    .children(config)
                    .into_any_element(),
            );
        }
    } else if let Some(message) = &add.config.empty_message {
        fields.push(
            div()
                .text_size(px(text::SM))
                .line_height(px(text::SM_LINE))
                .text_color(t.muted_foreground)
                .child(message.clone())
                .into_any_element(),
        );
    }
    let back = &add.footer.back;
    let footer = DialogFooter::new()
        .variant(DialogFooterVariant::Bare)
        .child(
            Button::new("add-provider-back")
                .variant(if back.kind == "cancel" {
                    ButtonVariant::GhostMuted
                } else {
                    ButtonVariant::Outline
                })
                .label(back.label.clone())
                .on_click(add_click(&client, json!({ "kind": "back" }))),
        );
    let footer = match &add.footer.primary {
        WizardPrimary::CodexChoice {
            manual_label,
            chat_gpt_label,
        } => {
            let chatgpt_client = client.clone();
            let environment_id = environment_id.to_string();
            footer
                .child(
                    Button::new("add-provider-manual")
                        .variant(ButtonVariant::Outline)
                        .label(manual_label.clone())
                        .on_click(add_click(&client, json!({ "kind": "manual" }))),
                )
                .child(
                    Button::new("add-provider-chatgpt")
                        .icon("providers/openai")
                        .label(chat_gpt_label.clone())
                        .on_click(move |_, _, cx| {
                            act(
                                &chatgpt_client,
                                cx,
                                ADD_INSTANCE,
                                json!({ "intent": { "kind": "chatgpt" } }),
                            );
                            act(
                                &chatgpt_client,
                                cx,
                                "codexSetupAddAccountOpen",
                                json!({ "environmentId": environment_id, "mode": "settings" }),
                            );
                        }),
                )
        }
        WizardPrimary::Next { label } => footer.child(
            Button::new("add-provider-next")
                .label(label.clone())
                .on_click(add_click(&client, json!({ "kind": "next" }))),
        ),
        WizardPrimary::Submit { label } => footer.child(
            Button::new("add-provider-submit")
                .label(label.clone())
                .on_click(add_click(&client, json!({ "kind": "submit" }))),
        ),
    };
    let close_client = client.clone();
    DialogPopup::new("add-provider-instance")
        .max_width(WIZARD_WIDTH)
        .on_close(move |_, cx| {
            act(
                &close_client,
                cx,
                ADD_INSTANCE,
                json!({ "intent": { "kind": "close" } }),
            )
        })
        .child(
            DialogHeader::new()
                .child(DialogTitle::new(add.title.clone()))
                .child(DialogDescription::new(add.description.clone()))
                .child(steps(add, &client, &t)),
        )
        .child(
            div()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(PANEL_FIELD_GAP))
                .px(px(PANEL_PADDING_X))
                .py(px(PANEL_PADDING_Y))
                .bg(if dark(&t) {
                    white(0.02)
                } else {
                    fade(zinc_25(), 0.8)
                })
                .shadow(vec![soft_ring(&t)])
                .children(fields),
        )
        .child(footer)
        .into_any_element()
}

pub(super) fn add_hub(
    section: &mut ProvidersSection,
    dialog: &AddHubDialog,
    window: &mut Window,
    cx: &mut Context<ProvidersSection>,
) -> AnyElement {
    let t = theme::active(cx);
    let client = section.client.clone();
    let fields: Vec<AnyElement> = dialog
        .fields
        .iter()
        .map(|field| {
            let value_client = client.clone();
            let enter_client = client.clone();
            let key = field.key.clone();
            let state = section.input(
                InputSpec {
                    key: format!("usage-hub-{}:{}", dialog.revision, field.key),
                    value: field.value.clone(),
                    placeholder: field.placeholder.clone().unwrap_or_default(),
                    masked: field.input_type.as_deref() == Some("password"),
                    mode: InputMode::Live,
                    on_value: Rc::new(move |value, cx| {
                        act(
                            &value_client,
                            cx,
                            USAGE,
                            json!({ "intent": { "kind": "add-field", "key": key, "value": value } }),
                        )
                    }),
                    on_enter: Some(Rc::new(move |cx| {
                        act(&enter_client, cx, USAGE, json!({ "intent": { "kind": "save-add" } }))
                    })),
                    on_blur: None,
                },
                window,
                cx,
            );
            if field.auto_focus {
                section.focus_input_once(
                    format!("usage-hub-focus:{}", dialog.revision),
                    &state,
                    window,
                    cx,
                );
            }
            div()
                .flex()
                .flex_col()
                .gap(px(FORM_FIELD_GAP))
                .child(
                    div()
                        .text_size(px(text::SM))
                        .line_height(px(text::SM_LINE))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.foreground)
                        .child(field.label.clone()),
                )
                .child(Input::new(&state))
                .into_any_element()
        })
        .collect();
    let close = client.clone();
    let cancel = client.clone();
    let save = client.clone();
    DialogPopup::new("usage-add-hub")
        .max_width(HUB_WIDTH)
        .on_close(move |_, cx| {
            act(
                &close,
                cx,
                USAGE,
                json!({ "intent": { "kind": "close-add" } }),
            )
        })
        .child(
            DialogHeader::new()
                .child(DialogTitle::new(dialog.title.clone()))
                .child(DialogDescription::new(dialog.description.clone())),
        )
        .child(
            DialogPanel::new("usage-add-hub-panel")
                .after_header(true)
                .before_bare_footer(true)
                .child(div().flex().flex_col().gap(px(PANEL_GAP)).children(fields)),
        )
        .child(
            DialogFooter::new()
                .variant(DialogFooterVariant::Bare)
                .child(
                    Button::new("usage-add-hub-cancel")
                        .variant(ButtonVariant::Outline)
                        .label(dialog.cancel_label.clone())
                        .on_click(move |_, _, cx| {
                            act(
                                &cancel,
                                cx,
                                USAGE,
                                json!({ "intent": { "kind": "close-add" } }),
                            )
                        }),
                )
                .child(
                    Button::new("usage-add-hub-save")
                        .label(dialog.save_label.clone())
                        .disabled(!dialog.can_save)
                        .on_click(move |_, _, cx| {
                            act(
                                &save,
                                cx,
                                USAGE,
                                json!({ "intent": { "kind": "save-add" } }),
                            )
                        }),
                ),
        )
        .into_any_element()
}

pub(super) fn remove_hub(hub: &UsageHubRow, client: &Entity<CoreClient>) -> AnyElement {
    let confirmation = &hub.remove_confirmation;
    let dismiss = client.clone();
    let cancel = client.clone();
    let confirm = client.clone();
    AlertDialogPopup::new("usage-remove-hub")
        .on_dismiss(move |_, cx| {
            act(
                &dismiss,
                cx,
                USAGE,
                json!({ "intent": { "kind": "cancel-remove" } }),
            )
        })
        .child(
            AlertDialogHeader::new()
                .child(AlertDialogTitle::new(confirmation.title.clone()))
                .child(AlertDialogDescription::new(
                    confirmation.description.clone(),
                )),
        )
        .child(
            AlertDialogFooter::new()
                .child(
                    Button::new("usage-remove-hub-cancel")
                        .variant(ButtonVariant::Outline)
                        .label(confirmation.cancel_label.clone())
                        .on_click(move |_, _, cx| {
                            act(
                                &cancel,
                                cx,
                                USAGE,
                                json!({ "intent": { "kind": "cancel-remove" } }),
                            )
                        }),
                )
                .child(
                    Button::new("usage-remove-hub-confirm")
                        .variant(ButtonVariant::Destructive)
                        .label(confirmation.confirm_label.clone())
                        .on_click(move |_, _, cx| {
                            act(
                                &confirm,
                                cx,
                                USAGE,
                                json!({ "intent": { "kind": "confirm-remove" } }),
                            )
                        }),
                ),
        )
        .into_any_element()
}
