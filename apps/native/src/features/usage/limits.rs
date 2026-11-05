use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, Bounds, Context, Div, Entity, FontWeight, InteractiveElement, IntoElement,
    ParentElement, PathBuilder, Rgba, SharedString, StatefulInteractiveElement, Styled, canvas,
    div, point, px, relative, svg,
};
use serde_json::json;

use super::colors::css_color;
use super::content::cursor_button;
use super::page::UsagePage;
use super::{TEXT_2XS, TEXT_2XS_LINE, TEXT_3XS, TEXT_4XS, act, text};
use crate::app_core::client::CoreClient;
use crate::app_core::views::usage::{
    UsageAccountAvatarView, UsageAccountNameView, UsageCursorPromptView, UsageLimitAccountView,
    UsageLimitSectionView, UsageLimitSegmentView, UsageLimitWindowView, UsageLimitsView,
    UsageResetConfirmView, UsageView,
};
use crate::features::chat::provider_instance_icon::ProviderInstanceIcon;
use crate::platform::MONO_FONT;
use crate::ui::alert_dialog::{
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup,
    AlertDialogTitle,
};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::popover::{PopoverPopup, Side};
use crate::ui::theme;
use crate::ui::theme::metrics::{radius, text as type_scale};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

const MD: f32 = 768.;
const POOL_WIDE: f32 = 672.;
const STACK_GAP: f32 = 32.;
const SECTION_GAP: f32 = 12.;
const HEADING_GAP: f32 = 8.;
const ICON_BOX: f32 = 20.;
const ICON: f32 = 16.;
const CARD_PADDING: f32 = 16.;
const CARD_GAP_X: f32 = 24.;
const CARD_GAP_Y: f32 = 12.;
const CARD_LABEL_WIDTH: f32 = 176.;
const LABEL_GAP: f32 = 4.;
const BIG_GAP: f32 = 8.;
const BIG_TEXT: f32 = 30.;
const BIG_LINE: f32 = 36.;
const PACE_ICON: f32 = 14.;
const GRID_GAP: f32 = 4.;
const SEGMENT_HEIGHT_WIDE: f32 = 32.;
const SEGMENT_HEIGHT_NARROW: f32 = 20.;
const FILL_OPACITY: f32 = 0.35;
const HATCH_OPACITY: f32 = 0.2;
const HATCH_PERIOD: f32 = 7.071;
const SEGMENT_GAP: f32 = 6.;
const SEGMENT_PADDING_X: f32 = 8.;
const PLATE_PADDING_X: f32 = 6.;
const PLATE_PADDING_Y: f32 = 2.;
const PLATE_GAP: f32 = 6.;
const TICKET_ICON: f32 = 12.;
const TICKET_GAP: f32 = 2.;
const CHIP: f32 = 16.;
const BADGE: f32 = 14.;
const POPOVER_WIDTH: f32 = 288.;
const POPOVER_GAP: f32 = 10.;
const POPOVER_OFFSET: f32 = 6.;
const POPOVER_VIEWPORT_MARGIN: f32 = 8.;
const ROW_LABEL_WIDTH: f32 = 72.;
const ROW_GAP_X: f32 = 12.;
const ROW_GAP_Y: f32 = 4.;
const CREDITS_GAP: f32 = 12.;
const EMAIL_LINE: f32 = 16.5;
const LEGEND_GAP: f32 = 4.;
const LINK_GAP: f32 = 12.;
const LINK_ICON: f32 = 20.;
const LINK_DESCRIPTION_MAX: f32 = 576.;
const ALERT_PADDING_X: f32 = 14.;
const ALERT_PADDING_Y: f32 = 12.;
const ALERT_GAP: f32 = 8.;
const ALERT_TITLE_GAP: f32 = 2.;
const PROMPT_PADDING: f32 = 16.;
const PROMPT_GAP: f32 = 12.;
const PROMPT_BUTTONS_GAP: f32 = 8.;

fn heading(t: &Tokens) -> Div {
    text(type_scale::SM, type_scale::SM_LINE)
        .flex()
        .items_center()
        .gap(px(HEADING_GAP))
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.foreground)
}

