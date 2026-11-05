use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Bounds, ElementId, Hsla, InteractiveElement, IntoElement, ParentElement,
    Pixels, RenderOnce, Rgba, StatefulInteractiveElement, Styled, Window, div, px,
};

use super::popover::HoverHandler;
use super::popover::{Align, Side, TOOLTIP_LAYER, black, positioned_with_priority, shadow};
use crate::ui::theme::active;
use crate::ui::theme::metrics::radius;

pub const SIDE_OFFSET: f32 = 6.;

fn c(color: Rgba) -> Hsla {
    color.into()
}

#[derive(IntoElement)]
pub struct PreviewCardPopup {
    id: ElementId,
    trigger: Bounds<Pixels>,
    side: Side,
    align: Align,
    side_offset: f32,
    on_hover: Option<HoverHandler>,
    children: Vec<AnyElement>,
}

impl PreviewCardPopup {
    pub fn new(id: impl Into<ElementId>, trigger: Bounds<Pixels>) -> Self {
        Self {
            id: id.into(),
            trigger,
            side: Side::Top,
            align: Align::Start,
            side_offset: SIDE_OFFSET,
            on_hover: None,
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

    pub fn on_hover(mut self, handler: impl Fn(&bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_hover = Some(Rc::new(handler));
        self
    }
}

impl ParentElement for PreviewCardPopup {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for PreviewCardPopup {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        let card = div()
            .id(self.id)
            .occlude()
            .max_w(window.viewport_size().width)
            .rounded(px(radius::LG))
            .border_1()
            .border_color(c(t.border))
            .bg(c(t.popover))
            .text_color(c(t.popover_foreground))
            .shadow(vec![
                shadow(0., 10., 15., -3., black(0.1)),
                shadow(0., 4., 6., -4., black(0.1)),
            ])
            .when_some(self.on_hover, |s, handler| {
                s.on_hover(move |hovered, window, cx| handler(hovered, window, cx))
            })
            .children(self.children);
        positioned_with_priority(
            self.trigger,
            self.side,
            self.align,
            self.side_offset,
            0.,
            TOOLTIP_LAYER,
            card,
        )
    }
}
