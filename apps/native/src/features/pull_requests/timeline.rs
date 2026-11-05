use std::collections::HashSet;
use std::rc::Rc;

use gpui::component::input::{InputEvent, TextareaState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, AppContext, Context, Div, Entity, FontWeight, InteractiveElement, IntoElement,
    ParentElement, Render, SharedString, StatefulInteractiveElement, Styled, Subscription, Window,
    div, px,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::pull_request_timeline::{
    PullRequestTimelineView, TimelineBodyModel, TimelineCardModel, TimelineRowModel,
};
use crate::features::chat::toolbar_parts::act;
use crate::features::pull_requests::conversation::{
    EditorActions, body_view, markdown_editor, reaction_bar, reaction_picker_popup,
};
use crate::features::pull_requests::detail_parts::{ICON_SM, ICON_XS, meta_separator};
use crate::features::pull_requests::presentation::{
    TEXT_2XS, TEXT_3XS, avatar, diff_stat, glyph_path, path_icon, tone,
};
use crate::features::pull_requests::row::AnchorBounds;
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::theme;
use crate::ui::theme::metrics::text;
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const MARKER: f32 = 32.;
const MARKER_INNER: f32 = 28.;
const ROW_INSET: f32 = 48.;
const ROW_GAP: f32 = 20.;
const RAIL_LEFT: f32 = 15.;
const CONTENT_MAX: f32 = 768.;
const PINNED_MARKER_TOP: f32 = 8.;
const TEXT_2XS_LINE: f32 = 16.;
const TEXT_3XS_LINE: f32 = 14.;

pub struct PullRequestTimelineTab {
    client: Entity<CoreClient>,
    data: Option<Rc<PullRequestTimelineView>>,
    bounds: AnchorBounds,
    shown_url: Option<String>,
    open: HashSet<String>,
    editor: Option<Entity<TextareaState>>,
    applied_editor: Option<(String, u64)>,
    _subscriptions: Vec<Subscription>,
}

impl PullRequestTimelineTab {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<PullRequestTimelineView>>(
            &client,
            "pullRequestTimeline",
            json!({}),
            cx,
        );
        let subscription = cx.observe(&view, |tab, view, cx| {
            let data = view.update(cx, |state, _| state.data.take());
            let data = data.flatten().map(Rc::new);
            let url = data.as_ref().map(|view| view.url.clone());
            if url != tab.shown_url {
                tab.shown_url = url;
                tab.open.clear();
            }
            tab.data = data;
            cx.notify();
        });
        Self {
            client,
            data: None,
            bounds: AnchorBounds::default(),
            shown_url: None,
            open: HashSet::new(),
            editor: None,
            applied_editor: None,
            _subscriptions: vec![subscription],
        }
    }

    fn ensure_editor(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.editor.is_none() {
            let editor = cx.new(|cx| TextareaState::new(window, cx).auto_grow(6, 24));
            let client = self.client.clone();
            cx.subscribe_in(
                &editor,
                window,
                move |_, state: &Entity<TextareaState>, event: &InputEvent, _, cx| {
                    if let InputEvent::Change = event {
                        let text = state.read(cx).value().to_string();
                        act(
                            &client,
                            cx,
                            "pullRequestTimelineEditorDraft",
                            json!({ "text": text }),
                        );
                    }
                },
            )
            .detach();
            self.editor = Some(editor);
        }
        let editor = self.data.as_ref().and_then(|view| view.editor.clone());
        match editor {
            Some(editor) => {
                let key = (editor.target.clone(), editor.revision);
                if self.applied_editor.as_ref() != Some(&key) {
                    self.applied_editor = Some(key);
                    if let Some(state) = self.editor.as_ref() {
                        state.update(cx, |state, cx| {
                            state.set_value(editor.initial.clone(), window, cx);
                            state.set_placeholder("", window, cx);
                            state.focus(window, cx);
                        });
                    }
                }
            }
            None => self.applied_editor = None,
        }
    }

    fn marker_box(pinned: bool) -> Div {
        let base = div().absolute().left_0().w(px(MARKER));
        if pinned {
            base.top(px(PINNED_MARKER_TOP)).h(px(MARKER))
        } else {
            base.top_0().bottom_0()
        }
    }

    fn marker(
        &self,
        key: &str,
        fallback: AnyElement,
        pinned: bool,
        muted: bool,
        view: &PullRequestTimelineView,
        t: &Tokens,
    ) -> AnyElement {
        let content = match view.markers.get(key) {
            Some(actor) => div()
                .flex()
                .size(px(MARKER))
                .items_center()
                .justify_center()
                .bg(t.background)
                .when(muted, |this| this.opacity(0.45))
                .child(avatar(actor, MARKER_INNER, t))
                .into_any_element(),
            None => div()
                .flex()
                .size(px(MARKER))
                .items_center()
                .justify_center()
                .bg(t.background)
                .child(
                    div()
                        .flex()
                        .size(px(MARKER_INNER))
                        .items_center()
                        .justify_center()
                        .bg(t.background)
                        .child(fallback),
                )
                .into_any_element(),
        };
        Self::marker_box(pinned)
            .flex()
            .items_center()
            .child(content)
            .into_any_element()
    }

    fn body(
        &self,
        key: &str,
        body: &TimelineBodyModel,
        view: &PullRequestTimelineView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = theme::active(cx);
        let content = match view.bodies.get(key) {
            Some(document) if body.markdown => body_view(
                &format!("pr-timeline-body-{key}"),
                document,
                &self.client,
                &t,
                window,
                cx,
            ),
            _ => div()
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .text_color(t.muted_foreground)
                .child(SharedString::from(body.text.clone()))
                .into_any_element(),
        };
        div().mt(px(12.)).child(content).into_any_element()
    }

    fn open_button(&self, id: String, url: Option<&String>, label: &str) -> Option<AnyElement> {
        let url = url?.clone();
        let client = self.client.clone();
        Some(
            div()
                .id(SharedString::from(format!("{id}-tip")))
                .flex_none()
                .mr(px(-4.))
                .mt(px(-4.))
                .tooltip(Tooltip::text(SharedString::from(label.to_string())))
                .child(
                    Button::new(SharedString::from(id))
                        .size(ButtonSize::IconXs)
                        .variant(ButtonVariant::GhostMuted)
                        .icon("external-link")
                        .icon_size(ICON_XS)
                        .accessibility_label(label.to_string())
                        .on_click(move |_, _, cx| {
                            act(
                                &client,
                                cx,
                                "pullRequestDetailOpenUrl",
                                json!({ "url": url }),
                            )
                        }),
                )
                .into_any_element(),
        )
    }

    fn meta_line(time: &str, path: Option<&String>, t: &Tokens) -> AnyElement {
        div()
            .flex()
            .min_w_0()
            .flex_wrap()
            .items_center()
            .gap(px(6.))
            .text_size(px(TEXT_2XS))
            .line_height(px(TEXT_2XS_LINE))
            .text_color(t.muted_foreground)
            .child(SharedString::from(time.to_string()))
            .when_some(path, |this, path| {
                this.child(meta_separator(t).child("·")).child(
                    div()
                        .flex()
                        .min_w_0()
                        .items_center()
                        .gap(px(4.))
                        .child(path_icon(
                            "icons/file-code-corner.svg",
                            ICON_XS,
                            t.muted_foreground,
                        ))
                        .child(
                            div()
                                .min_w_0()
                                .truncate()
                                .child(SharedString::from(path.clone())),
                        ),
                )
            })
            .into_any_element()
    }

    fn reactions(
        &self,
        id: &str,
        subject: &str,
        view: &PullRequestTimelineView,
        t: &Tokens,
    ) -> Option<AnyElement> {
        let bar = view.reactions.get(subject)?;
        reaction_bar(id, subject, bar, &self.bounds, &self.client, t)
            .map(|bar| div().ml_auto().child(bar).into_any_element())
    }

    fn card(
        &self,
        card: &TimelineCardModel,
        view: &PullRequestTimelineView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = theme::active(cx);
        let group = SharedString::from(format!("pr-timeline-card-{}", card.key));
        let editing = view
            .editor
            .as_ref()
            .filter(|editor| editor.target == card.id && card.editable);
        let edit = (card.editable && editing.is_none()).then(|| {
            let client = self.client.clone();
            let target = card.id.clone();
            div()
                .flex()
                .flex_none()
                .mt(px(-4.))
                .opacity(0.)
                .group_hover(group.clone(), |style| style.opacity(1.))
                .child(
                    Button::new(SharedString::from(format!("pr-timeline-edit-{}", card.key)))
                        .size(ButtonSize::IconXs)
                        .variant(ButtonVariant::GhostMuted)
                        .icon("pencil")
                        .icon_size(ICON_XS)
                        .accessibility_label(card.edit_aria_label.clone())
                        .on_click(move |_, _, cx| {
                            act(
                                &client,
                                cx,
                                "pullRequestTimelineEdit",
                                json!({ "target": target }),
                            )
                        }),
                )
        });
        let content = match (editing, self.editor.as_ref()) {
            (Some(editor), Some(state)) => Some(
                div()
                    .px(px(8.))
                    .pb(px(8.))
                    .pt(px(12.))
                    .child(markdown_editor(
                        EditorActions::TIMELINE,
                        state,
                        editor,
                        view.saving,
                        &self.client,
                        window,
                        cx,
                    ))
                    .into_any_element(),
            ),
            _ => card.body.as_ref().map(|body| {
                div()
                    .px(px(8.))
                    .pb(px(8.))
                    .child(self.body(&card.key, body, view, window, cx))
                    .into_any_element()
            }),
        };
        div()
            .group(group)
            .py(px(8.))
            .child(
                div().px(px(8.)).child(
                    div()
                        .flex()
                        .min_w_0()
                        .flex_wrap()
                        .items_start()
                        .gap(px(8.))
                        .child(
                            div()
                                .min_w_0()
                                .flex_1()
                                .child(
                                    div()
                                        .flex()
                                        .min_w_0()
                                        .flex_wrap()
                                        .items_center()
                                        .gap_x(px(6.))
                                        .gap_y(px(4.))
                                        .text_size(px(text::XS))
                                        .line_height(px(text::XS_LINE))
                                        .child(
                                            div()
                                                .font_weight(FontWeight::SEMIBOLD)
                                                .text_color(t.foreground)
                                                .child(SharedString::from(
                                                    card.actor_login.clone(),
                                                )),
                                        )
                                        .child(
                                            div()
                                                .text_color(t.muted_foreground)
                                                .child(SharedString::from(card.title.clone())),
                                        )
                                        .when_some(
                                            card.review_state_label.as_ref(),
                                            |this, label| {
                                                this.child(
                                                    div()
                                                        .text_size(px(TEXT_3XS))
                                                        .font_weight(FontWeight::MEDIUM)
                                                        .text_color(t.muted_foreground)
                                                        .child(SharedString::from(label.clone())),
                                                )
                                            },
                                        ),
                                )
                                .child(div().mt(px(4.)).child(Self::meta_line(
                                    &card.time,
                                    card.path.as_ref(),
                                    &t,
                                ))),
                        )
                        .children(edit)
                        .children(self.reactions(
                            &format!("pr-timeline-reactions-{}", card.key),
                            &card.id,
                            view,
                            &t,
                        ))
                        .children(self.open_button(
                            format!("pr-timeline-open-{}", card.key),
                            card.url.as_ref(),
                            &card.open_aria_label,
                        )),
                ),
            )
            .children(content)
            .into_any_element()
    }

    fn row(
        &self,
        row: &TimelineRowModel,
        view: &PullRequestTimelineView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = theme::active(cx);
        match row {
            TimelineRowModel::Conversation {
                key,
                count_label,
                authors_label,
                cards,
            } => {
                let open = self.open.contains(key);
                let tab = cx.entity().downgrade();
                let toggle_key = key.clone();
                let fallback = path_icon("icons/message-square.svg", ICON_SM, t.muted_foreground)
                    .into_any_element();
                let cards = open.then(|| {
                    div()
                        .mt(px(4.))
                        .flex()
                        .flex_col()
                        .gap(px(4.))
                        .children(cards.iter().map(|card| self.card(card, view, window, cx)))
                });
                div()
                    .relative()
                    .mb(px(ROW_GAP))
                    .pl(px(ROW_INSET))
                    .child(self.marker(key, fallback, true, !open, view, &t))
                    .child(
                        div()
                            .id(SharedString::from(format!(
                                "pr-timeline-conversation-{key}"
                            )))
                            .flex()
                            .w_full()
                            .min_w_0()
                            .items_center()
                            .gap(px(12.))
                            .py(px(8.))
                            .cursor_pointer()
                            .when(!open, |this| {
                                this.opacity(0.55).hover(|style| style.opacity(1.))
                            })
                            .text_color(if open {
                                t.foreground
                            } else {
                                t.muted_foreground
                            })
                            .on_click(move |_, _, cx| {
                                let _ = tab.update(cx, |tab, cx| {
                                    if !tab.open.remove(&toggle_key) {
                                        tab.open.insert(toggle_key.clone());
                                    }
                                    cx.notify();
                                });
                            })
                            .child(
                                div()
                                    .min_w_0()
                                    .flex_1()
                                    .child(
                                        div()
                                            .text_size(px(text::XS))
                                            .line_height(px(text::XS_LINE))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .child(SharedString::from(count_label.clone())),
                                    )
                                    .child(
                                        div()
                                            .truncate()
                                            .text_size(px(TEXT_3XS))
                                            .line_height(px(TEXT_3XS_LINE))
                                            .text_color(t.muted_foreground)
                                            .child(SharedString::from(authors_label.clone())),
                                    ),
                            )
                            .child(path_icon(
                                if open {
                                    "icons/chevron-up.svg"
                                } else {
                                    "icons/chevron-down.svg"
                                },
                                ICON_SM,
                                t.muted_foreground,
                            )),
                    )
                    .children(cards)
                    .into_any_element()
            }
            TimelineRowModel::Commit {
                key,
                oid,
                aria_label,
                title,
                short_oid,
                time,
                diff_stat: stat,
            } => {
                let client = self.client.clone();
                let oid = oid.clone();
                let group = SharedString::from(format!("pr-timeline-commit-{key}"));
                let primary = t.primary;
                let fallback = path_icon(
                    "icons/git-commit-horizontal.svg",
                    ICON_SM,
                    t.muted_foreground,
                )
                .into_any_element();
                div()
                    .id(SharedString::from(format!("pr-timeline-commit-{key}")))
                    .group(group.clone())
                    .relative()
                    .mb(px(ROW_GAP))
                    .pl(px(ROW_INSET))
                    .w_full()
                    .rounded(px(2.))
                    .cursor_pointer()
                    .tooltip(Tooltip::text(SharedString::from(aria_label.clone())))
                    .on_click(move |_, _, cx| {
                        act(
                            &client,
                            cx,
                            "pullRequestTimelineOpenCommit",
                            json!({ "oid": oid }),
                        )
                    })
                    .child(self.marker(key, fallback, false, false, view, &t))
                    .child(
                        div()
                            .flex()
                            .min_w_0()
                            .items_center()
                            .gap(px(10.))
                            .py(px(6.))
                            .child(
                                div()
                                    .min_w_0()
                                    .flex_1()
                                    .child(
                                        div()
                                            .truncate()
                                            .text_size(px(text::XS))
                                            .line_height(px(text::XS_LINE))
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .text_color(t.foreground)
                                            .group_hover(group, move |style| {
                                                style.text_color(primary)
                                            })
                                            .child(SharedString::from(title.clone())),
                                    )
                                    .child(
                                        div()
                                            .mt(px(4.))
                                            .flex()
                                            .flex_wrap()
                                            .items_center()
                                            .gap_x(px(8.))
                                            .gap_y(px(2.))
                                            .text_size(px(TEXT_3XS))
                                            .line_height(px(TEXT_3XS_LINE))
                                            .text_color(t.muted_foreground)
                                            .child(
                                                div()
                                                    .font_family(MONO_FONT)
                                                    .child(SharedString::from(short_oid.clone())),
                                            )
                                            .child(SharedString::from(time.clone())),
                                    ),
                            )
                            .when_some(stat.as_ref(), |this, stat| {
                                this.child(div().ml_auto().flex_none().child(diff_stat(
                                    &stat.additions,
                                    &stat.deletions,
                                    TEXT_3XS,
                                    TEXT_3XS_LINE,
                                    &t,
                                )))
                            }),
                    )
                    .into_any_element()
            }
            TimelineRowModel::Verdict {
                key,
                id,
                actor_login,
                outcome,
                label,
                tone_class_name,
                stale,
                stale_tooltip,
                time,
                path,
                url,
                open_aria_label,
                body,
                ..
            } => {
                let (icon, icon_tone) = match outcome.as_str() {
                    "approved" => (
                        "icons/circle-check.svg",
                        tone("text-emerald-500 dark:text-emerald-400", &t),
                    ),
                    "changes-requested" => ("icons/circle-x.svg", t.destructive),
                    _ => ("icons/circle-dashed.svg", fade(t.muted_foreground, 0.7)),
                };
                let fallback = path_icon(icon, ICON_SM, icon_tone).into_any_element();
                let verdict = div()
                    .id(SharedString::from(format!("pr-timeline-verdict-{key}")))
                    .font_weight(FontWeight::MEDIUM)
                    .map(|this| {
                        if *stale {
                            this.text_color(t.muted_foreground)
                                .opacity(0.7)
                                .tooltip(Tooltip::text(SharedString::from(stale_tooltip.clone())))
                        } else {
                            this.text_color(tone(tone_class_name, &t))
                        }
                    })
                    .child(SharedString::from(label.to_lowercase()));
                div()
                    .group(SharedString::from(format!("pr-timeline-verdict-{key}")))
                    .relative()
                    .mb(px(ROW_GAP))
                    .pl(px(ROW_INSET))
                    .child(self.marker(key, fallback, true, false, view, &t))
                    .child(
                        div()
                            .flex()
                            .min_w_0()
                            .flex_wrap()
                            .items_start()
                            .gap(px(8.))
                            .py(px(6.))
                            .child(
                                div()
                                    .min_w_0()
                                    .flex_1()
                                    .child(
                                        div()
                                            .flex()
                                            .min_w_0()
                                            .flex_wrap()
                                            .items_center()
                                            .gap_x(px(6.))
                                            .gap_y(px(4.))
                                            .text_size(px(text::XS))
                                            .line_height(px(text::XS_LINE))
                                            .child(
                                                div()
                                                    .font_weight(FontWeight::SEMIBOLD)
                                                    .text_color(t.foreground)
                                                    .child(SharedString::from(actor_login.clone())),
                                            )
                                            .child(verdict),
                                    )
                                    .child(div().mt(px(2.)).child(Self::meta_line(
                                        time,
                                        path.as_ref(),
                                        &t,
                                    ))),
                            )
                            .children(self.reactions(
                                &format!("pr-timeline-verdict-reactions-{key}"),
                                id,
                                view,
                                &t,
                            ))
                            .children(self.open_button(
                                format!("pr-timeline-verdict-open-{key}"),
                                url.as_ref(),
                                open_aria_label,
                            )),
                    )
                    .children(
                        body.as_ref()
                            .map(|body| self.body(key, body, view, window, cx)),
                    )
                    .into_any_element()
            }
            TimelineRowModel::Lifecycle {
                key,
                icon,
                label,
                actor_login,
                time,
            } => {
                let fallback =
                    path_icon(glyph_path(*icon), ICON_SM, t.muted_foreground).into_any_element();
                div()
                    .relative()
                    .mb(px(ROW_GAP))
                    .pl(px(ROW_INSET))
                    .child(self.marker(key, fallback, false, false, view, &t))
                    .child(
                        div()
                            .py(px(6.))
                            .text_size(px(text::XS))
                            .line_height(px(text::XS_LINE))
                            .child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .items_center()
                                    .gap(px(6.))
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(t.foreground)
                                    .when_some(actor_login.as_ref(), |this, login| {
                                        this.child(SharedString::from(login.clone()))
                                    })
                                    .child(SharedString::from(label.clone())),
                            )
                            .child(
                                div()
                                    .mt(px(2.))
                                    .text_size(px(TEXT_2XS))
                                    .line_height(px(TEXT_2XS_LINE))
                                    .text_color(t.muted_foreground)
                                    .child(SharedString::from(time.clone())),
                            ),
                    )
                    .into_any_element()
            }
        }
    }
}

