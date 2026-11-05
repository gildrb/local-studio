use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, ClickEvent, Div, ElementId, Entity, FontWeight, InteractiveElement,
    IntoElement, ParentElement, SharedString, StatefulInteractiveElement, Styled, div, px,
    relative,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::branch_toolbar::MiddleTruncateSplit;
use crate::app_core::views::pull_request_detail::{
    ActivityUnavailableModel, DetailGhostModel, DetailTabModel,
};
use crate::app_core::views::pull_requests::PullRequestActorModel;
use crate::features::chat::toolbar_parts::act;
use crate::features::pull_requests::presentation::{
    TEXT_2XS, avatar, diff_stat, glyph_path, label_chip, path_icon, refresh_icon, signal_icon, tone,
};
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::empty::Empty;
use crate::ui::theme;
use crate::ui::theme::metrics::text;
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::toggle::{Toggle, ToggleSize, ToggleVariant};
use crate::ui::toggle_group::ToggleGroup;
use crate::ui::tooltip::Tooltip;

pub const HEADER_ROW: f32 = 28.;
pub const INSET_X: f32 = 16.;
pub const AVATAR: f32 = 16.;
pub const ICON_SM: f32 = 14.;
pub const ICON_XS: f32 = 12.;
pub const TEXT_2XS_LINE: f32 = 16.;
const GHOST_RADIUS: f32 = 4.;

pub fn ghost_bar(height: f32, t: &Tokens) -> Div {
    div()
        .flex_none()
        .h(px(height))
        .rounded(px(GHOST_RADIUS))
        .bg(fade(t.muted_foreground, 0.15))
}

pub fn middle_truncate(label: &str, split: Option<&MiddleTruncateSplit>) -> Div {
    let row = div()
        .flex()
        .min_w_0()
        .max_w_full()
        .overflow_hidden()
        .whitespace_nowrap();
    match split {
        Some(split) => row
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .child(SharedString::from(split.head.clone())),
            )
            .child(
                div()
                    .flex_none()
                    .child(SharedString::from(split.tail.clone())),
            ),
        None => row.child(
            div()
                .min_w_0()
                .truncate()
                .child(SharedString::from(label.to_string())),
        ),
    }
}

pub fn meta_separator(t: &Tokens) -> Div {
    div()
        .flex_none()
        .text_color(fade(t.muted_foreground, 0.5))
        .child("·")
}

pub fn actor_label(
    id: impl Into<ElementId>,
    actor: &PullRequestActorModel,
    profile_url: Option<&String>,
    with_login: bool,
    tooltip: bool,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    let label = div()
        .flex()
        .min_w_0()
        .items_center()
        .when(with_login, |this| this.gap(px(6.)))
        .child(avatar(actor, AVATAR, t))
        .when(with_login, |this| {
            this.child(
                div()
                    .min_w_0()
                    .truncate()
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.foreground)
                    .child(SharedString::from(actor.login.clone())),
            )
        });
    let placement = div()
        .id(id.into())
        .flex()
        .min_w_0()
        .flex_shrink(1.)
        .child(label);
    if !tooltip {
        return placement.into_any_element();
    }
    let tip = match profile_url {
        Some(_) => format!("{} · Open profile", actor.tooltip),
        None => actor.tooltip.clone(),
    };
    let placement = placement.tooltip(Tooltip::text(SharedString::from(tip)));
    match profile_url {
        Some(url) => {
            let client = client.clone();
            let url = url.clone();
            placement
                .cursor_pointer()
                .on_click(move |_: &ClickEvent, _, cx| {
                    act(
                        &client,
                        cx,
                        "pullRequestDetailOpenUrl",
                        json!({ "url": url }),
                    )
                })
                .into_any_element()
        }
        None => placement.into_any_element(),
    }
}

