use std::cell::Cell;
use std::rc::Rc;
use std::sync::Arc;

use futures::StreamExt;
use futures::channel::mpsc::unbounded;
use gpui::prelude::FluentBuilder;
use gpui::{
    App, Bounds, Context, Corners, DispatchPhase, Entity, FocusHandle, Focusable, HitboxBehavior,
    InteractiveElement, IntoElement, KeyDownEvent, KeyUpEvent, Modifiers, ModifiersChangedEvent,
    MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent, ParentElement, Pixels, Point,
    Render, RenderImage, SharedString, Styled, Task, WeakEntity, Window, canvas, div, point, px,
    rgba, size,
};
use serde_json::{Value, json};

use super::frame::{FramePixels, Presented, Rotation, Rotator};
use super::keys::{DomKey, dom_key, modifier_keys};
use super::session::{self, Signal, Signals, StreamEvent, StreamHandle};
use crate::app_core::client::CoreClient;
use crate::app_core::views::device_stream::{DeviceAxElement, DeviceStreamView};
use crate::ui::theme::{self, metrics, tokens::fade};

const NOTICE_PADDING: f32 = 8.;
const AX_LABEL_HEIGHT: f32 = 14.;
const AX_LABEL_TEXT: f32 = 10.;

#[derive(Clone)]
enum Shown {
    #[cfg(target_os = "macos")]
    Surface(super::frame::PixelBuffer),
    Image(Arc<RenderImage>),
}

pub struct DeviceScreen {
    client: Entity<CoreClient>,
    view: Option<DeviceStreamView>,
    stream: Option<StreamHandle>,
    signals: Signals,
    presented: Option<Presented>,
    rotator: Rotator,
    focus: FocusHandle,
    modifiers: Modifiers,
    touching: Rc<Cell<bool>>,
    reported: Rc<Cell<Option<(String, f32, f32)>>>,
    _signals: Task<()>,
}

