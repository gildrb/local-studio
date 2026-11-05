use gpui::{
    AnyElement, App, FontWeight, IntoElement, ParentElement, RenderOnce, SharedString, Styled,
    Window, div, px,
};

use crate::ui::theme;

const TEXT_SM: f32 = 14.;
const TEXT_SM_LINE: f32 = 20.;
const ITEM_GAP: f32 = 12.;

#[derive(IntoElement)]
pub struct WorkspaceBreadcrumb {
    children: Vec<AnyElement>,
}

impl WorkspaceBreadcrumb {
    pub fn new() -> Self {
        Self {
            children: Vec::new(),
        }
    }
}

impl Default for WorkspaceBreadcrumb {
    fn default() -> Self {
        Self::new()
    }
}

impl ParentElement for WorkspaceBreadcrumb {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for WorkspaceBreadcrumb {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        div().flex_1().min_w_0().overflow_hidden().child(
            div()
                .flex()
                .min_w_0()
                .items_center()
                .gap(px(ITEM_GAP))
                .text_size(px(TEXT_SM))
                .line_height(px(TEXT_SM_LINE))
                .children(self.children),
        )
    }
}

#[derive(IntoElement)]
pub struct WorkspaceBreadcrumbItem {
    current: bool,
    grow: bool,
    shrink: bool,
    children: Vec<AnyElement>,
}

impl WorkspaceBreadcrumbItem {
    pub fn new(current: bool) -> Self {
        Self {
            current,
            grow: false,
            shrink: false,
            children: Vec::new(),
        }
    }

    pub fn grow(mut self) -> Self {
        self.grow = true;
        self
    }

    pub fn shrink(mut self) -> Self {
        self.shrink = true;
        self
    }
}

impl ParentElement for WorkspaceBreadcrumbItem {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for WorkspaceBreadcrumbItem {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let item = div()
            .flex()
            .min_w_0()
            .items_center()
            .font_weight(FontWeight::MEDIUM)
            .text_color(if self.current {
                t.foreground
            } else {
                t.muted_foreground
            });
        let item = if self.grow {
            item.flex_1().min_w(px(40.))
        } else if self.current || self.shrink {
            item.flex_shrink(1.)
        } else {
            item.flex_shrink_0()
        };
        item.children(self.children)
    }
}

#[derive(IntoElement)]
pub struct WorkspaceBreadcrumbText {
    text: SharedString,
    max_width: Option<f32>,
}

impl WorkspaceBreadcrumbText {
    pub fn new(text: impl Into<SharedString>) -> Self {
        Self {
            text: text.into(),
            max_width: None,
        }
    }

    pub fn max_width(mut self, width: f32) -> Self {
        self.max_width = Some(width);
        self
    }
}

impl RenderOnce for WorkspaceBreadcrumbText {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let text = div().min_w_0().truncate().child(self.text);
        match self.max_width {
            Some(width) => text.max_w(px(width)),
            None => text,
        }
    }
}

#[derive(IntoElement)]
pub struct WorkspaceBreadcrumbSeparator;

impl RenderOnce for WorkspaceBreadcrumbSeparator {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        div()
            .flex()
            .flex_none()
            .items_center()
            .text_color(theme::active(cx).icon_muted)
            .child("/")
    }
}
