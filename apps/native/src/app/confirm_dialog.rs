use gpui::prelude::FluentBuilder;
use gpui::{
    App, AppContext, Context, Entity, FocusHandle, Global, InteractiveElement, IntoElement,
    KeyDownEvent, ParentElement, Render, Window, div,
};
use serde_json::json;

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::confirm_dialog::{ConfirmDialogVariant, ConfirmDialogView};
use crate::ui::alert_dialog::{
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup,
    AlertDialogTitle,
};
use crate::ui::button::{Button, ButtonVariant};

struct ConfirmDialogHandle(Entity<ConfirmDialogHost>);

impl Global for ConfirmDialogHandle {}

pub struct ConfirmDialogHost {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<ConfirmDialogView>>>,
    focus: FocusHandle,
}

impl ConfirmDialogHost {
    pub fn install(client: &Entity<CoreClient>, window: &mut Window, cx: &mut App) {
        if cx.has_global::<ConfirmDialogHandle>() {
            return;
        }
        let host = cx.new(|cx| Self::new(client.clone(), window, cx));
        cx.set_global(ConfirmDialogHandle(host));
    }

    pub fn global(cx: &App) -> Option<Entity<ConfirmDialogHost>> {
        cx.try_global::<ConfirmDialogHandle>()
            .map(|handle| handle.0.clone())
    }

    fn new(client: Entity<CoreClient>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<ConfirmDialogView>>(
            &client,
            "confirmDialog",
            json!({}),
            cx,
        );
        cx.observe_in(&view, window, |host, view, window, cx| {
            if view.read(cx).data.as_ref().is_some_and(Option::is_some) {
                window.focus(&host.focus, cx);
            }
            cx.notify();
        })
        .detach();
        Self {
            client,
            view,
            focus: cx.focus_handle(),
        }
    }

    fn respond(client: &Entity<CoreClient>, confirmed: bool, cx: &mut App) {
        client.update(cx, |client, _| {
            client.act("confirmDialogRespond", json!({ "confirmed": confirmed }))
        });
    }
}

impl Render for ConfirmDialogHost {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return div().into_any_element();
        };
        let cancel = self.client.clone();
        let confirm = self.client.clone();
        let escape = self.client.clone();
        div()
            .track_focus(&self.focus)
            .on_key_down(move |event: &KeyDownEvent, _, cx| {
                if event.keystroke.key == "escape" {
                    Self::respond(&escape, false, cx);
                }
            })
            .child(
                AlertDialogPopup::new("confirm-dialog")
                    .child(
                        AlertDialogHeader::new()
                            .child(AlertDialogTitle::new(view.title))
                            .when_some(view.description, |this, description| {
                                this.child(AlertDialogDescription::new(description))
                            }),
                    )
                    .child(
                        AlertDialogFooter::new()
                            .child(
                                Button::new("confirm-dialog-cancel")
                                    .variant(ButtonVariant::Outline)
                                    .label("Cancel")
                                    .on_click(move |_, _, cx| Self::respond(&cancel, false, cx)),
                            )
                            .child(
                                Button::new("confirm-dialog-confirm")
                                    .variant(match view.variant {
                                        ConfirmDialogVariant::Default => ButtonVariant::Default,
                                        ConfirmDialogVariant::Destructive => {
                                            ButtonVariant::Destructive
                                        }
                                    })
                                    .label("Confirm")
                                    .on_click(move |_, _, cx| Self::respond(&confirm, true, cx)),
                            ),
                    ),
            )
            .into_any_element()
    }
}
