use gpui::component::input::{InputEvent, InputState};
use gpui::{
    AnyElement, App, AppContext, Bounds, ClickEvent, Context, Corners, Entity, Focusable, Global,
    InteractiveElement, IntoElement, KeyDownEvent, ParentElement, Pixels, Point, SharedString,
    StatefulInteractiveElement, Styled, Window, canvas, div, px, svg,
};
use serde_json::json;

use crate::app::workspace_breadcrumb::WorkspaceBreadcrumbText;
use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::thread_header::{
    HeaderContextMenuAction, ThreadTitleModel, ThreadTitleView,
};
use crate::features::chat::toolbar_parts::act;
use crate::ui::button::outset;
use crate::ui::input::bare_input;
use crate::ui::theme;
use crate::ui::theme::metrics::text;
use crate::ui::theme::tokens::fade;
use crate::ui::tooltip::Tooltip;

const TITLE_GAP: f32 = 4.;
const TITLE_RADIUS: f32 = 6.;
const CHEVRON: f32 = 14.;
const MENU_OFFSET_Y: f32 = 4.;
const RENAME_HEIGHT: f32 = 20.;
const RENAME_RING: f32 = 1.;
const RENAME_RING_IDLE: f32 = 0.5;

struct ThreadTitleHandle(Entity<ThreadTitleHost>);

impl Global for ThreadTitleHandle {}

/// The chat header's thread title: menu button, inline rename and breadcrumb context menu.
pub struct ThreadTitleHost {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<ThreadTitleView>>>,
    rename: Entity<InputState>,
    rename_revision: u64,
    rename_settled: bool,
    title_bounds: Bounds<Pixels>,
    chevron_bounds: Bounds<Pixels>,
    menu_may_be_pending: bool,
}

impl ThreadTitleHost {
    pub fn install(client: &Entity<CoreClient>, window: &mut Window, cx: &mut App) {
        if cx.has_global::<ThreadTitleHandle>() {
            return;
        }
        let host = cx.new(|cx| Self::new(client.clone(), window, cx));
        cx.set_global(ThreadTitleHandle(host));
    }

    pub fn global(cx: &App) -> Option<Entity<ThreadTitleHost>> {
        cx.try_global::<ThreadTitleHandle>()
            .map(|handle| handle.0.clone())
    }

    fn new(client: Entity<CoreClient>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let view =
            CoreClient::subscribe::<Option<ThreadTitleView>>(&client, "threadTitle", json!({}), cx);
        let rename = cx.new(|cx| InputState::new(window, cx));
        cx.subscribe_in(
            &rename,
            window,
            |host, state, event: &InputEvent, _, cx| match event {
                InputEvent::PressEnter { .. } | InputEvent::Blur => {
                    host.commit(state.read(cx).value().to_string(), cx)
                }
                _ => {}
            },
        )
        .detach();
        cx.observe_in(&view, window, |host, _, window, cx| host.sync(window, cx))
            .detach();
        Self {
            client,
            view,
            rename,
            rename_revision: 0,
            rename_settled: true,
            title_bounds: Bounds::default(),
            chevron_bounds: Bounds::default(),
            menu_may_be_pending: false,
        }
    }

    pub fn view(&self, cx: &App) -> Option<ThreadTitleView> {
        self.view.read(cx).data.clone().flatten()
    }

