use std::cell::Cell;
use std::rc::Rc;
use std::sync::Arc;

use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::term::cell::Flags;
use alacritty_terminal::vte::ansi::{CursorShape, NamedColor};
use gpui::{
    App, Bounds, Entity, Font, FontStyle, FontWeight, Pixels, Point, Rgba, ShapedLine,
    SharedString, Size, TextAlign, TextRun, Window, fill, font, point, px, size,
};

use super::palette;
use super::session::TerminalSession;
use crate::ui::theme::tokens::Tokens;

pub const PADDING: f32 = 4.;
const LINE_HEIGHT_RATIO: f32 = 1.35;
const UNDERLINE_INSET: f32 = 2.;
const STRIKE_RATIO: f32 = 0.55;
const BEAM_WIDTH: f32 = 2.;

#[derive(Clone, Copy, Default)]
pub struct GridLayout {
    pub bounds: Bounds<Pixels>,
    pub window_size: Size<Pixels>,
    pub origin: Point<Pixels>,
    pub cell_width: f32,
    pub cell_height: f32,
    pub cols: usize,
    pub rows: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CellPoint {
    pub col: usize,
    pub row: usize,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LinkRange {
    pub text: String,
    pub start: CellPoint,
    pub end: CellPoint,
}

impl LinkRange {
    pub fn contains(&self, cell: CellPoint) -> bool {
        let after_start =
            cell.row > self.start.row || (cell.row == self.start.row && cell.col >= self.start.col);
        let before_end =
            cell.row < self.end.row || (cell.row == self.end.row && cell.col <= self.end.col);
        after_start && before_end
    }
}

pub struct Frame {
    quads: Vec<(Bounds<Pixels>, Rgba)>,
    lines: Vec<(Point<Pixels>, ShapedLine)>,
    overlays: Vec<(Bounds<Pixels>, Rgba)>,
    cursor_text: Option<(Point<Pixels>, ShapedLine)>,
    line_height: Pixels,
}

#[derive(Clone, PartialEq)]
struct TextStyle {
    color: Rgba,
    bold: bool,
    italic: bool,
}

struct Batch {
    row: usize,
    col: usize,
    cells: usize,
    text: String,
    style: TextStyle,
    wide: bool,
}

pub struct FrameInput {
    pub session: Entity<TerminalSession>,
    pub layout: Rc<Cell<GridLayout>>,
    pub family: SharedString,
    pub font_size: f32,
    pub focused: bool,
    pub blink_on: bool,
    pub hovered_link: Option<LinkRange>,
    pub marked_text: Option<String>,
    pub tokens: Arc<Tokens>,
}

fn styled_font(family: &SharedString, style: &TextStyle) -> Font {
    let mut result = font(family.clone());
    if style.bold {
        result.weight = FontWeight::BOLD;
    }
    if style.italic {
        result.style = FontStyle::Italic;
    }
    result
}

pub fn cell_rect(layout: &GridLayout, row: usize, col: usize, cells: usize) -> Bounds<Pixels> {
    Bounds {
        origin: point(
            layout.origin.x + px(col as f32 * layout.cell_width),
            layout.origin.y + px(row as f32 * layout.cell_height),
        ),
        size: size(px(cells as f32 * layout.cell_width), px(layout.cell_height)),
    }
}

fn push_merged(quads: &mut Vec<(Bounds<Pixels>, Rgba)>, bounds: Bounds<Pixels>, color: Rgba) {
    if let Some((last, last_color)) = quads.last_mut()
        && *last_color == color
        && last.origin.y == bounds.origin.y
        && last.origin.x + last.size.width == bounds.origin.x
    {
        last.size.width += bounds.size.width;
        return;
    }
    quads.push((bounds, color));
}

fn line_quad(rect: Bounds<Pixels>, top: f32, color: Rgba) -> (Bounds<Pixels>, Rgba) {
    (
        Bounds {
            origin: point(rect.origin.x, rect.origin.y + px(top)),
            size: size(rect.size.width, px(1.)),
        },
        color,
    )
}

fn outline(rect: Bounds<Pixels>, color: Rgba, overlays: &mut Vec<(Bounds<Pixels>, Rgba)>) {
    let one = px(1.);
    let Bounds { origin, size: s } = rect;
    overlays.push((
        Bounds {
            origin,
            size: size(s.width, one),
        },
        color,
    ));
    overlays.push((
        Bounds {
            origin: point(origin.x, origin.y + s.height - one),
            size: size(s.width, one),
        },
        color,
    ));
    overlays.push((
        Bounds {
            origin,
            size: size(one, s.height),
        },
        color,
    ));
    overlays.push((
        Bounds {
            origin: point(origin.x + s.width - one, origin.y),
            size: size(one, s.height),
        },
        color,
    ));
}

pub fn prepare(
    bounds: Bounds<Pixels>,
    input: FrameInput,
    window: &mut Window,
    cx: &mut App,
) -> Frame {
    let FrameInput {
        session,
        layout: layout_cell,
        family,
        font_size,
        focused,
        blink_on,
        hovered_link,
        marked_text,
        tokens: t,
    } = input;
    let text_system = window.text_system().clone();
    let font_px = px(font_size);
    let font_id = text_system.resolve_font(&font(family.clone()));
    let cell_width = text_system
        .advance(font_id, font_px, 'M')
        .map(|advance| f32::from(advance.width))
        .unwrap_or(font_size * 0.6)
        .max(1.);
    let glyph = f32::from(text_system.ascent(font_id, font_px))
        + f32::from(text_system.descent(font_id, font_px)).abs();
    let cell_height = (font_size * LINE_HEIGHT_RATIO)
        .round()
        .max(glyph.ceil())
        .max(1.);
    let width = f32::from(bounds.size.width) - PADDING * 2.;
    let height = f32::from(bounds.size.height) - PADDING * 2.;
    let cols = ((width / cell_width).floor() as usize).max(1);
    let rows = ((height / cell_height).floor() as usize).max(1);
    session.update(cx, |session, cx| {
        session.resize(cols, rows, cx);
    });

    let session = session.read(cx);
    let term = session.term();
    let slack = if term.grid().history_size() > 0 {
        (height - rows as f32 * cell_height).max(0.)
    } else {
        0.
    };
    let layout = GridLayout {
        bounds,
        window_size: window.viewport_size(),
        origin: point(
            bounds.origin.x + px(PADDING),
            bounds.origin.y + px(PADDING + slack),
        ),
        cell_width,
        cell_height,
        cols,
        rows,
    };
    layout_cell.set(layout);

    let content = term.renderable_content();
    let colors = content.colors;
    let default_bg = palette::indexed(colors, NamedColor::Background as usize, &t);
    let selection_bg = t.terminal_selection_background;
    let offset = content.display_offset as i32;
    let mut quads = Vec::new();
    let mut selection_quads = Vec::new();
    let mut decorations = Vec::new();
    let mut batches: Vec<Batch> = Vec::new();
    let cursor_point = content.cursor.point;
    let mut cursor_cell: Option<(char, TextStyle, bool)> = None;

    for indexed in content.display_iter {
        let row = indexed.point.line.0 + offset;
        if row < 0 || row as usize >= rows {
            continue;
        }
        let row = row as usize;
        let col = indexed.point.column.0;
        let cell = indexed.cell;
        if cell.flags.contains(Flags::WIDE_CHAR_SPACER) {
            continue;
        }
        let cells = if cell.flags.contains(Flags::WIDE_CHAR) {
            2
        } else {
            1
        };
        let mut fg = palette::resolve(cell.fg, colors, &t);
        let mut bg = palette::resolve(cell.bg, colors, &t);
        if cell.flags.contains(Flags::INVERSE) {
            std::mem::swap(&mut fg, &mut bg);
        }
        if cell.flags.contains(Flags::DIM) {
            fg = palette::dim(fg, default_bg);
        }
        let rect = cell_rect(&layout, row, col, cells);
        if bg != default_bg {
            push_merged(&mut quads, rect, bg);
        }
        if content
            .selection
            .is_some_and(|range| range.contains(indexed.point))
        {
            push_merged(&mut selection_quads, rect, selection_bg);
        }
        let style = TextStyle {
            color: fg,
            bold: cell.flags.contains(Flags::BOLD),
            italic: cell.flags.contains(Flags::ITALIC),
        };
        if indexed.point == cursor_point {
            cursor_cell = Some((cell.c, style.clone(), cells == 2));
        }
        let hovered = hovered_link
            .as_ref()
            .is_some_and(|link| link.contains(CellPoint { col, row }));
        if cell.flags.intersects(Flags::ALL_UNDERLINES) || hovered {
            decorations.push(line_quad(rect, cell_height - UNDERLINE_INSET, fg));
        }
        if cell.flags.contains(Flags::STRIKEOUT) {
            decorations.push(line_quad(rect, (cell_height * STRIKE_RATIO).floor(), fg));
        }
        if cell.flags.contains(Flags::HIDDEN) || cell.c == ' ' || cell.c == '\t' {
            continue;
        }
        let wide = cells == 2;
        if let Some(batch) = batches.last_mut()
            && !wide
            && !batch.wide
            && batch.row == row
            && batch.col + batch.cells == col
            && batch.style == style
        {
            batch.text.push(cell.c);
            batch.cells += 1;
            if let Some(extra) = cell.zerowidth() {
                batch.text.extend(extra.iter());
            }
            continue;
        }
        let mut text = String::from(cell.c);
        if let Some(extra) = cell.zerowidth() {
            text.extend(extra.iter());
        }
        batches.push(Batch {
            row,
            col,
            cells,
            text,
            style,
            wide,
        });
    }

    let line_height = px(cell_height);
    let shape = |text: String, style: &TextStyle, force: Option<Pixels>| {
        let run = TextRun {
            len: text.len(),
            font: styled_font(&family, style),
            color: style.color.into(),
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        text_system.shape_line(text.into(), font_px, &[run], force)
    };
    let lines = batches
        .into_iter()
        .map(|batch| {
            let origin = cell_rect(&layout, batch.row, batch.col, 1).origin;
            let force = (!batch.wide).then_some(px(cell_width));
            (origin, shape(batch.text, &batch.style, force))
        })
        .collect();

    let mut overlays = decorations;
    let mut cursor_text = None;
    let blinking = term.cursor_style().blinking;
    let cursor_row = cursor_point.line.0 + offset;
    let show_cursor = content.cursor.shape != CursorShape::Hidden
        && cursor_row >= 0
        && (cursor_row as usize) < rows
        && (!focused || !blinking || blink_on);
    let cursor_visible_row = cursor_row >= 0 && (cursor_row as usize) < rows;
    if let Some(marked) = marked_text.filter(|_| cursor_visible_row) {
        let cells = marked.chars().count().max(1);
        let rect = cell_rect(&layout, cursor_row as usize, cursor_point.column.0, cells);
        let foreground = palette::indexed(colors, NamedColor::Foreground as usize, &t);
        overlays.push((rect, default_bg));
        overlays.push(line_quad(rect, cell_height - UNDERLINE_INSET, foreground));
        let style = TextStyle {
            color: foreground,
            bold: false,
            italic: false,
        };
        cursor_text = Some((rect.origin, shape(marked, &style, None)));
    } else if show_cursor {
        let wide = cursor_cell.as_ref().is_some_and(|(_, _, wide)| *wide);
        let rect = cell_rect(
            &layout,
            cursor_row as usize,
            cursor_point.column.0,
            if wide { 2 } else { 1 },
        );
        let cursor = palette::indexed(colors, NamedColor::Cursor as usize, &t);
        match content.cursor.shape {
            _ if !focused => outline(rect, cursor, &mut overlays),
            CursorShape::Beam => overlays.push((
                Bounds {
                    origin: rect.origin,
                    size: size(px(BEAM_WIDTH), rect.size.height),
                },
                cursor,
            )),
            CursorShape::Underline => overlays.push((
                Bounds {
                    origin: point(
                        rect.origin.x,
                        rect.origin.y + rect.size.height - px(BEAM_WIDTH),
                    ),
                    size: size(rect.size.width, px(BEAM_WIDTH)),
                },
                cursor,
            )),
            CursorShape::HollowBlock => outline(rect, cursor, &mut overlays),
            _ => {
                overlays.push((rect, cursor));
                if let Some((c, style, _)) = cursor_cell
                    && c != ' '
                {
                    let style = TextStyle {
                        color: default_bg,
                        ..style
                    };
                    cursor_text = Some((rect.origin, shape(String::from(c), &style, None)));
                }
            }
        }
    }

    quads.extend(selection_quads);
    Frame {
        quads,
        lines,
        overlays,
        cursor_text,
        line_height,
    }
}

pub fn paint(frame: Frame, window: &mut Window, cx: &mut App) {
    for (bounds, color) in frame.quads {
        window.paint_quad(fill(bounds, color));
    }
    for (origin, line) in frame.lines {
        line.paint(origin, frame.line_height, TextAlign::Left, None, window, cx)
            .ok();
    }
    for (bounds, color) in frame.overlays {
        window.paint_quad(fill(bounds, color));
    }
    if let Some((origin, line)) = frame.cursor_text {
        line.paint(origin, frame.line_height, TextAlign::Left, None, window, cx)
            .ok();
    }
}
