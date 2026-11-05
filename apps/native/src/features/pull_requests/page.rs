use std::rc::Rc;

use gpui::component::input::{InputEvent, InputState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, AppContext, Context, Entity, FocusHandle, InteractiveElement, IntoElement,
    KeyDownEvent, KeystrokeEvent, ParentElement, Render, ScrollHandle, SharedString, Styled,
    Subscription, WeakEntity, Window, canvas, div, linear_color_stop, linear_gradient, px,
};
use serde_json::json;

use crate::app::workspace_breadcrumb::{
    WorkspaceBreadcrumb, WorkspaceBreadcrumbItem, WorkspaceBreadcrumbSeparator,
    WorkspaceBreadcrumbText,
};
use crate::app::workspace_page_header::WorkspacePageHeader;
use crate::app_core::client::CoreClient;
use crate::app_core::views::pull_requests::{
    PullRequestCompactMenuModel, PullRequestGroupModel, PullRequestPopoverView,
    PullRequestsBodyModel, PullRequestsPageView, PullRequestsSearchFocusTarget,
};
use crate::features::chat::header_toolbar::toggle;
use crate::features::chat::toolbar_parts::act;
use crate::features::pull_requests::filters::{
    CompactMenu, FILTERS_ANCHOR, FilterSub, FiltersMenuContext, compact_popup, compact_trigger,
    filters_popup, filters_trigger, search_field,
};
use crate::features::pull_requests::popovers::pull_request_popover;
use crate::features::pull_requests::presentation::refresh_icon;
use crate::features::pull_requests::row::{
    AnchorBounds, GROUP_GAP, GROUP_HEADER_HEIGHT, ROW_GAP, ROW_HEIGHT, RowContext, group_header,
    pull_request_row,
};
use crate::features::pull_requests::states::{
    error_banner, footer, list_empty, list_ghost, unavailable,
};
use crate::features::right_panel::panel::RightPanel;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::scroll_area::ScrollArea;
use crate::ui::theme;
use crate::ui::theme::color::hsla;
use crate::ui::theme::metrics::workspace;
use crate::ui::theme::tokens::{Tokens, fade};

const CONTAINER_MAX_WIDTH: f32 = 1152.;
const CONTAINER_PADDING_X: f32 = 24.;
const CONTAINER_PADDING_TOP: f32 = 24.;
const CONTAINER_PADDING_BOTTOM: f32 = 48.;
const CONTAINER_GAP: f32 = 16.;
const SCROLLBAR_GUTTER: f32 = 6.;
const BAR_GAP: f32 = 8.;
const WIDE_COLUMN: f32 = 512.;
const VISIBILITY_MARGIN: f32 = 480.;
const ROW_PITCH: f32 = ROW_HEIGHT + ROW_GAP;
const META_INSET: f32 = 48.;
const CONDENSED_ITEM_GAP: f32 = 6.;
const CONDENSED_SEARCH_WIDTH: f32 = 224.;
const CONDENSED_SEARCH_MIN: f32 = 96.;
const PANEL_RESERVE: f32 = 20.;
const TOGGLE_RIGHT: f32 = workspace::CONTROLS_INSET + 1.;
const REFRESH_ICON: f32 = 16.;

#[derive(Clone, Copy, PartialEq, Eq)]
enum SearchSlot {
    Inline,
    Condensed,
}

struct Inputs {
    inline: Entity<InputState>,
    condensed: Entity<InputState>,
    author: Entity<InputState>,
}

pub struct PullRequestsPage {
    client: Entity<CoreClient>,
    right_panel: Entity<RightPanel>,
    data: Option<Rc<PullRequestsPageView>>,
    popover: Option<Rc<PullRequestPopoverView>>,
    pub(crate) collapsed_inset: Option<f32>,
    focus: FocusHandle,
    scroll: ScrollHandle,
    inputs: Option<Inputs>,
    applied_search_revision: Option<u64>,
    applied_placeholder: String,
    applied_focus_revision: Option<Option<u64>>,
    shown: bool,
    condensed: bool,
    search_open: bool,
    condensed_search_focused: bool,
    menu: Option<CompactMenu>,
    sub: Option<FilterSub>,
    bounds: AnchorBounds,
    column_width: f32,
    body_top: f32,
    body_width: f32,
    visible_rows: Option<Vec<String>>,
    activation: Option<Subscription>,
    _subscriptions: Vec<Subscription>,
}

