pub mod appearance;
pub mod archived;
pub mod connections;
pub mod diagnostics;
pub mod environment_row;
pub mod general;
pub mod integrations;
pub mod keybindings;
pub mod licenses;
pub mod load_balancing;
pub mod model_controls;
pub mod primitives;
pub mod project_defaults;
pub mod projects;
pub mod providers;
pub mod snap_shot;
pub mod source_control;
pub mod storage;
pub mod theme_import;
pub mod themes;

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::time::{Duration, Instant};

use gpui::component::input::{Enter, InputEvent, InputState, MoveDown, MoveUp};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, AnyView, App, AppContext, Bounds, Context, ElementId, Entity, FocusHandle,
    Focusable, FontWeight, InteractiveElement, IntoElement, KeyDownEvent, ParentElement, Pixels,
    Render, ScrollHandle, SharedString, StatefulInteractiveElement, Styled, Window, canvas, div,
    linear_color_stop, linear_gradient, point, px, svg,
};
use serde_json::{Value, json};

use crate::app::app_sidebar_layout::controls_left;
use crate::app::workspace_breadcrumb::{
    WorkspaceBreadcrumb, WorkspaceBreadcrumbItem, WorkspaceBreadcrumbSeparator,
    WorkspaceBreadcrumbText,
};
use crate::app::workspace_page_header::WorkspacePageHeader;
use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::settings::{
    SettingsBoundaryView, SettingsChromeView, SettingsNavView, SettingsScopeIconView,
    SettingsScopeMenuView, SettingsScopeNoticeChoiceView, SettingsScopeSentenceView,
};
use crate::app_core::views::sidebar::SidebarView;
use crate::features::sidebar::machine_icon;
use crate::features::sidebar::sidebar_chrome::SidebarChromeHeader;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::input::bare_input;
use crate::ui::kbd::Kbd;
use crate::ui::menu::{MenuPopup, MenuRadioItem, MenuSeparator};
use crate::ui::popover::{Align, Side};
use crate::ui::project_favicon::ProjectFavicon;
use crate::ui::scroll_area::ScrollArea;
use crate::ui::sidebar::{
    SidebarContent, SidebarFooter, SidebarGroup, SidebarMenu, SidebarMenuButton,
    SidebarMenuButtonSize, SidebarMenuItem,
};
use crate::ui::theme;
use crate::ui::theme::color::alpha;
use crate::ui::theme::metrics::{radius, text, workspace};
use crate::ui::theme::tokens::{Appearance, Tokens, fade};
use primitives::{
    PAGE_GAP, PAGE_MAX_WIDTH, PAGE_PADDING_BOTTOM, PAGE_PADDING_TOP, PAGE_PADDING_X,
    SECTION_INSET_X, SettingsTargets,
};

type SectionFactory = fn(Entity<CoreClient>, &mut App) -> AnyView;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SettingsPageWidth {
    Readable,
    Wide,
    Expanded,
}

impl SettingsPageWidth {
    fn max_width(self) -> f32 {
        match self {
            SettingsPageWidth::Readable => PAGE_MAX_WIDTH,
            SettingsPageWidth::Wide => 1024.,
            SettingsPageWidth::Expanded => 1152.,
        }
    }
}

pub struct NativeSection {
    pub name: &'static str,
    pub width: SettingsPageWidth,
    pub gap: f32,
    pub create: SectionFactory,
}

