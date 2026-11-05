use std::collections::HashMap;
use std::time::{Duration, Instant};

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, AnyView, App, AppContext, Bounds, ClickEvent, Context, CursorStyle, DragMoveEvent,
    Entity, FocusHandle, FontWeight, InteractiveElement, IntoElement, KeyDownEvent, MouseButton,
    MouseDownEvent, ParentElement, Pixels, Render, ScrollHandle, SharedString,
    StatefulInteractiveElement, Styled, Window, canvas, div, point, px, svg,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::right_panel::{
    ActionRef, ActiveSurface, LauncherView, MaximizeView, RightPanelTab, RightPanelView,
    SurfaceAction, SurfaceIcon, SurfaceKind,
};
use crate::features::right_panel::agents::AgentsSurface;
use crate::features::right_panel::diff::DiffSurface;
use crate::features::right_panel::files::FilesSurface;
use crate::features::terminal::TerminalSurface;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::kbd::Kbd;
use crate::ui::menu::{MenuItem, MenuPopup};
use crate::ui::pierre_icon::pierre_icon;
use crate::ui::popover::{Align, Side};
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text, workspace};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const TABBAR_PADDING_LEFT: f32 = 8.;
const TABBAR_PADDING_RIGHT: f32 = 112.;
const TABBAR_GAP: f32 = 4.;
const TAB_HEIGHT: f32 = 24.;
const TAB_MAX_WIDTH: f32 = 144.;
const TAB_PADDING_LEFT: f32 = 6.;
const TAB_PADDING_RIGHT: f32 = 8.;
const TAB_GAP: f32 = 2.;
const TAB_CLOSE_SIZE: f32 = 16.;
const TAB_ICON: f32 = 12.;
const ADD_ICON: f32 = 14.;
const HOVER_ACCENT: f32 = 0.6;
const SCROLL_ICON: f32 = 16.;
const SCROLL_GROUP_GAP: f32 = 2.;
const SCROLL_STEP_MIN: f32 = 120.;
const SCROLL_STEP_FRACTION: f32 = 0.75;
const SCROLL_EDGE_TOLERANCE: f32 = 1.;
const MENU_SIDE_OFFSET: f32 = 6.;
const RESIZE_HIT_WIDTH: f32 = 8.;
const RESIZE_LINE_ACTIVE: f32 = 0.6;
const LAUNCHER_PADDING_X: f32 = 24.;
const LAUNCHER_MAX_WIDTH: f32 = 320.;
const LAUNCHER_PADDING_Y: f32 = 24.;
const LAUNCHER_TITLE_GAP: f32 = 12.;
const LAUNCHER_ROW_GAP: f32 = 2.;
const LAUNCHER_ROW_HEIGHT: f32 = 32.;
const LAUNCHER_ROW_PADDING_X: f32 = 10.;
const LAUNCHER_ROW_GAP_INNER: f32 = 10.;
const LAUNCHER_ICON: f32 = 16.;
const LAUNCHER_UNAVAILABLE_OPACITY: f32 = 0.5;
const BADGE_HEIGHT: f32 = 14.;
const BADGE_TOP: f32 = -6.;
const BADGE_RIGHT: f32 = -8.;
const BADGE_PADDING_X: f32 = 4.;
const BADGE_TEXT: f32 = 10.;
const BADGE_LINE: f32 = 14.;

#[derive(Clone, Copy)]
struct ResizeDrag;

struct ResizeDragView;

impl Render for ResizeDragView {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
    }
}

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
enum SurfaceSlot {
    Diff,
    Files,
    Agents,
    PullRequest,
    PullRequests,
    Browser,
    Device,
}

pub struct RightPanel {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<RightPanelView>>>,
    add_menu_open: bool,
    add_menu_bounds: Bounds<Pixels>,
    drag_width: Option<f32>,
    panel_bounds: Bounds<Pixels>,
    reported_layout: Option<(i32, i32)>,
    collapsed_sidebar_inset: Option<f32>,
    launcher_focus: FocusHandle,
    launcher_shown: bool,
    tab_scroll: ScrollHandle,
    surfaces: HashMap<SurfaceSlot, AnyView>,
    terminals: HashMap<String, Entity<TerminalSurface>>,
    shown: Option<(String, bool)>,
    transition: Option<Transition>,
}

