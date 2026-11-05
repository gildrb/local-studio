use std::collections::{HashMap, HashSet};
use std::time::Duration;

use gpui::component::input::{InputEvent, InputState, TextareaState};
use gpui::prelude::FluentBuilder;
use gpui::{
    Animation, AnimationExt, AnyElement, App, AppContext, Bounds, ClickEvent, Context, Entity,
    FontWeight, InteractiveElement, IntoElement, KeyDownEvent, ParentElement, Pixels, Render, Rgba,
    SharedString, StatefulInteractiveElement, Styled, Window, canvas, div, fill, point, px, size,
    svg,
};
use qrcode::{Color as QrColor, EcLevel, QrCode};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::settings_connections::{
    AddEnvironmentDialog, AdvertisedEndpointRow, AuthorizedClients, ButtonVariantView,
    ClientSessionRow, ConnectionModeCard, ConnectionsEnvironmentRow, CreatePairingLinkDialog,
    DialogModel, EmptyMode, EnvironmentIconMenu, GitHubRouting, LocalEnvironmentSetting,
    ManagedPrimary, NetworkAccessDescription, NetworkAccessRow, PairingCodeAction, PairingLinkRow,
    PrimarySection, RemoteEnvironments, SavedBackendMode, SavedBackendRow, ServerUpdateAction,
    ServerUpdateControl, ServerUpdateProgress, SettingsConnectionsView, SshFields, StatusTone,
    SuggestionsState, TailscaleSetupDialog, ValidationTone, VersionControl, VersionDescription,
    WslConfirmDialog, WslSettings,
};
use crate::features::settings::environment_row::EnvironmentRow;
use crate::features::settings::load_balancing::LoadBalancingBlock;
use crate::features::settings::primitives::{
    FoldedSettingsSection, SettingsControlWidth, SettingsRow, SettingsSection, SettingsSelect,
    SettingsSelectOption, settings_button, settings_stack, settings_switch,
};
use crate::features::sidebar::machine_icon;
use crate::platform::MONO_FONT;
use crate::ui::alert_dialog::{
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup,
    AlertDialogTitle,
};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::checkbox::Checkbox;
use crate::ui::dialog::{
    DialogDescription, DialogFooter, DialogFooterVariant, DialogHeader, DialogPanel, DialogPopup,
    DialogTitle,
};
use crate::ui::empty::Empty;
use crate::ui::input::Input;
use crate::ui::menu::{
    MenuItem, MenuItemVariant, MenuPopup, MenuRadioItem, MenuSeparator, MenuShortcut,
    MenuSubTrigger,
};
use crate::ui::popover::{Align, Side, dropdown_glass, positioned};
use crate::ui::select::{Select, SelectItem, SelectSize};
use crate::ui::spinner::{Spinner, SpinnerSize};
use crate::ui::switch::SwitchSize;
use crate::ui::textarea::Textarea;
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const ROW_PADDING_X: f32 = 16.;
const ROW_PADDING_Y: f32 = 12.;
const ROW_GAP: f32 = 12.;
const TEXT_2XS: f32 = 11.;
const TEXT_3XS: f32 = 10.;
const TEXT_3XS_LINE: f32 = 12.;
const DOT_BOX: f32 = 12.;
const DOT: f32 = 8.;
const PROGRESS_DOT: f32 = 6.;
const QR_SIZE: f32 = 168.;
const QR_MARGIN: usize = 1;
const QR_PADDING: f32 = 12.;
const QR_FALLBACK: f32 = 192.;
const REVEAL_QR_SIZE: f32 = 132.;
const REVEAL_QR_MARGIN: usize = 2;
const AUTHORIZED_CLIENTS_MAX_HEIGHT: f32 = 360.;
const ADD_DIALOG_WIDTH: f32 = 768.;
const SMALL_DIALOG_WIDTH: f32 = 448.;
const MODE_CARD_MIN_HEIGHT: f32 = 96.;
const MODE_ICON_BOX: f32 = 32.;
const PAIRING_CODE_WIDTH: f32 = 160.;
const SSH_PORT_WIDTH: f32 = 112.;
const WSL_SELECT_WIDTH: f32 = 224.;
const ROUTING_SELECT_WIDTH: f32 = 128.;
const SUGGESTION_HEIGHT: f32 = 32.;
const SUGGESTION_MAX_HEIGHT: f32 = 288.;
const PROGRESS_MAX_WIDTH: f32 = 448.;
const RAIL_WIDTH: f32 = 4.;
const UNAVAILABLE_ENDPOINT_FILL: f32 = 0.15;
const WSL_ONLY_FILL: f32 = 0.2;
const WSL_ONLY_INDENT: f32 = 12.;
const PING_MS: u64 = 2000;
const PULSE_MS: u64 = 2000;

const PRIMARY_MENU: &str = "primary";
const ICON_SUB: &str = "icon-sub";

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

fn on_click(
    client: &Entity<CoreClient>,
    action: &'static str,
    params: Value,
) -> impl Fn(&ClickEvent, &mut Window, &mut App) + 'static {
    let client = client.clone();
    move |_, _, cx| act(&client, cx, action, params.clone())
}

fn icon(name: &str, size: f32, color: Rgba) -> gpui::Svg {
    let path = if name.ends_with(".svg") {
        SharedString::from(name.to_string())
    } else {
        SharedString::from(format!("icons/{name}.svg"))
    };
    svg()
        .path(path)
        .flex_none()
        .size(px(size))
        .text_color(color)
}

fn line(size: f32, line_height: f32, color: Rgba) -> gpui::Div {
    div()
        .text_size(px(size))
        .line_height(px(line_height))
        .text_color(color)
}

fn xs(color: Rgba, label: impl Into<SharedString>) -> gpui::Div {
    line(text::XS, text::XS_LINE, color).child(label.into())
}

fn variant(view: ButtonVariantView) -> ButtonVariant {
    match view {
        ButtonVariantView::Default => ButtonVariant::Default,
        ButtonVariantView::Outline => ButtonVariant::Outline,
        ButtonVariantView::Destructive => ButtonVariant::Destructive,
    }
}

fn busy_button(id: impl Into<SharedString>, label: &str, busy: bool) -> Button {
    let id: SharedString = id.into();
    Button::new(id.clone())
        .when(busy, |this| {
            this.child(
                Spinner::new(SharedString::from(format!("{id}-spinner"))).size(SpinnerSize::Sm),
            )
        })
        .label(label.to_string())
}

fn with_tooltip(id: impl Into<SharedString>, tooltip: &str, child: impl IntoElement) -> AnyElement {
    div()
        .id(gpui::ElementId::Name(id.into()))
        .flex()
        .flex_none()
        .tooltip(Tooltip::text(tooltip.to_string()))
        .child(child)
        .into_any_element()
}

fn status_dot(id: String, tooltip: &str, color: Rgba, ping: Option<Rgba>) -> AnyElement {
    div()
        .id(gpui::ElementId::Name(SharedString::from(id.clone())))
        .relative()
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .size(px(DOT_BOX))
        .rounded_full()
        .cursor(gpui::CursorStyle::Arrow)
        .tooltip(Tooltip::text(tooltip.to_string()))
        .when_some(ping, |this, ping| {
            this.child(div().absolute().rounded_full().bg(ping).with_animation(
                SharedString::from(format!("{id}-ping")),
                Animation::new(Duration::from_millis(PING_MS)).repeat(),
                |el, delta| {
                    let grow = (delta / 0.75).min(1.);
                    let extent = DOT_BOX * (1. + grow);
                    let offset = (DOT_BOX - extent) / 2.;
                    el.left(px(offset))
                        .top(px(offset))
                        .size(px(extent))
                        .opacity(1. - grow)
                },
            ))
        })
        .child(div().relative().size(px(DOT)).rounded_full().bg(color))
        .into_any_element()
}

fn qr_code(value: &str, extent: f32, margin: usize) -> Option<AnyElement> {
    let code = QrCode::with_error_correction_level(value.as_bytes(), EcLevel::M).ok()?;
    let width = code.width();
    let colors = code.to_colors();
    let cell = extent / (width + margin * 2) as f32;
    let mut runs: Vec<(usize, usize, usize)> = Vec::new();
    for y in 0..width {
        let mut x = 0;
        while x < width {
            if colors[y * width + x] == QrColor::Dark {
                let start = x;
                while x < width && colors[y * width + x] == QrColor::Dark {
                    x += 1;
                }
                runs.push((start, y, x - start));
            } else {
                x += 1;
            }
        }
    }
    Some(
        canvas(
            |_, _, _| {},
            move |bounds, _, window, _| {
                window.paint_quad(fill(bounds, gpui::white()));
                for (x, y, len) in &runs {
                    let origin = point(
                        bounds.origin.x + px(((x + margin) as f32) * cell),
                        bounds.origin.y + px(((y + margin) as f32) * cell),
                    );
                    window.paint_quad(fill(
                        Bounds::new(origin, size(px(*len as f32 * cell), px(cell))),
                        gpui::black(),
                    ));
                }
            },
        )
        .flex_none()
        .size(px(extent))
        .into_any_element(),
    )
}

fn update_progress(id: &str, progress: &ServerUpdateProgress, t: &Tokens) -> AnyElement {
    match progress {
        ServerUpdateProgress::Failed { message } => div()
            .id(gpui::ElementId::Name(SharedString::from(format!(
                "{id}-failed"
            ))))
            .mt(px(4.))
            .flex()
            .min_w_0()
            .items_center()
            .gap(px(8.))
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .text_color(t.destructive)
            .tooltip(Tooltip::text(message.clone()))
            .child(
                div()
                    .flex_none()
                    .size(px(PROGRESS_DOT))
                    .rounded_full()
                    .bg(t.destructive),
            )
            .child(div().min_w_0().truncate().child(message.clone()))
            .into_any_element(),
        ServerUpdateProgress::Running { label } => div()
            .mt(px(4.))
            .flex()
            .items_center()
            .gap(px(8.))
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .font_weight(FontWeight::MEDIUM)
            .text_color(t.foreground)
            .child(
                div()
                    .flex_none()
                    .size(px(PROGRESS_DOT))
                    .rounded_full()
                    .bg(t.foreground)
                    .with_animation(
                        SharedString::from(format!("{id}-pulse")),
                        Animation::new(Duration::from_millis(PULSE_MS)).repeat(),
                        |el, delta| el.opacity(1. - 0.6 * (1. - (2. * delta - 1.).abs())),
                    ),
            )
            .child(label.clone())
            .into_any_element(),
    }
}

struct FieldInput {
    state: Entity<InputState>,
    pending: Vec<String>,
    last_core: String,
}

#[derive(Clone, Copy)]
enum Field {
    PairingLabel,
    TailscalePort,
    Host,
    PairingCode,
    SshHost,
    SshUsername,
    SshPort,
}

impl Field {
    fn key(self) -> &'static str {
        match self {
            Field::PairingLabel => "pairingLabel",
            Field::TailscalePort => "tailscalePort",
            Field::Host => "host",
            Field::PairingCode => "pairingCode",
            Field::SshHost => "sshHost",
            Field::SshUsername => "sshUsername",
            Field::SshPort => "sshPort",
        }
    }

    fn send(self, client: &Entity<CoreClient>, value: String, cx: &mut App) {
        match self {
            Field::PairingLabel => act(
                client,
                cx,
                "connectionsCreateLinkLabel",
                json!({ "value": value }),
            ),
            Field::TailscalePort => act(
                client,
                cx,
                "connectionsTailscalePort",
                json!({ "value": value }),
            ),
            _ => act(
                client,
                cx,
                "connectionsAddField",
                json!({ "field": self.key(), "value": value }),
            ),
        }
    }
}

