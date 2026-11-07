use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::{Rc, Weak};

use adw::prelude::*;
use gtk::{glib, pango};
use local_studio_core::{
    LocalAction, LocalController, LocalDashboard, LocalGpuTelemetry, LocalRecipe, LocalTokenHistory,
};

use crate::app::App;
use crate::dashboard_charts::{Heatmap, Sparkline};
use crate::format;
use crate::numbers;
use crate::state::{Page, State};

const DEFAULT_CONTROLLER: &str = "http://127.0.0.1:18091";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Machine {
    Serving,
    Loading,
    Idle,
    Offline,
}

impl Machine {
    fn of(controller: &LocalController) -> Self {
        if !controller.reachable {
            Self::Offline
        } else if !controller.endpoints.is_empty() {
            Self::Serving
        } else if controller.jobs.iter().any(|job| !job.failed) {
            Self::Loading
        } else {
            Self::Idle
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Serving => "serving",
            Self::Loading => "loading",
            Self::Idle => "idle",
            Self::Offline => "offline",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Tone {
    Plain,
    Warning,
    Danger,
}

struct Figure {
    value: Option<String>,
    unit: String,
    hint: Option<String>,
    tone: Tone,
}

impl Figure {
    fn new(value: Option<String>, unit: &str, hint: Option<String>) -> Self {
        Self { value, unit: unit.to_string(), hint, tone: Tone::Plain }
    }
}

fn label(text: &str, classes: &[&str]) -> gtk::Label {
    let label = gtk::Label::new(Some(text));
    for class in classes {
        label.add_css_class(class);
    }
    label.set_xalign(0.0);
    label
}

struct FigureView {
    root: gtk::Box,
    value: gtk::Label,
    unit: gtk::Label,
    hint_row: gtk::Box,
    icon: gtk::Image,
    hint: gtk::Label,
}

impl FigureView {
    fn build(title: &str) -> Self {
        let root = gtk::Box::new(gtk::Orientation::Vertical, 6);
        root.append(&label(title, &["dim-label", "ls-dash-label"]));
        let value = label("—", &["ls-dash-value"]);
        let unit = label("", &["dim-label", "ls-dash-label"]);
        value.set_valign(gtk::Align::BaselineFill);
        unit.set_valign(gtk::Align::BaselineFill);
        let line = gtk::Box::new(gtk::Orientation::Horizontal, 5);
        line.append(&value);
        line.append(&unit);
        root.append(&line);
        let icon = gtk::Image::from_icon_name("dialog-warning-symbolic");
        icon.set_visible(false);
        let hint = label(" ", &["ls-dash-label"]);
        hint.set_ellipsize(pango::EllipsizeMode::End);
        let hint_row = gtk::Box::new(gtk::Orientation::Horizontal, 5);
        hint_row.append(&icon);
        hint_row.append(&hint);
        root.append(&hint_row);
        Self { root, value, unit, hint_row, icon, hint }
    }

    fn set(&self, figure: &Figure) {
        self.value.set_label(figure.value.as_deref().unwrap_or("—"));
        self.unit.set_label(&figure.unit);
        self.hint.set_label(figure.hint.as_deref().unwrap_or(" "));
        self.icon.set_visible(figure.tone != Tone::Plain);
        if figure.tone == Tone::Plain {
            self.hint.add_css_class("dim-label");
        } else {
            self.hint.remove_css_class("dim-label");
        }
        if figure.tone == Tone::Warning {
            self.hint_row.add_css_class("warning");
        } else {
            self.hint_row.remove_css_class("warning");
        }
        if figure.tone == Tone::Danger {
            self.hint_row.add_css_class("error");
        } else {
            self.hint_row.remove_css_class("error");
        }
    }
}

fn summary_row(title: &str) -> (gtk::Box, gtk::Label) {
    let row = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    row.set_margin_top(8);
    row.set_margin_bottom(8);
    let name = label(title, &["dim-label", "ls-dash-label"]);
    name.set_hexpand(true);
    let value = label("—", &["ls-dash-label", "ls-dash-num"]);
    value.set_xalign(1.0);
    value.set_ellipsize(pango::EllipsizeMode::End);
    row.append(&name);
    row.append(&value);
    (row, value)
}

struct View {
    root: gtk::Box,
    model: gtk::Label,
    detail: gtk::Label,
    switch: adw::ButtonContent,
    switch_button: gtk::Button,
    stop: adw::ButtonContent,
    stop_button: gtk::Button,
    error: gtk::Box,
    error_label: gtk::Label,
    decode: gtk::Label,
    decode_hint: gtk::Label,
    sparkline: Sparkline,
    figures: [FigureView; 6],
    since: gtk::Label,
    total: gtk::Label,
    split: gtk::Label,
    week: gtk::Label,
    busiest: gtk::Label,
    active: gtk::Label,
    heatmap: Heatmap,
}

impl View {
    #[allow(clippy::too_many_lines)]
    fn build(app: &Weak<App>) -> Self {
        let model = label("No model loaded", &["ls-dash-model"]);
        model.set_ellipsize(pango::EllipsizeMode::Middle);
        model.set_selectable(true);
        let detail = label(" ", &["dim-label", "ls-dash-label"]);
        detail.set_wrap(true);
        detail.set_lines(2);
        detail.set_ellipsize(pango::EllipsizeMode::End);
        let titles = gtk::Box::new(gtk::Orientation::Vertical, 5);
        titles.set_hexpand(true);
        titles.append(&model);
        titles.append(&detail);
        let switch =
            adw::ButtonContent::builder().icon_name("media-playlist-repeat-symbolic").label("Switch model…").build();
        let switch_button = gtk::Button::builder().child(&switch).valign(gtk::Align::Start).build();
        switch_button.add_css_class("ls-dash-button");
        switch_button.add_css_class("bordered");
        let weak = app.clone();
        switch_button.connect_clicked(move |_| {
            if let Some(app) = weak.upgrade() {
                app.local.open_switch(&app);
            }
        });
        let stop = adw::ButtonContent::builder().icon_name("media-playback-stop-symbolic").label("Stop model…").build();
        let stop_button = gtk::Button::builder().child(&stop).valign(gtk::Align::Start).build();
        stop_button.add_css_class("flat");
        stop_button.add_css_class("ls-dash-button");
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
        error.append(&gtk::Image::from_icon_name("dialog-warning-symbolic"));
        error.append(&error_label);
        error.set_visible(false);
        let decode = label("—", &["ls-dash-hero"]);
        let decode_hint = label(" ", &["dim-label", "ls-dash-label"]);
        let sparkline = Sparkline::build();
        let figures = [
            FigureView::build("First token"),
            FigureView::build("In flight"),
            FigureView::build("KV cache"),
            FigureView::build("GPUs"),
            FigureView::build("Memory"),
            FigureView::build("Power"),
        ];
        let grid = figure_grid(&decode, &decode_hint, &sparkline, &figures);
        let left = gtk::Box::new(gtk::Orientation::Vertical, 0);
        left.set_hexpand(true);
        left.append(&header);
        left.append(&error);
        left.append(&grid);
        let since = label("Tokens", &["dim-label", "ls-dash-label"]);
        let total = label("—", &["ls-dash-total"]);
        total.set_ellipsize(pango::EllipsizeMode::End);
        let split = label(" ", &["dim-label", "ls-dash-label"]);
        split.set_wrap(true);
        let (week_row, last_week) = summary_row("Last 7 days");
        let (busiest_row, busiest) = summary_row("Busiest day");
        let (active_row, active) = summary_row("Active days");
        let rows = gtk::Box::new(gtk::Orientation::Vertical, 0);
        rows.set_margin_top(26);
        rows.append(&week_row);
        rows.append(&gtk::Separator::new(gtk::Orientation::Horizontal));
        rows.append(&busiest_row);
        rows.append(&gtk::Separator::new(gtk::Orientation::Horizontal));
        rows.append(&active_row);
        let summary = gtk::Box::new(gtk::Orientation::Vertical, 0);
        summary.set_margin_top(2);
        summary.set_size_request(244, -1);
        summary.set_hexpand(false);
        summary.append(&since);
        summary.append(&total);
        summary.append(&split);
        summary.append(&rows);
        let divider = gtk::Separator::new(gtk::Orientation::Vertical);
        divider.set_margin_start(44);
        divider.set_margin_end(44);
        let top = gtk::Box::new(gtk::Orientation::Horizontal, 0);
        top.append(&left);
        top.append(&divider);
        top.append(&summary);
        let rule = gtk::Separator::new(gtk::Orientation::Horizontal);
        rule.set_margin_top(36);
        rule.set_margin_bottom(44);
        let heatmap = Heatmap::build();
        let root = gtk::Box::new(gtk::Orientation::Vertical, 0);
        root.append(&top);
        root.append(&rule);
        root.append(&heatmap.root);
        Self {
            root,
            model,
            detail,
            switch,
            switch_button,
            stop,
            stop_button,
            error,
            error_label,
            decode,
            decode_hint,
            sparkline,
            figures,
            since,
            total,
            split,
            week: last_week,
            busiest,
            active,
            heatmap,
        }
    }

    fn fill(&self, controller: &LocalController, dashboard: Option<&LocalDashboard>, loading: bool, unloading: bool) {
        let endpoint = controller.endpoints.first();
        let job = controller.jobs.first();
        let model = endpoint.map(|endpoint| endpoint.models.join(", "));
        self.model.set_label(&model.clone().unwrap_or_else(|| {
            job.map_or_else(|| "No model loaded".to_string(), |job| format!("Loading {}", job.recipe_id))
        }));
        self.detail.set_label(&header_detail(controller, dashboard));
        if job.is_some_and(|job| job.failed) && endpoint.is_none() {
            self.detail.remove_css_class("dim-label");
            self.detail.add_css_class("error");
        } else {
            self.detail.remove_css_class("error");
            self.detail.add_css_class("dim-label");
        }
        self.switch.set_label(if loading {
            "Switching…"
        } else if endpoint.is_none() {
            "Load model…"
        } else {
            "Switch model…"
        });
        self.switch_button.set_sensitive(!loading);
        self.stop_button.set_visible(model.is_some());
        self.stop.set_label(if unloading { "Stopping…" } else { "Stop model…" });
        self.stop_button.set_sensitive(!unloading);
        let error = dashboard.and_then(|dashboard| dashboard.error.as_deref());
        self.error.set_visible(error.is_some());
        self.error_label.set_label(error.unwrap_or_default());
        self.decode.set_label(
            &dashboard.and_then(|dashboard| dashboard.decode_tps).map_or_else(|| "—".to_string(), numbers::decimal),
        );
        self.decode_hint.set_label(&decode_hint(dashboard));
        self.sparkline.set(dashboard.map_or(&[][..], |dashboard| dashboard.decode_series.as_slice()));
        let figures = figures(dashboard);
        for (view, figure) in self.figures.iter().zip(figures.iter()) {
            view.set(figure);
        }
        self.summary(dashboard.map(|dashboard| &dashboard.tokens));
    }

    fn summary(&self, tokens: Option<&LocalTokenHistory>) {
        let since = tokens.and_then(|tokens| tokens.since_day.as_deref()).and_then(numbers::parse_day);
        self.since.set_label(
            &since.map_or_else(|| "Tokens".to_string(), |day| format!("Tokens since {}", numbers::day(day, true))),
        );
        self.total.set_label(&tokens.map_or_else(|| "—".to_string(), |tokens| numbers::compact(tokens.total)));
        self.split.set_label(&match tokens {
            None => " ".to_string(),
            Some(tokens) if tokens.total == 0 => "Counted from engine metrics as models serve requests.".to_string(),
            Some(tokens) => {
                format!("{} read, {} written", numbers::compact(tokens.read), numbers::compact(tokens.written))
            }
        });
        self.week.set_label(&tokens.map_or_else(|| "—".to_string(), |tokens| numbers::compact(tokens.last_week)));
        self.busiest.set_label(&tokens.map_or_else(
            || "—".to_string(),
            |tokens| {
                tokens.busiest_day.as_deref().and_then(numbers::parse_day).map_or_else(
                    || "—".to_string(),
                    |day| format!("{}, {}", numbers::compact(tokens.busiest_tokens), numbers::day(day, false)),
                )
            },
        ));
        self.active.set_label(&tokens.map_or_else(
            || "—".to_string(),
            |tokens| {
                format!(
                    "{} of {}",
                    numbers::count(tokens.active_days.into()),
                    numbers::count(tokens.tracked_days.into())
                )
            },
        ));
        self.heatmap.set(tokens);
    }
}

fn figure_grid(decode: &gtk::Label, hint: &gtk::Label, sparkline: &Sparkline, figures: &[FigureView; 6]) -> gtk::Grid {
    let grid = gtk::Grid::builder().column_homogeneous(true).column_spacing(12).build();
    let tok = label("tok/s", &["dim-label", "ls-dash-label"]);
    decode.set_valign(gtk::Align::BaselineFill);
    tok.set_valign(gtk::Align::BaselineFill);
    let line = gtk::Box::new(gtk::Orientation::Horizontal, 5);
    line.append(decode);
    line.append(&tok);
    let hero = gtk::Box::new(gtk::Orientation::Vertical, 4);
    hero.set_margin_top(44);
    hero.append(&label("Decode", &["dim-label", "ls-dash-label"]));
    hero.append(&line);
    hero.append(hint);
    let chart = gtk::Box::new(gtk::Orientation::Vertical, 10);
    chart.set_margin_top(44);
    chart.append(&label("Decode, last 24 hours", &["dim-label", "ls-dash-label"]));
    chart.append(&sparkline.area);
    grid.attach(&hero, 0, 0, 1, 1);
    grid.attach(&chart, 1, 0, 2, 1);
    for (index, figure) in figures.iter().enumerate() {
        let (column, row) = (i32::try_from(index % 3).unwrap_or(0), i32::try_from(index / 3).unwrap_or(0) + 1);
        figure.root.set_margin_top(if row == 1 { 48 } else { 40 });
        grid.attach(&figure.root, column, row, 1, 1);
    }
    grid
}

fn header_detail(controller: &LocalController, dashboard: Option<&LocalDashboard>) -> String {
    if let Some(endpoint) = controller.endpoints.first() {
        let loaded = dashboard
            .and_then(|dashboard| dashboard.engines.iter().find(|engine| engine.port == endpoint.port))
            .and_then(|engine| engine.loaded_at_ms)
            .map_or_else(|| format!("Serving on port {}", endpoint.port), numbers::loaded);
        let others = controller.endpoints.len() - 1;
        return if others > 0 {
            format!("{loaded} · {others} more engine{} running", if others == 1 { "" } else { "s" })
        } else {
            loaded
        };
    }
    if let Some(job) = controller.jobs.first() {
        return job.detail.clone();
    }
    format!("{} is idle. Load a model from the registry to serve it.", controller.name)
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
    notice: gtk::Label,
    tabs: gtk::Box,
    tab_buttons: RefCell<Vec<(String, gtk::ToggleButton)>>,
    tab_keys: RefCell<Vec<(String, String, Machine)>>,
    stack: gtk::Stack,
    empty: adw::StatusPage,
    offline: adw::StatusPage,
    view: View,
    selected: RefCell<Option<String>>,
    last_models: RefCell<HashMap<String, String>>,
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
        let tabs = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        let bar = top_bar(&app, &tabs, &online);
        let notice = label("", &["warning", "ls-dash-label"]);
        notice.set_wrap(true);
        notice.set_selectable(true);
        notice.set_margin_top(10);
        notice.set_visible(false);
        let view = View::build(&app);
        let empty = adw::StatusPage::builder()
            .icon_name("network-server-symbolic")
            .title("Contacting the Local controller…")
            .build();
        empty.set_size_request(-1, 360);
        let offline = adw::StatusPage::builder().icon_name("network-offline-symbolic").build();
        offline.set_size_request(-1, 420);
        let stack = gtk::Stack::new();
        stack.set_vhomogeneous(false);
        stack.add_named(&view.root, Some("dashboard"));
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
            notice,
            tabs,
            tab_buttons: RefCell::new(Vec::new()),
            tab_keys: RefCell::new(Vec::new()),
            stack,
            empty,
            offline,
            view,
            selected: RefCell::new(None),
            last_models: RefCell::new(HashMap::new()),
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
        {
            let mut last_models = self.last_models.borrow_mut();
            for controller in controllers {
                if let Some(model) = controller.endpoints.first().and_then(|endpoint| endpoint.models.first()) {
                    last_models.insert(controller.url.clone(), model.clone());
                }
            }
        }
        let current = self.current(controllers);
        self.render_bar(state, controllers, current);
        match current {
            None => self.render_empty(state),
            Some(controller) if controller.reachable => {
                let dashboard = state.dashboard.as_ref().filter(|dashboard| dashboard.controller == controller.target);
                let loading = self.is_pending(&format!("load:{}", controller.target));
                let unloading = controller.endpoints.first().is_some_and(|endpoint| {
                    self.is_pending(&format!("unload:{}:{}", controller.target, endpoint.port))
                });
                self.view.fill(controller, dashboard, loading, unloading);
                self.stack.set_visible_child_name("dashboard");
            }
            Some(controller) => {
                self.offline.set_title(&format!("{} is offline", controller.name));
                let reconnect = "It shows live figures again once it reconnects.";
                self.offline.set_description(Some(&format::escape(
                    &match self.last_models.borrow().get(&controller.url) {
                        Some(model) => format!("It last ran {model}. {reconnect}"),
                        None => reconnect.to_string(),
                    },
                )));
                self.stack.set_visible_child_name("offline");
            }
        }
        self.desired
            .replace(current.filter(|controller| controller.reachable).map(|controller| controller.target.clone()));
        self.shown.replace(current.cloned());
        self.watch(self.root.is_mapped());
    }

    fn current<'a>(&self, controllers: &'a [LocalController]) -> Option<&'a LocalController> {
        let selected = self.selected.borrow();
        controllers
            .iter()
            .find(|controller| selected.as_deref() == Some(controller.url.as_str()))
            .or_else(|| controllers.iter().find(|controller| controller.reachable && !controller.endpoints.is_empty()))
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
        let keys: Vec<(String, String, Machine)> = controllers
            .iter()
            .map(|controller| (controller.url.clone(), controller.name.clone(), Machine::of(controller)))
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

    fn rebuild_tabs(&self, keys: &[(String, String, Machine)]) {
        while let Some(child) = self.tabs.first_child() {
            self.tabs.remove(&child);
        }
        let mut buttons: Vec<(String, gtk::ToggleButton)> = Vec::new();
        for (url, name, machine) in keys {
            let dot = gtk::Box::new(gtk::Orientation::Horizontal, 0);
            dot.add_css_class("ls-machine-dot");
            dot.add_css_class(machine.label());
            dot.set_valign(gtk::Align::Center);
            let content = gtk::Box::new(gtk::Orientation::Horizontal, 7);
            content.append(&dot);
            content.append(&gtk::Label::new(Some(name.as_str())));
            let button = gtk::ToggleButton::builder().child(&content).build();
            button.add_css_class("flat");
            button.add_css_class("ls-dash-tab");
            button.update_property(&[gtk::accessible::Property::Label(&format!("{name}, {}", machine.label()))]);
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
            self.empty.set_icon_name(Some("network-error-symbolic"));
            self.empty.set_title("No Local controller answers");
            self.empty.set_description(Some(&format::escape(&error)));
        } else {
            self.empty.set_icon_name(Some("network-server-symbolic"));
            self.empty.set_title("Contacting the Local controller…");
            self.empty.set_description(None);
        }
        self.stack.set_visible_child_name("empty");
    }

    fn open_switch(&self, app: &Rc<App>) {
        let Some(controller) = self.shown.borrow().clone() else { return };
        let ready: Vec<LocalRecipe> = controller.recipes.iter().filter(|recipe| recipe.fits).cloned().collect();
        let replacing = !controller.endpoints.is_empty();
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
                controller.endpoints.iter().flat_map(|endpoint| endpoint.models.iter().cloned()).collect();
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
        let Some(endpoint) = controller.endpoints.first() else { return };
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

fn top_bar(app: &Weak<App>, tabs: &gtk::Box, online: &gtk::Label) -> gtk::Box {
    let scroller = gtk::ScrolledWindow::builder()
        .hscrollbar_policy(gtk::PolicyType::Automatic)
        .vscrollbar_policy(gtk::PolicyType::Never)
        .hexpand(true)
        .child(tabs)
        .build();
    let refresh = gtk::Button::builder()
        .icon_name("view-refresh-symbolic")
        .tooltip_text("Refresh")
        .valign(gtk::Align::Center)
        .build();
    refresh.add_css_class("flat");
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
    online.set_valign(gtk::Align::Center);
    let bar = gtk::Box::new(gtk::Orientation::Horizontal, 10);
    bar.append(&scroller);
    bar.append(online);
    bar.append(&refresh);
    bar.append(&manage);
    bar
}
