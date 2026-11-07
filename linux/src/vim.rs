use std::cell::{Cell, RefCell};
use std::rc::Rc;

use adw::prelude::*;
use gtk::{gdk, glib};

use crate::app::App;
use crate::state::State;

const ESCAPE: char = '\u{1b}';
const RETURN: char = '\r';
const BACKSPACE: char = '\u{7f}';
const MAX_COUNT: usize = 9_999;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Normal,
    Insert,
}

impl Mode {
    pub fn label(self) -> &'static str {
        match self {
            Self::Normal => "NORMAL",
            Self::Insert => "INSERT",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Operator {
    Delete,
    Change,
    Yank,
}

impl Operator {
    fn parse(input: char) -> Option<Self> {
        match input {
            'd' => Some(Self::Delete),
            'c' => Some(Self::Change),
            'y' => Some(Self::Yank),
            _ => None,
        }
    }

    fn key(self) -> char {
        match self {
            Self::Delete => 'd',
            Self::Change => 'c',
            Self::Yank => 'y',
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Motion {
    Left,
    Right,
    Down,
    Up,
    NextLine,
    WordForward,
    WordBackward,
    WordEnd,
    LineStart,
    FirstNonBlank,
    LineEnd,
    DocumentStart,
    DocumentEnd,
}

impl Motion {
    fn parse(input: char) -> Option<Self> {
        match input {
            'h' | BACKSPACE => Some(Self::Left),
            'l' | ' ' => Some(Self::Right),
            'j' => Some(Self::Down),
            'k' => Some(Self::Up),
            RETURN | '+' => Some(Self::NextLine),
            'w' => Some(Self::WordForward),
            'b' => Some(Self::WordBackward),
            'e' => Some(Self::WordEnd),
            '0' => Some(Self::LineStart),
            '^' => Some(Self::FirstNonBlank),
            '$' => Some(Self::LineEnd),
            'G' => Some(Self::DocumentEnd),
            _ => None,
        }
    }

    fn vertical(self) -> bool {
        matches!(self, Self::Down | Self::Up)
    }

    fn linewise(self) -> bool {
        matches!(self, Self::Down | Self::Up | Self::NextLine | Self::DocumentStart | Self::DocumentEnd)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Space,
    Word,
    Punctuation,
}

#[derive(Debug, Clone, Copy)]
struct Line {
    start: usize,
    end: usize,
    contents_end: usize,
}

impl Line {
    fn has_break(self) -> bool {
        self.end > self.contents_end
    }

    fn is_blank(self) -> bool {
        self.contents_end == self.start
    }
}

struct Text {
    chars: Vec<char>,
}

impl Text {
    fn new(text: &str) -> Self {
        Self { chars: text.chars().collect() }
    }

    fn length(&self) -> usize {
        self.chars.len()
    }

    fn line(&self, location: usize) -> Line {
        let at = location.min(self.length());
        let start = self.chars[..at].iter().rposition(|ch| *ch == '\n').map_or(0, |index| index + 1);
        let contents_end =
            self.chars[start..].iter().position(|ch| *ch == '\n').map_or(self.length(), |index| start + index);
        let end = if contents_end < self.length() { contents_end + 1 } else { contents_end };
        Line { start, end, contents_end }
    }

    fn line_number(&self, number: usize) -> Line {
        let mut current = self.line(0);
        let mut remaining = number.saturating_sub(1);
        while remaining > 0 {
            let Some(below) = self.below(current) else { break };
            current = below;
            remaining -= 1;
        }
        current
    }

    fn last_line(&self) -> Line {
        self.line(self.length())
    }

    fn below(&self, line: Line) -> Option<Line> {
        line.has_break().then(|| self.line(line.end))
    }

    fn above(&self, line: Line) -> Option<Line> {
        (line.start > 0).then(|| self.line(line.start - 1))
    }

    fn next(&self, location: usize) -> usize {
        if location >= self.length() {
            self.length()
        } else {
            location + 1
        }
    }

    fn previous(&self, location: usize) -> usize {
        if location == 0 {
            0
        } else {
            location.min(self.length()) - 1
        }
    }

    fn rest(&self, location: usize) -> usize {
        let at = location.min(self.length());
        let line = self.line(at);
        if at >= line.contents_end {
            if line.is_blank() {
                line.start
            } else {
                self.previous(line.contents_end)
            }
        } else {
            at
        }
    }

    fn kind(&self, location: usize) -> Kind {
        match self.chars.get(location) {
            None => Kind::Space,
            Some(ch) if ch.is_whitespace() => Kind::Space,
            Some(ch) if *ch == '_' || ch.is_alphanumeric() => Kind::Word,
            Some(_) => Kind::Punctuation,
        }
    }

    fn first_non_blank(&self, line: Line) -> usize {
        let mut location = line.start;
        while location < line.contents_end && self.kind(location) == Kind::Space {
            location = self.next(location);
        }
        location
    }

    fn advance(&self, location: usize, count: usize, limit: usize) -> usize {
        let mut position = location;
        for _ in 0..count {
            if position < limit {
                position = self.next(position);
            }
        }
        position.min(limit.max(location))
    }

    fn retreat(&self, location: usize, count: usize, limit: usize) -> usize {
        let mut position = location;
        for _ in 0..count {
            if position > limit {
                position = self.previous(position);
            }
        }
        position.max(limit.min(location))
    }

    fn word_forward(&self, location: usize) -> usize {
        let mut position = location;
        let start = self.kind(position);
        if start != Kind::Space {
            while position < self.length() && self.kind(position) == start {
                position = self.next(position);
            }
        }
        while position < self.length() && self.kind(position) == Kind::Space {
            position = self.next(position);
        }
        position
    }

    fn word_end(&self, location: usize) -> usize {
        let mut position = self.next(location);
        while position < self.length() && self.kind(position) == Kind::Space {
            position = self.next(position);
        }
        if position >= self.length() {
            return self.previous(self.length());
        }
        self.word_tail(position)
    }

    fn word_tail(&self, location: usize) -> usize {
        let mut position = location;
        let start = self.kind(position);
        while self.next(position) < self.length() && self.kind(self.next(position)) == start {
            position = self.next(position);
        }
        position
    }

    fn word_backward(&self, location: usize) -> usize {
        let mut position = self.previous(location);
        while position > 0 && self.kind(position) == Kind::Space {
            position = self.previous(position);
        }
        let start = self.kind(position);
        while position > 0 && self.kind(self.previous(position)) == start {
            position = self.previous(position);
        }
        position
    }

    fn slice(&self, start: usize, end: usize) -> String {
        let end = end.min(self.length());
        self.chars[start.min(end)..end].iter().collect()
    }

    fn vertical(&self, line: Line, count: usize, down: bool) -> Option<Line> {
        let mut current = line;
        let mut moved = 0;
        while moved < count {
            let next = if down { self.below(current) } else { self.above(current) };
            let Some(next) = next else { break };
            current = next;
            moved += 1;
        }
        (moved > 0 || count == 0).then_some(current)
    }
}

#[derive(Default)]
struct Register {
    text: String,
    linewise: bool,
}

struct Machine {
    mode: Mode,
    count: usize,
    operator: Option<Operator>,
    operator_count: usize,
    prefix_g: bool,
    column: Option<usize>,
    anchor: Option<usize>,
    register: Register,
    label: gtk::Label,
}

impl Machine {
    fn pending(&self) -> bool {
        self.count > 0 || self.operator.is_some() || self.prefix_g
    }

    fn clear(&mut self) {
        self.count = 0;
        self.operator = None;
        self.operator_count = 0;
        self.prefix_g = false;
    }

    fn reset(&mut self, view: &gtk::TextView) {
        self.clear();
        self.column = None;
        self.anchor = None;
        self.mode = Mode::Normal;
        self.set_mode(view, Mode::Insert);
    }

    fn handle(&mut self, view: &gtk::TextView, input: char, control: bool) -> bool {
        match self.mode {
            Mode::Insert => {
                if input != ESCAPE || control {
                    return false;
                }
                self.enter_normal(view);
                true
            }
            Mode::Normal => self.normal(view, input, control),
        }
    }

    fn normal(&mut self, view: &gtk::TextView, input: char, control: bool) -> bool {
        if input == ESCAPE {
            let consumed = self.pending();
            self.clear();
            return consumed;
        }
        if control {
            self.clear();
            if input == 'r' {
                self.history(view, true, 1);
            }
            return true;
        }
        if let Some(digit) = input.to_digit(10).and_then(|digit| usize::try_from(digit).ok()) {
            if digit > 0 || self.count > 0 {
                self.count = (self.count * 10 + digit).min(MAX_COUNT);
                return true;
            }
        }
        let mut motion = Motion::parse(input);
        if self.prefix_g {
            self.prefix_g = false;
            if input != 'g' {
                self.clear();
                return true;
            }
            motion = Some(Motion::DocumentStart);
        } else if input == 'g' {
            self.prefix_g = true;
            return true;
        }
        if let Some(operator) = self.operator {
            let raw = if self.count > 0 || self.operator_count > 0 {
                self.count.max(1) * self.operator_count.max(1)
            } else {
                0
            };
            self.clear();
            match motion {
                Some(motion) => self.apply(view, operator, motion, raw),
                None if input == operator.key() => self.linewise(view, operator, raw.max(1)),
                None => {}
            }
            return true;
        }
        let raw = self.count;
        self.clear();
        match motion {
            Some(motion) => self.motion(view, motion, raw),
            None => self.command(view, input, raw),
        }
        true
    }

    fn command(&mut self, view: &gtk::TextView, input: char, raw: usize) {
        let text = content(view);
        let caret = text.rest(selection(view).0);
        let line = text.line(caret);
        let count = raw.max(1);
        self.column = None;
        match input {
            'd' | 'c' | 'y' => {
                self.operator = Operator::parse(input);
                self.operator_count = raw;
            }
            'x' => self.perform(view, Operator::Delete, caret, text.advance(caret, count, line.contents_end)),
            'X' => self.perform(view, Operator::Delete, text.retreat(caret, count, line.start), caret),
            's' => self.perform(view, Operator::Change, caret, text.advance(caret, count, line.contents_end)),
            'D' => self.perform(view, Operator::Delete, caret, caret.max(line.contents_end)),
            'C' => self.perform(view, Operator::Change, caret, caret.max(line.contents_end)),
            'S' => self.linewise(view, Operator::Change, count),
            'Y' => self.linewise(view, Operator::Yank, count),
            'p' | 'P' => self.put(view, input == 'p', count),
            'u' => self.history(view, false, count),
            _ => self.enter(view, input, caret, line, &text),
        }
    }

    fn enter(&mut self, view: &gtk::TextView, input: char, caret: usize, line: Line, text: &Text) {
        match input {
            'i' => self.enter_insert(view, caret),
            'a' => self.enter_insert(view, if caret < line.contents_end { text.next(caret) } else { caret }),
            'A' => self.enter_insert(view, line.contents_end),
            'I' => self.enter_insert(view, text.first_non_blank(line)),
            'o' if replace(view, line.contents_end, line.contents_end, "\n") => {
                self.enter_insert(view, line.contents_end + 1);
            }
            'O' if replace(view, line.start, line.start, "\n") => self.enter_insert(view, line.start),
            _ => {}
        }
    }

    fn motion(&mut self, view: &gtk::TextView, motion: Motion, raw: usize) {
        let text = content(view);
        let location = selection(view).0;
        if !motion.vertical() || Some(location) != self.anchor {
            self.column = None;
        }
        let caret = text.rest(location);
        let Some(target) = self.target(motion, caret, raw, &text) else { return };
        let destination = text.rest(target);
        place(view, destination);
        self.anchor = Some(destination);
        if motion == Motion::LineEnd {
            self.column = Some(usize::MAX);
        }
    }

    fn apply(&mut self, view: &gtk::TextView, operator: Operator, motion: Motion, raw: usize) {
        let text = content(view);
        let caret = text.rest(selection(view).0);
        self.column = None;
        if operator == Operator::Change && motion == Motion::WordForward && text.kind(caret) != Kind::Space {
            let mut end = text.word_tail(caret);
            for _ in 1..raw.max(1) {
                end = text.word_end(end);
            }
            self.perform(view, operator, caret, text.next(end));
            return;
        }
        let Some(mut target) = self.target(motion, caret, raw, &text) else { return };
        self.column = None;
        if motion.linewise() {
            let first = text.line(caret.min(target));
            let last = text.line(caret.max(target));
            self.lines(view, operator, first, last);
            return;
        }
        let line = text.line(caret);
        if motion == Motion::WordForward && target > line.contents_end && caret < line.contents_end {
            target = line.contents_end;
        }
        let lower = caret.min(target);
        let upper = if motion == Motion::WordEnd { text.next(caret.max(target)) } else { caret.max(target) };
        self.perform(view, operator, lower, upper);
    }

    fn target(&mut self, motion: Motion, caret: usize, raw: usize, text: &Text) -> Option<usize> {
        let count = raw.max(1);
        let line = text.line(caret);
        match motion {
            Motion::Left => Some(text.retreat(caret, count, line.start)),
            Motion::Right => Some(text.advance(caret, count, line.contents_end)),
            Motion::Down | Motion::Up => {
                let destination = text.vertical(line, count, motion == Motion::Down)?;
                let goal = self.column.unwrap_or(caret - line.start);
                self.column = Some(goal);
                Some(if goal >= destination.contents_end - destination.start {
                    destination.contents_end
                } else {
                    destination.start + goal
                })
            }
            Motion::NextLine => text.vertical(line, count, true).map(|below| text.first_non_blank(below)),
            Motion::WordForward | Motion::WordBackward | Motion::WordEnd => {
                let mut position = caret;
                for _ in 0..count {
                    position = match motion {
                        Motion::WordForward => text.word_forward(position),
                        Motion::WordBackward => text.word_backward(position),
                        _ => text.word_end(position),
                    };
                }
                Some(position)
            }
            Motion::LineStart => Some(line.start),
            Motion::FirstNonBlank => Some(text.first_non_blank(line)),
            Motion::LineEnd => Some(text.vertical(line, count - 1, true).unwrap_or(line).contents_end),
            Motion::DocumentStart => {
                Some(text.first_non_blank(if raw > 0 { text.line_number(raw) } else { text.line(0) }))
            }
            Motion::DocumentEnd => {
                Some(text.first_non_blank(if raw > 0 { text.line_number(raw) } else { text.last_line() }))
            }
        }
    }

    fn perform(&mut self, view: &gtk::TextView, operator: Operator, start: usize, end: usize) {
        let text = content(view);
        if end > start {
            self.register = Register { text: text.slice(start, end), linewise: false };
        }
        match operator {
            Operator::Yank => place(view, text.rest(start)),
            Operator::Delete => {
                if end <= start || !replace(view, start, end, "") {
                    return;
                }
                place(view, content(view).rest(start));
            }
            Operator::Change => {
                if end > start {
                    replace(view, start, end, "");
                }
                self.enter_insert(view, start);
            }
        }
    }

    fn linewise(&mut self, view: &gtk::TextView, operator: Operator, count: usize) {
        let text = content(view);
        let first = text.line(text.rest(selection(view).0));
        let mut last = first;
        for _ in 1..count.max(1) {
            let Some(below) = text.below(last) else { break };
            last = below;
        }
        self.lines(view, operator, first, last);
    }

    fn lines(&mut self, view: &gtk::TextView, operator: Operator, first: Line, last: Line) {
        let text = content(view);
        self.register = Register { text: format!("{}\n", text.slice(first.start, last.contents_end)), linewise: true };
        match operator {
            Operator::Yank => {
                let caret = selection(view).0;
                if caret > last.contents_end || caret < first.start {
                    place(view, text.rest(text.first_non_blank(first)));
                }
            }
            Operator::Change => {
                let start = text.first_non_blank(first);
                replace(view, start, start.max(last.contents_end), "");
                self.enter_insert(view, start);
            }
            Operator::Delete => {
                let (start, end) = if last.has_break() {
                    (first.start, last.end)
                } else if first.start > 0 {
                    (first.start - 1, last.contents_end)
                } else {
                    (0, text.length())
                };
                if !replace(view, start, end, "") {
                    return;
                }
                let updated = content(view);
                place(view, updated.rest(updated.first_non_blank(updated.line(start))));
            }
        }
    }

    fn put(&mut self, view: &gtk::TextView, after: bool, count: usize) {
        if self.register.text.is_empty() {
            return;
        }
        let text = content(view);
        let caret = text.rest(selection(view).0);
        let line = text.line(caret);
        let body = self.register.text.repeat(count);
        let length = body.chars().count();
        if !self.register.linewise {
            let location = if after && caret < line.contents_end { text.next(caret) } else { caret };
            if replace(view, location, location, &body) {
                place(view, content(view).rest(location + length.saturating_sub(1)));
            }
            return;
        }
        let (location, inserted) = if after && line.has_break() {
            (line.end, body)
        } else if after {
            (line.contents_end, format!("\n{}", body.chars().take(length.saturating_sub(1)).collect::<String>()))
        } else {
            (line.start, body)
        };
        if !replace(view, location, location, &inserted) {
            return;
        }
        let updated = content(view);
        let start = if after && !line.has_break() { location + 1 } else { location };
        place(view, updated.rest(updated.first_non_blank(updated.line(start))));
    }

    fn history(&mut self, view: &gtk::TextView, redo: bool, times: usize) {
        let buffer = view.buffer();
        for _ in 0..times.max(1) {
            if redo && buffer.can_redo() {
                buffer.redo();
            } else if !redo && buffer.can_undo() {
                buffer.undo();
            } else {
                break;
            }
        }
        self.column = None;
        place(view, content(view).rest(selection(view).0));
    }

    fn enter_normal(&mut self, view: &gtk::TextView) {
        self.clear();
        self.column = None;
        let text = content(view);
        let (location, length) = selection(view);
        let line = text.line(location);
        let back = length == 0 && location > line.start;
        place(view, text.rest(if back { text.previous(location) } else { location }));
        self.set_mode(view, Mode::Normal);
    }

    fn enter_insert(&mut self, view: &gtk::TextView, location: usize) {
        place(view, location);
        self.set_mode(view, Mode::Insert);
    }

    fn set_mode(&mut self, view: &gtk::TextView, next: Mode) {
        if self.mode == next {
            return;
        }
        self.mode = next;
        view.set_overwrite(next == Mode::Normal);
        self.label.set_label(next.label());
        if next == Mode::Normal {
            self.label.add_css_class("normal");
        } else {
            self.label.remove_css_class("normal");
        }
    }
}

pub struct Vim {
    pub label: gtk::Label,
    enabled: Cell<bool>,
    preedit: Rc<Cell<bool>>,
    machine: RefCell<Machine>,
}

impl Vim {
    pub fn new(view: &gtk::TextView) -> Self {
        let label = gtk::Label::new(Some(Mode::Insert.label()));
        label.add_css_class("ls-vim-mode");
        label.set_valign(gtk::Align::Center);
        label.set_tooltip_text(Some("Vim keys (Settings → General → Keyboard)"));
        label.set_visible(false);
        let preedit = Rc::new(Cell::new(false));
        let composing = Rc::clone(&preedit);
        view.connect_preedit_changed(move |_, text| composing.set(!text.is_empty()));
        let machine = Machine {
            mode: Mode::Insert,
            count: 0,
            operator: None,
            operator_count: 0,
            prefix_g: false,
            column: None,
            anchor: None,
            register: Register::default(),
            label: label.clone(),
        };
        Self { label, enabled: Cell::new(false), preedit, machine: RefCell::new(machine) }
    }

    pub fn mode(&self) -> Mode {
        self.machine.try_borrow().map_or(Mode::Insert, |machine| machine.mode)
    }

    pub fn render(&self, view: &gtk::TextView, state: &State) {
        let enabled = state.settings.vim_mode;
        if self.enabled.replace(enabled) && !enabled {
            self.reset(view);
        }
        self.label.set_visible(enabled);
    }

    pub fn reset(&self, view: &gtk::TextView) {
        if let Ok(mut machine) = self.machine.try_borrow_mut() {
            machine.reset(view);
        }
    }

    pub fn key(&self, view: &gtk::TextView, key: gdk::Key, modifiers: gdk::ModifierType) -> glib::Propagation {
        if !self.enabled.get() || self.preedit.get() {
            return glib::Propagation::Proceed;
        }
        let Some((input, control)) = translate(key, modifiers) else { return glib::Propagation::Proceed };
        let Ok(mut machine) = self.machine.try_borrow_mut() else { return glib::Propagation::Proceed };
        if machine.handle(view, input, control) {
            glib::Propagation::Stop
        } else {
            glib::Propagation::Proceed
        }
    }

    pub fn feed(&self, view: &gtk::TextView, keys: &str) {
        for input in keys.chars() {
            let Ok(mut machine) = self.machine.try_borrow_mut() else { return };
            let handled = machine.handle(view, input, false);
            let mode = machine.mode;
            drop(machine);
            if handled || mode != Mode::Insert {
                continue;
            }
            let buffer = view.buffer();
            buffer.begin_user_action();
            buffer.delete_selection(true, view.is_editable());
            buffer.insert_interactive_at_cursor(&input.to_string(), view.is_editable());
            buffer.end_user_action();
        }
    }
}

pub fn vim_feed(app: &Rc<App>, keys: &str) {
    let view = app.composer.view();
    app.composer.vim.feed(&view, keys);
}

fn translate(key: gdk::Key, modifiers: gdk::ModifierType) -> Option<(char, bool)> {
    if modifiers.intersects(
        gdk::ModifierType::SUPER_MASK
            | gdk::ModifierType::ALT_MASK
            | gdk::ModifierType::META_MASK
            | gdk::ModifierType::HYPER_MASK,
    ) {
        return None;
    }
    if modifiers.contains(gdk::ModifierType::CONTROL_MASK) {
        let redo = key.to_lower() == gdk::Key::r && !modifiers.contains(gdk::ModifierType::SHIFT_MASK);
        return redo.then_some(('r', true));
    }
    match key {
        gdk::Key::Escape => Some((ESCAPE, false)),
        gdk::Key::Return | gdk::Key::KP_Enter | gdk::Key::ISO_Enter => Some((RETURN, false)),
        gdk::Key::BackSpace => Some((BACKSPACE, false)),
        _ => key.to_unicode().filter(|ch| !ch.is_control()).map(|ch| (ch, false)),
    }
}

fn content(view: &gtk::TextView) -> Text {
    let buffer = view.buffer();
    Text::new(&buffer.slice(&buffer.start_iter(), &buffer.end_iter(), true))
}

fn offset(iter: &gtk::TextIter) -> usize {
    usize::try_from(iter.offset()).unwrap_or(0)
}

fn selection(view: &gtk::TextView) -> (usize, usize) {
    let buffer = view.buffer();
    let (start, end) = buffer.selection_bounds().unwrap_or_else(|| {
        let cursor = buffer.iter_at_mark(&buffer.get_insert());
        (cursor, cursor)
    });
    let (start, end) = (offset(&start), offset(&end));
    (start.min(end), start.abs_diff(end))
}

fn iter_at(buffer: &gtk::TextBuffer, location: usize) -> gtk::TextIter {
    buffer.iter_at_offset(i32::try_from(location).unwrap_or(i32::MAX))
}

fn place(view: &gtk::TextView, location: usize) {
    let buffer = view.buffer();
    buffer.place_cursor(&iter_at(&buffer, location));
    view.scroll_mark_onscreen(&buffer.get_insert());
}

fn replace(view: &gtk::TextView, start: usize, end: usize, text: &str) -> bool {
    if !view.is_editable() {
        return false;
    }
    let buffer = view.buffer();
    buffer.begin_user_action();
    let mut from = iter_at(&buffer, start);
    let mut to = iter_at(&buffer, end);
    if start != end {
        buffer.delete(&mut from, &mut to);
    }
    if !text.is_empty() {
        buffer.insert(&mut from, text);
    }
    buffer.end_user_action();
    true
}
