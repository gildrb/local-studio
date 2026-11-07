use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::{Duration, Instant};

use libghostty_vt::fmt::Format;
use libghostty_vt::focus;
use libghostty_vt::key::{self, Key, Mods};
use libghostty_vt::mouse;
use libghostty_vt::paste;
use libghostty_vt::render::{CellIterator, CursorVisualStyle, Dirty, RowIteration, RowIterator, Snapshot};
use libghostty_vt::screen::{CellContentTag, CellWide, Screen};
use libghostty_vt::selection::gesture::{DragEvent, Geometry, Gesture, PressEvent, ReleaseEvent};
use libghostty_vt::selection::{FormatOptions, SelectLineOptions, SelectWordOptions, Selection};
use libghostty_vt::style::{PaletteIndex, RgbColor, Style, StyleColor, Underline};
use libghostty_vt::terminal::{
    ConformanceLevel, DeviceAttributeFeature, DeviceAttributes, DeviceType, Mode, Point, PointCoordinate,
    PrimaryDeviceAttributes, ScrollViewport, SecondaryDeviceAttributes, SizeReportSize, TertiaryDeviceAttributes,
};
use libghostty_vt::{Error, RenderState, Terminal, TerminalOptions};

use super::keys;
use crate::workspace::model::{
    TerminalColor, TerminalCursor, TerminalCursorShape, TerminalFrame, TerminalKey, TerminalKeyAction, TerminalMods,
    TerminalMouse, TerminalMouseAction, TerminalMouseButton, TerminalPoint, TerminalRow, TerminalRun, TerminalScroll,
    TerminalSelect, TerminalSize, TerminalSpan, TerminalStyle, TerminalUnderline,
};

const REPEAT_INTERVAL: Duration = Duration::from_millis(500);
const MAX_WHEEL_LINES: u32 = 64;

const ATTRIBUTES: DeviceAttributes = DeviceAttributes {
    primary: PrimaryDeviceAttributes::new(ConformanceLevel::VT220, &[DeviceAttributeFeature::ANSI_COLOR]),
    secondary: SecondaryDeviceAttributes { device_type: DeviceType::VT220, firmware_version: 1, rom_cartridge: 0 },
    tertiary: TertiaryDeviceAttributes { unit_id: 0 },
};

const PLAIN: TerminalStyle = TerminalStyle {
    foreground: TerminalColor::Default,
    background: TerminalColor::Default,
    underline_color: TerminalColor::Default,
    underline: TerminalUnderline::None,
    bold: false,
    italic: false,
    faint: false,
    blink: false,
    inverse: false,
    invisible: false,
    strikethrough: false,
    overline: false,
};

#[derive(Default)]
struct Effects {
    bell: Cell<bool>,
    title: Cell<bool>,
    cell: Cell<(u32, u32)>,
    replies: RefCell<Vec<u8>>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct Sent {
    cols: u16,
    rows: u16,
    cursor: TerminalCursor,
    total: u64,
    offset: u64,
    has_selection: bool,
    mouse_tracking: bool,
}

#[derive(Clone, Copy, Default)]
struct Buttons {
    left: bool,
    right: bool,
    middle: bool,
}

impl Buttons {
    fn set(&mut self, button: TerminalMouseButton, down: bool) {
        match button {
            TerminalMouseButton::Left => self.left = down,
            TerminalMouseButton::Right => self.right = down,
            TerminalMouseButton::Middle => self.middle = down,
        }
    }

