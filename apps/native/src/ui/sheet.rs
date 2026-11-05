use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, ElementId, Hsla, InteractiveElement, IntoElement, ParentElement, RenderOnce,
    Rgba, SharedString, StatefulInteractiveElement, Styled, Window, div, px,
};

use super::dialog::{SECTION_PADDING, close_button, description, overlay_layer, title};
use super::popover::{black, shadow, top_highlight};
use crate::ui::theme::active;
use crate::ui::theme::metrics::radius;
use crate::ui::theme::tokens::fade;

pub const SHEET_LAYER: usize = 46;
pub const EDGE_GAP: f32 = 48.;
pub const MAX_WIDTH: f32 = 448.;
pub const INSET_PADDING: f32 = 16.;

type Handler = Rc<dyn Fn(&mut Window, &mut App) + 'static>;

fn c(color: Rgba) -> Hsla {
    color.into()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum SheetSide {
    #[default]
    Right,
    Left,
    Top,
    Bottom,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum SheetVariant {
    #[default]
    Default,
    Inset,
}

#[derive(IntoElement)]
pub struct SheetPopup {
    id: ElementId,
    side: SheetSide,
    variant: SheetVariant,
    show_close_button: bool,
    on_close: Option<Handler>,
    children: Vec<AnyElement>,
}

impl SheetPopup {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            side: SheetSide::Right,
            variant: SheetVariant::Default,
            show_close_button: true,
            on_close: None,
            children: Vec::new(),
        }
    }

    pub fn side(mut self, side: SheetSide) -> Self {
        self.side = side;
        self
    }

    pub fn variant(mut self, variant: SheetVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn show_close_button(mut self, show: bool) -> Self {
        self.show_close_button = show;
        self
    }

    pub fn on_close(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_close = Some(Rc::new(handler));
        self
    }
}

impl ParentElement for SheetPopup {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for SheetPopup {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        let size = window.viewport_size();
        let inset = self.variant == SheetVariant::Inset;
        let popup_id = ElementId::Name(SharedString::from(format!("{}-popup", self.id)));
        let close_id = ElementId::Name(SharedString::from(format!("{}-close", self.id)));
        let border = c(t.border);
        let horizontal = matches!(self.side, SheetSide::Left | SheetSide::Right);
        let popup = div()
            .id(popup_id)
            .relative()
            .flex()
            .flex_col()
            .min_h_0()
            .min_w_0()
            .bg(c(t.popover))
            .text_color(c(t.popover_foreground))
            .shadow(vec![
                shadow(0., 10., 15., -3., black(0.05)),
                shadow(0., 4., 6., -4., black(0.05)),
                top_highlight(&t),
            ])
            .when(horizontal, |s| {
                s.h_full().w(size.width - px(EDGE_GAP)).max_w(px(MAX_WIDTH))
            })
            .when(!horizontal, |s| {
                s.w_full().max_h(size.height - px(EDGE_GAP))
            })
            .map(|s| match (self.side, inset) {
                (_, true) => s.rounded(px(radius::XXL)).border_1().border_color(border),
                (SheetSide::Right, false) => s.border_l_1().border_color(border),
                (SheetSide::Left, false) => s.border_r_1().border_color(border),
                (SheetSide::Top, false) => s.border_b_1().border_color(border),
                (SheetSide::Bottom, false) => s.border_t_1().border_color(border),
            })
            .on_click(|_, _, cx| cx.stop_propagation())
            .children(self.children)
            .when(self.show_close_button, |s| {
                s.child(close_button(close_id, &t, self.on_close.clone()))
            });
        let viewport = div()
            .size_full()
            .flex()
            .when(inset, |s| s.p(px(INSET_PADDING)))
            .map(|s| match self.side {
                SheetSide::Right => s.flex_row().justify_end(),
                SheetSide::Left => s.flex_row().justify_start(),
                SheetSide::Top => s.flex_col().justify_start(),
                SheetSide::Bottom => s.flex_col().justify_end(),
            })
            .child(popup);
        overlay_layer(
            self.id,
            SHEET_LAYER,
            fade(t.background, 0.6),
            self.on_close,
            viewport,
            window,
        )
    }
}

#[derive(IntoElement)]
pub struct SheetHeader {
    with_panel: bool,
    children: Vec<AnyElement>,
}

impl SheetHeader {
    pub fn new() -> Self {
        Self {
            with_panel: false,
            children: Vec::new(),
        }
    }

    pub fn with_panel(mut self, with_panel: bool) -> Self {
        self.with_panel = with_panel;
        self
    }
}

impl Default for SheetHeader {
    fn default() -> Self {
        Self::new()
    }
}

impl ParentElement for SheetHeader {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for SheetHeader {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .p(px(SECTION_PADDING))
            .when(self.with_panel, |s| s.pb(px(12.)))
            .children(self.children)
    }
}

#[derive(IntoElement)]
pub struct SheetTitle {
    label: SharedString,
}

impl SheetTitle {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
        }
    }
}

impl RenderOnce for SheetTitle {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        title(self.label)
    }
}

#[derive(IntoElement)]
pub struct SheetDescription {
    label: SharedString,
}

impl SheetDescription {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
        }
    }
}

impl RenderOnce for SheetDescription {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        description(&active(cx), self.label)
    }
}
