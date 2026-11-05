use gpui::component::input::{Escape, InputEvent, InputState, MoveDown, MoveUp};
use gpui::component::scroll::{Scrollbar, ScrollbarAxis, ScrollbarMode};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, Bounds, Context, Entity, Focusable, FontWeight, Global,
    InteractiveElement, IntoElement, MouseButton, MouseDownEvent, ParentElement, Pixels, Render,
    Rgba, ScrollHandle, SharedString, StatefulInteractiveElement, Styled, Window, canvas, div, img,
    linear_color_stop, linear_gradient, point, px, svg,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::branch_toolbar::{
    BranchMenuItem, BranchMenuItemKind, BranchMenuView, BranchSelectorView, BranchToolbarSelect,
    BranchToolbarSelectItem, BranchToolbarView, MiddleTruncateSplit,
};
use crate::ui::input::bare_input;
use crate::ui::menu::{MENU_PADDING, MenuGroupLabel, MenuPopup, MenuRadioItem};
use crate::ui::popover::{Align, Side, dropdown_glass, dropdown_glass_background, positioned};
use crate::ui::switch::{Switch, SwitchSize};
use crate::ui::theme;
use crate::ui::theme::color::{alpha, hsla};
use crate::ui::theme::metrics::{radius, text, workspace};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const STRIP_GAP: f32 = 4.;
const LEFT_GROUP_MIN_WIDTH: f32 = 40.;
const CONTROL_HEIGHT: f32 = 24.;
const CONTROL_RADIUS: f32 = 8.;
const CONTROL_GAP: f32 = 4.;
const CONTROL_ICON: f32 = 12.;
const LABEL_MAX_WIDTH: f32 = 240.;
const MUTED_TEXT_OPACITY: f32 = 0.7;
const STATIC_PADDING_X: f32 = 8.;
const SELECT_PADDING_LEFT: f32 = 12.;
const SELECT_PADDING_RIGHT: f32 = 4.;
const CHEVRON_OPACITY: f32 = 0.5;
const SEPARATOR_HEIGHT: f32 = 14.;
const SEPARATOR_MARGIN_X: f32 = 2.;
const BRANCH_PADDING_X: f32 = 6.;
const BRANCH_GAP: f32 = 2.;
const BRANCH_ICON_OPACITY: f32 = 0.7;
const BRANCH_HOVER_TEXT_OPACITY: f32 = 0.8;
const DISABLED_OPACITY: f32 = 0.64;
const SELECT_MENU_EXTRA_WIDTH: f32 = 10.;
const SELECT_MENU_WIDE_WIDTH: f32 = 336.;
const SELECT_ROW_CONTENT_HEIGHT: f32 = 21.;
const SELECT_ROW_HEIGHT: f32 = 29.;
const SELECT_DETAIL_ROW_HEIGHT: f32 = 44.;
const SELECT_LABEL_HEIGHT: f32 = 28.;
const SELECT_ROW_GAP: f32 = 6.;
const SELECT_DETAIL_ICON_TOP: f32 = 4.;
const POPUP_SIDE_OFFSET: f32 = 4.;
const VIEWPORT_MARGIN: f32 = 8.;
const MENU_WIDTH: f32 = 320.;
const SEARCH_PADDING_X: f32 = 12.;
const SEARCH_PADDING_TOP: f32 = 9.;
const SEARCH_PADDING_BOTTOM: f32 = 1.;
const SEARCH_UNDERLINE_GAP: f32 = 6.;
const SEARCH_INPUT_HEIGHT: f32 = 26.;
const SEARCH_TEXT_INSET: f32 = 20.;
const SEARCH_TEXT_PADDING_RIGHT: f32 = 9.;
const SEARCH_ICON: f32 = 16.;
const SEARCH_ICON_TOP: f32 = 6.;
const SEARCH_ICON_OPACITY: f32 = 0.55;
const SEARCH_BORDER_OPACITY: f32 = 0.7;
const LIST_MAX_HEIGHT: f32 = 224.;
const LIST_OUTER_PADDING: f32 = 4.;
const LIST_INNER_PADDING_TOP: f32 = 8.;
const LIST_INNER_PADDING_LEFT: f32 = 4.;
const LIST_INNER_PADDING_BOTTOM: f32 = 4.;
const LIST_GUTTER: f32 = 6.;
const LIST_FADE: f32 = 24.;
const ROW_HEIGHT: f32 = 28.;
const ROW_PADDING_X: f32 = 8.;
const ROW_PADDING_Y: f32 = 4.;
const ROW_GAP: f32 = 8.;
const BADGE_TEXT: f32 = 10.;
const BADGE_LINE: f32 = 14.;
const BADGE_OPACITY: f32 = 0.45;
const PULL_REQUEST_ICON: f32 = 14.;
const EMPTY_PADDING: f32 = 8.;
const FOOTER_PADDING_X: f32 = 12.;
const FOOTER_PADDING_Y: f32 = 8.;
const FOOTER_GAP: f32 = 12.;
const FOOTER_LABEL_GAP: f32 = 6.;
const FOOTER_BORDER_OPACITY: f32 = 0.6;
const START_FROM_ORIGIN_TOOLTIP: &str =
    "Creates the worktree from the latest matching branch on origin instead of your local branch.";
