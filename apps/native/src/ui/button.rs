use std::rc::Rc;

use gpui::Refineable;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, BoxShadow, ClickEvent, Corners, Div, ElementId, FocusHandle, FontWeight,
    InteractiveElement, IntoElement, ParentElement, Pixels, RenderOnce, Rgba, SharedString,
    StatefulInteractiveElement, StyleRefinement, Styled, Svg, Window, div, point, px, svg,
};

use crate::ui::theme;
use crate::ui::theme::color::{BLACK, WHITE, alpha};
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Appearance, Tokens, fade};

pub(crate) const GROUP: &str = "ui-control";
pub(crate) const DISABLED_OPACITY: f32 = 0.64;

pub(crate) fn icon_path(name: &str) -> SharedString {
    if name.contains('/') {
        SharedString::from(name.to_string())
    } else {
        SharedString::from(format!("icons/{name}.svg"))
    }
}

pub(crate) fn icon(name: &str, size: f32, color: Rgba) -> Svg {
    svg()
        .path(icon_path(name))
        .size(px(size))
        .flex_none()
        .text_color(color)
}

pub(crate) fn is_dark(t: &Tokens) -> bool {
    t.appearance == Appearance::Dark
}

pub(crate) fn uniform(r: f32) -> Corners<Pixels> {
    Corners::all(px(r))
}

pub(crate) fn resolve_corners(
    base: f32,
    style: &StyleRefinement,
    window: &Window,
) -> Corners<Pixels> {
    let rem = window.rem_size();
    let pick =
        |value: Option<gpui::AbsoluteLength>| value.map(|v| v.to_pixels(rem)).unwrap_or(px(base));
    Corners {
        top_left: pick(style.corner_radii.top_left),
        top_right: pick(style.corner_radii.top_right),
        bottom_right: pick(style.corner_radii.bottom_right),
        bottom_left: pick(style.corner_radii.bottom_left),
    }
}

pub(crate) fn rounded<E: Styled>(element: E, corners: Corners<Pixels>) -> E {
    element
        .rounded_tl(corners.top_left)
        .rounded_tr(corners.top_right)
        .rounded_br(corners.bottom_right)
        .rounded_bl(corners.bottom_left)
}

fn grow(corners: Corners<Pixels>, by: f32) -> Corners<Pixels> {
    let g = |c: Pixels| if c > px(0.) { c + px(by) } else { c };
    Corners {
        top_left: g(corners.top_left),
        top_right: g(corners.top_right),
        bottom_right: g(corners.bottom_right),
        bottom_left: g(corners.bottom_left),
    }
}

pub(crate) fn outset(
    corners: Corners<Pixels>,
    border: f32,
    offset: f32,
    width: f32,
    color: Rgba,
) -> Div {
    let reach = border + offset + width;
    rounded(
        div()
            .absolute()
            .top(px(-reach))
            .left(px(-reach))
            .right(px(-reach))
            .bottom(px(-reach))
            .border(px(width))
            .border_color(color),
        grow(corners, offset + width),
    )
}

pub(crate) fn focus_ring(t: &Tokens, corners: Corners<Pixels>, border: f32) -> Div {
    outset(corners, border, 1., 2., t.ring)
}

pub(crate) fn field_ring(color: Rgba, corners: Corners<Pixels>, border: f32) -> Div {
    outset(corners, border, 0., 3., color)
}

pub(crate) fn edge_highlight(
    t: &Tokens,
    corners: Corners<Pixels>,
    border: f32,
    pressed: bool,
) -> Div {
    let edge = rounded(
        div()
            .absolute()
            .top(px(-border))
            .left(px(-border))
            .right(px(-border))
            .bottom(px(-border)),
        corners,
    );
    if is_dark(t) {
        edge.border_t(px(1.))
            .border_color(alpha(WHITE, if pressed { 0.02 } else { 0.06 }))
    } else {
        edge.when(!pressed, |edge| {
            edge.border_b(px(1.)).border_color(alpha(BLACK, 0.04))
        })
    }
}

pub(crate) fn shadow(color: Rgba, y: f32, blur: f32, spread: f32) -> BoxShadow {
    BoxShadow {
        color: color.into(),
        offset: point(px(0.), px(y)),
        blur_radius: px(blur),
        spread_radius: px(spread),
        inset: false,
    }
}

pub(crate) fn inset_shadow(color: Rgba, y: f32) -> BoxShadow {
    BoxShadow {
        color: color.into(),
        offset: point(px(0.), px(y)),
        blur_radius: px(0.),
        spread_radius: px(0.),
        inset: true,
    }
}