pub fn segmented_tabs(
    id: &'static str,
    items: &[DetailTabModel],
    active: &str,
    client: Option<&Entity<CoreClient>>,
) -> ToggleGroup {
    ToggleGroup::new(id)
        .variant(ToggleVariant::Segmented)
        .size(ToggleSize::Segmented)
        .flex_none()
        .items(items.iter().map(|item| {
            let toggle = Toggle::new(SharedString::from(format!("{id}-{}", item.value)))
                .pressed(item.value == active)
                .label(SharedString::from(item.label.clone()));
            match client {
                Some(client) => {
                    let client = client.clone();
                    let tab = item.value.clone();
                    toggle.on_change(move |_, _, _, cx| {
                        act(
                            &client,
                            cx,
                            "pullRequestDetailSetTab",
                            json!({ "tab": tab }),
                        )
                    })
                }
                None => toggle.disabled(true),
            }
        }))
}

pub fn outline_refresh(
    id: &'static str,
    label: &str,
    refreshing: bool,
    client: &Entity<CoreClient>,
    action: &'static str,
    t: &Tokens,
) -> Button {
    let client = client.clone();
    Button::new(id)
        .size(ButtonSize::Sm)
        .variant(ButtonVariant::Outline)
        .disabled(refreshing)
        .pl(px(7.))
        .child(refresh_icon(
            SharedString::from(format!("{id}-spin")),
            ICON_SM,
            t.muted_foreground,
            refreshing,
        ))
        .child(SharedString::from(label.to_string()))
        .on_click(move |_, _, cx| act(&client, cx, action, json!({})))
}

pub fn unavailable_state(
    title: &str,
    description: &str,
    retry: Option<bool>,
    git_hub_url: Option<&String>,
    client: &Entity<CoreClient>,
    cx: &App,
) -> AnyElement {
    let t = theme::active(cx);
    let has_buttons = retry.is_some() || git_hub_url.is_some();
    div()
        .id("pr-detail-unavailable")
        .size_full()
        .flex()
        .flex_col()
        .justify_center()
        .overflow_y_scroll()
        .child(
            Empty::new()
                .icon(glyph_path(
                    crate::app_core::views::pull_requests::PullRequestGlyphId::PullRequest,
                ))
                .title(SharedString::from(title.to_string()))
                .description(SharedString::from(description.to_string()))
                .when(has_buttons, |this| {
                    this.child(
                        div()
                            .flex()
                            .flex_wrap()
                            .justify_center()
                            .gap(px(8.))
                            .when_some(retry, |this, refreshing| {
                                this.child(outline_refresh(
                                    "pr-detail-retry",
                                    "Retry",
                                    refreshing,
                                    client,
                                    "pullRequestDetailRetry",
                                    &t,
                                ))
                            })
                            .when_some(git_hub_url.cloned(), |this, url| {
                                let client = client.clone();
                                this.child(
                                    Button::new("pr-detail-open-github")
                                        .size(ButtonSize::Sm)
                                        .variant(ButtonVariant::Outline)
                                        .icon("external-link")
                                        .icon_size(ICON_SM)
                                        .label("Open on GitHub")
                                        .on_click(move |_, _, cx| {
                                            act(
                                                &client,
                                                cx,
                                                "pullRequestDetailOpenUrl",
                                                json!({ "url": url }),
                                            )
                                        }),
                                )
                            }),
                    )
                }),
        )
        .into_any_element()
}

pub fn activity_unavailable(
    model: &ActivityUnavailableModel,
    client: &Entity<CoreClient>,
    cx: &App,
) -> AnyElement {
    let t = theme::active(cx);
    let client = client.clone();
    div()
        .min_h(px(192.))
        .px(px(16.))
        .py(px(40.))
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap(px(8.))
        .text_center()
        .child(
            div()
                .text_size(px(text::SM))
                .line_height(px(text::SM_LINE))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.foreground)
                .child(SharedString::from(model.title.clone())),
        )
        .child(
            div()
                .max_w(px(448.))
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .text_color(t.muted_foreground)
                .child(SharedString::from(model.message.clone())),
        )
        .child(
            Button::new("pr-activity-retry")
                .size(ButtonSize::Sm)
                .variant(ButtonVariant::Outline)
                .pl(px(7.))
                .child(refresh_icon(
                    "pr-activity-retry-spin",
                    ICON_SM,
                    t.muted_foreground,
                    false,
                ))
                .child(SharedString::from(model.retry_label.clone()))
                .on_click(move |_, _, cx| {
                    act(&client, cx, "pullRequestDetailRetryActivity", json!({}))
                }),
        )
        .into_any_element()
}

