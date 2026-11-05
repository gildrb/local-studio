use std::collections::{HashMap, HashSet};

use gpui::component::input::{InputEvent, InputState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, Context, Entity, FontWeight, Global, InteractiveElement,
    IntoElement, ParentElement, Render, Rgba, SharedString, StatefulInteractiveElement, Styled,
    Window, div, px, svg,
};
use serde_json::{Value, json};

use super::act;
use super::parts::{icon, soft_ring, surface_card};
use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::codex_setup::{
    CodexAccountPicker, CodexAddAccount, CodexButton, CodexCallback, CodexCard, CodexCards,
    CodexControl, CodexDescription, CodexDialogs, CodexFooter, CodexHelpToggle,
    CodexSettingsSection, CodexSettingsSections, CodexWelcome,
};
use crate::features::settings::primitives::SettingsRow;
use crate::features::settings::providers::codex::codex_settings_section;
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::dialog::{
    DialogDescription, DialogFooter, DialogFooterVariant, DialogHeader, DialogPopup, DialogTitle,
};
use crate::ui::input::Input;
use crate::ui::popover::{dark, white};
use crate::ui::radio_group::{Radio, RadioGroup};
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::fade;
use crate::ui::theme::{self, Tokens};
use crate::ui::tooltip::Tooltip;

const CARD_PADDING: f32 = 16.;
const CARD_GAP: f32 = 12.;
const CODEX_ICON: f32 = 20.;
const CONTROL_GAP: f32 = 8.;
const CONNECT_MIN_WIDTH: f32 = 176.;
const STATUS_ICON: f32 = 14.;
const STATUS_GAP: f32 = 6.;
const FOOTER_INSET: f32 = 32.;
const FOOTER_MARGIN: f32 = 8.;
const CALLBACK_GAP: f32 = 12.;
const FORM_GAP: f32 = 8.;
const HELP_CHEVRON: f32 = 12.;
const HELP_GAP: f32 = 6.;
const EMAIL_TEXT: f32 = 11.;
const BLUR_LAYERS: [(f32, f32); 6] = [
    (-2., 0.),
    (2., 0.),
    (0., -1.5),
    (0., 1.5),
    (-1., 1.),
    (1., -1.),
];
const BLUR_ALPHA: f32 = 0.22;
const WIZARD_MAX_WIDTH: f32 = 768.;
const WIZARD_PANEL_PADDING_X: f32 = 24.;
const WIZARD_PANEL_PADDING_Y: f32 = 20.;
const ADD_INPUT_WIDTH: f32 = 320.;
const PICKER_PADDING: f32 = 24.;
const PICKER_ROW_GAP: f32 = 12.;
const PICKER_ROW_PADDING: f32 = 12.;
const WELCOME_ICON: f32 = 32.;
const WELCOME_ICON_GAP: f32 = 8.;
const EXTERNAL_ICON: f32 = 14.;

struct CodexSetupHostHandle(Entity<CodexSetupHost>);

impl Global for CodexSetupHostHandle {}

pub struct CodexSetupHost {
    client: Entity<CoreClient>,
    cards: Entity<ViewState<CodexCards>>,
    settings: Entity<ViewState<CodexSettingsSections>>,
    dialogs: Entity<ViewState<CodexDialogs>>,
    handoff_open: HashSet<String>,
    callback_inputs: HashMap<String, Entity<InputState>>,
    callback_flows: HashMap<String, (String, String)>,
    add_account_input: Option<Entity<InputState>>,
    add_account_revision: Option<u64>,
}

pub(crate) fn send_intent(client: &Entity<CoreClient>, key: &str, intent: &Value, cx: &mut App) {
    act(
        client,
        cx,
        "codexSetupCardAct",
        json!({ "key": key, "intent": intent }),
    );
}

fn ready_status(label: &str, t: &Tokens) -> AnyElement {
    div()
        .flex()
        .items_center()
        .gap(px(STATUS_GAP))
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.success_foreground)
        .child(icon("icons/check.svg", STATUS_ICON, t.success_foreground))
        .child(label.to_string())
        .into_any_element()
}

