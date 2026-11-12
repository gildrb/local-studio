use std::rc::Weak;

use adw::prelude::*;
use local_studio_core::{Goal, ModelKey};

use crate::app::App;
use crate::format;
use crate::icons;
use crate::picker::{Picker, Row, Spec};
use crate::state::State;

const STANDARD: &str = "standard";
const TIER: &str = "tier:";

pub struct Options {
    pub compare: gtk::MenuButton,
    pub tier: Picker,
    pub goal: gtk::Box,
    compare_list: gtk::Box,
    goal_label: gtk::Label,
    goal_meta: gtk::Label,
    app: Weak<App>,
}

impl Options {
    pub fn new(app: &Weak<App>) -> Self {
        let compare_list = gtk::Box::new(gtk::Orientation::Vertical, 2);
        let heading = gtk::Label::new(Some("Also run on"));
        heading.add_css_class("heading");
        heading.set_xalign(0.0);
        let hint = gtk::Label::new(Some("Each model gets its own thread with the same prompt."));
        hint.add_css_class("ls-meta");
        hint.set_xalign(0.0);
        hint.set_wrap(true);
        hint.set_max_width_chars(32);
        let body = gtk::Box::new(gtk::Orientation::Vertical, 6);
        body.set_margin_top(6);
        body.set_margin_bottom(6);
        body.set_margin_start(6);
        body.set_margin_end(6);
        body.append(&heading);
        body.append(&hint);
        body.append(&compare_list);
        let popover = gtk::Popover::builder().child(&body).build();
        let compare = gtk::MenuButton::builder().icon_name(icons::SPLIT).popover(&popover).build();
        icons::describe(&compare, "Compare Models (fan out)");
        compare.add_css_class("flat");
        let tier = tier_picker(app);
        tier.button.set_visible(false);
        let goal = gtk::Box::new(gtk::Orientation::Horizontal, 8);
        goal.add_css_class("ls-goal");
        goal.set_visible(false);
        let icon = icons::styled(icons::GOAL, "accent");
        let goal_label = gtk::Label::new(None);
        goal_label.set_xalign(0.0);
        goal_label.set_hexpand(true);
        goal_label.set_ellipsize(gtk::pango::EllipsizeMode::End);
        let goal_meta = gtk::Label::new(None);
        goal_meta.add_css_class("ls-meta");
        goal.append(&icon);
        goal.append(&goal_label);
        goal.append(&goal_meta);
        Self { compare, tier, goal, compare_list, goal_label, goal_meta, app: app.clone() }
    }

    pub fn render(&self, state: &State) {
        self.render_compare(state);
        let info = state.selected.as_ref().and(state.info.as_ref());
        let tiers = info.map(|info| info.service_tiers.clone()).unwrap_or_default();
        self.tier.button.set_visible(!tiers.is_empty());
        let current = info.and_then(|info| info.service_tier.as_ref()).filter(|tier| tiers.contains(tier));
        let mut rows = vec![Row::new(STANDARD, "Standard").checked(current.is_none())];
        rows.extend(
            tiers.iter().map(|tier| Row::new(format!("{TIER}{tier}"), tier_label(tier)).checked(current == Some(tier))),
        );
        self.tier.set_rows(rows);
        self.tier.set_label(&current.map_or_else(|| "Standard".to_string(), |tier| tier_label(tier)));
        match info.and_then(|info| info.goal.as_ref()) {
            Some(goal) => self.render_goal(goal),
            None => self.goal.set_visible(false),
        }
    }

    fn render_goal(&self, goal: &Goal) {
        self.goal.set_visible(true);
        self.goal.set_tooltip_text(Some(&goal.objective));
        self.goal_label.set_label(&format!("Goal: {}", goal.objective));
        let mut meta = vec![goal.status.clone()];
        meta.push(match goal.token_budget {
            Some(budget) => format!("{} / {} tokens", format::tokens(goal.tokens_used), format::tokens(budget)),
            None => format!("{} tokens", format::tokens(goal.tokens_used)),
        });
        meta.push(format::duration(goal.time_used_seconds.saturating_mul(1000)));
        self.goal_meta.set_label(&meta.join(" · "));
        if goal.active {
            self.goal.add_css_class("active");
        } else {
            self.goal.remove_css_class("active");
        }
    }

    fn render_compare(&self, state: &State) {
        let draft = state.selected.is_none();
        let active = state.active_model();
        let candidates: Vec<&local_studio_core::ModelOption> = state
            .models
            .iter()
            .filter(|model| model.configured)
            .filter(|model| active.as_ref().is_none_or(|key| key.provider != model.provider || key.model != model.id))
            .collect();
        self.compare.set_visible(draft && !candidates.is_empty());
        let count = state.draft_settings.compare.len();
        if count > 0 {
            self.compare.set_label(&format!("+{count}"));
            self.compare.add_css_class("ls-compare-on");
        } else {
            self.compare.set_icon_name(icons::SPLIT);
            self.compare.remove_css_class("ls-compare-on");
        }
        while let Some(child) = self.compare_list.first_child() {
            self.compare_list.remove(&child);
        }
        for model in candidates {
            let key = ModelKey { provider: model.provider.clone(), model: model.id.clone() };
            let check = gtk::CheckButton::with_label(&model.name);
            check.set_active(state.draft_settings.compare.contains(&key));
            let weak = self.app.clone();
            check.connect_toggled(move |check| {
                let Some(app) = weak.upgrade() else { return };
                {
                    let mut state = app.state.borrow_mut();
                    let compare = &mut state.draft_settings.compare;
                    compare.retain(|known| known != &key);
                    if check.is_active() {
                        compare.push(key.clone());
                    }
                }
                let count = app.state.borrow().draft_settings.compare.len();
                if count > 0 {
                    app.composer.options.compare.set_label(&format!("+{count}"));
                    app.composer.options.compare.add_css_class("ls-compare-on");
                } else {
                    app.composer.options.compare.set_icon_name(icons::SPLIT);
                    app.composer.options.compare.remove_css_class("ls-compare-on");
                }
            });
            self.compare_list.append(&check);
        }
    }
}

fn tier_picker(app: &Weak<App>) -> Picker {
    let weak = app.clone();
    let spec = Spec { tooltip: "Speed (service tier)", title: Some("Speed"), width: 220, ..Spec::default() };
    Picker::new(&spec, move |id| {
        let Some(app) = weak.upgrade() else { return };
        if app.syncing.get() {
            return;
        }
        let Some(thread) = app.state.borrow().selected.clone() else { return };
        let tier = id.strip_prefix(TIER).map(str::to_string);
        app.core.run(|studio| studio.set_service_tier(thread, tier));
    })
}

fn tier_label(tier: &str) -> String {
    match tier {
        "priority" => "Fast".to_string(),
        "flex" => "Flex (cheaper)".to_string(),
        other => format::capitalize(other),
    }
}
