use std::cell::RefCell;
use std::rc::{Rc, Weak};

use adw::prelude::*;
use gtk::{gdk, glib};
use local_studio_core::{
    Device, DevicePlatform, FileContent, FileEntry, ItemKind, PullRequest, PullRequestDetail, ToolKind, ToolState,
};
use webkit::prelude::*;

use crate::app::{App, Target};
use crate::format;
use crate::pulls::{pull_row, PullDetail};

fn header(back: Option<&gtk::Button>, title: &gtk::Label, extra: Option<&gtk::Widget>) -> gtk::Box {
    let bar = gtk::Box::new(gtk::Orientation::Horizontal, 6);
    bar.set_margin_start(8);
    bar.set_margin_end(8);
    bar.set_margin_bottom(4);
    if let Some(back) = back {
        bar.append(back);
    }
    title.set_xalign(0.0);
    title.set_hexpand(true);
    title.set_ellipsize(gtk::pango::EllipsizeMode::Start);
    title.add_css_class("ls-meta");
    bar.append(title);
    if let Some(extra) = extra {
        bar.append(extra);
    }
    bar
}

fn back_button() -> gtk::Button {
    let button = gtk::Button::builder().icon_name("go-previous-symbolic").tooltip_text("Back").build();
    button.add_css_class("flat");
    button
}

fn message(text: &str) -> gtk::Label {
    let label = gtk::Label::new(Some(text));
    label.add_css_class("dim-label");
    label.set_wrap(true);
    label.set_margin_top(24);
    label.set_margin_start(16);
    label.set_margin_end(16);
    label
}

pub struct FilesSurface {
    pub root: gtk::Stack,
    path: gtk::Label,
    list: gtk::ListBox,
    status: gtk::Label,
    file_title: gtk::Label,
    preview: adw::Bin,
    entries: RefCell<Vec<FileEntry>>,
    dir: RefCell<Option<String>>,
}

impl FilesSurface {
    pub fn new(app: &Weak<App>) -> Self {
        let up = gtk::Button::builder().icon_name("go-up-symbolic").tooltip_text("Parent Folder").build();
        up.add_css_class("flat");
        let path = gtk::Label::new(Some("/"));
        let list = gtk::ListBox::new();
        list.add_css_class("navigation-sidebar");
        let status = message("");
        status.set_visible(false);
        let column = gtk::Box::new(gtk::Orientation::Vertical, 0);
        column.append(&status);
        column.append(&list);
        let scroller = gtk::ScrolledWindow::builder()
            .hscrollbar_policy(gtk::PolicyType::Never)
            .vexpand(true)
            .child(&column)
            .build();
        let tree = gtk::Box::new(gtk::Orientation::Vertical, 0);
        tree.append(&header(Some(&up), &path, None));
        tree.append(&scroller);
        let back = back_button();
        let file_title = gtk::Label::new(None);
        let preview = adw::Bin::new();
        preview.set_vexpand(true);
        let file = gtk::Box::new(gtk::Orientation::Vertical, 0);
        file.append(&header(Some(&back), &file_title, None));
        file.append(&preview);
        let root = gtk::Stack::new();
        root.add_named(&tree, Some("tree"));
        root.add_named(&file, Some("file"));
        let weak = app.clone();
        up.connect_clicked(move |_| {
            let Some(app) = weak.upgrade() else { return };
            let dir = app.panel.files.dir.borrow().clone().unwrap_or_default();
            let parent = dir.rsplit_once('/').map_or(String::new(), |(parent, _)| parent.to_string());
            app.panel.files.navigate(&app, &parent);
        });
        let stack = root.clone();
        back.connect_clicked(move |_| stack.set_visible_child_name("tree"));
        let weak = app.clone();
        list.connect_row_activated(move |_, row| {
            let Some(app) = weak.upgrade() else { return };
            let entry = usize::try_from(row.index())
                .ok()
                .and_then(|index| app.panel.files.entries.borrow().get(index).cloned());
            match entry {
                Some(entry) if entry.directory => app.panel.files.navigate(&app, &entry.relative),
                Some(entry) => app.panel.files.open_file(&app, &entry.relative),
                None => {}
            }
        });
        Self {
            root,
            path,
            list,
            status,
            file_title,
            preview,
            entries: RefCell::new(Vec::new()),
            dir: RefCell::new(None),
        }
    }

