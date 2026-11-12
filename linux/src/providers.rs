use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::{Rc, Weak};

use adw::prelude::*;
use local_studio_core::{
    CustomProvider, EndpointPreset, LocalEngine, ProviderApi, ProviderCredential, ProviderKey, ProviderKind,
    ProviderModel, ProviderStatus,
};

use crate::app::{App, Dirty, Target};
use crate::format;
use crate::icons;
use crate::state::State;

const APIS: [ProviderApi; 3] = [ProviderApi::OpenAiCompatible, ProviderApi::OpenAiResponses, ProviderApi::Anthropic];

struct Dialog {
    window: adw::Dialog,
    editing: Option<ProviderStatus>,
    name: adw::EntryRow,
    base: adw::EntryRow,
    api: adw::ComboRow,
    key: adw::PasswordEntryRow,
    clear: Option<adw::SwitchRow>,
    test: gtk::Button,
    save: gtk::Button,
    count: gtk::Label,
    error: gtk::Label,
    models: gtk::ListBox,
    footer: gtk::Label,
    discovered: RefCell<Option<Vec<ProviderModel>>>,
    tested: RefCell<Option<String>>,
    selected: RefCell<HashSet<String>>,
    discover: RefCell<Option<String>>,
    saving: RefCell<Option<String>>,
}

thread_local! {
    static REQUESTS: RefCell<HashMap<String, String>> = RefCell::new(HashMap::new());
    static DIALOG: RefCell<Option<Rc<Dialog>>> = const { RefCell::new(None) };
}

pub fn api_title(api: ProviderApi) -> &'static str {
    match api {
        ProviderApi::OpenAiCompatible => "OpenAI-compatible",
        ProviderApi::OpenAiResponses => "OpenAI Responses",
        ProviderApi::Anthropic => "Anthropic Messages",
    }
}

fn credential_text(provider: &ProviderStatus) -> String {
    match provider.credential {
        ProviderCredential::StoredKey => "Key saved".to_string(),
        ProviderCredential::SignedIn => "Signed in".to_string(),
        ProviderCredential::Environment => {
            provider.env_var.as_ref().map_or_else(|| "From the environment".to_string(), |var| format!("From {var}"))
        }
        ProviderCredential::ModelsJson => "Key in models.json".to_string(),
        ProviderCredential::NotRequired => "No key needed".to_string(),
        ProviderCredential::Missing => {
            provider.env_var.as_ref().map_or_else(|| "Not set".to_string(), |var| format!("Not set · {var} also works"))
        }
    }
}

fn models_text(count: u32) -> String {
    if count == 1 {
        "1 model".to_string()
    } else {
        format!("{count} models")
    }
}

fn dot(on: bool) -> gtk::Box {
    let dot = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    dot.add_css_class("ls-dot");
    if on {
        dot.add_css_class("serving");
    }
    dot.set_valign(gtk::Align::Center);
    dot
}

fn track(app: &App, provider: &str) -> String {
    let request = app.ask(Target::Provider);
    REQUESTS.with(|requests| requests.borrow_mut().insert(request.clone(), provider.to_string()));
    app.state.borrow_mut().provider_pending.insert(provider.to_string());
    request
}

fn settle(app: &App, request: &str) -> Option<String> {
    let provider = REQUESTS.with(|requests| requests.borrow_mut().remove(request))?;
    app.state.borrow_mut().provider_pending.remove(&provider);
    Some(provider)
}

pub fn done(app: &Rc<App>, request: &str, message: &str) {
    settle(app, request);
    let finished = DIALOG.with(|dialog| {
        dialog.borrow().as_ref().filter(|dialog| dialog.saving.borrow().as_deref() == Some(request)).cloned()
    });
    if let Some(dialog) = finished {
        dialog.saving.replace(None);
        dialog.window.close();
    } else if !message.is_empty() {
        app.toast(message);
    }
    app.render(Dirty { settings: true, ..Dirty::default() });
}

