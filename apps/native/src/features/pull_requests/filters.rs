use std::collections::HashMap;

use gpui::component::input::InputState;
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Bounds, ElementId, Entity, FontWeight, InteractiveElement, IntoElement,
    ParentElement, Pixels, SharedString, StatefulInteractiveElement, Styled, WeakEntity, Window,
    canvas, div, px,
};
use serde_json::{Value, json};

use crate::app_core::client::CoreClient;
use crate::app_core::views::pull_requests::{
    PullRequestAuthorFilterModel, PullRequestCompactMenuModel, PullRequestCompactMenuPresentation,
    PullRequestFilterIcon, PullRequestFilterOptionModel, PullRequestFilterSubmenuModel,
    PullRequestLabelFilterModel, PullRequestsPageView,
};
use crate::app_core::views::sidebar::ProjectIconView;
use crate::features::chat::toolbar_parts::act;
use crate::features::pull_requests::page::PullRequestsPage;
use crate::features::pull_requests::presentation::{avatar, filter_icon, hex_color, path_icon};
use crate::features::pull_requests::row::AnchorBounds;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::input::InputSize;
use crate::ui::input_group::{AddonAlign, InputGroup, InputGroupAddon};
use crate::ui::menu::{
    ICON_OPACITY, ITEM_GAP, ITEM_MIN_HEIGHT, ITEM_PADDING_X, ITEM_PADDING_Y, MENU_MIN_WIDTH,
    MenuGroupLabel, MenuItem, MenuPopup, MenuRadioItem, MenuSeparator, SUB_ALIGN_OFFSET,
};
use crate::ui::popover::{Align, Side};
use crate::ui::spinner::Spinner;
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

pub const SEARCH_HEIGHT: f32 = 34.;
const MENU_ICON: f32 = 14.;
const TRIGGER_ICON: f32 = 16.;
const CHEVRON: f32 = 12.;
const SUMMARY_MAX: f32 = 128.;
const VIEWPORT_MARGIN: f32 = 8.;
const AVATAR: f32 = 16.;
const LABEL_DOT: f32 = 10.;
const COUNT_PADDING_X: f32 = 6.;
const COMPACT_GAP: f32 = 4.;
const COMPACT_PADDING_END: f32 = 7.;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CompactMenu {
    Sort,
    Provider,
    State,
    Involvement,
    Host,
}

impl CompactMenu {
    pub fn anchor(self) -> &'static str {
        match self {
            CompactMenu::Sort => "menu:sort",
            CompactMenu::Provider => "menu:provider",
            CompactMenu::State => "menu:state",
            CompactMenu::Involvement => "menu:involvement",
            CompactMenu::Host => "menu:host",
        }
    }

    fn action(self) -> &'static str {
        match self {
            CompactMenu::Sort => "pullRequestsSetSort",
            CompactMenu::Provider | CompactMenu::Host => "pullRequestsSetHost",
            CompactMenu::State => "pullRequestsSetState",
            CompactMenu::Involvement => "pullRequestsSetInvolvement",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FilterSub {
    State,
    Involvement,
    Author,
    Labels,
    Draft,
    Review,
    Checks,
    Host,
    Server,
    Project,
}

impl FilterSub {
    fn anchor(self) -> &'static str {
        match self {
            FilterSub::State => "sub:state",
            FilterSub::Involvement => "sub:involvement",
            FilterSub::Author => "sub:author",
            FilterSub::Labels => "sub:labels",
            FilterSub::Draft => "sub:draft",
            FilterSub::Review => "sub:review",
            FilterSub::Checks => "sub:checks",
            FilterSub::Host => "sub:host",
            FilterSub::Server => "sub:server",
            FilterSub::Project => "sub:project",
        }
    }

    fn change(self, value: &str) -> Option<(&'static str, Value)> {
        Some(match self {
            FilterSub::State => ("pullRequestsSetState", json!({ "value": value })),
            FilterSub::Involvement => ("pullRequestsSetInvolvement", json!({ "value": value })),
            FilterSub::Draft => (
                "pullRequestsSetFilterGroup",
                json!({ "group": "draft", "value": value }),
            ),
            FilterSub::Review => (
                "pullRequestsSetFilterGroup",
                json!({ "group": "review", "value": value }),
            ),
            FilterSub::Checks => (
                "pullRequestsSetFilterGroup",
                json!({ "group": "checks", "value": value }),
            ),
            FilterSub::Host => ("pullRequestsSetHost", json!({ "value": value })),
            FilterSub::Server => ("pullRequestsSetServer", json!({ "value": value })),
            FilterSub::Project => ("pullRequestsSetProject", json!({ "value": value })),
            FilterSub::Author => ("pullRequestsSetAuthor", json!({ "value": value })),
            FilterSub::Labels => return None,
        })
    }
}

