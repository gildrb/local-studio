use std::cell::{Cell, RefCell};
use std::rc::Rc;

use adw::prelude::*;
use gtk::{gdk, glib, pango};
use local_studio_core::{
    TerminalColor, TerminalCursorShape, TerminalFrame, TerminalKey, TerminalKeyAction, TerminalMods, TerminalMouse,
    TerminalMouseAction, TerminalMouseButton, TerminalRow, TerminalScroll, TerminalSize, TerminalUnderline,
};

use crate::colors::Colors;

const PAD: f64 = 6.0;
const BLINK: std::time::Duration = std::time::Duration::from_millis(530);
const RETURN_KEYCODE: u32 = 36;

pub enum Input {
    Key(TerminalKey),
    Mouse(TerminalMouse),
    Scroll(TerminalScroll),
    Focus(bool),
    Resize(TerminalSize),
    Menu(f64, f64),
    Shortcut(gdk::Key),
}

pub type Sink = Rc<dyn Fn(Input)>;

struct Piece {
    x: f64,
    width: f64,
    background: Option<gdk::RGBA>,
    foreground: gdk::RGBA,
    layout: Option<pango::Layout>,
}

struct Palette {
    foreground: gdk::RGBA,
    background: gdk::RGBA,
    cursor: gdk::RGBA,
    selection: gdk::RGBA,
    ansi: [gdk::RGBA; 16],
}

struct Screen {
    cols: u16,
    rows: u16,
    lines: Vec<Option<TerminalRow>>,
    cache: Vec<Option<Vec<Piece>>>,
    cursor: Option<local_studio_core::TerminalCursor>,
    mouse_tracking: bool,
    font: pango::FontDescription,
    cell: (f64, f64),
    palette: Palette,
    grid: (u16, u16),
}

pub struct TerminalView {
    pub area: gtk::DrawingArea,
    screen: Rc<RefCell<Screen>>,
    focused: Rc<Cell<bool>>,
    blink_on: Rc<Cell<bool>>,
    blink_enabled: Rc<Cell<bool>>,
    pressed: Rc<Cell<bool>>,
}

fn rgba(hex: &str) -> gdk::RGBA {
    gdk::RGBA::parse(hex).unwrap_or(gdk::RGBA::WHITE)
}

fn palette(colors: &Colors) -> Palette {
    Palette {
        foreground: rgba(colors.terminal_fg),
        background: rgba(colors.terminal_bg),
        cursor: rgba(colors.cursor),
        selection: rgba(colors.selection),
        ansi: colors.ansi.map(rgba),
    }
}

fn indexed(index: u8, palette: &Palette) -> gdk::RGBA {
    let level = |value: u8| if value == 0 { 0.0 } else { (55.0 + 40.0 * f32::from(value)) / 255.0 };
    match index {
        0..=15 => palette.ansi[usize::from(index)],
        16..=231 => {
            let value = index - 16;
            gdk::RGBA::new(level(value / 36), level((value / 6) % 6), level(value % 6), 1.0)
        }
        _ => {
            let gray = (8.0 + 10.0 * f32::from(index - 232)) / 255.0;
            gdk::RGBA::new(gray, gray, gray, 1.0)
        }
    }
}

fn resolve(color: TerminalColor, palette: &Palette) -> Option<gdk::RGBA> {
    match color {
        TerminalColor::Default => None,
        TerminalColor::Palette { index } => Some(indexed(index, palette)),
        TerminalColor::Rgb { red, green, blue } => {
            Some(gdk::RGBA::new(f32::from(red) / 255.0, f32::from(green) / 255.0, f32::from(blue) / 255.0, 1.0))
        }
    }
}

fn mods(state: gdk::ModifierType) -> TerminalMods {
    TerminalMods {
        shift: state.contains(gdk::ModifierType::SHIFT_MASK),
        control: state.contains(gdk::ModifierType::CONTROL_MASK),
        alt: state.contains(gdk::ModifierType::ALT_MASK),
        super_key: state.contains(gdk::ModifierType::SUPER_MASK),
        caps_lock: state.contains(gdk::ModifierType::LOCK_MASK),
    }
}

