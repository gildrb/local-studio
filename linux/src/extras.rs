use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};
use std::rc::{Rc, Weak};

use adw::prelude::*;
use gtk::{gdk, gio, glib};
use local_studio_core::{ImageAttachment, ItemKind, PullRequest, SearchHit, SlashCommand};

use crate::app::{App, Target};
use crate::format;

const MENU_LIMIT: usize = 8;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Command,
    Mention,
    Pull,
    Skill,
}

#[derive(Clone)]
struct Trigger {
    kind: Kind,
    start: i32,
    query: String,
}

#[derive(Clone)]
struct Suggestion {
    title: String,
    detail: String,
    badge: String,
    insert: String,
    file: Option<String>,
    context: Option<(String, String)>,
}

pub struct Extras {
    pub menu: gtk::ScrolledWindow,
    pub chips: gtk::ScrolledWindow,
    pub attach: gtk::Button,
    list: gtk::ListBox,
    chip_row: gtk::Box,
    items: RefCell<Vec<Suggestion>>,
    trigger: RefCell<Option<Trigger>>,
    commands: RefCell<Vec<SlashCommand>>,
    commands_key: RefCell<Option<String>>,
    skills: RefCell<Vec<local_studio_core::SkillEntry>>,
    skills_key: RefCell<Option<String>>,
    pulls: RefCell<Vec<PullRequest>>,
    pulls_key: RefCell<Option<String>>,
    pending: RefCell<String>,
    images: RefCell<Vec<ImageAttachment>>,
    files: RefCell<Vec<String>>,
    contexts: RefCell<Vec<(String, String)>>,
    history: RefCell<Vec<String>>,
    history_index: Cell<Option<usize>>,
    app: Weak<App>,
}

impl Extras {
    pub fn new(app: Weak<App>) -> Self {
        let list = gtk::ListBox::new();
        list.add_css_class("navigation-sidebar");
        list.set_selection_mode(gtk::SelectionMode::Browse);
        let menu = gtk::ScrolledWindow::builder()
            .hscrollbar_policy(gtk::PolicyType::Never)
            .propagate_natural_height(true)
            .max_content_height(280)
            .child(&list)
            .build();
        menu.add_css_class("ls-menu");
        menu.set_visible(false);
        let chip_row = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        let chips = gtk::ScrolledWindow::builder()
            .vscrollbar_policy(gtk::PolicyType::Never)
            .propagate_natural_height(true)
            .child(&chip_row)
            .build();
        chips.set_visible(false);
        let attach = gtk::Button::builder().icon_name("mail-attachment-symbolic").tooltip_text("Attach Files").build();
        attach.add_css_class("flat");
        let weak = app.clone();
        attach.connect_clicked(move |_| {
            if let Some(app) = weak.upgrade() {
                pick_files(&app);
            }
        });
        let weak = app.clone();
        list.connect_row_activated(move |_, row| {
            if let Some(app) = weak.upgrade() {
                app.composer.extras.accept(&app, usize::try_from(row.index()).unwrap_or(0));
            }
        });
        Self {
            menu,
            chips,
            attach,
            list,
            chip_row,
            items: RefCell::new(Vec::new()),
            trigger: RefCell::new(None),
            commands: RefCell::new(Vec::new()),
            commands_key: RefCell::new(None),
            skills: RefCell::new(Vec::new()),
            skills_key: RefCell::new(None),
            pulls: RefCell::new(Vec::new()),
            pulls_key: RefCell::new(None),
            pending: RefCell::new(String::new()),
            images: RefCell::new(Vec::new()),
            files: RefCell::new(Vec::new()),
            contexts: RefCell::new(Vec::new()),
            history: RefCell::new(Vec::new()),
            history_index: Cell::new(None),
            app,
        }
    }

    pub fn suggestions(&self) -> Vec<String> {
        self.items.borrow().iter().map(|item| item.title.clone()).collect()
    }

