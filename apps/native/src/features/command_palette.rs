use std::collections::HashSet;

use gpui::component::input::{Backspace, Escape, InputEvent, InputState, MoveDown, MoveUp};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, Context, Div, Entity, FocusHandle, FontWeight, Global,
    InteractiveElement, IntoElement, KeyBinding, ParentElement, Render, Rgba, ScrollHandle,
    SharedString, StatefulInteractiveElement, Styled, Window, div, img, px, rgb, svg,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::command_palette::{
    CommandPaletteBindingView, CommandPaletteView, InputAddon, MatchSource, PaletteAccessoryView,
    PaletteContentMatchView, PaletteIconView, PaletteRowKind, PaletteRowView, PaletteSubtitleView,
    PaletteThreadStatusView, ShortcutScope,
};
use crate::app_core::views::sidebar::EnvironmentMachineKind;
use crate::features::chat::provider_instance_icon::ProviderInstanceIcon;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::checkbox::Checkbox;
use crate::ui::command::{
    CommandDialogPopup, CommandFooter, CommandFooterAction, CommandFooterHint, CommandGroupLabel,
    FooterKey, ICON_SIZE, INPUT_HEIGHT, INPUT_ROW_PADDING_Y, INPUT_TEXT_INSET, ITEM_GAP,
    ITEM_MIN_HEIGHT, ITEM_PADDING_X, ITEM_PADDING_Y, LIST_PADDING, SEARCH_ICON_INSET,
    command_panel, footer_hints, shortcut,
};
use crate::ui::input::bare_input;
use crate::ui::kbd::Kbd;
use crate::ui::menu::icon;
use crate::ui::project_favicon::ProjectFavicon;
use crate::ui::theme::metrics::{radius, text, workspace};
use crate::ui::theme::tokens::{Appearance, Tokens, fade};
use crate::ui::theme::{self, tabular};

#[derive(Clone, Debug, PartialEq, gpui::Action)]
#[action(namespace = command_palette, no_json)]
pub struct PaletteShortcut {
    pub command: String,
}

const PANEL_MAX_HEIGHT: f32 = 448.;
const PANEL_MAX_VIEWPORT: f32 = 0.7;
const GROUP_GAP: f32 = 6.;
const TITLE_GAP: f32 = 6.;
const META_GAP: f32 = 4.;
const META_ICON: f32 = 12.;
const META_OPACITY: f32 = 0.7;
const META_DOT_OPACITY: f32 = 0.5;
const MATCH_OPACITY: f32 = 0.85;
const TIMESTAMP_MIN_WIDTH: f32 = 48.;
const ADDON_OPACITY: f32 = 0.8;
const EMPTY_PADDING_Y: f32 = 40.;
const DISABLED_OPACITY: f32 = 0.64;
const CHEVRON_PULL: f32 = 2.;
const STATUS_DOT: f32 = 6.;
const STATUS_TEXT: f32 = 10.;
const STATUS_LINE: f32 = 14.;
const REMOTE_OPACITY: f32 = 0.6;
const PREVIEW_SIZE: f32 = 12.;
const PREVIEW_GAP: f32 = 4.;
const PREVIEW_GROUP_GAP: f32 = 8.;
const PREVIEW_RING_DARK: f32 = 0.14;
const PREVIEW_RING_LIGHT: f32 = 0.1;
const SUBMIT_INSET: f32 = 10.;
const SUBMIT_PADDING_END: f32 = 5.;
const HEADER_MIN_HEIGHT: f32 = 32.;
const PALETTE_KEY_CONTEXT: &str = "CommandPalette";
const OUTSIDE_TERMINAL_PREDICATE: &str = "!Terminal";

pub struct CommandPaletteHostHandle(Entity<CommandPaletteHost>);

impl Global for CommandPaletteHostHandle {}

pub struct CommandPaletteHost {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<CommandPaletteView>>>,
    input: Entity<InputState>,
    query_revision: Option<u64>,
    restore_focus: Option<FocusHandle>,
    bound: HashSet<String>,
    scroll: ScrollHandle,
    highlighted: Option<String>,
}

