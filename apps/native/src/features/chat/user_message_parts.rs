use std::path::PathBuf;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Entity, InteractiveElement, IntoElement, ObjectFit, ParentElement,
    SharedString, StatefulInteractiveElement, Styled, StyledImage, Window, div, img,
    linear_color_stop, linear_gradient, px, relative, svg,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::markdown::MarkdownDocView;
use crate::app_core::views::timeline::{
    TimelineSnapShotAccessibilityView, TimelineSnapShotView, TimelineUserFileView,
    TimelineUserGridImageView, TimelineUserVideoView,
};
use crate::features::chat::chat_markdown::markdown_document;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::pierre_icon::pierre_icon;
use crate::ui::theme::color::{hsla, over};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;
use crate::ui::video_player::{VideoPlayer, VideoSurface};

const GRID_WIDTH: f32 = 210.;
const GRID_GAP: f32 = 8.;
const GRID_MARGIN: f32 = 8.;
const MEDIA_RADIUS: f32 = 10.;
const MEDIA_ASPECT: f32 = 3. / 4.;
const SNAP_SHOT_WIDTH: f32 = 208.;
const SNAP_SHOT_HEIGHT: f32 = 112.;
const SNAP_SHOT_ICON: f32 = 28.;
const SNAP_SHOT_ICON_RADIUS: f32 = 8.;
const SNAP_SHOT_OVERLAY_TOP: f32 = 24.;
const SNAP_SHOT_PADDING_X: f32 = 10.;
const SNAP_SHOT_PADDING_BOTTOM: f32 = 8.;
const SNAP_SHOT_GAP: f32 = 6.;
const TEXT_2XS: f32 = 11.;
const TEXT_3XS: f32 = 10.;
const LINE_3_5: f32 = 14.;
const PLACEHOLDER_MIN_HEIGHT: f32 = 72.;
const FILE_TEXT: f32 = 14.;
const FILE_LINE: f32 = 20.;
const FILE_ICON: f32 = 16.;
const FILE_ROW_PADDING_Y: f32 = 4.;
const FILE_GAP: f32 = 8.;
const FILE_LIST_GAP: f32 = 4.;
const COLLAPSED_MAX_HEIGHT: f32 = 176.;
const FADE_HEIGHT: f32 = 28.;
const FOOTER_MARGIN_TOP: f32 = 6.;

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: serde_json::Value) {
    client.update(cx, |client, _| client.act(action, params));
}

