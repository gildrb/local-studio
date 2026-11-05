use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, ClickEvent, Div, ElementId, FontWeight, Hsla, InteractiveElement, IntoElement,
    ParentElement, RenderOnce, Rgba, SharedString, StatefulInteractiveElement, Styled, Window, div,
    px,
};

use super::dialog::{DIALOG_LAYER, backdrop_color, dialog_glass, overlay_layer};
use super::menu::{SHORTCUT_TRACKING, icon, tracked_text};
use super::popover::{DismissHandler, HoverHandler};
use crate::ui::theme::metrics::{radius, text, workspace};
use crate::ui::theme::tokens::fade;
use crate::ui::theme::{Tokens, active};

pub const POPUP_MAX_WIDTH: f32 = 576.;
pub const POPUP_MAX_HEIGHT: f32 = 420.;
pub const VIEWPORT_PADDING_X: f32 = 16.;
pub const VIEWPORT_TOP_RATIO: f32 = 0.1;
pub const INPUT_ROW_PADDING_Y: f32 = 6.;
pub const INPUT_HEIGHT: f32 = 36.;
pub const INPUT_TEXT_INSET: f32 = 32.;
pub const SEARCH_ICON_INSET: f32 = 9.;
pub const LIST_PADDING: f32 = 8.;
pub const ITEM_PADDING_X: f32 = 8.;
pub const ITEM_PADDING_Y: f32 = 6.;
pub const ITEM_GAP: f32 = 8.;
pub const ITEM_MIN_HEIGHT: f32 = 28.;
pub const ICON_SIZE: f32 = 16.;
pub const FOOTER_PADDING_Y: f32 = 10.;
pub const KBD_SIZE: f32 = 20.;

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

fn c(color: Rgba) -> Hsla {
    color.into()
}

#[derive(IntoElement)]
pub struct CommandDialogPopup {
    id: ElementId,
    on_dismiss: Option<DismissHandler>,
    children: Vec<AnyElement>,
}

impl CommandDialogPopup {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            on_dismiss: None,
            children: Vec::new(),
        }
    }

    pub fn on_dismiss(mut self, handler: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_dismiss = Some(Rc::new(handler));
        self
    }
}

impl ParentElement for CommandDialogPopup {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for CommandDialogPopup {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        let height = window.viewport_size().height;
        let pad_y = height * VIEWPORT_TOP_RATIO;
        let popup_id = ElementId::Name(SharedString::from(format!("{}-popup", self.id)));
        overlay_layer(
            self.id,
            DIALOG_LAYER,
            backdrop_color(&t),
            self.on_dismiss,
            div()
                .size_full()
                .flex()
                .flex_col()
                .items_center()
                .px(px(VIEWPORT_PADDING_X))
                .py(pad_y)
                .child(
                    dialog_glass(&t)
                        .id(popup_id)
                        .max_w(px(POPUP_MAX_WIDTH))
                        .max_h(px(POPUP_MAX_HEIGHT))
                        .text_color(c(t.foreground))
                        .on_click(|_, _, cx| cx.stop_propagation())
                        .children(self.children),
                ),
            window,
        )
    }
}

#[derive(IntoElement)]
pub struct CommandInput {
    input: AnyElement,
}

impl CommandInput {
    pub fn new(input: impl IntoElement) -> Self {
        Self {
            input: input.into_any_element(),
        }
    }
}

impl RenderOnce for CommandInput {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        div()
            .flex_none()
            .px(px(workspace::COMMAND_SHELL_INSET))
            .py(px(INPUT_ROW_PADDING_Y))
            .child(
                div()
                    .relative()
                    .flex()
                    .items_center()
                    .w_full()
                    .h(px(INPUT_HEIGHT))
                    .rounded(px(radius::LG))
                    .border_1()
                    .border_color(gpui::transparent_black())
                    .text_size(px(text::SM))
                    .text_color(c(t.foreground))
                    .child(
                        div()
                            .absolute()
                            .left(px(SEARCH_ICON_INSET - 1.))
                            .top(px((INPUT_HEIGHT - 2. - ICON_SIZE) / 2.))
                            .opacity(0.8)
                            .child(icon("search", ICON_SIZE, t.icon_muted)),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .h_full()
                            .pl(px(INPUT_TEXT_INSET - 1.))
                            .pr(px(10.))
                            .flex()
                            .items_center()
                            .child(self.input),
                    ),
            )
    }
}