impl DeviceScreen {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let (signals, mut received) = unbounded::<(u64, Signal)>();
        let task = cx.spawn(async move |this: WeakEntity<Self>, cx| {
            while let Some((stream, signal)) = received.next().await {
                if this
                    .update(cx, |screen, cx| screen.signal(stream, signal, cx))
                    .is_err()
                {
                    return;
                }
            }
        });
        cx.on_release(|screen: &mut Self, cx: &mut App| {
            screen.stop_stream(cx);
            screen.replace_presented(None, cx);
        })
        .detach();
        Self {
            client,
            view: None,
            stream: None,
            signals,
            presented: None,
            rotator: Rotator::default(),
            focus: cx.focus_handle(),
            modifiers: Modifiers::default(),
            touching: Rc::new(Cell::new(false)),
            reported: Rc::new(Cell::new(None)),
            _signals: task,
        }
    }

    pub fn focus_handle(&self) -> FocusHandle {
        self.focus.clone()
    }

    pub fn set_view(&mut self, view: DeviceStreamView, cx: &mut Context<Self>) {
        if self.view.as_ref() == Some(&view) {
            return;
        }
        if self
            .view
            .as_ref()
            .is_some_and(|current| current.key != view.key)
        {
            self.replace_presented(None, cx);
            self.touching.set(false);
        }
        let rotation = Rotation::from_degrees(view.rotation);
        let running = self.stream.as_ref().map(|stream| &stream.target);
        if running != view.target.as_ref() {
            self.stop_stream(cx);
            if let Some(target) = view.target.clone() {
                self.stream = Some(session::start(target, rotation, self.signals.clone()));
            }
        }
        if let Some(stream) = &self.stream {
            stream.slot.set_rotation(rotation);
        }
        let stale = self
            .presented
            .as_ref()
            .filter(|presented| presented.rotation != rotation)
            .map(|presented| presented.source.clone());
        if let Some(source) = stale {
            let presented = Presented::new(source, rotation, &mut self.rotator);
            self.replace_presented(Some(presented), cx);
        }
        self.view = Some(view);
        cx.notify();
    }

    fn stop_stream(&mut self, cx: &mut App) {
        let Some(stream) = self.stream.take() else {
            return;
        };
        let params = json!({
            "key": stream.target.key,
            "stream": stream.id,
            "platform": stream.target.platform.as_str(),
            "event": StreamEvent::Stopped.to_json(),
        });
        drop(stream);
        self.client
            .update(cx, |client, _| client.act("deviceStreamEvent", params));
    }

    fn replace_presented(&mut self, next: Option<Presented>, cx: &mut App) {
        let previous = std::mem::replace(&mut self.presented, next);
        let Some(previous) = previous else {
            return;
        };
        let kept: Vec<Arc<RenderImage>> = self
            .presented
            .iter()
            .flat_map(|presented| presented.images().cloned())
            .collect();
        for image in previous.images() {
            if !kept.iter().any(|kept| Arc::ptr_eq(kept, image)) {
                cx.drop_image(image.clone(), None);
            }
        }
    }

    fn signal(&mut self, stream: u64, signal: Signal, cx: &mut Context<Self>) {
        let Some(running) = self.stream.as_ref().filter(|running| running.id == stream) else {
            return;
        };
        match signal {
            Signal::Frame => {
                let Some(presented) = running.slot.take() else {
                    return;
                };
                let rotation = self
                    .view
                    .as_ref()
                    .map(|view| Rotation::from_degrees(view.rotation))
                    .unwrap_or_default();
                let presented = if presented.rotation == rotation {
                    presented
                } else {
                    Presented::new(presented.source, rotation, &mut self.rotator)
                };
                self.replace_presented(Some(presented), cx);
                cx.notify();
            }
            Signal::Event(event) => {
                let params = json!({
                    "key": running.target.key,
                    "stream": stream,
                    "platform": running.target.platform.as_str(),
                    "event": event.to_json(),
                });
                self.client
                    .update(cx, |client, _| client.act("deviceStreamEvent", params));
            }
        }
    }

    fn send_input(&self, input: Value, cx: &mut App) {
        let (Some(view), Some(stream)) = (&self.view, &self.stream) else {
            return;
        };
        let params = json!({
            "key": view.key,
            "stream": stream.id,
            "platform": view.platform.as_str(),
            "input": input,
        });
        self.client
            .update(cx, |client, _| client.act("deviceStreamInput", params));
    }

    fn touch(&self, phase: &str, position: Point<Pixels>, bounds: Bounds<Pixels>, cx: &mut App) {
        let width = f32::from(bounds.size.width);
        let height = f32::from(bounds.size.height);
        if width <= 0. || height <= 0. {
            return;
        }
        let x = ((f32::from(position.x) - f32::from(bounds.origin.x)) / width).clamp(0., 1.);
        let y = ((f32::from(position.y) - f32::from(bounds.origin.y)) / height).clamp(0., 1.);
        self.send_input(
            json!({ "kind": "touch", "phase": phase, "x": x, "y": y }),
            cx,
        );
    }

    fn send_key(&self, phase: &str, key: DomKey, cx: &mut App) {
        self.send_input(
            json!({
                "kind": "key",
                "phase": phase,
                "code": key.code,
                "key": key.key,
                "metaKey": key.meta_key,
                "ctrlKey": key.ctrl_key,
            }),
            cx,
        );
    }

    fn key_down(&mut self, event: &KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        let key = dom_key(&event.keystroke);
        if key.meta_key && key.key != "r" && key.key != "R" {
            cx.propagate();
            return;
        }
        self.send_key("down", key, cx);
        cx.stop_propagation();
    }

    fn key_up(&mut self, event: &KeyUpEvent, _: &mut Window, cx: &mut Context<Self>) {
        self.send_key("up", dom_key(&event.keystroke), cx);
        cx.stop_propagation();
    }

    fn modifiers_changed(
        &mut self,
        event: &ModifiersChangedEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let next = event.modifiers;
        for (down, key) in modifier_keys(self.modifiers, next) {
            self.send_key(if down { "down" } else { "up" }, key, cx);
        }
        self.modifiers = next;
    }

    fn shown(&self) -> Option<Shown> {
        let frame = self.presented.as_ref()?.shown();
        Some(match &frame.pixels {
            #[cfg(target_os = "macos")]
            FramePixels::Surface(buffer) => Shown::Surface(buffer.clone()),
            FramePixels::Image(image) => Shown::Image(image.clone()),
        })
    }
}

