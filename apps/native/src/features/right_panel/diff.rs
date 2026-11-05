use std::cell::RefCell;
use std::ops::Range;
use std::rc::Rc;
use std::time::Duration;

use gpui::component::input::{InputEvent, InputState, TextareaState};
use gpui::prelude::FluentBuilder;
use gpui::{
    Animation, AnimationExt, AnyElement, App, AppContext, Bounds, ClickEvent, Context, Entity,
    FontStyle, FontWeight, HighlightStyle, InteractiveElement, IntoElement, KeyDownEvent,
    ListAlignment, ListOffset, ListState, MouseButton, MouseDownEvent, MouseMoveEvent,
    MouseUpEvent, ParentElement, PathBuilder, Pixels, Render, Rgba, ScrollStrategy,
    ScrollWheelEvent, SharedString, StatefulInteractiveElement, Styled, StyledText, Subscription,
    Transformation, UniformListScrollHandle, Window, canvas, div, fill, list, percentage, point,
    px, relative, svg, uniform_list,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::right_panel_diff::{
    DiffBaseRefView, DiffBodyView, DiffChangeIcon, DiffCollapseIcon, DiffCommentEntry,
    DiffContentView, DiffCopyIcon, DiffFileStatView, DiffFileTone, DiffFileTreeView,
    DiffHeaderView, DiffLayoutIcon, DiffLayoutValue, DiffLineKind, DiffLoadStatusKind,
    DiffRemoteToggleView, DiffRow, DiffSideLine, DiffTreeRow, DiffViewLayout, RightPanelDiffView,
    SyntaxToken,
};
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::input::{Input, InputSize};
use crate::ui::menu::{MenuPopup, MenuRadioItem, MenuSubTrigger, icon};
use crate::ui::pierre_icon::pierre_icon;
use crate::ui::popover::{Align, PopoverPopup, Side};
use crate::ui::skeleton::{Skeleton, SkeletonShape};
use crate::ui::switch::{Switch, SwitchSize};
use crate::ui::textarea::{Textarea, TextareaSize};
use crate::ui::theme;
use crate::ui::theme::color::{BLACK, mix};
use crate::ui::theme::tokens::{Appearance, Tokens, fade};
use crate::ui::toggle::{Toggle, ToggleSize, ToggleVariant};
use crate::ui::toggle_group::ToggleGroup;
use crate::ui::tooltip::Tooltip;

const BAR_HEIGHT: f32 = 28.;
const BAR_PADDING_X: f32 = 8.;
const BAR_MARGIN_BOTTOM: f32 = 12.;
const BAR_LEFT_GAP: f32 = 12.;
const BAR_RIGHT_GAP: f32 = 4.;
const BAR_STAT_MARGIN: f32 = 4.;
const ICON_14: f32 = 14.;
const TEXT_3XS: f32 = 10.;
const TEXT_2XS: f32 = 11.;
const TEXT_2XS_LINE: f32 = 16.;
const TEXT_XS: f32 = 12.;
const TEXT_XS_LINE: f32 = 16.;
const RAW_LINE: f32 = 17.875;
const STAT_GAP: f32 = 4.;
const BASE_REF_LABEL_MAX: f32 = 192.;
const BASE_REF_POPUP_WIDTH: f32 = 288.;
const BASE_REF_LIST_MAX: f32 = 256.;
const SCOPE_MENU_OFFSET: f32 = 4.;
const FILE_HEADER_HEIGHT: f32 = 32.;
const FILE_HEADER_PADDING_LEFT: f32 = 6.;
const FILE_HEADER_PADDING_RIGHT: f32 = 12.;
const FILE_HEADER_GAP: f32 = 8.;
const FILE_ICON: f32 = 16.;
const COPY_ICON: f32 = 12.;
const FILE_STAT_COLUMN: f32 = 30.2;
const FILE_STAT_GAP: f32 = 8.;
const COUNTS_GAP: f32 = 7.56;
const LINE_HEIGHT: f32 = 20.;
const CH: f32 = 7.8267;
const CH_FONT_SIZE: f32 = 13.;
const GUTTER_PADDING_RIGHT_EXTRA: f32 = 1.98;

pub(crate) fn ch(t: &Tokens) -> f32 {
    CH * t.code_font_size / CH_FONT_SIZE
}

pub(crate) fn gutter_padding_right(t: &Tokens) -> f32 {
    ch(t) + GUTTER_PADDING_RIGHT_EXTRA
}
const BAR_WIDTH: f32 = 4.;
const SEPARATOR_HEIGHT: f32 = 24.;
const SEPARATOR_PADDING_LEFT: f32 = 8.;
const SEPARATOR_PADDING_RIGHT: f32 = 12.;
const SEPARATOR_GAP: f32 = 8.;
const FILE_END_HEIGHT: f32 = 8.;
const HATCH_PERIOD: f32 = 8.;
const HATCH_STROKE: f32 = 1.414;
const SKELETON_HEADER_PADDING_LEFT: f32 = 8.;
const SKELETON_HEADER_PADDING_RIGHT: f32 = 12.;
const SKELETON_BOX: f32 = 20.;
const SKELETON_DOT: f32 = 10.;
const SKELETON_TITLE_HEIGHT: f32 = 12.;
const SKELETON_STAT_WIDTH: f32 = 20.;
const SKELETON_DIVIDER_HEIGHT: f32 = 24.;
const SKELETON_LINE_HEIGHT: f32 = 10.;
const SKELETON_LINE_NUMBER: f32 = 20.;
const SKELETON_CODE_GAP: f32 = 8.;
const SKELETON_CODE_PADDING_X: f32 = 12.;
const SKELETON_CODE_PADDING_Y: f32 = 8.;
const SKELETON_HUNK_WIDTH: f32 = 96.;
const MESSAGE_PADDING_X: f32 = 20.;
const NOTICE_PADDING_X: f32 = 12.;
const NOTICE_PADDING_Y: f32 = 6.;
const ERROR_MARGIN_BOTTOM: f32 = 8.;
const RAW_PADDING: f32 = 8.;
const RAW_BOX_PADDING: f32 = 12.;
const RAW_GAP: f32 = 8.;
const RAW_MAX_HEIGHT_FRACTION: f32 = 0.72;
const TREE_WIDTH: f32 = 256.;
const TREE_MIN_WIDTH: f32 = 160.;
const TREE_WIDTH_FRACTION: f32 = 0.4;
const TREE_HEADER_GAP: f32 = 4.;
const TREE_ROW_HEIGHT: f32 = 24.;
const TREE_INDENT: f32 = 18.7;
const TREE_ROW_PADDING_X: f32 = 6.4;
const TREE_ROW_GAP: f32 = 4.8;
const TREE_ROW_RADIUS: f32 = 5.;
const TREE_LIST_PADDING_LEFT: f32 = 14.4;
const TREE_LIST_PADDING_RIGHT: f32 = 8.4;
const TREE_GIT_LANE: f32 = 12.;
const TREE_GIT_DOT: f32 = 6.;
const TREE_SEGMENT_GAP: f32 = 2.;
const TREE_CHEVRON: u32 = 0x84848a;
const LIST_OVERDRAW: f32 = 600.;
const REFRESH_SPIN: Duration = Duration::from_millis(1000);

struct DiffPalette {
    text: Rgba,
    addition: Rgba,
    deletion: Rgba,
    modified: Rgba,
    number: Rgba,
    separator_text: Rgba,
    addition_row: Rgba,
    addition_gutter: Rgba,
    deletion_row: Rgba,
    deletion_gutter: Rgba,
    deletion_bar_gap: Rgba,
    hatch: Rgba,
    addition_emphasis: Rgba,
    deletion_emphasis: Rgba,
    selected_row: Rgba,
    selected_gutter: Rgba,
    selected_number: Rgba,
}

fn hex(value: u32) -> Rgba {
    gpui::rgb(value)
}

fn palette(t: &Tokens) -> DiffPalette {
    match t.appearance {
        Appearance::Dark => DiffPalette {
            text: hex(0xfafafa),
            addition: hex(0x07c480),
            deletion: hex(0xff2e3f),
            modified: hex(0x009fff),
            number: hex(0x9d9d9d),
            separator_text: hex(0x848484),
            addition_row: hex(0x0c1713),
            addition_gutter: hex(0x0e1713),
            deletion_row: hex(0x1c100f),
            deletion_gutter: hex(0x1c110f),
            deletion_bar_gap: hex(0x381917),
            hatch: hex(0x1d1d1d),
            addition_emphasis: hex(0x092f22),
            deletion_emphasis: hex(0x3b1115),
            selected_row: hex(0x0f151a),
            selected_gutter: hex(0x10151a),
            selected_number: hex(0x72b6ff),
        },
        Appearance::Light => {
            let bg = t.background;
            let addition = hex(0x0dbe4e);
            let deletion = hex(0xff2e3f);
            let fg = hex(0x0a0a0a);
            DiffPalette {
                text: fg,
                addition,
                deletion,
                modified: hex(0x009fff),
                number: mix(fg, bg, 0.65),
                separator_text: mix(fg, bg, 0.5),
                addition_row: mix(bg, addition, 0.88),
                addition_gutter: mix(bg, addition, 0.85),
                deletion_row: mix(bg, deletion, 0.88),
                deletion_gutter: mix(bg, deletion, 0.85),
                deletion_bar_gap: mix(bg, deletion, 0.7),
                hatch: mix(bg, BLACK, 0.92),
                addition_emphasis: fade(addition, 0.15),
                deletion_emphasis: fade(deletion, 0.15),
                selected_row: hex(0xeef7fd),
                selected_gutter: hex(0xeef7fd),
                selected_number: hex(0x20649e),
            }
        }
    }
}

fn tone_color(tone: DiffFileTone, p: &DiffPalette, t: &Tokens) -> Rgba {
    match tone {
        DiffFileTone::Addition => p.addition,
        DiffFileTone::Deletion => p.deletion,
        DiffFileTone::Modified => p.modified,
        DiffFileTone::Muted => fade(t.muted_foreground, 0.8),
    }
}

pub(crate) fn selected_line_colors(t: &Tokens) -> (Rgba, Rgba) {
    let p = palette(t);
    (p.selected_row, p.modified)
}

pub(crate) fn file_change_icon(icon: DiffChangeIcon, t: &Tokens) -> (&'static str, Rgba) {
    change_icon(icon, &palette(t))
}

fn change_icon(icon: DiffChangeIcon, p: &DiffPalette) -> (&'static str, Rgba) {
    match icon {
        DiffChangeIcon::Added => ("icons/diffs/symbol-added.svg", p.addition),
        DiffChangeIcon::Deleted => ("icons/diffs/symbol-deleted.svg", p.deletion),
        DiffChangeIcon::Modified => ("icons/diffs/symbol-modified.svg", p.modified),
        DiffChangeIcon::Moved => ("icons/diffs/symbol-moved.svg", p.modified),
    }
}

pub(crate) fn gutter_width(digits: u32, t: &Tokens) -> f32 {
    ch(t) * 2. + digits as f32 * ch(t) + gutter_padding_right(t)
}

fn token_color(token: &SyntaxToken, appearance: Appearance) -> Option<Rgba> {
    let value = match appearance {
        Appearance::Dark => token.dark.as_deref(),
        Appearance::Light => token.light.as_deref(),
    }?;
    Rgba::try_from(value).ok()
}

fn code_text(tokens: &[SyntaxToken], appearance: Appearance, emphasis: Rgba) -> StyledText {
    let mut text = String::new();
    let mut highlights: Vec<(Range<usize>, HighlightStyle)> = Vec::new();
    for token in tokens {
        let start = text.len();
        text.push_str(&token.text);
        let end = text.len();
        if start == end {
            continue;
        }
        let style = token.font_style.unwrap_or(0);
        let color = token_color(token, appearance);
        let emphasized = token.emphasis.unwrap_or(false);
        if color.is_none() && style == 0 && !emphasized {
            continue;
        }
        highlights.push((
            start..end,
            HighlightStyle {
                color: color.map(Into::into),
                font_style: (style & 1 != 0).then_some(FontStyle::Italic),
                font_weight: (style & 2 != 0).then_some(FontWeight::BOLD),
                background_color: emphasized.then(|| emphasis.into()),
                ..HighlightStyle::default()
            },
        ));
    }
    StyledText::new(text).with_highlights(highlights)
}

#[derive(Clone)]
struct Actions {
    client: Entity<CoreClient>,
}

impl Actions {
    fn send(&self, action: &'static str, params: Value, cx: &mut App) {
        self.client
            .update(cx, |client, _| client.act(action, params));
    }

    fn handler(
        &self,
        action: &'static str,
        params: Value,
    ) -> impl Fn(&ClickEvent, &mut Window, &mut App) + 'static {
        let actions = self.clone();
        move |_, _, cx| actions.send(action, params.clone(), cx)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Menu {
    Scope,
    BaseRef,
}

pub(crate) type ExpandHandler = Rc<dyn Fn(usize, u32, bool, &mut App)>;

pub(crate) struct StaticRowOptions {
    pub wrap: bool,
    pub h_offset: f32,
    pub selected: Option<(usize, usize)>,
    pub on_expand: Option<ExpandHandler>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum CommentSide {
    Additions,
    Deletions,
}

impl CommentSide {
    fn as_str(self) -> &'static str {
        match self {
            CommentSide::Additions => "additions",
            CommentSide::Deletions => "deletions",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct CommentPoint {
    pub(crate) side: CommentSide,
    pub(crate) line: u32,
}

fn comment_line_matches(line: &DiffSideLine, point: CommentPoint) -> bool {
    if line.number != Some(point.line) {
        return false;
    }
    match point.side {
        CommentSide::Deletions => line.line_kind == DiffLineKind::Deletion,
        CommentSide::Additions => line.line_kind != DiffLineKind::Deletion,
    }
}

fn comment_point_from_side_line(line: &DiffSideLine) -> Option<CommentPoint> {
    line.number.map(|number| CommentPoint {
        side: if line.line_kind == DiffLineKind::Deletion {
            CommentSide::Deletions
        } else {
            CommentSide::Additions
        },
        line: number,
    })
}

fn comment_point_index(rows: &[DiffRow], file_key: &str, point: CommentPoint) -> Option<usize> {
    let mut current_file: Option<&str> = None;
    for (index, row) in rows.iter().enumerate() {
        match row {
            DiffRow::FileHeader { file_key, .. } => current_file = Some(file_key.as_str()),
            DiffRow::Line { line, .. }
                if current_file == Some(file_key) && comment_line_matches(line, point) =>
            {
                return Some(index);
            }
            DiffRow::Split { left, right, .. } if current_file == Some(file_key) => {
                let matched = match point.side {
                    CommentSide::Deletions => left
                        .as_ref()
                        .is_some_and(|line| comment_line_matches(line, point)),
                    CommentSide::Additions => right
                        .as_ref()
                        .is_some_and(|line| comment_line_matches(line, point)),
                };
                if matched {
                    return Some(index);
                }
            }
            _ => {}
        }
    }
    None
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Gesture {
    Idle,
    Selecting,
    PendingUnselect,
}

#[derive(Clone, PartialEq, Eq, Debug)]
struct LineSelection {
    file_key: String,
    anchor: CommentPoint,
    current: CommentPoint,
    gesture: Gesture,
}

#[derive(Clone)]
pub(crate) struct LineGestures {
    pub on_down: LineDownHandler,
    pub on_drag: LineDragHandler,
    pub on_release: LineReleaseHandler,
    pub on_utility: LineDragHandler,
}

pub(crate) type LineDownHandler = Rc<dyn Fn(&str, CommentPoint, bool, &mut App)>;
pub(crate) type LineDragHandler = Rc<dyn Fn(&str, CommentPoint, &mut App)>;
pub(crate) type LineReleaseHandler = Rc<dyn Fn(&mut App)>;

#[derive(Clone)]
struct RowContext {
    rows: Rc<Vec<DiffRow>>,
    file_keys: Rc<Vec<Option<String>>>,
    actions: Actions,
    wrap: bool,
    h_offset: f32,
    pending: u32,
    load_more_key: Option<String>,
    requested_load: Rc<RefCell<Option<String>>>,
    selected: Option<(usize, usize)>,
    on_expand: Option<ExpandHandler>,
    gestures: Option<LineGestures>,
    comment_input: Option<Entity<TextareaState>>,
}

pub struct DiffSurface {
    actions: Actions,
    state: Entity<ViewState<Option<RightPanelDiffView>>>,
    list: ListState,
    rows: Rc<Vec<DiffRow>>,
    headers: Rc<Vec<usize>>,
    file_keys: Rc<Vec<Option<String>>>,
    thread_key: Option<String>,
    layout: Option<DiffViewLayout>,
    menu: Option<Menu>,
    turn_menu_open: bool,
    scope_bounds: Bounds<Pixels>,
    turn_bounds: Bounds<Pixels>,
    base_ref_bounds: Bounds<Pixels>,
    base_ref_input: Option<Entity<InputState>>,
    handled_scroll: Option<String>,
    tree_scroll: UniformListScrollHandle,
    tree_revealed: Option<String>,
    requested_load: Rc<RefCell<Option<String>>>,
    h_offset: f32,
    max_line_chars: usize,
    scope_menu_surface: Bounds<Pixels>,
    turn_menu_surface: Bounds<Pixels>,
    selection: Option<LineSelection>,
    comment_input: Option<Entity<TextareaState>>,
    activation: Option<Subscription>,
}

impl DiffSurface {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let state = CoreClient::subscribe::<Option<RightPanelDiffView>>(
            &client,
            "rightPanelDiff",
            json!({}),
            cx,
        );
        cx.observe(&state, |surface, state, cx| {
            let view = state.read(cx).data.clone().flatten();
            surface.sync(view.as_ref());
            cx.notify();
        })
        .detach();
        Self {
            actions: Actions { client },
            state,
            list: ListState::new(0, ListAlignment::Top, px(LIST_OVERDRAW)),
            rows: Rc::new(Vec::new()),
            headers: Rc::new(Vec::new()),
            file_keys: Rc::new(Vec::new()),
            thread_key: None,
            layout: None,
            menu: None,
            turn_menu_open: false,
            scope_bounds: Bounds::default(),
            turn_bounds: Bounds::default(),
            base_ref_bounds: Bounds::default(),
            base_ref_input: None,
            handled_scroll: None,
            tree_scroll: UniformListScrollHandle::new(),
            tree_revealed: None,
            requested_load: Rc::new(RefCell::new(None)),
            h_offset: 0.,
            max_line_chars: 0,
            scope_menu_surface: Bounds::default(),
            turn_menu_surface: Bounds::default(),
            selection: None,
            comment_input: None,
            activation: None,
        }
    }

    fn sync(&mut self, view: Option<&RightPanelDiffView>) {
        let selected_tree_row = view.and_then(|view| match &view.body {
            DiffBodyView::Content { view, .. } => match view.as_ref() {
                DiffContentView::Files {
                    file_tree: Some(tree),
                    ..
                } => tree
                    .rows
                    .iter()
                    .enumerate()
                    .find_map(|(index, row)| match row {
                        DiffTreeRow::File {
                            path,
                            selected: true,
                            ..
                        } => Some((index, path.clone())),
                        _ => None,
                    }),
                _ => None,
            },
            DiffBodyView::Message { .. } => None,
        });
        match selected_tree_row {
            Some((index, path)) if self.tree_revealed.as_deref() != Some(path.as_str()) => {
                self.tree_scroll.scroll_to_item(index, ScrollStrategy::Top);
                self.tree_revealed = Some(path);
            }
            Some(_) => {}
            None => self.tree_revealed = None,
        }
        let files = view.and_then(|view| match &view.body {
            DiffBodyView::Content { view, .. } => match view.as_ref() {
                DiffContentView::Files {
                    rows,
                    line_selection,
                    pending_count,
                    layout,
                    scroll_target,
                    ..
                } => Some((
                    rows,
                    *line_selection,
                    *pending_count,
                    *layout,
                    scroll_target,
                )),
                _ => None,
            },
            DiffBodyView::Message { .. } => None,
        });
        let thread_key = view.map(|view| view.thread_key.clone());
        let Some((rows, line_selection, pending, layout, scroll_target)) = files else {
            self.rows = Rc::new(Vec::new());
            self.headers = Rc::new(Vec::new());
            self.file_keys = Rc::new(Vec::new());
            self.list.reset(0);
            self.thread_key = thread_key;
            self.layout = None;
            self.selection = None;
            self.comment_input = None;
            return;
        };
        if !line_selection {
            self.selection = None;
        }
        let count = rows.len() + usize::from(pending > 0);
        let previous = self.rows.clone();
        let fresh = thread_key != self.thread_key || self.layout != Some(layout);
        if fresh {
            self.list.reset(count);
            self.h_offset = 0.;
        } else {
            let old_count = self.list.item_count();
            let prefix = previous
                .iter()
                .zip(rows.iter())
                .take_while(|(before, after)| before == after)
                .count();
            let max_suffix = previous.len().min(rows.len()) - prefix;
            let suffix = previous
                .iter()
                .rev()
                .zip(rows.iter().rev())
                .take(max_suffix)
                .take_while(|(before, after)| before == after)
                .count();
            let old_tail = old_count - previous.len();
            let new_tail = count - rows.len();
            if prefix != previous.len() || prefix != rows.len() || old_tail != new_tail {
                let old_end = old_count - suffix - old_tail;
                let new_len = count - suffix - prefix - new_tail;
                self.list.splice(prefix..old_end, new_len);
                if old_tail != new_tail {
                    let start = prefix + new_len + suffix;
                    self.list.splice(start..start + old_tail, new_tail);
                }
            }
        }
        let mut headers = Vec::with_capacity(rows.len());
        let mut file_keys: Vec<Option<String>> = Vec::with_capacity(rows.len());
        let mut current = 0;
        let mut current_file_key: Option<String> = None;
        let mut longest = 0;
        for (index, row) in rows.iter().enumerate() {
            match row {
                DiffRow::FileHeader { file_key, .. } => {
                    current = index;
                    current_file_key = Some(file_key.clone());
                }
                DiffRow::Line { line, .. } => longest = longest.max(line_chars(line)),
                DiffRow::Split { left, right, .. } => {
                    longest = longest
                        .max(left.as_ref().map(line_chars).unwrap_or(0))
                        .max(right.as_ref().map(line_chars).unwrap_or(0));
                }
                _ => {}
            }
            headers.push(current);
            file_keys.push(current_file_key.clone());
        }
        self.max_line_chars = longest;
        self.rows = Rc::new(rows.clone());
        self.headers = Rc::new(headers);
        self.file_keys = Rc::new(file_keys);
        self.thread_key = thread_key;
        self.layout = Some(layout);
        if let Some(target) = scroll_target
            && self.handled_scroll.as_deref() != Some(target.key.as_str())
        {
            let index = self.rows.iter().position(|row| {
                matches!(row, DiffRow::FileHeader { file_key, .. } if file_key == &target.file_key)
            });
            if let Some(index) = index {
                self.handled_scroll = Some(target.key.clone());
                self.list.scroll_to(ListOffset {
                    item_ix: index,
                    offset_in_item: px(0.),
                });
            }
        }
    }

    fn close_menus(&mut self) {
        self.menu = None;
        self.turn_menu_open = false;
    }

    fn selection_row_range(&self) -> Option<(usize, usize)> {
        let selection = self.selection.as_ref()?;
        let first = comment_point_index(&self.rows, &selection.file_key, selection.anchor)?;
        let second = comment_point_index(&self.rows, &selection.file_key, selection.current)?;
        Some(if first <= second {
            (first, second)
        } else {
            (second, first)
        })
    }

    fn start_selection(
        &mut self,
        key: &str,
        point: CommentPoint,
        utility: bool,
        cx: &mut Context<Self>,
    ) {
        let gesture = match self.selection.as_ref() {
            Some(selection)
                if !utility
                    && selection.file_key == key
                    && selection.gesture == Gesture::Idle
                    && selection.anchor == point
                    && selection.current == point =>
            {
                Gesture::PendingUnselect
            }
            _ => Gesture::Selecting,
        };
        self.selection = Some(LineSelection {
            file_key: key.to_string(),
            anchor: point,
            current: point,
            gesture,
        });
        cx.notify();
    }

    fn drag_to(&mut self, key: &str, point: CommentPoint, cx: &mut Context<Self>) {
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
            Gesture::Selecting => selection.gesture = Gesture::Idle,
            Gesture::PendingUnselect => self.selection = None,
        }
        cx.notify();
    }

    fn utility_click(&mut self, key: &str, point: CommentPoint, cx: &mut Context<Self>) {
        let (start, end) = match self.selection.as_ref() {
            Some(selection) if selection.file_key == key && selection.gesture == Gesture::Idle => {
                (selection.anchor, selection.current)
            }
            _ => (point, point),
        };
        self.begin_comment(key, start, end, cx);
    }

    fn begin_comment(
        &mut self,
        key: &str,
        start: CommentPoint,
        end: CommentPoint,
        cx: &mut Context<Self>,
    ) {
        let params = json!({
            "fileKey": key,
            "side": end.side.as_str(),
            "line": end.line,
            "startSide": start.side.as_str(),
            "startLine": start.line,
        });
        self.actions.send("rightPanelDiffCommentBegin", params, cx);
        self.selection = None;
        self.comment_input = None;
        cx.notify();
    }

    fn ensure_comment_input(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.comment_input.is_none() {
            let input = cx.new(|cx| TextareaState::new(window, cx).auto_grow(2, 12));
            self.comment_input = Some(input);
        }
    }
}

pub(crate) fn line_chars(line: &DiffSideLine) -> usize {
    line.tokens
        .iter()
        .map(|token| token.text.chars().count())
        .sum()
}

fn file_key_rows(rows: &[DiffRow]) -> Rc<Vec<Option<String>>> {
    let mut current: Option<String> = None;
    let keys = rows
        .iter()
        .map(|row| match row {
            DiffRow::FileHeader { file_key, .. } => {
                current = Some(file_key.clone());
                current.clone()
            }
            _ => current.clone(),
        })
        .collect();
    Rc::new(keys)
}

fn bounds_probe(on_bounds: impl Fn(Bounds<Pixels>, &mut App) + 'static) -> impl IntoElement {
    canvas(move |bounds, _, cx| on_bounds(bounds, cx), |_, _, _, _| {})
        .absolute()
        .size_full()
}

fn icon_svg(path: &'static str, size: f32, color: Rgba) -> gpui::Svg {
    svg()
        .path(path)
        .size(px(size))
        .flex_none()
        .text_color(color)
}

fn stat_inline(additions: &str, deletions: &str, font: f32, t: &Tokens) -> gpui::Div {
    div()
        .flex()
        .flex_none()
        .items_center()
        .gap(px(STAT_GAP))
        .font_family(MONO_FONT)
        .text_size(px(font))
        .line_height(px(TEXT_XS_LINE))
        .child(
            div()
                .text_color(t.diff_addition)
                .child(SharedString::from(additions.to_string())),
        )
        .child(
            div()
                .text_color(t.diff_deletion)
                .child(SharedString::from(deletions.to_string())),
        )
}

impl DiffSurface {
    fn header_bar(
        &self,
        header: &DiffHeaderView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let actions = &self.actions;
        let entity = cx.entity();
        let scope_trigger = div()
            .relative()
            .flex_none()
            .max_w_full()
            .child(
                Button::new("diff-scope")
                    .variant(ButtonVariant::Secondary)
                    .size(ButtonSize::Xs)
                    .accessibility_label(header.scope.aria_label.clone())
                    .pressed(self.menu == Some(Menu::Scope))
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .child(SharedString::from(header.scope.label.clone())),
                    )
                    .child(icon("chevron-down", ICON_14, fade(t.foreground, 0.7)))
                    .on_click(cx.listener(|surface, _: &ClickEvent, _, cx| {
                        surface.menu = if surface.menu == Some(Menu::Scope) {
                            None
                        } else {
                            Some(Menu::Scope)
                        };
                        surface.turn_menu_open = false;
                        cx.notify();
                    })),
            )
            .child(bounds_probe({
                let entity = entity.clone();
                move |bounds, cx| entity.update(cx, |surface, _| surface.scope_bounds = bounds)
            }));
        let left = div()
            .flex()
            .flex_1()
            .min_w_0()
            .items_center()
            .gap(px(BAR_LEFT_GAP))
            .child(scope_trigger)
            .when_some(header.base_ref.as_ref(), |this, base_ref| {
                this.child(self.base_ref_trigger(base_ref, t, cx))
            });
        let mut right = div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(BAR_RIGHT_GAP));
        if let Some(stat) = &header.stat {
            right = right.child(
                stat_inline(&stat.additions_text, &stat.deletions_text, TEXT_2XS, t)
                    .mr(px(BAR_STAT_MARGIN)),
            );
        }
        if let Some(refresh) = &header.refresh {
            let glyph = icon("refresh-cw", ICON_14, t.muted_foreground);
            let glyph = if refresh.refreshing {
                glyph
                    .with_animation(
                        "diff-refresh-spin",
                        Animation::new(REFRESH_SPIN).repeat(),
                        |svg, delta| {
                            svg.with_transformation(Transformation::rotate(percentage(delta)))
                        },
                    )
                    .into_any_element()
            } else {
                glyph.into_any_element()
            };
            right = right.child(
                div()
                    .id("diff-refresh-tip")
                    .tooltip(Tooltip::text(refresh.tooltip.clone()))
                    .child(
                        Button::new("diff-refresh")
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::IconSm)
                            .accessibility_label(refresh.aria_label.clone())
                            .child(glyph)
                            .on_click(actions.handler("rightPanelDiffRefresh", json!({}))),
                    ),
            );
        }
        if let Some(collapse) = &header.collapse_all {
            let name = match collapse.icon {
                DiffCollapseIcon::ChevronsUpDown => "chevrons-up-down",
                DiffCollapseIcon::ChevronsDownUp => "chevrons-down-up",
            };
            right = right.child(
                div()
                    .id("diff-collapse-tip")
                    .tooltip(Tooltip::text(collapse.tooltip.clone()))
                    .child(
                        Button::new("diff-collapse-all")
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::IconSm)
                            .accessibility_label(collapse.aria_label.clone())
                            .child(icon(name, ICON_14, t.muted_foreground))
                            .on_click(actions.handler("rightPanelDiffToggleAllFiles", json!({}))),
                    ),
            );
        }
        let layout_items = header.layout.options.iter().map(|option| {
            let name = match option.icon {
                DiffLayoutIcon::Rows3 => "rows-3",
                DiffLayoutIcon::Columns2 => "columns-2",
            };
            let value = match option.value {
                DiffLayoutValue::Stacked => "stacked",
                DiffLayoutValue::Split => "split",
            };
            let color = if option.selected {
                t.foreground
            } else {
                t.muted_foreground
            };
            let actions = actions.clone();
            Toggle::new(SharedString::from(format!("diff-layout-{value}")))
                .variant(ToggleVariant::Segmented)
                .size(ToggleSize::Segmented)
                .pressed(option.selected)
                .accessibility_label(option.aria_label.clone())
                .child(icon(name, ICON_14, fade(color, 0.8)))
                .on_change(move |_, _, _, cx| {
                    actions.send("rightPanelDiffSetLayout", json!({ "layout": value }), cx)
                })
        });
        right = right.child(
            ToggleGroup::new("diff-layout")
                .items(layout_items)
                .flex_none(),
        );
        let ghost_toggle = |id: &'static str,
                            name: &'static str,
                            toggle: &crate::app_core::views::right_panel_diff::DiffToggleView,
                            action: &'static str| {
            let actions = actions.clone();
            div()
                .id(SharedString::from(format!("{id}-tip")))
                .tooltip(Tooltip::text(toggle.tooltip.clone()))
                .child(
                    Toggle::new(id)
                        .variant(ToggleVariant::Ghost)
                        .size(ToggleSize::Sm)
                        .pressed(toggle.pressed)
                        .accessibility_label(toggle.aria_label.clone())
                        .child(icon(name, ICON_14, fade(t.foreground, 0.8)))
                        .on_change(move |pressed, _, _, cx| {
                            actions.send(action, json!({ "enabled": pressed }), cx)
                        }),
                )
        };
        right = right
            .child(ghost_toggle(
                "diff-word-wrap",
                "text-wrap",
                &header.word_wrap,
                "rightPanelDiffSetWordWrap",
            ))
            .child(ghost_toggle(
                "diff-whitespace",
                "pilcrow",
                &header.whitespace,
                "rightPanelDiffSetIgnoreWhitespace",
            ));
        if let Some(tree) = &header.file_tree {
            right = right.child(ghost_toggle(
                "diff-file-tree",
                "folder-tree",
                tree,
                "rightPanelDiffSetFileTreeOpen",
            ));
        }
        div()
            .flex()
            .flex_none()
            .items_center()
            .justify_between()
            .gap(px(BAR_LEFT_GAP - BAR_RIGHT_GAP))
            .h(px(BAR_HEIGHT))
            .px(px(BAR_PADDING_X))
            .mb(px(BAR_MARGIN_BOTTOM))
            .bg(t.background)
            .child(left)
            .child(right)
            .into_any_element()
    }

    fn base_ref_trigger(
        &self,
        base_ref: &DiffBaseRefView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let entity = cx.entity();
        div()
            .flex()
            .min_w_0()
            .max_w_full()
            .items_center()
            .gap(px(8.))
            .overflow_hidden()
            .text_size(px(TEXT_XS))
            .line_height(px(TEXT_XS_LINE))
            .text_color(t.muted_foreground)
            .child(
                div()
                    .id("diff-base-ref-head")
                    .flex()
                    .min_w_0()
                    .items_center()
                    .gap(px(8.))
                    .tooltip(Tooltip::text(base_ref.tooltip.clone()))
                    .child(
                        div()
                            .min_w_0()
                            .max_w(px(BASE_REF_LABEL_MAX))
                            .truncate()
                            .child(SharedString::from(base_ref.head_label.clone())),
                    )
                    .child(icon("arrow-right", ICON_14, fade(t.muted_foreground, 0.7))),
            )
            .child(
                div()
                    .relative()
                    .min_w_0()
                    .max_w(px(BASE_REF_LABEL_MAX))
                    .child(
                        Button::new("diff-base-ref")
                            .variant(ButtonVariant::GhostMuted)
                            .size(ButtonSize::Xs)
                            .accessibility_label(base_ref.trigger_aria_label.clone())
                            .pressed(self.menu == Some(Menu::BaseRef))
                            .child(
                                div()
                                    .min_w_0()
                                    .truncate()
                                    .child(SharedString::from(base_ref.base_ref.clone())),
                            )
                            .child(icon("chevron-down", ICON_14, fade(t.muted_foreground, 0.7)))
                            .on_click(cx.listener(|surface, _: &ClickEvent, window, cx| {
                                if surface.menu == Some(Menu::BaseRef) {
                                    surface.close_base_ref(cx);
                                    return;
                                }
                                surface.menu = Some(Menu::BaseRef);
                                surface.turn_menu_open = false;
                                surface.ensure_base_ref_input(window, cx);
                                cx.notify();
                            })),
                    )
                    .child(bounds_probe(move |bounds, cx| {
                        entity.update(cx, |surface, _| surface.base_ref_bounds = bounds)
                    })),
            )
            .into_any_element()
    }

    fn ensure_base_ref_input(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let input = match &self.base_ref_input {
            Some(input) => input.clone(),
            None => {
                let input = cx.new(|cx| InputState::new(window, cx));
                let actions = self.actions.clone();
                cx.subscribe_in(
                    &input,
                    window,
                    move |_, state: &Entity<InputState>, event: &InputEvent, _, cx| {
                        if let InputEvent::Change = event {
                            let query = state.read(cx).value().to_string();
                            actions.send(
                                "rightPanelDiffSetBaseRefQuery",
                                json!({ "query": query }),
                                cx,
                            );
                        }
                    },
                )
                .detach();
                self.base_ref_input = Some(input.clone());
                input
            }
        };
        input.update(cx, |state, cx| {
            state.set_value("", window, cx);
            state.focus(window, cx);
        });
    }

    fn close_base_ref(&mut self, cx: &mut Context<Self>) {
        self.menu = None;
        self.actions
            .send("rightPanelDiffSetBaseRefQuery", json!({ "query": "" }), cx);
        cx.notify();
    }

    fn scope_menu(
        &self,
        header: &DiffHeaderView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let entity = cx.entity();
        let select = |value: String, entity: Entity<Self>, actions: Actions| {
            move |_: &ClickEvent, _: &mut Window, cx: &mut App| {
                entity.update(cx, |surface, cx| {
                    surface.close_menus();
                    cx.notify();
                });
                actions.send("rightPanelDiffSelectScope", json!({ "value": value }), cx);
            }
        };
        let options = header.scope.options.iter().map(|option| {
            MenuRadioItem::new(SharedString::from(format!("diff-scope-{}", option.value)))
                .checked(option.selected)
                .on_click(select(
                    option.value.clone(),
                    entity.clone(),
                    self.actions.clone(),
                ))
                .child(SharedString::from(option.label.clone()))
                .into_any_element()
        });
        let sub_entity = entity.clone();
        let trigger = div()
            .relative()
            .child(
                MenuSubTrigger::new("diff-scope-turns", header.scope.turn_menu_label.clone())
                    .open(self.turn_menu_open)
                    .on_hover({
                        let entity = entity.clone();
                        move |hovered, _, cx| {
                            if *hovered {
                                entity.update(cx, |surface, cx| {
                                    surface.turn_menu_open = true;
                                    cx.notify();
                                });
                            }
                        }
                    })
                    .on_click({
                        let entity = entity.clone();
                        move |_, _, cx| {
                            entity.update(cx, |surface, cx| {
                                surface.turn_menu_open = !surface.turn_menu_open;
                                cx.notify();
                            });
                        }
                    }),
            )
            .child(bounds_probe(move |bounds, cx| {
                sub_entity.update(cx, |surface, _| surface.turn_bounds = bounds)
            }));
        let dismiss = entity.clone();
        let main_probe = entity.clone();
        let menu = MenuPopup::new("diff-scope-menu", self.scope_bounds)
            .side(Side::Bottom)
            .align(Align::Start)
            .side_offset(SCOPE_MENU_OFFSET)
            .on_dismiss(move |window, cx| {
                let pointer = window.mouse_position();
                dismiss.update(cx, |surface, cx| {
                    if surface.turn_menu_open && surface.turn_menu_surface.contains(&pointer) {
                        return;
                    }
                    surface.close_menus();
                    cx.notify();
                })
            })
            .children(options)
            .child(trigger)
            .child(bounds_probe(move |bounds, cx| {
                main_probe.update(cx, |surface, _| surface.scope_menu_surface = bounds)
            }));
        let turns = self.turn_menu_open.then(|| {
            let dismiss = entity.clone();
            let sub_probe = entity.clone();
            MenuPopup::sub("diff-scope-turn-menu", self.turn_bounds)
                .on_dismiss(move |window, cx| {
                    let pointer = window.mouse_position();
                    dismiss.update(cx, |surface, cx| {
                        if surface.scope_menu_surface.contains(&pointer) {
                            surface.turn_menu_open = false;
                        } else {
                            surface.close_menus();
                        }
                        cx.notify();
                    })
                })
                .child(bounds_probe(move |bounds, cx| {
                    sub_probe.update(cx, |surface, _| surface.turn_menu_surface = bounds)
                }))
                .children(header.scope.turn_options.iter().map(|option| {
                    MenuRadioItem::new(SharedString::from(format!("diff-turn-{}", option.value)))
                        .checked(option.selected)
                        .on_click(select(
                            option.value.clone(),
                            entity.clone(),
                            self.actions.clone(),
                        ))
                        .child(
                            div()
                                .flex()
                                .flex_1()
                                .items_center()
                                .gap(px(8.))
                                .child(SharedString::from(option.label.clone()))
                                .child(
                                    div()
                                        .ml_auto()
                                        .text_size(px(TEXT_XS))
                                        .text_color(t.muted_foreground)
                                        .child(SharedString::from(option.timestamp_label.clone())),
                                ),
                        )
                        .into_any_element()
                }))
        });
        div().child(menu).children(turns).into_any_element()
    }

    fn base_ref_popup(
        &self,
        base_ref: &DiffBaseRefView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let input = self.base_ref_input.clone()?;
        let entity = cx.entity();
        let actions = self.actions.clone();
        let item = |id: String, value: String, selected: bool, content: AnyElement| {
            let entity = entity.clone();
            let actions = actions.clone();
            div()
                .id(SharedString::from(id))
                .flex()
                .w_full()
                .min_w_0()
                .items_center()
                .gap(px(8.))
                .h(px(32.))
                .px(px(8.))
                .rounded(px(6.))
                .cursor_pointer()
                .text_size(px(14.))
                .text_color(t.popover_foreground)
                .hover(|s| s.bg(t.accent))
                .child(
                    div()
                        .w(px(16.))
                        .flex_none()
                        .when(selected, |s| s.child(icon("check", ICON_14, t.foreground))),
                )
                .child(div().flex_1().min_w_0().child(content))
                .on_click(move |_, _, cx| {
                    entity.update(cx, |surface, cx| surface.close_base_ref(cx));
                    actions.send("rightPanelDiffSelectBaseRef", json!({ "value": value }), cx);
                })
        };
        let mut rows: Vec<AnyElement> = Vec::new();
        if let Some(automatic) = &base_ref.automatic {
            rows.push(
                item(
                    "diff-base-ref-auto".into(),
                    automatic.value.clone(),
                    automatic.selected,
                    div()
                        .truncate()
                        .child(SharedString::from(automatic.label.clone()))
                        .into_any_element(),
                )
                .into_any_element(),
            );
        }
        for choice in &base_ref.choices {
            let toggle: AnyElement = match &choice.remote_toggle {
                DiffRemoteToggleView::Switch {
                    checked,
                    aria_label,
                } => {
                    let actions = actions.clone();
                    let choice_id = choice.id.clone();
                    div()
                        .flex()
                        .justify_end()
                        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                        .child(
                            Switch::new(SharedString::from(format!(
                                "diff-base-ref-remote-{}",
                                choice.id
                            )))
                            .size(SwitchSize::Sm)
                            .checked(*checked)
                            .accessibility_label(aria_label.clone())
                            .on_change(move |checked, _, _, cx| {
                                cx.stop_propagation();
                                actions.send(
                                    "rightPanelDiffToggleBaseRefRemote",
                                    json!({ "choiceId": choice_id, "checked": checked }),
                                    cx,
                                );
                            }),
                        )
                        .into_any_element()
                }
                DiffRemoteToggleView::RemoteOnly { label } => div()
                    .id(SharedString::from(format!(
                        "diff-base-ref-remote-only-{}",
                        choice.id
                    )))
                    .flex()
                    .justify_end()
                    .text_color(t.muted_foreground)
                    .tooltip(Tooltip::text(label.clone()))
                    .child(icon("check", COPY_ICON, t.muted_foreground))
                    .into_any_element(),
                DiffRemoteToggleView::None => div().into_any_element(),
            };
            rows.push(
                item(
                    format!("diff-base-ref-{}", choice.id),
                    choice.value.clone(),
                    choice.selected,
                    div()
                        .flex()
                        .w_full()
                        .min_w_0()
                        .items_center()
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .pr(px(8.))
                                .child(SharedString::from(choice.label.clone())),
                        )
                        .child(div().w(px(32.)).flex_none().child(toggle))
                        .into_any_element(),
                )
                .into_any_element(),
            );
        }
        let empty = rows.is_empty();
        let dismiss = entity.clone();
        Some(
            PopoverPopup::new("diff-base-ref-popup", self.base_ref_bounds)
                .side(Side::Bottom)
                .align(Align::Start)
                .on_dismiss(move |_, cx| {
                    dismiss.update(cx, |surface, cx| surface.close_base_ref(cx))
                })
                .child(
                    div()
                        .w(px(BASE_REF_POPUP_WIDTH))
                        .flex()
                        .flex_col()
                        .overflow_hidden()
                        .child(
                            div()
                                .p(px(4.))
                                .child(Input::new(&input).size(InputSize::Sm)),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(8.))
                                .pl(px(12.))
                                .pr(px(26.))
                                .pt(px(8.))
                                .pb(px(6.))
                                .border_b_1()
                                .border_color(fade(t.border, 0.7))
                                .text_size(px(TEXT_3XS))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.muted_foreground)
                                .child(div().w(px(16.)).flex_none())
                                .child(
                                    div()
                                        .flex()
                                        .flex_1()
                                        .min_w_0()
                                        .child(div().flex_1().child(SharedString::from(
                                            base_ref.branch_column_label.to_uppercase(),
                                        )))
                                        .child(div().w(px(32.)).flex().justify_end().child(
                                            SharedString::from(
                                                base_ref.remote_column_label.to_uppercase(),
                                            ),
                                        )),
                                ),
                        )
                        .when(empty, |this| {
                            this.child(
                                div()
                                    .py(px(24.))
                                    .flex()
                                    .justify_center()
                                    .text_size(px(14.))
                                    .text_color(t.muted_foreground)
                                    .child(SharedString::from(base_ref.empty_label.clone())),
                            )
                        })
                        .child(
                            div()
                                .id("diff-base-ref-list")
                                .max_h(px(BASE_REF_LIST_MAX))
                                .overflow_y_scroll()
                                .p(px(4.))
                                .flex()
                                .flex_col()
                                .children(rows),
                        ),
                )
                .into_any_element(),
        )
    }
}

