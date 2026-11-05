use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use gpui::component::input::{InputEvent, InputState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, AppContext, ClickEvent, Context, ElementId, Entity, FontWeight, InteractiveElement,
    IntoElement, ParentElement, Render, SharedString, StatefulInteractiveElement, Styled, Window,
    div, linear_color_stop, linear_gradient, px,
};
use serde_json::json;

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::pull_requests::PullRequestGlyphId;
use crate::app_core::views::thread_pull_requests::{
    LinkPullRequestDialogView, ThreadPullRequestRowView, ThreadPullRequestsView,
};
use crate::features::chat::toolbar_parts::act;
use crate::features::pull_requests::detail_parts::{middle_truncate, unavailable_state};
use crate::features::pull_requests::filters::record;
use crate::features::pull_requests::presentation::{
    TEXT_2XS, avatar, diff_stat, glyph_path, path_icon, signal_icon, tone,
};
use crate::features::pull_requests::row::AnchorBounds;
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::dialog::{
    DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle,
};
use crate::ui::input::Input;
use crate::ui::menu::{MenuItem, MenuPopup};
use crate::ui::popover::{Align, Side};
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const LIST_PADDING: f32 = 6.;
const ROW_GAP: f32 = 8.;
const ROW_PADDING_Y: f32 = 4.;
const ROW_PADDING_RIGHT: f32 = 4.;
const CONNECTOR_HEIGHT: f32 = 24.;
const CONNECTOR_OFFSET: f32 = 8.;
const GLYPH: f32 = 16.;
const CONFLICT: f32 = 12.;
const CONFLICT_OFFSET: f32 = -4.;
const LINE_GAP: f32 = 6.;
const SIGNAL_GAP: f32 = 4.;
const SIGNAL_ICON: f32 = 14.;
const STACK_ICON: f32 = 12.;
const AVATAR: f32 = 14.;
const AUTHOR_LABEL_MAX: f32 = 112.;
const REPOSITORY_MAX: f32 = 128.;
const BASE_SHARE: f32 = 0.45;
const ACTIONS_PADDING_LEFT: f32 = 20.;
const ACTIONS_FADE: f32 = 16.;
const ACTIONS_BOTTOM: f32 = 2.;
const MENU_ICON: f32 = 14.;
const EMPTY_PADDING: f32 = 24.;
const EMPTY_ICON: f32 = 24.;
const EMPTY_DESCRIPTION_MAX: f32 = 240.;
const FOOTER_PADDING_X: f32 = 8.;
const FOOTER_PADDING_Y: f32 = 6.;
const DIALOG_WIDTH: f32 = 576.;

pub struct ThreadPullRequestsSurface {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<ThreadPullRequestsView>>>,
    dialog: Entity<ViewState<Option<LinkPullRequestDialogView>>>,
    bounds: AnchorBounds,
    menu: Option<String>,
    input: Option<Entity<InputState>>,
    applied_dialog: Option<u64>,
}

fn menu_anchor(key: &str) -> String {
    format!("thread-pr-menu:{key}")
}

