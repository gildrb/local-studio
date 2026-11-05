use std::collections::{HashMap, HashSet};

use gpui::component::input::{InputEvent, InputState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, ClickEvent, Context, Div, Entity, FontWeight, InteractiveElement,
    IntoElement, KeyDownEvent, ParentElement, Render, Rgba, SharedString,
    StatefulInteractiveElement, Styled, Transformation, Window, div, percentage, px, relative, svg,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::local::{
    LocalDotTone, LocalDotView, LocalMachineDetailsView, LocalMachineView, LocalMetricView,
    LocalPageView, LocalRecipePickerView, LocalUsageView, RegistryInspectView, RegistryJsonView,
    RegistrySectionView, SharePanelView,
};
use crate::features::settings::primitives::{
    SettingsControlWidth, SettingsRow, SettingsSection, SettingsSelect, SettingsSelectOption,
};
use crate::features::usage::chart::UsageProviderChart;
use crate::platform::MONO_FONT;
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::input::{Input, InputSize};
use crate::ui::select::{Select, SelectItem, SelectSize};
use crate::ui::switch::{Switch, SwitchSize};
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const PAGE_GAP: f32 = 24.;
const ROW_X: f32 = 16.;
const ROW_Y: f32 = 12.;
const ROW_GAP: f32 = 12.;
const CHEVRON: f32 = 14.;
const DOT_BOX: f32 = 12.;
const DOT: f32 = 8.;
const NAME_GAP: f32 = 8.;
const TEXT_GAP: f32 = 2.;
const PENCIL: f32 = 12.;
const NAME_INPUT_WIDTH: f32 = 192.;
const MEMORY_WIDTH: f32 = 192.;
const MEMORY_GAP: f32 = 4.;
const MEMORY_BAR: f32 = 6.;
const DETAILS_GAP: f32 = 16.;
const DETAILS_INSET: f32 = 48.;
const DETAILS_BOTTOM: f32 = 16.;
const METRIC_GAP: f32 = 16.;
const METRIC_TEXT_GAP: f32 = 2.;
const INLINE_GAP: f32 = 8.;
const JOB_DETAIL_GAP: f32 = 8.;
const PICKER_MIN_WIDTH: f32 = 256.;
const REGISTRY_FILTER_WIDTH: f32 = 256.;
const REGISTRY_MACHINE_WIDTH: f32 = 144.;
const SWITCH_LABEL_GAP: f32 = 6.;
const REGISTRY_ROW_Y: f32 = 8.;
const REGISTRY_VARIANTS_INSET: f32 = 24.;
const REGISTRY_VARIANTS_BOTTOM: f32 = 12.;
const PANEL_PADDING: f32 = 12.;
const PRE_PADDING: f32 = 8.;
const PRE_TEXT: f32 = 11.;
const PRE_LINE: f32 = 16.;
const PRE_MAX_HEIGHT: f32 = 320.;
const JSON_GAP: f32 = 4.;
const LINK_ICON: f32 = 12.;
const ABOUT_LINK_ICON: f32 = 14.;
const ABOUT_LINK_GAP: f32 = 6.;
const USAGE_Y: f32 = 16.;
const USAGE_GAP: f32 = 20.;
const CHART_GAP: f32 = 12.;
const TABLE_CELL_Y: f32 = 8.;
const ABOUT_GAP: f32 = 12.;
const HOVER_ROW: f32 = 0.4;
const HOVER_TABLE: f32 = 0.5;
const SUBTLE_BORDER: f32 = 0.6;
const TABLE_ROW_BORDER: f32 = 0.5;
const MUTED_SURFACE: f32 = 0.5;
const IDLE_DOT: f32 = 0.6;
const BLUR_LAYERS: [(f32, f32); 6] = [
    (-2., 0.),
    (2., 0.),
    (0., -1.5),
    (0., 1.5),
    (-1., 1.),
    (1., -1.),
];
const BLUR_ALPHA: f32 = 0.22;

pub struct LocalSection {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<LocalPageView>>>,
    name_inputs: HashMap<String, Entity<InputState>>,
    filter: Option<Entity<InputState>>,
    open_json: HashSet<String>,
}

fn send(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

impl LocalSection {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view =
            CoreClient::subscribe::<Option<LocalPageView>>(&client, "localPage", json!({}), cx);
        cx.observe(&view, |_, _, cx| cx.notify()).detach();
        Self {
            client,
            view,
            name_inputs: HashMap::new(),
            filter: None,
            open_json: HashSet::new(),
        }
    }

    fn sync_name_inputs(
        &mut self,
        rows: &[LocalMachineView],
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.name_inputs.retain(|url, _| {
            rows.iter()
                .any(|row| &row.url == url && row.editing.is_some())
        });
        for row in rows {
            let Some(editing) = row.editing.clone() else {
                continue;
            };
            if self.name_inputs.contains_key(&row.url) {
                continue;
            }
            let state = cx.new(|cx| {
                let mut state = InputState::new(window, cx);
                state.set_value(editing, window, cx);
                state
            });
            state.update(cx, |state, cx| state.focus(window, cx));
            let client = self.client.clone();
            let url = row.url.clone();
            cx.subscribe_in(
                &state,
                window,
                move |_, state: &Entity<InputState>, event: &InputEvent, _, cx| match event {
                    InputEvent::Change => {
                        let value = state.read(cx).value().to_string();
                        send(
                            &client,
                            cx,
                            "localEditName",
                            json!({ "url": url, "value": value }),
                        );
                    }
                    InputEvent::PressEnter { .. } => {
                        send(&client, cx, "localSubmitName", json!({ "url": url }));
                    }
                    InputEvent::Blur => {
                        send(
                            &client,
                            cx,
                            "localEditName",
                            json!({ "url": url, "value": null }),
                        );
                    }
                    InputEvent::Focus => {}
                },
            )
            .detach();
            self.name_inputs.insert(row.url.clone(), state);
        }
    }

    fn ensure_filter(
        &mut self,
        registry: &RegistrySectionView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<InputState> {
        if let Some(filter) = &self.filter {
            return filter.clone();
        }
        let placeholder = registry.filter_placeholder.clone();
        let state = cx.new(|cx| InputState::new(window, cx).placeholder(placeholder));
        let client = self.client.clone();
        cx.subscribe_in(
            &state,
            window,
            move |_, state: &Entity<InputState>, event: &InputEvent, _, cx| {
                if let InputEvent::Change = event {
                    let query = state.read(cx).value().to_string();
                    send(&client, cx, "localRegistryQuery", json!({ "query": query }));
                }
            },
        )
        .detach();
        self.filter = Some(state.clone());
        state
    }

    fn json_section(
        &self,
        key: String,
        section: &RegistryJsonView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let open = self.open_json.contains(&key);
        let toggle_key = key.clone();
        let foreground = t.foreground;
        div()
            .flex()
            .flex_col()
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .child(
                div()
                    .id(SharedString::from(format!("local-json-{key}")))
                    .flex()
                    .items_center()
                    .gap(px(JSON_GAP))
                    .cursor_pointer()
                    .text_color(t.muted_foreground)
                    .hover(move |style| style.text_color(foreground))
                    .on_click(cx.listener(move |this, _: &ClickEvent, _, cx| {
                        if !this.open_json.remove(&toggle_key) {
                            this.open_json.insert(toggle_key.clone());
                        }
                        cx.notify();
                    }))
                    .child(disclosure_triangle(open, t.muted_foreground))
                    .child(SharedString::from(section.label.clone())),
            )
            .when(open, |this| {
                this.child(
                    pre_block(
                        SharedString::from(format!("local-json-pre-{key}")),
                        &section.json,
                        t,
                    )
                    .mt(px(JSON_GAP))
                    .max_h(px(PRE_MAX_HEIGHT)),
                )
            })
            .into_any_element()
    }
}

fn disclosure_triangle(open: bool, color: Rgba) -> AnyElement {
    svg()
        .path("icons/chevron-right.svg")
        .size(px(PENCIL))
        .flex_none()
        .text_color(color)
        .when(open, |this| {
            this.with_transformation(Transformation::rotate(percentage(0.25)))
        })
        .into_any_element()
}

fn pre_block(id: SharedString, content: &str, t: &Tokens) -> gpui::Stateful<Div> {
    div()
        .id(id)
        .overflow_scroll()
        .rounded(px(radius::MD))
        .bg(fade(t.muted, MUTED_SURFACE))
        .p(px(PRE_PADDING))
        .font_family(MONO_FONT)
        .text_size(px(PRE_TEXT))
        .line_height(px(PRE_LINE))
        .text_color(t.foreground)
        .whitespace_nowrap()
        .child(
            div().flex().flex_col().children(
                content
                    .split('\n')
                    .map(|line| SharedString::from(line.to_string())),
            ),
        )
}

fn dot(id: SharedString, model: &LocalDotView, t: &Tokens) -> AnyElement {
    let color = match model.tone {
        LocalDotTone::Destructive => t.destructive,
        LocalDotTone::Success => t.success,
        LocalDotTone::Warning => t.warning,
        LocalDotTone::Muted => fade(t.muted_foreground, IDLE_DOT),
    };
    div()
        .id(id)
        .flex()
        .flex_none()
        .size(px(DOT_BOX))
        .items_center()
        .justify_center()
        .rounded_full()
        .tooltip(Tooltip::text(model.tooltip.clone()))
        .child(div().size(px(DOT)).rounded_full().bg(color))
        .into_any_element()
}

fn metric(model: &LocalMetricView, t: &Tokens) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .min_w_0()
        .gap(px(METRIC_TEXT_GAP))
        .child(
            div()
                .text_size(px(text::XS))
                .line_height(px(text::XS_LINE))
                .text_color(t.muted_foreground)
                .child(SharedString::from(model.label.clone())),
        )
        .child(
            div()
                .text_size(px(text::BASE))
                .line_height(px(text::BASE_LINE))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.foreground)
                .child(SharedString::from(model.value.clone())),
        )
        .into_any_element()
}