pub(crate) fn snap_shot_overlay(id: &str, snap: &TimelineSnapShotView) -> gpui::Div {
    let white = gpui::white();
    let icon: AnyElement = match snap.app_icon_path.clone() {
        Some(path) => img(PathBuf::from(path))
            .flex_none()
            .size(px(SNAP_SHOT_ICON))
            .rounded(px(SNAP_SHOT_ICON_RADIUS))
            .into_any_element(),
        None => div()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .size(px(SNAP_SHOT_ICON))
            .rounded(px(SNAP_SHOT_ICON_RADIUS))
            .bg(fade(white.into(), 0.2))
            .text_size(px(TEXT_3XS))
            .font_weight(gpui::FontWeight::MEDIUM)
            .text_color(white)
            .child(snap.app_initial.clone())
            .into_any_element(),
    };
    let tooltip = if snap.includes_accessibility {
        "Accessibility data"
    } else {
        "No accessibility data"
    };
    let detail = match &snap.accessibility {
        TimelineSnapShotAccessibilityView::Text { text } => text.clone(),
        TimelineSnapShotAccessibilityView::Json { lines } => lines
            .iter()
            .map(|line| line.iter().map(|token| token.text.as_str()).collect::<String>())
            .collect::<Vec<_>>()
            .join("\n"),
        TimelineSnapShotAccessibilityView::Unnamed => "Structured accessibility elements were included, but they have no readable names or values.".to_string(),
        TimelineSnapShotAccessibilityView::None => {
            "The app or capture backend did not provide verified accessibility data.".to_string()
        }
    };
    let black = |alpha: f32| hsla(fade(gpui::black().into(), alpha));
    let half = |from: f32, to: f32| {
        div()
            .absolute()
            .left_0()
            .right_0()
            .h(relative(0.5))
            .bg(linear_gradient(
                180.,
                linear_color_stop(black(from), 0.),
                linear_color_stop(black(to), 1.),
            ))
    };
    div()
        .absolute()
        .left_0()
        .right_0()
        .bottom_0()
        .flex()
        .min_w_0()
        .items_center()
        .gap(px(SNAP_SHOT_GAP))
        .px(px(SNAP_SHOT_PADDING_X))
        .pb(px(SNAP_SHOT_PADDING_BOTTOM))
        .pt(px(SNAP_SHOT_OVERLAY_TOP))
        .child(half(0., 0.55).top_0())
        .child(half(0.55, 0.85).bottom_0())
        .child(icon)
        .child(
            div()
                .min_w_0()
                .flex_1()
                .child(
                    div()
                        .flex()
                        .min_w_0()
                        .items_center()
                        .gap(px(SNAP_SHOT_GAP))
                        .text_size(px(TEXT_2XS))
                        .line_height(px(LINE_3_5))
                        .font_weight(gpui::FontWeight::MEDIUM)
                        .text_color(white)
                        .child(div().min_w_0().truncate().child(snap.app_name.clone()))
                        .child(
                            div()
                                .id(SharedString::from(format!("{id}.a11y")))
                                .flex_none()
                                .tooltip(Tooltip::text(format!("{tooltip}\n{detail}")))
                                .child(
                                    Button::new(SharedString::from(format!("{id}.a11y-button")))
                                        .variant(ButtonVariant::Overlay)
                                        .size(ButtonSize::IconMicro)
                                        .icon(if snap.includes_accessibility {
                                            "text-align-start"
                                        } else {
                                            "image"
                                        }),
                                ),
                        ),
                )
                .child(
                    div()
                        .truncate()
                        .text_size(px(TEXT_3XS))
                        .line_height(px(LINE_3_5))
                        .text_color(fade(white.into(), 0.7))
                        .child(snap.window_title.clone()),
                ),
        )
}

fn media_grid(
    bubble: &UserBubble<'_>,
    client: &Entity<CoreClient>,
    t: &Tokens,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let id = bubble.id;
    let message_id = bubble.message_id;
    let images = bubble.images;
    let videos = bubble.videos;
    let cell = (GRID_WIDTH - GRID_GAP) / 2.;
    let frame = |snap: bool| {
        div()
            .relative()
            .overflow_hidden()
            .rounded(px(MEDIA_RADIUS))
            .border_1()
            .border_color(fade(t.border, 0.8))
            .bg(fade(t.background, 0.7))
            .map(|this| {
                if snap {
                    this.w(px(SNAP_SHOT_WIDTH))
                        .max_w_full()
                        .h(px(SNAP_SHOT_HEIGHT))
                } else {
                    this.w(px(cell)).h(px(cell * MEDIA_ASPECT))
                }
            })
    };
    let image_cells = images.iter().map(|image| {
        let snap = image.snap_shot.as_ref().filter(|_| image.url.is_some());
        let click_client = client.clone();
        let params = json!({ "messageId": message_id, "attachmentId": image.id, "scope": "grid" });
        frame(snap.is_some())
            .id(SharedString::from(format!("{id}.img.{}", image.id)))
            .map(|this| match image.url.clone() {
                Some(url) => this
                    .cursor_pointer()
                    .on_click(move |_, _, cx| {
                        act(&click_client, cx, "expandTimelineImage", params.clone())
                    })
                    .child(
                        img(SharedString::from(url))
                            .size_full()
                            .object_fit(ObjectFit::Cover),
                    ),
                None => this.child(
                    div()
                        .flex()
                        .size_full()
                        .min_h(px(PLACEHOLDER_MIN_HEIGHT))
                        .items_center()
                        .justify_center()
                        .px(px(8.))
                        .py(px(12.))
                        .text_size(px(TEXT_2XS))
                        .text_color(t.secondary_label)
                        .child(image.name.clone()),
                ),
            })
            .when_some(snap, |this, snap| {
                this.child(snap_shot_overlay(&format!("{id}.snap.{}", image.id), snap))
            })
            .into_any_element()
    });
    let video_cells = videos.iter().map(|video| {
        let click_client = client.clone();
        let params = json!({ "messageId": message_id, "attachmentId": video.id });
        let body = match &video.video {
            Some(view) => {
                let player = VideoPlayer::keyed(
                    SharedString::from(format!("{id}.player.{}", video.id)),
                    client,
                    view,
                    VideoSurface::Thumbnail,
                    false,
                    window,
                    cx,
                );
                div().size_full().child(player).into_any_element()
            }
            None => div()
                .flex()
                .size_full()
                .items_center()
                .justify_center()
                .px(px(8.))
                .py(px(12.))
                .text_size(px(TEXT_2XS))
                .text_color(fade(gpui::white().into(), 0.7))
                .child(video.name.clone())
                .into_any_element(),
        };
        frame(false)
            .id(SharedString::from(format!("{id}.video.{}", video.id)))
            .bg(gpui::black())
            .cursor_pointer()
            .on_click(move |_, _, cx| act(&click_client, cx, "expandTimelineVideo", params.clone()))
            .child(body)
            .into_any_element()
    });
    div()
        .mb(px(GRID_MARGIN))
        .flex()
        .flex_wrap()
        .gap(px(GRID_GAP))
        .max_w(px(GRID_WIDTH))
        .children(image_cells)
        .children(video_cells)
        .into_any_element()
}