fn send(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

fn c(color: Rgba) -> gpui::Hsla {
    color.into()
}

impl CommandPaletteHost {
    pub fn install(client: &Entity<CoreClient>, window: &mut Window, cx: &mut App) {
        if cx.has_global::<CommandPaletteHostHandle>() {
            return;
        }
        let host = cx.new(|cx| Self::new(client.clone(), window, cx));
        cx.set_global(CommandPaletteHostHandle(host));
    }

    pub fn global(cx: &App) -> Option<Entity<CommandPaletteHost>> {
        cx.try_global::<CommandPaletteHostHandle>()
            .map(|handle| handle.0.clone())
    }

    pub fn shortcut(command: &str, cx: &mut App) {
        if let Some(host) = Self::global(cx) {
            let client = host.read(cx).client.clone();
            send(
                &client,
                cx,
                "commandPaletteShortcut",
                json!({ "command": command }),
            );
        }
    }

    fn new(client: Entity<CoreClient>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<CommandPaletteView>>(
            &client,
            "commandPalette",
            json!({}),
            cx,
        );
        let binding = CoreClient::subscribe::<CommandPaletteBindingView>(
            &client,
            "commandPaletteBinding",
            json!({}),
            cx,
        );
        let input = cx.new(|cx| InputState::new(window, cx));
        let target = client.clone();
        cx.subscribe_in(
            &input,
            window,
            move |_, state: &Entity<InputState>, event: &InputEvent, _, cx| match event {
                InputEvent::Change => {
                    let query = state.read(cx).value().to_string();
                    send(
                        &target,
                        cx,
                        "commandPaletteSetQuery",
                        json!({ "query": query }),
                    );
                }
                InputEvent::PressEnter { secondary, .. } => send(
                    &target,
                    cx,
                    "commandPaletteActivate",
                    json!({ "modifier": secondary }),
                ),
                _ => {}
            },
        )
        .detach();
        cx.observe_in(&view, window, |host, _, window, cx| host.sync(window, cx))
            .detach();
        cx.observe(&binding, |host, binding, cx| {
            let bindings = binding
                .read(cx)
                .data
                .as_ref()
                .map(|view| view.bindings.clone())
                .unwrap_or_default();
            let fresh: Vec<KeyBinding> = bindings
                .into_iter()
                .filter_map(|binding| {
                    let context = match binding.scope {
                        ShortcutScope::Palette => Some(PALETTE_KEY_CONTEXT),
                        ShortcutScope::Global if binding.outside_terminal => {
                            Some(OUTSIDE_TERMINAL_PREDICATE)
                        }
                        ShortcutScope::Global => None,
                    };
                    let key = format!(
                        "{}|{}|{}",
                        context.unwrap_or_default(),
                        binding.keystroke,
                        binding.command
                    );
                    host.bound.insert(key).then(|| {
                        KeyBinding::new(
                            &binding.keystroke,
                            PaletteShortcut {
                                command: binding.command,
                            },
                            context,
                        )
                    })
                })
                .collect();
            if !fresh.is_empty() {
                cx.bind_keys(fresh);
            }
        })
        .detach();
        Self {
            client,
            view,
            input,
            query_revision: None,
            restore_focus: None,
            bound: HashSet::new(),
            scroll: ScrollHandle::new(),
            highlighted: None,
        }
    }

    fn sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            if self.query_revision.take().is_some()
                && let Some(focus) = self.restore_focus.take()
            {
                window.focus(&focus, cx);
            }
            cx.notify();
            return;
        };
        let opened = self.query_revision.is_none();
        if opened {
            self.restore_focus = window.focused(cx);
        }
        if self.query_revision != Some(view.query_revision) {
            self.query_revision = Some(view.query_revision);
            self.input.update(cx, |state, cx| {
                if state.value() != view.query.as_str() {
                    state.set_value(view.query.clone(), window, cx);
                }
            });
        }
        self.input.update(cx, |state, cx| {
            state.set_placeholder(view.placeholder.clone(), window, cx);
            if opened {
                state.focus(window, cx);
            }
        });
        if view.highlighted != self.highlighted {
            self.highlighted = view.highlighted.clone();
            if let Some(index) = highlighted_child_index(&view) {
                self.scroll.scroll_to_item(index);
            }
        }
        cx.notify();
    }
}

