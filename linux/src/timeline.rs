use std::cell::{Cell, Ref, RefCell};
use std::collections::HashSet;
use std::rc::{Rc, Weak};

use adw::prelude::*;
use gtk::{gio, glib};
use local_studio_core::{Block, FileChange, Item, ItemKind, TranscriptOp};

use crate::app::App;
use crate::format::{self, Markdown};

const THINKING_KEY: u64 = 1 << 63;
const DETAIL_LIMIT: usize = 6_000;

pub struct Timeline {
    pub root: gtk::Overlay,
    minimap: gtk::DrawingArea,
    store: gio::ListStore,
    items: RefCell<Vec<Item>>,
    hidden: Rc<RefCell<HashSet<u64>>>,
    expanded: Rc<RefCell<HashSet<u64>>>,
    filter: gtk::CustomFilter,
    follow: Rc<Cell<bool>>,
    list: gtk::ListView,
    width: Rc<Cell<i32>>,
    cursor: Rc<Cell<Option<u64>>>,
    ring: Rc<Cell<bool>>,
}

impl Timeline {
    #[allow(clippy::too_many_lines)]
    pub fn new(app: Weak<App>) -> Self {
        let store = gio::ListStore::new::<glib::BoxedAnyObject>();
        let hidden: Rc<RefCell<HashSet<u64>>> = Rc::default();
        let expanded: Rc<RefCell<HashSet<u64>>> = Rc::default();
        let filter_hidden = Rc::clone(&hidden);
        let filter = gtk::CustomFilter::new(move |object| {
            object
                .downcast_ref::<glib::BoxedAnyObject>()
                .is_none_or(|object| !filter_hidden.borrow().contains(&object.borrow::<Item>().id))
        });
        let filtered = gtk::FilterListModel::new(Some(store.clone()), Some(filter.clone()));
        let factory = gtk::SignalListItemFactory::new();
        factory.connect_setup(|_, object| {
            let Some(item) = object.downcast_ref::<gtk::ListItem>() else { return };
            let clamp = adw::Clamp::builder().maximum_size(820).tightening_threshold(640).build();
            clamp.set_margin_start(20);
            clamp.set_margin_end(20);
            item.set_child(Some(&clamp));
            item.set_activatable(false);
            item.set_focusable(false);
        });
        let bind_expanded = Rc::clone(&expanded);
        let width = Rc::new(Cell::new(820));
        let bind_width = Rc::clone(&width);
        let cursor: Rc<Cell<Option<u64>>> = Rc::default();
        let ring: Rc<Cell<bool>> = Rc::default();
        let (bind_cursor, bind_ring) = (Rc::clone(&cursor), Rc::clone(&ring));
        let keyboard = app.clone();
        factory.connect_bind(move |_, object| {
            let Some(item) = object.downcast_ref::<gtk::ListItem>() else { return };
            let Some(clamp) = item.child().and_downcast::<adw::Clamp>() else { return };
            let Some(entry) = item.item().and_downcast::<glib::BoxedAnyObject>() else { return };
            let entry = entry.borrow::<Item>();
            clamp.set_maximum_size(bind_width.get());
            let widget = item_widget(&app, &entry, &bind_expanded.borrow());
            if bind_ring.get() && bind_cursor.get() == Some(entry.id) {
                widget.add_css_class("ls-focus-ring");
            }
            clamp.set_child(Some(&widget));
        });
        let list = gtk::ListView::new(Some(gtk::NoSelection::new(Some(filtered))), Some(factory));
        list.add_css_class("ls-timeline");
        list.set_focusable(true);
        install_keys(&keyboard, &list);
        list.set_margin_top(12);
        list.set_margin_bottom(12);
        let scroller =
            gtk::ScrolledWindow::builder().hscrollbar_policy(gtk::PolicyType::Never).vexpand(true).child(&list).build();
        let follow = Rc::new(Cell::new(true));
        let pill = gtk::Button::builder().tooltip_text("Scroll to End").build();
        let pill_box = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        pill_box.append(&gtk::Image::from_icon_name("go-down-symbolic"));
        pill_box.append(&gtk::Label::new(Some("Scroll to end")));
        pill.set_child(Some(&pill_box));
        pill.add_css_class("osd");
        pill.add_css_class("pill");
        pill.add_css_class("ls-scroll-pill");
        pill.set_halign(gtk::Align::Center);
        pill.set_valign(gtk::Align::End);
        pill.set_margin_bottom(14);
        pill.set_visible(false);
        let adjustment = scroller.vadjustment();
        let watch = Rc::clone(&follow);
        let shown = pill.clone();
        adjustment.connect_value_changed(move |adjustment| {
            let at_end = adjustment.value() + adjustment.page_size() >= adjustment.upper() - 48.0;
            watch.set(at_end);
            shown.set_visible(!at_end && adjustment.upper() > adjustment.page_size() * 1.2);
        });
        let stick = Rc::clone(&follow);
        adjustment.connect_upper_notify(move |adjustment| {
            if stick.get() {
                adjustment.set_value(adjustment.upper() - adjustment.page_size());
            }
        });
        let (jump, resume) = (list.clone(), Rc::clone(&follow));
        pill.connect_clicked(move |pill| {
            resume.set(true);
            pill.set_visible(false);
            let count = jump.model().map_or(0, |model| model.n_items());
            if count > 0 {
                jump.scroll_to(count - 1, gtk::ListScrollFlags::NONE, None);
            }
        });
        let minimap = minimap(&list, &scroller);
        let root = gtk::Overlay::new();
        root.set_child(Some(&scroller));
        root.add_overlay(&pill);
        root.add_overlay(&minimap.0);
        let minimap = minimap.1;
        Self {
            root,
            minimap,
            store,
            items: RefCell::new(Vec::new()),
            hidden,
            expanded,
            filter,
            follow,
            list,
            width,
            cursor,
            ring,
        }
    }

