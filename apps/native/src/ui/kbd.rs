use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, FontWeight, IntoElement, ParentElement, Refineable, RenderOnce, SharedString,
    StyleRefinement, Styled, Window, div, px,
};

use super::button::icon;
use crate::platform::UI_FONT;
use crate::ui::theme;
use crate::ui::theme::metrics::text;

pub const HEIGHT: f32 = 20.;
pub const PADDING_X: f32 = 4.;
pub const RADIUS: f32 = 4.;
pub const GAP: f32 = 4.;
pub const ICON: f32 = 12.;

#[derive(IntoElement)]
pub struct Kbd {
    icon: Option<SharedString>,
    label: Option<SharedString>,
    children: Vec<AnyElement>,
    style: StyleRefinement,
}

impl Kbd {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            icon: None,
            label: Some(label.into()),
            children: Vec::new(),
            style: StyleRefinement::default(),
        }
    }

    pub fn icon(name: impl Into<SharedString>) -> Self {
        Self {
            icon: Some(name.into()),
            label: None,
            children: Vec::new(),
            style: StyleRefinement::default(),
        }
    }
}

impl Styled for Kbd {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl ParentElement for Kbd {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Kbd {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let mut kbd = div()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .gap(px(GAP))
            .h(px(HEIGHT))
            .min_w(px(HEIGHT))
            .px(px(PADDING_X))
            .rounded(px(RADIUS))
            .bg(t.muted)
            .text_color(t.muted_foreground)
            .font_family(UI_FONT)
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .font_weight(FontWeight::MEDIUM)
            .whitespace_nowrap()
            .when_some(self.icon.as_ref(), |k, name| {
                k.child(icon(name, ICON, t.muted_foreground))
            })
            .when_some(self.label, |k, label| k.child(label))
            .children(self.children);
        kbd.style().refine(&self.style);
        kbd
    }
}

#[derive(IntoElement, Default)]
pub struct KbdGroup {
    children: Vec<AnyElement>,
}

impl KbdGroup {
    pub fn new() -> Self {
        Self::default()
    }
}

impl ParentElement for KbdGroup {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for KbdGroup {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(GAP))
            .children(self.children)
    }
}
