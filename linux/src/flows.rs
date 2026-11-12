use std::path::PathBuf;
use std::rc::{Rc, Weak};

use adw::prelude::*;
use gtk::{gdk, gio, glib};
use local_studio_core::{Branch, MergeMethod};

use crate::app::App;
use crate::format;
use crate::icons;

type AppAction = fn(&Rc<App>);
type StringAction = fn(&Rc<App>, String);

pub fn install(app: &Rc<App>) {
    let plain: [(&str, AppAction); 5] = [
        ("clone-project", clone_project),
        ("provider-settings", |app| app.open_settings(Some("providers"))),
        ("install-kernel", |app| app.core.run(local_studio_core::Studio::install_kernel)),
        ("restart-daemon", restart_daemon),
        ("cleanup-worktrees", |app| {
            let request = app.core.request();
            app.toast("Cleaning up worktrees…");
            app.core.run(|studio| studio.cleanup_worktrees(request));
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
    let strings: [(&str, StringAction); 7] = [
        ("settings-page", |app, page| app.open_settings(Some(&page))),
        ("pr-checkout", |app, number| {
            let dir = app.state.borrow().workspace_dir();
            if let (Some(dir), Ok(number)) = (dir, number.parse::<u64>()) {
                checkout_pull_request(app, &dir, number);
            }
        }),
        ("pr-merge", |app, number| {
            let dir = app.state.borrow().workspace_dir();
            if let (Some(dir), Ok(number)) = (dir, number.parse::<u64>()) {
                merge_pull_request(app, &dir, number);
            }
        }),
        ("thread-restart", |app, id| {
            app.toast("Restarting the agent session…");
            app.core.run(|studio| studio.restart_thread(id));
        }),
        ("thread-snooze-custom", snooze_custom),
        ("thread-new-on-branch", |app, id| new_on_branch(app, &id)),
        ("new-thread-in", |app, project| app.new_thread(Some(project).filter(|project| !project.is_empty()))),
    ];
    for (name, activate) in strings {
        let action = gio::SimpleAction::new(name, Some(glib::VariantTy::STRING));
        let weak = Rc::downgrade(app);
        action.connect_activate(move |_, parameter| {
            if let (Some(app), Some(value)) = (weak.upgrade(), parameter.and_then(glib::Variant::get::<String>)) {
                activate(&app, value);
            }
        });
        app.window.add_action(&action);
    }
}

fn restart_daemon(app: &Rc<App>) {
    let busy = app
        .state
        .borrow()
        .daemon
        .as_ref()
        .and_then(|daemon| daemon.mismatch.as_ref())
        .map_or(0, |mismatch| mismatch.busy_sessions);
    if busy == 0 {
        app.core.run(|studio| studio.restart_daemon(false));
        return;
    }
    let dialog = adw::AlertDialog::new(
        Some("Restart the Eukhe Daemon?"),
        Some(&format!(
            "{busy} Eukhe sessions are running. Restarting stops their runs; their threads stay saved and reopen on the new daemon."
        )),
    );
    dialog.add_responses(&[("cancel", "Cancel"), ("restart", "Restart")]);
    dialog.set_response_appearance("restart", adw::ResponseAppearance::Destructive);
    dialog.set_close_response("cancel");
    let weak = Rc::downgrade(app);
    dialog.connect_response(Some("restart"), move |_, _| {
        if let Some(app) = weak.upgrade() {
            app.core.run(|studio| studio.restart_daemon(true));
        }
    });
    dialog.present(Some(&app.window));
}

pub fn new_thread_in_on_shift(app: &Weak<App>, button: &gtk::Button) {
    let click = gtk::GestureClick::builder().button(1).propagation_phase(gtk::PropagationPhase::Capture).build();
    let (weak, anchor) = (app.clone(), button.downgrade());
    click.connect_pressed(move |gesture, _, _, _| {
        if !gesture.current_event_state().contains(gdk::ModifierType::SHIFT_MASK) {
            return;
        }
        let (Some(app), Some(anchor)) = (weak.upgrade(), anchor.upgrade()) else { return };
        gesture.set_state(gtk::EventSequenceState::Claimed);
        let menu = gio::Menu::new();
        for project in &app.state.borrow().projects {
            let item = gio::MenuItem::new(Some(&project.name), None);
            item.set_action_and_target_value(Some("win.new-thread-in"), Some(&project.id.to_variant()));
            menu.append_item(&item);
        }
        let none = gio::MenuItem::new(Some("Without a Project"), None);
        none.set_action_and_target_value(Some("win.new-thread-in"), Some(&String::new().to_variant()));
        let tail = gio::Menu::new();
        tail.append_item(&none);
        menu.append_section(None, &tail);
        let popover = gtk::PopoverMenu::from_model(Some(&menu));
        popover.set_parent(&anchor);
        popover.set_has_arrow(false);
        popover.connect_closed(|popover| {
            let popover = popover.clone();
            glib::idle_add_local_once(move || popover.unparent());
        });
        popover.popup();
    });
    button.add_controller(click);
}

fn clone_project(app: &Rc<App>) {
    let dialog = adw::AlertDialog::new(
        Some("Clone Repository"),
        Some("A GitHub owner/name, or any git URL. The clone is added as a project."),
    );
    let fields = adw::PreferencesGroup::new();
    let url = adw::EntryRow::builder().title("Repository").build();
    let base = app.state.borrow().settings.add_project_base_directory.clone();
    let parent = if base.is_empty() { glib::home_dir().join("code") } else { PathBuf::from(base) };
    let folder = adw::ActionRow::builder()
        .title("Clone into")
        .subtitle(format::escape(&parent.to_string_lossy()))
        .activatable(true)
        .build();
    folder.add_suffix(&icons::image(icons::FOLDER_OPEN));
    let chosen = Rc::new(std::cell::RefCell::new(parent));
    let (weak, row, picked) = (Rc::downgrade(app), folder.clone(), Rc::clone(&chosen));
    folder.connect_activated(move |_| {
        let Some(app) = weak.upgrade() else { return };
        let chooser = gtk::FileDialog::builder().title("Clone Into").modal(true).build();
        chooser.set_initial_folder(Some(&gio::File::for_path(&*picked.borrow())));
        let (row, picked) = (row.clone(), Rc::clone(&picked));
        chooser.select_folder(Some(&app.window), None::<&gio::Cancellable>, move |result| {
            if let Some(path) = result.ok().and_then(|file| file.path()) {
                row.set_subtitle(&format::escape(&path.to_string_lossy()));
                picked.replace(path);
            }
        });
    });
    fields.add(&url);
    fields.add(&folder);
    dialog.set_extra_child(Some(&fields));
    dialog.add_responses(&[("cancel", "Cancel"), ("clone", "Clone")]);
    dialog.set_response_appearance("clone", adw::ResponseAppearance::Suggested);
    dialog.set_default_response(Some("clone"));
    dialog.set_close_response("cancel");
    let weak = Rc::downgrade(app);
    dialog.connect_response(Some("clone"), move |_, _| {
        let Some(app) = weak.upgrade() else { return };
        let repository = url.text().trim().to_string();
        if repository.is_empty() {
            return;
        }
        let (request, parent) = (app.core.request(), chosen.borrow().to_string_lossy().into_owned());
        app.toast("Cloning…");
        app.core.run(|studio| studio.clone_project(request, repository, parent));
    });
    dialog.present(Some(&app.window));
}

fn snooze_custom(app: &Rc<App>, id: String) {
    let dialog = adw::AlertDialog::new(Some("Snooze Until"), Some("The thread returns to Active at this time."));
    let calendar = gtk::Calendar::new();
    let now = glib::DateTime::now_local().ok();
    let hour = gtk::SpinButton::with_range(0.0, 23.0, 1.0);
    let minute = gtk::SpinButton::with_range(0.0, 59.0, 5.0);
    hour.set_value(9.0);
    minute.set_value(0.0);
    if let Some(tomorrow) = now.as_ref().and_then(|now| now.add_days(1).ok()) {
        calendar.set_year(tomorrow.year());
        calendar.set_month(tomorrow.month() - 1);
        calendar.set_day(tomorrow.day_of_month());
    }
    let time = gtk::Box::new(gtk::Orientation::Horizontal, 6);
    time.set_halign(gtk::Align::Center);
    time.append(&gtk::Label::new(Some("At")));
    time.append(&hour);
    time.append(&gtk::Label::new(Some(":")));
    time.append(&minute);
    let column = gtk::Box::new(gtk::Orientation::Vertical, 10);
    column.append(&calendar);
    column.append(&time);
    dialog.set_extra_child(Some(&column));
    dialog.add_responses(&[("cancel", "Cancel"), ("snooze", "Snooze")]);
    dialog.set_response_appearance("snooze", adw::ResponseAppearance::Suggested);
    dialog.set_default_response(Some("snooze"));
    dialog.set_close_response("cancel");
    let weak = Rc::downgrade(app);
    dialog.connect_response(Some("snooze"), move |_, _| {
        let Some(app) = weak.upgrade() else { return };
        let day = calendar.date();
        let Ok(at) = glib::DateTime::from_local(
            day.year(),
            day.month(),
            day.day_of_month(),
            hour.value_as_int(),
            minute.value_as_int(),
            0.0,
        ) else {
            return;
        };
        let until = at.to_unix() * 1000;
        if until <= format::now_ms() {
            app.toast("Pick a time in the future.");
            return;
        }
        let id = id.clone();
        app.core.run(|studio| studio.snooze(id, Some(until)));
        app.toast(&format!(
            "Snoozed until {}",
            at.format("%a %e %b, %H:%M").map(|text| text.to_string()).unwrap_or_default()
        ));
    });
    dialog.present(Some(&app.window));
}

fn new_on_branch(app: &Rc<App>, id: &str) {
    let row = app.state.borrow().row(id).cloned();
    let Some(row) = row else { return };
    let Some(branch) = row.branch.clone() else {
        app.toast("This thread has no branch.");
        return;
    };
    app.new_thread(row.project.clone());
    let worktree = row.worktree.clone();
    app.branches.preset(
        worktree.is_some(),
        Some(Branch { name: branch, remote: false, current: worktree.is_none(), worktree }),
    );
    let state = app.state.borrow();
    app.branches.render(&state);
}

fn checkout_pull_request(app: &Rc<App>, project: &str, number: u64) {
    let (request, project) = (app.core.request(), project.to_string());
    app.toast(&format!("Checking out #{number} into a worktree…"));
    app.core.run(|studio| studio.checkout_pull_request(request, project, number));
}

fn merge_pull_request(app: &Rc<App>, project: &str, number: u64) {
    let dialog = adw::AlertDialog::new(
        Some(&format!("Merge #{number}?")),
        Some("The pull request is merged on the forge with the method you pick."),
    );
    let methods = ["Repository default", "Merge commit", "Squash", "Rebase"];
    let default = app.state.borrow().settings.merge_method;
    let method = gtk::DropDown::from_strings(&methods);
    method.set_selected(match default {
        MergeMethod::RepositoryDefault => 0,
        MergeMethod::Merge => 1,
        MergeMethod::Squash => 2,
        MergeMethod::Rebase => 3,
    });
    dialog.set_extra_child(Some(&method));
    dialog.add_responses(&[("cancel", "Cancel"), ("merge", "Merge")]);
    dialog.set_response_appearance("merge", adw::ResponseAppearance::Suggested);
    dialog.set_close_response("cancel");
    let (weak, project) = (Rc::downgrade(app), project.to_string());
    dialog.connect_response(Some("merge"), move |_, _| {
        let Some(app) = weak.upgrade() else { return };
        let chosen = match method.selected() {
            1 => MergeMethod::Merge,
            2 => MergeMethod::Squash,
            3 => MergeMethod::Rebase,
            _ => MergeMethod::RepositoryDefault,
        };
        let (request, project) = (app.core.request(), project.clone());
        app.toast(&format!("Merging #{number}…"));
        app.core.run(|studio| studio.merge_pull_request(request, project, number, Some(chosen)));
    });
    dialog.present(Some(&app.window));
}