pub const FILTERS_ANCHOR: &str = "menu:filters";
pub const FILTERS_SURFACE: &str = "surface:filters";
pub const SUB_SURFACE: &str = "surface:sub";

pub fn record(bounds: &AnchorBounds, key: impl Into<String>) -> impl IntoElement {
    let bounds = bounds.clone();
    let key = key.into();
    canvas(
        move |rect, _, _| {
            bounds.borrow_mut().insert(key, rect);
        },
        |_, _, _, _| {},
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full()
}

fn within(bounds: &AnchorBounds, key: &str, window: &Window) -> bool {
    bounds
        .borrow()
        .get(key)
        .is_some_and(|rect| rect.contains(&window.mouse_position()))
}

pub fn search_field(
    state: &Entity<InputState>,
    busy: bool,
    spinner_id: &'static str,
) -> InputGroup {
    let addon = InputGroupAddon::new(AddonAlign::InlineStart);
    let addon = if busy {
        addon.child(div().flex().opacity(0.8).child(Spinner::new(spinner_id)))
    } else {
        addon.icon("search")
    };
    InputGroup::input(state).addon(addon).h(px(SEARCH_HEIGHT))
}

fn option_icon(
    option: &PullRequestFilterOptionModel,
    color: gpui::Rgba,
    projects: &HashMap<String, ProjectIconView>,
) -> AnyElement {
    filter_icon(&option.icon, MENU_ICON, color, projects)
}

pub fn compact_trigger(
    menu: CompactMenu,
    model: &PullRequestCompactMenuModel,
    open: bool,
    page: &WeakEntity<PullRequestsPage>,
    bounds: &AnchorBounds,
    projects: &HashMap<String, ProjectIconView>,
    cx: &App,
) -> AnyElement {
    let t = theme::active(cx);
    let page = page.clone();
    let id = ElementId::Name(SharedString::from(menu.anchor()));
    let button = if model.outlined {
        Button::new(id).variant(ButtonVariant::Outline).size(
            if model.presentation == PullRequestCompactMenuPresentation::Icon {
                ButtonSize::Icon
            } else {
                ButtonSize::Default
            },
        )
    } else {
        Button::new(id)
            .variant(ButtonVariant::GhostMuted)
            .size(ButtonSize::Sm)
    };
    let icon_color = t.muted_foreground;
    let button = match model.presentation {
        PullRequestCompactMenuPresentation::Icon => button.child(filter_icon(
            &model.current.icon,
            TRIGGER_ICON,
            icon_color,
            projects,
        )),
        PullRequestCompactMenuPresentation::TriggerLabel => {
            let button = match model.trigger_icon.as_ref() {
                Some(PullRequestFilterIcon::Lucide { id }) => button.icon(
                    crate::features::pull_requests::presentation::lucide_path(id).to_string(),
                ),
                Some(icon) => button.child(filter_icon(icon, TRIGGER_ICON, icon_color, projects)),
                None => button,
            };
            button.label(model.trigger_label.clone().unwrap_or_default())
        }
        PullRequestCompactMenuPresentation::CurrentLabel => button
            .min_w_0()
            .flex_shrink(1.)
            .pr(px(COMPACT_PADDING_END))
            .child(
                div()
                    .flex()
                    .min_w_0()
                    .items_center()
                    .gap(px(COMPACT_GAP))
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .child(SharedString::from(model.current.label.clone())),
                    )
                    .child(path_icon(
                        "icons/chevron-down.svg",
                        CHEVRON,
                        fade(t.muted_foreground, 0.7),
                    )),
            ),
    };
    let button = button
        .accessibility_label(model.aria_label.clone())
        .pressed(open)
        .child(record(bounds, menu.anchor()))
        .on_click(move |_, _, cx| {
            let _ = page.update(cx, |page, cx| page.toggle_menu(menu, cx));
        });
    match model.title.clone() {
        Some(title) => div()
            .id(ElementId::Name(SharedString::from(format!(
                "{}-tip",
                menu.anchor()
            ))))
            .flex()
            .min_w_0()
            .tooltip(Tooltip::text(title))
            .child(button)
            .into_any_element(),
        None => button.into_any_element(),
    }
}

