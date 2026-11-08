use std::cell::RefCell;
use std::rc::Rc;

use adw::prelude::*;
use gtk::{cairo, gdk, glib, pango};

use crate::numbers;

const COLUMNS: usize = 53;
const GAP: f64 = 3.0;
const LABEL_HEIGHT: f64 = 20.0;
const OPACITIES: [f64; 5] = [0.0, 0.3, 0.5, 0.75, 1.0];

fn accent(widget: &impl IsA<gtk::Widget>) -> gdk::RGBA {
    gdk::RGBA::parse(crate::colors::current().accent).unwrap_or_else(|_| widget.as_ref().color())
}

fn source(cr: &cairo::Context, color: &gdk::RGBA, alpha: f64) {
    cr.set_source_rgba(
        f64::from(color.red()),
        f64::from(color.green()),
        f64::from(color.blue()),
        f64::from(color.alpha()) * alpha,
    );
}

fn rounded(cr: &cairo::Context, x: f64, y: f64, size: f64, radius: f64) {
    let quarter = std::f64::consts::FRAC_PI_2;
    cr.new_sub_path();
    cr.arc(x + size - radius, y + radius, radius, -quarter, 0.0);
    cr.arc(x + size - radius, y + size - radius, radius, 0.0, quarter);
    cr.arc(x + radius, y + size - radius, radius, quarter, 2.0 * quarter);
    cr.arc(x + radius, y + radius, radius, 2.0 * quarter, 3.0 * quarter);
    cr.close_path();
}

pub struct Sparkline {
    pub area: gtk::DrawingArea,
    values: Rc<RefCell<Vec<f64>>>,
}

impl Sparkline {
    pub fn build() -> Self {
        let area = gtk::DrawingArea::builder().content_height(76).hexpand(true).build();
        let values: Rc<RefCell<Vec<f64>>> = Rc::default();
        let drawn = Rc::clone(&values);
        area.set_draw_func(move |area, cr, width, height| {
            draw_sparkline(area, cr, f64::from(width), f64::from(height), &drawn.borrow());
        });
        Self { area, values }
    }

    pub fn set(&self, values: &[f64]) {
        if self.values.borrow().as_slice() != values {
            self.values.replace(values.to_vec());
        }
        self.area.queue_draw();
    }
}

fn draw_sparkline(area: &gtk::DrawingArea, cr: &cairo::Context, width: f64, height: f64, values: &[f64]) {
    if values.is_empty() {
        return;
    }
    let peak = values.iter().copied().fold(0.0_f64, f64::max);
    let top = (peak * 1.05).max(1.0);
    #[allow(clippy::cast_precision_loss)]
    let span = (values.len().max(2) - 1) as f64;
    let inset = 1.5;
    let points: Vec<(f64, f64)> = values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            #[allow(clippy::cast_precision_loss)]
            let x = index as f64 / span * width;
            (x, inset + (height - 2.0 * inset) * (1.0 - value.max(0.0) / top))
        })
        .collect();
    let color = accent(area);
    trace(cr, &points, height - inset);
    if let (Some(first), Some(last)) = (points.first(), points.last()) {
        cr.line_to(last.0, height);
        cr.line_to(first.0, height);
        cr.close_path();
    }
    let gradient = cairo::LinearGradient::new(0.0, 0.0, 0.0, height);
    let (red, green, blue) = (f64::from(color.red()), f64::from(color.green()), f64::from(color.blue()));
    gradient.add_color_stop_rgba(0.0, red, green, blue, 0.22);
    gradient.add_color_stop_rgba(1.0, red, green, blue, 0.0);
    cr.set_source(&gradient).ok();
    cr.fill().ok();
    trace(cr, &points, height - inset);
    source(cr, &color, 1.0);
    cr.set_line_width(1.5);
    cr.set_line_cap(cairo::LineCap::Round);
    cr.set_line_join(cairo::LineJoin::Round);
    cr.stroke().ok();
}

