use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Context, Entity, InteractiveElement, IntoElement, ParentElement, SharedString,
    StatefulInteractiveElement, Styled, Window, div, px, relative,
};
use serde_json::{Value, json};

use super::{InputMode, InputSpec, ProvidersSection, act, muted};
use crate::app_core::client::CoreClient;
use crate::app_core::views::settings_providers::{
    SetupActionsModel, SetupButton, SetupCallback, SetupSectionBody, SetupSectionModel,
};
use crate::features::settings::primitives::SettingsRow;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::input::{Input, InputSize};
use crate::ui::theme;
use crate::ui::theme::metrics::text;
use crate::ui::theme::tokens::Tokens;
use crate::ui::tooltip::Tooltip;

const SETUP_ACTION: &str = "settingsProvidersSetup";
const CONTROL_WIDTH: f32 = 224.;
const AUTH_MAX_WIDTH: f32 = 224.;
const GAP: f32 = 8.;
const PROGRESS_HEIGHT: f32 = 4.;
const ICON_COLUMN: f32 = 28.;
const TRASH_ICON: f32 = 14.;
const ALERT_PADDING_X: f32 = 16.;
const ALERT_PADDING_Y: f32 = 12.;

fn send(client: &Entity<CoreClient>, instance_id: &str, intent: Value, cx: &mut App) {
    act(
        client,
        cx,
        SETUP_ACTION,
        json!({ "instanceId": instance_id, "intent": intent }),
    );
}

fn intent_button(
    id: String,
    button: &SetupButton,
    kind: &str,
    variant: ButtonVariant,
    instance_id: &str,
    client: &Entity<CoreClient>,
) -> Button {
    let client = client.clone();
    let instance_id = instance_id.to_string();
    let kind = kind.to_string();
    Button::new(SharedString::from(id))
        .size(ButtonSize::Sm)
        .variant(variant)
        .label(button.label.clone())
        .disabled(button.disabled)
        .on_click(move |_, _, cx| send(&client, &instance_id, json!({ "kind": kind }), cx))
}

fn variant_of(name: Option<&str>) -> ButtonVariant {
    match name {
        Some("ghost") => ButtonVariant::Ghost,
        _ => ButtonVariant::Outline,
    }
}

fn text_block(label: impl Into<SharedString>, t: &Tokens) -> gpui::Div {
    muted(label, t).whitespace_normal()
}

fn runtime_row(
    instance_id: &str,
    actions: &SetupActionsModel,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    let runtime = &actions.runtime;
    let progress = runtime.progress.as_ref().map(|progress| {
        let ratio = if progress.max > 0. {
            (progress.value / progress.max).clamp(0., 1.)
        } else {
            0.
        };
        div()
            .w_full()
            .h(px(PROGRESS_HEIGHT))
            .rounded_full()
            .bg(t.muted)
            .overflow_hidden()
            .child(div().h_full().w(relative(ratio as f32)).bg(t.foreground))
    });
    let primary = runtime.primary_control.as_ref().map(|control| {
        intent_button(
            format!("setup-runtime-{instance_id}"),
            control,
            control.kind.as_deref().unwrap_or("start-install"),
            ButtonVariant::Outline,
            instance_id,
            client,
        )
        .w_full()
    });
    let remove = runtime.remove.as_ref().map(|remove| {
        let client = client.clone();
        let instance = instance_id.to_string();
        div()
            .id(SharedString::from(format!(
                "setup-remove-tip-{instance_id}"
            )))
            .flex_none()
            .tooltip(Tooltip::text(SharedString::from(remove.label.clone())))
            .child(
                Button::new(SharedString::from(format!("setup-remove-{instance_id}")))
                    .size(ButtonSize::IconSm)
                    .variant(ButtonVariant::Ghost)
                    .icon("settings/trash-2")
                    .icon_size(TRASH_ICON)
                    .accessibility_label(remove.label.clone())
                    .disabled(remove.disabled)
                    .on_click(move |_, _, cx| {
                        send(&client, &instance, json!({ "kind": "remove-runtime" }), cx)
                    }),
            )
    });
    let control = div()
        .flex()
        .flex_col()
        .w(px(CONTROL_WIDTH))
        .max_w_full()
        .min_w_0()
        .gap(px(GAP))
        .items_end()
        .child(
            div()
                .min_h(px(text::XS_LINE))
                .text_right()
                .child(text_block(runtime.status_message.clone(), t)),
        )
        .child(div().w_full().h(px(PROGRESS_HEIGHT)).children(progress))
        .children(
            runtime
                .detail_message
                .clone()
                .map(|detail| div().text_right().child(text_block(detail, t))),
        )
        .child(
            div()
                .w_full()
                .min_h(px(28.))
                .flex()
                .gap(px(GAP))
                .child(div().w(px(ICON_COLUMN)).flex_none().children(remove))
                .child(div().flex_1().min_w_0().children(primary)),
        );
    let notices = (!runtime.notices.is_empty()).then(|| {
        div().flex().flex_col().gap(px(GAP)).children(
            runtime
                .notices
                .iter()
                .map(|notice| text_block(notice.clone(), t)),
        )
    });
    SettingsRow::new(
        format!("setup-runtime-row-{instance_id}"),
        runtime.title.clone(),
    )
    .description(runtime.description.clone())
    .when_some(notices, |row, notices| row.status(notices))
    .control(control)
    .into_any_element()
}