fn file_header(row: &DiffRow, ctx: &RowContext, t: &Tokens, p: &DiffPalette) -> AnyElement {
    let DiffRow::FileHeader {
        file_key,
        path,
        tone,
        change_icon: change,
        collapsed,
        toggle_disabled,
        toggle_tooltip,
        copy,
        stat,
        load_status,
    } = row
    else {
        return div().into_any_element();
    };
    let actions = &ctx.actions;
    let tone = tone_color(*tone, p, t);
    let (change_path, change_color) = change_icon(*change, p);
    let chevron = if *collapsed {
        "chevron-right"
    } else {
        "chevron-down"
    };
    let copy_button = {
        let copied = copy.icon == DiffCopyIcon::Check;
        div()
            .id(SharedString::from(format!("diff-copy-tip-{file_key}")))
            .flex_none()
            .tooltip(Tooltip::text(copy.tooltip.clone()))
            .child(
                Button::new(SharedString::from(format!("diff-copy-{file_key}")))
                    .variant(ButtonVariant::GhostMuted)
                    .size(ButtonSize::IconMicro)
                    .accessibility_label(copy.aria_label.clone())
                    .child(if copied {
                        icon("check", COPY_ICON, t.success)
                    } else {
                        icon("copy", COPY_ICON, t.muted_foreground)
                    })
                    .on_click({
                        let copy =
                            actions.handler("rightPanelDiffCopyPath", json!({ "path": path }));
                        move |event, window, cx| {
                            cx.stop_propagation();
                            copy(event, window, cx);
                        }
                    }),
            )
    };
    let status = load_status.as_ref().map(|status| {
        let retry = status.kind == DiffLoadStatusKind::Error;
        let path = path.clone();
        let actions = actions.clone();
        div()
            .id(SharedString::from(format!("diff-status-tip-{file_key}")))
            .flex_none()
            .tooltip(Tooltip::text(status.tooltip.clone()))
            .child(
                Button::new(SharedString::from(format!("diff-status-{file_key}")))
                    .variant(ButtonVariant::GhostMuted)
                    .size(ButtonSize::IconMicro)
                    .accessibility_label(if retry {
                        "Retry loading diff"
                    } else {
                        "Partial diff preview"
                    })
                    .child(icon(
                        if retry { "rotate-cw" } else { "info" },
                        COPY_ICON,
                        t.muted_foreground,
                    ))
                    .on_click(move |_, _, cx| {
                        cx.stop_propagation();
                        if retry {
                            actions.send("rightPanelDiffRetryFile", json!({ "path": path }), cx);
                        }
                    }),
            )
    });
    let metadata = match stat {
        DiffFileStatView::Label {
            additions_text,
            deletions_text,
        } => div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(FILE_STAT_GAP))
            .font_family(MONO_FONT)
            .text_size(px(TEXT_XS))
            .line_height(px(TEXT_XS))
            .child(
                div()
                    .w(px(FILE_STAT_COLUMN))
                    .flex()
                    .justify_end()
                    .text_color(t.diff_addition)
                    .child(SharedString::from(additions_text.clone())),
            )
            .child(
                div()
                    .w(px(FILE_STAT_COLUMN))
                    .flex()
                    .justify_end()
                    .text_color(t.diff_deletion)
                    .child(SharedString::from(deletions_text.clone())),
            ),
        DiffFileStatView::Counts {
            additions_text,
            deletions_text,
        } => div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(COUNTS_GAP))
            .font_family(MONO_FONT)
            .text_size(px(TEXT_2XS))
            .line_height(px(TEXT_2XS))
            .child(
                div()
                    .text_color(p.addition)
                    .child(SharedString::from(additions_text.clone())),
            )
            .child(
                div()
                    .text_color(p.deletion)
                    .child(SharedString::from(deletions_text.clone())),
            ),
    };
    let toggle_params = json!({ "fileKey": file_key });
    let open_params = json!({ "path": path });
    let row_toggle = actions.handler("rightPanelDiffToggleFile", toggle_params.clone());
    let disabled = *toggle_disabled;
    div()
        .id(SharedString::from(format!("diff-file-{file_key}")))
        .flex()
        .w_full()
        .items_center()
        .justify_between()
        .gap(px(FILE_HEADER_GAP))
        .h(px(FILE_HEADER_HEIGHT))
        .pl(px(FILE_HEADER_PADDING_LEFT))
        .pr(px(FILE_HEADER_PADDING_RIGHT))
        .bg(t.background)
        .text_color(t.foreground)
        .when(!disabled, |this| {
            this.cursor_pointer()
                .on_click(move |event, window, cx| row_toggle(event, window, cx))
        })
        .child(
            div()
                .flex()
                .flex_1()
                .min_w_0()
                .items_center()
                .gap(px(FILE_HEADER_GAP))
                .child(
                    div()
                        .id(SharedString::from(format!("diff-toggle-tip-{file_key}")))
                        .flex_none()
                        .tooltip(Tooltip::text(toggle_tooltip.clone()))
                        .child(
                            Button::new(SharedString::from(format!("diff-toggle-{file_key}")))
                                .variant(ButtonVariant::Ghost)
                                .size(ButtonSize::IconMicro)
                                .disabled(disabled)
                                .accessibility_label(toggle_tooltip.clone())
                                .child(icon(chevron, FILE_ICON, tone))
                                .on_click({
                                    let toggle =
                                        actions.handler("rightPanelDiffToggleFile", toggle_params);
                                    move |event, window, cx| {
                                        cx.stop_propagation();
                                        toggle(event, window, cx);
                                    }
                                }),
                        ),
                )
                .child(icon_svg(change_path, FILE_ICON, change_color))
                .child(
                    div()
                        .id(SharedString::from(format!("diff-title-{file_key}")))
                        .min_w_0()
                        .truncate()
                        .text_size(px(TEXT_XS))
                        .line_height(px(TEXT_XS_LINE))
                        .cursor_pointer()
                        .child(SharedString::from(path.clone()))
                        .on_click({
                            let open = actions.handler("rightPanelDiffOpenFile", open_params);
                            move |event, window, cx| {
                                cx.stop_propagation();
                                open(event, window, cx);
                            }
                        })
                        .on_mouse_down(MouseButton::Right, {
                            let actions = actions.clone();
                            let path = path.clone();
                            move |event: &MouseDownEvent, _, cx| {
                                cx.stop_propagation();
                                actions.send(
                                    "rightPanelDiffFileContextMenu",
                                    json!({
                                        "path": path,
                                        "x": f32::from(event.position.x),
                                        "y": f32::from(event.position.y),
                                    }),
                                    cx,
                                );
                            }
                        }),
                )
                .child(copy_button)
                .children(status),
        )
        .child(metadata)
        .into_any_element()
}

