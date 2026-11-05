use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, ClickEvent, ElementId, FontWeight, InteractiveElement, IntoElement,
    ParentElement, Refineable, RenderOnce, Rgba, SharedString, StatefulInteractiveElement,
    StyleRefinement, Styled, Window, div, px,
};

use super::button::{icon, is_dark};
use crate::ui::theme;
use crate::ui::theme::color::{WHITE, alpha, mix};
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum BadgeVariant {
    #[default]
    Default,
    Destructive,
    Error,
    Info,
    Outline,
    Secondary,
    Success,
    Warning,
    Label(Rgba),
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum BadgeSize {
    Control,
    #[default]
    Default,
    Lg,
    Sm,
}

pub struct BadgeMetrics {
    pub height: f32,
    pub padding_x: f32,
    pub font: f32,
    pub line: f32,
    pub radius: f32,
    pub icon: f32,
}

impl BadgeSize {
    pub const fn metrics(self) -> BadgeMetrics {
        let (height, padding_x, font, line, r) = match self {
            BadgeSize::Control => (24., 7., text::XS, text::XS_LINE, radius::CONTROL),
            BadgeSize::Default => (18., 3., text::XS, text::XS_LINE, radius::SM),
            BadgeSize::Lg => (22., 5., text::SM, text::SM_LINE, radius::SM),
            BadgeSize::Sm => (16., 3., 10., 10., 4.),
        };
        BadgeMetrics {
            height,
            padding_x,
            font,
            line,
            radius: r,
            icon: 12.,
        }
    }
}

struct Look {
    bg: Rgba,
    border: Rgba,
    fg: Rgba,
    hover_bg: Option<Rgba>,
}

fn look(variant: BadgeVariant, t: &Tokens) -> Look {
    let dark = is_dark(t);
    let tint = |color: Rgba| fade(color, if dark { 0.16 } else { 0.08 });
    let clear = alpha(WHITE, 0.);
    match variant {
        BadgeVariant::Default => Look {
            bg: t.primary,
            border: clear,
            fg: t.primary_foreground,
            hover_bg: Some(t.primary_hover),
        },
        BadgeVariant::Destructive => Look {
            bg: t.destructive,
            border: clear,
            fg: WHITE,
            hover_bg: Some(fade(t.destructive, 0.9)),
        },
        BadgeVariant::Error => Look {
            bg: tint(t.destructive),
            border: clear,
            fg: t.destructive_foreground,
            hover_bg: None,
        },
        BadgeVariant::Info => Look {
            bg: tint(t.info),
            border: clear,
            fg: t.info_foreground,
            hover_bg: None,
        },
        BadgeVariant::Outline => Look {
            bg: if dark {
                fade(t.input, 0.32)
            } else {
                t.background
            },
            border: t.input,
            fg: t.foreground,
            hover_bg: Some(if dark {
                fade(t.input, 0.48)
            } else {
                fade(t.accent, 0.5)
            }),
        },
        BadgeVariant::Secondary => Look {
            bg: t.secondary,
            border: clear,
            fg: t.secondary_foreground,
            hover_bg: Some(t.secondary_hover),
        },
        BadgeVariant::Success => Look {
            bg: tint(t.success),
            border: clear,
            fg: t.success_foreground,
            hover_bg: None,
        },
        BadgeVariant::Warning => Look {
            bg: tint(t.warning),
            border: clear,
            fg: t.warning_foreground,
            hover_bg: None,
        },
        BadgeVariant::Label(label) => Look {
            bg: fade(label, if dark { 0.12 } else { 0.08 }),
            border: clear,
            fg: mix(label, t.foreground, if dark { 0.45 } else { 0.3 }),
            hover_bg: None,
        },
    }
}

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Badge {
    id: Option<ElementId>,
    variant: BadgeVariant,
    size: BadgeSize,
    icon: Option<SharedString>,
    label: Option<SharedString>,
    children: Vec<AnyElement>,
    on_click: Option<ClickHandler>,
    style: StyleRefinement,
}

impl Badge {
    pub fn new() -> Self {
        Self {
            id: None,
            variant: BadgeVariant::default(),
            size: BadgeSize::default(),
            icon: None,
            label: None,
            children: Vec::new(),
            on_click: None,
            style: StyleRefinement::default(),
        }
    }

    pub fn variant(mut self, variant: BadgeVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn size(mut self, size: BadgeSize) -> Self {
        self.size = size;
        self
    }

    pub fn icon(mut self, name: impl Into<SharedString>) -> Self {
        self.icon = Some(name.into());
        self
    }

    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }

    pub fn on_click(
        mut self,
        id: impl Into<ElementId>,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.id = Some(id.into());
        self.on_click = Some(Rc::new(handler));
        self
    }
}

impl Default for Badge {
    fn default() -> Self {
        Self::new()
    }
}

impl Styled for Badge {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl ParentElement for Badge {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Badge {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let m = self.size.metrics();
        let look = look(self.variant, &t);
        let mut badge = div()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .gap(px(4.))
            .h(px(m.height))
            .min_w(px(m.height))
            .px(px(m.padding_x))
            .rounded(px(m.radius))
            .border_1()
            .border_color(look.border)
            .bg(look.bg)
            .text_color(look.fg)
            .text_size(px(m.font))
            .line_height(px(m.line))
            .font_weight(FontWeight::MEDIUM)
            .whitespace_nowrap()
            .when_some(self.icon.as_ref(), |b, name| {
                b.child(icon(name, m.icon, fade(look.fg, 0.8)))
            })
            .when_some(self.label, |b, label| b.child(label))
            .children(self.children);
        badge.style().refine(&self.style);
        match (self.id, self.on_click) {
            (Some(id), Some(on_click)) => badge
                .id(id)
                .cursor_pointer()
                .when_some(look.hover_bg, |b, bg| b.hover(move |s| s.bg(bg)))
                .on_click(move |event, window, cx| on_click(event, window, cx))
                .into_any_element(),
            _ => badge.into_any_element(),
        }
    }
}
