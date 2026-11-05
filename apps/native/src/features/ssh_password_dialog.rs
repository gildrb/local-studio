use std::time::{Duration, Instant};

use gpui::component::input::InputState;
use gpui::prelude::FluentBuilder;
use gpui::{
    App, AppContext, Context, Entity, FontWeight, Global, InteractiveElement, IntoElement,
    KeyDownEvent, ParentElement, Render, SharedString, Styled, Window, div, px,
};
use serde_json::json;

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::settings_connections::SshPasswordPromptView;
use crate::ui::button::{Button, ButtonVariant};
use crate::ui::dialog::{
    DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle,
};
use crate::ui::input::Input;
use crate::ui::theme;
use crate::ui::theme::metrics::text;

const DIALOG_WIDTH: f32 = 448.;
const TICK: Duration = Duration::from_secs(1);
const EXPIRED_MESSAGE: &str = "This SSH password prompt expired. Try connecting again.";
const KEYS_HINT: &str = "Use SSH keys to avoid repeated password prompts on new SSH sessions.";

struct SshPasswordHandle(Entity<SshPasswordHost>);

impl Global for SshPasswordHandle {}

struct ActivePrompt {
    request_id: String,
    deadline: Instant,
    input: Entity<InputState>,
}

pub struct SshPasswordHost {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<SshPasswordPromptView>>>,
    active: Option<ActivePrompt>,
    responding: bool,
}

impl SshPasswordHost {
    pub fn install(client: &Entity<CoreClient>, window: &mut Window, cx: &mut App) {
        if cx.has_global::<SshPasswordHandle>() {
            return;
        }
        let host = cx.new(|cx| Self::new(client.clone(), window, cx));
        cx.set_global(SshPasswordHandle(host));
    }

    pub fn global(cx: &App) -> Option<Entity<SshPasswordHost>> {
        cx.try_global::<SshPasswordHandle>()
            .map(|handle| handle.0.clone())
    }

    fn new(client: Entity<CoreClient>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<SshPasswordPromptView>>(
            &client,
            "sshPasswordPrompt",
            json!({}),
            cx,
        );
        cx.observe_in(&view, window, |host, view, window, cx| {
            let prompt = view.read(cx).data.clone().flatten();
            host.sync(prompt, window, cx);
            cx.notify();
        })
        .detach();
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(TICK).await;
                let alive = this.update(cx, |host, cx| {
                    if host.active.is_some() {
                        cx.notify();
                    }
                });
                if alive.is_err() {
                    return;
                }
            }
        })
        .detach();
        Self {
            client,
            view,
            active: None,
            responding: false,
        }
    }

    fn sync(
        &mut self,
        prompt: Option<SshPasswordPromptView>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(prompt) = prompt else {
            self.active = None;
            self.responding = false;
            return;
        };
        if self
            .active
            .as_ref()
            .is_some_and(|active| active.request_id == prompt.request_id)
        {
            return;
        }
        let input = cx.new(|cx| {
            let mut state = InputState::new(window, cx);
            state.set_masked(true, window, cx);
            state
        });
        input.update(cx, |state, cx| state.focus(window, cx));
        self.responding = false;
        self.active = Some(ActivePrompt {
            request_id: prompt.request_id,
            deadline: Instant::now() + Duration::from_millis(prompt.expires_in_ms.max(0.) as u64),
            input,
        });
    }

    fn respond(host: &Entity<Self>, password: Option<String>, cx: &mut App) {
        let (client, request_id) = {
            let host = host.read(cx);
            let Some(active) = host.active.as_ref() else {
                return;
            };
            if host.responding {
                return;
            }
            (host.client.clone(), active.request_id.clone())
        };
        host.update(cx, |host, cx| {
            host.responding = true;
            cx.notify();
        });
        client.update(cx, |client, _| {
            client.act(
                "sshPasswordPromptResolve",
                json!({ "requestId": request_id, "password": password }),
            )
        });
    }

    fn submit(host: &Entity<Self>, cx: &mut App) {
        let Some(active) = host.read(cx).active.as_ref() else {
            return;
        };
        if Instant::now() >= active.deadline {
            return;
        }
        let password = active.input.read(cx).value().to_string();
        Self::respond(host, Some(password), cx);
    }
}

fn remaining_label(remaining: Duration) -> String {
    let seconds = remaining.as_secs() + u64::from(remaining.subsec_nanos() > 0);
    format!("{}:{:02}", seconds / 60, seconds % 60)
}

