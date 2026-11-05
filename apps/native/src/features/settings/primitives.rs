use std::collections::HashMap;
use std::rc::Rc;
use std::time::{Duration, Instant};

use gpui::component::input::{InputEvent, InputState};
use gpui::prelude::FluentBuilder;
use gpui::{
    Animation, AnimationExt, AnyElement, App, AppContext, Bounds, BoxShadow, Context, Div,
    ElementId, Entity, Focusable, FontWeight, Global, InteractiveElement, IntoElement,
    KeyDownEvent, MouseButton, MouseDownEvent, MouseMoveEvent, ParentElement, Pixels, Rgba,
    SharedString, StatefulInteractiveElement, Styled, Window, canvas, div, point, px, svg,
};
use serde_json::{Value, json};

use crate::app_core::client::CoreClient;
use crate::app_core::views::settings::{
    SettingInheritanceChainView, SettingInheritanceModelView, SettingInheritanceResetView,
    SettingsRowOverridingProjectView, SettingsRowResetView, SettingsRowScopeView,
};
use crate::features::sidebar::machine_icon;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::input::{Input, InputSize};
use crate::ui::popover::{Align, PopoverPadding, PopoverPopup, PopoverWidth, Side};
use crate::ui::select::{Select, SelectItem, SelectSize};
use crate::ui::switch::Switch;
use crate::ui::theme;
use crate::ui::theme::color::{BLACK, alpha};
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Appearance, Tokens, fade};
use crate::ui::tooltip::Tooltip;

pub const PAGE_MAX_WIDTH: f32 = 896.;
pub const PAGE_PADDING_X: f32 = 24.;
pub const PAGE_PADDING_TOP: f32 = 24.;
pub const PAGE_PADDING_BOTTOM: f32 = 48.;
pub const PAGE_GAP: f32 = 32.;
pub const SECTION_HEADER_MIN_HEIGHT: f32 = 28.;
pub const SECTION_INSET_X: f32 = 16.;
pub const SECTION_HEADER_GAP: f32 = 16.;
pub const SECTION_STACK_GAP: f32 = 10.;
pub const GROUP_RADIUS: f32 = 14.;
pub const PLAIN_GROUP_GAP: f32 = 4.;
pub const ROW_PADDING_X: f32 = 16.;
pub const ROW_PADDING_Y: f32 = 12.;
pub const ROW_CHILDREN_PADDING_BOTTOM: f32 = 4.;
pub const ROW_WIDE_MIN: f32 = 512.;
pub const ROW_WIDE_GAP: f32 = 32.;
pub const ROW_NARROW_GAP: f32 = 12.;
pub const ROW_CONTROL_MIN_WIDTH: f32 = 160.;
pub const ROW_CONTROL_GAP: f32 = 8.;
pub const ROW_TEXT_GAP: f32 = 4.;
pub const ROW_TITLE_GAP: f32 = 6.;
pub const ROW_SLOT: f32 = 20.;
pub const ROW_DESCRIPTION_MAX_WIDTH: f32 = 576.;
pub const ROW_DESCRIPTION_LINE: f32 = 18.;
pub const ROW_STATUS_PADDING_TOP: f32 = 2.;
pub const DISABLED_ROW_OPACITY: f32 = 0.64;
pub const INERT_OPACITY: f32 = 0.5;
pub const SELECT_WIDTH: f32 = 160.;
pub const NUMBER_INPUT_WIDTH: f32 = 96.;
pub const TEXT_INPUT_WIDTH: f32 = 288.;
pub const SLIDER_CONTROL_WIDTH: f32 = 208.;
pub const SLIDER_GAP: f32 = 12.;
pub const SLIDER_HEIGHT: f32 = 24.;
pub const SLIDER_TRACK: f32 = 6.;
pub const SLIDER_THUMB: f32 = 16.;
pub const SLIDER_VALUE_MIN_WIDTH: f32 = 48.;
pub const PULSE_CYCLE_MS: u64 = 650;
pub const PULSE_CYCLES: u64 = 2;
pub const PULSE_RADIUS: f32 = 12.;
pub const FOLDED_HEADER_MIN_HEIGHT: f32 = 44.;
pub const UNAVAILABLE_TEXT_OPACITY: f32 = 0.64;

const INHERITANCE_POPOVER_SECTION_X: f32 = 12.;
const INHERITANCE_POPOVER_SECTION_Y: f32 = 10.;
const INHERITANCE_LAYER_X: f32 = 8.;
const INHERITANCE_LAYER_Y: f32 = 4.;
const INHERITANCE_VALUE_MAX_WIDTH: f32 = 128.;
const DISMISS_GRACE_MS: u64 = 300;

#[derive(Default)]
pub struct SettingsTargets {
    bounds: HashMap<SharedString, Bounds<Pixels>>,
    target: Option<SharedString>,
    pulse: Option<(SharedString, u64, Instant)>,
    content_width: Option<f32>,
}

impl Global for SettingsTargets {}

impl SettingsTargets {
    pub(crate) fn set_target(cx: &mut App, target: Option<SharedString>) {
        cx.default_global::<SettingsTargets>().target = target;
    }

    pub(crate) fn bounds_of(cx: &App, id: &str) -> Option<Bounds<Pixels>> {
        cx.try_global::<SettingsTargets>()
            .and_then(|targets| targets.bounds.get(id).copied())
    }

    pub(crate) fn start_pulse(cx: &mut App, id: SharedString, revision: u64) {
        cx.default_global::<SettingsTargets>().pulse = Some((id, revision, Instant::now()));
    }

    pub(crate) fn clear_bounds(cx: &mut App) {
        cx.default_global::<SettingsTargets>().bounds.clear();
    }

    pub(crate) fn set_content_width(cx: &mut App, width: f32) -> bool {
        let targets = cx.default_global::<SettingsTargets>();
        let changed = targets
            .content_width
            .is_none_or(|current| (current - width).abs() > 0.5);
        targets.content_width = Some(width);
        changed
    }

    fn target(cx: &App) -> Option<SharedString> {
        cx.try_global::<SettingsTargets>()
            .and_then(|targets| targets.target.clone())
    }

    fn pulse(cx: &App, id: &str) -> Option<u64> {
        let (pulse_id, revision, started) = cx.try_global::<SettingsTargets>()?.pulse.clone()?;
        (pulse_id.as_ref() == id
            && started.elapsed() < Duration::from_millis(PULSE_CYCLE_MS * PULSE_CYCLES))
        .then_some(revision)
    }

    fn wide(cx: &App) -> bool {
        cx.try_global::<SettingsTargets>()
            .and_then(|targets| targets.content_width)
            .is_none_or(|width| width - 2. - ROW_PADDING_X * 2. >= ROW_WIDE_MIN)
    }
}

