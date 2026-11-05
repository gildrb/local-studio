pub mod sidebar_chrome;
pub mod sidebar_draft_row;
pub mod sidebar_row_parts;
pub mod sidebar_rows_host;
pub mod sidebar_thread_header;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, ClickEvent, Entity, FontWeight, InteractiveElement, IntoElement, MouseButton,
    MouseDownEvent, ParentElement, RenderOnce, Rgba, SharedString, StatefulInteractiveElement,
    Styled, Window, div, px, svg,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::sidebar::{
    EnvironmentMachineKind, RowVariant, SidebarEmptyStateView, SidebarItemView, SidebarRowSurface,
    SidebarShelfHeaderView, SidebarThreadRowView, SidebarThreadStatusKind, SidebarTitleTone,
    SidebarView, TitleWeight,
};
use crate::features::chat::provider_instance_icon::{ProviderInstanceIcon, parse_accent};
use crate::ui::project_favicon::ProjectFavicon;
use crate::ui::sidebar::{SidebarContent, SidebarGroup};
use crate::ui::theme;
use crate::ui::theme::palette::{
    EMERALD_300, EMERALD_700, INDIGO_300, INDIGO_600, RED_300, RED_700, SKY_400, SKY_600, WHITE,
    pick,
};
use crate::ui::theme::tokens::{Appearance, Tokens, fade};
use crate::ui::thread_status_indicators::{
    TerminalStatusIcon, ThreadPullRequestBadge, WorktreeIndicator,
};
use sidebar_chrome::{SidebarChromeFooter, SidebarChromeHeader};
use sidebar_draft_row::{draft_divider, draft_row};
use sidebar_row_parts::{
    RowHover, act, card_actions, draft_pen, jump_hint, pin_indicator, rename_input, slim_action,
    slim_action_inset, thread_params, woke_button,
};
use sidebar_thread_header::SidebarThreadHeader;

const TEXT_XS: f32 = 12.;
const TEXT_XS_LINE: f32 = 16.;
const TEXT_SM: f32 = 14.;
const TEXT_SM_LINE: f32 = 20.;
const CARD_HEIGHT: f32 = 78.;
const SLIM_HEIGHT: f32 = 36.;
const ROW_CONTENT_INSET: f32 = 10.;
const CONTENT_INSET: f32 = 8.;
const META_HEIGHT: f32 = 20.;
const SHELF_HEIGHT: f32 = 32.;
const SHOW_MORE_HEIGHT: f32 = 36.;
const RECEDE_TEXT: f32 = 0.75;
const FADED_ROW: f32 = 0.7;
const SETTLED_DIM: f32 = 0.7;
const SLIM_FAVICON_REST: f32 = 0.4;
const PROVIDER_OPACITY: f32 = 0.6;
const SHELF_TEXT: f32 = 0.6;
const SHELF_LINE: f32 = 0.6;
const SNOOZED_LINE: f32 = 0.2;
const SHOW_MORE_TEXT: f32 = 0.55;
const EMPTY_TEXT: f32 = 0.6;
const REMOTE_TEXT: f32 = 0.7;
const REGENERATING_TITLE: f32 = 0.55;
const DRAFT_SURFACE: f32 = 0.04;
const DRAFT_SURFACE_HOVER: f32 = 0.08;

#[derive(IntoElement)]
pub struct Sidebar {
    view: SidebarView,
    client: Entity<CoreClient>,
    controls_left: f32,
}

impl Sidebar {
    pub fn new(view: &SidebarView, client: Entity<CoreClient>, controls_left: f32) -> Self {
        Self {
            view: view.clone(),
            client,
            controls_left,
        }
    }
}

