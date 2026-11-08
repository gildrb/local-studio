use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use adw::prelude::*;
use local_studio_core::{UsageDay, UsagePeriod};

use crate::app::App;
use crate::dashboard_parts as parts;
use crate::state::State;
use crate::usage_dashboard::{LimitsView, Metric, UsageView};

const MODES: [(&str, &str); 3] = [("tokens", "Tokens"), ("cost", "Cost"), ("limits", "Limits")];

pub struct UsagePage {
    pub root: gtk::ScrolledWindow,
    tabs: Vec<(&'static str, gtk::ToggleButton)>,
    mode: Cell<&'static str>,
    period: Cell<UsagePeriod>,
    request: RefCell<Option<String>>,
    failed: Cell<bool>,
    stack: gtk::Stack,
    failure: adw::StatusPage,
    view: UsageView,
    limits: LimitsView,
}

impl UsagePage {
    pub fn new(app: &Weak<App>) -> Self {
        let bar = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        let mut tabs = Vec::new();
        for (name, title) in MODES {
            let button = parts::tab(&gtk::Label::new(Some(title)));
            button.set_tooltip_text(Some(&format!("{title} ({})", &name[..1])));
            if let Some((_, leader)) = tabs.first() {
                button.set_group(Some(leader));
            }
            button.set_active(name == "tokens");
            let weak = app.clone();
            button.connect_toggled(move |button| {
                let Some(app) = weak.upgrade() else { return };
                if button.is_active() && app.usage.mode.replace(name) != name {
                    app.usage.render(&app.state.borrow());
                }
            });
            bar.append(&button);
            tabs.push((name, button));
        }
        let view = UsageView::build(app);
        let limits = LimitsView::build();
        let loading = adw::StatusPage::builder().title("Loading usage…").build();
        loading.set_size_request(-1, 360);
        let failure =
            adw::StatusPage::builder().icon_name("dialog-warning-symbolic").title("Couldn’t load usage").build();
        failure.set_size_request(-1, 360);
        let stack = gtk::Stack::new();
        stack.set_vhomogeneous(false);
        stack.add_named(&view.root, Some("dashboard"));
        stack.add_named(&limits.root, Some("limits"));
        stack.add_named(&loading, Some("loading"));
        stack.add_named(&failure, Some("failure"));
        stack.set_visible_child_name("loading");
        let content = gtk::Box::new(gtk::Orientation::Vertical, 0);
        content.set_margin_start(40);
        content.set_margin_end(40);
        content.set_margin_top(12);
        content.set_margin_bottom(32);
        content.append(&bar);
        content.append(&stack);
        let root = gtk::ScrolledWindow::builder().hscrollbar_policy(gtk::PolicyType::Never).child(&content).build();
        Self {
            root,
            tabs,
            mode: Cell::new("tokens"),
            period: Cell::new(UsagePeriod::Week),
            request: RefCell::new(None),
            failed: Cell::new(false),
            stack,
            failure,
            view,
            limits,
        }
    }

    pub fn set_mode(&self, mode: &str) {
        if let Some((_, button)) = self.tabs.iter().find(|(name, _)| *name == mode) {
            button.set_active(true);
        }
    }

    pub fn choose(&self, period: UsagePeriod) {
        self.period.set(period);
    }

    pub fn set_period(&self, app: &Rc<App>, period: UsagePeriod) {
        if self.period.replace(period) != period {
            app.state.borrow_mut().usage = None;
        }
        self.refresh(app);
        self.render(&app.state.borrow());
    }

    pub fn refresh(&self, app: &Rc<App>) {
        let period = self.period.get();
        app.state.borrow_mut().usage_period = Some(period);
        let request = app.core.request();
        self.request.replace(Some(request.clone()));
        self.failed.set(false);
        app.core.run(|studio| studio.load_usage(request, period));
    }

    pub fn failed(&self, request: &str, message: &str) -> bool {
        if self.request.borrow().as_deref() != Some(request) {
            return false;
        }
        self.failure.set_description(Some(&crate::format::escape(message)));
        self.failed.set(true);
        true
    }

    pub fn render(&self, state: &State) {
        let Some(report) = &state.usage else {
            self.stack.set_visible_child_name(if self.failed.get() { "failure" } else { "loading" });
            return;
        };
        match self.mode.get() {
            "limits" => {
                self.limits.fill(&report.limits, &state.providers);
                self.stack.set_visible_child_name("limits");
            }
            mode => {
                let metric = if mode == "cost" { Metric::Cost } else { Metric::Tokens };
                self.view.fill(report, metric, self.period.get());
                self.stack.set_visible_child_name("dashboard");
            }
        }
    }
}

pub(crate) fn metric(title: &str, value: &str, caption: &str) -> gtk::Box {
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

pub(crate) fn chart_card(title: &str, days: &[UsageDay], cost: bool) -> gtk::Box {
    let card = gtk::Box::new(gtk::Orientation::Vertical, 8);
    card.add_css_class("ls-metric");
    let label = gtk::Label::new(Some(title));
    label.add_css_class("ls-meta");
    label.set_xalign(0.0);
    card.append(&label);
    #[allow(clippy::cast_precision_loss)]
    let values: Vec<f64> = days.iter().map(|day| if cost { day.cost_usd } else { day.tokens as f64 }).collect();
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

pub(crate) fn meta(text: &str) -> gtk::Label {
    let label = gtk::Label::new(Some(text));
    label.add_css_class("ls-meta");
    label.set_valign(gtk::Align::Center);
    label
}

pub(crate) fn pill(text: &str) -> gtk::Label {
    let label = gtk::Label::new(Some(text));
    label.add_css_class("ls-pill");
    label.set_valign(gtk::Align::Center);
    label
}
