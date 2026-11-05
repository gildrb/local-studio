use std::cell::Cell;
use std::collections::HashMap;
use std::rc::Rc;
use std::time::Duration;

use gpui::component::input::{InputEvent, InputState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, AnyView, App, AppContext, Bounds, ClickEvent, Context, Entity, FocusHandle,
    FontWeight, InteractiveElement, IntoElement, KeyDownEvent, KeystrokeEvent, MouseButton,
    MouseDownEvent, ParentElement, Pixels, Render, ScrollHandle, SharedString,
    StatefulInteractiveElement, Styled, Subscription, WeakEntity, Window, canvas, div, point, px,
    relative,
};
use serde_json::{Value, json};

use crate::app_core::client::CoreClient;
use crate::app_core::views::pull_request_detail::{
    DetailBodyModel, DetailButtonModel, DetailGateView, DetailHeaderModel, DetailModel,
    DetailNavModel, EnvironmentPickerModel, PrimaryModel, PullRequestDetailShellView,
};
use crate::app_core::views::pull_requests::{PullRequestGlyphId, PullRequestPopoverView};
use crate::features::chat::toolbar_parts::act;
use crate::features::pull_requests::composer::PullRequestComposer;
use crate::features::pull_requests::detail_parts::{
    CopyHandler, Copyable, GhostChrome, HEADER_ROW, ICON_SM, ICON_XS, INSET_X, TEXT_2XS_LINE,
    activity_unavailable, actor_label, copyable_code, detail_ghost, meta_separator,
    middle_truncate, segmented_tabs, timeline_ghost, unavailable_state,
};
use crate::features::pull_requests::detail_tabs;
use crate::features::pull_requests::filters::record;
use crate::features::pull_requests::popovers::pull_request_popover;
use crate::features::pull_requests::presentation::{
    TEXT_2XS, diff_stat, glyph_path, path_icon, refresh_icon, signal_icon, tone,
};
use crate::features::pull_requests::row::AnchorBounds;
use crate::features::sidebar::machine_icon;
use crate::platform::MONO_FONT;
use crate::ui::alert_dialog::{
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup,
    AlertDialogTitle,
};
use crate::ui::badge::{Badge, BadgeSize, BadgeVariant};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::dialog::{DialogDescription, DialogFooter, DialogHeader, DialogPopup, DialogTitle};
use crate::ui::input::{Input, InputSize};
use crate::ui::menu::{
    MenuGroupLabel, MenuItem, MenuItemVariant, MenuPopup, MenuRadioItem, MenuSeparator,
};
use crate::ui::popover::{Align, PopoverPadding, PopoverPopup, Side};
use crate::ui::theme;
use crate::ui::theme::metrics::text;
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const COPIED_FEEDBACK: Duration = Duration::from_millis(1600);
const CONDENSED_ROW_HEIGHT: f32 = 28.;
const NARROW_ACTIONS: f32 = 480.;
const NARROW_CHECKOUT: f32 = 560.;
const CHECKOUT_ANCHOR: &str = "detail:checkout";
const ACTIONS_ANCHOR: &str = "detail:actions";
const STACK_ANCHOR: &str = "detail:stack-menu";
const FRESHNESS_ANCHOR: &str = "detail:freshness";
const CHECKS_ANCHOR: &str = "detail:checks";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OpenMenu {
    Checkout,
    Actions,
    Stack,
    Freshness,
}

pub fn resolve_chrome_condensed(
    previous: bool,
    scroll_top: f32,
    fold_height: f32,
    condensed_row_height: f32,
) -> (bool, Option<f32>) {
    if previous {
        return (!(scroll_top < 4. && fold_height > 0.), None);
    }
    if fold_height > 0. && scroll_top > fold_height + 32. {
        return (true, Some(-(fold_height - condensed_row_height)));
    }
    (false, None)
}

pub struct PullRequestDetailSurface {
    client: Entity<CoreClient>,
    data: Option<Rc<PullRequestDetailShellView>>,
    popover: Option<Rc<PullRequestPopoverView>>,
    menu: Option<OpenMenu>,
    bounds: AnchorBounds,
    title_input: Option<Entity<InputState>>,
    picker_input: Option<Entity<InputState>>,
    applied_title_revision: Option<u64>,
    picker_was_open: bool,
    width: Rc<Cell<f32>>,
    fold_height: Rc<Cell<f32>>,
    condensed_by_tab: HashMap<String, bool>,
    scrolls: HashMap<String, ScrollHandle>,
    tab_views: HashMap<String, AnyView>,
    shown_surface: Option<String>,
    copied: Option<&'static str>,
    copied_generation: u64,
    focus: FocusHandle,
    composer: Entity<PullRequestComposer>,
    _subscriptions: Vec<Subscription>,
}