impl TerminalView {
    #[allow(clippy::too_many_lines)]
    pub fn new(colors: &Colors, sink: &Sink) -> Self {
        let area = gtk::DrawingArea::new();
        area.set_hexpand(true);
        area.set_vexpand(true);
        area.set_focusable(true);
        area.set_can_focus(true);
        area.add_css_class("ls-terminal");
        let font = pango::FontDescription::from_string("Monospace 10");
        let screen = Rc::new(RefCell::new(Screen {
            cols: 0,
            rows: 0,
            lines: Vec::new(),
            cache: Vec::new(),
            cursor: None,
            mouse_tracking: false,
            font,
            cell: (8.0, 16.0),
            palette: palette(colors),
            grid: (0, 0),
        }));
        let view = Self {
            area,
            screen,
            focused: Rc::new(Cell::new(false)),
            blink_on: Rc::new(Cell::new(true)),
            blink_enabled: Rc::new(Cell::new(true)),
            pressed: Rc::new(Cell::new(false)),
        };
        view.measure();
        view.install_draw();
        view.install_resize(sink);
        view.install_keys(sink);
        view.install_mouse(sink);
        view.install_focus(sink);
        let (area, blink_on, focused, blink_enabled) = (
            view.area.downgrade(),
            Rc::clone(&view.blink_on),
            Rc::clone(&view.focused),
            Rc::clone(&view.blink_enabled),
        );
        glib::timeout_add_local(BLINK, move || {
            let Some(area) = area.upgrade() else { return glib::ControlFlow::Break };
            if focused.get() && blink_enabled.get() {
                blink_on.set(!blink_on.get());
                area.queue_draw();
            } else if !blink_on.get() {
                blink_on.set(true);
                area.queue_draw();
            }
            glib::ControlFlow::Continue
        });
        view
    }

    pub fn grid(&self) -> (u16, u16) {
        let grid = self.screen.borrow().grid;
        if grid.0 == 0 {
            (80, 24)
        } else {
            grid
        }
    }

    pub fn size(&self) -> TerminalSize {
        let (cols, rows) = self.grid();
        let (width, height) = self.screen.borrow().cell;
        let scale = f64::from(self.area.scale_factor());
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        TerminalSize { cols, rows, cell_width: (width * scale) as u32, cell_height: (height * scale) as u32 }
    }

    pub fn set_font(&self, font: &pango::FontDescription) {
        self.screen.borrow_mut().font = font.clone();
        self.measure();
        self.invalidate();
        self.area.queue_resize();
    }

    pub fn set_colors(&self, colors: &Colors) {
        self.screen.borrow_mut().palette = palette(colors);
        self.invalidate();
    }

    pub fn set_blink(&self, enabled: bool) {
        self.blink_enabled.set(enabled);
    }

    fn invalidate(&self) {
        for entry in &mut self.screen.borrow_mut().cache {
            *entry = None;
        }
        self.area.queue_draw();
    }

    fn measure(&self) {
        let layout = self.area.create_pango_layout(Some("M"));
        let mut screen = self.screen.borrow_mut();
        layout.set_font_description(Some(&screen.font));
        let (width, height) = layout.pixel_size();
        screen.cell = (f64::from(width.max(1)), f64::from(height.max(1)));
    }

    pub fn apply(&self, frame: &TerminalFrame) {
        {
            let mut screen = self.screen.borrow_mut();
            if frame.full || frame.cols != screen.cols || frame.rows != screen.rows {
                screen.cols = frame.cols;
                screen.rows = frame.rows;
                screen.lines = vec![None; usize::from(frame.rows)];
                screen.cache = (0..frame.rows).map(|_| None).collect();
            }
            for row in &frame.dirty {
                let index = usize::from(row.index);
                if index < screen.lines.len() {
                    screen.lines[index] = Some(row.clone());
                    screen.cache[index] = None;
                }
            }
            screen.cursor = Some(frame.cursor);
            screen.mouse_tracking = frame.mouse_tracking;
        }
        if frame.bell {
            self.area.error_bell();
        }
        self.blink_on.set(true);
        self.area.queue_draw();
    }