pub fn failed(app: &Rc<App>, request: &str, message: &str) {
    settle(app, request);
    let open = DIALOG.with(|dialog| dialog.borrow().clone());
    if let Some(dialog) = open {
        let ours =
            dialog.saving.borrow().as_deref() == Some(request) || dialog.discover.borrow().as_deref() == Some(request);
        if ours {
            dialog.saving.replace(None);
            if dialog.discover.borrow().as_deref() == Some(request) {
                dialog.discover.replace(None);
                dialog.discovered.replace(None);
                dialog.tested.replace(None);
            }
            dialog.error.set_label(message);
            dialog.error.set_visible(true);
            dialog.sync();
            return;
        }
    }
    app.state.borrow_mut().provider_error = Some(message.to_string());
    app.render(Dirty { settings: true, ..Dirty::default() });
}

pub fn discovered(request: &str, base_url: &str, models: &[ProviderModel]) {
    let open = DIALOG.with(|dialog| dialog.borrow().clone());
    let Some(dialog) = open.filter(|dialog| dialog.discover.borrow().as_deref() == Some(request)) else { return };
    dialog.discover.replace(None);
    let existing: HashSet<String> = dialog
        .editing
        .as_ref()
        .map(|provider| provider.models.iter().map(|model| model.id.clone()).collect())
        .unwrap_or_default();
    let found: HashSet<String> = models.iter().map(|model| model.id.clone()).collect();
    let kept: HashSet<String> = existing.intersection(&found).cloned().collect();
    dialog.selected.replace(if kept.is_empty() { found } else { kept });
    dialog.tested.replace(Some(base_url.to_string()));
    dialog.base.set_text(base_url);
    dialog.tested.replace(Some(base_url.to_string()));
    if dialog.name.text().trim().is_empty() {
        let host = base_url.split("//").nth(1).and_then(|rest| rest.split(['/', ':']).next()).unwrap_or(base_url);
        dialog.name.set_text(host);
    }
    dialog.discovered.replace(Some(models.to_vec()));
    dialog.error.set_visible(false);
    dialog.render_models();
    dialog.sync();
}

pub fn groups(app: &Weak<App>, state: &State) -> Vec<adw::PreferencesGroup> {
    let mut groups = Vec::new();
    if !state.provider_errors.is_empty() || state.provider_error.is_some() {
        groups.push(errors_group(app, state));
    }
    groups.push(keys_group(app, state));
    groups.push(endpoints_group(app, state));
    groups.push(engines_group(app, state));
    groups
}

fn errors_group(app: &Weak<App>, state: &State) -> adw::PreferencesGroup {
    let group = adw::PreferencesGroup::new();
    for error in &state.provider_errors {
        let row = adw::ActionRow::builder().title(format::escape(error)).build();
        row.add_css_class("ls-provider-warning");
        row.add_prefix(&icons::image(icons::WARNING));
        group.add(&row);
    }
    if let Some(error) = &state.provider_error {
        let row = adw::ActionRow::builder().title(format::escape(error)).build();
        row.add_css_class("ls-provider-error");
        row.add_prefix(&icons::image(icons::ERROR));
        let dismiss = gtk::Button::builder().label("Dismiss").valign(gtk::Align::Center).build();
        dismiss.add_css_class("flat");
        let weak = app.clone();
        dismiss.connect_clicked(move |_| {
            if let Some(app) = weak.upgrade() {
                app.state.borrow_mut().provider_error = None;
                app.render(Dirty { settings: true, ..Dirty::default() });
            }
        });
        row.add_suffix(&dismiss);
        group.add(&row);
    }
    group
}