    pub fn refresh_minimap(&self) {
        self.minimap.queue_draw();
    }

    pub fn set_width(&self, width: i32) {
        if self.width.replace(width) != width {
            let count = self.store.n_items();
            self.store.items_changed(0, count, count);
        }
    }

    pub fn recolor(&self) {
        let objects: Vec<glib::BoxedAnyObject> =
            self.items.borrow().iter().map(|item| glib::BoxedAnyObject::new(item.clone())).collect();
        self.store.splice(0, self.store.n_items(), &objects);
    }

    pub fn scroll_to_start(&self) {
        self.follow.set(false);
        let list = self.list.clone();
        glib::timeout_add_local_once(std::time::Duration::from_millis(250), move || {
            list.scroll_to(0, gtk::ListScrollFlags::NONE, None);
        });
    }

    fn scroll_to_end(&self) {
        let list = self.list.clone();
        glib::idle_add_local_once(move || {
            let count = list.model().map_or(0, |model| model.n_items());
            if count > 0 {
                list.scroll_to(count - 1, gtk::ListScrollFlags::NONE, None);
            }
        });
    }

    pub fn visible_text(&self) -> String {
        let items = self.items.borrow();
        let texts: Vec<String> = items
            .iter()
            .rev()
            .filter_map(|item| match &item.kind {
                ItemKind::User { text, .. } => Some(format!("User: {text}")),
                ItemKind::Assistant { blocks, .. } => {
                    let text: Vec<&str> = blocks
                        .iter()
                        .filter_map(|block| match block {
                            Block::Text { text } => Some(text.as_str()),
                            Block::Thinking { .. } => None,
                        })
                        .collect();
                    (!text.is_empty()).then(|| format!("Assistant: {}", text.join("\n")))
                }
                _ => None,
            })
            .take(6)
            .collect();
        texts.into_iter().rev().collect::<Vec<_>>().join("\n\n")
    }