fn deletion_bar(p: &DiffPalette) -> impl IntoElement {
    let stripe = p.deletion;
    let gap = p.deletion_bar_gap;
    canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            window.paint_quad(fill(bounds, gap));
            let mut y = 0.;
            let height = f32::from(bounds.size.height);
            while y < height {
                window.paint_quad(fill(
                    Bounds::new(
                        point(bounds.origin.x, bounds.origin.y + px(y)),
                        gpui::size(px(BAR_WIDTH), px(1.)),
                    ),
                    stripe,
                ));
                y += 2.;
            }
        },
    )
    .absolute()
    .left_0()
    .top_0()
    .bottom_0()
    .w(px(BAR_WIDTH))
}

fn hatch(p: &DiffPalette) -> impl IntoElement {
    let color = p.hatch;
    canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            window.with_content_mask(Some(gpui::ContentMask { bounds }), |window| {
                let width = f32::from(bounds.size.width);
                let height = f32::from(bounds.size.height);
                let mut x = -height;
                while x < width + HATCH_PERIOD {
                    let mut builder = PathBuilder::stroke(px(HATCH_STROKE));
                    builder.move_to(point(bounds.origin.x + px(x), bounds.origin.y + px(height)));
                    builder.line_to(point(bounds.origin.x + px(x + height), bounds.origin.y));
                    if let Ok(path) = builder.build() {
                        window.paint_path(path, color);
                    }
                    x += HATCH_PERIOD;
                }
            });
        },
    )
    .absolute()
    .size_full()
}