fn keys_group(app: &Weak<App>, state: &State) -> adw::PreferencesGroup {
    let group = adw::PreferencesGroup::builder()
        .title("API Keys")
        .description("Keys are saved in Eukhe's auth.json, readable only by you, and apply without restarting. A key exported in the agent's environment works too.")
        .build();
    let builtins: Vec<&ProviderStatus> =
        state.providers.iter().filter(|provider| provider.kind == ProviderKind::BuiltIn).collect();
    if builtins.is_empty() {
        group.add(
            &adw::ActionRow::builder()
                .title(if state.providers_loaded { "No built-in providers." } else { "Loading providers…" })
                .build(),
        );
    }
    for provider in builtins {
        let pending = state.provider_pending.contains(&provider.id);
        let subtitle = if provider.model_count > 0 {
            format!("{} · {}", credential_text(provider), models_text(provider.model_count))
        } else {
            credential_text(provider)
        };
        let row = adw::PasswordEntryRow::builder()
            .title(format!("{} — {}", provider.name, subtitle))
            .show_apply_button(true)
            .sensitive(!pending)
            .build();
        row.add_prefix(&dot(provider.configured));
        let (weak, id) = (app.clone(), provider.id.clone());
        row.connect_apply(move |row| {
            let Some(app) = weak.upgrade() else { return };
            let key = row.text().trim().to_string();
            if key.is_empty() {
                return;
            }
            row.set_text("");
            let request = track(&app, &id);
            let id = id.clone();
            app.core.run(|studio| studio.set_provider_key(request, id, Some(key)));
        });
        if provider.credential == ProviderCredential::StoredKey {
            let remove = gtk::Button::builder().label("Remove").valign(gtk::Align::Center).sensitive(!pending).build();
            remove.add_css_class("flat");
            remove.add_css_class("destructive-action");
            let (weak, id) = (app.clone(), provider.id.clone());
            remove.connect_clicked(move |_| {
                let Some(app) = weak.upgrade() else { return };
                let request = track(&app, &id);
                let id = id.clone();
                app.core.run(|studio| studio.set_provider_key(request, id, None));
            });
            row.add_suffix(&remove);
        }
        group.add(&row);
    }
    group
}

fn endpoints_group(app: &Weak<App>, state: &State) -> adw::PreferencesGroup {
    let group = adw::PreferencesGroup::builder()
        .title("Custom Endpoints")
        .description("Any OpenAI-compatible, OpenAI Responses or Anthropic Messages server. Its models are listed from the server's /models endpoint.")
        .build();
    let add = gtk::Button::builder().label("Add Endpoint…").valign(gtk::Align::Center).build();
    add.add_css_class("flat");
    let weak = app.clone();
    add.connect_clicked(move |_| {
        if let Some(app) = weak.upgrade() {
            present(&app, None);
        }
    });
    group.set_header_suffix(Some(&add));
    let customs: Vec<&ProviderStatus> =
        state.providers.iter().filter(|provider| provider.kind == ProviderKind::Custom).collect();
    if customs.is_empty() {
        group.add(&adw::ActionRow::builder().title("No custom endpoints.").build());
    }
    for provider in customs {
        let pending = state.provider_pending.contains(&provider.id);
        let detail: Vec<String> = [
            provider.base_url.clone(),
            provider.api.map(|api| api_title(api).to_string()),
            Some(models_text(provider.model_count)),
            Some(credential_text(provider)),
        ]
        .into_iter()
        .flatten()
        .collect();
        let row = adw::ActionRow::builder()
            .title(format::escape(&provider.name))
            .subtitle(format::escape(&detail.join(" · ")))
            .subtitle_lines(1)
            .build();
        row.add_prefix(&dot(provider.configured));
        let buttons = gtk::Box::new(gtk::Orientation::Horizontal, 4);
        buttons.set_valign(gtk::Align::Center);
        buttons.set_sensitive(!pending);
        let refresh = icons::flat(icons::REFRESH, "Refresh models from the endpoint");
        let (weak, id) = (app.clone(), provider.id.clone());
        refresh.connect_clicked(move |_| {
            let Some(app) = weak.upgrade() else { return };
            let request = track(&app, &id);
            let id = id.clone();
            app.core.run(|studio| studio.refresh_provider_models(request, id));
        });
        let edit = gtk::Button::with_label("Edit…");
        edit.add_css_class("flat");
        let (weak, editing) = (app.clone(), provider.clone());
        edit.connect_clicked(move |_| {
            if let Some(app) = weak.upgrade() {
                present(&app, Some(editing.clone()));
            }
        });
        let remove = icons::flat(icons::DELETE, "Remove the endpoint");
        let (weak, target) = (app.clone(), provider.clone());
        remove.connect_clicked(move |_| {
            if let Some(app) = weak.upgrade() {
                confirm_remove(&app, &target);
            }
        });
        buttons.append(&refresh);
        buttons.append(&edit);
        buttons.append(&remove);
        row.add_suffix(&buttons);
        group.add(&row);
    }
    group
}