const MONO_SOURCE_CONTROL_ICONS: &[&str] = &["github", "change-request"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SelectKind {
    Environment,
    Workspace,
}

impl SelectKind {
    fn id(self) -> &'static str {
        match self {
            SelectKind::Environment => "environment",
            SelectKind::Workspace => "workspace",
        }
    }

    fn action(self) -> &'static str {
        match self {
            SelectKind::Environment => "branchToolbarSelectEnvironment",
            SelectKind::Workspace => "branchToolbarSelectWorkspace",
        }
    }
}

pub struct BranchToolbarHandle(pub Entity<BranchToolbarHost>);

impl Global for BranchToolbarHandle {}

pub struct BranchToolbarHost {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<BranchToolbarView>>>,
    search: Entity<InputState>,
    open_select: Option<SelectKind>,
    environment_bounds: Bounds<Pixels>,
    workspace_bounds: Bounds<Pixels>,
    branch_bounds: Bounds<Pixels>,
    thread_key: Option<String>,
    menu_open: bool,
    list_scroll: ScrollHandle,
    reported_scroll_top: Option<f32>,
    reveal_highlight: bool,
}

fn send(client: &Entity<CoreClient>, cx: &mut App, action: &str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

fn glyph(path: impl Into<SharedString>, size: f32, color: Rgba) -> gpui::Svg {
    svg()
        .path(path)
        .flex_none()
        .size(px(size))
        .text_color(color)
}

fn middle_truncate(label: &str, split: &Option<MiddleTruncateSplit>) -> gpui::Div {
    let row = div()
        .flex()
        .min_w_0()
        .max_w_full()
        .overflow_hidden()
        .whitespace_nowrap();
    match split {
        Some(split) => row
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .child(SharedString::from(split.head.clone())),
            )
            .child(
                div()
                    .flex_none()
                    .child(SharedString::from(split.tail.clone())),
            ),
        None => row.child(
            div()
                .min_w_0()
                .truncate()
                .child(SharedString::from(label.to_string())),
        ),
    }
}

fn fade_edge(surface: Rgba, top: bool) -> gpui::Div {
    div()
        .absolute()
        .left_0()
        .right_0()
        .h(px(LIST_FADE))
        .map(|this| {
            if top {
                this.top(px(LIST_OUTER_PADDING))
            } else {
                this.bottom_0()
            }
        })
        .bg(linear_gradient(
            if top { 180. } else { 0. },
            linear_color_stop(hsla(surface), 0.),
            linear_color_stop(hsla(alpha(surface, 0.)), 1.),
        ))
}

fn anchor(kind: Option<SelectKind>) -> impl IntoElement {
    canvas(
        move |bounds, _, cx| {
            if let Some(host) = BranchToolbarHost::global(cx) {
                host.update(cx, |host, _| match kind {
                    Some(SelectKind::Environment) => host.environment_bounds = bounds,
                    Some(SelectKind::Workspace) => host.workspace_bounds = bounds,
                    None => host.branch_bounds = bounds,
                });
            }
        },
        |_, _, _, _| {},
    )
    .absolute()
    .size_full()
}

impl BranchToolbarHost {
    pub fn install(client: &Entity<CoreClient>, window: &mut Window, cx: &mut App) {
        if cx.has_global::<BranchToolbarHandle>() {
            return;
        }
        let host = cx.new(|cx| Self::new(client.clone(), window, cx));
        cx.set_global(BranchToolbarHandle(host));
    }

    pub fn global(cx: &App) -> Option<Entity<BranchToolbarHost>> {
        cx.try_global::<BranchToolbarHandle>()
            .map(|handle| handle.0.clone())
    }

