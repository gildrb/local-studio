use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Bounds, Entity, FocusHandle, InteractiveElement, IntoElement, KeyDownEvent,
    ParentElement, Pixels, RenderOnce, SharedString, Styled, Window, canvas, div, px,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::project_scripts::{ProjectScriptsToolbar, ProjectScriptsToolbarModel};
use crate::features::chat::header_overflow::{
    OverflowMenu, plain_row, set_overflow_open, sub_popup, sub_trigger, with_sub_popup,
};
use crate::features::chat::project_scripts_host::{script_icon, send};
use crate::features::chat::toolbar_parts::{divider, split_chevron, split_main};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::group::Group;
use crate::ui::menu::{
    MenuDensity, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuShortcut, MenuSubTrigger,
    icon,
};
use crate::ui::popover::Align;
use crate::ui::theme;
use crate::ui::theme::tokens::Tokens;

const TRIGGER_ICON: f32 = 14.;
const EDIT_BUTTON: f32 = 24.;
const EDIT_ICON: f32 = 14.;
const IMPORT_ICON: f32 = 14.;
const COMPACT_WIDTH: f32 = 24.;
const COMPACT_GROUPED_WIDTH: f32 = 25.;
const MENU_SHORTCUT_RESERVE: f32 = 28.;

type Close = Rc<dyn Fn(&mut App)>;

struct MenuState {
    open: bool,
    bounds: Bounds<Pixels>,
    focus: FocusHandle,
}

fn set_open(state: &Entity<MenuState>, open: bool, cx: &mut App) {
    state.update(cx, |s, cx| {
        s.open = open;
        cx.notify();
    });
}

fn closer(state: &Entity<MenuState>) -> Close {
    let state = state.clone();
    Rc::new(move |cx| set_open(&state, false, cx))
}

fn measured(element: impl IntoElement, state: &Entity<MenuState>) -> gpui::Div {
    let measure = state.clone();
    div().relative().flex_none().child(element).child(
        canvas(
            move |bounds, _, cx| measure.update(cx, |s, _| s.bounds = bounds),
            |_, _, _, _| {},
        )
        .absolute()
        .size_full(),
    )
}

fn import_items(
    model: &ProjectScriptsToolbarModel,
    client: &Entity<CoreClient>,
    close: &Close,
    density: MenuDensity,
    t: &Tokens,
) -> Vec<AnyElement> {
    if model.import_items.is_empty() {
        return Vec::new();
    }
    let mut items: Vec<AnyElement> = Vec::new();
    if model.show_import_separator {
        items.push(MenuSeparator::new().into_any_element());
    }
    items.push(MenuGroupLabel::new(model.import_group_label.clone()).into_any_element());
    for item in &model.import_items {
        let client = client.clone();
        let close = close.clone();
        let key = item.key.clone();
        items.push(
            MenuItem::new(SharedString::from(format!(
                "header-script-import-{}",
                item.key
            )))
            .density(density)
            .icon(script_icon(&item.icon))
            .label(item.label.clone())
            .child(div().ml_auto().flex_none().child(icon(
                "download",
                IMPORT_ICON,
                t.secondary_label,
            )))
            .on_click(move |_, _, cx| {
                close(cx);
                send(&client, cx, "projectScriptsImport", json!({ "key": key }));
            })
            .into_any_element(),
        );
    }
    items
}

fn add_item(
    model: &ProjectScriptsToolbarModel,
    client: &Entity<CoreClient>,
    close: &Close,
    density: MenuDensity,
) -> AnyElement {
    let client = client.clone();
    let close = close.clone();
    MenuItem::new("header-script-add-item")
        .density(density)
        .icon("plus")
        .label(model.add_action_label.clone())
        .on_click(move |_, _, cx| {
            close(cx);
            send(&client, cx, "projectScriptsAdd", json!({}));
        })
        .into_any_element()
}