fn target_probe(id: SharedString) -> impl IntoElement {
    canvas(
        move |bounds, _, cx| {
            cx.default_global::<SettingsTargets>()
                .bounds
                .insert(id.clone(), bounds);
        },
        |_, _, _, _| {},
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full()
}

fn ease_in_out(t: f32) -> f32 {
    if t < 0.5 {
        2. * t * t
    } else {
        1. - (-2. * t + 2.).powi(2) / 2.
    }
}

fn pulse_overlay(id: &SharedString, cx: &App) -> Option<AnyElement> {
    let revision = SettingsTargets::pulse(cx, id)?;
    let color = theme::active(cx).primary;
    Some(
        div()
            .absolute()
            .top_0()
            .left_0()
            .size_full()
            .rounded(px(PULSE_RADIUS))
            .with_animation(
                ElementId::Name(SharedString::from(format!(
                    "settings-pulse-{id}-{revision}"
                ))),
                Animation::new(Duration::from_millis(PULSE_CYCLE_MS * PULSE_CYCLES)),
                move |overlay, progress| {
                    let cycle = (progress * PULSE_CYCLES as f32).fract();
                    let half = if cycle < 0.5 {
                        cycle * 2.
                    } else {
                        (1. - cycle) * 2.
                    };
                    let strength = if progress >= 1. {
                        0.
                    } else {
                        ease_in_out(half)
                    };
                    overlay.shadow(vec![BoxShadow {
                        color: alpha(color, 0.7 * strength).into(),
                        offset: point(px(0.), px(0.)),
                        blur_radius: px(0.),
                        spread_radius: px(2. * strength),
                        inset: false,
                    }])
                },
            )
            .into_any_element(),
    )
}

pub fn settings_stack() -> Div {
    div().flex().flex_col().w_full().gap(px(PAGE_GAP))
}

pub fn settings_target(id: impl Into<SharedString>, child: impl IntoElement, cx: &App) -> Div {
    let id = id.into();
    div()
        .relative()
        .w_full()
        .child(child)
        .child(target_probe(id.clone()))
        .children(pulse_overlay(&id, cx))
}

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SettingsGroupVariant {
    #[default]
    Grouped,
    Plain,
}

#[derive(IntoElement)]
pub struct SettingsGroup {
    variant: SettingsGroupVariant,
    divided: bool,
    children: Vec<AnyElement>,
}

impl SettingsGroup {
    pub fn new() -> Self {
        Self {
            variant: SettingsGroupVariant::Grouped,
            divided: true,
            children: Vec::new(),
        }
    }

    pub fn variant(mut self, variant: SettingsGroupVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn divided(mut self, divided: bool) -> Self {
        self.divided = divided;
        self
    }
}

impl Default for SettingsGroup {
    fn default() -> Self {
        Self::new()
    }
}

impl ParentElement for SettingsGroup {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

pub(crate) fn group_surface(t: &Tokens) -> Div {
    div()
        .relative()
        .flex()
        .flex_col()
        .w_full()
        .text_color(t.foreground)
        .rounded(px(GROUP_RADIUS))
        .border_1()
        .border_color(fade(t.border, 0.6))
        .bg(fade(t.card, 0.4))
        .shadow(vec![BoxShadow {
            color: alpha(BLACK, 0.05).into(),
            offset: point(px(0.), px(1.)),
            blur_radius: px(2.),
            spread_radius: px(0.),
            inset: false,
        }])
}

fn divided_children(children: Vec<AnyElement>, t: &Tokens) -> Vec<AnyElement> {
    let divider = fade(t.border, 0.5);
    children
        .into_iter()
        .enumerate()
        .map(|(index, child)| {
            if index == 0 {
                child
            } else {
                div()
                    .w_full()
                    .border_t_1()
                    .border_color(divider)
                    .child(child)
                    .into_any_element()
            }
        })
        .collect()
}

impl gpui::RenderOnce for SettingsGroup {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        match self.variant {
            SettingsGroupVariant::Grouped => {
                let children = if self.divided {
                    divided_children(self.children, &t)
                } else {
                    self.children
                };
                group_surface(&t).children(children)
            }
            SettingsGroupVariant::Plain => div()
                .relative()
                .flex()
                .flex_col()
                .w_full()
                .gap(px(PLAIN_GROUP_GAP))
                .text_color(t.foreground)
                .children(self.children),
        }
    }
}

fn section_title(title: SharedString, icon: Option<AnyElement>, t: &Tokens) -> Div {
    div()
        .flex()
        .min_h(px(SECTION_HEADER_MIN_HEIGHT))
        .items_center()
        .gap(px(8.))
        .text_size(px(text::SM))
        .line_height(px(text::SM_LINE))
        .font_weight(FontWeight::NORMAL)
        .text_color(fade(t.foreground, 0.7))
        .children(icon)
        .child(title)
}

#[derive(IntoElement)]
pub struct SettingsSection {
    title: SharedString,
    id: Option<SharedString>,
    hide_title: bool,
    icon: Option<AnyElement>,
    header_action: Option<AnyElement>,
    variant: SettingsGroupVariant,
    children: Vec<AnyElement>,
}

impl SettingsSection {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self {
            title: title.into(),
            id: None,
            hide_title: false,
            icon: None,
            header_action: None,
            variant: SettingsGroupVariant::Grouped,
            children: Vec::new(),
        }
    }

    pub fn id(mut self, id: impl Into<SharedString>) -> Self {
        self.id = Some(id.into());
        self
    }

    pub fn hide_title(mut self) -> Self {
        self.hide_title = true;
        self
    }

    pub fn icon(mut self, icon: impl IntoElement) -> Self {
        self.icon = Some(icon.into_any_element());
        self
    }

    pub fn header_action(mut self, action: impl IntoElement) -> Self {
        self.header_action = Some(action.into_any_element());
        self
    }

    pub fn variant(mut self, variant: SettingsGroupVariant) -> Self {
        self.variant = variant;
        self
    }
}

impl ParentElement for SettingsSection {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl gpui::RenderOnce for SettingsSection {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let group = SettingsGroup::new()
            .variant(self.variant)
            .children(self.children);
        let id = self.id.clone();
        let pulse = id.as_ref().and_then(|id| pulse_overlay(id, cx));
        if self.hide_title {
            return div()
                .relative()
                .w_full()
                .child(group)
                .children(id.map(target_probe))
                .children(pulse);
        }
        let header = div()
            .relative()
            .flex()
            .min_h(px(SECTION_HEADER_MIN_HEIGHT))
            .items_start()
            .justify_between()
            .gap(px(SECTION_HEADER_GAP))
            .px(px(SECTION_INSET_X))
            .child(
                div()
                    .min_w_0()
                    .child(section_title(self.title, self.icon, &t)),
            )
            .child(
                div()
                    .flex()
                    .flex_none()
                    .min_h(px(SECTION_HEADER_MIN_HEIGHT))
                    .min_w(px(SECTION_HEADER_MIN_HEIGHT))
                    .items_center()
                    .justify_end()
                    .children(self.header_action),
            )
            .children(id.map(target_probe))
            .children(pulse);
        div()
            .flex()
            .flex_col()
            .w_full()
            .gap(px(SECTION_STACK_GAP))
            .child(header)
            .child(group)
    }
}

type ResetHandler = Rc<dyn Fn(&mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct SettingsRow {
    id: SharedString,
    title: SharedString,
    title_element: Option<AnyElement>,
    description: Option<AnyElement>,
    status: Option<AnyElement>,
    control: Option<AnyElement>,
    reset_action: Option<AnyElement>,
    scope: Option<(SettingsRowScopeView, Entity<CoreClient>)>,
    on_reset_override: Option<ResetHandler>,
    disabled: bool,
    children: Vec<AnyElement>,
}

impl SettingsRow {
    pub fn new(id: impl Into<SharedString>, title: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            title_element: None,
            description: None,
            status: None,
            control: None,
            reset_action: None,
            scope: None,
            on_reset_override: None,
            disabled: false,
            children: Vec::new(),
        }
    }

    pub fn title_element(mut self, element: impl IntoElement) -> Self {
        self.title_element = Some(element.into_any_element());
        self
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        let description: SharedString = description.into();
        self.description = Some(description.into_any_element());
        self
    }

    pub fn description_element(mut self, description: impl IntoElement) -> Self {
        self.description = Some(description.into_any_element());
        self
    }

    pub fn status(mut self, status: impl IntoElement) -> Self {
        self.status = Some(status.into_any_element());
        self
    }

    pub fn control(mut self, control: impl IntoElement) -> Self {
        self.control = Some(control.into_any_element());
        self
    }

    pub fn reset_action(mut self, reset: impl IntoElement) -> Self {
        self.reset_action = Some(reset.into_any_element());
        self
    }

    pub fn scope(mut self, scope: &SettingsRowScopeView, client: &Entity<CoreClient>) -> Self {
        self.scope = Some((scope.clone(), client.clone()));
        self
    }

    pub fn on_reset_override(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_reset_override = Some(Rc::new(handler));
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}

impl ParentElement for SettingsRow {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

fn inert(id: SharedString, message: SharedString, content: AnyElement, full: bool) -> AnyElement {
    div()
        .relative()
        .flex()
        .items_center()
        .rounded(px(radius::MD))
        .when(full, |this| this.w_full())
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(ROW_CONTROL_GAP))
                .opacity(INERT_OPACITY)
                .when(full, |this| this.w_full())
                .child(content),
        )
        .child(
            div()
                .id(ElementId::Name(SharedString::from(format!("{id}-inert"))))
                .absolute()
                .top_0()
                .left_0()
                .size_full()
                .occlude()
                .tooltip(Tooltip::text(message)),
        )
        .into_any_element()
}

impl gpui::RenderOnce for SettingsRow {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let wide = SettingsTargets::wide(cx);
        let id = self.id.clone();
        let has_children = !self.children.is_empty();
        let disabled = self.disabled;
        let scope = self.scope.as_ref().map(|(scope, _)| scope.clone());
        let unavailable = scope.as_ref().is_some_and(|scope| scope.unavailable);
        let reset = match &self.scope {
            Some((scope, client)) => match &scope.reset {
                SettingsRowResetView::RowAction => self.reset_action,
                SettingsRowResetView::None => None,
                SettingsRowResetView::ClearOverrides { tooltip } => {
                    let keys = scope.scoped_keys.clone();
                    let client = client.clone();
                    let custom = self.on_reset_override.clone();
                    Some(
                        SettingResetButton::new(
                            SharedString::from(format!("{id}-reset-override")),
                            self.title.clone(),
                        )
                        .tooltip(tooltip.clone())
                        .on_click(move |window, cx| match custom.as_ref() {
                            Some(handler) => handler(window, cx),
                            None => act(
                                &client,
                                cx,
                                "settingsClearOverrides",
                                json!({ "keys": keys }),
                            ),
                        })
                        .into_any_element(),
                    )
                }
            },
            None => self.reset_action,
        };
        let inheritance = self.scope.as_ref().and_then(|(scope, client)| {
            scope.inheritance.as_ref()?;
            let model = scope.inheritance_model.as_ref()?;
            model.visible.then(|| {
                InheritanceBadge::new(
                    SharedString::from(format!("{id}-inheritance")),
                    model,
                    &scope.overriding_projects,
                    &scope.scoped_keys,
                    client,
                )
                .into_any_element()
            })
        });
        let control = match (
            self.control,
            scope.as_ref().and_then(|scope| scope.inert_message.clone()),
        ) {
            (Some(control), Some(message)) => Some(inert(
                id.clone(),
                SharedString::from(message),
                control,
                !wide,
            )),
            (control, _) => control,
        };
        let title_color = if disabled {
            t.muted_foreground
        } else {
            t.foreground
        };
        let title = div()
            .flex()
            .min_h(px(ROW_SLOT))
            .items_center()
            .gap(px(ROW_TITLE_GAP))
            .child(
                div()
                    .text_size(px(text::SM))
                    .line_height(px(text::SM_LINE))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(title_color)
                    .child(match self.title_element {
                        Some(element) => element,
                        None => self.title.clone().into_any_element(),
                    }),
            )
            .children(inheritance.map(|badge| {
                div()
                    .flex()
                    .flex_none()
                    .size(px(ROW_SLOT))
                    .items_center()
                    .justify_center()
                    .child(badge)
            }))
            .child(
                div()
                    .flex()
                    .flex_none()
                    .size(px(ROW_SLOT))
                    .items_center()
                    .justify_center()
                    .children(reset),
            );
        let text_column = div()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .gap(px(ROW_TEXT_GAP))
            .child(title)
            .children(self.description.map(|description| {
                div()
                    .max_w(px(ROW_DESCRIPTION_MAX_WIDTH))
                    .text_size(px(text::XS))
                    .line_height(px(ROW_DESCRIPTION_LINE))
                    .text_color(if disabled {
                        t.muted_foreground
                    } else {
                        fade(t.muted_foreground, 0.8)
                    })
                    .child(description)
            }))
            .children(self.status.map(|status| {
                div()
                    .pt(px(ROW_STATUS_PADDING_TOP))
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.muted_foreground)
                    .child(status)
            }));
        let control_column = control.map(|control| {
            div()
                .flex()
                .min_w_0()
                .items_center()
                .gap(px(ROW_CONTROL_GAP))
                .map(|this| {
                    if wide {
                        this.flex_none()
                            .min_w(px(ROW_CONTROL_MIN_WIDTH))
                            .justify_end()
                    } else {
                        this.w_full()
                    }
                })
                .child(control)
        });
        let header = div()
            .flex()
            .w_full()
            .map(|this| {
                if wide {
                    this.flex_row().items_center().gap(px(ROW_WIDE_GAP))
                } else {
                    this.flex_col().gap(px(ROW_NARROW_GAP))
                }
            })
            .child(text_column)
            .children(control_column);
        let children = if unavailable && has_children {
            vec![inert(
                id.clone(),
                SharedString::from(
                    scope
                        .as_ref()
                        .and_then(|scope| scope.inert_message.clone())
                        .unwrap_or_default(),
                ),
                div()
                    .flex()
                    .flex_col()
                    .w_full()
                    .children(self.children)
                    .into_any_element(),
                true,
            )]
        } else {
            self.children
        };
        div()
            .relative()
            .w_full()
            .px(px(ROW_PADDING_X))
            .map(|this| {
                if has_children {
                    this.pt(px(ROW_PADDING_Y))
                        .pb(px(ROW_CHILDREN_PADDING_BOTTOM))
                } else {
                    this.py(px(ROW_PADDING_Y))
                }
            })
            .when(disabled, |this| this.opacity(DISABLED_ROW_OPACITY))
            .child(header)
            .children(children)
            .child(target_probe(id.clone()))
            .children(pulse_overlay(&id, cx))
    }
}

