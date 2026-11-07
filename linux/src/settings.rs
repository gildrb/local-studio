use std::cell::RefCell;
use std::rc::{Rc, Weak};

use adw::prelude::*;
use local_studio_core::{
    ChatWidth, ColorScheme, DiffColors, DiffLayout, FollowUpBehavior, LinkTarget, MergeMethod, ModelOption,
    NewThreadWorkspace, NotificationMode, QuitConfirmation, ResponseStreaming, SendShortcut, Settings, TimeFormat,
    WritingStyle,
};

use crate::app::App;
use crate::format;
use crate::state::{short_path, Page, State};
use crate::theme;

const CLEANUP_DAYS: [Option<u32>; 6] = [None, Some(1), Some(3), Some(7), Some(14), Some(30)];

#[derive(Clone)]
pub struct SettingsDialog {
    inner: Rc<Inner>,
}

struct Inner {
    dialog: adw::PreferencesDialog,
    providers_page: adw::PreferencesPage,
    providers: RefCell<Option<adw::PreferencesGroup>>,
    keys_page: adw::PreferencesPage,
    keys: RefCell<Vec<adw::PreferencesGroup>>,
    archive_page: adw::PreferencesPage,
    archive: RefCell<Vec<adw::PreferencesGroup>>,
}

impl SettingsDialog {
    pub fn new(app: &Rc<App>) -> Self {
        let dialog = adw::PreferencesDialog::builder().content_width(900).content_height(720).build();
        dialog.set_search_enabled(true);
        let weak = Rc::downgrade(app);
        let state = app.state.borrow();
        dialog.add(&general_page(&weak, &state));
        dialog.add(&appearance_page(&weak));
        let keys_page = page("keybindings", "Keybindings", "input-keyboard-symbolic");
        dialog.add(&keys_page);
        let providers_page = page("providers", "Providers", "application-x-addon-symbolic");
        dialog.add(&providers_page);
        dialog.add(&source_control_page(&weak, &state));
        dialog.add(&storage_page(&weak));
        dialog.add(&local_page(&weak));
        let archive_page = page("archive", "Archive", "folder-download-symbolic");
        dialog.add(&archive_page);
        drop(state);
        let settings = Self {
            inner: Rc::new(Inner {
                dialog,
                providers_page,
                providers: RefCell::new(None),
                keys_page,
                keys: RefCell::new(Vec::new()),
                archive_page,
                archive: RefCell::new(Vec::new()),
            }),
        };
        settings.refresh(app);
        let weak = Rc::downgrade(app);
        settings.inner.dialog.connect_closed(move |_| {
            if let Some(app) = weak.upgrade() {
                app.settings.replace(None);
            }
        });
        settings
    }

    pub fn show_page(&self, name: &str) {
        self.inner.dialog.set_visible_page_name(name);
    }

    pub fn close(&self) {
        self.inner.dialog.close();
    }

    pub fn present(&self, app: &App) {
        self.inner.dialog.present(Some(&app.window));
    }

    pub fn refresh(&self, app: &Rc<App>) {
        let state = app.state.borrow();
        let weak = Rc::downgrade(app);
        self.refresh_providers(&weak, &state);
        self.refresh_keys(&weak, &state);
        self.refresh_archive(&state);
    }

    fn refresh_providers(&self, app: &Weak<App>, state: &State) {
        if let Some(group) = self.inner.providers.take() {
            self.inner.providers_page.remove(&group);
        }
        let group = adw::PreferencesGroup::builder()
            .title("Providers")
            .description("Model providers known to the Eukhe daemon. Sign in with the eukhe CLI to configure one.")
            .build();
        let refresh =
            gtk::Button::builder().icon_name("view-refresh-symbolic").tooltip_text("Refresh Provider Status").build();
        refresh.add_css_class("flat");
        let weak = app.clone();
        refresh.connect_clicked(move |_| {
            if let Some(app) = weak.upgrade() {
                app.core.run(local_studio_core::Studio::load_providers);
            }
        });
        group.set_header_suffix(Some(&refresh));
        if state.providers.is_empty() {
            group.add(
                &adw::ActionRow::builder()
                    .title("No providers yet")
                    .subtitle("Providers appear once the model catalog loads.")
                    .build(),
            );
        }
        for provider in &state.providers {
            let row = adw::ExpanderRow::builder()
                .title(format::escape(&provider.name))
                .subtitle(format!("{} models · {}", provider.model_count, provider.id))
                .build();
            let status = gtk::Label::new(Some(if provider.configured { "Configured" } else { "Not configured" }));
            status.add_css_class("ls-pill");
            if provider.configured {
                status.add_css_class("status-done");
            }
            status.set_valign(gtk::Align::Center);
            row.add_suffix(&status);
            for model in state.models.iter().filter(|model| model.provider == provider.id) {
                row.add_row(&model_row(app, state, model));
            }
            group.add(&row);
        }
        self.inner.providers_page.add(&group);
        self.inner.providers.replace(Some(group));
    }

