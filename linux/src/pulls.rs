use std::cell::RefCell;
use std::rc::{Rc, Weak};

use adw::prelude::*;
use gtk::gio;
use local_studio_core::{PullRequest, PullRequestDetail};

use crate::app::{App, Target};
use crate::format;
use crate::timeline::{diff_stat, markdown_widget};

pub struct PullDetail {
    pub root: gtk::ScrolledWindow,
    content: adw::Bin,
}

impl PullDetail {
    pub fn new() -> Self {
        let content = adw::Bin::new();
        let clamp = adw::Clamp::builder().maximum_size(760).child(&content).build();
        clamp.set_margin_start(16);
        clamp.set_margin_end(16);
        clamp.set_margin_top(16);
        clamp.set_margin_bottom(24);
        let root = gtk::ScrolledWindow::builder()
            .hscrollbar_policy(gtk::PolicyType::Never)
            .vexpand(true)
            .child(&clamp)
            .build();
        let detail = Self { root, content };
        detail.message("Select a pull request.");
        detail
    }

    pub fn message(&self, text: &str) {
        let label = gtk::Label::new(Some(text));
        label.add_css_class("dim-label");
        label.set_wrap(true);
        label.set_margin_top(32);
        self.content.set_child(Some(&label));
    }

    #[allow(clippy::too_many_lines)]
    pub fn show(&self, detail: &PullRequestDetail) {
        let pull = &detail.pull;
        let column = gtk::Box::new(gtk::Orientation::Vertical, 18);
        let title = gtk::Label::new(Some(&format!("{} #{}", pull.title, pull.number)));
        title.add_css_class("title-3");
        title.set_wrap(true);
        title.set_xalign(0.0);
        column.append(&title);
        let meta = gtk::Box::new(gtk::Orientation::Horizontal, 8);
        meta.append(&state_pill(&pull.state));
        let mut facts = vec![format!("{} → {}", pull.head, pull.base)];
        if let Some(author) = &detail.author {
            facts.push(author.clone());
        }
        if let Some(created) = detail.created_at {
            facts.push(format!("opened {} ago", format::relative(created, format::now_ms())));
        }
        let facts = gtk::Label::new(Some(&facts.join(" · ")));
        facts.add_css_class("ls-meta");
        facts.set_hexpand(true);
        facts.set_xalign(0.0);
        facts.set_ellipsize(gtk::pango::EllipsizeMode::End);
        meta.append(&facts);
        let open = gtk::Button::with_label("Open");
        open.add_css_class("flat");
        let url = pull.url.clone();
        open.connect_clicked(move |button| {
            let window = button.root().and_downcast::<gtk::Window>();
            gtk::UriLauncher::new(&url).launch(window.as_ref(), None::<&gio::Cancellable>, |_| {});
        });
        meta.append(&open);
        column.append(&meta);
        if !detail.checks.is_empty() {
            let group = adw::PreferencesGroup::builder().title("Checks").build();
            for check in &detail.checks {
                let row = adw::ActionRow::builder().title(format::escape(&check.name)).build();
                let (icon, class) = match check.state.to_lowercase().as_str() {
                    "success" | "passing" | "pass" | "completed" => ("object-select-symbolic", "status-done"),
                    "failure" | "failing" | "fail" | "error" => ("dialog-error-symbolic", "status-failed"),
                    _ => ("content-loading-symbolic", "status-working"),
                };
                let image = gtk::Image::from_icon_name(icon);
                image.add_css_class(class);
                row.add_prefix(&image);
                row.add_suffix(&meta_label(&check.state));
                group.add(&row);
            }
            column.append(&group);
        }
        let body = gtk::Box::new(gtk::Orientation::Vertical, 8);
        body.add_css_class("ls-assistant");
        if detail.body.trim().is_empty() {
            let empty = gtk::Label::new(Some("No description provided."));
            empty.add_css_class("dim-label");
            empty.set_xalign(0.0);
            body.append(&empty);
        }
        for block in format::markdown(&detail.body) {
            body.append(&markdown_widget(block));
        }
        column.append(&body);
        if !detail.files.is_empty() {
            let additions: u32 = detail.files.iter().map(|file| file.additions).sum();
            let deletions: u32 = detail.files.iter().map(|file| file.deletions).sum();
            let group = adw::PreferencesGroup::builder().title(format!("{} files changed", detail.files.len())).build();
            group.set_header_suffix(Some(&diff_stat(additions, deletions)));
            for file in &detail.files {
                let row = adw::ActionRow::builder()
                    .title(format::escape(&file.path))
                    .subtitle(format::escape(&file.status))
                    .build();
                row.add_suffix(&diff_stat(file.additions, file.deletions));
                group.add(&row);
            }
            column.append(&group);
        }
        if !detail.comments.is_empty() {
            let group = adw::PreferencesGroup::builder().title("Comments").build();
            for comment in &detail.comments {
                let mut heading = comment.author.clone();
                if let Some(path) = &comment.path {
                    heading.push_str(" on ");
                    heading.push_str(path);
                    if let Some(line) = comment.line {
                        heading = format!("{heading}:{line}");
                    }
                }
                let row = adw::ActionRow::builder()
                    .title(format::escape(&heading))
                    .subtitle(format::escape(comment.body.trim()))
                    .build();
                if let Some(created) = comment.created_at {
                    row.add_suffix(&meta_label(&format::relative(created, format::now_ms())));
                }
                group.add(&row);
            }
            column.append(&group);
        }
        if !detail.timeline.is_empty() {
            let group = adw::PreferencesGroup::builder().title("Timeline").build();
            for event in &detail.timeline {
                let title = match &event.actor {
                    Some(actor) => format!("{actor} · {}", event.kind),
                    None => event.kind.clone(),
                };
                let row = adw::ActionRow::builder()
                    .title(format::escape(&title))
                    .subtitle(format::escape(&event.text))
                    .build();
                if let Some(created) = event.created_at {
                    row.add_suffix(&meta_label(&format::relative(created, format::now_ms())));
                }
                group.add(&row);
            }
            column.append(&group);
        }
        self.content.set_child(Some(&column));
        self.root.vadjustment().set_value(0.0);
    }
}

