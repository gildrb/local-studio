pub mod appearance;
#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;
pub mod native_context_menu;
pub mod notifications;
pub mod snap_shot;
#[cfg(target_os = "linux")]
pub use linux::gst_player as media_player;
#[cfg(target_os = "linux")]
pub use linux::webview;
#[cfg(target_os = "macos")]
pub use macos::av_player as media_player;
#[cfg(target_os = "macos")]
pub use macos::webview;

use std::borrow::Cow;

use gpui::component::TitleBar;
use gpui::{
    App, Bounds, KeyBinding, Menu, MenuItem, OsAction, SystemMenuType, TitlebarOptions,
    WindowBounds, WindowDecorations, WindowOptions, actions, point, px, size,
};

pub const APP_ID: &str = "dev.sybil.LocalStudio";
pub const APP_NAME: &str = "Local Studio";
pub const MAC: bool = cfg!(target_os = "macos");
pub const DEFAULT_UI_FONT: &str = if MAC { ".SystemUIFont" } else { "Inter" };
pub const DEFAULT_MONO_FONT: &str = if MAC { "Menlo" } else { "DejaVu Sans Mono" };
pub const UI_FONT: &str = ".LocalStudioSans";
pub const MONO_FONT: &str = ".LocalStudioMono";
pub const COMPOSER_FONT: &str = ".LocalStudioComposer";
pub const PLATFORM: &str = if MAC { "darwin" } else { "linux" };

const FONTS: [&[u8]; 3] = [
    include_bytes!("../../assets/fonts/Inter-Regular.ttf"),
    include_bytes!("../../assets/fonts/Inter-Medium.ttf"),
    include_bytes!("../../assets/fonts/Inter-SemiBold.ttf"),
];
const DEFAULT_WINDOW: (f32, f32) = (1100., 780.);
const WINDOW_MIN: (f32, f32) = (840., 620.);
const MACOS_WORKSPACE_TOPBAR_HEIGHT: f32 = 52.;
const MACOS_WINDOW_BUTTON_RADIUS: f32 = 7.;
const TRAFFIC_LIGHT_X: f32 = 16.;

actions!(
    local_studio,
    [Quit, Minimize, CloseWindow, ToggleFullscreen, OpenSettings]
);

pub fn init(cx: &mut App) {
    let fonts = FONTS.iter().map(|bytes| Cow::Borrowed(*bytes)).collect();
    if let Err(error) = cx.text_system().add_fonts(fonts) {
        eprintln!("cannot load bundled fonts: {error:#}");
    }
    appearance::set_font_families(&[], &[], &[], cx);
    cx.on_action(|_: &Quit, cx: &mut App| cx.quit());
    cx.on_action(|_: &Minimize, cx: &mut App| {
        if let Some(window) = cx.active_window() {
            let _ = window.update(cx, |_, window, _| window.minimize_window());
        }
    });
    cx.on_action(|_: &CloseWindow, cx: &mut App| {
        if let Some(window) = cx.active_window() {
            let _ = window.update(cx, |_, window, _| window.remove_window());
        }
    });
    cx.on_action(|_: &ToggleFullscreen, cx: &mut App| {
        if let Some(window) = cx.active_window() {
            let _ = window.update(cx, |_, window, _| window.toggle_fullscreen());
        }
    });
    cx.on_window_closed(|cx, _| {
        if cx.windows().is_empty() {
            cx.quit();
        }
    })
    .detach();
    let primary = if MAC { "cmd" } else { "ctrl" };
    cx.bind_keys([
        KeyBinding::new(&format!("{primary}-q"), Quit, None),
        KeyBinding::new(&format!("{primary}-w"), CloseWindow, None),
        KeyBinding::new("cmd-m", Minimize, None),
        KeyBinding::new(&format!("{primary}-,"), OpenSettings, None),
        KeyBinding::new(
            if MAC { "cmd-ctrl-f" } else { "f11" },
            ToggleFullscreen,
            None,
        ),
    ]);
    cx.set_menus(menus());
}

fn menus() -> Vec<Menu> {
    let settings = MenuItem::action("Settings...", OpenSettings);
    let app_items = if MAC {
        vec![
            settings,
            MenuItem::separator(),
            MenuItem::os_submenu("Services", SystemMenuType::Services),
            MenuItem::separator(),
            MenuItem::action(format!("Quit {APP_NAME}"), Quit),
        ]
    } else {
        vec![
            MenuItem::os_submenu("Services", SystemMenuType::Services),
            MenuItem::separator(),
            MenuItem::action(format!("Quit {APP_NAME}"), Quit),
        ]
    };
    let file_menu = (!MAC).then(|| Menu {
        name: "File".into(),
        items: vec![MenuItem::action("Settings...", OpenSettings)],
        disabled: false,
    });
    let mut menus = vec![Menu {
        name: APP_NAME.into(),
        items: app_items,
        disabled: false,
    }];
    menus.extend(file_menu);
    menus.extend([
        Menu {
            name: "Edit".into(),
            items: vec![
                MenuItem::os_action("Undo", gpui::NoAction, OsAction::Undo),
                MenuItem::os_action("Redo", gpui::NoAction, OsAction::Redo),
                MenuItem::separator(),
                MenuItem::os_action("Cut", gpui::NoAction, OsAction::Cut),
                MenuItem::os_action("Copy", gpui::NoAction, OsAction::Copy),
                MenuItem::os_action("Paste", gpui::NoAction, OsAction::Paste),
                MenuItem::os_action("Select All", gpui::NoAction, OsAction::SelectAll),
            ],
            disabled: false,
        },
        Menu {
            name: "Window".into(),
            items: vec![
                MenuItem::action("Minimize", Minimize),
                MenuItem::action("Toggle Full Screen", ToggleFullscreen),
                MenuItem::separator(),
                MenuItem::action("Close Window", CloseWindow),
            ],
            disabled: false,
        },
    ]);
    menus
}

fn requested_size() -> (f32, f32) {
    std::env::var("LOCAL_STUDIO_WINDOW_SIZE")
        .ok()
        .and_then(|value| {
            let (width, height) = value.split_once('x')?;
            Some((width.trim().parse().ok()?, height.trim().parse().ok()?))
        })
        .unwrap_or(DEFAULT_WINDOW)
}

pub fn window_options(cx: &App) -> WindowOptions {
    let (width, height) = requested_size();
    let bounds = Bounds::centered(None, size(px(width), px(height)), cx);
    WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(bounds)),
        titlebar: Some(TitlebarOptions {
            title: Some(APP_NAME.into()),
            appears_transparent: true,
            traffic_light_position: Some(point(
                px(TRAFFIC_LIGHT_X),
                px(MACOS_WORKSPACE_TOPBAR_HEIGHT / 2. - MACOS_WINDOW_BUTTON_RADIUS),
            )),
        }),
        app_id: Some(APP_ID.into()),
        window_decorations: Some(if MAC {
            WindowDecorations::Server
        } else {
            WindowDecorations::Client
        }),
        window_min_size: Some(size(px(WINDOW_MIN.0), px(WINDOW_MIN.1))),
        ..TitleBar::window_options()
    }
}
