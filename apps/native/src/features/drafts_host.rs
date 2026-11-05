use gpui::component::input::{InputEvent, InputState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, Bounds, Context, Entity, Focusable, FontWeight, Global,
    InteractiveElement, IntoElement, KeyDownEvent, ParentElement, PathPromptOptions, Pixels,
    Render, SharedString, StatefulInteractiveElement, Styled, Window, canvas, div, px, svg,
};
use serde_json::{Value, json};

use crate::app::workspace_page_header::WorkspacePageHeader;
use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::drafts::{
    DraftHeroEntryView, DraftHeroSentence, DraftHeroSublineContent, DraftHeroView,
    EnvironmentBadgeView, FolderPickerRequestView, HomeView, NoProjectsHeroView,
    ProjectScopeItemView, ProjectScopeView,
};
use crate::app_core::views::sidebar::ProjectIconColor;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::empty::{Empty, EmptySize};
use crate::ui::input::bare_input;
use crate::ui::menu::{MenuItem, MenuPopup, MenuRadioItem, MenuSeparator};
use crate::ui::popover::{Align, Side, dropdown_glass, positioned};
use crate::ui::project_favicon::ProjectFavicon;
use crate::ui::theme;
use crate::ui::theme::palette::project_icon;
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const HEADLINE_GAP: f32 = 32.;
const HEADLINE_MAX_WIDTH: f32 = 1024.;
const HEADLINE_TEXT: f32 = 30.;
const HEADLINE_LINE: f32 = 36.;
const SUBLINE_MARGIN: f32 = 8.;
const SUBLINE_HEIGHT: f32 = 24.;
const SUBLINE_TEXT: f32 = 14.;
const SUBLINE_LINE: f32 = 20.;
const TRIGGER_MAX_WIDTH: f32 = 256.;
const TRIGGER_UNDERLINE_OFFSET: f32 = 4.;
const TRIGGER_UNDERLINE_ALPHA: f32 = 0.3;
const ADD_BORDER_ALPHA: f32 = 0.35;
const ADD_TEXT_ALPHA: f32 = 0.6;
const ADD_HOVER_TEXT_ALPHA: f32 = 0.8;
const MENU_ICON: f32 = 16.;
const BADGE_ICON: f32 = 14.;
const HERO_MENU_MAX_HEIGHT: f32 = 320.;
const NO_PROJECTS_MAX_WIDTH: f32 = 512.;
const NO_PROJECTS_PADDING_X: f32 = 32.;
const NO_PROJECTS_PADDING_Y: f32 = 48.;
const NO_PROJECTS_ACTIONS_MARGIN: f32 = 24.;
const START_ERROR_MAX_WIDTH: f32 = 448.;
const START_ERROR_ACTIONS_MARGIN: f32 = 20.;
const ACTIONS_GAP: f32 = 8.;
const SCOPE_MAX_WIDTH: f32 = 288.;
const SCOPE_SEARCH_PADDING_X: f32 = 12.;
const SCOPE_SEARCH_PADDING_TOP: f32 = 10.;
const SCOPE_SEARCH_PADDING_BOTTOM: f32 = 6.;
const SCOPE_INPUT_HEIGHT: f32 = 26.;
const SCOPE_SEARCH_ICON: f32 = 16.;
const SCOPE_SEARCH_TEXT_INSET: f32 = 20.;
const SCOPE_SEARCH_BORDER_ALPHA: f32 = 0.7;
const SCOPE_LIST_MAX_HEIGHT: f32 = 288.;
const SCOPE_ROW_MIN_HEIGHT: f32 = 28.;
const SCOPE_ROW_PADDING_X: f32 = 8.;
const SCOPE_ROW_PADDING_Y: f32 = 4.;
const SCOPE_ROW_RADIUS: f32 = 6.;
const SCOPE_ROW_GAP: f32 = 8.;
const SCOPE_SETTINGS_ICON: f32 = 14.;
const SCOPE_EMPTY_PADDING: f32 = 8.;

