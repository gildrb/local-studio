use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::rc::{Rc, Weak};

use adw::prelude::*;
use gtk::glib;
use local_studio_core::{LocalAction, LocalController, LocalRecord, LocalShare, LocalSnapshot, LocalUsage};

use crate::app::App;
use crate::format;
use crate::pages::{chart_card, meta, metric, pill};
use crate::state::{Page, State};

const REGISTRY_PAGE: usize = 25;

#[derive(Clone)]
pub struct Fleet {
    inner: Rc<Inner>,
}

struct Inner {
    app: Weak<App>,
    root: gtk::Box,
    error: gtk::Label,
    machines: adw::Bin,
    extras: adw::Bin,
    registry: adw::Bin,
    registry_status: gtk::Label,
    filter: gtk::SearchEntry,
    usage: adw::Bin,
    expanded: RefCell<HashSet<String>>,
    armed: RefCell<Option<String>>,
    registry_limit: Cell<usize>,
    scanning: Cell<bool>,
    #[allow(clippy::option_option)]
    shown: RefCell<Option<Option<LocalSnapshot>>>,
}

impl Fleet {
    pub fn new(app: &Weak<App>) -> Self {
        let content = gtk::Box::new(gtk::Orientation::Vertical, 24);
        let error = gtk::Label::new(None);
        error.add_css_class("error");
        error.set_wrap(true);
        error.set_xalign(0.0);
        error.set_visible(false);
        let machines = adw::Bin::new();
        let extras = adw::Bin::new();
        let filter = gtk::SearchEntry::builder().placeholder_text("Filter models, engines, hardware").build();
        let registry_status = gtk::Label::new(None);
        registry_status.add_css_class("ls-meta");
        registry_status.set_xalign(0.0);
        registry_status.set_wrap(true);
        let registry_head = gtk::Box::new(gtk::Orientation::Vertical, 8);
        let registry_title = gtk::Label::new(Some("Registry"));
        registry_title.add_css_class("heading");
        registry_title.set_xalign(0.0);
        registry_head.append(&registry_title);
        registry_head.append(&registry_status);
        registry_head.append(&filter);
        let registry = adw::Bin::new();
        let usage = adw::Bin::new();
        content.append(&error);
        content.append(&machines);
        content.append(&extras);
        content.append(&registry_head);
        content.append(&registry);
        content.append(&usage);
        content.append(&about_group());
        let inner = Rc::new(Inner {
            app: app.clone(),
            root: content,
            error,
            machines,
            extras,
            registry,
            registry_status,
            filter,
            usage,
            expanded: RefCell::new(HashSet::new()),
            armed: RefCell::new(None),
            registry_limit: Cell::new(REGISTRY_PAGE),
            scanning: Cell::new(false),
            shown: RefCell::new(None),
        });
        let weak = Rc::downgrade(&inner);
        inner.filter.connect_search_changed(move |_| {
            let Some(fleet) = weak.upgrade() else { return };
            let Some(app) = fleet.app.upgrade() else { return };
            fleet.registry_limit.set(REGISTRY_PAGE);
            fleet.render_registry(app.state.borrow().local.as_ref());
        });
        poll(&inner);
        Self { inner }
    }

    pub fn widget(&self) -> &gtk::Box {
        &self.inner.root
    }

    pub fn render(&self, state: &State) {
        self.inner.render(state);
    }
}

fn poll(inner: &Rc<Inner>) {
    if let Some(app) = inner.app.upgrade() {
        let request = app.core.request();
        app.core.run(|studio| studio.local_snapshot(request));
    }
    let weak = Rc::downgrade(inner);
    glib::timeout_add_seconds_local(5, move || {
        let Some(fleet) = weak.upgrade() else { return glib::ControlFlow::Break };
        let Some(app) = fleet.app.upgrade() else { return glib::ControlFlow::Break };
        if app.state.borrow().page != Page::Local && crate::app::on_screen(&fleet.root) {
            let request = app.core.request();
            app.core.run(|studio| studio.local_snapshot(request));
        }
        glib::ControlFlow::Continue
    });
}