fn instance_icon(
    driver: &str,
    initials: &str,
    accent: Option<Rgba>,
    badge: bool,
    surface: Rgba,
    t: &Tokens,
) -> AnyElement {
    div()
        .relative()
        .flex()
        .flex_none()
        .size(px(ICON_BOX))
        .items_center()
        .justify_center()
        .child(
            ProviderInstanceIcon::new(
                driver.to_string(),
                initials.to_string(),
                fade(t.foreground, 0.8),
            )
            .icon_size(ICON),
        )
        .when(badge, |this| {
            this.child(
                div()
                    .absolute()
                    .right_0()
                    .bottom_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .h(px(BADGE))
                    .min_w(px(BADGE))
                    .px(px(2.))
                    .rounded_full()
                    .border_1()
                    .border_color(surface)
                    .bg(accent.unwrap_or(t.card))
                    .shadow_sm()
                    .text_size(px(TEXT_4XS))
                    .line_height(px(TEXT_4XS))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(if accent.is_some() {
                        gpui::rgb(0xffffff)
                    } else {
                        t.muted_foreground
                    })
                    .child(initials.to_string()),
            )
        })
        .into_any_element()
}

fn chip(account: &UsageLimitAccountView, t: &Tokens) -> Option<AnyElement> {
    account.chip.as_ref().map(|chip| {
        div()
            .flex()
            .flex_none()
            .size(px(CHIP))
            .items_center()
            .justify_center()
            .rounded_full()
            .bg(css_color(&chip.background, t))
            .text_color(css_color(&chip.foreground, t))
            .text_size(px(TEXT_3XS))
            .line_height(px(TEXT_3XS))
            .font_weight(FontWeight::SEMIBOLD)
            .child(chip.initials.clone())
            .into_any_element()
    })
}

fn account_name(account: &UsageLimitAccountView, t: &Tokens) -> AnyElement {
    match &account.name {
        UsageAccountNameView::Text { text } => div()
            .min_w_0()
            .truncate()
            .font_weight(FontWeight::MEDIUM)
            .text_color(t.foreground)
            .child(text.clone())
            .into_any_element(),
        UsageAccountNameView::Chip => div()
            .flex()
            .min_w_0()
            .items_center()
            .children(chip(account, t))
            .into_any_element(),
    }
}

fn account_avatar(
    view: &UsageView,
    account: &UsageLimitAccountView,
    t: &Tokens,
) -> Option<AnyElement> {
    match &account.avatar {
        UsageAccountAvatarView::Instance {
            display_name,
            accent_color,
            show_badge,
        } => Some(instance_icon(
            &account.driver,
            view.initials.get(display_name).map_or("", String::as_str),
            accent_color
                .as_deref()
                .and_then(crate::features::chat::provider_instance_icon::parse_accent),
            *show_badge,
            t.popover,
            t,
        )),
        UsageAccountAvatarView::Chip => chip(account, t),
        UsageAccountAvatarView::None => None,
    }
}

fn hatch(color: Rgba) -> impl IntoElement {
    canvas(
        |_, _, _| {},
        move |bounds: Bounds<gpui::Pixels>, _, window, _| {
            let height = f32::from(bounds.size.height);
            let width = f32::from(bounds.size.width);
            window.with_content_mask(Some(gpui::ContentMask { bounds }), |window| {
                let mut x = -height;
                while x < width + HATCH_PERIOD {
                    let mut builder = PathBuilder::stroke(px(1.));
                    builder.move_to(point(bounds.origin.x + px(x), bounds.origin.y + px(height)));
                    builder.line_to(point(bounds.origin.x + px(x + height), bounds.origin.y));
                    if let Ok(path) = builder.build() {
                        window.paint_path(path, color);
                    }
                    x += HATCH_PERIOD;
                }
            });
        },
    )
    .absolute()
    .inset_0()
    .size_full()
}

