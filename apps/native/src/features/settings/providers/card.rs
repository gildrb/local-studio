use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Bounds, Context, ElementId, Entity, FontWeight, InteractiveElement,
    IntoElement, ParentElement, Pixels, Rgba, SharedString, StatefulInteractiveElement, Styled,
    Window, canvas, div, px,
};
use serde_json::json;

use super::{
    InputMode, InputSpec, ProvidersSection, change_click, models, muted, send_change, setup, tip,
    value_handler,
};
use crate::app_core::client::CoreClient;
use crate::app_core::views::settings_providers::{
    CodexRuntimeRow, EnvironmentModel, ProviderCardIcon, ProviderEditorView, ProviderFormField,
    ProviderListRow, ProviderRuntimeView, ProviderSetupView, ProviderStatusView,
    ProviderVersionAdvisory, RedactedTextView,
};
use crate::features::chat::provider_instance_icon::{ProviderInstanceIcon, parse_accent};
use crate::features::onboarding::codex_setup::{CodexSetupHost, blurred};
use crate::features::settings::primitives::{
    FoldedHeaderPlacement, FoldedSettingsSection, SettingResetButton, SettingsControlWidth,
    SettingsRow, SettingsSection, SettingsSelect, SettingsSelectOption, settings_switch,
};
use crate::platform::MONO_FONT;
use crate::ui::badge::{Badge, BadgeSize, BadgeVariant};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::input::{Input, InputFont, InputSize};
use crate::ui::popover::{Align, PopoverPadding, PopoverPopup, PopoverWidth, Side};
use crate::ui::spinner::{Spinner, SpinnerSize};
use crate::ui::textarea::{Textarea, TextareaSize};
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const ROW_MIN_HEIGHT: f32 = 72.;
const ROW_PADDING_X: f32 = 16.;
const ROW_PADDING_Y: f32 = 12.;
const ROW_GAP: f32 = 12.;
const ICON_BOX: f32 = 20.;
const ICON_GLYPH: f32 = 16.;
const VERSION_MAX: f32 = 96.;
const ADVISORY_ICON: f32 = 14.;
const STATUS_DOT: f32 = 6.;
const STATUS_LINE: f32 = 18.;
const STATUS_DOT_BOX: f32 = 17.4;
const STATUS_GAP: f32 = 6.;
const DISABLED_ROW_OPACITY: f32 = 0.6;
const READ_ONLY_OPACITY: f32 = 0.5;
const NAME_INPUT_WIDTH: f32 = 224.;
const FIELD_WIDTH: f32 = 224.;
const TEXTAREA_WIDTH: f32 = 384.;
const RUNTIME_INPUT_WIDTH: f32 = 320.;
const ENV_NAME_WIDTH: f32 = 176.;
const ENV_ROW_GAP: f32 = 6.;
const ENV_LIST_GAP: f32 = 8.;
const ENV_LIST_TOP: f32 = 12.;
const MICRO_ICON: f32 = 12.;
const POPOVER_GAP: f32 = 12.;
const COMMAND_TEXT: f32 = 11.;
const DIVIDER_TEXT: f32 = 10.;
const BADGE_TEXT_SMALL: f32 = 10.;

pub(super) fn icon_driver_kind(icon_key: &str) -> Option<&'static str> {
    Some(match icon_key {
        "openai" => "codex",
        "claude" => "claudeAgent",
        "cursor" => "cursor",
        "grok" => "grok",
        "opencode" => "opencode",
        "antigravity" => "antigravity",
        "pi-agent" => "piAgent",
        "omp" => "omp",
        _ => return None,
    })
}

pub(super) fn instance_icon(
    icon: &ProviderCardIcon,
    icon_key: Option<&str>,
    initials: &str,
    t: &Tokens,
) -> AnyElement {
    let color = fade(t.foreground, 0.8);
    let glyph = match icon {
        ProviderCardIcon::Driver {
            driver_kind,
            accent_color,
            show_badge,
        } => ProviderInstanceIcon::new(driver_kind.clone(), initials.to_string(), color)
            .icon_size(ICON_GLYPH)
            .when(*show_badge, |icon| {
                icon.badge(accent_color.as_deref().and_then(parse_accent), t.background)
            })
            .into_any_element(),
        ProviderCardIcon::DriverOption => ProviderInstanceIcon::new(
            icon_key.and_then(icon_driver_kind).unwrap_or_default(),
            initials.to_string(),
            color,
        )
        .icon_size(ICON_GLYPH)
        .into_any_element(),
        ProviderCardIcon::Initials { initials } => div()
            .text_size(px(BADGE_TEXT_SMALL))
            .line_height(px(BADGE_TEXT_SMALL))
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(color)
            .child(initials.clone())
            .into_any_element(),
    };
    div()
        .size(px(ICON_BOX))
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .child(glyph)
        .into_any_element()
}