    pub fn text(&self) -> String {
        let screen = self.screen.borrow();
        let lines: Vec<String> = screen
            .lines
            .iter()
            .map(|line| {
                let mut text = String::new();
                let mut column = 0;
                for run in line.iter().flat_map(|line| line.runs.iter()) {
                    while column < run.column {
                        text.push(' ');
                        column += 1;
                    }
                    text.push_str(&run.text);
                    column = run.column + run.cells;
                }
                text.trim_end().to_string()
            })
            .collect();
        lines.join("\n").trim_end().to_string()
    }

    fn install_draw(&self) {
        let screen = Rc::clone(&self.screen);
        let (focused, blink_on) = (Rc::clone(&self.focused), Rc::clone(&self.blink_on));
        self.area.set_draw_func(move |area, cairo, _, _| {
            let mut screen = screen.borrow_mut();
            let (width, height) = screen.cell;
            let background = screen.palette.background;
            cairo.set_source_color(&background);
            cairo.paint().ok();
            for index in 0..screen.lines.len() {
                if screen.cache[index].is_none() {
                    let pieces = build(area, &screen, index);
                    screen.cache[index] = Some(pieces);
                }
                #[allow(clippy::cast_precision_loss)]
                let y = PAD + index as f64 * height;
                let selection = screen.lines[index].as_ref().and_then(|line| line.selection);
                if let Some(pieces) = &screen.cache[index] {
                    for piece in pieces {
                        if let Some(color) = &piece.background {
                            cairo.set_source_color(color);
                            cairo.rectangle(PAD + piece.x, y, piece.width, height);
                            cairo.fill().ok();
                        }
                    }
                    if let Some(span) = selection {
                        cairo.set_source_color(&screen.palette.selection);
                        let start = f64::from(span.start);
                        let cells = f64::from(span.end.saturating_sub(span.start) + 1);
                        cairo.rectangle(PAD + start * width, y, cells * width, height);
                        cairo.fill().ok();
                    }
                    for piece in pieces {
                        if let Some(layout) = &piece.layout {
                            cairo.set_source_color(&piece.foreground);
                            cairo.move_to(PAD + piece.x, y);
                            pangocairo::functions::show_layout(cairo, layout);
                        }
                    }
                }
            }
            let Some(cursor) = screen.cursor else { return };
            if !cursor.visible || (cursor.blinking && !blink_on.get()) {
                return;
            }
            let x = PAD + f64::from(cursor.column) * width;
            let y = PAD + f64::from(cursor.row) * height;
            let cells = if cursor.wide { 2.0 } else { 1.0 };
            cairo.set_source_color(&screen.palette.cursor);
            let hollow = !focused.get() || cursor.shape == TerminalCursorShape::BlockHollow;
            match cursor.shape {
                TerminalCursorShape::Bar => cairo.rectangle(x, y, 2.0, height),
                TerminalCursorShape::Underline => cairo.rectangle(x, y + height - 2.0, width * cells, 2.0),
                TerminalCursorShape::Block | TerminalCursorShape::BlockHollow if hollow => {
                    cairo.set_line_width(1.0);
                    cairo.rectangle(x + 0.5, y + 0.5, width * cells - 1.0, height - 1.0);
                    cairo.stroke().ok();
                    return;
                }
                TerminalCursorShape::Block | TerminalCursorShape::BlockHollow => {
                    cairo.rectangle(x, y, width * cells, height);
                }
            }
            cairo.fill().ok();
            if matches!(cursor.shape, TerminalCursorShape::Block) {
                let glyph = screen.lines.get(usize::from(cursor.row)).and_then(Option::as_ref).and_then(|line| {
                    line.runs
                        .iter()
                        .find(|run| run.column <= cursor.column && cursor.column < run.column + run.cells)
                        .and_then(|run| run.text.chars().nth(usize::from(cursor.column - run.column)))
                });
                if let Some(glyph) = glyph.filter(|glyph| !glyph.is_whitespace()) {
                    let layout = area.create_pango_layout(Some(&glyph.to_string()));
                    layout.set_font_description(Some(&screen.font));
                    cairo.set_source_color(&background);
                    cairo.move_to(x, y);
                    pangocairo::functions::show_layout(cairo, &layout);
                }
            }
        });
    }