    fn new(client: Entity<CoreClient>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<BranchToolbarView>>(
            &client,
            "branchToolbar",
            json!({}),
            cx,
        );
        cx.observe_in(&view, window, |host, _, window, cx| host.sync(window, cx))
            .detach();
        let search = cx.new(|cx| InputState::new(window, cx));
        let target = client.clone();
        cx.subscribe_in(
            &search,
            window,
            move |host, state: &Entity<InputState>, event: &InputEvent, _, cx| match event {
                InputEvent::Change => {
                    if !host.menu_open {
                        return;
                    }
                    let query = state.read(cx).value().to_string();
                    host.list_scroll.set_offset(point(px(0.), px(0.)));
                    host.reported_scroll_top = None;
                    send(
                        &target,
                        cx,
                        "branchToolbarBranchQuery",
                        json!({ "query": query }),
                    );
                }
                InputEvent::PressEnter { .. } => {
                    send(
                        &target,
                        cx,
                        "branchToolbarBranchPick",
                        json!({ "value": null }),
                    );
                }
                _ => {}
            },
        )
        .detach();
        Self {
            client,
            view,
            search,
            open_select: None,
            environment_bounds: Bounds::default(),
            workspace_bounds: Bounds::default(),
            branch_bounds: Bounds::default(),
            thread_key: None,
            menu_open: false,
            list_scroll: ScrollHandle::new(),
            reported_scroll_top: None,
            reveal_highlight: false,
        }
    }

    fn view(&self, cx: &App) -> Option<BranchToolbarView> {
        self.view.read(cx).data.clone().flatten()
    }

