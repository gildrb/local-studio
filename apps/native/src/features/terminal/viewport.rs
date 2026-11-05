use std::cell::Cell;
use std::ops::Range;
use std::rc::Rc;
use std::time::Duration;

use alacritty_terminal::index::{Column, Point as GridPoint, Side};
use alacritty_terminal::selection::{Selection, SelectionType};
use alacritty_terminal::term::{TermMode, viewport_to_point};
use gpui::prelude::FluentBuilder;
use gpui::{
    App, Bounds, ClipboardItem, Context, CursorStyle, DispatchPhase, ElementInputHandler, Entity,
    EntityInputHandler, FocusHandle, Focusable, InteractiveElement, IntoElement, KeyDownEvent,
    Modifiers, MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent, ParentElement, Pixels,
    Point, Render, ScrollWheelEvent, SharedString, Styled, Task, UTF16Selection, Window, canvas,
    div, px,
};
use serde_json::json;

use super::grid::{self, CellPoint, FrameInput, GridLayout, LinkRange};
use super::keys;
use super::session::{SessionEvent, TerminalSession};
use crate::app_core::views::terminal::TerminalLinkView;
use crate::platform::MAC;
use crate::ui::theme;

const BLINK_INTERVAL: Duration = Duration::from_millis(500);
const AUTOSCROLL_INTERVAL: Duration = Duration::from_millis(80);
const MULTI_CLICK_DELAY: Duration = Duration::from_millis(500);
const LINK_DRAG_THRESHOLD: f32 = 4.;
const SCROLLBAR_WIDTH: f32 = 6.;
const SCROLLBAR_INSET_Y: f32 = 4.;
const SCROLLBAR_RIGHT: f32 = 1.;
const THUMB_INSET_X: f32 = 1.;
const THUMB_RADIUS: f32 = 3.;
const MIN_THUMB_HEIGHT: f32 = 18.;
const BUTTON_LEFT: u8 = 0;
const BUTTON_MIDDLE: u8 = 1;
const BUTTON_RIGHT: u8 = 2;
const BUTTON_NONE: u8 = 3;
const MOTION: u8 = 32;
const WHEEL_UP: u8 = 64;
const WHEEL_DOWN: u8 = 65;

#[derive(Clone)]
enum Gesture {
    None,
    Selecting {
        moved: bool,
        click_count: usize,
    },
    Link {
        origin: Point<Pixels>,
        link: LinkRange,
        click_count: usize,
    },
    Reporting {
        button: u8,
    },
    Scrollbar {
        pointer_offset: f32,
    },
}

#[derive(Clone, Copy)]
struct ScrollbarGeometry {
    thumb_height: f32,
    thumb_top: f32,
    max_offset: usize,
    track_height: f32,
}

pub struct TerminalViewport {
    session: Entity<TerminalSession>,
    focus: FocusHandle,
    font_family: SharedString,
    font_size: f32,
    layout: Rc<Cell<GridLayout>>,
    gesture: Gesture,
    pointer: Option<Point<Pixels>>,
    autoscroll: i32,
    autoscroll_task: Option<Task<()>>,
    selection_action: Option<Task<()>>,
    wheel_remainder: f32,
    blink_on: bool,
    focused: bool,
    pending_focus: bool,
    hover_cell: Option<CellPoint>,
    hovered_link: Option<LinkRange>,
    probe: u64,
    marked: Option<String>,
}

fn button_code(button: MouseButton) -> Option<u8> {
    match button {
        MouseButton::Left => Some(BUTTON_LEFT),
        MouseButton::Middle => Some(BUTTON_MIDDLE),
        MouseButton::Right => Some(BUTTON_RIGHT),
        _ => None,
    }
}

fn scrollbar_geometry(
    total: usize,
    len: usize,
    offset: usize,
    track_height: f32,
) -> Option<ScrollbarGeometry> {
    let len = len.min(total);
    let max_offset = total - len;
    if track_height <= 0. || len == 0 || max_offset == 0 {
        return None;
    }
    let thumb_height = (track_height * len as f32 / total as f32)
        .max(MIN_THUMB_HEIGHT)
        .min(track_height);
    let travel = (track_height - thumb_height).max(0.);
    let offset = offset.min(max_offset);
    Some(ScrollbarGeometry {
        thumb_height,
        thumb_top: travel * (offset as f32 / max_offset as f32),
        max_offset,
        track_height,
    })
}

