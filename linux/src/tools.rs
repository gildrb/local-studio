use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use adw::prelude::*;

use crate::app::App;
use crate::format;
use crate::prefs;
use crate::state::State;

const SEPARATOR: char = '\u{1e}';

pub struct Tools {
    pub meter: gtk::MenuButton,
    pub stash: gtk::MenuButton,
    ring: gtk::DrawingArea,
    percent: gtk::Label,
    detail: gtk::Label,
    bar: gtk::LevelBar,
    fraction: Rc<Cell<f64>>,
    stash_list: gtk::ListBox,
    stash_label: gtk::Label,
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

        let stash_label = gtk::Label::new(None);
        let stash_face = gtk::Box::new(gtk::Orientation::Horizontal, 4);
        stash_face.append(&gtk::Image::from_icon_name("document-save-symbolic"));
        stash_face.append(&stash_label);
        let stash_list = gtk::ListBox::new();
        stash_list.add_css_class("navigation-sidebar");
        stash_list.set_selection_mode(gtk::SelectionMode::None);
        let heading = gtk::Label::new(Some("Stashed prompts"));
        heading.add_css_class("heading");
        heading.set_xalign(0.0);
        heading.set_margin_start(6);
        let column = gtk::Box::new(gtk::Orientation::Vertical, 4);
        column.append(&heading);
        column.append(
            &gtk::ScrolledWindow::builder()
                .hscrollbar_policy(gtk::PolicyType::Never)
                .propagate_natural_height(true)
                .max_content_height(320)
                .min_content_width(320)
                .child(&stash_list)
                .build(),
        );
        let stash_popover = gtk::Popover::new();
        stash_popover.set_child(Some(&column));
        let stash = gtk::MenuButton::builder()
            .child(&stash_face)
            .popover(&stash_popover)
            .tooltip_text("Stashed Prompts (Ctrl+S stashes the draft)")
            .build();
        stash.add_css_class("flat");
        let weak = app.clone();
        stash_list.connect_row_activated(move |_, row| {
            if let Some(app) = weak.upgrade() {
                app.composer.tools.restore(&app, usize::try_from(row.index()).unwrap_or(0));
            }
        });
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
            stash_list,
            stash_label,
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

    fn render_stash(&self) {
        self.stash_list.remove_all();
        let entries = self.entries.borrow();
        self.stash.set_visible(!entries.is_empty());
        self.stash_label.set_label(&entries.len().to_string());
        for (index, entry) in entries.iter().enumerate() {
            let first = entry.lines().next().unwrap_or_default();
            let row = adw::ActionRow::builder()
                .title(format::escape(first))
                .subtitle(format!("{} lines", entry.lines().count()))
                .activatable(true)
                .build();
            let remove = gtk::Button::builder()
                .icon_name("user-trash-symbolic")
                .tooltip_text("Discard")
                .valign(gtk::Align::Center)
                .build();
            remove.add_css_class("flat");
            let weak = self.app.clone();
            remove.connect_clicked(move |_| {
                let Some(app) = weak.upgrade() else { return };
                let tools = &app.composer.tools;
                let removed = {
                    let mut entries = tools.entries.borrow_mut();
                    (index < entries.len()).then(|| entries.remove(index))
                };
                if removed.is_some() {
                    tools.save();
                }
            });
            row.add_suffix(&remove);
            self.stash_list.append(&row);
        }
    }

    pub fn set_fixture(&self, entries: &[&str]) {
        self.entries.replace(entries.iter().map(ToString::to_string).collect());
        self.render_stash();
    }
}
