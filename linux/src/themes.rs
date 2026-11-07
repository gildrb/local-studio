use std::path::Path;
use std::rc::Rc;

use adw::prelude::*;
use gtk::{gdk, gio};
use local_studio_core::Settings;

use crate::app::App;

#[derive(Clone, Debug, PartialEq)]
pub struct Theme {
    pub name: String,
    pub dark: bool,
    pub canvas: String,
    pub sidebar: String,
    pub card: String,
    pub text: String,
    pub accent: String,
}

const BUILTIN: [(&str, bool, &str, &str, &str, &str, &str); 6] = [
    ("Local Studio", true, "#0a0a0a", "#111111", "#111111", "#ececec", "#346bf1"),
    ("Midnight", true, "#0b1020", "#0f1529", "#121a33", "#e6e9f2", "#7aa2f7"),
    ("Graphite", true, "#161616", "#1c1c1c", "#202020", "#e8e8e8", "#6cc28b"),
    ("Nord", true, "#2e3440", "#3b4252", "#3b4252", "#eceff4", "#88c0d0"),
    ("Solarized Dark", true, "#002b36", "#073642", "#073642", "#eee8d5", "#268bd2"),
    ("Paper", false, "#fbfaf8", "#f3f1ec", "#ffffff", "#1f2328", "#1b4ed8"),
];

impl Theme {
    pub fn css(&self) -> String {
        let Theme { canvas, sidebar, card, text, accent, .. } = self;
        format!(
            ":root {{ --window-bg-color: {canvas}; --view-bg-color: {canvas}; --headerbar-bg-color: {canvas}; \
             --headerbar-backdrop-color: {canvas}; --sidebar-bg-color: {sidebar}; --sidebar-backdrop-color: {sidebar}; \
             --secondary-sidebar-bg-color: {sidebar}; --card-bg-color: {card}; --dialog-bg-color: {card}; \
             --popover-bg-color: {card}; --window-fg-color: {text}; --view-fg-color: {text}; --headerbar-fg-color: {text}; \
             --sidebar-fg-color: {text}; --card-fg-color: {text}; --dialog-fg-color: {text}; --popover-fg-color: {text}; \
             --accent-bg-color: {accent}; --accent-color: {accent}; }}\n\
             .ls-composer {{ background: {card}; }}\n.ls-bubble {{ background: alpha({text}, 0.08); }}\n"
        )
    }

    fn json(&self) -> serde_json::Value {
        serde_json::json!({
            "name": self.name,
            "dark": self.dark,
            "canvas": self.canvas,
            "sidebar": self.sidebar,
            "card": self.card,
            "text": self.text,
            "accent": self.accent,
        })
    }

    fn from_json(value: &serde_json::Value) -> Option<Self> {
        let get = |key: &str| value.get(key).and_then(serde_json::Value::as_str).map(str::to_string);
        Some(Self {
            name: get("name")?,
            dark: value.get("dark").and_then(serde_json::Value::as_bool).unwrap_or(true),
            canvas: get("canvas")?,
            sidebar: get("sidebar")?,
            card: get("card")?,
            text: get("text")?,
            accent: get("accent")?,
        })
    }
}

fn custom(settings: &Settings) -> Vec<Theme> {
    serde_json::from_str::<serde_json::Value>(&settings.custom_themes)
        .ok()
        .and_then(|value| value.as_array().map(|themes| themes.iter().filter_map(Theme::from_json).collect()))
        .unwrap_or_default()
}

pub fn store(settings: &mut Settings, theme: &Theme) {
    let mut themes = custom(settings);
    themes.retain(|known| known.name != theme.name);
    themes.push(theme.clone());
    settings.custom_themes = serde_json::Value::Array(themes.iter().map(Theme::json).collect()).to_string();
    settings.theme = Some(theme.name.clone());
}