    fn refresh_keys(&self, app: &Weak<App>, state: &State) {
        for group in self.inner.keys.take() {
            self.inner.keys_page.remove(&group);
        }
        let group = adw::PreferencesGroup::builder()
            .title("Keyboard shortcuts")
            .description("Shortcuts use Ctrl where the macOS app uses ⌘.")
            .build();
        for binding in &state.keybindings {
            let row = adw::ActionRow::builder().title(format::escape(&binding.title)).build();
            if let Some(when) = &binding.when {
                row.set_subtitle(&format::escape(when));
            }
            match &binding.shortcut {
                Some(shortcut) => {
                    let label = gtk::Label::new(Some(&format::shortcut_label(shortcut)));
                    label.add_css_class("ls-pill");
                    label.add_css_class("ls-mono");
                    label.set_valign(gtk::Align::Center);
                    row.add_suffix(&label);
                }
                None => row.add_suffix(&dim("Unbound")),
            }
            let customized = binding.shortcut != binding.default_shortcut;
            let record = gtk::Button::builder()
                .icon_name("input-keyboard-symbolic")
                .tooltip_text("Record Shortcut")
                .valign(gtk::Align::Center)
                .build();
            record.add_css_class("flat");
            let weak = app.clone();
            let (command, title) = (binding.command.clone(), binding.title.clone());
            record.connect_clicked(move |_| {
                if let Some(app) = weak.upgrade() {
                    crate::commands::record_shortcut(&app, command.clone(), &title);
                }
            });
            row.add_suffix(&record);
            let button = gtk::Button::builder()
                .icon_name(if customized { "edit-undo-symbolic" } else { "edit-clear-symbolic" })
                .tooltip_text(if customized { "Reset to Default" } else { "Remove" })
                .valign(gtk::Align::Center)
                .build();
            button.add_css_class("flat");
            button.set_sensitive(customized || binding.shortcut.is_some());
            let weak = app.clone();
            let command = binding.command.clone();
            let next = if customized { binding.default_shortcut.clone() } else { None };
            button.connect_clicked(move |_| {
                if let Some(app) = weak.upgrade() {
                    let (command, next) = (command.clone(), next.clone());
                    app.core.run(|studio| studio.set_keybinding(command, next));
                }
            });
            row.add_suffix(&button);
            group.add(&row);
        }
        if state.keybindings.is_empty() {
            group.add(&adw::ActionRow::builder().title("Keybindings load with the core").build());
        }
        self.inner.keys_page.add(&group);
        let stored = vec![group];
        self.inner.keys.replace(stored);
    }

    fn refresh_archive(&self, state: &State) {
        for group in self.inner.archive.take() {
            self.inner.archive_page.remove(&group);
        }
        let mut stored: Vec<adw::PreferencesGroup> = Vec::new();
        let mut projects: Vec<Option<String>> = Vec::new();
        for row in &state.archived {
            if !projects.contains(&row.project) {
                projects.push(row.project.clone());
            }
        }
        for project in projects {
            let title = project.as_deref().map_or_else(
                || "No project".to_string(),
                |project| state.project_name(Some(project)).unwrap_or_else(|| short_path(project)),
            );
            let group = adw::PreferencesGroup::builder().title(format::escape(&title)).build();
            for thread in state.archived.iter().filter(|row| row.project == project) {
                let row = adw::ActionRow::builder()
                    .title(format::escape(if thread.title.is_empty() { "Untitled thread" } else { &thread.title }))
                    .subtitle(format::relative(thread.updated_at, format::now_ms()))
                    .build();
                let unarchive = gtk::Button::with_label("Unarchive");
                unarchive.add_css_class("flat");
                unarchive.set_valign(gtk::Align::Center);
                unarchive.set_action_name(Some("win.thread-unarchive"));
                unarchive.set_action_target_value(Some(&thread.id.to_variant()));
                let delete = gtk::Button::builder()
                    .icon_name("user-trash-symbolic")
                    .tooltip_text("Delete")
                    .valign(gtk::Align::Center)
                    .build();
                delete.add_css_class("flat");
                delete.set_action_name(Some("win.thread-delete"));
                delete.set_action_target_value(Some(&thread.id.to_variant()));
                row.add_suffix(&unarchive);
                row.add_suffix(&delete);
                group.add(&row);
            }
            self.inner.archive_page.add(&group);
            stored.push(group);
        }
        if stored.is_empty() {
            let group = adw::PreferencesGroup::new();
            let status = adw::StatusPage::builder()
                .icon_name("folder-download-symbolic")
                .title("No archived threads")
                .description("Archived threads appear here, grouped by project.")
                .build();
            status.add_css_class("compact");
            group.add(&status);
            self.inner.archive_page.add(&group);
            stored.push(group);
        }
        self.inner.archive.replace(stored);
    }
}

