use std::collections::HashMap;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, ClickEvent, Context, CursorStyle, Entity, Focusable,
    InteractiveElement, IntoElement, MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent,
    ParentElement, Render, SharedString, StatefulInteractiveElement, Styled, Window, canvas, div,
    px, svg,
};
use serde_json::{Value, json};

use super::session;
use super::viewport::TerminalViewport;
use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::terminal::{
    TerminalActionView, TerminalChromeModel, TerminalChromeView, TerminalGroupView,
    TerminalLinkHoverView, TerminalSplitDirection, TerminalViewportView,
};
use crate::platform::DEFAULT_MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant, shadow_xs};
use crate::ui::theme;
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const RESIZE_HANDLE_HEIGHT: f32 = 6.;
const ACTIONS_INSET: f32 = 8.;
const ACTIONS_RADIUS: f32 = 8.;
const ACTION_PADDING: f32 = 4.;
const ACTION_ICON: f32 = 13.;
const ACTION_SEPARATOR_HEIGHT: f32 = 16.;
const BORDER_ALPHA: f32 = 0.8;
const SOFT_BORDER_ALPHA: f32 = 0.7;
const FOREGROUND_ALPHA: f32 = 0.9;
const DISABLED_OPACITY: f32 = 0.64;
const SIDEBAR_WIDTH: f32 = 144.;
const SIDEBAR_GAP: f32 = 6.;
const SIDEBAR_HEADER_HEIGHT: f32 = 22.;
const SIDEBAR_ACTION_PADDING_X: f32 = 4.;
const SIDEBAR_LIST_PADDING: f32 = 4.;
const SIDEBAR_BG_ALPHA: f32 = 0.1;
const GROUP_PADDING_BOTTOM: f32 = 2.;
const GROUP_HEADER_HEIGHT: f32 = 22.;
const GROUP_HEADER_PADDING_X: f32 = 6.;
const GROUP_HEADER_GAP: f32 = 4.;
const GROUP_HEADER_RADIUS: f32 = 4.;
const GROUP_HEADER_TEXT: f32 = 11.;
const GROUP_HEADER_LINE: f32 = 16.;
const GROUP_COUNT_TEXT: f32 = 10.;
const GROUP_COUNT_LINE: f32 = 14.;
const GROUP_ICON: f32 = 12.;
const TAB_GAP: f32 = 2.;
const TAB_HEIGHT: f32 = 24.;
const TAB_RADIUS: f32 = 8.;
const TAB_PADDING_LEFT: f32 = 6.;
const TAB_PADDING_RIGHT: f32 = 8.;
const TAB_TEXT: f32 = 12.;
const TAB_LINE: f32 = 16.;
const TAB_CLOSE_SIZE: f32 = 16.;
const TAB_CLOSE_RADIUS: f32 = 6.;
const TAB_ICON: f32 = 12.;
const EMPTY_GAP: f32 = 12.;
const EMPTY_PADDING_X: f32 = 16.;
const EMPTY_PADDING_Y: f32 = 24.;
const EMPTY_TEXT: f32 = 14.;
const EMPTY_LINE: f32 = 20.;

#[derive(Clone, PartialEq)]
enum SurfaceKind {
    Drawer,
    Panel(String),
}

struct Drag {
    start_y: f32,
    start_height: f32,
}

pub struct TerminalSurface {
    client: Entity<CoreClient>,
    kind: SurfaceKind,
    drawer: Option<Entity<ViewState<Option<TerminalChromeView>>>>,
    panels: Option<Entity<ViewState<HashMap<String, TerminalChromeView>>>>,
    _link_hover: Entity<ViewState<Option<TerminalLinkHoverView>>>,
    viewports: HashMap<String, Entity<TerminalViewport>>,
    focus_revision: u64,
    was_visible: bool,
    pending_focus: bool,
    drag: Option<Drag>,
    live_height: Option<f32>,
    hovered_tab: Option<String>,
    window_height: f32,
}

fn action_icon(icon: &str) -> &'static str {
    match icon {
        "split-horizontal" => "icons/square-split-horizontal.svg",
        "split-vertical" => "icons/square-split-vertical.svg",
        "plus" => "icons/plus.svg",
        "square" => "icons/square.svg",
        _ => "icons/trash.svg",
    }
}

