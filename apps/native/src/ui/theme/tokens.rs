use std::collections::HashMap;

use gpui::{Rgba, rgba};

use super::color::{WHITE, alpha, mix_oklab, mix_srgb, over};

const TRANSPARENT: Rgba = Rgba {
    r: 0.,
    g: 0.,
    b: 0.,
    a: 0.,
};

pub const BODY: f32 = 75.;
pub const SECONDARY: f32 = 60.;
pub const MARK: f32 = 45.;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Appearance {
    Light,
    Dark,
}

#[derive(Clone, Debug)]
pub struct Tokens {
    pub appearance: Appearance,
    pub background: Rgba,
    pub foreground: Rgba,
    pub card: Rgba,
    pub card_foreground: Rgba,
    pub popover: Rgba,
    pub popover_foreground: Rgba,
    pub primary: Rgba,
    pub primary_hover: Rgba,
    pub primary_foreground: Rgba,
    pub secondary: Rgba,
    pub secondary_hover: Rgba,
    pub secondary_active: Rgba,
    pub secondary_foreground: Rgba,
    pub secondary_label: Rgba,
    pub muted: Rgba,
    pub muted_foreground: Rgba,
    pub accent: Rgba,
    pub accent_foreground: Rgba,
    pub destructive: Rgba,
    pub destructive_fill: Rgba,
    pub destructive_fill_hover: Rgba,
    pub destructive_foreground: Rgba,
    pub on_destructive: Rgba,
    pub error: Rgba,
    pub error_foreground: Rgba,
    pub error_surface: Rgba,
    pub border: Rgba,
    pub input: Rgba,
    pub control: Rgba,
    pub control_hover: Rgba,
    pub ring: Rgba,
    pub placeholder: Rgba,
    pub icon_muted: Rgba,
    pub info: Rgba,
    pub info_foreground: Rgba,
    pub success: Rgba,
    pub success_foreground: Rgba,
    pub warning: Rgba,
    pub warning_foreground: Rgba,
    pub warning_surface: Rgba,
    pub update: Rgba,
    pub update_foreground: Rgba,
    pub update_surface: Rgba,
    pub chart: [Rgba; 5],
    pub sidebar: Rgba,
    pub sidebar_foreground: Rgba,
    pub sidebar_muted_foreground: Rgba,
    pub sidebar_border: Rgba,
    pub sidebar_icon_color: Rgba,
    pub sidebar_control_surface: Rgba,
    pub sidebar_row_hover: Rgba,
    pub sidebar_row_active: Rgba,
    pub sidebar_row_selected: Rgba,
    pub sidebar_stage_fade: Rgba,
    pub app_chrome_background: Rgba,
    pub toolbar_background: Rgba,
    pub toolbar_foreground: Rgba,
    pub toolbar_border: Rgba,
    pub toolbar_control: Rgba,
    pub toolbar_control_foreground: Rgba,
    pub toolbar_control_hover: Rgba,
    pub surface_raised: Rgba,
    pub message_surface: Rgba,
    pub message_foreground: Rgba,
    pub message_action: Rgba,
    pub message_action_foreground: Rgba,
    pub message_action_hover: Rgba,
    pub code_background: Rgba,
    pub code_foreground: Rgba,
    pub terminal_background: Rgba,
    pub terminal_foreground: Rgba,
    pub terminal_cursor: Rgba,
    pub terminal_selection_background: Rgba,
    pub diff_addition: Rgba,
    pub diff_addition_foreground: Rgba,
    pub diff_deletion: Rgba,
    pub diff_deletion_foreground: Rgba,
    pub tool_error_icon: Rgba,
    pub scrollbar_thumb: Rgba,
    pub scrollbar_thumb_hover: Rgba,
    pub row_hover: Rgba,
    pub overlay: Rgba,
    pub glass_opacity: f32,
    pub chat_max_width: Option<f32>,
    pub prompt_font_size: f32,
    pub code_font_size: f32,
    pub diff_line_height: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChatWidth {
    Comfortable,
    Wide,
    Full,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiffColors {
    RedGreen,
    BlueOrange,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Adjustments {
    pub zoom: f32,
    pub contrast: f32,
    pub glass_opacity: f32,
    pub chat_width: ChatWidth,
    pub diff_colors: DiffColors,
    pub prompt_font_size: f32,
    pub code_font_size: f32,
}

impl Default for Adjustments {
    fn default() -> Self {
        Self {
            zoom: 1.,
            contrast: 100.,
            glass_opacity: 80.,
            chat_width: ChatWidth::Comfortable,
            diff_colors: DiffColors::RedGreen,
            prompt_font_size: 14.,
            code_font_size: 13.,
        }
    }
}

const CHAT_COMFORTABLE_WIDTH: f32 = 768.;
const CHAT_WIDE_WIDTH: f32 = 1152.;
const DIFF_LINE_HEIGHT: f32 = 20.;

pub fn adjust(t: &mut Tokens, adjustments: &Adjustments) {
    let zoom = adjustments.zoom.max(0.01);
    t.glass_opacity = (adjustments.glass_opacity / 100.).clamp(0., 1.);
    t.chat_max_width = match adjustments.chat_width {
        ChatWidth::Comfortable => Some(CHAT_COMFORTABLE_WIDTH),
        ChatWidth::Wide => Some(CHAT_WIDE_WIDTH),
        ChatWidth::Full => None,
    };
    t.prompt_font_size = adjustments.prompt_font_size / zoom;
    t.code_font_size = adjustments.code_font_size / zoom;
    t.diff_line_height = DIFF_LINE_HEIGHT / zoom;
    if adjustments.diff_colors == DiffColors::BlueOrange {
        let (addition, deletion) = match t.appearance {
            Appearance::Dark => (rgba(0x51a2ffff), rgba(0xff8904ff)),
            Appearance::Light => (rgba(0x155dfcff), rgba(0xf54a00ff)),
        };
        t.diff_addition = addition;
        t.diff_addition_foreground = addition;
        t.diff_deletion = deletion;
        t.diff_deletion_foreground = deletion;
    }
    if (adjustments.contrast - 100.).abs() > f32::EPSILON {
        contrast(t, adjustments.contrast);
        derive(t);
    }
}

fn contrast(t: &mut Tokens, contrast: f32) {
    let base = contrast.min(100.) / 100.;
    let boost = (contrast - 100.).max(0.) / 100.;
    let border_boost = boost / 4.;
    let target = match t.appearance {
        Appearance::Dark => WHITE,
        Appearance::Light => rgba(0x000000ff),
    };
    let text =
        |color: Rgba, surface: Rgba| mix_oklab(mix_oklab(color, surface, base), target, 1. - boost);
    let edge = |color: Rgba, ink: Rgba| mix_srgb(fade(color, base), ink, 1. - border_boost);
    let sidebar_muted = text(t.sidebar_muted_foreground, t.sidebar);
    t.toolbar_border = edge(t.toolbar_border, t.toolbar_foreground);
    t.toolbar_foreground = text(t.toolbar_foreground, t.toolbar_background);
    t.toolbar_control_foreground = text(t.toolbar_control_foreground, t.toolbar_control);
    t.input = edge(t.input, t.foreground);
    t.border = edge(t.border, t.foreground);
    t.sidebar_border = edge(t.sidebar_border, t.sidebar_foreground);
    t.muted_foreground = text(t.muted_foreground, t.background);
    t.placeholder = text(t.placeholder, t.background);
    t.secondary_label = text(t.secondary_label, t.background);
    t.icon_muted = text(t.icon_muted, t.background);
    t.card_foreground = text(t.card_foreground, t.card);
    t.popover_foreground = text(t.popover_foreground, t.popover);
    t.accent_foreground = text(t.accent_foreground, t.accent);
    t.secondary_foreground = text(t.secondary_foreground, t.secondary);
    t.message_foreground = text(t.message_foreground, t.message_surface);
    t.sidebar_foreground = text(t.sidebar_foreground, t.sidebar);
    t.sidebar_muted_foreground = sidebar_muted;
    t.sidebar_icon_color = mix_srgb(sidebar_muted, t.sidebar, 0.6);
    t.foreground = text(t.foreground, t.background);
}

pub fn fade(color: Rgba, opacity: f32) -> Rgba {
    alpha(color, color.a * opacity)
}

/// Backdrop blur radius of the glass surfaces, in pixels. The web sets
/// `--glass-blur: 12px` for light and `16px` for dark in `index.css`.
pub fn glass_blur(t: &Tokens) -> f32 {
    match t.appearance {
        Appearance::Dark => 16.,
        Appearance::Light => 12.,
    }
}

/// Backdrop saturation of the glass surfaces. The web sets
/// `--glass-saturation: 1.14` for light and `1.08` for dark in `index.css`.
pub fn glass_saturation(t: &Tokens) -> f32 {
    match t.appearance {
        Appearance::Dark => 1.08,
        Appearance::Light => 1.14,
    }
}

pub fn tokens(appearance: Appearance) -> Tokens {
    match appearance {
        Appearance::Dark => dark(),
        Appearance::Light => light(),
    }
}

pub fn sidebar_scope(t: &Tokens) -> Tokens {
    let mut scoped = t.clone();
    if t.appearance == Appearance::Dark {
        let surface = rgba(0x030303ff);
        let edge = rgba(0xffffff14);
        scoped.background = surface;
        scoped.card = surface;
        scoped.sidebar = surface;
        scoped.sidebar_stage_fade = rgba(0x000000ff);
        scoped.foreground = rgba(0xf1f3f7ff);
        scoped.sidebar_foreground = rgba(0xf1f3f7ff);
        scoped.muted_foreground = rgba(0xa3a3a3ff);
        scoped.sidebar_muted_foreground = rgba(0xa3a3a3ff);
        scoped.border = edge;
        scoped.sidebar_border = edge;
        scoped.sidebar_row_hover = rgba(0xf2f2f214);
        scoped.sidebar_row_active = rgba(0xedf6f61c);
        scoped.sidebar_row_selected = rgba(0xf1f1f112);
    }
    scoped
}

pub fn themed(t: &mut Tokens, colors: &HashMap<String, Rgba>) {
    let role = |name: &str, fallback: Rgba| colors.get(name).copied().unwrap_or(fallback);
    t.background = role("canvas", t.background);
    t.app_chrome_background = role("chrome", t.app_chrome_background);
    t.toolbar_background = role("toolbar", t.toolbar_background);
    t.toolbar_foreground = role("toolbarForeground", t.toolbar_foreground);
    t.toolbar_border = role("toolbarBorder", t.toolbar_border);
    t.toolbar_control = role("toolbarControl", t.toolbar_control);
    t.toolbar_control_foreground = role("toolbarControlForeground", t.toolbar_control_foreground);
    t.toolbar_control_hover = role("toolbarControlHover", t.toolbar_control_hover);
    t.surface_raised = role("surfaceRaised", t.surface_raised);
    t.foreground = role("text", t.foreground);
    t.card = role("surface", t.card);
    t.card_foreground = role("text", t.card_foreground);
    t.popover = role("surfaceOverlay", t.popover);
    t.popover_foreground = role("text", t.popover_foreground);
    t.primary = role("messageAction", t.primary);
    t.primary_foreground = role("messageActionForeground", t.primary_foreground);
    t.secondary = role("secondary", t.secondary);
    t.secondary_foreground = role("secondaryForeground", t.secondary_foreground);
    t.muted = role("muted", t.muted);
    t.muted_foreground = role("mutedForeground", t.muted_foreground);
    t.placeholder = role("placeholder", t.placeholder);
    t.secondary_label = role("secondaryLabel", t.secondary_label);
    t.icon_muted = role("iconMuted", t.icon_muted);
    t.accent = role("accentSurface", t.accent);
    t.accent_foreground = role("accentSurfaceForeground", t.accent_foreground);
    t.message_surface = role("messageSurface", t.message_surface);
    t.message_foreground = role("messageForeground", t.message_foreground);
    t.message_action = role("messageAction", t.message_action);
    t.message_action_foreground = role("messageActionForeground", t.message_action_foreground);
    t.message_action_hover = role("messageActionHover", t.message_action_hover);
    t.error = role("error", t.error);
    t.error_foreground = role("errorForeground", t.error_foreground);
    t.tool_error_icon = t.error_foreground;
    t.error_surface = role("errorSurface", t.error_surface);
    t.destructive = t.error;
    t.destructive_fill = t.error;
    t.destructive_foreground = t.error_foreground;
    t.warning = role("warning", t.warning);
    t.warning_foreground = role("warningForeground", t.warning_foreground);
    t.warning_surface = role("warningSurface", t.warning_surface);
    t.update = role("update", t.update);
    t.update_foreground = role("updateForeground", t.update_foreground);
    t.update_surface = role("updateSurface", t.update_surface);
    t.border = role("border", t.border);
    t.input = role("input", t.input);
    t.ring = role("focus", t.ring);
    t.sidebar = role("sidebar", t.sidebar);
    t.sidebar_foreground = role("sidebarForeground", t.sidebar_foreground);
    t.sidebar_muted_foreground = role("sidebarMutedForeground", t.sidebar_muted_foreground);
    t.sidebar_control_surface = role("sidebarControlSurface", t.sidebar_control_surface);
    t.sidebar_row_hover = role("sidebarRowHover", t.sidebar_row_hover);
    t.sidebar_row_active = role("sidebarRowActive", t.sidebar_row_active);
    t.sidebar_row_selected = role("sidebarRowSelected", t.sidebar_row_selected);
    t.sidebar_border = role("sidebarBorder", t.sidebar_border);
    t.sidebar_stage_fade = t.sidebar;
    t.code_background = role("codeBackground", t.code_background);
    t.code_foreground = role("codeForeground", t.code_foreground);
    t.terminal_background = role("terminalBackground", t.terminal_background);
    t.terminal_foreground = role("terminalForeground", t.terminal_foreground);
    t.terminal_cursor = role("terminalCursor", t.terminal_cursor);
    t.terminal_selection_background = role("terminalSelection", t.terminal_selection_background);
    derive(t);
}

pub fn derive(t: &mut Tokens) {
    t.primary_hover = fade(t.primary, 0.9);
    t.secondary_hover = fade(t.secondary, 0.9);
    t.secondary_active = fade(t.secondary, 0.8);
    t.destructive_fill_hover = fade(t.destructive_fill, 0.9);
    (t.control, t.control_hover) = match t.appearance {
        Appearance::Dark => (
            over(fade(t.input, 0.32), t.background),
            over(fade(t.input, 0.64), t.background),
        ),
        Appearance::Light => (t.popover, over(fade(t.accent, 0.5), t.popover)),
    };
    t.row_hover = fade(t.muted, 0.5);
    t.overlay = fade(t.background, 0.6);
}

fn dark() -> Tokens {
    let mut t = Tokens {
        appearance: Appearance::Dark,
        background: rgba(0x0a0a0aff),
        foreground: rgba(0xf5f5f5ff),
        card: rgba(0x111111ff),
        card_foreground: rgba(0xf5f5f5ff),
        popover: rgba(0x111111ff),
        popover_foreground: rgba(0xf5f5f5ff),
        primary: rgba(0x346bf1ff),
        primary_hover: TRANSPARENT,
        primary_foreground: rgba(0xffffffff),
        secondary: rgba(0xffffff08),
        secondary_hover: TRANSPARENT,
        secondary_active: TRANSPARENT,
        secondary_foreground: rgba(0xf5f5f5ff),
        secondary_label: rgba(0x818181ff),
        muted: rgba(0xffffff08),
        muted_foreground: rgba(0x818181ff),
        accent: rgba(0xffffff0a),
        accent_foreground: rgba(0xf5f5f5ff),
        destructive: rgba(0xfb414aff),
        destructive_fill: rgba(0xfb414aff),
        destructive_fill_hover: TRANSPARENT,
        destructive_foreground: rgba(0xff6467ff),
        on_destructive: WHITE,
        error: rgba(0xfb414aff),
        error_foreground: rgba(0xff6467ff),
        error_surface: rgba(0xf93e4b29),
        border: rgba(0xffffff0f),
        input: rgba(0xffffff14),
        control: TRANSPARENT,
        control_hover: TRANSPARENT,
        ring: rgba(0x346bf1ff),
        placeholder: rgba(0x818181ff),
        icon_muted: rgba(0x818181ff),
        info: rgba(0x2b7fffff),
        info_foreground: rgba(0x50a2ffff),
        success: rgba(0x00bc7dff),
        success_foreground: rgba(0x00d492ff),
        warning: rgba(0xfe9a00ff),
        warning_foreground: rgba(0xffb900ff),
        warning_surface: rgba(0xff9b0029),
        update: rgba(0x346bf1ff),
        update_foreground: rgba(0x50a2ffff),
        update_surface: rgba(0x3269ee2e),
        chart: [
            rgba(0x346bf1ff),
            rgba(0xfe9a00ff),
            rgba(0x00bc7dff),
            rgba(0x2b7fffff),
            rgba(0xfb414aff),
        ],
        sidebar: rgba(0x111111ff),
        sidebar_foreground: rgba(0xf5f5f5ff),
        sidebar_muted_foreground: rgba(0x818181ff),
        sidebar_border: rgba(0xffffff0f),
        sidebar_icon_color: rgba(0x545454ff),
        sidebar_control_surface: rgba(0xffffff08),
        sidebar_row_hover: rgba(0xffffff0a),
        sidebar_row_active: rgba(0xffffff0a),
        sidebar_row_selected: rgba(0xffffff08),
        sidebar_stage_fade: rgba(0x111111ff),
        app_chrome_background: rgba(0x0a0a0aff),
        toolbar_background: rgba(0x0a0a0aff),
        toolbar_foreground: rgba(0xf5f5f5ff),
        toolbar_border: rgba(0xffffff0f),
        toolbar_control: rgba(0x111111ff),
        toolbar_control_foreground: rgba(0xf5f5f5ff),
        toolbar_control_hover: rgba(0xffffff0a),
        surface_raised: rgba(0x111111ff),
        message_surface: rgba(0xffffff0a),
        message_foreground: rgba(0xf5f5f5ff),
        message_action: rgba(0x346bf1ff),
        message_action_foreground: rgba(0xffffffff),
        message_action_hover: rgba(0x3061daff),
        code_background: rgba(0x111111ff),
        code_foreground: rgba(0xf5f5f5ff),
        terminal_background: rgba(0x0a0a0aff),
        terminal_foreground: rgba(0xf5f5f5ff),
        terminal_cursor: rgba(0xb4cbffff),
        terminal_selection_background: rgba(0xb3cbff40),
        diff_addition: rgba(0x00bc7dff),
        diff_addition_foreground: rgba(0x00d492ff),
        diff_deletion: rgba(0xfb414aff),
        diff_deletion_foreground: rgba(0xff6467ff),
        tool_error_icon: rgba(0xfca5a5ff),
        scrollbar_thumb: rgba(0xffffff14),
        scrollbar_thumb_hover: rgba(0xffffff1f),
        row_hover: TRANSPARENT,
        overlay: TRANSPARENT,
        glass_opacity: 0.8,
        chat_max_width: Some(CHAT_COMFORTABLE_WIDTH),
        prompt_font_size: 14.,
        code_font_size: 13.,
        diff_line_height: DIFF_LINE_HEIGHT,
    };
    derive(&mut t);
    t
}

fn light() -> Tokens {
    let mut t = Tokens {
        appearance: Appearance::Light,
        background: rgba(0xfcfcfcff),
        foreground: rgba(0x27272aff),
        card: rgba(0xffffffff),
        card_foreground: rgba(0x27272aff),
        popover: rgba(0xffffffff),
        popover_foreground: rgba(0x27272aff),
        primary: rgba(0x1b4ed8ff),
        primary_hover: TRANSPARENT,
        primary_foreground: rgba(0xffffffff),
        secondary: rgba(0xfafafaff),
        secondary_hover: TRANSPARENT,
        secondary_active: TRANSPARENT,
        secondary_foreground: rgba(0x27272aff),
        secondary_label: rgba(0x71717bff),
        muted: rgba(0xfafafaff),
        muted_foreground: rgba(0x71717bff),
        accent: rgba(0xf4f4f5ff),
        accent_foreground: rgba(0x18181bff),
        destructive: rgba(0xfb2c36ff),
        destructive_fill: rgba(0xfb2c36ff),
        destructive_fill_hover: TRANSPARENT,
        destructive_foreground: rgba(0xc10007ff),
        on_destructive: WHITE,
        error: rgba(0xfb2c36ff),
        error_foreground: rgba(0xc10007ff),
        error_surface: rgba(0xff263314),
        border: rgba(0xe4e4e7ff),
        input: rgba(0xd4d4d8ff),
        control: TRANSPARENT,
        control_hover: TRANSPARENT,
        ring: rgba(0x1b4ed8ff),
        placeholder: rgba(0x71717bff),
        icon_muted: rgba(0x71717bff),
        info: rgba(0x2b7fffff),
        info_foreground: rgba(0x1447e6ff),
        success: rgba(0x00bc7dff),
        success_foreground: rgba(0x007a55ff),
        warning: rgba(0xfe9a00ff),
        warning_foreground: rgba(0xbb4d00ff),
        warning_surface: rgba(0xff990014),
        update: rgba(0x1b4ed8ff),
        update_foreground: rgba(0x1b4ed8ff),
        update_surface: rgba(0x194ad61f),
        chart: [
            rgba(0x1b4ed8ff),
            rgba(0xfe9a00ff),
            rgba(0x00bc7dff),
            rgba(0x2b7fffff),
            rgba(0xfb2c36ff),
        ],
        sidebar: rgba(0xfafafaff),
        sidebar_foreground: rgba(0x27272aff),
        sidebar_muted_foreground: rgba(0x71717bff),
        sidebar_border: rgba(0xe4e4e7ff),
        sidebar_icon_color: rgba(0xa8a8aeff),
        sidebar_control_surface: rgba(0xf4f4f5ff),
        sidebar_row_hover: rgba(0xfcfcfcff),
        sidebar_row_active: rgba(0xffffffff),
        sidebar_row_selected: rgba(0xffffffff),
        sidebar_stage_fade: rgba(0xfafafaff),
        app_chrome_background: rgba(0xfcfcfcff),
        toolbar_background: rgba(0xfcfcfcff),
        toolbar_foreground: rgba(0x27272aff),
        toolbar_border: rgba(0xe4e4e7ff),
        toolbar_control: rgba(0xffffffff),
        toolbar_control_foreground: rgba(0x27272aff),
        toolbar_control_hover: rgba(0xf4f4f5ff),
        surface_raised: rgba(0xffffff33),
        message_surface: rgba(0xf4f4f5ff),
        message_foreground: rgba(0x27272aff),
        message_action: rgba(0x1b4ed8ff),
        message_action_foreground: rgba(0xffffffff),
        message_action_hover: rgba(0x3160dbff),
        code_background: rgba(0xffffffff),
        code_foreground: rgba(0x27272aff),
        terminal_background: rgba(0xfcfcfcff),
        terminal_foreground: rgba(0x27272aff),
        terminal_cursor: rgba(0x26384eff),
        terminal_selection_background: rgba(0x23416433),
        diff_addition: rgba(0x00bc7dff),
        diff_addition_foreground: rgba(0x009966ff),
        diff_deletion: rgba(0xfb2c36ff),
        diff_deletion_foreground: rgba(0xe7000bff),
        tool_error_icon: rgba(0xfb2c36ff),
        scrollbar_thumb: rgba(0xd9d9d9ff),
        scrollbar_thumb_hover: rgba(0xbfbfbfff),
        row_hover: TRANSPARENT,
        overlay: TRANSPARENT,
        glass_opacity: 0.8,
        chat_max_width: Some(CHAT_COMFORTABLE_WIDTH),
        prompt_font_size: 14.,
        code_font_size: 13.,
        diff_line_height: DIFF_LINE_HEIGHT,
    };
    derive(&mut t);
    t
}
