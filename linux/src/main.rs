mod actions;
mod app;
mod bindings;
mod branches;
mod commands;
mod composer;
mod core;
mod diffview;
mod drawer;
mod editor;
mod extras;
mod fixtures;
mod format;
mod goto;
mod header;
mod pages;
mod palette;
mod panels;
mod prefs;
mod project;
mod pulls;
mod scenes;
mod search;
mod settings;
mod setup;
mod sidebar;
mod smoke;
mod snapshot;
mod sound;
mod state;
mod surfaces;
mod theme;
mod themes;
mod timeline;
mod tools;
mod wizard;
mod workbench;

use std::cell::{Cell, RefCell};
use std::path::PathBuf;
use std::rc::Rc;

use adw::prelude::*;
use gtk::{gio, glib};

use crate::app::App;

const USAGE: &str = "usage: local-studio [--smoke | --snapshot <dir> [name-filter]]";

#[derive(Clone)]
enum Mode {
    App,
    Smoke,
    Snapshot(PathBuf, Option<String>),
}

fn parse() -> Result<Mode, String> {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        None => Ok(Mode::App),
        Some("--smoke") => Ok(Mode::Smoke),
        Some("--snapshot") => {
            let dir = args.next().ok_or_else(|| USAGE.to_string())?;
            Ok(Mode::Snapshot(PathBuf::from(dir), args.next()))
        }
        Some(other) => Err(format!("unknown argument {other}\n{USAGE}")),
    }
}

fn main() -> glib::ExitCode {
    let mode = match parse() {
        Ok(mode) => mode,
        Err(message) => {
            eprintln!("{message}");
            return glib::ExitCode::FAILURE;
        }
    };
    let flags = match mode {
        Mode::App => gio::ApplicationFlags::default(),
        Mode::Smoke | Mode::Snapshot(..) => gio::ApplicationFlags::NON_UNIQUE,
    };
    let application = adw::Application::builder().application_id("dev.localstudio.LocalStudio").flags(flags).build();
    let failed = Rc::new(Cell::new(false));
    let holder: Rc<RefCell<Option<Rc<App>>>> = Rc::default();
    let activation = Rc::clone(&holder);
    let status = Rc::clone(&failed);
    application.connect_activate(move |application| {
        if let Some(app) = activation.borrow().as_ref() {
            app.window.present();
            return;
        }
        let app = App::build(application);
        activation.replace(Some(Rc::clone(&app)));
        match &mode {
            Mode::App => {
                app.interactive.set(true);
                app.start_core();
                app.window.present();
            }
            Mode::Smoke => {
                smoke::start(&app, Rc::clone(&status));
                app.start_core();
                app.window.present();
            }
            Mode::Snapshot(dir, filter) => snapshot::start(&app, dir.clone(), filter.clone(), Rc::clone(&status)),
        }
    });
    let shutdown = Rc::clone(&holder);
    application.connect_shutdown(move |_| {
        if let Some(app) = shutdown.take() {
            app.core.stop();
        }
    });
    let code = application.run_with_args::<&str>(&[]);
    if failed.get() {
        glib::ExitCode::FAILURE
    } else {
        code
    }
}
