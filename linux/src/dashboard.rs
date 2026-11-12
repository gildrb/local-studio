use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::{Rc, Weak};

use adw::prelude::*;
use gtk::{glib, pango};
use local_studio_core::{
    LocalAction, LocalController, LocalDashboard, LocalEndpoint, LocalEngineState, LocalGpuTelemetry,
    LocalMachineStatus, LocalRecipe,
};

use crate::app::App;
use crate::dashboard_charts::{Heatmap, Sparkline};
use crate::dashboard_engines::{self as engines, ElsewhereLink, EngineView};
use crate::dashboard_parts::{self as parts, label, Figure, FigureView, Hero, TokenSummary, Tone};
use crate::format;
use crate::icons;
use crate::numbers;
use crate::state::{Page, State};

const DEFAULT_CONTROLLER: &str = "http://127.0.0.1:18091";

fn serving(controller: &LocalController) -> Vec<&LocalEndpoint> {
    controller
        .endpoints
        .iter()
        .filter(|endpoint| endpoint.state == LocalEngineState::Loaded && !endpoint.controller_id.is_empty())
        .collect()
}

struct View {
    root: gtk::Box,
    model: gtk::Label,
    detail: gtk::Label,
    elsewhere: ElsewhereLink,
    switch: adw::ButtonContent,
    switch_button: gtk::Button,
    stop: adw::ButtonContent,
    stop_button: gtk::Button,
    error: gtk::Box,
    error_label: gtk::Label,
    decode: Hero,
    sparkline: Sparkline,
    figures: [FigureView; 6],
    summary: TokenSummary,
    heatmap: Heatmap,
}

impl View {
    #[allow(clippy::too_many_lines)]
    fn build(app: &Weak<App>) -> Self {
        let model = label(" ", &["ls-dash-model"]);
        model.set_ellipsize(pango::EllipsizeMode::Middle);
        model.set_selectable(true);
        let detail = label(" ", &["dim-label", "ls-dash-label"]);
        detail.set_wrap(true);
        detail.set_lines(2);
        detail.set_ellipsize(pango::EllipsizeMode::End);
        detail.set_selectable(true);
        let elsewhere = ElsewhereLink::build(app);
        let titles = gtk::Box::new(gtk::Orientation::Vertical, 5);
        titles.set_hexpand(true);
        titles.append(&model);
        titles.append(&detail);
        titles.append(&elsewhere.button);
        let switch = adw::ButtonContent::builder().icon_name(icons::SWITCH).label("Switch model…").build();
        let switch_button = parts::button(&switch, true);
        let weak = app.clone();
        switch_button.connect_clicked(move |_| {
            if let Some(app) = weak.upgrade() {
                app.local.open_switch(&app);
            }
        });
        let stop = adw::ButtonContent::builder().icon_name(icons::STOP).label("Stop model…").build();
        let stop_button = parts::button(&stop, false);
        let weak = app.clone();
        stop_button.connect_clicked(move |_| {
            if let Some(app) = weak.upgrade() {
                app.local.confirm_stop(&app);
            }
        });
        let header = gtk::Box::new(gtk::Orientation::Horizontal, 12);
        header.set_margin_top(34);
        header.append(&titles);
        header.append(&switch_button);
        header.append(&stop_button);
        let error_label = label("", &["ls-dash-label"]);
        error_label.set_wrap(true);
        error_label.set_selectable(true);
        let error = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        error.add_css_class("warning");
        error.set_margin_top(14);
        error.append(&icons::image(icons::WARNING));
        error.append(&error_label);
        error.set_visible(false);
        let decode = Hero::build("Decode", "tok/s");
        let sparkline = Sparkline::build();
        let figures = [
            FigureView::build("First token"),
            FigureView::build("In flight"),
            FigureView::build("KV cache"),
            FigureView::build("GPUs"),
            FigureView::build("Memory"),
            FigureView::build("Power"),
        ];
        let chart_title = label("Decode, last 24 hours", &["dim-label", "ls-dash-label"]);
        let grid = parts::figure_grid(&decode, &chart_title, &sparkline, &[&figures[..3], &figures[3..]]);
        let left = gtk::Box::new(gtk::Orientation::Vertical, 0);
        left.set_hexpand(true);
        left.append(&header);
        left.append(&error);
        left.append(&grid);
        let summary = TokenSummary::build(&[]);
        summary.move_since();
        let heatmap = Heatmap::build();
        let root = gtk::Box::new(gtk::Orientation::Vertical, 0);
        root.append(&parts::columns(&left, &summary));
        root.append(&parts::hairline(36, 44));
        root.append(&heatmap.root);
        Self {
            root,
            model,
            detail,
            elsewhere,
            switch,
            switch_button,
            stop,
            stop_button,
            error,
            error_label,
            decode,
            sparkline,
            figures,
            summary,
            heatmap,
        }
    }

