use std::rc::Rc;

use adw::prelude::*;
use local_studio_core::{ColorScheme, Settings, Update, UsagePeriod};

use crate::app::App;
use crate::state::Page;

const LIVE: [&str; 9] = [
    "usage-live",
    "usage-live-light",
    "usage-live-cost",
    "usage-live-cost-light",
    "usage-live-day",
    "usage-live-day-light",
    "usage-live-gildrb",
    "usage-live-gildrb-dark",
    "usage-live-limits",
];

struct Live {
    period: UsagePeriod,
    mode: &'static str,
    color_scheme: ColorScheme,
    theme: Option<String>,
}

fn live(scene: &str) -> Option<Live> {
    if !LIVE.contains(&scene) {
        return None;
    }
    let gildrb = scene.contains("-gildrb");
    let color_scheme = if scene.ends_with("-light") || (gildrb && !scene.ends_with("-dark")) {
        ColorScheme::Light
    } else {
        ColorScheme::Dark
    };
    let mode = if scene.contains("-cost") {
        "cost"
    } else if scene.contains("-limits") {
        "limits"
    } else {
        "tokens"
    };
    Some(Live {
        period: if scene.contains("-day") { UsagePeriod::Day } else { UsagePeriod::Month },
        mode,
        color_scheme,
        theme: gildrb.then(|| crate::colors::GILDRB.to_string()),
    })
}

pub fn scenes() -> Vec<&'static str> {
    if std::env::var("LOCAL_STUDIO_SNAPSHOT_LIVE").is_ok_and(|value| value == "1") {
        LIVE.to_vec()
    } else {
        Vec::new()
    }
}

pub fn stage(app: &Rc<App>, scene: &str) -> bool {
    let Some(live) = live(scene) else { return false };
    if !app.core.is_live() {
        app.start_core();
    }
    app.window.set_default_size(1600, 1500);
    app.split.set_show_sidebar(false);
    appearance(app, &live);
    app.state.borrow_mut().usage = None;
    app.usage.set_mode(live.mode);
    app.usage.choose(live.period);
    app.open_page(Page::Usage);
    true
}

pub fn ready(app: &Rc<App>, scene: &str) -> bool {
    let Some(live) = live(scene) else { return true };
    app.state.borrow().usage.as_ref().is_some_and(|report| report.period == live.period)
}

pub fn retry(app: &Rc<App>, scene: &str) {
    if live(scene).is_some() {
        app.usage.refresh(app);
    }
}

pub fn finish(app: &Rc<App>, scene: &str) -> bool {
    let Some(live) = live(scene) else { return false };
    appearance(app, &live);
    app.usage.render(&app.state.borrow());
    true
}

fn appearance(app: &Rc<App>, live: &Live) {
    let settings =
        Settings { color_scheme: live.color_scheme, theme: live.theme.clone(), ..app.state.borrow().settings.clone() };
    app.apply(vec![Update::Settings { settings }]);
}
