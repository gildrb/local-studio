use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, AnyView, App, AppContext, Bounds, ElementId, Entity, FontStyle, FontWeight,
    HighlightStyle, ImageAssetLoader, InteractiveElement, IntoElement, ObjectFit, ParentElement,
    Pixels, Render, RenderOnce, Resource, Rgba, SharedString, StatefulInteractiveElement, Styled,
    StyledImage, StyledText, Window, canvas, div, img, px, svg,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::context_chip::{
    ContextChipActionView, ContextChipDetailsView, ContextChipIconView, ContextChipLabelWidth,
    ContextChipState, ContextChipTone, ContextChipTooltipView, ContextChipView,
    PreviewAnnotationElementView, PullRequestDisplayState, SkillTextSegmentView, SourcePreviewView,
};
use crate::app_core::views::markdown::{MarkdownDocView, SyntaxTokenView};
use crate::app_core::views::sidebar::PullRequestTone;
use crate::features::chat::chat_markdown::markdown_document;
use crate::platform::MONO_FONT;
use crate::ui::pierre_icon::pierre_icon;
use crate::ui::popover::{
    PopoverPadding, PopoverPopup, PopoverWidth, Side, black, shadow, top_highlight,
};
use crate::ui::theme;
use crate::ui::theme::color::{mix_oklab, oklch};
use crate::ui::theme::metrics::radius;
use crate::ui::theme::tokens::{Appearance, Tokens, fade};
use crate::ui::thread_status_indicators::pull_request_tone;
use crate::ui::tooltip::{Tooltip, TooltipVariant};

pub const CHIP_TEXT: f32 = 12.04;
const CHIP_HEIGHT: f32 = 16.97;
const CHIP_PADDING_X: f32 = 6.02;
const CHIP_GAP: f32 = 3.97;
const CHIP_RADIUS: f32 = 6.02;
const CHIP_ICON: f32 = 14.08;
const CHIP_LABEL_LINE: f32 = 15.05;
const CHIP_IMAGE_RADIUS: f32 = 6.;
const CHIP_SIZE_TEXT: f32 = 10.;
const CHIP_SIZE_LINE: f32 = 14.;
const CHIP_ACTION_RADIUS: f32 = 6.;
const ATTACHMENT_LABEL_MAX: f32 = 288.;
const CITATION_LABEL_MAX: f32 = 16. * CHIP_TEXT;
const ACCENT_LIGHTNESS: f32 = 0.62;
const FILL: f32 = 0.11;
const FILL_HOVER: f32 = 0.17;
const BORDER_MIX: f32 = 0.34;
const BORDER_HOVER_MIX: f32 = 0.48;
const FOREGROUND_MIX: f32 = 0.22;
const TEXT_XS: f32 = 12.;
const LINE_XS: f32 = 16.;
const TEXT_SM: f32 = 14.;
const LINE_SM: f32 = 20.;
const TEXT_2XS: f32 = 11.;
const LINE_2XS: f32 = 16.;
const TEXT_3XS: f32 = 10.;
const LINE_3XS: f32 = 14.;
const LINE_RELAXED_XS: f32 = 19.5;
const LINE_RELAXED_3XS: f32 = 16.25;
const CARD_RADIUS: f32 = 10.;
const TERMINAL_RADIUS: f32 = 8.;
const SOURCE_RADIUS: f32 = 4.;
const PAD_X: f32 = 12.;
const PAD_Y: f32 = 10.;
const TERMINAL_HEADER_PAD_Y: f32 = 8.;
const TERMINAL_ICON: f32 = 16.;
const TERMINAL_MAX_HEIGHT: f32 = 320.;
const ELEMENT_HTML_HEIGHT: f32 = 160.;
const ELEMENT_STYLES_HEIGHT: f32 = 128.;
const ANNOTATION_IMAGE_MAX_HEIGHT: f32 = 256.;
const ANNOTATION_PREVIEW_MAX_HEIGHT: f32 = 96.;
const SMALL_ICON: f32 = 12.;
const PR_TOOLTIP_ICON: f32 = 14.;
const PR_TOOLTIP_MAX_WIDTH: f32 = 320.;
const TOOLTIP_PADDING_X: f32 = 8.;
const TOOLTIP_PADDING_Y: f32 = 4.;

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: serde_json::Value) {
    client.update(cx, |client, _| client.act(action, params));
}

