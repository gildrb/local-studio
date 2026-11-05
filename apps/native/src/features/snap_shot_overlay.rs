use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, Bounds, BoxShadow, Context, Corners, FontWeight, Hsla,
    ImgResourceLoader, IntoElement, ParentElement, Pixels, Point, Render, RenderImage, Resource,
    Rgba, Size, Styled, TitlebarOptions, Window, WindowBackgroundAppearance, WindowBounds,
    WindowHandle, WindowKind, WindowOptions, canvas, div, img, linear_color_stop, linear_gradient,
    point, px, size,
};

use crate::app_core::views::snap_shot::{
    SnapShotFlashView, SnapShotRect, SnapShotTransitionDestinationView,
    SnapShotTransitionDetailsView, SnapShotTransitionView,
};
use crate::platform::snap_shot::{OVERLAYS, configure_overlay};

const FLASH_PEAK_OPACITY: f32 = 0.08;
const TRANSITION_FLASH_MS: f32 = 300.;
const TRANSITION_FLASH_KEYFRAMES: [(f32, f32); 4] =
    [(0., 0.08), (0.38, 0.08), (0.68, 0.02), (1., 0.)];
const SOURCE_RADIUS: f32 = 12.;
const SOURCE_SHADOW_Y: f32 = 24.;
const SOURCE_SHADOW_BLUR: f32 = 70.;
const SOURCE_SHADOW_ALPHA: f32 = 0.24;
const DETAILS_FADE_MS: f32 = 125.;
const DETAILS_ICON: f32 = 28.;
const DETAILS_ICON_RADIUS: f32 = 6.;
const DETAILS_GAP: f32 = 6.;
const DETAILS_PADDING_TOP: f32 = 24.;
const DETAILS_PADDING_X: f32 = 10.;
const DETAILS_PADDING_BOTTOM: f32 = 8.;
const DETAILS_LINE: f32 = 14.;
const DETAILS_APP: f32 = 11.;
const DETAILS_TITLE: f32 = 9.;
const DETAILS_INITIAL: f32 = 10.;
const LANDING_FRAMES: Duration = Duration::from_millis(32);
const EASING: (f32, f32, f32, f32) = (0.2, 0.8, 0.2, 1.);
const EASE_IN: (f32, f32, f32, f32) = (0.42, 0., 1., 1.);

fn cubic_bezier((x1, y1, x2, y2): (f32, f32, f32, f32), progress: f32) -> f32 {
    let progress = progress.clamp(0., 1.);
    let sample = |a: f32, b: f32, t: f32| {
        let u = 1. - t;
        3. * u * u * t * a + 3. * u * t * t * b + t * t * t
    };
    let (mut low, mut high) = (0., 1.);
    let mut t = progress;
    for _ in 0..32 {
        let x = sample(x1, x2, t);
        if (x - progress).abs() < 1e-5 {
            break;
        }
        if x < progress {
            low = t;
        } else {
            high = t;
        }
        t = (low + high) / 2.;
    }
    sample(y1, y2, t)
}

fn lerp(from: f32, to: f32, progress: f32) -> f32 {
    from + (to - from) * progress
}

fn elapsed_ms(since: Instant) -> f32 {
    since.elapsed().as_secs_f32() * 1000.
}

pub fn parse_css_hex(value: &str) -> Option<Rgba> {
    let hex = value.strip_prefix('#')?;
    let parsed = u32::from_str_radix(hex, 16).ok()?;
    match hex.len() {
        8 => Some(gpui::rgba(parsed)),
        6 => Some(gpui::rgba((parsed << 8) | 0xff)),
        _ => None,
    }
}

fn rect_bounds(rect: SnapShotRect) -> Bounds<Pixels> {
    Bounds::new(
        point(px(rect.x), px(rect.y)),
        size(px(rect.width), px(rect.height)),
    )
}

fn intersects(left: &Bounds<Pixels>, right: &Bounds<Pixels>) -> bool {
    left.origin.x < right.origin.x + right.size.width
        && left.origin.x + left.size.width > right.origin.x
        && left.origin.y < right.origin.y + right.size.height
        && left.origin.y + left.size.height > right.origin.y
}

