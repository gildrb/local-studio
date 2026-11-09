use std::cell::{Cell, RefCell};
use std::path::Path;
use std::rc::{Rc, Weak};

use adw::prelude::*;
use gtk::{gdk, glib, pango};

use crate::app::{App, Dirty};
use crate::state::State;

type Handler = Box<dyn Fn(&str)>;

const TYPE_AHEAD_US: i64 = 1_000_000;
const NO_PROJECT: &str = "no-project";
const ADD_PROJECT: &str = "add-project";

#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[allow(clippy::struct_excessive_bools)]
pub struct Row {
    pub id: String,
    pub title: String,
    pub icon: Option<&'static str>,
    pub subtitle: Option<String>,
    pub detail: Option<String>,
    pub section: Option<String>,
    pub checked: bool,
    pub disabled: bool,
    pub destructive: bool,
    pub removable: bool,
}

impl Row {
    #[must_use]
    pub fn new(id: impl Into<String>, title: impl Into<String>) -> Self {
        Self { id: id.into(), title: title.into(), ..Self::default() }
    }

    #[must_use]
    pub fn icon(mut self, icon: &'static str) -> Self {
        self.icon = Some(icon);
        self
    }

    #[must_use]
    pub fn subtitle(mut self, subtitle: impl Into<String>) -> Self {
        self.subtitle = Some(subtitle.into());
        self
    }

    #[must_use]
    pub fn detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    #[must_use]
    pub fn section(mut self, section: &str) -> Self {
        self.section = Some(section.to_string());
        self
    }

    #[must_use]
    pub fn checked(mut self, checked: bool) -> Self {
        self.checked = checked;
        self
    }

    #[must_use]
    pub fn enabled(mut self, enabled: bool) -> Self {
        self.disabled = !enabled;
        self
    }

    #[must_use]
    pub fn destructive(mut self) -> Self {
        self.destructive = true;
        self
    }

    #[must_use]
    pub fn removable(mut self) -> Self {
        self.removable = true;
        self
    }
}

#[derive(Clone, Copy)]
pub struct Spec<'a> {
    pub tooltip: &'a str,
    pub title: Option<&'a str>,
    pub search: Option<&'a str>,
    pub empty: Option<&'a str>,
    pub width: i32,
    pub max_height: i32,
}

impl Default for Spec<'_> {
    fn default() -> Self {
        Self { tooltip: "", title: None, search: None, empty: None, width: 280, max_height: 380 }
    }
}

pub struct Picker {
    pub button: gtk::MenuButton,
    pub popover: gtk::Popover,
    pub label: gtk::Label,
    icon: gtk::Image,
    inner: Rc<Inner>,
}

struct Inner {
    popover: gtk::Popover,
    scroller: gtk::ScrolledWindow,
    list: gtk::Box,
    empty: gtk::Label,
    note: gtk::Label,
    title: Option<String>,
    search: Option<gtk::SearchEntry>,
    rows: RefCell<Vec<Row>>,
    widgets: RefCell<Vec<gtk::Box>>,
    highlighted: RefCell<Option<String>>,
    typed: RefCell<String>,
    typed_at: Cell<i64>,
    choose: Handler,
    remove: RefCell<Option<Handler>>,
}