fn icon(path: &'static str, size: f32, color: gpui::Rgba) -> impl IntoElement {
    svg()
        .path(path)
        .flex_none()
        .size(px(size))
        .text_color(color)
}

impl TerminalSurface {
    pub fn drawer(client: Entity<CoreClient>, cx: &mut App) -> Entity<Self> {
        cx.new(|cx| {
            let view = CoreClient::subscribe::<Option<TerminalChromeView>>(
                &client,
                "terminalDrawer",
                json!({}),
                cx,
            );
            cx.observe(&view, |surface: &mut Self, _, cx| surface.sync(cx))
                .detach();
            let link_hover = Self::subscribe_link_hover(&client, cx);
            Self::new(client, SurfaceKind::Drawer, Some(view), None, link_hover)
        })
    }

    pub fn panel(client: Entity<CoreClient>, surface_id: String, cx: &mut App) -> Entity<Self> {
        cx.new(|cx| {
            let view = CoreClient::subscribe::<HashMap<String, TerminalChromeView>>(
                &client,
                "terminalPanels",
                json!({}),
                cx,
            );
            cx.observe(&view, |surface: &mut Self, _, cx| surface.sync(cx))
                .detach();
            let link_hover = Self::subscribe_link_hover(&client, cx);
            Self::new(
                client,
                SurfaceKind::Panel(surface_id),
                None,
                Some(view),
                link_hover,
            )
        })
    }

    fn subscribe_link_hover(
        client: &Entity<CoreClient>,
        cx: &mut Context<Self>,
    ) -> Entity<ViewState<Option<TerminalLinkHoverView>>> {
        let view = CoreClient::subscribe::<Option<TerminalLinkHoverView>>(
            client,
            "terminalLinkHover",
            json!({}),
            cx,
        );
        cx.observe(&view, |surface: &mut Self, view, cx| {
            let Some(hover) = view.read(cx).data.clone().flatten() else {
                return;
            };
            let Some(viewport) = surface.viewports.get(&hover.key).cloned() else {
                return;
            };
            viewport.update(cx, |viewport, cx| {
                viewport.apply_link_hover(hover.probe, hover.link, cx)
            });
        })
        .detach();
        view
    }

    fn new(
        client: Entity<CoreClient>,
        kind: SurfaceKind,
        drawer: Option<Entity<ViewState<Option<TerminalChromeView>>>>,
        panels: Option<Entity<ViewState<HashMap<String, TerminalChromeView>>>>,
        link_hover: Entity<ViewState<Option<TerminalLinkHoverView>>>,
    ) -> Self {
        Self {
            client,
            kind,
            drawer,
            panels,
            _link_hover: link_hover,
            viewports: HashMap::new(),
            focus_revision: 0,
            was_visible: false,
            pending_focus: false,
            drag: None,
            live_height: None,
            hovered_tab: None,
            window_height: 0.,
        }
    }

    fn view(&self, cx: &App) -> Option<TerminalChromeView> {
        match &self.kind {
            SurfaceKind::Drawer => self
                .drawer
                .as_ref()
                .and_then(|view| view.read(cx).data.clone().flatten()),
            SurfaceKind::Panel(id) => self
                .panels
                .as_ref()
                .and_then(|view| view.read(cx).data.as_ref()?.get(id).cloned()),
        }
    }

    fn surface_id(&self) -> Value {
        match &self.kind {
            SurfaceKind::Drawer => Value::Null,
            SurfaceKind::Panel(id) => Value::String(id.clone()),
        }
    }

    fn act(&self, cx: &mut App, action: &'static str, mut params: Value) {
        if let Value::Object(map) = &mut params {
            map.insert("surfaceId".into(), self.surface_id());
        }
        self.client
            .update(cx, |client, _| client.act(action, params));
    }