impl PullRequestDetailSurface {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<PullRequestDetailShellView>>(
            &client,
            "pullRequestDetail",
            json!({}),
            cx,
        );
        let popover = CoreClient::subscribe::<Option<PullRequestPopoverView>>(
            &client,
            "pullRequestPopover",
            json!({}),
            cx,
        );
        let view_subscription = cx.observe(&view, |surface, view, cx| {
            let data = view.update(cx, |state, _| state.data.take());
            surface.set_data(data.flatten().map(Rc::new), cx);
        });
        let popover_subscription = cx.observe(&popover, |surface, popover, cx| {
            let data = popover.update(cx, |state, _| state.data.take());
            surface.popover = data.flatten().map(Rc::new);
            cx.notify();
        });
        let keystrokes = cx.observe_keystrokes(|surface, event: &KeystrokeEvent, _, cx| {
            surface.on_keystroke(event, cx)
        });
        let composer = cx.new(|cx| PullRequestComposer::new(client.clone(), cx));
        Self {
            client,
            composer,
            data: None,
            popover: None,
            menu: None,
            bounds: AnchorBounds::default(),
            title_input: None,
            picker_input: None,
            applied_title_revision: None,
            picker_was_open: false,
            width: Rc::new(Cell::new(0.)),
            fold_height: Rc::new(Cell::new(0.)),
            condensed_by_tab: HashMap::new(),
            scrolls: HashMap::new(),
            tab_views: HashMap::new(),
            shown_surface: None,
            copied: None,
            copied_generation: 0,
            focus: cx.focus_handle(),
            _subscriptions: vec![view_subscription, popover_subscription, keystrokes],
        }
    }

    fn set_data(&mut self, data: Option<Rc<PullRequestDetailShellView>>, cx: &mut Context<Self>) {
        let surface = data.as_ref().map(|view| view.surface_id.clone());
        if surface != self.shown_surface {
            self.shown_surface = surface;
            self.menu = None;
            self.condensed_by_tab.clear();
            self.scrolls.clear();
            self.tab_views.clear();
            self.copied = None;
            self.fold_height.set(0.);
        }
        self.data = data;
        cx.notify();
    }

    fn on_keystroke(&mut self, event: &KeystrokeEvent, cx: &mut Context<Self>) {
        if self
            .data
            .as_ref()
            .and_then(|view| view.model.as_ref())
            .is_none()
        {
            return;
        }
        let keystroke = &event.keystroke;
        let modifiers = keystroke.modifiers;
        if !modifiers.platform && !modifiers.control {
            return;
        }
        act(
            &self.client,
            cx,
            "pullRequestDetailKeyDown",
            json!({
                "key": keystroke.key,
                "metaKey": modifiers.platform,
                "ctrlKey": modifiers.control,
                "shiftKey": modifiers.shift,
                "altKey": modifiers.alt,
                "repeat": false,
            }),
        );
    }

    fn ensure_inputs(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.title_input.is_none() {
            let input = cx.new(|cx| InputState::new(window, cx));
            let client = self.client.clone();
            cx.subscribe_in(
                &input,
                window,
                move |_, state, event: &InputEvent, _, cx| match event {
                    InputEvent::Change => {
                        let text = state.read(cx).value().to_string();
                        act(
                            &client,
                            cx,
                            "pullRequestDetailTitleDraft",
                            json!({ "text": text }),
                        );
                    }
                    InputEvent::PressEnter { .. } => {
                        let text = state.read(cx).value().to_string();
                        act(
                            &client,
                            cx,
                            "pullRequestDetailTitleSave",
                            json!({ "text": text }),
                        );
                    }
                    _ => {}
                },
            )
            .detach();
            self.title_input = Some(input);
        }
        if self.picker_input.is_none() {
            let input = cx.new(|cx| InputState::new(window, cx));
            let client = self.client.clone();
            cx.subscribe_in(
                &input,
                window,
                move |_, state, event: &InputEvent, _, cx| {
                    if let InputEvent::Change = event {
                        let query = state.read(cx).value().to_string();
                        act(
                            &client,
                            cx,
                            "pullRequestDetailThreadPickerQuery",
                            json!({ "query": query }),
                        );
                    }
                },
            )
            .detach();
            self.picker_input = Some(input);
        }
    }

    fn sync_inputs(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(view) = self.data.clone() else {
            return;
        };
        if self.applied_title_revision != Some(view.title_revision) {
            let first = self.applied_title_revision.is_none();
            self.applied_title_revision = Some(view.title_revision);
            if !first
                && let (Some(input), Some(header)) = (
                    self.title_input.as_ref(),
                    view.model.as_ref().and_then(|model| model.header.as_ref()),
                )
            {
                let draft = header.title_editor.draft.clone();
                input.update(cx, |state, cx| {
                    state.set_value(draft, window, cx);
                    state.focus(window, cx);
                });
            }
        }
        let picker = view
            .thread_links
            .as_ref()
            .and_then(|links| links.picker.as_ref());
        let open = picker.is_some();
        if open
            && !self.picker_was_open
            && let (Some(input), Some(picker)) = (self.picker_input.as_ref(), picker)
        {
            let placeholder = picker.search_placeholder.clone();
            input.update(cx, |state, cx| {
                state.set_placeholder(placeholder, window, cx);
                state.set_value(String::new(), window, cx);
                state.focus(window, cx);
            });
        }
        self.picker_was_open = open;
    }

    fn toggle_menu(&mut self, menu: OpenMenu, cx: &mut Context<Self>) {
        self.menu = if self.menu == Some(menu) {
            None
        } else {
            Some(menu)
        };
        cx.notify();
    }

    fn close_menu(&mut self, cx: &mut Context<Self>) {
        if self.menu.take().is_some() {
            cx.notify();
        }
    }

    fn mark_copied(&mut self, target: &'static str, cx: &mut Context<Self>) {
        self.copied = Some(target);
        self.copied_generation += 1;
        let generation = self.copied_generation;
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(COPIED_FEEDBACK).await;
            let _ = this.update(cx, |surface, cx| {
                if surface.copied_generation == generation {
                    surface.copied = None;
                    cx.notify();
                }
            });
        })
        .detach();
        cx.notify();
    }

    fn copy_handler(&self, cx: &Context<Self>) -> CopyHandler {
        let client = self.client.clone();
        let surface = cx.entity().downgrade();
        Rc::new(move |target, cx: &mut App| {
            act(
                &client,
                cx,
                "pullRequestDetailCopy",
                json!({ "target": target }),
            );
            let _ = surface.update(cx, |surface, cx| surface.mark_copied(target, cx));
        })
    }

    fn set_condensed(&mut self, tab: &str, scroll: &ScrollHandle, cx: &mut Context<Self>) {
        let previous = self.condensed_by_tab.get(tab).copied().unwrap_or(false);
        let scroll_top = -f32::from(scroll.offset().y);
        let (condensed, compensation) = resolve_chrome_condensed(
            previous,
            scroll_top,
            self.fold_height.get(),
            CONDENSED_ROW_HEIGHT,
        );
        if condensed == previous {
            return;
        }
        self.condensed_by_tab.insert(tab.to_string(), condensed);
        if let Some(delta) = compensation {
            let offset = scroll.offset();
            scroll.set_offset(point(offset.x, px(-(scroll_top + delta).max(0.))));
        }
        cx.notify();
    }

    fn act_button(
        &self,
        action: &'static str,
        params: Value,
    ) -> impl Fn(&ClickEvent, &mut Window, &mut App) + 'static {
        let client = self.client.clone();
        move |_, _, cx| act(&client, cx, action, params.clone())
    }

    fn header_action_button(
        &self,
        id: &'static str,
        model: &DetailButtonModel,
        variant: ButtonVariant,
        icon: &'static str,
        hide_label: bool,
        command: (&'static str, Value),
    ) -> AnyElement {
        div()
            .id(SharedString::from(format!("{id}-tip")))
            .flex()
            .flex_none()
            .tooltip(Tooltip::text(SharedString::from(model.tooltip.clone())))
            .child(
                Button::new(id)
                    .size(ButtonSize::Xs)
                    .variant(variant)
                    .disabled(model.disabled)
                    .accessibility_label(model.aria_label.clone())
                    .icon(icon)
                    .icon_size(ICON_SM)
                    .when(!hide_label, |button| button.label(model.label.clone()))
                    .on_click(self.act_button(command.0, command.1)),
            )
            .into_any_element()
    }

    fn armed_badge(id: &'static str, label: &str, tooltip: &str, hide_label: bool) -> AnyElement {
        div()
            .id(id)
            .flex()
            .flex_none()
            .tooltip(Tooltip::text(SharedString::from(tooltip.to_string())))
            .child(
                Badge::new()
                    .size(BadgeSize::Control)
                    .variant(BadgeVariant::Info)
                    .icon(glyph_path(PullRequestGlyphId::Merged))
                    .when(!hide_label, |badge| badge.label(label.to_string())),
            )
            .into_any_element()
    }

    fn right_controls(
        &self,
        view: &PullRequestDetailShellView,
        model: &DetailModel,
        width: f32,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> Vec<AnyElement> {
        let mut controls = Vec::new();
        let narrow = width > 0. && width < NARROW_ACTIONS;
        let Some(menu) = model.menu.as_ref() else {
            return controls;
        };
        if model.actions.retry_stack.visible {
            controls.push(
                Button::new("pr-detail-retry-stack")
                    .size(ButtonSize::Xs)
                    .variant(ButtonVariant::Ghost)
                    .label(model.actions.retry_stack.label.clone())
                    .on_click(self.act_button("pullRequestDetailRetryStack", json!({})))
                    .into_any_element(),
            );
        }
        if let Some(stack) = view.stack_menu.as_ref()
            && model.actions.stack_menu.visible
        {
            let surface = cx.entity().downgrade();
            controls.push(
                div()
                    .id("pr-detail-stack-tip")
                    .flex()
                    .flex_none()
                    .tooltip(Tooltip::text(SharedString::from(
                        stack.model.trigger.tooltip.clone(),
                    )))
                    .child(
                        Button::new("pr-detail-stack")
                            .size(ButtonSize::Xs)
                            .variant(ButtonVariant::Ghost)
                            .accessibility_label(stack.model.trigger.aria_label.clone())
                            .pressed(self.menu == Some(OpenMenu::Stack))
                            .icon(glyph_path(PullRequestGlyphId::Stack))
                            .icon_size(ICON_SM)
                            .label(stack.model.trigger.position_label.clone())
                            .when(stack.model.trigger.warning, |button| {
                                button.child(path_icon(
                                    "icons/triangle-alert.svg",
                                    ICON_XS,
                                    t.warning,
                                ))
                            })
                            .child(record(&self.bounds, STACK_ANCHOR))
                            .on_click(move |_, _, cx| {
                                let _ = surface.update(cx, |surface, cx| {
                                    surface.toggle_menu(OpenMenu::Stack, cx)
                                });
                            }),
                    )
                    .into_any_element(),
            );
            if stack.model.merge_button.visible {
                controls.push(
                    div()
                        .id("pr-detail-stack-merge-tip")
                        .flex()
                        .flex_none()
                        .tooltip(Tooltip::text(SharedString::from(
                            stack.model.merge_button.tooltip.clone().unwrap_or_default(),
                        )))
                        .child(
                            Button::new("pr-detail-stack-merge")
                                .size(ButtonSize::Xs)
                                .disabled(stack.model.merge_button.disabled)
                                .icon(glyph_path(PullRequestGlyphId::Merged))
                                .icon_size(ICON_SM)
                                .label(stack.model.merge_button.label.clone())
                                .on_click(self.act_button(
                                    "pullRequestDetailStackConfirm",
                                    json!({ "action": "merge" }),
                                )),
                        )
                        .into_any_element(),
                );
            }
        }
        if let Some(links) = view.thread_links.as_ref()
            && links.count_visible
        {
            controls.push(
                div()
                    .id("pr-detail-thread-count-tip")
                    .flex()
                    .flex_none()
                    .tooltip(Tooltip::text(SharedString::from(
                        links.model.count.tooltip.clone(),
                    )))
                    .child(
                        Button::new("pr-detail-thread-count")
                            .size(ButtonSize::Xs)
                            .variant(ButtonVariant::Ghost)
                            .accessibility_label(links.model.count.aria_label.clone())
                            .icon("message-square")
                            .icon_size(ICON_SM)
                            .label(links.model.count.count_label.clone())
                            .on_click(
                                self.act_button("pullRequestDetailThreadLinksCount", json!({})),
                            ),
                    )
                    .into_any_element(),
            );
        }
        if let Some(checkout) = self.checkout_trigger(model, width, t, cx) {
            controls.push(checkout);
        }
        if let Some(badge) = model.actions.armed_badge.as_ref() {
            controls.push(Self::armed_badge(
                "pr-detail-armed",
                &badge.label,
                &badge.tooltip,
                narrow,
            ));
        }
        match model.actions.primary.as_ref() {
            Some(PrimaryModel::Resolve { .. }) => {
                controls.push(self.header_action_button(
                    "pr-detail-resolve",
                    &model.resolve_conflicts,
                    ButtonVariant::DestructiveOutline,
                    glyph_path(PullRequestGlyphId::Conflicting),
                    narrow,
                    ("pullRequestDetailResolveConflicts", json!({})),
                ));
            }
            Some(PrimaryModel::Ready { button }) => controls.push(self.header_action_button(
                "pr-detail-ready",
                button,
                ButtonVariant::Default,
                glyph_path(PullRequestGlyphId::PullRequest),
                narrow,
                ("pullRequestDetailPerform", json!({ "action": "ready" })),
            )),
            Some(PrimaryModel::EnableAutoMerge { button }) => {
                controls.push(self.header_action_button(
                    "pr-detail-auto-merge",
                    button,
                    ButtonVariant::Default,
                    glyph_path(PullRequestGlyphId::Merged),
                    narrow,
                    (
                        "pullRequestDetailConfirm",
                        json!({ "action": "enable-auto-merge" }),
                    ),
                ))
            }
            Some(PrimaryModel::AutoMergeArmed { label, tooltip }) => controls.push(
                Self::armed_badge("pr-detail-primary-armed", label, tooltip, narrow),
            ),
            Some(PrimaryModel::Merge { button }) => controls.push(self.header_action_button(
                "pr-detail-merge",
                button,
                ButtonVariant::Default,
                glyph_path(PullRequestGlyphId::Merged),
                narrow,
                ("pullRequestDetailConfirm", json!({ "action": "merge" })),
            )),
            Some(PrimaryModel::State { state }) => {
                let color = tone(&state.tone_class_name, t);
                controls.push(
                    Badge::new()
                        .size(BadgeSize::Control)
                        .variant(BadgeVariant::Outline)
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.))
                                .text_color(color)
                                .child(path_icon(glyph_path(state.icon), ICON_SM, color))
                                .child(SharedString::from(state.label.clone())),
                        )
                        .into_any_element(),
                );
            }
            None => {}
        }
        let surface = cx.entity().downgrade();
        let trigger_icon = if menu.trigger.refreshing {
            refresh_icon("pr-detail-menu-spin", 16., t.muted_foreground, true)
        } else {
            path_icon("icons/ellipsis.svg", 16., t.muted_foreground).into_any_element()
        };
        controls.push(
            div()
                .id("pr-detail-menu-tip")
                .flex()
                .flex_none()
                .tooltip(Tooltip::text(SharedString::from(
                    menu.trigger.aria_label.clone(),
                )))
                .child(
                    Button::new("pr-detail-menu")
                        .size(ButtonSize::IconXs)
                        .variant(ButtonVariant::GhostMuted)
                        .accessibility_label(menu.trigger.aria_label.clone())
                        .pressed(self.menu == Some(OpenMenu::Actions))
                        .child(trigger_icon)
                        .child(record(&self.bounds, ACTIONS_ANCHOR))
                        .on_click(move |_, _, cx| {
                            let _ = surface.update(cx, |surface, cx| {
                                surface.toggle_menu(OpenMenu::Actions, cx)
                            });
                        }),
                )
                .into_any_element(),
        );
        controls
    }

    fn checkout_trigger(
        &self,
        model: &DetailModel,
        width: f32,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> Option<AnyElement> {
        let checkout = &model.actions.checkout;
        if !checkout.visible {
            return None;
        }
        let surface = cx.entity().downgrade();
        let hide_label = width > 0. && width < NARROW_CHECKOUT;
        Some(
            div()
                .id("pr-detail-checkout-tip")
                .flex()
                .flex_none()
                .tooltip(Tooltip::text(SharedString::from(checkout.tooltip.clone())))
                .child(
                    Button::new("pr-detail-checkout")
                        .size(ButtonSize::Xs)
                        .variant(ButtonVariant::Outline)
                        .disabled(checkout.disabled)
                        .accessibility_label(checkout.aria_label.clone())
                        .pressed(self.menu == Some(OpenMenu::Checkout))
                        .icon("git-branch")
                        .icon_size(ICON_SM)
                        .when(!hide_label, |button| button.label(checkout.label.clone()))
                        .child(path_icon(
                            "icons/chevron-down.svg",
                            ICON_SM,
                            t.muted_foreground,
                        ))
                        .child(record(&self.bounds, CHECKOUT_ANCHOR))
                        .on_click(move |_, _, cx| {
                            let _ = surface.update(cx, |surface, cx| {
                                surface.toggle_menu(OpenMenu::Checkout, cx)
                            });
                        }),
                )
                .into_any_element(),
        )
    }

    fn number_link(&self, id: &'static str, header: &DetailHeaderModel, t: &Tokens) -> AnyElement {
        let color = tone(&header.state.tone_class_name, t);
        let url = header.number.url.clone();
        let client = self.client.clone();
        let menu_client = self.client.clone();
        div()
            .id(id)
            .flex()
            .flex_none()
            .items_center()
            .gap(px(2.))
            .cursor_pointer()
            .font_weight(FontWeight::MEDIUM)
            .text_color(color)
            .hover(|style| style.underline())
            .tooltip(Tooltip::text(SharedString::from(
                header.number.tooltip.clone(),
            )))
            .on_click(move |_, _, cx| {
                act(
                    &client,
                    cx,
                    "pullRequestDetailOpenUrl",
                    json!({ "url": url }),
                )
            })
            .on_mouse_down(MouseButton::Right, move |event: &MouseDownEvent, _, cx| {
                cx.stop_propagation();
                let (x, y) = (f32::from(event.position.x), f32::from(event.position.y));
                act(
                    &menu_client,
                    cx,
                    "pullRequestDetailNumberContextMenu",
                    json!({ "x": x, "y": y }),
                );
            })
            .child(SharedString::from(header.number.label.clone()))
            .child(path_icon("icons/external-link.svg", 10., color))
            .into_any_element()
    }

    fn back_button(&self, model: &DetailModel) -> Option<AnyElement> {
        if !model.chrome.back.visible {
            return None;
        }
        Some(
            div()
                .id("pr-detail-back-tip")
                .flex()
                .flex_none()
                .tooltip(Tooltip::text(SharedString::from(
                    model.chrome.back.tooltip.clone(),
                )))
                .child(
                    Button::new("pr-detail-back")
                        .size(ButtonSize::IconMicro)
                        .variant(ButtonVariant::GhostMuted)
                        .accessibility_label(model.chrome.back.aria_label.clone())
                        .icon("arrow-left")
                        .icon_size(ICON_SM)
                        .on_click(self.act_button("pullRequestDetailBack", json!({}))),
                )
                .into_any_element(),
        )
    }

    fn title_line(
        &self,
        model: &DetailModel,
        header: &DetailHeaderModel,
        condensed: bool,
        t: &Tokens,
    ) -> AnyElement {
        let muted = t.muted_foreground;
        let foreground = t.foreground;
        let line = div()
            .flex()
            .min_w_0()
            .items_center()
            .gap(px(4.))
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .text_color(muted)
            .children(self.back_button(model));
        if condensed {
            return line
                .child(self.number_link("pr-detail-number-condensed", header, t))
                .child(
                    div()
                        .id("pr-detail-condensed-title")
                        .min_w_0()
                        .truncate()
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(foreground)
                        .tooltip(Tooltip::text(SharedString::from(header.title.clone())))
                        .child(SharedString::from(header.title.clone())),
                )
                .into_any_element();
        }
        let repository = div()
            .id("pr-detail-repository")
            .min_w_0()
            .truncate()
            .font_weight(FontWeight::MEDIUM)
            .text_color(muted)
            .tooltip(Tooltip::text(SharedString::from(
                header.repository.tooltip.clone(),
            )))
            .child(SharedString::from(header.repository.label.clone()));
        let repository = match header.repository.url.clone() {
            Some(url) => {
                let client = self.client.clone();
                repository
                    .cursor_pointer()
                    .hover(move |style| style.text_color(foreground).underline())
                    .on_click(move |_, _, cx| {
                        act(
                            &client,
                            cx,
                            "pullRequestDetailOpenUrl",
                            json!({ "url": url }),
                        )
                    })
            }
            None => repository,
        };
        line.child(repository)
            .child(self.number_link("pr-detail-number", header, t))
            .into_any_element()
    }

    fn base_branch(
        &self,
        view: &PullRequestDetailShellView,
        header: &DetailHeaderModel,
        icon_size: f32,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> AnyElement {
        let name = div()
            .flex()
            .min_w_0()
            .items_center()
            .gap(px(4.))
            .when(header.branches.stacked, |this| {
                this.child(path_icon(
                    glyph_path(PullRequestGlyphId::Stack),
                    ICON_XS,
                    t.muted_foreground,
                ))
            })
            .child(middle_truncate(
                &header.branches.base,
                view.branch_splits.base.as_ref(),
            ));
        match header.freshness.as_ref() {
            Some(_) => {
                let surface = cx.entity().downgrade();
                let hover_surface = cx.entity().downgrade();
                div()
                    .id("pr-detail-freshness")
                    .relative()
                    .flex()
                    .min_w_0()
                    .max_w(relative(0.4))
                    .flex_none()
                    .items_center()
                    .gap(px(4.))
                    .cursor_pointer()
                    .rounded(px(2.))
                    .text_color(t.warning_foreground)
                    .child(name)
                    .child(path_icon(
                        "icons/triangle-alert.svg",
                        icon_size,
                        t.warning_foreground,
                    ))
                    .child(record(&self.bounds, FRESHNESS_ANCHOR))
                    .on_hover(move |hovered, _, cx| {
                        if *hovered {
                            let _ = hover_surface.update(cx, |surface, cx| {
                                if surface.menu != Some(OpenMenu::Freshness) {
                                    surface.menu = Some(OpenMenu::Freshness);
                                    cx.notify();
                                }
                            });
                        }
                    })
                    .on_click(move |_, _, cx| {
                        let _ = surface.update(cx, |surface, cx| {
                            surface.toggle_menu(OpenMenu::Freshness, cx)
                        });
                    })
                    .into_any_element()
            }
            None => div()
                .id("pr-detail-base-tip")
                .flex()
                .min_w_0()
                .max_w(relative(0.4))
                .flex_none()
                .tooltip(Tooltip::text(SharedString::from(
                    header.branches.base_tooltip.clone(),
                )))
                .child(name)
                .into_any_element(),
        }
    }

    fn condensed_row(
        &self,
        view: &PullRequestDetailShellView,
        header: &DetailHeaderModel,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> AnyElement {
        let muted = t.muted_foreground;
        div()
            .px(px(INSET_X))
            .pb(px(8.))
            .pt(px(4.))
            .child(
                div()
                    .flex()
                    .min_w_0()
                    .items_center()
                    .gap(px(8.))
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(muted)
                    .child(
                        div()
                            .flex()
                            .min_w_0()
                            .flex_shrink(1.)
                            .items_center()
                            .gap(px(6.))
                            .overflow_hidden()
                            .child(actor_label(
                                "pr-detail-condensed-author",
                                &header.author,
                                header.author_profile_url.as_ref(),
                                false,
                                true,
                                &self.client,
                                t,
                            ))
                            .child(
                                div()
                                    .flex_none()
                                    .child(SharedString::from(header.updated_relative.clone())),
                            ),
                    )
                    .child(
                        div()
                            .flex_none()
                            .h(px(12.))
                            .w(px(1.))
                            .bg(fade(t.border, 0.7)),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_1()
                            .min_w_0()
                            .items_center()
                            .gap(px(6.))
                            .font_family(MONO_FONT)
                            .text_size(px(TEXT_2XS))
                            .line_height(px(TEXT_2XS_LINE))
                            .text_color(fade(muted, 0.65))
                            .child(self.base_branch(view, header, ICON_XS, t, cx))
                            .child(path_icon("icons/arrow-left.svg", ICON_XS, muted).opacity(0.6))
                            .child(
                                div()
                                    .id("pr-detail-condensed-head")
                                    .flex()
                                    .flex_1()
                                    .min_w_0()
                                    .tooltip(Tooltip::text(SharedString::from(
                                        header.branches.head.clone(),
                                    )))
                                    .child(middle_truncate(
                                        &header.branches.head,
                                        view.branch_splits.head.as_ref(),
                                    )),
                            ),
                    )
                    .child(
                        div()
                            .ml_auto()
                            .flex()
                            .flex_none()
                            .items_center()
                            .justify_end()
                            .gap(px(8.))
                            .text_size(px(TEXT_2XS))
                            .line_height(px(TEXT_2XS_LINE))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(4.))
                                    .font_features(theme::tabular())
                                    .child(path_icon("icons/file-diff.svg", ICON_XS, muted))
                                    .child(SharedString::from(header.changed_files.count.clone())),
                            )
                            .when_some(header.diff_stat.as_ref(), |this, stat| {
                                this.child(diff_stat(
                                    &stat.additions,
                                    &stat.deletions,
                                    TEXT_2XS,
                                    TEXT_2XS_LINE,
                                    t,
                                ))
                            }),
                    ),
            )
            .into_any_element()
    }

    fn fold(
        &self,
        view: &PullRequestDetailShellView,
        header: &DetailHeaderModel,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> AnyElement {
        let muted = t.muted_foreground;
        let copy = self.copy_handler(cx);
        let editor = &header.title_editor;
        let title = if editor.editing {
            let input = self.title_input.clone();
            let cancel = self.client.clone();
            let save_client = self.client.clone();
            let save_input = self.title_input.clone();
            div()
                .flex()
                .flex_col()
                .gap(px(8.))
                .when_some(input, |this, input| {
                    let escape = cancel.clone();
                    this.child(
                        div()
                            .on_key_down(move |event: &KeyDownEvent, _, cx| {
                                if event.keystroke.key == "escape" {
                                    cx.stop_propagation();
                                    act(&escape, cx, "pullRequestDetailTitleCancel", json!({}));
                                }
                            })
                            .child(
                                Input::new(&input)
                                    .size(InputSize::Sm)
                                    .disabled(editor.input_disabled),
                            ),
                    )
                })
                .child(
                    div()
                        .flex()
                        .justify_end()
                        .gap(px(8.))
                        .child(
                            Button::new("pr-detail-title-cancel")
                                .size(ButtonSize::Xs)
                                .variant(ButtonVariant::Ghost)
                                .disabled(editor.cancel_disabled)
                                .label(editor.cancel_label.clone())
                                .on_click(move |_, _, cx| {
                                    act(&cancel, cx, "pullRequestDetailTitleCancel", json!({}))
                                }),
                        )
                        .child(
                            Button::new("pr-detail-title-save")
                                .size(ButtonSize::Xs)
                                .variant(ButtonVariant::Outline)
                                .disabled(editor.save_disabled)
                                .label(editor.save_label.clone())
                                .on_click(move |_, _, cx| {
                                    let text = save_input
                                        .as_ref()
                                        .map(|input| input.read(cx).value().to_string())
                                        .unwrap_or_default();
                                    act(
                                        &save_client,
                                        cx,
                                        "pullRequestDetailTitleSave",
                                        json!({ "text": text }),
                                    )
                                }),
                        ),
                )
                .into_any_element()
        } else {
            div()
                .group("pr-detail-title")
                .flex()
                .min_w_0()
                .min_h(px(24.))
                .items_center()
                .gap(px(4.))
                .child(
                    div()
                        .id("pr-detail-title-text")
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .text_size(px(text::BASE))
                        .line_height(px(text::BASE * text::LEADING_SNUG))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(t.foreground)
                        .tooltip(Tooltip::text(SharedString::from(header.title.clone())))
                        .child(SharedString::from(header.title.clone())),
                )
                .when(editor.can_edit, |this| {
                    this.child(
                        div()
                            .flex()
                            .flex_none()
                            .opacity(0.)
                            .group_hover("pr-detail-title", |style| style.opacity(1.))
                            .child(
                                Button::new("pr-detail-title-edit")
                                    .size(ButtonSize::IconXs)
                                    .variant(ButtonVariant::GhostMuted)
                                    .accessibility_label(editor.edit_aria_label.clone())
                                    .icon("pencil")
                                    .icon_size(ICON_XS)
                                    .on_click(
                                        self.act_button("pullRequestDetailTitleEdit", json!({})),
                                    ),
                            ),
                    )
                })
                .into_any_element()
        };
        let fold_height = self.fold_height.clone();
        div()
            .relative()
            .mt(px(4.))
            .min_w_0()
            .px(px(INSET_X))
            .pb(px(16.))
            .child(
                canvas(
                    move |bounds, _, _| fold_height.set(f32::from(bounds.size.height)),
                    |_, _, _, _| {},
                )
                .absolute()
                .top_0()
                .left_0()
                .size_full(),
            )
            .child(title)
            .child(
                div()
                    .mt(px(8.))
                    .flex()
                    .min_h(px(20.))
                    .min_w_0()
                    .items_center()
                    .gap(px(8.))
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(muted)
                    .child(
                        div()
                            .flex()
                            .min_w_0()
                            .items_center()
                            .gap(px(6.))
                            .whitespace_nowrap()
                            .child(actor_label(
                                "pr-detail-author",
                                &header.author,
                                header.author_profile_url.as_ref(),
                                true,
                                true,
                                &self.client,
                                t,
                            ))
                            .child(meta_separator(t))
                            .child(SharedString::from(header.updated_label.clone())),
                    )
                    .when_some(header.checkout_command.as_ref(), |this, command| {
                        this.child(copyable_code(
                            Copyable {
                                id: "pr-detail-checkout-command",
                                value: command,
                                copy_label: "Copy checkout command",
                                target: "checkout",
                                copied: self.copied == Some("checkout"),
                                push_right: true,
                                handler: Some(copy.clone()),
                            },
                            t,
                        ))
                    }),
            )
            .child(
                div()
                    .mt(px(16.))
                    .flex()
                    .min_h(px(20.))
                    .min_w_0()
                    .items_center()
                    .gap(px(8.))
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(muted)
                    .child(
                        div()
                            .flex()
                            .flex_1()
                            .min_w_0()
                            .items_center()
                            .gap(px(6.))
                            .font_family(MONO_FONT)
                            .text_color(fade(muted, 0.7))
                            .child(self.base_branch(view, header, ICON_SM, t, cx))
                            .child(path_icon("icons/arrow-left.svg", ICON_SM, muted).opacity(0.6))
                            .child(copyable_code(
                                Copyable {
                                    id: "pr-detail-head-branch",
                                    value: &header.branches.head,
                                    copy_label: &header.branches.head_copy_label,
                                    target: "branch",
                                    copied: self.copied == Some("branch"),
                                    push_right: false,
                                    handler: Some(copy),
                                },
                                t,
                            )),
                    )
                    .child(
                        div()
                            .ml_auto()
                            .flex()
                            .flex_none()
                            .items_center()
                            .justify_end()
                            .gap(px(8.))
                            .child(
                                div()
                                    .flex()
                                    .min_w(px(64.))
                                    .items_center()
                                    .justify_end()
                                    .gap(px(6.))
                                    .font_features(theme::tabular())
                                    .child(path_icon("icons/file-diff.svg", ICON_SM, muted))
                                    .child(SharedString::from(header.changed_files.label.clone())),
                            )
                            .when_some(header.diff_stat.as_ref(), |this, stat| {
                                this.child(diff_stat(
                                    &stat.additions,
                                    &stat.deletions,
                                    text::XS,
                                    text::XS_LINE,
                                    t,
                                ))
                            }),
                    ),
            )
            .into_any_element()
    }

    fn nav(
        &self,
        view: &PullRequestDetailShellView,
        model: &DetailModel,
        nav: &DetailNavModel,
        t: &Tokens,
    ) -> AnyElement {
        let muted = t.muted_foreground;
        let trailing = match nav {
            DetailNavModel::Summary {
                approve_workflows,
                checks,
            } => match approve_workflows {
                Some(button) => div()
                    .ml_auto()
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_end()
                    .child(self.header_action_button(
                        "pr-detail-approve-workflows",
                        button,
                        ButtonVariant::WarningOutline,
                        "play",
                        false,
                        (
                            "pullRequestDetailConfirm",
                            json!({ "action": "approve-workflows" }),
                        ),
                    ))
                    .into_any_element(),
                None => {
                    let trigger = match view.checks_trigger.as_ref() {
                        Some(trigger) if checks.state.is_some() => {
                            let color = tone(&trigger.tone_class_name, t);
                            let client = self.client.clone();
                            div()
                                .id("pr-detail-checks-trigger")
                                .relative()
                                .flex()
                                .flex_none()
                                .items_center()
                                .cursor_pointer()
                                .child(signal_icon(
                                    "pr-detail-checks-icon",
                                    &trigger.icon,
                                    ICON_SM,
                                    color,
                                ))
                                .child(record(&self.bounds, CHECKS_ANCHOR))
                                .on_click(move |_, _, cx| {
                                    act(&client, cx, "pullRequestDetailChecksOpen", json!({}))
                                })
                                .into_any_element()
                        }
                        _ => path_icon("icons/circle-dot.svg", ICON_SM, muted).into_any_element(),
                    };
                    div()
                        .ml_auto()
                        .flex()
                        .flex_1()
                        .min_w_0()
                        .items_center()
                        .justify_end()
                        .child(
                            div()
                                .flex()
                                .h(px(16.))
                                .min_w_0()
                                .items_center()
                                .justify_end()
                                .gap(px(6.))
                                .overflow_hidden()
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .text_color(muted)
                                .child(trigger)
                                .when_some(checks.summary.clone(), |this, summary| {
                                    this.child(
                                        div()
                                            .whitespace_nowrap()
                                            .child(SharedString::from(summary)),
                                    )
                                }),
                        )
                        .into_any_element()
                }
            },
            DetailNavModel::Timeline {
                dimmed,
                comments,
                commits,
                approvals,
                order,
            } => div()
                .ml_auto()
                .flex()
                .flex_none()
                .items_center()
                .gap(px(8.))
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .text_color(muted)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .whitespace_nowrap()
                        .text_size(px(TEXT_2XS))
                        .line_height(px(TEXT_2XS_LINE))
                        .when(*dimmed, |this| this.opacity(0.35))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.))
                                .child(path_icon("icons/message-square.svg", ICON_XS, muted))
                                .child(SharedString::from(comments.label.clone())),
                        )
                        .child(meta_separator(t))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.))
                                .child(path_icon("icons/git-commit-horizontal.svg", ICON_XS, muted))
                                .child(SharedString::from(commits.label.clone())),
                        )
                        .when_some(approvals.as_ref(), |this, approvals| {
                            let color = tone(&approvals.tone_class_name, t);
                            this.child(meta_separator(t)).child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(4.))
                                    .text_color(color)
                                    .child(path_icon("icons/circle-check.svg", ICON_XS, color))
                                    .child(SharedString::from(approvals.label.clone())),
                            )
                        }),
                )
                .child(
                    Button::new("pr-detail-timeline-order")
                        .size(ButtonSize::Xs)
                        .variant(ButtonVariant::GhostMuted)
                        .accessibility_label(order.aria_label.clone())
                        .icon("arrow-down-up")
                        .icon_size(ICON_XS)
                        .label(order.label.clone())
                        .on_click(
                            self.act_button("pullRequestDetailToggleTimelineOrder", json!({})),
                        ),
                )
                .into_any_element(),
            DetailNavModel::Code => div().into_any_element(),
        };
        div()
            .flex()
            .flex_wrap()
            .min_w_0()
            .items_center()
            .gap(px(8.))
            .border_t_1()
            .border_color(fade(t.border, 0.6))
            .px(px(INSET_X))
            .py(px(8.))
            .child(segmented_tabs(
                "pr-detail-tabs",
                &model.tabs.items,
                &model.tabs.active,
                Some(&self.client),
            ))
            .child(trailing)
            .into_any_element()
    }

    fn body(
        &mut self,
        view: &PullRequestDetailShellView,
        model: &DetailModel,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        match &model.body {
            DetailBodyModel::Unavailable { error } => unavailable_state(
                "Could not load pull requests",
                error,
                Some(view.unavailable.refreshing),
                view.unavailable.git_hub_url.as_ref(),
                &self.client,
                cx,
            ),
            DetailBodyModel::Empty => div().into_any_element(),
            DetailBodyModel::Detail { timeline } => {
                let mut layers = Vec::new();
                for tab in &view.mounted_tabs {
                    let active = *tab == model.tabs.active;
                    let content: Option<AnyElement> = if tab == "timeline" && timeline == "loading"
                    {
                        Some(timeline_ghost(cx))
                    } else if tab == "timeline"
                        && timeline == "error"
                        && let Some(model) = view.activity_unavailable.as_ref()
                    {
                        Some(activity_unavailable(model, &self.client, cx))
                    } else {
                        let client = self.client.clone();
                        let handle = self.scrolls.entry(tab.clone()).or_default().clone();
                        let entry = self.tab_views.get(tab).cloned().or_else(|| {
                            let created = detail_tabs::tab_view(tab, client, handle, cx)?;
                            self.tab_views.insert(tab.clone(), created.clone());
                            Some(created)
                        });
                        entry.map(|view| view.into_any_element())
                    };
                    let Some(content) = content else {
                        continue;
                    };
                    let scroll = self.scrolls.entry(tab.clone()).or_default().clone();
                    let owns_scroll = detail_tabs::owns_scroll(tab);
                    let watch = scroll.clone();
                    let surface = cx.entity().downgrade();
                    let tab_key = tab.clone();
                    layers.push(
                        div()
                            .absolute()
                            .inset_0()
                            .when(!active, |this| this.invisible())
                            .map(|this| {
                                if owns_scroll {
                                    this.child(div().size_full().child(content))
                                } else {
                                    this.child(
                                        div()
                                            .id(SharedString::from(format!("pr-detail-tab-{tab}")))
                                            .size_full()
                                            .overflow_y_scroll()
                                            .track_scroll(&scroll)
                                            .child(content),
                                    )
                                }
                            })
                            .when(active, |this| {
                                this.child(
                                    canvas(
                                        move |_, _, cx| {
                                            let _ = surface.update(cx, |surface, cx| {
                                                surface.set_condensed(&tab_key, &watch, cx)
                                            });
                                        },
                                        |_, _, _, _| {},
                                    )
                                    .absolute()
                                    .size_0(),
                                )
                            })
                            .into_any_element(),
                    );
                }
                div()
                    .relative()
                    .size_full()
                    .children(layers)
                    .into_any_element()
            }
        }
    }

    fn environment_picker(
        &self,
        prefix: &'static str,
        picker: &EnvironmentPickerModel,
        t: &Tokens,
        items: &mut Vec<AnyElement>,
    ) {
        if !picker.visible {
            return;
        }
        items.push(MenuSeparator::new().into_any_element());
        for option in &picker.options {
            let client = self.client.clone();
            let environment_id = option.environment_id.clone();
            let checked = option.environment_id == picker.value;
            items.push(
                MenuRadioItem::new(SharedString::from(format!(
                    "{prefix}-env-{}",
                    option.environment_id
                )))
                .checked(checked)
                .disabled(picker.disabled)
                .on_click(move |_, _, cx| {
                    act(
                        &client,
                        cx,
                        "pullRequestDetailSetActingEnvironment",
                        json!({ "environmentId": environment_id }),
                    )
                })
                .child(
                    div()
                        .flex()
                        .min_w_0()
                        .items_center()
                        .gap(px(8.))
                        .child(path_icon(
                            machine_icon(option.machine),
                            ICON_SM,
                            t.foreground,
                        ))
                        .child(
                            div()
                                .min_w_0()
                                .truncate()
                                .child(SharedString::from(option.label.clone())),
                        ),
                )
                .into_any_element(),
            );
        }
    }

    fn popups(
        &self,
        view: &PullRequestDetailShellView,
        model: Option<&DetailModel>,
        anchors: &HashMap<String, Bounds<Pixels>>,
        cx: &Context<Self>,
    ) -> Vec<AnyElement> {
        let t = theme::active(cx);
        let mut popups = Vec::new();
        let surface = cx.entity().downgrade();
        let dismiss = |trigger: Bounds<Pixels>, surface: WeakEntity<Self>| {
            move |window: &mut Window, cx: &mut App| {
                if trigger.contains(&window.mouse_position()) {
                    return;
                }
                let _ = surface.update(cx, |surface, cx| surface.close_menu(cx));
            }
        };
        let close = |surface: WeakEntity<Self>| {
            move |cx: &mut App| {
                let _ = surface.update(cx, |surface, cx| surface.close_menu(cx));
            }
        };
        if let (Some(menu), Some(model)) = (self.menu, model) {
            match menu {
                OpenMenu::Checkout => {
                    if let Some(trigger) = anchors.get(CHECKOUT_ANCHOR) {
                        let checkout = &model.actions.checkout;
                        let mut items: Vec<AnyElement> = checkout
                            .options
                            .iter()
                            .map(|option| {
                                let client = self.client.clone();
                                let mode = option.mode.clone();
                                let closer = close(surface.clone());
                                MenuItem::new(SharedString::from(format!(
                                    "pr-checkout-{}",
                                    option.mode
                                )))
                                .on_click(move |_, _, cx| {
                                    closer(cx);
                                    act(
                                        &client,
                                        cx,
                                        "pullRequestDetailCheckout",
                                        json!({ "mode": mode }),
                                    );
                                })
                                .child(
                                    div()
                                        .flex()
                                        .min_w_0()
                                        .items_start()
                                        .gap(px(8.))
                                        .child(div().mt(px(4.)).flex_none().child(path_icon(
                                            if option.icon == "git-branch" {
                                                "icons/git-branch.svg"
                                            } else {
                                                "icons/folder-git-2.svg"
                                            },
                                            ICON_SM,
                                            t.muted_foreground,
                                        )))
                                        .child(
                                            div()
                                                .flex()
                                                .flex_col()
                                                .min_w_0()
                                                .child(SharedString::from(option.title.clone()))
                                                .child(
                                                    div()
                                                        .text_size(px(text::XS))
                                                        .line_height(px(text::XS_LINE))
                                                        .text_color(t.muted_foreground)
                                                        .child(SharedString::from(
                                                            option.description.clone(),
                                                        )),
                                                ),
                                        ),
                                )
                                .into_any_element()
                            })
                            .collect();
                        self.environment_picker(
                            "pr-checkout",
                            &checkout.environments,
                            &t,
                            &mut items,
                        );
                        popups.push(
                            MenuPopup::new("pr-checkout-menu", *trigger)
                                .side(Side::Bottom)
                                .align(Align::End)
                                .on_dismiss(dismiss(*trigger, surface.clone()))
                                .children(items)
                                .into_any_element(),
                        );
                    }
                }
                OpenMenu::Actions => {
                    if let (Some(trigger), Some(menu)) =
                        (anchors.get(ACTIONS_ANCHOR), model.menu.as_ref())
                    {
                        popups.push(self.actions_menu(view, menu, *trigger, &t, cx));
                    }
                }
                OpenMenu::Stack => {
                    if let (Some(trigger), Some(stack)) =
                        (anchors.get(STACK_ANCHOR), view.stack_menu.as_ref())
                    {
                        let mut items: Vec<AnyElement> = Vec::new();
                        items.push(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .gap(px(8.))
                                .child(MenuGroupLabel::new(format!(
                                    "Stack #{}",
                                    stack_number(&stack.model.trigger.aria_label)
                                )))
                                .when_some(stack.notice.clone(), |this, notice| {
                                    this.child(
                                        div()
                                            .id("pr-stack-notice")
                                            .pr(px(8.))
                                            .text_size(px(text::XS))
                                            .text_color(t.muted_foreground)
                                            .tooltip(Tooltip::text(SharedString::from(notice)))
                                            .child(if stack.stale {
                                                "May be stale"
                                            } else {
                                                "Refreshing…"
                                            }),
                                    )
                                })
                                .into_any_element(),
                        );
                        if let Some(retry) = stack.model.retry_label.clone() {
                            let client = self.client.clone();
                            items.push(
                                MenuItem::new("pr-stack-retry")
                                    .label(retry)
                                    .on_click(move |_, _, cx| {
                                        act(&client, cx, "pullRequestDetailRetryStack", json!({}))
                                    })
                                    .into_any_element(),
                            );
                        }
                        for layer in &stack.layers {
                            let client = self.client.clone();
                            let closer = close(surface.clone());
                            let number = layer.number;
                            let color = tone(&layer.state.tone_class_name, &t);
                            items.push(
                                MenuItem::new(SharedString::from(format!(
                                    "pr-stack-layer-{}",
                                    layer.number
                                )))
                                .disabled(layer.disabled)
                                .on_click(move |_, _, cx| {
                                    closer(cx);
                                    act(
                                        &client,
                                        cx,
                                        "pullRequestDetailStackSelect",
                                        json!({ "number": number }),
                                    );
                                })
                                .child(stack_layer(layer, color, &t))
                                .when(layer.current, |item| {
                                    item.child(path_icon("icons/check.svg", ICON_SM, t.foreground))
                                })
                                .into_any_element(),
                            );
                        }
                        items.push(
                            MenuGroupLabel::new(format!("↳ {}", stack.base)).into_any_element(),
                        );
                        if stack.model.actions_visible {
                            items.push(MenuSeparator::new().into_any_element());
                            for (id, item, icon, action) in [
                                (
                                    "pr-stack-merge-item",
                                    &stack.model.merge_item,
                                    glyph_path(PullRequestGlyphId::Merged),
                                    "merge",
                                ),
                                (
                                    "pr-stack-rebase-item",
                                    &stack.model.rebase_item,
                                    "icons/refresh-cw.svg",
                                    "update-branch",
                                ),
                            ] {
                                if !item.visible {
                                    continue;
                                }
                                let client = self.client.clone();
                                let closer = close(surface.clone());
                                items.push(
                                    MenuItem::new(id)
                                        .disabled(item.disabled)
                                        .on_click(move |_, _, cx| {
                                            closer(cx);
                                            act(
                                                &client,
                                                cx,
                                                "pullRequestDetailStackConfirm",
                                                json!({ "action": action }),
                                            );
                                        })
                                        .child(path_icon(icon, ICON_SM, t.muted_foreground))
                                        .child(SharedString::from(item.label.clone()))
                                        .into_any_element(),
                                );
                            }
                            if let Some(note) = stack.model.blocked_note.clone() {
                                items.push(
                                    div()
                                        .px(px(8.))
                                        .py(px(4.))
                                        .text_size(px(text::XS))
                                        .line_height(px(text::XS_LINE))
                                        .text_color(t.muted_foreground)
                                        .child(SharedString::from(note))
                                        .into_any_element(),
                                );
                            }
                        }
                        popups.push(
                            MenuPopup::new("pr-stack-menu", *trigger)
                                .side(Side::Bottom)
                                .align(Align::Start)
                                .on_dismiss(dismiss(*trigger, surface.clone()))
                                .children(items)
                                .into_any_element(),
                        );
                    }
                }
                OpenMenu::Freshness => {
                    if let (Some(trigger), Some(freshness)) = (
                        anchors.get(FRESHNESS_ANCHOR),
                        model
                            .header
                            .as_ref()
                            .and_then(|header| header.freshness.as_ref()),
                    ) {
                        popups.push(
                            PopoverPopup::new("pr-freshness-popover", *trigger)
                                .side(Side::Bottom)
                                .align(Align::Start)
                                .padding(PopoverPadding::Compact)
                                .on_dismiss(dismiss(*trigger, surface.clone()))
                                .child(
                                    div()
                                        .max_w(px(320.))
                                        .text_size(px(text::XS))
                                        .line_height(px(text::XS_LINE))
                                        .child(
                                            div().text_color(t.foreground).child(
                                                SharedString::from(freshness.summary.clone()),
                                            ),
                                        )
                                        .child(
                                            div()
                                                .mt(px(2.))
                                                .text_color(t.muted_foreground)
                                                .child(SharedString::from(freshness.note.clone())),
                                        )
                                        .when(!freshness.methods.is_empty(), |this| {
                                            this.child(
                                                div()
                                                    .mt(px(8.))
                                                    .flex()
                                                    .flex_wrap()
                                                    .items_center()
                                                    .gap(px(6.))
                                                    .children(freshness.methods.iter().map(
                                                        |entry| {
                                                            let client = self.client.clone();
                                                            let method = entry.method.clone();
                                                            let closer = close(surface.clone());
                                                            Button::new(SharedString::from(
                                                                format!(
                                                                    "pr-freshness-{}",
                                                                    entry.method
                                                                ),
                                                            ))
                                                            .size(ButtonSize::Xs)
                                                            .variant(ButtonVariant::Outline)
                                                            .disabled(freshness.disabled)
                                                            .icon(glyph_path(
                                                                PullRequestGlyphId::Merged,
                                                            ))
                                                            .icon_size(ICON_XS)
                                                            .label(entry.label.clone())
                                                            .on_click(move |_, _, cx| {
                                                                closer(cx);
                                                                act(
                                                                    &client,
                                                                    cx,
                                                                    "pullRequestDetailUpdateBranch",
                                                                    json!({ "method": method }),
                                                                );
                                                            })
                                                        },
                                                    )),
                                            )
                                        }),
                                )
                                .into_any_element(),
                        );
                    }
                }
            }
        }
        if let Some(popover) = self.popover.as_ref()
            && popover.anchor() == CHECKS_ANCHOR
            && let Some(trigger) = anchors.get(CHECKS_ANCHOR)
        {
            popups.push(pull_request_popover(popover, *trigger, &self.client, cx));
        }
        popups
    }

    fn actions_menu(
        &self,
        view: &PullRequestDetailShellView,
        menu: &crate::app_core::views::pull_request_detail::DetailMenuModel,
        trigger: Bounds<Pixels>,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> AnyElement {
        let surface = cx.entity().downgrade();
        let close = |surface: WeakEntity<Self>| {
            move |cx: &mut App| {
                let _ = surface.update(cx, |surface, cx| surface.close_menu(cx));
            }
        };
        let item = |id: &'static str,
                    icon: &'static str,
                    label: &str,
                    disabled: bool,
                    action: &'static str,
                    params: Value| {
            let client = self.client.clone();
            let closer = close(surface.clone());
            MenuItem::new(id)
                .disabled(disabled)
                .on_click(move |_, _, cx| {
                    closer(cx);
                    act(&client, cx, action, params.clone());
                })
                .child(path_icon(icon, ICON_SM, t.muted_foreground))
                .child(SharedString::from(label.to_string()))
        };
        let mut items: Vec<AnyElement> = Vec::new();
        if let Some(links) = view.thread_links.as_ref() {
            items.push(
                item(
                    "pr-menu-thread-link",
                    glyph_path(links.model.menu_item.icon),
                    &links.model.menu_item.label,
                    links.model.menu_item.disabled,
                    "pullRequestDetailThreadLinkMenu",
                    json!({}),
                )
                .into_any_element(),
            );
        }
        {
            let client = self.client.clone();
            let closer = close(surface.clone());
            items.push(
                MenuItem::new("pr-menu-refresh")
                    .disabled(menu.refresh.disabled)
                    .on_click(move |_, _, cx| {
                        closer(cx);
                        act(&client, cx, "pullRequestDetailRefresh", json!({}));
                    })
                    .child(refresh_icon(
                        "pr-menu-refresh-spin",
                        ICON_SM,
                        t.muted_foreground,
                        menu.trigger.refreshing,
                    ))
                    .child(SharedString::from(menu.refresh.label.clone()))
                    .into_any_element(),
            );
        }
        for (id, icon, entry, action) in [
            (
                "pr-menu-ask",
                "icons/message-circle-question-mark.svg",
                &menu.ask,
                "pullRequestDetailAsk",
            ),
            (
                "pr-menu-explain",
                "icons/book-open.svg",
                &menu.explain,
                "pullRequestDetailExplain",
            ),
        ] {
            let closer = close(surface.clone());
            let client = self.client.clone();
            items.push(
                MenuItem::new(id)
                    .disabled(entry.disabled)
                    .on_click(move |_, _, cx| {
                        closer(cx);
                        act(&client, cx, action, json!({}));
                    })
                    .child(
                        div()
                            .flex()
                            .min_w_0()
                            .items_start()
                            .gap(px(8.))
                            .child(div().mt(px(4.)).flex_none().child(path_icon(
                                icon,
                                ICON_SM,
                                t.muted_foreground,
                            )))
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .min_w_0()
                                    .child(SharedString::from(entry.label.clone()))
                                    .child(
                                        div()
                                            .text_size(px(text::XS))
                                            .line_height(px(text::XS_LINE))
                                            .text_color(t.muted_foreground)
                                            .child(SharedString::from(
                                                entry.description.clone().unwrap_or_default(),
                                            )),
                                    ),
                            ),
                    )
                    .into_any_element(),
            );
        }
        items.push(
            item(
                "pr-menu-fix-findings",
                "icons/hammer.svg",
                &menu.fix_findings.label,
                menu.fix_findings.disabled,
                "pullRequestDetailFixFindings",
                json!({}),
            )
            .into_any_element(),
        );
        self.environment_picker("pr-menu", &menu.environments, t, &mut items);
        items.push(MenuSeparator::new().into_any_element());
        let group = &menu.action_group;
        if group.visible {
            if group.draft_toggle.visible {
                let icon = group.draft_toggle.icon.unwrap_or(PullRequestGlyphId::Draft);
                items.push(
                    item(
                        "pr-menu-draft-toggle",
                        glyph_path(icon),
                        &group.draft_toggle.label,
                        group.draft_toggle.disabled,
                        "pullRequestDetailPerform",
                        json!({ "action": group.draft_toggle.action }),
                    )
                    .into_any_element(),
                );
            }
            if group.merge_now.visible {
                items.push(
                    item(
                        "pr-menu-merge-now",
                        glyph_path(PullRequestGlyphId::Merged),
                        &group.merge_now.label,
                        group.merge_now.disabled,
                        "pullRequestDetailConfirm",
                        json!({ "action": "merge" }),
                    )
                    .into_any_element(),
                );
            }
            if group.auto_merge.visible {
                let (action, params) = if group.auto_merge.action == "disable-auto-merge" {
                    (
                        "pullRequestDetailPerform",
                        json!({ "action": "disable-auto-merge" }),
                    )
                } else {
                    (
                        "pullRequestDetailConfirm",
                        json!({ "action": "enable-auto-merge" }),
                    )
                };
                items.push(
                    item(
                        "pr-menu-auto-merge",
                        glyph_path(PullRequestGlyphId::Merged),
                        &group.auto_merge.label,
                        group.auto_merge.disabled,
                        action,
                        params,
                    )
                    .into_any_element(),
                );
            }
            if group.merge_methods.visible {
                if group.merge_methods.separator_before {
                    items.push(MenuSeparator::new().into_any_element());
                }
                for option in &group.merge_methods.options {
                    let client = self.client.clone();
                    let closer = close(surface.clone());
                    let method = option.method.clone();
                    items.push(
                        MenuRadioItem::new(SharedString::from(format!(
                            "pr-menu-merge-method-{}",
                            option.method
                        )))
                        .checked(option.method == group.merge_methods.value)
                        .disabled(group.merge_methods.disabled)
                        .on_click(move |_, _, cx| {
                            closer(cx);
                            act(
                                &client,
                                cx,
                                "pullRequestDetailSetMergeMethod",
                                json!({ "method": method }),
                            );
                        })
                        .child(
                            div()
                                .flex()
                                .min_w_0()
                                .items_center()
                                .gap(px(8.))
                                .child(path_icon(
                                    glyph_path(PullRequestGlyphId::Merged),
                                    ICON_SM,
                                    t.foreground,
                                ))
                                .child(SharedString::from(option.label.clone())),
                        )
                        .into_any_element(),
                    );
                }
            }
            if group.separator_after {
                items.push(MenuSeparator::new().into_any_element());
            }
        }
        items.push(
            item(
                "pr-menu-open-on-host",
                "icons/arrow-up-right.svg",
                &menu.open_on_host.label,
                false,
                "pullRequestDetailOpenUrl",
                json!({ "url": menu.open_on_host.url }),
            )
            .into_any_element(),
        );
        for (id, icon, entry, target) in [
            (
                "pr-menu-copy-link",
                "icons/link.svg",
                &menu.copy_link,
                "link",
            ),
            (
                "pr-menu-copy-number",
                "icons/copy.svg",
                &menu.copy_number,
                "number",
            ),
        ] {
            items.push(
                item(
                    id,
                    icon,
                    &entry.label,
                    false,
                    "pullRequestDetailCopy",
                    json!({ "target": target }),
                )
                .when_some(entry.shortcut.clone(), |item, shortcut| {
                    item.shortcut(shortcut)
                })
                .into_any_element(),
            );
        }
        if let Some(lifecycle) = menu.lifecycle.as_ref() {
            items.push(MenuSeparator::new().into_any_element());
            let icon = match lifecycle.icon.as_str() {
                "closed" => glyph_path(PullRequestGlyphId::Closed),
                "reopen" => glyph_path(PullRequestGlyphId::Reopen),
                _ => "icons/rotate-ccw.svg",
            };
            let color = if lifecycle.destructive {
                t.destructive_foreground
            } else {
                t.muted_foreground
            };
            let client = self.client.clone();
            let closer = close(surface.clone());
            items.push(
                MenuItem::new("pr-menu-lifecycle")
                    .variant(if lifecycle.destructive {
                        MenuItemVariant::Destructive
                    } else {
                        MenuItemVariant::Default
                    })
                    .disabled(lifecycle.disabled)
                    .on_click(move |_, _, cx| {
                        closer(cx);
                        act(&client, cx, "pullRequestDetailLifecycle", json!({}));
                    })
                    .child(path_icon(icon, ICON_SM, color))
                    .child(SharedString::from(lifecycle.label.clone()))
                    .into_any_element(),
            );
        }
        let dismiss_surface = surface.clone();
        MenuPopup::new("pr-actions-menu", trigger)
            .side(Side::Bottom)
            .align(Align::End)
            .on_dismiss(move |window, cx| {
                if trigger.contains(&window.mouse_position()) {
                    return;
                }
                let _ = dismiss_surface.update(cx, |surface, cx| surface.close_menu(cx));
            })
            .children(items)
            .into_any_element()
    }

    fn dialogs(&self, view: &PullRequestDetailShellView, t: &Tokens) -> Vec<AnyElement> {
        let mut dialogs = Vec::new();
        if let Some(model) = view.model.as_ref()
            && view.confirmation_open
        {
            let confirmation = &model.confirmation;
            let cancel = self.client.clone();
            let dismiss = self.client.clone();
            dialogs.push(
                AlertDialogPopup::new("pr-detail-confirm")
                    .on_dismiss(move |_, cx| {
                        act(&dismiss, cx, "pullRequestDetailConfirmCancel", json!({}))
                    })
                    .child(
                        AlertDialogHeader::new()
                            .child(AlertDialogTitle::new(confirmation.title.clone()))
                            .child(AlertDialogDescription::new(
                                confirmation.description.clone(),
                            )),
                    )
                    .child(
                        AlertDialogFooter::new()
                            .child(
                                Button::new("pr-detail-confirm-cancel")
                                    .size(ButtonSize::Sm)
                                    .variant(ButtonVariant::Outline)
                                    .label(confirmation.cancel_label.clone())
                                    .on_click(move |_, _, cx| {
                                        act(
                                            &cancel,
                                            cx,
                                            "pullRequestDetailConfirmCancel",
                                            json!({}),
                                        )
                                    }),
                            )
                            .child(
                                Button::new("pr-detail-confirm-accept")
                                    .size(ButtonSize::Sm)
                                    .variant(if confirmation.destructive {
                                        ButtonVariant::Destructive
                                    } else {
                                        ButtonVariant::Default
                                    })
                                    .disabled(confirmation.confirm_disabled)
                                    .label(confirmation.confirm_label.clone())
                                    .on_click(
                                        self.act_button(
                                            "pullRequestDetailConfirmAccept",
                                            json!({}),
                                        ),
                                    ),
                            ),
                    )
                    .into_any_element(),
            );
        }
        if let Some(stack) = view.stack_menu.as_ref()
            && stack.model.dialog.open
        {
            let dialog = &stack.model.dialog;
            let close = self.client.clone();
            let cancel = self.client.clone();
            dialogs.push(
                DialogPopup::new("pr-stack-dialog")
                    .max_width(448.)
                    .show_close_button(dialog.dismissible)
                    .on_close(move |_, cx| {
                        act(&close, cx, "pullRequestDetailStackCancel", json!({}))
                    })
                    .child(
                        DialogHeader::new()
                            .child(DialogTitle::new(dialog.title.clone()))
                            .child(DialogDescription::new(dialog.description.clone())),
                    )
                    .child(
                        div()
                            .id("pr-stack-dialog-layers")
                            .px(px(24.))
                            .max_h(px(192.))
                            .overflow_y_scroll()
                            .flex()
                            .flex_col()
                            .gap(px(4.))
                            .text_size(px(text::SM))
                            .line_height(px(text::SM_LINE))
                            .children(stack.dialog_layers.iter().map(|layer| {
                                let color = tone(&layer.state.tone_class_name, t);
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(8.))
                                    .rounded(px(8.))
                                    .bg(fade(t.muted, 0.5))
                                    .px(px(12.))
                                    .py(px(8.))
                                    .child(stack_layer(layer, color, t))
                            })),
                    )
                    .child(
                        DialogFooter::new()
                            .child(
                                Button::new("pr-stack-dialog-cancel")
                                    .variant(ButtonVariant::Outline)
                                    .disabled(dialog.buttons_disabled)
                                    .label(dialog.cancel_label.clone())
                                    .on_click(move |_, _, cx| {
                                        act(&cancel, cx, "pullRequestDetailStackCancel", json!({}))
                                    }),
                            )
                            .child(
                                Button::new("pr-stack-dialog-confirm")
                                    .disabled(dialog.buttons_disabled)
                                    .label(dialog.confirm_label.clone())
                                    .on_click(
                                        self.act_button("pullRequestDetailStackRun", json!({})),
                                    ),
                            ),
                    )
                    .into_any_element(),
            );
        }
        if let Some(links) = view.thread_links.as_ref()
            && let Some(picker) = links.picker.as_ref()
        {
            let close = self.client.clone();
            dialogs.push(
                DialogPopup::new("pr-thread-picker")
                    .max_width(448.)
                    .show_close_button(false)
                    .on_close(move |_, cx| {
                        act(&close, cx, "pullRequestDetailThreadPickerClose", json!({}))
                    })
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .when_some(self.picker_input.as_ref(), |this, input| {
                                this.child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap(px(8.))
                                        .px(px(12.))
                                        .border_b_1()
                                        .border_color(t.border)
                                        .child(path_icon(
                                            "icons/search.svg",
                                            16.,
                                            t.muted_foreground,
                                        ))
                                        .child(div().flex_1().child(
                                            Input::new(input).disabled(picker.search_disabled),
                                        )),
                                )
                            })
                            .child(
                                div()
                                    .id("pr-thread-picker-list")
                                    .max_h(px(320.))
                                    .overflow_y_scroll()
                                    .p(px(4.))
                                    .map(|this| match picker.empty_label.clone() {
                                        Some(label) => this.child(
                                            div()
                                                .px(px(12.))
                                                .py(px(24.))
                                                .text_center()
                                                .text_size(px(text::SM))
                                                .text_color(t.muted_foreground)
                                                .child(SharedString::from(label)),
                                        ),
                                        None => this.children(picker.rows.iter().map(|row| {
                                            let client = self.client.clone();
                                            let thread_id = row.id.clone();
                                            MenuItem::new(SharedString::from(format!(
                                                "pr-thread-picker-{}",
                                                row.id
                                            )))
                                            .disabled(row.disabled)
                                            .on_click(move |_, _, cx| {
                                                act(
                                                    &client,
                                                    cx,
                                                    "pullRequestDetailThreadPickerSelect",
                                                    json!({ "threadId": thread_id }),
                                                )
                                            })
                                            .child(path_icon(
                                                "icons/message-square.svg",
                                                16.,
                                                t.muted_foreground,
                                            ))
                                            .child(
                                                div()
                                                    .flex()
                                                    .flex_1()
                                                    .flex_col()
                                                    .min_w_0()
                                                    .child(div().truncate().child(
                                                        SharedString::from(row.title.clone()),
                                                    ))
                                                    .when_some(
                                                        row.project_title.clone(),
                                                        |this, project| {
                                                            this.child(
                                                                div()
                                                                    .truncate()
                                                                    .text_size(px(text::XS))
                                                                    .text_color(t.muted_foreground)
                                                                    .child(SharedString::from(
                                                                        project,
                                                                    )),
                                                            )
                                                        },
                                                    ),
                                            )
                                            .when(
                                                row.linked,
                                                |item| {
                                                    item.child(path_icon(
                                                        "icons/check.svg",
                                                        ICON_SM,
                                                        t.foreground,
                                                    ))
                                                    .child(
                                                        div()
                                                            .text_size(px(text::XS))
                                                            .text_color(t.muted_foreground)
                                                            .child(SharedString::from(
                                                                row.linked_label.clone(),
                                                            )),
                                                    )
                                                },
                                            )
                                        })),
                                    }),
                            ),
                    )
                    .into_any_element(),
            );
        }
        dialogs
    }

    fn header(
        &self,
        view: &PullRequestDetailShellView,
        model: &DetailModel,
        condensed: bool,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> AnyElement {
        let width = self.width.get();
        let width_cell = self.width.clone();
        let header = model.header.as_ref();
        div()
            .relative()
            .flex()
            .flex_col()
            .flex_none()
            .min_w_0()
            .when(model.chrome.bordered, |this| {
                this.border_b_1().border_color(fade(t.border, 0.6))
            })
            .when(!model.chrome.visible, |this| this.hidden())
            .child(
                canvas(
                    move |bounds, _, _| width_cell.set(f32::from(bounds.size.width)),
                    |_, _, _, _| {},
                )
                .absolute()
                .top_0()
                .left_0()
                .size_full(),
            )
            .child(
                div()
                    .flex()
                    .items_start()
                    .gap(px(8.))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .h(px(HEADER_ROW))
                            .pl(px(INSET_X))
                            .flex()
                            .items_center()
                            .overflow_hidden()
                            .when_some(header, |this, header| {
                                this.child(self.title_line(model, header, condensed, t))
                            }),
                    )
                    .child(
                        div()
                            .flex_none()
                            .mr(px(INSET_X))
                            .h(px(HEADER_ROW))
                            .flex()
                            .items_center()
                            .justify_end()
                            .gap(px(4.))
                            .children(self.right_controls(view, model, width, t, cx)),
                    ),
            )
            .when_some(header.filter(|_| condensed), |this, header| {
                this.child(self.condensed_row(view, header, t, cx))
            })
            .when_some(header.filter(|_| !condensed), |this, header| {
                this.child(self.fold(view, header, t, cx))
            })
            .when_some(model.nav.as_ref(), |this, nav| {
                this.child(self.nav(view, model, nav, t))
            })
            .into_any_element()
    }
}

