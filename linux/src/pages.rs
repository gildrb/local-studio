use std::rc::{Rc, Weak};

use adw::prelude::*;
use local_studio_core::{UsageDay, UsagePeriod, UsageReport};

use crate::app::App;
use crate::format;
use crate::state::State;

pub struct UsagePage {
    pub root: gtk::ScrolledWindow,
    periods: adw::ToggleGroup,
    modes: adw::ToggleGroup,
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
        let modes = adw::ToggleGroup::new();
        for (name, label) in [("tokens", "Tokens"), ("cost", "Cost"), ("limits", "Limits")] {
            modes.add(
                adw::Toggle::builder().name(name).label(label).tooltip(format!("{label} ({})", &name[..1])).build(),
            );
        }
        modes.set_active_name(Some("tokens"));
        let bar = gtk::Box::new(gtk::Orientation::Horizontal, 12);
        bar.append(&periods);
        let spacer = gtk::Box::new(gtk::Orientation::Horizontal, 0);
        spacer.set_hexpand(true);
        bar.append(&spacer);
        bar.append(&modes);
        let body = adw::Bin::new();
        content.append(&bar);
        content.append(&body);
        let clamp = adw::Clamp::builder().maximum_size(860).child(&content).build();
        let root = gtk::ScrolledWindow::builder().hscrollbar_policy(gtk::PolicyType::Never).child(&clamp).build();
        let weak = app.clone();
        periods.connect_active_name_notify(move |_| {
            if let Some(app) = weak.upgrade() {
                app.usage.refresh(&app);
            }
        });
        modes.connect_active_name_notify(move |_| {
            if let Some(app) = app.upgrade() {
                app.usage.render(&app.state.borrow());
            }
        });
        Self { root, periods, modes, body }
    }

    pub fn set_mode(&self, mode: &str) {
        self.modes.set_active_name(Some(mode));
    }

    pub fn set_period(&self, app: &Rc<App>, period: UsagePeriod) {
        let name = match period {
            UsagePeriod::Day => "day",
            UsagePeriod::Week => "week",
            UsagePeriod::Month => "month",
            UsagePeriod::Quarter => "quarter",
        };
        if self.periods.active_name().as_deref() == Some(name) {
            self.refresh(app);
        } else {
            self.periods.set_active_name(Some(name));
        }
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
            report_view(report, self.modes.active_name().as_deref().unwrap_or("tokens"))
        } else {
            let label = gtk::Label::new(Some("Loading usage…"));
            label.add_css_class("dim-label");
            label.upcast()
        };
        self.body.set_child(Some(&child));
    }
}

fn report_view(report: &UsageReport, mode: &str) -> gtk::Widget {
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
    if mode == "limits" && report.limits.is_empty() {
        let empty = gtk::Label::new(Some("No provider rate windows reported for this period."));
        empty.add_css_class("dim-label");
        column.append(&empty);
    }
    if !report.limits.is_empty() && mode == "limits" {
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
    if mode == "limits" {
        return column.upcast();
    }
    let cost = mode == "cost";
    column.append(&chart_card(if cost { "Daily cost" } else { "Daily tokens" }, &report.daily, cost));
    let group = adw::PreferencesGroup::builder().title("By model").build();
    if report.by_model.is_empty() {
        group.add(&adw::ActionRow::builder().title("No usage in this period").build());
    }
    let mut models: Vec<_> = report.by_model.iter().collect();
    if cost {
        models.sort_by(|left, right| right.cost_usd.total_cmp(&left.cost_usd));
    }
    for model in models {
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
