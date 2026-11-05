use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Bounds, Entity, InteractiveElement, IntoElement, ParentElement, Pixels,
    RenderOnce, SharedString, StatefulInteractiveElement, Styled, Window, canvas, div, img, px,
    svg,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::git_actions::{GitMenuView, GitNoticeTone};
use crate::app_core::views::header_toolbar::GitToolbarView;
use crate::features::chat::git_actions_host::{GitActionsHost, HoverHint, send};
use crate::features::chat::header_overflow::{
    OverflowMenu, plain_row, set_overflow_open, sub_popup, sub_trigger, with_sub_popup,
};
use crate::features::chat::toolbar_parts::{
    CHILD_ICON_PADDING_LEFT, asset_icon, divider, split_chevron, split_main,
};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::group::Group;
use crate::ui::menu::{ICON_OPACITY, ICON_SIZE, MenuDensity, MenuItem, MenuPopup, MenuSubTrigger};
use crate::ui::popover::{Align, Side, black, dropdown_glass, positioned_with_priority, shadow};
use crate::ui::theme;
use crate::ui::theme::metrics::text;
use crate::ui::theme::tokens::Tokens;
use crate::ui::tooltip::{PADDING_X, PADDING_Y, SIDE_OFFSET};

const MONO_SOURCE_CONTROL_ICONS: &[&str] = &["github", "change-request"];
const QUICK_HINT_KEY: &str = "quick-action";
const HINT_LAYER: usize = 140;
const HINT_RADIUS: f32 = 8.;
const NOTICE_PADDING_X: f32 = 8.;
const NOTICE_PADDING_Y: f32 = 6.;
const DISABLED_REASON_MAX_WIDTH: f32 = 256.;
const COMPACT_WIDTH: f32 = 25.;

type Close = Rc<dyn Fn(&mut App)>;

fn git_icon(icon: &str) -> &'static str {
    match icon {
        "git-commit" => "git-commit-horizontal",
        "cloud-upload" => "cloud-upload",
        "cloud-download" => "cloud-download",
        "info" => "info",
        _ => "git-branch-plus",
    }
}

fn hint_popup(
    bounds: Bounds<Pixels>,
    label: String,
    side: Side,
    align: Align,
    cx: &App,
) -> AnyElement {
    let t = theme::active(cx);
    positioned_with_priority(
        bounds,
        side,
        align,
        SIDE_OFFSET,
        0.,
        HINT_LAYER,
        dropdown_glass(cx)
            .rounded(px(HINT_RADIUS))
            .shadow(vec![
                shadow(0., 4., 6., -1., black(0.05)),
                shadow(0., 2., 4., -2., black(0.05)),
            ])
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .text_color(t.popover_foreground)
            .child(
                div()
                    .px(px(PADDING_X))
                    .py(px(PADDING_Y))
                    .whitespace_nowrap()
                    .child(SharedString::from(label)),
            ),
    )
    .into_any_element()
}

fn hover_target(
    id: SharedString,
    key: String,
    host: &Entity<GitActionsHost>,
    child: impl IntoElement,
) -> gpui::Stateful<gpui::Div> {
    let hover_host = host.clone();
    let measure_host = host.clone();
    let measure_key = key.clone();
    div()
        .id(id)
        .relative()
        .on_hover(move |hovered, _, cx| {
            let key = key.clone();
            hover_host.update(cx, |host, cx| {
                let current = host.hover.as_ref().map(|hint| hint.key == key);
                if *hovered {
                    let bounds = host
                        .hover
                        .as_ref()
                        .map(|hint| hint.bounds)
                        .unwrap_or_default();
                    host.set_hover(Some(HoverHint { key, bounds }), cx);
                } else if current == Some(true) {
                    host.set_hover(None, cx);
                }
            })
        })
        .child(child)
        .child(
            canvas(
                move |bounds, _, cx| {
                    measure_host.update(cx, |host, _| {
                        if let Some(hint) =
                            host.hover.as_mut().filter(|hint| hint.key == measure_key)
                        {
                            hint.bounds = bounds;
                        }
                    })
                },
                |_, _, _, _| {},
            )
            .absolute()
            .size_full(),
        )
}