    pub fn current_path(&self) -> Option<String> {
        if self.root.visible_child_name().is_some_and(|name| name == "file") {
            return Some(self.file_title.text().to_string());
        }
        self.dir.borrow().clone()
    }

    pub fn names(&self) -> Vec<String> {
        self.entries.borrow().iter().map(|entry| entry.name.clone()).collect()
    }

    pub fn open(&self, app: &Rc<App>, force: bool) {
        if self.dir.borrow().is_some() && !force {
            return;
        }
        let dir = self.dir.borrow().clone().unwrap_or_default();
        self.navigate(app, &dir);
    }

    pub fn navigate(&self, app: &Rc<App>, relative: &str) {
        let root = app.state.borrow().workspace_dir();
        let Some(root) = root else {
            self.failed("Open a project thread to browse its files.");
            return;
        };
        self.dir.replace(Some(relative.to_string()));
        self.path.set_label(&format!("/{relative}"));
        self.root.set_visible_child_name("tree");
        let request = app.ask(Target::Files);
        let relative = relative.to_string();
        app.core.run(|studio| studio.list_directory(request, root, relative));
    }

    pub fn loaded(&self, entries: &[FileEntry]) {
        self.list.remove_all();
        self.status.set_visible(entries.is_empty());
        self.status.set_label("This folder is empty.");
        for entry in entries {
            let row = adw::ActionRow::builder().title(format::escape(&entry.name)).activatable(true).build();
            row.add_prefix(&gtk::Image::from_icon_name(if entry.directory {
                "folder-symbolic"
            } else {
                "text-x-generic-symbolic"
            }));
            if !entry.directory {
                let size = gtk::Label::new(Some(&size(entry.size)));
                size.add_css_class("ls-meta");
                row.add_suffix(&size);
            }
            self.list.append(&row);
        }
        self.entries.replace(entries.to_vec());
    }

    pub fn open_file(&self, app: &Rc<App>, relative: &str) {
        let root = app.state.borrow().workspace_dir();
        let Some(root) = root else { return };
        self.file_title.set_label(relative);
        self.preview.set_child(Some(&message("Loading…")));
        self.root.set_visible_child_name("file");
        let request = app.ask(Target::Preview);
        let relative = relative.to_string();
        app.core.run(|studio| studio.read_file(request, root, relative));
    }

    pub fn preview(&self, path: &str, content: &FileContent) {
        self.file_title.set_label(path);
        let widget: gtk::Widget = match content {
            FileContent::Text { text, language } => {
                let view = gtk::TextView::builder()
                    .editable(false)
                    .monospace(true)
                    .left_margin(10)
                    .right_margin(10)
                    .top_margin(6)
                    .bottom_margin(10)
                    .build();
                view.add_css_class("ls-diff");
                view.buffer().set_text(text);
                view.set_tooltip_text(language.as_deref());
                gtk::ScrolledWindow::builder().vexpand(true).child(&view).build().upcast()
            }
            FileContent::Image { data, .. } => {
                let picture = gtk::Picture::new();
                if let Ok(texture) = gdk::Texture::from_bytes(&glib::Bytes::from(data)) {
                    picture.set_paintable(Some(&texture));
                }
                picture.set_content_fit(gtk::ContentFit::Contain);
                picture.upcast()
            }
            FileContent::Binary { size: bytes } => message(&format!("Binary file · {}", size(*bytes))).upcast(),
            FileContent::TooLarge { size: bytes } => {
                message(&format!("Too large to preview · {}", size(*bytes))).upcast()
            }
        };
        self.preview.set_child(Some(&widget));
        self.root.set_visible_child_name("file");
    }

