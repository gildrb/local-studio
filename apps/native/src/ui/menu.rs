use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Bounds, ClickEvent, Div, ElementId, FontWeight, Hsla, InteractiveElement,
    IntoElement, ParentElement, Pixels, RenderOnce, Rgba, SharedString, StatefulInteractiveElement,
    Styled, Window, div, px, svg,
};

use super::popover::{Align, Side, dropdown_glass, positioned};
use super::popover::{DismissHandler, HoverHandler};
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::fade;
use crate::ui::theme::{Tokens, active};

pub const MENU_MIN_WIDTH: f32 = 160.;
pub const MENU_PADDING: f32 = 4.;
pub const ITEM_MIN_HEIGHT: f32 = 28.;
pub const ITEM_TOUCH_MIN_HEIGHT: f32 = 40.;
pub const ITEM_PADDING_X: f32 = 8.;
pub const ITEM_PADDING_Y: f32 = 4.;
pub const ITEM_GAP: f32 = 8.;
pub const ITEM_INSET: f32 = 32.;
pub const ICON_SIZE: f32 = 16.;
pub const ICON_OPACITY: f32 = 0.8;
pub const DISABLED_OPACITY: f32 = 0.64;
pub const SHORTCUT_TRACKING: f32 = 1.2;
pub const SUB_ALIGN_OFFSET: f32 = -5.;

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

fn c(color: Rgba) -> Hsla {
    color.into()
}

pub fn icon(name: &str, size: f32, color: Rgba) -> gpui::Svg {
    svg()
        .path(SharedString::from(format!("icons/{name}.svg")))
        .size(px(size))
        .flex_none()
        .text_color(c(color))
}

pub fn tracked_text(value: &str, tracking: f32) -> Div {
    div()
        .flex()
        .items_center()
        .gap(px(tracking))
        .pr(px(tracking))
        .children(
            value
                .chars()
                .map(|ch| div().child(SharedString::from(ch.to_string()))),
        )
}

#[derive(IntoElement)]
pub struct MenuPopup {
    id: ElementId,
    trigger: Bounds<Pixels>,
    side: Side,
    align: Align,
    side_offset: f32,
    align_offset: f32,
    min_width: f32,
    on_dismiss: Option<DismissHandler>,
    children: Vec<AnyElement>,
}

impl MenuPopup {
    pub fn new(id: impl Into<ElementId>, trigger: Bounds<Pixels>) -> Self {
        Self {
            id: id.into(),
            trigger,
            side: Side::Bottom,
            align: Align::Center,
            side_offset: 4.,
            align_offset: 0.,
            min_width: MENU_MIN_WIDTH,
            on_dismiss: None,
            children: Vec::new(),
        }
    }

    pub fn sub(id: impl Into<ElementId>, trigger: Bounds<Pixels>) -> Self {
        Self::new(id, trigger)
            .side(Side::Right)
            .align(Align::Start)
            .side_offset(0.)
            .align_offset(SUB_ALIGN_OFFSET)
    }

    pub fn side(mut self, side: Side) -> Self {
        self.side = side;
        self
    }

    pub fn align(mut self, align: Align) -> Self {
        self.align = align;
        self
    }

    pub fn side_offset(mut self, offset: f32) -> Self {
        self.side_offset = offset;
        self
    }

    pub fn align_offset(mut self, offset: f32) -> Self {
        self.align_offset = offset;
        self
    }

    pub fn min_width(mut self, width: f32) -> Self {
        self.min_width = width;
        self
    }

    pub fn on_dismiss(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_dismiss = Some(Rc::new(handler));
        self
    }
}