fn muted_status(label: &str, t: &Tokens) -> AnyElement {
    div()
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .text_color(t.muted_foreground)
        .child(label.to_string())
        .into_any_element()
}

pub(crate) fn blurred(label: &str, color: Rgba) -> AnyElement {
    let label = SharedString::from(label.to_string());
    div()
        .relative()
        .child(
            div()
                .text_color(gpui::transparent_black())
                .child(label.clone()),
        )
        .children(BLUR_LAYERS.iter().map(|(x, y)| {
            div()
                .absolute()
                .top(px(*y))
                .left(px(*x))
                .whitespace_nowrap()
                .text_color(fade(color, BLUR_ALPHA))
                .child(label.clone())
        }))
        .into_any_element()
}

pub(crate) fn help_toggle(
    id: SharedString,
    label: &str,
    toggle: Option<&CodexHelpToggle>,
    key: &str,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    let Some(toggle) = toggle else {
        return div().child(label.to_string()).into_any_element();
    };
    let client = client.clone();
    let key = key.to_string();
    let muted = t.muted_foreground;
    div()
        .id(id)
        .flex()
        .items_center()
        .gap(px(HELP_GAP))
        .cursor_pointer()
        .tooltip(Tooltip::text(toggle.aria_label.clone()))
        .on_click(move |_, _, cx| {
            send_intent(
                &client,
                &key,
                &json!({ "kind": "toggle-callback-help" }),
                cx,
            )
        })
        .child(label.to_string())
        .child(icon(
            if toggle.expanded {
                "icons/chevron-down.svg"
            } else {
                "icons/chevron-right.svg"
            },
            HELP_CHEVRON,
            muted,
        ))
        .into_any_element()
}

pub(crate) fn description(
    key: &str,
    description: &CodexDescription,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    match description {
        CodexDescription::Text { text } => div().child(text.clone()).into_any_element(),
        CodexDescription::SignedIn {
            prefix,
            suffix,
            email,
        } => {
            let email = email.as_ref().map(|email| {
                let client = client.clone();
                let key = key.to_string();
                let foreground = t.foreground;
                div()
                    .id(SharedString::from(format!("codex-email-{key}")))
                    .min_w_0()
                    .cursor_pointer()
                    .rounded(px(radius::SM))
                    .font_family(MONO_FONT)
                    .text_size(px(EMAIL_TEXT))
                    .text_color(t.muted_foreground)
                    .hover(move |style| style.text_color(foreground))
                    .tooltip(Tooltip::text(email.tooltip.clone()))
                    .on_click(move |_, _, cx| {
                        send_intent(&client, &key, &json!({ "kind": "toggle-email" }), cx)
                    })
                    .child(if email.revealed {
                        div().child(email.text.clone()).into_any_element()
                    } else {
                        blurred(&email.text, t.muted_foreground)
                    })
            });
            div()
                .flex()
                .flex_wrap()
                .items_baseline()
                .child(format!("{prefix}\u{a0}"))
                .children(email)
                .child(suffix.clone())
                .into_any_element()
        }
        CodexDescription::SignInHelp { label, toggle } => help_toggle(
            SharedString::from(format!("codex-help-{key}")),
            label,
            toggle.as_ref(),
            key,
            client,
            t,
        ),
    }
}

pub(crate) fn chatgpt_button(
    id: SharedString,
    label: &str,
    disabled: bool,
    on_click: impl Fn(&mut App) + 'static,
) -> Button {
    Button::new(id)
        .size(ButtonSize::Sm)
        .icon("providers/openai")
        .label(label.to_string())
        .disabled(disabled)
        .on_click(move |_, _, cx| on_click(cx))
}

