use gpui::component::input::{InputState, TextareaState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, BoxShadow, Entity, FontWeight, InteractiveElement, IntoElement, ParentElement,
    Rgba, SharedString, StatefulInteractiveElement, Styled, Window, div, px,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::git_actions::{
    GitCommitDialogView, GitDefaultBranchDialogView, GitPublishDialogView,
};
use crate::features::chat::git_actions_host::send;
use crate::features::chat::toolbar_parts::asset_icon;
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::checkbox::Checkbox;
use crate::ui::dialog::{
    DialogDescription, DialogFooter, DialogFooterVariant, DialogHeader, DialogPanel, DialogPopup,
    DialogTitle,
};
use crate::ui::input::{Input, bare_input, field_bg};
use crate::ui::menu::icon;
use crate::ui::popover::{black, dark, shadow, white};
use crate::ui::spinner::{Spinner, SpinnerSize};
use crate::ui::textarea::{Textarea, TextareaSize};
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::toggle::Toggle;
use crate::ui::toggle_group::ToggleGroup;
use crate::ui::tooltip::Tooltip;

const WIDE_DIALOG: f32 = 576.;
const SUMMARY_GAP: f32 = 12.;
const SUMMARY_PADDING: f32 = 12.;
const FILE_LIST_HEIGHT: f32 = 176.;
const FILE_ROW_PADDING_X: f32 = 8.;
const FILE_ROW_PADDING_Y: f32 = 4.;
const FILE_ROW_GAP: f32 = 8.;
const FILE_ROW_INNER_GAP: f32 = 12.;
const FILE_HEADER_HEIGHT: f32 = 24.;
const STEP_CIRCLE: f32 = 20.;
const CARD_PADDING: f32 = 12.;
const VISIBILITY_PADDING_Y: f32 = 10.;
const FIELD_INNER_HEIGHT: f32 = 36.;
const RESULT_BADGE: f32 = 32.;
const RESULT_TEXT_MAX: f32 = 320.;
const SETUP_HINT: &str = "Open Settings -> Source Control to configure this provider.";
const MONO_SOURCE_CONTROL_ICONS: &[&str] = &["github", "change-request"];

fn ring(color: Rgba) -> BoxShadow {
    shadow(0., 0., 0., 1., color)
}

fn soft_surface(t: &Tokens, light: Rgba, dark_alpha: f32) -> (Rgba, Rgba) {
    if dark(t) {
        (white(dark_alpha), white(0.05))
    } else {
        (light, black(0.05))
    }
}

fn act(
    client: &Entity<CoreClient>,
    action: &'static str,
    params: serde_json::Value,
) -> impl Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static {
    let client = client.clone();
    move |_, _, cx| send(&client, cx, action, params.clone())
}

fn diff_stat(t: &Tokens, insertions: u64, deletions: u64, separator: &'static str) -> gpui::Div {
    div()
        .flex()
        .flex_none()
        .child(
            div()
                .text_color(t.diff_addition)
                .child(SharedString::from(format!("+{insertions}"))),
        )
        .child(div().text_color(t.muted_foreground).child(separator))
        .child(
            div()
                .text_color(t.diff_deletion)
                .child(SharedString::from(format!("-{deletions}"))),
        )
}

pub fn commit_dialog(
    dialog: GitCommitDialogView,
    client: &Entity<CoreClient>,
    message: &Entity<TextareaState>,
    _: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let t = theme::active(cx);
    let (card_bg, card_ring) = soft_surface(&t, t.background, 0.035);
    let (list_bg, list_ring) = soft_surface(&t, t.card, 0.025);
    let row_hover = fade(t.accent, 0.5);
    let editing = dialog.is_editing_files;
    let branch = div()
        .flex()
        .items_center()
        .gap(px(8.))
        .child(
            div()
                .flex_none()
                .text_color(t.muted_foreground)
                .child(SharedString::from(dialog.branch_label.clone())),
        )
        .child(
            div()
                .flex()
                .flex_1()
                .min_w_0()
                .items_center()
                .justify_between()
                .gap(px(8.))
                .child(
                    div()
                        .font_weight(FontWeight::MEDIUM)
                        .child(SharedString::from(dialog.branch_caption.clone())),
                )
                .when(dialog.is_default_ref, |this| {
                    this.child(
                        div()
                            .text_color(t.warning)
                            .child(SharedString::from(dialog.default_branch_label.clone())),
                    )
                }),
        );
    let has_files = !dialog.files.is_empty();
    let files_header = div()
        .flex()
        .h(px(FILE_HEADER_HEIGHT))
        .items_center()
        .justify_between()
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .when(editing && has_files, |this| {
                    let client = client.clone();
                    this.child(
                        Checkbox::new("git-commit-select-all")
                            .checked(dialog.all_selected)
                            .indeterminate(!dialog.all_selected && !dialog.none_selected)
                            .on_change(move |_, _, _, cx| {
                                send(&client, cx, "gitCommitDialogToggleAll", json!({}))
                            }),
                    )
                })
                .child(
                    div()
                        .text_color(t.muted_foreground)
                        .child(SharedString::from(dialog.files_label.clone())),
                )
                .when_some(dialog.selection_summary.clone(), |this, summary| {
                    this.child(
                        div()
                            .text_color(t.muted_foreground)
                            .child(SharedString::from(summary)),
                    )
                }),
        )
        .when(has_files, |this| {
            this.child(
                Button::new("git-commit-edit-files")
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::Xs)
                    .label(dialog.edit_files_label.clone())
                    .on_click(act(client, "gitCommitDialogToggleEditing", json!({}))),
            )
        });
    let files_body = if dialog.show_empty {
        div()
            .font_weight(FontWeight::MEDIUM)
            .child(SharedString::from(dialog.empty_label.clone()))
            .into_any_element()
    } else {
        let rows = dialog.files.iter().enumerate().map(|(index, file)| {
            let path = file.path.clone();
            let toggle_path = file.path.clone();
            let client_toggle = client.clone();
            div()
                .id(("git-commit-file", index))
                .flex()
                .w_full()
                .items_center()
                .gap(px(FILE_ROW_GAP))
                .px(px(FILE_ROW_PADDING_X))
                .py(px(FILE_ROW_PADDING_Y))
                .rounded(px(radius::MD))
                .hover(move |s| s.bg(row_hover))
                .when(editing, |this| {
                    this.child(
                        Checkbox::new(("git-commit-file-check", index))
                            .checked(!file.excluded)
                            .on_change(move |_, _, _, cx| {
                                send(
                                    &client_toggle,
                                    cx,
                                    "gitCommitDialogToggleFile",
                                    json!({ "path": toggle_path }),
                                )
                            }),
                    )
                })
                .child(
                    div()
                        .id(("git-commit-file-open", index))
                        .flex()
                        .flex_1()
                        .min_w_0()
                        .items_center()
                        .justify_between()
                        .gap(px(FILE_ROW_INNER_GAP))
                        .cursor_pointer()
                        .on_click(act(
                            client,
                            "gitCommitDialogOpenFile",
                            json!({ "path": path }),
                        ))
                        .child(
                            div()
                                .id(("git-commit-file-path", index))
                                .flex_1()
                                .min_w_0()
                                .overflow_hidden()
                                .whitespace_nowrap()
                                .text_ellipsis_start()
                                .when(file.excluded, |this| this.text_color(t.muted_foreground))
                                .tooltip(Tooltip::text(file.path.clone()))
                                .child(SharedString::from(file.path.clone())),
                        )
                        .child(if file.excluded {
                            div()
                                .flex_none()
                                .text_color(t.muted_foreground)
                                .child(SharedString::from(dialog.excluded_label.clone()))
                        } else {
                            diff_stat(&t, file.insertions, file.deletions, " / ")
                        }),
                )
        });
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(
                div()
                    .h(px(FILE_LIST_HEIGHT))
                    .rounded(px(radius::LG))
                    .bg(list_bg)
                    .shadow(vec![ring(list_ring)])
                    .overflow_hidden()
                    .child(
                        div()
                            .id("git-commit-files")
                            .size_full()
                            .overflow_y_scroll()
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(4.))
                                    .p(px(4.))
                                    .font_family(MONO_FONT)
                                    .children(rows),
                            ),
                    ),
            )
            .child(
                div()
                    .flex()
                    .justify_end()
                    .font_family(MONO_FONT)
                    .child(diff_stat(
                        &t,
                        dialog.totals.insertions,
                        dialog.totals.deletions,
                        "/",
                    )),
            )
            .into_any_element()
    };
    let summary = div()
        .flex()
        .flex_col()
        .gap(px(SUMMARY_GAP))
        .p(px(SUMMARY_PADDING))
        .rounded(px(radius::XL))
        .bg(card_bg)
        .shadow(vec![ring(card_ring)])
        .text_size(px(text::SM))
        .line_height(px(text::SM_LINE))
        .child(branch)
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(4.))
                .child(files_header)
                .child(files_body),
        );
    let message_field = div()
        .flex()
        .flex_col()
        .gap(px(4.))
        .child(
            div()
                .text_size(px(text::SM))
                .line_height(px(text::SM_LINE))
                .font_weight(FontWeight::MEDIUM)
                .child(SharedString::from(dialog.message_label.clone())),
        )
        .child(Textarea::new(message).size(TextareaSize::Sm).items_start());
    let close = client.clone();
    DialogPopup::new("git-commit-dialog")
        .on_close(move |_, cx| send(&close, cx, "gitCommitDialogClose", json!({})))
        .child(
            DialogHeader::new()
                .with_panel(true)
                .child(DialogTitle::new(dialog.title.clone()))
                .child(DialogDescription::new(dialog.description.clone())),
        )
        .child(
            DialogPanel::new("git-commit-panel")
                .after_header(true)
                .before_bare_footer(true)
                .child(summary)
                .child(message_field),
        )
        .child(
            DialogFooter::new()
                .variant(DialogFooterVariant::Bare)
                .child(
                    Button::new("git-commit-cancel")
                        .variant(ButtonVariant::Outline)
                        .size(ButtonSize::Sm)
                        .label(dialog.cancel_label.clone())
                        .on_click(act(client, "gitCommitDialogClose", json!({}))),
                )
                .child(
                    Button::new("git-commit-new-branch")
                        .variant(ButtonVariant::Outline)
                        .size(ButtonSize::Sm)
                        .disabled(dialog.none_selected)
                        .label(dialog.commit_on_new_branch_label.clone())
                        .on_click(act(
                            client,
                            "gitCommitDialogSubmit",
                            json!({ "onNewBranch": true }),
                        )),
                )
                .child(
                    Button::new("git-commit-submit")
                        .size(ButtonSize::Sm)
                        .disabled(dialog.none_selected)
                        .label(dialog.commit_label.clone())
                        .on_click(act(
                            client,
                            "gitCommitDialogSubmit",
                            json!({ "onNewBranch": false }),
                        )),
                ),
        )
        .into_any_element()
}