fn side_cells(
    line: &DiffSideLine,
    digits: u32,
    selected: bool,
    ctx: &RowContext,
    t: &Tokens,
    p: &DiffPalette,
) -> (gpui::Div, gpui::Div, Rgba) {
    let (row_bg, gutter_bg, number_color) = match line.line_kind {
        _ if selected => (p.selected_row, p.selected_gutter, p.selected_number),
        DiffLineKind::Context => (t.background, t.background, p.number),
        DiffLineKind::Addition => (p.addition_row, p.addition_gutter, p.addition),
        DiffLineKind::Deletion => (p.deletion_row, p.deletion_gutter, p.deletion),
    };
    let gutter = div()
        .relative()
        .flex()
        .flex_none()
        .justify_end()
        .w(px(gutter_width(digits, t)))
        .pr(px(gutter_padding_right(t)))
        .bg(gutter_bg)
        .text_color(number_color)
        .when_some(line.number, |this, number| {
            this.child(SharedString::from(number.to_string()))
        })
        .map(|this| match line.line_kind {
            _ if selected => this.child(
                div()
                    .absolute()
                    .left_0()
                    .top_0()
                    .bottom_0()
                    .w(px(BAR_WIDTH))
                    .bg(p.modified),
            ),
            DiffLineKind::Addition => this.child(
                div()
                    .absolute()
                    .left_0()
                    .top_0()
                    .bottom_0()
                    .w(px(BAR_WIDTH))
                    .bg(p.addition),
            ),
            DiffLineKind::Deletion => this.child(deletion_bar(p)),
            DiffLineKind::Context => this,
        });
    let emphasis = match line.line_kind {
        DiffLineKind::Addition => p.addition_emphasis,
        DiffLineKind::Deletion => p.deletion_emphasis,
        DiffLineKind::Context => t.background,
    };
    let text = code_text(&line.tokens, t.appearance, emphasis);
    let content = div()
        .flex_1()
        .min_w_0()
        .px(px(ch(t)))
        .text_color(p.text)
        .map(|this| {
            if ctx.wrap {
                this.child(text)
            } else {
                this.overflow_hidden().whitespace_nowrap().child(
                    div()
                        .relative()
                        .left(px(-ctx.h_offset))
                        .whitespace_nowrap()
                        .child(text),
                )
            }
        });
    (gutter, content, row_bg)
}

