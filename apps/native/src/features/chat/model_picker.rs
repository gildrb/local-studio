use gpui::component::input::InputState;
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Bounds, ClickEvent, Entity, Focusable, FontWeight, InteractiveElement,
    IntoElement, ParentElement, Pixels, RenderOnce, SharedString, StatefulInteractiveElement,
    Styled, Window, div, px, svg,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::model_picker::{
    ModelPickerModelRow, ModelPickerRailItem, ModelPickerRow, ModelPickerView,
};
use crate::features::chat::provider_instance_icon::{ProviderInstanceIcon, parse_accent};
use crate::ui::input::bare_input;
use crate::ui::popover::{Align, Side, dropdown_glass, positioned};
use crate::ui::theme;
use crate::ui::theme::tokens::{Tokens, fade};

const SIDE_OFFSET: f32 = 4.;
const WIDTH: f32 = 362.;
const HEIGHT: f32 = 348.;
const RAIL_WIDTH: f32 = 44.;
const RAIL_FILL: f32 = 0.009;
const RAIL_PADDING: f32 = 4.;
const RAIL_BUTTON: f32 = 36.;
const RAIL_BUTTON_RADIUS: f32 = 8.;
const RAIL_GAP: f32 = 4.;
const RAIL_ICON: f32 = 20.;
const RAIL_DIVIDER: f32 = 0.042;
const RAIL_DISABLED_OPACITY: f32 = 0.5;
const RAIL_INDICATOR_WIDTH: f32 = 3.;
const RAIL_INDICATOR_HEIGHT: f32 = 20.;
const PANEL_FILL: f32 = 0.012;
const SEARCH_MARGIN_X: f32 = 12.;
const SEARCH_MARGIN_TOP: f32 = 9.;
const SEARCH_HEIGHT: f32 = 26.;
const SEARCH_PADDING_BOTTOM: f32 = 6.;
const SEARCH_TEXT: f32 = 14.;
const SEARCH_ICON: f32 = 16.;
const SEARCH_ICON_TOP: f32 = 5.;
const SEARCH_ICON_OPACITY: f32 = 0.55;
const SEARCH_TEXT_INSET: f32 = 20.;
const LIST_PADDING: f32 = 4.;
const LIST_INSET_X: f32 = 8.;
const ROW_PADDING_X: f32 = 8.;
const ROW_PADDING_Y: f32 = 4.;
const ROW_GAP: f32 = 2.;
const ROW_RADIUS: f32 = 6.;
const ROW_TEXT: f32 = 12.;
const ROW_LINE: f32 = 16.5;
const ROW_SUB_GAP: f32 = 4.;
const ROW_SUB_ICON: f32 = 12.;
const ROW_SUB_ICON_GAP: f32 = 6.;
const ROW_SUB_OPACITY: f32 = 0.7;
const ROW_SELECTED: f32 = 0.08;
const ROW_DISABLED_OPACITY: f32 = 0.64;
const STAR_BUTTON: f32 = 24.;
const STAR_ICON: f32 = 12.;
const STAR_RADIUS: f32 = 8.;
const STAR_PULL: f32 = 4.;
const LEGACY_CHEVRON: f32 = 16.;
const EMPTY_PADDING: f32 = 16.;
const SETUP_MAX_HEIGHT: f32 = 176.;
const SETUP_PADDING: f32 = 8.;
const SETUP_ITEM_PADDING_X: f32 = 4.;
const SETUP_ITEM_PADDING_Y: f32 = 6.;
const SETUP_LINE: f32 = 16.5;
const SETUP_MESSAGE_LINES: usize = 3;
const SETUP_ACTION_GAP: f32 = 4.;
const SETUP_BORDER_OPACITY: f32 = 0.7;

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: serde_json::Value) {
    client.update(cx, |client, _| client.act(action, params));
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ModelPickerActions {
    pub rail: &'static str,
    pub select: &'static str,
    pub favorite: &'static str,
    pub toggle_legacy: &'static str,
    pub close: &'static str,
    pub setup: Option<&'static str>,
}

impl ModelPickerActions {
    pub const CHAT: Self = Self {
        rail: "modelPickerRail",
        select: "modelPickerSelect",
        favorite: "modelPickerFavorite",
        toggle_legacy: "modelPickerToggleLegacy",
        close: "closeModelPicker",
        setup: None,
    };
}

#[derive(IntoElement)]
pub struct ModelPicker {
    view: ModelPickerView,
    trigger: Bounds<Pixels>,
    search: Entity<InputState>,
    client: Entity<CoreClient>,
    actions: ModelPickerActions,
    side: Side,
    align: Align,
}

impl ModelPicker {
    pub fn new(
        view: &ModelPickerView,
        trigger: Bounds<Pixels>,
        search: Entity<InputState>,
        client: Entity<CoreClient>,
    ) -> Self {
        Self {
            view: view.clone(),
            trigger,
            search,
            client,
            actions: ModelPickerActions::CHAT,
            side: Side::Top,
            align: Align::Start,
        }
    }

    pub fn actions(mut self, actions: ModelPickerActions) -> Self {
        self.actions = actions;
        self
    }

    pub fn placement(mut self, side: Side, align: Align) -> Self {
        self.side = side;
        self.align = align;
        self
    }

    fn rail_item(&self, item: &ModelPickerRailItem, t: &Tokens) -> AnyElement {
        let (id, active, disabled, icon) = match item {
            ModelPickerRailItem::Favorites { id, active, .. } => (
                id.clone(),
                *active,
                false,
                svg()
                    .path("icons/star-filled.svg")
                    .size(px(RAIL_ICON))
                    .text_color(t.foreground)
                    .into_any_element(),
            ),
            ModelPickerRailItem::Instance {
                id,
                driver_kind,
                initials,
                accent_color,
                show_instance_badge,
                active,
                disabled,
                ..
            } => {
                let icon =
                    ProviderInstanceIcon::new(driver_kind.clone(), initials.clone(), t.foreground)
                        .icon_size(RAIL_ICON)
                        .icon_opacity(if *disabled { RAIL_DISABLED_OPACITY } else { 1. });
                let icon = if *show_instance_badge {
                    icon.badge(accent_color.as_deref().and_then(parse_accent), t.popover)
                } else {
                    icon
                };
                (id.clone(), *active, *disabled, icon.into_any_element())
            }
        };
        let hover_bg = t.accent;
        let client = self.client.clone();
        let rail_id = id.clone();
        let rail_action = self.actions.rail;
        div()
            .relative()
            .flex_none()
            .w(px(RAIL_WIDTH))
            .flex()
            .justify_center()
            .child(
                div()
                    .id(SharedString::from(format!("model-picker-rail-{id}")))
                    .flex()
                    .items_center()
                    .justify_center()
                    .size(px(RAIL_BUTTON))
                    .rounded(px(RAIL_BUTTON_RADIUS))
                    .when(!disabled, |this| {
                        this.cursor_pointer()
                            .hover(move |s| s.bg(hover_bg))
                            .on_click(move |_: &ClickEvent, _, cx| {
                                act(&client, cx, rail_action, json!({ "id": rail_id }));
                            })
                    })
                    .child(icon),
            )
            .when(active, |this| {
                this.child(
                    div()
                        .absolute()
                        .right_0()
                        .top(px((RAIL_BUTTON - RAIL_INDICATOR_HEIGHT) / 2.))
                        .w(px(RAIL_INDICATOR_WIDTH))
                        .h(px(RAIL_INDICATOR_HEIGHT))
                        .rounded_l_full()
                        .bg(t.primary),
                )
            })
            .into_any_element()
    }

    fn rail(&self, t: &Tokens) -> gpui::Div {
        let mut children: Vec<AnyElement> = Vec::new();
        for (index, item) in self.view.rail.iter().enumerate() {
            children.push(self.rail_item(item, t));
            if index == 0 {
                children.push(
                    div()
                        .mx(px(RAIL_PADDING))
                        .w(px(RAIL_BUTTON))
                        .h(px(1.))
                        .bg(fade(gpui::white().into(), RAIL_DIVIDER))
                        .into_any_element(),
                );
            }
        }
        div()
            .flex()
            .flex_col()
            .flex_none()
            .gap(px(RAIL_GAP))
            .w(px(RAIL_WIDTH))
            .h_full()
            .py(px(RAIL_PADDING))
            .bg(fade(gpui::white().into(), RAIL_FILL))
            .children(children)
    }

    fn row(&self, row: &ModelPickerRow, t: &Tokens) -> AnyElement {
        let hover_bg = t.accent;
        let muted = t.muted_foreground;
        match row {
            ModelPickerRow::Model(model) => {
                let ModelPickerModelRow {
                    key,
                    instance_id,
                    slug,
                    driver_kind,
                    label,
                    provider_label,
                    selected,
                    favorite,
                    new_badge,
                    unavailable_label,
                    disabled_reason,
                } = model.as_ref();
                let disabled = disabled_reason.is_some();
                let select_client = self.client.clone();
                let favorite_client = self.client.clone();
                let params = json!({ "instanceId": instance_id, "slug": slug });
                let favorite_params = params.clone();
                let select_action = self.actions.select;
                let favorite_action = self.actions.favorite;
                div()
                    .id(SharedString::from(format!("model-picker-row-{key}")))
                    .flex()
                    .items_center()
                    .px(px(ROW_PADDING_X))
                    .py(px(ROW_PADDING_Y))
                    .rounded(px(ROW_RADIUS))
                    .when(*selected, |this| this.bg(fade(t.foreground, ROW_SELECTED)))
                    .when(disabled, |this| this.opacity(ROW_DISABLED_OPACITY))
                    .when(!disabled, |this| {
                        this.cursor_pointer()
                            .hover(move |s| s.bg(hover_bg))
                            .on_click(move |_: &ClickEvent, _, cx| {
                                act(&select_client, cx, select_action, params.clone());
                            })
                    })
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .gap(px(ROW_SUB_GAP))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(ROW_SUB_ICON_GAP))
                                    .child(
                                        div()
                                            .min_w_0()
                                            .truncate()
                                            .text_size(px(ROW_TEXT))
                                            .line_height(px(ROW_LINE))
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(t.foreground)
                                            .child(SharedString::from(label.clone())),
                                    )
                                    .when_some(new_badge.as_ref(), |this, badge| {
                                        this.child(
                                            div()
                                                .flex_none()
                                                .text_size(px(9.))
                                                .font_weight(FontWeight::BOLD)
                                                .text_color(t.update_foreground)
                                                .child(SharedString::from(badge.label.clone())),
                                        )
                                    })
                                    .when_some(unavailable_label.clone(), |this, unavailable| {
                                        this.child(
                                            div()
                                                .flex_none()
                                                .text_size(px(ROW_TEXT))
                                                .text_color(muted)
                                                .child(SharedString::from(unavailable)),
                                        )
                                    }),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(ROW_SUB_ICON_GAP))
                                    .child(
                                        ProviderInstanceIcon::new(driver_kind.clone(), "", muted)
                                            .icon_size(ROW_SUB_ICON),
                                    )
                                    .child(
                                        div()
                                            .min_w_0()
                                            .truncate()
                                            .text_size(px(ROW_TEXT))
                                            .line_height(px(ROW_LINE))
                                            .text_color(fade(muted, ROW_SUB_OPACITY))
                                            .child(SharedString::from(provider_label.clone())),
                                    ),
                            ),
                    )
                    .child(
                        div()
                            .id(SharedString::from(format!("model-picker-favorite-{key}")))
                            .flex()
                            .flex_none()
                            .items_center()
                            .justify_center()
                            .size(px(STAR_BUTTON))
                            .mr(px(-STAR_PULL))
                            .rounded(px(STAR_RADIUS))
                            .when(!disabled, |this| {
                                this.cursor_pointer()
                                    .hover(move |s| s.bg(hover_bg))
                                    .on_click(move |_: &ClickEvent, _, cx| {
                                        cx.stop_propagation();
                                        act(
                                            &favorite_client,
                                            cx,
                                            favorite_action,
                                            favorite_params.clone(),
                                        );
                                    })
                            })
                            .child(
                                svg()
                                    .path(if *favorite {
                                        "icons/star-filled.svg"
                                    } else {
                                        "icons/star.svg"
                                    })
                                    .size(px(STAR_ICON))
                                    .text_color(if *favorite { t.warning } else { muted }),
                            ),
                    )
                    .into_any_element()
            }
            ModelPickerRow::LegacySection {
                key,
                instance_id,
                label,
                count_label,
                expanded,
            } => {
                let client = self.client.clone();
                let instance_id = instance_id.clone();
                let toggle_action = self.actions.toggle_legacy;
                div()
                    .id(SharedString::from(format!("model-picker-row-{key}")))
                    .flex()
                    .items_center()
                    .px(px(ROW_PADDING_X))
                    .py(px(ROW_PADDING_Y))
                    .rounded(px(ROW_RADIUS))
                    .cursor_pointer()
                    .hover(move |s| s.bg(hover_bg))
                    .on_click(move |_: &ClickEvent, _, cx| {
                        act(
                            &client,
                            cx,
                            toggle_action,
                            json!({ "instanceId": instance_id }),
                        );
                    })
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .gap(px(ROW_SUB_GAP))
                            .text_size(px(ROW_TEXT))
                            .line_height(px(ROW_LINE))
                            .child(
                                div()
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(t.foreground)
                                    .child(SharedString::from(label.clone())),
                            )
                            .child(
                                div()
                                    .text_color(fade(muted, ROW_SUB_OPACITY))
                                    .child(SharedString::from(count_label.clone())),
                            ),
                    )
                    .child(
                        svg()
                            .path(if *expanded {
                                "icons/chevron-down.svg"
                            } else {
                                "icons/chevron-right.svg"
                            })
                            .flex_none()
                            .size(px(LEGACY_CHEVRON))
                            .text_color(muted),
                    )
                    .into_any_element()
            }
        }
    }
}

