use gpui::prelude::FluentBuilder;
use gpui::{
    App, Entity, IntoElement, ListState, ParentElement, RenderOnce, Styled, Window, canvas, div,
    px, relative,
};

use crate::app::workspace_page_header::WorkspacePageHeader;
use crate::app_core::client::CoreClient;
use crate::app_core::views::app_shell::AppShellThreadHeaderView;
use crate::app_core::views::header_toolbar::HeaderToolbarView;
use crate::app_core::views::open_in::OpenInPickerModel;
use crate::app_core::views::timeline::TimelineRow;
use crate::features::chat::chat_composer::ChatComposer;
use crate::features::chat::chat_header::ChatHeader;
use crate::features::chat::header_toolbar::{HeaderToolbar, PanelToggles, actions_width_probe};
use crate::features::chat::messages_timeline::MessagesTimeline;
use crate::features::right_panel::maximize::PanelMaximizeButton;
use crate::features::right_panel::panel::RightPanel;
use crate::features::terminal::TerminalSurface;
use crate::ui::theme;
use std::rc::Rc;

const MAXIMIZE_CLOSED_GAP: f32 = 4.;

#[derive(IntoElement)]
pub struct ChatView {
    header: Option<AppShellThreadHeaderView>,
    collapsed_sidebar_inset: Option<f32>,
    timeline: Option<(Rc<Vec<TimelineRow>>, Entity<CoreClient>, ListState)>,
    composer: Option<ChatComposer>,
    toolbar: Option<(HeaderToolbarView, Entity<CoreClient>)>,
    right_panel: Option<Entity<RightPanel>>,
    open_in: Option<OpenInPickerModel>,
    terminal_drawer: Option<Entity<TerminalSurface>>,
}

impl ChatView {
    pub fn new(
        header: Option<&AppShellThreadHeaderView>,
        collapsed_sidebar_inset: Option<f32>,
    ) -> Self {
        Self {
            header: header.cloned(),
            collapsed_sidebar_inset,
            timeline: None,
            composer: None,
            toolbar: None,
            right_panel: None,
            open_in: None,
            terminal_drawer: None,
        }
    }

    pub fn timeline(
        mut self,
        rows: Option<Rc<Vec<TimelineRow>>>,
        client: Entity<CoreClient>,
        list: ListState,
    ) -> Self {
        self.timeline = rows.map(|rows| (rows, client, list));
        self
    }

    pub fn toolbar(mut self, view: Option<&HeaderToolbarView>, client: Entity<CoreClient>) -> Self {
        self.toolbar = view.map(|view| (view.clone(), client));
        self
    }

    pub fn composer(mut self, composer: Option<ChatComposer>) -> Self {
        self.composer = composer;
        self
    }

    pub fn open_in(mut self, picker: Option<&OpenInPickerModel>) -> Self {
        self.open_in = picker.cloned();
        self
    }

    pub fn right_panel(mut self, panel: Option<Entity<RightPanel>>) -> Self {
        self.right_panel = panel;
        self
    }

    pub fn terminal_drawer(mut self, drawer: Option<Entity<TerminalSurface>>) -> Self {
        self.terminal_drawer = drawer;
        self
    }
}

impl RenderOnce for ChatView {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let panel_layout = self
            .right_panel
            .as_ref()
            .and_then(|panel| panel.read(cx).layout(cx));
        let panel_open = panel_layout.as_ref().is_some_and(|layout| layout.open);
        let panel_present = panel_layout.as_ref().is_some_and(|layout| layout.present);
        let maximized = panel_open && panel_layout.as_ref().is_some_and(|layout| layout.maximized);
        if let Some(panel) = self.right_panel.as_ref() {
            let inset = self.collapsed_sidebar_inset;
            panel.update(cx, |panel, _| panel.set_collapsed_sidebar_inset(inset));
        }
        let measure = self.right_panel.clone();
        let viewport_width = f32::from(window.viewport_size().width);
        let inset = self.collapsed_sidebar_inset;
        let width_probe = self
            .toolbar
            .as_ref()
            .map(|(_, client)| actions_width_probe(client.clone(), inset, window, cx));
        div()
            .relative()
            .flex()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .overflow_hidden()
            .bg(t.background)
            .when_some(measure, |this, panel| {
                this.child(
                    canvas(
                        move |bounds, _, cx| {
                            let width = f32::from(bounds.size.width);
                            panel.update(cx, |panel, cx| {
                                panel.report_layout(viewport_width, width, cx)
                            });
                        },
                        |_, _, _, _| {},
                    )
                    .absolute()
                    .size_full(),
                )
            })
            .child(
                div()
                    .flex()
                    .flex_col()
                    .min_w_0()
                    .min_h_0()
                    .overflow_hidden()
                    .map(|this| {
                        if maximized {
                            this.w(px(0.)).flex_none()
                        } else {
                            this.flex_1()
                        }
                    })
                    .child(
                        WorkspacePageHeader::new()
                            .collapsed_sidebar_inset(self.collapsed_sidebar_inset)
                            .when_some(self.header.as_ref(), |this, header| {
                                this.child(ChatHeader::new(header))
                            })
                            .when_some(self.toolbar.as_ref(), |this, (view, client)| {
                                this.child(
                                    HeaderToolbar::new(view, client.clone())
                                        .open_in(self.open_in.as_ref()),
                                )
                            })
                            .children(width_probe),
                    )
                    .child({
                        let mini_player = cx
                            .try_global::<crate::features::browser::mini_player::MiniPlayerHandle>()
                            .map(|handle| handle.0.clone());
                        let obstacle = self
                            .composer
                            .as_ref()
                            .and_then(|composer| composer.stack_obstacle(cx));
                        if let Some(player) = mini_player.as_ref() {
                            player.update(cx, |player, _| player.set_composer_obstacle(obstacle));
                        }
                        div()
                            .relative()
                            .flex_1()
                            .min_h_0()
                            .when_some(self.timeline, |this, (rows, client, list)| {
                                let inset = self
                                    .composer
                                    .as_ref()
                                    .map_or(0., |composer| composer.timeline_inset(cx));
                                this.child(
                                    MessagesTimeline::new(rows, client, list).bottom_inset(inset),
                                )
                            })
                            .children(self.composer)
                            .children(
                                crate::features::chat::thread_error_banner::thread_error_overlay(
                                    cx,
                                ),
                            )
                            .children(mini_player)
                    })
                    .children(self.terminal_drawer),
            )
            .when_some(
                self.right_panel.clone().filter(|_| panel_present),
                |this, panel| this.child(panel),
            )
            .when_some(self.toolbar, |this, (view, client)| {
                let maximize = panel_layout.filter(|layout| layout.present).map(|layout| {
                    div()
                        .flex()
                        .flex_none()
                        .opacity(layout.open_fraction)
                        .when(!layout.open, |this| {
                            this.absolute()
                                .right(relative(1.))
                                .mr(px(MAXIMIZE_CLOSED_GAP))
                        })
                        .child(PanelMaximizeButton::new(layout.maximize, client.clone()))
                });
                this.child(PanelToggles::new(&view, client).leading(maximize))
            })
            .children(crate::features::device::setup::DeviceSetupHost::global(cx))
    }
}
