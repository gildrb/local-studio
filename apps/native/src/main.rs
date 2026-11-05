use gpui::{App, AppContext};

use local_studio_gpui::app::assets;
use local_studio_gpui::app::root::AppRoot;
use local_studio_gpui::app_core::backend;
use local_studio_gpui::features::onboarding::deep_links;
use local_studio_gpui::platform;
use local_studio_gpui::ui::theme::{self, ThemeChoice};

fn main() {
    backend::stop_on_signals();
    let application = gpui::application().with_assets(assets::Assets);
    let deep_links = deep_links::register(&application);
    application.run(move |cx: &mut App| {
        gpui::init(cx);
        platform::init(cx);
        theme::init(ThemeChoice::System, cx);
        deep_links::listen(deep_links, cx);
        cx.on_app_quit(|_| {
            backend::stop_all();
            async {}
        })
        .detach();
        let options = platform::window_options(cx);
        let opened = gpui::open_window(options, cx, |window, cx| {
            cx.new(|cx| AppRoot::new(window, cx))
        });
        match opened {
            Ok(_) => cx.activate(true),
            Err(error) => {
                eprintln!("cannot open window: {error:#}");
                cx.quit();
            }
        }
    });
    backend::stop_all();
}