    fn install_resize(&self, sink: &Sink) {
        let (screen, sink) = (Rc::clone(&self.screen), Rc::clone(sink));
        self.area.connect_resize(move |area, width, height| {
            let size = {
                let mut screen = screen.borrow_mut();
                let (cell_width, cell_height) = screen.cell;
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                let cols = ((f64::from(width) - 2.0 * PAD) / cell_width).floor().max(2.0) as u16;
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                let rows = ((f64::from(height) - 2.0 * PAD) / cell_height).floor().max(1.0) as u16;
                if screen.grid == (cols, rows) {
                    return;
                }
                screen.grid = (cols, rows);
                let scale = f64::from(area.scale_factor());
                #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                TerminalSize {
                    cols,
                    rows,
                    cell_width: (cell_width * scale) as u32,
                    cell_height: (cell_height * scale) as u32,
                }
            };
            sink(Input::Resize(size));
        });
    }

    fn install_keys(&self, sink: &Sink) {
        let im = gtk::IMMulticontext::new();
        im.set_client_widget(Some(&self.area));
        let pending: Rc<Cell<Option<(u32, TerminalMods, u32)>>> = Rc::new(Cell::new(None));
        let (commit_sink, commit_pending) = (Rc::clone(sink), Rc::clone(&pending));
        im.connect_commit(move |_, text| {
            let (code, mods, unshifted) = commit_pending.take().unwrap_or((0, TerminalMods::default(), 0));
            commit_sink(Input::Key(TerminalKey {
                action: TerminalKeyAction::Press,
                code,
                mods,
                text: Some(text.to_string()),
                unshifted,
                composing: false,
            }));
        });
        let keys = gtk::EventControllerKey::new();
        let (press_sink, press_im) = (Rc::clone(sink), im.clone());
        keys.connect_key_pressed(move |controller, key, code, state| {
            let shortcut = state.contains(gdk::ModifierType::CONTROL_MASK | gdk::ModifierType::SHIFT_MASK)
                && matches!(
                    key.to_lower(),
                    gdk::Key::c | gdk::Key::v | gdk::Key::t | gdk::Key::d | gdk::Key::e | gdk::Key::w | gdk::Key::a
                );
            if shortcut {
                press_sink(Input::Shortcut(key.to_lower()));
                return glib::Propagation::Stop;
            }
            let modifiers = mods(state);
            let unshifted = key.to_lower().to_unicode().map_or(0, u32::from);
            let printable = key.to_unicode().is_some_and(|ch| !ch.is_control());
            if printable && !modifiers.control && !modifiers.alt && !modifiers.super_key {
                pending.set(Some((code, modifiers, unshifted)));
                if let Some(event) = controller.current_event() {
                    if press_im.filter_keypress(&event) {
                        return glib::Propagation::Stop;
                    }
                }
                pending.set(None);
            }
            let text = key.to_unicode().filter(|ch| !ch.is_control()).map(|ch| ch.to_string());
            press_sink(Input::Key(TerminalKey {
                action: TerminalKeyAction::Press,
                code,
                mods: modifiers,
                text,
                unshifted,
                composing: false,
            }));
            glib::Propagation::Stop
        });
        let release_sink = Rc::clone(sink);
        keys.connect_key_released(move |_, key, code, state| {
            release_sink(Input::Key(TerminalKey {
                action: TerminalKeyAction::Release,
                code,
                mods: mods(state),
                text: None,
                unshifted: key.to_lower().to_unicode().map_or(0, u32::from),
                composing: false,
            }));
        });
        self.area.add_controller(keys);
        let focus = gtk::EventControllerFocus::new();
        let (enter_im, leave_im) = (im.clone(), im);
        focus.connect_enter(move |_| enter_im.focus_in());
        focus.connect_leave(move |_| leave_im.focus_out());
        self.area.add_controller(focus);
    }

    fn install_mouse(&self, sink: &Sink) {
        let scale = |area: &gtk::DrawingArea, x: f64, y: f64| {
            let factor = f64::from(area.scale_factor());
            ((x - PAD).max(0.0) * factor, (y - PAD).max(0.0) * factor)
        };
        let click = gtk::GestureClick::builder().button(0).build();
        let (press_sink, pressed, area) = (Rc::clone(sink), Rc::clone(&self.pressed), self.area.downgrade());
        click.connect_pressed(move |gesture, _, x, y| {
            let Some(area) = area.upgrade() else { return };
            area.grab_focus();
            let button = match gesture.current_button() {
                1 => TerminalMouseButton::Left,
                2 => TerminalMouseButton::Middle,
                _ => TerminalMouseButton::Right,
            };
            let modifiers = mods(gesture.current_event_state());
            if button == TerminalMouseButton::Right && !modifiers.shift {
                press_sink(Input::Menu(x, y));
                return;
            }
            pressed.set(true);
            let (x, y) = scale(&area, x, y);
            press_sink(Input::Mouse(TerminalMouse {
                action: TerminalMouseAction::Press,
                button: Some(button),
                x,
                y,
                mods: modifiers,
            }));
        });
        let (release_sink, released, area) = (Rc::clone(sink), Rc::clone(&self.pressed), self.area.downgrade());
        click.connect_released(move |gesture, _, x, y| {
            let Some(area) = area.upgrade() else { return };
            if !released.replace(false) {
                return;
            }
            let button = match gesture.current_button() {
                2 => TerminalMouseButton::Middle,
                3 => TerminalMouseButton::Right,
                _ => TerminalMouseButton::Left,
            };
            let (x, y) = scale(&area, x, y);
            release_sink(Input::Mouse(TerminalMouse {
                action: TerminalMouseAction::Release,
                button: Some(button),
                x,
                y,
                mods: mods(gesture.current_event_state()),
            }));
        });
        self.area.add_controller(click);
        let motion = gtk::EventControllerMotion::new();
        let (motion_sink, held, screen, area) =
            (Rc::clone(sink), Rc::clone(&self.pressed), Rc::clone(&self.screen), self.area.downgrade());
        motion.connect_motion(move |controller, x, y| {
            let Some(area) = area.upgrade() else { return };
            if !held.get() && !screen.borrow().mouse_tracking {
                return;
            }
            let (x, y) = scale(&area, x, y);
            motion_sink(Input::Mouse(TerminalMouse {
                action: TerminalMouseAction::Motion,
                button: None,
                x,
                y,
                mods: mods(controller.current_event_state()),
            }));
        });
        self.area.add_controller(motion);
        let wheel = gtk::EventControllerScroll::new(gtk::EventControllerScrollFlags::VERTICAL);
        let pointer = Rc::new(Cell::new((0.0, 0.0)));
        let tracked = Rc::clone(&pointer);
        let hover = gtk::EventControllerMotion::new();
        hover.connect_motion(move |_, x, y| tracked.set((x, y)));
        self.area.add_controller(hover);
        let accumulated = Rc::new(Cell::new(0.0));
        let (wheel_sink, area) = (Rc::clone(sink), self.area.downgrade());
        wheel.connect_scroll(move |controller, _, dy| {
            let Some(area) = area.upgrade() else { return glib::Propagation::Proceed };
            let total = accumulated.get() + dy * 3.0;
            #[allow(clippy::cast_possible_truncation)]
            let lines = total.trunc() as i32;
            accumulated.set(total - f64::from(lines));
            if lines != 0 {
                let (x, y) = pointer.get();
                let (x, y) = scale(&area, x, y);
                wheel_sink(Input::Scroll(TerminalScroll { lines, x, y, mods: mods(controller.current_event_state()) }));
            }
            glib::Propagation::Stop
        });
        self.area.add_controller(wheel);
    }

    fn install_focus(&self, sink: &Sink) {
        let focus = gtk::EventControllerFocus::new();
        let (enter_sink, entered, area) = (Rc::clone(sink), Rc::clone(&self.focused), self.area.downgrade());
        focus.connect_enter(move |_| {
            entered.set(true);
            if let Some(area) = area.upgrade() {
                area.queue_draw();
            }
            enter_sink(Input::Focus(true));
        });
        let (leave_sink, left, area) = (Rc::clone(sink), Rc::clone(&self.focused), self.area.downgrade());
        focus.connect_leave(move |_| {
            left.set(false);
            if let Some(area) = area.upgrade() {
                area.queue_draw();
            }
            leave_sink(Input::Focus(false));
        });
        self.area.add_controller(focus);
    }
}