    fn sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let view = self.view(cx);
        let thread_key = view.as_ref().map(|view| view.thread_key.clone());
        if thread_key != self.thread_key {
            self.thread_key = thread_key;
            self.open_select = None;
        }
        let menu = view
            .as_ref()
            .and_then(|view| view.branch.as_ref())
            .and_then(|branch| branch.menu.as_ref());
        match menu {
            Some(menu) => {
                if !self.menu_open {
                    self.menu_open = true;
                    self.open_select = None;
                    self.list_scroll.set_offset(point(px(0.), px(0.)));
                    self.reported_scroll_top = None;
                    let query = menu.query.clone();
                    self.search.update(cx, |state, cx| {
                        state.set_value(query, window, cx);
                        state.set_placeholder("Search refs...", window, cx);
                        state.focus(window, cx);
                    });
                }
                if self.reveal_highlight {
                    self.reveal_highlight = false;
                    let index = menu.highlighted.as_ref().and_then(|highlighted| {
                        menu.items
                            .iter()
                            .position(|item| &item.value == highlighted)
                    });
                    if let Some(index) = index {
                        self.list_scroll.scroll_to_item(index);
                    }
                }
            }
            None => {
                self.menu_open = false;
                self.reveal_highlight = false;
            }
        }
        cx.notify();
    }

    fn set_open_select(&mut self, kind: Option<SelectKind>, cx: &mut Context<Self>) {
        self.open_select = kind;
        cx.notify();
    }

    pub fn strip(cx: &App) -> Option<AnyElement> {
        let host = Self::global(cx)?;
        let state = host.read(cx);
        let view = state.view(cx)?;
        let open_select = state.open_select;
        let client = state.client.clone();
        let t = theme::active(cx);
        let left = div()
            .flex()
            .flex_1()
            .min_w(px(LEFT_GROUP_MIN_WIDTH))
            .items_center()
            .gap(px(STRIP_GAP))
            .when_some(view.environment.as_ref(), |row, select| {
                row.child(select_control(
                    select,
                    SelectKind::Environment,
                    open_select == Some(SelectKind::Environment),
                    &host,
                    &t,
                ))
            })
            .when(view.separator, |row| {
                row.child(
                    div()
                        .flex_none()
                        .mx(px(SEPARATOR_MARGIN_X))
                        .w(px(1.))
                        .h(px(SEPARATOR_HEIGHT))
                        .bg(t.border),
                )
            })
            .when_some(view.workspace.as_ref(), |row, select| {
                row.child(select_control(
                    select,
                    SelectKind::Workspace,
                    open_select == Some(SelectKind::Workspace),
                    &host,
                    &t,
                ))
            });
        Some(
            div()
                .flex()
                .flex_1()
                .min_w_0()
                .items_center()
                .gap(px(STRIP_GAP))
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .child(left)
                .when_some(view.branch.as_ref(), |row, branch| {
                    row.child(branch_control(branch, &client, &t))
                })
                .into_any_element(),
        )
    }

    fn select_menu(
        &self,
        view: &BranchToolbarView,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let kind = self.open_select?;
        let select = match kind {
            SelectKind::Environment => view.environment.as_ref(),
            SelectKind::Workspace => view.workspace.as_ref(),
        }?;
        if !select.interactive {
            return None;
        }
        let trigger = match kind {
            SelectKind::Environment => self.environment_bounds,
            SelectKind::Workspace => self.workspace_bounds,
        };
        let t = theme::active(cx);
        let host = cx.entity();
        let estimated_height = select.items.iter().fold(
            SELECT_LABEL_HEIGHT + 2. * MENU_PADDING + 2.,
            |height, item| {
                height
                    + if item.detail.is_some() {
                        SELECT_DETAIL_ROW_HEIGHT
                    } else {
                        SELECT_ROW_HEIGHT
                    }
            },
        );
        let space_below = f32::from(window.viewport_size().height)
            - f32::from(trigger.bottom())
            - POPUP_SIDE_OFFSET
            - VIEWPORT_MARGIN;
        let side = if estimated_height > space_below {
            Side::Top
        } else {
            Side::Bottom
        };
        let min_width = if select.wide {
            SELECT_MENU_WIDE_WIDTH
        } else {
            f32::from(trigger.size.width) + SELECT_MENU_EXTRA_WIDTH
        };
        let dismiss = host.clone();
        let rows: Vec<AnyElement> = select
            .items
            .iter()
            .map(|item| self.select_row(kind, select, item, &host, &t))
            .collect();
        Some(
            MenuPopup::new(
                SharedString::from(format!("branch-toolbar-{}-menu", kind.id())),
                trigger,
            )
            .side(side)
            .align(Align::Start)
            .side_offset(POPUP_SIDE_OFFSET)
            .min_width(min_width)
            .on_dismiss(move |window, cx| {
                if !trigger.contains(&window.mouse_position()) {
                    dismiss.update(cx, |host, cx| host.set_open_select(None, cx));
                }
            })
            .child(MenuGroupLabel::new(select.group_label.clone()))
            .children(rows)
            .into_any_element(),
        )
    }

    fn select_row(
        &self,
        kind: SelectKind,
        select: &BranchToolbarSelect,
        item: &BranchToolbarSelectItem,
        host: &Entity<BranchToolbarHost>,
        t: &Tokens,
    ) -> AnyElement {
        let client = self.client.clone();
        let host = host.clone();
        let value = item.value.clone();
        let icon = glyph(item.icon.path(), CONTROL_ICON, t.muted_foreground);
        let content = match &item.detail {
            Some(detail) => div()
                .flex()
                .min_w_0()
                .items_start()
                .gap(px(SELECT_ROW_GAP))
                .child(icon.mt(px(SELECT_DETAIL_ICON_TOP)))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .min_w_0()
                        .child(SharedString::from(item.label.clone()))
                        .child(
                            div()
                                .flex()
                                .min_w_0()
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .text_color(t.muted_foreground)
                                .child(middle_truncate(detail, &item.detail_truncation)),
                        ),
                ),
            None => div()
                .flex()
                .min_w_0()
                .h(px(SELECT_ROW_CONTENT_HEIGHT))
                .items_center()
                .gap(px(SELECT_ROW_GAP))
                .child(icon)
                .child(
                    div()
                        .min_w_0()
                        .truncate()
                        .child(SharedString::from(item.label.clone())),
                ),
        };
        MenuRadioItem::new(SharedString::from(format!(
            "branch-toolbar-{}-{}",
            kind.id(),
            item.value
        )))
        .checked(item.value == select.value)
        .on_click(move |_, _, cx| {
            host.update(cx, |host, cx| host.set_open_select(None, cx));
            send(&client, cx, kind.action(), json!({ "value": value }));
        })
        .child(content)
        .into_any_element()
    }

    fn branch_menu(
        &self,
        menu: &BranchMenuView,
        search_focused: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = theme::active(cx);
        let host = cx.entity();
        let trigger = self.branch_bounds;
        let dismiss = self.client.clone();
        let escape = self.client.clone();
        let (up_host, down_host) = (host.clone(), host.clone());
        let (up, down) = (self.client.clone(), self.client.clone());
        let surface_bg = dropdown_glass_background(&t);
        let (thumb, thumb_hover) = (t.scrollbar_thumb, t.scrollbar_thumb_hover);
        let rows: Vec<AnyElement> = menu
            .items
            .iter()
            .map(|item| self.branch_row(item, menu.highlighted.as_deref() == Some(&item.value), &t))
            .collect();
        let offset = self.list_scroll.offset();
        let max = self.list_scroll.max_offset();
        let show_top_fade = offset.y < px(0.);
        let show_bottom_fade = -offset.y < max.y;
        let scroll = self.list_scroll.clone();
        let report_host = host.clone();
        let report_client = self.client.clone();
        let list = (!menu.items.is_empty()).then(|| {
            div()
                .relative()
                .w_full()
                .max_h(px(LIST_MAX_HEIGHT))
                .overflow_hidden()
                .pt(px(LIST_OUTER_PADDING))
                .pb(px(LIST_OUTER_PADDING))
                .px(px(LIST_OUTER_PADDING))
                .child(
                    div()
                        .id("branch-toolbar-branch-list")
                        .max_h(px(LIST_MAX_HEIGHT))
                        .overflow_y_scroll()
                        .track_scroll(&self.list_scroll)
                        .flex()
                        .flex_col()
                        .pt(px(LIST_INNER_PADDING_TOP))
                        .pb(px(LIST_INNER_PADDING_BOTTOM))
                        .pl(px(LIST_INNER_PADDING_LEFT))
                        .pr(px(LIST_GUTTER))
                        .children(rows),
                )
                .when(show_top_fade, |this| {
                    this.child(fade_edge(surface_bg, true))
                })
                .when(show_bottom_fade, |this| {
                    this.child(fade_edge(surface_bg, false))
                })
                .child(
                    div().absolute().inset_0().child(
                        Scrollbar::new(&self.list_scroll)
                            .id("branch-toolbar-branch-scrollbar")
                            .axis(ScrollbarAxis::Vertical)
                            .mode(ScrollbarMode::Hover)
                            .styles(move |styles| {
                                styles
                                    .thumb(move |style| {
                                        style
                                            .bg(hsla(thumb))
                                            .width(px(workspace::SCROLLBAR_WIDTH))
                                            .inset(px(1.))
                                            .radius(px(workspace::SCROLLBAR_WIDTH / 2.))
                                    })
                                    .thumb_hover(move |style| style.bg(hsla(thumb_hover)))
                                    .thumb_active(move |style| style.bg(hsla(thumb_hover)))
                            }),
                    ),
                )
                .child(
                    canvas(
                        move |_, _, cx| {
                            let scroll_top = -f32::from(scroll.offset().y);
                            let client_height = f32::from(scroll.bounds().size.height);
                            let scroll_height = client_height + f32::from(scroll.max_offset().y);
                            let changed = report_host.update(cx, |host, _| {
                                if !host.menu_open || host.reported_scroll_top == Some(scroll_top) {
                                    return false;
                                }
                                host.reported_scroll_top = Some(scroll_top);
                                true
                            });
                            if changed {
                                send(
                                    &report_client,
                                    cx,
                                    "branchToolbarBranchScroll",
                                    json!({
                                        "scrollTop": scroll_top,
                                        "scrollHeight": scroll_height,
                                        "clientHeight": client_height,
                                    }),
                                );
                            }
                        },
                        |_, _, _, _| {},
                    )
                    .absolute()
                    .size_full(),
                )
        });
        let start_from_origin = menu.start_from_origin.as_ref().map(|toggle| {
            let checked = toggle.checked;
            let client = self.client.clone();
            div()
                .id("branch-toolbar-start-from-origin")
                .flex()
                .flex_none()
                .items_center()
                .justify_between()
                .gap(px(FOOTER_GAP))
                .px(px(FOOTER_PADDING_X))
                .py(px(FOOTER_PADDING_Y))
                .border_t_1()
                .border_color(fade(t.border, FOOTER_BORDER_OPACITY))
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .cursor_pointer()
                .tooltip(Tooltip::text(START_FROM_ORIGIN_TOOLTIP))
                .on_click(move |_, _, cx| {
                    send(
                        &client,
                        cx,
                        "branchToolbarStartFromOrigin",
                        json!({ "checked": !checked }),
                    );
                })
                .child(
                    div()
                        .flex()
                        .min_w_0()
                        .items_center()
                        .gap(px(FOOTER_LABEL_GAP))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.muted_foreground)
                        .child(glyph(
                            "icons/refresh-cw.svg",
                            CONTROL_ICON,
                            t.muted_foreground,
                        ))
                        .child(div().min_w_0().truncate().child("Start from origin")),
                )
                .child(
                    Switch::new("branch-toolbar-start-from-origin-switch")
                        .checked(checked)
                        .size(SwitchSize::Sm)
                        .accessibility_label("Start worktree from origin"),
                )
        });
        let surface = dropdown_glass(cx)
            .id("branch-toolbar-branch-menu")
            .occlude()
            .flex_col()
            .w(px(MENU_WIDTH))
            .overflow_hidden()
            .on_mouse_down_out(move |event, _, cx| {
                if !trigger.contains(&event.position) {
                    send(
                        &dismiss,
                        cx,
                        "branchToolbarBranchMenu",
                        json!({ "open": false }),
                    );
                }
            })
            .capture_action(move |_: &Escape, _, cx| {
                cx.stop_propagation();
                send(
                    &escape,
                    cx,
                    "branchToolbarBranchMenu",
                    json!({ "open": false }),
                );
            })
            .capture_action(move |_: &MoveUp, _, cx| {
                cx.stop_propagation();
                up_host.update(cx, |host, _| host.reveal_highlight = true);
                send(&up, cx, "branchToolbarBranchMove", json!({ "delta": -1 }));
            })
            .capture_action(move |_: &MoveDown, _, cx| {
                cx.stop_propagation();
                down_host.update(cx, |host, _| host.reveal_highlight = true);
                send(&down, cx, "branchToolbarBranchMove", json!({ "delta": 1 }));
            })
            .child(
                div()
                    .flex_none()
                    .px(px(SEARCH_PADDING_X))
                    .pt(px(SEARCH_PADDING_TOP))
                    .pb(px(SEARCH_PADDING_BOTTOM))
                    .child(
                        div()
                            .relative()
                            .pb(px(SEARCH_UNDERLINE_GAP))
                            .border_b_1()
                            .border_color(if search_focused {
                                t.ring
                            } else {
                                fade(t.border, SEARCH_BORDER_OPACITY)
                            })
                            .child(
                                glyph(
                                    "icons/search.svg",
                                    SEARCH_ICON,
                                    fade(t.muted_foreground, SEARCH_ICON_OPACITY),
                                )
                                .absolute()
                                .left_0()
                                .top(px(SEARCH_ICON_TOP)),
                            )
                            .child(bare_input(
                                &self.search,
                                SEARCH_INPUT_HEIGHT,
                                SEARCH_TEXT_INSET,
                                SEARCH_TEXT_PADDING_RIGHT,
                                text::SM,
                                false,
                            )),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .min_h_0()
                    .overflow_hidden()
                    .when_some(menu.empty_text.clone(), |this, empty| {
                        this.child(
                            div()
                                .p(px(EMPTY_PADDING))
                                .flex()
                                .justify_center()
                                .text_size(px(text::SM))
                                .line_height(px(text::SM_LINE))
                                .text_color(t.muted_foreground)
                                .child(SharedString::from(empty)),
                        )
                    })
                    .children(list)
                    .children(start_from_origin)
                    .when_some(menu.status_text.clone(), |this, status| {
                        this.child(
                            div()
                                .px(px(FOOTER_PADDING_X))
                                .py(px(FOOTER_PADDING_Y))
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.muted_foreground)
                                .child(SharedString::from(status)),
                        )
                    }),
            );
        positioned(
            trigger,
            Side::Top,
            Align::End,
            POPUP_SIDE_OFFSET,
            0.,
            surface,
        )
        .into_any_element()
    }

    fn branch_row(&self, item: &BranchMenuItem, highlighted: bool, t: &Tokens) -> AnyElement {
        let pick = self.client.clone();
        let hover = self.client.clone();
        let value = item.value.clone();
        let hover_value = item.value.clone();
        let accent = t.accent;
        let row = div()
            .id(SharedString::from(format!(
                "branch-toolbar-ref-{}",
                item.value
            )))
            .flex()
            .flex_none()
            .items_center()
            .min_h(px(ROW_HEIGHT))
            .px(px(ROW_PADDING_X))
            .py(px(ROW_PADDING_Y))
            .rounded(px(radius::SM))
            .cursor_pointer()
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .text_color(t.foreground)
            .when(highlighted, |row| row.bg(accent))
            .hover(move |style| style.bg(accent))
            .on_hover(move |hovered, _, cx| {
                if *hovered {
                    send(
                        &hover,
                        cx,
                        "branchToolbarBranchHighlight",
                        json!({ "value": hover_value }),
                    );
                }
            })
            .on_click(move |_, _, cx| {
                send(
                    &pick,
                    cx,
                    "branchToolbarBranchPick",
                    json!({ "value": value }),
                );
            });
        match item.kind {
            BranchMenuItemKind::CheckoutPullRequest => {
                let icon = item
                    .icon
                    .clone()
                    .unwrap_or_else(|| "change-request".to_string());
                let path = SharedString::from(format!("icons/source-control/{icon}.svg"));
                let glyph = if MONO_SOURCE_CONTROL_ICONS.contains(&icon.as_str()) {
                    glyph(path, PULL_REQUEST_ICON, t.muted_foreground).into_any_element()
                } else {
                    img(path)
                        .flex_none()
                        .size(px(PULL_REQUEST_ICON))
                        .into_any_element()
                };
                row.child(
                    div()
                        .flex()
                        .min_w_0()
                        .items_center()
                        .gap(px(ROW_GAP))
                        .py(px(ROW_PADDING_Y))
                        .child(glyph)
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .min_w_0()
                                .child(
                                    div()
                                        .min_w_0()
                                        .truncate()
                                        .font_weight(FontWeight::MEDIUM)
                                        .child(SharedString::from(item.label.clone())),
                                )
                                .when_some(item.detail.clone(), |this, detail| {
                                    this.child(
                                        div()
                                            .min_w_0()
                                            .truncate()
                                            .text_size(px(text::XS))
                                            .line_height(px(text::XS_LINE))
                                            .text_color(t.muted_foreground)
                                            .child(SharedString::from(detail)),
                                    )
                                }),
                        ),
                )
                .into_any_element()
            }
            BranchMenuItemKind::Create => row
                .child(
                    div()
                        .min_w_0()
                        .truncate()
                        .child(SharedString::from(item.label.clone())),
                )
                .into_any_element(),
            BranchMenuItemKind::Ref => {
                let menu_client = self.client.clone();
                let branch = item.value.clone();
                row.on_mouse_down(MouseButton::Right, move |event: &MouseDownEvent, _, cx| {
                    cx.stop_propagation();
                    send(
                        &menu_client,
                        cx,
                        "branchToolbarBranchContextMenu",
                        json!({
                            "branch": branch,
                            "x": f32::from(event.position.x),
                            "y": f32::from(event.position.y),
                        }),
                    );
                })
                .child(
                    div()
                        .flex()
                        .w_full()
                        .min_w_0()
                        .items_center()
                        .justify_between()
                        .gap(px(ROW_GAP))
                        .child(middle_truncate(&item.label, &item.truncation).flex_1())
                        .when_some(item.badge.clone(), |this, badge| {
                            this.child(
                                div()
                                    .flex_none()
                                    .text_size(px(BADGE_TEXT))
                                    .line_height(px(BADGE_LINE))
                                    .text_color(fade(t.muted_foreground, BADGE_OPACITY))
                                    .child(SharedString::from(badge)),
                            )
                        }),
                )
                .into_any_element()
            }
        }
    }
}