fn unavailable_tip(id: String, item: AnyElement, unavailable: Option<&String>) -> AnyElement {
    match unavailable {
        Some(reason) => div()
            .id(ElementId::Name(SharedString::from(id)))
            .tooltip(Tooltip::text(reason.clone()))
            .child(item)
            .into_any_element(),
        None => item,
    }
}

pub fn compact_popup(
    menu: CompactMenu,
    model: &PullRequestCompactMenuModel,
    trigger: Bounds<Pixels>,
    page: &WeakEntity<PullRequestsPage>,
    client: &Entity<CoreClient>,
    projects: &HashMap<String, ProjectIconView>,
    cx: &App,
) -> AnyElement {
    let t = theme::active(cx);
    let dismiss_page = page.clone();
    MenuPopup::new(
        ElementId::Name(SharedString::from(format!("{}-popup", menu.anchor()))),
        trigger,
    )
    .side(Side::Bottom)
    .align(Align::Start)
    .on_dismiss(move |window, cx| {
        if trigger.contains(&window.mouse_position()) {
            return;
        }
        let _ = dismiss_page.update(cx, |page, cx| page.close_menu(cx));
    })
    .children(model.options.iter().map(|option| {
        let page = page.clone();
        let client = client.clone();
        let value = option.value.clone();
        let selected = option.selected;
        let item = MenuRadioItem::new(ElementId::Name(SharedString::from(format!(
            "{}-{}",
            menu.anchor(),
            option.value
        ))))
        .checked(option.selected)
        .disabled(option.unavailable.is_some())
        .on_click(move |_, _, cx| {
            if !selected {
                act(&client, cx, menu.action(), json!({ "value": value }));
            }
            let _ = page.update(cx, |page, cx| page.close_menu(cx));
        })
        .child(option_icon(option, t.foreground, projects))
        .child(SharedString::from(option.label.clone()))
        .into_any_element();
        unavailable_tip(
            format!("{}-{}-tip", menu.anchor(), option.value),
            item,
            option.unavailable.as_ref(),
        )
    }))
    .into_any_element()
}

pub fn filters_trigger(
    view: &PullRequestsPageView,
    client: &Entity<CoreClient>,
    bounds: &AnchorBounds,
    cx: &App,
) -> AnyElement {
    let t = theme::active(cx);
    let menu = &view.model.filters_menu;
    let client = client.clone();
    let open = view.filters_open;
    let button = Button::new(FILTERS_ANCHOR).variant(ButtonVariant::Outline);
    let button = match &menu.trigger_icon {
        PullRequestFilterIcon::Lucide { id } => {
            button.icon(crate::features::pull_requests::presentation::lucide_path(id).to_string())
        }
        icon => button.child(filter_icon(
            icon,
            TRIGGER_ICON,
            t.muted_foreground,
            &view.project_icons,
        )),
    };
    button
        .label(menu.trigger_label.clone())
        .pressed(open)
        .when_some(menu.count_label.clone(), |this, count| {
            this.child(
                div()
                    .flex_none()
                    .rounded_full()
                    .bg(t.muted)
                    .px(px(COUNT_PADDING_X))
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .font_weight(FontWeight::NORMAL)
                    .font_features(theme::tabular())
                    .text_color(t.muted_foreground)
                    .child(SharedString::from(count)),
            )
        })
        .child(record(bounds, FILTERS_ANCHOR))
        .on_click(move |_, _, cx| {
            act(
                &client,
                cx,
                "pullRequestsFiltersOpen",
                json!({ "open": !open }),
            )
        })
        .into_any_element()
}