impl ThreadPullRequestsSurface {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<ThreadPullRequestsView>>(
            &client,
            "threadPullRequests",
            json!({}),
            cx,
        );
        cx.observe(&view, |_, _, cx| cx.notify()).detach();
        let dialog = CoreClient::subscribe::<Option<LinkPullRequestDialogView>>(
            &client,
            "linkPullRequestDialog",
            json!({}),
            cx,
        );
        cx.observe(&dialog, |_, _, cx| cx.notify()).detach();
        Self {
            client,
            view,
            dialog,
            bounds: Rc::new(RefCell::new(HashMap::new())),
            menu: None,
            input: None,
            applied_dialog: None,
        }
    }

    fn sync_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.input.is_none() {
            let input = cx.new(|cx| InputState::new(window, cx));
            let client = self.client.clone();
            cx.subscribe_in(
                &input,
                window,
                move |_, state, event: &InputEvent, _, cx| match event {
                    InputEvent::Change => {
                        let text = state.read(cx).value().to_string();
                        act(
                            &client,
                            cx,
                            "linkPullRequestDialogInput",
                            json!({ "text": text }),
                        );
                    }
                    InputEvent::PressEnter { .. } => {
                        act(&client, cx, "linkPullRequestDialogSubmit", json!({}));
                    }
                    _ => {}
                },
            )
            .detach();
            self.input = Some(input);
        }
        let revision = self
            .dialog
            .read(cx)
            .data
            .as_ref()
            .and_then(Option::as_ref)
            .map(|dialog| (dialog.revision, dialog.input_placeholder.clone()));
        match revision {
            Some((revision, placeholder)) if self.applied_dialog != Some(revision) => {
                self.applied_dialog = Some(revision);
                if let Some(input) = self.input.as_ref() {
                    input.update(cx, |state, cx| {
                        state.set_placeholder(placeholder, window, cx);
                        state.set_value(String::new(), window, cx);
                        state.focus(window, cx);
                    });
                }
            }
            Some(_) => {}
            None => self.applied_dialog = None,
        }
    }

    fn glyph(&self, row: &ThreadPullRequestRowView, t: &Tokens) -> AnyElement {
        let Some(state) = row.state.as_ref() else {
            let waiting = row.waiting_aria_label.clone().unwrap_or_default();
            return div()
                .id(ElementId::Name(SharedString::from(format!(
                    "thread-pr-waiting-{}",
                    row.key
                ))))
                .flex()
                .flex_none()
                .tooltip(Tooltip::text(SharedString::from(waiting)))
                .child(path_icon(
                    glyph_path(PullRequestGlyphId::PullRequest),
                    GLYPH,
                    t.muted_foreground,
                ))
                .into_any_element();
        };
        let background = t.background;
        div()
            .flex()
            .flex_col()
            .flex_none()
            .items_center()
            .w(px(GLYPH))
            .child(
                div()
                    .relative()
                    .flex()
                    .child(
                        div()
                            .id(ElementId::Name(SharedString::from(format!(
                                "thread-pr-state-{}",
                                row.key
                            ))))
                            .flex()
                            .flex_none()
                            .tooltip(Tooltip::text(SharedString::from(state.label.clone())))
                            .child(path_icon(
                                glyph_path(state.icon),
                                GLYPH,
                                tone(&state.tone_class_name, t),
                            )),
                    )
                    .when_some(row.conflict.as_ref(), |this, conflict| {
                        this.child(
                            div()
                                .id(ElementId::Name(SharedString::from(format!(
                                    "thread-pr-conflict-{}",
                                    row.key
                                ))))
                                .absolute()
                                .right(px(CONFLICT_OFFSET))
                                .bottom(px(CONFLICT_OFFSET))
                                .size(px(CONFLICT))
                                .tooltip(Tooltip::text(SharedString::from(conflict.label.clone())))
                                .child(
                                    path_icon(
                                        "icons/pull-requests/triangle-fill.svg",
                                        CONFLICT,
                                        background,
                                    )
                                    .absolute()
                                    .top_0()
                                    .left_0(),
                                )
                                .child(
                                    path_icon(
                                        "icons/pull-requests/triangle-alert-bold.svg",
                                        CONFLICT,
                                        tone(&conflict.tone_class_name, t),
                                    )
                                    .absolute()
                                    .top_0()
                                    .left_0(),
                                ),
                        )
                    }),
            )
            .into_any_element()
    }

    fn signal(id: String, label: &str, icon: &str, tone_class: &str, t: &Tokens) -> AnyElement {
        div()
            .id(ElementId::Name(SharedString::from(id.clone())))
            .flex()
            .flex_none()
            .tooltip(Tooltip::text(SharedString::from(label.to_string())))
            .child(signal_icon(
                ElementId::Name(SharedString::from(format!("{id}-spin"))),
                icon,
                SIGNAL_ICON,
                tone(tone_class, t),
            ))
            .into_any_element()
    }

    fn row(
        &self,
        row: &ThreadPullRequestRowView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let group = SharedString::from(format!("thread-pr-row-{}", row.key));
        let hover_bg = fade(t.accent, 0.6);
        let open_client = self.client.clone();
        let open_key = row.key.clone();
        let menu_open = self.menu.as_deref() == Some(row.key.as_str());
        let mut signals: Vec<AnyElement> = Vec::new();
        if let Some(checks) = row.checks.as_ref() {
            signals.push(Self::signal(
                format!("thread-pr-checks-{}", row.key),
                &checks.label,
                &checks.icon,
                &checks.tone_class_name,
                t,
            ));
        }
        if let Some(review) = row.review_decision.as_ref() {
            signals.push(Self::signal(
                format!("thread-pr-review-{}", row.key),
                &review.label,
                &review.icon,
                &review.tone_class_name,
                t,
            ));
        }
        let first_line = div()
            .flex()
            .min_w_0()
            .items_center()
            .gap(px(LINE_GAP))
            .child(
                div()
                    .id(ElementId::Name(SharedString::from(format!(
                        "thread-pr-number-{}",
                        row.key
                    ))))
                    .flex_none()
                    .font_family(MONO_FONT)
                    .font_features(theme::tabular())
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.muted_foreground)
                    .tooltip(Tooltip::text(SharedString::from(
                        row.number_tooltip.clone(),
                    )))
                    .child(SharedString::from(row.number_label.clone())),
            )
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .text_size(px(text::SM))
                    .line_height(px(text::SM_LINE))
                    .text_color(t.foreground)
                    .child(SharedString::from(row.title.clone())),
            )
            .when(!signals.is_empty(), |this| {
                this.child(
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .gap(px(SIGNAL_GAP))
                        .children(signals),
                )
            })
            .when_some(row.diff_stat.as_ref(), |this, stat| {
                this.child(
                    div()
                        .ml_auto()
                        .flex()
                        .flex_none()
                        .items_center()
                        .font_family(MONO_FONT)
                        .child(diff_stat(
                            &stat.additions,
                            &stat.deletions,
                            TEXT_2XS,
                            16.,
                            t,
                        )),
                )
            });
        let mut meta = div()
            .flex()
            .min_w_0()
            .items_center()
            .gap(px(LINE_GAP))
            .overflow_hidden()
            .text_size(px(TEXT_2XS))
            .line_height(px(16.))
            .text_color(t.muted_foreground);
        if let Some(stack) = row.stack.as_ref() {
            meta = meta.child(
                div()
                    .id(ElementId::Name(SharedString::from(format!(
                        "thread-pr-stack-{}",
                        row.key
                    ))))
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(2.))
                    .text_color(fade(t.foreground, 0.7))
                    .tooltip(Tooltip::text(SharedString::from(stack.tooltip.clone())))
                    .child(path_icon(
                        glyph_path(PullRequestGlyphId::Stack),
                        STACK_ICON,
                        fade(t.foreground, 0.7),
                    ))
                    .child(SharedString::from(stack.size_label.clone())),
            );
        }
        if let Some(author) = row.author.as_ref() {
            meta = meta.child(
                div()
                    .id(ElementId::Name(SharedString::from(format!(
                        "thread-pr-author-{}",
                        row.key
                    ))))
                    .flex()
                    .flex_none()
                    .min_w_0()
                    .items_center()
                    .gap(px(4.))
                    .tooltip(Tooltip::text(SharedString::from(author.tooltip.clone())))
                    .child(avatar(author, AVATAR, t))
                    .child(
                        div()
                            .min_w_0()
                            .max_w(px(AUTHOR_LABEL_MAX))
                            .truncate()
                            .child(SharedString::from(author.login.clone())),
                    ),
            );
        }
        if let Some(repository) = row.repository.as_ref() {
            meta = meta.child(
                div()
                    .id(ElementId::Name(SharedString::from(format!(
                        "thread-pr-repository-{}",
                        row.key
                    ))))
                    .flex()
                    .min_w_0()
                    .max_w(px(REPOSITORY_MAX))
                    .font_family(MONO_FONT)
                    .tooltip(Tooltip::text(SharedString::from(repository.label.clone())))
                    .child(middle_truncate(
                        &repository.label,
                        repository.split.as_ref(),
                    )),
            );
        }
        if let Some(branches) = row.branches.as_ref() {
            meta = meta.child(
                div()
                    .flex()
                    .min_w_0()
                    .items_center()
                    .gap(px(4.))
                    .font_family(MONO_FONT)
                    .child(middle_truncate(
                        &branches.head,
                        branches.head_split.as_ref(),
                    ))
                    .child(div().flex_none().child("→"))
                    .child(
                        div()
                            .flex()
                            .flex_none()
                            .max_w(gpui::relative(BASE_SHARE))
                            .child(middle_truncate(
                                &branches.base,
                                branches.base_split.as_ref(),
                            )),
                    ),
            );
        }
        if let Some(label) = row.host_repository_label.as_ref() {
            meta = meta.child(
                div()
                    .min_w_0()
                    .truncate()
                    .font_family(MONO_FONT)
                    .child(SharedString::from(label.clone())),
            );
        }
        if let Some(updated) = row.updated_label.as_ref() {
            meta = meta.child(
                div()
                    .ml_auto()
                    .flex_none()
                    .whitespace_nowrap()
                    .font_features(theme::tabular())
                    .child(SharedString::from(updated.clone())),
            );
        }
        let lines = div()
            .id(ElementId::Name(SharedString::from(format!(
                "thread-pr-open-{}",
                row.key
            ))))
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .cursor_pointer()
            .on_click(move |event: &ClickEvent, _, cx| {
                let modifiers = event.modifiers();
                act(
                    &open_client,
                    cx,
                    "threadPullRequestsOpen",
                    json!({
                        "key": open_key,
                        "external": modifiers.platform || modifiers.control,
                    }),
                );
            })
            .child(first_line)
            .child(meta);
        let tab = cx.entity().downgrade();
        let menu_key = row.key.clone();
        let accent = hover_bg;
        let background = t.background;
        let actions = div()
            .absolute()
            .right_0()
            .bottom(px(ACTIONS_BOTTOM))
            .flex()
            .items_center()
            .rounded_r(px(radius::MD))
            .pl(px(ACTIONS_PADDING_LEFT))
            .pr(px(4.))
            .bg(linear_gradient(
                90.,
                linear_color_stop(fade(background, 0.), 0.),
                linear_color_stop(background, ACTIONS_FADE / 44.),
            ))
            .when(!menu_open, |this| {
                this.invisible()
                    .group_hover(group.clone(), |style| style.visible())
            })
            .child(
                div()
                    .absolute()
                    .top_0()
                    .left_0()
                    .size_full()
                    .rounded_r(px(radius::MD))
                    .bg(linear_gradient(
                        90.,
                        linear_color_stop(fade(accent, 0.), 0.),
                        linear_color_stop(accent, ACTIONS_FADE / 44.),
                    )),
            )
            .child(
                div()
                    .relative()
                    .child(
                        Button::new(SharedString::from(format!("thread-pr-actions-{}", row.key)))
                            .size(ButtonSize::IconMicro)
                            .variant(ButtonVariant::Ghost)
                            .pressed(menu_open)
                            .icon("ellipsis")
                            .icon_size(MENU_ICON)
                            .accessibility_label(row.actions_aria_label.clone())
                            .on_click(move |_, _, cx| {
                                cx.stop_propagation();
                                let key = menu_key.clone();
                                let _ = tab.update(cx, |surface, cx| {
                                    surface.menu = if surface.menu.as_deref() == Some(key.as_str())
                                    {
                                        None
                                    } else {
                                        Some(key)
                                    };
                                    cx.notify();
                                });
                            }),
                    )
                    .child(record(&self.bounds, menu_anchor(&row.key))),
            );
        let left = if row.shows_connector {
            row.indent + 1.
        } else {
            row.indent
        };
        div()
            .id(ElementId::Name(group.clone()))
            .group(group.clone())
            .relative()
            .flex()
            .w_full()
            .items_center()
            .gap(px(ROW_GAP))
            .rounded(px(radius::MD))
            .py(px(ROW_PADDING_Y))
            .pr(px(ROW_PADDING_RIGHT))
            .pl(px(left))
            .when(menu_open, |this| this.bg(hover_bg))
            .hover(move |style| style.bg(hover_bg))
            .when(row.shows_connector, |this| {
                this.child(
                    div()
                        .absolute()
                        .left(px(row.indent - CONNECTOR_OFFSET))
                        .top_0()
                        .bottom_0()
                        .flex()
                        .items_center()
                        .child(
                            div()
                                .w(px(1.))
                                .h(px(CONNECTOR_HEIGHT))
                                .bg(fade(t.border, 0.7)),
                        ),
                )
            })
            .child(self.glyph(row, t))
            .child(lines)
            .child(actions)
            .into_any_element()
    }

    fn menu_popup(
        &self,
        rows: &[ThreadPullRequestRowView],
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let key = self.menu.clone()?;
        let row = rows.iter().find(|row| row.key == key)?;
        let trigger = *self.bounds.borrow().get(&menu_anchor(&key))?;
        let close = |surface: &mut Self, cx: &mut Context<Self>| {
            surface.menu = None;
            cx.notify();
        };
        let item = |id: &str, icon: &str, label: &str, action: &'static str, params| {
            let client = self.client.clone();
            let tab = cx.entity().downgrade();
            MenuItem::new(SharedString::from(format!("thread-pr-menu-{id}-{key}")))
                .icon(SharedString::from(icon.to_string()))
                .label(SharedString::from(label.to_string()))
                .on_click(move |_, _, cx| {
                    act(&client, cx, action, serde_json::Value::clone(&params));
                    let _ = tab.update(cx, close);
                })
                .into_any_element()
        };
        let items = vec![
            item(
                "copy",
                "link",
                &row.copy_label,
                "threadPullRequestsCopy",
                json!({ "key": key }),
            ),
            item(
                "open",
                "arrow-up-right",
                &row.open_label,
                "threadPullRequestsOpen",
                json!({ "key": key, "external": false }),
            ),
            item(
                "unlink",
                "unlink-2",
                &row.unlink_label,
                "threadPullRequestsUnlink",
                json!({ "key": key }),
            ),
        ];
        let dismiss = cx.entity().downgrade();
        Some(
            MenuPopup::new("thread-pr-menu", trigger)
                .side(Side::Bottom)
                .align(Align::End)
                .on_dismiss(move |_, cx| {
                    let _ = dismiss.update(cx, close);
                })
                .children(items)
                .into_any_element(),
        )
    }

    fn link_button(
        id: &'static str,
        label: &str,
        size: ButtonSize,
        variant: ButtonVariant,
        client: &Entity<CoreClient>,
    ) -> Button {
        let client = client.clone();
        Button::new(id)
            .size(size)
            .variant(variant)
            .icon("plus")
            .icon_size(MENU_ICON)
            .label(label.to_string())
            .on_click(move |_, _, cx| act(&client, cx, "linkPullRequestDialogOpen", json!({})))
    }

    fn dialog(&self, dialog: &LinkPullRequestDialogView, t: &Tokens) -> Option<AnyElement> {
        let input = self.input.as_ref()?;
        let close = self.client.clone();
        let cancel = self.client.clone();
        let submit = self.client.clone();
        Some(
            DialogPopup::new("link-pull-request-dialog")
                .max_width(DIALOG_WIDTH)
                .show_close_button(dialog.dismissible)
                .on_close(move |_, cx| act(&close, cx, "linkPullRequestDialogClose", json!({})))
                .child(
                    DialogHeader::new()
                        .child(DialogTitle::new(dialog.title.clone()))
                        .child(DialogDescription::new(dialog.description.clone())),
                )
                .child(
                    DialogPanel::new("link-pull-request-panel")
                        .after_header(true)
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(8.))
                                .child(Input::new(input))
                                .when_some(dialog.preview.as_ref(), |this, preview| {
                                    this.child(
                                        div()
                                            .truncate()
                                            .text_size(px(text::XS))
                                            .line_height(px(text::XS_LINE))
                                            .text_color(t.muted_foreground)
                                            .child(SharedString::from(preview.clone())),
                                    )
                                })
                                .when_some(dialog.error.as_ref(), |this, error| {
                                    this.child(
                                        div()
                                            .text_size(px(text::XS))
                                            .line_height(px(text::XS_LINE))
                                            .text_color(t.destructive_foreground)
                                            .child(SharedString::from(error.clone())),
                                    )
                                }),
                        ),
                )
                .child(
                    DialogFooter::new()
                        .child(
                            Button::new("link-pull-request-cancel")
                                .size(ButtonSize::Sm)
                                .variant(ButtonVariant::Outline)
                                .disabled(dialog.cancel_disabled)
                                .label(dialog.cancel_label.clone())
                                .on_click(move |_, _, cx| {
                                    act(&cancel, cx, "linkPullRequestDialogClose", json!({}))
                                }),
                        )
                        .child(
                            Button::new("link-pull-request-submit")
                                .size(ButtonSize::Sm)
                                .variant(ButtonVariant::Default)
                                .disabled(dialog.submit_disabled)
                                .label(dialog.submit_label.clone())
                                .on_click(move |_, _, cx| {
                                    act(&submit, cx, "linkPullRequestDialogSubmit", json!({}))
                                }),
                        ),
                )
                .into_any_element(),
        )
    }
}