fn about_group() -> adw::PreferencesGroup {
    let about = adw::PreferencesGroup::builder().title("About Local").build();
    let about_text = gtk::Label::new(Some(
        "Every machine runs the Local controller. It finds its peers over Tailscale, launches models from Local AI Registry recipes, and serves them behind one gateway.\n\nNVIDIA GPUs on Linux with Docker run any registry recipe; Macs can serve the models they already have.",
    ));
    about_text.set_wrap(true);
    about_text.set_xalign(0.0);
    about_text.add_css_class("dim-label");
    about.add(&about_text);
    let link = gtk::LinkButton::with_label(
        "https://local-ai-registry.vercel.app/?topic=hardware",
        "See supported hardware and models",
    );
    link.set_halign(gtk::Align::Start);
    about.add(&link);
    about
}

impl Inner {
    fn act(&self, action: LocalAction) {
        let Some(app) = self.app.upgrade() else { return };
        let request = app.core.request();
        app.core.run(|studio| studio.local_action(request, action));
    }

    fn render(self: &Rc<Self>, state: &State) {
        let snapshot = state.local.as_ref();
        let unchanged = self.shown.borrow().as_ref().is_some_and(|shown| shown.as_ref() == snapshot);
        if unchanged && !self.scanning.get() {
            return;
        }
        self.shown.replace(Some(snapshot.cloned()));
        self.scanning.set(false);
        let error = snapshot.and_then(|snapshot| snapshot.error.clone());
        self.error.set_visible(error.is_some());
        self.error.set_label(error.as_deref().unwrap_or_default());
        self.machines.set_child(Some(&self.machines_group(snapshot)));
        self.extras.set_child(snapshot.map(|snapshot| self.extras_box(snapshot)).as_ref());
        self.render_registry(snapshot);
        self.usage.set_child(Some(&usage_group(snapshot.map(|snapshot| &snapshot.usage))));
    }

    fn machines_group(self: &Rc<Self>, snapshot: Option<&LocalSnapshot>) -> adw::PreferencesGroup {
        let group = adw::PreferencesGroup::builder().title("Machines").build();
        let scan = gtk::Button::with_label(if self.scanning.get() { "Scanning…" } else { "Scan Tailnet" });
        scan.add_css_class("flat");
        let weak = Rc::downgrade(self);
        scan.connect_clicked(move |button| {
            let Some(fleet) = weak.upgrade() else { return };
            fleet.scanning.set(true);
            button.set_label("Scanning…");
            fleet.act(LocalAction::ScanTailnet);
        });
        group.set_header_suffix(Some(&scan));
        let Some(snapshot) = snapshot else {
            group.add(&adw::ActionRow::builder().title("Loading machines…").build());
            return group;
        };
        if snapshot.controllers.is_empty() {
            group.add(
                &adw::ActionRow::builder()
                    .title("No machines yet")
                    .subtitle("Start the Local controller, or scan your tailnet.")
                    .build(),
            );
        }
        for controller in &snapshot.controllers {
            group.add(&self.controller_row(controller));
        }
        group
    }