impl PullRequestsPage {
    pub fn new(
        client: Entity<CoreClient>,
        right_panel: Entity<RightPanel>,
        cx: &mut Context<Self>,
    ) -> Self {
        let view = CoreClient::subscribe::<Option<PullRequestsPageView>>(
            &client,
            "pullRequestsPage",
            json!({}),
            cx,
        );
        let popover = CoreClient::subscribe::<Option<PullRequestPopoverView>>(
            &client,
            "pullRequestPopover",
            json!({}),
            cx,
        );
        let view_subscription = cx.observe(&view, |page, view, cx| {
            let data = view.update(cx, |state, _| state.data.take());
            page.data = data.flatten().map(Rc::new);
            cx.notify();
        });
        let popover_subscription = cx.observe(&popover, |page, popover, cx| {
            let data = popover.update(cx, |state, _| state.data.take());
            page.popover = data.flatten().map(Rc::new);
            cx.notify();
        });
        let keystrokes = cx
            .observe_keystrokes(|page, event: &KeystrokeEvent, _, cx| page.on_keystroke(event, cx));
        cx.observe(&right_panel, |_, _, cx| cx.notify()).detach();
        Self {
            client,
            right_panel,
            data: None,
            popover: None,
            collapsed_inset: None,
            focus: cx.focus_handle(),
            scroll: ScrollHandle::new(),
            inputs: None,
            applied_search_revision: None,
            applied_placeholder: String::new(),
            applied_focus_revision: None,
            shown: false,
            condensed: false,
            search_open: false,
            condensed_search_focused: false,
            menu: None,
            sub: None,
            bounds: AnchorBounds::default(),
            column_width: 0.,
            body_top: 0.,
            body_width: 0.,
            visible_rows: None,
            activation: None,
            _subscriptions: vec![view_subscription, popover_subscription, keystrokes],
        }
    }

    fn on_keystroke(&mut self, event: &KeystrokeEvent, cx: &mut Context<Self>) {
        if self.data.is_none() {
            return;
        }
        act(&self.client, cx, "liveRefreshInteraction", json!({}));
        let keystroke = &event.keystroke;
        let modifiers = keystroke.modifiers;
        if !modifiers.platform && !modifiers.control {
            return;
        }
        act(
            &self.client,
            cx,
            "pullRequestsKeyDown",
            json!({
                "key": keystroke.key,
                "metaKey": modifiers.platform,
                "ctrlKey": modifiers.control,
                "shiftKey": modifiers.shift,
                "altKey": modifiers.alt,
                "repeat": false,
                "condensed": self.condensed,
            }),
        );
    }

    fn on_escape(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        let filters_open = self.data.as_ref().is_some_and(|view| view.filters_open);
        if filters_open {
            self.sub = None;
            act(
                &self.client,
                cx,
                "pullRequestsFiltersOpen",
                json!({ "open": false }),
            );
            cx.notify();
            return true;
        }
        if self.menu.take().is_some() {
            cx.notify();
            return true;
        }
        if self.popover.is_some() {
            act(&self.client, cx, "pullRequestPopoverClose", json!({}));
            return true;
        }
        if !self.focus.is_focused(window) {
            return false;
        }
        act(&self.client, cx, "pullRequestsEscape", json!({}));
        true
    }

    pub(crate) fn toggle_menu(&mut self, menu: CompactMenu, cx: &mut Context<Self>) {
        self.menu = if self.menu == Some(menu) {
            None
        } else {
            Some(menu)
        };
        cx.notify();
    }

    pub(crate) fn close_menu(&mut self, cx: &mut Context<Self>) {
        self.menu = None;
        cx.notify();
    }

