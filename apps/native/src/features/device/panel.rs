use std::collections::HashMap;

use gpui::component::input::{InputEvent, InputState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, Bounds, ClickEvent, Context, Entity, Focusable, FontWeight,
    InteractiveElement, IntoElement, ParentElement, Pixels, Render, SharedString,
    StatefulInteractiveElement, Styled, Window, canvas, div, px, svg,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::device::{
    ChoiceOption, DevicePanelBody, DevicePanelView, DeviceRailView, DeviceToolsView,
    DeviceWorkspaceBody,
};
use crate::features::chat::toolbar_parts::act;
use crate::features::device::parts::{LoadingStage, host_updates, loading_view, xs_muted};
use crate::features::device::stream::DeviceScreen;
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::input::{Input, InputFont, InputSize};
use crate::ui::menu::{MenuItem, MenuItemVariant, MenuPopup, MenuRadioItem, MenuSeparator, icon};
use crate::ui::popover::{Align, Side};
use crate::ui::select::{Select, SelectItem, SelectSize};
use crate::ui::spinner::{Spinner, SpinnerSize};
use crate::ui::switch::{Switch, SwitchSize};
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::toggle::Toggle;
use crate::ui::toggle_group::ToggleGroup;
use crate::ui::tooltip::Tooltip;

const RAIL_WIDTH: f32 = 56.;
const RAIL_DIVIDER_WIDTH: f32 = 20.;
const TOOLS_WIDTH: f32 = 288.;
const TOOLS_STATIC_MIN: f32 = 700.;
const TOOLS_HEADER: f32 = 36.;
const LIST_MAX_WIDTH: f32 = 576.;
const LIST_ICON_BOX: f32 = 32.;
const SELECT_WIDE: f32 = 160.;
const SELECT_PRESET: f32 = 128.;
const EVENT_LOG_MAX: f32 = 256.;
const TEXT_2XS: f32 = 10.;
const FOLD_GLYPH: f32 = 28.;
const MENU_OFFSET: f32 = 4.;
const MENU_TEXT_MIN: f32 = 160.;

type ClickHandler = Box<dyn Fn(&ClickEvent, &mut Window, &mut App)>;
type ValueHandler = Box<dyn Fn(String, &mut App)>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum RailMenu {
    Rotate,
    TextSize,
    More,
}

const FIELDS: [(&str, bool); 6] = [
    ("openUrl", true),
    ("launchApp", true),
    ("latitude", false),
    ("longitude", false),
    ("permissionApp", false),
    ("push", true),
];

struct FieldInput {
    state: Entity<InputState>,
    shown: String,
}

pub struct DevicePanelSurface {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<DevicePanelView>>>,
    screen: Option<(String, Entity<DeviceScreen>)>,
    inputs: HashMap<&'static str, FieldInput>,
    menu: Option<RailMenu>,
    menu_bounds: HashMap<RailMenu, Bounds<Pixels>>,
    width: f32,
}

fn send(
    client: &Entity<CoreClient>,
    action: &'static str,
    params: Value,
) -> impl Fn(&ClickEvent, &mut Window, &mut App) + 'static {
    let client = client.clone();
    move |_, _, cx| act(&client, cx, action, params.clone())
}

fn device_act(client: &Entity<CoreClient>, cx: &mut App, body: Value) {
    act(client, cx, "deviceAct", json!({ "body": body }));
}