    pub fn items(&self) -> Ref<'_, Vec<Item>> {
        self.items.borrow()
    }

    pub fn clear(&self) {
        self.store.remove_all();
        self.items.borrow_mut().clear();
        self.hidden.borrow_mut().clear();
        self.expanded.borrow_mut().clear();
        self.follow.set(true);
        self.cursor.set(None);
    }

    pub fn focus_list(&self, window: &adw::ApplicationWindow) {
        let ids = self.visible_ids();
        if !self.cursor.get().is_some_and(|cursor| ids.contains(&cursor)) {
            let last = ids.last().copied();
            let previous = self.cursor.replace(last);
            self.refresh_item(previous);
            self.refresh_item(last);
        }
        self.set_ring(true);
        gtk::prelude::RootExt::set_focus(window, Some(&self.list));
        self.scroll_to_cursor(&ids);
    }

    pub fn set_ring(&self, on: bool) {
        if self.ring.replace(on) != on {
            self.refresh_item(self.cursor.get());
        }
    }

    pub fn move_cursor(&self, offset: isize) {
        let ids = self.visible_ids();
        let Some(last) = ids.len().checked_sub(1) else { return };
        let next = match self.cursor.get().and_then(|cursor| ids.iter().position(|id| *id == cursor)) {
            Some(index) => index.saturating_add_signed(offset).min(last),
            None => last,
        };
        self.set_cursor(ids[next], &ids);
    }

    pub fn cursor_edge(&self, top: bool) {
        let ids = self.visible_ids();
        let target = if top { ids.first() } else { ids.last() };
        if let Some(target) = target.copied() {
            self.set_cursor(target, &ids);
        }
    }

    pub fn activate_cursor(&self) {
        let Some(cursor) = self.cursor.get() else { return };
        let foldable =
            self.items.borrow().iter().any(|item| {
                item.id == cursor && matches!(item.kind, ItemKind::TurnSummary { .. } | ItemKind::Tool { .. })
            });
        if foldable {
            self.toggle(cursor);
        }
    }

    pub fn cursor_text(&self) -> String {
        let Some(cursor) = self.cursor.get() else { return String::new() };
        let items = self.items.borrow();
        items.iter().find(|item| item.id == cursor).map(|item| copy_text(&item.kind)).unwrap_or_default()
    }

    fn visible_ids(&self) -> Vec<u64> {
        let Some(model) = self.list.model() else { return Vec::new() };
        (0..model.n_items())
            .filter_map(|position| {
                model.item(position).and_downcast::<glib::BoxedAnyObject>().map(|object| object.borrow::<Item>().id)
            })
            .collect()
    }

    fn set_cursor(&self, id: u64, ids: &[u64]) {
        let previous = self.cursor.replace(Some(id));
        if previous != Some(id) {
            self.refresh_item(previous);
            self.refresh_item(Some(id));
        }
        self.scroll_to_cursor(ids);
    }

    fn refresh_item(&self, id: Option<u64>) {
        let Some(id) = id else { return };
        let found = self.items.try_borrow().ok().and_then(|items| {
            items.iter().position(|item| item.id == id).map(|position| (position, items[position].clone()))
        });
        if let Some((position, item)) = found {
            if let Ok(position) = u32::try_from(position) {
                self.store.splice(position, 1, &[glib::BoxedAnyObject::new(item)]);
            }
        }
    }

    fn scroll_to_cursor(&self, ids: &[u64]) {
        let Some(cursor) = self.cursor.get() else { return };
        let position = ids.iter().position(|id| *id == cursor).and_then(|position| u32::try_from(position).ok());
        if let Some(position) = position {
            self.list.scroll_to(position, gtk::ListScrollFlags::NONE, None);
        }
    }

    pub fn apply(&self, op: TranscriptOp) {
        match op {
            TranscriptOp::Reset { items } => {
                let objects: Vec<glib::BoxedAnyObject> =
                    items.iter().map(|item| glib::BoxedAnyObject::new(item.clone())).collect();
                *self.items.borrow_mut() = items;
                self.refold(true);
                self.store.splice(0, self.store.n_items(), &objects);
                self.follow.set(true);
                self.scroll_to_end();
            }
            TranscriptOp::Insert { index, item } => {
                let summary = matches!(item.kind, ItemKind::TurnSummary { .. });
                let position = {
                    let mut items = self.items.borrow_mut();
                    let position = usize::try_from(index).unwrap_or(usize::MAX).min(items.len());
                    items.insert(position, item.clone());
                    position
                };
                self.store.insert(u32::try_from(position).unwrap_or(u32::MAX), &glib::BoxedAnyObject::new(item));
                if summary {
                    self.refold(false);
                }
                if self.follow.get() {
                    self.scroll_to_end();
                }
            }
            TranscriptOp::Update { index, item } => {
                let position = usize::try_from(index).unwrap_or(usize::MAX);
                {
                    let mut items = self.items.borrow_mut();
                    let Some(slot) = items.get_mut(position) else { return };
                    *slot = item.clone();
                }
                self.store.splice(u32::try_from(position).unwrap_or(u32::MAX), 1, &[glib::BoxedAnyObject::new(item)]);
            }
        }
    }

    pub fn toggle(&self, key: u64) {
        {
            let mut expanded = self.expanded.borrow_mut();
            if !expanded.remove(&key) {
                expanded.insert(key);
            }
        }
        let id = key & !THINKING_KEY;
        let position = self.items.borrow().iter().position(|item| item.id == id);
        let summary = self
            .items
            .borrow()
            .get(position.unwrap_or(usize::MAX))
            .is_some_and(|item| matches!(item.kind, ItemKind::TurnSummary { .. }));
        if summary {
            self.follow.set(false);
            self.refold(false);
        }
        if let Some(position) = position {
            let item = self.items.borrow()[position].clone();
            self.store.splice(u32::try_from(position).unwrap_or(u32::MAX), 1, &[glib::BoxedAnyObject::new(item)]);
        }
    }

    fn refold(&self, quiet: bool) {
        let items = self.items.borrow();
        let expanded = self.expanded.borrow();
        let mut hidden = HashSet::new();
        for (index, item) in items.iter().enumerate() {
            let ItemKind::TurnSummary { turn, .. } = item.kind else { continue };
            if expanded.contains(&item.id) {
                continue;
            }
            for previous in items[..index].iter().rev() {
                if previous.turn != turn || matches!(previous.kind, ItemKind::User { .. }) {
                    break;
                }
                hidden.insert(previous.id);
            }
        }
        drop(items);
        drop(expanded);
        if *self.hidden.borrow() != hidden {
            *self.hidden.borrow_mut() = hidden;
            if !quiet {
                self.filter.changed(gtk::FilterChange::Different);
            }
        }
    }
}