fn status_color(key: &str, t: &Tokens) -> Rgba {
    match key {
        "error" => t.destructive,
        "ready" => t.success,
        "warning" => t.warning,
        _ => fade(t.muted_foreground, 0.5),
    }
}

fn status_dot(status: &ProviderStatusView, t: &Tokens) -> Option<AnyElement> {
    status.needs_attention.then(|| {
        div()
            .size(px(STATUS_DOT))
            .flex_none()
            .rounded_full()
            .bg(status_color(&status.key, t))
            .into_any_element()
    })
}

fn advisory_icon(advisory: &ProviderVersionAdvisory) -> &'static str {
    if advisory.icon == "alert-triangle" {
        "triangle-alert"
    } else {
        "circle-arrow-up"
    }
}

fn icon(path: &str, size: f32, color: Rgba) -> AnyElement {
    gpui::svg()
        .path(SharedString::from(format!("icons/{path}.svg")))
        .size(px(size))
        .flex_none()
        .text_color(color)
        .into_any_element()
}

pub(super) fn list_row(
    row: &ProviderListRow,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    let group = SharedString::from(format!("provider-row-{}", row.id));
    let dimmed = !row.enabled && !row.selected;
    let advisory = row.version_advisory.as_ref().map(|advisory| {
        let id = format!("provider-row-advisory-{}", row.id);
        match (advisory.list_indicator.as_str(), &advisory.update_command) {
            ("compatibility", _) => tip(
                id,
                advisory.detail.clone(),
                icon(advisory_icon(advisory), ADVISORY_ICON, t.warning),
            ),
            ("copyCommand", Some(_)) => tip(
                id,
                advisory.list_copy_command_tooltip.clone(),
                Button::new(SharedString::from(format!("provider-row-copy-{}", row.id)))
                    .size(ButtonSize::IconMicro)
                    .variant(ButtonVariant::GhostMuted)
                    .icon("circle-arrow-up")
                    .icon_size(ADVISORY_ICON)
                    .accessibility_label(advisory.list_copy_command_aria_label.clone())
                    .on_click({
                        let client = client.clone();
                        let instance_id = row.id.clone();
                        move |_, _, cx| {
                            cx.stop_propagation();
                            send_change(
                                &client,
                                cx,
                                json!({ "kind": "copy-update-command", "instanceId": instance_id }),
                            );
                        }
                    }),
            ),
            _ => icon("circle-arrow-up", ADVISORY_ICON, t.muted_foreground),
        }
    });
    let status_text = match &row.status.list_detail {
        Some(detail) => format!("{} · {}", row.status.headline, detail),
        None => row.status.headline.clone(),
    };
    let status_body = div()
        .min_w_0()
        .line_clamp(2)
        .whitespace_normal()
        .child(status_text);
    let status_body = match &row.status.diagnostic {
        Some(diagnostic) => div()
            .id(SharedString::from(format!(
                "provider-row-diagnostic-{}",
                row.id
            )))
            .min_w_0()
            .tooltip(Tooltip::text(SharedString::from(diagnostic.clone())))
            .child(status_body)
            .into_any_element(),
        None => status_body.into_any_element(),
    };
    let switch_client = client.clone();
    let switch_id = row.id.clone();
    div()
        .id(SharedString::from(format!("provider-row-{}", row.id)))
        .group(group.clone())
        .flex()
        .items_center()
        .gap(px(ROW_GAP))
        .min_h(px(ROW_MIN_HEIGHT))
        .px(px(ROW_PADDING_X))
        .py(px(ROW_PADDING_Y))
        .map(|this| {
            if row.selected {
                this.bg(fade(t.muted, 0.45))
            } else {
                let hover = fade(t.muted, 0.25);
                this.hover(move |style| style.bg(hover))
            }
        })
        .child(
            div()
                .id(SharedString::from(format!(
                    "provider-row-select-{}",
                    row.id
                )))
                .relative()
                .flex()
                .flex_1()
                .min_w_0()
                .items_start()
                .gap(px(ROW_GAP))
                .cursor_pointer()
                .rounded(px(radius::SM))
                .when(dimmed, |this| {
                    this.opacity(DISABLED_ROW_OPACITY)
                        .group_hover(group.clone(), |style| style.opacity(1.))
                })
                .on_click(change_click(
                    client,
                    json!({ "kind": "select-instance", "instanceId": row.id }),
                ))
                .child(instance_icon(
                    &row.icon,
                    row.icon_key.as_deref(),
                    &row.initials,
                    t,
                ))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .child(
                            div()
                                .flex()
                                .min_w_0()
                                .items_center()
                                .gap(px(8.))
                                .child(
                                    div()
                                        .min_w_0()
                                        .truncate()
                                        .text_size(px(text::SM))
                                        .line_height(px(text::SM_LINE))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(t.foreground)
                                        .child(row.display_name.clone()),
                                )
                                .children(row.version_label.clone().map(|label| {
                                    div()
                                        .flex_none()
                                        .max_w(px(VERSION_MAX))
                                        .truncate()
                                        .font_family(MONO_FONT)
                                        .text_size(px(text::XS))
                                        .line_height(px(text::XS_LINE))
                                        .text_color(t.muted_foreground)
                                        .child(label)
                                }))
                                .children(advisory),
                        )
                        .child(
                            div()
                                .mt(px(2.))
                                .flex()
                                .items_start()
                                .gap(px(STATUS_GAP))
                                .text_size(px(text::XS))
                                .line_height(px(STATUS_LINE))
                                .text_color(fade(t.muted_foreground, 0.8))
                                .children(status_dot(&row.status, t).map(|dot| {
                                    div()
                                        .flex()
                                        .flex_none()
                                        .h(px(STATUS_DOT_BOX))
                                        .items_center()
                                        .child(dot)
                                }))
                                .child(status_body),
                        ),
                ),
        )
        .child(
            div()
                .flex()
                .flex_none()
                .h(px(ICON_BOX))
                .items_center()
                .child(
                    settings_switch(
                        SharedString::from(format!("provider-row-switch-{}", row.id)),
                        row.enable_switch.checked,
                    )
                    .disabled(row.enable_switch.disabled)
                    .accessibility_label(row.enable_switch.aria_label.clone())
                    .on_change(move |checked, _, _, cx| {
                        send_change(
                            &switch_client,
                            cx,
                            json!({
                                "kind": "card",
                                "instanceId": switch_id,
                                "action": { "kind": "setEnabled", "value": checked },
                            }),
                        )
                    }),
                ),
        )
        .into_any_element()
}