    pub(crate) fn open_sub(
        &mut self,
        sub: Option<FilterSub>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.sub == sub {
            return;
        }
        self.sub = sub;
        if sub == Some(FilterSub::Author)
            && let (Some(inputs), Some(view)) = (self.inputs.as_ref(), self.data.as_ref())
        {
            let query = view.author_query.clone();
            let placeholder = view.model.filters_menu.author.search_placeholder.clone();
            inputs.author.update(cx, |state, cx| {
                state.set_placeholder(placeholder, window, cx);
                state.set_value(query, window, cx);
                state.focus(window, cx);
            });
        }
        cx.notify();
    }

    fn ensure_inputs(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.inputs.is_some() {
            return;
        }
        let inline = cx.new(|cx| InputState::new(window, cx));
        let condensed = cx.new(|cx| InputState::new(window, cx));
        let author = cx.new(|cx| InputState::new(window, cx));
        for (slot, state) in [
            (SearchSlot::Inline, &inline),
            (SearchSlot::Condensed, &condensed),
        ] {
            cx.subscribe_in(
                state,
                window,
                move |page, state, event: &InputEvent, window, cx| {
                    page.on_search_event(slot, state, event, window, cx)
                },
            )
            .detach();
        }
        let author_client = self.client.clone();
        cx.subscribe_in(
            &author,
            window,
            move |_, state, event: &InputEvent, _, cx| {
                if let InputEvent::Change = event {
                    let query = state.read(cx).value().to_string();
                    act(
                        &author_client,
                        cx,
                        "pullRequestsSetAuthorQuery",
                        json!({ "query": query }),
                    );
                }
            },
        )
        .detach();
        self.inputs = Some(Inputs {
            inline,
            condensed,
            author,
        });
    }

    fn on_search_event(
        &mut self,
        slot: SearchSlot,
        state: &Entity<InputState>,
        event: &InputEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(inputs) = self.inputs.as_ref() else {
            return;
        };
        let other = match slot {
            SearchSlot::Inline => inputs.condensed.clone(),
            SearchSlot::Condensed => inputs.inline.clone(),
        };
        match event {
            InputEvent::Change => {
                let value = state.read(cx).value().to_string();
                if other.read(cx).value() != value.as_str() {
                    let mirrored = value.clone();
                    other.update(cx, |other, cx| other.set_value(mirrored, window, cx));
                }
                act(
                    &self.client,
                    cx,
                    "pullRequestsSetQuery",
                    json!({ "query": value }),
                );
            }
            InputEvent::Focus if slot == SearchSlot::Condensed => {
                self.condensed_search_focused = true;
            }
            InputEvent::Blur if slot == SearchSlot::Condensed => {
                self.condensed_search_focused = false;
                if state.read(cx).value().is_empty() {
                    self.search_open = false;
                    cx.notify();
                }
            }
            _ => {}
        }
    }

    fn sync(&mut self, view: &PullRequestsPageView, window: &mut Window, cx: &mut Context<Self>) {
        if !self.shown {
            self.shown = true;
            window.focus(&self.focus, cx);
        }
        let Some((inline, condensed)) = self
            .inputs
            .as_ref()
            .map(|inputs| (inputs.inline.clone(), inputs.condensed.clone()))
        else {
            return;
        };
        let search = &view.model.search;
        if self.applied_search_revision != Some(view.search_revision) {
            self.applied_search_revision = Some(view.search_revision);
            for state in [&inline, &condensed] {
                let value = search.value.clone();
                state.update(cx, |state, cx| {
                    if state.value() != value.as_str() {
                        state.set_value(value, window, cx);
                    }
                });
            }
        }
        if self.applied_placeholder != search.placeholder {
            self.applied_placeholder = search.placeholder.clone();
            for state in [&inline, &condensed] {
                let placeholder = search.placeholder.clone();
                state.update(cx, |state, cx| {
                    state.set_placeholder(placeholder, window, cx)
                });
            }
        }
        let focus_revision = view.search_focus.as_ref().map(|focus| focus.revision);
        match self.applied_focus_revision {
            None => self.applied_focus_revision = Some(focus_revision),
            Some(applied) if applied != focus_revision => {
                self.applied_focus_revision = Some(focus_revision);
                if let Some(focus) = view.search_focus.as_ref() {
                    let target = match focus.target {
                        PullRequestsSearchFocusTarget::Inline => inline,
                        PullRequestsSearchFocusTarget::Condensed => {
                            self.search_open = true;
                            condensed
                        }
                    };
                    target.update(cx, |state, cx| {
                        state.focus(window, cx);
                        state.select_all(window, cx);
                    });
                }
            }
            Some(_) => {}
        }
    }

