use gpui::component::Icon;
use gpui::component::native_menu::NativeMenu;
use gpui::{App, AppContext, ClipboardItem, Context, Entity, Global, Window, point, px};
use serde_json::json;

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::thread_header::{
    ClipboardWriteView, ContextMenuItemView, ContextMenuRequestView,
};
use crate::features::chat::toolbar_parts::act;

const DESTRUCTIVE_ICON: &str = "icons/trash.svg";

#[derive(Clone, Debug, PartialEq, gpui::Action)]
#[action(namespace = local_studio, no_json)]
pub struct ContextMenuPick {
    pub request_id: u64,
    pub item_id: String,
}

struct NativeContextMenuHandle(#[allow(dead_code)] Entity<NativeContextMenuHost>);

impl Global for NativeContextMenuHandle {}

/// Shows the core's `contextMenu` requests as OS menus and performs its clipboard writes.
pub struct NativeContextMenuHost {
    client: Entity<CoreClient>,
    menus: Entity<ViewState<Option<ContextMenuRequestView>>>,
    clipboard: Entity<ViewState<Vec<ClipboardWriteView>>>,
    shown: u64,
    written: u64,
}

impl NativeContextMenuHost {
    pub fn install(client: &Entity<CoreClient>, window: &mut Window, cx: &mut App) {
        if cx.has_global::<NativeContextMenuHandle>() {
            return;
        }
        let picks = client.clone();
        cx.on_action(move |pick: &ContextMenuPick, cx: &mut App| {
            act(
                &picks,
                cx,
                "contextMenuSelect",
                json!({ "requestId": pick.request_id, "itemId": pick.item_id }),
            );
        });
        let host = cx.new(|cx| Self::new(client.clone(), window, cx));
        cx.set_global(NativeContextMenuHandle(host));
    }

    fn new(client: Entity<CoreClient>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let menus = CoreClient::subscribe::<Option<ContextMenuRequestView>>(
            &client,
            "contextMenu",
            json!({}),
            cx,
        );
        let clipboard = CoreClient::subscribe::<Vec<ClipboardWriteView>>(
            &client,
            "clipboardWrites",
            json!({}),
            cx,
        );
        cx.observe_in(&menus, window, |host, _, window, cx| {
            host.show_menu(window, cx)
        })
        .detach();
        cx.observe(&clipboard, |host, _, cx| host.write_clipboard(cx))
            .detach();
        Self {
            client,
            menus,
            clipboard,
            shown: 0,
            written: 0,
        }
    }

    fn show_menu(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(request) = self.menus.read(cx).data.clone().flatten() else {
            return;
        };
        if request.id <= self.shown {
            return;
        }
        self.shown = request.id;
        act(
            &self.client,
            cx,
            "contextMenuShown",
            json!({ "requestId": request.id }),
        );
        let menu = build_menu(&normalize(&request.items), request.id);
        if menu.is_empty() {
            act(
                &self.client,
                cx,
                "contextMenuSelect",
                json!({ "requestId": request.id, "itemId": null }),
            );
            return;
        }
        let zoom = if crate::platform::MAC {
            window.zoom()
        } else {
            1.
        };
        menu.show(
            point(px(request.position.x * zoom), px(request.position.y * zoom)),
            window,
            cx,
        );
    }

    fn write_clipboard(&mut self, cx: &mut Context<Self>) {
        let writes = self.clipboard.read(cx).data.clone().unwrap_or_default();
        for write in writes {
            if write.id <= self.written {
                continue;
            }
            self.written = write.id;
            cx.write_to_clipboard(ClipboardItem::new_string(write.text));
            act(
                &self.client,
                cx,
                "clipboardWritten",
                json!({ "id": write.id, "ok": true }),
            );
        }
    }
}

/// Electron drops header rows and empty submenus before building its native menu.
fn normalize(items: &[ContextMenuItemView]) -> Vec<ContextMenuItemView> {
    items
        .iter()
        .filter(|item| !item.header)
        .filter_map(|item| match &item.children {
            Some(children) => {
                let children = normalize(children);
                (!children.is_empty()).then(|| ContextMenuItemView {
                    children: Some(children),
                    ..item.clone()
                })
            }
            None => Some(item.clone()),
        })
        .collect()
}

/// Mirrors Electron's template: explicit separators, one implicit separator before the
/// first destructive item, checkbox items, and a trash glyph on destructive leaves.
fn build_menu(items: &[ContextMenuItemView], request_id: u64) -> NativeMenu {
    let mut menu = NativeMenu::new();
    let mut last_separator = false;
    let mut inserted_destructive_separator = false;
    let mut section_started_by_separator = false;
    let separate = |menu: NativeMenu, count: usize, last_separator: &mut bool| {
        if count == 0 || *last_separator {
            return menu;
        }
        *last_separator = true;
        menu.separator()
    };
    for (count, item) in items.iter().enumerate() {
        if item.separator_before {
            menu = separate(menu, count, &mut last_separator);
            section_started_by_separator = true;
        }
        if item.destructive
            && !inserted_destructive_separator
            && !section_started_by_separator
            && count > 0
        {
            menu = separate(menu, count, &mut last_separator);
            inserted_destructive_separator = true;
        }
        let pick = Box::new(ContextMenuPick {
            request_id,
            item_id: item.id.clone(),
        });
        menu = match &item.children {
            Some(children) if !item.disabled => {
                menu.submenu(item.label.clone(), build_menu(children, request_id))
            }
            Some(_) => menu.menu_with_disabled(item.label.clone(), true, pick),
            None if item.destructive => menu.menu_with_icon_disabled(
                item.label.clone(),
                Icon::empty().path(DESTRUCTIVE_ICON),
                item.disabled,
                pick,
            ),
            None => match item.checked {
                Some(checked) if !item.disabled => {
                    menu.menu_with_check(item.label.clone(), checked, pick)
                }
                _ => menu.menu_with_disabled(item.label.clone(), item.disabled, pick),
            },
        };
        last_separator = false;
    }
    menu
}