pub fn default_branch_dialog(
    dialog: GitDefaultBranchDialogView,
    client: &Entity<CoreClient>,
) -> AnyElement {
    let close = client.clone();
    DialogPopup::new("git-default-branch-dialog")
        .max_width(WIDE_DIALOG)
        .on_close(move |_, cx| send(&close, cx, "gitDefaultBranchAbort", json!({})))
        .child(
            DialogHeader::new()
                .child(DialogTitle::new(dialog.title.clone()))
                .when_some(dialog.description.clone(), |this, description| {
                    this.child(DialogDescription::new(description))
                }),
        )
        .child(
            DialogFooter::new()
                .variant(DialogFooterVariant::Bare)
                .child(
                    div().flex().flex_1().items_center().child(
                        Button::new("git-default-branch-abort")
                            .variant(ButtonVariant::Outline)
                            .size(ButtonSize::Sm)
                            .label(dialog.abort_label.clone())
                            .on_click(act(client, "gitDefaultBranchAbort", json!({}))),
                    ),
                )
                .child(
                    Button::new("git-default-branch-continue")
                        .variant(ButtonVariant::Outline)
                        .size(ButtonSize::SmMultiline)
                        .label(dialog.continue_label.clone())
                        .on_click(act(
                            client,
                            "gitDefaultBranchContinue",
                            json!({ "mode": "continue" }),
                        )),
                )
                .child(
                    Button::new("git-default-branch-feature")
                        .size(ButtonSize::SmMultiline)
                        .label(dialog.feature_branch_label.clone())
                        .on_click(act(
                            client,
                            "gitDefaultBranchContinue",
                            json!({ "mode": "feature_branch" }),
                        )),
                ),
        )
        .into_any_element()
}