pub fn command_panel() -> Div {
    div()
        .relative()
        .flex()
        .flex_col()
        .min_h_0()
        .flex_1()
        .overflow_hidden()
        .rounded_t(px(radius::XL))
}

#[derive(IntoElement)]
pub struct CommandList {
    id: ElementId,
    children: Vec<AnyElement>,
}

impl CommandList {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            children: Vec::new(),
        }
    }
}

impl ParentElement for CommandList {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for CommandList {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let empty = self.children.is_empty();
        command_panel().child(
            div()
                .id(self.id)
                .flex()
                .flex_col()
                .min_h_0()
                .overflow_y_scroll()
                .when(!empty, |s| s.p(px(LIST_PADDING)))
                .children(self.children),
        )
    }
}

#[derive(IntoElement)]
pub struct CommandGroupLabel {
    label: SharedString,
}

impl CommandGroupLabel {
    pub fn new(label: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
        }
    }
}

impl RenderOnce for CommandGroupLabel {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        div()
            .flex_none()
            .px(px(8.))
            .py(px(6.))
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .font_weight(FontWeight::MEDIUM)
            .text_color(c(t.muted_foreground))
            .child(self.label)
    }
}

#[derive(IntoElement)]
pub struct CommandItem {
    id: ElementId,
    icon: Option<SharedString>,
    label: Option<SharedString>,
    description: Option<SharedString>,
    shortcut: Option<SharedString>,
    active: Option<bool>,
    selected: bool,
    disabled: bool,
    on_click: Option<ClickHandler>,
    on_hover: Option<HoverHandler>,
    children: Vec<AnyElement>,
}

impl CommandItem {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            icon: None,
            label: None,
            description: None,
            shortcut: None,
            active: None,
            selected: false,
            disabled: false,
            on_click: None,
            on_hover: None,
            children: Vec::new(),
        }
    }

    pub fn icon(mut self, name: impl Into<SharedString>) -> Self {
        self.icon = Some(name.into());
        self
    }

    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
        self
    }

    pub fn description(mut self, description: impl Into<SharedString>) -> Self {
        self.description = Some(description.into());
        self
    }

    pub fn shortcut(mut self, shortcut: impl Into<SharedString>) -> Self {
        self.shortcut = Some(shortcut.into());
        self
    }

    pub fn active(mut self, active: bool) -> Self {
        self.active = Some(active);
        self
    }

    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }

    pub fn on_hover(mut self, handler: impl Fn(&bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_hover = Some(Rc::new(handler));
        self
    }
}

impl ParentElement for CommandItem {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for CommandItem {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        let disabled = self.disabled;
        let highlight = c(fade(t.foreground, 0.09));
        let fg = c(t.foreground);
        let label = self.label.map(|label| {
            let line = div()
                .flex()
                .min_w_0()
                .items_center()
                .gap(px(6.))
                .text_size(px(text::SM))
                .text_color(c(t.foreground))
                .child(div().truncate().child(label));
            match self.description {
                Some(description) => div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .child(line)
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .text_size(px(text::XS))
                            .line_height(px(text::XS_LINE))
                            .text_color(c(fade(t.muted_foreground, 0.7)))
                            .child(description),
                    ),
                None => line.flex_1(),
            }
        });
        div()
            .id(self.id)
            .flex()
            .items_center()
            .gap(px(ITEM_GAP))
            .min_h(px(ITEM_MIN_HEIGHT))
            .px(px(ITEM_PADDING_X))
            .py(px(ITEM_PADDING_Y))
            .rounded(px(radius::SM))
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .when(disabled, |s| s.opacity(0.64))
            .map(|s| match self.active {
                Some(true) => s
                    .cursor_pointer()
                    .bg(c(t.accent))
                    .text_color(c(t.accent_foreground)),
                Some(false) => s.cursor_pointer(),
                None => s
                    .when(self.selected, |s| s.bg(c(fade(t.foreground, 0.06))))
                    .when(!disabled, |s| {
                        s.cursor_pointer()
                            .hover(move |s| s.bg(highlight).text_color(fg))
                    }),
            })
            .when_some(self.icon, |s, name| {
                s.child(icon(&name, ICON_SIZE, t.muted_foreground))
            })
            .when_some(label, |s, label| s.child(label))
            .children(self.children)
            .when_some(self.shortcut, |s, keys| s.child(shortcut(&t, &keys)))
            .when_some(self.on_hover.filter(|_| !disabled), |s, handler| {
                s.on_hover(move |hovered, window, cx| handler(hovered, window, cx))
            })
            .when_some(self.on_click.filter(|_| !disabled), |s, handler| {
                s.on_click(move |event, window, cx| handler(event, window, cx))
            })
    }
}

