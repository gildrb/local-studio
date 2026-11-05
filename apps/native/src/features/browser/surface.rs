use std::sync::Arc;

use gpui::component::input::{InputEvent, InputState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, ClickEvent, Context, Entity, FontWeight, Image, ImageFormat,
    InteractiveElement, IntoElement, MouseButton, MouseDownEvent, ParentElement, Render,
    SharedString, StatefulInteractiveElement, Styled, Window, canvas, div, img, px, relative, svg,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::browser::{
    BrowserContentView, BrowserDeviceToolbarView, BrowserRecentView, BrowserServerView,
    BrowserSurfaceView,
};
use crate::features::browser::host::{BrowserHostHandle, SlotKind};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::empty::Empty;
use crate::ui::input::bare_input;
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const CHROME_HEIGHT: f32 = 40.;
const CHROME_PADDING_X: f32 = 8.;
const CHROME_GAP: f32 = 4.;
const NAV_GAP: f32 = 2.;
const ADDRESS_HEIGHT: f32 = 28.;
const ADDRESS_PADDING_X: f32 = 8.;
const PROGRESS_HEIGHT: f32 = 2.;
const BADGE_MAX_WIDTH: f32 = 112.;
const BADGE_HEIGHT: f32 = 20.;
const BADGE_PADDING_X: f32 = 6.;
const LIST_PADDING_X: f32 = 20.;
const LIST_PADDING_Y: f32 = 32.;
const LIST_MAX_WIDTH: f32 = 576.;
const SECTION_GAP: f32 = 24.;
const SECTION_INNER_GAP: f32 = 12.;
const HEADER_ICON: f32 = 16.;
const ROW_PADDING: f32 = 12.;
const ROW_GAP: f32 = 12.;
const FAVICON: f32 = 28.;
const REMOVE_ICON: f32 = 14.;
const UNREACHABLE_MAX_WIDTH: f32 = 576.;
const UNREACHABLE_PADDING_X: f32 = 32.;
const UNREACHABLE_PADDING_Y: f32 = 48.;
const UNREACHABLE_ICON: f32 = 48.;
const UNREACHABLE_TITLE: f32 = 24.;
const UNREACHABLE_TITLE_LINE: f32 = 30.;
const DEVICE_TOOLBAR_HEIGHT: f32 = 32.;
const DEVICE_TOOLBAR_PADDING_X: f32 = 6.;
const DEVICE_INPUT_WIDTH: f32 = 56.;
const DEVICE_INPUT_HEIGHT: f32 = 24.;
const DEVICE_LABEL_MIN_WIDTH: f32 = 560.;
const DEVICE_PRESET_WIDE: f32 = 144.;
const DEVICE_PRESET_NARROW: f32 = 96.;

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

fn decode_base64(input: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let mut buffer = 0u32;
    let mut bits = 0;
    for byte in input.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            _ => return None,
        };
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    Some(out)
}

fn data_url_image(data_url: &str) -> Option<Arc<Image>> {
    let encoded = data_url.strip_prefix("data:image/png;base64,")?;
    Some(Arc::new(Image::from_bytes(
        ImageFormat::Png,
        decode_base64(encoded)?,
    )))
}

pub struct BrowserSurface {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<BrowserSurfaceView>>>,
    address: Option<Entity<InputState>>,
    address_focused: bool,
    shown_url: String,
    focus_nonce: u64,
    width_input: Option<Entity<InputState>>,
    height_input: Option<Entity<InputState>>,
    details_open: bool,
}