    fn any(self) -> bool {
        self.left || self.right || self.middle
    }
}

pub(super) struct Emulator {
    vt: Terminal<'static, 'static>,
    render: RenderState<'static>,
    row_cursor: RowIterator<'static>,
    cell_cursor: CellIterator<'static>,
    key_encoder: key::Encoder<'static>,
    key_event: key::Event<'static>,
    mouse_encoder: mouse::Encoder<'static>,
    mouse_event: mouse::Event<'static>,
    gesture: Gesture<'static>,
    press: PressEvent<'static>,
    drag: DragEvent<'static>,
    release: ReleaseEvent<'static>,
    effects: Rc<Effects>,
    clock: Instant,
    size: TerminalSize,
    buttons: Buttons,
    selecting: bool,
    has_selection: bool,
    full: bool,
    sent: Option<Sent>,
    graphemes: Vec<char>,
}

impl Emulator {
    pub(super) fn new(size: TerminalSize, scrollback: usize) -> Result<Self, Error> {
        let size = clamp(size);
        let effects = Rc::new(Effects::default());
        effects.cell.set((size.cell_width, size.cell_height));
        let mut vt: Terminal<'static, 'static> =
            Terminal::new(TerminalOptions { cols: size.cols, rows: size.rows, max_scrollback: scrollback })?;
        let replies = Rc::clone(&effects);
        let bell = Rc::clone(&effects);
        let title = Rc::clone(&effects);
        let cell = Rc::clone(&effects);
        vt.set_default_cursor_blink(Some(true))?
            .on_pty_write(move |_, data| replies.replies.borrow_mut().extend_from_slice(data))?
            .on_bell(move |_| bell.bell.set(true))?
            .on_title_changed(move |_| title.title.set(true))?
            .on_xtversion(|_| Some("LocalStudio"))?
            .on_device_attributes(|_| Some(ATTRIBUTES))?
            .on_size(move |term| {
                let (cell_width, cell_height) = cell.cell.get();
                Some(SizeReportSize { rows: term.rows().ok()?, columns: term.cols().ok()?, cell_width, cell_height })
            })?;
        let mut press = PressEvent::new()?;
        press.set_repeat_interval(REPEAT_INTERVAL)?;
        Ok(Self {
            vt,
            render: RenderState::new()?,
            row_cursor: RowIterator::new()?,
            cell_cursor: CellIterator::new()?,
            key_encoder: key::Encoder::new()?,
            key_event: key::Event::new()?,
            mouse_encoder: mouse::Encoder::new()?,
            mouse_event: mouse::Event::new()?,
            gesture: Gesture::new()?,
            press,
            drag: DragEvent::new()?,
            release: ReleaseEvent::new()?,
            effects,
            clock: Instant::now(),
            size,
            buttons: Buttons::default(),
            selecting: false,
            has_selection: false,
            full: true,
            sent: None,
            graphemes: Vec::new(),
        })
    }

    pub(super) fn feed(&mut self, data: &[u8]) {
        self.vt.vt_write(data);
    }

    pub(super) fn replies(&self) -> Vec<u8> {
        std::mem::take(&mut *self.effects.replies.borrow_mut())
    }

    pub(super) fn size(&self) -> TerminalSize {
        self.size
    }

    pub(super) fn resize(&mut self, size: TerminalSize) -> Result<(), Error> {
        let size = clamp(size);
        self.vt.resize(size.cols, size.rows, size.cell_width, size.cell_height)?;
        self.effects.cell.set((size.cell_width, size.cell_height));
        self.size = size;
        self.full = true;
        Ok(())
    }

