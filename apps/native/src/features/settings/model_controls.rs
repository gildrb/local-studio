use std::collections::HashMap;

use gpui::component::input::InputState;
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Bounds, ClickEvent, Context, Entity, FontWeight, InteractiveElement,
    IntoElement, KeyDownEvent, ParentElement, Pixels, SharedString, StatefulInteractiveElement,
    Styled, Window, canvas, div, px, svg,
};
use serde_json::{Value, json};

use crate::app_core::client::CoreClient;
use crate::app_core::views::composer::{TraitsMenuView, TraitsOption};
use crate::app_core::views::settings_general::{
    SettingsModelPickerControlView, SettingsModelPickerPopupView,
};
use crate::features::chat::model_picker::{ModelPicker, ModelPickerActions};
use crate::features::chat::provider_instance_icon::{ProviderInstanceIcon, parse_accent};
use crate::ui::menu::{MenuPopup, MenuSeparator};
use crate::ui::popover::{Align, Side};
use crate::ui::theme;
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const CONTROL_HEIGHT: f32 = 28.;
const CONTROL_PADDING_X: f32 = 10.;
const CONTROL_RADIUS: f32 = 8.;
const CONTROL_TEXT: f32 = 14.;
const CONTROL_LINE: f32 = 20.;
const CONTROL_ICON: f32 = 16.;
const CONTROL_GAP: f32 = 6.;
const CHEVRON: f32 = 14.;
const CHEVRON_GAP: f32 = 4.;
const CONTROLS_GAP: f32 = 6.;
const MENU_SIDE_OFFSET: f32 = 4.;
const OPTION_PADDING_X: f32 = 8.;
const OPTION_PADDING_Y: f32 = 4.;
const OPTION_RADIUS: f32 = 6.;
const OPTION_TITLE_TEXT: f32 = 14.;
const OPTION_TITLE_LINE: f32 = 20.;
const OPTION_DESCRIPTION_TEXT: f32 = 12.;
const OPTION_DESCRIPTION_LINE: f32 = 16.;
const OPTION_SELECTED: f32 = 0.08;
const OPTION_DISABLED_OPACITY: f32 = 0.64;
const GROUP_LABEL_PADDING_TOP: f32 = 6.;
const GROUP_LABEL_PADDING_BOTTOM: f32 = 4.;
const GROUP_NOTE_OPACITY: f32 = 0.8;
const GROUP_NOTE_PADDING_BOTTOM: f32 = 6.;
const DESCRIPTION_MAX_WIDTH: f32 = 224.;
const BADGE_TEXT: f32 = 10.;
const BADGE_HEIGHT: f32 = 16.;
const BADGE_PADDING_X: f32 = 3.;
const BADGE_RADIUS: f32 = 4.;
const BADGE_FILL: f32 = 0.0256;
const BADGE_GAP: f32 = 4.;
const UNAVAILABLE_OPACITY: f32 = 0.64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SettingsModelActions {
    pub open: &'static str,
    pub close: &'static str,
    pub search: &'static str,
    pub traits: &'static str,
    pub picker: ModelPickerActions,
}

#[derive(Default)]
pub struct SettingsModelMenus {
    traits_open: Option<SharedString>,
    model_bounds: HashMap<SharedString, Bounds<Pixels>>,
    traits_bounds: HashMap<SharedString, Bounds<Pixels>>,
    shown_picker: Option<String>,
}

impl SettingsModelMenus {
    pub fn close_traits(&mut self, cx: &mut Context<Self>) {
        if self.traits_open.take().is_some() {
            cx.notify();
        }
    }

    pub fn sync_search(
        &mut self,
        popup: Option<&SettingsModelPickerPopupView>,
        search: &Entity<InputState>,
        window: &mut Window,
        cx: &mut App,
    ) {
        let open = popup.map(|popup| popup.picker.clone());
        if open == self.shown_picker {
            return;
        }
        self.shown_picker = open;
        if let Some(popup) = popup {
            let placeholder = popup.view.search_placeholder.clone();
            search.update(cx, |state, cx| {
                state.set_value("", window, cx);
                state.set_placeholder(placeholder, window, cx);
                state.focus(window, cx);
            });
        }
    }
}

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