fn item_widget(app: &Weak<App>, item: &Item, expanded: &HashSet<u64>) -> gtk::Widget {
    let widget: gtk::Widget = match &item.kind {
        ItemKind::User { text, images, entry, thumbnails } => {
            user_widget(app, text, *images, entry.as_deref(), thumbnails)
        }
        ItemKind::Assistant { blocks, streaming, error, changed_files } => {
            assistant_widget(app, item.id, blocks, *streaming, error.as_deref(), changed_files, expanded)
        }
        ItemKind::Tool { name, kind, summary, arguments, state, output, file_change, started_at, ended_at, .. } => {
            let title = if summary.is_empty() { name.as_str() } else { summary.as_str() };
            let elapsed = started_at.zip(*ended_at).map(|(start, end)| u64::try_from(end - start).unwrap_or(0));
            let open = expanded.contains(&item.id);
            let header = toggle_row(app, item.id, format::tool_icon(*kind), title, open, "ls-tool");
            if let Some((icon, class)) = format::tool_state(*state) {
                header.1.insert_child_after(&small_icon(icon, class), Some(&header.2));
            }
            if let Some(change) = file_change {
                header.1.insert_child_after(&diff_stat(change.additions, change.deletions), Some(&header.2));
            }
            if let Some(elapsed) = elapsed.filter(|elapsed| *elapsed >= 1_000) {
                let label = gtk::Label::new(Some(&format::duration(elapsed)));
                label.add_css_class("ls-meta");
                header.1.insert_child_after(&label, Some(&header.2));
            }
            let column = gtk::Box::new(gtk::Orientation::Vertical, 0);
            column.append(&header.0);
            if open {
                let mut detail = String::new();
                if !arguments.is_empty() {
                    detail.push_str(arguments.trim());
                }
                if let Some(change) = file_change.as_ref().filter(|change| !change.diff.is_empty()) {
                    detail.push_str("\n\n");
                    detail.push_str(change.diff.trim_end());
                } else if !output.is_empty() {
                    if !detail.is_empty() {
                        detail.push_str("\n\n");
                    }
                    detail.push_str(output.trim_end());
                }
                column.append(&detail_box(&detail));
            }
            column.upcast()
        }
        ItemKind::TurnSummary { duration_ms, tool_count, .. } => {
            let open = expanded.contains(&item.id);
            let worked = format!("Worked for {}", format::duration(*duration_ms));
            let label = match tool_count {
                0 => worked,
                1 => format!("{worked} · 1 tool"),
                count => format!("{worked} · {count} tools"),
            };
            let (button, _, _) = toggle_row(app, item.id, "", &label, open, "ls-summary");
            button.set_halign(gtk::Align::Start);
            button.upcast()
        }
        ItemKind::Notice { level, text } => {
            let (icon, class) = format::notice(*level);
            let row = gtk::Box::new(gtk::Orientation::Horizontal, 8);
            row.append(&small_icon(icon, class));
            let label = wrapped_label(&format::escape(text));
            label.add_css_class(class);
            row.append(&label);
            row.upcast()
        }
        ItemKind::Compaction { summary, tokens_before } => {
            let row = gtk::Box::new(gtk::Orientation::Horizontal, 10);
            row.add_css_class("ls-divider");
            let left = gtk::Separator::new(gtk::Orientation::Horizontal);
            left.set_hexpand(true);
            left.set_valign(gtk::Align::Center);
            let right = gtk::Separator::new(gtk::Orientation::Horizontal);
            right.set_hexpand(true);
            right.set_valign(gtk::Align::Center);
            let label =
                gtk::Label::new(Some(&format!("Context compacted · {} tokens", format::tokens(*tokens_before))));
            label.set_tooltip_text(Some(summary));
            row.append(&left);
            row.append(&small_icon("view-restore-symbolic", "dim-label"));
            row.append(&label);
            row.append(&right);
            row.upcast()
        }
    };
    widget.set_margin_top(4);
    widget.set_margin_bottom(4);
    widget
}