    fn controller_row(self: &Rc<Self>, controller: &LocalController) -> adw::ExpanderRow {
        let loading = controller.jobs.iter().find(|job| !job.failed);
        let (dot, subtitle) = if !controller.reachable {
            ("offline", controller.error.clone().unwrap_or_else(|| "Offline".to_string()))
        } else if let Some(job) = loading {
            ("loading", format!("Loading {} · {}", job.recipe_id, job.detail))
        } else if controller.endpoints.iter().any(|endpoint| endpoint.live) {
            (
                "serving",
                controller
                    .endpoints
                    .iter()
                    .flat_map(|endpoint| endpoint.models.iter().cloned())
                    .collect::<Vec<_>>()
                    .join(", "),
            )
        } else {
            ("idle", "No model loaded".to_string())
        };
        let mut title = format::escape(&controller.name);
        if controller.local {
            title.push_str("  <span size=\"small\" alpha=\"55%\">this machine</span>");
        }
        let row =
            adw::ExpanderRow::builder().title(title).subtitle(format::escape(&subtitle)).subtitle_lines(1).build();
        let status = gtk::Box::new(gtk::Orientation::Horizontal, 0);
        status.add_css_class("ls-dot");
        status.add_css_class(dot);
        status.set_valign(gtk::Align::Center);
        row.add_prefix(&status);
        if let Some(meter) = memory_meter(controller) {
            row.add_suffix(&meter);
        }
        let key = controller.target.clone();
        row.set_expanded(self.expanded.borrow().contains(&key));
        let weak = Rc::downgrade(self);
        row.connect_expanded_notify(move |row| {
            let Some(fleet) = weak.upgrade() else { return };
            let mut expanded = fleet.expanded.borrow_mut();
            if row.is_expanded() {
                expanded.insert(key.clone());
            } else {
                expanded.remove(&key);
            }
        });
        for child in facts(controller) {
            row.add_row(&child);
        }
        for endpoint in &controller.endpoints {
            row.add_row(&self.endpoint_row(controller, endpoint.port, &endpoint.models.join(", "), endpoint.live));
        }
        for job in &controller.jobs {
            row.add_row(&self.job_row(controller, job));
        }
        if let Some(combo) = self.loader(controller) {
            row.add_row(&combo);
        }
        let rename = adw::EntryRow::builder().title("Name").text(&controller.name).show_apply_button(true).build();
        let weak = Rc::downgrade(self);
        let target = controller.target.clone();
        rename.connect_apply(move |entry| {
            if let Some(fleet) = weak.upgrade() {
                fleet.act(LocalAction::Rename { controller: target.clone(), name: entry.text().to_string() });
            }
        });
        row.add_row(&rename);
        row
    }

    fn endpoint_row(
        self: &Rc<Self>,
        controller: &LocalController,
        port: u16,
        models: &str,
        live: bool,
    ) -> adw::ActionRow {
        let endpoint_row = adw::ActionRow::builder()
            .title(format::escape(models))
            .subtitle(format!(":{port}{}", if live { "" } else { " · starting" }))
            .build();
        let armed_key = format!("{}:{port}", controller.target);
        let armed = self.armed.borrow().as_deref() == Some(armed_key.as_str());
        let unload = gtk::Button::with_label(if armed { "Confirm unload" } else { "Unload" });
        unload.add_css_class("flat");
        if armed {
            unload.add_css_class("destructive-action");
        }
        unload.set_valign(gtk::Align::Center);
        let weak = Rc::downgrade(self);
        let target = controller.target.clone();
        unload.connect_clicked(move |button| {
            let Some(fleet) = weak.upgrade() else { return };
            let armed = fleet.armed.borrow().as_deref() == Some(armed_key.as_str());
            if armed {
                fleet.armed.replace(None);
                button.set_label("Unloading…");
                button.set_sensitive(false);
                fleet.act(LocalAction::StopPort { controller: target.clone(), port });
            } else {
                fleet.armed.replace(Some(armed_key.clone()));
                button.set_label("Confirm unload");
                button.add_css_class("destructive-action");
            }
        });
        endpoint_row.add_suffix(&unload);
        let share = gtk::Button::with_label("Share");
        share.add_css_class("flat");
        share.set_valign(gtk::Align::Center);
        let weak = Rc::downgrade(self);
        let target = controller.target.clone();
        share.connect_clicked(move |_| {
            if let Some(fleet) = weak.upgrade() {
                fleet.act(LocalAction::PreviewShare { controller: target.clone(), port });
            }
        });
        endpoint_row.add_suffix(&share);
        endpoint_row
    }

