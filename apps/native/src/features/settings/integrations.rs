use std::collections::{HashMap, HashSet};

use gpui::component::input::{InputEvent, InputState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, Bounds, Context, Entity, Focusable, FontWeight,
    InteractiveElement, IntoElement, KeyDownEvent, ParentElement, Pixels, Render, SharedString,
    StatefulInteractiveElement, Styled, Window, canvas, div, px, svg,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::settings_integrations::{
    BrowserImportWizardView, BrowserProfileRemovalDialogView, BrowserProfilesView,
    BrowserSelectRowView, BrowserSwitchRowView, BrowserViewportRowView, DeviceControlsView,
    DeviceHostEditorView, DeviceHostErrorView, DeviceHostFieldView, DeviceHostRowView,
    DeviceHostsView, DeviceSetupStatusView, DeviceToolActionsView, DeviceToolVersionsView,
    IntegrationsBrowserRowView, IntegrationsSettingsView, PlatformStatusView, WizardStepView,
};
use crate::features::chat::model_picker::ModelPickerActions;
use crate::features::settings::model_controls::SettingsModelActions;
use crate::features::settings::primitives::{
    SettingResetButton, SettingsControlWidth, SettingsDraftInput, SettingsRow, SettingsSection,
    SettingsSelect, SettingsSelectOption, SettingsUnavailableGroup, settings_stack,
    settings_switch,
};
use crate::features::settings::project_defaults::{
    PROJECT_DEFAULTS_PICKER, SectionModelPicker, project_defaults_section,
};
use crate::platform::MONO_FONT;
use crate::ui::alert_dialog::{
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup,
    AlertDialogTitle,
};
use crate::ui::badge::Badge;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::dialog::{
    DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle,
};
use crate::ui::input::{Input, InputSize};
use crate::ui::menu::{MenuGroupLabel, MenuItem, MenuItemVariant, MenuPopup, MenuSeparator};
use crate::ui::popover::{Align, PopoverPopup, PopoverWidth};
use crate::ui::select::{Select, SelectItem, SelectSize};
use crate::ui::spinner::{Spinner, SpinnerSize, SpinnerTone};
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const MODEL_ACTIONS: SettingsModelActions = SettingsModelActions {
    open: "settingsIntegrationsPickerOpen",
    close: "settingsIntegrationsPickerClose",
    search: "settingsIntegrationsPickerSearch",
    traits: "settingsIntegrationsTraitsSelect",
    picker: ModelPickerActions {
        rail: "settingsIntegrationsPickerRail",
        select: "settingsIntegrationsPickerSelect",
        favorite: "settingsIntegrationsPickerFavorite",
        toggle_legacy: "settingsIntegrationsPickerToggleLegacy",
        close: "settingsIntegrationsPickerClose",
        setup: Some("settingsIntegrationsPickerSetup"),
    },
};

const VIEWPORT_SELECT_WIDTH: f32 = 176.;
const SELECT_WIDTH: f32 = 160.;
const DIMENSION_WIDTH: f32 = 80.;
const PROFILE_LIST_MARGIN: f32 = 8.;
const PROFILE_ROW_PADDING_X: f32 = 12.;
const PROFILE_ROW_PADDING_Y: f32 = 8.;
const PROFILE_RENAME_MAX: f32 = 224.;
const PROFILE_ADD_ICON: f32 = 16.;
const HOST_ADD_ICON: f32 = 14.;
const DIMMED_OPACITY: f32 = 0.64;
const BORDER_LIST: f32 = 0.6;
const BORDER_ROW: f32 = 0.5;
const BORDER_RESULT: f32 = 0.4;
const WIZARD_WIDTH: f32 = 512.;
const PRESET_DESCRIPTION_GAP: f32 = 20.;
const MENU_MIN_WIDTH: f32 = 192.;

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

fn icon(path: &str, size: f32, color: gpui::Rgba) -> gpui::Svg {
    let path = if path.contains('/') {
        SharedString::from(path.to_string())
    } else {
        SharedString::from(format!("icons/{path}.svg"))
    };
    svg()
        .path(path)
        .flex_none()
        .size(px(size))
        .text_color(color)
}

fn xs_muted(t: &Tokens, label: impl Into<SharedString>) -> gpui::Div {
    div()
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .text_color(t.muted_foreground)
        .child(label.into())
}

struct HostEditorInputs {
    label: Entity<InputState>,
    target: Entity<InputState>,
    identity_file: Entity<InputState>,
    port: Entity<InputState>,
}

pub struct IntegrationsSection {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<IntegrationsSettingsView>>>,
    picker: SectionModelPicker,
    menu: Option<String>,
    versions: Option<String>,
    bounds: HashMap<String, Bounds<Pixels>>,
    renames: HashMap<String, Entity<SettingsDraftInput>>,
    dimensions: Option<(Entity<SettingsDraftInput>, Entity<SettingsDraftInput>)>,
    editor: Option<HostEditorInputs>,
    ssh_open: bool,
    expanded: HashSet<String>,
}

impl IntegrationsSection {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<IntegrationsSettingsView>>(
            &client,
            "settingsIntegrations",
            json!({}),
            cx,
        );
        cx.observe(&view, |_, _, cx| cx.notify()).detach();
        act(&client, cx, "settingsIntegrationsMount", json!({}));
        let picker = SectionModelPicker::new(MODEL_ACTIONS, cx);
        Self {
            client,
            view,
            picker,
            menu: None,
            versions: None,
            bounds: HashMap::new(),
            renames: HashMap::new(),
            dimensions: None,
            editor: None,
            ssh_open: false,
            expanded: HashSet::new(),
        }
    }

    fn sync(
        &mut self,
        view: &IntegrationsSettingsView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.picker
            .sync(view.model_picker.as_ref(), &self.client, window, cx);
        self.sync_browser(view, window, cx);
        self.sync_editor(view.device_hosts.editor.as_deref(), window, cx);
    }

    fn sync_browser(
        &mut self,
        view: &IntegrationsSettingsView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let mut live = HashSet::new();
        let mut size = None;
        for row in &view.browser_rows {
            match row {
                IntegrationsBrowserRowView::Profiles(profiles) => {
                    for profile in &profiles.profiles {
                        if profile.rename.is_none() {
                            continue;
                        }
                        live.insert(profile.id.clone());
                        match self.renames.get(&profile.id) {
                            Some(draft) => {
                                let name = profile.name.clone();
                                draft.update(cx, |draft, cx| draft.sync(&name, window, cx));
                            }
                            None => {
                                let client = self.client.clone();
                                let id = profile.id.clone();
                                let draft = cx.new(|cx| {
                                    SettingsDraftInput::new(
                                        profile.name.clone(),
                                        "",
                                        move |name, _, cx| {
                                            act(
                                                &client,
                                                cx,
                                                "settingsIntegrationsProfileRename",
                                                json!({ "profileId": id, "name": name }),
                                            )
                                        },
                                        window,
                                        cx,
                                    )
                                });
                                self.renames.insert(profile.id.clone(), draft);
                            }
                        }
                    }
                }
                IntegrationsBrowserRowView::Viewport(viewport) => {
                    size = viewport.size.as_ref().map(|size| (size.width, size.height));
                }
                _ => {}
            }
        }
        self.renames.retain(|id, _| live.contains(id));
        match size {
            None => self.dimensions = None,
            Some((width, height)) => {
                let (width, height) = (format!("{width}"), format!("{height}"));
                match &self.dimensions {
                    Some((w, h)) => {
                        w.update(cx, |draft, cx| draft.sync(&width, window, cx));
                        h.update(cx, |draft, cx| draft.sync(&height, window, cx));
                    }
                    None => {
                        let make = |axis: &'static str,
                                    value: String,
                                    window: &mut Window,
                                    cx: &mut Context<Self>| {
                            let client = self.client.clone();
                            cx.new(|cx| {
                                SettingsDraftInput::new(
                                    value,
                                    "",
                                    move |next, _, cx| {
                                        let value = next.trim().parse::<f64>().ok();
                                        act(
                                            &client,
                                            cx,
                                            "settingsIntegrationsViewportDimension",
                                            json!({ "axis": axis, "value": value }),
                                        )
                                    },
                                    window,
                                    cx,
                                )
                            })
                        };
                        let w = make("width", width, window, cx);
                        let h = make("height", height, window, cx);
                        self.dimensions = Some((w, h));
                    }
                }
            }
        }
    }

    fn sync_editor(
        &mut self,
        editor: Option<&DeviceHostEditorView>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(editor) = editor else {
            self.editor = None;
            return;
        };
        match &self.editor {
            Some(inputs) => {
                for (state, field) in [
                    (&inputs.label, &editor.fields.label),
                    (&inputs.target, &editor.fields.target),
                    (&inputs.identity_file, &editor.fields.identity_file),
                    (&inputs.port, &editor.fields.port),
                ] {
                    let focused = state.read(cx).focus_handle(cx).is_focused(window);
                    if !focused && state.read(cx).value().as_ref() != field.value.as_str() {
                        let value = field.value.clone();
                        state.update(cx, |state, cx| state.set_value(value, window, cx));
                    }
                }
            }
            None => {
                let mut field_input = |key: &'static str, field: &DeviceHostFieldView| {
                    let state = cx.new(|cx| {
                        let mut state =
                            InputState::new(window, cx).placeholder(field.placeholder.clone());
                        state.set_value(field.value.clone(), window, cx);
                        state
                    });
                    let client = self.client.clone();
                    cx.subscribe_in(
                        &state,
                        window,
                        move |_: &mut Self, state, event: &InputEvent, _, cx| {
                            if let InputEvent::Change = event {
                                let value = state.read(cx).value().to_string();
                                act(
                                    &client,
                                    cx,
                                    "settingsIntegrationsHostEditorField",
                                    json!({ "field": key, "value": value }),
                                );
                            }
                        },
                    )
                    .detach();
                    state
                };
                let inputs = HostEditorInputs {
                    label: field_input("label", &editor.fields.label),
                    target: field_input("target", &editor.fields.target),
                    identity_file: field_input("identityFile", &editor.fields.identity_file),
                    port: field_input("port", &editor.fields.port),
                };
                inputs.label.update(cx, |state, cx| state.focus(window, cx));
                self.ssh_open = editor.ssh_options.open;
                self.editor = Some(inputs);
            }
        }
    }

    fn measure(&self, key: String, cx: &Context<Self>) -> impl IntoElement {
        let entity = cx.entity();
        canvas(
            move |bounds, _, cx| {
                entity.update(cx, |section, _| {
                    section.bounds.insert(key.clone(), bounds);
                })
            },
            |_, _, _, _| {},
        )
        .absolute()
        .size_full()
    }

    fn toggler(&self, cx: &Context<Self>) -> Entity<Self> {
        cx.entity()
    }

    fn menu_trigger(
        &self,
        key: String,
        button: Button,
        on_open: Option<&'static str>,
        cx: &Context<Self>,
    ) -> AnyElement {
        let entity = self.toggler(cx);
        let client = self.client.clone();
        let toggle_key = key.clone();
        div()
            .relative()
            .flex_none()
            .child(button.on_click(move |_, _, cx| {
                let opened = entity.update(cx, |section, cx| {
                    let open = section.menu.as_deref() != Some(toggle_key.as_str());
                    section.menu = open.then(|| toggle_key.clone());
                    cx.notify();
                    open
                });
                if let (true, Some(action)) = (opened, on_open) {
                    act(&client, cx, action, json!({}));
                }
            }))
            .child(self.measure(key, cx))
            .into_any_element()
    }

    fn menu_popup(
        &self,
        key: &str,
        items: Vec<AnyElement>,
        cx: &Context<Self>,
    ) -> Option<AnyElement> {
        if self.menu.as_deref() != Some(key) {
            return None;
        }
        let trigger = self.bounds.get(key).copied().unwrap_or_default();
        let entity = self.toggler(cx);
        let escape = entity.clone();
        Some(
            MenuPopup::new(
                SharedString::from(format!("integrations-menu-{key}")),
                trigger,
            )
            .align(Align::End)
            .min_width(MENU_MIN_WIDTH)
            .on_dismiss(move |window, cx| {
                if !trigger.contains(&window.mouse_position()) {
                    entity.update(cx, |section, cx| {
                        section.menu = None;
                        cx.notify();
                    });
                }
            })
            .child(
                div()
                    .flex()
                    .flex_col()
                    .on_key_down(move |event: &KeyDownEvent, _, cx| {
                        if event.keystroke.key == "escape" {
                            cx.stop_propagation();
                            escape.update(cx, |section, cx| {
                                section.menu = None;
                                cx.notify();
                            });
                        }
                    })
                    .children(items),
            )
            .into_any_element(),
        )
    }

    fn close_menu(&self, cx: &Context<Self>) -> impl Fn(&mut App) + Clone + 'static {
        let entity = self.toggler(cx);
        move |cx: &mut App| {
            entity.update(cx, |section, cx| {
                section.menu = None;
                cx.notify();
            })
        }
    }

    fn reset_button(
        &self,
        id: &str,
        reset: Option<&crate::app_core::views::settings_integrations::IntegrationsLabelView>,
    ) -> Option<SettingResetButton> {
        reset.map(|reset| {
            SettingResetButton::new(format!("{id}-reset"), reset.label.clone()).on_click({
                let client = self.client.clone();
                let id = id.to_string();
                move |_, cx| {
                    act(
                        &client,
                        cx,
                        "settingsIntegrationsBrowserReset",
                        json!({ "id": id }),
                    )
                }
            })
        })
    }

    fn viewport_row(
        &self,
        row: &BrowserViewportRowView,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> AnyElement {
        let client = self.client.clone();
        let id = row.id.clone();
        let mut select = Select::new(SharedString::from(format!("{}-select", row.id)))
            .size(SelectSize::Sm)
            .align(Align::End)
            .value(Some(row.value.clone()))
            .value_label(row.value_label.clone())
            .disabled(row.disabled)
            .accessibility_label(row.aria_label.clone())
            .items(
                row.options
                    .iter()
                    .map(|option| SelectItem::new(option.value.clone(), option.label.clone())),
            )
            .group_label(row.preset_group.label.clone());
        for preset in &row.preset_group.options {
            select = select.item(
                SelectItem::new(preset.value.clone(), preset.label.clone()).child(
                    div()
                        .flex()
                        .w_full()
                        .items_center()
                        .justify_between()
                        .gap(px(PRESET_DESCRIPTION_GAP))
                        .child(preset.label.clone())
                        .children(
                            preset
                                .description
                                .clone()
                                .map(|description| xs_muted(t, description)),
                        ),
                ),
            );
        }
        let select = select
            .on_change(move |value, _, cx| {
                act(
                    &client,
                    cx,
                    "settingsIntegrationsBrowserChange",
                    json!({ "id": id, "value": value.to_string() }),
                )
            })
            .w(px(VIEWPORT_SELECT_WIDTH))
            .min_w(px(VIEWPORT_SELECT_WIDTH));
        let size = row
            .size
            .as_ref()
            .zip(self.dimensions.as_ref())
            .map(|(size, (w, h))| {
                let field = |draft: &Entity<SettingsDraftInput>| -> AnyElement {
                    if row.disabled {
                        Input::new(draft.read(cx).state())
                            .size(InputSize::Sm)
                            .disabled(true)
                            .w_full()
                            .into_any_element()
                    } else {
                        draft.clone().into_any_element()
                    }
                };
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(4.))
                    .child(div().flex_none().w(px(DIMENSION_WIDTH)).child(field(w)))
                    .child(xs_muted(t, size.separator.clone()))
                    .child(div().flex_none().w(px(DIMENSION_WIDTH)).child(field(h)))
                    .child(
                        div()
                            .id(SharedString::from(format!("{}-rotate", row.id)))
                            .flex_none()
                            .tooltip(Tooltip::text(size.rotate.tooltip.clone()))
                            .child(
                                Button::new(SharedString::from(format!(
                                    "{}-rotate-button",
                                    row.id
                                )))
                                .size(ButtonSize::IconSm)
                                .variant(ButtonVariant::GhostMuted)
                                .disabled(row.disabled)
                                .accessibility_label(size.rotate.aria_label.clone())
                                .icon("device/screen-rotation")
                                .on_click(on_click(
                                    &self.client,
                                    "settingsIntegrationsViewportRotate",
                                    json!({}),
                                )),
                            ),
                    )
            });
        let mut settings_row = SettingsRow::new(row.id.clone(), row.title.clone())
            .description(row.description.clone())
            .control(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .justify_end()
                    .gap(px(8.))
                    .child(select)
                    .children(size),
            );
        if let Some(reset) = self.reset_button(&row.id, row.reset.as_ref()) {
            settings_row = settings_row.reset_action(reset);
        }
        settings_row.into_any_element()
    }

    fn select_row(&self, row: &BrowserSelectRowView) -> AnyElement {
        let client = self.client.clone();
        let id = row.id.clone();
        let select = SettingsSelect::new(SharedString::from(format!("{}-select", row.id)))
            .width(SettingsControlWidth::Fixed(SELECT_WIDTH))
            .options(
                row.options
                    .iter()
                    .map(|option| {
                        SettingsSelectOption::new(option.value.clone(), option.label.clone())
                    })
                    .collect::<Vec<_>>(),
            )
            .value(Some(row.value.clone()))
            .value_label(row.value_label.clone())
            .disabled(row.disabled)
            .accessibility_label(row.aria_label.clone())
            .on_change(move |value, _, cx| {
                act(
                    &client,
                    cx,
                    "settingsIntegrationsBrowserChange",
                    json!({ "id": id, "value": value.to_string() }),
                )
            });
        let mut settings_row = SettingsRow::new(row.id.clone(), row.title.clone())
            .description(row.description.clone())
            .control(select);
        if let Some(reset) = self.reset_button(&row.id, row.reset.as_ref()) {
            settings_row = settings_row.reset_action(reset);
        }
        settings_row.into_any_element()
    }

    fn switch_row(&self, row: &BrowserSwitchRowView) -> AnyElement {
        let client = self.client.clone();
        let id = row.id.clone();
        let switch = settings_switch(
            SharedString::from(format!("{}-switch", row.id)),
            row.checked,
        )
        .disabled(row.disabled)
        .accessibility_label(row.aria_label.clone())
        .on_change(move |checked, _, _, cx| {
            act(
                &client,
                cx,
                "settingsIntegrationsBrowserChange",
                json!({ "id": id, "checked": checked }),
            )
        });
        let mut settings_row = SettingsRow::new(row.id.clone(), row.title.clone())
            .description(row.description.clone())
            .control(switch);
        if let Some(reset) = self.reset_button(&row.id, row.reset.as_ref()) {
            settings_row = settings_row.reset_action(reset);
        }
        settings_row.into_any_element()
    }

    fn profiles_row(
        &self,
        model: &BrowserProfilesView,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> AnyElement {
        let add = self.menu_trigger(
            "profiles-add".into(),
            Button::new("browser-profiles-add")
                .size(ButtonSize::Sm)
                .variant(ButtonVariant::Outline)
                .disabled(model.add_menu.disabled)
                .icon("plus")
                .icon_size(PROFILE_ADD_ICON)
                .label(model.add_menu.label.clone()),
            Some("settingsIntegrationsProfilesMenuOpen"),
            cx,
        );
        let border = fade(t.border, BORDER_LIST);
        let rows = model.profiles.iter().enumerate().map(|(index, profile)| {
            let name: AnyElement = match (&profile.rename, self.renames.get(&profile.id)) {
                (Some(rename), Some(draft)) => {
                    let field: AnyElement = if rename.disabled {
                        Input::new(draft.read(cx).state())
                            .size(InputSize::Sm)
                            .disabled(true)
                            .w_full()
                            .into_any_element()
                    } else {
                        draft.clone().into_any_element()
                    };
                    div()
                        .w_full()
                        .max_w(px(PROFILE_RENAME_MAX))
                        .child(field)
                        .into_any_element()
                }
                _ => div()
                    .truncate()
                    .text_size(px(text::SM))
                    .line_height(px(text::SM_LINE))
                    .text_color(t.foreground)
                    .when(profile.dimmed, |this| this.opacity(DIMMED_OPACITY))
                    .child(profile.name.clone())
                    .into_any_element(),
            };
            let menu_key = format!("profile-{}", profile.id);
            let trigger = self.menu_trigger(
                menu_key,
                Button::new(SharedString::from(format!(
                    "browser-profile-menu-{}",
                    profile.id
                )))
                .size(ButtonSize::IconXs)
                .variant(ButtonVariant::GhostMuted)
                .disabled(profile.menu.disabled)
                .accessibility_label(profile.menu.aria_label.clone())
                .icon("ellipsis-vertical"),
                None,
                cx,
            );
            div()
                .flex()
                .items_center()
                .gap(px(12.))
                .px(px(PROFILE_ROW_PADDING_X))
                .py(px(PROFILE_ROW_PADDING_Y))
                .when(index > 0, |this| this.border_t_1().border_color(border))
                .child(
                    div()
                        .flex()
                        .flex_1()
                        .min_w_0()
                        .items_center()
                        .gap(px(8.))
                        .child(name)
                        .children(profile.default_badge.clone().map(|badge| {
                            div()
                                .flex()
                                .flex_none()
                                .when(profile.dimmed, |this| this.opacity(DIMMED_OPACITY))
                                .child(Badge::new().label(badge))
                        })),
                )
                .child(trigger)
        });
        SettingsRow::new(model.id.clone(), model.title.clone())
            .description(model.description.clone())
            .control(add)
            .child(
                div()
                    .mt(px(PROFILE_LIST_MARGIN))
                    .mb(px(PROFILE_LIST_MARGIN))
                    .overflow_hidden()
                    .rounded(px(radius::LG))
                    .border_1()
                    .border_color(border)
                    .children(rows),
            )
            .into_any_element()
    }

    fn profile_menus(&self, model: &BrowserProfilesView, cx: &Context<Self>) -> Vec<AnyElement> {
        let close = self.close_menu(cx);
        let add = &model.add_menu;
        let mut items: Vec<AnyElement> = Vec::new();
        items.push(
            MenuItem::new("browser-profiles-blank")
                .label(add.blank_profile.label.clone())
                .disabled(add.blank_profile.disabled)
                .on_click({
                    let client = self.client.clone();
                    let close = close.clone();
                    move |_, _, cx| {
                        close(cx);
                        act(&client, cx, "settingsIntegrationsProfileCreate", json!({}));
                    }
                })
                .into_any_element(),
        );
        if let Some(notice) = &add.limit_notice {
            items.push(
                MenuItem::new("browser-profiles-limit")
                    .label(notice.clone())
                    .disabled(true)
                    .into_any_element(),
            );
        }
        items.push(MenuSeparator::new().into_any_element());
        items.push(MenuGroupLabel::new(add.import_group_label.clone()).into_any_element());
        match &add.import_placeholder {
            Some(placeholder) => items.push(
                MenuItem::new("browser-profiles-import-placeholder")
                    .label(placeholder.clone())
                    .disabled(true)
                    .into_any_element(),
            ),
            None => {
                for source in &add.import_sources {
                    let client = self.client.clone();
                    let close = close.clone();
                    let source_id = source.id.clone();
                    items.push(
                        MenuItem::new(SharedString::from(format!(
                            "browser-profiles-import-{}",
                            source.id
                        )))
                        .label(source.label.clone())
                        .disabled(source.disabled)
                        .on_click(move |_, _, cx| {
                            close(cx);
                            act(
                                &client,
                                cx,
                                "settingsIntegrationsProfileImport",
                                json!({ "sourceId": source_id }),
                            );
                        })
                        .into_any_element(),
                    );
                }
                if let Some(notice) = &add.import_notice {
                    items.push(
                        MenuItem::new("browser-profiles-import-notice")
                            .label(notice.clone())
                            .disabled(true)
                            .into_any_element(),
                    );
                }
            }
        }
        let mut menus: Vec<AnyElement> = self
            .menu_popup("profiles-add", items, cx)
            .into_iter()
            .collect();
        for profile in &model.profiles {
            let key = format!("profile-{}", profile.id);
            if self.menu.as_deref() != Some(key.as_str()) {
                continue;
            }
            let mut items: Vec<AnyElement> = profile
                .menu
                .items
                .iter()
                .map(|item| {
                    let client = self.client.clone();
                    let close = close.clone();
                    let profile_id = profile.id.clone();
                    let action = item.action.clone();
                    MenuItem::new(SharedString::from(format!(
                        "browser-profile-{}-{}",
                        profile.id, item.action
                    )))
                    .label(item.label.clone())
                    .disabled(item.disabled)
                    .when(item.destructive, |this| {
                        this.variant(MenuItemVariant::Destructive)
                    })
                    .on_click(move |_, _, cx| {
                        close(cx);
                        act(
                            &client,
                            cx,
                            "settingsIntegrationsProfileAction",
                            json!({ "profileId": profile_id, "action": action }),
                        );
                    })
                    .into_any_element()
                })
                .collect();
            if let Some(notice) = &profile.menu.notice {
                items.push(MenuSeparator::new().into_any_element());
                items.push(
                    MenuItem::new(SharedString::from(format!(
                        "browser-profile-{}-notice",
                        profile.id
                    )))
                    .label(notice.clone())
                    .disabled(true)
                    .into_any_element(),
                );
            }
            menus.extend(self.menu_popup(&key, items, cx));
        }
        menus
    }

    fn removal_dialog(
        &self,
        dialog: &BrowserProfileRemovalDialogView,
        t: &Tokens,
    ) -> Option<AnyElement> {
        if !dialog.open {
            return None;
        }
        let dismiss = self.client.clone();
        let cancel = self.client.clone();
        let cancel_disabled = dialog.cancel.disabled;
        Some(
            AlertDialogPopup::new("browser-profile-removal")
                .on_dismiss(move |_, cx| {
                    if !cancel_disabled {
                        act(&dismiss, cx, "settingsIntegrationsRemovalCancel", json!({}))
                    }
                })
                .child(
                    AlertDialogHeader::new()
                        .child(AlertDialogTitle::new(dialog.title.clone()))
                        .child(AlertDialogDescription::new(dialog.description.clone()))
                        .children(dialog.error.clone().map(|error| {
                            div()
                                .text_size(px(text::SM))
                                .line_height(px(text::SM_LINE))
                                .text_color(t.destructive)
                                .child(error)
                        }))
                        .children(dialog.unavailable_notice.clone().map(|notice| {
                            div()
                                .text_size(px(text::SM))
                                .line_height(px(text::SM_LINE))
                                .text_color(t.muted_foreground)
                                .child(notice)
                        })),
                )
                .child(
                    AlertDialogFooter::new()
                        .child(
                            Button::new("browser-profile-removal-cancel")
                                .variant(ButtonVariant::Outline)
                                .disabled(dialog.cancel.disabled)
                                .label(dialog.cancel.label.clone())
                                .on_click(move |_, _, cx| {
                                    act(&cancel, cx, "settingsIntegrationsRemovalCancel", json!({}))
                                }),
                        )
                        .child(
                            Button::new("browser-profile-removal-confirm")
                                .variant(ButtonVariant::Destructive)
                                .disabled(dialog.confirm.disabled)
                                .label(dialog.confirm.label.clone())
                                .on_click(on_click(
                                    &self.client,
                                    "settingsIntegrationsRemovalConfirm",
                                    json!({}),
                                )),
                        ),
                )
                .into_any_element(),
        )
    }

    fn selectable_tile(
        id: SharedString,
        selected: bool,
        title: &str,
        subtitle: Option<&String>,
        t: &Tokens,
        handler: impl Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static,
    ) -> AnyElement {
        let border = if selected {
            t.primary
        } else {
            fade(t.border, BORDER_LIST)
        };
        div()
            .id(id)
            .flex()
            .w_full()
            .cursor_pointer()
            .items_center()
            .justify_between()
            .gap(px(12.))
            .rounded(px(radius::LG))
            .border_1()
            .border_color(border)
            .px(px(12.))
            .py(px(8.))
            .when(selected, |this| this.bg(fade(t.primary, 0.08)))
            .when(!selected, |this| {
                let hover_border = t.border;
                let hover_bg = fade(t.muted, 0.4);
                this.hover(move |s| s.border_color(hover_border).bg(hover_bg))
            })
            .on_click(handler)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .min_w_0()
                    .child(
                        div()
                            .truncate()
                            .text_size(px(text::SM))
                            .line_height(px(text::SM_LINE))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.foreground)
                            .child(title.to_string()),
                    )
                    .children(subtitle.map(|subtitle| xs_muted(t, subtitle.clone()).truncate())),
            )
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_center()
                    .size(px(16.))
                    .rounded_full()
                    .border_1()
                    .border_color(if selected { t.primary } else { t.input })
                    .when(selected, |this| {
                        this.bg(t.primary)
                            .child(icon("check", 10., t.primary_foreground))
                    }),
            )
            .into_any_element()
    }

    fn uppercase_label(t: &Tokens, label: &str) -> gpui::Div {
        div()
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .font_weight(FontWeight::MEDIUM)
            .text_color(t.muted_foreground)
            .child(label.to_uppercase())
    }

    fn wizard(&self, wizard: &BrowserImportWizardView, t: &Tokens) -> AnyElement {
        let client = self.client.clone();
        let header = |title: &str, description: &str, panel: bool| {
            DialogHeader::new()
                .with_panel(panel)
                .child(DialogTitle::new(title.to_string()))
                .child(DialogDescription::new(description.to_string()))
        };
        let button = |id: &'static str, label: &str, variant: ButtonVariant| {
            Button::new(id).variant(variant).label(label.to_string())
        };
        let close = || on_click(&self.client, "settingsIntegrationsWizardClose", json!({}));
        let body: Vec<AnyElement> = match &wizard.step {
            WizardStepView::Quit {
                title,
                description,
                cancel_label,
                confirm_label,
            } => vec![
                header(title, description, false).into_any_element(),
                DialogFooter::new()
                    .child(
                        button("wizard-quit-cancel", cancel_label, ButtonVariant::Outline)
                            .on_click(close()),
                    )
                    .child(
                        button("wizard-quit-confirm", confirm_label, ButtonVariant::Default)
                            .on_click(on_click(
                                &self.client,
                                "settingsIntegrationsWizardQuitRechecked",
                                json!({}),
                            )),
                    )
                    .into_any_element(),
            ],
            WizardStepView::FullDiskAccess {
                title,
                description,
                permission,
                cancel_label,
                continue_label,
            } => {
                let access = &wizard.full_disk_access;
                let status: AnyElement = if access.granted {
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .gap(px(4.))
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .text_color(t.success)
                        .child(icon("circle-check", 16., t.success))
                        .child(access.allowed_label.clone())
                        .into_any_element()
                } else {
                    Button::new("wizard-fda-allow")
                        .size(ButtonSize::Xs)
                        .variant(ButtonVariant::Outline)
                        .disabled(access.busy)
                        .label(access.allow_label.clone())
                        .on_click(on_click(
                            &self.client,
                            "settingsIntegrationsWizardAllow",
                            json!({}),
                        ))
                        .into_any_element()
                };
                vec![
                    header(title, description, true).into_any_element(),
                    DialogPanel::new("wizard-fda-panel")
                        .after_header(true)
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap(px(12.))
                                        .rounded(px(radius::LG))
                                        .border_1()
                                        .border_color(t.border)
                                        .px(px(12.))
                                        .py(px(8.))
                                        .child(icon("hard-drive", 32., t.muted_foreground))
                                        .child(
                                            div()
                                                .flex()
                                                .flex_col()
                                                .flex_1()
                                                .min_w_0()
                                                .child(
                                                    div()
                                                        .font_weight(FontWeight::MEDIUM)
                                                        .child(permission.title.clone()),
                                                )
                                                .child(xs_muted(t, permission.description.clone())),
                                        )
                                        .child(status),
                                )
                                .children(
                                    access
                                        .status
                                        .notice
                                        .clone()
                                        .map(|notice| xs_muted(t, notice).mt(px(12.))),
                                )
                                .children(
                                    access
                                        .status
                                        .hint
                                        .clone()
                                        .map(|hint| xs_muted(t, hint).mt(px(12.))),
                                ),
                        )
                        .into_any_element(),
                    DialogFooter::new()
                        .child(
                            button("wizard-fda-cancel", cancel_label, ButtonVariant::Outline)
                                .on_click(close()),
                        )
                        .child(
                            button(
                                "wizard-fda-continue",
                                continue_label,
                                ButtonVariant::Default,
                            )
                            .disabled(!access.ready || access.busy)
                            .on_click(on_click(
                                &self.client,
                                "settingsIntegrationsWizardGranted",
                                json!({}),
                            )),
                        )
                        .into_any_element(),
                ]
            }
            WizardStepView::Configure {
                title,
                description,
                from_label,
                into_label,
                source_profiles,
                targets,
                feedback,
                cancel_label,
                import_label,
                import_disabled,
            } => {
                let sources = source_profiles.iter().map(|profile| {
                    let client = client.clone();
                    let directory = profile.id.clone();
                    Self::selectable_tile(
                        SharedString::from(format!("wizard-source-{}", profile.id)),
                        profile.selected,
                        &profile.title,
                        profile.subtitle.as_ref(),
                        t,
                        move |_, _, cx| {
                            act(
                                &client,
                                cx,
                                "settingsIntegrationsWizardSourceProfile",
                                json!({ "directory": directory }),
                            )
                        },
                    )
                });
                let target_tiles = targets.iter().map(|tile| {
                    let client = client.clone();
                    let selection = json!({
                        "kind": tile.selection.kind,
                        "profileId": tile.selection.profile_id,
                    });
                    let selection = match tile.selection.profile_id {
                        Some(_) => selection,
                        None => json!({ "kind": tile.selection.kind }),
                    };
                    Self::selectable_tile(
                        SharedString::from(format!("wizard-target-{}", tile.id)),
                        tile.selected,
                        &tile.title,
                        tile.subtitle.as_ref(),
                        t,
                        move |_, _, cx| {
                            act(
                                &client,
                                cx,
                                "settingsIntegrationsWizardTarget",
                                selection.clone(),
                            )
                        },
                    )
                });
                vec![
                    header(title, description, true).into_any_element(),
                    DialogPanel::new("wizard-configure-panel")
                        .after_header(true)
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap(px(16.))
                                        .child(
                                            div()
                                                .flex()
                                                .flex_col()
                                                .flex_1()
                                                .min_w_0()
                                                .gap(px(8.))
                                                .child(Self::uppercase_label(t, from_label))
                                                .children(sources),
                                        )
                                        .child(icon("arrow-right", 16., t.muted_foreground))
                                        .child(
                                            div()
                                                .flex()
                                                .flex_col()
                                                .flex_1()
                                                .min_w_0()
                                                .gap(px(8.))
                                                .child(Self::uppercase_label(t, into_label))
                                                .children(target_tiles),
                                        ),
                                )
                                .children(feedback.clone().map(|feedback| {
                                    div()
                                        .mt(px(12.))
                                        .text_size(px(text::SM))
                                        .line_height(px(text::SM_LINE))
                                        .text_color(t.destructive)
                                        .child(feedback)
                                })),
                        )
                        .into_any_element(),
                    DialogFooter::new()
                        .child(
                            button(
                                "wizard-configure-cancel",
                                cancel_label,
                                ButtonVariant::Outline,
                            )
                            .on_click(close()),
                        )
                        .child(
                            button(
                                "wizard-configure-import",
                                import_label,
                                ButtonVariant::Default,
                            )
                            .disabled(*import_disabled)
                            .on_click(on_click(
                                &self.client,
                                "settingsIntegrationsWizardImport",
                                json!({}),
                            )),
                        )
                        .into_any_element(),
                ]
            }
            WizardStepView::Importing {
                title,
                description,
                progress_label,
            }
            | WizardStepView::Checking {
                title,
                description,
                progress_label,
            } => vec![
                header(title, description, true).into_any_element(),
                DialogPanel::new("wizard-progress-panel")
                    .after_header(true)
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(12.))
                            .py(px(8.))
                            .child(
                                Spinner::new("wizard-progress-spinner")
                                    .size(SpinnerSize::Md)
                                    .tone(SpinnerTone::Muted),
                            )
                            .child(
                                div()
                                    .text_size(px(text::SM))
                                    .line_height(px(text::SM_LINE))
                                    .text_color(t.muted_foreground)
                                    .child(progress_label.clone()),
                            ),
                    )
                    .into_any_element(),
            ],
            WizardStepView::Done {
                title,
                description,
                skipped,
                done_label,
            } => {
                let mut body =
                    vec![header(title, description, skipped.is_some()).into_any_element()];
                if let Some(skipped) = skipped {
                    body.push(
                        DialogPanel::new("wizard-done-panel")
                            .after_header(true)
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(4.))
                                    .child(Self::uppercase_label(t, &skipped.label))
                                    .child(
                                        div()
                                            .text_size(px(text::SM))
                                            .line_height(px(text::SM_LINE))
                                            .text_color(t.foreground)
                                            .child(skipped.domains.clone()),
                                    ),
                            )
                            .into_any_element(),
                    );
                }
                body.push(
                    DialogFooter::new()
                        .child(
                            button("wizard-done", done_label, ButtonVariant::Default)
                                .on_click(close()),
                        )
                        .into_any_element(),
                );
                body
            }
            WizardStepView::Blocked {
                title,
                description,
                close_label,
                retry_label,
            } => vec![
                header(title, description, false).into_any_element(),
                DialogFooter::new()
                    .child(
                        button("wizard-blocked-close", close_label, ButtonVariant::Outline)
                            .on_click(close()),
                    )
                    .children(retry_label.as_ref().map(|label| {
                        button("wizard-blocked-retry", label, ButtonVariant::Default).on_click(
                            on_click(&self.client, "settingsIntegrationsWizardImport", json!({})),
                        )
                    }))
                    .into_any_element(),
            ],
        };
        let closeable = wizard.closeable;
        let dismiss = self.client.clone();
        DialogPopup::new("browser-import-wizard")
            .max_width(WIZARD_WIDTH)
            .show_close_button(closeable)
            .on_close(move |_, cx| {
                if closeable {
                    act(&dismiss, cx, "settingsIntegrationsWizardClose", json!({}))
                }
            })
            .children(body)
            .into_any_element()
    }

    fn browser_section(
        &self,
        view: &IntegrationsSettingsView,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> AnyElement {
        let rows: Vec<AnyElement> = view
            .browser_rows
            .iter()
            .map(|row| match row {
                IntegrationsBrowserRowView::Profiles(profiles) => {
                    self.profiles_row(profiles, t, cx)
                }
                IntegrationsBrowserRowView::Viewport(viewport) => {
                    self.viewport_row(viewport, t, cx)
                }
                IntegrationsBrowserRowView::Select(select) => self.select_row(select),
                IntegrationsBrowserRowView::Switch(switch) => self.switch_row(switch),
            })
            .collect();
        let section = SettingsSection::new(view.browser.title.clone()).id(view.browser.id.clone());
        match &view.browser_unavailable_message {
            Some(message) => section
                .child(SettingsUnavailableGroup::new(Some(message.clone())).children(rows))
                .into_any_element(),
            None => section.children(rows).into_any_element(),
        }
    }

    fn versions_trigger(
        &self,
        key: String,
        versions: &DeviceToolVersionsView,
        size: f32,
        line: f32,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> AnyElement {
        let entity = self.toggler(cx);
        let toggle_key = key.clone();
        let muted = t.muted_foreground;
        div()
            .relative()
            .flex_none()
            .child(
                div()
                    .id(SharedString::from(format!("versions-trigger-{key}")))
                    .cursor_pointer()
                    .text_size(px(size))
                    .line_height(px(line))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(muted)
                    .hover(|s| s.underline())
                    .on_click(move |_, _, cx| {
                        entity.update(cx, |section, cx| {
                            let open = section.versions.as_deref() != Some(toggle_key.as_str());
                            section.versions = open.then(|| toggle_key.clone());
                            cx.notify();
                        })
                    })
                    .child(versions.trigger_label.clone()),
            )
            .child(self.measure(format!("versions-{key}"), cx))
            .into_any_element()
    }

    fn tool_actions(
        &self,
        tool: &str,
        actions: &DeviceToolActionsView,
        t: &Tokens,
    ) -> Option<AnyElement> {
        if actions.update.is_none() && actions.check.is_none() && actions.error.is_none() {
            return None;
        }
        let update = actions.update.as_ref().map(|update| {
            Button::new(SharedString::from(format!("device-{tool}-update")))
                .size(ButtonSize::Sm)
                .disabled(update.disabled)
                .label(update.label.clone())
                .on_click(on_click(
                    &self.client,
                    "settingsIntegrationsDeviceList",
                    json!({ "kind": "update", "tool": tool }),
                ))
        });
        let check = actions.check.as_ref().map(|check| {
            Button::new(SharedString::from(format!("device-{tool}-check")))
                .size(ButtonSize::Sm)
                .variant(ButtonVariant::Outline)
                .disabled(check.disabled)
                .label(check.label.clone())
                .on_click(on_click(
                    &self.client,
                    "settingsIntegrationsDeviceList",
                    json!({ "kind": "inspect" }),
                ))
        });
        Some(
            div()
                .mt(px(12.))
                .flex()
                .flex_col()
                .gap(px(8.))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap(px(8.))
                        .children(update)
                        .children(check),
                )
                .children(actions.error.clone().map(|error| {
                    div()
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .text_color(t.destructive)
                        .child(error)
                }))
                .into_any_element(),
        )
    }

    fn versions_popover(
        &self,
        key: &str,
        versions: &DeviceToolVersionsView,
        action: Option<AnyElement>,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> Option<AnyElement> {
        if self.versions.as_deref() != Some(key) {
            return None;
        }
        let trigger = self
            .bounds
            .get(&format!("versions-{key}"))
            .copied()
            .unwrap_or_default();
        let entity = self.toggler(cx);
        let escape = entity.clone();
        let divider = fade(t.border, BORDER_ROW);
        let row_count = versions.rows.as_ref().map_or(0, Vec::len);
        let body: AnyElement = match &versions.rows {
            Some(rows) => div()
                .mt(px(16.))
                .flex()
                .flex_col()
                .children(rows.iter().enumerate().map(|(index, row)| {
                    let cell = |label: &str, value: &str, t: &Tokens| {
                        div()
                            .flex()
                            .justify_between()
                            .gap(px(24.))
                            .child(
                                div()
                                    .flex_none()
                                    .text_color(t.muted_foreground)
                                    .child(label.to_string()),
                            )
                            .child(
                                div()
                                    .min_w_0()
                                    .font_family(MONO_FONT)
                                    .text_color(t.foreground)
                                    .child(value.to_string()),
                            )
                    };
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(8.))
                        .when(index > 0, |this| {
                            this.border_t_1().border_color(divider).pt(px(12.))
                        })
                        .when(index + 1 < row_count, |this| this.pb(px(12.)))
                        .children(row.name.clone().map(|name| {
                            div()
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .font_weight(FontWeight::MEDIUM)
                                .child(name)
                        }))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(4.))
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .child(cell("Running", &row.running, t))
                                .child(cell("Required", &row.required, t))
                                .child(cell("Installed", &row.installed, t)),
                        )
                }))
                .into_any_element(),
            None => xs_muted(t, versions.empty_message.clone())
                .mt(px(12.))
                .into_any_element(),
        };
        Some(
            PopoverPopup::new(
                SharedString::from(format!("versions-popover-{key}")),
                trigger,
            )
            .align(Align::End)
            .width(PopoverWidth::Md)
            .on_dismiss(move |window, cx| {
                if !trigger.contains(&window.mouse_position()) {
                    entity.update(cx, |section, cx| {
                        section.versions = None;
                        cx.notify();
                    });
                }
            })
            .child(
                div()
                    .flex()
                    .flex_col()
                    .on_key_down(move |event: &KeyDownEvent, _, cx| {
                        if event.keystroke.key == "escape" {
                            cx.stop_propagation();
                            escape.update(cx, |section, cx| {
                                section.versions = None;
                                cx.notify();
                            });
                        }
                    })
                    .child(
                        div()
                            .text_size(px(text::SM))
                            .line_height(px(text::SM))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(t.foreground)
                            .child(versions.title.clone()),
                    )
                    .child(body)
                    .child(
                        xs_muted(t, versions.footer.clone())
                            .mt(px(16.))
                            .pt(px(12.))
                            .border_t_1()
                            .border_color(divider),
                    )
                    .children(versions.error.clone().map(|error| {
                        div()
                            .mt(px(8.))
                            .text_size(px(text::XS))
                            .line_height(px(text::XS_LINE))
                            .text_color(t.destructive)
                            .child(error)
                    }))
                    .children(action),
            )
            .into_any_element(),
        )
    }

    fn setup_status(id: &str, status: &DeviceSetupStatusView, t: &Tokens) -> AnyElement {
        let mark: AnyElement = if status.pending {
            Spinner::new(SharedString::from(format!("{id}-spinner")))
                .size(SpinnerSize::Xs)
                .into_any_element()
        } else {
            icon("check", 12., t.success).into_any_element()
        };
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(8.))
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .text_color(t.muted_foreground)
            .child(mark)
            .child(status.label.clone())
            .into_any_element()
    }

    fn platform_status(status: &PlatformStatusView, t: &Tokens) -> AnyElement {
        let mark = if status.ready {
            icon("check", 16., t.success)
        } else {
            icon("circle-alert", 16., t.muted_foreground)
        };
        let platform = div()
            .font_weight(FontWeight::MEDIUM)
            .child(status.platform.clone());
        let message = xs_muted(t, status.message.clone());
        div()
            .flex()
            .gap(px(8.))
            .child(div().mt(px(2.)).child(mark))
            .child(
                div()
                    .when(status.ready, |this| this.flex().items_center().gap(px(8.)))
                    .child(platform)
                    .child(message),
            )
            .into_any_element()
    }

    fn device_switch_row(
        &self,
        tool: &'static str,
        controls: &DeviceControlsView,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> AnyElement {
        let (model, description, scope, versions, status) = if tool == "hub" {
            (
                &controls.hub,
                &controls.hub_description,
                &controls.hub_row_scope,
                &controls.hub_versions,
                controls.hub_status.as_ref(),
            )
        } else {
            (
                &controls.agent,
                &controls.agent_description,
                &controls.agent_row_scope,
                &controls.agent_versions,
                controls.agent_status.as_ref(),
            )
        };
        let client = self.client.clone();
        let switch = settings_switch(
            SharedString::from(format!("device-{tool}-switch")),
            model.checked && !scope.mixed,
        )
        .mixed(scope.mixed)
        .disabled(model.disabled)
        .accessibility_label(model.aria_label.clone())
        .on_change(move |checked, _, _, cx| {
            act(
                &client,
                cx,
                "settingsIntegrationsDeviceToggle",
                json!({ "tool": tool, "checked": checked }),
            )
        });
        SettingsRow::new(model.id.clone(), model.title.clone())
            .description(description.to_string())
            .scope(scope, &self.client)
            .control(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(self.versions_trigger(
                        tool.to_string(),
                        versions,
                        text::BASE,
                        text::BASE_LINE,
                        t,
                        cx,
                    ))
                    .children(status.map(|status| {
                        Self::setup_status(&format!("device-{tool}-status"), status, t)
                    }))
                    .child(switch),
            )
            .into_any_element()
    }

    fn device_rows(
        &self,
        controls: &DeviceControlsView,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> Vec<AnyElement> {
        let mut rows = vec![self.device_switch_row("hub", controls, t, cx)];
        let platforms = &controls.platforms;
        if platforms.visible {
            let mut row = SettingsRow::new(platforms.id.clone(), platforms.title.clone())
                .status(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap_x(px(20.))
                        .gap_y(px(8.))
                        .children(
                            controls
                                .platform_statuses
                                .iter()
                                .map(|status| Self::platform_status(status, t)),
                        ),
                )
                .control(
                    Button::new("device-platforms-refresh")
                        .size(ButtonSize::Sm)
                        .variant(ButtonVariant::Outline)
                        .disabled(platforms.refresh.disabled)
                        .label(platforms.refresh.label.clone())
                        .on_click(on_click(
                            &self.client,
                            "settingsIntegrationsDeviceList",
                            json!({ "kind": "refresh" }),
                        )),
                );
            if let Some(description) = &platforms.description {
                row = row.description(description.clone());
            }
            rows.push(row.into_any_element());
        }
        rows.push(self.device_switch_row("agent", controls, t, cx));
        if !controls.host_updates.is_empty() {
            rows.push(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .children(controls.host_updates.iter().map(|update| {
                        div()
                            .flex()
                            .items_start()
                            .gap(px(12.))
                            .rounded(px(radius::MD))
                            .border_1()
                            .border_color(fade(t.border, BORDER_LIST))
                            .px(px(12.))
                            .py(px(8.))
                            .text_size(px(text::XS))
                            .line_height(px(text::XS_LINE))
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .flex_1()
                                    .min_w_0()
                                    .child(
                                        div()
                                            .font_weight(FontWeight::MEDIUM)
                                            .child(update.label.clone()),
                                    )
                                    .child(
                                        div()
                                            .text_color(t.muted_foreground)
                                            .child(update.detail.clone()),
                                    )
                                    .children(update.hint.clone().map(|hint| {
                                        div().mt(px(4.)).text_color(t.muted_foreground).child(hint)
                                    })),
                            )
                            .children(update.retry.as_ref().map(|retry| {
                                Button::new(SharedString::from(format!(
                                    "device-update-retry-{}",
                                    update.host_id
                                )))
                                .size(ButtonSize::Compact)
                                .variant(ButtonVariant::Outline)
                                .disabled(retry.disabled)
                                .label(retry.label.clone())
                                .on_click(on_click(
                                    &self.client,
                                    "settingsIntegrationsDeviceUpdateRetry",
                                    json!({ "hostId": update.host_id }),
                                ))
                            }))
                    }))
                    .into_any_element(),
            );
        }
        rows
    }

    fn error_details(
        &self,
        key: String,
        error: &DeviceHostErrorView,
        color: gpui::Rgba,
        cx: &Context<Self>,
    ) -> AnyElement {
        let open = self.expanded.contains(&key);
        let entity = self.toggler(cx);
        let toggle = key.clone();
        div()
            .flex()
            .flex_col()
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .text_color(color)
            .child(
                div()
                    .id(SharedString::from(format!("details-{key}")))
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .cursor_pointer()
                    .on_click(move |_, _, cx| {
                        entity.update(cx, |section, cx| {
                            if !section.expanded.remove(&toggle) {
                                section.expanded.insert(toggle.clone());
                            }
                            cx.notify();
                        })
                    })
                    .child(icon(
                        if open {
                            "chevron-down"
                        } else {
                            "chevron-right"
                        },
                        12.,
                        color,
                    ))
                    .child(error.summary.clone()),
            )
            .when(open, |this| {
                this.child(div().mt(px(4.)).child(error.detail.clone()))
            })
            .into_any_element()
    }

    fn host_row(
        &self,
        environment_id: &str,
        host: &DeviceHostRowView,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> AnyElement {
        let key = format!("{environment_id}-{}", host.id);
        let params = json!({ "environmentId": environment_id, "hostId": host.id });
        let badges = host.platform_badges.iter().map(|badge| {
            div()
                .id(SharedString::from(format!(
                    "host-badge-{key}-{}",
                    badge.platform
                )))
                .flex_none()
                .tooltip(Tooltip::text(badge.label.clone()))
                .child(icon(
                    if badge.icon == "apple" {
                        "device/apple"
                    } else {
                        "device/android"
                    },
                    14.,
                    t.muted_foreground,
                ))
        });
        let action_kind = if host.action.kind == "retry" {
            "settingsIntegrationsHostRetry"
        } else {
            "settingsIntegrationsHostTest"
        };
        div()
            .flex()
            .items_center()
            .gap(px(8.))
            .border_t_1()
            .border_color(fade(t.border, BORDER_ROW))
            .py(px(10.))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .child(
                        div()
                            .flex()
                            .min_w_0()
                            .items_center()
                            .gap(px(8.))
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(text::SM))
                                    .line_height(px(text::SM_LINE))
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(host.label.clone()),
                            )
                            .children(badges),
                    )
                    .child(xs_muted(t, host.target.clone()).truncate())
                    .child(div().flex().child(self.versions_trigger(
                        format!("host-{key}"),
                        &host.versions,
                        text::BASE,
                        text::BASE_LINE,
                        t,
                        cx,
                    )))
                    .children(
                        host.local_notice
                            .clone()
                            .map(|notice| xs_muted(t, notice).mt(px(4.))),
                    )
                    .children(host.error.as_ref().map(|error| {
                        div().mt(px(4.)).child(self.error_details(
                            format!("host-{key}"),
                            error,
                            t.destructive,
                            cx,
                        ))
                    })),
            )
            .children(host.progress.clone().map(|progress| {
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(6.))
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.muted_foreground)
                    .child(
                        Spinner::new(SharedString::from(format!("host-progress-{key}")))
                            .size(SpinnerSize::Xs),
                    )
                    .child(progress)
            }))
            .child(
                self.menu_trigger(
                    format!("host-{key}"),
                    Button::new(SharedString::from(format!("host-menu-{key}")))
                        .size(ButtonSize::IconSm)
                        .variant(ButtonVariant::GhostMuted)
                        .disabled(host.menu.disabled)
                        .accessibility_label(host.menu.aria_label.clone())
                        .icon("ellipsis-vertical"),
                    None,
                    cx,
                ),
            )
            .child(
                Button::new(SharedString::from(format!("host-action-{key}")))
                    .size(ButtonSize::Sm)
                    .variant(ButtonVariant::Outline)
                    .disabled(host.action.disabled)
                    .label(host.action.label.clone())
                    .on_click(on_click(&self.client, action_kind, params)),
            )
            .into_any_element()
    }

    fn hosts_row(&self, hosts: &DeviceHostsView, t: &Tokens, cx: &Context<Self>) -> AnyElement {
        let body: AnyElement = match &hosts.unavailable_message {
            Some(message) => div()
                .text_size(px(text::SM))
                .line_height(px(text::SM_LINE))
                .text_color(t.muted_foreground)
                .child(message.clone())
                .into_any_element(),
            None => div()
                .flex()
                .flex_col()
                .children(hosts.groups_view.iter().map(|group| {
                    div()
                        .flex()
                        .flex_col()
                        .children(group.heading.clone().map(|heading| {
                            xs_muted(t, heading)
                                .font_weight(FontWeight::MEDIUM)
                                .pt(px(12.))
                                .pb(px(4.))
                        }))
                        .children(group.empty_message.clone().map(|message| {
                            div()
                                .py(px(8.))
                                .text_size(px(text::SM))
                                .line_height(px(text::SM_LINE))
                                .text_color(t.muted_foreground)
                                .child(message)
                        }))
                        .children(
                            group
                                .hosts
                                .iter()
                                .map(|host| self.host_row(&group.environment_id, host, t, cx)),
                        )
                }))
                .into_any_element(),
        };
        SettingsRow::new(hosts.id.clone(), hosts.title.clone())
            .description(hosts.description.clone())
            .scope(&hosts.row_scope, &self.client)
            .control(
                Button::new("device-hosts-add")
                    .size(ButtonSize::Sm)
                    .variant(ButtonVariant::Outline)
                    .disabled(hosts.add_button.disabled)
                    .icon("plus")
                    .icon_size(HOST_ADD_ICON)
                    .label(hosts.add_button.label.clone())
                    .on_click(on_click(
                        &self.client,
                        "settingsIntegrationsHostAdd",
                        json!({}),
                    )),
            )
            .child(div().pt(px(12.)).pb(px(8.)).child(body))
            .into_any_element()
    }

    fn host_menus(&self, hosts: &DeviceHostsView, cx: &Context<Self>) -> Vec<AnyElement> {
        let close = self.close_menu(cx);
        let mut menus = Vec::new();
        for group in &hosts.groups_view {
            for host in &group.hosts {
                let key = format!("host-{}-{}", group.environment_id, host.id);
                if self.menu.as_deref() != Some(key.as_str()) {
                    continue;
                }
                let items = host
                    .menu
                    .items
                    .iter()
                    .map(|item| {
                        let client = self.client.clone();
                        let close = close.clone();
                        let action = if item.action == "edit" {
                            "settingsIntegrationsHostEdit"
                        } else {
                            "settingsIntegrationsHostRemove"
                        };
                        let params =
                            json!({ "environmentId": group.environment_id, "hostId": host.id });
                        MenuItem::new(SharedString::from(format!("{key}-{}", item.action)))
                            .label(item.label.clone())
                            .when(item.destructive, |this| {
                                this.variant(MenuItemVariant::Destructive)
                            })
                            .on_click(move |_, _, cx| {
                                close(cx);
                                act(&client, cx, action, params.clone());
                            })
                            .into_any_element()
                    })
                    .collect();
                menus.extend(self.menu_popup(&key, items, cx));
            }
        }
        menus
    }

    fn host_editor(
        &self,
        editor: &DeviceHostEditorView,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> Option<AnyElement> {
        let inputs = self.editor.as_ref()?;
        let field = |state: &Entity<InputState>, model: &DeviceHostFieldView| {
            div()
                .flex()
                .flex_col()
                .gap(px(6.))
                .text_size(px(text::SM))
                .line_height(px(text::SM_LINE))
                .child(model.label.clone())
                .child(Input::new(state).disabled(model.disabled).w_full())
        };
        let entity = self.toggler(cx);
        let ssh_open = self.ssh_open;
        let ssh = div()
            .flex()
            .flex_col()
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .child(
                div()
                    .id("host-editor-ssh-summary")
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .cursor_pointer()
                    .text_color(t.muted_foreground)
                    .on_click(move |_, _, cx| {
                        entity.update(cx, |section, cx| {
                            section.ssh_open = !section.ssh_open;
                            cx.notify();
                        })
                    })
                    .child(icon(
                        if ssh_open {
                            "chevron-down"
                        } else {
                            "chevron-right"
                        },
                        12.,
                        t.muted_foreground,
                    ))
                    .child(editor.ssh_options.summary.clone()),
            )
            .when(ssh_open, |this| {
                this.child(
                    div()
                        .mt(px(12.))
                        .flex()
                        .gap(px(12.))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .child(field(&inputs.identity_file, &editor.fields.identity_file)),
                        )
                        .child(
                            div()
                                .flex_none()
                                .w(px(112.))
                                .child(field(&inputs.port, &editor.fields.port)),
                        ),
                )
                .child(xs_muted(t, editor.ssh_options.hint.clone()).mt(px(8.)))
            });
        let connection = &editor.connection;
        let border = fade(t.border, BORDER_LIST);
        let results = connection.results.as_ref().map(|results| {
            div()
                .flex()
                .flex_col()
                .border_t_1()
                .border_color(border)
                .children(results.iter().enumerate().map(|(index, result)| {
                    let failed = result.status == "failed";
                    let color = if failed {
                        t.destructive
                    } else {
                        t.muted_foreground
                    };
                    let mark: AnyElement = match result.icon.as_str() {
                        "spinner" => Spinner::new(SharedString::from(format!(
                            "host-result-spinner-{}",
                            result.environment_id
                        )))
                        .size(SpinnerSize::Xs)
                        .into_any_element(),
                        "monitor" => icon("monitor", 12., color).into_any_element(),
                        "x" => icon("x", 12., color).into_any_element(),
                        _ => icon("check", 12., color).into_any_element(),
                    };
                    div()
                        .flex()
                        .flex_col()
                        .px(px(12.))
                        .py(px(10.))
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .when(index > 0, |this| {
                            this.border_t_1()
                                .border_color(fade(t.border, BORDER_RESULT))
                        })
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .gap(px(12.))
                                .child(
                                    div()
                                        .truncate()
                                        .font_weight(FontWeight::MEDIUM)
                                        .child(result.label.clone()),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .flex_none()
                                        .items_center()
                                        .gap(px(6.))
                                        .text_color(color)
                                        .child(mark)
                                        .child(result.status_label.clone()),
                                ),
                        )
                        .children(result.platforms.as_ref().map(|platforms| {
                            div()
                                .mt(px(6.))
                                .flex()
                                .flex_wrap()
                                .gap_x(px(16.))
                                .gap_y(px(4.))
                                .text_color(t.muted_foreground)
                                .children(platforms.iter().map(|item| {
                                    div()
                                        .id(SharedString::from(format!(
                                            "host-availability-{}-{}",
                                            result.environment_id, item.platform
                                        )))
                                        .flex()
                                        .items_center()
                                        .gap(px(4.))
                                        .tooltip(Tooltip::text(item.tooltip.clone()))
                                        .child(icon(
                                            if item.available { "check" } else { "minus" },
                                            12.,
                                            t.muted_foreground,
                                        ))
                                        .child(item.label.clone())
                                }))
                        }))
                        .children(result.error.as_ref().map(|error| {
                            div().mt(px(6.)).child(self.error_details(
                                format!("result-{}", result.environment_id),
                                error,
                                t.muted_foreground,
                                cx,
                            ))
                        }))
                }))
        });
        let test = Button::new("host-editor-test")
            .size(ButtonSize::Sm)
            .variant(ButtonVariant::Outline)
            .disabled(connection.test_button.disabled)
            .when(connection.checking, |this| {
                this.child(Spinner::new("host-editor-test-spinner").size(SpinnerSize::Xs))
            })
            .label(connection.test_button.label.clone())
            .on_click(on_click(
                &self.client,
                "settingsIntegrationsHostEditorTest",
                json!({}),
            ));
        let save = Button::new("host-editor-save")
            .disabled(editor.save.disabled)
            .when(editor.save.busy, |this| {
                this.child(Spinner::new("host-editor-save-spinner").size(SpinnerSize::Xs))
            })
            .label(editor.save.label.clone())
            .on_click(on_click(
                &self.client,
                "settingsIntegrationsHostEditorSave",
                json!({}),
            ));
        let closeable = editor.closeable;
        let dismiss = self.client.clone();
        let submit = self.client.clone();
        Some(
            DialogPopup::new("device-host-editor")
                .max_width(WIZARD_WIDTH)
                .show_close_button(closeable)
                .on_close(move |_, cx| {
                    if closeable {
                        act(
                            &dismiss,
                            cx,
                            "settingsIntegrationsHostEditorClose",
                            json!({}),
                        )
                    }
                })
                .child(
                    DialogHeader::new()
                        .with_panel(true)
                        .child(DialogTitle::new(editor.title.clone()))
                        .child(DialogDescription::new(editor.description.clone())),
                )
                .child(
                    DialogPanel::new("device-host-editor-panel")
                        .after_header(true)
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(16.))
                                .on_key_down(move |event: &KeyDownEvent, _, cx| {
                                    if event.keystroke.key == "enter" {
                                        act(
                                            &submit,
                                            cx,
                                            "settingsIntegrationsHostEditorSave",
                                            json!({}),
                                        );
                                    }
                                })
                                .child(field(&inputs.label, &editor.fields.label))
                                .child(field(&inputs.target, &editor.fields.target)),
                        )
                        .child(ssh)
                        .child(
                            div()
                                .rounded(px(radius::LG))
                                .border_1()
                                .border_color(border)
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .justify_between()
                                        .gap(px(12.))
                                        .px(px(12.))
                                        .py(px(10.))
                                        .child(xs_muted(t, connection.status.clone()))
                                        .child(test),
                                )
                                .children(results),
                        ),
                )
                .child(
                    DialogFooter::new()
                        .child(
                            Button::new("host-editor-cancel")
                                .variant(ButtonVariant::Ghost)
                                .disabled(editor.cancel.disabled)
                                .label(editor.cancel.label.clone())
                                .on_click(on_click(
                                    &self.client,
                                    "settingsIntegrationsHostEditorClose",
                                    json!({}),
                                )),
                        )
                        .child(save),
                )
                .into_any_element(),
        )
    }
}