fn union(left: Bounds<Pixels>, right: Bounds<Pixels>) -> Bounds<Pixels> {
    let x = left.origin.x.min(right.origin.x);
    let y = left.origin.y.min(right.origin.y);
    let right_edge = (left.origin.x + left.size.width).max(right.origin.x + right.size.width);
    let bottom = (left.origin.y + left.size.height).max(right.origin.y + right.size.height);
    Bounds::new(point(x, y), size(right_edge - x, bottom - y))
}

fn overlay_options(bounds: Bounds<Pixels>) -> WindowOptions {
    WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds::new(
            point(px(0.), px(0.)),
            bounds.size,
        ))),
        titlebar: Some(TitlebarOptions {
            title: None,
            appears_transparent: true,
            traffic_light_position: None,
        }),
        focus: false,
        show: false,
        kind: WindowKind::PopUp,
        is_movable: false,
        app_owns_titlebar_drag: false,
        inactive_frame_interval: None,
        is_resizable: false,
        is_minimizable: false,
        display_id: None,
        window_background: WindowBackgroundAppearance::Transparent,
        app_id: None,
        window_min_size: None,
        window_decorations: None,
        icon: None,
        tabbing_identifier: None,
    }
}

fn open_overlay<V: Render + 'static>(
    bounds: Bounds<Pixels>,
    cx: &mut App,
    build: impl FnOnce(&mut Window, &mut Context<V>) -> V + 'static,
) -> Option<WindowHandle<V>> {
    let handle = cx
        .open_window(overlay_options(bounds), |window, cx| {
            let view = cx.new(|cx| build(window, cx));
            configure_overlay(window, bounds);
            view
        })
        .ok()?;
    Some(handle)
}

fn close_overlay<V: 'static>(handle: WindowHandle<V>, cx: &mut App) {
    let _ = handle.update(cx, |_, window, _| window.remove_window());
}

pub struct FlashOverlay {
    started: Instant,
    animated: bool,
    duration_ms: f32,
}

impl Render for FlashOverlay {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let elapsed = elapsed_ms(self.started);
        let opacity = if self.animated {
            window.request_animation_frame();
            (FLASH_PEAK_OPACITY * (1. - elapsed / self.duration_ms)).max(0.)
        } else {
            FLASH_PEAK_OPACITY
        };
        if self.animated && elapsed >= self.duration_ms {
            return div().size_full();
        }
        div().size_full().bg(Hsla::white().opacity(opacity))
    }
}

struct Flight {
    destination: SnapShotTransitionDestinationView,
    started: Instant,
}

pub struct TransitionOverlay {
    origin: Point<Pixels>,
    source: Bounds<Pixels>,
    image: Resource,
    flash: bool,
    shown: Option<Instant>,
    details: Option<SnapShotTransitionDetailsView>,
    flight: Option<Flight>,
}

struct CardGeometry {
    card: Bounds<Pixels>,
    card_radius: f32,
    content: Bounds<Pixels>,
    content_radius: f32,
    image: Bounds<Pixels>,
    background: Hsla,
    shadow: bool,
    border: Option<(f32, Hsla, f32)>,
    details: Option<(f32, f32)>,
    animating: bool,
}