fn highlighted_child_index(view: &CommandPaletteView) -> Option<usize> {
    let target = view.highlighted.as_ref()?;
    let mut index = 0;
    for group in &view.groups {
        if !group.label.is_empty() {
            index += 1;
        }
        for row in &group.rows {
            if &row.value == target {
                return Some(index);
            }
            index += 1;
        }
    }
    None
}

fn glyph_icon(glyph: &str) -> (&'static str, bool) {
    match glyph {
        "square-pen" => ("icons/square-pen.svg", false),
        "message-square" => ("icons/message-square.svg", false),
        "message-square-dashed" => ("icons/message-square-dashed.svg", false),
        "link" => ("icons/link.svg", false),
        "pull-request" => ("icons/git-pull-request-arrow.svg", false),
        "pull-request-link" => ("icons/link-2.svg", false),
        "rotate-ccw" => ("icons/rotate-ccw.svg", false),
        "file-search" => ("icons/file-search.svg", false),
        "text-search" => ("icons/text-search.svg", false),
        "folder-git" => ("icons/folder-git-2.svg", false),
        "folder-plus" => ("icons/folder-plus.svg", false),
        "folder" => ("icons/folder.svg", false),
        "palette" => ("icons/palette.svg", false),
        "monitor" => ("icons/monitor.svg", false),
        "sun" => ("icons/sun.svg", false),
        "moon" => ("icons/moon.svg", false),
        "chart" => ("icons/chart-no-axes-column.svg", false),
        "settings" => ("icons/settings.svg", false),
        "corner-left-up" => ("icons/corner-left-up.svg", false),
        "github" => ("icons/source-control/github.svg", false),
        "gitlab" => ("icons/source-control/gitlab.svg", true),
        "forgejo" => ("icons/source-control/forgejo.svg", true),
        "bitbucket" => ("icons/source-control/bitbucket.svg", true),
        "azure-devops" => ("icons/source-control/azure-devops.svg", true),
        _ => ("icons/square.svg", false),
    }
}

fn machine_icon(kind: EnvironmentMachineKind) -> &'static str {
    match kind {
        EnvironmentMachineKind::Server => "icons/server.svg",
        EnvironmentMachineKind::Cloud => "icons/cloud.svg",
        EnvironmentMachineKind::Linux => "icons/server.svg",
        EnvironmentMachineKind::Desktop => "icons/monitor.svg",
        EnvironmentMachineKind::Laptop => "icons/laptop.svg",
        EnvironmentMachineKind::MacMini => "icons/square.svg",
        EnvironmentMachineKind::MacStudio => "icons/box.svg",
    }
}

fn path_icon(path: &'static str, size: f32, color: Rgba) -> gpui::Svg {
    svg()
        .path(path)
        .flex_none()
        .size(px(size))
        .text_color(color)
}

fn row_icon(t: &Tokens, view: &PaletteIconView) -> AnyElement {
    match view {
        PaletteIconView::Glyph { glyph } => match glyph_icon(glyph) {
            (path, true) => img(path).flex_none().size(px(ICON_SIZE)).into_any_element(),
            (path, false) => path_icon(path, ICON_SIZE, t.icon_muted).into_any_element(),
        },
        PaletteIconView::Project { icon } => {
            ProjectFavicon::new(icon, ICON_SIZE).into_any_element()
        }
        PaletteIconView::Machine { machine } => {
            path_icon(machine_icon(*machine), ICON_SIZE, t.icon_muted).into_any_element()
        }
    }
}

fn status_colors(tone: &str, appearance: Appearance) -> (Rgba, Rgba) {
    let (dark, dark_alpha, light_text, light_dot) = match tone {
        "amber" => (0xffd230, 0.9, 0xe17100, 0xfe9a00),
        "indigo" => (0xa4b3ff, 0.9, 0x4f39f6, 0x615fff),
        "violet" => (0xc5b4ff, 0.9, 0x7f22fe, 0x8e51ff),
        "emerald" => (0x5feab6, 0.9, 0x009966, 0x00bc7d),
        _ => (0x73d4ff, 0.8, 0x0084d1, 0x00a6f4),
    };
    match appearance {
        Appearance::Dark => {
            let color = fade(rgb(dark), dark_alpha);
            (color, color)
        }
        Appearance::Light => (rgb(light_text), rgb(light_dot)),
    }
}