fn menu_icon(icon_id: &str, source_control_icon: &str, t: &Tokens) -> AnyElement {
    if icon_id == "source-control" {
        div()
            .flex_none()
            .opacity(ICON_OPACITY)
            .child(asset_icon(
                "source-control",
                source_control_icon,
                MONO_SOURCE_CONTROL_ICONS,
                t.muted_foreground,
            ))
            .into_any_element()
    } else {
        crate::ui::menu::icon(git_icon(icon_id), ICON_SIZE, t.muted_foreground)
            .opacity(ICON_OPACITY)
            .into_any_element()
    }
}

fn menu_rows(
    menu: &GitMenuView,
    host: &Entity<GitActionsHost>,
    client: &Entity<CoreClient>,
    density: MenuDensity,
    on_select: Close,
    cx: &App,
) -> (Vec<AnyElement>, Option<AnyElement>) {
    let t = theme::active(cx);
    let menu_presentation = density == MenuDensity::Touch;
    let hover = host.read(cx).hover.clone();
    let mut children: Vec<AnyElement> = Vec::new();
    let mut hint: Option<AnyElement> = None;
    for (index, item) in menu.items.iter().enumerate() {
        let content = div()
            .flex()
            .items_center()
            .gap(px(8.))
            .child(menu_icon(&item.icon_id, &menu.source_control_icon, &t))
            .child(
                div()
                    .min_w_0()
                    .truncate()
                    .child(SharedString::from(item.label.clone())),
            );
        let row = MenuItem::new(("git-menu-item", index))
            .density(density)
            .disabled(item.disabled);
        match (&item.disabled_reason, item.disabled) {
            (Some(reason), true) if menu_presentation => {
                children.push(
                    div()
                        .flex()
                        .flex_col()
                        .child(row.child(content))
                        .child(
                            div()
                                .max_w(px(DISABLED_REASON_MAX_WIDTH))
                                .px(px(NOTICE_PADDING_X))
                                .pb(px(NOTICE_PADDING_X))
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .text_color(t.muted_foreground)
                                .child(SharedString::from(reason.clone())),
                        )
                        .into_any_element(),
                );
            }
            (Some(reason), true) => {
                if let Some(active) = hover.as_ref().filter(|hint| hint.key == item.key) {
                    hint = Some(hint_popup(
                        active.bounds,
                        reason.clone(),
                        Side::Left,
                        Align::Center,
                        cx,
                    ));
                }
                children.push(
                    div()
                        .flex()
                        .child(hover_target(
                            SharedString::from(format!("git-menu-hint-{index}")),
                            item.key.clone(),
                            host,
                            row.child(content),
                        ))
                        .into_any_element(),
                );
            }
            _ => {
                let client = client.clone();
                let on_select = on_select.clone();
                let id = item.id.clone();
                children.push(
                    row.child(content)
                        .on_click(move |_, _, cx| {
                            on_select(cx);
                            send(&client, cx, "gitMenuItem", json!({ "id": id }))
                        })
                        .into_any_element(),
                );
            }
        }
    }
    if let Some(publish) = &menu.publish_item {
        let client = client.clone();
        let on_select = on_select.clone();
        children.push(
            MenuItem::new("git-menu-publish")
                .density(density)
                .disabled(publish.disabled)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(menu_icon(&publish.icon, &menu.source_control_icon, &t))
                        .child(SharedString::from(publish.label.clone())),
                )
                .on_click(move |_, _, cx| {
                    on_select(cx);
                    send(&client, cx, "gitPublishOpen", json!({}))
                })
                .into_any_element(),
        );
    }
    for notice in &menu.notices {
        children.push(
            div()
                .px(px(NOTICE_PADDING_X))
                .py(px(NOTICE_PADDING_Y))
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .text_color(match notice.tone {
                    GitNoticeTone::Warning => t.warning,
                    GitNoticeTone::Destructive => t.destructive,
                })
                .child(SharedString::from(notice.text.clone()))
                .into_any_element(),
        );
    }
    (children, hint)
}

fn menu_popup(
    menu: GitMenuView,
    host: &Entity<GitActionsHost>,
    client: &Entity<CoreClient>,
    cx: &App,
) -> AnyElement {
    let trigger = host.read(cx).menu_trigger;
    let (children, hint) = menu_rows(
        &menu,
        host,
        client,
        MenuDensity::Default,
        Rc::new(|_| {}),
        cx,
    );
    let dismiss = client.clone();
    let popup = MenuPopup::new("git-menu", trigger)
        .side(Side::Bottom)
        .align(Align::End)
        .on_dismiss(move |_, cx| send(&dismiss, cx, "gitMenuClose", json!({})))
        .children(children);
    div().child(popup).children(hint).into_any_element()
}

