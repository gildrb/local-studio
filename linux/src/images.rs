use std::rc::Rc;

use adw::prelude::*;
use gtk::{gdk, glib};

use crate::app::App;
use crate::icons;

pub fn show(app: &Rc<App>, data: &[u8]) {
    let Ok(texture) = gdk::Texture::from_bytes(&glib::Bytes::from(data)) else {
        app.toast("This image could not be decoded.");
        return;
    };
    let picture = gtk::Picture::for_paintable(&texture);
    picture.set_content_fit(gtk::ContentFit::Contain);
    picture.set_can_shrink(true);
    picture.set_vexpand(true);
    let view = adw::ToolbarView::new();
    let header = adw::HeaderBar::new();
    let copy = icons::button(icons::COPY, "Copy Image");
    let copied = texture.clone();
    copy.connect_clicked(move |button| button.clipboard().set_texture(&copied));
    header.pack_start(&copy);
    view.add_top_bar(&header);
    view.set_content(Some(&picture));
    let width = texture.width().clamp(320, 1100);
    let height = texture.height().clamp(240, 760) + 48;
    let dialog = adw::Dialog::builder()
        .title(format!("Image · {} × {}", texture.width(), texture.height()))
        .content_width(width)
        .content_height(height)
        .child(&view)
        .build();
    dialog.present(Some(&app.window));
}