pub(super) fn redacted_text(
    id: SharedString,
    model: &RedactedTextView,
    on_toggle: impl Fn(&mut App) + 'static,
    t: &Tokens,
) -> AnyElement {
    let foreground = t.foreground;
    div()
        .id(id)
        .min_w_0()
        .cursor_pointer()
        .rounded(px(radius::SM))
        .font_family(MONO_FONT)
        .text_size(px(COMMAND_TEXT))
        .line_height(px(COMMAND_TEXT * text::LEADING_NORMAL))
        .text_color(t.muted_foreground)
        .hover(move |style| style.text_color(foreground))
        .tooltip(Tooltip::text(SharedString::from(model.tooltip.clone())))
        .on_click(move |_, _, cx| on_toggle(cx))
        .child(if model.revealed {
            div()
                .truncate()
                .child(model.text.clone())
                .into_any_element()
        } else {
            blurred(&model.text, t.muted_foreground)
        })
        .into_any_element()
}

fn editor_status(
    editor: &ProviderEditorView,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    let status = &editor.card.status;
    let dot = status_dot(status, t);
    let detail = status.inline_detail.clone().map(|detail| {
        div()
            .min_w_0()
            .whitespace_normal()
            .child(format!("· {detail}"))
    });
    let line = div()
        .flex()
        .flex_wrap()
        .min_w_0()
        .items_baseline()
        .gap_x(px(STATUS_GAP));
    let line = match (&status.authenticated_as, &editor.email) {
        (Some(authenticated), Some(email)) => {
            let toggle_client = client.clone();
            let instance_id = editor.instance_id.clone();
            line.children(dot)
                .child("Authenticated as")
                .child(redacted_text(
                    SharedString::from(format!("provider-email-{}", editor.instance_id)),
                    email,
                    move |cx| {
                        send_change(
                            &toggle_client,
                            cx,
                            json!({ "kind": "toggle-email", "instanceId": instance_id }),
                        )
                    },
                    t,
                ))
                .children(
                    authenticated
                        .auth_label
                        .clone()
                        .map(|label| div().child(format!("· {label}"))),
                )
                .children(detail)
        }
        _ => line
            .children(dot.map(|dot| div().flex().items_center().h(px(text::XS_LINE)).child(dot)))
            .child(status.headline.clone())
            .children(detail),
    };
    match &status.diagnostic {
        Some(diagnostic) => div()
            .id(SharedString::from(format!(
                "provider-status-{}",
                editor.instance_id
            )))
            .tooltip(Tooltip::text(SharedString::from(diagnostic.clone())))
            .child(line)
            .into_any_element(),
        None => line.into_any_element(),
    }
}