pub fn pull_row(pull: &PullRequest) -> adw::ActionRow {
    let row = adw::ActionRow::builder()
        .title(format::escape(&pull.title))
        .subtitle(format::escape(&format!("#{} · {} → {} · checks {}", pull.number, pull.head, pull.base, pull.checks)))
        .subtitle_lines(1)
        .activatable(true)
        .build();
    row.add_suffix(&state_pill(&pull.state));
    row
}

fn state_pill(state: &str) -> gtk::Label {
    let label = gtk::Label::new(Some(&format::capitalize(&state.to_lowercase())));
    label.add_css_class("ls-pill");
    label.add_css_class(match state.to_uppercase().as_str() {
        "OPEN" => "status-done",
        "MERGED" => "status-woke",
        _ => "status-failed",
    });
    label.set_valign(gtk::Align::Center);
    label
}

fn meta_label(text: &str) -> gtk::Label {
    let label = gtk::Label::new(Some(text));
    label.add_css_class("ls-meta");
    label.set_valign(gtk::Align::Center);
    label
}

pub struct PullsPage {
    pub root: gtk::Paned,
    filter: adw::ToggleGroup,
    list: gtk::ListBox,
    status: gtk::Label,
    detail: PullDetail,
    pulls: RefCell<Vec<PullRequest>>,
    shown: RefCell<Vec<PullRequest>>,
    project: RefCell<Option<String>>,
}

impl PullsPage {
    pub fn new(app: Weak<App>) -> Self {
        let filter = adw::ToggleGroup::new();
        for (name, label) in [("open", "Open"), ("merged", "Merged"), ("closed", "Closed"), ("all", "All")] {
            filter.add(adw::Toggle::builder().name(name).label(label).build());
        }
        filter.set_active_name(Some("open"));
        filter.set_margin_start(12);
        filter.set_margin_end(12);
        filter.set_margin_top(12);
        let status = gtk::Label::new(Some("Loading pull requests…"));
        status.add_css_class("dim-label");
        status.set_margin_top(18);
        status.set_wrap(true);
        let list = gtk::ListBox::new();
        list.add_css_class("navigation-sidebar");
        let column = gtk::Box::new(gtk::Orientation::Vertical, 8);
        column.append(&filter);
        column.append(&status);
        column.append(&list);
        let scroller = gtk::ScrolledWindow::builder().hscrollbar_policy(gtk::PolicyType::Never).child(&column).build();
        scroller.set_size_request(360, -1);
        let detail = PullDetail::new();
        let root = gtk::Paned::new(gtk::Orientation::Horizontal);
        root.set_start_child(Some(&scroller));
        root.set_end_child(Some(&detail.root));
        root.set_position(400);
        root.set_shrink_start_child(false);
        let weak = app.clone();
        filter.connect_active_name_notify(move |_| {
            if let Some(app) = weak.upgrade() {
                app.pulls.render();
            }
        });
        let weak = app;
        list.connect_row_activated(move |_, row| {
            let Some(app) = weak.upgrade() else { return };
            let pull = usize::try_from(row.index()).ok().and_then(|index| app.pulls.shown.borrow().get(index).cloned());
            let project = app.pulls.project.borrow().clone();
            if let (Some(pull), Some(project)) = (pull, project) {
                app.pulls.detail.message(&format!("Loading #{}…", pull.number));
                let request = app.ask(Target::PagePull);
                app.core.run(|studio| studio.load_pull_request(request, project, pull.number));
            }
        });
        Self {
            root,
            filter,
            list,
            status,
            detail,
            pulls: RefCell::new(Vec::new()),
            shown: RefCell::new(Vec::new()),
            project: RefCell::new(None),
        }
    }

    pub fn refresh(&self, app: &Rc<App>) {
        let project = app.state.borrow().current_project();
        self.project.replace(project.clone());
        let Some(project) = project else {
            self.status.set_label("Add a project to see its pull requests.");
            return;
        };
        self.status.set_label("Loading pull requests…");
        self.status.set_visible(true);
        let request = app.ask(Target::PagePulls);
        app.core.run(|studio| studio.list_pull_requests(request, project));
    }

    pub fn loaded(&self, pulls: &[PullRequest]) {
        self.pulls.replace(pulls.to_vec());
        self.render();
    }

    pub fn detail(&self, detail: &PullRequestDetail) {
        self.detail.show(detail);
    }

    pub fn failed(&self, message: &str) {
        self.status.set_label(message);
        self.status.set_visible(true);
        self.detail.message(message);
    }

    fn render(&self) {
        let filter = self.filter.active_name().map(|name| name.to_uppercase()).unwrap_or_default();
        let shown: Vec<PullRequest> = self
            .pulls
            .borrow()
            .iter()
            .filter(|pull| filter == "ALL" || pull.state.to_uppercase() == filter)
            .cloned()
            .collect();
        self.list.remove_all();
        for pull in &shown {
            self.list.append(&pull_row(pull));
        }
        self.status.set_visible(shown.is_empty());
        self.status.set_label("No pull requests in this view.");
        self.shown.replace(shown);
    }

    pub fn set_fixture(&self, pulls: &[PullRequest], detail: &PullRequestDetail) {
        self.project.replace(Some("fixture".to_string()));
        self.loaded(pulls);
        self.detail.show(detail);
    }
}