pub(crate) fn shadow_xs(opacity: f32) -> BoxShadow {
    shadow(alpha(BLACK, opacity), 1., 2., 0.)
}

pub(crate) fn shadow_sm() -> Vec<BoxShadow> {
    vec![
        shadow(alpha(BLACK, 0.1), 1., 3., 0.),
        shadow(alpha(BLACK, 0.1), 1., 2., -1.),
    ]
}

pub(crate) fn is_focus_visible(handle: &FocusHandle, window: &Window) -> bool {
    handle.is_focused(window) && window.last_input_was_keyboard()
}

pub(crate) fn keyed_focus(id: &ElementId, window: &mut Window, cx: &mut App) -> FocusHandle {
    window
        .use_keyed_state((id.clone(), "ui-focus"), cx, |_, cx| cx.focus_handle())
        .read(cx)
        .clone()
}

pub const ICON_PULL: f32 = 2.;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ButtonVariant {
    #[default]
    Default,
    Destructive,
    DestructiveOutline,
    Ghost,
    GhostMuted,
    GhostDestructive,
    Glass,
    Link,
    MediaClose,
    MediaNavigation,
    Outline,
    Overlay,
    Secondary,
    WarningOutline,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ButtonSize {
    Compact,
    #[default]
    Default,
    Icon,
    IconLg,
    IconMicro,
    IconTiny,
    IconSm,
    IconXl,
    IconXs,
    Lg,
    Micro,
    Sm,
    SmMultiline,
    Xl,
    Xs,
}

pub struct ButtonMetrics {
    pub height: f32,
    pub padding_x: f32,
    pub padding_y: f32,
    pub gap: f32,
    pub font: f32,
    pub line: f32,
    pub radius: f32,
    pub icon: f32,
    pub square: bool,
}

impl ButtonSize {
    pub const fn metrics(self) -> ButtonMetrics {
        let (height, padding_x, gap, font, line, r, icon, square) = match self {
            ButtonSize::Compact => (28., 7., 4., text::SM, text::SM_LINE, radius::MD, 16., false),
            ButtonSize::Default => (
                32.,
                11.,
                8.,
                text::SM,
                text::SM_LINE,
                radius::CONTROL,
                16.,
                false,
            ),
            ButtonSize::Icon => (
                32.,
                0.,
                8.,
                text::SM,
                text::SM_LINE,
                radius::CONTROL,
                16.,
                true,
            ),
            ButtonSize::IconLg => (
                36.,
                0.,
                8.,
                text::SM,
                text::SM_LINE,
                radius::CONTROL,
                16.,
                true,
            ),
            ButtonSize::IconMicro => (20., 0., 8., text::SM, text::SM_LINE, radius::SM, 16., true),
            ButtonSize::IconTiny => (
                16.,
                0.,
                8.,
                text::SM,
                text::SM_LINE,
                radius::CONTROL,
                16.,
                true,
            ),
            ButtonSize::IconSm => (
                28.,
                0.,
                8.,
                text::SM,
                text::SM_LINE,
                radius::CONTROL,
                16.,
                true,
            ),
            ButtonSize::IconXl => (
                40.,
                0.,
                8.,
                text::SM,
                text::SM_LINE,
                radius::CONTROL,
                18.,
                true,
            ),
            ButtonSize::IconXs => (
                24.,
                0.,
                8.,
                text::SM,
                text::SM_LINE,
                radius::CONTROL,
                14.,
                true,
            ),
            ButtonSize::Lg => (
                36.,
                13.,
                8.,
                text::SM,
                text::SM_LINE,
                radius::CONTROL,
                16.,
                false,
            ),
            ButtonSize::Micro => (20., 5., 4., text::XXS, 16.5, radius::SM, 12., false),
            ButtonSize::Sm => (
                28.,
                9.,
                6.,
                text::SM,
                text::SM_LINE,
                radius::CONTROL,
                16.,
                false,
            ),
            ButtonSize::SmMultiline => (
                28.,
                9.,
                6.,
                text::SM,
                text::SM_LINE,
                radius::CONTROL,
                16.,
                false,
            ),
            ButtonSize::Xl => (
                40.,
                15.,
                8.,
                text::BASE,
                text::BASE_LINE,
                radius::CONTROL,
                18.,
                false,
            ),
            ButtonSize::Xs => (
                24.,
                7.,
                4.,
                text::XS,
                text::XS_LINE,
                radius::CONTROL,
                14.,
                false,
            ),
        };
        ButtonMetrics {
            height,
            padding_x,
            padding_y: if matches!(self, ButtonSize::SmMultiline) {
                3.
            } else {
                0.
            },
            gap,
            font,
            line,
            radius: r,
            icon,
            square,
        }
    }
}

struct Look {
    bg: Option<Rgba>,
    border: Rgba,
    fg: Rgba,
    icon: Rgba,
    hover_bg: Option<Rgba>,
    hover_border: Option<Rgba>,
    hover_fg: Option<Rgba>,
    active_bg: Option<Rgba>,
    shadows: Vec<BoxShadow>,
    edge: bool,
    ring: Option<Rgba>,
    full_radius: bool,
    underline_on_hover: bool,
}

fn look(variant: ButtonVariant, t: &Tokens) -> Look {
    let dark = is_dark(t);
    let transparent = alpha(BLACK, 0.);
    let control = if dark { fade(t.input, 0.32) } else { t.popover };
    let control_hover = if dark {
        fade(t.input, 0.64)
    } else {
        t.control_hover
    };
    let base = Look {
        bg: None,
        border: transparent,
        fg: t.foreground,
        icon: t.foreground,
        hover_bg: None,
        hover_border: None,
        hover_fg: None,
        active_bg: None,
        shadows: Vec::new(),
        edge: false,
        ring: None,
        full_radius: false,
        underline_on_hover: false,
    };
    match variant {
        ButtonVariant::Default => Look {
            bg: Some(t.primary),
            border: t.primary,
            fg: t.primary_foreground,
            icon: t.primary_foreground,
            hover_bg: Some(t.primary_hover),
            shadows: vec![
                inset_shadow(alpha(WHITE, 0.16), 1.),
                shadow(fade(t.primary, 0.24), 1., 2., 0.),
            ],
            ..base
        },
        ButtonVariant::Destructive => Look {
            bg: Some(t.destructive),
            border: t.destructive,
            fg: WHITE,
            icon: WHITE,
            hover_bg: Some(fade(t.destructive, 0.9)),
            shadows: vec![
                inset_shadow(alpha(WHITE, 0.16), 1.),
                shadow(fade(t.destructive, 0.24), 1., 2., 0.),
            ],
            ..base
        },
        ButtonVariant::DestructiveOutline => Look {
            bg: Some(control),
            border: t.input,
            fg: t.destructive_foreground,
            icon: t.destructive_foreground,
            hover_bg: Some(fade(t.destructive, 0.04)),
            hover_border: Some(fade(t.destructive, 0.32)),
            shadows: vec![shadow_xs(0.05)],
            edge: true,
            ..base
        },
        ButtonVariant::Ghost => Look {
            icon: t.muted_foreground,
            hover_bg: Some(t.accent),
            ..base
        },
        ButtonVariant::GhostMuted => Look {
            fg: t.muted_foreground,
            icon: t.muted_foreground,
            hover_bg: Some(t.accent),
            hover_fg: Some(t.foreground),
            ..base
        },
        ButtonVariant::GhostDestructive => Look {
            fg: t.muted_foreground,
            icon: t.muted_foreground,
            hover_bg: Some(t.accent),
            hover_fg: Some(t.destructive),
            ..base
        },
        ButtonVariant::Glass => Look {
            bg: Some(fade(t.background, 0.8)),
            border: fade(t.border, 0.6),
            icon: t.muted_foreground,
            hover_border: Some(t.border),
            shadows: shadow_sm(),
            full_radius: true,
            ..base
        },
        ButtonVariant::Link => Look {
            underline_on_hover: true,
            ..base
        },
        ButtonVariant::MediaClose => Look {
            bg: Some(alpha(BLACK, 0.65)),
            fg: WHITE,
            icon: WHITE,
            hover_bg: Some(alpha(BLACK, 0.8)),
            shadows: shadow_sm(),
            ring: Some(alpha(WHITE, 0.2)),
            ..base
        },
        ButtonVariant::MediaNavigation => Look {
            fg: alpha(WHITE, 0.9),
            icon: alpha(WHITE, 0.9),
            hover_bg: Some(alpha(WHITE, 0.1)),
            hover_fg: Some(WHITE),
            ..base
        },
        ButtonVariant::Outline => Look {
            bg: Some(control),
            border: t.input,
            icon: t.muted_foreground,
            hover_bg: Some(control_hover),
            shadows: vec![shadow_xs(0.05)],
            edge: true,
            ..base
        },
        ButtonVariant::Overlay => Look {
            bg: Some(alpha(BLACK, 0.7)),
            fg: alpha(WHITE, 0.65),
            icon: alpha(WHITE, 0.65),
            hover_bg: Some(alpha(BLACK, 0.9)),
            ..base
        },
        ButtonVariant::Secondary => Look {
            bg: Some(t.secondary),
            fg: t.secondary_foreground,
            icon: t.secondary_foreground,
            hover_bg: Some(t.secondary_hover),
            active_bg: Some(t.secondary_active),
            ..base
        },
        ButtonVariant::WarningOutline => Look {
            bg: Some(t.warning_surface),
            border: fade(t.warning, 0.32),
            fg: t.warning_foreground,
            icon: t.warning_foreground,
            hover_bg: Some(fade(t.warning, if dark { 0.24 } else { 0.16 })),
            hover_border: Some(fade(t.warning, 0.4)),
            shadows: vec![shadow_xs(0.05)],
            ..base
        },
    }
}

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Button {
    id: ElementId,
    variant: ButtonVariant,
    size: ButtonSize,
    icon: Option<SharedString>,
    icon_end: Option<SharedString>,
    icon_size: Option<f32>,
    icon_color: Option<Rgba>,
    label: Option<SharedString>,
    children: Vec<AnyElement>,
    disabled: bool,
    pressed: bool,
    focus_handle: Option<FocusHandle>,
    tab_stop: bool,
    accessibility_label: Option<SharedString>,
    on_click: Option<ClickHandler>,
    style: StyleRefinement,
}

impl Button {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            variant: ButtonVariant::default(),
            size: ButtonSize::default(),
            icon: None,
            icon_end: None,
            icon_size: None,
            icon_color: None,
            label: None,
            children: Vec::new(),
            disabled: false,
            pressed: false,
            focus_handle: None,
            tab_stop: true,
            accessibility_label: None,
            on_click: None,
            style: StyleRefinement::default(),
        }
    }

    pub fn variant(mut self, variant: ButtonVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn size(mut self, size: ButtonSize) -> Self {
        self.size = size;
        self
    }

    pub fn icon(mut self, name: impl Into<SharedString>) -> Self {
        self.icon = Some(name.into());
        self
    }

    pub fn icon_end(mut self, name: impl Into<SharedString>) -> Self {
        self.icon_end = Some(name.into());
        self
    }

    pub fn icon_size(mut self, size: f32) -> Self {
        self.icon_size = Some(size);
        self
    }

    pub fn icon_color(mut self, color: Rgba) -> Self {
        self.icon_color = Some(color);
        self
    }

    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn pressed(mut self, pressed: bool) -> Self {
        self.pressed = pressed;
        self
    }

    pub fn track_focus(mut self, handle: &FocusHandle) -> Self {
        self.focus_handle = Some(handle.clone());
        self
    }

    pub fn tab_stop(mut self, tab_stop: bool) -> Self {
        self.tab_stop = tab_stop;
        self
    }

    pub fn accessibility_label(mut self, label: impl Into<SharedString>) -> Self {
        self.accessibility_label = Some(label.into());
        self
    }

    pub fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
}