fn sub_row(
    sub: FilterSub,
    icon: AnyElement,
    label: &str,
    summary: &str,
    ctx: &FiltersMenuContext,
    t: &Tokens,
) -> AnyElement {
    let open = ctx.open_sub == Some(sub);
    let bounds = ctx.bounds;
    let accent = t.accent;
    let accent_foreground = t.accent_foreground;
    let hover_page = ctx.page.clone();
    let click_page = ctx.page.clone();
    div()
        .id(ElementId::Name(SharedString::from(sub.anchor())))
        .relative()
        .flex()
        .items_center()
        .gap(px(ITEM_GAP))
        .min_h(px(ITEM_MIN_HEIGHT))
        .px(px(ITEM_PADDING_X))
        .py(px(ITEM_PADDING_Y))
        .rounded(px(radius::SM))
        .text_size(px(text::SM))
        .line_height(px(text::SM_LINE))
        .text_color(t.foreground)
        .cursor_pointer()
        .when(open, |this| this.bg(accent).text_color(accent_foreground))
        .hover(move |style| style.bg(accent).text_color(accent_foreground))
        .on_hover(move |hovered, window, cx| {
            if *hovered {
                let _ = hover_page.update(cx, |page, cx| page.open_sub(Some(sub), window, cx));
            }
        })
        .on_click(move |_, window, cx| {
            let _ = click_page.update(cx, |page, cx| page.open_sub(Some(sub), window, cx));
        })
        .child(div().flex().flex_none().opacity(ICON_OPACITY).child(icon))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .truncate()
                .child(SharedString::from(label.to_string())),
        )
        .child(
            div()
                .flex_none()
                .min_w_0()
                .max_w(px(SUMMARY_MAX))
                .truncate()
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .text_color(t.muted_foreground)
                .child(SharedString::from(summary.to_string())),
        )
        .child(
            div()
                .flex()
                .flex_none()
                .opacity(ICON_OPACITY)
                .child(path_icon(
                    "icons/chevron-right.svg",
                    16.,
                    t.muted_foreground,
                )),
        )
        .child(record(bounds, sub.anchor()))
        .into_any_element()
}

fn submenu_row(
    sub: FilterSub,
    model: &PullRequestFilterSubmenuModel,
    ctx: &FiltersMenuContext,
    t: &Tokens,
) -> Option<AnyElement> {
    let current = model.current.as_ref()?;
    Some(sub_row(
        sub,
        filter_icon(
            &current.icon,
            MENU_ICON,
            t.muted_foreground,
            &ctx.view.project_icons,
        ),
        &model.label,
        &current.label,
        ctx,
        t,
    ))
}

pub struct FiltersMenuContext<'a> {
    pub view: &'a PullRequestsPageView,
    pub open_sub: Option<FilterSub>,
    pub trigger: Bounds<Pixels>,
    pub anchors: &'a HashMap<String, Bounds<Pixels>>,
    pub page: &'a WeakEntity<PullRequestsPage>,
    pub client: &'a Entity<CoreClient>,
    pub bounds: &'a AnchorBounds,
    pub author_input: Option<&'a Entity<InputState>>,
}

