use gpui::{
    App, ClickEvent, InteractiveElement, IntoElement, ParentElement, RenderOnce, Rgba,
    SharedString, StatefulInteractiveElement, Styled, Window, div, px, svg,
};

use crate::app_core::views::sidebar::{PullRequestGlyphKind, PullRequestTone, RowPullRequestView};
use crate::ui::theme::palette::{
    EMERALD_300, EMERALD_600, RED_300, RED_600, TEAL_300, TEAL_600, VIOLET_300, VIOLET_600,
    ZINC_400, ZINC_500, pick,
};
use crate::ui::theme::tokens::{Appearance, Tokens, fade};

const TEXT_XS: f32 = 12.;
const TEXT_XS_LINE: f32 = 16.;

pub fn terminal_color(t: &Tokens) -> Rgba {
    match t.appearance {
        Appearance::Dark => fade(gpui::rgb(TEAL_300), 0.9),
        Appearance::Light => gpui::rgb(TEAL_600),
    }
}

pub fn pull_request_tone(tone: PullRequestTone, t: &Tokens) -> Rgba {
    let dark = |color: u32, alpha: f32| fade(gpui::rgb(color), alpha);
    match (tone, t.appearance) {
        (PullRequestTone::Open, Appearance::Dark) => dark(EMERALD_300, 0.9),
        (PullRequestTone::Draft, Appearance::Dark) => dark(ZINC_400, 0.8),
        (PullRequestTone::Closed, Appearance::Dark) => dark(RED_300, 0.9),
        (PullRequestTone::Merged, Appearance::Dark) => dark(VIOLET_300, 0.9),
        (PullRequestTone::Open, Appearance::Light) => pick(t.appearance, 0, EMERALD_600),
        (PullRequestTone::Draft, Appearance::Light) => pick(t.appearance, 0, ZINC_500),
        (PullRequestTone::Closed, Appearance::Light) => pick(t.appearance, 0, RED_600),
        (PullRequestTone::Merged, Appearance::Light) => pick(t.appearance, 0, VIOLET_600),
        (PullRequestTone::Muted, _) => t.muted_foreground,
    }
}

pub fn pull_request_glyph(glyph: PullRequestGlyphKind) -> &'static str {
    match glyph {
        PullRequestGlyphKind::PullRequest => "icons/git-pull-request-arrow.svg",
        PullRequestGlyphKind::Draft => "icons/git-pull-request-draft.svg",
        PullRequestGlyphKind::Closed => "icons/git-pull-request-closed.svg",
        PullRequestGlyphKind::Merged => "icons/git-merge.svg",
        PullRequestGlyphKind::Stack => "icons/layers.svg",
    }
}

#[derive(IntoElement)]
pub struct TerminalStatusIcon {
    color: Rgba,
    size: f32,
}

impl TerminalStatusIcon {
    pub fn new(t: &Tokens, size: f32) -> Self {
        Self {
            color: terminal_color(t),
            size,
        }
    }
}

impl RenderOnce for TerminalStatusIcon {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        div()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .child(
                svg()
                    .path("icons/terminal.svg")
                    .size(px(self.size))
                    .text_color(self.color),
            )
    }
}

#[derive(IntoElement)]
pub struct WorktreeIndicator {
    color: Rgba,
}

impl WorktreeIndicator {
    pub fn new(t: &Tokens) -> Self {
        Self {
            color: fade(t.muted_foreground, 0.4),
        }
    }
}

impl RenderOnce for WorktreeIndicator {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        div()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .child(
                svg()
                    .path("icons/folder-git-2.svg")
                    .size(px(12.))
                    .text_color(self.color),
            )
    }
}

type OpenHandler = Box<dyn Fn(&ClickEvent, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct ThreadPullRequestBadge {
    id: SharedString,
    view: RowPullRequestView,
    tone: Rgba,
    on_open: Option<OpenHandler>,
}

impl ThreadPullRequestBadge {
    pub fn new(id: impl Into<SharedString>, view: &RowPullRequestView, t: &Tokens) -> Self {
        Self {
            id: id.into(),
            view: view.clone(),
            tone: pull_request_tone(view.tone, t),
            on_open: None,
        }
    }

    pub fn on_open(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_open = Some(Box::new(handler));
        self
    }
}

impl RenderOnce for ThreadPullRequestBadge {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let mut badge = div()
            .id(self.id)
            .flex()
            .flex_none()
            .items_center()
            .gap(px(4.))
            .cursor_pointer()
            .text_size(px(TEXT_XS))
            .line_height(px(TEXT_XS_LINE))
            .text_color(self.tone)
            .child(
                svg()
                    .path(pull_request_glyph(self.view.glyph))
                    .size(px(12.))
                    .text_color(self.tone),
            )
            .child(div().child(self.view.text));
        if let Some(handler) = self.on_open {
            badge = badge.on_click(move |event, window, cx| {
                cx.stop_propagation();
                handler(event, window, cx)
            });
        }
        badge
    }
}
