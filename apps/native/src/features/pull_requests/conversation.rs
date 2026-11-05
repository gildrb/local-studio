use gpui::component::input::TextareaState;
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Entity, InteractiveElement, IntoElement, KeyDownEvent, ParentElement,
    SharedString, StatefulInteractiveElement, Styled, Window, div, px,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::pull_request_summary::{
    BodySegmentView, BodyView, MarkdownEditorView, ReactionBarModel,
};
use crate::features::chat::chat_markdown::markdown_document;
use crate::features::chat::toolbar_parts::act;
use crate::features::pull_requests::filters::record;
use crate::features::pull_requests::presentation::path_icon;
use crate::features::pull_requests::row::AnchorBounds;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::popover::{Align, PopoverPadding, PopoverPopup, Side};
use crate::ui::textarea::{Textarea, TextareaSize};
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::toggle::{Toggle, ToggleSize, ToggleVariant};
use crate::ui::toggle_group::ToggleGroup;
use crate::ui::tooltip::Tooltip;

const PILL_HEIGHT: f32 = 24.;
const PILL_ICON: f32 = 14.;
const OPTION_SIZE: f32 = 28.;
const SEGMENT_GAP: f32 = 12.;

pub fn reaction_anchor(subject: &str) -> String {
    format!("reaction:{subject}")
}

pub fn body_view(
    id: &str,
    body: &BodyView,
    client: &Entity<CoreClient>,
    t: &Tokens,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let mut column = div()
        .flex()
        .flex_col()
        .w_full()
        .min_w_0()
        .gap(px(SEGMENT_GAP));
    for segment in &body.segments {
        match segment {
            BodySegmentView::Markdown {
                id: segment_id,
                document,
            } => {
                column = column.child(markdown_document(
                    &format!("{id}.{segment_id}"),
                    document,
                    t.foreground,
                    client,
                    t,
                    window,
                    cx,
                ));
            }
            BodySegmentView::Video {
                id: segment_id,
                video,
            } => {
                column = column.child(crate::ui::video_player::VideoPlayer::keyed(
                    SharedString::from(format!("{id}.{segment_id}")),
                    client,
                    video,
                    crate::ui::video_player::VideoSurface::Inline {
                        max_width: None,
                        border_alpha: 0.6,
                    },
                    false,
                    window,
                    cx,
                ));
            }
            BodySegmentView::Attachment {
                id: segment_id,
                url,
                label,
            } => {
                let (url, label, icon) = (url.clone(), label.clone(), "icons/paperclip.svg");
                let client = client.clone();
                let target = url.clone();
                let hover = fade(t.muted, 0.6);
                column = column.child(
                    div()
                        .id(SharedString::from(format!("{id}.{segment_id}")))
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .rounded(px(radius::LG))
                        .border_1()
                        .border_color(fade(t.border, 0.6))
                        .bg(fade(t.muted, 0.3))
                        .px(px(12.))
                        .py(px(8.))
                        .text_size(px(text::SM))
                        .line_height(px(text::SM_LINE))
                        .cursor_pointer()
                        .hover(move |style| style.bg(hover))
                        .tooltip(Tooltip::text(SharedString::from(url.clone())))
                        .on_click(move |_, _, cx| {
                            act(
                                &client,
                                cx,
                                "pullRequestDetailOpenUrl",
                                json!({ "url": target }),
                            )
                        })
                        .child(path_icon(icon, PILL_ICON, t.muted_foreground))
                        .child(
                            div()
                                .min_w_0()
                                .flex_1()
                                .truncate()
                                .child(SharedString::from(label.clone())),
                        )
                        .child(path_icon(
                            "icons/external-link.svg",
                            12.,
                            t.muted_foreground,
                        )),
                );
            }
        }
    }
    column.into_any_element()
}

fn pill_base(id: SharedString) -> gpui::Stateful<gpui::Div> {
    div()
        .id(id)
        .flex()
        .flex_none()
        .h(px(PILL_HEIGHT))
        .items_center()
        .gap(px(4.))
        .rounded_full()
        .border_1()
        .px(px(8.))
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
}

