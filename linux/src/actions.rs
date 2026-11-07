use std::rc::Rc;

use adw::prelude::*;
use gtk::{gdk, gio, glib};
use local_studio_core::Shelf;

use crate::app::App;
use crate::format;
use crate::state::{Page, State};

const SNOOZES: [(&str, &str); 4] = [
    ("thread-snooze-hour", "For 1 hour"),
    ("thread-snooze-evening", "Until this evening"),
    ("thread-snooze-tomorrow", "Until tomorrow morning"),
    ("thread-snooze-week", "Until next week"),
];

type AppAction = fn(&Rc<App>);
type ThreadAction = fn(&Rc<App>, String);

pub fn install(app: &Rc<App>) {
    install_window(app);
    install_threads(app);
    install_global(app);
    crate::commands::install(app);
    crate::workbench::install(app);
    crate::bindings::install(app);
    crate::flows::install(app);
    add_string_action(app, "copy-text", |app, text| {
        app.window.clipboard().set_text(&text);
        app.toast("Copied");
    });
}

fn install_window(app: &Rc<App>) {
    let window = &app.window;
    let plain: [(&str, AppAction); 9] = [
        ("new-thread", |app| app.new_thread(None)),
        ("new-thread-without-project", |app| {
            app.new_thread(None);
            app.state.borrow_mut().draft_project = None;
            app.render(crate::app::Dirty::all());
        }),
        ("add-project", |app| app.add_project()),
        ("toggle-sidebar", |app| app.split.set_show_sidebar(!app.split.shows_sidebar())),
        ("settings", |app| app.open_settings(None)),
        ("usage", |app| app.open_page(Page::Usage)),
        ("local", |app| app.open_page(Page::Local)),
        ("toggle-terminal", |app| app.drawer.toggle(app)),
        ("toggle-diff", |app| app.panel.toggle("diff")),
    ];
    for (name, activate) in plain {
        let action = gio::SimpleAction::new(name, None);
        let weak = Rc::downgrade(app);
        action.connect_activate(move |_, _| {
            if let Some(app) = weak.upgrade() {
                activate(&app);
            }
        });
        window.add_action(&action);
    }
    let search = gio::SimpleAction::new("search", None);
    let weak = Rc::downgrade(app);
    search.connect_activate(move |_, _| {
        if let Some(app) = weak.upgrade() {
            app.split.set_show_sidebar(true);
            app.sidebar.focus_search();
        }
    });
    window.add_action(&search);
}

