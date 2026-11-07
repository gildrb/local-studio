use std::cell::Cell;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::Duration;

use adw::prelude::*;
use gtk::{glib, graphene};

use crate::app::App;
use crate::fixtures;

pub fn start(app: &Rc<App>, dir: PathBuf, filter: Option<String>, failed: Rc<Cell<bool>>) {
    if let Err(error) = std::fs::create_dir_all(&dir) {
        eprintln!("create {}: {error}", dir.display());
        failed.set(true);
        app.application.quit();
        return;
    }
    app.window.set_default_size(1280, 820);
    app.window.present();
    let app = Rc::clone(app);
    glib::spawn_future_local(async move {
        settle(800).await;
        let mut rendered = 0;
        for scene in fixtures::SCENES {
            if filter.as_deref().is_some_and(|filter| !scene.contains(filter)) {
                continue;
            }
            fixtures::stage(&app, scene);
            settle(700).await;
            let path = dir.join(format!("{scene}.png"));
            match capture(&app.window, &path) {
                Ok(()) => {
                    rendered += 1;
                    println!("ok   {}", path.display());
                }
                Err(error) => {
                    eprintln!("FAIL {scene}: {error}");
                    failed.set(true);
                }
            }
            fixtures::teardown(&app);
        }
        println!("{rendered} snapshots in {}", dir.display());
        app.application.quit();
    });
}

async fn settle(millis: u64) {
    glib::timeout_future(Duration::from_millis(millis)).await;
}

fn capture(window: &adw::ApplicationWindow, path: &Path) -> Result<(), String> {
    let (width, height) = (window.width(), window.height());
    if width <= 0 || height <= 0 {
        return Err("the window has no size".to_string());
    }
    let paintable = gtk::WidgetPaintable::new(Some(window));
    let snapshot = gtk::Snapshot::new();
    paintable.snapshot(&snapshot, f64::from(width), f64::from(height));
    let node = snapshot.to_node().ok_or_else(|| "nothing was rendered".to_string())?;
    let renderer = window.renderer().ok_or_else(|| "the window has no renderer".to_string())?;
    #[allow(clippy::cast_precision_loss)]
    let bounds = graphene::Rect::new(0.0, 0.0, width as f32, height as f32);
    let texture = renderer.render_texture(&node, Some(&bounds));
    texture.save_to_png(path).map_err(|error| error.to_string())
}