    fn set_condensed(&mut self, condensed: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.condensed == condensed {
            return;
        }
        self.condensed = condensed;
        if !condensed {
            self.search_open = false;
            if self.condensed_search_focused
                && let Some(inputs) = self.inputs.as_ref()
            {
                self.condensed_search_focused = false;
                let value = inputs.condensed.read(cx).value().to_string();
                inputs.inline.update(cx, |state, cx| {
                    state.set_value(value, window, cx);
                    state.focus(window, cx);
                });
            }
        }
        cx.notify();
    }

    fn open_condensed_search(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.search_open = true;
        if let Some(inputs) = self.inputs.as_ref() {
            inputs
                .condensed
                .update(cx, |state, cx| state.focus(window, cx));
        }
        cx.notify();
    }

    fn refresh_button(
        &self,
        id: &'static str,
        view: &PullRequestsPageView,
        compact: bool,
        t: &Tokens,
    ) -> AnyElement {
        let client = self.client.clone();
        let refresh = &view.model.refresh;
        Button::new(id)
            .variant(if compact {
                ButtonVariant::Ghost
            } else {
                ButtonVariant::Outline
            })
            .size(if compact {
                ButtonSize::IconSm
            } else {
                ButtonSize::Icon
            })
            .disabled(refresh.disabled)
            .accessibility_label(refresh.label.clone())
            .child(refresh_icon(
                SharedString::from(format!("{id}-spin")),
                REFRESH_ICON,
                t.muted_foreground,
                refresh.refreshing,
            ))
            .on_click(move |_, _, cx| act(&client, cx, "pullRequestsRefresh", json!({})))
            .into_any_element()
    }

    fn compact(
        &self,
        menu: CompactMenu,
        model: Option<&PullRequestCompactMenuModel>,
        view: &PullRequestsPageView,
        page: &WeakEntity<Self>,
        cx: &Context<Self>,
    ) -> Option<AnyElement> {
        model.map(|model| {
            compact_trigger(
                menu,
                model,
                self.menu == Some(menu),
                page,
                &self.bounds,
                &view.project_icons,
                cx,
            )
        })
    }

    fn header(
        &self,
        view: &PullRequestsPageView,
        page: &WeakEntity<Self>,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> impl IntoElement {
        let model = &view.model;
        let condensed_value_present = self
            .inputs
            .as_ref()
            .is_some_and(|inputs| !inputs.condensed.read(cx).value().is_empty());
        let search_expanded = self.search_open || condensed_value_present;
        let breadcrumb = if self.condensed {
            WorkspaceBreadcrumb::new()
                .when(!search_expanded, |this| {
                    this.child(
                        WorkspaceBreadcrumbItem::new(true)
                            .child(WorkspaceBreadcrumbText::new(model.title.clone())),
                    )
                    .child(WorkspaceBreadcrumbSeparator)
                })
                .child(
                    WorkspaceBreadcrumbItem::new(false).shrink().child(
                        div()
                            .flex()
                            .min_w_0()
                            .items_center()
                            .gap(px(CONDENSED_ITEM_GAP))
                            .children(
                                self.compact(
                                    CompactMenu::State,
                                    model.condensed.state_menu.as_ref(),
                                    view,
                                    page,
                                    cx,
                                )
                                .map(|menu| div().flex().flex_none().child(menu)),
                            )
                            .children(self.compact(
                                CompactMenu::Involvement,
                                model.condensed.involvement_menu.as_ref(),
                                view,
                                page,
                                cx,
                            ))
                            .children(self.compact(
                                CompactMenu::Host,
                                model.condensed.host_menu.as_ref(),
                                view,
                                page,
                                cx,
                            )),
                    ),
                )
        } else {
            WorkspaceBreadcrumb::new().child(
                WorkspaceBreadcrumbItem::new(true)
                    .child(WorkspaceBreadcrumbText::new(model.title.clone())),
            )
        };
        let right = self.condensed.then(|| {
            let search = match self.inputs.as_ref() {
                Some(inputs) if search_expanded => div()
                    .flex()
                    .w(px(CONDENSED_SEARCH_WIDTH))
                    .min_w(px(CONDENSED_SEARCH_MIN))
                    .flex_shrink(1.)
                    .child(search_field(
                        &inputs.condensed,
                        model.search.busy,
                        "pr-condensed-search-spinner",
                    ))
                    .into_any_element(),
                _ => {
                    let expand = page.clone();
                    Button::new("pr-condensed-search")
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::IconSm)
                        .icon("search")
                        .accessibility_label(model.search.expand_label.clone())
                        .on_click(move |_, window, cx| {
                            let _ = expand
                                .update(cx, |page, cx| page.open_condensed_search(window, cx));
                        })
                        .into_any_element()
                }
            };
            div()
                .flex()
                .flex_shrink(1.)
                .min_w_0()
                .items_center()
                .gap(px(CONDENSED_ITEM_GAP))
                .child(search)
                .child(self.refresh_button("pr-condensed-refresh", view, true, t))
        });
        let reserve = (view.right_panel.visible && !view.right_panel_open)
            .then(|| div().flex_none().w(px(PANEL_RESERVE)));
        WorkspacePageHeader::new()
            .collapsed_sidebar_inset(self.collapsed_inset)
            .child(breadcrumb)
            .children(right)
            .children(reserve)
    }

