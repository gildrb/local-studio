use gpui::component::input::{InputEvent, InputState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, Bounds, Context, Entity, FontWeight, InteractiveElement,
    IntoElement, KeyDownEvent, ParentElement, PathPromptOptions, Pixels, Render, SharedString,
    StatefulInteractiveElement, Styled, Window, canvas, div, px, svg,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::settings_projects::{
    ProjectActionRowView, ProjectActionsView, ProjectDetailView, ProjectFaviconPickerView,
    ProjectIconPickerView, SettingsProjectsView,
};
use crate::features::chat::model_picker::ModelPickerActions;
use crate::features::chat::project_scripts_host::script_icon;
use crate::features::settings::model_controls::SettingsModelActions;
use crate::features::settings::primitives::{SettingResetButton, SettingsRow, SettingsSection};
use crate::features::settings::project_defaults::{
    PROJECT_DEFAULTS_PICKER, SectionModelPicker, project_defaults_section,
};
use crate::features::settings::scope_notice;
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::command::{
    CommandDialogPopup, CommandFooter, CommandFooterAction, CommandFooterHint, CommandGroupLabel,
    CommandInput, CommandItem, FooterKey, INPUT_HEIGHT, LIST_PADDING, command_panel, footer_hints,
};
use crate::ui::dialog::{
    DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle,
};
use crate::ui::input::{Input, InputSize, bare_input};
use crate::ui::label::Label;
use crate::ui::menu::{MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator};
use crate::ui::pierre_icon::pierre_icon;
use crate::ui::popover::Align;
use crate::ui::project_favicon::ProjectFavicon;
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::palette::{project_icon, project_swatch};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::toggle::Toggle;
use crate::ui::toggle_group::ToggleGroup;
use crate::ui::tooltip::Tooltip;

const PAGE_GAP: f32 = 24.;
const NAME_INPUT_WIDTH: f32 = 256.;
const ICON_PREVIEW: f32 = 24.;
const CONTROL_GAP: f32 = 8.;
const ACTIONS_GAP: f32 = 6.;
const ALERT_RADIUS: f32 = 14.;
const ALERT_PADDING_X: f32 = 14.;
const ALERT_PADDING_Y: f32 = 12.;
const ALERT_ICON: f32 = 16.;
const ALERT_GAP: f32 = 8.;
const EMPTY_PADDING: f32 = 32.;
const ROW_ICON: f32 = 16.;
const ROW_TITLE_GAP: f32 = 8.;
const BADGE_PADDING_X: f32 = 6.;
const BADGE_PADDING_Y: f32 = 1.;
const BADGE_RADIUS: f32 = 4.;
const SMALL_SCREEN: f32 = 640.;
const EDIT_BUTTON: f32 = 24.;
const EDIT_ICON: f32 = 14.;
const EMPTY_LIST_PADDING_X: f32 = 16.;
const EMPTY_LIST_PADDING_Y: f32 = 8.;
const CHEVRON: f32 = 14.;
const IMPORT_ICON: f32 = 16.;
const IMPORT_MENU_WIDTH: f32 = 288.;
const IMPORT_DESCRIPTION_PADDING_X: f32 = 8.;
const IMPORT_DESCRIPTION_PADDING_BOTTOM: f32 = 8.;
const PICKER_WIDTH: f32 = 512.;
const PANEL_GAP: f32 = 16.;
const SWATCH_BUTTON: f32 = 24.;
const SWATCH: f32 = 16.;
const SWATCH_GAP: f32 = 6.;
const GRID_COLUMNS: usize = 10;
const GRID_GAP: f32 = 4.;
const GRID_MAX_HEIGHT: f32 = 256.;
const GRID_ICON: f32 = 20.;
const GRID_EMOJI: f32 = 20.;
const GRID_PADDING: f32 = 2.;
const MONOGRAM_PREVIEW: f32 = 48.;
const MONOGRAM_GAP: f32 = 16.;
const FIELD_GAP: f32 = 8.;
const SECTION_LABEL_GAP: f32 = 8.;
const PICKER_EMPTY_PADDING: f32 = 32.;
const PALETTE_MAX_HEIGHT: f32 = 448.;
const PALETTE_MAX_VIEWPORT: f32 = 0.7;
const PALETTE_EMPTY_PADDING_Y: f32 = 40.;
const FILE_ICON: f32 = 16.;

const MODEL_ACTIONS: SettingsModelActions = SettingsModelActions {
    open: "settingsProjectsPickerOpen",
    close: "settingsProjectsPickerClose",
    search: "settingsProjectsPickerSearch",
    traits: "settingsProjectsTraitsSelect",
    picker: ModelPickerActions {
        rail: "settingsProjectsPickerRail",
        select: "settingsProjectsPickerSelect",
        favorite: "settingsProjectsPickerFavorite",
        toggle_legacy: "settingsProjectsPickerToggleLegacy",
        close: "settingsProjectsPickerClose",
        setup: Some("settingsProjectsPickerSetup"),
    },
};

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

fn on_click(
    client: &Entity<CoreClient>,
    action: &'static str,
    params: Value,
) -> impl Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static {
    let client = client.clone();
    move |_, _, cx| act(&client, cx, action, params.clone())
}

struct NameInput {
    state: Entity<InputState>,
    key: String,
    baseline: String,
    edited: bool,
}

pub struct ProjectsSection {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<SettingsProjectsView>>>,
    picker: SectionModelPicker,
    name: Option<NameInput>,
    icon_query: Option<Entity<InputState>>,
    letters: Option<Entity<InputState>>,
    custom_emoji: Option<Entity<InputState>>,
    favicon_query: Option<Entity<InputState>>,
    handled_request: Option<u64>,
    import_open: bool,
    import_bounds: Bounds<Pixels>,
}

impl ProjectsSection {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<SettingsProjectsView>>(
            &client,
            "settingsProjects",
            json!({}),
            cx,
        );
        cx.observe(&view, |_, _, cx| cx.notify()).detach();
        act(&client, cx, "settingsProjectsMount", json!({}));
        let picker = SectionModelPicker::new(MODEL_ACTIONS, cx);
        Self {
            client,
            view,
            picker,
            name: None,
            icon_query: None,
            letters: None,
            custom_emoji: None,
            favicon_query: None,
            handled_request: None,
            import_open: false,
            import_bounds: Bounds::default(),
        }
    }

    fn text_input(
        &self,
        value: &str,
        placeholder: Option<&str>,
        action: &'static str,
        focus: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<InputState> {
        let value = value.to_string();
        let placeholder = placeholder.map(str::to_string);
        let state = cx.new(|cx| {
            let mut state = InputState::new(window, cx);
            state.set_value(value, window, cx);
            if let Some(placeholder) = placeholder {
                state.set_placeholder(placeholder, window, cx);
            }
            state
        });
        let client = self.client.clone();
        cx.subscribe_in(
            &state,
            window,
            move |_: &mut Self, state, event: &InputEvent, _, cx| {
                if let InputEvent::Change = event {
                    let value = state.read(cx).value().to_string();
                    act(&client, cx, action, json!({ "value": value }));
                }
            },
        )
        .detach();
        if focus {
            state.update(cx, |state, cx| state.focus(window, cx));
        }
        state
    }

    fn sync(&mut self, detail: &ProjectDetailView, window: &mut Window, cx: &mut Context<Self>) {
        self.picker
            .sync(detail.model_picker.as_ref(), &self.client, window, cx);
        self.sync_name(detail, window, cx);
        match &detail.icon_picker {
            Some(picker) => {
                if self.icon_query.is_none() {
                    let query = picker
                        .icons
                        .as_ref()
                        .map_or("", |icons| icons.query.as_str());
                    let placeholder = picker
                        .icons
                        .as_ref()
                        .map(|icons| icons.search_placeholder.clone());
                    self.icon_query = Some(self.text_input(
                        query,
                        placeholder.as_deref(),
                        "settingsProjectsIconPickerQuery",
                        false,
                        window,
                        cx,
                    ));
                }
                if self.letters.is_none() {
                    let letters = picker
                        .monogram
                        .as_ref()
                        .map_or(String::new(), |monogram| monogram.letters.clone());
                    self.letters = Some(self.text_input(
                        &letters,
                        None,
                        "settingsProjectsIconPickerLetters",
                        false,
                        window,
                        cx,
                    ));
                }
                if self.custom_emoji.is_none() {
                    let placeholder = picker
                        .emojis
                        .as_ref()
                        .map(|emojis| emojis.custom_placeholder.clone());
                    self.custom_emoji = Some(self.text_input(
                        &picker.custom_emoji,
                        placeholder.as_deref(),
                        "settingsProjectsIconPickerCustomEmoji",
                        false,
                        window,
                        cx,
                    ));
                }
            }
            None => {
                self.icon_query = None;
                self.letters = None;
                self.custom_emoji = None;
            }
        }
        match &detail.favicon_picker {
            Some(favicon) => {
                if self.favicon_query.is_none() {
                    let state = self.text_input(
                        &favicon.query,
                        Some(&favicon.placeholder),
                        "settingsProjectsFaviconQuery",
                        true,
                        window,
                        cx,
                    );
                    let client = self.client.clone();
                    cx.subscribe_in(
                        &state,
                        window,
                        move |_: &mut Self, _, event: &InputEvent, _, cx| {
                            if let InputEvent::PressEnter { .. } = event {
                                act(&client, cx, "settingsProjectsFaviconSubmit", json!({}));
                            }
                        },
                    )
                    .detach();
                    self.favicon_query = Some(state);
                }
            }
            None => self.favicon_query = None,
        }
        self.serve_external_request(detail, cx);
    }

    fn sync_name(
        &mut self,
        detail: &ProjectDetailView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let key = detail.name.input_key.clone();
        let value = detail.name.value.clone();
        if let Some(name) = self.name.as_mut() {
            if name.key != key {
                name.key = key;
                name.baseline = value.clone();
                name.edited = false;
                name.state
                    .update(cx, |state, cx| state.set_value(value, window, cx));
            }
            return;
        }
        let initial = value.clone();
        let state = cx.new(|cx| {
            let mut state = InputState::new(window, cx);
            state.set_value(initial, window, cx);
            state
        });
        let client = self.client.clone();
        cx.subscribe_in(
            &state,
            window,
            move |section: &mut Self, state, event: &InputEvent, window, cx| match event {
                InputEvent::Change => {
                    let current = state.read(cx).value().to_string();
                    if let Some(name) = section.name.as_mut()
                        && current != name.baseline
                    {
                        name.edited = true;
                    }
                }
                InputEvent::PressEnter { .. } => window.blur(cx),
                InputEvent::Blur => {
                    let current = state.read(cx).value().to_string();
                    let edited = section.name.as_mut().is_some_and(|name| {
                        let edited = name.edited;
                        name.edited = false;
                        edited
                    });
                    act(
                        &client,
                        cx,
                        "settingsProjectsRename",
                        json!({ "value": current, "edited": edited }),
                    );
                }
                InputEvent::Focus => {}
            },
        )
        .detach();
        self.name = Some(NameInput {
            state,
            key,
            baseline: value,
            edited: false,
        });
    }

    fn serve_external_request(&mut self, detail: &ProjectDetailView, cx: &mut Context<Self>) {
        let Some(request) = detail.external_request.as_ref() else {
            return;
        };
        if self.handled_request == Some(request.id) {
            return;
        }
        self.handled_request = Some(request.id);
        let paths = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some(request.prompt.clone().into()),
        });
        let client = self.client.clone();
        let request_id = request.id;
        cx.spawn(async move |_, cx| {
            let (path, error) = match paths.await {
                Ok(Ok(Some(paths))) => (
                    paths
                        .into_iter()
                        .next()
                        .map(|path| path.to_string_lossy().into_owned()),
                    None,
                ),
                Ok(Ok(None)) => (None, None),
                Ok(Err(error)) => (None, Some(error.to_string())),
                Err(error) => (None, Some(error.to_string())),
            };
            cx.update(|cx| {
                act(
                    &client,
                    cx,
                    "settingsProjectsFaviconPicked",
                    json!({ "requestId": request_id, "path": path, "error": error }),
                )
            });
        })
        .detach();
    }

    fn notice(&self, message: &str, t: &Tokens) -> AnyElement {
        div()
            .relative()
            .w_full()
            .rounded(px(ALERT_RADIUS))
            .border_1()
            .border_color(fade(t.info, 0.32))
            .bg(fade(t.info, 0.04))
            .px(px(ALERT_PADDING_X))
            .py(px(ALERT_PADDING_Y))
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .text_color(t.card_foreground)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(ALERT_GAP))
                    .child(
                        svg()
                            .path("icons/info.svg")
                            .flex_none()
                            .size(px(ALERT_ICON))
                            .text_color(t.info),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .text_color(t.muted_foreground)
                            .child(message.to_string()),
                    ),
            )
            .into_any_element()
    }

    fn overview(&self, detail: &ProjectDetailView) -> AnyElement {
        let client = &self.client;
        let name_control = match self.name.as_ref() {
            Some(name) => div()
                .w(px(NAME_INPUT_WIDTH))
                .child(Input::new(&name.state).size(InputSize::Sm))
                .into_any_element(),
            None => div().into_any_element(),
        };
        let icon = &detail.icon;
        let mut icon_row = SettingsRow::new("project-icon", icon.title.clone())
            .description(icon.description.clone())
            .control(
                div()
                    .flex()
                    .items_center()
                    .gap(px(CONTROL_GAP))
                    .child(ProjectFavicon::new(&detail.icon_preview, ICON_PREVIEW))
                    .child(
                        Button::new("project-icon-choose")
                            .size(ButtonSize::Sm)
                            .variant(ButtonVariant::Outline)
                            .disabled(icon.disabled)
                            .accessibility_label(icon.choose_icon.aria_label.clone())
                            .label(icon.choose_icon.label.clone())
                            .on_click(on_click(
                                client,
                                "settingsProjectsIconPickerOpen",
                                json!({}),
                            )),
                    )
                    .child(
                        Button::new("project-icon-file")
                            .size(ButtonSize::Sm)
                            .variant(ButtonVariant::Outline)
                            .disabled(icon.disabled)
                            .accessibility_label(icon.choose_file.aria_label.clone())
                            .label(icon.choose_file.label.clone())
                            .on_click(on_click(client, "settingsProjectsFaviconOpen", json!({}))),
                    ),
            );
        if icon.resettable {
            let reset = client.clone();
            icon_row = icon_row.reset_action(
                SettingResetButton::new("project-icon-reset", icon.reset_label.clone())
                    .disabled(icon.disabled)
                    .on_click(move |_, cx| act(&reset, cx, "settingsProjectsIconReset", json!({}))),
            );
        }
        SettingsSection::new(detail.overview_title.clone())
            .id(detail.overview_section_id.clone())
            .hide_title()
            .child(
                SettingsRow::new("project-name", detail.name.title.clone())
                    .description(detail.name.description.clone())
                    .control(name_control),
            )
            .child(icon_row)
            .into_any_element()
    }

    fn action_row(&self, row: &ProjectActionRowView, small: bool, t: &Tokens) -> AnyElement {
        let group = SharedString::from(format!("project-action-{}", row.id));
        let badges = row
            .badges
            .iter()
            .filter(|badge| !(small && badge.hide_on_small_screens))
            .map(|badge| {
                div()
                    .flex_none()
                    .rounded(px(BADGE_RADIUS))
                    .border_1()
                    .border_color(fade(t.border, 0.6))
                    .px(px(BADGE_PADDING_X))
                    .py(px(BADGE_PADDING_Y))
                    .text_size(px(text::XXS))
                    .line_height(px(text::XS_LINE))
                    .font_weight(FontWeight::NORMAL)
                    .text_color(t.muted_foreground)
                    .child(badge.label.clone())
            });
        let title = div()
            .flex()
            .min_w_0()
            .items_center()
            .gap(px(ROW_TITLE_GAP))
            .child(
                svg()
                    .path(SharedString::from(format!(
                        "icons/{}.svg",
                        script_icon(&row.icon)
                    )))
                    .flex_none()
                    .size(px(ROW_ICON))
                    .text_color(t.muted_foreground),
            )
            .child(div().min_w_0().truncate().child(row.name.clone()))
            .children(badges);
        let description = div()
            .max_w_full()
            .truncate()
            .font_family(MONO_FONT)
            .child(row.command.clone());
        let control = div()
            .flex()
            .items_center()
            .gap(px(CONTROL_GAP))
            .children(row.shortcut_label.clone().map(|label| {
                div()
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.muted_foreground)
                    .child(label)
            }))
            .child(
                div()
                    .flex()
                    .flex_none()
                    .opacity(0.)
                    .group_hover(group.clone(), |style| style.opacity(1.))
                    .child(
                        Button::new(SharedString::from(format!(
                            "project-action-edit-{}",
                            row.id
                        )))
                        .size(ButtonSize::IconXs)
                        .variant(ButtonVariant::GhostMuted)
                        .w(px(EDIT_BUTTON))
                        .h(px(EDIT_BUTTON))
                        .icon("settings")
                        .icon_size(EDIT_ICON)
                        .disabled(row.edit_disabled)
                        .accessibility_label(row.edit_aria_label.clone())
                        .on_click(on_click(
                            &self.client,
                            "settingsProjectsActionEdit",
                            json!({ "scriptId": row.id }),
                        )),
                    ),
            );
        div()
            .group(group)
            .child(
                SettingsRow::new(format!("project-action-{}", row.id), row.name.clone())
                    .title_element(title)
                    .description_element(description)
                    .control(control),
            )
            .into_any_element()
    }

    fn actions(
        &self,
        actions: &ProjectActionsView,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = theme::active(cx);
        let client = &self.client;
        let small = window.viewport_size().width.as_f32() < SMALL_SCREEN;
        let entity = cx.entity();
        let import = actions.import_menu.as_ref().map(|menu| {
            let toggle = entity.clone();
            let measure = entity.clone();
            div()
                .relative()
                .flex_none()
                .child(
                    Button::new(SharedString::from(menu.button_id.clone()))
                        .size(ButtonSize::Xs)
                        .variant(ButtonVariant::Ghost)
                        .disabled(menu.disabled)
                        .label(menu.label.clone())
                        .icon_end("chevron-down")
                        .icon_size(CHEVRON)
                        .on_click(move |_, _, cx| {
                            toggle.update(cx, |section, cx| {
                                section.import_open = !section.import_open;
                                cx.notify();
                            })
                        }),
                )
                .child(
                    canvas(
                        move |bounds, _, cx| {
                            measure.update(cx, |section, _| section.import_bounds = bounds)
                        },
                        |_, _, _, _| {},
                    )
                    .absolute()
                    .size_full(),
                )
        });
        let add = Button::new("project-actions-add")
            .size(ButtonSize::Xs)
            .variant(ButtonVariant::Outline)
            .disabled(actions.add_action.disabled)
            .icon("plus")
            .icon_size(CHEVRON)
            .label(actions.add_action.label.clone())
            .on_click(on_click(client, "settingsProjectsActionAdd", json!({})));
        let reset = client.clone();
        let header = SettingsRow::new(
            format!("{}-header", actions.section_id),
            actions.header.title.clone(),
        )
        .description(actions.header.description.clone())
        .scope(&actions.header_row_scope, client)
        .on_reset_override(move |_, cx| act(&reset, cx, "settingsProjectsActionsReset", json!({})))
        .control(
            div()
                .flex()
                .flex_wrap()
                .items_center()
                .gap(px(ACTIONS_GAP))
                .children(import)
                .child(add),
        );
        let mut section = SettingsSection::new(actions.title.clone())
            .id(actions.section_id.clone())
            .child(header);
        if let Some(notice) = actions.mixed_notice.as_ref() {
            section = section.child(
                SettingsRow::new("project-actions-mixed", notice.title.clone())
                    .description(notice.description.clone()),
            );
        } else if let Some(empty) = actions.empty_label.clone() {
            section = section.child(
                div()
                    .px(px(EMPTY_LIST_PADDING_X))
                    .py(px(EMPTY_LIST_PADDING_Y))
                    .text_size(px(text::SM))
                    .line_height(px(text::SM_LINE))
                    .text_color(t.muted_foreground)
                    .child(empty),
            );
        } else {
            let rows: Vec<AnyElement> = actions
                .rows
                .iter()
                .map(|row| self.action_row(row, small, &t))
                .collect();
            section = section.children(rows);
        }
        if let Some(notice) = actions.invalid_file_notice.as_ref() {
            section = section.child(
                SettingsRow::new("project-actions-invalid-file", notice.title.clone())
                    .title_element(div().text_color(t.warning).child(notice.title.clone()))
                    .description(notice.description.clone()),
            );
        }
        section.into_any_element()
    }

    fn import_menu(
        &self,
        actions: &ProjectActionsView,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let menu = actions.import_menu.as_ref().filter(|_| self.import_open)?;
        let t = theme::active(cx);
        let trigger = self.import_bounds;
        let entity = cx.entity();
        let close = move |cx: &mut App| {
            entity.update(cx, |section, cx| {
                section.import_open = false;
                cx.notify();
            })
        };
        let dismiss = close.clone();
        let escape = close.clone();
        let items = menu.items.iter().map(|item| {
            let client = self.client.clone();
            let key = item.key.clone();
            let close = close.clone();
            MenuItem::new(SharedString::from(format!(
                "project-actions-import-{}",
                item.key
            )))
            .child(
                svg()
                    .path(SharedString::from(format!(
                        "icons/{}.svg",
                        script_icon(&item.icon)
                    )))
                    .flex_none()
                    .size(px(IMPORT_ICON))
                    .text_color(t.muted_foreground),
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
                            .font_weight(FontWeight::MEDIUM)
                            .child(item.name.clone()),
                    )
                    .child(
                        div()
                            .truncate()
                            .font_family(MONO_FONT)
                            .text_color(t.muted_foreground)
                            .child(item.command.clone()),
                    ),
            )
            .on_click(move |_, _, cx| {
                close(cx);
                act(
                    &client,
                    cx,
                    "settingsProjectsActionImport",
                    json!({ "key": key }),
                );
            })
            .into_any_element()
        });
        Some(
            MenuPopup::new("project-actions-import-menu", trigger)
                .align(Align::End)
                .min_width(IMPORT_MENU_WIDTH)
                .on_dismiss(move |window, cx| {
                    if !trigger.contains(&window.mouse_position()) {
                        dismiss(cx);
                    }
                })
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .max_w(px(IMPORT_MENU_WIDTH))
                        .on_key_down(move |event: &KeyDownEvent, _, cx| {
                            if event.keystroke.key == "escape" {
                                cx.stop_propagation();
                                escape(cx);
                            }
                        })
                        .child(MenuGroupLabel::new(menu.group_label.clone()))
                        .child(
                            div()
                                .px(px(IMPORT_DESCRIPTION_PADDING_X))
                                .pb(px(IMPORT_DESCRIPTION_PADDING_BOTTOM))
                                .text_size(px(text::SM))
                                .line_height(px(text::SM_LINE))
                                .text_color(t.muted_foreground)
                                .child(menu.description.clone()),
                        )
                        .child(MenuSeparator::new())
                        .children(items),
                )
                .into_any_element(),
        )
    }

    fn checkouts(&self, detail: &ProjectDetailView) -> Option<AnyElement> {
        let checkouts = detail.checkouts.as_ref()?;
        let rows: Vec<AnyElement> = checkouts
            .rows
            .iter()
            .map(|row| {
                SettingsRow::new(format!("project-checkout-{}", row.id), row.title.clone())
                    .description(row.description.clone())
                    .control(
                        Button::new(SharedString::from(format!(
                            "project-checkout-remove-{}",
                            row.id
                        )))
                        .size(ButtonSize::Sm)
                        .variant(ButtonVariant::Outline)
                        .accessibility_label(row.remove_aria_label.clone())
                        .label(row.remove_label.clone())
                        .on_click(on_click(
                            &self.client,
                            "settingsProjectsRemoveCheckout",
                            json!({ "checkoutKey": row.id }),
                        )),
                    )
                    .into_any_element()
            })
            .collect();
        Some(
            SettingsSection::new(checkouts.title.clone())
                .children(rows)
                .into_any_element(),
        )
    }

    fn danger(&self, detail: &ProjectDetailView) -> AnyElement {
        let danger = &detail.danger;
        SettingsSection::new(danger.section_title.clone())
            .child(
                SettingsRow::new("project-danger", danger.title.clone())
                    .description(danger.description.clone())
                    .control(
                        Button::new("project-remove")
                            .size(ButtonSize::Sm)
                            .variant(ButtonVariant::DestructiveOutline)
                            .icon(danger.action_icon.clone())
                            .label(danger.action_label.clone())
                            .on_click(on_click(
                                &self.client,
                                "settingsProjectsRemoveAll",
                                json!({}),
                            )),
                    ),
            )
            .into_any_element()
    }

    fn grid(cells: Vec<AnyElement>) -> AnyElement {
        let mut rows: Vec<AnyElement> = Vec::new();
        let mut cells = cells.into_iter().peekable();
        while cells.peek().is_some() {
            let row: Vec<AnyElement> = cells.by_ref().take(GRID_COLUMNS).collect();
            let missing = GRID_COLUMNS - row.len();
            rows.push(
                div()
                    .flex()
                    .gap(px(GRID_GAP))
                    .children(row)
                    .children((0..missing).map(|_| div().flex_1()))
                    .into_any_element(),
            );
        }
        div()
            .id("project-icon-grid")
            .max_h(px(GRID_MAX_HEIGHT))
            .overflow_y_scroll()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(GRID_GAP))
                    .p(px(GRID_PADDING))
                    .children(rows),
            )
            .into_any_element()
    }

    fn grid_cell(
        id: SharedString,
        selected: bool,
        label: String,
        content: AnyElement,
        on_click: impl Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static,
        t: &Tokens,
    ) -> AnyElement {
        let hover = t.accent;
        div()
            .id(id)
            .flex_1()
            .flex()
            .items_center()
            .justify_center()
            .min_w_0()
            .rounded(px(radius::MD))
            .border_1()
            .border_color(if selected {
                t.border
            } else {
                gpui::transparent_black().into()
            })
            .when(selected, |cell| cell.bg(t.accent))
            .hover(move |style| style.bg(hover))
            .cursor_pointer()
            .child(
                div().w_full().pb(gpui::relative(1.)).relative().child(
                    div()
                        .absolute()
                        .inset_0()
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(content),
                ),
            )
            .tooltip(Tooltip::text(label))
            .on_click(on_click)
            .into_any_element()
    }

    fn icon_picker(&self, picker: &ProjectIconPickerView, cx: &mut Context<Self>) -> AnyElement {
        let t = theme::active(cx);
        let client = &self.client;
        let mode_toggles = picker.mode_options.iter().map(|option| {
            let client = client.clone();
            let value = option.value.clone();
            Toggle::new(SharedString::from(format!(
                "project-icon-mode-{}",
                option.value
            )))
            .label(option.label.clone())
            .pressed(picker.mode == option.value)
            .on_change(move |_, _, _, cx| {
                act(
                    &client,
                    cx,
                    "settingsProjectsIconPickerMode",
                    json!({ "value": value }),
                )
            })
        });
        let mut panel = DialogPanel::new("project-icon-picker-panel")
            .after_header(true)
            .child(ToggleGroup::new("project-icon-mode").items(mode_toggles));
        if let Some(colors) = picker.colors.as_ref() {
            let swatches = colors.options.iter().map(|option| {
                let client = client.clone();
                let value = option.label.to_lowercase();
                let label = option.label.clone();
                div()
                    .id(SharedString::from(format!(
                        "project-icon-color-{}",
                        option.label
                    )))
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_center()
                    .size(px(SWATCH_BUTTON))
                    .rounded_full()
                    .border_1()
                    .border_color(if option.selected {
                        fade(t.foreground, 0.64)
                    } else {
                        gpui::transparent_black().into()
                    })
                    .cursor_pointer()
                    .child(
                        div()
                            .size(px(SWATCH))
                            .rounded_full()
                            .bg(project_swatch(option.value)),
                    )
                    .tooltip(Tooltip::text(label))
                    .on_click(move |_, _, cx| {
                        act(
                            &client,
                            cx,
                            "settingsProjectsIconPickerColor",
                            json!({ "value": value }),
                        )
                    })
            });
            panel = panel.child(
                div()
                    .child(
                        div()
                            .mb(px(SECTION_LABEL_GAP))
                            .text_size(px(text::XS))
                            .line_height(px(text::XS_LINE))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.muted_foreground)
                            .child(colors.label.clone()),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .gap(px(SWATCH_GAP))
                            .children(swatches),
                    ),
            );
        }
        if let Some(icons) = picker.icons.as_ref() {
            let ink = project_icon(icons.color, t.appearance);
            let cells: Vec<AnyElement> = icons
                .icons
                .iter()
                .map(|entry| {
                    let client = client.clone();
                    let name = entry.name.clone();
                    Self::grid_cell(
                        SharedString::from(format!("project-icon-{}", entry.name)),
                        entry.selected,
                        entry.label.clone(),
                        svg()
                            .path(SharedString::from(format!("icons/{}.svg", entry.asset)))
                            .size(px(GRID_ICON))
                            .text_color(ink)
                            .into_any_element(),
                        move |_, _, cx| {
                            act(
                                &client,
                                cx,
                                "settingsProjectsIconPickerIcon",
                                json!({ "value": name }),
                            )
                        },
                        &t,
                    )
                })
                .collect();
            if let Some(query) = self.icon_query.as_ref() {
                panel = panel.child(Input::new(query));
            }
            panel = panel.child(Self::grid(cells));
            if let Some(empty) = icons.empty_label.clone() {
                panel = panel.child(
                    div()
                        .py(px(PICKER_EMPTY_PADDING))
                        .text_center()
                        .text_size(px(text::SM))
                        .line_height(px(text::SM_LINE))
                        .text_color(t.muted_foreground)
                        .child(empty),
                );
            }
        } else if let Some(monogram) = picker.monogram.as_ref() {
            let preview = crate::app_core::views::sidebar::ProjectIconView::Monogram {
                text: monogram.preview_text.clone(),
                color: monogram.color,
            };
            panel = panel.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(MONOGRAM_GAP))
                    .py(px(CONTROL_GAP))
                    .child(ProjectFavicon::new(&preview, MONOGRAM_PREVIEW))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .gap(px(FIELD_GAP))
                            .child(Label::new(monogram.label.clone()))
                            .children(
                                self.letters
                                    .as_ref()
                                    .map(|letters| Input::new(letters).invalid(!monogram.valid)),
                            )
                            .child(
                                div()
                                    .text_size(px(text::XS))
                                    .line_height(px(text::XS_LINE))
                                    .text_color(t.muted_foreground)
                                    .child(monogram.hint.clone()),
                            ),
                    ),
            );
        } else if let Some(emojis) = picker.emojis.as_ref() {
            let cells: Vec<AnyElement> = emojis
                .options
                .iter()
                .map(|option| {
                    let client = client.clone();
                    let emoji = option.emoji.clone();
                    Self::grid_cell(
                        SharedString::from(format!("project-emoji-{}", option.label)),
                        option.selected,
                        option.label.clone(),
                        div()
                            .text_size(px(GRID_EMOJI))
                            .line_height(px(text::LG_LINE))
                            .child(option.emoji.clone())
                            .into_any_element(),
                        move |_, _, cx| {
                            act(
                                &client,
                                cx,
                                "settingsProjectsIconPickerEmoji",
                                json!({ "value": emoji }),
                            )
                        },
                        &t,
                    )
                })
                .collect();
            panel = panel.child(Self::grid(cells)).child(
                div()
                    .child(
                        div()
                            .mb(px(SECTION_LABEL_GAP))
                            .text_size(px(text::XS))
                            .line_height(px(text::XS_LINE))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.muted_foreground)
                            .child(emojis.custom_label.clone()),
                    )
                    .children(self.custom_emoji.as_ref().map(Input::new)),
            );
        }
        let close = client.clone();
        let escape = client.clone();
        DialogPopup::new("project-icon-picker")
            .max_width(PICKER_WIDTH)
            .on_close(move |_, cx| act(&close, cx, "settingsProjectsIconPickerClose", json!({})))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .min_h_0()
                    .on_key_down(move |event: &KeyDownEvent, _, cx| {
                        if event.keystroke.key == "escape" {
                            cx.stop_propagation();
                            act(&escape, cx, "settingsProjectsIconPickerClose", json!({}));
                        }
                    })
                    .child(
                        DialogHeader::new()
                            .with_panel(true)
                            .child(DialogTitle::new(picker.title.clone()))
                            .child(DialogDescription::new(picker.description.clone())),
                    )
                    .child(div().flex().flex_col().gap(px(PANEL_GAP)).child(panel))
                    .child(
                        DialogFooter::new()
                            .child(
                                Button::new("project-icon-picker-cancel")
                                    .variant(ButtonVariant::Outline)
                                    .label(picker.cancel_label.clone())
                                    .on_click(on_click(
                                        client,
                                        "settingsProjectsIconPickerClose",
                                        json!({}),
                                    )),
                            )
                            .child(
                                Button::new("project-icon-picker-save")
                                    .disabled(picker.save_disabled)
                                    .label(picker.save_label.clone())
                                    .on_click(on_click(
                                        client,
                                        "settingsProjectsIconPickerSave",
                                        json!({}),
                                    )),
                            ),
                    ),
            )
            .into_any_element()
    }

    fn favicon_picker(
        &self,
        favicon: &ProjectFaviconPickerView,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = theme::active(cx);
        let client = &self.client;
        let panel_max =
            (window.viewport_size().height.as_f32() * PALETTE_MAX_VIEWPORT).min(PALETTE_MAX_HEIGHT);
        let list = if favicon.files.is_empty() {
            div()
                .flex_none()
                .py(px(PALETTE_EMPTY_PADDING_Y))
                .text_center()
                .text_size(px(text::SM))
                .line_height(px(text::SM_LINE))
                .text_color(t.muted_foreground)
                .child(favicon.empty_state_message.clone())
                .into_any_element()
        } else {
            let rows = favicon.files.iter().map(|file| {
                let select = client.clone();
                let hover = client.clone();
                let value = file.value.clone();
                let hovered = file.value.clone();
                CommandItem::new(SharedString::from(file.value.clone()))
                    .selected(favicon.highlighted.as_deref() == Some(file.value.as_str()))
                    .child(div().flex().flex_none().child(pierre_icon(
                        &file.icon,
                        px(FILE_ICON),
                        cx,
                    )))
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
                                    .text_color(t.foreground)
                                    .child(file.title.clone()),
                            )
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(text::XS))
                                    .line_height(px(text::XS_LINE))
                                    .text_color(fade(t.muted_foreground, 0.7))
                                    .child(file.description.clone()),
                            ),
                    )
                    .on_hover(move |hovered_now, _, cx| {
                        if *hovered_now {
                            act(
                                &hover,
                                cx,
                                "settingsProjectsFaviconHighlight",
                                json!({ "value": hovered }),
                            );
                        }
                    })
                    .on_click(move |_, _, cx| {
                        act(
                            &select,
                            cx,
                            "settingsProjectsFaviconSelect",
                            json!({ "value": value }),
                        )
                    })
                    .into_any_element()
            });
            div()
                .id("project-favicon-list")
                .flex()
                .flex_col()
                .min_h_0()
                .overflow_y_scroll()
                .p(px(LIST_PADDING))
                .child(CommandGroupLabel::new(favicon.group_label.clone()))
                .children(rows)
                .into_any_element()
        };
        let footer = CommandFooter::new().child(
            footer_hints()
                .child(CommandFooterHint::new(
                    vec![
                        FooterKey::Icon("arrow-up".into()),
                        FooterKey::Icon("arrow-down".into()),
                    ],
                    "Navigate",
                ))
                .child(CommandFooterHint::new(
                    vec![FooterKey::Text("Enter".into())],
                    favicon.footer_action_label.clone(),
                ))
                .child(CommandFooterHint::new(
                    vec![FooterKey::Text("Esc".into())],
                    favicon.escape_label.clone(),
                )),
        );
        let footer = match favicon.external_action.as_ref() {
            Some(external) if !external.disabled => footer.child(
                CommandFooterAction::new("project-favicon-external", external.label.clone())
                    .on_click(on_click(
                        client,
                        "settingsProjectsFaviconPickExternal",
                        json!({}),
                    )),
            ),
            Some(external) => footer.child(div().opacity(0.64).child(CommandFooterAction::new(
                "project-favicon-external",
                external.label.clone(),
            ))),
            None => footer,
        };
        let input = self.favicon_query.as_ref().map(|state| {
            CommandInput::new(bare_input(
                state,
                INPUT_HEIGHT - 2.,
                0.,
                0.,
                text::SM,
                false,
            ))
        });
        let dismiss = client.clone();
        let keys = client.clone();
        CommandDialogPopup::new("project-favicon-picker")
            .on_dismiss(move |_, cx| act(&dismiss, cx, "settingsProjectsFaviconClose", json!({})))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .min_h_0()
                    .capture_key_down(move |event: &KeyDownEvent, _, cx| {
                        let delta = match event.keystroke.key.as_str() {
                            "up" => -1,
                            "down" => 1,
                            "escape" => {
                                cx.stop_propagation();
                                act(&keys, cx, "settingsProjectsFaviconClose", json!({}));
                                return;
                            }
                            _ => return,
                        };
                        cx.stop_propagation();
                        act(
                            &keys,
                            cx,
                            "settingsProjectsFaviconMove",
                            json!({ "delta": delta }),
                        );
                    })
                    .children(input)
                    .child(
                        command_panel()
                            .flex_initial()
                            .max_h(px(panel_max))
                            .child(list),
                    )
                    .child(footer),
            )
            .into_any_element()
    }

    fn detail(
        &self,
        detail: &ProjectDetailView,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = theme::active(cx);
        let overlays = self.picker.overlays(
            &[(
                PROJECT_DEFAULTS_PICKER,
                detail.defaults.model_picker.as_ref(),
            )],
            detail.model_picker.as_ref(),
            &self.client,
            cx,
        );
        div()
            .flex()
            .flex_col()
            .gap(px(PAGE_GAP))
            .child(self.notice(&detail.notice, &t))
            .child(self.overview(detail))
            .child(project_defaults_section(
                &detail.defaults,
                &self.picker,
                &self.client,
                "settingsProjectsDefaults",
                cx,
            ))
            .child(self.actions(&detail.actions, window, cx))
            .children(self.checkouts(detail))
            .child(self.danger(detail))
            .children(overlays)
            .children(self.import_menu(&detail.actions, cx))
            .children(
                detail
                    .icon_picker
                    .as_ref()
                    .map(|picker| self.icon_picker(picker, cx)),
            )
            .children(
                detail
                    .favicon_picker
                    .as_ref()
                    .map(|favicon| self.favicon_picker(favicon, window, cx)),
            )
            .into_any_element()
    }
}

impl Render for ProjectsSection {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return div().into_any_element();
        };
        let t = theme::active(cx);
        match &view {
            SettingsProjectsView::ChooseProject { message, choices } => {
                scope_notice(&self.client, message, "", choices, &t).into_any_element()
            }
            SettingsProjectsView::Unavailable { message } => div()
                .text_size(px(text::SM))
                .line_height(px(text::SM_LINE))
                .text_color(t.muted_foreground)
                .child(message.clone())
                .into_any_element(),
            SettingsProjectsView::Empty { centered, message } => div()
                .flex()
                .flex_1()
                .when(*centered, |empty| empty.items_center().justify_center())
                .p(px(EMPTY_PADDING))
                .text_size(px(text::SM))
                .line_height(px(text::SM_LINE))
                .text_color(t.muted_foreground)
                .child(message.clone())
                .into_any_element(),
            SettingsProjectsView::Detail(detail) => {
                self.sync(detail, window, cx);
                self.detail(detail, window, cx)
            }
        }
    }
}
