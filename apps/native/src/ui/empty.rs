use gpui::Refineable;
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, BoxShadow, FontWeight, IntoElement, ParentElement, RenderOnce, SharedString,
    StyleRefinement, Styled, Window, div, point, px, svg,
};

use crate::ui::theme;
use crate::ui::theme::color::hsla;
use crate::ui::theme::metrics::{radius, space, text};
use crate::ui::theme::tokens::fade;

pub const MAX_WIDTH: f32 = 384.;
pub const MEDIA_ICON_BOX: f32 = 36.;
pub const MEDIA_ICON: f32 = 18.;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum EmptySize {
    Compact,
    #[default]
    Default,
    Hero,
}

impl EmptySize {
    fn padding(self) -> f32 {
        match self {
            EmptySize::Compact => space::S10,
            EmptySize::Default | EmptySize::Hero => space::S12,
        }
    }

    fn gap(self) -> f32 {
        match self {
            EmptySize::Compact => space::S4,
            EmptySize::Default | EmptySize::Hero => space::S6,
        }
    }

    fn title(self) -> (f32, f32) {
        match self {
            EmptySize::Compact => (17., 24.),
            EmptySize::Default => (text::XL, text::XL_LINE),
            EmptySize::Hero => (text::XXXL, text::XXXL_LINE),
        }
    }

    fn description(self) -> (f32, f32) {
        match self {
            EmptySize::Compact => (13., 18.),
            EmptySize::Default | EmptySize::Hero => (text::SM, text::SM_LINE),
        }
    }

    fn media_gap(self) -> f32 {
        match self {
            EmptySize::Compact => 0.,
            EmptySize::Default | EmptySize::Hero => space::S6,
        }
    }
}

pub enum EmptyMedia {
    Plain(AnyElement),
    Icon(SharedString),
}

#[derive(IntoElement, Default)]
pub struct Empty {
    size: EmptySize,
    media: Option<EmptyMedia>,
    title: Option<AnyElement>,
    description: Option<AnyElement>,
    content: Vec<AnyElement>,
    style: StyleRefinement,
}

impl Empty {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn size(mut self, size: EmptySize) -> Self {
        self.size = size;
        self
    }

    pub fn media(mut self, media: EmptyMedia) -> Self {
        self.media = Some(media);
        self
    }

    pub fn icon(self, path: impl Into<SharedString>) -> Self {
        self.media(EmptyMedia::Icon(path.into()))
    }

    pub fn title(mut self, title: impl IntoElement) -> Self {
        self.title = Some(title.into_any_element());
        self
    }

    pub fn description(mut self, description: impl IntoElement) -> Self {
        self.description = Some(description.into_any_element());
        self
    }
}

impl ParentElement for Empty {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.content.extend(elements);
    }
}

impl Styled for Empty {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for Empty {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let size = self.size;
        let (title_size, title_line) = size.title();
        let (description_size, description_line) = size.description();
        let media = self.media.map(|media| {
            let inner = match media {
                EmptyMedia::Plain(element) => {
                    div().flex().items_center().justify_center().child(element)
                }
                EmptyMedia::Icon(path) => div()
                    .size(px(MEDIA_ICON_BOX))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(radius::MD))
                    .border_1()
                    .border_color(t.border)
                    .bg(t.card)
                    .shadow(vec![BoxShadow {
                        color: hsla(fade(gpui::rgba(0x000000ff), 0.05)),
                        offset: point(px(0.), px(1.)),
                        blur_radius: px(3.),
                        spread_radius: px(0.),
                        inset: false,
                    }])
                    .text_color(t.foreground)
                    .child(
                        svg()
                            .path(path)
                            .size(px(MEDIA_ICON))
                            .text_color(t.foreground),
                    ),
            };
            div()
                .relative()
                .mb(px(size.media_gap()))
                .flex_none()
                .child(inner)
        });
        let has_title = self.title.is_some();
        let header = div()
            .flex()
            .flex_col()
            .items_center()
            .max_w(px(MAX_WIDTH))
            .children(media)
            .children(self.title.map(|title| {
                div()
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_size(px(title_size))
                    .line_height(px(title_line))
                    .text_color(t.foreground)
                    .child(title)
            }))
            .children(self.description.map(|description| {
                div()
                    .when(has_title, |this| this.mt(px(space::S1)))
                    .text_size(px(description_size))
                    .line_height(px(description_line))
                    .text_color(t.muted_foreground)
                    .child(description)
            }));
        let content = (!self.content.is_empty()).then(|| {
            div()
                .w_full()
                .min_w_0()
                .max_w(px(MAX_WIDTH))
                .flex()
                .flex_col()
                .items_center()
                .gap(px(space::S4))
                .text_size(px(text::SM))
                .line_height(px(text::SM_LINE))
                .children(self.content)
        });
        let mut root = div()
            .flex()
            .flex_1()
            .min_w_0()
            .flex_col()
            .items_center()
            .justify_center()
            .text_center()
            .gap(px(size.gap()))
            .p(px(size.padding()))
            .when(size == EmptySize::Compact, |this| this.min_h(px(256.)));
        root.style().refine(&self.style);
        root.child(header).children(content)
    }
}