    fn controls(
        &self,
        view: &PullRequestsPageView,
        page: &WeakEntity<Self>,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> AnyElement {
        let model = &view.model;
        let search = self.inputs.as_ref().map(|inputs| {
            div()
                .min_w_0()
                .map(|this| {
                    if self.column_width >= WIDE_COLUMN {
                        this.flex_1()
                    } else {
                        this.w_full()
                    }
                })
                .child(search_field(
                    &inputs.inline,
                    model.search.busy,
                    "pr-inline-search-spinner",
                ))
        });
        let marker_page = page.clone();
        let marker_scroll = self.scroll.clone();
        div()
            .flex()
            .flex_col()
            .flex_none()
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(px(BAR_GAP))
                    .children(search)
                    .children(self.compact(
                        CompactMenu::Sort,
                        model.sort_menu.as_ref(),
                        view,
                        page,
                        cx,
                    ))
                    .child(filters_trigger(view, &self.client, &self.bounds, cx))
                    .children(self.compact(
                        CompactMenu::Provider,
                        model.provider_menu.as_ref(),
                        view,
                        page,
                        cx,
                    ))
                    .when(!self.condensed, |this| {
                        this.child(self.refresh_button("pr-refresh", view, false, t))
                    }),
            )
            .child(
                div().relative().h(px(1.)).w_full().child(
                    canvas(
                        move |marker, window, cx| {
                            let viewport = marker_scroll.bounds();
                            let condensed = marker.bottom() <= viewport.top();
                            let _ = marker_page
                                .update(cx, |page, cx| page.set_condensed(condensed, window, cx));
                        },
                        |_, _, _, _| {},
                    )
                    .absolute()
                    .size_full(),
                ),
            )
            .into_any_element()
    }

    fn visible_window(&self) -> (f32, f32) {
        let viewport = self.scroll.bounds();
        let top = -f32::from(self.scroll.offset().y) - self.body_top;
        let height = f32::from(viewport.size.height);
        (top - VISIBILITY_MARGIN, top + height + VISIBILITY_MARGIN)
    }