    fn fill(&self, controller: &LocalController, dashboard: Option<&LocalDashboard>, loading: bool, unloading: bool) {
        let endpoint = serving(controller).first().copied();
        self.model.set_label(&controller.headline);
        self.detail.set_label(&header_detail(controller, endpoint, dashboard));
        engines::set_tone(&self.detail, controller);
        self.elsewhere.set(controller.elsewhere.as_ref());
        self.switch.set_label(if loading {
            "Switching…"
        } else if endpoint.is_none() {
            "Load model…"
        } else {
            "Switch model…"
        });
        self.switch_button.set_sensitive(!loading);
        self.stop_button.set_visible(endpoint.is_some());
        self.stop.set_label(if unloading { "Stopping…" } else { "Stop model…" });
        self.stop_button.set_sensitive(!unloading);
        let error = dashboard.and_then(|dashboard| dashboard.error.as_deref());
        self.error.set_visible(error.is_some());
        self.error_label.set_label(error.unwrap_or_default());
        let decode = dashboard.and_then(|dashboard| dashboard.decode_tps).map(numbers::decimal);
        self.decode.set("Decode", decode.as_deref(), "tok/s", &decode_hint(dashboard));
        self.sparkline.set(dashboard.map_or(&[][..], |dashboard| dashboard.decode_series.as_slice()));
        let figures = figures(dashboard);
        for (view, figure) in self.figures.iter().zip(figures.iter()) {
            view.set(figure);
        }
        let tokens = dashboard.map(|dashboard| &dashboard.tokens);
        self.summary.set(tokens, "Counted from engine metrics as models serve requests.");
        self.heatmap.set(
            tokens.map(|tokens| (parts::token_values(tokens), tokens.last_day.as_str())),
            numbers::tokens,
            "Tokens per day, last year",
        );
    }
}

fn header_detail(
    controller: &LocalController,
    endpoint: Option<&LocalEndpoint>,
    dashboard: Option<&LocalDashboard>,
) -> String {
    let loaded = endpoint.filter(|endpoint| !endpoint.stale).and_then(|endpoint| {
        dashboard
            .and_then(|dashboard| dashboard.engines.iter().find(|engine| engine.port == endpoint.port))
            .and_then(|engine| engine.loaded_at_ms)
    });
    match loaded {
        Some(at) => format!("{} · {}", numbers::loaded(at), controller.detail),
        None => controller.detail.clone(),
    }
}

fn decode_hint(dashboard: Option<&LocalDashboard>) -> String {
    let Some(dashboard) = dashboard else { return " ".to_string() };
    if let Some(per_request) = dashboard.per_request_tps {
        return format!("{} per request", numbers::decimal(per_request));
    }
    if dashboard.decode_tps.is_some() {
        "No requests in flight".to_string()
    } else if dashboard.engines.is_empty() {
        "No engine running".to_string()
    } else {
        "The engine reports no metrics".to_string()
    }
}

