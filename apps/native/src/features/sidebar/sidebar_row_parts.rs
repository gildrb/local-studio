use gpui::component::input::InputState;
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Bounds, ClickEvent, Div, ElementId, Entity, FontWeight, InteractiveElement,
    IntoElement, KeyDownEvent, ParentElement, Pixels, Rgba, SharedString, Stateful,
    StatefulInteractiveElement, Styled, Window, canvas, div, px, svg,
};
use serde_json::{Value, json};

use crate::app_core::client::CoreClient;
use crate::app_core::views::sidebar::SidebarThreadRowView;
use crate::features::sidebar::sidebar_rows_host::SidebarRowsHost;
use crate::platform::MONO_FONT;
use crate::ui::input::bare_input;
use crate::ui::menu::{MenuItem, MenuPopup, MenuSeparator};
use crate::ui::popover::{Align, Side};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const ACTION_RADIUS: f32 = 8.;
const ACTION_PADDING: f32 = 6.;
const SETTLE_PADDING: f32 = 8.;
const TEXT_XS: f32 = 12.;
const TEXT_XS_LINE: f32 = 16.;
const TEXT_SM: f32 = 14.;
const TEXT_SM_LINE: f32 = 20.;
const SNOOZE_MENU_OFFSET: f32 = 4.;
const PIN_TEXT: f32 = 0.65;
const RENAME_RADIUS: f32 = 6.;
const RENAME_PADDING: f32 = 4.;
const RENAME_HEIGHT: f32 = 22.;
const JUMP_HINT_HEIGHT: f32 = 20.;
const JUMP_HINT_RIGHT: f32 = 6.;
const JUMP_HINT_PADDING: f32 = 6.;
const JUMP_HINT_TEXT: f32 = 10.;
const JUMP_HINT_LINE: f32 = 14.;
const JUMP_HINT_BORDER: f32 = 0.8;
const JUMP_HINT_BACKGROUND: f32 = 0.95;
const DRAFT_PEN: f32 = 12.;

pub fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

pub fn thread_params(row: &SidebarThreadRowView) -> Value {
    json!({ "environmentId": row.environment_id, "threadId": row.thread_id })
}

fn with_thread(row: &SidebarThreadRowView, extra: Value) -> Value {
    let mut params = thread_params(row);
    if let (Some(target), Value::Object(extra)) = (params.as_object_mut(), extra) {
        target.extend(extra);
    }
    params
}

pub struct RowHover {
    pub hovered: bool,
    state: Entity<bool>,
}

impl RowHover {
    pub fn new(key: &str, window: &mut Window, cx: &mut App) -> Self {
        let state = window.use_keyed_state(
            ElementId::Name(SharedString::from(format!("sidebar-row-hover-{key}"))),
            cx,
            |_, _| false,
        );
        Self {
            hovered: *state.read(cx),
            state,
        }
    }

    pub fn listener(&self) -> impl Fn(&bool, &mut Window, &mut App) + 'static {
        let state = self.state.clone();
        move |hovered, _, cx| {
            let hovered = *hovered;
            state.update(cx, |current, cx| {
                if *current != hovered {
                    *current = hovered;
                    cx.notify();
                }
            });
        }
    }
}

fn row_action(
    client: &Entity<CoreClient>,
    row: &SidebarThreadRowView,
    action: &'static str,
) -> impl Fn(&ClickEvent, &mut Window, &mut App) + 'static {
    let client = client.clone();
    let params = with_thread(row, json!({ "action": action }));
    move |_, _, cx| {
        cx.stop_propagation();
        act(&client, cx, "sidebarThreadAction", params.clone());
    }
}

fn action_button(id: SharedString, padding: f32, t: &Tokens) -> Stateful<Div> {
    let foreground = t.foreground;
    div()
        .id(id.clone())
        .group(id)
        .flex()
        .flex_none()
        .items_center()
        .gap(px(4.))
        .px(px(padding))
        .rounded(px(ACTION_RADIUS))
        .cursor_pointer()
        .text_size(px(TEXT_XS))
        .line_height(px(TEXT_XS_LINE))
        .text_color(t.muted_foreground)
        .hover(move |style| style.text_color(foreground))
        .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
}

fn action_icon(path: &'static str, size: f32, group: SharedString, t: &Tokens) -> gpui::Svg {
    let foreground = t.foreground;
    svg()
        .path(path)
        .flex_none()
        .size(px(size))
        .text_color(t.muted_foreground)
        .group_hover(group, move |style| style.text_color(foreground))
}