pub fn return_key() -> TerminalKey {
    TerminalKey {
        action: TerminalKeyAction::Press,
        code: RETURN_KEYCODE,
        mods: TerminalMods::default(),
        text: None,
        unshifted: 0,
        composing: false,
    }
}

pub fn text_key(text: &str) -> TerminalKey {
    TerminalKey {
        action: TerminalKeyAction::Press,
        code: 0,
        mods: TerminalMods::default(),
        text: Some(text.to_string()),
        unshifted: 0,
        composing: false,
    }
}

fn build(area: &gtk::DrawingArea, screen: &Screen, index: usize) -> Vec<Piece> {
    let Some(line) = screen.lines.get(index).and_then(Option::as_ref) else { return Vec::new() };
    let (width, _) = screen.cell;
    let palette = &screen.palette;
    line.runs
        .iter()
        .map(|run| {
            let style = &run.style;
            let mut foreground = resolve(style.foreground, palette).unwrap_or(palette.foreground);
            let mut background = resolve(style.background, palette);
            if style.inverse {
                let swapped = background.unwrap_or(palette.background);
                background = Some(foreground);
                foreground = swapped;
            }
            if style.faint {
                foreground = gdk::RGBA::new(foreground.red(), foreground.green(), foreground.blue(), 0.6);
            }
            let layout = (!style.invisible && !run.text.trim().is_empty()).then(|| {
                let layout = area.create_pango_layout(Some(&run.text));
                layout.set_font_description(Some(&screen.font));
                let attributes = pango::AttrList::new();
                if style.bold {
                    attributes.insert(pango::AttrInt::new_weight(pango::Weight::Bold));
                }
                if style.italic {
                    attributes.insert(pango::AttrInt::new_style(pango::Style::Italic));
                }
                let underline = match style.underline {
                    TerminalUnderline::None => pango::Underline::None,
                    TerminalUnderline::Double => pango::Underline::Double,
                    TerminalUnderline::Curly => pango::Underline::Error,
                    TerminalUnderline::Single | TerminalUnderline::Dotted | TerminalUnderline::Dashed => {
                        pango::Underline::Single
                    }
                };
                if underline != pango::Underline::None {
                    attributes.insert(pango::AttrInt::new_underline(underline));
                    if let Some(color) = resolve(style.underline_color, palette) {
                        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                        let channel = |value: f32| (value * 65535.0) as u16;
                        attributes.insert(pango::AttrColor::new_underline_color(
                            channel(color.red()),
                            channel(color.green()),
                            channel(color.blue()),
                        ));
                    }
                }
                if style.strikethrough {
                    attributes.insert(pango::AttrInt::new_strikethrough(true));
                }
                if style.overline {
                    attributes.insert(pango::AttrInt::new_overline(pango::Overline::Single));
                }
                layout.set_attributes(Some(&attributes));
                layout
            });
            Piece {
                x: f64::from(run.column) * width,
                width: f64::from(run.cells) * width,
                background,
                foreground,
                layout,
            }
        })
        .collect()
}
