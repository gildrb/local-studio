use gpui::component::input::{InputEvent, InputState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, Context, Entity, FontWeight, InteractiveElement, IntoElement,
    KeyDownEvent, ParentElement, Render, SharedString, StatefulInteractiveElement, Styled, Window,
    div, px, svg,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::settings_licenses::{
    OpenSourceLicenseRowView, OpenSourceLicensesBodyView, OpenSourceLicensesHeaderView,
    SettingsLicensesView,
};
use crate::features::settings::primitives::SettingsSection;
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::input::InputSize;
use crate::ui::input_group::{AddonAlign, InputGroup, InputGroupAddon};
use crate::ui::theme;
use crate::ui::theme::metrics::text;
use crate::ui::theme::tokens::fade;
use crate::ui::tooltip::Tooltip;

const ROW_MIN_HEIGHT: f32 = 36.;
const ROW_PADDING_X: f32 = 16.;
const ROW_GAP: f32 = 10.;
const CHEVRON: f32 = 14.;
const NOTICE_PADDING_X: f32 = 40.;
const NOTICE_PADDING_TOP: f32 = 4.;
const NOTICE_PADDING_BOTTOM: f32 = 16.;
const NOTICE_MAX_WIDTH: f32 = 560.;
const SEARCH_WIDTH: f32 = 176.;

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

pub struct LicensesSection {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<SettingsLicensesView>>>,
    search: Option<Entity<InputState>>,
    search_was_open: bool,
}

impl LicensesSection {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<SettingsLicensesView>>(
            &client,
            "settingsLicenses",
            json!({}),
            cx,
        );
        cx.observe(&view, |_, _, cx| cx.notify()).detach();
        act(&client, cx, "settingsLicensesMount", json!({}));
        Self {
            client,
            view,
            search: None,
            search_was_open: false,
        }
    }

    fn sync_search(
        &mut self,
        header: Option<&OpenSourceLicensesHeaderView>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let open = header.is_some_and(|header| header.search_open);
        if !open {
            self.search_was_open = false;
            return;
        }
        let search = match &self.search {
            Some(search) => search.clone(),
            None => {
                let search = cx.new(|cx| InputState::new(window, cx));
                let client = self.client.clone();
                cx.subscribe_in(
                    &search,
                    window,
                    move |_: &mut Self, search, event: &InputEvent, _, cx| match event {
                        InputEvent::Change => {
                            let query = search.read(cx).value().to_string();
                            act(
                                &client,
                                cx,
                                "settingsLicensesQuery",
                                json!({ "query": query }),
                            );
                        }
                        InputEvent::Blur => {
                            act(&client, cx, "settingsLicensesSearchBlur", json!({}));
                        }
                        _ => {}
                    },
                )
                .detach();
                self.search = Some(search.clone());
                search
            }
        };
        if let Some(header) = header {
            let current = search.read(cx).value().to_string();
            if current != header.query && (!self.search_was_open || header.query.is_empty()) {
                let query = header.query.clone();
                search.update(cx, |state, cx| state.set_value(query, window, cx));
            }
        }
        if !self.search_was_open {
            self.search_was_open = true;
            search.update(cx, |state, cx| state.focus(window, cx));
        }
    }

    fn header_action(&self, header: &OpenSourceLicensesHeaderView, cx: &App) -> AnyElement {
        let t = theme::active(cx);
        let count = div()
            .whitespace_nowrap()
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .text_color(t.muted_foreground)
            .font_features(theme::tabular())
            .child(header.count_label.clone());
        if !header.search_open {
            let client = self.client.clone();
            return div()
                .flex()
                .items_center()
                .gap(px(6.))
                .child(count)
                .child(
                    div()
                        .id("licenses-search-trigger")
                        .tooltip(Tooltip::text(header.search_tooltip.clone()))
                        .child(
                            Button::new("licenses-search")
                                .size(ButtonSize::IconMicro)
                                .variant(ButtonVariant::GhostMuted)
                                .icon("search")
                                .icon_size(12.)
                                .accessibility_label(header.search_label.clone())
                                .on_click(move |_, _, cx| {
                                    act(
                                        &client,
                                        cx,
                                        "settingsLicensesSearchOpen",
                                        json!({ "open": true }),
                                    );
                                }),
                        ),
                )
                .into_any_element();
        }
        let Some(search) = self.search.clone() else {
            return count.into_any_element();
        };
        let client = self.client.clone();
        div()
            .flex()
            .items_center()
            .gap(px(8.))
            .child(count)
            .child(
                div()
                    .w(px(SEARCH_WIDTH))
                    .on_key_down(move |event: &KeyDownEvent, _, cx| {
                        if event.keystroke.key == "escape" {
                            cx.stop_propagation();
                            act(
                                &client,
                                cx,
                                "settingsLicensesSearchKey",
                                json!({ "key": "Escape" }),
                            );
                        }
                    })
                    .child(
                        InputGroup::input(&search)
                            .size(InputSize::Sm)
                            .addon(InputGroupAddon::new(AddonAlign::InlineStart).icon("search")),
                    ),
            )
            .into_any_element()
    }

    fn row(&self, row: &OpenSourceLicenseRowView, cx: &App) -> AnyElement {
        let t = theme::active(cx);
        let toggle_client = self.client.clone();
        let entry_key = row.id.clone();
        let next_open = !row.open;
        let trigger = div()
            .id(SharedString::from(format!("license-{}", row.id)))
            .flex()
            .flex_1()
            .min_w_0()
            .min_h(px(ROW_MIN_HEIGHT))
            .items_center()
            .gap(px(ROW_GAP))
            .px(px(ROW_PADDING_X))
            .cursor_pointer()
            .on_click(move |_, _, cx| {
                act(
                    &toggle_client,
                    cx,
                    "settingsLicensesToggle",
                    json!({ "entryKey": entry_key, "open": next_open }),
                );
            })
            .child(
                svg()
                    .path("icons/chevron-right.svg")
                    .flex_none()
                    .size(px(CHEVRON))
                    .text_color(t.muted_foreground)
                    .when(row.open, |s| {
                        s.with_transformation(gpui::Transformation::rotate(gpui::radians(
                            std::f32::consts::FRAC_PI_2,
                        )))
                    }),
            )
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .items_baseline()
                    .gap(px(8.))
                    .child(
                        div()
                            .truncate()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.foreground)
                            .child(row.name.clone()),
                    )
                    .when_some(row.version.clone(), |d, version| {
                        d.child(
                            div()
                                .flex_none()
                                .font_family(MONO_FONT)
                                .text_size(px(text::XS))
                                .text_color(t.muted_foreground)
                                .child(version),
                        )
                    }),
            )
            .child(
                div()
                    .flex_none()
                    .max_w(gpui::relative(0.42))
                    .truncate()
                    .text_size(px(text::XS))
                    .text_color(t.muted_foreground)
                    .child(row.summary.clone()),
            );
        let source = row.source_url.clone().map(|url| {
            let client = self.client.clone();
            div()
                .id(SharedString::from(format!("license-source-{}", row.id)))
                .flex_none()
                .mr(px(ROW_PADDING_X))
                .tooltip(Tooltip::text(row.source_title.clone()))
                .child(
                    Button::new(SharedString::from(format!("license-source-btn-{}", row.id)))
                        .size(ButtonSize::IconMicro)
                        .variant(ButtonVariant::GhostMuted)
                        .icon("external-link")
                        .icon_size(12.)
                        .accessibility_label(row.source_label.clone())
                        .on_click(move |_, _, cx| {
                            act(
                                &client,
                                cx,
                                "settingsLicensesOpenSource",
                                json!({ "url": url }),
                            );
                        }),
                )
        });
        let hover = fade(t.muted, 0.7);
        div()
            .flex()
            .flex_col()
            .child(
                div()
                    .flex()
                    .items_center()
                    .min_h(px(ROW_MIN_HEIGHT))
                    .hover(move |s| s.bg(hover))
                    .child(trigger)
                    .children(source),
            )
            .when_some(row.notice_text.clone(), |d, notice| {
                d.child(
                    div()
                        .px(px(NOTICE_PADDING_X))
                        .pt(px(NOTICE_PADDING_TOP))
                        .pb(px(NOTICE_PADDING_BOTTOM))
                        .child(
                            div()
                                .max_w(px(NOTICE_MAX_WIDTH))
                                .font_family(MONO_FONT)
                                .text_size(px(text::XS))
                                .line_height(px(20.))
                                .text_color(fade(t.foreground, 0.8))
                                .whitespace_normal()
                                .child(notice),
                        ),
                )
            })
            .into_any_element()
    }
}