fn plate_contents(
    segment: &UsageLimitSegmentView,
    t: &Tokens,
    credits_color: Rgba,
) -> Vec<AnyElement> {
    let mut children = vec![segment.countdown.clone().into_any_element()];
    if segment.credits > 0 {
        if !segment.countdown.is_empty() {
            children.push(
                div()
                    .text_color(t.muted_foreground)
                    .child("·")
                    .into_any_element(),
            );
        }
        children.push(
            div()
                .flex()
                .items_center()
                .gap(px(TICKET_GAP))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(credits_color)
                .child(
                    svg()
                        .path("icons/ticket.svg")
                        .size(px(TICKET_ICON))
                        .text_color(credits_color),
                )
                .child(segment.credits.to_string())
                .into_any_element(),
        );
    }
    children
}

fn popover_row(label: &str, value: &str, t: &Tokens) -> Div {
    div()
        .flex()
        .gap(px(ROW_GAP_X))
        .child(
            div()
                .flex_none()
                .w(px(ROW_LABEL_WIDTH))
                .text_color(t.muted_foreground)
                .child(label.to_string()),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .text_color(t.foreground)
                .font_features(theme::tabular())
                .child(value.to_string()),
        )
}

fn popover_block(t: &Tokens) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(ROW_GAP_Y))
        .border_t_1()
        .border_color(fade(t.border, 0.6))
        .pt(px(POPOVER_GAP))
}

pub(super) fn reset_dialog(
    client: &Entity<CoreClient>,
    confirm: &UsageResetConfirmView,
) -> AnyElement {
    let dismiss = client.clone();
    let cancel = client.clone();
    let accept = client.clone();
    AlertDialogPopup::new("usage-reset-credit")
        .on_dismiss(move |_, cx| act(&dismiss, cx, "usageRedeemCancel", json!({})))
        .child(
            AlertDialogHeader::new()
                .child(AlertDialogTitle::new(confirm.title.clone()))
                .child(AlertDialogDescription::new(confirm.description.clone())),
        )
        .child(
            AlertDialogFooter::new()
                .child(
                    Button::new("usage-reset-cancel")
                        .variant(ButtonVariant::Outline)
                        .label(confirm.cancel_label.clone())
                        .on_click(move |_, _, cx| act(&cancel, cx, "usageRedeemCancel", json!({}))),
                )
                .child(
                    Button::new("usage-reset-confirm")
                        .label(confirm.confirm_label.clone())
                        .on_click(move |_, _, cx| {
                            act(&accept, cx, "usageRedeemConfirm", json!({}))
                        }),
                ),
        )
        .into_any_element()
}

