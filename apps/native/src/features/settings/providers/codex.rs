use gpui::component::input::InputState;
use gpui::prelude::FluentBuilder;
use gpui::{AnyElement, Entity, IntoElement, ParentElement, SharedString, Styled, div, px};
use serde_json::{Value, json};

use crate::app_core::client::CoreClient;
use crate::app_core::views::codex_setup::{
    CodexButton, CodexFooter, CodexSettingsControls, CodexSettingsSection,
};
use crate::features::onboarding::act;
use crate::features::onboarding::codex_setup::{
    callback_completion, chatgpt_button, description, help_toggle, send_intent,
};
use crate::features::settings::primitives::SettingsRow;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::theme::metrics::text;
use crate::ui::theme::tokens::{Tokens, fade};

const CONTROL_GAP: f32 = 8.;
const ROW_INSET_X: f32 = 16.;
const USAGE_PADDING_Y: f32 = 4.;
const ALERT_PADDING_Y: f32 = 8.;
const FALLBACK_PADDING_Y: f32 = 12.;
const FALLBACK_GAP: f32 = 12.;
const EXTERNAL_ICON: f32 = 14.;
const DESCRIPTION_LINE: f32 = 18.;

fn intent_button(
    key: &str,
    id: &str,
    button: &CodexButton,
    variant: ButtonVariant,
    client: &Entity<CoreClient>,
) -> Button {
    let client = client.clone();
    let key_owned = key.to_string();
    let intent = button.intent.clone();
    Button::new(SharedString::from(format!("codex-settings-{id}-{key}")))
        .size(ButtonSize::Sm)
        .variant(variant)
        .label(button.label.clone())
        .disabled(button.disabled)
        .on_click(move |_, _, cx| {
            if let Some(intent) = &intent {
                send_intent(&client, &key_owned, intent, cx)
            }
        })
}

fn connect_button(key: &str, button: &CodexButton, client: &Entity<CoreClient>) -> Button {
    let client = client.clone();
    let key_owned = key.to_string();
    let intent: Option<Value> = button.intent.clone();
    chatgpt_button(
        SharedString::from(format!("codex-settings-connect-{key}")),
        &button.label,
        button.disabled,
        move |cx| {
            if let Some(intent) = &intent {
                send_intent(&client, &key_owned, intent, cx)
            }
        },
    )
}

fn controls(
    key: &str,
    controls: &CodexSettingsControls,
    client: &Entity<CoreClient>,
) -> AnyElement {
    let row = div()
        .flex()
        .flex_wrap()
        .items_center()
        .justify_end()
        .gap(px(CONTROL_GAP));
    match controls {
        CodexSettingsControls::AuthActive { waiting, cancel } => {
            let client_waiting = client.clone();
            let key_owned = key.to_string();
            let intent = waiting.intent.clone();
            row.child(
                Button::new(SharedString::from(format!("codex-settings-waiting-{key}")))
                    .size(ButtonSize::Sm)
                    .variant(if waiting.emphasized {
                        ButtonVariant::Default
                    } else {
                        ButtonVariant::Outline
                    })
                    .label(waiting.label.clone())
                    .disabled(waiting.disabled)
                    .on_click(move |_, _, cx| {
                        if let Some(intent) = &intent {
                            send_intent(&client_waiting, &key_owned, intent, cx)
                        }
                    }),
            )
            .children(
                cancel.as_ref().map(|cancel| {
                    intent_button(key, "cancel", cancel, ButtonVariant::Ghost, client)
                }),
            )
            .into_any_element()
        }
        CodexSettingsControls::InstallActive { cancel } => row
            .child(intent_button(
                key,
                "cancel-install",
                cancel,
                ButtonVariant::Ghost,
                client,
            ))
            .into_any_element(),
        CodexSettingsControls::Authenticated {
            change_account,
            disconnect,
        } => row
            .child(intent_button(
                key,
                "change-account",
                change_account,
                ButtonVariant::Outline,
                client,
            ))
            .child(intent_button(
                key,
                "disconnect",
                disconnect,
                ButtonVariant::Ghost,
                client,
            ))
            .into_any_element(),
        CodexSettingsControls::Connect {
            connect,
            different_account,
        } => row
            .child(connect_button(key, connect, client))
            .children(different_account.as_ref().map(|button| {
                intent_button(
                    key,
                    "different-account",
                    button,
                    ButtonVariant::Ghost,
                    client,
                )
            }))
            .into_any_element(),
    }
}