    fn job_row(self: &Rc<Self>, controller: &LocalController, job: &local_studio_core::LocalJob) -> adw::ActionRow {
        let job_row = adw::ActionRow::builder()
            .title(format::escape(&job.recipe_id))
            .subtitle(format::escape(&job.detail))
            .build();
        if job.failed {
            job_row.add_css_class("error");
        }
        let cancel = gtk::Button::with_label(if job.failed { "Dismiss" } else { "Cancel" });
        cancel.add_css_class("flat");
        cancel.set_valign(gtk::Align::Center);
        let weak = Rc::downgrade(self);
        let target = controller.target.clone();
        let run = job.id.clone();
        cancel.connect_clicked(move |_| {
            if let Some(fleet) = weak.upgrade() {
                fleet.act(LocalAction::StopRun { controller: target.clone(), run: run.clone() });
            }
        });
        job_row.add_suffix(&cancel);
        job_row
    }

    fn loader(self: &Rc<Self>, controller: &LocalController) -> Option<adw::ComboRow> {
        let ready: Vec<_> =
            controller.recipes.iter().filter(|recipe| recipe.fits && recipe.blocked.is_none()).collect();
        let first = ready.first()?;
        if !controller.reachable {
            return None;
        }
        let names: Vec<String> = ready.iter().map(|recipe| format!("{} · {}", recipe.model, recipe.engine)).collect();
        let refs: Vec<&str> = names.iter().map(String::as_str).collect();
        let combo = adw::ComboRow::builder().title("Load a model").model(&gtk::StringList::new(&refs)).build();
        combo.set_subtitle(&format::escape(&first.detail));
        let details: Vec<String> = ready.iter().map(|recipe| recipe.detail.clone()).collect();
        combo.connect_selected_notify(move |combo| {
            if let Some(detail) = usize::try_from(combo.selected()).ok().and_then(|index| details.get(index)) {
                combo.set_subtitle(&format::escape(detail));
            }
        });
        let load = gtk::Button::with_label("Load");
        load.add_css_class("suggested-action");
        load.set_valign(gtk::Align::Center);
        let ids: Vec<String> = ready.iter().map(|recipe| recipe.id.clone()).collect();
        let weak = Rc::downgrade(self);
        let target = controller.target.clone();
        let replace = !controller.endpoints.is_empty();
        let picker = combo.clone();
        load.connect_clicked(move |button| {
            let Some(fleet) = weak.upgrade() else { return };
            let Some(recipe) = usize::try_from(picker.selected()).ok().and_then(|index| ids.get(index)) else {
                return;
            };
            button.set_label("Loading…");
            button.set_sensitive(false);
            fleet.act(LocalAction::RunRecipe { controller: target.clone(), recipe: recipe.clone(), replace });
        });
        combo.add_suffix(&load);
        Some(combo)
    }

    fn extras_box(self: &Rc<Self>, snapshot: &LocalSnapshot) -> gtk::Box {
        let column = gtk::Box::new(gtk::Orientation::Vertical, 24);
        if let Some(tailnet) = &snapshot.tailnet {
            let group = adw::PreferencesGroup::builder().title("Tailnet").build();
            if !tailnet.available {
                group.set_description(Some("Tailscale is not available on this machine."));
            }
            for device in &tailnet.devices {
                let row = adw::ActionRow::builder()
                    .title(format::escape(&device.name))
                    .subtitle(format::escape(&format!("{} · {}", device.ip, device.os)))
                    .build();
                let (label, action) = match (&device.controller_url, device.linked) {
                    (Some(url), true) => ("Disconnect", LocalAction::Disconnect { url: url.clone() }),
                    (Some(url), false) => ("Connect", LocalAction::Connect { url: url.clone() }),
                    (None, _) => ("Deploy", LocalAction::Deploy { ip: device.ip.clone(), name: device.name.clone() }),
                };
                let button = gtk::Button::with_label(label);
                button.add_css_class("flat");
                button.set_valign(gtk::Align::Center);
                let weak = Rc::downgrade(self);
                button.connect_clicked(move |button| {
                    button.set_sensitive(false);
                    if let Some(fleet) = weak.upgrade() {
                        fleet.act(action.clone());
                    }
                });
                row.add_suffix(&button);
                group.add(&row);
            }
            column.append(&group);
        }
        if let Some(record) = &snapshot.record {
            column.append(&record_group(record));
        }
        if let Some(share) = &snapshot.share {
            column.append(&self.share_group(share));
        }
        column
    }