pub struct RightPanelLayout {
    pub open: bool,
    pub present: bool,
    pub open_fraction: f32,
    pub maximized: bool,
    pub maximize: MaximizeView,
}

struct Transition {
    start: Instant,
    opening: bool,
    duration: Duration,
}

pub fn ease_out(progress: f32) -> f32 {
    let (x1, y1, x2, y2) = (0., 0., 0.58_f32, 1.);
    let curve = |t: f32, a: f32, b: f32| {
        3. * (1. - t) * (1. - t) * t * a + 3. * (1. - t) * t * t * b + t * t * t
    };
    let mut t = progress;
    for _ in 0..8 {
        let x = curve(t, x1, x2) - progress;
        let derivative =
            3. * (1. - t) * (1. - t) * x1 + 6. * (1. - t) * t * (x2 - x1) + 3. * t * t * (1. - x2);
        if derivative.abs() < 1e-6 {
            break;
        }
        t = (t - x / derivative).clamp(0., 1.);
    }
    curve(t, y1, y2)
}

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &ActionRef) {
    let name = action.action.clone();
    let params = Value::Object(action.params.clone());
    client.update(cx, |client, _| client.act(&name, params));
}

fn launcher_key(key: &str) -> Option<&str> {
    match key {
        "down" => Some("ArrowDown"),
        "up" => Some("ArrowUp"),
        "left" => Some("ArrowLeft"),
        "right" => Some("ArrowRight"),
        "enter" => Some("Enter"),
        other if other.chars().count() == 1 => Some(other),
        _ => None,
    }
}

pub fn surface_action_icon(key: &str) -> &'static str {
    match key {
        "browser" => "icons/earth.svg",
        "terminal" => "icons/square-terminal.svg",
        "files" => "icons/files.svg",
        "diff" => "icons/file-diff.svg",
        "pullRequest" => "icons/git-pull-request-arrow.svg",
        "pullRequests" => "icons/link-2.svg",
        "agents" => "icons/bot.svg",
        _ => "icons/smartphone.svg",
    }
}

fn pull_request_icon(state: &str, is_draft: bool) -> &'static str {
    match (state, is_draft) {
        ("open", true) => "icons/git-pull-request-draft.svg",
        ("merged", _) => "icons/git-merge.svg",
        ("closed", _) => "icons/git-pull-request-closed.svg",
        _ => "icons/git-pull-request-arrow.svg",
    }
}

fn tab_icon(icon: &SurfaceIcon) -> SharedString {
    let path = match icon {
        SurfaceIcon::Preview { .. } => "icons/earth.svg",
        SurfaceIcon::Diff => "icons/file-diff.svg",
        SurfaceIcon::Files => "icons/files.svg",
        SurfaceIcon::File { .. } => "icons/file.svg",
        SurfaceIcon::Terminal => "icons/square-terminal.svg",
        SurfaceIcon::PullRequest { status } => match status {
            Some(status) => pull_request_icon(&status.state, status.is_draft),
            None => "icons/git-pull-request-arrow.svg",
        },
        SurfaceIcon::PullRequests => "icons/link-2.svg",
        SurfaceIcon::Agents => "icons/bot.svg",
        SurfaceIcon::Device { platform } => match platform.as_deref() {
            Some("ios") => "icons/apple.svg",
            _ => "icons/smartphone.svg",
        },
    };
    SharedString::from(path)
}