fn confirm_remove(app: &Rc<App>, provider: &ProviderStatus) {
    let dialog = adw::AlertDialog::new(
        Some(&format!("Remove {}?", provider.name)),
        Some("Its models leave the model picker and its saved key is deleted."),
    );
    dialog.add_responses(&[("cancel", "Cancel"), ("remove", "Remove")]);
    dialog.set_response_appearance("remove", adw::ResponseAppearance::Destructive);
    dialog.set_close_response("cancel");
    let (weak, id) = (Rc::downgrade(app), provider.id.clone());
    dialog.connect_response(Some("remove"), move |_, _| {
        if let Some(app) = weak.upgrade() {
            remove(&app, &id);
        }
    });
    dialog.present(Some(&app.window));
}

pub fn remove(app: &Rc<App>, id: &str) {
    let request = track(app, id);
    let id = id.to_string();
    app.core.run(|studio| studio.remove_custom_provider(request, id));
}

fn engines_group(app: &Weak<App>, state: &State) -> adw::PreferencesGroup {
    let group = adw::PreferencesGroup::builder()
        .title("Local Fleet")
        .description("Engines the Local controller found running. Using one adds it as an endpoint routed through the controller.")
        .build();
    if state.engines.is_empty() {
        group.add(&adw::ActionRow::builder().title("No engines are running on the Local fleet.").build());
    }
    for engine in &state.engines {
        group.add(&engine_row(app, state, engine));
    }
    group
}

fn engine_row(app: &Weak<App>, state: &State, engine: &LocalEngine) -> adw::ActionRow {
    let row = adw::ActionRow::builder()
        .title(format::escape(&engine.models.join(", ")))
        .subtitle(format::escape(&format!("{} · port {}", engine.controller, engine.port)))
        .title_lines(1)
        .build();
    row.add_prefix(&dot(true));
    if engine.added {
        let added = gtk::Label::new(Some("Added"));
        added.add_css_class("dim-label");
        row.add_suffix(&added);
    } else {
        let button = gtk::Button::builder()
            .label("Use")
            .valign(gtk::Align::Center)
            .sensitive(!state.provider_pending.contains(&engine.id))
            .build();
        let (weak, id) = (app.clone(), engine.id.clone());
        button.connect_clicked(move |_| {
            let Some(app) = weak.upgrade() else { return };
            let request = track(&app, &id);
            let id = id.clone();
            app.core.run(|studio| studio.use_local_engine(request, id));
        });
        row.add_suffix(&button);
    }
    row
}

pub fn signin_group() -> adw::PreferencesGroup {
    let group = adw::PreferencesGroup::builder().title("Subscriptions").build();
    let row = adw::ActionRow::builder()
        .title("Sign in from a terminal")
        .subtitle("Subscriptions such as ChatGPT, Claude or GitHub Copilot sign in from a terminal: run eukhe and use /login, then Refresh Providers.")
        .build();
    row.add_prefix(&icons::image(icons::TERMINAL));
    let open = gtk::Button::builder()
        .label("Open Terminal")
        .valign(gtk::Align::Center)
        .action_name("win.toggle-terminal")
        .build();
    open.add_css_class("flat");
    row.add_suffix(&open);
    group.add(&row);
    group
}

