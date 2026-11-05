use std::collections::HashMap;
use std::time::Duration;

use gpui::prelude::FluentBuilder;
use gpui::{
    Animation, AnimationExt, AnyElement, ElementId, FontWeight, IntoElement, ObjectFit,
    ParentElement, Rgba, SharedString, Styled, StyledImage, Transformation, div, img, percentage,
    px, rgb, svg,
};

use crate::app_core::views::pull_requests::{
    PullRequestActorModel, PullRequestFilterIcon, PullRequestGlyphId,
};
use crate::app_core::views::sidebar::ProjectIconView;
use crate::features::sidebar::machine_icon;
use crate::ui::badge::{Badge, BadgeSize, BadgeVariant};
use crate::ui::project_favicon::ProjectFavicon;
use crate::ui::spinner;
use crate::ui::theme::tokens::{Appearance, Tokens, fade};

pub const TEXT_2XS: f32 = 11.;
pub const TEXT_3XS: f32 = 10.;
const SPIN: Duration = Duration::from_secs(1);

fn tailwind(name: &str, shade: &str) -> Option<u32> {
    Some(match (name, shade) {
        ("emerald", "300") => 0x5ee9b5,
        ("emerald", "400") => 0x00d492,
        ("emerald", "600") => 0x009966,
        ("zinc", "400") => 0x9f9fa9,
        ("zinc", "500") => 0x71717b,
        ("red", "300") => 0xffa2a2,
        ("red", "600") => 0xe7000b,
        ("violet", "300") => 0xc4b4ff,
        ("violet", "600") => 0x7f22fe,
        ("amber", "400") => 0xffb900,
        ("amber", "500") => 0xfe9a00,
        ("amber", "600") => 0xe17100,
        _ => return None,
    })
}

fn text_class(class: &str, t: &Tokens) -> Option<Rgba> {
    let class = class.strip_prefix("text-")?;
    let (name, opacity) = match class.split_once('/') {
        Some((name, opacity)) => (name, opacity.parse::<f32>().ok()? / 100.),
        None => (class, 1.),
    };
    let base = match name {
        "destructive" => t.destructive,
        "muted-foreground" => t.muted_foreground,
        "foreground" => t.foreground,
        "primary" => t.primary,
        _ => {
            let (color, shade) = name.rsplit_once('-')?;
            rgb(tailwind(color, shade)?)
        }
    };
    Some(fade(base, opacity))
}

pub fn tone(class_name: &str, t: &Tokens) -> Rgba {
    let dark = t.appearance == Appearance::Dark;
    let mut light_tone = None;
    let mut dark_tone = None;
    for class in class_name.split_whitespace() {
        match class.strip_prefix("dark:") {
            Some(rest) => dark_tone = text_class(rest, t).or(dark_tone),
            None => light_tone = text_class(class, t).or(light_tone),
        }
    }
    let chosen = if dark {
        dark_tone.or(light_tone)
    } else {
        light_tone
    };
    chosen.unwrap_or(t.foreground)
}

pub fn glyph_path(id: PullRequestGlyphId) -> &'static str {
    match id {
        PullRequestGlyphId::PullRequest | PullRequestGlyphId::Reopen => {
            "icons/git-pull-request-arrow.svg"
        }
        PullRequestGlyphId::Draft => "icons/git-pull-request-draft.svg",
        PullRequestGlyphId::Closed => "icons/git-pull-request-closed.svg",
        PullRequestGlyphId::Merged => "icons/git-merge.svg",
        PullRequestGlyphId::Conflicting => "icons/triangle-alert.svg",
        PullRequestGlyphId::Stack => "icons/layers.svg",
        PullRequestGlyphId::Link => "icons/link-2.svg",
        PullRequestGlyphId::Unlink => "icons/unlink-2.svg",
    }
}

pub fn lucide_path(id: &str) -> SharedString {
    let name = match id {
        "maximize" => "maximize-2",
        "minimize" => "minimize-2",
        "plug" => "plug-2",
        "folder-git" => "folder-git-2",
        other => other,
    };
    SharedString::from(format!("icons/{name}.svg"))
}

pub fn path_icon(path: impl Into<SharedString>, size: f32, color: Rgba) -> gpui::Svg {
    svg()
        .path(path.into())
        .size(px(size))
        .flex_none()
        .text_color(color)
}

pub fn signal_icon(id: impl Into<ElementId>, icon: &str, size: f32, color: Rgba) -> AnyElement {
    if icon == "spinner" {
        return path_icon(spinner::ICON, size, color)
            .with_animation(id, Animation::new(spinner::TURN).repeat(), |icon, delta| {
                icon.with_transformation(Transformation::rotate(percentage(delta)))
            })
            .into_any_element();
    }
    path_icon(lucide_path(icon), size, color).into_any_element()
}