impl Render for PullRequestTimelineTab {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.ensure_editor(window, cx);
        let Some(view) = self.data.clone() else {
            return div().into_any_element();
        };
        let t = theme::active(cx);
        let rows: Vec<AnyElement> = view
            .model
            .rows
            .iter()
            .map(|row| self.row(row, &view, window, cx))
            .collect();
        let popup = view
            .active
            .then(|| {
                let subject = view.reaction_picker.as_ref()?;
                let bar = view.reactions.get(subject)?;
                reaction_picker_popup(subject, bar, &self.bounds, &self.client, &t)
            })
            .flatten();
        div()
            .px(px(16.))
            .py(px(20.))
            .child(
                div()
                    .mx_auto()
                    .w_full()
                    .max_w(px(CONTENT_MAX))
                    .child(
                        div()
                            .relative()
                            .child(
                                div()
                                    .absolute()
                                    .top(px(4.))
                                    .bottom(px(ROW_GAP))
                                    .left(px(RAIL_LEFT))
                                    .w(px(1.))
                                    .bg(fade(t.border, 0.45)),
                            )
                            .children(rows),
                    )
                    .when_some(view.model.empty_label.as_ref(), |this, empty| {
                        this.child(
                            div()
                                .flex()
                                .flex_col()
                                .items_center()
                                .justify_center()
                                .py(px(64.))
                                .text_center()
                                .text_color(t.muted_foreground)
                                .child(
                                    div().mb(px(8.)).child(path_icon(
                                        glyph_path(
                                            crate::app_core::views::pull_requests::PullRequestGlyphId::PullRequest,
                                        ),
                                        20.,
                                        t.muted_foreground,
                                    )),
                                )
                                .child(
                                    div()
                                        .text_size(px(text::XS))
                                        .line_height(px(text::XS_LINE))
                                        .child(SharedString::from(empty.clone())),
                                ),
                        )
                    }),
            )
            .children(popup)
            .into_any_element()
    }
}