pub fn filters_popup(ctx: &FiltersMenuContext, window: &Window, cx: &App) -> Vec<AnyElement> {
    let t = theme::active(cx);
    let menu = &ctx.view.model.filters_menu;
    let page = ctx.page;
    let bounds = ctx.bounds;
    let dismiss_client = ctx.client.clone();
    let dismiss_bounds = bounds.clone();
    let dismiss_page = page.clone();
    let trigger = ctx.trigger;
    let mut rows: Vec<AnyElement> = Vec::new();
    rows.extend(submenu_row(FilterSub::State, &menu.state, ctx, &t));
    rows.extend(submenu_row(
        FilterSub::Involvement,
        &menu.involvement,
        ctx,
        &t,
    ));
    rows.push(MenuSeparator::new().into_any_element());
    rows.push(sub_row(
        FilterSub::Author,
        path_icon("icons/user-round.svg", MENU_ICON, t.muted_foreground).into_any_element(),
        &menu.author.label,
        &menu.author.summary,
        ctx,
        &t,
    ));
    rows.push(sub_row(
        FilterSub::Labels,
        path_icon("icons/tag.svg", MENU_ICON, t.muted_foreground).into_any_element(),
        &menu.labels.label,
        &menu.labels.summary,
        ctx,
        &t,
    ));
    rows.extend(submenu_row(FilterSub::Draft, &menu.draft, ctx, &t));
    rows.extend(submenu_row(FilterSub::Review, &menu.review, ctx, &t));
    rows.extend(submenu_row(FilterSub::Checks, &menu.checks, ctx, &t));
    if let Some(host) = menu.host.as_ref() {
        rows.push(MenuSeparator::new().into_any_element());
        rows.extend(submenu_row(FilterSub::Host, host, ctx, &t));
    }
    if let Some(server) = menu.server.as_ref() {
        rows.push(MenuSeparator::new().into_any_element());
        rows.extend(submenu_row(FilterSub::Server, server, ctx, &t));
    }
    rows.push(MenuSeparator::new().into_any_element());
    rows.extend(submenu_row(FilterSub::Project, &menu.project, ctx, &t));
    rows.push(record(bounds, FILTERS_SURFACE).into_any_element());
    let popup = MenuPopup::new("pr-filters-popup", trigger)
        .side(Side::Bottom)
        .align(Align::End)
        .on_dismiss(move |window, cx| {
            if trigger.contains(&window.mouse_position())
                || within(&dismiss_bounds, SUB_SURFACE, window)
            {
                return;
            }
            let _ = dismiss_page.update(cx, |page, cx| page.open_sub(None, window, cx));
            act(
                &dismiss_client,
                cx,
                "pullRequestsFiltersOpen",
                json!({ "open": false }),
            );
        })
        .children(rows)
        .into_any_element();
    let mut layers = vec![popup];
    if let Some(sub) = ctx.open_sub
        && let Some(anchor) = ctx.anchors.get(sub.anchor()).copied()
    {
        let side = if f32::from(anchor.right()) + MENU_MIN_WIDTH + VIEWPORT_MARGIN
            > f32::from(window.viewport_size().width)
        {
            Side::Left
        } else {
            Side::Right
        };
        let content = submenu_content(sub, ctx, &t, cx);
        if let Some(content) = content {
            layers.push(
                MenuPopup::new(
                    ElementId::Name(SharedString::from(format!("{}-popup", sub.anchor()))),
                    anchor,
                )
                .side(side)
                .align(Align::Start)
                .side_offset(0.)
                .align_offset(SUB_ALIGN_OFFSET)
                .children(content)
                .child(record(bounds, SUB_SURFACE))
                .into_any_element(),
            );
        }
    }
    layers
}

fn submenu_content(
    sub: FilterSub,
    ctx: &FiltersMenuContext,
    t: &Tokens,
    cx: &App,
) -> Option<Vec<AnyElement>> {
    let menu = &ctx.view.model.filters_menu;
    let model = match sub {
        FilterSub::Author => return Some(author_content(&menu.author, ctx, t, cx)),
        FilterSub::Labels => return Some(labels_content(&menu.labels, ctx, t)),
        FilterSub::State => &menu.state,
        FilterSub::Involvement => &menu.involvement,
        FilterSub::Draft => &menu.draft,
        FilterSub::Review => &menu.review,
        FilterSub::Checks => &menu.checks,
        FilterSub::Host => menu.host.as_ref()?,
        FilterSub::Server => menu.server.as_ref()?,
        FilterSub::Project => &menu.project,
    };
    let mut rows = vec![MenuGroupLabel::new(model.label.clone()).into_any_element()];
    rows.extend(model.options.iter().map(|option| {
        let client = ctx.client.clone();
        let value = option.value.clone();
        let selected = option.selected;
        let item = MenuRadioItem::new(ElementId::Name(SharedString::from(format!(
            "{}-{}",
            sub.anchor(),
            option.value
        ))))
        .checked(option.selected)
        .indicator(true)
        .disabled(option.unavailable.is_some())
        .on_click(move |_, _, cx| {
            if selected {
                return;
            }
            if let Some((action, params)) = sub.change(&value) {
                act(&client, cx, action, params);
            }
        })
        .child(option_icon(option, t.foreground, &ctx.view.project_icons))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .truncate()
                .child(SharedString::from(option.label.clone())),
        )
        .when(option.unavailable.is_some(), |this| {
            this.child(div().flex_none().child("· Unavailable"))
        })
        .into_any_element();
        unavailable_tip(
            format!("{}-{}-tip", sub.anchor(), option.value),
            item,
            option.unavailable.as_ref(),
        )
    }));
    Some(rows)
}