pub struct DraftsHostHandle(pub Entity<DraftsHost>);

impl Global for DraftsHostHandle {}

pub struct DraftsHost {
    client: Entity<CoreClient>,
    hero: Entity<ViewState<Option<DraftHeroView>>>,
    home: Entity<ViewState<HomeView>>,
    no_projects: Entity<ViewState<NoProjectsHeroView>>,
    scope: Entity<ViewState<ProjectScopeView>>,
    folder: Entity<ViewState<Option<FolderPickerRequestView>>>,
    scope_search: Entity<InputState>,
    scope_open: bool,
    scope_highlight: usize,
    search_bounds: Bounds<Pixels>,
    scope_trigger_bounds: Bounds<Pixels>,
    hero_trigger_bounds: Bounds<Pixels>,
    hero_menu_open: bool,
    handled_folder: Option<u64>,
}

fn send(client: &Entity<CoreClient>, cx: &mut App, action: &str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

fn badge(environment: &Option<EnvironmentBadgeView>, t: &Tokens) -> Option<AnyElement> {
    environment.as_ref().map(|badge| {
        div()
            .id(SharedString::from(format!(
                "env-badge-{}",
                badge.description
            )))
            .ml_auto()
            .flex()
            .flex_none()
            .items_center()
            .tooltip(Tooltip::text(badge.description.clone()))
            .child(
                svg()
                    .path(badge.kind.icon_path())
                    .size(px(BADGE_ICON))
                    .text_color(t.muted_foreground),
            )
            .into_any_element()
    })
}

fn scratch_icon(t: &Tokens) -> gpui::Svg {
    svg()
        .path("icons/message-square-dashed.svg")
        .flex_none()
        .size(px(MENU_ICON))
        .text_color(project_icon(ProjectIconColor::Gray, t.appearance))
}

impl DraftsHost {
    pub fn install(client: &Entity<CoreClient>, window: &mut Window, cx: &mut App) {
        if cx.has_global::<DraftsHostHandle>() {
            return;
        }
        let host = cx.new(|cx| Self::new(client.clone(), window, cx));
        cx.set_global(DraftsHostHandle(host));
    }

    pub fn global(cx: &App) -> Option<Entity<DraftsHost>> {
        cx.try_global::<DraftsHostHandle>()
            .map(|handle| handle.0.clone())
    }

    fn new(client: Entity<CoreClient>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let hero =
            CoreClient::subscribe::<Option<DraftHeroView>>(&client, "draftHero", json!({}), cx);
        let home = CoreClient::subscribe::<HomeView>(&client, "home", json!({}), cx);
        let no_projects =
            CoreClient::subscribe::<NoProjectsHeroView>(&client, "noProjectsHero", json!({}), cx);
        cx.observe(&no_projects, |_, _, cx| cx.notify()).detach();
        let scope = CoreClient::subscribe::<ProjectScopeView>(
            &client,
            "sidebarProjectScope",
            json!({}),
            cx,
        );
        let folder = CoreClient::subscribe::<Option<FolderPickerRequestView>>(
            &client,
            "folderPickerRequest",
            json!({}),
            cx,
        );
        cx.observe(&hero, |host, _, cx| {
            if host.hero_view(cx).is_none() {
                host.hero_menu_open = false;
            }
            cx.notify();
        })
        .detach();
        cx.observe(&home, |_, _, cx| cx.notify()).detach();
        cx.observe_in(&scope, window, |host, _, window, cx| {
            host.sync_scope(window, cx)
        })
        .detach();
        cx.observe(&folder, |host, _, cx| host.serve_folder_request(cx))
            .detach();
        let scope_search = cx.new(|cx| InputState::new(window, cx));
        let search_client = client.clone();
        cx.subscribe_in(
            &scope_search,
            window,
            move |host, state: &Entity<InputState>, event: &InputEvent, _, cx| match event {
                InputEvent::Change => {
                    let query = state.read(cx).value().to_string();
                    host.scope_highlight = 0;
                    send(
                        &search_client,
                        cx,
                        "projectScopeQuery",
                        json!({ "query": query }),
                    );
                }
                InputEvent::PressEnter { .. } => host.select_highlighted(cx),
                _ => {}
            },
        )
        .detach();
        Self {
            client,
            hero,
            home,
            no_projects,
            scope,
            folder,
            scope_search,
            scope_open: false,
            scope_highlight: 0,
            search_bounds: Bounds::default(),
            scope_trigger_bounds: Bounds::default(),
            hero_trigger_bounds: Bounds::default(),
            hero_menu_open: false,
            handled_folder: None,
        }
    }

    pub fn client(cx: &App) -> Option<Entity<CoreClient>> {
        Self::global(cx).map(|host| host.read(cx).client.clone())
    }

    fn hero_view(&self, cx: &App) -> Option<DraftHeroView> {
        self.hero.read(cx).data.clone().flatten()
    }

    fn scope_view(&self, cx: &App) -> Option<ProjectScopeView> {
        self.scope.read(cx).data.clone()
    }

    pub fn scope_is_open(&self, cx: &App) -> bool {
        self.scope_view(cx).is_some_and(|view| view.open)
    }

    fn serve_folder_request(&mut self, cx: &mut Context<Self>) {
        let Some(request) = self.folder.read(cx).data.clone().flatten() else {
            return;
        };
        if self.handled_folder == Some(request.id) {
            return;
        }
        self.handled_folder = Some(request.id);
        let paths = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some(request.prompt.into()),
        });
        let client = self.client.clone();
        let request_id = request.id;
        cx.spawn(async move |_, cx| {
            let path = match paths.await {
                Ok(Ok(Some(paths))) => paths
                    .into_iter()
                    .next()
                    .map(|path| path.to_string_lossy().into_owned()),
                _ => None,
            };
            cx.update(|cx| {
                send(
                    &client,
                    cx,
                    "addProjectPicked",
                    json!({ "requestId": request_id, "path": path }),
                )
            });
        })
        .detach();
    }

    fn sync_scope(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let open = self.scope_view(cx).is_some_and(|view| view.open);
        if open && !self.scope_open {
            self.scope_highlight = 0;
            self.scope_search.update(cx, |state, cx| {
                state.set_value("", window, cx);
                state.set_placeholder("Search projects...", window, cx);
                state.focus(window, cx);
            });
        }
        self.scope_open = open;
        cx.notify();
    }

    fn select_highlighted(&mut self, cx: &mut Context<Self>) {
        let Some(view) = self.scope_view(cx) else {
            return;
        };
        if let Some(item) = view.items.get(self.scope_highlight) {
            send(
                &self.client,
                cx,
                "projectScopeSelect",
                json!({ "value": item.value }),
            );
        }
    }

    pub fn search_anchor() -> impl IntoElement {
        canvas(
            move |bounds, _, cx| {
                if let Some(host) = Self::global(cx) {
                    host.update(cx, |host, _| host.search_bounds = bounds);
                }
            },
            |_, _, _, _| {},
        )
        .absolute()
        .size_full()
    }

    pub fn scope_trigger_anchor() -> impl IntoElement {
        canvas(
            move |bounds, _, cx| {
                if let Some(host) = Self::global(cx) {
                    host.update(cx, |host, _| host.scope_trigger_bounds = bounds);
                }
            },
            |_, _, _, _| {},
        )
        .absolute()
        .size_full()
    }

    fn hero_trigger_anchor() -> impl IntoElement {
        canvas(
            move |bounds, _, cx| {
                if let Some(host) = Self::global(cx) {
                    host.update(cx, |host, _| host.hero_trigger_bounds = bounds);
                }
            },
            |_, _, _, _| {},
        )
        .absolute()
        .size_full()
    }

    pub fn is_hero(cx: &App) -> bool {
        Self::global(cx).is_some_and(|host| host.read(cx).hero_view(cx).is_some())
    }

    pub fn hero_headline(cx: &App) -> Option<AnyElement> {
        let host = Self::global(cx)?;
        let view = host.read(cx).hero_view(cx)?;
        let client = host.read(cx).client.clone();
        let t = theme::active(cx);
        Some(headline(&view, &host, &client, &t).into_any_element())
    }

    pub fn home_content(collapsed_sidebar_inset: Option<f32>, cx: &App) -> Option<AnyElement> {
        Self::home_body(cx).map(|body| page_with_header(body, collapsed_sidebar_inset, cx))
    }

    pub fn no_projects_hero(collapsed_sidebar_inset: Option<f32>, cx: &App) -> Option<AnyElement> {
        let host = Self::global(cx)?;
        let client = host.read(cx).client.clone();
        let view = host.read(cx).no_projects.read(cx).data.clone()?;
        Some(page_with_header(
            no_projects_body(view, &client),
            collapsed_sidebar_inset,
            cx,
        ))
    }

    fn home_body(cx: &App) -> Option<AnyElement> {
        let host = Self::global(cx)?;
        let client = host.read(cx).client.clone();
        let view = host.read(cx).home.read(cx).data.clone()?;
        match view {
            HomeView::None => None,
            HomeView::NoProjects(view) => Some(no_projects_body(view, &client)),
            HomeView::StartError {
                title,
                description,
                retry_label,
            } => Some(
                div()
                    .flex()
                    .flex_1()
                    .items_center()
                    .justify_center()
                    .child(
                        Empty::new()
                            .max_w(px(START_ERROR_MAX_WIDTH))
                            .title(title)
                            .description(description)
                            .child(
                                div()
                                    .mt(px(START_ERROR_ACTIONS_MARGIN))
                                    .flex()
                                    .justify_center()
                                    .child(
                                        Button::new("home-retry-draft")
                                            .size(ButtonSize::Sm)
                                            .icon("refresh-cw")
                                            .label(retry_label)
                                            .on_click(move |_, _, cx| {
                                                send(&client, cx, "homeRetry", json!({}))
                                            }),
                                    ),
                            ),
                    )
                    .into_any_element(),
            ),
        }
    }

    fn hero_menu(&self, view: &DraftHeroView, cx: &mut Context<Self>) -> Option<AnyElement> {
        if !self.hero_menu_open {
            return None;
        }
        let picker = view.project_trigger.picker.as_ref()?;
        let t = theme::active(cx);
        let host = cx.entity();
        let trigger = self.hero_trigger_bounds;
        let items: Vec<AnyElement> = picker
            .entries
            .iter()
            .map(|entry| self.hero_entry(entry, &host, &t))
            .collect();
        let add_host = host.clone();
        let add_client = self.client.clone();
        let dismiss = host.clone();
        Some(
            MenuPopup::new("draft-hero-project-menu", trigger)
                .align(Align::Center)
                .on_dismiss(move |window, cx| {
                    if !trigger.contains(&window.mouse_position()) {
                        dismiss.update(cx, |host, cx| {
                            host.hero_menu_open = false;
                            cx.notify();
                        });
                    }
                })
                .child(
                    div()
                        .id("draft-hero-project-menu-items")
                        .max_h(px(HERO_MENU_MAX_HEIGHT))
                        .overflow_y_scroll()
                        .flex()
                        .flex_col()
                        .children(items)
                        .when(picker.show_separator, |list| {
                            list.child(MenuSeparator::new())
                        })
                        .child(
                            MenuItem::new("draft-hero-add-project")
                                .icon("folder-plus")
                                .label("Add project")
                                .on_click(move |_, _, cx| {
                                    add_host.update(cx, |host, cx| {
                                        host.hero_menu_open = false;
                                        cx.notify();
                                    });
                                    send(
                                        &add_client,
                                        cx,
                                        "commandPaletteOpen",
                                        json!({ "open": "add-project" }),
                                    );
                                }),
                        ),
                )
                .into_any_element(),
        )
    }

    fn hero_entry(
        &self,
        entry: &DraftHeroEntryView,
        host: &Entity<DraftsHost>,
        t: &Tokens,
    ) -> AnyElement {
        let client = self.client.clone();
        let host = host.clone();
        let value = entry.value.clone();
        MenuRadioItem::new(SharedString::from(format!(
            "draft-hero-project-{}",
            entry.value
        )))
        .checked(entry.selected)
        .on_click(move |_, _, cx| {
            host.update(cx, |host, cx| {
                host.hero_menu_open = false;
                cx.notify();
            });
            send(
                &client,
                cx,
                "draftHeroSelectProject",
                json!({ "value": value }),
            );
        })
        .child(match &entry.icon {
            Some(icon) => ProjectFavicon::new(icon, MENU_ICON).into_any_element(),
            None => scratch_icon(t).into_any_element(),
        })
        .child(
            div()
                .min_w_0()
                .truncate()
                .child(SharedString::from(entry.label.clone())),
        )
        .children(badge(&entry.environment, t))
        .into_any_element()
    }

    fn scope_popup(
        &self,
        view: &ProjectScopeView,
        search_focused: bool,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        if !view.open {
            return None;
        }
        let t = theme::active(cx);
        let anchor = self.search_bounds;
        let trigger = self.scope_trigger_bounds;
        let client = self.client.clone();
        let rows: Vec<AnyElement> = view
            .items
            .iter()
            .enumerate()
            .map(|(index, item)| self.scope_row(item, index == self.scope_highlight, &t))
            .collect();
        let empty = rows.is_empty();
        let host = cx.entity();
        let keys = host.clone();
        let count = view.items.len();
        let dismiss = client.clone();
        let surface = dropdown_glass(cx)
            .id("sidebar-project-scope-popup")
            .occlude()
            .min_w(anchor.size.width)
            .max_w(px(SCOPE_MAX_WIDTH))
            .overflow_hidden()
            .on_mouse_down_out(move |event, _, cx| {
                if !trigger.contains(&event.position) {
                    send(&dismiss, cx, "projectScopeOpen", json!({ "open": false }));
                }
            })
            .capture_key_down(move |event: &KeyDownEvent, _, cx| {
                let key = event.keystroke.key.as_str();
                match key {
                    "down" | "up" => {
                        keys.update(cx, |host, cx| {
                            if count > 0 {
                                host.scope_highlight = if key == "down" {
                                    (host.scope_highlight + 1) % count
                                } else {
                                    (host.scope_highlight + count - 1) % count
                                };
                            }
                            cx.notify();
                        });
                        cx.stop_propagation();
                    }
                    "escape" => {
                        let client = keys.read(cx).client.clone();
                        send(&client, cx, "projectScopeOpen", json!({ "open": false }));
                        cx.stop_propagation();
                    }
                    _ => {}
                }
            })
            .child(
                div()
                    .flex_none()
                    .px(px(SCOPE_SEARCH_PADDING_X))
                    .pt(px(SCOPE_SEARCH_PADDING_TOP))
                    .child(
                        div()
                            .relative()
                            .flex()
                            .items_center()
                            .pb(px(SCOPE_SEARCH_PADDING_BOTTOM))
                            .border_b_1()
                            .border_color(if search_focused {
                                t.ring
                            } else {
                                fade(t.border, SCOPE_SEARCH_BORDER_ALPHA)
                            })
                            .child(
                                svg()
                                    .path("icons/search.svg")
                                    .absolute()
                                    .left_0()
                                    .top(px((SCOPE_INPUT_HEIGHT - SCOPE_SEARCH_ICON) / 2.))
                                    .size(px(SCOPE_SEARCH_ICON))
                                    .text_color(t.muted_foreground),
                            )
                            .child(bare_input(
                                &self.scope_search,
                                SCOPE_INPUT_HEIGHT,
                                SCOPE_SEARCH_TEXT_INSET,
                                0.,
                                crate::ui::theme::metrics::text::SM,
                                false,
                            )),
                    ),
            )
            .child(
                div()
                    .id("sidebar-project-scope-list")
                    .max_h(px(SCOPE_LIST_MAX_HEIGHT))
                    .overflow_y_scroll()
                    .p(px(crate::ui::menu::MENU_PADDING))
                    .flex()
                    .flex_col()
                    .when(empty, |list| {
                        list.child(
                            div()
                                .p(px(SCOPE_EMPTY_PADDING))
                                .flex()
                                .justify_center()
                                .text_size(px(crate::ui::theme::metrics::text::SM))
                                .text_color(t.muted_foreground)
                                .child(SharedString::from(view.empty_label.clone())),
                        )
                    })
                    .children(rows),
            );
        Some(positioned(anchor, Side::Bottom, Align::Start, 4., 0., surface).into_any_element())
    }

    fn scope_row(&self, item: &ProjectScopeItemView, highlighted: bool, t: &Tokens) -> AnyElement {
        let client = self.client.clone();
        let value = item.value.clone();
        let settings_client = self.client.clone();
        let settings_value = item.value.clone();
        let menu_client = self.client.clone();
        let menu_value = item.value.clone();
        let has_settings = item.settings_title.is_some();
        let accent = t.accent;
        div()
            .id(SharedString::from(format!(
                "sidebar-project-scope-{}",
                item.value
            )))
            .flex()
            .items_center()
            .min_h(px(SCOPE_ROW_MIN_HEIGHT))
            .px(px(SCOPE_ROW_PADDING_X))
            .py(px(SCOPE_ROW_PADDING_Y))
            .gap(px(SCOPE_ROW_GAP))
            .rounded(px(SCOPE_ROW_RADIUS))
            .cursor_pointer()
            .text_color(t.foreground)
            .when(highlighted, |row| row.bg(accent))
            .hover(move |style| style.bg(accent))
            .on_click(move |_, _, cx| {
                send(&client, cx, "projectScopeSelect", json!({ "value": value }));
            })
            .when(has_settings, |row| {
                row.on_mouse_down(gpui::MouseButton::Right, move |_, _, cx| {
                    cx.stop_propagation();
                    open_project_settings(&menu_client, &menu_value, cx);
                })
            })
            .child(match &item.icon {
                Some(icon) => ProjectFavicon::new(icon, MENU_ICON).into_any_element(),
                None => svg()
                    .path("icons/folder.svg")
                    .flex_none()
                    .size(px(MENU_ICON))
                    .text_color(t.muted_foreground)
                    .into_any_element(),
            })
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .text_size(px(crate::ui::theme::metrics::text::SM))
                    .child(SharedString::from(item.label.clone())),
            )
            .children(badge(&item.environment, t))
            .when_some(item.settings_title.clone(), |row, title| {
                row.child(
                    Button::new(SharedString::from(format!(
                        "sidebar-project-scope-settings-{}",
                        item.value
                    )))
                    .size(ButtonSize::IconXs)
                    .variant(ButtonVariant::GhostMuted)
                    .icon("settings")
                    .icon_size(SCOPE_SETTINGS_ICON)
                    .tab_stop(false)
                    .accessibility_label(title)
                    .on_click(move |_, _, cx| {
                        cx.stop_propagation();
                        open_project_settings(&settings_client, &settings_value, cx);
                    }),
                )
            })
            .into_any_element()
    }
}