impl ParentElement for MenuPopup {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for MenuPopup {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let viewport = window.viewport_size();
        let max_w = viewport.width - px(32.);
        let min_w = px(self.min_width).min(max_w);
        let scroll_id = ElementId::Name(SharedString::from(format!("{}-scroll", self.id)));
        let surface = dropdown_glass(cx)
            .id(self.id)
            .occlude()
            .min_w(min_w)
            .max_w(max_w)
            .when_some(self.on_dismiss, |s, dismiss| {
                s.on_mouse_down_out(move |_, window, cx| dismiss(window, cx))
            })
            .child(
                div()
                    .id(scroll_id)
                    .w_full()
                    .max_h(viewport.height - px(16.))
                    .overflow_y_scroll()
                    .p(px(MENU_PADDING))
                    .flex()
                    .flex_col()
                    .children(self.children),
            );
        positioned(
            self.trigger,
            self.side,
            self.align,
            self.side_offset,
            self.align_offset,
            surface,
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum MenuItemVariant {
    #[default]
    Default,
    Destructive,
    Ghost,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum MenuDensity {
    #[default]
    Default,
    Touch,
}

fn item_row(
    id: ElementId,
    t: &Tokens,
    density: MenuDensity,
    disabled: bool,
) -> gpui::Stateful<Div> {
    let min_h = match density {
        MenuDensity::Default => ITEM_MIN_HEIGHT,
        MenuDensity::Touch => ITEM_TOUCH_MIN_HEIGHT,
    };
    let accent = c(t.accent);
    let accent_fg = c(t.accent_foreground);
    div()
        .id(id)
        .flex()
        .items_center()
        .min_h(px(min_h))
        .rounded(px(radius::SM))
        .py(px(ITEM_PADDING_Y))
        .text_size(px(text::SM))
        .line_height(px(text::SM_LINE))
        .text_color(c(t.foreground))
        .when(disabled, |s| {
            s.opacity(DISABLED_OPACITY).cursor_not_allowed()
        })
        .when(!disabled, |s| {
            s.cursor_pointer()
                .hover(move |s| s.bg(accent).text_color(accent_fg))
        })
}

#[derive(IntoElement)]
pub struct MenuItem {
    id: ElementId,
    label: Option<SharedString>,
    icon: Option<SharedString>,
    shortcut: Option<SharedString>,
    inset: bool,
    variant: MenuItemVariant,
    density: MenuDensity,
    disabled: bool,
    highlighted: bool,
    on_click: Option<ClickHandler>,
    children: Vec<AnyElement>,
}

impl MenuItem {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            label: None,
            icon: None,
            shortcut: None,
            inset: false,
            variant: MenuItemVariant::Default,
            density: MenuDensity::Default,
            disabled: false,
            highlighted: false,
            on_click: None,
            children: Vec::new(),
        }
    }

    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }

    pub fn icon(mut self, name: impl Into<SharedString>) -> Self {
        self.icon = Some(name.into());
        self
    }

    pub fn shortcut(mut self, shortcut: impl Into<SharedString>) -> Self {
        self.shortcut = Some(shortcut.into());
        self
    }

    pub fn inset(mut self, inset: bool) -> Self {
        self.inset = inset;
        self
    }

