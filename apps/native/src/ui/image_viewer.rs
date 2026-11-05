use std::cell::Cell;
use std::path::PathBuf;
use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, BoxShadow, ClickEvent, Context, Entity, FocusHandle, Global,
    HighlightStyle, ImgResourceLoader, InteractiveElement, IntoElement, KeyDownEvent, MouseButton,
    MouseDownEvent, MouseMoveEvent, MouseUpEvent, ObjectFit, ParentElement, Pixels, Point, Render,
    Resource, ScrollDelta, ScrollWheelEvent, SharedString, Size, StatefulInteractiveElement,
    Styled, StyledImage, StyledText, Window, canvas, div, img, point, px, svg,
};
use serde_json::json;

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::media::{MediaLinkView, MediaViewerItemView, MediaViewerView};
use crate::app_core::views::timeline::{TimelineSnapShotAccessibilityView, TimelineSnapShotView};
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::dialog::{DialogPopup, DialogVariant};
use crate::ui::theme;
use crate::ui::theme::metrics::radius;
use crate::ui::theme::tokens::fade;
use crate::ui::tooltip::Tooltip;
use crate::ui::video_player::{VideoPlayer, VideoSurface};

const MAX_ZOOM: f32 = 8.;
const TOGGLE_ZOOM: f32 = 2.;
const ZOOM_STEP: f32 = 1.5;
const WHEEL_FACTOR: f32 = 0.002;
const PINCH_WHEEL_FACTOR: f32 = 0.01;
const LINE_MODE_SCALE: f32 = 16.;
const PAN_STEP: f32 = 40.;
const DRAG_THRESHOLD: f32 = 4.;
const MEDIA_HEIGHT_RATIO: f32 = 0.86;
const MEDIA_HEIGHT_MARGIN: f32 = 160.;
const DIALOG_RATIO: f32 = 0.92;
const SIDE_INSET: f32 = 48.;
const SIDE_MIN_WIDTH: f32 = 640.;
const NAV_SIZE: f32 = 32.;
const NAV_ICON: f32 = 20.;
const CLOSE_SIZE: f32 = 24.;
const CLOSE_ICON: f32 = 14.;
const CLOSE_OFFSET: f32 = 40.;
const CAPTION_TOP_GAP: f32 = 8.;
const CAPTION_ROW_GAP: f32 = 6.;
const CAPTION_TEXT: f32 = 12.;
const CAPTION_LINE: f32 = 16.;
const CAPTION_BUTTON: f32 = 20.;
const CAPTION_BUTTON_ICON: f32 = 12.;
const CONTENTS_MAX_WIDTH: f32 = 672.;
const CONTENTS_MAX_HEIGHT: f32 = 640.;
const CONTENTS_PADDING: f32 = 16.;
const CONTENTS_TEXT: f32 = 12.;
const CONTENTS_LINE: f32 = 20.;
const FAILURE_HEIGHT: f32 = 192.;
const FAILURE_MAX_WIDTH: f32 = 512.;
const FAILURE_PADDING: f32 = 24.;
const STATE_GAP: f32 = 12.;
const STATE_TEXT: f32 = 14.;
const STATE_LINE: f32 = 20.;
const ALERT_ICON: f32 = 14.;
const ALERT_GAP: f32 = 6.;

fn image_shadow() -> Vec<BoxShadow> {
    vec![BoxShadow {
        color: fade(gpui::black().into(), 0.25).into(),
        offset: point(px(0.), px(25.)),
        blur_radius: px(50.),
        spread_radius: px(-12.),
        inset: false,
    }]
}

struct MediaViewerHandle(Entity<MediaViewerHost>);

impl Global for MediaViewerHandle {}

/// A locally opened preview item, for composer attachments that only exist on disk.
#[derive(Clone, Debug, PartialEq)]
pub struct LocalMediaImage {
    pub name: String,
    pub path: String,
}

#[derive(Clone)]
struct LocalPreview {
    images: Vec<LocalMediaImage>,
    index: usize,
}

