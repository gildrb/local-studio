pub mod color;
pub mod metrics;
pub mod palette;
pub mod roles;
pub mod tokens;

use std::collections::HashMap;
use std::sync::Arc;

use gpui::component::{Theme, ThemeMode};
use gpui::{App, FontFeatures, Global, Hsla, Rgba, WindowAppearance, px};

pub use tokens::{Adjustments, Appearance, ChatWidth, DiffColors, Tokens};

use color::{alpha, hsla, over};
use tokens::fade;

pub fn active(cx: &App) -> Arc<Tokens> {
    cx.global::<AppTheme>().tokens.clone()
}

pub fn sidebar(cx: &App) -> Arc<Tokens> {
    cx.global::<AppTheme>().sidebar.clone()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ThemeChoice {
    System,
    Light,
    Dark,
}

impl ThemeChoice {
    pub fn label(self) -> &'static str {
        match self {
            ThemeChoice::System => "System",
            ThemeChoice::Light => "Light",
            ThemeChoice::Dark => "Dark",
        }
    }

    pub fn next(self) -> Self {
        match self {
            ThemeChoice::System => ThemeChoice::Light,
            ThemeChoice::Light => ThemeChoice::Dark,
            ThemeChoice::Dark => ThemeChoice::System,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ThemePalette {
    pub id: String,
    pub colors: HashMap<String, Rgba>,
}

pub struct AppTheme {
    pub choice: ThemeChoice,
    pub system: Appearance,
    pub palette: Option<Arc<ThemePalette>>,
    pub adjustments: Adjustments,
    pub tokens: Arc<Tokens>,
    pub sidebar: Arc<Tokens>,
}

impl Global for AppTheme {}

pub fn tabular() -> FontFeatures {
    FontFeatures(Arc::new(vec![("tnum".into(), 1)]))
}

fn appearance_of(system: WindowAppearance) -> Appearance {
    match system {
        WindowAppearance::Light | WindowAppearance::VibrantLight => Appearance::Light,
        WindowAppearance::Dark | WindowAppearance::VibrantDark => Appearance::Dark,
    }
}

fn resolve(choice: ThemeChoice, system: Appearance) -> Appearance {
    match choice {
        ThemeChoice::System => system,
        ThemeChoice::Light => Appearance::Light,
        ThemeChoice::Dark => Appearance::Dark,
    }
}

pub fn init(choice: ThemeChoice, cx: &mut App) {
    let system = appearance_of(cx.window_appearance());
    apply(choice, system, None, Adjustments::default(), cx);
}

pub fn set_choice(choice: ThemeChoice, cx: &mut App) {
    let current = cx.global::<AppTheme>();
    let (system, palette, adjustments) =
        (current.system, current.palette.clone(), current.adjustments);
    apply(choice, system, palette, adjustments, cx);
}

pub fn set_app_theme(appearance: Appearance, palette: Option<ThemePalette>, cx: &mut App) {
    let current = cx.global::<AppTheme>();
    let (system, adjustments) = (current.system, current.adjustments);
    let choice = match appearance {
        Appearance::Light => ThemeChoice::Light,
        Appearance::Dark => ThemeChoice::Dark,
    };
    apply(choice, system, palette.map(Arc::new), adjustments, cx);
}

pub fn set_adjustments(adjustments: Adjustments, cx: &mut App) {
    let current = cx.global::<AppTheme>();
    let (choice, system, palette) = (current.choice, current.system, current.palette.clone());
    apply(choice, system, palette, adjustments, cx);
}

pub fn adjustments(cx: &App) -> Adjustments {
    cx.global::<AppTheme>().adjustments
}

pub fn system_changed(system: WindowAppearance, cx: &mut App) {
    let current = cx.global::<AppTheme>();
    let system = appearance_of(system);
    if current.system != system {
        let (choice, palette, adjustments) =
            (current.choice, current.palette.clone(), current.adjustments);
        apply(choice, system, palette, adjustments, cx);
    }
}

pub fn system_appearance(cx: &App) -> Appearance {
    cx.global::<AppTheme>().system
}

pub fn choice(cx: &App) -> ThemeChoice {
    cx.global::<AppTheme>().choice
}

fn apply(
    choice: ThemeChoice,
    system: Appearance,
    palette: Option<Arc<ThemePalette>>,
    adjustments: Adjustments,
    cx: &mut App,
) {
    let appearance = resolve(choice, system);
    let unchanged = cx.try_global::<AppTheme>().is_some_and(|current| {
        current.choice == choice
            && current.tokens.appearance == appearance
            && current.palette == palette
            && current.adjustments == adjustments
    });
    if unchanged {
        cx.global_mut::<AppTheme>().system = system;
        return;
    }
    let mut base = tokens::tokens(appearance);
    let mut sidebar = match palette.as_deref() {
        Some(palette) => {
            tokens::themed(&mut base, &palette.colors);
            base.clone()
        }
        None => tokens::sidebar_scope(&base),
    };
    tokens::adjust(&mut base, &adjustments);
    tokens::adjust(&mut sidebar, &adjustments);
    let tokens = Arc::new(base);
    cx.set_global(AppTheme {
        choice,
        system,
        palette,
        adjustments,
        tokens: tokens.clone(),
        sidebar: Arc::new(sidebar),
    });
    let mode = match appearance {
        Appearance::Light => ThemeMode::Light,
        Appearance::Dark => ThemeMode::Dark,
    };
    Theme::change(mode, None, cx);
    Theme::update(cx, |theme| configure_kit(theme, &tokens));
}

fn configure_kit(theme: &mut Theme, t: &Tokens) {
    let h = hsla;
    let on_card = |color: Rgba| h(over(color, t.card));
    let on_background = |color: Rgba| h(over(color, t.background));
    let on_sidebar = |color: Rgba| h(over(color, t.sidebar));
    let c = &mut theme.colors;
    c.background = h(t.background);
    c.foreground = h(t.foreground);
    c.border = on_background(t.border);
    c.input = on_background(t.input);
    c.ring = h(t.ring);
    c.caret = h(t.foreground);
    c.selection = h(alpha(t.primary, 0.3));
    c.primary = h(t.primary);
    c.primary_hover = on_background(t.primary_hover);
    c.primary_active = on_background(t.primary_hover);
    c.primary_foreground = h(t.primary_foreground);
    c.secondary = on_background(t.secondary);
    c.secondary_hover = on_background(t.secondary_hover);
    c.secondary_active = on_background(t.secondary_active);
    c.secondary_foreground = h(t.secondary_foreground);
    c.muted = on_background(t.muted);
    c.muted_foreground = h(t.muted_foreground);
    c.accent = on_background(t.accent);
    c.accent_foreground = h(t.accent_foreground);
    c.popover = h(t.popover);
    c.popover_foreground = h(t.popover_foreground);
    c.danger = h(t.destructive_fill);
    c.danger_hover = on_background(t.destructive_fill_hover);
    c.danger_active = on_background(t.destructive_fill_hover);
    c.danger_foreground = h(t.on_destructive);
    c.success = h(t.success);
    c.success_hover = h(t.success);
    c.success_active = h(t.success);
    c.success_foreground = h(t.success_foreground);
    c.warning = h(t.warning);
    c.warning_hover = h(t.warning);
    c.warning_active = h(t.warning);
    c.warning_foreground = h(t.warning_foreground);
    c.info = h(t.info);
    c.info_hover = h(t.info);
    c.info_active = h(t.info);
    c.info_foreground = h(t.info_foreground);
    c.button = h(t.control);
    c.button_hover = h(t.control_hover);
    c.button_active = h(t.control_hover);
    c.button_foreground = h(t.foreground);
    c.button_primary = h(t.primary);
    c.button_primary_hover = on_background(t.primary_hover);
    c.button_primary_active = on_background(t.primary_hover);
    c.button_primary_foreground = h(t.primary_foreground);
    c.button_danger = h(t.destructive_fill);
    c.button_danger_hover = on_background(t.destructive_fill_hover);
    c.button_danger_active = on_background(t.destructive_fill_hover);
    c.button_danger_foreground = h(t.on_destructive);
    c.button_secondary = on_background(t.secondary);
    c.button_secondary_hover = on_background(t.secondary_hover);
    c.button_secondary_active = on_background(t.secondary_active);
    c.button_secondary_foreground = h(t.secondary_foreground);
    c.link = h(t.info_foreground);
    c.link_hover = h(t.info_foreground);
    c.link_active = h(t.info_foreground);
    c.chart_1 = h(t.chart[0]);
    c.chart_2 = h(t.chart[1]);
    c.chart_3 = h(t.chart[2]);
    c.chart_4 = h(t.chart[3]);
    c.chart_5 = h(t.chart[4]);
    c.chart_grid = on_card(t.border);
    c.sidebar = h(t.sidebar);
    c.sidebar_foreground = h(t.sidebar_foreground);
    c.sidebar_border = on_sidebar(t.sidebar_border);
    c.sidebar_accent = on_sidebar(t.sidebar_row_hover);
    c.sidebar_accent_foreground = h(t.sidebar_foreground);
    c.sidebar_primary = h(t.primary);
    c.sidebar_primary_foreground = h(t.primary_foreground);
    c.title_bar = h(t.toolbar_background);
    c.title_bar_border = h(over(t.toolbar_border, t.toolbar_background));
    c.list = h(t.popover);
    c.list_hover = on_card(t.accent);
    c.list_active = on_card(t.accent);
    c.list_active_border = h(t.ring);
    c.list_even = h(t.popover);
    c.list_head = h(t.popover);
    c.table = h(t.card);
    c.table_hover = on_card(t.row_hover);
    c.table_active = on_card(t.muted);
    c.table_active_border = h(t.ring);
    c.table_even = h(t.card);
    c.table_head = h(t.card);
    c.table_head_foreground = h(t.foreground);
    c.table_row_border = on_card(t.border);
    c.tab = h(t.background);
    c.tab_active = h(t.card);
    c.tab_active_foreground = h(t.foreground);
    c.tab_bar = on_background(t.muted);
    c.tab_foreground = h(t.muted_foreground);
    c.switch = on_background(t.input);
    c.overlay = h(t.overlay);
    c.window_border = on_background(t.border);
    c.drag_border = h(t.ring);
    c.drop_target = h(alpha(t.primary, 0.15));
    c.progress_bar = h(t.primary);
    c.skeleton = on_background(fade(t.muted_foreground, 0.15));
    c.scrollbar = Hsla::transparent_black();
    c.scrollbar_thumb = h(t.scrollbar_thumb);
    c.scrollbar_thumb_hover = h(t.scrollbar_thumb_hover);
    theme.radius = px(metrics::radius::MD);
    theme.radius_lg = px(metrics::radius::LG);
    theme.font_size = px(metrics::text::SM);
    theme.font_family = crate::platform::UI_FONT.into();
    theme.mono_font_family = crate::platform::MONO_FONT.into();
    theme.shadow = true;
}