    pub fn failed(&self, text: &str) {
        self.list.remove_all();
        self.status.set_label(text);
        self.status.set_visible(true);
        self.preview.set_child(Some(&message(text)));
    }
}

#[allow(clippy::cast_precision_loss)]
fn size(bytes: u64) -> String {
    match bytes {
        0..1_024 => format!("{bytes} B"),
        1_024..1_048_576 => format!("{:.1} KB", bytes as f64 / 1_024.0),
        _ => format!("{:.1} MB", bytes as f64 / 1_048_576.0),
    }
}

pub struct PullsSurface {
    pub root: gtk::Stack,
    list: gtk::ListBox,
    status: gtk::Label,
    detail: PullDetail,
    pulls: RefCell<Vec<PullRequest>>,
    loaded_for: RefCell<Option<String>>,
}

impl PullsSurface {
    pub fn new(app: &Weak<App>) -> Self {
        let list = gtk::ListBox::new();
        list.add_css_class("navigation-sidebar");
        let status = message("Loading pull requests…");
        let column = gtk::Box::new(gtk::Orientation::Vertical, 0);
        column.append(&status);
        column.append(&list);
        let scroller = gtk::ScrolledWindow::builder()
            .hscrollbar_policy(gtk::PolicyType::Never)
            .vexpand(true)
            .child(&column)
            .build();
        let back = back_button();
        let title = gtk::Label::new(Some("Pull request"));
        let detail = PullDetail::new();
        let page = gtk::Box::new(gtk::Orientation::Vertical, 0);
        page.append(&header(Some(&back), &title, None));
        page.append(&detail.root);
        let root = gtk::Stack::new();
        root.add_named(&scroller, Some("list"));
        root.add_named(&page, Some("detail"));
        let stack = root.clone();
        back.connect_clicked(move |_| stack.set_visible_child_name("list"));
        let weak = app.clone();
        list.connect_row_activated(move |_, row| {
            let Some(app) = weak.upgrade() else { return };
            let pull =
                usize::try_from(row.index()).ok().and_then(|index| app.panel.pulls.pulls.borrow().get(index).cloned());
            let project = app.panel.pulls.loaded_for.borrow().clone();
            if let (Some(pull), Some(project)) = (pull, project) {
                app.panel.pulls.detail.message(&format!("Loading #{}…", pull.number));
                app.panel.pulls.root.set_visible_child_name("detail");
                let request = app.ask(Target::PanelPull);
                app.core.run(|studio| studio.load_pull_request(request, project, pull.number));
            }
        });
        Self { root, list, status, detail, pulls: RefCell::new(Vec::new()), loaded_for: RefCell::new(None) }
    }

    pub fn open(&self, app: &Rc<App>, force: bool) {
        let project = app.state.borrow().workspace_dir();
        let Some(project) = project else {
            self.failed("Open a project thread to see its pull requests.");
            return;
        };
        if !force && self.loaded_for.borrow().as_deref() == Some(project.as_str()) {
            return;
        }
        self.loaded_for.replace(Some(project.clone()));
        self.status.set_label("Loading pull requests…");
        self.status.set_visible(true);
        self.root.set_visible_child_name("list");
        let request = app.ask(Target::PanelPulls);
        app.core.run(|studio| studio.list_pull_requests(request, project));
    }

    pub fn loaded(&self, pulls: &[PullRequest]) {
        self.list.remove_all();
        for pull in pulls {
            self.list.append(&pull_row(pull));
        }
        self.status.set_visible(pulls.is_empty());
        self.status.set_label("No pull requests for this repository.");
        self.pulls.replace(pulls.to_vec());
    }

    pub fn detail(&self, detail: &PullRequestDetail) {
        self.detail.show(detail);
        self.root.set_visible_child_name("detail");
    }

    pub fn failed(&self, text: &str) {
        self.status.set_label(text);
        self.status.set_visible(true);
        self.detail.message(text);
    }
}

pub struct AgentsSurface {
    pub root: gtk::ScrolledWindow,
    list: gtk::ListBox,
    status: gtk::Label,
}