impl Render for IntegrationsSection {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return div().into_any_element();
        };
        self.sync(&view, window, cx);
        let t = theme::active(cx);
        let mut overlays = self.picker.overlays(
            &[(PROJECT_DEFAULTS_PICKER, view.defaults.model_picker.as_ref())],
            view.model_picker.as_ref(),
            &self.client,
            cx,
        );
        for row in &view.browser_rows {
            if let IntegrationsBrowserRowView::Profiles(profiles) = row {
                overlays.extend(self.profile_menus(profiles, cx));
                overlays.extend(self.removal_dialog(&profiles.removal_dialog, &t));
            }
        }
        let controls = &view.device_controls;
        overlays.extend(self.versions_popover(
            "hub",
            &controls.hub_versions,
            self.tool_actions("hub", &controls.hub.tool_actions, &t),
            &t,
            cx,
        ));
        overlays.extend(self.versions_popover(
            "agent",
            &controls.agent_versions,
            self.tool_actions("agent", &controls.agent.tool_actions, &t),
            &t,
            cx,
        ));
        for group in &view.device_hosts.groups_view {
            for host in &group.hosts {
                overlays.extend(self.versions_popover(
                    &format!("host-{}-{}", group.environment_id, host.id),
                    &host.versions,
                    None,
                    &t,
                    cx,
                ));
            }
        }
        overlays.extend(self.host_menus(&view.device_hosts, cx));
        if let Some(editor) = view.device_hosts.editor.as_deref() {
            overlays.extend(self.host_editor(editor, &t, cx));
        }
        if let Some(wizard) = view.wizard.as_deref() {
            overlays.push(self.wizard(wizard, &t));
        }
        let mut devices =
            SettingsSection::new(view.devices.title.clone()).id(view.devices.id.clone());
        devices = devices
            .children(self.device_rows(controls, &t, cx))
            .child(self.hosts_row(&view.device_hosts, &t, cx));
        settings_stack()
            .child(project_defaults_section(
                &view.defaults,
                &self.picker,
                &self.client,
                "settingsIntegrationsDefaults",
                cx,
            ))
            .child(self.browser_section(&view, &t, cx))
            .child(devices)
            .children(overlays)
            .into_any_element()
    }
}