    fn sync(&mut self, cx: &mut Context<Self>) {
        let Some(view) = self.view(cx) else {
            cx.notify();
            return;
        };
        let family = SharedString::from(
            view.font_family
                .clone()
                .unwrap_or_else(|| DEFAULT_MONO_FONT.into()),
        );
        if let TerminalChromeModel::Ready { viewports, .. } = &view.model {
            for viewport in viewports {
                match self.viewports.get(&viewport.session_key) {
                    Some(existing) => existing.update(cx, |existing, cx| {
                        existing.set_font(family.clone(), view.font_size, cx)
                    }),
                    None => {
                        let session = session::session(&self.client, &viewport.session_key, cx);
                        let created = cx.new(|cx| {
                            TerminalViewport::new(session, family.clone(), view.font_size, cx)
                        });
                        self.viewports.insert(viewport.session_key.clone(), created);
                    }
                }
            }
            self.viewports.retain(|key, _| {
                viewports
                    .iter()
                    .any(|viewport| &viewport.session_key == key)
            });
        } else {
            self.viewports.clear();
        }
        if view.focus_revision != self.focus_revision || (view.visible && !self.was_visible) {
            self.pending_focus = true;
        }
        self.focus_revision = view.focus_revision;
        self.was_visible = view.visible;
        if self.live_height.is_some() && self.drag.is_none() {
            self.live_height = None;
        }
        cx.notify();
    }

    fn start_drag(&mut self, event: &MouseDownEvent, height: f32) {
        self.drag = Some(Drag {
            start_y: f32::from(event.position.y),
            start_height: self.live_height.unwrap_or(height),
        });
    }

    fn drag_to(&mut self, y: f32, view: &TerminalChromeView, cx: &mut Context<Self>) {
        let Some(drag) = &self.drag else {
            return;
        };
        let next = (drag.start_height + (drag.start_y - y))
            .round()
            .clamp(view.min_height, view.max_height);
        if self.live_height != Some(next) {
            self.live_height = Some(next);
            cx.notify();
        }
    }

    fn end_drag(&mut self, cx: &mut Context<Self>) {
        if self.drag.take().is_none() {
            return;
        }
        if let Some(height) = self.live_height {
            self.act(cx, "terminalDrawerHeight", json!({ "height": height }));
        }
        cx.notify();
    }

    fn action_button(
        &self,
        action: &TerminalActionView,
        sidebar: bool,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let id = SharedString::from(format!("terminal-action-{}-{}", self.key(), action.id));
        let action_id = action.id.clone();
        let disabled = action.disabled;
        let hover = if sidebar {
            fade(t.accent, 0.7)
        } else {
            t.accent
        };
        div()
            .id(id)
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .when(sidebar, |this| {
                this.h_full().px(px(SIDEBAR_ACTION_PADDING_X))
            })
            .when(!sidebar, |this| this.p(px(ACTION_PADDING)))
            .when(disabled, |this| this.opacity(DISABLED_OPACITY))
            .when(!disabled, |this| {
                this.cursor_pointer().hover(move |s| s.bg(hover))
            })
            .tooltip(Tooltip::text(action.label.clone()))
            .on_click(cx.listener(move |surface, _: &ClickEvent, _, cx| {
                surface.act(cx, "terminalAction", json!({ "action": action_id }));
            }))
            .child(icon(
                action_icon(&action.icon),
                ACTION_ICON,
                fade(t.foreground, FOREGROUND_ALPHA),
            ))
            .into_any_element()
    }

    fn key(&self) -> &str {
        match &self.kind {
            SurfaceKind::Drawer => "drawer",
            SurfaceKind::Panel(id) => id,
        }
    }

    fn floating_actions(
        &self,
        actions: &[TerminalActionView],
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let separator = fade(t.border, BORDER_ALPHA);
        let mut group = div()
            .flex()
            .items_center()
            .overflow_hidden()
            .rounded(px(ACTIONS_RADIUS))
            .border_1()
            .border_color(fade(t.border, BORDER_ALPHA))
            .bg(t.background)
            .shadow(vec![shadow_xs(0.05)]);
        for (index, action) in actions.iter().enumerate() {
            if index > 0 {
                group = group.child(
                    div()
                        .flex_none()
                        .w(px(1.))
                        .h(px(ACTION_SEPARATOR_HEIGHT))
                        .bg(separator),
                );
            }
            group = group.child(self.action_button(action, false, t, cx));
        }
        div()
            .absolute()
            .top(px(ACTIONS_INSET))
            .right(px(ACTIONS_INSET))
            .child(group)
            .into_any_element()
    }

    fn viewport(&self, viewport: &TerminalViewportView) -> AnyElement {
        match self.viewports.get(&viewport.session_key) {
            Some(entity) => div().size_full().child(entity.clone()).into_any_element(),
            None => div().size_full().into_any_element(),
        }
    }

