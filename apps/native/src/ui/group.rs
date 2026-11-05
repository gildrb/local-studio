use gpui::Refineable;
use gpui::{
    AnyElement, App, IntoElement, ParentElement, RenderOnce, StyleRefinement, Styled, Window, div,
    px,
};

use crate::ui::theme;
use crate::ui::theme::color::over;
use crate::ui::theme::metrics::space;
use crate::ui::theme::tokens::{Appearance, fade};

use super::separator::{Orientation, Separator};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Segment {
    Only,
    First,
    Middle,
    Last,
}

impl Segment {
    pub fn at(index: usize, len: usize) -> Self {
        match (index, len) {
            (_, 0 | 1) => Segment::Only,
            (0, _) => Segment::First,
            (i, n) if i + 1 == n => Segment::Last,
            _ => Segment::Middle,
        }
    }

    pub fn joins_start(self) -> bool {
        matches!(self, Segment::Middle | Segment::Last)
    }

    pub fn joins_end(self) -> bool {
        matches!(self, Segment::First | Segment::Middle)
    }
}

#[derive(IntoElement)]
pub struct Group {
    orientation: Orientation,
    nested: bool,
    children: Vec<AnyElement>,
    style: StyleRefinement,
}

impl Group {
    pub fn new() -> Self {
        Self {
            orientation: Orientation::Horizontal,
            nested: false,
            children: Vec::new(),
            style: StyleRefinement::default(),
        }
    }

    pub fn orientation(mut self, orientation: Orientation) -> Self {
        self.orientation = orientation;
        self
    }

    pub fn vertical(self) -> Self {
        self.orientation(Orientation::Vertical)
    }

    pub fn nested(mut self, nested: bool) -> Self {
        self.nested = nested;
        self
    }
}

impl Default for Group {
    fn default() -> Self {
        Self::new()
    }
}

impl ParentElement for Group {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl Styled for Group {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for Group {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let mut root = div().flex();
        if self.orientation == Orientation::Vertical {
            root = root.flex_col();
        }
        if self.nested {
            root = root.gap(px(space::S2));
        }
        root.style().refine(&self.style);
        root.children(self.children)
    }
}

pub fn separator_color(cx: &App) -> gpui::Rgba {
    let t = theme::active(cx);
    match t.appearance {
        Appearance::Dark => over(fade(t.input, 0.32), t.input),
        Appearance::Light => t.input,
    }
}

#[derive(IntoElement)]
pub struct GroupSeparator {
    orientation: Orientation,
    focused: bool,
}

impl GroupSeparator {
    pub fn new() -> Self {
        Self {
            orientation: Orientation::Vertical,
            focused: false,
        }
    }

    pub fn orientation(mut self, orientation: Orientation) -> Self {
        self.orientation = orientation;
        self
    }

    pub fn focused(mut self, focused: bool) -> Self {
        self.focused = focused;
        self
    }
}

impl Default for GroupSeparator {
    fn default() -> Self {
        Self::new()
    }
}

impl RenderOnce for GroupSeparator {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let color = if self.focused {
            theme::active(cx).ring
        } else {
            separator_color(cx)
        };
        Separator::new().orientation(self.orientation).color(color)
    }
}
