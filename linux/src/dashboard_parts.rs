use adw::prelude::*;
use gtk::pango;
use local_studio_core::TokenHistory;

use crate::dashboard_charts::Sparkline;
use crate::icons;
use crate::numbers;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Plain,
    Warning,
    Danger,
}

pub struct Figure {
    pub value: Option<String>,
    pub unit: String,
    pub hint: Option<String>,
    pub tone: Tone,
}

impl Figure {
    pub fn new(value: Option<String>, unit: &str, hint: Option<String>) -> Self {
        Self { value, unit: unit.to_string(), hint, tone: Tone::Plain }
    }
}

pub fn label(text: &str, classes: &[&str]) -> gtk::Label {
    let label = gtk::Label::new(Some(text));
    for class in classes {
        label.add_css_class(class);
    }
    label.set_xalign(0.0);
    label
}

pub fn hairline(top: i32, bottom: i32) -> gtk::Separator {
    let rule = gtk::Separator::new(gtk::Orientation::Horizontal);
    rule.set_margin_top(top);
    rule.set_margin_bottom(bottom);
    rule
}

pub fn tab(child: &impl IsA<gtk::Widget>) -> gtk::ToggleButton {
    let button = gtk::ToggleButton::builder().child(child).build();
    button.add_css_class("flat");
    button.add_css_class("ls-dash-tab");
    button
}

pub fn button(child: &impl IsA<gtk::Widget>, bordered: bool) -> gtk::Button {
    let button = gtk::Button::builder().child(child).valign(gtk::Align::Start).build();
    button.add_css_class("ls-dash-button");
    set_bordered(&button, bordered);
    button
}

pub fn set_bordered(button: &gtk::Button, bordered: bool) {
    if bordered {
        button.remove_css_class("flat");
        button.add_css_class("bordered");
    } else {
        button.remove_css_class("bordered");
        button.add_css_class("flat");
    }
}

pub struct FigureView {
    pub root: gtk::Box,
    title: gtk::Label,
    value: gtk::Label,
    unit: gtk::Label,
    hint_row: gtk::Box,
    icon: gtk::Image,
    hint: gtk::Label,
}

impl FigureView {
    pub fn build(title: &str) -> Self {
        let root = gtk::Box::new(gtk::Orientation::Vertical, 6);
        let title = label(title, &["dim-label", "ls-dash-label"]);
        root.append(&title);
        let value = label("—", &["ls-dash-value"]);
        value.set_ellipsize(pango::EllipsizeMode::Middle);
        let unit = label("", &["dim-label", "ls-dash-label"]);
        value.set_valign(gtk::Align::BaselineFill);
        unit.set_valign(gtk::Align::BaselineFill);
        let line = gtk::Box::new(gtk::Orientation::Horizontal, 5);
        line.append(&value);
        line.append(&unit);
        root.append(&line);
        let icon = icons::image(icons::WARNING);
        icon.set_visible(false);
        let hint = label(" ", &["ls-dash-label"]);
        hint.set_ellipsize(pango::EllipsizeMode::End);
        let hint_row = gtk::Box::new(gtk::Orientation::Horizontal, 5);
        hint_row.append(&icon);
        hint_row.append(&hint);
        root.append(&hint_row);
        Self { root, title, value, unit, hint_row, icon, hint }
    }

    pub fn set_title(&self, title: &str) {
        self.title.set_label(title);
    }