struct Reveal {
    id: String,
    value: String,
    state: Entity<TextareaState>,
}

pub struct ConnectionsSection {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<SettingsConnectionsView>>>,
    load_balancing: Entity<LoadBalancingBlock>,
    menu: Option<String>,
    sub_open: bool,
    sub_popup: Option<Bounds<Pixels>>,
    bounds: HashMap<String, Bounds<Pixels>>,
    fields: HashMap<&'static str, FieldInput>,
    reveal: Option<Reveal>,
    highlight: Option<usize>,
}

impl ConnectionsSection {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<SettingsConnectionsView>>(
            &client,
            "settingsConnections",
            json!({}),
            cx,
        );
        cx.observe(&view, |_, _, cx| cx.notify()).detach();
        act(&client, cx, "connectionsMount", json!({}));
        let load_balancing = cx.new(|cx| LoadBalancingBlock::new(client.clone(), cx));
        Self {
            client,
            view,
            load_balancing,
            menu: None,
            sub_open: false,
            sub_popup: None,
            bounds: HashMap::new(),
            fields: HashMap::new(),
            reveal: None,
            highlight: None,
        }
    }

    fn sync(
        &mut self,
        view: &SettingsConnectionsView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let mut live: Vec<(Field, String, String, bool)> = Vec::new();
        let managed = match &view.model.primary {
            PrimarySection::Managed(managed) => Some(managed.as_ref()),
            PrimarySection::Restricted { .. } => None,
        };
        if let Some(managed) = managed {
            if view.create_pairing_link_open {
                let field = &managed.create_pairing_link_dialog.label_field;
                live.push((
                    Field::PairingLabel,
                    field.value.clone(),
                    field.placeholder.clone(),
                    true,
                ));
            }
            let setup = &managed.tailscale_setup_dialog;
            if setup.open {
                live.push((
                    Field::TailscalePort,
                    setup.port_value.clone(),
                    String::new(),
                    false,
                ));
            }
        }
        let add = &view.model.remote_environments.add_environment_dialog;
        if view.add_environment_open {
            match add.mode {
                SavedBackendMode::Remote => {
                    live.push((
                        Field::Host,
                        add.remote.host_value.clone(),
                        add.remote.host_placeholder.clone(),
                        false,
                    ));
                    live.push((
                        Field::PairingCode,
                        add.remote.pairing_code_value.clone(),
                        add.remote.pairing_code_placeholder.clone(),
                        false,
                    ));
                }
                SavedBackendMode::Ssh => {
                    live.push((
                        Field::SshHost,
                        add.ssh.host_value.clone(),
                        add.ssh.host_placeholder.clone(),
                        false,
                    ));
                    live.push((
                        Field::SshUsername,
                        add.ssh.username_value.clone(),
                        add.ssh.username_placeholder.clone(),
                        false,
                    ));
                    live.push((
                        Field::SshPort,
                        add.ssh.port_value.clone(),
                        add.ssh.port_placeholder.clone(),
                        false,
                    ));
                }
            }
        }
        let keys: HashSet<&'static str> = live.iter().map(|(field, ..)| field.key()).collect();
        self.fields.retain(|key, _| keys.contains(key));
        for (field, value, placeholder, focus) in live {
            self.sync_field(field, value, placeholder, focus, window, cx);
        }
        self.sync_reveal(view, managed, window, cx);
        if !(view.ssh_suggestions_open && add.ssh.suggestions.has_content) {
            self.highlight = None;
        } else if let Some(index) = self.highlight
            && index >= add.ssh.suggestions.items.len()
        {
            self.highlight = None;
        }
    }

    fn sync_field(
        &mut self,
        field: Field,
        value: String,
        placeholder: String,
        focus: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let key = field.key();
        if let Some(input) = self.fields.get_mut(key) {
            if input.last_core == value {
                return;
            }
            input.last_core = value.clone();
            if let Some(position) = input.pending.iter().position(|sent| *sent == value) {
                input.pending.drain(..=position);
                return;
            }
            input.pending.clear();
            if input.state.read(cx).value().as_ref() != value.as_str() {
                input
                    .state
                    .update(cx, |state, cx| state.set_value(value, window, cx));
            }
            return;
        }
        let state = cx.new(|cx| {
            let mut state = InputState::new(window, cx).placeholder(placeholder);
            state.set_value(value.clone(), window, cx);
            state
        });
        let client = self.client.clone();
        cx.subscribe_in(
            &state,
            window,
            move |section: &mut Self, state, event: &InputEvent, _, cx| match event {
                InputEvent::Change => {
                    let next = state.read(cx).value().to_string();
                    let Some(input) = section.fields.get_mut(key) else {
                        return;
                    };
                    if input.pending.last() == Some(&next)
                        || (input.pending.is_empty() && input.last_core == next)
                    {
                        return;
                    }
                    input.pending.push(next.clone());
                    field.send(&client, next, cx);
                }
                InputEvent::PressEnter { .. } => {
                    if matches!(field, Field::SshUsername | Field::SshPort | Field::SshHost) {
                        section.submit_ssh(field, cx);
                    }
                }
                _ => {}
            },
        )
        .detach();
        if focus {
            state.update(cx, |state, cx| state.focus(window, cx));
        }
        self.fields.insert(
            key,
            FieldInput {
                state,
                pending: Vec::new(),
                last_core: value,
            },
        );
    }

    fn submit_ssh(&mut self, field: Field, cx: &mut Context<Self>) {
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return;
        };
        let ssh = &view.model.remote_environments.add_environment_dialog.ssh;
        if matches!(field, Field::SshHost)
            && view.ssh_suggestions_open
            && ssh.suggestions.has_content
            && let Some(index) = self.highlight
        {
            if let Some(item) = ssh.suggestions.items.get(index) {
                act(
                    &self.client,
                    cx,
                    "connectionsAddSelectHost",
                    json!({ "alias": item.alias }),
                );
            }
            return;
        }
        let host = self
            .fields
            .get(Field::SshHost.key())
            .map(|input| input.state.read(cx).value().to_string())
            .unwrap_or_default();
        if !host.trim().is_empty() {
            act(&self.client, cx, "connectionsAddSubmit", json!({}));
        }
    }

    fn sync_reveal(
        &mut self,
        view: &SettingsConnectionsView,
        managed: Option<&ManagedPrimary>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let target = view.reveal_pairing_link_id.as_ref().and_then(|id| {
            managed
                .and_then(|managed| managed.authorized_clients.as_ref())
                .and_then(|clients| clients.pairing_links.iter().find(|row| &row.id == id))
                .filter(|row| row.reveal.available)
        });
        let Some(row) = target else {
            self.reveal = None;
            return;
        };
        if let Some(reveal) = &self.reveal
            && reveal.id == row.id
            && reveal.value == row.reveal.value
        {
            return;
        }
        let rows = row.reveal.rows.max(1) as usize;
        let value = row.reveal.value.clone();
        let state = cx.new(|cx| {
            let mut state = TextareaState::new(window, cx).rows(rows);
            state.set_value(value.clone(), window, cx);
            state
        });
        let locked = value.clone();
        cx.subscribe_in(
            &state,
            window,
            move |_: &mut Self, state, event: &InputEvent, window, cx| {
                if let InputEvent::Change = event
                    && state.read(cx).value().as_ref() != locked.as_str()
                {
                    let locked = locked.clone();
                    state.update(cx, |state, cx| state.set_value(locked, window, cx));
                }
            },
        )
        .detach();
        self.reveal = Some(Reveal {
            id: row.id.clone(),
            value,
            state,
        });
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

    fn close_menu(entity: &Entity<Self>, cx: &mut App) {
        entity.update(cx, |section, cx| {
            section.menu = None;
            section.sub_open = false;
            section.sub_popup = None;
            cx.notify();
        });
    }

    fn menu_trigger(
        &self,
        key: String,
        aria_label: &str,
        disabled: bool,
        cx: &Context<Self>,
    ) -> AnyElement {
        let entity = cx.entity();
        let toggle_key = key.clone();
        let t = theme::active(cx);
        div()
            .relative()
            .flex_none()
            .child(
                Button::new(SharedString::from(format!("connections-menu-{key}")))
                    .size(ButtonSize::IconXs)
                    .variant(ButtonVariant::GhostMuted)
                    .icon("ellipsis")
                    .icon_size(14.)
                    .icon_color(t.muted_foreground)
                    .disabled(disabled)
                    .accessibility_label(aria_label.to_string())
                    .on_click(move |_, _, cx| {
                        entity.update(cx, |section, cx| {
                            let open = section.menu.as_deref() != Some(toggle_key.as_str());
                            section.menu = open.then(|| toggle_key.clone());
                            section.sub_open = false;
                            section.sub_popup = None;
                            cx.notify();
                        })
                    }),
            )
            .child(self.measure(key, cx))
            .into_any_element()
    }

    fn icon_sub_trigger(&self, menu: &EnvironmentIconMenu, cx: &Context<Self>) -> AnyElement {
        let entity = cx.entity();
        let t = theme::active(cx);
        div()
            .relative()
            .child(
                MenuSubTrigger::new("connections-icon-sub-trigger", menu.label.clone())
                    .leading(div().flex_none().opacity(0.8).child(icon(
                        machine_icon(menu.icon),
                        16.,
                        t.muted_foreground,
                    )))
                    .open(self.sub_open)
                    .on_hover(move |hovered, _, cx| {
                        if *hovered {
                            entity.update(cx, |section, cx| {
                                if !section.sub_open {
                                    section.sub_open = true;
                                    cx.notify();
                                }
                            });
                        }
                    }),
            )
            .child(self.measure(ICON_SUB.to_string(), cx))
            .into_any_element()
    }

    fn plain_menu_row(&self, id: &str, row: impl IntoElement, cx: &Context<Self>) -> AnyElement {
        let entity = cx.entity();
        div()
            .id(SharedString::from(id.to_string()))
            .on_hover(move |hovered, _, cx| {
                if *hovered {
                    entity.update(cx, |section, cx| {
                        if section.sub_open {
                            section.sub_open = false;
                            section.sub_popup = None;
                            cx.notify();
                        }
                    });
                }
            })
            .child(row)
            .into_any_element()
    }

    fn icon_sub_popup(
        &self,
        environment_id: &str,
        menu: &EnvironmentIconMenu,
        cx: &Context<Self>,
    ) -> Option<AnyElement> {
        if !self.sub_open {
            return None;
        }
        let t = theme::active(cx);
        let trigger = self.bounds.get(ICON_SUB).copied().unwrap_or_default();
        let entity = cx.entity();
        let measure = cx.entity();
        let mut children: Vec<AnyElement> = Vec::new();
        if let Some(lock) = &menu.lock {
            children.push(
                MenuItem::new("connections-icon-lock")
                    .disabled(true)
                    .child(div().whitespace_normal().child(lock.clone()))
                    .into_any_element(),
            );
            children.push(MenuSeparator::new().into_any_element());
        }
        for option in &menu.options {
            let client = self.client.clone();
            let entity = entity.clone();
            let environment_id = environment_id.to_string();
            let value = option.value.clone();
            children.push(
                MenuRadioItem::new(SharedString::from(format!(
                    "connections-icon-{}",
                    option.value
                )))
                .indicator(true)
                .checked(option.value == menu.value)
                .disabled(option.disabled)
                .on_click(move |_, _, cx| {
                    act(
                        &client,
                        cx,
                        "connectionsSetIcon",
                        json!({ "environmentId": environment_id, "value": value }),
                    );
                    Self::close_menu(&entity, cx);
                })
                .child(icon(machine_icon(option.icon), 14., t.foreground))
                .child(
                    div()
                        .min_w_0()
                        .flex_1()
                        .truncate()
                        .child(option.label.clone()),
                )
                .children(option.badge.clone().map(|badge| {
                    div()
                        .flex_none()
                        .text_size(px(text::XS))
                        .text_color(t.muted_foreground)
                        .child(badge)
                }))
                .into_any_element(),
            );
        }
        Some(
            MenuPopup::sub("connections-icon-sub-popup", trigger)
                .children(children)
                .child(
                    canvas(
                        move |bounds, _, cx| {
                            measure.update(cx, |section, _| section.sub_popup = Some(bounds))
                        },
                        |_, _, _, _| {},
                    )
                    .absolute()
                    .size_full(),
                )
                .into_any_element(),
        )
    }

    fn menu_popup(
        &self,
        key: &str,
        environment_id: &str,
        icon_menu: &EnvironmentIconMenu,
        extra: Vec<AnyElement>,
        cx: &Context<Self>,
    ) -> Option<AnyElement> {
        if self.menu.as_deref() != Some(key) {
            return None;
        }
        let trigger = self.bounds.get(key).copied().unwrap_or_default();
        let entity = cx.entity();
        let escape = cx.entity();
        let sub_popup = self.sub_popup;
        let row = div()
            .flex()
            .flex_col()
            .child(self.icon_sub_trigger(icon_menu, cx))
            .children(self.icon_sub_popup(environment_id, icon_menu, cx))
            .into_any_element();
        Some(
            MenuPopup::new(
                SharedString::from(format!("connections-menu-popup-{key}")),
                trigger,
            )
            .align(Align::End)
            .on_dismiss(move |window, cx| {
                let pointer = window.mouse_position();
                if trigger.contains(&pointer)
                    || sub_popup.is_some_and(|bounds| bounds.contains(&pointer))
                {
                    return;
                }
                Self::close_menu(&entity, cx);
            })
            .child(
                div()
                    .flex()
                    .flex_col()
                    .on_key_down(move |event: &KeyDownEvent, _, cx| {
                        if event.keystroke.key == "escape" {
                            cx.stop_propagation();
                            Self::close_menu(&escape, cx);
                        }
                    })
                    .child(row)
                    .children(extra),
            )
            .into_any_element(),
        )
    }

    fn row_menu_items(&self, row: &SavedBackendRow, cx: &Context<Self>) -> Vec<AnyElement> {
        let mut items = Vec::new();
        let entity = cx.entity();
        if let Some(copy) = &row.menu.copy_trace_id {
            let client = self.client.clone();
            let entity = entity.clone();
            let environment_id = row.id.clone();
            items.push(
                self.plain_menu_row(
                    &format!("connections-trace-{}", row.id),
                    MenuItem::new(SharedString::from(format!(
                        "connections-trace-item-{}",
                        row.id
                    )))
                    .label(copy.label.clone())
                    .on_click(move |_, _, cx| {
                        act(
                            &client,
                            cx,
                            "connectionsCopyTraceId",
                            json!({ "environmentId": environment_id }),
                        );
                        Self::close_menu(&entity, cx);
                    }),
                    cx,
                ),
            );
        }
        items.push(MenuSeparator::new().into_any_element());
        let client = self.client.clone();
        let environment_id = row.id.clone();
        items.push(
            self.plain_menu_row(
                &format!("connections-remove-{}", row.id),
                MenuItem::new(SharedString::from(format!(
                    "connections-remove-item-{}",
                    row.id
                )))
                .variant(MenuItemVariant::Destructive)
                .label(row.menu.remove_label.clone())
                .on_click(move |_, _, cx| {
                    Self::close_menu(&entity, cx);
                    act(
                        &client,
                        cx,
                        "connectionsRemove",
                        json!({ "environmentId": environment_id }),
                    );
                }),
                cx,
            ),
        );
        items
    }

    fn local_environment_row(&self, local: &LocalEnvironmentSetting) -> AnyElement {
        let client = self.client.clone();
        SettingsRow::new(local.id.clone(), local.title.clone())
            .description(local.description.clone())
            .control(
                settings_switch("connections-local-environment", local.switch.checked)
                    .disabled(local.switch.disabled)
                    .accessibility_label(local.switch.aria_label.clone())
                    .on_change(move |_, _, _, cx| {
                        act(
                            &client,
                            cx,
                            "connectionsLocalEnvironment",
                            json!({ "intent": { "kind": "toggle" } }),
                        )
                    }),
            )
            .into_any_element()
    }

    fn local_environment_dialog(
        &self,
        local: &LocalEnvironmentSetting,
        t: &Tokens,
    ) -> Option<AnyElement> {
        let dialog = &local.dialog;
        if !dialog.open {
            return None;
        }
        let close = json!({ "intent": { "kind": "dialog-open-change", "open": false } });
        let dismiss = self.client.clone();
        let dismiss_params = close.clone();
        Some(
            AlertDialogPopup::new("connections-local-environment-dialog")
                .on_dismiss(move |_, cx| {
                    act(
                        &dismiss,
                        cx,
                        "connectionsLocalEnvironment",
                        dismiss_params.clone(),
                    )
                })
                .child(
                    AlertDialogHeader::new()
                        .child(AlertDialogTitle::new(dialog.title.clone()))
                        .child(AlertDialogDescription::new(dialog.description.clone())),
                )
                .children(dialog.error.clone().map(|error| {
                    div()
                        .px(px(24.))
                        .pb(px(16.))
                        .text_size(px(text::SM))
                        .line_height(px(text::SM_LINE))
                        .text_color(t.destructive)
                        .child(error)
                }))
                .child(
                    AlertDialogFooter::new()
                        .child(
                            Button::new("connections-local-environment-cancel")
                                .variant(ButtonVariant::Outline)
                                .disabled(dialog.cancel_disabled)
                                .label(dialog.cancel_label.clone())
                                .on_click(on_click(
                                    &self.client,
                                    "connectionsLocalEnvironment",
                                    close,
                                )),
                        )
                        .child(
                            busy_button(
                                "connections-local-environment-confirm",
                                &dialog.confirm.label,
                                dialog.confirm.busy,
                            )
                            .variant(variant(dialog.confirm.variant))
                            .disabled(dialog.confirm.disabled)
                            .on_click(on_click(
                                &self.client,
                                "connectionsLocalEnvironment",
                                json!({ "intent": { "kind": "confirm" } }),
                            )),
                        ),
                )
                .into_any_element(),
        )
    }

    fn version_row(
        &self,
        view: &SettingsConnectionsView,
        managed: &ManagedPrimary,
        t: &Tokens,
    ) -> Option<AnyElement> {
        let version = managed.version.as_ref()?;
        let mut row = SettingsRow::new("connections-version", version.title.clone());
        match &version.description {
            VersionDescription::Progress => {
                if let Some(progress) = &view.primary_progress {
                    row = row.description_element(update_progress("primary-update", progress, t));
                }
            }
            VersionDescription::Text { text } => row = row.description(text.clone()),
        }
        match (&version.control, &view.primary_update) {
            (Some(VersionControl::Update { .. }), Some(update)) => {
                row = row.control(self.update_control(update, ButtonSize::Sm, t));
            }
            (Some(VersionControl::UpToDate { text }), _) => {
                row = row.control(xs(t.muted_foreground, text.clone()));
            }
            _ => {}
        }
        Some(row.into_any_element())
    }

    fn update_control(
        &self,
        update: &ServerUpdateControl,
        size: ButtonSize,
        t: &Tokens,
    ) -> AnyElement {
        match &update.action {
            ServerUpdateAction::DesktopAppRequired { text } => {
                xs(t.muted_foreground, text.clone()).into_any_element()
            }
            ServerUpdateAction::Action { label } => Button::new(SharedString::from(format!(
                "connections-update-{}",
                update.environment_id
            )))
            .size(size)
            .variant(ButtonVariant::Outline)
            .label(label.clone())
            .on_click(on_click(
                &self.client,
                "connectionsServerUpdate",
                json!({ "environmentId": update.environment_id }),
            ))
            .into_any_element(),
        }
    }

    fn update_icon(&self, update: &ServerUpdateControl, t: &Tokens) -> AnyElement {
        match &update.action {
            ServerUpdateAction::DesktopAppRequired { text } => {
                xs(t.muted_foreground, text.clone()).into_any_element()
            }
            ServerUpdateAction::Action { label } => with_tooltip(
                format!("connections-update-icon-tip-{}", update.environment_id),
                label,
                Button::new(SharedString::from(format!(
                    "connections-update-icon-{}",
                    update.environment_id
                )))
                .size(ButtonSize::IconXs)
                .variant(ButtonVariant::GhostMuted)
                .icon("circle-arrow-up")
                .icon_size(14.)
                .accessibility_label(label.clone())
                .on_click(on_click(
                    &self.client,
                    "connectionsServerUpdate",
                    json!({ "environmentId": update.environment_id }),
                )),
            ),
        }
    }

    fn network_access_row(&self, row: &NetworkAccessRow, t: &Tokens) -> AnyElement {
        match row {
            NetworkAccessRow::Toggle {
                id,
                title,
                description,
                status,
                switch,
            } => {
                let client = self.client.clone();
                let description = match description {
                    NetworkAccessDescription::Text { text } => div().child(text.clone()),
                    NetworkAccessDescription::Endpoint {
                        prefix,
                        url,
                        expandable,
                        toggle_label,
                    } => {
                        let summary = |color: Rgba| {
                            div()
                                .flex()
                                .min_w_0()
                                .items_baseline()
                                .gap(px(8.))
                                .child(div().min_w_0().truncate().child(url.clone()))
                                .children(toggle_label.clone().map(|label| {
                                    div()
                                        .flex_none()
                                        .text_size(px(text::XS))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(color)
                                        .child(label)
                                }))
                        };
                        let body = if *expandable {
                            let hover = t.foreground;
                            summary(t.muted_foreground)
                                .id("connections-endpoint-toggle")
                                .cursor_pointer()
                                .border_b_1()
                                .border_dashed()
                                .border_color(fade(t.muted_foreground, 0.6))
                                .text_color(t.muted_foreground)
                                .hover(move |s| s.border_color(hover).text_color(hover))
                                .on_click(on_click(
                                    &self.client,
                                    "connectionsToggleEndpointList",
                                    json!({}),
                                ))
                                .into_any_element()
                        } else {
                            summary(t.muted_foreground).into_any_element()
                        };
                        div()
                            .flex()
                            .min_w_0()
                            .max_w_full()
                            .items_baseline()
                            .gap(px(4.))
                            .child(div().flex_none().child(prefix.clone()))
                            .child(body)
                    }
                };
                SettingsRow::new(id.clone(), title.clone())
                    .description_element(description)
                    .when_some(status.clone(), |row, status| {
                        row.status(div().text_color(t.destructive).child(status))
                    })
                    .control(
                        settings_switch("connections-network-access", switch.checked)
                            .disabled(switch.disabled)
                            .accessibility_label(switch.aria_label.clone())
                            .on_change(move |checked, _, _, cx| {
                                act(
                                    &client,
                                    cx,
                                    "connectionsNetworkToggle",
                                    json!({ "checked": checked }),
                                )
                            }),
                    )
                    .into_any_element()
            }
            NetworkAccessRow::Locked {
                id,
                title,
                description,
                switch,
                tooltip,
            } => SettingsRow::new(id.clone(), title.clone())
                .description(description.clone())
                .control(with_tooltip(
                    "connections-network-locked-tip",
                    tooltip,
                    settings_switch("connections-network-locked", switch.checked)
                        .disabled(switch.disabled)
                        .accessibility_label(switch.aria_label.clone()),
                ))
                .into_any_element(),
        }
    }

    fn endpoint_row(&self, row: &AdvertisedEndpointRow, t: &Tokens) -> AnyElement {
        let badge = |label: String, border: Rgba, bg: Option<Rgba>, color: Rgba| {
            div()
                .flex_none()
                .rounded(px(radius::SM))
                .border_1()
                .border_color(border)
                .when_some(bg, |this, bg| this.bg(bg))
                .px(px(4.))
                .py(px(2.))
                .text_size(px(TEXT_3XS))
                .line_height(px(TEXT_3XS_LINE))
                .text_color(color)
                .child(label)
        };
        div()
            .relative()
            .px(px(ROW_PADDING_X))
            .py(px(ROW_PADDING_Y))
            .when(!row.available, |this| {
                this.bg(fade(t.muted, UNAVAILABLE_ENDPOINT_FILL))
            })
            .when(row.is_default, |this| {
                this.child(
                    div()
                        .absolute()
                        .top(px(8.))
                        .bottom(px(8.))
                        .left_0()
                        .w(px(RAIL_WIDTH))
                        .rounded_r_full()
                        .bg(t.primary),
                )
            })
            .child(
                div()
                    .flex()
                    .min_h(px(24.))
                    .min_w_0()
                    .items_center()
                    .gap(px(8.))
                    .child(
                        div()
                            .flex()
                            .min_w_0()
                            .items_baseline()
                            .gap(px(12.))
                            .child(
                                div()
                                    .flex_none()
                                    .text_size(px(text::SM))
                                    .line_height(px(text::SM_LINE))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(t.foreground)
                                    .child(row.label.clone()),
                            )
                            .when(row.show_url, |this| {
                                this.child(
                                    div()
                                        .id(SharedString::from(format!(
                                            "connections-endpoint-url-{}",
                                            row.id
                                        )))
                                        .min_w_0()
                                        .truncate()
                                        .text_size(px(text::XS))
                                        .line_height(px(text::SM_LINE))
                                        .text_color(t.muted_foreground)
                                        .tooltip(Tooltip::text(row.url.clone()))
                                        .child(row.url.clone()),
                                )
                            })
                            .children(row.setup_required_label.clone().map(|label| {
                                badge(label, fade(t.border, 0.7), None, t.muted_foreground)
                            })),
                    )
                    .child(
                        div()
                            .ml_auto()
                            .flex()
                            .flex_none()
                            .min_h(px(24.))
                            .items_center()
                            .justify_end()
                            .gap(px(8.))
                            .children(row.default_badge_label.clone().map(|label| {
                                badge(
                                    label,
                                    fade(t.primary, 0.3),
                                    Some(fade(t.primary, 0.1)),
                                    t.primary,
                                )
                            }))
                            .children(row.setup_action.as_ref().map(|action| {
                                Button::new(SharedString::from(format!(
                                    "connections-endpoint-setup-{}",
                                    row.id
                                )))
                                .size(ButtonSize::Xs)
                                .variant(ButtonVariant::Outline)
                                .disabled(action.disabled)
                                .label(action.label.clone())
                                .on_click(on_click(
                                    &self.client,
                                    "connectionsTailscaleSetup",
                                    json!({ "endpointId": row.id }),
                                ))
                            }))
                            .children(row.disable_action.as_ref().map(|action| {
                                Button::new(SharedString::from(format!(
                                    "connections-endpoint-disable-{}",
                                    row.id
                                )))
                                .size(ButtonSize::Xs)
                                .variant(ButtonVariant::DestructiveOutline)
                                .disabled(action.disabled)
                                .label(action.label.clone())
                                .on_click(on_click(
                                    &self.client,
                                    "connectionsTailscaleDisable",
                                    json!({}),
                                ))
                            }))
                            .children(row.set_default_label.clone().map(|label| {
                                Button::new(SharedString::from(format!(
                                    "connections-endpoint-default-{}",
                                    row.id
                                )))
                                .size(ButtonSize::Xs)
                                .variant(ButtonVariant::Outline)
                                .label(label)
                                .on_click(on_click(
                                    &self.client,
                                    "connectionsSetDefaultEndpoint",
                                    json!({ "endpointId": row.id }),
                                ))
                            })),
                    ),
            )
            .into_any_element()
    }

    fn wsl_rows(&self, wsl: &WslSettings, t: &Tokens) -> Vec<AnyElement> {
        let error_status = |error: &Option<String>| {
            error
                .clone()
                .map(|error| div().text_color(t.destructive).child(error))
        };
        match wsl {
            WslSettings::Hidden => Vec::new(),
            WslSettings::LoadError {
                id,
                title,
                description,
                error,
                retry,
            } => vec![
                SettingsRow::new(id.clone(), title.clone())
                    .description(description.clone())
                    .when_some(error_status(error), |row, status| row.status(status))
                    .control(
                        settings_button("connections-wsl-retry", retry.label.clone())
                            .disabled(retry.disabled)
                            .on_click(on_click(&self.client, "connectionsWslRetry", json!({}))),
                    )
                    .into_any_element(),
            ],
            WslSettings::Unavailable {
                id,
                title,
                description,
                error,
                switch_to_windows,
            } => vec![
                SettingsRow::new(id.clone(), title.clone())
                    .description(description.clone())
                    .when_some(error_status(error), |row, status| row.status(status))
                    .control(
                        settings_button(
                            "connections-wsl-switch-windows",
                            switch_to_windows.label.clone(),
                        )
                        .disabled(switch_to_windows.disabled)
                        .on_click(on_click(
                            &self.client,
                            "connectionsWslSwitchToWindows",
                            json!({}),
                        )),
                    )
                    .into_any_element(),
            ],
            WslSettings::Picker {
                id,
                title,
                description,
                status,
                select,
                wsl_only,
            } => {
                let client = self.client.clone();
                let mut rows = vec![
                    SettingsRow::new(id.clone(), title.clone())
                        .description(description.clone())
                        .when_some(error_status(status), |row, status| row.status(status))
                        .control(
                            SettingsSelect::new("connections-wsl-select")
                                .width(SettingsControlWidth::Fixed(WSL_SELECT_WIDTH))
                                .options(select.options.iter().map(|option| {
                                    SettingsSelectOption::new(
                                        option.value.clone(),
                                        option.label.clone(),
                                    )
                                }))
                                .value(Some(select.value.clone()))
                                .value_label(select.label.clone())
                                .disabled(select.disabled)
                                .accessibility_label(select.aria_label.clone())
                                .on_change(move |value, _, cx| {
                                    act(
                                        &client,
                                        cx,
                                        "connectionsWslSelect",
                                        json!({ "value": value.to_string() }),
                                    )
                                }),
                        )
                        .into_any_element(),
                ];
                if let Some(only) = wsl_only {
                    let client = self.client.clone();
                    rows.push(
                        div()
                            .pl(px(WSL_ONLY_INDENT))
                            .bg(fade(t.muted, WSL_ONLY_FILL))
                            .child(
                                SettingsRow::new("connections-wsl-only", only.title.clone())
                                    .description(only.description.clone())
                                    .control(
                                        settings_switch(
                                            "connections-wsl-only-switch",
                                            only.switch.checked,
                                        )
                                        .disabled(only.switch.disabled)
                                        .accessibility_label(only.switch.aria_label.clone())
                                        .on_change(
                                            move |checked, _, _, cx| {
                                                act(
                                                    &client,
                                                    cx,
                                                    "connectionsWslOnly",
                                                    json!({ "checked": checked }),
                                                )
                                            },
                                        ),
                                    ),
                            )
                            .into_any_element(),
                    );
                }
                rows
            }
        }
    }

    fn primary_section(
        &self,
        view: &SettingsConnectionsView,
        managed: &ManagedPrimary,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> AnyElement {
        let header = &managed.header;
        let mut section = SettingsSection::new(header.title.clone())
            .id(header.id.clone())
            .icon(icon(machine_icon(header.icon_kind), 16., t.foreground));
        if let (Some(_), Some(label)) = (&view.primary_environment_id, &header.menu_aria_label) {
            section = section.header_action(self.menu_trigger(
                PRIMARY_MENU.to_string(),
                label,
                false,
                cx,
            ));
        }
        let client = self.client.clone();
        section
            .children(
                view.local_environment
                    .as_ref()
                    .map(|local| self.local_environment_row(local)),
            )
            .children(self.version_row(view, managed, t))
            .children(
                managed
                    .network_access
                    .as_ref()
                    .map(|row| self.network_access_row(row, t)),
            )
            .children(
                managed
                    .endpoint_rows
                    .iter()
                    .map(|row| self.endpoint_row(row, t)),
            )
            .children(managed.tailscale.as_ref().map(|row| {
                SettingsRow::new(row.id.clone(), row.title.clone())
                    .description(row.description.clone())
                    .when_some(row.switch.as_ref(), |this, switch| {
                        let client = client.clone();
                        this.control(
                            settings_switch("connections-tailscale", switch.checked)
                                .disabled(switch.disabled)
                                .accessibility_label(switch.aria_label.clone())
                                .on_change(move |checked, _, _, cx| {
                                    act(
                                        &client,
                                        cx,
                                        "connectionsTailscaleToggle",
                                        json!({ "checked": checked }),
                                    )
                                }),
                        )
                    })
                    .into_any_element()
            }))
            .children(
                managed
                    .wsl
                    .as_ref()
                    .map(|wsl| self.wsl_rows(wsl, t))
                    .unwrap_or_default(),
            )
            .into_any_element()
    }

    fn scope_summary(
        &self,
        id: String,
        summary: &crate::app_core::views::settings_connections::AccessScopeSummary,
        t: &Tokens,
    ) -> AnyElement {
        let tooltip = std::iter::once(summary.heading.clone())
            .chain(summary.scopes.iter().cloned())
            .collect::<Vec<_>>()
            .join("\n");
        let hover = t.foreground;
        div()
            .id(gpui::ElementId::Name(SharedString::from(id)))
            .cursor(gpui::CursorStyle::Arrow)
            .border_b_1()
            .border_color(t.border)
            .hover(move |s| s.text_color(hover))
            .tooltip(Tooltip::text(tooltip))
            .child(summary.count_label.clone())
            .into_any_element()
    }

    fn row_title(&self, title: &str, t: &Tokens) -> gpui::Div {
        div()
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .font_weight(FontWeight::MEDIUM)
            .text_color(t.foreground)
            .child(title.to_string())
    }

    fn access_row(&self, left: impl IntoElement, right: Vec<AnyElement>) -> gpui::Div {
        div().px(px(ROW_PADDING_X)).py(px(ROW_PADDING_Y)).child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap(px(ROW_GAP))
                .child(left)
                .child(
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .justify_end()
                        .gap(px(8.))
                        .children(right),
                ),
        )
    }

    fn pairing_link_row(&self, row: &PairingLinkRow, t: &Tokens) -> AnyElement {
        let id = row.id.clone();
        let left = div()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .gap(px(4.))
            .child(
                div()
                    .flex()
                    .min_h(px(20.))
                    .items_center()
                    .gap(px(6.))
                    .child(status_dot(
                        format!("connections-link-dot-{id}"),
                        &row.created_tooltip,
                        t.warning,
                        None,
                    ))
                    .child(self.row_title(&row.title, t)),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.muted_foreground)
                    .child(
                        div()
                            .id(SharedString::from(format!("connections-link-expires-{id}")))
                            .tooltip(Tooltip::text(row.expires_tooltip.clone()))
                            .child(row.expires_label.clone()),
                    )
                    .child(div().child("\u{a0}·\u{a0}"))
                    .child(self.scope_summary(
                        format!("connections-link-scope-{id}"),
                        &row.scope_summary,
                        t,
                    )),
            )
            .children(row.hint.clone().map(|hint| {
                line(TEXT_2XS, text::XS_LINE, fade(t.muted_foreground, 0.7)).child(hint)
            }));
        let mut right: Vec<AnyElement> = Vec::new();
        if let Some(label) = &row.share_button_label {
            right.push(
                Button::new(SharedString::from(format!("connections-link-share-{id}")))
                    .size(ButtonSize::Xs)
                    .variant(ButtonVariant::Outline)
                    .icon("qr-code")
                    .label(label.clone())
                    .on_click(on_click(
                        &self.client,
                        "connectionsLinkQrToggle",
                        json!({ "id": id }),
                    ))
                    .into_any_element(),
            );
        }
        match row.code_action {
            Some(PairingCodeAction::CopyCode) => right.push(
                Button::new(SharedString::from(format!("connections-link-code-{id}")))
                    .size(ButtonSize::Xs)
                    .variant(ButtonVariant::Outline)
                    .label(row.code_action_label.clone())
                    .on_click(on_click(
                        &self.client,
                        "connectionsLinkCopy",
                        json!({ "id": id, "target": "code" }),
                    ))
                    .into_any_element(),
            ),
            Some(PairingCodeAction::ShowDialog) => right.push(
                Button::new(SharedString::from(format!("connections-link-code-{id}")))
                    .size(ButtonSize::Xs)
                    .variant(ButtonVariant::Outline)
                    .label(row.code_action_label.clone())
                    .on_click(on_click(
                        &self.client,
                        "connectionsLinkReveal",
                        json!({ "id": id }),
                    ))
                    .into_any_element(),
            ),
            None => {}
        }
        right.push(
            Button::new(SharedString::from(format!("connections-link-revoke-{id}")))
                .size(ButtonSize::Xs)
                .variant(ButtonVariant::DestructiveOutline)
                .disabled(row.revoke.disabled)
                .label(row.revoke.label.clone())
                .on_click(on_click(
                    &self.client,
                    "connectionsRevokeLink",
                    json!({ "id": id }),
                ))
                .into_any_element(),
        );
        self.access_row(left, right)
            .children(self.qr_panel(row, t))
            .into_any_element()
    }

    fn qr_panel(&self, row: &PairingLinkRow, t: &Tokens) -> Option<AnyElement> {
        let panel = &row.qr_panel;
        let url = panel.url.clone().filter(|_| panel.visible)?;
        let id = row.id.clone();
        let picker = panel.endpoint_picker_visible.then(|| {
            div()
                .flex()
                .flex_col()
                .gap(px(6.))
                .child(
                    line(TEXT_2XS, text::XS_LINE, fade(t.muted_foreground, 0.7))
                        .child(panel.endpoint_picker_label.clone()),
                )
                .children(row.endpoint_options.iter().map(|option| {
                    let hover = fade(t.muted, 0.2);
                    div()
                        .id(SharedString::from(format!(
                            "connections-link-endpoint-{id}-{}",
                            option.id
                        )))
                        .flex()
                        .w_full()
                        .items_baseline()
                        .gap(px(8.))
                        .rounded(px(radius::MD))
                        .border_1()
                        .px(px(10.))
                        .py(px(6.))
                        .cursor_pointer()
                        .map(|this| {
                            if option.selected {
                                this.border_color(fade(t.foreground, 0.6))
                                    .bg(fade(t.muted, 0.3))
                            } else {
                                this.border_color(fade(t.border, 0.5))
                                    .hover(move |s| s.bg(hover))
                            }
                        })
                        .on_click(on_click(
                            &self.client,
                            "connectionsLinkQrEndpoint",
                            json!({ "id": id, "endpointId": option.id }),
                        ))
                        .child(
                            div()
                                .flex_none()
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(if option.selected {
                                    t.foreground
                                } else {
                                    t.muted_foreground
                                })
                                .child(option.label.clone()),
                        )
                        .child(
                            line(TEXT_2XS, text::XS_LINE, fade(t.muted_foreground, 0.7))
                                .min_w_0()
                                .truncate()
                                .child(option.detail.clone()),
                        )
                }))
        });
        let link = div()
            .flex()
            .items_center()
            .gap(px(8.))
            .rounded(px(radius::MD))
            .border_1()
            .border_color(fade(t.border, 0.6))
            .bg(fade(t.muted, 0.3))
            .px(px(10.))
            .py(px(6.))
            .child(
                div()
                    .id(SharedString::from(format!("connections-link-url-{id}")))
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .font_family(MONO_FONT)
                    .text_size(px(TEXT_2XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.muted_foreground)
                    .tooltip(Tooltip::text(url.clone()))
                    .child(url.clone()),
            )
            .child(
                Button::new(SharedString::from(format!(
                    "connections-link-copy-url-{id}"
                )))
                .size(ButtonSize::Xs)
                .variant(ButtonVariant::Ghost)
                .label(panel.copy_link_label.clone())
                .on_click(on_click(
                    &self.client,
                    "connectionsLinkCopy",
                    json!({ "id": id, "target": "qr-url" }),
                )),
            );
        let qr = if panel.can_render_qr {
            qr_code(&url, QR_SIZE, QR_MARGIN).map(|code| {
                div()
                    .flex_none()
                    .rounded(px(radius::XL))
                    .bg(gpui::rgb(0xffffff))
                    .p(px(QR_PADDING))
                    .child(code)
                    .into_any_element()
            })
        } else {
            None
        };
        let qr = qr.unwrap_or_else(|| {
            div()
                .flex()
                .flex_none()
                .size(px(QR_FALLBACK))
                .items_center()
                .justify_center()
                .rounded(px(radius::XL))
                .border_1()
                .border_color(fade(t.border, 0.5))
                .p(px(16.))
                .child(
                    line(TEXT_2XS, text::XS_LINE, fade(t.muted_foreground, 0.7))
                        .text_center()
                        .child(panel.no_qr_message.clone()),
                )
                .into_any_element()
        });
        Some(
            div()
                .mt(px(12.))
                .pt(px(12.))
                .border_t_1()
                .border_color(fade(t.border, 0.5))
                .flex()
                .items_start()
                .justify_between()
                .gap(px(16.))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .gap(px(12.))
                        .children(picker)
                        .child(link)
                        .child(
                            div().flex().child(
                                Button::new(SharedString::from(format!(
                                    "connections-link-copy-code-{id}"
                                )))
                                .size(ButtonSize::Xs)
                                .variant(ButtonVariant::Ghost)
                                .label(panel.copy_code_label.clone())
                                .on_click(on_click(
                                    &self.client,
                                    "connectionsLinkCopy",
                                    json!({ "id": id, "target": "code" }),
                                )),
                            ),
                        ),
                )
                .child(qr)
                .into_any_element(),
        )
    }

    fn client_row(&self, row: &ClientSessionRow, t: &Tokens) -> AnyElement {
        let id = row.id.clone();
        let (dot, ping) = if row.is_live {
            (t.success, Some(fade(t.success, 0.6)))
        } else {
            (fade(t.muted_foreground, 0.3), None)
        };
        let left = div()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .gap(px(4.))
            .child(
                div()
                    .flex()
                    .min_h(px(20.))
                    .items_center()
                    .gap(px(6.))
                    .child(status_dot(
                        format!("connections-client-dot-{id}"),
                        &row.status_tooltip,
                        dot,
                        ping,
                    ))
                    .child(self.row_title(&row.title, t))
                    .children(row.current_badge_label.clone().map(|label| {
                        div()
                            .rounded(px(radius::SM))
                            .border_1()
                            .border_color(fade(t.border, 0.5))
                            .bg(fade(t.muted, 0.5))
                            .px(px(4.))
                            .py(px(2.))
                            .text_size(px(TEXT_3XS))
                            .line_height(px(TEXT_3XS_LINE))
                            .text_color(fade(t.muted_foreground, 0.8))
                            .child(label)
                    })),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.muted_foreground)
                    .children(
                        row.device_info
                            .clone()
                            .map(|info| div().flex().child(info).child("\u{a0}·\u{a0}")),
                    )
                    .child(self.scope_summary(
                        format!("connections-client-scope-{id}"),
                        &row.scope_summary,
                        t,
                    )),
            );
        let right = row
            .revoke
            .as_ref()
            .map(|revoke| {
                Button::new(SharedString::from(format!(
                    "connections-client-revoke-{id}"
                )))
                .size(ButtonSize::Xs)
                .variant(ButtonVariant::DestructiveOutline)
                .disabled(revoke.disabled)
                .label(revoke.label.clone())
                .on_click(on_click(
                    &self.client,
                    "connectionsRevokeClient",
                    json!({ "id": id }),
                ))
                .into_any_element()
            })
            .into_iter()
            .collect();
        self.access_row(left, right).into_any_element()
    }

    fn authorized_clients(&self, clients: &AuthorizedClients, t: &Tokens) -> AnyElement {
        let header = &clients.header;
        let control = div()
            .flex()
            .items_center()
            .gap(px(8.))
            .child(
                Button::new("connections-revoke-others")
                    .size(ButtonSize::Xs)
                    .variant(ButtonVariant::DestructiveOutline)
                    .disabled(header.revoke_others.disabled)
                    .label(header.revoke_others.label.clone())
                    .on_click(on_click(&self.client, "connectionsRevokeOthers", json!({}))),
            )
            .child(
                Button::new("connections-create-link")
                    .size(ButtonSize::Xs)
                    .variant(ButtonVariant::Default)
                    .icon("plus")
                    .icon_size(12.)
                    .label(header.create_label.clone())
                    .on_click(on_click(
                        &self.client,
                        "connectionsCreateLinkOpen",
                        json!({ "open": true }),
                    )),
            );
        let body = div()
            .id("connections-authorized-clients-scroll")
            .flex()
            .flex_col()
            .max_h(px(AUTHORIZED_CLIENTS_MAX_HEIGHT))
            .overflow_y_scroll()
            .children(clients.error.clone().map(|error| {
                div()
                    .px(px(ROW_PADDING_X))
                    .py(px(ROW_PADDING_Y))
                    .child(xs(t.destructive, error))
            }))
            .children(
                clients
                    .pairing_links
                    .iter()
                    .map(|row| self.pairing_link_row(row, t)),
            )
            .children(
                clients
                    .client_sessions
                    .iter()
                    .map(|row| self.client_row(row, t)),
            )
            .children(clients.empty_message.clone().map(|message| {
                div()
                    .px(px(ROW_PADDING_X))
                    .py(px(ROW_PADDING_Y))
                    .child(xs(fade(t.muted_foreground, 0.6), message))
            }));
        FoldedSettingsSection::new(clients.id.clone(), clients.title.clone())
            .summary(Some(clients.summary.clone()))
            .control(control)
            .child(body)
            .into_any_element()
    }

    fn create_link_dialog(&self, dialog: &CreatePairingLinkDialog, t: &Tokens) -> AnyElement {
        let close = json!({ "open": false });
        let dismiss = self.client.clone();
        let label = self.fields.get(Field::PairingLabel.key()).map(|input| {
            Input::new(&input.state)
                .disabled(dialog.label_field.disabled)
                .w_full()
        });
        let validation = dialog.validation.as_ref().map(|validation| {
            xs(
                match validation.tone {
                    ValidationTone::Error => t.destructive,
                    ValidationTone::Warning => t.warning,
                },
                validation.message.clone(),
            )
        });
        DialogPopup::new("connections-create-link-dialog")
            .max_width(SMALL_DIALOG_WIDTH)
            .show_close_button(true)
            .on_close(move |_, cx| {
                act(
                    &dismiss,
                    cx,
                    "connectionsCreateLinkOpen",
                    json!({ "open": false }),
                )
            })
            .child(
                DialogHeader::new()
                    .with_panel(true)
                    .child(DialogTitle::new(dialog.title.clone()))
                    .child(DialogDescription::new(dialog.description.clone())),
            )
            .child(
                DialogPanel::new("connections-create-link-panel")
                    .after_header(true)
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .child(
                                div()
                                    .mb(px(6.))
                                    .text_size(px(text::XS))
                                    .line_height(px(text::XS_LINE))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(t.foreground)
                                    .child(dialog.label_field.label.clone()),
                            )
                            .children(label),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(12.))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .gap(px(12.))
                                    .child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .child(
                                                div()
                                                    .text_size(px(text::XS))
                                                    .line_height(px(text::XS_LINE))
                                                    .font_weight(FontWeight::MEDIUM)
                                                    .text_color(t.foreground)
                                                    .child(dialog.permissions_title.clone()),
                                            )
                                            .child(xs(
                                                t.muted_foreground,
                                                dialog.permissions_description.clone(),
                                            )),
                                    )
                                    .child(div().flex().flex_none().gap(px(4.)).children(
                                        dialog.presets.iter().map(|preset| {
                                            Button::new(SharedString::from(format!(
                                                "connections-preset-{}",
                                                preset.id
                                            )))
                                            .size(ButtonSize::Xs)
                                            .variant(ButtonVariant::Outline)
                                            .disabled(preset.disabled)
                                            .label(preset.label.clone())
                                            .on_click(on_click(
                                                &self.client,
                                                "connectionsCreateLinkPreset",
                                                json!({ "preset": preset.id }),
                                            ))
                                        }),
                                    )),
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .rounded(px(radius::MD))
                                    .border_1()
                                    .border_color(t.input)
                                    .bg(fade(t.muted, 0.25))
                                    .overflow_hidden()
                                    .children(dialog.scope_options.iter().enumerate().map(
                                        |(index, option)| {
                                            let hover = fade(t.muted, 0.4);
                                            let disabled = option.disabled;
                                            div()
                                                .id(SharedString::from(format!(
                                                    "connections-scope-{}",
                                                    option.scope
                                                )))
                                                .flex()
                                                .items_start()
                                                .gap(px(12.))
                                                .px(px(12.))
                                                .py(px(10.))
                                                .when(index > 0, |this| {
                                                    this.border_t_1()
                                                        .border_color(fade(t.border, 0.6))
                                                })
                                                .when(!disabled, |this| {
                                                    this.cursor_pointer()
                                                        .hover(move |s| s.bg(hover))
                                                        .on_click(on_click(
                                                            &self.client,
                                                            "connectionsCreateLinkScope",
                                                            json!({
                                                                "scope": option.scope,
                                                                "checked": !option.checked,
                                                            }),
                                                        ))
                                                })
                                                .child(
                                                    div().mt(px(2.)).flex_none().child(
                                                        Checkbox::new(SharedString::from(format!(
                                                            "connections-scope-check-{}",
                                                            option.scope
                                                        )))
                                                        .checked(option.checked)
                                                        .disabled(disabled),
                                                    ),
                                                )
                                                .child(
                                                    div()
                                                        .flex()
                                                        .flex_col()
                                                        .min_w_0()
                                                        .child(
                                                            div()
                                                                .text_size(px(text::XS))
                                                                .line_height(px(text::XS_LINE))
                                                                .font_weight(FontWeight::MEDIUM)
                                                                .text_color(t.foreground)
                                                                .child(option.title.clone()),
                                                        )
                                                        .child(
                                                            line(
                                                                text::XS,
                                                                text::XS * text::LEADING_SNUG,
                                                                t.muted_foreground,
                                                            )
                                                            .child(option.description.clone()),
                                                        ),
                                                )
                                        },
                                    )),
                            )
                            .children(validation),
                    ),
            )
            .child(
                DialogFooter::new()
                    .variant(DialogFooterVariant::Bare)
                    .child(
                        Button::new("connections-create-link-cancel")
                            .variant(ButtonVariant::Outline)
                            .disabled(dialog.cancel.disabled)
                            .label(dialog.cancel.label.clone())
                            .on_click(on_click(&self.client, "connectionsCreateLinkOpen", close)),
                    )
                    .child(
                        Button::new("connections-create-link-submit")
                            .disabled(dialog.create.disabled)
                            .label(dialog.create.label.clone())
                            .on_click(on_click(
                                &self.client,
                                "connectionsCreateLinkSubmit",
                                json!({}),
                            )),
                    ),
            )
            .into_any_element()
    }

    fn reveal_dialog(&self, row: &PairingLinkRow, t: &Tokens) -> Option<AnyElement> {
        let reveal = self.reveal.as_ref().filter(|reveal| reveal.id == row.id)?;
        let close = json!({ "id": null });
        let dismiss = self.client.clone();
        let qr = row
            .reveal
            .show_qr
            .then(|| qr_code(&row.reveal.value, REVEAL_QR_SIZE, REVEAL_QR_MARGIN))
            .flatten()
            .map(|code| {
                div()
                    .flex()
                    .justify_center()
                    .rounded(px(radius::XL))
                    .border_1()
                    .border_color(fade(t.border, 0.6))
                    .bg(fade(t.muted, 0.3))
                    .p(px(16.))
                    .child(code)
            });
        Some(
            DialogPopup::new("connections-reveal-dialog")
                .max_width(SMALL_DIALOG_WIDTH)
                .show_close_button(true)
                .on_close(move |_, cx| {
                    act(&dismiss, cx, "connectionsLinkReveal", json!({ "id": null }))
                })
                .child(
                    DialogHeader::new()
                        .with_panel(true)
                        .child(DialogTitle::new(row.reveal.title.clone()))
                        .child(DialogDescription::new(row.reveal.description.clone())),
                )
                .child(
                    DialogPanel::new("connections-reveal-panel")
                        .after_header(true)
                        .child(Textarea::new(&reveal.state).items_start())
                        .children(qr),
                )
                .child(
                    DialogFooter::new()
                        .variant(DialogFooterVariant::Bare)
                        .child(
                            Button::new("connections-reveal-done")
                                .variant(ButtonVariant::Outline)
                                .label(row.reveal.done_label.clone())
                                .on_click(on_click(&self.client, "connectionsLinkReveal", close)),
                        )
                        .children(row.reveal.copy_code_label.clone().map(|label| {
                            Button::new("connections-reveal-copy")
                                .variant(ButtonVariant::Outline)
                                .label(label)
                                .on_click(on_click(
                                    &self.client,
                                    "connectionsLinkCopy",
                                    json!({ "id": row.id, "target": "code" }),
                                ))
                        })),
                )
                .into_any_element(),
        )
    }

    fn alert_dialog(
        &self,
        id: &'static str,
        dialog: &DialogModel,
        cancel: &'static str,
        confirm: &'static str,
        dismiss_params: Value,
    ) -> Option<AnyElement> {
        if !dialog.open {
            return None;
        }
        let dismiss = self.client.clone();
        let cancel_disabled = dialog.cancel.disabled;
        let cancel_params = dismiss_params.clone();
        Some(
            AlertDialogPopup::new(id)
                .on_dismiss(move |_, cx| {
                    if !cancel_disabled {
                        act(&dismiss, cx, cancel, dismiss_params.clone())
                    }
                })
                .child(
                    AlertDialogHeader::new()
                        .child(AlertDialogTitle::new(dialog.title.clone()))
                        .child(AlertDialogDescription::new(dialog.description.clone())),
                )
                .child(
                    AlertDialogFooter::new()
                        .child(
                            Button::new(SharedString::from(format!("{id}-cancel")))
                                .variant(ButtonVariant::Outline)
                                .disabled(dialog.cancel.disabled)
                                .label(dialog.cancel.label.clone())
                                .on_click(on_click(&self.client, cancel, cancel_params)),
                        )
                        .child(
                            busy_button(
                                format!("{id}-confirm"),
                                &dialog.confirm.label,
                                dialog.confirm.busy,
                            )
                            .variant(variant(dialog.confirm_variant))
                            .disabled(dialog.confirm.disabled)
                            .on_click(on_click(
                                &self.client,
                                confirm,
                                json!({}),
                            )),
                        ),
                )
                .into_any_element(),
        )
    }

    fn wsl_dialog(&self, dialog: &WslConfirmDialog) -> Option<AnyElement> {
        if !dialog.open {
            return None;
        }
        let dismiss = self.client.clone();
        let cancel_disabled = dialog.cancel.disabled;
        Some(
            AlertDialogPopup::new("connections-wsl-dialog")
                .on_dismiss(move |_, cx| {
                    if !cancel_disabled {
                        act(&dismiss, cx, "connectionsWslCancel", json!({}))
                    }
                })
                .child(
                    AlertDialogHeader::new()
                        .child(AlertDialogTitle::new(dialog.title.clone()))
                        .child(AlertDialogDescription::new(dialog.description.clone())),
                )
                .child(
                    AlertDialogFooter::new()
                        .child(
                            Button::new("connections-wsl-dialog-cancel")
                                .variant(ButtonVariant::Outline)
                                .disabled(dialog.cancel.disabled)
                                .label(dialog.cancel.label.clone())
                                .on_click(on_click(
                                    &self.client,
                                    "connectionsWslCancel",
                                    json!({}),
                                )),
                        )
                        .children(dialog.actions.iter().map(|action| {
                            busy_button(
                                format!("connections-wsl-dialog-{}", action.id),
                                &action.label,
                                action.busy,
                            )
                            .variant(variant(action.variant))
                            .disabled(action.disabled)
                            .on_click(on_click(
                                &self.client,
                                "connectionsWslConfirm",
                                json!({ "actionId": action.id }),
                            ))
                        })),
                )
                .into_any_element(),
        )
    }

    fn tailscale_setup_dialog(
        &self,
        dialog: &TailscaleSetupDialog,
        t: &Tokens,
    ) -> Option<AnyElement> {
        if !dialog.open {
            return None;
        }
        let dismiss = self.client.clone();
        let cancel_disabled = dialog.cancel.disabled;
        let port = self.fields.get(Field::TailscalePort.key()).map(|input| {
            Input::new(&input.state)
                .disabled(dialog.port_disabled)
                .w_full()
        });
        Some(
            DialogPopup::new("connections-tailscale-setup")
                .max_width(SMALL_DIALOG_WIDTH)
                .show_close_button(true)
                .on_close(move |_, cx| {
                    if !cancel_disabled {
                        act(&dismiss, cx, "connectionsTailscaleSetupCancel", json!({}))
                    }
                })
                .child(
                    DialogHeader::new()
                        .with_panel(true)
                        .child(DialogTitle::new(dialog.title.clone()))
                        .child(DialogDescription::new(dialog.description.clone())),
                )
                .child(
                    DialogPanel::new("connections-tailscale-setup-panel")
                        .after_header(true)
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(8.))
                                .child(
                                    div()
                                        .text_size(px(text::SM))
                                        .line_height(px(text::SM_LINE))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(t.foreground)
                                        .child(dialog.port_label.clone()),
                                )
                                .children(port)
                                .children(
                                    dialog
                                        .validation_message
                                        .clone()
                                        .map(|message| xs(t.destructive, message)),
                                ),
                        )
                        .child(
                            div()
                                .rounded(px(radius::SM))
                                .border_1()
                                .border_color(fade(t.border, 0.7))
                                .bg(fade(t.muted, 0.2))
                                .px(px(12.))
                                .py(px(8.))
                                .child(
                                    div()
                                        .text_size(px(text::XS))
                                        .line_height(px(text::XS_LINE))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(t.muted_foreground)
                                        .child(dialog.endpoint_label.clone()),
                                )
                                .child(
                                    div()
                                        .id("connections-tailscale-base-url")
                                        .mt(px(4.))
                                        .truncate()
                                        .text_size(px(text::SM))
                                        .line_height(px(text::SM_LINE))
                                        .text_color(t.foreground)
                                        .tooltip(Tooltip::text(dialog.base_url_text.clone()))
                                        .child(dialog.base_url_text.clone()),
                                ),
                        ),
                )
                .child(
                    DialogFooter::new()
                        .child(
                            Button::new("connections-tailscale-setup-cancel")
                                .variant(ButtonVariant::Outline)
                                .disabled(dialog.cancel.disabled)
                                .label(dialog.cancel.label.clone())
                                .on_click(on_click(
                                    &self.client,
                                    "connectionsTailscaleSetupCancel",
                                    json!({}),
                                )),
                        )
                        .child(
                            busy_button(
                                "connections-tailscale-setup-confirm",
                                &dialog.confirm.label,
                                dialog.confirm.busy,
                            )
                            .disabled(dialog.confirm.disabled)
                            .on_click(on_click(
                                &self.client,
                                "connectionsTailscaleSetupConfirm",
                                json!({}),
                            )),
                        ),
                )
                .into_any_element(),
        )
    }

    fn environment_row(
        &self,
        row: &SavedBackendRow,
        extra: Option<&ConnectionsEnvironmentRow>,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> AnyElement {
        let client = self.client.clone();
        let environment_id = row.id.clone();
        let subtitle = div()
            .id(SharedString::from(format!(
                "connections-row-status-{}",
                row.id
            )))
            .truncate()
            .when(row.subtitle_tone == StatusTone::Error, |this| {
                this.text_color(t.destructive)
            })
            .tooltip(Tooltip::text(row.status_tooltip.clone()))
            .child(row.subtitle.clone());
        let mut environment =
            EnvironmentRow::new(row.machine_kind, row.label.clone(), subtitle).dimmed(row.dimmed);
        if let Some(progress) = extra.and_then(|extra| extra.progress.as_ref()) {
            environment = environment.below(
                div()
                    .mt(px(4.))
                    .max_w(px(PROGRESS_MAX_WIDTH))
                    .child(update_progress(&format!("row-{}", row.id), progress, t)),
            );
        }
        if let Some(update) = extra.and_then(|extra| extra.update.as_ref()) {
            environment = environment.trailing(self.update_icon(update, t));
        }
        environment = environment
            .trailing(with_tooltip(
                format!("connections-row-toggle-tip-{}", row.id),
                &row.toggle.tooltip,
                settings_switch(
                    SharedString::from(format!("connections-row-toggle-{}", row.id)),
                    row.toggle.checked,
                )
                .size(SwitchSize::Sm)
                .disabled(row.toggle.disabled)
                .accessibility_label(row.toggle.aria_label.clone())
                .on_change(move |checked, _, _, cx| {
                    act(
                        &client,
                        cx,
                        "connectionsSetEnabled",
                        json!({ "environmentId": environment_id, "enabled": checked }),
                    )
                }),
            ))
            .trailing(self.menu_trigger(
                row.id.clone(),
                &row.menu.aria_label,
                row.menu.disabled,
                cx,
            ));
        environment.render(cx).into_any_element()
    }

    fn environments_section(
        &self,
        view: &SettingsConnectionsView,
        remote: &RemoteEnvironments,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> AnyElement {
        let add = &remote.add_environment_dialog;
        let header = div()
            .flex()
            .items_center()
            .gap(px(4.))
            .children(view.update_all.as_ref().map(|update| {
                Button::new("connections-update-all")
                    .size(ButtonSize::Xs)
                    .variant(ButtonVariant::GhostMuted)
                    .disabled(update.disabled)
                    .label(update.label.clone())
                    .on_click(on_click(&self.client, "connectionsUpdateAll", json!({})))
            }))
            .child(with_tooltip(
                "connections-add-environment-tip",
                &add.trigger_label,
                Button::new("connections-add-environment")
                    .size(ButtonSize::Xs)
                    .variant(ButtonVariant::GhostMuted)
                    .icon("plus")
                    .icon_size(12.)
                    .label(add.trigger_label.clone())
                    .accessibility_label(add.trigger_label.clone())
                    .on_click(on_click(
                        &self.client,
                        "connectionsAddOpen",
                        json!({ "open": true }),
                    )),
            ));
        let rows = remote.rows.iter().map(|row| {
            let extra = view
                .rows
                .iter()
                .find(|extra| extra.environment_id == row.id);
            self.environment_row(row, extra, t, cx)
        });
        let empty = match remote.empty_mode {
            EmptyMode::None => None,
            EmptyMode::Empty | EmptyMode::CloudRows => Some(
                Empty::new()
                    .icon("icons/chevrons-left-right-ellipsis.svg")
                    .title(remote.empty_state.title.clone())
                    .description(remote.empty_state.description.clone())
                    .min_h(px(208.))
                    .into_any_element(),
            ),
        };
        SettingsSection::new(remote.title.clone())
            .id(remote.id.clone())
            .header_action(header)
            .children(rows.collect::<Vec<_>>())
            .children(empty)
            .into_any_element()
    }

    fn field_label(&self, label: &str, t: &Tokens) -> gpui::Div {
        div()
            .mb(px(6.))
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .font_weight(FontWeight::MEDIUM)
            .text_color(t.foreground)
            .child(label.to_string())
    }

    fn labeled_input(&self, field: Field, label: &str, disabled: bool, t: &Tokens) -> gpui::Div {
        div()
            .flex()
            .flex_col()
            .min_w_0()
            .child(self.field_label(label, t))
            .children(
                self.fields
                    .get(field.key())
                    .map(|input| Input::new(&input.state).disabled(disabled).w_full()),
            )
    }

    fn submit_button(&self, add: &AddEnvironmentDialog) -> Button {
        Button::new("connections-add-submit")
            .variant(ButtonVariant::Outline)
            .icon("plus")
            .icon_size(14.)
            .label(add.submit.label.clone())
            .disabled(add.submit.disabled)
            .w_full()
            .on_click(on_click(&self.client, "connectionsAddSubmit", json!({})))
    }

    fn mode_card(&self, card: &ConnectionModeCard, t: &Tokens) -> AnyElement {
        let mode = match card.mode {
            SavedBackendMode::Remote => "remote",
            SavedBackendMode::Ssh => "ssh",
        };
        let hover = fade(t.muted, 0.4);
        let icon_hover = t.foreground;
        div()
            .id(SharedString::from(format!("connections-mode-{mode}")))
            .group(SharedString::from(format!("connections-mode-group-{mode}")))
            .flex()
            .flex_1()
            .min_w_0()
            .min_h(px(MODE_CARD_MIN_HEIGHT))
            .items_start()
            .gap(px(12.))
            .rounded(px(radius::LG))
            .border_1()
            .p(px(16.))
            .map(|this| {
                if card.selected {
                    this.border_color(fade(t.primary, 0.5))
                        .bg(fade(t.primary, 0.05))
                } else {
                    this.border_color(fade(t.border, 0.6))
                        .hover(move |s| s.bg(hover))
                }
            })
            .when(card.disabled, |this| this.opacity(0.64))
            .when(!card.disabled, |this| {
                this.cursor_pointer().on_click(on_click(
                    &self.client,
                    "connectionsAddMode",
                    json!({ "mode": mode }),
                ))
            })
            .child(
                div()
                    .mt(px(2.))
                    .flex()
                    .flex_none()
                    .size(px(MODE_ICON_BOX))
                    .items_center()
                    .justify_center()
                    .rounded(px(radius::MD))
                    .border_1()
                    .map(|this| {
                        if card.selected {
                            this.border_color(fade(t.primary, 0.3))
                                .bg(fade(t.primary, 0.1))
                                .text_color(t.primary)
                        } else {
                            this.border_color(fade(t.border, 0.7))
                                .bg(t.background)
                                .text_color(t.muted_foreground)
                                .group_hover(
                                    SharedString::from(format!("connections-mode-group-{mode}")),
                                    move |s| s.text_color(icon_hover),
                                )
                        }
                    })
                    .child(
                        svg()
                            .path(SharedString::from(format!("icons/{}.svg", card.icon)))
                            .size(px(16.))
                            .text_color(if card.selected {
                                t.primary
                            } else {
                                t.muted_foreground
                            }),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .min_w_0()
                    .child(self.row_title(&card.title, t))
                    .child(
                        line(
                            text::XS,
                            text::XS * text::LEADING_RELAXED,
                            t.muted_foreground,
                        )
                        .mt(px(4.))
                        .child(card.description.clone()),
                    ),
            )
            .into_any_element()
    }

    fn ssh_body(
        &self,
        view: &SettingsConnectionsView,
        add: &AddEnvironmentDialog,
        ssh: &SshFields,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> AnyElement {
        let disabled = add.fields_disabled;
        let host_input = self.fields.get(Field::SshHost.key()).map(|input| {
            let client = self.client.clone();
            let entity = cx.entity();
            let suggestions_visible = view.ssh_suggestions_open && ssh.suggestions.has_content;
            let count = if ssh.suggestions.state == SuggestionsState::List {
                ssh.suggestions.items.len()
            } else {
                0
            };
            let open_client = self.client.clone();
            div()
                .relative()
                .on_mouse_down(gpui::MouseButton::Left, move |_, _, cx| {
                    act(
                        &open_client,
                        cx,
                        "connectionsAddSuggestions",
                        json!({ "open": true }),
                    )
                })
                .capture_key_down(move |event: &KeyDownEvent, _, cx| {
                    if !suggestions_visible {
                        return;
                    }
                    let keystroke = &event.keystroke;
                    let modifiers = keystroke.modifiers;
                    if (modifiers.platform || modifiers.control || modifiers.alt)
                        && keystroke.key.len() == 1
                        && keystroke.key.chars().all(|c| c.is_ascii_digit())
                    {
                        cx.stop_propagation();
                        act(
                            &client,
                            cx,
                            "connectionsAddHostKeyDown",
                            json!({
                                "key": keystroke.key,
                                "metaKey": modifiers.platform,
                                "ctrlKey": modifiers.control,
                                "shiftKey": modifiers.shift,
                                "altKey": modifiers.alt,
                            }),
                        );
                        return;
                    }
                    match keystroke.key.as_str() {
                        "escape" => {
                            cx.stop_propagation();
                            act(
                                &client,
                                cx,
                                "connectionsAddSuggestions",
                                json!({ "open": false }),
                            );
                        }
                        "down" | "up" if count > 0 => {
                            cx.stop_propagation();
                            let down = keystroke.key == "down";
                            entity.update(cx, |section, cx| {
                                section.highlight = Some(match (section.highlight, down) {
                                    (None, true) => 0,
                                    (None, false) => count - 1,
                                    (Some(index), true) => (index + 1) % count,
                                    (Some(index), false) => (index + count - 1) % count,
                                });
                                cx.notify();
                            });
                        }
                        _ => {}
                    }
                })
                .child(Input::new(&input.state).disabled(disabled).w_full())
                .child(self.measure("ssh-host".to_string(), cx))
        });
        div()
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .child(self.field_label(&ssh.host_label, t))
                    .children(host_input),
            )
            .child(
                div()
                    .flex()
                    .gap(px(12.))
                    .child(
                        self.labeled_input(Field::SshUsername, &ssh.username_label, disabled, t)
                            .flex_1(),
                    )
                    .child(
                        self.labeled_input(Field::SshPort, &ssh.port_label, disabled, t)
                            .flex_none()
                            .w(px(SSH_PORT_WIDTH)),
                    ),
            )
            .children(ssh.error.clone().map(|error| {
                div()
                    .rounded(px(radius::SM))
                    .border_1()
                    .border_color(fade(t.destructive, 0.3))
                    .bg(fade(t.destructive, 0.05))
                    .px(px(12.))
                    .py(px(8.))
                    .child(xs(t.destructive, error))
            }))
            .child(self.submit_button(add))
            .into_any_element()
    }

    fn ssh_suggestions(
        &self,
        view: &SettingsConnectionsView,
        ssh: &SshFields,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> Option<AnyElement> {
        if !(view.add_environment_open && view.ssh_suggestions_open && ssh.suggestions.has_content)
        {
            return None;
        }
        let trigger = self.bounds.get("ssh-host").copied()?;
        let suggestions = &ssh.suggestions;
        let dismiss = self.client.clone();
        let content: AnyElement = match suggestions.state {
            SuggestionsState::Loading => div()
                .px(px(12.))
                .py(px(8.))
                .child(xs(t.muted_foreground, suggestions.loading_label.clone()))
                .into_any_element(),
            SuggestionsState::Empty => div()
                .px(px(12.))
                .py(px(8.))
                .text_center()
                .child(xs(t.muted_foreground, suggestions.empty_label.clone()))
                .into_any_element(),
            SuggestionsState::List => div()
                .id("connections-ssh-suggestions-list")
                .flex()
                .flex_col()
                .max_h(px(SUGGESTION_MAX_HEIGHT))
                .overflow_y_scroll()
                .p(px(4.))
                .children(suggestions.items.iter().enumerate().map(|(index, item)| {
                    let highlighted = self.highlight == Some(index);
                    let accent = t.accent;
                    let entity = cx.entity();
                    div()
                        .id(SharedString::from(format!(
                            "connections-ssh-host-{}",
                            item.key
                        )))
                        .flex()
                        .h(px(SUGGESTION_HEIGHT))
                        .flex_none()
                        .items_center()
                        .gap(px(8.))
                        .px(px(8.))
                        .rounded(px(radius::SM))
                        .cursor_pointer()
                        .when(highlighted, |this| this.bg(accent))
                        .hover(move |s| s.bg(accent))
                        .on_hover(move |hovered, _, cx| {
                            if *hovered {
                                entity.update(cx, |section, cx| {
                                    if section.highlight != Some(index) {
                                        section.highlight = Some(index);
                                        cx.notify();
                                    }
                                });
                            }
                        })
                        .on_click(on_click(
                            &self.client,
                            "connectionsAddSelectHost",
                            json!({ "alias": item.alias }),
                        ))
                        .child(
                            div()
                                .min_w_0()
                                .truncate()
                                .text_size(px(text::SM))
                                .line_height(px(text::SM_LINE))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.foreground)
                                .child(item.alias.clone()),
                        )
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .text_color(t.muted_foreground)
                                .children(item.address.clone()),
                        )
                        .children(
                            item.shortcut_label
                                .clone()
                                .map(|label| div().flex_none().child(MenuShortcut::new(label))),
                        )
                }))
                .into_any_element(),
        };
        Some(
            positioned(
                trigger,
                Side::Bottom,
                Align::Start,
                4.,
                0.,
                dropdown_glass(cx)
                    .id("connections-ssh-suggestions")
                    .occlude()
                    .w(trigger.size.width)
                    .on_mouse_down_out(move |_, window, cx| {
                        if !trigger.contains(&window.mouse_position()) {
                            act(
                                &dismiss,
                                cx,
                                "connectionsAddSuggestions",
                                json!({ "open": false }),
                            )
                        }
                    })
                    .child(content),
            )
            .into_any_element(),
        )
    }

    fn add_environment_dialog(
        &self,
        view: &SettingsConnectionsView,
        add: &AddEnvironmentDialog,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> Option<AnyElement> {
        if !view.add_environment_open {
            return None;
        }
        let dismiss = self.client.clone();
        let body = match add.mode {
            SavedBackendMode::Ssh => self.ssh_body(view, add, &add.ssh, t, cx),
            SavedBackendMode::Remote => div()
                .flex()
                .flex_col()
                .gap(px(16.))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(12.))
                        .child(
                            div()
                                .flex()
                                .gap(px(12.))
                                .child(
                                    self.labeled_input(
                                        Field::Host,
                                        &add.remote.host_label,
                                        add.fields_disabled,
                                        t,
                                    )
                                    .flex_1(),
                                )
                                .child(
                                    self.labeled_input(
                                        Field::PairingCode,
                                        &add.remote.pairing_code_label,
                                        add.fields_disabled,
                                        t,
                                    )
                                    .flex_none()
                                    .w(px(PAIRING_CODE_WIDTH)),
                                ),
                        )
                        .child(
                            line(TEXT_2XS, text::XS_LINE, t.muted_foreground)
                                .mt(px(4.))
                                .child(add.remote.hint.clone()),
                        ),
                )
                .children(
                    add.remote
                        .error
                        .clone()
                        .map(|error| xs(t.destructive, error)),
                )
                .child(self.submit_button(add))
                .into_any_element(),
        };
        Some(
            DialogPopup::new("connections-add-environment")
                .max_width(ADD_DIALOG_WIDTH)
                .show_close_button(true)
                .on_close(move |_, cx| {
                    act(&dismiss, cx, "connectionsAddOpen", json!({ "open": false }))
                })
                .child(
                    DialogHeader::new()
                        .with_panel(true)
                        .child(DialogTitle::new(add.title.clone()))
                        .child(DialogDescription::new(add.description.clone())),
                )
                .child(
                    DialogPanel::new("connections-add-environment-panel")
                        .after_header(true)
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(16.))
                                .child(div().flex().gap(px(12.)).children(
                                    add.mode_cards.iter().map(|card| self.mode_card(card, t)),
                                ))
                                .child(body),
                        ),
                )
                .into_any_element(),
        )
    }

    fn github_routing(
        &self,
        routing: &GitHubRouting,
        t: &Tokens,
        cx: &Context<Self>,
    ) -> AnyElement {
        let rows = routing.rows.iter().map(|row| {
            let client = self.client.clone();
            let environment_id = row.id.clone();
            let select = Select::new(SharedString::from(format!("connections-routing-{}", row.id)))
                .size(SelectSize::Xs)
                .align(Align::End)
                .match_trigger_width(true)
                .items(
                    row.options
                        .iter()
                        .map(|option| SelectItem::new(option.value.clone(), option.label.clone())),
                )
                .value(Some(row.value.clone()))
                .disabled(row.disabled)
                .accessibility_label(row.aria_label.clone())
                .w(px(ROUTING_SELECT_WIDTH))
                .flex_none()
                .on_change(move |permission, _, cx| {
                    act(
                        &client,
                        cx,
                        "connectionsGitHubRouting",
                        json!({ "environmentId": environment_id, "permission": permission.to_string() }),
                    )
                });
            EnvironmentRow::new(row.kind, row.label.clone(), row.subtitle.clone())
                .trailing(select)
                .render(cx)
                .into_any_element()
        });
        FoldedSettingsSection::new(routing.id.clone(), routing.title.clone())
            .summary(Some(routing.summary.clone()))
            .child(
                div()
                    .px(px(ROW_PADDING_X))
                    .py(px(10.))
                    .child(xs(t.muted_foreground, routing.description.clone())),
            )
            .children(rows.collect::<Vec<_>>())
            .into_any_element()
    }
}