pub fn reaction_bar(
    id: &str,
    subject: &str,
    bar: &ReactionBarModel,
    bounds: &AnchorBounds,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> Option<AnyElement> {
    if !bar.visible {
        return None;
    }
    let mut row = div()
        .flex()
        .min_w_0()
        .max_w_full()
        .flex_wrap()
        .items_center()
        .gap(px(4.));
    for pill in &bar.pills {
        let client = client.clone();
        let subject = subject.to_string();
        let content = pill.content.clone();
        let hover = fade(t.primary, 0.6);
        let disabled = pill.disabled;
        row = row.child(
            pill_base(SharedString::from(format!("{id}-pill-{}", pill.content)))
                .map(|this| {
                    if pill.pressed {
                        this.border_color(fade(t.primary, 0.6))
                            .bg(fade(t.primary, 0.1))
                            .text_color(t.foreground)
                    } else {
                        this.border_color(fade(t.border, 0.7))
                            .bg(fade(t.muted, 0.4))
                            .text_color(t.muted_foreground)
                    }
                })
                .when(!disabled, |this| {
                    this.cursor_pointer()
                        .hover(move |style| style.border_color(hover))
                        .on_click(move |_, _, cx| {
                            act(
                                &client,
                                cx,
                                "pullRequestReact",
                                json!({ "subject": subject, "content": content }),
                            )
                        })
                })
                .tooltip(Tooltip::text(SharedString::from(pill.tooltip.clone())))
                .child(SharedString::from(pill.emoji.clone()))
                .child(
                    div()
                        .font_features(crate::ui::theme::tabular())
                        .child(SharedString::from(pill.count.to_string())),
                ),
        );
    }
    if bar.picker.visible {
        let client = client.clone();
        let open_subject = subject.to_string();
        let hover = fade(t.primary, 0.6);
        let foreground = t.foreground;
        row = row.child(
            pill_base(SharedString::from(format!("{id}-picker")))
                .relative()
                .px(px(6.))
                .border_color(fade(t.border, 0.7))
                .text_color(t.muted_foreground)
                .cursor_pointer()
                .hover(move |style| style.border_color(hover).text_color(foreground))
                .tooltip(Tooltip::text(SharedString::from(
                    bar.picker.aria_label.clone(),
                )))
                .on_click(move |_, _, cx| {
                    act(
                        &client,
                        cx,
                        "pullRequestReactionPicker",
                        json!({ "subject": open_subject }),
                    )
                })
                .child(path_icon(
                    "icons/pull-requests/smile-plus.svg",
                    PILL_ICON,
                    t.muted_foreground,
                ))
                .child(record(bounds, reaction_anchor(subject))),
        );
    }
    Some(row.into_any_element())
}

pub fn reaction_picker_popup(
    subject: &str,
    bar: &ReactionBarModel,
    bounds: &AnchorBounds,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> Option<AnyElement> {
    let trigger = *bounds.borrow().get(&reaction_anchor(subject))?;
    let dismiss = client.clone();
    let mut options = div().flex().items_center().gap(px(2.));
    for option in &bar.picker.options {
        let client = client.clone();
        let subject = subject.to_string();
        let content = option.content.clone();
        let hover = t.accent;
        options = options.child(
            div()
                .id(SharedString::from(format!(
                    "reaction-option-{}",
                    option.content
                )))
                .flex()
                .size(px(OPTION_SIZE))
                .items_center()
                .justify_center()
                .rounded(px(radius::MD))
                .text_size(px(text::BASE))
                .line_height(px(text::BASE_LINE))
                .cursor_pointer()
                .when(option.pressed, |this| this.bg(fade(t.primary, 0.1)))
                .hover(move |style| style.bg(hover))
                .tooltip(Tooltip::text(SharedString::from(option.aria_label.clone())))
                .on_click(move |_, _, cx| {
                    act(
                        &client,
                        cx,
                        "pullRequestReact",
                        json!({ "subject": subject, "content": content }),
                    )
                })
                .child(SharedString::from(option.emoji.clone())),
        );
    }
    Some(
        PopoverPopup::new(
            SharedString::from(format!("reaction-picker-{subject}")),
            trigger,
        )
        .side(Side::Top)
        .align(Align::Start)
        .padding(PopoverPadding::Compact)
        .on_dismiss(move |_, cx| {
            act(
                &dismiss,
                cx,
                "pullRequestReactionPicker",
                json!({ "subject": null }),
            )
        })
        .child(options)
        .into_any_element(),
    )
}

#[derive(Clone, Copy)]
pub struct EditorActions {
    pub mode: &'static str,
    pub save: &'static str,
    pub cancel: &'static str,
}

impl EditorActions {
    pub const SUMMARY: EditorActions = EditorActions {
        mode: "pullRequestSummaryEditorMode",
        save: "pullRequestSummaryEditorSave",
        cancel: "pullRequestSummaryEditorCancel",
    };
    pub const TIMELINE: EditorActions = EditorActions {
        mode: "pullRequestTimelineEditorMode",
        save: "pullRequestTimelineEditorSave",
        cancel: "pullRequestTimelineEditorCancel",
    };
}

pub fn markdown_editor(
    actions: EditorActions,
    state: &Entity<TextareaState>,
    editor: &MarkdownEditorView,
    saving: bool,
    client: &Entity<CoreClient>,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let t = &theme::active(cx);
    let model = &editor.model;
    let mode_client = client.clone();
    let modes = ToggleGroup::new("pr-editor-mode")
        .variant(ToggleVariant::Segmented)
        .size(ToggleSize::Segmented)
        .flex_none()
        .items(model.modes.iter().map(|mode| {
            let client = mode_client.clone();
            let value = mode.value.clone();
            Toggle::new(SharedString::from(format!("pr-editor-mode-{}", mode.value)))
                .pressed(mode.value == model.mode)
                .disabled(model.mode_disabled)
                .label(SharedString::from(mode.label.clone()))
                .on_change(move |_, _, _, cx| {
                    act(&client, cx, actions.mode, json!({ "mode": value }))
                })
        }));
    let content = if model.mode == "preview" {
        div()
            .rounded(px(radius::LG))
            .border_1()
            .border_color(fade(t.border, 0.6))
            .px(px(12.))
            .py(px(8.))
            .child(match editor.preview.as_ref() {
                Some(preview) if !model.empty => {
                    body_view("pr-editor-preview", preview, client, t, window, cx)
                }
                _ => div()
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.muted_foreground)
                    .child(SharedString::from(model.empty_preview_label.clone()))
                    .into_any_element(),
            })
            .into_any_element()
    } else {
        Textarea::new(state)
            .size(TextareaSize::Sm)
            .disabled(saving)
            .into_any_element()
    };
    let cancel = client.clone();
    let save = client.clone();
    let save_state = state.clone();
    let key_state = state.clone();
    let key_client = client.clone();
    let save_disabled = model.save_disabled;
    div()
        .flex()
        .flex_col()
        .gap(px(8.))
        .capture_key_down(move |event: &KeyDownEvent, _, cx| {
            let keystroke = &event.keystroke;
            let modifiers = keystroke.modifiers;
            if keystroke.key == "enter"
                && (modifiers.platform || modifiers.control)
                && !modifiers.shift
                && !modifiers.alt
            {
                cx.stop_propagation();
                if !save_disabled && !event.is_held {
                    let text = key_state.read(cx).value().to_string();
                    act(&key_client, cx, actions.save, json!({ "text": text }));
                }
            } else if keystroke.key == "escape" && !saving {
                cx.stop_propagation();
                act(&key_client, cx, actions.cancel, json!({}));
            }
        })
        .child(modes)
        .child(content)
        .child(
            div()
                .flex()
                .justify_end()
                .gap(px(8.))
                .child(
                    Button::new("pr-editor-cancel")
                        .size(ButtonSize::Xs)
                        .variant(ButtonVariant::Ghost)
                        .disabled(model.cancel_disabled)
                        .label(model.cancel_label.clone())
                        .on_click(move |_, _, cx| act(&cancel, cx, actions.cancel, json!({}))),
                )
                .child(
                    Button::new("pr-editor-save")
                        .size(ButtonSize::Xs)
                        .variant(ButtonVariant::Outline)
                        .disabled(model.save_disabled)
                        .label(model.save_label.clone())
                        .on_click(move |_, _, cx| {
                            let text = save_state.read(cx).value().to_string();
                            act(&save, cx, actions.save, json!({ "text": text }))
                        }),
                ),
        )
        .into_any_element()
}