fn status_presentation(kind: SidebarThreadStatusKind, t: &Tokens) -> (&'static str, Rgba) {
    let a = t.appearance;
    match kind {
        SidebarThreadStatusKind::Working => ("icons/circle-dashed.svg", pick(a, SKY_400, SKY_600)),
        SidebarThreadStatusKind::Monitoring => (
            "icons/eye.svg",
            match a {
                Appearance::Dark => gpui::rgb(WHITE),
                Appearance::Light => t.foreground,
            },
        ),
        SidebarThreadStatusKind::Approval => {
            ("icons/shield-question-mark.svg", t.warning_foreground)
        }
        SidebarThreadStatusKind::Input => (
            "icons/message-circle-question-mark.svg",
            pick(a, INDIGO_300, INDIGO_600),
        ),
        SidebarThreadStatusKind::Failed => ("icons/circle-alert.svg", pick(a, RED_300, RED_700)),
        SidebarThreadStatusKind::Woke => ("icons/alarm-clock.svg", t.warning_foreground),
        SidebarThreadStatusKind::Done => {
            ("icons/circle-check.svg", pick(a, EMERALD_300, EMERALD_700))
        }
    }
}

fn title_color(tone: SidebarTitleTone, t: &Tokens) -> Rgba {
    match tone {
        SidebarTitleTone::Foreground => t.foreground,
        SidebarTitleTone::Foreground95 => fade(t.foreground, 0.95),
        SidebarTitleTone::Foreground90 => fade(t.foreground, 0.9),
        SidebarTitleTone::Secondary => t.secondary_label,
        SidebarTitleTone::Secondary70 => fade(t.secondary_label, 0.7),
        SidebarTitleTone::Muted => t.muted_foreground,
    }
}

pub(crate) fn machine_icon(kind: EnvironmentMachineKind) -> &'static str {
    match kind {
        EnvironmentMachineKind::Server => "icons/server.svg",
        EnvironmentMachineKind::Cloud => "icons/cloud.svg",
        EnvironmentMachineKind::Linux => "icons/terminal.svg",
        EnvironmentMachineKind::Desktop => "icons/monitor.svg",
        EnvironmentMachineKind::Laptop => "icons/laptop.svg",
        EnvironmentMachineKind::MacMini => "icons/square.svg",
        EnvironmentMachineKind::MacStudio => "icons/box.svg",
    }
}

struct RowPaint {
    dim: Option<Rgba>,
    group: SharedString,
}

impl RowPaint {
    fn text(&self, color: Rgba, element: gpui::Div) -> gpui::Div {
        match self.dim {
            Some(dim) => element
                .text_color(dim)
                .group_hover(self.group.clone(), move |style| style.text_color(color)),
            None => element.text_color(color),
        }
    }

    fn icon(&self, color: Rgba, element: gpui::Svg) -> gpui::Svg {
        match self.dim {
            Some(dim) => element
                .text_color(dim)
                .group_hover(self.group.clone(), move |style| style.text_color(color)),
            None => element.text_color(color),
        }
    }
}

fn row_click(
    client: &Entity<CoreClient>,
    row: &SidebarThreadRowView,
) -> impl Fn(&ClickEvent, &mut Window, &mut App) + 'static {
    let client = client.clone();
    let params = thread_params(row);
    let renaming = row.renaming;
    move |event, _, cx| {
        let modifiers = event.modifiers();
        if modifiers.platform || modifiers.control || modifiers.shift {
            return;
        }
        match event.click_count() {
            1 => act(&client, cx, "selectThread", params.clone()),
            2 if !renaming && !modifiers.alt => {
                act(&client, cx, "sidebarRenameStart", params.clone())
            }
            _ => {}
        }
    }
}

fn row_context_menu(
    client: &Entity<CoreClient>,
    row: &SidebarThreadRowView,
) -> impl Fn(&MouseDownEvent, &mut Window, &mut App) + 'static {
    let client = client.clone();
    let environment_id = row.environment_id.clone();
    let thread_id = row.thread_id.clone();
    move |event, _, cx| {
        cx.stop_propagation();
        act(
            &client,
            cx,
            "sidebarThreadContextMenu",
            json!({
                "environmentId": environment_id,
                "threadId": thread_id,
                "x": f32::from(event.position.x),
                "y": f32::from(event.position.y),
            }),
        );
    }
}