struct AdvisoryState {
    open: bool,
    bounds: Bounds<Pixels>,
}

fn advisory_popover(
    editor: &ProviderEditorView,
    advisory: &ProviderVersionAdvisory,
    client: &Entity<CoreClient>,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let t = theme::active(cx);
    let id = SharedString::from(format!("provider-advisory-{}", editor.instance_id));
    let state = window.use_keyed_state(ElementId::Name(id.clone()), cx, |_, _| AdvisoryState {
        open: false,
        bounds: Bounds::default(),
    });
    let (open, bounds) = {
        let current = state.read(cx);
        (current.open, current.bounds)
    };
    let toggle = state.clone();
    let measure = state.clone();
    let trigger = Button::new(ElementId::Name(SharedString::from(format!("{id}-trigger"))))
        .size(ButtonSize::IconXs)
        .variant(ButtonVariant::GhostMuted)
        .icon(advisory_icon(advisory))
        .when(advisory.compatibility_warning, |button| {
            button.icon_color(t.warning)
        })
        .pressed(open)
        .accessibility_label(advisory.details_aria_label.clone())
        .on_click(move |_, _, cx| {
            cx.stop_propagation();
            toggle.update(cx, |state, cx| {
                state.open = !state.open;
                cx.notify();
            });
        });
    let popup = open.then(|| {
        let close = state.clone();
        let action = advisory
            .action
            .as_ref()
            .filter(|_| editor.can_run_version_action)
            .map(|action| {
                let kind = if action.kind == "installRecommended" {
                    "install-recommended"
                } else {
                    "run-update"
                };
                Button::new(ElementId::Name(SharedString::from(format!("{id}-action"))))
                    .size(ButtonSize::Xs)
                    .variant(ButtonVariant::Outline)
                    .w_full()
                    .disabled(action.disabled)
                    .when(!action.busy, |button| button.icon("download"))
                    .when(action.busy, |button| {
                        button.child(
                            Spinner::new(ElementId::Name(SharedString::from(format!(
                                "{id}-spinner"
                            ))))
                            .size(SpinnerSize::Xs),
                        )
                    })
                    .label(action.label.clone())
                    .on_click(change_click(
                        client,
                        json!({ "kind": kind, "instanceId": editor.instance_id }),
                    ))
            });
        let divider = advisory.manual_update_divider_label.clone().filter(|_| action.is_some()).map(|label| {
            let line = || div().h(px(1.)).flex_1().bg(t.border);
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .text_size(px(DIVIDER_TEXT))
                .line_height(px(DIVIDER_TEXT * 1.5))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.muted_foreground)
                .child(line())
                .child(label.to_uppercase())
                .child(line())
        });
        let command = advisory.update_command.clone().map(|command| {
            div()
                .flex()
                .min_w_0()
                .items_center()
                .gap(px(4.))
                .rounded(px(radius::SM))
                .border_1()
                .border_color(fade(t.border, 0.7))
                .bg(fade(t.muted, 0.4))
                .py(px(2.))
                .pr(px(2.))
                .pl(px(8.))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .font_family(MONO_FONT)
                        .text_size(px(COMMAND_TEXT))
                        .text_color(t.foreground)
                        .child(command),
                )
                .child(tip(
                    format!("{id}-copy-tip"),
                    advisory.copy_command_tooltip.clone(),
                    Button::new(ElementId::Name(SharedString::from(format!("{id}-copy"))))
                        .size(ButtonSize::IconXs)
                        .variant(ButtonVariant::GhostMuted)
                        .icon("copy")
                        .icon_size(MICRO_ICON)
                        .accessibility_label(advisory.copy_command_aria_label.clone())
                        .on_click(change_click(
                            client,
                            json!({ "kind": "copy-update-command", "instanceId": editor.instance_id }),
                        )),
                ))
        });
        PopoverPopup::new(ElementId::Name(SharedString::from(format!("{id}-popup"))), bounds)
            .side(Side::Bottom)
            .align(Align::End)
            .width(PopoverWidth::Md)
            .padding(PopoverPadding::Default)
            .on_dismiss(move |_, cx| {
                close.update(cx, |state, cx| {
                    state.open = false;
                    cx.notify();
                })
            })
            .child(
                div()
                    .flex()
                    .flex_col()
                    .min_w_0()
                    .gap(px(POPOVER_GAP))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(2.))
                            .child(
                                div()
                                    .text_size(px(text::SM))
                                    .line_height(px(text::SM * text::LEADING_TIGHT))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(t.foreground)
                                    .child(advisory.title.clone()),
                            )
                            .child(
                                div()
                                    .text_size(px(text::XS))
                                    .line_height(px(text::XS * text::LEADING_SNUG))
                                    .text_color(if advisory.emphasis == "strong" {
                                        t.warning
                                    } else {
                                        t.muted_foreground
                                    })
                                    .child(advisory.detail.clone()),
                            ),
                    )
                    .children(action)
                    .children(divider)
                    .children(command),
            )
    });
    div()
        .id(ElementId::Name(SharedString::from(format!("{id}-tip"))))
        .relative()
        .flex()
        .when(!open, |this| {
            this.tooltip(Tooltip::text(SharedString::from(advisory.title.clone())))
        })
        .child(trigger)
        .child(
            canvas(
                move |bounds, _, cx| measure.update(cx, |state, _| state.bounds = bounds),
                |_, _, _, _| {},
            )
            .absolute()
            .top_0()
            .left_0()
            .size_full(),
        )
        .children(popup)
        .into_any_element()
}