fn field_label(label: &'static str) -> gpui::Div {
    div()
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .font_weight(FontWeight::MEDIUM)
        .child(label)
}

fn radio_card(t: &Tokens, selected: bool) -> gpui::Div {
    let card = div()
        .relative()
        .flex()
        .items_center()
        .gap(px(12.))
        .px(px(CARD_PADDING))
        .rounded(px(radius::LG))
        .border_1();
    match (dark(t), selected) {
        (true, true) => card
            .border_color(white(0.))
            .bg(fade(t.primary, 0.1))
            .shadow(vec![ring(fade(t.primary, 0.3))]),
        (true, false) => card.border_color(white(0.)).bg(white(0.035)),
        (false, true) => card.border_color(t.primary).bg(t.background).shadow(vec![
            shadow(0., 0., 0., 2., fade(t.primary, 0.35)),
            shadow(0., 1., 3., 0., black(0.1)),
            shadow(0., 1., 2., -1., black(0.1)),
        ]),
        (false, false) => card.border_color(t.border).bg(t.background),
    }
}

fn wizard_steps(
    dialog: &GitPublishDialogView,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    let (strip_bg, strip_ring) = soft_surface(t, t.background, 0.04);
    let current = dialog.step;
    let steps = dialog.steps.iter().enumerate().map(|(index, step)| {
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
        let label = match (&step.summary, done) {
            (Some(summary), true) => format!("{}: {summary}", step.label),
            _ => step.label.clone(),
        };
        let hover_bg = t.card;
        div()
            .id(("git-publish-step", index))
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
                    .on_click(act(client, "gitPublishSetStep", json!({ "step": index })))
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
                    .child(SharedString::from(label)),
            )
    });
    div()
        .flex()
        .gap(px(4.))
        .p(px(4.))
        .rounded(px(radius::XL))
        .bg(strip_bg)
        .shadow(vec![ring(strip_ring)])
        .children(steps)
        .into_any_element()
}

