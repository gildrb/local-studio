use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use gpui::component::input::{InputEvent, InputState, TextareaState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, Context, Entity, FontWeight, InteractiveElement, IntoElement,
    ParentElement, Render, ScrollHandle, SharedString, StatefulInteractiveElement, Styled,
    Subscription, Window, canvas, div, linear_color_stop, linear_gradient, px, relative,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::pull_request_summary::{
    BodyView, ChecksBodyModel, CommentCardModel, CommentGroupModel, MarkdownEditorView, PagerModel,
    PickerBodyModel, PickerModel, PickerView, PullRequestSummaryView, ReviewerEntryModel,
};
use crate::features::chat::toolbar_parts::act;
use crate::features::pull_requests::conversation::{
    EditorActions, body_view, markdown_editor, reaction_bar, reaction_picker_popup,
};
use crate::features::pull_requests::detail_parts::{
    AVATAR, ICON_SM, ICON_XS, INSET_X, activity_unavailable, actor_label, ghost_bar, small_meta,
};
use crate::features::pull_requests::filters::record;
use crate::features::pull_requests::presentation::{
    TEXT_3XS, avatar, hex_color, label_chip, path_icon, signal_icon, tone,
};
use crate::features::pull_requests::row::AnchorBounds;
use crate::features::pull_requests::sticky;
use crate::platform::MONO_FONT;
use crate::ui::badge::{Badge, BadgeSize, BadgeVariant};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::input::InputSize;
use crate::ui::input_group::{AddonAlign, InputGroup, InputGroupAddon};
use crate::ui::menu::{MenuItem, MenuPopup};
use crate::ui::popover::{Align, Side};
use crate::ui::theme;
use crate::ui::theme::color::{hsla, mix};
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const META_LABEL_WIDTH: f32 = 96.;
const META_ROW_HEIGHT: f32 = 24.;
const SECTION_HEADER: f32 = 40.;
const BODY_CLIP: f32 = 240.;
const BODY_FADE: f32 = 40.;
const PICKER_WIDTH: f32 = 288.;
const PICKER_LIST_MAX: f32 = 288.;
const LABEL_CHIP_MAX: f32 = 192.;
const EDITOR_MAX_ROWS: usize = 24;
const EDITOR_ROWS: usize = 6;
const REVIEWERS_ANCHOR: &str = "picker:reviewers";
const LABELS_ANCHOR: &str = "picker:labels";
const META_WIDTHS: [f32; 7] = [0.4, 1. / 3., 0.4, 0.25, 1. / 3., 0.4, 1. / 3.];

#[derive(Clone, Copy, PartialEq, Eq)]
enum Picker {
    Reviewers,
    Labels,
}

impl Picker {
    fn key(self) -> &'static str {
        match self {
            Picker::Reviewers => "reviewers",
            Picker::Labels => "labels",
        }
    }

    fn anchor(self) -> &'static str {
        match self {
            Picker::Reviewers => REVIEWERS_ANCHOR,
            Picker::Labels => LABELS_ANCHOR,
        }
    }
}

pub struct PullRequestSummaryTab {
    client: Entity<CoreClient>,
    data: Option<Rc<PullRequestSummaryView>>,
    bounds: AnchorBounds,
    scroll: ScrollHandle,
    sticky: AnchorBounds,
    shown_url: Option<String>,
    sections: HashMap<&'static str, bool>,
    finished_open: HashSet<String>,
    bots_open: bool,
    finished_group_open: bool,
    expanded: HashSet<String>,
    heights: Rc<RefCell<HashMap<String, f32>>>,
    editor: Option<Entity<TextareaState>>,
    applied_editor: Option<(String, u64)>,
    reviewer_input: Option<Entity<InputState>>,
    label_input: Option<Entity<InputState>>,
    open_pickers: HashSet<&'static str>,
    _subscriptions: Vec<Subscription>,
}

impl PullRequestSummaryTab {
    pub fn new(client: Entity<CoreClient>, scroll: ScrollHandle, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<PullRequestSummaryView>>(
            &client,
            "pullRequestSummary",
            json!({}),
            cx,
        );
        let subscription = cx.observe(&view, |tab, view, cx| {
            let data = view.update(cx, |state, _| state.data.take());
            tab.set_data(data.flatten().map(Rc::new), cx);
        });
        Self {
            client,
            data: None,
            bounds: AnchorBounds::default(),
            scroll,
            sticky: AnchorBounds::default(),
            shown_url: None,
            sections: HashMap::new(),
            finished_open: HashSet::new(),
            bots_open: false,
            finished_group_open: false,
            expanded: HashSet::new(),
            heights: Rc::new(RefCell::new(HashMap::new())),
            editor: None,
            applied_editor: None,
            reviewer_input: None,
            label_input: None,
            open_pickers: HashSet::new(),
            _subscriptions: vec![subscription],
        }
    }

    fn set_data(&mut self, data: Option<Rc<PullRequestSummaryView>>, cx: &mut Context<Self>) {
        let url = data.as_ref().map(|view| view.url.clone());
        if url != self.shown_url {
            self.shown_url = url;
            self.sections.clear();
            self.finished_open.clear();
            self.bots_open = false;
            self.finished_group_open = false;
            self.expanded.clear();
            self.heights.borrow_mut().clear();
        }
        self.data = data;
        cx.notify();
    }

    fn section_open(&self, key: &'static str) -> bool {
        self.sections.get(key).copied().unwrap_or(key != "checks")
    }