fn control(card: &CodexCard, client: &Entity<CoreClient>, t: &Tokens) -> AnyElement {
    let key = card.key.clone();
    match &card.control {
        CodexControl::Ready { label } => ready_status(label, t),
        CodexControl::Status { label } => muted_status(label, t),
        CodexControl::Connect {
            label,
            disabled,
            intent,
        } => {
            let client = client.clone();
            let intent = intent.clone();
            chatgpt_button(
                SharedString::from(format!("codex-connect-{key}")),
                label,
                *disabled,
                move |cx| {
                    if let Some(intent) = &intent {
                        send_intent(&client, &key, intent, cx)
                    }
                },
            )
            .into_any_element()
        }
        CodexControl::Button {
            label,
            disabled,
            emphasized,
            intent,
        } => {
            let client = client.clone();
            let intent = intent.clone();
            div()
                .min_w(px(CONNECT_MIN_WIDTH))
                .flex()
                .child(
                    Button::new(SharedString::from(format!("codex-control-{key}")))
                        .size(ButtonSize::Sm)
                        .variant(if *emphasized {
                            ButtonVariant::Default
                        } else {
                            ButtonVariant::Outline
                        })
                        .label(label.clone())
                        .disabled(*disabled)
                        .on_click(move |_, _, cx| {
                            if let Some(intent) = &intent {
                                send_intent(&client, &key, intent, cx)
                            }
                        }),
                )
                .into_any_element()
        }
    }
}

fn secondary(card: &CodexCard, button: &CodexButton, client: &Entity<CoreClient>) -> AnyElement {
    let client = client.clone();
    let key = card.key.clone();
    let intent = button.intent.clone();
    Button::new(SharedString::from(format!("codex-secondary-{key}")))
        .size(ButtonSize::Sm)
        .variant(ButtonVariant::GhostMuted)
        .label(button.label.clone())
        .disabled(button.disabled)
        .on_click(move |_, _, cx| {
            if let Some(intent) = &intent {
                send_intent(&client, &key, intent, cx)
            }
        })
        .into_any_element()
}

pub(crate) fn callback_completion(
    key: &str,
    callback: &CodexCallback,
    input: Option<&Entity<InputState>>,
    handoff_open: bool,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    let submit_client = client.clone();
    let submit_key = key.to_string();
    div()
        .w_full()
        .flex()
        .flex_col()
        .gap(px(CALLBACK_GAP))
        .text_size(px(text::XS))
        .line_height(px(text::XS * text::LEADING_RELAXED))
        .text_color(t.muted_foreground)
        .child(div().child(callback.prompt.clone()))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(FORM_GAP))
                .child(div().flex_1().min_w_0().children(
                    input.map(|input| Input::new(input).disabled(callback.input_disabled)),
                ))
                .child(
                    Button::new(SharedString::from(format!("codex-callback-submit-{key}")))
                        .variant(ButtonVariant::Outline)
                        .label(callback.submit.label.clone())
                        .disabled(callback.submit.disabled)
                        .on_click(move |_, _, cx| {
                            send_intent(
                                &submit_client,
                                &submit_key,
                                &json!({ "kind": "submit-callback" }),
                                cx,
                            )
                        }),
                ),
        )
        .when_some(callback.browser_retry.as_ref(), |this, retry| {
            let client = client.clone();
            let key = key.to_string();
            this.child(
                div().child(
                    Button::new(SharedString::from(format!("codex-browser-retry-{key}")))
                        .size(ButtonSize::Xs)
                        .variant(ButtonVariant::GhostMuted)
                        .label(retry.label.clone())
                        .icon_end("external-link")
                        .icon_size(EXTERNAL_ICON)
                        .on_click(move |_, _, cx| {
                            send_intent(&client, &key, &json!({ "kind": "browser-retry" }), cx)
                        }),
                ),
            )
        })
        .when_some(callback.handoff.as_ref(), |this, handoff| {
            let toggle_key = key.to_string();
            let href = handoff.href.clone();
            this.child(
                div()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .id(SharedString::from(format!("codex-handoff-{key}")))
                            .flex()
                            .items_center()
                            .gap(px(HELP_GAP))
                            .cursor_pointer()
                            .on_click(move |_, _, cx| {
                                if let Some(host) = CodexSetupHost::global(cx) {
                                    let key = toggle_key.clone();
                                    host.update(cx, |host, cx| {
                                        if !host.handoff_open.remove(&key) {
                                            host.handoff_open.insert(key);
                                        }
                                        cx.notify();
                                    });
                                }
                            })
                            .child(icon(
                                if handoff_open {
                                    "icons/chevron-down.svg"
                                } else {
                                    "icons/chevron-right.svg"
                                },
                                HELP_CHEVRON,
                                t.muted_foreground,
                            ))
                            .child(handoff.summary.clone()),
                    )
                    .when(handoff_open, |this| {
                        this.child(
                            div().mt(px(FORM_GAP)).flex().child(
                                Button::new(SharedString::from(format!(
                                    "codex-handoff-link-{key}"
                                )))
                                .size(ButtonSize::Sm)
                                .variant(ButtonVariant::Outline)
                                .label(handoff.label.clone())
                                .on_click(move |_, _, cx| cx.open_url(&href)),
                            ),
                        )
                    }),
            )
        })
        .into_any_element()
}