fn header_actions(
    editor: &ProviderEditorView,
    read_only: bool,
    client: &Entity<CoreClient>,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let t = theme::active(cx);
    let card = &editor.card;
    let reset = editor.reset_label.clone().map(|label| {
        let reset_client = client.clone();
        let instance_id = editor.instance_id.clone();
        div()
            .size(px(ICON_BOX))
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .child(
                SettingResetButton::new(
                    SharedString::from(format!("provider-reset-{}", editor.instance_id)),
                    label,
                )
                .disabled(read_only)
                .on_click(move |_, cx| {
                    send_change(
                        &reset_client,
                        cx,
                        json!({ "kind": "reset-default-instance", "instanceId": instance_id }),
                    )
                }),
            )
    });
    let delete = card.delete_action.as_ref().map(|delete| {
        Button::new(SharedString::from(format!(
            "provider-delete-{}",
            editor.instance_id
        )))
        .size(ButtonSize::IconXs)
        .variant(ButtonVariant::GhostDestructive)
        .icon("settings/trash-2")
        .disabled(delete.disabled)
        .accessibility_label(delete.aria_label.clone())
        .on_click(change_click(
            client,
            json!({ "kind": "remove-instance", "instanceId": editor.instance_id }),
        ))
    });
    let advisory = card
        .version_advisory
        .as_ref()
        .map(|advisory| advisory_popover(editor, advisory, client, window, cx));
    div()
        .flex()
        .flex_none()
        .items_center()
        .gap(px(6.))
        .children(card.badge_label.clone().map(|label| {
            Badge::new()
                .variant(BadgeVariant::Warning)
                .size(BadgeSize::Sm)
                .label(label)
        }))
        .children(card.version_label.clone().map(|label| {
            div()
                .font_family(MONO_FONT)
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .text_color(t.muted_foreground)
                .child(label)
        }))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(4.))
                .when(read_only, |this| this.opacity(READ_ONLY_OPACITY))
                .children(advisory.filter(|_| !read_only))
                .children(reset)
                .children(delete),
        )
        .into_any_element()
}

