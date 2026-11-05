use std::collections::HashMap;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Entity, FontWeight, InteractiveElement, IntoElement, ParentElement,
    SharedString, StatefulInteractiveElement, Styled, div, px,
};
use serde_json::json;

use super::act;
use super::parts::{heading, icon, lead, surface_card};
use super::wizard::{continue_button, footer};
use crate::app_core::client::CoreClient;
use crate::app_core::views::onboarding::{
    AgentCard, AgentCardEntry, AgentCardStatus, AgentTerminal, AgentTerminalMessage, AgentsBody,
    AgentsSection,
};
use crate::features::chat::provider_instance_icon::ProviderInstanceIcon;
use crate::features::terminal::StandaloneTerminal;
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::theme::Tokens;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::fade;

const LIST_MARGIN: f32 = 20.;
const LIST_MAX_HEIGHT: f32 = 512.;
const LIST_PADDING_RIGHT: f32 = 12.;
const SECTION_GAP: f32 = 20.;
const SECTION_HEADING_GAP: f32 = 8.;
const CARD_GAP: f32 = 6.;
const CARD_PADDING: f32 = 16.;
const CARD_INNER_GAP: f32 = 12.;
const AGENT_ICON: f32 = 20.;
const STATUS_ICON: f32 = 14.;
const STATUS_GAP: f32 = 6.;
const ACCOUNT_MARGIN: f32 = 12.;
const TERMINAL_MARGIN: f32 = 16.;
const TERMINAL_HEIGHT: f32 = 256.;
const TERMINAL_BAR_PADDING_X: f32 = 12.;
const TERMINAL_BAR_PADDING_Y: f32 = 6.;
const TERMINAL_TEXT: f32 = 11.;
const TERMINAL_TEXT_LINE: f32 = 16.;
const CODE_PADDING_X: f32 = 4.;

pub fn render(
    body: &AgentsBody,
    client: &Entity<CoreClient>,
    terminals: &HashMap<String, Entity<StandaloneTerminal>>,
    t: &Tokens,
    cx: &App,
) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .child(heading(t, body.heading.clone()))
        .child(lead(t, body.description.clone()))
        .child(
            div()
                .id("welcome-agents-scroll")
                .mt(px(LIST_MARGIN))
                .max_h(px(LIST_MAX_HEIGHT))
                .overflow_y_scroll()
                .child(
                    div()
                        .pr(px(LIST_PADDING_RIGHT))
                        .flex()
                        .flex_col()
                        .gap(px(SECTION_GAP))
                        .children(
                            body.sections
                                .iter()
                                .map(|section| render_section(section, client, terminals, t, cx)),
                        ),
                ),
        )
        .child(footer().child(continue_button(
            "welcome-agents-continue",
            &body.continue_button.label,
            body.continue_button.enabled,
            client,
            "welcomeContinueAgents",
        )))
        .into_any_element()
}

fn render_section(
    section: &AgentsSection,
    client: &Entity<CoreClient>,
    terminals: &HashMap<String, Entity<StandaloneTerminal>>,
    t: &Tokens,
    cx: &App,
) -> AnyElement {
    let environment_id = section.environment_id.clone();
    div()
        .flex()
        .flex_col()
        .child(
            div()
                .mb(px(SECTION_HEADING_GAP))
                .text_size(px(text::SM))
                .line_height(px(text::SM_LINE))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.foreground)
                .child(section.heading.clone()),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(CARD_GAP))
                .children(section.cards.iter().filter_map(|entry| match entry {
                    AgentCardEntry::Card {
                        key,
                        driver,
                        provider_instance_id,
                        card,
                    } => Some(agent_card(
                        &environment_id,
                        key,
                        driver,
                        provider_instance_id.as_deref(),
                        card,
                        client,
                        t,
                    )),
                    AgentCardEntry::CodexSetup { host_key, .. } => {
                        super::codex_setup::CodexSetupHost::onboarding_card(host_key, cx)
                    }
                })),
        )
        .when_some(section.add_account_label.clone(), |this, label| {
            let client = client.clone();
            let environment_id = environment_id.clone();
            this.child(
                div().mt(px(ACCOUNT_MARGIN)).child(
                    Button::new(SharedString::from(format!(
                        "welcome-add-account-{environment_id}"
                    )))
                    .size(ButtonSize::Xs)
                    .variant(ButtonVariant::GhostMuted)
                    .label(label)
                    .on_click(move |_, _, cx| {
                        act(
                            &client,
                            cx,
                            "codexSetupAddAccountOpen",
                            json!({ "environmentId": environment_id }),
                        )
                    }),
                ),
            )
        })
        .when_some(section.terminal.as_ref(), |this, terminal| {
            this.child(agent_terminal(
                &environment_id,
                terminal,
                client,
                terminals,
                t,
            ))
        })
        .into_any_element()
}

fn agent_icon(driver_icon: &str, filled: bool, t: &Tokens) -> AnyElement {
    ProviderInstanceIcon::new(
        driver_icon.to_string(),
        "",
        if filled {
            t.foreground
        } else {
            t.muted_foreground
        },
    )
    .icon_size(AGENT_ICON)
    .into_any_element()
}

