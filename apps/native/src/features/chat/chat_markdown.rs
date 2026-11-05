use std::ops::Range;
use std::rc::Rc;
use std::time::Duration;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Bounds, ClickEvent, ClipboardItem, ElementId, Entity, FontStyle, FontWeight,
    HighlightStyle, InteractiveElement, IntoElement, MouseButton, MouseDownEvent, ObjectFit,
    ParentElement, Pixels, Point, Rgba, SharedString, StatefulInteractiveElement,
    StrikethroughStyle, Styled, StyledImage, StyledText, Window, canvas, div, img, px, relative,
    rgba, svg,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::markdown::{
    LinkBrand, MarkdownBlockView, MarkdownCodeView, MarkdownDocView, MarkdownGalleryView,
    MarkdownImageSource, MarkdownInlineView, MarkdownListItemView, MarkdownMediaKind,
    MarkdownTableView, TableAlign,
};
use crate::app_core::views::pierre_icon::PierreIconView;
use crate::features::chat::markdown_chips::ContextChip;
use crate::features::chat::markdown_selection::{
    LinkHandler, SelectableBlock, SelectableRun, SelectionGroup,
};
use crate::platform::MONO_FONT;
use crate::ui::menu::{MenuItem, MenuPopup};
use crate::ui::pierre_icon::pierre_icon;
use crate::ui::popover::Align;
use crate::ui::theme::tokens::{Appearance, Tokens, fade};
use crate::ui::tooltip::{Tooltip, TooltipVariant};
use crate::ui::video_player::{VideoPlayer, VideoSurface};

const BODY_TEXT: f32 = 14.;
const BODY_LINE: f32 = 22.75;
const BLOCK_MARGIN: f32 = 10.4;
const HEADING_MARGIN_TOP: f32 = 20.;
const HEADING_MARGIN_BOTTOM: f32 = 8.;
const HEADING_LINE: f32 = 1.3;
const LIST_GUTTER: f32 = 20.;
const LIST_ITEM_GAP: f32 = 4.;
const BLOCKQUOTE_BORDER: f32 = 2.;
const BLOCKQUOTE_PADDING: f32 = 12.8;
const ALERT_PADDING: f32 = 12.;
const ALERT_MARGIN: f32 = 4.;
const ALERT_ICON: f32 = 14.;
const ALERT_GAP: f32 = 6.;
const INLINE_CODE_TEXT: f32 = 12.;
const INLINE_CODE_LINE: f32 = 19.5;
const INLINE_CODE_PADDING_X: f32 = 5.6;
const INLINE_CODE_PADDING_Y: f32 = 1.6;
const INLINE_CODE_RADIUS: f32 = 6.;
const CHIP_TEXT: f32 = 12.04;
const CHIP_HEIGHT: f32 = 16.98;
const CHIP_PADDING_X: f32 = 6.02;
const CHIP_GAP: f32 = 3.97;
const CHIP_RADIUS: f32 = 6.02;
const CHIP_ICON: f32 = 14.1;
const CHIP_LABEL_LINE: f32 = 15.05;
const FAVICON_SIZE: f32 = 14.;
const FAVICON_MARGIN_LEFT: f32 = 3.5;
const FAVICON_MARGIN_RIGHT: f32 = 2.8;
const FAVICON_RADIUS: f32 = 4.;
const CODE_BLOCK_RADIUS: f32 = 10.;
const CODE_HEADER_PADDING_TOP: f32 = 6.;
const CODE_HEADER_PADDING_RIGHT: f32 = 6.;
const CODE_HEADER_PADDING_LEFT: f32 = 12.;
const CODE_HEADER_GAP: f32 = 8.;
const MEDIA_MAX_SIZE: f32 = 480.;
const MEDIA_RADIUS: f32 = 10.;
const MEDIA_FALLBACK_GAP: f32 = 6.;
const MEDIA_FALLBACK_RADIUS: f32 = 8.;
const MEDIA_FALLBACK_PADDING_X: f32 = 8.;
const MEDIA_FALLBACK_PADDING_Y: f32 = 4.;
const MEDIA_FALLBACK_TEXT: f32 = 12.;
const MEDIA_FALLBACK_LINE: f32 = 16.;
const MEDIA_FALLBACK_ICON: f32 = 14.;
const CODE_TITLE_TEXT: f32 = 11.;
const CODE_TITLE_LINE: f32 = 16.;
const CODE_TITLE_GAP: f32 = 6.;
const CODE_TITLE_ICON: f32 = 14.;
const CODE_ACTIONS_GAP: f32 = 2.;
const CODE_LINE_RATIO: f32 = 1.375;
const CODE_PADDING_Y: f32 = 12.8;
const CODE_PADDING_X: f32 = 14.4;
const ACTION_SIZE: f32 = 24.;
const ACTION_RADIUS: f32 = 8.;
const ACTION_ICON: f32 = 12.;
const TABLE_TEXT: f32 = 12.;
const TABLE_LINE: f32 = 19.5;
const TABLE_HEAD_PADDING_Y: f32 = 8.8;
const TABLE_CELL_PADDING_Y: f32 = 7.2;
const TABLE_CELL_PADDING_X: f32 = 12.;
const TABLE_FOOTER_MARGIN: f32 = 2.;
const TABLE_CELL_MAX_WIDTH: f32 = 384.;
const TABLE_MENU_MIN_WIDTH: f32 = 128.;
const COPIED_FEEDBACK: Duration = Duration::from_millis(1200);
const MENTION_ACCENT: [f32; 3] = [0.62, -0.090_106_7, -0.063_093_4];

struct Ctx<'a> {
    client: &'a Entity<CoreClient>,
    t: &'a Tokens,
    base: Rgba,
    word_wrap: bool,
    doc: &'a MarkdownDocView,
}

#[derive(Clone, Copy)]
struct TextMetrics {
    size: f32,
    line: f32,
    weight: FontWeight,
    color: Rgba,
}

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: serde_json::Value) {
    client.update(cx, |client, _| client.act(action, params));
}

pub fn markdown_document(
    id: &str,
    doc: &MarkdownDocView,
    base_color: Rgba,
    client: &Entity<CoreClient>,
    t: &Tokens,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let ctx = Ctx {
        client,
        t,
        base: base_color,
        word_wrap: doc.word_wrap,
        doc,
    };
    div()
        .w_full()
        .min_w_0()
        .text_size(px(BODY_TEXT))
        .line_height(px(BODY_LINE))
        .text_color(base_color)
        .child(blocks(id, &doc.blocks, &ctx, false, window, cx))
        .into_any_element()
}

