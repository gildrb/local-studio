use std::cell::RefCell;
use std::collections::HashSet;
use std::path::PathBuf;
use std::rc::Rc;
use std::time::Duration;

use gpui::prelude::FluentBuilder;
use gpui::{
    Animation, AnimationExt, AnyElement, App, Entity, InteractiveElement, IntoElement, ObjectFit,
    ParentElement, Rgba, SharedString, StatefulInteractiveElement, Styled, StyledImage, Window,
    canvas, div, img, px, svg,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::composer_input::{ComposerImageUploadView, ComposerImageView};
use crate::features::chat::user_message_parts::snap_shot_overlay;
use crate::platform::snap_shot::content_origin;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::paint_scale::paint_scale;
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

pub const CARD_WIDTH: f32 = 208.;
pub const CARD_HEIGHT: f32 = 112.;
const CARD_RADIUS: f32 = 10.;
const CARD_BORDER: f32 = 1.;
const CARD_BORDER_ALPHA: f32 = 0.8;
const ARRIVAL_MS: u64 = 300;
const ARRIVAL_EASING: (f32, f32, f32, f32) = (0.32, 0.72, 0., 1.);
const REMOVE_SIZE: f32 = 24.;
const REMOVE_INSET: f32 = 4.;
const REMOVE_RADIUS: f32 = 8.;
const REMOVE_FILL: f32 = 0.65;
const REMOVE_ICON: f32 = 14.;
const ARRIVAL_SCALE: f32 = 0.95;
const UPLOAD_TEXT: f32 = 10.;
const UPLOAD_LINE: f32 = 14.;
const UPLOAD_PADDING_X: f32 = 4.;
const UPLOAD_FILL: f32 = 0.85;
const CAPTION_UPLOADING_BOTTOM: f32 = 16.;
const CAPTION_FAILED_BOTTOM: f32 = 32.;
const RETRY_INSET: f32 = 4.;

pub type ReportedDestinations = Rc<RefCell<HashSet<String>>>;

fn css_hex(color: Rgba) -> String {
    let Rgba { r, g, b, a } = color;
    let byte = |value: f32| (value.clamp(0., 1.) * 255.).round() as u8;
    format!(
        "#{:02x}{:02x}{:02x}{:02x}",
        byte(r),
        byte(g),
        byte(b),
        byte(a)
    )
}

fn ease(progress: f32) -> f32 {
    let (x1, y1, x2, y2) = ARRIVAL_EASING;
    let sample = |a: f32, b: f32, t: f32| {
        let u = 1. - t;
        3. * u * u * t * a + 3. * u * t * t * b + t * t * t
    };
    let (mut low, mut high, mut t) = (0., 1., progress);
    for _ in 0..24 {
        if sample(x1, x2, t) < progress {
            low = t;
        } else {
            high = t;
        }
        t = (low + high) / 2.;
    }
    sample(y1, y2, t)
}

fn destination_reporter(
    id: String,
    has_source: bool,
    background: Rgba,
    border: Rgba,
    client: Entity<CoreClient>,
    reported: ReportedDestinations,
) -> impl IntoElement {
    canvas(
        move |bounds, window: &mut Window, cx: &mut App| {
            let key = format!("{id}:{has_source}");
            if reported.borrow().contains(&key) {
                return;
            }
            let Some(origin) = content_origin(window) else {
                return;
            };
            let zoom = window.zoom();
            let frame = json!({
                "x": f32::from(origin.x) + f32::from(bounds.origin.x) * zoom,
                "y": f32::from(origin.y) + f32::from(bounds.origin.y) * zoom,
                "width": f32::from(bounds.size.width) * zoom,
                "height": f32::from(bounds.size.height) * zoom,
            });
            reported.borrow_mut().insert(key);
            client.update(cx, |client, _| {
                client.act(
                    "snapShotAnimationDestination",
                    json!({
                        "id": id,
                        "frame": frame,
                        "backgroundColor": css_hex(background),
                        "borderColor": css_hex(border),
                        "borderWidth": CARD_BORDER,
                        "cornerRadius": CARD_RADIUS,
                        "scaleFactor": zoom,
                    }),
                )
            });
        },
        |_, _, _, _| {},
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full()
}

fn frame(id: SharedString, t: &Tokens) -> gpui::Stateful<gpui::Div> {
    div()
        .id(id)
        .relative()
        .flex_none()
        .w(px(CARD_WIDTH))
        .max_w_full()
        .h(px(CARD_HEIGHT))
        .overflow_hidden()
        .rounded(px(CARD_RADIUS))
        .border(px(CARD_BORDER))
        .border_color(fade(t.border, CARD_BORDER_ALPHA))
        .bg(t.background)
}

pub fn pending_card(
    id: &str,
    client: &Entity<CoreClient>,
    reported: &ReportedDestinations,
    t: &Tokens,
) -> AnyElement {
    frame(
        SharedString::from(format!("composer-snap-shot-pending-{id}")),
        t,
    )
    .invisible()
    .child(destination_reporter(
        id.to_string(),
        false,
        t.background,
        fade(t.border, CARD_BORDER_ALPHA),
        client.clone(),
        reported.clone(),
    ))
    .into_any_element()
}

pub fn snap_shot_card(
    image: &ComposerImageView,
    client: &Entity<CoreClient>,
    reported: &ReportedDestinations,
    t: &Tokens,
) -> AnyElement {
    let remove_client = client.clone();
    let remove_id = image.id.clone();
    let group = SharedString::from(format!("composer-snap-shot-group-{}", image.id));
    let card = frame(
        SharedString::from(format!("composer-image-{}", image.id)),
        t,
    )
    .group(group.clone())
    .when(image.animation_pending, |this| {
        this.invisible().child(destination_reporter(
            image.id.clone(),
            image.snap_shot.is_some(),
            t.background,
            fade(t.border, CARD_BORDER_ALPHA),
            client.clone(),
            reported.clone(),
        ))
    })
    .when_some(image.path.clone(), |this, path| {
        this.child(
            img(PathBuf::from(path))
                .size_full()
                .object_fit(ObjectFit::Cover),
        )
    })
    .when_none(&image.path, |this| {
        this.child(
            div()
                .flex()
                .size_full()
                .items_center()
                .justify_center()
                .px(px(4.))
                .text_size(px(10.))
                .text_color(t.secondary_label)
                .child(image.name.clone()),
        )
    })
    .when_some(image.snap_shot.as_ref(), |this, snap| {
        let caption = snap_shot_overlay(&format!("composer-snap-shot-{}", image.id), snap);
        this.child(match image.upload {
            Some(ComposerImageUploadView::Uploading { .. }) => {
                caption.bottom(px(CAPTION_UPLOADING_BOTTOM))
            }
            Some(ComposerImageUploadView::Failed { .. }) => {
                caption.bottom(px(CAPTION_FAILED_BOTTOM))
            }
            None => caption,
        })
    })
    .map(|this| match image.upload.clone() {
        Some(ComposerImageUploadView::Uploading { label }) => this.child(
            div()
                .absolute()
                .left_0()
                .right_0()
                .bottom_0()
                .px(px(UPLOAD_PADDING_X))
                .bg(fade(t.background, UPLOAD_FILL))
                .text_center()
                .text_size(px(UPLOAD_TEXT))
                .line_height(px(UPLOAD_LINE))
                .text_color(t.foreground)
                .child(label),
        ),
        Some(ComposerImageUploadView::Failed {
            reason,
            retry_aria_label,
        }) => {
            let retry_client = client.clone();
            let retry_id = image.id.clone();
            this.child(
                div()
                    .id(SharedString::from(format!(
                        "composer-image-retry-{}",
                        image.id
                    )))
                    .absolute()
                    .left(px(RETRY_INSET))
                    .bottom(px(RETRY_INSET))
                    .tooltip(Tooltip::text(reason))
                    .child(
                        Button::new(SharedString::from(format!(
                            "composer-image-retry-button-{}",
                            image.id
                        )))
                        .variant(ButtonVariant::Overlay)
                        .size(ButtonSize::IconXs)
                        .icon("refresh-cw")
                        .accessibility_label(retry_aria_label)
                        .on_click(move |_, _, cx| {
                            cx.stop_propagation();
                            retry_client.update(cx, |client, _| {
                                client.act("composerRetryImageUpload", json!({ "id": retry_id }))
                            });
                        }),
                    ),
            )
        }
        None => this,
    })
    .child(
        div()
            .id(SharedString::from(format!(
                "composer-image-remove-{}",
                image.id
            )))
            .absolute()
            .top(px(REMOVE_INSET))
            .right(px(REMOVE_INSET))
            .flex()
            .items_center()
            .justify_center()
            .size(px(REMOVE_SIZE))
            .rounded(px(REMOVE_RADIUS))
            .bg(gpui::hsla(0., 0., 0., REMOVE_FILL))
            .opacity(0.)
            .group_hover(group, |style| style.opacity(1.))
            .cursor_pointer()
            .on_click(move |_, _, cx| {
                cx.stop_propagation();
                remove_client.update(cx, |client, _| {
                    client.act("composerRemoveImage", json!({ "id": remove_id }))
                });
            })
            .child(
                svg()
                    .path("icons/x.svg")
                    .size(px(REMOVE_ICON))
                    .text_color(gpui::white()),
            ),
    );
    if image.animate_arrival {
        let id = image.id.clone();
        let animation = || Animation::new(Duration::from_millis(ARRIVAL_MS)).with_easing(ease);
        paint_scale(card.with_animation(
            SharedString::from(format!("composer-snap-shot-arrival-{id}")),
            animation(),
            |card, delta| card.opacity(delta),
        ))
        .factor(ARRIVAL_SCALE)
        .with_animation(
            SharedString::from(format!("composer-snap-shot-arrival-scale-{id}")),
            animation(),
            |scaled, delta| scaled.factor(ARRIVAL_SCALE + (1. - ARRIVAL_SCALE) * delta),
        )
        .into_any_element()
    } else {
        card.into_any_element()
    }
}