impl Picker {
    pub fn new(spec: &Spec, choose: impl Fn(&str) + 'static) -> Self {
        let icon = gtk::Image::new();
        icon.set_visible(false);
        let label = gtk::Label::new(None);
        label.set_ellipsize(pango::EllipsizeMode::Middle);
        label.set_max_width_chars(36);
        let face = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        face.append(&icon);
        face.append(&label);

        let column = gtk::Box::new(gtk::Orientation::Vertical, 0);
        column.set_size_request(spec.width, -1);
        let search = spec.search.map(|prompt| {
            let entry = gtk::SearchEntry::builder().placeholder_text(prompt).hexpand(true).build();
            entry.add_css_class("ls-picker-search");
            column.append(&entry);
            column.append(&gtk::Separator::new(gtk::Orientation::Horizontal));
            entry
        });
        let empty = gtk::Label::new(spec.empty);
        empty.add_css_class("ls-picker-empty");
        empty.set_wrap(true);
        empty.set_justify(gtk::Justification::Center);
        empty.set_visible(false);
        let list = gtk::Box::new(gtk::Orientation::Vertical, 0);
        list.add_css_class("ls-picker-list");
        let scroller = gtk::ScrolledWindow::builder()
            .hscrollbar_policy(gtk::PolicyType::Never)
            .propagate_natural_height(true)
            .max_content_height(spec.max_height)
            .min_content_width(spec.width)
            .child(&list)
            .build();
        let note = gtk::Label::new(None);
        note.add_css_class("ls-meta");
        note.add_css_class("ls-picker-note");
        note.set_xalign(0.0);
        note.set_visible(false);
        column.append(&empty);
        column.append(&scroller);
        column.append(&note);

        let popover = gtk::Popover::builder().child(&column).build();
        popover.add_css_class("ls-picker");
        let button = gtk::MenuButton::builder()
            .child(&face)
            .popover(&popover)
            .always_show_arrow(true)
            .tooltip_text(spec.tooltip)
            .build();
        button.add_css_class("flat");
        button.add_css_class("ls-picker-button");

        let inner = Rc::new(Inner {
            popover: popover.clone(),
            scroller,
            list,
            empty,
            note,
            title: spec.title.map(str::to_string),
            search,
            rows: RefCell::new(Vec::new()),
            widgets: RefCell::new(Vec::new()),
            highlighted: RefCell::new(None),
            typed: RefCell::new(String::new()),
            typed_at: Cell::new(0),
            choose: Box::new(choose),
            remove: RefCell::new(None),
        });
        Inner::connect(&inner);
        inner.refresh_empty();
        Self { button, popover, label, icon, inner }
    }

    pub fn set_rows(&self, rows: Vec<Row>) {
        if *self.inner.rows.borrow() == rows {
            return;
        }
        self.inner.build(rows);
    }

    pub fn set_label(&self, text: &str) {
        self.label.set_label(text);
    }

    pub fn set_icon(&self, icon: Option<&str>) {
        match icon {
            Some(name) => {
                self.icon.set_icon_name(Some(name));
                self.icon.set_visible(true);
            }
            None => self.icon.set_visible(false),
        }
    }

    pub fn set_note(&self, note: Option<&str>) {
        self.inner.note.set_label(note.unwrap_or_default());
        self.inner.note.set_visible(note.is_some());
    }

    #[must_use]
    pub fn search_text(&self) -> String {
        self.inner.search.as_ref().map(|search| search.text().to_string()).unwrap_or_default()
    }

    pub fn set_search_text(&self, text: &str) {
        if let Some(search) = &self.inner.search {
            search.set_text(text);
        }
    }

    pub fn connect_search(&self, changed: impl Fn() + 'static) {
        if let Some(search) = &self.inner.search {
            search.connect_search_changed(move |_| changed());
        }
    }

    pub fn connect_remove(&self, remove: impl Fn(&str) + 'static) {
        self.inner.remove.replace(Some(Box::new(remove)));
    }

    pub fn popup(&self) {
        if self.button.is_visible() && self.button.is_sensitive() {
            self.button.popup();
        }
    }

    pub fn popdown(&self) {
        self.button.popdown();
    }
}

impl Inner {
    fn connect(inner: &Rc<Self>) {
        let controller = gtk::EventControllerKey::new();
        controller.set_propagation_phase(gtk::PropagationPhase::Capture);
        let weak = Rc::downgrade(inner);
        controller.connect_key_pressed(move |_, key, _, modifiers| {
            weak.upgrade().map_or(glib::Propagation::Proceed, |inner| inner.key(key, modifiers))
        });
        inner.popover.add_controller(controller);
        let weak = Rc::downgrade(inner);
        inner.popover.connect_map(move |_| {
            if let Some(inner) = weak.upgrade() {
                inner.opened();
            }
        });
    }