enum MediaSource {
    Url(String),
    Path(String),
}

impl MediaSource {
    fn key(&self) -> &str {
        match self {
            MediaSource::Url(url) => url,
            MediaSource::Path(path) => path,
        }
    }
}

enum Showing {
    Core(MediaViewerView),
    Local {
        name: String,
        source: MediaSource,
        index: usize,
        count: usize,
    },
}

pub struct MediaViewerHost {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<MediaViewerView>>>,
    local: Option<LocalPreview>,
    focus: FocusHandle,
    active_key: Option<String>,
    zoom: f32,
    scroll: Point<Pixels>,
    drag: Option<DragState>,
    suppress_click: bool,
    viewport: Rc<Cell<gpui::Bounds<Pixels>>>,
    natural_key: Option<String>,
    natural: Size<Pixels>,
    media: (f32, f32),
}

struct DragState {
    start: Point<Pixels>,
    scroll: Point<Pixels>,
}

/// The expanded viewer's caption: the item name, with its position when there is a gallery.
fn expanded_caption(name: &str, index: usize, count: usize) -> String {
    if count > 1 {
        format!("{name} ({}/{count})", index + 1)
    } else {
        name.to_string()
    }
}

/// The measured media box: 92vw − 96px wide on wide windows, min(86vh, 100vh − 160px) tall.
fn media_box(viewport: gpui::Size<Pixels>) -> (f32, f32) {
    let width = f32::from(viewport.width) * DIALOG_RATIO
        - if f32::from(viewport.width) >= SIDE_MIN_WIDTH {
            SIDE_INSET * 2.
        } else {
            0.
        };
    let height = (f32::from(viewport.height) * MEDIA_HEIGHT_RATIO)
        .min(f32::from(viewport.height) - MEDIA_HEIGHT_MARGIN)
        .max(1.);
    (width.max(1.), height)
}

impl MediaViewerHost {
    pub fn install(client: &Entity<CoreClient>, window: &mut Window, cx: &mut App) {
        if cx.has_global::<MediaViewerHandle>() {
            return;
        }
        let host = cx.new(|cx| Self::new(client.clone(), window, cx));
        cx.set_global(MediaViewerHandle(host));
    }

    pub fn global(cx: &App) -> Option<Entity<MediaViewerHost>> {
        cx.try_global::<MediaViewerHandle>()
            .map(|handle| handle.0.clone())
    }

    fn new(client: Entity<CoreClient>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let view =
            CoreClient::subscribe::<Option<MediaViewerView>>(&client, "mediaViewer", json!({}), cx);
        cx.observe_in(&view, window, |host, view, window, cx| {
            if view.read(cx).data.as_ref().is_some_and(Option::is_some) {
                window.focus(&host.focus, cx);
            }
            cx.notify();
        })
        .detach();
        Self {
            client,
            view,
            local: None,
            focus: cx.focus_handle(),
            active_key: None,
            zoom: 1.,
            scroll: point(px(0.), px(0.)),
            drag: None,
            suppress_click: false,
            viewport: Rc::new(Cell::new(gpui::Bounds::default())),
            natural_key: None,
            natural: Size {
                width: px(0.),
                height: px(0.),
            },
            media: (1., 1.),
        }
    }

    fn reset_zoom(&mut self) {
        self.zoom = 1.;
        self.scroll = point(px(0.), px(0.));
        self.drag = None;
        self.suppress_click = false;
    }

    /// Opens composer attachments that only exist on disk, without a core round trip.
    pub fn open_local_images(cx: &mut App, images: Vec<LocalMediaImage>, index: usize) {
        let Some(host) = Self::global(cx) else {
            return;
        };
        if images.is_empty() {
            return;
        }
        let count = images.len();
        host.update(cx, |host, cx| {
            host.local = Some(LocalPreview {
                images,
                index: index.min(count.saturating_sub(1)),
            });
            host.reset_zoom();
            cx.notify();
        });
    }

