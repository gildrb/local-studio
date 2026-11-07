use std::rc::Rc;

use adw::prelude::*;
use gtk::{gio, glib, graphene};
use local_studio_core::UsagePeriod;

use crate::app::App;
use crate::state::Page;

type AppAction = fn(&Rc<App>);

const BINDINGS: [(&str, &str); 35] = [
    ("sidebar.toggle", "win.toggle-sidebar"),
    ("navigation.back", "win.nav-back"),
    ("navigation.forward", "win.nav-forward"),
    ("terminal.toggle", "win.toggle-terminal"),
    ("rightPanel.toggle", "win.toggle-panel"),
    ("rightPanel.close", "win.close-tab"),
    ("diff.toggle", "win.toggle-diff"),
    ("preview.toggle", "win.preview-toggle"),
    ("commandPalette.toggle", "win.palette"),
    ("filePicker.toggle", "win.go-to-file"),
    ("projectSearch.toggle", "win.project-search"),
    ("usage.open", "win.usage"),
    ("theme.select", "win.theme-select"),
    ("appearance.cycle", "win.appearance-cycle"),
    ("themeEditor.toggle", "win.theme-editor"),
    ("composer.stash", "win.stash"),
    ("thread.steerQueuedMessage", "win.steer-queued"),
    ("chat.new", "win.new-thread"),
    ("chat.newLocal", "win.new-thread-local"),
    ("chat.newWithoutProject", "win.new-thread-without-project"),
    ("modelPicker.toggle", "win.model-picker"),
    ("composer.effort", "win.composer-effort"),
    ("composer.mode", "win.composer-mode"),
    ("composer.workspace", "win.composer-workspace"),
    ("composer.branch", "win.composer-branch"),
    ("pullRequest.copyNumber", "win.pr-copy-number"),
    ("editor.openFavorite", "win.open-editor"),
    ("thread.previous", "win.thread-previous"),
    ("thread.next", "win.thread-next"),
    ("thread.copyReference", "win.thread-copy-reference"),
    ("thread.settle", "win.current-settle"),
    ("thread.pin", "win.current-pin"),
    ("thread.undo", "win.undo"),
    ("snapshot.capture", "win.snapshot-capture"),
    ("composer.previousWorktree", "win.composer-workspace"),
];

pub fn apply(app: &App) {
    let bindings = app.state.borrow().keybindings.clone();
    for binding in &bindings {
        let action = BINDINGS
            .iter()
            .find(|(command, _)| *command == binding.command)
            .map(|(_, action)| (*action).to_string())
            .or_else(|| binding.command.strip_prefix("thread.jump.").map(|index| format!("win.thread-jump({index})")))
            .or_else(|| {
                binding.command.strip_prefix("usage.period.").and_then(|period| {
                    ["day", "week", "month", "quarter"]
                        .iter()
                        .position(|known| *known == period)
                        .map(|index| format!("win.usage-period({index})"))
                })
            });
        let Some(action) = action else { continue };
        let accel = binding.shortcut.as_deref().map(crate::format::accelerator);
        let accels: Vec<&str> = accel.iter().map(String::as_str).collect();
        app.application.set_accels_for_action(&action, &accels);
    }
}