fn margins(block: &MarkdownBlockView, tight: bool) -> (f32, f32) {
    match block {
        MarkdownBlockView::Paragraph { .. } if tight => (0., 0.),
        MarkdownBlockView::Heading { .. } => (HEADING_MARGIN_TOP, HEADING_MARGIN_BOTTOM),
        MarkdownBlockView::Rule => (0., 0.),
        _ => (BLOCK_MARGIN, BLOCK_MARGIN),
    }
}

fn blocks(
    id: &str,
    items: &[MarkdownBlockView],
    ctx: &Ctx,
    tight: bool,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let mut column = div().flex().flex_col().w_full().min_w_0();
    let mut previous_bottom: Option<f32> = None;
    for (index, item) in items.iter().enumerate() {
        let (top, bottom) = margins(item, tight);
        let gap = previous_bottom.map_or(0., |previous| previous.max(top));
        let element = block(&format!("{id}.{index}"), item, ctx, window, cx);
        column = column.child(div().w_full().min_w_0().pt(px(gap)).child(element));
        previous_bottom = Some(bottom);
    }
    column.into_any_element()
}

fn block(
    id: &str,
    item: &MarkdownBlockView,
    ctx: &Ctx,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let t = ctx.t;
    match item {
        MarkdownBlockView::Paragraph { inlines } => inline_flow(
            id,
            inlines,
            TextMetrics {
                size: BODY_TEXT,
                line: BODY_LINE,
                weight: FontWeight::NORMAL,
                color: ctx.base,
            },
            ctx,
            window,
            cx,
        ),
        MarkdownBlockView::Heading { depth, inlines } => {
            let size = match depth {
                1 => 20.,
                2 => 18.,
                3 => 16.,
                _ => 14.,
            };
            inline_flow(
                id,
                inlines,
                TextMetrics {
                    size,
                    line: size * HEADING_LINE,
                    weight: FontWeight::SEMIBOLD,
                    color: if *depth == 6 {
                        t.muted_foreground
                    } else {
                        t.foreground
                    },
                },
                ctx,
                window,
                cx,
            )
        }
        MarkdownBlockView::List {
            ordered,
            start,
            spread,
            depth,
            items,
        } => list(
            id,
            ListShape {
                ordered: *ordered,
                start: *start,
                spread: *spread,
                depth: *depth,
            },
            items,
            ctx,
            window,
            cx,
        ),
        MarkdownBlockView::Blockquote {
            alert,
            blocks: body,
        } => {
            let content = blocks(id, body, ctx, false, window, cx);
            match alert.as_deref().and_then(alert_presentation) {
                None => div()
                    .border_l(px(BLOCKQUOTE_BORDER))
                    .border_color(t.border)
                    .pl(px(BLOCKQUOTE_PADDING))
                    .text_color(t.muted_foreground)
                    .child(content)
                    .into_any_element(),
                Some((label, icon, border, title)) => div()
                    .my(px(ALERT_MARGIN))
                    .border_l(px(BLOCKQUOTE_BORDER))
                    .border_color(rgba(border))
                    .pl(px(ALERT_PADDING))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(ALERT_GAP))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(rgba(title))
                            .child(
                                svg()
                                    .path(icon)
                                    .flex_none()
                                    .size(px(ALERT_ICON))
                                    .text_color(rgba(title)),
                            )
                            .child(label),
                    )
                    .child(content)
                    .into_any_element(),
            }
        }
        MarkdownBlockView::Code(code) => code_block(id, code, ctx, window, cx),
        MarkdownBlockView::Table(table_view) => table(id, table_view, ctx, window, cx),
        MarkdownBlockView::Rule => div().w_full().h(px(1.)).bg(t.border).into_any_element(),
    }
}

fn alert_presentation(alert: &str) -> Option<(&'static str, &'static str, u32, u32)> {
    match alert {
        "note" => Some(("Note", "icons/info.svg", 0x2b7fffb3, 0x51a2ffff)),
        "tip" => Some(("Tip", "icons/lightbulb.svg", 0x00bc7db3, 0x00d492ff)),
        "important" => Some((
            "Important",
            "icons/message-square-warning.svg",
            0xad46ffb3,
            0xc27affff,
        )),
        "warning" => Some((
            "Warning",
            "icons/triangle-alert.svg",
            0xfe9a00b3,
            0xfe9a00ff,
        )),
        "caution" => Some(("Caution", "icons/octagon-alert.svg", 0xfb2c36b3, 0xff6467ff)),
        _ => None,
    }
}

#[derive(Clone, Copy)]
struct ListShape {
    ordered: bool,
    start: u32,
    spread: bool,
    depth: u32,
}

fn list(
    id: &str,
    shape: ListShape,
    items: &[MarkdownListItemView],
    ctx: &Ctx,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let last_number = shape.start as usize + items.len().saturating_sub(1);
    let digits = last_number.to_string().len();
    let gutter = if shape.ordered && digits > 1 {
        LIST_GUTTER + (digits - 1) as f32 * 8.
    } else {
        LIST_GUTTER
    };
    let t = ctx.t;
    let mut column = div().flex().flex_col().w_full().min_w_0();
    for (index, item) in items.iter().enumerate() {
        let item_id = format!("{id}.{index}");
        let marker: AnyElement = match item.checked {
            Some(checked) => svg()
                .path(if checked {
                    "icons/square-check.svg"
                } else {
                    "icons/square.svg"
                })
                .size(px(13.))
                .text_color(t.muted_foreground)
                .into_any_element(),
            None if shape.ordered => div()
                .child(format!("{}.", shape.start as usize + index))
                .into_any_element(),
            None => div()
                .child(match shape.depth {
                    0 => "•",
                    1 => "◦",
                    _ => "▪",
                })
                .into_any_element(),
        };
        let body = blocks(&item_id, &item.blocks, ctx, !shape.spread, window, cx);
        column = column.child(
            div()
                .flex()
                .w_full()
                .min_w_0()
                .when(index > 0, |this| this.mt(px(LIST_ITEM_GAP)))
                .child(
                    div()
                        .flex()
                        .flex_none()
                        .justify_end()
                        .w(px(gutter))
                        .pr(px(if shape.ordered { 4. } else { 7. }))
                        .child(marker),
                )
                .child(div().flex_1().min_w_0().child(body)),
        );
    }
    column.into_any_element()
}

fn has_atoms(inlines: &[MarkdownInlineView]) -> bool {
    inlines.iter().any(|inline| {
        matches!(
            inline,
            MarkdownInlineView::FileChip { .. }
                | MarkdownInlineView::ContextChip { .. }
                | MarkdownInlineView::Favicon { .. }
                | MarkdownInlineView::Image { .. }
                | MarkdownInlineView::Text { code: true, .. }
        )
    })
}