impl TerminalViewport {
    pub fn new(
        session: Entity<TerminalSession>,
        font_family: SharedString,
        font_size: f32,
        cx: &mut Context<Self>,
    ) -> Self {
        cx.observe(&session, |_, _, cx| cx.notify()).detach();
        cx.subscribe(
            &session,
            |viewport, _, event: &SessionEvent, cx| match event {
                SessionEvent::Focus => {
                    viewport.pending_focus = true;
                    cx.notify();
                }
            },
        )
        .detach();
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(BLINK_INTERVAL).await;
                let alive = this.update(cx, |viewport, cx| {
                    if viewport.focused || !viewport.blink_on {
                        viewport.blink_on = !viewport.blink_on || !viewport.focused;
                        cx.notify();
                    }
                });
                if alive.is_err() {
                    return;
                }
            }
        })
        .detach();
        Self {
            session,
            focus: cx.focus_handle(),
            font_family,
            font_size,
            layout: Rc::new(Cell::new(GridLayout::default())),
            gesture: Gesture::None,
            pointer: None,
            autoscroll: 0,
            autoscroll_task: None,
            selection_action: None,
            wheel_remainder: 0.,
            blink_on: true,
            focused: false,
            pending_focus: false,
            hover_cell: None,
            hovered_link: None,
            probe: 0,
            marked: None,
        }
    }

    pub fn set_font(&mut self, family: SharedString, size: f32, cx: &mut Context<Self>) {
        if family != self.font_family || size != self.font_size {
            self.font_family = family;
            self.font_size = size;
            cx.notify();
        }
    }

    pub fn apply_link_hover(
        &mut self,
        probe: u64,
        link: Option<TerminalLinkView>,
        cx: &mut Context<Self>,
    ) {
        let link = link.map(|link| LinkRange {
            text: link.text,
            start: CellPoint {
                col: link.range.start.x,
                row: link.range.start.y,
            },
            end: CellPoint {
                col: link.range.end.x,
                row: link.range.end.y,
            },
        });
        if probe != self.probe || self.hovered_link == link {
            return;
        }
        if matches!(self.gesture, Gesture::None | Gesture::Link { .. }) {
            self.hovered_link = link;
            cx.notify();
        }
    }

    pub fn request_focus(&mut self, cx: &mut Context<Self>) {
        self.pending_focus = true;
        cx.notify();
    }

    fn write(&self, data: String, cx: &mut App) {
        self.session
            .update(cx, |session, cx| session.write(data, cx));
    }

    fn act(&self, action: &'static str, params: serde_json::Value, cx: &mut App) {
        self.session
            .update(cx, |session, cx| session.act(action, params, cx));
    }

    fn mode(&self, cx: &App) -> TermMode {
        *self.session.read(cx).term().mode()
    }

    fn reports_mouse(&self, shift: bool, cx: &App) -> bool {
        !shift && self.mode(cx).intersects(TermMode::MOUSE_MODE)
    }

    fn clamped_cell(&self, position: Point<Pixels>) -> (CellPoint, Side) {
        let layout = self.layout.get();
        let x = f32::from(position.x - layout.origin.x).max(0.);
        let y = f32::from(position.y - layout.origin.y).max(0.);
        let width = layout.cell_width.max(1.);
        let col = ((x / width) as usize).min(layout.cols.saturating_sub(1));
        let row = ((y / layout.cell_height.max(1.)) as usize).min(layout.rows.saturating_sub(1));
        let side = if x - col as f32 * width > width / 2. {
            Side::Right
        } else {
            Side::Left
        };
        (CellPoint { col, row }, side)
    }

    fn grid_cell(&self, position: Point<Pixels>) -> Option<CellPoint> {
        let layout = self.layout.get();
        let x = f32::from(position.x - layout.origin.x);
        let y = f32::from(position.y - layout.origin.y);
        if x < 0.
            || y < 0.
            || x >= layout.cols as f32 * layout.cell_width
            || y >= layout.rows as f32 * layout.cell_height
        {
            return None;
        }
        Some(CellPoint {
            col: (x / layout.cell_width.max(1.)) as usize,
            row: (y / layout.cell_height.max(1.)) as usize,
        })
    }

    fn grid_point(&self, cell: CellPoint, cx: &App) -> GridPoint {
        let offset = self.session.read(cx).term().grid().display_offset();
        viewport_to_point(offset, GridPoint::new(cell.row, Column(cell.col)))
    }

    fn report(
        &self,
        button: u8,
        modifiers: Modifiers,
        cell: CellPoint,
        pressed: bool,
        cx: &mut App,
    ) {
        let data = keys::mouse_report(
            button,
            modifiers,
            (cell.col, cell.row),
            pressed,
            self.mode(cx),
        );
        self.write(data, cx);
    }

    fn cancel_selection_action(&mut self) {
        self.selection_action = None;
    }

    fn set_hovered_link(&mut self, link: Option<LinkRange>, cx: &mut Context<Self>) {
        if self.hovered_link != link {
            self.hovered_link = link;
            cx.notify();
        }
    }

    fn clear_hover(&mut self, cx: &mut Context<Self>) {
        self.hover_cell = None;
        self.probe += 1;
        self.set_hovered_link(None, cx);
    }

    fn update_hover(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        let cell = self.grid_cell(position);
        if cell == self.hover_cell {
            return;
        }
        self.hover_cell = cell;
        self.probe += 1;
        let Some(cell) = cell else {
            self.set_hovered_link(None, cx);
            return;
        };
        let session = self.session.read(cx);
        if let Some(link) = session.hyperlink_at(cell) {
            self.set_hovered_link(Some(link), cx);
            return;
        }
        let (first_row, rows) = session.wrapped_rows(cell.row);
        let probe = self.probe;
        if !self
            .hovered_link
            .as_ref()
            .is_some_and(|link| link.contains(cell))
        {
            self.set_hovered_link(None, cx);
        }
        self.act(
            "terminalLinkProbe",
            json!({
                "probe": probe,
                "row": cell.row,
                "column": cell.col,
                "firstRow": first_row,
                "rows": rows,
            }),
            cx,
        );
    }

    fn begin_selection(
        &mut self,
        position: Point<Pixels>,
        click_count: usize,
        cx: &mut Context<Self>,
    ) {
        let (cell, side) = self.clamped_cell(position);
        let point = self.grid_point(cell, cx);
        let ty = match click_count {
            2 => SelectionType::Semantic,
            count if count >= 3 => SelectionType::Lines,
            _ => SelectionType::Simple,
        };
        self.gesture = Gesture::Selecting {
            moved: false,
            click_count,
        };
        self.session.update(cx, |session, cx| {
            session.term_mut().selection = Some(Selection::new(ty, point, side));
            cx.notify();
        });
    }

    fn extend_selection(&mut self, position: Point<Pixels>, cx: &mut Context<Self>) {
        let (cell, side) = self.clamped_cell(position);
        let point = self.grid_point(cell, cx);
        if let Gesture::Selecting { moved, .. } = &mut self.gesture {
            *moved = true;
        }
        self.session.update(cx, |session, cx| {
            if let Some(selection) = session.term_mut().selection.as_mut() {
                selection.update(point, side);
                cx.notify();
            }
        });
    }

    fn set_autoscroll(&mut self, direction: i32, cx: &mut Context<Self>) {
        if direction == self.autoscroll {
            return;
        }
        self.autoscroll = direction;
        if direction == 0 {
            self.autoscroll_task = None;
            return;
        }
        self.autoscroll_task = Some(cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(AUTOSCROLL_INTERVAL).await;
                let alive = this.update(cx, |viewport, cx| {
                    if viewport.autoscroll == 0 {
                        return;
                    }
                    let direction = viewport.autoscroll;
                    viewport
                        .session
                        .update(cx, |session, _| session.scroll(direction));
                    if let Some(pointer) = viewport.pointer {
                        viewport.extend_selection(pointer, cx);
                    }
                    cx.notify();
                });
                if alive.is_err() {
                    return;
                }
            }
        }));
    }

    fn mouse_down(&mut self, event: &MouseDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        window.focus(&self.focus, cx);
        self.cancel_selection_action();
        let Some(code) = button_code(event.button) else {
            return;
        };
        let (cell, _) = self.clamped_cell(event.position);
        if self.reports_mouse(event.modifiers.shift, cx) {
            self.clear_hover(cx);
            self.gesture = Gesture::Reporting { button: code };
            self.report(code, event.modifiers, cell, true, cx);
            cx.stop_propagation();
            return;
        }
        match event.button {
            MouseButton::Left => {
                let hovered = self
                    .grid_cell(event.position)
                    .and_then(|cell| self.hovered_link.clone().filter(|link| link.contains(cell)));
                match hovered {
                    Some(link) if !event.modifiers.shift && event.click_count == 1 => {
                        self.gesture = Gesture::Link {
                            origin: event.position,
                            link,
                            click_count: event.click_count,
                        };
                        cx.stop_propagation();
                    }
                    _ => {
                        self.clear_hover(cx);
                        self.begin_selection(event.position, event.click_count, cx);
                    }
                }
            }
            MouseButton::Right => {
                let selection = self.session.read(cx).selection_payload();
                self.act(
                    "terminalContextMenu",
                    json!({
                        "position": { "x": f32::from(event.position.x), "y": f32::from(event.position.y) },
                        "selection": selection,
                    }),
                    cx,
                );
            }
            _ => {
                if !MAC && let Some(selection) = self.session.read(cx).selection_payload() {
                    self.session
                        .update(cx, |session, cx| session.paste(&selection.text, cx));
                }
            }
        }
    }

    fn window_mouse_move(&mut self, event: &MouseMoveEvent, cx: &mut Context<Self>) {
        let layout = self.layout.get();
        match self.gesture.clone() {
            Gesture::None => {
                if layout.bounds.contains(&event.position) {
                    self.update_hover(event.position, cx);
                    if self.mode(cx).contains(TermMode::MOUSE_MOTION) && !event.modifiers.shift {
                        let (cell, _) = self.clamped_cell(event.position);
                        self.report(BUTTON_NONE + MOTION, event.modifiers, cell, true, cx);
                    }
                } else if self.hover_cell.is_some() || self.hovered_link.is_some() {
                    self.clear_hover(cx);
                }
            }
            Gesture::Reporting { button } => {
                if self
                    .mode(cx)
                    .intersects(TermMode::MOUSE_DRAG | TermMode::MOUSE_MOTION)
                {
                    let (cell, _) = self.clamped_cell(event.position);
                    self.report(button + MOTION, event.modifiers, cell, true, cx);
                }
            }
            Gesture::Link {
                origin,
                click_count,
                ..
            } => {
                let dx = f32::from(event.position.x - origin.x);
                let dy = f32::from(event.position.y - origin.y);
                if dx.hypot(dy) <= LINK_DRAG_THRESHOLD {
                    self.update_hover(event.position, cx);
                    return;
                }
                self.clear_hover(cx);
                self.begin_selection(origin, click_count, cx);
                self.pointer = Some(event.position);
                self.extend_selection(event.position, cx);
            }
            Gesture::Selecting { .. } => {
                self.pointer = Some(event.position);
                let top = layout.bounds.origin.y;
                let bottom = top + layout.bounds.size.height;
                let direction = if event.position.y < top {
                    1
                } else if event.position.y > bottom {
                    -1
                } else {
                    0
                };
                self.set_autoscroll(direction, cx);
                self.extend_selection(event.position, cx);
            }
            Gesture::Scrollbar { pointer_offset } => {
                self.scrollbar_to(f32::from(event.position.y), pointer_offset, cx);
            }
        }
    }

    fn window_mouse_up(&mut self, event: &MouseUpEvent, cx: &mut Context<Self>) {
        let gesture = std::mem::replace(&mut self.gesture, Gesture::None);
        self.set_autoscroll(0, cx);
        self.pointer = None;
        match gesture {
            Gesture::None => {}
            Gesture::Reporting { button } => {
                if button_code(event.button) == Some(button) {
                    let (cell, _) = self.clamped_cell(event.position);
                    self.report(button, event.modifiers, cell, false, cx);
                } else {
                    self.gesture = Gesture::Reporting { button };
                }
            }
            Gesture::Link { link, .. } => {
                let still_hovered = self
                    .grid_cell(event.position)
                    .is_some_and(|cell| link.contains(cell))
                    && self.hovered_link.as_ref() == Some(&link);
                if still_hovered {
                    self.act(
                        "terminalLinkActivate",
                        json!({
                            "text": link.text,
                            "metaKey": event.modifiers.platform,
                            "ctrlKey": event.modifiers.control,
                        }),
                        cx,
                    );
                }
            }
            Gesture::Selecting { moved, click_count } => {
                if !moved && click_count <= 1 {
                    self.session.update(cx, |session, cx| {
                        session.term_mut().selection = None;
                        cx.notify();
                    });
                }
                let delay = if click_count >= 2 {
                    MULTI_CLICK_DELAY
                } else {
                    Duration::ZERO
                };
                let pointer = event.position;
                self.selection_action = Some(cx.spawn(async move |this, cx| {
                    if !delay.is_zero() {
                        cx.background_executor().timer(delay).await;
                    }
                    this.update(cx, |viewport, cx| {
                        viewport.send_selection_action(pointer, cx)
                    })
                    .ok();
                }));
            }
            Gesture::Scrollbar { .. } => {}
        }
        cx.notify();
    }

    fn send_selection_action(&mut self, pointer: Point<Pixels>, cx: &mut Context<Self>) {
        self.selection_action = None;
        let Some(selection) = self.session.read(cx).selection_payload() else {
            return;
        };
        let layout = self.layout.get();
        let selection_rect = selection.end_cell.map(|cell| {
            json!({
                "right": f32::from(layout.origin.x) + (cell.col + 1) as f32 * layout.cell_width,
                "bottom": f32::from(layout.origin.y) + (cell.row + 1) as f32 * layout.cell_height,
            })
        });
        self.act(
            "terminalSelectionAction",
            json!({
                "pointer": { "x": f32::from(pointer.x), "y": f32::from(pointer.y) },
                "bounds": {
                    "left": f32::from(layout.bounds.origin.x),
                    "top": f32::from(layout.bounds.origin.y),
                    "width": f32::from(layout.bounds.size.width),
                    "height": f32::from(layout.bounds.size.height),
                },
                "selectionRect": selection_rect,
                "viewport": {
                    "width": f32::from(layout.window_size.width),
                    "height": f32::from(layout.window_size.height),
                },
                "selection": selection,
            }),
            cx,
        );
    }

    fn key_down(&mut self, event: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        self.cancel_selection_action();
        let keystroke = &event.keystroke;
        let m = keystroke.modifiers;
        let mode = self.mode(cx);
        let key = keystroke.key.as_str();
        let copy = if MAC {
            m.platform && !m.control && !m.alt && key == "c"
        } else {
            (m.control && m.shift && key == "c") || (m.control && !m.shift && key == "insert")
        };
        let paste = if MAC {
            m.platform && !m.control && !m.alt && key == "v"
        } else {
            (m.control && m.shift && key == "v") || (m.shift && !m.control && key == "insert")
        };
        if copy && let Some(text) = self.session.read(cx).term().selection_to_string() {
            cx.write_to_clipboard(ClipboardItem::new_string(text));
            cx.stop_propagation();
            return;
        }
        if paste {
            if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
                self.session
                    .update(cx, |session, cx| session.paste(&text, cx));
            }
            cx.stop_propagation();
            return;
        }
        self.blink_on = true;
        self.session
            .update(cx, |session, _| session.scroll_to_bottom());
        let data = keys::encode(keystroke, mode);
        self.act(
            "terminalKey",
            json!({
                "event": {
                    "key": keys::dom_key(keystroke),
                    "metaKey": m.platform,
                    "ctrlKey": m.control,
                    "altKey": m.alt,
                    "shiftKey": m.shift,
                },
                "data": data,
            }),
            cx,
        );
        if !m.platform {
            cx.stop_propagation();
        }
    }

    fn scroll(&mut self, event: &ScrollWheelEvent, _: &mut Window, cx: &mut Context<Self>) {
        self.cancel_selection_action();
        let layout = self.layout.get();
        let cell_height = layout.cell_height.max(1.);
        let delta = event.delta.pixel_delta(px(cell_height));
        let total = self.wheel_remainder + f32::from(delta.y) / cell_height;
        let rows = total.trunc() as i32;
        self.wheel_remainder = total - rows as f32;
        if rows == 0 {
            return;
        }
        let mode = self.mode(cx);
        if self.reports_mouse(event.modifiers.shift, cx) {
            let (cell, _) = self.clamped_cell(event.position);
            let button = if rows > 0 { WHEEL_UP } else { WHEEL_DOWN };
            let data = (0..rows.unsigned_abs())
                .map(|_| {
                    keys::mouse_report(button, event.modifiers, (cell.col, cell.row), true, mode)
                })
                .collect::<String>();
            self.write(data, cx);
        } else if mode.contains(TermMode::ALT_SCREEN) {
            self.write(keys::wheel_arrows(rows, mode), cx);
        } else {
            self.session.update(cx, |session, cx| {
                session.scroll(rows);
                cx.notify();
            });
            self.clear_hover(cx);
        }
        cx.stop_propagation();
    }

    fn geometry(&self, cx: &App) -> Option<ScrollbarGeometry> {
        let state = self.session.read(cx).scroll_state();
        let layout = self.layout.get();
        let track_height = f32::from(layout.bounds.size.height) - SCROLLBAR_INSET_Y * 2.;
        scrollbar_geometry(state.total, state.len, state.offset, track_height)
    }

    fn scrollbar_to(&mut self, pointer_y: f32, pointer_offset: f32, cx: &mut Context<Self>) {
        let Some(geometry) = self.geometry(cx) else {
            return;
        };
        let travel = (geometry.track_height - geometry.thumb_height).max(0.);
        if travel == 0. {
            return;
        }
        let layout = self.layout.get();
        let track_top = f32::from(layout.bounds.origin.y) + SCROLLBAR_INSET_Y;
        let thumb_top = (pointer_y - track_top - pointer_offset).clamp(0., travel);
        let offset = ((thumb_top / travel) * geometry.max_offset as f32).round() as usize;
        self.session.update(cx, |session, cx| {
            session.scroll_to_offset(offset);
            cx.notify();
        });
    }

    fn scrollbar_down(&mut self, event: &MouseDownEvent, on_thumb: bool, cx: &mut Context<Self>) {
        let Some(geometry) = self.geometry(cx) else {
            return;
        };
        let layout = self.layout.get();
        let track_top = f32::from(layout.bounds.origin.y) + SCROLLBAR_INSET_Y;
        let pointer_offset = if on_thumb {
            f32::from(event.position.y) - track_top - geometry.thumb_top
        } else {
            geometry.thumb_height / 2.
        };
        self.cancel_selection_action();
        self.gesture = Gesture::Scrollbar { pointer_offset };
        self.scrollbar_to(f32::from(event.position.y), pointer_offset, cx);
        cx.stop_propagation();
    }
}