fn code_row(t: &Tokens) -> gpui::Div {
    div()
        .flex()
        .w_full()
        .min_h(px(t.diff_line_height))
        .font_family(MONO_FONT)
        .text_size(px(t.code_font_size))
        .line_height(px(t.diff_line_height))
}

fn render_row(
    index: usize,
    ctx: &RowContext,
    t: &Tokens,
    p: &DiffPalette,
    cx: &mut App,
) -> AnyElement {
    let Some(row) = ctx.rows.get(index) else {
        return loading_rows(ctx, t, cx);
    };
    let selected = ctx
        .selected
        .is_some_and(|(first, last)| (first..=last).contains(&index));
    match row {
        DiffRow::FileHeader { .. } => file_header(row, ctx, t, p),
        DiffRow::Separator { label, expand } => {
            let text = p.text;
            let rule = mix(t.background, text, 0.92);
            let rule_hover = mix(t.background, text, 0.84);
            let text_hover = mix(text, t.background, 0.76);
            let group = SharedString::from(format!("diff-separator-{index}"));
            let line = |group: &SharedString, expandable: bool| {
                div()
                    .flex_1()
                    .min_w_0()
                    .h(px(1.))
                    .bg(rule)
                    .when(expandable, |this| {
                        this.group_hover(group.clone(), move |style| style.bg(rule_hover))
                    })
            };
            let handler = expand.as_ref().zip(ctx.on_expand.clone());
            let expandable = handler.is_some();
            let base = div()
                .id(SharedString::from(format!("diff-separator-{index}")))
                .group(group.clone())
                .flex()
                .w_full()
                .h(px(SEPARATOR_HEIGHT))
                .items_center()
                .gap(px(SEPARATOR_GAP))
                .pl(px(SEPARATOR_PADDING_LEFT))
                .pr(px(SEPARATOR_PADDING_RIGHT))
                .bg(t.background)
                .text_size(px(TEXT_2XS))
                .line_height(px(LINE_HEIGHT))
                .text_color(p.separator_text)
                .child(line(&group, expandable))
                .child(
                    div()
                        .min_w_0()
                        .truncate()
                        .when(expandable, |this| {
                            this.group_hover(group.clone(), move |style| {
                                style.text_color(text_hover)
                            })
                        })
                        .child(SharedString::from(label.clone())),
                )
                .child(line(&group, expandable));
            match handler {
                Some((expand, on_expand)) => {
                    let hunk = expand.hunk_index;
                    base.cursor_pointer()
                        .on_click(move |event: &ClickEvent, _, cx| {
                            on_expand(index, hunk, event.modifiers().shift, cx)
                        })
                        .into_any_element()
                }
                None => base.into_any_element(),
            }
        }
        DiffRow::Line {
            gutter_digits,
            line,
            ..
        } => {
            let (gutter, content, bg) = side_cells(line, *gutter_digits, selected, ctx, t, p);
            let gutter =
                decorate_gutter(gutter, index, comment_point_from_side_line(line), ctx, t, p);
            code_row(t)
                .bg(bg)
                .child(gutter)
                .child(content)
                .into_any_element()
        }
        DiffRow::Split {
            gutter_digits,
            left,
            right,
            ..
        } => {
            let half = |line: &Option<DiffSideLine>, bordered: bool| {
                let base = div()
                    .relative()
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .when(bordered, |this| this.border_l_1().border_color(t.border));
                match line {
                    Some(line) => {
                        let (gutter, content, bg) =
                            side_cells(line, *gutter_digits, selected, ctx, t, p);
                        let gutter = decorate_gutter(
                            gutter,
                            index,
                            comment_point_from_side_line(line),
                            ctx,
                            t,
                            p,
                        );
                        base.bg(bg).child(gutter).child(content)
                    }
                    None => base.bg(t.background).child(hatch(p)),
                }
            };
            code_row(t)
                .child(half(left, false))
                .child(half(right, true))
                .into_any_element()
        }
        DiffRow::Comments { entries, .. } => {
            comments_row(index, entries, ctx, t, cx).into_any_element()
        }
        DiffRow::FileEnd => div()
            .w_full()
            .h(px(FILE_END_HEIGHT))
            .bg(t.background)
            .into_any_element(),
    }
}