fn download_directory() -> PathBuf {
    std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join("Downloads"))
        .unwrap_or_else(std::env::temp_dir)
}

fn file_identity(file: &TimelineUserFileView, cx: &App) -> Vec<AnyElement> {
    vec![
        div()
            .flex_none()
            .child(pierre_icon(&file.icon, px(FILE_ICON), cx))
            .into_any_element(),
        div()
            .min_w_0()
            .flex_1()
            .truncate()
            .child(file.name.clone())
            .into_any_element(),
    ]
}

fn file_rows(
    id: &str,
    message_id: &str,
    files: &[TimelineUserFileView],
    unknown: &[TimelineUserFileView],
    client: &Entity<CoreClient>,
    t: &Tokens,
    cx: &App,
) -> AnyElement {
    let rows = files.iter().map(|file| {
        if !file.downloadable {
            return div()
                .flex()
                .min_w_0()
                .items_center()
                .gap(px(FILE_GAP))
                .py(px(FILE_ROW_PADDING_Y))
                .children(file_identity(file, cx))
                .into_any_element();
        }
        let open_client = client.clone();
        let download_client = client.clone();
        let open_params = json!({ "messageId": message_id, "attachmentId": file.id });
        let (download_message, download_id, name) =
            (message_id.to_string(), file.id.clone(), file.name.clone());
        div()
            .flex()
            .min_w_0()
            .items_center()
            .gap(px(FILE_LIST_GAP))
            .child(
                div()
                    .id(SharedString::from(format!("{id}.file.{}", file.id)))
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .items_center()
                    .gap(px(FILE_GAP))
                    .py(px(FILE_ROW_PADDING_Y))
                    .cursor_pointer()
                    .hover(|style| style.underline())
                    .on_click(move |_, _, cx| {
                        act(
                            &open_client,
                            cx,
                            "openTimelineAttachment",
                            open_params.clone(),
                        )
                    })
                    .children(file_identity(file, cx))
                    .child(
                        svg()
                            .path("icons/eye.svg")
                            .flex_none()
                            .size(px(FILE_ICON))
                            .text_color(t.message_foreground),
                    ),
            )
            .child(
                div()
                    .id(SharedString::from(format!("{id}.download.{}", file.id)))
                    .flex_none()
                    .tooltip(Tooltip::text(format!("Download {}", file.name)))
                    .child(
                        Button::new(SharedString::from(format!(
                            "{id}.download-button.{}",
                            file.id
                        )))
                        .variant(ButtonVariant::GhostMuted)
                        .size(ButtonSize::IconXs)
                        .icon("download")
                        .on_click(move |_, _, cx| {
                            let receiver =
                                cx.prompt_for_new_path(&download_directory(), Some(&name));
                            let client = download_client.clone();
                            let (message_id, attachment_id) =
                                (download_message.clone(), download_id.clone());
                            cx.spawn(async move |cx| {
                                if let Ok(Ok(Some(path))) = receiver.await {
                                    cx.update(|cx| {
                                        act(
                                            &client,
                                            cx,
                                            "downloadTimelineAttachment",
                                            json!({
                                                "messageId": message_id,
                                                "attachmentId": attachment_id,
                                                "path": path.to_string_lossy(),
                                            }),
                                        )
                                    });
                                }
                            })
                            .detach();
                        }),
                    ),
            )
            .into_any_element()
    });
    let unknown_rows = unknown.iter().map(|file| {
        div()
            .flex()
            .min_w_0()
            .items_center()
            .gap(px(FILE_GAP))
            .py(px(FILE_ROW_PADDING_Y))
            .children(file_identity(file, cx))
            .into_any_element()
    });
    div()
        .mb(px(GRID_MARGIN))
        .flex()
        .flex_col()
        .gap(px(FILE_LIST_GAP))
        .text_size(px(FILE_TEXT))
        .line_height(px(FILE_LINE))
        .children(rows)
        .children(unknown_rows)
        .into_any_element()
}