impl BrowserSurface {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<BrowserSurfaceView>>(
            &client,
            "browserSurface",
            json!({}),
            cx,
        );
        cx.observe(&view, |_, _, cx| cx.notify()).detach();
        if let Some(host) = cx.try_global::<BrowserHostHandle>().map(|h| h.0.clone()) {
            cx.observe(&host, |_, _, cx| cx.notify()).detach();
        }
        Self {
            client,
            view,
            address: None,
            address_focused: false,
            shown_url: String::new(),
            focus_nonce: 0,
            width_input: None,
            height_input: None,
            details_open: false,
        }
    }

    fn ensure_inputs(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.address.is_none() {
            let input = cx.new(|cx| InputState::new(window, cx));
            let client = self.client.clone();
            cx.subscribe_in(
                &input,
                window,
                move |surface, state, event: &InputEvent, window, cx| match event {
                    InputEvent::Focus => {
                        surface.address_focused = true;
                        state.update(cx, |state, cx| state.select_all(window, cx));
                    }
                    InputEvent::Blur => {
                        surface.address_focused = false;
                        let url = surface.shown_url.clone();
                        state.update(cx, |state, cx| state.set_value(url, window, cx));
                    }
                    InputEvent::PressEnter { .. } => {
                        let url = state.read(cx).value().to_string();
                        if !url.trim().is_empty() {
                            act(&client, cx, "browserSubmitUrl", json!({ "url": url }));
                            window.blur(cx);
                        }
                    }
                    _ => {}
                },
            )
            .detach();
            input.update(cx, |state, cx| {
                state.set_placeholder("Search or enter URL", window, cx)
            });
            self.address = Some(input);
        }
        for axis in ["width", "height"] {
            let slot = if axis == "width" {
                &mut self.width_input
            } else {
                &mut self.height_input
            };
            if slot.is_some() {
                continue;
            }
            let input = cx.new(|cx| InputState::new(window, cx));
            let client = self.client.clone();
            cx.subscribe_in(
                &input,
                window,
                move |_, state, event: &InputEvent, _, cx| match event {
                    InputEvent::Change => {
                        let value = state.read(cx).value().to_string();
                        act(
                            &client,
                            cx,
                            "browserViewportDimension",
                            json!({ "axis": axis, "value": value }),
                        );
                    }
                    InputEvent::PressEnter { .. } | InputEvent::Blur => {
                        act(&client, cx, "browserViewportApplyDimensions", json!({}));
                    }
                    _ => {}
                },
            )
            .detach();
            *slot = Some(input);
        }
    }

    fn sync_inputs(
        &mut self,
        view: &BrowserSurfaceView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.shown_url = view.chrome.url.clone();
        if let Some(address) = self.address.clone() {
            if !self.address_focused && address.read(cx).value() != view.chrome.url.as_str() {
                let url = view.chrome.url.clone();
                address.update(cx, |state, cx| state.set_value(url, window, cx));
            }
            if view.focus_url_nonce != self.focus_nonce {
                self.focus_nonce = view.focus_url_nonce;
                address.update(cx, |state, cx| {
                    state.focus(window, cx);
                    state.select_all(window, cx);
                });
            }
        }
        if let Some(toolbar) = view.device_toolbar.as_ref() {
            for (input, value) in [
                (self.width_input.clone(), toolbar.width.clone()),
                (self.height_input.clone(), toolbar.height.clone()),
            ] {
                if let Some(input) = input
                    && input.read(cx).value() != value.as_str()
                {
                    input.update(cx, |state, cx| state.set_value(value, window, cx));
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn icon_button(
        &self,
        id: &str,
        icon: &str,
        tooltip: &str,
        disabled: bool,
        pressed: bool,
        action: &'static str,
        params: Value,
    ) -> AnyElement {
        let client = self.client.clone();
        div()
            .id(SharedString::from(format!("browser-tooltip-{id}")))
            .flex_none()
            .tooltip(Tooltip::text(tooltip.to_string()))
            .child(
                Button::new(SharedString::from(format!("browser-{id}")))
                    .variant(if pressed {
                        ButtonVariant::Secondary
                    } else {
                        ButtonVariant::Ghost
                    })
                    .size(ButtonSize::IconXs)
                    .icon(icon.to_string())
                    .disabled(disabled)
                    .accessibility_label(tooltip.to_string())
                    .on_click(move |_: &ClickEvent, _, cx| {
                        act(&client, cx, action, params.clone())
                    }),
            )
            .into_any_element()
    }

    fn chrome(&self, view: &BrowserSurfaceView, t: &Tokens) -> AnyElement {
        let chrome = &view.chrome;
        let more_client = self.client.clone();
        let external_client = self.client.clone();
        let mut row = div()
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(CHROME_GAP))
            .h(px(CHROME_HEIGHT))
            .px(px(CHROME_PADDING_X))
            .border_b_1()
            .border_color(fade(t.border, 0.6))
            .bg(t.background)
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(NAV_GAP))
                    .child(self.icon_button(
                        "back",
                        "arrow-left",
                        "Back",
                        !chrome.can_go_back,
                        false,
                        "browserBack",
                        json!({}),
                    ))
                    .child(self.icon_button(
                        "forward",
                        "arrow-right",
                        "Forward",
                        !chrome.can_go_forward,
                        false,
                        "browserForward",
                        json!({}),
                    ))
                    .child(self.icon_button(
                        "refresh",
                        "rotate-cw",
                        &chrome.refresh_tooltip,
                        chrome.refresh_disabled,
                        false,
                        "browserRefresh",
                        json!({}),
                    )),
            );
        if let Some(badge) = chrome.profile_badge.as_ref() {
            row = row.child(
                div()
                    .id("browser-profile-badge")
                    .flex()
                    .flex_none()
                    .items_center()
                    .h(px(BADGE_HEIGHT))
                    .max_w(px(BADGE_MAX_WIDTH))
                    .px(px(BADGE_PADDING_X))
                    .rounded(px(radius::SM))
                    .border_1()
                    .border_color(t.border)
                    .text_size(px(text::XS))
                    .text_color(t.foreground)
                    .tooltip(Tooltip::text(badge.clone()))
                    .child(div().truncate().child(badge.clone())),
            );
        }
        let address = self.address.as_ref().map(|address| {
            bare_input(
                address,
                ADDRESS_HEIGHT,
                ADDRESS_PADDING_X,
                ADDRESS_PADDING_X,
                text::SM,
                false,
            )
            .w_full()
            .min_w_0()
        });
        row = row.child(
            div()
                .id("browser-address")
                .group("browser-address")
                .relative()
                .flex()
                .flex_1()
                .min_w_0()
                .items_center()
                .h(px(ADDRESS_HEIGHT))
                .rounded(px(radius::MD))
                .when_some(address, |this, address| this.child(address))
                .when(chrome.open_in_browser && !self.address_focused, |this| {
                    this.child(
                        div()
                            .id("browser-open-external")
                            .absolute()
                            .right(px(2.))
                            .top(px(2.))
                            .invisible()
                            .group_hover("browser-address", |s| s.visible())
                            .tooltip(Tooltip::text("Open in system browser"))
                            .child(
                                Button::new("browser-open-external-button")
                                    .variant(ButtonVariant::Ghost)
                                    .size(ButtonSize::IconXs)
                                    .icon("external-link")
                                    .accessibility_label("Open in system browser")
                                    .on_click(move |_, _, cx| {
                                        act(&external_client, cx, "browserOpenExternal", json!({}))
                                    }),
                            ),
                    )
                }),
        );
        if let Some(pick) = chrome.pick.as_ref() {
            row = row.child(self.icon_button(
                "pick",
                "mouse-pointer-click",
                pick.tooltip.as_deref().unwrap_or(&pick.label),
                pick.disabled,
                pick.active,
                "browserPickElement",
                json!({}),
            ));
        }
        if let Some(capture) = chrome.capture.as_ref() {
            row = row.child(self.icon_button(
                "capture",
                "camera",
                capture.tooltip.as_deref().unwrap_or(&capture.label),
                capture.disabled,
                capture.recording,
                "browserCapture",
                json!({ "record": false }),
            ));
        }
        if let Some(pip) = chrome.picture_in_picture.as_ref() {
            row = row.child(self.icon_button(
                "pip",
                "picture-in-picture-2",
                &pip.label,
                pip.disabled,
                pip.active,
                "browserTogglePictureInPicture",
                json!({}),
            ));
        }
        if chrome.more_menu {
            row = row.child(
                div()
                    .id("browser-more")
                    .flex_none()
                    .tooltip(Tooltip::text("More"))
                    .on_mouse_down(MouseButton::Left, move |event: &MouseDownEvent, _, cx| {
                        cx.stop_propagation();
                        let (x, y) = (f32::from(event.position.x), f32::from(event.position.y));
                        act(
                            &more_client,
                            cx,
                            "browserMoreMenu",
                            json!({ "x": x, "y": y }),
                        );
                    })
                    .child(
                        Button::new("browser-more-button")
                            .variant(ButtonVariant::Ghost)
                            .size(ButtonSize::IconXs)
                            .icon("ellipsis-vertical")
                            .accessibility_label("Preview menu"),
                    ),
            );
        }
        row.when(chrome.loading, |this| {
            this.child(
                div()
                    .absolute()
                    .left_0()
                    .bottom_0()
                    .w_full()
                    .h(px(PROGRESS_HEIGHT))
                    .bg(t.primary),
            )
        })
        .into_any_element()
    }

    fn device_toolbar(
        &self,
        toolbar: &BrowserDeviceToolbarView,
        t: &Tokens,
        width: f32,
    ) -> AnyElement {
        let preset_client = self.client.clone();
        let input = |state: &Option<Entity<InputState>>| {
            state.as_ref().map(|state| {
                div()
                    .w(px(DEVICE_INPUT_WIDTH))
                    .h(px(DEVICE_INPUT_HEIGHT))
                    .rounded(px(radius::SM))
                    .border_1()
                    .border_color(if toolbar.custom_valid {
                        t.input
                    } else {
                        t.destructive
                    })
                    .child(bare_input(
                        state,
                        DEVICE_INPUT_HEIGHT - 2.,
                        6.,
                        6.,
                        text::XS,
                        false,
                    ))
            })
        };
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(NAV_GAP))
            .h(px(DEVICE_TOOLBAR_HEIGHT))
            .px(px(DEVICE_TOOLBAR_PADDING_X))
            .border_b_1()
            .border_color(fade(t.border, 0.7))
            .bg(fade(t.background, 0.95))
            .when(width >= DEVICE_LABEL_MIN_WIDTH, |this| {
                this.child(
                    div()
                        .flex_none()
                        .mr(px(2.))
                        .text_size(px(text::XXS))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.muted_foreground)
                        .child("Dimensions"),
                )
            })
            .child(
                div()
                    .id("browser-device-preset")
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_between()
                    .w(px(if width >= 440. {
                        DEVICE_PRESET_WIDE
                    } else {
                        DEVICE_PRESET_NARROW
                    }))
                    .h(px(DEVICE_INPUT_HEIGHT))
                    .px(px(8.))
                    .rounded(px(radius::SM))
                    .text_size(px(text::XS))
                    .text_color(t.foreground)
                    .cursor_pointer()
                    .hover(|s| s.bg(t.accent))
                    .on_mouse_down(MouseButton::Left, move |event: &MouseDownEvent, _, cx| {
                        cx.stop_propagation();
                        let (x, y) = (f32::from(event.position.x), f32::from(event.position.y));
                        act(
                            &preset_client,
                            cx,
                            "browserViewportPresetMenu",
                            json!({ "x": x, "y": y }),
                        );
                    })
                    .child(div().truncate().child(toolbar.preset_label.clone()))
                    .child(
                        svg()
                            .path("icons/chevron-down.svg")
                            .size(px(14.))
                            .text_color(t.muted_foreground),
                    ),
            )
            .when_some(input(&self.width_input), |this, input| this.child(input))
            .child(
                div()
                    .text_size(px(text::XS))
                    .text_color(t.muted_foreground)
                    .child("×"),
            )
            .when_some(input(&self.height_input), |this, input| this.child(input))
            .child(self.icon_button(
                "aspect",
                if toolbar.aspect_locked {
                    "link-2"
                } else {
                    "unlink-2"
                },
                &toolbar.aspect_tooltip,
                !toolbar.custom_valid,
                toolbar.aspect_locked,
                "browserViewportToggleAspect",
                json!({}),
            ))
            .child(self.icon_button(
                "rotate",
                "rotate-ccw",
                "Rotate viewport",
                false,
                false,
                "browserViewportRotate",
                json!({}),
            ))
            .child(div().flex_1())
            .child(self.icon_button(
                "device-close",
                "x",
                "Close device toolbar",
                false,
                false,
                "browserViewportClose",
                json!({}),
            ))
            .into_any_element()
    }

    fn favicon(&self, data_url: Option<&String>, t: &Tokens) -> AnyElement {
        match data_url.and_then(|url| data_url_image(url)) {
            Some(image) => img(image)
                .size(px(FAVICON))
                .rounded(px(4.))
                .flex_none()
                .into_any_element(),
            None => div()
                .flex()
                .flex_none()
                .items_center()
                .justify_center()
                .size(px(FAVICON))
                .rounded(px(radius::SM))
                .border_1()
                .border_color(t.border)
                .bg(t.muted)
                .child(
                    svg()
                        .path("icons/globe.svg")
                        .size(px(16.))
                        .text_color(t.muted_foreground),
                )
                .into_any_element(),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn row(
        &self,
        key: String,
        favicon: AnyElement,
        title: String,
        subtitle: String,
        open_url: String,
        remove: Option<(String, String)>,
        t: &Tokens,
    ) -> AnyElement {
        let open_client = self.client.clone();
        let remove_client = self.client.clone();
        let hover = fade(t.accent, 0.4);
        let group = SharedString::from(format!("browser-row-{key}"));
        div()
            .id(SharedString::from(format!("browser-row-{key}")))
            .group(group.clone())
            .relative()
            .flex()
            .w_full()
            .items_center()
            .gap(px(ROW_GAP))
            .p(px(ROW_PADDING))
            .pr(px(40.))
            .cursor_pointer()
            .hover(move |s| s.bg(hover))
            .on_click(move |_, _, cx| {
                act(
                    &open_client,
                    cx,
                    "browserOpenUrl",
                    json!({ "url": open_url }),
                )
            })
            .child(favicon)
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
                            .child(title),
                    )
                    .child(
                        div()
                            .truncate()
                            .text_size(px(text::XS))
                            .line_height(px(text::XS_LINE))
                            .text_color(t.muted_foreground)
                            .child(subtitle),
                    ),
            )
            .when_some(remove, |this, (url, label)| {
                this.child(
                    div()
                        .id(SharedString::from(format!("browser-remove-{key}")))
                        .absolute()
                        .right(px(12.))
                        .p(px(4.))
                        .rounded(px(radius::XS))
                        .invisible()
                        .group_hover(group.clone(), |s| s.visible())
                        .text_color(t.muted_foreground)
                        .hover(|s| s.bg(t.accent))
                        .tooltip(Tooltip::text(label))
                        .on_click(move |_, _, cx| {
                            cx.stop_propagation();
                            act(
                                &remove_client,
                                cx,
                                "browserRemoveRecent",
                                json!({ "url": url }),
                            );
                        })
                        .child(
                            svg()
                                .path("icons/x.svg")
                                .size(px(REMOVE_ICON))
                                .text_color(t.muted_foreground),
                        ),
                )
            })
            .into_any_element()
    }

    fn section(&self, icon: &str, title: &str, rows: Vec<AnyElement>, t: &Tokens) -> AnyElement {
        div()
            .flex()
            .flex_col()
            .gap(px(SECTION_INNER_GAP))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .text_size(px(text::SM))
                    .text_color(t.muted_foreground)
                    .child(
                        svg()
                            .path(SharedString::from(icon.to_string()))
                            .size(px(HEADER_ICON))
                            .text_color(t.muted_foreground),
                    )
                    .child(
                        div()
                            .font_weight(FontWeight::MEDIUM)
                            .child(title.to_string()),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .overflow_hidden()
                    .rounded(px(radius::LG))
                    .border_1()
                    .border_color(t.border)
                    .children(rows),
            )
            .into_any_element()
    }

    fn empty_list(
        &self,
        recents: &[BrowserRecentView],
        servers: &[BrowserServerView],
        t: &Tokens,
    ) -> AnyElement {
        let mut column = div()
            .flex()
            .flex_col()
            .gap(px(SECTION_GAP))
            .w_full()
            .max_w(px(LIST_MAX_WIDTH));
        if !recents.is_empty() {
            let rows = recents
                .iter()
                .enumerate()
                .map(|(index, entry)| {
                    self.row(
                        format!("recent-{index}"),
                        self.favicon(entry.favicon_data_url.as_ref(), t),
                        entry.title.clone(),
                        entry.subtitle.clone(),
                        entry.url.clone(),
                        Some((entry.url.clone(), entry.remove_label.clone())),
                        t,
                    )
                })
                .collect();
            column = column.child(self.section("icons/history.svg", "Recently used", rows, t));
        }
        if !servers.is_empty() {
            let rows = servers
                .iter()
                .map(|server| {
                    self.row(
                        format!("server-{}", server.key),
                        self.favicon(server.favicon_data_url.as_ref(), t),
                        server.title.clone(),
                        server.description.clone(),
                        server.url.clone(),
                        None,
                        t,
                    )
                })
                .collect();
            column = column.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(SECTION_INNER_GAP))
                    .child(self.section("icons/radio-tower.svg", "Local servers", rows, t))
                    .child(
                        div()
                            .px(px(4.))
                            .text_size(px(text::XS))
                            .text_color(t.muted_foreground)
                            .child("Select a live local server to open it in this browser tab."),
                    ),
            );
        }
        div()
            .id("browser-empty-list")
            .size_full()
            .overflow_y_scroll()
            .px(px(LIST_PADDING_X))
            .py(px(LIST_PADDING_Y))
            .child(div().flex().justify_center().child(column))
            .into_any_element()
    }

    fn unreachable(
        &self,
        host: &str,
        friendly: &str,
        error_label: &str,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let reload_client = self.client.clone();
        let details_open = self.details_open;
        div()
            .id("browser-unreachable")
            .size_full()
            .overflow_y_scroll()
            .bg(t.background)
            .flex()
            .justify_center()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .w_full()
                    .h_full()
                    .max_w(px(UNREACHABLE_MAX_WIDTH))
                    .px(px(UNREACHABLE_PADDING_X))
                    .py(px(UNREACHABLE_PADDING_Y))
                    .child(
                        svg()
                            .path("icons/browser-unreachable.svg")
                            .size(px(UNREACHABLE_ICON))
                            .mb(px(24.))
                            .text_color(fade(t.muted_foreground, 0.7)),
                    )
                    .child(
                        div()
                            .mb(px(12.))
                            .text_size(px(UNREACHABLE_TITLE))
                            .line_height(px(UNREACHABLE_TITLE_LINE))
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(t.foreground)
                            .child("This site can\u{2019}t be reached"),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .text_size(px(text::SM))
                            .line_height(relative(1.625))
                            .text_color(t.muted_foreground)
                            .child(
                                div()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .text_color(t.foreground)
                                    .child(host.to_string()),
                            )
                            .child(format!(": {friendly}.")),
                    )
                    .when(details_open, |this| {
                        this.child(
                            div()
                                .mt(px(24.))
                                .p(px(16.))
                                .rounded(px(radius::LG))
                                .border_1()
                                .border_color(t.border)
                                .bg(fade(t.muted, 0.4))
                                .text_size(px(text::SM))
                                .child(
                                    div()
                                        .mb(px(8.))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(t.foreground)
                                        .child("Try:"),
                                )
                                .children(
                                    [
                                        "Checking your connection",
                                        "Confirming the dev server is running",
                                        "Checking the proxy and the firewall",
                                    ]
                                    .into_iter()
                                    .map(|line| {
                                        div()
                                            .pl(px(20.))
                                            .text_color(t.muted_foreground)
                                            .child(format!("\u{2022} {line}"))
                                    }),
                                ),
                        )
                    })
                    .child(
                        div()
                            .mt(px(32.))
                            .text_size(px(text::XS))
                            .text_color(fade(t.muted_foreground, 0.7))
                            .child(error_label.to_uppercase()),
                    )
                    .child(div().flex_1())
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .pt(px(32.))
                            .child(
                                Button::new("browser-unreachable-details")
                                    .variant(ButtonVariant::Outline)
                                    .size(ButtonSize::Sm)
                                    .label(if details_open {
                                        "Hide details"
                                    } else {
                                        "Details"
                                    })
                                    .on_click(cx.listener(|surface, _, _, cx| {
                                        surface.details_open = !surface.details_open;
                                        cx.notify();
                                    })),
                            )
                            .child(div().flex_1())
                            .child(
                                Button::new("browser-unreachable-reload")
                                    .size(ButtonSize::Sm)
                                    .label("Reload")
                                    .on_click(move |_, _, cx| {
                                        act(&reload_client, cx, "browserRefresh", json!({}))
                                    }),
                            ),
                    ),
            )
            .into_any_element()
    }
}