impl TransitionOverlay {
    fn geometry(&self, image_size: Size<f32>) -> CardGeometry {
        let source = Bounds::new(self.source.origin - self.origin, self.source.size);
        let Some(flight) = &self.flight else {
            return CardGeometry {
                card: source,
                card_radius: SOURCE_RADIUS,
                content: source,
                content_radius: SOURCE_RADIUS,
                image: source,
                background: Hsla::white(),
                shadow: true,
                border: None,
                details: None,
                animating: false,
            };
        };
        let destination = &flight.destination;
        let target = rect_bounds(destination.frame);
        let target = Bounds::new(target.origin - self.origin, target.size);
        let (tw, th) = (f32::from(target.size.width), f32::from(target.size.height));
        let (sw, sh) = (f32::from(source.size.width), f32::from(source.size.height));
        let border_width = destination
            .border_width
            .max(0.)
            .min(((tw.min(th) - 1.) / 2.).max(0.));
        let inner = (
            (tw - border_width * 2.).max(1.),
            (th - border_width * 2.).max(1.),
        );
        let elapsed = elapsed_ms(flight.started);
        let duration = destination.duration_ms.max(1.);
        let progress = cubic_bezier(EASING, elapsed / duration);
        let scale = (lerp(sw / tw, 1., progress), lerp(sh / th, 1., progress));
        let average = (scale.0 + scale.1) / 2.;
        let center = |bounds: Bounds<Pixels>| {
            (
                f32::from(bounds.origin.x) + f32::from(bounds.size.width) / 2.,
                f32::from(bounds.origin.y) + f32::from(bounds.size.height) / 2.,
            )
        };
        let (scx, scy) = center(source);
        let (tcx, tcy) = center(target);
        let (cx, cy) = (lerp(scx, tcx, progress), lerp(scy, tcy, progress));
        let centered = |width: f32, height: f32| {
            Bounds::new(
                point(px(cx - width / 2.), px(cy - height / 2.)),
                size(px(width), px(height)),
            )
        };
        let content_scale = (
            lerp(tw / inner.0, 1., progress),
            lerp(th / inner.1, 1., progress),
        );
        let content_size = (
            inner.0 * content_scale.0 * scale.0,
            inner.1 * content_scale.1 * scale.1,
        );
        let natural = (image_size.width.max(1.), image_size.height.max(1.));
        let cover = (inner.0 / natural.0).max(inner.1 / natural.1);
        let image_scale = (
            lerp(1., natural.0 * cover / inner.0, progress),
            lerp(1., natural.1 * cover / inner.1, progress),
        );
        let content_average = (content_scale.0 * scale.0 + content_scale.1 * scale.1) / 2.;
        let details_opacity = cubic_bezier(
            EASE_IN,
            (elapsed - (duration - DETAILS_FADE_MS).max(0.)) / DETAILS_FADE_MS,
        );
        CardGeometry {
            card: centered(tw * scale.0, th * scale.1),
            card_radius: destination.corner_radius * average,
            content: centered(content_size.0, content_size.1),
            content_radius: (destination.corner_radius - border_width).max(0.) * content_average,
            image: centered(
                content_size.0 * image_scale.0,
                content_size.1 * image_scale.1,
            ),
            background: parse_css_hex(&destination.background_color)
                .map(Hsla::from)
                .unwrap_or_else(Hsla::white),
            shadow: false,
            border: parse_css_hex(&destination.border_color)
                .map(|color| (border_width * average, Hsla::from(color), progress)),
            details: self.details.as_ref().map(|_| {
                (
                    details_opacity,
                    destination.scale_factor.max(0.1) * content_average,
                )
            }),
            animating: elapsed < duration,
        }
    }

    fn details(&self, content: Bounds<Pixels>, opacity: f32, scale: f32) -> Option<AnyElement> {
        let details = self.details.as_ref()?;
        let white = Hsla::white();
        let icon: AnyElement = match details.app_icon_path.clone() {
            Some(path) => img(PathBuf::from(path))
                .flex_none()
                .size(px(DETAILS_ICON * scale))
                .rounded(px(DETAILS_ICON_RADIUS * scale))
                .into_any_element(),
            None => div()
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(DETAILS_ICON * scale))
                .rounded(px(DETAILS_ICON_RADIUS * scale))
                .bg(white.opacity(0.2))
                .text_size(px(DETAILS_INITIAL * scale))
                .font_weight(FontWeight::MEDIUM)
                .text_color(white)
                .child(details.app_initial.to_uppercase())
                .into_any_element(),
        };
        Some(
            div()
                .absolute()
                .left(content.origin.x)
                .top(content.origin.y)
                .w(content.size.width)
                .h(content.size.height)
                .flex()
                .flex_col()
                .justify_end()
                .opacity(opacity)
                .child(
                    div()
                        .flex()
                        .min_w_0()
                        .items_center()
                        .gap(px(DETAILS_GAP * scale))
                        .pt(px(DETAILS_PADDING_TOP * scale))
                        .px(px(DETAILS_PADDING_X * scale))
                        .pb(px(DETAILS_PADDING_BOTTOM * scale))
                        .bg(linear_gradient(
                            180.,
                            linear_color_stop(gpui::black().opacity(0.), 0.),
                            linear_color_stop(gpui::black().opacity(0.85), 1.),
                        ))
                        .child(icon)
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .child(
                                    div()
                                        .truncate()
                                        .text_size(px(DETAILS_APP * scale))
                                        .line_height(px(DETAILS_LINE * scale))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(white)
                                        .child(details.app_name.clone()),
                                )
                                .child(
                                    div()
                                        .truncate()
                                        .text_size(px(DETAILS_TITLE * scale))
                                        .line_height(px(DETAILS_LINE * scale))
                                        .text_color(white.opacity(0.7))
                                        .child(details.window_title.clone()),
                                ),
                        ),
                )
                .into_any_element(),
        )
    }
}

