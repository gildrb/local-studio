use std::cell::RefCell;
use std::collections::HashMap;
use std::path::PathBuf;
use std::rc::Rc;

use gpui::component::input::{InlineToken, InlineTokenContext, InputContent, TextareaState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, ClipboardEntry, ClipboardItem, Context, Entity, FontWeight,
    InteractiveElement, IntoElement, ObjectFit, ParentElement, PathPromptOptions, Rgba,
    ScrollHandle, SharedString, StatefulInteractiveElement, Styled, StyledImage, Window, div, img,
    linear_color_stop, linear_gradient, px, svg,
};
use serde_json::json;

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::composer_input::{
    ComposerChipKind, ComposerEditView, ComposerIconView, ComposerImageView, ComposerInputView,
    ComposerMenuItemView, ComposerMenuView, ComposerTokenView, PullRequestStateKey,
};
use crate::features::chat::composer_snap_shot::{
    ReportedDestinations, pending_card, snap_shot_card,
};
use crate::ui::image_viewer::{LocalMediaImage, MediaViewerHost};
use crate::ui::pierre_icon::pierre_icon;
use crate::ui::theme;
use crate::ui::theme::Appearance;
use crate::ui::theme::color::{oklch, over, to_oklch};
use crate::ui::theme::tokens::{Tokens, fade};

const DRAWER_INSET: f32 = 22.;
const DRAWER_OVERLAP: f32 = 17.;
const DRAWER_RADIUS: f32 = 18.;
const DRAWER_GLASS: f32 = 0.8;
const DRAWER_OUTLINE: f32 = 0.05;
const DRAWER_SHADE_HEIGHT: f32 = 10.;
const DRAWER_SHADE: f32 = 0.18;
const LIST_PADDING: f32 = 8.;
const LIST_MAX_HEIGHT: f32 = 288.;
const ITEM_MIN_HEIGHT: f32 = 28.;
const ITEM_PADDING_X: f32 = 8.;
const ITEM_PADDING_Y: f32 = 6.;
const ITEM_RADIUS: f32 = 6.;
const ITEM_GAP: f32 = 8.;
const ITEM_ICON: f32 = 16.;
const ITEM_TEXT: f32 = 12.;
const ITEM_LINE: f32 = 16.;
const LABEL_MAX_FRACTION: f32 = 0.45;
const BADGE_HEIGHT: f32 = 18.;
const BADGE_PADDING_X: f32 = 3.;
const BADGE_RADIUS: f32 = 6.;
const BADGE_FILL: f32 = 0.03;
const BADGE_ICON: f32 = 12.;
const BADGE_GAP: f32 = 4.;
const STATUS_PADDING_X: f32 = 20.;
const STATUS_PADDING_TOP: f32 = 14.;
const STATUS_PADDING_BOTTOM: f32 = 28.;
const CHIP_HEIGHT: f32 = 17.;
const CHIP_PADDING_X: f32 = 6.;
const CHIP_RADIUS: f32 = 6.;
const CHIP_GAP: f32 = 4.;
const CHIP_TEXT: f32 = 12.;
const CHIP_DETAIL_TEXT: f32 = 10.;
const CHIP_ICON: f32 = 14.;
const CHIP_FILL: f32 = 0.11;
const CHIP_BORDER_MIX: f32 = 0.34;
const CHIP_FOREGROUND_MIX: f32 = 0.22;
const CHIP_ACCENT_LIGHTNESS: f32 = 0.62;
const SHELF_PADDING_X: f32 = 16.;
const SHELF_GAP: f32 = 8.;
const SHELF_MARGIN_BOTTOM: f32 = 12.;
const THUMB_SIZE: f32 = 64.;
const THUMB_RADIUS: f32 = 10.;
const THUMB_BORDER: f32 = 0.8;
const REMOVE_SIZE: f32 = 24.;
const REMOVE_INSET: f32 = 4.;
const REMOVE_RADIUS: f32 = 8.;
const REMOVE_FILL: f32 = 0.65;
const REMOVE_ICON: f32 = 14.;
const SHELF_SCROLL_PADDING_BOTTOM: f32 = 4.;

