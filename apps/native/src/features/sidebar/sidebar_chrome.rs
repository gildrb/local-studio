use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Entity, FontWeight, InteractiveElement, IntoElement, MouseButton,
    ParentElement, RenderOnce, SharedString, StatefulInteractiveElement, Styled, Window, div, img,
    px, rgb,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::sidebar::{
    FooterItemId, SidebarFooterView, StageBackdrop, UndoNoticeView,
};
use crate::ui::badge::{Badge, BadgeSize, BadgeVariant};
use crate::ui::sidebar::{
    SidebarFooter, SidebarMenu, SidebarMenuButton, SidebarMenuButtonSize, SidebarMenuItem,
};
use crate::ui::sidebar_stage_backdrop::SidebarStageBackdrop;
use crate::ui::theme;
use crate::ui::theme::metrics::workspace;
use crate::ui::theme::tokens::Tokens;
use crate::ui::tooltip::Tooltip;

const BRAND_MARK: f32 = 24.;
const BRAND_HEIGHT: f32 = 28.;
const BRAND_GAP: f32 = 8.;
const TEXT_SM: f32 = 14.;
const TEXT_SM_LINE: f32 = 20.;

pub fn titlebar_content_left(controls_left: f32) -> f32 {
    controls_left + workspace::TITLEBAR_CONTROL_SIZE + workspace::TITLEBAR_CONTROL_GAP
}

#[derive(IntoElement)]
pub struct SidebarChromeHeader {
    brand_label: SharedString,
    backdrop: Option<StageBackdrop>,
    pill: Option<SharedString>,
    controls_left: f32,
}

impl SidebarChromeHeader {
    pub fn new(
        brand_label: impl Into<SharedString>,
        backdrop: Option<StageBackdrop>,
        controls_left: f32,
    ) -> Self {
        Self {
            brand_label: brand_label.into(),
            backdrop,
            pill: None,
            controls_left,
        }
    }

    pub fn pill(mut self, label: Option<impl Into<SharedString>>) -> Self {
        self.pill = label.map(Into::into);
        self
    }
}

impl RenderOnce for SidebarChromeHeader {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::sidebar(cx);
        let on_backdrop = self.backdrop.is_some();
        let brand_color = if on_backdrop {
            rgb(0xffffff)
        } else {
            t.foreground
        };
        div()
            .relative()
            .flex()
            .flex_none()
            .flex_row()
            .items_center()
            .gap(px(8.))
            .h(px(workspace::TOPBAR_HEIGHT))
            .on_mouse_down(MouseButton::Left, |_, window, _| window.start_window_move())
            .when_some(self.backdrop, |this, variant| {
                this.child(SidebarStageBackdrop::new(variant))
            })
            .child(
                div()
                    .relative()
                    .flex()
                    .flex_none()
                    .items_center()
                    .h(px(BRAND_HEIGHT))
                    .ml(px(titlebar_content_left(self.controls_left)))
                    .overflow_hidden()
                    .rounded(px(8.))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .min_w_0()
                            .gap(px(BRAND_GAP))
                            .text_size(px(TEXT_SM))
                            .line_height(px(TEXT_SM_LINE))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(brand_color)
                            .child(
                                img("brand/local-studio.png")
                                    .flex_none()
                                    .size(px(BRAND_MARK)),
                            )
                            .child(div().truncate().child(self.brand_label)),
                    ),
            )
            .when_some(self.pill, |this, label| {
                this.child(
                    Badge::new()
                        .variant(BadgeVariant::Secondary)
                        .size(BadgeSize::Sm)
                        .ml(px(4.))
                        .label(label),
                )
            })
    }
}

fn footer_icon(id: FooterItemId) -> &'static str {
    match id {
        FooterItemId::Settings => "icons/settings.svg",
        FooterItemId::PullRequests => "icons/git-pull-request-arrow.svg",
        FooterItemId::Usage => "icons/chart-no-axes-column.svg",
    }
}