    fn share_group(self: &Rc<Self>, share: &LocalShare) -> adw::PreferencesGroup {
        let group = adw::PreferencesGroup::builder()
            .title("Share to the registry")
            .description(format::escape(&share.title))
            .build();
        for (title, value) in
            [("Target", share.target.clone()), ("Branch", share.branch.clone()), ("Files", share.files.join(", "))]
        {
            group.add(&adw::ActionRow::builder().title(title).subtitle(format::escape(&value)).build());
        }
        for (title, values) in
            [("Scrubbed", &share.redactions), ("Issues", &share.issues), ("Blockers", &share.blockers)]
        {
            if !values.is_empty() {
                group.add(&adw::ActionRow::builder().title(title).subtitle(format::escape(&values.join("\n"))).build());
            }
        }
        if let Some(url) = &share.pull_request_url {
            let link = gtk::LinkButton::with_label(url, "Pull request opened");
            group.add(&link);
        } else if share.blockers.is_empty() {
            let create = gtk::Button::with_label("Create PR");
            create.add_css_class("suggested-action");
            create.add_css_class("pill");
            create.set_halign(gtk::Align::Start);
            create.set_margin_top(8);
            let weak = Rc::downgrade(self);
            let (controller, port) = (share.controller.clone(), share.port);
            create.connect_clicked(move |button| {
                button.set_label("Creating PR…");
                button.set_sensitive(false);
                if let Some(fleet) = weak.upgrade() {
                    fleet.act(LocalAction::Share { controller: controller.clone(), port });
                }
            });
            group.add(&create);
        }
        group
    }

    fn render_registry(self: &Rc<Self>, snapshot: Option<&LocalSnapshot>) {
        let group = adw::PreferencesGroup::new();
        let Some(registry) = snapshot.and_then(|snapshot| snapshot.registry.as_ref()) else {
            self.registry_status.set_label("The registry loads with the first snapshot.");
            self.registry.set_child(Some(&group));
            return;
        };
        let matched = registry
            .matches
            .iter()
            .map(|entry| format!("{}× {}", entry.count, entry.name))
            .collect::<Vec<_>>()
            .join(", ");
        let query = self.filter.text().to_lowercase();
        let models: Vec<_> = registry
            .models
            .iter()
            .filter(|model| {
                query.is_empty()
                    || model.repo.to_lowercase().contains(&query)
                    || model.variants.iter().any(|variant| {
                        variant.engine.to_lowercase().contains(&query)
                            || variant.hardware_id.to_lowercase().contains(&query)
                    })
            })
            .collect();
        let mut parts = Vec::new();
        if !matched.is_empty() {
            parts.push(format!("Matched {matched}"));
        }
        parts.push(format!("{} of {} models", models.len(), registry.total));
        if let Some(commit) = &registry.commit {
            parts.push(commit.chars().take(7).collect::<String>());
        }
        if let Some(error) = &registry.error {
            parts.push(error.clone());
        }
        self.registry_status.set_label(&parts.join(" · "));
        let limit = self.registry_limit.get();
        for model in models.iter().take(limit) {
            let fits = model.variants.iter().filter(|variant| variant.fits).count();
            let row = adw::ExpanderRow::builder()
                .title(format::escape(&model.repo))
                .subtitle(format!("{} variants · {fits} fit", model.variants.len()))
                .build();
            for variant in &model.variants {
                let downloading = registry.downloads.iter().any(|download| download.recipe == variant.id);
                row.add_row(&self.variant_row(&registry.controller, variant, downloading));
            }
            group.add(&row);
        }
        if models.len() > limit {
            let more = gtk::Button::with_label(&format!("Show more ({} left)", models.len() - limit));
            more.add_css_class("flat");
            more.set_margin_top(6);
            let weak = Rc::downgrade(self);
            more.connect_clicked(move |_| {
                let Some(fleet) = weak.upgrade() else { return };
                let Some(app) = fleet.app.upgrade() else { return };
                fleet.registry_limit.set(fleet.registry_limit.get() + REGISTRY_PAGE);
                fleet.render_registry(app.state.borrow().local.as_ref());
            });
            group.add(&more);
        }
        self.registry.set_child(Some(&group));
    }