fn trace(cr: &cairo::Context, points: &[(f64, f64)], floor: f64) {
    let Some(first) = points.first() else { return };
    cr.new_path();
    cr.move_to(first.0, first.1);
    let last = points.len() - 1;
    for index in 0..last {
        let before = points[index.saturating_sub(1)];
        let from = points[index];
        let to = points[index + 1];
        let after = points[(index + 2).min(last)];
        cr.curve_to(
            from.0 + (to.0 - before.0) / 6.0,
            (from.1 + (to.1 - before.1) / 6.0).min(floor),
            to.0 - (after.0 - from.0) / 6.0,
            (to.1 - (after.1 - from.1) / 6.0).min(floor),
            to.0,
            to.1,
        );
    }
}

struct Heat {
    last_day: Option<String>,
    values: Vec<f64>,
    levels: Vec<usize>,
    last: i64,
    last_row: usize,
    months: Vec<(usize, String)>,
    hovered: Option<usize>,
    present: bool,
    format: fn(f64) -> String,
}

impl Default for Heat {
    fn default() -> Self {
        Self {
            last_day: None,
            values: Vec::new(),
            levels: Vec::new(),
            last: 0,
            last_row: 0,
            months: Vec::new(),
            hovered: None,
            present: false,
            format: numbers::tokens,
        }
    }
}

impl Heat {
    fn load<I: Iterator<Item = f64> + Clone>(&mut self, source: Option<(I, &str)>, format: fn(f64) -> String) {
        self.format = format;
        let unchanged = match &source {
            Some((values, last_day)) => {
                self.present
                    && self.last_day.as_deref() == Some(*last_day)
                    && self.values.iter().copied().eq(values.clone())
            }
            None => !self.present && !self.values.is_empty(),
        };
        if unchanged {
            return;
        }
        let present = source.is_some();
        let (values, last_day) = match source {
            Some((values, last_day)) => (values.collect::<Vec<f64>>(), Some(last_day.to_string())),
            None => (vec![0.0; COLUMNS * 7], None),
        };
        let last = last_day.as_deref().and_then(numbers::parse_day).unwrap_or_else(numbers::today);
        let last_row = usize::try_from((numbers::weekday(last) - numbers::first_weekday()).rem_euclid(7)).unwrap_or(0);
        let mut nonzero: Vec<f64> = values.iter().copied().filter(|value| *value > 0.0).collect();
        nonzero.sort_unstable_by(f64::total_cmp);
        let scale = nonzero.get((nonzero.len() * 9 / 10).min(nonzero.len().saturating_sub(1))).copied().unwrap_or(1.0);
        let levels: Vec<usize> = values.iter().map(|value| level(*value, scale)).collect();
        let mut months = Vec::new();
        for column in 0..COLUMNS {
            let offset = i64::try_from((COLUMNS - 1 - column) * 7 + last_row).unwrap_or(0);
            let (_, month, date) = numbers::civil(last - offset);
            if date <= 7 {
                months.push((column, numbers::month_name(month)));
            }
        }
        *self = Self { last_day, values, levels, last, last_row, months, hovered: None, present, format };
    }

    fn slot(&self, index: usize) -> Option<(usize, usize)> {
        let offset = self.values.len().checked_sub(1)?.checked_sub(index)?;
        let slot = ((COLUMNS - 1) * 7 + self.last_row).checked_sub(offset)?;
        Some((slot / 7, slot % 7))
    }

    fn index_at(&self, width: f64, x: f64, y: f64) -> Option<usize> {
        let pitch = pitch(width);
        if y < LABEL_HEIGHT || x < 0.0 {
            return None;
        }
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let (column, row) = ((x / pitch) as usize, ((y - LABEL_HEIGHT) / pitch) as usize);
        if column >= COLUMNS || row >= 7 {
            return None;
        }
        let back = ((COLUMNS - 1) * 7 + self.last_row).checked_sub(column * 7 + row)?;
        let index = self.values.len().checked_sub(1)?.checked_sub(back)?;
        Some(index)
    }