fn install_threads(app: &Rc<App>) {
    let threaded: [(&str, ThreadAction); 13] = [
        ("thread-open", |app, id| app.select_thread(Some(id))),
        ("thread-pin", |app, id| {
            let (pinned, confirm) = {
                let state = app.state.borrow();
                (state.row(&id).is_some_and(|row| row.pinned), state.settings.confirm_unpin)
            };
            if pinned && confirm {
                confirm_action(
                    app,
                    "Unpin Thread?",
                    "It moves back to the Active shelf.",
                    "Unpin",
                    false,
                    move |app| {
                        let id = id.clone();
                        app.core.run(|studio| studio.set_pinned(id, false));
                    },
                );
                return;
            }
            app.core.run(|studio| studio.set_pinned(id.clone(), !pinned));
            undoable(app, if pinned { "Thread unpinned" } else { "Thread pinned" }, move |app| {
                let id = id.clone();
                app.core.run(|studio| studio.set_pinned(id, pinned));
            });
        }),
        ("thread-settle", |app, id| {
            let settled = app.shelf_of(&id) == Some(Shelf::Settled);
            app.core.run(|studio| studio.set_settled(id.clone(), !settled));
            undoable(app, if settled { "Thread un-settled" } else { "Thread settled" }, move |app| {
                let id = id.clone();
                app.core.run(|studio| studio.set_settled(id, settled));
            });
        }),
        ("thread-wake", |app, id| app.core.run(|studio| studio.snooze(id, None))),
        ("thread-unread", |app, id| {
            let unread = app.state.borrow().row(&id).is_some_and(|row| row.unread);
            app.core.run(|studio| studio.mark_unread(id, !unread));
        }),
        ("thread-rename", rename),
        ("thread-archive", archive),
        ("thread-unarchive", |app, id| app.core.run(|studio| studio.set_archived(id, false))),
        ("thread-delete", delete),
        ("thread-fork", |app, id| app.core.run(|studio| studio.fork_thread(id))),
        ("thread-compact", |app, id| app.core.run(|studio| studio.compact(id))),
        ("thread-copy-id", |app, id| app.window.clipboard().set_text(&id)),
        ("thread-filter", |app, id| {
            let project = app.state.borrow().row(&id).and_then(|row| row.project.clone());
            let mut state = app.state.borrow_mut();
            state.filter = if state.filter == project { None } else { project };
            drop(state);
            app.render(crate::app::Dirty { sidebar: true, ..crate::app::Dirty::default() });
        }),
    ];
    for (name, activate) in threaded {
        add_string_action(app, name, activate);
    }
    for (index, (name, _)) in SNOOZES.iter().enumerate() {
        add_string_action(app, name, move |app, id| {
            let until = snooze_until(index);
            app.core.run(|studio| studio.snooze(id.clone(), Some(until)));
            undoable(app, "Thread snoozed", move |app| {
                let id = id.clone();
                app.core.run(|studio| studio.snooze(id, None));
            });
        });
    }
    add_string_action(app, "project-filter", |app, project| {
        app.state.borrow_mut().filter = Some(project).filter(|project| !project.is_empty());
        app.render(crate::app::Dirty { sidebar: true, ..crate::app::Dirty::default() });
    });
    add_string_action(app, "project-new-thread", |app, project| app.new_thread(Some(project)));
    add_string_action(app, "project-remove", |app, project| app.core.run(|studio| studio.remove_project(project)));
}

fn install_global(app: &Rc<App>) {
    let extra: [(&str, AppAction); 5] = [
        ("git-commit", crate::commit::present),
        ("git-push", |app| git_request(app, "Pushing…", local_studio_core::Studio::push)),
        ("git-pr", create_pull_request),
        ("git-view-pr", view_pull_request),
        ("palette", crate::palette::open),
    ];
    for (name, activate) in extra {
        let action = gio::SimpleAction::new(name, None);
        let weak = Rc::downgrade(app);
        action.connect_activate(move |_, _| {
            if let Some(app) = weak.upgrade() {
                activate(&app);
            }
        });
        app.window.add_action(&action);
    }
    let open = gio::SimpleAction::new("open-thread", Some(glib::VariantTy::STRING));
    let weak = Rc::downgrade(app);
    open.connect_activate(move |_, parameter| {
        let (Some(app), Some(id)) = (weak.upgrade(), parameter.and_then(glib::Variant::get::<String>)) else {
            return;
        };
        app.window.present();
        app.select_thread(Some(id));
    });
    app.application.add_action(&open);

    for (action, accels) in [
        ("win.new-thread", &["<Control>n"][..]),
        ("win.new-thread-without-project", &["<Control><Alt>n"][..]),
        ("win.toggle-sidebar", &["<Control>b"][..]),
        ("win.settings", &["<Control>comma"][..]),
        ("win.usage", &["<Control>u"][..]),
        ("win.toggle-terminal", &["<Control>j"][..]),
        ("win.toggle-diff", &["<Control>d"][..]),
        ("win.search", &["<Control>f"][..]),
        ("win.palette", &["<Control>k"][..]),
    ] {
        app.application.set_accels_for_action(action, accels);
    }
}

fn git_request(app: &Rc<App>, progress: &str, call: fn(&local_studio_core::Studio, String, String)) {
    let Some(dir) = app.state.borrow().workspace_dir() else { return };
    let request = app.core.request();
    app.toast(progress);
    app.core.run(|studio| call(studio, request, dir));
}