    pub(super) fn frame(&mut self, force: bool) -> Result<Option<TerminalFrame>, Error> {
        let mut full = std::mem::take(&mut self.full) || force;
        let scrollbar = self.vt.scrollbar()?;
        let mouse_tracking = self.vt.is_mouse_tracking()?;
        let title = if self.effects.title.take() { Some(self.vt.title()?.to_owned()) } else { None };
        let bell = self.effects.bell.take();
        let snapshot = self.render.update(&self.vt)?;
        let dirty_state = snapshot.dirty()?;
        full = full || dirty_state == Dirty::Full;
        let cols = snapshot.cols()?;
        let rows = snapshot.rows()?;
        let cursor = cursor(&snapshot)?;
        let mut dirty = Vec::new();
        if full || dirty_state != Dirty::Clean {
            let mut iteration = self.row_cursor.update(&snapshot)?;
            let mut index: u16 = 0;
            while let Some(row) = iteration.next() {
                if full || row.dirty()? {
                    dirty.push(row_record(&mut self.cell_cursor, row, index, &mut self.graphemes)?);
                    row.set_dirty(false)?;
                }
                index = index.saturating_add(1);
            }
        }
        snapshot.set_dirty(Dirty::Clean)?;
        let sent = Sent {
            cols,
            rows,
            cursor,
            total: scrollbar.total,
            offset: scrollbar.offset,
            has_selection: self.has_selection,
            mouse_tracking,
        };
        if !full && dirty.is_empty() && title.is_none() && !bell && self.sent == Some(sent) {
            return Ok(None);
        }
        self.sent = Some(sent);
        Ok(Some(TerminalFrame {
            cols,
            rows,
            full,
            dirty,
            cursor,
            scrollback_len: scrollbar.total.saturating_sub(scrollbar.len),
            viewport_offset: scrollbar.offset,
            title,
            bell,
            has_selection: self.has_selection,
            mouse_tracking,
        }))
    }

    pub(super) fn key(&mut self, input: &TerminalKey) -> Result<Vec<u8>, Error> {
        let action = match input.action {
            TerminalKeyAction::Press => key::Action::Press,
            TerminalKeyAction::Release => key::Action::Release,
            TerminalKeyAction::Repeat => key::Action::Repeat,
        };
        let mods = mods(input.mods);
        let text = input.text.as_deref().filter(|text| !text.is_empty() && text.chars().all(printable));
        let consumed = if text.is_some() && mods.contains(Mods::SHIFT) { Mods::SHIFT } else { Mods::empty() };
        let key = keys::key(input.code);
        self.key_event
            .set_action(action)
            .set_key(key)
            .set_mods(mods)
            .set_consumed_mods(consumed)
            .set_composing(input.composing)
            .set_unshifted_codepoint(char::from_u32(input.unshifted).unwrap_or('\0'))
            .set_utf8(text.map(str::to_owned));
        self.key_encoder.set_options_from_terminal(&self.vt);
        if cfg!(target_os = "macos") {
            self.key_encoder.set_macos_option_as_alt(key::OptionAsAlt::True);
        }
        let mut out = Vec::with_capacity(64);
        self.key_encoder.encode_to_vec(&self.key_event, &mut out)?;
        if out.is_empty() && key == Key::Unidentified && !input.composing && action != key::Action::Release {
            if let Some(text) = text {
                out.extend_from_slice(text.as_bytes());
            }
        }
        if !out.is_empty() {
            self.typed()?;
        }
        Ok(out)
    }

    pub(super) fn paste(&mut self, text: &str) -> Result<Vec<u8>, Error> {
        let bracketed = self.vt.mode(Mode::BRACKETED_PASTE)?;
        let mut data = text.as_bytes().to_vec();
        let mut out = vec![0; data.len() + 16];
        let written = paste::encode(&mut data, bracketed, &mut out)?;
        out.truncate(written);
        self.typed()?;
        Ok(out)
    }

    pub(super) fn focus(&mut self, focused: bool) -> Result<Vec<u8>, Error> {
        if !self.vt.mode(Mode::FOCUS_EVENT)? {
            return Ok(Vec::new());
        }
        let mut out = [0u8; 8];
        let event = if focused { focus::Event::Gained } else { focus::Event::Lost };
        let written = event.encode(&mut out)?;
        Ok(out[..written].to_vec())
    }

