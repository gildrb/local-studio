use std::cell::RefCell;
use std::rc::Rc;

use adw::prelude::*;
use local_studio_core::{NewThreadWorkspace, Project, ProjectScript, ProjectSettings};

use crate::app::App;
use crate::format;

const ICONS: [&str; 12] = ["🧪", "🚀", "🛠", "📦", "🧠", "🌿", "🔥", "🎛", "🧩", "📊", "🖥", "🌙"];

struct Open {
    project: String,
    dialog: adw::PreferencesDialog,
    defaults: adw::PreferencesPage,
    scripts: adw::PreferencesPage,
    groups: RefCell<Vec<(adw::PreferencesPage, adw::PreferencesGroup)>>,
    shown: RefCell<Option<(ProjectSettings, Vec<ProjectScript>)>>,
}

thread_local! {
    static OPEN: RefCell<Option<Rc<Open>>> = const { RefCell::new(None) };
}

pub fn present(app: &Rc<App>, project: &str) {
    let Some(info) = app.state.borrow().project(project).cloned() else {
        app.toast("That project is no longer in Local Studio.");
        return;
    };
    let dialog = adw::PreferencesDialog::builder().title(format::escape(&info.name)).content_width(600).build();
    dialog.add(&identity_page(app, &info, &dialog));
    let defaults =
        adw::PreferencesPage::builder().name("defaults").title("Defaults").icon_name("emblem-system-symbolic").build();
    let scripts = adw::PreferencesPage::builder()
        .name("scripts")
        .title("Scripts")
        .icon_name("utilities-terminal-symbolic")
        .build();
    dialog.add(&defaults);
    dialog.add(&scripts);
    let open = Rc::new(Open {
        project: info.id.clone(),
        dialog: dialog.clone(),
        defaults,
        scripts,
        groups: RefCell::new(Vec::new()),
        shown: RefCell::new(None),
    });
    OPEN.with(|slot| slot.replace(Some(Rc::clone(&open))));
    dialog.connect_closed(|_| {
        OPEN.with(|slot| slot.replace(None));
    });
    let id = info.id.clone();
    app.core.run(|studio| studio.load_project_settings(id));
    rebuild(app, &open);
    dialog.present(Some(&app.window));
}

pub fn show_page(name: &str) {
    OPEN.with(|slot| {
        if let Some(open) = slot.borrow().as_ref() {
            open.dialog.set_visible_page_name(name);
        }
    });
}

pub fn refresh(app: &Rc<App>) {
    let open = OPEN.with(|slot| slot.borrow().clone());
    let Some(open) = open else { return };
    let current = current(app, &open.project);
    if open.shown.borrow().as_ref() != Some(&current) {
        rebuild(app, &open);
    }
}

fn current(app: &App, project: &str) -> (ProjectSettings, Vec<ProjectScript>) {
    let state = app.state.borrow();
    (
        state.project_settings.get(project).cloned().unwrap_or_default(),
        state.scripts.get(project).cloned().unwrap_or_default(),
    )
}

fn rebuild(app: &Rc<App>, open: &Rc<Open>) {
    for (page, group) in open.groups.borrow_mut().drain(..) {
        page.remove(&group);
    }
    let (settings, scripts) = current(app, &open.project);
    let groups = vec![
        (open.defaults.clone(), defaults_group(app, open, &settings)),
        (open.scripts.clone(), scripts_group(app, open, &scripts)),
    ];
    for (page, group) in &groups {
        page.add(group);
    }
    open.groups.replace(groups);
    open.shown.replace(Some((settings, scripts)));
}