    pub fn variant(mut self, variant: MenuItemVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn density(mut self, density: MenuDensity) -> Self {
        self.density = density;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn highlighted(mut self, highlighted: bool) -> Self {
        self.highlighted = highlighted;
        self
    }

    pub fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
}

impl ParentElement for MenuItem {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for MenuItem {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        let destructive = self.variant == MenuItemVariant::Destructive;
        let ghost = self.variant == MenuItemVariant::Ghost;
        let text_color = if destructive {
            t.destructive_foreground
        } else {
            t.foreground
        };
        let icon_color = if destructive {
            t.destructive_foreground
        } else {
            t.muted_foreground
        };
        let disabled = self.disabled;
        let on_click = self.on_click;
        item_row(self.id, &t, self.density, disabled)
            .gap(px(if ghost { 4. } else { ITEM_GAP }))
            .px(px(if ghost { 7. } else { ITEM_PADDING_X }))
            .text_color(c(text_color))
            .when(ghost, |s| {
                s.w_full()
                    .rounded(px(radius::MD))
                    .font_weight(FontWeight::MEDIUM)
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
            })
            .when(self.inset, |s| s.pl(px(ITEM_INSET)))
            .when(self.highlighted && !disabled, |s| {
                s.bg(c(t.accent)).text_color(c(t.accent_foreground))
            })
            .when_some(self.icon, |s, name| {
                s.child(
                    div()
                        .mx(px(-2.))
                        .flex_none()
                        .opacity(if destructive { 1. } else { ICON_OPACITY })
                        .child(icon(&name, if ghost { 14. } else { ICON_SIZE }, icon_color)),
                )
            })
            .when_some(self.label, |s, label| {
                s.child(div().min_w_0().truncate().child(label))
            })
            .children(self.children)
            .when_some(self.shortcut, |s, shortcut| {
                s.child(MenuShortcut::new(shortcut))
            })
            .when_some(on_click.filter(|_| !disabled), |s, handler| {
                s.on_click(move |event, window, cx| handler(event, window, cx))
            })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum MenuCheckboxVariant {
    #[default]
    Default,
    Switch,
}

#[derive(IntoElement)]
pub struct MenuCheckboxItem {
    id: ElementId,
    label: SharedString,
    checked: bool,
    variant: MenuCheckboxVariant,
    disabled: bool,
    highlighted: bool,
    status: Option<(SharedString, Rgba)>,
    on_click: Option<ClickHandler>,
}

impl MenuCheckboxItem {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            checked: false,
            variant: MenuCheckboxVariant::Default,
            disabled: false,
            highlighted: false,
            status: None,
            on_click: None,
        }
    }

    pub fn checked(mut self, checked: bool) -> Self {
        self.checked = checked;
        self
    }

    pub fn variant(mut self, variant: MenuCheckboxVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn highlighted(mut self, highlighted: bool) -> Self {
        self.highlighted = highlighted;
        self
    }

    pub fn status(mut self, status: impl Into<SharedString>, color: Rgba) -> Self {
        self.status = Some((status.into(), color));
        self
    }

    pub fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for MenuCheckboxItem {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        let disabled = self.disabled;
        let switch = self.variant == MenuCheckboxVariant::Switch;
        let thumb = 12.;
        let row = item_row(self.id, &t, MenuDensity::Default, disabled)
            .pl(px(ITEM_PADDING_X))
            .when(self.highlighted && !disabled, |s| {
                s.bg(c(t.accent)).text_color(c(t.accent_foreground))
            });
        let row = if switch {
            row.gap(px(16.))
                .pr(px(6.))
                .child(div().flex_1().min_w_0().child(self.label))
                .child(
                    div()
                        .flex_none()
                        .flex()
                        .items_center()
                        .h(px(thumb + 2.))
                        .w(px(thumb * 2. - 2.))
                        .p(px(1.))
                        .rounded(px(radius::FULL))
                        .bg(c(if self.checked { t.primary } else { t.input }))
                        .when(self.checked, |s| s.justify_end())
                        .child(
                            div()
                                .size(px(thumb))
                                .rounded(px(radius::FULL))
                                .bg(c(t.background))
                                .shadow_sm(),
                        ),
                )
        } else {
            row.gap(px(ITEM_GAP))
                .pr(px(16.))
                .child(div().flex_none().w(px(16.)).when(self.checked, |s| {
                    s.child(icon("check", ICON_SIZE, t.foreground))
                }))
                .child(match self.status {
                    Some((status, color)) => div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .items_center()
                        .gap(px(12.))
                        .child(div().flex_1().min_w_0().truncate().child(self.label))
                        .child(
                            div()
                                .flex_none()
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .text_color(c(color))
                                .child(status),
                        ),
                    None => div().flex_1().min_w_0().child(self.label),
                })
        };
        row.when_some(self.on_click.filter(|_| !disabled), |s, handler| {
            s.on_click(move |event, window, cx| handler(event, window, cx))
        })
    }
}

#[derive(IntoElement)]
pub struct MenuRadioItem {
    id: ElementId,
    checked: bool,
    disabled: bool,
    highlighted: bool,
    indicator: bool,
    on_click: Option<ClickHandler>,
    children: Vec<AnyElement>,
}

impl MenuRadioItem {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            checked: false,
            disabled: false,
            highlighted: false,
            indicator: false,
            on_click: None,
            children: Vec::new(),
        }
    }

    pub fn checked(mut self, checked: bool) -> Self {
        self.checked = checked;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn highlighted(mut self, highlighted: bool) -> Self {
        self.highlighted = highlighted;
        self
    }

    pub fn indicator(mut self, indicator: bool) -> Self {
        self.indicator = indicator;
        self
    }

    pub fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
}

impl ParentElement for MenuRadioItem {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for MenuRadioItem {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        let disabled = self.disabled;
        item_row(self.id, &t, MenuDensity::Default, disabled)
            .px(px(ITEM_PADDING_X))
            .when(self.checked, |s| s.bg(c(fade(t.foreground, 0.08))))
            .when(self.highlighted && !disabled, |s| {
                s.bg(c(t.accent)).text_color(c(t.accent_foreground))
            })
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .items_center()
                    .gap(px(ITEM_GAP))
                    .children(self.children),
            )
            .when(self.indicator && self.checked, |s| {
                s.child(
                    div()
                        .flex()
                        .flex_none()
                        .child(icon("check", 14., t.foreground)),
                )
            })
            .when_some(self.on_click.filter(|_| !disabled), |s, handler| {
                s.on_click(move |event, window, cx| handler(event, window, cx))
            })
    }
}

#[derive(IntoElement)]
pub struct MenuGroupLabel {
    label: SharedString,
    inset: bool,
}

impl MenuGroupLabel {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            inset: false,
        }
    }

