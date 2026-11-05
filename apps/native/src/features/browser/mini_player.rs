use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, Bounds, ClickEvent, Context, CursorStyle, DispatchPhase, Entity,
    Global, InteractiveElement, IntoElement, MouseButton, MouseDownEvent, MouseMoveEvent,
    MouseUpEvent, ParentElement, Pixels, Render, SharedString, StatefulInteractiveElement, Styled,
    Window, canvas, div, img, px,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::preview_mini_player::{PreviewMiniPlayerSource, PreviewMiniPlayerView};
use crate::features::browser::host::{BrowserHostHandle, SlotKind};
use crate::features::device::parts::{LoadingStage, loading_view};
use crate::features::device::stream::DeviceScreen;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::overlay_bounds::tracked;
use crate::ui::popover::{black, shadow};
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const PILL_ZONE: f32 = 12.;
const STATUS_DOT: f32 = 8.;
const PILL_HEIGHT: f32 = 32.;
const PILL_PADDING: f32 = 2.;
const PILL_GAP: f32 = 2.;
const EDGE_GRAB: f32 = 8.;
const EDGE_OVERHANG: f32 = 4.;
const CORNER_GRAB: f32 = 16.;
const CORNER_OVERHANG: f32 = 8.;

#[derive(Clone, Copy)]
enum Handle {
    North,
    South,
    West,
    East,
    NorthWest,
    NorthEast,
    SouthWest,
    SouthEast,
}

impl Handle {
    const ALL: [Handle; 8] = [
        Handle::North,
        Handle::South,
        Handle::West,
        Handle::East,
        Handle::NorthWest,
        Handle::NorthEast,
        Handle::SouthWest,
        Handle::SouthEast,
    ];

    fn direction(self) -> &'static str {
        match self {
            Handle::North => "north",
            Handle::South => "south",
            Handle::West => "west",
            Handle::East => "east",
            Handle::NorthWest => "northwest",
            Handle::NorthEast => "northeast",
            Handle::SouthWest => "southwest",
            Handle::SouthEast => "southeast",
        }
    }

    fn cursor(self) -> CursorStyle {
        match self {
            Handle::North | Handle::South => CursorStyle::ResizeUpDown,
            Handle::West | Handle::East => CursorStyle::ResizeLeftRight,
            Handle::NorthWest | Handle::SouthEast => CursorStyle::ResizeUpLeftDownRight,
            Handle::NorthEast | Handle::SouthWest => CursorStyle::ResizeUpRightDownLeft,
        }
    }

    fn place(self, zone: gpui::Div) -> gpui::Div {
        let edge = px(-EDGE_OVERHANG);
        let corner = px(-CORNER_OVERHANG);
        match self {
            Handle::North => zone.left_0().right_0().top(edge).h(px(EDGE_GRAB)),
            Handle::South => zone.left_0().right_0().bottom(edge).h(px(EDGE_GRAB)),
            Handle::West => zone.top_0().bottom_0().left(edge).w(px(EDGE_GRAB)),
            Handle::East => zone.top_0().bottom_0().right(edge).w(px(EDGE_GRAB)),
            Handle::NorthWest => zone.left(corner).top(corner).size(px(CORNER_GRAB)),
            Handle::NorthEast => zone.right(corner).top(corner).size(px(CORNER_GRAB)),
            Handle::SouthWest => zone.left(corner).bottom(corner).size(px(CORNER_GRAB)),
            Handle::SouthEast => zone.right(corner).bottom(corner).size(px(CORNER_GRAB)),
        }
    }
}

type LayoutKey = (i32, i32, Option<(i32, i32, i32)>);

pub struct MiniPlayerHandle(pub Entity<MiniPlayer>);

impl Global for MiniPlayerHandle {}

pub struct MiniPlayer {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<PreviewMiniPlayerView>>>,
    zone_hovered: bool,
    pill_hovered: bool,
    dragging: bool,
    obstacle: Option<(Bounds<Pixels>, f32)>,
    reported: Option<LayoutKey>,
    device: Option<(String, Entity<DeviceScreen>)>,
}

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

impl MiniPlayer {
    pub fn install(client: &Entity<CoreClient>, cx: &mut App) {
        let client = client.clone();
        let player = cx.new(|cx| MiniPlayer::new(client, cx));
        cx.set_global(MiniPlayerHandle(player));
    }

    fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<PreviewMiniPlayerView>>(
            &client,
            "previewMiniPlayer",
            json!({}),
            cx,
        );
        cx.observe(&view, |this, _, cx| {
            this.sync_device(cx);
            cx.notify();
        })
        .detach();
        if let Some(host) = cx.try_global::<BrowserHostHandle>().map(|h| h.0.clone()) {
            cx.observe(&host, |_, _, cx| cx.notify()).detach();
        }
        Self {
            client,
            view,
            zone_hovered: false,
            pill_hovered: false,
            dragging: false,
            obstacle: None,
            reported: None,
            device: None,
        }
    }

    fn sync_device(&mut self, cx: &mut Context<Self>) {
        let stream = match self
            .view
            .read(cx)
            .data
            .clone()
            .flatten()
            .map(|view| view.source)
        {
            Some(PreviewMiniPlayerSource::Device { stream, .. }) => stream,
            _ => {
                self.device = None;
                return;
            }
        };
        let screen = match self.device.as_ref().filter(|(key, _)| *key == stream.key) {
            Some((_, screen)) => screen.clone(),
            None => {
                let client = self.client.clone();
                let screen = cx.new(|cx| DeviceScreen::new(client, cx));
                self.device = Some((stream.key.clone(), screen.clone()));
                screen
            }
        };
        screen.update(cx, |screen, cx| screen.set_view(*stream, cx));
    }

    pub fn set_composer_obstacle(&mut self, obstacle: Option<(Bounds<Pixels>, f32)>) {
        self.obstacle = obstacle;
    }

    fn report_layout(&mut self, container: Bounds<Pixels>, cx: &mut Context<Self>) {
        let left = f32::from(container.origin.x);
        let composer = self
            .obstacle
            .filter(|(_, height)| *height > 0.)
            .map(|(stack, height)| {
                (
                    (f32::from(stack.left()) - left).floor() as i32,
                    (f32::from(stack.right()) - left).ceil() as i32,
                    height.ceil() as i32,
                )
            });
        let key = (
            f32::from(container.size.width).round() as i32,
            f32::from(container.size.height).round() as i32,
            composer,
        );
        if self.reported == Some(key) {
            return;
        }
        self.reported = Some(key);
        act(
            &self.client,
            cx,
            "previewMiniPlayerLayout",
            json!({
                "width": key.0,
                "height": key.1,
                "composer": composer.map(|(left, right, height)| json!({
                    "left": left,
                    "right": right,
                    "height": height,
                })),
            }),
        );
    }

    fn begin(&mut self, event: &MouseDownEvent, direction: Option<&str>, cx: &mut Context<Self>) {
        self.dragging = true;
        act(
            &self.client,
            cx,
            "previewMiniPlayerGestureStart",
            json!({
                "x": f32::from(event.position.x),
                "y": f32::from(event.position.y),
                "direction": direction,
            }),
        );
        cx.notify();
    }

    fn pill_button(
        &self,
        id: &'static str,
        icon: &'static str,
        tooltip: SharedString,
        variant: ButtonVariant,
        disabled: bool,
        action: &'static str,
    ) -> AnyElement {
        let client = self.client.clone();
        div()
            .id(SharedString::from(format!("mini-player-tooltip-{id}")))
            .flex_none()
            .tooltip(Tooltip::text(tooltip.clone()))
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .child(
                Button::new(SharedString::from(format!("mini-player-{id}")))
                    .variant(variant)
                    .size(ButtonSize::IconXs)
                    .icon(icon)
                    .disabled(disabled)
                    .accessibility_label(tooltip)
                    .on_click(move |_: &ClickEvent, _, cx| act(&client, cx, action, json!({}))),
            )
            .into_any_element()
    }

    fn pill(&self, view: &PreviewMiniPlayerView, t: &Tokens, cx: &mut Context<Self>) -> AnyElement {
        let mut pill = div()
            .id("mini-player-pill")
            .absolute()
            .right_0()
            .top_0()
            .flex()
            .items_center()
            .gap(px(PILL_GAP))
            .h(px(PILL_HEIGHT))
            .p(px(PILL_PADDING))
            .rounded(px(radius::LG))
            .backdrop_blur(px(24.))
            .border_1()
            .border_color(fade(t.border, 0.8))
            .bg(fade(t.popover, 0.92))
            .shadow(vec![
                shadow(0., 10., 15., -3., black(0.2)),
                shadow(0., 4., 6., -4., black(0.2)),
            ])
            .cursor(if self.dragging {
                CursorStyle::ClosedHand
            } else {
                CursorStyle::OpenHand
            })
            .on_hover(cx.listener(|player, hovered: &bool, _, cx| {
                player.pill_hovered = *hovered;
                cx.notify();
            }))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|player, event: &MouseDownEvent, _, cx| {
                    cx.stop_propagation();
                    player.begin(event, None, cx);
                }),
            );
        if view.recording {
            pill = pill.child(
                div()
                    .flex()
                    .flex_none()
                    .size(px(24.))
                    .items_center()
                    .justify_center()
                    .child(div().size(px(STATUS_DOT)).rounded_full().bg(t.destructive)),
            );
        }
        pill = pill.child(self.pill_button(
            "open-in-panel",
            "panel-right",
            "Open in right panel".into(),
            ButtonVariant::Ghost,
            false,
            "previewMiniPlayerOpenInPanel",
        ));
        if let PreviewMiniPlayerSource::Browser {
            picture_in_picture, ..
        } = &view.source
        {
            pill = pill.child(self.pill_button(
                "picture-in-picture",
                "picture-in-picture-2",
                picture_in_picture.tooltip.clone().into(),
                if picture_in_picture.active {
                    ButtonVariant::Secondary
                } else {
                    ButtonVariant::Ghost
                },
                picture_in_picture.disabled,
                "previewMiniPlayerTogglePictureInPicture",
            ));
        }
        pill.child(self.pill_button(
            "close",
            "x",
            "Close floating preview".into(),
            ButtonVariant::Ghost,
            false,
            "previewMiniPlayerClose",
        ))
        .into_any_element()
    }

    fn content(
        &self,
        view: &PreviewMiniPlayerView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        match &view.source {
            PreviewMiniPlayerSource::Browser {
                runtime_tab_id,
                reconnecting,
                ..
            } => {
                let tab_id = runtime_tab_id.clone();
                let corner_radius = view.radius;
                let cover = cx
                    .try_global::<BrowserHostHandle>()
                    .and_then(|host| host.0.read(cx).cover(runtime_tab_id));
                div()
                    .absolute()
                    .inset_0()
                    .rounded(px(view.radius))
                    .overflow_hidden()
                    .when(!reconnecting, |this| {
                        this.child(
                            canvas(
                                move |bounds, _, cx| {
                                    if let Some(host) =
                                        cx.try_global::<BrowserHostHandle>().map(|h| h.0.clone())
                                    {
                                        host.update(cx, |host, cx| {
                                            host.set_slot(
                                                &tab_id,
                                                bounds,
                                                SlotKind::MiniPlayer { corner_radius },
                                                cx,
                                            )
                                        });
                                    }
                                },
                                |_, _, _, _| {},
                            )
                            .absolute()
                            .size_full(),
                        )
                    })
                    .when_some(cover, |this, (image, bounds)| {
                        this.child(
                            img(image)
                                .absolute()
                                .left(bounds.origin.x)
                                .top(bounds.origin.y)
                                .w(bounds.size.width)
                                .h(bounds.size.height),
                        )
                    })
                    .when(*reconnecting, |this| {
                        this.child(
                            div()
                                .absolute()
                                .inset_0()
                                .flex()
                                .items_center()
                                .justify_center()
                                .bg(t.muted)
                                .text_size(px(text::XS))
                                .text_color(t.muted_foreground)
                                .child("Reconnecting preview…"),
                        )
                    })
                    .into_any_element()
            }
            PreviewMiniPlayerSource::Device { stream, .. } => {
                let loading = stream.loading.as_ref().map(|loading| {
                    let reconnect = loading.error.then(|| {
                        let client = self.client.clone();
                        let key = stream.key.clone();
                        Button::new("mini-device-reconnect")
                            .size(ButtonSize::Sm)
                            .variant(ButtonVariant::Outline)
                            .label("Reconnect")
                            .on_click(move |_, _, cx| {
                                act(&client, cx, "deviceStreamReconnect", json!({ "key": key }))
                            })
                            .into_any_element()
                    });
                    div().absolute().inset_0().child(loading_view(
                        &loading.name,
                        &loading.description,
                        &loading.message,
                        loading.error,
                        LoadingStage::Stream,
                        reconnect,
                        t,
                    ))
                });
                div()
                    .absolute()
                    .inset_0()
                    .rounded(px(view.radius))
                    .overflow_hidden()
                    .flex()
                    .children(self.device.as_ref().map(|(_, screen)| screen.clone()))
                    .children(loading)
                    .into_any_element()
            }
        }
    }
}