fn status_label(status: &PaletteThreadStatusView, appearance: Appearance) -> Div {
    let (text_color, dot) = status_colors(&status.tone, appearance);
    div()
        .flex()
        .flex_none()
        .items_center()
        .gap(px(META_GAP))
        .text_size(px(STATUS_TEXT))
        .line_height(px(STATUS_LINE))
        .text_color(text_color)
        .child(
            div()
                .flex_none()
                .size(px(STATUS_DOT))
                .rounded_full()
                .bg(dot),
        )
        .child(status.label.clone())
}

fn meta_dot(t: &Tokens) -> Div {
    div()
        .flex_none()
        .text_color(fade(t.muted_foreground, META_DOT_OPACITY))
        .child("·")
}

fn meta_line(t: &Tokens) -> Div {
    div()
        .flex()
        .min_w_0()
        .items_center()
        .gap(px(META_GAP))
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .text_color(fade(t.muted_foreground, META_OPACITY))
}

fn subtitle(t: &Tokens, view: &PaletteSubtitleView) -> Div {
    let meta = fade(t.muted_foreground, META_OPACITY);
    match view {
        PaletteSubtitleView::Thread {
            project,
            project_label,
            environment_label,
            branch_label,
            is_worktree,
            harness,
            is_current,
        } => {
            let mut line = meta_line(t);
            let mut first = true;
            if let Some(label) = project_label {
                line = line.child(
                    div()
                        .flex()
                        .min_w_0()
                        .items_center()
                        .gap(px(META_GAP))
                        .when_some(project.as_ref(), |row, icon| {
                            row.child(ProjectFavicon::new(icon, META_ICON))
                        })
                        .child(div().min_w_0().truncate().child(label.clone()))
                        .when_some(environment_label.clone(), |row, environment| {
                            row.child(meta_dot(t))
                                .child(div().flex_none().child(environment))
                        }),
                );
                first = false;
            }
            if let Some(branch) = branch_label {
                if !first {
                    line = line.child(meta_dot(t));
                }
                line = line.child(
                    div()
                        .flex()
                        .min_w_0()
                        .items_center()
                        .gap(px(META_GAP))
                        .child(path_icon(
                            if *is_worktree {
                                "icons/folder-git-2.svg"
                            } else {
                                "icons/folder.svg"
                            },
                            META_ICON,
                            meta,
                        ))
                        .child(div().min_w_0().truncate().child(branch.clone())),
                );
                first = false;
            }
            if let Some(harness) = harness {
                if !first {
                    line = line.child(meta_dot(t));
                }
                line = line.child(
                    ProviderInstanceIcon::new(
                        harness.driver_kind.clone(),
                        harness.initials.clone(),
                        t.muted_foreground,
                    )
                    .icon_size(META_ICON)
                    .icon_opacity(META_OPACITY),
                );
                first = false;
            }
            if *is_current {
                if !first {
                    line = line.child(meta_dot(t));
                }
                line = line.child(div().flex_none().child("Current thread"));
            }
            line
        }
        PaletteSubtitleView::Location {
            remote_machine,
            label,
            workspace_root,
        } => meta_line(t)
            .child(
                div()
                    .flex()
                    .min_w_0()
                    .items_center()
                    .gap(px(META_GAP))
                    .when_some(*remote_machine, |row, machine| {
                        row.child(path_icon(machine_icon(machine), META_ICON, meta))
                    })
                    .child(div().min_w_0().truncate().child(label.clone())),
            )
            .child(meta_dot(t))
            .child(div().min_w_0().truncate().child(workspace_root.clone())),
        PaletteSubtitleView::Labels { text: labels } => {
            meta_line(t).child(div().min_w_0().truncate().child(labels.clone()))
        }
    }
}