    pub fn has_attachments(&self) -> bool {
        !self.images.borrow().is_empty() || !self.files.borrow().is_empty() || !self.contexts.borrow().is_empty()
    }

    pub fn add_context(&self, label: &str, text: &str) {
        self.contexts.borrow_mut().push((label.to_string(), text.to_string()));
        self.render_chips();
    }

    pub fn take(&self) -> (Vec<ImageAttachment>, Vec<String>, Vec<(String, String)>) {
        let taken = (self.images.take(), self.files.take(), self.contexts.take());
        self.render_chips();
        taken
    }

    pub fn remember(&self, text: &str) {
        let mut history = self.history.borrow_mut();
        history.retain(|entry| entry != text);
        history.push(text.to_string());
        self.history_index.set(None);
    }

    pub fn reset(&self) {
        self.images.borrow_mut().clear();
        self.files.borrow_mut().clear();
        self.contexts.borrow_mut().clear();
        self.history_index.set(None);
        self.close();
        self.render_chips();
    }

    pub fn changed(&self, app: &Rc<App>, view: &gtk::TextView) {
        let buffer = view.buffer();
        let cursor = buffer.cursor_position();
        let before = buffer.text(&buffer.start_iter(), &buffer.iter_at_offset(cursor), false).to_string();
        let Some(trigger) = trigger_at(&before) else {
            self.close();
            return;
        };
        self.trigger.replace(Some(trigger.clone()));
        let (project, root) = {
            let state = app.state.borrow();
            (state.current_project(), state.workspace_dir())
        };
        match trigger.kind {
            Kind::Command => {
                let key = project.clone().unwrap_or_default();
                if self.commands_key.borrow().as_ref() != Some(&key) {
                    self.commands_key.replace(Some(key));
                    let request = app.ask(Target::Commands);
                    app.core.run(|studio| studio.list_commands(request, project));
                }
                self.show_commands(&trigger.query);
            }
            Kind::Skill => {
                let key = project.clone().unwrap_or_default();
                if self.skills_key.borrow().as_ref() != Some(&key) {
                    self.skills_key.replace(Some(key));
                    let request = app.ask(Target::Skills);
                    app.core.run(|studio| studio.list_skills(request, project));
                }
                self.show_skills(&trigger.query);
            }
            Kind::Pull => {
                let Some(root) = root else {
                    self.show(vec![], "Add a project to reference its pull requests.");
                    return;
                };
                if self.pulls_key.borrow().as_deref() != Some(root.as_str()) {
                    self.pulls_key.replace(Some(root.clone()));
                    let request = app.ask(Target::HashPulls);
                    app.core.run(|studio| studio.list_pull_requests(request, root));
                }
                self.show_pulls(&trigger.query);
            }
            Kind::Mention => {
                let Some(root) = root else {
                    self.show(vec![], "Add a project to mention its files.");
                    return;
                };
                let request = app.ask(Target::Mentions);
                self.pending.replace(request.clone());
                let query = trigger.query.clone();
                if !app.core.is_live() {
                    return;
                }
                if self.items.borrow().is_empty() {
                    self.show(vec![], "Searching workspace files…");
                }
                app.core.run(|studio| studio.search_files(request, root, query, 20));
            }
        }
    }

    pub fn pulls_loaded(&self, pulls: &[PullRequest]) {
        self.pulls.replace(pulls.to_vec());
        let query =
            self.trigger.borrow().as_ref().filter(|trigger| trigger.kind == Kind::Pull).map(|t| t.query.clone());
        if let Some(query) = query {
            self.show_pulls(&query);
        }
    }