    fn opened(self: &Rc<Self>) {
        self.typed.borrow_mut().clear();
        self.typed_at.set(0);
        let initial = self.initial();
        self.highlight(initial, false);
        if let Some(search) = &self.search {
            search.grab_focus();
        }
        let weak = Rc::downgrade(self);
        glib::idle_add_local_once(move || {
            if let Some(inner) = weak.upgrade() {
                inner.reveal_highlighted();
            }
        });
    }

    fn key(self: &Rc<Self>, key: gdk::Key, modifiers: gdk::ModifierType) -> glib::Propagation {
        match key {
            gdk::Key::Down | gdk::Key::KP_Down => self.step(true),
            gdk::Key::Up | gdk::Key::KP_Up => self.step(false),
            gdk::Key::Return | gdk::Key::KP_Enter | gdk::Key::ISO_Enter => {
                let id = self.highlighted.borrow().clone();
                if let Some(id) = id {
                    self.activate(&id);
                }
            }
            gdk::Key::Escape => self.popover.popdown(),
            _ if self.search.is_none() => return self.type_select(key, modifiers),
            _ => return glib::Propagation::Proceed,
        }
        glib::Propagation::Stop
    }

    fn enabled_ids(&self) -> Vec<String> {
        self.rows.borrow().iter().filter(|row| !row.disabled).map(|row| row.id.clone()).collect()
    }

    fn current_index(&self, ids: &[String]) -> Option<usize> {
        let highlighted = self.highlighted.borrow();
        highlighted.as_ref().and_then(|id| ids.iter().position(|candidate| candidate == id))
    }

    fn step(&self, forward: bool) {
        let ids = self.enabled_ids();
        let Some(last) = ids.len().checked_sub(1) else { return };
        let index = match self.current_index(&ids) {
            Some(index) if forward => (index + 1).min(last),
            Some(index) => index.saturating_sub(1),
            None if forward => 0,
            None => last,
        };
        if let Some(id) = ids.get(index) {
            self.highlight(Some(id.clone()), true);
        }
    }

    fn type_select(&self, key: gdk::Key, modifiers: gdk::ModifierType) -> glib::Propagation {
        let blocked = gdk::ModifierType::CONTROL_MASK
            | gdk::ModifierType::ALT_MASK
            | gdk::ModifierType::SUPER_MASK
            | gdk::ModifierType::META_MASK;
        if modifiers.intersects(blocked) {
            return glib::Propagation::Proceed;
        }
        let Some(typed) = key.to_unicode().filter(|character| !character.is_control()) else {
            return glib::Propagation::Proceed;
        };
        let now = glib::monotonic_time();
        let prefix = {
            let mut buffer = self.typed.borrow_mut();
            if now - self.typed_at.get() > TYPE_AHEAD_US {
                buffer.clear();
            }
            buffer.extend(typed.to_lowercase());
            buffer.clone()
        };
        self.typed_at.set(now);
        let ids = self.enabled_ids();
        let single = prefix.chars().count() == 1;
        let start = self.current_index(&ids).map_or(0, |index| if single { index + 1 } else { index }).min(ids.len());
        let found = {
            let all = self.rows.borrow();
            ids.iter()
                .skip(start)
                .chain(ids.iter().take(start))
                .find(|id| all.iter().any(|row| &row.id == *id && row.title.to_lowercase().starts_with(&prefix)))
                .cloned()
        };
        if found.is_some() {
            self.highlight(found, true);
        }
        glib::Propagation::Stop
    }

    fn activate(&self, id: &str) {
        let enabled = self.rows.borrow().iter().any(|row| row.id == id && !row.disabled);
        if !enabled {
            return;
        }
        self.popover.popdown();
        (self.choose)(id);
    }

    fn initial(&self) -> Option<String> {
        let all = self.rows.borrow();
        all.iter()
            .find(|row| row.checked && !row.disabled)
            .or_else(|| all.iter().find(|row| !row.disabled))
            .map(|row| row.id.clone())
    }

    fn highlight(&self, id: Option<String>, reveal: bool) {
        {
            let all = self.rows.borrow();
            let shown = self.widgets.borrow();
            for (row, widget) in all.iter().zip(shown.iter()) {
                if id.as_deref() == Some(row.id.as_str()) {
                    widget.add_css_class("highlighted");
                    if reveal {
                        self.reveal(widget);
                    }
                } else {
                    widget.remove_css_class("highlighted");
                }
            }
        }
        self.highlighted.replace(id);
    }