type TokenMeta = Rc<RefCell<HashMap<String, ComposerTokenView>>>;
type Suffixes = Rc<RefCell<HashMap<String, String>>>;

pub struct ComposerInput {
    client: Entity<CoreClient>,
    editor: Entity<TextareaState>,
    view: Entity<ViewState<Option<ComposerInputView>>>,
    last_caret: Option<(String, usize)>,
    applied_edit: u64,
    pending_install: Option<String>,
    tokens: TokenMeta,
    suffixes: Suffixes,
    menu_scroll: ScrollHandle,
    scrolled_to: Option<String>,
    focus_seq: Option<u64>,
    last_footer: Option<serde_json::Value>,
    shelf_scroll: ScrollHandle,
    shelf_scrolled: RefCell<Option<String>>,
    reported_destinations: ReportedDestinations,
}

fn utf16_to_byte(text: &str, offset: usize) -> Option<usize> {
    let mut units = 0;
    for (index, character) in text.char_indices() {
        if units == offset {
            return Some(index);
        }
        units += character.len_utf16();
        if units > offset {
            return None;
        }
    }
    (units == offset).then_some(text.len())
}

fn token_range(text: &str, token: &ComposerTokenView) -> Option<std::ops::Range<usize>> {
    let start = utf16_to_byte(text, token.start)?;
    let end = utf16_to_byte(text, token.end)?;
    (text.get(start..end) == Some(token.text.as_str())).then_some(start..end)
}

fn inline_token(token: &ComposerTokenView) -> InlineToken {
    InlineToken::new(token.id.clone(), token.text.clone()).with_label(token.label.clone())
}

pub fn prompt_content(prompt: &str, tokens: &[ComposerTokenView]) -> InputContent {
    tokens.iter().fold(
        InputContent::new(prompt.to_string()),
        |content, token| match token_range(prompt, token) {
            Some(range) => content
                .clone()
                .with_token(range, inline_token(token))
                .unwrap_or(content),
            None => content,
        },
    )
}

pub fn static_token_renderer(
    tokens: &[ComposerTokenView],
) -> impl Fn(&InlineTokenContext, &mut Window, &mut App) -> AnyElement + 'static {
    let meta: TokenMeta = Rc::new(RefCell::new(
        tokens
            .iter()
            .map(|token| (token.id.clone(), token.clone()))
            .collect(),
    ));
    let suffixes: Suffixes = Rc::new(RefCell::new(HashMap::new()));
    move |token, _, cx| chip(token, &meta, &suffixes, cx)
}

fn act(client: &Entity<CoreClient>, action: &'static str, params: serde_json::Value, cx: &mut App) {
    client.update(cx, |client, _| client.act(action, params));
}

pub fn add_paths(client: &Entity<CoreClient>, paths: &[PathBuf], cx: &mut App) {
    let files: Vec<_> = paths
        .iter()
        .map(|path| json!({ "path": path.to_string_lossy(), "name": serde_json::Value::Null }))
        .collect();
    if !files.is_empty() {
        act(client, "composerAddFiles", json!({ "files": files }), cx);
    }
}

pub fn pick_files(client: &Entity<CoreClient>, cx: &mut App) {
    let receiver = cx.prompt_for_paths(PathPromptOptions {
        files: true,
        directories: false,
        multiple: true,
        prompt: None,
    });
    let client = client.clone();
    cx.spawn(async move |cx| {
        if let Ok(Ok(Some(paths))) = receiver.await {
            cx.update(|cx| add_paths(&client, &paths, cx));
        }
    })
    .detach();
}

