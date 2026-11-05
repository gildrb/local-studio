use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, BoxShadow, Context, Entity, FontWeight, Global,
    InteractiveElement, IntoElement, ParentElement, Render, Rgba, SharedString,
    StatefulInteractiveElement, Styled, Window, div, px,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::device::{DeviceSetupDialogView, SetupSwitch};
use crate::features::chat::toolbar_parts::act;
use crate::features::device::parts::{host_updates, platform_status, setup_status, xs_muted};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::dialog::{
    DialogDescription, DialogFooter, DialogFooterVariant, DialogHeader, DialogPopup, DialogTitle,
};
use crate::ui::menu::icon;
use crate::ui::popover::{black, dark, shadow, white};
use crate::ui::spinner::{Spinner, SpinnerSize};
use crate::ui::switch::Switch;
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};

const WIZARD_MAX_WIDTH: f32 = 576.;
const STEP_CIRCLE: f32 = 20.;
const TITLE: &str = "Set up devices";
const DESCRIPTION: &str =
    "Review what runs on this environment before using simulators and emulators.";
const PLATFORM_HINT: &str =
    "You can use either platform. Fixing a missing platform does not block the other one.";
const AGENT_HINT: &str =
    "Leave this off to keep manual device controls without giving agents access.";

pub struct DeviceSetupHostHandle(pub Entity<DeviceSetupHost>);

impl Global for DeviceSetupHostHandle {}

pub struct DeviceSetupHost {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<DeviceSetupDialogView>>>,
}

impl DeviceSetupHost {
    pub fn install(client: &Entity<CoreClient>, cx: &mut App) {
        if cx.has_global::<DeviceSetupHostHandle>() {
            return;
        }
        let host = cx.new(|cx| Self::new(client.clone(), cx));
        cx.set_global(DeviceSetupHostHandle(host));
    }

    pub fn global(cx: &App) -> Option<Entity<DeviceSetupHost>> {
        cx.try_global::<DeviceSetupHostHandle>()
            .map(|handle| handle.0.clone())
    }

    fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<DeviceSetupDialogView>>(
            &client,
            "deviceSetup",
            json!({}),
            cx,
        );
        cx.observe(&view, |_, _, cx| cx.notify()).detach();
        Self { client, view }
    }
}

fn ring(color: Rgba) -> BoxShadow {
    shadow(0., 0., 0., 1., color)
}

fn on_click(
    client: &Entity<CoreClient>,
    action: &'static str,
    params: Value,
) -> impl Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static {
    let client = client.clone();
    move |_, _, cx| act(&client, cx, action, params.clone())
}

