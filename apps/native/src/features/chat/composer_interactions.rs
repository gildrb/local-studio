use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, BoxShadow, ClickEvent, Entity, FontWeight, InteractiveElement, IntoElement,
    KeyDownEvent, ParentElement, Rgba, SharedString, StatefulInteractiveElement, Styled, div,
    linear_color_stop, linear_gradient, point, px, svg,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::composer::{ComposerPlanActionKind, ComposerView};
use crate::app_core::views::thread_interactions::{
    ApprovalDetailFormat, ApprovalDrawerView, ThreadInteractionsDrawer, ThreadInteractionsView,
    UserInputDrawerView,
};
use crate::features::chat::thread_interactions_host::{ThreadInteractionsHost, send};
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant, DISABLED_OPACITY};
use crate::ui::menu::{MenuItem, MenuItemVariant, MenuPopup};
use crate::ui::popover::{Align, Side};
use crate::ui::theme::Appearance;
use crate::ui::theme::color::over;
use crate::ui::theme::tokens::{Tokens, fade, glass_blur, glass_saturation};

pub const DRAWER_INSET: f32 = 22.;
const SURFACE_RADIUS: f32 = 18.;
const SURFACE_UNDERLAP: f32 = 1.;
const SEAM_HEIGHT: f32 = 10.;
const SEAM_OPACITY: f32 = 0.18;
const PADDING_X: f32 = 4.;
const PADDING_Y: f32 = 4.;
const SPACIOUS_PADDING: f32 = 12.;
const ICON_COLUMN: f32 = 24.;
const ROW_GAP_X: f32 = 4.;
const APPROVAL_GAP_X: f32 = 8.;
const BANNER_TEXT: f32 = 12.;
const BANNER_LINE: f32 = 16.;
const TEXT_2XS: f32 = 11.;
const TEXT_2XS_LINE: f32 = 16.;
const TEXT_3XS: f32 = 10.;
const TEXT_3XS_LINE: f32 = 14.;
const APPROVAL_ICON: f32 = 16.;
const APPROVAL_ICON_TOP: f32 = 2.;
const CONTENT_GAP: f32 = 4.;
const ACTIONS_GAP: f32 = 4.;
const APPROVAL_ACTIONS_GAP: f32 = 6.;
const PANEL_GAP: f32 = 4.;
const HEADER_GAP: f32 = 8.;
const DETAIL_MAX_HEIGHT: f32 = 80.;
const WARNING_ICON: f32 = 12.;
const TINT: f32 = 0.08;
const WARNING_OUTLINE: f32 = 0.28;
const NEUTRAL_OUTLINE_DARK: f32 = 0.05;
const NEUTRAL_OUTLINE_LIGHT: f32 = 0.08;
const SCROLL_MAX_HEIGHT: f32 = 384.;
const BODY_PADDING_START: f32 = 28.;
const BODY_PADDING_END: f32 = 4.;
const BODY_PADDING_BOTTOM: f32 = 4.;
const QUESTION_TEXT: f32 = 14.;
const QUESTION_LINE: f32 = 20.;
const QUESTION_OPACITY: f32 = 0.85;
const HINT_TOP: f32 = 4.;
const OPTIONS_TOP: f32 = 8.;
const OPTION_GAP: f32 = 2.;
const OPTION_PADDING_X: f32 = 10.;
const OPTION_PADDING_Y: f32 = 8.;
const OPTION_RADIUS: f32 = 8.;
const OPTION_INNER_GAP: f32 = 8.;
const OPTION_LABEL_GAP: f32 = 2.;
const OPTION_SELECTED_FILL: f32 = 0.55;
const OPTION_HOVER_FILL: f32 = 0.3;
const RESPONDING_OPACITY: f32 = 0.5;
const CHECK_ICON: f32 = 14.;
const KBD_SIZE: f32 = 20.;
const TOGGLE_ICON: f32 = 14.;
const MENU_SIDE_OFFSET: f32 = 4.;
const MENU_ITEM_GAP: f32 = 4.;
const PILL_TEXT: f32 = 14.;
const PILL_LINE: f32 = 20.;
const PILL_PENDING_HEIGHT: f32 = 28.;
const PILL_PLAN_HEIGHT: f32 = 32.;
const PILL_PADDING_X: f32 = 16.;
const PILL_CHEVRON_PADDING_X: f32 = 8.;
const PILL_CHEVRON: f32 = 14.;
const PILL_DIVIDER: f32 = 0.2;
const PILL_SHADOW: f32 = 0.24;
const PENDING_GAP: f32 = 8.;
const PENDING_COMPACT_GAP: f32 = 6.;
const PILL_COMPACT_PADDING_X: f32 = 12.;
const PREVIOUS_ICON: f32 = 14.;