pub fn card_actions(
    row: &SidebarThreadRowView,
    client: &Entity<CoreClient>,
    t: &Tokens,
    window: &mut Window,
    cx: &mut App,
) -> Option<AnyElement> {
    if !(row.actions.settle || row.actions.snooze || row.has_unsent_draft) {
        return None;
    }
    let discard = row.has_unsent_draft.then(|| {
        let id = SharedString::from(format!("sidebar-discard-draft-{}", row.key));
        action_button(id.clone(), ACTION_PADDING, t)
            .tooltip(Tooltip::text("Discard draft"))
            .on_click(row_action(client, row, "discard-draft"))
            .child(action_icon("icons/x.svg", 14., id, t))
    });
    let snooze = row
        .actions
        .snooze
        .then(|| snooze_button(row, client, t, window, cx));
    let settle = row.actions.settle.then(|| {
        let id = SharedString::from(format!("sidebar-settle-{}", row.key));
        action_button(id.clone(), ACTION_PADDING, t)
            .relative()
            .left(px(4.))
            .tooltip(Tooltip::text("Settle thread"))
            .on_click(row_action(client, row, "settle"))
            .child(action_icon("icons/check.svg", 14., id, t))
            .child("Settle")
    });
    Some(
        div()
            .flex()
            .flex_none()
            .h_full()
            .items_stretch()
            .children(discard)
            .children(snooze)
            .children(settle)
            .into_any_element(),
    )
}

fn snooze_button(
    row: &SidebarThreadRowView,
    client: &Entity<CoreClient>,
    t: &Tokens,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let id = SharedString::from(format!("sidebar-snooze-{}", row.key));
    let bounds = window.use_keyed_state(
        ElementId::Name(SharedString::from(format!(
            "sidebar-snooze-bounds-{}",
            row.key
        ))),
        cx,
        |_, _| Bounds::<Pixels>::default(),
    );
    let trigger = *bounds.read(cx);
    let open = row.snooze_menu.is_some();
    let toggle = client.clone();
    let toggle_params = with_thread(row, json!({ "open": !open }));
    let measure = bounds.clone();
    let popup = row.snooze_menu.as_ref().map(|menu| {
        let close = client.clone();
        let close_params = with_thread(row, json!({ "open": false }));
        let mut popup = MenuPopup::new(
            SharedString::from(format!("sidebar-snooze-menu-{}", row.key)),
            trigger,
        )
        .side(Side::Bottom)
        .align(Align::End)
        .side_offset(SNOOZE_MENU_OFFSET)
        .on_dismiss(move |_, cx| act(&close, cx, "sidebarSnoozeMenu", close_params.clone()));
        for item in &menu.items {
            let pick = client.clone();
            let params = with_thread(row, json!({ "presetId": item.id }));
            popup = popup.child(
                MenuItem::new(SharedString::from(format!(
                    "sidebar-snooze-{}-{}",
                    row.key, item.id
                )))
                .label(item.label.clone())
                .shortcut(item.shortcut.clone())
                .on_click(move |_, _, cx| {
                    cx.stop_propagation();
                    act(&pick, cx, "sidebarSnoozePick", params.clone());
                }),
            );
        }
        let pick = client.clone();
        let params = with_thread(row, json!({ "presetId": null }));
        popup.child(MenuSeparator::new()).child(
            MenuItem::new(SharedString::from(format!(
                "sidebar-snooze-{}-custom",
                row.key
            )))
            .label(menu.custom_label.clone())
            .on_click(move |_, _, cx| {
                cx.stop_propagation();
                act(&pick, cx, "sidebarSnoozePick", params.clone());
            }),
        )
    });
    action_button(id.clone(), ACTION_PADDING, t)
        .relative()
        .gap(px(2.))
        .when(!open, |this| this.tooltip(Tooltip::text("Snooze thread")))
        .on_click(move |_, _, cx| {
            cx.stop_propagation();
            act(&toggle, cx, "sidebarSnoozeMenu", toggle_params.clone());
        })
        .child(
            canvas(
                move |bounds, _, cx| {
                    measure.update(cx, |state, _| *state = bounds);
                },
                |_, _, _, _| {},
            )
            .absolute()
            .size_full(),
        )
        .child(action_icon("icons/clock.svg", 12., id, t))
        .children(popup)
        .into_any_element()
}

pub fn slim_action(
    row: &SidebarThreadRowView,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> Option<Stateful<Div>> {
    if row.actions.unsnooze {
        let id = SharedString::from(format!("sidebar-unsnooze-{}", row.key));
        return Some(
            action_button(id.clone(), ACTION_PADDING, t)
                .on_click(row_action(client, row, "unsnooze"))
                .child(action_icon("icons/alarm-clock-off.svg", 12., id, t)),
        );
    }
    if row.actions.unsettle {
        let id = SharedString::from(format!("sidebar-unsettle-{}", row.key));
        return Some(
            action_button(id.clone(), ACTION_PADDING, t)
                .tooltip(Tooltip::text("Un-settle thread"))
                .on_click(row_action(client, row, "unsettle"))
                .child(action_icon("icons/undo-2.svg", 14., id, t)),
        );
    }
    if row.actions.settle {
        let id = SharedString::from(format!("sidebar-settle-{}", row.key));
        return Some(
            action_button(id.clone(), SETTLE_PADDING, t)
                .on_click(row_action(client, row, "settle"))
                .child(action_icon("icons/check.svg", 12., id, t)),
        );
    }
    None
}

pub fn slim_action_inset(row: &SidebarThreadRowView) -> f32 {
    if row.actions.unsnooze || row.actions.unsettle {
        -4.
    } else {
        0.
    }
}

pub fn woke_button(
    row: &SidebarThreadRowView,
    client: &Entity<CoreClient>,
    label: &str,
    icon_size: f32,
    t: &Tokens,
) -> Stateful<Div> {
    div()
        .id(SharedString::from(format!("sidebar-woke-{}", row.key)))
        .flex()
        .flex_none()
        .items_center()
        .gap(px(4.))
        .rounded(px(4.))
        .cursor_pointer()
        .text_size(px(TEXT_XS))
        .line_height(px(TEXT_XS_LINE))
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.warning_foreground)
        .hover(|style| style.underline())
        .tooltip(Tooltip::text("Dismiss Woke notification"))
        .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .on_click(row_action(client, row, "acknowledge-woke"))
        .child(
            svg()
                .path("icons/alarm-clock.svg")
                .flex_none()
                .size(px(icon_size))
                .text_color(t.warning_foreground),
        )
        .child(SharedString::from(label.to_owned()))
}

