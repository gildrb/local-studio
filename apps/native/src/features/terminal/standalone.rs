use gpui::{
    App, AppContext, Context, Entity, IntoElement, ParentElement, Render, Styled, Window, div,
};
use serde_json::json;

use super::session;
use super::viewport::TerminalViewport;
use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::terminal::{TerminalFontView, TerminalLinkHoverView};
use crate::platform::DEFAULT_MONO_FONT;
use crate::ui::theme;

const DEFAULT_FONT_SIZE: f32 = 12.;

pub struct StandaloneTerminal {
    session_key: String,
    viewport: Entity<TerminalViewport>,
    _font: Entity<ViewState<Option<TerminalFontView>>>,
    _link_hover: Entity<ViewState<Option<TerminalLinkHoverView>>>,
}

impl StandaloneTerminal {
    pub fn new(client: Entity<CoreClient>, session_key: String, cx: &mut App) -> Entity<Self> {
        cx.new(|cx| {
            let session = session::session(&client, &session_key, cx);
            let viewport = cx.new(|cx| {
                let mut viewport =
                    TerminalViewport::new(session, DEFAULT_MONO_FONT.into(), DEFAULT_FONT_SIZE, cx);
                viewport.request_focus(cx);
                viewport
            });
            let font = CoreClient::subscribe::<Option<TerminalFontView>>(
                &client,
                "terminalFont",
                json!({}),
                cx,
            );
            cx.observe(&font, |terminal: &mut Self, font, cx| {
                let Some(font) = font.read(cx).data.clone().flatten() else {
                    return;
                };
                let family = font.font_family.unwrap_or_else(|| DEFAULT_MONO_FONT.into());
                terminal.viewport.update(cx, |viewport, cx| {
                    viewport.set_font(family.into(), font.font_size, cx)
                });
            })
            .detach();
            let link_hover = CoreClient::subscribe::<Option<TerminalLinkHoverView>>(
                &client,
                "terminalLinkHover",
                json!({}),
                cx,
            );
            cx.observe(&link_hover, |terminal: &mut Self, view, cx| {
                let Some(hover) = view.read(cx).data.clone().flatten() else {
                    return;
                };
                if hover.key != terminal.session_key {
                    return;
                }
                terminal.viewport.update(cx, |viewport, cx| {
                    viewport.apply_link_hover(hover.probe, hover.link, cx)
                });
            })
            .detach();
            Self {
                session_key,
                viewport,
                _font: font,
                _link_hover: link_hover,
            }
        })
    }
}

impl Render for StandaloneTerminal {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .bg(theme::active(cx).terminal_background)
            .child(self.viewport.clone())
    }
}