fn author_content(
    model: &PullRequestAuthorFilterModel,
    ctx: &FiltersMenuContext,
    t: &Tokens,
    _cx: &App,
) -> Vec<AnyElement> {
    let mut rows = Vec::new();
    if let Some(input) = ctx.author_input {
        rows.push(
            div()
                .p(px(4.))
                .pb(px(8.))
                .child(
                    InputGroup::input(input)
                        .size(InputSize::Compact)
                        .addon(InputGroupAddon::new(AddonAlign::InlineStart).icon("search")),
                )
                .into_any_element(),
        );
    }
    let anyone_client = ctx.client.clone();
    let anyone_selected = model.value.is_empty();
    rows.push(
        MenuRadioItem::new("sub:author-anyone")
            .checked(anyone_selected)
            .on_click(move |_, _, cx| {
                if !anyone_selected {
                    act(
                        &anyone_client,
                        cx,
                        "pullRequestsSetAuthor",
                        json!({ "value": "" }),
                    );
                }
            })
            .child(path_icon("icons/layers.svg", MENU_ICON, t.foreground))
            .child(SharedString::from(model.anyone_label.clone()))
            .into_any_element(),
    );
    rows.extend(model.rows.iter().map(|row| {
        let client = ctx.client.clone();
        let login = row.login.clone();
        let selected = model.value.eq_ignore_ascii_case(&row.login);
        let actor = ctx.view.author_actors.get(&row.key).unwrap_or(&row.actor);
        MenuRadioItem::new(ElementId::Name(SharedString::from(format!(
            "sub:author-{}",
            row.key
        ))))
        .checked(selected)
        .on_click(move |_, _, cx| {
            if !selected {
                act(
                    &client,
                    cx,
                    "pullRequestsSetAuthor",
                    json!({ "value": login }),
                );
            }
        })
        .child(avatar(actor, AVATAR, t))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .truncate()
                .child(SharedString::from(row.login.clone())),
        )
        .child(
            div()
                .flex_none()
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .font_features(theme::tabular())
                .text_color(t.muted_foreground)
                .child(SharedString::from(row.merged_label.clone())),
        )
        .into_any_element()
    }));
    if let Some(empty) = model.empty_label.as_ref() {
        rows.push(
            MenuItem::new("sub:author-empty")
                .disabled(true)
                .label(empty.clone())
                .into_any_element(),
        );
    }
    rows
}

fn labels_content(
    model: &PullRequestLabelFilterModel,
    ctx: &FiltersMenuContext,
    t: &Tokens,
) -> Vec<AnyElement> {
    if let Some(empty) = model.empty_label.as_ref() {
        return vec![
            MenuItem::new("sub:labels-empty")
                .disabled(true)
                .label(empty.clone())
                .into_any_element(),
        ];
    }
    let accent = t.accent;
    let accent_foreground = t.accent_foreground;
    model
        .rows
        .iter()
        .map(|row| {
            let client = ctx.client.clone();
            let name = row.name.clone();
            let checked = row.checked;
            let dot = row
                .color
                .as_deref()
                .and_then(hex_color)
                .unwrap_or(t.muted_foreground);
            div()
                .id(ElementId::Name(SharedString::from(format!(
                    "sub:labels-{}",
                    row.key
                ))))
                .flex()
                .items_center()
                .gap(px(ITEM_GAP))
                .min_h(px(ITEM_MIN_HEIGHT))
                .pl(px(ITEM_PADDING_X))
                .pr(px(16.))
                .py(px(ITEM_PADDING_Y))
                .rounded(px(radius::SM))
                .text_size(px(text::SM))
                .line_height(px(text::SM_LINE))
                .text_color(t.foreground)
                .cursor_pointer()
                .hover(move |style| style.bg(accent).text_color(accent_foreground))
                .on_click(move |_, _, cx| {
                    act(
                        &client,
                        cx,
                        "pullRequestsToggleLabel",
                        json!({ "name": name, "checked": !checked }),
                    )
                })
                .child(div().flex_none().w(px(16.)).when(checked, |this| {
                    this.child(path_icon("icons/check.svg", 16., t.foreground))
                }))
                .child(
                    div()
                        .flex()
                        .flex_1()
                        .min_w_0()
                        .items_center()
                        .gap(px(ITEM_GAP))
                        .child(div().flex_none().size(px(LABEL_DOT)).rounded_full().bg(dot))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .child(SharedString::from(row.name.clone())),
                        )
                        .child(
                            div()
                                .flex_none()
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .font_features(theme::tabular())
                                .text_color(t.muted_foreground)
                                .child(SharedString::from(row.count_label.clone())),
                        ),
                )
                .into_any_element()
        })
        .collect()
}