fn content_match(t: &Tokens, view: &PaletteContentMatchView) -> Div {
    let (label, color) = match view.source {
        MatchSource::User => ("You:", t.info_foreground),
        MatchSource::Assistant => ("Agent:", t.success_foreground),
    };
    div()
        .flex()
        .min_w_0()
        .overflow_hidden()
        .whitespace_nowrap()
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .text_color(fade(t.muted_foreground, MATCH_OPACITY))
        .child(div().flex_none().text_color(color).child(label))
        .child(div().flex_none().child("\u{a0}"))
        .children(view.parts.iter().map(|part| {
            div()
                .flex_none()
                .when(part.highlighted, |s| {
                    s.font_weight(FontWeight::SEMIBOLD).text_color(t.foreground)
                })
                .child(part.text.clone())
        }))
}

fn flow_header(
    t: &Tokens,
    label: Option<&'static str>,
    icon: AnyElement,
    title: &str,
    detail: &str,
) -> Div {
    div()
        .flex_none()
        .pt(px(LIST_PADDING))
        .px(px(LIST_PADDING))
        .when_some(label, |header, label| {
            header.child(CommandGroupLabel::new(label))
        })
        .child(
            div()
                .flex()
                .min_h(px(HEADER_MIN_HEIGHT))
                .items_center()
                .gap(px(ITEM_GAP))
                .rounded(px(radius::SM))
                .px(px(ITEM_PADDING_X))
                .py(px(ITEM_PADDING_Y))
                .child(icon)
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .child(
                            div()
                                .truncate()
                                .text_size(px(text::SM))
                                .line_height(px(text::SM_LINE))
                                .text_color(t.foreground)
                                .child(title.to_string()),
                        )
                        .child(
                            div()
                                .truncate()
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .text_color(fade(t.muted_foreground, MATCH_OPACITY))
                                .child(detail.to_string()),
                        ),
                ),
        )
}

fn accessory(
    t: &Tokens,
    view: &PaletteAccessoryView,
    row_id: &str,
    client: &Entity<CoreClient>,
) -> AnyElement {
    let soft = fade(t.muted_foreground, META_OPACITY);
    let current = || {
        div()
            .flex_none()
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .text_color(soft)
            .child("Current")
    };
    match view {
        PaletteAccessoryView::Current => current().into_any_element(),
        PaletteAccessoryView::ThemePreviews {
            current: is_current,
            previews,
        } => {
            div()
                .flex()
                .flex_none()
                .items_center()
                .gap(px(PREVIEW_GROUP_GAP))
                .when(*is_current, |row| row.child(current()))
                .child(div().flex().items_center().gap(px(PREVIEW_GAP)).children(
                    previews.iter().map(|preview| {
                        let dark = preview.mode == "dark";
                        let fill = preview
                            .color
                            .as_deref()
                            .and_then(crate::features::chat::provider_instance_icon::parse_accent)
                            .unwrap_or(t.muted);
                        div()
                            .flex_none()
                            .size(px(PREVIEW_SIZE))
                            .rounded_full()
                            .bg(fill)
                            .border_1()
                            .border_color(if dark {
                                fade(rgb(0xffffff), PREVIEW_RING_DARK)
                            } else {
                                fade(rgb(0x000000), PREVIEW_RING_LIGHT)
                            })
                    }),
                ))
                .into_any_element()
        }
        PaletteAccessoryView::SetupRequired { .. } => {
            let open = client.clone();
            div()
                .ml_auto()
                .child(
                    Button::new(SharedString::from(format!("{row_id}-setup")))
                        .variant(ButtonVariant::WarningOutline)
                        .size(ButtonSize::Micro)
                        .label("Setup Required")
                        .on_click(move |_, _, cx| {
                            cx.stop_propagation();
                            send(
                                &open,
                                cx,
                                "commandPaletteOpenSourceControlSettings",
                                json!({}),
                            );
                        }),
                )
                .into_any_element()
        }
        PaletteAccessoryView::Selected => path_icon("icons/check.svg", ICON_SIZE, soft)
            .ml_auto()
            .into_any_element(),
        PaletteAccessoryView::Chevron => path_icon("icons/chevron-right.svg", ICON_SIZE, soft)
            .ml_auto()
            .into_any_element(),
        PaletteAccessoryView::Checkbox { checked } => div()
            .ml_auto()
            .flex()
            .flex_none()
            .child(
                Checkbox::new(SharedString::from(format!("{row_id}-checkbox"))).checked(*checked),
            )
            .into_any_element(),
    }
}