fn source_control_leading(icon: &str, t: &Tokens) -> AnyElement {
    let path = SharedString::from(format!("icons/source-control/{icon}.svg"));
    let glyph = if MONO_SOURCE_CONTROL_ICONS.contains(&icon) {
        svg()
            .path(path)
            .size(px(ICON_SIZE))
            .text_color(t.muted_foreground)
            .into_any_element()
    } else {
        img(path).size(px(ICON_SIZE)).into_any_element()
    };
    div()
        .flex_none()
        .opacity(ICON_OPACITY)
        .child(glyph)
        .into_any_element()
}

/// The control as rows of the header's "More header actions" menu (web presentation="menu").
pub fn overflow_entries(
    view: &GitToolbarView,
    client: &Entity<CoreClient>,
    overflow: &OverflowMenu,
    cx: &App,
) -> Vec<AnyElement> {
    let t = theme::active(cx);
    let close_menu = overflow.clone();
    let close: Close = Rc::new(move |cx| set_overflow_open(&close_menu, false, cx));
    match view {
        GitToolbarView::Hidden => Vec::new(),
        GitToolbarView::Init { label, disabled } => {
            let client = client.clone();
            vec![plain_row(
                overflow,
                "header-overflow-git-init",
                MenuItem::new("header-overflow-git-init-item")
                    .density(MenuDensity::Touch)
                    .disabled(*disabled)
                    .icon("git-branch-plus")
                    .label(label.clone())
                    .on_click(move |_, _, cx| {
                        close(cx);
                        send(&client, cx, "gitInit", json!({}))
                    })
                    .into_any_element(),
            )]
        }
        GitToolbarView::Repo {
            source_control_icon,
            quick_action,
            quick_action_icon,
            quick_action_menu_item_disabled,
            quick_action_disabled_reason,
            menu_trigger_disabled,
            submenu_label,
            ..
        } => {
            let mut entries: Vec<AnyElement> = Vec::new();
            let quick_client = client.clone();
            let quick_close = close.clone();
            let quick = MenuItem::new("header-overflow-git-quick-item")
                .density(MenuDensity::Touch)
                .disabled(*quick_action_menu_item_disabled)
                .map(|item| {
                    if quick_action_icon == "source-control" {
                        item.child(source_control_leading(source_control_icon, &t))
                    } else {
                        item.icon(git_icon(quick_action_icon))
                    }
                })
                .label(quick_action.label.clone())
                .on_click(move |_, _, cx| {
                    quick_close(cx);
                    send(&quick_client, cx, "gitQuickAction", json!({}))
                });
            entries.push(plain_row(
                overflow,
                "header-overflow-git-quick",
                div()
                    .flex()
                    .flex_col()
                    .child(quick)
                    .when_some(quick_action_disabled_reason.clone(), |this, reason| {
                        this.child(
                            div()
                                .max_w(px(DISABLED_REASON_MAX_WIDTH))
                                .px(px(NOTICE_PADDING_X))
                                .py(px(NOTICE_PADDING_Y))
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .text_color(t.warning)
                                .child(SharedString::from(reason)),
                        )
                    })
                    .into_any_element(),
            ));
            let host = GitActionsHost::global(cx);
            let rows = match (&host, host.as_ref().and_then(|host| host.read(cx).view(cx))) {
                (Some(host), Some(view)) => view
                    .menu
                    .as_ref()
                    .map(|menu| {
                        let (mut rows, hint) =
                            menu_rows(menu, host, client, MenuDensity::Touch, close.clone(), cx);
                        rows.extend(hint);
                        rows
                    })
                    .unwrap_or_default(),
                _ => Vec::new(),
            };
            let refresh = client.clone();
            entries.push(with_sub_popup(
                sub_trigger(
                    overflow,
                    "git",
                    MenuSubTrigger::new("header-overflow-sub-git", submenu_label.clone())
                        .leading(source_control_leading(source_control_icon, &t))
                        .disabled(*menu_trigger_disabled),
                    move |cx| send(&refresh, cx, "gitRefreshStatus", json!({})),
                    cx,
                ),
                sub_popup(overflow, "git", rows, cx),
            ));
            entries
        }
    }
}