fn page(name: &str, title: &str, icon: &str) -> adw::PreferencesPage {
    adw::PreferencesPage::builder().name(name).title(title).icon_name(icon).build()
}

fn group(page: &adw::PreferencesPage, title: &str) -> adw::PreferencesGroup {
    let group = adw::PreferencesGroup::builder().title(title).build();
    page.add(&group);
    group
}

fn update(app: &Weak<App>, change: impl FnOnce(&mut Settings)) {
    let Some(app) = app.upgrade() else { return };
    if app.syncing.get() {
        return;
    }
    let settings = {
        let mut state = app.state.borrow_mut();
        change(&mut state.settings);
        state.settings.clone()
    };
    theme::color_scheme(settings.color_scheme);
    app.render(crate::app::Dirty { composer: true, sidebar: true, ..crate::app::Dirty::default() });
    app.core.run(|studio| studio.update_settings(settings));
}

fn current(app: &Weak<App>) -> Settings {
    app.upgrade().map(|app| app.state.borrow().settings.clone()).unwrap_or_default()
}

fn switch(
    group: &adw::PreferencesGroup,
    app: &Weak<App>,
    title: &str,
    subtitle: &str,
    get: fn(&Settings) -> bool,
    set: fn(&mut Settings, bool),
) {
    let row = adw::SwitchRow::builder().title(title).active(get(&current(app))).build();
    if !subtitle.is_empty() {
        row.set_subtitle(subtitle);
    }
    let weak = app.clone();
    row.connect_active_notify(move |row| {
        let active = row.is_active();
        update(&weak, |settings| set(settings, active));
    });
    group.add(&row);
}

fn combo(
    group: &adw::PreferencesGroup,
    app: &Weak<App>,
    title: &str,
    subtitle: &str,
    options: &[&str],
    get: impl Fn(&Settings) -> usize,
    set: impl Fn(&mut Settings, usize) + 'static,
) {
    let row = adw::ComboRow::builder().title(title).model(&gtk::StringList::new(options)).build();
    if !subtitle.is_empty() {
        row.set_subtitle(subtitle);
    }
    row.set_selected(u32::try_from(get(&current(app))).unwrap_or(0));
    let weak = app.clone();
    row.connect_selected_notify(move |row| {
        let index = usize::try_from(row.selected()).unwrap_or(0);
        update(&weak, |settings| set(settings, index));
    });
    group.add(&row);
}

fn spin(
    group: &adw::PreferencesGroup,
    app: &Weak<App>,
    title: &str,
    subtitle: &str,
    range: (u32, u32, u32),
    get: fn(&Settings) -> u32,
    set: fn(&mut Settings, u32),
) {
    let row = adw::SpinRow::with_range(f64::from(range.0), f64::from(range.1), f64::from(range.2));
    row.set_title(title);
    if !subtitle.is_empty() {
        row.set_subtitle(subtitle);
    }
    row.set_value(f64::from(get(&current(app))));
    let weak = app.clone();
    row.connect_value_notify(move |row| {
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let value = row.value().round().max(0.0) as u32;
        update(&weak, |settings| set(settings, value));
    });
    group.add(&row);
}

fn entry(
    group: &adw::PreferencesGroup,
    app: &Weak<App>,
    title: &str,
    secret: bool,
    get: fn(&Settings) -> String,
    set: fn(&mut Settings, String),
) {
    let row: adw::EntryRow = if secret {
        adw::PasswordEntryRow::builder().title(title).build().upcast()
    } else {
        adw::EntryRow::builder().title(title).build()
    };
    row.set_text(&get(&current(app)));
    row.set_show_apply_button(true);
    let weak = app.clone();
    row.connect_apply(move |row| {
        let text = row.text().to_string();
        update(&weak, |settings| set(settings, text));
    });
    group.add(&row);
}

