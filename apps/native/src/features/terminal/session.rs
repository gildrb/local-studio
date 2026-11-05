use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use alacritty_terminal::Term;
use alacritty_terminal::event::{Event, EventListener};
use alacritty_terminal::grid::{Dimensions, Scroll};
use alacritty_terminal::index::{Column, Line, Point as GridPoint};
use alacritty_terminal::term::Config;
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::term::test::TermSize;
use alacritty_terminal::vte::ansi::{CursorShape, CursorStyle, Processor, Rgb};
use gpui::{App, AppContext, Context, Entity, EventEmitter, Global};
use serde::Serialize;
use serde_json::json;

use super::grid::{CellPoint, LinkRange};
use super::keys;
use super::palette;
use crate::app_core::client::{CoreClient, TerminalStreamOp};

const DEFAULT_COLS: usize = 80;
const DEFAULT_ROWS: usize = 24;
const SCROLLBACK_ROWS: usize = 10_000;

#[derive(Clone, Default)]
pub struct Listener(Rc<RefCell<Vec<Event>>>);

impl EventListener for Listener {
    fn send_event(&self, event: Event) {
        self.0.borrow_mut().push(event);
    }
}

pub enum SessionEvent {
    Focus,
}

pub struct TerminalSession {
    key: String,
    client: Entity<CoreClient>,
    term: Term<Listener>,
    parser: Processor,
    events: Listener,
}