impl RenderOnce for ModelPicker {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let focused = self.search.read(cx).focus_handle(cx).is_focused(window);
        let divider = fade(gpui::white().into(), RAIL_DIVIDER);
        let rows: Vec<AnyElement> = self.view.rows.iter().map(|row| self.row(row, &t)).collect();
        let client = self.client.clone();
        let close_action = self.actions.close;
        let setup = self
            .actions
            .setup
            .filter(|_| !self.view.setup_items.is_empty())
            .map(|setup_action| {
                let items = self.view.setup_items.iter().map(|item| {
                    let client = self.client.clone();
                    let instance_id = item.instance_id.clone();
                    let hover_fg = t.foreground;
                    div()
                        .px(px(SETUP_ITEM_PADDING_X))
                        .py(px(SETUP_ITEM_PADDING_Y))
                        .text_size(px(ROW_TEXT))
                        .line_height(px(SETUP_LINE))
                        .child(
                            div()
                                .line_clamp(SETUP_MESSAGE_LINES)
                                .text_color(t.muted_foreground)
                                .child(SharedString::from(item.message.clone())),
                        )
                        .child(
                            div()
                                .id(SharedString::from(format!(
                                    "model-picker-setup-{}",
                                    item.instance_id
                                )))
                                .mt(px(SETUP_ACTION_GAP))
                                .flex_none()
                                .whitespace_nowrap()
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.foreground)
                                .cursor_pointer()
                                .hover(move |s| s.underline().text_color(hover_fg))
                                .on_click(move |_: &ClickEvent, _, cx| {
                                    act(
                                        &client,
                                        cx,
                                        setup_action,
                                        json!({ "instanceId": instance_id }),
                                    );
                                })
                                .child(SharedString::from(item.action_label.clone())),
                        )
                });
                div()
                    .id("model-picker-setup")
                    .flex_none()
                    .max_h(px(SETUP_MAX_HEIGHT))
                    .overflow_y_scroll()
                    .border_t_1()
                    .border_color(fade(t.border, SETUP_BORDER_OPACITY))
                    .p(px(SETUP_PADDING))
                    .children(items)
            });
        let list = if rows.is_empty() && setup.is_some() {
            div().flex_1().into_any_element()
        } else if rows.is_empty() {
            div()
                .p(px(EMPTY_PADDING))
                .text_size(px(ROW_TEXT))
                .text_color(t.muted_foreground)
                .child(SharedString::from(self.view.empty_state_text.clone()))
                .into_any_element()
        } else {
            div()
                .id("model-picker-list")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .p(px(LIST_PADDING))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(ROW_GAP))
                        .px(px(LIST_INSET_X))
                        .children(rows),
                )
                .into_any_element()
        };
        let surface = dropdown_glass(cx)
            .id("model-picker")
            .occlude()
            .w(px(WIDTH))
            .h(px(HEIGHT))
            .overflow_hidden()
            .on_mouse_down_out(move |_, _, cx| {
                act(&client, cx, close_action, json!({}));
            })
            .when(self.view.show_rail, |this| this.child(self.rail(&t)))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .bg(fade(gpui::white().into(), PANEL_FILL))
                    .when(self.view.show_rail, |this| {
                        this.border_l_1().border_color(divider)
                    })
                    .child(
                        div()
                            .relative()
                            .mx(px(SEARCH_MARGIN_X))
                            .mt(px(SEARCH_MARGIN_TOP))
                            .pb(px(SEARCH_PADDING_BOTTOM))
                            .border_b_1()
                            .border_color(if focused { t.primary } else { divider })
                            .child(
                                svg()
                                    .path("icons/search.svg")
                                    .absolute()
                                    .left_0()
                                    .top(px(SEARCH_ICON_TOP))
                                    .size(px(SEARCH_ICON))
                                    .text_color(fade(t.muted_foreground, SEARCH_ICON_OPACITY)),
                            )
                            .child(bare_input(
                                &self.search,
                                SEARCH_HEIGHT,
                                SEARCH_TEXT_INSET,
                                0.,
                                SEARCH_TEXT,
                                false,
                            )),
                    )
                    .child(list)
                    .children(setup),
            );
        positioned(
            self.trigger,
            self.side,
            self.align,
            SIDE_OFFSET,
            0.,
            surface,
        )
    }
}