fn row_surface(
    row: &SidebarThreadRowView,
    t: &Tokens,
    element: gpui::Stateful<gpui::Div>,
) -> gpui::Stateful<gpui::Div> {
    let hover = t.sidebar_row_hover;
    let foreground = t.sidebar_foreground;
    let element = match row.surface {
        SidebarRowSurface::Active => element.bg(t.sidebar_row_active).text_color(foreground),
        SidebarRowSurface::Selected => element.bg(t.sidebar_row_selected).text_color(foreground),
        SidebarRowSurface::Draft => {
            let draft_hover = fade(t.warning, DRAFT_SURFACE_HOVER);
            element
                .bg(fade(t.warning, DRAFT_SURFACE))
                .text_color(foreground)
                .hover(move |style| style.bg(draft_hover))
        }
        SidebarRowSurface::Recede => element
            .text_color(fade(t.sidebar_muted_foreground, RECEDE_TEXT))
            .hover(move |style| style.bg(hover).text_color(foreground)),
        SidebarRowSurface::Default => element
            .text_color(foreground)
            .hover(move |style| style.bg(hover)),
    };
    element.when(row.fade_row, |this| {
        this.opacity(FADED_ROW).hover(|style| style.opacity(1.))
    })
}

fn time_or_status(row: &SidebarThreadRowView, t: &Tokens, paint: &RowPaint) -> AnyElement {
    match &row.status {
        Some(status) => {
            let (icon, color) = status_presentation(status.kind, t);
            paint
                .text(
                    color,
                    div()
                        .flex()
                        .items_center()
                        .gap(px(4.))
                        .font_weight(FontWeight::MEDIUM),
                )
                .child(paint.icon(color, svg().path(icon).flex_none().size(px(16.))))
                .child(div().child(status.label.clone()))
                .into_any_element()
        }
        None => paint
            .text(t.secondary_label, div().flex().items_center())
            .child(row.time_label.clone())
            .into_any_element(),
    }
}

fn row_title(row: &SidebarThreadRowView, color: Rgba, paint: &RowPaint) -> gpui::Div {
    paint
        .text(
            color,
            div()
                .flex_1()
                .min_w_0()
                .truncate()
                .text_size(px(TEXT_SM))
                .line_height(px(TEXT_SM_LINE))
                .font_weight(match row.title_weight {
                    TitleWeight::Normal => FontWeight::NORMAL,
                    TitleWeight::Medium => FontWeight::MEDIUM,
                })
                .when(row.regenerating_title, |this| {
                    this.opacity(REGENERATING_TITLE)
                }),
        )
        .child(row.title.clone())
}

fn card_status_slot(
    row: &SidebarThreadRowView,
    client: &Entity<CoreClient>,
    t: &Tokens,
    paint: &RowPaint,
    hovered: bool,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let woke = row
        .status
        .as_ref()
        .filter(|status| status.kind == SidebarThreadStatusKind::Woke);
    let reveal = hovered || row.snooze_menu.is_some();
    let actions = reveal
        .then(|| card_actions(row, client, t, window, cx))
        .flatten();
    let status = match woke {
        Some(status) => Some(woke_button(row, client, &status.label, 16., t).into_any_element()),
        None if actions.is_none() => Some(time_or_status(row, t, paint)),
        None => None,
    };
    div()
        .relative()
        .ml_auto()
        .flex()
        .flex_none()
        .h(px(META_HEIGHT))
        .min_w(px(32.))
        .justify_end()
        .items_center()
        .text_size(px(TEXT_XS))
        .line_height(px(TEXT_XS_LINE))
        .children(status)
        .children(actions)
        .into_any_element()
}

