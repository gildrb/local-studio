use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, BoxShadow, ClickEvent, Div, ElementId, FontWeight, Hsla, InteractiveElement,
    IntoElement, ParentElement, RenderOnce, Rgba, SharedString, StatefulInteractiveElement, Styled,
    Window, anchored, deferred, div, point, px,
};

use super::menu::icon;
use super::popover::{black, dark, inset_shadow, shadow, white};
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{fade, glass_blur, glass_saturation};
use crate::ui::theme::{Tokens, active};

pub const DIALOG_LAYER: usize = 50;
pub const MEDIA_LAYER: usize = 60;
/// The web's `dialog-backdrop` utility blurs by 4px (`index.css`).
const BACKDROP_BLUR: f32 = 4.;
pub const VIEWPORT_PADDING: f32 = 16.;
pub const MAX_WIDTH: f32 = 512.;
pub const SECTION_PADDING: f32 = 24.;
pub const FOOTER_PADDING_Y: f32 = 16.;
pub const CLOSE_INSET: f32 = 8.;
pub const CLOSE_SIZE: f32 = 32.;

type Handler = Rc<dyn Fn(&mut Window, &mut App) + 'static>;

fn c(color: Rgba) -> Hsla {
    color.into()
}

pub fn backdrop_color(t: &Tokens) -> Rgba {
    fade(t.background, if dark(t) { 0.64 } else { 0.6 })
}

pub fn glass_border(t: &Tokens) -> Rgba {
    if dark(t) {
        white(0.08)
    } else {
        fade(t.foreground, 0.1)
    }
}

pub fn glass_shadow(t: &Tokens) -> Vec<BoxShadow> {
    if dark(t) {
        vec![
            inset_shadow(0., 1., white(0.04)),
            shadow(0., 24., 72., -20., black(0.9)),
        ]
    } else {
        vec![shadow(0., 24., 64., -24., black(0.65))]
    }
}

pub fn dialog_glass(t: &Tokens) -> Div {
    div()
        .relative()
        .flex()
        .flex_col()
        .min_h_0()
        .w_full()
        .min_w_0()
        .rounded(px(radius::XXL))
        .backdrop_blur(px(glass_blur(t)))
        .backdrop_saturate(glass_saturation(t))
        .border_1()
        .border_color(c(glass_border(t)))
        .bg(c(fade(t.background, t.glass_opacity)))
        .shadow(glass_shadow(t))
}

pub fn overlay_layer(
    id: impl Into<ElementId>,
    priority: usize,
    backdrop: Rgba,
    on_backdrop: Option<Handler>,
    content: impl IntoElement,
    window: &Window,
) -> impl IntoElement {
    let size = window.viewport_size();
    deferred(
        anchored()
            .position(point(px(0.), px(0.)))
            .child(super::overlay_bounds::tracked(
                div()
                    .id(id.into())
                    .occlude()
                    .w(size.width)
                    .h(size.height)
                    .bg(c(backdrop))
                    .backdrop_blur(px(BACKDROP_BLUR))
                    .when_some(on_backdrop, |s, dismiss| {
                        s.on_click(move |_, window, cx| dismiss(window, cx))
                    })
                    .child(content),
            )),
    )
    .with_priority(priority)
}

pub fn close_button(
    id: impl Into<ElementId>,
    t: &Tokens,
    on_close: Option<Handler>,
) -> impl IntoElement {
    let accent = c(t.accent);
    div()
        .id(id.into())
        .absolute()
        .top(px(CLOSE_INSET))
        .right(px(CLOSE_INSET))
        .size(px(CLOSE_SIZE))
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(radius::CONTROL))
        .cursor_pointer()
        .hover(move |s| s.bg(accent))
        .child(icon("x", 16., t.muted_foreground))
        .when_some(on_close, |s, close| {
            s.on_click(move |_: &ClickEvent, window, cx| {
                cx.stop_propagation();
                close(window, cx)
            })
        })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum DialogVariant {
    #[default]
    Default,
    Media,
}

#[derive(IntoElement)]
pub struct DialogPopup {
    id: ElementId,
    variant: DialogVariant,
    show_close_button: bool,
    max_width: f32,
    on_close: Option<Handler>,
    children: Vec<AnyElement>,
}

impl DialogPopup {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            variant: DialogVariant::Default,
            show_close_button: true,
            max_width: MAX_WIDTH,
            on_close: None,
            children: Vec::new(),
        }
    }

    pub fn variant(mut self, variant: DialogVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn show_close_button(mut self, show: bool) -> Self {
        self.show_close_button = show;
        self
    }

    pub fn max_width(mut self, width: f32) -> Self {
        self.max_width = width;
        self
    }

    pub fn on_close(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_close = Some(Rc::new(handler));
        self
    }
}

