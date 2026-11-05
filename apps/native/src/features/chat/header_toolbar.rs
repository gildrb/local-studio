use std::time::Instant;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, ClickEvent, Entity, FontWeight, InteractiveElement, IntoElement, KeyDownEvent,
    ParentElement, RenderOnce, Rgba, SharedString, Styled, Window, canvas, div, px,
};
use serde_json::json;

use crate::app::workspace_page_header::GUTTER;
use crate::app_core::client::CoreClient;
use crate::app_core::views::header_toolbar::{
    GitToolbarView, HeaderActionsLayoutView, HeaderToolbarView, PanelToggleView,
};
use crate::app_core::views::open_in::OpenInPickerModel;
use crate::features::chat::git_actions_control::{
    GitActionsControl, overflow_entries as git_overflow,
};
use crate::features::chat::header_overflow::{
    measured_trigger, overflow_menu, owns_pointer, set_overflow_open,
};
use crate::features::chat::open_in_picker::{OpenInPicker, overflow_entries as open_in_overflow};
use crate::features::chat::project_scripts_control::{
    ProjectScriptsControl, overflow_entries as scripts_overflow,
};
use crate::features::chat::project_scripts_host::ProjectScriptsHost;
use crate::features::chat::toolbar_parts::act;
use crate::features::right_panel::panel::ease_out;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::menu::{MenuPopup, MenuSeparator};
use crate::ui::popover::Align;
use crate::ui::theme;

const GROUP_GAP: f32 = 12.;
const COMPACT_GROUP_GAP: f32 = 8.;
const CONTROLS_RESERVE: f32 = 65.;
const COMPACT_CONTROLS_RESERVE: f32 = 61.;
const OVERFLOW_ICON: f32 = 16.;
const TOGGLE_GAP: f32 = 4.;
const TOGGLE_RIGHT: f32 = 13.;
const TOGGLE_TOP: f32 = 12.;
const TOGGLE_RADIUS: f32 = 10.;
const TOGGLE_ICON: f32 = 16.;
const BADGE_OFFSET: f32 = -4.;
const BADGE_SIZE: f32 = 14.;
const BADGE_PADDING_X: f32 = 4.;
const BADGE_TEXT: f32 = 10.;
const BADGE_LINE: f32 = 14.;

pub(crate) fn toggle(
    id: &'static str,
    view: &PanelToggleView,
    badge_bg: Rgba,
    on_click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> Option<AnyElement> {
    view.visible.then(|| {
        div()
            .relative()
            .flex()
            .flex_none()
            .child(
                Button::new(id)
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::IconSm)
                    .icon(view.icon.clone())
                    .icon_size(TOGGLE_ICON)
                    .rounded(px(TOGGLE_RADIUS))
                    .pressed(view.pressed)
                    .disabled(view.disabled)
                    .on_click(on_click),
            )
            .when_some(view.badge_count, |this, count| {
                this.child(
                    div()
                        .absolute()
                        .top(px(BADGE_OFFSET))
                        .right(px(BADGE_OFFSET))
                        .flex()
                        .items_center()
                        .justify_center()
                        .h(px(BADGE_SIZE))
                        .min_w(px(BADGE_SIZE))
                        .px(px(BADGE_PADDING_X))
                        .rounded_full()
                        .bg(badge_bg)
                        .text_size(px(BADGE_TEXT))
                        .line_height(px(BADGE_LINE))
                        .font_weight(FontWeight::SEMIBOLD)
                        .font_features(theme::tabular())
                        .text_color(gpui::white())
                        .child(SharedString::from(count.to_string())),
                )
            })
            .into_any_element()
    })
}

#[derive(IntoElement)]
pub struct HeaderToolbar {
    view: HeaderToolbarView,
    client: Entity<CoreClient>,
    open_in: Option<OpenInPickerModel>,
}

impl HeaderToolbar {
    pub fn new(view: &HeaderToolbarView, client: Entity<CoreClient>) -> Self {
        Self {
            view: view.clone(),
            client,
            open_in: None,
        }
    }

    pub fn open_in(mut self, open_in: Option<&OpenInPickerModel>) -> Self {
        self.open_in = open_in.cloned();
        self
    }
}