fn flash_opacity(elapsed: f32) -> f32 {
    let progress = cubic_bezier(EASING, elapsed / TRANSITION_FLASH_MS);
    TRANSITION_FLASH_KEYFRAMES
        .windows(2)
        .find(|pair| progress <= pair[1].0)
        .map(|pair| {
            let (from, to) = (pair[0], pair[1]);
            lerp(from.1, to.1, (progress - from.0) / (to.0 - from.0))
        })
        .unwrap_or(0.)
}

impl Render for TransitionOverlay {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(Ok(image)) = window.use_asset::<ImgResourceLoader>(&self.image, cx) else {
            return div().size_full().into_any_element();
        };
        let shown = *self.shown.get_or_insert_with(Instant::now);
        let natural = image.size(0);
        let geometry = self.geometry(size(natural.width.0 as f32, natural.height.0 as f32));
        let flash_elapsed = elapsed_ms(shown);
        let flashing = self.flash && flash_elapsed < TRANSITION_FLASH_MS;
        if geometry.animating || flashing {
            window.request_animation_frame();
        }
        let card = geometry.card;
        let content = geometry.content;
        let image_bounds = geometry.image;
        let content_radius = px(geometry.content_radius);
        let paint_image: Arc<RenderImage> = image;
        div()
            .size_full()
            .relative()
            .child(
                div()
                    .absolute()
                    .left(card.origin.x)
                    .top(card.origin.y)
                    .w(card.size.width)
                    .h(card.size.height)
                    .rounded(px(geometry.card_radius))
                    .bg(geometry.background)
                    .when(geometry.shadow, |this| {
                        this.shadow(vec![BoxShadow {
                            color: gpui::black().opacity(SOURCE_SHADOW_ALPHA),
                            offset: point(px(0.), px(SOURCE_SHADOW_Y)),
                            blur_radius: px(SOURCE_SHADOW_BLUR),
                            spread_radius: px(0.),
                            inset: false,
                        }])
                    }),
            )
            .child(
                canvas(
                    |_, _, _| {},
                    move |_, _, window, _| {
                        let _ = window.paint_image(
                            content,
                            image_bounds,
                            Corners::all(content_radius),
                            paint_image.clone(),
                            0,
                            false,
                        );
                    },
                )
                .absolute()
                .size_full(),
            )
            .children(
                geometry
                    .details
                    .and_then(|(opacity, scale)| self.details(content, opacity, scale)),
            )
            .when_some(geometry.border, |this, (width, color, opacity)| {
                this.child(
                    div()
                        .absolute()
                        .left(card.origin.x)
                        .top(card.origin.y)
                        .w(card.size.width)
                        .h(card.size.height)
                        .rounded(px(geometry.card_radius))
                        .border(px(width))
                        .border_color(color)
                        .opacity(opacity),
                )
            })
            .when(flashing, |this| {
                this.child(
                    div()
                        .absolute()
                        .left(card.origin.x)
                        .top(card.origin.y)
                        .w(card.size.width)
                        .h(card.size.height)
                        .rounded(px(geometry.card_radius))
                        .bg(Hsla::white().opacity(flash_opacity(flash_elapsed))),
                )
            })
            .into_any_element()
    }
}