fn fallback(
    key: &str,
    footer: &CodexFooter,
    input: Option<&Entity<InputState>>,
    handoff_open: bool,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    match footer {
        CodexFooter::Completion { callback, .. } => {
            callback_completion(key, callback, input, handoff_open, client, t)
        }
        CodexFooter::Help {
            label,
            toggle,
            content,
        } => div()
            .flex()
            .flex_col()
            .gap(px(FALLBACK_GAP))
            .text_size(px(text::XS))
            .line_height(px(text::XS * text::LEADING_RELAXED))
            .text_color(t.muted_foreground)
            .child(help_toggle(
                SharedString::from(format!("codex-settings-help-{key}")),
                label,
                toggle.as_ref(),
                key,
                client,
                t,
            ))
            .when_some(content.as_ref(), |this, callback| {
                this.child(
                    div()
                        .w_full()
                        .pt(px(FALLBACK_GAP))
                        .border_t_1()
                        .border_color(fade(t.border, 0.5))
                        .child(callback_completion(
                            key,
                            callback,
                            input,
                            handoff_open,
                            client,
                            t,
                        )),
                )
            })
            .into_any_element(),
    }
}

fn divided(children: Vec<AnyElement>, t: &Tokens) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .children(children.into_iter().enumerate().map(|(index, child)| {
            div()
                .when(index > 0, |this| {
                    this.border_t_1().border_color(fade(t.border, 0.5))
                })
                .child(child)
        }))
        .into_any_element()
}

pub(crate) fn codex_settings_section(
    section: &CodexSettingsSection,
    input: Option<&Entity<InputState>>,
    handoff_open: bool,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    match section {
        CodexSettingsSection::Preparing {
            key,
            title,
            description,
        } => SettingsRow::new(format!("codex-settings-{key}"), title.clone())
            .description(description.clone())
            .into_any_element(),
        CodexSettingsSection::Managed {
            key,
            title,
            description: account,
            controls: buttons,
            usage_label,
            logout_warning,
            fallback: footer,
            error,
        } => {
            let mut children = vec![
                SettingsRow::new(format!("codex-settings-{key}"), title.clone())
                    .description_element(
                        div()
                            .text_size(px(text::XS))
                            .line_height(px(DESCRIPTION_LINE))
                            .text_color(fade(t.muted_foreground, 0.8))
                            .child(description(key, account, client, t)),
                    )
                    .control(controls(key, buttons, client))
                    .into_any_element(),
            ];
            if let Some(label) = usage_label {
                let usage_client = client.clone();
                children.push(
                    div()
                        .flex()
                        .justify_end()
                        .px(px(ROW_INSET_X))
                        .py(px(USAGE_PADDING_Y))
                        .child(
                            Button::new(SharedString::from(format!("codex-settings-usage-{key}")))
                                .size(ButtonSize::Sm)
                                .variant(ButtonVariant::GhostMuted)
                                .label(label.clone())
                                .icon_end("external-link")
                                .icon_size(EXTERNAL_ICON)
                                .on_click(move |_, _, cx| {
                                    act(&usage_client, cx, "codexSetupWelcomeOpenUsage", json!({}))
                                }),
                        )
                        .into_any_element(),
                );
            }
            if let Some(warning) = logout_warning {
                children.push(
                    div()
                        .px(px(ROW_INSET_X))
                        .py(px(ALERT_PADDING_Y))
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .text_color(t.muted_foreground)
                        .child(warning.clone())
                        .into_any_element(),
                );
            }
            if let Some(footer) = footer {
                children.push(
                    div()
                        .px(px(ROW_INSET_X))
                        .py(px(FALLBACK_PADDING_Y))
                        .child(fallback(key, footer, input, handoff_open, client, t))
                        .into_any_element(),
                );
            }
            if let Some(error) = error {
                children.push(
                    div()
                        .px(px(ROW_INSET_X))
                        .py(px(ALERT_PADDING_Y))
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .text_color(t.destructive_foreground)
                        .child(error.clone())
                        .into_any_element(),
                );
            }
            divided(children, t)
        }
    }
}
