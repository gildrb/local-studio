use gpui::{
    AnyElement, App, Context, Entity, InteractiveElement, IntoElement, MouseButton, MouseDownEvent,
    ParentElement, Render, SharedString, Styled, Window, div, px, svg,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::settings_archived::{ArchivedThreadRowView, SettingsArchivedView};
use crate::features::settings::primitives::{SettingsRow, SettingsSection, settings_stack};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::project_favicon::ProjectFavicon;
use crate::ui::spinner::{Spinner, SpinnerSize, SpinnerTone};
use crate::ui::theme;

const TITLE_ICON: f32 = 14.;
const FAVICON: f32 = 16.;

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

pub struct ArchivedSection {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<SettingsArchivedView>>>,
}

impl ArchivedSection {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<SettingsArchivedView>>(
            &client,
            "settingsArchived",
            json!({}),
            cx,
        );
        cx.observe(&view, |_, _, cx| cx.notify()).detach();
        Self { client, view }
    }

    fn thread_row(&self, row: &ArchivedThreadRowView) -> AnyElement {
        let menu_client = self.client.clone();
        let button_client = self.client.clone();
        let (environment_id, thread_id) = (row.environment_id.clone(), row.id.clone());
        let (button_environment, button_thread) = (row.environment_id.clone(), row.id.clone());
        div()
            .on_mouse_down(MouseButton::Right, move |event: &MouseDownEvent, _, cx| {
                cx.stop_propagation();
                let (x, y) = (f32::from(event.position.x), f32::from(event.position.y));
                act(
                    &menu_client,
                    cx,
                    "settingsArchivedContextMenu",
                    json!({ "environmentId": environment_id, "threadId": thread_id, "x": x, "y": y }),
                );
            })
            .child(
                SettingsRow::new(
                    SharedString::from(format!("archived-{}-{}", row.environment_id, row.id)),
                    row.title.clone(),
                )
                .description(row.description.clone())
                .control(
                    Button::new(SharedString::from(format!(
                        "archived-unarchive-{}-{}",
                        row.environment_id, row.id
                    )))
                    .size(ButtonSize::Xs)
                    .variant(ButtonVariant::Outline)
                    .icon("archive-x")
                    .icon_size(TITLE_ICON)
                    .label(row.primary_action.label.clone())
                    .on_click(move |_, _, cx| {
                        act(
                            &button_client,
                            cx,
                            "settingsArchivedUnarchive",
                            json!({ "environmentId": button_environment, "threadId": button_thread }),
                        );
                    }),
                ),
            )
            .into_any_element()
    }
}

impl Render for ArchivedSection {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return div().into_any_element();
        };
        let t = theme::active(cx);
        if let Some(empty) = view.empty_state.as_ref() {
            let icon = if empty.icon == "spinner" {
                Spinner::new("archived-loading")
                    .size(SpinnerSize::Sm)
                    .tone(SpinnerTone::Muted)
                    .into_any_element()
            } else {
                svg()
                    .path("icons/archive.svg")
                    .flex_none()
                    .size(px(TITLE_ICON))
                    .text_color(t.muted_foreground)
                    .into_any_element()
            };
            let mut section = SettingsSection::new(empty.section_title.clone());
            if let Some(id) = empty.section_id.clone() {
                section = section.id(id);
            }
            return section
                .child(
                    SettingsRow::new("archived-empty", empty.title.clone())
                        .title_element(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(8.))
                                .child(icon)
                                .child(empty.title.clone()),
                        )
                        .description(empty.description.clone()),
                )
                .into_any_element();
        }
        settings_stack()
            .children(view.groups.iter().map(|group| {
                let mut section = SettingsSection::new(group.title.clone())
                    .icon(ProjectFavicon::new(&group.icon, FAVICON));
                if let Some(id) = group.section_id.clone() {
                    section = section.id(id);
                }
                section.children(group.threads.iter().map(|row| self.thread_row(row)))
            }))
            .into_any_element()
    }
}