fn card_row(
    row: &SidebarThreadRowView,
    client: &Entity<CoreClient>,
    t: &Tokens,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let group = SharedString::from(format!("sidebar-row-{}", row.key));
    let hover = RowHover::new(&row.key, window, cx);
    let paint = RowPaint {
        dim: row
            .settled_dim
            .then(|| fade(t.secondary_label, SETTLED_DIM)),
        group: group.clone(),
    };
    let recede = row.surface == SidebarRowSurface::Recede;
    let project_label = row.project.display_name.clone();
    let line_one = div()
        .flex()
        .h(px(META_HEIGHT))
        .min_w_0()
        .items_center()
        .gap(px(6.))
        .when(row.has_unsent_draft, |this| {
            this.child(draft_pen(&row.key, t))
        })
        .children(
            row.project
                .icon
                .as_ref()
                .map(|icon| ProjectFavicon::new(icon, 16.)),
        )
        .child(match project_label {
            Some(label) => paint
                .text(
                    t.secondary_label,
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .text_size(px(TEXT_XS))
                        .line_height(px(TEXT_XS_LINE))
                        .font_weight(if recede {
                            FontWeight::NORMAL
                        } else {
                            FontWeight::MEDIUM
                        }),
                )
                .child(label)
                .into_any_element(),
            None => div().flex_1().into_any_element(),
        })
        .children(pin_indicator(row, client, t, paint.dim, group.clone()))
        .child(card_status_slot(
            row,
            client,
            t,
            &paint,
            hover.hovered,
            window,
            cx,
        ));
    let title = if row.renaming {
        rename_input(&row.key, t, cx).unwrap_or_else(|| {
            row_title(row, title_color(row.title_tone, t), &paint).into_any_element()
        })
    } else {
        row_title(row, title_color(row.title_tone, t), &paint).into_any_element()
    };
    let provider_color = if row.settled_dim {
        fade(t.secondary_label, SETTLED_DIM)
    } else {
        t.secondary_label
    };
    let line_three = paint
        .text(
            t.secondary_label,
            div()
                .mt(px(2.))
                .flex()
                .min_w_0()
                .items_center()
                .gap(px(6.))
                .text_size(px(TEXT_XS))
                .line_height(px(TEXT_XS_LINE)),
        )
        .map(|this| match &row.branch {
            Some(branch) => this
                .when(row.worktree.is_some(), |this| {
                    this.child(WorktreeIndicator::new(t))
                })
                .child(
                    paint
                        .text(
                            fade(t.muted_foreground, 0.4),
                            div()
                                .flex_1()
                                .min_w_0()
                                .overflow_hidden()
                                .whitespace_nowrap()
                                .text_ellipsis_middle(),
                        )
                        .child(branch.clone()),
                ),
            None => this.child(div().flex_1()),
        })
        .when(row.terminal.is_some(), |this| {
            this.child(TerminalStatusIcon::new(t, 14.))
        })
        .when_some(row.pull_request.as_ref(), |this, pr| {
            this.child(ThreadPullRequestBadge::new(
                SharedString::from(format!("sidebar-pr-{}", row.key)),
                pr,
                t,
            ))
        })
        .child(
            div()
                .ml_auto()
                .flex()
                .flex_none()
                .items_center()
                .gap(px(4.))
                .when_some(row.remote_machine, |this, machine| {
                    this.child(
                        svg()
                            .path(machine_icon(machine))
                            .size(px(14.))
                            .text_color(fade(t.sidebar_muted_foreground, REMOTE_TEXT)),
                    )
                })
                .when_some(row.provider.as_ref(), |this, provider| {
                    let icon = ProviderInstanceIcon::new(
                        provider.driver_kind.clone(),
                        provider.initials.clone(),
                        provider_color,
                    )
                    .icon_size(14.)
                    .icon_opacity(PROVIDER_OPACITY);
                    this.child(if provider.show_badge {
                        icon.badge(
                            provider.accent_color.as_deref().and_then(parse_accent),
                            t.card,
                        )
                    } else {
                        icon
                    })
                }),
        );
    let surface = div()
        .id(SharedString::from(format!("sidebar-row-card-{}", row.key)))
        .group(group)
        .relative()
        .w_full()
        .cursor_pointer()
        .overflow_hidden()
        .rounded(px(8.))
        .on_hover(hover.listener())
        .on_click(row_click(client, row))
        .on_mouse_down(MouseButton::Right, row_context_menu(client, row));
    div()
        .py(px(2.))
        .child(
            row_surface(row, t, surface)
                .child(
                    div()
                        .relative()
                        .h(px(CARD_HEIGHT))
                        .px(px(ROW_CONTENT_INSET))
                        .py(px(CONTENT_INSET))
                        .child(line_one)
                        .child(div().mt(px(4.)).flex().min_w_0().child(title))
                        .child(line_three),
                )
                .children(
                    row.jump_label
                        .as_deref()
                        .map(|label| jump_hint(label, CARD_HEIGHT, t)),
                ),
        )
        .into_any_element()
}