fn stack_number(aria_label: &str) -> String {
    aria_label
        .strip_prefix("Stack ")
        .and_then(|rest| rest.split(',').next())
        .unwrap_or_default()
        .to_string()
}

fn stack_layer(
    layer: &crate::app_core::views::pull_requests::PullRequestStackLayerView,
    color: gpui::Rgba,
    t: &Tokens,
) -> AnyElement {
    div()
        .flex()
        .flex_1()
        .min_w_0()
        .items_center()
        .gap(px(8.))
        .child(path_icon(glyph_path(layer.state.icon), 16., color))
        .child(
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .child(
                    div()
                        .truncate()
                        .child(SharedString::from(layer.title.clone())),
                )
                .child(
                    div()
                        .truncate()
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .font_weight(FontWeight::NORMAL)
                        .text_color(t.muted_foreground)
                        .child(SharedString::from(layer.subtitle.clone())),
                ),
        )
        .into_any_element()
}

impl Render for PullRequestDetailSurface {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.ensure_inputs(window, cx);
        self.sync_inputs(window, cx);
        let t = theme::active(cx);
        let Some(view) = self.data.clone() else {
            return div().size_full().into_any_element();
        };
        let anchors = self.bounds.borrow().clone();
        let copy = self.copy_handler(cx);
        let content = if let Some(gate) = view.gate.as_ref() {
            match gate {
                DetailGateView::Ghost { ghost } => detail_ghost(
                    GhostChrome {
                        ghost,
                        actions: None,
                        on_back: false,
                        base_split: view.branch_splits.base.as_ref(),
                        copied: self.copied,
                        copy: Some(copy),
                    },
                    &self.client,
                    cx,
                ),
                DetailGateView::Unavailable { title, description } => {
                    unavailable_state(title, description, None, None, &self.client, cx)
                }
            }
        } else if let Some(model) = view.model.clone() {
            if model.loading {
                let actions = model.ghost_actions.visible.then(|| {
                    let width = self.width.get();
                    let narrow = width > 0. && width < NARROW_ACTIONS;
                    div()
                        .flex()
                        .items_center()
                        .gap(px(4.))
                        .children(self.checkout_trigger(&model, width, &t, cx))
                        .when(model.ghost_actions.resolve_conflicts, |this| {
                            this.child(self.header_action_button(
                                "pr-detail-resolve",
                                &model.resolve_conflicts,
                                ButtonVariant::DestructiveOutline,
                                glyph_path(PullRequestGlyphId::Conflicting),
                                narrow,
                                ("pullRequestDetailResolveConflicts", json!({})),
                            ))
                        })
                        .into_any_element()
                });
                match view.ghost.as_ref() {
                    Some(ghost) => detail_ghost(
                        GhostChrome {
                            ghost,
                            actions,
                            on_back: model.chrome.back.visible,
                            base_split: view.branch_splits.base.as_ref(),
                            copied: self.copied,
                            copy: Some(copy),
                        },
                        &self.client,
                        cx,
                    ),
                    None => div().into_any_element(),
                }
            } else {
                let tab = model.tabs.active.clone();
                let condensed = self.condensed_by_tab.get(&tab).copied().unwrap_or(false);
                let header = self.header(&view, &model, condensed, &t, cx);
                let body = self.body(&view, &model, cx);
                div()
                    .size_full()
                    .flex()
                    .flex_col()
                    .child(header)
                    .child(
                        div()
                            .relative()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_h_0()
                            .overflow_hidden()
                            .child(body),
                    )
                    .child(
                        div()
                            .absolute()
                            .right(px(INSET_X))
                            .bottom(px(12.))
                            .child(self.composer.clone()),
                    )
                    .into_any_element()
            }
        } else {
            div().into_any_element()
        };
        let popups = self.popups(&view, view.model.as_deref(), &anchors, cx);
        let dialogs = self.dialogs(&view, &t);
        div()
            .track_focus(&self.focus)
            .relative()
            .size_full()
            .flex()
            .flex_col()
            .bg(t.background)
            .child(content)
            .children(popups)
            .children(dialogs)
            .into_any_element()
    }
}