type ClickHandler = Rc<dyn Fn(&mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct SettingResetButton {
    id: SharedString,
    label: SharedString,
    tooltip: SharedString,
    disabled: bool,
    on_click: Option<ClickHandler>,
}

impl SettingResetButton {
    pub fn new(id: impl Into<SharedString>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            tooltip: SharedString::new_static("Reset to default"),
            disabled: false,
            on_click: None,
        }
    }

    pub fn tooltip(mut self, tooltip: impl Into<SharedString>) -> Self {
        self.tooltip = tooltip.into();
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn on_click(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
}

impl gpui::RenderOnce for SettingResetButton {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let handler = self.on_click;
        div()
            .id(ElementId::Name(SharedString::from(format!(
                "{}-tip",
                self.id
            ))))
            .flex()
            .tooltip(Tooltip::text(self.tooltip))
            .child(
                Button::new(ElementId::Name(self.id))
                    .size(ButtonSize::IconMicro)
                    .variant(ButtonVariant::GhostMuted)
                    .icon("undo-2")
                    .icon_size(12.)
                    .disabled(self.disabled)
                    .accessibility_label(format!("Reset {} to default", self.label))
                    .on_click(move |_, window, cx| {
                        cx.stop_propagation();
                        if let Some(handler) = handler.as_ref() {
                            handler(window, cx);
                        }
                    }),
            )
    }
}

#[derive(IntoElement)]
pub struct PolicyTooltip {
    id: SharedString,
    text: SharedString,
}

impl PolicyTooltip {
    pub fn new(id: impl Into<SharedString>, text: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            text: text.into(),
        }
    }
}

