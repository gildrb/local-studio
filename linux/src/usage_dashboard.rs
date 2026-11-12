use std::rc::Weak;

use adw::prelude::*;
use gtk::pango;
use local_studio_core::{ProviderStatus, UsageByModel, UsageLimit, UsagePeriod, UsageReport};

use crate::app::App;
use crate::dashboard_charts::{share_bar, Heatmap, Sparkline};
use crate::dashboard_parts::{self as parts, label, Figure, FigureView, Hero, TokenSummary};
use crate::format;
use crate::numbers;

const DAY_MS: i64 = 86_400_000;
const FOOTNOTE: &str = "Counted from every saved agent session across all projects, on the day each model answered. Read includes cached input as providers report it; requests count model responses.";
const LIMITS_EMPTY: &str = "No provider rate windows reported for this period.";

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Metric {
    Tokens,
    Cost,
}

impl Metric {
    fn title(self) -> &'static str {
        match self {
            Self::Tokens => "Tokens",
            Self::Cost => "Cost",
        }
    }
}

pub const PERIODS: [UsagePeriod; 4] = [UsagePeriod::Day, UsagePeriod::Week, UsagePeriod::Month, UsagePeriod::Quarter];

fn period_title(period: UsagePeriod) -> &'static str {
    match period {
        UsagePeriod::Day => "24h",
        UsagePeriod::Week => "7 days",
        UsagePeriod::Month => "30 days",
        UsagePeriod::Quarter => "90 days",
    }
}

fn period_heading(period: UsagePeriod) -> &'static str {
    match period {
        UsagePeriod::Day => "Last 24 hours",
        UsagePeriod::Week => "Last 7 days",
        UsagePeriod::Month => "Last 30 days",
        UsagePeriod::Quarter => "Last 90 days",
    }
}

#[allow(clippy::cast_precision_loss)]
fn ratio(part: u64, whole: u64) -> Option<f64> {
    (whole > 0).then(|| part as f64 / whole as f64)
}

pub struct UsageView {
    pub root: gtk::Box,
    heading: gtk::Label,
    detail: gtk::Label,
    periods: Vec<(UsagePeriod, gtk::Button)>,
    hero: Hero,
    chart_title: gtk::Label,
    sparkline: Sparkline,
    figures: [FigureView; 6],
    summary: TokenSummary,
    heatmap: Heatmap,
    table: gtk::Box,
}

impl UsageView {
    pub fn build(app: &Weak<App>) -> Self {
        let heading = label(" ", &["ls-dash-model"]);
        let detail = label(" ", &["dim-label", "ls-dash-label"]);
        detail.set_wrap(true);
        detail.set_lines(2);
        detail.set_ellipsize(pango::EllipsizeMode::End);
        let titles = gtk::Box::new(gtk::Orientation::Vertical, 5);
        titles.set_hexpand(true);
        titles.append(&heading);
        titles.append(&detail);
        let buttons = gtk::Box::new(gtk::Orientation::Horizontal, 4);
        buttons.set_valign(gtk::Align::Start);
        let mut periods = Vec::new();
        for period in PERIODS {
            let button = parts::button(&gtk::Label::new(Some(period_title(period))), false);
            let weak = app.clone();
            button.connect_clicked(move |_| {
                if let Some(app) = weak.upgrade() {
                    app.usage.set_period(&app, period);
                }
            });
            buttons.append(&button);
            periods.push((period, button));
        }
        let header = gtk::Box::new(gtk::Orientation::Horizontal, 12);
        header.set_margin_top(34);
        header.append(&titles);
        header.append(&buttons);
        let hero = Hero::build("Tokens", "tokens");
        let chart_title = label(" ", &["dim-label", "ls-dash-label"]);
        let sparkline = Sparkline::build();
        let figures = [
            FigureView::build("Cost"),
            FigureView::build("Requests"),
            FigureView::build("Top model"),
            FigureView::build("Read"),
            FigureView::build("Written"),
            FigureView::build("Per request"),
        ];
        let grid = parts::figure_grid(&hero, &chart_title, &sparkline, &[&figures[..3], &figures[3..]]);
        let left = gtk::Box::new(gtk::Orientation::Vertical, 0);
        left.set_hexpand(true);
        left.append(&header);
        left.append(&grid);
        let summary = TokenSummary::build(&["Lifetime cost"]);
        summary.move_since();
        let heatmap = Heatmap::build();
        let table = gtk::Box::new(gtk::Orientation::Vertical, 12);
        let footnote = label(FOOTNOTE, &["dim-label", "ls-dash-small"]);
        footnote.set_wrap(true);
        footnote.set_margin_top(28);
        let root = gtk::Box::new(gtk::Orientation::Vertical, 0);
        root.append(&parts::columns(&left, &summary));
        root.append(&parts::hairline(36, 44));
        root.append(&heatmap.root);
        root.append(&parts::hairline(36, 34));
        root.append(&table);
        root.append(&footnote);
        Self { root, heading, detail, periods, hero, chart_title, sparkline, figures, summary, heatmap, table }
    }