fn decorate_gutter(
    gutter: gpui::Div,
    index: usize,
    point: Option<CommentPoint>,
    ctx: &RowContext,
    t: &Tokens,
    p: &DiffPalette,
) -> gpui::Stateful<gpui::Div> {
    let _ = t;
    let id = SharedString::from(format!("diff-gutter-{index}"));
    let Some(point) = point else {
        return gutter.id(id);
    };
    let Some(gestures) = ctx.gestures.as_ref() else {
        return gutter.id(id);
    };
    let Some(file_key) = ctx.file_keys.get(index).and_then(Option::as_deref) else {
        return gutter.id(id);
    };
    let group = SharedString::from(format!("diff-gutter-{index}"));
    let down = gestures.on_down.clone();
    let drag = gestures.on_drag.clone();
    let release = gestures.on_release.clone();
    let utility = gestures.on_utility.clone();
    let key_down = file_key.to_string();
    let key_drag = file_key.to_string();
    let key_utility = file_key.to_string();
    gutter
        .id(id)
        .group(group.clone())
        .on_mouse_down(MouseButton::Left, move |_: &MouseDownEvent, _, cx| {
            cx.stop_propagation();
            down(&key_down, point, false, cx);
        })
        .on_mouse_move(move |event: &MouseMoveEvent, _, cx| {
            if event.pressed_button == Some(MouseButton::Left) {
                drag(&key_drag, point, cx);
            } else {
                release(cx);
            }
        })
        .child(
            div()
                .absolute()
                .left(px(0.))
                .top(px(0.))
                .bottom(px(0.))
                .w(px(14.))
                .flex()
                .items_center()
                .justify_center()
                .cursor_pointer()
                .opacity(0.)
                .group_hover(group, |style| style.opacity(1.))
                .on_mouse_down(MouseButton::Left, move |_: &MouseDownEvent, _, cx| {
                    cx.stop_propagation();
                    utility(&key_utility, point, cx);
                })
                .child(icon_svg("icons/diffs/plus.svg", 12., p.modified)),
        )
}

fn comments_row(
    index: usize,
    entries: &[DiffCommentEntry],
    ctx: &RowContext,
    t: &Tokens,
    cx: &mut App,
) -> gpui::Div {
    let has_draft = entries
        .iter()
        .any(|entry| matches!(entry, DiffCommentEntry::Draft { .. }));
    let mut column = div().flex().flex_col().w_full();
    if !has_draft && !entries.is_empty() {
        column = column.border_y_1().border_color(fade(t.border, 0.3));
    } else if has_draft {
        column = column.py(px(4.));
    }
    for (entry_index, entry) in entries.iter().enumerate() {
        let separator = !has_draft && entry_index > 0;
        match entry {
            DiffCommentEntry::Comment {
                id,
                text,
                delete_label,
                ..
            } => {
                let actions = ctx.actions.clone();
                let remove_id = id.clone();
                let group = SharedString::from(format!("diff-comment-{index}-{id}"));
                column = column.child(
                    div()
                        .when(separator, |this| {
                            this.border_t_1().border_color(fade(t.border, 0.3))
                        })
                        .group(group.clone())
                        .flex()
                        .items_start()
                        .gap(px(10.))
                        .border_l_2()
                        .border_color(fade(t.ring, 0.55))
                        .bg(fade(t.ring, 0.045))
                        .px(px(12.))
                        .py(px(10.))
                        .text_size(px(14.))
                        .line_height(px(20.))
                        .text_color(t.foreground)
                        .child(
                            icon_svg("icons/message-circle.svg", 14., fade(t.ring, 0.7))
                                .flex_none()
                                .mt(px(2.)),
                        )
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .whitespace_normal()
                                .child(SharedString::from(text.clone())),
                        )
                        .child(
                            div()
                                .flex_none()
                                .opacity(0.)
                                .group_hover(group, |style| style.opacity(1.))
                                .child(
                                    Button::new(SharedString::from(format!(
                                        "diff-comment-delete-{index}-{id}"
                                    )))
                                    .size(ButtonSize::IconXs)
                                    .variant(ButtonVariant::GhostMuted)
                                    .icon("icons/pull-requests/trash-2.svg")
                                    .icon_size(12.)
                                    .accessibility_label(delete_label.clone())
                                    .on_click(
                                        move |_, _, cx| {
                                            actions.send(
                                                "rightPanelDiffCommentCancel",
                                                json!({ "entryId": remove_id }),
                                                cx,
                                            );
                                        },
                                    ),
                                ),
                        ),
                );
            }
            DiffCommentEntry::Draft {
                submit_label,
                cancel_label,
                send_hint,
                ..
            } => {
                let Some(state) = ctx.comment_input.as_ref() else {
                    continue;
                };
                let cancel_actions = ctx.actions.clone();
                let submit_actions = ctx.actions.clone();
                let submit_state = state.clone();
                let key_actions = ctx.actions.clone();
                let key_state = state.clone();
                let empty = state.read(cx).value().trim().is_empty();
                column = column.child(
                    div()
                        .px(px(12.))
                        .py(px(8.))
                        .text_color(t.foreground)
                        .capture_key_down(move |event: &KeyDownEvent, _, cx| {
                            let keystroke = &event.keystroke;
                            let modifiers = keystroke.modifiers;
                            if keystroke.key == "escape" {
                                cx.stop_propagation();
                                key_actions.send(
                                    "rightPanelDiffCommentCancel",
                                    json!({ "entryId": "" }),
                                    cx,
                                );
                            } else if keystroke.key == "enter"
                                && (modifiers.platform || modifiers.control)
                                && !event.is_held
                            {
                                cx.stop_propagation();
                                let text = key_state.read(cx).value().to_string();
                                if !text.trim().is_empty() {
                                    key_actions.send(
                                        "rightPanelDiffCommentSubmit",
                                        json!({ "text": text }),
                                        cx,
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
                                        .text_size(px(TEXT_3XS))
                                        .text_color(fade(t.muted_foreground, 0.7))
                                        .child(SharedString::from(send_hint.clone())),
                                )
                                .child(
                                    Button::new(SharedString::from(format!(
                                        "diff-draft-cancel-{index}"
                                    )))
                                    .size(ButtonSize::Xs)
                                    .variant(ButtonVariant::GhostMuted)
                                    .label(cancel_label.clone())
                                    .on_click(
                                        move |_, _, cx| {
                                            cancel_actions.send(
                                                "rightPanelDiffCommentCancel",
                                                json!({ "entryId": "" }),
                                                cx,
                                            );
                                        },
                                    ),
                                )
                                .child(
                                    Button::new(SharedString::from(format!(
                                        "diff-draft-submit-{index}"
                                    )))
                                    .size(ButtonSize::Xs)
                                    .variant(ButtonVariant::Default)
                                    .disabled(empty)
                                    .label(submit_label.clone())
                                    .on_click(
                                        move |_, _, cx| {
                                            let text = submit_state.read(cx).value().to_string();
                                            submit_actions.send(
                                                "rightPanelDiffCommentSubmit",
                                                json!({ "text": text }),
                                                cx,
                                            );
                                        },
                                    ),
                                ),
                        ),
                );
            }
        }
    }
    column
}

pub fn static_diff_rows(rows: &[DiffRow], client: &Entity<CoreClient>, cx: &mut App) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .w_full()
        .overflow_hidden()
        .children(static_diff_row_elements(
            rows,
            StaticRowOptions {
                wrap: false,
                h_offset: 0.,
                selected: None,
                on_expand: None,
            },
            client,
            cx,
        ))
        .into_any_element()
}

pub(crate) fn static_diff_row_elements(
    rows: &[DiffRow],
    options: StaticRowOptions,
    client: &Entity<CoreClient>,
    cx: &mut App,
) -> Vec<AnyElement> {
    let t = theme::active(cx);
    let p = palette(&t);
    let file_keys = file_key_rows(rows);
    let ctx = RowContext {
        rows: Rc::new(rows.to_vec()),
        file_keys,
        actions: Actions {
            client: client.clone(),
        },
        wrap: options.wrap,
        h_offset: options.h_offset,
        pending: 0,
        load_more_key: None,
        requested_load: Rc::new(RefCell::new(None)),
        selected: options.selected,
        on_expand: options.on_expand,
        gestures: None,
        comment_input: None,
    };
    (0..rows.len())
        .map(|index| render_row(index, &ctx, &t, &p, cx))
        .collect()
}

fn header_skeleton(id: &str, title_fraction: f32, title_max: f32) -> gpui::Div {
    div()
        .flex()
        .items_center()
        .gap(px(8.))
        .h(px(FILE_HEADER_HEIGHT))
        .pl(px(SKELETON_HEADER_PADDING_LEFT))
        .pr(px(SKELETON_HEADER_PADDING_RIGHT))
        .child(
            div()
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(SKELETON_BOX))
                .child(
                    Skeleton::new(SharedString::from(format!("{id}-dot"))).size(px(SKELETON_DOT)),
                ),
        )
        .child(
            Skeleton::new(SharedString::from(format!("{id}-icon")))
                .size(px(SKELETON_BOX))
                .flex_none(),
        )
        .child(
            Skeleton::new(SharedString::from(format!("{id}-title")))
                .shape(SkeletonShape::Pill)
                .h(px(SKELETON_TITLE_HEIGHT))
                .w(relative(title_fraction))
                .max_w(px(title_max)),
        )
        .child(
            div()
                .ml_auto()
                .flex()
                .flex_none()
                .items_center()
                .gap(px(8.))
                .child(
                    Skeleton::new(SharedString::from(format!("{id}-add")))
                        .shape(SkeletonShape::Pill)
                        .h(px(SKELETON_TITLE_HEIGHT))
                        .w(px(SKELETON_STAT_WIDTH)),
                )
                .child(
                    Skeleton::new(SharedString::from(format!("{id}-del")))
                        .shape(SkeletonShape::Pill)
                        .h(px(SKELETON_TITLE_HEIGHT))
                        .w(px(SKELETON_STAT_WIDTH)),
                ),
        )
}