    fn close_local(&mut self, cx: &mut Context<Self>) {
        if self.local.take().is_some() {
            self.reset_zoom();
            cx.notify();
        }
    }

    fn act(&self, action: &'static str, params: serde_json::Value, cx: &mut App) {
        self.client
            .update(cx, |client, _| client.act(action, params));
    }

    fn close(&mut self, cx: &mut Context<Self>) {
        if self
            .view
            .read(cx)
            .data
            .as_ref()
            .is_some_and(Option::is_some)
        {
            self.act("mediaViewerClose", json!({}), cx);
        } else {
            self.close_local(cx);
        }
    }

    fn navigate(&self, direction: f64, cx: &mut App) {
        self.act("mediaViewerNavigate", json!({ "direction": direction }), cx);
    }

    fn toggle_contents(&self, cx: &mut App) {
        self.act("mediaViewerToggleContents", json!({}), cx);
    }

    fn sync_item_key(&mut self, key: String) {
        if self.active_key.as_deref() != Some(key.as_str()) {
            self.active_key = Some(key);
            self.natural_key = None;
            self.reset_zoom();
        }
    }

    fn sync_natural(
        &mut self,
        source: &MediaSource,
        media: (f32, f32),
        window: &mut Window,
        cx: &mut App,
    ) {
        self.media = media;
        if self.natural_key.as_deref() == Some(source.key()) {
            return;
        }
        let resource = match source {
            MediaSource::Url(url) => Resource::Uri(SharedString::from(url.as_str()).into()),
            MediaSource::Path(path) => Resource::Path(PathBuf::from(path.as_str()).into()),
        };
        if let Some(Ok(image)) = window.use_asset::<ImgResourceLoader>(&resource, cx) {
            let size = image.size(0);
            self.natural = Size {
                width: px(size.width.0 as f32),
                height: px(size.height.0 as f32),
            };
            self.natural_key = Some(source.key().to_string());
        }
    }

    fn span(&self) -> (f32, f32, f32, f32) {
        let media = self.media;
        let natural_width = f32::from(self.natural.width).max(1.);
        let natural_height = f32::from(self.natural.height).max(1.);
        let fit = (media.0 / natural_width)
            .min(media.1 / natural_height)
            .min(1.);
        let scale = fit * self.zoom;
        let width = natural_width * scale;
        let height = natural_height * scale;
        (width, height, width.min(media.0), height.min(media.1))
    }

    fn clamp_scroll(&mut self) {
        let span = self.span();
        let max_x = (span.0 - span.2).max(0.);
        let max_y = (span.1 - span.3).max(0.);
        self.scroll.x = self.scroll.x.clamp(px(0.), px(max_x));
        self.scroll.y = self.scroll.y.clamp(px(0.), px(max_y));
    }

    fn change_zoom(&mut self, next: f32, anchor: Option<Point<Pixels>>) {
        let previous = self.zoom;
        let clamped = next.clamp(1., MAX_ZOOM);
        if (previous - clamped).abs() < 0.001 {
            return;
        }
        let span = self.span();
        let local = anchor.unwrap_or(point(px(span.2 / 2.), px(span.3 / 2.)));
        let content_x = f32::from(self.scroll.x + local.x) / previous;
        let content_y = f32::from(self.scroll.y + local.y) / previous;
        self.zoom = clamped;
        self.scroll.x = px((content_x * clamped - f32::from(local.x)).max(0.));
        self.scroll.y = px((content_y * clamped - f32::from(local.y)).max(0.));
        self.clamp_scroll();
    }

    fn wheel_zoom(&mut self, event: &ScrollWheelEvent) {
        let delta = match event.delta {
            ScrollDelta::Pixels(point) => f32::from(point.y),
            ScrollDelta::Lines(point) => point.y * LINE_MODE_SCALE,
        };
        if delta == 0. {
            return;
        }
        // Chromium multiplies line-mode deltas by 16 before the same exponential curve.
        let factor = if event.modifiers.control {
            PINCH_WHEEL_FACTOR
        } else {
            WHEEL_FACTOR
        };
        let bounds = self.viewport.get();
        let local = point(
            event.position.x - bounds.origin.x,
            event.position.y - bounds.origin.y,
        );
        self.change_zoom(self.zoom * (-delta * factor).exp(), Some(local));
    }