    pub fn fill(&self, report: &UsageReport, metric: Metric, selected: UsagePeriod) {
        self.heading.set_label(period_heading(report.period));
        self.detail.set_label(&if report.sessions > 0 {
            format!(
                "{} · {}",
                numbers::plural(report.sessions, "session"),
                numbers::plural(u64::try_from(report.by_model.len()).unwrap_or(u64::MAX), "model")
            )
        } else {
            "No agent session used a model in this period.".to_string()
        });
        for (period, button) in &self.periods {
            parts::set_bordered(button, *period == selected);
        }
        self.fill_hero(report, metric);
        let figures = [
            other_metric(report, metric),
            requests(report),
            top_model(report, metric),
            read(report),
            written(report),
            per_request(report),
        ];
        self.figures[0].set_title(match metric {
            Metric::Tokens => "Cost",
            Metric::Cost => "Tokens",
        });
        for (view, figure) in self.figures.iter().zip(figures.iter()) {
            view.set(figure);
        }
        self.summary.set(Some(&report.lifetime), "Counted from saved agent sessions as models answer.");
        self.summary.set_extra(0, Some(&numbers::cost(report.lifetime_cost_usd)));
        let last_day = report.lifetime.last_day.as_str();
        match metric {
            Metric::Tokens => self.heatmap.set(
                Some((parts::token_values(&report.lifetime), last_day)),
                numbers::tokens,
                "Tokens per day, last year",
            ),
            Metric::Cost => self.heatmap.set(
                Some((report.daily_cost_usd.iter().copied(), last_day)),
                numbers::cost,
                "Cost per day, last year",
            ),
        }
        self.fill_table(report, metric);
    }

    fn fill_hero(&self, report: &UsageReport, metric: Metric) {
        #[allow(clippy::cast_precision_loss)]
        let buckets = report.series.len().max(1) as f64;
        let unit = if report.series_step_ms < DAY_MS { "hour" } else { "day" };
        let chart = format!("{}, {}", metric.title(), period_heading(report.period).to_lowercase());
        self.chart_title.set_label(&chart);
        self.sparkline.area.update_property(&[gtk::accessible::Property::Label(&chart)]);
        match metric {
            Metric::Tokens => {
                #[allow(clippy::cast_precision_loss)]
                let average = report.total_tokens as f64 / buckets;
                self.hero.set(
                    "Tokens",
                    Some(&numbers::compact(report.total_tokens)),
                    "tokens",
                    &format!("{} per {unit}", numbers::compact_f64(average)),
                );
                #[allow(clippy::cast_precision_loss)]
                let series: Vec<f64> = report.series.iter().map(|bucket| bucket.tokens as f64).collect();
                self.sparkline.set(&series);
            }
            Metric::Cost => {
                self.hero.set(
                    "Cost",
                    Some(&numbers::cost(report.cost_usd)),
                    "",
                    &format!("{} per {unit}", numbers::cost(report.cost_usd / buckets)),
                );
                let series: Vec<f64> = report.series.iter().map(|bucket| bucket.cost_usd).collect();
                self.sparkline.set(&series);
            }
        }
    }

