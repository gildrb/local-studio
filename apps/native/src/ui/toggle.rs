use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, ClickEvent, Corners, ElementId, FontWeight, InteractiveElement, IntoElement,
    ParentElement, Pixels, Refineable, RenderOnce, SharedString, StyleRefinement, Styled, Window,
    px,
};

use super::button::{
    DISABLED_OPACITY, GROUP, edge_highlight, focus_ring, icon, is_dark, is_focus_visible,
    keyed_focus, resolve_corners, rounded, shadow_xs,
};
use crate::ui::theme;
use crate::ui::theme::color::{BLACK, alpha};
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ToggleVariant {
    #[default]
    Default,
    Pill,
    Ghost,
    Outline,
    Segmented,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ToggleSize {
    Compact,
    #[default]
    Default,
    Lg,
    Segmented,
    Sm,
    Xs,
}

pub struct ToggleMetrics {
    pub height: f32,
    pub min_width: f32,
    pub padding_x: f32,
    pub radius: f32,
    pub icon: f32,
    pub gap: f32,
    pub font: f32,
    pub line: f32,
}

impl ToggleSize {
    pub const fn metrics(self) -> ToggleMetrics {
        let (height, min_width, padding_x, r) = match self {
            ToggleSize::Compact => (28., 28., 3., radius::MD),
            ToggleSize::Default => (32., 32., 7., radius::LG),
            ToggleSize::Lg => (36., 36., 9., radius::LG),
            ToggleSize::Segmented => (24., 0., 10., radius::MD),
            ToggleSize::Sm => (28., 28., 5., radius::LG),
            ToggleSize::Xs => (24., 24., 3., radius::MD),
        };
        ToggleMetrics {
            height,
            min_width,
            padding_x,
            radius: r,
            icon: 16.,
            gap: 8.,
            font: text::SM,
            line: text::SM_LINE,
        }
    }
}

struct Look {
    bg: Option<gpui::Rgba>,
    border: gpui::Rgba,
    fg: gpui::Rgba,
    hover_bg: Option<gpui::Rgba>,
    hover_fg: Option<gpui::Rgba>,
    shadow: bool,
    edge: bool,
    weight: FontWeight,
    full: bool,
    padding_x: Option<f32>,
}

fn look(variant: ToggleVariant, pressed: bool, disabled: bool, t: &Tokens) -> Look {
    let dark = is_dark(t);
    let clear = alpha(BLACK, 0.);
    let base_pressed = fade(t.input, 0.64);
    let base = Look {
        bg: pressed.then_some(base_pressed),
        border: clear,
        fg: if pressed {
            t.accent_foreground
        } else {
            t.foreground
        },
        hover_bg: Some(t.accent),
        hover_fg: None,
        shadow: false,
        edge: false,
        weight: FontWeight::MEDIUM,
        full: false,
        padding_x: None,
    };
    match variant {
        ToggleVariant::Default => base,
        ToggleVariant::Pill => Look {
            fg: if pressed {
                t.foreground
            } else {
                t.muted_foreground
            },
            weight: FontWeight::NORMAL,
            full: true,
            padding_x: Some(12.),
            ..base
        },
        ToggleVariant::Ghost => Look {
            bg: pressed.then_some(t.accent),
            fg: if disabled {
                t.muted_foreground
            } else if pressed {
                t.accent_foreground
            } else {
                t.foreground
            },
            ..base
        },
        ToggleVariant::Outline => Look {
            bg: Some(match (dark, pressed) {
                (true, true) => t.input,
                (true, false) => fade(t.input, 0.32),
                (false, true) => base_pressed,
                (false, false) => t.background,
            }),
            border: t.input,
            hover_bg: Some(if dark { fade(t.input, 0.64) } else { t.accent }),
            shadow: !pressed && !disabled,
            edge: !disabled,
            ..base
        },
        ToggleVariant::Segmented => Look {
            bg: pressed.then_some(if dark {
                fade(t.input, 0.72)
            } else {
                t.background
            }),
            fg: if pressed {
                t.foreground
            } else {
                t.muted_foreground
            },
            hover_bg: Some(if dark {
                fade(t.input, 0.32)
            } else {
                fade(t.background, 0.55)
            }),
            hover_fg: Some(t.foreground),
            ..base
        },
    }
}

type ChangeHandler = Rc<dyn Fn(bool, &ClickEvent, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Toggle {
    id: ElementId,
    pub(crate) variant: Option<ToggleVariant>,
    pub(crate) size: Option<ToggleSize>,
    pressed: bool,
    disabled: bool,
    icon: Option<SharedString>,
    label: Option<SharedString>,
    children: Vec<AnyElement>,
    accessibility_label: Option<SharedString>,
    on_change: Option<ChangeHandler>,
    pub(crate) corners: Option<Corners<Pixels>>,
    pub(crate) drop_left_border: bool,
    pub(crate) drop_right_border: bool,
    style: StyleRefinement,
}

impl Toggle {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            variant: None,
            size: None,
            pressed: false,
            disabled: false,
            icon: None,
            label: None,
            children: Vec::new(),
            accessibility_label: None,
            on_change: None,
            corners: None,
            drop_left_border: false,
            drop_right_border: false,
            style: StyleRefinement::default(),
        }
    }

    pub fn variant(mut self, variant: ToggleVariant) -> Self {
        self.variant = Some(variant);
        self
    }

    pub fn size(mut self, size: ToggleSize) -> Self {
        self.size = Some(size);
        self
    }

    pub fn pressed(mut self, pressed: bool) -> Self {
        self.pressed = pressed;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
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

    pub fn accessibility_label(mut self, label: impl Into<SharedString>) -> Self {
        self.accessibility_label = Some(label.into());
        self
    }

    pub fn on_change(
        mut self,
        handler: impl Fn(bool, &ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_change = Some(Rc::new(handler));
        self
    }
}

impl Styled for Toggle {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl ParentElement for Toggle {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Toggle {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let variant = self.variant.unwrap_or_default();
        let size = self.size.unwrap_or_default();
        let m = size.metrics();
        let look = look(variant, self.pressed, self.disabled, &t);
        let handle = keyed_focus(&self.id, window, cx);
        let focused = !self.disabled && is_focus_visible(&handle, window);
        let base_radius = if look.full { radius::FULL } else { m.radius };
        let corners = self
            .corners
            .unwrap_or_else(|| resolve_corners(base_radius, &self.style, window));
        let icon_color = if variant == ToggleVariant::Ghost && self.disabled {
            look.fg
        } else {
            fade(look.fg, 0.8)
        };
        let hover_icon = look.hover_fg.map(|c| fade(c, 0.8));
        let segmented_pressed = variant == ToggleVariant::Segmented && self.pressed;
        let disabled = self.disabled;
        let ghost_disabled = variant == ToggleVariant::Ghost && disabled;
        let toggle = gpui::base::Toggle::new(self.id)
            .track_focus(&handle)
            .pressed(self.pressed)
            .disabled(disabled)
            .when_some(self.accessibility_label, |t, label| {
                t.accessibility_label(label)
            })
            .when_some(self.on_change, |t, on_change| {
                t.on_change(move |pressed, event, window, cx| on_change(pressed, event, window, cx))
            })
            .group(GROUP)
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .gap(px(m.gap))
            .h(px(m.height))
            .min_w(px(m.min_width))
            .px(px(look.padding_x.unwrap_or(m.padding_x)))
            .border_1()
            .when(self.drop_left_border, |t| t.border_l_0())
            .when(self.drop_right_border, |t| t.border_r_0())
            .border_color(look.border)
            .text_color(look.fg)
            .text_size(px(m.font))
            .line_height(px(m.line))
            .font_weight(look.weight)
            .whitespace_nowrap()
            .when_some(look.bg, |t, bg| t.bg(bg))
            .when(look.shadow, |t| t.shadow(vec![shadow_xs(0.05)]))
            .when(segmented_pressed, |t| t.shadow(vec![shadow_xs(0.1)]))
            .when(!disabled, |t| t.cursor_pointer())
            .when(disabled && !ghost_disabled, |t| t.opacity(DISABLED_OPACITY))
            .when(!disabled, |t| {
                let hover_bg = look.hover_bg;
                let hover_fg = look.hover_fg;
                t.hover(move |s| {
                    let s = match hover_bg {
                        Some(bg) => s.bg(bg),
                        None => s,
                    };
                    match hover_fg {
                        Some(fg) => s.text_color(fg),
                        None => s,
                    }
                })
            })
            .when(look.edge, |t_| {
                t_.child(edge_highlight(&t, corners, 1., self.pressed))
            })
            .when_some(self.icon.as_ref(), |t_, name| {
                t_.child(
                    icon(name, m.icon, icon_color)
                        .mx(px(-2.))
                        .when_some(hover_icon.filter(|_| !disabled), |svg, color| {
                            svg.group_hover(GROUP, move |s| s.text_color(color))
                        }),
                )
            })
            .when_some(self.label, |t, label| t.child(label))
            .children(self.children)
            .when(focused, |t_| t_.child(focus_ring(&t, corners, 1.)));
        let mut toggle = rounded(toggle, corners);
        toggle.style().refine(&self.style);
        toggle
    }
}