fn agent_card(
    environment_id: &str,
    key: &str,
    driver: &str,
    provider_instance_id: Option<&str>,
    card: &AgentCard,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    let status = match &card.status {
        AgentCardStatus::Ready { label } => div()
            .flex()
            .items_center()
            .gap(px(STATUS_GAP))
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .font_weight(FontWeight::MEDIUM)
            .text_color(t.success_foreground)
            .child(icon("icons/check.svg", STATUS_ICON, t.success_foreground))
            .child(label.clone())
            .into_any_element(),
        AgentCardStatus::Text { label } => div()
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .text_color(t.muted_foreground)
            .child(label.clone())
            .into_any_element(),
        AgentCardStatus::Action { label, enabled } => {
            let client = client.clone();
            let params = json!({
                "environmentId": environment_id,
                "driver": driver,
                "providerInstanceId": provider_instance_id,
            });
            Button::new(SharedString::from(format!(
                "welcome-agent-action-{environment_id}-{key}"
            )))
            .size(ButtonSize::Xs)
            .variant(ButtonVariant::Ghost)
            .icon("terminal")
            .icon_size(STATUS_ICON)
            .label(label.clone())
            .disabled(!enabled)
            .on_click(move |_, _, cx| act(&client, cx, "welcomeOpenAgentTerminal", params.clone()))
            .into_any_element()
        }
    };
    surface_card(t)
        .flex()
        .items_center()
        .gap(px(CARD_INNER_GAP))
        .p(px(CARD_PADDING))
        .child(agent_icon(&card.icon, card.icon_filled, t))
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
                        .child(card.display_name.clone()),
                )
                .child(
                    div()
                        .mt(px(2.))
                        .text_size(px(text::XS))
                        .line_height(px(text::XS * text::LEADING_RELAXED))
                        .text_color(t.muted_foreground)
                        .child(card.description.clone()),
                ),
        )
        .child(div().flex_none().child(status))
        .into_any_element()
}

fn agent_terminal(
    environment_id: &str,
    terminal: &AgentTerminal,
    client: &Entity<CoreClient>,
    terminals: &HashMap<String, Entity<StandaloneTerminal>>,
    t: &Tokens,
) -> AnyElement {
    let model = &terminal.model;
    let message = match &model.message {
        AgentTerminalMessage::RunCommand { command } => div()
            .flex()
            .items_center()
            .child("Run ")
            .child(
                div()
                    .px(px(CODE_PADDING_X))
                    .rounded(px(radius::XS))
                    .bg(t.muted)
                    .font_family(MONO_FONT)
                    .child(command.clone()),
            )
            .child(" in this terminal.")
            .into_any_element(),
        AgentTerminalMessage::Text { text } => div().child(text.clone()).into_any_element(),
    };
    let retry_client = client.clone();
    let close_client = client.clone();
    let retry_environment = environment_id.to_string();
    let close_environment = environment_id.to_string();
    let viewport = terminal
        .session_key
        .as_ref()
        .filter(|_| model.show_viewport)
        .and_then(|key| terminals.get(key).cloned());
    div()
        .mt(px(TERMINAL_MARGIN))
        .overflow_hidden()
        .rounded(px(radius::LG))
        .border_1()
        .border_color(fade(t.border, 0.7))
        .bg(t.background)
        .text_color(t.foreground)
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .px(px(TERMINAL_BAR_PADDING_X))
                .py(px(TERMINAL_BAR_PADDING_Y))
                .border_b_1()
                .border_color(fade(t.border, 0.6))
                .bg(fade(t.background, 0.6))
                .child(
                    div()
                        .text_size(px(TERMINAL_TEXT))
                        .line_height(px(TERMINAL_TEXT_LINE))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.muted_foreground)
                        .child(message),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(4.))
                        .when_some(model.retry_label.clone(), |this, label| {
                            this.child(
                                Button::new(SharedString::from(format!(
                                    "welcome-terminal-retry-{retry_environment}"
                                )))
                                .size(ButtonSize::Xs)
                                .variant(ButtonVariant::Ghost)
                                .label(label)
                                .on_click(move |_, _, cx| {
                                    act(
                                        &retry_client,
                                        cx,
                                        "welcomeRetryAgentTerminal",
                                        json!({ "environmentId": retry_environment }),
                                    )
                                }),
                            )
                        })
                        .child(
                            Button::new(SharedString::from(format!(
                                "welcome-terminal-close-{close_environment}"
                            )))
                            .size(ButtonSize::Xs)
                            .variant(ButtonVariant::GhostMuted)
                            .label(model.close_label.clone())
                            .on_click(move |_, _, cx| {
                                act(
                                    &close_client,
                                    cx,
                                    "welcomeCloseAgentTerminal",
                                    json!({ "environmentId": close_environment }),
                                )
                            }),
                        ),
                ),
        )
        .child(
            div()
                .id(SharedString::from(format!(
                    "welcome-terminal-{environment_id}"
                )))
                .h(px(TERMINAL_HEIGHT))
                .children(viewport),
        )
        .into_any_element()
}