impl gpui::RenderOnce for PolicyTooltip {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        div()
            .id(ElementId::Name(SharedString::from(format!(
                "{}-tip",
                self.id
            ))))
            .flex()
            .tooltip(Tooltip::text(self.text))
            .child(
                Button::new(ElementId::Name(self.id))
                    .size(ButtonSize::IconMicro)
                    .variant(ButtonVariant::GhostMuted)
                    .icon("info")
                    .icon_size(14.)
                    .accessibility_label("Background policy details"),
            )
    }
}

struct InheritanceState {
    open: bool,
    bounds: Bounds<Pixels>,
    dismissed_at: Option<Instant>,
    focus: gpui::FocusHandle,
}

#[derive(IntoElement)]
pub struct InheritanceBadge {
    id: SharedString,
    model: SettingInheritanceModelView,
    overriding: Vec<SettingsRowOverridingProjectView>,
    keys: Vec<String>,
    client: Entity<CoreClient>,
}

impl InheritanceBadge {
    pub fn new(
        id: impl Into<SharedString>,
        model: &SettingInheritanceModelView,
        overriding: &[SettingsRowOverridingProjectView],
        scoped_keys: &[String],
        client: &Entity<CoreClient>,
    ) -> Self {
        Self {
            id: id.into(),
            model: model.clone(),
            overriding: overriding.to_vec(),
            keys: scoped_keys.to_vec(),
            client: client.clone(),
        }
    }
}

fn inline_button(
    id: SharedString,
    label: SharedString,
    color: Rgba,
    on_click: impl Fn(&mut Window, &mut App) + 'static,
) -> impl IntoElement {
    div()
        .id(ElementId::Name(id))
        .flex()
        .flex_none()
        .min_w_0()
        .items_center()
        .cursor_pointer()
        .font_weight(FontWeight::MEDIUM)
        .text_color(color)
        .hover(move |style| style.underline().text_decoration_color(color))
        .on_click(move |_, window, cx| on_click(window, cx))
        .child(div().min_w_0().truncate().child(label))
}

fn chain_section(
    chain: &SettingInheritanceChainView,
    first: bool,
    keys: &[String],
    overriding: &[SettingsRowOverridingProjectView],
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    let divider = fade(t.border, 0.6);
    let layers = chain.layers.iter().map(|layer| {
        let value_color = if layer.effective {
            t.foreground
        } else if layer.set {
            t.muted_foreground
        } else {
            fade(t.muted_foreground, 0.6)
        };
        div()
            .flex()
            .items_center()
            .gap(px(12.))
            .rounded(px(radius::MD))
            .px(px(INHERITANCE_LAYER_X))
            .py(px(INHERITANCE_LAYER_Y))
            .when(layer.effective, |this| this.bg(fade(t.foreground, 0.06)))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .when(layer.effective, |this| {
                        this.font_weight(FontWeight::MEDIUM)
                            .text_color(t.foreground)
                    })
                    .when(!layer.effective, |this| this.text_color(t.muted_foreground))
                    .child(layer.label.clone()),
            )
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(6.))
                    .text_color(value_color)
                    .child(
                        div()
                            .max_w(px(INHERITANCE_VALUE_MAX_WIDTH))
                            .truncate()
                            .child(layer.value.clone()),
                    )
                    .child(if layer.effective {
                        svg()
                            .path("icons/check.svg")
                            .size(px(14.))
                            .flex_none()
                            .text_color(t.primary)
                            .into_any_element()
                    } else {
                        div().size(px(14.)).flex_none().into_any_element()
                    }),
            )
    });
    let overrides = chain.overrides.as_ref().map(|overrides| {
        let reset_entries = match &chain.reset {
            SettingInheritanceResetView::ClearProjectOverrides { entries } => Some(entries.clone()),
            SettingInheritanceResetView::None => None,
        };
        let reset = overrides
            .reset_label
            .clone()
            .zip(reset_entries)
            .map(|(label, entries)| {
                let client = client.clone();
                let keys = keys.to_vec();
                inline_button(
                    SharedString::from(format!("inheritance-reset-{}", chain.id)),
                    SharedString::from(label),
                    t.foreground,
                    move |_, cx| {
                        act(
                            &client,
                            cx,
                            "settingsClearProjectOverrides",
                            json!({ "entries": entries, "keys": keys }),
                        )
                    },
                )
            });
        let rows = overrides.projects.iter().map(|project| {
            let target = overriding
                .iter()
                .find(|candidate| {
                    candidate.environment_id == project.environment_id
                        && candidate.project_id == project.project_id
                })
                .map(|candidate| candidate.project_key.clone());
            let client = client.clone();
            div()
                .flex()
                .items_center()
                .gap(px(12.))
                .px(px(INHERITANCE_LAYER_X))
                .py(px(INHERITANCE_LAYER_Y))
                .child(div().flex_1().min_w_0().flex().child(inline_button(
                    SharedString::from(format!(
                        "inheritance-open-{}-{}",
                        project.environment_id, project.project_id
                    )),
                    SharedString::from(project.label.clone()),
                    t.foreground,
                    move |_, cx| {
                        if let Some(project_key) = target.clone() {
                            act(
                                &client,
                                cx,
                                "settingsSelectScope",
                                json!({ "axis": "project", "value": project_key }),
                            );
                        }
                    },
                )))
                .children(project.value.clone().map(|value| {
                    div()
                        .flex_none()
                        .max_w(px(INHERITANCE_VALUE_MAX_WIDTH))
                        .truncate()
                        .text_color(t.muted_foreground)
                        .child(value)
                }))
        });
        div()
            .mt(px(8.))
            .pt(px(8.))
            .border_t_1()
            .border_color(divider)
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(12.))
                    .px(px(INHERITANCE_LAYER_X))
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.muted_foreground)
                    .child(overrides.heading.clone())
                    .children(reset),
            )
            .child(
                div()
                    .mt(px(2.))
                    .flex()
                    .flex_col()
                    .text_size(px(text::SM))
                    .line_height(px(text::SM_LINE))
                    .children(rows),
            )
    });
    div()
        .px(px(INHERITANCE_POPOVER_SECTION_X))
        .py(px(INHERITANCE_POPOVER_SECTION_Y))
        .when(!first, |this| this.border_t_1().border_color(divider))
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(6.))
                .pb(px(6.))
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.muted_foreground)
                .child(
                    svg()
                        .path(machine_icon(chain.machine))
                        .size(px(14.))
                        .flex_none()
                        .text_color(t.muted_foreground),
                )
                .child(div().min_w_0().truncate().child(chain.title.clone())),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .text_size(px(text::SM))
                .line_height(px(text::SM_LINE))
                .children(layers),
        )
        .children(overrides)
        .into_any_element()
}