fn figures(dashboard: Option<&LocalDashboard>) -> [Figure; 6] {
    let first_token = Figure::new(
        dashboard.and_then(|dashboard| dashboard.first_token_ms).map(numbers::whole),
        "ms",
        dashboard
            .and_then(|dashboard| dashboard.first_token_best_ms)
            .map(|best| format!("best {} ms", numbers::whole(best))),
    );
    let running = dashboard.and_then(|dashboard| dashboard.running);
    let waiting = dashboard
        .and_then(|dashboard| dashboard.waiting)
        .filter(|waiting| *waiting > 0)
        .map(|waiting| format!("{waiting} waiting"));
    let peak = dashboard.and_then(|dashboard| dashboard.running_peak).map(|peak| format!("peak {peak}"));
    let flight_hint = match (peak, waiting) {
        (Some(peak), Some(waiting)) => Some(format!("{peak}, {waiting}")),
        (peak, waiting) => peak.or(waiting),
    };
    let in_flight = Figure::new(
        running.as_ref().map(ToString::to_string),
        if running == Some(1) { "request" } else { "requests" },
        flight_hint,
    );
    let kv_cache = Figure::new(
        dashboard.and_then(|dashboard| dashboard.kv_percent).map(numbers::whole),
        "% used",
        dashboard
            .and_then(|dashboard| dashboard.kv_peak_percent)
            .map(|peak| format!("peak {}", numbers::percent(peak))),
    );
    [first_token, in_flight, kv_cache, gpu_figure(dashboard), memory_figure(dashboard), power_figure(dashboard)]
}

fn gpu_figure(dashboard: Option<&LocalDashboard>) -> Figure {
    let Some(dashboard) = dashboard else { return Figure::new(None, "cards", None) };
    let count = dashboard.gpus.len();
    Figure::new(
        Some(count.to_string()),
        if count == 1 { "card" } else { "cards" },
        Some(if dashboard.gpu_name.is_empty() {
            "No NVIDIA GPU reported".to_string()
        } else {
            dashboard.gpu_name.clone()
        }),
    )
}

fn memory_figure(dashboard: Option<&LocalDashboard>) -> Figure {
    let Some(dashboard) = dashboard.filter(|dashboard| dashboard.memory_total_bytes > 0) else {
        return Figure::new(None, "GB", None);
    };
    let used = numbers::gigabytes(dashboard.memory_used_bytes);
    let total = numbers::gigabytes(dashboard.memory_total_bytes);
    let free = numbers::gigabytes(
        dashboard.memory_total_bytes - dashboard.memory_used_bytes.min(dashboard.memory_total_bytes),
    );
    Figure::new(Some(used), &format!("of {total} GB"), Some(format!("{free} GB free")))
}

fn power_figure(dashboard: Option<&LocalDashboard>) -> Figure {
    let Some((dashboard, watts)) =
        dashboard.and_then(|dashboard| dashboard.power_watts.map(|watts| (dashboard, watts)))
    else {
        return Figure::new(None, "W", None);
    };
    let limit = dashboard.power_limit_watts.map(|limit| format!("limit {} W", numbers::whole(limit)));
    match gpu_flag(&dashboard.gpus) {
        Some((text, tone)) => {
            Figure { value: Some(numbers::whole(watts)), unit: "W".to_string(), hint: Some(text), tone }
        }
        None => Figure::new(Some(numbers::whole(watts)), "W", limit),
    }
}

fn gpu_flag(gpus: &[LocalGpuTelemetry]) -> Option<(String, Tone)> {
    let mut flags: Vec<(u8, String, Tone)> = Vec::new();
    for gpu in gpus {
        let name = format!("G{}", gpu.index);
        if let Some(temperature) = gpu.temperature_c.filter(|temperature| *temperature >= 88.0) {
            flags.push((3, format!("{name} too hot, {} °C", numbers::whole(temperature)), Tone::Danger));
        }
        if let (Some(watts), Some(limit)) = (gpu.power_watts, gpu.power_limit_watts) {
            if watts.round() > limit.round() {
                let over = numbers::whole(watts.round() - limit.round());
                flags.push((2, format!("{name} {over} W over limit"), Tone::Warning));
            }
        }
        if let Some(temperature) = gpu.temperature_c.filter(|temperature| (80.0..88.0).contains(temperature)) {
            flags.push((1, format!("{name} running warm, {} °C", numbers::whole(temperature)), Tone::Warning));
        }
    }
    let others = flags.len().saturating_sub(1);
    let (_, text, tone) = flags.into_iter().rev().max_by_key(|flag| flag.0)?;
    Some((if others > 0 { format!("{text}, {others} more") } else { text }, tone))
}