fn select_control(
    select: &BranchToolbarSelect,
    kind: SelectKind,
    open: bool,
    host: &Entity<BranchToolbarHost>,
    t: &Tokens,
) -> AnyElement {
    let id = SharedString::from(format!("branch-toolbar-{}", kind.id()));
    let label = div()
        .min_w_0()
        .max_w(px(LABEL_MAX_WIDTH))
        .truncate()
        .child(SharedString::from(select.label.clone()));
    if !select.interactive {
        let ink = fade(t.muted_foreground, MUTED_TEXT_OPACITY);
        return div()
            .id(id)
            .flex()
            .min_w_0()
            .items_center()
            .gap(px(CONTROL_GAP))
            .h(px(CONTROL_HEIGHT))
            .px(px(STATIC_PADDING_X))
            .text_color(ink)
            .tooltip(Tooltip::text(select.tooltip.clone()))
            .child(glyph(select.icon.path(), CONTROL_ICON, ink))
            .child(label)
            .into_any_element();
    }
    let group = SharedString::from(format!("branch-toolbar-{}-trigger", kind.id()));
    let ink = t.secondary_label;
    let active = t.foreground;
    let accent = t.accent;
    let toggle = host.clone();
    div()
        .id(id)
        .group(group.clone())
        .relative()
        .flex()
        .min_w_0()
        .items_center()
        .gap(px(CONTROL_GAP))
        .h(px(CONTROL_HEIGHT))
        .pl(px(SELECT_PADDING_LEFT))
        .pr(px(SELECT_PADDING_RIGHT))
        .rounded(px(CONTROL_RADIUS))
        .cursor_pointer()
        .text_color(if open { active } else { ink })
        .when(open, |this| this.bg(accent))
        .hover(move |style| style.bg(accent).text_color(active))
        .tooltip(Tooltip::text(select.tooltip.clone()))
        .on_click(move |_, _, cx| {
            toggle.update(cx, |host, cx| {
                let next = if host.open_select == Some(kind) {
                    None
                } else {
                    Some(kind)
                };
                host.set_open_select(next, cx);
            });
        })
        .child(
            glyph(
                select.icon.path(),
                CONTROL_ICON,
                if open { active } else { ink },
            )
            .group_hover(group.clone(), move |style| style.text_color(active)),
        )
        .child(label)
        .child(
            glyph(
                "icons/chevron-down.svg",
                CONTROL_ICON,
                if open { active } else { ink },
            )
            .opacity(CHEVRON_OPACITY)
            .group_hover(group, move |style| style.text_color(active)),
        )
        .child(anchor(Some(kind)))
        .into_any_element()
}

