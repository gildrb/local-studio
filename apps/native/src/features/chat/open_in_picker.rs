use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Bounds, Entity, FocusHandle, InteractiveElement, IntoElement, KeyDownEvent,
    ParentElement, Pixels, RenderOnce, SharedString, Styled, Window, canvas, div, img, px, svg,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::open_in::{OpenInMenuItem, OpenInPickerModel, OpenInView};
use crate::features::chat::header_overflow::{
    OverflowMenu, plain_row, set_overflow_open, sub_popup, sub_trigger, with_sub_popup,
};
use crate::features::chat::toolbar_parts::{
    CHILD_ICON_PADDING_LEFT, act, asset_icon, divider, split_chevron, split_main,
};
use crate::ui::button::Button;
use crate::ui::group::Group;
use crate::ui::menu::{ICON_SIZE, MenuDensity, MenuItem, MenuPopup, MenuSubTrigger};
use crate::ui::popover::Align;
use crate::ui::theme;
use crate::ui::theme::tokens::Tokens;

const MONO_EDITOR_ICONS: &[&str] = &["cursor", "trae", "zed", "folder-closed"];
const MENU_ICON_PULL: f32 = 2.;
const COMPACT_WIDTH: f32 = 25.;

type Close = Rc<dyn Fn(&mut App)>;

struct MenuState {
    open: bool,
    bounds: Bounds<Pixels>,
    focus: FocusHandle,
}

fn icon_color(kind: &str, t: &Tokens) -> gpui::Rgba {
    if kind == "brand" {
        t.foreground
    } else {
        t.muted_foreground
    }
}

fn menu_icon(icon: &str, kind: &str, t: &Tokens) -> AnyElement {
    let path = SharedString::from(format!("icons/editors/{icon}.svg"));
    let glyph = if MONO_EDITOR_ICONS.contains(&icon) {
        svg()
            .path(path)
            .size(px(ICON_SIZE))
            .text_color(icon_color(kind, t))
            .into_any_element()
    } else {
        img(path).size(px(ICON_SIZE)).into_any_element()
    };
    div()
        .relative()
        .flex_none()
        .w(px(ICON_SIZE - 2. * MENU_ICON_PULL))
        .h(px(ICON_SIZE))
        .child(
            div()
                .absolute()
                .top_0()
                .left(px(-MENU_ICON_PULL))
                .child(glyph),
        )
        .into_any_element()
}

pub fn service_url_request(
    view: Option<&OpenInView>,
    handled: &mut Option<u64>,
    client: &Entity<CoreClient>,
    cx: &mut App,
) {
    let Some(request) = view.and_then(|view| view.url_request.as_ref()) else {
        return;
    };
    if *handled == Some(request.id) {
        return;
    }
    *handled = Some(request.id);
    cx.open_url(&request.url);
    act(
        client,
        cx,
        "openInUrlOpened",
        json!({ "id": request.id, "opened": true }),
    );
}

fn open_params(editor_id: Option<&str>, target: Option<&str>) -> serde_json::Value {
    match target {
        Some(cwd) => json!({ "editorId": editor_id, "cwd": cwd }),
        None => json!({ "editorId": editor_id }),
    }
}

fn editor_items(
    view: &OpenInPickerModel,
    client: &Entity<CoreClient>,
    close: &Close,
    density: MenuDensity,
    target: Option<&str>,
    t: &Tokens,
) -> Vec<AnyElement> {
    view.menu_items
        .iter()
        .map(|item| match item {
            OpenInMenuItem::Notice { id, label } => {
                MenuItem::new(SharedString::from(format!("header-open-in-{id}")))
                    .density(density)
                    .disabled(true)
                    .label(label.clone())
                    .into_any_element()
            }
            OpenInMenuItem::Editor {
                id,
                label,
                icon,
                icon_kind,
                shortcut_label,
            } => {
                let client = client.clone();
                let close = close.clone();
                let params = open_params(Some(id), target);
                MenuItem::new(SharedString::from(format!("header-open-in-{id}")))
                    .density(density)
                    .child(menu_icon(icon, icon_kind, t))
                    .child(div().min_w_0().truncate().child(label.clone()))
                    .when_some(shortcut_label.clone(), |item, shortcut| {
                        item.shortcut(shortcut)
                    })
                    .on_click(move |_, _, cx| {
                        close(cx);
                        act(&client, cx, "openInEditor", params.clone());
                    })
                    .into_any_element()
            }
        })
        .collect()
}