    fn ensure_inputs(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.editor.is_none() {
            let editor =
                cx.new(|cx| TextareaState::new(window, cx).auto_grow(EDITOR_ROWS, EDITOR_MAX_ROWS));
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
                            "pullRequestSummaryEditorDraft",
                            json!({ "text": text }),
                        );
                    }
                },
            )
            .detach();
            self.editor = Some(editor);
        }
        for picker in [Picker::Reviewers, Picker::Labels] {
            let slot = match picker {
                Picker::Reviewers => &mut self.reviewer_input,
                Picker::Labels => &mut self.label_input,
            };
            if slot.is_some() {
                continue;
            }
            let input = cx.new(|cx| InputState::new(window, cx));
            let client = self.client.clone();
            cx.subscribe_in(
                &input,
                window,
                move |tab: &mut Self, state: &Entity<InputState>, event: &InputEvent, _, cx| {
                    match event {
                        InputEvent::Change => {
                            let query = state.read(cx).value().to_string();
                            act(
                                &client,
                                cx,
                                "pullRequestSummaryPickerQuery",
                                json!({ "picker": picker.key(), "query": query }),
                            );
                        }
                        InputEvent::PressEnter { .. } => tab.select_first(picker, cx),
                        _ => {}
                    }
                },
            )
            .detach();
            *slot = Some(input);
        }
        let Some(view) = self.data.clone() else {
            return;
        };
        match view.editor.as_ref() {
            Some(editor) => {
                let key = (editor.target.clone(), editor.revision);
                if self.applied_editor.as_ref() != Some(&key) {
                    self.applied_editor = Some(key);
                    if let Some(state) = self.editor.as_ref() {
                        let initial = editor.initial.clone();
                        let placeholder = editor.placeholder.clone().unwrap_or_default();
                        state.update(cx, |state, cx| {
                            state.set_value(initial, window, cx);
                            state.set_placeholder(placeholder, window, cx);
                            state.focus(window, cx);
                        });
                    }
                }
            }
            None => self.applied_editor = None,
        }
        for (picker, model) in [
            (Picker::Reviewers, view.reviewers.as_ref()),
            (Picker::Labels, view.labels.as_ref()),
        ] {
            let open = model.is_some_and(|picker| picker.open);
            let was_open = self.open_pickers.contains(picker.key());
            if open && !was_open {
                self.open_pickers.insert(picker.key());
                let input = match picker {
                    Picker::Reviewers => self.reviewer_input.as_ref(),
                    Picker::Labels => self.label_input.as_ref(),
                };
                if let (Some(input), Some(model)) = (input, model) {
                    let query = model.query.clone();
                    input.update(cx, |state, cx| {
                        state.set_value(query, window, cx);
                        state.focus(window, cx);
                    });
                }
            } else if !open && was_open {
                self.open_pickers.remove(picker.key());
            }
        }
    }

    fn select_first(&mut self, picker: Picker, cx: &mut Context<Self>) {
        let Some(view) = self.data.as_ref() else {
            return;
        };
        let model = match picker {
            Picker::Reviewers => view.reviewers.as_ref(),
            Picker::Labels => view.labels.as_ref(),
        };
        if let Some(PickerView {
            model:
                PickerModel::Enabled {
                    rows,
                    rows_disabled: false,
                    body: PickerBodyModel::Rows,
                    ..
                },
            ..
        }) = model
            && let Some(row) = rows.first()
        {
            act(
                &self.client,
                cx,
                "pullRequestSummaryPickerSelect",
                json!({ "picker": picker.key(), "key": row.key }),
            );
        }
    }

    fn meta_row(icon: &'static str, label: &str, content: AnyElement, t: &Tokens) -> AnyElement {
        div()
            .flex()
            .min_w_0()
            .min_h(px(META_ROW_HEIGHT))
            .items_center()
            .gap(px(8.))
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .child(
                div()
                    .flex()
                    .flex_none()
                    .w(px(META_LABEL_WIDTH))
                    .items_center()
                    .gap(px(6.))
                    .text_color(t.muted_foreground)
                    .child(path_icon(icon, ICON_SM, t.muted_foreground))
                    .child(SharedString::from(label.to_string())),
            )
            .child(
                div()
                    .flex()
                    .min_w_0()
                    .flex_1()
                    .flex_wrap()
                    .items_center()
                    .text_color(t.foreground)
                    .child(content),
            )
            .into_any_element()
    }

    fn reviewer_avatar(entry: &ReviewerEntryModel, t: &Tokens) -> AnyElement {
        let ring = entry.outcome.as_deref().map(|outcome| {
            let base = match outcome {
                "approved" => tone("text-emerald-500 dark:text-emerald-400", t),
                "changes-requested" => t.destructive,
                _ => fade(t.muted_foreground, 0.6),
            };
            if entry.stale {
                mix(
                    base,
                    t.background,
                    if outcome == "dismissed" { 0.3 } else { 0.35 },
                )
            } else {
                base
            }
        });
        div()
            .id(SharedString::from(format!("pr-reviewer-{}", entry.key)))
            .flex()
            .flex_none()
            .rounded_full()
            .border_2()
            .border_color(ring.unwrap_or(t.background))
            .ml(px(-4.))
            .tooltip(Tooltip::text(SharedString::from(entry.tooltip.clone())))
            .child(avatar(&entry.avatar, AVATAR, t))
            .into_any_element()
    }

    fn picker_trigger(&self, picker: Picker, view: &PickerView, t: &Tokens) -> AnyElement {
        let (icon, label, disabled, tooltip) = match &view.model {
            PickerModel::Disabled {
                icon,
                label,
                tooltip,
            } => (icon.clone(), label.clone(), true, Some(tooltip.clone())),
            PickerModel::Enabled { icon, label, .. } => (icon.clone(), label.clone(), false, None),
        };
        let client = self.client.clone();
        let open = view.open;
        let _ = t;
        div()
            .id(SharedString::from(format!(
                "pr-picker-trigger-{}",
                picker.key()
            )))
            .relative()
            .flex()
            .flex_none()
            .tooltip(Tooltip::text(SharedString::from(
                tooltip.unwrap_or_else(|| label.clone()),
            )))
            .child(
                Button::new(SharedString::from(format!("pr-picker-{}", picker.key())))
                    .size(ButtonSize::IconXs)
                    .variant(ButtonVariant::Ghost)
                    .icon(icon)
                    .icon_size(ICON_SM)
                    .disabled(disabled)
                    .pressed(open)
                    .accessibility_label(label)
                    .on_click(move |_, _, cx| {
                        act(
                            &client,
                            cx,
                            "pullRequestSummaryPickerOpen",
                            json!({ "picker": picker.key(), "open": !open }),
                        )
                    }),
            )
            .child(record(&self.bounds, picker.anchor()))
            .into_any_element()
    }

    fn people_ghost(t: &Tokens) -> AnyElement {
        div()
            .p(px(4.))
            .flex()
            .flex_col()
            .gap(px(4.))
            .children((0..4).map(|index| {
                div()
                    .flex()
                    .h(px(28.))
                    .items_center()
                    .gap(px(8.))
                    .px(px(8.))
                    .child(ghost_bar(16., t).w(px(16.)).rounded_full())
                    .child(ghost_bar(12., t).w(relative(META_WIDTHS[index % META_WIDTHS.len()])))
            }))
            .into_any_element()
    }

    fn picker_popup(&self, picker: Picker, view: &PickerView, t: &Tokens) -> Option<AnyElement> {
        if !view.open {
            return None;
        }
        let PickerModel::Enabled {
            search_label,
            body,
            rows,
            rows_disabled,
            truncated_notice,
            ..
        } = &view.model
        else {
            return None;
        };
        let trigger = *self.bounds.borrow().get(picker.anchor())?;
        let input = match picker {
            Picker::Reviewers => self.reviewer_input.as_ref(),
            Picker::Labels => self.label_input.as_ref(),
        }?;
        let mut items: Vec<AnyElement> = vec![
            div()
                .p(px(4.))
                .pb(px(8.))
                .child(
                    InputGroup::input(input)
                        .size(InputSize::Compact)
                        .addon(InputGroupAddon::new(AddonAlign::InlineStart).icon("search")),
                )
                .into_any_element(),
        ];
        let mut list = div()
            .id(SharedString::from(format!(
                "pr-picker-list-{}",
                picker.key()
            )))
            .flex()
            .flex_col()
            .max_h(px(PICKER_LIST_MAX))
            .overflow_y_scroll();
        list = match body {
            PickerBodyModel::Loading => list.child(Self::people_ghost(t)),
            PickerBodyModel::Message { message } => list.child(
                div()
                    .p(px(8.))
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.muted_foreground)
                    .child(SharedString::from(message.clone())),
            ),
            PickerBodyModel::Rows => list.children(rows.iter().enumerate().map(|(index, row)| {
                let client = self.client.clone();
                let key = row.key.clone();
                let mut item = MenuItem::new(SharedString::from(format!(
                    "pr-picker-{}-{}",
                    picker.key(),
                    row.key
                )))
                .highlighted(index == 0)
                .disabled(*rows_disabled)
                .on_click(move |_, _, cx| {
                    act(
                        &client,
                        cx,
                        "pullRequestSummaryPickerSelect",
                        json!({ "picker": picker.key(), "key": key }),
                    )
                });
                match picker {
                    Picker::Reviewers => {
                        if let Some(actor) = row.actor.as_ref() {
                            item = item.child(
                                div()
                                    .flex()
                                    .flex_1()
                                    .min_w_0()
                                    .items_center()
                                    .gap(px(6.))
                                    .child(avatar(actor, AVATAR, t))
                                    .child(
                                        div()
                                            .min_w_0()
                                            .truncate()
                                            .font_weight(FontWeight::MEDIUM)
                                            .child(SharedString::from(actor.login.clone())),
                                    ),
                            );
                        }
                        if let Some(kind) = row.kind_label.as_ref() {
                            item = item.child(
                                div()
                                    .flex_none()
                                    .text_color(t.muted_foreground)
                                    .child(SharedString::from(kind.clone())),
                            );
                        }
                        if row.requested == Some(true) {
                            item = item.child(path_icon("icons/check.svg", ICON_SM, t.foreground));
                        }
                    }
                    Picker::Labels => {
                        let dot = row
                            .color
                            .as_deref()
                            .and_then(hex_color)
                            .unwrap_or(t.muted_foreground);
                        item = item
                            .child(div().flex_none().size(px(8.)).rounded_full().bg(dot))
                            .child(
                                div()
                                    .min_w_0()
                                    .flex_1()
                                    .truncate()
                                    .child(SharedString::from(row.name.clone().unwrap_or_default()))
                                    .when_some(row.description.as_ref(), |this, description| {
                                        this.child(
                                            div().text_color(t.muted_foreground).child(
                                                SharedString::from(format!(" · {description}")),
                                            ),
                                        )
                                    }),
                            );
                        if row.applied == Some(true) {
                            item = item.child(path_icon("icons/check.svg", ICON_SM, t.foreground));
                        }
                    }
                }
                item.into_any_element()
            })),
        };
        if let Some(notice) = truncated_notice {
            list = list.child(
                div()
                    .px(px(8.))
                    .py(px(6.))
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.muted_foreground)
                    .child(SharedString::from(notice.clone())),
            );
        }
        items.push(list.into_any_element());
        let _ = search_label;
        let client = self.client.clone();
        Some(
            MenuPopup::new(
                SharedString::from(format!("pr-picker-popup-{}", picker.key())),
                trigger,
            )
            .side(Side::Bottom)
            .align(Align::Start)
            .min_width(PICKER_WIDTH)
            .on_dismiss(move |_, cx| {
                act(
                    &client,
                    cx,
                    "pullRequestSummaryPickerOpen",
                    json!({ "picker": picker.key(), "open": false }),
                )
            })
            .children(items)
            .into_any_element(),
        )
    }

    fn meta(&self, view: &PullRequestSummaryView, t: &Tokens) -> AnyElement {
        let model = &view.model;
        let mut reviewers = div()
            .flex()
            .min_w_0()
            .flex_wrap()
            .items_center()
            .gap(px(6.));
        reviewers = match model.reviewers.empty_label.as_ref() {
            Some(empty) => reviewers.child(
                div()
                    .text_color(t.muted_foreground)
                    .child(SharedString::from(empty.clone())),
            ),
            None => reviewers.child(
                div().flex().items_center().pl(px(4.)).children(
                    model
                        .reviewers
                        .entries
                        .iter()
                        .map(|entry| Self::reviewer_avatar(entry, t)),
                ),
            ),
        };
        if let Some(picker) = view.reviewers.as_ref() {
            reviewers = reviewers.child(self.picker_trigger(Picker::Reviewers, picker, t));
        }
        let mut rows = div().flex().flex_col().gap(px(8.)).child(Self::meta_row(
            "icons/users.svg",
            &model.reviewers.label,
            reviewers.into_any_element(),
            t,
        ));
        if model.labels.visible {
            let mut labels = div()
                .flex()
                .min_w_0()
                .flex_wrap()
                .items_center()
                .gap(px(4.));
            labels = match model.labels.empty_label.as_ref() {
                Some(empty) => labels.child(
                    div()
                        .text_color(t.muted_foreground)
                        .child(SharedString::from(empty.clone())),
                ),
                None => labels.children(model.labels.chips.iter().map(|chip| {
                    label_chip(&chip.name, chip.color.as_deref(), None, LABEL_CHIP_MAX)
                        .size(BadgeSize::Default)
                })),
            };
            if let Some(picker) = view.labels.as_ref() {
                labels = labels.child(self.picker_trigger(Picker::Labels, picker, t));
            }
            rows = rows.child(Self::meta_row(
                "icons/tag.svg",
                &model.labels.label,
                labels.into_any_element(),
                t,
            ));
        }
        div()
            .px(px(INSET_X))
            .pt(px(10.))
            .pb(px(4.))
            .child(rows)
            .into_any_element()
    }

    fn section_header(
        &self,
        key: &'static str,
        title: &str,
        actions: Option<AnyElement>,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = theme::active(cx);
        let open = self.section_open(key);
        let tab = cx.entity().downgrade();
        let foreground = t.foreground;
        div()
            .flex()
            .w_full()
            .h(px(SECTION_HEADER))
            .items_center()
            .bg(t.background)
            .pr(px(INSET_X))
            .child(
                div()
                    .id(SharedString::from(format!("pr-summary-section-{key}")))
                    .flex()
                    .min_w_0()
                    .flex_1()
                    .items_center()
                    .gap(px(6.))
                    .px(px(INSET_X))
                    .py(px(12.))
                    .cursor_pointer()
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.muted_foreground)
                    .hover(move |style| style.text_color(foreground))
                    .on_click(move |_, _, cx| {
                        let _ = tab.update(cx, |tab, cx| {
                            let next = !tab.section_open(key);
                            if !next
                                && let Some(pinned) =
                                    sticky::pinned(&tab.sticky, &tab.scroll, [key], SECTION_HEADER)
                            {
                                sticky::anchor_collapse(&pinned, &tab.scroll);
                            }
                            tab.sections.insert(key, next);
                            cx.notify();
                        });
                    })
                    .child(SharedString::from(title.to_string()))
                    .child(path_icon(
                        if open {
                            "icons/chevron-down.svg"
                        } else {
                            "icons/chevron-right.svg"
                        },
                        ICON_SM,
                        fade(t.muted_foreground, 0.6),
                    )),
            )
            .children(actions)
            .into_any_element()
    }

    fn section(
        &self,
        key: &'static str,
        title: &str,
        actions: Option<AnyElement>,
        body: Option<AnyElement>,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let open = self.section_open(key);
        div()
            .relative()
            .flex()
            .flex_col()
            .child(record(&self.sticky, sticky::key(key)))
            .child(self.section_header(key, title, actions, cx))
            .when(open, |this| {
                this.children(body.map(|body| div().px(px(INSET_X)).pb(px(16.)).child(body)))
            })
            .into_any_element()
    }

    fn edit_button(&self, id: String, label: &str, target: String, group: &str) -> AnyElement {
        let client = self.client.clone();
        div()
            .flex()
            .flex_none()
            .opacity(0.)
            .group_hover(SharedString::from(group.to_string()), |style| {
                style.opacity(1.)
            })
            .child(
                Button::new(SharedString::from(id))
                    .size(ButtonSize::IconXs)
                    .variant(ButtonVariant::GhostMuted)
                    .icon("pencil")
                    .icon_size(ICON_XS)
                    .accessibility_label(label.to_string())
                    .on_click(move |_, _, cx| {
                        act(
                            &client,
                            cx,
                            "pullRequestSummaryEdit",
                            json!({ "target": target }),
                        )
                    }),
            )
            .into_any_element()
    }

    fn editor_view(
        &self,
        editor: &MarkdownEditorView,
        saving: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let Some(state) = self.editor.as_ref() else {
            return div().into_any_element();
        };
        markdown_editor(
            EditorActions::SUMMARY,
            state,
            editor,
            saving,
            &self.client,
            window,
            cx,
        )
    }

    fn clipped_body(
        &self,
        id: &str,
        body: &BodyView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = theme::active(cx);
        let expanded = self.expanded.contains(id);
        let measured = self.heights.borrow().get(id).copied().unwrap_or(0.);
        let overflowing = measured > BODY_CLIP;
        let heights = self.heights.clone();
        let tab = cx.entity().downgrade();
        let measure_key = id.to_string();
        let content = div()
            .flex_none()
            .w_full()
            .child(body_view(id, body, &self.client, &t, window, cx))
            .child(
                canvas(
                    move |bounds, _, cx| {
                        let height = f32::from(bounds.size.height);
                        let previous = heights.borrow().get(&measure_key).copied();
                        if previous != Some(height) {
                            heights.borrow_mut().insert(measure_key.clone(), height);
                            let crossed = previous
                                .is_none_or(|value| (value > BODY_CLIP) != (height > BODY_CLIP));
                            if crossed {
                                let _ = tab.update(cx, |_, cx| cx.notify());
                            }
                        }
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .inset_0(),
            )
            .relative();
        let toggle_tab = cx.entity().downgrade();
        let toggle_key = id.to_string();
        let background = t.background;
        div()
            .min_w_0()
            .child(
                div()
                    .relative()
                    .when(!expanded, |this| {
                        this.max_h(px(BODY_CLIP)).overflow_hidden()
                    })
                    .child(content)
                    .when(overflowing && !expanded, |this| {
                        this.child(
                            div()
                                .absolute()
                                .left_0()
                                .right_0()
                                .bottom_0()
                                .h(px(BODY_FADE))
                                .bg(linear_gradient(
                                    0.,
                                    linear_color_stop(hsla(background), 0.),
                                    linear_color_stop(hsla(fade(background, 0.)), 1.),
                                )),
                        )
                    }),
            )
            .when(overflowing, |this| {
                this.child(
                    div().mt(px(8.)).child(
                        Button::new(SharedString::from(format!("{id}-expand")))
                            .size(ButtonSize::Xs)
                            .variant(ButtonVariant::GhostMuted)
                            .label(if expanded {
                                "Show less"
                            } else {
                                "Show full comment"
                            })
                            .on_click(move |_, _, cx| {
                                let _ = toggle_tab.update(cx, |tab, cx| {
                                    if !tab.expanded.remove(&toggle_key) {
                                        tab.expanded.insert(toggle_key.clone());
                                    }
                                    cx.notify();
                                });
                            }),
                    ),
                )
            })
            .into_any_element()
    }

    fn comment_body(
        &self,
        view: &PullRequestSummaryView,
        card: &CommentCardModel,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if let Some(editor) = view.editor.as_ref()
            && editor.target == card.id
        {
            return self.editor_view(editor, view.saving, window, cx);
        }
        let group = format!("pr-comment-{}", card.key);
        let body = view.bodies.get(&card.id).map(|body| {
            self.clipped_body(&format!("pr-comment-body-{}", card.key), body, window, cx)
        });
        div()
            .flex()
            .items_start()
            .gap(px(4.))
            .child(div().min_w_0().flex_1().children(body))
            .when(card.can_edit, |this| {
                this.child(self.edit_button(
                    format!("pr-comment-edit-{}", card.key),
                    &card.edit_aria_label,
                    card.id.clone(),
                    &group,
                ))
            })
            .into_any_element()
    }

    fn identity(&self, card: &CommentCardModel, t: &Tokens) -> AnyElement {
        let foreground = t.foreground;
        let time = div()
            .id(SharedString::from(format!("pr-comment-time-{}", card.key)))
            .flex_none()
            .text_color(t.muted_foreground)
            .tooltip(Tooltip::text(SharedString::from(card.time_tooltip.clone())))
            .child(SharedString::from(card.time.relative.clone()));
        let time = match card.time_url.as_ref() {
            Some(url) => {
                let client = self.client.clone();
                let url = url.clone();
                time.cursor_pointer()
                    .hover(move |style| style.text_color(foreground).underline())
                    .on_click(move |_, _, cx| {
                        act(
                            &client,
                            cx,
                            "pullRequestDetailOpenUrl",
                            json!({ "url": url }),
                        )
                    })
                    .into_any_element()
            }
            None => time.into_any_element(),
        };
        div()
            .flex()
            .min_w_0()
            .flex_1()
            .flex_wrap()
            .items_center()
            .gap_x(px(8.))
            .gap_y(px(4.))
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .child(actor_label(
                SharedString::from(format!("pr-comment-author-{}", card.key)),
                &card.author,
                card.author_profile_url.as_ref(),
                true,
                true,
                &self.client,
                t,
            ))
            .child(time)
            .into_any_element()
    }

    fn location(card: &CommentCardModel, t: &Tokens) -> Option<AnyElement> {
        let location = card.location.as_ref()?;
        Some(
            div()
                .mt(px(8.))
                .flex()
                .min_w_0()
                .items_center()
                .gap(px(8.))
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .text_color(t.muted_foreground)
                .child(
                    div()
                        .id(SharedString::from(format!(
                            "pr-comment-location-{}",
                            card.key
                        )))
                        .min_w_0()
                        .truncate()
                        .font_family(MONO_FONT)
                        .tooltip(Tooltip::text(SharedString::from(location.label.clone())))
                        .child(SharedString::from(location.label.clone())),
                )
                .when(location.outdated, |this| {
                    this.child(div().flex_none().child("Outdated"))
                })
                .into_any_element(),
        )
    }

    fn outcome_badge(card: &CommentCardModel, t: &Tokens) -> Option<AnyElement> {
        if let Some(outcome) = card.outcome.as_ref() {
            let variant = match outcome.badge_variant.as_str() {
                "success" => BadgeVariant::Success,
                "error" => BadgeVariant::Error,
                _ => BadgeVariant::Outline,
            };
            let icon = match outcome.outcome.as_str() {
                "approved" => "circle-check",
                "changes-requested" => "circle-x",
                _ => "circle-dashed",
            };
            return Some(
                Badge::new()
                    .size(BadgeSize::Sm)
                    .variant(variant)
                    .icon(icon)
                    .child(SharedString::from(outcome.label.clone()))
                    .into_any_element(),
            );
        }
        card.review_state_label.as_ref().map(|label| {
            div()
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .text_color(t.muted_foreground)
                .child(SharedString::from(label.clone()))
                .into_any_element()
        })
    }

    fn comment_card(
        &self,
        view: &PullRequestSummaryView,
        card: &CommentCardModel,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = theme::active(cx);
        let group = format!("pr-comment-{}", card.key);
        let fixable = view.fixable.get(&card.id).copied().unwrap_or(false);
        let fix = card.fix.as_ref().filter(|_| fixable).map(|fix| {
            let client = self.client.clone();
            let comment_id = card.id.clone();
            Button::new(SharedString::from(format!("pr-comment-fix-{}", card.key)))
                .size(ButtonSize::Xs)
                .variant(ButtonVariant::Ghost)
                .mt(px(-4.))
                .flex_none()
                .disabled(fix.disabled)
                .icon("hammer")
                .icon_size(ICON_XS)
                .label(fix.label.clone())
                .on_click(move |_, _, cx| {
                    act(
                        &client,
                        cx,
                        "pullRequestSummaryFixComment",
                        json!({ "commentId": comment_id }),
                    )
                })
                .into_any_element()
        });
        let reactions = view.reactions.get(&card.id).and_then(|bar| {
            reaction_bar(
                &format!("pr-comment-reactions-{}", card.key),
                &card.id,
                bar,
                &self.bounds,
                &self.client,
                &t,
            )
        });
        let body = card
            .body_visible
            .then(|| self.comment_body(view, card, window, cx));
        div()
            .group(SharedString::from(group))
            .rounded(px(radius::LG))
            .border_1()
            .border_color(fade(t.border, 0.6))
            .bg(t.background)
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_start()
                    .gap(px(8.))
                    .rounded_t(px(radius::LG))
                    .bg(fade(t.muted, 0.25))
                    .px(px(12.))
                    .py(px(10.))
                    .child(
                        div()
                            .flex()
                            .min_w_0()
                            .flex_1()
                            .flex_wrap()
                            .items_center()
                            .gap(px(8.))
                            .child(self.identity(card, &t))
                            .children(Self::outcome_badge(card, &t)),
                    )
                    .children(fix)
                    .children(reactions.map(|bar| div().ml_auto().child(bar))),
            )
            .child(div().px(px(12.)).children(Self::location(card, &t)))
            .children(body.map(|body| div().px(px(12.)).py(px(12.)).child(body)))
            .into_any_element()
    }

    fn collapsed_card(
        &self,
        view: &PullRequestSummaryView,
        card: &CommentCardModel,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = theme::active(cx);
        let open = self.finished_open.contains(&card.key);
        let toggle = |tab: gpui::WeakEntity<Self>, key: String| {
            move |_: &gpui::ClickEvent, _: &mut Window, cx: &mut App| {
                let _ = tab.update(cx, |tab, cx| {
                    if !tab.finished_open.remove(&key) {
                        tab.finished_open.insert(key.clone());
                    }
                    cx.notify();
                });
            }
        };
        let hover_bg = t.muted;
        let foreground = t.foreground;
        let reactions = view.reactions.get(&card.id).and_then(|bar| {
            reaction_bar(
                &format!("pr-finished-reactions-{}", card.key),
                &card.id,
                bar,
                &self.bounds,
                &self.client,
                &t,
            )
        });
        let body = (open && card.body_visible).then(|| self.comment_body(view, card, window, cx));
        div()
            .group(SharedString::from(format!("pr-comment-{}", card.key)))
            .rounded(px(radius::LG))
            .border_1()
            .border_color(fade(t.border, 0.6))
            .child(
                div()
                    .p(px(12.))
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .items_start()
                            .gap(px(8.))
                            .child(self.identity(card, &t))
                            .child(
                                div()
                                    .id(SharedString::from(format!(
                                        "pr-finished-toggle-{}",
                                        card.key
                                    )))
                                    .flex()
                                    .flex_none()
                                    .items_center()
                                    .gap(px(6.))
                                    .rounded(px(radius::MD))
                                    .px(px(8.))
                                    .py(px(4.))
                                    .cursor_pointer()
                                    .text_size(px(text::XS))
                                    .line_height(px(text::XS_LINE))
                                    .text_color(t.muted_foreground)
                                    .hover(move |style| style.bg(hover_bg).text_color(foreground))
                                    .on_click(toggle(cx.entity().downgrade(), card.key.clone()))
                                    .child(SharedString::from(
                                        card.status_label.clone().unwrap_or_default(),
                                    ))
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
                            .children(reactions),
                    )
                    .children(Self::location(card, &t))
                    .when_some(card.preview.as_ref().filter(|_| !open), |this, preview| {
                        this.child(
                            div()
                                .id(SharedString::from(format!(
                                    "pr-finished-preview-{}",
                                    card.key
                                )))
                                .mt(px(8.))
                                .w_full()
                                .truncate()
                                .cursor_pointer()
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .text_color(t.muted_foreground)
                                .hover(move |style| style.text_color(foreground))
                                .on_click(toggle(cx.entity().downgrade(), card.key.clone()))
                                .child(SharedString::from(preview.clone())),
                        )
                    }),
            )
            .children(body.map(|body| {
                div()
                    .px(px(12.))
                    .pb(px(12.))
                    .child(div().mt(px(8.)).child(body))
            }))
            .into_any_element()
    }

    fn group(
        &self,
        id: &'static str,
        group: &CommentGroupModel,
        view: &PullRequestSummaryView,
        open: bool,
        children: AnyElement,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = theme::active(cx);
        let tab = cx.entity().downgrade();
        let client = self.client.clone();
        let hover = fade(t.muted, 0.3);
        let avatars = div()
            .flex()
            .flex_none()
            .items_center()
            .pl(px(6.))
            .children(group.avatars.iter().map(|entry| {
                let actor = view.group_actors.get(&entry.key);
                div()
                    .ml(px(-6.))
                    .flex()
                    .rounded_full()
                    .border_2()
                    .border_color(t.background)
                    .children(actor.map(|actor| {
                        actor_label(
                            SharedString::from(format!("pr-group-{id}-{}", entry.key)),
                            actor,
                            entry.profile_url.as_ref(),
                            false,
                            true,
                            &self.client,
                            &t,
                        )
                    }))
            }))
            .when_some(group.overflow_label.as_ref(), |this, overflow| {
                this.child(
                    div()
                        .ml(px(-6.))
                        .flex()
                        .size(px(24.))
                        .items_center()
                        .justify_center()
                        .rounded_full()
                        .border_2()
                        .border_color(t.background)
                        .bg(t.muted)
                        .text_size(px(TEXT_3XS))
                        .text_color(t.muted_foreground)
                        .child(SharedString::from(overflow.clone())),
                )
            });
        let latest = group.latest.as_ref().map(|latest| {
            div()
                .id(SharedString::from(format!("pr-group-{id}-latest")))
                .tooltip(Tooltip::text(SharedString::from(latest.absolute.clone())))
                .child(SharedString::from(format!("· Latest {}", latest.relative)))
        });
        div()
            .overflow_hidden()
            .rounded(px(radius::LG))
            .border_1()
            .border_color(t.border)
            .bg(t.background)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(12.))
                    .pl(px(12.))
                    .child(avatars)
                    .child(
                        div()
                            .id(SharedString::from(format!("pr-group-{id}-trigger")))
                            .flex()
                            .min_w_0()
                            .flex_1()
                            .items_center()
                            .gap(px(12.))
                            .rounded(px(radius::MD))
                            .py(px(12.))
                            .pr(px(12.))
                            .cursor_pointer()
                            .hover(move |style| style.bg(hover))
                            .on_click(move |_, _, cx| {
                                let _ = tab.update(cx, |tab, cx| {
                                    let next = match id {
                                        "bots" => {
                                            tab.bots_open = !tab.bots_open;
                                            tab.bots_open
                                        }
                                        _ => {
                                            tab.finished_group_open = !tab.finished_group_open;
                                            tab.finished_group_open
                                        }
                                    };
                                    if next && id == "bots" {
                                        act(&client, cx, "pullRequestSummaryOpenBots", json!({}));
                                    }
                                    cx.notify();
                                });
                            })
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .min_w_0()
                                    .flex_1()
                                    .gap(px(4.))
                                    .child(
                                        div()
                                            .text_size(px(text::XS))
                                            .line_height(px(text::XS_LINE))
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(fade(t.foreground, 0.9))
                                            .child(SharedString::from(group.label.clone())),
                                    )
                                    .child(
                                        small_meta(&t)
                                            .flex()
                                            .flex_wrap()
                                            .gap_x(px(6.))
                                            .child(SharedString::from(group.authors_label.clone()))
                                            .children(group.files_label.as_ref().map(|files| {
                                                div().child(SharedString::from(files.clone()))
                                            }))
                                            .children(latest),
                                    ),
                            )
                            .child(path_icon(
                                if open {
                                    "icons/chevron-down.svg"
                                } else {
                                    "icons/chevron-right.svg"
                                },
                                ICON_SM,
                                t.muted_foreground,
                            )),
                    ),
            )
            .when(open, |this| {
                this.child(
                    div()
                        .border_t_1()
                        .border_color(fade(t.border, 0.6))
                        .px(px(12.))
                        .pb(px(12.))
                        .child(children),
                )
            })
            .into_any_element()
    }

    fn pager(
        &self,
        id: &'static str,
        pager: Option<&PagerModel>,
        outline: bool,
        action: &'static str,
        bots: bool,
    ) -> Option<AnyElement> {
        let pager = pager?;
        let client = self.client.clone();
        Some(
            Button::new(id)
                .size(ButtonSize::Sm)
                .variant(if outline {
                    ButtonVariant::Outline
                } else {
                    ButtonVariant::Ghost
                })
                .w_full()
                .label(pager.label.clone())
                .on_click(move |_, _, cx| act(&client, cx, action, json!({ "bots": bots })))
                .into_any_element(),
        )
    }

    fn conversation_ghost(t: &Tokens) -> AnyElement {
        div()
            .py(px(8.))
            .flex()
            .flex_col()
            .gap(px(16.))
            .children((0..3).map(|index| {
                div()
                    .flex()
                    .items_start()
                    .gap(px(8.))
                    .child(ghost_bar(20., t).w(px(20.)).rounded_full())
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .gap(px(6.))
                            .child(ghost_bar(12., t).w(relative(META_WIDTHS[index])))
                            .child(ghost_bar(12., t).w_full())
                            .child(ghost_bar(12., t).w(relative(0.75))),
                    )
            }))
            .into_any_element()
    }

    fn description(
        &self,
        view: &PullRequestSummaryView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = theme::active(cx);
        let description = &view.model.description;
        if description.editing
            && let Some(editor) = view.editor.as_ref()
        {
            return self.editor_view(editor, view.saving, window, cx);
        }
        div()
            .group("pr-description")
            .flex()
            .items_start()
            .gap(px(4.))
            .child(div().min_w_0().flex_1().child(body_view(
                "pr-description",
                &view.description,
                &self.client,
                &t,
                window,
                cx,
            )))
            .when(description.can_edit, |this| {
                this.child(self.edit_button(
                    "pr-description-edit".to_string(),
                    &description.edit_aria_label,
                    "description".to_string(),
                    "pr-description",
                ))
            })
            .into_any_element()
    }

    fn checks(&self, view: &PullRequestSummaryView, cx: &mut Context<Self>) -> AnyElement {
        let t = theme::active(cx);
        match &view.model.checks.body {
            ChecksBodyModel::Stale {
                message,
                refresh_label,
            } => {
                let client = self.client.clone();
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.muted_foreground)
                    .child(SharedString::from(message.clone()))
                    .child(
                        Button::new("pr-checks-refresh")
                            .size(ButtonSize::Xs)
                            .variant(ButtonVariant::Ghost)
                            .label(refresh_label.clone())
                            .on_click(move |_, _, cx| {
                                act(&client, cx, "pullRequestSummaryRefreshChecks", json!({}))
                            }),
                    )
                    .into_any_element()
            }
            ChecksBodyModel::Empty { message } => div()
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .text_color(t.muted_foreground)
                .child(SharedString::from(message.clone()))
                .into_any_element(),
            ChecksBodyModel::Rows { rows } => div()
                .flex()
                .flex_col()
                .children(rows.iter().enumerate().map(|(index, row)| {
                    let hover = fade(t.accent, 0.6);
                    let open_client = self.client.clone();
                    let url = row.url.clone();
                    let fix = row.fix.as_ref().map(|fix| {
                        let client = self.client.clone();
                        Button::new(SharedString::from(format!("pr-check-fix-{index}")))
                            .size(ButtonSize::Xs)
                            .variant(ButtonVariant::Ghost)
                            .flex_none()
                            .disabled(fix.disabled)
                            .icon("hammer")
                            .icon_size(ICON_XS)
                            .label(fix.label.clone())
                            .on_click(move |_, _, cx| {
                                act(
                                    &client,
                                    cx,
                                    "pullRequestSummaryFixCheck",
                                    json!({ "index": index }),
                                )
                            })
                    });
                    div()
                        .id(SharedString::from(format!("pr-check-{}", row.key)))
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .rounded(px(radius::MD))
                        .pr(px(4.))
                        .hover(move |style| style.bg(hover))
                        .child(
                            div()
                                .id(SharedString::from(format!("pr-check-open-{}", row.key)))
                                .flex()
                                .min_w_0()
                                .flex_1()
                                .items_start()
                                .gap(px(8.))
                                .rounded(px(radius::MD))
                                .px(px(8.))
                                .py(px(8.))
                                .text_size(px(text::XS))
                                .line_height(px(20.))
                                .when_some(url, |this, url| {
                                    this.cursor_pointer().on_click(move |_, _, cx| {
                                        act(
                                            &open_client,
                                            cx,
                                            "pullRequestSummaryOpenCheck",
                                            json!({ "url": url }),
                                        )
                                    })
                                })
                                .child(div().mt(px(3.)).flex_none().child(signal_icon(
                                    SharedString::from(format!("pr-check-icon-{}", row.key)),
                                    &row.status.icon,
                                    ICON_SM,
                                    tone(&row.status.tone_class_name, &t),
                                )))
                                .child(
                                    div()
                                        .min_w_0()
                                        .flex_1()
                                        .child(SharedString::from(row.name.clone())),
                                )
                                .child(
                                    div()
                                        .flex_none()
                                        .text_color(t.muted_foreground)
                                        .child(SharedString::from(row.status_label.clone())),
                                ),
                        )
                        .children(fix)
                }))
                .into_any_element(),
        }
    }

    fn comments(
        &self,
        view: &PullRequestSummaryView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = theme::active(cx);
        let comments = &view.model.comments;
        if comments.state == "loading" {
            return Self::conversation_ghost(&t);
        }
        if comments.state == "error"
            && let Some(model) = view.activity_unavailable.as_ref()
        {
            return activity_unavailable(model, &self.client, cx);
        }
        let mut column = div().flex().flex_col();
        if let Some(notice) = comments.truncated_notice.as_ref() {
            column = column.child(
                div()
                    .mb(px(8.))
                    .rounded(px(radius::MD))
                    .border_1()
                    .border_color(fade(t.warning, 0.3))
                    .bg(t.warning_surface)
                    .px(px(8.))
                    .py(px(6.))
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .child(SharedString::from(notice.clone())),
            );
        }
        if let Some(empty) = comments.empty_label.as_ref() {
            return column
                .child(
                    div()
                        .py(px(8.))
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .text_color(t.muted_foreground)
                        .child(SharedString::from(empty.clone())),
                )
                .into_any_element();
        }
        let oldest_first = comments.order.label.starts_with("Oldest");
        let older = self.pager(
            "pr-comments-older",
            comments.show_older.as_ref(),
            true,
            "pullRequestSummaryShowOlder",
            false,
        );
        let mut list = div().flex().flex_col().gap(px(12.));
        let mut older = older;
        if oldest_first {
            list = list.children(older.take());
        }
        for card in &comments.visible {
            list = list.child(self.comment_card(view, card, window, cx));
        }
        if !oldest_first {
            list = list.children(older.take());
        }
        list = list.children(self.pager(
            "pr-comments-recent",
            comments.show_recent.as_ref(),
            false,
            "pullRequestSummaryShowRecent",
            false,
        ));
        if let Some(bots) = comments.bots.as_ref() {
            let mut inner = div().flex().flex_col().gap(px(12.)).pt(px(8.));
            for card in &bots.visible {
                inner = inner.child(self.comment_card(view, card, window, cx));
            }
            inner = inner
                .children(self.pager(
                    "pr-bots-older",
                    bots.show_older.as_ref(),
                    true,
                    "pullRequestSummaryShowOlder",
                    true,
                ))
                .children(self.pager(
                    "pr-bots-recent",
                    bots.show_recent.as_ref(),
                    false,
                    "pullRequestSummaryShowRecent",
                    true,
                ));
            list = list.child(self.group(
                "bots",
                &bots.group,
                view,
                self.bots_open,
                inner.into_any_element(),
                cx,
            ));
        }
        if let Some(finished) = comments.finished.as_ref() {
            let mut inner = div().flex().flex_col().gap(px(8.)).pt(px(8.));
            for card in &finished.items {
                inner = inner.child(self.collapsed_card(view, card, window, cx));
            }
            list = list.child(self.group(
                "finished",
                &finished.group,
                view,
                self.finished_group_open,
                inner.into_any_element(),
                cx,
            ));
        }
        column.child(list).into_any_element()
    }

    fn popups(&self, view: &PullRequestSummaryView, t: &Tokens) -> Vec<AnyElement> {
        let mut popups = Vec::new();
        if !view.active {
            return popups;
        }
        if let Some(picker) = view.reviewers.as_ref()
            && let Some(popup) = self.picker_popup(Picker::Reviewers, picker, t)
        {
            popups.push(popup);
        }
        if let Some(picker) = view.labels.as_ref()
            && let Some(popup) = self.picker_popup(Picker::Labels, picker, t)
        {
            popups.push(popup);
        }
        if let Some(subject) = view.reaction_picker.as_ref()
            && let Some(bar) = view.reactions.get(subject)
            && let Some(popup) = reaction_picker_popup(subject, bar, &self.bounds, &self.client, t)
        {
            popups.push(popup);
        }
        popups
    }
}

