use std::collections::HashMap;

use gpui::component::input::{InputEvent, InputState, TextareaState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, Context, Entity, Focusable, FontWeight, InteractiveElement,
    IntoElement, ParentElement, Render, SharedString, StatefulInteractiveElement, Styled,
    Transformation, Window, div, img, percentage, px, svg,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::settings_source_control::{
    BitbucketCredentialsView, GitFetchIntervalView, InstructionsEditorView, SourceControlRowView,
    SourceControlScanButtonView, SourceControlSettingsView, SourceControlSummaryView,
    WriterModelControlView,
};
use crate::features::chat::model_picker::ModelPickerActions;
use crate::features::pull_requests::presentation::refresh_icon;
use crate::features::settings::model_controls::SettingsModelActions;
use crate::features::settings::primitives::{
    PolicyTooltip, SettingResetButton, SettingsControlWidth, SettingsRow, SettingsSection,
    SettingsSelect, SettingsSelectOption, settings_stack, settings_switch, settings_target,
};
use crate::features::settings::project_defaults::{
    PROJECT_DEFAULTS_PICKER, SectionModelPicker, project_defaults_section,
};
use crate::platform::MONO_FONT;
use crate::ui::badge::{Badge, BadgeSize, BadgeVariant};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::empty::Empty;
use crate::ui::input::{Input, InputSize};
use crate::ui::label::Label;
use crate::ui::number_field::{NumberField, NumberFieldSize};
use crate::ui::skeleton::{Skeleton, SkeletonShape};
use crate::ui::textarea::Textarea;
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::toggle::Toggle;
use crate::ui::toggle_group::ToggleGroup;
use crate::ui::tooltip::Tooltip;

const WRITER_PICKER: &str = "writer-model";
const ROW_PADDING_X: f32 = 16.;
const ROW_PADDING_Y: f32 = 12.;
const ROW_GAP: f32 = 12.;
const ROW_RADIUS: f32 = 12.;
const MARK_BOX: f32 = 20.;
const MARK_ICON: f32 = 18.;
const STATUS_DOT: f32 = 8.;
const STATUS_RING: f32 = 2.;
const TITLE_GAP: f32 = 8.;
const SUMMARY_GAP: f32 = 4.;
const DETAILS_PADDING_TOP: f32 = 4.;
const DETAILS_PADDING_BOTTOM: f32 = 16.;
const CHEVRON: f32 = 14.;
const HOVER_FILL: f32 = 0.2;
const COMING_SOON_OPACITY: f32 = 0.8;
const SUMMARY_OPACITY: f32 = 0.8;
const MUTED_DOT_OPACITY: f32 = 0.35;
const FETCH_INPUT_WIDTH: f32 = 128.;
const FETCH_GAP: f32 = 12.;
const DESCRIPTION_MAX: f32 = 672.;
const RELAXED_LINE: f32 = 19.5;
const FORM_GAP: f32 = 16.;
const FIELD_GAP: f32 = 6.;
const WRITING_SELECT_WIDTH: f32 = 224.;
const EDITOR_MARGIN_TOP: f32 = 12.;
const EDITOR_PADDING_BOTTOM: f32 = 14.;
const EDITOR_GAP: f32 = 8.;
const SCAN_ICON: f32 = 14.;
const REFRESH_SPIN_ID: &str = "source-control-scan-spin";

const MODEL_ACTIONS: SettingsModelActions = SettingsModelActions {
    open: "settingsSourceControlPickerOpen",
    close: "settingsSourceControlPickerClose",
    search: "settingsSourceControlPickerSearch",
    traits: "settingsSourceControlTraitsSelect",
    picker: ModelPickerActions {
        rail: "settingsSourceControlPickerRail",
        select: "settingsSourceControlPickerSelect",
        favorite: "settingsSourceControlPickerFavorite",
        toggle_legacy: "settingsSourceControlPickerToggleLegacy",
        close: "settingsSourceControlPickerClose",
        setup: Some("settingsSourceControlPickerSetup"),
    },
};

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

fn source_control_icon(icon: &str) -> Option<(&'static str, bool)> {
    match icon {
        "github" => Some(("icons/source-control/github.svg", false)),
        "gitlab" => Some(("icons/source-control/gitlab.svg", true)),
        "forgejo" => Some(("icons/source-control/forgejo.svg", true)),
        "azure-devops" => Some(("icons/source-control/azure-devops.svg", true)),
        "bitbucket" => Some(("icons/source-control/bitbucket.svg", true)),
        "git" => Some(("icons/source-control/git.svg", true)),
        "jj" => Some(("icons/source-control/jj.svg", true)),
        _ => None,
    }
}

fn status_color(tone: &str, t: &Tokens) -> gpui::Rgba {
    match tone {
        "warning" => t.warning,
        "success" => t.success,
        _ => fade(t.muted_foreground, MUTED_DOT_OPACITY),
    }
}

pub struct SourceControlSection {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<SourceControlSettingsView>>>,
    picker: SectionModelPicker,
    fetch: Option<(Entity<InputState>, f64)>,
    bitbucket: HashMap<String, Entity<InputState>>,
    custom: Option<(Entity<TextareaState>, String)>,
    bulk: Option<Entity<TextareaState>>,
}

impl SourceControlSection {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<SourceControlSettingsView>>(
            &client,
            "settingsSourceControl",
            json!({}),
            cx,
        );
        cx.observe(&view, |_, _, cx| cx.notify()).detach();
        act(&client, cx, "settingsSourceControlMount", json!({}));
        let picker = SectionModelPicker::new(MODEL_ACTIONS, cx);
        Self {
            client,
            view,
            picker,
            fetch: None,
            bitbucket: HashMap::new(),
            custom: None,
            bulk: None,
        }
    }

    fn sync(
        &mut self,
        view: &SourceControlSettingsView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.picker
            .sync(view.model_picker.as_ref(), &self.client, window, cx);
        let fetch_open = matches!(&view.discovery, crate::app_core::views::settings_source_control::SourceControlDiscoveryView::Discovered { sections } if sections.iter().any(|section| section.rows.iter().any(|row| row.expanded && row.details.as_ref().is_some_and(|details| details.kind == "git-fetch-interval"))));
        if fetch_open {
            let value = view.git_fetch.value_seconds;
            match &self.fetch {
                Some((state, shown)) => {
                    if *shown != value && !state.read(cx).focus_handle(cx).is_focused(window) {
                        let next = format!("{value}");
                        state.update(cx, |state, cx| state.set_value(next, window, cx));
                    }
                    self.fetch = Some((state.clone(), value));
                }
                None => {
                    let state = cx.new(|cx| {
                        let mut state = InputState::new(window, cx);
                        state.set_value(format!("{value}"), window, cx);
                        state
                    });
                    let client = self.client.clone();
                    cx.subscribe_in(
                        &state,
                        window,
                        move |section: &mut Self, state, event: &InputEvent, _, cx| {
                            if let InputEvent::Change = event {
                                let raw = state.read(cx).value().to_string();
                                let trimmed = raw.trim();
                                let seconds = if trimmed.is_empty() {
                                    None
                                } else {
                                    match trimmed.parse::<f64>() {
                                        Ok(seconds) => Some(seconds),
                                        Err(_) => return,
                                    }
                                };
                                if let (Some(seconds), Some((_, shown))) = (seconds, &section.fetch)
                                    && (seconds - *shown).abs() < f64::EPSILON
                                {
                                    return;
                                }
                                act(
                                    &client,
                                    cx,
                                    "settingsSourceControlFetchInterval",
                                    json!({ "seconds": seconds }),
                                );
                            }
                        },
                    )
                    .detach();
                    self.fetch = Some((state, value));
                }
            }
        } else {
            self.fetch = None;
        }

        match &view.bitbucket {
            Some(bitbucket) => {
                let live: Vec<String> = bitbucket
                    .fields
                    .iter()
                    .map(|field| field.field.clone())
                    .collect();
                self.bitbucket.retain(|field, _| live.contains(field));
                for field in &bitbucket.fields {
                    let state = match self.bitbucket.get(&field.field) {
                        Some(state) => state.clone(),
                        None => {
                            let masked = field.input_type == "password";
                            let state = cx.new(|cx| InputState::new(window, cx));
                            state.update(cx, |state, cx| state.set_masked(masked, window, cx));
                            let client = self.client.clone();
                            let name = field.field.clone();
                            cx.subscribe_in(
                                &state,
                                window,
                                move |_: &mut Self, state, event: &InputEvent, _, cx| match event {
                                    InputEvent::Change => {
                                        let value = state.read(cx).value().to_string();
                                        act(
                                            &client,
                                            cx,
                                            "settingsSourceControlBitbucketField",
                                            json!({ "field": name, "value": value }),
                                        );
                                    }
                                    InputEvent::PressEnter { .. } => {
                                        act(
                                            &client,
                                            cx,
                                            "settingsSourceControlBitbucketSave",
                                            json!({}),
                                        );
                                    }
                                    _ => {}
                                },
                            )
                            .detach();
                            self.bitbucket.insert(field.field.clone(), state.clone());
                            state
                        }
                    };
                    state.update(cx, |state, cx| {
                        state.set_placeholder(field.placeholder.clone(), window, cx);
                        if state.value() != field.value.as_str() {
                            state.set_value(field.value.clone(), window, cx);
                        }
                    });
                }
            }
            None => self.bitbucket.clear(),
        }

        match &view.writing.writing_style.editor {
            InstructionsEditorView::Custom { value, placeholder } => match &self.custom {
                Some((_, shown)) if shown == value => {}
                Some((state, _)) => {
                    let state = state.clone();
                    state.update(cx, |state, cx| {
                        state.set_value(value.clone(), window, cx);
                        state.set_placeholder(placeholder.clone(), window, cx);
                    });
                    self.custom = Some((state, value.clone()));
                }
                None => {
                    let state = cx.new(|cx| TextareaState::new(window, cx).auto_grow(4, 12));
                    state.update(cx, |state, cx| {
                        state.set_value(value.clone(), window, cx);
                        state.set_placeholder(placeholder.clone(), window, cx);
                    });
                    let client = self.client.clone();
                    cx.subscribe_in(
                        &state,
                        window,
                        move |_: &mut Self, state, event: &InputEvent, _, cx| {
                            if let InputEvent::Blur = event {
                                let value = state.read(cx).value().to_string();
                                act(
                                    &client,
                                    cx,
                                    "settingsSourceControlCustomInstructions",
                                    json!({ "value": value }),
                                );
                            }
                        },
                    )
                    .detach();
                    self.custom = Some((state, value.clone()));
                }
            },
            _ => self.custom = None,
        }

        match &view.writing.writing_style.editor {
            InstructionsEditorView::BulkEditing {
                draft, placeholder, ..
            } => {
                if self.bulk.is_none() {
                    let state = cx.new(|cx| TextareaState::new(window, cx).auto_grow(4, 12));
                    state.update(cx, |state, cx| {
                        state.set_value(draft.clone(), window, cx);
                        state.set_placeholder(placeholder.clone(), window, cx);
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
                                    "settingsSourceControlBulkDraft",
                                    json!({ "value": value }),
                                );
                            }
                        },
                    )
                    .detach();
                    self.bulk = Some(state);
                }
            }
            _ => self.bulk = None,
        }
    }

    fn scan_button(&self, button: &SourceControlScanButtonView, t: &Tokens) -> AnyElement {
        let client = self.client.clone();
        div()
            .id("source-control-scan-tip")
            .flex_none()
            .tooltip(Tooltip::text(button.tooltip.clone()))
            .child(
                Button::new("source-control-scan")
                    .size(ButtonSize::IconXs)
                    .variant(ButtonVariant::GhostMuted)
                    .disabled(button.disabled)
                    .on_click(move |_, _, cx| {
                        act(&client, cx, "settingsSourceControlScan", json!({}))
                    })
                    .child(refresh_icon(
                        REFRESH_SPIN_ID,
                        SCAN_ICON,
                        t.muted_foreground,
                        button.refreshing,
                    )),
            )
            .into_any_element()
    }

    fn mark(row: &SourceControlRowView, t: &Tokens) -> AnyElement {
        let dot = status_color(&row.status_tone, t);
        match row.icon.as_deref().and_then(source_control_icon) {
            None => div()
                .flex_none()
                .size(px(STATUS_DOT))
                .rounded_full()
                .bg(dot)
                .into_any_element(),
            Some((path, multicolor)) => {
                let glyph = if multicolor {
                    img(path).size(px(MARK_ICON)).flex_none().into_any_element()
                } else {
                    svg()
                        .path(path)
                        .size(px(MARK_ICON))
                        .flex_none()
                        .text_color(fade(t.foreground, 0.8))
                        .into_any_element()
                };
                div()
                    .relative()
                    .flex()
                    .flex_none()
                    .size(px(MARK_BOX))
                    .items_center()
                    .justify_center()
                    .child(glyph)
                    .child(
                        div()
                            .absolute()
                            .top(px(-STATUS_DOT / 4. - STATUS_RING))
                            .left(px(-STATUS_DOT / 4. - STATUS_RING))
                            .size(px(STATUS_DOT + STATUS_RING * 2.))
                            .rounded_full()
                            .bg(t.background)
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(div().size(px(STATUS_DOT)).rounded_full().bg(dot)),
                    )
                    .into_any_element()
            }
        }
    }

    fn summary(&self, row: &SourceControlRowView, t: &Tokens) -> AnyElement {
        let line = div()
            .flex()
            .flex_wrap()
            .items_center()
            .min_w_0()
            .gap_x(px(SUMMARY_GAP))
            .text_size(px(text::XS))
            .line_height(px(18.))
            .text_color(fade(t.muted_foreground, SUMMARY_OPACITY));
        match &row.summary {
            SourceControlSummaryView::Text { text: value } => {
                line.child(value.clone()).into_any_element()
            }
            SourceControlSummaryView::CliSignIn {
                before,
                executable,
                after,
            } => line
                .child(
                    div()
                        .child(before.clone())
                        .child(
                            div()
                                .rounded(px(radius::XS + 2.))
                                .bg(t.muted)
                                .px(px(4.))
                                .font_family(MONO_FONT)
                                .text_size(px(text::XXS))
                                .child(executable.clone()),
                        )
                        .child(after.clone())
                        .flex()
                        .flex_wrap()
                        .items_center(),
                )
                .into_any_element(),
            SourceControlSummaryView::Authenticated {
                text: value,
                account_prefix,
                ..
            } => {
                let account = row.account.as_ref().map(|account| {
                    let client = self.client.clone();
                    let row_id = row.id.clone();
                    let hover = t.foreground;
                    div()
                        .id(SharedString::from(format!(
                            "source-control-account-{}",
                            row.id
                        )))
                        .min_w_0()
                        .cursor_pointer()
                        .rounded(px(radius::XS + 2.))
                        .font_family(MONO_FONT)
                        .text_size(px(text::XXS))
                        .text_color(t.muted_foreground)
                        .when(!account.revealed, |s| s.opacity(0.55))
                        .hover(move |s| s.text_color(hover))
                        .tooltip(Tooltip::text(account.tooltip.clone()))
                        .on_click(move |_, _, cx| {
                            act(
                                &client,
                                cx,
                                "settingsSourceControlRevealAccount",
                                json!({ "rowId": row_id }),
                            )
                        })
                        .child(account.text.clone())
                });
                line.child(value.clone())
                    .when_some(account, |line, account| {
                        line.child(account_prefix.clone()).child(account)
                    })
                    .into_any_element()
            }
        }
    }

    fn fetch_details(&self, model: &GitFetchIntervalView, t: &Tokens, cx: &App) -> AnyElement {
        let reset = model.can_reset.then(|| {
            let client = self.client.clone();
            SettingResetButton::new("git-fetch-interval-reset", model.reset_label.clone()).on_click(
                move |_, cx| {
                    act(
                        &client,
                        cx,
                        "settingsSourceControlFetchIntervalReset",
                        json!({}),
                    )
                },
            )
        });
        let input = self.fetch.as_ref().map(|(state, _)| {
            NumberField::new("git-fetch-interval-field", state)
                .size(NumberFieldSize::Sm)
                .min(model.min_seconds)
                .step(model.step_seconds)
                .w(px(FETCH_INPUT_WIDTH))
        });
        settings_target(
            model.id.clone(),
            div()
                .flex()
                .items_start()
                .justify_between()
                .gap(px(FETCH_GAP))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .min_w_0()
                        .gap(px(4.))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(4.))
                                .child(
                                    div()
                                        .text_size(px(text::XS))
                                        .line_height(px(text::XS_LINE))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(t.foreground)
                                        .child(model.title.clone()),
                                )
                                .child(PolicyTooltip::new(
                                    "git-fetch-policy",
                                    model.policy_tooltip.clone(),
                                ))
                                .child(
                                    div()
                                        .flex()
                                        .flex_none()
                                        .size(px(20.))
                                        .items_center()
                                        .justify_center()
                                        .children(reset),
                                ),
                        )
                        .child(
                            div()
                                .max_w(px(DESCRIPTION_MAX))
                                .text_size(px(text::XS))
                                .line_height(px(RELAXED_LINE))
                                .text_color(t.muted_foreground)
                                .child(model.description.clone()),
                        ),
                )
                .child(
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .gap(px(8.))
                        .children(input)
                        .child(
                            div()
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .text_color(t.muted_foreground)
                                .child(model.unit_label.clone()),
                        ),
                ),
            cx,
        )
        .into_any_element()
    }

    fn bitbucket_form(&self, model: &BitbucketCredentialsView, t: &Tokens) -> AnyElement {
        let locked = model.locked;
        let mut group = ToggleGroup::new("bitbucket-method");
        for option in &model.method_options {
            let client = self.client.clone();
            let value = option.value.clone();
            group = group.item(
                Toggle::new(SharedString::from(format!(
                    "bitbucket-method-{}",
                    option.value
                )))
                .label(option.label.clone())
                .pressed(option.value == model.method)
                .disabled(locked)
                .on_change(move |_, _, _, cx| {
                    act(
                        &client,
                        cx,
                        "settingsSourceControlBitbucketMethod",
                        json!({ "value": value }),
                    )
                }),
            );
        }
        let link = model.link.clone();
        let link_color = t.foreground;
        let description = div()
            .max_w(px(DESCRIPTION_MAX))
            .text_size(px(text::XS))
            .line_height(px(RELAXED_LINE))
            .text_color(t.muted_foreground)
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap_x(px(4.))
                    .child(model.description.clone())
                    .child(
                        div()
                            .id("bitbucket-link")
                            .flex()
                            .items_center()
                            .gap(px(4.))
                            .cursor_pointer()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(link_color)
                            .hover(|s| s.underline())
                            .on_click(move |_, _, cx| cx.open_url(&link))
                            .child(model.link_label.clone())
                            .child(
                                svg()
                                    .path("icons/external-link.svg")
                                    .size(px(12.))
                                    .flex_none()
                                    .text_color(link_color),
                            ),
                    ),
            );
        let fields = model.fields.iter().filter_map(|field| {
            let state = self.bitbucket.get(&field.field)?;
            Some(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(FIELD_GAP))
                    .child(Label::new(field.label.clone()))
                    .child(Input::new(state).size(InputSize::Sm).disabled(locked)),
            )
        });
        let remove = model.show_remove.then(|| {
            let client = self.client.clone();
            Button::new("bitbucket-remove")
                .size(ButtonSize::Xs)
                .variant(ButtonVariant::Outline)
                .label(model.remove_label.clone())
                .disabled(model.remove_disabled || locked)
                .on_click(move |_, _, cx| {
                    act(
                        &client,
                        cx,
                        "settingsSourceControlBitbucketRemove",
                        json!({}),
                    )
                })
        });
        let save_client = self.client.clone();
        div()
            .flex()
            .flex_col()
            .gap(px(FORM_GAP))
            .child(div().flex().child(group))
            .child(description)
            .children(fields)
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(12.))
                    .child(
                        div()
                            .text_size(px(text::XS))
                            .line_height(px(text::XS_LINE))
                            .text_color(t.muted_foreground)
                            .children(model.footnote.clone()),
                    )
                    .child(
                        div().flex().flex_none().gap(px(8.)).children(remove).child(
                            Button::new("bitbucket-save")
                                .size(ButtonSize::Xs)
                                .label(model.save_label.clone())
                                .disabled(model.save_disabled || locked)
                                .on_click(move |_, _, cx| {
                                    act(
                                        &save_client,
                                        cx,
                                        "settingsSourceControlBitbucketSave",
                                        json!({}),
                                    )
                                }),
                        ),
                    ),
            )
            .into_any_element()
    }

    fn discovery_row(
        &self,
        row: &SourceControlRowView,
        view: &SourceControlSettingsView,
        first: bool,
        last: bool,
        t: &Tokens,
        cx: &App,
    ) -> AnyElement {
        let details = row
            .details
            .as_ref()
            .and_then(|details| match details.kind.as_str() {
                "git-fetch-interval" => Some(self.fetch_details(&view.git_fetch, t, cx)),
                "bitbucket-credentials" => view.bitbucket.as_ref().map(|bitbucket| {
                    settings_target(
                        bitbucket.search_target_id.clone(),
                        self.bitbucket_form(bitbucket, t),
                        cx,
                    )
                    .into_any_element()
                }),
                _ => None,
            });
        let has_details = details.is_some();
        let expanded = row.expanded;
        let hover = fade(t.muted, HOVER_FILL);
        let toggle = has_details.then(|| {
            let client = self.client.clone();
            let row_id = row.id.clone();
            Button::new(SharedString::from(format!(
                "source-control-toggle-{}",
                row.id
            )))
            .size(ButtonSize::IconXs)
            .variant(ButtonVariant::GhostMuted)
            .on_click(move |_, _, cx| {
                act(
                    &client,
                    cx,
                    "settingsSourceControlToggleRow",
                    json!({ "rowId": row_id }),
                )
            })
            .child(
                svg()
                    .path("icons/chevron-down.svg")
                    .size(px(CHEVRON))
                    .flex_none()
                    .text_color(t.muted_foreground)
                    .when(expanded, |s| {
                        s.with_transformation(Transformation::rotate(percentage(0.5)))
                    }),
            )
        });
        let switch = row.show_availability_switch.then(|| {
            settings_switch(
                SharedString::from(format!("source-control-enabled-{}", row.id)),
                row.enabled,
            )
            .disabled(true)
        });
        div()
            .id(SharedString::from(format!("source-control-row-{}", row.id)))
            .when(first, |s| s.rounded_t(px(ROW_RADIUS)))
            .when(last, |s| s.rounded_b(px(ROW_RADIUS)))
            .when(row.coming_soon, |s| s.opacity(COMING_SOON_OPACITY))
            .hover(move |s| s.bg(hover))
            .child(
                div()
                    .px(px(ROW_PADDING_X))
                    .py(px(ROW_PADDING_Y))
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(ROW_GAP))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .gap(px(4.))
                            .child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .min_w_0()
                                    .items_center()
                                    .gap(px(TITLE_GAP))
                                    .child(Self::mark(row, t))
                                    .child(
                                        div()
                                            .truncate()
                                            .text_size(px(text::SM))
                                            .line_height(px(text::SM_LINE))
                                            .font_weight(FontWeight::MEDIUM)
                                            .text_color(t.foreground)
                                            .child(row.label.clone()),
                                    )
                                    .children(row.version.clone().map(|version| {
                                        div()
                                            .font_family(MONO_FONT)
                                            .text_size(px(text::XS))
                                            .line_height(px(text::XS_LINE))
                                            .text_color(t.muted_foreground)
                                            .child(version)
                                    }))
                                    .children(row.badges.iter().map(|badge| {
                                        Badge::new()
                                            .variant(BadgeVariant::Warning)
                                            .size(BadgeSize::Sm)
                                            .label(badge.label.clone())
                                    })),
                            )
                            .child(self.summary(row, t)),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_none()
                            .items_center()
                            .gap(px(8.))
                            .children(toggle)
                            .children(switch),
                    ),
            )
            .when(has_details && expanded, |s| {
                s.child(
                    div()
                        .px(px(ROW_PADDING_X))
                        .pt(px(DETAILS_PADDING_TOP))
                        .pb(px(DETAILS_PADDING_BOTTOM))
                        .children(details),
                )
            })
            .into_any_element()
    }

    fn skeleton_row(index: usize, key: &str) -> AnyElement {
        let id = |part: &str| {
            SharedString::from(format!("source-control-skeleton-{index}-{key}-{part}"))
        };
        div()
            .px(px(ROW_PADDING_X))
            .py(px(ROW_PADDING_Y))
            .flex()
            .items_center()
            .justify_between()
            .gap(px(ROW_GAP))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .gap(px(8.))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .child(
                                div()
                                    .relative()
                                    .flex()
                                    .flex_none()
                                    .size(px(MARK_BOX))
                                    .items_center()
                                    .justify_center()
                                    .child(Skeleton::new(id("mark")).size(px(MARK_ICON)))
                                    .child(
                                        div().absolute().top(px(-2.)).left(px(-2.)).child(
                                            Skeleton::new(id("dot"))
                                                .shape(SkeletonShape::Pill)
                                                .size(px(STATUS_DOT)),
                                        ),
                                    ),
                            )
                            .child(
                                Skeleton::new(id("title"))
                                    .shape(SkeletonShape::Pill)
                                    .h(px(16.))
                                    .w(px(112.)),
                            )
                            .child(
                                Skeleton::new(id("badge"))
                                    .shape(SkeletonShape::Pill)
                                    .h(px(20.))
                                    .w(px(56.)),
                            ),
                    )
                    .child(
                        Skeleton::new(id("summary"))
                            .shape(SkeletonShape::Pill)
                            .h(px(12.))
                            .w_full()
                            .max_w(px(320.)),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(8.))
                    .child(Skeleton::new(id("toggle")).size(px(28.)))
                    .child(
                        Skeleton::new(id("switch"))
                            .shape(SkeletonShape::Pill)
                            .h(px(20.))
                            .w(px(36.)),
                    ),
            )
            .into_any_element()
    }

    fn discovery(&self, view: &SourceControlSettingsView, t: &Tokens, cx: &App) -> Vec<AnyElement> {
        use crate::app_core::views::settings_source_control::SourceControlDiscoveryView as D;
        match &view.discovery {
            D::Disconnected {
                section_id,
                title,
                message,
            } => vec![
                SettingsSection::new(title.clone())
                    .id(section_id.clone())
                    .child(
                        div()
                            .px(px(16.))
                            .py(px(12.))
                            .text_size(px(text::SM))
                            .line_height(px(text::SM_LINE))
                            .text_color(t.muted_foreground)
                            .child(message.clone()),
                    )
                    .into_any_element(),
            ],
            D::Scanning { sections } => sections
                .iter()
                .map(|section| {
                    let mut settings_section = SettingsSection::new(section.title.clone());
                    if section.show_scan_button {
                        settings_section =
                            settings_section.header_action(self.scan_button(&view.scan_button, t));
                    }
                    settings_section
                        .children(section.row_keys.iter().enumerate().map(|(index, key)| {
                            Self::skeleton_row(index, &format!("{}-{key}", section.key))
                        }))
                        .into_any_element()
                })
                .collect(),
            D::Discovered { sections } => sections
                .iter()
                .map(|section| {
                    let mut settings_section = SettingsSection::new(section.title.clone());
                    if let Some(id) = &section.id {
                        settings_section = settings_section.id(id.clone());
                    }
                    if section.show_scan_button {
                        settings_section =
                            settings_section.header_action(self.scan_button(&view.scan_button, t));
                    }
                    let count = section.rows.len();
                    settings_section
                        .children(section.rows.iter().enumerate().map(|(index, row)| {
                            self.discovery_row(row, view, index == 0, index + 1 == count, t, cx)
                        }))
                        .into_any_element()
                })
                .collect(),
            D::Empty {
                section_id,
                title,
                empty_title,
                empty_description,
                scan_label,
                scan_disabled,
                scanning,
            } => {
                let client = self.client.clone();
                vec![
                    SettingsSection::new(title.clone())
                        .id(section_id.clone())
                        .child(
                            Empty::new()
                                .icon("icons/git-pull-request.svg")
                                .title(empty_title.clone())
                                .description(empty_description.clone())
                                .child(
                                    Button::new("source-control-empty-scan")
                                        .size(ButtonSize::Sm)
                                        .variant(ButtonVariant::Outline)
                                        .disabled(*scan_disabled)
                                        .on_click(move |_, _, cx| {
                                            act(&client, cx, "settingsSourceControlScan", json!({}))
                                        })
                                        .child(refresh_icon(
                                            "source-control-empty-scan-spin",
                                            SCAN_ICON,
                                            t.foreground,
                                            *scanning,
                                        ))
                                        .child(scan_label.clone()),
                                ),
                        )
                        .into_any_element(),
                ]
            }
        }
    }

    fn writing(&self, view: &SourceControlSettingsView, t: &Tokens, cx: &App) -> AnyElement {
        let writing = &view.writing;
        let style = &writing.writing_style;
        let style_client = self.client.clone();
        let custom = self.custom.as_ref().map(|(state, _)| state.clone());
        let mut style_row = SettingsRow::new(style.id.clone(), style.title.clone())
            .description(style.description.clone())
            .scope(&view.writing_row_scope, &self.client)
            .control(
                SettingsSelect::new("source-control-writing-style")
                    .options(style.options.iter().map(|option| {
                        SettingsSelectOption::new(option.value.clone(), option.label.clone())
                    }))
                    .value(style.value.clone())
                    .value_label(style.value_label.clone())
                    .width(SettingsControlWidth::Fixed(WRITING_SELECT_WIDTH))
                    .accessibility_label(style.trigger_aria_label.clone())
                    .on_change(move |value, _, cx| {
                        let custom_draft = custom
                            .as_ref()
                            .map(|state| state.read(cx).value().to_string());
                        let mut params = json!({ "value": value.to_string() });
                        if let Some(draft) = custom_draft {
                            params["customDraft"] = json!(draft);
                        }
                        act(
                            &style_client,
                            cx,
                            "settingsSourceControlWritingMode",
                            params,
                        )
                    }),
            );
        if style.can_reset {
            let client = self.client.clone();
            style_row = style_row.reset_action(
                SettingResetButton::new("source-control-writing-reset", style.reset_label.clone())
                    .on_click(move |_, cx| {
                        act(&client, cx, "settingsSourceControlWritingReset", json!({}))
                    }),
            );
        }
        let editor = match &style.editor {
            InstructionsEditorView::BulkEditing {
                apply_label,
                apply_disabled,
                ..
            } => {
                let client = self.client.clone();
                Some(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(EDITOR_GAP))
                        .children(self.bulk.as_ref().map(Textarea::new))
                        .child(
                            div().flex().child(
                                Button::new("source-control-bulk-apply")
                                    .size(ButtonSize::Sm)
                                    .variant(ButtonVariant::Outline)
                                    .label(apply_label.clone())
                                    .disabled(*apply_disabled)
                                    .on_click(move |_, _, cx| {
                                        act(
                                            &client,
                                            cx,
                                            "settingsSourceControlBulkApply",
                                            json!({}),
                                        )
                                    }),
                            ),
                        )
                        .into_any_element(),
                )
            }
            InstructionsEditorView::BulkClosed { open_label } => {
                let client = self.client.clone();
                Some(
                    div()
                        .flex()
                        .child(
                            Button::new("source-control-bulk-open")
                                .size(ButtonSize::Sm)
                                .variant(ButtonVariant::Outline)
                                .label(open_label.clone())
                                .on_click(move |_, _, cx| {
                                    act(&client, cx, "settingsSourceControlBulkOpen", json!({}))
                                }),
                        )
                        .into_any_element(),
                )
            }
            InstructionsEditorView::Custom { .. } => self
                .custom
                .as_ref()
                .map(|(state, _)| div().child(Textarea::new(state)).into_any_element()),
            InstructionsEditorView::None => None,
        };
        if let Some(editor) = editor {
            style_row = style_row.child(
                div()
                    .mt(px(EDITOR_MARGIN_TOP))
                    .pb(px(EDITOR_PADDING_BOTTOM))
                    .max_w(px(DESCRIPTION_MAX))
                    .child(editor),
            );
        }

        let templates = &writing.templates;
        let templates_client = self.client.clone();
        let mut templates_row = SettingsRow::new(templates.id.clone(), templates.title.clone())
            .description(templates.description.clone())
            .scope(&view.templates_row_scope, &self.client)
            .control(
                settings_switch("source-control-templates", templates.checked)
                    .mixed(templates.mixed)
                    .accessibility_label(templates.aria_label.clone())
                    .on_change(move |checked, _, _, cx| {
                        act(
                            &templates_client,
                            cx,
                            "settingsSourceControlTemplates",
                            json!({ "checked": checked }),
                        )
                    }),
            );
        if templates.can_reset {
            let client = self.client.clone();
            templates_row = templates_row.reset_action(
                SettingResetButton::new(
                    "source-control-templates-reset",
                    templates.reset_label.clone(),
                )
                .on_click(move |_, cx| {
                    act(
                        &client,
                        cx,
                        "settingsSourceControlTemplatesReset",
                        json!({}),
                    )
                }),
            );
        }

        let writer = &writing.writer_model;
        let writer_control =
            match &writer.control {
                WriterModelControlView::Disconnected { message } => div()
                    .text_size(px(text::SM))
                    .line_height(px(text::SM_LINE))
                    .text_color(t.muted_foreground)
                    .child(message.clone())
                    .into_any_element(),
                WriterModelControlView::Connected {
                    unavailable_message,
                    show_picker,
                    switch_checked,
                    switch_disabled,
                    switch_aria_label,
                } => {
                    let client = self.client.clone();
                    div()
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .justify_end()
                        .gap(px(8.))
                        .children(unavailable_message.clone().map(|message| {
                            div()
                                .text_size(px(text::SM))
                                .line_height(px(text::SM_LINE))
                                .text_color(t.muted_foreground)
                                .child(message)
                        }))
                        .children(view.writer_picker.as_ref().filter(|_| *show_picker).map(
                            |control| {
                                self.picker
                                    .controls(WRITER_PICKER, control, &self.client, cx)
                            },
                        ))
                        .child(
                            settings_switch("source-control-writer-toggle", *switch_checked)
                                .disabled(*switch_disabled)
                                .accessibility_label(switch_aria_label.clone())
                                .on_change(move |checked, _, _, cx| {
                                    act(
                                        &client,
                                        cx,
                                        "settingsSourceControlWriterToggle",
                                        json!({ "checked": checked }),
                                    )
                                }),
                        )
                        .into_any_element()
                }
            };
        let writer_row = SettingsRow::new(writer.id.clone(), writer.title.clone())
            .description(writer.description.clone())
            .scope(&view.writer_row_scope, &self.client)
            .control(writer_control);

        SettingsSection::new(writing.title.clone())
            .id(writing.section_id.clone())
            .child(style_row)
            .child(templates_row)
            .child(writer_row)
            .into_any_element()
    }
}

impl Render for SourceControlSection {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return div().into_any_element();
        };
        self.sync(&view, window, cx);
        let t = theme::active(cx);
        let overlays = self.picker.overlays(
            &[
                (PROJECT_DEFAULTS_PICKER, view.defaults.model_picker.as_ref()),
                (WRITER_PICKER, view.writer_picker.as_ref()),
            ],
            view.model_picker.as_ref(),
            &self.client,
            cx,
        );
        settings_stack()
            .child(project_defaults_section(
                &view.defaults,
                &self.picker,
                &self.client,
                "settingsSourceControlDefaults",
                cx,
            ))
            .children(self.discovery(&view, &t, cx))
            .child(self.writing(&view, &t, cx))
            .children(overlays)
            .into_any_element()
    }
}