const NATIVE_SECTIONS: &[NativeSection] = &[
    NativeSection {
        name: "providers",
        width: SettingsPageWidth::Wide,
        gap: PAGE_GAP,
        create: |client, cx| {
            cx.new(|cx| providers::ProvidersSection::new(client, cx))
                .into()
        },
    },
    NativeSection {
        name: "general",
        width: SettingsPageWidth::Readable,
        gap: PAGE_GAP,
        create: |client, cx| cx.new(|cx| general::GeneralSection::new(client, cx)).into(),
    },
    NativeSection {
        name: "appearance",
        width: SettingsPageWidth::Readable,
        gap: PAGE_GAP,
        create: |client, cx| {
            cx.new(|cx| appearance::AppearanceSection::new(client, cx))
                .into()
        },
    },
    NativeSection {
        name: "local",
        width: SettingsPageWidth::Expanded,
        gap: 24.,
        create: |client, cx| {
            cx.new(|cx| crate::features::local::LocalSection::new(client, cx))
                .into()
        },
    },
    NativeSection {
        name: "open-source-licenses",
        width: SettingsPageWidth::Readable,
        gap: PAGE_GAP,
        create: |client, cx| {
            cx.new(|cx| licenses::LicensesSection::new(client, cx))
                .into()
        },
    },
    NativeSection {
        name: "integrations",
        width: SettingsPageWidth::Readable,
        gap: PAGE_GAP,
        create: |client, cx| {
            cx.new(|cx| integrations::IntegrationsSection::new(client, cx))
                .into()
        },
    },
    NativeSection {
        name: "storage",
        width: SettingsPageWidth::Readable,
        gap: PAGE_GAP,
        create: |client, cx| cx.new(|cx| storage::StorageSection::new(client, cx)).into(),
    },
    NativeSection {
        name: "archived",
        width: SettingsPageWidth::Readable,
        gap: PAGE_GAP,
        create: |client, cx| {
            cx.new(|cx| archived::ArchivedSection::new(client, cx))
                .into()
        },
    },
    NativeSection {
        name: "diagnostics",
        width: SettingsPageWidth::Expanded,
        gap: 40.,
        create: |client, cx| {
            cx.new(|cx| diagnostics::DiagnosticsSection::new(client, cx))
                .into()
        },
    },
    NativeSection {
        name: "keybindings",
        width: SettingsPageWidth::Readable,
        gap: PAGE_GAP,
        create: |client, cx| {
            cx.new(|cx| keybindings::KeybindingsSection::new(client, cx))
                .into()
        },
    },
    NativeSection {
        name: "source-control",
        width: SettingsPageWidth::Readable,
        gap: PAGE_GAP,
        create: |client, cx| {
            cx.new(|cx| source_control::SourceControlSection::new(client, cx))
                .into()
        },
    },
    NativeSection {
        name: "projects",
        width: SettingsPageWidth::Readable,
        gap: 24.,
        create: |client, cx| {
            cx.new(|cx| projects::ProjectsSection::new(client, cx))
                .into()
        },
    },
    NativeSection {
        name: "connections",
        width: SettingsPageWidth::Wide,
        gap: PAGE_GAP,
        create: |client, cx| {
            cx.new(|cx| connections::ConnectionsSection::new(client, cx))
                .into()
        },
    },
    NativeSection {
        name: "snap-shot",
        width: SettingsPageWidth::Readable,
        gap: PAGE_GAP,
        create: |client, cx| {
            cx.new(|cx| snap_shot::SnapShotSection::new(client, cx))
                .into()
        },
    },
];

fn native_section(name: &str) -> Option<&'static NativeSection> {
    NATIVE_SECTIONS.iter().find(|section| section.name == name)
}

const SENTENCE_GAP_X: f32 = 6.;
const SENTENCE_GAP_Y: f32 = 4.;
const SENTENCE_ICON: f32 = 14.;
const SENTENCE_TRIGGER_MAX_WIDTH: f32 = 288.;
const DISMISS_GRACE_MS: u64 = 300;
const NOTICE_RADIUS: f32 = 14.;
const NOTICE_PADDING_X: f32 = 14.;
const NOTICE_PADDING_Y: f32 = 12.;
const NOTICE_GAP: f32 = 10.;
const NOTICE_ACTION_GAP: f32 = 4.;
const TARGET_ATTEMPTS: u32 = 120;
const SEARCH_ROW_HEIGHT: f32 = 32.;
const SEARCH_ICON: f32 = 16.;
const SEARCH_INPUT_HEIGHT: f32 = 21.;
const RESULT_MIN_HEIGHT: f32 = 40.;
const RESULT_ICON: f32 = 14.;
const RESULT_LABEL_TEXT: f32 = 11.;
const EMPTY_PADDING_Y: f32 = 24.;
const NAV_STACK_GAP: f32 = 8.;

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