    fn split(
        &self,
        viewports: &[TerminalViewportView],
        direction: TerminalSplitDirection,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let vertical = direction == TerminalSplitDirection::Vertical;
        div()
            .flex()
            .when(vertical, |this| this.flex_col())
            .size_full()
            .min_w_0()
            .overflow_hidden()
            .children(viewports.iter().enumerate().map(|(index, viewport)| {
                let color = if viewport.active {
                    t.border
                } else {
                    fade(t.border, SOFT_BORDER_ALPHA)
                };
                let terminal_id = viewport.terminal_id.clone();
                div()
                    .flex_1()
                    .min_w_0()
                    .min_h_0()
                    .border_color(color)
                    .when(index > 0 && vertical, |this| this.border_t_1())
                    .when(index > 0 && !vertical, |this| this.border_l_1())
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |surface, _: &MouseDownEvent, _, cx| {
                            surface.act(
                                cx,
                                "terminalSelect",
                                json!({ "source": "pane", "terminalId": terminal_id }),
                            );
                        }),
                    )
                    .child(self.viewport(viewport))
            }))
            .into_any_element()
    }

    fn group(
        &self,
        group: &TerminalGroupView,
        show_header: bool,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let activate = group.activate_terminal_id.clone();
        let header_hover = fade(t.accent, 0.4);
        let header = show_header.then(|| {
            let color = if group.active {
                t.foreground
            } else {
                t.muted_foreground
            };
            div()
                .id(SharedString::from(format!("terminal-group-{}", group.id)))
                .flex()
                .items_center()
                .w_full()
                .h(px(GROUP_HEADER_HEIGHT))
                .gap(px(GROUP_HEADER_GAP))
                .px(px(GROUP_HEADER_PADDING_X))
                .rounded(px(GROUP_HEADER_RADIUS))
                .cursor_pointer()
                .text_size(px(GROUP_HEADER_TEXT))
                .line_height(px(GROUP_HEADER_LINE))
                .text_color(color)
                .when(group.active, |this| this.bg(fade(t.accent, 0.5)))
                .when(!group.active, |this| {
                    let fg = t.foreground;
                    this.hover(move |s| s.bg(header_hover).text_color(fg))
                })
                .on_click(cx.listener(move |surface, _: &ClickEvent, _, cx| {
                    surface.act(
                        cx,
                        "terminalSelect",
                        json!({ "source": "group", "terminalId": activate }),
                    );
                }))
                .child(icon(action_icon(&group.icon), GROUP_ICON, color))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .child(SharedString::from(group.label.clone())),
                )
                .child(
                    div()
                        .flex_none()
                        .text_size(px(GROUP_COUNT_TEXT))
                        .line_height(px(GROUP_COUNT_LINE))
                        .text_color(fade(t.muted_foreground, 0.7))
                        .font_features(theme::tabular())
                        .child(SharedString::from(group.terminal_count.to_string())),
                )
        });
        div()
            .pb(px(GROUP_PADDING_BOTTOM))
            .children(header)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(TAB_GAP))
                    .children(group.tabs.iter().map(|tab| {
                        let hovered = self.hovered_tab.as_deref() == Some(tab.terminal_id.as_str());
                        let color = if tab.active || hovered {
                            t.foreground
                        } else {
                            t.muted_foreground
                        };
                        let bg = if tab.active {
                            Some(t.accent)
                        } else if hovered {
                            Some(fade(t.accent, 0.6))
                        } else {
                            None
                        };
                        let hover_id = tab.terminal_id.clone();
                        let close_id = tab.terminal_id.clone();
                        let select_id = tab.terminal_id.clone();
                        div()
                            .id(SharedString::from(format!(
                                "terminal-tab-{}",
                                tab.terminal_id
                            )))
                            .flex()
                            .items_center()
                            .w_full()
                            .h(px(TAB_HEIGHT))
                            .gap(px(TAB_GAP))
                            .pl(px(TAB_PADDING_LEFT))
                            .pr(px(TAB_PADDING_RIGHT))
                            .rounded(px(TAB_RADIUS))
                            .text_size(px(TAB_TEXT))
                            .line_height(px(TAB_LINE))
                            .text_color(color)
                            .when_some(bg, |this, bg| this.bg(bg))
                            .on_hover(cx.listener(move |surface, hovered: &bool, _, cx| {
                                let next = hovered.then(|| hover_id.clone());
                                if surface.hovered_tab != next
                                    && (*hovered
                                        || surface.hovered_tab.as_deref()
                                            == Some(hover_id.as_str()))
                                {
                                    surface.hovered_tab = next;
                                    cx.notify();
                                }
                            }))
                            .child(
                                div()
                                    .id(SharedString::from(format!(
                                        "terminal-tab-close-{}",
                                        tab.terminal_id
                                    )))
                                    .flex()
                                    .flex_none()
                                    .items_center()
                                    .justify_center()
                                    .size(px(TAB_CLOSE_SIZE))
                                    .rounded(px(TAB_CLOSE_RADIUS))
                                    .cursor_pointer()
                                    .hover({
                                        let muted = t.muted;
                                        move |s| s.bg(muted)
                                    })
                                    .tooltip(Tooltip::text(tab.close_label.clone()))
                                    .on_click(cx.listener(move |surface, _: &ClickEvent, _, cx| {
                                        cx.stop_propagation();
                                        surface.act(
                                            cx,
                                            "terminalClose",
                                            json!({ "terminalId": close_id }),
                                        );
                                    }))
                                    .child(icon(
                                        if hovered {
                                            "icons/x.svg"
                                        } else {
                                            "icons/square-terminal.svg"
                                        },
                                        TAB_ICON,
                                        color,
                                    )),
                            )
                            .child(
                                div()
                                    .id(SharedString::from(format!(
                                        "terminal-tab-label-{}",
                                        tab.terminal_id
                                    )))
                                    .flex()
                                    .flex_1()
                                    .min_w_0()
                                    .items_center()
                                    .cursor_pointer()
                                    .on_click(cx.listener(move |surface, _: &ClickEvent, _, cx| {
                                        surface.act(
                                            cx,
                                            "terminalSelect",
                                            json!({ "source": "tab", "terminalId": select_id }),
                                        );
                                    }))
                                    .child(
                                        div()
                                            .truncate()
                                            .child(SharedString::from(tab.label.clone())),
                                    ),
                            )
                    })),
            )
            .into_any_element()
    }

    fn sidebar(
        &self,
        actions: &[TerminalActionView],
        groups: &[TerminalGroupView],
        show_group_headers: bool,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let border = fade(t.border, SOFT_BORDER_ALPHA);
        div()
            .flex()
            .flex_col()
            .flex_none()
            .w(px(SIDEBAR_WIDTH))
            .border_1()
            .border_color(border)
            .bg(fade(t.muted, SIDEBAR_BG_ALPHA))
            .child(
                div()
                    .flex()
                    .flex_none()
                    .h(px(SIDEBAR_HEADER_HEIGHT))
                    .justify_end()
                    .border_b_1()
                    .border_color(border)
                    .children(actions.iter().enumerate().map(|(index, action)| {
                        div()
                            .h_full()
                            .border_color(border)
                            .when(index > 0, |this| this.border_l_1())
                            .child(self.action_button(action, true, t, cx))
                    })),
            )
            .child(
                div()
                    .id(SharedString::from(format!(
                        "terminal-sidebar-{}",
                        self.key()
                    )))
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .p(px(SIDEBAR_LIST_PADDING))
                    .children(
                        groups
                            .iter()
                            .map(|group| self.group(group, show_group_headers, t, cx)),
                    ),
            )
            .into_any_element()
    }
}