pub const APPROVAL_MORE_MENU: &str = "approval-more";
pub const IMPLEMENT_MENU: &str = "implement";

fn glyph(path: &str, size: f32, color: Rgba) -> gpui::Svg {
    svg()
        .path(SharedString::from(path.to_string()))
        .flex_none()
        .size(px(size))
        .text_color(color)
}

fn toggle_menu(
    client: &Entity<CoreClient>,
    menu: &'static str,
    open: bool,
) -> impl Fn(&ClickEvent, &mut gpui::Window, &mut App) + 'static {
    let client = client.clone();
    move |_, _, cx| {
        let value = if open { json!(null) } else { json!(menu) };
        send(&client, cx, "setInteractionMenu", json!({ "menu": value }));
    }
}

fn close_menu(client: &Entity<CoreClient>) -> impl Fn(&mut gpui::Window, &mut App) + 'static {
    let client = client.clone();
    move |_, cx| send(&client, cx, "setInteractionMenu", json!({ "menu": null }))
}

struct Surface {
    outline: Rgba,
    tint: Option<Rgba>,
}

fn surface(warning: bool, t: &Tokens) -> Surface {
    if warning {
        Surface {
            outline: fade(t.warning, WARNING_OUTLINE),
            tint: Some(fade(t.warning, TINT)),
        }
    } else {
        Surface {
            outline: match t.appearance {
                Appearance::Dark => fade(gpui::white().into(), NEUTRAL_OUTLINE_DARK),
                Appearance::Light => fade(gpui::black().into(), NEUTRAL_OUTLINE_LIGHT),
            },
            tint: None,
        }
    }
}

fn attached(
    content: gpui::Div,
    warning: bool,
    spacious: bool,
    fill: Rgba,
    t: &Tokens,
) -> AnyElement {
    let look = surface(warning, t);
    let background = match look.tint {
        Some(tint) => over(tint, fill),
        None => fill,
    };
    let (shadow_y, shadow_blur, shadow_alpha) = match t.appearance {
        Appearance::Dark => (14., 32., 0.75),
        Appearance::Light => (12., 28., 0.4),
    };
    div()
        .relative()
        .mx(px(DRAWER_INSET))
        .child(
            div()
                .absolute()
                .top_0()
                .left_0()
                .right_0()
                .bottom(px(-SURFACE_UNDERLAP))
                .rounded_t(px(SURFACE_RADIUS))
                .backdrop_blur(px(glass_blur(t)))
                .backdrop_saturate(glass_saturation(t))
                .border_1()
                .border_color(look.outline)
                .bg(background)
                .shadow(vec![BoxShadow {
                    color: fade(gpui::black().into(), shadow_alpha).into(),
                    offset: point(px(0.), px(shadow_y)),
                    blur_radius: px(shadow_blur),
                    spread_radius: px(-18.),
                    inset: false,
                }])
                .when(t.appearance == Appearance::Dark, |this| {
                    this.child(
                        div()
                            .absolute()
                            .left_0()
                            .right_0()
                            .bottom(px(SURFACE_UNDERLAP))
                            .h(px(SEAM_HEIGHT))
                            .bg(linear_gradient(
                                0.,
                                linear_color_stop(fade(gpui::black().into(), SEAM_OPACITY), 0.),
                                linear_color_stop(fade(gpui::black().into(), 0.), 1.),
                            )),
                    )
                }),
        )
        .child(
            content
                .relative()
                .min_w_0()
                .px(px(if spacious {
                    SPACIOUS_PADDING
                } else {
                    PADDING_X
                }))
                .py(px(if spacious {
                    SPACIOUS_PADDING
                } else {
                    PADDING_Y
                }))
                .text_size(px(BANNER_TEXT))
                .line_height(px(BANNER_LINE)),
        )
        .into_any_element()
}