fn section_icon(key: &str) -> SharedString {
    if key == "snap-shot" {
        SharedString::new_static("icons/settings/snap-shot.svg")
    } else {
        SharedString::from(format!("icons/{key}.svg"))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum ScopeAxis {
    Project,
    Environment,
}

impl ScopeAxis {
    fn key(self) -> &'static str {
        match self {
            ScopeAxis::Project => "project",
            ScopeAxis::Environment => "environment",
        }
    }
}

pub struct SettingsPage {
    client: Entity<CoreClient>,
    chrome: Entity<ViewState<Option<SettingsChromeView>>>,
    scroll: ScrollHandle,
    focus: FocusHandle,
    sections: HashMap<String, AnyView>,
    shown_section: Option<String>,
    content_key: Option<String>,
    handled_revision: Option<u64>,
    target_attempts: u32,
    open_menu: Option<ScopeAxis>,
    dismissed_menu: Option<(ScopeAxis, Instant)>,
    trigger_bounds: Rc<RefCell<HashMap<ScopeAxis, Bounds<Pixels>>>>,
    needs_focus: bool,
    search_focus: Option<FocusHandle>,
    pub(crate) collapsed_inset: Option<f32>,
}

impl SettingsPage {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let chrome = CoreClient::subscribe::<Option<SettingsChromeView>>(
            &client,
            "settingsChrome",
            json!({}),
            cx,
        );
        cx.observe(&chrome, |page, chrome, cx| {
            let shown = chrome.read(cx).data.clone().flatten();
            match shown {
                Some(view) => {
                    if page.shown_section.is_none() {
                        page.needs_focus = true;
                    }
                    if page.shown_section.as_deref() != Some(view.section.as_str()) {
                        page.shown_section = Some(view.section.clone());
                        page.scroll.set_offset(point(px(0.), px(0.)));
                        SettingsTargets::clear_bounds(cx);
                        page.open_menu = None;
                    }
                    if page.content_key.as_deref() != Some(view.content_key.as_str()) {
                        page.content_key = Some(view.content_key.clone());
                        page.sections.clear();
                    }
                }
                None => {
                    page.shown_section = None;
                    page.open_menu = None;
                    SettingsTargets::set_target(cx, None);
                }
            }
            cx.notify();
        })
        .detach();
        Self {
            client,
            chrome,
            scroll: ScrollHandle::new(),
            focus: cx.focus_handle(),
            sections: HashMap::new(),
            shown_section: None,
            content_key: None,
            handled_revision: None,
            target_attempts: 0,
            open_menu: None,
            dismissed_menu: None,
            trigger_bounds: Rc::new(RefCell::new(HashMap::new())),
            needs_focus: false,
            search_focus: None,
            collapsed_inset: None,
        }
    }

    pub(crate) fn set_search_focus(&mut self, focus: FocusHandle) {
        self.search_focus = Some(focus);
    }

    fn section_view(&mut self, section: &str, cx: &mut Context<Self>) -> Option<AnyView> {
        if let Some(view) = self.sections.get(section) {
            return Some(view.clone());
        }
        let entry = native_section(section)?;
        let view = (entry.create)(self.client.clone(), cx);
        self.sections.insert(section.to_string(), view.clone());
        Some(view)
    }

    fn process_target(
        &mut self,
        view: &SettingsChromeView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let target = &view.target;
        let Some(target_id) = target.target_id.clone() else {
            SettingsTargets::set_target(cx, None);
            self.target_attempts = 0;
            return;
        };
        SettingsTargets::set_target(cx, Some(SharedString::from(target_id.clone())));
        if self.handled_revision == Some(target.revision) {
            return;
        }
        let Some(row) = SettingsTargets::bounds_of(cx, &target_id) else {
            if self.target_attempts < TARGET_ATTEMPTS {
                self.target_attempts += 1;
                window.request_animation_frame();
            }
            return;
        };
        let container = self.scroll.bounds();
        let offset = self.scroll.offset();
        let max = self.scroll.max_offset();
        let content_top = row.top() - container.top() - offset.y;
        let desired = (container.size.height - row.size.height) / 2.;
        let next = (-(content_top - desired)).clamp(-max.y, px(0.));
        self.scroll.set_offset(point(offset.x, next));
        self.handled_revision = Some(target.revision);
        self.target_attempts = 0;
        if target.highlight {
            SettingsTargets::start_pulse(cx, SharedString::from(target_id), target.revision);
        }
        act(
            &self.client,
            cx,
            "settingsTargetHandled",
            json!({ "revision": target.revision }),
        );
        cx.notify();
    }

    fn breadcrumb(view: &SettingsChromeView) -> WorkspaceBreadcrumb {
        let mut crumb = WorkspaceBreadcrumb::new();
        for item in &view.breadcrumb.items {
            if item.current {
                crumb = crumb.child(
                    WorkspaceBreadcrumbItem::new(true)
                        .child(WorkspaceBreadcrumbText::new(item.label.clone())),
                );
            } else {
                crumb = crumb
                    .child(
                        WorkspaceBreadcrumbItem::new(false)
                            .child(WorkspaceBreadcrumbText::new(item.label.clone())),
                    )
                    .child(WorkspaceBreadcrumbSeparator);
            }
        }
        crumb
    }

    fn header(&self, view: &SettingsChromeView) -> impl IntoElement {
        let client = self.client.clone();
        WorkspacePageHeader::new()
            .collapsed_sidebar_inset(self.collapsed_inset)
            .child(
                div()
                    .flex()
                    .w_full()
                    .min_w_0()
                    .items_center()
                    .gap(px(12.))
                    .child(Self::breadcrumb(view))
                    .children(view.restore.as_ref().map(|restore| {
                        div().ml_auto().flex().flex_none().items_center().child(
                            Button::new("settings-restore-device-defaults")
                                .size(ButtonSize::Xs)
                                .variant(ButtonVariant::Ghost)
                                .icon("rotate-ccw")
                                .icon_size(14.)
                                .child(div().flex_none().w_0())
                                .child(restore.action_label.clone())
                                .disabled(!restore.can_restore)
                                .on_click(move |_, _, cx| {
                                    act(&client, cx, "settingsRestoreDefaults", json!({}))
                                }),
                        )
                    })),
            )
    }

    fn scope_icon(icon: &SettingsScopeIconView, color: gpui::Rgba) -> AnyElement {
        match icon {
            SettingsScopeIconView::Layers => svg()
                .path("icons/layers.svg")
                .size(px(SENTENCE_ICON))
                .flex_none()
                .text_color(color)
                .into_any_element(),
            SettingsScopeIconView::EnvironmentMachine { machine } => svg()
                .path(machine_icon(*machine))
                .size(px(SENTENCE_ICON))
                .flex_none()
                .text_color(color)
                .into_any_element(),
            SettingsScopeIconView::ProjectFavicon { icon, .. } => div()
                .flex()
                .flex_none()
                .child(ProjectFavicon::new(icon, SENTENCE_ICON))
                .into_any_element(),
        }
    }

    fn scope_trigger(
        &self,
        axis: ScopeAxis,
        menu: &SettingsScopeMenuView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let open = self.open_menu == Some(axis);
        let group = SharedString::from(format!("settings-scope-trigger-{}", axis.key()));
        let bounds = self.trigger_bounds.clone();
        let underline = fade(t.foreground, 0.3);
        let solid = t.foreground;
        div()
            .id(ElementId::Name(SharedString::from(format!(
                "settings-scope-{}",
                axis.key()
            ))))
            .group(group.clone())
            .relative()
            .flex()
            .min_w_0()
            .max_w(px(SENTENCE_TRIGGER_MAX_WIDTH))
            .items_center()
            .gap(px(SENTENCE_GAP_X))
            .cursor_pointer()
            .font_weight(FontWeight::MEDIUM)
            .text_color(t.foreground)
            .on_click(cx.listener(move |page, _, _, cx| {
                let reopening = page.dismissed_menu.take().is_some_and(|(dismissed, at)| {
                    dismissed == axis && at.elapsed() < Duration::from_millis(DISMISS_GRACE_MS)
                });
                page.open_menu = if page.open_menu == Some(axis) || reopening {
                    None
                } else {
                    Some(axis)
                };
                cx.notify();
            }))
            .children(
                menu.icon
                    .as_ref()
                    .map(|icon| Self::scope_icon(icon, t.foreground)),
            )
            .child(
                div()
                    .relative()
                    .min_w_0()
                    .child(div().truncate().child(menu.label.clone()))
                    .child(
                        canvas(
                            |_, _, _| {},
                            move |bounds, _, window, _| {
                                let y = bounds.bottom() - px(1.);
                                let mut x = bounds.left();
                                while x < bounds.right() {
                                    window.paint_quad(gpui::fill(
                                        Bounds::new(point(x, y), gpui::size(px(1.), px(1.))),
                                        underline,
                                    ));
                                    x += px(2.);
                                }
                            },
                        )
                        .absolute()
                        .top_0()
                        .left_0()
                        .size_full(),
                    )
                    .child(
                        div()
                            .absolute()
                            .left_0()
                            .right_0()
                            .bottom_0()
                            .h(px(1.))
                            .when(open, |line| line.bg(solid))
                            .group_hover(group.clone(), move |line| line.bg(solid)),
                    ),
            )
            .child(
                svg()
                    .path("icons/chevron-down.svg")
                    .size(px(SENTENCE_ICON))
                    .flex_none()
                    .text_color(t.muted_foreground),
            )
            .child(
                canvas(
                    move |trigger, _, _| {
                        bounds.borrow_mut().insert(axis, trigger);
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .top_0()
                .left_0()
                .size_full(),
            )
    }

    fn scope_menu(
        &self,
        axis: ScopeAxis,
        menu: &SettingsScopeMenuView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        if self.open_menu != Some(axis) {
            return None;
        }
        let trigger = self.trigger_bounds.borrow().get(&axis).copied()?;
        let mut items: Vec<AnyElement> = Vec::new();
        for option in &menu.options {
            let value = option.value.clone();
            let client = self.client.clone();
            let page = cx.entity().downgrade();
            items.push(
                MenuRadioItem::new(ElementId::Name(SharedString::from(format!(
                    "settings-scope-{}-{}",
                    axis.key(),
                    option.value
                ))))
                .checked(option.value == menu.value)
                .indicator(true)
                .on_click(move |_, _, cx| {
                    act(
                        &client,
                        cx,
                        "settingsSelectScope",
                        json!({ "axis": axis.key(), "value": value }),
                    );
                    let _ = page.update(cx, |page, cx| {
                        page.open_menu = None;
                        cx.notify();
                    });
                })
                .children(
                    option
                        .icon
                        .as_ref()
                        .map(|icon| Self::scope_icon(icon, t.foreground)),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .child(option.label.clone()),
                )
                .children(option.badge.clone().map(|badge| {
                    div()
                        .flex_none()
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .text_color(t.muted_foreground)
                        .child(badge)
                }))
                .into_any_element(),
            );
            if option.separator_after {
                items.push(MenuSeparator::new().into_any_element());
            }
        }
        let page = cx.entity().downgrade();
        let escape = cx.entity().downgrade();
        Some(
            MenuPopup::new(
                ElementId::Name(SharedString::from(format!(
                    "settings-scope-menu-{}",
                    axis.key()
                ))),
                trigger,
            )
            .side(Side::Bottom)
            .align(Align::Start)
            .on_dismiss(move |_, cx| {
                let _ = page.update(cx, |page, cx| {
                    page.open_menu = None;
                    page.dismissed_menu = Some((axis, Instant::now()));
                    cx.notify();
                });
            })
            .child(
                div()
                    .id(ElementId::Name(SharedString::from(format!(
                        "settings-scope-menu-keys-{}",
                        axis.key()
                    ))))
                    .flex()
                    .flex_col()
                    .w_full()
                    .on_key_down(move |event: &KeyDownEvent, _, cx| {
                        if event.keystroke.key == "escape" {
                            cx.stop_propagation();
                            let _ = escape.update(cx, |page, cx| {
                                page.open_menu = None;
                                cx.notify();
                            });
                        }
                    })
                    .children(items),
            )
            .into_any_element(),
        )
    }

    fn sentence(
        &self,
        sentence: &SettingsScopeSentenceView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        div()
            .flex()
            .flex_wrap()
            .min_w_0()
            .items_center()
            .gap_x(px(SENTENCE_GAP_X))
            .gap_y(px(SENTENCE_GAP_Y))
            .px(px(SECTION_INSET_X))
            .text_size(px(text::BASE))
            .line_height(px(text::BASE_LINE))
            .text_color(t.muted_foreground)
            .child(
                div()
                    .flex()
                    .min_w_0()
                    .items_center()
                    .gap(px(SENTENCE_GAP_X))
                    .child(div().flex_none().child(sentence.lead.clone()))
                    .child(self.scope_trigger(ScopeAxis::Project, &sentence.project, t, cx)),
            )
            .child(
                div()
                    .flex()
                    .min_w_0()
                    .items_center()
                    .gap(px(SENTENCE_GAP_X))
                    .child(div().flex_none().child(sentence.connective.clone()))
                    .child(self.scope_trigger(
                        ScopeAxis::Environment,
                        &sentence.environment,
                        t,
                        cx,
                    )),
            )
            .children(self.scope_menu(ScopeAxis::Project, &sentence.project, t, cx))
            .children(self.scope_menu(ScopeAxis::Environment, &sentence.environment, t, cx))
    }

    fn notice(
        &self,
        message: &str,
        target_id: &str,
        choices: &[SettingsScopeNoticeChoiceView],
        t: &Tokens,
    ) -> impl IntoElement {
        scope_notice(&self.client, message, target_id, choices, t)
    }
}

pub fn scope_notice(
    client: &Entity<CoreClient>,
    message: &str,
    target_id: &str,
    choices: &[SettingsScopeNoticeChoiceView],
    t: &Tokens,
) -> impl IntoElement {
    {
        let dark = t.appearance == Appearance::Dark;
        let buttons = choices.iter().map(|choice| {
            let client = client.clone();
            let search = choice.search.clone();
            let target = (!target_id.is_empty()).then(|| target_id.to_string());
            Button::new(ElementId::Name(SharedString::from(format!(
                "settings-notice-{}",
                choice.id
            ))))
            .size(ButtonSize::SmMultiline)
            .variant(ButtonVariant::Outline)
            .label(choice.label.clone())
            .max_w_full()
            .on_click(move |_, _, cx| {
                act(
                    &client,
                    cx,
                    "settingsSelectScope",
                    json!({ "search": search, "targetId": target }),
                )
            })
        });
        div()
            .relative()
            .w_full()
            .rounded(px(NOTICE_RADIUS))
            .border_1()
            .border_color(t.border)
            .px(px(NOTICE_PADDING_X))
            .py(px(NOTICE_PADDING_Y))
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .text_color(t.card_foreground)
            .when(dark, |this| this.bg(fade(t.input, 0.32)))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(NOTICE_GAP))
                    .text_color(t.muted_foreground)
                    .child(div().child(message.to_string()))
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .gap(px(NOTICE_ACTION_GAP))
                            .children(buttons),
                    ),
            )
    }
}