impl CodexSetupHost {
    pub fn install(client: &Entity<CoreClient>, window: &mut Window, cx: &mut App) {
        if cx.has_global::<CodexSetupHostHandle>() {
            return;
        }
        let host = cx.new(|cx| Self::new(client.clone(), window, cx));
        cx.set_global(CodexSetupHostHandle(host));
    }

    pub fn global(cx: &App) -> Option<Entity<CodexSetupHost>> {
        cx.try_global::<CodexSetupHostHandle>()
            .map(|handle| handle.0.clone())
    }

    fn new(client: Entity<CoreClient>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let cards = CoreClient::subscribe::<CodexCards>(
            &client,
            "codexSetupOnboardingCards",
            json!({}),
            cx,
        );
        let settings = CoreClient::subscribe::<CodexSettingsSections>(
            &client,
            "codexSetupSettingsSections",
            json!({}),
            cx,
        );
        let dialogs =
            CoreClient::subscribe::<CodexDialogs>(&client, "codexSetupDialogs", json!({}), cx);
        cx.observe_in(&settings, window, |host, _, window, cx| {
            host.sync_callback_inputs(window, cx);
            cx.notify();
        })
        .detach();
        cx.observe_in(&cards, window, |host, _, window, cx| {
            host.sync_callback_inputs(window, cx);
            cx.notify();
        })
        .detach();
        cx.observe_in(&dialogs, window, |host, _, window, cx| {
            host.sync_add_account_input(window, cx);
            cx.notify();
        })
        .detach();
        Self {
            client,
            cards,
            settings,
            dialogs,
            handoff_open: HashSet::new(),
            callback_inputs: HashMap::new(),
            callback_flows: HashMap::new(),
            add_account_input: None,
            add_account_revision: None,
        }
    }

    fn callback_of(footer: Option<&CodexFooter>) -> Option<CodexCallback> {
        match footer? {
            CodexFooter::Completion { callback, .. } => Some(callback.clone()),
            CodexFooter::Help { content, .. } => content.clone(),
        }
    }

    fn callbacks(&self, cx: &App) -> Vec<(String, CodexCallback)> {
        let cards = self.cards.read(cx).data.iter().flat_map(|cards| {
            cards.iter().filter_map(|(key, card)| {
                Some((key.clone(), Self::callback_of(card.footer.as_ref())?))
            })
        });
        let settings = self.settings.read(cx).data.iter().flat_map(|sections| {
            sections.iter().filter_map(|(key, section)| match section {
                CodexSettingsSection::Managed { fallback, .. } => {
                    Some((key.clone(), Self::callback_of(fallback.as_deref())?))
                }
                CodexSettingsSection::Preparing { .. } => None,
            })
        });
        cards.chain(settings).collect()
    }