fn provider_step(
    dialog: &GitPublishDialogView,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> gpui::Div {
    let hover_bg = if dark(t) {
        t.accent
    } else {
        fade(t.muted, 0.5)
    };
    let cards: Vec<AnyElement> = dialog
        .providers
        .iter()
        .enumerate()
        .map(|(index, provider)| {
            let icon_color = if provider.ready {
                t.foreground
            } else {
                t.muted_foreground
            };
            let card = radio_card(t, provider.selected)
                .py(px(CARD_PADDING))
                .child(asset_icon(
                    "source-control",
                    &provider.value,
                    MONO_SOURCE_CONTROL_ICONS,
                    icon_color,
                ))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .text_size(px(text::SM))
                        .line_height(px(text::SM_LINE))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.foreground)
                        .child(SharedString::from(provider.label.clone())),
                );
            if provider.ready {
                card.id(("git-publish-provider", index))
                    .cursor_pointer()
                    .when(!provider.selected, |this| {
                        this.hover(move |s| s.bg(hover_bg))
                    })
                    .on_click(act(
                        client,
                        "gitPublishSelectProvider",
                        json!({ "provider": provider.value }),
                    ))
                    .into_any_element()
            } else {
                let hint = if provider.hint.is_empty() {
                    SETUP_HINT.to_string()
                } else {
                    provider.hint.clone()
                };
                card.opacity(0.64)
                    .child(
                        div()
                            .id(("git-publish-setup", index))
                            .flex_none()
                            .tooltip(Tooltip::text(hint))
                            .child(
                                Button::new(("git-publish-setup-button", index))
                                    .variant(ButtonVariant::WarningOutline)
                                    .size(ButtonSize::Micro)
                                    .label("Setup Required")
                                    .on_click(act(client, "gitPublishOpenSettings", json!({}))),
                            ),
                    )
                    .into_any_element()
            }
        })
        .collect();
    div()
        .flex()
        .flex_col()
        .gap(px(8.))
        .child(field_label("Provider"))
        .child(grid(cards))
}