impl gpui::RenderOnce for InheritanceBadge {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let state = window.use_keyed_state(
            ElementId::Name(SharedString::from(format!("{}-state", self.id))),
            cx,
            |_, cx| InheritanceState {
                open: false,
                dismissed_at: None,
                bounds: Bounds::default(),
                focus: cx.focus_handle(),
            },
        );
        let (open, bounds, focus) = {
            let current = state.read(cx);
            (current.open, current.bounds, current.focus.clone())
        };
        let icon_color = match self.model.tone.as_str() {
            "primary" => Some(t.primary),
            "warning" => Some(t.warning),
            _ => None,
        };
        let toggle = state.clone();
        let trigger = Button::new(ElementId::Name(self.id.clone()))
            .size(ButtonSize::IconMicro)
            .variant(ButtonVariant::GhostMuted)
            .icon("layers")
            .icon_size(12.)
            .pressed(open)
            .accessibility_label(self.model.trigger_aria_label.clone())
            .when_some(icon_color, |button, color| button.icon_color(color))
            .on_click(move |_, window, cx| {
                cx.stop_propagation();
                let opened = toggle.update(cx, |state, cx| {
                    let just_dismissed = state
                        .dismissed_at
                        .take()
                        .is_some_and(|at| at.elapsed() < Duration::from_millis(DISMISS_GRACE_MS));
                    state.open = !state.open && !just_dismissed;
                    cx.notify();
                    state.open.then(|| state.focus.clone())
                });
                if let Some(focus) = opened {
                    focus.focus(window, cx);
                }
            });
        let measure = state.clone();
        let popup = open.then(|| {
            let close = state.clone();
            let escape = state.clone();
            let chains: Vec<AnyElement> = self
                .model
                .chains
                .iter()
                .enumerate()
                .map(|(index, chain)| {
                    chain_section(
                        chain,
                        index == 0,
                        &self.keys,
                        &self.overriding,
                        &self.client,
                        &t,
                    )
                })
                .collect();
            PopoverPopup::new(
                ElementId::Name(SharedString::from(format!("{}-popup", self.id))),
                bounds,
            )
            .side(Side::Bottom)
            .align(Align::Start)
            .width(PopoverWidth::Md)
            .padding(PopoverPadding::None)
            .on_dismiss(move |_, cx| {
                close.update(cx, |state, cx| {
                    state.open = false;
                    state.dismissed_at = Some(Instant::now());
                    cx.notify();
                })
            })
            .child(
                div()
                    .id(ElementId::Name(SharedString::from(format!(
                        "{}-chains",
                        self.id
                    ))))
                    .track_focus(&focus)
                    .flex()
                    .flex_col()
                    .w_full()
                    .on_key_down(move |event: &KeyDownEvent, _, cx| {
                        if event.keystroke.key == "escape" {
                            cx.stop_propagation();
                            escape.update(cx, |state, cx| {
                                state.open = false;
                                cx.notify();
                            });
                        }
                    })
                    .children(chains),
            )
        });
        div()
            .id(ElementId::Name(SharedString::from(format!(
                "{}-tip",
                self.id
            ))))
            .relative()
            .flex()
            .when(!open, |this| {
                this.tooltip(Tooltip::text(SharedString::from(
                    self.model.summary.clone(),
                )))
            })
            .child(trigger)
            .child(
                canvas(
                    move |bounds, _, cx| measure.update(cx, |state, _| state.bounds = bounds),
                    |_, _, _, _| {},
                )
                .absolute()
                .top_0()
                .left_0()
                .size_full(),
            )
            .children(popup)
    }
}

#[derive(IntoElement)]
pub struct SettingsUnavailableGroup {
    message: Option<SharedString>,
    children: Vec<AnyElement>,
}

impl SettingsUnavailableGroup {
    pub fn new(message: Option<impl Into<SharedString>>) -> Self {
        Self {
            message: message.map(Into::into),
            children: Vec::new(),
        }
    }
}

impl ParentElement for SettingsUnavailableGroup {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl gpui::RenderOnce for SettingsUnavailableGroup {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let Some(message) = self.message else {
            return div().flex().flex_col().w_full().children(self.children);
        };
        div()
            .flex()
            .flex_col()
            .w_full()
            .py(px(6.))
            .bg(fade(t.muted, 0.2))
            .child(
                div()
                    .flex()
                    .items_start()
                    .gap(px(8.))
                    .px(px(ROW_PADDING_X))
                    .py(px(8.))
                    .text_size(px(text::XS))
                    .line_height(px(text::XS * text::LEADING_RELAXED))
                    .text_color(t.muted_foreground)
                    .child(
                        svg()
                            .path("icons/info.svg")
                            .size(px(14.))
                            .mt(px(2.))
                            .flex_none()
                            .text_color(t.warning),
                    )
                    .child(div().flex_1().min_w_0().child(message)),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .w_full()
                    .opacity(UNAVAILABLE_TEXT_OPACITY)
                    .children(self.children),
            )
    }
}

struct FoldedState {
    open: bool,
    opened_for_target: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FoldedHeaderPlacement {
    #[default]
    Inside,
    Outside,
}

#[derive(IntoElement)]
pub struct FoldedSettingsSection {
    id: SharedString,
    title: SharedString,
    summary: Option<SharedString>,
    control: Option<AnyElement>,
    placement: FoldedHeaderPlacement,
    children: Vec<AnyElement>,
}

impl FoldedSettingsSection {
    pub fn new(id: impl Into<SharedString>, title: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            summary: None,
            control: None,
            placement: FoldedHeaderPlacement::Inside,
            children: Vec::new(),
        }
    }

    pub fn summary(mut self, summary: Option<impl Into<SharedString>>) -> Self {
        self.summary = summary.map(Into::into);
        self
    }

