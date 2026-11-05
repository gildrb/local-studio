use gpui::{
    Context, Entity, IntoElement, ParentElement, Render, SharedString, Styled, Window, div, px,
};
use serde_json::json;

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::settings_providers::SettingsLoadBalancingView;
use crate::features::settings::environment_row::EnvironmentRow;
use crate::features::settings::primitives::{FoldedSettingsSection, settings_switch};
use crate::ui::popover::Align;
use crate::ui::select::{Select, SelectItem, SelectSize};
use crate::ui::theme;
use crate::ui::theme::metrics::text;

const ACTION: &str = "settingsLoadBalancingChange";
const DESCRIPTION_PADDING_X: f32 = 16.;
const DESCRIPTION_PADDING_Y: f32 = 10.;
const SELECT_WIDTH: f32 = 128.;

fn option_value(value: f64) -> String {
    format!("{}", value as i64)
}

pub struct LoadBalancingBlock {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<SettingsLoadBalancingView>>>,
}

impl LoadBalancingBlock {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<SettingsLoadBalancingView>>(
            &client,
            "settingsLoadBalancing",
            json!({}),
            cx,
        );
        cx.observe(&view, |_, _, cx| cx.notify()).detach();
        Self { client, view }
    }
}

impl Render for LoadBalancingBlock {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(model) = self.view.read(cx).data.clone().flatten() else {
            return div().into_any_element();
        };
        let t = theme::active(cx);
        let toggle_client = self.client.clone();
        let rows = model.rows.iter().map(|row| {
            let client = self.client.clone();
            let environment_id = row.id.clone();
            let select = Select::new(SharedString::from(format!("load-balancing-{}", row.id)))
                .size(SelectSize::Xs)
                .align(Align::End)
                .match_trigger_width(true)
                .items(model.options.iter().map(|option| {
                    SelectItem::new(option_value(option.value), option.label.clone())
                }))
                .value(Some(option_value(row.value)))
                .disabled(row.disabled)
                .accessibility_label(row.aria_label.clone())
                .w(px(SELECT_WIDTH))
                .flex_none()
                .on_change(move |preference, _, cx| {
                    client.update(cx, |client, _| {
                        client.act(
                            ACTION,
                            json!({ "change": {
                            "kind": "set-preference",
                            "environmentId": environment_id,
                            "preference": preference.to_string(),
                        } }),
                        )
                    })
                });
            EnvironmentRow::new(row.machine_kind, row.label.clone(), row.subtitle.clone())
                .trailing(select)
                .render(cx)
        });
        FoldedSettingsSection::new(model.section.id.clone(), model.section.title.clone())
            .summary(model.summary.clone())
            .control(
                settings_switch("load-balancing-enabled", model.enabled)
                    .disabled(model.toggle_disabled)
                    .accessibility_label(model.toggle_aria_label.clone())
                    .on_change(move |enabled, _, _, cx| {
                        toggle_client.update(cx, |client, _| {
                            client.act(
                                ACTION,
                                json!({ "change": { "kind": "set-enabled", "enabled": enabled } }),
                            )
                        })
                    }),
            )
            .child(
                div()
                    .px(px(DESCRIPTION_PADDING_X))
                    .py(px(DESCRIPTION_PADDING_Y))
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.muted_foreground)
                    .child(model.description.clone()),
            )
            .children(rows.collect::<Vec<_>>())
            .into_any_element()
    }
}
