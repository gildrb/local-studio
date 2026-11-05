use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, Entity, FontWeight, InteractiveElement, IntoElement, ParentElement, SharedString,
    StatefulInteractiveElement, Styled, div, px,
};
use serde_json::json;

use super::act;
use super::parts::{heading, icon, lead};
use super::wizard::footer;
use crate::app_core::client::CoreClient;
use crate::app_core::views::onboarding::{
    ImportBody, ImportGroup, ImportLoadingBody, ImportOther, ImportRow, ImportRowMeta,
    ImportSection, ImportSectionStatus,
};
use crate::features::chat::provider_instance_icon::ProviderInstanceIcon;
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::checkbox::Checkbox;
use crate::ui::spinner::{Spinner, SpinnerSize, SpinnerTone};
use crate::ui::theme::Tokens;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::fade;
use crate::ui::tooltip::Tooltip;
use gpui::base::CheckboxState;

const LOADING_MIN_HEIGHT: f32 = 160.;
const LOADING_GAP: f32 = 12.;
const LOADING_PADDING_Y: f32 = 24.;
const SELECTION_MARGIN: f32 = 20.;
const SELECTION_GAP: f32 = 12.;
const LIST_MARGIN: f32 = 8.;
const LIST_MAX_HEIGHT: f32 = 320.;
const LIST_PADDING_RIGHT: f32 = 12.;
const SECTION_GAP: f32 = 20.;
const ROW_GAP: f32 = 2.;
const LEGEND_GAP: f32 = 8.;
const ROW_PADDING_X: f32 = 8.;
const ROW_PADDING_Y: f32 = 6.;
const ROW_NESTED_PADDING: f32 = 32.;
const ROW_INNER_GAP: f32 = 10.;
const LABEL_GAP: f32 = 8.;
const TRIGGER_GAP: f32 = 6.;
const CHEVRON: f32 = 14.;
const SLOT: f32 = 16.;
const SLOT_ICON: f32 = 12.;
const COUNT_WIDTH: f32 = 40.;
const AGE_WIDTH: f32 = 36.;
const META_GAP: f32 = 4.;
const STATUS_GAP: f32 = 8.;
const STATUS_PADDING_Y: f32 = 12.;
const EMPTY_PADDING_Y: f32 = 8.;
const SECONDARY_TEXT: f32 = 11.;

pub fn loading(body: &ImportLoadingBody, client: &Entity<CoreClient>, t: &Tokens) -> AnyElement {
    let client = client.clone();
    div()
        .flex()
        .flex_col()
        .min_h(px(LOADING_MIN_HEIGHT))
        .child(heading(t, body.heading.clone()))
        .child(
            div()
                .flex_1()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap(px(LOADING_GAP))
                .py(px(LOADING_PADDING_Y))
                .child(
                    Spinner::new("welcome-import-loading")
                        .size(SpinnerSize::Lg)
                        .tone(SpinnerTone::Muted),
                )
                .child(
                    div()
                        .text_center()
                        .text_size(px(text::SM))
                        .line_height(px(text::SM_LINE))
                        .text_color(t.muted_foreground)
                        .child(body.message.clone()),
                ),
        )
        .child(
            div().flex().justify_end().child(
                Button::new("welcome-import-loading-skip")
                    .variant(ButtonVariant::GhostMuted)
                    .label(body.skip_button.label.clone())
                    .disabled(!body.skip_button.enabled)
                    .on_click(move |_, _, cx| act(&client, cx, "welcomeImportSkip", json!({}))),
            ),
        )
        .into_any_element()
}

