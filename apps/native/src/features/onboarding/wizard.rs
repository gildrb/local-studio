use std::collections::HashMap;

use gpui::component::input::InputState;
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Entity, FontWeight, InteractiveElement, IntoElement, ParentElement,
    SharedString, StatefulInteractiveElement, Styled, div, img, px,
};
use serde_json::json;

use super::parts::{command_block, heading, icon, lead, ring, soft_ring, surface_card};
use super::{act, agents, import};
use crate::app_core::client::CoreClient;
use crate::app_core::views::onboarding::{
    ConnectionBody, ConnectionRow, PairingForm, WelcomeWizardView, WizardBody, WizardHeader,
};
use crate::features::terminal::StandaloneTerminal;
use crate::platform::MONO_FONT;
use crate::ui::button::Button;
use crate::ui::checkbox::Checkbox;
use crate::ui::dialog::{DialogHeader, DialogPopup};
use crate::ui::input::{Input, InputSize};
use crate::ui::popover::{black, dark, white};
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::fade;
use crate::ui::theme::{self, Tokens};
use gpui::base::CheckboxState;

const WIZARD_MAX_WIDTH: f32 = 768.;
const BRAND_SIZE: f32 = 24.;
const BRAND_GAP: f32 = 8.;
const STEPS_RADIUS: f32 = 14.;
const STEPS_PADDING: f32 = 4.;
const STEP_GAP: f32 = 4.;
const STEP_PADDING_X: f32 = 10.;
const STEP_PADDING_Y: f32 = 8.;
const STEP_INNER_GAP: f32 = 8.;
const STEP_NUMBER: f32 = 20.;
const STEP_CHECK: f32 = 16.;
const PANEL_PADDING_X: f32 = 24.;
const PANEL_PADDING_Y: f32 = 20.;
const ROWS_MARGIN: f32 = 20.;
const ROW_GAP: f32 = 8.;
const ROW_PADDING: f32 = 12.;
const ROW_INNER_GAP: f32 = 12.;
const ROW_ICON: f32 = 16.;
const OPTIONS_MARGIN: f32 = 16.;
const OPTION_TRIGGER_HEIGHT: f32 = 28.;
const OPTION_TRIGGER_PADDING_X: f32 = 10.;
const OPTION_TRIGGER_GAP: f32 = 6.;
const OPTION_PANEL_PADDING: f32 = 12.;
const FORM_GAP: f32 = 12.;
const FIELD_LABEL_GAP: f32 = 8.;
const ALERT_PADDING_X: f32 = 12.;
const ALERT_PADDING_Y: f32 = 8.;
const HELP_ICON: f32 = 14.;
const HELP_GAP: f32 = 4.;
const FOOTER_MARGIN: f32 = 24.;
const FOOTER_GAP: f32 = 12.;
const CONTINUE_ICON: f32 = 14.;

pub fn popup(
    view: &WelcomeWizardView,
    client: &Entity<CoreClient>,
    pairing_input: Option<Entity<InputState>>,
    terminals: &HashMap<String, Entity<StandaloneTerminal>>,
    cx: &App,
) -> AnyElement {
    let t = theme::active(cx);
    let body = match &view.body {
        WizardBody::Connection(body) => connection(body, client, pairing_input, &t),
        WizardBody::Agents(body) => agents::render(body, client, terminals, &t, cx),
        WizardBody::Import(body) => import::render(body, client, &t),
        WizardBody::ImportLoading(body) => import::loading(body, client, &t),
    };
    DialogPopup::new("welcome-wizard")
        .show_close_button(false)
        .max_width(WIZARD_MAX_WIDTH)
        .child(
            div()
                .id("welcome-wizard-scroll")
                .flex()
                .flex_col()
                .min_h_0()
                .overflow_y_scroll()
                .child(header(&view.header, client, &t))
                .child(
                    div()
                        .min_w_0()
                        .px(px(PANEL_PADDING_X))
                        .py(px(PANEL_PADDING_Y))
                        .rounded_b(px(radius::XXL - 1.))
                        .bg(if dark(&t) {
                            white(0.02)
                        } else {
                            fade(zinc_25(), 0.8)
                        })
                        .shadow(vec![soft_ring(&t)])
                        .child(body),
                ),
        )
        .into_any_element()
}

fn zinc_25() -> gpui::Rgba {
    gpui::rgb(0xfcfcfc)
}

