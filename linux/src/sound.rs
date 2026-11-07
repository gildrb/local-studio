use std::cell::RefCell;

use gtk::prelude::*;
use gtk::{gio, glib};

const COMPLETION: &[u8] = include_bytes!("../assets/notification-completion.mp3");
const INPUT: &[u8] = include_bytes!("../assets/notification-input.mp3");

#[derive(Clone, Copy)]
pub enum Sound {
    Completion,
    Input,
}

thread_local! {
    static PLAYING: RefCell<Option<gtk::MediaFile>> = const { RefCell::new(None) };
}

pub fn play(sound: Sound) {
    let bytes = match sound {
        Sound::Completion => COMPLETION,
        Sound::Input => INPUT,
    };
    let stream = gio::MemoryInputStream::from_bytes(&glib::Bytes::from_static(bytes));
    let media = gtk::MediaFile::for_input_stream(&stream);
    media.set_volume(0.8);
    media.play();
    PLAYING.with(|playing| playing.replace(Some(media)));
}
