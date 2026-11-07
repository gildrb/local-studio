use adw::prelude::*;

use crate::format;
use crate::state::State;

pub struct Banners {
    pub notice: adw::Banner,
    pub provider: adw::Banner,
}

impl Banners {
    pub fn new() -> Self {
        let notice = adw::Banner::builder().button_label("Dismiss").build();
        notice.add_css_class("ls-banner-error");
        notice.connect_button_clicked(|banner| banner.set_revealed(false));
        let provider =
            adw::Banner::builder().button_label("Open Settings").action_name("win.provider-settings").build();
        Self { notice, provider }
    }

    pub fn show_notice(&self, text: &str) {
        self.notice.set_title(&format::escape(text));
        self.notice.set_revealed(true);
    }

    pub fn render(&self, state: &State) {
        let missing = state.active_model().and_then(|key| {
            let known = state.providers.iter().find(|provider| provider.id == key.provider)?;
            (!known.configured).then(|| known.name.clone())
        });
        match missing {
            Some(name) => {
                self.provider.set_title(&format::escape(&format!(
                    "{name} is not signed in. Sign in with the eukhe CLI or pick another model."
                )));
                self.provider.set_revealed(true);
            }
            None => self.provider.set_revealed(false),
        }
    }
}