#[allow(clippy::too_many_lines)]
pub fn present(app: &Rc<App>, editing: Option<ProviderStatus>) {
    let title =
        editing.as_ref().map_or_else(|| "Add Endpoint".to_string(), |provider| format!("Edit {}", provider.name));
    let window = adw::Dialog::builder().title(&title).content_width(520).content_height(640).build();
    let page = adw::PreferencesPage::new();
    let fields = adw::PreferencesGroup::builder()
        .description("The key is saved in Eukhe's auth.json, readable only by you. Leave it empty for local servers that need none.")
        .build();
    let presets: Vec<EndpointPreset> = local_studio_core::endpoint_presets();
    let name = adw::EntryRow::builder()
        .title("Name")
        .text(editing.as_ref().map(|provider| provider.name.as_str()).unwrap_or_default())
        .build();
    let base = adw::EntryRow::builder()
        .title("Base URL")
        .text(editing.as_ref().and_then(|provider| provider.base_url.as_deref()).unwrap_or_default())
        .build();
    let api_names: Vec<&str> = APIS.iter().map(|api| api_title(*api)).collect();
    let api = adw::ComboRow::builder().title("API").model(&gtk::StringList::new(&api_names)).build();
    let api_index = editing
        .as_ref()
        .and_then(|provider| provider.api)
        .and_then(|value| APIS.iter().position(|known| *known == value))
        .unwrap_or(0);
    api.set_selected(u32::try_from(api_index).unwrap_or(0));
    let stored = editing.as_ref().is_some_and(|provider| provider.credential == ProviderCredential::StoredKey);
    let key = adw::PasswordEntryRow::builder()
        .title(if stored { "API key (saved · type to replace)" } else { "API key (optional)" })
        .build();
    if editing.is_none() {
        let mut names = vec!["Custom"];
        names.extend(presets.iter().map(|preset| preset.name.as_str()));
        let preset = adw::ComboRow::builder().title("Preset").model(&gtk::StringList::new(&names)).build();
        let (name, base, api, presets) = (name.clone(), base.clone(), api.clone(), presets.clone());
        preset.connect_selected_notify(move |row| {
            let Some(found) = usize::try_from(row.selected())
                .ok()
                .and_then(|index| index.checked_sub(1))
                .and_then(|index| presets.get(index))
            else {
                return;
            };
            name.set_text(&found.name);
            base.set_text(&found.base_url);
            api.set_selected(
                u32::try_from(APIS.iter().position(|known| *known == found.api).unwrap_or(0)).unwrap_or(0),
            );
        });
        fields.add(&preset);
    }
    fields.add(&name);
    fields.add(&base);
    fields.add(&api);
    fields.add(&key);
    let clear = stored.then(|| adw::SwitchRow::builder().title("Remove the saved key").build());
    if let Some(clear) = &clear {
        fields.add(clear);
    }
    page.add(&fields);
    let models_group = adw::PreferencesGroup::builder().title("Models").build();
    let test = gtk::Button::with_label("Test Connection");
    let count = gtk::Label::new(None);
    count.add_css_class("dim-label");
    count.set_hexpand(true);
    count.set_xalign(1.0);
    let bar = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    bar.append(&test);
    bar.append(&count);
    let error = gtk::Label::new(None);
    error.add_css_class("error");
    error.set_wrap(true);
    error.set_xalign(0.0);
    error.set_visible(false);
    let models = gtk::ListBox::new();
    models.add_css_class("boxed-list");
    models.set_selection_mode(gtk::SelectionMode::None);
    models.set_visible(false);
    let footer = gtk::Label::new(None);
    footer.add_css_class("dim-label");
    footer.set_wrap(true);
    footer.set_xalign(0.0);
    let column = gtk::Box::new(gtk::Orientation::Vertical, 10);
    column.append(&bar);
    column.append(&error);
    column.append(&models);
    column.append(&footer);
    models_group.add(&column);
    page.add(&models_group);
    let cancel = gtk::Button::with_label("Cancel");
    let save = gtk::Button::with_label(if editing.is_some() { "Save" } else { "Add" });
    save.add_css_class("suggested-action");
    let header = adw::HeaderBar::new();
    header.set_show_end_title_buttons(false);
    header.set_show_start_title_buttons(false);
    header.pack_start(&cancel);
    header.pack_end(&save);
    let view = adw::ToolbarView::new();
    view.add_top_bar(&header);
    view.set_content(Some(&page));
    window.set_child(Some(&view));
    let selected: HashSet<String> = editing
        .as_ref()
        .map(|provider| provider.models.iter().map(|model| model.id.clone()).collect())
        .unwrap_or_default();
    let dialog = Rc::new(Dialog {
        window: window.clone(),
        editing,
        name,
        base,
        api,
        key,
        clear,
        test,
        save,
        count,
        error,
        models,
        footer,
        discovered: RefCell::new(None),
        tested: RefCell::new(None),
        selected: RefCell::new(selected),
        discover: RefCell::new(None),
        saving: RefCell::new(None),
    });
    dialog.connect(app);
    dialog.sync();
    DIALOG.with(|slot| slot.replace(Some(Rc::clone(&dialog))));
    window.connect_closed(|_| {
        DIALOG.with(|slot| slot.replace(None));
    });
    let closing = window.clone();
    cancel.connect_clicked(move |_| {
        closing.close();
    });
    window.present(Some(&app.window));
}