fn create_pull_request(app: &Rc<App>) {
    let (dir, title) = {
        let state = app.state.borrow();
        let title = state.info.as_ref().map(|info| info.title.clone()).unwrap_or_default();
        (state.workspace_dir(), title)
    };
    let Some(dir) = dir else { return };
    let dialog = adw::AlertDialog::new(Some("Create Pull Request"), Some("The branch is pushed first when needed."));
    let fields = gtk::Box::new(gtk::Orientation::Vertical, 8);
    let entry = gtk::Entry::builder().text(&title).placeholder_text("Title").activates_default(true).build();
    let draft = gtk::CheckButton::with_label("Open as draft");
    fields.append(&entry);
    fields.append(&draft);
    dialog.set_extra_child(Some(&fields));
    dialog.add_responses(&[("cancel", "Cancel"), ("create", "Create")]);
    dialog.set_response_appearance("create", adw::ResponseAppearance::Suggested);
    dialog.set_default_response(Some("create"));
    dialog.set_close_response("cancel");
    let weak = Rc::downgrade(app);
    dialog.connect_response(Some("create"), move |_, _| {
        let Some(app) = weak.upgrade() else { return };
        let title = entry.text().trim().to_string();
        if title.is_empty() {
            return;
        }
        let (request, dir, draft) = (app.core.request(), dir.clone(), draft.is_active());
        app.toast("Creating pull request…");
        app.core.run(|studio| studio.create_pull_request(request, dir, title, String::new(), draft));
    });
    dialog.present(Some(&app.window));
}

fn view_pull_request(app: &Rc<App>) {
    let url = {
        let state = app.state.borrow();
        state.workspace_dir().and_then(|dir| {
            state.git.get(&dir).and_then(|status| status.pull_request.as_ref().map(|pull| pull.url.clone()))
        })
    };
    if let Some(url) = url {
        gtk::UriLauncher::new(&url).launch(Some(&app.window), None::<&gio::Cancellable>, |_| {});
    }
}

