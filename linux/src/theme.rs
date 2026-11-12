use std::fmt::Write;

use gtk::gdk;

const BASE: &str = r"
:root {
  --accent-bg-color: #1b4ed8;
  --accent-color: #1b4ed8;
  --accent-fg-color: #ffffff;
}
window, dialog { font-size: 13px; }
.ls-sidebar { background: var(--sidebar-bg-color); }
.ls-brand { font-weight: 600; font-size: 13px; }
.ls-search { min-height: 30px; border-radius: 8px; }
.ls-list, .ls-list > row, .ls-timeline, .ls-timeline > row { background: transparent; }
.ls-list > row { padding: 0; margin: 0; border-radius: 10px; }
.ls-list > row:hover, .ls-list > row:selected, .ls-list > row:focus { background: transparent; }
.ls-shelf { font-size: 11.5px; font-weight: 600; color: alpha(currentColor, 0.5); padding: 14px 12px 4px 12px; }
.ls-thread { border-radius: 10px; padding: 7px 10px; margin: 1px 6px; border: 1px solid transparent; }
.ls-thread:hover { background: alpha(currentColor, 0.04); }
.ls-thread.selected { background: alpha(var(--accent-bg-color), 0.16); border-color: alpha(var(--accent-bg-color), 0.45); }
.ls-thread.slim { padding: 6px 10px; }
.ls-thread .title { font-size: 13px; }
.ls-thread.unread .title { font-weight: 600; }
.ls-thread.receded { opacity: 0.7; }
.ls-meta { font-size: 11.5px; color: alpha(currentColor, 0.55); }
.ls-tile { min-width: 18px; min-height: 18px; border-radius: 5px; background: alpha(currentColor, 0.08); font-size: 10px; font-weight: 700; }
.ls-footer { padding: 6px; border-top: 1px solid var(--border-color); }
.ls-footer button { min-width: 30px; min-height: 30px; }
.ls-pill { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: alpha(currentColor, 0.08); }
.ls-add { color: #3fb950; font-family: monospace; font-size: 11px; }
.ls-del { color: #f85149; font-family: monospace; font-size: 11px; }
.status-working { color: #38bdf8; }
.status-approval { color: #f5a524; }
.status-failed { color: #f85149; }
.status-done { color: #34d399; }
.status-woke { color: #a78bfa; }
.status-monitoring { color: #38bdf8; }
.ls-crumb-project { color: alpha(currentColor, 0.55); }
.ls-crumb-title { font-weight: 600; }
.ls-bubble { background: alpha(currentColor, 0.08); border-radius: 16px; padding: 9px 13px; }
.ls-bubble.queued { background: transparent; border: 1px dashed alpha(currentColor, 0.25); }
.ls-user-row .ls-row-actions { opacity: 0; }
.ls-user-row:hover .ls-row-actions { opacity: 1; }
.ls-row-actions button { min-height: 22px; min-width: 22px; padding: 0 4px; }
.ls-assistant label { font-size: 13.5px; }
.ls-assistant .heading { font-weight: 700; }
.ls-markdown, .ls-markdown > text { background: transparent; font-size: 13.5px; }
.ls-code { background: alpha(currentColor, 0.05); border: 1px solid var(--border-color); border-radius: 8px; padding: 8px 10px; }
.ls-code label, .ls-mono { font-family: monospace; font-size: 12px; }
.ls-tool { border-radius: 8px; padding: 2px 6px; min-height: 24px; }
.ls-tool:hover { background: alpha(currentColor, 0.04); }
.ls-tool-detail { background: alpha(currentColor, 0.04); border: 1px solid var(--border-color); border-radius: 8px; padding: 8px 10px; margin: 2px 0 6px 28px; }
.ls-summary { font-size: 12px; color: alpha(currentColor, 0.55); padding: 2px 6px; min-height: 24px; border-radius: 8px; }
.ls-summary:hover { background: alpha(currentColor, 0.04); }
.ls-divider { color: alpha(currentColor, 0.5); font-size: 12px; }
.ls-thinking { color: alpha(currentColor, 0.55); }
.ls-composer { background: var(--card-bg-color); border: 1px solid var(--border-color); border-radius: 18px; padding: 8px 8px 6px 8px; }
.ls-composer textview, .ls-composer textview text { background: transparent; font-size: 14px; }
.ls-composer dropdown > button, .ls-composer menubutton > button { min-height: 26px; padding: 0 8px; font-size: 12px; }
.ls-send { min-width: 30px; min-height: 30px; padding: 0; border-radius: 999px; }
.ls-stop { min-width: 30px; min-height: 30px; padding: 0; border-radius: 999px; background: #e5484d; color: white; }
.ls-placeholder { color: alpha(currentColor, 0.4); font-size: 14px; }
.ls-approval { border-bottom: 1px solid var(--border-color); padding: 4px 6px 10px 6px; margin-bottom: 6px; }
.ls-approval .kind { color: #f5a524; font-weight: 600; font-size: 12px; }
.ls-approval .command { font-family: monospace; font-size: 12px; background: alpha(currentColor, 0.05); border-radius: 6px; padding: 6px 8px; }
.ls-working { font-size: 12px; color: alpha(currentColor, 0.55); }
.ls-hero { font-size: 22px; font-weight: 600; }
.ls-metric { background: var(--card-bg-color); border: 1px solid var(--border-color); border-radius: 12px; padding: 12px 14px; }
.ls-metric .value { font-size: 20px; font-weight: 600; }
.ls-dot { min-width: 8px; min-height: 8px; border-radius: 999px; background: alpha(currentColor, 0.3); }
.ls-dot.serving { background: #34d399; }
.ls-dot.loading { background: #f5a524; }
.ls-dot.offline { background: #f85149; }
.ls-panel { background: var(--sidebar-bg-color); border-left: 1px solid var(--border-color); }
.ls-diff { font-family: monospace; font-size: 12px; background: transparent; }
.ls-diff text { background: transparent; }
.ls-tool label, .ls-summary label, .ls-composer dropdown label, .ls-panel dropdown label { font-weight: normal; }
.ls-footer button.active { background: alpha(currentColor, 0.1); }
.ls-approval button { min-height: 28px; padding: 0 14px; border-radius: 8px; }
.ls-user-row { margin-top: 14px; }
.ls-thread.marked { background: alpha(var(--accent-bg-color), 0.10); border-color: alpha(var(--accent-bg-color), 0.30); }
.ls-bulk { padding: 4px 6px 4px 14px; border-top: 1px solid var(--border-color); }
.ls-bulk button { min-width: 28px; min-height: 28px; }
.ls-hint { font-family: monospace; font-size: 10px; padding: 0 5px; }
.ls-rename { min-height: 26px; padding: 0 6px; }
.ls-menu { border-bottom: 1px solid var(--border-color); margin-bottom: 4px; padding-bottom: 4px; }
.ls-menu row { border-radius: 8px; }
.ls-chip { background: alpha(currentColor, 0.06); border-radius: 8px; padding: 2px 4px 2px 8px; }
.ls-chip-remove { min-width: 18px; min-height: 18px; padding: 0; margin: 2px; }
.ls-thumb { border-radius: 8px; }
.ls-branchbar dropdown > button, .ls-branchbar menubutton > button { min-height: 26px; padding: 0 8px; font-size: 12px; font-weight: normal; }
.ls-branchbar label { font-weight: normal; }
.ls-search-hit .title { font-family: monospace; font-size: 12px; }
.ls-drawer { border-top: 1px solid var(--border-color); background: #0d0d0d; }
.ls-drawer-bar { padding: 2px 6px 2px 12px; border-bottom: 1px solid var(--border-color); }
.ls-drawer-bar button { min-width: 26px; min-height: 26px; padding: 0; }
.ls-terminal { padding: 0; }
.ls-terminal-status { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: alpha(currentColor, 0.08); color: alpha(currentColor, 0.7); }
.ls-provider-warning { color: var(--warning-color); }
.ls-provider-error { color: var(--error-color); }
.ls-panel-bar { padding: 6px 6px 6px 8px; }
.ls-panel-bar button { min-width: 28px; min-height: 28px; }
.ls-tab { border-radius: 8px; padding: 2px 4px 2px 8px; min-height: 26px; }
.ls-tab:hover { background: alpha(currentColor, 0.05); }
.ls-tab.active { background: alpha(currentColor, 0.10); }
.ls-tab label { font-size: 12px; }
.ls-tab-close { min-width: 18px; min-height: 18px; padding: 0; }
.ls-launcher button { padding: 6px 10px; border-radius: 8px; }
.ls-launcher button label { font-weight: normal; }
.ls-keycap { font-family: monospace; font-size: 11px; padding: 0 6px; border-radius: 5px; border: 1px solid alpha(currentColor, 0.2); color: alpha(currentColor, 0.7); }
.ls-badge { background: var(--accent-bg-color); color: white; border-radius: 999px; font-size: 9px; font-weight: 700; min-width: 14px; min-height: 14px; padding: 0 3px; margin: 2px; }
.ls-scroll-pill { padding: 4px 14px; }
.ls-minimap { opacity: 0.55; }
.ls-minimap:hover { opacity: 1; }
.ls-minimap-button { min-width: 18px; min-height: 18px; padding: 0; }
.ls-small-toggle { font-size: 12px; font-weight: normal; min-height: 24px; padding: 0 8px; }
.ls-setup { background: var(--card-bg-color); border: 1px solid var(--border-color); border-radius: 12px; padding: 10px 12px; }
.ls-drop-hint { margin: 10px; border: 2px dashed alpha(var(--accent-bg-color), 0.7); border-radius: 16px; background: alpha(var(--accent-bg-color), 0.08); font-weight: 600; }
.ls-sidebar-handle { background: transparent; }
.ls-sidebar-handle:hover { background: alpha(var(--accent-bg-color), 0.35); }
.ls-pr-badge { font-size: 11px; font-weight: 600; border-radius: 999px; padding: 0 6px; }
.ls-pr-badge.open { color: #34d399; background: alpha(#34d399, 0.12); }
.ls-pr-badge.merged { color: #a78bfa; background: alpha(#a78bfa, 0.12); }
.ls-pr-badge.closed { color: #f87171; background: alpha(#f87171, 0.12); }
.ls-pr-badge.draft { color: alpha(currentColor, 0.6); background: alpha(currentColor, 0.08); }
.ls-goal { background: alpha(var(--accent-bg-color), 0.08); border: 1px solid alpha(var(--accent-bg-color), 0.3); border-radius: 10px; padding: 6px 10px; }
.ls-goal.active { border-color: alpha(var(--accent-bg-color), 0.6); }
.ls-compare-on { color: var(--accent-color); }
.ls-thumb { border-radius: 10px; }
.ls-thumb-button { padding: 0; border-radius: 10px; }
.ls-banner-error { background: alpha(#f87171, 0.14); }
.ls-drop-target { box-shadow: inset 0 0 0 2px alpha(var(--accent-bg-color), 0.7); border-radius: 10px; }
.ls-diff-tree { border-right: 1px solid var(--border-color); }
.ls-palette-group { font-size: 11px; font-weight: 700; color: alpha(currentColor, 0.5); padding: 10px 12px 4px 12px; }
popover.ls-palette > contents { padding: 0; }
.ls-palette-search { margin: 8px; }
.ls-palette-list { background: transparent; padding: 6px; }
.ls-palette-list > row { border-radius: 7px; }
.ls-palette-list > row:hover, .ls-palette-list > row:active, .ls-palette-list > row:focus { background: transparent; }
.ls-palette-list > row:selected, .ls-palette-list > row:selected:hover { background: var(--accent-bg-color); color: var(--accent-fg-color); }
.ls-emoji { font-size: 18px; min-width: 36px; min-height: 36px; padding: 0; }
.ls-commit-box { border: 1px solid var(--border-color); border-radius: 10px; background: alpha(currentColor, 0.03); }
.ls-commit-box textview, .ls-commit-box textview text { background: transparent; }
.ls-dash-tab { padding: 8px 7px; min-height: 0; border-radius: 0; }
.ls-dash-tab label { color: alpha(var(--window-fg-color), 0.62); font-weight: 400; }
.ls-dash-tab:checked { background: none; box-shadow: inset 0 -2px var(--window-fg-color); }
.ls-dash-tab:checked label { color: var(--window-fg-color); font-weight: 500; }
.ls-machine-dot { min-width: 7px; min-height: 7px; border-radius: 999px; }
.ls-machine-dot.serving { background: var(--success-color); }
.ls-machine-dot.loading { background: var(--warning-color); }
.ls-machine-dot.idle { background: alpha(var(--window-fg-color), 0.4); }
.ls-machine-dot.offline { box-shadow: inset 0 0 0 1.5px alpha(var(--window-fg-color), 0.62); }
.ls-dash-label { font-size: 13px; }
.ls-dash-small { font-size: 11.5px; }
.ls-dash-num { font-feature-settings: 'tnum'; }
.ls-dash-model { font-size: 17px; font-weight: 600; }
.ls-dash-name { font-size: 15px; font-weight: 500; }
.ls-dash-hero { font-size: 44px; font-weight: 600; font-feature-settings: 'tnum'; }
.ls-dash-total { font-size: 44px; font-weight: 700; font-feature-settings: 'tnum'; }
.ls-dash-value { font-size: 22px; font-weight: 600; font-feature-settings: 'tnum'; }
.ls-dash-button { padding: 6px 10px; min-height: 0; border-radius: 7px; font-size: 13px; font-weight: 500; }
.ls-dash-button.bordered { background: var(--card-bg-color); box-shadow: inset 0 0 0 1px var(--border-color); }
.ls-dash-button.bordered:hover { background: alpha(currentColor, 0.08); }
.ls-heat-cell { min-width: 9px; min-height: 9px; border-radius: 999px; }
.ls-heat-cell.level-0 { background: alpha(var(--window-fg-color), 0.06); }
.ls-heat-cell.level-1 { background: alpha(var(--accent-bg-color), 0.3); }
.ls-heat-cell.level-2 { background: alpha(var(--accent-bg-color), 0.5); }
.ls-heat-cell.level-3 { background: alpha(var(--accent-bg-color), 0.75); }
.ls-heat-cell.level-4 { background: var(--accent-bg-color); }
.ls-picker-button > button { min-height: 26px; padding: 0 8px; }
.ls-picker-button label { font-weight: normal; font-size: 12px; }
popover.ls-picker > contents { padding: 0; }
.ls-picker-list { padding: 6px; }
.ls-picker-search { margin: 6px; }
.ls-picker-header { font-size: 11.5px; font-weight: 500; color: alpha(currentColor, 0.55); padding: 10px 10px 3px 10px; }
.ls-picker-header.first { padding-top: 4px; }
.ls-picker-separator { margin: 5px 4px; background: var(--border-color); }
.ls-picker-row { min-height: 30px; padding: 0 8px; border-radius: 7px; }
.ls-picker-row.tall { padding: 5px 8px; }
.ls-picker-row.checked { background: alpha(var(--accent-bg-color), 0.12); }
.ls-picker-row.highlighted { background: alpha(currentColor, 0.07); }
.ls-picker-row.checked.highlighted { background: alpha(var(--accent-bg-color), 0.2); }
.ls-picker-row:disabled { opacity: 0.45; }
.ls-picker-title { font-size: 13px; }
.ls-picker-subtitle, .ls-picker-detail { font-size: 11.5px; color: alpha(currentColor, 0.55); }
.ls-picker-icon { color: alpha(currentColor, 0.6); min-width: 16px; }
.ls-picker-row.destructive .ls-picker-title, .ls-picker-row.destructive .ls-picker-icon { color: var(--destructive-color); }
.ls-picker-check { color: var(--accent-color); }
.ls-picker-remove { min-width: 20px; min-height: 20px; padding: 0; }
.ls-picker-empty { font-size: 12.5px; color: alpha(currentColor, 0.55); padding: 20px; }
.ls-picker-note { padding: 2px 12px 8px 12px; }
.ls-list:focus-visible, .ls-timeline:focus-visible { outline-style: none; }
.ls-focus-ring { outline: 2px solid alpha(var(--accent-color), 0.85); outline-offset: 3px; border-radius: 10px; }
.ls-thread.ls-focus-ring { outline-offset: 0; }
.ls-vim-mode { font-family: monospace; font-size: 10.5px; font-weight: 700; padding: 0 6px; color: alpha(currentColor, 0.5); }
.ls-vim-mode.normal { color: var(--accent-color); }
";

const DARK: &str = r"
:root {
  --accent-bg-color: #346bf1;
  --accent-color: #7c9df8;
  --window-bg-color: #0a0a0a;
  --window-fg-color: #ececec;
  --view-bg-color: #0a0a0a;
  --view-fg-color: #ececec;
  --headerbar-bg-color: #0a0a0a;
  --headerbar-backdrop-color: #0a0a0a;
  --headerbar-shade-color: alpha(white, 0.06);
  --headerbar-border-color: alpha(white, 0.06);
  --sidebar-bg-color: #111111;
  --sidebar-backdrop-color: #111111;
  --sidebar-border-color: alpha(white, 0.06);
  --sidebar-shade-color: alpha(white, 0.06);
  --secondary-sidebar-bg-color: #111111;
  --secondary-sidebar-backdrop-color: #111111;
  --card-bg-color: #111111;
  --card-shade-color: alpha(white, 0.06);
  --dialog-bg-color: #111111;
  --popover-bg-color: #161616;
  --border-color: alpha(white, 0.06);
  --shade-color: alpha(black, 0.4);
}
.ls-bubble { background: #1c1c1e; }
.ls-composer { background: #111111; border-color: alpha(white, 0.08); }
";

pub fn install() {
    let Some(display) = gdk::Display::default() else {
        return;
    };
    let base = gtk::CssProvider::new();
    base.load_from_string(BASE);
    gtk::style_context_add_provider_for_display(&display, &base, gtk::STYLE_PROVIDER_PRIORITY_APPLICATION);
    let dark = gtk::CssProvider::new();
    dark.load_from_string(DARK);
    let manager = adw::StyleManager::default();
    let apply = move |manager: &adw::StyleManager| {
        if manager.is_dark() {
            gtk::style_context_add_provider_for_display(&display, &dark, gtk::STYLE_PROVIDER_PRIORITY_APPLICATION + 1);
        } else {
            gtk::style_context_remove_provider_for_display(&display, &dark);
        }
    };
    apply(&manager);
    manager.connect_dark_notify(apply);
    manager.connect_dark_notify(|_| {
        let last = SETTINGS.with(|last| last.borrow().clone());
        if let Some(settings) =
            last.filter(|settings| crate::themes::find(settings).is_none_or(|theme| theme.adaptive()))
        {
            self::apply(&settings);
        }
    });
    if let Some(settings) = gtk::Settings::default() {
        settings.set_gtk_enable_animations(false);
    }
}

pub fn color_scheme(scheme: local_studio_core::ColorScheme) {
    adw::StyleManager::default().set_color_scheme(match scheme {
        local_studio_core::ColorScheme::System => adw::ColorScheme::PreferDark,
        local_studio_core::ColorScheme::Light => adw::ColorScheme::ForceLight,
        local_studio_core::ColorScheme::Dark => adw::ColorScheme::ForceDark,
    });
}

type Listener = Box<dyn Fn(&crate::colors::Colors)>;

thread_local! {
    static DYNAMIC: gtk::CssProvider = gtk::CssProvider::new();
    static INSTALLED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static LAST: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) };
    static SETTINGS: std::cell::RefCell<Option<local_studio_core::Settings>> = const { std::cell::RefCell::new(None) };
    static LISTENERS: std::cell::RefCell<Vec<Listener>> = const { std::cell::RefCell::new(Vec::new()) };
}

pub fn on_colors(listener: impl Fn(&crate::colors::Colors) + 'static) {
    LISTENERS.with(|listeners| listeners.borrow_mut().push(Box::new(listener)));
}

pub fn code_font() -> String {
    let size = SETTINGS.with(|last| last.borrow().as_ref().map_or(12, |settings| settings.code_font_size.clamp(9, 24)));
    format!("{} {size}px", code_family())
}

pub fn code_family() -> String {
    SETTINGS.with(|last| {
        last.borrow()
            .as_ref()
            .map(|settings| settings.code_font.trim().replace(['"', ';', '{', '}', ','], ""))
            .filter(|family| !family.is_empty())
            .unwrap_or_else(|| "monospace".to_string())
    })
}

pub fn preview(theme: &crate::themes::Theme) {
    adw::StyleManager::default().set_color_scheme(if theme.dark {
        adw::ColorScheme::ForceDark
    } else {
        adw::ColorScheme::ForceLight
    });
    let css = LAST.with(|last| format!("{}{}", last.borrow(), theme.css()));
    DYNAMIC.with(|provider| provider.load_from_string(&css));
}

pub fn apply(settings: &local_studio_core::Settings) {
    SETTINGS.with(|last| last.replace(Some(settings.clone())));
    let theme = crate::themes::find(settings);
    match &theme {
        Some(theme) if !theme.adaptive() => {
            adw::StyleManager::default().set_color_scheme(if theme.dark {
                adw::ColorScheme::ForceDark
            } else {
                adw::ColorScheme::ForceLight
            });
        }
        _ => color_scheme(settings.color_scheme),
    }
    let dark = match &theme {
        Some(theme) if !theme.adaptive() => theme.dark,
        _ => adw::StyleManager::default().is_dark(),
    };
    let colors = crate::colors::resolve(settings.theme.as_deref(), dark);
    crate::colors::set_current(&colors);
    let mut css = settings_css(settings);
    match &theme {
        Some(theme) if theme.adaptive() => css.push_str(&crate::colors::css(&colors)),
        Some(theme) => css.push_str(&theme.css()),
        None => {}
    }
    write!(
        css,
        ".ls-composer {{ background: alpha(var(--card-bg-color), {:.2}); }}\n.ls-flash {{ opacity: 0.6; }}\n",
        0.4 + f64::from(settings.glass_opacity.min(100)) / 100.0 * 0.6
    )
    .ok();
    LAST.with(|last| last.replace(settings_css(settings)));
    DYNAMIC.with(|provider| {
        provider.load_from_string(&css);
        if !INSTALLED.with(|installed| installed.replace(true)) {
            if let Some(display) = gdk::Display::default() {
                gtk::style_context_add_provider_for_display(
                    &display,
                    provider,
                    gtk::STYLE_PROVIDER_PRIORITY_APPLICATION + 2,
                );
            }
        }
    });
    LISTENERS.with(|listeners| {
        for listener in listeners.borrow().iter() {
            listener(&colors);
        }
    });
    if let Some(gtk_settings) = gtk::Settings::default() {
        gtk_settings.set_gtk_xft_antialias(i32::from(settings.font_smoothing));
        gtk_settings.set_gtk_hint_font_metrics(!settings.font_smoothing);
    }
}

fn family(font: &str) -> String {
    let font = font.trim().replace(['"', ';', '{', '}'], "");
    if font.is_empty() {
        String::new()
    } else {
        format!("font-family: \"{font}\";")
    }
}

fn settings_css(settings: &local_studio_core::Settings) -> String {
    let contrast = f64::from(settings.contrast.clamp(50, 200)) / 100.0;
    let hairline = (0.06 * contrast).min(0.3);
    let meta = (0.55 * contrast.sqrt()).min(0.9);
    format!(
        "window, dialog {{ {interface} font-size: {interface_size}px; }}\n\
         .ls-composer textview, .ls-composer textview text {{ {prompt} font-size: {prompt_size}px; }}\n\
         .ls-mono, .ls-code label, .ls-diff, .ls-diff text, .ls-tool-detail label {{ {code} font-size: {code_size}px; }}\n\
         :root {{ --border-color: alpha(currentColor, {hairline:.3}); }}\n\
         .ls-meta {{ color: alpha(currentColor, {meta:.3}); }}\n",
        interface = family(&settings.interface_font),
        interface_size = settings.interface_font_size.clamp(9, 24),
        prompt = family(&settings.prompt_font),
        prompt_size = settings.prompt_font_size.clamp(9, 24),
        code = family(&settings.code_font),
        code_size = settings.code_font_size.clamp(9, 24),
    )
}
