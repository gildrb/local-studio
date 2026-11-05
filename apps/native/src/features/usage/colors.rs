use gpui::{Rgba, rgb};

use crate::ui::theme::Tokens;
use crate::ui::theme::color::{mix, oklch, to_oklch};

fn variable(name: &str, t: &Tokens) -> Option<Rgba> {
    Some(match name {
        "--contrast-foreground" | "--foreground" => t.foreground,
        "--background" => t.background,
        "--popover" => t.popover,
        "--card" => t.card,
        "--muted-foreground" => t.muted_foreground,
        _ => return None,
    })
}

fn hex(value: &str) -> Option<Rgba> {
    let digits = value.strip_prefix('#')?;
    let parsed = u32::from_str_radix(digits, 16).ok()?;
    match digits.len() {
        6 => Some(rgb(parsed)),
        3 => {
            let (r, g, b) = ((parsed >> 8) & 0xf, (parsed >> 4) & 0xf, parsed & 0xf);
            Some(rgb((r * 0x11) << 16 | (g * 0x11) << 8 | (b * 0x11)))
        }
        _ => None,
    }
}

fn oklab_mix(a: Rgba, b: Rgba, weight_of_a: f32) -> Rgba {
    let (la, ca, ha) = to_oklch(a);
    let (lb, cb, hb) = to_oklch(b);
    let (aa, ab) = (ca * ha.to_radians().cos(), ca * ha.to_radians().sin());
    let (ba, bb) = (cb * hb.to_radians().cos(), cb * hb.to_radians().sin());
    let t = weight_of_a.clamp(0., 1.);
    let lightness = la * t + lb * (1. - t);
    let a_axis = aa * t + ba * (1. - t);
    let b_axis = ab * t + bb * (1. - t);
    let chroma = (a_axis * a_axis + b_axis * b_axis).sqrt();
    let hue = b_axis.atan2(a_axis).to_degrees().rem_euclid(360.);
    Rgba {
        a: a.a * t + b.a * (1. - t),
        ..oklch(lightness, chroma, hue)
    }
}

fn color_mix(body: &str, t: &Tokens) -> Option<Rgba> {
    let (space, rest) = body.split_once(',')?;
    let (first, second) = rest.split_once(',')?;
    let first = first.trim();
    let (first_color, weight) = match first.rsplit_once(' ') {
        Some((color, percent)) if percent.ends_with('%') => (
            color.trim(),
            percent.trim_end_matches('%').parse::<f32>().ok()? / 100.,
        ),
        _ => (first, 0.5),
    };
    let a = css_color_opt(first_color, t)?;
    let b = css_color_opt(second.trim(), t)?;
    Some(if space.trim() == "in oklab" {
        oklab_mix(a, b, weight)
    } else {
        mix(a, b, weight)
    })
}

fn css_color_opt(value: &str, t: &Tokens) -> Option<Rgba> {
    let value = value.trim();
    if value.starts_with('#') {
        return hex(value);
    }
    if let Some(name) = value
        .strip_prefix("var(")
        .and_then(|rest| rest.strip_suffix(')'))
    {
        return variable(name.trim(), t);
    }
    if let Some(body) = value
        .strip_prefix("color-mix(")
        .and_then(|rest| rest.strip_suffix(')'))
    {
        return color_mix(body, t);
    }
    if let Some(body) = value
        .strip_prefix("oklch(")
        .and_then(|rest| rest.strip_suffix(')'))
    {
        let mut parts = body.split_whitespace().map(str::parse::<f32>);
        let (Some(Ok(l)), Some(Ok(c)), Some(Ok(h))) = (parts.next(), parts.next(), parts.next())
        else {
            return None;
        };
        return Some(oklch(l, c, h));
    }
    None
}

pub fn css_color(value: &str, t: &Tokens) -> Rgba {
    css_color_opt(value, t).unwrap_or(t.foreground)
}