fn user_widget(
    app: &Weak<App>,
    text: &str,
    images: u32,
    entry: Option<&str>,
    thumbnails: &[local_studio_core::ImageThumbnail],
) -> gtk::Widget {
    let column = gtk::Box::new(gtk::Orientation::Vertical, 2);
    column.add_css_class("ls-user-row");
    column.set_margin_top(10);
    let bubble = gtk::Label::new(Some(text));
    bubble.add_css_class("ls-bubble");
    bubble.set_wrap(true);
    bubble.set_wrap_mode(gtk::pango::WrapMode::WordChar);
    bubble.set_xalign(0.0);
    bubble.set_selectable(true);
    bubble.set_max_width_chars(64);
    bubble.set_halign(gtk::Align::End);
    column.append(&bubble);
    if !thumbnails.is_empty() {
        let strip = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        strip.set_halign(gtk::Align::End);
        for (index, thumbnail) in thumbnails.iter().enumerate() {
            let Ok(texture) = gtk::gdk::Texture::from_bytes(&glib::Bytes::from(&thumbnail.data)) else { continue };
            let picture = gtk::Picture::for_paintable(&texture);
            picture.set_content_fit(gtk::ContentFit::Cover);
            picture.set_size_request(72, 72);
            picture.add_css_class("ls-thumb");
            let button = gtk::Button::builder().child(&picture).tooltip_text("Open Image").build();
            button.add_css_class("flat");
            button.add_css_class("ls-thumb-button");
            let (weak, entry) = (app.clone(), entry.map(str::to_string));
            button.connect_clicked(move |_| {
                let (Some(app), Some(entry)) = (weak.upgrade(), entry.clone()) else { return };
                let Some(thread) = app.state.borrow().selected.clone() else { return };
                let request = app.ask(crate::app::Target::MessageImage);
                let index = u32::try_from(index).unwrap_or(0);
                app.core.run(|studio| studio.load_message_image(request, thread, entry, index));
            });
            strip.append(&button);
        }
        column.append(&strip);
    } else if images > 0 {
        let label = gtk::Label::new(Some(&format!("{images} image{}", if images == 1 { "" } else { "s" })));
        label.add_css_class("ls-meta");
        label.set_halign(gtk::Align::End);
        column.append(&label);
    }
    let actions = gtk::Box::new(gtk::Orientation::Horizontal, 2);
    actions.add_css_class("ls-row-actions");
    actions.set_halign(gtk::Align::End);
    let copy = gtk::Button::builder().icon_name("edit-copy-symbolic").tooltip_text("Copy").build();
    copy.add_css_class("flat");
    let copied = text.to_string();
    copy.connect_clicked(move |button| button.clipboard().set_text(&copied));
    actions.append(&copy);
    if let Some(entry) = entry {
        let edit = gtk::Button::builder().icon_name("edit-undo-symbolic").tooltip_text("Edit from Here").build();
        edit.add_css_class("flat");
        let weak = app.clone();
        let entry = entry.to_string();
        edit.connect_clicked(move |_| {
            let Some(app) = weak.upgrade() else { return };
            let thread = app.state.borrow().selected.clone();
            if let Some(thread) = thread {
                let entry = entry.clone();
                app.core.run(|studio| studio.edit_from_here(thread, entry));
            }
        });
        actions.append(&edit);
    }
    column.append(&actions);
    column.upcast()
}