fn add_string_action(app: &Rc<App>, name: &str, activate: impl Fn(&Rc<App>, String) + 'static) {
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

pub fn thread_menu(state: &State, id: &str) -> gio::Menu {
    let row = state.row(id);
    let pinned = row.is_some_and(|row| row.pinned);
    let settled = row.is_some_and(|row| row.shelf == Shelf::Settled);
    let snoozed = row.is_some_and(|row| row.shelf == Shelf::Snoozed);
    let unread = row.is_some_and(|row| row.unread);
    let archived = row.is_some_and(|row| row.archived);
    let project = row.and_then(|row| row.project.clone());
    let filtering = project.is_some() && state.filter == project;
    let project_name = state.project_name(project.as_deref());
    let menu = gio::Menu::new();
    let target = id.to_variant();
    let item = |section: &gio::Menu, label: &str, action: &str| {
        let item = gio::MenuItem::new(Some(label), None);
        item.set_action_and_target_value(Some(&format!("win.{action}")), Some(&target));
        section.append_item(&item);
    };
    let first = gio::Menu::new();
    item(&first, if pinned { "Unpin Thread" } else { "Pin Thread" }, "thread-pin");
    item(&first, if settled { "Un-settle Thread" } else { "Settle Thread" }, "thread-settle");
    if snoozed {
        item(&first, "Wake Thread", "thread-wake");
    } else {
        let snooze = gio::Menu::new();
        for (action, label) in SNOOZES {
            item(&snooze, label, action);
        }
        item(&snooze, "Custom…", "thread-snooze-custom");
        first.append_submenu(Some("Snooze"), &snooze);
    }
    if pinned {
        item(&first, "Move Up", "thread-move-up");
        item(&first, "Move Down", "thread-move-down");
    }
    let auto = gio::Menu::new();
    let auto_settle = row.is_none_or(|row| row.auto_settle);
    item(&auto, if auto_settle { "Enabled ✓" } else { "Enabled" }, "thread-auto-settle-on");
    item(&auto, if auto_settle { "Disabled" } else { "Disabled ✓" }, "thread-auto-settle-off");
    first.append_submenu(Some("Auto-settle"), &auto);
    menu.append_section(None, &first);
    let second = gio::Menu::new();
    item(&second, "Rename Thread…", "thread-rename");
    item(&second, "Regenerate Title", "thread-regenerate-title");
    item(&second, if unread { "Mark as Read" } else { "Mark Unread" }, "thread-unread");
    item(&second, "Fork Thread", "thread-fork");
    if let Some(branch) = row.and_then(|row| row.branch.clone()) {
        item(&second, &format!("New Thread on {branch}"), "thread-new-on-branch");
    }
    item(&second, "Restart Agent Session", "thread-restart");
    if let Some(name) = project_name {
        item(
            &second,
            &if filtering { "Show All Projects".to_string() } else { format!("Filter by {name}") },
            "thread-filter",
        );
    }
    let copy = gio::Menu::new();
    item(&copy, "Thread ID", "thread-copy-id");
    if let Some(row) = row {
        let path = row.worktree.clone().or_else(|| row.project.clone());
        for (label, value) in [("Path", path), ("Branch", row.branch.clone())] {
            if let Some(value) = value {
                let entry = gio::MenuItem::new(Some(label), None);
                entry.set_action_and_target_value(Some("win.copy-text"), Some(&value.to_variant()));
                copy.append_item(&entry);
            }
        }
    }
    second.append_submenu(Some("Copy"), &copy);
    if let Some(project) = &project {
        let entry = gio::MenuItem::new(Some("Project Settings…"), None);
        entry.set_action_and_target_value(Some("win.project-settings"), Some(&project.to_variant()));
        second.append_item(&entry);
    }
    menu.append_section(None, &second);
    let third = gio::Menu::new();
    if archived {
        item(&third, "Unarchive Thread", "thread-unarchive");
    } else {
        item(&third, "Archive Thread", "thread-archive");
    }
    item(&third, "Delete Thread…", "thread-delete");
    menu.append_section(None, &third);
    menu
}

pub fn draft_menu(state: &State) -> gio::Menu {
    let menu = gio::Menu::new();
    let projects = gio::Menu::new();
    for project in &state.projects {
        let item = gio::MenuItem::new(Some(&project.name), None);
        item.set_action_and_target_value(Some("win.project-new-thread"), Some(&project.id.to_variant()));
        projects.append_item(&item);
    }
    menu.append_section(Some("Start in"), &projects);
    let other = gio::Menu::new();
    other.append(Some("No Project"), Some("win.new-thread-without-project"));
    other.append(Some("Add Project…"), Some("win.add-project"));
    menu.append_section(None, &other);
    menu
}

pub fn popup_menu(parent: &impl IsA<gtk::Widget>, model: &gio::Menu, x: f64, y: f64) {
    let popover = gtk::PopoverMenu::from_model(Some(model));
    popover.set_parent(parent);
    popover.set_has_arrow(false);
    popover.set_halign(gtk::Align::Start);
    #[allow(clippy::cast_possible_truncation)]
    popover.set_pointing_to(Some(&gdk::Rectangle::new(x as i32, y as i32, 1, 1)));
    popover.connect_closed(|popover| {
        let popover = popover.clone();
        glib::idle_add_local_once(move || popover.unparent());
    });
    popover.popup();
}

fn rename(app: &Rc<App>, id: String) {
    let title = app.state.borrow().row(&id).map(|row| row.title.clone()).unwrap_or_default();
    let dialog = adw::AlertDialog::new(Some("Rename Thread"), None);
    let entry = gtk::Entry::builder().text(&title).activates_default(true).build();
    dialog.set_extra_child(Some(&entry));
    dialog.add_responses(&[("cancel", "Cancel"), ("rename", "Rename")]);
    dialog.set_response_appearance("rename", adw::ResponseAppearance::Suggested);
    dialog.set_default_response(Some("rename"));
    dialog.set_close_response("cancel");
    let weak = Rc::downgrade(app);
    dialog.connect_response(None, move |_, response| {
        let Some(app) = weak.upgrade() else { return };
        let title = entry.text().trim().to_string();
        if response == "rename" && !title.is_empty() {
            let id = id.clone();
            app.core.run(|studio| studio.rename_thread(id, title));
        }
    });
    dialog.present(Some(&app.window));
}

fn archive(app: &Rc<App>, id: String) {
    let confirm = app.state.borrow().settings.confirm_archive;
    if !confirm {
        archive_now(app, id);
        return;
    }
    confirm_action(
        app,
        "Archive Thread?",
        "You can restore it from Settings → Archive.",
        "Archive",
        false,
        move |app| archive_now(app, id.clone()),
    );
}

fn archive_now(app: &Rc<App>, id: String) {
    app.core.run(|studio| studio.set_archived(id.clone(), true));
    undoable(app, "Thread archived", move |app| {
        let id = id.clone();
        app.core.run(|studio| studio.set_archived(id, false));
    });
}

pub fn undoable(app: &Rc<App>, text: &str, undo: impl Fn(&Rc<App>) + 'static) {
    let undo: crate::app::Hook = Rc::new(undo);
    app.undo.replace(Some(Rc::clone(&undo)));
    let toast = adw::Toast::builder().title(text).button_label("Undo").timeout(5).build();
    let weak = Rc::downgrade(app);
    toast.connect_button_clicked(move |_| {
        if let Some(app) = weak.upgrade() {
            app.undo.replace(None);
            undo(&app);
        }
    });
    app.toasts.add_toast(toast);
}

fn delete(app: &Rc<App>, id: String) {
    let confirm = app.state.borrow().settings.confirm_delete;
    if !confirm {
        app.core.run(|studio| studio.delete_thread(id));
        return;
    }
    let title = app.state.borrow().row(&id).map(|row| row.title.clone()).unwrap_or_default();
    confirm_action(
        app,
        "Delete Thread?",
        &format!("“{title}” and its history will be deleted permanently."),
        "Delete",
        true,
        move |app| {
            let id = id.clone();
            app.core.run(|studio| studio.delete_thread(id));
        },
    );
}

fn confirm_action(
    app: &Rc<App>,
    heading: &str,
    body: &str,
    verb: &str,
    destructive: bool,
    accept: impl Fn(&Rc<App>) + 'static,
) {
    let dialog = adw::AlertDialog::new(Some(heading), Some(&format::escape(body)));
    dialog.add_responses(&[("cancel", "Cancel"), ("accept", verb)]);
    dialog.set_response_appearance(
        "accept",
        if destructive { adw::ResponseAppearance::Destructive } else { adw::ResponseAppearance::Suggested },
    );
    dialog.set_close_response("cancel");
    let weak = Rc::downgrade(app);
    dialog.connect_response(Some("accept"), move |_, _| {
        if let Some(app) = weak.upgrade() {
            accept(&app);
        }
    });
    dialog.present(Some(&app.window));
}

fn snooze_until(preset: usize) -> i64 {
    let now = format::now_ms();
    let Ok(local) = glib::DateTime::now_local() else {
        return now + 3_600_000;
    };
    let at = |date: &glib::DateTime, hour: i32| {
        glib::DateTime::from_local(date.year(), date.month(), date.day_of_month(), hour, 0, 0.0)
            .map_or(now + 3_600_000, |time| time.to_unix() * 1000)
    };
    match preset {
        0 => now + 3_600_000,
        1 => {
            let evening = at(&local, 18);
            if evening > now + 600_000 {
                evening
            } else {
                now + 3 * 3_600_000
            }
        }
        2 => local.add_days(1).map_or(now + 86_400_000, |tomorrow| at(&tomorrow, 9)),
        _ => {
            let days = 8 - local.day_of_week();
            local.add_days(days).map_or(now + 7 * 86_400_000, |monday| at(&monday, 9))
        }
    }
}