fn form_field_row(
    section: &mut ProvidersSection,
    instance_id: &str,
    field: &ProviderFormField,
    read_only: bool,
    window: &mut Window,
    cx: &mut Context<ProvidersSection>,
) -> AnyElement {
    let client = section.client.clone();
    let send = {
        let client = client.clone();
        let instance_id = instance_id.to_string();
        let key = field.key.clone();
        move |kind: &'static str, value: serde_json::Value, cx: &mut App| {
            send_change(
                &client,
                cx,
                json!({
                    "kind": "card",
                    "instanceId": instance_id,
                    "action": {
                        "kind": "setConfigField",
                        "key": key,
                        "change": { "kind": kind, "value": value },
                    },
                }),
            )
        }
    };
    let control = match field.control.as_str() {
        "switch" => settings_switch(SharedString::from(field.input_id.clone()), field.checked)
            .disabled(read_only)
            .accessibility_label(field.label.clone())
            .on_change(move |checked, _, _, cx| send("switch", json!(checked), cx))
            .into_any_element(),
        "select" => SettingsSelect::new(SharedString::from(field.input_id.clone()))
            .options(field.options.iter().flatten().map(|option| {
                SettingsSelectOption::new(option.value.clone(), option.label.clone())
            }))
            .value(Some(field.text_value.clone()))
            .value_label(field.selected_label.clone())
            .width(SettingsControlWidth::Fixed(FIELD_WIDTH))
            .disabled(read_only)
            .accessibility_label(field.label.clone())
            .on_change(move |value, _, cx| send("select", json!(value.to_string()), cx))
            .into_any_element(),
        "textarea" => {
            let send = Rc::new(send);
            let state = section.textarea(
                format!("form:{instance_id}:{}", field.key),
                &field.text_value,
                field.placeholder.as_deref().unwrap_or_default(),
                Rc::new(move |value, cx| send("text", json!(value), cx)),
                window,
                cx,
            );
            div()
                .w(px(TEXTAREA_WIDTH))
                .max_w_full()
                .child(
                    Textarea::new(&state)
                        .size(TextareaSize::Sm)
                        .disabled(read_only)
                        .items_start(),
                )
                .into_any_element()
        }
        _ => {
            let send = Rc::new(send);
            let state = section.input(
                InputSpec {
                    key: format!("form:{instance_id}:{}", field.key),
                    value: field.text_value.clone(),
                    placeholder: field.placeholder.clone().unwrap_or_default(),
                    masked: field.sensitive,
                    mode: InputMode::Draft,
                    on_value: Rc::new(move |value, cx| send("text", json!(value), cx)),
                    on_enter: None,
                    on_blur: None,
                },
                window,
                cx,
            );
            div()
                .w(px(FIELD_WIDTH))
                .max_w_full()
                .child(Input::new(&state).size(InputSize::Sm).disabled(read_only))
                .into_any_element()
        }
    };
    SettingsRow::new(field.input_id.clone(), field.label.clone())
        .when_some(field.description.clone(), |row, description| {
            row.description(description)
        })
        .control(control)
        .into_any_element()
}

fn runtime_row(
    section: &mut ProvidersSection,
    instance_id: &str,
    row: &CodexRuntimeRow,
    window: &mut Window,
    cx: &mut Context<ProvidersSection>,
) -> AnyElement {
    let state = section.input(
        InputSpec {
            key: format!("codex-runtime:{instance_id}:{}", row.id),
            value: row.value.clone(),
            placeholder: row.placeholder.clone(),
            masked: false,
            mode: InputMode::Live,
            on_value: Rc::new(|_, _| {}),
            on_enter: None,
            on_blur: None,
        },
        window,
        cx,
    );
    let input = div().w(px(RUNTIME_INPUT_WIDTH)).max_w_full().child(
        Input::new(&state)
            .size(InputSize::Default)
            .disabled(row.disabled),
    );
    let control = match &row.tooltip {
        Some(tooltip) if !tooltip.is_empty() => tip(
            format!("codex-runtime-tip-{}", row.id),
            tooltip.clone(),
            input,
        ),
        _ => input.into_any_element(),
    };
    SettingsRow::new(format!("codex-runtime-{}", row.id), row.title.clone())
        .description(row.description.clone())
        .control(control)
        .into_any_element()
}

fn runtime_rows(
    section: &mut ProvidersSection,
    editor: &ProviderEditorView,
    read_only: bool,
    window: &mut Window,
    cx: &mut Context<ProvidersSection>,
) -> Vec<AnyElement> {
    let t = theme::active(cx);
    match &editor.runtime {
        ProviderRuntimeView::CodexManaged { rows } => rows
            .iter()
            .map(|row| runtime_row(section, &editor.instance_id, row, window, cx))
            .collect(),
        ProviderRuntimeView::Form { fields } => fields
            .iter()
            .map(|field| form_field_row(section, &editor.instance_id, field, read_only, window, cx))
            .collect(),
        ProviderRuntimeView::UnknownDriver {
            title,
            description_prefix,
            driver,
            description_suffix,
        } => vec![
            SettingsRow::new(
                format!("provider-driver-{}", editor.instance_id),
                title.clone(),
            )
            .description_element(
                div()
                    .text_size(px(text::XS))
                    .line_height(px(18.))
                    .text_color(fade(t.muted_foreground, 0.8))
                    .child(description_prefix.clone())
                    .child(
                        div()
                            .font_family(MONO_FONT)
                            .text_color(t.foreground)
                            .child(driver.clone()),
                    )
                    .child(description_suffix.clone()),
            )
            .into_any_element(),
        ],
        ProviderRuntimeView::None => Vec::new(),
    }
}

