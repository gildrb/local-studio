use std::path::PathBuf;
use std::rc::Rc;

use adw::prelude::*;
use gtk::{gio, glib};

use crate::app::App;
use crate::drawer::Layout;
use crate::panels::SURFACES;

type AppAction = fn(&Rc<App>);
type StringAction = fn(&Rc<App>, String);

#[allow(clippy::too_many_lines)]
pub fn install(app: &Rc<App>) {
    let plain: [(&str, AppAction); 12] = [
        ("terminal-new", |app| app.drawer.add(app, Layout::SideBySide)),
        ("terminal-split", |app| app.drawer.add(app, Layout::SideBySide)),
        ("terminal-split-vertical", |app| app.drawer.add(app, Layout::Stacked)),
        ("terminal-close", |app| app.drawer.close_focused(app)),
        ("close-tab", |app| {
            app.panel.close_active();
        }),
        ("panel-close-all", |app| app.panel.close_where(|_, _| false)),
        ("panel-copy-path", |app| {
            if let Some(path) = app.panel.files.current_path() {
                app.window.clipboard().set_text(&path);
            }
        }),
        ("go-to-file", |app| app.goto.present(app)),
        ("open-editor", |app| {
            let id = app.editors.favorite().map(|editor| editor.id);
            match id {
                Some(id) => open_in(app, id),
                None => app.toast("No editor found. Install VS Code, Zed or Cursor, or use the Files app."),
            }
        }),
        ("theme-import", crate::themes::pick_import),
        ("theme-editor", crate::themes::editor),
        ("appearance-cycle", |app| {
            crate::settings::change(app, |settings| {
                settings.theme = None;
                settings.color_scheme = match settings.color_scheme {
                    local_studio_core::ColorScheme::System => local_studio_core::ColorScheme::Light,
                    local_studio_core::ColorScheme::Light => local_studio_core::ColorScheme::Dark,
                    local_studio_core::ColorScheme::Dark => local_studio_core::ColorScheme::System,
                };
            });
        }),
    ];
    for (name, activate) in plain {
        let action = gio::SimpleAction::new(name, None);
        let weak = Rc::downgrade(app);
        action.connect_activate(move |_, _| {
            if let Some(app) = weak.upgrade() {
                activate(&app);
            }
        });
        app.window.add_action(&action);
    }
    let strings: [(&str, StringAction); 6] = [
        ("project-settings", |app, project| crate::project::present(app, &project)),
        ("panel-open", |app, kind| app.open_surface(&kind)),
        ("panel-close", |app, kind| app.panel.close_tab(&kind)),
        ("panel-close-others", |app, kind| app.panel.close_where(|_, open| open == kind)),
        ("panel-close-right", |app, kind| {
            let index = app.panel.index_of(&kind).unwrap_or(usize::MAX);
            app.panel.close_where(|position, _| position <= index);
        }),
        ("open-in", |app, id| open_in(app, &id)),
    ];
    for (name, activate) in strings {
        let action = gio::SimpleAction::new(name, Some(glib::VariantTy::STRING));
        let weak = Rc::downgrade(app);
        action.connect_activate(move |_, parameter| {
            let (Some(app), Some(value)) = (weak.upgrade(), parameter.and_then(glib::Variant::get::<String>)) else {
                return;
            };
            activate(&app, value);
        });
        app.window.add_action(&action);
    }
    for (action, accel) in [
        ("win.close-tab", "<Control>w"),
        ("win.go-to-file", "<Control>p"),
        ("win.open-editor", "<Control>o"),
        ("win.theme-editor", "<Control><Alt><Shift>t"),
        ("win.appearance-cycle", "<Control><Alt><Shift>a"),
    ] {
        app.application.set_accels_for_action(action, &[accel]);
    }
    let keys = gtk::EventControllerKey::new();
    let weak = Rc::downgrade(app);
    keys.connect_key_pressed(move |_, key, _, modifiers| {
        let Some(app) = weak.upgrade() else { return glib::Propagation::Proceed };
        if !modifiers.is_empty() || !app.panel.root.is_visible() {
            return glib::Propagation::Proceed;
        }
        let focus = gtk::prelude::GtkWindowExt::focus(&app.window);
        let editable = focus.is_some_and(|widget| {
            widget.is::<gtk::Text>() || widget.is::<gtk::TextView>() || widget.is::<vte::Terminal>()
        });
        if editable {
            return glib::Propagation::Proceed;
        }
        let Some(letter) = key.to_unicode().map(|letter| letter.to_ascii_lowercase()) else {
            return glib::Propagation::Proceed;
        };
        if app.panel.launcher_visible() {
            if let Some((kind, ..)) = SURFACES.iter().find(|surface| surface.3 == letter) {
                app.open_surface(kind);
                return glib::Propagation::Stop;
            }
        }
        glib::Propagation::Proceed
    });
    app.window.add_controller(keys);
}

fn open_in(app: &Rc<App>, id: &str) {
    let Some(dir) = app.state.borrow().workspace_dir() else {
        app.toast("Open a project thread first.");
        return;
    };
    match app.editors.open(id, &PathBuf::from(dir)) {
        Ok(name) => app.toast(&format!("Opened in {name}")),
        Err(error) => app.toast(&error),
    }
}