    pub fn control(mut self, control: impl IntoElement) -> Self {
        self.control = Some(control.into_any_element());
        self
    }

    pub fn header_placement(mut self, placement: FoldedHeaderPlacement) -> Self {
        self.placement = placement;
        self
    }
}

impl ParentElement for FoldedSettingsSection {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

fn chevron(open: bool, color: Rgba) -> AnyElement {
    svg()
        .path(if open {
            "icons/chevron-down.svg"
        } else {
            "icons/chevron-right.svg"
        })
        .size(px(16.))
        .flex_none()
        .text_color(color)
        .into_any_element()
}

impl gpui::RenderOnce for FoldedSettingsSection {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let state = window.use_keyed_state(
            ElementId::Name(SharedString::from(format!("{}-fold", self.id))),
            cx,
            |_, _| FoldedState {
                open: false,
                opened_for_target: false,
            },
        );
        let targeted = SettingsTargets::target(cx).is_some_and(|target| target == self.id);
        let needs_open = {
            let current = state.read(cx);
            targeted && !current.opened_for_target
        };
        if needs_open {
            state.update(cx, |state, _| {
                state.open = true;
                state.opened_for_target = true;
            });
        } else if !targeted && state.read(cx).opened_for_target {
            state.update(cx, |state, _| state.opened_for_target = false);
        }
        let open = state.read(cx).open;
        let toggle = state.clone();
        let trigger_id = ElementId::Name(SharedString::from(format!("{}-trigger", self.id)));
        let on_toggle = move |_: &gpui::ClickEvent, _: &mut Window, cx: &mut App| {
            toggle.update(cx, |state, cx| {
                state.open = !state.open;
                cx.notify();
            });
        };
        let id = self.id.clone();
        let pulse = pulse_overlay(&id, cx);
        match self.placement {
            FoldedHeaderPlacement::Outside => {
                let header = div()
                    .relative()
                    .flex()
                    .min_h(px(SECTION_HEADER_MIN_HEIGHT))
                    .items_start()
                    .justify_between()
                    .gap(px(SECTION_HEADER_GAP))
                    .px(px(SECTION_INSET_X))
                    .child(
                        div()
                            .id(trigger_id)
                            .flex()
                            .min_h(px(SECTION_HEADER_MIN_HEIGHT))
                            .items_center()
                            .gap(px(8.))
                            .rounded(px(radius::SM))
                            .cursor_pointer()
                            .text_size(px(text::SM))
                            .line_height(px(text::SM_LINE))
                            .text_color(fade(t.foreground, 0.7))
                            .on_click(on_toggle)
                            .child(self.title)
                            .child(chevron(open, fade(t.foreground, 0.7))),
                    )
                    .children(self.control)
                    .child(target_probe(id.clone()))
                    .children(pulse);
                div()
                    .flex()
                    .flex_col()
                    .w_full()
                    .gap(px(SECTION_STACK_GAP))
                    .child(header)
                    .when(open, |this| {
                        this.child(SettingsGroup::new().children(self.children))
                    })
                    .into_any_element()
            }
            FoldedHeaderPlacement::Inside => {
                let divider = fade(t.border, 0.5);
                let header = div()
                    .flex()
                    .items_center()
                    .gap(px(16.))
                    .px(px(SECTION_INSET_X))
                    .child(
                        div()
                            .id(trigger_id)
                            .flex()
                            .flex_1()
                            .min_w_0()
                            .min_h(px(FOLDED_HEADER_MIN_HEIGHT))
                            .items_center()
                            .gap(px(8.))
                            .py(px(8.))
                            .rounded(px(radius::SM))
                            .cursor_pointer()
                            .on_click(on_toggle)
                            .child(chevron(open, t.muted_foreground))
                            .child(
                                div()
                                    .flex_none()
                                    .text_size(px(text::SM))
                                    .line_height(px(text::SM_LINE))
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(self.title),
                            )
                            .children(self.summary.map(|summary| {
                                div()
                                    .min_w_0()
                                    .truncate()
                                    .text_size(px(text::XS))
                                    .line_height(px(text::XS_LINE))
                                    .text_color(t.muted_foreground)
                                    .child(summary)
                            })),
                    )
                    .children(
                        self.control
                            .map(|control| div().flex().flex_none().items_center().child(control)),
                    );
                group_surface(&t)
                    .child(header)
                    .when(open, |this| {
                        this.child(
                            div()
                                .flex()
                                .flex_col()
                                .w_full()
                                .border_t_1()
                                .border_color(divider)
                                .children(divided_children(self.children, &t)),
                        )
                    })
                    .child(target_probe(id))
                    .children(pulse)
                    .into_any_element()
            }
        }
    }
}

pub fn settings_switch(id: impl Into<ElementId>, checked: bool) -> Switch {
    Switch::new(id).checked(checked)
}