fn recipe_list(ready: &[LocalRecipe], choice: &Rc<RefCell<Option<String>>>) -> gtk::ScrolledWindow {
    let list = gtk::ListBox::new();
    list.add_css_class("boxed-list");
    list.set_selection_mode(gtk::SelectionMode::None);
    let mut first: Option<gtk::CheckButton> = None;
    for recipe in ready {
        let check = gtk::CheckButton::new();
        check.set_valign(gtk::Align::Center);
        if let Some(leader) = &first {
            check.set_group(Some(leader));
        } else {
            check.set_active(true);
            first = Some(check.clone());
        }
        let id = recipe.id.clone();
        let picked = Rc::clone(choice);
        check.connect_toggled(move |check| {
            if check.is_active() {
                picked.replace(Some(id.clone()));
            }
        });
        let row = adw::ActionRow::builder()
            .title(format::escape(&recipe.model))
            .subtitle(format::escape(&recipe.detail))
            .build();
        row.add_prefix(&check);
        row.set_activatable_widget(Some(&check));
        list.append(&row);
    }
    gtk::ScrolledWindow::builder()
        .hscrollbar_policy(gtk::PolicyType::Never)
        .propagate_natural_height(true)
        .max_content_height(320)
        .child(&list)
        .build()
}

pub struct LocalPage {
    pub root: gtk::ScrolledWindow,
    app: Weak<App>,
    online: gtk::Label,
    since: gtk::Label,
    notice: gtk::Label,
    tabs: gtk::Box,
    tab_buttons: RefCell<Vec<(String, gtk::ToggleButton)>>,
    tab_keys: RefCell<Vec<(String, String, LocalMachineStatus)>>,
    stack: gtk::Stack,
    empty: adw::StatusPage,
    offline: adw::StatusPage,
    view: View,
    engines: EngineView,
    selected: RefCell<Option<String>>,
    shown: RefCell<Option<LocalController>>,
    desired: RefCell<Option<String>>,
    watching: RefCell<Option<String>>,
    pending: RefCell<HashMap<String, String>>,
    snapshot_request: RefCell<Option<String>>,
    failure: RefCell<Option<String>>,
    building: Cell<bool>,
    polling: Cell<bool>,
}

impl LocalPage {
    pub fn new(app: Weak<App>) -> Self {
        let online = label("", &["dim-label", "ls-dash-label"]);
        let since = label("", &["dim-label", "ls-dash-label"]);
        since.set_visible(false);
        let tabs = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        let bar = top_bar(&app, &tabs, &since, &online);
        let notice = label("", &["warning", "ls-dash-label"]);
        notice.set_wrap(true);
        notice.set_selectable(true);
        notice.set_margin_top(10);
        notice.set_visible(false);
        let view = View::build(&app);
        let engines = EngineView::build(&app);
        let empty =
            adw::StatusPage::builder().icon_name(icons::SERVER).title("Contacting the Local controller…").build();
        empty.set_size_request(-1, 360);
        let offline = adw::StatusPage::builder().icon_name(icons::OFFLINE).build();
        offline.set_size_request(-1, 420);
        let stack = gtk::Stack::new();
        stack.set_vhomogeneous(false);
        stack.add_named(&view.root, Some("dashboard"));
        stack.add_named(&engines.root, Some("engines"));
        stack.add_named(&offline, Some("offline"));
        stack.add_named(&empty, Some("empty"));
        stack.set_visible_child_name("empty");
        let content = gtk::Box::new(gtk::Orientation::Vertical, 0);
        content.set_margin_start(40);
        content.set_margin_end(40);
        content.set_margin_top(12);
        content.set_margin_bottom(32);
        content.append(&bar);
        content.append(&notice);
        content.append(&stack);
        let root = gtk::ScrolledWindow::builder().hscrollbar_policy(gtk::PolicyType::Never).child(&content).build();
        let weak = app.clone();
        root.connect_map(move |_| {
            if let Some(app) = weak.upgrade() {
                app.local.watch(true);
            }
        });
        let weak = app.clone();
        root.connect_unmap(move |_| {
            if let Some(app) = weak.upgrade() {
                app.local.watch(false);
            }
        });
        Self {
            root,
            app,
            online,
            since,
            notice,
            tabs,
            tab_buttons: RefCell::new(Vec::new()),
            tab_keys: RefCell::new(Vec::new()),
            stack,
            empty,
            offline,
            view,
            engines,
            selected: RefCell::new(None),
            shown: RefCell::new(None),
            desired: RefCell::new(None),
            watching: RefCell::new(None),
            pending: RefCell::new(HashMap::new()),
            snapshot_request: RefCell::new(None),
            failure: RefCell::new(None),
            building: Cell::new(false),
            polling: Cell::new(false),
        }
    }