fn run_style(
    bold: bool,
    italic: bool,
    strike: bool,
    href: bool,
    metrics: TextMetrics,
    t: &Tokens,
) -> HighlightStyle {
    HighlightStyle {
        color: Some(
            if href {
                t.info_foreground
            } else {
                metrics.color
            }
            .into(),
        ),
        font_weight: Some(if bold {
            FontWeight::BOLD
        } else {
            metrics.weight
        }),
        font_style: italic.then_some(FontStyle::Italic),
        strikethrough: strike.then(|| StrikethroughStyle {
            thickness: px(1.),
            color: None,
        }),
        ..HighlightStyle::default()
    }
}

fn link_handler(client: &Entity<CoreClient>) -> LinkHandler {
    let client = client.clone();
    Rc::new(move |href: &str, cx: &mut App| {
        act(&client, cx, "openMarkdownLink", json!({ "href": href }));
    })
}

fn inline_flow(
    id: &str,
    inlines: &[MarkdownInlineView],
    metrics: TextMetrics,
    ctx: &Ctx,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let group = SelectionGroup::default();
    let container = div()
        .w_full()
        .min_w_0()
        .text_size(px(metrics.size))
        .line_height(px(metrics.line))
        .font_weight(metrics.weight)
        .text_color(metrics.color);
    let block_id = ElementId::Name(SharedString::from(format!("{id}.sel")));
    if has_atoms(inlines) {
        let flow = word_flow(id, inlines, metrics, &group, ctx, window, cx);
        return SelectableBlock::new(block_id, group, plain_text(inlines), container.child(flow))
            .into_any_element();
    }
    let mut text = String::new();
    let mut highlights: Vec<(Range<usize>, HighlightStyle)> = Vec::new();
    let mut links: Vec<(Range<usize>, String)> = Vec::new();
    for inline in inlines {
        match inline {
            MarkdownInlineView::Text {
                text: run,
                bold,
                italic,
                strike,
                href,
                ..
            } => {
                let start = text.len();
                text.push_str(&run.replace('\n', " "));
                let range = start..text.len();
                highlights.push((
                    range.clone(),
                    run_style(*bold, *italic, *strike, href.is_some(), metrics, ctx.t),
                ));
                if let Some(href) = href {
                    links.push((range, href.clone()));
                }
            }
            MarkdownInlineView::Break => text.push('\n'),
            MarkdownInlineView::ContextReference { label, .. } => {
                let start = text.len();
                text.push_str(label);
                highlights.push((
                    start..text.len(),
                    run_style(false, false, false, false, metrics, ctx.t),
                ));
            }
            MarkdownInlineView::FileChip { .. }
            | MarkdownInlineView::ContextChip { .. }
            | MarkdownInlineView::Favicon { .. }
            | MarkdownInlineView::Image { .. } => {}
        }
    }
    let text = SharedString::from(text);
    let styled = StyledText::new(text.clone()).with_highlights(highlights);
    let run =
        SelectableRun::new(&group, text.clone(), styled).links(links, link_handler(ctx.client));
    SelectableBlock::new(block_id, group, text, container.child(run)).into_any_element()
}

fn link_word(
    id: SharedString,
    href: &str,
    content: AnyElement,
    group: SharedString,
    ctx: &Ctx,
) -> AnyElement {
    let t = ctx.t;
    let click_client = ctx.client.clone();
    let menu_client = ctx.client.clone();
    let click_href = href.to_string();
    let menu_href = href.to_string();
    let underline = t.info_foreground;
    div()
        .id(id)
        .relative()
        .flex()
        .flex_none()
        .items_center()
        .whitespace_nowrap()
        .cursor_pointer()
        .group(group.clone())
        .on_click(move |_, _, cx| {
            act(
                &click_client,
                cx,
                "openMarkdownLink",
                json!({ "href": click_href }),
            );
        })
        .on_mouse_down(MouseButton::Right, move |event: &MouseDownEvent, _, cx| {
            cx.stop_propagation();
            act(
                &menu_client,
                cx,
                "markdownLinkContextMenu",
                json!({
                    "href": menu_href,
                    "x": f32::from(event.position.x),
                    "y": f32::from(event.position.y),
                }),
            );
        })
        .tooltip(Tooltip::text(href.to_string()))
        .child(content)
        .child(
            div()
                .absolute()
                .left_0()
                .right_0()
                .bottom(px(2.))
                .h_0()
                .border_b_1()
                .border_dashed()
                .border_color(gpui::transparent_black())
                .group_hover(group, move |style| style.border_color(underline)),
        )
        .into_any_element()
}

fn favicon(brand: Option<LinkBrand>, url: Option<&str>, t: &Tokens) -> AnyElement {
    let globe = move || {
        svg()
            .path("icons/globe.svg")
            .size(px(FAVICON_SIZE))
            .text_color(t.info_foreground)
            .into_any_element()
    };
    let globe_color = t.info_foreground;
    let icon: AnyElement = match (brand, url) {
        (Some(LinkBrand::Github), _) => svg()
            .path("icons/source-control/github.svg")
            .size(px(FAVICON_SIZE))
            .text_color(t.info_foreground)
            .into_any_element(),
        (None, Some(url)) => img(SharedString::from(url.to_string()))
            .size(px(FAVICON_SIZE))
            .rounded(px(FAVICON_RADIUS))
            .object_fit(ObjectFit::Contain)
            .with_fallback(move || {
                svg()
                    .path("icons/globe.svg")
                    .size(px(FAVICON_SIZE))
                    .text_color(globe_color)
                    .into_any_element()
            })
            .into_any_element(),
        (None, None) => globe(),
    };
    div()
        .flex()
        .flex_none()
        .items_center()
        .ml(px(FAVICON_MARGIN_LEFT))
        .mr(px(FAVICON_MARGIN_RIGHT))
        .size(px(FAVICON_SIZE))
        .child(icon)
        .into_any_element()
}

fn media_unavailable(alt: &str, media: MarkdownMediaKind, t: &Tokens) -> AnyElement {
    let label = match media {
        MarkdownMediaKind::Video => "Video unavailable",
        MarkdownMediaKind::Image => "Image unavailable",
    };
    div()
        .flex()
        .flex_none()
        .items_center()
        .gap(px(MEDIA_FALLBACK_GAP))
        .rounded(px(MEDIA_FALLBACK_RADIUS))
        .border_1()
        .border_color(fade(t.border, 0.4))
        .bg(fade(t.muted, 0.4))
        .px(px(MEDIA_FALLBACK_PADDING_X))
        .py(px(MEDIA_FALLBACK_PADDING_Y))
        .text_size(px(MEDIA_FALLBACK_TEXT))
        .line_height(px(MEDIA_FALLBACK_LINE))
        .text_color(t.muted_foreground)
        .child(
            svg()
                .path("icons/triangle-alert.svg")
                .flex_none()
                .size(px(MEDIA_FALLBACK_ICON))
                .text_color(t.muted_foreground),
        )
        .child(if alt.is_empty() {
            label.to_string()
        } else {
            format!("{label} · {alt}")
        })
        .into_any_element()
}

