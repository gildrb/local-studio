use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Bounds, Context, DispatchPhase, Entity, Hsla, InteractiveElement, IntoElement,
    MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent, ParentElement, Pixels, Point,
    SharedString, StatefulInteractiveElement, Styled, Window, canvas, div, linear_color_stop,
    linear_gradient, px, rgb,
};
use serde_json::json;

use super::{InputMode, InputSpec, ProvidersSection, act};
use crate::app_core::client::CoreClient;
use crate::app_core::views::settings_providers::{AccentPickerModel, AccentPopoverView};
use crate::features::chat::provider_instance_icon::parse_accent;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::input::{Input, InputFont, InputSize};
use crate::ui::popover::{Align, PopoverPadding, PopoverPopup, Side};
use crate::ui::theme;
use crate::ui::theme::metrics::radius;
use crate::ui::theme::tokens::fade;

const ACCENT_ACTION: &str = "settingsProvidersAccent";
const SWATCH: f32 = 28.;
const PIPETTE: f32 = 12.;
const PANEL_WIDTH: f32 = 224.;
const PLANE_HEIGHT: f32 = 144.;
const PLANE_THUMB: f32 = 12.;
const HUE_HEIGHT: f32 = 24.;
const HUE_TRACK: f32 = 10.;
const HUE_THUMB: f32 = 16.;
const PANEL_PADDING: f32 = 12.;
const PANEL_GAP: f32 = 12.;
const FOOTER_PADDING: f32 = 4.;
const SIDE_OFFSET: f32 = 6.;
const THUMB_BORDER: f32 = 2.;
const HUE_STOPS: [u32; 7] = [
    0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xff0000,
];

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum AccentDrag {
    Plane,
    Hue,
}

fn send(client: &Entity<CoreClient>, target: &str, intent: serde_json::Value, cx: &mut App) {
    act(
        client,
        cx,
        ACCENT_ACTION,
        json!({ "target": target, "intent": intent }),
    );
}

fn hsla(hex: u32) -> Hsla {
    rgb(hex).into()
}

fn transparent(color: u32) -> Hsla {
    let mut color = hsla(color);
    color.a = 0.;
    color
}

pub(super) fn trigger(
    section: &mut ProvidersSection,
    target: String,
    model: &AccentPickerModel,
    disabled: bool,
    cx: &mut Context<ProvidersSection>,
) -> AnyElement {
    let t = theme::active(cx);
    let swatch = parse_accent(&model.swatch_color).unwrap_or(rgb(0x2563eb));
    let entity = cx.entity().downgrade();
    let measure_target = target.clone();
    let client = section.client.clone();
    let ring = fade(t.ring, 0.6);
    div()
        .relative()
        .flex_none()
        .child(
            div()
                .id(SharedString::from(format!("accent-trigger-{target}")))
                .size(px(SWATCH))
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(radius::MD))
                .border_1()
                .border_color(t.input)
                .bg(swatch)
                .shadow_xs()
                .tooltip(crate::ui::tooltip::Tooltip::text(SharedString::from(
                    model.trigger_aria_label.clone(),
                )))
                .when(!disabled, |this| {
                    this.cursor_pointer()
                        .hover(move |style| style.border_color(ring))
                        .on_click(move |_, _, cx| {
                            send(&client, &target, json!({ "kind": "open" }), cx)
                        })
                })
                .child(
                    gpui::svg()
                        .path("icons/pipette.svg")
                        .size(px(PIPETTE))
                        .text_color(fade(rgb(0xffffff), 0.7)),
                ),
        )
        .child(
            canvas(
                move |bounds, _, cx| {
                    if let Some(entity) = entity.upgrade() {
                        entity.update(cx, |section, _| {
                            section.accent_bounds.insert(measure_target.clone(), bounds);
                        });
                    }
                },
                |_, _, _, _| {},
            )
            .absolute()
            .top_0()
            .left_0()
            .size_full(),
        )
        .into_any_element()
}

type PositionHandler = Rc<dyn Fn(Point<Pixels>, Bounds<Pixels>, &mut App)>;