    fn show_pulls(&self, query: &str) {
        let query = query.to_lowercase();
        let items: Vec<Suggestion> = self
            .pulls
            .borrow()
            .iter()
            .filter(|pull| pull.number.to_string().starts_with(&query) || pull.title.to_lowercase().contains(&query))
            .take(MENU_LIMIT)
            .map(|pull| Suggestion {
                title: format!("#{} {}", pull.number, pull.title),
                detail: format!("{} → {} · {}", pull.head, pull.base, pull.url),
                badge: format::capitalize(&pull.state.to_lowercase()),
                insert: format!("#{} ", pull.number),
                file: None,
                context: Some((
                    format!("PR #{}", pull.number),
                    format!("{}\n{}\n{} → {} ({})", pull.title, pull.url, pull.head, pull.base, pull.state),
                )),
            })
            .collect();
        self.show(items, "No matching pull requests.");
    }

    fn show_skills(&self, query: &str) {
        let query = query.to_lowercase();
        let items: Vec<Suggestion> = self
            .skills
            .borrow()
            .iter()
            .filter(|skill| skill.name.to_lowercase().contains(&query))
            .take(MENU_LIMIT)
            .map(|skill| Suggestion {
                title: format!("${}", skill.name),
                detail: skill.description.clone(),
                badge: skill_source(skill.source).to_string(),
                insert: format!("${} ", skill.name),
                file: None,
                context: None,
            })
            .collect();
        self.show(items, "No matching skill.");
    }

    pub fn skills_loaded(&self, skills: &[local_studio_core::SkillEntry]) {
        self.skills.replace(skills.to_vec());
        let query =
            self.trigger.borrow().as_ref().filter(|trigger| trigger.kind == Kind::Skill).map(|t| t.query.clone());
        if let Some(query) = query {
            self.show_skills(&query);
        }
    }

    pub fn commands_loaded(&self, commands: Vec<SlashCommand>) {
        self.commands.replace(commands);
        let query =
            self.trigger.borrow().as_ref().filter(|trigger| trigger.kind == Kind::Command).map(|t| t.query.clone());
        if let Some(query) = query {
            self.show_commands(&query);
        }
    }

    pub fn mentions_loaded(&self, request: &str, hits: &[SearchHit]) {
        if *self.pending.borrow() != request {
            return;
        }
        let open = self.trigger.borrow().as_ref().is_some_and(|trigger| trigger.kind == Kind::Mention);
        if !open {
            return;
        }
        let items = hits
            .iter()
            .take(MENU_LIMIT)
            .map(|hit| Suggestion {
                title: format!("@{}", hit.relative),
                detail: hit.preview.clone(),
                badge: String::new(),
                insert: format!("@{} ", hit.relative),
                file: Some(hit.relative.clone()),
                context: None,
            })
            .collect();
        self.show(items, "No matching files or folders.");
    }

    fn show_commands(&self, query: &str) {
        let query = query.to_lowercase();
        let mut items: Vec<Suggestion> = vec![Suggestion {
            title: "/model".to_string(),
            detail: "Switch response model for this thread".to_string(),
            badge: "App".to_string(),
            insert: "/model ".to_string(),
            file: None,
            context: None,
        }];
        items.extend(self.commands.borrow().iter().map(|command| Suggestion {
            title: format!("/{}", command.name),
            detail: command.description.clone(),
            badge: match command.kind {
                local_studio_core::CommandKind::Template => "Template".to_string(),
                local_studio_core::CommandKind::Skill => "Skill".to_string(),
                local_studio_core::CommandKind::Command => command.source.clone(),
            },
            insert: format!("/{} ", command.name),
            file: None,
            context: None,
        }));
        items.retain(|item| item.title[1..].to_lowercase().contains(&query));
        items.truncate(MENU_LIMIT);
        self.show(items, "No matching command.");
    }

    fn show(&self, items: Vec<Suggestion>, empty: &str) {
        self.list.remove_all();
        if items.is_empty() {
            let row = adw::ActionRow::builder().title(empty).activatable(false).build();
            row.add_css_class("dim-label");
            self.list.append(&row);
        }
        for item in &items {
            let row = adw::ActionRow::builder()
                .title(format::escape(&item.title))
                .subtitle(format::escape(&item.detail))
                .subtitle_lines(1)
                .activatable(true)
                .build();
            if !item.badge.is_empty() {
                let badge = gtk::Label::new(Some(&item.badge));
                badge.add_css_class("ls-pill");
                badge.set_valign(gtk::Align::Center);
                row.add_suffix(&badge);
            }
            self.list.append(&row);
        }
        if let Some(first) = self.list.row_at_index(0) {
            self.list.select_row(Some(&first));
        }
        self.items.replace(items);
        self.menu.set_visible(true);
    }