impl Render for ConnectionsSection {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return div().into_any_element();
        };
        self.sync(&view, window, cx);
        let t = theme::active(cx);
        let mut stack = settings_stack();
        let mut overlays: Vec<AnyElement> = Vec::new();
        match &view.model.primary {
            PrimarySection::Managed(managed) => {
                stack = stack.child(self.primary_section(&view, managed, &t, cx));
                if let Some(clients) = &managed.authorized_clients {
                    stack = stack.child(self.authorized_clients(clients, &t));
                    for row in &clients.pairing_links {
                        overlays.extend(self.reveal_dialog(row, &t));
                    }
                }
                if let (Some(environment_id), Some(menu)) =
                    (&view.primary_environment_id, &view.primary_icon_menu)
                {
                    overlays.extend(self.menu_popup(
                        PRIMARY_MENU,
                        environment_id,
                        menu,
                        Vec::new(),
                        cx,
                    ));
                }
                if let Some(local) = &view.local_environment {
                    overlays.extend(self.local_environment_dialog(local, &t));
                }
                if view.create_pairing_link_open {
                    overlays.push(self.create_link_dialog(&managed.create_pairing_link_dialog, &t));
                }
                overlays.extend(self.alert_dialog(
                    "connections-network-dialog",
                    &managed.network_exposure_dialog,
                    "connectionsNetworkDialog",
                    "connectionsNetworkConfirm",
                    json!({ "open": false }),
                ));
                overlays.extend(self.wsl_dialog(&managed.wsl_confirm_dialog));
                overlays.extend(self.alert_dialog(
                    "connections-tailscale-disable",
                    &managed.tailscale_disable_dialog,
                    "connectionsTailscaleDisableCancel",
                    "connectionsTailscaleDisableConfirm",
                    json!({}),
                ));
                overlays.extend(self.tailscale_setup_dialog(&managed.tailscale_setup_dialog, &t));
            }
            PrimarySection::Restricted {
                id,
                title,
                administrative_access,
            } => {
                stack = stack.child(
                    SettingsSection::new(title.clone()).id(id.clone()).child(
                        SettingsRow::new(
                            "connections-administrative-access",
                            administrative_access.title.clone(),
                        )
                        .description(administrative_access.description.clone()),
                    ),
                );
            }
        }
        let remote = &view.model.remote_environments;
        stack = stack.child(self.environments_section(&view, remote, &t, cx));
        for row in &remote.rows {
            if let Some(extra) = view
                .rows
                .iter()
                .find(|extra| extra.environment_id == row.id)
            {
                let items = self.row_menu_items(row, cx);
                overlays.extend(self.menu_popup(&row.id, &row.id, &extra.icon_menu, items, cx));
            }
        }
        overlays.extend(self.add_environment_dialog(&view, &remote.add_environment_dialog, &t, cx));
        overlays.extend(self.ssh_suggestions(&view, &remote.add_environment_dialog.ssh, &t, cx));
        stack
            .child(self.load_balancing.clone())
            .children(
                view.github_routing
                    .as_ref()
                    .map(|routing| self.github_routing(routing, &t, cx)),
            )
            .children(overlays)
            .into_any_element()
    }
}