impl Render for LicensesSection {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return div().into_any_element();
        };
        self.sync_search(view.header.as_ref(), window, cx);
        let t = theme::active(cx);
        let mut section = SettingsSection::new(view.title.clone());
        if let Some(header) = view.header.as_ref() {
            section = section.header_action(self.header_action(header, cx));
        }
        let body = match &view.body {
            OpenSourceLicensesBodyView::Ready {
                rows,
                empty_message,
            } => match empty_message {
                None => div()
                    .flex()
                    .flex_col()
                    .text_size(px(text::SM))
                    .line_height(px(text::SM_LINE))
                    .children(rows.iter().map(|row| self.row(row, cx)))
                    .into_any_element(),
                Some(message) => div()
                    .px(px(ROW_PADDING_X))
                    .py(px(32.))
                    .text_center()
                    .text_size(px(text::SM))
                    .line_height(px(24.))
                    .text_color(t.muted_foreground)
                    .child(message.clone())
                    .into_any_element(),
            },
            OpenSourceLicensesBodyView::Error {
                title,
                message,
                retry_label,
            } => {
                let client = self.client.clone();
                div()
                    .flex()
                    .flex_col()
                    .items_start()
                    .gap(px(12.))
                    .px(px(ROW_PADDING_X))
                    .py(px(20.))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(4.))
                            .child(
                                div()
                                    .text_size(px(text::SM))
                                    .line_height(px(text::SM_LINE))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(t.foreground)
                                    .child(title.clone()),
                            )
                            .child(
                                div()
                                    .max_w(px(560.))
                                    .text_size(px(text::XS))
                                    .line_height(px(18.))
                                    .text_color(fade(t.muted_foreground, 0.8))
                                    .child(message.clone()),
                            ),
                    )
                    .child(
                        Button::new("licenses-retry")
                            .size(ButtonSize::Xs)
                            .variant(ButtonVariant::Outline)
                            .label(retry_label.clone())
                            .on_click(move |_, _, cx| {
                                act(&client, cx, "settingsLicensesRetry", json!({}));
                            }),
                    )
                    .into_any_element()
            }
            OpenSourceLicensesBodyView::Loading { message } => div()
                .px(px(ROW_PADDING_X))
                .py(px(20.))
                .text_size(px(text::SM))
                .line_height(px(24.))
                .text_color(t.muted_foreground)
                .child(message.clone())
                .into_any_element(),
        };
        section.child(body).into_any_element()
    }
}