pub fn pin_indicator(
    row: &SidebarThreadRowView,
    client: &Entity<CoreClient>,
    t: &Tokens,
    dim: Option<Rgba>,
    group: SharedString,
) -> Option<AnyElement> {
    let pin = row.pin.as_ref()?;
    let color = fade(t.muted_foreground, PIN_TEXT);
    let rest = dim.unwrap_or(color);
    let icon = svg()
        .path("icons/pin.svg")
        .flex_none()
        .size(px(12.))
        .text_color(rest)
        .group_hover(group, move |style| style.text_color(color));
    if !pin.can_unpin {
        return Some(icon.into_any_element());
    }
    let id = SharedString::from(format!("sidebar-unpin-{}", row.key));
    let foreground = t.foreground;
    Some(
        div()
            .id(id.clone())
            .group(id.clone())
            .flex()
            .flex_none()
            .items_center()
            .rounded(px(4.))
            .cursor_pointer()
            .tooltip(Tooltip::text("Unpin thread"))
            .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_click(row_action(client, row, "unpin"))
            .child(icon.hover(move |style| style.text_color(foreground)))
            .into_any_element(),
    )
}

pub fn draft_pen(row_key: &str, t: &Tokens) -> AnyElement {
    div()
        .id(SharedString::from(format!(
            "sidebar-draft-indicator-{row_key}"
        )))
        .flex()
        .flex_none()
        .items_center()
        .tooltip(Tooltip::text("Unsent draft"))
        .child(
            svg()
                .path("icons/square-pen.svg")
                .size(px(DRAFT_PEN))
                .text_color(t.warning_foreground),
        )
        .into_any_element()
}

pub fn jump_hint(label: &str, row_height: f32, t: &Tokens) -> AnyElement {
    div()
        .absolute()
        .right(px(JUMP_HINT_RIGHT))
        .top(px((row_height - JUMP_HINT_HEIGHT) / 2.))
        .flex()
        .h(px(JUMP_HINT_HEIGHT))
        .items_center()
        .rounded_full()
        .border_1()
        .border_color(fade(t.border, JUMP_HINT_BORDER))
        .bg(fade(t.background, JUMP_HINT_BACKGROUND))
        .px(px(JUMP_HINT_PADDING))
        .font_family(MONO_FONT)
        .text_size(px(JUMP_HINT_TEXT))
        .line_height(px(JUMP_HINT_LINE))
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.foreground)
        .shadow_sm()
        .child(SharedString::from(label.to_owned()))
        .into_any_element()
}

pub fn rename_input(row_key: &str, t: &Tokens, cx: &App) -> Option<AnyElement> {
    let host = SidebarRowsHost::global(cx)?;
    let input: Entity<InputState> = host.read(cx).rename_input();
    let escape = host.clone();
    let foreground = t.foreground;
    Some(
        div()
            .id(SharedString::from(format!("sidebar-rename-{row_key}")))
            .flex()
            .flex_1()
            .min_w_0()
            .h(px(RENAME_HEIGHT))
            .items_center()
            .rounded(px(RENAME_RADIUS))
            .border_1()
            .border_color(foreground)
            .bg(t.card)
            .text_color(t.card_foreground)
            .text_size(px(TEXT_SM))
            .line_height(px(TEXT_SM_LINE))
            .font_weight(FontWeight::MEDIUM)
            .on_click(|_, _, cx| cx.stop_propagation())
            .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_key_down(move |event: &KeyDownEvent, _, cx| {
                if event.keystroke.key == "escape" {
                    cx.stop_propagation();
                    escape.update(cx, |host, cx| host.cancel_rename(cx));
                }
            })
            .child(
                bare_input(
                    &input,
                    RENAME_HEIGHT - 2.,
                    RENAME_PADDING,
                    RENAME_PADDING,
                    TEXT_SM,
                    false,
                )
                .w_full()
                .min_w_0(),
            )
            .into_any_element(),
    )
}