fn environment_rows(
    section: &mut ProvidersSection,
    instance_id: &str,
    model: &EnvironmentModel,
    read_only: bool,
    window: &mut Window,
    cx: &mut Context<ProvidersSection>,
) -> AnyElement {
    let t = theme::active(cx);
    let client = section.client.clone();
    let instance = instance_id.to_string();
    let rows: Vec<AnyElement> = model
        .rows
        .iter()
        .map(|variable| {
            let name_instance = instance.clone();
            let name_id = variable.id.clone();
            let name = section.input(
                InputSpec {
                    key: format!("env-name:{instance}:{}", variable.id),
                    value: variable.name.clone(),
                    placeholder: variable.name_placeholder.clone(),
                    masked: false,
                    mode: InputMode::Draft,
                    on_value: value_handler(&client, move |name| {
                        (
                            "settingsProvidersEnvironment",
                            json!({
                                "instanceId": name_instance,
                                "change": { "kind": "setName", "id": name_id, "name": name },
                            }),
                        )
                    }),
                    on_enter: None,
                    on_blur: None,
                },
                window,
                cx,
            );
            let value_instance = instance.clone();
            let value_id = variable.id.clone();
            let value = section.input(
                InputSpec {
                    key: format!(
                        "env-value:{instance}:{}:{}",
                        variable.id, variable.sensitive
                    ),
                    value: variable.value.clone(),
                    placeholder: variable.value_placeholder.clone(),
                    masked: variable.sensitive,
                    mode: InputMode::Draft,
                    on_value: value_handler(&client, move |value| {
                        (
                            "settingsProvidersEnvironment",
                            json!({
                                "instanceId": value_instance,
                                "change": { "kind": "setValue", "id": value_id, "value": value },
                            }),
                        )
                    }),
                    on_enter: None,
                    on_blur: None,
                },
                window,
                cx,
            );
            let toggle = super::click(
                &client,
                "settingsProvidersEnvironment",
                json!({
                    "instanceId": instance,
                    "change": { "kind": "toggleSensitive", "id": variable.id },
                }),
            );
            let remove = super::click(
                &client,
                "settingsProvidersEnvironment",
                json!({
                    "instanceId": instance,
                    "change": { "kind": "remove", "id": variable.id },
                }),
            );
            div()
                .flex()
                .flex_wrap()
                .min_w_0()
                .items_center()
                .gap(px(ENV_ROW_GAP))
                .child(
                    div().w(px(ENV_NAME_WIDTH)).flex_none().child(
                        Input::new(&name)
                            .size(InputSize::Sm)
                            .font(InputFont::Mono)
                            .disabled(read_only),
                    ),
                )
                .child(muted("=", &t))
                .child(
                    div().flex_1().min_w_0().child(
                        Input::new(&value)
                            .size(InputSize::Sm)
                            .font(InputFont::Mono)
                            .disabled(read_only),
                    ),
                )
                .child(tip(
                    format!("env-lock-tip-{}", variable.id),
                    variable.sensitivity_tooltip.clone(),
                    Button::new(SharedString::from(format!("env-lock-{}", variable.id)))
                        .size(ButtonSize::IconMicro)
                        .variant(ButtonVariant::GhostMuted)
                        .icon(if variable.sensitive {
                            "lock"
                        } else {
                            "lock-open"
                        })
                        .icon_size(MICRO_ICON)
                        .pressed(variable.sensitive)
                        .disabled(read_only)
                        .on_click(toggle),
                ))
                .child(
                    Button::new(SharedString::from(format!("env-remove-{}", variable.id)))
                        .size(ButtonSize::IconMicro)
                        .variant(ButtonVariant::GhostDestructive)
                        .icon("x")
                        .icon_size(MICRO_ICON)
                        .disabled(read_only)
                        .on_click(remove),
                )
                .into_any_element()
        })
        .collect();
    let has_rows = !rows.is_empty();
    SettingsRow::new(format!("provider-env-{instance}"), model.title.clone())
        .description(model.description.clone())
        .control(
            Button::new(SharedString::from(format!("env-add-{instance}")))
                .size(ButtonSize::Sm)
                .variant(ButtonVariant::Outline)
                .icon("plus")
                .icon_size(MICRO_ICON)
                .label(model.add_label.clone())
                .disabled(read_only)
                .on_click(super::click(
                    &client,
                    "settingsProvidersEnvironment",
                    json!({ "instanceId": instance, "change": { "kind": "add" } }),
                )),
        )
        .when(has_rows, |row| {
            row.child(
                div()
                    .mt(px(ENV_LIST_TOP))
                    .pb(px(ENV_LIST_GAP))
                    .flex()
                    .flex_col()
                    .min_w_0()
                    .gap(px(ENV_LIST_GAP))
                    .children(rows)
                    .children(model.footnote.clone().map(|note| muted(note, &t))),
            )
        })
        .into_any_element()
}