    fn caption(&self) -> String {
        if !self.present {
            return " ".to_string();
        }
        let Some(index) = self.hovered.or_else(|| self.values.len().checked_sub(1)) else {
            return " ".to_string();
        };
        let Some(value) = self.values.get(index).copied() else { return " ".to_string() };
        let back = i64::try_from(self.values.len().saturating_sub(1).saturating_sub(index)).unwrap_or(0);
        format!("{}: {}", numbers::day(self.last - back, true), (self.format)(value))
    }
}

fn pitch(width: f64) -> f64 {
    #[allow(clippy::cast_precision_loss)]
    let columns = COLUMNS as f64;
    (width + GAP) / columns
}

fn height_for(width: f64) -> i32 {
    #[allow(clippy::cast_possible_truncation)]
    let height = (LABEL_HEIGHT + pitch(width) * 7.0 - GAP).ceil() as i32;
    height.max(40)
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn level(value: f64, scale: f64) -> usize {
    if value <= 0.0 {
        return 0;
    }
    1 + ((4.0 * value / scale.max(f64::MIN_POSITIVE)) as usize).min(3)
}

pub struct Heatmap {
    pub root: gtk::Box,
    area: gtk::DrawingArea,
    caption: gtk::Label,
    heat: Rc<RefCell<Heat>>,
}

impl Heatmap {
    pub fn build() -> Self {
        let area = gtk::DrawingArea::builder().content_height(height_for(900.0)).hexpand(true).build();
        let heat: Rc<RefCell<Heat>> = Rc::default();
        let drawn = Rc::clone(&heat);
        area.set_draw_func(move |area, cr, width, _| draw_heatmap(area, cr, f64::from(width), &drawn.borrow()));
        area.connect_resize(|area, width, _| {
            let wanted = height_for(f64::from(width));
            if area.content_height() != wanted {
                let area = area.clone();
                glib::idle_add_local_once(move || area.set_content_height(wanted));
            }
        });
        let caption = gtk::Label::new(Some(" "));
        caption.add_css_class("dim-label");
        caption.add_css_class("ls-dash-small");
        caption.add_css_class("ls-dash-num");
        caption.set_xalign(0.0);
        caption.set_hexpand(true);
        let motion = gtk::EventControllerMotion::new();
        let (hover_heat, hover_caption) = (Rc::clone(&heat), caption.clone());
        let hover_area = area.downgrade();
        motion.connect_motion(move |_, x, y| {
            let Some(area) = hover_area.upgrade() else { return };
            let mut heat = hover_heat.borrow_mut();
            let index = heat.index_at(f64::from(area.width()), x, y);
            if index != heat.hovered {
                heat.hovered = index;
                hover_caption.set_label(&heat.caption());
                area.queue_draw();
            }
        });
        let (leave_heat, leave_caption) = (Rc::clone(&heat), caption.clone());
        let leave_area = area.downgrade();
        motion.connect_leave(move |_| {
            let mut heat = leave_heat.borrow_mut();
            if heat.hovered.take().is_some() {
                leave_caption.set_label(&heat.caption());
                if let Some(area) = leave_area.upgrade() {
                    area.queue_draw();
                }
            }
        });
        area.add_controller(motion);
        let legend = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        let less = gtk::Label::new(Some("Less"));
        less.add_css_class("dim-label");
        less.add_css_class("ls-dash-small");
        legend.append(&caption);
        legend.append(&less);
        for level in 0..OPACITIES.len() {
            let cell = gtk::Box::new(gtk::Orientation::Horizontal, 0);
            cell.add_css_class("ls-heat-cell");
            cell.add_css_class(&format!("level-{level}"));
            cell.set_valign(gtk::Align::Center);
            legend.append(&cell);
        }
        let more = gtk::Label::new(Some("More"));
        more.add_css_class("dim-label");
        more.add_css_class("ls-dash-small");
        legend.append(&more);
        let root = gtk::Box::new(gtk::Orientation::Vertical, 10);
        root.append(&area);
        root.append(&legend);
        Self { root, area, caption, heat }
    }

    pub fn set<I: Iterator<Item = f64> + Clone>(
        &self,
        source: Option<(I, &str)>,
        format: fn(f64) -> String,
        label: &str,
    ) {
        self.heat.borrow_mut().load(source, format);
        let caption = self.heat.borrow().caption();
        self.caption.set_label(&caption);
        self.area.update_property(&[
            gtk::accessible::Property::Label(label),
            gtk::accessible::Property::Description(&caption),
        ]);
        self.area.queue_draw();
    }
}

pub fn share_bar(fraction: f64, width: i32, warning: bool) -> gtk::DrawingArea {
    let area = gtk::DrawingArea::builder().content_width(width).content_height(5).valign(gtk::Align::Center).build();
    let fraction = fraction.clamp(0.0, 1.0);
    area.set_draw_func(move |area, cr, width, height| {
        let (width, height) = (f64::from(width), f64::from(height));
        let radius = height / 2.0;
        capsule(cr, width, radius);
        source(cr, &area.color(), 0.06);
        cr.fill().ok();
        if fraction > 0.0 {
            capsule(cr, (width * fraction).max(height), radius);
            let colors = crate::colors::current();
            let fill =
                gdk::RGBA::parse(if warning { colors.warn } else { colors.accent }).unwrap_or_else(|_| area.color());
            source(cr, &fill, 1.0);
            cr.fill().ok();
        }
    });
    area
}

fn capsule(cr: &cairo::Context, width: f64, radius: f64) {
    let half = std::f64::consts::FRAC_PI_2;
    cr.new_path();
    cr.arc(radius, radius, radius, half, 3.0 * half);
    cr.arc((width - radius).max(radius), radius, radius, -half, half);
    cr.close_path();
}

#[allow(clippy::cast_precision_loss)]
fn draw_heatmap(area: &gtk::DrawingArea, cr: &cairo::Context, width: f64, heat: &Heat) {
    let pitch = pitch(width);
    let cell = (pitch - GAP).max(2.0);
    let radius = cell * 0.2;
    let text = area.color();
    let color = accent(area);
    let layout = area.create_pango_layout(None);
    let mut font = area.pango_context().font_description().unwrap_or_default();
    font.set_absolute_size(11.0 * f64::from(pango::SCALE));
    layout.set_font_description(Some(&font));
    source(cr, &text, 0.55);
    for (column, title) in &heat.months {
        layout.set_text(title);
        cr.move_to(*column as f64 * pitch, 0.0);
        pangocairo::functions::show_layout(cr, &layout);
    }
    for (level, opacity) in OPACITIES.iter().enumerate() {
        cr.new_path();
        for (index, _) in heat.levels.iter().enumerate().filter(|(_, value)| **value == level) {
            if let Some((x, y)) = cell_origin(heat, index, pitch) {
                rounded(cr, x, y, cell, radius);
            }
        }
        if level == 0 {
            source(cr, &text, 0.06);
        } else {
            source(cr, &color, *opacity);
        }
        cr.fill().ok();
    }
    if let Some((x, y)) = heat.hovered.and_then(|index| cell_origin(heat, index, pitch)) {
        cr.new_path();
        rounded(cr, x + 0.75, y + 0.75, cell - 1.5, (radius - 0.75).max(0.5));
        source(cr, &text, 0.7);
        cr.set_line_width(1.5);
        cr.stroke().ok();
    }
}

fn cell_origin(heat: &Heat, index: usize, pitch: f64) -> Option<(f64, f64)> {
    let (column, row) = heat.slot(index)?;
    #[allow(clippy::cast_precision_loss)]
    let origin = (column as f64 * pitch, LABEL_HEIGHT + row as f64 * pitch);
    Some(origin)
}