pub fn settings_button(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Button {
    Button::new(id)
        .size(ButtonSize::Sm)
        .variant(ButtonVariant::Outline)
        .label(label)
}

pub fn settings_header_button(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Button {
    Button::new(id)
        .size(ButtonSize::Xs)
        .variant(ButtonVariant::Outline)
        .label(label)
}

pub fn settings_number_input(state: &Entity<InputState>) -> Input {
    Input::new(state)
        .size(InputSize::Sm)
        .w(px(NUMBER_INPUT_WIDTH))
}

pub fn settings_text_input(state: &Entity<InputState>) -> Input {
    Input::new(state)
        .size(InputSize::Sm)
        .w(px(TEXT_INPUT_WIDTH))
}

#[derive(Clone, Debug, PartialEq)]
pub struct SettingsSelectOption {
    pub value: SharedString,
    pub label: SharedString,
    pub description: Option<SharedString>,
    pub icon: Option<SharedString>,
    pub disabled: bool,
}

impl SettingsSelectOption {
    pub fn new(value: impl Into<SharedString>, label: impl Into<SharedString>) -> Self {
        Self {
            value: value.into(),
            label: label.into(),
            description: None,
            icon: None,
            disabled: false,
        }
    }

    pub fn description(mut self, description: Option<impl Into<SharedString>>) -> Self {
        self.description = description.map(Into::into);
        self
    }

    pub fn icon(mut self, icon: impl Into<SharedString>) -> Self {
        self.icon = Some(icon.into());
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SettingsControlWidth {
    Fixed(f32),
    Auto,
}

type SelectChange = Rc<dyn Fn(&SharedString, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct SettingsSelect {
    id: ElementId,
    options: Vec<SettingsSelectOption>,
    value: Option<SharedString>,
    placeholder: Option<SharedString>,
    width: SettingsControlWidth,
    leading: Option<AnyElement>,
    show_selected_icon: bool,
    disabled: bool,
    accessibility_label: Option<SharedString>,
    value_label: Option<SharedString>,
    check_selected: bool,
    on_change: Option<SelectChange>,
}

impl SettingsSelect {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            options: Vec::new(),
            value: None,
            placeholder: None,
            width: SettingsControlWidth::Fixed(SELECT_WIDTH),
            leading: None,
            show_selected_icon: true,
            disabled: false,
            accessibility_label: None,
            value_label: None,
            check_selected: false,
            on_change: None,
        }
    }

    pub fn options(mut self, options: impl IntoIterator<Item = SettingsSelectOption>) -> Self {
        self.options.extend(options);
        self
    }

    pub fn value(mut self, value: Option<impl Into<SharedString>>) -> Self {
        self.value = value.map(Into::into);
        self
    }

    pub fn placeholder(mut self, placeholder: impl Into<SharedString>) -> Self {
        self.placeholder = Some(placeholder.into());
        self
    }

    pub fn width(mut self, width: SettingsControlWidth) -> Self {
        self.width = width;
        self
    }

    pub fn leading(mut self, element: impl IntoElement) -> Self {
        self.leading = Some(element.into_any_element());
        self
    }

    pub fn show_selected_icon(mut self, show: bool) -> Self {
        self.show_selected_icon = show;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn accessibility_label(mut self, label: impl Into<SharedString>) -> Self {
        self.accessibility_label = Some(label.into());
        self
    }

    pub fn value_label(mut self, label: impl Into<SharedString>) -> Self {
        self.value_label = Some(label.into());
        self
    }

    pub fn check_selected(mut self, check: bool) -> Self {
        self.check_selected = check;
        self
    }

    pub fn on_change(
        mut self,
        handler: impl Fn(&SharedString, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_change = Some(Rc::new(handler));
        self
    }
}

fn option_icon(name: &SharedString, t: &Tokens, opacity: f32) -> AnyElement {
    let path = if name.contains('/') {
        name.clone()
    } else {
        SharedString::from(format!("icons/{name}.svg"))
    };
    svg()
        .path(path)
        .size(px(14.))
        .flex_none()
        .text_color(fade(t.muted_foreground, opacity))
        .into_any_element()
}

impl gpui::RenderOnce for SettingsSelect {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let leading = self.leading.or_else(|| {
            self.show_selected_icon
                .then(|| {
                    self.options
                        .iter()
                        .find(|option| Some(&option.value) == self.value.as_ref())
                        .and_then(|option| option.icon.as_ref())
                        .map(|icon| option_icon(icon, &t, 0.8))
                })
                .flatten()
        });
        let check_selected = self.check_selected;
        let items = self.options.iter().map(|option| {
            let rich = option.description.is_some() || option.icon.is_some();
            let item = SelectItem::new(option.value.clone(), option.label.clone())
                .disabled(option.disabled);
            if check_selected {
                let selected = Some(&option.value) == self.value.as_ref();
                return item.child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .gap(px(16.))
                        .child(option.label.clone())
                        .when(selected, |row| {
                            row.child(
                                svg()
                                    .path("icons/check.svg")
                                    .flex_none()
                                    .size(px(16.))
                                    .text_color(t.muted_foreground),
                            )
                        }),
                );
            }
            if !rich {
                return item;
            }
            item.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(2.))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .font_weight(FontWeight::MEDIUM)
                            .children(option.icon.as_ref().map(|icon| option_icon(icon, &t, 1.)))
                            .child(option.label.clone()),
                    )
                    .children(option.description.clone().map(|description| {
                        div()
                            .text_size(px(text::XS))
                            .line_height(px(text::XS_LINE))
                            .text_color(t.muted_foreground)
                            .child(description)
                    })),
            )
        });
        let on_change = self.on_change;
        let select = Select::new(self.id)
            .size(SelectSize::Sm)
            .align(Align::End)
            .match_trigger_width(true)
            .items(items)
            .value(self.value)
            .disabled(self.disabled)
            .when_some(self.placeholder, |select, placeholder| {
                select.placeholder(placeholder)
            })
            .when_some(self.accessibility_label, |select, label| {
                select.accessibility_label(label)
            })
            .when_some(self.value_label, |select, label| select.value_label(label))
            .when_some(leading, |select, leading| select.leading(leading))
            .when_some(on_change, |select, handler| {
                select.on_change(move |value, window, cx| handler(value, window, cx))
            });
        match self.width {
            SettingsControlWidth::Fixed(width) => select.w(px(width)).min_w(px(width)),
            SettingsControlWidth::Auto => select.w_auto().min_w(px(0.)).flex_none(),
        }
    }
}

struct SliderState {
    bounds: Bounds<Pixels>,
    dragging: bool,
}