    fn sync_callback_inputs(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let callbacks = self.callbacks(cx);
        self.handoff_open
            .retain(|key| callbacks.iter().any(|(candidate, _)| candidate == key));
        self.callback_inputs
            .retain(|key, _| callbacks.iter().any(|(candidate, _)| candidate == key));
        self.callback_flows
            .retain(|key, _| callbacks.iter().any(|(candidate, _)| candidate == key));
        for (key, callback) in callbacks {
            let input = match self.callback_inputs.get(&key) {
                Some(input) => input.clone(),
                None => {
                    let input = cx.new(|cx| InputState::new(window, cx));
                    input.update(cx, |state, cx| state.set_masked(true, window, cx));
                    let client = self.client.clone();
                    let subscribed = key.clone();
                    cx.subscribe_in(
                        &input,
                        window,
                        move |_, input: &Entity<InputState>, event: &InputEvent, _, cx| match event
                        {
                            InputEvent::Change => {
                                let value = input.read(cx).value().to_string();
                                act(
                                    &client,
                                    cx,
                                    "codexSetupCallbackInput",
                                    json!({ "key": subscribed, "value": value }),
                                );
                            }
                            InputEvent::PressEnter { .. } => send_intent(
                                &client,
                                &subscribed,
                                &json!({ "kind": "submit-callback" }),
                                cx,
                            ),
                            _ => {}
                        },
                    )
                    .detach();
                    self.callback_inputs.insert(key.clone(), input.clone());
                    input
                }
            };
            let previous = self.callback_flows.get(&key).cloned();
            let flow_changed = previous
                .as_ref()
                .is_some_and(|(flow, _)| flow != &callback.flow_id);
            let cleared = previous
                .as_ref()
                .is_some_and(|(_, value)| !value.is_empty())
                && callback.value.is_empty();
            let placeholder = callback.placeholder.clone();
            input.update(cx, |state, cx| {
                if (flow_changed || cleared) && state.value().as_ref() != callback.value {
                    state.set_value(callback.value.clone(), window, cx);
                }
                state.set_placeholder(placeholder, window, cx);
            });
            self.callback_flows
                .insert(key, (callback.flow_id.clone(), callback.value.clone()));
        }
    }

    fn sync_add_account_input(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let add = self
            .dialogs
            .read(cx)
            .data
            .as_ref()
            .and_then(|dialogs| dialogs.add_account.clone());
        let Some(add) = add else {
            self.add_account_revision = None;
            return;
        };
        let input = match self.add_account_input.clone() {
            Some(input) => input,
            None => {
                let input = cx.new(|cx| InputState::new(window, cx));
                let client = self.client.clone();
                cx.subscribe_in(
                    &input,
                    window,
                    move |_, input: &Entity<InputState>, event: &InputEvent, _, cx| match event {
                        InputEvent::Change => {
                            let value = input.read(cx).value().to_string();
                            act(
                                &client,
                                cx,
                                "codexSetupAddAccountSetName",
                                json!({ "value": value }),
                            );
                        }
                        InputEvent::PressEnter { .. } => {
                            act(&client, cx, "codexSetupAddAccountSubmit", json!({}))
                        }
                        _ => {}
                    },
                )
                .detach();
                self.add_account_input = Some(input.clone());
                input
            }
        };
        if self.add_account_revision != Some(add.revision)
            && let Some(form) = add.form.as_ref()
        {
            self.add_account_revision = Some(add.revision);
            let placeholder = form.placeholder.clone();
            let value = form.value.clone();
            input.update(cx, |state, cx| {
                state.set_value(value, window, cx);
                state.set_placeholder(placeholder, window, cx);
                state.focus(window, cx);
            });
        }
    }