    fn sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let renaming = self.view(cx).and_then(|view| match view.title {
            ThreadTitleModel::Renaming { draft, .. } => Some((view.rename_revision, draft)),
            _ => None,
        });
        let Some((revision, draft)) = renaming else {
            self.rename_revision = 0;
            self.rename_settled = true;
            cx.notify();
            return;
        };
        if revision == self.rename_revision {
            return;
        }
        self.rename_revision = revision;
        self.rename_settled = false;
        self.rename.update(cx, |state, cx| {
            state.set_value(draft, window, cx);
            state.focus(window, cx);
            state.select_all(window, cx);
        });
        cx.notify();
    }

    fn commit(&mut self, title: String, cx: &mut Context<Self>) {
        if self.rename_settled {
            return;
        }
        self.rename_settled = true;
        act(
            &self.client,
            cx,
            "threadTitleRenameCommit",
            json!({ "title": title }),
        );
    }

    fn cancel(&mut self, cx: &mut Context<Self>) {
        if self.rename_settled {
            return;
        }
        self.rename_settled = true;
        act(&self.client, cx, "threadTitleRenameCancel", json!({}));
    }

    fn click(&mut self, event: &ClickEvent, cx: &mut Context<Self>) {
        let modifiers = event.modifiers();
        let anchor = self.title_bounds;
        self.menu_may_be_pending = true;
        act(
            &self.client,
            cx,
            "threadTitleClick",
            json!({
                "clickCount": if event.is_keyboard() { 0 } else { event.click_count() },
                "onChevron": self.chevron_bounds.contains(&event.position()),
                "hasModifier": modifiers.control || modifiers.alt || modifiers.shift || modifiers.platform,
                "anchor": {
                    "x": f32::from(anchor.left()),
                    "y": f32::from(anchor.bottom()) + MENU_OFFSET_Y,
                },
            }),
        );
    }

    fn cancel_pending_menu(&mut self, cx: &mut Context<Self>) {
        if !self.menu_may_be_pending {
            return;
        }
        self.menu_may_be_pending = false;
        act(&self.client, cx, "threadTitleCancelPendingMenu", json!({}));
    }

    /// Right-click in the breadcrumb opens the thread menu, or project settings for a draft.
    pub fn context_menu(host: &Entity<Self>, position: Point<Pixels>, cx: &mut App) -> bool {
        let this = host.read(cx);
        let Some(view) = this.view(cx) else {
            return false;
        };
        if view.context_menu == HeaderContextMenuAction::Ignore {
            return false;
        }
        let client = this.client.clone();
        act(
            &client,
            cx,
            "threadHeaderContextMenu",
            json!({ "x": f32::from(position.x), "y": f32::from(position.y) }),
        );
        true
    }

    pub fn render_title(host: &Entity<Self>, window: &mut Window, cx: &mut App) -> AnyElement {
        let this = host.read(cx);
        let Some(view) = this.view(cx) else {
            return div().into_any_element();
        };
        let t = theme::active(cx);
        match view.title {
            ThreadTitleModel::Renaming { .. } => {
                let focused = this.rename.focus_handle(cx).is_focused(window);
                let ring = if focused {
                    t.ring
                } else {
                    fade(t.ring, RENAME_RING_IDLE)
                };
                let escape = host.clone();
                div()
                    .relative()
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .h(px(RENAME_HEIGHT))
                    .rounded(px(TITLE_RADIUS))
                    .text_color(t.foreground)
                    .on_key_down(move |event: &KeyDownEvent, _, cx| {
                        if event.keystroke.key == "escape" {
                            cx.stop_propagation();
                            escape.update(cx, |host, cx| host.cancel(cx));
                        }
                    })
                    .child(
                        bare_input(&this.rename, RENAME_HEIGHT, 0., 0., text::SM, false)
                            .w_full()
                            .min_w_0(),
                    )
                    .child(outset(
                        Corners::all(px(TITLE_RADIUS)),
                        0.,
                        0.,
                        RENAME_RING,
                        ring,
                    ))
                    .into_any_element()
            }
            ThreadTitleModel::Menu { text, tooltip, .. } => {
                let click = host.clone();
                let blur = host.clone();
                let measure = host.clone();
                let chevron_measure = host.clone();
                div()
                    .id("thread-title")
                    .group("thread-title")
                    .relative()
                    .flex()
                    .min_w_0()
                    .max_w_full()
                    .items_center()
                    .gap(px(TITLE_GAP))
                    .rounded(px(TITLE_RADIUS))
                    .cursor_pointer()
                    .tooltip(Tooltip::text(SharedString::from(tooltip)))
                    .on_click(move |event, _, cx| {
                        click.update(cx, |host, cx| host.click(event, cx))
                    })
                    .on_mouse_down_out(move |_, _, cx| {
                        blur.update(cx, |host, cx| host.cancel_pending_menu(cx))
                    })
                    .child(div().min_w_0().child(WorkspaceBreadcrumbText::new(text)))
                    .child(
                        div()
                            .relative()
                            .flex_none()
                            .size(px(CHEVRON))
                            .opacity(0.)
                            .group_hover("thread-title", |s| s.opacity(1.))
                            .child(
                                svg()
                                    .path("icons/chevron-down.svg")
                                    .size(px(CHEVRON))
                                    .text_color(t.muted_foreground),
                            )
                            .child(
                                canvas(
                                    move |bounds, _, cx| {
                                        chevron_measure
                                            .update(cx, |host, _| host.chevron_bounds = bounds);
                                    },
                                    |_, _, _, _| {},
                                )
                                .absolute()
                                .size_full(),
                            ),
                    )
                    .child(
                        canvas(
                            move |bounds, _, cx| {
                                measure.update(cx, |host, _| host.title_bounds = bounds);
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full(),
                    )
                    .into_any_element()
            }
            ThreadTitleModel::Static { text, tooltip, .. } => div()
                .id("thread-title")
                .flex()
                .flex_1()
                .min_w_0()
                .tooltip(Tooltip::text(SharedString::from(tooltip)))
                .child(WorkspaceBreadcrumbText::new(text))
                .into_any_element(),
        }
    }
}