impl Render for BrowserSurface {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = theme::active(cx);
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return div().size_full().bg(t.background).into_any_element();
        };
        self.ensure_inputs(window, cx);
        self.sync_inputs(&view, window, cx);
        let chrome = self.chrome(&view, &t);
        let runtime_tab_id = view.runtime_tab_id.clone();
        let device_toolbar = view.device_toolbar.clone();
        let content: AnyElement = match &view.content {
            BrowserContentView::Webview => {
                let tab_id = runtime_tab_id.clone().unwrap_or_default();
                let cover = cx
                    .try_global::<BrowserHostHandle>()
                    .and_then(|host| host.0.read(cx).cover(&tab_id));
                div()
                    .relative()
                    .size_full()
                    .bg(fade(t.muted, 0.35))
                    .child(
                        canvas(
                            move |bounds, _, cx| {
                                if let Some(host) = cx.try_global::<BrowserHostHandle>().map(|h| h.0.clone()) {
                                    host.update(cx, |host, cx| {
                                        host.set_slot(&tab_id, bounds, SlotKind::Panel { device_toolbar: false }, cx)
                                    });
                                }
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full(),
                    )
                    .when_some(cover, |this, (image, frame)| {
                        this.child(
                            img(image)
                                .absolute()
                                .left(frame.origin.x)
                                .top(frame.origin.y)
                                .w(frame.size.width)
                                .h(frame.size.height),
                        )
                    })
                    .into_any_element()
            }
            BrowserContentView::EmptyHint => div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .child(
                    Empty::new()
                        .icon("icons/globe.svg")
                        .title("No preview yet")
                        .description(
                            "Type a URL above, or run a dev script. Browser-ready localhost servers will show up here automatically.",
                        ),
                )
                .into_any_element(),
            BrowserContentView::EmptyList { recents, servers } => self.empty_list(recents, servers, &t),
            BrowserContentView::Unreachable {
                host,
                friendly,
                error_label,
            } => self.unreachable(host, friendly, error_label, &t, cx),
            BrowserContentView::None => div().size_full().into_any_element(),
        };
        let width = f32::from(window.viewport_size().width);
        div()
            .flex()
            .flex_col()
            .size_full()
            .min_h_0()
            .bg(t.background)
            .child(chrome)
            .when_some(device_toolbar, |this, toolbar| {
                this.child(self.device_toolbar(&toolbar, &t, width))
            })
            .child(
                div()
                    .relative()
                    .flex_1()
                    .min_h_0()
                    .overflow_hidden()
                    .child(content),
            )
            .into_any_element()
    }
}