fn model_combo(
    group: &adw::PreferencesGroup,
    app: &Weak<App>,
    title: &str,
    subtitle: &str,
    models: &[ModelOption],
    get: fn(&Settings) -> (Option<String>, Option<String>),
    set: fn(&mut Settings, Option<String>, Option<String>),
) {
    let keys: Vec<(String, String)> = models.iter().map(|model| (model.provider.clone(), model.id.clone())).collect();
    let mut names = vec!["Automatic".to_string()];
    names.extend(
        models.iter().map(|model| {
            format!("{} · {}", if model.name.is_empty() { &model.id } else { &model.name }, model.provider)
        }),
    );
    let refs: Vec<&str> = names.iter().map(String::as_str).collect();
    let lookup = keys.clone();
    combo(
        group,
        app,
        title,
        subtitle,
        &refs,
        move |settings| match get(settings) {
            (Some(provider), Some(model)) => {
                lookup.iter().position(|key| key.0 == provider && key.1 == model).map_or(0, |index| index + 1)
            }
            _ => 0,
        },
        move |settings, index| match index.checked_sub(1).and_then(|index| keys.get(index)) {
            Some((provider, model)) => set(settings, Some(provider.clone()), Some(model.clone())),
            None => set(settings, None, None),
        },
    );
}