fn tone_accent(tone: ContextChipTone) -> Option<Rgba> {
    let (chroma, hue) = match tone {
        ContextChipTone::Neutral => return None,
        ContextChipTone::Image => (0.16, 16.),
        ContextChipTone::Video => (0.16, 48.),
        ContextChipTone::File => (0.136, 237.),
        ContextChipTone::Mention => (0.11, 215.),
        ContextChipTone::Terminal => (0.134, 163.),
        ContextChipTone::Element | ContextChipTone::PreviewAnnotation => (0.134, 70.),
        ContextChipTone::ReviewComment => (0.16, 292.),
        ContextChipTone::PullRequest => (0.16, 277.),
        ContextChipTone::PrOpen => (0.134, 163.),
        ContextChipTone::PrDraft => (0.02, 259.),
        ContextChipTone::PrMerged => (0.16, 292.),
        ContextChipTone::PrClosed => (0.16, 16.),
        ContextChipTone::Skill => (0.16, 322.),
        ContextChipTone::Citation => (0.16, 259.),
    };
    Some(oklch(ACCENT_LIGHTNESS, chroma, hue))
}

#[derive(Clone, Copy)]
struct ChipColors {
    accent: Option<Rgba>,
    fill: Rgba,
    fill_hover: Rgba,
    border: Rgba,
    border_hover: Rgba,
    foreground: Rgba,
}

fn chip_colors(
    tone: ContextChipTone,
    state: ContextChipState,
    sampled: Option<Rgba>,
    t: &Tokens,
) -> ChipColors {
    if state == ContextChipState::Invalid {
        let border = fade(t.destructive, 0.35);
        let fill = fade(t.destructive, 0.08);
        return ChipColors {
            accent: None,
            fill,
            fill_hover: fill,
            border,
            border_hover: border,
            foreground: t.destructive,
        };
    }
    match sampled.or_else(|| tone_accent(tone)) {
        Some(accent) => ChipColors {
            accent: Some(accent),
            fill: fade(accent, FILL),
            fill_hover: fade(accent, FILL_HOVER),
            border: mix_oklab(accent, t.border, BORDER_MIX),
            border_hover: mix_oklab(accent, t.border, BORDER_HOVER_MIX),
            foreground: if state == ContextChipState::Unresolved {
                t.foreground
            } else {
                mix_oklab(accent, t.foreground, FOREGROUND_MIX)
            },
        },
        None => {
            let border = fade(t.border, 0.7);
            let fill = fade(t.accent, 0.4);
            ChipColors {
                accent: None,
                fill,
                fill_hover: fill,
                border,
                border_hover: border,
                foreground: t.foreground,
            }
        }
    }
}

fn icon_element(icon: &ContextChipIconView, color: Rgba, cx: &App) -> AnyElement {
    match icon {
        ContextChipIconView::Pierre { icon } => div()
            .flex_none()
            .child(pierre_icon(icon, px(CHIP_ICON), cx))
            .into_any_element(),
        ContextChipIconView::Lucide { asset } => svg()
            .path(SharedString::from(asset.clone()))
            .flex_none()
            .size(px(CHIP_ICON))
            .text_color(color)
            .into_any_element(),
        ContextChipIconView::Image { url } => img(SharedString::from(url.clone()))
            .flex_none()
            .size(px(CHIP_ICON))
            .rounded(px(CHIP_IMAGE_RADIUS))
            .object_fit(ObjectFit::Cover)
            .with_fallback(move || {
                svg()
                    .path("icons/image.svg")
                    .size(px(CHIP_ICON))
                    .text_color(color)
                    .into_any_element()
            })
            .into_any_element(),
    }
}

fn average_color(bytes: &[u8]) -> Option<Rgba> {
    let (mut red, mut green, mut blue, mut weight) = (0f64, 0f64, 0f64, 0f64);
    for [b, g, r, a] in bytes.as_chunks::<4>().0 {
        let alpha = f64::from(*a);
        red += f64::from(*r) * alpha;
        green += f64::from(*g) * alpha;
        blue += f64::from(*b) * alpha;
        weight += alpha;
    }
    if weight == 0. {
        return None;
    }
    let channel = |sum: f64| ((sum / weight).round() / 255.) as f32;
    Some(Rgba {
        r: channel(red),
        g: channel(green),
        b: channel(blue),
        a: 1.,
    })
}