fn icon_column(t: &Tokens) -> gpui::Div {
    div()
        .flex()
        .flex_none()
        .w(px(ICON_COLUMN))
        .items_center()
        .justify_center()
        .text_color(t.muted_foreground)
}

fn approval_drawer(
    approval: &ApprovalDrawerView,
    view: &ThreadInteractionsView,
    client: &Entity<CoreClient>,
    fill: Rgba,
    t: &Tokens,
    cx: &App,
) -> AnyElement {
    let responding = approval.responding;
    let menu_open = view.open_menu.as_deref() == Some(APPROVAL_MORE_MENU);
    let detail = div()
        .w_full()
        .min_w_0()
        .max_h(px(DETAIL_MAX_HEIGHT))
        .overflow_hidden()
        .text_size(px(BANNER_TEXT))
        .line_height(px(BANNER_LINE))
        .text_color(t.foreground)
        .map(|this| match approval.detail_format {
            ApprovalDetailFormat::Prose => this,
            ApprovalDetailFormat::Code => this.font_family(MONO_FONT).whitespace_nowrap(),
        })
        .child(SharedString::from(approval.detail.clone()));
    let header = div()
        .flex()
        .w_full()
        .min_w_0()
        .items_center()
        .gap(px(HEADER_GAP))
        .text_size(px(TEXT_2XS))
        .line_height(px(TEXT_2XS_LINE))
        .text_color(t.muted_foreground)
        .child(
            div()
                .flex_none()
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.warning)
                .child(SharedString::from(approval.label.clone())),
        )
        .when_some(approval.app_name.clone(), |this, name| {
            this.child(div().min_w_0().truncate().child(SharedString::from(name)))
        })
        .when_some(approval.count_label.clone(), |this, count| {
            this.child(div().ml_auto().flex_none().child(SharedString::from(count)))
        });
    let option_button =
        |option: &crate::app_core::views::thread_interactions::ApprovalOptionView| {
            let decision = option.decision.clone();
            let request_id = approval.request_id.clone();
            let target = client.clone();
            let mut button =
                Button::new(SharedString::from(format!("approval-{}", option.decision)))
                    .size(ButtonSize::Xs)
                    .variant(if option.primary {
                        ButtonVariant::Default
                    } else {
                        ButtonVariant::Outline
                    })
                    .disabled(responding)
                    .label(option.label.clone())
                    .on_click(move |_, _, cx| {
                        send(
                            &target,
                            cx,
                            "respondToApproval",
                            json!({ "requestId": request_id, "decision": decision }),
                        )
                    });
            if option.warning.is_some() {
                button = button
                    .icon("icons/triangle-alert.svg")
                    .icon_size(WARNING_ICON);
            }
            match option.warning.clone() {
                Some(warning) => div()
                    .id(SharedString::from(format!(
                        "approval-tip-{}",
                        option.decision
                    )))
                    .flex_none()
                    .tooltip(crate::ui::tooltip::Tooltip::text(warning))
                    .child(button)
                    .into_any_element(),
                None => button.into_any_element(),
            }
        };
    let more = (!approval.more_options.is_empty()).then(|| {
        div()
            .relative()
            .flex_none()
            .child(
                Button::new("approval-more")
                    .size(ButtonSize::IconXs)
                    .variant(ButtonVariant::Outline)
                    .icon("icons/ellipsis.svg")
                    .disabled(responding)
                    .accessibility_label("More approval options")
                    .on_click(toggle_menu(client, APPROVAL_MORE_MENU, menu_open)),
            )
            .child(ThreadInteractionsHost::anchor(
                APPROVAL_MORE_MENU.to_string(),
            ))
    });
    let menu = menu_open.then(|| {
        let trigger = ThreadInteractionsHost::anchor_bounds(cx, APPROVAL_MORE_MENU);
        MenuPopup::new("approval-more-menu", trigger)
            .side(Side::Top)
            .align(Align::End)
            .side_offset(MENU_SIDE_OFFSET)
            .on_dismiss(close_menu(client))
            .children(
                approval
                    .more_options
                    .iter()
                    .enumerate()
                    .map(|(index, option)| {
                        let decision = option.decision.clone();
                        let request_id = approval.request_id.clone();
                        let target = client.clone();
                        let last = index + 1 == approval.more_options.len();
                        let item = MenuItem::new(SharedString::from(format!(
                            "approval-menu-{}",
                            option.decision
                        )))
                        .variant(MenuItemVariant::Ghost)
                        .disabled(responding)
                        .on_click(move |_, _, cx| {
                            send(
                                &target,
                                cx,
                                "respondToApproval",
                                json!({ "requestId": request_id, "decision": decision }),
                            )
                        })
                        .child(
                            div()
                                .flex()
                                .flex_1()
                                .min_w_0()
                                .items_center()
                                .justify_center()
                                .gap(px(MENU_ITEM_GAP))
                                .when(option.warning.is_some(), |this| {
                                    this.child(glyph(
                                        "icons/triangle-alert.svg",
                                        WARNING_ICON,
                                        t.warning,
                                    ))
                                })
                                .child(SharedString::from(option.label.clone())),
                        );
                        let item = match option.warning.clone() {
                            Some(warning) => div()
                                .id(SharedString::from(format!(
                                    "approval-menu-tip-{}",
                                    option.decision
                                )))
                                .tooltip(crate::ui::tooltip::Tooltip::text(warning))
                                .child(item)
                                .into_any_element(),
                            None => item.into_any_element(),
                        };
                        div()
                            .when(!last, |this| this.mb(px(MENU_ITEM_GAP)))
                            .child(item)
                    }),
            )
    });
    attached(
        div()
            .flex()
            .items_start()
            .gap(px(APPROVAL_GAP_X))
            .child(icon_column(t).pt(px(APPROVAL_ICON_TOP)).child(glyph(
                "icons/shield.svg",
                APPROVAL_ICON,
                t.warning,
            )))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .items_start()
                    .gap(px(PANEL_GAP))
                    .child(header)
                    .child(detail),
            )
            .child(
                div()
                    .flex()
                    .flex_none()
                    .self_center()
                    .items_center()
                    .justify_end()
                    .gap(px(APPROVAL_ACTIONS_GAP))
                    .children(approval.primary_options.iter().map(option_button))
                    .children(more)
                    .children(menu),
            ),
        true,
        true,
        fill,
        t,
    )
}