    fn fill_table(&self, report: &UsageReport, metric: Metric) {
        while let Some(child) = self.table.first_child() {
            self.table.remove(&child);
        }
        self.table.append(&label("By model", &["dim-label", "ls-dash-label"]));
        if report.by_model.is_empty() {
            self.table.append(&label("No model answered in this period.", &["dim-label", "ls-dash-label"]));
            return;
        }
        let grid = gtk::Grid::builder().column_spacing(28).build();
        for (column, (title, end)) in
            (0..).zip([("Model", false), ("Share", false), ("Requests", true), ("Tokens", true), ("Cost", true)])
        {
            let header = label(title, &["dim-label", "ls-dash-small"]);
            header.set_margin_bottom(8);
            if end {
                header.set_xalign(1.0);
            }
            grid.attach(&header, column, 0, 1, 1);
        }
        let mut rows: Vec<&UsageByModel> = report.by_model.iter().collect();
        if metric == Metric::Cost {
            rows.sort_by(|left, right| right.cost_usd.total_cmp(&left.cost_usd));
        }
        for (index, row) in (0..).zip(rows) {
            let line = 1 + index * 2;
            grid.attach(&gtk::Separator::new(gtk::Orientation::Horizontal), 0, line, 5, 1);
            let name = gtk::Box::new(gtk::Orientation::Vertical, 2);
            name.set_hexpand(true);
            name.set_margin_top(9);
            name.set_margin_bottom(9);
            let model = label(&row.model, &["ls-dash-label"]);
            model.set_ellipsize(pango::EllipsizeMode::Middle);
            model.set_tooltip_text(Some(&row.model));
            name.append(&model);
            name.append(&label(&row.provider, &["dim-label", "ls-dash-small"]));
            grid.attach(&name, 0, line + 1, 1, 1);
            let fraction = match metric {
                Metric::Cost => (report.cost_usd > 0.0).then(|| row.cost_usd / report.cost_usd),
                Metric::Tokens => ratio(row.tokens, report.total_tokens),
            }
            .unwrap_or(0.0);
            let share = gtk::Box::new(gtk::Orientation::Horizontal, 8);
            share.set_valign(gtk::Align::Center);
            share.append(&share_bar(fraction, 120, false));
            let percent = label(&numbers::percent(fraction * 100.0), &["dim-label", "ls-dash-small", "ls-dash-num"]);
            percent.set_xalign(1.0);
            percent.set_width_chars(5);
            share.append(&percent);
            grid.attach(&share, 1, line + 1, 1, 1);
            for (column, text) in
                (2..).zip([numbers::count(row.requests), numbers::compact(row.tokens), numbers::cost(row.cost_usd)])
            {
                let cell = label(&text, &["ls-dash-label", "ls-dash-num"]);
                cell.set_xalign(1.0);
                grid.attach(&cell, column, line + 1, 1, 1);
            }
        }
        self.table.append(&grid);
    }
}

fn per_million(report: &UsageReport) -> Option<String> {
    #[allow(clippy::cast_precision_loss)]
    let tokens = report.total_tokens as f64;
    (report.total_tokens > 0 && report.cost_usd > 0.0)
        .then(|| format!("{} per million tokens", numbers::cost(report.cost_usd / tokens * 1_000_000.0)))
}

fn other_metric(report: &UsageReport, metric: Metric) -> Figure {
    match metric {
        Metric::Tokens => Figure::new(Some(numbers::cost(report.cost_usd)), "", per_million(report)),
        Metric::Cost => Figure::new(Some(numbers::compact(report.total_tokens)), "tokens", per_million(report)),
    }
}

fn requests(report: &UsageReport) -> Figure {
    Figure::new(
        Some(numbers::count(report.requests)),
        if report.requests == 1 { "request" } else { "requests" },
        (report.sessions > 0).then(|| format!("in {}", numbers::plural(report.sessions, "session"))),
    )
}

fn top_model(report: &UsageReport, metric: Metric) -> Figure {
    let top = match metric {
        Metric::Cost => report.by_model.iter().max_by(|left, right| left.cost_usd.total_cmp(&right.cost_usd)),
        Metric::Tokens => report.by_model.first(),
    };
    let Some(top) = top else { return Figure::new(None, "", None) };
    let share = match metric {
        Metric::Cost => (report.cost_usd > 0.0).then(|| top.cost_usd / report.cost_usd),
        Metric::Tokens => ratio(top.tokens, report.total_tokens),
    }
    .unwrap_or(0.0);
    let what = if metric == Metric::Cost { "cost" } else { "tokens" };
    Figure::new(
        Some(top.model.clone()),
        "",
        Some(format!("{} · {} of {what}", top.provider, numbers::percent(share * 100.0))),
    )
}