impl AgentsSurface {
    pub fn new() -> Self {
        let list = gtk::ListBox::new();
        list.add_css_class("boxed-list");
        list.set_selection_mode(gtk::SelectionMode::None);
        list.set_margin_start(10);
        list.set_margin_end(10);
        let status = message("No subagents in this thread yet.");
        let column = gtk::Box::new(gtk::Orientation::Vertical, 8);
        column.append(&status);
        column.append(&list);
        let root = gtk::ScrolledWindow::builder()
            .hscrollbar_policy(gtk::PolicyType::Never)
            .vexpand(true)
            .child(&column)
            .build();
        Self { root, list, status }
    }

    pub fn render(&self, app: &App) {
        self.list.remove_all();
        let items = app.timeline.items();
        let mut count = 0;
        for item in items.iter() {
            let ItemKind::Tool { kind: ToolKind::Agent, summary, name, state, output, started_at, ended_at, .. } =
                &item.kind
            else {
                continue;
            };
            count += 1;
            let (label, class) = match state {
                ToolState::Pending | ToolState::Running => ("Working", "status-working"),
                ToolState::Succeeded => ("Done", "status-done"),
                ToolState::Failed => ("Failed", "status-failed"),
                ToolState::Aborted => ("Stopped", "dim-label"),
            };
            let elapsed = started_at
                .zip(*ended_at)
                .map(|(start, end)| format::duration(u64::try_from(end - start).unwrap_or(0)))
                .unwrap_or_default();
            let row = adw::ExpanderRow::builder()
                .title(format::escape(if summary.is_empty() { name } else { summary }))
                .subtitle(format::escape(&elapsed))
                .build();
            row.add_prefix(&gtk::Image::from_icon_name("avatar-default-symbolic"));
            let pill = gtk::Label::new(Some(label));
            pill.add_css_class("ls-pill");
            pill.add_css_class(class);
            pill.set_valign(gtk::Align::Center);
            row.add_suffix(&pill);
            let text = gtk::Label::new(Some(if output.is_empty() { "No output yet." } else { output.trim() }));
            text.add_css_class("ls-mono");
            text.set_wrap(true);
            text.set_wrap_mode(gtk::pango::WrapMode::WordChar);
            text.set_selectable(true);
            text.set_xalign(0.0);
            text.set_margin_start(12);
            text.set_margin_end(12);
            text.set_margin_top(8);
            text.set_margin_bottom(8);
            row.add_row(&text);
            self.list.append(&row);
        }
        self.list.set_visible(count > 0);
        self.status.set_visible(count == 0);
    }
}

pub struct DevicesSurface {
    pub root: gtk::ScrolledWindow,
    list: gtk::ListBox,
    status: gtk::Label,
    app: Weak<App>,
}

impl DevicesSurface {
    pub fn new(app: &Weak<App>) -> Self {
        let list = gtk::ListBox::new();
        list.add_css_class("boxed-list");
        list.set_selection_mode(gtk::SelectionMode::None);
        list.set_margin_start(10);
        list.set_margin_end(10);
        let status = message("Looking for simulators and emulators…");
        let column = gtk::Box::new(gtk::Orientation::Vertical, 8);
        column.append(&status);
        column.append(&list);
        let root = gtk::ScrolledWindow::builder()
            .hscrollbar_policy(gtk::PolicyType::Never)
            .vexpand(true)
            .child(&column)
            .build();
        Self { root, list, status, app: app.clone() }
    }

    pub fn refresh(&self, app: &Rc<App>) {
        self.status.set_label("Looking for simulators and emulators…");
        self.status.set_visible(true);
        let request = app.ask(Target::Devices);
        app.core.run(|studio| studio.list_devices(request));
    }