impl Styled for Button {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl ParentElement for Button {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Button {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let m = self.size.metrics();
        let look = look(self.variant, &t);
        let handle = self
            .focus_handle
            .clone()
            .unwrap_or_else(|| keyed_focus(&self.id, window, cx));
        let focused = !self.disabled && is_focus_visible(&handle, window);
        let base_radius = if look.full_radius {
            radius::FULL
        } else {
            m.radius
        };
        let corners = resolve_corners(base_radius, &self.style, window);
        let icon_size = self.icon_size.unwrap_or(m.icon);
        let icon_color = self.icon_color.unwrap_or(look.icon);
        let hover_icon = look.hover_fg.filter(|_| look.icon == look.fg);
        let pressed = self.pressed;
        let disabled = self.disabled;
        let make_icon = |name: &SharedString| {
            icon(name, icon_size, icon_color)
                .flex_none()
                .when_some(hover_icon, |svg, color| {
                    svg.group_hover(GROUP, move |s| s.text_color(color))
                })
                .when(pressed, |svg| {
                    svg.when_some(hover_icon, |svg, color| svg.text_color(color))
                })
        };
        let shadows = if disabled {
            Vec::new()
        } else {
            look.shadows.clone()
        };
        let mut button = gpui::base::Button::new(self.id.clone())
            .track_focus(&handle)
            .tab_stop(self.tab_stop)
            .disabled(disabled)
            .group(GROUP)
            .relative()
            .flex_none()
            .flex()
            .items_center()
            .justify_center()
            .gap(px(m.gap))
            .border_1()
            .border_color(look.border)
            .text_color(look.fg)
            .text_size(px(m.font))
            .line_height(px(m.line))
            .font_weight(FontWeight::MEDIUM)
            .whitespace_nowrap()
            .map(|b| {
                if matches!(self.size, ButtonSize::SmMultiline) {
                    b.min_h(px(m.height)).whitespace_normal()
                } else {
                    b.h(px(m.height))
                }
            })
            .when(m.square, |b| b.w(px(m.height)))
            .pl(px(if self.icon.is_some() && !m.square {
                m.padding_x - ICON_PULL
            } else {
                m.padding_x
            }))
            .pr(px(if self.icon_end.is_some() && !m.square {
                m.padding_x - ICON_PULL
            } else {
                m.padding_x
            }))
            .py(px(m.padding_y))
            .when_some(look.bg, |b, bg| b.bg(bg))
            .shadow(shadows)
            .when(!disabled, |b| b.cursor_pointer())
            .when(disabled, |b| b.opacity(DISABLED_OPACITY))
            .when_some(self.accessibility_label, |b, label| {
                b.accessibility_label(label)
            });
        button = rounded(button, corners);
        if !disabled {
            let hover_bg = look.hover_bg;
            let hover_border = look.hover_border;
            let hover_fg = look.hover_fg;
            let underline = look.underline_on_hover;
            let fg = look.fg;
            button = button.hover(move |s| {
                let s = match hover_bg {
                    Some(bg) => s.bg(bg),
                    None => s,
                };
                let s = match hover_border {
                    Some(c) => s.border_color(c),
                    None => s,
                };
                let s = match hover_fg {
                    Some(c) => s.text_color(c),
                    None => s,
                };
                if underline {
                    s.underline().text_decoration_color(fg)
                } else {
                    s
                }
            });
            let solid = matches!(
                self.variant,
                ButtonVariant::Default | ButtonVariant::Destructive
            );
            let outlined = look.edge || matches!(self.variant, ButtonVariant::WarningOutline);
            let active_bg = look.active_bg;
            if solid || outlined || active_bg.is_some() {
                button = button.active(move |s| {
                    let s = if solid {
                        s.shadow(vec![inset_shadow(alpha(BLACK, 0.08), 1.)])
                    } else if outlined {
                        s.shadow(Vec::new())
                    } else {
                        s
                    };
                    match active_bg {
                        Some(bg) => s.bg(bg),
                        None => s,
                    }
                });
            }
            if pressed {
                button = button
                    .when_some(look.hover_bg, |b, bg| b.bg(bg))
                    .when_some(look.hover_border, |b, c| b.border_color(c))
                    .when_some(look.hover_fg, |b, c| b.text_color(c))
                    .when(
                        matches!(
                            self.variant,
                            ButtonVariant::Default | ButtonVariant::Destructive
                        ),
                        |b| b.shadow(vec![inset_shadow(alpha(BLACK, 0.08), 1.)]),
                    )
                    .when(
                        look.edge || matches!(self.variant, ButtonVariant::WarningOutline),
                        |b| b.shadow(Vec::new()),
                    );
            }
        }
        if let Some(on_click) = self.on_click.clone() {
            button = button.on_click(move |event, window, cx| on_click(event, window, cx));
        }
        let border = 1.;
        button
            .when(look.edge && !disabled, |b| {
                b.child(edge_highlight(&t, corners, border, pressed))
            })
            .when_some(look.ring, |b, ring| {
                b.child(outset(corners, border, 0., 1., ring))
            })
            .when_some(self.icon.as_ref(), |b, name| b.child(make_icon(name)))
            .when_some(self.label, |b, label| b.child(label))
            .children(self.children)
            .when_some(self.icon_end.as_ref(), |b, name| b.child(make_icon(name)))
            .when(focused, |b| {
                let color = match self.variant {
                    ButtonVariant::MediaClose | ButtonVariant::MediaNavigation => WHITE,
                    _ => t.ring,
                };
                b.child(outset(corners, border, 1., 2., color))
            })
            .map(|mut b| {
                b.style().refine(&self.style);
                b
            })
    }
}