    fn close(&self) {
        self.trigger.replace(None);
        self.items.borrow_mut().clear();
        self.menu.set_visible(false);
    }

    pub fn key(&self, app: &Rc<App>, view: &gtk::TextView, key: gdk::Key) -> glib::Propagation {
        if self.menu.is_visible() {
            let current = self.list.selected_row().map_or(0, |row| row.index());
            match key {
                gdk::Key::Down | gdk::Key::Up => {
                    let next = if key == gdk::Key::Down { current + 1 } else { (current - 1).max(0) };
                    if let Some(row) = self.list.row_at_index(next) {
                        self.list.select_row(Some(&row));
                    }
                    return glib::Propagation::Stop;
                }
                gdk::Key::Tab | gdk::Key::Return | gdk::Key::KP_Enter if !self.items.borrow().is_empty() => {
                    self.accept(app, usize::try_from(current).unwrap_or(0));
                    return glib::Propagation::Stop;
                }
                gdk::Key::Escape => {
                    self.close();
                    return glib::Propagation::Stop;
                }
                _ => return glib::Propagation::Proceed,
            }
        }
        if !matches!(key, gdk::Key::Up | gdk::Key::Down) {
            return glib::Propagation::Proceed;
        }
        let buffer = view.buffer();
        let browsing = self.history_index.get().is_some();
        if !browsing && (buffer.char_count() > 0 || key == gdk::Key::Down) {
            return glib::Propagation::Proceed;
        }
        let history = self.history_for(app);
        if history.is_empty() {
            return glib::Propagation::Proceed;
        }
        let next = match (key, self.history_index.get()) {
            (gdk::Key::Up, None) => Some(history.len() - 1),
            (gdk::Key::Up, Some(index)) => Some(index.saturating_sub(1)),
            (_, Some(index)) if index + 1 < history.len() => Some(index + 1),
            _ => None,
        };
        self.history_index.set(next);
        buffer.set_text(next.and_then(|index| history.get(index)).map_or("", String::as_str));
        self.history_index.set(next);
        glib::Propagation::Stop
    }

    fn history_for(&self, app: &Rc<App>) -> Vec<String> {
        let mut history: Vec<String> = app
            .timeline
            .items()
            .iter()
            .filter_map(|item| match &item.kind {
                ItemKind::User { text, .. } => Some(text.clone()),
                _ => None,
            })
            .collect();
        for text in self.history.borrow().iter() {
            if !history.contains(text) {
                history.push(text.clone());
            }
        }
        history
    }

    fn accept(&self, app: &Rc<App>, index: usize) {
        let (Some(item), Some(trigger)) = (self.items.borrow().get(index).cloned(), self.trigger.borrow().clone())
        else {
            return;
        };
        let view = app.composer.view();
        let buffer = view.buffer();
        let mut start = buffer.iter_at_offset(trigger.start);
        let mut end = buffer.iter_at_offset(buffer.cursor_position());
        buffer.delete(&mut start, &mut end);
        buffer.insert(&mut start, &item.insert);
        if let Some((label, text)) = item.context {
            self.contexts.borrow_mut().push((label, text));
        }
        if let Some(file) = item.file {
            let mut files = self.files.borrow_mut();
            if !files.contains(&file) {
                files.push(file);
            }
        }
        self.close();
        self.render_chips();
        view.grab_focus();
    }