pub fn actions_width_probe(
    client: Entity<CoreClient>,
    inset_left: Option<f32>,
    window: &mut Window,
    cx: &mut App,
) -> impl IntoElement {
    let last = window.use_keyed_state("header-actions-width", cx, |_, _| None::<f32>);
    let horizontal = inset_left.unwrap_or(GUTTER) + GUTTER;
    canvas(
        move |bounds, _, cx| {
            let width = (f32::from(bounds.size.width) - horizontal).max(0.).floor();
            if *last.read(cx) == Some(width) {
                return;
            }
            last.update(cx, |value, _| *value = Some(width));
            act(
                &client,
                cx,
                "headerSetActionsWidth",
                json!({ "width": width }),
            );
        },
        |_, _, _, _| {},
    )
    .absolute()
    .size_full()
}

impl RenderOnce for HeaderToolbar {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let actions = &self.view.actions;
        let layout = self.view.layout;
        let scripts = ProjectScriptsHost::global(cx)
            .and_then(|host| host.read(cx).toolbar(cx))
            .filter(|_| actions.show_project_scripts);
        let open_in = self
            .open_in
            .as_ref()
            .filter(|_| actions.show_open_in_picker);
        let show_git = actions.show_git_actions && self.view.git != GitToolbarView::Hidden;
        let mut groups: Vec<AnyElement> = Vec::new();
        if layout.collapsed {
            let menu = overflow_menu(window, cx);
            let (open, bounds, focus) = {
                let state = menu.read(cx);
                (state.open, state.bounds, state.focus.clone())
            };
            let popup = open.then(|| {
                let mut entries: Vec<AnyElement> = Vec::new();
                if let Some(scripts) = scripts.as_ref() {
                    entries.extend(scripts_overflow(scripts, &self.client, &menu, cx));
                }
                if let Some(open_in) = open_in {
                    if actions.separator_before_open_in {
                        entries.push(MenuSeparator::new().into_any_element());
                    }
                    entries.extend(open_in_overflow(open_in, &self.client, &menu, cx));
                }
                if show_git {
                    if actions.separator_before_git {
                        entries.push(MenuSeparator::new().into_any_element());
                    }
                    entries.extend(git_overflow(&self.view.git, &self.client, &menu, cx));
                }
                let dismiss = menu.clone();
                let escape = menu.clone();
                MenuPopup::new("header-actions-overflow-popup", bounds)
                    .align(Align::End)
                    .on_dismiss(move |window, cx| {
                        if !owns_pointer(&dismiss, window.mouse_position(), cx) {
                            set_overflow_open(&dismiss, false, cx);
                        }
                    })
                    .child(
                        div()
                            .track_focus(&focus)
                            .on_key_down(move |event: &KeyDownEvent, _, cx| {
                                if event.keystroke.key == "escape" {
                                    set_overflow_open(&escape, false, cx);
                                    cx.stop_propagation();
                                }
                            })
                            .flex()
                            .flex_col()
                            .children(entries),
                    )
            });
            if actions.overflow_trigger_visible {
                let toggle = menu.clone();
                let toggle_focus = focus.clone();
                groups.push(
                    measured_trigger(
                        &menu,
                        Button::new("header-actions-overflow")
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::IconSm)
                            .icon("ellipsis")
                            .icon_size(OVERFLOW_ICON)
                            .accessibility_label(actions.overflow_trigger_aria_label.clone())
                            .pressed(open)
                            .on_click(move |_, window, cx| {
                                set_overflow_open(&toggle, !open, cx);
                                if !open {
                                    toggle_focus.focus(window, cx);
                                }
                            }),
                    )
                    .into_any_element(),
                );
            }
            groups.extend(popup.map(IntoElement::into_any_element));
        } else {
            overflow_menu(window, cx).update(cx, |state, _| {
                state.open = false;
                state.sub = None;
            });
            let compact = !layout.expanded;
            if let Some(scripts) = scripts {
                groups.push(
                    ProjectScriptsControl::new(scripts, self.client.clone())
                        .compact(compact)
                        .into_any_element(),
                );
            }
            if let Some(open_in) = open_in {
                groups.push(
                    OpenInPicker::new(open_in, self.client.clone())
                        .icon_only(compact)
                        .into_any_element(),
                );
            }
            if show_git {
                groups.push(
                    GitActionsControl::new(&self.view.git, self.client.clone())
                        .compact(compact)
                        .into_any_element(),
                );
            }
        }
        let target_pr = if self.view.panels.right_panel.pressed {
            0.
        } else if layout.expanded {
            CONTROLS_RESERVE
        } else {
            COMPACT_CONTROLS_RESERVE
        };
        let (opacity, pr) = header_motion(layout, target_pr, window, cx);
        div()
            .flex()
            .flex_none()
            .items_center()
            .justify_end()
            .gap(px(if layout.expanded {
                GROUP_GAP
            } else {
                COMPACT_GROUP_GAP
            }))
            .pr(px(pr))
            .opacity(opacity)
            .children(groups)
    }
}