    fn list(
        &self,
        groups: &[PullRequestGroupModel],
        view: &PullRequestsPageView,
        t: &Tokens,
        visible: &mut Vec<String>,
        cx: &Context<Self>,
    ) -> AnyElement {
        let (window_top, window_bottom) = self.visible_window();
        let open_anchor = self
            .popover
            .as_ref()
            .map(|popover| popover.anchor().to_string());
        let row_cx = RowContext {
            client: &self.client,
            anchors: &self.bounds,
            stack_triggers: &view.stack_triggers,
            open_anchor: open_anchor.as_deref(),
            meta_width: (self.body_width - META_INSET).max(0.),
            tokens: t,
        };
        let mut y = 0.;
        let mut children = Vec::with_capacity(groups.len());
        for (index, group) in groups.iter().enumerate() {
            if index > 0 {
                y += GROUP_GAP;
            }
            let count = group.rows.len();
            let mut items: Vec<AnyElement> = Vec::new();
            if group.show_header {
                items.push(
                    div()
                        .when(count > 0, |this| this.mb(px(ROW_GAP)))
                        .child(group_header(group, cx))
                        .into_any_element(),
                );
                y += GROUP_HEADER_HEIGHT + if count > 0 { ROW_GAP } else { 0. };
            }
            if count > 0 {
                let first = (((window_top - y - ROW_HEIGHT) / ROW_PITCH).floor() + 1.)
                    .clamp(0., count as f32) as usize;
                let end = ((window_bottom - y) / ROW_PITCH)
                    .ceil()
                    .clamp(first as f32, count as f32) as usize;
                if first == end {
                    items.push(
                        div()
                            .flex_none()
                            .h(px(count as f32 * ROW_PITCH - ROW_GAP))
                            .into_any_element(),
                    );
                } else {
                    if first > 0 {
                        items.push(
                            div()
                                .flex_none()
                                .h(px(first as f32 * ROW_PITCH))
                                .into_any_element(),
                        );
                    }
                    for (offset, row) in group.rows[first..end].iter().enumerate() {
                        visible.push(row.key.clone());
                        items.push(
                            div()
                                .flex_none()
                                .when(offset > 0, |this| this.mt(px(ROW_GAP)))
                                .child(pull_request_row(row, &row_cx))
                                .into_any_element(),
                        );
                    }
                    if end < count {
                        items.push(
                            div()
                                .flex_none()
                                .h(px((count - end) as f32 * ROW_PITCH))
                                .into_any_element(),
                        );
                    }
                }
                y += count as f32 * ROW_PITCH - ROW_GAP;
            }
            children.push(div().flex().flex_col().children(items).into_any_element());
        }
        div()
            .flex()
            .flex_col()
            .gap(px(GROUP_GAP))
            .children(children)
            .into_any_element()
    }

    fn body(
        &self,
        view: &PullRequestsPageView,
        t: &Tokens,
        visible: &mut Vec<String>,
        cx: &Context<Self>,
    ) -> AnyElement {
        match &view.model.body {
            PullRequestsBodyModel::Ghost { ghost } => list_ghost(ghost, cx),
            PullRequestsBodyModel::Unavailable { unavailable: model } => {
                unavailable(model, &self.client, cx)
            }
            PullRequestsBodyModel::Empty { empty } => list_empty(empty, &self.client, cx),
            PullRequestsBodyModel::List { groups } => self.list(groups, view, t, visible, cx),
        }
    }

    fn report_visible(&mut self, visible: Vec<String>, cx: &mut Context<Self>) {
        if self.visible_rows.as_ref() == Some(&visible) {
            return;
        }
        act(
            &self.client,
            cx,
            "pullRequestsVisibleRows",
            json!({ "keys": visible }),
        );
        self.visible_rows = Some(visible);
    }

    fn popups(
        &self,
        view: &PullRequestsPageView,
        anchors: &std::collections::HashMap<String, gpui::Bounds<gpui::Pixels>>,
        page: &WeakEntity<Self>,
        window: &Window,
        cx: &Context<Self>,
    ) -> Vec<AnyElement> {
        let mut popups = Vec::new();
        if let Some(menu) = self.menu {
            let model = match menu {
                CompactMenu::Sort => view.model.sort_menu.as_ref(),
                CompactMenu::Provider => view.model.provider_menu.as_ref(),
                CompactMenu::State => view.model.condensed.state_menu.as_ref(),
                CompactMenu::Involvement => view.model.condensed.involvement_menu.as_ref(),
                CompactMenu::Host => view.model.condensed.host_menu.as_ref(),
            };
            if let (Some(model), Some(trigger)) = (model, anchors.get(menu.anchor())) {
                popups.push(compact_popup(
                    menu,
                    model,
                    *trigger,
                    page,
                    &self.client,
                    &view.project_icons,
                    cx,
                ));
            }
        }
        if view.filters_open
            && let Some(trigger) = anchors.get(FILTERS_ANCHOR)
        {
            let ctx = FiltersMenuContext {
                view,
                open_sub: self.sub,
                trigger: *trigger,
                anchors,
                page,
                client: &self.client,
                bounds: &self.bounds,
                author_input: self.inputs.as_ref().map(|inputs| &inputs.author),
            };
            popups.extend(filters_popup(&ctx, window, cx));
        }
        if let Some(popover) = self.popover.as_ref()
            && let Some(trigger) = anchors.get(popover.anchor())
        {
            popups.push(pull_request_popover(popover, *trigger, &self.client, cx));
        }
        popups
    }
}