fn grid(cards: Vec<AnyElement>) -> gpui::Div {
    let mut rows = Vec::new();
    let mut iter = cards.into_iter();
    while let Some(first) = iter.next() {
        let second = iter.next();
        rows.push(
            div()
                .flex()
                .gap(px(12.))
                .child(div().flex_1().min_w_0().child(first))
                .child(div().flex_1().min_w_0().children(second)),
        );
    }
    div().flex().flex_col().gap(px(12.)).children(rows)
}

fn repository_step(
    dialog: &GitPublishDialogView,
    client: &Entity<CoreClient>,
    repository: &Entity<InputState>,
    remote: &Entity<InputState>,
    t: &Tokens,
) -> gpui::Div {
    let pending = dialog.is_pending;
    let path_field = div()
        .flex()
        .items_stretch()
        .overflow_hidden()
        .rounded(px(radius::MD))
        .border_1()
        .border_color(t.input)
        .bg(field_bg(t))
        .child(
            div()
                .flex()
                .flex_none()
                .items_center()
                .gap(px(6.))
                .px(px(10.))
                .border_r_1()
                .border_color(t.input)
                .bg(fade(t.muted, 0.5))
                .font_family(MONO_FONT)
                .text_size(px(text::XS))
                .text_color(t.muted_foreground)
                .child(div().size(px(14.)).flex_none().child(asset_icon(
                    "source-control",
                    &dialog.provider,
                    MONO_SOURCE_CONTROL_ICONS,
                    t.muted_foreground,
                )))
                .child(SharedString::from(format!("{}/", dialog.host))),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .font_family(MONO_FONT)
                .child(bare_input(
                    repository,
                    FIELD_INNER_HEIGHT,
                    12.,
                    12.,
                    text::SM,
                    pending,
                )),
        );
    let visibility_cards: Vec<AnyElement> = dialog
        .visibility_options
        .iter()
        .enumerate()
        .map(|(index, option)| {
            let hover_bg = if dark(t) {
                t.accent
            } else {
                fade(t.muted, 0.5)
            };
            radio_card(t, option.selected)
                .id(("git-publish-visibility", index))
                .py(px(VISIBILITY_PADDING_Y))
                .when(!pending, |this| {
                    this.cursor_pointer()
                        .when(!option.selected, |this| this.hover(move |s| s.bg(hover_bg)))
                        .on_click(act(
                            client,
                            "gitPublishSetVisibility",
                            json!({ "visibility": option.value }),
                        ))
                })
                .child(icon(&option.icon, 16., t.muted_foreground))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .child(
                            div()
                                .text_size(px(text::SM))
                                .line_height(px(text::SM_LINE))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.foreground)
                                .child(SharedString::from(option.label.clone())),
                        )
                        .child(
                            div()
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .text_color(t.muted_foreground)
                                .child(SharedString::from(option.description.clone())),
                        ),
                )
                .into_any_element()
        })
        .collect();
    let advanced_toggle = div()
        .id("git-publish-advanced")
        .flex()
        .items_center()
        .gap(px(4.))
        .cursor_pointer()
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.muted_foreground)
        .on_click(act(client, "gitPublishToggleAdvanced", json!({})))
        .child(icon(
            if dialog.advanced_open {
                "chevron-down"
            } else {
                "chevron-right"
            },
            14.,
            t.muted_foreground,
        ))
        .child("Advanced");
    let advanced = dialog.advanced_open.then(|| {
        let protocol = dialog.protocol.clone();
        let toggle = |id: &'static str, value: &'static str, label: &'static str| {
            let client = client.clone();
            Toggle::new(id)
                .label(label)
                .pressed(protocol == value)
                .disabled(pending)
                .on_change(move |_, _, _, cx| {
                    send(
                        &client,
                        cx,
                        "gitPublishSetProtocol",
                        json!({ "protocol": value }),
                    )
                })
        };
        div()
            .mt(px(12.))
            .flex()
            .gap(px(12.))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .gap(px(6.))
                    .child(field_label("Remote"))
                    .child(Input::new(remote).disabled(pending)),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .gap(px(6.))
                    .child(field_label("Protocol"))
                    .child(
                        ToggleGroup::new("git-publish-protocol")
                            .item(toggle("git-publish-ssh", "ssh", "SSH"))
                            .item(toggle("git-publish-https", "https", "HTTPS")),
                    ),
            )
    });
    let (status_bg, status_border) = if dark(t) {
        (white(0.035), white(0.))
    } else {
        (fade(t.muted, 0.4), t.input)
    };
    div()
        .flex()
        .flex_col()
        .gap(px(20.))
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.))
                .child(field_label("Repository"))
                .child(path_field),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(8.))
                .child(field_label("Visibility"))
                .child(grid(visibility_cards)),
        )
        .child(div().child(advanced_toggle).children(advanced))
        .when(pending, |this| {
            this.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .px(px(12.))
                    .py(px(8.))
                    .rounded(px(radius::MD))
                    .border_1()
                    .border_color(status_border)
                    .bg(status_bg)
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.muted_foreground)
                    .child(Spinner::new("git-publish-pending").size(SpinnerSize::Sm))
                    .child(SharedString::from(format!(
                        "Publishing repository to {}...",
                        dialog.provider_label
                    ))),
            )
        })
        .when_some(dialog.error.clone().filter(|_| !pending), |this, error| {
            this.child(
                div()
                    .px(px(12.))
                    .py(px(8.))
                    .rounded(px(radius::MD))
                    .border_1()
                    .border_color(fade(t.destructive, 0.4))
                    .bg(fade(t.destructive, 0.1))
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.destructive)
                    .child(
                        div()
                            .font_weight(FontWeight::MEDIUM)
                            .child("Publish failed"),
                    )
                    .child(
                        div()
                            .mt(px(2.))
                            .text_color(fade(t.destructive, 0.9))
                            .child(SharedString::from(error)),
                    ),
            )
        })
}