type SampledAccent = Option<(String, Option<Rgba>)>;

fn sampled_accent(id: &SharedString, url: &str, window: &mut Window, cx: &mut App) -> Option<Rgba> {
    let cache: Entity<SampledAccent> = window.use_keyed_state(
        ElementId::Name(SharedString::from(format!("{id}.accent"))),
        cx,
        |_, _| None,
    );
    if let Some((cached_url, color)) = cache.read(cx)
        && cached_url == url
    {
        return *color;
    }
    let resource = Resource::Uri(url.to_string().into());
    let color = match window.use_asset::<ImageAssetLoader>(&resource, cx) {
        Some(Ok(image)) => image.as_bytes(0).and_then(average_color),
        Some(Err(_)) => None,
        None => return None,
    };
    let url = url.to_string();
    cache.update(cx, |value, _| *value = Some((url, color)));
    color
}

fn label_max_width(width: Option<ContextChipLabelWidth>) -> Option<f32> {
    match width {
        Some(ContextChipLabelWidth::Attachment) => Some(ATTACHMENT_LABEL_MAX),
        Some(ContextChipLabelWidth::Citation) => Some(CITATION_LABEL_MAX),
        None => None,
    }
}

fn chip_content(chip: &ContextChipView, foreground: Rgba, cx: &App) -> Vec<AnyElement> {
    let mut children = Vec::new();
    if let Some(icon) = chip.icon.as_ref() {
        children.push(icon_element(icon, foreground, cx));
    }
    children.push(
        div()
            .min_w_0()
            .truncate()
            .line_height(px(CHIP_LABEL_LINE))
            .when_some(label_max_width(chip.label_width), |this, width| {
                this.max_w(px(width))
            })
            .child(chip.label.clone())
            .into_any_element(),
    );
    if let Some(size) = chip.size.clone() {
        children.push(
            div()
                .flex_none()
                .text_size(px(CHIP_SIZE_TEXT))
                .line_height(px(CHIP_SIZE_LINE))
                .child(size)
                .into_any_element(),
        );
    }
    children
}

struct PullRequestTooltip {
    number: u32,
    title: SharedString,
    state: PullRequestDisplayState,
    state_label: SharedString,
    head_branch: SharedString,
    base_branch: SharedString,
}

impl Render for PullRequestTooltip {
    fn render(&mut self, _: &mut Window, cx: &mut gpui::Context<Self>) -> impl IntoElement {
        let t = theme::active(cx);
        let (tone, icon) = match self.state {
            PullRequestDisplayState::Open => {
                (PullRequestTone::Open, "icons/git-pull-request-arrow.svg")
            }
            PullRequestDisplayState::Draft => {
                (PullRequestTone::Draft, "icons/git-pull-request-draft.svg")
            }
            PullRequestDisplayState::Closed => {
                (PullRequestTone::Closed, "icons/git-pull-request-closed.svg")
            }
            PullRequestDisplayState::Merged => (PullRequestTone::Merged, "icons/git-merge.svg"),
        };
        let tone = pull_request_tone(tone, &t);
        div()
            .flex()
            .flex_col()
            .gap(px(4.))
            .max_w(px(PR_TOOLTIP_MAX_WIDTH))
            .overflow_hidden()
            .rounded(px(radius::MD))
            .border_1()
            .border_color(t.border)
            .bg(t.popover)
            .text_color(t.popover_foreground)
            .text_size(px(TEXT_XS))
            .line_height(px(LINE_XS))
            .shadow(vec![
                shadow(0., 4., 6., -1., black(0.05)),
                shadow(0., 2., 4., -2., black(0.05)),
                top_highlight(&t),
            ])
            .px(px(TOOLTIP_PADDING_X))
            .py(px(TOOLTIP_PADDING_Y + 2.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .font_weight(FontWeight::MEDIUM)
                    .child(
                        svg()
                            .path(icon)
                            .flex_none()
                            .size(px(PR_TOOLTIP_ICON))
                            .text_color(tone),
                    )
                    .child(
                        div()
                            .text_color(t.foreground)
                            .child(format!("Pull request #{}", self.number)),
                    )
                    .child(div().text_color(tone).child(self.state_label.clone())),
            )
            .child(div().text_color(t.foreground).child(self.title.clone()))
            .child(
                div()
                    .flex()
                    .min_w_0()
                    .items_center()
                    .gap(px(4.))
                    .text_size(px(TEXT_3XS))
                    .line_height(px(LINE_3XS))
                    .text_color(t.secondary_label)
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .font_family(MONO_FONT)
                            .child(self.head_branch.clone()),
                    )
                    .child(
                        svg()
                            .path("icons/arrow-right.svg")
                            .flex_none()
                            .size(px(SMALL_ICON))
                            .text_color(t.secondary_label),
                    )
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .font_family(MONO_FONT)
                            .child(self.base_branch.clone()),
                    ),
            )
    }
}