pub(super) fn editor(
    section: &mut ProvidersSection,
    editor: &ProviderEditorView,
    read_only: bool,
    window: &mut Window,
    cx: &mut Context<ProvidersSection>,
) -> AnyElement {
    let t = theme::active(cx);
    let client = section.client.clone();
    let card = &editor.card;
    let name_instance = editor.instance_id.clone();
    let name = section.input(
        InputSpec {
            key: format!("display-name:{}", editor.instance_id),
            value: card.display_name_row.value.clone(),
            placeholder: card.display_name_row.placeholder.clone(),
            masked: false,
            mode: InputMode::Draft,
            on_value: value_handler(&client, move |value| {
                (
                    super::CHANGE,
                    json!({ "change": {
                        "kind": "card",
                        "instanceId": name_instance,
                        "action": { "kind": "setDisplayName", "value": value },
                    } }),
                )
            }),
            on_enter: None,
            on_blur: None,
        },
        window,
        cx,
    );
    let accent = super::accent::trigger(
        section,
        format!("instance:{}", editor.instance_id),
        &editor.accent,
        read_only,
        cx,
    );
    let identity = SettingsSection::new(card.display_name.clone())
        .icon(instance_icon(
            &card.icon,
            editor.icon_key.as_deref(),
            &editor.initials,
            &t,
        ))
        .header_action(header_actions(editor, read_only, &client, window, cx))
        .child(
            SettingsRow::new(
                card.display_name_row.input_id.clone(),
                card.display_name_row.title.clone(),
            )
            .status(editor_status(editor, &client, &t))
            .control(
                div()
                    .flex()
                    .w_full()
                    .min_w_0()
                    .items_center()
                    .justify_end()
                    .gap(px(8.))
                    .when(read_only, |this| this.opacity(READ_ONLY_OPACITY))
                    .child(accent)
                    .child(
                        div()
                            .w(px(NAME_INPUT_WIDTH))
                            .min_w_0()
                            .child(Input::new(&name).size(InputSize::Sm).disabled(read_only)),
                    ),
            ),
        );
    let setup = editor.setup.as_ref().map(|setup_view| {
        let children: Vec<AnyElement> = match setup_view {
            ProviderSetupView::Antigravity {
                section: model,
                actions,
                callback_revision,
            } => setup::antigravity(
                section,
                &editor.instance_id,
                model,
                actions.as_deref(),
                *callback_revision,
                window,
                cx,
            ),
            ProviderSetupView::Codex { key } => CodexSetupHost::settings_section(key, cx)
                .into_iter()
                .collect(),
        };
        SettingsSection::new(card.setup_section_title.clone()).children(children)
    });
    let runtime_children = runtime_rows(section, editor, read_only, window, cx);
    let runtime = if card.runtime_section.layout == "folded" {
        div()
            .when(read_only, |this| this.opacity(READ_ONLY_OPACITY))
            .child(
                FoldedSettingsSection::new(
                    card.runtime_section.folded_id.clone(),
                    card.runtime_section.title.clone(),
                )
                .header_placement(FoldedHeaderPlacement::Outside)
                .children(runtime_children),
            )
            .into_any_element()
    } else {
        div()
            .when(read_only, |this| this.opacity(READ_ONLY_OPACITY))
            .child(
                SettingsSection::new(card.runtime_section.title.clone()).children(runtime_children),
            )
            .into_any_element()
    };
    let environment = div()
        .when(read_only, |this| this.opacity(READ_ONLY_OPACITY))
        .child(
            SettingsSection::new(card.environment_section_title.clone()).child(environment_rows(
                section,
                &editor.instance_id,
                &editor.environment,
                read_only,
                window,
                cx,
            )),
        );
    let models = editor.models.as_ref().map(|model| {
        div()
            .when(read_only, |this| this.opacity(READ_ONLY_OPACITY))
            .child(
                SettingsSection::new(model.title.clone()).child(models::section(
                    section,
                    &editor.instance_id,
                    model,
                    read_only,
                    window,
                    cx,
                )),
            )
    });
    div()
        .flex()
        .flex_col()
        .gap(px(super::EDITOR_GAP))
        .child(identity)
        .children(setup)
        .child(runtime)
        .child(environment)
        .children(models)
        .into_any_element()
}