fn trigger(id: SharedString, t: &Tokens) -> gpui::Stateful<gpui::Div> {
    let hover_bg = t.accent;
    let hover_fg = t.foreground;
    div()
        .id(id)
        .relative()
        .flex()
        .flex_none()
        .min_w_0()
        .items_center()
        .h(px(CONTROL_HEIGHT))
        .px(px(CONTROL_PADDING_X))
        .rounded(px(CONTROL_RADIUS))
        .border_1()
        .border_color(gpui::transparent_black())
        .text_size(px(CONTROL_TEXT))
        .line_height(px(CONTROL_LINE))
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.secondary_label)
        .whitespace_nowrap()
        .cursor_pointer()
        .hover(move |s| s.bg(hover_bg).text_color(hover_fg))
}

fn chevron(t: &Tokens) -> gpui::Svg {
    svg()
        .path("icons/chevron-down.svg")
        .flex_none()
        .size(px(CHEVRON))
        .ml(px(CHEVRON_GAP))
        .text_color(t.icon_muted)
}

fn measure(
    menus: &Entity<SettingsModelMenus>,
    key: SharedString,
    traits: bool,
) -> impl IntoElement {
    let menus = menus.clone();
    canvas(
        move |bounds, _, cx| {
            menus.update(cx, |state, _| {
                let store = if traits {
                    &mut state.traits_bounds
                } else {
                    &mut state.model_bounds
                };
                store.insert(key.clone(), bounds);
            });
        },
        |_, _, _, _| {},
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full()
}

pub fn settings_model_controls(
    picker: &str,
    control: &SettingsModelPickerControlView,
    menus: &Entity<SettingsModelMenus>,
    client: &Entity<CoreClient>,
    actions: SettingsModelActions,
    cx: &App,
) -> AnyElement {
    let t = theme::active(cx);
    let key = SharedString::from(picker.to_string());
    let model = &control.trigger;
    let accent = model.accent_color.as_deref().and_then(parse_accent);
    let open_client = client.clone();
    let open_menus = menus.clone();
    let open_key = picker.to_string();
    let model_trigger = trigger(SharedString::from(format!("settings-model-{picker}")), &t)
        .flex_shrink(1.)
        .tooltip(Tooltip::text(model.tooltip.clone()))
        .on_click(move |_: &ClickEvent, _, cx| {
            open_menus.update(cx, |state, cx| state.close_traits(cx));
            act(
                &open_client,
                cx,
                actions.open,
                json!({ "picker": open_key.clone() }),
            );
        })
        .child(measure(menus, key.clone(), false))
        .when_some(model.driver_kind.clone(), |this, driver| {
            let icon =
                ProviderInstanceIcon::new(driver, model.initials.clone(), t.muted_foreground)
                    .icon_size(CONTROL_ICON);
            this.child(if model.show_instance_badge {
                icon.badge(accent, t.card)
            } else {
                icon
            })
        })
        .child(
            div()
                .min_w_0()
                .truncate()
                .when(model.driver_kind.is_some(), |this| this.ml(px(CONTROL_GAP)))
                .when(model.unavailable, |this| this.opacity(UNAVAILABLE_OPACITY))
                .child(SharedString::from(model.label.clone())),
        )
        .child(chevron(&t));
    let traits = control.traits.as_ref().map(|traits| {
        let toggle = menus.clone();
        let toggle_key = key.clone();
        let close_client = client.clone();
        trigger(SharedString::from(format!("settings-traits-{picker}")), &t)
            .on_click(move |_: &ClickEvent, _, cx| {
                act(&close_client, cx, actions.close, json!({}));
                toggle.update(cx, |state, cx| {
                    state.traits_open = if state.traits_open.as_ref() == Some(&toggle_key) {
                        None
                    } else {
                        Some(toggle_key.clone())
                    };
                    cx.notify();
                });
            })
            .child(measure(menus, key.clone(), true))
            .when_some(traits.speed_icon.as_ref(), |this, _| {
                this.child(
                    svg()
                        .path("icons/zap.svg")
                        .flex_none()
                        .size(px(CONTROL_ICON))
                        .mr(px(CONTROL_GAP))
                        .text_color(t.muted_foreground),
                )
            })
            .child(
                div()
                    .flex_none()
                    .child(SharedString::from(traits.label.clone())),
            )
            .child(chevron(&t))
    });
    div()
        .flex()
        .flex_wrap()
        .min_w_0()
        .items_center()
        .justify_end()
        .gap(px(CONTROLS_GAP))
        .child(model_trigger)
        .children(traits)
        .into_any_element()
}

fn group_label(label: &str, t: &Tokens) -> AnyElement {
    div()
        .px(px(OPTION_PADDING_X))
        .pt(px(GROUP_LABEL_PADDING_TOP))
        .pb(px(GROUP_LABEL_PADDING_BOTTOM))
        .text_size(px(OPTION_DESCRIPTION_TEXT))
        .line_height(px(OPTION_DESCRIPTION_LINE))
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.muted_foreground)
        .child(SharedString::from(label.to_string()))
        .into_any_element()
}

