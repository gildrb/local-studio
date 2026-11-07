use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::rc::{Rc, Weak};

use adw::prelude::*;
use gtk::glib;
use local_studio_core::{
    LocalAction, LocalController, LocalRecord, LocalShare, LocalSnapshot, LocalUsage, UsageDay, UsagePeriod,
    UsageReport,
};

use crate::app::App;
use crate::format;
use crate::state::{Page, State};

const REGISTRY_PAGE: usize = 25;

pub struct LocalPage {
    pub root: gtk::ScrolledWindow,
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
    polling: Cell<bool>,
    app: Weak<App>,
}

impl LocalPage {
    pub fn new(app: Weak<App>) -> Self {
        let content = gtk::Box::new(gtk::Orientation::Vertical, 24);
        content.set_margin_top(24);
        content.set_margin_bottom(32);
        content.set_margin_start(20);
        content.set_margin_end(20);
        let intro = gtk::Label::new(Some(
            "Machines on your tailnet that run the Local controller, the models they serve, and what they processed.",
        ));
        intro.add_css_class("dim-label");
        intro.set_wrap(true);
        intro.set_xalign(0.0);
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
        content.append(&intro);
        content.append(&error);
        content.append(&machines);
        content.append(&extras);
        content.append(&registry_head);
        content.append(&registry);
        content.append(&usage);
        content.append(&about);
        let clamp = adw::Clamp::builder().maximum_size(860).child(&content).build();
        let root = gtk::ScrolledWindow::builder().hscrollbar_policy(gtk::PolicyType::Never).child(&clamp).build();
        let weak = app.clone();
        filter.connect_search_changed(move |_| {
            let Some(app) = weak.upgrade() else { return };
            app.local.registry_limit.set(REGISTRY_PAGE);
            let state = app.state.borrow();
            app.local.render_registry(state.local.as_ref());
        });
        Self {
            root,
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
            polling: Cell::new(false),
            app,
        }
    }

    pub fn refresh(&self, app: &Rc<App>) {
        let request = app.core.request();
        app.core.run(|studio| studio.local_snapshot(request));
        if self.polling.replace(true) {
            return;
        }
        let weak = Rc::downgrade(app);
        glib::timeout_add_seconds_local(5, move || {
            let Some(app) = weak.upgrade() else { return glib::ControlFlow::Break };
            if app.state.borrow().page != Page::Local {
                app.local.polling.set(false);
                return glib::ControlFlow::Break;
            }
            let request = app.core.request();
            app.core.run(|studio| studio.local_snapshot(request));
            glib::ControlFlow::Continue
        });
    }

    pub fn request_failed(&self) {
        self.scanning.set(false);
    }

    fn act(&self, action: LocalAction) {
        let Some(app) = self.app.upgrade() else { return };
        let request = app.core.request();
        app.core.run(|studio| studio.local_action(request, action));
    }

    pub fn render(&self, state: &State) {
        let snapshot = state.local.as_ref();
        self.scanning.set(false);
        let error = snapshot.and_then(|snapshot| snapshot.error.clone());
        self.error.set_visible(error.is_some());
        self.error.set_label(error.as_deref().unwrap_or_default());
        self.machines.set_child(Some(&self.machines_group(snapshot)));
        self.extras.set_child(snapshot.map(|snapshot| self.extras_box(snapshot)).as_ref());
        self.render_registry(snapshot);
        self.usage.set_child(Some(&usage_group(snapshot.map(|snapshot| &snapshot.usage))));
    }