#[allow(clippy::too_many_lines)]
fn general_page(app: &Weak<App>, state: &State) -> adw::PreferencesPage {
    let page = page("general", "General", "emblem-system-symbolic");
    let defaults = group(&page, "Project defaults");
    model_combo(
        &defaults,
        app,
        "Default model",
        "Used for new threads",
        &state.models,
        |settings| (settings.default_provider.clone(), settings.default_model.clone()),
        |settings, provider, model| {
            settings.default_provider = provider;
            settings.default_model = model;
        },
    );
    let access: Vec<&str> = format::ACCESS_MODES.iter().map(|mode| format::access_label(*mode)).collect();
    combo(
        &defaults,
        app,
        "Permissions",
        "Default access for new threads",
        &access,
        |settings| format::access_index(settings.default_access) as usize,
        |settings, index| settings.default_access = format::ACCESS_MODES.get(index).copied().unwrap_or_default(),
    );
    combo(
        &defaults,
        app,
        "New threads",
        "Where new threads work",
        &["Local checkout", "New worktree"],
        |settings| usize::from(settings.new_thread_workspace == NewThreadWorkspace::Worktree),
        |settings, index| {
            settings.new_thread_workspace =
                if index == 1 { NewThreadWorkspace::Worktree } else { NewThreadWorkspace::Local };
        },
    );
    switch(
        &defaults,
        app,
        "Start new worktrees from origin",
        "",
        |settings| settings.new_worktrees_start_from_origin,
        |settings, value| {
            settings.new_worktrees_start_from_origin = value;
        },
    );

    let organization = group(&page, "Organization");
    switch(
        &organization,
        app,
        "Working section",
        "Running threads fold into their own shelf",
        |settings| settings.working_section,
        |settings, value| {
            settings.working_section = value;
        },
    );
    switch(
        &organization,
        app,
        "Auto-settle merged threads",
        "",
        |settings| settings.auto_settle_merged,
        |settings, value| {
            settings.auto_settle_merged = value;
        },
    );
    switch(
        &organization,
        app,
        "Auto-settle inactive threads",
        "",
        |settings| settings.auto_settle_inactive,
        |settings, value| {
            settings.auto_settle_inactive = value;
        },
    );
    spin(
        &organization,
        app,
        "Days of inactivity",
        "",
        (1, 90, 1),
        |settings| settings.auto_settle_inactive_days,
        |settings, value| {
            settings.auto_settle_inactive_days = value;
        },
    );

    let behavior = group(&page, "Behavior");
    combo(
        &behavior,
        app,
        "Thread notifications",
        "When a turn finishes or needs you",
        &["Off", "Notifications", "Sound", "Notifications and sound"],
        |settings| match settings.notifications {
            NotificationMode::Off => 0,
            NotificationMode::Notifications => 1,
            NotificationMode::Sound => 2,
            NotificationMode::NotificationsAndSound => 3,
        },
        |settings, index| {
            settings.notifications = match index {
                1 => NotificationMode::Notifications,
                2 => NotificationMode::Sound,
                3 => NotificationMode::NotificationsAndSound,
                _ => NotificationMode::Off,
            };
        },
    );
    switch(
        &behavior,
        app,
        "In-app notifications",
        "",
        |settings| settings.in_app_notifications,
        |settings, value| {
            settings.in_app_notifications = value;
        },
    );
    combo(
        &behavior,
        app,
        "Time format",
        "",
        &["System", "12-hour", "24-hour"],
        |settings| match settings.time_format {
            TimeFormat::Locale => 0,
            TimeFormat::TwelveHour => 1,
            TimeFormat::TwentyFourHour => 2,
        },
        |settings, index| {
            settings.time_format = match index {
                1 => TimeFormat::TwelveHour,
                2 => TimeFormat::TwentyFourHour,
                _ => TimeFormat::Locale,
            };
        },
    );
    combo(
        &behavior,
        app,
        "Response streaming",
        "How replies appear while they stream",
        &["Whole turn", "By paragraph", "By token"],
        |settings| match settings.response_streaming {
            ResponseStreaming::Turn => 0,
            ResponseStreaming::Paragraph => 1,
            ResponseStreaming::Token => 2,
        },
        |settings, index| {
            settings.response_streaming = match index {
                0 => ResponseStreaming::Turn,
                2 => ResponseStreaming::Token,
                _ => ResponseStreaming::Paragraph,
            };
        },
    );
    switch(
        &behavior,
        app,
        "Hide whitespace changes",
        "",
        |settings| settings.hide_whitespace,
        |settings, value| {
            settings.hide_whitespace = value;
        },
    );
    switch(
        &behavior,
        app,
        "Collapse diff files by default",
        "",
        |settings| settings.diff_files_collapsed,
        |settings, value| {
            settings.diff_files_collapsed = value;
        },
    );
    combo(
        &behavior,
        app,
        "Diff layout",
        "",
        &["Stacked", "Split"],
        |settings| usize::from(settings.diff_layout == DiffLayout::Split),
        |settings, index| settings.diff_layout = if index == 1 { DiffLayout::Split } else { DiffLayout::Stacked },
    );
    switch(
        &behavior,
        app,
        "Proactive panels",
        "Open the diff when a turn changes files",
        |settings| settings.proactive_panels,
        |settings, value| {
            settings.proactive_panels = value;
        },
    );
    switch(
        &behavior,
        app,
        "Show skills in slash menu",
        "",
        |settings| settings.show_skills_in_slash_menu,
        |settings, value| {
            settings.show_skills_in_slash_menu = value;
        },
    );
    switch(
        &behavior,
        app,
        "Rich text composer",
        "",
        |settings| settings.rich_text_composer,
        |settings, value| {
            settings.rich_text_composer = value;
        },
    );
    switch(
        &behavior,
        app,
        "Collapse composer on scroll",
        "",
        |settings| settings.collapse_composer_on_scroll,
        |settings, value| {
            settings.collapse_composer_on_scroll = value;
        },
    );
    combo(
        &behavior,
        app,
        "Send shortcut",
        "",
        &["Enter (Shift+Enter for a new line)", "Ctrl+Enter, Enter for a new line", "Ctrl+Enter only"],
        |settings| match settings.send_shortcut {
            SendShortcut::Enter => 0,
            SendShortcut::ModEnterMultiline => 1,
            SendShortcut::ModEnter => 2,
        },
        |settings, index| {
            settings.send_shortcut = match index {
                1 => SendShortcut::ModEnterMultiline,
                2 => SendShortcut::ModEnter,
                _ => SendShortcut::Enter,
            };
        },
    );
    combo(
        &behavior,
        app,
        "Follow-up behavior",
        "What sending does while a turn runs",
        &["Queue", "Steer"],
        |settings| usize::from(settings.follow_up_behavior == FollowUpBehavior::Steer),
        |settings, index| {
            settings.follow_up_behavior = if index == 1 { FollowUpBehavior::Steer } else { FollowUpBehavior::Queue };
        },
    );
    switch(
        &behavior,
        app,
        "Continue threads after restarts",
        "",
        |settings| settings.continue_threads_after_restart,
        |settings, value| {
            settings.continue_threads_after_restart = value;
        },
    );

    let projects = group(&page, "Projects and threads");
    entry(
        &projects,
        app,
        "Add project starts in",
        false,
        |settings| settings.add_project_base_directory.clone(),
        |settings, value| {
            settings.add_project_base_directory = value;
        },
    );

    let confirmations = group(&page, "Confirmations");
    switch(
        &confirmations,
        app,
        "Confirm unpin",
        "",
        |settings| settings.confirm_unpin,
        |settings, value| settings.confirm_unpin = value,
    );
    switch(
        &confirmations,
        app,
        "Confirm archive",
        "",
        |settings| settings.confirm_archive,
        |settings, value| {
            settings.confirm_archive = value;
        },
    );
    switch(
        &confirmations,
        app,
        "Confirm delete",
        "",
        |settings| settings.confirm_delete,
        |settings, value| {
            settings.confirm_delete = value;
        },
    );
    combo(
        &confirmations,
        app,
        "Quit shortcut",
        "",
        &["Quit immediately", "Hold to quit", "Press twice to quit"],
        |settings| match settings.quit_confirmation {
            QuitConfirmation::Direct => 0,
            QuitConfirmation::Hold => 1,
            QuitConfirmation::DoubleClick => 2,
        },
        |settings, index| {
            settings.quit_confirmation = match index {
                0 => QuitConfirmation::Direct,
                2 => QuitConfirmation::DoubleClick,
                _ => QuitConfirmation::Hold,
            };
        },
    );

    let generation = group(&page, "Text generation");
    model_combo(
        &generation,
        app,
        "Text generation model",
        "Titles, commit messages and pull requests",
        &state.models,
        |settings| (settings.text_generation_provider.clone(), settings.text_generation_model.clone()),
        |settings, provider, model| {
            settings.text_generation_provider = provider;
            settings.text_generation_model = model;
        },
    );
    let legacy = group(&page, "Legacy features");
    switch(
        &legacy,
        app,
        "Context window indicator",
        "",
        |settings| settings.context_window_meter,
        |settings, value| {
            settings.context_window_meter = value;
        },
    );
    page
}