    fn reveal_highlighted(&self) {
        let highlighted = self.highlighted.borrow().clone();
        let Some(id) = highlighted else { return };
        let all = self.rows.borrow();
        let shown = self.widgets.borrow();
        if let Some((_, widget)) = all.iter().zip(shown.iter()).find(|(row, _)| row.id == id) {
            self.reveal(widget);
        }
    }

    fn reveal(&self, widget: &gtk::Box) {
        let Some(bounds) = widget.compute_bounds(&self.list) else { return };
        let adjustment = self.scroller.vadjustment();
        let top = f64::from(bounds.y());
        let bottom = top + f64::from(bounds.height());
        let (value, page) = (adjustment.value(), adjustment.page_size());
        if top < value {
            adjustment.set_value(top);
        } else if bottom > value + page {
            adjustment.set_value(bottom - page);
        }
    }

    fn refresh_empty(&self) {
        let empty = self.rows.borrow().is_empty();
        self.empty.set_visible(empty && !self.empty.label().is_empty());
        self.scroller.set_visible(!empty);
    }

    fn build(self: &Rc<Self>, items: Vec<Row>) {
        while let Some(child) = self.list.first_child() {
            self.list.remove(&child);
        }
        let mut built = Vec::with_capacity(items.len());
        if let Some(title) = &self.title {
            self.list.append(&header(title, true));
        }
        let mut started = false;
        let mut current: Option<&str> = None;
        for row in &items {
            let section = row.section.as_deref();
            if !started || section != current {
                match section {
                    Some(text) => self.list.append(&header(text, !started && self.title.is_none())),
                    None if started => {
                        let separator = gtk::Separator::new(gtk::Orientation::Horizontal);
                        separator.add_css_class("ls-picker-separator");
                        self.list.append(&separator);
                    }
                    None => {}
                }
                started = true;
                current = section;
            }
            let widget = self.row_widget(row);
            self.list.append(&widget);
            built.push(widget);
        }
        let previous = self.highlighted.borrow().clone();
        let searching = self.search.as_ref().is_some_and(|search| !search.text().is_empty());
        self.rows.replace(items);
        self.widgets.replace(built);
        self.refresh_empty();
        let ids = self.enabled_ids();
        let kept = previous.filter(|id| !searching && ids.contains(id));
        let next = if searching { ids.first().cloned() } else { kept.or_else(|| self.initial()) };
        self.highlight(next, false);
    }

    fn row_widget(self: &Rc<Self>, row: &Row) -> gtk::Box {
        let widget = gtk::Box::new(gtk::Orientation::Horizontal, 8);
        widget.add_css_class("ls-picker-row");
        let tall = row.subtitle.is_some();
        if tall {
            widget.add_css_class("tall");
        }
        if row.checked {
            widget.add_css_class("checked");
        }
        if row.destructive {
            widget.add_css_class("destructive");
        }
        widget.set_sensitive(!row.disabled);
        if let Some(icon) = row.icon {
            let image = gtk::Image::from_icon_name(icon);
            image.add_css_class("ls-picker-icon");
            image.set_valign(if tall { gtk::Align::Start } else { gtk::Align::Center });
            widget.append(&image);
        }
        widget.append(&labels(row));
        if let Some(detail) = &row.detail {
            let label = gtk::Label::new(Some(detail.as_str()));
            label.add_css_class("ls-picker-detail");
            widget.append(&label);
        }
        let check = gtk::Image::from_icon_name("object-select-symbolic");
        check.add_css_class("ls-picker-check");
        check.set_opacity(if row.checked { 1.0 } else { 0.0 });
        widget.append(&check);
        if row.removable {
            widget.append(&self.remove_button(&row.id));
        }
        let click = gtk::GestureClick::new();
        let weak = Rc::downgrade(self);
        let id = row.id.clone();
        click.connect_released(move |_, _, _, _| {
            if let Some(inner) = weak.upgrade() {
                inner.activate(&id);
            }
        });
        widget.add_controller(click);
        if !row.disabled {
            let motion = gtk::EventControllerMotion::new();
            let weak = Rc::downgrade(self);
            let id = row.id.clone();
            motion.connect_motion(move |_, _, _| {
                let Some(inner) = weak.upgrade() else { return };
                let current = inner.highlighted.borrow().as_deref() == Some(id.as_str());
                if !current {
                    inner.highlight(Some(id.clone()), false);
                }
            });
            widget.add_controller(motion);
        }
        widget
    }