impl Render for TerminalSurface {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = theme::active(cx);
        let Some(view) = self.view(cx) else {
            return div().into_any_element();
        };
        let drawer = self.kind == SurfaceKind::Drawer;
        if drawer {
            let window_height = f32::from(window.viewport_size().height);
            if window_height != self.window_height {
                self.window_height = window_height;
                self.act(
                    cx,
                    "terminalWindowHeight",
                    json!({ "height": window_height }),
                );
            }
        }
        if !view.visible {
            return div().into_any_element();
        }
        if self.pending_focus {
            self.pending_focus = false;
            if let TerminalChromeModel::Ready { viewports, .. } = &view.model
                && let Some(entity) = viewports
                    .iter()
                    .find(|viewport| viewport.auto_focus && viewport.active)
                    .or_else(|| viewports.iter().find(|viewport| viewport.auto_focus))
                    .and_then(|viewport| self.viewports.get(&viewport.session_key))
            {
                window.focus(&entity.read(cx).focus_handle(cx), cx);
            }
        }
        let height = self.live_height.unwrap_or(view.height);
        let resize_view = view.clone();
        let root = div()
            .id(SharedString::from(format!(
                "terminal-surface-{}",
                self.key()
            )))
            .relative()
            .flex()
            .flex_col()
            .min_w_0()
            .overflow_hidden()
            .bg(t.background)
            .when(drawer, |this| {
                this.flex_none()
                    .w_full()
                    .h(px(height))
                    .border_t_1()
                    .border_color(fade(t.border, BORDER_ALPHA))
            })
            .when(!drawer, |this| this.size_full().flex_1());
        let resize_handle = drawer.then(|| {
            div()
                .id("terminal-drawer-resize")
                .absolute()
                .top_0()
                .left_0()
                .right_0()
                .h(px(RESIZE_HANDLE_HEIGHT))
                .cursor(CursorStyle::ResizeRow)
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(move |surface, event: &MouseDownEvent, _, cx| {
                        surface.start_drag(event, height);
                        cx.stop_propagation();
                        cx.notify();
                    }),
                )
        });
        let drag_tracker = self.drag.is_some().then(|| {
            let entity = cx.entity().downgrade();
            canvas(
                |_, _, _| {},
                move |_, _, window, _| {
                    let moving = entity.clone();
                    let view = resize_view.clone();
                    window.on_mouse_event(move |event: &MouseMoveEvent, _, _, cx| {
                        moving
                            .update(cx, |surface, cx| {
                                surface.drag_to(f32::from(event.position.y), &view, cx)
                            })
                            .ok();
                    });
                    let ending = entity.clone();
                    window.on_mouse_event(move |_: &MouseUpEvent, _, _, cx| {
                        ending.update(cx, |surface, cx| surface.end_drag(cx)).ok();
                    });
                },
            )
            .absolute()
            .size_0()
        });

        let body = match &view.model {
            TerminalChromeModel::Empty {
                message,
                new_action,
            } => {
                let action_id = new_action.id.clone();
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .items_center()
                    .justify_center()
                    .gap(px(EMPTY_GAP))
                    .px(px(EMPTY_PADDING_X))
                    .py(px(EMPTY_PADDING_Y))
                    .text_size(px(EMPTY_TEXT))
                    .line_height(px(EMPTY_LINE))
                    .text_color(t.muted_foreground)
                    .child(SharedString::from(message.clone()))
                    .child(
                        Button::new(SharedString::from(format!(
                            "terminal-empty-new-{}",
                            self.key()
                        )))
                        .variant(ButtonVariant::Outline)
                        .size(ButtonSize::Xs)
                        .label(new_action.label.clone())
                        .on_click(cx.listener(
                            move |surface, _: &ClickEvent, _, cx| {
                                surface.act(cx, "terminalAction", json!({ "action": action_id }));
                            },
                        )),
                    )
                    .into_any_element()
            }
            TerminalChromeModel::Ready {
                split_direction,
                is_split_view,
                show_sidebar,
                show_group_headers,
                actions,
                viewports,
                groups,
                ..
            } => {
                let terminals = if *is_split_view {
                    self.split(viewports, *split_direction, &t, cx)
                } else {
                    div()
                        .size_full()
                        .children(viewports.iter().map(|viewport| self.viewport(viewport)))
                        .into_any_element()
                };
                div()
                    .flex_1()
                    .min_h_0()
                    .w_full()
                    .child(
                        div()
                            .flex()
                            .size_full()
                            .min_h_0()
                            .bg(t.terminal_background)
                            .when(*show_sidebar, |this| this.gap(px(SIDEBAR_GAP)))
                            .child(div().flex_1().min_w_0().h_full().child(terminals))
                            .when(*show_sidebar, |this| {
                                this.child(self.sidebar(
                                    actions,
                                    groups,
                                    *show_group_headers,
                                    &t,
                                    cx,
                                ))
                            }),
                    )
                    .when(!*show_sidebar, |this| {
                        this.child(self.floating_actions(actions, &t, cx))
                    })
                    .into_any_element()
            }
        };
        root.child(body)
            .children(resize_handle)
            .children(drag_tracker)
            .into_any_element()
    }
}
