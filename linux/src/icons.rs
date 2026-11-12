use gtk::gdk;
use gtk::prelude::*;

pub const SIZE: i32 = 16;
pub const HERO: i32 = 48;

pub const ADD: &str = "list-add-symbolic";
pub const CLOSE: &str = "window-close-symbolic";
pub const STOP: &str = "media-playback-stop-symbolic";
pub const RUN: &str = "media-playback-start-symbolic";
pub const UP: &str = "go-up-symbolic";
pub const DOWN: &str = "go-down-symbolic";
pub const BACK: &str = "go-previous-symbolic";
pub const FORWARD: &str = "go-next-symbolic";
pub const EXPANDED: &str = "pan-down-symbolic";
pub const COLLAPSED: &str = "pan-end-symbolic";
pub const REFRESH: &str = "view-refresh-symbolic";
pub const COPY: &str = "edit-copy-symbolic";
pub const EDIT: &str = "document-edit-symbolic";
pub const RESET: &str = "edit-undo-symbolic";
pub const DELETE: &str = "user-trash-symbolic";
pub const ARCHIVE: &str = "folder-download-symbolic";
pub const SETTINGS: &str = "emblem-system-symbolic";
pub const FOLDER: &str = "folder-symbolic";
pub const FOLDER_OPEN: &str = "folder-open-symbolic";
pub const FOLDER_NEW: &str = "folder-new-symbolic";
pub const FILE: &str = "text-x-generic-symbolic";
pub const TERMINAL: &str = "utilities-terminal-symbolic";
pub const SIDEBAR: &str = "sidebar-show-symbolic";
pub const PANEL: &str = "sidebar-show-right-symbolic";
pub const SPLIT: &str = "view-dual-symbolic";
pub const MAXIMIZE: &str = "view-fullscreen-symbolic";
pub const MORE: &str = "view-more-symbolic";
pub const ATTACH: &str = "mail-attachment-symbolic";
pub const UNREAD: &str = "mail-unread-symbolic";
pub const PIN: &str = "view-pin-symbolic";
pub const DONE: &str = "object-select-symbolic";
pub const WORKING: &str = "content-loading-symbolic";
pub const APPROVAL: &str = "dialog-question-symbolic";
pub const ERROR: &str = "dialog-error-symbolic";
pub const WARNING: &str = "dialog-warning-symbolic";
pub const INFO: &str = "help-about-symbolic";
pub const TIME: &str = "document-open-recent-symbolic";
pub const WATCH: &str = "view-reveal-symbolic";
pub const SEARCH: &str = "system-search-symbolic";
pub const WEB: &str = "web-browser-symbolic";
pub const AGENT: &str = "avatar-default-symbolic";
pub const TOOL: &str = "preferences-system-symbolic";
pub const LOCKED: &str = "changes-prevent-symbolic";
pub const UNLOCKED: &str = "changes-allow-symbolic";
pub const GOAL: &str = "mark-location-symbolic";
pub const PULL_REQUESTS: &str = "preferences-system-sharing-symbolic";
pub const DEVICE: &str = "phone-symbolic";
pub const USAGE: &str = "power-profile-performance-symbolic";
pub const SERVER: &str = "network-server-symbolic";
pub const OFFLINE: &str = "network-offline-symbolic";
pub const UNREACHABLE: &str = "network-error-symbolic";
pub const KEYBOARD: &str = "input-keyboard-symbolic";
pub const PROVIDERS: &str = "application-x-addon-symbolic";
pub const APPEARANCE: &str = "preferences-desktop-appearance-symbolic";
pub const STORAGE: &str = "drive-harddisk-symbolic";
pub const STARRED: &str = "starred-symbolic";
pub const STAR_ADD: &str = "star-new-symbolic";
pub const NONE: &str = "list-remove-symbolic";
pub const BRANCH: &str = "media-record-symbolic";
pub const SAVE: &str = "document-save-symbolic";
pub const SWITCH: &str = "network-transmit-receive-symbolic";
pub const COMPACTED: &str = "view-restore-symbolic";
pub const ALL: &str = "view-grid-symbolic";
pub const COMPUTER: &str = "computer-symbolic";