fn header(model: &WizardHeader, client: &Entity<CoreClient>, t: &Tokens) -> AnyElement {
    let dark_mode = dark(t);
    DialogHeader::new()
        .with_panel(true)
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(BRAND_GAP))
                .child(
                    img("brand/local-studio.png")
                        .flex_none()
                        .size(px(BRAND_SIZE))
                        .rounded(px(radius::MD)),
                )
                .child(
                    div()
                        .text_size(px(text::XXL))
                        .line_height(px(text::XXL_LINE))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.foreground)
                        .child(model.brand_label.clone()),
                ),
        )
        .child(
            div()
                .flex()
                .gap(px(STEP_GAP))
                .p(px(STEPS_PADDING))
                .rounded(px(STEPS_RADIUS))
                .bg(if dark_mode { white(0.04) } else { zinc_25() })
                .shadow(vec![soft_ring(t)])
                .children(model.stages.iter().map(|stage| {
                    let done = stage.index < model.stage_index;
                    let current = stage.current;
                    let enabled = !stage.disabled;
                    let client = client.clone();
                    let index = stage.index;
                    let card = t.card;
                    div()
                        .id(("welcome-stage", stage.index))
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .items_center()
                        .gap(px(STEP_INNER_GAP))
                        .px(px(STEP_PADDING_X))
                        .py(px(STEP_PADDING_Y))
                        .rounded(px(radius::LG))
                        .when(current, |this| {
                            this.bg(t.card).shadow(if dark_mode {
                                vec![soft_ring(t)]
                            } else {
                                vec![
                                    soft_ring(t),
                                    crate::ui::popover::shadow(0., 1., 2., 0., black(0.05)),
                                ]
                            })
                        })
                        .when(enabled && !current, |this| {
                            this.cursor_pointer()
                                .hover(move |style| style.bg(card))
                                .on_click(move |_, _, cx| {
                                    act(
                                        &client,
                                        cx,
                                        "welcomeSelectStage",
                                        json!({ "index": index }),
                                    )
                                })
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
                                            .text_color(t.primary_foreground)
                                            .shadow(vec![ring(t.primary)])
                                            .child(icon(
                                                "icons/check.svg",
                                                STEP_CHECK,
                                                t.primary_foreground,
                                            ))
                                    } else if current {
                                        this.bg(fade(t.primary, 0.1))
                                            .text_color(t.primary)
                                            .shadow(vec![ring(fade(t.primary, 0.3))])
                                            .child(SharedString::from(
                                                (stage.index + 1).to_string(),
                                            ))
                                    } else {
                                        this.bg(if dark_mode { white(0.05) } else { t.card })
                                            .text_color(t.muted_foreground)
                                            .shadow(vec![ring(if dark_mode {
                                                white(0.1)
                                            } else {
                                                black(0.1)
                                            })])
                                            .child(SharedString::from(
                                                (stage.index + 1).to_string(),
                                            ))
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
                                .child(stage.label.clone()),
                        )
                })),
        )
        .into_any_element()
}

pub fn continue_button(
    id: &'static str,
    label: &str,
    enabled: bool,
    client: &Entity<CoreClient>,
    action: &'static str,
) -> impl IntoElement {
    let client = client.clone();
    Button::new(id)
        .label(label.to_string())
        .icon_end("arrow-right")
        .icon_size(CONTINUE_ICON)
        .disabled(!enabled)
        .on_click(move |_, _, cx| act(&client, cx, action, json!({})))
}

pub fn footer() -> gpui::Div {
    div()
        .mt(px(FOOTER_MARGIN))
        .flex()
        .flex_wrap()
        .items_center()
        .justify_end()
        .gap(px(FOOTER_GAP))
}

fn connection(
    body: &ConnectionBody,
    client: &Entity<CoreClient>,
    pairing_input: Option<Entity<InputState>>,
    t: &Tokens,
) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .child(heading(t, body.heading.clone()))
        .child(lead(t, body.description.clone()))
        .when(!body.rows.is_empty(), |this| {
            this.child(
                div()
                    .mt(px(ROWS_MARGIN))
                    .flex()
                    .flex_col()
                    .gap(px(ROW_GAP))
                    .children(body.rows.iter().map(|row| connection_row(row, client, t))),
            )
        })
        .child(
            div()
                .mt(px(OPTIONS_MARGIN))
                .child(pairing_option(body, client, pairing_input, t)),
        )
        .child(footer().child(continue_button(
            "welcome-connection-continue",
            &body.continue_button.label,
            body.continue_button.enabled,
            client,
            "welcomeContinueConnection",
        )))
        .into_any_element()
}