    pub(super) fn mouse(&mut self, input: &TerminalMouse) -> Result<Vec<u8>, Error> {
        let mods = mods(input.mods);
        if let Some(button) = input.button {
            match input.action {
                TerminalMouseAction::Press => self.buttons.set(button, true),
                TerminalMouseAction::Release => self.buttons.set(button, false),
                TerminalMouseAction::Motion => {}
            }
        }
        if self.vt.is_mouse_tracking()? && !mods.contains(Mods::SHIFT) {
            let action = match input.action {
                TerminalMouseAction::Press => mouse::Action::Press,
                TerminalMouseAction::Release => mouse::Action::Release,
                TerminalMouseAction::Motion => mouse::Action::Motion,
            };
            return self.report(action, input.button.map(button), input.x, input.y, mods, true);
        }
        match (input.action, input.button) {
            (TerminalMouseAction::Press, Some(TerminalMouseButton::Left)) => self.press_at(input.x, input.y)?,
            (TerminalMouseAction::Motion, _) if self.buttons.left && self.selecting => {
                self.drag_to(input.x, input.y, mods)?;
            }
            (TerminalMouseAction::Release, Some(TerminalMouseButton::Left)) => self.release_at(input.x, input.y)?,
            _ => {}
        }
        Ok(Vec::new())
    }

    pub(super) fn scroll(&mut self, input: &TerminalScroll) -> Result<Vec<u8>, Error> {
        if input.lines == 0 {
            return Ok(Vec::new());
        }
        let mods = mods(input.mods);
        let count = input.lines.unsigned_abs().min(MAX_WHEEL_LINES);
        let up = input.lines < 0;
        let mut out = Vec::new();
        if self.vt.is_mouse_tracking()? && !mods.contains(Mods::SHIFT) {
            let button = if up { mouse::Button::Four } else { mouse::Button::Five };
            for _ in 0..count {
                out.extend(self.report(mouse::Action::Press, Some(button), input.x, input.y, mods, false)?);
            }
            return Ok(out);
        }
        if self.vt.active_screen()? == Screen::Alternate && self.vt.mode(Mode::ALT_SCROLL)? {
            let key = if up { Key::ArrowUp } else { Key::ArrowDown };
            self.key_event
                .set_action(key::Action::Press)
                .set_key(key)
                .set_mods(Mods::empty())
                .set_consumed_mods(Mods::empty())
                .set_composing(false)
                .set_unshifted_codepoint('\0')
                .set_utf8(None::<String>);
            self.key_encoder.set_options_from_terminal(&self.vt);
            for _ in 0..count {
                self.key_encoder.encode_to_vec(&self.key_event, &mut out)?;
            }
            return Ok(out);
        }
        self.vt.scroll_viewport(ScrollViewport::Delta(isize::try_from(input.lines).unwrap_or(0)));
        self.full = true;
        Ok(out)
    }

    pub(super) fn select(&mut self, request: TerminalSelect) -> Result<(), Error> {
        let selection = match request {
            TerminalSelect::All => self.vt.select_all()?,
            TerminalSelect::Clear => None,
            TerminalSelect::Range { start, end } => {
                let start = self.vt.grid_ref(self.viewport(start))?;
                let end = self.vt.grid_ref(self.viewport(end))?;
                Some(Selection::new(start, end, false))
            }
            TerminalSelect::Word { at } => {
                self.vt.select_word(SelectWordOptions::new(self.vt.grid_ref(self.viewport(at))?))?
            }
            TerminalSelect::Line { at } => {
                self.vt.select_line(SelectLineOptions::new(self.vt.grid_ref(self.viewport(at))?))?
            }
        };
        self.vt.set_selection(selection.as_ref())?;
        self.has_selection = selection.is_some();
        self.full = true;
        Ok(())
    }

    pub(super) fn selection_text(&self) -> Result<String, Error> {
        let options = FormatOptions::new().with_emit_format(Format::Plain).with_unwrap(true).with_trim(true);
        let text = self.vt.format_selection_alloc(None, options)?;
        Ok(text.map(|bytes| String::from_utf8_lossy(&bytes).into_owned()).unwrap_or_default())
    }