impl Dialog {
    fn connect(self: &Rc<Self>, app: &Rc<App>) {
        let (weak, me) = (Rc::downgrade(app), Rc::downgrade(self));
        self.test.connect_clicked(move |_| {
            if let (Some(app), Some(dialog)) = (weak.upgrade(), me.upgrade()) {
                dialog.run_test(&app);
            }
        });
        let (weak, me) = (Rc::downgrade(app), Rc::downgrade(self));
        self.save.connect_clicked(move |_| {
            if let (Some(app), Some(dialog)) = (weak.upgrade(), me.upgrade()) {
                dialog.run_save(&app);
            }
        });
        let me = Rc::downgrade(self);
        self.base.connect_changed(move |entry| {
            let Some(dialog) = me.upgrade() else { return };
            let next = entry.text().to_string();
            if dialog.tested.borrow().as_deref() != Some(next.trim()) {
                dialog.invalidate();
            }
        });
        let me = Rc::downgrade(self);
        self.api.connect_selected_notify(move |_| {
            if let Some(dialog) = me.upgrade() {
                dialog.invalidate();
            }
        });
        let me = Rc::downgrade(self);
        self.name.connect_changed(move |_| {
            if let Some(dialog) = me.upgrade() {
                dialog.sync();
            }
        });
        if let Some(clear) = &self.clear {
            let (me, key) = (Rc::downgrade(self), self.key.clone());
            clear.connect_active_notify(move |row| {
                key.set_sensitive(!row.is_active());
                if let Some(dialog) = me.upgrade() {
                    dialog.sync();
                }
            });
        }
    }

    fn invalidate(self: &Rc<Self>) {
        if self.discovered.borrow().is_none() && self.tested.borrow().is_none() {
            self.sync();
            return;
        }
        self.discovered.replace(None);
        self.tested.replace(None);
        self.error.set_visible(false);
        self.render_models();
        self.sync();
    }

    fn api_value(&self) -> ProviderApi {
        usize::try_from(self.api.selected())
            .ok()
            .and_then(|index| APIS.get(index))
            .copied()
            .unwrap_or(ProviderApi::OpenAiCompatible)
    }

    fn clearing(&self) -> bool {
        self.clear.as_ref().is_some_and(adw::SwitchRow::is_active)
    }

    fn run_test(&self, app: &Rc<App>) {
        let base_url = self.base.text().trim().to_string();
        if base_url.is_empty() {
            return;
        }
        let typed = self.key.text().trim().to_string();
        let stored =
            self.editing.as_ref().filter(|_| typed.is_empty() && !self.clearing()).map(|provider| provider.id.clone());
        let request = app.ask(Target::Provider);
        self.discover.replace(Some(request.clone()));
        self.error.set_visible(false);
        self.sync();
        let api = self.api_value();
        let key = Some(typed).filter(|key| !key.is_empty());
        app.core.run(|studio| studio.discover_provider_models(request, base_url, api, key, stored));
    }

    fn run_save(&self, app: &Rc<App>) {
        if !self.can_save() {
            return;
        }
        let typed = self.key.text().trim().to_string();
        let key = if self.clearing() {
            ProviderKey::Clear
        } else if typed.is_empty() {
            ProviderKey::Keep
        } else {
            ProviderKey::Set { key: typed }
        };
        let models = self.discovered.borrow().as_ref().map(|found| {
            let selected = self.selected.borrow();
            found.iter().filter(|model| selected.contains(&model.id)).cloned().collect::<Vec<_>>()
        });
        let base_url = self.tested.borrow().clone().unwrap_or_else(|| self.base.text().trim().to_string());
        let provider =
            CustomProvider { name: self.name.text().trim().to_string(), base_url, api: self.api_value(), key, models };
        let target = self.editing.as_ref().map_or_else(|| provider.name.clone(), |editing| editing.id.clone());
        let request = track(app, &target);
        self.saving.replace(Some(request.clone()));
        self.error.set_visible(false);
        self.sync();
        match self.editing.as_ref().map(|editing| editing.id.clone()) {
            Some(id) => app.core.run(|studio| studio.update_custom_provider(request, id, provider)),
            None => app.core.run(|studio| studio.add_custom_provider(request, provider)),
        }
    }

    fn can_save(&self) -> bool {
        if self.saving.borrow().is_some() || self.name.text().trim().is_empty() || self.base.text().trim().is_empty() {
            return false;
        }
        match self.discovered.borrow().as_ref() {
            Some(found) => !found.is_empty() && !self.selected.borrow().is_empty(),
            None => self.editing.is_some(),
        }
    }