pub const STACKED: &str = "ls-icon-stacked";

const CSS: &str = r"
.ls-icon-button image, .ls-icon-button > button image { opacity: 1; }
.ls-icon-stacked image { -gtk-icon-transform: rotate(90deg); }
.ls-footer button { min-width: 30px; min-height: 30px; }
.ls-bulk button { min-width: 28px; min-height: 28px; }
.ls-panel-bar button { min-width: 28px; min-height: 28px; }
.ls-drawer-bar button { min-width: 28px; min-height: 28px; padding: 0; }
.ls-row-actions button { min-width: 28px; min-height: 28px; padding: 0 4px; }
.ls-user-row .ls-row-actions { opacity: 0; }
.ls-user-row:hover .ls-row-actions, .ls-user-row:focus-within .ls-row-actions { opacity: 1; }
.ls-chip-remove { min-width: 24px; min-height: 24px; padding: 0; margin: 0; }
.ls-tab-close { min-width: 24px; min-height: 24px; padding: 0; }
.ls-picker-remove { min-width: 24px; min-height: 24px; padding: 0; }
.ls-minimap-button { min-width: 24px; min-height: 24px; padding: 0; }
.ls-minimap drawingarea { opacity: 0.55; }
.ls-minimap:hover drawingarea { opacity: 1; }
.ls-picker-icon { min-width: 16px; }
.ls-shelf image { color: var(--sidebar-fg-color); }
.ls-summary image { color: var(--window-fg-color); }
";

const HIGH_CONTRAST: &str = r"
image, image.dim-label, .dim-label image, .ls-user-row .ls-row-actions, .ls-minimap drawingarea, .ls-thread.receded { opacity: 1; }
image.dim-label, image.ls-meta { color: inherit; }
.ls-footer button.active, .ls-tab.active, button:checked { box-shadow: inset 0 0 0 2px currentColor; }
";

pub fn install(display: &gdk::Display) {
    let base = gtk::CssProvider::new();
    base.load_from_string(CSS);
    gtk::style_context_add_provider_for_display(display, &base, gtk::STYLE_PROVIDER_PRIORITY_APPLICATION + 3);
    let contrast = gtk::CssProvider::new();
    contrast.load_from_string(HIGH_CONTRAST);
    let display = display.clone();
    let apply = move |manager: &adw::StyleManager| {
        if manager.is_high_contrast() {
            gtk::style_context_add_provider_for_display(
                &display,
                &contrast,
                gtk::STYLE_PROVIDER_PRIORITY_APPLICATION + 4,
            );
        } else {
            gtk::style_context_remove_provider_for_display(&display, &contrast);
        }
    };
    let manager = adw::StyleManager::default();
    apply(&manager);
    manager.connect_high_contrast_notify(apply);
}

pub fn image(name: &str) -> gtk::Image {
    let image = gtk::Image::from_icon_name(name);
    image.set_pixel_size(SIZE);
    image
}

pub fn styled(name: &str, class: &str) -> gtk::Image {
    let image = image(name);
    image.add_css_class(class);
    image
}

pub fn button(name: &str, label: &str) -> gtk::Button {
    let button = gtk::Button::from_icon_name(name);
    describe(&button, label);
    button
}

pub fn flat(name: &str, label: &str) -> gtk::Button {
    let button = button(name, label);
    button.add_css_class("flat");
    button
}

pub fn describe(widget: &(impl IsA<gtk::Widget> + IsA<gtk::Accessible>), label: &str) {
    widget.set_tooltip_text(Some(label));
    widget.update_property(&[gtk::accessible::Property::Label(label)]);
    widget.add_css_class("ls-icon-button");
}
