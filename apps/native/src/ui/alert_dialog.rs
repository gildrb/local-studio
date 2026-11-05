use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, ElementId, Hsla, InteractiveElement, IntoElement, ParentElement, RenderOnce,
    Rgba, SharedString, StatefulInteractiveElement, Styled, Window, div, px,
};

use super::dialog::{
    DIALOG_LAYER, DialogFooterVariant, MAX_WIDTH, SECTION_PADDING, VIEWPORT_PADDING,
    backdrop_color, description, dialog_glass, footer, overlay_layer, title,
};
use crate::ui::theme::active;

type Handler = Rc<dyn Fn(&mut Window, &mut App) + 'static>;

fn c(color: Rgba) -> Hsla {
    color.into()
}

#[derive(IntoElement)]
pub struct AlertDialogPopup {
    id: ElementId,
    on_dismiss: Option<Handler>,
    children: Vec<AnyElement>,
}

impl AlertDialogPopup {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            on_dismiss: None,
            children: Vec::new(),
        }
    }

    pub fn on_dismiss(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_dismiss = Some(Rc::new(handler));
        self
    }
}

impl ParentElement for AlertDialogPopup {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for AlertDialogPopup {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        let popup_id = ElementId::Name(SharedString::from(format!("{}-popup", self.id)));
        overlay_layer(
            self.id,
            DIALOG_LAYER,
            backdrop_color(&t),
            self.on_dismiss,
            div()
                .size_full()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .p(px(VIEWPORT_PADDING))
                .child(
                    dialog_glass(&t)
                        .id(popup_id)
                        .max_w(px(MAX_WIDTH))
                        .max_h_full()
                        .text_color(c(t.popover_foreground))
                        .on_click(|_, _, cx| cx.stop_propagation())
                        .children(self.children),
                ),
            window,
        )
    }
}

#[derive(IntoElement, Default)]
pub struct AlertDialogHeader {
    children: Vec<AnyElement>,
}

impl AlertDialogHeader {
    pub fn new() -> Self {
        Self::default()
    }
}

impl ParentElement for AlertDialogHeader {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for AlertDialogHeader {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .p(px(SECTION_PADDING))
            .children(self.children)
    }
}

#[derive(IntoElement, Default)]
pub struct AlertDialogFooter {
    variant: DialogFooterVariant,
    children: Vec<AnyElement>,
}

impl AlertDialogFooter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn variant(mut self, variant: DialogFooterVariant) -> Self {
        self.variant = variant;
        self
    }
}

impl ParentElement for AlertDialogFooter {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for AlertDialogFooter {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        footer(&t, self.variant)
            .when(self.variant == DialogFooterVariant::Bare, |s| {
                s.pb(px(SECTION_PADDING))
            })
            .children(self.children)
    }
}

#[derive(IntoElement)]
pub struct AlertDialogTitle {
    label: SharedString,
}

impl AlertDialogTitle {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
        }
    }
}

impl RenderOnce for AlertDialogTitle {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        title(self.label)
    }
}

#[derive(IntoElement)]
pub struct AlertDialogDescription {
    label: SharedString,
}

impl AlertDialogDescription {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
        }
    }
}

impl RenderOnce for AlertDialogDescription {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        description(&active(cx), self.label)
    }
}