/// The picker as rows of the header's "More header actions" menu (web presentation="menu").
pub fn overflow_entries(
    view: &OpenInPickerModel,
    client: &Entity<CoreClient>,
    menu: &OverflowMenu,
    cx: &App,
) -> Vec<AnyElement> {
    let t = theme::active(cx);
    let close_menu = menu.clone();
    let close: Close = Rc::new(move |cx| set_overflow_open(&close_menu, false, cx));
    let mut entries: Vec<AnyElement> = Vec::new();
    if let (Some(option), Some(label)) = (view.primary.as_ref(), view.primary_menu_label.as_ref()) {
        let client = client.clone();
        let close = close.clone();
        entries.push(plain_row(
            menu,
            "header-overflow-open-in-primary",
            MenuItem::new("header-overflow-open-in-run")
                .density(MenuDensity::Touch)
                .disabled(view.primary_menu_item_disabled)
                .child(menu_icon(&option.icon, &option.kind, &t))
                .child(div().min_w_0().truncate().child(label.clone()))
                .when_some(view.favorite_shortcut_label.clone(), |item, shortcut| {
                    item.shortcut(shortcut)
                })
                .on_click(move |_, _, cx| {
                    close(cx);
                    act(&client, cx, "openInEditor", json!({ "editorId": null }));
                })
                .into_any_element(),
        ));
    }
    let items = editor_items(view, client, &close, MenuDensity::Touch, None, &t);
    entries.push(with_sub_popup(
        sub_trigger(
            menu,
            "open-in",
            MenuSubTrigger::new("header-overflow-sub-open-in", view.submenu_label.clone())
                .icon("square-arrow-out-up-right"),
            |_| {},
            cx,
        ),
        sub_popup(menu, "open-in", items, cx),
    ));
    entries
}

#[derive(IntoElement)]
pub struct OpenInPicker {
    view: OpenInPickerModel,
    client: Entity<CoreClient>,
    compact: bool,
    icon_only: bool,
    id: SharedString,
    target: Option<String>,
}

impl OpenInPicker {
    pub fn new(view: &OpenInPickerModel, client: Entity<CoreClient>) -> Self {
        Self {
            view: view.clone(),
            client,
            compact: false,
            icon_only: false,
            id: SharedString::new_static("header-open-in"),
            target: None,
        }
    }

    pub fn compact(mut self, compact: bool) -> Self {
        self.compact = compact;
        self
    }

    pub fn icon_only(mut self, icon_only: bool) -> Self {
        self.icon_only = icon_only;
        self
    }

    pub fn target(mut self, id: &'static str, cwd: String) -> Self {
        self.id = SharedString::new_static(id);
        self.target = Some(cwd);
        self
    }
}

impl RenderOnce for OpenInPicker {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let view = self.view;
        let icon_only = self.compact || self.icon_only;
        let compact = icon_only;
        let id = self.id.clone();
        let target = self.target.clone();
        let state = window.use_keyed_state(
            SharedString::from(format!("{id}-menu-state")),
            cx,
            |_, cx| MenuState {
                open: false,
                bounds: Bounds::default(),
                focus: cx.focus_handle(),
            },
        );
        let (open, bounds, focus) = {
            let s = state.read(cx);
            (s.open, s.bounds, s.focus.clone())
        };
        let set_open = {
            let state = state.clone();
            move |open: bool, cx: &mut App| {
                state.update(cx, |s, cx| {
                    s.open = open;
                    cx.notify();
                });
            }
        };

        let client = self.client.clone();
        let primary_params = open_params(None, target.as_deref());
        let main = split_main(Button::new(id.clone()))
            .disabled(view.primary_button_disabled)
            .on_click(move |_, _, cx| act(&client, cx, "openInEditor", primary_params.clone()))
            .when_some(view.primary.as_ref(), |button, option| {
                button
                    .when(!compact, |button| button.pl(px(CHILD_ICON_PADDING_LEFT)))
                    .child(asset_icon(
                        "editors",
                        &option.icon,
                        MONO_EDITOR_ICONS,
                        icon_color(&option.kind, &t),
                    ))
            })
            .when(compact, |button| {
                button
                    .w(px(COMPACT_WIDTH))
                    .accessibility_label(if self.compact {
                        view.compact_aria_label.clone()
                    } else {
                        view.primary_button_label.clone()
                    })
            })
            .when(!compact, |button| {
                button.child(SharedString::from(view.primary_button_label.clone()))
            });

        let toggle = set_open.clone();
        let toggle_focus = focus.clone();
        let measure = state.clone();
        let chevron = div()
            .relative()
            .flex_none()
            .child(
                split_chevron(SharedString::from(format!("{id}-menu")), &t)
                    .accessibility_label(view.choose_editor_aria_label.clone())
                    .pressed(open)
                    .on_click(move |_, window, cx| {
                        toggle(!open, cx);
                        if !open {
                            toggle_focus.focus(window, cx);
                        }
                    }),
            )
            .child(
                canvas(
                    move |bounds, _, cx| measure.update(cx, |s, _| s.bounds = bounds),
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            );

        let popup = open.then(|| {
            let close_state = set_open.clone();
            let close: Close = Rc::new(move |cx| close_state(false, cx));
            let items = editor_items(
                &view,
                &self.client,
                &close,
                MenuDensity::Default,
                target.as_deref(),
                &t,
            );
            let dismiss = set_open.clone();
            let escape = set_open.clone();
            MenuPopup::new(SharedString::from(format!("{id}-popup")), bounds)
                .align(Align::End)
                .on_dismiss(move |window, cx| {
                    if !bounds.contains(&window.mouse_position()) {
                        dismiss(false, cx);
                    }
                })
                .child(
                    div()
                        .track_focus(&focus)
                        .on_key_down(move |event: &KeyDownEvent, _, cx| {
                            if event.keystroke.key == "escape" {
                                escape(false, cx);
                                cx.stop_propagation();
                            }
                        })
                        .flex()
                        .flex_col()
                        .children(items),
                )
        });

        Group::new()
            .flex_none()
            .child(main)
            .when(!icon_only || self.compact, |group| group.child(divider(&t)))
            .child(chevron)
            .children(popup)
    }
}