fn markdown_image(
    alt: &str,
    media: MarkdownMediaKind,
    source: MarkdownImageSource,
    url: Option<&str>,
    t: &Tokens,
) -> AnyElement {
    let url = match (media, source, url) {
        (MarkdownMediaKind::Image, MarkdownImageSource::Direct, Some(url))
        | (MarkdownMediaKind::Image, MarkdownImageSource::Workspace, Some(url)) => url,
        (MarkdownMediaKind::Image, MarkdownImageSource::Workspace, None) => {
            return div()
                .w_full()
                .max_w(px(MEDIA_MAX_SIZE))
                .h(px(MEDIA_MAX_SIZE * 9. / 16.))
                .rounded(px(MEDIA_RADIUS))
                .border_1()
                .border_color(fade(t.border, 0.4))
                .bg(fade(t.muted, 0.6))
                .into_any_element();
        }
        _ => return media_unavailable(alt, media, t),
    };
    let fallback_alt = alt.to_string();
    let fallback_tokens = t.clone();
    img(SharedString::from(url.to_string()))
        .flex_none()
        .max_w(px(MEDIA_MAX_SIZE))
        .max_h(px(MEDIA_MAX_SIZE))
        .rounded(px(MEDIA_RADIUS))
        .border_1()
        .border_color(fade(t.border, 0.4))
        .object_fit(ObjectFit::Contain)
        .with_fallback(move || {
            media_unavailable(&fallback_alt, MarkdownMediaKind::Image, &fallback_tokens)
        })
        .into_any_element()
}

/// One openable markdown gallery entry: the shown source plus its web original, if linked.
struct GalleryMedia {
    name: String,
    src: String,
    original_url: Option<String>,
}

fn gallery_entry(inline: &MarkdownInlineView) -> Option<GalleryMedia> {
    let MarkdownInlineView::Image {
        alt,
        media: MarkdownMediaKind::Image,
        url,
        href,
        gallery,
        ..
    } = inline
    else {
        return None;
    };
    let gallery = gallery.as_ref()?;
    let src = gallery.linked_url.clone().or_else(|| url.clone())?;
    Some(GalleryMedia {
        name: {
            let trimmed = alt.trim();
            if trimmed.is_empty() {
                "image".to_string()
            } else {
                trimmed.to_string()
            }
        },
        src,
        original_url: gallery
            .linked_url
            .as_ref()
            .is_some()
            .then(|| href.clone())
            .flatten(),
    })
}

fn collect_images<'a>(blocks: &'a [MarkdownBlockView], out: &mut Vec<&'a MarkdownInlineView>) {
    for block in blocks {
        match block {
            MarkdownBlockView::Paragraph { inlines }
            | MarkdownBlockView::Heading { inlines, .. } => {
                out.extend(inlines.iter());
            }
            MarkdownBlockView::List { items, .. } => {
                for item in items {
                    collect_images(&item.blocks, out);
                }
            }
            MarkdownBlockView::Blockquote { blocks, .. } => collect_images(blocks, out),
            MarkdownBlockView::Table(view) => {
                for cell in &view.header {
                    out.extend(cell.iter());
                }
                for row in &view.rows {
                    for cell in row {
                        out.extend(cell.iter());
                    }
                }
            }
            _ => {}
        }
    }
}

/// The document-order gallery a markdown image belongs to, with the clicked image's index.
fn markdown_gallery(
    doc: &MarkdownDocView,
    clicked: &MarkdownInlineView,
) -> Option<(Vec<GalleryMedia>, usize)> {
    let mut inlines = Vec::new();
    collect_images(&doc.blocks, &mut inlines);
    let mut items = Vec::new();
    let mut index = None;
    for inline in inlines {
        if !matches!(inline, MarkdownInlineView::Image { .. }) {
            continue;
        }
        if std::ptr::eq(inline, clicked) {
            let entry = gallery_entry(inline)?;
            items.push(entry);
            index = Some(items.len() - 1);
        } else if let Some(entry) = gallery_entry(inline) {
            items.push(entry);
        }
    }
    let index = index?;
    Some((items, index))
}

#[allow(clippy::too_many_arguments)]
fn markdown_media(
    element_id: SharedString,
    alt: &str,
    media: MarkdownMediaKind,
    source: MarkdownImageSource,
    url: Option<&str>,
    href: Option<&str>,
    gallery: Option<&MarkdownGalleryView>,
    inline: &MarkdownInlineView,
    ctx: &Ctx,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    if media == MarkdownMediaKind::Video {
        return match (source, url) {
            (MarkdownImageSource::Direct, Some(url))
            | (MarkdownImageSource::Workspace, Some(url)) => {
                let video = crate::app_core::views::media::MediaVideoView {
                    src: Some(url.to_string()),
                    source_failed: false,
                    label: alt.to_string(),
                    unavailable_label: "Video unavailable".to_string(),
                    can_retry: false,
                    retry: None,
                    open_link: None,
                };
                div()
                    .w_full()
                    .max_w(px(MEDIA_MAX_SIZE))
                    .child(VideoPlayer::keyed(
                        element_id,
                        ctx.client,
                        &video,
                        VideoSurface::Inline {
                            max_width: Some(MEDIA_MAX_SIZE),
                            border_alpha: 0.4,
                        },
                        false,
                        window,
                        cx,
                    ))
                    .into_any_element()
            }
            (MarkdownImageSource::Workspace, None) => div()
                .w_full()
                .max_w(px(MEDIA_MAX_SIZE))
                .h(px(MEDIA_MAX_SIZE * 9. / 16.))
                .rounded(px(MEDIA_RADIUS))
                .border_1()
                .border_color(fade(ctx.t.border, 0.4))
                .bg(fade(ctx.t.muted, 0.6))
                .into_any_element(),
            _ => media_unavailable(alt, media, ctx.t),
        };
    }
    let has_link = gallery.is_some_and(|gallery| gallery.linked_url.is_some() || url.is_some())
        || gallery.is_none() && href.is_some();
    let image = markdown_image(alt, media, source, url, ctx.t);
    if !has_link {
        return image;
    }
    let gallery_open = if media == MarkdownMediaKind::Image {
        markdown_gallery(ctx.doc, inline)
    } else {
        None
    };
    let link_href = href.map(str::to_string);
    if gallery_open.is_none() && link_href.is_none() {
        return image;
    }
    let client = ctx.client.clone();
    div()
        .id(element_id)
        .cursor_pointer()
        .on_click(move |_, _, cx| {
            if let Some((items, index)) = &gallery_open {
                let params = json!({
                    "items": items
                        .iter()
                        .map(|item| json!({
                            "kind": "image",
                            "name": item.name,
                            "src": item.src,
                            "originalUrl": item.original_url,
                        }))
                        .collect::<Vec<_>>(),
                    "index": index,
                });
                act(&client, cx, "mediaViewerOpen", params);
                return;
            }
            if let Some(href) = &link_href {
                act(&client, cx, "openMarkdownLink", json!({ "href": href }));
            }
        })
        .child(image)
        .into_any_element()
}

