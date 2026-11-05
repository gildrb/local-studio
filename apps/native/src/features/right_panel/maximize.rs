use gpui::{App, ClickEvent, Entity, IntoElement, RenderOnce, SharedString, Styled, Window, px};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::right_panel::MaximizeView;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};

const RADIUS: f32 = 10.;
const ICON: f32 = 16.;

#[derive(IntoElement)]
pub struct PanelMaximizeButton {
    view: MaximizeView,
    client: Entity<CoreClient>,
}

impl PanelMaximizeButton {
    pub fn new(view: MaximizeView, client: Entity<CoreClient>) -> Self {
        Self { view, client }
    }
}

impl RenderOnce for PanelMaximizeButton {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let client = self.client;
        Button::new("header-toggle-right-panel-maximize")
            .variant(ButtonVariant::Ghost)
            .size(ButtonSize::IconSm)
            .icon(SharedString::from(format!("icons/{}.svg", self.view.icon)))
            .icon_size(ICON)
            .rounded(px(RADIUS))
            .pressed(self.view.pressed)
            .accessibility_label(self.view.label)
            .on_click(move |_: &ClickEvent, _, cx| {
                client.update(cx, |client, _| {
                    client.act("rightPanelToggleMaximized", json!({}))
                });
            })
    }
}