    pub fn refresh(&self, app: &Rc<App>) {
        self.request_snapshot(app);
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
            app.local.request_snapshot(&app);
            glib::ControlFlow::Continue
        });
    }

    fn request_snapshot(&self, app: &Rc<App>) {
        let request = app.core.request();
        self.snapshot_request.replace(Some(request.clone()));
        app.core.run(|studio| studio.local_snapshot(request));
    }

    pub fn settled(&self, request: &str, error: Option<&str>) {
        self.pending.borrow_mut().remove(request);
        if error.is_none() || self.snapshot_request.borrow().as_deref() == Some(request) {
            self.failure.replace(error.map(str::to_string));
        }
    }

    pub fn select(&self, url: &str) {
        self.selected.replace(Some(url.to_string()));
        let Some(app) = self.app.upgrade() else { return };
        let state = app.state.try_borrow();
        if let Ok(state) = &state {
            self.render(state);
        }
        drop(state);
    }

    fn watch(&self, visible: bool) {
        let target = if visible { self.desired.borrow().clone() } else { None };
        if *self.watching.borrow() == target {
            return;
        }
        self.watching.replace(target.clone());
        if let Some(app) = self.app.upgrade() {
            app.core.run(|studio| studio.watch_local_dashboard(target));
        }
    }

    fn act(&self, app: &Rc<App>, action: LocalAction, key: String) {
        let request = app.core.request();
        self.pending.borrow_mut().insert(request.clone(), key);
        app.core.run(|studio| studio.local_action(request, action));
        let state = app.state.try_borrow();
        if let Ok(state) = &state {
            self.render(state);
        }
        drop(state);
    }

    fn is_pending(&self, key: &str) -> bool {
        self.pending.borrow().values().any(|pending| pending == key)
    }

    pub fn render(&self, state: &State) {
        let controllers = state.local.as_ref().map_or(&[][..], |snapshot| snapshot.controllers.as_slice());
        let current = self.current(controllers);
        self.render_bar(state, controllers, current);
        let dashboard = current
            .filter(|controller| controller.reachable && controller.has_controller)
            .map(|controller| state.dashboard.as_ref().filter(|dashboard| dashboard.controller == controller.target));
        self.since.set_visible(dashboard.is_some());
        self.since.set_label(&parts::since_text(dashboard.flatten().map(|dashboard| &dashboard.tokens)));
        match current {
            None => self.render_empty(state),
            Some(controller) if !controller.has_controller => {
                self.engines.fill(controller);
                self.stack.set_visible_child_name("engines");
            }
            Some(controller) if controller.reachable => {
                let dashboard = state.dashboard.as_ref().filter(|dashboard| dashboard.controller == controller.target);
                let loading = self.is_pending(&format!("load:{}", controller.target));
                let unloading = serving(controller).first().is_some_and(|endpoint| {
                    self.is_pending(&format!("unload:{}:{}", controller.target, endpoint.port))
                });
                self.view.fill(controller, dashboard, loading, unloading);
                self.stack.set_visible_child_name("dashboard");
            }
            Some(controller) => {
                self.offline.set_title(&controller.headline);
                self.offline.set_description(Some(&format::escape(&controller.detail)));
                self.stack.set_visible_child_name("offline");
            }
        }
        self.desired.replace(
            current
                .filter(|controller| controller.reachable && controller.has_controller)
                .map(|controller| controller.target.clone()),
        );
        self.shown.replace(current.cloned());
        self.watch(self.root.is_mapped());
    }

    fn current<'a>(&self, controllers: &'a [LocalController]) -> Option<&'a LocalController> {
        let selected = self.selected.borrow();
        controllers
            .iter()
            .find(|controller| selected.as_deref() == Some(controller.url.as_str()))
            .or_else(|| controllers.iter().find(|controller| controller.status == LocalMachineStatus::Serving))
            .or_else(|| controllers.iter().find(|controller| controller.reachable))
            .or_else(|| controllers.first())
    }

    fn render_bar(&self, state: &State, controllers: &[LocalController], current: Option<&LocalController>) {
        if controllers.is_empty() {
            let url = state.settings.local_controller_url.trim();
            self.online.set_label(if url.is_empty() { DEFAULT_CONTROLLER } else { url });
        } else {
            let online = controllers.iter().filter(|controller| controller.reachable).count();
            let plural = if controllers.len() == 1 { "" } else { "s" };
            self.online.set_label(&format!("{online} of {} machine{plural} online", controllers.len()));
        }
        let error = state
            .local
            .as_ref()
            .filter(|snapshot| !snapshot.controllers.is_empty())
            .and_then(|snapshot| snapshot.error.as_deref());
        self.notice.set_visible(error.is_some());
        self.notice.set_label(error.unwrap_or_default());
        let keys: Vec<(String, String, LocalMachineStatus)> = controllers
            .iter()
            .map(|controller| (controller.url.clone(), controller.name.clone(), controller.status))
            .collect();
        if *self.tab_keys.borrow() != keys {
            self.rebuild_tabs(&keys);
            self.tab_keys.replace(keys);
        }
        self.building.set(true);
        for (url, button) in self.tab_buttons.borrow().iter() {
            button.set_active(current.is_some_and(|controller| &controller.url == url));
        }
        self.building.set(false);
    }

    fn rebuild_tabs(&self, keys: &[(String, String, LocalMachineStatus)]) {
        while let Some(child) = self.tabs.first_child() {
            self.tabs.remove(&child);
        }
        let mut buttons: Vec<(String, gtk::ToggleButton)> = Vec::new();
        for (url, name, status) in keys {
            let content = gtk::Box::new(gtk::Orientation::Horizontal, 7);
            content.append(&engines::dot(*status));
            content.append(&gtk::Label::new(Some(name.as_str())));
            let button = parts::tab(&content);
            button.update_property(&[gtk::accessible::Property::Label(&format!(
                "{name}, {}",
                engines::status_label(*status)
            ))]);
            if let Some((_, leader)) = buttons.first() {
                button.set_group(Some(leader));
            }
            let weak = self.app.clone();
            let target = url.clone();
            button.connect_toggled(move |button| {
                let Some(app) = weak.upgrade() else { return };
                if button.is_active() && !app.local.building.get() {
                    app.local.select(&target);
                }
            });
            self.tabs.append(&button);
            buttons.push((url.clone(), button));
        }
        self.tab_buttons.replace(buttons);
    }

    fn render_empty(&self, state: &State) {
        let error =
            state.local.as_ref().and_then(|snapshot| snapshot.error.clone()).or_else(|| self.failure.borrow().clone());
        if let Some(error) = error {
            self.empty.set_icon_name(Some(icons::UNREACHABLE));
            self.empty.set_title("No Local controller answers");
            self.empty.set_description(Some(&format::escape(&error)));
        } else {
            self.empty.set_icon_name(Some(icons::SERVER));
            self.empty.set_title("Contacting the Local controller…");
            self.empty.set_description(None);
        }
        self.stack.set_visible_child_name("empty");
    }

    fn open_switch(&self, app: &Rc<App>) {
        let Some(controller) = self.shown.borrow().clone() else { return };
        let ready: Vec<LocalRecipe> = controller.recipes.iter().filter(|recipe| recipe.fits).cloned().collect();
        let replacing = !serving(&controller).is_empty();
        let heading = if replacing {
            format!("Switch the model on {}", controller.name)
        } else {
            format!("Load a model on {}", controller.name)
        };
        let body = if ready.is_empty() {
            if controller.recipes.is_empty() {
                "The registry has no recipes for this machine's hardware yet.".to_string()
            } else {
                format!(
                    "None of the {} registry recipes for this hardware can load automatically yet.",
                    controller.recipes.len()
                )
            }
        } else if replacing {
            let models: Vec<String> =
                serving(&controller).iter().flat_map(|endpoint| endpoint.models.iter().cloned()).collect();
            format!("Switching stops {} first; its requests in flight end.", models.join(", "))
        } else {
            String::new()
        };
        let dialog = adw::AlertDialog::new(Some(&heading), (!body.is_empty()).then_some(body.as_str()));
        dialog.add_response("cancel", "Cancel");
        dialog.add_response("run", if replacing { "Switch" } else { "Load" });
        dialog.set_response_appearance("run", adw::ResponseAppearance::Suggested);
        dialog.set_response_enabled("run", !ready.is_empty());
        dialog.set_default_response(Some("run"));
        dialog.set_close_response("cancel");
        let choice = Rc::new(RefCell::new(ready.first().map(|recipe| recipe.id.clone())));
        if !ready.is_empty() {
            dialog.set_extra_child(Some(&recipe_list(&ready, &choice)));
        }
        let weak = self.app.clone();
        let target = controller.target.clone();
        dialog.connect_response(Some("run"), move |_, _| {
            let Some(app) = weak.upgrade() else { return };
            let Some(recipe) = choice.borrow().clone() else { return };
            let action = LocalAction::RunRecipe { controller: target.clone(), recipe, replace: replacing };
            app.local.act(&app, action, format!("load:{target}"));
        });
        dialog.present(Some(&app.window));
    }

    fn confirm_stop(&self, app: &Rc<App>) {
        let Some(controller) = self.shown.borrow().clone() else { return };
        let Some(endpoint) = serving(&controller).first().copied().cloned() else { return };
        let model = endpoint.models.join(", ");
        let running = app
            .state
            .borrow()
            .dashboard
            .as_ref()
            .filter(|dashboard| dashboard.controller == controller.target)
            .and_then(|dashboard| dashboard.running)
            .unwrap_or(0);
        let idle = format!("{} serves nothing until a model loads again.", controller.name);
        let message = if running > 0 {
            let (plural, verb) = if running == 1 { ("", "ends") } else { ("s", "end") };
            format!("Its {running} request{plural} in flight {verb} now, and {idle}")
        } else {
            idle
        };
        let dialog = adw::AlertDialog::new(Some(&format!("Stop {model}?")), Some(&message));
        dialog.add_response("keep", "Keep running");
        dialog.add_response("stop", "Stop model");
        dialog.set_response_appearance("stop", adw::ResponseAppearance::Destructive);
        dialog.set_default_response(Some("keep"));
        dialog.set_close_response("keep");
        let weak = self.app.clone();
        let (target, port) = (controller.target.clone(), endpoint.port);
        dialog.connect_response(Some("stop"), move |_, _| {
            let Some(app) = weak.upgrade() else { return };
            let action = LocalAction::StopPort { controller: target.clone(), port };
            app.local.act(&app, action, format!("unload:{target}:{port}"));
        });
        dialog.present(Some(&app.window));
    }
}