fn page_with_header(
    body: AnyElement,
    collapsed_sidebar_inset: Option<f32>,
    cx: &App,
) -> AnyElement {
    let t = theme::active(cx);
    div()
        .flex()
        .flex_col()
        .flex_1()
        .min_w_0()
        .min_h_0()
        .bg(t.background)
        .child(WorkspacePageHeader::new().collapsed_sidebar_inset(collapsed_sidebar_inset))
        .child(body)
        .into_any_element()
}

fn no_projects_body(view: NoProjectsHeroView, client: &Entity<CoreClient>) -> AnyElement {
    let add = client.clone();
    let scratch = client.clone();
    div()
        .flex()
        .flex_1()
        .items_center()
        .justify_center()
        .child(
            div()
                .w_full()
                .max_w(px(NO_PROJECTS_MAX_WIDTH))
                .px(px(NO_PROJECTS_PADDING_X))
                .py(px(NO_PROJECTS_PADDING_Y))
                .child(
                    Empty::new()
                        .size(EmptySize::Hero)
                        .title(view.title)
                        .description(view.description)
                        .child(
                            div()
                                .mt(px(NO_PROJECTS_ACTIONS_MARGIN))
                                .flex()
                                .justify_center()
                                .gap(px(ACTIONS_GAP))
                                .child(
                                    Button::new("home-add-project")
                                        .size(ButtonSize::Sm)
                                        .icon("plus")
                                        .label(view.add_project_label)
                                        .on_click(move |_, _, cx| {
                                            send(
                                                &add,
                                                cx,
                                                "commandPaletteOpen",
                                                json!({ "open": "add-project" }),
                                            )
                                        }),
                                )
                                .when_some(view.start_without_project_label, |row, label| {
                                    row.child(
                                        Button::new("home-start-without-project")
                                            .size(ButtonSize::Sm)
                                            .variant(ButtonVariant::Outline)
                                            .icon("message-square-dashed")
                                            .label(label)
                                            .on_click(move |_, _, cx| {
                                                send(&scratch, cx, "homeStartScratch", json!({}))
                                            }),
                                    )
                                }),
                        ),
                ),
        )
        .into_any_element()
}

