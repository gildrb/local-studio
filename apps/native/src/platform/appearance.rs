use gpui::{App, Global, SharedString, Window};

use super::{COMPOSER_FONT, DEFAULT_MONO_FONT, DEFAULT_UI_FONT, MAC, MONO_FONT, UI_FONT};

const SANS_GENERICS: [&str; 5] = [
    "system-ui",
    "-apple-system",
    "BlinkMacSystemFont",
    "sans-serif",
    "ui-sans-serif",
];
const MONO_GENERICS: [&str; 2] = ["monospace", "ui-monospace"];

struct ContentZoom(f32);

impl Global for ContentZoom {}

#[derive(PartialEq)]
struct FontFamilies {
    sans: Vec<String>,
    mono: Vec<String>,
    composer: Vec<String>,
}

impl Global for FontFamilies {}

pub fn content_zoom(cx: &App) -> f32 {
    cx.try_global::<ContentZoom>().map_or(1., |zoom| zoom.0)
}

pub fn set_content_zoom(zoom: f32, window: &mut Window, cx: &mut App) {
    window.set_zoom(zoom);
    let zoom = window.zoom();
    if (content_zoom(cx) - zoom).abs() > f32::EPSILON {
        cx.set_global(ContentZoom(zoom));
        cx.refresh_windows();
    }
}

pub fn set_font_smoothing(enabled: bool, cx: &mut App) {
    if MAC {
        cx.set_glyph_dilation(!enabled);
    }
}

fn family(name: &str) -> SharedString {
    if SANS_GENERICS
        .iter()
        .any(|generic| generic.eq_ignore_ascii_case(name))
    {
        return DEFAULT_UI_FONT.into();
    }
    if MONO_GENERICS
        .iter()
        .any(|generic| generic.eq_ignore_ascii_case(name))
    {
        return DEFAULT_MONO_FONT.into();
    }
    SharedString::from(name.to_string())
}

fn stack(names: &[String], fallback: &[SharedString]) -> Vec<SharedString> {
    let mut families: Vec<SharedString> = names.iter().map(|name| family(name)).collect();
    families.extend(fallback.iter().cloned());
    families
}

pub fn set_font_families(sans: &[String], mono: &[String], composer: &[String], cx: &mut App) {
    let next = FontFamilies {
        sans: sans.to_vec(),
        mono: mono.to_vec(),
        composer: composer.to_vec(),
    };
    if cx.try_global::<FontFamilies>() == Some(&next) {
        return;
    }
    let sans_stack = stack(sans, &[DEFAULT_UI_FONT.into()]);
    let text_system = cx.text_system().clone();
    text_system.set_font_family_alias(UI_FONT, sans_stack.clone());
    text_system.set_font_family_alias(MONO_FONT, stack(mono, &[DEFAULT_MONO_FONT.into()]));
    text_system.set_font_family_alias(COMPOSER_FONT, stack(composer, &sans_stack));
    cx.set_global(next);
    cx.refresh_windows();
}