fn group_note(text: &str, t: &Tokens) -> AnyElement {
    div()
        .px(px(OPTION_PADDING_X))
        .pb(px(GROUP_NOTE_PADDING_BOTTOM))
        .text_size(px(OPTION_DESCRIPTION_TEXT))
        .line_height(px(OPTION_DESCRIPTION_LINE))
        .text_color(fade(t.muted_foreground, GROUP_NOTE_OPACITY))
        .child(SharedString::from(text.to_string()))
        .into_any_element()
}

struct TraitOption<'a> {
    picker: &'a str,
    section: &'a str,
    option: &'a TraitsOption,
    selected: bool,
    disabled: bool,
}

fn trait_option(
    item: TraitOption,
    t: &Tokens,
    client: &Entity<CoreClient>,
    menus: &Entity<SettingsModelMenus>,
    action: &'static str,
) -> AnyElement {
    let selected_bg = fade(t.foreground, OPTION_SELECTED);
    let hover_bg = t.accent;
    let client = client.clone();
    let menus = menus.clone();
    let params = json!({
        "picker": item.picker,
        "descriptorId": item.section,
        "value": item.option.id,
    });
    let selected = item.selected;
    let disabled = item.disabled;
    div()
        .id(SharedString::from(format!(
            "settings-trait-{}-{}-{}",
            item.picker, item.section, item.option.id
        )))
        .flex()
        .flex_col()
        .px(px(OPTION_PADDING_X))
        .py(px(OPTION_PADDING_Y))
        .rounded(px(OPTION_RADIUS))
        .text_size(px(OPTION_TITLE_TEXT))
        .line_height(px(OPTION_TITLE_LINE))
        .text_color(t.foreground)
        .when(disabled, |this| this.opacity(OPTION_DISABLED_OPACITY))
        .when(selected, |this| this.bg(selected_bg))
        .when(!selected && !disabled, |this| {
            this.cursor_pointer()
                .hover(move |s| s.bg(hover_bg))
                .on_click(move |_: &ClickEvent, _, cx| {
                    act(&client, cx, action, params.clone());
                    menus.update(cx, |state, cx| state.close_traits(cx));
                })
        })
        .child(
            div()
                .flex()
                .items_center()
                .child(SharedString::from(item.option.label.clone()))
                .when(item.option.is_default, |this| {
                    this.child(
                        div()
                            .flex()
                            .flex_none()
                            .items_center()
                            .ml(px(BADGE_GAP))
                            .h(px(BADGE_HEIGHT))
                            .px(px(BADGE_PADDING_X))
                            .rounded(px(BADGE_RADIUS))
                            .bg(fade(t.foreground, BADGE_FILL))
                            .text_size(px(BADGE_TEXT))
                            .line_height(px(BADGE_TEXT))
                            .font_weight(FontWeight::MEDIUM)
                            .child("Default"),
                    )
                }),
        )
        .when_some(item.option.description.clone(), |this, description| {
            this.child(
                div()
                    .max_w(px(DESCRIPTION_MAX_WIDTH))
                    .text_size(px(OPTION_DESCRIPTION_TEXT))
                    .line_height(px(OPTION_DESCRIPTION_LINE))
                    .text_color(fade(t.muted_foreground, GROUP_NOTE_OPACITY))
                    .child(SharedString::from(description)),
            )
        })
        .into_any_element()
}

