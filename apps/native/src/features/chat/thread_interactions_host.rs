use std::collections::HashMap;

use gpui::component::input::{InputEvent, InputState};
use gpui::prelude::FluentBuilder;
use gpui::{
    App, AppContext, Bounds, ClickEvent, Context, Entity, FocusHandle, Global, IntoElement,
    ParentElement, Pixels, Render, SharedString, Styled, Window, canvas, div, px,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::thread_interactions::{PlanSaveDialogView, ThreadInteractionsView};
use crate::platform::MONO_FONT;
use crate::ui::alert_dialog::{
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup,
    AlertDialogTitle,
};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::dialog::{
    DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle, description,
};
use crate::ui::input::Input;
use crate::ui::theme;
use crate::ui::theme::metrics::text;

const SAVE_DIALOG_MAX_WIDTH: f32 = 576.;
const LABEL_GAP: f32 = 6.;
const CODE_PADDING_X: f32 = 4.;
const CODE_RADIUS: f32 = 4.;

pub struct ThreadInteractionsHostHandle(pub Entity<ThreadInteractionsHost>);

impl Global for ThreadInteractionsHostHandle {}

pub struct ThreadInteractionsHost {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<ThreadInteractionsView>>>,
    save_path: Entity<InputState>,
    save_dialog_plan: Option<String>,
    anchors: HashMap<String, Bounds<Pixels>>,
    drawer_focus: FocusHandle,
}

impl ThreadInteractionsHost {
    pub fn drawer_focus(cx: &App) -> Option<FocusHandle> {
        Self::global(cx).map(|host| host.read(cx).drawer_focus.clone())
    }
}

pub fn send(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

pub fn on_click(
    client: &Entity<CoreClient>,
    action: &'static str,
    params: Value,
) -> impl Fn(&ClickEvent, &mut Window, &mut App) + 'static {
    let client = client.clone();
    move |_, _, cx| send(&client, cx, action, params.clone())
}

impl ThreadInteractionsHost {
    pub fn install(client: &Entity<CoreClient>, window: &mut Window, cx: &mut App) {
        if cx.has_global::<ThreadInteractionsHostHandle>() {
            return;
        }
        let host = cx.new(|cx| Self::new(client.clone(), window, cx));
        cx.set_global(ThreadInteractionsHostHandle(host));
    }

    pub fn global(cx: &App) -> Option<Entity<ThreadInteractionsHost>> {
        cx.try_global::<ThreadInteractionsHostHandle>()
            .map(|handle| handle.0.clone())
    }

    pub fn client(&self) -> &Entity<CoreClient> {
        &self.client
    }

    pub fn current(cx: &App) -> Option<ThreadInteractionsView> {
        Self::global(cx).and_then(|host| host.read(cx).view.read(cx).data.clone().flatten())
    }

    pub fn anchor_bounds(cx: &App, key: &str) -> Bounds<Pixels> {
        Self::global(cx)
            .and_then(|host| host.read(cx).anchors.get(key).copied())
            .unwrap_or_default()
    }

    pub fn anchor(key: String) -> impl IntoElement {
        canvas(
            move |bounds, _, cx| {
                if let Some(host) = Self::global(cx) {
                    host.update(cx, |host, _| {
                        host.anchors.insert(key.clone(), bounds);
                    });
                }
            },
            |_, _, _, _| {},
        )
        .absolute()
        .size_full()
    }

    fn new(client: Entity<CoreClient>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<ThreadInteractionsView>>(
            &client,
            "threadInteractions",
            json!({}),
            cx,
        );
        let save_path = cx.new(|cx| InputState::new(window, cx));
        let target = client.clone();
        cx.subscribe_in(
            &save_path,
            window,
            move |_, state: &Entity<InputState>, event: &InputEvent, _, cx| match event {
                InputEvent::Change => {
                    let path = state.read(cx).value().to_string();
                    send(&target, cx, "setPlanSavePath", json!({ "path": path }));
                }
                InputEvent::PressEnter { .. } => {
                    send(&target, cx, "savePlanToWorkspace", json!({}));
                }
                _ => {}
            },
        )
        .detach();
        cx.observe_in(&view, window, |host, _, window, cx| host.sync(window, cx))
            .detach();
        Self {
            client,
            view,
            save_path,
            save_dialog_plan: None,
            anchors: HashMap::new(),
            drawer_focus: cx.focus_handle(),
        }
    }

    fn data(&self, cx: &App) -> Option<ThreadInteractionsView> {
        self.view.read(cx).data.clone().flatten()
    }

    fn sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let dialog = self.data(cx).and_then(|view| view.plan_save_dialog);
        match dialog {
            Some(dialog) if self.save_dialog_plan.as_ref() != Some(&dialog.plan_id) => {
                self.save_dialog_plan = Some(dialog.plan_id.clone());
                self.save_path.update(cx, |state, cx| {
                    state.set_value(dialog.path.clone(), window, cx);
                    state.set_placeholder(dialog.placeholder.clone(), window, cx);
                    state.focus(window, cx);
                });
            }
            Some(_) => {}
            None => self.save_dialog_plan = None,
        }
        cx.notify();
    }

    fn revert_dialog(&self, view: &ThreadInteractionsView) -> Option<gpui::AnyElement> {
        let pending = view.pending_revert.as_ref()?;
        let client = &self.client;
        let dismiss = client.clone();
        Some(
            AlertDialogPopup::new("thread-revert-confirm")
                .on_dismiss(move |_, cx| send(&dismiss, cx, "cancelRevert", json!({})))
                .child(
                    AlertDialogHeader::new()
                        .child(AlertDialogTitle::new(pending.title.clone()))
                        .child(AlertDialogDescription::new(pending.description.clone())),
                )
                .child(
                    AlertDialogFooter::new()
                        .child(
                            Button::new("thread-revert-cancel")
                                .variant(ButtonVariant::Outline)
                                .label("Cancel")
                                .on_click(on_click(client, "cancelRevert", json!({}))),
                        )
                        .when(pending.can_restore_files, |footer| {
                            footer.child(
                                Button::new("thread-revert-files")
                                    .variant(ButtonVariant::Destructive)
                                    .label("Revert files too")
                                    .on_click(on_click(
                                        client,
                                        "confirmRevert",
                                        json!({ "restoreFiles": true }),
                                    )),
                            )
                        })
                        .child(
                            Button::new("thread-revert-keep")
                                .label("Revert and keep changes")
                                .on_click(on_click(
                                    client,
                                    "confirmRevert",
                                    json!({ "restoreFiles": false }),
                                )),
                        ),
                )
                .into_any_element(),
        )
    }

    fn save_dialog(&self, dialog: &PlanSaveDialogView, cx: &App) -> gpui::AnyElement {
        let t = theme::active(cx);
        let client = &self.client;
        let close = client.clone();
        DialogPopup::new("plan-save-dialog")
            .max_width(SAVE_DIALOG_MAX_WIDTH)
            .on_close(move |_, cx| send(&close, cx, "closePlanSaveDialog", json!({})))
            .child(
                DialogHeader::new()
                    .with_panel(true)
                    .child(DialogTitle::new("Save plan to workspace"))
                    .child(
                        description(&t, SharedString::default()).child(
                            div()
                                .flex()
                                .flex_wrap()
                                .items_center()
                                .child("Enter a path relative to ")
                                .child(
                                    div()
                                        .px(px(CODE_PADDING_X))
                                        .rounded(px(CODE_RADIUS))
                                        .bg(t.code_background)
                                        .font_family(MONO_FONT)
                                        .child(SharedString::from(dialog.workspace_root.clone())),
                                )
                                .child("."),
                        ),
                    ),
            )
            .child(
                DialogPanel::new("plan-save-panel")
                    .after_header(true)
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(LABEL_GAP))
                            .child(
                                div()
                                    .text_size(px(text::XS))
                                    .line_height(px(text::XS_LINE))
                                    .font_weight(gpui::FontWeight::MEDIUM)
                                    .text_color(t.foreground)
                                    .child("Workspace path"),
                            )
                            .child(Input::new(&self.save_path).disabled(dialog.saving)),
                    ),
            )
            .child(
                DialogFooter::new()
                    .child(
                        Button::new("plan-save-cancel")
                            .variant(ButtonVariant::Outline)
                            .size(ButtonSize::Sm)
                            .disabled(dialog.saving)
                            .label("Cancel")
                            .on_click(on_click(client, "closePlanSaveDialog", json!({}))),
                    )
                    .child(
                        Button::new("plan-save-submit")
                            .size(ButtonSize::Sm)
                            .disabled(dialog.saving)
                            .label(if dialog.saving { "Saving..." } else { "Save" })
                            .on_click(on_click(client, "savePlanToWorkspace", json!({}))),
                    ),
            )
            .into_any_element()
    }
}

impl Render for ThreadInteractionsHost {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.data(cx) else {
            return div();
        };
        div()
            .children(self.revert_dialog(&view))
            .when_some(view.plan_save_dialog.as_ref(), |root, dialog| {
                root.child(self.save_dialog(dialog, cx))
            })
    }
}