pub fn timeline_ghost(cx: &App) -> AnyElement {
    let t = theme::active(cx);
    let widths = [0.6, 0.4, 0.5, 2. / 3., 0.4, 0.6];
    div()
        .px(px(16.))
        .py(px(20.))
        .child(
            div()
                .relative()
                .ml(px(8.))
                .border_l_1()
                .border_color(fade(t.border, 0.7))
                .pl(px(20.))
                .children(widths.iter().map(|width| {
                    div()
                        .relative()
                        .pb(px(20.))
                        .child(
                            ghost_bar(8., &t)
                                .absolute()
                                .left(px(-24.8))
                                .top(px(4.))
                                .w(px(8.))
                                .rounded_full(),
                        )
                        .child(ghost_bar(14., &t).w(relative(*width)))
                        .child(ghost_bar(12., &t).mt(px(6.)).w(px(64.)))
                })),
        )
        .into_any_element()
}

pub struct GhostChrome<'a> {
    pub ghost: &'a DetailGhostModel,
    pub actions: Option<AnyElement>,
    pub on_back: bool,
    pub base_split: Option<&'a MiddleTruncateSplit>,
    pub copied: Option<&'static str>,
    pub copy: Option<CopyHandler>,
}

pub fn detail_ghost(chrome: GhostChrome, client: &Entity<CoreClient>, cx: &App) -> AnyElement {
    let t = theme::active(cx);
    let ghost = chrome.ghost;
    let seed = ghost.seed.as_ref();
    let muted = t.muted_foreground;
    let header = div()
        .flex()
        .flex_col()
        .flex_none()
        .border_b_1()
        .border_color(fade(t.border, 0.6))
        .child(
            div()
                .flex()
                .items_start()
                .gap(px(8.))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .h(px(HEADER_ROW))
                        .pl(px(INSET_X))
                        .flex()
                        .items_center()
                        .gap(px(4.))
                        .overflow_hidden()
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .text_color(muted)
                        .when(chrome.on_back, |this| {
                            let client = client.clone();
                            this.child(
                                Button::new("pr-ghost-back")
                                    .size(ButtonSize::IconMicro)
                                    .variant(ButtonVariant::GhostMuted)
                                    .icon("arrow-left")
                                    .icon_size(ICON_SM)
                                    .accessibility_label("Back to this thread's pull requests")
                                    .on_click(move |_, _, cx| {
                                        act(&client, cx, "pullRequestDetailBack", json!({}))
                                    }),
                            )
                        })
                        .map(|this| match seed {
                            Some(seed) => {
                                let client = client.clone();
                                let url = seed.url.clone();
                                this.child(
                                    div()
                                        .min_w_0()
                                        .truncate()
                                        .font_weight(FontWeight::MEDIUM)
                                        .child(SharedString::from(seed.repository.clone())),
                                )
                                .child(
                                    div()
                                        .id("pr-ghost-number")
                                        .flex()
                                        .flex_none()
                                        .items_center()
                                        .gap(px(2.))
                                        .cursor_pointer()
                                        .rounded(px(4.))
                                        .on_click(move |_, _, cx| {
                                            act(
                                                &client,
                                                cx,
                                                "pullRequestDetailOpenUrl",
                                                json!({ "url": url }),
                                            )
                                        })
                                        .child(
                                            div()
                                                .text_color(tone(&seed.state.tone_class_name, &t))
                                                .child(SharedString::from(format!(
                                                    "#{}",
                                                    seed.number
                                                ))),
                                        )
                                        .child(path_icon("icons/external-link.svg", 10., muted)),
                                )
                            }
                            None => this.child(ghost_bar(12., &t).w(px(96.))).child(
                                div()
                                    .flex_none()
                                    .child(SharedString::from(ghost.number_label.clone())),
                            ),
                        }),
                )
                .child(
                    div()
                        .flex_none()
                        .mr(px(INSET_X))
                        .h(px(HEADER_ROW))
                        .flex()
                        .items_center()
                        .justify_end()
                        .gap(px(4.))
                        .map(|this| match chrome.actions {
                            Some(actions) => this.child(actions),
                            None => this.child(ghost_bar(24., &t).w(px(64.)).rounded(px(6.))),
                        })
                        .child(
                            Button::new("pr-ghost-menu")
                                .size(ButtonSize::IconXs)
                                .variant(ButtonVariant::Ghost)
                                .icon("ellipsis")
                                .disabled(true)
                                .accessibility_label("Pull request actions loading"),
                        ),
                ),
        )
        .child(
            div()
                .mt(px(4.))
                .px(px(INSET_X))
                .pb(px(16.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .min_h(px(24.))
                        .min_w_0()
                        .map(|this| match seed {
                            Some(seed) => this.child(
                                div()
                                    .min_w_0()
                                    .truncate()
                                    .text_size(px(text::BASE))
                                    .line_height(px(text::BASE * text::LEADING_SNUG))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(SharedString::from(seed.title.clone())),
                            ),
                            None => this.child(ghost_bar(20., &t).w(relative(0.8)).max_w(px(448.))),
                        }),
                )
                .child(
                    div()
                        .mt(px(8.))
                        .flex()
                        .items_center()
                        .min_h(px(20.))
                        .min_w_0()
                        .gap(px(8.))
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .text_color(muted)
                        .map(|this| match seed {
                            Some(seed) => this.child(
                                div()
                                    .flex()
                                    .min_w_0()
                                    .items_center()
                                    .gap(px(6.))
                                    .whitespace_nowrap()
                                    .child(actor_label(
                                        "pr-ghost-author",
                                        &seed.author,
                                        None,
                                        true,
                                        false,
                                        client,
                                        &t,
                                    ))
                                    .child(meta_separator(&t))
                                    .child(SharedString::from(seed.updated_label.clone())),
                            ),
                            None => this.child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(6.))
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap(px(6.))
                                            .child(ghost_bar(16., &t).w(px(16.)).rounded_full())
                                            .child(ghost_bar(12., &t).w(px(56.))),
                                    )
                                    .child(meta_separator(&t))
                                    .child(ghost_bar(12., &t).w(px(64.))),
                            ),
                        })
                        .when_some(ghost.checkout_command.clone(), |this, command| {
                            this.child(copyable_code(
                                Copyable {
                                    id: "pr-ghost-checkout",
                                    value: &command,
                                    copy_label: "Copy checkout command",
                                    target: "checkout",
                                    copied: chrome.copied == Some("checkout"),
                                    push_right: true,
                                    handler: chrome.copy.clone(),
                                },
                                &t,
                            ))
                        }),
                )
                .child(
                    div()
                        .mt(px(16.))
                        .flex()
                        .items_center()
                        .min_h(px(20.))
                        .min_w_0()
                        .gap(px(8.))
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .text_color(muted)
                        .child(
                            div()
                                .flex()
                                .flex_1()
                                .min_w_0()
                                .items_center()
                                .gap(px(6.))
                                .font_family(MONO_FONT)
                                .text_color(fade(muted, 0.7))
                                .map(|this| match seed {
                                    Some(seed) => this
                                        .child(
                                            div().min_w_0().max_w(relative(0.4)).flex_none().child(
                                                middle_truncate(
                                                    &seed.base_branch,
                                                    chrome.base_split,
                                                ),
                                            ),
                                        )
                                        .child(
                                            path_icon("icons/arrow-left.svg", ICON_SM, muted)
                                                .opacity(0.6),
                                        )
                                        .child(copyable_code(
                                            Copyable {
                                                id: "pr-ghost-head",
                                                value: &seed.head_branch,
                                                copy_label: "Copy pull request branch",
                                                target: "branch",
                                                copied: chrome.copied == Some("branch"),
                                                push_right: false,
                                                handler: chrome.copy.clone(),
                                            },
                                            &t,
                                        )),
                                    None => this
                                        .child(ghost_bar(12., &t).w(px(48.)))
                                        .child(
                                            path_icon("icons/arrow-left.svg", ICON_SM, muted)
                                                .opacity(0.6),
                                        )
                                        .child(ghost_bar(12., &t).w(px(128.)).flex_1()),
                                }),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_none()
                                .items_center()
                                .justify_end()
                                .gap(px(8.))
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .justify_end()
                                        .min_w(px(64.))
                                        .gap(px(6.))
                                        .child(path_icon("icons/file-diff.svg", ICON_SM, muted))
                                        .map(|this| match ghost.changed_files_label.clone() {
                                            Some(label) => this.child(SharedString::from(label)),
                                            None => this.child(ghost_bar(12., &t).w(px(40.))),
                                        }),
                                )
                                .map(|this| match seed {
                                    Some(seed) if seed.additions + seed.deletions > 0 => this
                                        .child(diff_stat(
                                            &format!("+{}", seed.additions),
                                            &format!("-{}", seed.deletions),
                                            text::XS,
                                            text::XS_LINE,
                                            &t,
                                        )),
                                    Some(_) => this,
                                    None => this.child(ghost_bar(12., &t).w(px(80.))),
                                }),
                        ),
                ),
        )
        .child(
            div()
                .flex()
                .flex_wrap()
                .items_center()
                .min_w_0()
                .gap(px(8.))
                .border_t_1()
                .border_color(fade(t.border, 0.6))
                .px(px(INSET_X))
                .py(px(8.))
                .child(segmented_tabs(
                    "pr-ghost-tabs",
                    &ghost.tabs,
                    &ghost.selected_tab,
                    None,
                ))
                .map(|this| match ghost.checks.as_ref() {
                    Some(checks) => {
                        let color = tone(&checks.tone_class_name, &t);
                        this.child(
                            div()
                                .ml_auto()
                                .flex()
                                .items_center()
                                .gap(px(6.))
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .text_color(color)
                                .child(signal_icon("pr-ghost-checks", &checks.icon, ICON_SM, color))
                                .child(SharedString::from(checks.label.clone())),
                        )
                    }
                    None => this.child(ghost_bar(12., &t).ml_auto().w(px(128.))),
                }),
        );
    let meta_row = |icon: &'static str, label: &'static str, value: AnyElement| {
        div()
            .flex()
            .items_center()
            .min_h(px(24.))
            .min_w_0()
            .gap(px(8.))
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .child(
                div()
                    .w(px(96.))
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .text_color(muted)
                    .child(path_icon(icon, ICON_SM, muted))
                    .child(label),
            )
            .child(value)
    };
    let reviewers = div()
        .flex()
        .items_center()
        .gap(px(6.))
        .child(ghost_bar(12., &t).w(px(40.)))
        .child(
            Button::new("pr-ghost-reviewers")
                .size(ButtonSize::IconXs)
                .variant(ButtonVariant::Ghost)
                .icon("user-plus")
                .icon_size(ICON_SM)
                .disabled(true),
        )
        .into_any_element();
    let labels = div()
        .flex()
        .flex_wrap()
        .items_center()
        .min_w_0()
        .gap(px(4.))
        .map(|this| match ghost.labels.as_ref() {
            Some(labels) if labels.is_empty() => this.child(div().text_color(muted).child("None")),
            Some(labels) => this.children(
                labels
                    .iter()
                    .map(|label| label_chip(&label.name, label.color.as_deref(), None, 192.)),
            ),
            None => this
                .child(ghost_bar(18., &t).w(px(96.)))
                .child(ghost_bar(18., &t).w(px(80.))),
        })
        .child(
            Button::new("pr-ghost-labels")
                .size(ButtonSize::IconXs)
                .variant(ButtonVariant::Ghost)
                .icon("tag")
                .icon_size(ICON_SM)
                .disabled(true),
        )
        .into_any_element();
    div()
        .size_full()
        .flex()
        .flex_col()
        .overflow_hidden()
        .bg(t.background)
        .child(header)
        .child(
            div()
                .flex_1()
                .min_h_0()
                .overflow_hidden()
                .child(
                    div()
                        .px(px(INSET_X))
                        .pt(px(10.))
                        .pb(px(4.))
                        .flex()
                        .flex_col()
                        .gap(px(8.))
                        .child(meta_row("icons/users.svg", "Reviewers", reviewers))
                        .child(meta_row("icons/tag.svg", "Labels", labels)),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .px(px(INSET_X))
                        .py(px(12.))
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(muted)
                        .child("Description")
                        .child(path_icon(
                            "icons/chevron-down.svg",
                            ICON_SM,
                            fade(muted, 0.6),
                        )),
                )
                .child(
                    div()
                        .px(px(INSET_X))
                        .pb(px(16.))
                        .flex()
                        .flex_col()
                        .gap(px(12.))
                        .child(ghost_bar(20., &t).w(px(160.)))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(8.))
                                .child(ghost_bar(16., &t).w_full())
                                .child(ghost_bar(16., &t).w(relative(11. / 12.)))
                                .child(ghost_bar(16., &t).w(relative(0.8)))
                                .child(ghost_bar(16., &t).w(relative(2. / 3.))),
                        ),
                ),
        )
        .into_any_element()
}

