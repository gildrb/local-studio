use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use adw::prelude::*;

use crate::app::App;
use crate::format;
use crate::picker::{Picker, Row, Spec};
use crate::prefs;
use crate::state::State;

const SEPARATOR: char = '\u{1e}';
const PROMPT: &str = "prompt:";
const STASH_CURRENT: &str = "stash-current";
const CLEAR_STASH: &str = "clear-stash";

pub struct Tools {
    pub meter: gtk::MenuButton,
    pub stash: Picker,
    ring: gtk::DrawingArea,
    percent: gtk::Label,
    detail: gtk::Label,
    bar: gtk::LevelBar,
    fraction: Rc<Cell<f64>>,
    entries: RefCell<Vec<String>>,
    app: Weak<App>,
}

impl Tools {
    #[allow(clippy::too_many_lines)]
    pub fn new(app: &Weak<App>) -> Self {
        let fraction: Rc<Cell<f64>> = Rc::new(Cell::new(0.0));
        let ring = gtk::DrawingArea::new();
        ring.set_content_width(16);
        ring.set_content_height(16);
        let drawn = Rc::clone(&fraction);
        ring.set_draw_func(move |area, cairo, width, height| {
            let color = area.color();
            let (cx, cy) = (f64::from(width) / 2.0, f64::from(height) / 2.0);
            let radius = cx.min(cy) - 2.0;
            cairo.set_line_width(2.5);
            cairo.set_source_rgba(f64::from(color.red()), f64::from(color.green()), f64::from(color.blue()), 0.18);
            cairo.arc(cx, cy, radius, 0.0, std::f64::consts::TAU);
            cairo.stroke().ok();
            let value = drawn.get().clamp(0.0, 1.0);
            if value > 0.9 {
                cairo.set_source_rgba(0.97, 0.32, 0.29, 1.0);
            } else {
                cairo.set_source_rgba(0.204, 0.420, 0.945, 1.0);
            }
            let start = -std::f64::consts::FRAC_PI_2;
            cairo.arc(cx, cy, radius, start, start + value * std::f64::consts::TAU);
            cairo.stroke().ok();
        });
        let percent = gtk::Label::new(None);
        percent.add_css_class("ls-meta");
        let face = gtk::Box::new(gtk::Orientation::Horizontal, 4);
        face.append(&ring);
        face.append(&percent);
        let title = gtk::Label::new(Some("Context window"));
        title.add_css_class("heading");
        title.set_xalign(0.0);
        let detail = gtk::Label::new(None);
        detail.add_css_class("ls-meta");
        detail.set_xalign(0.0);
        let bar = gtk::LevelBar::for_interval(0.0, 1.0);
        bar.set_size_request(220, 6);
        let note = gtk::Label::new(Some("Eukhe compacts automatically near the limit."));
        note.add_css_class("ls-meta");
        note.set_xalign(0.0);
        let compact = gtk::Button::with_label("Compact context");
        compact.add_css_class("flat");
        let content = gtk::Box::new(gtk::Orientation::Vertical, 6);
        content.set_margin_top(6);
        content.set_margin_bottom(6);
        content.set_margin_start(6);
        content.set_margin_end(6);
        for widget in [
            title.upcast_ref::<gtk::Widget>(),
            detail.upcast_ref(),
            bar.upcast_ref(),
            note.upcast_ref(),
            compact.upcast_ref(),
        ] {
            content.append(widget);
        }
        let popover = gtk::Popover::new();
        popover.set_child(Some(&content));
        let meter = gtk::MenuButton::builder().child(&face).popover(&popover).tooltip_text("Context Window").build();
        meter.add_css_class("flat");
        meter.set_visible(false);
        let weak = app.clone();
        compact.connect_clicked(move |_| {
            let Some(app) = weak.upgrade() else { return };
            let thread = app.state.borrow().selected.clone();
            if let Some(thread) = thread {
                app.core.run(|studio| studio.compact(thread));
            }
        });

        let stash = stash_picker(app);
        let entries: Vec<String> = prefs::get("stash")
            .map(|value| value.split(SEPARATOR).map(str::to_string).filter(|entry| !entry.is_empty()).collect())
            .unwrap_or_default();
        let tools = Self {
            meter,
            stash,
            ring,
            percent,
            detail,
            bar,
            fraction,
            entries: RefCell::new(entries),
            app: app.clone(),
        };
        tools.render_stash();
        tools
    }