fn slim_row(
    row: &SidebarThreadRowView,
    client: &Entity<CoreClient>,
    t: &Tokens,
    window: &mut Window,
    cx: &mut App,
) -> AnyElement {
    let group = SharedString::from(format!("sidebar-row-{}", row.key));
    let hover = RowHover::new(&row.key, window, cx);
    let paint = RowPaint {
        dim: row
            .settled_dim
            .then(|| fade(t.secondary_label, SETTLED_DIM)),
        group: group.clone(),
    };
    let title_color = title_color(row.title_tone, t);
    let foreground = t.foreground;
    let woke = row
        .status
        .as_ref()
        .filter(|status| status.kind == SidebarThreadStatusKind::Woke);
    let right = match (&row.snooze_wake_label, woke) {
        (Some(wake), _) => div()
            .text_size(px(TEXT_XS))
            .line_height(px(TEXT_XS_LINE))
            .text_color(t.info_foreground)
            .child(wake.clone())
            .into_any_element(),
        (None, Some(status)) => woke_button(row, client, &status.label, 12., t).into_any_element(),
        _ => paint
            .text(
                t.secondary_label,
                div().text_size(px(TEXT_XS)).line_height(px(TEXT_XS_LINE)),
            )
            .child(row.time_label.clone())
            .into_any_element(),
    };
    let action = hover
        .hovered
        .then(|| slim_action(row, client, t))
        .flatten()
        .map(|action| {
            if woke.is_some() {
                action.into_any_element()
            } else {
                action
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .right(px(slim_action_inset(row)))
                    .into_any_element()
            }
        });
    let hide_status = action.is_some() && woke.is_none();
    let title = if row.renaming {
        rename_input(&row.key, t, cx)
    } else {
        None
    }
    .unwrap_or_else(|| {
        row_title(row, title_color, &paint)
            .group_hover(group.clone(), move |style| style.text_color(foreground))
            .into_any_element()
    });
    let surface = div()
        .id(SharedString::from(format!("sidebar-row-slim-{}", row.key)))
        .group(group.clone())
        .relative()
        .flex()
        .w_full()
        .h(px(SLIM_HEIGHT))
        .items_center()
        .gap(px(10.))
        .px(px(ROW_CONTENT_INSET))
        .cursor_pointer()
        .overflow_hidden()
        .rounded(px(8.))
        .on_hover(hover.listener())
        .on_click(row_click(client, row))
        .on_mouse_down(MouseButton::Right, row_context_menu(client, row));
    row_surface(row, t, surface)
        .child(
            div()
                .flex_none()
                .when(row.project.dimmed, |this| {
                    this.opacity(SLIM_FAVICON_REST)
                        .group_hover(group.clone(), |style| style.opacity(1.))
                })
                .children(
                    row.project
                        .icon
                        .as_ref()
                        .map(|icon| ProjectFavicon::new(icon, 16.)),
                ),
        )
        .when(row.has_unsent_draft, |this| {
            this.child(draft_pen(&row.key, t))
        })
        .child(title)
        .children(pin_indicator(row, client, t, None, group))
        .when(row.terminal.is_some(), |this| {
            this.child(TerminalStatusIcon::new(t, 14.))
        })
        .when_some(row.pull_request.as_ref(), |this, pr| {
            this.child(ThreadPullRequestBadge::new(
                SharedString::from(format!("sidebar-pr-{}", row.key)),
                pr,
                t,
            ))
        })
        .child(
            div()
                .relative()
                .ml_auto()
                .flex()
                .flex_none()
                .h(px(24.))
                .min_w(px(32.))
                .items_center()
                .justify_end()
                .child(
                    div()
                        .flex()
                        .justify_end()
                        .when(hide_status, |this| this.opacity(0.))
                        .child(right),
                )
                .children(action),
        )
        .children(
            row.jump_label
                .as_deref()
                .map(|label| jump_hint(label, SLIM_HEIGHT, t)),
        )
        .into_any_element()
}

