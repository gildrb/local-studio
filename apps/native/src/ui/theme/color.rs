use gpui::{Hsla, Rgba};

pub const WHITE: Rgba = Rgba {
    r: 1.,
    g: 1.,
    b: 1.,
    a: 1.,
};

pub const BLACK: Rgba = Rgba {
    r: 0.,
    g: 0.,
    b: 0.,
    a: 1.,
};

fn encode(linear: f32) -> f32 {
    let linear = linear.clamp(0., 1.);
    if linear <= 0.003_130_8 {
        12.92 * linear
    } else {
        1.055 * linear.powf(1. / 2.4) - 0.055
    }
}

fn decode(channel: f32) -> f32 {
    if channel <= 0.040_45 {
        channel / 12.92
    } else {
        ((channel + 0.055) / 1.055).powf(2.4)
    }
}

pub fn oklch(lightness: f32, chroma: f32, hue: f32) -> Rgba {
    let (sin, cos) = hue.to_radians().sin_cos();
    let (a, b) = (chroma * cos, chroma * sin);
    let l = (lightness + 0.396_337_78 * a + 0.215_803_76 * b).powi(3);
    let m = (lightness - 0.105_561_346 * a - 0.063_854_17 * b).powi(3);
    let s = (lightness - 0.089_484_18 * a - 1.291_485_5 * b).powi(3);
    Rgba {
        r: encode(4.076_741_7 * l - 3.307_711_6 * m + 0.230_969_94 * s),
        g: encode(-1.268_438 * l + 2.609_757_4 * m - 0.341_319_38 * s),
        b: encode(-0.004_196_086_3 * l - 0.703_418_6 * m + 1.707_614_7 * s),
        a: 1.,
    }
}

pub fn to_oklch(color: Rgba) -> (f32, f32, f32) {
    let (r, g, b) = (decode(color.r), decode(color.g), decode(color.b));
    let l = (0.412_221_46 * r + 0.536_332_55 * g + 0.051_445_995 * b).cbrt();
    let m = (0.211_903_5 * r + 0.680_699_5 * g + 0.107_396_96 * b).cbrt();
    let s = (0.088_302_46 * r + 0.281_718_85 * g + 0.629_978_7 * b).cbrt();
    let lightness = 0.210_454_26 * l + 0.793_617_8 * m - 0.004_072_047 * s;
    let a = 1.977_998_5 * l - 2.428_592_2 * m + 0.450_593_7 * s;
    let b = 0.025_904_037 * l + 0.782_771_77 * m - 0.808_675_77 * s;
    let chroma = (a * a + b * b).sqrt();
    let hue = b.atan2(a).to_degrees().rem_euclid(360.);
    (lightness, chroma, hue)
}

pub fn mix(a: Rgba, b: Rgba, weight_of_a: f32) -> Rgba {
    let t = weight_of_a.clamp(0., 1.);
    Rgba {
        r: a.r * t + b.r * (1. - t),
        g: a.g * t + b.g * (1. - t),
        b: a.b * t + b.b * (1. - t),
        a: a.a * t + b.a * (1. - t),
    }
}

pub fn mix_srgb(a: Rgba, b: Rgba, weight_of_a: f32) -> Rgba {
    let t = weight_of_a.clamp(0., 1.);
    let alpha = a.a * t + b.a * (1. - t);
    if alpha <= 0. {
        return Rgba { a: 0., ..a };
    }
    let (wa, wb) = (a.a * t / alpha, b.a * (1. - t) / alpha);
    Rgba {
        r: a.r * wa + b.r * wb,
        g: a.g * wa + b.g * wb,
        b: a.b * wa + b.b * wb,
        a: alpha,
    }
}

pub fn mix_oklab(a: Rgba, b: Rgba, weight_of_a: f32) -> Rgba {
    let lab = |color: Rgba| {
        let (lightness, chroma, hue) = to_oklch(color);
        let (sin, cos) = hue.to_radians().sin_cos();
        (lightness, chroma * cos, chroma * sin)
    };
    let t = weight_of_a.clamp(0., 1.);
    let alpha = a.a * t + b.a * (1. - t);
    if alpha <= 0. {
        return Rgba { a: 0., ..a };
    }
    let (wa, wb) = (a.a * t / alpha, b.a * (1. - t) / alpha);
    let ((la, aa, ba), (lb, ab, bb)) = (lab(a), lab(b));
    let (x, y) = (aa * wa + ab * wb, ba * wa + bb * wb);
    let mixed = oklch(
        la * wa + lb * wb,
        (x * x + y * y).sqrt(),
        y.atan2(x).to_degrees().rem_euclid(360.),
    );
    Rgba { a: alpha, ..mixed }
}

pub fn alpha(color: Rgba, opacity: f32) -> Rgba {
    Rgba {
        a: opacity,
        ..color
    }
}

pub fn over(top: Rgba, bottom: Rgba) -> Rgba {
    let t = top.a.clamp(0., 1.);
    Rgba {
        r: top.r * t + bottom.r * (1. - t),
        g: top.g * t + bottom.g * (1. - t),
        b: top.b * t + bottom.b * (1. - t),
        a: 1.,
    }
}

pub fn hsla(color: Rgba) -> Hsla {
    color.into()
}

pub fn hex(color: Rgba) -> String {
    let byte = |channel: f32| (channel.clamp(0., 1.) * 255.).round() as u8;
    format!(
        "#{:02x}{:02x}{:02x}",
        byte(color.r),
        byte(color.g),
        byte(color.b)
    )
}

pub fn parse_hex(value: &str) -> Option<Rgba> {
    let digits = value.strip_prefix('#')?;
    if !digits.is_ascii() || !matches!(digits.len(), 6 | 8) {
        return None;
    }
    let channel = |index: usize| -> Option<f32> {
        let byte = u8::from_str_radix(digits.get(index..index + 2)?, 16).ok()?;
        Some(f32::from(byte) / 255.)
    };
    Some(Rgba {
        r: channel(0)?,
        g: channel(2)?,
        b: channel(4)?,
        a: if digits.len() == 8 { channel(6)? } else { 1. },
    })
}

pub fn with_lightness(color: Rgba, lightness: f32) -> Rgba {
    let (_, chroma, hue) = to_oklch(color);
    let mut chroma = chroma;
    loop {
        let candidate = oklch(lightness, chroma, hue);
        let (l, _, _) = to_oklch(candidate);
        if (l - lightness).abs() < 0.004 || chroma < 0.001 {
            return Rgba {
                a: color.a,
                ..candidate
            };
        }
        chroma *= 0.92;
    }
}