pub fn paste(client: &Entity<CoreClient>, item: &ClipboardItem, cx: &mut App) -> bool {
    let mut files = Vec::new();
    for entry in item.entries() {
        match entry {
            ClipboardEntry::ExternalPaths(paths) => {
                for path in paths.paths() {
                    files.push(
                        json!({ "path": path.to_string_lossy(), "name": serde_json::Value::Null }),
                    );
                }
            }
            ClipboardEntry::Image(image) => {
                let extension = image.format.extension();
                let directory = std::env::temp_dir().join("local-studio-gpui-paste");
                let path = directory.join(format!("{}.{extension}", image.id));
                if std::fs::create_dir_all(&directory).is_ok()
                    && std::fs::write(&path, &image.bytes).is_ok()
                {
                    files.push(json!({
                        "path": path.to_string_lossy(),
                        "name": format!("image.{extension}"),
                    }));
                }
            }
            ClipboardEntry::String(_) => {}
        }
    }
    if files.is_empty() {
        return false;
    }
    act(client, "composerAddFiles", json!({ "files": files }), cx);
    true
}

fn mix_oklab(a: Rgba, b: Rgba, weight_of_a: f32) -> Rgba {
    let lab = |color: Rgba| {
        let (lightness, chroma, hue) = to_oklch(color);
        let (sin, cos) = hue.to_radians().sin_cos();
        (lightness, chroma * cos, chroma * sin)
    };
    let alpha = a.a * weight_of_a + b.a * (1. - weight_of_a);
    if alpha <= 0. {
        return Rgba { a: 0., ..a };
    }
    let (wa, wb) = (a.a * weight_of_a / alpha, b.a * (1. - weight_of_a) / alpha);
    let ((la, aa, ba), (lb, ab, bb)) = (lab(a), lab(b));
    let (x, y) = (aa * wa + ab * wb, ba * wa + bb * wb);
    let mixed = oklch(
        la * wa + lb * wb,
        (x * x + y * y).sqrt(),
        y.atan2(x).to_degrees().rem_euclid(360.),
    );
    Rgba { a: alpha, ..mixed }
}

fn chip_accent(kind: ComposerChipKind) -> Option<Rgba> {
    let (chroma, hue) = match kind {
        ComposerChipKind::Mention => (0.11, 215.),
        ComposerChipKind::Skill => (0.16, 322.),
        ComposerChipKind::Image => (0.16, 16.),
        ComposerChipKind::Video => (0.16, 48.),
        ComposerChipKind::File => (0.136, 237.),
        ComposerChipKind::Terminal => (0.134, 163.),
        ComposerChipKind::ReviewComment => (0.16, 292.),
        ComposerChipKind::PreviewAnnotation => (0.134, 70.),
        ComposerChipKind::PrOpen => (0.134, 163.),
        ComposerChipKind::PrDraft => (0.02, 259.),
        ComposerChipKind::PrMerged => (0.16, 292.),
        ComposerChipKind::PrClosed => (0.16, 16.),
        ComposerChipKind::PullRequest => (0.16, 277.),
        ComposerChipKind::Unresolved => return None,
    };
    Some(oklch(CHIP_ACCENT_LIGHTNESS, chroma, hue))
}

fn icon_element(icon: &ComposerIconView, size: f32, color: Rgba, cx: &App) -> AnyElement {
    match icon {
        ComposerIconView::Pierre { icon } => pierre_icon(icon, px(size), cx),
        ComposerIconView::Lucide { asset } => svg()
            .path(SharedString::from(asset.clone()))
            .flex_none()
            .size(px(size))
            .text_color(color)
            .into_any_element(),
        ComposerIconView::Image { path } => img(PathBuf::from(path))
            .flex_none()
            .size(px(size))
            .rounded(px(2.))
            .object_fit(ObjectFit::Cover)
            .into_any_element(),
        ComposerIconView::PullRequest { state } => {
            let (asset, tone) = pull_request_state_glyph(*state, cx);
            svg()
                .path(asset)
                .flex_none()
                .size(px(size))
                .text_color(tone)
                .into_any_element()
        }
    }
}