fn metric_grid(metrics: &[LocalMetricView], t: &Tokens) -> AnyElement {
    div()
        .grid()
        .grid_cols(4)
        .gap(px(METRIC_GAP))
        .children(metrics.iter().map(|m| metric(m, t)))
        .into_any_element()
}

fn muted_xs(content: &str, t: &Tokens) -> Div {
    div()
        .text_size(px(text::XS))
        .line_height(px(text::XS_LINE))
        .text_color(t.muted_foreground)
        .child(SharedString::from(content.to_string()))
}

fn destructive_xs(content: &str, t: &Tokens) -> Div {
    muted_xs(content, t).text_color(t.destructive)
}

fn external_link(
    id: SharedString,
    label: &str,
    href: &str,
    icon_size: f32,
    color: Rgba,
    hover: Rgba,
    client: &Entity<CoreClient>,
) -> gpui::Stateful<Div> {
    let client = client.clone();
    let href = href.to_string();
    div()
        .id(id)
        .flex()
        .flex_none()
        .items_center()
        .cursor_pointer()
        .text_color(color)
        .hover(move |style| style.text_color(hover))
        .on_click(move |_, _, cx| send(&client, cx, "localOpenLink", json!({ "href": href })))
        .child(SharedString::from(label.to_string()))
        .child(
            svg()
                .path("icons/external-link.svg")
                .size(px(icon_size))
                .flex_none()
                .text_color(color),
        )
}