    pub fn set(&self, figure: &Figure) {
        self.value.set_label(figure.value.as_deref().unwrap_or("—"));
        self.unit.set_label(&figure.unit);
        self.unit.set_visible(!figure.unit.is_empty());
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

pub struct Hero {
    pub root: gtk::Box,
    title: gtk::Label,
    value: gtk::Label,
    unit: gtk::Label,
    hint: gtk::Label,
}

impl Hero {
    pub fn build(title: &str, unit: &str) -> Self {
        let title = label(title, &["dim-label", "ls-dash-label"]);
        let value = label("—", &["ls-dash-hero"]);
        value.set_ellipsize(pango::EllipsizeMode::End);
        let unit = label(unit, &["dim-label", "ls-dash-label"]);
        value.set_valign(gtk::Align::BaselineFill);
        unit.set_valign(gtk::Align::BaselineFill);
        let line = gtk::Box::new(gtk::Orientation::Horizontal, 5);
        line.append(&value);
        line.append(&unit);
        let hint = label(" ", &["dim-label", "ls-dash-label"]);
        hint.set_ellipsize(pango::EllipsizeMode::End);
        let root = gtk::Box::new(gtk::Orientation::Vertical, 4);
        root.set_margin_top(44);
        root.append(&title);
        root.append(&line);
        root.append(&hint);
        Self { root, title, value, unit, hint }
    }

    pub fn set(&self, title: &str, value: Option<&str>, unit: &str, hint: &str) {
        self.title.set_label(title);
        self.value.set_label(value.unwrap_or("—"));
        self.unit.set_label(unit);
        self.unit.set_visible(!unit.is_empty());
        self.hint.set_label(if hint.is_empty() { " " } else { hint });
    }
}

pub fn figure_grid(hero: &Hero, chart_title: &gtk::Label, sparkline: &Sparkline, rows: &[&[FigureView]]) -> gtk::Grid {
    let grid = gtk::Grid::builder().column_homogeneous(true).column_spacing(12).build();
    let chart = gtk::Box::new(gtk::Orientation::Vertical, 10);
    chart.set_margin_top(44);
    chart.append(chart_title);
    chart.append(&sparkline.area);
    grid.attach(&hero.root, 0, 0, 1, 1);
    grid.attach(&chart, 1, 0, 2, 1);
    for (row, figures) in (1..).zip(rows.iter()) {
        for (column, figure) in (0..).zip(figures.iter()) {
            figure.root.set_margin_top(if row == 1 { 48 } else { 40 });
            grid.attach(&figure.root, column, row, 1, 1);
        }
    }
    grid
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

pub struct TokenSummary {
    pub root: gtk::Box,
    since: gtk::Label,
    total: gtk::Label,
    split: gtk::Label,
    week: gtk::Label,
    busiest: gtk::Label,
    active: gtk::Label,
    extra: Vec<gtk::Label>,
}

impl TokenSummary {
    pub fn build(extra: &[&str]) -> Self {
        let since = label("Tokens", &["dim-label", "ls-dash-label"]);
        let total = label("—", &["ls-dash-total"]);
        total.set_ellipsize(pango::EllipsizeMode::End);
        let split = label(" ", &["dim-label", "ls-dash-label"]);
        split.set_wrap(true);
        let rows = gtk::Box::new(gtk::Orientation::Vertical, 0);
        rows.set_margin_top(26);
        let add = |title: &str| {
            if rows.first_child().is_some() {
                rows.append(&gtk::Separator::new(gtk::Orientation::Horizontal));
            }
            let (row, value) = summary_row(title);
            rows.append(&row);
            value
        };
        let week = add("Last 7 days");
        let busiest = add("Busiest day");
        let active = add("Active days");
        let extra = extra.iter().map(|title| add(title)).collect();
        let root = gtk::Box::new(gtk::Orientation::Vertical, 0);
        root.set_margin_top(2);
        root.set_size_request(244, -1);
        root.set_hexpand(false);
        root.append(&since);
        root.append(&total);
        root.append(&split);
        root.append(&rows);
        Self { root, since, total, split, week, busiest, active, extra }
    }

    pub fn move_since(&self) {
        self.since.set_visible(false);
        self.root.set_margin_top(34);
    }

    pub fn set(&self, tokens: Option<&TokenHistory>, empty: &str) {
        self.since.set_label(&since_text(tokens));
        self.total.set_label(&tokens.map_or_else(|| "—".to_string(), |tokens| numbers::compact(tokens.total)));
        self.split.set_label(&match tokens {
            None => " ".to_string(),
            Some(tokens) if tokens.total == 0 => empty.to_string(),
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
    }

    pub fn set_extra(&self, index: usize, value: Option<&str>) {
        if let Some(label) = self.extra.get(index) {
            label.set_label(value.unwrap_or("—"));
        }
    }
}

pub fn since_text(tokens: Option<&TokenHistory>) -> String {
    tokens
        .and_then(|tokens| tokens.since_day.as_deref())
        .and_then(numbers::parse_day)
        .map_or_else(|| "Tokens".to_string(), |day| format!("Tokens since {}", numbers::day(day, true)))
}

pub fn columns(left: &impl IsA<gtk::Widget>, summary: &TokenSummary) -> gtk::Box {
    let divider = gtk::Separator::new(gtk::Orientation::Vertical);
    divider.set_margin_start(44);
    divider.set_margin_end(44);
    let top = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    top.append(left);
    top.append(&divider);
    top.append(&summary.root);
    top
}

#[allow(clippy::cast_precision_loss)]
pub fn token_values(tokens: &TokenHistory) -> impl Iterator<Item = f64> + Clone + '_ {
    tokens.daily.iter().map(|value| *value as f64)
}