#[allow(clippy::too_many_lines)]
fn identity_page(app: &Rc<App>, info: &Project, dialog: &adw::PreferencesDialog) -> adw::PreferencesPage {
    let page = adw::PreferencesPage::builder().title("Project").icon_name("folder-symbolic").build();
    let identity = adw::PreferencesGroup::builder().title("Project").build();
    let name = adw::EntryRow::builder().title("Name").text(&info.name).show_apply_button(true).build();
    let weak = Rc::downgrade(app);
    let id = info.id.clone();
    name.connect_apply(move |row| {
        let Some(app) = weak.upgrade() else { return };
        let (id, name) = (id.clone(), row.text().trim().to_string());
        if !name.is_empty() {
            app.core.run(|studio| studio.rename_project(id, name));
        }
    });
    identity.add(&name);
    let location = adw::ActionRow::builder()
        .title("Folder")
        .subtitle(format::escape(&info.path))
        .subtitle_selectable(true)
        .build();
    if !app.editors.list.is_empty() {
        let open =
            gtk::MenuButton::builder().label("Open").menu_model(&app.editors.menu()).valign(gtk::Align::Center).build();
        open.add_css_class("flat");
        location.add_suffix(&open);
    }
    identity.add(&location);
    identity.add(
        &adw::ActionRow::builder()
            .title("Source control")
            .subtitle(if info.is_git { "Git repository" } else { "Not a git repository" })
            .build(),
    );
    page.add(&identity);
    let icon_group = adw::PreferencesGroup::builder().title("Icon").description("Shown in the sidebar tiles").build();
    let icon = adw::EntryRow::builder()
        .title("Emoji or text")
        .text(info.icon.as_deref().unwrap_or_default())
        .show_apply_button(true)
        .build();
    let weak = Rc::downgrade(app);
    let id = info.id.clone();
    icon.connect_apply(move |row| {
        let Some(app) = weak.upgrade() else { return };
        let value = row.text().trim().to_string();
        let id = id.clone();
        app.core.run(|studio| studio.set_project_icon(id, Some(value).filter(|value| !value.is_empty())));
    });
    icon_group.add(&icon);
    let picks = gtk::FlowBox::builder()
        .selection_mode(gtk::SelectionMode::None)
        .min_children_per_line(6)
        .max_children_per_line(12)
        .homogeneous(true)
        .row_spacing(2)
        .column_spacing(2)
        .build();
    picks.set_margin_top(6);
    picks.set_margin_bottom(6);
    picks.set_margin_start(6);
    picks.set_margin_end(6);
    for emoji in ICONS {
        let button = gtk::Button::with_label(emoji);
        button.add_css_class("flat");
        button.add_css_class("ls-emoji");
        let (weak, id, field) = (Rc::downgrade(app), info.id.clone(), icon.clone());
        button.connect_clicked(move |_| {
            let Some(app) = weak.upgrade() else { return };
            field.set_text(emoji);
            let id = id.clone();
            app.core.run(|studio| studio.set_project_icon(id, Some(emoji.to_string())));
        });
        picks.append(&button);
    }
    let picks_row = adw::PreferencesRow::builder().activatable(false).child(&picks).build();
    icon_group.add(&picks_row);
    page.add(&icon_group);
    let threads =
        app.state.borrow().threads.iter().filter(|row| row.project.as_deref() == Some(info.id.as_str())).count();
    let danger = adw::PreferencesGroup::builder()
        .title("Remove")
        .description(format!(
            "{threads} threads belong to this project. Removing it keeps the folder and the thread history."
        ))
        .build();
    let remove = adw::ButtonRow::builder().title("Remove Project…").build();
    remove.add_css_class("destructive-action");
    let weak = Rc::downgrade(app);
    let (id, label, closing) = (info.id.clone(), info.name.clone(), dialog.clone());
    remove.connect_activated(move |_| {
        let Some(app) = weak.upgrade() else { return };
        let confirm = adw::AlertDialog::new(
            Some("Remove Project?"),
            Some(&format::escape(&format!("“{label}” leaves the sidebar. Its folder and threads are not deleted."))),
        );
        confirm.add_responses(&[("cancel", "Cancel"), ("remove", "Remove")]);
        confirm.set_response_appearance("remove", adw::ResponseAppearance::Destructive);
        confirm.set_close_response("cancel");
        let (weak, id, closing) = (Rc::downgrade(&app), id.clone(), closing.clone());
        confirm.connect_response(Some("remove"), move |_, _| {
            if let Some(app) = weak.upgrade() {
                let id = id.clone();
                app.core.run(|studio| studio.remove_project(id));
                closing.close();
            }
        });
        confirm.present(Some(&app.window));
    });
    danger.add(&remove);
    page.add(&danger);
    page
}