    fn pan_key(&mut self, key: &str) -> bool {
        if self.zoom <= 1. {
            return false;
        }
        let span = self.span();
        let max_x = (span.0 - span.2).max(0.);
        let max_y = (span.1 - span.3).max(0.);
        match key {
            "left" if max_x > 0. => {
                self.scroll.x = (self.scroll.x - px(PAN_STEP)).max(px(0.));
                true
            }
            "right" if max_x > 0. => {
                self.scroll.x = (self.scroll.x + px(PAN_STEP)).min(px(max_x));
                true
            }
            "up" if max_y > 0. => {
                self.scroll.y = (self.scroll.y - px(PAN_STEP)).max(px(0.));
                true
            }
            "down" if max_y > 0. => {
                self.scroll.y = (self.scroll.y + px(PAN_STEP)).min(px(max_y));
                true
            }
            _ => false,
        }
    }

    fn zoomable_image(&mut self, source: &MediaSource, cx: &mut Context<Self>) -> AnyElement {
        let (width, height, view_width, view_height) = {
            self.clamp_scroll();
            self.span()
        };
        let viewport = self.viewport.clone();
        let entity = cx.entity();
        let drag_entity = cx.entity();
        let dragging = self.drag.is_some();
        let image_element = match source {
            MediaSource::Url(url) => img(SharedString::from(url.as_str())),
            MediaSource::Path(path) => img(PathBuf::from(path.as_str())),
        };
        div()
            .id("media-image")
            .relative()
            .overflow_hidden()
            .rounded(px(radius::LG))
            .border_1()
            .border_color(fade(theme::active(cx).border, 0.7))
            .bg(theme::active(cx).background)
            .shadow(image_shadow())
            .w(px(view_width))
            .h(px(view_height))
            .cursor_pointer()
            .on_mouse_down(MouseButton::Left, {
                let entity = entity.clone();
                move |event: &MouseDownEvent, _, cx| {
                    cx.stop_propagation();
                    entity.update(cx, |host, cx| {
                        host.suppress_click = false;
                        let bounds = host.viewport.get();
                        let local = point(
                            event.position.x - bounds.origin.x,
                            event.position.y - bounds.origin.y,
                        );
                        if f32::from(local.x) >= f32::from(bounds.size.width)
                            || f32::from(local.y) >= f32::from(bounds.size.height)
                        {
                            return;
                        }
                        if host.zoom > 1. {
                            host.drag = Some(DragState {
                                start: event.position,
                                scroll: host.scroll,
                            });
                            cx.notify();
                        }
                    });
                }
            })
            .on_click({
                let entity = entity.clone();
                move |event: &ClickEvent, _, cx| {
                    cx.stop_propagation();
                    entity.update(cx, |host, cx| {
                        if host.suppress_click {
                            // Pointer capture also produces a click after dragging.
                            host.suppress_click = false;
                            cx.notify();
                            return;
                        }
                        let next = if host.zoom > 1. { 1. } else { TOGGLE_ZOOM };
                        let bounds = host.viewport.get();
                        let local = point(
                            event.position().x - bounds.origin.x,
                            event.position().y - bounds.origin.y,
                        );
                        host.change_zoom(next, Some(local));
                        cx.notify();
                    });
                }
            })
            .on_scroll_wheel({
                let entity = entity.clone();
                move |event: &ScrollWheelEvent, _, cx| {
                    cx.stop_propagation();
                    entity.update(cx, |host, cx| {
                        host.wheel_zoom(event);
                        cx.notify();
                    });
                }
            })
            .child(
                canvas(move |bounds, _, _| viewport.set(bounds), |_, _, _, _| {})
                    .absolute()
                    .size_0(),
            )
            .child(
                div()
                    .absolute()
                    .left(-self.scroll.x)
                    .top(-self.scroll.y)
                    .w(px(width))
                    .h(px(height))
                    .child(image_element.size_full().object_fit(ObjectFit::Contain)),
            )
            .when(dragging, |this| {
                this.child(
                    canvas(
                        move |_, _, _| {},
                        move |_, _, window, _| {
                            window.on_mouse_event({
                                let entity = drag_entity.clone();
                                move |event: &MouseMoveEvent, _, _, cx| {
                                    entity.update(cx, |host, cx| {
                                        let Some(drag) = host.drag.as_ref() else {
                                            return;
                                        };
                                        let dx = f32::from(event.position.x - drag.start.x);
                                        let dy = f32::from(event.position.y - drag.start.y);
                                        if dx.hypot(dy) > DRAG_THRESHOLD {
                                            host.suppress_click = true;
                                        }
                                        host.scroll.x = drag.scroll.x - px(dx);
                                        host.scroll.y = drag.scroll.y - px(dy);
                                        host.clamp_scroll();
                                        cx.notify();
                                    });
                                }
                            });
                            window.on_mouse_event({
                                let entity = drag_entity.clone();
                                move |_: &MouseUpEvent, _, _, cx| {
                                    entity.update(cx, |host, cx| {
                                        if host.drag.take().is_some() {
                                            cx.notify();
                                        }
                                    });
                                }
                            });
                        },
                    )
                    .absolute()
                    .size_0(),
                )
            })
            .into_any_element()
    }

