use std::rc::Rc;

use gpui::Refineable;
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, BoxShadow, ClickEvent, CursorStyle, DragMoveEvent, ElementId,
    Empty, Entity, FontWeight, Hsla, InteractiveElement, IntoElement, ParentElement, RenderOnce,
    SharedString, StatefulInteractiveElement, StyleRefinement, Styled, Window, div, point, px, svg,
};

use crate::ui::theme;
use crate::ui::theme::color::hsla;
use crate::ui::theme::metrics::{radius, sidebar, space, text};
use crate::ui::theme::tokens::fade;

use super::scroll_area::ScrollArea;

pub const DISABLED_OPACITY: f32 = 0.64;
pub const ICON: f32 = 16.;
pub const CONTENT_FADE: f32 = 12.;
pub const RAIL_LINE: f32 = 2.;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SidebarSide {
    #[default]
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SidebarVariant {
    #[default]
    Sidebar,
    Floating,
    Inset,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SidebarCollapsible {
    #[default]
    Offcanvas,
    Icon,
    None,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SidebarState {
    pub open: bool,
    pub width: f32,
    pub min_width: f32,
    pub max_width: f32,
}

impl Default for SidebarState {
    fn default() -> Self {
        Self {
            open: true,
            width: sidebar::WIDTH,
            min_width: sidebar::RESIZE_MIN_WIDTH,
            max_width: f32::INFINITY,
        }
    }
}

impl SidebarState {
    pub fn toggle(&mut self) {
        self.open = !self.open;
    }

    pub fn resize(&mut self, width: f32) -> f32 {
        self.width = width.clamp(self.min_width, self.max_width);
        self.width
    }

    pub fn expanded(&self) -> bool {
        self.open
    }
}

#[derive(IntoElement)]
pub struct Sidebar {
    side: SidebarSide,
    variant: SidebarVariant,
    collapsible: SidebarCollapsible,
    open: bool,
    width: f32,
    children: Vec<AnyElement>,
    style: StyleRefinement,
}

impl Sidebar {
    pub fn new(state: &SidebarState) -> Self {
        Self {
            side: SidebarSide::Left,
            variant: SidebarVariant::Sidebar,
            collapsible: SidebarCollapsible::Offcanvas,
            open: state.open,
            width: state.width,
            children: Vec::new(),
            style: StyleRefinement::default(),
        }
    }

    pub fn side(mut self, side: SidebarSide) -> Self {
        self.side = side;
        self
    }

    pub fn variant(mut self, variant: SidebarVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn collapsible(mut self, collapsible: SidebarCollapsible) -> Self {
        self.collapsible = collapsible;
        self
    }

    pub fn outer_width(&self) -> f32 {
        let padded = matches!(
            self.variant,
            SidebarVariant::Floating | SidebarVariant::Inset
        );
        match (self.open, self.collapsible) {
            (true, _) | (false, SidebarCollapsible::None) => self.width,
            (false, SidebarCollapsible::Offcanvas) => 0.,
            (false, SidebarCollapsible::Icon) if padded => sidebar::WIDTH_ICON + space::S4 + 2.,
            (false, SidebarCollapsible::Icon) => sidebar::WIDTH_ICON,
        }
    }
}

impl ParentElement for Sidebar {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl Styled for Sidebar {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for Sidebar {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::sidebar(cx);
        let width = self.outer_width();
        let padded = matches!(
            self.variant,
            SidebarVariant::Floating | SidebarVariant::Inset
        );
        let bordered = !padded && self.collapsible != SidebarCollapsible::None;
        let floating = self.variant == SidebarVariant::Floating;
        let inner = div()
            .flex()
            .flex_col()
            .size_full()
            .bg(t.sidebar)
            .text_color(t.sidebar_foreground)
            .when(floating, |this| {
                this.rounded(px(radius::LG))
                    .border_1()
                    .border_color(t.sidebar_border)
                    .shadow(vec![BoxShadow {
                        color: hsla(fade(gpui::rgba(0x000000ff), 0.05)),
                        offset: point(px(0.), px(1.)),
                        blur_radius: px(2.),
                        spread_radius: px(0.),
                        inset: false,
                    }])
            })
            .children(self.children);
        let mut container = div()
            .relative()
            .flex()
            .flex_none()
            .h_full()
            .w(px(width))
            .overflow_hidden()
            .text_color(t.sidebar_foreground)
            .when(padded, |this| this.p(px(space::S2)))
            .when(bordered && width > 0., |this| match self.side {
                SidebarSide::Left => this.border_r_1().border_color(t.sidebar_border),
                SidebarSide::Right => this.border_l_1().border_color(t.sidebar_border),
            });
        container.style().refine(&self.style);
        container.when(width > 0., |this| this.child(inner))
    }
}

#[derive(Clone)]
struct RailDrag;

impl gpui::Render for RailDragView {
    fn render(&mut self, _: &mut Window, _: &mut gpui::Context<Self>) -> impl IntoElement {
        Empty
    }
}

struct RailDragView;

type ResizeHandler = Rc<dyn Fn(f32, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct SidebarRail {
    id: ElementId,
    state: Entity<SidebarState>,
    side: SidebarSide,
    resizable: bool,
    origin: f32,
    on_resize: Option<ResizeHandler>,
}

impl SidebarRail {
    pub fn new(id: impl Into<ElementId>, state: Entity<SidebarState>) -> Self {
        Self {
            id: id.into(),
            state,
            side: SidebarSide::Left,
            resizable: false,
            origin: 0.,
            on_resize: None,
        }
    }

    pub fn side(mut self, side: SidebarSide) -> Self {
        self.side = side;
        self
    }

    pub fn resizable(mut self, resizable: bool) -> Self {
        self.resizable = resizable;
        self
    }

    pub fn origin(mut self, origin: f32) -> Self {
        self.origin = origin;
        self
    }

    pub fn on_resize(mut self, handler: impl Fn(f32, &mut Window, &mut App) + 'static) -> Self {
        self.on_resize = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for SidebarRail {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::sidebar(cx);
        let state = self.state.read(cx).clone();
        let can_resize = self.resizable && state.open;
        let cursor = match (self.side, state.open) {
            (SidebarSide::Left, true) | (SidebarSide::Right, false) => CursorStyle::ResizeLeft,
            (SidebarSide::Left, false) | (SidebarSide::Right, true) => CursorStyle::ResizeRight,
        };
        let line = t.sidebar_border;
        let group: SharedString = format!("sidebar-rail-{}", self.id).into();
        let toggle = self.state.clone();
        let resize = self.state.clone();
        let (side, origin, on_resize) = (self.side, self.origin, self.on_resize);
        div()
            .id(self.id)
            .group(group.clone())
            .absolute()
            .top_0()
            .bottom_0()
            .w(px(sidebar::RAIL_WIDTH))
            .map(|this| match (side, state.open) {
                (SidebarSide::Left, true) => this.right(px(-sidebar::RAIL_WIDTH / 2.)),
                (SidebarSide::Left, false) => this.right(px(-space::S2)),
                (SidebarSide::Right, true) => this.left(px(-sidebar::RAIL_WIDTH / 2.)),
                (SidebarSide::Right, false) => this.left(px(-space::S2)),
            })
            .cursor(cursor)
            .child(
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .left(px(sidebar::RAIL_WIDTH / 2.))
                    .w(px(RAIL_LINE))
                    .group_hover(group, move |style| style.bg(line)),
            )
            .when(!can_resize, |this| {
                this.on_click(move |_: &ClickEvent, _, cx| {
                    toggle.update(cx, |state, cx| {
                        state.toggle();
                        cx.notify();
                    })
                })
            })
            .when(can_resize, |this| {
                this.on_drag(RailDrag, |_, _, _, cx| cx.new(|_| RailDragView))
                    .on_drag_move(move |event: &DragMoveEvent<RailDrag>, window, cx| {
                        let x = f32::from(event.event.position.x);
                        let wanted = match side {
                            SidebarSide::Left => x - origin,
                            SidebarSide::Right => origin - x,
                        };
                        let width = resize.update(cx, |state, cx| {
                            let width = state.resize(wanted);
                            cx.notify();
                            width
                        });
                        if let Some(handler) = &on_resize {
                            handler(width, window, cx);
                        }
                    })
            })
    }
}

#[derive(IntoElement)]
pub struct SidebarInset {
    children: Vec<AnyElement>,
    variant: SidebarVariant,
    collapsed: bool,
    style: StyleRefinement,
}

impl SidebarInset {
    pub fn new() -> Self {
        Self {
            children: Vec::new(),
            variant: SidebarVariant::Sidebar,
            collapsed: false,
            style: StyleRefinement::default(),
        }
    }

    pub fn variant(mut self, variant: SidebarVariant, collapsed: bool) -> Self {
        self.variant = variant;
        self.collapsed = collapsed;
        self
    }
}

impl Default for SidebarInset {
    fn default() -> Self {
        Self::new()
    }
}

impl ParentElement for SidebarInset {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl Styled for SidebarInset {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for SidebarInset {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let inset = self.variant == SidebarVariant::Inset;
        let mut main = div()
            .relative()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .w_full()
            .bg(t.background)
            .when(inset, |this| {
                this.m(px(space::S2))
                    .when(!self.collapsed, |this| this.ml_0())
                    .rounded(px(radius::XL))
                    .shadow(vec![BoxShadow {
                        color: hsla(fade(gpui::rgba(0x000000ff), 0.05)),
                        offset: point(px(0.), px(1.)),
                        blur_radius: px(2.),
                        spread_radius: px(0.),
                        inset: false,
                    }])
            });
        main.style().refine(&self.style);
        main.children(self.children)
    }
}

macro_rules! stack {
    ($name:ident, $build:expr) => {
        #[derive(IntoElement, Default)]
        pub struct $name {
            children: Vec<AnyElement>,
            style: StyleRefinement,
        }

        impl $name {
            pub fn new() -> Self {
                Self::default()
            }
        }

        impl ParentElement for $name {
            fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
                self.children.extend(elements);
            }
        }

        impl Styled for $name {
            fn style(&mut self) -> &mut StyleRefinement {
                &mut self.style
            }
        }

        impl RenderOnce for $name {
            fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
                let build: fn() -> gpui::Div = $build;
                let mut root = build();
                root.style().refine(&self.style);
                root.children(self.children)
            }
        }
    };
}

stack!(SidebarHeader, || div()
    .flex()
    .flex_col()
    .gap(px(space::S2))
    .p(px(space::S2)));

stack!(SidebarFooter, || div()
    .flex()
    .flex_col()
    .gap(px(space::S2))
    .px(px(sidebar::CONTENT_INSET))
    .py(px(space::S1)));

stack!(SidebarMenu, || div()
    .flex()
    .flex_col()
    .w_full()
    .min_w_0()
    .gap(px(space::S1)));

stack!(SidebarMenuItem, || div().relative());

stack!(SidebarMenuSubItem, || div().relative());

#[derive(IntoElement)]
pub struct SidebarGroup {
    children: Vec<AnyElement>,
    flush_top: bool,
    style: StyleRefinement,
}

impl SidebarGroup {
    pub fn new() -> Self {
        Self {
            children: Vec::new(),
            flush_top: false,
            style: StyleRefinement::default(),
        }
    }

    fn flush_top(mut self, flush: bool) -> Self {
        self.flush_top = flush;
        self
    }
}

impl Default for SidebarGroup {
    fn default() -> Self {
        Self::new()
    }
}

impl ParentElement for SidebarGroup {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl Styled for SidebarGroup {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for SidebarGroup {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let mut group = div()
            .relative()
            .flex()
            .flex_col()
            .w_full()
            .min_w_0()
            .p(px(sidebar::CONTENT_INSET))
            .when(self.flush_top, |this| this.pt_0());
        group.style().refine(&self.style);
        group.children(self.children)
    }
}

enum ContentItem {
    Group(Box<SidebarGroup>),
    Element(AnyElement),
}

#[derive(IntoElement)]
pub struct SidebarContent {
    id: ElementId,
    fixed_header: Option<AnyElement>,
    items: Vec<ContentItem>,
    scroll: Option<gpui::ScrollHandle>,
    fill_height: bool,
}

impl SidebarContent {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            fixed_header: None,
            items: Vec::new(),
            scroll: None,
            fill_height: false,
        }
    }

    pub fn fixed_header(mut self, header: impl IntoElement) -> Self {
        self.fixed_header = Some(header.into_any_element());
        self
    }

    pub fn group(mut self, group: SidebarGroup) -> Self {
        self.items.push(ContentItem::Group(Box::new(group)));
        self
    }

    pub fn track_scroll(mut self, handle: &gpui::ScrollHandle) -> Self {
        self.scroll = Some(handle.clone());
        self
    }

    pub fn fill_height(mut self) -> Self {
        self.fill_height = true;
        self
    }
}

impl ParentElement for SidebarContent {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.items
            .extend(elements.into_iter().map(ContentItem::Element));
    }
}

impl RenderOnce for SidebarContent {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let surface = theme::sidebar(cx).sidebar;
        let has_header = self.fixed_header.is_some();
        let mut previous_group = has_header;
        let mut children = Vec::with_capacity(self.items.len());
        for item in self.items {
            match item {
                ContentItem::Group(group) => {
                    children.push(group.flush_top(previous_group).into_any_element());
                    previous_group = true;
                }
                ContentItem::Element(element) => {
                    children.push(element);
                    previous_group = false;
                }
            }
        }
        let list = div()
            .flex()
            .flex_col()
            .w_full()
            .min_w_0()
            .when(self.fill_height, |this| this.min_h_full())
            .children(children);
        let area = ScrollArea::new(self.id)
            .hide_scrollbars(true)
            .scroll_fade(surface)
            .fade_size(CONTENT_FADE)
            .h_auto()
            .min_h_0()
            .flex_1()
            .when_some(self.scroll, |this, handle| this.track_scroll(&handle))
            .child(list);
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .children(
                self.fixed_header
                    .map(|header| div().w_full().flex_none().child(header)),
            )
            .child(area)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SidebarMenuButtonSize {
    #[default]
    Default,
    Icon,
    Lg,
    Sm,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SidebarMenuButtonVariant {
    #[default]
    Default,
    Outline,
}

struct ButtonMetrics {
    height: f32,
    width: Option<f32>,
    radius: f32,
    padding_x: f32,
    padding_y: f32,
    text: Option<(f32, f32)>,
}

impl SidebarMenuButtonSize {
    fn metrics(self) -> ButtonMetrics {
        match self {
            SidebarMenuButtonSize::Default => ButtonMetrics {
                height: 32.,
                width: None,
                radius: radius::CONTROL,
                padding_x: sidebar::ROW_CONTENT_INSET,
                padding_y: space::S1_5,
                text: Some((text::SM, text::SM_LINE)),
            },
            SidebarMenuButtonSize::Icon => ButtonMetrics {
                height: 32.,
                width: Some(32.),
                radius: radius::CONTROL,
                padding_x: 0.,
                padding_y: 0.,
                text: None,
            },
            SidebarMenuButtonSize::Lg => ButtonMetrics {
                height: 48.,
                width: None,
                radius: radius::LG,
                padding_x: space::S2,
                padding_y: space::S2,
                text: Some((text::SM, text::SM_LINE)),
            },
            SidebarMenuButtonSize::Sm => ButtonMetrics {
                height: 28.,
                width: None,
                radius: radius::LG,
                padding_x: space::S2,
                padding_y: space::S2,
                text: Some((text::XS, text::XS_LINE)),
            },
        }
    }
}

type ClickHandler = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

fn ring(color: Hsla) -> Vec<BoxShadow> {
    vec![BoxShadow {
        color,
        offset: point(px(0.), px(0.)),
        blur_radius: px(0.),
        spread_radius: px(2.),
        inset: false,
    }]
}

#[derive(IntoElement)]
pub struct SidebarMenuButton {
    id: ElementId,
    size: SidebarMenuButtonSize,
    variant: SidebarMenuButtonVariant,
    active: bool,
    disabled: bool,
    open: bool,
    collapsed: bool,
    icon: Option<SharedString>,
    label: Option<SharedString>,
    children: Vec<AnyElement>,
    on_click: Option<ClickHandler>,
    style: StyleRefinement,
}

impl SidebarMenuButton {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            size: SidebarMenuButtonSize::Default,
            variant: SidebarMenuButtonVariant::Default,
            active: false,
            disabled: false,
            open: false,
            collapsed: false,
            icon: None,
            label: None,
            children: Vec::new(),
            on_click: None,
            style: StyleRefinement::default(),
        }
    }

    pub fn size(mut self, size: SidebarMenuButtonSize) -> Self {
        self.size = size;
        self
    }

    pub fn variant(mut self, variant: SidebarMenuButtonVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn active(mut self, active: bool) -> Self {
        self.active = active;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn open(mut self, open: bool) -> Self {
        self.open = open;
        self
    }

    pub fn collapsed(mut self, collapsed: bool) -> Self {
        self.collapsed = collapsed;
        self
    }

    pub fn icon(mut self, path: impl Into<SharedString>) -> Self {
        self.icon = Some(path.into());
        self
    }

    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
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

impl ParentElement for SidebarMenuButton {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl Styled for SidebarMenuButton {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for SidebarMenuButton {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::sidebar(cx);
        let m = self.size.metrics();
        let group: SharedString = format!("sidebar-menu-button-{}", self.id).into();
        let rest_text = match self.variant {
            SidebarMenuButtonVariant::Default => fade(t.sidebar_muted_foreground, 0.8),
            SidebarMenuButtonVariant::Outline => t.sidebar_foreground,
        };
        let foreground = t.sidebar_foreground;
        let (hover, pressed) = (t.sidebar_row_hover, t.sidebar_row_active);
        let icon_color = if self.active {
            foreground
        } else {
            t.sidebar_icon_color
        };
        let weight = match (self.variant, self.active) {
            (SidebarMenuButtonVariant::Default, _) | (_, true) => FontWeight::MEDIUM,
            _ => FontWeight::NORMAL,
        };
        let collapsed = self.collapsed;
        let icon = self.icon.map(|path| {
            svg()
                .path(path)
                .size(px(ICON))
                .flex_none()
                .text_color(icon_color)
                .group_hover(group.clone(), move |style| style.text_color(foreground))
        });
        let label = self
            .label
            .filter(|_| self.size != SidebarMenuButtonSize::Icon)
            .map(|label| div().flex_1().min_w_0().truncate().child(label));
        let ring_color = hsla(t.ring);
        let mut button = div()
            .id(self.id)
            .group(group.clone())
            .flex()
            .items_center()
            .w_full()
            .overflow_hidden()
            .gap(px(sidebar::CONTROL_GAP))
            .h(px(m.height))
            .rounded(px(m.radius))
            .px(px(m.padding_x))
            .py(px(m.padding_y))
            .when_some(m.width, |this, width| this.w(px(width)).justify_center())
            .when_some(m.text, |this, (size, line)| {
                this.text_size(px(size)).line_height(px(line))
            })
            .when(collapsed, |this| {
                this.size(px(32.)).p(px(sidebar::CONTENT_INSET))
            })
            .font_weight(weight)
            .text_color(rest_text)
            .when(self.variant == SidebarMenuButtonVariant::Outline, |this| {
                this.bg(t.sidebar_control_surface)
                    .border_1()
                    .border_color(t.sidebar_border)
            })
            .when(self.active, |this| {
                this.bg(t.sidebar_row_selected).text_color(foreground)
            })
            .when(self.open, |this| this.bg(hover).text_color(foreground))
            .when(self.disabled, |this| this.opacity(DISABLED_OPACITY))
            .when(!self.disabled, |this| {
                this.cursor_pointer()
                    .tab_index(0)
                    .hover(move |style| style.bg(hover).text_color(foreground))
                    .active(move |style| style.bg(pressed).text_color(foreground))
                    .focus_visible(move |style| style.shadow(ring(ring_color)))
                    .when_some(self.on_click, |this, handler| {
                        this.on_click(move |event, window, cx| handler(event, window, cx))
                    })
            })
            .children(icon)
            .children(label);
        button.style().refine(&self.style);
        button.children(self.children)
    }
}

#[derive(IntoElement, Default)]
pub struct SidebarMenuSub {
    children: Vec<AnyElement>,
    style: StyleRefinement,
}

impl SidebarMenuSub {
    pub fn new() -> Self {
        Self::default()
    }
}

impl ParentElement for SidebarMenuSub {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl Styled for SidebarMenuSub {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for SidebarMenuSub {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let mut sub = div()
            .mx(px(space::S3_5))
            .ml(px(space::S3_5 + 1.))
            .flex()
            .flex_col()
            .min_w_0()
            .gap(px(space::S1))
            .border_l_1()
            .border_color(theme::sidebar(cx).sidebar_border)
            .px(px(space::S2_5))
            .py(px(space::S0_5));
        sub.style().refine(&self.style);
        sub.children(self.children)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SidebarMenuSubButtonSize {
    Sm,
    #[default]
    Md,
}

#[derive(IntoElement)]
pub struct SidebarMenuSubButton {
    id: ElementId,
    size: SidebarMenuSubButtonSize,
    active: bool,
    disabled: bool,
    icon: Option<SharedString>,
    label: Option<SharedString>,
    children: Vec<AnyElement>,
    on_click: Option<ClickHandler>,
}

impl SidebarMenuSubButton {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            size: SidebarMenuSubButtonSize::Md,
            active: false,
            disabled: false,
            icon: None,
            label: None,
            children: Vec::new(),
            on_click: None,
        }
    }

    pub fn size(mut self, size: SidebarMenuSubButtonSize) -> Self {
        self.size = size;
        self
    }

    pub fn active(mut self, active: bool) -> Self {
        self.active = active;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn icon(mut self, path: impl Into<SharedString>) -> Self {
        self.icon = Some(path.into());
        self
    }

    pub fn label(mut self, label: impl Into<SharedString>) -> Self {
        self.label = Some(label.into());
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

impl ParentElement for SidebarMenuSubButton {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for SidebarMenuSubButton {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::sidebar(cx);
        let (size, line) = match self.size {
            SidebarMenuSubButtonSize::Sm => (text::XS, text::XS_LINE),
            SidebarMenuSubButtonSize::Md => (text::SM, text::SM_LINE),
        };
        let (hover, pressed, foreground) = (
            t.sidebar_row_hover,
            t.sidebar_row_active,
            t.sidebar_foreground,
        );
        let ring_color = hsla(t.ring);
        let icon = self.icon.map(|path| {
            svg()
                .path(path)
                .size(px(ICON))
                .flex_none()
                .text_color(t.sidebar_muted_foreground)
        });
        let label = self
            .label
            .map(|label| div().flex_1().min_w_0().truncate().child(label));
        div()
            .id(self.id)
            .ml(px(-1.))
            .flex()
            .items_center()
            .h(px(28.))
            .min_w_0()
            .overflow_hidden()
            .gap(px(space::S2))
            .rounded(px(radius::LG))
            .px(px(space::S2))
            .text_size(px(size))
            .line_height(px(line))
            .text_color(foreground)
            .when(self.active, |this| this.bg(t.sidebar_row_selected))
            .when(self.disabled, |this| this.opacity(DISABLED_OPACITY))
            .when(!self.disabled, |this| {
                this.cursor_pointer()
                    .tab_index(0)
                    .hover(move |style| style.bg(hover))
                    .active(move |style| style.bg(pressed))
                    .focus_visible(move |style| style.shadow(ring(ring_color)))
                    .when_some(self.on_click, |this, handler| {
                        this.on_click(move |event, window, cx| handler(event, window, cx))
                    })
            })
            .children(icon)
            .children(label)
            .children(self.children)
    }
}

pub const TRIGGER_ICON_OPEN: &str = "icons/panel-left-close.svg";
pub const TRIGGER_ICON_CLOSED: &str = "icons/panel-left.svg";

pub fn trigger_icon(open: bool) -> &'static str {
    if open {
        TRIGGER_ICON_OPEN
    } else {
        TRIGGER_ICON_CLOSED
    }
}