impl SettingsPage {
    fn body(
        &mut self,
        view: &SettingsChromeView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let layout = matches!(view.boundary, SettingsBoundaryView::Content)
            .then(|| native_section(&view.section))
            .flatten();
        let sentence = view
            .scope_sentence
            .as_ref()
            .map(|sentence| self.sentence(sentence, t, cx).into_any_element());
        let content: Option<AnyElement> = match &view.boundary {
            SettingsBoundaryView::Content => self
                .section_view(&view.section, cx)
                .map(IntoElement::into_any_element),
            SettingsBoundaryView::Notice {
                message,
                target_id,
                choices,
            } => Some(
                self.notice(message, target_id, choices, t)
                    .into_any_element(),
            ),
            SettingsBoundaryView::Message { message } => Some(
                div()
                    .text_size(px(text::SM))
                    .line_height(px(text::SM_LINE))
                    .text_color(t.muted_foreground)
                    .child(message.clone())
                    .into_any_element(),
            ),
        };
        let page = cx.entity().downgrade();
        let surface = t.background;
        div()
            .relative()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .child(
                ScrollArea::new("settings-page-scroll")
                    .track_scroll(&self.scroll)
                    .flex_1()
                    .min_h_0()
                    .child(
                        div().flex().w_full().justify_center().child(
                            div()
                                .relative()
                                .flex()
                                .flex_col()
                                .w_full()
                                .max_w(px(
                                    layout.map_or(PAGE_MAX_WIDTH, |entry| entry.width.max_width())
                                ))
                                .px(px(PAGE_PADDING_X))
                                .pt(px(PAGE_PADDING_TOP))
                                .pb(px(PAGE_PADDING_BOTTOM))
                                .gap(px(layout.map_or(PAGE_GAP, |entry| entry.gap)))
                                .children(sentence)
                                .children(content)
                                .child(
                                    canvas(
                                        move |bounds, _, cx| {
                                            let width =
                                                f32::from(bounds.size.width) - PAGE_PADDING_X * 2.;
                                            if SettingsTargets::set_content_width(cx, width) {
                                                let _ = page.update(cx, |_, cx| cx.notify());
                                            }
                                        },
                                        |_, _, _, _| {},
                                    )
                                    .absolute()
                                    .top_0()
                                    .left_0()
                                    .size_full(),
                                ),
                        ),
                    ),
            )
            .child(
                div()
                    .absolute()
                    .top_0()
                    .left_0()
                    .right(px(workspace::SCROLLBAR_WIDTH))
                    .h(px(workspace::TITLEBAR_SCROLL_FADE_HEIGHT))
                    .bg(linear_gradient(
                        180.,
                        linear_color_stop(surface, 0.),
                        linear_color_stop(alpha(surface, 0.), 1.),
                    )),
            )
            .into_any_element()
    }
}

