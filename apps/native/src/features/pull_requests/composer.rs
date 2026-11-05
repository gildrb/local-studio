use std::rc::Rc;

use gpui::component::input::{InputEvent, TextareaState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, AppContext, Context, Entity, FontWeight, InteractiveElement, IntoElement,
    KeyDownEvent, ParentElement, Render, SharedString, StatefulInteractiveElement, Styled,
    Subscription, Window, div, px,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::pull_request_composer::{
    ComposerCommentView, ComposerReviewView, PullRequestComposerView,
};
use crate::app_core::views::pull_requests::PullRequestGlyphId;
use crate::features::chat::toolbar_parts::act;
use crate::features::pull_requests::detail_parts::ICON_SM;
use crate::features::pull_requests::filters::record;
use crate::features::pull_requests::presentation::{TEXT_3XS, glyph_path, path_icon};
use crate::features::pull_requests::row::AnchorBounds;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::menu::{MenuPopup, MenuRadioItem};
use crate::ui::popover::{Align, PopoverPopup, PopoverTitle, PopoverWidth, Side};
use crate::ui::textarea::{Textarea, TextareaSize};
use crate::ui::theme;
use crate::ui::toggle::{Toggle, ToggleSize, ToggleVariant};
use crate::ui::toggle_group::ToggleGroup;
use crate::ui::tooltip::Tooltip;

const TRIGGER_ANCHOR: &str = "composer:trigger";
const VERDICT_ANCHOR: &str = "composer:verdict";
const TEXTAREA_ROWS: usize = 3;
const TEXTAREA_MAX_ROWS: usize = 12;
const POPUP_OFFSET: f32 = 8.;
const BADGE_SIZE: f32 = 14.;

fn verdict_icon(icon: &str) -> &'static str {
    match icon {
        "check" => "icons/check.svg",
        "x-circle" => "icons/circle-x.svg",
        _ => "icons/message-square.svg",
    }
}

pub struct PullRequestComposer {
    client: Entity<CoreClient>,
    data: Option<Rc<PullRequestComposerView>>,
    bounds: AnchorBounds,
    comment: Option<Entity<TextareaState>>,
    review: Option<Entity<TextareaState>>,
    applied_comment: Option<u64>,
    applied_review: Option<u64>,
    was_open: bool,
    verdict_open: bool,
    _subscriptions: Vec<Subscription>,
}