pub fn render(body: &ImportBody, client: &Entity<CoreClient>, t: &Tokens) -> AnyElement {
    let skip = client.clone();
    let run = client.clone();
    div()
        .flex()
        .flex_col()
        .child(heading(t, body.heading.clone()))
        .child(lead(t, body.description.clone()))
        .when_some(body.selection.as_ref(), |this, selection| {
            let all = client.clone();
            let none = client.clone();
            this.child(
                div()
                    .mt(px(SELECTION_MARGIN))
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(SELECTION_GAP))
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.muted_foreground)
                    .child(selection.summary.clone())
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(META_GAP))
                            .child(
                                Button::new("welcome-import-select-all")
                                    .size(ButtonSize::Xs)
                                    .variant(ButtonVariant::Ghost)
                                    .label(selection.select_all.label.clone())
                                    .disabled(!selection.select_all.enabled)
                                    .on_click(move |_, _, cx| {
                                        act(&all, cx, "welcomeImportSelectAll", json!({}))
                                    }),
                            )
                            .child(
                                Button::new("welcome-import-select-none")
                                    .size(ButtonSize::Xs)
                                    .variant(ButtonVariant::Ghost)
                                    .label(selection.select_none.label.clone())
                                    .disabled(!selection.select_none.enabled)
                                    .on_click(move |_, _, cx| {
                                        act(&none, cx, "welcomeImportSelectNone", json!({}))
                                    }),
                            ),
                    ),
            )
        })
        .child(
            div()
                .id("welcome-import-scroll")
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
                                .map(|section| render_section(section, body, client, t)),
                        ),
                ),
        )
        .child(
            footer()
                .child(
                    Button::new("welcome-import-skip")
                        .variant(ButtonVariant::GhostMuted)
                        .label(body.skip_button.label.clone())
                        .disabled(!body.skip_button.enabled)
                        .on_click(move |_, _, cx| act(&skip, cx, "welcomeImportSkip", json!({}))),
                )
                .child(
                    Button::new("welcome-import-run")
                        .label(body.import_button.label.clone())
                        .disabled(!body.import_button.enabled)
                        .on_click(move |_, _, cx| act(&run, cx, "welcomeImportRun", json!({}))),
                ),
        )
        .into_any_element()
}

fn render_section(
    section: &ImportSection,
    body: &ImportBody,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    let disabled = section.disabled;
    let status = match &section.status {
        ImportSectionStatus::Pending { label } => Some(
            div()
                .flex()
                .items_center()
                .gap(px(STATUS_GAP))
                .py(px(STATUS_PADDING_Y))
                .text_size(px(text::SM))
                .line_height(px(text::SM_LINE))
                .text_color(t.muted_foreground)
                .child(Spinner::new(SharedString::from(format!(
                    "welcome-import-pending-{}",
                    section.environment_id
                ))))
                .child(label.clone())
                .into_any_element(),
        ),
        ImportSectionStatus::Error {
            message,
            retry_label,
        } => {
            let client = client.clone();
            let environment_id = section.environment_id.clone();
            Some(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(SELECTION_GAP))
                    .text_size(px(text::SM))
                    .line_height(px(text::SM_LINE))
                    .text_color(t.muted_foreground)
                    .child(message.clone())
                    .child(
                        Button::new(SharedString::from(format!(
                            "welcome-import-retry-{environment_id}"
                        )))
                        .size(ButtonSize::Sm)
                        .variant(ButtonVariant::Ghost)
                        .label(retry_label.clone())
                        .on_click(move |_, _, cx| {
                            act(
                                &client,
                                cx,
                                "welcomeImportRetryScan",
                                json!({ "environmentId": environment_id }),
                            )
                        }),
                    )
                    .into_any_element(),
            )
        }
        ImportSectionStatus::Empty { label } => Some(
            div()
                .py(px(EMPTY_PADDING_Y))
                .text_size(px(text::SM))
                .line_height(px(text::SM_LINE))
                .text_color(t.muted_foreground)
                .child(label.clone())
                .into_any_element(),
        ),
        ImportSectionStatus::None => None,
    };
    div()
        .min_w_0()
        .flex()
        .flex_col()
        .gap(px(ROW_GAP))
        .when_some(section.legend.clone(), |this, legend| {
            this.child(
                div()
                    .mb(px(LEGEND_GAP))
                    .text_size(px(text::SM))
                    .line_height(px(text::SM_LINE))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.foreground)
                    .child(legend),
            )
        })
        .children(status)
        .when_some(section.truncated_message.clone(), |this, message| {
            this.child(
                div()
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.muted_foreground)
                    .child(message),
            )
        })
        .children(section.list.groups.iter().map(|group| match group {
            ImportGroup::Row { row } => candidate_row(row, disabled, client, t),
            ImportGroup::Group {
                key,
                label,
                keys,
                checked,
                indeterminate,
                meta,
                rows,
            } => {
                let open = !body.collapsed_groups.contains(key);
                let toggle = client.clone();
                let toggle_key = key.clone();
                div()
                    .flex()
                    .flex_col()
                    .child(
                        toggle_row(
                            SharedString::from(format!("welcome-import-group-{key}")),
                            keys,
                            *checked,
                            *indeterminate,
                            disabled,
                            client,
                            t,
                        )
                        .child(
                            div()
                                .id(SharedString::from(format!(
                                    "welcome-import-group-trigger-{key}"
                                )))
                                .flex_1()
                                .min_w_0()
                                .flex()
                                .items_center()
                                .gap(px(TRIGGER_GAP))
                                .cursor_pointer()
                                .on_click(move |_, _, cx| {
                                    act(
                                        &toggle,
                                        cx,
                                        "welcomeImportToggleGroup",
                                        json!({ "key": toggle_key }),
                                    )
                                })
                                .child(chevron(open, t))
                                .child(
                                    div()
                                        .min_w_0()
                                        .truncate()
                                        .text_size(px(text::SM))
                                        .line_height(px(text::SM_LINE))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(t.foreground)
                                        .child(label.clone()),
                                )
                                .child(row_meta(meta, t)),
                        ),
                    )
                    .when(open, |this| {
                        this.children(
                            rows.iter()
                                .map(|row| candidate_row(row, disabled, client, t)),
                        )
                    })
                    .into_any_element()
            }
        }))
        .when_some(section.list.other.as_ref(), |this, other| {
            this.child(other_folders(
                other,
                &section.environment_id,
                body.open_other.contains(&section.environment_id),
                disabled,
                client,
                t,
            ))
        })
        .into_any_element()
}

