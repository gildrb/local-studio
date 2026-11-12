use adw::prelude::*;
use local_studio_core::{DaemonMismatch, KernelState};

use crate::format;
use crate::state::State;

pub struct Banners {
    pub notice: adw::Banner,
    pub provider: adw::Banner,
    pub kernel: adw::Banner,
    pub daemon: adw::Banner,
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
        let daemon = adw::Banner::builder().button_label("Restart Daemon").action_name("win.restart-daemon").build();
        daemon.add_css_class("ls-banner-error");
        Self { notice, provider, kernel, daemon }
    }

    pub fn render_daemon(&self, mismatch: Option<&DaemonMismatch>) {
        match mismatch {
            Some(mismatch) => {
                self.daemon.set_title(&format::escape(&mismatch.message));
                self.daemon.set_revealed(true);
            }
            None => self.daemon.set_revealed(false),
        }
    }

    pub fn render_kernel(&self, state: Option<&KernelState>, fresh: bool) {
        match state {
            Some(KernelState::Installing { detail }) => {
                let detail = detail.as_deref().unwrap_or("Downloading Python and the kernel packages.");
                self.kernel.set_title(&format::escape(&format!("Installing the Python kernel… {detail}")));
                self.kernel.set_button_label(Some("Hide"));
                self.kernel.set_action_name(None);
                self.kernel.remove_css_class("ls-banner-error");
                if fresh {
                    self.kernel.set_revealed(true);
                }
            }
            Some(KernelState::Failed { message }) => {
                self.kernel.set_title(&format::escape(&format!("The Python kernel could not be installed: {message}")));
                self.kernel.set_button_label(Some("Retry"));
                self.kernel.set_action_name(Some("win.install-kernel"));
                self.kernel.add_css_class("ls-banner-error");
                self.kernel.set_revealed(true);
            }
            _ => self.kernel.set_revealed(false),
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