fn open_project_settings(client: &Entity<CoreClient>, project_key: &str, cx: &mut App) {
    send(client, cx, "projectScopeOpen", json!({ "open": false }));
    send(
        client,
        cx,
        "sidebarOpenProjectSettings",
        json!({ "projectKey": project_key }),
    );
}

fn trigger_element(
    view: &DraftHeroView,
    host: &Entity<DraftsHost>,
    client: &Entity<CoreClient>,
    t: &Tokens,
    text_size: f32,
    line: f32,
) -> AnyElement {
    let trigger = &view.project_trigger;
    let label = SharedString::from(trigger.label.clone());
    if trigger.picker.is_none() {
        let client = client.clone();
        let hover_text = fade(t.muted_foreground, ADD_HOVER_TEXT_ALPHA);
        let hover_border = fade(t.muted_foreground, ADD_TEXT_ALPHA);
        return div()
            .id("draft-hero-add-project")
            .cursor_pointer()
            .border_b_1()
            .border_dashed()
            .border_color(fade(t.muted_foreground, ADD_BORDER_ALPHA))
            .text_color(fade(t.muted_foreground, ADD_TEXT_ALPHA))
            .hover(move |style| style.text_color(hover_text).border_color(hover_border))
            .on_click(move |_, _, cx| {
                send(
                    &client,
                    cx,
                    "commandPaletteOpen",
                    json!({ "open": "add-project" }),
                )
            })
            .child(label)
            .into_any_element();
    }
    let open = host.clone();
    let underline = fade(t.foreground, TRIGGER_UNDERLINE_ALPHA);
    let foreground = t.foreground;
    let group = SharedString::from("draft-hero-project-trigger");
    div()
        .id("draft-hero-project-trigger")
        .group(group.clone())
        .relative()
        .flex()
        .flex_none()
        .max_w(px(TRIGGER_MAX_WIDTH))
        .cursor_pointer()
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.foreground)
        .text_size(px(text_size))
        .line_height(px(line))
        .when_some(trigger.tooltip.clone(), |this, tooltip| {
            this.tooltip(Tooltip::text(tooltip))
        })
        .on_click(move |_, _, cx| {
            open.update(cx, |host, cx| {
                host.hero_menu_open = !host.hero_menu_open;
                cx.notify();
            });
        })
        .child(div().min_w_0().truncate().child(label))
        .child(
            div()
                .absolute()
                .left_0()
                .right_0()
                .bottom(px(line - text_size * 0.9 - TRIGGER_UNDERLINE_OFFSET))
                .h(px(0.))
                .border_b_1()
                .border_dashed()
                .border_color(underline)
                .group_hover(group, move |style| style.border_color(foreground)),
        )
        .child(DraftsHost::hero_trigger_anchor())
        .into_any_element()
}