impl UsagePage {
    pub(super) fn limits_content(
        &mut self,
        view: &UsageView,
        limits: &UsageLimitsView,
        cursor_prompt: Option<&UsageCursorPromptView>,
        width: f32,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let mut children: Vec<AnyElement> = Vec::new();
        if let Some(message) = &limits.empty_message {
            children.push(
                text(type_scale::SM, type_scale::SM_LINE)
                    .text_color(t.muted_foreground)
                    .child(message.clone())
                    .into_any_element(),
            );
        }
        for (index, section) in limits.sections.iter().enumerate() {
            if index == limits.cursor_prompt_index
                && let Some(prompt) = cursor_prompt
            {
                children.push(self.cursor_prompt(view, prompt, t));
            }
            children.push(self.pool_section(view, section, width, t, cx));
        }
        if limits.cursor_prompt_index == limits.sections.len()
            && let Some(prompt) = cursor_prompt
        {
            children.push(self.cursor_prompt(view, prompt, t));
        }
        for link in &limits.external_links {
            let client = self.client.clone();
            let url = link.url.clone();
            let openai = link.icon.as_deref() == Some("openai");
            children.push(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .justify_between()
                    .gap(px(LINK_GAP))
                    .rounded(px(radius::XL))
                    .border_1()
                    .border_color(t.border)
                    .p(px(CARD_PADDING))
                    .child(
                        div()
                            .flex()
                            .flex_1()
                            .min_w_0()
                            .items_center()
                            .gap(px(LINK_GAP))
                            .when(openai, |this| {
                                this.child(
                                    svg()
                                        .path("icons/providers/openai.svg")
                                        .flex_none()
                                        .size(px(LINK_ICON))
                                        .text_color(t.foreground),
                                )
                            })
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .min_w_0()
                                    .gap(px(LABEL_GAP))
                                    .child(
                                        text(type_scale::SM, type_scale::SM_LINE)
                                            .font_weight(FontWeight::MEDIUM)
                                            .child(link.label.clone()),
                                    )
                                    .when_some(link.description.clone(), |this, description| {
                                        this.child(
                                            text(type_scale::XS, type_scale::XS_LINE)
                                                .text_color(t.muted_foreground)
                                                .when(!openai, |this| {
                                                    this.max_w(px(LINK_DESCRIPTION_MAX))
                                                })
                                                .child(description),
                                        )
                                    }),
                            ),
                    )
                    .child(
                        Button::new(SharedString::from(format!("usage-link-{}", link.url)))
                            .variant(ButtonVariant::GhostMuted)
                            .size(ButtonSize::Xs)
                            .label(link.button_label.clone())
                            .icon_end("external-link")
                            .icon_size(14.)
                            .on_click(move |_, _, cx| {
                                act(&client, cx, "usageOpenExternal", json!({ "url": url }));
                            }),
                    )
                    .into_any_element(),
            );
        }
        if !limits.notices.is_empty() {
            children.push(
                div()
                    .flex()
                    .items_start()
                    .gap(px(ALERT_GAP))
                    .rounded(px(radius::XL))
                    .border_1()
                    .border_color(fade(t.warning, 0.32))
                    .bg(t.warning_surface)
                    .px(px(ALERT_PADDING_X))
                    .py(px(ALERT_PADDING_Y))
                    .text_size(px(type_scale::SM))
                    .line_height(px(type_scale::SM_LINE))
                    .text_color(t.warning_foreground)
                    .child(
                        div()
                            .flex()
                            .flex_none()
                            .h(px(type_scale::SM_LINE))
                            .w(px(ICON))
                            .items_center()
                            .justify_center()
                            .child(
                                svg()
                                    .path("icons/triangle-alert.svg")
                                    .size(px(ICON))
                                    .text_color(t.warning),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_1()
                            .min_w_0()
                            .flex_col()
                            .gap(px(ALERT_TITLE_GAP))
                            .children(limits.notices.iter().map(|notice| {
                                div().font_weight(FontWeight::MEDIUM).child(notice.clone())
                            })),
                    )
                    .into_any_element(),
            );
        }
        div()
            .flex()
            .flex_col()
            .gap(px(STACK_GAP))
            .children(children)
            .into_any_element()
    }

    fn cursor_prompt(
        &self,
        view: &UsageView,
        prompt: &UsageCursorPromptView,
        t: &Tokens,
    ) -> AnyElement {
        div()
            .flex()
            .flex_col()
            .gap(px(SECTION_GAP))
            .child(
                heading(t)
                    .child(instance_icon(
                        "cursor",
                        view.initials.get(&prompt.title).map_or("", String::as_str),
                        None,
                        false,
                        t.background,
                        t,
                    ))
                    .child(prompt.title.clone()),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .items_start()
                    .gap(px(PROMPT_GAP))
                    .rounded(px(radius::LG))
                    .border_1()
                    .border_color(fade(t.border, 0.6))
                    .p(px(PROMPT_PADDING))
                    .child(
                        text(type_scale::XS, type_scale::XS_LINE)
                            .text_color(t.muted_foreground)
                            .child(prompt.copy.clone()),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .gap(px(PROMPT_BUTTONS_GAP))
                            .children(
                                prompt
                                    .buttons
                                    .iter()
                                    .map(|button| cursor_button(self, view, button, t)),
                            ),
                    ),
            )
            .into_any_element()
    }

    fn pool_section(
        &mut self,
        view: &UsageView,
        section: &UsageLimitSectionView,
        width: f32,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let color = css_color(&section.color, t);
        let windows: Vec<AnyElement> = section
            .windows
            .iter()
            .map(|window| self.pool_window(view, window, color, width, t, cx))
            .collect();
        div()
            .flex()
            .flex_col()
            .gap(px(SECTION_GAP))
            .child(
                heading(t)
                    .child(instance_icon(
                        &section.driver,
                        view.initials.get(&section.label).map_or("", String::as_str),
                        None,
                        false,
                        t.background,
                        t,
                    ))
                    .child(section.label.clone()),
            )
            .children(windows)
            .into_any_element()
    }