fn shortcut_targets(input: &UserInputDrawerView) -> Vec<(String, (String, String))> {
    if input.collapsed || input.responding {
        return Vec::new();
    }
    input
        .options
        .iter()
        .filter_map(|option| {
            option.shortcut_key.map(|key| {
                (
                    key.to_string(),
                    (input.question_id.clone(), option.value.clone()),
                )
            })
        })
        .collect()
}

fn user_input_drawer(
    input: &UserInputDrawerView,
    client: &Entity<CoreClient>,
    fill: Rgba,
    t: &Tokens,
    cx: &App,
) -> AnyElement {
    let responding = input.responding;
    let toggle_client = client.clone();
    let header = div()
        .id("pending-user-input-toggle")
        .flex()
        .w_full()
        .min_w_0()
        .min_h(px(ICON_COLUMN))
        .items_center()
        .gap(px(ROW_GAP_X))
        .rounded(px(OPTION_RADIUS))
        .cursor_pointer()
        .on_click(move |_, _, cx| {
            send(
                &toggle_client,
                cx,
                "togglePendingUserInputCollapsed",
                json!({}),
            )
        })
        .child(icon_column(t))
        .child(
            div()
                .flex()
                .flex_1()
                .min_w_0()
                .items_center()
                .gap(px(CONTENT_GAP))
                .child(
                    div()
                        .flex_none()
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.muted_foreground)
                        .child(SharedString::from(input.header.clone())),
                )
                .when(input.collapsed, |this| {
                    this.child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_color(t.secondary_label)
                            .child(SharedString::from(input.question.clone())),
                    )
                }),
        )
        .child(
            div()
                .flex()
                .flex_none()
                .items_center()
                .justify_end()
                .gap(px(ACTIONS_GAP))
                .when_some(input.count_label.clone(), |this, count| {
                    this.child(
                        div()
                            .text_size(px(TEXT_3XS))
                            .line_height(px(TEXT_3XS_LINE))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.muted_foreground)
                            .child(SharedString::from(count)),
                    )
                })
                .child(
                    div()
                        .flex()
                        .flex_none()
                        .size(px(ICON_COLUMN))
                        .items_center()
                        .justify_center()
                        .child(glyph(
                            if input.collapsed {
                                "icons/chevron-up.svg"
                            } else {
                                "icons/chevron-down.svg"
                            },
                            TOGGLE_ICON,
                            t.muted_foreground,
                        )),
                )
                .when(input.dismissible, |this| {
                    let target = client.clone();
                    let request_id = input.request_id.clone();
                    this.child(
                        Button::new("pending-user-input-dismiss")
                            .size(ButtonSize::IconXs)
                            .variant(ButtonVariant::Ghost)
                            .icon("icons/x.svg")
                            .icon_size(TOGGLE_ICON)
                            .disabled(responding)
                            .accessibility_label("Dismiss question without answering")
                            .on_click(move |_, _, cx| {
                                cx.stop_propagation();
                                send(
                                    &target,
                                    cx,
                                    "dismissPendingUserInput",
                                    json!({ "requestId": request_id }),
                                )
                            }),
                    )
                }),
        );
    let selected_bg = fade(t.muted, OPTION_SELECTED_FILL);
    let hover_bg = fade(t.muted, OPTION_HOVER_FILL);
    let focus = ThreadInteractionsHost::drawer_focus(cx);
    let options = input.options.iter().map(|option| {
        let target = client.clone();
        let question_id = input.question_id.clone();
        let value = option.value.clone();
        let click_focus = focus.clone();
        div()
            .id(SharedString::from(format!(
                "pending-option-{}",
                option.value
            )))
            .flex()
            .w_full()
            .items_center()
            .gap(px(OPTION_INNER_GAP))
            .px(px(OPTION_PADDING_X))
            .py(px(OPTION_PADDING_Y))
            .rounded(px(OPTION_RADIUS))
            .text_color(if option.selected {
                t.foreground
            } else {
                fade(t.foreground, QUESTION_OPACITY)
            })
            .when(option.selected, |this| this.bg(selected_bg))
            .when(responding, |this| this.opacity(RESPONDING_OPACITY))
            .when(!responding, |this| {
                this.cursor_pointer()
                    .when(!option.selected, |this| this.hover(move |s| s.bg(hover_bg)))
                    .on_click(move |_, window, cx| {
                        if let Some(focus) = click_focus.as_ref() {
                            focus.focus(window, cx);
                        }
                        send(
                            &target,
                            cx,
                            "selectPendingUserInputOption",
                            json!({ "questionId": question_id, "optionValue": value }),
                        )
                    })
            })
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .gap(px(OPTION_LABEL_GAP))
                    .child(
                        div()
                            .text_size(px(QUESTION_TEXT))
                            .line_height(px(QUESTION_LINE))
                            .font_weight(FontWeight::MEDIUM)
                            .child(SharedString::from(option.label.clone())),
                    )
                    .when_some(option.description.clone(), |this, description| {
                        this.child(
                            div()
                                .text_size(px(TEXT_2XS))
                                .line_height(px(TEXT_2XS_LINE))
                                .text_color(t.secondary_label)
                                .child(SharedString::from(description)),
                        )
                    }),
            )
            .map(|this| {
                if option.selected {
                    this.child(glyph("icons/check.svg", CHECK_ICON, t.primary))
                } else if let Some(key) = option.shortcut_key {
                    this.child(
                        div()
                            .flex()
                            .flex_none()
                            .size(px(KBD_SIZE))
                            .items_center()
                            .justify_center()
                            .font_family(MONO_FONT)
                            .text_size(px(TEXT_3XS))
                            .line_height(px(TEXT_3XS_LINE))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.muted_foreground)
                            .child(SharedString::from(key.to_string())),
                    )
                } else {
                    this
                }
            })
    });
    let body = (!input.collapsed).then(|| {
        div()
            .id("pending-user-input-scroll")
            .max_h(px(SCROLL_MAX_HEIGHT))
            .overflow_y_scroll()
            .child(
                div()
                    .min_w_0()
                    .pl(px(BODY_PADDING_START))
                    .pr(px(BODY_PADDING_END))
                    .pb(px(BODY_PADDING_BOTTOM))
                    .child(
                        div()
                            .text_size(px(QUESTION_TEXT))
                            .line_height(px(QUESTION_LINE))
                            .text_color(fade(t.foreground, QUESTION_OPACITY))
                            .child(SharedString::from(input.question.clone())),
                    )
                    .when(input.multi_select, |this| {
                        this.child(
                            div()
                                .mt(px(HINT_TOP))
                                .text_color(t.secondary_label)
                                .child("Select one or more options."),
                        )
                    })
                    .child(
                        div()
                            .mt(px(OPTIONS_TOP))
                            .flex()
                            .flex_col()
                            .gap(px(OPTION_GAP))
                            .children(options),
                    ),
            )
    });
    attached(
        div()
            .flex()
            .flex_col()
            .when_some(focus, |this, focus| {
                let shortcuts = shortcut_targets(input);
                let target = client.clone();
                this.track_focus(&focus)
                    .on_key_down(move |event: &KeyDownEvent, _, cx| {
                        let modifiers = &event.keystroke.modifiers;
                        if modifiers.platform || modifiers.control || modifiers.alt {
                            return;
                        }
                        let Some(option) = shortcuts
                            .iter()
                            .find(|(key, _)| *key == event.keystroke.key)
                        else {
                            return;
                        };
                        cx.stop_propagation();
                        send(
                            &target,
                            cx,
                            "selectPendingUserInputOption",
                            json!({ "questionId": option.1.0, "optionValue": option.1.1 }),
                        );
                    })
            })
            .child(header)
            .children(body),
        false,
        false,
        fill,
        t,
    )
}