fn loading_rows(ctx: &RowContext, t: &Tokens, cx: &mut App) -> AnyElement {
    if let Some(key) = &ctx.load_more_key {
        let requested = ctx.requested_load.borrow().clone();
        if requested.as_deref() != Some(key.as_str()) {
            *ctx.requested_load.borrow_mut() = Some(key.clone());
            let actions = ctx.actions.clone();
            cx.defer(move |cx| actions.send("rightPanelDiffLoadMore", json!({}), cx));
        }
    }
    div()
        .flex()
        .flex_col()
        .w_full()
        .children((0..ctx.pending).map(|index| {
            div()
                .border_b_1()
                .border_color(fade(t.border, 0.4))
                .child(header_skeleton(&format!("diff-pending-{index}"), 0.5, 256.))
        }))
        .into_any_element()
}

fn loading_state(t: &Tokens) -> AnyElement {
    let line = |id: &str, fraction: f32| {
        div()
            .flex()
            .items_center()
            .gap(px(12.))
            .child(
                Skeleton::new(SharedString::from(format!("{id}-n")))
                    .shape(SkeletonShape::Pill)
                    .h(px(SKELETON_LINE_HEIGHT))
                    .w(px(SKELETON_LINE_NUMBER))
                    .flex_none(),
            )
            .child(
                Skeleton::new(SharedString::from(format!("{id}-t")))
                    .shape(SkeletonShape::Pill)
                    .h(px(SKELETON_LINE_HEIGHT))
                    .w(relative(fraction)),
            )
    };
    div()
        .flex_1()
        .min_h_0()
        .overflow_hidden()
        .bg(t.background)
        .child(header_skeleton("diff-loading-a", 0.5, 256.))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .h(px(SKELETON_DIVIDER_HEIGHT))
                .pl(px(SKELETON_HEADER_PADDING_LEFT))
                .pr(px(SKELETON_HEADER_PADDING_RIGHT))
                .child(div().h(px(1.)).flex_1().bg(fade(t.border, 0.4)))
                .child(
                    Skeleton::new("diff-loading-hunk")
                        .shape(SkeletonShape::Pill)
                        .h(px(SKELETON_LINE_HEIGHT))
                        .w(px(SKELETON_HUNK_WIDTH)),
                )
                .child(div().h(px(1.)).flex_1().bg(fade(t.border, 0.4))),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap(px(SKELETON_CODE_GAP))
                .px(px(SKELETON_CODE_PADDING_X))
                .py(px(SKELETON_CODE_PADDING_Y))
                .child(line("diff-loading-l1", 2. / 3.))
                .child(line("diff-loading-l2", 0.8))
                .child(line("diff-loading-l3", 0.6)),
        )
        .child(header_skeleton("diff-loading-b", 0.4, 208.))
        .child(header_skeleton("diff-loading-c", 0.6, 288.))
        .into_any_element()
}

impl DiffSurface {
    fn file_tree(&self, tree: &DiffFileTreeView, t: &Tokens) -> AnyElement {
        let actions = self.actions.clone();
        let rows = Rc::new(tree.rows.clone());
        let list_rows = rows.clone();
        let list = uniform_list("diff-tree-rows", rows.len(), move |range, _, cx| {
            let t = theme::active(cx);
            range
                .filter_map(|index| {
                    list_rows
                        .get(index)
                        .map(|row| tree_row(index, row, &actions, &t, cx))
                })
                .collect::<Vec<_>>()
        })
        .track_scroll(&self.tree_scroll)
        .flex_1()
        .min_h_0()
        .pl(px(TREE_LIST_PADDING_LEFT))
        .pr(px(TREE_LIST_PADDING_RIGHT));
        let actions = &self.actions;
        let toggle_all = tree.toggle_all.as_ref().map(|toggle| {
            let name = match toggle.icon {
                DiffCollapseIcon::ChevronsDownUp => "chevrons-down-up",
                DiffCollapseIcon::ChevronsUpDown => "chevrons-up-down",
            };
            div()
                .id("diff-tree-toggle-all-tip")
                .tooltip(Tooltip::text(toggle.tooltip.clone()))
                .child(
                    Button::new("diff-tree-toggle-all")
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::IconXs)
                        .accessibility_label(toggle.aria_label.clone())
                        .child(icon(name, ICON_14, t.muted_foreground))
                        .on_click(
                            actions.handler("rightPanelDiffToggleAllTreeDirectories", json!({})),
                        ),
                )
        });
        div()
            .flex()
            .flex_col()
            .flex_none()
            .min_h_0()
            .w(relative(TREE_WIDTH_FRACTION))
            .max_w(px(TREE_WIDTH))
            .min_w(px(TREE_MIN_WIDTH))
            .border_l_1()
            .border_color(fade(t.border, 0.6))
            .bg(t.background)
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(TREE_HEADER_GAP))
                    .h(px(BAR_HEIGHT))
                    .mb(px(BAR_MARGIN_BOTTOM))
                    .px(px(8.))
                    .text_size(px(TEXT_XS))
                    .line_height(px(TEXT_XS_LINE))
                    .text_color(t.muted_foreground)
                    .child(
                        div()
                            .px(px(4.))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.foreground)
                            .child(SharedString::from(tree.title.clone())),
                    )
                    .child(
                        div()
                            .ml_auto()
                            .child(SharedString::from(tree.file_count.to_string())),
                    )
                    .children(toggle_all),
            )
            .child(list)
            .into_any_element()
    }
}

fn tree_status_color(status: &str, appearance: Appearance) -> Rgba {
    let (dark, light) = match status {
        "added" | "untracked" => (0x00cab1, 0x16a994),
        "deleted" => (0xff6762, 0xff2e3f),
        "renamed" => (0xffd452, 0xd5a910),
        "ignored" => (0x4a4a4e, 0xadadb1),
        _ => (0x08c0ef, 0x1ca1c7),
    };
    hex(match appearance {
        Appearance::Dark => dark,
        Appearance::Light => light,
    })
}

fn tree_row(
    index: usize,
    row: &DiffTreeRow,
    actions: &Actions,
    t: &Tokens,
    cx: &App,
) -> gpui::Stateful<gpui::Div> {
    let (depth, selected) = match row {
        DiffTreeRow::Directory { depth, .. } => (*depth, false),
        DiffTreeRow::File {
            depth, selected, ..
        } => (*depth, *selected),
    };
    let base = div()
        .id(("diff-tree-row", index))
        .flex()
        .items_center()
        .gap(px(TREE_ROW_GAP))
        .h(px(TREE_ROW_HEIGHT))
        .px(px(TREE_ROW_PADDING_X))
        .rounded(px(TREE_ROW_RADIUS))
        .cursor_pointer()
        .text_size(px(TEXT_XS))
        .line_height(px(TREE_ROW_HEIGHT))
        .text_color(t.foreground)
        .when(selected, |this| this.bg(fade(t.foreground, 0.12)))
        .when(!selected, |this| {
            this.hover(|style| style.bg(fade(t.foreground, 0.07)))
        })
        .when(depth > 0, |this| {
            this.child(
                div()
                    .flex_none()
                    .w(px(depth as f32 * TREE_INDENT - TREE_ROW_GAP)),
            )
        });
    let lane = |content: AnyElement| {
        div()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .w(px(TREE_GIT_LANE))
            .h_full()
            .child(content)
    };
    match row {
        DiffTreeRow::Directory {
            path,
            name,
            expanded,
            ..
        } => {
            let segments = name.split('/').map(str::to_string).collect::<Vec<_>>();
            let last = segments.len().saturating_sub(1);
            base.child(icon(
                if *expanded {
                    "chevron-down"
                } else {
                    "chevron-right"
                },
                FILE_ICON,
                hex(TREE_CHEVRON),
            ))
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .gap(px(TREE_SEGMENT_GAP))
                    .overflow_hidden()
                    .children(
                        segments
                            .into_iter()
                            .enumerate()
                            .flat_map(|(index, segment)| {
                                let text = div()
                                    .flex_none()
                                    .when(index == last, |this| {
                                        this.flex_shrink(1.).min_w_0().truncate()
                                    })
                                    .child(SharedString::from(segment))
                                    .into_any_element();
                                if index == last {
                                    vec![text]
                                } else {
                                    vec![text, div().flex_none().child("/").into_any_element()]
                                }
                            }),
                    ),
            )
            .child(lane(
                div()
                    .size(px(TREE_GIT_DOT))
                    .rounded_full()
                    .bg(tree_status_color("modified", t.appearance))
                    .into_any_element(),
            ))
            .on_click(actions.handler("rightPanelDiffToggleTreeDirectory", json!({ "path": path })))
        }
        DiffTreeRow::File {
            path,
            name,
            status_letter,
            status_title,
            icon: file_icon,
            tone,
            ..
        } => {
            let color = tree_status_color(tone, t.appearance);
            base.child(pierre_icon(file_icon, px(FILE_ICON), cx))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .text_color(color)
                        .child(SharedString::from(name.clone())),
                )
                .child(lane(
                    div()
                        .id(("diff-tree-status", index))
                        .text_size(px(TEXT_XS))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(color)
                        .tooltip(Tooltip::text(status_title.clone()))
                        .children(status_letter.clone().map(SharedString::from))
                        .into_any_element(),
                ))
                .on_click(actions.handler("rightPanelDiffRevealFile", json!({ "path": path })))
        }
    }
}

