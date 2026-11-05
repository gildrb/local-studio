use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::time::Duration;

use gpui::component::input::{
    Editor, EditorState, InputEvent, InputState, Position, TextDecoration, TextDecorationCollection,
};
use gpui::prelude::FluentBuilder;
use gpui::{
    Animation, AnimationExt, AnyElement, App, AppContext, Bounds, Context, Entity, FontStyle,
    FontWeight, HighlightStyle, InteractiveElement, IntoElement, KeyDownEvent, MouseButton,
    MouseDownEvent, ObjectFit, ParentElement, Pixels, Render, Rgba, ScrollStrategy, SharedString,
    StatefulInteractiveElement, Styled, StyledImage, Transformation, UniformListScrollHandle,
    Window, canvas, div, img, percentage, px, relative, rgb, uniform_list,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::open_in::OpenInView;
use crate::app_core::views::right_panel_diff::SyntaxToken;
use crate::app_core::views::right_panel_files::{
    FilesBody, FilesChrome, FilesCrumb, FilesCrumbKind, FilesCrumbMenu, FilesCrumbMenuContent,
    FilesEntryKind, FilesExplorerLayout, FilesExplorerView, FilesHeader, FilesHeaderActionId,
    FilesTreeRow, RightPanelFilesSourceView, RightPanelFilesView,
};
use crate::features::chat::chat_markdown::markdown_document;
use crate::features::chat::open_in_picker::OpenInPicker;
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::input::InputSize;
use crate::ui::input_group::{InputGroup, InputGroupVariant};
use crate::ui::menu::{MenuItem, MenuPopup, MenuRadioItem, MenuSeparator, icon};
use crate::ui::pierre_icon::pierre_icon;
use crate::ui::popover::{Align, Side};
use crate::ui::spinner::{Spinner, SpinnerSize};
use crate::ui::theme;
use crate::ui::theme::tokens::{Appearance, Tokens, fade};
use crate::ui::toggle::{Toggle, ToggleSize, ToggleVariant};
use crate::ui::tooltip::Tooltip;
use crate::ui::video_player::{VideoPlayer, VideoSurface};

const FILE_PREVIEW_PADDING: f32 = 16.;
const FILE_PREVIEW_VIDEO_MAX_WIDTH: f32 = 1024.;

const CHROME_HEIGHT: f32 = 36.;
const CHROME_MARGIN_BOTTOM: f32 = 4.;
const CHROME_PADDING_X: f32 = 8.;
const CHROME_GAP: f32 = 4.;
const SEARCH_HEIGHT: f32 = 28.;
const ICON_14: f32 = 14.;
const ICON_16: f32 = 16.;
const TEXT_XS: f32 = 12.;
const TEXT_XS_LINE: f32 = 16.;
const TEXT_2XS: f32 = 11.;
const TEXT_2XS_LINE: f32 = 16.;
const RELAXED_LINE: f32 = 19.5;
const TREE_INSET_X: f32 = 16.;
const ROW_HEIGHT: f32 = 24.;
const ROW_PADDING_X: f32 = 6.4;
const ROW_GAP: f32 = 4.8;
const ROW_RADIUS: f32 = 5.;
const ROW_INDENT: f32 = 18.7;
const INDENT_GUIDE_OFFSET: f32 = 7.5;
const CHEVRON_COLOR: u32 = 0x84848a;
const IGNORED_DARK: u32 = 0x4a4a4e;
const IGNORED_LIGHT: u32 = 0xadadb1;
const SUBHEADER_HEIGHT: f32 = 28.;
const SUBHEADER_PADDING_X: f32 = 12.;
const SUBHEADER_GAP: f32 = 8.;
const SUBHEADER_MARGIN_BOTTOM: f32 = 12.;
const CRUMB_MAX_WIDTH: f32 = 160.;
const CRUMB_PADDING_X: f32 = 2.;
const CRUMB_RADIUS: f32 = 6.;
const CRUMB_SEPARATOR_MARGIN: f32 = 4.;
const ASIDE_FRACTION: f32 = 0.46;
const ASIDE_MAX_WIDTH: f32 = 352.;
const ASIDE_MIN_WIDTH: f32 = 256.;
const CODE_PADDING_Y: f32 = 8.;
const MESSAGE_PADDING_X: f32 = 24.;
const NOTICE_PADDING_X: f32 = 12.;
const NOTICE_PADDING_Y: f32 = 6.;
const TABLE_CELL_PADDING_X: f32 = 12.;
const TABLE_CELL_PADDING_Y: f32 = 6.;
const TABLE_CELL_MAX: f32 = 320.;
const TABLE_CHAR_WIDTH: f32 = 6.6;
const MARKDOWN_MAX_WIDTH: f32 = 896.;
const MARKDOWN_PADDING_X: f32 = 24.;
const MARKDOWN_PADDING_Y: f32 = 20.;
const REFRESH_SPIN: Duration = Duration::from_millis(1000);

#[derive(Clone)]
struct Actions {
    client: Entity<CoreClient>,
}

impl Actions {
    fn send(&self, action: &'static str, params: Value, cx: &mut App) {
        self.client
            .update(cx, |client, _| client.act(action, params));
    }
}

pub struct FilesSurface {
    actions: Actions,
    state: Entity<ViewState<Option<RightPanelFilesView>>>,
    source: Entity<ViewState<Option<RightPanelFilesSourceView>>>,
    open_in: Entity<ViewState<OpenInView>>,
    tree_scroll: UniformListScrollHandle,
    handled_scroll: Option<u64>,
    tree_hovered: bool,
    search: Option<Entity<InputState>>,
    last_query: String,
    editor: Option<Entity<EditorState>>,
    editor_key: Option<String>,
    editor_editable: bool,
    editor_revision: u64,
    editor_appearance: Option<Appearance>,
    decorations: Option<TextDecorationCollection>,
    source_dirty: bool,
    handled_reveal: Option<(String, u64)>,
    crumb_bounds: Rc<RefCell<HashMap<String, Bounds<Pixels>>>>,
}

impl FilesSurface {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let state = CoreClient::subscribe::<Option<RightPanelFilesView>>(
            &client,
            "rightPanelFiles",
            json!({}),
            cx,
        );
        cx.observe(&state, |_, _, cx| cx.notify()).detach();
        let source = CoreClient::subscribe::<Option<RightPanelFilesSourceView>>(
            &client,
            "rightPanelFilesSource",
            json!({}),
            cx,
        );
        cx.observe(&source, |surface, _, cx| {
            surface.source_dirty = true;
            cx.notify();
        })
        .detach();
        let open_in = CoreClient::subscribe::<OpenInView>(&client, "openIn", json!({}), cx);
        cx.observe(&open_in, |_, _, cx| cx.notify()).detach();
        Self {
            actions: Actions { client },
            state,
            source,
            open_in,
            tree_scroll: UniformListScrollHandle::new(),
            handled_scroll: None,
            tree_hovered: false,
            search: None,
            last_query: String::new(),
            editor: None,
            editor_key: None,
            editor_editable: false,
            editor_revision: 0,
            editor_appearance: None,
            decorations: None,
            source_dirty: false,
            handled_reveal: None,
            crumb_bounds: Rc::new(RefCell::new(HashMap::new())),
        }
    }

    fn ensure_search(
        &mut self,
        placeholder: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<InputState> {
        if let Some(search) = &self.search {
            return search.clone();
        }
        let placeholder = placeholder.to_string();
        let search = cx.new(|cx| InputState::new(window, cx).placeholder(placeholder));
        let actions = self.actions.clone();
        cx.subscribe_in(
            &search,
            window,
            move |surface, state: &Entity<InputState>, event: &InputEvent, _, cx| {
                if let InputEvent::Change = event {
                    let query = state.read(cx).value().to_string();
                    surface.last_query = query.clone();
                    actions.send("rightPanelFilesSetQuery", json!({ "query": query }), cx);
                }
            },
        )
        .detach();
        self.search = Some(search.clone());
        search
    }

    fn sync_search(&mut self, explorer: &FilesExplorerView, window: &mut Window, cx: &mut App) {
        let Some(search) = &self.search else {
            self.last_query = explorer.query.clone();
            return;
        };
        if explorer.query == self.last_query {
            return;
        }
        let cleared = explorer.query.is_empty() && !self.last_query.is_empty();
        self.last_query = explorer.query.clone();
        if cleared {
            search.update(cx, |state, cx| state.set_value("", window, cx));
        }
    }

    fn ensure_editor(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<EditorState> {
        if let Some(editor) = &self.editor {
            return editor.clone();
        }
        let editor = cx.new(|cx| {
            EditorState::new(window, cx)
                .line_number(true)
                .folding(false)
                .indent_guides(false)
        });
        let actions = self.actions.clone();
        cx.subscribe_in(
            &editor,
            window,
            move |surface, state: &Entity<EditorState>, event: &InputEvent, _, cx| {
                if let InputEvent::Change = event {
                    let Some(key) = surface.editor_key.clone() else {
                        return;
                    };
                    if !surface.editor_editable {
                        return;
                    }
                    surface.editor_revision += 1;
                    let contents = state.read(cx).value().to_string();
                    actions.send(
                        "rightPanelFilesChange",
                        json!({
                            "key": key,
                            "revision": surface.editor_revision,
                            "contents": contents,
                        }),
                        cx,
                    );
                }
            },
        )
        .detach();
        self.decorations = Some(editor.update(cx, |state, cx| {
            state.create_decorations_collection(Vec::new(), cx)
        }));
        self.editor = Some(editor.clone());
        editor
    }

    fn sync_source(&mut self, t: &Tokens, window: &mut Window, cx: &mut Context<Self>) {
        let appearance_changed = self.editor_appearance != Some(t.appearance);
        if !self.source_dirty && !appearance_changed {
            return;
        }
        self.source_dirty = false;
        let Some(view) = self.source.read(cx).data.clone().flatten() else {
            return;
        };
        let editor = self.ensure_editor(window, cx);
        self.editor_appearance = Some(t.appearance);
        let fresh = self.editor_key.as_deref() != Some(view.key.as_str());
        let editable = view.editable;
        if fresh {
            self.editor_key = Some(view.key.clone());
            self.editor_revision = view.revision;
            self.handled_reveal = None;
            editor.update(cx, |state, cx| {
                state.set_value(view.contents.clone(), window, cx);
            });
        } else if view.revision >= self.editor_revision
            && editor.read(cx).value().as_ref() != view.contents.as_str()
        {
            self.editor_revision = view.revision;
            editor.update(cx, |state, cx| {
                state.set_value(view.contents.clone(), window, cx);
            });
        }
        self.editor_editable = editable;
        let wrap = view.word_wrap;
        editor.update(cx, |state, cx| state.set_soft_wrap(wrap, window, cx));
        if editor.read(cx).value().as_ref() == view.contents.as_str()
            && let (Some(collection), Some(lines)) = (&self.decorations, &view.lines)
        {
            collection.set(decorations(&view.contents, lines, t.appearance), cx);
        }
        if let Some(reveal) = &view.reveal {
            let handled = (view.key.clone(), reveal.request_id);
            if self.handled_reveal.as_ref() != Some(&handled) {
                self.handled_reveal = Some(handled);
                let line = reveal.line.saturating_sub(1);
                editor.update(cx, |state, cx| {
                    state.set_cursor_position(Position { line, character: 0 }, window, cx);
                });
            }
        }
    }
}

fn token_color(token: &SyntaxToken, appearance: Appearance) -> Option<Rgba> {
    let value = match appearance {
        Appearance::Dark => token.dark.as_deref(),
        Appearance::Light => token.light.as_deref(),
    }?;
    Rgba::try_from(value).ok()
}

fn decorations(
    contents: &str,
    lines: &[Vec<SyntaxToken>],
    appearance: Appearance,
) -> Vec<TextDecoration> {
    let mut result = Vec::new();
    let mut offset = 0;
    for (index, line) in contents.split('\n').enumerate() {
        if let Some(tokens) = lines.get(index) {
            let mut position = 0;
            for token in tokens {
                let end = (position + token.text.len()).min(line.len());
                let style = token.font_style.unwrap_or(0);
                if end > position
                    && line.is_char_boundary(position)
                    && line.is_char_boundary(end)
                    && let Some(color) = token_color(token, appearance)
                {
                    result.push(TextDecoration::new(
                        offset + position..offset + end,
                        HighlightStyle {
                            color: Some(color.into()),
                            font_style: (style & 1 != 0).then_some(FontStyle::Italic),
                            font_weight: (style & 2 != 0).then_some(FontWeight::BOLD),
                            ..HighlightStyle::default()
                        },
                    ));
                }
                position = end;
            }
        }
        offset += line.len() + 1;
    }
    result
}

fn ignored_color(t: &Tokens) -> Rgba {
    rgb(match t.appearance {
        Appearance::Dark => IGNORED_DARK,
        Appearance::Light => IGNORED_LIGHT,
    })
}

fn tooltip_wrap(id: impl Into<SharedString>, label: &str) -> gpui::Stateful<gpui::Div> {
    div()
        .id(gpui::ElementId::Name(id.into()))
        .flex_none()
        .tooltip(Tooltip::text(label.to_string()))
}

fn tree_row(
    index: usize,
    row: &FilesTreeRow,
    actions: &Actions,
    hovered: bool,
    t: &Tokens,
    cx: &App,
) -> AnyElement {
    let selected = row.selected;
    let text_color = if row.ignored {
        ignored_color(t)
    } else {
        t.foreground
    };
    let leading = match (row.kind, &row.icon) {
        (FilesEntryKind::Directory, _) => icon(
            if row.expanded {
                "chevron-down"
            } else {
                "chevron-right"
            },
            ICON_16,
            if selected {
                t.foreground
            } else {
                rgb(CHEVRON_COLOR)
            },
        )
        .flex_none()
        .into_any_element(),
        (FilesEntryKind::File, Some(file_icon)) => pierre_icon(file_icon, px(ICON_16), cx),
        (FilesEntryKind::File, None) => icon("file", ICON_16, t.icon_muted)
            .flex_none()
            .into_any_element(),
    };
    let guides = (hovered && row.depth > 0).then(|| {
        (0..row.depth).map(|level| {
            div()
                .absolute()
                .top_0()
                .bottom_0()
                .left(px(ROW_PADDING_X
                    + level as f32 * ROW_INDENT
                    + INDENT_GUIDE_OFFSET))
                .w(px(1.))
                .bg(fade(rgb(CHEVRON_COLOR), 0.25 * 0.75))
        })
    });
    let click_path = row.path.clone();
    let menu_path = row.path.clone();
    let click_actions = actions.clone();
    let menu_actions = actions.clone();
    div()
        .id(("files-tree-row", index))
        .relative()
        .flex()
        .items_center()
        .gap(px(ROW_GAP))
        .h(px(ROW_HEIGHT))
        .px(px(ROW_PADDING_X))
        .rounded(px(ROW_RADIUS))
        .cursor_pointer()
        .text_size(px(TEXT_XS))
        .line_height(px(ROW_HEIGHT))
        .text_color(text_color)
        .when(selected, |this| this.bg(fade(t.foreground, 0.12)))
        .when(!selected, |this| {
            this.hover(|style| style.bg(fade(t.foreground, 0.07)))
        })
        .children(guides.into_iter().flatten())
        .when(row.depth > 0, |this| {
            this.child(
                div()
                    .flex_none()
                    .w(px(row.depth as f32 * ROW_INDENT - ROW_GAP)),
            )
        })
        .child(leading)
        .child(
            div()
                .flex_1()
                .min_w_0()
                .truncate()
                .child(SharedString::from(row.name.clone())),
        )
        .on_click(move |_, _, cx| {
            click_actions.send(
                "rightPanelFilesActivateRow",
                json!({ "path": click_path }),
                cx,
            )
        })
        .on_mouse_down(MouseButton::Right, move |event: &MouseDownEvent, _, cx| {
            cx.stop_propagation();
            menu_actions.send(
                "rightPanelFilesRowContextMenu",
                json!({
                    "path": menu_path,
                    "x": f32::from(event.position.x),
                    "y": f32::from(event.position.y),
                }),
                cx,
            );
        })
        .into_any_element()
}

impl FilesSurface {
    fn chrome_bar(
        &mut self,
        chrome: &FilesChrome,
        t: &Tokens,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let search = self.ensure_search(&chrome.search.placeholder, window, cx);
        let refresh_glyph = icon("refresh-cw", ICON_14, t.muted_foreground);
        let refresh_glyph = if chrome.refresh.refreshing {
            refresh_glyph
                .with_animation(
                    "files-refresh-spin",
                    Animation::new(REFRESH_SPIN).repeat(),
                    |svg, delta| svg.with_transformation(Transformation::rotate(percentage(delta))),
                )
                .into_any_element()
        } else {
            refresh_glyph.into_any_element()
        };
        let refresh_actions = self.actions.clone();
        let escape_actions = self.actions.clone();
        let escape_search = search.clone();
        let toggle_all = chrome.toggle_all.as_ref().map(|toggle| {
            let actions = self.actions.clone();
            let next = toggle.next_expanded;
            tooltip_wrap("files-toggle-all-tip", &toggle.label).child(
                Button::new("files-toggle-all")
                    .variant(ButtonVariant::Ghost)
                    .size(ButtonSize::IconXs)
                    .accessibility_label(toggle.label.clone())
                    .child(icon(&toggle.icon, ICON_14, t.muted_foreground))
                    .on_click(move |_, _, cx| {
                        actions.send("rightPanelFilesToggleAll", json!({ "expanded": next }), cx)
                    }),
            )
        });
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(CHROME_GAP))
            .h(px(CHROME_HEIGHT))
            .mb(px(CHROME_MARGIN_BOTTOM))
            .px(px(CHROME_PADDING_X))
            .bg(t.background)
            .child(
                tooltip_wrap("files-refresh-tip", &chrome.refresh.tooltip).child(
                    Button::new("files-refresh")
                        .variant(ButtonVariant::Ghost)
                        .size(ButtonSize::IconXs)
                        .accessibility_label(chrome.refresh.aria_label.clone())
                        .child(refresh_glyph)
                        .on_click(move |_, _, cx| {
                            refresh_actions.send("rightPanelFilesRefresh", json!({}), cx)
                        }),
                ),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .h(px(SEARCH_HEIGHT))
                    .on_key_down(move |event: &KeyDownEvent, window, cx| {
                        if event.keystroke.key != "escape" {
                            return;
                        }
                        cx.stop_propagation();
                        escape_search.update(cx, |state, cx| state.set_value("", window, cx));
                        window.blur(cx);
                        escape_actions.send("rightPanelFilesSetQuery", json!({ "query": "" }), cx);
                    })
                    .child(
                        InputGroup::input(&search)
                            .variant(InputGroupVariant::Ghost)
                            .size(InputSize::Sm)
                            .h(px(SEARCH_HEIGHT))
                            .w_full(),
                    ),
            )
            .children(toggle_all)
            .into_any_element()
    }

    fn explorer(
        &mut self,
        explorer: &FilesExplorerView,
        t: &Tokens,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        self.sync_search(explorer, window, cx);
        if let Some(request) = &explorer.scroll_request
            && self.handled_scroll != Some(request.id)
            && let Some(index) = explorer
                .rows
                .iter()
                .position(|row| row.path == request.path)
        {
            self.handled_scroll = Some(request.id);
            self.tree_scroll
                .scroll_to_item(index, ScrollStrategy::Center);
        }
        let chrome = self.chrome_bar(&explorer.chrome, t, window, cx);
        let rows = Rc::new(explorer.rows.clone());
        let actions = self.actions.clone();
        let hovered = self.tree_hovered;
        let list = uniform_list("files-tree-rows", rows.len(), move |range, _, cx| {
            let t = theme::active(cx);
            range
                .filter_map(|index| {
                    rows.get(index)
                        .map(|row| tree_row(index, row, &actions, hovered, &t, cx))
                })
                .collect::<Vec<_>>()
        })
        .track_scroll(&self.tree_scroll)
        .size_full()
        .px(px(TREE_INSET_X));
        let refresh = self.actions.clone();
        let message = |text: &str, color: Rgba| {
            div()
                .flex_none()
                .px(px(NOTICE_PADDING_X))
                .py(px(4.))
                .text_size(px(TEXT_XS))
                .line_height(px(TEXT_XS_LINE))
                .text_color(color)
                .child(SharedString::from(text.to_string()))
        };
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .bg(t.background)
            .child(chrome)
            .when_some(explorer.chrome.error_text.clone(), |this, error| {
                this.child(
                    div()
                        .id("files-error")
                        .flex_none()
                        .p(px(16.))
                        .cursor_pointer()
                        .text_size(px(TEXT_XS))
                        .line_height(px(RELAXED_LINE))
                        .text_color(t.destructive_foreground)
                        .child(SharedString::from(error))
                        .on_click(move |_, _, cx| {
                            refresh.send("rightPanelFilesRefresh", json!({}), cx)
                        }),
                )
            })
            .when_some(explorer.chrome.truncated_text.as_deref(), |this, text| {
                this.child(message(text, t.muted_foreground))
            })
            .when_some(explorer.chrome.loading_text.as_deref(), |this, text| {
                this.child(message(text, t.muted_foreground))
            })
            .child(
                div()
                    .id("files-tree")
                    .flex_1()
                    .min_h_0()
                    .overflow_hidden()
                    .on_hover(cx.listener(|surface, hovered: &bool, _, cx| {
                        surface.tree_hovered = *hovered;
                        cx.notify();
                    }))
                    .child(list),
            )
            .into_any_element()
    }

    fn crumb(&self, crumb: &FilesCrumb, index: usize, t: &Tokens) -> AnyElement {
        let label = div()
            .max_w(px(CRUMB_MAX_WIDTH))
            .truncate()
            .child(SharedString::from(crumb.label.clone()));
        let body = if crumb.kind == FilesCrumbKind::File {
            div()
                .id(("files-crumb", index))
                .px(px(CRUMB_PADDING_X))
                .rounded(px(CRUMB_RADIUS))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.foreground)
                .tooltip(Tooltip::text(crumb.tooltip.clone()))
                .child(label)
                .into_any_element()
        } else if crumb.browsable {
            let actions = self.actions.clone();
            let path = crumb.path.clone();
            let open = crumb.open;
            let bounds = self.crumb_bounds.clone();
            let key = crumb.path.clone();
            div()
                .id(("files-crumb", index))
                .relative()
                .px(px(CRUMB_PADDING_X))
                .rounded(px(CRUMB_RADIUS))
                .cursor_pointer()
                .text_color(t.muted_foreground)
                .when(open, |this| this.bg(t.accent).text_color(t.foreground))
                .hover(|style| style.bg(t.accent).text_color(t.foreground))
                .tooltip(Tooltip::text(crumb.tooltip.clone()))
                .child(label)
                .child(
                    canvas(
                        move |measured, _, _| {
                            bounds.borrow_mut().insert(key.clone(), measured);
                        },
                        |_, _, _, _| {},
                    )
                    .absolute()
                    .size_full(),
                )
                .on_click(move |_, _, cx| {
                    let target = if open { Value::Null } else { json!(path) };
                    actions.send("rightPanelFilesCrumbMenu", json!({ "path": target }), cx);
                })
                .into_any_element()
        } else {
            div()
                .id(("files-crumb", index))
                .px(px(CRUMB_PADDING_X))
                .text_color(t.muted_foreground)
                .tooltip(Tooltip::text(crumb.tooltip.clone()))
                .child(label)
                .into_any_element()
        };
        div()
            .flex()
            .flex_none()
            .min_w_0()
            .items_center()
            .when(index > 0, |this| {
                this.child(
                    icon("chevron-right", ICON_14, fade(t.muted_foreground, 0.6))
                        .flex_none()
                        .mx(px(CRUMB_SEPARATOR_MARGIN)),
                )
            })
            .child(body)
            .into_any_element()
    }

    fn crumb_menu(&self, menu: &FilesCrumbMenu, t: &Tokens, cx: &App) -> Option<AnyElement> {
        let bounds = *self.crumb_bounds.borrow().get(&menu.crumb_path)?;
        let actions = &self.actions;
        let mut children: Vec<AnyElement> = Vec::new();
        if let Some(back) = &menu.back {
            let actions = actions.clone();
            let path = back.path.clone();
            children.push(
                MenuItem::new("files-crumb-back")
                    .child(icon("arrow-left", ICON_16, t.muted_foreground))
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .child(SharedString::from(back.label.clone())),
                    )
                    .on_click(move |_, _, cx| {
                        actions.send(
                            "rightPanelFilesCrumbMenuNavigate",
                            json!({ "path": path }),
                            cx,
                        )
                    })
                    .into_any_element(),
            );
            children.push(MenuSeparator::new().into_any_element());
        }
        let retry = |id: &'static str, label: &str, refreshing: bool| {
            let actions = actions.clone();
            let glyph = icon("refresh-cw", ICON_16, t.muted_foreground);
            let glyph = if refreshing {
                glyph
                    .with_animation(
                        SharedString::from(format!("{id}-spin")),
                        Animation::new(REFRESH_SPIN).repeat(),
                        |svg, delta| {
                            svg.with_transformation(Transformation::rotate(percentage(delta)))
                        },
                    )
                    .into_any_element()
            } else {
                glyph.into_any_element()
            };
            MenuItem::new(id)
                .child(glyph)
                .child(
                    div()
                        .min_w_0()
                        .flex_1()
                        .truncate()
                        .child(SharedString::from(label.to_string())),
                )
                .on_click(move |_, _, cx| {
                    actions.send("rightPanelFilesCrumbMenuRetry", json!({}), cx)
                })
                .into_any_element()
        };
        match &menu.content {
            FilesCrumbMenuContent::Loading { label } => children.push(
                MenuItem::new("files-crumb-loading")
                    .disabled(true)
                    .child(Spinner::new("files-crumb-spinner").size(SpinnerSize::Sm))
                    .child(SharedString::from(label.clone()))
                    .into_any_element(),
            ),
            FilesCrumbMenuContent::Retry { label, refreshing } => {
                children.push(retry("files-crumb-retry", label, *refreshing))
            }
            FilesCrumbMenuContent::Notice { label } => children.push(
                MenuItem::new("files-crumb-notice")
                    .disabled(true)
                    .label(label.clone())
                    .into_any_element(),
            ),
            FilesCrumbMenuContent::Items { items } => {
                for (index, item) in items.iter().enumerate() {
                    let leading = match &item.icon {
                        Some(file_icon) => pierre_icon(file_icon, px(ICON_16), cx),
                        None => icon("folder", ICON_16, t.icon_muted).into_any_element(),
                    };
                    let label = div()
                        .min_w_0()
                        .flex_1()
                        .truncate()
                        .when(item.ignored, |this| this.text_color(t.muted_foreground))
                        .child(SharedString::from(item.label.clone()));
                    let actions = actions.clone();
                    let path = item.path.clone();
                    let element = match item.kind {
                        FilesEntryKind::Directory => MenuItem::new(("files-crumb-item", index))
                            .child(leading)
                            .child(label)
                            .child(icon("chevron-right", ICON_16, t.muted_foreground))
                            .on_click(move |_, _, cx| {
                                actions.send(
                                    "rightPanelFilesCrumbMenuNavigate",
                                    json!({ "path": path }),
                                    cx,
                                )
                            })
                            .into_any_element(),
                        FilesEntryKind::File => MenuRadioItem::new(("files-crumb-item", index))
                            .checked(item.current)
                            .child(
                                div()
                                    .flex()
                                    .min_w_0()
                                    .items_center()
                                    .gap(px(8.))
                                    .child(leading)
                                    .child(label),
                            )
                            .on_click(move |_, _, cx| {
                                actions.send(
                                    "rightPanelFilesCrumbMenu",
                                    json!({ "path": Value::Null }),
                                    cx,
                                );
                                actions.send(
                                    "rightPanelFilesOpenFile",
                                    json!({ "path": path }),
                                    cx,
                                );
                            })
                            .into_any_element(),
                    };
                    children.push(element);
                }
            }
        }
        if let Some(failed) = &menu.refresh_failed {
            children.push(MenuSeparator::new().into_any_element());
            children.push(retry(
                "files-crumb-refresh-failed",
                &failed.label,
                failed.refreshing,
            ));
        }
        if let Some(notice) = &menu.truncated_notice {
            children.push(MenuSeparator::new().into_any_element());
            children.push(
                MenuItem::new("files-crumb-truncated")
                    .disabled(true)
                    .label(notice.clone())
                    .into_any_element(),
            );
        }
        let dismiss = actions.clone();
        Some(
            MenuPopup::new("files-crumb-menu", bounds)
                .side(Side::Bottom)
                .align(Align::Start)
                .on_dismiss(move |window, cx| {
                    if !bounds.contains(&window.mouse_position()) {
                        dismiss.send(
                            "rightPanelFilesCrumbMenu",
                            json!({ "path": Value::Null }),
                            cx,
                        );
                    }
                })
                .children(children)
                .into_any_element(),
        )
    }

    fn subheader(&self, header: &FilesHeader, t: &Tokens, cx: &App) -> AnyElement {
        let crumbs = header
            .crumbs
            .iter()
            .enumerate()
            .map(|(index, crumb)| self.crumb(crumb, index, t))
            .collect::<Vec<_>>();
        let picker = header.open_in_path.as_ref().and_then(|path| {
            let picker = self.open_in.read(cx).data.as_ref()?.picker.clone()?;
            Some(
                OpenInPicker::new(&picker, self.actions.client.clone())
                    .compact(true)
                    .target("files-open-in", path.clone()),
            )
        });
        let actions = header.actions.iter().map(|action| {
            let id = match action.id {
                FilesHeaderActionId::Rendered => "rendered",
                FilesHeaderActionId::WordWrap => "word-wrap",
                FilesHeaderActionId::Explorer => "explorer",
            };
            let glyph = match action.icon.as_str() {
                "code" => "code-xml",
                "table" => "table-2",
                "eye" => "eye",
                "wrap-text" => "text-wrap",
                _ => "folder-tree",
            };
            let sender = self.actions.clone();
            tooltip_wrap(format!("files-action-{id}-tip"), &action.label).child(
                Toggle::new(SharedString::from(format!("files-action-{id}")))
                    .variant(ToggleVariant::Ghost)
                    .size(ToggleSize::Sm)
                    .pressed(action.pressed)
                    .accessibility_label(action.label.clone())
                    .child(icon(glyph, ICON_14, t.foreground))
                    .on_change(move |_, _, _, cx| {
                        sender.send("rightPanelFilesHeaderAction", json!({ "id": id }), cx)
                    }),
            )
        });
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(SUBHEADER_GAP))
            .h(px(SUBHEADER_HEIGHT))
            .mb(px(SUBHEADER_MARGIN_BOTTOM))
            .px(px(SUBHEADER_PADDING_X))
            .bg(t.background)
            .child(
                div()
                    .id("files-breadcrumbs")
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .overflow_x_scroll()
                    .child(
                        div()
                            .flex()
                            .h_full()
                            .items_center()
                            .text_size(px(TEXT_XS))
                            .line_height(px(TEXT_XS_LINE))
                            .children(crumbs),
                    ),
            )
            .children(picker)
            .children(actions)
            .into_any_element()
    }

    fn body(
        &mut self,
        view: &RightPanelFilesView,
        t: &Tokens,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let centered = |child: AnyElement| {
            div()
                .flex()
                .flex_1()
                .min_h_0()
                .items_center()
                .justify_center()
                .px(px(MESSAGE_PADDING_X))
                .child(child)
                .into_any_element()
        };
        let message = |text: &str, color: Rgba| {
            div()
                .text_center()
                .text_size(px(TEXT_XS))
                .line_height(px(RELAXED_LINE))
                .text_color(color)
                .child(SharedString::from(text.to_string()))
                .into_any_element()
        };
        match &view.body {
            FilesBody::None => div().into_any_element(),
            FilesBody::Loading => centered(
                div()
                    .text_color(t.muted_foreground)
                    .child(Spinner::new("files-loading").size(SpinnerSize::Lg))
                    .into_any_element(),
            ),
            FilesBody::Error { message: text } => centered(message(text, t.destructive_foreground)),
            FilesBody::Unsupported { message: text } => centered(message(text, t.muted_foreground)),
            FilesBody::Image { src, failed, .. } => {
                if *failed {
                    centered(message(
                        "Unable to load workspace image.",
                        t.destructive_foreground,
                    ))
                } else {
                    match src.as_deref() {
                        Some(url) => centered(
                            div()
                                .flex()
                                .max_h_full()
                                .max_w_full()
                                .p(px(FILE_PREVIEW_PADDING))
                                .child(
                                    img(SharedString::from(url))
                                        .max_h_full()
                                        .max_w_full()
                                        .object_fit(ObjectFit::Contain),
                                )
                                .into_any_element(),
                        ),
                        None => centered(
                            div()
                                .text_color(t.muted_foreground)
                                .child(Spinner::new("files-image-loading").size(SpinnerSize::Lg))
                                .into_any_element(),
                        ),
                    }
                }
            }
            FilesBody::Video { video } => centered(
                div()
                    .w_full()
                    .max_w(px(FILE_PREVIEW_VIDEO_MAX_WIDTH))
                    .p(px(FILE_PREVIEW_PADDING))
                    .child(VideoPlayer::keyed(
                        "files-video-player",
                        &self.actions.client,
                        video,
                        VideoSurface::Inline {
                            max_width: None,
                            border_alpha: 0.6,
                        },
                        false,
                        window,
                        cx,
                    ))
                    .into_any_element(),
            ),
            FilesBody::Markdown { document } => div()
                .id("files-markdown")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .child(
                    div()
                        .mx_auto()
                        .w_full()
                        .max_w(px(MARKDOWN_MAX_WIDTH))
                        .px(px(MARKDOWN_PADDING_X))
                        .py(px(MARKDOWN_PADDING_Y))
                        .child(markdown_document(
                            "files-markdown-doc",
                            document,
                            t.foreground,
                            &self.actions.client,
                            t,
                            window,
                            cx,
                        )),
                )
                .into_any_element(),
            FilesBody::Table {
                header,
                rows,
                truncated_notice,
                ..
            } => table(header.as_deref(), rows, truncated_notice.as_deref(), t),
            FilesBody::Text => {
                self.sync_source(t, window, cx);
                match &self.editor {
                    Some(editor) => div()
                        .flex()
                        .flex_1()
                        .min_h_0()
                        .min_w_0()
                        .pt(px(CODE_PADDING_Y))
                        .bg(t.code_background)
                        .font_family(MONO_FONT)
                        .text_size(px(t.code_font_size))
                        .line_height(px(t.diff_line_height))
                        .child(
                            Editor::new(editor)
                                .appearance(false)
                                .readonly(!self.editor_editable)
                                .size_full()
                                .text_size(px(t.code_font_size))
                                .line_height(px(t.diff_line_height)),
                        )
                        .into_any_element(),
                    None => centered(
                        div()
                            .text_color(t.muted_foreground)
                            .child(Spinner::new("files-source-loading").size(SpinnerSize::Lg))
                            .into_any_element(),
                    ),
                }
            }
        }
    }
}