pub fn shortcut(t: &Tokens, keys: &str) -> Div {
    tracked_text(keys, SHORTCUT_TRACKING)
        .ml_auto()
        .flex_none()
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .font_weight(FontWeight::MEDIUM)
        .text_color(c(t.secondary_label))
}

#[derive(IntoElement)]
pub struct CommandShortcut {
    keys: SharedString,
}

impl CommandShortcut {
    pub fn new(keys: impl Into<SharedString>) -> Self {
        Self { keys: keys.into() }
    }
}

impl RenderOnce for CommandShortcut {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        shortcut(&active(cx), &self.keys)
    }
}

#[derive(Clone)]
pub enum FooterKey {
    Text(SharedString),
    Icon(SharedString),
}

fn footer_kbd(t: &Tokens, key: FooterKey) -> Div {
    let chip = div()
        .flex()
        .items_center()
        .justify_center()
        .gap(px(4.))
        .h(px(KBD_SIZE))
        .min_w(px(KBD_SIZE))
        .px(px(4.))
        .rounded(px(radius::XS * 2.))
        .bg(c(fade(t.foreground, 0.08)))
        .text_color(c(t.foreground))
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .font_weight(FontWeight::MEDIUM);
    match key {
        FooterKey::Text(label) => chip.child(label),
        FooterKey::Icon(name) => chip.child(icon(&name, 12., t.foreground)),
    }
}

#[derive(IntoElement)]
pub struct CommandFooterHint {
    keys: Vec<FooterKey>,
    label: SharedString,
}

impl CommandFooterHint {
    pub fn new(keys: Vec<FooterKey>, label: impl Into<SharedString>) -> Self {
        Self {
            keys,
            label: label.into(),
        }
    }
}

impl RenderOnce for CommandFooterHint {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        div()
            .flex()
            .items_center()
            .gap(px(4.))
            .children(self.keys.into_iter().map(|key| footer_kbd(&t, key)))
            .child(self.label)
    }
}

#[derive(IntoElement, Default)]
pub struct CommandFooter {
    children: Vec<AnyElement>,
}

impl CommandFooter {
    pub fn new() -> Self {
        Self::default()
    }
}

impl ParentElement for CommandFooter {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for CommandFooter {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        div()
            .relative()
            .flex_none()
            .flex()
            .items_center()
            .justify_between()
            .gap(px(8.))
            .rounded_b(px(radius::XXL - 1.))
            .bg(c(fade(t.foreground, 0.025)))
            .px(px(workspace::COMMAND_CONTENT_INSET))
            .py(px(FOOTER_PADDING_Y))
            .font_weight(FontWeight::MEDIUM)
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .text_color(c(t.muted_foreground))
            .children(self.children)
    }
}

pub fn footer_hints() -> Div {
    div().flex().items_center().gap(px(12.))
}

#[derive(IntoElement)]
pub struct CommandFooterAction {
    id: ElementId,
    label: SharedString,
    on_click: Option<ClickHandler>,
}

impl CommandFooterAction {
    pub fn new(id: impl Into<ElementId>, label: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            on_click: None,
        }
    }

    pub fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for CommandFooterAction {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = active(cx);
        let fg = c(t.foreground);
        div()
            .id(self.id)
            .flex()
            .items_center()
            .gap(px(4.))
            .px(px(8.))
            .rounded(px(radius::CONTROL))
            .border_1()
            .border_color(gpui::transparent_black())
            .cursor_pointer()
            .font_weight(FontWeight::MEDIUM)
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .text_color(c(t.muted_foreground))
            .hover(move |s| s.text_color(fg))
            .child(self.label)
            .when_some(self.on_click, |s, handler| {
                s.on_click(move |event, window, cx| handler(event, window, cx))
            })
    }
}
