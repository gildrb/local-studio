use std::collections::HashMap;
use std::rc::Rc;

use gpui::component::input::{InputEvent, TextareaState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, Context, Entity, FontWeight, InteractiveElement, IntoElement,
    KeyDownEvent, MouseButton, MouseDownEvent, MouseMoveEvent, ParentElement, Render, ScrollHandle,
    ScrollWheelEvent, SharedString, StatefulInteractiveElement, Styled, Subscription, Window, div,
    px, relative,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::pull_request_code::{
    CodeBodyModel, CodeFileView, CodeFooterModel, CodeSegmentView, CodeThreadView, FileRowModel,
    LineAnchorView, PullRequestCodeView, ToolbarModel, TreeModel, TreeRowModel, WarningModel,
};
use crate::app_core::views::right_panel_diff::{DiffChangeIcon, DiffRow};
use crate::features::chat::toolbar_parts::act;
use crate::features::pull_requests::conversation::{
    EditorActions, body_view, markdown_editor, reaction_bar, reaction_picker_popup,
};
use crate::features::pull_requests::detail_parts::{AVATAR, ICON_SM, ICON_XS, meta_separator};
use crate::features::pull_requests::filters::record;
use crate::features::pull_requests::presentation::{TEXT_2XS, avatar, diff_stat, path_icon};
use crate::features::pull_requests::row::AnchorBounds;
use crate::features::pull_requests::sticky;
use crate::features::right_panel::diff::{
    ExpandHandler, StaticRowOptions, ch, file_change_icon, gutter_padding_right, gutter_width,
    line_chars, selected_line_colors, static_diff_row_elements,
};
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::checkbox::Checkbox;
use crate::ui::menu::{MenuItem, MenuPopup, MenuRadioItem};
use crate::ui::popover::{Align, Side as PopoverSide};
use crate::ui::spinner::Spinner;
use crate::ui::textarea::{Textarea, TextareaSize};
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::toggle::{Toggle, ToggleSize, ToggleVariant};
use crate::ui::toggle_group::ToggleGroup;
use crate::ui::tooltip::Tooltip;
use gpui::base::CheckboxState;

const TOOLBAR_HEIGHT: f32 = 40.;
const SCOPE_MAX: f32 = 256.;
const FILE_HEADER_HEIGHT: f32 = 32.;
const FILE_HEADER_PADDING_Y: f32 = 6.;
const FILE_HEADER_PADDING_LEFT: f32 = 8.;
const FILE_HEADER_PADDING_RIGHT: f32 = 12.;
const FILE_HEADER_PREFIX: f32 = 24.;
const FILE_ICON: f32 = 16.;
const FILE_META_GAP: f32 = 12.;
const TREE_WIDTH: f32 = 320.;
const TREE_MIN_WIDTH: f32 = 192.;
const TREE_ROW_HEIGHT: f32 = 24.;
const TREE_INDENT: f32 = 12.;
const ORPHANS_MAX: f32 = 256.;
const SCOPE_ANCHOR: &str = "code:scope";
const TEXT_2XS_LINE: f32 = 16.;
const UTILITY_BUTTON: f32 = 20.;
const UTILITY_ICON: f32 = 16.;
const UTILITY_RADIUS: f32 = 4.;
const SELECTION_BAR: f32 = 4.;
const SPLIT_BORDER: f32 = 1.;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Side {
    Left,
    Right,
}

impl Side {
    fn as_str(self) -> &'static str {
        match self {
            Side::Left => "left",
            Side::Right => "right",
        }
    }

    fn parse(value: &str) -> Self {
        if value == "left" {
            Side::Left
        } else {
            Side::Right
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct LinePoint {
    side: Side,
    line: u32,
}

impl LinePoint {
    fn matches(self, anchor: &LineAnchorView) -> bool {
        match self.side {
            Side::Left => anchor.old_line == Some(self.line),
            Side::Right => anchor.new_line == Some(self.line),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Gesture {
    Idle,
    Selecting,
    PendingUnselect,
}

#[derive(Clone)]
struct LineSelection {
    file_key: String,
    anchor: LinePoint,
    current: LinePoint,
    gesture: Gesture,
}

#[derive(Clone, Copy)]
struct CommittedEnds {
    anchor: LinePoint,
    anchor_index: usize,
    current: LinePoint,
    current_index: usize,
}

struct FileRows<'a> {
    key: &'a str,
    rows: &'a [DiffRow],
    lines: &'a [Option<LineAnchorView>],
    base: usize,
    selected: Option<(usize, usize)>,
    gestures: bool,
    committed: Option<CommittedEnds>,
    h_offset: f32,
    wrap: bool,
    on_expand: ExpandHandler,
}

fn point_index(anchors: &[Option<&LineAnchorView>], point: LinePoint) -> Option<usize> {
    anchors
        .iter()
        .position(|anchor| anchor.is_some_and(|anchor| point.matches(anchor)))
}

fn unified_point(anchor: &LineAnchorView) -> Option<LinePoint> {
    match (anchor.new_line, anchor.old_line) {
        (Some(line), _) => Some(LinePoint {
            side: Side::Right,
            line,
        }),
        (None, Some(line)) => Some(LinePoint {
            side: Side::Left,
            line,
        }),
        (None, None) => None,
    }
}

fn row_digits(rows: &[DiffRow]) -> Option<u32> {
    rows.iter().find_map(|row| match row {
        DiffRow::Line { gutter_digits, .. } | DiffRow::Split { gutter_digits, .. } => {
            Some(*gutter_digits)
        }
        _ => None,
    })
}

fn longest_line(rows: &[DiffRow]) -> usize {
    rows.iter()
        .map(|row| match row {
            DiffRow::Line { line, .. } => line_chars(line),
            DiffRow::Split { left, right, .. } => left
                .as_ref()
                .map(line_chars)
                .unwrap_or(0)
                .max(right.as_ref().map(line_chars).unwrap_or(0)),
            _ => 0,
        })
        .max()
        .unwrap_or(0)
}

pub struct PullRequestCodeTab {
    client: Entity<CoreClient>,
    data: Option<Rc<PullRequestCodeView>>,
    bounds: AnchorBounds,
    sticky: AnchorBounds,
    scroll: ScrollHandle,
    scope_open: bool,
    expanded: HashMap<String, bool>,
    replies: HashMap<String, Entity<TextareaState>>,
    reply_revisions: HashMap<String, u64>,
    editor: Option<Entity<TextareaState>>,
    applied_editor: Option<(String, u64)>,
    applied_reveal: Option<u64>,
    draft_input: Option<Entity<TextareaState>>,
    draft_empty: bool,
    applied_draft: Option<u64>,
    selection: Option<LineSelection>,
    h_offsets: HashMap<String, f32>,
    _subscriptions: Vec<Subscription>,
}

impl PullRequestCodeTab {
    pub fn new(client: Entity<CoreClient>, scroll: ScrollHandle, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<PullRequestCodeView>>(
            &client,
            "pullRequestCode",
            json!({}),
            cx,
        );
        let subscription = cx.observe(&view, |tab, view, cx| {
            let data = view.update(cx, |state, _| state.data.take());
            tab.data = data.flatten().map(Rc::new);
            if let Some(view) = tab.data.as_ref() {
                let finished: Vec<String> = tab
                    .reply_revisions
                    .iter()
                    .filter(|(id, revision)| {
                        view.threads
                            .get(*id)
                            .is_some_and(|thread| thread.reply_revision != **revision)
                    })
                    .map(|(id, _)| id.clone())
                    .collect();
                for id in finished {
                    tab.replies.remove(&id);
                    tab.reply_revisions.remove(&id);
                }
            }
            cx.notify();
        });
        Self {
            client,
            data: None,
            bounds: AnchorBounds::default(),
            sticky: AnchorBounds::default(),
            scroll,
            scope_open: false,
            expanded: HashMap::new(),
            replies: HashMap::new(),
            reply_revisions: HashMap::new(),
            editor: None,
            applied_editor: None,
            applied_reveal: None,
            draft_input: None,
            draft_empty: true,
            applied_draft: None,
            selection: None,
            h_offsets: HashMap::new(),
            _subscriptions: vec![subscription],
        }
    }

    fn sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
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
                            "pullRequestCodeEditorDraft",
                            json!({ "text": text }),
                        );
                    }
                },
            )
            .detach();
            self.editor = Some(editor);
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
                        state.update(cx, |state, cx| {
                            state.set_value(initial, window, cx);
                            state.focus(window, cx);
                        });
                    }
                }
            }
            None => self.applied_editor = None,
        }
        if self.draft_input.is_none() {
            let input = cx.new(|cx| TextareaState::new(window, cx).auto_grow(2, 12));
            cx.subscribe_in(
                &input,
                window,
                |tab: &mut Self, state: &Entity<TextareaState>, event: &InputEvent, _, cx| {
                    if let InputEvent::Change = event {
                        let empty = state.read(cx).value().trim().is_empty();
                        if empty != tab.draft_empty {
                            tab.draft_empty = empty;
                            cx.notify();
                        }
                    }
                },
            )
            .detach();
            self.draft_input = Some(input);
        }
        match view.draft.as_ref() {
            Some(draft) if self.applied_draft != Some(draft.revision) => {
                self.applied_draft = Some(draft.revision);
                self.draft_empty = true;
                if let Some(state) = self.draft_input.as_ref() {
                    let placeholder = draft.placeholder.clone();
                    state.update(cx, |state, cx| {
                        state.set_value("", window, cx);
                        state.set_placeholder(placeholder, window, cx);
                        state.focus(window, cx);
                    });
                }
            }
            Some(_) => {}
            None => {
                if self.applied_draft.take().is_some() {
                    self.selection = None;
                }
            }
        }
        if let Some(reveal) = view.reveal.as_ref()
            && self.applied_reveal != Some(reveal.revision)
        {
            self.applied_reveal = Some(reveal.revision);
            if let Some(index) = view.files.iter().position(|file| file.key == reveal.key) {
                self.scroll.scroll_to_item(index);
            }
        }
    }

    fn committed_ends(
        &self,
        view: &PullRequestCodeView,
        file: &CodeFileView,
        anchors: &[Option<&LineAnchorView>],
    ) -> Option<CommittedEnds> {
        if view.draft.is_some() {
            return None;
        }
        let selection = self
            .selection
            .as_ref()
            .filter(|selection| selection.file_key == file.key)?;
        if selection.gesture != Gesture::Idle {
            return None;
        }
        Some(CommittedEnds {
            anchor: selection.anchor,
            anchor_index: point_index(anchors, selection.anchor)?,
            current: selection.current,
            current_index: point_index(anchors, selection.current)?,
        })
    }

    fn selection_range(
        &self,
        view: &PullRequestCodeView,
        file: &CodeFileView,
        anchors: &[Option<&LineAnchorView>],
    ) -> Option<(usize, usize)> {
        let (key, start, end) = match (view.draft.as_ref(), self.selection.as_ref()) {
            (Some(draft), _) => (
                draft.selection.file_key.as_str(),
                LinePoint {
                    side: Side::parse(&draft.selection.start_side),
                    line: draft.selection.start_line,
                },
                LinePoint {
                    side: Side::parse(&draft.selection.side),
                    line: draft.selection.line,
                },
            ),
            (None, Some(selection)) => (
                selection.file_key.as_str(),
                selection.anchor,
                selection.current,
            ),
            (None, None) => return None,
        };
        if key != file.key {
            return None;
        }
        let start = point_index(anchors, start)?;
        let end = point_index(anchors, end)?;
        Some((start.min(end), start.max(end)))
    }

    #[allow(clippy::too_many_arguments)]
    fn start_selection(
        &mut self,
        key: &str,
        point: LinePoint,
        index: usize,
        shift: bool,
        utility: bool,
        committed: Option<CommittedEnds>,
        cx: &mut Context<Self>,
    ) {
        let committed = committed.filter(|_| {
            self.selection.as_ref().is_some_and(|selection| {
                selection.file_key == key && selection.gesture == Gesture::Idle
            })
        });
        let (anchor, current, gesture) = match committed {
            Some(ends) if utility => {
                if ends.anchor_index <= ends.current_index {
                    (ends.anchor, ends.current, Gesture::Selecting)
                } else {
                    (ends.current, ends.anchor, Gesture::Selecting)
                }
            }
            Some(ends) if shift => {
                let use_start = if ends.anchor_index <= ends.current_index {
                    index >= ends.anchor_index
                } else {
                    index <= ends.current_index
                };
                let anchor = if use_start { ends.anchor } else { ends.current };
                (anchor, point, Gesture::Selecting)
            }
            Some(ends) if ends.anchor.line == point.line && ends.current.line == point.line => {
                (point, point, Gesture::PendingUnselect)
            }
            _ => (point, point, Gesture::Selecting),
        };
        self.selection = Some(LineSelection {
            file_key: key.to_string(),
            anchor,
            current,
            gesture,
        });
        cx.notify();
    }

    fn drag_to(&mut self, key: &str, point: LinePoint, cx: &mut Context<Self>) {
        let Some(selection) = self.selection.as_mut() else {
            return;
        };
        if selection.file_key != key || selection.current == point {
            return;
        }
        match selection.gesture {
            Gesture::Idle => return,
            Gesture::Selecting => selection.current = point,
            Gesture::PendingUnselect => {
                selection.current = point;
                selection.gesture = Gesture::Selecting;
            }
        }
        cx.notify();
    }

    fn finish_selection(&mut self, cx: &mut Context<Self>) {
        let Some(selection) = self.selection.as_mut() else {
            return;
        };
        match selection.gesture {
            Gesture::Idle => {}
            Gesture::PendingUnselect => {
                self.selection = None;
                cx.notify();
            }
            Gesture::Selecting => {
                selection.gesture = Gesture::Idle;
                let params = json!({
                    "key": selection.file_key,
                    "side": selection.current.side.as_str(),
                    "line": selection.current.line,
                    "startSide": selection.anchor.side.as_str(),
                    "startLine": selection.anchor.line,
                });
                act(&self.client, cx, "pullRequestCodeBeginDraft", params);
                cx.notify();
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn line_region(
        &self,
        key: &str,
        point: LinePoint,
        index: usize,
        half: Option<bool>,
        gutter: f32,
        utility_left: f32,
        committed: Option<CommittedEnds>,
        accent: gpui::Rgba,
        foreground: gpui::Rgba,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let id = format!("code-line-{key}-{index}-{}", point.side.as_str());
        let group = SharedString::from(id.clone());
        let offset = if half == Some(true) { SPLIT_BORDER } else { 0. };
        let move_key = key.to_string();
        let down_key = key.to_string();
        let utility_key = key.to_string();
        div()
            .id(SharedString::from(id.clone()))
            .group(group.clone())
            .absolute()
            .top_0()
            .bottom_0()
            .map(|this| match half {
                None => this.left_0().right_0(),
                Some(false) => this.left_0().w(relative(0.5)),
                Some(true) => this.left(relative(0.5)).right_0(),
            })
            .on_mouse_move(cx.listener(move |tab, event: &MouseMoveEvent, _, cx| {
                if event.pressed_button == Some(MouseButton::Left) {
                    tab.drag_to(&move_key, point, cx);
                } else {
                    tab.finish_selection(cx);
                }
            }))
            .child(
                div()
                    .id(SharedString::from(format!("{id}-gutter")))
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .left(px(offset))
                    .w(px(gutter))
                    .cursor_pointer()
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |tab, event: &MouseDownEvent, _, cx| {
                            cx.stop_propagation();
                            tab.start_selection(
                                &down_key,
                                point,
                                index,
                                event.modifiers.shift,
                                false,
                                committed,
                                cx,
                            );
                        }),
                    ),
            )
            .child(
                div()
                    .id(SharedString::from(format!("{id}-utility")))
                    .absolute()
                    .top_0()
                    .left(px(offset + utility_left))
                    .flex()
                    .size(px(UTILITY_BUTTON))
                    .items_center()
                    .justify_center()
                    .rounded(px(UTILITY_RADIUS))
                    .bg(accent)
                    .cursor_pointer()
                    .opacity(0.)
                    .group_hover(group, |style| style.opacity(1.))
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |tab, _: &MouseDownEvent, _, cx| {
                            cx.stop_propagation();
                            tab.start_selection(
                                &utility_key,
                                point,
                                index,
                                false,
                                true,
                                committed,
                                cx,
                            );
                        }),
                    )
                    .child(path_icon("icons/diffs/plus.svg", UTILITY_ICON, foreground)),
            )
            .into_any_element()
    }

    fn file_rows(&self, pass: FileRows, cx: &mut Context<Self>) -> AnyElement {
        let t = theme::active(cx);
        let elements = static_diff_row_elements(
            pass.rows,
            StaticRowOptions {
                wrap: pass.wrap,
                h_offset: pass.h_offset,
                selected: pass.selected,
                on_expand: Some(pass.on_expand.clone()),
            },
            &self.client,
            cx,
        );
        let (_, accent) = selected_line_colors(&t);
        let mut children = Vec::with_capacity(elements.len());
        for (index, element) in elements.into_iter().enumerate() {
            let anchor = pass.lines.get(index).and_then(Option::as_ref);
            let row = pass.rows.get(index);
            let (Some(anchor), Some(row), true) = (anchor, row, pass.gestures) else {
                children.push(element);
                continue;
            };
            let (digits, split) = match row {
                DiffRow::Line { gutter_digits, .. } => (*gutter_digits, false),
                DiffRow::Split { gutter_digits, .. } => (*gutter_digits, true),
                _ => {
                    children.push(element);
                    continue;
                }
            };
            let gutter = gutter_width(digits, &t);
            let utility_left = gutter - gutter_padding_right(&t);
            let regions: Vec<(LinePoint, Option<bool>)> = if split {
                [
                    anchor.old_line.map(|line| {
                        (
                            LinePoint {
                                side: Side::Left,
                                line,
                            },
                            Some(false),
                        )
                    }),
                    anchor.new_line.map(|line| {
                        (
                            LinePoint {
                                side: Side::Right,
                                line,
                            },
                            Some(true),
                        )
                    }),
                ]
                .into_iter()
                .flatten()
                .collect()
            } else {
                unified_point(anchor)
                    .map(|point| vec![(point, None)])
                    .unwrap_or_default()
            };
            let mut wrapper = div().relative().child(element);
            for (point, half) in regions {
                wrapper = wrapper.child(self.line_region(
                    pass.key,
                    point,
                    pass.base + index,
                    half,
                    gutter,
                    utility_left,
                    pass.committed,
                    accent,
                    t.background,
                    cx,
                ));
            }
            children.push(wrapper.into_any_element());
        }
        div()
            .flex()
            .flex_col()
            .w_full()
            .overflow_hidden()
            .children(children)
            .into_any_element()
    }

    fn file_block(
        &self,
        file: &CodeFileView,
        model: &FileRowModel,
        view: &PullRequestCodeView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = theme::active(cx);
        let block = div()
            .relative()
            .flex()
            .flex_col()
            .child(record(&self.sticky, sticky::key(&file.key)))
            .child(self.file_header(model, file.change_icon, &t));
        if model.collapsed {
            return block.into_any_element();
        }
        let anchors: Vec<Option<&LineAnchorView>> = file
            .segments
            .iter()
            .flat_map(|segment| match segment {
                CodeSegmentView::Rows { lines, .. } => lines.as_slice(),
                CodeSegmentView::Annotations { .. } => [].as_slice(),
            })
            .map(Option::as_ref)
            .collect();
        let selected = self.selection_range(view, file, &anchors);
        let committed = self.committed_ends(view, file, &anchors);
        let gestures = view.can_comment_on_lines && view.draft.is_none();
        let wrap = view.word_wrap;
        let mut digits = None;
        let mut longest = 0;
        for segment in &file.segments {
            if let CodeSegmentView::Rows { rows, .. } = segment {
                digits = digits.or(row_digits(rows));
                longest = longest.max(longest_line(rows));
            }
        }
        let width = self
            .sticky
            .borrow()
            .get(&sticky::key(&file.key))
            .map(|bounds| f32::from(bounds.size.width))
            .unwrap_or(0.);
        let visible = if view.layout == "split" {
            (width - SPLIT_BORDER) / 2.
        } else {
            width
        };
        let needed = digits.map(|digits| gutter_width(digits, &t)).unwrap_or(0.)
            + ch(&t) * (2. + longest as f32);
        let max_offset = (needed - visible).max(0.);
        let h_offset = if wrap {
            0.
        } else {
            self.h_offsets
                .get(&file.key)
                .copied()
                .unwrap_or(0.)
                .min(max_offset)
        };
        let expand_client = self.client.clone();
        let expand_key = file.key.clone();
        let on_expand: ExpandHandler = Rc::new(move |_, hunk, all, cx: &mut App| {
            act(
                &expand_client,
                cx,
                "pullRequestCodeExpand",
                json!({
                    "key": expand_key,
                    "hunkIndex": hunk,
                    "direction": "both",
                    "all": all,
                }),
            )
        });
        let (selected_bg, accent) = selected_line_colors(&t);
        let mut body = div().flex().flex_col();
        let mut base = 0;
        for segment in &file.segments {
            match segment {
                CodeSegmentView::Rows { rows, lines } => {
                    let end = base + rows.len();
                    let local = selected.and_then(|(first, last)| {
                        (first < end && last >= base)
                            .then(|| (first.max(base) - base, last.min(end - 1) - base))
                    });
                    body = body.child(self.file_rows(
                        FileRows {
                            key: &file.key,
                            rows,
                            lines,
                            base,
                            selected: local,
                            gestures,
                            committed,
                            h_offset,
                            wrap,
                            on_expand: on_expand.clone(),
                        },
                        cx,
                    ));
                    base = end;
                }
                CodeSegmentView::Annotations {
                    thread_ids,
                    pending_ids,
                    draft,
                } => {
                    let highlighted = base > 0
                        && selected
                            .is_some_and(|(first, last)| (first..=last).contains(&(base - 1)));
                    let mut cards = div().relative().py(px(4.)).bg(if highlighted {
                        selected_bg
                    } else {
                        t.background
                    });
                    for id in thread_ids {
                        if let Some(thread) = view.threads.get(id) {
                            cards = cards.child(self.thread_card(thread, view, window, cx));
                        }
                    }
                    for id in pending_ids {
                        if let Some(pending) = view.pending.get(id) {
                            cards = cards.child(self.pending_card(id, pending, view, &t));
                        }
                    }
                    if *draft && let Some(draft) = view.draft.as_ref() {
                        cards = cards.child(self.draft_card(draft, &t));
                    }
                    if highlighted {
                        cards = cards.child(
                            div()
                                .absolute()
                                .left_0()
                                .top_0()
                                .bottom_0()
                                .w(px(SELECTION_BAR))
                                .bg(accent),
                        );
                    }
                    body = body.child(cards);
                }
            }
        }
        let scroll_key = file.key.clone();
        block
            .child(body.on_scroll_wheel(cx.listener(
                move |tab, event: &ScrollWheelEvent, window, cx| {
                    if wrap {
                        return;
                    }
                    let dx = f32::from(event.delta.pixel_delta(window.line_height()).x);
                    if dx == 0. {
                        return;
                    }
                    let current = tab
                        .h_offsets
                        .get(&scroll_key)
                        .copied()
                        .unwrap_or(0.)
                        .min(max_offset);
                    let next = (current - dx).clamp(0., max_offset);
                    if next != current {
                        tab.h_offsets.insert(scroll_key.clone(), next);
                        cx.notify();
                    }
                },
            )))
            .into_any_element()
    }

    fn pending_card(
        &self,
        id: &str,
        pending: &crate::app_core::views::pull_request_code::PendingCommentView,
        view: &PullRequestCodeView,
        t: &Tokens,
    ) -> AnyElement {
        let client = self.client.clone();
        let key = id.to_string();
        div()
            .mx(px(12.))
            .my(px(8.))
            .rounded(px(radius::XL))
            .border_1()
            .border_dashed()
            .border_color(fade(t.border, 0.7))
            .bg(t.background)
            .p(px(12.))
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE * 1.15))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.muted_foreground)
                    .child(path_icon(
                        "icons/message-square.svg",
                        ICON_SM,
                        t.muted_foreground,
                    ))
                    .child(SharedString::from(view.pending_label.clone()))
                    .child(
                        div()
                            .id(SharedString::from(format!("code-pending-remove-tip-{id}")))
                            .ml_auto()
                            .tooltip(Tooltip::text(SharedString::from(
                                view.pending_remove_label.clone(),
                            )))
                            .child(
                                Button::new(SharedString::from(format!(
                                    "code-pending-remove-{id}"
                                )))
                                .size(ButtonSize::IconXs)
                                .variant(ButtonVariant::Ghost)
                                .icon("icons/pull-requests/trash-2.svg")
                                .icon_size(ICON_SM)
                                .accessibility_label(view.pending_remove_label.clone())
                                .on_click(move |_, _, cx| {
                                    act(
                                        &client,
                                        cx,
                                        "pullRequestCodePendingRemove",
                                        json!({ "key": key }),
                                    )
                                }),
                            ),
                    ),
            )
            .child(
                div()
                    .mt(px(8.))
                    .text_color(t.foreground)
                    .child(SharedString::from(pending.body.clone())),
            )
            .into_any_element()
    }

    fn draft_card(
        &self,
        draft: &crate::app_core::views::pull_request_code::DraftView,
        t: &Tokens,
    ) -> AnyElement {
        let Some(state) = self.draft_input.as_ref() else {
            return div().into_any_element();
        };
        let empty = self.draft_empty;
        let cancel = self.client.clone();
        let agent = self.client.clone();
        let agent_state = state.clone();
        let add = self.client.clone();
        let add_state = state.clone();
        let key_client = self.client.clone();
        let key_state = state.clone();
        div()
            .px(px(12.))
            .py(px(8.))
            .text_color(t.foreground)
            .capture_key_down(move |event: &KeyDownEvent, _, cx| {
                let keystroke = &event.keystroke;
                let modifiers = keystroke.modifiers;
                if keystroke.key == "escape" {
                    cx.stop_propagation();
                    act(&key_client, cx, "pullRequestCodeDraftCancel", json!({}));
                } else if keystroke.key == "enter"
                    && (modifiers.platform || modifiers.control)
                    && !event.is_held
                {
                    cx.stop_propagation();
                    let text = key_state.read(cx).value().to_string();
                    if !text.trim().is_empty() {
                        act(
                            &key_client,
                            cx,
                            "pullRequestCodeDraftAdd",
                            json!({ "text": text }),
                        );
                    }
                }
            })
            .child(Textarea::new(state).size(TextareaSize::Sm))
            .child(
                div()
                    .mt(px(6.))
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .child(
                        div()
                            .mr_auto()
                            .text_size(px(10.))
                            .text_color(fade(t.muted_foreground, 0.7))
                            .child(SharedString::from(draft.hint.clone())),
                    )
                    .child(
                        Button::new("code-draft-cancel")
                            .size(ButtonSize::Xs)
                            .variant(ButtonVariant::GhostMuted)
                            .label(draft.cancel_label.clone())
                            .on_click(move |_, _, cx| {
                                act(&cancel, cx, "pullRequestCodeDraftCancel", json!({}))
                            }),
                    )
                    .child(
                        Button::new("code-draft-agent")
                            .size(ButtonSize::Xs)
                            .variant(ButtonVariant::Outline)
                            .disabled(empty)
                            .label(draft.secondary_label.clone())
                            .on_click(move |_, _, cx| {
                                let text = agent_state.read(cx).value().to_string();
                                act(
                                    &agent,
                                    cx,
                                    "pullRequestCodeDraftAgent",
                                    json!({ "text": text }),
                                )
                            }),
                    )
                    .child(
                        Button::new("code-draft-add")
                            .size(ButtonSize::Xs)
                            .variant(ButtonVariant::Default)
                            .disabled(empty)
                            .label(draft.submit_label.clone())
                            .on_click(move |_, _, cx| {
                                let text = add_state.read(cx).value().to_string();
                                act(&add, cx, "pullRequestCodeDraftAdd", json!({ "text": text }))
                            }),
                    ),
            )
            .into_any_element()
    }

    fn begin_reply(
        &mut self,
        thread_id: String,
        revision: u64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let state = cx.new(|cx| TextareaState::new(window, cx).auto_grow(2, 12));
        state.update(cx, |state, cx| {
            state.set_placeholder("Reply", window, cx);
            state.focus(window, cx);
        });
        self.replies.insert(thread_id.clone(), state);
        self.reply_revisions.insert(thread_id, revision);
        cx.notify();
    }

    fn warning_icon(warning: &WarningModel, t: &Tokens) -> AnyElement {
        let (icon, color) = match warning.id.as_str() {
            "viewed-store" => ("icons/info.svg", t.muted_foreground),
            "commit-scope" => ("icons/message-square-off.svg", t.muted_foreground),
            _ => ("icons/triangle-alert.svg", t.warning_foreground),
        };
        div()
            .id(SharedString::from(format!("code-warning-{}", warning.id)))
            .flex()
            .flex_none()
            .items_center()
            .tooltip(Tooltip::text(SharedString::from(warning.tooltip.clone())))
            .child(path_icon(icon, ICON_SM, color))
            .into_any_element()
    }

    fn toolbar(&self, toolbar: &ToolbarModel, t: &Tokens, cx: &mut Context<Self>) -> AnyElement {
        let mut left = div().flex().min_w_0().flex_1().items_center().gap(px(12.));
        if toolbar.scope.visible {
            let tab = cx.entity().downgrade();
            left = left.child(
                div()
                    .relative()
                    .flex()
                    .min_w_0()
                    .max_w(px(SCOPE_MAX))
                    .child(
                        Button::new("code-scope")
                            .size(ButtonSize::Xs)
                            .variant(ButtonVariant::Secondary)
                            .min_w_0()
                            .pressed(self.scope_open)
                            .accessibility_label(toolbar.scope.aria_label.clone())
                            .child(
                                div()
                                    .min_w_0()
                                    .truncate()
                                    .child(SharedString::from(toolbar.scope.label.clone())),
                            )
                            .child(path_icon(
                                "icons/chevron-down.svg",
                                ICON_SM,
                                fade(t.foreground, 0.7),
                            ))
                            .on_click(move |_, _, cx| {
                                let _ = tab.update(cx, |tab, cx| {
                                    tab.scope_open = !tab.scope_open;
                                    cx.notify();
                                });
                            }),
                    )
                    .child(record(&self.bounds, SCOPE_ANCHOR)),
            );
        }
        let mut meta = div()
            .flex()
            .flex_none()
            .min_w_0()
            .items_center()
            .gap(px(6.))
            .child(
                div()
                    .flex_none()
                    .font_features(theme::tabular())
                    .child(SharedString::from(toolbar.file_count_label.clone())),
            );
        if let Some(viewed) = toolbar.viewed.as_ref() {
            meta = meta.child(meta_separator(t).child("·")).child(
                div()
                    .flex()
                    .min_w_0()
                    .items_center()
                    .gap(px(4.))
                    .font_features(theme::tabular())
                    .child(
                        div()
                            .flex_none()
                            .child(SharedString::from(viewed.count_label.clone())),
                    )
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .child(SharedString::from(viewed.suffix.clone())),
                    )
                    .children(
                        viewed
                            .warnings
                            .iter()
                            .map(|warning| Self::warning_icon(warning, t)),
                    ),
            );
        }
        for warning in &toolbar.warnings {
            meta = meta
                .child(meta_separator(t).child("·"))
                .child(Self::warning_icon(warning, t));
        }
        left = left.child(meta);
        let toggle = |id: &'static str,
                      icon: &'static str,
                      pressed: bool,
                      tip: &str,
                      action: &'static str,
                      client: Entity<CoreClient>| {
            div()
                .id(SharedString::from(format!("{id}-tip")))
                .flex_none()
                .tooltip(Tooltip::text(SharedString::from(tip.to_string())))
                .child(
                    Toggle::new(id)
                        .variant(ToggleVariant::Ghost)
                        .size(ToggleSize::Sm)
                        .pressed(pressed)
                        .icon(icon)
                        .accessibility_label(tip.to_string())
                        .on_change(move |pressed, _, _, cx| {
                            act(&client, cx, action, json!({ "enabled": pressed }))
                        }),
                )
        };
        let layout_client = self.client.clone();
        let collapse_client = self.client.clone();
        let right = div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(4.))
            .child(toggle(
                "code-whitespace",
                "pilcrow",
                toolbar.whitespace.pressed,
                &toolbar.whitespace.label,
                "pullRequestCodeSetWhitespace",
                self.client.clone(),
            ))
            .when(toolbar.collapse_all.visible, |this| {
                this.child(
                    div()
                        .id("code-collapse-all-tip")
                        .flex_none()
                        .tooltip(Tooltip::text(SharedString::from(
                            toolbar.collapse_all.label.clone(),
                        )))
                        .child(
                            Button::new("code-collapse-all")
                                .size(ButtonSize::IconSm)
                                .variant(ButtonVariant::Ghost)
                                .icon(if toolbar.collapse_all.all_collapsed {
                                    "chevrons-up-down"
                                } else {
                                    "chevrons-down-up"
                                })
                                .icon_size(ICON_SM)
                                .accessibility_label(toolbar.collapse_all.label.clone())
                                .on_click(move |_, _, cx| {
                                    act(&collapse_client, cx, "pullRequestCodeToggleAll", json!({}))
                                }),
                        ),
                )
            })
            .child(
                ToggleGroup::new("code-layout")
                    .variant(ToggleVariant::Segmented)
                    .size(ToggleSize::Segmented)
                    .flex_none()
                    .items(toolbar.layout.options.iter().map(|option| {
                        let client = layout_client.clone();
                        let value = option.value.clone();
                        Toggle::new(SharedString::from(format!("code-layout-{}", option.value)))
                            .pressed(option.value == toolbar.layout.value)
                            .icon(if option.value == "stacked" {
                                "rows-3"
                            } else {
                                "columns-2"
                            })
                            .accessibility_label(option.aria_label.clone())
                            .on_change(move |_, _, _, cx| {
                                act(
                                    &client,
                                    cx,
                                    "pullRequestCodeSetLayout",
                                    json!({ "layout": value }),
                                )
                            })
                    })),
            )
            .child(toggle(
                "code-word-wrap",
                "text-wrap",
                toolbar.word_wrap.pressed,
                &toolbar.word_wrap.tooltip,
                "pullRequestCodeSetWordWrap",
                self.client.clone(),
            ))
            .when(toolbar.file_tree.visible, |this| {
                this.child(toggle(
                    "code-file-tree",
                    "folder-tree",
                    toolbar.file_tree.pressed,
                    &toolbar.file_tree.label,
                    "pullRequestCodeSetFileTreeOpen",
                    self.client.clone(),
                ))
            });
        div()
            .flex()
            .flex_none()
            .h(px(TOOLBAR_HEIGHT))
            .min_h(px(TOOLBAR_HEIGHT))
            .items_center()
            .justify_between()
            .gap(px(8.))
            .border_b_1()
            .border_color(fade(t.border, 0.6))
            .bg(t.background)
            .px(px(16.))
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .text_color(t.muted_foreground)
            .child(left)
            .child(right)
            .into_any_element()
    }

    fn scope_menu(
        &self,
        toolbar: &ToolbarModel,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        if !self.scope_open {
            return None;
        }
        let trigger = *self.bounds.borrow().get(SCOPE_ANCHOR)?;
        let mut items: Vec<AnyElement> = toolbar
            .scope
            .options
            .iter()
            .map(|option| {
                let client = self.client.clone();
                let value = option.value.clone();
                let tab = cx.entity().downgrade();
                MenuRadioItem::new(SharedString::from(format!("code-scope-{}", option.value)))
                    .checked(option.value == toolbar.scope.value)
                    .on_click(move |_, _, cx| {
                        act(
                            &client,
                            cx,
                            "pullRequestCodeSelectScope",
                            json!({ "value": value }),
                        );
                        let _ = tab.update(cx, |tab, cx| {
                            tab.scope_open = false;
                            cx.notify();
                        });
                    })
                    .child(
                        div()
                            .flex()
                            .min_w_0()
                            .flex_1()
                            .items_center()
                            .gap(px(8.))
                            .child(
                                div()
                                    .min_w_0()
                                    .truncate()
                                    .child(SharedString::from(option.label.clone())),
                            )
                            .when_some(option.short_oid.as_ref(), |this, oid| {
                                this.child(
                                    div()
                                        .ml_auto()
                                        .flex_none()
                                        .font_family(MONO_FONT)
                                        .text_size(px(text::XS))
                                        .text_color(t.muted_foreground)
                                        .child(SharedString::from(oid.clone())),
                                )
                            }),
                    )
                    .into_any_element()
            })
            .collect();
        if let Some(more) = toolbar.scope.show_more_label.as_ref() {
            let client = self.client.clone();
            items.push(
                MenuItem::new("code-scope-more")
                    .on_click(move |_, _, cx| {
                        act(&client, cx, "pullRequestCodeShowMoreCommits", json!({}))
                    })
                    .child(
                        div()
                            .text_color(t.muted_foreground)
                            .child(SharedString::from(more.clone())),
                    )
                    .into_any_element(),
            );
        }
        let dismiss = cx.entity().downgrade();
        Some(
            MenuPopup::new("code-scope-menu", trigger)
                .side(PopoverSide::Bottom)
                .align(Align::Start)
                .on_dismiss(move |_, cx| {
                    let _ = dismiss.update(cx, |tab, cx| {
                        tab.scope_open = false;
                        cx.notify();
                    });
                })
                .children(items)
                .into_any_element(),
        )
    }

    fn file_header(&self, file: &FileRowModel, icon: DiffChangeIcon, t: &Tokens) -> AnyElement {
        let (icon_path, icon_color) = file_change_icon(icon, t);
        let toggle_client = self.client.clone();
        let chevron_client = self.client.clone();
        let key = file.key.clone();
        let chevron_key = file.key.clone();
        let viewed = file.header.viewed.as_ref().map(|viewed| {
            let client = self.client.clone();
            let key = file.key.clone();
            let path = file.path.clone();
            let checked = viewed.checked;
            let label = div()
                .id(SharedString::from(format!(
                    "code-viewed-label-{}",
                    file.key
                )))
                .when(viewed.stale, |this| this.text_color(t.warning_foreground))
                .when_some(viewed.stale_tooltip.as_ref(), |this, tip| {
                    this.tooltip(Tooltip::text(SharedString::from(tip.clone())))
                })
                .child(SharedString::from(viewed.label.clone()));
            div()
                .id(SharedString::from(format!("code-viewed-{}", file.key)))
                .flex()
                .flex_none()
                .items_center()
                .gap(px(6.))
                .text_size(px(TEXT_2XS))
                .line_height(px(TEXT_2XS_LINE))
                .text_color(t.muted_foreground)
                .on_click(|_, _, cx| cx.stop_propagation())
                .child(
                    Checkbox::new(SharedString::from(format!("code-viewed-box-{}", file.key)))
                        .checked(checked)
                        .on_change(move |state, _, _, cx| {
                            act(
                                &client,
                                cx,
                                "pullRequestCodeSetViewed",
                                json!({
                                    "key": key,
                                    "path": path,
                                    "viewed": state == CheckboxState::Checked,
                                }),
                            )
                        }),
                )
                .child(label)
        });
        let stat =
            file.header.diff_stat.as_ref().map(|stat| {
                diff_stat(&stat.additions, &stat.deletions, TEXT_2XS, TEXT_2XS_LINE, t)
            });
        div()
            .id(SharedString::from(format!("code-file-{}", file.key)))
            .flex()
            .w_full()
            .h(px(FILE_HEADER_HEIGHT))
            .items_center()
            .gap(px(8.))
            .py(px(FILE_HEADER_PADDING_Y))
            .pl(px(FILE_HEADER_PADDING_LEFT))
            .pr(px(FILE_HEADER_PADDING_RIGHT))
            .bg(t.background)
            .cursor_pointer()
            .on_click(move |_, _, cx| {
                act(
                    &toggle_client,
                    cx,
                    "pullRequestCodeToggleFile",
                    json!({ "key": key }),
                )
            })
            .child(
                div().flex().flex_none().w(px(FILE_HEADER_PREFIX)).child(
                    Button::new(SharedString::from(format!(
                        "code-file-chevron-{}",
                        file.key
                    )))
                    .size(ButtonSize::IconMicro)
                    .variant(ButtonVariant::Ghost)
                    .icon(if file.collapsed {
                        "chevron-right"
                    } else {
                        "chevron-down"
                    })
                    .icon_size(ICON_SM)
                    .accessibility_label(file.collapse_aria_label.clone())
                    .on_click(move |_, _, cx| {
                        cx.stop_propagation();
                        act(
                            &chevron_client,
                            cx,
                            "pullRequestCodeToggleFile",
                            json!({ "key": chevron_key }),
                        )
                    }),
                ),
            )
            .child(path_icon(icon_path, FILE_ICON, icon_color))
            .child(
                div()
                    .min_w_0()
                    .flex_1()
                    .truncate()
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.foreground)
                    .child(SharedString::from(file.path.clone())),
            )
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(FILE_META_GAP))
                    .children(stat)
                    .children(viewed),
            )
            .into_any_element()
    }

    fn thread_card(
        &self,
        thread: &CodeThreadView,
        view: &PullRequestCodeView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = theme::active(cx);
        let expanded = self
            .expanded
            .get(&thread.id)
            .copied()
            .unwrap_or(!thread.resolved);
        let tab = cx.entity().downgrade();
        let toggle_id = thread.id.clone();
        let foreground = t.foreground;
        let fix = thread.fix.as_ref().map(|fix| {
            let client = self.client.clone();
            let id = thread.id.clone();
            Button::new(SharedString::from(format!("code-thread-fix-{}", thread.id)))
                .size(ButtonSize::Xs)
                .variant(ButtonVariant::Ghost)
                .ml_auto()
                .disabled(fix.disabled)
                .icon("hammer")
                .icon_size(ICON_XS)
                .label(fix.label.clone())
                .on_click(move |_, _, cx| {
                    act(
                        &client,
                        cx,
                        "pullRequestCodeThreadFix",
                        json!({ "threadId": id }),
                    )
                })
        });
        let has_fix = fix.is_some();
        let resolve = thread.resolve.as_ref().map(|resolve| {
            let client = self.client.clone();
            let id = thread.id.clone();
            Button::new(SharedString::from(format!(
                "code-thread-resolve-{}",
                thread.id
            )))
            .size(ButtonSize::Xs)
            .variant(ButtonVariant::Ghost)
            .when(!has_fix, |button| button.ml_auto())
            .disabled(resolve.disabled)
            .label(resolve.label.clone())
            .on_click(move |_, _, cx| {
                act(
                    &client,
                    cx,
                    "pullRequestCodeThreadResolve",
                    json!({ "threadId": id }),
                )
            })
        });
        let header = div()
            .flex()
            .items_center()
            .gap(px(8.))
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .text_color(t.muted_foreground)
            .child(if thread.resolved {
                path_icon("icons/circle-check.svg", ICON_SM, t.success_foreground)
            } else {
                path_icon("icons/circle.svg", ICON_SM, t.muted_foreground)
            })
            .child(
                div()
                    .id(SharedString::from(format!(
                        "code-thread-toggle-{}",
                        thread.id
                    )))
                    .cursor_pointer()
                    .hover(move |style| style.text_color(foreground))
                    .on_click(move |_, _, cx| {
                        let _ = tab.update(cx, |tab, cx| {
                            tab.expanded.insert(toggle_id.clone(), !expanded);
                            cx.notify();
                        });
                    })
                    .child(SharedString::from(thread.status_label.clone())),
            )
            .when_some(thread.outdated_label.as_ref(), |this, label| {
                this.child(div().child(SharedString::from(label.clone())))
            })
            .children(fix)
            .children(resolve);
        let mut body = div().flex().flex_col();
        if expanded {
            let mut comments = div().mt(px(8.)).flex().flex_col().gap(px(12.));
            for comment in &thread.comments {
                let group = SharedString::from(format!("code-comment-{}", comment.id));
                let editing = view
                    .editor
                    .as_ref()
                    .filter(|editor| editor.target == comment.id);
                let content = match (editing, self.editor.as_ref()) {
                    (Some(editor), Some(state)) => div()
                        .mt(px(4.))
                        .child(markdown_editor(
                            EditorActions {
                                mode: "pullRequestCodeEditorMode",
                                save: "pullRequestCodeEditorSave",
                                cancel: "pullRequestCodeEditorCancel",
                            },
                            state,
                            editor,
                            false,
                            &self.client,
                            window,
                            cx,
                        ))
                        .into_any_element(),
                    _ => {
                        let edit = comment.can_edit.then(|| {
                            let client = self.client.clone();
                            let thread_id = thread.id.clone();
                            let comment_id = comment.id.clone();
                            div()
                                .flex_none()
                                .opacity(0.)
                                .group_hover(group.clone(), |style| style.opacity(1.))
                                .child(
                                    Button::new(SharedString::from(format!(
                                        "code-comment-edit-{}",
                                        comment.id
                                    )))
                                    .size(ButtonSize::IconXs)
                                    .variant(ButtonVariant::GhostMuted)
                                    .icon("pencil")
                                    .icon_size(ICON_XS)
                                    .accessibility_label(thread.edit_label.clone())
                                    .on_click(move |_, _, cx| {
                                        act(
                                            &client,
                                            cx,
                                            "pullRequestCodeCommentEdit",
                                            json!({ "threadId": thread_id, "commentId": comment_id }),
                                        )
                                    }),
                                )
                        });
                        div()
                            .mt(px(4.))
                            .flex()
                            .items_start()
                            .gap(px(4.))
                            .child(div().min_w_0().flex_1().child(body_view(
                                &format!("code-comment-body-{}", comment.id),
                                &comment.body,
                                &self.client,
                                &t,
                                window,
                                cx,
                            )))
                            .children(edit)
                            .into_any_element()
                    }
                };
                let reactions = view.reactions.get(&comment.id).and_then(|bar| {
                    reaction_bar(
                        &format!("code-comment-reactions-{}", comment.id),
                        &comment.id,
                        bar,
                        &self.bounds,
                        &self.client,
                        &t,
                    )
                });
                comments = comments.child(
                    div()
                        .group(group)
                        .min_w_0()
                        .child(
                            div()
                                .flex()
                                .flex_wrap()
                                .items_center()
                                .gap(px(8.))
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .text_color(t.muted_foreground)
                                .child(
                                    div()
                                        .flex()
                                        .min_w_0()
                                        .items_center()
                                        .gap(px(6.))
                                        .child(avatar(&comment.author, AVATAR, &t))
                                        .child(
                                            div()
                                                .min_w_0()
                                                .truncate()
                                                .font_weight(FontWeight::MEDIUM)
                                                .text_color(t.foreground)
                                                .child(SharedString::from(
                                                    comment.author.login.clone(),
                                                )),
                                        ),
                                )
                                .child(SharedString::from(comment.time.clone()))
                                .children(reactions.map(|bar| div().ml_auto().child(bar))),
                        )
                        .child(content),
                );
            }
            body = body.child(comments);
            if let Some(load_more) = thread.load_more.as_ref() {
                let client = self.client.clone();
                let id = thread.id.clone();
                body = body.child(
                    div().mt(px(8.)).child(
                        Button::new(SharedString::from(format!(
                            "code-thread-more-{}",
                            thread.id
                        )))
                        .size(ButtonSize::Xs)
                        .variant(ButtonVariant::Ghost)
                        .disabled(load_more.disabled)
                        .label(load_more.label.clone())
                        .on_click(move |_, _, cx| {
                            act(
                                &client,
                                cx,
                                "pullRequestCodeThreadLoadMore",
                                json!({ "threadId": id }),
                            )
                        }),
                    ),
                );
            }
            if let Some(reply) = thread.reply.as_ref() {
                body = body.child(self.reply_box(thread, reply.clone(), cx));
            }
        }
        div()
            .mx(px(12.))
            .my(px(8.))
            .rounded(px(radius::XL))
            .border_1()
            .border_color(fade(t.border, 0.7))
            .bg(t.background)
            .p(px(12.))
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .shadow_sm()
            .child(header)
            .child(body)
            .into_any_element()
    }

    fn reply_box(
        &self,
        thread: &CodeThreadView,
        reply: crate::app_core::views::pull_request_code::ReplyModel,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let id = thread.id.clone();
        match self.replies.get(&thread.id) {
            Some(state) => {
                let cancel_tab = cx.entity().downgrade();
                let cancel_id = id.clone();
                let key_tab = cx.entity().downgrade();
                let key_id = id.clone();
                let key_state = state.clone();
                let key_client = self.client.clone();
                let send_state = state.clone();
                let send_client = self.client.clone();
                let send_id = id.clone();
                let disabled = reply.disabled;
                div()
                    .mt(px(8.))
                    .capture_key_down(move |event: &KeyDownEvent, _, cx| {
                        let keystroke = &event.keystroke;
                        let modifiers = keystroke.modifiers;
                        if keystroke.key == "escape" {
                            cx.stop_propagation();
                            let id = key_id.clone();
                            let _ = key_tab.update(cx, |tab, cx| {
                                tab.replies.remove(&id);
                                tab.reply_revisions.remove(&id);
                                cx.notify();
                            });
                        } else if keystroke.key == "enter"
                            && (modifiers.platform || modifiers.control)
                            && !event.is_held
                        {
                            cx.stop_propagation();
                            let body = key_state.read(cx).value().to_string();
                            if !disabled && !body.trim().is_empty() {
                                act(
                                    &key_client,
                                    cx,
                                    "pullRequestCodeThreadReply",
                                    json!({ "threadId": key_id, "body": body }),
                                );
                            }
                        }
                    })
                    .child(Textarea::new(state).size(TextareaSize::Sm))
                    .child(
                        div()
                            .mt(px(8.))
                            .flex()
                            .justify_end()
                            .gap(px(8.))
                            .child(
                                Button::new(SharedString::from(format!("code-reply-cancel-{id}")))
                                    .size(ButtonSize::Xs)
                                    .variant(ButtonVariant::Ghost)
                                    .label(reply.cancel_label.clone())
                                    .on_click(move |_, _, cx| {
                                        let id = cancel_id.clone();
                                        let _ = cancel_tab.update(cx, |tab, cx| {
                                            tab.replies.remove(&id);
                                            tab.reply_revisions.remove(&id);
                                            cx.notify();
                                        });
                                    }),
                            )
                            .child(
                                Button::new(SharedString::from(format!("code-reply-send-{id}")))
                                    .size(ButtonSize::Xs)
                                    .variant(ButtonVariant::Default)
                                    .disabled(reply.disabled)
                                    .label(reply.label.clone())
                                    .on_click(move |_, _, cx| {
                                        let body = send_state.read(cx).value().to_string();
                                        if body.trim().is_empty() {
                                            return;
                                        }
                                        act(
                                            &send_client,
                                            cx,
                                            "pullRequestCodeThreadReply",
                                            json!({ "threadId": send_id, "body": body }),
                                        )
                                    }),
                            ),
                    )
                    .into_any_element()
            }
            None => {
                let tab = cx.entity().downgrade();
                let revision = thread.reply_revision;
                Button::new(SharedString::from(format!("code-reply-{id}")))
                    .size(ButtonSize::Xs)
                    .variant(ButtonVariant::Ghost)
                    .mt(px(8.))
                    .label(reply.label.clone())
                    .on_click(move |_, window, cx| {
                        let id = id.clone();
                        let _ = tab.update(cx, |tab, cx| tab.begin_reply(id, revision, window, cx));
                    })
                    .into_any_element()
            }
        }
    }

    fn tree(&self, tree: &TreeModel, view: &PullRequestCodeView, t: &Tokens) -> AnyElement {
        let accent = t.accent;
        let toggle_all = tree.header.toggle_all_directories.as_ref().map(|toggle| {
            let client = self.client.clone();
            div()
                .id("code-tree-toggle-all-tip")
                .tooltip(Tooltip::text(SharedString::from(toggle.tooltip.clone())))
                .child(
                    Button::new("code-tree-toggle-all")
                        .size(ButtonSize::IconXs)
                        .variant(ButtonVariant::Ghost)
                        .icon(if toggle.expanded {
                            "chevrons-down-up"
                        } else {
                            "chevrons-up-down"
                        })
                        .icon_size(ICON_SM)
                        .accessibility_label(toggle.tooltip.clone())
                        .on_click(move |_, _, cx| {
                            act(&client, cx, "pullRequestCodeTreeToggleAll", json!({}))
                        }),
                )
        });
        let rows = tree.rows.iter().map(|row| match row {
            TreeRowModel::Directory {
                path,
                name,
                depth,
                expanded,
            } => {
                let client = self.client.clone();
                let path = path.clone();
                div()
                    .id(SharedString::from(format!("code-tree-dir-{path}")))
                    .flex()
                    .h(px(TREE_ROW_HEIGHT))
                    .items_center()
                    .gap(px(4.))
                    .pl(px(8. + *depth as f32 * TREE_INDENT))
                    .pr(px(8.))
                    .rounded(px(radius::SM))
                    .cursor_pointer()
                    .hover(move |style| style.bg(accent))
                    .on_click(move |_, _, cx| {
                        act(
                            &client,
                            cx,
                            "pullRequestCodeTreeToggleDirectory",
                            json!({ "path": path }),
                        )
                    })
                    .child(path_icon(
                        if *expanded {
                            "icons/chevron-down.svg"
                        } else {
                            "icons/chevron-right.svg"
                        },
                        ICON_XS,
                        t.muted_foreground,
                    ))
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .child(SharedString::from(name.clone())),
                    )
                    .into_any_element()
            }
            TreeRowModel::File {
                path,
                name,
                depth,
                status_letter,
                status_title,
                selected,
                ..
            } => {
                let client = self.client.clone();
                let target = path.clone();
                div()
                    .id(SharedString::from(format!("code-tree-file-{path}")))
                    .flex()
                    .h(px(TREE_ROW_HEIGHT))
                    .items_center()
                    .gap(px(4.))
                    .pl(px(8. + *depth as f32 * TREE_INDENT + ICON_XS + 4.))
                    .pr(px(8.))
                    .rounded(px(radius::SM))
                    .cursor_pointer()
                    .when(*selected, |this| this.bg(accent))
                    .hover(move |style| style.bg(accent))
                    .tooltip(Tooltip::text(SharedString::from(path.clone())))
                    .on_click(move |_, _, cx| {
                        act(
                            &client,
                            cx,
                            "pullRequestCodeRevealFile",
                            json!({ "path": target }),
                        )
                    })
                    .child(
                        div()
                            .min_w_0()
                            .flex_1()
                            .truncate()
                            .text_color(t.foreground)
                            .child(SharedString::from(name.clone())),
                    )
                    .when_some(status_letter.as_ref(), |this, letter| {
                        this.child(
                            div()
                                .id(SharedString::from(format!("code-tree-status-{path}")))
                                .flex_none()
                                .font_family(MONO_FONT)
                                .text_color(t.muted_foreground)
                                .tooltip(Tooltip::text(SharedString::from(status_title.clone())))
                                .child(SharedString::from(letter.clone())),
                        )
                    })
                    .into_any_element()
            }
        });
        let footer = view.model.file_tree.footer.as_ref().map(|footer| {
            let client = self.client.clone();
            let action = if footer.action == "retry" {
                "pullRequestCodeRetry"
            } else {
                "pullRequestCodeLoadMore"
            };
            div()
                .flex_none()
                .border_t_1()
                .border_color(fade(t.border, 0.6))
                .p(px(8.))
                .child(
                    Button::new("code-tree-footer")
                        .size(ButtonSize::Xs)
                        .variant(ButtonVariant::Outline)
                        .w_full()
                        .disabled(footer.disabled)
                        .label(footer.label.clone())
                        .on_click(move |_, _, cx| act(&client, cx, action, json!({}))),
                )
        });
        div()
            .flex()
            .flex_col()
            .flex_none()
            .w(relative(0.4))
            .max_w(px(TREE_WIDTH))
            .min_w(px(TREE_MIN_WIDTH))
            .border_l_1()
            .border_color(fade(t.border, 0.6))
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .child(
                div()
                    .flex()
                    .flex_none()
                    .h(px(TOOLBAR_HEIGHT))
                    .items_center()
                    .justify_between()
                    .gap(px(4.))
                    .px(px(12.))
                    .text_color(t.muted_foreground)
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .child(
                                div()
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(t.foreground)
                                    .child(SharedString::from(tree.header.title.clone())),
                            )
                            .child(
                                div()
                                    .font_features(theme::tabular())
                                    .child(SharedString::from(tree.header.file_count.to_string())),
                            ),
                    )
                    .children(toggle_all),
            )
            .child(
                div()
                    .id("code-tree-list")
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .px(px(4.))
                    .pb(px(4.))
                    .children(rows),
            )
            .children(footer)
            .into_any_element()
    }

    fn orphans(
        &self,
        view: &PullRequestCodeView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let orphans = view.model.orphans.as_ref()?;
        let t = theme::active(cx);
        let client = self.client.clone();
        let foreground = t.foreground;
        let mut section = div()
            .flex_none()
            .border_b_1()
            .border_color(fade(t.border, 0.6))
            .child(
                div()
                    .id("code-orphans-toggle")
                    .flex()
                    .w_full()
                    .items_center()
                    .gap(px(6.))
                    .px(px(16.))
                    .py(px(8.))
                    .cursor_pointer()
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.muted_foreground)
                    .hover(move |style| style.text_color(foreground))
                    .on_click(move |_, _, cx| {
                        act(&client, cx, "pullRequestCodeToggleOrphans", json!({}))
                    })
                    .child(SharedString::from(orphans.heading.clone()))
                    .child(path_icon(
                        if view.orphans_open {
                            "icons/chevron-down.svg"
                        } else {
                            "icons/chevron-right.svg"
                        },
                        ICON_SM,
                        t.muted_foreground,
                    ))
                    .child(
                        div()
                            .font_features(theme::tabular())
                            .child(SharedString::from(orphans.count_label.clone())),
                    ),
            );
        if view.orphans_open {
            let mut list = div()
                .id("code-orphans-list")
                .max_h(px(ORPHANS_MAX))
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .gap(px(12.))
                .px(px(16.))
                .pb(px(12.));
            for file in &orphans.files {
                let mut group = div().child(
                    div()
                        .id(SharedString::from(format!(
                            "code-orphan-path-{}",
                            file.path
                        )))
                        .truncate()
                        .px(px(12.))
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .text_color(t.muted_foreground)
                        .tooltip(Tooltip::text(SharedString::from(file.path.clone())))
                        .child(SharedString::from(file.path.clone())),
                );
                let mut threads = div().mt(px(4.)).flex().flex_col().gap(px(8.));
                for entry in &file.threads {
                    let Some(thread) = view.threads.get(&entry.id) else {
                        continue;
                    };
                    threads = threads.child(
                        div()
                            .when_some(entry.line_label.as_ref(), |this, label| {
                                this.child(
                                    div()
                                        .px(px(12.))
                                        .text_size(px(text::XS))
                                        .line_height(px(text::XS_LINE))
                                        .text_color(t.muted_foreground)
                                        .child(SharedString::from(label.clone())),
                                )
                            })
                            .child(self.thread_card(thread, view, window, cx)),
                    );
                }
                group = group.child(threads);
                list = list.child(group);
            }
            section = section.child(list);
        }
        Some(section.into_any_element())
    }

    fn message(text_value: &str, t: &Tokens) -> AnyElement {
        div()
            .px(px(16.))
            .py(px(20.))
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .text_color(t.muted_foreground)
            .child(SharedString::from(text_value.to_string()))
            .into_any_element()
    }

    fn raw_list(view: &PullRequestCodeView, t: &Tokens) -> AnyElement {
        div()
            .flex()
            .flex_col()
            .gap(px(16.))
            .children(view.raw.iter().map(|slice| {
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .child(
                        div()
                            .text_size(px(text::XS))
                            .line_height(px(text::XS_LINE))
                            .text_color(t.muted_foreground)
                            .child(SharedString::from(slice.reason.clone())),
                    )
                    .child(
                        div()
                            .font_family(MONO_FONT)
                            .text_size(px(text::XS))
                            .line_height(px(text::XS_LINE))
                            .child(SharedString::from(slice.text.clone())),
                    )
            }))
            .into_any_element()
    }
}