fn read(report: &UsageReport) -> Figure {
    Figure::new(
        Some(numbers::compact(report.input_tokens)),
        "tokens",
        ratio(report.cache_read_tokens, report.input_tokens)
            .map(|cached| format!("{} from cache", numbers::percent(cached * 100.0))),
    )
}

fn written(report: &UsageReport) -> Figure {
    Figure::new(
        Some(numbers::compact(report.output_tokens)),
        "tokens",
        ratio(report.output_tokens, report.total_tokens)
            .map(|share| format!("{} of all tokens", numbers::percent(share * 100.0))),
    )
}

fn per_request(report: &UsageReport) -> Figure {
    if report.requests == 0 {
        return Figure::new(None, "tokens", None);
    }
    #[allow(clippy::cast_precision_loss)]
    let count = report.requests as f64;
    #[allow(clippy::cast_precision_loss)]
    let tokens = report.total_tokens as f64 / count;
    Figure::new(
        Some(numbers::compact_f64(tokens)),
        "tokens",
        Some(format!("{} each", numbers::cost(report.cost_usd / count))),
    )
}

pub struct LimitsView {
    pub root: gtk::Box,
    rows: gtk::Box,
}

impl LimitsView {
    pub fn build() -> Self {
        let rows = gtk::Box::new(gtk::Orientation::Vertical, 0);
        let root = gtk::Box::new(gtk::Orientation::Vertical, 12);
        root.set_margin_top(34);
        root.append(&label("Provider limits", &["dim-label", "ls-dash-label"]));
        root.append(&rows);
        Self { root, rows }
    }

    pub fn fill(&self, limits: &[UsageLimit], providers: &[ProviderStatus]) {
        while let Some(child) = self.rows.first_child() {
            self.rows.remove(&child);
        }
        if limits.is_empty() {
            let empty = label(LIMITS_EMPTY, &["dim-label", "ls-dash-label"]);
            empty.set_wrap(true);
            empty.set_margin_top(6);
            self.rows.append(&empty);
            return;
        }
        for (index, limit) in limits.iter().enumerate() {
            if index > 0 {
                self.rows.append(&gtk::Separator::new(gtk::Orientation::Horizontal));
            }
            let name = providers
                .iter()
                .find(|provider| provider.id == limit.provider)
                .map_or(limit.provider.as_str(), |provider| provider.name.as_str());
            self.rows.append(&limit_row(limit, name));
        }
    }
}

fn limit_row(limit: &UsageLimit, name: &str) -> gtk::Box {
    let titles = gtk::Box::new(gtk::Orientation::Vertical, 3);
    titles.set_hexpand(true);
    titles.append(&label(name, &["ls-dash-name"]));
    let detail = label(&limit_detail(limit), &["dim-label", "ls-dash-label"]);
    detail.set_ellipsize(pango::EllipsizeMode::End);
    titles.append(&detail);
    let row = gtk::Box::new(gtk::Orientation::Horizontal, 12);
    row.set_margin_top(12);
    row.set_margin_bottom(12);
    row.append(&titles);
    if let Some(used) = limit.used_percent {
        row.append(&share_bar(used / 100.0, 160, limit.parked));
        let percent = label(&numbers::percent(used), &["ls-dash-label", "ls-dash-num"]);
        percent.set_xalign(1.0);
        percent.set_width_chars(5);
        percent.set_valign(gtk::Align::Center);
        row.append(&percent);
    }
    row
}

fn limit_detail(limit: &UsageLimit) -> String {
    let mut window = limit.window.chars();
    let mut parts =
        vec![window.next().map_or_else(String::new, |first| first.to_uppercase().chain(window).collect::<String>())];
    let now = format::now_ms();
    match (limit.parked, limit.resets_at) {
        (true, Some(resets)) => {
            let clock = gtk::glib::DateTime::from_unix_local(resets / 1000)
                .ok()
                .and_then(|time| time.format("%H:%M").ok())
                .map(|text| text.to_string())
                .unwrap_or_default();
            parts.push(format!("parked until {clock} ({})", until(resets, now)));
        }
        (true, None) => parts.push("parked".to_string()),
        (false, Some(resets)) => parts.push(format!("resets {}", until(resets, now))),
        (false, None) => {}
    }
    parts.join(" · ")
}

fn until(at: i64, now: i64) -> String {
    let left = format::countdown(at, now);
    if left == "soon" {
        left
    } else {
        format!("in {left}")
    }
}