impl Render for SettingsPage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = theme::active(cx);
        let Some(view) = self.chrome.read(cx).data.clone().flatten() else {
            return div().size_full().into_any_element();
        };
        if self.needs_focus {
            self.needs_focus = false;
            self.focus.focus(window, cx);
        }
        self.process_target(&view, window, cx);
        let client = self.client.clone();
        let page_focus = self.focus.clone();
        let search_focus = self.search_focus.clone();
        let body = self.body(&view, &t, cx);
        div()
            .id("settings-page")
            .track_focus(&self.focus)
            .flex()
            .flex_col()
            .flex_1()
            .size_full()
            .min_w_0()
            .min_h_0()
            .bg(t.background)
            .text_color(t.foreground)
            .on_key_down(move |event: &KeyDownEvent, window, cx| {
                let keystroke = &event.keystroke;
                let modifiers = keystroke.modifiers;
                if keystroke.key == "escape" && !event.is_held {
                    cx.stop_propagation();
                    window.blur(cx);
                    act(&client, cx, "settingsClose", json!({}));
                    return;
                }
                let slash = keystroke.key == "/" || keystroke.key_char.as_deref() == Some("/");
                if slash
                    && !modifiers.platform
                    && !modifiers.control
                    && !modifiers.alt
                    && page_focus.is_focused(window)
                    && let Some(search) = search_focus.as_ref()
                {
                    cx.stop_propagation();
                    search.focus(window, cx);
                }
            })
            .child(self.header(&view))
            .child(body)
            .into_any_element()
    }
}