fn title_line(t: &Tokens, row: &PaletteRowView, appearance: Appearance) -> Div {
    div()
        .flex()
        .min_w_0()
        .items_center()
        .gap(px(TITLE_GAP))
        .text_size(px(text::SM))
        .line_height(px(text::SM_LINE))
        .text_color(t.foreground)
        .when_some(row.status.as_ref(), |line, status| {
            line.child(status_label(status, appearance))
        })
        .child(
            div()
                .flex()
                .min_w_0()
                .overflow_hidden()
                .whitespace_nowrap()
                .child(div().min_w_0().truncate().child(row.title.clone()))
                .when_some(row.title_emphasis.clone(), |line, emphasis| {
                    line.child(
                        div()
                            .flex_none()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(emphasis),
                    )
                }),
        )
}

fn palette_row(
    t: &Tokens,
    row: &PaletteRowView,
    highlighted: bool,
    client: &Entity<CoreClient>,
) -> AnyElement {
    let appearance = t.appearance;
    let two_line =
        row.description.is_some() || row.subtitle.is_some() || row.content_match.is_some();
    let body = if two_line {
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .child(title_line(t, row, appearance))
            .when_some(row.content_match.as_ref(), |body, matched| {
                body.child(content_match(t, matched))
            })
            .when_some(row.description.clone(), |body, description| {
                body.child(
                    div()
                        .min_w_0()
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .text_color(fade(t.muted_foreground, META_OPACITY))
                        .child(description),
                )
            })
            .when_some(row.subtitle.as_ref(), |body, view| {
                body.child(subtitle(t, view))
            })
    } else {
        title_line(t, row, appearance).flex_1()
    };
    let submenu = row.kind == PaletteRowKind::Submenu;
    let trailing = row
        .remote_machine
        .map(|machine| {
            div()
                .flex()
                .flex_none()
                .items_center()
                .child(path_icon(
                    machine_icon(machine),
                    META_ICON,
                    fade(t.muted_foreground, REMOTE_OPACITY),
                ))
                .into_any_element()
        })
        .or_else(|| {
            row.accessory
                .as_ref()
                .map(|view| accessory(t, view, &row.value, client))
        });
    let element = div()
        .id(SharedString::from(format!("palette-row-{}", row.value)))
        .flex()
        .items_center()
        .gap(px(ITEM_GAP))
        .min_h(px(ITEM_MIN_HEIGHT))
        .pl(px(ITEM_PADDING_X))
        .pr(px(if submenu {
            ITEM_PADDING_X - CHEVRON_PULL
        } else {
            ITEM_PADDING_X
        }))
        .py(px(ITEM_PADDING_Y))
        .rounded(px(radius::SM))
        .text_size(px(text::SM))
        .line_height(px(text::SM_LINE))
        .when(highlighted, |s| {
            s.bg(c(t.accent)).text_color(c(t.accent_foreground))
        })
        .when(row.disabled, |s| s.opacity(DISABLED_OPACITY))
        .child(row_icon(t, &row.icon))
        .child(body)
        .children(trailing)
        .when_some(row.timestamp.clone(), |s, timestamp| {
            s.child(
                div()
                    .flex_none()
                    .min_w(px(TIMESTAMP_MIN_WIDTH))
                    .text_right()
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .font_features(tabular())
                    .text_color(fade(t.muted_foreground, META_OPACITY))
                    .child(timestamp),
            )
        })
        .when_some(row.shortcut_label.as_deref(), |s, keys| {
            s.child(shortcut(t, keys))
        })
        .when(submenu, |s| {
            s.child(
                path_icon(
                    "icons/chevron-right.svg",
                    ICON_SIZE,
                    fade(t.muted_foreground, META_OPACITY),
                )
                .ml_auto(),
            )
        });
    if row.disabled {
        return element.into_any_element();
    }
    let hover_client = client.clone();
    let click_client = client.clone();
    let hover_value = row.value.clone();
    let click_value = row.value.clone();
    element
        .cursor_pointer()
        .on_hover(move |hovered, _, cx| {
            if *hovered {
                send(
                    &hover_client,
                    cx,
                    "commandPaletteHighlight",
                    json!({ "value": hover_value }),
                );
            }
        })
        .on_click(move |_, _, cx| {
            send(
                &click_client,
                cx,
                "commandPaletteActivate",
                json!({ "value": click_value }),
            );
        })
        .into_any_element()
}

