use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, ClickEvent, InteractiveElement, IntoElement, ParentElement, RenderOnce,
    StatefulInteractiveElement, Styled, Window, div, px, rgb, svg,
};

use crate::platform::MAC;
use crate::ui::sidebar::{Sidebar, SidebarState};
use crate::ui::theme;
use crate::ui::theme::metrics::workspace;
use crate::ui::theme::tokens::fade;

const MACOS_TRAFFIC_LIGHTS_LEFT_INSET: f32 = 90.;
const CONTROLS_LEFT: f32 = 12.;
const CONTROL_EDGE: f32 = 1.;
const ICON: f32 = 16.;
const MEDIA_TEXT: f32 = 0.9;
const MEDIA_HOVER: f32 = 0.1;

pub fn controls_left(window: &Window) -> f32 {
    if MAC && !window.is_fullscreen() {
        MACOS_TRAFFIC_LIGHTS_LEFT_INSET
    } else {
        CONTROLS_LEFT
    }
}

type ToggleHandler = Box<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

#[derive(IntoElement)]
struct SidebarControl {
    open: bool,
    on_imagery: bool,
    left: f32,
    on_toggle: ToggleHandler,
}

impl RenderOnce for SidebarControl {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let (text, icon, hover_bg, hover_text) = if self.on_imagery {
            let white = rgb(0xffffff);
            (
                fade(white, MEDIA_TEXT),
                fade(white, MEDIA_TEXT),
                fade(white, MEDIA_HOVER),
                white,
            )
        } else {
            (t.foreground, t.muted_foreground, t.accent, t.foreground)
        };
        let handler = self.on_toggle;
        div()
            .absolute()
            .top_0()
            .left(px(self.left + CONTROL_EDGE))
            .h(px(workspace::TOPBAR_HEIGHT))
            .flex()
            .items_center()
            .child(
                div()
                    .id("sidebar-toggle")
                    .group("sidebar-toggle")
                    .flex()
                    .items_center()
                    .justify_center()
                    .size(px(workspace::TITLEBAR_CONTROL_SIZE))
                    .rounded(px(8.))
                    .border_1()
                    .border_color(gpui::transparent_black())
                    .cursor_pointer()
                    .text_color(text)
                    .hover(move |style| style.bg(hover_bg).text_color(hover_text))
                    .on_click(move |event, window, cx| handler(event, window, cx))
                    .child(
                        svg()
                            .path(if self.open {
                                "icons/panel-left-close.svg"
                            } else {
                                "icons/panel-left.svg"
                            })
                            .size(px(ICON))
                            .text_color(icon)
                            .group_hover("sidebar-toggle", move |style| {
                                style.text_color(hover_text)
                            }),
                    ),
            )
    }
}

#[derive(IntoElement)]
pub struct AppSidebarLayout {
    state: SidebarState,
    sidebar: Option<AnyElement>,
    main: Option<AnyElement>,
    stage_backdrop: bool,
    controls_left: f32,
    on_toggle: Option<ToggleHandler>,
}

impl AppSidebarLayout {
    pub fn new(state: SidebarState, controls_left: f32) -> Self {
        Self {
            state,
            sidebar: None,
            main: None,
            stage_backdrop: false,
            controls_left,
            on_toggle: None,
        }
    }

    pub fn sidebar(mut self, sidebar: impl IntoElement) -> Self {
        self.sidebar = Some(sidebar.into_any_element());
        self
    }

    pub fn main(mut self, main: impl IntoElement) -> Self {
        self.main = Some(main.into_any_element());
        self
    }

    pub fn stage_backdrop(mut self, present: bool) -> Self {
        self.stage_backdrop = present;
        self
    }

    pub fn on_toggle(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_toggle = Some(Box::new(handler));
        self
    }
}

impl RenderOnce for AppSidebarLayout {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let open = self.state.open;
        div()
            .relative()
            .flex()
            .flex_row()
            .size_full()
            .bg(t.background)
            .text_color(t.foreground)
            .child(Sidebar::new(&self.state).children(self.sidebar))
            .child(
                div()
                    .relative()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .bg(t.background)
                    .children(self.main),
            )
            .when_some(self.on_toggle, |this, handler| {
                this.child(SidebarControl {
                    open,
                    on_imagery: open && self.stage_backdrop,
                    left: self.controls_left,
                    on_toggle: handler,
                })
            })
    }
}