    pub fn inset(mut self, inset: bool) -> Self {
        self.inset = inset;
        self
    }
}

impl RenderOnce for MenuGroupLabel {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        div()
            .px(px(8.))
            .py(px(6.))
            .when(self.inset, |s| s.pl(px(ITEM_INSET)))
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .font_weight(FontWeight::MEDIUM)
            .text_color(c(t.muted_foreground))
            .child(self.label)
    }
}

#[derive(IntoElement, Default)]
pub struct MenuSeparator;

impl MenuSeparator {
    pub fn new() -> Self {
        Self
    }
}

impl RenderOnce for MenuSeparator {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        div()
            .mx(px(8.))
            .my(px(4.))
            .h(px(1.))
            .flex_none()
            .bg(c(t.border))
    }
}

#[derive(IntoElement)]
pub struct MenuShortcut {
    keys: SharedString,
}

impl MenuShortcut {
    pub fn new(keys: impl Into<SharedString>) -> Self {
        Self { keys: keys.into() }
    }
}

impl RenderOnce for MenuShortcut {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        tracked_text(&self.keys, SHORTCUT_TRACKING)
            .ml_auto()
            .flex_none()
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .font_weight(FontWeight::MEDIUM)
            .text_color(c(t.secondary_label))
    }
}

#[derive(IntoElement)]
pub struct MenuSubTrigger {
    id: ElementId,
    label: SharedString,
    icon: Option<SharedString>,
    leading: Option<AnyElement>,
    inset: bool,
    density: MenuDensity,
    disabled: bool,
    open: bool,
    highlighted: bool,
    on_click: Option<ClickHandler>,
    on_hover: Option<HoverHandler>,
}

impl MenuSubTrigger {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            icon: None,
            leading: None,
            inset: false,
            density: MenuDensity::Default,
            disabled: false,
            open: false,
            highlighted: false,
            on_click: None,
            on_hover: None,
        }
    }

    pub fn icon(mut self, name: impl Into<SharedString>) -> Self {
        self.icon = Some(name.into());
        self
    }

    pub fn leading(mut self, element: impl IntoElement) -> Self {
        self.leading = Some(element.into_any_element());
        self
    }

    pub fn inset(mut self, inset: bool) -> Self {
        self.inset = inset;
        self
    }

    pub fn density(mut self, density: MenuDensity) -> Self {
        self.density = density;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn open(mut self, open: bool) -> Self {
        self.open = open;
        self
    }

    pub fn highlighted(mut self, highlighted: bool) -> Self {
        self.highlighted = highlighted;
        self
    }

    pub fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }

    pub fn on_hover(mut self, handler: impl Fn(&bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_hover = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for MenuSubTrigger {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        let disabled = self.disabled;
        item_row(self.id, &t, self.density, disabled)
            .gap(px(ITEM_GAP))
            .px(px(ITEM_PADDING_X))
            .when(self.inset, |s| s.pl(px(ITEM_INSET)))
            .when((self.open || self.highlighted) && !disabled, |s| {
                s.bg(c(t.accent)).text_color(c(t.accent_foreground))
            })
            .when_some(self.leading, |s, leading| s.child(leading))
            .when_some(self.icon, |s, name| {
                s.child(
                    div()
                        .mx(px(-2.))
                        .flex_none()
                        .opacity(ICON_OPACITY)
                        .child(icon(&name, ICON_SIZE, t.muted_foreground)),
                )
            })
            .child(div().min_w_0().truncate().child(self.label))
            .child(
                div()
                    .ml_auto()
                    .mr(px(-2.))
                    .flex_none()
                    .opacity(ICON_OPACITY)
                    .child(icon("chevron-right", ICON_SIZE, t.muted_foreground)),
            )
            .when_some(self.on_hover.filter(|_| !disabled), |s, handler| {
                s.on_hover(move |hovered, window, cx| handler(hovered, window, cx))
            })
            .when_some(self.on_click.filter(|_| !disabled), |s, handler| {
                s.on_click(move |event, window, cx| handler(event, window, cx))
            })
    }
}