fn pull_request_state_glyph(state: PullRequestStateKey, cx: &App) -> (&'static str, Rgba) {
    let dark = theme::active(cx).appearance == Appearance::Dark;
    let tone = |dark_tone: (f32, f32, f32, f32), light_tone: (f32, f32, f32)| {
        if dark {
            fade(oklch(dark_tone.0, dark_tone.1, dark_tone.2), dark_tone.3)
        } else {
            oklch(light_tone.0, light_tone.1, light_tone.2)
        }
    };
    match state {
        PullRequestStateKey::Open => (
            "icons/git-pull-request-arrow.svg",
            tone((0.845, 0.143, 164.978, 0.9), (0.596, 0.145, 163.225)),
        ),
        PullRequestStateKey::Draft => (
            "icons/git-pull-request-draft.svg",
            tone((0.705, 0.015, 286.067, 0.8), (0.552, 0.016, 285.938)),
        ),
        PullRequestStateKey::Closed => (
            "icons/git-pull-request-closed.svg",
            tone((0.808, 0.114, 19.571, 0.9), (0.577, 0.245, 27.325)),
        ),
        PullRequestStateKey::Merged => (
            "icons/git-merge.svg",
            tone((0.811, 0.111, 293.571, 0.9), (0.541, 0.281, 293.009)),
        ),
    }
}

fn chip(token: &InlineTokenContext, meta: &TokenMeta, suffixes: &Suffixes, cx: &App) -> AnyElement {
    let t = theme::active(cx);
    let id = token.token().id().to_string();
    let meta = meta.borrow().get(&id).cloned();
    let kind = meta
        .as_ref()
        .map_or(ComposerChipKind::Unresolved, |meta| meta.chip);
    let (fill, border, foreground) = match chip_accent(kind) {
        Some(accent) => (
            fade(accent, CHIP_FILL),
            mix_oklab(accent, t.border, CHIP_BORDER_MIX),
            mix_oklab(accent, t.foreground, CHIP_FOREGROUND_MIX),
        ),
        None => (fade(t.accent, 0.4), fade(t.border, 0.7), t.foreground),
    };
    let detail = meta.as_ref().and_then(|meta| {
        let suffix = meta
            .attachment_id
            .as_ref()
            .and_then(|id| suffixes.borrow().get(id).cloned());
        match (meta.detail.clone(), suffix) {
            (Some(detail), Some(suffix)) => Some(format!("{detail} · {suffix}")),
            (detail, suffix) => detail.or(suffix),
        }
    });
    let selected = token.is_selected();
    div()
        .h(token.line_height())
        .flex()
        .items_center()
        .max_w(token.available_width())
        .child(
            div()
                .flex()
                .items_center()
                .min_w_0()
                .gap(px(CHIP_GAP))
                .h(px(CHIP_HEIGHT))
                .px(px(CHIP_PADDING_X))
                .rounded(px(CHIP_RADIUS))
                .border_1()
                .border_color(border)
                .bg(fill)
                .when(selected, |this| this.bg(over(fade(t.ring, 0.3), fill)))
                .text_size(px(CHIP_TEXT))
                .line_height(px(CHIP_HEIGHT))
                .font_weight(FontWeight::MEDIUM)
                .text_color(foreground)
                .when_some(
                    meta.as_ref().and_then(|meta| meta.icon.clone()),
                    |this, icon| this.child(icon_element(&icon, CHIP_ICON, foreground, cx)),
                )
                .child(
                    div()
                        .min_w_0()
                        .truncate()
                        .child(token.token().label().clone()),
                )
                .when_some(detail, |this, detail| {
                    this.child(
                        div()
                            .flex_none()
                            .text_size(px(CHIP_DETAIL_TEXT))
                            .child(SharedString::from(detail)),
                    )
                }),
        )
        .into_any_element()
}

