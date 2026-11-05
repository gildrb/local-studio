use gpui::component::input::{InputEvent, InputState};
use gpui::{
    AnyElement, App, AppContext, Context, Entity, IntoElement, ParentElement, SharedString, Styled,
    Window, div, px, svg,
};
use serde_json::{Value, json};

use crate::app_core::client::CoreClient;
use crate::app_core::views::settings_general::{
    ProjectDefaultsRowKindView, ProjectDefaultsRowView, SettingsModelPickerControlView,
    SettingsModelPickerPopupView,
};
use crate::app_core::views::settings_projects::SettingsProjectDefaultsView;
use crate::features::settings::model_controls::{
    SettingsModelActions, SettingsModelMenus, settings_model_controls, settings_model_picker,
    settings_traits_menu,
};
use crate::features::settings::primitives::{
    SettingResetButton, SettingsRow, SettingsSection, SettingsSelect, SettingsSelectOption,
    settings_switch,
};
use crate::ui::theme;
use crate::ui::theme::metrics::text;

pub const PROJECT_DEFAULTS_PICKER: &str = "default-model";

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

pub struct SectionModelPicker {
    pub menus: Entity<SettingsModelMenus>,
    search: Option<Entity<InputState>>,
    pub actions: SettingsModelActions,
}

impl SectionModelPicker {
    pub fn new<T: 'static>(actions: SettingsModelActions, cx: &mut Context<T>) -> Self {
        let menus = cx.new(|_| SettingsModelMenus::default());
        cx.observe(&menus, |_, _, cx| cx.notify()).detach();
        Self {
            menus,
            search: None,
            actions,
        }
    }

    pub fn sync<T: 'static>(
        &mut self,
        popup: Option<&SettingsModelPickerPopupView>,
        client: &Entity<CoreClient>,
        window: &mut Window,
        cx: &mut Context<T>,
    ) {
        let search = match &self.search {
            Some(search) => search.clone(),
            None => {
                let search = cx.new(|cx| InputState::new(window, cx));
                let client = client.clone();
                let action = self.actions.search;
                cx.subscribe_in(
                    &search,
                    window,
                    move |_: &mut T, search, event: &InputEvent, _, cx| {
                        if let InputEvent::Change = event {
                            let query = search.read(cx).value().to_string();
                            act(&client, cx, action, json!({ "query": query }));
                        }
                    },
                )
                .detach();
                self.search = Some(search.clone());
                search
            }
        };
        self.menus.update(cx, |menus, cx| {
            menus.sync_search(popup, &search, window, cx)
        });
    }

    pub fn controls(
        &self,
        picker: &str,
        control: &SettingsModelPickerControlView,
        client: &Entity<CoreClient>,
        cx: &App,
    ) -> AnyElement {
        settings_model_controls(picker, control, &self.menus, client, self.actions, cx)
    }

    pub fn overlays(
        &self,
        controls: &[(&str, Option<&SettingsModelPickerControlView>)],
        popup: Option<&SettingsModelPickerPopupView>,
        client: &Entity<CoreClient>,
        cx: &App,
    ) -> Vec<AnyElement> {
        controls
            .iter()
            .filter_map(|(picker, control)| {
                control.and_then(|control| {
                    settings_traits_menu(picker, control, &self.menus, client, self.actions, cx)
                })
            })
            .chain(popup.and_then(|popup| {
                let search = self.search.clone()?;
                settings_model_picker(popup, &self.menus, &search, client, self.actions, cx)
            }))
            .collect()
    }
}

pub fn project_defaults_row(
    row: &ProjectDefaultsRowView,
    model_picker: Option<&SettingsModelPickerControlView>,
    picker: &SectionModelPicker,
    client: &Entity<CoreClient>,
    change_action: &'static str,
    cx: &App,
) -> AnyElement {
    let t = theme::active(cx);
    let mut settings_row = SettingsRow::new(row.id.clone(), row.title.clone())
        .description(row.description.clone())
        .scope(&row.row_scope, client);
    if let Some(reset) = row.reset.as_ref() {
        let reset_client = client.clone();
        let key = row.key.clone();
        let mut button = SettingResetButton::new(
            SharedString::from(format!("{}-reset-{}", change_action, row.key)),
            reset.label.clone(),
        )
        .on_click(move |_, cx| {
            act(
                &reset_client,
                cx,
                change_action,
                json!({ "intent": { "kind": "reset", "key": key } }),
            );
        });
        if let Some(tooltip) = reset.tooltip.clone() {
            button = button.tooltip(tooltip);
        }
        settings_row = settings_row.reset_action(button);
    }
    let change_client = client.clone();
    let key = row.key.clone();
    let control = match &row.kind {
        ProjectDefaultsRowKindView::Model {
            status,
            available,
            empty_label,
            ..
        } => {
            if let Some(status) = status.clone() {
                settings_row = settings_row.status(SharedString::from(status));
            }
            match model_picker.filter(|_| *available) {
                Some(control) => picker.controls(PROJECT_DEFAULTS_PICKER, control, client, cx),
                None => div()
                    .text_size(px(text::SM))
                    .line_height(px(text::SM_LINE))
                    .text_color(t.muted_foreground)
                    .child(empty_label.clone())
                    .into_any_element(),
            }
        }
        ProjectDefaultsRowKindView::Select {
            aria_label,
            value,
            value_label,
            fallback_label,
            trigger_icon,
            options,
        } => {
            let mut select = SettingsSelect::new(SharedString::from(format!(
                "{}-{}",
                change_action, row.key
            )))
            .options(options.iter().map(|option| {
                let item = SettingsSelectOption::new(option.value.clone(), option.label.clone())
                    .description(option.description.clone());
                match option.icon.clone() {
                    Some(icon) => item.icon(icon),
                    None => item,
                }
            }))
            .value(value.clone())
            .value_label(if value.is_some() {
                value_label.clone()
            } else {
                fallback_label.clone()
            })
            .show_selected_icon(false)
            .accessibility_label(aria_label.clone())
            .on_change(move |value, _, cx| {
                act(
                    &change_client,
                    cx,
                    change_action,
                    json!({ "intent": { "kind": "select", "key": key, "value": value.to_string() } }),
                );
            });
            if let Some(icon) = trigger_icon.clone() {
                select = select.leading(
                    svg()
                        .path(SharedString::from(format!("icons/{icon}.svg")))
                        .flex_none()
                        .size(px(14.))
                        .text_color(t.muted_foreground),
                );
            }
            select.into_any_element()
        }
        ProjectDefaultsRowKindView::Switch {
            aria_label,
            checked,
        } => settings_switch(
            SharedString::from(format!("{}-{}", change_action, row.key)),
            *checked && !row.mixed,
        )
        .mixed(row.mixed)
        .accessibility_label(aria_label.clone())
        .on_change(move |checked, _, _, cx| {
            act(
                &change_client,
                cx,
                change_action,
                json!({ "intent": { "kind": "toggle", "key": key, "checked": checked } }),
            );
        })
        .into_any_element(),
    };
    settings_row.control(control).into_any_element()
}

pub fn project_defaults_section(
    view: &SettingsProjectDefaultsView,
    picker: &SectionModelPicker,
    client: &Entity<CoreClient>,
    change_action: &'static str,
    cx: &App,
) -> SettingsSection {
    let rows: Vec<AnyElement> = view
        .rows
        .iter()
        .map(|row| {
            project_defaults_row(
                row,
                view.model_picker.as_ref(),
                picker,
                client,
                change_action,
                cx,
            )
        })
        .collect();
    SettingsSection::new(view.section_title.clone())
        .id(view.section_id.clone())
        .children(rows)
}