    fn contents_panel(&self, snap: &TimelineSnapShotView, cx: &App) -> AnyElement {
        let t = theme::active(cx);
        let dark = t.appearance == theme::Appearance::Dark;
        let mut text = String::new();
        let mut highlights: Vec<(std::ops::Range<usize>, gpui::Rgba)> = Vec::new();
        if let TimelineSnapShotAccessibilityView::Json { lines } = &snap.accessibility {
            for line in lines {
                if !text.is_empty() {
                    text.push('\n');
                }
                for token in line {
                    let start = text.len();
                    text.push_str(&token.text);
                    if let Some(color) = (if dark { &token.dark } else { &token.light })
                        .as_deref()
                        .and_then(|color| gpui::Rgba::try_from(color).ok())
                    {
                        highlights.push((start..text.len(), color));
                    }
                }
            }
        }
        let body = match &snap.accessibility {
            TimelineSnapShotAccessibilityView::Json { .. } => div().child(
                StyledText::new(SharedString::from(text)).with_highlights(
                    highlights
                        .into_iter()
                        .map(|(range, color)| {
                            (
                                range,
                                HighlightStyle {
                                    color: Some(color.into()),
                                    ..HighlightStyle::default()
                                },
                            )
                        })
                        .collect::<Vec<_>>(),
                ),
            ),
            TimelineSnapShotAccessibilityView::Text { text } => {
                div().child(SharedString::from(text.as_str()))
            }
            TimelineSnapShotAccessibilityView::Unnamed
            | TimelineSnapShotAccessibilityView::None => div(),
        };
        div()
            .w(px(self.media.0.min(CONTENTS_MAX_WIDTH)))
            .h(px(self.media.1.min(CONTENTS_MAX_HEIGHT)))
            .child(
                div()
                    .id("media-contents")
                    .overflow_y_scroll()
                    .font_family(MONO_FONT)
                    .text_size(px(CONTENTS_TEXT))
                    .line_height(px(CONTENTS_LINE))
                    .rounded(px(radius::LG))
                    .border_1()
                    .border_color(fade(t.border, 0.7))
                    .bg(t.background)
                    .p(px(CONTENTS_PADDING))
                    .shadow(image_shadow())
                    .child(body),
            )
            .into_any_element()
    }