pub struct UserBubble<'a> {
    pub id: &'a str,
    pub message_id: &'a str,
    pub document: Option<&'a MarkdownDocView>,
    pub images: &'a [TimelineUserGridImageView],
    pub videos: &'a [TimelineUserVideoView],
    pub files: &'a [TimelineUserFileView],
    pub unknown_attachments: &'a [TimelineUserFileView],
    pub collapsible: bool,
    pub expanded: bool,
}

pub fn user_bubble_children(
    bubble: UserBubble<'_>,
    client: &Entity<CoreClient>,
    t: &Tokens,
    window: &mut Window,
    cx: &mut App,
) -> Vec<AnyElement> {
    let mut children = Vec::new();
    if !bubble.images.is_empty() || !bubble.videos.is_empty() {
        children.push(media_grid(&bubble, client, t, window, cx));
    }
    if !bubble.files.is_empty() || !bubble.unknown_attachments.is_empty() {
        children.push(file_rows(
            bubble.id,
            bubble.message_id,
            bubble.files,
            bubble.unknown_attachments,
            client,
            t,
            cx,
        ));
    }
    let collapsed = bubble.collapsible && !bubble.expanded;
    if let Some(document) = bubble.document {
        let body = markdown_document(
            bubble.id,
            document,
            t.message_foreground,
            client,
            t,
            window,
            cx,
        );
        let surface = over(t.message_surface, t.background);
        children.push(
            div()
                .relative()
                .when(collapsed, |this| {
                    this.max_h(px(COLLAPSED_MAX_HEIGHT)).overflow_hidden()
                })
                .child(body)
                .when(collapsed, |this| {
                    this.child(
                        div()
                            .absolute()
                            .left_0()
                            .right_0()
                            .bottom_0()
                            .h(px(FADE_HEIGHT))
                            .bg(linear_gradient(
                                180.,
                                linear_color_stop(hsla(fade(surface, 0.)), 0.),
                                linear_color_stop(hsla(surface), 1.),
                            )),
                    )
                })
                .into_any_element(),
        );
    }
    if bubble.collapsible {
        let toggle_client = client.clone();
        let message_id = bubble.message_id.to_string();
        children.push(
            div()
                .mt(px(FOOTER_MARGIN_TOP))
                .flex()
                .items_center()
                .justify_end()
                .child(
                    Button::new(SharedString::from(format!("{}.collapse", bubble.id)))
                        .variant(ButtonVariant::GhostMuted)
                        .size(ButtonSize::Xs)
                        .label(if bubble.expanded {
                            "Show less"
                        } else {
                            "Show full message"
                        })
                        .on_click(move |_, _, cx| {
                            act(
                                &toggle_client,
                                cx,
                                "toggleUserMessageExpanded",
                                json!({ "messageId": message_id }),
                            )
                        }),
                )
                .into_any_element(),
        );
    }
    children
}