fn assistant_widget(
    app: &Weak<App>,
    id: u64,
    blocks: &[Block],
    streaming: bool,
    error: Option<&str>,
    changed_files: &[FileChange],
    expanded: &HashSet<u64>,
) -> gtk::Widget {
    let column = gtk::Box::new(gtk::Orientation::Vertical, 8);
    column.add_css_class("ls-assistant");
    let mut has_text = false;
    for block in blocks {
        match block {
            Block::Thinking { text } => {
                if text.trim().is_empty() {
                    continue;
                }
                let key = id | THINKING_KEY;
                let open = expanded.contains(&key);
                let preview = if streaming && !has_text {
                    "Thinking".to_string()
                } else {
                    let first = text.lines().find(|line| !line.trim().is_empty()).unwrap_or_default().trim();
                    format!("Thought · {first}")
                };
                let (button, _, _) = toggle_row(app, key, "", &preview, open, "ls-summary");
                button.set_halign(gtk::Align::Fill);
                column.append(&button);
                if open {
                    let label = wrapped_label(&format::escape(text.trim()));
                    label.add_css_class("ls-thinking");
                    label.set_margin_start(10);
                    column.append(&label);
                }
            }
            Block::Text { text } => {
                if text.trim().is_empty() {
                    continue;
                }
                has_text = true;
                for block in format::markdown(text) {
                    column.append(&markdown_widget(block));
                }
            }
        }
    }
    if let Some(error) = error {
        let label = wrapped_label(&format::escape(error));
        label.add_css_class("error");
        column.append(&label);
    } else if !has_text && !streaming && blocks.iter().all(|block| matches!(block, Block::Text { .. })) {
        let label = gtk::Label::new(Some("(empty response)"));
        label.add_css_class("dim-label");
        label.set_xalign(0.0);
        column.append(&label);
    }
    if !changed_files.is_empty() {
        column.append(&changed_files_card(changed_files));
    }
    column.upcast()
}

pub fn markdown_widget(block: Markdown) -> gtk::Widget {
    match block {
        Markdown::Paragraph(markup) => wrapped_label(&markup).upcast(),
        Markdown::Heading(level, markup) => {
            let label = wrapped_label(&markup);
            label.add_css_class("heading");
            if level <= 2 {
                label.add_css_class("title-4");
            }
            label.upcast()
        }
        Markdown::Bullet(marker, markup) => {
            let row = gtk::Box::new(gtk::Orientation::Horizontal, 8);
            row.set_margin_start(6);
            let marker = gtk::Label::new(Some(&marker));
            marker.set_valign(gtk::Align::Start);
            marker.add_css_class("dim-label");
            row.append(&marker);
            row.append(&wrapped_label(&markup));
            row.upcast()
        }
        Markdown::Quote(markup) => {
            let label = wrapped_label(&markup);
            label.add_css_class("dim-label");
            label.set_margin_start(12);
            label.upcast()
        }
        Markdown::Code(language, code) => {
            let frame = gtk::Box::new(gtk::Orientation::Vertical, 4);
            frame.add_css_class("ls-code");
            if let Some(language) = &language {
                let label = gtk::Label::new(Some(language.as_str()));
                label.add_css_class("ls-meta");
                label.set_xalign(0.0);
                frame.append(&label);
            }
            let label = gtk::Label::new(None);
            let syntax = crate::colors::current().syntax;
            let weak = label.downgrade();
            let ready = move |segments: crate::highlight::Segments| {
                if let Some(label) = weak.upgrade() {
                    label.set_markup(&crate::highlight::markup(&segments, &crate::colors::current().syntax));
                }
            };
            match crate::highlight::segments(&code, language.as_deref(), None, ready) {
                Some(segments) => label.set_markup(&crate::highlight::markup(&segments, &syntax)),
                None => label.set_markup(&crate::highlight::plain(&code, &syntax)),
            }
            label.set_xalign(0.0);
            label.set_selectable(true);
            label.add_css_class("ls-mono");
            let scroller = gtk::ScrolledWindow::builder()
                .vscrollbar_policy(gtk::PolicyType::Never)
                .propagate_natural_height(true)
                .child(&label)
                .build();
            frame.append(&scroller);
            frame.upcast()
        }
        Markdown::Rule => gtk::Separator::new(gtk::Orientation::Horizontal).upcast(),
    }
}

fn changed_files_card(files: &[FileChange]) -> gtk::Widget {
    let card = gtk::Box::new(gtk::Orientation::Vertical, 4);
    card.add_css_class("ls-code");
    let additions: u32 = files.iter().map(|file| file.additions).sum();
    let deletions: u32 = files.iter().map(|file| file.deletions).sum();
    let header = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    let title =
        gtk::Label::new(Some(&format!("{} file{} changed", files.len(), if files.len() == 1 { "" } else { "s" })));
    title.add_css_class("heading");
    title.set_xalign(0.0);
    title.set_hexpand(true);
    header.append(&title);
    header.append(&diff_stat(additions, deletions));
    card.append(&header);
    for file in files {
        let row = gtk::Box::new(gtk::Orientation::Horizontal, 8);
        let path = gtk::Label::new(Some(&file.path));
        path.add_css_class("ls-mono");
        path.set_xalign(0.0);
        path.set_hexpand(true);
        path.set_ellipsize(gtk::pango::EllipsizeMode::Start);
        row.append(&path);
        row.append(&diff_stat(file.additions, file.deletions));
        card.append(&row);
    }
    card.upcast()
}

