use gpui::prelude::FluentBuilder;
use gpui::{
    Animation, AnimationExt, AnyElement, App, Entity, FontWeight, IntoElement, ParentElement,
    SharedString, Styled, div, px, relative,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::pull_requests::{
    PullRequestListEmptyModel, PullRequestListGhostModel, PullRequestsActionButtonModel,
    PullRequestsErrorBannerModel, PullRequestsFooterModel, PullRequestsUnavailableModel,
};
use crate::features::chat::toolbar_parts::act;
use crate::features::pull_requests::presentation::{path_icon, refresh_icon};
use crate::features::pull_requests::row::{ROW_GAP, ROW_HEIGHT};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::empty::{Empty, EmptyMedia};
use crate::ui::skeleton::{CYCLE, breath};
use crate::ui::spinner::{Spinner, SpinnerSize};
use crate::ui::theme;
use crate::ui::theme::metrics::text;
use crate::ui::theme::tokens::fade;

const TITLE_WIDTHS: [f32; 7] = [0.6, 0.4, 0.5, 2. / 3., 0.4, 0.6, 0.5];
const META_WIDTHS: [f32; 7] = [0.4, 1. / 3., 0.4, 0.25, 1. / 3., 0.4, 1. / 3.];
const GHOST_RADIUS: f32 = 4.;
const MARK_WIDTH: f32 = 128.;
const MARK_HEIGHT: f32 = 80.;
const MARK_VIEWBOX_RATIO: f32 = 72. / 120.;
const BUTTON_ICON: f32 = 14.;
const ICON_BUTTON_INSET: f32 = 7.;

fn ghost_bar(height: f32, cx: &App) -> gpui::Div {
    let t = theme::active(cx);
    div()
        .h(px(height))
        .flex_none()
        .rounded(px(GHOST_RADIUS))
        .bg(fade(t.muted_foreground, 0.15))
}

pub fn list_ghost(ghost: &PullRequestListGhostModel, cx: &App) -> AnyElement {
    let t = theme::active(cx);
    div()
        .flex()
        .flex_col()
        .gap(px(ROW_GAP))
        .when_some(ghost.caption.as_ref(), |this, caption| {
            this.child(
                div()
                    .px(px(12.))
                    .pb(px(4.))
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(fade(t.muted_foreground, 0.7))
                    .child(SharedString::from(caption.clone())),
            )
        })
        .children((0..ghost.rows as usize).map(|index| {
            div()
                .flex()
                .h(px(ROW_HEIGHT))
                .items_center()
                .gap(px(8.))
                .px(px(12.))
                .py(px(10.))
                .rounded(px(8.))
                .child(ghost_bar(16., cx).w(px(16.)).rounded_full())
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .gap(px(6.))
                        .child(
                            ghost_bar(16., cx)
                                .w(relative(TITLE_WIDTHS[index % TITLE_WIDTHS.len()])),
                        )
                        .child(
                            ghost_bar(14., cx).w(relative(META_WIDTHS[index % META_WIDTHS.len()])),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_none()
                        .items_end()
                        .gap(px(6.))
                        .child(ghost_bar(12., cx).w(px(48.)))
                        .child(ghost_bar(12., cx).w(px(64.))),
                )
        }))
        .with_animation(
            "pr-list-ghost",
            Animation::new(CYCLE).repeat(),
            |this, delta| this.opacity(breath(delta)),
        )
        .into_any_element()
}

fn branch_mark(cx: &App) -> AnyElement {
    let t = theme::active(cx);
    div()
        .flex()
        .items_center()
        .justify_center()
        .w(px(MARK_WIDTH))
        .h(px(MARK_HEIGHT))
        .child(
            path_icon(
                "icons/pull-requests/branch-mark.svg",
                MARK_WIDTH,
                fade(t.muted_foreground, 0.6),
            )
            .h(px(MARK_WIDTH * MARK_VIEWBOX_RATIO)),
        )
        .into_any_element()
}

fn refresh_button(
    id: &'static str,
    model: &PullRequestsActionButtonModel,
    client: &Entity<CoreClient>,
    action: &'static str,
    cx: &App,
) -> Button {
    let t = theme::active(cx);
    let client = client.clone();
    Button::new(id)
        .size(ButtonSize::Sm)
        .variant(ButtonVariant::Outline)
        .disabled(model.disabled)
        .pl(px(ICON_BUTTON_INSET))
        .child(refresh_icon(
            SharedString::from(format!("{id}-spin")),
            BUTTON_ICON,
            t.muted_foreground,
            model.busy,
        ))
        .child(SharedString::from(model.label.clone()))
        .on_click(move |_, _, cx| act(&client, cx, action, json!({})))
}

fn action_button(
    id: &'static str,
    model: &PullRequestsActionButtonModel,
    client: &Entity<CoreClient>,
    action: &'static str,
) -> Button {
    let client = client.clone();
    Button::new(id)
        .size(ButtonSize::Sm)
        .variant(ButtonVariant::Outline)
        .disabled(model.disabled)
        .label(model.label.clone())
        .on_click(move |_, _, cx| act(&client, cx, action, json!({})))
}

fn button_row(children: Vec<AnyElement>) -> AnyElement {
    div()
        .flex()
        .flex_wrap()
        .justify_center()
        .gap(px(8.))
        .children(children)
        .into_any_element()
}

pub fn list_empty(
    empty: &PullRequestListEmptyModel,
    client: &Entity<CoreClient>,
    cx: &App,
) -> AnyElement {
    match empty {
        PullRequestListEmptyModel::Searching { ghost } => list_ghost(ghost, cx),
        PullRequestListEmptyModel::NoProjects {
            title,
            description,
            add_project,
        } => {
            let client = client.clone();
            Empty::new()
                .media(EmptyMedia::Plain(branch_mark(cx)))
                .title(SharedString::from(title.clone()))
                .description(SharedString::from(description.clone()))
                .child(
                    Button::new("pr-empty-add-project")
                        .size(ButtonSize::Sm)
                        .icon("plus")
                        .icon_size(BUTTON_ICON)
                        .label(add_project.label.clone())
                        .disabled(add_project.disabled)
                        .on_click(move |_, _, cx| {
                            act(&client, cx, "pullRequestsAddProject", json!({}))
                        }),
                )
                .into_any_element()
        }
        PullRequestListEmptyModel::NoMatches {
            title,
            description,
            clear_search,
            refresh,
        } => {
            let clear_client = client.clone();
            Empty::new()
                .media(EmptyMedia::Plain(branch_mark(cx)))
                .title(SharedString::from(title.clone()))
                .description(SharedString::from(description.clone()))
                .child(button_row(vec![
                    Button::new("pr-empty-clear-search")
                        .size(ButtonSize::Sm)
                        .variant(ButtonVariant::Outline)
                        .icon("search")
                        .icon_size(BUTTON_ICON)
                        .label(clear_search.label.clone())
                        .disabled(clear_search.disabled)
                        .on_click(move |_, _, cx| {
                            act(&clear_client, cx, "pullRequestsClearQuery", json!({}))
                        })
                        .into_any_element(),
                    refresh_button(
                        "pr-empty-refresh",
                        refresh,
                        client,
                        "pullRequestsRefresh",
                        cx,
                    )
                    .into_any_element(),
                ]))
                .into_any_element()
        }
        PullRequestListEmptyModel::Empty {
            title,
            description,
            load_more,
            refresh,
        } => Empty::new()
            .media(EmptyMedia::Plain(branch_mark(cx)))
            .title(SharedString::from(title.clone()))
            .description(SharedString::from(description.clone()))
            .child(button_row(
                load_more
                    .iter()
                    .map(|load_more| {
                        action_button(
                            "pr-empty-load-more",
                            load_more,
                            client,
                            "pullRequestsLoadMore",
                        )
                        .into_any_element()
                    })
                    .chain(std::iter::once(
                        refresh_button(
                            "pr-empty-refresh",
                            refresh,
                            client,
                            "pullRequestsRefresh",
                            cx,
                        )
                        .into_any_element(),
                    ))
                    .collect(),
            ))
            .into_any_element(),
    }
}

pub fn unavailable(
    model: &PullRequestsUnavailableModel,
    client: &Entity<CoreClient>,
    cx: &App,
) -> AnyElement {
    Empty::new()
        .icon("icons/git-pull-request-arrow.svg")
        .title(SharedString::from(model.title.clone()))
        .description(SharedString::from(model.description.clone()))
        .when_some(model.retry.as_ref(), |this, retry| {
            this.child(button_row(vec![
                refresh_button(
                    "pr-unavailable-retry",
                    &PullRequestsActionButtonModel {
                        label: retry.label.clone(),
                        disabled: retry.disabled,
                        busy: retry.refreshing,
                    },
                    client,
                    "pullRequestsRetry",
                    cx,
                )
                .into_any_element(),
            ]))
        })
        .into_any_element()
}

pub fn error_banner(
    banner: &PullRequestsErrorBannerModel,
    client: &Entity<CoreClient>,
    cx: &App,
) -> AnyElement {
    let t = theme::active(cx);
    let client = client.clone();
    div()
        .flex()
        .items_center()
        .justify_between()
        .gap(px(12.))
        .rounded(px(10.))
        .border_1()
        .border_color(fade(t.warning, 0.3))
        .bg(t.warning_surface)
        .px(px(12.))
        .py(px(8.))
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .text_color(t.foreground)
        .child(
            div()
                .min_w_0()
                .child(SharedString::from(banner.message.clone())),
        )
        .child(
            Button::new("pr-error-retry")
                .size(ButtonSize::Xs)
                .variant(ButtonVariant::Outline)
                .label(banner.retry_label.clone())
                .on_click(move |_, _, cx| act(&client, cx, "pullRequestsRetry", json!({}))),
        )
        .into_any_element()
}

pub fn footer(
    footer: &PullRequestsFooterModel,
    client: &Entity<CoreClient>,
    cx: &App,
) -> AnyElement {
    let t = theme::active(cx);
    let content = match footer {
        PullRequestsFooterModel::Loading { label } => div()
            .flex()
            .items_center()
            .gap(px(8.))
            .child(Spinner::new("pr-footer-spinner").size(SpinnerSize::Sm))
            .child(SharedString::from(label.clone()))
            .into_any_element(),
        PullRequestsFooterModel::LoadMore { label, disabled } => action_button(
            "pr-footer-load-more",
            &PullRequestsActionButtonModel {
                label: label.clone(),
                disabled: *disabled,
                busy: false,
            },
            client,
            "pullRequestsLoadMore",
        )
        .into_any_element(),
        PullRequestsFooterModel::Exhausted { label } => div()
            .child(SharedString::from(label.clone()))
            .into_any_element(),
    };
    div()
        .flex()
        .justify_center()
        .py(px(12.))
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .text_color(t.muted_foreground)
        .child(content)
        .into_any_element()
}
