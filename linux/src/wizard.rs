use std::rc::Rc;

use adw::prelude::*;
use local_studio_core::Connection;

use crate::app::App;
use crate::format;

#[allow(clippy::too_many_lines)]
pub fn present(app: &Rc<App>) {
    let dialog = adw::Dialog::builder().title("Welcome").content_width(560).content_height(520).can_close(true).build();
    let carousel = adw::Carousel::builder().allow_scroll_wheel(false).allow_mouse_drag(false).vexpand(true).build();
    let state = app.state.borrow();
    let connected = matches!(state.connection, Some(Connection::Ready));
    carousel.append(&page(
        "computer-symbolic",
        "Welcome to Local Studio",
        "Local Studio runs coding agents on your machines. Threads live in the Eukhe daemon, so they keep working while this window is closed.",
        &status_row(
            if connected { "Connected to the Eukhe daemon" } else { "Starting the Eukhe daemon…" },
            connected,
        ),
    ));
    let providers = adw::PreferencesGroup::new();
    if state.providers.is_empty() {
        providers.add(
            &adw::ActionRow::builder()
                .title("Providers appear once the model catalog loads")
                .subtitle("Sign in from a terminal with the eukhe CLI (/login), then refresh.")
                .build(),
        );
    }
    for provider in &state.providers {
        let row = adw::ActionRow::builder()
            .title(format::escape(&provider.name))
            .subtitle(format!("{} models", provider.model_count))
            .build();
        let label = gtk::Label::new(Some(if provider.configured { "Ready" } else { "Not signed in" }));
        label.add_css_class("ls-pill");
        if provider.configured {
            label.add_css_class("status-done");
        }
        label.set_valign(gtk::Align::Center);
        row.add_suffix(&label);
        providers.add(&row);
    }
    carousel.append(&page(
        "application-x-addon-symbolic",
        "Model providers",
        "Local Studio uses the providers Eukhe is signed in to, plus the models your Local fleet serves.",
        &providers,
    ));
    let projects = gtk::Box::new(gtk::Orientation::Vertical, 8);
    let add = gtk::Button::builder().label("Add a project folder…").action_name("win.add-project").build();
    add.add_css_class("pill");
    add.add_css_class("suggested-action");
    add.set_halign(gtk::Align::Center);
    projects.append(&add);
    let clone = gtk::Button::builder().label("Clone a repository…").action_name("win.clone-project").build();
    clone.add_css_class("pill");
    clone.set_halign(gtk::Align::Center);
    projects.append(&clone);
    let names = gtk::Label::new(Some(&if state.projects.is_empty() {
        "No projects yet. You can also start without one.".to_string()
    } else {
        state.projects.iter().map(|project| project.name.clone()).collect::<Vec<_>>().join(" · ")
    }));
    names.add_css_class("dim-label");
    names.set_wrap(true);
    projects.append(&names);
    carousel.append(&page(
        "folder-symbolic",
        "Add a project",
        "Threads start in a project folder. Git projects get branch, diff and pull request tools.",
        &projects,
    ));
    let defaults = adw::PreferencesGroup::new();
    let access_names: Vec<&str> = format::ACCESS_MODES.iter().map(|mode| format::access_label(*mode)).collect();
    let access = adw::ComboRow::builder()
        .title("Permissions for new threads")
        .model(&gtk::StringList::new(&access_names))
        .selected(format::access_index(state.settings.default_access))
        .build();
    let notify = adw::SwitchRow::builder()
        .title("Notify me when a thread finishes or needs approval")
        .active(state.settings.notifications != local_studio_core::NotificationMode::Off)
        .build();
    defaults.add(&access);
    defaults.add(&notify);
    carousel.append(&page("emblem-system-symbolic", "A few defaults", "Change these any time in Settings.", &defaults));
    drop(state);
    let dots = adw::CarouselIndicatorDots::builder().carousel(&carousel).build();
    let back = gtk::Button::with_label("Back");
    let next = gtk::Button::with_label("Next");
    next.add_css_class("suggested-action");
    let buttons = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    buttons.set_margin_start(18);
    buttons.set_margin_end(18);
    buttons.set_margin_bottom(18);
    buttons.append(&back);
    let spacer = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    spacer.set_hexpand(true);
    buttons.append(&spacer);
    buttons.append(&dots);
    let spacer = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    spacer.set_hexpand(true);
    buttons.append(&spacer);
    buttons.append(&next);
    let column = gtk::Box::new(gtk::Orientation::Vertical, 0);
    column.append(&carousel);
    column.append(&buttons);
    let view = adw::ToolbarView::new();
    view.add_top_bar(&adw::HeaderBar::new());
    view.set_content(Some(&column));
    dialog.set_child(Some(&view));
    let update = {
        let (carousel, back, next) = (carousel.clone(), back.clone(), next.clone());
        move || {
            let position = carousel.position().round();
            back.set_sensitive(position > 0.0);
            #[allow(clippy::cast_precision_loss)]
            let last = f64::from(carousel.n_pages().saturating_sub(1));
            next.set_label(if position >= last { "Get started" } else { "Next" });
        }
    };
    update();
    let refresh = update.clone();
    carousel.connect_position_notify(move |_| refresh());
    let moving = carousel.clone();
    back.connect_clicked(move |_| {
        let index = moving.position().round();
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        if let Some(page) = (index as u32).checked_sub(1).map(|index| moving.nth_page(index)) {
            moving.scroll_to(&page, false);
        }
    });
    let weak = Rc::downgrade(app);
    let (moving, closing) = (carousel.clone(), dialog.clone());
    next.connect_clicked(move |_| {
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let index = moving.position().round() as u32;
        if index + 1 < moving.n_pages() {
            moving.scroll_to(&moving.nth_page(index + 1), false);
            return;
        }
        let Some(app) = weak.upgrade() else { return };
        let mode =
            format::ACCESS_MODES.get(usize::try_from(access.selected()).unwrap_or(0)).copied().unwrap_or_default();
        let notifications = if notify.is_active() {
            local_studio_core::NotificationMode::NotificationsAndSound
        } else {
            local_studio_core::NotificationMode::Off
        };
        crate::settings::change(&app, move |settings| {
            settings.default_access = mode;
            settings.notifications = notifications;
            settings.onboarding_completed = true;
        });
        closing.close();
    });
    let weak = Rc::downgrade(app);
    dialog.connect_closed(move |_| {
        if let Some(app) = weak.upgrade() {
            if !app.state.borrow().settings.onboarding_completed {
                crate::settings::change(&app, |settings| settings.onboarding_completed = true);
            }
        }
    });
    dialog.present(Some(&app.window));
}

fn page(icon: &str, title: &str, body: &str, content: &impl IsA<gtk::Widget>) -> gtk::Box {
    let column = gtk::Box::new(gtk::Orientation::Vertical, 12);
    column.set_margin_start(32);
    column.set_margin_end(32);
    column.set_margin_top(12);
    column.set_hexpand(true);
    let image = gtk::Image::from_icon_name(icon);
    image.set_pixel_size(48);
    image.add_css_class("dim-label");
    let heading = gtk::Label::new(Some(title));
    heading.add_css_class("title-2");
    let text = gtk::Label::new(Some(body));
    text.set_wrap(true);
    text.set_justify(gtk::Justification::Center);
    text.add_css_class("dim-label");
    column.append(&image);
    column.append(&heading);
    column.append(&text);
    column.append(content);
    column
}

fn status_row(text: &str, ok: bool) -> gtk::Box {
    let row = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    row.set_halign(gtk::Align::Center);
    row.set_margin_top(12);
    let dot = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    dot.add_css_class("ls-dot");
    dot.add_css_class(if ok { "serving" } else { "loading" });
    dot.set_valign(gtk::Align::Center);
    row.append(&dot);
    row.append(&gtk::Label::new(Some(text)));
    row
}