struct ActiveTransition {
    id: String,
    source: Bounds<Pixels>,
    image: Resource,
    flash: bool,
    overlays: Vec<(Bounds<Pixels>, WindowHandle<TransitionOverlay>)>,
    flight: Option<Instant>,
}

#[derive(Default)]
pub struct SnapShotOverlays {
    flash: Option<(u64, WindowHandle<FlashOverlay>)>,
    transition: Option<ActiveTransition>,
}

pub enum OverlayEvent {
    FlightStarted { id: String, duration: Duration },
}

impl SnapShotOverlays {
    pub fn sync_flash(&mut self, flash: Option<&SnapShotFlashView>, cx: &mut App) {
        if self.flash.as_ref().map(|(seq, _)| *seq) == flash.map(|flash| flash.seq) {
            return;
        }
        if let Some((_, handle)) = self.flash.take() {
            close_overlay(handle, cx);
        }
        let Some(flash) = flash.filter(|_| OVERLAYS) else {
            return;
        };
        let animated = flash.animated;
        let duration_ms = flash.duration_ms;
        self.flash = open_overlay(rect_bounds(flash.bounds), cx, move |_, _| FlashOverlay {
            started: Instant::now(),
            animated,
            duration_ms,
        })
        .map(|handle| (flash.seq, handle));
    }

    pub fn sync_transition(
        &mut self,
        transition: Option<&SnapShotTransitionView>,
        cx: &mut App,
    ) -> Option<OverlayEvent> {
        if self.transition.as_ref().map(|active| active.id.as_str())
            != transition.map(|transition| transition.id.as_str())
        {
            if let Some(active) = self.transition.take() {
                for (_, handle) in active.overlays {
                    close_overlay(handle, cx);
                }
            }
            let transition = transition.filter(|_| OVERLAYS)?;
            let source = rect_bounds(transition.source);
            let mut active = ActiveTransition {
                id: transition.id.clone(),
                source,
                image: Resource::Path(PathBuf::from(&transition.image_path).into()),
                flash: transition.flash,
                overlays: Vec::new(),
                flight: None,
            };
            Self::cover(&mut active, source, cx);
            self.transition = Some(active);
        }
        let transition = transition?;
        let active = self.transition.as_mut()?;
        let mut event = None;
        if let Some(destination) = &transition.destination
            && active.flight.is_none()
        {
            let started = Instant::now();
            active.flight = Some(started);
            let flight = union(active.source, rect_bounds(destination.frame));
            Self::cover(active, flight, cx);
            event = Some(OverlayEvent::FlightStarted {
                id: active.id.clone(),
                duration: Duration::from_secs_f32(destination.duration_ms.max(0.) / 1000.)
                    + LANDING_FRAMES,
            });
        }
        let details = transition.details.clone();
        let destination = transition.destination.clone();
        let flight = active.flight;
        for (_, handle) in &active.overlays {
            let details = details.clone();
            let destination = destination.clone();
            let _ = handle.update(cx, |overlay, _, cx| {
                overlay.details = details;
                if overlay.flight.is_none()
                    && let (Some(destination), Some(started)) = (destination, flight)
                {
                    overlay.flight = Some(Flight {
                        destination,
                        started,
                    });
                }
                cx.notify();
            });
        }
        event
    }

    fn cover(active: &mut ActiveTransition, area: Bounds<Pixels>, cx: &mut App) {
        let displays: Vec<Bounds<Pixels>> = cx
            .displays()
            .iter()
            .map(|display| display.bounds())
            .filter(|bounds| intersects(bounds, &area))
            .filter(|bounds| !active.overlays.iter().any(|(covered, _)| covered == bounds))
            .collect();
        for bounds in displays {
            let source = active.source;
            let image = active.image.clone();
            let flash = active.flash && active.flight.is_none();
            let handle = open_overlay(bounds, cx, move |_, _| TransitionOverlay {
                origin: bounds.origin,
                source,
                image,
                flash,
                shown: None,
                details: None,
                flight: None,
            });
            if let Some(handle) = handle {
                active.overlays.push((bounds, handle));
            }
        }
    }
}