fn footer_key(id: FooterItemId) -> &'static str {
    match id {
        FooterItemId::Settings => "settings",
        FooterItemId::PullRequests => "pull-requests",
        FooterItemId::Usage => "usage",
    }
}

const NOTICE_RADIUS: f32 = 10.;
const NOTICE_PADDING_X: f32 = 8.;
const NOTICE_PADDING_Y: f32 = 6.;
const NOTICE_TEXT: f32 = 11.;
const NOTICE_LINE: f32 = 16.;

fn undo_notice(notice: &UndoNoticeView, client: &Entity<CoreClient>, t: &Tokens) -> AnyElement {
    let client = client.clone();
    div()
        .flex()
        .flex_wrap()
        .items_center()
        .rounded(px(NOTICE_RADIUS))
        .border_1()
        .border_color(t.sidebar_border)
        .bg(t.sidebar_control_surface)
        .px(px(NOTICE_PADDING_X))
        .py(px(NOTICE_PADDING_Y))
        .text_size(px(NOTICE_TEXT))
        .line_height(px(NOTICE_LINE))
        .text_color(t.sidebar_muted_foreground)
        .child(SharedString::from(format!("{}\u{a0}", notice.text)))
        .child(
            div()
                .id("sidebar-thread-undo")
                .flex_none()
                .cursor_pointer()
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.foreground)
                .hover(|style| style.underline())
                .on_click(move |_, _, cx| {
                    client.update(cx, |client, _| client.act("threadUndoLatest", json!({})))
                })
                .child(SharedString::from(notice.action_label.clone())),
        )
        .into_any_element()
}

#[derive(IntoElement)]
pub struct SidebarChromeFooter {
    view: SidebarFooterView,
    client: Entity<CoreClient>,
}

impl SidebarChromeFooter {
    pub fn new(view: &SidebarFooterView, client: Entity<CoreClient>) -> Self {
        Self {
            view: view.clone(),
            client,
        }
    }
}

impl RenderOnce for SidebarChromeFooter {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::sidebar(cx);
        let client = self.client;
        SidebarFooter::new()
            .flex_none()
            .children(
                self.view
                    .undo_notice
                    .as_ref()
                    .map(|notice| undo_notice(notice, &client, &t)),
            )
            .child(
                SidebarMenu::new()
                    .flex_row()
                    .items_center()
                    .when_some(self.view.back.clone(), |this, back| {
                        let target = client.clone();
                        this.child(
                            SidebarMenuItem::new().flex_1().min_w_0().child(
                                SidebarMenuButton::new("sidebar-utility-back")
                                    .icon("icons/arrow-left.svg")
                                    .label(SharedString::from(back.label))
                                    .on_click(move |_, _, cx| {
                                        target.update(cx, |client, _| {
                                            client.act("sidebarFooterBack", json!({}))
                                        })
                                    }),
                            ),
                        )
                    })
                    .when(self.view.back.is_none(), |this| {
                        this.children(self.view.items.into_iter().map(|item| {
                            let key = footer_key(item.id);
                            let target = client.clone();
                            SidebarMenuItem::new().flex_none().child(
                                div()
                                    .id(SharedString::from(format!("sidebar-utility-tip-{key}")))
                                    .tooltip(Tooltip::text(SharedString::from(item.label)))
                                    .child(
                                        SidebarMenuButton::new(SharedString::from(format!(
                                            "sidebar-utility-{key}"
                                        )))
                                        .size(SidebarMenuButtonSize::Icon)
                                        .icon(footer_icon(item.id))
                                        .on_click(
                                            move |_, _, cx| {
                                                target.update(cx, |client, _| {
                                                    client.act(
                                                        "sidebarFooterNavigate",
                                                        json!({ "id": key }),
                                                    )
                                                })
                                            },
                                        ),
                                    ),
                            )
                        }))
                    }),
            )
    }
}