pub fn all(settings: &Settings) -> Vec<Theme> {
    let mut themes: Vec<Theme> = BUILTIN
        .iter()
        .map(|(name, dark, canvas, sidebar, card, text, accent)| Theme {
            name: (*name).to_string(),
            dark: *dark,
            canvas: (*canvas).to_string(),
            sidebar: (*sidebar).to_string(),
            card: (*card).to_string(),
            text: (*text).to_string(),
            accent: (*accent).to_string(),
        })
        .collect();
    for theme in custom(settings) {
        themes.retain(|known| known.name != theme.name);
        themes.push(theme);
    }
    themes
}

pub fn find(settings: &Settings) -> Option<Theme> {
    let name = settings.theme.as_deref()?;
    all(settings).into_iter().find(|theme| theme.name == name)
}

fn color(colors: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| colors.get(*key).and_then(serde_json::Value::as_str)).map(|value| {
        let value = value.trim();
        if value.len() == 9 && value.starts_with('#') {
            value[..7].to_string()
        } else {
            value.to_string()
        }
    })
}

fn luminance(hex: &str) -> f64 {
    let rgba = gdk::RGBA::parse(hex).unwrap_or(gdk::RGBA::BLACK);
    0.2126 * f64::from(rgba.red()) + 0.7152 * f64::from(rgba.green()) + 0.0722 * f64::from(rgba.blue())
}

pub fn import_vscode(path: &Path) -> Result<Theme, String> {
    let text = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
    let cleaned: String = text
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .fold(String::new(), |mut out, line| {
            out.push_str(line);
            out.push('\n');
            out
        })
        .replace(",\n}", "\n}")
        .replace(",\n  }", "\n  }");
    let json: serde_json::Value =
        serde_json::from_str(&cleaned).map_err(|error| format!("Not a VS Code theme: {error}"))?;
    let colors = json.get("colors").ok_or("The theme has no \"colors\" section.")?;
    let canvas = color(colors, &["editor.background"]).ok_or("The theme has no editor.background colour.")?;
    let theme = Theme {
        name: json
            .get("name")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
            .or_else(|| path.file_stem().map(|stem| stem.to_string_lossy().into_owned()))
            .unwrap_or_else(|| "Imported".to_string()),
        dark: json
            .get("type")
            .and_then(serde_json::Value::as_str)
            .map_or_else(|| luminance(&canvas) < 0.5, |kind| kind != "light"),
        sidebar: color(colors, &["sideBar.background", "activityBar.background"]).unwrap_or_else(|| canvas.clone()),
        card: color(colors, &["editorWidget.background", "input.background", "sideBar.background"])
            .unwrap_or_else(|| canvas.clone()),
        text: color(colors, &["editor.foreground", "foreground"]).unwrap_or_else(|| "#e6e6e6".to_string()),
        accent: color(colors, &["button.background", "focusBorder", "textLink.foreground"])
            .unwrap_or_else(|| "#346bf1".to_string()),
        canvas,
    };
    Ok(theme)
}

pub fn pick_import(app: &Rc<App>) {
    let filter = gtk::FileFilter::new();
    filter.set_name(Some("VS Code theme (JSON)"));
    filter.add_pattern("*.json");
    let filters = gio::ListStore::new::<gtk::FileFilter>();
    filters.append(&filter);
    let dialog = gtk::FileDialog::builder().title("Import VS Code Theme").filters(&filters).modal(true).build();
    let weak = Rc::downgrade(app);
    dialog.open(Some(&app.window), None::<&gio::Cancellable>, move |result| {
        let (Some(app), Ok(file)) = (weak.upgrade(), result) else { return };
        let Some(path) = file.path() else { return };
        match import_vscode(&path) {
            Ok(theme) => {
                let label = theme.name.clone();
                crate::settings::change(&app, move |settings| store(settings, &theme));
                app.toast(&format!("Imported theme “{label}”"));
            }
            Err(error) => app.toast(&error),
        }
    });
}

