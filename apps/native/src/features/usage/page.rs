use std::cell::{Cell, RefCell};
use std::collections::{HashMap, VecDeque};
use std::rc::Rc;
use std::time::{Duration, Instant};

use gpui::component::input::{InputEvent, InputState};
use gpui::prelude::FluentBuilder;
use gpui::{
    Animation, AnimationExt, AnyElement, App, AppContext, Bounds, Context, Entity, FocusHandle,
    InteractiveElement, IntoElement, KeyDownEvent, MouseButton, ParentElement, Pixels, Render,
    ScrollHandle, SharedString, StatefulInteractiveElement, Styled, Subscription, Transformation,
    Window, canvas, div, percentage, px, svg,
};
use serde_json::json;

use super::{act, text};
use crate::app::workspace_breadcrumb::{WorkspaceBreadcrumbItem, WorkspaceBreadcrumbSeparator};
use crate::app::workspace_page_header::WorkspacePageHeader;
use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::usage::{
    UsageContentView, UsageEnvironmentFilterView, UsageEnvironmentIndicatorView, UsagePageView,
    UsageSelectorView, UsageView,
};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::menu::{MenuCheckboxItem, MenuItem, MenuPopup, MenuSeparator};
use crate::ui::popover::Align;
use crate::ui::scroll_area::ScrollArea;
use crate::ui::select::{Select, SelectItem, SelectSize, SelectVariant};
use crate::ui::theme;
use crate::ui::theme::metrics::text as type_scale;
use crate::ui::theme::tokens::Tokens;
use crate::ui::toggle::{Toggle, ToggleVariant};
use crate::ui::toggle_group::ToggleGroup;
use crate::ui::tooltip::Tooltip;

const XL: f32 = 1280.;
const XXL: f32 = 1536.;
const SM: f32 = 640.;
const CONTAINER_MAX_WIDTH: f32 = 1024.;
const CONTAINER_PADDING_X: f32 = 24.;
const CONTAINER_PADDING_X_NARROW: f32 = 20.;
const CONTAINER_PADDING_TOP: f32 = 24.;
const CONTAINER_PADDING_BOTTOM: f32 = 48.;
const CONTAINER_GAP: f32 = 24.;
const HEADER_PADDING_Y: f32 = 8.;
const HEADER_GAP_X: f32 = 12.;
const HEADER_GAP_Y: f32 = 8.;
const HEADER_CONTROLS_GAP: f32 = 8.;
const HEADER_SELECTS_GAP: f32 = 4.;
const BREADCRUMB_GAP: f32 = 12.;
const FILTER_GAP: f32 = 2.;
const FILTER_ICON: f32 = 14.;
const REFRESH_ICON: f32 = 14.;
const REFRESH_SPIN: Duration = Duration::from_millis(1000);
const MENU_GRACE: Duration = Duration::from_millis(300);
const HOVER_OPEN_DELAY: Duration = Duration::from_millis(300);
const HOVER_CLOSE_DELAY: Duration = Duration::from_millis(150);
const MENU_NOTE_PADDING: f32 = 8.;
const MENU_NOTE_GAP: f32 = 4.;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum LocalMenu {
    Environment,
    PricesApply,
}

pub(super) struct SegmentPopover {
    pub(super) key: String,
    pub(super) anchor: String,
    pub(super) pinned: bool,
    pub(super) revealed: bool,
}

pub(super) struct PriceInput {
    pub(super) state: Entity<InputState>,
    pub(super) pending: Rc<RefCell<VecDeque<String>>>,
    _subscription: Subscription,
}