pub fn install(app: &Rc<App>) {
    let plain: [(&str, AppAction); 15] = [
        ("nav-back", |app| app.navigate(-1)),
        ("nav-forward", |app| app.navigate(1)),
        ("preview-toggle", |app| app.panel.toggle("browser")),
        ("theme-select", |app| app.open_settings(Some("appearance"))),
        ("stash", |app| app.composer.tools.stash_current(app)),
        ("steer-queued", steer_queued),
        ("new-thread-local", |app| {
            let project = app.state.borrow().current_project();
            app.new_thread(project);
        }),
        ("model-picker", |app| app.composer.open_picker("model")),
        ("composer-effort", |app| app.composer.open_picker("thinking")),
        ("composer-mode", |app| app.composer.open_picker("access")),
        ("composer-workspace", |app| app.branches.open_mode()),
        ("composer-branch", |app| app.branches.open_branch()),
        ("pr-copy-number", |app| {
            let pull = pull_request(app);
            match pull {
                Some((number, _)) => {
                    app.window.clipboard().set_text(&format!("#{number}"));
                    app.toast(&format!("Copied #{number}"));
                }
                None => app.toast("This branch has no pull request."),
            }
        }),
        ("thread-copy-reference", |app| {
            let reference = pull_request(app).map(|(_, url)| url).or_else(|| app.state.borrow().selected.clone());
            if let Some(reference) = reference {
                app.window.clipboard().set_text(&reference);
                app.toast(&format!("Copied {reference}"));
            }
        }),
        ("snapshot-capture", snapshot),
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
    let period = gio::SimpleAction::new("usage-period", Some(glib::VariantTy::INT32));
    let weak = Rc::downgrade(app);
    period.connect_activate(move |_, parameter| {
        let (Some(app), Some(index)) = (weak.upgrade(), parameter.and_then(glib::Variant::get::<i32>)) else { return };
        if app.state.borrow().page != Page::Usage {
            return;
        }
        let period = match index {
            0 => UsagePeriod::Day,
            2 => UsagePeriod::Month,
            3 => UsagePeriod::Quarter,
            _ => UsagePeriod::Week,
        };
        app.usage.set_period(&app, period);
    });
    app.window.add_action(&period);
    for (action, accel) in [
        ("win.nav-back", "<Control>bracketleft"),
        ("win.nav-forward", "<Control>bracketright"),
        ("win.preview-toggle", "<Control><Shift>j"),
        ("win.theme-select", "<Control><Alt>a"),
        ("win.stash", "<Control>s"),
        ("win.steer-queued", "<Control><Shift>Return"),
        ("win.new-thread-local", "<Control><Shift>n"),
        ("win.model-picker", "<Control><Shift>m"),
        ("win.composer-effort", "<Control><Shift>e"),
        ("win.composer-mode", "<Control><Shift>a"),
        ("win.composer-workspace", "<Control><Shift>x"),
        ("win.composer-branch", "<Control><Shift>g"),
        ("win.pr-copy-number", "<Control><Shift>k"),
        ("win.thread-copy-reference", "<Control><Shift>c"),
        ("win.snapshot-capture", "<Control><Alt><Shift>s"),
        ("win.usage-period(0)", "<Control><Shift>1"),
        ("win.usage-period(1)", "<Control><Shift>2"),
        ("win.usage-period(2)", "<Control><Shift>3"),
        ("win.usage-period(3)", "<Control><Shift>4"),
    ] {
        app.application.set_accels_for_action(action, &[accel]);
    }
}

fn pull_request(app: &App) -> Option<(u64, String)> {
    let state = app.state.borrow();
    let dir = state.workspace_dir()?;
    state.git.get(&dir).and_then(|status| status.pull_request.as_ref()).map(|pull| (pull.number, pull.url.clone()))
}

fn steer_queued(app: &Rc<App>) {
    let (thread, queued) = {
        let state = app.state.borrow();
        let queued =
            state.queue.iter().find(|queued| !queued.steering && !queued.sending).map(|queued| queued.id.clone());
        (state.selected.clone(), queued)
    };
    match (thread, queued) {
        (Some(thread), Some(queued)) => app.core.run(|studio| studio.send_queued_now(thread, queued)),
        _ => app.composer.submit_steer(app),
    }
}

fn snapshot(app: &Rc<App>) {
    let settings = app.state.borrow().settings.clone();
    if !settings.snapshot_enabled {
        app.toast("Turn on SnapShots in Settings → Appearance to capture the window.");
        return;
    }
    let window = &app.window;
    let (width, height) = (window.width(), window.height());
    let paintable = gtk::WidgetPaintable::new(Some(window));
    let snapshot = gtk::Snapshot::new();
    paintable.snapshot(&snapshot, f64::from(width), f64::from(height));
    let (Some(node), Some(renderer)) = (snapshot.to_node(), window.renderer()) else { return };
    #[allow(clippy::cast_precision_loss)]
    let texture = renderer.render_texture(&node, Some(&graphene::Rect::new(0.0, 0.0, width as f32, height as f32)));
    app.composer.extras.attach_texture(&texture);
    if settings.snapshot_include_text {
        let text = app.timeline.visible_text();
        if !text.trim().is_empty() {
            app.composer.extras.add_context("SnapShot text", &text);
        }
    }
    if settings.snapshot_play_sound {
        crate::sound::play(crate::sound::Sound::Completion);
    }
    if settings.snapshot_flash {
        app.window.add_css_class("ls-flash");
        let flashed = app.window.clone();
        glib::timeout_add_local_once(std::time::Duration::from_millis(160), move || {
            flashed.remove_css_class("ls-flash");
        });
    }
    app.toast("SnapShot attached to the composer");
}
