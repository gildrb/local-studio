use gpui::component::input::{InputEvent, InputState, TextareaState};
use gpui::{
    App, AppContext, Bounds, Context, Entity, Global, IntoElement, ParentElement, Pixels, Render,
    Window, div,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::git_actions::GitActionsView;
use crate::features::chat::git_actions_dialogs::{
    commit_dialog, default_branch_dialog, publish_dialog,
};

const COMMIT_MAX_ROWS: usize = 12;

pub struct GitActionsHostHandle(pub Entity<GitActionsHost>);

impl Global for GitActionsHostHandle {}

#[derive(Clone, Debug, PartialEq)]
pub struct HoverHint {
    pub key: String,
    pub bounds: Bounds<Pixels>,
}

pub struct GitActionsHost {
    pub client: Entity<CoreClient>,
    view: Entity<ViewState<Option<GitActionsView>>>,
    pub commit_message: Entity<TextareaState>,
    pub publish_repository: Entity<InputState>,
    pub publish_remote: Entity<InputState>,
    commit_revision: Option<u64>,
    publish_revision: Option<u64>,
    pub menu_trigger: Bounds<Pixels>,
    pub hover: Option<HoverHint>,
}

pub fn send(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

impl GitActionsHost {
    pub fn install(client: &Entity<CoreClient>, window: &mut Window, cx: &mut App) {
        if cx.has_global::<GitActionsHostHandle>() {
            return;
        }
        let host = cx.new(|cx| Self::new(client.clone(), window, cx));
        cx.set_global(GitActionsHostHandle(host));
    }

    pub fn global(cx: &App) -> Option<Entity<GitActionsHost>> {
        cx.try_global::<GitActionsHostHandle>()
            .map(|handle| handle.0.clone())
    }

    fn new(client: Entity<CoreClient>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let view =
            CoreClient::subscribe::<Option<GitActionsView>>(&client, "gitActions", json!({}), cx);
        let commit_message =
            cx.new(|cx| TextareaState::new(window, cx).auto_grow(1, COMMIT_MAX_ROWS));
        let publish_repository = cx.new(|cx| InputState::new(window, cx));
        let publish_remote = cx.new(|cx| InputState::new(window, cx));
        let target = client.clone();
        cx.subscribe_in(
            &commit_message,
            window,
            move |_, state: &Entity<TextareaState>, event: &InputEvent, _, cx| {
                if let InputEvent::Change = event {
                    let message = state.read(cx).value().to_string();
                    send(
                        &target,
                        cx,
                        "gitCommitDialogSetMessage",
                        json!({ "message": message }),
                    );
                }
            },
        )
        .detach();
        let target = client.clone();
        cx.subscribe_in(
            &publish_repository,
            window,
            move |_, state: &Entity<InputState>, event: &InputEvent, _, cx| match event {
                InputEvent::Change => {
                    let value = state.read(cx).value().to_string();
                    send(
                        &target,
                        cx,
                        "gitPublishSetRepository",
                        json!({ "value": value }),
                    );
                }
                InputEvent::PressEnter { .. } => {
                    send(&target, cx, "gitPublishSubmit", json!({}));
                }
                _ => {}
            },
        )
        .detach();
        let target = client.clone();
        cx.subscribe_in(
            &publish_remote,
            window,
            move |_, state: &Entity<InputState>, event: &InputEvent, _, cx| {
                if let InputEvent::Change = event {
                    let value = state.read(cx).value().to_string();
                    send(
                        &target,
                        cx,
                        "gitPublishSetRemoteName",
                        json!({ "value": value }),
                    );
                }
            },
        )
        .detach();
        cx.observe_in(&view, window, |host, _, window, cx| host.sync(window, cx))
            .detach();
        Self {
            client,
            view,
            commit_message,
            publish_repository,
            publish_remote,
            commit_revision: None,
            publish_revision: None,
            menu_trigger: Bounds::default(),
            hover: None,
        }
    }

    pub fn view(&self, cx: &App) -> Option<GitActionsView> {
        self.view.read(cx).data.clone().flatten()
    }

    pub fn set_hover(&mut self, hover: Option<HoverHint>, cx: &mut Context<Self>) {
        if self.hover != hover {
            self.hover = hover;
            cx.notify();
        }
    }

    fn sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let view = self.view(cx);
        let commit = view.as_ref().and_then(|view| view.commit_dialog.as_ref());
        match commit {
            Some(dialog) if self.commit_revision != Some(dialog.revision) => {
                self.commit_revision = Some(dialog.revision);
                let placeholder = dialog.message_placeholder.clone();
                self.commit_message.update(cx, |state, cx| {
                    state.set_value("", window, cx);
                    state.set_placeholder(placeholder, window, cx);
                    state.focus(window, cx);
                });
            }
            Some(_) => {}
            None => self.commit_revision = None,
        }
        let publish = view.as_ref().and_then(|view| view.publish_dialog.as_ref());
        match publish {
            Some(dialog) if self.publish_revision != Some(dialog.revision) => {
                self.publish_revision = Some(dialog.revision);
                let repository = dialog.repository.clone();
                let placeholder = dialog.path_placeholder.clone();
                let remote = dialog.remote_name.clone();
                self.publish_repository.update(cx, |state, cx| {
                    state.set_value(repository, window, cx);
                    state.set_placeholder(placeholder, window, cx);
                });
                self.publish_remote.update(cx, |state, cx| {
                    state.set_value(remote, window, cx);
                    state.set_placeholder("origin", window, cx);
                });
            }
            Some(_) => {}
            None => self.publish_revision = None,
        }
        if view.as_ref().is_none_or(|view| !view.menu_open) && self.hover.is_some() {
            self.hover = None;
        }
        cx.notify();
    }
}

impl Render for GitActionsHost {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let view = self.view(cx);
        let mut root = div();
        let Some(view) = view else {
            return root;
        };
        if let Some(dialog) = view.commit_dialog {
            root = root.child(commit_dialog(
                dialog,
                &self.client,
                &self.commit_message,
                window,
                cx,
            ));
        }
        if let Some(dialog) = view.default_branch_dialog {
            root = root.child(default_branch_dialog(dialog, &self.client));
        }
        if let Some(dialog) = view.publish_dialog {
            root = root.child(publish_dialog(
                dialog,
                &self.client,
                &self.publish_repository,
                &self.publish_remote,
                cx,
            ));
        }
        root
    }
}
