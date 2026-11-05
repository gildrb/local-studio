use gpui::{App, Entity, IntoElement, RenderOnce, SharedString, Window};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::toasts::{CoreToastActionKey, CoreToastKind, ToastsView};
use crate::ui::toast::{Toast, ToastKind, ToastViewport};

fn kind(kind: CoreToastKind) -> ToastKind {
    match kind {
        CoreToastKind::Error => ToastKind::Error,
        CoreToastKind::Warning => ToastKind::Warning,
        CoreToastKind::Success => ToastKind::Success,
        CoreToastKind::Info => ToastKind::Info,
        CoreToastKind::Loading => ToastKind::Loading,
    }
}

fn action_key(key: CoreToastActionKey) -> &'static str {
    match key {
        CoreToastActionKey::Action => "action",
        CoreToastActionKey::SecondaryAction => "secondaryAction",
    }
}

#[derive(IntoElement)]
pub struct CoreToasts {
    view: ToastsView,
    client: Entity<CoreClient>,
}

impl CoreToasts {
    pub fn new(view: &ToastsView, client: Entity<CoreClient>) -> Self {
        Self {
            view: view.clone(),
            client,
        }
    }
}

impl RenderOnce for CoreToasts {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let toasts = self.view.toasts.into_iter().map(|toast| {
            let mut element = Toast::new(SharedString::from(toast.id.clone()), toast.title.clone())
                .kind(kind(toast.kind))
                .stacked(true);
            if let Some(description) = toast.description.clone() {
                element = element.description(description);
            }
            for action in &toast.actions {
                let client = self.client.clone();
                let id = toast.id.clone();
                let key = action_key(action.key);
                element = element.action(action.label.clone(), move |_, _, cx| {
                    let params = json!({ "id": id, "key": key });
                    client.update(cx, |client, _| client.act("toastAction", params));
                });
            }
            let client = self.client.clone();
            let id = toast.id.clone();
            element.on_dismiss(move |_, _, cx| {
                let params = json!({ "id": id });
                client.update(cx, |client, _| client.act("dismissToast", params));
            })
        });
        ToastViewport::new("core-toasts").toasts(toasts)
    }
}