type TooltipBuilder = Box<dyn Fn(&mut Window, &mut App) -> AnyView + 'static>;

type ChipClickHandler = Box<dyn Fn(&mut App) + 'static>;

fn tooltip_builder(tooltip: &ContextChipTooltipView) -> TooltipBuilder {
    match tooltip.clone() {
        ContextChipTooltipView::Text { text, code } => Box::new(Tooltip::builder(
            SharedString::from(text),
            if code {
                TooltipVariant::Code
            } else {
                TooltipVariant::Default
            },
        )),
        ContextChipTooltipView::PullRequest {
            number,
            title,
            state,
            state_label,
            head_branch,
            base_branch,
        } => Box::new(move |_, cx| {
            let (title, state_label, head_branch, base_branch) = (
                SharedString::from(title.clone()),
                SharedString::from(state_label.clone()),
                SharedString::from(head_branch.clone()),
                SharedString::from(base_branch.clone()),
            );
            cx.new(move |_| PullRequestTooltip {
                number,
                title,
                state,
                state_label,
                head_branch,
                base_branch,
            })
            .into()
        }),
    }
}

fn click_action(
    action: &ContextChipActionView,
    client: &Entity<CoreClient>,
) -> Option<ChipClickHandler> {
    let client = client.clone();
    let (name, params): (&'static str, serde_json::Value) = match action {
        ContextChipActionView::None | ContextChipActionView::Popover => return None,
        ContextChipActionView::OpenMention { path } => {
            ("openTimelineMention", json!({ "path": path }))
        }
        ContextChipActionView::ExpandImage {
            message_id,
            attachment_id,
        } => (
            "expandTimelineImage",
            json!({ "messageId": message_id, "attachmentId": attachment_id }),
        ),
        ContextChipActionView::OpenAttachment {
            message_id,
            attachment_id,
        } => (
            "openTimelineAttachment",
            json!({ "messageId": message_id, "attachmentId": attachment_id }),
        ),
        ContextChipActionView::ExpandVideo {
            message_id,
            attachment_id,
        } => (
            "expandTimelineVideo",
            json!({ "messageId": message_id, "attachmentId": attachment_id }),
        ),
        ContextChipActionView::OpenPullRequest { url } => {
            ("openTimelinePullRequest", json!({ "url": url }))
        }
        ContextChipActionView::OpenCitation { href } => {
            ("openAssistantCitation", json!({ "href": href }))
        }
    };
    Some(Box::new(move |cx: &mut App| {
        act(&client, cx, name, params.clone())
    }))
}

#[derive(IntoElement)]
pub struct ContextChip {
    id: SharedString,
    chip: ContextChipView,
    client: Entity<CoreClient>,
}

impl ContextChip {
    pub fn new(
        id: impl Into<SharedString>,
        chip: &ContextChipView,
        client: &Entity<CoreClient>,
    ) -> Self {
        Self {
            id: id.into(),
            chip: chip.clone(),
            client: client.clone(),
        }
    }
}

