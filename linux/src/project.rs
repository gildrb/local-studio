use std::rc::Rc;

use adw::prelude::*;

use crate::app::App;
use crate::format;

const ICONS: [&str; 12] = ["🧪", "🚀", "🛠", "📦", "🧠", "🌿", "🔥", "🎛", "🧩", "📊", "🖥", "🌙"];

#[allow(clippy::too_many_lines)]
pub fn present(app: &Rc<App>, project: &str) {
    let Some(info) = app.state.borrow().project(project).cloned() else {
        app.toast("That project is no longer in Local Studio.");
        return;
    };
    let dialog = adw::PreferencesDialog::builder().title(format::escape(&info.name)).content_width(560).build();
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
    let icon = adw::EntryRow::builder()
        .title("Icon (emoji or text)")
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
    identity.add(&icon);
    let picks = gtk::FlowBox::builder().selection_mode(gtk::SelectionMode::None).max_children_per_line(12).build();
    picks.set_margin_top(6);
    for emoji in ICONS {
        let button = gtk::Button::with_label(emoji);
        button.add_css_class("flat");
        let (weak, id, field) = (Rc::downgrade(app), info.id.clone(), icon.clone());
        button.connect_clicked(move |_| {
            let Some(app) = weak.upgrade() else { return };
            field.set_text(emoji);
            let id = id.clone();
            app.core.run(|studio| studio.set_project_icon(id, Some(emoji.to_string())));
        });
        picks.append(&button);
    }
    identity.add(&picks);
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
    let kind = adw::ActionRow::builder()
        .title("Source control")
        .subtitle(if info.is_git { "Git repository" } else { "Not a git repository" })
        .build();
    identity.add(&kind);
    page.add(&identity);
    let threads = app.state.borrow().threads.iter().filter(|row| row.project.as_deref() == Some(project)).count();
    let overrides = adw::PreferencesGroup::builder()
        .title("Defaults for this project")
        .description("This project uses the global defaults from Settings → General. Per-project overrides arrive with the core's scoped settings.")
        .build();
    let open_general = adw::ActionRow::builder().title("Open global defaults").activatable(true).build();
    open_general.add_suffix(&gtk::Image::from_icon_name("go-next-symbolic"));
    let weak = Rc::downgrade(app);
    let closing = dialog.clone();
    open_general.connect_activated(move |_| {
        if let Some(app) = weak.upgrade() {
            closing.close();
            app.open_settings(Some("general"));
        }
    });
    overrides.add(&open_general);
    page.add(&overrides);
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
    dialog.add(&page);
    dialog.present(Some(&app.window));
}