type Apply = Rc<dyn Fn(&mut ProjectSettings, u32)>;

#[allow(clippy::too_many_lines)]
fn defaults_group(app: &Rc<App>, open: &Rc<Open>, settings: &ProjectSettings) -> adw::PreferencesGroup {
    let group = adw::PreferencesGroup::builder()
        .title("Defaults for this project")
        .description(
            "Threads started in this project use these instead of Settings → General. Inherit keeps the global value.",
        )
        .build();
    let (global, models) = {
        let state = app.state.borrow();
        (state.settings.clone(), state.models.iter().filter(|model| model.configured).cloned().collect::<Vec<_>>())
    };
    let global_model = global
        .default_model
        .as_ref()
        .and_then(|id| models.iter().find(|model| &model.id == id).map(|model| model.name.clone()))
        .unwrap_or_else(|| "automatic".to_string());
    let mut model_names = vec![format!("Inherit ({global_model})")];
    model_names.extend(models.iter().map(|model| model.name.clone()));
    let model_index = settings
        .default_model
        .as_ref()
        .and_then(|id| {
            models.iter().position(|model| {
                &model.id == id && settings.default_provider.as_ref().is_none_or(|provider| provider == &model.provider)
            })
        })
        .map_or(0, |index| index + 1);
    let model_keys: Vec<(String, String)> =
        models.iter().map(|model| (model.provider.clone(), model.id.clone())).collect();
    let apply_model: Apply = Rc::new(move |settings, index| {
        let key =
            usize::try_from(index).ok().and_then(|index| index.checked_sub(1)).and_then(|index| model_keys.get(index));
        settings.default_provider = key.map(|(provider, _)| provider.clone());
        settings.default_model = key.map(|(_, model)| model.clone());
    });
    combo(app, open, &group, "Model", &model_names, model_index, &apply_model);
    let levels = ["off", "minimal", "low", "medium", "high", "xhigh"];
    let mut level_names = vec![format!(
        "Inherit ({})",
        global.default_thinking_level.clone().unwrap_or_else(|| "model default".to_string())
    )];
    level_names.extend(levels.iter().map(|level| format::capitalize(level)));
    let level_index = settings
        .default_thinking_level
        .as_ref()
        .and_then(|level| levels.iter().position(|known| known == level))
        .map_or(0, |index| index + 1);
    let apply_level: Apply = Rc::new(move |settings, index| {
        settings.default_thinking_level = usize::try_from(index)
            .ok()
            .and_then(|index| index.checked_sub(1))
            .and_then(|index| levels.get(index))
            .map(|level| (*level).to_string());
    });
    combo(app, open, &group, "Thinking", &level_names, level_index, &apply_level);
    let mut access_names = vec![format!("Inherit ({})", format::access_label(global.default_access))];
    access_names.extend(format::ACCESS_MODES.iter().map(|mode| format::access_label(*mode).to_string()));
    let access_index =
        settings.default_access.map_or(0, |mode| usize::try_from(format::access_index(mode)).unwrap_or(0) + 1);
    let apply_access: Apply = Rc::new(|settings, index| {
        settings.default_access = usize::try_from(index)
            .ok()
            .and_then(|index| index.checked_sub(1))
            .and_then(|index| format::ACCESS_MODES.get(index))
            .copied();
    });
    combo(app, open, &group, "Permissions", &access_names, access_index, &apply_access);
    let workspace_label = |workspace: NewThreadWorkspace| match workspace {
        NewThreadWorkspace::Local => "Local checkout",
        NewThreadWorkspace::Worktree => "New worktree",
    };
    let workspace_names = vec![
        format!("Inherit ({})", workspace_label(global.new_thread_workspace)),
        workspace_label(NewThreadWorkspace::Local).to_string(),
        workspace_label(NewThreadWorkspace::Worktree).to_string(),
    ];
    let workspace_index = match settings.new_thread_workspace {
        None => 0,
        Some(NewThreadWorkspace::Local) => 1,
        Some(NewThreadWorkspace::Worktree) => 2,
    };
    let apply_workspace: Apply = Rc::new(|settings, index| {
        settings.new_thread_workspace = match index {
            1 => Some(NewThreadWorkspace::Local),
            2 => Some(NewThreadWorkspace::Worktree),
            _ => None,
        };
    });
    combo(app, open, &group, "New threads start in", &workspace_names, workspace_index, &apply_workspace);
    let origin_names = vec![
        format!("Inherit ({})", if global.new_worktrees_start_from_origin { "Yes" } else { "No" }),
        "Yes".to_string(),
        "No".to_string(),
    ];
    let origin_index = match settings.new_worktrees_start_from_origin {
        None => 0,
        Some(true) => 1,
        Some(false) => 2,
    };
    let apply_origin: Apply = Rc::new(|settings, index| {
        settings.new_worktrees_start_from_origin = match index {
            1 => Some(true),
            2 => Some(false),
            _ => None,
        };
    });
    combo(app, open, &group, "New worktrees start from origin", &origin_names, origin_index, &apply_origin);
    group
}