fn shelf_header(
    header: &SidebarShelfHeaderView,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    let snoozed = header.shelf == crate::app_core::views::sidebar::Shelf::Snoozed;
    let text = if snoozed {
        t.info_foreground
    } else {
        fade(t.sidebar_muted_foreground, SHELF_TEXT)
    };
    let line = if snoozed {
        fade(t.info, SNOOZED_LINE)
    } else {
        fade(t.sidebar_border, SHELF_LINE)
    };
    let client = client.clone();
    let shelf = header.shelf.key();
    div()
        .flex_none()
        .mx(px(2.))
        .h(px(SHELF_HEIGHT))
        .when(header.push_to_bottom, |this| this.mt_auto())
        .child(
            div()
                .id(SharedString::from(format!("sidebar-{shelf}-shelf-toggle")))
                .flex()
                .size_full()
                .items_center()
                .gap(px(8.))
                .px(px(8.))
                .cursor_pointer()
                .text_size(px(TEXT_XS))
                .line_height(px(TEXT_XS_LINE))
                .font_weight(FontWeight::MEDIUM)
                .text_color(text)
                .on_click(move |_, _, cx| {
                    act(&client, cx, "toggleShelf", json!({ "shelf": shelf }))
                })
                .child(div().flex_none().child(header.label.clone()))
                .child(div().h(px(1.)).min_w(px(8.)).flex_1().bg(line))
                .child(
                    svg()
                        .path(if header.expanded {
                            "icons/chevron-up.svg"
                        } else {
                            "icons/chevron-down.svg"
                        })
                        .flex_none()
                        .size(px(12.))
                        .text_color(text),
                ),
        )
        .into_any_element()
}

fn show_more(label: &str, client: &Entity<CoreClient>, t: &Tokens) -> AnyElement {
    let hover = t.sidebar_row_hover;
    let foreground = t.sidebar_foreground;
    let client = client.clone();
    div()
        .id("sidebar-settled-show-more")
        .group("sidebar-settled-show-more")
        .flex()
        .h(px(SHOW_MORE_HEIGHT))
        .w_full()
        .items_center()
        .gap(px(10.))
        .rounded(px(8.))
        .px(px(10.))
        .cursor_pointer()
        .text_size(px(TEXT_SM))
        .line_height(px(TEXT_SM_LINE))
        .text_color(fade(t.sidebar_muted_foreground, SHOW_MORE_TEXT))
        .hover(move |style| style.bg(hover).text_color(foreground))
        .on_click(move |_, _, cx| act(&client, cx, "sidebarShowMoreSettled", json!({})))
        .child(
            svg()
                .path("icons/plus.svg")
                .flex_none()
                .size(px(16.))
                .text_color(fade(t.sidebar_muted_foreground, SHOW_MORE_TEXT))
                .group_hover("sidebar-settled-show-more", move |style| {
                    style.text_color(foreground)
                }),
        )
        .child(SharedString::from(label.to_owned()))
        .into_any_element()
}