    pub fn attach_paths(&self, app: &Rc<App>, paths: Vec<PathBuf>) {
        let root = app.state.borrow().workspace_dir().map(PathBuf::from);
        let mut outside = 0;
        for path in paths {
            if let Some(mime) = image_mime(&path) {
                match std::fs::read(&path) {
                    Ok(data) => self.images.borrow_mut().push(ImageAttachment { mime_type: mime.to_string(), data }),
                    Err(error) => app.toast(&format!("Could not read {}: {error}", path.display())),
                }
                continue;
            }
            let relative = root.as_ref().and_then(|root| {
                let canonical = path.canonicalize().ok()?;
                let root = root.canonicalize().ok()?;
                canonical.strip_prefix(&root).ok().map(|relative| relative.to_string_lossy().into_owned())
            });
            match relative {
                Some(relative) if !relative.is_empty() => {
                    let mut files = self.files.borrow_mut();
                    if !files.contains(&relative) {
                        files.push(relative);
                    }
                }
                _ => outside += 1,
            }
        }
        if outside > 0 {
            app.toast("Only images and files inside the project can be attached.");
        }
        self.render_chips();
    }

    pub fn attach_texture(&self, texture: &gdk::Texture) {
        let data = texture.save_to_png_bytes().to_vec();
        self.images.borrow_mut().push(ImageAttachment { mime_type: "image/png".to_string(), data });
        self.render_chips();
    }

    pub fn render_chips(&self) {
        while let Some(child) = self.chip_row.first_child() {
            self.chip_row.remove(&child);
        }
        for (index, image) in self.images.borrow().iter().enumerate() {
            let chip = gtk::Overlay::new();
            let picture = gtk::Picture::new();
            if let Ok(texture) = gdk::Texture::from_bytes(&glib::Bytes::from(&image.data)) {
                picture.set_paintable(Some(&texture));
            }
            picture.set_content_fit(gtk::ContentFit::Cover);
            picture.set_size_request(56, 56);
            picture.add_css_class("ls-thumb");
            chip.set_child(Some(&picture));
            chip.add_overlay(&self.remove_button(Chip::Image, index));
            self.chip_row.append(&chip);
        }
        for (index, file) in self.files.borrow().iter().enumerate() {
            let chip = gtk::Box::new(gtk::Orientation::Horizontal, 4);
            chip.add_css_class("ls-chip");
            chip.set_valign(gtk::Align::Center);
            chip.append(&gtk::Image::from_icon_name("text-x-generic-symbolic"));
            let label = gtk::Label::new(Some(file));
            label.set_ellipsize(gtk::pango::EllipsizeMode::Start);
            label.set_max_width_chars(36);
            chip.append(&label);
            chip.append(&self.remove_button(Chip::File, index));
            self.chip_row.append(&chip);
        }
        for (index, (label, text)) in self.contexts.borrow().iter().enumerate() {
            let chip = gtk::Box::new(gtk::Orientation::Horizontal, 4);
            chip.add_css_class("ls-chip");
            chip.set_valign(gtk::Align::Center);
            chip.set_tooltip_text(Some(text));
            chip.append(&gtk::Image::from_icon_name("utilities-terminal-symbolic"));
            chip.append(&gtk::Label::new(Some(&format!("{label} · {} lines", text.lines().count()))));
            chip.append(&self.remove_button(Chip::Context, index));
            self.chip_row.append(&chip);
        }
        self.chips.set_visible(self.has_attachments());
    }

    fn remove_button(&self, kind: Chip, index: usize) -> gtk::Button {
        let button = gtk::Button::builder().icon_name("window-close-symbolic").tooltip_text("Remove").build();
        button.add_css_class("flat");
        button.add_css_class("circular");
        button.add_css_class("ls-chip-remove");
        button.set_halign(gtk::Align::End);
        button.set_valign(gtk::Align::Start);
        let weak = self.app.clone();
        button.connect_clicked(move |_| {
            let Some(app) = weak.upgrade() else { return };
            let extras = &app.composer.extras;
            match kind {
                Chip::Image => remove_at(&mut extras.images.borrow_mut(), index),
                Chip::File => remove_at(&mut extras.files.borrow_mut(), index),
                Chip::Context => remove_at(&mut extras.contexts.borrow_mut(), index),
            }
            extras.render_chips();
        });
        button
    }

