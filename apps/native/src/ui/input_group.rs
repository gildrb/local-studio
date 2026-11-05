use gpui::component::input::{InputState, TextareaState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Entity, FocusHandle, Focusable, InteractiveElement, IntoElement, MouseButton,
    ParentElement, Refineable, RenderOnce, SharedString, StyleRefinement, Styled, Window, div, px,
};

use super::button::{DISABLED_OPACITY, icon, resolve_corners, rounded};
use super::input::{InputSize, bare_input, decorate, field_look};
use super::textarea::{MAX_HEIGHT, bare_textarea};
use crate::ui::theme;
use crate::ui::theme::color::{BLACK, alpha};
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::fade;

pub const ADDON_INSET: f32 = 11.;
pub const ADDON_INSET_SM: f32 = 9.;
pub const INPUT_INSET_BESIDE_ADDON: f32 = 8.;
pub const INPUT_INSET_BESIDE_ADDON_SM: f32 = 6.;
pub const ADDON_GAP: f32 = 8.;
pub const ADDON_ICON: f32 = 16.;
pub const TEXTAREA_MIN_HEIGHT: f32 = 82.;
pub const TEXTAREA_PADDING_Y: f32 = 11.;
pub const BLOCK_INPUT_INSET: f32 = 6.;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum InputGroupVariant {
    #[default]
    Default,
    Ghost,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum AddonAlign {
    #[default]
    InlineStart,
    InlineEnd,
    BlockStart,
    BlockEnd,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum AddonEdge {
    #[default]
    None,
    Button,
    Kbd,
    Badge,
}

impl AddonEdge {
    const fn pull(self) -> f32 {
        match self {
            AddonEdge::None => 0.,
            AddonEdge::Button => 8.,
            AddonEdge::Kbd => 5.6,
            AddonEdge::Badge => 6.,
        }
    }
}

pub struct InputGroupAddon {
    align: AddonAlign,
    edge: AddonEdge,
    divided: bool,
    icon: Option<SharedString>,
    children: Vec<AnyElement>,
}

impl InputGroupAddon {
    pub fn new(align: AddonAlign) -> Self {
        Self {
            align,
            edge: AddonEdge::None,
            divided: false,
            icon: None,
            children: Vec::new(),
        }
    }

    pub fn edge(mut self, edge: AddonEdge) -> Self {
        self.edge = edge;
        self
    }

    pub fn divided(mut self, divided: bool) -> Self {
        self.divided = divided;
        self
    }

    pub fn icon(mut self, name: impl Into<SharedString>) -> Self {
        self.icon = Some(name.into());
        self
    }
}

impl ParentElement for InputGroupAddon {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

enum Control {
    Input(Entity<InputState>),
    Textarea(Entity<TextareaState>),
}

#[derive(IntoElement)]
pub struct InputGroup {
    control: Control,
    variant: InputGroupVariant,
    size: InputSize,
    invalid: bool,
    disabled: bool,
    addons: Vec<InputGroupAddon>,
    style: StyleRefinement,
}

impl InputGroup {
    pub fn input(state: &Entity<InputState>) -> Self {
        Self::with_control(Control::Input(state.clone()))
    }

    pub fn textarea(state: &Entity<TextareaState>) -> Self {
        Self::with_control(Control::Textarea(state.clone()))
    }

    fn with_control(control: Control) -> Self {
        Self {
            control,
            variant: InputGroupVariant::default(),
            size: InputSize::default(),
            invalid: false,
            disabled: false,
            addons: Vec::new(),
            style: StyleRefinement::default(),
        }
    }

    pub fn variant(mut self, variant: InputGroupVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn size(mut self, size: InputSize) -> Self {
        self.size = size;
        self
    }

    pub fn invalid(mut self, invalid: bool) -> Self {
        self.invalid = invalid;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn addon(mut self, addon: InputGroupAddon) -> Self {
        self.addons.push(addon);
        self
    }
}

impl Styled for InputGroup {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

fn render_addon(
    addon: InputGroupAddon,
    sm: bool,
    focus: FocusHandle,
    icon_color: gpui::Rgba,
    border: gpui::Rgba,
) -> AnyElement {
    let inset = if sm && addon.align == AddonAlign::InlineEnd {
        ADDON_INSET_SM
    } else {
        ADDON_INSET
    };
    let pull = addon.edge.pull();
    let svg_color = if addon.edge == AddonEdge::Button {
        icon_color
    } else {
        fade(icon_color, 0.8)
    };
    div()
        .flex()
        .flex_none()
        .items_center()
        .gap(px(ADDON_GAP))
        .line_height(px(text::SM))
        .cursor_text()
        .map(|a| match addon.align {
            AddonAlign::InlineStart => a.justify_center().pl(px(inset)).ml(px(-pull)),
            AddonAlign::InlineEnd => a.justify_center().pr(px(inset)).mr(px(-pull)),
            AddonAlign::BlockStart => a
                .w_full()
                .justify_start()
                .px(px(inset))
                .pt(px(ADDON_INSET))
                .when(addon.divided, |a| {
                    a.pb(px(ADDON_INSET)).border_b_1().border_color(border)
                }),
            AddonAlign::BlockEnd => a
                .w_full()
                .justify_start()
                .px(px(inset))
                .pb(px(ADDON_INSET))
                .when(addon.divided, |a| {
                    a.pt(px(ADDON_INSET)).border_t_1().border_color(border)
                }),
        })
        .on_mouse_down(MouseButton::Left, move |_, window, cx| {
            if !focus.is_focused(window) {
                focus.focus(window, cx);
            }
        })
        .when_some(addon.icon, |a, name| {
            a.child(icon(&name, ADDON_ICON, svg_color).mx(px(-2.)))
        })
        .children(addon.children)
        .into_any_element()
}

impl RenderOnce for InputGroup {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let focus = match &self.control {
            Control::Input(state) => state.focus_handle(cx),
            Control::Textarea(state) => state.focus_handle(cx),
        };
        let focused = !self.disabled && focus.is_focused(window);
        let ghost = self.variant == InputGroupVariant::Ghost;
        let mut look = field_look(&t, focused, self.invalid, self.disabled);
        if ghost {
            look.border = if focused || self.invalid {
                look.border
            } else {
                alpha(BLACK, 0.)
            };
            look.bg = if focused {
                t.background
            } else {
                alpha(BLACK, 0.)
            };
            look.shadows.clear();
            look.edge = false;
        }
        let corners = resolve_corners(radius::CONTROL, &self.style, window);
        let sm = self.size == InputSize::Sm;
        let m = self.size.metrics();
        let has = |align: AddonAlign| self.addons.iter().any(|a| a.align == align);
        let block = has(AddonAlign::BlockStart) || has(AddonAlign::BlockEnd);
        let beside = if sm {
            INPUT_INSET_BESIDE_ADDON_SM
        } else {
            INPUT_INSET_BESIDE_ADDON
        };
        let pad_left = if has(AddonAlign::InlineStart) {
            beside
        } else {
            m.padding_x
        };
        let pad_right = if has(AddonAlign::InlineEnd) {
            beside
        } else {
            m.padding_x
        };
        let control = match &self.control {
            Control::Input(state) => {
                let height = m.height - 2.;
                let mut input =
                    bare_input(state, height, pad_left, pad_right, m.font, self.disabled).flex_1();
                if block {
                    input = input
                        .h_auto()
                        .w_full()
                        .when(has(AddonAlign::BlockEnd), |i| i.pt(px(BLOCK_INPUT_INSET)))
                        .when(has(AddonAlign::BlockStart), |i| i.pb(px(BLOCK_INPUT_INSET)));
                }
                input.into_any_element()
            }
            Control::Textarea(state) => bare_textarea(
                state,
                TEXTAREA_MIN_HEIGHT,
                MAX_HEIGHT,
                m.padding_x,
                TEXTAREA_PADDING_Y,
                self.disabled,
            )
            .into_any_element(),
        };
        let mut starts = Vec::new();
        let mut ends = Vec::new();
        for addon in self.addons {
            let target = match addon.align {
                AddonAlign::InlineStart | AddonAlign::BlockStart => &mut starts,
                AddonAlign::InlineEnd | AddonAlign::BlockEnd => &mut ends,
            };
            target.push(render_addon(
                addon,
                sm,
                focus.clone(),
                t.foreground,
                t.border,
            ));
        }
        let textarea = matches!(self.control, Control::Textarea(_));
        let hover_bg = fade(t.muted, 0.4);
        let frame = div()
            .relative()
            .flex()
            .w_full()
            .min_w_0()
            .map(|f| {
                if block {
                    f.flex_col().items_start()
                } else {
                    f.items_center()
                }
            })
            .when(!block && !textarea, |f| f.h(px(m.height)))
            .border_1()
            .border_color(look.border)
            .bg(look.bg)
            .shadow(look.shadows.clone())
            .text_color(t.foreground)
            .text_size(px(m.font))
            .when(ghost && !focused, |f| f.hover(move |s| s.bg(hover_bg)))
            .when(self.disabled, |f| f.opacity(DISABLED_OPACITY))
            .children(starts)
            .child(control)
            .children(ends);
        let mut frame = decorate(rounded(frame, corners), &t, &look, corners);
        frame.style().refine(&self.style);
        frame
    }
}