fn branch_control(
    branch: &BranchSelectorView,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    let ink = fade(t.muted_foreground, MUTED_TEXT_OPACITY);
    let hover_ink = fade(t.foreground, BRANCH_HOVER_TEXT_OPACITY);
    let accent = t.accent;
    let open = branch.menu.is_some();
    let disabled = branch.disabled;
    let group = SharedString::from("branch-toolbar-branch-trigger");
    let toggle = client.clone();
    let menu_client = client.clone();
    let active_branch = branch.active_branch.clone();
    div()
        .id("branch-toolbar-branch-wrapper")
        .flex()
        .min_w_0()
        .on_mouse_down(MouseButton::Right, move |event: &MouseDownEvent, _, cx| {
            cx.stop_propagation();
            send(
                &menu_client,
                cx,
                "branchToolbarBranchContextMenu",
                json!({
                    "branch": active_branch,
                    "x": f32::from(event.position.x),
                    "y": f32::from(event.position.y),
                }),
            );
        })
        .child(
            div()
                .id("branch-toolbar-branch")
                .group(group.clone())
                .relative()
                .flex()
                .min_w_0()
                .items_center()
                .gap(px(BRANCH_GAP))
                .h(px(CONTROL_HEIGHT))
                .px(px(BRANCH_PADDING_X))
                .rounded(px(CONTROL_RADIUS))
                .text_color(ink)
                .when(open, |this| this.bg(accent))
                .when(disabled, |this| this.opacity(DISABLED_OPACITY))
                .when(!disabled, |this| {
                    this.cursor_pointer()
                        .hover(move |style| style.bg(accent).text_color(hover_ink))
                        .on_click(move |_, _, cx| {
                            send(
                                &toggle,
                                cx,
                                "branchToolbarBranchMenu",
                                json!({ "open": !open }),
                            );
                        })
                })
                .child(
                    glyph("icons/git-branch.svg", CONTROL_ICON, ink)
                        .opacity(BRANCH_ICON_OPACITY)
                        .when(!disabled, |this| {
                            this.group_hover(group.clone(), move |style| {
                                style.text_color(hover_ink)
                            })
                        }),
                )
                .child(
                    div()
                        .flex()
                        .min_w_0()
                        .max_w(px(LABEL_MAX_WIDTH))
                        .child(middle_truncate(&branch.label, &branch.truncation)),
                )
                .child(
                    glyph("icons/chevron-down.svg", CONTROL_ICON, ink)
                        .opacity(CHEVRON_OPACITY)
                        .when(!disabled, |this| {
                            this.group_hover(group.clone(), move |style| {
                                style.text_color(hover_ink)
                            })
                        }),
                )
                .child(anchor(None)),
        )
        .into_any_element()
}

impl Render for BranchToolbarHost {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.view(cx) else {
            return div();
        };
        let search_focused = self.search.read(cx).focus_handle(cx).is_focused(window);
        let select = self.select_menu(&view, window, cx);
        let menu = view
            .branch
            .as_ref()
            .and_then(|branch| branch.menu.as_ref())
            .map(|menu| self.branch_menu(menu, search_focused, cx));
        div().children(select).children(menu)
    }
}