fn input_row(
    t: &Tokens,
    view: &CommandPaletteView,
    input: &Entity<InputState>,
    client: &Entity<CoreClient>,
) -> Div {
    let addon_top = (INPUT_HEIGHT - 2. - ICON_SIZE) / 2.;
    let addon = match view.input_addon {
        InputAddon::Search => div()
            .absolute()
            .left(px(SEARCH_ICON_INSET))
            .top(px(addon_top))
            .opacity(ADDON_OPACITY)
            .child(icon("search", ICON_SIZE, t.icon_muted))
            .into_any_element(),
        InputAddon::Back => {
            let back = client.clone();
            div()
                .id("command-palette-back")
                .absolute()
                .left(px(SEARCH_ICON_INSET - CHEVRON_PULL))
                .top(px(addon_top))
                .opacity(ADDON_OPACITY)
                .cursor_pointer()
                .child(icon("arrow-left", ICON_SIZE, t.foreground))
                .on_click(move |_, _, cx| send(&back, cx, "commandPaletteBack", json!({})))
                .into_any_element()
        }
        InputAddon::FolderPlus => div()
            .absolute()
            .left(px(SEARCH_ICON_INSET - CHEVRON_PULL))
            .top(px(addon_top))
            .opacity(ADDON_OPACITY)
            .child(icon("folder-plus", ICON_SIZE, t.foreground))
            .into_any_element(),
    };
    let submit = view.submit.as_ref().map(|submit| {
        let activate = client.clone();
        div()
            .absolute()
            .right(px(SUBMIT_INSET))
            .top_0()
            .bottom_0()
            .flex()
            .items_center()
            .child(
                Button::new("command-palette-submit")
                    .variant(ButtonVariant::Outline)
                    .size(ButtonSize::Xs)
                    .disabled(submit.disabled)
                    .pr(px(SUBMIT_PADDING_END))
                    .child(div().child(submit.label.clone()))
                    .child(Kbd::new(submit.shortcut_label.clone()))
                    .on_click(move |_, _, cx| {
                        send(&activate, cx, "commandPaletteSubmit", json!({}))
                    }),
            )
    });
    div()
        .flex_none()
        .px(px(workspace::COMMAND_SHELL_INSET))
        .py(px(INPUT_ROW_PADDING_Y))
        .child(
            div()
                .relative()
                .flex()
                .items_center()
                .w_full()
                .h(px(INPUT_HEIGHT))
                .rounded(px(radius::LG))
                .border_1()
                .border_color(gpui::transparent_black())
                .text_size(px(text::SM))
                .text_color(t.foreground)
                .child(addon)
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .h_full()
                        .pl(px(INPUT_TEXT_INSET))
                        .pr(px(view.input_padding_end))
                        .flex()
                        .items_center()
                        .child(bare_input(
                            input,
                            INPUT_HEIGHT - 2.,
                            0.,
                            0.,
                            text::SM,
                            false,
                        )),
                )
                .children(submit),
        )
}