    fn failure_body(&self, item: &MediaViewerItemView, width: f32) -> AnyElement {
        let MediaViewerItemView::Image {
            failure_message,
            open_link,
            ..
        } = item
        else {
            return div().into_any_element();
        };
        failure_panel(
            failure_message,
            open_link.as_ref(),
            width,
            self.client.clone(),
        )
    }
}

impl Render for MediaViewerHost {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let core = self.view.read(cx).data.clone().flatten();
        let local = self.local.clone();
        let showing = match (core, local) {
            (Some(view), _) => Some(Showing::Core(view)),
            (None, Some(preview)) => {
                preview
                    .images
                    .get(preview.index)
                    .map(|image| Showing::Local {
                        name: image.name.clone(),
                        source: MediaSource::Path(image.path.clone()),
                        index: preview.index,
                        count: preview.images.len(),
                    })
            }
            (None, None) => None,
        };
        let Some(showing) = showing else {
            return div().into_any_element();
        };
        self.render_viewer(showing, window, cx)
    }
}

impl MediaViewerHost {
    fn render_viewer(
        &mut self,
        showing: Showing,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let media = media_box(window.viewport_size());
        self.media = media;
        let key = match &showing {
            Showing::Core(view) => view.item_key.clone(),
            Showing::Local { name, index, .. } => format!("local:{index}:{name}"),
        };
        self.sync_item_key(key);
        let entity = cx.entity();
        let close_entity = cx.entity();
        let contents_entity = cx.entity();
        let prev_client = self.client.clone();
        let next_client = self.client.clone();

        let video_is_open = matches!(
            &showing,
            Showing::Core(MediaViewerView {
                item: MediaViewerItemView::Video { .. },
                ..
            })
        );
        let (caption, count, body, contents_toggle): (
            String,
            usize,
            AnyElement,
            Option<AnyElement>,
        ) = match showing {
            Showing::Core(view) => {
                let count = view.count;
                let caption = view.caption.clone();
                let contents_state = match &view.item {
                    MediaViewerItemView::Image {
                        contents: Some(state),
                        ..
                    } => Some(state.clone()),
                    _ => None,
                };
                let showing_details = contents_state.as_ref().map(|state| state.showing);
                let body = match (&view.item, showing_details) {
                    (MediaViewerItemView::Image { .. }, Some(true)) => match &view.item {
                        MediaViewerItemView::Image {
                            snap_shot: Some(snap),
                            ..
                        } => self.contents_panel(snap, cx),
                        _ => div().into_any_element(),
                    },
                    (MediaViewerItemView::Image { src, .. }, _) => {
                        match src.as_deref().map(|url| MediaSource::Url(url.to_string())) {
                            Some(source) => {
                                self.sync_natural(&source, media, window, cx);
                                self.zoomable_image(&source, cx)
                            }
                            None => self.failure_body(&view.item, media.0),
                        }
                    }
                    (MediaViewerItemView::Video { video, auto_play }, _) => VideoPlayer::keyed(
                        SharedString::from(format!("lightbox.{}", view.item_key)),
                        &self.client,
                        video,
                        VideoSurface::Lightbox {
                            max_width: media.0,
                            max_height: media.1,
                        },
                        *auto_play,
                        window,
                        cx,
                    )
                    .into_any_element(),
                };
                let contents_toggle = contents_state.map(|state| {
                    let showing_details = state.showing;
                    caption_button(
                        "media-contents-toggle",
                        if showing_details {
                            "icons/media/image.svg"
                        } else {
                            "icons/media/text.svg"
                        },
                        state.label.clone().into(),
                        move |_, _, cx| {
                            contents_entity.update(cx, |host, cx| host.toggle_contents(cx));
                        },
                    )
                });
                (caption, count, body, contents_toggle)
            }
            Showing::Local {
                name,
                source,
                index,
                count,
            } => {
                self.sync_natural(&source, media, window, cx);
                let body = self.zoomable_image(&source, cx);
                (expanded_caption(&name, index, count), count, body, None)
            }
        };
        let caption_label = caption.clone();
        let has_navigation = count > 1;

        let stage = div()
            .track_focus(&self.focus)
            .id("media-viewer-stage")
            .relative()
            .flex()
            .w_full()
            .items_center()
            .justify_center()
            .on_key_down({
                let entity = entity.clone();
                move |event: &KeyDownEvent, _, cx| {
                    let key = event.keystroke.key.as_str();
                    if key == "escape" {
                        cx.stop_propagation();
                        entity.update(cx, |host, cx| host.close(cx));
                        return;
                    }
                    if host_is_video(&entity, cx) {
                        return;
                    }
                    entity.update(cx, |host, cx| match key {
                        "enter" | "space" => {
                            host.change_zoom(if host.zoom > 1. { 1. } else { TOGGLE_ZOOM }, None);
                            cx.notify();
                        }
                        "+" | "=" => {
                            host.change_zoom(host.zoom * ZOOM_STEP, None);
                            cx.notify();
                        }
                        "-" => {
                            host.change_zoom(host.zoom / ZOOM_STEP, None);
                            cx.notify();
                        }
                        "0" => {
                            host.change_zoom(1., None);
                            cx.notify();
                        }
                        "left" | "right" | "up" | "down" => {
                            if !host.pan_key(key) {
                                match key {
                                    "left" => host.navigate(-1., cx),
                                    "right" => host.navigate(1., cx),
                                    _ => {}
                                }
                            }
                            cx.notify();
                        }
                        _ => {}
                    });
                }
            })
            .when(has_navigation, |this| {
                this.child(nav_button(
                    "media-prev",
                    "icons/chevron-left.svg",
                    "Previous media",
                    prev_client,
                    -1.,
                ))
                .child(nav_button(
                    "media-next",
                    "icons/chevron-right.svg",
                    "Next media",
                    next_client,
                    1.,
                ))
            })
            .child(
                div()
                    .relative()
                    .flex()
                    .flex_col()
                    .items_center()
                    .max_h(px(f32::from(window.viewport_size().height) * DIALOG_RATIO))
                    .max_w(px(media.0 + SIDE_INSET * 2.))
                    .child(
                        div()
                            .absolute()
                            .right(px(0.))
                            .top(px(-CLOSE_OFFSET))
                            .flex()
                            .child(
                                overlay_button(
                                    "media-viewer-close",
                                    "icons/x.svg",
                                    CLOSE_SIZE,
                                    CLOSE_ICON,
                                    if video_is_open {
                                        "Close video preview"
                                    } else {
                                        "Close image preview"
                                    },
                                    move |_, _, cx| {
                                        close_entity.update(cx, |host, cx| host.close(cx));
                                    },
                                )
                                .rounded(px(radius::LG))
                                .bg(fade(gpui::black().into(), 0.65))
                                .shadow(vec![BoxShadow {
                                    color: fade(gpui::black().into(), 0.2).into(),
                                    offset: point(px(0.), px(1.)),
                                    blur_radius: px(2.),
                                    spread_radius: px(0.),
                                    inset: false,
                                }])
                                .hover(|style| style.bg(fade(gpui::black().into(), 0.8))),
                            ),
                    )
                    .child(body)
                    .child(
                        div()
                            .mt(px(CAPTION_TOP_GAP))
                            .flex()
                            .max_w(px(media.0))
                            .items_center()
                            .justify_center()
                            .gap(px(CAPTION_ROW_GAP))
                            .text_size(px(CAPTION_TEXT))
                            .line_height(px(CAPTION_LINE))
                            .text_color(fade(gpui::white().into(), 0.8))
                            .child(div().min_w_0().truncate().child(caption_label))
                            .children(contents_toggle),
                    ),
            );
        DialogPopup::new("media-viewer")
            .variant(DialogVariant::Media)
            .show_close_button(false)
            .child(stage)
            .into_any_element()
    }
}