impl Render for PullRequestSummaryTab {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.ensure_inputs(window, cx);
        let Some(view) = self.data.clone() else {
            return div().size_full().into_any_element();
        };
        let t = theme::active(cx);
        let order_button = |client: Entity<CoreClient>, id: &'static str| {
            Button::new(id)
                .size(ButtonSize::Xs)
                .variant(ButtonVariant::GhostMuted)
                .flex_none()
                .icon("arrow-down-up")
                .icon_size(ICON_XS)
                .accessibility_label(view.model.comments.order.aria_label.clone())
                .label(view.model.comments.order.label.clone())
                .on_click(move |_, _, cx| {
                    act(&client, cx, "pullRequestSummaryToggleOrder", json!({}))
                })
                .into_any_element()
        };
        let description_body = self
            .section_open("description")
            .then(|| self.description(&view, window, cx));
        let description = self.section(
            "description",
            &view.model.description.title,
            None,
            description_body,
            cx,
        );
        let checks_body = self.section_open("checks").then(|| self.checks(&view, cx));
        let checks = self.section("checks", &view.model.checks.title, None, checks_body, cx);
        let order = order_button(self.client.clone(), "pr-comments-order");
        let comments_body = self
            .section_open("comments")
            .then(|| self.comments(&view, window, cx));
        let comments = self.section(
            "comments",
            &view.model.comments.title,
            Some(order),
            comments_body,
            cx,
        );
        let pinned = sticky::pinned(
            &self.sticky,
            &self.scroll,
            ["description", "checks", "comments"],
            SECTION_HEADER,
        );
        let overlay = pinned.map(|pinned| {
            let header = match pinned.name.as_str() {
                "description" => {
                    self.section_header("description", &view.model.description.title, None, cx)
                }
                "checks" => self.section_header("checks", &view.model.checks.title, None, cx),
                _ => {
                    let order = order_button(self.client.clone(), "pr-comments-order-pinned");
                    self.section_header("comments", &view.model.comments.title, Some(order), cx)
                }
            };
            sticky::overlay(pinned.top, header)
        });
        div()
            .relative()
            .size_full()
            .child(
                div()
                    .id("pr-summary-scroll")
                    .size_full()
                    .overflow_y_scroll()
                    .track_scroll(&self.scroll)
                    .child(
                        div()
                            .relative()
                            .flex()
                            .flex_col()
                            .w_full()
                            .child(record(&self.sticky, sticky::ROOT))
                            .child(self.meta(&view, &t))
                            .child(description)
                            .child(checks)
                            .child(comments),
                    ),
            )
            .children(overlay)
            .children(self.popups(&view, &t))
            .into_any_element()
    }
}
