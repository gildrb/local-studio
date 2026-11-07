use std::path::{Path, PathBuf};

use gtk::{gio, prelude::*};

use crate::prefs;

const CANDIDATES: [(&str, &str, &[&str]); 6] = [
    ("code", "VS Code", &["code", "codium"]),
    ("cursor", "Cursor", &["cursor"]),
    ("zed", "Zed", &["zed", "zeditor"]),
    ("gnome-text-editor", "Text Editor", &["gnome-text-editor"]),
    ("nautilus", "Files", &["nautilus"]),
    ("xdg-open", "Default Application", &["xdg-open"]),
];

#[derive(Clone)]
pub struct Editor {
    pub id: &'static str,
    pub name: &'static str,
    binary: PathBuf,
}

pub struct Editors {
    pub list: Vec<Editor>,
}

impl Editors {
    pub fn detect() -> Self {
        let paths: Vec<PathBuf> =
            std::env::var_os("PATH").map(|paths| std::env::split_paths(&paths).collect()).unwrap_or_default();
        let list = CANDIDATES
            .iter()
            .filter_map(|(id, name, binaries)| {
                binaries
                    .iter()
                    .flat_map(|binary| paths.iter().map(move |dir| dir.join(binary)))
                    .find(|path| path.is_file())
                    .map(|binary| Editor { id, name, binary })
            })
            .collect();
        Self { list }
    }

    pub fn favorite(&self) -> Option<&Editor> {
        let wanted = prefs::get("editor");
        wanted.and_then(|wanted| self.list.iter().find(|editor| editor.id == wanted)).or_else(|| self.list.first())
    }

    pub fn open(&self, id: &str, path: &Path) -> Result<&'static str, String> {
        let editor =
            self.list.iter().find(|editor| editor.id == id).ok_or_else(|| format!("{id} is not installed."))?;
        let command = format!("\"{}\"", editor.binary.display());
        let info = gio::AppInfo::create_from_commandline(command, Some(editor.name), gio::AppInfoCreateFlags::NONE)
            .map_err(|error| error.to_string())?;
        info.launch(&[gio::File::for_path(path)], None::<&gio::AppLaunchContext>).map_err(|error| error.to_string())?;
        prefs::set("editor", editor.id);
        Ok(editor.name)
    }

    pub fn menu(&self) -> gio::Menu {
        let menu = gio::Menu::new();
        for editor in &self.list {
            let item = gio::MenuItem::new(Some(&format!("Open in {}", editor.name)), None);
            item.set_action_and_target_value(Some("win.open-in"), Some(&editor.id.to_variant()));
            menu.append_item(&item);
        }
        if self.list.is_empty() {
            menu.append(Some("No installed editors found"), None);
        }
        menu
    }
}