fn auth_row(
    section: &mut ProvidersSection,
    instance_id: &str,
    actions: &SetupActionsModel,
    callback_revision: u64,
    window: &mut Window,
    cx: &mut Context<ProvidersSection>,
) -> AnyElement {
    let t = theme::active(cx);
    let client = section.client.clone();
    let auth = &actions.auth;
    let links = auth.sign_in_links.as_ref().map(|links| {
        let open_client = client.clone();
        let open_instance = instance_id.to_string();
        let copy_client = client.clone();
        let copy_instance = instance_id.to_string();
        div()
            .flex()
            .flex_wrap()
            .justify_end()
            .gap(px(GAP))
            .child(
                Button::new(SharedString::from(format!(
                    "setup-open-sign-in-{instance_id}"
                )))
                .size(ButtonSize::Sm)
                .variant(ButtonVariant::Outline)
                .label(links.open_label.clone())
                .on_click(move |_, _, cx| {
                    send(
                        &open_client,
                        &open_instance,
                        json!({ "kind": "open-sign-in-page" }),
                        cx,
                    )
                }),
            )
            .child(
                Button::new(SharedString::from(format!(
                    "setup-copy-sign-in-{instance_id}"
                )))
                .size(ButtonSize::Sm)
                .variant(ButtonVariant::Ghost)
                .label(links.copy_label.clone())
                .on_click(move |_, _, cx| {
                    send(
                        &copy_client,
                        &copy_instance,
                        json!({ "kind": "copy-sign-in-link" }),
                        cx,
                    )
                }),
            )
    });
    let primary = auth.primary_control.as_ref().map(|control| {
        let kind = control.kind.as_deref().unwrap_or("start-sign-in");
        intent_button(
            format!("setup-auth-{instance_id}"),
            control,
            kind,
            if kind == "cancel-sign-in" {
                ButtonVariant::Ghost
            } else {
                ButtonVariant::Outline
            },
            instance_id,
            &client,
        )
    });
    let sign_out = auth.sign_out.as_ref().map(|sign_out| {
        intent_button(
            format!("setup-sign-out-{instance_id}"),
            sign_out,
            "sign-out",
            variant_of(sign_out.variant.as_deref()),
            instance_id,
            &client,
        )
    });
    let control = div()
        .flex()
        .flex_col()
        .min_w_0()
        .max_w(px(AUTH_MAX_WIDTH))
        .gap(px(GAP))
        .items_end()
        .when(!auth.status_visually_hidden, |this| {
            this.child(
                div()
                    .text_right()
                    .child(text_block(auth.status_message.clone(), &t)),
            )
        })
        .children(links)
        .child(
            div()
                .flex()
                .flex_wrap()
                .justify_end()
                .gap(px(GAP))
                .children(primary)
                .children(sign_out),
        );
    let callback = auth.callback.as_ref().map(|callback| match callback {
        SetupCallback::Form {
            expiry,
            prompt,
            placeholder,
            value,
            disabled,
            submit,
        } => {
            let input_client = client.clone();
            let input_instance = instance_id.to_string();
            let enter_client = client.clone();
            let enter_instance = instance_id.to_string();
            let state = section.input(
                InputSpec {
                    key: format!("setup-callback:{instance_id}:{callback_revision}"),
                    value: value.clone(),
                    placeholder: placeholder.clone(),
                    masked: false,
                    mode: InputMode::Live,
                    on_value: Rc::new(move |value, cx| {
                        send(
                            &input_client,
                            &input_instance,
                            json!({ "kind": "callback-input", "value": value }),
                            cx,
                        )
                    }),
                    on_enter: Some(Rc::new(move |cx| {
                        send(
                            &enter_client,
                            &enter_instance,
                            json!({ "kind": "submit-callback" }),
                            cx,
                        )
                    })),
                    on_blur: None,
                },
                window,
                cx,
            );
            div()
                .flex()
                .flex_col()
                .gap(px(GAP))
                .pb(px(GAP))
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .children(expiry.as_ref().map(|expiry| {
                    text_block(format!("{} {}.", expiry.prefix, expiry.time_label), &t)
                }))
                .child(div().text_color(t.foreground).child(prompt.clone()))
                .child(Input::new(&state).size(InputSize::Sm).disabled(*disabled))
                .child(div().flex().child(intent_button(
                    format!("setup-callback-submit-{instance_id}"),
                    submit,
                    "submit-callback",
                    ButtonVariant::Outline,
                    instance_id,
                    &client,
                )))
                .into_any_element()
        }
        SetupCallback::OtherClient { message } => div()
            .pb(px(GAP))
            .child(text_block(message.clone(), &t))
            .into_any_element(),
    });
    SettingsRow::new(format!("setup-auth-row-{instance_id}"), auth.title.clone())
        .description(auth.description.clone())
        .control(control)
        .children(callback)
        .into_any_element()
}