pub fn settings_traits_menu(
    picker: &str,
    control: &SettingsModelPickerControlView,
    menus: &Entity<SettingsModelMenus>,
    client: &Entity<CoreClient>,
    actions: SettingsModelActions,
    cx: &App,
) -> Option<AnyElement> {
    let state = menus.read(cx);
    if state.traits_open.as_deref() != Some(picker) {
        return None;
    }
    let bounds = state.traits_bounds.get(picker).copied()?;
    let traits = control.traits.as_ref()?;
    let t = theme::active(cx);
    let mut children: Vec<AnyElement> = Vec::new();
    match &traits.menu {
        TraitsMenuView::Unavailable { items } => {
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    children.push(MenuSeparator::new().into_any_element());
                }
                children.push(group_label(&item.label, &t));
                children.push(group_note(&item.value, &t));
            }
        }
        TraitsMenuView::Controls { selects, booleans } => {
            for (index, section) in selects.iter().enumerate() {
                if index > 0 {
                    children.push(MenuSeparator::new().into_any_element());
                }
                children.push(group_label(&section.label, &t));
                if let Some(notice) = section.notice.as_deref() {
                    children.push(group_note(notice, &t));
                }
                for option in &section.options {
                    children.push(trait_option(
                        TraitOption {
                            picker,
                            section: &section.id,
                            option,
                            selected: option.id == section.selected_value,
                            disabled: section.disabled,
                        },
                        &t,
                        client,
                        menus,
                        actions.traits,
                    ));
                }
            }
            for (index, section) in booleans.iter().enumerate() {
                if index > 0 || !selects.is_empty() {
                    children.push(MenuSeparator::new().into_any_element());
                }
                children.push(group_label(&section.label, &t));
                for option in &section.options {
                    children.push(trait_option(
                        TraitOption {
                            picker,
                            section: &section.id,
                            option,
                            selected: option.id == section.selected_value,
                            disabled: false,
                        },
                        &t,
                        client,
                        menus,
                        actions.traits,
                    ));
                }
            }
        }
    }
    let dismiss = menus.clone();
    Some(
        MenuPopup::new(
            SharedString::from(format!("settings-traits-menu-{picker}")),
            bounds,
        )
        .side(Side::Bottom)
        .align(Align::Start)
        .side_offset(MENU_SIDE_OFFSET)
        .on_dismiss(move |_, cx| dismiss.update(cx, |state, cx| state.close_traits(cx)))
        .children(children)
        .into_any_element(),
    )
}

pub fn settings_model_picker(
    popup: &SettingsModelPickerPopupView,
    menus: &Entity<SettingsModelMenus>,
    search: &Entity<InputState>,
    client: &Entity<CoreClient>,
    actions: SettingsModelActions,
    cx: &App,
) -> Option<AnyElement> {
    let bounds = menus
        .read(cx)
        .model_bounds
        .get(popup.picker.as_str())
        .copied()?;
    let close = client.clone();
    Some(
        div()
            .on_key_down(move |event: &KeyDownEvent, _, cx| {
                if event.keystroke.key == "escape" {
                    cx.stop_propagation();
                    act(&close, cx, actions.close, json!({}));
                }
            })
            .child(
                ModelPicker::new(&popup.view, bounds, search.clone(), client.clone())
                    .actions(actions.picker)
                    .placement(Side::Bottom, Align::Start),
            )
            .into_any_element(),
    )
}