impl DevicePanelSurface {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view =
            CoreClient::subscribe::<Option<DevicePanelView>>(&client, "devicePanel", json!({}), cx);
        cx.observe(&view, |this, _, cx| {
            this.sync_screen(cx);
            cx.notify();
        })
        .detach();
        Self {
            client,
            view,
            screen: None,
            inputs: HashMap::new(),
            menu: None,
            menu_bounds: HashMap::new(),
            width: 0.,
        }
    }

    fn sync_screen(&mut self, cx: &mut Context<Self>) {
        let workspace = match self.view.read(cx).data.clone().flatten().map(|v| v.body) {
            Some(DevicePanelBody::Workspace(body)) => body,
            _ => {
                self.screen = None;
                self.menu = None;
                return;
            }
        };
        let reuse = self
            .screen
            .as_ref()
            .filter(|(key, _)| *key == workspace.key)
            .map(|(_, screen)| screen.clone());
        let screen = match reuse {
            Some(screen) => screen,
            None => {
                let client = self.client.clone();
                let screen = cx.new(|cx| DeviceScreen::new(client, cx));
                self.screen = Some((workspace.key.clone(), screen.clone()));
                self.menu = None;
                screen
            }
        };
        let stream = workspace.stream.clone();
        screen.update(cx, |screen, cx| screen.set_view(stream, cx));
    }

    fn field(
        &mut self,
        field: &'static str,
        value: &str,
        placeholder: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<InputState> {
        if let Some(entry) = self.inputs.get_mut(field) {
            let state = entry.state.clone();
            let focused = state.read(cx).focus_handle(cx).is_focused(window);
            if entry.shown != value && (!focused || value.is_empty()) {
                entry.shown = value.to_string();
                let next = value.to_string();
                state.update(cx, |state, cx| state.set_value(next, window, cx));
            }
            let placeholder = placeholder.to_string();
            state.update(cx, |state, cx| {
                state.set_placeholder(placeholder, window, cx)
            });
            return state;
        }
        let initial = value.to_string();
        let hint = placeholder.to_string();
        let state = cx.new(|cx| {
            let mut state = InputState::new(window, cx).placeholder(hint);
            state.set_value(initial, window, cx);
            state
        });
        let submits = FIELDS
            .iter()
            .any(|(name, submit)| *name == field && *submit);
        let client = self.client.clone();
        cx.subscribe_in(
            &state,
            window,
            move |this: &mut Self, state: &Entity<InputState>, event: &InputEvent, _, cx| {
                match event {
                    InputEvent::Change => {
                        let value = state.read(cx).value().to_string();
                        if let Some(entry) = this.inputs.get_mut(field) {
                            if entry.shown == value {
                                return;
                            }
                            entry.shown = value.clone();
                        }
                        act(
                            &client,
                            cx,
                            "deviceToolsField",
                            json!({ "field": field, "value": value }),
                        );
                    }
                    InputEvent::PressEnter { .. } if submits => {
                        act(&client, cx, "deviceToolsSubmit", json!({ "field": field }));
                    }
                    _ => {}
                }
            },
        )
        .detach();
        self.inputs.insert(
            field,
            FieldInput {
                state: state.clone(),
                shown: value.to_string(),
            },
        );
        state
    }

    fn menu_trigger(
        &self,
        menu: RailMenu,
        id: &'static str,
        icon_name: &'static str,
        label: &'static str,
        disabled: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let entity = cx.entity().downgrade();
        let toggle = cx.entity().downgrade();
        div()
            .id(SharedString::from(format!("{id}-wrap")))
            .relative()
            .flex_none()
            .tooltip(Tooltip::text(label))
            .child(
                Button::new(id)
                    .size(ButtonSize::IconSm)
                    .variant(ButtonVariant::Ghost)
                    .icon(icon_name)
                    .accessibility_label(label)
                    .disabled(disabled)
                    .pressed(self.menu == Some(menu))
                    .on_click(move |_, _, cx| {
                        if let Some(this) = toggle.upgrade() {
                            this.update(cx, |this, cx| {
                                this.menu = if this.menu == Some(menu) {
                                    None
                                } else {
                                    Some(menu)
                                };
                                cx.notify();
                            });
                        }
                    }),
            )
            .child(
                canvas(
                    move |bounds, _, cx| {
                        if let Some(this) = entity.upgrade() {
                            this.update(cx, |this, _| {
                                this.menu_bounds.insert(menu, bounds);
                            });
                        }
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            )
            .into_any_element()
    }

    fn menu_popup(&self, rail: &DeviceRailView, cx: &mut Context<Self>) -> Option<AnyElement> {
        let menu = self.menu?;
        let trigger = *self.menu_bounds.get(&menu)?;
        let close_entity = cx.entity().downgrade();
        let close = move |cx: &mut App| {
            if let Some(this) = close_entity.upgrade() {
                this.update(cx, |this, cx| {
                    this.menu = None;
                    cx.notify();
                });
            }
        };
        let close = std::rc::Rc::new(close);
        let item = |id: &'static str, label: &'static str, body: Value| {
            let client = self.client.clone();
            let close = close.clone();
            MenuItem::new(id).label(label).on_click(move |_, _, cx| {
                device_act(&client, cx, body.clone());
                close(cx);
            })
        };
        let action =
            |id: &'static str, label: &'static str, icon_name: &'static str, name: &'static str| {
                let client = self.client.clone();
                let close = close.clone();
                MenuItem::new(id)
                    .icon(icon_name)
                    .label(label)
                    .on_click(move |_, _, cx| {
                        act(&client, cx, name, json!({}));
                        close(cx);
                    })
            };
        let children: Vec<AnyElement> = match menu {
            RailMenu::Rotate => vec![
                item(
                    "device-rotate-portrait",
                    "Portrait",
                    json!({ "type": "setOrientation", "value": "portrait" }),
                )
                .into_any_element(),
                item(
                    "device-rotate-landscape",
                    "Landscape",
                    json!({ "type": "setOrientation", "value": "landscape_left" }),
                )
                .into_any_element(),
            ],
            RailMenu::TextSize => rail
                .text_size
                .options
                .iter()
                .map(|option| {
                    let client = self.client.clone();
                    let close = close.clone();
                    let value = option.value.clone();
                    let selected = option.selected;
                    MenuRadioItem::new(SharedString::from(format!(
                        "device-text-size-{}",
                        option.value
                    )))
                    .checked(selected)
                    .on_click(move |_, _, cx| {
                        if !selected {
                            device_act(
                                &client,
                                cx,
                                json!({ "type": "setTextSize", "value": value }),
                            );
                        }
                        close(cx);
                    })
                    .child(option.label.clone())
                    .into_any_element()
                })
                .collect(),
            RailMenu::More => vec![
                action(
                    "device-more-float",
                    "Float device over chat",
                    "picture-in-picture-2",
                    "deviceFloat",
                )
                .into_any_element(),
                action(
                    "device-more-close",
                    "Close device panel",
                    "x",
                    "deviceClosePanel",
                )
                .into_any_element(),
                MenuSeparator::new().into_any_element(),
                action(
                    "device-more-power",
                    "Power off device",
                    "power",
                    "devicePowerOff",
                )
                .variant(MenuItemVariant::Destructive)
                .into_any_element(),
            ],
        };
        let dismiss = close.clone();
        Some(
            MenuPopup::new("device-rail-menu", trigger)
                .side(Side::Left)
                .align(if menu == RailMenu::More {
                    Align::End
                } else {
                    Align::Center
                })
                .side_offset(MENU_OFFSET)
                .when(menu == RailMenu::TextSize, |this| {
                    this.min_width(MENU_TEXT_MIN)
                })
                .on_dismiss(move |_, cx| dismiss(cx))
                .children(children)
                .into_any_element(),
        )
    }

    fn rail(&self, rail: &DeviceRailView, t: &Tokens, cx: &mut Context<Self>) -> AnyElement {
        let client = &self.client;
        let button = |id: &'static str,
                      icon_name: &'static str,
                      label: SharedString,
                      disabled: bool,
                      pressed: bool,
                      on_click: Option<ClickHandler>| {
            div()
                .id(SharedString::from(format!("{id}-wrap")))
                .flex_none()
                .tooltip(Tooltip::text(label.clone()))
                .child(
                    Button::new(id)
                        .size(ButtonSize::IconSm)
                        .variant(if pressed {
                            ButtonVariant::Secondary
                        } else {
                            ButtonVariant::Ghost
                        })
                        .icon(icon_name)
                        .accessibility_label(label)
                        .disabled(disabled)
                        .pressed(pressed)
                        .when_some(on_click, |this, handler| this.on_click(handler)),
                )
                .into_any_element()
        };
        let divider = || {
            div()
                .flex_none()
                .my(px(4.))
                .h(px(1.))
                .w(px(RAIL_DIVIDER_WIDTH))
                .bg(fade(t.border, 0.7))
                .into_any_element()
        };
        let mut items: Vec<AnyElement> = vec![button(
            "device-rail-home",
            "house",
            "Home".into(),
            rail.input_disabled,
            false,
            Some(Box::new(send(
                client,
                "deviceButton",
                json!({ "button": "home" }),
            ))),
        )];
        if rail.rotate.kind == "menu" {
            items.push(button(
                "device-rail-back",
                "chevron-left",
                "Back".into(),
                rail.input_disabled,
                false,
                Some(Box::new(send(
                    client,
                    "deviceButton",
                    json!({ "button": "back" }),
                ))),
            ));
            items.push(button(
                "device-rail-recents",
                "square",
                "Recents".into(),
                rail.input_disabled,
                false,
                Some(Box::new(send(
                    client,
                    "deviceButton",
                    json!({ "button": "recents" }),
                ))),
            ));
            items.push(self.menu_trigger(
                RailMenu::Rotate,
                "device-rail-rotate",
                "rotate-ccw",
                "Rotate device",
                rail.rotate.disabled,
                cx,
            ));
        } else {
            items.push(button(
                "device-rail-rotate",
                "rotate-ccw",
                "Rotate device".into(),
                rail.rotate.disabled,
                false,
                Some(Box::new(send(client, "deviceRotate", json!({})))),
            ));
        }
        items.push(divider());
        let next = rail.appearance.next.clone();
        let appearance_client = client.clone();
        items.push(button(
            "device-rail-appearance",
            if rail.appearance.icon == "sun" {
                "sun"
            } else {
                "moon"
            },
            rail.appearance.label.clone().into(),
            rail.appearance.disabled,
            false,
            Some(Box::new(move |_, _, cx| {
                device_act(
                    &appearance_client,
                    cx,
                    json!({ "type": "setAppearance", "value": next }),
                )
            })),
        ));
        items.push(self.menu_trigger(
            RailMenu::TextSize,
            "device-rail-text-size",
            "type",
            "Device text size",
            rail.text_size.disabled,
            cx,
        ));
        items.push(button(
            "device-rail-tools",
            "sliders-horizontal",
            "Device tools".into(),
            false,
            rail.tools_open,
            Some(Box::new(send(client, "deviceToolsToggle", json!({})))),
        ));
        items.push(button(
            "device-rail-screenshot",
            "camera",
            rail.screenshot.label.clone().into(),
            rail.screenshot.disabled,
            false,
            Some(Box::new(send(client, "deviceScreenshot", json!({})))),
        ));
        items.push(self.menu_trigger(
            RailMenu::More,
            "device-rail-more",
            "ellipsis",
            "More device actions",
            false,
            cx,
        ));
        items.push(divider());
        items.push(button(
            "device-rail-phone",
            "box",
            rail.phone_view
                .description
                .clone()
                .filter(|_| rail.phone_view.disabled)
                .unwrap_or_else(|| "3D view".to_string())
                .into(),
            rail.phone_view.disabled,
            false,
            None,
        ));
        items.push(button(
            "device-rail-flat",
            "smartphone",
            "Flat view".into(),
            rail.flat_view_disabled,
            true,
            None,
        ));
        let pill = div()
            .flex()
            .flex_none()
            .flex_col()
            .items_center()
            .gap(px(4.))
            .rounded_full()
            .border_1()
            .border_color(fade(t.border, 0.5))
            .bg(fade(t.background, 0.8))
            .p(px(8.))
            .shadow_sm()
            .children(items);
        let fold = rail.fold.as_ref().map(|fold| {
            let glyph = |id: &'static str,
                         path: &'static str,
                         label: &'static str,
                         pressed: bool,
                         posture: &'static str| {
                let color = if pressed {
                    t.secondary_foreground
                } else {
                    t.foreground
                };
                div()
                    .id(SharedString::from(format!("{id}-wrap")))
                    .flex_none()
                    .tooltip(Tooltip::text(label))
                    .child(
                        Button::new(id)
                            .size(ButtonSize::Icon)
                            .variant(if pressed {
                                ButtonVariant::Secondary
                            } else {
                                ButtonVariant::Ghost
                            })
                            .accessibility_label(label)
                            .pressed(pressed)
                            .disabled(fold.disabled)
                            .child(svg().path(path).size(px(FOLD_GLYPH)).text_color(color))
                            .on_click(send(client, "deviceFold", json!({ "posture": posture }))),
                    )
            };
            div()
                .flex()
                .flex_col()
                .items_center()
                .gap(px(8.))
                .child(
                    div()
                        .flex()
                        .flex_none()
                        .flex_col()
                        .items_center()
                        .gap(px(4.))
                        .rounded_full()
                        .border_1()
                        .border_color(fade(t.border, 0.5))
                        .bg(fade(t.background, 0.8))
                        .p(px(4.))
                        .shadow_sm()
                        .child(glyph(
                            "device-fold-closed",
                            "icons/device/duo-closed.svg",
                            "Fold device",
                            fold.closed,
                            "closed",
                        ))
                        .child(glyph(
                            "device-fold-open",
                            "icons/device/duo-open.svg",
                            "Unfold device",
                            fold.opened,
                            "opened",
                        )),
                )
                .children(fold.error.clone().map(|error| {
                    div()
                        .id("device-fold-error")
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .text_color(t.destructive_foreground)
                        .tooltip(Tooltip::text(error))
                        .child("!")
                }))
        });
        div()
            .absolute()
            .top_0()
            .bottom_0()
            .right_0()
            .w(px(RAIL_WIDTH))
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(8.))
            .py(px(12.))
            .pr(px(8.))
            .child(pill)
            .children(fold)
            .into_any_element()
    }

    fn workspace(
        &mut self,
        body: &DeviceWorkspaceBody,
        t: &Tokens,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let stream = &body.stream;
        let loading = stream.loading.as_ref().map(|loading| {
            let reconnect = loading.error.then(|| {
                Button::new("device-stream-reconnect")
                    .size(ButtonSize::Sm)
                    .variant(ButtonVariant::Outline)
                    .label("Reconnect")
                    .on_click(send(
                        &self.client,
                        "deviceStreamReconnect",
                        json!({ "key": stream.key }),
                    ))
                    .into_any_element()
            });
            div().absolute().inset_0().child(loading_view(
                &loading.name,
                &loading.description,
                &loading.message,
                loading.error,
                LoadingStage::Stream,
                reconnect,
                t,
            ))
        });
        let screen = self.screen.as_ref().map(|(_, screen)| screen.clone());
        let rail = self.rail(&body.rail, t, cx);
        let menu = self.menu_popup(&body.rail, cx);
        let column = div()
            .relative()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .children(body.error_banner.clone().map(|error| {
                div()
                    .px(px(12.))
                    .py(px(8.))
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.destructive_foreground)
                    .child(error)
            }))
            .child(
                div()
                    .relative()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .min_w_0()
                    .children(screen)
                    .children(loading)
                    .child(rail),
            )
            .children(menu);
        let tools = body
            .tools
            .as_ref()
            .map(|tools| self.tools(tools, t, window, cx));
        let overlay = self.width < TOOLS_STATIC_MIN;
        div()
            .flex()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .child(column)
            .children(tools.map(|tools| {
                div()
                    .flex()
                    .flex_col()
                    .min_h_0()
                    .border_l_1()
                    .border_color(t.border)
                    .bg(t.background)
                    .map(|this| {
                        if overlay {
                            this.absolute()
                                .top_0()
                                .bottom_0()
                                .right_0()
                                .w_full()
                                .max_w(px(TOOLS_WIDTH))
                                .shadow_lg()
                        } else {
                            this.flex_none().w(px(TOOLS_WIDTH))
                        }
                    })
                    .child(tools)
            }))
            .into_any_element()
    }

    fn tools(
        &mut self,
        tools: &DeviceToolsView,
        t: &Tokens,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let client = self.client.clone();
        let section = |title: SharedString| {
            div()
                .flex()
                .flex_col()
                .gap(px(8.))
                .border_b_1()
                .border_color(t.border)
                .px(px(12.))
                .py(px(10.))
                .child(
                    div()
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.muted_foreground)
                        .child(title),
                )
        };
        let row = |label: SharedString, control: AnyElement| {
            div()
                .flex()
                .min_h(px(28.))
                .items_center()
                .justify_between()
                .gap(px(12.))
                .child(
                    div()
                        .flex_none()
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .text_color(t.muted_foreground)
                        .child(label),
                )
                .child(
                    div()
                        .flex()
                        .min_w_0()
                        .items_center()
                        .justify_end()
                        .child(control),
                )
        };
        let select = |id: &'static str,
                      label: &'static str,
                      options: &[ChoiceOption],
                      placeholder: &'static str,
                      width: f32,
                      disabled: bool,
                      align: Align,
                      on: ValueHandler| {
            let current = options.iter().find(|option| option.selected);
            Select::new(id)
                .size(SelectSize::Xs)
                .w(px(width))
                .accessibility_label(label)
                .value(current.map(|option| SharedString::from(option.value.clone())))
                .placeholder(placeholder)
                .disabled(disabled)
                .align(align)
                .match_trigger_width(false)
                .items(
                    options
                        .iter()
                        .map(|option| SelectItem::new(option.value.clone(), option.label.clone())),
                )
                .on_change(move |value, _, cx| on(value.to_string(), cx))
                .into_any_element()
        };
        let act_select = |kind: &'static str| -> ValueHandler {
            let client = client.clone();
            Box::new(move |value, cx| {
                device_act(&client, cx, json!({ "type": kind, "value": value }))
            })
        };
        let toggles = |id: &'static str,
                       label: &'static str,
                       choices: [(&'static str, &'static str); 2],
                       current: Option<&str>,
                       disabled: bool,
                       kind: &'static str| {
            ToggleGroup::new(id)
                .items(choices.into_iter().map(|(value, text)| {
                    let client = client.clone();
                    let pressed = current == Some(value);
                    Toggle::new(SharedString::from(format!("{id}-{value}")))
                        .label(text)
                        .accessibility_label(format!("{label} {text}"))
                        .pressed(pressed)
                        .disabled(disabled)
                        .on_change(move |_, _, _, cx| {
                            if !pressed {
                                device_act(&client, cx, json!({ "type": kind, "value": value }));
                            }
                        })
                }))
                .into_any_element()
        };
        let submit_row = |state: Entity<InputState>,
                          id: &'static str,
                          action: &'static str,
                          field: &'static str,
                          input_disabled: bool,
                          submit_disabled: bool| {
            div()
                .flex()
                .gap(px(6.))
                .child(
                    div().flex_1().min_w_0().child(
                        Input::new(&state)
                            .size(InputSize::Compact)
                            .font(InputFont::Mono)
                            .disabled(input_disabled),
                    ),
                )
                .child(
                    Button::new(id)
                        .size(ButtonSize::Xs)
                        .variant(ButtonVariant::Outline)
                        .disabled(submit_disabled)
                        .label(action)
                        .on_click(send(
                            &client,
                            "deviceToolsSubmit",
                            json!({ "field": field }),
                        )),
                )
        };
        let open_url = self.field(
            "openUrl",
            &tools.open_url.value,
            "https://… or myapp://",
            window,
            cx,
        );
        let launch_app = self.field(
            "launchApp",
            &tools.launch_app.value,
            &tools.launch_app.placeholder,
            window,
            cx,
        );
        let latitude = self.field("latitude", &tools.location.latitude, "Latitude", window, cx);
        let longitude = self.field(
            "longitude",
            &tools.location.longitude,
            "Longitude",
            window,
            cx,
        );
        let permission_app = self.field(
            "permissionApp",
            &tools.permissions.app_id,
            &tools.permissions.placeholder,
            window,
            cx,
        );
        let push = tools
            .push
            .as_ref()
            .map(|push| self.field("push", &push.value, "Alert text", window, cx));
        let disabled = tools.disabled;

        let header = div()
            .flex()
            .flex_none()
            .h(px(TOOLS_HEADER))
            .items_center()
            .gap(px(8.))
            .border_b_1()
            .border_color(t.border)
            .px(px(12.))
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .child(
                div()
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.foreground)
                    .child("Tools"),
            )
            .when(tools.pending, |this| {
                this.child(Spinner::new("device-tools-pending").size(SpinnerSize::Sm))
            })
            .child(div().flex_1())
            .child(
                Button::new("device-tools-close")
                    .size(ButtonSize::IconXs)
                    .variant(ButtonVariant::GhostMuted)
                    .icon("x")
                    .accessibility_label("Close tools")
                    .on_click(send(&client, "deviceToolsClose", json!({}))),
            );

        let mut app = section("App".into()).child(row(
            "Foreground".into(),
            div()
                .truncate()
                .font_family(MONO_FONT)
                .text_size(px(text::XS))
                .text_color(t.foreground)
                .child(tools.foreground.clone().unwrap_or_else(|| "—".to_string()))
                .into_any_element(),
        ));
        if tools.foreground.is_some() {
            let foreground_button = |id: &'static str, label: &'static str, value: &'static str| {
                Button::new(id)
                    .size(ButtonSize::Xs)
                    .variant(ButtonVariant::Outline)
                    .disabled(disabled)
                    .label(label)
                    .on_click(send(
                        &client,
                        "deviceForegroundAct",
                        json!({ "value": value }),
                    ))
            };
            app = app.child(
                div()
                    .flex()
                    .gap(px(6.))
                    .child(foreground_button(
                        "device-tools-terminate",
                        "Terminate",
                        "terminate",
                    ))
                    .child(foreground_button(
                        "device-tools-relaunch",
                        "Relaunch",
                        "relaunch",
                    )),
            );
        }
        app = app
            .child(submit_row(
                open_url,
                "device-tools-open-url",
                "Open",
                "openUrl",
                disabled,
                tools.open_url.submit_disabled,
            ))
            .child(submit_row(
                launch_app,
                "device-tools-launch",
                "Launch",
                "launchApp",
                disabled,
                tools.launch_app.submit_disabled,
            ));

        let mut settings = section(tools.settings_title.clone().into())
            .child(row(
                "Appearance".into(),
                toggles(
                    "device-tools-appearance",
                    "Appearance",
                    [("light", "Light"), ("dark", "Dark")],
                    tools.appearance.as_deref(),
                    disabled,
                    "setAppearance",
                ),
            ))
            .child(row(
                "Text size".into(),
                select(
                    "device-tools-text-size",
                    "Text size",
                    &tools.text_size,
                    "Unknown",
                    SELECT_WIDE,
                    disabled,
                    Align::End,
                    act_select("setTextSize"),
                ),
            ));
        if let Some(glass) = tools.liquid_glass.as_ref() {
            settings = settings.child(row(
                "Liquid Glass".into(),
                toggles(
                    "device-tools-liquid-glass",
                    "Liquid Glass",
                    [("clear", "Clear"), ("tinted", "Tinted")],
                    glass.value.as_deref(),
                    glass.disabled,
                    "setLiquidGlass",
                ),
            ));
        }
        if let Some(filter) = tools.color_filter.as_ref() {
            settings = settings.child(row(
                "Color filter".into(),
                select(
                    "device-tools-color-filter",
                    "Color filter",
                    &filter.options,
                    "Unknown",
                    SELECT_WIDE,
                    disabled,
                    Align::End,
                    act_select("setColorFilter"),
                ),
            ));
        }
        if let Some(orientations) = tools.orientations.as_ref() {
            settings = settings.child(row(
                "Orientation".into(),
                select(
                    "device-tools-orientation",
                    "Orientation",
                    orientations,
                    "Rotate to…",
                    SELECT_WIDE,
                    disabled,
                    Align::End,
                    act_select("setOrientation"),
                ),
            ));
        }
        for toggle in &tools.switches {
            let client = client.clone();
            let setting = toggle.setting.clone();
            settings = settings.child(row(
                toggle.label.clone().into(),
                Switch::new(SharedString::from(format!(
                    "device-tools-{}",
                    toggle.setting
                )))
                .size(SwitchSize::Sm)
                .checked(toggle.checked)
                .disabled(toggle.disabled)
                .accessibility_label(toggle.label.clone())
                .on_change(move |checked, _, _, cx| {
                    device_act(
                        &client,
                        cx,
                        json!({ "type": "setToggle", "setting": setting, "value": checked }),
                    )
                })
                .into_any_element(),
            ));
        }

        let ax_client = client.clone();
        let accessibility = section("Accessibility".into()).child(row(
            "Overlay element frames".into(),
            Switch::new("device-tools-ax-overlay")
                .size(SwitchSize::Sm)
                .checked(tools.ax_overlay.checked)
                .disabled(tools.ax_overlay.disabled)
                .accessibility_label("Overlay element frames")
                .on_change(move |checked, _, _, cx| {
                    act(
                        &ax_client,
                        cx,
                        "deviceAxOverlay",
                        json!({ "enabled": checked }),
                    )
                })
                .into_any_element(),
        ));

        let preset_client = client.clone();
        let presets: Vec<ChoiceOption> = tools
            .location
            .presets
            .iter()
            .map(|label| ChoiceOption {
                value: label.clone(),
                label: label.clone(),
                selected: false,
            })
            .collect();
        let location_input = |state: Entity<InputState>| {
            div().flex_1().min_w_0().child(
                Input::new(&state)
                    .size(InputSize::Compact)
                    .font(InputFont::Mono)
                    .disabled(disabled),
            )
        };
        let location = section("Location".into())
            .child(
                div()
                    .flex()
                    .gap(px(6.))
                    .child(location_input(latitude))
                    .child(location_input(longitude)),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(px(6.))
                    .child(select(
                        "device-tools-location-preset",
                        "Location preset",
                        &presets,
                        "Preset…",
                        SELECT_PRESET,
                        disabled,
                        Align::Start,
                        Box::new(move |label, cx| {
                            act(
                                &preset_client,
                                cx,
                                "deviceLocationPreset",
                                json!({ "label": label }),
                            )
                        }),
                    ))
                    .child(
                        Button::new("device-tools-location-set")
                            .size(ButtonSize::Xs)
                            .variant(ButtonVariant::Outline)
                            .disabled(tools.location.set_disabled)
                            .label("Set")
                            .on_click(send(&client, "deviceLocationSet", json!({}))),
                    )
                    .when(tools.location.can_clear, |this| {
                        this.child(
                            Button::new("device-tools-location-clear")
                                .size(ButtonSize::Xs)
                                .variant(ButtonVariant::Ghost)
                                .disabled(disabled)
                                .label("Clear")
                                .on_click(send(&client, "deviceLocationClear", json!({}))),
                        )
                    }),
            );

        let permission_client = client.clone();
        let decide = |id: &'static str, label: &'static str, decision: &'static str, variant| {
            Button::new(id)
                .size(ButtonSize::Xs)
                .variant(variant)
                .disabled(tools.permissions.decide_disabled)
                .label(label)
                .on_click(send(
                    &client,
                    "devicePermissionDecide",
                    json!({ "decision": decision }),
                ))
        };
        let permissions = section("Permissions".into())
            .child(
                Input::new(&permission_app)
                    .size(InputSize::Compact)
                    .font(InputFont::Mono)
                    .disabled(disabled),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(px(6.))
                    .child(select(
                        "device-tools-permission",
                        "Permission",
                        &tools.permissions.options,
                        "Unknown",
                        SELECT_WIDE,
                        disabled,
                        Align::End,
                        Box::new(move |value, cx| {
                            act(
                                &permission_client,
                                cx,
                                "devicePermissionSelect",
                                json!({ "value": value }),
                            )
                        }),
                    ))
                    .child(decide(
                        "device-tools-grant",
                        "Grant",
                        "grant",
                        ButtonVariant::Outline,
                    ))
                    .child(decide(
                        "device-tools-revoke",
                        "Revoke",
                        "revoke",
                        ButtonVariant::Outline,
                    ))
                    .when(tools.permissions.can_reset, |this| {
                        this.child(decide(
                            "device-tools-reset",
                            "Reset",
                            "reset",
                            ButtonVariant::Ghost,
                        ))
                    }),
            );

        let push_section = tools.push.as_ref().zip(push).map(|(model, state)| {
            section("Push notification".into())
                .child(submit_row(
                    state,
                    "device-tools-push",
                    "Send",
                    "push",
                    model.input_disabled,
                    model.submit_disabled,
                ))
                .when(model.hint, |this| {
                    this.child(xs_muted(t, "Open an app first."))
                })
        });

        let event_log = tools.event_log.as_ref().map(|log| {
            let entries: Vec<AnyElement> = if log.entries.is_empty() {
                vec![
                    div()
                        .text_color(t.muted_foreground)
                        .child("No events yet.")
                        .into_any_element(),
                ]
            } else {
                log.entries
                    .iter()
                    .map(|entry| {
                        div()
                            .flex()
                            .gap(px(8.))
                            .child(
                                div()
                                    .flex_none()
                                    .text_color(t.muted_foreground)
                                    .child(entry.time.clone()),
                            )
                            .child(div().min_w_0().truncate().child(entry.summary.clone()))
                            .into_any_element()
                    })
                    .collect()
            };
            div()
                .flex()
                .flex_col()
                .child(
                    div()
                        .id("device-tools-event-log")
                        .flex()
                        .items_center()
                        .gap(px(6.))
                        .border_b_1()
                        .border_color(t.border)
                        .px(px(12.))
                        .py(px(10.))
                        .cursor_pointer()
                        .text_size(px(text::XS))
                        .line_height(px(text::XS_LINE))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.muted_foreground)
                        .on_click(send(&client, "deviceEventLogToggle", json!({})))
                        .child("Event log")
                        .child(div().flex_1())
                        .child(icon(
                            if log.open {
                                "chevron-up"
                            } else {
                                "chevron-down"
                            },
                            14.,
                            t.muted_foreground,
                        )),
                )
                .when(log.open, |this| {
                    this.child(
                        div()
                            .id("device-tools-event-log-list")
                            .flex()
                            .flex_col()
                            .max_h(px(EVENT_LOG_MAX))
                            .overflow_y_scroll()
                            .px(px(12.))
                            .py(px(8.))
                            .font_family(MONO_FONT)
                            .text_size(px(TEXT_2XS))
                            .line_height(px(TEXT_2XS * text::LEADING_RELAXED))
                            .text_color(t.foreground)
                            .children(entries),
                    )
                })
        });

        div()
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .text_size(px(text::SM))
            .child(header)
            .child(
                div()
                    .id("device-tools-scroll")
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .children(tools.error.clone().map(|error| {
                        div()
                            .border_b_1()
                            .border_color(t.border)
                            .bg(fade(t.destructive, 0.1))
                            .px(px(12.))
                            .py(px(8.))
                            .text_size(px(text::XS))
                            .line_height(px(text::XS_LINE))
                            .text_color(t.destructive_foreground)
                            .child(error)
                    }))
                    .when(tools.loading, |this| {
                        this.child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(8.))
                                .px(px(12.))
                                .py(px(12.))
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .text_color(t.muted_foreground)
                                .child(Spinner::new("device-tools-loading").size(SpinnerSize::Sm))
                                .child("Reading device settings…"),
                        )
                    })
                    .children(tools.host_diagnostics.clone().map(|diagnostics| {
                        section("Host diagnostics".into()).child(xs_muted(t, diagnostics))
                    }))
                    .child(app)
                    .child(settings)
                    .child(accessibility)
                    .child(location)
                    .child(permissions)
                    .children(push_section)
                    .children(event_log),
            )
            .into_any_element()
    }

    fn list(
        &self,
        empty_message: &Option<String>,
        groups: &[crate::app_core::views::device::DeviceListGroup],
        android_hint: bool,
        refresh: &Option<crate::app_core::views::device::DeviceListRefresh>,
        t: &Tokens,
    ) -> AnyElement {
        let client = &self.client;
        let empty = empty_message.is_some();
        let group_views = groups.iter().map(|group| {
            let rows = group.rows.iter().enumerate().map(|(index, row)| {
                let hover = fade(t.accent, 0.4);
                div()
                    .id(SharedString::from(format!(
                        "device-row-{}-{}",
                        row.host_id, row.device_id
                    )))
                    .flex()
                    .w_full()
                    .items_center()
                    .gap(px(12.))
                    .px(px(12.))
                    .py(px(12.))
                    .when(index > 0, |this| {
                        this.border_t_1().border_color(fade(t.border, 0.6))
                    })
                    .map(|this| {
                        if row.disabled {
                            this.opacity(0.64)
                        } else {
                            this.cursor_pointer()
                                .hover(move |s| s.bg(hover))
                                .on_click(send(
                                    client,
                                    "devicePanelSelect",
                                    json!({ "hostId": row.host_id, "deviceId": row.device_id }),
                                ))
                        }
                    })
                    .child(
                        div()
                            .flex()
                            .flex_none()
                            .items_center()
                            .justify_center()
                            .size(px(LIST_ICON_BOX))
                            .rounded(px(radius::MD))
                            .border_1()
                            .border_color(fade(t.border, 0.6))
                            .child(icon("smartphone", 16., t.foreground)),
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
                                    .text_color(t.foreground)
                                    .child(row.title.clone()),
                            )
                            .child(xs_muted(t, row.description.clone()).truncate()),
                    )
                    .child(if row.pending {
                        Spinner::new(SharedString::from(format!(
                            "device-row-spinner-{}",
                            row.device_id
                        )))
                        .size(SpinnerSize::Xs)
                        .into_any_element()
                    } else {
                        xs_muted(t, row.action.clone()).into_any_element()
                    })
            });
            div()
                .flex()
                .flex_col()
                .gap(px(12.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .text_size(px(text::SM))
                        .line_height(px(text::SM_LINE))
                        .text_color(t.muted_foreground)
                        .child(icon("smartphone", 16., t.muted_foreground))
                        .child(
                            div()
                                .font_weight(FontWeight::MEDIUM)
                                .child(group.label.clone()),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .overflow_hidden()
                        .rounded(px(radius::XL))
                        .border_1()
                        .border_color(fade(t.border, 0.7))
                        .bg(t.background)
                        .children(rows),
                )
        });
        let groups_view = (!groups.is_empty()).then(|| {
            div()
                .flex()
                .flex_col()
                .w_full()
                .gap(px(24.))
                .children(group_views)
        });
        let refresh = refresh.as_ref().map(|refresh| {
            Button::new("device-list-refresh")
                .size(ButtonSize::Sm)
                .variant(if refresh.variant == "outline" {
                    ButtonVariant::Outline
                } else {
                    ButtonVariant::Ghost
                })
                .label("Refresh devices")
                .on_click(send(client, "devicePanelRefresh", json!({})))
                .map(|button| {
                    if refresh.align == "start" {
                        div().flex().self_start().child(button)
                    } else {
                        div().flex().self_center().child(button)
                    }
                })
        });
        div()
            .id("device-list-scroll")
            .flex()
            .flex_col()
            .size_full()
            .overflow_y_scroll()
            .px(px(20.))
            .py(px(32.))
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .text_color(t.muted_foreground)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .w_full()
                    .max_w(px(LIST_MAX_WIDTH))
                    .mx_auto()
                    .gap(px(24.))
                    .when(empty, |this| this.my_auto().items_center().text_center())
                    .children(empty_message.clone().map(|message| {
                        div()
                            .flex()
                            .flex_col()
                            .items_center()
                            .gap(px(24.))
                            .child(icon("smartphone", 24., fade(t.muted_foreground, 0.6)))
                            .child(div().max_w(px(384.)).child(message))
                    }))
                    .children(groups_view)
                    .when(android_hint, |this| {
                        this.child(xs_muted(
                            t,
                            "No Android virtual devices found. Create one in Android Studio's Device Manager, then refresh.",
                        ).max_w(px(384.)))
                    })
                    .children(refresh),
            )
            .into_any_element()
    }
}