fn empty_state(
    state: &SidebarEmptyStateView,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> AnyElement {
    let container = div()
        .flex()
        .flex_col()
        .items_center()
        .gap(px(8.))
        .px(px(8.))
        .py(px(24.))
        .text_size(px(TEXT_XS))
        .line_height(px(TEXT_XS_LINE))
        .text_color(fade(t.muted_foreground, EMPTY_TEXT));
    match state {
        SidebarEmptyStateView::NoProjects {
            label,
            action_label,
        } => {
            let client = client.clone();
            let hover = t.sidebar_row_hover;
            let foreground = t.sidebar_foreground;
            container
                .child(div().child(label.clone()))
                .child(
                    div()
                        .id("sidebar-empty-add-project")
                        .group("sidebar-empty-add-project")
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .rounded(px(8.))
                        .border_1()
                        .border_color(t.sidebar_border)
                        .px(px(10.))
                        .py(px(4.))
                        .cursor_pointer()
                        .text_size(px(11.))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.sidebar_muted_foreground)
                        .hover(move |style| style.bg(hover).text_color(foreground))
                        .on_click(move |_, _, cx| {
                            act(
                                &client,
                                cx,
                                "commandPaletteOpen",
                                json!({ "open": "add-project" }),
                            )
                        })
                        .child(
                            svg()
                                .path("icons/plus.svg")
                                .size(px(12.))
                                .text_color(t.sidebar_muted_foreground)
                                .group_hover("sidebar-empty-add-project", move |style| {
                                    style.text_color(foreground)
                                }),
                        )
                        .child(action_label.clone()),
                )
                .into_any_element()
        }
        SidebarEmptyStateView::NoThreads { label } => {
            container.child(label.clone()).into_any_element()
        }
    }
}

impl RenderOnce for Sidebar {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::sidebar(cx);
        let view = self.view;
        let client = self.client;
        let items: Vec<AnyElement> = view
            .items
            .iter()
            .map(|item| match item {
                SidebarItemView::Thread(row) => match row.variant {
                    RowVariant::Card => card_row(row, &client, &t, window, cx),
                    RowVariant::Slim => slim_row(row, &client, &t, window, cx),
                },
                SidebarItemView::Draft(row) => draft_row(row, &client, &t, window, cx),
                SidebarItemView::DraftDivider => draft_divider(&t),
                SidebarItemView::ShelfHeader(header) => shelf_header(header, &client, &t),
                SidebarItemView::ShowMore { label, .. } => show_more(label, &client, &t),
            })
            .collect();
        let has_items = !items.is_empty();
        let list = div()
            .relative()
            .flex()
            .flex_col()
            .gap(px(1.))
            .when(has_items, |this| this.flex_1())
            .children(items);
        div()
            .flex()
            .flex_col()
            .size_full()
            .child(
                SidebarChromeHeader::new(
                    view.header.brand_label.clone(),
                    view.header.stage_backdrop,
                    self.controls_left,
                )
                .pill(view.header.stage_pill.clone()),
            )
            .child(
                SidebarContent::new("sidebar-content")
                    .fill_height()
                    .fixed_header(SidebarGroup::new().child(SidebarThreadHeader::new(&view.header)))
                    .group(
                        SidebarGroup::new().flex_1().child(list).children(
                            view.empty_state
                                .as_ref()
                                .map(|state| empty_state(state, &client, &t)),
                        ),
                    ),
            )
            .child(SidebarChromeFooter::new(&view.footer, client.clone()))
    }
}
