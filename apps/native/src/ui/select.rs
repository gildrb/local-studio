use std::rc::Rc;

use gpui::base::actions::{SelectDown, SelectUp};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Bounds, ClickEvent, ElementId, FocusHandle, FontWeight, InteractiveElement,
    IntoElement, MouseButton, ParentElement, Pixels, Refineable, RenderOnce, Rgba, SharedString,
    StatefulInteractiveElement, StyleRefinement, Styled, Window, canvas, div, px,
};

use super::button::{
    DISABLED_OPACITY, edge_highlight, field_ring, icon, is_focus_visible, keyed_focus, outset,
    resolve_corners, rounded, shadow_xs,
};
use super::input::field_bg;
use super::popover::{Align, Side, dropdown_glass, positioned};
use crate::ui::theme;
use crate::ui::theme::color::{BLACK, alpha};
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};

pub const CHEVRON_ICON: &str = "chevron-down";
pub const CHEVRON: f32 = 12.;
pub const CHEVRON_PULL: f32 = 4.;
pub const MIN_WIDTH: f32 = 144.;
pub const SIDE_OFFSET: f32 = 4.;
pub const LIST_PADDING: f32 = 4.;
pub const ITEM_MIN_HEIGHT: f32 = 28.;
pub const ITEM_PADDING_X: f32 = 8.;
pub const ITEM_PADDING_Y: f32 = 4.;
pub const ITEM_RADIUS: f32 = radius::SM;
pub const GROUP_LABEL_PADDING_X: f32 = 8.;
pub const GROUP_LABEL_PADDING_Y: f32 = 6.;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SelectVariant {
    #[default]
    Default,
    Ghost,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SelectSize {
    Compact,
    #[default]
    Default,
    Lg,
    Sm,
    Xs,
}

pub struct SelectMetrics {
    pub height: f32,
    pub fixed_height: bool,
    pub padding_x: f32,
    pub gap: f32,
    pub font: f32,
    pub line: f32,
    pub radius: f32,
}

impl SelectSize {
    pub const fn metrics(self) -> SelectMetrics {
        let (height, fixed_height, padding_x, gap, font, line, r) = match self {
            SelectSize::Compact => (28., true, 7., 4., text::SM, text::SM_LINE, radius::MD),
            SelectSize::Default => (32., false, 11., 8., text::SM, text::SM_LINE, radius::LG),
            SelectSize::Lg => (36., false, 11., 8., text::SM, text::SM_LINE, radius::LG),
            SelectSize::Sm => (28., false, 9., 6., text::SM, text::SM_LINE, radius::LG),
            SelectSize::Xs => (24., true, 7., 4., text::XS, text::XS_LINE, radius::MD),
        };
        SelectMetrics {
            height,
            fixed_height,
            padding_x,
            gap,
            font,
            line,
            radius: r,
        }
    }
}

pub(crate) struct TriggerLook {
    pub bg: Rgba,
    pub border: Rgba,
    pub fg: Rgba,
    pub chevron: Rgba,
    pub hover_bg: Option<Rgba>,
    pub hover_fg: Option<Rgba>,
    pub shadow: bool,
    pub edge: bool,
}

pub(crate) fn trigger_look(
    variant: SelectVariant,
    t: &Tokens,
    focused: bool,
    invalid: bool,
    pressed: bool,
    disabled: bool,
) -> TriggerLook {
    let clear = alpha(BLACK, 0.);
    match variant {
        SelectVariant::Default => {
            let border = match (invalid, focused) {
                (true, true) => fade(t.destructive, 0.64),
                (true, false) => fade(t.destructive, 0.36),
                (false, true) => t.ring,
                (false, false) => t.input,
            };
            let plain = !focused && !invalid && !pressed && !disabled;
            TriggerLook {
                bg: field_bg(t),
                border,
                fg: t.foreground,
                chevron: fade(t.icon_muted, 0.5),
                hover_bg: None,
                hover_fg: None,
                shadow: plain,
                edge: plain,
            }
        }
        SelectVariant::Ghost => TriggerLook {
            bg: if pressed { t.accent } else { clear },
            border: clear,
            fg: if pressed {
                t.foreground
            } else {
                t.secondary_label
            },
            chevron: fade(
                if pressed {
                    t.foreground
                } else {
                    t.secondary_label
                },
                0.5,
            ),
            hover_bg: Some(t.accent),
            hover_fg: Some(t.foreground),
            shadow: false,
            edge: false,
        },
    }
}

pub(crate) fn trigger_ring(
    variant: SelectVariant,
    t: &Tokens,
    corners: gpui::Corners<Pixels>,
    invalid: bool,
) -> gpui::Div {
    match variant {
        SelectVariant::Default => {
            let color = if invalid {
                fade(
                    t.destructive,
                    if super::button::is_dark(t) {
                        0.24
                    } else {
                        0.16
                    },
                )
            } else {
                fade(t.ring, 0.24)
            };
            field_ring(color, corners, 1.)
        }
        SelectVariant::Ghost => outset(corners, 1., 0., 2., t.ring),
    }
}

pub struct SelectItem {
    value: SharedString,
    label: SharedString,
    children: Vec<AnyElement>,
    disabled: bool,
}

impl SelectItem {
    pub fn new(value: impl Into<SharedString>, label: impl Into<SharedString>) -> Self {
        Self {
            value: value.into(),
            label: label.into(),
            children: Vec::new(),
            disabled: false,
        }
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}

impl ParentElement for SelectItem {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

enum Entry {
    Item(SelectItem),
    Label(SharedString),
}

struct SelectState {
    open: bool,
    highlighted: Option<usize>,
    bounds: Bounds<Pixels>,
    content: FocusHandle,
}

type ChangeHandler = Rc<dyn Fn(&SharedString, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Select {
    id: ElementId,
    entries: Vec<Entry>,
    value: Option<SharedString>,
    placeholder: Option<SharedString>,
    variant: SelectVariant,
    size: SelectSize,
    disabled: bool,
    invalid: bool,
    side: Side,
    align: Align,
    match_trigger_width: bool,
    accessibility_label: Option<SharedString>,
    on_change: Option<ChangeHandler>,
    leading: Option<AnyElement>,
    value_label: Option<SharedString>,
    style: StyleRefinement,
}

impl Select {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            entries: Vec::new(),
            value: None,
            placeholder: None,
            variant: SelectVariant::default(),
            size: SelectSize::default(),
            disabled: false,
            invalid: false,
            side: Side::Bottom,
            align: Align::Start,
            match_trigger_width: true,
            accessibility_label: None,
            on_change: None,
            leading: None,
            value_label: None,
            style: StyleRefinement::default(),
        }
    }

    pub fn item(mut self, item: SelectItem) -> Self {
        self.entries.push(Entry::Item(item));
        self
    }

    pub fn items(mut self, items: impl IntoIterator<Item = SelectItem>) -> Self {
        self.entries.extend(items.into_iter().map(Entry::Item));
        self
    }

    pub fn group_label(mut self, label: impl Into<SharedString>) -> Self {
        self.entries.push(Entry::Label(label.into()));
        self
    }

    pub fn value(mut self, value: Option<impl Into<SharedString>>) -> Self {
        self.value = value.map(Into::into);
        self
    }

    pub fn placeholder(mut self, placeholder: impl Into<SharedString>) -> Self {
        self.placeholder = Some(placeholder.into());
        self
    }

    pub fn variant(mut self, variant: SelectVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn size(mut self, size: SelectSize) -> Self {
        self.size = size;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn invalid(mut self, invalid: bool) -> Self {
        self.invalid = invalid;
        self
    }

    pub fn side(mut self, side: Side) -> Self {
        self.side = side;
        self
    }

    pub fn align(mut self, align: Align) -> Self {
        self.align = align;
        self
    }

    pub fn match_trigger_width(mut self, match_trigger_width: bool) -> Self {
        self.match_trigger_width = match_trigger_width;
        self
    }

    pub fn accessibility_label(mut self, label: impl Into<SharedString>) -> Self {
        self.accessibility_label = Some(label.into());
        self
    }

    pub fn leading(mut self, element: impl IntoElement) -> Self {
        self.leading = Some(element.into_any_element());
        self
    }

    pub fn value_label(mut self, label: impl Into<SharedString>) -> Self {
        self.value_label = Some(label.into());
        self
    }

    pub fn on_change(
        mut self,
        handler: impl Fn(&SharedString, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_change = Some(Rc::new(handler));
        self
    }
}

impl Styled for Select {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

fn item_values(entries: &[Entry]) -> Vec<(SharedString, bool)> {
    entries
        .iter()
        .filter_map(|entry| match entry {
            Entry::Item(item) => Some((item.value.clone(), item.disabled)),
            Entry::Label(_) => None,
        })
        .collect()
}

fn step(values: &[(SharedString, bool)], from: Option<usize>, delta: isize) -> Option<usize> {
    let count = values.len() as isize;
    if count == 0 {
        return None;
    }
    let mut index = match from {
        Some(index) => index as isize,
        None if delta > 0 => -1,
        None => count,
    };
    for _ in 0..count {
        index += delta;
        if index < 0 || index >= count {
            return from;
        }
        if !values[index as usize].1 {
            return Some(index as usize);
        }
    }
    from
}

pub(crate) fn chevron(color: Rgba) -> gpui::Svg {
    icon(CHEVRON_ICON, CHEVRON, color).mr(px(-CHEVRON_PULL))
}

pub(crate) fn group_label(t: &Tokens) -> gpui::Div {
    div()
        .px(px(GROUP_LABEL_PADDING_X))
        .py(px(GROUP_LABEL_PADDING_Y))
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.muted_foreground)
}

impl RenderOnce for Select {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let m = self.size.metrics();
        let trigger_focus = keyed_focus(&self.id, window, cx);
        let state = window.use_keyed_state((self.id.clone(), "select"), cx, |_, cx| SelectState {
            open: false,
            highlighted: None,
            bounds: Bounds::default(),
            content: cx.focus_handle(),
        });
        let (open, highlighted, bounds, content) = {
            let s = state.read(cx);
            (
                s.open && !self.disabled,
                s.highlighted,
                s.bounds,
                s.content.clone(),
            )
        };
        let focused = !self.disabled && is_focus_visible(&trigger_focus, window);
        let look = trigger_look(self.variant, &t, focused, self.invalid, open, self.disabled);
        let corners = resolve_corners(m.radius, &self.style, window);
        let values = Rc::new(item_values(&self.entries));
        let selected_index = self
            .value
            .as_ref()
            .and_then(|value| values.iter().position(|(v, _)| v == value));
        let selected_label = self.entries.iter().find_map(|entry| match entry {
            Entry::Item(item) if Some(&item.value) == self.value.as_ref() => {
                Some(item.label.clone())
            }
            _ => None,
        });
        let selected_label = self.value_label.clone().or(selected_label);
        let on_change = self.on_change.clone();

        let set_open = {
            let state = state.clone();
            let values = values.clone();
            Rc::new(move |open: bool, window: &mut Window, cx: &mut App| {
                state.update(cx, |s, cx| {
                    s.open = open;
                    if open {
                        s.highlighted = selected_index.or_else(|| step(&values, None, 1));
                    }
                    cx.notify();
                });
                if open {
                    let content = state.read(cx).content.clone();
                    content.focus(window, cx);
                }
            })
        };
        let commit = {
            let state = state.clone();
            let values = values.clone();
            let on_change = on_change.clone();
            let trigger_focus = trigger_focus.clone();
            Rc::new(move |index: usize, window: &mut Window, cx: &mut App| {
                if let Some((value, false)) = values.get(index).cloned()
                    && let Some(handler) = on_change.as_ref()
                {
                    handler(&value, window, cx);
                }
                state.update(cx, |s, cx| {
                    s.open = false;
                    cx.notify();
                });
                trigger_focus.focus(window, cx);
            })
        };

        let value_text = match (&selected_label, &self.placeholder) {
            (Some(label), _) => div().flex_1().min_w_0().truncate().child(label.clone()),
            (None, Some(placeholder)) => div()
                .flex_1()
                .min_w_0()
                .truncate()
                .text_color(t.placeholder)
                .child(placeholder.clone()),
            (None, None) => div().flex_1(),
        };

        let popup = open.then(|| {
            let mut index = 0usize;
            let rows: Vec<AnyElement> = self
                .entries
                .into_iter()
                .map(|entry| match entry {
                    Entry::Label(label) => group_label(&t).child(label).into_any_element(),
                    Entry::Item(item) => {
                        let row = index;
                        index += 1;
                        let selected = Some(row) == selected_index;
                        let lit = Some(row) == highlighted;
                        let state = state.clone();
                        let commit = commit.clone();
                        let content = if item.children.is_empty() {
                            div().child(item.label).into_any_element()
                        } else {
                            div()
                                .flex()
                                .flex_col()
                                .children(item.children)
                                .into_any_element()
                        };
                        div()
                            .id(("select-item", row))
                            .flex()
                            .items_center()
                            .min_h(px(ITEM_MIN_HEIGHT))
                            .px(px(ITEM_PADDING_X))
                            .py(px(ITEM_PADDING_Y))
                            .rounded(px(ITEM_RADIUS))
                            .text_size(px(text::SM))
                            .line_height(px(text::SM_LINE))
                            .text_color(t.foreground)
                            .when(lit, |r| r.bg(t.accent).text_color(t.accent_foreground))
                            .when(selected, |r| r.bg(fade(t.foreground, 0.08)))
                            .when(item.disabled, |r| r.opacity(DISABLED_OPACITY))
                            .when(!item.disabled, |r| {
                                r.cursor_pointer()
                                    .on_hover(move |hovered, _, cx| {
                                        if *hovered {
                                            state.update(cx, |s, cx| {
                                                if s.highlighted != Some(row) {
                                                    s.highlighted = Some(row);
                                                    cx.notify();
                                                }
                                            });
                                        }
                                    })
                                    .on_click(move |_, window, cx| commit(row, window, cx))
                            })
                            .child(div().flex_1().min_w_0().child(content))
                            .into_any_element()
                    }
                })
                .collect();
            let close = set_open.clone();
            let up_state = state.clone();
            let down_state = state.clone();
            let up_values = values.clone();
            let down_values = values.clone();
            let surface = dropdown_glass(cx)
                .id((self.id.clone(), "select-popup"))
                .occlude()
                .track_focus(&content)
                .when(self.match_trigger_width, |s| s.min_w(bounds.size.width))
                .max_h(window.viewport_size().height - bounds.bottom() - px(SIDE_OFFSET + 8.))
                .on_mouse_down_out(move |event, window, cx| {
                    if !bounds.contains(&event.position) {
                        close(false, window, cx);
                    }
                })
                .on_action(move |_: &SelectUp, _, cx| {
                    up_state.update(cx, |s, cx| {
                        s.highlighted = step(&up_values, s.highlighted, -1);
                        cx.notify();
                    });
                })
                .on_action(move |_: &SelectDown, _, cx| {
                    down_state.update(cx, |s, cx| {
                        s.highlighted = step(&down_values, s.highlighted, 1);
                        cx.notify();
                    });
                })
                .child(
                    div()
                        .id((self.id.clone(), "select-list"))
                        .flex()
                        .flex_col()
                        .w_full()
                        .p(px(LIST_PADDING))
                        .overflow_y_scroll()
                        .children(rows),
                );
            positioned(bounds, self.side, self.align, SIDE_OFFSET, 0., surface)
        });

        let toggle = set_open.clone();
        let confirm_commit = commit.clone();
        let confirm_state = state.clone();
        let open_change = set_open.clone();
        let trigger = gpui::base::Select::new(self.id.clone())
            .open(open)
            .disabled(self.disabled)
            .focus_handle(&trigger_focus)
            .content_focus_handle(&content)
            .when_some(self.accessibility_label, |s, label| {
                s.accessibility_label(label)
            })
            .when_some(selected_label.clone(), |s, label| {
                s.accessibility_value(label)
            })
            .on_open_change(move |open, window, cx| open_change(open, window, cx))
            .on_confirm(move |window, cx| {
                if let Some(index) = confirm_state.read(cx).highlighted {
                    confirm_commit(index, window, cx);
                }
            })
            .relative()
            .flex()
            .flex_1()
            .min_w_0()
            .items_center()
            .justify_between()
            .gap(px(m.gap))
            .px(px(m.padding_x))
            .map(|s| {
                if m.fixed_height {
                    s.h(px(m.height))
                } else {
                    s.min_h(px(m.height))
                }
            })
            .border_1()
            .border_color(look.border)
            .text_size(px(m.font))
            .line_height(px(m.line))
            .text_left()
            .child(
                canvas(
                    {
                        let state = state.clone();
                        move |bounds, _, cx| {
                            state.update(cx, |s, _| s.bounds = bounds);
                        }
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            )
            .when(look.edge, |s| {
                s.child(edge_highlight(&t, corners, 1., false))
            })
            .children(self.leading)
            .child(value_text)
            .child(chevron(look.chevron))
            .when(focused, |s| {
                s.child(trigger_ring(self.variant, &t, corners, self.invalid))
            });
        let hover_bg = look.hover_bg;
        let hover_fg = look.hover_fg;
        let wrapper = div()
            .id((self.id.clone(), "select-hit"))
            .relative()
            .flex()
            .flex_none()
            .bg(look.bg)
            .text_color(look.fg)
            .when(look.shadow, |s| s.shadow(vec![shadow_xs(0.05)]))
            .when(self.variant == SelectVariant::Default, |s| {
                s.w_full().min_w(px(MIN_WIDTH))
            })
            .when(!self.disabled, |s| {
                s.cursor_pointer()
                    .hover(move |st| {
                        let st = match hover_bg {
                            Some(bg) => st.bg(bg),
                            None => st,
                        };
                        match hover_fg {
                            Some(fg) => st.text_color(fg),
                            None => st,
                        }
                    })
                    .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                        toggle(!open, window, cx);
                        cx.stop_propagation();
                    })
            })
            .when(self.disabled, |s| s.opacity(DISABLED_OPACITY))
            .child(rounded(trigger, corners))
            .children(popup);
        let mut wrapper = rounded(wrapper, corners);
        wrapper.style().refine(&self.style);
        wrapper
    }
}

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct SelectButton {
    id: ElementId,
    size: SelectSize,
    label: Option<SharedString>,
    children: Vec<AnyElement>,
    pressed: bool,
    disabled: bool,
    on_click: Option<ClickHandler>,
    style: StyleRefinement,
}

impl SelectButton {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            size: SelectSize::default(),
            label: None,
            children: Vec::new(),
            pressed: false,
            disabled: false,
            on_click: None,
            style: StyleRefinement::default(),
        }
    }

    pub fn size(mut self, size: SelectSize) -> Self {
        self.size = size;
        self
    }

    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
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

    pub fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Rc::new(handler));
        self
    }
}