impl Render for DevicePanelSurface {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = theme::active(cx);
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return div().size_full().bg(t.background).into_any_element();
        };
        let notice = |message: String| {
            div()
                .border_b_1()
                .border_color(t.border)
                .px(px(12.))
                .py(px(8.))
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .text_color(t.muted_foreground)
                .child(message)
        };
        let error = view.operation_error.clone().map(|error| {
            div()
                .flex()
                .items_start()
                .gap(px(8.))
                .border_b_1()
                .border_color(t.border)
                .bg(fade(t.destructive, 0.05))
                .px(px(12.))
                .py(px(8.))
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .text_color(t.destructive_foreground)
                .child(div().flex_1().min_w_0().child(error))
                .child(
                    Button::new("device-error-dismiss")
                        .size(ButtonSize::IconXs)
                        .variant(ButtonVariant::Ghost)
                        .icon("x")
                        .icon_size(12.)
                        .accessibility_label("Dismiss device error")
                        .on_click(send(&self.client, "devicePanelDismissError", json!({}))),
                )
        });
        let body: Option<AnyElement> = match &view.body {
            DevicePanelBody::Setup => None,
            DevicePanelBody::Workspace(body) => Some(self.workspace(body, &t, window, cx)),
            DevicePanelBody::Loading {
                name,
                description,
                message,
            } => Some(loading_view(
                name,
                description,
                message,
                false,
                LoadingStage::Opening,
                None,
                &t,
            )),
            DevicePanelBody::List {
                empty_message,
                groups,
                android_hint,
                refresh,
            } => Some(self.list(empty_message, groups, *android_hint, refresh, &t)),
        };
        let entity = cx.entity().downgrade();
        div()
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .min_w_0()
            .bg(t.background)
            .children(view.host_notice.clone().map(notice))
            .children(host_updates(
                "device-panel",
                &view.environment_id,
                &view.host_updates,
                &self.client,
                &t,
            ))
            .children(view.booting_notice.clone().map(notice))
            .children(error)
            .child(
                div()
                    .relative()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .child(
                        canvas(
                            move |bounds, _, cx| {
                                let width = f32::from(bounds.size.width);
                                if let Some(this) = entity.upgrade() {
                                    this.update(cx, |this, cx| {
                                        if (this.width - width).abs() > 0.5 {
                                            this.width = width;
                                            cx.notify();
                                        }
                                    });
                                }
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full(),
                    )
                    .children(body),
            )
            .into_any_element()
    }
}