fn word_flow(
    id: &str,
    inlines: &[MarkdownInlineView],
    metrics: TextMetrics,
    group: &SelectionGroup,
    ctx: &Ctx,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let t = ctx.t;
    let mut flow = div().flex().flex_wrap().items_center().w_full().min_w_0();
    let mut index = 0usize;
    let mut pending_favicon: Option<AnyElement> = None;
    let mut link_group: Option<(String, SharedString)> = None;
    for inline in inlines {
        index += 1;
        match inline {
            MarkdownInlineView::Text {
                text,
                bold,
                italic,
                strike,
                code: true,
                href,
            } => {
                let code = inline_code(group, text, *bold, *italic, *strike, t);
                flow = flow.child(match href {
                    Some(href) => {
                        let link = link_group_for(&mut link_group, id, index, href);
                        link_word(
                            SharedString::from(format!("{id}.l{index}")),
                            href,
                            code,
                            link,
                            ctx,
                        )
                    }
                    None => code,
                });
            }
            MarkdownInlineView::Text {
                text,
                bold,
                italic,
                strike,
                href,
                ..
            } => {
                let normalized = text.replace('\n', " ");
                let style = run_style(*bold, *italic, *strike, href.is_some(), metrics, t);
                for (word_index, word) in normalized.split_inclusive(' ').enumerate() {
                    let word = SharedString::from(word.to_string());
                    let styled =
                        StyledText::new(word.clone()).with_highlights([(0..word.len(), style)]);
                    let run = SelectableRun::new(group, word, styled).into_any_element();
                    let content = match pending_favicon.take() {
                        Some(icon) => div()
                            .flex()
                            .items_center()
                            .child(icon)
                            .child(run)
                            .into_any_element(),
                        None => run,
                    };
                    flow = flow.child(match href {
                        Some(href) => {
                            let link = link_group_for(&mut link_group, id, index, href);
                            link_word(
                                SharedString::from(format!("{id}.l{index}.{word_index}")),
                                href,
                                content,
                                link,
                                ctx,
                            )
                        }
                        None => div().whitespace_nowrap().child(content).into_any_element(),
                    });
                }
            }
            MarkdownInlineView::Break => flow = flow.child(div().w_full().h(px(0.))),
            MarkdownInlineView::Favicon { brand, url, .. } => {
                pending_favicon = Some(favicon(*brand, url.as_deref(), t));
            }
            MarkdownInlineView::Image {
                alt,
                media,
                source,
                url,
                href,
                gallery,
                ..
            } => {
                flow = flow.child(markdown_media(
                    SharedString::from(format!("{id}.i{index}")),
                    alt,
                    *media,
                    *source,
                    url.as_deref(),
                    href.as_deref(),
                    gallery.as_ref(),
                    inline,
                    ctx,
                    window,
                    cx,
                ));
            }
            MarkdownInlineView::FileChip {
                label,
                icon,
                target_path,
                display_path,
                panel_path,
                line,
                ..
            } => {
                flow = flow.child(file_chip(
                    format!("{id}.c{index}"),
                    label,
                    icon,
                    FileTarget {
                        target_path: target_path.clone(),
                        display_path: display_path.clone(),
                        panel_path: panel_path.clone(),
                        line: *line,
                    },
                    ctx,
                ));
            }
            MarkdownInlineView::ContextReference { label, .. } => {
                let style = run_style(false, false, false, false, metrics, t);
                for word in label.split_inclusive(' ') {
                    let word = SharedString::from(word.to_string());
                    let styled =
                        StyledText::new(word.clone()).with_highlights([(0..word.len(), style)]);
                    flow = flow.child(
                        div()
                            .whitespace_nowrap()
                            .child(SelectableRun::new(group, word, styled)),
                    );
                }
            }
            MarkdownInlineView::ContextChip { chip } => {
                flow = flow.child(ContextChip::new(format!("{id}.x{index}"), chip, ctx.client));
            }
        }
    }
    if let Some(icon) = pending_favicon {
        flow = flow.child(icon);
    }
    flow.into_any_element()
}

fn link_group_for(
    current: &mut Option<(String, SharedString)>,
    id: &str,
    index: usize,
    href: &str,
) -> SharedString {
    match current {
        Some((current_href, group)) if current_href == href => group.clone(),
        _ => {
            let group = SharedString::from(format!("{id}.link{index}"));
            *current = Some((href.to_string(), group.clone()));
            group
        }
    }
}

fn inline_code(
    group: &SelectionGroup,
    text: &str,
    bold: bool,
    italic: bool,
    strike: bool,
    t: &Tokens,
) -> AnyElement {
    let (background, border, color) = match t.appearance {
        Appearance::Dark => (fade(t.foreground, 0.03), rgba(0xffffff0f), t.foreground),
        Appearance::Light => (t.message_surface, rgba(0x00000000), t.foreground),
    };
    let text = SharedString::from(text.to_string());
    let style = HighlightStyle {
        font_weight: bold.then_some(FontWeight::BOLD),
        font_style: italic.then_some(FontStyle::Italic),
        strikethrough: strike.then(|| StrikethroughStyle {
            thickness: px(1.),
            color: None,
        }),
        ..HighlightStyle::default()
    };
    let styled = StyledText::new(text.clone()).with_highlights([(0..text.len(), style)]);
    div()
        .flex_none()
        .px(px(INLINE_CODE_PADDING_X))
        .py(px(INLINE_CODE_PADDING_Y))
        .rounded(px(INLINE_CODE_RADIUS))
        .border_1()
        .border_color(border)
        .bg(background)
        .font_family(MONO_FONT)
        .text_size(px(INLINE_CODE_TEXT))
        .line_height(px(INLINE_CODE_LINE))
        .text_color(color)
        .whitespace_nowrap()
        .child(SelectableRun::new(group, text, styled))
        .into_any_element()
}