impl Styled for SelectButton {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl ParentElement for SelectButton {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for SelectButton {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let m = self.size.metrics();
        let handle = keyed_focus(&self.id, window, cx);
        let focused = !self.disabled && is_focus_visible(&handle, window);
        let look = trigger_look(
            SelectVariant::Default,
            &t,
            focused,
            false,
            self.pressed,
            self.disabled,
        );
        let corners = resolve_corners(m.radius, &self.style, window);
        let button = gpui::base::Button::new(self.id)
            .track_focus(&handle)
            .disabled(self.disabled)
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .justify_between()
            .gap(px(m.gap))
            .px(px(m.padding_x))
            .map(|s| {
                if m.fixed_height {
                    s.h(px(m.height))
                } else {
                    s.min_h(px(m.height))
                }
            })
            .w_full()
            .min_w(px(MIN_WIDTH))
            .border_1()
            .border_color(look.border)
            .bg(look.bg)
            .when(look.shadow, |s| s.shadow(vec![shadow_xs(0.05)]))
            .text_color(look.fg)
            .text_size(px(m.font))
            .line_height(px(m.line))
            .when(!self.disabled, |s| s.cursor_pointer())
            .when(self.disabled, |s| s.opacity(DISABLED_OPACITY))
            .when_some(self.on_click, |s, on_click| {
                s.on_click(move |event, window, cx| on_click(event, window, cx))
            })
            .when(look.edge, |s| {
                s.child(edge_highlight(&t, corners, 1., false))
            })
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .text_left()
                    .when_some(self.label, |d, label| d.child(label))
                    .children(self.children),
            )
            .child(chevron(look.chevron))
            .when(focused, |s| {
                s.child(trigger_ring(SelectVariant::Default, &t, corners, false))
            });
        let mut button = rounded(button, corners);
        button.style().refine(&self.style);
        button
    }
}