type SliderChange = Rc<dyn Fn(f64, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct SettingsSlider {
    id: SharedString,
    value: f64,
    min: f64,
    max: f64,
    step: f64,
    value_label: SharedString,
    accessibility_label: Option<SharedString>,
    value_min_width: f32,
    width: f32,
    on_change: Option<SliderChange>,
}

impl SettingsSlider {
    pub fn new(id: impl Into<SharedString>, value: f64, min: f64, max: f64, step: f64) -> Self {
        Self {
            id: id.into(),
            value,
            min,
            max,
            step,
            value_label: SharedString::default(),
            accessibility_label: None,
            value_min_width: SLIDER_VALUE_MIN_WIDTH,
            width: SLIDER_CONTROL_WIDTH,
            on_change: None,
        }
    }

    pub fn value_label(mut self, label: impl Into<SharedString>) -> Self {
        self.value_label = label.into();
        self
    }

    pub fn accessibility_label(mut self, label: impl Into<SharedString>) -> Self {
        self.accessibility_label = Some(label.into());
        self
    }

    pub fn value_min_width(mut self, width: f32) -> Self {
        self.value_min_width = width;
        self
    }

    pub fn width(mut self, width: f32) -> Self {
        self.width = width;
        self
    }

    pub fn on_change(mut self, handler: impl Fn(f64, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(handler));
        self
    }
}

fn snap(value: f64, min: f64, max: f64, step: f64) -> f64 {
    let clamped = value.clamp(min, max);
    if step <= 0. {
        return clamped;
    }
    (min + ((clamped - min) / step).round() * step).clamp(min, max)
}

fn slider_value_at(x: Pixels, bounds: Bounds<Pixels>, min: f64, max: f64, step: f64) -> f64 {
    let width = f32::from(bounds.size.width) - SLIDER_THUMB;
    if width <= 0. {
        return min;
    }
    let ratio = ((f32::from(x - bounds.origin.x) - SLIDER_THUMB / 2.) / width).clamp(0., 1.);
    snap(min + f64::from(ratio) * (max - min), min, max, step)
}

impl gpui::RenderOnce for SettingsSlider {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let state = window.use_keyed_state(
            ElementId::Name(SharedString::from(format!("{}-slider", self.id))),
            cx,
            |_, _| SliderState {
                bounds: Bounds::default(),
                dragging: false,
            },
        );
        let focus = window
            .use_keyed_state(
                ElementId::Name(SharedString::from(format!("{}-slider-focus", self.id))),
                cx,
                |_, cx| cx.focus_handle(),
            )
            .read(cx)
            .clone();
        let focused = focus.is_focused(window) && window.last_input_was_keyboard();
        let (min, max, step, value) = (self.min, self.max, self.step, self.value);
        let ratio = if max > min {
            ((value - min) / (max - min)).clamp(0., 1.) as f32
        } else {
            0.
        };
        let track_bg = fade(t.muted_foreground, 0.22);
        let track_border = fade(t.border, 0.55);
        let dark = t.appearance == Appearance::Dark;
        let thumb_shadow = alpha(if dark { t.foreground } else { BLACK }, 0.12);
        let on_change = self.on_change.clone();
        let down_state = state.clone();
        let down_change = on_change.clone();
        let down_focus = focus.clone();
        let move_state = state.clone();
        let move_change = on_change.clone();
        let up_state = state.clone();
        let key_change = on_change.clone();
        let measure = state.clone();
        let slider = div()
            .id(ElementId::Name(self.id.clone()))
            .track_focus(&focus)
            .relative()
            .flex()
            .flex_1()
            .min_w_0()
            .h(px(SLIDER_HEIGHT))
            .items_center()
            .cursor_pointer()
            .on_mouse_down(
                MouseButton::Left,
                move |event: &MouseDownEvent, window, cx| {
                    down_focus.focus(window, cx);
                    let bounds = down_state.read(cx).bounds;
                    down_state.update(cx, |state, _| state.dragging = true);
                    if let Some(handler) = down_change.as_ref() {
                        handler(
                            slider_value_at(event.position.x, bounds, min, max, step),
                            window,
                            cx,
                        );
                    }
                },
            )
            .on_mouse_move(move |event: &MouseMoveEvent, window, cx| {
                let (dragging, bounds) = {
                    let state = move_state.read(cx);
                    (state.dragging, state.bounds)
                };
                if !dragging || event.pressed_button != Some(MouseButton::Left) {
                    return;
                }
                if let Some(handler) = move_change.as_ref() {
                    handler(
                        slider_value_at(event.position.x, bounds, min, max, step),
                        window,
                        cx,
                    );
                }
            })
            .on_mouse_up_out(MouseButton::Left, move |_, _, cx| {
                up_state.update(cx, |state, _| state.dragging = false);
            })
            .on_key_down(move |event: &KeyDownEvent, window, cx| {
                let delta = match event.keystroke.key.as_str() {
                    "left" | "down" => -step,
                    "right" | "up" => step,
                    "home" => min - value,
                    "end" => max - value,
                    _ => return,
                };
                cx.stop_propagation();
                if let Some(handler) = key_change.as_ref() {
                    handler(snap(value + delta, min, max, step), window, cx);
                }
            })
            .child(
                canvas(
                    move |bounds, _, cx| measure.update(cx, |state, _| state.bounds = bounds),
                    |_, _, _, _| {},
                )
                .absolute()
                .top_0()
                .left_0()
                .size_full(),
            )
            .child(
                div()
                    .relative()
                    .flex()
                    .w_full()
                    .h(px(SLIDER_TRACK))
                    .rounded(px(radius::FULL))
                    .bg(track_bg)
                    .overflow_hidden()
                    .child(
                        div()
                            .flex_none()
                            .w(px(SLIDER_THUMB / 2.))
                            .h_full()
                            .bg(t.primary),
                    )
                    .child(
                        div().relative().flex_1().h_full().child(
                            div()
                                .absolute()
                                .top_0()
                                .left_0()
                                .h_full()
                                .w(gpui::relative(ratio))
                                .bg(t.primary),
                        ),
                    )
                    .child(div().flex_none().w(px(SLIDER_THUMB / 2.)).h_full())
                    .child(
                        div()
                            .absolute()
                            .top_0()
                            .left_0()
                            .size_full()
                            .rounded(px(radius::FULL))
                            .border_1()
                            .border_color(track_border),
                    ),
            )
            .child(
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .left(px(SLIDER_THUMB / 2.))
                    .right(px(SLIDER_THUMB / 2.))
                    .child(
                        div()
                            .absolute()
                            .top(px((SLIDER_HEIGHT - SLIDER_THUMB) / 2.))
                            .left(gpui::relative(ratio))
                            .child(
                                div()
                                    .relative()
                                    .left(px(-SLIDER_THUMB / 2.))
                                    .size(px(SLIDER_THUMB))
                                    .rounded(px(radius::FULL))
                                    .border_2()
                                    .border_color(t.primary)
                                    .bg(t.background)
                                    .shadow(if focused {
                                        vec![
                                            BoxShadow {
                                                color: t.background.into(),
                                                offset: point(px(0.), px(0.)),
                                                blur_radius: px(0.),
                                                spread_radius: px(3.),
                                                inset: false,
                                            },
                                            BoxShadow {
                                                color: t.ring.into(),
                                                offset: point(px(0.), px(0.)),
                                                blur_radius: px(0.),
                                                spread_radius: px(5.),
                                                inset: false,
                                            },
                                        ]
                                    } else {
                                        vec![BoxShadow {
                                            color: thumb_shadow.into(),
                                            offset: point(px(0.), px(1.)),
                                            blur_radius: px(2.),
                                            spread_radius: px(0.),
                                            inset: false,
                                        }]
                                    }),
                            ),
                    ),
            );
        div()
            .flex()
            .items_center()
            .gap(px(SLIDER_GAP))
            .w(px(self.width))
            .child(
                div()
                    .flex_none()
                    .min_w(px(self.value_min_width))
                    .rounded(px(radius::MD))
                    .bg(t.muted)
                    .px(px(8.))
                    .py(px(4.))
                    .text_center()
                    .font_family(crate::platform::MONO_FONT)
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.foreground)
                    .child(self.value_label),
            )
            .child(slider)
    }
}

type CommitHandler = Rc<dyn Fn(String, &mut Window, &mut Context<SettingsDraftInput>)>;

pub struct SettingsDraftInput {
    state: Entity<InputState>,
    value: String,
    on_commit: CommitHandler,
}

impl SettingsDraftInput {
    pub fn new(
        value: impl Into<String>,
        placeholder: impl Into<SharedString>,
        on_commit: impl Fn(String, &mut Window, &mut Context<SettingsDraftInput>) + 'static,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let value = value.into();
        let placeholder = placeholder.into();
        let initial = value.clone();
        let state = cx.new(|cx| {
            let mut state = InputState::new(window, cx).placeholder(placeholder);
            state.set_value(initial, window, cx);
            state
        });
        cx.subscribe_in(
            &state,
            window,
            |this, state, event: &InputEvent, window, cx| match event {
                InputEvent::PressEnter { .. } => window.blur(cx),
                InputEvent::Blur => {
                    let next = state.read(cx).value().to_string();
                    if next != this.value {
                        this.value = next.clone();
                        let handler = this.on_commit.clone();
                        handler(next, window, cx);
                    }
                }
                InputEvent::Change | InputEvent::Focus => {}
            },
        )
        .detach();
        Self {
            state,
            value,
            on_commit: Rc::new(on_commit),
        }
    }

    pub fn state(&self) -> &Entity<InputState> {
        &self.state
    }

    pub fn sync(&mut self, value: &str, window: &mut Window, cx: &mut Context<Self>) {
        if self.value == value || self.state.read(cx).focus_handle(cx).is_focused(window) {
            return;
        }
        self.value = value.to_string();
        let next = self.value.clone();
        self.state
            .update(cx, |state, cx| state.set_value(next, window, cx));
    }
}

impl gpui::Render for SettingsDraftInput {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        Input::new(&self.state).size(InputSize::Sm).w_full()
    }
}