fn combo(
    app: &Rc<App>,
    open: &Rc<Open>,
    group: &adw::PreferencesGroup,
    title: &str,
    names: &[String],
    selected: usize,
    apply: &Apply,
) {
    let refs: Vec<&str> = names.iter().map(String::as_str).collect();
    let row = adw::ComboRow::builder()
        .title(title)
        .model(&gtk::StringList::new(&refs))
        .selected(u32::try_from(selected).unwrap_or(0))
        .build();
    let (weak, open, apply) = (Rc::downgrade(app), Rc::downgrade(open), Rc::clone(apply));
    row.connect_selected_notify(move |row| {
        let (Some(app), Some(open)) = (weak.upgrade(), open.upgrade()) else { return };
        let mut shown = open.shown.borrow_mut();
        let Some((settings, _)) = shown.as_mut() else { return };
        apply(settings, row.selected());
        let (project, settings) = (open.project.clone(), settings.clone());
        drop(shown);
        app.core.run(|studio| studio.update_project_settings(project, settings));
    });
    group.add(&row);
}

#[allow(clippy::too_many_lines)]
fn scripts_group(app: &Rc<App>, open: &Rc<Open>, scripts: &[ProjectScript]) -> adw::PreferencesGroup {
    let group = adw::PreferencesGroup::builder()
        .title("Scripts")
        .description("Run from the header or with a keybinding. Scripts marked for worktree setup run when a thread gets a new worktree.")
        .build();
    let buttons = gtk::Box::new(gtk::Orientation::Horizontal, 6);
    let import = gtk::Button::builder()
        .label("Import local-studio.json")
        .tooltip_text("Import scripts from local-studio.json at the project root")
        .build();
    import.add_css_class("flat");
    let add = gtk::Button::builder().icon_name("list-add-symbolic").tooltip_text("Add Script").build();
    add.add_css_class("flat");
    buttons.append(&import);
    buttons.append(&add);
    group.set_header_suffix(Some(&buttons));
    let (weak, project) = (Rc::downgrade(app), open.project.clone());
    import.connect_clicked(move |_| {
        let Some(app) = weak.upgrade() else { return };
        let (request, project) = (app.core.request(), project.clone());
        app.core.run(|studio| studio.import_project_scripts(request, project));
    });
    let (weak, open_weak) = (Rc::downgrade(app), Rc::downgrade(open));
    add.connect_clicked(move |_| {
        let (Some(app), Some(open)) = (weak.upgrade(), open_weak.upgrade()) else { return };
        let mut scripts = current(&app, &open.project).1;
        let number = scripts.len() + 1;
        scripts.push(ProjectScript {
            name: format!("Script {number}"),
            command: "echo ready".to_string(),
            ..ProjectScript::default()
        });
        let project = open.project.clone();
        app.core.run(|studio| studio.set_project_scripts(project, scripts));
    });
    if scripts.is_empty() {
        group.add(
            &adw::ActionRow::builder()
                .title("No scripts yet")
                .subtitle("Add one, or import local-studio.json from the project root.")
                .build(),
        );
    }
    for (index, script) in scripts.iter().enumerate() {
        let row = adw::ExpanderRow::builder()
            .title(format::escape(&script.name))
            .subtitle(format::escape(&script.command))
            .build();
        row.add_css_class("property");
        if let Some(keys) = &script.keybinding {
            let label = gtk::Label::new(Some(&format::shortcut_label(keys)));
            label.add_css_class("ls-keycap");
            label.set_valign(gtk::Align::Center);
            row.add_suffix(&label);
        }
        if script.run_on_worktree_setup {
            let tag = gtk::Label::new(Some("Setup"));
            tag.add_css_class("ls-pill");
            tag.set_valign(gtk::Align::Center);
            tag.set_tooltip_text(Some("Runs when a thread gets a new worktree"));
            row.add_suffix(&tag);
        }
        let run = gtk::Button::builder()
            .icon_name("media-playback-start-symbolic")
            .tooltip_text("Run in the Terminal Drawer")
            .valign(gtk::Align::Center)
            .build();
        run.add_css_class("flat");
        let (weak, project, id) = (Rc::downgrade(app), open.project.clone(), script.id.clone());
        run.connect_clicked(move |_| {
            if let Some(app) = weak.upgrade() {
                app.drawer.run_script(&app, &project, &id);
            }
        });
        row.add_suffix(&run);
        let edit = |title: &str, value: &str, set: fn(&mut ProjectScript, String)| {
            let entry = adw::EntryRow::builder().title(title).text(value).show_apply_button(true).build();
            let (weak, open) = (Rc::downgrade(app), Rc::downgrade(open));
            entry.connect_apply(move |entry| {
                let (Some(app), Some(open)) = (weak.upgrade(), open.upgrade()) else { return };
                let mut scripts = current(&app, &open.project).1;
                if let Some(script) = scripts.get_mut(index) {
                    set(script, entry.text().trim().to_string());
                }
                let project = open.project.clone();
                app.core.run(|studio| studio.set_project_scripts(project, scripts));
            });
            entry
        };
        row.add_row(&edit("Name", &script.name, |script, value| script.name = value));
        row.add_row(&edit("Command", &script.command, |script, value| script.command = value));
        row.add_row(&edit(
            "Keybinding (e.g. ctrl+shift+r)",
            script.keybinding.as_deref().unwrap_or_default(),
            |script, value| {
                script.keybinding = Some(value).filter(|value| !value.is_empty());
            },
        ));
        let toggle = |title: &str, value: bool, set: fn(&mut ProjectScript, bool)| {
            let switch = adw::SwitchRow::builder().title(title).active(value).build();
            let (weak, open) = (Rc::downgrade(app), Rc::downgrade(open));
            switch.connect_active_notify(move |switch| {
                let (Some(app), Some(open)) = (weak.upgrade(), open.upgrade()) else { return };
                let mut scripts = current(&app, &open.project).1;
                if let Some(script) = scripts.get_mut(index) {
                    set(script, switch.is_active());
                }
                let project = open.project.clone();
                app.core.run(|studio| studio.set_project_scripts(project, scripts));
            });
            switch
        };
        row.add_row(&toggle("Run on worktree setup", script.run_on_worktree_setup, |script, value| {
            script.run_on_worktree_setup = value;
        }));
        row.add_row(&toggle("Wait for it before the thread starts", script.wait_for_setup, |script, value| {
            script.wait_for_setup = value;
        }));
        let delete = adw::ButtonRow::builder().title("Delete Script").build();
        delete.add_css_class("destructive-action");
        let (weak, open_weak) = (Rc::downgrade(app), Rc::downgrade(open));
        delete.connect_activated(move |_| {
            let (Some(app), Some(open)) = (weak.upgrade(), open_weak.upgrade()) else { return };
            let mut scripts = current(&app, &open.project).1;
            if index < scripts.len() {
                scripts.remove(index);
            }
            let project = open.project.clone();
            app.core.run(|studio| studio.set_project_scripts(project, scripts));
        });
        row.add_row(&delete);
        group.add(&row);
    }
    group
}