struct HeaderMotion {
    expanded: Option<bool>,
    fade_start: Option<Instant>,
    pr: Option<f32>,
    pr_from: f32,
    pr_start: Option<Instant>,
}

fn progress(start: Instant, now: Instant, duration_ms: f32) -> Option<f32> {
    let elapsed = now.duration_since(start).as_secs_f32() * 1000.;
    (duration_ms > 0. && elapsed < duration_ms).then(|| ease_out(elapsed / duration_ms))
}

fn header_motion(
    layout: HeaderActionsLayoutView,
    target_pr: f32,
    window: &mut Window,
    cx: &mut App,
) -> (f32, f32) {
    let motion = window.use_keyed_state("header-actions-motion", cx, |_, _| HeaderMotion {
        expanded: None,
        fade_start: None,
        pr: None,
        pr_from: target_pr,
        pr_start: None,
    });
    let now = Instant::now();
    let (opacity, pr, animating) = motion.update(cx, |state, _| {
        if state
            .expanded
            .is_some_and(|expanded| expanded != layout.expanded)
            && layout.fade_ms > 0.
        {
            state.fade_start = Some(now);
        }
        state.expanded = Some(layout.expanded);
        let opacity = state
            .fade_start
            .and_then(|start| progress(start, now, layout.fade_ms));
        if opacity.is_none() {
            state.fade_start = None;
        }
        let current_pr = state
            .pr_start
            .and_then(|start| progress(start, now, layout.transition_ms))
            .zip(state.pr)
            .map(|(t, to)| state.pr_from + (to - state.pr_from) * t);
        if state.pr.is_some_and(|pr| pr != target_pr) && layout.transition_ms > 0. {
            state.pr_from = current_pr.or(state.pr).unwrap_or(target_pr);
            state.pr_start = Some(now);
        }
        state.pr = Some(target_pr);
        let pr = state
            .pr_start
            .and_then(|start| progress(start, now, layout.transition_ms))
            .map(|t| state.pr_from + (target_pr - state.pr_from) * t);
        if pr.is_none() {
            state.pr_start = None;
        }
        (
            opacity.unwrap_or(1.),
            pr.unwrap_or(target_pr),
            opacity.is_some() || pr.is_some(),
        )
    });
    if animating {
        window.request_animation_frame();
    }
    (opacity, pr)
}

#[derive(IntoElement)]
pub struct PanelToggles {
    view: HeaderToolbarView,
    client: Entity<CoreClient>,
    leading: Option<AnyElement>,
}

impl PanelToggles {
    pub fn new(view: &HeaderToolbarView, client: Entity<CoreClient>) -> Self {
        Self {
            view: view.clone(),
            client,
            leading: None,
        }
    }

    pub fn leading(mut self, element: Option<impl IntoElement>) -> Self {
        self.leading = element.map(IntoElement::into_any_element);
        self
    }
}

impl RenderOnce for PanelToggles {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let panels = &self.view.panels;
        let client = self.client.clone();
        let terminal_client = self.client.clone();
        div()
            .absolute()
            .top(px(TOGGLE_TOP))
            .right(px(TOGGLE_RIGHT))
            .flex()
            .items_center()
            .gap(px(TOGGLE_GAP))
            .children(self.leading)
            .children(toggle(
                "header-toggle-terminal",
                &panels.terminal,
                t.info,
                move |_, _, cx| act(&terminal_client, cx, "terminalToggleDrawer", json!({})),
            ))
            .children(toggle(
                "header-toggle-right-panel",
                &panels.right_panel,
                t.info,
                move |_, _, cx| act(&client, cx, "rightPanelToggle", json!({})),
            ))
    }
}