    fn remove_button(self: &Rc<Self>, id: &str) -> gtk::Button {
        let button = gtk::Button::builder()
            .icon_name("window-close-symbolic")
            .tooltip_text("Discard")
            .valign(gtk::Align::Center)
            .focusable(false)
            .focus_on_click(false)
            .build();
        button.add_css_class("flat");
        button.add_css_class("ls-picker-remove");
        let weak = Rc::downgrade(self);
        let id = id.to_string();
        button.connect_clicked(move |_| {
            let Some(inner) = weak.upgrade() else { return };
            let handler = inner.remove.borrow();
            if let Some(remove) = handler.as_ref() {
                remove(id.as_str());
            }
        });
        button
    }
}

fn labels(row: &Row) -> gtk::Box {
    let labels = gtk::Box::new(gtk::Orientation::Vertical, 1);
    labels.set_hexpand(true);
    labels.set_valign(gtk::Align::Center);
    let title = gtk::Label::new(Some(row.title.as_str()));
    title.add_css_class("ls-picker-title");
    title.set_xalign(0.0);
    title.set_ellipsize(pango::EllipsizeMode::Middle);
    labels.append(&title);
    if let Some(subtitle) = &row.subtitle {
        let text = gtk::Label::new(Some(subtitle.as_str()));
        text.add_css_class("ls-picker-subtitle");
        text.set_xalign(0.0);
        text.set_wrap(true);
        text.set_wrap_mode(pango::WrapMode::WordChar);
        text.set_lines(2);
        text.set_ellipsize(pango::EllipsizeMode::End);
        labels.append(&text);
    }
    labels
}

fn header(text: &str, first: bool) -> gtk::Label {
    let label = gtk::Label::new(Some(text));
    label.add_css_class("ls-picker-header");
    if first {
        label.add_css_class("first");
    }
    label.set_xalign(0.0);
    label
}

pub fn projects(app: &Weak<App>) -> Picker {
    let weak = app.clone();
    let picker = Picker::new(&Spec { tooltip: "Project", width: 300, ..Spec::default() }, move |id| {
        let Some(app) = weak.upgrade() else { return };
        if id == ADD_PROJECT {
            app.add_project();
            return;
        }
        app.state.borrow_mut().draft_project = (id != NO_PROJECT).then(|| id.to_string());
        app.branches.reset();
        app.render(Dirty::all());
    });
    picker.set_icon(Some("folder-symbolic"));
    picker
}

pub fn render_projects(picker: &Picker, state: &State) {
    let current = state.draft_project.as_deref();
    let home = glib::home_dir();
    let mut rows: Vec<Row> = state
        .projects
        .iter()
        .map(|project| {
            Row::new(&project.id, &project.name)
                .icon("folder-symbolic")
                .subtitle(tilde(&home, &project.path))
                .checked(current == Some(project.id.as_str()))
                .section("Projects")
        })
        .collect();
    rows.push(
        Row::new(NO_PROJECT, "No project")
            .icon("action-unavailable-symbolic")
            .checked(current.is_none())
            .section("Projects"),
    );
    rows.push(Row::new(ADD_PROJECT, "Add Project…").icon("list-add-symbolic"));
    picker.set_rows(rows);
    let name = current.and_then(|project| state.project_name(Some(project)));
    picker.set_label(name.as_deref().unwrap_or("No project"));
}

fn tilde(home: &Path, path: &str) -> String {
    Path::new(path).strip_prefix(home).map_or_else(|_| path.to_string(), |rest| format!("~/{}", rest.display()))
}