    pub fn onboarding_card(key: &str, cx: &App) -> Option<AnyElement> {
        let host = Self::global(cx)?;
        let this = host.read(cx);
        let card = this.cards.read(cx).data.as_ref()?.get(key)?.clone();
        let t = theme::active(cx);
        let client = this.client.clone();
        let input = this.callback_inputs.get(key).cloned();
        let handoff_open = this.handoff_open.contains(key);
        let footer = card.footer.as_ref().map(|footer| match footer {
            CodexFooter::Completion { bordered, callback } => div()
                .w_full()
                .when(*bordered, |this| {
                    this.pt(px(CALLBACK_GAP))
                        .border_t_1()
                        .border_color(fade(t.border, 0.5))
                })
                .child(callback_completion(
                    &card.key,
                    callback,
                    input.as_ref(),
                    handoff_open,
                    &client,
                    &t,
                ))
                .into_any_element(),
            CodexFooter::Help {
                label,
                toggle,
                content,
            } => div()
                .w_full()
                .flex()
                .flex_col()
                .gap(px(CALLBACK_GAP))
                .text_size(px(text::XS))
                .line_height(px(text::XS * text::LEADING_RELAXED))
                .text_color(t.muted_foreground)
                .child(help_toggle(
                    SharedString::from(format!("codex-footer-help-{}", card.key)),
                    label,
                    toggle.as_ref(),
                    &card.key,
                    &client,
                    &t,
                ))
                .when_some(content.as_ref(), |this, callback| {
                    this.child(
                        div()
                            .w_full()
                            .pt(px(CALLBACK_GAP))
                            .border_t_1()
                            .border_color(fade(t.border, 0.5))
                            .child(callback_completion(
                                &card.key,
                                callback,
                                input.as_ref(),
                                handoff_open,
                                &client,
                                &t,
                            )),
                    )
                })
                .into_any_element(),
        });
        let error = card.setup_error.clone().map(|error| {
            div()
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .text_color(t.destructive_foreground)
                .child(error)
                .into_any_element()
        });
        let has_footer = footer.is_some() || error.is_some();
        Some(
            surface_card(&t)
                .p(px(CARD_PADDING))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .gap(px(CARD_GAP))
                        .child(
                            svg()
                                .path("icons/providers/openai.svg")
                                .flex_none()
                                .size(px(CODEX_ICON))
                                .text_color(t.foreground),
                        )
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .flex()
                                .flex_col()
                                .child(
                                    div()
                                        .text_size(px(text::SM))
                                        .line_height(px(text::SM_LINE))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(t.foreground)
                                        .child(card.title.clone()),
                                )
                                .child(
                                    div()
                                        .mt(px(2.))
                                        .text_size(px(text::XS))
                                        .line_height(px(text::XS * text::LEADING_RELAXED))
                                        .text_color(t.muted_foreground)
                                        .child(description(
                                            &card.key,
                                            &card.description,
                                            &client,
                                            &t,
                                        )),
                                ),
                        )
                        .child(
                            div()
                                .flex_none()
                                .flex()
                                .items_center()
                                .justify_end()
                                .gap(px(CONTROL_GAP))
                                .children(
                                    card.secondary
                                        .as_ref()
                                        .map(|button| secondary(&card, button, &client)),
                                )
                                .child(control(&card, &client, &t)),
                        ),
                )
                .when(has_footer, |this| {
                    this.child(
                        div()
                            .ml(px(FOOTER_INSET))
                            .mt(px(FOOTER_MARGIN))
                            .flex()
                            .flex_wrap()
                            .items_center()
                            .gap(px(FORM_GAP))
                            .children(footer)
                            .children(error),
                    )
                })
                .into_any_element(),
        )
    }

    pub fn settings_section(key: &str, cx: &App) -> Option<AnyElement> {
        Self::global(cx)?.read(cx).settings_element(key, cx)
    }

    fn settings_element(&self, key: &str, cx: &App) -> Option<AnyElement> {
        let section = self.settings.read(cx).data.as_ref()?.get(key)?.clone();
        let t = theme::active(cx);
        Some(codex_settings_section(
            &section,
            self.callback_inputs.get(key),
            self.handoff_open.contains(key),
            &self.client,
            &t,
        ))
    }

    fn add_account_dialog(&self, add: &CodexAddAccount, t: &Tokens, cx: &App) -> AnyElement {
        let close = self.client.clone();
        let input = self.add_account_input.clone();
        let body =
            if let Some(key) = add.setup_key.as_ref() {
                self.settings_element(key, cx)
            } else if let Some(preparing) = add.preparing.as_ref() {
                Some(
                    SettingsRow::new("codex-add-account-preparing", preparing.title.clone())
                        .description(preparing.description.clone())
                        .into_any_element(),
                )
            } else {
                add.form.as_ref().map(|form| {
                    SettingsRow::new("codex-add-account-name", form.title.clone())
                        .description(form.description.clone())
                        .control(div().w(px(ADD_INPUT_WIDTH)).children(
                            input.map(|input| Input::new(&input).disabled(form.disabled)),
                        ))
                        .into_any_element()
                })
            };
        let footer = DialogFooter::new().variant(DialogFooterVariant::Bare);
        let footer = if let Some(finish) = add.finish_later.as_ref() {
            let client = self.client.clone();
            footer.child(
                Button::new("codex-add-account-finish-later")
                    .variant(ButtonVariant::Outline)
                    .label(finish.label.clone())
                    .on_click(move |_, _, cx| {
                        act(&client, cx, "codexSetupAddAccountClose", json!({}))
                    }),
            )
        } else {
            let cancel = self.client.clone();
            let submit = self.client.clone();
            footer
                .children(add.cancel.as_ref().map(|button| {
                    Button::new("codex-add-account-cancel")
                        .variant(ButtonVariant::Outline)
                        .label(button.label.clone())
                        .disabled(button.disabled)
                        .on_click(move |_, _, cx| {
                            act(&cancel, cx, "codexSetupAddAccountClose", json!({}))
                        })
                }))
                .children(add.submit.as_ref().map(|button| {
                    Button::new("codex-add-account-submit")
                        .label(button.label.clone())
                        .disabled(button.disabled)
                        .on_click(move |_, _, cx| {
                            act(&submit, cx, "codexSetupAddAccountSubmit", json!({}))
                        })
                }))
        };
        DialogPopup::new("codex-add-account")
            .max_width(WIZARD_MAX_WIDTH)
            .on_close(move |_, cx| act(&close, cx, "codexSetupAddAccountClose", json!({})))
            .child(
                DialogHeader::new()
                    .child(DialogTitle::new(add.title.clone()))
                    .child(DialogDescription::new(add.description.clone())),
            )
            .child(
                div()
                    .px(px(WIZARD_PANEL_PADDING_X))
                    .py(px(WIZARD_PANEL_PADDING_Y))
                    .bg(if dark(t) {
                        white(0.02)
                    } else {
                        fade(t.muted, 0.5)
                    })
                    .shadow(vec![soft_ring(t)])
                    .children(body),
            )
            .child(footer)
            .into_any_element()
    }

    fn account_picker(&self, picker: &CodexAccountPicker, t: &Tokens) -> AnyElement {
        let close = self.client.clone();
        let confirm = self.client.clone();
        let close_key = picker.key.clone();
        let confirm_key = picker.key.clone();
        let count = picker.options.len();
        DialogPopup::new("codex-account-picker")
            .on_close(move |_, cx| {
                act(
                    &close,
                    cx,
                    "codexSetupPickerClose",
                    json!({ "key": close_key }),
                )
            })
            .child(
                DialogHeader::new()
                    .child(DialogTitle::new(picker.title.clone()))
                    .child(DialogDescription::new(picker.description.clone())),
            )
            .child(div().px(px(PICKER_PADDING)).pb(px(PICKER_PADDING)).child(
                RadioGroup::new("codex-account-options").children(
                    picker.options.iter().enumerate().map(|(index, option)| {
                        let client = self.client.clone();
                        let row_client = self.client.clone();
                        let key = picker.key.clone();
                        let row_key = picker.key.clone();
                        let value = option.value.clone();
                        let row_value = option.value.clone();
                        div()
                            .id(SharedString::from(format!(
                                "codex-account-{}",
                                option.value
                            )))
                            .flex()
                            .items_center()
                            .gap(px(PICKER_ROW_GAP))
                            .p(px(PICKER_ROW_PADDING))
                            .rounded(px(radius::LG))
                            .border_1()
                            .border_color(t.border)
                            .cursor_pointer()
                            .text_size(px(text::SM))
                            .line_height(px(text::SM_LINE))
                            .on_click(move |_, _, cx| {
                                act(
                                    &row_client,
                                    cx,
                                    "codexSetupPickerSelect",
                                    json!({ "key": row_key, "value": row_value }),
                                )
                            })
                            .child(
                                Radio::new(SharedString::from(format!(
                                    "codex-account-radio-{}",
                                    option.value
                                )))
                                .checked(option.value == picker.selected_method_id)
                                .position(index, count)
                                .on_select(move |_, _, cx| {
                                    cx.stop_propagation();
                                    act(
                                        &client,
                                        cx,
                                        "codexSetupPickerSelect",
                                        json!({ "key": key, "value": value }),
                                    )
                                }),
                            )
                            .child(
                                div()
                                    .min_w_0()
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(t.foreground)
                                    .child(option.label.clone()),
                            )
                    }),
                ),
            ))
            .child(DialogFooter::new().child(chatgpt_button(
                "codex-account-confirm".into(),
                &picker.confirm_label,
                false,
                move |cx| {
                    act(
                        &confirm,
                        cx,
                        "codexSetupPickerConfirm",
                        json!({ "key": confirm_key }),
                    )
                },
            )))
            .into_any_element()
    }

    fn welcome_dialog(&self, welcome: &CodexWelcome, t: &Tokens) -> AnyElement {
        let close = self.client.clone();
        let dismiss = self.client.clone();
        let usage = self.client.clone();
        DialogPopup::new("chatgpt-welcome")
            .on_close(move |_, cx| act(&close, cx, "codexSetupWelcomeDismiss", json!({})))
            .child(
                DialogHeader::new()
                    .child(
                        svg()
                            .path("icons/providers/openai.svg")
                            .mb(px(WELCOME_ICON_GAP))
                            .size(px(WELCOME_ICON))
                            .text_color(t.foreground),
                    )
                    .child(DialogTitle::new(welcome.title.clone()))
                    .child(DialogDescription::new(welcome.description.clone()))
                    .child(
                        div()
                            .text_size(px(text::XS))
                            .line_height(px(text::XS_LINE))
                            .text_color(t.muted_foreground)
                            .child(welcome.detail.clone()),
                    ),
            )
            .child(
                DialogFooter::new()
                    .child(
                        Button::new("chatgpt-welcome-usage")
                            .size(ButtonSize::Sm)
                            .variant(ButtonVariant::GhostMuted)
                            .label(welcome.usage_label.clone())
                            .icon_end("external-link")
                            .icon_size(EXTERNAL_ICON)
                            .on_click(move |_, _, cx| {
                                act(&usage, cx, "codexSetupWelcomeOpenUsage", json!({}))
                            }),
                    )
                    .child(
                        Button::new("chatgpt-welcome-continue")
                            .label(welcome.continue_label.clone())
                            .on_click(move |_, _, cx| {
                                act(&dismiss, cx, "codexSetupWelcomeDismiss", json!({}))
                            }),
                    ),
            )
            .into_any_element()
    }
}

impl Render for CodexSetupHost {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = theme::active(cx);
        let dialogs = self.dialogs.read(cx).data.clone();
        let Some(dialogs) = dialogs else {
            return div().into_any_element();
        };
        div()
            .children(
                dialogs
                    .add_account
                    .as_ref()
                    .map(|add| self.add_account_dialog(add, &t, cx)),
            )
            .children(
                dialogs
                    .account_picker
                    .as_ref()
                    .map(|picker| self.account_picker(picker, &t)),
            )
            .children(
                dialogs
                    .welcome
                    .as_ref()
                    .map(|welcome| self.welcome_dialog(welcome, &t)),
            )
            .into_any_element()
    }
}