pub fn refresh_icon(
    id: impl Into<ElementId>,
    size: f32,
    color: Rgba,
    refreshing: bool,
) -> AnyElement {
    let icon = path_icon("icons/refresh-cw.svg", size, color);
    if refreshing {
        icon.with_animation(id, Animation::new(SPIN).repeat(), |icon, delta| {
            icon.with_transformation(Transformation::rotate(percentage(delta)))
        })
        .into_any_element()
    } else {
        icon.into_any_element()
    }
}

const MONO_PROVIDERS: &[&str] = &["github"];

pub fn provider_icon(icon: &str, size: f32, color: Rgba) -> AnyElement {
    if icon == "change-request" {
        return path_icon(glyph_path(PullRequestGlyphId::PullRequest), size, color)
            .into_any_element();
    }
    let path = SharedString::from(format!("icons/source-control/{icon}.svg"));
    if MONO_PROVIDERS.contains(&icon) {
        path_icon(path, size, color).into_any_element()
    } else {
        img(path).flex_none().size(px(size)).into_any_element()
    }
}

pub fn filter_icon(
    icon: &PullRequestFilterIcon,
    size: f32,
    color: Rgba,
    projects: &HashMap<String, ProjectIconView>,
) -> AnyElement {
    match icon {
        PullRequestFilterIcon::Lucide { id } => {
            path_icon(lucide_path(id), size, color).into_any_element()
        }
        PullRequestFilterIcon::Glyph { id } => {
            path_icon(glyph_path(*id), size, color).into_any_element()
        }
        PullRequestFilterIcon::Provider { id } => provider_icon(id, size, color),
        PullRequestFilterIcon::Machine { id } => {
            path_icon(machine_icon(*id), size, color).into_any_element()
        }
        PullRequestFilterIcon::Project { project_key } => match projects.get(project_key) {
            Some(project) => ProjectFavicon::new(project, size).into_any_element(),
            None => path_icon("icons/folder-git-2.svg", size, color).into_any_element(),
        },
    }
}

pub fn avatar(actor: &PullRequestActorModel, size: f32, t: &Tokens) -> AnyElement {
    let initial = SharedString::from(actor.initial.clone());
    let muted = t.muted;
    let muted_foreground = t.muted_foreground;
    let fallback = move || {
        div()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .size(px(size))
            .rounded_full()
            .bg(muted)
            .text_size(px(TEXT_3XS))
            .line_height(px(TEXT_3XS))
            .font_weight(FontWeight::MEDIUM)
            .text_color(muted_foreground)
            .child(initial.clone())
            .into_any_element()
    };
    match actor.avatar_url.as_ref() {
        Some(url) => img(SharedString::from(url.clone()))
            .flex_none()
            .size(px(size))
            .rounded_full()
            .bg(muted)
            .object_fit(ObjectFit::Cover)
            .with_fallback(fallback)
            .into_any_element(),
        None => fallback(),
    }
}

pub fn hex_color(value: &str) -> Option<Rgba> {
    let hex = value.strip_prefix('#')?;
    if hex.len() != 6 {
        return None;
    }
    u32::from_str_radix(hex, 16).ok().map(rgb)
}

pub fn label_chip(
    name: &str,
    color: Option<&str>,
    overflow: Option<&str>,
    max_width: f32,
) -> Badge {
    let variant = color
        .and_then(hex_color)
        .map_or(BadgeVariant::Secondary, BadgeVariant::Label);
    Badge::new()
        .size(BadgeSize::Sm)
        .variant(variant)
        .min_w_0()
        .max_w(px(max_width))
        .flex_shrink(1.)
        .justify_start()
        .child(
            div()
                .min_w_0()
                .truncate()
                .child(SharedString::from(name.to_string())),
        )
        .when_some(overflow, |chip, overflow| {
            chip.child(
                div()
                    .flex_none()
                    .child(SharedString::from(overflow.to_string())),
            )
        })
}

pub fn diff_stat(
    additions: &str,
    deletions: &str,
    size: f32,
    line: f32,
    t: &Tokens,
) -> impl IntoElement {
    div()
        .flex()
        .flex_none()
        .items_center()
        .gap(px(4.))
        .font_family(crate::platform::MONO_FONT)
        .font_features(crate::ui::theme::tabular())
        .text_size(px(size))
        .line_height(px(line))
        .child(
            div()
                .text_color(t.diff_addition_foreground)
                .child(SharedString::from(additions.to_string())),
        )
        .child(
            div()
                .text_color(t.diff_deletion)
                .child(SharedString::from(deletions.to_string())),
        )
}