fn srgb_to_linear(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_to_srgb(c: f32) -> f32 {
    let c = c.clamp(0., 1.);
    if c <= 0.003_130_8 {
        c * 12.92
    } else {
        1.055 * c.powf(1. / 2.4) - 0.055
    }
}

fn to_oklab(color: Rgba) -> [f32; 3] {
    let r = srgb_to_linear(color.r);
    let g = srgb_to_linear(color.g);
    let b = srgb_to_linear(color.b);
    let l = (0.412_221_46 * r + 0.536_332_55 * g + 0.051_445_995 * b).cbrt();
    let m = (0.211_903_5 * r + 0.680_699_5 * g + 0.107_396_96 * b).cbrt();
    let s = (0.088_302_46 * r + 0.281_718_85 * g + 0.629_978_7 * b).cbrt();
    [
        0.210_454_26 * l + 0.793_617_8 * m - 0.004_072_047 * s,
        1.977_998_5 * l - 2.428_592_2 * m + 0.450_593_7 * s,
        0.025_904_037 * l + 0.782_771_77 * m - 0.808_675_77 * s,
    ]
}

fn from_oklab([l, a, b]: [f32; 3], alpha: f32) -> Rgba {
    let l_ = (l + 0.396_337_78 * a + 0.215_803_76 * b).powi(3);
    let m_ = (l - 0.105_561_346 * a - 0.063_854_17 * b).powi(3);
    let s_ = (l - 0.089_484_18 * a - 1.291_485_5 * b).powi(3);
    Rgba {
        r: linear_to_srgb(4.076_741_7 * l_ - 3.307_711_6 * m_ + 0.230_969_94 * s_),
        g: linear_to_srgb(-1.268_438 * l_ + 2.609_757_4 * m_ - 0.341_319_38 * s_),
        b: linear_to_srgb(-0.004_196_086_3 * l_ - 0.703_418_6 * m_ + 1.707_614_7 * s_),
        a: alpha,
    }
}

fn mix_accent(weight: f32, other: Rgba) -> Rgba {
    let other_lab = to_oklab(other);
    let alpha = weight + (1. - weight) * other.a;
    if alpha <= 0. {
        return from_oklab(MENTION_ACCENT, 0.);
    }
    let mut lab = [0.; 3];
    for (index, channel) in lab.iter_mut().enumerate() {
        *channel =
            (MENTION_ACCENT[index] * weight + other_lab[index] * other.a * (1. - weight)) / alpha;
    }
    from_oklab(lab, alpha)
}

#[derive(Clone)]
struct FileTarget {
    target_path: String,
    display_path: String,
    panel_path: Option<String>,
    line: Option<u32>,
}

impl FileTarget {
    fn params(&self, position: Point<Pixels>, meta: bool, ctrl: bool) -> serde_json::Value {
        json!({
            "targetPath": self.target_path,
            "displayPath": self.display_path,
            "panelPath": self.panel_path,
            "line": self.line,
            "metaKey": meta,
            "ctrlKey": ctrl,
            "x": f32::from(position.x),
            "y": f32::from(position.y),
        })
    }
}

fn file_chip(
    id: String,
    label: &str,
    icon: &PierreIconView,
    target: FileTarget,
    ctx: &Ctx,
) -> AnyElement {
    let t = ctx.t;
    let border = mix_accent(0.34, t.border);
    let border_hover = mix_accent(0.48, t.border);
    let foreground = mix_accent(0.22, t.foreground);
    let background = from_oklab(MENTION_ACCENT, 0.11);
    let background_hover = from_oklab(MENTION_ACCENT, 0.17);
    let click_client = ctx.client.clone();
    let menu_client = ctx.client.clone();
    let click_target = target.clone();
    let menu_target = target.clone();
    div()
        .id(SharedString::from(id))
        .flex()
        .flex_none()
        .items_center()
        .gap(px(CHIP_GAP))
        .h(px(CHIP_HEIGHT))
        .max_w_full()
        .px(px(CHIP_PADDING_X))
        .rounded(px(CHIP_RADIUS))
        .border_1()
        .border_color(border)
        .bg(background)
        .text_color(foreground)
        .text_size(px(CHIP_TEXT))
        .font_weight(FontWeight::MEDIUM)
        .cursor_pointer()
        .hover(move |style| style.border_color(border_hover).bg(background_hover))
        .on_click(move |event: &ClickEvent, _, cx| {
            let modifiers = event.modifiers();
            act(
                &click_client,
                cx,
                "markdownFileClick",
                click_target.params(event.position(), modifiers.platform, modifiers.control),
            );
        })
        .on_mouse_down(MouseButton::Right, move |event: &MouseDownEvent, _, cx| {
            cx.stop_propagation();
            act(
                &menu_client,
                cx,
                "markdownFileContextMenu",
                menu_target.params(event.position, false, false),
            );
        })
        .tooltip(Tooltip::builder(
            SharedString::from(target.target_path.clone()),
            TooltipVariant::Code,
        ))
        .child(
            div()
                .flex_none()
                .child(PierreIconElement(icon.clone(), CHIP_ICON)),
        )
        .child(
            div()
                .min_w_0()
                .truncate()
                .line_height(px(CHIP_LABEL_LINE))
                .child(label.to_string()),
        )
        .into_any_element()
}

#[derive(IntoElement)]
struct PierreIconElement(PierreIconView, f32);

impl gpui::RenderOnce for PierreIconElement {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        pierre_icon(&self.0, px(self.1), cx)
    }
}