fn script_items(
    model: &ProjectScriptsToolbarModel,
    client: &Entity<CoreClient>,
    close: &Close,
    density: MenuDensity,
    t: &Tokens,
) -> Vec<AnyElement> {
    let menu_presentation = density == MenuDensity::Touch;
    model
        .script_items
        .iter()
        .map(|item| {
            let group = SharedString::from(format!("header-script-item-{}", item.script_id));
            let run_client = client.clone();
            let run_close = close.clone();
            let run_id = item.script_id.clone();
            let edit_client = client.clone();
            let edit_close = close.clone();
            let edit_id = item.script_id.clone();
            let shortcut = item.shortcut_label.clone().map(|shortcut| {
                div()
                    .when(!menu_presentation, |this| {
                        this.group_hover(group.clone(), |s| s.opacity(0.))
                    })
                    .when(menu_presentation, |this| this.mr(px(MENU_SHORTCUT_RESERVE)))
                    .child(MenuShortcut::new(shortcut))
            });
            let slot = div()
                .relative()
                .ml_auto()
                .flex()
                .flex_none()
                .items_center()
                .justify_end()
                .h(px(EDIT_BUTTON))
                .min_w(px(EDIT_BUTTON))
                .children(shortcut)
                .child(
                    div()
                        .absolute()
                        .right_0()
                        .top_0()
                        .flex()
                        .when(!menu_presentation, |this| {
                            this.opacity(0.)
                                .group_hover(group.clone(), |s| s.opacity(1.))
                        })
                        .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| {
                            cx.stop_propagation();
                        })
                        .child(
                            Button::new(SharedString::from(format!(
                                "header-script-edit-{}",
                                item.script_id
                            )))
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::IconXs)
                            .w(px(EDIT_BUTTON))
                            .h(px(EDIT_BUTTON))
                            .icon("settings")
                            .icon_size(EDIT_ICON)
                            .icon_color(t.muted_foreground)
                            .accessibility_label(item.edit_aria_label.clone())
                            .on_click(move |_, _, cx| {
                                cx.stop_propagation();
                                edit_close(cx);
                                send(
                                    &edit_client,
                                    cx,
                                    "projectScriptsEdit",
                                    json!({ "scriptId": edit_id }),
                                );
                            }),
                        ),
                );
            div()
                .group(group.clone())
                .child(
                    MenuItem::new(SharedString::from(format!(
                        "header-script-run-{}",
                        item.script_id
                    )))
                    .density(density)
                    .icon(script_icon(&item.icon))
                    .label(item.label.clone())
                    .child(slot)
                    .on_click(move |_, _, cx| {
                        run_close(cx);
                        send(
                            &run_client,
                            cx,
                            "projectScriptsRun",
                            json!({ "scriptId": run_id }),
                        );
                    }),
                )
                .into_any_element()
        })
        .collect()
}

fn popup(
    id: &'static str,
    state: &Entity<MenuState>,
    bounds: Bounds<Pixels>,
    focus: &FocusHandle,
    items: Vec<AnyElement>,
) -> MenuPopup {
    let dismiss = state.clone();
    let escape = state.clone();
    MenuPopup::new(id, bounds)
        .align(Align::End)
        .on_dismiss(move |window, cx| {
            if !bounds.contains(&window.mouse_position()) {
                set_open(&dismiss, false, cx);
            }
        })
        .child(
            div()
                .track_focus(focus)
                .on_key_down(move |event: &KeyDownEvent, _, cx| {
                    if event.keystroke.key == "escape" {
                        set_open(&escape, false, cx);
                        cx.stop_propagation();
                    }
                })
                .flex()
                .flex_col()
                .children(items),
        )
}

/// The control as rows of the header's "More header actions" menu (web presentation="menu").
pub fn overflow_entries(
    model: &ProjectScriptsToolbarModel,
    client: &Entity<CoreClient>,
    menu: &OverflowMenu,
    cx: &App,
) -> Vec<AnyElement> {
    let t = theme::active(cx);
    let close_menu = menu.clone();
    let close: Close = Rc::new(move |cx| set_overflow_open(&close_menu, false, cx));
    let mut entries: Vec<AnyElement> = Vec::new();
    if let Some(primary) = model.primary.as_ref() {
        let client = client.clone();
        let close = close.clone();
        let script_id = primary.script.id.clone();
        entries.push(plain_row(
            menu,
            "header-overflow-script-primary",
            MenuItem::new("header-overflow-script-run")
                .density(MenuDensity::Touch)
                .icon(script_icon(&primary.icon))
                .label(primary.run_label.clone())
                .when_some(primary.shortcut_label.clone(), |item, shortcut| {
                    item.shortcut(shortcut)
                })
                .on_click(move |_, _, cx| {
                    close(cx);
                    send(
                        &client,
                        cx,
                        "projectScriptsRun",
                        json!({ "scriptId": script_id }),
                    );
                })
                .into_any_element(),
        ));
    }
    if model.menu_kind == "submenu" {
        let mut items = script_items(model, client, &close, MenuDensity::Touch, &t);
        items.extend(import_items(model, client, &close, MenuDensity::Touch, &t));
        items.push(add_item(model, client, &close, MenuDensity::Touch));
        entries.push(with_sub_popup(
            sub_trigger(
                menu,
                "scripts",
                MenuSubTrigger::new("header-overflow-sub-scripts", model.submenu_label.clone())
                    .icon(script_icon(&model.submenu_icon)),
                |_| {},
                cx,
            ),
            sub_popup(menu, "scripts", items, cx),
        ));
    } else {
        let client = client.clone();
        entries.push(plain_row(
            menu,
            "header-overflow-script-add-project",
            MenuItem::new("header-overflow-script-add")
                .density(MenuDensity::Touch)
                .icon("plus")
                .label(model.add_project_action_label.clone())
                .on_click(move |_, _, cx| {
                    close(cx);
                    send(&client, cx, "projectScriptsAdd", json!({}));
                })
                .into_any_element(),
        ));
    }
    entries
}