#[derive(IntoElement)]
pub struct GitActionsControl {
    view: GitToolbarView,
    client: Entity<CoreClient>,
    compact: bool,
}

impl GitActionsControl {
    pub fn new(view: &GitToolbarView, client: Entity<CoreClient>) -> Self {
        Self {
            view: view.clone(),
            client,
            compact: false,
        }
    }

    pub fn compact(mut self, compact: bool) -> Self {
        self.compact = compact;
        self
    }
}

impl RenderOnce for GitActionsControl {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let client = self.client.clone();
        let compact = self.compact;
        match &self.view {
            GitToolbarView::Hidden => div().into_any_element(),
            GitToolbarView::Init { label, disabled } => Button::new("header-git-init")
                .variant(ButtonVariant::Outline)
                .size(ButtonSize::Xs)
                .icon("git-branch-plus")
                .label(label.clone())
                .disabled(*disabled)
                .on_click(move |_, _, cx| send(&client, cx, "gitInit", json!({})))
                .into_any_element(),
            GitToolbarView::Repo {
                source_control_icon,
                quick_action,
                quick_action_icon,
                quick_action_button_disabled,
                quick_action_disabled_reason,
                menu_trigger_disabled,
                ..
            } => {
                let host = GitActionsHost::global(cx);
                let view = host.as_ref().and_then(|host| host.read(cx).view(cx));
                let quick_client = client.clone();
                let main = split_main(Button::new("header-git-quick"))
                    .disabled(*quick_action_button_disabled)
                    .on_click(move |_, _, cx| send(&quick_client, cx, "gitQuickAction", json!({})))
                    .map(|button| {
                        if quick_action_icon == "source-control" {
                            button
                                .when(!compact, |button| button.pl(px(CHILD_ICON_PADDING_LEFT)))
                                .child(asset_icon(
                                    "source-control",
                                    source_control_icon,
                                    MONO_SOURCE_CONTROL_ICONS,
                                    t.muted_foreground,
                                ))
                        } else {
                            button.icon(git_icon(quick_action_icon))
                        }
                    })
                    .when(compact, |button| {
                        button
                            .w(px(COMPACT_WIDTH))
                            .accessibility_label(quick_action.label.clone())
                    })
                    .when(!compact, |button| button.label(quick_action.label.clone()));
                let main: AnyElement = match (&host, quick_action_disabled_reason) {
                    (Some(host), Some(_)) => hover_target(
                        "header-git-quick-hint".into(),
                        QUICK_HINT_KEY.to_string(),
                        host,
                        main,
                    )
                    .into_any_element(),
                    _ => main.into_any_element(),
                };
                let quick_hint = host.as_ref().and_then(|host| {
                    let hover = host.read(cx).hover.clone()?;
                    let reason = quick_action_disabled_reason.clone()?;
                    (hover.key == QUICK_HINT_KEY)
                        .then(|| hint_popup(hover.bounds, reason, Side::Bottom, Align::Start, cx))
                });
                let menu_open = view.as_ref().is_some_and(|view| view.menu_open);
                let toggle_client = client.clone();
                let chevron = split_chevron("header-git-menu", &t)
                    .disabled(*menu_trigger_disabled)
                    .on_click(move |_, _, cx| {
                        let action = if menu_open {
                            "gitMenuClose"
                        } else {
                            "gitMenuOpen"
                        };
                        send(&toggle_client, cx, action, json!({}))
                    });
                let chevron = match &host {
                    Some(host) => {
                        let measure = host.clone();
                        div()
                            .relative()
                            .flex()
                            .child(chevron)
                            .child(
                                canvas(
                                    move |bounds, _, cx| {
                                        measure.update(cx, |host, _| host.menu_trigger = bounds)
                                    },
                                    |_, _, _, _| {},
                                )
                                .absolute()
                                .size_full(),
                            )
                            .into_any_element()
                    }
                    None => chevron.into_any_element(),
                };
                let popup = match (&host, view.and_then(|view| view.menu.filter(|_| menu_open))) {
                    (Some(host), Some(menu)) => Some(menu_popup(menu, host, &client, cx)),
                    _ => None,
                };
                div()
                    .flex()
                    .flex_none()
                    .child(
                        Group::new()
                            .flex_none()
                            .child(main)
                            .when(!compact, |group| group.child(divider(&t)))
                            .child(chevron),
                    )
                    .children(popup)
                    .children(quick_hint)
                    .into_any_element()
            }
        }
    }
}
