use gpui::{
    AnyElement, App, FontWeight, IntoElement, ParentElement, RenderOnce, SharedString, Styled,
    Window, div, px,
};

use crate::ui::theme;
use crate::ui::theme::metrics::{space, text};

pub const LINE_HEIGHT: f32 = 16.;

#[derive(IntoElement)]
pub struct Label {
    text: Option<SharedString>,
    children: Vec<AnyElement>,
}

impl Label {
    pub fn new(text: impl Into<SharedString>) -> Self {
        Self {
            text: Some(text.into()),
            children: Vec::new(),
        }
    }

    pub fn empty() -> Self {
        Self {
            text: None,
            children: Vec::new(),
        }
    }
}

impl ParentElement for Label {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Label {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        div()
            .flex()
            .items_center()
            .gap(px(space::S2))
            .text_size(px(text::SM))
            .line_height(px(LINE_HEIGHT))
            .font_weight(FontWeight::MEDIUM)
            .text_color(theme::active(cx).foreground)
            .children(self.text)
            .children(self.children)
    }
}