fn connection_row(row: &ConnectionRow, client: &Entity<CoreClient>, t: &Tokens) -> AnyElement {
    let toggle_client = client.clone();
    let checkbox_client = client.clone();
    let environment_id = row.environment_id.clone();
    let checkbox_environment = row.environment_id.clone();
    let checked = row.checked;
    surface_card(t)
        .id(SharedString::from(format!(
            "welcome-row-{}",
            row.environment_id
        )))
        .flex()
        .items_center()
        .gap(px(ROW_INNER_GAP))
        .p(px(ROW_PADDING))
        .cursor_pointer()
        .on_click(move |_, _, cx| {
            act(
                &toggle_client,
                cx,
                "welcomeSetEnvironmentChecked",
                json!({ "environmentId": environment_id, "checked": !checked }),
            )
        })
        .child(
            Checkbox::new(SharedString::from(format!(
                "welcome-row-check-{}",
                row.environment_id
            )))
            .checked(row.checked)
            .on_change(move |state, _, _, cx| {
                cx.stop_propagation();
                act(
                    &checkbox_client,
                    cx,
                    "welcomeSetEnvironmentChecked",
                    json!({
                        "environmentId": checkbox_environment,
                        "checked": state == CheckboxState::Checked,
                    }),
                )
            }),
        )
        .child(icon("icons/monitor.svg", ROW_ICON, t.muted_foreground))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .child(
                    div()
                        .flex()
                        .items_baseline()
                        .justify_between()
                        .gap(px(ROW_INNER_GAP))
                        .child(
                            div()
                                .min_w_0()
                                .text_size(px(text::SM))
                                .line_height(px(text::SM_LINE))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.foreground)
                                .child(row.label.clone()),
                        )
                        .child(
                            div()
                                .flex_none()
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .text_color(t.muted_foreground)
                                .child(row.status_label.clone()),
                        ),
                )
                .when_some(row.display_url.clone(), |this, url| {
                    this.child(
                        div()
                            .mt(px(2.))
                            .text_size(px(text::XS))
                            .line_height(px(text::XS_LINE))
                            .text_color(t.muted_foreground)
                            .child(url),
                    )
                }),
        )
        .into_any_element()
}

pub fn option_trigger(
    id: &'static str,
    icon_path: &'static str,
    label: &str,
    open: bool,
    disabled: bool,
    t: &Tokens,
) -> gpui::Stateful<gpui::Div> {
    let accent = t.accent;
    div()
        .id(id)
        .w_full()
        .h(px(OPTION_TRIGGER_HEIGHT))
        .flex()
        .items_center()
        .gap(px(OPTION_TRIGGER_GAP))
        .px(px(OPTION_TRIGGER_PADDING_X))
        .rounded(px(radius::CONTROL))
        .text_size(px(text::SM))
        .line_height(px(text::SM_LINE))
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.foreground)
        .when(disabled, |this| this.opacity(0.64))
        .when(!disabled, |this| {
            this.cursor_pointer().hover(move |style| style.bg(accent))
        })
        .child(icon(icon_path, ROW_ICON, t.muted_foreground))
        .child(div().flex_1().min_w_0().child(label.to_string()))
        .child(icon(
            if open {
                "icons/chevron-down.svg"
            } else {
                "icons/chevron-right.svg"
            },
            ROW_ICON,
            t.muted_foreground,
        ))
}

fn pairing_option(
    body: &ConnectionBody,
    client: &Entity<CoreClient>,
    pairing_input: Option<Entity<InputState>>,
    t: &Tokens,
) -> AnyElement {
    let pairing = &body.pairing;
    let toggle = client.clone();
    let open = pairing.open;
    let disabled = pairing.trigger_disabled;
    surface_card(t)
        .child(
            option_trigger(
                "welcome-pairing-trigger",
                "icons/link.svg",
                &pairing.label,
                open,
                disabled,
                t,
            )
            .when(!disabled, |this| {
                this.on_click(move |_, _, cx| {
                    act(
                        &toggle,
                        cx,
                        "welcomeSetPairingOpen",
                        json!({ "open": !open }),
                    )
                })
            }),
        )
        .when(open, |this| {
            this.child(
                div()
                    .px(px(OPTION_PANEL_PADDING))
                    .pb(px(OPTION_PANEL_PADDING))
                    .child(pairing_form(
                        &pairing.form,
                        body.pairing_help_open,
                        body.copied_command.as_deref(),
                        client,
                        pairing_input,
                        t,
                    )),
            )
        })
        .into_any_element()
}

