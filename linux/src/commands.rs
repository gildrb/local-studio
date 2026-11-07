use std::rc::Rc;

use adw::prelude::*;
use gtk::{gdk, gio, glib};
use local_studio_core::Shelf;

use crate::app::{App, Dirty};
use crate::state::Page;

type AppAction = fn(&Rc<App>);
type ThreadAction = fn(&Rc<App>, String);

const BINDINGS: [(&str, &str); 14] = [
    ("sidebar.toggle", "win.toggle-sidebar"),
    ("chat.new", "win.new-thread"),
    ("chat.newWithoutProject", "win.new-thread-without-project"),
    ("commandPalette.toggle", "win.palette"),
    ("terminal.toggle", "win.toggle-terminal"),
    ("diff.toggle", "win.toggle-diff"),
    ("rightPanel.toggle", "win.toggle-panel"),
    ("usage.open", "win.usage"),
    ("projectSearch.toggle", "win.project-search"),
    ("thread.settle", "win.current-settle"),
    ("thread.pin", "win.current-pin"),
    ("thread.previous", "win.thread-previous"),
    ("thread.next", "win.thread-next"),
    ("thread.undo", "win.undo"),
];

pub fn install(app: &Rc<App>) {
    let plain: [(&str, AppAction); 16] = [
        ("undo", |app| {
            let undo = app.undo.take();
            if let Some(undo) = undo {
                undo(app);
            }
        }),
        ("bulk-unread", |app| bulk(app, |studio, id| studio.mark_unread(id, true))),
        ("bulk-unpin", |app| bulk(app, |studio, id| studio.set_pinned(id, false))),
        ("bulk-settle", |app| bulk(app, |studio, id| studio.set_settled(id, true))),
        ("bulk-archive", |app| {
            let marked = app.sidebar.marked();
            bulk(app, |studio, id| studio.set_archived(id, true));
            crate::actions::undoable(app, &format!("{} threads archived", marked.len()), move |app| {
                for id in &marked {
                    let id = id.clone();
                    app.core.run(|studio| studio.set_archived(id, false));
                }
            });
        }),
        ("bulk-delete", bulk_delete),
        ("bulk-clear", |app| {
            app.sidebar.clear_marks();
            app.render(Dirty { sidebar: true, ..Dirty::default() });
        }),
        ("current-pin", |app| current(app, "win.thread-pin")),
        ("current-settle", |app| current(app, "win.thread-settle")),
        ("thread-previous", |app| step(app, -1)),
        ("thread-next", |app| step(app, 1)),
        ("project-search", |app| app.search.present(app)),
        ("pull-requests", |app| app.open_page(Page::PullRequests)),
        ("toggle-panel", |app| app.panel.root.set_visible(!app.panel.root.is_visible())),
        ("git-pull", |app| git(app, "Pulling…", local_studio_core::Studio::pull)),
        ("git-publish", publish),
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
    let threaded: [(&str, ThreadAction); 5] = [
        ("thread-move-up", |app, id| move_by(app, &id, -1)),
        ("thread-move-down", |app, id| move_by(app, &id, 1)),
        ("thread-auto-settle-on", |app, id| app.core.run(|studio| studio.set_auto_settle(id, true))),
        ("thread-auto-settle-off", |app, id| app.core.run(|studio| studio.set_auto_settle(id, false))),
        ("thread-regenerate-title", |app, id| app.core.run(|studio| studio.regenerate_title(id))),
    ];
    for (name, activate) in threaded {
        let action = gio::SimpleAction::new(name, Some(glib::VariantTy::STRING));
        let weak = Rc::downgrade(app);
        action.connect_activate(move |_, parameter| {
            let (Some(app), Some(id)) = (weak.upgrade(), parameter.and_then(glib::Variant::get::<String>)) else {
                return;
            };
            activate(&app, id);
        });
        app.window.add_action(&action);
    }
    let jump = gio::SimpleAction::new("thread-jump", Some(glib::VariantTy::INT32));
    let weak = Rc::downgrade(app);
    jump.connect_activate(move |_, parameter| {
        let (Some(app), Some(index)) = (weak.upgrade(), parameter.and_then(glib::Variant::get::<i32>)) else {
            return;
        };
        let target = usize::try_from(index - 1).ok().and_then(|index| app.sidebar.thread_at(index));
        if let Some(thread) = target {
            app.select_thread(Some(thread));
        }
    });
    app.window.add_action(&jump);
    for index in 1..=9 {
        app.application.set_accels_for_action(&format!("win.thread-jump({index})"), &[&format!("<Control>{index}")]);
    }
    for (action, accel) in [
        ("win.undo", "<Control>z"),
        ("win.project-search", "<Control><Shift>f"),
        ("win.current-pin", "<Control><Shift>p"),
        ("win.current-settle", "<Control><Shift>s"),
        ("win.thread-previous", "<Control><Shift>bracketleft"),
        ("win.thread-next", "<Control><Shift>bracketright"),
        ("win.toggle-panel", "<Control><Alt>b"),
    ] {
        app.application.set_accels_for_action(action, &[accel]);
    }
    install_keys(app);
}

fn install_keys(app: &Rc<App>) {
    let keys = gtk::EventControllerKey::new();
    keys.set_propagation_phase(gtk::PropagationPhase::Capture);
    let weak = Rc::downgrade(app);
    keys.connect_key_pressed(move |_, key, _, _| {
        let Some(app) = weak.upgrade() else { return glib::Propagation::Proceed };
        match key {
            gdk::Key::Control_L | gdk::Key::Control_R => {
                if app.sidebar.set_hints(true) {
                    app.render(Dirty { sidebar: true, ..Dirty::default() });
                }
            }
            gdk::Key::Escape if app.sidebar.clear_marks() => {
                app.render(Dirty { sidebar: true, ..Dirty::default() });
                return glib::Propagation::Stop;
            }
            _ => {}
        }
        glib::Propagation::Proceed
    });
    let weak = Rc::downgrade(app);
    keys.connect_key_released(move |_, key, _, _| {
        let Some(app) = weak.upgrade() else { return };
        if matches!(key, gdk::Key::Control_L | gdk::Key::Control_R) && app.sidebar.set_hints(false) {
            app.render(Dirty { sidebar: true, ..Dirty::default() });
        }
    });
    app.window.add_controller(keys);
    let focus = gtk::EventControllerFocus::new();
    let weak = Rc::downgrade(app);
    focus.connect_leave(move |_| {
        if let Some(app) = weak.upgrade() {
            if app.sidebar.set_hints(false) {
                app.render(Dirty { sidebar: true, ..Dirty::default() });
            }
        }
    });
    app.window.add_controller(focus);
}

pub fn apply_keybindings(app: &App) {
    let bindings = app.state.borrow().keybindings.clone();
    for binding in &bindings {
        let action = BINDINGS.iter().find(|(command, _)| *command == binding.command).map(|(_, action)| *action);
        let jump = binding.command.strip_prefix("thread.jump.").map(|index| format!("win.thread-jump({index})"));
        let Some(action) = action.map(str::to_string).or(jump) else { continue };
        let accel = binding.shortcut.as_deref().map(crate::format::accelerator);
        let accels: Vec<&str> = accel.iter().map(String::as_str).collect();
        app.application.set_accels_for_action(&action, &accels);
    }
}

pub fn bulk_menu() -> gio::Menu {
    let menu = gio::Menu::new();
    for (label, action) in [
        ("Mark Unread", "win.bulk-unread"),
        ("Unpin", "win.bulk-unpin"),
        ("Settle", "win.bulk-settle"),
        ("Archive", "win.bulk-archive"),
        ("Delete…", "win.bulk-delete"),
    ] {
        menu.append(Some(label), Some(action));
    }
    menu
}

fn bulk(app: &Rc<App>, call: fn(&local_studio_core::Studio, String)) {
    let marked = app.sidebar.marked();
    for id in marked {
        app.core.run(|studio| call(studio, id));
    }
    app.sidebar.clear_marks();
    app.render(Dirty { sidebar: true, ..Dirty::default() });
}

fn bulk_delete(app: &Rc<App>) {
    let count = app.sidebar.marked().len();
    let dialog = adw::AlertDialog::new(
        Some(&format!("Delete {count} Threads?")),
        Some("Their history will be deleted permanently."),
    );
    dialog.add_responses(&[("cancel", "Cancel"), ("delete", "Delete")]);
    dialog.set_response_appearance("delete", adw::ResponseAppearance::Destructive);
    dialog.set_close_response("cancel");
    let weak = Rc::downgrade(app);
    dialog.connect_response(Some("delete"), move |_, _| {
        if let Some(app) = weak.upgrade() {
            bulk(&app, local_studio_core::Studio::delete_thread);
        }
    });
    dialog.present(Some(&app.window));
}

fn current(app: &Rc<App>, action: &str) {
    let selected = app.state.borrow().selected.clone();
    if let Some(selected) = selected {
        WidgetExt::activate_action(&app.window, action, Some(&selected.to_variant())).ok();
    }
}

fn step(app: &Rc<App>, delta: isize) {
    let order = app.sidebar.visible_threads();
    let selected = app.state.borrow().selected.clone();
    let index = selected.and_then(|selected| order.iter().position(|id| *id == selected));
    let next = match index {
        Some(index) => index.checked_add_signed(delta),
        None => Some(0),
    };
    if let Some(thread) = next.and_then(|next| order.get(next)) {
        app.select_thread(Some(thread.clone()));
    }
}

fn pinned_order(app: &App) -> Vec<String> {
    app.state.borrow().threads.iter().filter(|row| row.shelf == Shelf::Pinned).map(|row| row.id.clone()).collect()
}

pub fn move_pinned(app: &Rc<App>, dragged: &str, target: &str) {
    let mut order = pinned_order(app);
    let Some(from) = order.iter().position(|id| id == dragged) else { return };
    let moved = order.remove(from);
    let to = order.iter().position(|id| id == target).map_or(order.len(), |index| index + usize::from(from <= index));
    order.insert(to.min(order.len()), moved);
    app.core.run(|studio| studio.reorder_pinned(order));
}

fn move_by(app: &Rc<App>, id: &str, delta: isize) {
    let mut order = pinned_order(app);
    let Some(from) = order.iter().position(|known| known == id) else { return };
    let Some(to) = from.checked_add_signed(delta).filter(|to| *to < order.len()) else { return };
    order.swap(from, to);
    app.core.run(|studio| studio.reorder_pinned(order));
}

fn git(app: &Rc<App>, progress: &str, call: fn(&local_studio_core::Studio, String, String)) {
    let Some(dir) = app.state.borrow().workspace_dir() else { return };
    let request = app.core.request();
    app.toast(progress);
    app.core.run(|studio| call(studio, request, dir));
}

fn publish(app: &Rc<App>) {
    let (dir, name) = {
        let state = app.state.borrow();
        let dir = state.workspace_dir();
        let name = dir.as_deref().map(crate::state::short_path).unwrap_or_default();
        (dir, name)
    };
    let Some(dir) = dir else { return };
    let dialog =
        adw::AlertDialog::new(Some("Publish Repository"), Some("Creates a GitHub repository and pushes this branch."));
    let fields = gtk::Box::new(gtk::Orientation::Vertical, 8);
    let entry = gtk::Entry::builder().text(&name).placeholder_text("Repository name").activates_default(true).build();
    let private = gtk::CheckButton::with_label("Private repository");
    private.set_active(true);
    fields.append(&entry);
    fields.append(&private);
    dialog.set_extra_child(Some(&fields));
    dialog.add_responses(&[("cancel", "Cancel"), ("publish", "Publish")]);
    dialog.set_response_appearance("publish", adw::ResponseAppearance::Suggested);
    dialog.set_default_response(Some("publish"));
    dialog.set_close_response("cancel");
    let weak = Rc::downgrade(app);
    dialog.connect_response(Some("publish"), move |_, _| {
        let Some(app) = weak.upgrade() else { return };
        let name = entry.text().trim().to_string();
        if name.is_empty() {
            return;
        }
        let (request, dir, private) = (app.core.request(), dir.clone(), private.is_active());
        app.toast("Publishing repository…");
        app.core.run(|studio| studio.publish_repository(request, dir, name, private));
    });
    dialog.present(Some(&app.window));
}

pub fn record_shortcut(app: &Rc<App>, command: String, title: &str) {
    let dialog = adw::AlertDialog::new(Some("Press a Shortcut"), Some(&crate::format::escape(title)));
    let label = gtk::Label::new(Some("Waiting for keys… (Esc cancels)"));
    label.add_css_class("ls-pill");
    label.add_css_class("ls-mono");
    dialog.set_extra_child(Some(&label));
    dialog.add_responses(&[("cancel", "Cancel")]);
    dialog.set_close_response("cancel");
    let keys = gtk::EventControllerKey::new();
    keys.set_propagation_phase(gtk::PropagationPhase::Capture);
    let weak = Rc::downgrade(app);
    let recording = dialog.clone();
    keys.connect_key_pressed(move |_, key, _, modifiers| {
        if key == gdk::Key::Escape {
            recording.close();
            return glib::Propagation::Stop;
        }
        let Some(binding) = binding_for(key, modifiers) else { return glib::Propagation::Stop };
        if let Some(app) = weak.upgrade() {
            let command = command.clone();
            app.core.run(|studio| studio.set_keybinding(command, Some(binding)));
        }
        recording.close();
        glib::Propagation::Stop
    });
    dialog.add_controller(keys);
    dialog.present(Some(&app.window));
}

fn binding_for(key: gdk::Key, modifiers: gdk::ModifierType) -> Option<String> {
    let name = key.to_lower().name()?.to_string();
    if name.contains("Control")
        || name.contains("Shift")
        || name.contains("Alt")
        || name.contains("Super")
        || name.contains("Meta")
    {
        return None;
    }
    let key = match name.as_str() {
        "Return" | "KP_Enter" => "return".to_string(),
        "Up" | "Down" | "Left" | "Right" | "Escape" | "Tab" | "Delete" => name.to_lowercase(),
        "space" => "space".to_string(),
        "bracketleft" => "[".to_string(),
        "bracketright" => "]".to_string(),
        "equal" => "=".to_string(),
        "minus" => "-".to_string(),
        "comma" => ",".to_string(),
        "period" => ".".to_string(),
        "slash" => "/".to_string(),
        "plus" => "+".to_string(),
        other => other.to_lowercase(),
    };
    let mut parts = Vec::new();
    if modifiers.contains(gdk::ModifierType::CONTROL_MASK) {
        parts.push("cmd");
    }
    if modifiers.contains(gdk::ModifierType::SUPER_MASK) {
        parts.push("ctrl");
    }
    if modifiers.contains(gdk::ModifierType::ALT_MASK) {
        parts.push("option");
    }
    if modifiers.contains(gdk::ModifierType::SHIFT_MASK) {
        parts.push("shift");
    }
    if parts.is_empty() {
        return None;
    }
    Some(format!("{}+{key}", parts.join("+")))
}