    pub fn set_fixture(&self, files: Vec<String>, images: Vec<ImageAttachment>) {
        self.files.replace(files);
        self.images.replace(images);
        self.render_chips();
    }

    pub fn show_fixture_mentions(&self, hits: &[SearchHit]) {
        self.pending.replace("fixture".to_string());
        self.trigger.replace(Some(Trigger { kind: Kind::Mention, start: 0, query: String::new() }));
        self.mentions_loaded("fixture", hits);
    }

    pub fn show_fixture_commands(&self, commands: Vec<SlashCommand>, query: &str) {
        self.commands.replace(commands);
        self.trigger.replace(Some(Trigger { kind: Kind::Command, start: 0, query: query.to_string() }));
        self.show_commands(query);
    }
}

#[derive(Clone, Copy)]
enum Chip {
    Image,
    File,
    Context,
}

fn remove_at<T>(items: &mut Vec<T>, index: usize) {
    if index < items.len() {
        items.remove(index);
    }
}

fn skill_source(source: local_studio_core::SkillSource) -> &'static str {
    match source {
        local_studio_core::SkillSource::App => "App",
        local_studio_core::SkillSource::Repo => "Repo",
        local_studio_core::SkillSource::Project => "Project",
        local_studio_core::SkillSource::Personal => "Personal",
        local_studio_core::SkillSource::System => "System",
    }
}

fn trigger_at(before: &str) -> Option<Trigger> {
    let token_start = before
        .rfind(char::is_whitespace)
        .map_or(0, |index| index + before[index..].chars().next().map_or(1, char::len_utf8));
    let token = &before[token_start..];
    let start = i32::try_from(before[..token_start].chars().count()).ok()?;
    if let Some(query) = token.strip_prefix('/') {
        let line_start = token_start == 0 || before[..token_start].ends_with('\n');
        return line_start.then(|| Trigger { kind: Kind::Command, start, query: query.to_string() });
    }
    if let Some(query) = token.strip_prefix('#') {
        return Some(Trigger { kind: Kind::Pull, start, query: query.to_string() });
    }
    if let Some(query) = token.strip_prefix('$') {
        return Some(Trigger { kind: Kind::Skill, start, query: query.to_string() });
    }
    token.strip_prefix('@').map(|query| Trigger { kind: Kind::Mention, start, query: query.to_string() })
}

fn image_mime(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_string_lossy().to_lowercase();
    match extension.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

fn pick_files(app: &Rc<App>) {
    let dialog = gtk::FileDialog::builder().title("Attach Files").modal(true).build();
    if let Some(root) = app.state.borrow().workspace_dir() {
        dialog.set_initial_folder(Some(&gio::File::for_path(root)));
    }
    let weak = Rc::downgrade(app);
    dialog.open_multiple(Some(&app.window), None::<&gio::Cancellable>, move |result| {
        let (Some(app), Ok(files)) = (weak.upgrade(), result) else { return };
        let paths: Vec<PathBuf> = (0..files.n_items())
            .filter_map(|index| files.item(index).and_downcast::<gio::File>().and_then(|file| file.path()))
            .collect();
        app.composer.extras.attach_paths(&app, paths);
    });
}

pub fn drop_target(app: &Weak<App>) -> gtk::DropTarget {
    let target = gtk::DropTarget::new(gdk::FileList::static_type(), gdk::DragAction::COPY);
    let weak = app.clone();
    target.connect_drop(move |_, value, _, _| {
        let (Some(app), Ok(list)) = (weak.upgrade(), value.get::<gdk::FileList>()) else { return false };
        let paths: Vec<PathBuf> = list.files().iter().filter_map(gio::File::path).collect();
        app.composer.extras.attach_paths(&app, paths);
        true
    });
    target
}