fn top_bar(app: &Weak<App>, tabs: &gtk::Box, since: &gtk::Label, online: &gtk::Label) -> gtk::Box {
    let scroller = gtk::ScrolledWindow::builder()
        .hscrollbar_policy(gtk::PolicyType::Automatic)
        .vscrollbar_policy(gtk::PolicyType::Never)
        .hexpand(true)
        .child(tabs)
        .build();
    let refresh = icons::flat(icons::REFRESH, "Refresh");
    refresh.set_valign(gtk::Align::Center);
    let weak = app.clone();
    refresh.connect_clicked(move |_| {
        if let Some(app) = weak.upgrade() {
            app.local.request_snapshot(&app);
        }
    });
    let manage = gtk::Button::builder().label("Manage Machines").valign(gtk::Align::Center).build();
    manage.add_css_class("ls-dash-button");
    manage.add_css_class("bordered");
    let weak = app.clone();
    manage.connect_clicked(move |_| {
        if let Some(app) = weak.upgrade() {
            app.open_settings(Some("local"));
        }
    });
    since.set_valign(gtk::Align::Center);
    online.set_valign(gtk::Align::Center);
    let bar = gtk::Box::new(gtk::Orientation::Horizontal, 10);
    bar.append(&scroller);
    bar.append(since);
    bar.append(online);
    bar.append(&refresh);
    bar.append(&manage);
    bar
}