    fn variant_row(
        self: &Rc<Self>,
        controller: &str,
        variant: &local_studio_core::RegistryVariant,
        downloading: bool,
    ) -> adw::ActionRow {
        let mut detail = vec![format!("{} × {}", variant.hardware_count, variant.hardware_id)];
        detail.extend(variant.format.clone());
        detail.extend(variant.precision.clone());
        if let Some(size) = variant.size_gb {
            detail.push(format!("{size:.0} GB"));
        }
        let child = adw::ActionRow::builder()
            .title(format::escape(&format!("{} · {}", variant.engine, variant.status)))
            .subtitle(format::escape(&detail.join(" · ")))
            .build();
        if variant.recommended {
            child.add_suffix(&pill("Recommended"));
        }
        if variant.fits {
            child.add_suffix(&pill("Fits"));
        }
        let inspect = gtk::Button::with_label("Inspect");
        inspect.add_css_class("flat");
        inspect.set_valign(gtk::Align::Center);
        let weak = Rc::downgrade(self);
        let (target, record) = (controller.to_string(), variant.id.clone());
        inspect.connect_clicked(move |_| {
            if let Some(fleet) = weak.upgrade() {
                fleet.act(LocalAction::Inspect { controller: target.clone(), record: record.clone() });
            }
        });
        child.add_suffix(&inspect);
        let download = gtk::Button::with_label(if downloading { "Downloading…" } else { "Download" });
        download.add_css_class("flat");
        download.set_valign(gtk::Align::Center);
        download.set_sensitive(!downloading);
        let weak = Rc::downgrade(self);
        let (target, record) = (controller.to_string(), variant.id.clone());
        download.connect_clicked(move |button| {
            button.set_label("Downloading…");
            button.set_sensitive(false);
            if let Some(fleet) = weak.upgrade() {
                fleet.act(LocalAction::Download { controller: target.clone(), record: record.clone() });
            }
        });
        child.add_suffix(&download);
        child
    }
}

fn memory_meter(controller: &LocalController) -> Option<gtk::Box> {
    let hardware = controller.hardware.as_ref().filter(|hardware| hardware.memory_capacity_bytes > 0)?;
    let meter = gtk::Box::new(gtk::Orientation::Vertical, 2);
    meter.set_valign(gtk::Align::Center);
    #[allow(clippy::cast_precision_loss)]
    let fraction = hardware.memory_used_bytes as f64 / hardware.memory_capacity_bytes as f64;
    let bar = gtk::LevelBar::for_interval(0.0, 1.0);
    bar.set_value(fraction.clamp(0.0, 1.0));
    bar.set_size_request(96, 4);
    let label = gtk::Label::new(Some(&format!(
        "{} {} / {}",
        hardware.memory_label,
        format::gigabytes(hardware.memory_used_bytes),
        format::gigabytes(hardware.memory_capacity_bytes)
    )));
    label.add_css_class("ls-meta");
    meter.append(&label);
    meter.append(&bar);
    Some(meter)
}

fn facts(controller: &LocalController) -> Vec<adw::ActionRow> {
    let address = adw::ActionRow::builder().title("Address").subtitle(format::escape(&controller.url)).build();
    if let Some(version) = &controller.version {
        address.add_suffix(&meta(&format!("v{version}")));
    }
    let served = adw::ActionRow::builder()
        .title("Served")
        .subtitle(format!(
            "{} tokens · {} requests",
            format::tokens(controller.tokens),
            format::tokens(controller.requests)
        ))
        .build();
    let mut rows = vec![address, served];
    if let Some(hardware) = &controller.hardware {
        rows.push(
            adw::ActionRow::builder()
                .title("Hardware")
                .subtitle(format::escape(&format!(
                    "{} · {} CPUs",
                    if hardware.gpu_summary.is_empty() { "No GPU" } else { &hardware.gpu_summary },
                    hardware.cpus
                )))
                .build(),
        );
    }
    rows
}

