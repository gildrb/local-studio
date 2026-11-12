use std::cell::RefCell;
use std::rc::{Rc, Weak};

use adw::prelude::*;
use gtk::pango;
use local_studio_core::{LocalController, LocalElsewhere, LocalEndpoint, LocalEngineState, LocalMachineStatus};

use crate::app::App;
use crate::dashboard_parts::{self as parts, label};
use crate::icons;
use crate::numbers;

pub fn status_class(status: LocalMachineStatus) -> &'static str {
    match status {
        LocalMachineStatus::Serving => "serving",
        LocalMachineStatus::Loading => "loading",
        LocalMachineStatus::EngineUnreachable => "unreachable",
        LocalMachineStatus::NoModel => "idle",
        LocalMachineStatus::Offline => "offline",
    }
}

pub fn status_label(status: LocalMachineStatus) -> &'static str {
    match status {
        LocalMachineStatus::EngineUnreachable => "engine not answering",
        other => status_class(other),
    }
}

pub fn dot(status: LocalMachineStatus) -> gtk::Box {
    let dot = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    dot.add_css_class("ls-machine-dot");
    dot.add_css_class(status_class(status));
    dot.set_valign(gtk::Align::Center);
    dot
}

pub fn set_tone(label: &gtk::Label, controller: &LocalController) {
    let failed =
        controller.jobs.first().is_some_and(|job| job.failed) && controller.status != LocalMachineStatus::Serving;
    let warn = controller.status == LocalMachineStatus::EngineUnreachable
        || controller.endpoints.iter().any(|endpoint| endpoint.stale);
    for class in ["error", "warning", "dim-label"] {
        label.remove_css_class(class);
    }
    label.add_css_class(if failed {
        "error"
    } else if warn {
        "warning"
    } else {
        "dim-label"
    });
}

pub struct ElsewhereLink {
    pub button: gtk::Button,
    target: Rc<RefCell<String>>,
}

impl ElsewhereLink {
    pub fn build(app: &Weak<App>) -> Self {
        let button = gtk::Button::builder().halign(gtk::Align::Start).build();
        button.add_css_class("link");
        button.add_css_class("flat");
        button.set_visible(false);
        let target = Rc::new(RefCell::new(String::new()));
        let weak = app.clone();
        let url = Rc::clone(&target);
        button.connect_clicked(move |_| {
            if let Some(app) = weak.upgrade() {
                let url = url.borrow().clone();
                app.local.select(&url);
            }
        });
        Self { button, target }
    }

    pub fn set(&self, elsewhere: Option<&LocalElsewhere>) {
        self.button.set_visible(elsewhere.is_some());
        if let Some(elsewhere) = elsewhere {
            self.button.set_label(&format!("Show {}", elsewhere.name));
            self.target.replace(elsewhere.url.clone());
        }
    }
}

fn row(endpoint: &LocalEndpoint) -> gtk::Box {
    let status = match endpoint.state {
        LocalEngineState::Loaded => LocalMachineStatus::Serving,
        LocalEngineState::Empty => LocalMachineStatus::NoModel,
        LocalEngineState::Unreachable => LocalMachineStatus::EngineUnreachable,
    };
    let models = if endpoint.models.is_empty() { "No models listed".to_string() } else { endpoint.models.join(", ") };
    let name = label(&models, &["ls-dash-name"]);
    name.set_selectable(true);
    name.set_ellipsize(pango::EllipsizeMode::Middle);
    let state = match endpoint.state {
        LocalEngineState::Loaded if endpoint.stale => "loaded, not confirmed recently",
        LocalEngineState::Loaded => "loaded",
        LocalEngineState::Empty => "no model loaded",
        LocalEngineState::Unreachable => "not answering",
    };
    let calm = endpoint.state == LocalEngineState::Loaded && !endpoint.stale;
    let state = label(state, &[if calm { "dim-label" } else { "warning" }, "ls-dash-small"]);
    let line = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    line.append(&dot(status));
    line.append(&name);
    line.append(&state);
    let mut facts: Vec<String> = endpoint.provider.iter().cloned().collect();
    facts.push(endpoint.address.clone());
    if let Some(latency) = endpoint.latency_ms.filter(|_| calm) {
        facts.push(format!("answered in {latency} ms"));
    }
    if let Some(confirmed) = endpoint.confirmed_at_ms {
        facts.push(format!("confirmed {}", numbers::ago(confirmed)));
    }
    facts.extend(endpoint.error.iter().cloned());
    let facts = label(&facts.join(" · "), &["dim-label", "ls-dash-small"]);
    facts.set_wrap(true);
    facts.set_selectable(true);
    let row = gtk::Box::new(gtk::Orientation::Vertical, 4);
    row.append(&line);
    row.append(&facts);
    row
}

pub struct EngineView {
    pub root: gtk::Box,
    headline: gtk::Label,
    detail: gtk::Label,
    elsewhere: ElsewhereLink,
    list: gtk::Box,
    note_box: gtk::Box,
    note: gtk::Label,
}

impl EngineView {
    pub fn build(app: &Weak<App>) -> Self {
        let headline = label(" ", &["ls-dash-model"]);
        headline.set_ellipsize(pango::EllipsizeMode::Middle);
        headline.set_selectable(true);
        let detail = label(" ", &["dim-label", "ls-dash-label"]);
        detail.set_wrap(true);
        detail.set_selectable(true);
        let elsewhere = ElsewhereLink::build(app);
        let titles = gtk::Box::new(gtk::Orientation::Vertical, 5);
        titles.set_margin_top(34);
        titles.append(&headline);
        titles.append(&detail);
        titles.append(&elsewhere.button);
        let list = gtk::Box::new(gtk::Orientation::Vertical, 18);
        list.set_margin_top(36);
        let note = label("", &["dim-label", "ls-dash-label"]);
        note.set_wrap(true);
        let add = parts::button(&gtk::Label::new(Some("Add a controller…")), true);
        add.set_halign(gtk::Align::Start);
        let weak = app.clone();
        add.connect_clicked(move |_| {
            if let Some(app) = weak.upgrade() {
                app.open_settings(Some("local"));
            }
        });
        let text = gtk::Box::new(gtk::Orientation::Vertical, 10);
        text.append(&note);
        text.append(&add);
        let note_box = gtk::Box::new(gtk::Orientation::Horizontal, 12);
        note_box.append(&icons::image(icons::COMPUTER));
        note_box.append(&text);
        let root = gtk::Box::new(gtk::Orientation::Vertical, 0);
        root.append(&titles);
        root.append(&list);
        root.append(&parts::hairline(32, 32));
        root.append(&note_box);
        Self { root, headline, detail, elsewhere, list, note_box, note }
    }

    pub fn fill(&self, controller: &LocalController) {
        self.headline.set_label(&controller.headline);
        self.detail.set_label(&controller.detail);
        set_tone(&self.detail, controller);
        self.elsewhere.set(controller.elsewhere.as_ref());
        while let Some(child) = self.list.first_child() {
            self.list.remove(&child);
        }
        for endpoint in &controller.endpoints {
            self.list.append(&row(endpoint));
        }
        self.note_box.set_visible(controller.note.is_some());
        self.note.set_label(controller.note.as_deref().unwrap_or_default());
    }
}
