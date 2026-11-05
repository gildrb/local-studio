use gpui::component::input::{InputEvent, InputState, TextareaState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, Context, Entity, ExternalPaths, FontWeight, InteractiveElement,
    IntoElement, KeyDownEvent, ParentElement, PathPromptOptions, Render, SharedString,
    StatefulInteractiveElement, Styled, Window, div, img, px,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::theme_import::{
    ThemeImportBodyView, ThemeImportView, ThemeSearchResultView, ThemeSearchView,
};
use crate::features::settings::primitives::{
    SettingsControlWidth, SettingsSelect, SettingsSelectOption,
};
use crate::ui::alert_dialog::{
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup,
    AlertDialogTitle,
};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::dialog::{DialogHeader, DialogPanel, DialogPopup, DialogTitle};
use crate::ui::input::InputSize;
use crate::ui::input_group::{AddonAlign, InputGroup, InputGroupAddon};
use crate::ui::spinner::Spinner;
use crate::ui::textarea::{Textarea, TextareaSize};
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const DIALOG_WIDTH: f32 = 768.;
const RESULT_ICON: f32 = 40.;
const EDITOR_MIN_HEIGHT: f32 = 176.;
const EDITOR_ROWS: usize = 9;

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

pub struct ThemeImportDialog {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<ThemeImportView>>>,
    query: Entity<InputState>,
    json: Entity<TextareaState>,
    drop_active: bool,
    open: bool,
}

impl ThemeImportDialog {
    pub fn new(client: Entity<CoreClient>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<ThemeImportView>>(
            &client,
            "settingsThemeImport",
            json!({}),
            cx,
        );
        cx.observe_in(&view, window, |dialog, _, window, cx| {
            dialog.sync(window, cx);
            cx.notify();
        })
        .detach();
        let query = cx.new(|cx| InputState::new(window, cx));
        let query_client = client.clone();
        cx.subscribe_in(
            &query,
            window,
            move |_, state, event: &InputEvent, _, cx| match event {
                InputEvent::Change => {
                    let value = state.read(cx).value().to_string();
                    act(
                        &query_client,
                        cx,
                        "settingsThemeSearchQuery",
                        json!({ "value": value }),
                    );
                }
                InputEvent::PressEnter { .. } => {
                    act(&query_client, cx, "settingsThemeSearchSubmit", json!({}))
                }
                InputEvent::Blur | InputEvent::Focus => {}
            },
        )
        .detach();
        let json_state = cx.new(|cx| TextareaState::new(window, cx).rows(EDITOR_ROWS));
        let json_client = client.clone();
        cx.subscribe_in(
            &json_state,
            window,
            move |_, state, event: &InputEvent, _, cx| {
                if matches!(event, InputEvent::Change) {
                    let value = state.read(cx).value().to_string();
                    act(
                        &json_client,
                        cx,
                        "settingsThemeImportJson",
                        json!({ "value": value }),
                    );
                }
            },
        )
        .detach();
        Self {
            client,
            view,
            query,
            json: json_state,
            drop_active: false,
            open: false,
        }
    }

    fn sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            self.open = false;
            self.drop_active = false;
            return;
        };
        if !self.open {
            self.open = true;
            self.query
                .update(cx, |state, cx| state.set_value("", window, cx));
            self.json
                .update(cx, |state, cx| state.set_value("", window, cx));
            window.focus(&gpui::Focusable::focus_handle(self.query.read(cx), cx), cx);
        }
        let placeholder = match &view.model.view {
            ThemeImportBodyView::Editor {
                editor_placeholder, ..
            } => Some(editor_placeholder.clone()),
            ThemeImportBodyView::Conflicts { .. } => None,
        };
        if let ThemeImportBodyView::Editor { editor_value, .. } = &view.model.view
            && self.json.read(cx).value() != editor_value.as_str()
        {
            let value = editor_value.clone();
            self.json
                .update(cx, |state, cx| state.set_value(value, window, cx));
        }
        if let Some(placeholder) = placeholder {
            self.json.update(cx, |state, cx| {
                state.set_placeholder(placeholder, window, cx)
            });
        }
        let query = view.search.input.value.clone();
        if self.query.read(cx).value() != query.as_str() {
            self.query
                .update(cx, |state, cx| state.set_value(query, window, cx));
        }
        let placeholder = view.search.input.placeholder.clone();
        self.query.update(cx, |state, cx| {
            state.set_placeholder(placeholder, window, cx)
        });
    }

    fn pick_files(client: &Entity<CoreClient>, cx: &mut App) {
        let receiver = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: true,
            prompt: None,
        });
        let client = client.clone();
        cx.spawn(async move |cx| {
            let Ok(Ok(Some(paths))) = receiver.await else {
                return;
            };
            let paths: Vec<String> = paths
                .iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect();
            cx.update(|cx| {
                act(
                    &client,
                    cx,
                    "settingsThemeImportFiles",
                    json!({ "paths": paths }),
                )
            });
        })
        .detach();
    }

    fn result_card(
        result: &ThemeSearchResultView,
        t: &Tokens,
        client: &Entity<CoreClient>,
    ) -> AnyElement {
        let install = client.clone();
        let source = client.clone();
        let id = result.id.clone();
        let icon = div()
            .relative()
            .flex()
            .items_center()
            .justify_center()
            .size_full()
            .child(
                gpui::svg()
                    .path("icons/palette.svg")
                    .size(px(16.))
                    .text_color(t.muted_foreground),
            )
            .when_some(result.icon_url.clone(), |this, url| {
                this.child(
                    img(SharedString::from(url))
                        .absolute()
                        .top_0()
                        .left_0()
                        .size_full(),
                )
            });
        let action_icon = match result.action_icon.as_str() {
            "refresh" => "refresh-cw",
            "spinner" => "loader-circle",
            _ => "package-plus",
        };
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .gap(px(12.))
            .rounded(px(radius::XL))
            .border_1()
            .border_color(fade(t.border, 0.7))
            .bg(fade(t.card, 0.6))
            .p(px(12.))
            .hover(|style| style.bg(fade(t.accent, 0.2)))
            .child(
                div()
                    .flex()
                    .min_w_0()
                    .gap(px(12.))
                    .child(
                        div()
                            .flex()
                            .flex_none()
                            .items_center()
                            .justify_center()
                            .size(px(RESULT_ICON))
                            .overflow_hidden()
                            .rounded(px(radius::LG))
                            .bg(t.muted)
                            .text_color(t.muted_foreground)
                            .child(icon),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(text::SM))
                                    .line_height(px(text::SM_LINE))
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(result.name.clone()),
                            )
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(text::XS))
                                    .line_height(px(text::XS_LINE))
                                    .text_color(t.muted_foreground)
                                    .child(result.meta.clone()),
                            ),
                    ),
            )
            .child(
                div()
                    .min_h(px(32.))
                    .text_size(px(text::XS))
                    .line_height(px(16.))
                    .text_color(t.muted_foreground)
                    .line_clamp(2)
                    .child(result.description.clone()),
            )
            .child(
                div()
                    .mt_auto()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(8.))
                    .child(div().flex().min_w_0().items_center().gap(px(8.)).when_some(
                        result.source_url.clone().zip(result.source_icon.clone()),
                        |this, (url, icon)| {
                            let icon = match icon.as_str() {
                                "github" => "icons/source-control/github.svg",
                                "gitlab" => "icons/gitlab.svg",
                                _ => "icons/external-link.svg",
                            };
                            this.child(
                                div()
                                    .id(SharedString::from(format!("theme-source-{}", result.id)))
                                    .tooltip(Tooltip::text(result.source_aria_label.clone()))
                                    .child(
                                        Button::new(SharedString::from(format!(
                                            "theme-source-button-{}",
                                            result.id
                                        )))
                                        .size(ButtonSize::IconMicro)
                                        .variant(ButtonVariant::GhostMuted)
                                        .icon(icon)
                                        .accessibility_label(result.source_aria_label.clone())
                                        .on_click(
                                            move |_, _, cx| {
                                                act(
                                                    &source,
                                                    cx,
                                                    "settingsThemeSearchSource",
                                                    json!({ "url": url }),
                                                )
                                            },
                                        ),
                                    ),
                            )
                        },
                    ))
                    .child(
                        Button::new(SharedString::from(format!("theme-install-{}", result.id)))
                            .size(ButtonSize::Xs)
                            .variant(ButtonVariant::Outline)
                            .icon(action_icon)
                            .label(result.action_label.clone())
                            .disabled(result.action_disabled)
                            .on_click(move |_, _, cx| {
                                act(
                                    &install,
                                    cx,
                                    "settingsThemeSearchInstall",
                                    json!({ "id": id }),
                                )
                            }),
                    ),
            )
            .into_any_element()
    }

    fn search(&self, search: &ThemeSearchView, t: &Tokens) -> AnyElement {
        let client = self.client.clone();
        let toolbar = search.toolbar.as_ref().map(|toolbar| {
            let suggestions = toolbar.suggestions.iter().map(|suggestion| {
                let client = client.clone();
                let label = suggestion.label.clone();
                Button::new(SharedString::from(format!(
                    "theme-suggestion-{}",
                    suggestion.label
                )))
                .size(ButtonSize::Xs)
                .variant(ButtonVariant::Ghost)
                .label(suggestion.label.clone())
                .disabled(suggestion.disabled)
                .on_click(move |_, _, cx| {
                    act(
                        &client,
                        cx,
                        "settingsThemeSearchSuggestion",
                        json!({ "value": label }),
                    )
                })
            });
            let sort_client = client.clone();
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap(px(8.))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .min_w_0()
                        .items_center()
                        .gap(px(6.))
                        .child(
                            div()
                                .text_size(px(text::XS))
                                .text_color(t.muted_foreground)
                                .child(toolbar.suggestions_label.clone()),
                        )
                        .children(suggestions),
                )
                .when_some(toolbar.sort.clone(), |this, sort| {
                    this.child(
                        div()
                            .flex()
                            .flex_none()
                            .items_center()
                            .gap(px(8.))
                            .child(
                                div()
                                    .text_size(px(text::XS))
                                    .text_color(t.muted_foreground)
                                    .child(sort.label.clone()),
                            )
                            .child(
                                SettingsSelect::new("theme-search-sort")
                                    .options(
                                        sort.options
                                            .iter()
                                            .map(|option| {
                                                SettingsSelectOption::new(
                                                    option.value.clone(),
                                                    option.label.clone(),
                                                )
                                            })
                                            .collect::<Vec<_>>(),
                                    )
                                    .value(Some(sort.value.clone()))
                                    .when_some(sort.value_label.clone(), |select, label| {
                                        select.value_label(label)
                                    })
                                    .width(SettingsControlWidth::Fixed(160.))
                                    .disabled(sort.disabled)
                                    .accessibility_label(sort.aria_label.clone())
                                    .on_change(move |value, _, cx| {
                                        act(
                                            &sort_client,
                                            cx,
                                            "settingsThemeSearchSort",
                                            json!({ "value": value.to_string() }),
                                        )
                                    }),
                            ),
                    )
                })
        });
        let results = search.results.as_ref().map(|results| {
            let cards: Vec<AnyElement> = results
                .iter()
                .map(|result| Self::result_card(result, t, &client))
                .collect();
            let mut rows = Vec::new();
            let mut iter = cards.into_iter();
            while let Some(first) = iter.next() {
                let second = iter
                    .next()
                    .unwrap_or_else(|| div().flex_1().into_any_element());
                rows.push(div().flex().gap(px(8.)).child(first).child(second));
            }
            div().flex().flex_col().gap(px(8.)).children(rows)
        });
        let searching = search.input.icon == "spinner";
        div()
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(
                div()
                    .child(
                        div()
                            .text_size(px(text::SM))
                            .line_height(px(text::SM_LINE))
                            .font_weight(FontWeight::MEDIUM)
                            .child(search.title.clone()),
                    )
                    .child(
                        div()
                            .mt(px(2.))
                            .text_size(px(text::XS))
                            .line_height(px(text::XS_LINE))
                            .text_color(t.muted_foreground)
                            .child(search.description.clone()),
                    ),
            )
            .child(InputGroup::input(&self.query).size(InputSize::Lg).addon(
                InputGroupAddon::new(AddonAlign::InlineStart).icon(if searching {
                    "loader-circle"
                } else {
                    "search"
                }),
            ))
            .children(toolbar)
            .when_some(search.error.clone(), |this, error| {
                this.child(
                    div()
                        .rounded(px(radius::XL))
                        .border_1()
                        .border_color(fade(t.destructive, 0.3))
                        .bg(fade(t.destructive, 0.05))
                        .px(px(12.))
                        .py(px(8.))
                        .text_size(px(text::SM))
                        .text_color(t.destructive_foreground)
                        .child(error),
                )
            })
            .when_some(search.loading_text.clone(), |this, loading| {
                this.child(
                    div()
                        .flex()
                        .min_h(px(80.))
                        .items_center()
                        .justify_center()
                        .gap(px(8.))
                        .text_size(px(text::SM))
                        .text_color(t.muted_foreground)
                        .child(Spinner::new("theme-search-loading"))
                        .child(loading),
                )
            })
            .when_some(search.empty.clone(), |this, empty| {
                this.child(
                    div()
                        .flex()
                        .flex_col()
                        .min_h(px(160.))
                        .items_center()
                        .justify_center()
                        .rounded(px(radius::XXL))
                        .border_1()
                        .border_dashed()
                        .border_color(t.border)
                        .child(
                            div()
                                .text_size(px(text::SM))
                                .font_weight(FontWeight::MEDIUM)
                                .child(empty.title),
                        )
                        .child(
                            div()
                                .mt(px(4.))
                                .text_size(px(text::XS))
                                .text_color(t.muted_foreground)
                                .child(empty.description),
                        ),
                )
            })
            .children(results)
            .into_any_element()
    }

    fn body(&self, body: &ThemeImportBodyView, t: &Tokens, cx: &mut Context<Self>) -> AnyElement {
        let client = self.client.clone();
        match body {
            ThemeImportBodyView::Conflicts {
                title,
                theme_labels,
                update_label,
                copy_label,
                back_label,
                cancel_label,
            } => {
                let update = client.clone();
                let copy = client.clone();
                let back = client.clone();
                let cancel = client.clone();
                div()
                    .flex()
                    .flex_col()
                    .gap(px(12.))
                    .child(
                        div()
                            .rounded(px(radius::XL))
                            .border_1()
                            .border_color(fade(t.border, 0.7))
                            .bg(fade(t.muted, 0.2))
                            .p(px(12.))
                            .child(
                                div()
                                    .text_size(px(text::SM))
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(title.clone()),
                            )
                            .child(
                                div()
                                    .mt(px(4.))
                                    .text_size(px(text::XS))
                                    .text_color(t.muted_foreground)
                                    .child(theme_labels.clone()),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .items_center()
                            .gap(px(8.))
                            .child(
                                Button::new("theme-import-update")
                                    .size(ButtonSize::Sm)
                                    .label(update_label.clone())
                                    .on_click(move |_, _, cx| {
                                        act(
                                            &update,
                                            cx,
                                            "settingsThemeImportResolve",
                                            json!({ "mode": "update" }),
                                        )
                                    }),
                            )
                            .child(
                                Button::new("theme-import-copy")
                                    .size(ButtonSize::Sm)
                                    .variant(ButtonVariant::Outline)
                                    .label(copy_label.clone())
                                    .on_click(move |_, _, cx| {
                                        act(
                                            &copy,
                                            cx,
                                            "settingsThemeImportResolve",
                                            json!({ "mode": "copy" }),
                                        )
                                    }),
                            )
                            .child(
                                Button::new("theme-import-back")
                                    .size(ButtonSize::Sm)
                                    .variant(ButtonVariant::Ghost)
                                    .label(back_label.clone())
                                    .on_click(move |_, _, cx| {
                                        act(&back, cx, "settingsThemeImportBack", json!({}))
                                    }),
                            )
                            .child(
                                Button::new("theme-import-conflict-cancel")
                                    .size(ButtonSize::Sm)
                                    .variant(ButtonVariant::Ghost)
                                    .label(cancel_label.clone())
                                    .on_click(move |_, _, cx| {
                                        act(&cancel, cx, "settingsThemeImportClose", json!({}))
                                    }),
                            ),
                    )
                    .into_any_element()
            }
            ThemeImportBodyView::Editor {
                file_title,
                file_subtitle,
                choose_label,
                choose_disabled,
                editor_label,
                cancel_label,
                submit_label,
                submit_disabled,
                ..
            } => {
                let choose = client.clone();
                let drop = client.clone();
                let cancel = client.clone();
                let submit = client.clone();
                let entity = cx.entity().downgrade();
                let leave = cx.entity().downgrade();
                let dropped = cx.entity().downgrade();
                div()
                    .flex()
                    .flex_col()
                    .gap(px(16.))
                    .child(
                        div()
                            .id("theme-import-drop")
                            .flex()
                            .flex_wrap()
                            .items_center()
                            .justify_between()
                            .gap(px(12.))
                            .rounded(px(radius::XL))
                            .border_1()
                            .border_dashed()
                            .px(px(12.))
                            .py(px(12.))
                            .map(|this| {
                                if self.drop_active {
                                    this.border_color(t.ring).bg(fade(t.accent, 0.2))
                                } else {
                                    this.border_color(fade(t.border, 0.8))
                                        .bg(fade(t.muted, 0.2))
                                }
                            })
                            .on_drag_move::<ExternalPaths>(move |_, _, cx| {
                                if let Some(entity) = entity.upgrade() {
                                    entity.update(cx, |dialog, cx| {
                                        if !dialog.drop_active {
                                            dialog.drop_active = true;
                                            cx.notify();
                                        }
                                    });
                                }
                            })
                            .on_mouse_move(move |_, _, cx| {
                                if let Some(entity) = leave.upgrade() {
                                    entity.update(cx, |dialog, cx| {
                                        if dialog.drop_active {
                                            dialog.drop_active = false;
                                            cx.notify();
                                        }
                                    });
                                }
                            })
                            .on_drop(move |paths: &ExternalPaths, _, cx| {
                                if let Some(entity) = dropped.upgrade() {
                                    entity.update(cx, |dialog, cx| {
                                        dialog.drop_active = false;
                                        cx.notify();
                                    });
                                }
                                let paths: Vec<String> = paths
                                    .paths()
                                    .iter()
                                    .map(|path| path.to_string_lossy().into_owned())
                                    .collect();
                                act(
                                    &drop,
                                    cx,
                                    "settingsThemeImportFiles",
                                    json!({ "paths": paths }),
                                );
                            })
                            .child(
                                div()
                                    .min_w_0()
                                    .child(
                                        div()
                                            .text_size(px(text::SM))
                                            .font_weight(FontWeight::MEDIUM)
                                            .child(file_title.clone()),
                                    )
                                    .child(
                                        div()
                                            .truncate()
                                            .text_size(px(text::XS))
                                            .text_color(t.muted_foreground)
                                            .child(file_subtitle.clone()),
                                    ),
                            )
                            .child(
                                Button::new("theme-import-choose")
                                    .size(ButtonSize::Sm)
                                    .variant(ButtonVariant::Outline)
                                    .icon("download")
                                    .label(choose_label.clone())
                                    .disabled(*choose_disabled)
                                    .on_click(move |_, _, cx| Self::pick_files(&choose, cx)),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(8.))
                            .child(
                                div()
                                    .text_size(px(text::SM))
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(editor_label.clone()),
                            )
                            .child(
                                div()
                                    .min_h(px(EDITOR_MIN_HEIGHT))
                                    .font_family(crate::platform::MONO_FONT)
                                    .text_size(px(text::XS))
                                    .child(
                                        Textarea::new(&self.json)
                                            .size(TextareaSize::Sm)
                                            .items_start(),
                                    ),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .justify_end()
                            .gap(px(8.))
                            .child(
                                Button::new("theme-import-cancel")
                                    .variant(ButtonVariant::Ghost)
                                    .label(cancel_label.clone())
                                    .on_click(move |_, _, cx| {
                                        act(&cancel, cx, "settingsThemeImportClose", json!({}))
                                    }),
                            )
                            .child(
                                Button::new("theme-import-submit")
                                    .icon("plus")
                                    .label(submit_label.clone())
                                    .disabled(*submit_disabled)
                                    .on_click(move |_, _, cx| {
                                        act(&submit, cx, "settingsThemeImportSubmit", json!({}))
                                    }),
                            ),
                    )
                    .into_any_element()
            }
        }
    }

    fn update_dialog(&self, search: &ThemeSearchView) -> Option<AnyElement> {
        let dialog = &search.update_dialog;
        if !dialog.open {
            return None;
        }
        let dismiss = self.client.clone();
        let cancel = self.client.clone();
        let confirm = self.client.clone();
        Some(
            AlertDialogPopup::new("theme-search-update")
                .on_dismiss(move |_, cx| {
                    act(&dismiss, cx, "settingsThemeSearchUpdateCancel", json!({}))
                })
                .child(
                    AlertDialogHeader::new()
                        .child(AlertDialogTitle::new(dialog.title.clone()))
                        .child(AlertDialogDescription::new(dialog.description.clone())),
                )
                .child(
                    AlertDialogFooter::new()
                        .child(
                            Button::new("theme-search-update-cancel")
                                .variant(ButtonVariant::Outline)
                                .label(dialog.cancel_label.clone())
                                .on_click(move |_, _, cx| {
                                    act(&cancel, cx, "settingsThemeSearchUpdateCancel", json!({}))
                                }),
                        )
                        .child(
                            Button::new("theme-search-update-confirm")
                                .label(dialog.confirm_label.clone())
                                .on_click(move |_, _, cx| {
                                    act(&confirm, cx, "settingsThemeSearchUpdateConfirm", json!({}))
                                }),
                        ),
                )
                .into_any_element(),
        )
    }
}

impl Render for ThemeImportDialog {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return div().into_any_element();
        };
        let t = theme::active(cx);
        let close = self.client.clone();
        let escape = self.client.clone();
        let search = self.search(&view.search, &t);
        let body = self.body(&view.model.view, &t, cx);
        let update = self.update_dialog(&view.search);
        div()
            .on_key_down(move |event: &KeyDownEvent, _, cx| {
                if event.keystroke.key == "escape" {
                    cx.stop_propagation();
                    act(&escape, cx, "settingsThemeImportClose", json!({}));
                }
            })
            .child(
                DialogPopup::new("theme-import-dialog")
                    .max_width(DIALOG_WIDTH)
                    .on_close(move |_, cx| act(&close, cx, "settingsThemeImportClose", json!({})))
                    .child(DialogHeader::new().child(DialogTitle::new(view.model.title.clone())))
                    .child(
                        DialogPanel::new("theme-import-panel")
                            .after_header(true)
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap(px(16.))
                                    .child(search)
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap(px(12.))
                                            .child(div().h(px(1.)).flex_1().bg(t.border))
                                            .child(
                                                div()
                                                    .text_size(px(10.))
                                                    .text_color(t.muted_foreground)
                                                    .child(view.model.divider_label.to_uppercase()),
                                            )
                                            .child(div().h(px(1.)).flex_1().bg(t.border)),
                                    )
                                    .child(body)
                                    .when_some(view.model.error.clone(), |this, error| {
                                        this.child(
                                            div()
                                                .rounded(px(radius::XL))
                                                .border_1()
                                                .border_color(fade(t.destructive, 0.32))
                                                .bg(fade(t.destructive, 0.04))
                                                .px(px(14.))
                                                .py(px(12.))
                                                .text_size(px(text::SM))
                                                .text_color(t.destructive_foreground)
                                                .child(error),
                                        )
                                    }),
                            ),
                    ),
            )
            .children(update)
            .into_any_element()
    }
}
