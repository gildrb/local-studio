use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, Entity, FontWeight, IntoElement, ParentElement, SharedString, Styled, div, px,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::device::{DeviceHostUpdate, DeviceSetupStatus, PlatformStatus};
use crate::features::chat::toolbar_parts::act;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::menu::icon;
use crate::ui::spinner::{Spinner, SpinnerSize};
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};

const LOADING_MAX_WIDTH: f32 = 384.;
const LOADING_BADGE: f32 = 48.;
const LOADING_BADGE_ICON: f32 = 24.;
const LOADING_STEPS_WIDTH: f32 = 96.;
const LOADING_STEP_HEIGHT: f32 = 4.;
const BORDER_SOFT: f32 = 0.6;
const BADGE_BG: f32 = 0.3;
const STEP_DONE: f32 = 0.6;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum LoadingStage {
    Opening,
    Stream,
}

pub fn xs_muted(t: &Tokens, label: impl Into<SharedString>) -> gpui::Div {
    div()
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .text_color(t.muted_foreground)
        .child(label.into())
}

pub fn loading_view(
    name: &str,
    description: &str,
    message: &str,
    error: bool,
    stage: LoadingStage,
    extra: Option<AnyElement>,
    t: &Tokens,
) -> AnyElement {
    let step = |done: bool| {
        div()
            .flex_1()
            .h(px(LOADING_STEP_HEIGHT))
            .rounded_full()
            .bg(if done {
                fade(t.foreground, STEP_DONE)
            } else {
                t.muted
            })
    };
    div()
        .flex()
        .size_full()
        .items_center()
        .justify_center()
        .bg(t.background)
        .px(px(24.))
        .py(px(40.))
        .child(
            div()
                .flex()
                .flex_col()
                .items_center()
                .gap(px(12.))
                .max_w(px(LOADING_MAX_WIDTH))
                .child(
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .justify_center()
                        .size(px(LOADING_BADGE))
                        .rounded(px(radius::XL))
                        .border_1()
                        .border_color(t.border)
                        .bg(fade(t.muted, BADGE_BG))
                        .child(icon("smartphone", LOADING_BADGE_ICON, t.muted_foreground)),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .items_center()
                        .gap(px(4.))
                        .child(
                            div()
                                .text_size(px(text::SM))
                                .line_height(px(text::SM_LINE))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.foreground)
                                .child(name.to_string()),
                        )
                        .when(!description.is_empty(), |this| {
                            this.child(xs_muted(t, description.to_string()))
                        }),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .text_color(t.muted_foreground)
                        .when(!error, |this| {
                            this.child(Spinner::new("device-loading-spinner").size(SpinnerSize::Xs))
                        })
                        .child(message.to_string()),
                )
                .children(extra)
                .when(!error, |this| {
                    this.child(
                        div()
                            .flex()
                            .w(px(LOADING_STEPS_WIDTH))
                            .gap(px(4.))
                            .child(step(true))
                            .child(step(stage == LoadingStage::Stream)),
                    )
                }),
        )
        .into_any_element()
}

pub fn host_updates(
    id: &str,
    environment_id: &str,
    updates: &[DeviceHostUpdate],
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> Option<AnyElement> {
    if updates.is_empty() {
        return None;
    }
    let rows =
        updates.iter().map(|update| {
            let retry = update.retry.as_ref().map(|retry| {
                let client = client.clone();
                let params = json!({ "environmentId": environment_id, "hostId": update.host_id });
                Button::new(SharedString::from(format!(
                    "{id}-host-retry-{}",
                    update.host_id
                )))
                .size(ButtonSize::Compact)
                .variant(ButtonVariant::Outline)
                .disabled(retry.disabled)
                .label(retry.label.clone())
                .on_click(move |_, _, cx| act(&client, cx, "deviceHostRetry", params.clone()))
            });
            div()
                .flex()
                .items_start()
                .gap(px(12.))
                .rounded(px(radius::MD))
                .border_1()
                .border_color(fade(t.border, BORDER_SOFT))
                .px(px(12.))
                .py(px(8.))
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .min_w_0()
                        .flex_1()
                        .child(
                            div()
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.foreground)
                                .child(update.label.clone()),
                        )
                        .child(
                            div()
                                .text_color(t.muted_foreground)
                                .child(update.detail.clone()),
                        )
                        .children(update.hint.clone().map(|hint| {
                            div().mt(px(4.)).text_color(t.muted_foreground).child(hint)
                        })),
                )
                .children(retry)
        });
    Some(
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .children(rows)
            .into_any_element(),
    )
}

pub fn setup_status(id: &str, status: &DeviceSetupStatus, t: &Tokens) -> AnyElement {
    let mark: AnyElement = if status.pending {
        Spinner::new(SharedString::from(format!("{id}-spinner")))
            .size(SpinnerSize::Xs)
            .into_any_element()
    } else {
        icon("check", 12., t.success).into_any_element()
    };
    div()
        .flex()
        .items_center()
        .gap(px(8.))
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .text_color(t.muted_foreground)
        .child(mark)
        .child(status.label.clone())
        .into_any_element()
}

pub fn platform_status(status: &PlatformStatus, t: &Tokens) -> AnyElement {
    let mark = if status.ready {
        icon("check", 16., t.success)
    } else {
        icon("circle-alert", 16., t.muted_foreground)
    };
    div()
        .flex()
        .gap(px(8.))
        .rounded(px(radius::MD))
        .border_1()
        .border_color(fade(t.border, BORDER_SOFT))
        .px(px(12.))
        .py(px(8.))
        .child(div().flex_none().mt(px(2.)).child(mark))
        .child(
            div()
                .flex()
                .flex_col()
                .child(
                    div()
                        .text_size(px(text::SM))
                        .line_height(px(text::SM_LINE))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.foreground)
                        .child(status.platform.clone()),
                )
                .child(xs_muted(t, status.message.clone())),
        )
        .into_any_element()
}