fn result_step(
    dialog: &GitPublishDialogView,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> gpui::Div {
    let (row_bg, row_border) = if dark(t) {
        (white(0.035), white(0.))
    } else {
        (fade(t.muted, 0.4), t.input)
    };
    let Some(result) = dialog.result.clone() else {
        return div()
            .px(px(12.))
            .py(px(8.))
            .rounded(px(radius::MD))
            .border_1()
            .border_color(row_border)
            .bg(if dark(t) { white(0.035) } else { t.background })
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .text_color(t.muted_foreground)
            .child("Publish result unavailable.");
    };
    div()
        .flex()
        .flex_col()
        .gap(px(16.))
        .child(
            div()
                .flex()
                .flex_col()
                .items_center()
                .gap(px(8.))
                .py(px(4.))
                .child(
                    div()
                        .flex()
                        .size(px(RESULT_BADGE))
                        .items_center()
                        .justify_center()
                        .rounded_full()
                        .bg(fade(t.success, 0.15))
                        .child(icon("check", 16., t.success)),
                )
                .child(
                    div()
                        .text_size(px(text::SM))
                        .line_height(px(text::SM_LINE))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(t.foreground)
                        .child(SharedString::from(result.title.clone())),
                )
                .child(
                    div()
                        .max_w(px(RESULT_TEXT_MAX))
                        .text_center()
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .text_color(t.muted_foreground)
                        .child(SharedString::from(result.description.clone())),
                ),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .px(px(12.))
                .py(px(8.))
                .rounded(px(radius::LG))
                .border_1()
                .border_color(row_border)
                .bg(row_bg)
                .child(asset_icon(
                    "source-control",
                    &dialog.provider,
                    MONO_SOURCE_CONTROL_ICONS,
                    t.muted_foreground,
                ))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .font_family(MONO_FONT)
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .text_color(t.foreground)
                        .child(SharedString::from(result.name_with_owner.clone())),
                ),
        )
        .child(
            Button::new("git-publish-open-result")
                .variant(ButtonVariant::Outline)
                .size(ButtonSize::Sm)
                .w_full()
                .label(format!("Open on {}", dialog.provider_label))
                .on_click(act(client, "gitPublishOpenResult", json!({}))),
        )
}