fn pairing_form(
    form: &PairingForm,
    help_open: bool,
    copied: Option<&str>,
    client: &Entity<CoreClient>,
    input: Option<Entity<InputState>>,
    t: &Tokens,
) -> AnyElement {
    let help = client.clone();
    let submit = client.clone();
    let muted = t.muted_foreground;
    let foreground = t.foreground;
    div()
        .flex()
        .flex_col()
        .gap(px(FORM_GAP))
        .child(
            div()
                .flex()
                .flex_col()
                .child(
                    div()
                        .text_size(px(text::SM))
                        .line_height(px(text::SM_LINE))
                        .text_color(t.muted_foreground)
                        .child(form.label.clone()),
                )
                .when_some(input, |this, input| {
                    this.child(
                        div()
                            .mt(px(FIELD_LABEL_GAP))
                            .child(Input::new(&input).size(InputSize::Lg).invalid(form.invalid)),
                    )
                }),
        )
        .when_some(form.error_message.clone(), |this, message| {
            this.child(
                div()
                    .px(px(ALERT_PADDING_X))
                    .py(px(ALERT_PADDING_Y))
                    .rounded(px(radius::LG))
                    .border_1()
                    .border_color(fade(t.destructive, 0.3))
                    .bg(fade(t.destructive, 0.06))
                    .text_size(px(text::SM))
                    .line_height(px(text::SM_LINE))
                    .text_color(t.destructive_foreground)
                    .child(message),
            )
        })
        .child(
            div()
                .flex()
                .flex_col()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap(px(FOOTER_GAP))
                        .child(
                            div()
                                .id("welcome-pairing-help")
                                .flex()
                                .items_center()
                                .gap(px(HELP_GAP))
                                .cursor_pointer()
                                .text_size(px(text::SM))
                                .line_height(px(text::SM_LINE))
                                .text_color(muted)
                                .hover(move |style| style.text_color(foreground))
                                .on_click(move |_, _, cx| {
                                    act(&help, cx, "welcomeTogglePairingHelp", json!({}))
                                })
                                .child(icon(
                                    if help_open {
                                        "icons/chevron-down.svg"
                                    } else {
                                        "icons/chevron-right.svg"
                                    },
                                    HELP_ICON,
                                    muted,
                                ))
                                .child(form.help_toggle_label.clone()),
                        )
                        .child(
                            Button::new("welcome-pairing-submit")
                                .label(form.submit.label.clone())
                                .disabled(!form.submit.enabled)
                                .on_click(move |_, _, cx| {
                                    act(&submit, cx, "welcomeSubmitPairing", json!({}))
                                }),
                        ),
                )
                .when(help_open, |this| {
                    this.child(
                        div()
                            .pt(px(FORM_GAP))
                            .text_size(px(text::SM))
                            .line_height(px(text::SM_LINE))
                            .text_color(t.muted_foreground)
                            .child(form.help_text.clone()),
                    )
                    .child(div().mt(px(8.)).child(command_block(
                        "welcome-pairing-copy",
                        &form.help_command,
                        copied == Some(form.help_command.command.as_str()),
                        client,
                        t,
                    )))
                    .child(
                        div()
                            .mt(px(8.))
                            .flex()
                            .flex_wrap()
                            .text_size(px(text::XS))
                            .line_height(px(text::XS * text::LEADING_RELAXED))
                            .text_color(t.muted_foreground)
                            .children(form.help_footnote.iter().flat_map(|segment| {
                                if segment.kind == "code" {
                                    vec![
                                        div()
                                            .whitespace_nowrap()
                                            .font_family(MONO_FONT)
                                            .child(segment.text.clone()),
                                    ]
                                } else {
                                    segment
                                        .text
                                        .split_inclusive(' ')
                                        .map(|word| {
                                            div().whitespace_nowrap().child(word.to_string())
                                        })
                                        .collect()
                                }
                            })),
                    )
                }),
        )
        .into_any_element()
}