fn drag_surface(
    section: &ProvidersSection,
    kind: AccentDrag,
    on_position: PositionHandler,
    cx: &mut Context<ProvidersSection>,
) -> AnyElement {
    let entity = cx.entity().downgrade();
    let dragging = section.accent_drag == Some(kind);
    canvas(
        |bounds, _, _| bounds,
        move |bounds, _, window, _| {
            let down_entity = entity.clone();
            let down_handler = on_position.clone();
            window.on_mouse_event(move |event: &MouseDownEvent, phase, _, cx| {
                if phase != DispatchPhase::Bubble
                    || event.button != MouseButton::Left
                    || !bounds.contains(&event.position)
                {
                    return;
                }
                if let Some(entity) = down_entity.upgrade() {
                    entity.update(cx, |section, cx| {
                        section.accent_drag = Some(kind);
                        cx.notify();
                    });
                }
                down_handler(event.position, bounds, cx);
            });
            if dragging {
                let move_handler = on_position.clone();
                window.on_mouse_event(move |event: &MouseMoveEvent, phase, _, cx| {
                    if phase == DispatchPhase::Bubble
                        && event.pressed_button == Some(MouseButton::Left)
                    {
                        move_handler(event.position, bounds, cx);
                    }
                });
                let up_entity = entity.clone();
                window.on_mouse_event(move |_: &MouseUpEvent, phase, _, cx| {
                    if phase != DispatchPhase::Bubble {
                        return;
                    }
                    if let Some(entity) = up_entity.upgrade() {
                        entity.update(cx, |section, cx| {
                            section.accent_drag = None;
                            cx.notify();
                        });
                    }
                });
            }
        },
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full()
    .into_any_element()
}

fn ratio(value: Pixels, origin: Pixels, length: Pixels) -> f64 {
    let length = f64::from(f32::from(length));
    if length <= 0. {
        return 0.;
    }
    (f64::from(f32::from(value - origin)) / length).clamp(0., 1.)
}

fn plane(
    section: &ProvidersSection,
    popover: &AccentPopoverView,
    cx: &mut Context<ProvidersSection>,
) -> AnyElement {
    let hue = parse_accent(&popover.hue_color).unwrap_or(rgb(0xff0000));
    let client = section.client.clone();
    let target = popover.target.clone();
    let h = popover.hsv.h;
    let on_position: PositionHandler = Rc::new(move |position, bounds, cx| {
        let s = ratio(position.x, bounds.origin.x, bounds.size.width);
        let v = 1. - ratio(position.y, bounds.origin.y, bounds.size.height);
        send(
            &client,
            &target,
            json!({ "kind": "hsv", "h": h, "s": s, "v": v }),
            cx,
        );
    });
    let left = popover.hsv.s as f32 * (PANEL_WIDTH - PLANE_THUMB);
    let top = (1. - popover.hsv.v as f32) * (PLANE_HEIGHT - PLANE_THUMB);
    div()
        .relative()
        .w(px(PANEL_WIDTH))
        .h(px(PLANE_HEIGHT))
        .overflow_hidden()
        .cursor_crosshair()
        .bg(hue)
        .child(
            div()
                .absolute()
                .top_0()
                .left_0()
                .size_full()
                .bg(linear_gradient(
                    90.,
                    linear_color_stop(hsla(0xffffff), 0.),
                    linear_color_stop(transparent(0xffffff), 1.),
                )),
        )
        .child(
            div()
                .absolute()
                .top_0()
                .left_0()
                .size_full()
                .bg(linear_gradient(
                    0.,
                    linear_color_stop(hsla(0x000000), 0.),
                    linear_color_stop(transparent(0x000000), 1.),
                )),
        )
        .child(
            div()
                .absolute()
                .left(px(left))
                .top(px(top))
                .size(px(PLANE_THUMB))
                .rounded_full()
                .border(px(THUMB_BORDER))
                .border_color(rgb(0xffffff))
                .shadow(vec![crate::ui::popover::shadow(
                    0.,
                    0.,
                    0.,
                    1.,
                    crate::ui::popover::black(0.4),
                )]),
        )
        .child(drag_surface(section, AccentDrag::Plane, on_position, cx))
        .into_any_element()
}

fn hue_slider(
    section: &ProvidersSection,
    popover: &AccentPopoverView,
    cx: &mut Context<ProvidersSection>,
) -> AnyElement {
    let hue = parse_accent(&popover.hue_color).unwrap_or(rgb(0xff0000));
    let client = section.client.clone();
    let target = popover.target.clone();
    let (s, v) = (popover.hsv.s, popover.hsv.v);
    let on_position: PositionHandler = Rc::new(move |position, bounds, cx| {
        let h = ratio(position.x, bounds.origin.x, bounds.size.width) * 360.;
        send(
            &client,
            &target,
            json!({ "kind": "hsv", "h": h, "s": s, "v": v }),
            cx,
        );
    });
    let track_width = PANEL_WIDTH - PANEL_PADDING * 2.;
    let left = (popover.hsv.h / 360.) as f32 * (track_width - HUE_THUMB);
    div()
        .relative()
        .flex()
        .items_center()
        .h(px(HUE_HEIGHT))
        .w_full()
        .cursor_pointer()
        .child(
            div()
                .flex()
                .w_full()
                .h(px(HUE_TRACK))
                .rounded_full()
                .overflow_hidden()
                .border_1()
                .border_color(crate::ui::popover::black(0.12))
                .children(HUE_STOPS.windows(2).map(|pair| {
                    div().flex_1().h_full().bg(linear_gradient(
                        90.,
                        linear_color_stop(hsla(pair[0]), 0.),
                        linear_color_stop(hsla(pair[1]), 1.),
                    ))
                })),
        )
        .child(
            div()
                .absolute()
                .left(px(left))
                .top(px((HUE_HEIGHT - HUE_THUMB) / 2.))
                .size(px(HUE_THUMB))
                .rounded_full()
                .border(px(THUMB_BORDER))
                .border_color(rgb(0xffffff))
                .bg(hue)
                .shadow(vec![crate::ui::popover::shadow(
                    0.,
                    0.,
                    0.,
                    1.,
                    crate::ui::popover::black(0.4),
                )]),
        )
        .child(drag_surface(section, AccentDrag::Hue, on_position, cx))
        .into_any_element()
}

pub(super) fn popover(
    section: &mut ProvidersSection,
    popover: &AccentPopoverView,
    window: &mut Window,
    cx: &mut Context<ProvidersSection>,
) -> Option<AnyElement> {
    let bounds = *section.accent_bounds.get(&popover.target)?;
    let t = theme::active(cx);
    let client = section.client.clone();
    let hex_client = client.clone();
    let hex_target = popover.target.clone();
    let blur_client = client.clone();
    let blur_target = popover.target.clone();
    let hex = section.input(
        InputSpec {
            key: format!("accent-hex:{}", popover.target),
            value: popover.hex.clone(),
            placeholder: String::new(),
            masked: false,
            mode: InputMode::Live,
            on_value: Rc::new(move |value, cx| {
                send(
                    &hex_client,
                    &hex_target,
                    json!({ "kind": "hex", "value": value }),
                    cx,
                )
            }),
            on_enter: None,
            on_blur: Some(Rc::new(move |cx| {
                send(
                    &blur_client,
                    &blur_target,
                    json!({ "kind": "hex-blur" }),
                    cx,
                )
            })),
        },
        window,
        cx,
    );
    let close_client = client.clone();
    let close_target = popover.target.clone();
    let clear_client = client.clone();
    let clear_target = popover.target.clone();
    let plane = plane(section, popover, cx);
    let hue = hue_slider(section, popover, cx);
    Some(
        PopoverPopup::new(
            SharedString::from(format!("accent-popover-{}", popover.target)),
            bounds,
        )
        .side(Side::Bottom)
        .align(Align::Start)
        .side_offset(SIDE_OFFSET)
        .padding(PopoverPadding::None)
        .on_dismiss(move |_, cx| send(&close_client, &close_target, json!({ "kind": "close" }), cx))
        .child(
            div().w(px(PANEL_WIDTH)).bg(t.popover).child(plane).child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(PANEL_GAP))
                    .p(px(PANEL_PADDING))
                    .child(hue)
                    .child(
                        Input::new(&hex)
                            .size(InputSize::Compact)
                            .font(InputFont::Mono),
                    ),
            ),
        )
        .child(
            div()
                .border_t_1()
                .border_color(fade(t.border, 0.6))
                .p(px(FOOTER_PADDING))
                .child(
                    Button::new(SharedString::from(format!(
                        "accent-clear-{}",
                        popover.target
                    )))
                    .size(ButtonSize::Compact)
                    .variant(ButtonVariant::GhostMuted)
                    .w_full()
                    .justify_start()
                    .icon("x")
                    .label(popover.model.clear_label.clone())
                    .disabled(popover.model.clear_disabled)
                    .on_click(move |_, _, cx| {
                        send(&clear_client, &clear_target, json!({ "kind": "clear" }), cx)
                    }),
                ),
        )
        .into_any_element(),
    )
}