impl Render for PullRequestCodeTab {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.sync(window, cx);
        let Some(view) = self.data.clone() else {
            return div().size_full().into_any_element();
        };
        let t = theme::active(cx);
        let toolbar = self.toolbar(&view.model.toolbar, &t, cx);
        let scope_menu = self.scope_menu(&view.model.toolbar, &t, cx);
        let scroll_children: Vec<AnyElement> = match &view.model.body {
            CodeBodyModel::Loading { label } => vec![
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap(px(8.))
                    .py(px(48.))
                    .text_size(px(text::XS))
                    .text_color(t.muted_foreground)
                    .child(Spinner::new("code-loading"))
                    .child(SharedString::from(label.clone()))
                    .into_any_element(),
            ],
            CodeBodyModel::Error { message } => vec![Self::message(message, &t)],
            CodeBodyModel::Empty { message } => vec![Self::message(message, &t)],
            CodeBodyModel::Raw => vec![
                div()
                    .px(px(16.))
                    .py(px(20.))
                    .child(Self::raw_list(&view, &t))
                    .into_any_element(),
            ],
            CodeBodyModel::Files => {
                let mut blocks: Vec<AnyElement> = Vec::new();
                for (file, model) in view.files.iter().zip(view.model.files.iter()) {
                    blocks.push(self.file_block(file, model, &view, window, cx));
                }
                let footer = match &view.model.footer {
                    CodeFooterModel::None => None,
                    CodeFooterModel::Error {
                        message,
                        retry_label,
                    } => {
                        let client = self.client.clone();
                        Some(
                            div()
                                .flex()
                                .items_center()
                                .justify_center()
                                .gap(px(8.))
                                .py(px(16.))
                                .text_size(px(text::XS))
                                .text_color(t.muted_foreground)
                                .child(SharedString::from(message.clone()))
                                .child(
                                    Button::new("code-footer-retry")
                                        .size(ButtonSize::Xs)
                                        .variant(ButtonVariant::Outline)
                                        .label(retry_label.clone())
                                        .on_click(move |_, _, cx| {
                                            act(&client, cx, "pullRequestCodeRetry", json!({}))
                                        }),
                                )
                                .into_any_element(),
                        )
                    }
                    CodeFooterModel::Loading { label } => Some(
                        div()
                            .flex()
                            .items_center()
                            .justify_center()
                            .gap(px(8.))
                            .py(px(16.))
                            .text_size(px(text::XS))
                            .text_color(t.muted_foreground)
                            .child(Spinner::new("code-footer-loading"))
                            .child(SharedString::from(label.clone()))
                            .into_any_element(),
                    ),
                    CodeFooterModel::Idle => {
                        let client = self.client.clone();
                        Some(
                            div()
                                .flex()
                                .justify_center()
                                .py(px(16.))
                                .child(
                                    Button::new("code-footer-more")
                                        .size(ButtonSize::Xs)
                                        .variant(ButtonVariant::Outline)
                                        .label("Load more files")
                                        .on_click(move |_, _, cx| {
                                            act(&client, cx, "pullRequestCodeLoadMore", json!({}))
                                        }),
                                )
                                .into_any_element(),
                        )
                    }
                };
                if let Some(footer) = footer {
                    blocks.push(footer);
                }
                if !view.raw.is_empty() {
                    blocks.push(
                        div()
                            .border_t_1()
                            .border_color(fade(t.border, 0.6))
                            .px(px(16.))
                            .py(px(20.))
                            .child(Self::raw_list(&view, &t))
                            .into_any_element(),
                    );
                }
                blocks
            }
        };
        let files_layout = matches!(view.model.body, CodeBodyModel::Files);
        let orphans = if files_layout {
            self.orphans(&view, window, cx)
        } else {
            None
        };
        let tree = if files_layout {
            view.tree.as_ref().map(|tree| self.tree(tree, &view, &t))
        } else {
            None
        };
        let pinned = if files_layout {
            sticky::pinned(
                &self.sticky,
                &self.scroll,
                view.model
                    .files
                    .iter()
                    .filter(|model| !model.collapsed)
                    .map(|model| model.key.as_str()),
                FILE_HEADER_HEIGHT,
            )
        } else {
            None
        };
        let header_overlay = pinned.and_then(|pinned| {
            let model = view
                .model
                .files
                .iter()
                .find(|model| model.key == pinned.name)?;
            let file = view.files.iter().find(|file| file.key == pinned.name)?;
            Some(sticky::overlay(
                pinned.top,
                div()
                    .id("code-pinned-header")
                    .occlude()
                    .child(self.file_header(model, file.change_icon, &t))
                    .into_any_element(),
            ))
        });
        let popup = view
            .active
            .then(|| {
                let subject = view.reaction_picker.as_ref()?;
                let bar = view.reactions.get(subject)?;
                reaction_picker_popup(subject, bar, &self.bounds, &self.client, &t)
            })
            .flatten();
        div()
            .size_full()
            .flex()
            .flex_col()
            .min_h_0()
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|tab, _, _, cx| tab.finish_selection(cx)),
            )
            .on_mouse_up_out(
                MouseButton::Left,
                cx.listener(|tab, _, _, cx| tab.finish_selection(cx)),
            )
            .child(toolbar)
            .children(orphans)
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .overflow_hidden()
                    .child(
                        div()
                            .relative()
                            .flex()
                            .flex_1()
                            .min_w_0()
                            .min_h_0()
                            .child(
                                div()
                                    .id("code-scroll")
                                    .relative()
                                    .size_full()
                                    .overflow_y_scroll()
                                    .restrict_scroll_to_axis()
                                    .track_scroll(&self.scroll)
                                    .children(scroll_children)
                                    .child(record(&self.sticky, sticky::ROOT)),
                            )
                            .children(header_overlay),
                    )
                    .children(tree),
            )
            .children(scope_menu.filter(|_| view.active))
            .children(popup)
            .into_any_element()
    }
}