#[allow(clippy::too_many_lines)]
fn appearance_page(app: &Weak<App>) -> adw::PreferencesPage {
    let page = page("appearance", "Appearance", "applications-graphics-symbolic");
    let interface = group(&page, "Interface");
    combo(
        &interface,
        app,
        "Color scheme",
        "",
        &["System", "Light", "Dark"],
        |settings| match settings.color_scheme {
            ColorScheme::System => 0,
            ColorScheme::Light => 1,
            ColorScheme::Dark => 2,
        },
        |settings, index| {
            settings.color_scheme = match index {
                1 => ColorScheme::Light,
                2 => ColorScheme::Dark,
                _ => ColorScheme::System,
            };
        },
    );
    spin(
        &interface,
        app,
        "Contrast",
        "Percent",
        (50, 200, 5),
        |settings| settings.contrast,
        |settings, value| settings.contrast = value,
    );
    combo(
        &interface,
        app,
        "Diff colors",
        "",
        &["Red and green", "Blue and orange"],
        |settings| usize::from(settings.diff_colors == DiffColors::BlueOrange),
        |settings, index| settings.diff_colors = if index == 1 { DiffColors::BlueOrange } else { DiffColors::RedGreen },
    );
    combo(
        &interface,
        app,
        "Chat width",
        "",
        &["Normal", "Wide", "Full"],
        |settings| match settings.chat_width {
            ChatWidth::Normal => 0,
            ChatWidth::Wide => 1,
            ChatWidth::Full => 2,
        },
        |settings, index| {
            settings.chat_width = match index {
                1 => ChatWidth::Wide,
                2 => ChatWidth::Full,
                _ => ChatWidth::Normal,
            };
        },
    );
    let typography = group(&page, "Typography");
    entry(
        &typography,
        app,
        "Interface font",
        false,
        |settings| settings.interface_font.clone(),
        |settings, value| {
            settings.interface_font = value;
        },
    );
    spin(
        &typography,
        app,
        "Interface font size",
        "",
        (9, 24, 1),
        |settings| settings.interface_font_size,
        |settings, value| {
            settings.interface_font_size = value;
        },
    );
    entry(
        &typography,
        app,
        "Prompt font",
        false,
        |settings| settings.prompt_font.clone(),
        |settings, value| {
            settings.prompt_font = value;
        },
    );
    spin(
        &typography,
        app,
        "Prompt font size",
        "",
        (9, 24, 1),
        |settings| settings.prompt_font_size,
        |settings, value| {
            settings.prompt_font_size = value;
        },
    );
    entry(
        &typography,
        app,
        "Code font",
        false,
        |settings| settings.code_font.clone(),
        |settings, value| {
            settings.code_font = value;
        },
    );
    spin(
        &typography,
        app,
        "Code font size",
        "",
        (9, 24, 1),
        |settings| settings.code_font_size,
        |settings, value| {
            settings.code_font_size = value;
        },
    );
    entry(
        &typography,
        app,
        "Terminal font",
        false,
        |settings| settings.terminal_font.clone(),
        |settings, value| {
            settings.terminal_font = value;
        },
    );
    spin(
        &typography,
        app,
        "Terminal font size",
        "",
        (9, 24, 1),
        |settings| settings.terminal_font_size,
        |settings, value| {
            settings.terminal_font_size = value;
        },
    );
    switch(
        &typography,
        app,
        "Font smoothing",
        "",
        |settings| settings.font_smoothing,
        |settings, value| settings.font_smoothing = value,
    );
    switch(
        &typography,
        app,
        "Word wrap",
        "Wrap long lines in code and diffs",
        |settings| settings.word_wrap,
        |settings, value| {
            settings.word_wrap = value;
        },
    );
    let integrations = group(&page, "Integrations");
    combo(
        &integrations,
        app,
        "Open links in",
        "",
        &["System browser", "Local Studio"],
        |settings| usize::from(settings.open_links_in == LinkTarget::App),
        |settings, index| settings.open_links_in = if index == 1 { LinkTarget::App } else { LinkTarget::System },
    );
    page
}