fn table(
    header: Option<&[String]>,
    rows: &[Vec<String>],
    truncated_notice: Option<&str>,
    t: &Tokens,
) -> AnyElement {
    let columns = header
        .map(<[String]>::len)
        .unwrap_or(0)
        .max(rows.iter().map(Vec::len).max().unwrap_or(0));
    let widths = (0..columns)
        .map(|column| {
            let longest = header
                .and_then(|cells| cells.get(column))
                .into_iter()
                .chain(rows.iter().filter_map(|row| row.get(column)))
                .map(|cell| {
                    cell.lines()
                        .map(|line| line.chars().count())
                        .max()
                        .unwrap_or(0)
                })
                .max()
                .unwrap_or(0);
            (longest as f32 * TABLE_CHAR_WIDTH + 2. * TABLE_CELL_PADDING_X).min(TABLE_CELL_MAX)
        })
        .collect::<Vec<_>>();
    let cell = |text: &str, width: f32| {
        div()
            .flex_none()
            .w(px(width))
            .px(px(TABLE_CELL_PADDING_X))
            .py(px(TABLE_CELL_PADDING_Y))
            .child(SharedString::from(text.to_string()))
    };
    let header_row =
        header.map(|cells| {
            div()
                .flex()
                .min_w(relative(1.))
                .border_b_1()
                .border_color(t.border)
                .bg(fade(t.muted, 0.6))
                .font_weight(FontWeight::MEDIUM)
                .children(widths.iter().enumerate().map(|(index, width)| {
                    cell(cells.get(index).map_or("", String::as_str), *width)
                }))
        });
    let body_rows = rows.iter().enumerate().map(|(row_index, row)| {
        div()
            .flex()
            .min_w(relative(1.))
            .border_b_1()
            .border_color(fade(t.border, 0.6))
            .when(row_index % 2 == 1, |this| this.bg(fade(t.muted, 0.3)))
            .children(
                widths
                    .iter()
                    .enumerate()
                    .map(|(index, width)| cell(row.get(index).map_or("", String::as_str), *width)),
            )
    });
    div()
        .flex()
        .flex_col()
        .flex_1()
        .min_h_0()
        .when_some(truncated_notice, |this, notice| {
            this.child(
                div()
                    .flex_none()
                    .border_b_1()
                    .border_color(fade(t.warning, 0.2))
                    .bg(t.warning_surface)
                    .px(px(NOTICE_PADDING_X))
                    .py(px(NOTICE_PADDING_Y))
                    .text_size(px(TEXT_2XS))
                    .line_height(px(TEXT_2XS_LINE))
                    .text_color(t.warning_foreground)
                    .child(SharedString::from(notice.to_string())),
            )
        })
        .child(
            div()
                .id("files-table")
                .flex_1()
                .min_h_0()
                .overflow_scroll()
                .text_size(px(TEXT_XS))
                .line_height(px(TEXT_XS_LINE))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .children(header_row)
                        .children(body_rows),
                ),
        )
        .into_any_element()
}