fn plan_follow_up_drawer(title: Option<&str>, fill: Rgba, t: &Tokens) -> AnyElement {
    attached(
        div()
            .flex()
            .min_h(px(ICON_COLUMN))
            .items_center()
            .gap(px(ROW_GAP_X))
            .child(icon_column(t))
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .items_center()
                    .gap(px(CONTENT_GAP))
                    .child(
                        div()
                            .flex_none()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.muted_foreground)
                            .child("Plan ready"),
                    )
                    .when_some(title, |this, title| {
                        this.child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .text_color(fade(t.foreground, QUESTION_OPACITY))
                                .child(SharedString::from(title.to_string())),
                        )
                    }),
            ),
        false,
        false,
        fill,
        t,
    )
}

pub fn top_drawer(
    client: &Entity<CoreClient>,
    fill: Rgba,
    t: &Tokens,
    cx: &App,
) -> Option<AnyElement> {
    let view = ThreadInteractionsHost::current(cx)?;
    Some(match view.drawer.as_ref()? {
        ThreadInteractionsDrawer::Approval(approval) => {
            approval_drawer(approval, &view, client, fill, t, cx)
        }
        ThreadInteractionsDrawer::UserInput(input) => user_input_drawer(input, client, fill, t, cx),
        ThreadInteractionsDrawer::PlanFollowUp { title } => {
            plan_follow_up_drawer(title.as_deref(), fill, t)
        }
    })
}