impl ParentElement for DialogPopup {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for DialogPopup {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        let media = self.variant == DialogVariant::Media;
        let size = window.viewport_size();
        let popup_id = ElementId::Name(SharedString::from(format!("{}-popup", self.id)));
        let close_id = ElementId::Name(SharedString::from(format!("{}-close", self.id)));
        let popup = if media {
            div()
                .relative()
                .flex()
                .flex_col()
                .max_h(size.height * 0.92)
                .max_w(size.width * 0.92)
        } else {
            dialog_glass(&t)
                .max_w(px(self.max_width))
                .max_h_full()
                .text_color(c(t.popover_foreground))
        };
        let popup = popup
            .id(popup_id)
            .on_click(|_, _, cx| cx.stop_propagation())
            .children(self.children)
            .when(self.show_close_button, |s| {
                s.child(close_button(close_id, &t, self.on_close.clone()))
            });
        overlay_layer(
            self.id,
            if media { MEDIA_LAYER } else { DIALOG_LAYER },
            if media {
                black(0.75)
            } else {
                backdrop_color(&t)
            },
            self.on_close,
            div()
                .size_full()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .when(media, |s| s.px(px(16.)).py(px(24.)))
                .when(!media, |s| s.p(px(VIEWPORT_PADDING)))
                .child(popup),
            window,
        )
    }
}

#[derive(IntoElement)]
pub struct DialogHeader {
    with_panel: bool,
    children: Vec<AnyElement>,
}

impl DialogHeader {
    pub fn new() -> Self {
        Self {
            with_panel: false,
            children: Vec::new(),
        }
    }

    pub fn with_panel(mut self, with_panel: bool) -> Self {
        self.with_panel = with_panel;
        self
    }
}

impl Default for DialogHeader {
    fn default() -> Self {
        Self::new()
    }
}

impl ParentElement for DialogHeader {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for DialogHeader {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .p(px(SECTION_PADDING))
            .when(self.with_panel, |s| s.pb(px(12.)))
            .children(self.children)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum DialogFooterVariant {
    #[default]
    Default,
    Bare,
}

pub fn footer(t: &Tokens, variant: DialogFooterVariant) -> Div {
    div()
        .flex()
        .flex_row()
        .justify_end()
        .gap(px(8.))
        .px(px(SECTION_PADDING))
        .rounded_b(px(radius::XXL - 1.))
        .when(variant == DialogFooterVariant::Default, |s| {
            s.border_t_1()
                .border_color(c(t.border))
                .bg(c(fade(t.muted, 0.72)))
                .py(px(FOOTER_PADDING_Y))
        })
}

#[derive(IntoElement)]
pub struct DialogFooter {
    variant: DialogFooterVariant,
    children: Vec<AnyElement>,
}

impl DialogFooter {
    pub fn new() -> Self {
        Self {
            variant: DialogFooterVariant::Default,
            children: Vec::new(),
        }
    }

    pub fn variant(mut self, variant: DialogFooterVariant) -> Self {
        self.variant = variant;
        self
    }
}

impl Default for DialogFooter {
    fn default() -> Self {
        Self::new()
    }
}

impl ParentElement for DialogFooter {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for DialogFooter {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        footer(&t, self.variant)
            .when(self.variant == DialogFooterVariant::Bare, |s| {
                s.py(px(FOOTER_PADDING_Y))
            })
            .children(self.children)
    }
}

pub fn title(label: SharedString) -> Div {
    div()
        .font_weight(FontWeight::SEMIBOLD)
        .text_size(px(text::XL))
        .line_height(px(text::XL))
        .child(label)
}

pub fn description(t: &Tokens, label: SharedString) -> Div {
    div()
        .text_color(c(t.muted_foreground))
        .text_size(px(text::SM))
        .line_height(px(text::SM_LINE))
        .child(label)
}

#[derive(IntoElement)]
pub struct DialogTitle {
    label: SharedString,
}

impl DialogTitle {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
        }
    }
}

impl RenderOnce for DialogTitle {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        title(self.label)
    }
}

#[derive(IntoElement)]
pub struct DialogDescription {
    label: SharedString,
}

impl DialogDescription {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
        }
    }
}

impl RenderOnce for DialogDescription {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        description(&active(cx), self.label)
    }
}

#[derive(IntoElement)]
pub struct DialogPanel {
    id: ElementId,
    after_header: bool,
    before_bare_footer: bool,
    children: Vec<AnyElement>,
}

impl DialogPanel {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            after_header: false,
            before_bare_footer: false,
            children: Vec::new(),
        }
    }

    pub fn after_header(mut self, after_header: bool) -> Self {
        self.after_header = after_header;
        self
    }

    pub fn before_bare_footer(mut self, before_bare_footer: bool) -> Self {
        self.before_bare_footer = before_bare_footer;
        self
    }
}

impl ParentElement for DialogPanel {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for DialogPanel {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        div()
            .id(self.id)
            .min_h_0()
            .flex_shrink(1.)
            .overflow_y_scroll()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(16.))
                    .p(px(SECTION_PADDING))
                    .when(self.after_header, |s| s.pt(px(4.)))
                    .when(self.before_bare_footer, |s| s.pb(px(4.)))
                    .children(self.children),
            )
    }
}
