use gpui::{Rgba, rgb};

use super::tokens::Appearance;
use crate::app_core::views::sidebar::ProjectIconColor;

pub fn project_icon(color: ProjectIconColor, appearance: Appearance) -> Rgba {
    let (dark, light) = match color {
        ProjectIconColor::Gray => (0x99a1af, 0x4a5565),
        ProjectIconColor::Red => (0xff6467, 0xe7000b),
        ProjectIconColor::Orange => (0xff8904, 0xf54a00),
        ProjectIconColor::Amber => (0xffb900, 0xe17100),
        ProjectIconColor::Yellow => (0xfdc700, 0xd08700),
        ProjectIconColor::Lime => (0x9ae600, 0x5ea500),
        ProjectIconColor::Green => (0x05df72, 0x00a63e),
        ProjectIconColor::Emerald => (0x00d492, 0x009966),
        ProjectIconColor::Teal => (0x00d5be, 0x009689),
        ProjectIconColor::Cyan => (0x00d3f3, 0x0092b8),
        ProjectIconColor::Sky => (0x00bcff, 0x0084d1),
        ProjectIconColor::Blue => (0x50a2ff, 0x155dfc),
        ProjectIconColor::Indigo => (0x7c86ff, 0x4f39f6),
        ProjectIconColor::Violet => (0xa684ff, 0x7f22fe),
        ProjectIconColor::Purple => (0xc27aff, 0x9810fa),
        ProjectIconColor::Fuchsia => (0xed6aff, 0xc800de),
        ProjectIconColor::Pink => (0xfb64b6, 0xe60076),
        ProjectIconColor::Rose => (0xff637e, 0xec003f),
    };
    rgb(match appearance {
        Appearance::Dark => dark,
        Appearance::Light => light,
    })
}

pub fn project_swatch(color: ProjectIconColor) -> Rgba {
    rgb(match color {
        ProjectIconColor::Gray => 0x6a7282,
        ProjectIconColor::Red => 0xfb2c36,
        ProjectIconColor::Orange => 0xff6900,
        ProjectIconColor::Amber => 0xfe9a00,
        ProjectIconColor::Yellow => 0xf0b100,
        ProjectIconColor::Lime => 0x7ccf00,
        ProjectIconColor::Green => 0x00c950,
        ProjectIconColor::Emerald => 0x00bc7d,
        ProjectIconColor::Teal => 0x00bba7,
        ProjectIconColor::Cyan => 0x00b8db,
        ProjectIconColor::Sky => 0x00a6f4,
        ProjectIconColor::Blue => 0x2b7fff,
        ProjectIconColor::Indigo => 0x615fff,
        ProjectIconColor::Violet => 0x8e51ff,
        ProjectIconColor::Purple => 0xad46ff,
        ProjectIconColor::Fuchsia => 0xe12afb,
        ProjectIconColor::Pink => 0xf6339a,
        ProjectIconColor::Rose => 0xff2056,
    })
}

pub fn pick(appearance: Appearance, dark: u32, light: u32) -> Rgba {
    rgb(match appearance {
        Appearance::Dark => dark,
        Appearance::Light => light,
    })
}

pub const SKY_400: u32 = 0x00bcff;
pub const SKY_600: u32 = 0x0084d1;
pub const INDIGO_300: u32 = 0xa3b3ff;
pub const INDIGO_600: u32 = 0x4f39f6;
pub const RED_300: u32 = 0xffa2a2;
pub const RED_600: u32 = 0xe7000b;
pub const RED_700: u32 = 0xc10007;
pub const EMERALD_300: u32 = 0x5ee9b5;
pub const EMERALD_600: u32 = 0x009966;
pub const EMERALD_700: u32 = 0x007a55;
pub const VIOLET_300: u32 = 0xc4b4ff;
pub const VIOLET_600: u32 = 0x7f22fe;
pub const TEAL_300: u32 = 0x46edd5;
pub const TEAL_600: u32 = 0x009689;
pub const ZINC_400: u32 = 0x9f9fa9;
pub const ZINC_500: u32 = 0x71717b;
pub const WHITE: u32 = 0xffffff;