impl Render for PullRequestsPage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.data.clone() else {
            self.shown = false;
            self.menu = None;
            self.sub = None;
            self.visible_rows = None;
            return div().into_any_element();
        };
        if self.activation.is_none() {
            act(
                &self.client,
                cx,
                "liveRefreshWindowActivation",
                json!({ "active": window.is_window_active() }),
            );
            self.activation = Some(cx.observe_window_activation(window, |page, window, cx| {
                act(
                    &page.client,
                    cx,
                    "liveRefreshWindowActivation",
                    json!({ "active": window.is_window_active() }),
                );
            }));
        }
        self.ensure_inputs(window, cx);
        self.sync(&view, window, cx);
        if !view.filters_open {
            self.sub = None;
        }
        let anchors = std::mem::take(&mut *self.bounds.borrow_mut());
        let t = theme::active(cx);
        let page = cx.entity().downgrade();
        let panel = self.right_panel.clone();
        let inset = self.collapsed_inset;
        panel.update(cx, |panel, _| panel.set_collapsed_sidebar_inset(inset));
        let panel_layout = panel.read(cx).layout(cx);
        let panel_present = panel_layout.as_ref().is_some_and(|layout| layout.present);
        let maximized = panel_layout
            .as_ref()
            .is_some_and(|layout| layout.open && layout.maximized);
        let viewport_width = f32::from(window.viewport_size().width);
        let mut visible = Vec::new();
        let body_fills = matches!(
            &view.model.body,
            PullRequestsBodyModel::Unavailable { .. } | PullRequestsBodyModel::Empty { .. }
        );
        let body = self.body(&view, &t, &mut visible, cx);
        let popups = self.popups(&view, &anchors, &page, window, cx);
        self.report_visible(visible, cx);
        let header = self.header(&view, &page, &t, cx);
        let controls = self.controls(&view, &page, &t, cx);
        let banner = view
            .model
            .error_banner
            .as_ref()
            .map(|banner| error_banner(banner, &self.client, cx));
        let list_footer = view
            .model
            .footer
            .as_ref()
            .map(|model| footer(model, &self.client, cx));
        let measure_panel = panel.clone();
        let column_page = page.clone();
        let body_page = page.clone();
        let body_scroll = self.scroll.clone();
        let toggle_client = self.client.clone();
        let escape_page = page.clone();
        let background = t.background;
        div()
            .id("pull-requests-page")
            .track_focus(&self.focus)
            .capture_any_mouse_down({
                let client = self.client.clone();
                move |_, _, cx| act(&client, cx, "liveRefreshInteraction", json!({}))
            })
            .relative()
            .flex()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .overflow_hidden()
            .bg(t.background)
            .text_color(t.foreground)
            .on_key_down(move |event: &KeyDownEvent, window, cx| {
                if event.keystroke.key != "escape" || event.is_held {
                    return;
                }
                let handled = escape_page
                    .update(cx, |page, cx| page.on_escape(window, cx))
                    .unwrap_or(false);
                if handled {
                    cx.stop_propagation();
                }
            })
            .on_mouse_down(gpui::MouseButton::Left, {
                let focus = self.focus.clone();
                move |_, window, cx| {
                    if window.focused(cx).is_none() {
                        window.focus(&focus, cx);
                    }
                }
            })
            .child(
                canvas(
                    move |bounds, _, cx| {
                        let width = f32::from(bounds.size.width);
                        measure_panel.update(cx, |panel, cx| {
                            panel.report_layout(viewport_width, width, cx)
                        });
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            )
            .child(
                div()
                    .relative()
                    .flex()
                    .flex_col()
                    .min_w_0()
                    .min_h_0()
                    .overflow_hidden()
                    .map(|this| {
                        if maximized {
                            this.w(px(0.)).flex_none()
                        } else {
                            this.flex_1()
                        }
                    })
                    .child(
                        canvas(
                            move |bounds, _, cx| {
                                let width = f32::from(bounds.size.width);
                                let _ = column_page.update(cx, |page, cx| {
                                    if (page.column_width - width).abs() > 0.5 {
                                        page.column_width = width;
                                        cx.notify();
                                    }
                                });
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full(),
                    )
                    .child(header)
                    .child(
                        div()
                            .relative()
                            .flex_1()
                            .min_h_0()
                            .child(
                                ScrollArea::new("pull-requests-scroll")
                                    .track_scroll(&self.scroll)
                                    .size_full()
                                    .child(
                                        div()
                                            .w_full()
                                            .min_h_full()
                                            .flex()
                                            .flex_col()
                                            .px(px(SCROLLBAR_GUTTER))
                                            .child(
                                                div()
                                                    .flex()
                                                    .flex_col()
                                                    .flex_1()
                                                    .w_full()
                                                    .max_w(px(CONTAINER_MAX_WIDTH))
                                                    .mx_auto()
                                                    .px(px(CONTAINER_PADDING_X))
                                                    .pt(px(CONTAINER_PADDING_TOP))
                                                    .pb(px(CONTAINER_PADDING_BOTTOM))
                                                    .gap(px(CONTAINER_GAP))
                                                    .child(controls)
                                                    .child(
                                                        div()
                                                            .relative()
                                                            .flex()
                                                            .flex_col()
                                                            .when(body_fills, |this| this.flex_1())
                                                            .child(
                                                                canvas(
                                                                    move |bounds, _, cx| {
                                                                        let viewport =
                                                                            body_scroll.bounds();
                                                                        let top = f32::from(
                                                                            bounds.top()
                                                                                - viewport.top()
                                                                                - body_scroll
                                                                                    .offset()
                                                                                    .y,
                                                                        );
                                                                        let width = f32::from(
                                                                            bounds.size.width,
                                                                        );
                                                                        let _ = body_page.update(
                                                                        cx,
                                                                        |page, cx| {
                                                                            if (page.body_top - top)
                                                                                .abs()
                                                                                > 0.5
                                                                                || (page.body_width
                                                                                    - width)
                                                                                    .abs()
                                                                                    > 0.5
                                                                            {
                                                                                page.body_top = top;
                                                                                page.body_width =
                                                                                    width;
                                                                                cx.notify();
                                                                            }
                                                                        },
                                                                    );
                                                                    },
                                                                    |_, _, _, _| {},
                                                                )
                                                                .absolute()
                                                                .size_full(),
                                                            )
                                                            .child(body),
                                                    )
                                                    .children(banner)
                                                    .children(list_footer),
                                            ),
                                    ),
                            )
                            .child(
                                div()
                                    .absolute()
                                    .top_0()
                                    .left_0()
                                    .right_0()
                                    .h(px(workspace::TITLEBAR_SCROLL_FADE_HEIGHT))
                                    .bg(linear_gradient(
                                        180.,
                                        linear_color_stop(hsla(background), 0.),
                                        linear_color_stop(hsla(fade(background, 0.)), 1.),
                                    )),
                            ),
                    ),
            )
            .when(panel_present, |this| this.child(panel.clone()))
            .children(
                toggle(
                    "pr-toggle-right-panel",
                    &view.right_panel,
                    t.info,
                    move |_, _, cx| act(&toggle_client, cx, "pullRequestsTogglePanel", json!({})),
                )
                .map(|toggle| {
                    div()
                        .absolute()
                        .top(px(workspace::CONTROLS_INSET))
                        .right(px(TOGGLE_RIGHT))
                        .flex()
                        .items_center()
                        .child(toggle)
                }),
            )
            .children(popups)
            .into_any_element()
    }
}