impl Render for FilesSurface {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = theme::active(cx);
        let root = div()
            .size_full()
            .flex()
            .flex_col()
            .min_h_0()
            .overflow_hidden()
            .bg(t.background);
        let Some(view) = self.state.read(cx).data.clone().flatten() else {
            return root;
        };
        let header = view
            .header
            .as_ref()
            .map(|header| self.subheader(header, &t, cx));
        let crumb_menu = view
            .header
            .as_ref()
            .and_then(|header| header.crumb_menu.as_ref())
            .and_then(|menu| self.crumb_menu(menu, &t, cx));
        let notice = view.notice.clone().map(|notice| {
            div()
                .flex_none()
                .border_b_1()
                .border_color(fade(t.warning, 0.2))
                .bg(t.warning_surface)
                .px(px(NOTICE_PADDING_X))
                .py(px(NOTICE_PADDING_Y))
                .text_size(px(TEXT_2XS))
                .line_height(px(TEXT_2XS_LINE))
                .text_color(t.warning_foreground)
                .child(SharedString::from(notice))
        });
        let preview = view.preview_visible.then(|| {
            div()
                .flex()
                .flex_col()
                .flex_1()
                .min_w_0()
                .min_h_0()
                .overflow_hidden()
                .child(self.body(&view, &t, window, cx))
        });
        let explorer = view.explorer.as_ref().map(|explorer| {
            let content = self.explorer(explorer, &t, window, cx);
            match explorer.layout {
                FilesExplorerLayout::Full => {
                    div().flex().flex_1().min_w_0().min_h_0().child(content)
                }
                FilesExplorerLayout::Aside => div()
                    .flex()
                    .flex_none()
                    .min_h_0()
                    .w(relative(ASIDE_FRACTION))
                    .max_w(px(ASIDE_MAX_WIDTH))
                    .min_w(px(ASIDE_MIN_WIDTH))
                    .border_l_1()
                    .border_color(fade(t.border, 0.6))
                    .bg(t.background)
                    .child(content),
            }
        });
        root.children(header)
            .children(notice)
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .overflow_hidden()
                    .children(preview)
                    .children(explorer),
            )
            .children(crumb_menu)
    }
}