pub fn publish_dialog(
    dialog: GitPublishDialogView,
    client: &Entity<CoreClient>,
    repository: &Entity<InputState>,
    remote: &Entity<InputState>,
    cx: &mut App,
) -> AnyElement {
    let t = theme::active(cx);
    let (panel_bg, panel_ring) = if dark(&t) {
        (white(0.02), white(0.05))
    } else {
        (fade(t.background, 0.8), black(0.05))
    };
    let body = match dialog.step {
        0 => provider_step(&dialog, client, &t),
        1 => repository_step(&dialog, client, repository, remote, &t),
        _ => result_step(&dialog, client, &t),
    };
    let footer = DialogFooter::new().variant(DialogFooterVariant::Bare);
    let footer = if dialog.step == 2 {
        footer.child(Button::new("git-publish-done").label("Done").on_click(act(
            client,
            "gitPublishClose",
            json!({}),
        )))
    } else {
        let back = if dialog.step == 0 {
            Button::new("git-publish-back")
                .variant(ButtonVariant::Outline)
                .disabled(dialog.is_pending)
                .label("Cancel")
                .on_click(act(client, "gitPublishClose", json!({})))
        } else {
            Button::new("git-publish-back")
                .variant(ButtonVariant::Outline)
                .disabled(dialog.is_pending)
                .label("Back")
                .on_click(act(client, "gitPublishBack", json!({})))
        };
        let forward = if dialog.step < 1 {
            Button::new("git-publish-next")
                .disabled(dialog.next_disabled)
                .label("Next")
                .on_click(act(client, "gitPublishNext", json!({})))
                .into_any_element()
        } else if dialog.is_pending {
            Button::new("git-publish-submit")
                .disabled(true)
                .child(Spinner::new("git-publish-submit-spinner").size(SpinnerSize::Sm))
                .label("Publishing...")
                .into_any_element()
        } else {
            Button::new("git-publish-submit")
                .disabled(!dialog.can_submit)
                .label("Publish")
                .on_click(act(client, "gitPublishSubmit", json!({})))
                .into_any_element()
        };
        footer.child(back).child(forward)
    };
    let close = client.clone();
    DialogPopup::new("git-publish-dialog")
        .max_width(WIDE_DIALOG)
        .on_close(move |_, cx| send(&close, cx, "gitPublishClose", json!({})))
        .child(
            DialogHeader::new()
                .with_panel(true)
                .child(DialogTitle::new("Publish repository"))
                .child(DialogDescription::new(
                    "Pick where to host it, then point us at a repo to push to.",
                ))
                .child(wizard_steps(&dialog, client, &t)),
        )
        .child(
            div()
                .px(px(24.))
                .py(px(20.))
                .bg(panel_bg)
                .shadow(vec![ring(panel_ring)])
                .child(body),
        )
        .child(footer)
        .into_any_element()
}