    fn sync(&self) {
        let testing = self.discover.borrow().is_some();
        self.test.set_label(if testing { "Testing…" } else { "Test Connection" });
        self.test.set_sensitive(!testing && !self.base.text().trim().is_empty());
        self.save.set_sensitive(self.can_save());
        let discovered = self.discovered.borrow();
        if let Some(found) = discovered.as_ref() {
            self.count.set_label(&format!("{} of {} enabled", self.selected.borrow().len(), found.len()));
            self.footer.set_label("Only enabled models appear in the model picker.");
        } else {
            self.count.set_label("");
            self.footer.set_label(&match &self.editing {
                Some(provider) => format!(
                    "Test the connection to change which models are enabled; otherwise the current {} stay.",
                    models_text(provider.model_count)
                ),
                None => "Test the connection to list the endpoint's models.".to_string(),
            });
        }
    }

    fn render_models(self: &Rc<Self>) {
        self.models.remove_all();
        let discovered = self.discovered.borrow().clone();
        let Some(found) = discovered else {
            self.models.set_visible(false);
            return;
        };
        self.models.set_visible(true);
        for model in &found {
            let mut detail = Vec::new();
            if model.name != model.id {
                detail.push(model.id.clone());
            }
            if model.context_window > 0 {
                detail.push(format!("{}k context", model.context_window / 1000));
            }
            let row = adw::ActionRow::builder().title(format::escape(&model.name)).activatable(true).build();
            if !detail.is_empty() {
                row.set_subtitle(&format::escape(&detail.join(" · ")));
            }
            let check = gtk::CheckButton::builder()
                .active(self.selected.borrow().contains(&model.id))
                .valign(gtk::Align::Center)
                .build();
            row.add_prefix(&check);
            row.set_activatable_widget(Some(&check));
            let (me, id) = (Rc::downgrade(self), model.id.clone());
            check.connect_toggled(move |check| {
                let Some(dialog) = me.upgrade() else { return };
                if check.is_active() {
                    dialog.selected.borrow_mut().insert(id.clone());
                } else {
                    dialog.selected.borrow_mut().remove(&id);
                }
                dialog.sync();
            });
            self.models.append(&row);
        }
        let all = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        for (label, every) in [("Select All", true), ("Select None", false)] {
            let button = gtk::Button::with_label(label);
            button.add_css_class("flat");
            let me = Rc::downgrade(self);
            button.connect_clicked(move |_| {
                let Some(dialog) = me.upgrade() else { return };
                let ids: HashSet<String> = if every {
                    dialog.discovered.borrow().iter().flatten().map(|model| model.id.clone()).collect()
                } else {
                    HashSet::new()
                };
                dialog.selected.replace(ids);
                dialog.render_models();
                dialog.sync();
            });
            all.append(&button);
        }
        let row = gtk::ListBoxRow::builder().child(&all).activatable(false).selectable(false).build();
        self.models.append(&row);
    }
}

pub fn fixture_dialog(app: &Rc<App>, editing: Option<ProviderStatus>, models: &[ProviderModel], base_url: &str) {
    present(app, editing);
    let open = DIALOG.with(|dialog| dialog.borrow().clone());
    if let Some(dialog) = open {
        dialog.name.set_text("Office vLLM");
        dialog.base.set_text(base_url);
        let request = "fixture-discover".to_string();
        dialog.discover.replace(Some(request.clone()));
        discovered(&request, base_url, models);
    }
}

pub fn open_dialog_discover(app: &Rc<App>, base_url: &str, key: &str) {
    present(app, None);
    let open = DIALOG.with(|dialog| dialog.borrow().clone());
    if let Some(dialog) = open {
        dialog.name.set_text("Smoke Stub");
        dialog.base.set_text(base_url);
        dialog.key.set_text(key);
        dialog.run_test(app);
    }
}

pub fn dialog_state() -> Option<(usize, bool)> {
    DIALOG.with(|dialog| {
        dialog
            .borrow()
            .as_ref()
            .map(|dialog| (dialog.discovered.borrow().as_ref().map_or(0, Vec::len), dialog.save.is_sensitive()))
    })
}

pub fn dialog_save(app: &Rc<App>) {
    let open = DIALOG.with(|dialog| dialog.borrow().clone());
    if let Some(dialog) = open {
        dialog.run_save(app);
    }
}