pub struct UsagePage {
    pub(super) client: Entity<CoreClient>,
    view: Entity<ViewState<Option<UsageView>>>,
    focus: FocusHandle,
    scroll: ScrollHandle,
    pub(crate) collapsed_inset: Option<f32>,
    visible: bool,
    pub(super) open_menu: Option<LocalMenu>,
    dismissed_menu: Option<(LocalMenu, Instant)>,
    pub(super) menu_bounds: Rc<RefCell<HashMap<&'static str, Bounds<Pixels>>>>,
    pub(super) segment: Option<SegmentPopover>,
    pub(super) hovered_segment: Option<String>,
    pub(super) popup_hovered: bool,
    dismissed_segment: Option<(String, Instant)>,
    pub(super) segment_bounds: Rc<RefCell<HashMap<String, Bounds<Pixels>>>>,
    pub(super) popup_height: Rc<Cell<f32>>,
    pub(super) pool_widths: Rc<RefCell<HashMap<String, f32>>>,
    pub(super) price_inputs: HashMap<String, PriceInput>,
    pub(super) focused_new_row: Option<String>,
    pub(super) suggestion_row: Option<String>,
    pub(super) prices_open: bool,
}

impl UsagePage {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<UsageView>>(&client, "usage", json!({}), cx);
        cx.observe(&view, |page, view, cx| {
            let data = view.read(cx).data.clone().flatten();
            let prices_open = data.as_ref().is_some_and(|view| view.prices.is_some());
            if data.is_none() {
                page.visible = false;
                page.open_menu = None;
                page.segment = None;
            }
            if !prices_open && page.prices_open {
                page.price_inputs.clear();
                page.focused_new_row = None;
                page.suggestion_row = None;
                if page.open_menu == Some(LocalMenu::PricesApply) {
                    page.open_menu = None;
                }
            }
            page.prices_open = prices_open;
            cx.notify();
        })
        .detach();
        Self {
            client,
            view,
            focus: cx.focus_handle(),
            scroll: ScrollHandle::new(),
            collapsed_inset: None,
            visible: false,
            open_menu: None,
            dismissed_menu: None,
            menu_bounds: Rc::new(RefCell::new(HashMap::new())),
            segment: None,
            hovered_segment: None,
            popup_hovered: false,
            dismissed_segment: None,
            segment_bounds: Rc::new(RefCell::new(HashMap::new())),
            popup_height: Rc::new(Cell::new(220.)),
            pool_widths: Rc::new(RefCell::new(HashMap::new())),
            price_inputs: HashMap::new(),
            focused_new_row: None,
            suggestion_row: None,
            prices_open: false,
        }
    }

    pub(super) fn toggle_menu(&mut self, menu: LocalMenu, cx: &mut Context<Self>) {
        let recently_dismissed = self
            .dismissed_menu
            .is_some_and(|(dismissed, at)| dismissed == menu && at.elapsed() < MENU_GRACE);
        self.dismissed_menu = None;
        self.open_menu = if self.open_menu == Some(menu) || recently_dismissed {
            None
        } else {
            Some(menu)
        };
        cx.notify();
    }

    pub(super) fn dismiss_menu(&mut self, menu: LocalMenu, cx: &mut Context<Self>) {
        if self.open_menu == Some(menu) {
            self.open_menu = None;
            self.dismissed_menu = Some((menu, Instant::now()));
            cx.notify();
        }
    }

    pub(super) fn hover_segment(
        &mut self,
        key: &str,
        anchor: &str,
        hovered: bool,
        cx: &mut Context<Self>,
    ) {
        if hovered {
            self.hovered_segment = Some(key.to_string());
            let key = key.to_string();
            let anchor = anchor.to_string();
            cx.spawn(async move |this, cx| {
                cx.background_executor().timer(HOVER_OPEN_DELAY).await;
                let _ = this.update(cx, |page, cx| {
                    let pinned_elsewhere = page
                        .segment
                        .as_ref()
                        .is_some_and(|open| open.pinned && open.key != key);
                    let already_open = page.segment.as_ref().is_some_and(|open| open.key == key);
                    if page.hovered_segment.as_deref() == Some(key.as_str())
                        && !pinned_elsewhere
                        && !already_open
                    {
                        page.segment = Some(SegmentPopover {
                            key,
                            anchor,
                            pinned: false,
                            revealed: false,
                        });
                        page.popup_hovered = false;
                        cx.notify();
                    }
                });
            })
            .detach();
            return;
        }
        if self.hovered_segment.as_deref() == Some(key) {
            self.hovered_segment = None;
        }
        self.schedule_segment_close(cx);
    }

    pub(super) fn hover_popup(&mut self, hovered: bool, cx: &mut Context<Self>) {
        self.popup_hovered = hovered;
        if !hovered {
            self.schedule_segment_close(cx);
        }
    }

    fn schedule_segment_close(&mut self, cx: &mut Context<Self>) {
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(HOVER_CLOSE_DELAY).await;
            let _ = this.update(cx, |page, cx| {
                let Some(open) = page.segment.as_ref() else {
                    return;
                };
                if !open.pinned
                    && !page.popup_hovered
                    && page.hovered_segment.as_deref() != Some(open.key.as_str())
                {
                    page.segment = None;
                    cx.notify();
                }
            });
        })
        .detach();
    }

    pub(super) fn click_segment(&mut self, key: &str, anchor: &str, cx: &mut Context<Self>) {
        let recently_dismissed = self
            .dismissed_segment
            .as_ref()
            .is_some_and(|(dismissed, at)| dismissed == key && at.elapsed() < MENU_GRACE);
        self.dismissed_segment = None;
        let pinned_here = self
            .segment
            .as_ref()
            .is_some_and(|open| open.key == key && open.pinned);
        if pinned_here || recently_dismissed {
            self.segment = None;
        } else {
            let revealed = self
                .segment
                .as_ref()
                .filter(|open| open.key == key)
                .is_some_and(|open| open.revealed);
            self.segment = Some(SegmentPopover {
                key: key.to_string(),
                anchor: anchor.to_string(),
                pinned: true,
                revealed,
            });
        }
        cx.notify();
    }

    pub(super) fn dismiss_segment(&mut self, cx: &mut Context<Self>) {
        if let Some(open) = self.segment.take() {
            self.dismissed_segment = Some((open.key, Instant::now()));
            self.popup_hovered = false;
            cx.notify();
        }
    }

    pub(super) fn toggle_email(&mut self, cx: &mut Context<Self>) {
        if let Some(open) = self.segment.as_mut() {
            open.revealed = !open.revealed;
            open.pinned = true;
            cx.notify();
        }
    }

    pub(super) fn price_input(
        &mut self,
        key: String,
        placeholder: &str,
        value: &str,
        on_change: impl Fn(&Entity<CoreClient>, String, &mut App) + 'static,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<InputState> {
        if let Some(input) = self.price_inputs.get(&key) {
            let state = input.state.clone();
            let current = state.read(cx).value().to_string();
            let mut pending = input.pending.borrow_mut();
            if let Some(index) = pending.iter().position(|sent| sent == value) {
                pending.drain(..=index);
            } else if pending.is_empty() && current != value {
                let value = value.to_string();
                state.update(cx, |state, cx| state.set_value(value, window, cx));
            }
            drop(pending);
            let placeholder = SharedString::from(placeholder.to_string());
            state.update(cx, |state, cx| {
                state.set_placeholder(placeholder, window, cx)
            });
            return state;
        }
        let initial = value.to_string();
        let placeholder = SharedString::from(placeholder.to_string());
        let state = cx.new(|cx| {
            let mut state = InputState::new(window, cx).placeholder(placeholder);
            state.set_value(initial, window, cx);
            state
        });
        let pending: Rc<RefCell<VecDeque<String>>> = Rc::new(RefCell::new(VecDeque::new()));
        let queue = pending.clone();
        let client = self.client.clone();
        let subscription = cx.subscribe_in(
            &state,
            window,
            move |_, state, event: &InputEvent, _, cx| {
                if let InputEvent::Change = event {
                    let value = state.read(cx).value().to_string();
                    queue.borrow_mut().push_back(value.clone());
                    on_change(&client, value, cx);
                }
            },
        );
        self.price_inputs.insert(
            key,
            PriceInput {
                state: state.clone(),
                pending,
                _subscription: subscription,
            },
        );
        state
    }

    fn header(
        &mut self,
        page: &UsagePageView,
        width: f32,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let wide = width >= XL;
        let breadcrumb = div()
            .flex()
            .min_w_0()
            .items_center()
            .gap(px(BREADCRUMB_GAP))
            .text_size(px(type_scale::SM))
            .line_height(px(type_scale::SM_LINE))
            .child(WorkspaceBreadcrumbItem::new(false).child(page.title.clone()))
            .child(WorkspaceBreadcrumbSeparator)
            .child(
                WorkspaceBreadcrumbItem::new(true)
                    .shrink()
                    .child(self.environment_filter(&page.environment_filter, t, cx)),
            );
        let refresh = self.refresh_button(page, t);
        let content = if wide {
            div()
                .flex()
                .w_full()
                .min_w_0()
                .items_center()
                .gap_x(px(HEADER_GAP_X))
                .py(px(HEADER_PADDING_Y))
                .child(breadcrumb.flex_shrink(1.))
                .when_some(
                    page.window_label.clone().filter(|_| width >= XXL),
                    |this, label| {
                        this.child(
                            text(type_scale::XS, type_scale::XS_LINE)
                                .min_w_0()
                                .truncate()
                                .text_color(t.muted_foreground)
                                .child(label),
                        )
                    },
                )
                .child(
                    div()
                        .ml_auto()
                        .flex()
                        .flex_none()
                        .min_w_0()
                        .items_center()
                        .justify_end()
                        .gap(px(HEADER_CONTROLS_GAP))
                        .child(self.toggles("usage-metric", &page.metric, "usageSelectMetric"))
                        .child(self.toggles("usage-period", &page.period, "usageSelectWindow"))
                        .child(refresh),
                )
                .into_any_element()
        } else {
            div()
                .flex()
                .flex_col()
                .w_full()
                .min_w_0()
                .gap_y(px(HEADER_GAP_Y))
                .py(px(HEADER_PADDING_Y))
                .child(breadcrumb)
                .child(
                    div()
                        .flex()
                        .min_w_0()
                        .items_center()
                        .justify_end()
                        .gap(px(HEADER_SELECTS_GAP))
                        .child(self.select(
                            "usage-metric-select",
                            &page.metric,
                            "usageSelectMetric",
                        ))
                        .child(self.select(
                            "usage-period-select",
                            &page.period,
                            "usageSelectWindow",
                        ))
                        .child(refresh),
                )
                .into_any_element()
        };
        WorkspacePageHeader::new()
            .collapsed_sidebar_inset(self.collapsed_inset)
            .auto_height(true)
            .child(content)
            .into_any_element()
    }

    fn toggles(
        &self,
        id: &'static str,
        selector: &UsageSelectorView,
        action: &'static str,
    ) -> AnyElement {
        let disabled = selector.disabled;
        ToggleGroup::new(id)
            .variant(ToggleVariant::Segmented)
            .items(selector.options.iter().map(|option| {
                let client = self.client.clone();
                let value = option.value.clone();
                let key = if action == "usageSelectMetric" {
                    "metric"
                } else {
                    "days"
                };
                Toggle::new(SharedString::from(format!("{id}-{}", option.key)))
                    .label(option.label.clone())
                    .pressed(option.selected)
                    .disabled(disabled)
                    .accessibility_label(option.title.clone())
                    .on_change(move |_, _, _, cx| {
                        act(&client, cx, action, json!({ key: value.clone() }));
                    })
            }))
            .into_any_element()
    }

    fn select(
        &self,
        id: &'static str,
        selector: &UsageSelectorView,
        action: &'static str,
    ) -> AnyElement {
        let client = self.client.clone();
        let options = selector.options.clone();
        let key = if action == "usageSelectMetric" {
            "metric"
        } else {
            "days"
        };
        Select::new(id)
            .variant(SelectVariant::Ghost)
            .size(SelectSize::Compact)
            .align(Align::End)
            .match_trigger_width(false)
            .disabled(selector.disabled)
            .accessibility_label(selector.aria_label.clone())
            .value(Some(selector.value.clone()))
            .items(
                selector
                    .options
                    .iter()
                    .map(|option| SelectItem::new(option.key.clone(), option.label.clone())),
            )
            .on_change(move |value, _, cx| {
                if let Some(option) = options.iter().find(|option| option.key == value.as_ref()) {
                    act(&client, cx, action, json!({ key: option.value.clone() }));
                }
            })
            .into_any_element()
    }

    fn refresh_button(&self, page: &UsagePageView, t: &Tokens) -> AnyElement {
        let client = self.client.clone();
        let glyph = svg()
            .path("icons/refresh-cw.svg")
            .size(px(REFRESH_ICON))
            .text_color(t.muted_foreground);
        let glyph = if page.refresh.busy {
            glyph
                .with_animation(
                    "usage-refresh-spin",
                    Animation::new(REFRESH_SPIN).repeat(),
                    |svg, delta| svg.with_transformation(Transformation::rotate(percentage(delta))),
                )
                .into_any_element()
        } else {
            glyph.into_any_element()
        };
        Button::new("usage-refresh")
            .variant(ButtonVariant::Ghost)
            .size(ButtonSize::IconSm)
            .flex_none()
            .disabled(page.refresh.disabled)
            .accessibility_label(page.refresh.aria_label.clone())
            .child(glyph)
            .on_click(move |_, _, cx| act(&client, cx, "usageRefresh", json!({})))
            .into_any_element()
    }

    fn environment_filter(
        &mut self,
        filter: &UsageEnvironmentFilterView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let open = self.open_menu == Some(LocalMenu::Environment);
        let page = cx.entity().downgrade();
        let bounds = self.menu_bounds.clone();
        let indicator = match &filter.indicator {
            UsageEnvironmentIndicatorView::Scanning { sr_label } => div()
                .id("usage-environment-scanning")
                .tooltip(Tooltip::text(sr_label.clone()))
                .child(
                    svg()
                        .path("icons/circle-dashed.svg")
                        .size(px(FILTER_ICON))
                        .text_color(t.muted_foreground),
                )
                .into_any_element(),
            UsageEnvironmentIndicatorView::Issue { aria_label } => div()
                .id("usage-environment-issue")
                .tooltip(Tooltip::text(aria_label.clone()))
                .child(
                    svg()
                        .path("icons/circle-alert.svg")
                        .size(px(FILTER_ICON))
                        .text_color(t.warning_foreground),
                )
                .into_any_element(),
            UsageEnvironmentIndicatorView::Chevron => svg()
                .path("icons/chevron-down.svg")
                .size(px(FILTER_ICON))
                .text_color(t.muted_foreground)
                .group_hover("usage-environment", |style| style.opacity(1.))
                .opacity(if open { 1. } else { 0. })
                .into_any_element(),
        };
        let trigger = div()
            .id("usage-environment-trigger")
            .group("usage-environment")
            .flex()
            .min_w_0()
            .max_w_full()
            .items_center()
            .gap(px(FILTER_GAP))
            .cursor_pointer()
            .font_weight(gpui::FontWeight::MEDIUM)
            .text_color(t.foreground)
            .hover(|style| style.underline())
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_click(move |_, _, cx| {
                let _ = page.update(cx, |page, cx| page.toggle_menu(LocalMenu::Environment, cx));
            })
            .child(div().min_w_0().truncate().child(filter.label.clone()))
            .child(
                div()
                    .flex()
                    .flex_none()
                    .size(px(FILTER_ICON))
                    .items_center()
                    .justify_center()
                    .child(indicator),
            )
            .child(
                canvas(
                    move |trigger, _, _| {
                        bounds.borrow_mut().insert("environment", trigger);
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .inset_0()
                .size_full(),
            );
        div()
            .relative()
            .flex()
            .min_w_0()
            .child(trigger)
            .when(open, |this| {
                this.child(self.environment_menu(filter, t, cx))
            })
            .into_any_element()
    }

    fn environment_menu(
        &self,
        filter: &UsageEnvironmentFilterView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let trigger = self
            .menu_bounds
            .borrow()
            .get("environment")
            .copied()
            .unwrap_or_default();
        let dismiss = cx.entity().downgrade();
        let all_client = self.client.clone();
        let all_checked = filter.all_selected;
        let prices_page = cx.entity().downgrade();
        let prices_client = self.client.clone();
        let note = |message: &String| {
            text(type_scale::XS, type_scale::XS_LINE)
                .p(px(MENU_NOTE_PADDING))
                .text_color(t.muted_foreground)
                .child(message.clone())
        };
        MenuPopup::new("usage-environment-menu", trigger)
            .align(Align::Start)
            .on_dismiss(move |_, cx| {
                let _ =
                    dismiss.update(cx, |page, cx| page.dismiss_menu(LocalMenu::Environment, cx));
            })
            .child(
                MenuCheckboxItem::new("usage-environment-all", filter.all_label.clone())
                    .checked(filter.all_selected)
                    .on_click(move |_, _, cx| {
                        act(
                            &all_client,
                            cx,
                            "usageSelectAllEnvironments",
                            json!({ "checked": !all_checked }),
                        );
                    }),
            )
            .child(MenuSeparator)
            .children(filter.items.iter().map(|item| {
                let client = self.client.clone();
                let environment_id = item.environment_id.clone();
                let checked = item.checked;
                MenuCheckboxItem::new(
                    SharedString::from(format!("usage-environment-{}", item.environment_id)),
                    item.label.clone(),
                )
                .checked(item.checked)
                .when_some(item.status.clone(), |this, status| {
                    this.status(
                        status,
                        if item.status_tone == "error" {
                            t.destructive_foreground
                        } else {
                            t.muted_foreground
                        },
                    )
                })
                .on_click(move |_, _, cx| {
                    act(
                        &client,
                        cx,
                        "usageToggleEnvironment",
                        json!({ "environmentId": environment_id, "checked": !checked }),
                    );
                })
            }))
            .children(filter.empty_message.as_ref().map(note))
            .children(filter.partial_message.as_ref().map(note))
            .when(!filter.coverage_notices.is_empty(), |this| {
                this.child(
                    text(type_scale::XS, type_scale::XS_LINE)
                        .flex()
                        .flex_col()
                        .gap(px(MENU_NOTE_GAP))
                        .p(px(MENU_NOTE_PADDING))
                        .border_t_1()
                        .border_color(t.border)
                        .text_color(t.muted_foreground)
                        .children(filter.coverage_notices.iter().cloned()),
                )
            })
            .child(MenuSeparator)
            .child(
                MenuItem::new("usage-model-prices")
                    .icon("sliders-horizontal")
                    .label(filter.model_prices_label.clone())
                    .on_click(move |_, _, cx| {
                        let _ = prices_page.update(cx, |page, cx| {
                            page.open_menu = None;
                            cx.notify();
                        });
                        act(&prices_client, cx, "usagePricesOpen", json!({}));
                    }),
            )
            .into_any_element()
    }

    fn body(
        &mut self,
        view: &UsageView,
        width: f32,
        t: &Tokens,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let content = match &view.page.content {
            UsageContentView::NoEnvironment { message } => {
                text(type_scale::SM, type_scale::SM_LINE)
                    .text_color(t.muted_foreground)
                    .child(message.clone())
                    .into_any_element()
            }
            UsageContentView::Limits {
                limits,
                cursor_prompt,
            } => self.limits_content(view, limits, cursor_prompt.as_ref(), width, t, cx),
            UsageContentView::Loading {
                providers,
                totals_title,
                total_labels,
                breakdown_title,
            } => super::content::skeleton(
                providers,
                totals_title,
                total_labels,
                breakdown_title,
                width,
                t,
            ),
            UsageContentView::Usage(data) => self.usage_content(view, data, width, t, window, cx),
        };
        let padding_x = if width >= SM {
            CONTAINER_PADDING_X
        } else {
            CONTAINER_PADDING_X_NARROW
        };
        ScrollArea::new("usage-page-scroll")
            .track_scroll(&self.scroll)
            .flex_1()
            .min_h_0()
            .child(
                div().flex().w_full().justify_center().child(
                    div()
                        .flex()
                        .flex_col()
                        .w_full()
                        .max_w(px(CONTAINER_MAX_WIDTH))
                        .px(px(padding_x))
                        .pt(px(CONTAINER_PADDING_TOP))
                        .pb(px(CONTAINER_PADDING_BOTTOM))
                        .gap(px(CONTAINER_GAP))
                        .child(content),
                ),
            )
            .into_any_element()
    }
}

impl Render for UsagePage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = theme::active(cx);
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return div().size_full().bg(t.background).into_any_element();
        };
        if !self.visible {
            self.visible = true;
            self.focus.focus(window, cx);
        }
        let width = f32::from(window.viewport_size().width);
        let header = self.header(&view.page, width, &t, cx);
        let body = self.body(&view, width, &t, window, cx);
        let prices = view
            .prices
            .as_ref()
            .map(|prices| self.prices_dialog(prices, &t, window, cx));
        let reset = view
            .reset_confirm
            .as_ref()
            .map(|confirm| super::limits::reset_dialog(&self.client, confirm));
        let client = self.client.clone();
        let focus = self.focus.clone();
        let mouse_focus = self.focus.clone();
        let page = cx.entity().downgrade();
        div()
            .id("usage-page")
            .track_focus(&self.focus)
            .flex()
            .flex_col()
            .flex_1()
            .size_full()
            .min_w_0()
            .min_h_0()
            .bg(t.background)
            .text_color(t.foreground)
            .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                if !mouse_focus.contains_focused(window, cx) {
                    mouse_focus.focus(window, cx);
                }
            })
            .on_key_down(move |event: &KeyDownEvent, window, cx| {
                let keystroke = &event.keystroke;
                if keystroke.key == "escape" {
                    let closed = page
                        .update(cx, |page, cx| {
                            let had_popup = page.open_menu.is_some() || page.segment.is_some();
                            page.open_menu = None;
                            page.segment = None;
                            cx.notify();
                            had_popup
                        })
                        .unwrap_or(false);
                    if closed {
                        cx.stop_propagation();
                        return;
                    }
                }
                let local_popup = page
                    .read_with(cx, |page, _| {
                        page.open_menu.is_some() || page.segment.is_some()
                    })
                    .unwrap_or(false);
                if !focus.contains_focused(window, cx) || local_popup {
                    return;
                }
                let modifiers = keystroke.modifiers;
                act(
                    &client,
                    cx,
                    "usageKey",
                    json!({
                        "event": {
                            "key": keystroke.key.clone(),
                            "code": "",
                            "metaKey": modifiers.platform,
                            "ctrlKey": modifiers.control,
                            "altKey": modifiers.alt,
                            "shiftKey": modifiers.shift,
                        },
                        "repeat": event.is_held,
                    }),
                );
            })
            .child(header)
            .child(body)
            .children(prices)
            .children(reset)
            .into_any_element()
    }
}