#[allow(clippy::too_many_lines)]
pub fn editor(app: &Rc<App>) {
    let settings = app.state.borrow().settings.clone();
    let current = find(&settings).unwrap_or_else(|| {
        let mut theme = all(&settings).into_iter().next().unwrap_or(Theme {
            name: String::new(),
            dark: true,
            canvas: "#0a0a0a".to_string(),
            sidebar: "#111111".to_string(),
            card: "#111111".to_string(),
            text: "#ececec".to_string(),
            accent: "#346bf1".to_string(),
        });
        theme.name = "My Theme".to_string();
        theme
    });
    let dialog = adw::Dialog::builder().title("Theme Editor").content_width(420).build();
    let page = adw::PreferencesPage::new();
    let group = adw::PreferencesGroup::builder().description("Changes preview live. Save to keep the theme.").build();
    let name = adw::EntryRow::builder().title("Name").text(&current.name).build();
    let dark = adw::SwitchRow::builder().title("Dark theme").active(current.dark).build();
    group.add(&name);
    group.add(&dark);
    let mut buttons = Vec::new();
    for (label, value) in [
        ("Canvas", &current.canvas),
        ("Sidebar", &current.sidebar),
        ("Cards", &current.card),
        ("Text", &current.text),
        ("Accent", &current.accent),
    ] {
        let button = gtk::ColorDialogButton::new(Some(gtk::ColorDialog::new()));
        button.set_rgba(&gdk::RGBA::parse(value.as_str()).unwrap_or(gdk::RGBA::BLACK));
        button.set_valign(gtk::Align::Center);
        let row = adw::ActionRow::builder().title(label).build();
        row.add_suffix(&button);
        group.add(&row);
        buttons.push(button);
    }
    page.add(&group);
    let save = gtk::Button::with_label("Save Theme");
    save.add_css_class("suggested-action");
    save.add_css_class("pill");
    save.set_halign(gtk::Align::Center);
    save.set_margin_bottom(18);
    let column = gtk::Box::new(gtk::Orientation::Vertical, 0);
    column.append(&page);
    column.append(&save);
    let view = adw::ToolbarView::new();
    view.add_top_bar(&adw::HeaderBar::new());
    view.set_content(Some(&column));
    dialog.set_child(Some(&view));
    let read = {
        let (name, dark, buttons) = (name.clone(), dark.clone(), buttons.clone());
        move || {
            let hex = |index: usize| {
                buttons.get(index).map_or_else(String::new, |button| {
                    let rgba = button.rgba();
                    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                    let channel = |value: f32| (value.clamp(0.0, 1.0) * 255.0).round() as u8;
                    format!("#{:02x}{:02x}{:02x}", channel(rgba.red()), channel(rgba.green()), channel(rgba.blue()))
                })
            };
            Theme {
                name: name.text().trim().to_string(),
                dark: dark.is_active(),
                canvas: hex(0),
                sidebar: hex(1),
                card: hex(2),
                text: hex(3),
                accent: hex(4),
            }
        }
    };
    let preview = {
        let read = read.clone();
        let weak = Rc::downgrade(app);
        move || {
            let Some(app) = weak.upgrade() else { return };
            let theme = read();
            let mut settings = app.state.borrow().settings.clone();
            settings.theme = None;
            crate::theme::apply(&settings);
            crate::theme::preview(&theme);
        }
    };
    for button in &buttons {
        let preview = preview.clone();
        button.connect_rgba_notify(move |_| preview());
    }
    let toggled = preview.clone();
    dark.connect_active_notify(move |_| toggled());
    let weak = Rc::downgrade(app);
    let closing = dialog.clone();
    save.connect_clicked(move |_| {
        let Some(app) = weak.upgrade() else { return };
        let theme = read();
        if theme.name.is_empty() {
            app.toast("Give the theme a name first.");
            return;
        }
        crate::settings::change(&app, move |settings| store(settings, &theme));
        closing.close();
    });
    let weak = Rc::downgrade(app);
    dialog.connect_closed(move |_| {
        if let Some(app) = weak.upgrade() {
            let settings = app.state.borrow().settings.clone();
            app.apply_settings(&settings);
        }
    });
    dialog.present(Some(&app.window));
}
