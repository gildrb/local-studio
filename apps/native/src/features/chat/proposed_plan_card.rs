use gpui::component::text::TextView;
use gpui::prelude::FluentBuilder;
use gpui::{
    App, ClipboardItem, Entity, IntoElement, ParentElement, RenderOnce, SharedString, Styled,
    Window, div, linear_color_stop, linear_gradient, px,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::timeline::ProposedPlanRowView;
use crate::features::chat::thread_interactions_host::{ThreadInteractionsHost, send};
use crate::ui::badge::{Badge, BadgeVariant};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::menu::{MenuItem, MenuPopup};
use crate::ui::popover::{Align, Side};
use crate::ui::theme;
use crate::ui::theme::tokens::fade;

const ROW_PADDING_X: f32 = 4.;
const ROW_PADDING_Y: f32 = 2.;
const CARD_RADIUS: f32 = 22.;
const CARD_PADDING: f32 = 20.;
const CARD_BORDER_OPACITY: f32 = 0.8;
const CARD_FILL_OPACITY: f32 = 0.7;
const HEADER_GAP: f32 = 12.;
const TITLE_GAP: f32 = 8.;
const BODY_TOP: f32 = 16.;
const COLLAPSED_MAX_HEIGHT: f32 = 416.;
const FADE_HEIGHT: f32 = 96.;
const FADE_END_OPACITY: f32 = 0.95;
const FADE_MID_OPACITY: f32 = 0.8;
const TOGGLE_TOP: f32 = 16.;
const BODY_TEXT: f32 = 14.;
const BODY_LINE: f32 = 22.75;
const MENU_SIDE_OFFSET: f32 = 4.;

#[derive(IntoElement)]
pub struct ProposedPlanCard {
    row: ProposedPlanRowView,
    client: Entity<CoreClient>,
}

impl ProposedPlanCard {
    pub fn new(row: &ProposedPlanRowView, client: Entity<CoreClient>) -> Self {
        Self {
            row: row.clone(),
            client,
        }
    }
}

fn download(filename: String, contents: String, cx: &mut App) {
    let directory = dirs::download_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_default();
    let receiver = cx.prompt_for_new_path(&directory, Some(&filename));
    cx.spawn(async move |_| {
        if let Ok(Ok(Some(path))) = receiver.await
            && let Err(error) = std::fs::write(&path, contents)
        {
            eprintln!("could not save plan to {}: {error}", path.display());
        }
    })
    .detach();
}

impl RenderOnce for ProposedPlanCard {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let row = self.row;
        let client = self.client;
        let view = ThreadInteractionsHost::current(cx);
        let menu_key = format!("plan:{}", row.plan_id);
        let menu_open = view
            .as_ref()
            .is_some_and(|view| view.open_menu.as_deref() == Some(menu_key.as_str()));
        let copied = view
            .as_ref()
            .is_some_and(|view| view.copied_plan_id.as_deref() == Some(row.plan_id.as_str()));
        let saving = view.as_ref().is_some_and(|view| {
            view.plan_save_dialog
                .as_ref()
                .is_some_and(|dialog| dialog.plan_id == row.plan_id && dialog.saving)
        });
        let card_fill = fade(t.card, CARD_FILL_OPACITY);
        let fade_base = t.card;
        let collapsed = row.can_collapse && !row.expanded;
        let menu = menu_open.then(|| {
            let trigger = ThreadInteractionsHost::anchor_bounds(cx, &menu_key);
            let close = client.clone();
            let copy_client = client.clone();
            let plan_id = row.plan_id.clone();
            let copy_text = row.copy_text.clone();
            let download_name = row.download_filename.clone();
            let download_text = row.copy_text.clone();
            let download_client = client.clone();
            let save_client = client.clone();
            let save_plan = row.plan_id.clone();
            MenuPopup::new(SharedString::from(format!("{menu_key}-menu")), trigger)
                .side(Side::Bottom)
                .align(Align::End)
                .side_offset(MENU_SIDE_OFFSET)
                .on_dismiss(move |_, cx| {
                    send(&close, cx, "setInteractionMenu", json!({ "menu": null }))
                })
                .child(
                    MenuItem::new("plan-copy")
                        .label(if copied {
                            "Copied!"
                        } else {
                            "Copy to clipboard"
                        })
                        .on_click(move |_, _, cx| {
                            cx.write_to_clipboard(ClipboardItem::new_string(copy_text.clone()));
                            send(
                                &copy_client,
                                cx,
                                "markPlanCopied",
                                json!({ "planId": plan_id }),
                            );
                        }),
                )
                .child(
                    MenuItem::new("plan-download")
                        .label("Download as markdown")
                        .on_click(move |_, _, cx| {
                            send(
                                &download_client,
                                cx,
                                "setInteractionMenu",
                                json!({ "menu": null }),
                            );
                            download(download_name.clone(), download_text.clone(), cx);
                        }),
                )
                .child(
                    MenuItem::new("plan-save")
                        .label("Save to workspace")
                        .disabled(!row.can_save || saving)
                        .on_click(move |_, _, cx| {
                            send(
                                &save_client,
                                cx,
                                "openPlanSaveDialog",
                                json!({ "planId": save_plan }),
                            );
                        }),
                )
        });
        let toggle_client = client.clone();
        let toggle_plan = row.plan_id.clone();
        let menu_client = client.clone();
        let menu_value = if menu_open {
            serde_json::Value::Null
        } else {
            json!(menu_key.clone())
        };
        div()
            .min_w_0()
            .px(px(ROW_PADDING_X))
            .py(px(ROW_PADDING_Y))
            .child(
                div()
                    .rounded(px(CARD_RADIUS))
                    .border_1()
                    .border_color(fade(t.border, CARD_BORDER_OPACITY))
                    .bg(card_fill)
                    .p(px(CARD_PADDING))
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .items_center()
                            .justify_between()
                            .gap(px(HEADER_GAP))
                            .child(
                                div()
                                    .flex()
                                    .min_w_0()
                                    .items_center()
                                    .gap(px(TITLE_GAP))
                                    .child(
                                        Badge::new().variant(BadgeVariant::Secondary).label("Plan"),
                                    )
                                    .child(
                                        div()
                                            .min_w_0()
                                            .truncate()
                                            .text_size(px(BODY_TEXT))
                                            .font_weight(gpui::FontWeight::MEDIUM)
                                            .text_color(t.foreground)
                                            .child(SharedString::from(row.title.clone())),
                                    ),
                            )
                            .child(
                                div()
                                    .relative()
                                    .flex_none()
                                    .child(
                                        Button::new(SharedString::from(format!(
                                            "{menu_key}-trigger"
                                        )))
                                        .variant(ButtonVariant::Outline)
                                        .size(ButtonSize::IconXs)
                                        .icon("icons/ellipsis.svg")
                                        .icon_size(16.)
                                        .accessibility_label("Plan actions")
                                        .on_click(
                                            move |_, _, cx| {
                                                send(
                                                    &menu_client,
                                                    cx,
                                                    "setInteractionMenu",
                                                    json!({ "menu": menu_value.clone() }),
                                                )
                                            },
                                        ),
                                    )
                                    .child(ThreadInteractionsHost::anchor(menu_key.clone())),
                            ),
                    )
                    .child(
                        div()
                            .mt(px(BODY_TOP))
                            .child(
                                div()
                                    .relative()
                                    .when(collapsed, |this| {
                                        this.max_h(px(COLLAPSED_MAX_HEIGHT)).overflow_hidden()
                                    })
                                    .child(
                                        div()
                                            .w_full()
                                            .min_w_0()
                                            .text_size(px(BODY_TEXT))
                                            .line_height(px(BODY_LINE))
                                            .text_color(t.message_foreground)
                                            .child(
                                                TextView::markdown(
                                                    SharedString::from(format!("plan-{}", row.id)),
                                                    row.markdown.clone(),
                                                )
                                                .selectable(true),
                                            ),
                                    )
                                    .when(collapsed, |this| {
                                        this.child(
                                            div()
                                                .absolute()
                                                .left_0()
                                                .right_0()
                                                .bottom_0()
                                                .h(px(FADE_HEIGHT))
                                                .flex()
                                                .flex_col()
                                                .child(div().flex_1().bg(linear_gradient(
                                                    0.,
                                                    linear_color_stop(
                                                        fade(fade_base, FADE_MID_OPACITY),
                                                        0.,
                                                    ),
                                                    linear_color_stop(fade(fade_base, 0.), 1.),
                                                )))
                                                .child(div().flex_1().bg(linear_gradient(
                                                    0.,
                                                    linear_color_stop(
                                                        fade(fade_base, FADE_END_OPACITY),
                                                        0.,
                                                    ),
                                                    linear_color_stop(
                                                        fade(fade_base, FADE_MID_OPACITY),
                                                        1.,
                                                    ),
                                                ))),
                                        )
                                    }),
                            )
                            .when(row.can_collapse, |this| {
                                this.child(
                                    div().mt(px(TOGGLE_TOP)).flex().justify_center().child(
                                        Button::new(SharedString::from(format!(
                                            "plan-toggle-{}",
                                            row.plan_id
                                        )))
                                        .variant(ButtonVariant::Outline)
                                        .size(ButtonSize::Sm)
                                        .label(if row.expanded {
                                            "Collapse plan"
                                        } else {
                                            "Expand plan"
                                        })
                                        .on_click(
                                            move |_, _, cx| {
                                                send(
                                                    &toggle_client,
                                                    cx,
                                                    "togglePlanExpanded",
                                                    json!({ "planId": toggle_plan }),
                                                )
                                            },
                                        ),
                                    ),
                                )
                            }),
                    ),
            )
            .children(menu)
    }
}
