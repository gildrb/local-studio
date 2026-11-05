use gpui::{Hsla, Rgba};

use super::tokens::Tokens;

const CHANNEL_TOLERANCE: f32 = 1.5 / 255.;

pub fn role_colors(t: &Tokens) -> Vec<(&'static str, Rgba)> {
    vec![
        ("canvas", t.background),
        ("chrome", t.app_chrome_background),
        ("toolbar", t.toolbar_background),
        ("toolbarForeground", t.toolbar_foreground),
        ("toolbarBorder", t.toolbar_border),
        ("toolbarControl", t.toolbar_control),
        ("toolbarControlForeground", t.toolbar_control_foreground),
        ("toolbarControlHover", t.toolbar_control_hover),
        ("surface", t.card),
        ("surfaceRaised", t.surface_raised),
        ("surfaceOverlay", t.popover),
        ("text", t.foreground),
        ("text", t.card_foreground),
        ("text", t.popover_foreground),
        ("border", t.border),
        ("input", t.input),
        ("focus", t.ring),
        ("secondary", t.secondary),
        ("secondaryForeground", t.secondary_foreground),
        ("muted", t.muted),
        ("mutedForeground", t.muted_foreground),
        ("placeholder", t.placeholder),
        ("secondaryLabel", t.secondary_label),
        ("iconMuted", t.icon_muted),
        ("error", t.error),
        ("errorForeground", t.error_foreground),
        ("errorSurface", t.error_surface),
        ("warning", t.warning),
        ("warningForeground", t.warning_foreground),
        ("warningSurface", t.warning_surface),
        ("update", t.update),
        ("updateForeground", t.update_foreground),
        ("updateSurface", t.update_surface),
        ("accentSurface", t.accent),
        ("accentSurfaceForeground", t.accent_foreground),
        ("messageSurface", t.message_surface),
        ("messageForeground", t.message_foreground),
        ("messageAction", t.message_action),
        ("messageAction", t.primary),
        ("messageActionForeground", t.message_action_foreground),
        ("messageActionHover", t.message_action_hover),
        ("codeBackground", t.code_background),
        ("codeForeground", t.code_foreground),
        ("sidebar", t.sidebar),
        ("sidebarForeground", t.sidebar_foreground),
        ("sidebarMutedForeground", t.sidebar_muted_foreground),
        ("sidebarControlSurface", t.sidebar_control_surface),
        ("sidebarRowHover", t.sidebar_row_hover),
        ("sidebarRowActive", t.sidebar_row_active),
        ("sidebarRowSelected", t.sidebar_row_selected),
        ("sidebarBorder", t.sidebar_border),
        ("terminalBackground", t.terminal_background),
        ("terminalForeground", t.terminal_foreground),
        ("terminalCursor", t.terminal_cursor),
        ("terminalSelection", t.terminal_selection_background),
    ]
}

pub fn role_of(color: Hsla, table: &[(&'static str, Rgba)]) -> Option<&'static str> {
    let painted = color.to_rgb();
    table
        .iter()
        .find(|(_, token)| {
            token.a > 0.
                && (token.r - painted.r).abs() <= CHANNEL_TOLERANCE
                && (token.g - painted.g).abs() <= CHANNEL_TOLERANCE
                && (token.b - painted.b).abs() <= CHANNEL_TOLERANCE
        })
        .map(|(role, _)| *role)
}