impl EventEmitter<SessionEvent> for TerminalSession {}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionPayload {
    pub text: String,
    pub start_row: i32,
    pub end_row: i32,
    #[serde(skip)]
    pub end_cell: Option<CellPoint>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRow {
    pub cells: Vec<String>,
    pub is_wrap_continuation: bool,
    pub wraps_to_next: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ScrollState {
    pub total: usize,
    pub len: usize,
    pub offset: usize,
}

fn config() -> Config {
    Config {
        scrolling_history: SCROLLBACK_ROWS,
        default_cursor_style: CursorStyle {
            shape: CursorShape::Block,
            blinking: true,
        },
        ..Config::default()
    }
}

impl TerminalSession {
    fn new(key: String, client: Entity<CoreClient>) -> Self {
        let events = Listener::default();
        Self {
            key,
            client,
            term: Term::new(
                config(),
                &TermSize::new(DEFAULT_COLS, DEFAULT_ROWS),
                events.clone(),
            ),
            parser: Processor::new(),
            events,
        }
    }

    pub fn term(&self) -> &Term<Listener> {
        &self.term
    }

    pub fn term_mut(&mut self) -> &mut Term<Listener> {
        &mut self.term
    }

    pub fn size(&self) -> (usize, usize) {
        (self.term.columns(), self.term.screen_lines())
    }

    pub fn act(&self, action: &'static str, mut params: serde_json::Value, cx: &mut App) {
        if let serde_json::Value::Object(map) = &mut params {
            map.insert("key".into(), self.key.clone().into());
        }
        self.client
            .update(cx, |client, _| client.act(action, params));
    }

    pub fn write(&self, data: String, cx: &mut App) {
        if data.is_empty() {
            return;
        }
        self.act("terminalInput", json!({ "data": data }), cx);
    }

    pub fn paste(&self, text: &str, cx: &mut App) {
        self.write(keys::paste(text, *self.term.mode()), cx);
    }

    fn feed(&mut self, op: TerminalStreamOp, data: &str, cx: &mut Context<Self>) {
        match op {
            TerminalStreamOp::Reset | TerminalStreamOp::Append => {
                if op == TerminalStreamOp::Reset {
                    let size = TermSize::new(self.term.columns(), self.term.screen_lines());
                    self.term = Term::new(config(), &size, self.events.clone());
                    self.parser = Processor::new();
                }
                self.parser.advance(&mut self.term, data.as_bytes());
                self.term.selection = None;
                let events = std::mem::take(&mut *self.events.0.borrow_mut());
                if op == TerminalStreamOp::Append {
                    for event in events {
                        self.handle_event(event, cx);
                    }
                }
                cx.notify();
            }
            TerminalStreamOp::Paste => {
                if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
                    self.paste(&text, cx);
                }
                cx.emit(SessionEvent::Focus);
            }
            TerminalStreamOp::ClearSelection => {
                self.term.selection = None;
                cx.notify();
            }
            TerminalStreamOp::Focus => cx.emit(SessionEvent::Focus),
        }
    }

    fn handle_event(&mut self, event: Event, cx: &mut Context<Self>) {
        match event {
            Event::PtyWrite(text) => self.write(text, cx),
            Event::ColorRequest(index, format) => {
                let color = self.term.colors()[index].unwrap_or_else(|| {
                    let rgba = palette::default_rgb(index, &crate::ui::theme::active(cx));
                    Rgb {
                        r: (rgba.r * 255.).round() as u8,
                        g: (rgba.g * 255.).round() as u8,
                        b: (rgba.b * 255.).round() as u8,
                    }
                });
                self.write(format(color), cx);
            }
            Event::ClipboardStore(_, text) => {
                cx.write_to_clipboard(gpui::ClipboardItem::new_string(text))
            }
            _ => {}
        }
    }

    pub fn resize(&mut self, cols: usize, rows: usize, cx: &mut App) {
        if (cols, rows) == self.size() {
            return;
        }
        self.term.resize(TermSize::new(cols, rows));
        self.act("terminalResize", json!({ "cols": cols, "rows": rows }), cx);
    }

    pub fn scroll(&mut self, rows: i32) {
        if rows != 0 {
            self.term.scroll_display(Scroll::Delta(rows));
        }
    }

    pub fn scroll_to_bottom(&mut self) {
        if self.term.grid().display_offset() != 0 {
            self.term.scroll_display(Scroll::Bottom);
        }
    }

    pub fn scroll_state(&self) -> ScrollState {
        let grid = self.term.grid();
        let history = grid.history_size();
        ScrollState {
            total: history + grid.screen_lines(),
            len: grid.screen_lines(),
            offset: history - grid.display_offset(),
        }
    }

    pub fn scroll_to_offset(&mut self, offset: usize) {
        let state = self.scroll_state();
        let target = offset.min(state.total - state.len) as i32;
        self.scroll(state.offset as i32 - target);
    }

    fn viewport_line(&self, row: usize) -> Line {
        Line(row as i32 - self.term.grid().display_offset() as i32)
    }

    fn line_wraps(&self, line: Line) -> bool {
        let grid = self.term.grid();
        if line < grid.topmost_line() || line > grid.bottommost_line() {
            return false;
        }
        let last = Column(grid.columns().saturating_sub(1));
        grid[GridPoint::new(line, last)]
            .flags
            .contains(Flags::WRAPLINE)
    }

    fn row_cells(&self, line: Line) -> Vec<String> {
        let grid = self.term.grid();
        (0..grid.columns())
            .map(|column| {
                let cell = &grid[GridPoint::new(line, Column(column))];
                if cell.flags.contains(Flags::WIDE_CHAR_SPACER) {
                    return String::new();
                }
                let mut text = String::from(cell.c);
                if let Some(extra) = cell.zerowidth() {
                    text.extend(extra.iter());
                }
                text
            })
            .collect()
    }

    pub fn wrapped_rows(&self, row: usize) -> (usize, Vec<LinkRow>) {
        let rows = self.term.screen_lines();
        let mut first = row;
        while first > 0 && self.line_wraps(self.viewport_line(first - 1)) {
            first -= 1;
        }
        let mut last = row;
        while last + 1 < rows && self.line_wraps(self.viewport_line(last)) {
            last += 1;
        }
        let payload = (first..=last)
            .map(|index| {
                let line = self.viewport_line(index);
                LinkRow {
                    cells: self.row_cells(line),
                    is_wrap_continuation: self.line_wraps(Line(line.0 - 1)),
                    wraps_to_next: self.line_wraps(line),
                }
            })
            .collect();
        (first, payload)
    }

    pub fn hyperlink_at(&self, cell: CellPoint) -> Option<LinkRange> {
        let grid = self.term.grid();
        let cols = grid.columns();
        let rows = grid.screen_lines();
        let link_at = |point: CellPoint| {
            grid[GridPoint::new(self.viewport_line(point.row), Column(point.col))].hyperlink()
        };
        let link = link_at(cell)?;
        let same = |point: CellPoint| {
            link_at(point).is_some_and(|other| other.id() == link.id() && other.uri() == link.uri())
        };
        let mut start = cell;
        loop {
            let previous = if start.col > 0 {
                Some(CellPoint {
                    col: start.col - 1,
                    row: start.row,
                })
            } else if start.row > 0 && self.line_wraps(self.viewport_line(start.row - 1)) {
                Some(CellPoint {
                    col: cols - 1,
                    row: start.row - 1,
                })
            } else {
                None
            };
            match previous {
                Some(point) if same(point) => start = point,
                _ => break,
            }
        }
        let mut end = cell;
        loop {
            let next = if end.col + 1 < cols {
                Some(CellPoint {
                    col: end.col + 1,
                    row: end.row,
                })
            } else if end.row + 1 < rows && self.line_wraps(self.viewport_line(end.row)) {
                Some(CellPoint {
                    col: 0,
                    row: end.row + 1,
                })
            } else {
                None
            };
            match next {
                Some(point) if same(point) => end = point,
                _ => break,
            }
        }
        Some(LinkRange {
            text: link.uri().to_string(),
            start,
            end,
        })
    }

    pub fn selection_payload(&self) -> Option<SelectionPayload> {
        let selection = self.term.selection.as_ref()?;
        let range = selection.to_range(&self.term)?;
        let text = self.term.selection_to_string()?;
        if text.is_empty() {
            return None;
        }
        let grid = self.term.grid();
        let history = grid.history_size() as i32;
        let end_row = range.end.line.0 + grid.display_offset() as i32;
        Some(SelectionPayload {
            text,
            start_row: range.start.line.0 + history,
            end_row: range.end.line.0 + history,
            end_cell: (end_row >= 0 && (end_row as usize) < grid.screen_lines()).then_some(
                CellPoint {
                    col: range.end.column.0,
                    row: end_row as usize,
                },
            ),
        })
    }
}

#[derive(Default)]
struct TerminalSessions(HashMap<String, Entity<TerminalSession>>);

impl Global for TerminalSessions {}

pub fn session(client: &Entity<CoreClient>, key: &str, cx: &mut App) -> Entity<TerminalSession> {
    if let Some(existing) = cx.default_global::<TerminalSessions>().0.get(key) {
        return existing.clone();
    }
    let created = cx.new(|_| TerminalSession::new(key.to_string(), client.clone()));
    cx.default_global::<TerminalSessions>()
        .0
        .insert(key.to_string(), created.clone());
    created
}

pub fn receive_output(
    client: &Entity<CoreClient>,
    key: String,
    op: TerminalStreamOp,
    data: String,
    cx: &mut App,
) {
    let session = session(client, &key, cx);
    session.update(cx, |session, cx| session.feed(op, &data, cx));
}