    fn machines_group(&self, snapshot: Option<&LocalSnapshot>) -> adw::PreferencesGroup {
        let group = adw::PreferencesGroup::builder().title("Machines").build();
        let scan = gtk::Button::with_label(if self.scanning.get() { "Scanning…" } else { "Scan tailnet" });
        scan.add_css_class("flat");
        let weak = self.app.clone();
        scan.connect_clicked(move |button| {
            let Some(app) = weak.upgrade() else { return };
            app.local.scanning.set(true);
            button.set_label("Scanning…");
            app.local.act(LocalAction::ScanTailnet);
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

    #[allow(clippy::too_many_lines)]
    fn controller_row(&self, controller: &LocalController) -> adw::ExpanderRow {
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
        if let Some(hardware) = &controller.hardware {
            if hardware.memory_capacity_bytes > 0 {
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
                row.add_suffix(&meter);
            }
        }
        let key = controller.target.clone();
        row.set_expanded(self.expanded.borrow().contains(&key));
        let weak = self.app.clone();
        row.connect_expanded_notify(move |row| {
            let Some(app) = weak.upgrade() else { return };
            let mut expanded = app.local.expanded.borrow_mut();
            if row.is_expanded() {
                expanded.insert(key.clone());
            } else {
                expanded.remove(&key);
            }
        });
        let address = adw::ActionRow::builder().title("Address").subtitle(format::escape(&controller.url)).build();
        if let Some(version) = &controller.version {
            address.add_suffix(&meta(&format!("v{version}")));
        }
        row.add_row(&address);
        let served = adw::ActionRow::builder()
            .title("Served")
            .subtitle(format!(
                "{} tokens · {} requests",
                format::tokens(controller.tokens),
                format::tokens(controller.requests)
            ))
            .build();
        row.add_row(&served);
        if let Some(hardware) = &controller.hardware {
            row.add_row(
                &adw::ActionRow::builder()
                    .title("Hardware")
                    .subtitle(format::escape(&format!(
                        "{} · {} CPUs",
                        if hardware.gpu_summary.is_empty() { "No GPU" } else { &hardware.gpu_summary },
                        hardware.cpus
                    )))
                    .build(),
            );
        }
        for endpoint in &controller.endpoints {
            let endpoint_row = adw::ActionRow::builder()
                .title(format::escape(&endpoint.models.join(", ")))
                .subtitle(format!(":{}{}", endpoint.port, if endpoint.live { "" } else { " · starting" }))
                .build();
            let armed_key = format!("{}:{}", controller.target, endpoint.port);
            let armed = self.armed.borrow().as_deref() == Some(armed_key.as_str());
            let unload = gtk::Button::with_label(if armed { "Confirm unload" } else { "Unload" });
            unload.add_css_class("flat");
            if armed {
                unload.add_css_class("destructive-action");
            }
            unload.set_valign(gtk::Align::Center);
            let weak = self.app.clone();
            let target = controller.target.clone();
            let port = endpoint.port;
            unload.connect_clicked(move |button| {
                let Some(app) = weak.upgrade() else { return };
                let armed = app.local.armed.borrow().as_deref() == Some(armed_key.as_str());
                if armed {
                    app.local.armed.replace(None);
                    button.set_label("Unloading…");
                    button.set_sensitive(false);
                    app.local.act(LocalAction::StopPort { controller: target.clone(), port });
                } else {
                    app.local.armed.replace(Some(armed_key.clone()));
                    button.set_label("Confirm unload");
                    button.add_css_class("destructive-action");
                }
            });
            endpoint_row.add_suffix(&unload);
            let share = gtk::Button::with_label("Share");
            share.add_css_class("flat");
            share.set_valign(gtk::Align::Center);
            let weak = self.app.clone();
            let target = controller.target.clone();
            share.connect_clicked(move |_| {
                if let Some(app) = weak.upgrade() {
                    app.local.act(LocalAction::PreviewShare { controller: target.clone(), port });
                }
            });
            endpoint_row.add_suffix(&share);
            row.add_row(&endpoint_row);
        }
        for job in &controller.jobs {
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
            let weak = self.app.clone();
            let target = controller.target.clone();
            let run = job.id.clone();
            cancel.connect_clicked(move |_| {
                if let Some(app) = weak.upgrade() {
                    app.local.act(LocalAction::StopRun { controller: target.clone(), run: run.clone() });
                }
            });
            job_row.add_suffix(&cancel);
            row.add_row(&job_row);
        }
        let ready: Vec<_> =
            controller.recipes.iter().filter(|recipe| recipe.fits && recipe.blocked.is_none()).collect();
        if controller.reachable && !ready.is_empty() {
            let names: Vec<String> =
                ready.iter().map(|recipe| format!("{} · {}", recipe.model, recipe.engine)).collect();
            let refs: Vec<&str> = names.iter().map(String::as_str).collect();
            let combo = adw::ComboRow::builder().title("Load a model").model(&gtk::StringList::new(&refs)).build();
            combo.set_subtitle(&format::escape(&ready[0].detail));
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
            let weak = self.app.clone();
            let target = controller.target.clone();
            let replace = !controller.endpoints.is_empty();
            let picker = combo.clone();
            load.connect_clicked(move |button| {
                let Some(app) = weak.upgrade() else { return };
                let Some(recipe) = usize::try_from(picker.selected()).ok().and_then(|index| ids.get(index)) else {
                    return;
                };
                button.set_label("Loading…");
                button.set_sensitive(false);
                app.local.act(LocalAction::RunRecipe { controller: target.clone(), recipe: recipe.clone(), replace });
            });
            combo.add_suffix(&load);
            row.add_row(&combo);
        }
        let rename = adw::EntryRow::builder().title("Name").text(&controller.name).show_apply_button(true).build();
        let weak = self.app.clone();
        let target = controller.target.clone();
        rename.connect_apply(move |entry| {
            if let Some(app) = weak.upgrade() {
                app.local.act(LocalAction::Rename { controller: target.clone(), name: entry.text().to_string() });
            }
        });
        row.add_row(&rename);
        row
    }

    fn extras_box(&self, snapshot: &LocalSnapshot) -> gtk::Box {
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
                let weak = self.app.clone();
                button.connect_clicked(move |button| {
                    button.set_sensitive(false);
                    if let Some(app) = weak.upgrade() {
                        app.local.act(action.clone());
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

    fn share_group(&self, share: &LocalShare) -> adw::PreferencesGroup {
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
            let weak = self.app.clone();
            let (controller, port) = (share.controller.clone(), share.port);
            create.connect_clicked(move |button| {
                button.set_label("Creating PR…");
                button.set_sensitive(false);
                if let Some(app) = weak.upgrade() {
                    app.local.act(LocalAction::Share { controller: controller.clone(), port });
                }
            });
            group.add(&create);
        }
        group
    }

    #[allow(clippy::too_many_lines)]
    fn render_registry(&self, snapshot: Option<&LocalSnapshot>) {
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
        let status = parts.join(" · ");
        self.registry_status.set_label(&status);
        let limit = self.registry_limit.get();
        for model in models.iter().take(limit) {
            let fits = model.variants.iter().filter(|variant| variant.fits).count();
            let row = adw::ExpanderRow::builder()
                .title(format::escape(&model.repo))
                .subtitle(format!("{} variants · {fits} fit", model.variants.len()))
                .build();
            for variant in &model.variants {
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
                let weak = self.app.clone();
                let controller = registry.controller.clone();
                let record = variant.id.clone();
                inspect.connect_clicked(move |_| {
                    if let Some(app) = weak.upgrade() {
                        app.local.act(LocalAction::Inspect { controller: controller.clone(), record: record.clone() });
                    }
                });
                child.add_suffix(&inspect);
                let downloading = registry.downloads.iter().find(|download| download.recipe == variant.id);
                let download = gtk::Button::with_label(downloading.map_or("Download", |_| "Downloading…"));
                download.add_css_class("flat");
                download.set_valign(gtk::Align::Center);
                download.set_sensitive(downloading.is_none());
                let weak = self.app.clone();
                let controller = registry.controller.clone();
                let record = variant.id.clone();
                download.connect_clicked(move |button| {
                    button.set_label("Downloading…");
                    button.set_sensitive(false);
                    if let Some(app) = weak.upgrade() {
                        app.local.act(LocalAction::Download { controller: controller.clone(), record: record.clone() });
                    }
                });
                child.add_suffix(&download);
                row.add_row(&child);
            }
            group.add(&row);
        }
        if models.len() > limit {
            let more = gtk::Button::with_label(&format!("Show more ({} left)", models.len() - limit));
            more.add_css_class("flat");
            more.set_margin_top(6);
            let weak = self.app.clone();
            more.connect_clicked(move |_| {
                let Some(app) = weak.upgrade() else { return };
                app.local.registry_limit.set(app.local.registry_limit.get() + REGISTRY_PAGE);
                let state = app.state.borrow();
                app.local.render_registry(state.local.as_ref());
            });
            group.add(&more);
        }
        self.registry.set_child(Some(&group));
    }
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
    let chart = chart_card("Daily processed tokens", &usage.daily);
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

pub struct UsagePage {
    pub root: gtk::ScrolledWindow,
    periods: adw::ToggleGroup,
    body: adw::Bin,
}

impl UsagePage {
    pub fn new(app: Weak<App>) -> Self {
        let content = gtk::Box::new(gtk::Orientation::Vertical, 20);
        content.set_margin_top(24);
        content.set_margin_bottom(32);
        content.set_margin_start(20);
        content.set_margin_end(20);
        let periods = adw::ToggleGroup::new();
        for (name, label) in [("day", "Day"), ("week", "Week"), ("month", "Month"), ("quarter", "Quarter")] {
            periods.add(adw::Toggle::builder().name(name).label(label).build());
        }
        periods.set_active_name(Some("week"));
        periods.set_halign(gtk::Align::Start);
        let body = adw::Bin::new();
        content.append(&periods);
        content.append(&body);
        let clamp = adw::Clamp::builder().maximum_size(860).child(&content).build();
        let root = gtk::ScrolledWindow::builder().hscrollbar_policy(gtk::PolicyType::Never).child(&clamp).build();
        let weak = app;
        periods.connect_active_name_notify(move |_| {
            if let Some(app) = weak.upgrade() {
                app.usage.refresh(&app);
            }
        });
        Self { root, periods, body }
    }

    fn period(&self) -> UsagePeriod {
        match self.periods.active_name().as_deref() {
            Some("day") => UsagePeriod::Day,
            Some("month") => UsagePeriod::Month,
            Some("quarter") => UsagePeriod::Quarter,
            _ => UsagePeriod::Week,
        }
    }

    pub fn refresh(&self, app: &Rc<App>) {
        let period = self.period();
        app.state.borrow_mut().usage_period = Some(period);
        let request = app.core.request();
        app.core.run(|studio| studio.load_usage(request, period));
    }

    pub fn render(&self, state: &State) {
        let child = if let Some(report) = &state.usage {
            report_view(report)
        } else {
            let label = gtk::Label::new(Some("Loading usage…"));
            label.add_css_class("dim-label");
            label.upcast()
        };
        self.body.set_child(Some(&child));
    }
}

fn report_view(report: &UsageReport) -> gtk::Widget {
    let column = gtk::Box::new(gtk::Orientation::Vertical, 20);
    let metrics = gtk::Box::new(gtk::Orientation::Horizontal, 10);
    metrics.set_homogeneous(true);
    metrics.append(&metric("Cost", &format::cost(report.cost_usd), "estimated"));
    metrics.append(&metric(
        "Tokens",
        &format::tokens(report.total_tokens),
        &format!("{} in · {} out", format::tokens(report.input_tokens), format::tokens(report.output_tokens)),
    ));
    metrics.append(&metric("Sessions", &report.requests.to_string(), "with usage"));
    column.append(&metrics);
    if !report.limits.is_empty() {
        let limits = adw::PreferencesGroup::builder()
            .title("Limits")
            .description("Provider rate windows reported by the Eukhe daemon")
            .build();
        for limit in &report.limits {
            let mut subtitle = Vec::new();
            if let Some(percent) = limit.used_percent {
                subtitle.push(format!("{percent:.0}% used"));
            }
            if let Some(resets) = limit.resets_at {
                subtitle.push(format!("resets in {}", format::countdown(resets, format::now_ms())));
            }
            let row = adw::ActionRow::builder()
                .title(format::escape(&format!("{} · {}", limit.provider, limit.window)))
                .subtitle(subtitle.join(" · "))
                .build();
            if limit.parked {
                row.add_suffix(&pill("Parked"));
            }
            if let Some(percent) = limit.used_percent {
                let bar = gtk::LevelBar::for_interval(0.0, 100.0);
                bar.set_value(percent.clamp(0.0, 100.0));
                bar.set_size_request(140, 6);
                bar.set_valign(gtk::Align::Center);
                row.add_suffix(&bar);
            }
            limits.add(&row);
        }
        column.append(&limits);
    }
    column.append(&chart_card("Daily tokens", &report.daily));
    let group = adw::PreferencesGroup::builder().title("By model").build();
    if report.by_model.is_empty() {
        group.add(&adw::ActionRow::builder().title("No usage in this period").build());
    }
    for model in &report.by_model {
        let row = adw::ActionRow::builder()
            .title(format::escape(&model.model))
            .subtitle(format::escape(&format!("{} · {} sessions", model.provider, model.requests)))
            .build();
        row.add_suffix(&meta(&format!("{} tokens · {}", format::tokens(model.tokens), format::cost(model.cost_usd))));
        group.add(&row);
    }
    column.append(&group);
    column.upcast()
}

fn metric(title: &str, value: &str, caption: &str) -> gtk::Box {
    let card = gtk::Box::new(gtk::Orientation::Vertical, 2);
    card.add_css_class("ls-metric");
    let title = gtk::Label::new(Some(title));
    title.add_css_class("ls-meta");
    title.set_xalign(0.0);
    let value = gtk::Label::new(Some(value));
    value.add_css_class("value");
    value.set_xalign(0.0);
    let caption = gtk::Label::new(Some(caption));
    caption.add_css_class("ls-meta");
    caption.set_xalign(0.0);
    caption.set_ellipsize(gtk::pango::EllipsizeMode::End);
    card.append(&title);
    card.append(&value);
    card.append(&caption);
    card
}

fn chart_card(title: &str, days: &[UsageDay]) -> gtk::Box {
    let card = gtk::Box::new(gtk::Orientation::Vertical, 8);
    card.add_css_class("ls-metric");
    let label = gtk::Label::new(Some(title));
    label.add_css_class("ls-meta");
    label.set_xalign(0.0);
    card.append(&label);
    #[allow(clippy::cast_precision_loss)]
    let values: Vec<f64> = days.iter().map(|day| day.tokens as f64).collect();
    let first = days.first().map(|day| day.day.clone()).unwrap_or_default();
    let last = days.last().map(|day| day.day.clone()).unwrap_or_default();
    let area = gtk::DrawingArea::new();
    area.set_content_height(120);
    area.set_hexpand(true);
    area.set_draw_func(move |area, cairo, width, height| {
        let color = area.color();
        #[allow(clippy::cast_lossless)]
        let (width, height) = (f64::from(width), f64::from(height));
        let max = values.iter().copied().fold(0.0_f64, f64::max).max(1.0);
        #[allow(clippy::cast_precision_loss)]
        let count = values.len().max(1) as f64;
        let slot = width / count;
        let bar = (slot * 0.7).max(1.0);
        cairo.set_source_rgba(0.204, 0.420, 0.945, 1.0);
        for (index, value) in values.iter().enumerate() {
            let size = (value / max) * (height - 6.0);
            #[allow(clippy::cast_precision_loss)]
            let x = index as f64 * slot + (slot - bar) / 2.0;
            cairo.rectangle(x, height - size, bar, size.max(if *value > 0.0 { 2.0 } else { 0.0 }));
        }
        cairo.fill().ok();
        cairo.set_source_rgba(f64::from(color.red()), f64::from(color.green()), f64::from(color.blue()), 0.08);
        cairo.rectangle(0.0, height - 1.0, width, 1.0);
        cairo.fill().ok();
    });
    card.append(&area);
    let axis = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    let start = gtk::Label::new(Some(&first));
    start.add_css_class("ls-meta");
    start.set_hexpand(true);
    start.set_xalign(0.0);
    let end = gtk::Label::new(Some(&last));
    end.add_css_class("ls-meta");
    axis.append(&start);
    axis.append(&end);
    card.append(&axis);
    card
}

fn meta(text: &str) -> gtk::Label {
    let label = gtk::Label::new(Some(text));
    label.add_css_class("ls-meta");
    label.set_valign(gtk::Align::Center);
    label
}

fn pill(text: &str) -> gtk::Label {
    let label = gtk::Label::new(Some(text));
    label.add_css_class("ls-pill");
    label.set_valign(gtk::Align::Center);
    label
}