impl ComposerInput {
    pub fn new(
        client: Entity<CoreClient>,
        editor: Entity<TextareaState>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let view = CoreClient::subscribe::<Option<ComposerInputView>>(
            &client,
            "composerInput",
            json!({}),
            cx,
        );
        cx.observe_in(&view, window, |this, _, window, cx| {
            this.on_view(window, cx)
        })
        .detach();
        cx.observe(&editor, |this, _, cx| this.sync_caret(cx))
            .detach();
        Self {
            client,
            editor,
            view,
            last_caret: None,
            applied_edit: 0,
            pending_install: None,
            tokens: Rc::new(RefCell::new(HashMap::new())),
            suffixes: Rc::new(RefCell::new(HashMap::new())),
            menu_scroll: ScrollHandle::new(),
            scrolled_to: None,
            focus_seq: None,
            last_footer: None,
            shelf_scroll: ScrollHandle::new(),
            shelf_scrolled: RefCell::new(None),
            reported_destinations: ReportedDestinations::default(),
        }
    }

    pub fn view<'a>(&self, cx: &'a App) -> Option<&'a ComposerInputView> {
        self.view.read(cx).data.as_ref().and_then(Option::as_ref)
    }

    pub fn report_footer(&mut self, measurement: serde_json::Value, cx: &mut Context<Self>) {
        if self.last_footer.as_ref() == Some(&measurement) {
            return;
        }
        self.last_footer = Some(measurement.clone());
        act(&self.client, "composerFooterMeasure", measurement, cx);
    }

    pub fn menu_open(&self, cx: &App) -> bool {
        self.view(cx).is_some_and(|view| view.menu.is_some())
    }

    pub fn menu_has_items(&self, cx: &App) -> bool {
        self.view(cx)
            .and_then(|view| view.menu.as_ref())
            .is_some_and(|menu| !menu.items.is_empty())
    }

    pub fn prompt_reset(&mut self, prompt: String, window: &mut Window, cx: &mut Context<Self>) {
        self.pending_install = Some(prompt);
        self.last_caret = None;
        if let Some(view) = self.view(cx).cloned() {
            self.install_tokens(&view, window, cx);
        }
    }

    fn install_tokens(
        &mut self,
        view: &ComposerInputView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(prompt) = self.pending_install.clone() else {
            return;
        };
        let current = self.editor.read(cx).value().to_string();
        if current != prompt {
            self.pending_install = None;
        } else if view.prompt == prompt {
            self.pending_install = None;
            if !view.tokens.is_empty() {
                let content = prompt_content(&prompt, &view.tokens);
                self.editor
                    .update(cx, |state, cx| state.set_value(content, window, cx));
            }
        }
    }

    pub fn token_renderer(
        &self,
    ) -> impl Fn(&InlineTokenContext, &mut Window, &mut App) -> AnyElement + 'static {
        let meta = self.tokens.clone();
        let suffixes = self.suffixes.clone();
        move |token, _, cx| chip(token, &meta, &suffixes, cx)
    }

    fn sync_caret(&mut self, cx: &mut Context<Self>) {
        let state = self.editor.read(cx);
        let text = state.value().to_string();
        let byte = state.cursor().min(text.len());
        let cursor = text
            .get(..byte)
            .map_or(0, |prefix| prefix.encode_utf16().count());
        if self
            .last_caret
            .as_ref()
            .is_some_and(|(last, at)| *last == text && *at == cursor)
        {
            return;
        }
        self.last_caret = Some((text.clone(), cursor));
        act(
            &self.client,
            "composerCaret",
            json!({ "text": text, "cursor": cursor }),
            cx,
        );
    }

    fn on_view(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(view) = self.view(cx).cloned() else {
            return;
        };
        {
            let mut tokens = self.tokens.borrow_mut();
            for token in view
                .tokens
                .iter()
                .chain(view.edit.iter().flat_map(|edit| edit.tokens.iter()))
            {
                tokens.insert(token.id.clone(), token.clone());
            }
        }
        *self.suffixes.borrow_mut() = view.upload_suffixes.clone();
        self.install_tokens(&view, window, cx);
        if self.focus_seq.is_some_and(|seen| view.focus_seq > seen) {
            self.editor.update(cx, |state, cx| state.focus(window, cx));
        }
        self.focus_seq = Some(view.focus_seq);
        if let Some(edit) = view
            .edit
            .as_ref()
            .filter(|edit| edit.seq > self.applied_edit)
        {
            self.applied_edit = edit.seq;
            self.apply_edit(edit, window, cx);
        }
        let active = view.menu.as_ref().and_then(|menu| {
            let index = menu
                .items
                .iter()
                .position(|item| Some(&item.id) == menu.active_item_id.as_ref())?;
            Some((index, menu.active_item_id.clone()))
        });
        if let Some((index, id)) = active
            && id != self.scrolled_to
        {
            self.menu_scroll.scroll_to_item(index);
            self.scrolled_to = id;
        }
        cx.notify();
    }

    fn apply_edit(&mut self, edit: &ComposerEditView, window: &mut Window, cx: &mut Context<Self>) {
        let value = self.editor.read(cx).value().to_string();
        let (Some(start), Some(end)) = (
            utf16_to_byte(&value, edit.range_start),
            utf16_to_byte(&value, edit.range_end),
        ) else {
            return;
        };
        if value.get(start..end) != Some(edit.expected_text.as_str()) {
            return;
        }
        let text = edit.text.clone();
        let tokens: Vec<_> = edit
            .tokens
            .iter()
            .filter_map(|token| {
                let range = token_range(&text, token)?;
                Some((start + range.start..start + range.end, inline_token(token)))
            })
            .collect();
        let focus = edit.focus;
        let caret = edit.caret;
        self.editor.update(cx, |state, cx| {
            state.set_selected_range(start..end, cx);
            state.replace(text.clone(), window, cx);
            for (range, token) in tokens {
                let _ = state.replace_range_with_token(range, token, window, cx);
            }
            let value = state.value().to_string();
            let caret = caret
                .and_then(|caret| utf16_to_byte(&value, caret))
                .unwrap_or(start + text.len());
            state.set_selected_range(caret..caret, cx);
            if focus {
                state.focus(window, cx);
            }
        });
        act(
            &self.client,
            "composerEditApplied",
            json!({ "seq": edit.seq }),
            cx,
        );
        let prompt = self.editor.read(cx).value().to_string();
        act(&self.client, "setPrompt", json!({ "prompt": prompt }), cx);
        self.sync_caret(cx);
        if let Some(action) = edit.follow_up_action.as_deref()
            && action == "openModelPicker"
        {
            act(&self.client, "openModelPicker", json!({}), cx);
        }
    }

    pub fn menu_drawer(&self, cx: &App) -> Option<AnyElement> {
        let menu = self.view(cx)?.menu.clone()?;
        let t = theme::active(cx);
        let outline = fade(gpui::white().into(), DRAWER_OUTLINE);
        let surface = over(fade(t.surface_raised, DRAWER_GLASS), t.background);
        let body = if menu.items.is_empty() {
            div()
                .px(px(STATUS_PADDING_X))
                .pt(px(STATUS_PADDING_TOP))
                .pb(px(STATUS_PADDING_BOTTOM))
                .text_size(px(ITEM_TEXT))
                .line_height(px(ITEM_LINE))
                .text_color(t.secondary_label)
                .child(SharedString::from(
                    menu.status_text.clone().unwrap_or_default(),
                ))
                .into_any_element()
        } else {
            div()
                .id("composer-command-list")
                .max_h(px(LIST_MAX_HEIGHT))
                .overflow_y_scroll()
                .track_scroll(&self.menu_scroll)
                .p(px(LIST_PADDING))
                .children(
                    menu.items
                        .iter()
                        .map(|item| self.menu_item(&menu, item, &t, cx)),
                )
                .into_any_element()
        };
        Some(
            div()
                .absolute()
                .left(px(DRAWER_INSET))
                .right(px(DRAWER_INSET))
                .bottom(px(-DRAWER_OVERLAP))
                .flex()
                .flex_col()
                .pb(px(DRAWER_OVERLAP))
                .rounded_t(px(DRAWER_RADIUS))
                .border_t_1()
                .border_l_1()
                .border_r_1()
                .border_color(outline)
                .bg(surface)
                .shadow(vec![gpui::BoxShadow {
                    color: gpui::hsla(0., 0., 0., 0.75),
                    offset: gpui::point(px(0.), px(14.)),
                    blur_radius: px(32.),
                    spread_radius: px(-18.),
                    inset: false,
                }])
                .occlude()
                .child(body)
                .child(
                    div()
                        .absolute()
                        .left_0()
                        .right_0()
                        .bottom(px(DRAWER_OVERLAP))
                        .h(px(DRAWER_SHADE_HEIGHT))
                        .bg(linear_gradient(
                            0.,
                            linear_color_stop(gpui::hsla(0., 0., 0., DRAWER_SHADE), 0.),
                            linear_color_stop(gpui::hsla(0., 0., 0., 0.), 1.),
                        )),
                )
                .into_any_element(),
        )
    }

    fn menu_item(
        &self,
        menu: &ComposerMenuView,
        item: &ComposerMenuItemView,
        t: &Tokens,
        cx: &App,
    ) -> AnyElement {
        let active = menu.active_item_id.as_ref() == Some(&item.id);
        let hover_client = self.client.clone();
        let select_client = self.client.clone();
        let hover_id = item.id.clone();
        let select_id = item.id.clone();
        div()
            .id(SharedString::from(format!("composer-item-{}", item.id)))
            .flex()
            .items_center()
            .gap(px(ITEM_GAP))
            .min_h(px(ITEM_MIN_HEIGHT))
            .px(px(ITEM_PADDING_X))
            .py(px(ITEM_PADDING_Y))
            .rounded(px(ITEM_RADIUS))
            .cursor_pointer()
            .when(active, |this| this.bg(t.accent))
            .on_mouse_move(move |_, _, cx| {
                if !active {
                    act(
                        &hover_client,
                        "composerMenuHighlight",
                        json!({ "itemId": hover_id }),
                        cx,
                    );
                }
            })
            .on_mouse_down(gpui::MouseButton::Left, |_, window, _| {
                window.prevent_default();
            })
            .on_click(move |_, _, cx| {
                act(
                    &select_client,
                    "composerMenuSelect",
                    json!({ "itemId": select_id }),
                    cx,
                );
            })
            .when_some(item.icon.clone(), |this, icon| {
                this.child(icon_element(&icon, ITEM_ICON, t.icon_muted, cx))
            })
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .items_center()
                    .gap(px(ITEM_GAP))
                    .text_size(px(ITEM_TEXT))
                    .line_height(px(ITEM_LINE))
                    .child(
                        div()
                            .flex_none()
                            .min_w_0()
                            .max_w(gpui::relative(LABEL_MAX_FRACTION))
                            .truncate()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.foreground)
                            .when_some(item.label_prefix.clone(), |this, prefix| {
                                this.child(
                                    div()
                                        .flex_none()
                                        .text_color(t.secondary_label)
                                        .child(SharedString::from(prefix)),
                                )
                                .flex()
                            })
                            .child(SharedString::from(item.label.clone())),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_color(t.secondary_label)
                            .child(SharedString::from(item.description.clone())),
                    )
                    .when_some(item.badge.clone(), |this, badge| {
                        this.child(
                            div()
                                .flex()
                                .flex_none()
                                .items_center()
                                .gap(px(BADGE_GAP))
                                .h(px(BADGE_HEIGHT))
                                .px(px(BADGE_PADDING_X))
                                .rounded(px(BADGE_RADIUS))
                                .border_1()
                                .border_color(gpui::transparent_black())
                                .bg(fade(t.foreground, BADGE_FILL))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.foreground)
                                .child(
                                    svg()
                                        .path(SharedString::from(badge.asset))
                                        .flex_none()
                                        .size(px(BADGE_ICON))
                                        .text_color(t.foreground),
                                )
                                .child(SharedString::from(badge.label)),
                        )
                    }),
            )
            .into_any_element()
    }

    pub fn attachment_shelf(&self, cx: &App) -> Option<AnyElement> {
        let view = self.view(cx)?;
        let images = view.images.clone();
        let pending = view.pending_snap_shots.clone();
        let scrolls = view.snap_shot_shelf;
        if images.is_empty() && pending.is_empty() {
            return None;
        }
        let t = theme::active(cx);
        let arriving = images
            .iter()
            .enumerate()
            .filter(|(_, image)| image.animation_pending || image.animate_arrival)
            .map(|(index, image)| (index, image.id.clone()))
            .chain(
                pending
                    .iter()
                    .enumerate()
                    .map(|(index, id)| (images.len() + index, id.clone())),
            )
            .last();
        if let Some((index, id)) = arriving
            && self.shelf_scrolled.borrow().as_deref() != Some(id.as_str())
        {
            self.shelf_scroll.scroll_to_item(index);
            self.shelf_scrolled.replace(Some(id));
        }
        let cards = images
            .iter()
            .map(|image| match image.snap_shot {
                Some(_) => snap_shot_card(image, &self.client, &self.reported_destinations, &t),
                None => self.thumbnail(image, &t, cx),
            })
            .chain(
                pending
                    .iter()
                    .map(|id| pending_card(id, &self.client, &self.reported_destinations, &t)),
            )
            .collect::<Vec<_>>();
        Some(
            div()
                .id("composer-attachment-shelf")
                .flex()
                .gap(px(SHELF_GAP))
                .px(px(SHELF_PADDING_X))
                .mb(px(SHELF_MARGIN_BOTTOM))
                .map(|this| {
                    if scrolls {
                        this.max_w_full()
                            .overflow_x_scroll()
                            .track_scroll(&self.shelf_scroll)
                            .pb(px(SHELF_SCROLL_PADDING_BOTTOM))
                    } else {
                        this.flex_wrap()
                    }
                })
                .children(cards)
                .into_any_element(),
        )
    }

    fn thumbnail(&self, image: &ComposerImageView, t: &Tokens, cx: &App) -> AnyElement {
        let client = self.client.clone();
        let id = image.id.clone();
        let images = self.view(cx).map(|view| {
            view.images
                .iter()
                .filter_map(|candidate| {
                    candidate.path.as_ref().map(|path| LocalMediaImage {
                        name: candidate.name.clone(),
                        path: path.clone(),
                    })
                })
                .collect::<Vec<_>>()
        });
        let index = images.as_ref().and_then(|images| {
            images
                .iter()
                .position(|candidate| Some(&candidate.path) == image.path.as_ref())
        });
        div()
            .id(SharedString::from(format!("composer-image-{}", image.id)))
            .relative()
            .flex_none()
            .size(px(THUMB_SIZE))
            .overflow_hidden()
            .rounded(px(THUMB_RADIUS))
            .border_1()
            .border_color(fade(t.border, THUMB_BORDER))
            .bg(t.background)
            .when_some(image.path.clone(), |this, path| {
                this.cursor_pointer()
                    .on_click(move |_, _, cx| {
                        let Some(images) = images.clone() else {
                            return;
                        };
                        let Some(index) = index else {
                            return;
                        };
                        MediaViewerHost::open_local_images(cx, images, index);
                    })
                    .child(
                        img(PathBuf::from(path))
                            .size_full()
                            .object_fit(ObjectFit::Cover),
                    )
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
                    .cursor_pointer()
                    .on_click(move |_, _, cx| {
                        act(&client, "composerRemoveImage", json!({ "id": id }), cx);
                    })
                    .child(
                        svg()
                            .path("icons/x.svg")
                            .size(px(REMOVE_ICON))
                            .text_color(gpui::white()),
                    ),
            )
            .into_any_element()
    }
}