fn source_control_page(app: &Weak<App>, state: &State) -> adw::PreferencesPage {
    let page = page("source-control", "Source Control", "preferences-system-sharing-symbolic");
    let sync = group(&page, "Sync");
    switch(
        &sync,
        app,
        "Automatically pull",
        "Fast-forward clean branches that are only behind",
        |settings| settings.auto_pull,
        |settings, value| {
            settings.auto_pull = value;
        },
    );
    spin(
        &sync,
        app,
        "Git fetch interval",
        "Seconds; 0 turns background fetch off",
        (0, 3600, 15),
        |settings| settings.git_fetch_interval_seconds,
        |settings, value| {
            settings.git_fetch_interval_seconds = value;
        },
    );
    combo(
        &sync,
        app,
        "Default merge method",
        "",
        &["Repository default", "Merge", "Squash", "Rebase"],
        |settings| match settings.merge_method {
            MergeMethod::RepositoryDefault => 0,
            MergeMethod::Merge => 1,
            MergeMethod::Squash => 2,
            MergeMethod::Rebase => 3,
        },
        |settings, index| {
            settings.merge_method = match index {
                1 => MergeMethod::Merge,
                2 => MergeMethod::Squash,
                3 => MergeMethod::Rebase,
                _ => MergeMethod::RepositoryDefault,
            };
        },
    );
    let writing = group(&page, "Writing");
    combo(
        &writing,
        app,
        "Writing style",
        "Commit messages and pull requests",
        &["Repository conventions", "Conventional commits", "Custom"],
        |settings| match settings.writing_style {
            WritingStyle::RepoConventions => 0,
            WritingStyle::ConventionalCommits => 1,
            WritingStyle::Custom => 2,
        },
        |settings, index| {
            settings.writing_style = match index {
                1 => WritingStyle::ConventionalCommits,
                2 => WritingStyle::Custom,
                _ => WritingStyle::RepoConventions,
            };
        },
    );
    entry(
        &writing,
        app,
        "Custom instructions",
        false,
        |settings| settings.writing_instructions.clone(),
        |settings, value| {
            settings.writing_instructions = value;
        },
    );
    switch(
        &writing,
        app,
        "Follow pull request templates",
        "",
        |settings| settings.follow_pr_templates,
        |settings, value| {
            settings.follow_pr_templates = value;
        },
    );
    model_combo(
        &writing,
        app,
        "Source control writer model",
        "",
        &state.models,
        |settings| (settings.source_control_provider.clone(), settings.source_control_model.clone()),
        |settings, provider, model| {
            settings.source_control_provider = provider;
            settings.source_control_model = model;
        },
    );
    page
}