impl Focusable for DeviceScreen {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

fn contain(bounds: Bounds<Pixels>, width: f32, height: f32) -> Bounds<Pixels> {
    let box_width = f32::from(bounds.size.width);
    let box_height = f32::from(bounds.size.height);
    if width <= 0. || height <= 0. || box_width <= 0. || box_height <= 0. {
        return bounds;
    }
    let scale = (box_width / width).min(box_height / height);
    let (fit_width, fit_height) = (width * scale, height * scale);
    Bounds {
        origin: point(
            bounds.origin.x + px((box_width - fit_width) / 2.),
            bounds.origin.y + px((box_height - fit_height) / 2.),
        ),
        size: size(px(fit_width), px(fit_height)),
    }
}

fn paint_frame(shown: &Shown, bounds: Bounds<Pixels>, fit: bool, window: &mut Window) {
    match shown {
        #[cfg(target_os = "macos")]
        Shown::Surface(buffer) => {
            let retained = buffer.retained();
            let target = if fit {
                contain(
                    bounds,
                    objc2_core_video::CVPixelBufferGetWidth(&retained) as f32,
                    objc2_core_video::CVPixelBufferGetHeight(&retained) as f32,
                )
            } else {
                bounds
            };
            window.paint_surface(target, retained);
        }
        Shown::Image(image) => {
            let target = if fit {
                let image_size = image.size(0);
                contain(
                    bounds,
                    i32::from(image_size.width) as f32,
                    i32::from(image_size.height) as f32,
                )
            } else {
                bounds
            };
            let _ = window.paint_image(target, target, Corners::default(), image.clone(), 0, false);
        }
    }
}

fn ax_overlay(elements: &[DeviceAxElement], width: f32, height: f32, cx: &App) -> gpui::Div {
    let t = theme::active(cx);
    div()
        .absolute()
        .top_0()
        .left_0()
        .size_full()
        .children(elements.iter().map(|element| {
            div()
                .absolute()
                .left(px(element.x * width))
                .top(px(element.y * height))
                .w(px(element.width * width))
                .h(px(element.height * height))
                .border_1()
                .border_color(fade(t.info, 0.8))
                .bg(fade(t.info, 0.1))
                .when(!element.label.is_empty(), |this| {
                    this.child(
                        div()
                            .absolute()
                            .top(px(-AX_LABEL_HEIGHT))
                            .left_0()
                            .max_w_full()
                            .overflow_hidden()
                            .whitespace_nowrap()
                            .text_ellipsis()
                            .rounded(px(metrics::radius::SM))
                            .bg(t.info)
                            .px(px(metrics::space::S1))
                            .text_size(px(AX_LABEL_TEXT))
                            .line_height(px(AX_LABEL_HEIGHT))
                            .text_color(rgba(0xffffffff))
                            .child(SharedString::from(element.label.clone())),
                    )
                })
        }))
}

impl Render for DeviceScreen {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = theme::active(cx);
        let Some(view) = self.view.clone() else {
            return div().size_full().into_any_element();
        };
        let entity = cx.entity().downgrade();
        let shown = self.shown();
        let fit = view.mjpeg;
        let focus = self.focus.clone();
        let touching = self.touching.clone();
        let reported = self.reported.clone();
        let client = self.client.clone();
        let key = view.key.clone();
        let probe = canvas(
            move |bounds, _, cx| {
                let width = f32::from(bounds.size.width);
                let height = f32::from(bounds.size.height);
                let next = (key.clone(), width, height);
                let previous = reported.replace(Some(next.clone()));
                if previous.as_ref() != Some(&next) {
                    client.update(cx, |client, _| {
                        client.act(
                            "deviceStreamLayout",
                            json!({ "key": key, "width": width, "height": height }),
                        )
                    });
                }
            },
            |_, _, _, _| {},
        )
        .absolute()
        .top_0()
        .left_0()
        .size_full();
        let surface = canvas(
            |bounds, window, _| window.insert_hitbox(bounds, HitboxBehavior::Normal),
            move |bounds, hitbox, window, _| {
                if let Some(shown) = &shown {
                    paint_frame(shown, bounds, fit, window);
                }
                let pressing = entity.clone();
                let pressing_touch = touching.clone();
                let focus = focus.clone();
                window.on_mouse_event(move |event: &MouseDownEvent, phase, window, cx| {
                    if phase != DispatchPhase::Bubble
                        || event.button != MouseButton::Left
                        || !hitbox.is_hovered(window)
                    {
                        return;
                    }
                    window.focus(&focus, cx);
                    pressing_touch.set(true);
                    if let Some(screen) = pressing.upgrade() {
                        screen.update(cx, |screen, cx| {
                            screen.touch("begin", event.position, bounds, cx)
                        });
                    }
                    cx.stop_propagation();
                });
                let moving = entity.clone();
                let moving_touch = touching.clone();
                window.on_mouse_event(move |event: &MouseMoveEvent, phase, _, cx| {
                    if phase != DispatchPhase::Bubble || !moving_touch.get() {
                        return;
                    }
                    if let Some(screen) = moving.upgrade() {
                        screen.update(cx, |screen, cx| {
                            screen.touch("move", event.position, bounds, cx)
                        });
                    }
                });
                let releasing = entity.clone();
                let releasing_touch = touching.clone();
                window.on_mouse_event(move |event: &MouseUpEvent, phase, _, cx| {
                    if phase != DispatchPhase::Bubble
                        || event.button != MouseButton::Left
                        || !releasing_touch.replace(false)
                    {
                        return;
                    }
                    if let Some(screen) = releasing.upgrade() {
                        screen.update(cx, |screen, cx| {
                            screen.touch("end", event.position, bounds, cx)
                        });
                    }
                });
            },
        )
        .absolute()
        .top_0()
        .left_0()
        .size_full();
        let frame_box = div()
            .relative()
            .flex_none()
            .w(px(view.frame.width))
            .h(px(view.frame.height))
            .child(surface)
            .when(!view.ax_elements.is_empty(), |this| {
                this.child(ax_overlay(
                    &view.ax_elements,
                    view.frame.width,
                    view.frame.height,
                    cx,
                ))
            });
        let notice = view.input_notice.clone().map(|notice| {
            div()
                .absolute()
                .left_0()
                .right_0()
                .bottom_0()
                .flex()
                .justify_center()
                .p(px(NOTICE_PADDING))
                .child(
                    div()
                        .rounded(px(metrics::radius::MD))
                        .bg(fade(t.background, 0.85))
                        .px(px(metrics::space::S2))
                        .py(px(metrics::space::S1))
                        .text_size(px(metrics::text::XS))
                        .line_height(px(metrics::text::XS_LINE))
                        .text_color(t.muted_foreground)
                        .child(SharedString::from(notice)),
                )
        });
        div()
            .relative()
            .flex()
            .size_full()
            .min_h_0()
            .min_w_0()
            .bg(if view.compact {
                rgba(0x000000e6)
            } else {
                t.background
            })
            .child(
                div()
                    .id(SharedString::from(format!("device-screen-{}", view.key)))
                    .relative()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .min_w_0()
                    .items_center()
                    .justify_center()
                    .overflow_hidden()
                    .when(view.controls_inset > 0., |this| {
                        this.pr(px(view.controls_inset))
                    })
                    .key_context("DeviceScreen")
                    .track_focus(&self.focus)
                    .on_key_down(cx.listener(Self::key_down))
                    .on_key_up(cx.listener(Self::key_up))
                    .on_modifiers_changed(cx.listener(Self::modifiers_changed))
                    .child(probe)
                    .child(frame_box)
                    .children(notice),
            )
            .into_any_element()
    }
}