fn button_variant(name: &str) -> ButtonVariant {
    match name {
        "destructive" => ButtonVariant::Destructive,
        "outline" => ButtonVariant::Outline,
        _ => ButtonVariant::Default,
    }
}

fn blurred_host(host: &str, color: Rgba) -> AnyElement {
    let label = SharedString::from(host.to_string());
    div()
        .relative()
        .child(
            div()
                .text_color(gpui::transparent_black())
                .child(label.clone()),
        )
        .children(BLUR_LAYERS.iter().map(|(x, y)| {
            div()
                .absolute()
                .top(px(*y))
                .left(px(*x))
                .whitespace_nowrap()
                .text_color(fade(color, BLUR_ALPHA))
                .child(label.clone())
        }))
        .into_any_element()
}

impl LocalSection {
    fn machine(
        &self,
        index: usize,
        row: &LocalMachineView,
        page: &LocalPageView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let client = self.client.clone();
        let url = row.url.clone();
        let group = SharedString::from(format!("local-machine-{index}"));
        let hover_bg = fade(t.accent, HOVER_ROW);
        let foreground = t.foreground;
        let name_part: AnyElement = match self.name_inputs.get(&row.url) {
            Some(state) if row.editing.is_some() => {
                let escape_client = client.clone();
                let escape_url = url.clone();
                div()
                    .id(SharedString::from(format!("local-name-form-{index}")))
                    .w(px(NAME_INPUT_WIDTH))
                    .flex_none()
                    .on_click(|_, _, cx| cx.stop_propagation())
                    .on_key_down(move |event: &KeyDownEvent, window, cx| {
                        if event.keystroke.key != "escape" {
                            return;
                        }
                        cx.stop_propagation();
                        window.blur(cx);
                        send(
                            &escape_client,
                            cx,
                            "localEditName",
                            json!({ "url": escape_url, "value": null }),
                        );
                    })
                    .child(Input::new(state).size(InputSize::Sm).w_full())
                    .into_any_element()
            }
            _ => {
                let rename_client = client.clone();
                let rename_url = url.clone();
                let name = row.name.clone();
                div()
                    .flex()
                    .min_w_0()
                    .items_center()
                    .gap(px(NAME_GAP))
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .text_size(px(text::SM))
                            .line_height(px(text::SM_LINE))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.foreground)
                            .child(SharedString::from(row.name.clone())),
                    )
                    .when(row.can_rename, |this| {
                        this.child(
                            div()
                                .id(SharedString::from(format!("local-rename-{index}")))
                                .flex_none()
                                .cursor_pointer()
                                .opacity(0.)
                                .group_hover(group.clone(), |style| style.opacity(1.))
                                .text_color(t.muted_foreground)
                                .hover(move |style| style.text_color(foreground))
                                .tooltip(Tooltip::text(row.rename_label.clone()))
                                .on_click(move |_, _, cx| {
                                    cx.stop_propagation();
                                    send(
                                        &rename_client,
                                        cx,
                                        "localEditName",
                                        json!({ "url": rename_url, "value": name }),
                                    );
                                })
                                .child(
                                    svg()
                                        .path("icons/pencil.svg")
                                        .size(px(PENCIL))
                                        .text_color(t.muted_foreground),
                                ),
                        )
                    })
                    .into_any_element()
            }
        };
        let address_client = client.clone();
        let address_url = url.clone();
        let address = div()
            .id(SharedString::from(format!("local-address-{index}")))
            .flex_none()
            .cursor_pointer()
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .tooltip(Tooltip::text(row.address_toggle_label.clone()))
            .on_click(move |_, _, cx| {
                cx.stop_propagation();
                send(
                    &address_client,
                    cx,
                    "localToggleAddress",
                    json!({ "url": address_url }),
                );
            })
            .child(if row.reveal_address {
                div()
                    .text_color(t.muted_foreground)
                    .child(SharedString::from(row.host.clone()))
                    .into_any_element()
            } else {
                blurred_host(&row.host, t.muted_foreground)
            });
        let toggle_client = client.clone();
        let toggle_url = url.clone();
        let header = div()
            .id(SharedString::from(format!("local-machine-header-{index}")))
            .flex()
            .items_center()
            .gap(px(ROW_GAP))
            .px(px(ROW_X))
            .py(px(ROW_Y))
            .cursor_pointer()
            .hover(move |style| style.bg(hover_bg))
            .on_click(move |_, _, cx| {
                send(
                    &toggle_client,
                    cx,
                    "localToggleMachine",
                    json!({ "url": toggle_url }),
                )
            })
            .child(
                svg()
                    .path("icons/chevron-right.svg")
                    .size(px(CHEVRON))
                    .flex_none()
                    .text_color(t.muted_foreground)
                    .when(row.open, |this| {
                        this.with_transformation(Transformation::rotate(percentage(0.25)))
                    }),
            )
            .child(dot(
                SharedString::from(format!("local-machine-dot-{index}")),
                &row.dot,
                t,
            ))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .gap(px(TEXT_GAP))
                    .child(
                        div()
                            .flex()
                            .min_w_0()
                            .items_center()
                            .gap(px(NAME_GAP))
                            .child(name_part)
                            .child(address),
                    )
                    .child(muted_xs(&row.subtitle, t).truncate()),
            )
            .when_some(row.memory.as_ref(), |this, memory| {
                this.child(
                    div()
                        .flex()
                        .flex_col()
                        .flex_none()
                        .w(px(MEMORY_WIDTH))
                        .gap(px(MEMORY_GAP))
                        .child(
                            div()
                                .h(px(MEMORY_BAR))
                                .w_full()
                                .overflow_hidden()
                                .rounded_full()
                                .bg(t.muted)
                                .child(
                                    div()
                                        .h_full()
                                        .rounded_full()
                                        .bg(t.foreground)
                                        .w(relative(memory.percent / 100.)),
                                ),
                        )
                        .child(muted_xs(&memory.label, t).text_right()),
                )
            });
        div()
            .group(group.clone())
            .when(index > 0, |this| {
                this.border_t_1()
                    .border_color(fade(t.border, SUBTLE_BORDER))
            })
            .child(header)
            .when_some(row.details.as_deref(), |this, details| {
                this.child(self.details(index, row, details, page, t, cx))
            })
            .into_any_element()
    }

    fn details(
        &self,
        index: usize,
        row: &LocalMachineView,
        details: &LocalMachineDetailsView,
        page: &LocalPageView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let url = row.url.clone();
        let share = page.shares.iter().find(|share| share.url == row.url);
        div()
            .flex()
            .flex_col()
            .gap(px(DETAILS_GAP))
            .pr(px(ROW_X))
            .pl(px(DETAILS_INSET))
            .pb(px(DETAILS_BOTTOM))
            .child(metric_grid(&details.metrics, t))
            .children(details.endpoints.iter().enumerate().map(|(e, endpoint)| {
                let unload_client = self.client.clone();
                let share_client = self.client.clone();
                let unload_url = url.clone();
                let share_url = url.clone();
                let endpoint_id = endpoint.id.clone();
                let port = endpoint.port;
                div()
                    .flex()
                    .flex_col()
                    .gap(px(INLINE_GAP))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(INLINE_GAP))
                            .text_size(px(text::SM))
                            .line_height(px(text::SM_LINE))
                            .child(dot(
                                SharedString::from(format!("local-endpoint-dot-{index}-{e}")),
                                &endpoint.dot,
                                t,
                            ))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .truncate()
                                    .text_color(t.foreground)
                                    .child(SharedString::from(endpoint.models.clone())),
                            )
                            .child(muted_xs(&endpoint.port_label, t).flex_none())
                            .child(
                                Button::new(SharedString::from(format!(
                                    "local-unload-{index}-{e}"
                                )))
                                .size(ButtonSize::Xs)
                                .variant(button_variant(&endpoint.unload_variant))
                                .disabled(endpoint.unload_disabled)
                                .label(endpoint.unload_label.clone())
                                .on_click(move |_, _, cx| {
                                    send(
                                        &unload_client,
                                        cx,
                                        "localUnload",
                                        json!({ "url": unload_url, "endpointId": endpoint_id }),
                                    )
                                }),
                            )
                            .child(
                                Button::new(SharedString::from(format!("local-share-{index}-{e}")))
                                    .size(ButtonSize::Xs)
                                    .variant(ButtonVariant::Ghost)
                                    .label("Share")
                                    .on_click(move |_, _, cx| {
                                        send(
                                            &share_client,
                                            cx,
                                            "localToggleShare",
                                            json!({ "url": share_url, "port": port }),
                                        )
                                    }),
                            ),
                    )
                    .when(endpoint.sharing, |this| {
                        this.children(
                            share.map(|share| {
                                self.share_panel(index, &row.url, &share.panel, t, cx)
                            }),
                        )
                    })
                    .into_any_element()
            }))
            .children(details.jobs.iter().enumerate().map(|(j, job)| {
                let client = self.client.clone();
                let job_url = url.clone();
                let job_id = job.id.clone();
                div()
                    .flex()
                    .items_center()
                    .gap(px(INLINE_GAP))
                    .text_size(px(text::SM))
                    .line_height(px(text::SM_LINE))
                    .child(dot(
                        SharedString::from(format!("local-job-dot-{index}-{j}")),
                        &job.dot,
                        t,
                    ))
                    .child(
                        div()
                            .flex()
                            .flex_1()
                            .min_w_0()
                            .items_baseline()
                            .gap(px(JOB_DETAIL_GAP))
                            .overflow_hidden()
                            .child(
                                div()
                                    .flex_none()
                                    .text_color(t.foreground)
                                    .child(SharedString::from(job.recipe_id.clone())),
                            )
                            .child(muted_xs(&job.detail, t).min_w_0().truncate()),
                    )
                    .child(
                        Button::new(SharedString::from(format!("local-job-{index}-{j}")))
                            .size(ButtonSize::Xs)
                            .variant(ButtonVariant::Outline)
                            .disabled(job.button_disabled)
                            .label(job.button_label.clone())
                            .on_click(move |_, _, cx| {
                                send(
                                    &client,
                                    cx,
                                    "localStopJob",
                                    json!({ "url": job_url, "jobId": job_id }),
                                )
                            }),
                    )
                    .into_any_element()
            }))
            .child(match &details.picker {
                Some(picker) => self.picker(index, &row.url, picker, t),
                None => muted_xs(details.empty_recipes_message.as_deref().unwrap_or(""), t)
                    .into_any_element(),
            })
            .into_any_element()
    }

    fn picker(
        &self,
        index: usize,
        url: &str,
        picker: &LocalRecipePickerView,
        t: &Tokens,
    ) -> AnyElement {
        let choose_client = self.client.clone();
        let load_client = self.client.clone();
        let choose_url = url.to_string();
        let load_url = url.to_string();
        let mut select = Select::new(SharedString::from(format!("local-recipe-{index}")))
            .size(SelectSize::Sm)
            .match_trigger_width(false)
            .accessibility_label("Model to load")
            .value(picker.value.clone())
            .on_change(move |value, _, cx| {
                send(
                    &choose_client,
                    cx,
                    "localChooseRecipe",
                    json!({ "url": choose_url, "recipeId": value.to_string() }),
                )
            });
        for group in &picker.groups {
            select = select.group_label(group.label.clone());
            for recipe in &group.recipes {
                let label = picker
                    .items
                    .iter()
                    .find(|item| item.value == recipe.id)
                    .map(|item| item.label.clone())
                    .unwrap_or_else(|| recipe.model.clone());
                select = select.item(
                    SelectItem::new(recipe.id.clone(), label)
                        .disabled(recipe.disabled)
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .child(SharedString::from(recipe.model.clone()))
                                .child(muted_xs(&recipe.detail, t)),
                        ),
                );
            }
        }
        div()
            .flex()
            .flex_col()
            .gap(px(INLINE_GAP))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(px(INLINE_GAP))
                    .child(div().flex_1().min_w(px(PICKER_MIN_WIDTH)).child(select))
                    .child(
                        Button::new(SharedString::from(format!("local-load-{index}")))
                            .size(ButtonSize::Sm)
                            .variant(button_variant(&picker.load_variant))
                            .disabled(picker.load_disabled)
                            .label(picker.load_label.clone())
                            .on_click(move |_, _, cx| {
                                send(&load_client, cx, "localLoad", json!({ "url": load_url }))
                            }),
                    ),
            )
            .child(muted_xs(&picker.note, t))
            .into_any_element()
    }

    fn share_panel(
        &self,
        index: usize,
        url: &str,
        panel: &SharePanelView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let primary_client = self.client.clone();
        let decline_client = self.client.clone();
        let primary_url = url.to_string();
        let decline_url = url.to_string();
        div()
            .flex()
            .flex_col()
            .gap(px(INLINE_GAP))
            .rounded(px(radius::MD))
            .border_1()
            .border_color(fade(t.border, SUBTLE_BORDER))
            .p(px(PANEL_PADDING))
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE))
            .children(
                panel
                    .preparing_message
                    .as_deref()
                    .map(|message| muted_xs(message, t)),
            )
            .children(
                panel
                    .error
                    .as_deref()
                    .map(|message| destructive_xs(message, t)),
            )
            .when_some(panel.preview.as_ref(), |this, preview| {
                this.child(
                    div()
                        .text_color(t.foreground)
                        .child(SharedString::from(preview.title.clone())),
                )
                .children(preview.issues.iter().map(|issue| destructive_xs(issue, t)))
                .child(muted_xs(&preview.scrubbed, t))
                .children(preview.files.iter().map(|file| {
                    self.json_section(format!("share-{index}-{}", file.label), file, t, cx)
                }))
            })
            .child(match &panel.pull_request {
                Some(link) => external_link(
                    SharedString::from(format!("local-share-pr-{index}")),
                    &link.label,
                    &link.href,
                    LINK_ICON,
                    t.foreground,
                    t.foreground,
                    &self.client,
                )
                .gap(px(JSON_GAP))
                .font_weight(FontWeight::MEDIUM)
                .hover(|style| style.underline())
                .into_any_element(),
                None => div()
                    .flex()
                    .flex_col()
                    .gap(px(INLINE_GAP))
                    .children(
                        panel
                            .confirm_message
                            .as_deref()
                            .map(|message| muted_xs(message, t).text_color(t.foreground)),
                    )
                    .child(
                        div()
                            .flex()
                            .gap(px(INLINE_GAP))
                            .child(
                                Button::new(SharedString::from(format!(
                                    "local-share-primary-{index}"
                                )))
                                .size(ButtonSize::Xs)
                                .disabled(panel.primary_disabled)
                                .label(panel.primary_label.clone())
                                .on_click(move |_, _, cx| {
                                    send(
                                        &primary_client,
                                        cx,
                                        "localSharePrimary",
                                        json!({ "url": primary_url }),
                                    )
                                }),
                            )
                            .child(
                                Button::new(SharedString::from(format!(
                                    "local-share-decline-{index}"
                                )))
                                .size(ButtonSize::Xs)
                                .variant(ButtonVariant::Outline)
                                .disabled(panel.decline_disabled)
                                .label(panel.decline_label.clone())
                                .on_click(move |_, _, cx| {
                                    send(
                                        &decline_client,
                                        cx,
                                        "localShareDecline",
                                        json!({ "url": decline_url }),
                                    )
                                }),
                            ),
                    )
                    .into_any_element(),
            })
            .into_any_element()
    }

    fn machines(&self, page: &LocalPageView, t: &Tokens, cx: &mut Context<Self>) -> AnyElement {
        let machines = &page.page.machines;
        let client = self.client.clone();
        let mut section = SettingsSection::new(machines.title.clone()).header_action(
            Button::new("local-scan")
                .size(ButtonSize::Sm)
                .variant(ButtonVariant::Ghost)
                .disabled(machines.scan_disabled)
                .label(machines.scan_label.clone())
                .on_click(move |_, _, cx| send(&client, cx, "localScan", json!({}))),
        );
        let mut children: Vec<AnyElement> = machines
            .rows
            .iter()
            .enumerate()
            .map(|(index, row)| self.machine(index, row, page, t, cx))
            .collect();
        children.extend(machines.tailnet.iter().map(|device| {
            let client = self.client.clone();
            let ip = device.ip.clone();
            SettingsRow::new(
                SharedString::from(format!("local-tailnet-{}", device.ip)),
                device.title.clone(),
            )
            .description(device.description.clone())
            .control(
                Button::new(SharedString::from(format!(
                    "local-tailnet-btn-{}",
                    device.ip
                )))
                .size(ButtonSize::Sm)
                .variant(ButtonVariant::Outline)
                .disabled(device.button_disabled)
                .label(device.button_label.clone())
                .on_click(move |_, _, cx| {
                    send(&client, cx, "localTailnetDevice", json!({ "ip": ip }))
                }),
            )
            .into_any_element()
        }));
        if let Some(message) = &machines.loading_message {
            children.push(
                div()
                    .px(px(ROW_X))
                    .py(px(ROW_Y))
                    .text_size(px(text::SM))
                    .line_height(px(text::SM_LINE))
                    .text_color(t.muted_foreground)
                    .child(SharedString::from(message.clone()))
                    .into_any_element(),
            );
        }
        section = section.children(children);
        section.into_any_element()
    }

    fn registry(
        &mut self,
        page: &LocalPageView,
        t: &Tokens,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let registry = &page.registry;
        let filter = self.ensure_filter(registry, window, cx);
        let controller_client = self.client.clone();
        let all_client = self.client.clone();
        let header = div()
            .flex()
            .items_center()
            .gap(px(INLINE_GAP))
            .when(registry.show_machine_picker, |this| {
                this.child(
                    SettingsSelect::new("local-registry-machine")
                        .width(SettingsControlWidth::Fixed(REGISTRY_MACHINE_WIDTH))
                        .accessibility_label("Machine")
                        .value(Some(registry.controller.clone()))
                        .options(registry.machines.iter().map(|machine| {
                            SettingsSelectOption::new(machine.value.clone(), machine.label.clone())
                        }))
                        .on_change(move |value, _, cx| {
                            send(
                                &controller_client,
                                cx,
                                "localRegistrySetController",
                                json!({ "controller": value.to_string() }),
                            )
                        }),
                )
            })
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(SWITCH_LABEL_GAP))
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .text_color(t.muted_foreground)
                    .child(
                        Switch::new("local-registry-all")
                            .size(SwitchSize::Sm)
                            .checked(registry.all_hardware)
                            .accessibility_label(registry.all_hardware_label.clone())
                            .on_change(move |checked, _, _, cx| {
                                send(
                                    &all_client,
                                    cx,
                                    "localRegistrySetAll",
                                    json!({ "all": checked }),
                                )
                            }),
                    )
                    .child(SharedString::from(registry.all_hardware_label.clone())),
            );
        let foreground = t.foreground;
        let hover_bg = fade(t.accent, HOVER_ROW);
        let models: Vec<AnyElement> = registry
            .models
            .iter()
            .enumerate()
            .map(|(m, model)| {
                let client = self.client.clone();
                let repo = model.repo.clone();
                div()
                    .when(m > 0, |this| {
                        this.border_t_1()
                            .border_color(fade(t.border, SUBTLE_BORDER))
                    })
                    .child(
                        div()
                            .id(SharedString::from(format!("local-registry-model-{m}")))
                            .flex()
                            .w_full()
                            .items_center()
                            .gap(px(INLINE_GAP))
                            .py(px(REGISTRY_ROW_Y))
                            .cursor_pointer()
                            .hover(move |style| style.bg(hover_bg))
                            .on_click(move |_, _, cx| {
                                send(
                                    &client,
                                    cx,
                                    "localRegistryToggleModel",
                                    json!({ "repo": repo }),
                                )
                            })
                            .child(
                                svg()
                                    .path("icons/chevron-right.svg")
                                    .size(px(CHEVRON))
                                    .flex_none()
                                    .text_color(t.muted_foreground)
                                    .when(model.expanded, |this| {
                                        this.with_transformation(Transformation::rotate(
                                            percentage(0.25),
                                        ))
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
                                            .text_color(foreground)
                                            .child(SharedString::from(model.repo.clone())),
                                    )
                                    .child(muted_xs(&model.summary, t).truncate()),
                            )
                            .child(muted_xs(&model.variant_count, t).flex_none()),
                    )
                    .when(model.expanded, |this| {
                        this.child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(INLINE_GAP))
                                .pb(px(REGISTRY_VARIANTS_BOTTOM))
                                .pl(px(REGISTRY_VARIANTS_INSET))
                                .children(model.variants.iter().enumerate().map(|(v, variant)| {
                                    let client = self.client.clone();
                                    let id = (!variant.inspecting).then(|| variant.id.clone());
                                    div()
                                        .flex()
                                        .flex_col()
                                        .gap(px(INLINE_GAP))
                                        .child(
                                            div()
                                                .flex()
                                                .items_center()
                                                .gap(px(INLINE_GAP))
                                                .text_size(px(text::XS))
                                                .line_height(px(text::XS_LINE))
                                                .child(
                                                    div()
                                                        .flex_1()
                                                        .min_w_0()
                                                        .truncate()
                                                        .text_color(if variant.fits {
                                                            t.foreground
                                                        } else {
                                                            t.muted_foreground
                                                        })
                                                        .child(SharedString::from(
                                                            variant.summary.clone(),
                                                        )),
                                                )
                                                .child(
                                                    Button::new(SharedString::from(format!(
                                                        "local-inspect-{m}-{v}"
                                                    )))
                                                    .size(ButtonSize::Xs)
                                                    .variant(ButtonVariant::Ghost)
                                                    .label(variant.inspect_label.clone())
                                                    .on_click(move |_, _, cx| {
                                                        send(
                                                            &client,
                                                            cx,
                                                            "localRegistryInspect",
                                                            json!({ "id": id }),
                                                        )
                                                    }),
                                                ),
                                        )
                                        .when(variant.inspecting, |this| {
                                            this.children(
                                                page.inspect.as_ref().map(|inspect| {
                                                    self.inspect(m, v, inspect, t, cx)
                                                }),
                                            )
                                        })
                                        .into_any_element()
                                })),
                        )
                    })
                    .into_any_element()
            })
            .collect();
        let more_client = self.client.clone();
        SettingsSection::new(registry.title.clone())
            .header_action(header)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(ROW_GAP))
                    .px(px(ROW_X))
                    .py(px(ROW_Y))
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .items_center()
                            .gap(px(INLINE_GAP))
                            .child(
                                div()
                                    .w(px(REGISTRY_FILTER_WIDTH))
                                    .flex_none()
                                    .child(Input::new(&filter).size(InputSize::Sm).w_full()),
                            )
                            .child(muted_xs(&registry.status, t)),
                    )
                    .children(
                        registry
                            .empty_message
                            .as_deref()
                            .map(|message| muted_xs(message, t)),
                    )
                    .child(div().flex().flex_col().children(models))
                    .when_some(registry.show_more.as_ref(), |this, more| {
                        this.child(
                            div().flex().child(
                                Button::new("local-registry-more")
                                    .size(ButtonSize::Sm)
                                    .variant(ButtonVariant::Ghost)
                                    .label(more.label.clone())
                                    .on_click(move |_, _, cx| {
                                        send(&more_client, cx, "localRegistryShowMore", json!({}))
                                    }),
                            ),
                        )
                    }),
            )
            .into_any_element()
    }

    fn inspect(
        &self,
        m: usize,
        v: usize,
        inspect: &RegistryInspectView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        match inspect {
            RegistryInspectView::Error { message } => destructive_xs(message, t).into_any_element(),
            RegistryInspectView::Loading { message } => muted_xs(message, t).into_any_element(),
            RegistryInspectView::Ready {
                command,
                copy_label,
                copy_disabled,
                download_label,
                download_disabled,
                weights,
                sections,
            } => {
                let copy_client = self.client.clone();
                let download_client = self.client.clone();
                div()
                    .flex()
                    .flex_col()
                    .gap(px(INLINE_GAP))
                    .rounded(px(radius::MD))
                    .border_1()
                    .border_color(fade(t.border, SUBTLE_BORDER))
                    .p(px(PANEL_PADDING))
                    .when_some(command.as_deref(), |this, command| {
                        this.child(pre_block(
                            SharedString::from(format!("local-command-{m}-{v}")),
                            command,
                            t,
                        ))
                    })
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .items_center()
                            .gap(px(INLINE_GAP))
                            .child(
                                Button::new(SharedString::from(format!("local-copy-{m}-{v}")))
                                    .size(ButtonSize::Xs)
                                    .variant(ButtonVariant::Outline)
                                    .disabled(*copy_disabled)
                                    .label(copy_label.clone())
                                    .on_click(move |_, _, cx| {
                                        send(&copy_client, cx, "localRegistryCopy", json!({}))
                                    }),
                            )
                            .child(
                                Button::new(SharedString::from(format!("local-download-{m}-{v}")))
                                    .size(ButtonSize::Xs)
                                    .variant(ButtonVariant::Outline)
                                    .disabled(*download_disabled)
                                    .label(download_label.clone())
                                    .on_click(move |_, _, cx| {
                                        send(
                                            &download_client,
                                            cx,
                                            "localRegistryDownload",
                                            json!({}),
                                        )
                                    }),
                            )
                            .when_some(weights.as_ref(), |this, weights| {
                                this.child(
                                    external_link(
                                        SharedString::from(format!("local-weights-{m}-{v}")),
                                        &weights.label,
                                        &weights.href,
                                        LINK_ICON,
                                        t.muted_foreground,
                                        t.foreground,
                                        &self.client,
                                    )
                                    .gap(px(JSON_GAP))
                                    .text_size(px(text::XS))
                                    .line_height(px(text::XS_LINE)),
                                )
                            }),
                    )
                    .children(sections.iter().map(|section| {
                        self.json_section(
                            format!("inspect-{m}-{v}-{}", section.label),
                            section,
                            t,
                            cx,
                        )
                    }))
                    .into_any_element()
            }
        }
    }

    fn usage(&self, usage: &LocalUsageView, t: &Tokens) -> AnyElement {
        let row_hover = fade(t.muted, HOVER_TABLE);
        let cell = |value: &str| {
            div()
                .flex_1()
                .py(px(TABLE_CELL_Y))
                .text_right()
                .text_color(t.muted_foreground)
                .child(SharedString::from(value.to_string()))
        };
        SettingsSection::new("Usage")
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(USAGE_GAP))
                    .px(px(ROW_X))
                    .py(px(USAGE_Y))
                    .child(metric_grid(&usage.metrics, t))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(CHART_GAP))
                            .child(
                                div()
                                    .text_size(px(text::SM))
                                    .line_height(px(text::SM_LINE))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(t.foreground)
                                    .child(SharedString::from(usage.chart_title.clone())),
                            )
                            .child(
                                UsageProviderChart::new("local-usage-chart", usage.chart.clone())
                                    .mark_override("codex", "icons/server.svg"),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .w_full()
                            .text_size(px(text::SM))
                            .line_height(px(text::SM_LINE))
                            .child(
                                div()
                                    .flex()
                                    .border_b_1()
                                    .border_color(t.border)
                                    .text_size(px(text::XS))
                                    .line_height(px(text::XS_LINE))
                                    .text_color(t.muted_foreground)
                                    .child(
                                        div().w(relative(0.5)).py(px(TABLE_CELL_Y)).child("Model"),
                                    )
                                    .children(usage.columns.iter().map(|label| cell(label))),
                            )
                            .children(usage.rows.iter().enumerate().map(|(r, row)| {
                                div()
                                    .id(SharedString::from(format!("local-usage-row-{r}")))
                                    .flex()
                                    .border_b_1()
                                    .border_color(fade(t.border, TABLE_ROW_BORDER))
                                    .hover(move |style| style.bg(row_hover))
                                    .child(
                                        div()
                                            .w(relative(0.5))
                                            .py(px(TABLE_CELL_Y))
                                            .truncate()
                                            .text_color(t.foreground)
                                            .child(SharedString::from(row.model.clone())),
                                    )
                                    .child(cell(&row.requests))
                                    .child(cell(&row.share))
                                    .child(cell(&row.tokens))
                            })),
                    )
                    .child(muted_xs(&usage.footnote, t)),
            )
            .into_any_element()
    }

    fn about(&self, page: &LocalPageView, t: &Tokens) -> AnyElement {
        let about = &page.page.about;
        SettingsSection::new(about.title.clone())
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(ABOUT_GAP))
                    .px(px(ROW_X))
                    .py(px(USAGE_Y))
                    .text_size(px(text::SM))
                    .line_height(px(text::SM_LINE))
                    .text_color(t.muted_foreground)
                    .children(
                        about
                            .paragraphs
                            .iter()
                            .map(|paragraph| div().child(SharedString::from(paragraph.clone()))),
                    )
                    .child(
                        div().flex().child(
                            external_link(
                                "local-about-link".into(),
                                &about.link.label,
                                &about.link.href,
                                ABOUT_LINK_ICON,
                                t.foreground,
                                t.foreground,
                                &self.client,
                            )
                            .gap(px(ABOUT_LINK_GAP))
                            .font_weight(FontWeight::MEDIUM)
                            .hover(|style| style.underline()),
                        ),
                    ),
            )
            .into_any_element()
    }
}

impl Render for LocalSection {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = theme::active(cx);
        let Some(page) = self.view.read(cx).data.clone().flatten() else {
            return div().into_any_element();
        };
        self.sync_name_inputs(&page.page.machines.rows, window, cx);
        let machines = self.machines(&page, &t, cx);
        let registry = self.registry(&page, &t, window, cx);
        div()
            .flex()
            .flex_col()
            .w_full()
            .gap(px(PAGE_GAP))
            .when_some(page.page.error.as_deref(), |this, error| {
                this.child(
                    div()
                        .text_size(px(text::SM))
                        .line_height(px(text::SM_LINE))
                        .text_color(t.destructive)
                        .child(SharedString::from(error.to_string())),
                )
            })
            .child(machines)
            .child(registry)
            .child(self.usage(&page.page.usage, &t))
            .child(self.about(&page, &t))
            .into_any_element()
    }
}