impl PullRequestComposer {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<PullRequestComposerView>>(
            &client,
            "pullRequestComposer",
            json!({}),
            cx,
        );
        let subscription = cx.observe(&view, |composer, view, cx| {
            let data = view.update(cx, |state, _| state.data.take());
            composer.data = data.flatten().map(Rc::new);
            if !composer.data.as_ref().is_some_and(|view| view.open) {
                composer.verdict_open = false;
            }
            cx.notify();
        });
        Self {
            client,
            data: None,
            bounds: AnchorBounds::default(),
            comment: None,
            review: None,
            applied_comment: None,
            applied_review: None,
            was_open: false,
            verdict_open: false,
            _subscriptions: vec![subscription],
        }
    }

    fn textarea(
        &self,
        action: &'static str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<TextareaState> {
        let state =
            cx.new(|cx| TextareaState::new(window, cx).auto_grow(TEXTAREA_ROWS, TEXTAREA_MAX_ROWS));
        let client = self.client.clone();
        cx.subscribe_in(
            &state,
            window,
            move |_, state: &Entity<TextareaState>, event: &InputEvent, _, cx| {
                if let InputEvent::Change = event {
                    let text = state.read(cx).value().to_string();
                    act(&client, cx, action, json!({ "text": text }));
                }
            },
        )
        .detach();
        state
    }

    fn sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.comment.is_none() {
            self.comment = Some(self.textarea("pullRequestComposerCommentDraft", window, cx));
        }
        if self.review.is_none() {
            self.review = Some(self.textarea("pullRequestComposerReviewSummary", window, cx));
        }
        let Some(view) = self.data.clone() else {
            self.was_open = false;
            return;
        };
        if self.applied_comment != Some(view.comment.revision) {
            self.applied_comment = Some(view.comment.revision);
            if let Some(state) = self.comment.as_ref() {
                let body = view.comment.body.clone();
                let placeholder = view.comment.model.placeholder.clone();
                state.update(cx, |state, cx| {
                    state.set_value(body, window, cx);
                    state.set_placeholder(placeholder, window, cx);
                });
            }
        }
        if let Some(review) = view.review.as_ref()
            && self.applied_review != Some(review.revision)
        {
            self.applied_review = Some(review.revision);
            if let Some(state) = self.review.as_ref() {
                let summary = review.summary.clone();
                let placeholder = review.model.summary_placeholder.clone();
                state.update(cx, |state, cx| {
                    state.set_value(summary, window, cx);
                    state.set_placeholder(placeholder, window, cx);
                });
            }
        }
        if view.open && !self.was_open {
            let target = if view.model.mode == "review" {
                self.review.as_ref()
            } else {
                self.comment.as_ref()
            };
            if let Some(state) = target {
                state.update(cx, |state, cx| state.focus(window, cx));
            }
        }
        self.was_open = view.open;
    }

    fn comment_form(&self, comment: &ComposerCommentView) -> Option<AnyElement> {
        let state = self.comment.as_ref()?;
        let model = &comment.model;
        let key_client = self.client.clone();
        let submit_client = self.client.clone();
        let follow_up = model.follow_up.as_ref().map(|follow_up| {
            let client = self.client.clone();
            let action = follow_up.action.clone();
            Button::new("pr-composer-follow-up")
                .size(ButtonSize::Xs)
                .variant(if follow_up.destructive {
                    ButtonVariant::DestructiveOutline
                } else {
                    ButtonVariant::Outline
                })
                .disabled(follow_up.disabled)
                .icon(glyph_path(if follow_up.action == "close" {
                    PullRequestGlyphId::Closed
                } else {
                    PullRequestGlyphId::Reopen
                }))
                .icon_size(ICON_SM)
                .label(follow_up.label.clone())
                .on_click(move |_, _, cx| {
                    act(
                        &client,
                        cx,
                        "pullRequestComposerCommentSubmit",
                        json!({ "action": action }),
                    )
                })
        });
        Some(
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
                        if !event.is_held {
                            act(
                                &key_client,
                                cx,
                                "pullRequestComposerCommentSubmit",
                                json!({ "action": "comment" }),
                            );
                        }
                    }
                })
                .child(
                    Textarea::new(state)
                        .size(TextareaSize::Sm)
                        .disabled(model.disabled),
                )
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .justify_end()
                        .gap(px(8.))
                        .children(follow_up)
                        .child(
                            Button::new("pr-composer-comment")
                                .size(ButtonSize::Xs)
                                .variant(ButtonVariant::Outline)
                                .disabled(model.submit.disabled)
                                .icon("send")
                                .icon_size(ICON_SM)
                                .label(model.submit.label.clone())
                                .on_click(move |_, _, cx| {
                                    act(
                                        &submit_client,
                                        cx,
                                        "pullRequestComposerCommentSubmit",
                                        json!({ "action": "comment" }),
                                    )
                                }),
                        ),
                )
                .into_any_element(),
        )
    }

    fn review_form(
        &self,
        review: &ComposerReviewView,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let state = self.review.as_ref()?;
        let model = &review.model;
        let composer = cx.entity().downgrade();
        let submit_client = self.client.clone();
        let verdict_open = self.verdict_open;
        let trigger = Button::new("pr-composer-verdict")
            .size(ButtonSize::Xs)
            .variant(ButtonVariant::Outline)
            .disabled(model.verdict_disabled)
            .pressed(verdict_open)
            .accessibility_label(model.verdict_aria_label.clone())
            .when_some(model.selected.as_ref(), |button, selected| {
                button
                    .icon(verdict_icon(&selected.icon))
                    .icon_size(ICON_SM)
                    .label(selected.label.clone())
            })
            .on_click(move |_, _, cx| {
                let _ = composer.update(cx, |composer, cx| {
                    composer.verdict_open = !composer.verdict_open;
                    cx.notify();
                });
            });
        Some(
            div()
                .flex()
                .flex_col()
                .child(
                    Textarea::new(state)
                        .size(TextareaSize::Sm)
                        .disabled(review.pending),
                )
                .child(
                    div()
                        .mt(px(8.))
                        .flex()
                        .justify_between()
                        .gap(px(8.))
                        .child(
                            div()
                                .relative()
                                .flex()
                                .min_w_0()
                                .child(trigger)
                                .child(record(&self.bounds, VERDICT_ANCHOR)),
                        )
                        .child(
                            Button::new("pr-composer-submit-review")
                                .size(ButtonSize::Xs)
                                .variant(ButtonVariant::Default)
                                .disabled(model.submit_disabled)
                                .label(model.submit_label.clone())
                                .on_click(move |_, _, cx| {
                                    act(
                                        &submit_client,
                                        cx,
                                        "pullRequestComposerReviewSubmit",
                                        json!({}),
                                    )
                                }),
                        ),
                )
                .into_any_element(),
        )
    }

    fn verdict_menu(
        &self,
        review: &ComposerReviewView,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        if !self.verdict_open {
            return None;
        }
        let trigger = *self.bounds.borrow().get(VERDICT_ANCHOR)?;
        let t = theme::active(cx);
        let selected = review
            .model
            .selected
            .as_ref()
            .map(|option| option.value.clone());
        let dismiss = cx.entity().downgrade();
        let items: Vec<AnyElement> = review
            .model
            .options
            .iter()
            .map(|option| {
                let client = self.client.clone();
                let value = option.value.clone();
                let composer = cx.entity().downgrade();
                MenuRadioItem::new(SharedString::from(format!(
                    "pr-composer-verdict-{}",
                    option.value
                )))
                .checked(selected.as_deref() == Some(option.value.as_str()))
                .on_click(move |_, _, cx| {
                    act(
                        &client,
                        cx,
                        "pullRequestComposerSetVerdict",
                        json!({ "verdict": value }),
                    );
                    let _ = composer.update(cx, |composer, cx| {
                        composer.verdict_open = false;
                        cx.notify();
                    });
                })
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .child(path_icon(verdict_icon(&option.icon), ICON_SM, t.foreground))
                        .child(SharedString::from(option.label.clone())),
                )
                .into_any_element()
            })
            .collect();
        Some(
            MenuPopup::new("pr-composer-verdict-menu", trigger)
                .side(Side::Top)
                .align(Align::Start)
                .on_dismiss(move |_, cx| {
                    let _ = dismiss.update(cx, |composer, cx| {
                        composer.verdict_open = false;
                        cx.notify();
                    });
                })
                .children(items)
                .into_any_element(),
        )
    }

    fn popup(&self, view: &PullRequestComposerView, cx: &mut Context<Self>) -> Option<AnyElement> {
        if !view.open {
            return None;
        }
        let trigger = *self.bounds.borrow().get(TRIGGER_ANCHOR)?;
        let model = &view.model;
        let header_left = match model.mode_toggle.as_ref() {
            Some(toggle) => ToggleGroup::new("pr-composer-mode")
                .variant(ToggleVariant::Segmented)
                .size(ToggleSize::Segmented)
                .flex_none()
                .items(toggle.options.iter().map(|option| {
                    let client = self.client.clone();
                    let value = option.value.clone();
                    Toggle::new(SharedString::from(format!(
                        "pr-composer-mode-{}",
                        option.value
                    )))
                    .pressed(option.value == model.mode)
                    .label(SharedString::from(option.label.clone()))
                    .on_change(move |_, _, _, cx| {
                        act(
                            &client,
                            cx,
                            "pullRequestComposerSetMode",
                            json!({ "mode": value }),
                        )
                    })
                }))
                .into_any_element(),
            None => PopoverTitle::new(model.title.clone()).into_any_element(),
        };
        let discard = model.discard.as_ref().map(|discard| {
            let client = self.client.clone();
            div()
                .id("pr-composer-discard-tip")
                .tooltip(Tooltip::text(SharedString::from(discard.label.clone())))
                .child(
                    Button::new("pr-composer-discard")
                        .size(ButtonSize::IconXs)
                        .variant(ButtonVariant::Ghost)
                        .disabled(view.review.as_ref().is_some_and(|review| review.pending))
                        .icon("icons/pull-requests/trash-2.svg")
                        .icon_size(ICON_SM)
                        .accessibility_label(discard.label.clone())
                        .on_click(move |_, _, cx| {
                            act(&client, cx, "pullRequestComposerDiscard", json!({}))
                        }),
                )
        });
        let close = self.client.clone();
        let dismiss = self.client.clone();
        let body = if model.mode == "review" {
            view.review
                .as_ref()
                .and_then(|review| self.review_form(review, cx))
        } else if model.can_comment {
            self.comment_form(&view.comment)
        } else {
            None
        };
        Some(
            PopoverPopup::new("pr-composer-popup", trigger)
                .side(Side::Top)
                .align(Align::End)
                .side_offset(POPUP_OFFSET)
                .width(PopoverWidth::Lg)
                .on_dismiss(move |_, cx| {
                    act(
                        &dismiss,
                        cx,
                        "pullRequestComposerOpen",
                        json!({ "open": false }),
                    )
                })
                .child(
                    div()
                        .mb(px(12.))
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap(px(8.))
                        .child(header_left)
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.))
                                .children(discard)
                                .child(
                                    Button::new("pr-composer-close")
                                        .size(ButtonSize::IconXs)
                                        .variant(ButtonVariant::Ghost)
                                        .icon("x")
                                        .icon_size(ICON_SM)
                                        .accessibility_label(model.close_label.clone())
                                        .on_click(move |_, _, cx| {
                                            act(
                                                &close,
                                                cx,
                                                "pullRequestComposerOpen",
                                                json!({ "open": false }),
                                            )
                                        }),
                                ),
                        ),
                )
                .children(body)
                .into_any_element(),
        )
    }
}