fn chevron(open: bool, t: &Tokens) -> impl IntoElement {
    icon(
        if open {
            "icons/chevron-down.svg"
        } else {
            "icons/chevron-right.svg"
        },
        CHEVRON,
        t.muted_foreground,
    )
}

fn toggle_row(
    id: SharedString,
    keys: &[String],
    checked: bool,
    indeterminate: bool,
    disabled: bool,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> gpui::Div {
    let client = client.clone();
    let keys = keys.to_vec();
    let hover = fade(t.muted, 0.4);
    div()
        .flex()
        .items_center()
        .gap(px(ROW_INNER_GAP))
        .px(px(ROW_PADDING_X))
        .py(px(ROW_PADDING_Y))
        .rounded(px(radius::MD))
        .hover(move |style| style.bg(hover))
        .child(
            Checkbox::new(id)
                .checked(checked)
                .indeterminate(indeterminate)
                .disabled(disabled)
                .on_change(move |state, _, _, cx| {
                    act(
                        &client,
                        cx,
                        "welcomeImportToggle",
                        json!({ "keys": keys, "checked": state == CheckboxState::Checked }),
                    )
                }),
        )
}

fn other_folders(
    other: &ImportOther,
    environment_id: &str,
    open: bool,
    disabled: bool,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    let toggle = client.clone();
    let toggle_environment = environment_id.to_string();
    div()
        .flex()
        .flex_col()
        .child(
            toggle_row(
                SharedString::from(format!("welcome-import-other-{environment_id}")),
                &other.keys,
                other.checked,
                other.indeterminate,
                disabled,
                client,
                t,
            )
            .child(
                div()
                    .id(SharedString::from(format!(
                        "welcome-import-other-trigger-{environment_id}"
                    )))
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .items_center()
                    .gap(px(TRIGGER_GAP))
                    .cursor_pointer()
                    .on_click(move |_, _, cx| {
                        act(
                            &toggle,
                            cx,
                            "welcomeImportToggleOther",
                            json!({ "environmentId": toggle_environment }),
                        )
                    })
                    .child(chevron(open, t))
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .text_size(px(text::SM))
                            .line_height(px(text::SM_LINE))
                            .text_color(t.muted_foreground)
                            .child(other.label.clone()),
                    )
                    .child(
                        div()
                            .ml_auto()
                            .flex_none()
                            .text_size(px(text::XS))
                            .line_height(px(text::XS_LINE))
                            .text_color(t.muted_foreground)
                            .child(other.count_label.clone()),
                    ),
            ),
        )
        .when(open, |this| {
            this.children(
                other
                    .rows
                    .iter()
                    .map(|row| candidate_row(row, disabled, client, t)),
            )
        })
        .into_any_element()
}