pub fn diff_stat(additions: u32, deletions: u32) -> gtk::Box {
    let row = gtk::Box::new(gtk::Orientation::Horizontal, 4);
    let add = gtk::Label::new(Some(&format!("+{additions}")));
    add.add_css_class("ls-add");
    let del = gtk::Label::new(Some(&format!("−{deletions}")));
    del.add_css_class("ls-del");
    row.append(&add);
    row.append(&del);
    row
}

fn toggle_row(
    app: &Weak<App>,
    key: u64,
    icon: &str,
    text: &str,
    open: bool,
    class: &str,
) -> (gtk::Button, gtk::Box, gtk::Label) {
    let row = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    if !icon.is_empty() {
        row.append(&small_icon(icon, "dim-label"));
    }
    let label = gtk::Label::new(Some(text));
    label.set_xalign(0.0);
    label.set_ellipsize(gtk::pango::EllipsizeMode::End);
    label.set_hexpand(true);
    row.append(&label);
    row.append(&small_icon(if open { "pan-down-symbolic" } else { "pan-end-symbolic" }, "dim-label"));
    let button = gtk::Button::builder().child(&row).build();
    button.add_css_class("flat");
    button.add_css_class(class);
    let weak = app.clone();
    button.connect_clicked(move |_| {
        if let Some(app) = weak.upgrade() {
            app.timeline.toggle(key);
        }
    });
    (button, row, label)
}

fn detail_box(text: &str) -> gtk::Widget {
    let text = if text.len() > DETAIL_LIMIT {
        let mut end = DETAIL_LIMIT;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}\n…", &text[..end])
    } else {
        text.to_string()
    };
    let label = gtk::Label::new(Some(&text));
    label.set_xalign(0.0);
    label.set_yalign(0.0);
    label.set_selectable(true);
    label.set_wrap(true);
    label.set_wrap_mode(gtk::pango::WrapMode::WordChar);
    label.add_css_class("ls-mono");
    let scroller = gtk::ScrolledWindow::builder()
        .hscrollbar_policy(gtk::PolicyType::Never)
        .propagate_natural_height(true)
        .max_content_height(320)
        .child(&label)
        .build();
    scroller.add_css_class("ls-tool-detail");
    scroller.upcast()
}

fn wrapped_label(markup: &str) -> gtk::Label {
    let label = gtk::Label::new(None);
    label.set_markup(markup);
    label.set_wrap(true);
    label.set_wrap_mode(gtk::pango::WrapMode::WordChar);
    label.set_xalign(0.0);
    label.set_selectable(true);
    label.set_hexpand(true);
    label
}

fn user_positions(list: &gtk::ListView) -> (Vec<u32>, u32) {
    let Some(model) = list.model() else { return (Vec::new(), 0) };
    let count = model.n_items();
    let users = (0..count)
        .filter(|index| {
            model
                .item(*index)
                .and_downcast::<glib::BoxedAnyObject>()
                .is_some_and(|object| matches!(object.borrow::<Item>().kind, ItemKind::User { .. }))
        })
        .collect();
    (users, count)
}

fn current_position(scroller: &gtk::ScrolledWindow, count: u32) -> f64 {
    let adjustment = scroller.vadjustment();
    let span = (adjustment.upper() - adjustment.page_size()).max(1.0);
    (adjustment.value() / span).clamp(0.0, 1.0) * f64::from(count.saturating_sub(1))
}

