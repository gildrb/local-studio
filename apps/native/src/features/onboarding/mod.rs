mod agents;
pub mod codex_setup;
pub mod deep_links;
mod import;
mod parts;
mod wizard;

use std::collections::HashMap;

use gpui::component::input::{InputEvent, InputState};
use gpui::{
    AnyElement, App, AppContext, Context, Entity, FontWeight, IntoElement, ParentElement, Render,
    Styled, Window, div, px,
};
use serde_json::json;

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::onboarding::{FirstRunGateView, WelcomeWizardView, WizardBody};
use crate::features::terminal::StandaloneTerminal;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::theme;
use crate::ui::theme::metrics::text;

const RECOVERY_MAX_WIDTH: f32 = 384.;
const RECOVERY_PADDING_X: f32 = 24.;
const RECOVERY_DESCRIPTION_MARGIN: f32 = 8.;
const RECOVERY_ACTION_MARGIN: f32 = 20.;

pub(crate) fn act(
    client: &Entity<CoreClient>,
    cx: &mut App,
    action: &str,
    params: serde_json::Value,
) {
    client.update(cx, |client, _| client.act(action, params));
}

pub struct OnboardingHost {
    client: Entity<CoreClient>,
    wizard: Entity<ViewState<Option<WelcomeWizardView>>>,
    gate: Entity<ViewState<FirstRunGateView>>,
    pairing_input: Option<Entity<InputState>>,
    pairing_revision: u64,
    pairing_was_open: bool,
    terminals: HashMap<String, Entity<StandaloneTerminal>>,
    pub collapsed_inset: Option<f32>,
}

impl OnboardingHost {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let wizard = CoreClient::subscribe::<Option<WelcomeWizardView>>(
            &client,
            "welcomeWizard",
            json!({}),
            cx,
        );
        cx.observe(&wizard, |host, _, cx| {
            host.sync_terminals(cx);
            cx.notify();
        })
        .detach();
        let gate =
            CoreClient::subscribe::<FirstRunGateView>(&client, "firstRunGate", json!({}), cx);
        cx.observe(&gate, |_, _, cx| cx.notify()).detach();
        deep_links::attach(&client, cx);
        Self {
            client,
            wizard,
            gate,
            pairing_input: None,
            pairing_revision: 0,
            pairing_was_open: false,
            terminals: HashMap::new(),
            collapsed_inset: None,
        }
    }

    pub fn gate_screen(host: &Entity<Self>, cx: &App) -> Option<AnyElement> {
        let this = host.read(cx);
        let view = this.gate.read(cx).data.clone()?;
        let t = theme::active(cx);
        match view {
            FirstRunGateView::App => None,
            FirstRunGateView::Blank => Some(div().size_full().bg(t.background).into_any_element()),
            FirstRunGateView::Recovery {
                title,
                description,
                action,
            } => {
                let client = this.client.clone();
                Some(
                    div()
                        .size_full()
                        .flex()
                        .items_center()
                        .justify_center()
                        .px(px(RECOVERY_PADDING_X))
                        .bg(t.background)
                        .text_color(t.foreground)
                        .child(
                            div()
                                .max_w(px(RECOVERY_MAX_WIDTH))
                                .flex()
                                .flex_col()
                                .items_center()
                                .text_center()
                                .child(
                                    div()
                                        .text_size(px(text::LG))
                                        .line_height(px(text::LG_LINE))
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .child(title),
                                )
                                .child(
                                    div()
                                        .mt(px(RECOVERY_DESCRIPTION_MARGIN))
                                        .text_size(px(text::SM))
                                        .line_height(px(text::SM_LINE))
                                        .text_color(t.muted_foreground)
                                        .child(description),
                                )
                                .child(
                                    div().mt(px(RECOVERY_ACTION_MARGIN)).child(
                                        Button::new("first-run-recovery")
                                            .size(ButtonSize::Sm)
                                            .variant(ButtonVariant::Outline)
                                            .icon("refresh-cw")
                                            .label(action.label)
                                            .disabled(!action.enabled)
                                            .on_click(move |_, _, cx| {
                                                act(&client, cx, "firstRunGateRetry", json!({}))
                                            }),
                                    ),
                                ),
                        )
                        .into_any_element(),
                )
            }
        }
    }

    fn sync_terminals(&mut self, cx: &mut Context<Self>) {
        let keys: Vec<String> = match self.wizard.read(cx).data.clone().flatten() {
            Some(WelcomeWizardView {
                body: WizardBody::Agents(body),
                ..
            }) => body
                .sections
                .iter()
                .filter_map(|section| section.terminal.as_ref()?.session_key.clone())
                .collect(),
            _ => Vec::new(),
        };
        self.terminals.retain(|key, _| keys.contains(key));
        for key in keys {
            if !self.terminals.contains_key(&key) {
                let terminal = StandaloneTerminal::new(self.client.clone(), key.clone(), cx);
                self.terminals.insert(key, terminal);
            }
        }
    }

    fn ensure_pairing_input(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<InputState> {
        if let Some(input) = self.pairing_input.clone() {
            return input;
        }
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
                        "welcomeSetPairingUrl",
                        json!({ "value": value }),
                    );
                }
                InputEvent::PressEnter { .. } => {
                    act(&client, cx, "welcomeSubmitPairing", json!({}))
                }
                _ => {}
            },
        )
        .detach();
        self.pairing_input = Some(input.clone());
        input
    }
}

impl Render for OnboardingHost {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.wizard.read(cx).data.clone().flatten() else {
            self.pairing_was_open = false;
            return div().into_any_element();
        };
        let pairing = match &view.body {
            WizardBody::Connection(body) => Some((
                body.pairing.open,
                body.pairing_value_revision,
                body.pairing.form.placeholder.clone(),
            )),
            _ => None,
        };
        let input = pairing.as_ref().map(|(open, revision, placeholder)| {
            let input = self.ensure_pairing_input(window, cx);
            let reset = *revision != self.pairing_revision;
            let opened = *open && !self.pairing_was_open;
            self.pairing_revision = *revision;
            self.pairing_was_open = *open;
            let placeholder = placeholder.clone();
            input.update(cx, |state, cx| {
                if reset {
                    state.set_value("", window, cx);
                }
                state.set_placeholder(placeholder, window, cx);
                if opened {
                    state.focus(window, cx);
                }
            });
            input
        });
        if pairing.is_none() {
            self.pairing_was_open = false;
        }
        let terminals = self.terminals.clone();
        div()
            .child(wizard::popup(&view, &self.client, input, &terminals, cx))
            .into_any_element()
    }
}

pub fn welcome_page(
    host: &Entity<OnboardingHost>,
    collapsed_inset: Option<f32>,
    cx: &App,
) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .flex_1()
        .min_w_0()
        .min_h_0()
        .children(crate::features::drafts_host::DraftsHost::no_projects_hero(
            collapsed_inset,
            cx,
        ))
        .child(host.clone())
        .into_any_element()
}