fn storage_page(app: &Weak<App>) -> adw::PreferencesPage {
    let page = page("storage", "Storage", "drive-harddisk-symbolic");
    let cleanup = group(&page, "Worktree cleanup");
    combo(
        &cleanup,
        app,
        "Remove worktrees after",
        "",
        &["Never", "1 day", "3 days", "7 days", "14 days", "30 days"],
        |settings| CLEANUP_DAYS.iter().position(|days| *days == settings.worktree_cleanup_after_days).unwrap_or(0),
        |settings, index| settings.worktree_cleanup_after_days = CLEANUP_DAYS.get(index).copied().flatten(),
    );
    switch(
        &cleanup,
        app,
        "When the pull request merges",
        "",
        |settings| settings.worktree_cleanup_on_merge,
        |settings, value| {
            settings.worktree_cleanup_on_merge = value;
        },
    );
    switch(
        &cleanup,
        app,
        "When the thread is deleted",
        "",
        |settings| settings.worktree_cleanup_on_delete,
        |settings, value| {
            settings.worktree_cleanup_on_delete = value;
        },
    );
    switch(
        &cleanup,
        app,
        "When the worktree has no changes",
        "",
        |settings| settings.worktree_cleanup_unchanged,
        |settings, value| {
            settings.worktree_cleanup_unchanged = value;
        },
    );
    page
}

fn local_page(app: &Weak<App>) -> adw::PreferencesPage {
    let page = page("local", "Local", "network-server-symbolic");
    let controller = group(&page, "Controller");
    controller.set_description(Some("The Local controller serves models on this machine and links your fleet."));
    let open = gtk::Button::with_label("Open Local");
    open.add_css_class("flat");
    let weak = app.clone();
    open.connect_clicked(move |button| {
        let Some(app) = weak.upgrade() else { return };
        if let Some(dialog) =
            button.ancestor(adw::PreferencesDialog::static_type()).and_downcast::<adw::PreferencesDialog>()
        {
            dialog.close();
        }
        app.open_page(Page::Local);
    });
    controller.set_header_suffix(Some(&open));
    entry(
        &controller,
        app,
        "Controller URL",
        false,
        |settings| settings.local_controller_url.clone(),
        |settings, value| {
            settings.local_controller_url = value;
        },
    );
    entry(
        &controller,
        app,
        "Fleet key",
        true,
        |settings| settings.fleet_key.clone(),
        |settings, value| settings.fleet_key = value,
    );
    switch(
        &controller,
        app,
        "Start the controller",
        "When nothing answers on a loopback URL",
        |settings| settings.start_controller,
        |settings, value| {
            settings.start_controller = value;
        },
    );
    page
}

fn model_row(app: &Weak<App>, state: &State, model: &ModelOption) -> adw::ActionRow {
    let key = |known: &&local_studio_core::ModelKey| known.provider == model.provider && known.model == model.id;
    let favorite = state.favorites.iter().any(|known| key(&known));
    let hidden = state.hidden.iter().any(|known| key(&known));
    let row = adw::ActionRow::builder()
        .title(format::escape(if model.name.is_empty() { &model.id } else { &model.name }))
        .subtitle(format::escape(&format!("{} · {} context", model.id, format::tokens(model.context_window))))
        .build();
    let star = gtk::ToggleButton::builder()
        .icon_name(if favorite { "starred-symbolic" } else { "non-starred-symbolic" })
        .tooltip_text("Favorite")
        .active(favorite)
        .valign(gtk::Align::Center)
        .build();
    star.add_css_class("flat");
    let weak = app.clone();
    let (provider, id) = (model.provider.clone(), model.id.clone());
    star.connect_toggled(move |star| {
        if let Some(app) = weak.upgrade() {
            let (provider, id, on) = (provider.clone(), id.clone(), star.is_active());
            app.core.run(|studio| studio.set_favorite_model(provider, id, on));
        }
    });
    let visible = gtk::Switch::builder()
        .active(!hidden)
        .valign(gtk::Align::Center)
        .tooltip_text("Show in the model picker")
        .build();
    let weak = app.clone();
    let (provider, id) = (model.provider.clone(), model.id.clone());
    visible.connect_active_notify(move |switch| {
        if let Some(app) = weak.upgrade() {
            let (provider, id, hidden) = (provider.clone(), id.clone(), !switch.is_active());
            app.core.run(|studio| studio.set_hidden_model(provider, id, hidden));
        }
    });
    row.add_suffix(&star);
    row.add_suffix(&visible);
    row
}

fn dim(text: &str) -> gtk::Label {
    let label = gtk::Label::new(Some(text));
    label.add_css_class("dim-label");
    label.set_valign(gtk::Align::Center);
    label
}
