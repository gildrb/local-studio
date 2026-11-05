use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, ClickEvent, FontWeight, InteractiveElement, IntoElement, ParentElement,
    RenderOnce, SharedString, StatefulInteractiveElement, Styled, Window, div, px, svg,
};
use serde_json::{Value, json};

use crate::app_core::views::sidebar::SidebarHeaderView;
use crate::features::drafts_host::DraftsHost;
use crate::ui::project_favicon::ProjectFavicon;
use crate::ui::sidebar::{SidebarMenuButton, SidebarMenuButtonSize};
use crate::ui::theme;
use crate::ui::tooltip::Tooltip;

const FIELD_HEIGHT: f32 = 32.;
const ICON_BUTTON: f32 = 28.;
const ICON: f32 = 16.;
const TEXT_SM: f32 = 14.;
const INPUT_LINE: f32 = 21.;

type ClickHandler = Box<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

fn act(action: &'static str, params: Value) -> impl Fn(&ClickEvent, &mut Window, &mut App) {
    move |_, _, cx| {
        if let Some(client) = DraftsHost::client(cx) {
            client.update(cx, |client, _| client.act(action, params.clone()));
        }
    }
}

#[derive(IntoElement)]
pub struct SidebarHeaderIconButton {
    id: SharedString,
    icon: Option<&'static str>,
    content: Option<AnyElement>,
    disabled: bool,
    tooltip: Option<SharedString>,
    anchor: Option<AnyElement>,
    on_click: Option<ClickHandler>,
}

impl SidebarHeaderIconButton {
    pub fn new(id: impl Into<SharedString>) -> Self {
        Self {
            id: id.into(),
            icon: None,
            content: None,
            disabled: false,
            tooltip: None,
            anchor: None,
            on_click: None,
        }
    }

    pub fn icon(mut self, path: &'static str) -> Self {
        self.icon = Some(path);
        self
    }

    pub fn content(mut self, content: impl IntoElement) -> Self {
        self.content = Some(content.into_any_element());
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn tooltip(mut self, tooltip: impl Into<SharedString>) -> Self {
        self.tooltip = Some(tooltip.into());
        self
    }

    pub fn anchor(mut self, anchor: impl IntoElement) -> Self {
        self.anchor = Some(anchor.into_any_element());
        self
    }

    pub fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Box::new(handler));
        self
    }
}

impl RenderOnce for SidebarHeaderIconButton {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let button = SidebarMenuButton::new(self.id.clone())
            .size(SidebarMenuButtonSize::Icon)
            .disabled(self.disabled)
            .when_some(self.icon, |this, icon| this.icon(icon))
            .when_some(self.on_click.filter(|_| !self.disabled), |this, handler| {
                this.on_click(move |event, window, cx| handler(event, window, cx))
            })
            .size_7()
            .w(px(ICON_BUTTON))
            .h(px(ICON_BUTTON))
            .flex_none()
            .children(self.content);
        div()
            .id(SharedString::from(format!("{}-tooltip", self.id)))
            .relative()
            .flex_none()
            .when_some(self.tooltip, |this, tooltip| {
                this.tooltip(Tooltip::text(tooltip))
            })
            .child(button)
            .children(self.anchor)
    }
}

#[derive(IntoElement)]
pub struct SidebarThreadHeader {
    view: SidebarHeaderView,
}

impl SidebarThreadHeader {
    pub fn new(view: &SidebarHeaderView) -> Self {
        Self { view: view.clone() }
    }
}

impl RenderOnce for SidebarThreadHeader {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::sidebar(cx);
        let view = self.view;
        let hover_bg = t.sidebar_row_hover;
        let hover_text = t.sidebar_foreground;
        let query = view.search.query.clone();
        let placeholder = view.search.placeholder.clone();
        let search_text = if query.is_empty() {
            (SharedString::from(placeholder), t.sidebar_muted_foreground)
        } else {
            (SharedString::from(query), t.sidebar_foreground)
        };
        let scope = view.project_scope.scoped_project.clone();
        let scope_open = DraftsHost::global(cx).is_some_and(|host| host.read(cx).scope_is_open(cx));
        let new_thread_tooltip = match view.new_thread.in_project_hint.clone() {
            Some(hint) => format!("{}\n{}", view.new_thread.tooltip, hint),
            None => view.new_thread.tooltip.clone(),
        };
        div()
            .flex()
            .items_center()
            .gap(px(4.))
            .child(
                div()
                    .id("sidebar-thread-search")
                    .relative()
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .items_center()
                    .gap(px(8.))
                    .h(px(FIELD_HEIGHT))
                    .rounded(px(8.))
                    .px(px(8.))
                    .py(px(6.))
                    .cursor_pointer()
                    .text_size(px(TEXT_SM))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.sidebar_muted_foreground)
                    .hover(move |style| style.bg(hover_bg).text_color(hover_text))
                    .on_click(act("commandPaletteOpen", json!({})))
                    .child(
                        svg()
                            .path("icons/search.svg")
                            .flex_none()
                            .size(px(ICON))
                            .text_color(t.sidebar_icon_color),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .line_height(px(INPUT_LINE))
                            .text_color(search_text.1)
                            .child(search_text.0),
                    )
                    .child(DraftsHost::search_anchor()),
            )
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .when(view.has_projects, |this| {
                        let scope_button = match scope {
                            Some(project) => SidebarHeaderIconButton::new("sidebar-project-scope")
                                .content(ProjectFavicon::new(&project.icon, ICON)),
                            None => SidebarHeaderIconButton::new("sidebar-project-scope")
                                .icon("icons/folder.svg"),
                        };
                        this.child(
                            scope_button
                                .tooltip(view.project_scope.label.clone())
                                .anchor(DraftsHost::scope_trigger_anchor())
                                .on_click(act("projectScopeOpen", json!({ "open": !scope_open }))),
                        )
                        .child(
                            SidebarHeaderIconButton::new("sidebar-add-project")
                                .icon("icons/folder-plus.svg")
                                .tooltip(view.add_project.label.clone())
                                .on_click(act(
                                    "commandPaletteOpen",
                                    json!({ "open": "add-project" }),
                                )),
                        )
                    })
                    .child(
                        SidebarHeaderIconButton::new("sidebar-new-thread")
                            .icon("icons/square-pen.svg")
                            .tooltip(new_thread_tooltip)
                            .disabled(view.new_thread.disabled)
                            .on_click(|event, _, cx| {
                                let shift = event.modifiers().shift;
                                if let Some(client) = DraftsHost::client(cx) {
                                    client.update(cx, |client, _| {
                                        client.act("sidebarNewThread", json!({ "shift": shift }))
                                    });
                                }
                            }),
                    ),
            )
    }
}