pub struct SettingsNav {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<SettingsNavView>>>,
    sidebar: Entity<ViewState<SidebarView>>,
    page: Entity<SettingsPage>,
    search: Option<Entity<InputState>>,
    shown: bool,
    scroll: ScrollHandle,
    result_bounds: Rc<RefCell<HashMap<usize, Bounds<Pixels>>>>,
    revealed_index: Option<usize>,
}

impl SettingsNav {
    pub fn new(
        client: Entity<CoreClient>,
        sidebar: Entity<ViewState<SidebarView>>,
        page: Entity<SettingsPage>,
        cx: &mut Context<Self>,
    ) -> Self {
        let view =
            CoreClient::subscribe::<Option<SettingsNavView>>(&client, "settingsNav", json!({}), cx);
        cx.observe(&view, |nav, view, cx| {
            let shown = view.read(cx).data.as_ref().is_some_and(Option::is_some);
            if shown != nav.shown {
                nav.shown = shown;
                nav.revealed_index = None;
            }
            cx.notify();
        })
        .detach();
        cx.observe(&sidebar, |_, _, cx| cx.notify()).detach();
        Self {
            client,
            view,
            sidebar,
            page,
            search: None,
            shown: false,
            scroll: ScrollHandle::new(),
            result_bounds: Rc::new(RefCell::new(HashMap::new())),
            revealed_index: None,
        }
    }