fn candidate_row(
    row: &ImportRow,
    disabled: bool,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    let row_client = client.clone();
    let check_client = client.clone();
    let key = row.key.clone();
    let check_key = row.key.clone();
    let checked = row.checked;
    let hover = fade(t.muted, 0.4);
    div()
        .id(SharedString::from(format!(
            "welcome-import-row-{}",
            row.key
        )))
        .flex()
        .items_center()
        .gap(px(ROW_INNER_GAP))
        .pl(px(if row.nested {
            ROW_NESTED_PADDING
        } else {
            ROW_PADDING_X
        }))
        .pr(px(ROW_PADDING_X))
        .py(px(ROW_PADDING_Y))
        .rounded(px(radius::MD))
        .hover(move |style| style.bg(hover))
        .when(!disabled, |this| {
            this.cursor_pointer().on_click(move |_, _, cx| {
                act(
                    &row_client,
                    cx,
                    "welcomeImportToggle",
                    json!({ "keys": [key], "checked": !checked }),
                )
            })
        })
        .child(
            Checkbox::new(SharedString::from(format!(
                "welcome-import-check-{}",
                row.key
            )))
            .checked(row.checked)
            .disabled(disabled)
            .on_change(move |state, _, _, cx| {
                cx.stop_propagation();
                act(
                    &check_client,
                    cx,
                    "welcomeImportToggle",
                    json!({ "keys": [check_key], "checked": state == CheckboxState::Checked }),
                )
            }),
        )
        .child(
            div()
                .id(SharedString::from(format!(
                    "welcome-import-label-{}",
                    row.key
                )))
                .flex_1()
                .min_w_0()
                .flex()
                .items_baseline()
                .gap(px(LABEL_GAP))
                .overflow_hidden()
                .tooltip(Tooltip::text(row.tooltip.clone()))
                .child(
                    div()
                        .min_w_0()
                        .truncate()
                        .text_color(t.foreground)
                        .map(|this| {
                            if row.nested {
                                this.font_family(MONO_FONT)
                                    .text_size(px(text::XS))
                                    .line_height(px(text::XS_LINE))
                            } else {
                                this.text_size(px(text::SM))
                                    .line_height(px(text::SM_LINE))
                                    .font_weight(FontWeight::MEDIUM)
                            }
                        })
                        .child(row.label.clone()),
                )
                .when_some(row.secondary.clone(), |this, secondary| {
                    this.child(
                        div()
                            .min_w_0()
                            .truncate()
                            .font_family(MONO_FONT)
                            .text_size(px(SECONDARY_TEXT))
                            .line_height(px(text::XS_LINE))
                            .text_color(t.muted_foreground)
                            .child(secondary),
                    )
                }),
        )
        .child(row_meta(&row.meta, t))
        .into_any_element()
}

fn row_meta(meta: &ImportRowMeta, t: &Tokens) -> AnyElement {
    div()
        .ml_auto()
        .flex_none()
        .flex()
        .items_center()
        .gap(px(META_GAP))
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .text_color(t.muted_foreground)
        .children(meta.source_slots.iter().map(|slot| {
            div()
                .flex_none()
                .size(px(SLOT))
                .flex()
                .items_center()
                .justify_center()
                .children(slot.as_ref().map(|slot| {
                    ProviderInstanceIcon::new(
                        match slot.icon.as_str() {
                            "claude" => "claudeAgent",
                            "codex" => "codex",
                            _ => "piAgent",
                        },
                        "",
                        t.muted_foreground,
                    )
                    .icon_size(SLOT_ICON)
                }))
        }))
        .child(
            div()
                .flex_none()
                .w(px(COUNT_WIDTH))
                .flex()
                .justify_end()
                .child(meta.thread_count.clone()),
        )
        .child(
            div()
                .flex_none()
                .w(px(AGE_WIDTH))
                .flex()
                .justify_end()
                .whitespace_nowrap()
                .child(meta.age.clone()),
        )
        .into_any_element()
}