fn pill(id: &'static str, height: f32, disabled: bool, t: &Tokens) -> gpui::Stateful<gpui::Div> {
    let hover = t.message_action_hover;
    div()
        .id(id)
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .h(px(height))
        .rounded_full()
        .bg(t.message_action)
        .text_color(t.message_action_foreground)
        .text_size(px(PILL_TEXT))
        .line_height(px(PILL_LINE))
        .font_weight(FontWeight::MEDIUM)
        .whitespace_nowrap()
        .when(!disabled, |this| {
            this.cursor_pointer()
                .hover(move |s| s.bg(hover))
                .shadow(vec![BoxShadow {
                    color: fade(t.message_action, PILL_SHADOW).into(),
                    offset: point(px(0.), px(1.)),
                    blur_radius: px(2.),
                    spread_radius: px(0.),
                    inset: false,
                }])
        })
        .when(disabled, |this| this.opacity(DISABLED_OPACITY))
}

fn send_action(
    client: &Entity<CoreClient>,
) -> impl Fn(&ClickEvent, &mut gpui::Window, &mut App) + 'static {
    let client = client.clone();
    move |_, _, cx| send(&client, cx, "send", json!({}))
}

pub fn primary_actions(
    view: &ComposerView,
    stop: Option<AnyElement>,
    client: &Entity<CoreClient>,
    t: &Tokens,
    cx: &App,
) -> Option<AnyElement> {
    if let Some(pending) = view.pending_action.as_ref() {
        let previous_client = client.clone();
        return Some(
            div()
                .flex()
                .flex_none()
                .items_center()
                .justify_end()
                .gap(px(if pending.compact {
                    PENDING_COMPACT_GAP
                } else {
                    PENDING_GAP
                }))
                .children(stop)
                .when(pending.show_previous, |this| {
                    let previous = Button::new("pending-previous")
                        .variant(ButtonVariant::Outline)
                        .disabled(pending.previous_disabled)
                        .on_click(move |_, _, cx| {
                            send(
                                &previous_client,
                                cx,
                                "previousPendingUserInputQuestion",
                                json!({}),
                            )
                        });
                    this.child(if pending.compact {
                        previous
                            .size(ButtonSize::IconSm)
                            .icon("icons/chevron-left.svg")
                            .icon_size(PREVIOUS_ICON)
                            .accessibility_label("Previous question")
                    } else {
                        previous.size(ButtonSize::Sm).label("Previous")
                    })
                })
                .child(
                    pill("pending-submit", PILL_PENDING_HEIGHT, pending.disabled, t)
                        .px(px(if pending.compact {
                            PILL_COMPACT_PADDING_X
                        } else {
                            PILL_PADDING_X
                        }))
                        .when(!pending.disabled, |this| this.on_click(send_action(client)))
                        .child(SharedString::from(pending.label.clone())),
                )
                .into_any_element(),
        );
    }
    let plan = view.plan_action.as_ref()?;
    if plan.kind == ComposerPlanActionKind::Refine {
        return Some(
            pill("plan-refine", PILL_PLAN_HEIGHT, plan.disabled, t)
                .px(px(if plan.compact {
                    PILL_COMPACT_PADDING_X
                } else {
                    PILL_PADDING_X
                }))
                .when(!plan.disabled, |this| this.on_click(send_action(client)))
                .child(SharedString::from(plan.label.clone()))
                .into_any_element(),
        );
    }
    let menu_open = ThreadInteractionsHost::current(cx)
        .is_some_and(|view| view.open_menu.as_deref() == Some(IMPLEMENT_MENU));
    let menu = menu_open.then(|| {
        let trigger = ThreadInteractionsHost::anchor_bounds(cx, IMPLEMENT_MENU);
        let target = client.clone();
        MenuPopup::new("implement-menu", trigger)
            .side(Side::Top)
            .align(Align::End)
            .side_offset(MENU_SIDE_OFFSET)
            .on_dismiss(close_menu(client))
            .child(
                MenuItem::new("implement-new-thread")
                    .disabled(plan.disabled)
                    .label("Implement in a new thread")
                    .on_click(move |_, _, cx| {
                        send(&target, cx, "implementPlanInNewThread", json!({}))
                    }),
            )
    });
    let divider = fade(t.message_action_foreground, PILL_DIVIDER);
    Some(
        div()
            .flex()
            .flex_none()
            .items_center()
            .justify_end()
            .child(
                pill("plan-implement", PILL_PLAN_HEIGHT, plan.disabled, t)
                    .rounded_r(px(0.))
                    .px(px(PILL_PADDING_X))
                    .when(!plan.disabled, |this| this.on_click(send_action(client)))
                    .child(SharedString::from(plan.label.clone())),
            )
            .child(
                pill("plan-implement-menu", PILL_PLAN_HEIGHT, plan.disabled, t)
                    .relative()
                    .rounded_l(px(0.))
                    .border_l_1()
                    .border_color(divider)
                    .px(px(PILL_CHEVRON_PADDING_X))
                    .when(!plan.disabled, |this| {
                        this.on_click(toggle_menu(client, IMPLEMENT_MENU, menu_open))
                    })
                    .child(glyph(
                        "icons/chevron-down.svg",
                        PILL_CHEVRON,
                        t.message_action_foreground,
                    ))
                    .child(ThreadInteractionsHost::anchor(IMPLEMENT_MENU.to_string())),
            )
            .children(menu)
            .into_any_element(),
    )
}
