use adw::prelude::*;
use local_studio_core::KernelState;

use crate::format;
use crate::state::State;

pub struct Banners {
    pub notice: adw::Banner,
    pub provider: adw::Banner,
    pub kernel: adw::Banner,
}

impl Banners {
    pub fn new() -> Self {
        let notice = adw::Banner::builder().button_label("Dismiss").build();
        notice.add_css_class("ls-banner-error");
        notice.connect_button_clicked(|banner| banner.set_revealed(false));
        let provider =
            adw::Banner::builder().button_label("Open Settings").action_name("win.provider-settings").build();
        let kernel = adw::Banner::new("");
        kernel.connect_button_clicked(|banner| {
            if banner.action_name().is_none() {
                banner.set_revealed(false);
            }
        });
        Self { notice, provider, kernel }
    }

    pub fn render_kernel(&self, state: Option<&KernelState>, fresh: bool) {
        let (title, button, action, error) = match state {
            Some(KernelState::Missing) => (
                "No Python 3.11+ found. Install a managed Python for the ipython tool.".to_string(),
                "Install",
                Some("win.install-kernel"),
                false,
            ),
            Some(KernelState::Installing { detail }) => {
                let detail = detail.as_deref().unwrap_or("Downloading Python for the ipython tool.");
                (format!("Installing Python… {detail}"), "Hide", None, false)
            }
            Some(KernelState::Failed { message }) => {
                (format!("Python could not be installed: {message}"), "Retry", Some("win.install-kernel"), true)
            }
            Some(KernelState::Unavailable { reason }) => {
                (format!("The ipython tool is unavailable: {reason}"), "Retry", Some("win.install-kernel"), true)
            }
            Some(KernelState::Checking | KernelState::Ready { .. }) | None => {
                self.kernel.set_revealed(false);
                return;
            }
        };
        self.kernel.set_title(&format::escape(&title));
        self.kernel.set_button_label(Some(button));
        self.kernel.set_action_name(action);
        if error {
            self.kernel.add_css_class("ls-banner-error");
        } else {
            self.kernel.remove_css_class("ls-banner-error");
        }
        if fresh || error {
            self.kernel.set_revealed(true);
        }
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