    pub(super) fn recent(&self, lines: u32) -> Result<String, Error> {
        let total = self.vt.total_rows()?;
        let rows = usize::from(self.vt.rows()?);
        let end = total.saturating_sub(rows) + usize::from(self.vt.cursor_y()?);
        let start = end.saturating_sub(usize::try_from(lines.saturating_sub(1)).unwrap_or(usize::MAX));
        let last_column = self.vt.cols()?.saturating_sub(1);
        let first = self.vt.grid_ref(Point::Screen(PointCoordinate { x: 0, y: screen_row(start) }))?;
        let last = self.vt.grid_ref(Point::Screen(PointCoordinate { x: last_column, y: screen_row(end) }))?;
        let selection = Selection::new(first, last, false);
        let options = FormatOptions::new()
            .with_emit_format(Format::Plain)
            .with_unwrap(true)
            .with_trim(true)
            .with_selection(&selection);
        let text = self.vt.format_selection_alloc(None, options)?;
        let text = text.map(|bytes| String::from_utf8_lossy(&bytes).into_owned()).unwrap_or_default();
        let kept: Vec<&str> = text.lines().collect();
        let begin = kept.iter().position(|line| !line.trim().is_empty()).unwrap_or(kept.len());
        let finish = kept.iter().rposition(|line| !line.trim().is_empty()).map_or(begin, |index| index + 1);
        Ok(kept[begin..finish].join("\n"))
    }

    fn typed(&mut self) -> Result<(), Error> {
        let scrollbar = self.vt.scrollbar()?;
        if scrollbar.offset + scrollbar.len < scrollbar.total {
            self.vt.scroll_viewport(ScrollViewport::Bottom);
            self.full = true;
        }
        if self.has_selection {
            self.vt.set_selection(None)?;
            self.has_selection = false;
            self.full = true;
        }
        Ok(())
    }

    fn report(
        &mut self,
        action: mouse::Action,
        button: Option<mouse::Button>,
        x: f64,
        y: f64,
        mods: Mods,
        track_last_cell: bool,
    ) -> Result<Vec<u8>, Error> {
        let size = self.size;
        self.mouse_encoder
            .set_options_from_terminal(&self.vt)
            .set_size(mouse::EncoderSize {
                screen_width: u32::from(size.cols) * size.cell_width,
                screen_height: u32::from(size.rows) * size.cell_height,
                cell_width: size.cell_width,
                cell_height: size.cell_height,
                padding_top: 0,
                padding_bottom: 0,
                padding_right: 0,
                padding_left: 0,
            })
            .set_any_button_pressed(self.buttons.any())
            .set_track_last_cell(track_last_cell);
        self.mouse_event.set_action(action).set_button(button).set_mods(mods).set_position(position(x, y));
        let mut out = Vec::with_capacity(32);
        self.mouse_encoder.encode_to_vec(&self.mouse_event, &mut out)?;
        Ok(out)
    }

    fn press_at(&mut self, x: f64, y: f64) -> Result<(), Error> {
        let point = self.point(x, y);
        let grid = self.vt.grid_ref(point)?;
        let selection = self
            .press
            .set_repeat_distance(f64::from(self.size.cell_width))?
            .set_time(self.clock.elapsed())?
            .set_position(x, y)?
            .apply(&mut self.gesture, &self.vt, grid)?;
        self.vt.set_selection(selection.as_ref())?;
        self.has_selection = selection.is_some();
        self.selecting = true;
        self.full = true;
        Ok(())
    }

    fn drag_to(&mut self, x: f64, y: f64, mods: Mods) -> Result<(), Error> {
        let point = self.point(x, y);
        let geometry = Geometry {
            columns: u32::from(self.size.cols),
            cell_width: self.size.cell_width,
            padding_left: 0,
            screen_height: u32::from(self.size.rows) * self.size.cell_height,
        };
        let grid = self.vt.grid_ref(point)?;
        let selection = self.drag.set_rectangle(mods.contains(Mods::ALT))?.set_position(x, y)?.apply(
            &mut self.gesture,
            &self.vt,
            grid,
            geometry,
        )?;
        self.vt.set_selection(selection.as_ref())?;
        self.has_selection = selection.is_some();
        self.full = true;
        Ok(())
    }

