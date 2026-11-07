use std::path::PathBuf;

use gtk::glib;

const GROUP: &str = "linux";

fn path() -> PathBuf {
    glib::user_config_dir().join("local-studio").join("linux.ini")
}

fn load() -> glib::KeyFile {
    let file = glib::KeyFile::new();
    file.load_from_file(path(), glib::KeyFileFlags::NONE).ok();
    file
}

pub fn get(key: &str) -> Option<String> {
    load().string(GROUP, key).ok().map(|value| value.to_string()).filter(|value| !value.is_empty())
}

pub fn set(key: &str, value: &str) {
    let file = load();
    file.set_string(GROUP, key, value);
    let path = path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    file.save_to_file(path).ok();
}