fn steps(view: &DeviceSetupDialogView, client: &Entity<CoreClient>, t: &Tokens) -> AnyElement {
    let (strip_bg, strip_ring) = if dark(t) {
        (white(0.04), white(0.05))
    } else {
        (t.background, black(0.05))
    };
    let current = view.step;
    let items = view.steps.iter().enumerate().map(|(index, step)| {
        let is_current = index == current;
        let done = index < current;
        let (circle_bg, circle_fg, circle_ring) = if done {
            (t.primary, t.primary_foreground, t.primary)
        } else if is_current {
            (fade(t.primary, 0.1), t.primary, fade(t.primary, 0.3))
        } else if dark(t) {
            (white(0.05), t.muted_foreground, white(0.1))
        } else {
            (t.card, t.muted_foreground, black(0.1))
        };
        let hover_bg = t.card;
        div()
            .id(("device-setup-step", index))
            .flex()
            .flex_1()
            .min_w_0()
            .items_center()
            .gap(px(8.))
            .px(px(10.))
            .py(px(8.))
            .rounded(px(radius::LG))
            .when(is_current, |this| {
                this.bg(t.card).shadow(vec![
                    ring(if dark(t) { white(0.05) } else { black(0.05) }),
                    shadow(0., 1., 2., 0., black(if dark(t) { 0. } else { 0.05 })),
                ])
            })
            .when(!step.disabled, |this| {
                this.cursor_pointer()
                    .hover(move |s| s.bg(hover_bg))
                    .on_click(on_click(
                        client,
                        "deviceSetupStep",
                        json!({ "step": index }),
                    ))
            })
            .child(
                div()
                    .flex()
                    .flex_none()
                    .size(px(STEP_CIRCLE))
                    .items_center()
                    .justify_center()
                    .rounded_full()
                    .bg(circle_bg)
                    .shadow(vec![ring(circle_ring)])
                    .text_color(circle_fg)
                    .text_size(px(text::SM))
                    .font_weight(FontWeight::MEDIUM)
                    .map(|this| {
                        if done {
                            this.child(icon("check", 16., circle_fg))
                        } else {
                            this.child(SharedString::from((index + 1).to_string()))
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
                    .text_color(if is_current {
                        t.foreground
                    } else {
                        t.muted_foreground
                    })
                    .child(step.label.clone()),
            )
    });
    div()
        .flex()
        .gap(px(4.))
        .p(px(4.))
        .rounded(px(radius::XL))
        .bg(strip_bg)
        .shadow(vec![ring(strip_ring)])
        .children(items)
        .into_any_element()
}

fn heading(label: &'static str, t: &Tokens) -> gpui::Div {
    div()
        .text_size(px(text::SM))
        .line_height(px(text::SM_LINE))
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.foreground)
        .child(label)
}

fn section(t: &Tokens) -> gpui::Div {
    div()
        .flex()
        .flex_col()
        .gap(px(12.))
        .text_size(px(text::SM))
        .line_height(px(text::SM_LINE))
        .text_color(t.foreground)
}

fn switch_row(
    id: &'static str,
    label: &'static str,
    model: &SetupSwitch,
    action: &'static str,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> gpui::Div {
    let client = client.clone();
    div()
        .flex()
        .items_start()
        .justify_between()
        .gap(px(16.))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .text_color(t.muted_foreground)
                .child(model.description.clone()),
        )
        .child(
            Switch::new(id)
                .checked(model.enabled)
                .disabled(model.disabled)
                .accessibility_label(label)
                .on_change(move |checked, _, _, cx| {
                    act(&client, cx, action, json!({ "enabled": checked }))
                }),
        )
}

fn body(view: &DeviceSetupDialogView, client: &Entity<CoreClient>, t: &Tokens) -> gpui::Div {
    match view.step {
        0 => section(t)
            .child(heading("Enable the device hub", t))
            .child(switch_row(
                "device-setup-hub",
                "Enable device hub",
                &view.hub,
                "deviceSetupHub",
                client,
                t,
            ))
            .children(
                view.hub
                    .status
                    .as_ref()
                    .map(|status| setup_status("device-setup-hub-status", status, t)),
            ),
        1 => {
            let check = Button::new("device-setup-check")
                .size(ButtonSize::Compact)
                .variant(ButtonVariant::Outline)
                .disabled(view.check.disabled)
                .when(view.check.checking, |this| {
                    this.child(Spinner::new("device-setup-check-spinner").size(SpinnerSize::Xs))
                })
                .label(if view.check.checking {
                    "Checking…"
                } else {
                    "Check again"
                })
                .on_click(on_click(client, "deviceSetupCheck", json!({})));
            section(t)
                .child(heading("Check simulator support", t))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .items_start()
                        .gap(px(12.))
                        .children(
                            view.platforms
                                .iter()
                                .map(|status| div().w_full().child(platform_status(status, t))),
                        )
                        .child(xs_muted(t, PLATFORM_HINT))
                        .child(check),
                )
        }
        _ => section(t)
            .child(heading("Allow agent control", t))
            .child(switch_row(
                "device-setup-agent",
                "Allow agents to control devices",
                &view.agent,
                "deviceSetupAgent",
                client,
                t,
            ))
            .children(
                view.agent
                    .status
                    .as_ref()
                    .map(|status| setup_status("device-setup-agent-status", status, t)),
            )
            .child(xs_muted(t, AGENT_HINT)),
    }
}

pub fn setup_dialog(
    view: &DeviceSetupDialogView,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    let (panel_bg, panel_ring) = if dark(t) {
        (white(0.02), white(0.05))
    } else {
        (fade(t.background, 0.8), black(0.05))
    };
    let back = Button::new("device-setup-back")
        .variant(ButtonVariant::Outline)
        .disabled(view.back.disabled)
        .label(if view.back.kind == "cancel" {
            "Cancel"
        } else {
            "Back"
        })
        .on_click(on_click(client, "deviceSetupBack", json!({})));
    let next = Button::new("device-setup-next")
        .disabled(view.next.disabled)
        .label(view.next.label.clone())
        .on_click(on_click(client, "deviceSetupNext", json!({})));
    let close = client.clone();
    DialogPopup::new("device-setup-dialog")
        .max_width(WIZARD_MAX_WIDTH)
        .on_close(move |_, cx| act(&close, cx, "deviceSetupDismiss", json!({})))
        .child(
            DialogHeader::new()
                .with_panel(true)
                .child(DialogTitle::new(TITLE))
                .child(DialogDescription::new(DESCRIPTION))
                .child(steps(view, client, t)),
        )
        .child(
            div()
                .id("device-setup-panel")
                .min_w_0()
                .px(px(24.))
                .py(px(20.))
                .bg(panel_bg)
                .shadow(vec![ring(panel_ring)])
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .children(host_updates(
                            "device-setup",
                            &view.environment_id,
                            &view.host_updates,
                            client,
                            t,
                        ))
                        .child(body(view, client, t))
                        .children(view.failed_detail.clone().map(|detail| {
                            div()
                                .mt(px(12.))
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .text_color(t.destructive_foreground)
                                .child(detail)
                        })),
                ),
        )
        .child(
            DialogFooter::new()
                .variant(DialogFooterVariant::Bare)
                .child(back)
                .child(next),
        )
        .into_any_element()
}

impl Render for DeviceSetupHost {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = theme::active(cx);
        let view = self.view.read(cx).data.clone().flatten();
        div().children(view.map(|view| setup_dialog(&view, &self.client, &t)))
    }
}