    fn release_at(&mut self, x: f64, y: f64) -> Result<(), Error> {
        let point = self.point(x, y);
        let grid = self.vt.grid_ref(point).ok();
        self.release.apply(&mut self.gesture, &self.vt, grid)?;
        self.selecting = false;
        Ok(())
    }

    fn point(&self, x: f64, y: f64) -> Point {
        Point::Viewport(PointCoordinate {
            x: cell_index(x, self.size.cell_width, self.size.cols),
            y: u32::from(cell_index(y, self.size.cell_height, self.size.rows)),
        })
    }

    fn viewport(&self, point: TerminalPoint) -> Point {
        Point::Viewport(PointCoordinate {
            x: point.column.min(self.size.cols.saturating_sub(1)),
            y: u32::from(point.row.min(self.size.rows.saturating_sub(1))),
        })
    }
}

pub(crate) fn preview(cols: u16, rows: u16, data: &[u8]) -> Option<TerminalFrame> {
    let mut emulator = Emulator::new(TerminalSize { cols, rows, cell_width: 8, cell_height: 16 }, 0).ok()?;
    emulator.feed(data);
    emulator.frame(true).ok().flatten()
}

fn clamp(size: TerminalSize) -> TerminalSize {
    TerminalSize {
        cols: size.cols.max(2),
        rows: size.rows.max(1),
        cell_width: size.cell_width.max(1),
        cell_height: size.cell_height.max(1),
    }
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn cell_index(pixels: f64, cell: u32, count: u16) -> u16 {
    let last = f64::from(count.saturating_sub(1));
    (pixels / f64::from(cell)).floor().clamp(0.0, last) as u16
}

#[allow(clippy::cast_possible_truncation)]
fn position(x: f64, y: f64) -> mouse::Position {
    mouse::Position { x: x as f32, y: y as f32 }
}

fn screen_row(row: usize) -> u32 {
    u32::try_from(row).unwrap_or(u32::MAX)
}

fn printable(character: char) -> bool {
    !character.is_control() && !('\u{f700}'..='\u{f8ff}').contains(&character)
}

fn mods(input: TerminalMods) -> Mods {
    let mut mods = Mods::empty();
    for (on, flag) in [
        (input.shift, Mods::SHIFT),
        (input.control, Mods::CTRL),
        (input.alt, Mods::ALT),
        (input.super_key, Mods::SUPER),
        (input.caps_lock, Mods::CAPS_LOCK),
    ] {
        if on {
            mods |= flag;
        }
    }
    mods
}

fn button(button: TerminalMouseButton) -> mouse::Button {
    match button {
        TerminalMouseButton::Left => mouse::Button::Left,
        TerminalMouseButton::Right => mouse::Button::Right,
        TerminalMouseButton::Middle => mouse::Button::Middle,
    }
}

fn cursor(snapshot: &Snapshot<'static, '_>) -> Result<TerminalCursor, Error> {
    let viewport = snapshot.cursor_viewport()?;
    let shape = match snapshot.cursor_visual_style()? {
        CursorVisualStyle::Bar => TerminalCursorShape::Bar,
        CursorVisualStyle::Underline => TerminalCursorShape::Underline,
        CursorVisualStyle::BlockHollow => TerminalCursorShape::BlockHollow,
        _ => TerminalCursorShape::Block,
    };
    let tail = viewport.is_some_and(|cursor| cursor.at_wide_tail);
    Ok(TerminalCursor {
        column: viewport.map_or(0, |cursor| if tail { cursor.x.saturating_sub(1) } else { cursor.x }),
        row: viewport.map_or(0, |cursor| cursor.y),
        visible: viewport.is_some() && snapshot.cursor_visible()?,
        shape,
        blinking: snapshot.cursor_blinking()?,
        wide: tail,
    })
}

fn row_record(
    cells: &mut CellIterator<'static>,
    row: &RowIteration<'static, '_>,
    index: u16,
    graphemes: &mut Vec<char>,
) -> Result<TerminalRow, Error> {
    let selection = row.selection()?.map(|span| TerminalSpan { start: span.start_x, end: span.end_x });
    let mut runs: Vec<TerminalRun> = Vec::new();
    let mut extendable = false;
    let mut column: u16 = 0;
    let mut iteration = cells.update(row)?;
    while let Some(cell) = iteration.next() {
        let at = column;
        column = column.saturating_add(1);
        let raw = cell.raw_cell()?;
        let wide = match raw.wide()? {
            CellWide::Narrow => false,
            CellWide::Wide => true,
            CellWide::SpacerTail | CellWide::SpacerHead => continue,
        };
        let mut style = if cell.has_styling()? { style(cell.style()?) } else { PLAIN };
        let count = cell.graphemes_len()?;
        if count == 0 {
            match raw.content_tag()? {
                CellContentTag::BgColorPalette => {
                    style.background = TerminalColor::Palette { index: raw.bg_color_palette()?.0 };
                }
                CellContentTag::BgColorRgb => style.background = rgb(raw.bg_color_rgb()?),
                CellContentTag::Codepoint | CellContentTag::CodepointGrapheme => {}
            }
        } else {
            if graphemes.len() < count {
                graphemes.resize(count, '\0');
            }
            cell.graphemes_buf(&mut graphemes[..count])?;
        }
        let cluster: &[char] = if count == 0 { &[' '] } else { &graphemes[..count] };
        let width = if wide { 2 } else { 1 };
        let single = cluster.len() == 1;
        match runs.last_mut() {
            Some(run)
                if extendable
                    && single
                    && run.style == style
                    && run.wide == wide
                    && run.column.saturating_add(run.cells) == at =>
            {
                run.text.extend(cluster);
                run.cells += width;
            }
            _ => runs.push(TerminalRun { column: at, cells: width, wide, text: cluster.iter().collect(), style }),
        }
        extendable = single;
    }
    trim(&mut runs);
    Ok(TerminalRow { index, runs, selection })
}

fn trim(runs: &mut Vec<TerminalRun>) {
    while let Some(run) = runs.last_mut() {
        if run.wide || !blank(&run.style) {
            return;
        }
        let kept = run.text.trim_end_matches(' ').len();
        let removed = u16::try_from(run.text.len() - kept).unwrap_or(run.cells).min(run.cells);
        if removed == 0 {
            return;
        }
        run.text.truncate(kept);
        run.cells -= removed;
        if !run.text.is_empty() {
            return;
        }
        runs.pop();
    }
}

fn blank(style: &TerminalStyle) -> bool {
    style.background == TerminalColor::Default
        && !style.inverse
        && style.underline == TerminalUnderline::None
        && !style.strikethrough
        && !style.overline
}

fn style(style: Style) -> TerminalStyle {
    TerminalStyle {
        foreground: color(style.fg_color),
        background: color(style.bg_color),
        underline_color: color(style.underline_color),
        underline: match style.underline {
            Underline::None => TerminalUnderline::None,
            Underline::Double => TerminalUnderline::Double,
            Underline::Curly => TerminalUnderline::Curly,
            Underline::Dotted => TerminalUnderline::Dotted,
            Underline::Dashed => TerminalUnderline::Dashed,
            _ => TerminalUnderline::Single,
        },
        bold: style.bold,
        italic: style.italic,
        faint: style.faint,
        blink: style.blink,
        inverse: style.inverse,
        invisible: style.invisible,
        strikethrough: style.strikethrough,
        overline: style.overline,
    }
}

fn color(color: StyleColor) -> TerminalColor {
    match color {
        StyleColor::None => TerminalColor::Default,
        StyleColor::Palette(PaletteIndex(index)) => TerminalColor::Palette { index },
        StyleColor::Rgb(value) => rgb(value),
    }
}

fn rgb(value: RgbColor) -> TerminalColor {
    TerminalColor::Rgb { red: value.r, green: value.g, blue: value.b }
}