impl Render for CommandPaletteHost {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return div().into_any_element();
        };
        let t = theme::active(cx);
        let client = self.client.clone();
        let panel_max =
            (window.viewport_size().height.as_f32() * PANEL_MAX_VIEWPORT).min(PANEL_MAX_HEIGHT);
        let list = if view.groups.is_empty() {
            div()
                .flex_none()
                .py(px(EMPTY_PADDING_Y))
                .text_center()
                .text_size(px(text::SM))
                .line_height(px(text::SM_LINE))
                .text_color(t.muted_foreground)
                .child(view.empty_state_message.clone())
                .into_any_element()
        } else {
            let mut children: Vec<AnyElement> = Vec::new();
            for (index, group) in view.groups.iter().enumerate() {
                let gap = if index > 0 { GROUP_GAP } else { 0. };
                let mut first = true;
                if !group.label.is_empty() {
                    children.push(
                        div()
                            .mt(px(gap))
                            .child(CommandGroupLabel::new(group.label.clone()))
                            .into_any_element(),
                    );
                    first = false;
                }
                for row in &group.rows {
                    let highlighted = view.highlighted.as_deref() == Some(row.value.as_str());
                    let element = palette_row(&t, row, highlighted, &client);
                    children.push(if first {
                        first = false;
                        div().mt(px(gap)).child(element).into_any_element()
                    } else {
                        element
                    });
                }
            }
            div()
                .id("command-palette-list")
                .flex()
                .flex_col()
                .min_h_0()
                .overflow_y_scroll()
                .track_scroll(&self.scroll)
                .p(px(LIST_PADDING))
                .children(children)
                .into_any_element()
        };
        let results = command_panel()
            .flex_initial()
            .max_h(px(panel_max))
            .when_some(view.new_project_header.as_ref(), |panel, header| {
                panel.child(flow_header(
                    &t,
                    None,
                    path_icon("icons/folder-git-2.svg", ICON_SIZE, t.icon_muted).into_any_element(),
                    &header.title,
                    &header.detail,
                ))
            })
            .when_some(view.repository_header.as_ref(), |panel, header| {
                panel.child(flow_header(
                    &t,
                    Some("Repository"),
                    row_icon(&t, &header.icon),
                    &header.title,
                    &header.description,
                ))
            })
            .child(list);
        let footer = CommandFooter::new().child(
            footer_hints()
                .child(CommandFooterHint::new(
                    vec![
                        FooterKey::Icon("arrow-up".into()),
                        FooterKey::Icon("arrow-down".into()),
                    ],
                    "Navigate",
                ))
                .when_some(view.footer_action_label.clone(), |hints, label| {
                    hints.child(CommandFooterHint::new(
                        vec![FooterKey::Text("Enter".into())],
                        label,
                    ))
                })
                .when(view.show_back_hint, |hints| {
                    hints.child(CommandFooterHint::new(
                        vec![FooterKey::Text("Backspace".into())],
                        "Back",
                    ))
                })
                .child(CommandFooterHint::new(
                    vec![FooterKey::Text("Esc".into())],
                    "Close",
                )),
        );
        let footer = match view.file_manager_label.clone() {
            Some(label) => {
                let open = client.clone();
                footer.child(
                    CommandFooterAction::new("command-palette-file-manager", label).on_click(
                        move |_, _, cx| send(&open, cx, "commandPaletteOpenFileManager", json!({})),
                    ),
                )
            }
            None => footer,
        };
        let up = client.clone();
        let down = client.clone();
        let escape = client.clone();
        let back = client.clone();
        let dismiss = client.clone();
        CommandDialogPopup::new("command-palette")
            .on_dismiss(move |_, cx| send(&dismiss, cx, "commandPaletteClose", json!({})))
            .child(
                div()
                    .key_context(PALETTE_KEY_CONTEXT)
                    .flex()
                    .flex_col()
                    .min_h_0()
                    .capture_action(move |_: &MoveUp, _, cx| {
                        cx.stop_propagation();
                        send(&up, cx, "commandPaletteMove", json!({ "delta": -1 }));
                    })
                    .capture_action(move |_: &MoveDown, _, cx| {
                        cx.stop_propagation();
                        send(&down, cx, "commandPaletteMove", json!({ "delta": 1 }));
                    })
                    .on_action(move |_: &Escape, _, cx| {
                        send(&escape, cx, "commandPaletteClose", json!({}));
                    })
                    .on_action(move |_: &Backspace, _, cx| {
                        send(&back, cx, "commandPaletteBack", json!({}));
                    })
                    .child(input_row(&t, &view, &self.input, &client))
                    .child(results)
                    .child(footer),
            )
            .into_any_element()
    }
}