impl Render for DiffSurface {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.activation.is_none() {
            self.activation = Some(cx.observe_window_activation(window, |surface, window, cx| {
                if window.is_window_active() {
                    surface
                        .actions
                        .send("rightPanelDiffWindowFocused", json!({}), cx);
                }
            }));
        }
        let t = theme::active(cx);
        let root = div()
            .size_full()
            .flex()
            .flex_col()
            .min_h_0()
            .bg(t.background);
        let Some(view) = self.state.read(cx).data.clone().flatten() else {
            return root;
        };
        let root = root.child(self.header_bar(&view.header, &t, cx));
        let body = match &view.body {
            DiffBodyView::Message { message } => div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .px(px(MESSAGE_PADDING_X))
                .text_size(px(TEXT_XS))
                .line_height(px(TEXT_XS_LINE))
                .text_color(fade(t.muted_foreground, 0.7))
                .child(
                    div()
                        .text_center()
                        .child(SharedString::from(message.clone())),
                )
                .into_any_element(),
            DiffBodyView::Content {
                notice,
                error,
                view: content,
            } => div()
                .flex()
                .flex_col()
                .flex_1()
                .min_h_0()
                .min_w_0()
                .overflow_hidden()
                .bg(t.background)
                .when_some(notice.clone(), |this, notice| {
                    this.child(
                        div()
                            .flex_none()
                            .border_b_1()
                            .border_color(fade(t.border, 0.7))
                            .bg(fade(t.muted, 0.4))
                            .px(px(NOTICE_PADDING_X))
                            .py(px(NOTICE_PADDING_Y))
                            .text_size(px(TEXT_2XS))
                            .line_height(px(TEXT_2XS_LINE))
                            .text_color(t.muted_foreground)
                            .child(SharedString::from(notice)),
                    )
                })
                .when_some(error.clone(), |this, error| {
                    this.child(
                        div().px(px(NOTICE_PADDING_X)).child(
                            div()
                                .mb(px(ERROR_MARGIN_BOTTOM))
                                .text_size(px(TEXT_2XS))
                                .line_height(px(TEXT_2XS_LINE))
                                .text_color(fade(t.error, 0.8))
                                .child(SharedString::from(error)),
                        ),
                    )
                })
                .child(self.content(content, &t, window, cx))
                .into_any_element(),
        };
        let menu = match self.menu {
            Some(Menu::Scope) => Some(self.scope_menu(&view.header, &t, cx)),
            Some(Menu::BaseRef) => view
                .header
                .base_ref
                .as_ref()
                .and_then(|base_ref| self.base_ref_popup(base_ref, &t, cx)),
            None => None,
        };
        root.child(body).children(menu)
    }
}

impl DiffSurface {
    fn content(
        &mut self,
        content: &DiffContentView,
        t: &Tokens,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        match content {
            DiffContentView::Loading { .. } => loading_state(t),
            DiffContentView::Empty { message } => div()
                .flex()
                .flex_1()
                .items_center()
                .justify_center()
                .px(px(NOTICE_PADDING_X))
                .py(px(8.))
                .text_size(px(TEXT_XS))
                .line_height(px(TEXT_XS_LINE))
                .text_color(fade(t.muted_foreground, 0.7))
                .child(SharedString::from(message.clone()))
                .into_any_element(),
            DiffContentView::Raw { reason, text } => {
                let wrap = matches!(
                    self.state.read(cx).data.as_ref().and_then(|view| view.as_ref()),
                    Some(view) if view.header.word_wrap.pressed
                );
                let max_height = f32::from(window.viewport_size().height) * RAW_MAX_HEIGHT_FRACTION;
                div()
                    .id("diff-raw")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .p(px(RAW_PADDING))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(RAW_GAP))
                            .child(
                                div()
                                    .text_size(px(TEXT_2XS))
                                    .line_height(px(TEXT_2XS_LINE))
                                    .text_color(fade(t.muted_foreground, 0.75))
                                    .child(SharedString::from(reason.clone())),
                            )
                            .child(
                                div()
                                    .id("diff-raw-text")
                                    .max_h(px(max_height))
                                    .overflow_scroll()
                                    .rounded(px(6.))
                                    .border_1()
                                    .border_color(fade(t.border, 0.7))
                                    .bg(fade(t.background, 0.7))
                                    .p(px(RAW_BOX_PADDING))
                                    .font_family(MONO_FONT)
                                    .text_size(px(TEXT_2XS))
                                    .line_height(px(RAW_LINE))
                                    .text_color(fade(t.muted_foreground, 0.9))
                                    .when(!wrap, |this| this.whitespace_nowrap())
                                    .child(SharedString::from(text.clone())),
                            ),
                    )
                    .into_any_element()
            }
            DiffContentView::Files {
                wrap,
                line_selection,
                pending_count,
                load_more_key,
                file_tree,
                ..
            } => {
                let draft_placeholder = self.rows.iter().find_map(|row| match row {
                    DiffRow::Comments { entries, .. } => {
                        entries.iter().find_map(|entry| match entry {
                            DiffCommentEntry::Draft { placeholder, .. } => {
                                Some(placeholder.clone())
                            }
                            _ => None,
                        })
                    }
                    _ => None,
                });
                if draft_placeholder.is_some() {
                    if self.comment_input.is_none() {
                        self.ensure_comment_input(window, cx);
                        if let Some(state) = self.comment_input.as_ref() {
                            let placeholder = draft_placeholder.unwrap_or_default();
                            state.update(cx, |state, cx| {
                                state.set_placeholder(placeholder, window, cx);
                                state.focus(window, cx);
                            });
                        }
                    }
                } else {
                    self.comment_input = None;
                }
                let surface = cx.entity();
                let gestures = (*line_selection).then_some(LineGestures {
                    on_down: {
                        let surface = surface.clone();
                        Rc::new(
                            move |key: &str, point: CommentPoint, utility: bool, cx: &mut App| {
                                surface.update(cx, |surface, cx| {
                                    if utility {
                                        surface.utility_click(key, point, cx);
                                    } else {
                                        surface.start_selection(key, point, utility, cx);
                                    }
                                });
                            },
                        )
                    },
                    on_drag: {
                        let surface = surface.clone();
                        Rc::new(move |key: &str, point: CommentPoint, cx: &mut App| {
                            surface.update(cx, |surface, cx| surface.drag_to(key, point, cx));
                        })
                    },
                    on_release: {
                        let surface = surface.clone();
                        Rc::new(move |cx: &mut App| {
                            surface.update(cx, DiffSurface::finish_selection);
                        })
                    },
                    on_utility: {
                        let surface = surface.clone();
                        Rc::new(move |key: &str, point: CommentPoint, cx: &mut App| {
                            surface.update(cx, |surface, cx| surface.utility_click(key, point, cx));
                        })
                    },
                });
                let selected = if *line_selection {
                    self.selection_row_range()
                } else {
                    None
                };
                let expand_rows = self.rows.clone();
                let expand_headers = self.headers.clone();
                let expand_actions = self.actions.clone();
                let on_expand: ExpandHandler = Rc::new(move |index, hunk, all, cx| {
                    let file_key = expand_headers
                        .get(index)
                        .and_then(|header| expand_rows.get(*header))
                        .and_then(|row| match row {
                            DiffRow::FileHeader { file_key, .. } => Some(file_key.clone()),
                            _ => None,
                        });
                    if let Some(file_key) = file_key {
                        expand_actions.send(
                            "rightPanelDiffExpand",
                            json!({
                                "fileKey": file_key,
                                "hunkIndex": hunk,
                                "direction": "both",
                                "all": all,
                            }),
                            cx,
                        );
                    }
                });
                let ctx = RowContext {
                    rows: self.rows.clone(),
                    file_keys: self.file_keys.clone(),
                    actions: self.actions.clone(),
                    wrap: *wrap,
                    h_offset: self.h_offset,
                    pending: *pending_count,
                    load_more_key: load_more_key.clone(),
                    requested_load: self.requested_load.clone(),
                    selected,
                    on_expand: Some(on_expand),
                    gestures,
                    comment_input: self.comment_input.clone(),
                };
                let sticky = self.sticky_header(&ctx, t);
                let list_ctx = ctx.clone();
                let max_offset = (self.max_line_chars as f32 * ch(t)).max(0.);
                let code = div()
                    .id("diff-code")
                    .relative()
                    .flex_1()
                    .min_w_0()
                    .min_h_0()
                    .on_mouse_up(
                        MouseButton::Left,
                        cx.listener(|surface, _: &MouseUpEvent, _, cx| {
                            surface.finish_selection(cx);
                        }),
                    )
                    .on_mouse_up_out(
                        MouseButton::Left,
                        cx.listener(|surface, _: &MouseUpEvent, _, cx| {
                            surface.finish_selection(cx);
                        }),
                    )
                    .on_scroll_wheel(cx.listener(
                        move |surface, event: &ScrollWheelEvent, _, cx| {
                            if surface.layout.is_none() {
                                return;
                            }
                            let wrap = matches!(
                                surface.state.read(cx).data.as_ref().and_then(|view| view.as_ref()),
                                Some(view) if view.header.word_wrap.pressed
                            );
                            if wrap {
                                return;
                            }
                            let delta = event.delta.pixel_delta(px(LINE_HEIGHT));
                            let dx = f32::from(delta.x);
                            if dx == 0. {
                                return;
                            }
                            let next = (surface.h_offset - dx).clamp(0., max_offset);
                            if next != surface.h_offset {
                                surface.h_offset = next;
                                cx.notify();
                            }
                        },
                    ))
                    .child(
                        list(self.list.clone(), move |index, _, cx| {
                            let t = theme::active(cx);
                            let p = palette(&t);
                            render_row(index, &list_ctx, &t, &p, cx)
                        })
                        .size_full(),
                    )
                    .children(sticky);
                div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .overflow_hidden()
                    .child(code)
                    .children(file_tree.as_ref().map(|tree| self.file_tree(tree, t)))
                    .into_any_element()
            }
        }
    }

    fn sticky_header(&self, ctx: &RowContext, t: &Tokens) -> Option<AnyElement> {
        let top = self.list.logical_scroll_top();
        if top.item_ix == 0 && top.offset_in_item == px(0.) {
            return None;
        }
        let row = self.rows.get(top.item_ix)?;
        let header_index = *self.headers.get(top.item_ix)?;
        if matches!(row, DiffRow::FileHeader { .. }) && top.offset_in_item == px(0.) {
            return None;
        }
        let header = self.rows.get(header_index)?;
        if let DiffRow::FileHeader {
            collapsed: true, ..
        } = header
        {
            return None;
        }
        let p = palette(t);
        Some(
            div()
                .absolute()
                .top_0()
                .left_0()
                .right_0()
                .child(file_header(header, ctx, t, &p))
                .into_any_element(),
        )
    }
}