fn headline(
    view: &DraftHeroView,
    host: &Entity<DraftsHost>,
    client: &Entity<CoreClient>,
    t: &Tokens,
) -> impl IntoElement {
    let text = |value: &str| {
        div()
            .flex_none()
            .child(SharedString::from(value.to_string()))
    };
    let heading = div()
        .w_full()
        .flex()
        .justify_center()
        .items_center()
        .text_size(px(HEADLINE_TEXT))
        .line_height(px(HEADLINE_LINE))
        .text_color(t.foreground)
        .map(|row| match view.sentence {
            DraftHeroSentence::Scratch => row.child(text("What should we work on?")),
            DraftHeroSentence::BuildIn => row
                .child(text("What should we build in\u{a0}"))
                .child(trigger_element(
                    view,
                    host,
                    client,
                    t,
                    HEADLINE_TEXT,
                    HEADLINE_LINE,
                ))
                .child(text("?")),
            DraftHeroSentence::Choose => row
                .child(trigger_element(
                    view,
                    host,
                    client,
                    t,
                    HEADLINE_TEXT,
                    HEADLINE_LINE,
                ))
                .child(text("\u{a0}to start")),
            DraftHeroSentence::Add => row.child(text("Add a project to start")),
        });
    let subline = view.subline.as_ref().map(|subline| {
        let row = div()
            .mt(px(SUBLINE_MARGIN))
            .h(px(SUBLINE_HEIGHT))
            .flex()
            .items_center()
            .text_size(px(SUBLINE_TEXT))
            .line_height(px(SUBLINE_LINE));
        match subline.content {
            DraftHeroSublineContent::Picker => row.child(trigger_element(
                view,
                host,
                client,
                t,
                SUBLINE_TEXT,
                SUBLINE_LINE,
            )),
            DraftHeroSublineContent::StartWithout => {
                let client = client.clone();
                row.child(
                    div()
                        .id("draft-hero-start-without-project")
                        .cursor_pointer()
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.muted_foreground)
                        .hover(|style| style.text_decoration_1())
                        .when_some(subline.shortcut.clone(), |this, shortcut| {
                            this.tooltip(Tooltip::text(shortcut))
                        })
                        .on_click(move |_, _, cx| {
                            send(&client, cx, "draftHeroStartScratch", json!({}))
                        })
                        .child("or start without a project"),
                )
            }
            DraftHeroSublineContent::Empty => row,
        }
    });
    div().w_full().pb(px(HEADLINE_GAP)).child(
        div()
            .mx_auto()
            .w_full()
            .max_w(px(HEADLINE_MAX_WIDTH))
            .flex()
            .flex_col()
            .items_center()
            .child(heading)
            .children(subline),
    )
}

impl Render for DraftsHost {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let search_focused = self
            .scope_search
            .read(cx)
            .focus_handle(cx)
            .is_focused(window);
        let hero_menu = self
            .hero_view(cx)
            .and_then(|view| self.hero_menu(&view, cx));
        let scope = self
            .scope_view(cx)
            .and_then(|view| self.scope_popup(&view, search_focused, cx));
        div().children(hero_menu).children(scope)
    }
}