impl RenderOnce for ContextChip {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let chip = self.chip;
        let id = self.id;
        let sampled = match (chip.tone, chip.icon.as_ref()) {
            (ContextChipTone::Image, Some(ContextChipIconView::Image { url })) => {
                sampled_accent(&id, url, window, cx)
            }
            _ => None,
        };
        let colors = chip_colors(chip.tone, chip.state, sampled, &t);
        let popover =
            matches!(chip.action, ContextChipActionView::Popover) && chip.details.is_some();
        let interactive =
            !chip.disabled && (popover || !matches!(chip.action, ContextChipActionView::None));
        let citation = matches!(chip.action, ContextChipActionView::OpenCitation { .. });
        let open_state = popover.then(|| {
            (
                window.use_keyed_state(
                    ElementId::Name(SharedString::from(format!("{id}.open"))),
                    cx,
                    |_, _| false,
                ),
                window.use_keyed_state(
                    ElementId::Name(SharedString::from(format!("{id}.trigger"))),
                    cx,
                    |_, _| Bounds::<Pixels>::default(),
                ),
            )
        });
        let is_open = open_state.as_ref().is_some_and(|(open, _)| *open.read(cx));
        let content = chip_content(&chip, colors.foreground, cx);
        let body: AnyElement = if citation {
            let hover = colors
                .accent
                .map_or(colors.fill_hover, |accent| fade(accent, FILL_HOVER));
            div()
                .flex()
                .h_full()
                .min_w_0()
                .items_center()
                .gap(px(CHIP_GAP))
                .rounded(px(CHIP_ACTION_RADIUS))
                .hover(move |style| style.bg(hover))
                .children(content)
                .into_any_element()
        } else {
            div()
                .flex()
                .min_w_0()
                .items_center()
                .gap(px(CHIP_GAP))
                .children(content)
                .into_any_element()
        };
        let on_click = click_action(&chip.action, &self.client);
        let toggle = open_state.as_ref().map(|(open, _)| open.clone());
        let ChipColors {
            border_hover,
            fill_hover,
            ..
        } = colors;
        let mut element = div()
            .id(ElementId::Name(id.clone()))
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(CHIP_GAP))
            .h(px(CHIP_HEIGHT))
            .max_w_full()
            .px(px(CHIP_PADDING_X))
            .rounded(px(CHIP_RADIUS))
            .border_1()
            .when(chip.state == ContextChipState::Unresolved, |this| {
                this.border_dashed()
            })
            .border_color(colors.border)
            .bg(colors.fill)
            .text_color(colors.foreground)
            .text_size(px(CHIP_TEXT))
            .font_weight(FontWeight::MEDIUM)
            .when(interactive, |this| this.cursor_pointer())
            .when(interactive && !citation, move |this| {
                this.hover(move |style| style.border_color(border_hover).bg(fill_hover))
            })
            .when(is_open && !citation, |this| {
                this.border_color(border_hover).bg(fill_hover)
            })
            .child(body);
        if interactive {
            element = element.on_click(move |_, _, cx| {
                if let Some(toggle) = toggle.as_ref() {
                    toggle.update(cx, |value, cx| {
                        *value = !*value;
                        cx.notify();
                    });
                } else if let Some(on_click) = on_click.as_ref() {
                    on_click(cx);
                }
            });
        }
        if let Some(tooltip) = chip.tooltip.as_ref() {
            element = element.tooltip(tooltip_builder(tooltip));
        }
        let popup = match (&open_state, chip.details.as_deref()) {
            (Some((open, trigger)), Some(details)) => {
                let measure = trigger.clone();
                element = element.child(
                    canvas(
                        move |bounds, _, cx| measure.update(cx, |value, _| *value = bounds),
                        |_, _, _, _| {},
                    )
                    .absolute()
                    .size_full(),
                );
                is_open.then(|| {
                    let anchor = *trigger.read(cx);
                    let dismiss = open.clone();
                    PopoverPopup::new(SharedString::from(format!("{id}.popover")), anchor)
                        .side(Side::Top)
                        .width(PopoverWidth::Lg)
                        .padding(PopoverPadding::Compact)
                        .on_dismiss(move |window, cx| {
                            if anchor.contains(&window.mouse_position()) {
                                return;
                            }
                            dismiss.update(cx, |value, cx| {
                                *value = false;
                                cx.notify();
                            });
                        })
                        .child(details_element(&id, details, &self.client, &t, window, cx))
                })
            }
            _ => None,
        };
        element.children(popup)
    }
}

