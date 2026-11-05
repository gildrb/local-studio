use gpui::prelude::FluentBuilder;
use gpui::{
    App, FontWeight, IntoElement, ParentElement, RenderOnce, Rgba, SharedString, Styled, Window,
    div, img, px, rgb, svg,
};

use crate::ui::theme;
use crate::ui::theme::Appearance;
use crate::ui::theme::tokens::fade;

const TEXT_3XS: f32 = 10.;
const TEXT_5XS: f32 = 8.;
const BADGE_SIZE: f32 = 12.;
const BADGE_OFFSET: f32 = -3.;

pub fn parse_accent(color: &str) -> Option<Rgba> {
    let hex = color.trim().strip_prefix('#')?;
    let value = u32::from_str_radix(hex, 16).ok()?;
    match hex.len() {
        6 => Some(rgb(value)),
        8 => Some(gpui::rgba(value)),
        _ => None,
    }
}

struct Badge {
    initials: SharedString,
    accent: Option<Rgba>,
    surface: Rgba,
}

enum Glyph {
    Mono {
        path: &'static str,
        color: Option<Rgba>,
    },
    Image(&'static str),
}

fn glyph(driver_kind: &str, appearance: Appearance) -> Option<Glyph> {
    let dark = appearance == Appearance::Dark;
    Some(match driver_kind {
        "codex" => Glyph::Mono {
            path: "icons/providers/openai.svg",
            color: None,
        },
        "claudeAgent" => Glyph::Mono {
            path: "icons/providers/claude.svg",
            color: Some(rgb(0xd97757)),
        },
        "cursor" => Glyph::Mono {
            path: "icons/providers/cursor.svg",
            color: Some(rgb(if dark { 0xedecec } else { 0x26251e })),
        },
        "grok" => Glyph::Mono {
            path: "icons/providers/grok.svg",
            color: Some(rgb(if dark { 0xf5f5f5 } else { 0x0f0f0f })),
        },
        "opencode" => Glyph::Image(if dark {
            "icons/providers/opencode-dark.svg"
        } else {
            "icons/providers/opencode-light.svg"
        }),
        "piAgent" => Glyph::Image("icons/providers/pi.svg"),
        "omp" => Glyph::Image("icons/providers/omp.svg"),
        "antigravity" => Glyph::Image("icons/providers/antigravity.png"),
        _ => return None,
    })
}

#[derive(IntoElement)]
pub struct ProviderInstanceIcon {
    driver_kind: SharedString,
    initials: SharedString,
    size: f32,
    opacity: f32,
    color: Rgba,
    badge: Option<Badge>,
}

impl ProviderInstanceIcon {
    pub fn new(
        driver_kind: impl Into<SharedString>,
        initials: impl Into<SharedString>,
        color: Rgba,
    ) -> Self {
        Self {
            driver_kind: driver_kind.into(),
            initials: initials.into(),
            size: 20.,
            opacity: 1.,
            color,
            badge: None,
        }
    }

    pub fn icon_size(mut self, size: f32) -> Self {
        self.size = size;
        self
    }

    pub fn icon_opacity(mut self, opacity: f32) -> Self {
        self.opacity = opacity;
        self
    }

    pub fn badge(mut self, accent: Option<Rgba>, surface: Rgba) -> Self {
        self.badge = Some(Badge {
            initials: self.initials.clone(),
            accent,
            surface,
        });
        self
    }
}

impl RenderOnce for ProviderInstanceIcon {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let size = self.size;
        let opacity = self.opacity;
        let muted = t.muted_foreground;
        div()
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .map(|this| match glyph(&self.driver_kind, t.appearance) {
                Some(Glyph::Mono { path, color }) => this.child(
                    svg()
                        .path(path)
                        .size(px(size))
                        .text_color(fade(color.unwrap_or(self.color), opacity)),
                ),
                Some(Glyph::Image(path)) => this.child(img(path).size(px(size)).opacity(opacity)),
                None => this.child(
                    div()
                        .text_size(px(TEXT_3XS))
                        .line_height(px(TEXT_3XS))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(fade(self.color, opacity))
                        .child(self.initials.clone()),
                ),
            })
            .when_some(self.badge, |this, badge| {
                this.child(
                    div()
                        .absolute()
                        .right(px(BADGE_OFFSET))
                        .bottom(px(BADGE_OFFSET))
                        .flex()
                        .items_center()
                        .justify_center()
                        .h(px(BADGE_SIZE))
                        .min_w(px(BADGE_SIZE))
                        .px(px(2.))
                        .rounded_full()
                        .border_1()
                        .border_color(badge.surface)
                        .bg(badge.accent.unwrap_or(badge.surface))
                        .text_size(px(TEXT_5XS))
                        .line_height(px(TEXT_5XS))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(if badge.accent.is_some() {
                            rgb(0xffffff)
                        } else {
                            muted
                        })
                        .child(badge.initials),
                )
            })
    }
}