pub type CopyHandler = Rc<dyn Fn(&'static str, &mut App)>;

pub struct Copyable<'a> {
    pub id: &'static str,
    pub value: &'a str,
    pub copy_label: &'a str,
    pub target: &'static str,
    pub copied: bool,
    pub push_right: bool,
    pub handler: Option<CopyHandler>,
}

pub fn copyable_code(copyable: Copyable, t: &Tokens) -> AnyElement {
    let Copyable {
        id,
        value,
        copy_label,
        target,
        copied,
        push_right,
        handler,
    } = copyable;
    let hover = fade(t.accent, 0.45);
    let foreground = t.foreground;
    let tip = format!("{}: {value}", if copied { "Copied" } else { copy_label });
    div()
        .id(id)
        .relative()
        .min_w_0()
        .max_w_full()
        .flex_shrink(1.)
        .when(push_right, |this| this.ml_auto())
        .px(px(4.))
        .py(px(2.))
        .rounded(px(4.))
        .cursor_pointer()
        .font_family(MONO_FONT)
        .hover(move |style| style.bg(hover).text_color(foreground))
        .tooltip(Tooltip::text(SharedString::from(tip)))
        .when_some(handler, |this, handler| {
            this.on_click(move |_, _, cx| handler(target, cx))
        })
        .child(
            div()
                .min_w_0()
                .truncate()
                .when(copied, |this| this.opacity(0.))
                .child(SharedString::from(value.to_string())),
        )
        .child(
            div()
                .absolute()
                .inset_0()
                .flex()
                .items_center()
                .justify_center()
                .when(!copied, |this| this.opacity(0.))
                .child("Copied"),
        )
        .into_any_element()
}

pub fn small_meta(t: &Tokens) -> Div {
    div()
        .text_size(px(TEXT_2XS))
        .line_height(px(TEXT_2XS_LINE))
        .text_color(t.muted_foreground)
}
