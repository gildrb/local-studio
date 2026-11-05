use gpui::{
    AnyView, App, AppContext, Bounds, Context, Div, Hsla, IntoElement, ParentElement, Pixels,
    Render, RenderOnce, Rgba, SharedString, Styled, Window, div, px,
};

use super::popover::{
    Align, Side, TOOLTIP_LAYER, black, dropdown_glass, positioned_with_priority, shadow,
    top_highlight,
};
use crate::platform::MONO_FONT;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::{Tokens, active};

pub const SIDE_OFFSET: f32 = 4.;
pub const PADDING_X: f32 = 8.;
pub const PADDING_Y: f32 = 4.;
pub const MAX_WIDTH: f32 = 320.;
pub const CODE_MAX_WIDTH: f32 = 480.;
pub const LINE_HEIGHT: f32 = 16.5;
pub const CODE_TEXT: f32 = 11.;
pub const CODE_LINE_HEIGHT: f32 = 17.875;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum TooltipVariant {
    #[default]
    Default,
    Glass,
    Code,
}

fn c(color: Rgba) -> Hsla {
    color.into()
}

fn surface(variant: TooltipVariant, t: &Tokens, cx: &App) -> Div {
    let base = match variant {
        TooltipVariant::Glass => dropdown_glass(cx).shadow(vec![
            shadow(0., 20., 25., -5., black(0.25)),
            shadow(0., 8., 10., -6., black(0.25)),
        ]),
        TooltipVariant::Default | TooltipVariant::Code => div()
            .flex()
            .relative()
            .border_1()
            .border_color(c(t.border))
            .bg(c(t.popover))
            .text_color(c(t.popover_foreground))
            .shadow(vec![
                shadow(0., 4., 6., -1., black(0.05)),
                shadow(0., 2., 4., -2., black(0.05)),
                top_highlight(t),
            ]),
    };
    let base = base.rounded(px(radius::MD)).text_size(px(text::XS));
    match variant {
        TooltipVariant::Code => base
            .max_w(px(CODE_MAX_WIDTH))
            .font_family(MONO_FONT)
            .text_size(px(CODE_TEXT))
            .line_height(px(CODE_LINE_HEIGHT)),
        _ => base.max_w(px(MAX_WIDTH)).line_height(px(LINE_HEIGHT)),
    }
}

fn content(label: SharedString) -> Div {
    div()
        .relative()
        .px(px(PADDING_X))
        .py(px(PADDING_Y))
        .child(label)
}

pub struct Tooltip {
    label: SharedString,
    variant: TooltipVariant,
}

impl Tooltip {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            variant: TooltipVariant::Default,
        }
    }

    pub fn variant(mut self, variant: TooltipVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn text(
        label: impl Into<SharedString>,
    ) -> impl Fn(&mut Window, &mut App) -> AnyView + 'static {
        Self::builder(label.into(), TooltipVariant::Default)
    }

    pub fn builder(
        label: SharedString,
        variant: TooltipVariant,
    ) -> impl Fn(&mut Window, &mut App) -> AnyView + 'static {
        move |_, cx| {
            let label = label.clone();
            cx.new(move |_| Tooltip { label, variant }).into()
        }
    }
}

impl Render for Tooltip {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = active(cx);
        super::overlay_bounds::tracked(
            surface(self.variant, &t, cx).child(content(self.label.clone())),
        )
    }
}

#[derive(IntoElement)]
pub struct TooltipPopup {
    trigger: Bounds<Pixels>,
    label: SharedString,
    side: Side,
    align: Align,
    side_offset: f32,
    variant: TooltipVariant,
}

impl TooltipPopup {
    pub fn new(trigger: Bounds<Pixels>, label: impl Into<SharedString>) -> Self {
        Self {
            trigger,
            label: label.into(),
            side: Side::Top,
            align: Align::Center,
            side_offset: SIDE_OFFSET,
            variant: TooltipVariant::Default,
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

    pub fn variant(mut self, variant: TooltipVariant) -> Self {
        self.variant = variant;
        self
    }
}

impl RenderOnce for TooltipPopup {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        positioned_with_priority(
            self.trigger,
            self.side,
            self.align,
            self.side_offset,
            0.,
            TOOLTIP_LAYER,
            surface(self.variant, &t, cx).child(content(self.label)),
        )
    }
}