    pub fn loaded(&self, devices: &[Device]) {
        self.list.remove_all();
        self.status.set_visible(devices.is_empty());
        self.status.set_label("No iOS simulators or Android emulators found on this machine.");
        self.list.set_visible(!devices.is_empty());
        for device in devices {
            let platform = match device.platform {
                DevicePlatform::IosSimulator => "iOS Simulator",
                DevicePlatform::AndroidEmulator => "Android Emulator",
                DevicePlatform::AndroidDevice => "Android device",
            };
            let mut subtitle = vec![platform.to_string()];
            subtitle.extend(device.runtime.clone());
            let row = adw::ActionRow::builder()
                .title(format::escape(&device.name))
                .subtitle(format::escape(&subtitle.join(" · ")))
                .build();
            row.add_prefix(&gtk::Image::from_icon_name("phone-symbolic"));
            let running = matches!(device.state.to_lowercase().as_str(), "booted" | "running" | "device" | "online");
            let pill = gtk::Label::new(Some(&format::capitalize(&device.state)));
            pill.add_css_class("ls-pill");
            if running {
                pill.add_css_class("status-done");
            }
            pill.set_valign(gtk::Align::Center);
            row.add_suffix(&pill);
            if device.platform != DevicePlatform::AndroidDevice {
                let button = gtk::Button::with_label(if running { "Shut Down" } else { "Boot" });
                button.add_css_class("flat");
                button.set_valign(gtk::Align::Center);
                let id = device.id.clone();
                let weak = self.app.clone();
                button.connect_clicked(move |button| {
                    button.set_sensitive(false);
                    let Some(app) = weak.upgrade() else { return };
                    let request = app.ask(Target::Devices);
                    let id = id.clone();
                    if running {
                        app.core.run(|studio| studio.shutdown_device(request, id));
                    } else {
                        app.core.run(|studio| studio.boot_device(request, id));
                    }
                });
                row.add_suffix(&button);
            }
            self.list.append(&row);
        }
    }

    pub fn failed(&self, text: &str) {
        self.status.set_label(text);
        self.status.set_visible(true);
    }
}

pub struct BrowserSurface {
    pub root: gtk::Box,
    pub view: webkit::WebView,
    address: gtk::Entry,
}

impl BrowserSurface {
    pub fn new() -> Self {
        let view = webkit::WebView::new();
        view.set_vexpand(true);
        let address = gtk::Entry::builder().placeholder_text("Enter a URL, e.g. localhost:3000").hexpand(true).build();
        let back = gtk::Button::builder().icon_name("go-previous-symbolic").tooltip_text("Back").build();
        let forward = gtk::Button::builder().icon_name("go-next-symbolic").tooltip_text("Forward").build();
        let reload = gtk::Button::builder().icon_name("view-refresh-symbolic").tooltip_text("Reload").build();
        let bar = gtk::Box::new(gtk::Orientation::Horizontal, 4);
        bar.set_margin_start(8);
        bar.set_margin_end(8);
        bar.set_margin_bottom(6);
        for button in [&back, &forward, &reload] {
            button.add_css_class("flat");
            bar.append(button);
        }
        bar.append(&address);
        let root = gtk::Box::new(gtk::Orientation::Vertical, 0);
        root.append(&bar);
        root.append(&view);
        let web = view.clone();
        back.connect_clicked(move |_| web.go_back());
        let web = view.clone();
        forward.connect_clicked(move |_| web.go_forward());
        let web = view.clone();
        reload.connect_clicked(move |_| web.reload());
        let web = view.clone();
        address.connect_activate(move |entry| {
            let text = entry.text().trim().to_string();
            if text.is_empty() {
                return;
            }
            let url = if text.contains("://") { text } else { format!("http://{text}") };
            web.load_uri(&url);
        });
        let field = address.clone();
        view.connect_uri_notify(move |view| {
            if let Some(uri) = view.uri() {
                field.set_text(&uri);
            }
        });
        Self { root, view, address }
    }

    pub fn load_html(&self, html: &str) {
        self.view.load_html(html, Some("http://localhost:5173/"));
        self.address.set_text("http://localhost:5173/");
    }

    pub fn focus(&self) {
        self.address.grab_focus();
    }
}