impl RightPanel {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view =
            CoreClient::subscribe::<Option<RightPanelView>>(&client, "rightPanel", json!({}), cx);
        cx.observe(&view, |panel, view, cx| {
            panel.drag_width = None;
            if let Some(view) = view.read(cx).data.as_ref().and_then(Option::as_ref) {
                let previous = panel.shown.replace((view.thread_key.clone(), view.open));
                match previous {
                    Some((key, was_open))
                        if key == view.thread_key
                            && was_open != view.open
                            && view.animation_duration_ms > 0 =>
                    {
                        panel.transition = Some(Transition {
                            start: Instant::now(),
                            opening: view.open,
                            duration: Duration::from_millis(view.animation_duration_ms),
                        });
                    }
                    Some((key, _)) if key != view.thread_key => panel.transition = None,
                    _ => {}
                }
            }
            cx.notify();
        })
        .detach();
        Self {
            client,
            view,
            add_menu_open: false,
            add_menu_bounds: Bounds::default(),
            drag_width: None,
            panel_bounds: Bounds::default(),
            reported_layout: None,
            collapsed_sidebar_inset: None,
            launcher_focus: cx.focus_handle(),
            launcher_shown: false,
            tab_scroll: ScrollHandle::new(),
            surfaces: HashMap::new(),
            terminals: HashMap::new(),
            shown: None,
            transition: None,
        }
    }

    fn data<'a>(&self, cx: &'a App) -> Option<&'a RightPanelView> {
        self.view.read(cx).data.as_ref().and_then(Option::as_ref)
    }

    fn transition_progress(&self) -> Option<f32> {
        let transition = self.transition.as_ref()?;
        let elapsed = transition.start.elapsed().as_secs_f32();
        let total = transition.duration.as_secs_f32();
        (elapsed < total).then(|| ease_out(elapsed / total))
    }

    fn open_fraction(&self, open: bool) -> f32 {
        match (self.transition_progress(), self.transition.as_ref()) {
            (Some(progress), Some(transition)) if transition.opening => progress,
            (Some(progress), Some(_)) => 1. - progress,
            _ if open => 1.,
            _ => 0.,
        }
    }

    pub fn layout(&self, cx: &App) -> Option<RightPanelLayout> {
        self.data(cx).map(|view| {
            let fraction = self.open_fraction(view.open);
            RightPanelLayout {
                open: view.open,
                present: view.open || fraction > 0.,
                open_fraction: fraction,
                maximized: view.maximized,
                maximize: view.maximize.clone(),
            }
        })
    }

    pub fn set_collapsed_sidebar_inset(&mut self, inset: Option<f32>) {
        self.collapsed_sidebar_inset = inset;
    }

    pub fn report_layout(&mut self, viewport_width: f32, container_width: f32, cx: &mut App) {
        let next = (
            viewport_width.floor() as i32,
            container_width.floor() as i32,
        );
        if self.reported_layout == Some(next) {
            return;
        }
        self.reported_layout = Some(next);
        self.client.update(cx, |client, _| {
            client.act(
                "rightPanelSetLayoutBounds",
                json!({ "viewportWidth": next.0, "containerWidth": next.1 }),
            )
        });
    }

    fn surface_view(&mut self, active: &ActiveSurface, cx: &mut Context<Self>) -> Option<AnyView> {
        let slot = match active.kind {
            SurfaceKind::Diff => SurfaceSlot::Diff,
            SurfaceKind::Files | SurfaceKind::File => SurfaceSlot::Files,
            SurfaceKind::Agents => SurfaceSlot::Agents,
            SurfaceKind::PullRequest => SurfaceSlot::PullRequest,
            SurfaceKind::PullRequests => SurfaceSlot::PullRequests,
            SurfaceKind::Preview => SurfaceSlot::Browser,
            SurfaceKind::Device => SurfaceSlot::Device,
            SurfaceKind::Terminal => {
                let client = self.client.clone();
                let terminal = self
                    .terminals
                    .entry(active.id.clone())
                    .or_insert_with(|| TerminalSurface::panel(client, active.id.clone(), cx));
                return Some(terminal.clone().into());
            }
        };
        if let Some(view) = self.surfaces.get(&slot) {
            return Some(view.clone());
        }
        let client = self.client.clone();
        let view: AnyView = match slot {
            SurfaceSlot::Agents => cx.new(|cx| AgentsSurface::new(client, cx)).into(),
            SurfaceSlot::Diff => cx.new(|cx| DiffSurface::new(client, cx)).into(),
            SurfaceSlot::Files => cx.new(|cx| FilesSurface::new(client, cx)).into(),
            SurfaceSlot::PullRequest => cx
                .new(|cx| {
                    crate::features::pull_requests::detail::PullRequestDetailSurface::new(
                        client, cx,
                    )
                })
                .into(),
            SurfaceSlot::PullRequests => cx
                .new(|cx| {
                    crate::features::pull_requests::thread_panel::ThreadPullRequestsSurface::new(
                        client, cx,
                    )
                })
                .into(),
            SurfaceSlot::Browser => cx
                .new(|cx| crate::features::browser::surface::BrowserSurface::new(client, cx))
                .into(),
            SurfaceSlot::Device => cx
                .new(|cx| crate::features::device::panel::DevicePanelSurface::new(client, cx))
                .into(),
        };
        self.surfaces.insert(slot, view.clone());
        Some(view)
    }

    fn tab(&self, tab: &RightPanelTab, t: &Tokens, cx: &mut Context<Self>) -> AnyElement {
        let group = SharedString::from(format!("right-panel-tab-{}", tab.id));
        let fg = t.foreground;
        let (bg, color) = if tab.active {
            (Some(t.accent), t.foreground)
        } else {
            (None, t.muted_foreground)
        };
        let hover_bg = fade(t.accent, HOVER_ACCENT);
        let close_hover = t.muted;
        let select = tab.select.clone();
        let close = tab.close.clone();
        let middle_close = tab.close.clone();
        let tab_id = tab.id.clone();
        let client = self.client.clone();
        let close_client = self.client.clone();
        let middle_client = self.client.clone();
        let menu_client = self.client.clone();
        let tooltip = tab.tooltip.clone();
        div()
            .id(SharedString::from(format!("right-panel-tab-{}", tab.id)))
            .group(group.clone())
            .flex()
            .flex_none()
            .items_center()
            .gap(px(TAB_GAP))
            .h(px(TAB_HEIGHT))
            .max_w(px(TAB_MAX_WIDTH))
            .pl(px(TAB_PADDING_LEFT))
            .pr(px(TAB_PADDING_RIGHT))
            .rounded(px(radius::MD))
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .text_color(color)
            .cursor_pointer()
            .when_some(bg, |this, bg| this.bg(bg))
            .when(!tab.active, |this| {
                this.hover(move |s| s.bg(hover_bg).text_color(fg))
            })
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_mouse_down(MouseButton::Middle, |_, _, cx| cx.stop_propagation())
            .on_mouse_up(MouseButton::Middle, move |_, _, cx| {
                cx.stop_propagation();
                act(&middle_client, cx, &middle_close);
            })
            .on_mouse_down(MouseButton::Right, move |event: &MouseDownEvent, _, cx| {
                cx.stop_propagation();
                let surface_id = tab_id.clone();
                let (x, y) = (f32::from(event.position.x), f32::from(event.position.y));
                menu_client.update(cx, |client, _| {
                    client.act(
                        "rightPanelTabContextMenu",
                        json!({ "surfaceId": surface_id, "x": x, "y": y }),
                    )
                });
            })
            .child(
                div()
                    .id(SharedString::from(format!(
                        "right-panel-tab-close-{}",
                        tab.id
                    )))
                    .relative()
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_center()
                    .size(px(TAB_CLOSE_SIZE))
                    .rounded(px(radius::SM))
                    .cursor_pointer()
                    .hover(move |s| s.bg(close_hover))
                    .tooltip(Tooltip::text(tab.close_label.clone()))
                    .on_click(move |_: &ClickEvent, _, cx| {
                        cx.stop_propagation();
                        act(&close_client, cx, &close);
                    })
                    .child(
                        div()
                            .absolute()
                            .flex()
                            .items_center()
                            .justify_center()
                            .size(px(TAB_ICON))
                            .group_hover(group.clone(), |s| s.opacity(0.))
                            .child(match tab.file_icon.as_ref() {
                                Some(icon) => pierre_icon(icon, px(TAB_ICON), cx),
                                None => svg()
                                    .path(tab_icon(&tab.icon))
                                    .size(px(TAB_ICON))
                                    .text_color(color)
                                    .into_any_element(),
                            }),
                    )
                    .child(
                        svg()
                            .absolute()
                            .path("icons/x.svg")
                            .size(px(TAB_ICON))
                            .text_color(fg)
                            .opacity(0.)
                            .group_hover(group.clone(), |s| s.opacity(1.)),
                    )
                    .when(tab.pending, |this| {
                        this.child(
                            div()
                                .absolute()
                                .right(px(1.))
                                .bottom(px(1.))
                                .size(px(6.))
                                .rounded_full()
                                .bg(color)
                                .group_hover(group.clone(), |s| s.opacity(0.)),
                        )
                    }),
            )
            .child(
                div()
                    .id(SharedString::from(format!(
                        "right-panel-tab-title-{}",
                        tab.id
                    )))
                    .flex()
                    .min_w_0()
                    .items_center()
                    .tooltip(Tooltip::text(tooltip))
                    .on_click(move |_: &ClickEvent, _, cx| act(&client, cx, &select))
                    .child(
                        div()
                            .truncate()
                            .child(SharedString::from(tab.title.clone())),
                    ),
            )
            .into_any_element()
    }

    fn add_button(&self, cx: &mut Context<Self>) -> AnyElement {
        div()
            .relative()
            .flex_none()
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .child(
                Button::new("right-panel-add-surface")
                    .variant(ButtonVariant::GhostMuted)
                    .size(ButtonSize::IconXs)
                    .icon("plus")
                    .icon_size(ADD_ICON)
                    .accessibility_label("Add panel surface")
                    .pressed(self.add_menu_open)
                    .on_click(cx.listener(|panel, _: &ClickEvent, _, cx| {
                        panel.add_menu_open = !panel.add_menu_open;
                        cx.notify();
                    })),
            )
            .child(
                canvas(
                    {
                        let entity = cx.entity();
                        move |bounds, _, cx| {
                            entity.update(cx, |panel, _| panel.add_menu_bounds = bounds);
                        }
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            )
            .into_any_element()
    }

    fn add_menu(&self, view: &RightPanelView, cx: &mut Context<Self>) -> AnyElement {
        let items = view.add_surface_actions.iter().map(|action| {
            let client = self.client.clone();
            let target = action.action.clone();
            let entity = cx.entity();
            let item = MenuItem::new(SharedString::from(format!(
                "right-panel-add-{}",
                action.key
            )))
            .icon(surface_action_icon(&action.key))
            .label(action.label.clone())
            .shortcut(action.shortcut.clone())
            .disabled(!action.available)
            .on_click(move |_, _, cx| {
                entity.update(cx, |panel, cx| {
                    panel.add_menu_open = false;
                    cx.notify();
                });
                act(&client, cx, &target);
            });
            if action.available {
                item.into_any_element()
            } else {
                div()
                    .id(SharedString::from(format!(
                        "right-panel-add-reason-{}",
                        action.key
                    )))
                    .tooltip(Tooltip::text(action.disabled_reason.clone()))
                    .child(item)
                    .into_any_element()
            }
        });
        let entity = cx.entity();
        MenuPopup::new("right-panel-add-menu", self.add_menu_bounds)
            .side(Side::Bottom)
            .align(Align::Start)
            .side_offset(MENU_SIDE_OFFSET)
            .on_dismiss(move |_, cx| {
                entity.update(cx, |panel, cx| {
                    panel.add_menu_open = false;
                    cx.notify();
                })
            })
            .children(items)
            .into_any_element()
    }

    fn scroll_tabs(&self, direction: f32) {
        let bounds = self.tab_scroll.bounds();
        let step = (f32::from(bounds.size.width) * SCROLL_STEP_FRACTION).max(SCROLL_STEP_MIN);
        let offset = self.tab_scroll.offset();
        let max = f32::from(self.tab_scroll.max_offset().x);
        let next = (f32::from(offset.x) - direction * step).clamp(-max, 0.);
        self.tab_scroll.set_offset(point(px(next), offset.y));
    }

    fn scroll_controls(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let max = f32::from(self.tab_scroll.max_offset().x);
        if max <= SCROLL_EDGE_TOLERANCE {
            return None;
        }
        let offset = -f32::from(self.tab_scroll.offset().x);
        let can_left = offset > SCROLL_EDGE_TOLERANCE;
        let can_right = offset < max - SCROLL_EDGE_TOLERANCE;
        let button =
            |id: &'static str, icon: &'static str, label: &'static str, enabled: bool, dir: f32| {
                div()
                    .id(id)
                    .flex_none()
                    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .tooltip(Tooltip::text(label))
                    .child(
                        Button::new(SharedString::from(format!("{id}-button")))
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::IconXs)
                            .icon(icon)
                            .icon_size(SCROLL_ICON)
                            .accessibility_label(label)
                            .disabled(!enabled)
                            .on_click(cx.listener(move |panel, _: &ClickEvent, _, cx| {
                                panel.scroll_tabs(dir);
                                cx.notify();
                            })),
                    )
            };
        Some(
            div()
                .flex()
                .flex_none()
                .items_center()
                .gap(px(SCROLL_GROUP_GAP))
                .child(button(
                    "right-panel-scroll-left",
                    "chevron-left",
                    "Scroll tabs left",
                    can_left,
                    -1.,
                ))
                .child(button(
                    "right-panel-scroll-right",
                    "chevron-right",
                    "Scroll tabs right",
                    can_right,
                    1.,
                ))
                .into_any_element(),
        )
    }

    fn tab_bar(&self, view: &RightPanelView, t: &Tokens, cx: &mut Context<Self>) -> AnyElement {
        let mut strip: Vec<AnyElement> = view.tabs.iter().map(|tab| self.tab(tab, t, cx)).collect();
        if view.show_add_surface_menu {
            strip.push(self.add_button(cx));
        }
        let inset = if view.maximized {
            self.collapsed_sidebar_inset
        } else {
            None
        };
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(TABBAR_GAP))
            .h(px(workspace::TOPBAR_HEIGHT))
            .min_h(px(workspace::TOPBAR_HEIGHT))
            .pl(px(inset.unwrap_or(TABBAR_PADDING_LEFT)))
            .pr(px(TABBAR_PADDING_RIGHT))
            .on_mouse_down(MouseButton::Left, |_, window, _| window.start_window_move())
            .child(
                div()
                    .id("right-panel-tab-list")
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .overflow_x_scroll()
                    .track_scroll(&self.tab_scroll)
                    .child(
                        div()
                            .flex()
                            .h_full()
                            .items_center()
                            .gap(px(TABBAR_GAP))
                            .children(strip),
                    ),
            )
            .children(self.scroll_controls(cx))
            .into_any_element()
    }

    fn launcher_row(
        &self,
        action: &SurfaceAction,
        available_index: Option<usize>,
        highlighted: bool,
        t: &Tokens,
    ) -> AnyElement {
        let hover_bg = fade(t.accent, HOVER_ACCENT);
        let icon = div()
            .relative()
            .flex()
            .flex_none()
            .child(
                svg()
                    .path(surface_action_icon(&action.key))
                    .size(px(LAUNCHER_ICON))
                    .text_color(t.foreground),
            )
            .when(action.badge_count > 0, |this| {
                this.child(
                    div()
                        .absolute()
                        .top(px(BADGE_TOP))
                        .right(px(BADGE_RIGHT))
                        .flex()
                        .items_center()
                        .justify_center()
                        .h(px(BADGE_HEIGHT))
                        .min_w(px(BADGE_HEIGHT))
                        .px(px(BADGE_PADDING_X))
                        .rounded_full()
                        .bg(t.info)
                        .text_size(px(BADGE_TEXT))
                        .line_height(px(BADGE_LINE))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(gpui::white())
                        .font_features(theme::tabular())
                        .child(SharedString::from(action.badge_count.to_string())),
                )
            });
        let row = div()
            .id(SharedString::from(format!(
                "right-panel-launcher-{}",
                action.key
            )))
            .flex()
            .items_center()
            .gap(px(LAUNCHER_ROW_GAP_INNER))
            .h(px(LAUNCHER_ROW_HEIGHT))
            .w_full()
            .px(px(LAUNCHER_ROW_PADDING_X))
            .rounded(px(radius::CONTROL))
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .text_color(t.foreground)
            .child(icon)
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .child(SharedString::from(action.label.clone())),
            )
            .child(Kbd::new(action.shortcut.clone()));
        match available_index {
            Some(index) => {
                let client = self.client.clone();
                let hover_client = self.client.clone();
                let target = action.action.clone();
                row.cursor_pointer()
                    .when(highlighted, |this| this.bg(hover_bg))
                    .hover(move |s| s.bg(hover_bg))
                    .on_hover(move |hovered: &bool, _, cx| {
                        let index = if *hovered { index as i64 } else { -1 };
                        hover_client.update(cx, |client, _| {
                            client.act("rightPanelLauncherHighlight", json!({ "index": index }))
                        });
                    })
                    .on_click(move |_: &ClickEvent, _, cx| act(&client, cx, &target))
                    .into_any_element()
            }
            None => row
                .opacity(LAUNCHER_UNAVAILABLE_OPACITY)
                .tooltip(Tooltip::text(action.disabled_reason.clone()))
                .into_any_element(),
        }
    }

    fn launcher(&self, launcher: &LauncherView, t: &Tokens) -> AnyElement {
        let mut available_index = 0;
        let rows: Vec<AnyElement> = launcher
            .actions
            .iter()
            .map(|action| {
                let index = action.available.then(|| {
                    let index = available_index;
                    available_index += 1;
                    index
                });
                let highlighted = launcher.highlighted_key.as_deref() == Some(action.key.as_str());
                self.launcher_row(action, index, highlighted, t)
            })
            .collect();
        let client = self.client.clone();
        div()
            .id("right-panel-launcher")
            .track_focus(&self.launcher_focus)
            .flex()
            .flex_1()
            .min_h_0()
            .items_center()
            .justify_center()
            .overflow_y_scroll()
            .px(px(LAUNCHER_PADDING_X))
            .pb(px(workspace::TOPBAR_HEIGHT))
            .on_key_down(move |event: &KeyDownEvent, _, cx| {
                let modifiers = event.keystroke.modifiers;
                if modifiers.platform || modifiers.control || modifiers.alt {
                    return;
                }
                let Some(key) = launcher_key(&event.keystroke.key) else {
                    return;
                };
                cx.stop_propagation();
                let key = key.to_string();
                client.update(cx, |client, _| {
                    client.act("rightPanelLauncherKey", json!({ "key": key }))
                });
            })
            .child(
                div()
                    .w_full()
                    .max_w(px(LAUNCHER_MAX_WIDTH))
                    .py(px(LAUNCHER_PADDING_Y))
                    .child(
                        div()
                            .mb(px(LAUNCHER_TITLE_GAP))
                            .text_center()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.foreground)
                            .text_size(px(text::SM))
                            .line_height(px(text::SM_LINE))
                            .child(SharedString::from(launcher.title.clone())),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(LAUNCHER_ROW_GAP))
                            .children(rows),
                    ),
            )
            .into_any_element()
    }

    fn resize_handle(
        &self,
        view: &RightPanelView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let dragging = self.drag_width.is_some();
        let line = t.border;
        let active = fade(t.primary, RESIZE_LINE_ACTIVE);
        let (min, max) = (view.width.min_width, view.width.max_width);
        let client = self.client.clone();
        let finish = cx.listener(move |panel, _, _, cx| {
            if let Some(width) = panel.drag_width {
                client.update(cx, |client, _| {
                    client.act("rightPanelSetWidth", json!({ "width": width.round() }))
                });
            }
        });
        let finish_out = cx.listener(move |panel, _, _, cx| {
            if let Some(width) = panel.drag_width {
                panel.client.update(cx, |client, _| {
                    client.act("rightPanelSetWidth", json!({ "width": width.round() }))
                });
            }
        });
        div()
            .id("right-panel-resize")
            .group("right-panel-resize")
            .absolute()
            .top_0()
            .bottom_0()
            .left(px(-RESIZE_HIT_WIDTH / 2.))
            .w(px(RESIZE_HIT_WIDTH))
            .cursor(CursorStyle::ResizeLeftRight)
            .child(
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .left(px(RESIZE_HIT_WIDTH / 2. - 0.5))
                    .w(px(1.))
                    .when(dragging, |this| this.bg(active))
                    .when(!dragging, |this| {
                        this.group_hover("right-panel-resize", move |s| s.bg(line))
                    }),
            )
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_drag(ResizeDrag, |_, _, _, cx| cx.new(|_| ResizeDragView))
            .on_drag_move(
                cx.listener(move |panel, event: &DragMoveEvent<ResizeDrag>, _, cx| {
                    let right = f32::from(panel.panel_bounds.right());
                    let wanted = right - f32::from(event.event.position.x);
                    panel.drag_width = Some(wanted.clamp(min, max.max(min)));
                    cx.notify();
                }),
            )
            .on_mouse_up(MouseButton::Left, finish)
            .on_mouse_up_out(MouseButton::Left, finish_out)
            .into_any_element()
    }
}