fn record_group(record: &LocalRecord) -> adw::PreferencesGroup {
    let group = adw::PreferencesGroup::builder().title(format::escape(&format!("Record {}", record.id))).build();
    if let Some(command) = &record.command {
        let label = gtk::Label::new(Some(command));
        label.add_css_class("ls-mono");
        label.set_wrap(true);
        label.set_wrap_mode(gtk::pango::WrapMode::WordChar);
        label.set_selectable(true);
        label.set_xalign(0.0);
        let frame = gtk::Box::new(gtk::Orientation::Vertical, 6);
        frame.add_css_class("ls-code");
        frame.append(&label);
        let copy = gtk::Button::with_label("Use config");
        copy.add_css_class("flat");
        copy.set_halign(gtk::Align::Start);
        let text = command.clone();
        copy.connect_clicked(move |button| {
            button.clipboard().set_text(&text);
            button.set_label("Copied");
        });
        frame.append(&copy);
        group.add(&frame);
    }
    if let Some(repo) = &record.weights_repo {
        group.add(
            &adw::ActionRow::builder()
                .title("Weights")
                .subtitle(format::escape(&format!(
                    "{repo}{}",
                    record.weights_revision.as_deref().map(|revision| format!(" @ {revision}")).unwrap_or_default()
                )))
                .build(),
        );
    }
    for (title, json) in [
        ("Recipe", &record.recipe_json),
        ("Model instance", &record.model_instance_json),
        ("Model", &record.model_json),
        ("Hardware", &record.hardware_json),
    ] {
        if json.trim().is_empty() {
            continue;
        }
        let row = adw::ExpanderRow::builder().title(title).build();
        let label = gtk::Label::new(Some(json));
        label.add_css_class("ls-mono");
        label.set_selectable(true);
        label.set_xalign(0.0);
        label.set_margin_start(12);
        label.set_margin_end(12);
        label.set_margin_top(8);
        label.set_margin_bottom(8);
        row.add_row(&label);
        group.add(&row);
    }
    group
}

fn usage_group(usage: Option<&LocalUsage>) -> adw::PreferencesGroup {
    let group = adw::PreferencesGroup::builder().title("Usage").build();
    let Some(usage) = usage else { return group };
    let metrics = gtk::Box::new(gtk::Orientation::Horizontal, 10);
    metrics.set_homogeneous(true);
    metrics.append(&metric("Today", &format::tokens(usage.today_tokens), "tokens"));
    metrics.append(&metric("This week", &format::tokens(usage.week_tokens), "tokens"));
    metrics.append(&metric("All time", &format::tokens(usage.all_tokens), "tokens"));
    metrics.append(&metric(
        "Requests",
        &format::tokens(usage.requests),
        &format!("{} measured", format::tokens(usage.measured_requests)),
    ));
    group.add(&metrics);
    let chart = chart_card("Daily processed tokens", &usage.daily, false);
    chart.set_margin_top(10);
    group.add(&chart);
    let list = gtk::ListBox::new();
    list.add_css_class("boxed-list");
    list.set_selection_mode(gtk::SelectionMode::None);
    list.set_margin_top(10);
    for model in &usage.models {
        let row = adw::ActionRow::builder()
            .title(format::escape(&model.model))
            .subtitle(format!(
                "{} requests · {:.0}% share{}",
                format::tokens(model.requests),
                model.share_percent,
                if model.measured { "" } else { " · estimated" }
            ))
            .build();
        row.add_suffix(&meta(&format!("{} tokens", format::tokens(model.tokens))));
        list.append(&row);
    }
    if !usage.models.is_empty() {
        group.add(&list);
    }
    group
}