    fn ensure_search(
        &mut self,
        placeholder: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<InputState> {
        if let Some(search) = self.search.clone() {
            return search;
        }
        let placeholder = SharedString::from(placeholder.to_string());
        let search = cx.new(|cx| InputState::new(window, cx).placeholder(placeholder));
        let client = self.client.clone();
        cx.subscribe_in(
            &search,
            window,
            move |_, search, event: &InputEvent, _, cx| {
                if let InputEvent::Change = event {
                    let query = search.read(cx).value().to_string();
                    act(&client, cx, "settingsSearch", json!({ "query": query }));
                }
            },
        )
        .detach();
        let focus = search.read(cx).focus_handle(cx);
        self.page.update(cx, |page, _| page.set_search_focus(focus));
        self.search = Some(search.clone());
        search
    }

    fn clear_search(search: &Entity<InputState>, window: &mut Window, cx: &mut App) {
        search.update(cx, |state, cx| state.set_value("", window, cx));
    }

    fn reveal_active(&mut self, index: usize) {
        if self.revealed_index == Some(index) {
            return;
        }
        let Some(row) = self.result_bounds.borrow().get(&index).copied() else {
            return;
        };
        self.revealed_index = Some(index);
        let container = self.scroll.bounds();
        let offset = self.scroll.offset();
        let max = self.scroll.max_offset();
        let next = if row.top() < container.top() {
            offset.y + (container.top() - row.top())
        } else if row.bottom() > container.bottom() {
            offset.y - (row.bottom() - container.bottom())
        } else {
            return;
        };
        self.scroll
            .set_offset(point(offset.x, next.clamp(-max.y, px(0.))));
    }
}

impl Render for SettingsNav {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = theme::sidebar(cx);
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return div().size_full().into_any_element();
        };
        let search = self.ensure_search(&view.search.placeholder, window, cx);
        if view.search.query.is_empty() && !search.read(cx).value().is_empty() {
            let focused = search.read(cx).focus_handle(cx).is_focused(window);
            if !focused {
                Self::clear_search(&search, window, cx);
            }
        }
        if view.search.is_searching {
            let index = view.search.active_result_index;
            self.reveal_active(index);
        } else {
            self.revealed_index = None;
        }
        let header = self.sidebar.read(cx).data.as_ref().map(|sidebar| {
            SidebarChromeHeader::new(
                sidebar.header.brand_label.clone(),
                sidebar.header.stage_backdrop,
                controls_left(window),
            )
            .pill(sidebar.header.stage_pill.clone())
        });
        let client = self.client.clone();
        let is_searching = view.search.is_searching;
        let active_index = view.search.active_result_index;
        let has_results = !view.search.results.is_empty();
        let key_search = search.clone();
        let key_client = client.clone();
        let up_client = client.clone();
        let down_client = client.clone();
        let enter_client = client.clone();
        let enter_search = search.clone();
        let search_row = div()
            .id("settings-nav-search")
            .flex()
            .h(px(SEARCH_ROW_HEIGHT))
            .items_center()
            .gap(px(8.))
            .rounded(px(radius::MD))
            .px(px(8.))
            .py(px(6.))
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .font_weight(FontWeight::MEDIUM)
            .text_color(t.sidebar_muted_foreground)
            .hover(|style| {
                style
                    .bg(t.sidebar_row_hover)
                    .text_color(t.sidebar_foreground)
            })
            .capture_action(move |_: &MoveDown, _, cx| {
                if has_results {
                    cx.stop_propagation();
                    act(
                        &down_client,
                        cx,
                        "settingsSearchMove",
                        json!({ "delta": 1 }),
                    );
                }
            })
            .capture_action(move |_: &MoveUp, _, cx| {
                if has_results {
                    cx.stop_propagation();
                    act(&up_client, cx, "settingsSearchMove", json!({ "delta": -1 }));
                }
            })
            .capture_action(move |_: &Enter, window, cx| {
                if has_results {
                    cx.stop_propagation();
                    act(
                        &enter_client,
                        cx,
                        "settingsSearchSelect",
                        json!({ "index": active_index }),
                    );
                    Self::clear_search(&enter_search, window, cx);
                }
            })
            .capture_key_down(move |event: &KeyDownEvent, window, cx| {
                if event.keystroke.key == "escape" && is_searching {
                    cx.stop_propagation();
                    act(&key_client, cx, "settingsSearchClear", json!({}));
                    Self::clear_search(&key_search, window, cx);
                }
            })
            .child(
                svg()
                    .path("icons/search.svg")
                    .size(px(SEARCH_ICON))
                    .flex_none()
                    .text_color(fade(t.sidebar_muted_foreground, 0.8)),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.sidebar_foreground)
                    .child(bare_input(
                        &search,
                        SEARCH_INPUT_HEIGHT,
                        0.,
                        0.,
                        text::SM,
                        false,
                    )),
            )
            .child(if is_searching {
                let clear_client = client.clone();
                let clear_search = search.clone();
                Button::new("settings-nav-search-clear")
                    .size(ButtonSize::IconMicro)
                    .variant(ButtonVariant::GhostMuted)
                    .icon("x")
                    .icon_size(12.)
                    .accessibility_label(view.search.clear_label.clone())
                    .on_click(move |_, window, cx| {
                        act(&clear_client, cx, "settingsSearchClear", json!({}));
                        Self::clear_search(&clear_search, window, cx);
                        let focus = clear_search.read(cx).focus_handle(cx);
                        focus.focus(window, cx);
                    })
                    .into_any_element()
            } else {
                Kbd::new(view.search.shortcut_hint.clone()).into_any_element()
            });
        let empty = view.search.empty_message.clone().map(|message| {
            div()
                .px(px(8.))
                .py(px(EMPTY_PADDING_Y))
                .text_center()
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .text_color(t.sidebar_muted_foreground)
                .child(message)
        });
        let list: AnyElement = if is_searching {
            self.result_bounds.borrow_mut().clear();
            let rows = view.search.results.iter().enumerate().map(|(index, row)| {
                let select_client = client.clone();
                let hover_client = client.clone();
                let select_search = search.clone();
                let bounds = self.result_bounds.clone();
                let active = row.active;
                SidebarMenuItem::new().child(
                    div()
                        .id(ElementId::Name(SharedString::from(row.element_id.clone())))
                        .on_hover(move |hovered, _, cx| {
                            if *hovered && !active {
                                act(
                                    &hover_client,
                                    cx,
                                    "settingsSearchActivate",
                                    json!({ "index": index }),
                                );
                            }
                        })
                        .child(
                            SidebarMenuButton::new(ElementId::Name(SharedString::from(format!(
                                "{}-button",
                                row.element_id
                            ))))
                            .size(SidebarMenuButtonSize::Sm)
                            .active(row.active)
                            .h_auto()
                            .min_h(px(RESULT_MIN_HEIGHT))
                            .items_start()
                            .on_click(move |_, window, cx| {
                                act(
                                    &select_client,
                                    cx,
                                    "settingsSearchSelect",
                                    json!({ "index": index }),
                                );
                                Self::clear_search(&select_search, window, cx);
                            })
                            .child(
                                svg()
                                    .path(section_icon(&row.icon))
                                    .size(px(RESULT_ICON))
                                    .mt(px(2.))
                                    .flex_none()
                                    .text_color(if row.active {
                                        t.sidebar_foreground
                                    } else {
                                        fade(t.sidebar_muted_foreground, 0.6)
                                    }),
                            )
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
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(t.sidebar_foreground)
                                            .child(row.title.clone()),
                                    )
                                    .child(
                                        div()
                                            .truncate()
                                            .text_size(px(RESULT_LABEL_TEXT))
                                            .line_height(px(text::XS_LINE))
                                            .text_color(fade(t.sidebar_muted_foreground, 0.75))
                                            .child(row.section_label.clone()),
                                    ),
                            ),
                        )
                        .child(
                            canvas(
                                move |row_bounds, _, _| {
                                    bounds.borrow_mut().insert(index, row_bounds);
                                },
                                |_, _, _, _| {},
                            )
                            .absolute()
                            .top_0()
                            .left_0()
                            .size_full(),
                        )
                        .relative(),
                )
            });
            SidebarMenu::new().children(rows).into_any_element()
        } else {
            let rows = view.sections.iter().map(|section| {
                let select_client = client.clone();
                let name = section.section.clone();
                SidebarMenuItem::new().child(
                    SidebarMenuButton::new(ElementId::Name(SharedString::from(format!(
                        "settings-nav-{}",
                        section.section
                    ))))
                    .icon(section_icon(&section.icon))
                    .label(section.label.clone())
                    .active(section.active)
                    .on_click(move |_, _, cx| {
                        act(
                            &select_client,
                            cx,
                            "settingsSelectSection",
                            json!({ "section": name }),
                        )
                    }),
                )
            });
            SidebarMenu::new().children(rows).into_any_element()
        };
        let back_client = client.clone();
        let escape_client = client.clone();
        div()
            .id("settings-nav")
            .flex()
            .flex_col()
            .size_full()
            .on_key_down(move |event: &KeyDownEvent, window, cx| {
                if event.keystroke.key == "escape" && !event.is_held {
                    cx.stop_propagation();
                    window.blur(cx);
                    act(&escape_client, cx, "settingsClose", json!({}));
                }
            })
            .children(header)
            .child(
                SidebarContent::new("settings-nav-content")
                    .fill_height()
                    .track_scroll(&self.scroll)
                    .group(
                        SidebarGroup::new().child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(NAV_STACK_GAP))
                                .child(search_row)
                                .children(empty)
                                .child(list),
                        ),
                    ),
            )
            .child(
                SidebarFooter::new().flex_none().child(
                    SidebarMenu::new().flex_row().items_center().child(
                        SidebarMenuItem::new().flex_1().min_w_0().child(
                            SidebarMenuButton::new("settings-nav-back")
                                .icon("icons/arrow-left.svg")
                                .label(view.back_label.clone())
                                .on_click(move |_, _, cx| {
                                    act(&back_client, cx, "settingsClose", json!({}))
                                }),
                        ),
                    ),
                ),
            )
            .into_any_element()
    }
}

pub fn open_settings(client: &Entity<CoreClient>, cx: &mut App) {
    act(client, cx, "settingsOpen", json!({}));
}