fn minimap(list: &gtk::ListView, scroller: &gtk::ScrolledWindow) -> (gtk::Box, gtk::DrawingArea) {
    let area = gtk::DrawingArea::new();
    area.set_content_width(10);
    area.set_vexpand(true);
    area.set_tooltip_text(Some("Timeline: click to jump to a message"));
    let drawn = list.clone();
    let viewport = scroller.vadjustment();
    area.set_draw_func(move |area, cairo, width, height| {
        let (users, count) = user_positions(&drawn);
        if users.len() < 2 || count == 0 {
            return;
        }
        let color = area.color();
        let (width, height) = (f64::from(width), f64::from(height));
        let upper = viewport.upper().max(1.0);
        cairo.set_source_rgba(f64::from(color.red()), f64::from(color.green()), f64::from(color.blue()), 0.08);
        let top = viewport.value() / upper * height;
        let span = (viewport.page_size() / upper * height).max(6.0);
        cairo.rectangle(0.0, top, width, span);
        cairo.fill().ok();
        cairo.set_source_rgba(0.204, 0.420, 0.945, 0.9);
        for index in users {
            let y = f64::from(index) / f64::from(count.max(1)) * (height - 3.0);
            cairo.rectangle(2.0, y, width - 4.0, 3.0);
        }
        cairo.fill().ok();
    });
    let redraw = area.clone();
    scroller.vadjustment().connect_value_changed(move |_| redraw.queue_draw());
    let click = gtk::GestureClick::new();
    let (target, surface) = (list.clone(), area.clone());
    click.connect_released(move |_, _, _, y| {
        let (users, count) = user_positions(&target);
        let height = f64::from(surface.height().max(1));
        let wanted = (y / height * f64::from(count)).max(0.0);
        let nearest = users
            .iter()
            .min_by(|left, right| (f64::from(**left) - wanted).abs().total_cmp(&(f64::from(**right) - wanted).abs()));
        if let Some(index) = nearest {
            target.scroll_to(*index, gtk::ListScrollFlags::NONE, None);
        }
    });
    area.add_controller(click);
    let column = gtk::Box::new(gtk::Orientation::Vertical, 2);
    column.add_css_class("ls-minimap");
    column.set_halign(gtk::Align::End);
    column.set_margin_top(8);
    column.set_margin_bottom(70);
    column.set_margin_end(18);
    for (icon, tooltip, forward) in
        [("go-up-symbolic", "Previous Message", false), ("go-down-symbolic", "Next Message", true)]
    {
        let button = gtk::Button::builder().icon_name(icon).tooltip_text(tooltip).build();
        button.add_css_class("flat");
        button.add_css_class("ls-minimap-button");
        let (target, scroll) = (list.clone(), scroller.clone());
        button.connect_clicked(move |_| {
            let (users, count) = user_positions(&target);
            let current = current_position(&scroll, count);
            let next = if forward {
                users.iter().find(|index| f64::from(**index) > current + 0.5)
            } else {
                users.iter().rev().find(|index| f64::from(**index) < current - 0.5)
            };
            if let Some(index) = next {
                target.scroll_to(*index, gtk::ListScrollFlags::NONE, None);
            }
        });
        if forward {
            column.append(&area);
        }
        column.append(&button);
    }
    (column, area)
}

fn small_icon(name: &str, class: &str) -> gtk::Image {
    let image = gtk::Image::from_icon_name(name);
    image.set_pixel_size(14);
    image.add_css_class(class);
    image
}

fn install_keys(app: &Weak<App>, list: &gtk::ListView) {
    let keys = gtk::EventControllerKey::new();
    keys.set_propagation_phase(gtk::PropagationPhase::Capture);
    let (weak, watched) = (app.clone(), list.downgrade());
    keys.connect_key_pressed(move |_, key, _, modifiers| {
        let (Some(app), Some(list)) = (weak.upgrade(), watched.upgrade()) else { return glib::Propagation::Proceed };
        if !list.is_focus() {
            return glib::Propagation::Proceed;
        }
        crate::keyboard::timeline_key(&app, key, modifiers)
    });
    list.add_controller(keys);
    let focus = gtk::EventControllerFocus::new();
    let weak = app.clone();
    focus.connect_leave(move |_| {
        if let Some(app) = weak.upgrade() {
            app.timeline.set_ring(false);
        }
    });
    list.add_controller(focus);
}

fn copy_text(kind: &ItemKind) -> String {
    match kind {
        ItemKind::User { text, .. } | ItemKind::Notice { text, .. } => text.clone(),
        ItemKind::Assistant { blocks, error, .. } => {
            let mut text = blocks
                .iter()
                .filter_map(|block| match block {
                    Block::Text { text } => Some(text.as_str()),
                    Block::Thinking { .. } => None,
                })
                .collect::<Vec<_>>()
                .join("\n\n");
            if let Some(error) = error {
                text.push_str("\n\n");
                text.push_str(error);
            }
            text
        }
        ItemKind::Tool { summary, .. } | ItemKind::Compaction { summary, .. } => summary.clone(),
        ItemKind::TurnSummary { .. } => String::new(),
    }
}