    pub fn render(&self, state: &State) {
        let info = state.selected.as_ref().and(state.info.as_ref());
        let context = info.and_then(|info| info.context).filter(|context| context.window > 0);
        self.meter.set_visible(state.settings.context_window_meter && context.is_some());
        if let Some(context) = context {
            #[allow(clippy::cast_precision_loss)]
            let fraction = context.tokens as f64 / context.window as f64;
            self.fraction.set(fraction);
            self.percent.set_label(&format!("{:.0}%", fraction * 100.0));
            self.detail.set_label(&format!(
                "{:.0}% · {} / {} tokens",
                fraction * 100.0,
                format::tokens(context.tokens),
                format::tokens(context.window)
            ));
            self.bar.set_value(fraction.clamp(0.0, 1.0));
            self.ring.queue_draw();
        }
    }

    pub fn stash_current(&self, app: &Rc<App>) {
        let text = app.composer.text();
        if text.trim().is_empty() {
            self.stash.popup();
            return;
        }
        self.entries.borrow_mut().insert(0, text.trim().replace(SEPARATOR, " "));
        self.save();
        app.composer.set_text("");
        app.toast("Prompt stashed. Restore it from the stash menu.");
    }

    fn restore(&self, app: &Rc<App>, index: usize) {
        let entry = {
            let mut entries = self.entries.borrow_mut();
            (index < entries.len()).then(|| entries.remove(index))
        };
        let Some(entry) = entry else { return };
        let current = app.composer.text();
        if !current.trim().is_empty() {
            self.entries.borrow_mut().insert(0, current.trim().to_string());
        }
        self.save();
        self.stash.popdown();
        app.composer.set_text(&entry);
        app.composer.focus();
    }

    fn save(&self) {
        let joined: String = self.entries.borrow().join(&SEPARATOR.to_string());
        prefs::set("stash", &joined);
        self.render_stash();
    }

    fn discard(&self, index: usize) {
        let removed = {
            let mut entries = self.entries.borrow_mut();
            (index < entries.len()).then(|| entries.remove(index))
        };
        if removed.is_some() {
            self.save();
        }
    }

    fn clear(&self) {
        self.entries.borrow_mut().clear();
        self.save();
    }

    fn render_stash(&self) {
        let can_stash = self.app.upgrade().is_some_and(|app| !app.composer.text().trim().is_empty());
        let entries = self.entries.borrow();
        self.stash.button.set_visible(!entries.is_empty());
        self.stash.set_label(&entries.len().to_string());
        let mut rows: Vec<Row> = entries
            .iter()
            .enumerate()
            .map(|(index, entry)| {
                let lines = entry.lines().count();
                Row::new(format!("{PROMPT}{index}"), entry.lines().next().unwrap_or_default())
                    .icon("text-x-generic-symbolic")
                    .subtitle(if lines == 1 { "1 line".to_string() } else { format!("{lines} lines") })
                    .section("Stashed Prompts")
                    .removable()
            })
            .collect();
        rows.push(Row::new(STASH_CURRENT, "Stash Current Prompt").icon("document-save-symbolic").enabled(can_stash));
        rows.push(Row::new(CLEAR_STASH, "Clear Stash").icon("user-trash-symbolic").destructive());
        self.stash.set_rows(rows);
    }

    pub fn set_fixture(&self, entries: &[&str]) {
        self.entries.replace(entries.iter().map(ToString::to_string).collect());
        self.render_stash();
    }
}

fn stash_picker(app: &Weak<App>) -> Picker {
    let weak = app.clone();
    let spec = Spec { tooltip: "Stashed Prompts (Ctrl+S stashes the draft)", width: 320, ..Spec::default() };
    let picker = Picker::new(&spec, move |id| {
        let Some(app) = weak.upgrade() else { return };
        let tools = &app.composer.tools;
        match id {
            STASH_CURRENT => tools.stash_current(&app),
            CLEAR_STASH => tools.clear(),
            _ => {
                if let Some(index) = prompt_index(id) {
                    tools.restore(&app, index);
                }
            }
        }
    });
    picker.set_icon(Some("document-save-symbolic"));
    let weak = app.clone();
    picker.connect_remove(move |id| {
        if let (Some(app), Some(index)) = (weak.upgrade(), prompt_index(id)) {
            app.composer.tools.discard(index);
        }
    });
    let weak = app.clone();
    picker.popover.connect_show(move |_| {
        if let Some(app) = weak.upgrade() {
            app.composer.tools.render_stash();
        }
    });
    picker
}

fn prompt_index(id: &str) -> Option<usize> {
    id.strip_prefix(PROMPT).and_then(|index| index.parse().ok())
}
