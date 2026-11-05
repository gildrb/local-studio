use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    Anchor, AnyElement, App, Bounds, BoxShadow, Deferred, Div, ElementId, Hsla, InteractiveElement,
    IntoElement, ParentElement, Pixels, Point, RenderOnce, Rgba, SharedString, Stateful,
    StatefulInteractiveElement, Styled, Window, anchored, deferred, div, point, px,
};

use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Appearance, fade, glass_blur, glass_saturation};
use crate::ui::theme::{Tokens, active};

pub type DismissHandler = Rc<dyn Fn(&mut Window, &mut App) + 'static>;
pub type HoverHandler = Rc<dyn Fn(&bool, &mut Window, &mut App) + 'static>;

pub const SIDE_OFFSET: f32 = 4.;
pub const DROPDOWN_LAYER: usize = 130;
pub const TOOLTIP_LAYER: usize = 140;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Side {
    Top,
    #[default]
    Bottom,
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Align {
    Start,
    #[default]
    Center,
    End,
}

fn c(color: Rgba) -> Hsla {
    color.into()
}

pub fn shadow(x: f32, y: f32, blur: f32, spread: f32, color: Rgba) -> BoxShadow {
    BoxShadow {
        color: c(color),
        offset: point(px(x), px(y)),
        blur_radius: px(blur),
        spread_radius: px(spread),
        inset: false,
    }
}

pub fn inset_shadow(x: f32, y: f32, color: Rgba) -> BoxShadow {
    BoxShadow {
        color: c(color),
        offset: point(px(x), px(y)),
        blur_radius: px(0.),
        spread_radius: px(0.),
        inset: true,
    }
}

pub fn black(a: f32) -> Rgba {
    Rgba {
        r: 0.,
        g: 0.,
        b: 0.,
        a,
    }
}

pub fn white(a: f32) -> Rgba {
    Rgba {
        r: 1.,
        g: 1.,
        b: 1.,
        a,
    }
}

pub fn dark(t: &Tokens) -> bool {
    t.appearance == Appearance::Dark
}

pub fn dropdown_glass_background(t: &Tokens) -> Rgba {
    let base = fade(t.popover, t.glass_opacity);
    let a = 0.18 * t.popover.a + 0.82 * base.a;
    Rgba { a, ..t.popover }
}

pub fn dropdown_glass_border(t: &Tokens) -> Rgba {
    fade(t.foreground, 0.1)
}

pub fn dropdown_shadow(t: &Tokens) -> Vec<BoxShadow> {
    if dark(t) {
        vec![shadow(0., 18., 44., -18., black(0.8))]
    } else {
        vec![shadow(0., 16., 40., -18., black(0.55))]
    }
}

pub fn dropdown_glass(cx: &App) -> Div {
    let t = active(cx);
    div()
        .flex()
        .relative()
        .rounded(px(radius::LG))
        .backdrop_blur(px(glass_blur(&t)))
        .backdrop_saturate(glass_saturation(&t))
        .border_1()
        .border_color(c(dropdown_glass_border(&t)))
        .bg(c(dropdown_glass_background(&t)))
        .text_color(c(t.popover_foreground))
        .shadow(dropdown_shadow(&t))
}

pub fn positioned(
    trigger: Bounds<Pixels>,
    side: Side,
    align: Align,
    side_offset: f32,
    align_offset: f32,
    popup: impl IntoElement,
) -> Deferred {
    positioned_with_priority(
        trigger,
        side,
        align,
        side_offset,
        align_offset,
        DROPDOWN_LAYER,
        popup,
    )
}

pub fn positioned_with_priority(
    trigger: Bounds<Pixels>,
    side: Side,
    align: Align,
    side_offset: f32,
    align_offset: f32,
    priority: usize,
    popup: impl IntoElement,
) -> Deferred {
    let (position, corner) = placement(trigger, side, align, side_offset, align_offset);
    deferred(
        anchored()
            .position(position)
            .anchor(corner)
            .snap_to_window_with_margin(px(8.))
            .child(super::overlay_bounds::tracked(popup)),
    )
    .with_priority(priority)
}

pub fn placement(
    trigger: Bounds<Pixels>,
    side: Side,
    align: Align,
    side_offset: f32,
    align_offset: f32,
) -> (Point<Pixels>, Anchor) {
    let o = px(side_offset);
    let a = px(align_offset);
    let left = trigger.left();
    let right = trigger.right();
    let top = trigger.top();
    let bottom = trigger.bottom();
    let cx = trigger.center().x;
    let cy = trigger.center().y;
    match (side, align) {
        (Side::Bottom, Align::Start) => (point(left + a, bottom + o), Anchor::TopLeft),
        (Side::Bottom, Align::Center) => (point(cx + a, bottom + o), Anchor::TopCenter),
        (Side::Bottom, Align::End) => (point(right - a, bottom + o), Anchor::TopRight),
        (Side::Top, Align::Start) => (point(left + a, top - o), Anchor::BottomLeft),
        (Side::Top, Align::Center) => (point(cx + a, top - o), Anchor::BottomCenter),
        (Side::Top, Align::End) => (point(right - a, top - o), Anchor::BottomRight),
        (Side::Right, Align::Start) => (point(right + o, top + a), Anchor::TopLeft),
        (Side::Right, Align::Center) => (point(right + o, cy + a), Anchor::LeftCenter),
        (Side::Right, Align::End) => (point(right + o, bottom - a), Anchor::BottomLeft),
        (Side::Left, Align::Start) => (point(left - o, top + a), Anchor::TopRight),
        (Side::Left, Align::Center) => (point(left - o, cy + a), Anchor::RightCenter),
        (Side::Left, Align::End) => (point(left - o, bottom - a), Anchor::BottomRight),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum PopoverWidth {
    #[default]
    Auto,
    Sm,
    Md,
    Lg,
}

impl PopoverWidth {
    fn px(self) -> Option<f32> {
        match self {
            PopoverWidth::Auto => None,
            PopoverWidth::Sm => Some(256.),
            PopoverWidth::Md => Some(320.),
            PopoverWidth::Lg => Some(384.),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum PopoverPadding {
    #[default]
    Default,
    Compact,
    None,
}

impl PopoverPadding {
    fn insets(self, tooltip_style: bool) -> (f32, f32) {
        match (self, tooltip_style) {
            (PopoverPadding::Default, true) => (4., 8.),
            (PopoverPadding::Default, false) => (16., 16.),
            (PopoverPadding::Compact, _) => (8., 12.),
            (PopoverPadding::None, _) => (0., 0.),
        }
    }
}

#[derive(IntoElement)]
pub struct PopoverPopup {
    id: ElementId,
    trigger: Bounds<Pixels>,
    side: Side,
    align: Align,
    side_offset: f32,
    align_offset: f32,
    width: PopoverWidth,
    padding: PopoverPadding,
    tooltip_style: bool,
    max_height: Option<f32>,
    on_dismiss: Option<DismissHandler>,
    children: Vec<AnyElement>,
}

impl PopoverPopup {
    pub fn new(id: impl Into<ElementId>, trigger: Bounds<Pixels>) -> Self {
        Self {
            id: id.into(),
            trigger,
            side: Side::Bottom,
            align: Align::Center,
            side_offset: SIDE_OFFSET,
            align_offset: 0.,
            width: PopoverWidth::Auto,
            padding: PopoverPadding::Default,
            tooltip_style: false,
            max_height: None,
            on_dismiss: None,
            children: Vec::new(),
        }
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

    pub fn width(mut self, width: PopoverWidth) -> Self {
        self.width = width;
        self
    }

    pub fn padding(mut self, padding: PopoverPadding) -> Self {
        self.padding = padding;
        self
    }

    pub fn tooltip_style(mut self, tooltip_style: bool) -> Self {
        self.tooltip_style = tooltip_style;
        self
    }

    pub fn max_height(mut self, max_height: f32) -> Self {
        self.max_height = Some(max_height);
        self
    }

    pub fn on_dismiss(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_dismiss = Some(Rc::new(handler));
        self
    }
}

impl ParentElement for PopoverPopup {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for PopoverPopup {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        let (py, pxl) = self.padding.insets(self.tooltip_style);
        let max_h = self
            .max_height
            .unwrap_or(f32::from(window.viewport_size().height) - 16.);
        let surface = dropdown_glass(cx)
            .id(self.id.clone())
            .occlude()
            .when_some(self.width.px(), |s, w| {
                s.w(px(w)).max_w(window.viewport_size().width - px(32.))
            })
            .when(self.tooltip_style, |s| {
                s.rounded(px(radius::MD))
                    .text_size(px(text::XS))
                    .shadow(vec![
                        shadow(0., 4., 6., -1., black(0.05)),
                        shadow(0., 2., 4., -2., black(0.05)),
                    ])
            })
            .when(!self.tooltip_style, |s| {
                s.shadow(
                    dropdown_shadow(&t)
                        .into_iter()
                        .chain(std::iter::once(top_highlight(&t)))
                        .collect::<Vec<_>>(),
                )
            })
            .when_some(self.on_dismiss, |s, dismiss| {
                s.on_mouse_down_out(move |_, window, cx| dismiss(window, cx))
            })
            .child(
                viewport(self.id)
                    .relative()
                    .size_full()
                    .max_h(px(max_h))
                    .overflow_y_scroll()
                    .py(px(py))
                    .px(px(pxl))
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

fn viewport(id: ElementId) -> Stateful<Div> {
    div().id(ElementId::Name(SharedString::from(format!(
        "{id}-viewport"
    ))))
}

pub fn top_highlight(t: &Tokens) -> BoxShadow {
    if dark(t) {
        inset_shadow(0., 1., white(0.06))
    } else {
        inset_shadow(0., -1., black(0.04))
    }
}

#[derive(IntoElement)]
pub struct PopoverTitle {
    label: SharedString,
}

impl PopoverTitle {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
        }
    }
}

impl RenderOnce for PopoverTitle {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        div()
            .text_size(px(text::SM))
            .line_height(px(text::SM))
            .font_weight(gpui::FontWeight::SEMIBOLD)
            .child(self.label)
    }
}