impl Render for SshPasswordHost {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return div().into_any_element();
        };
        let Some(active) = self.active.as_ref() else {
            return div().into_any_element();
        };
        let t = theme::active(cx);
        let host = cx.entity();
        let remaining = active.deadline.saturating_duration_since(Instant::now());
        let expired = remaining.is_zero();
        let target = match &view.username {
            Some(username) => format!("{username}@{}", view.destination),
            None => view.destination.clone(),
        };
        let cancel = host.clone();
        let close = host.clone();
        let escape = host.clone();
        let enter = host.clone();
        let submit = host.clone();
        let cancel_prompt = move |host: &Entity<Self>, cx: &mut App| {
            if host
                .read(cx)
                .active
                .as_ref()
                .is_some_and(|active| Instant::now() >= active.deadline)
            {
                let request_id = host
                    .read(cx)
                    .active
                    .as_ref()
                    .map(|active| active.request_id.clone());
                let client = host.read(cx).client.clone();
                client.update(cx, |client, _| {
                    client.act(
                        "sshPasswordPromptResolve",
                        json!({ "requestId": request_id, "password": null }),
                    )
                });
                return;
            }
            Self::respond(host, None, cx);
        };
        let cancel_prompt_close = cancel_prompt;
        let cancel_prompt_escape = cancel_prompt;
        DialogPopup::new("ssh-password-prompt")
            .max_width(DIALOG_WIDTH)
            .on_close(move |_, cx| cancel_prompt_close(&close, cx))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .min_h_0()
                    .on_key_down(move |event: &KeyDownEvent, _, cx| match event.keystroke.key.as_str() {
                        "escape" => {
                            cx.stop_propagation();
                            cancel_prompt_escape(&escape, cx);
                        }
                        "enter" => {
                            cx.stop_propagation();
                            Self::submit(&enter, cx);
                        }
                        _ => {}
                    })
                    .child(
                        DialogHeader::new()
                            .with_panel(true)
                            .child(DialogTitle::new("SSH Password Required"))
                            .child(DialogDescription::new(format!(
                                "T3 needs your SSH password to connect to {target}. The password is passed to the local SSH process for this connection attempt and is not saved by T3 Code."
                            ))),
                    )
                    .child(
                        DialogPanel::new("ssh-password-panel")
                            .after_header(true)
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(8.))
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .justify_between()
                                            .gap(px(12.))
                                            .child(
                                                div()
                                                    .text_size(px(text::BASE))
                                                    .line_height(px(text::BASE_LINE))
                                                    .font_weight(FontWeight::MEDIUM)
                                                    .text_color(t.foreground)
                                                    .child(SharedString::from(view.prompt.clone())),
                                            )
                                            .child(
                                                div()
                                                    .flex_none()
                                                    .text_size(px(text::XS))
                                                    .line_height(px(text::XS_LINE))
                                                    .when(expired, |label| {
                                                        label
                                                            .font_weight(FontWeight::MEDIUM)
                                                            .text_color(t.destructive)
                                                    })
                                                    .when(!expired, |label| {
                                                        label.text_color(t.muted_foreground)
                                                    })
                                                    .child(if expired {
                                                        SharedString::from("Expired")
                                                    } else {
                                                        SharedString::from(remaining_label(remaining))
                                                    }),
                                            ),
                                    )
                                    .child(
                                        Input::new(&active.input)
                                            .disabled(self.responding || expired),
                                    ),
                            )
                            .child(
                                div()
                                    .mt(px(12.))
                                    .text_size(px(text::BASE))
                                    .line_height(px(text::BASE_LINE))
                                    .text_color(if expired { t.destructive } else { t.muted_foreground })
                                    .child(if expired { EXPIRED_MESSAGE } else { KEYS_HINT }),
                            ),
                    )
                    .child(
                        DialogFooter::new()
                            .child(
                                Button::new("ssh-password-cancel")
                                    .variant(ButtonVariant::Outline)
                                    .label(if expired { "Dismiss" } else { "Cancel" })
                                    .disabled(self.responding)
                                    .on_click(move |_, _, cx| cancel_prompt(&cancel, cx)),
                            )
                            .child(
                                Button::new("ssh-password-continue")
                                    .label("Continue")
                                    .disabled(self.responding || expired)
                                    .on_click(move |_, _, cx| Self::submit(&submit, cx)),
                            ),
                    ),
            )
            .into_any_element()
    }
}
