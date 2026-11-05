use std::cell::Cell;
use std::rc::Rc;
use std::time::Duration;

use futures::StreamExt;
use futures::channel::mpsc;
use gpui::prelude::FluentBuilder;
use gpui::{
    AnchoredPositionMode, AnyElement, App, Bounds, BoxShadow, ClickEvent, Context, Entity,
    FocusHandle, InteractiveElement, IntoElement, KeyDownEvent, MouseButton, MouseDownEvent,
    MouseMoveEvent, MouseUpEvent, ObjectFit, ParentElement, Pixels, Render, SharedString,
    StatefulInteractiveElement, Styled, Task, Window, anchored, canvas, deferred, div,
    linear_color_stop, linear_gradient, point, px, relative, rgba, svg,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::media::MediaVideoView;
use crate::platform::media_player::{NativePlayer, PlayerFrame, PlayerStatus};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::theme;
use crate::ui::theme::color::hsla;
use crate::ui::theme::tokens::{Tokens, fade};

const ROW_HEIGHT: f32 = 48.;
const TIMELINE_HEIGHT: f32 = 24.;
const CONTROL_SIZE: f32 = 48.;
const CONTROL_HOVER: f32 = 36.;
const CONTROL_ICON: f32 = 20.;
const TIME_TEXT: f32 = 14.;
const TIME_GAP: f32 = 4.;
const TRACK_HEIGHT: f32 = 4.;
const TRACK_INSET: f32 = 16.;
const THUMB: f32 = 12.;
const GRADIENT_HEIGHT: f32 = 112.;
const PLAY_BADGE: f32 = 32.;
const PLAY_BADGE_ICON: f32 = 16.;
const RADIUS: f32 = 8.;
const STATE_GAP: f32 = 12.;
const STATE_TEXT: f32 = 14.;
const STATE_LINE: f32 = 20.;
const ALERT_ICON: f32 = 14.;
const ALERT_GAP: f32 = 6.;
const LIGHTBOX_STATE_HEIGHT: f32 = 192.;
const LIGHTBOX_STATE_MAX_WIDTH: f32 = 512.;
const LIGHTBOX_STATE_PADDING: f32 = 24.;
const INLINE_STATE_MIN_HEIGHT: f32 = 112.;
const INLINE_STATE_PADDING: f32 = 16.;
const VIDEO_ASPECT: f32 = 16. / 9.;
const HIDE_DELAY: Duration = Duration::from_millis(3000);
const POLL: Duration = Duration::from_millis(100);
const END_EPSILON: f64 = 0.05;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum VideoSurface {
    /// Markdown, pull request and file previews: 16:9 inside the given width bound.
    Inline {
        max_width: Option<f32>,
        border_alpha: f32,
    },
    /// The expanded viewer: the intrinsic size inside the media box.
    Lightbox { max_width: f32, max_height: f32 },
    /// The timeline grid cell: a still first frame that opens the viewer.
    Thumbnail,
}

pub struct VideoPlayer {
    client: Entity<CoreClient>,
    video: MediaVideoView,
    surface: VideoSurface,
    auto_play: bool,
    player: Option<NativePlayer>,
    loaded_src: Option<String>,
    failed_src: Option<String>,
    retrying: bool,
    status: PlayerStatus,
    frame: Option<PlayerFrame>,
    primed: bool,
    muted: bool,
    fullscreen: bool,
    controls_visible: bool,
    scrub: Option<f64>,
    track: Rc<Cell<Bounds<Pixels>>>,
    focus: FocusHandle,
    hide: Option<Task<()>>,
    poll: Option<Task<()>>,
    wake: Option<Task<()>>,
}

fn format_time(seconds: f64) -> String {
    let total = if seconds.is_finite() {
        seconds.max(0.).floor() as u64
    } else {
        0
    };
    let (hours, minutes, secs) = (total / 3600, (total % 3600) / 60, total % 60);
    if hours > 0 {
        format!("{hours}:{minutes:02}:{secs:02}")
    } else {
        format!("{minutes}:{secs:02}")
    }
}

fn frame_element(frame: PlayerFrame) -> AnyElement {
    #[cfg(target_os = "macos")]
    {
        gpui::surface(frame)
            .size_full()
            .object_fit(ObjectFit::Contain)
            .into_any_element()
    }
    #[cfg(not(target_os = "macos"))]
    {
        gpui::img(gpui::ImageSource::Render(frame))
            .size_full()
            .object_fit(ObjectFit::Contain)
            .into_any_element()
    }
}

fn white(alpha: f32) -> gpui::Rgba {
    fade(gpui::white().into(), alpha)
}

impl VideoPlayer {
    pub fn new(
        client: Entity<CoreClient>,
        video: MediaVideoView,
        surface: VideoSurface,
        auto_play: bool,
        cx: &mut Context<Self>,
    ) -> Self {
        Self {
            client,
            video,
            surface,
            auto_play,
            player: None,
            loaded_src: None,
            failed_src: None,
            retrying: false,
            status: PlayerStatus::default(),
            frame: None,
            primed: false,
            muted: surface == VideoSurface::Thumbnail,
            fullscreen: false,
            controls_visible: true,
            scrub: None,
            track: Rc::new(Cell::new(Bounds::default())),
            focus: cx.focus_handle(),
            hide: None,
            poll: None,
            wake: None,
        }
    }

    /// Keyed state for one inline or thumbnail player, dropped once its element stops rendering.
    pub fn keyed(
        key: impl Into<gpui::ElementId>,
        client: &Entity<CoreClient>,
        video: &MediaVideoView,
        surface: VideoSurface,
        auto_play: bool,
        window: &mut Window,
        cx: &mut App,
    ) -> Entity<Self> {
        let entity = window.use_keyed_state(key, cx, |_, cx| {
            Self::new(client.clone(), video.clone(), surface, auto_play, cx)
        });
        entity.update(cx, |player, cx| player.update(video, surface, cx));
        entity
    }

    pub fn update(
        &mut self,
        video: &MediaVideoView,
        surface: VideoSurface,
        cx: &mut Context<Self>,
    ) {
        if self.video == *video && self.surface == surface {
            return;
        }
        if self.video.src != video.src {
            self.retrying = false;
        }
        self.video = video.clone();
        self.surface = surface;
        cx.notify();
    }

    fn failed(&self) -> bool {
        match self.video.src.as_ref() {
            Some(src) => self.failed_src.as_ref() == Some(src),
            None => self.video.source_failed,
        }
    }

    fn release(&mut self) {
        self.player = None;
        self.loaded_src = None;
        self.frame = None;
        self.primed = false;
        self.wake = None;
        self.status = PlayerStatus::default();
    }

    fn sync_source(&mut self, cx: &mut Context<Self>) {
        let wanted = self.video.src.clone().filter(|_| !self.failed());
        if wanted == self.loaded_src || (self.player.is_some() && self.status.playing) {
            return;
        }
        let resume_at = self.player.is_some().then_some(self.status.current);
        self.release();
        let Some(src) = wanted else {
            return;
        };
        let (sender, mut receiver) = mpsc::unbounded::<()>();
        let wake = Box::new(move || {
            let _ = sender.unbounded_send(());
        });
        match NativePlayer::new(&src, wake) {
            Ok(mut player) => {
                player.set_muted(self.muted);
                if let Some(at) = resume_at.filter(|at| *at > 0.) {
                    player.seek(at);
                }
                if self.auto_play && self.surface != VideoSurface::Thumbnail {
                    player.play();
                }
                self.player = Some(player);
                self.wake = Some(cx.spawn(async move |this, cx| {
                    while receiver.next().await.is_some() {
                        if this.update(cx, |_, cx| cx.notify()).is_err() {
                            break;
                        }
                    }
                }));
            }
            Err(_) => self.failed_src = Some(src.clone()),
        }
        self.loaded_src = Some(src);
    }

    fn refresh(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.sync_source(cx);
        let Some(player) = self.player.as_mut() else {
            return;
        };
        let status = player.status();
        if status.error.is_some() {
            self.failed_src = self.loaded_src.clone();
            self.retrying = false;
            self.release();
            return;
        }
        if status.ready {
            self.retrying = false;
        }
        if let Some(frame) = player.frame() {
            self.frame = Some(frame);
        }
        if self.surface == VideoSurface::Thumbnail && status.ready && !self.primed {
            self.primed = true;
            player.seek(0.);
        }
        let was_playing = self.status.playing;
        self.status = status;
        if was_playing && !self.status.playing {
            self.controls_visible = true;
            self.hide = None;
        }
        let animating = self.status.playing && !self.status.waiting;
        let settling = !self.status.ready
            || self.status.waiting
            || (self.surface == VideoSurface::Thumbnail && self.frame.is_none())
            || (self.status.playing && self.frame.is_none());
        if animating {
            window.request_animation_frame();
        } else if settling && self.poll.is_none() {
            self.poll = Some(cx.spawn(async move |this, cx| {
                cx.background_executor().timer(POLL).await;
                let _ = this.update(cx, |this, cx| {
                    this.poll = None;
                    cx.notify();
                });
            }));
        }
    }

    fn toggle_play(&mut self, cx: &mut Context<Self>) {
        let Some(player) = self.player.as_mut() else {
            return;
        };
        if self.status.playing {
            player.pause();
            self.status.playing = false;
            self.controls_visible = true;
            self.hide = None;
        } else {
            if let Some(duration) = self.status.duration
                && self.status.current >= duration - END_EPSILON
            {
                player.seek(0.);
            }
            player.play();
            self.status.playing = true;
            self.schedule_hide(cx);
        }
        cx.notify();
    }

    fn toggle_muted(&mut self, cx: &mut Context<Self>) {
        self.muted = !self.muted;
        if let Some(player) = self.player.as_mut() {
            player.set_muted(self.muted);
        }
        cx.notify();
    }

    fn toggle_fullscreen(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.fullscreen = !self.fullscreen;
        window.focus(&self.focus, cx);
        cx.notify();
    }

    fn schedule_hide(&mut self, cx: &mut Context<Self>) {
        self.hide = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(HIDE_DELAY).await;
            let _ = this.update(cx, |this, cx| {
                if this.status.playing && this.scrub.is_none() {
                    this.controls_visible = false;
                    cx.notify();
                }
            });
        }));
    }

    fn reveal_controls(&mut self, cx: &mut Context<Self>) {
        if !self.controls_visible {
            self.controls_visible = true;
            cx.notify();
        }
        if self.status.playing {
            self.schedule_hide(cx);
        }
    }

    fn scrub_to(&mut self, x: Pixels, cx: &mut Context<Self>) {
        let Some(duration) = self.status.duration.filter(|duration| *duration > 0.) else {
            return;
        };
        let track = self.track.get();
        let width = f32::from(track.size.width);
        if width <= 0. {
            return;
        }
        let fraction = (f32::from(x - track.origin.x) / width).clamp(0., 1.) as f64;
        let at = fraction * duration;
        self.scrub = Some(at);
        if let Some(player) = self.player.as_mut() {
            player.seek(at);
        }
        cx.notify();
    }

    fn retry(&mut self, cx: &mut Context<Self>) {
        if self.retrying {
            return;
        }
        self.retrying = true;
        if let Some(retry) = self.video.retry.clone() {
            self.client
                .update(cx, |client, _| client.act("mediaRetry", retry));
        }
        self.failed_src = None;
        self.release();
        cx.notify();
    }

    /// The video's drawn size in the lightbox; `None` until the first frame arrives.
    fn lightbox_size(&self, max_width: f32, max_height: f32) -> Option<(f32, f32)> {
        let frame = self.frame.as_ref()?;
        let (width, height) = NativePlayer::frame_size(frame);
        if width <= 0. || height <= 0. {
            return None;
        }
        let scale = (max_width / width).min(max_height / height).min(1.);
        Some((width * scale, height * scale))
    }

    fn control_button(
        &self,
        id: &'static str,
        icon: &'static str,
        label: &'static str,
        on_click: impl Fn(&mut Self, &mut Window, &mut Context<Self>) + 'static,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        div()
            .id(id)
            .group(id)
            .flex()
            .flex_none()
            .size(px(CONTROL_SIZE))
            .items_center()
            .justify_center()
            .cursor_pointer()
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_click(cx.listener(move |this, _: &ClickEvent, window, cx| {
                cx.stop_propagation();
                on_click(this, window, cx)
            }))
            .child(
                div()
                    .flex()
                    .size(px(CONTROL_HOVER))
                    .items_center()
                    .justify_center()
                    .rounded_full()
                    .group_hover(id, |this| this.bg(rgba(0x20212499)))
                    .child(
                        svg()
                            .path(icon)
                            .size(px(CONTROL_ICON))
                            .text_color(gpui::white()),
                    ),
            )
            .tooltip(crate::ui::tooltip::Tooltip::text(label))
            .into_any_element()
    }

    fn controls(&self, cx: &mut Context<Self>) -> AnyElement {
        let duration = self.status.duration.unwrap_or(0.);
        let current = self.scrub.unwrap_or(self.status.current);
        let fraction = |value: f64| {
            if duration > 0. {
                (value / duration).clamp(0., 1.) as f32
            } else {
                0.
            }
        };
        let played = fraction(current);
        let buffered = fraction(self.status.buffered);
        let playing = self.status.playing;
        let track = self.track.clone();
        let row = div()
            .flex()
            .items_center()
            .h(px(ROW_HEIGHT))
            .child(self.control_button(
                "video-play",
                if playing {
                    "icons/media/pause.svg"
                } else {
                    "icons/media/play.svg"
                },
                if playing { "Pause" } else { "Play" },
                |this, _, cx| this.toggle_play(cx),
                cx,
            ))
            .child(
                div()
                    .flex()
                    .flex_none()
                    .gap(px(TIME_GAP))
                    .text_size(px(TIME_TEXT))
                    .text_color(gpui::white())
                    .child(format_time(current))
                    .child(format!("/ {}", format_time(duration))),
            )
            .child(div().flex_1())
            .child(self.control_button(
                "video-mute",
                if self.muted {
                    "icons/media/volume-off.svg"
                } else {
                    "icons/media/volume.svg"
                },
                if self.muted { "Unmute" } else { "Mute" },
                |this, _, cx| this.toggle_muted(cx),
                cx,
            ))
            .child(self.control_button(
                "video-fullscreen",
                if self.fullscreen {
                    "icons/media/fullscreen-exit.svg"
                } else {
                    "icons/media/fullscreen.svg"
                },
                if self.fullscreen {
                    "Exit full screen"
                } else {
                    "Full screen"
                },
                |this, window, cx| this.toggle_fullscreen(window, cx),
                cx,
            ));
        let bar = |width: f32, color: gpui::Rgba| {
            div()
                .absolute()
                .left_0()
                .top_0()
                .bottom_0()
                .w(relative(width))
                .rounded_full()
                .bg(color)
        };
        let timeline = div()
            .id("video-timeline")
            .relative()
            .h(px(TIMELINE_HEIGHT))
            .px(px(TRACK_INSET))
            .flex()
            .items_center()
            .cursor_pointer()
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, event: &MouseDownEvent, _, cx| {
                    cx.stop_propagation();
                    this.scrub_to(event.position.x, cx);
                }),
            )
            .on_click(|_, _, cx| cx.stop_propagation())
            .child(
                div()
                    .relative()
                    .flex_1()
                    .h(px(TRACK_HEIGHT))
                    .rounded_full()
                    .bg(white(0.3))
                    .child(bar(buffered, white(0.54)))
                    .child(bar(played, gpui::white().into()))
                    .child(
                        div()
                            .absolute()
                            .top(px((TRACK_HEIGHT - THUMB) / 2.))
                            .left(relative(played))
                            .ml(px(-THUMB / 2.))
                            .size(px(THUMB))
                            .rounded_full()
                            .bg(gpui::white()),
                    )
                    .child(
                        canvas(move |bounds, _, _| track.set(bounds), |_, _, _, _| {})
                            .absolute()
                            .size_full(),
                    ),
            );
        div()
            .absolute()
            .left_0()
            .right_0()
            .bottom_0()
            .h(px(GRADIENT_HEIGHT))
            .flex()
            .flex_col()
            .justify_end()
            .bg(linear_gradient(
                180.,
                linear_color_stop(hsla(fade(gpui::black().into(), 0.)), 0.),
                linear_color_stop(hsla(fade(gpui::black().into(), 0.5)), 1.),
            ))
            .child(row)
            .child(timeline)
            .into_any_element()
    }

    fn state_panel(&self, t: &Tokens, cx: &mut Context<Self>) -> AnyElement {
        let failed = self.failed();
        let base = div()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(STATE_GAP))
            .rounded(px(RADIUS))
            .border_1()
            .text_center()
            .text_size(px(STATE_TEXT))
            .line_height(px(STATE_LINE));
        let dark = |this: gpui::Div, alpha: f32| {
            this.bg(gpui::black())
                .text_color(gpui::white())
                .border_color(fade(t.border, alpha))
        };
        let panel = match self.surface {
            VideoSurface::Inline { max_width, .. } => {
                let panel = base
                    .w_full()
                    .when_some(max_width, |this, width| this.max_w(px(width)))
                    .aspect_ratio(VIDEO_ASPECT)
                    .min_h(px(INLINE_STATE_MIN_HEIGHT))
                    .p(px(INLINE_STATE_PADDING))
                    .border_color(fade(t.border, 0.4));
                if failed {
                    panel.bg(fade(t.muted, 0.4)).text_color(t.muted_foreground)
                } else {
                    panel.border_0().bg(fade(t.muted, 0.6))
                }
            }
            VideoSurface::Lightbox { max_width, .. } => dark(
                base.w(px(max_width.min(LIGHTBOX_STATE_MAX_WIDTH)))
                    .h(px(LIGHTBOX_STATE_HEIGHT))
                    .p(px(LIGHTBOX_STATE_PADDING))
                    .shadow(vec![BoxShadow {
                        color: hsla(fade(gpui::black().into(), 0.25)),
                        offset: point(px(0.), px(25.)),
                        blur_radius: px(50.),
                        spread_radius: px(-12.),
                        inset: false,
                    }]),
                0.7,
            ),
            VideoSurface::Thumbnail => dark(base.size_full(), 0.8),
        };
        if !failed || self.surface == VideoSurface::Thumbnail {
            return panel
                .when(
                    matches!(self.surface, VideoSurface::Inline { .. }),
                    |this| this.aspect_ratio(VIDEO_ASPECT),
                )
                .into_any_element();
        }
        let retry = self.video.can_retry.then(|| {
            Button::new("video-retry")
                .size(ButtonSize::Sm)
                .variant(ButtonVariant::Secondary)
                .icon("rotate-cw")
                .disabled(self.retrying)
                .label(if self.retrying {
                    "Retrying…"
                } else {
                    "Retry video"
                })
                .on_click(cx.listener(|this, _: &ClickEvent, _, cx| this.retry(cx)))
        });
        let link = self.video.open_link.clone().map(|link| {
            let client = self.client.clone();
            let url = link.url.clone();
            Button::new("video-open-link")
                .size(ButtonSize::Sm)
                .variant(ButtonVariant::Secondary)
                .icon(if url.starts_with("blob:") {
                    "download"
                } else {
                    "external-link"
                })
                .label(link.label)
                .on_click(move |_, _, cx| {
                    client.update(cx, |client, _| {
                        client.act("mediaOpenLink", json!({ "url": url }))
                    })
                })
        });
        panel
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(ALERT_GAP))
                    .child(
                        svg()
                            .path("icons/triangle-alert.svg")
                            .flex_none()
                            .size(px(ALERT_ICON))
                            .text_color(gpui::white())
                            .when(
                                matches!(self.surface, VideoSurface::Inline { .. }),
                                |this| this.text_color(t.muted_foreground),
                            ),
                    )
                    .child(self.video.unavailable_label.clone()),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .justify_center()
                    .gap(px(8.))
                    .children(retry)
                    .children(link),
            )
            .into_any_element()
    }

    fn video_frame(&self, t: &Tokens) -> gpui::Div {
        let border = match self.surface {
            VideoSurface::Inline { border_alpha, .. } => border_alpha,
            VideoSurface::Lightbox { .. } => 0.7,
            VideoSurface::Thumbnail => 0.8,
        };
        div()
            .relative()
            .overflow_hidden()
            .rounded(px(RADIUS))
            .border_1()
            .border_color(fade(t.border, border))
            .bg(gpui::black())
            .children(self.frame.clone().map(frame_element))
    }

    fn surface_element(
        &mut self,
        t: &Tokens,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let has_source = self.player.is_some() && !self.failed();
        if self.surface == VideoSurface::Thumbnail {
            let label = if self.video.label.is_empty() {
                "Play video".to_string()
            } else {
                format!("Play {}", self.video.label)
            };
            let body = if has_source {
                self.video_frame(t).size_full().into_any_element()
            } else {
                self.state_panel(t, cx)
            };
            return div()
                .relative()
                .size_full()
                .child(body)
                .child(
                    div()
                        .absolute()
                        .inset_0()
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(
                            div()
                                .flex()
                                .size(px(PLAY_BADGE))
                                .items_center()
                                .justify_center()
                                .rounded_full()
                                .bg(fade(gpui::black().into(), 0.5))
                                .child(
                                    svg()
                                        .path("icons/media/play-filled.svg")
                                        .size(px(PLAY_BADGE_ICON))
                                        .text_color(gpui::white()),
                                ),
                        ),
                )
                .id(SharedString::from(label))
                .into_any_element();
        }
        let lightbox_size = match self.surface {
            VideoSurface::Lightbox {
                max_width,
                max_height,
            } => self.lightbox_size(max_width, max_height),
            _ => None,
        };
        let showing = has_source
            && (self.frame.is_some() || !matches!(self.surface, VideoSurface::Lightbox { .. }));
        if !showing {
            return self.state_panel(t, cx);
        }
        let viewport = window.viewport_size();
        let controls = (self.controls_visible || !self.status.playing).then(|| self.controls(cx));
        let mut frame = self
            .video_frame(t)
            .id("video-surface")
            .track_focus(&self.focus)
            .cursor_pointer()
            .on_click(cx.listener(|this, event: &ClickEvent, window, cx| {
                if event.click_count() >= 2 {
                    this.toggle_fullscreen(window, cx);
                } else {
                    window.focus(&this.focus, cx);
                    this.toggle_play(cx);
                }
            }))
            .on_mouse_move(cx.listener(|this, _: &MouseMoveEvent, _, cx| this.reveal_controls(cx)))
            .on_hover(cx.listener(|this, hovered: &bool, _, cx| {
                if !*hovered && this.status.playing && this.scrub.is_none() {
                    this.controls_visible = false;
                    this.hide = None;
                    cx.notify();
                }
            }))
            .on_key_down(cx.listener(|this, event: &KeyDownEvent, window, cx| {
                match event.keystroke.key.as_str() {
                    "space" | "k" => this.toggle_play(cx),
                    "m" => this.toggle_muted(cx),
                    "f" => this.toggle_fullscreen(window, cx),
                    "escape" if this.fullscreen => this.toggle_fullscreen(window, cx),
                    _ => return,
                }
                cx.stop_propagation();
            }))
            .children(controls)
            .when(self.scrub.is_some(), |this| {
                this.child(
                    canvas(|_, _, _| {}, {
                        let entity = cx.entity();
                        move |_bounds: gpui::Bounds<gpui::Pixels>,
                              _: (),
                              window: &mut gpui::Window,
                              _cx: &mut gpui::App| {
                            let moved = entity.clone();
                            window.on_mouse_event(move |event: &MouseMoveEvent, _, _, cx| {
                                moved.update(cx, |this, cx| {
                                    if this.scrub.is_some() {
                                        this.scrub_to(event.position.x, cx)
                                    }
                                })
                            });
                            window.on_mouse_event(move |_: &MouseUpEvent, _, _, cx| {
                                entity.update(cx, |this, cx| {
                                    if this.scrub.take().is_some() {
                                        this.reveal_controls(cx);
                                        cx.notify();
                                    }
                                });
                            });
                        }
                    })
                    .absolute()
                    .size_0(),
                )
            });
        frame = if self.fullscreen {
            frame
                .w(viewport.width)
                .h(viewport.height)
                .rounded(px(0.))
                .border_0()
        } else {
            match self.surface {
                VideoSurface::Inline { max_width, .. } => frame
                    .w_full()
                    .when_some(max_width, |this, width| this.max_w(px(width)))
                    .aspect_ratio(VIDEO_ASPECT),
                VideoSurface::Lightbox { .. } => {
                    let (width, height) = lightbox_size.unwrap_or_default();
                    frame.w(px(width)).h(px(height)).shadow(vec![BoxShadow {
                        color: hsla(fade(gpui::black().into(), 0.25)),
                        offset: point(px(0.), px(25.)),
                        blur_radius: px(50.),
                        spread_radius: px(-12.),
                        inset: false,
                    }])
                }
                VideoSurface::Thumbnail => frame,
            }
        };
        if self.fullscreen {
            return deferred(
                anchored()
                    .position_mode(AnchoredPositionMode::Window)
                    .position(point(px(0.), px(0.)))
                    .child(frame.occlude()),
            )
            .with_priority(2)
            .into_any_element();
        }
        frame.into_any_element()
    }
}

impl Render for VideoPlayer {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.refresh(window, cx);
        let t = theme::active(cx);
        let element = self.surface_element(&t, window, cx);
        match self.surface {
            VideoSurface::Inline { max_width, .. } => div()
                .relative()
                .w_full()
                .when_some(max_width, |this, width| this.max_w(px(width)))
                .child(element)
                .into_any_element(),
            _ => element,
        }
    }
}