impl Render for RightPanel {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = theme::active(cx);
        let Some(view) = self.data(cx).cloned() else {
            return div().into_any_element();
        };
        let fraction = self.open_fraction(view.open);
        if fraction <= 0. {
            self.transition = None;
            self.launcher_shown = false;
            return div().into_any_element();
        }
        if self.transition_progress().is_some() {
            let entity = cx.entity();
            window.on_next_frame(move |_, cx| entity.update(cx, |_, cx| cx.notify()));
        } else {
            self.transition = None;
        }
        let launcher_visible = view.open && view.launcher.is_some();
        if launcher_visible && !self.launcher_shown {
            window.focus(&self.launcher_focus, cx);
        }
        self.launcher_shown = launcher_visible;
        self.terminals
            .retain(|id, _| view.tabs.iter().any(|tab| &tab.id == id));
        let body = match (&view.launcher, &view.active_surface) {
            (Some(launcher), _) => Some(self.launcher(launcher, &t)),
            (None, Some(active)) => self
                .surface_view(active, cx)
                .map(IntoElement::into_any_element),
            (None, None) => None,
        };
        let width = self.drag_width.unwrap_or(view.width.width);
        let entity = cx.entity();
        div()
            .relative()
            .flex()
            .h_full()
            .min_h_0()
            .min_w_0()
            .bg(t.background)
            .border_l_1()
            .border_color(t.border)
            .map(|this| {
                if view.maximized {
                    this.flex_1()
                } else {
                    this.flex_none().w(px(width * fraction))
                }
            })
            .child(
                canvas(
                    move |bounds, _, cx| {
                        entity.update(cx, |panel, _| panel.panel_bounds = bounds);
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            )
            .child(
                div()
                    .h_full()
                    .min_h_0()
                    .overflow_hidden()
                    .map(|this| {
                        if view.maximized {
                            this.w_full()
                        } else {
                            this.w(px((width * fraction - 1.).max(0.)))
                        }
                    })
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .h_full()
                            .min_h_0()
                            .min_w_0()
                            .map(|this| {
                                if view.maximized {
                                    this.w_full()
                                } else {
                                    this.w(px(width - 1.))
                                }
                            })
                            .child(self.tab_bar(&view, &t, cx))
                            .child(div().flex().flex_col().flex_1().min_h_0().children(body)),
                    ),
            )
            .when(!view.maximized && view.open, |this| {
                this.child(self.resize_handle(&view, &t, cx))
            })
            .when(
                view.open && self.add_menu_open && view.show_add_surface_menu,
                |this| this.child(self.add_menu(&view, cx)),
            )
            .into_any_element()
    }
}
