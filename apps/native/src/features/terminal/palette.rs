use alacritty_terminal::term::color::Colors;
use alacritty_terminal::vte::ansi::{Color, NamedColor, Rgb};
use gpui::Rgba;

use crate::ui::theme::tokens::Tokens;

const ANSI: [u32; 16] = [
    0x1d1f21, 0xcc6666, 0xb5bd68, 0xf0c674, 0x81a2be, 0xb294bb, 0x8abeb7, 0xc5c8c6, 0x666666,
    0xd54e53, 0xb9ca4a, 0xe7c547, 0x7aa6da, 0xc397d8, 0x70c0b1, 0xeaeaea,
];
const CUBE_LEVELS: [u8; 6] = [0, 95, 135, 175, 215, 255];
const DIM_MIX: f32 = 0.6;

fn hex(value: u32) -> Rgba {
    gpui::rgb(value)
}

fn from_rgb(color: Rgb) -> Rgba {
    Rgba {
        r: f32::from(color.r) / 255.,
        g: f32::from(color.g) / 255.,
        b: f32::from(color.b) / 255.,
        a: 1.,
    }
}

pub fn default_rgb(index: usize, t: &Tokens) -> Rgba {
    match index {
        0..=15 => hex(ANSI[index]),
        16..=231 => {
            let offset = index - 16;
            let level = |value: usize| f32::from(CUBE_LEVELS[value % 6]) / 255.;
            Rgba {
                r: level(offset / 36),
                g: level(offset / 6),
                b: level(offset),
                a: 1.,
            }
        }
        232..=255 => {
            let gray = (8 + 10 * (index - 232)) as f32 / 255.;
            Rgba {
                r: gray,
                g: gray,
                b: gray,
                a: 1.,
            }
        }
        257 => t.terminal_background,
        258 => t.terminal_cursor,
        _ => t.terminal_foreground,
    }
}

pub fn indexed(colors: &Colors, index: usize, t: &Tokens) -> Rgba {
    colors[index].map_or_else(|| default_rgb(index, t), from_rgb)
}

pub fn mix(background: Rgba, foreground: Rgba, amount: f32) -> Rgba {
    Rgba {
        r: background.r + (foreground.r - background.r) * amount,
        g: background.g + (foreground.g - background.g) * amount,
        b: background.b + (foreground.b - background.b) * amount,
        a: 1.,
    }
}

pub fn dim(color: Rgba, background: Rgba) -> Rgba {
    mix(background, color, DIM_MIX)
}

pub fn resolve(color: Color, colors: &Colors, t: &Tokens) -> Rgba {
    match color {
        Color::Spec(rgb) => from_rgb(rgb),
        Color::Indexed(index) => indexed(colors, usize::from(index), t),
        Color::Named(named) => match named {
            NamedColor::BrightForeground => indexed(colors, NamedColor::Foreground as usize, t),
            NamedColor::DimForeground => dim(
                indexed(colors, NamedColor::Foreground as usize, t),
                indexed(colors, NamedColor::Background as usize, t),
            ),
            NamedColor::DimBlack
            | NamedColor::DimRed
            | NamedColor::DimGreen
            | NamedColor::DimYellow
            | NamedColor::DimBlue
            | NamedColor::DimMagenta
            | NamedColor::DimCyan
            | NamedColor::DimWhite => dim(
                indexed(colors, named.to_bright() as usize, t),
                indexed(colors, NamedColor::Background as usize, t),
            ),
            other => indexed(colors, other as usize, t),
        },
    }
}