    fn pool_window(
        &mut self,
        view: &UsageView,
        window: &UsageLimitWindowView,
        color: Rgba,
        width: f32,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let label = div()
            .flex()
            .flex_col()
            .gap(px(LABEL_GAP))
            .child(
                text(type_scale::SM, type_scale::SM_LINE)
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(t.foreground)
                    .child(window.label.clone()),
            )
            .child(
                div()
                    .flex()
                    .items_baseline()
                    .gap(px(BIG_GAP))
                    .child(
                        text(BIG_TEXT, BIG_LINE)
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(t.foreground)
                            .font_features(theme::tabular())
                            .child(window.remaining_label.clone()),
                    )
                    .child(
                        text(type_scale::SM, type_scale::SM_LINE)
                            .text_color(t.muted_foreground)
                            .child(window.left_label.clone()),
                    )
                    .when_some(window.pace.clone(), |this, pace| {
                        this.child(
                            div()
                                .id(SharedString::from(format!("usage-pace-{}", window.key)))
                                .flex()
                                .flex_none()
                                .tooltip(Tooltip::text(pace.label.clone()))
                                .child(
                                    svg()
                                        .path(SharedString::from(format!(
                                            "icons/{}.svg",
                                            pace.icon
                                        )))
                                        .size(px(PACE_ICON))
                                        .text_color(t.muted_foreground),
                                ),
                        )
                    }),
            )
            .when_some(window.next_refill_label.clone(), |this, refill| {
                this.child(
                    text(type_scale::XS, type_scale::XS_LINE)
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.foreground)
                        .font_features(theme::tabular())
                        .child(refill),
                )
            });
        let pool = self.pool(view, window, color, t, cx);
        let description = window.description.clone().map(|description| {
            text(type_scale::XS, type_scale::XS_LINE)
                .text_color(t.muted_foreground)
                .child(description)
        });
        let card = div()
            .flex()
            .flex_col()
            .gap_y(px(CARD_GAP_Y))
            .rounded(px(radius::LG))
            .border_1()
            .border_color(fade(t.border, 0.6))
            .p(px(CARD_PADDING));
        if width >= MD {
            card.child(
                div()
                    .flex()
                    .items_center()
                    .gap_x(px(CARD_GAP_X))
                    .child(label.flex_none().w(px(CARD_LABEL_WIDTH)))
                    .child(div().flex_1().min_w_0().child(pool)),
            )
            .children(description)
            .into_any_element()
        } else {
            card.child(label)
                .child(pool)
                .children(description)
                .into_any_element()
        }
    }

    fn pool(
        &mut self,
        view: &UsageView,
        window: &UsageLimitWindowView,
        color: Rgba,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let wide = self
            .pool_widths
            .borrow()
            .get(&window.key)
            .is_some_and(|width| *width >= POOL_WIDE);
        let widths = self.pool_widths.clone();
        let page = cx.entity().downgrade();
        let window_key = window.key.clone();
        let measure = canvas(
            move |bounds, _, cx| {
                let width = f32::from(bounds.size.width);
                let changed = widths.borrow_mut().insert(window_key.clone(), width) != Some(width);
                if changed {
                    let _ = page.update(cx, |_, cx| cx.notify());
                }
            },
            |_, _, _, _| {},
        )
        .absolute()
        .inset_0()
        .size_full();
        let mut columns: Vec<AnyElement> = Vec::new();
        for column in 1..=window.column_count.max(1) {
            match window
                .segments
                .iter()
                .find(|segment| segment.index == column)
            {
                Some(segment) => columns.push(self.segment(window, segment, color, wide, t, cx)),
                None => columns.push(div().flex_1().min_w_0().into_any_element()),
            }
        }
        let legend: Vec<AnyElement> = if wide {
            Vec::new()
        } else {
            window
                .segments
                .iter()
                .map(|segment| self.legend(window, segment, color, t, cx))
                .collect()
        };
        let statuses: Vec<AnyElement> = window
            .segments
            .iter()
            .filter_map(|segment| {
                let state_key = format!("{}|{}", window.key, segment.key);
                let status = view.redeem.get(&state_key)?.status.clone()?;
                Some(
                    text(type_scale::XS, type_scale::XS_LINE)
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .gap(px(4.))
                        .text_color(t.muted_foreground)
                        .child(account_name(&segment.account, t))
                        .child(status)
                        .into_any_element(),
                )
            })
            .collect();
        let popover = self.segment_popover(view, window, t, cx);
        div()
            .relative()
            .flex()
            .flex_col()
            .min_w_0()
            .gap(px(GRID_GAP))
            .child(measure)
            .child(div().flex().gap_x(px(GRID_GAP)).children(columns))
            .children(legend)
            .children(statuses)
            .children(popover)
            .into_any_element()
    }

    fn segment(
        &self,
        window: &UsageLimitWindowView,
        segment: &UsageLimitSegmentView,
        color: Rgba,
        wide: bool,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let state_key = format!("{}|{}", window.key, segment.key);
        let anchor = format!("segment:{state_key}");
        let open = self
            .segment
            .as_ref()
            .is_some_and(|open| open.key == state_key);
        let bounds = self.segment_bounds.clone();
        let anchor_key = anchor.clone();
        let hover_page = cx.entity().downgrade();
        let click_page = cx.entity().downgrade();
        let hover_key = state_key.clone();
        let hover_anchor = anchor.clone();
        let click_key = state_key.clone();
        let click_anchor = anchor.clone();
        div()
            .id(SharedString::from(format!("usage-segment-{state_key}")))
            .relative()
            .flex_1()
            .min_w_0()
            .h(px(if wide {
                SEGMENT_HEIGHT_WIDE
            } else {
                SEGMENT_HEIGHT_NARROW
            }))
            .overflow_hidden()
            .rounded(px(radius::MD))
            .bg(t.muted)
            .cursor_pointer()
            .on_hover(move |hovered, _, cx| {
                let _ = hover_page.update(cx, |page, cx| {
                    page.hover_segment(&hover_key, &hover_anchor, *hovered, cx)
                });
            })
            .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_click(move |_, _, cx| {
                let _ = click_page.update(cx, |page, cx| {
                    page.click_segment(&click_key, &click_anchor, cx)
                });
            })
            .child(
                canvas(
                    move |trigger, _, _| {
                        bounds.borrow_mut().insert(anchor_key.clone(), trigger);
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .inset_0()
                .size_full(),
            )
            .child(
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .left_0()
                    .w(relative(segment.remaining_percent / 100.))
                    .rounded(px(radius::MD))
                    .bg(fade(color, FILL_OPACITY)),
            )
            .when(segment.hatch_width.is_some(), |this| {
                this.child(
                    div()
                        .absolute()
                        .top_0()
                        .bottom_0()
                        .right_0()
                        .w(relative(1. - segment.remaining_percent / 100.))
                        .child(hatch(fade(color, HATCH_OPACITY))),
                )
            })
            .when(!wide, |this| {
                this.child(
                    div()
                        .absolute()
                        .inset_0()
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(TEXT_3XS))
                        .line_height(px(TEXT_3XS))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(fade(t.foreground, 0.8))
                        .font_features(theme::tabular())
                        .child(segment.index.to_string()),
                )
            })
            .when(wide, |this| {
                this.child(
                    text(type_scale::XS, type_scale::XS_LINE)
                        .relative()
                        .flex()
                        .h_full()
                        .min_w_0()
                        .items_center()
                        .gap(px(SEGMENT_GAP))
                        .px(px(SEGMENT_PADDING_X))
                        .when(segment.show_account_name, |this| {
                            this.child(account_name(&segment.account, t))
                        })
                        .child(
                            div()
                                .flex_none()
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(t.foreground)
                                .font_features(theme::tabular())
                                .child(segment.remaining_label.clone()),
                        )
                        .child(
                            text(TEXT_2XS, TEXT_2XS_LINE)
                                .ml_auto()
                                .flex()
                                .flex_none()
                                .items_center()
                                .gap(px(PLATE_GAP))
                                .rounded(px(radius::SM))
                                .bg(fade(t.background, 0.85))
                                .px(px(PLATE_PADDING_X))
                                .py(px(PLATE_PADDING_Y))
                                .text_color(t.foreground)
                                .font_features(theme::tabular())
                                .children(plate_contents(segment, t, t.foreground)),
                        ),
                )
            })
            .when(open, |this| {
                this.child(
                    div()
                        .absolute()
                        .inset_0()
                        .rounded(px(radius::MD))
                        .border_1()
                        .border_color(t.border),
                )
            })
            .into_any_element()
    }

    fn legend(
        &self,
        window: &UsageLimitWindowView,
        segment: &UsageLimitSegmentView,
        color: Rgba,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let state_key = format!("{}|{}", window.key, segment.key);
        let anchor = format!("legend:{state_key}");
        let bounds = self.segment_bounds.clone();
        let anchor_key = anchor.clone();
        let hover_page = cx.entity().downgrade();
        let click_page = cx.entity().downgrade();
        let hover_key = state_key.clone();
        let hover_anchor = anchor.clone();
        let click_key = state_key.clone();
        let click_anchor = anchor;
        div()
            .id(SharedString::from(format!("usage-legend-{state_key}")))
            .relative()
            .child(
                Button::new(SharedString::from(format!(
                    "usage-legend-button-{state_key}"
                )))
                .variant(ButtonVariant::Ghost)
                .size(ButtonSize::Compact)
                .w_full()
                .on_click(move |_, _, cx| {
                    let _ = click_page.update(cx, |page, cx| {
                        page.click_segment(&click_key, &click_anchor, cx)
                    });
                })
                .child(
                    div()
                        .flex()
                        .w_full()
                        .min_w_0()
                        .items_center()
                        .gap(px(LEGEND_GAP))
                        .child(
                            div()
                                .relative()
                                .flex()
                                .flex_none()
                                .size(px(CHIP))
                                .items_center()
                                .justify_center()
                                .rounded(px(radius::SM))
                                .bg(fade(color, FILL_OPACITY))
                                .text_size(px(TEXT_3XS))
                                .line_height(px(TEXT_3XS))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(fade(t.foreground, 0.8))
                                .font_features(theme::tabular())
                                .child(segment.index.to_string()),
                        )
                        .child(account_name(&segment.account, t))
                        .child(
                            div()
                                .flex_none()
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(t.foreground)
                                .font_features(theme::tabular())
                                .child(segment.remaining_label.clone()),
                        )
                        .child(
                            text(TEXT_2XS, TEXT_2XS_LINE)
                                .ml_auto()
                                .flex()
                                .flex_none()
                                .items_center()
                                .gap(px(PLATE_GAP))
                                .text_color(t.muted_foreground)
                                .font_features(theme::tabular())
                                .children(plate_contents(segment, t, t.foreground)),
                        ),
                ),
            )
            .on_hover(move |hovered, _, cx| {
                let _ = hover_page.update(cx, |page, cx| {
                    page.hover_segment(&hover_key, &hover_anchor, *hovered, cx)
                });
            })
            .child(
                canvas(
                    move |trigger, _, _| {
                        bounds.borrow_mut().insert(anchor_key.clone(), trigger);
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .inset_0()
                .size_full(),
            )
            .into_any_element()
    }

    fn segment_popover(
        &self,
        view: &UsageView,
        window: &UsageLimitWindowView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let open = self.segment.as_ref()?;
        let segment = window
            .segments
            .iter()
            .find(|segment| format!("{}|{}", window.key, segment.key) == open.key)?;
        let anchor = self.segment_bounds.borrow().get(&open.anchor).copied()?;
        let state_key = open.key.clone();
        let height = self.popup_height.get();
        let side = if f32::from(anchor.top()) - POPOVER_OFFSET - height < POPOVER_VIEWPORT_MARGIN {
            Side::Bottom
        } else {
            Side::Top
        };
        let email = view.emails.get(&state_key).map(|email| {
            let shown = if open.revealed {
                &email.revealed
            } else {
                &email.hidden
            };
            let page = cx.entity().downgrade();
            let revealed = open.revealed;
            div()
                .id("usage-segment-email")
                .w_auto()
                .min_w_0()
                .cursor_pointer()
                .rounded(px(radius::SM))
                .font_family(MONO_FONT)
                .text_size(px(TEXT_2XS))
                .line_height(px(EMAIL_LINE))
                .text_color(if revealed {
                    t.muted_foreground
                } else {
                    fade(t.muted_foreground, 0.45)
                })
                .hover(|style| style.text_color(t.foreground))
                .tooltip(Tooltip::text(shown.tooltip.clone()))
                .on_click(move |_, _, cx| {
                    let _ = page.update(cx, |page, cx| page.toggle_email(cx));
                })
                .child(shown.text.clone())
        });
        let button = view.reset_buttons.get(&state_key).cloned();
        let credits =
            segment
                .popover
                .credits_summary
                .clone()
                .zip(button)
                .map(|(summary, button)| {
                    let client = self.client.clone();
                    let page = cx.entity().downgrade();
                    let key = state_key.clone();
                    popover_block(t).text_color(t.muted_foreground).child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(CREDITS_GAP))
                            .child(div().font_features(theme::tabular()).child(summary))
                            .child(
                                Button::new("usage-segment-redeem")
                                    .variant(ButtonVariant::Outline)
                                    .size(ButtonSize::Xs)
                                    .ml_auto()
                                    .label(button.label.clone())
                                    .disabled(button.disabled)
                                    .on_click(move |_, _, cx| {
                                        let _ = page.update(cx, |page, cx| {
                                            page.segment = None;
                                            cx.notify();
                                        });
                                        act(
                                            &client,
                                            cx,
                                            "usageRedeemRequest",
                                            json!({ "key": key }),
                                        );
                                    }),
                            ),
                    )
                });
        let hover_page = cx.entity().downgrade();
        let dismiss_page = cx.entity().downgrade();
        let height_cell = self.popup_height.clone();
        let content = div()
            .id("usage-segment-popover")
            .relative()
            .flex()
            .flex_col()
            .w(px(POPOVER_WIDTH))
            .gap(px(POPOVER_GAP))
            .text_size(px(type_scale::XS))
            .line_height(px(type_scale::XS_LINE))
            .on_hover(move |hovered, _, cx| {
                let _ = hover_page.update(cx, |page, cx| page.hover_popup(*hovered, cx));
            })
            .child(
                canvas(
                    move |bounds, _, _| {
                        height_cell.set(f32::from(bounds.size.height) + 34.);
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .inset_0()
                .size_full(),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .min_w_0()
                    .gap(px(2.))
                    .child(
                        text(type_scale::SM, type_scale::SM_LINE)
                            .flex()
                            .items_center()
                            .gap(px(HEADING_GAP))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.foreground)
                            .children(account_avatar(view, &segment.account, t))
                            .child(
                                div()
                                    .min_w_0()
                                    .truncate()
                                    .child(segment.account.title.clone()),
                            ),
                    )
                    .children(email),
            )
            .child(
                popover_block(t).children(
                    segment
                        .popover
                        .identity_rows
                        .iter()
                        .map(|row| popover_row(&row.label, &row.value, t)),
                ),
            )
            .child(
                popover_block(t).children(
                    segment
                        .popover
                        .status_rows
                        .iter()
                        .map(|row| popover_row(&row.label, &row.value, t)),
                ),
            )
            .children(credits);
        Some(
            PopoverPopup::new("usage-segment-popup", anchor)
                .side(side)
                .side_offset(POPOVER_OFFSET)
                .on_dismiss(move |_, cx| {
                    let _ = dismiss_page.update(cx, |page, cx| page.dismiss_segment(cx));
                })
                .child(content)
                .into_any_element(),
        )
    }
}