fn action_button(
    id: SharedString,
    icon: &'static str,
    pressed: bool,
    tooltip: &'static str,
    t: &Tokens,
    on_click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> gpui::Stateful<gpui::Div> {
    let hover = t.accent;
    div()
        .id(id)
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .size(px(ACTION_SIZE))
        .rounded(px(ACTION_RADIUS))
        .cursor_pointer()
        .when(pressed, |this| this.bg(fade(t.foreground, 0.03)))
        .hover(move |style| style.bg(hover))
        .tooltip(Tooltip::text(tooltip))
        .on_click(on_click)
        .child(
            svg()
                .path(icon)
                .size(px(ACTION_ICON))
                .text_color(if pressed {
                    t.foreground
                } else {
                    t.muted_foreground
                }),
        )
}

fn copied_state(id: &str, window: &mut Window, cx: &mut App) -> Entity<bool> {
    window.use_keyed_state(
        ElementId::Name(SharedString::from(format!("{id}.copied"))),
        cx,
        |_, _| false,
    )
}

fn copy_with_feedback(copied: &Entity<bool>, text: &str, cx: &mut App) {
    cx.write_to_clipboard(ClipboardItem::new_string(text.to_string()));
    copied.update(cx, |value, cx| {
        *value = true;
        cx.notify();
    });
    let copied = copied.clone();
    cx.spawn(async move |cx| {
        cx.background_executor().timer(COPIED_FEEDBACK).await;
        copied.update(cx, |value, cx| {
            *value = false;
            cx.notify();
        })
    })
    .detach();
}

fn code_block(
    id: &str,
    code: &MarkdownCodeView,
    ctx: &Ctx,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let t = ctx.t;
    let default_wrap = ctx.word_wrap;
    let wrapped = window.use_keyed_state(
        ElementId::Name(SharedString::from(format!("{id}.wrap"))),
        cx,
        move |_, _| default_wrap,
    );
    let is_wrapped = *wrapped.read(cx);
    let copied = copied_state(id, window, cx);
    let is_copied = *copied.read(cx);
    let header_color = fade(t.code_foreground, 0.72);
    let (background, border) = match t.appearance {
        Appearance::Dark => (fade(t.input, 0.32), rgba(0x00000000)),
        Appearance::Light => (t.secondary, fade(t.border, 0.7)),
    };
    let title: AnyElement = match (&code.title, &code.icon) {
        (Some(title), icon) => div()
            .flex()
            .items_center()
            .gap(px(CODE_TITLE_GAP))
            .min_w_0()
            .when_some(icon.clone(), |this, icon| {
                this.child(PierreIconElement(icon, CODE_TITLE_ICON))
            })
            .child(div().min_w_0().truncate().child(title.clone()))
            .into_any_element(),
        (None, Some(icon)) => div()
            .id(SharedString::from(format!("{id}.language")))
            .flex_none()
            .tooltip(Tooltip::text(code.language.clone()))
            .child(PierreIconElement(icon.clone(), CODE_TITLE_ICON))
            .into_any_element(),
        (None, None) => div()
            .min_w_0()
            .truncate()
            .child(code.language.clone())
            .into_any_element(),
    };
    let dark = t.appearance == Appearance::Dark;
    let default_color = if code.highlighted {
        t.code_foreground
    } else {
        rgba(0x00000000)
    };
    let mut text = String::new();
    let mut highlights = Vec::new();
    for (line_index, line) in code.lines.iter().enumerate() {
        if line_index > 0 {
            text.push('\n');
        }
        for token in line {
            let start = text.len();
            text.push_str(&token.text);
            let color = if dark { &token.dark } else { &token.light }
                .as_deref()
                .and_then(|color| Rgba::try_from(color).ok())
                .unwrap_or(default_color);
            highlights.push((
                start..text.len(),
                HighlightStyle {
                    color: Some(color.into()),
                    font_style: (token.font_style & 1 == 1).then_some(FontStyle::Italic),
                    font_weight: (token.font_style & 2 == 2).then_some(FontWeight::BOLD),
                    ..HighlightStyle::default()
                },
            ));
        }
    }
    let text = SharedString::from(text);
    let group = SelectionGroup::default();
    let styled = StyledText::new(text.clone()).with_highlights(highlights);
    let body = div()
        .when(!is_wrapped, |this| this.whitespace_nowrap())
        .child(SelectableRun::new(&group, text.clone(), styled));
    let toggle = wrapped.clone();
    let copy_text = code.code.clone();
    let copy_state = copied.clone();
    let run_client = ctx.client.clone();
    let command = code.code.trim().to_string();
    div()
        .w_full()
        .min_w_0()
        .overflow_hidden()
        .rounded(px(CODE_BLOCK_RADIUS))
        .border_1()
        .border_color(border)
        .bg(background)
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap(px(CODE_HEADER_GAP))
                .pt(px(CODE_HEADER_PADDING_TOP))
                .pr(px(CODE_HEADER_PADDING_RIGHT))
                .pl(px(CODE_HEADER_PADDING_LEFT))
                .text_color(header_color)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .min_w_0()
                        .font_family(MONO_FONT)
                        .text_size(px(CODE_TITLE_TEXT))
                        .line_height(px(CODE_TITLE_LINE))
                        .child(title),
                )
                .child(
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .gap(px(CODE_ACTIONS_GAP))
                        .child(action_button(
                            SharedString::from(format!("{id}.wrap-toggle")),
                            "icons/text-wrap.svg",
                            is_wrapped,
                            if is_wrapped {
                                "Disable line wrap"
                            } else {
                                "Wrap lines"
                            },
                            t,
                            move |_, _, cx| {
                                toggle.update(cx, |value, cx| {
                                    *value = !*value;
                                    cx.notify();
                                })
                            },
                        ))
                        .when(code.can_run, |this| {
                            this.child(action_button(
                                SharedString::from(format!("{id}.run")),
                                "icons/play.svg",
                                false,
                                "Run in terminal",
                                t,
                                move |_, _, cx| {
                                    act(
                                        &run_client,
                                        cx,
                                        "runMarkdownShellCommand",
                                        json!({ "command": command }),
                                    );
                                },
                            ))
                        })
                        .child(action_button(
                            SharedString::from(format!("{id}.copy")),
                            if is_copied {
                                "icons/check.svg"
                            } else {
                                "icons/copy.svg"
                            },
                            false,
                            if is_copied { "Copied" } else { "Copy code" },
                            t,
                            move |_, _, cx| copy_with_feedback(&copy_state, &copy_text, cx),
                        )),
                ),
        )
        .child(
            div()
                .id(SharedString::from(format!("{id}.code")))
                .w_full()
                .when(!is_wrapped, |this| this.overflow_x_scroll())
                .py(px(CODE_PADDING_Y))
                .px(px(CODE_PADDING_X))
                .font_family(MONO_FONT)
                .text_size(px(t.code_font_size))
                .line_height(px(t.code_font_size * CODE_LINE_RATIO))
                .text_color(t.code_foreground)
                .child(SelectableBlock::new(
                    ElementId::Name(SharedString::from(format!("{id}.sel"))),
                    group,
                    text,
                    body,
                )),
        )
        .into_any_element()
}

fn plain_text(inlines: &[MarkdownInlineView]) -> String {
    inlines
        .iter()
        .map(|inline| match inline {
            MarkdownInlineView::Text { text, .. } => text.clone(),
            MarkdownInlineView::Break => " ".to_string(),
            MarkdownInlineView::FileChip { label, .. }
            | MarkdownInlineView::ContextReference { label, .. } => label.clone(),
            MarkdownInlineView::ContextChip { chip } => chip.copy_markdown.clone(),
            MarkdownInlineView::Favicon { .. } | MarkdownInlineView::Image { .. } => String::new(),
        })
        .collect()
}