impl EntityInputHandler for TerminalViewport {
    fn text_for_range(
        &mut self,
        range: Range<usize>,
        adjusted_range: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        let marked = self.marked.as_ref()?;
        let units: Vec<u16> = marked.encode_utf16().collect();
        let end = range.end.min(units.len());
        let start = range.start.min(end);
        *adjusted_range = Some(start..end);
        Some(String::from_utf16_lossy(&units[start..end]))
    }

    fn selected_text_range(
        &mut self,
        _: bool,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        let length = self
            .marked
            .as_ref()
            .map_or(0, |marked| marked.encode_utf16().count());
        Some(UTF16Selection {
            range: length..length,
            reversed: false,
        })
    }

    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        self.marked
            .as_ref()
            .map(|marked| 0..marked.encode_utf16().count())
    }

    fn unmark_text(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        if self.marked.take().is_some() {
            cx.notify();
        }
    }

    fn replace_text_in_range(
        &mut self,
        _: Option<Range<usize>>,
        text: &str,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.marked = None;
        self.cancel_selection_action();
        self.blink_on = true;
        self.session
            .update(cx, |session, _| session.scroll_to_bottom());
        self.write(text.to_string(), cx);
        cx.notify();
    }

    fn replace_and_mark_text_in_range(
        &mut self,
        _: Option<Range<usize>>,
        new_text: &str,
        _: Option<Range<usize>>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.marked = (!new_text.is_empty()).then(|| new_text.to_string());
        cx.notify();
    }

    fn bounds_for_range(
        &mut self,
        _: Range<usize>,
        _: Bounds<Pixels>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let layout = self.layout.get();
        let term = self.session.read(cx).term();
        let cursor = term.grid().cursor.point;
        let row = cursor.line.0 + term.grid().display_offset() as i32;
        let row = usize::try_from(row)
            .ok()?
            .min(layout.rows.saturating_sub(1));
        Some(grid::cell_rect(&layout, row, cursor.column.0, 1))
    }

    fn character_index_for_point(
        &mut self,
        _: Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        None
    }
}