fn mono_lines(lines: &[Vec<SyntaxTokenView>], t: &Tokens) -> StyledText {
    let dark = t.appearance == Appearance::Dark;
    let mut text = String::new();
    let mut highlights = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if index > 0 {
            text.push('\n');
        }
        for token in line {
            let start = text.len();
            text.push_str(&token.text);
            let color = if dark { &token.dark } else { &token.light }
                .as_deref()
                .and_then(|color| Rgba::try_from(color).ok())
                .unwrap_or(t.code_foreground);
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
    StyledText::new(SharedString::from(text)).with_highlights(highlights)
}

fn source_preview(id: String, preview: &SourcePreviewView, height: f32, t: &Tokens) -> AnyElement {
    div()
        .id(SharedString::from(id))
        .flex()
        .flex_col()
        .h(px(height))
        .overflow_scroll()
        .rounded(px(SOURCE_RADIUS))
        .border_1()
        .border_color(t.border)
        .bg(t.code_background)
        .p(px(PAD_X))
        .font_family(MONO_FONT)
        .text_size(px(TEXT_XS))
        .line_height(px(LINE_RELAXED_XS))
        .whitespace_nowrap()
        .child(mono_lines(&preview.lines, t))
        .into_any_element()
}

fn selector_row(selector: &str, source: Option<&String>, t: &Tokens) -> AnyElement {
    div()
        .flex()
        .min_w_0()
        .items_center()
        .gap(px(8.))
        .text_size(px(TEXT_XS))
        .line_height(px(LINE_XS))
        .child(
            div()
                .min_w_0()
                .truncate()
                .font_family(MONO_FONT)
                .text_color(t.message_foreground)
                .child(selector.to_string()),
        )
        .when_some(source.cloned(), |this, source| {
            this.child(
                div()
                    .ml_auto()
                    .flex_none()
                    .text_color(t.secondary_label)
                    .child(source),
            )
        })
        .into_any_element()
}

fn card(t: &Tokens) -> gpui::Div {
    div()
        .max_w_full()
        .overflow_hidden()
        .rounded(px(CARD_RADIUS))
        .border_1()
        .border_color(fade(t.border, 0.7))
        .bg(fade(t.background, 0.7))
}

fn annotation_element(id: &str, element: &PreviewAnnotationElementView, t: &Tokens) -> AnyElement {
    div()
        .min_w_0()
        .child(selector_row(
            &element.selector,
            element.source_label.as_ref(),
            t,
        ))
        .when_some(element.html_preview.clone(), |this, html| {
            this.child(
                div()
                    .id(SharedString::from(format!("{id}.{}", element.key)))
                    .mt(px(4.))
                    .max_h(px(ANNOTATION_PREVIEW_MAX_HEIGHT))
                    .overflow_y_scroll()
                    .rounded(px(SOURCE_RADIUS))
                    .bg(fade(t.muted, 0.6))
                    .px(px(8.))
                    .py(px(6.))
                    .font_family(MONO_FONT)
                    .text_size(px(TEXT_3XS))
                    .line_height(px(LINE_RELAXED_3XS))
                    .child(html),
            )
        })
        .into_any_element()
}

fn skill_text(segments: &[SkillTextSegmentView], t: &Tokens) -> AnyElement {
    let colors = chip_colors(ContextChipTone::Skill, ContextChipState::Normal, None, t);
    let mut lines: Vec<Vec<AnyElement>> = vec![Vec::new()];
    for segment in segments {
        match segment {
            SkillTextSegmentView::Text { text } => {
                for (index, line) in text.split('\n').enumerate() {
                    if index > 0 {
                        lines.push(Vec::new());
                    }
                    if let Some(current) = lines.last_mut() {
                        for word in line.split_inclusive(' ') {
                            current.push(
                                div()
                                    .whitespace_nowrap()
                                    .child(word.to_string())
                                    .into_any_element(),
                            );
                        }
                    }
                }
            }
            SkillTextSegmentView::Skill { label } => {
                if let Some(current) = lines.last_mut() {
                    current.push(
                        div()
                            .flex()
                            .flex_none()
                            .items_center()
                            .gap(px(CHIP_GAP))
                            .h(px(CHIP_HEIGHT))
                            .px(px(CHIP_PADDING_X))
                            .rounded(px(CHIP_RADIUS))
                            .border_1()
                            .border_color(colors.border)
                            .bg(colors.fill)
                            .text_color(colors.foreground)
                            .text_size(px(CHIP_TEXT))
                            .font_weight(FontWeight::MEDIUM)
                            .child(
                                svg()
                                    .path("icons/skill-chip.svg")
                                    .flex_none()
                                    .size(px(CHIP_ICON))
                                    .text_color(colors.foreground),
                            )
                            .child(div().line_height(px(CHIP_LABEL_LINE)).child(label.clone()))
                            .into_any_element(),
                    );
                }
            }
        }
    }
    div()
        .flex()
        .flex_col()
        .text_size(px(TEXT_SM))
        .line_height(px(LINE_SM))
        .children(lines.into_iter().map(|line| {
            div()
                .flex()
                .flex_wrap()
                .items_center()
                .min_h(px(LINE_SM))
                .children(line)
        }))
        .into_any_element()
}

fn embedded_document(
    id: String,
    doc: &MarkdownDocView,
    client: &Entity<CoreClient>,
    t: &Tokens,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    markdown_document(&id, doc, t.message_foreground, client, t, window, cx)
}

fn details_element(
    id: &str,
    details: &ContextChipDetailsView,
    client: &Entity<CoreClient>,
    t: &Tokens,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    match details {
        ContextChipDetailsView::Terminal {
            terminal_label,
            range_label,
            text,
        } => div()
            .overflow_hidden()
            .rounded(px(TERMINAL_RADIUS))
            .border_1()
            .border_color(fade(t.border, 0.7))
            .bg(fade(t.background, 0.8))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .border_b_1()
                    .border_color(fade(t.border, 0.7))
                    .px(px(PAD_X))
                    .py(px(TERMINAL_HEADER_PAD_Y))
                    .child(
                        svg()
                            .path("icons/terminal.svg")
                            .flex_none()
                            .size(px(TERMINAL_ICON))
                            .text_color(t.success),
                    )
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .text_size(px(TEXT_SM))
                            .line_height(px(LINE_SM))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.foreground)
                            .child(terminal_label.clone()),
                    )
                    .child(
                        div()
                            .ml_auto()
                            .flex_none()
                            .text_size(px(TEXT_XS))
                            .line_height(px(LINE_XS))
                            .text_color(t.secondary_label)
                            .child(range_label.clone()),
                    ),
            )
            .child(
                div()
                    .id(SharedString::from(format!("{id}.terminal")))
                    .max_h(px(TERMINAL_MAX_HEIGHT))
                    .overflow_scroll()
                    .bg(t.muted)
                    .p(px(PAD_X))
                    .font_family(MONO_FONT)
                    .text_size(px(TEXT_XS))
                    .line_height(px(LINE_RELAXED_XS))
                    .text_color(t.foreground)
                    .whitespace_nowrap()
                    .child(text.clone()),
            )
            .into_any_element(),
        ContextChipDetailsView::Element {
            title,
            page_url,
            selector,
            source_label,
            html,
            styles,
        } => card(t)
            .child(
                div()
                    .border_b_1()
                    .border_color(fade(t.border, 0.7))
                    .px(px(PAD_X))
                    .py(px(PAD_Y))
                    .child(
                        div()
                            .truncate()
                            .text_size(px(TEXT_XS))
                            .line_height(px(LINE_XS))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.message_foreground)
                            .child(title.clone()),
                    )
                    .child(
                        div()
                            .mt(px(2.))
                            .truncate()
                            .text_size(px(TEXT_3XS))
                            .line_height(px(LINE_3XS))
                            .text_color(t.secondary_label)
                            .child(page_url.clone()),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .px(px(PAD_X))
                    .py(px(PAD_Y))
                    .child(selector_row(selector, source_label.as_ref(), t))
                    .when_some(html.as_ref(), |this, html| {
                        this.child(source_preview(
                            format!("{id}.html"),
                            html,
                            ELEMENT_HTML_HEIGHT,
                            t,
                        ))
                    })
                    .when_some(styles.as_ref(), |this, styles| {
                        this.child(source_preview(
                            format!("{id}.styles"),
                            styles,
                            ELEMENT_STYLES_HEIGHT,
                            t,
                        ))
                    }),
            )
            .into_any_element(),
        ContextChipDetailsView::PreviewAnnotation {
            image,
            title,
            comment,
            target_summary,
            style_change_count,
            elements,
        } => {
            let header = match image.as_ref().and_then(|image| image.url.clone()) {
                Some(url) => div()
                    .flex()
                    .justify_center()
                    .w_full()
                    .max_h(px(ANNOTATION_IMAGE_MAX_HEIGHT))
                    .overflow_hidden()
                    .border_b_1()
                    .border_color(fade(t.border, 0.7))
                    .bg(t.muted)
                    .child(
                        img(SharedString::from(url))
                            .max_h(px(ANNOTATION_IMAGE_MAX_HEIGHT))
                            .w_full()
                            .object_fit(ObjectFit::Contain),
                    )
                    .into_any_element(),
                None => div()
                    .border_b_1()
                    .border_color(fade(t.border, 0.7))
                    .bg(fade(t.muted, 0.4))
                    .px(px(PAD_X))
                    .py(px(8.))
                    .text_size(px(TEXT_XS))
                    .line_height(px(LINE_XS))
                    .text_color(t.secondary_label)
                    .child("Screenshot unavailable")
                    .into_any_element(),
            };
            card(t)
                .child(header)
                .child(
                    div()
                        .min_w_0()
                        .px(px(PAD_X))
                        .py(px(PAD_Y))
                        .child(
                            div()
                                .text_size(px(TEXT_XS))
                                .line_height(px(LINE_XS))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.message_foreground)
                                .child(title.clone()),
                        )
                        .when_some(comment.clone(), |this, comment| {
                            this.child(
                                div()
                                    .mt(px(4.))
                                    .text_size(px(TEXT_SM))
                                    .line_height(px(LINE_SM))
                                    .child(comment),
                            )
                        })
                        .child(
                            div()
                                .mt(px(4.))
                                .flex()
                                .items_center()
                                .gap(px(8.))
                                .text_size(px(TEXT_3XS))
                                .line_height(px(LINE_3XS))
                                .text_color(t.secondary_label)
                                .when_some(target_summary.clone(), |this, summary| {
                                    this.child(div().min_w_0().truncate().child(summary))
                                })
                                .when(*style_change_count > 0, |this| {
                                    this.child(
                                        div()
                                            .flex()
                                            .flex_none()
                                            .items_center()
                                            .gap(px(4.))
                                            .child(
                                                svg()
                                                    .path("icons/paintbrush.svg")
                                                    .size(px(SMALL_ICON))
                                                    .text_color(t.secondary_label),
                                            )
                                            .child(style_change_count.to_string()),
                                    )
                                }),
                        )
                        .when(!elements.is_empty(), |this| {
                            this.child(
                                div()
                                    .mt(px(8.))
                                    .flex()
                                    .flex_col()
                                    .gap(px(8.))
                                    .border_t_1()
                                    .border_color(fade(t.border, 0.6))
                                    .pt(px(8.))
                                    .children(
                                        elements
                                            .iter()
                                            .map(|element| annotation_element(id, element, t)),
                                    ),
                            )
                        }),
                )
                .into_any_element()
        }
        ContextChipDetailsView::ReviewComment {
            file_path,
            section_label,
            text,
            fence,
            patch,
        } => {
            let fence = fence
                .as_deref()
                .map(|doc| embedded_document(format!("{id}.fence"), doc, client, t, window, cx));
            let patch = patch
                .as_deref()
                .map(|doc| embedded_document(format!("{id}.patch"), doc, client, t, window, cx));
            card(t)
                .flex()
                .flex_col()
                .gap(px(8.))
                .p(px(PAD_X))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(4.))
                        .child(
                            div()
                                .text_size(px(TEXT_XS))
                                .line_height(px(LINE_XS))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.message_foreground)
                                .child(file_path.clone()),
                        )
                        .child(
                            div()
                                .text_size(px(TEXT_2XS))
                                .line_height(px(LINE_2XS))
                                .text_color(t.secondary_label)
                                .child(section_label.clone()),
                        ),
                )
                .when_some(text.as_ref(), |this, segments| {
                    this.child(skill_text(segments, t))
                })
                .children(fence)
                .children(patch)
                .into_any_element()
        }
    }
}