fn table(
    id: &str,
    view: &MarkdownTableView,
    ctx: &Ctx,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let t = ctx.t;
    let default_expanded = ctx.word_wrap;
    let expanded = window.use_keyed_state(
        ElementId::Name(SharedString::from(format!("{id}.expanded"))),
        cx,
        move |_, _| default_expanded,
    );
    let is_expanded = *expanded.read(cx);
    let menu_open = window.use_keyed_state(
        ElementId::Name(SharedString::from(format!("{id}.menu"))),
        cx,
        |_, _| false,
    );
    let trigger_bounds = window.use_keyed_state(
        ElementId::Name(SharedString::from(format!("{id}.menu-trigger"))),
        cx,
        |_, _| Bounds::<Pixels>::default(),
    );
    let copied = copied_state(id, window, cx);
    let is_copied = *copied.read(cx);
    let header = &view.header;
    let rows = &view.rows;
    let align = &view.align;
    let columns = header
        .len()
        .max(rows.iter().map(Vec::len).max().unwrap_or(0));
    let mut widths = vec![1usize; columns];
    for row in std::iter::once(header.as_slice()).chain(rows.iter().map(Vec::as_slice)) {
        for (index, cell) in row.iter().enumerate() {
            if let Some(width) = widths.get_mut(index) {
                *width = (*width).max(plain_text(cell).chars().count() + 3);
            }
        }
    }
    let total: usize = widths.iter().sum::<usize>().max(1);
    let rule = fade(t.border, 0.6);
    let cell = |index: usize,
                inlines: &[MarkdownInlineView],
                head: bool,
                key: String,
                window: &mut Window,
                cx: &mut App| {
        let fraction = widths.get(index).copied().unwrap_or(1) as f32 / total as f32;
        let metrics = TextMetrics {
            size: TABLE_TEXT,
            line: TABLE_LINE,
            weight: if head {
                FontWeight::SEMIBOLD
            } else {
                FontWeight::NORMAL
            },
            color: ctx.base,
        };
        div()
            .flex_basis(relative(fraction))
            .flex_grow(1.)
            .min_w_0()
            .max_w(px(TABLE_CELL_MAX_WIDTH))
            .px(px(TABLE_CELL_PADDING_X))
            .py(px(if head {
                TABLE_HEAD_PADDING_Y
            } else {
                TABLE_CELL_PADDING_Y
            }))
            .when(head || !is_expanded, |this| {
                this.whitespace_nowrap().truncate()
            })
            .when(
                matches!(align.get(index), Some(Some(TableAlign::Right))),
                |this| this.flex().justify_end(),
            )
            .when(
                matches!(align.get(index), Some(Some(TableAlign::Center))),
                |this| this.flex().justify_center(),
            )
            .child(inline_flow(&key, inlines, metrics, ctx, window, cx))
    };
    let row_element = |cells: &[Vec<MarkdownInlineView>],
                       head: bool,
                       key: String,
                       window: &mut Window,
                       cx: &mut App| {
        div()
            .flex()
            .w_full()
            .border_b_1()
            .border_color(rule)
            .children(cells.iter().enumerate().map(|(index, inlines)| {
                cell(index, inlines, head, format!("{key}.{index}"), window, cx)
            }))
    };
    let toggle = expanded.clone();
    let open = menu_open.clone();
    let measure = trigger_bounds.clone();
    let is_open = *menu_open.read(cx);
    let anchor = *trigger_bounds.read(cx);
    let menu = is_open.then(|| {
        let markdown = view.copy_markdown.clone();
        let csv = view.copy_csv.clone();
        let (close_markdown, close_csv, dismiss) = (open.clone(), open.clone(), open.clone());
        let (copied_markdown, copied_csv) = (copied.clone(), copied.clone());
        MenuPopup::new(SharedString::from(format!("{id}.menu-popup")), anchor)
            .align(Align::End)
            .min_width(TABLE_MENU_MIN_WIDTH)
            .on_dismiss(move |_, cx| {
                dismiss.update(cx, |value, cx| {
                    *value = false;
                    cx.notify();
                })
            })
            .child(
                MenuItem::new(SharedString::from(format!("{id}.copy-markdown")))
                    .label("Copy as Markdown")
                    .on_click(move |_, _, cx| {
                        copy_with_feedback(&copied_markdown, &markdown, cx);
                        close_markdown.update(cx, |value, cx| {
                            *value = false;
                            cx.notify();
                        });
                    }),
            )
            .child(
                MenuItem::new(SharedString::from(format!("{id}.copy-csv")))
                    .label("Copy as CSV")
                    .on_click(move |_, _, cx| {
                        copy_with_feedback(&copied_csv, &csv, cx);
                        close_csv.update(cx, |value, cx| {
                            *value = false;
                            cx.notify();
                        });
                    }),
            )
    });
    div()
        .w_full()
        .min_w_0()
        .child(
            div()
                .w_full()
                .text_size(px(TABLE_TEXT))
                .line_height(px(TABLE_LINE))
                .child(row_element(header, true, format!("{id}.h"), window, cx))
                .children(rows.iter().enumerate().map(|(index, row)| {
                    row_element(row, false, format!("{id}.r{index}"), window, cx)
                })),
        )
        .child(
            div()
                .mt(px(TABLE_FOOTER_MARGIN))
                .flex()
                .items_center()
                .justify_between()
                .child(action_button(
                    SharedString::from(format!("{id}.expand")),
                    if is_expanded {
                        "icons/minimize-2.svg"
                    } else {
                        "icons/maximize-2.svg"
                    },
                    is_expanded,
                    if is_expanded {
                        "Collapse table cells"
                    } else {
                        "Expand table cells"
                    },
                    t,
                    move |_, _, cx| {
                        toggle.update(cx, |value, cx| {
                            *value = !*value;
                            cx.notify();
                        })
                    },
                ))
                .child(
                    action_button(
                        SharedString::from(format!("{id}.copy")),
                        if is_copied {
                            "icons/check.svg"
                        } else {
                            "icons/copy.svg"
                        },
                        false,
                        if is_copied { "Copied" } else { "Copy table" },
                        t,
                        move |_, _, cx| {
                            open.update(cx, |value, cx| {
                                *value = !*value;
                                cx.notify();
                            })
                        },
                    )
                    .child(
                        canvas(
                            move |bounds, _, cx| {
                                measure.update(cx, |value, _| *value = bounds);
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full(),
                    ),
                ),
        )
        .children(menu)
        .into_any_element()
}