impl Render for MiniPlayer {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = theme::active(cx);
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            self.reported = None;
            return div().into_any_element();
        };
        let this = cx.entity().downgrade();
        let measure = canvas(
            move |bounds, _, cx| {
                if let Some(player) = this.upgrade() {
                    player.update(cx, |player, cx| player.report_layout(bounds, cx));
                }
            },
            |_, _, _, _| {},
        )
        .absolute()
        .size_full();
        let drag = self.dragging.then(|| {
            let mover = cx.entity().downgrade();
            canvas(
                |_, _, _| {},
                move |_, _, window, _| {
                    let ender = mover.clone();
                    let mover = mover.clone();
                    window.on_mouse_event(move |event: &MouseMoveEvent, phase, _, cx| {
                        if phase != DispatchPhase::Bubble {
                            return;
                        }
                        if let Some(player) = mover.upgrade() {
                            player.update(cx, |player, cx| {
                                act(
                                    &player.client,
                                    cx,
                                    "previewMiniPlayerGestureMove",
                                    json!({
                                        "x": f32::from(event.position.x),
                                        "y": f32::from(event.position.y),
                                    }),
                                );
                            });
                        }
                    });
                    window.on_mouse_event(move |_: &MouseUpEvent, phase, _, cx| {
                        if phase != DispatchPhase::Bubble {
                            return;
                        }
                        if let Some(player) = ender.upgrade() {
                            player.update(cx, |player, cx| {
                                player.dragging = false;
                                act(&player.client, cx, "previewMiniPlayerGestureEnd", json!({}));
                                cx.notify();
                            });
                        }
                    });
                },
            )
            .absolute()
            .size_full()
        });
        let frame_element = view.frame.clone().map(|frame| {
            let open = self.zone_hovered || self.pill_hovered || self.dragging;
            let content = self.content(&view, &t, cx);
            let pill = open.then(|| tracked(self.pill(&view, &t, cx)));
            let handles = Handle::ALL.map(|handle| {
                handle
                    .place(div().absolute())
                    .id(SharedString::from(format!(
                        "mini-player-resize-{}",
                        handle.direction()
                    )))
                    .cursor(handle.cursor())
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |player, event: &MouseDownEvent, _, cx| {
                            cx.stop_propagation();
                            player.begin(event, Some(handle.direction()), cx);
                        }),
                    )
            });
            div()
                .id(SharedString::from(format!(
                    "mini-player-{}",
                    view.source_key
                )))
                .absolute()
                .left(px(frame.x))
                .top(px(frame.y))
                .w(px(frame.width))
                .h(px(frame.height))
                .rounded(px(view.radius))
                .child(
                    div()
                        .absolute()
                        .inset_0()
                        .rounded(px(view.radius))
                        .bg(t.muted)
                        .shadow(vec![shadow(0., 25., 50., -12., black(0.35))]),
                )
                .child(content)
                .child(
                    div()
                        .absolute()
                        .inset_0()
                        .rounded(px(view.radius))
                        .border_1()
                        .border_color(fade(t.border, 0.8)),
                )
                .child(
                    div()
                        .id("mini-player-pill-zone")
                        .absolute()
                        .right(px(view.pill_inset))
                        .top(px(view.pill_inset))
                        .size(px(PILL_ZONE))
                        .on_hover(cx.listener(|player, hovered: &bool, _, cx| {
                            player.zone_hovered = *hovered;
                            cx.notify();
                        }))
                        .when(!open, |this| {
                            this.child(
                                div()
                                    .absolute()
                                    .right_0()
                                    .top_0()
                                    .size(px(STATUS_DOT))
                                    .rounded_full()
                                    .border_1()
                                    .border_color(fade(t.background, 0.7))
                                    .bg(if view.recording {
                                        t.destructive
                                    } else {
                                        fade(t.foreground, 0.25)
                                    })
                                    .shadow(vec![
                                        shadow(0., 1., 3., 0., black(0.1)),
                                        shadow(0., 1., 2., -1., black(0.1)),
                                    ]),
                            )
                        })
                        .children(pill),
                )
                .children(handles)
        });
        div()
            .absolute()
            .inset_0()
            .child(measure)
            .children(frame_element)
            .children(drag)
            .into_any_element()
    }
}