impl Focusable for TerminalViewport {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for TerminalViewport {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = theme::active(cx);
        if self.pending_focus {
            self.pending_focus = false;
            window.focus(&self.focus, cx);
        }
        let focused = self.focus.is_focused(window);
        if focused != self.focused {
            self.focused = focused;
            self.blink_on = true;
        }
        let input = FrameInput {
            session: self.session.clone(),
            layout: self.layout.clone(),
            family: self.font_family.clone(),
            font_size: self.font_size / crate::platform::appearance::content_zoom(cx),
            focused: self.focused,
            blink_on: self.blink_on,
            hovered_link: self.hovered_link.clone(),
            marked_text: self.marked.clone(),
            tokens: t.clone(),
        };
        let entity = cx.entity().downgrade();
        let input_entity = cx.entity();
        let input_focus = self.focus.clone();
        let geometry = self.geometry(cx);
        let thumb = t.scrollbar_thumb;
        let thumb_hover = t.scrollbar_thumb_hover;
        let dragging_scrollbar = matches!(self.gesture, Gesture::Scrollbar { .. });
        div()
            .id("terminal-viewport")
            .relative()
            .size_full()
            .overflow_hidden()
            .bg(t.terminal_background)
            .key_context("Terminal")
            .track_focus(&self.focus)
            .when(self.hovered_link.is_some(), |this| {
                this.cursor(CursorStyle::PointingHand)
            })
            .on_key_down(cx.listener(Self::key_down))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::mouse_down))
            .on_mouse_down(MouseButton::Right, cx.listener(Self::mouse_down))
            .on_mouse_down(MouseButton::Middle, cx.listener(Self::mouse_down))
            .on_scroll_wheel(cx.listener(Self::scroll))
            .child(
                canvas(
                    move |bounds, window, cx| grid::prepare(bounds, input, window, cx),
                    move |bounds, frame, window, cx| {
                        grid::paint(frame, window, cx);
                        window.handle_input(
                            &input_focus,
                            ElementInputHandler::new(bounds, input_entity),
                            cx,
                        );
                        let moving = entity.clone();
                        window.on_mouse_event(move |event: &MouseMoveEvent, phase, _, cx| {
                            if phase == DispatchPhase::Bubble {
                                moving
                                    .update(cx, |viewport, cx| {
                                        viewport.window_mouse_move(event, cx)
                                    })
                                    .ok();
                            }
                        });
                        let releasing = entity.clone();
                        window.on_mouse_event(move |event: &MouseUpEvent, phase, _, cx| {
                            if phase == DispatchPhase::Bubble {
                                releasing
                                    .update(cx, |viewport, cx| viewport.window_mouse_up(event, cx))
                                    .ok();
                            }
                        });
                        let pressing = entity.clone();
                        window.on_mouse_event(move |_: &MouseDownEvent, phase, _, cx| {
                            if phase == DispatchPhase::Capture {
                                pressing
                                    .update(cx, |viewport, _| viewport.cancel_selection_action())
                                    .ok();
                            }
                        });
                    },
                )
                .size_full(),
            )
            .when_some(geometry, |this, geometry| {
                this.child(
                    div()
                        .id("terminal-scrollbar")
                        .group("terminal-scrollbar")
                        .absolute()
                        .top(px(SCROLLBAR_INSET_Y))
                        .bottom(px(SCROLLBAR_INSET_Y))
                        .right(px(SCROLLBAR_RIGHT))
                        .w(px(SCROLLBAR_WIDTH))
                        .cursor(CursorStyle::Arrow)
                        .on_mouse_down(
                            MouseButton::Left,
                            cx.listener(|viewport, event: &MouseDownEvent, _, cx| {
                                viewport.scrollbar_down(event, false, cx)
                            }),
                        )
                        .child(
                            div()
                                .id("terminal-scrollbar-thumb")
                                .absolute()
                                .left(px(THUMB_INSET_X))
                                .right(px(THUMB_INSET_X))
                                .top(px(geometry.thumb_top))
                                .h(px(geometry.thumb_height))
                                .rounded(px(THUMB_RADIUS))
                                .bg(if dragging_scrollbar {
                                    thumb_hover
                                } else {
                                    thumb
                                })
                                .group_hover("terminal-scrollbar", move |s| s.bg(thumb_hover))
                                .on_mouse_down(
                                    MouseButton::Left,
                                    cx.listener(|viewport, event: &MouseDownEvent, _, cx| {
                                        viewport.scrollbar_down(event, true, cx)
                                    }),
                                ),
                        ),
                )
            })
    }
}
