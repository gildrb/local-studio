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
.ls-crumb-project { color: alpha(currentColor, 0.55); }
.ls-crumb-title { font-weight: 600; }
.ls-bubble { background: alpha(currentColor, 0.08); border-radius: 16px; padding: 9px 13px; }
.ls-bubble.queued { background: transparent; border: 1px dashed alpha(currentColor, 0.25); }
.ls-user-row .ls-row-actions { opacity: 0; }
.ls-user-row:hover .ls-row-actions { opacity: 1; }
.ls-row-actions button { min-height: 22px; min-width: 22px; padding: 0 4px; }
.ls-assistant label { font-size: 13.5px; }
.ls-assistant .heading { font-weight: 700; }
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