fn host_is_video(entity: &Entity<MediaViewerHost>, cx: &mut App) -> bool {
    entity
        .read(cx)
        .view
        .read(cx)
        .data
        .as_ref()
        .is_some_and(|view| {
            view.as_ref()
                .is_some_and(|view| matches!(view.item, MediaViewerItemView::Video { .. }))
        })
}

fn caption_button(
    id: &'static str,
    icon_path: &'static str,
    label: SharedString,
    on_click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> AnyElement {
    div()
        .id(id)
        .flex_none()
        .flex()
        .size(px(CAPTION_BUTTON))
        .items_center()
        .justify_center()
        .rounded(px(radius::SM))
        .bg(fade(gpui::black().into(), 0.7))
        .text_color(fade(gpui::white().into(), 0.65))
        .hover(|style| style.bg(fade(gpui::black().into(), 0.9)))
        .cursor_pointer()
        .on_click(move |event, window, cx| {
            cx.stop_propagation();
            on_click(event, window, cx);
        })
        .child(svg().path(icon_path).size(px(CAPTION_BUTTON_ICON)))
        .tooltip(Tooltip::text(label))
        .into_any_element()
}

fn nav_button(
    id: &'static str,
    icon_path: &'static str,
    label: &'static str,
    client: Entity<CoreClient>,
    direction: f64,
) -> AnyElement {
    div()
        .id(id)
        .absolute()
        .top(px(0.))
        .bottom(px(0.))
        .flex()
        .items_center()
        .child(
            div()
                .id(SharedString::from(format!("{id}-button")))
                .flex()
                .size(px(NAV_SIZE))
                .items_center()
                .justify_center()
                .rounded_full()
                .text_color(fade(gpui::white().into(), 0.9))
                .hover(|style| style.bg(gpui::hsla(0., 0., 1., 0.1)))
                .cursor_pointer()
                .child(svg().path(icon_path).size(px(NAV_ICON)))
                .tooltip(Tooltip::text(label))
                .on_click(move |_, _, cx| {
                    cx.stop_propagation();
                    client.update(cx, |client, _| {
                        client.act("mediaViewerNavigate", json!({ "direction": direction }))
                    });
                }),
        )
        .into_any_element()
}

fn overlay_button(
    id: &'static str,
    icon_path: &'static str,
    size: f32,
    icon_size: f32,
    label: &'static str,
    on_click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> gpui::Stateful<gpui::Div> {
    div()
        .id(id)
        .flex_none()
        .flex()
        .size(px(size))
        .items_center()
        .justify_center()
        .cursor_pointer()
        .text_color(gpui::white())
        .on_click(move |event, window, cx| {
            cx.stop_propagation();
            on_click(event, window, cx);
        })
        .child(svg().path(icon_path).size(px(icon_size)))
        .tooltip(Tooltip::text(label))
}

fn failure_panel(
    message: &str,
    link: Option<&MediaLinkView>,
    width: f32,
    client: Entity<CoreClient>,
) -> AnyElement {
    let link_element = link.map(|link| {
        let client = client.clone();
        let url = link.url.clone();
        let is_blob = url.starts_with("blob:");
        Button::new("media-failure-link")
            .size(ButtonSize::Sm)
            .variant(ButtonVariant::Secondary)
            .icon(if is_blob { "download" } else { "external-link" })
            .label(link.label.clone())
            .on_click(move |_, _, cx| {
                client.update(cx, |client, _| {
                    client.act("mediaOpenLink", json!({ "url": url }))
                });
            })
    });
    div()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap(px(STATE_GAP))
        .w(px(width.min(FAILURE_MAX_WIDTH)))
        .h(px(FAILURE_HEIGHT))
        .rounded(px(radius::LG))
        .border_1()
        .border_color(fade(gpui::white().into(), 0.16))
        .bg(gpui::black())
        .p(px(FAILURE_PADDING))
        .text_center()
        .text_size(px(STATE_TEXT))
        .line_height(px(STATE_LINE))
        .text_color(gpui::white())
        .shadow(image_shadow())
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
                        .text_color(gpui::white()),
                )
                .child(message.to_string()),
        )
        .children(link_element)
        .into_any_element()
}