impl Render for ThreadPullRequestsSurface {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.sync_dialog(window, cx);
        let t = theme::active(cx);
        let view = self.view.read(cx).data.clone().flatten();
        let dialog = self
            .dialog
            .read(cx)
            .data
            .clone()
            .flatten()
            .and_then(|dialog| self.dialog(&dialog, &t));
        let body = match view {
            None => div().size_full().into_any_element(),
            Some(ThreadPullRequestsView::Unsupported { title, description }) => {
                unavailable_state(&title, &description, None, None, &self.client, cx)
            }
            Some(ThreadPullRequestsView::Empty {
                title,
                description,
                action_label,
            }) => div()
                .size_full()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap(px(8.))
                .p(px(EMPTY_PADDING))
                .text_center()
                .child(path_icon(
                    glyph_path(PullRequestGlyphId::Link),
                    EMPTY_ICON,
                    fade(t.muted_foreground, 0.6),
                ))
                .child(
                    div()
                        .text_size(px(text::SM))
                        .line_height(px(text::SM_LINE))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.foreground)
                        .child(SharedString::from(title)),
                )
                .child(
                    div()
                        .max_w(px(EMPTY_DESCRIPTION_MAX))
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .text_color(t.muted_foreground)
                        .child(SharedString::from(description)),
                )
                .child(Self::link_button(
                    "thread-pr-empty-link",
                    &action_label,
                    ButtonSize::Sm,
                    ButtonVariant::Outline,
                    &self.client,
                ))
                .into_any_element(),
            Some(ThreadPullRequestsView::List {
                rows,
                footer_summary,
                action_label,
            }) => {
                if self
                    .menu
                    .as_ref()
                    .is_some_and(|key| !rows.iter().any(|row| &row.key == key))
                {
                    self.menu = None;
                }
                let elements: Vec<AnyElement> =
                    rows.iter().map(|row| self.row(row, &t, cx)).collect();
                let menu = self.menu_popup(&rows, cx);
                div()
                    .size_full()
                    .flex()
                    .flex_col()
                    .min_h_0()
                    .child(
                        div()
                            .id("thread-pr-list")
                            .flex_1()
                            .min_h_0()
                            .overflow_y_scroll()
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .p(px(LIST_PADDING))
                                    .children(elements),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_none()
                            .items_center()
                            .justify_between()
                            .border_t_1()
                            .border_color(fade(t.border, 0.6))
                            .px(px(FOOTER_PADDING_X))
                            .py(px(FOOTER_PADDING_Y))
                            .text_size(px(TEXT_2XS))
                            .line_height(px(16.))
                            .text_color(t.muted_foreground)
                            .child(SharedString::from(footer_summary))
                            .child(Self::link_button(
                                "thread-pr-footer-link",
                                &action_label,
                                ButtonSize::Xs,
                                ButtonVariant::Ghost,
                                &self.client,
                            )),
                    )
                    .children(menu)
                    .into_any_element()
            }
        };
        div()
            .size_full()
            .flex()
            .flex_col()
            .min_h_0()
            .bg(t.background)
            .child(body)
            .children(dialog)
    }
}