pub(super) fn antigravity(
    section: &mut ProvidersSection,
    instance_id: &str,
    model: &SetupSectionModel,
    actions: Option<&SetupActionsModel>,
    callback_revision: u64,
    window: &mut Window,
    cx: &mut Context<ProvidersSection>,
) -> Vec<AnyElement> {
    let t = theme::active(cx);
    let client = section.client.clone();
    let environment = &model.environment;
    let enable = environment.enable_label.clone().map(|label| {
        let client = client.clone();
        let instance = instance_id.to_string();
        Button::new(SharedString::from(format!("setup-enable-{instance_id}")))
            .size(ButtonSize::Sm)
            .variant(ButtonVariant::Outline)
            .label(label)
            .on_click(move |_, _, cx| send(&client, &instance, json!({ "kind": "enable" }), cx))
    });
    let mut rows = vec![
        SettingsRow::new(
            format!("setup-environment-{instance_id}"),
            environment.title.clone(),
        )
        .description(environment.description.clone())
        .control(
            div()
                .flex()
                .flex_col()
                .min_w_0()
                .items_end()
                .gap(px(GAP))
                .child(text_block(environment.value.clone(), &t))
                .children(enable),
        )
        .into_any_element(),
    ];
    match &model.body {
        SetupSectionBody::Notice { title, description } => rows.push(
            SettingsRow::new(format!("setup-notice-{instance_id}"), title.clone())
                .description(description.clone())
                .into_any_element(),
        ),
        SetupSectionBody::Actions => {
            if let Some(actions) = actions {
                rows.push(runtime_row(instance_id, actions, &client, &t));
                rows.push(auth_row(
                    section,
                    instance_id,
                    actions,
                    callback_revision,
                    window,
                    cx,
                ));
                if let Some(alert) = &actions.alert {
                    let retry_client = client.clone();
                    let retry_instance = instance_id.to_string();
                    rows.push(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(GAP))
                            .px(px(ALERT_PADDING_X))
                            .py(px(ALERT_PADDING_Y))
                            .text_size(px(text::XS))
                            .line_height(px(text::XS_LINE))
                            .child(
                                div()
                                    .whitespace_normal()
                                    .text_color(t.destructive_foreground)
                                    .child(alert.message.clone()),
                            )
                            .children(alert.retry_label.clone().map(|label| {
                                div().flex().child(
                                    Button::new(SharedString::from(format!(
                                        "setup-retry-{instance_id}"
                                    )))
                                    .size(ButtonSize::Sm)
                                    .variant(ButtonVariant::Outline)
                                    .label(label)
                                    .on_click(
                                        move |_, _, cx| {
                                            send(
                                                &retry_client,
                                                &retry_instance,
                                                json!({ "kind": "retry-status" }),
                                                cx,
                                            )
                                        },
                                    ),
                                )
                            }))
                            .into_any_element(),
                    );
                }
            }
        }
    }
    rows
}