impl Render for PullRequestComposer {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.sync(window, cx);
        let Some(view) = self.data.clone() else {
            return div().into_any_element();
        };
        let t = theme::active(cx);
        let client = self.client.clone();
        let open = view.open;
        let badge = view.model.pending_badge.as_ref().map(|count| {
            div()
                .absolute()
                .top(px(-4.))
                .right(px(-4.))
                .flex()
                .h(px(BADGE_SIZE))
                .min_w(px(BADGE_SIZE))
                .items_center()
                .justify_center()
                .rounded_full()
                .bg(t.info)
                .px(px(4.))
                .text_size(px(TEXT_3XS))
                .line_height(px(BADGE_SIZE))
                .font_weight(FontWeight::SEMIBOLD)
                .font_features(theme::tabular())
                .text_color(gpui::white())
                .child(SharedString::from(count.clone()))
        });
        let popup = self.popup(&view, cx);
        let verdict = view
            .review
            .as_ref()
            .filter(|_| view.open && view.model.mode == "review")
            .and_then(|review| self.verdict_menu(review, cx));
        div()
            .id("pr-composer")
            .relative()
            .flex()
            .tooltip(Tooltip::text(SharedString::from(
                view.model.trigger_label.clone(),
            )))
            .child(
                Button::new("pr-composer-trigger")
                    .size(ButtonSize::Icon)
                    .variant(ButtonVariant::Glass)
                    .pressed(open)
                    .icon("message-square")
                    .icon_size(16.)
                    .accessibility_label(view.model.trigger_label.clone())
                    .on_click(move |_, _, cx| {
                        act(
                            &client,
                            cx,
                            "pullRequestComposerOpen",
                            json!({ "open": !open }),
                        )
                    }),
            )
            .children(badge)
            .child(record(&self.bounds, TRIGGER_ANCHOR))
            .children(popup)
            .children(verdict)
            .into_any_element()
    }
}