#[derive(IntoElement)]
pub struct ProjectScriptsControl {
    model: ProjectScriptsToolbarModel,
    client: Entity<CoreClient>,
    compact: bool,
}

impl ProjectScriptsControl {
    pub fn new(model: ProjectScriptsToolbarModel, client: Entity<CoreClient>) -> Self {
        Self {
            model,
            client,
            compact: false,
        }
    }

    pub fn compact(mut self, compact: bool) -> Self {
        self.compact = compact;
        self
    }
}

impl RenderOnce for ProjectScriptsControl {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let model = self.model;
        let client = self.client;
        let compact = self.compact;
        let state = window.use_keyed_state("header-script-menu-state", cx, |_, cx| MenuState {
            open: false,
            bounds: Bounds::default(),
            focus: cx.focus_handle(),
        });
        let (open, bounds, focus) = {
            let s = state.read(cx);
            (s.open, s.bounds, s.focus.clone())
        };
        let close = closer(&state);
        let toggle = {
            let state = state.clone();
            let focus = focus.clone();
            move |_: &gpui::ClickEvent, window: &mut Window, cx: &mut App| {
                set_open(&state, !open, cx);
                if !open {
                    focus.focus(window, cx);
                }
            }
        };
        match &model.toolbar {
            ProjectScriptsToolbar::Split { primary } => {
                let run_client = client.clone();
                let primary_id = primary.script.id.clone();
                let items = open.then(|| {
                    let mut items = script_items(&model, &client, &close, MenuDensity::Default, &t);
                    items.extend(import_items(
                        &model,
                        &client,
                        &close,
                        MenuDensity::Default,
                        &t,
                    ));
                    items.push(add_item(&model, &client, &close, MenuDensity::Default));
                    popup("header-script-menu-popup", &state, bounds, &focus, items)
                });
                Group::new()
                    .flex_none()
                    .child(
                        split_main(Button::new("header-script-run"))
                            .icon(script_icon(&primary.icon))
                            .when(compact, |button| button.w(px(COMPACT_GROUPED_WIDTH)))
                            .when(!compact, |button| button.label(primary.name.clone()))
                            .accessibility_label(primary.run_label.clone())
                            .on_click(move |_, _, cx| {
                                send(
                                    &run_client,
                                    cx,
                                    "projectScriptsRun",
                                    json!({ "scriptId": primary_id }),
                                );
                            }),
                    )
                    .when(!compact, |group| group.child(divider(&t)))
                    .child(measured(
                        split_chevron("header-script-menu", &t)
                            .accessibility_label(model.menu_trigger_aria_label.clone())
                            .pressed(open)
                            .on_click(toggle),
                        &state,
                    ))
                    .children(items)
                    .into_any_element()
            }
            ProjectScriptsToolbar::ImportMenu => {
                let items = open.then(|| {
                    let mut items = import_items(&model, &client, &close, MenuDensity::Default, &t);
                    items.push(add_item(&model, &client, &close, MenuDensity::Default));
                    popup("header-script-import-popup", &state, bounds, &focus, items)
                });
                div()
                    .flex_none()
                    .child(measured(
                        Button::new("header-script-import")
                            .variant(ButtonVariant::Outline)
                            .size(ButtonSize::Xs)
                            .icon("plus")
                            .icon_size(TRIGGER_ICON)
                            .when(!compact, |button| {
                                button.label(model.add_action_label.clone())
                            })
                            .icon_end("chevron-down")
                            .accessibility_label(model.import_menu_trigger_aria_label.clone())
                            .pressed(open)
                            .on_click(toggle),
                        &state,
                    ))
                    .children(items)
                    .into_any_element()
            }
            ProjectScriptsToolbar::AddButton => Button::new("header-script-add")
                .variant(ButtonVariant::Outline)
                .size(ButtonSize::Xs)
                .icon("plus")
                .icon_size(TRIGGER_ICON)
                .when(compact, |button| button.w(px(COMPACT_WIDTH)))
                .when(!compact, |button| {
                    button.label(model.add_action_label.clone())
                })
                .accessibility_label(model.add_action_label.clone())
                .on_click(move |_, _, cx| send(&client, cx, "projectScriptsAdd", json!({})))
                .into_any_element(),
        }
    }
}
