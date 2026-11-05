use gpui::component::input::{InputEvent, InputState};
use gpui::{
    App, AppContext, Context, Entity, Global, KeystrokeEvent, ModifiersChangedEvent, Subscription,
    Window,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::sidebar::SidebarRenameView;

struct SidebarRowsHandle(Entity<SidebarRowsHost>);

impl Global for SidebarRowsHandle {}

pub struct SidebarRowsHost {
    client: Entity<CoreClient>,
    rename_view: Entity<ViewState<Option<SidebarRenameView>>>,
    rename: Entity<InputState>,
    rename_revision: u64,
    rename_settled: bool,
    _keystrokes: Subscription,
}

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

impl SidebarRowsHost {
    pub fn install(client: &Entity<CoreClient>, window: &mut Window, cx: &mut App) {
        if cx.has_global::<SidebarRowsHandle>() {
            return;
        }
        let host = cx.new(|cx| Self::new(client.clone(), window, cx));
        cx.set_global(SidebarRowsHandle(host));
    }

    pub fn global(cx: &App) -> Option<Entity<SidebarRowsHost>> {
        cx.try_global::<SidebarRowsHandle>()
            .map(|handle| handle.0.clone())
    }

    pub fn rename_input(&self) -> Entity<InputState> {
        self.rename.clone()
    }

    pub fn on_modifiers_changed(event: &ModifiersChangedEvent, _: &mut Window, cx: &mut App) {
        let Some(host) = Self::global(cx) else {
            return;
        };
        let client = host.read(cx).client.clone();
        let modifiers = event.modifiers;
        act(
            &client,
            cx,
            "sidebarModifiers",
            json!({
                "metaKey": modifiers.platform,
                "ctrlKey": modifiers.control,
                "shiftKey": modifiers.shift,
                "altKey": modifiers.alt,
            }),
        );
    }

    fn new(client: Entity<CoreClient>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let rename_view = CoreClient::subscribe::<Option<SidebarRenameView>>(
            &client,
            "sidebarRename",
            json!({}),
            cx,
        );
        let rename = cx.new(|cx| InputState::new(window, cx));
        cx.subscribe_in(
            &rename,
            window,
            |host, state, event: &InputEvent, _, cx| match event {
                InputEvent::PressEnter { .. } | InputEvent::Blur => {
                    host.commit(state.read(cx).value().to_string(), cx)
                }
                _ => {}
            },
        )
        .detach();
        cx.observe_in(&rename_view, window, |host, _, window, cx| {
            host.sync(window, cx)
        })
        .detach();
        let keys = client.clone();
        let keystrokes = cx.observe_keystrokes(move |_, event: &KeystrokeEvent, _, cx| {
            let keystroke = &event.keystroke;
            let modifiers = keystroke.modifiers;
            if !modifiers.platform && !modifiers.control {
                return;
            }
            act(
                &keys,
                cx,
                "sidebarKeyDown",
                json!({
                    "key": keystroke.key,
                    "metaKey": modifiers.platform,
                    "ctrlKey": modifiers.control,
                    "shiftKey": modifiers.shift,
                    "altKey": modifiers.alt,
                    "repeat": false,
                }),
            );
        });
        Self {
            client,
            rename_view,
            rename,
            rename_revision: 0,
            rename_settled: true,
            _keystrokes: keystrokes,
        }
    }

    fn sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(renaming) = self.rename_view.read(cx).data.clone().flatten() else {
            self.rename_revision = 0;
            self.rename_settled = true;
            cx.notify();
            return;
        };
        if renaming.revision == self.rename_revision {
            return;
        }
        self.rename_revision = renaming.revision;
        self.rename_settled = false;
        self.rename.update(cx, |state, cx| {
            state.set_value(renaming.title, window, cx);
            state.focus(window, cx);
            state.select_all(window, cx);
        });
        cx.notify();
    }

    fn commit(&mut self, title: String, cx: &mut Context<Self>) {
        if self.rename_settled {
            return;
        }
        self.rename_settled = true;
        act(
            &self.client,
            cx,
            "sidebarRenameCommit",
            json!({ "title": title }),
        );
    }

    pub fn cancel_rename(&mut self, cx: &mut Context<Self>) {
        if self.rename_settled {
            return;
        }
        self.rename_settled = true;
        act(&self.client, cx, "sidebarRenameCancel", json!({}));
    }
}
