use std::cell::Cell;
use std::collections::HashMap;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, BoxShadow, ClickEvent, Context, Entity, FocusHandle, FontWeight,
    Image, ImageFormat, InteractiveElement, IntoElement, KeyDownEvent, ParentElement, Render, Rgba,
    SharedString, StatefulInteractiveElement, Styled, Window, canvas, div, img, point, px,
    relative, rgba, svg,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::settings_themes::{
    SettingsThemesView, ThemeCardView, ThemeModeTileView, ThemeOrbView, ThemePaneColorsView,
    ThemeRemovalView, ThemeVariantGroupView, ThemeWireframePaneView,
};
use crate::features::settings::primitives::SECTION_INSET_X;
use crate::ui::alert_dialog::{
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup,
    AlertDialogTitle,
};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::theme;
use crate::ui::theme::color::{BLACK, alpha, parse_hex};
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::tooltip::Tooltip;

type ActionHandler = Box<dyn Fn(&mut Window, &mut App)>;

const STACK_GAP: f32 = 12.;
const TITLE_OPACITY: f32 = 0.7;
const TILE_GAP: f32 = 12.;
const TILE_RADIUS: f32 = 14.;
const TILE_PADDING: f32 = 8.;
const TILE_INNER_GAP: f32 = 6.;
const WIREFRAME_HEIGHT: f32 = 140.;
const WIREFRAME_RADIUS: f32 = 10.;
const HEADER_MIN_HEIGHT: f32 = 32.;
const HEADER_PADDING_TOP: f32 = 8.;
const HEADER_GAP: f32 = 12.;
const HEADER_ACTIONS_GAP: f32 = 8.;
const GRID_GAP: f32 = 8.;
const CARD_MIN_WIDTH: f32 = 256.;
const CARD_RADIUS: f32 = 14.;
const PREVIEW_ROW_MIN_HEIGHT: f32 = 64.;
const PREVIEW_ROW_GAP: f32 = 10.;
const PREVIEW_ROW_PADDING_X: f32 = 12.;
const PREVIEW_ROW_PADDING_TOP: f32 = 12.;
const PREVIEW_BUTTON: f32 = 68.;
const ORB: f32 = 56.;
const ORB_BORDER: f32 = 2.;
const BADGE: f32 = 20.;
const BADGE_ICON: f32 = 12.;
const BADGE_INSET: f32 = 2.;
const FOOTER_PADDING_X: f32 = 12.;
const FOOTER_PADDING_TOP: f32 = 8.;
const FOOTER_PADDING_BOTTOM: f32 = 12.;
const FOOTER_GAP: f32 = 8.;
const ACTIONS_GAP: f32 = 4.;
const ACTION_ICON: f32 = 14.;
const VARIANT_AREA_HEIGHT: f32 = 80.;
const VARIANT_ROOT_OFFSET: f32 = 52.;
const VARIANT_ROOT_TOP: f32 = 8.;
const VARIANT_BADGE: f32 = 16.;
const VARIANT_BADGE_ICON: f32 = 10.;
const VARIANT_LABEL_MAX_WIDTH: f32 = 96.;
const VARIANT_OPTION: f32 = 28.;
const VARIANT_OPTION_ORB: f32 = 24.;
const VARIANT_OPTION_TOP: f32 = 4.;
const VARIANT_SPREAD: f32 = 68.;
const VARIANT_LIFT: f32 = 10.;
const REMOVAL_GRID_PADDING: f32 = 24.;
const REMOVAL_GRID_GAP: f32 = 8.;
const REMOVAL_GRID_MAX_HEIGHT: f32 = 288.;
const REMOVAL_OPTION_MIN_HEIGHT: f32 = 112.;
const REMOVAL_OPTION_PADDING: f32 = 12.;
const REMOVAL_ORB: f32 = 42.;
const REMOVAL_ORB_SLOT: f32 = 44.;
const REMOVAL_CHECK: f32 = 16.;
const WIREFRAME_LINE: u32 = 0x7f7f7f40;

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &'static str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

fn color(value: &str) -> Rgba {
    parse_hex(value).unwrap_or(rgba(0x00000000))
}

fn edge_shadow(mode: &str) -> Vec<BoxShadow> {
    let (ring, drop) = if mode == "dark" {
        (alpha(gpui::white().into(), 0.14), alpha(BLACK, 0.18))
    } else {
        (alpha(BLACK, 0.10), alpha(BLACK, 0.08))
    };
    vec![
        BoxShadow {
            color: ring.into(),
            offset: point(px(0.), px(0.)),
            blur_radius: px(0.),
            spread_radius: px(1.),
            inset: true,
        },
        BoxShadow {
            color: drop.into(),
            offset: point(px(0.), px(1.)),
            blur_radius: px(2.),
            spread_radius: px(0.),
            inset: false,
        },
    ]
}

fn small_shadow() -> Vec<BoxShadow> {
    vec![BoxShadow {
        color: alpha(BLACK, 0.05).into(),
        offset: point(px(0.), px(1.)),
        blur_radius: px(2.),
        spread_radius: px(0.),
        inset: false,
    }]
}

fn tooltip_wrap(id: SharedString, tooltip: &str, child: impl IntoElement) -> AnyElement {
    div()
        .id(id)
        .flex_none()
        .tooltip(Tooltip::text(tooltip.to_string()))
        .child(child)
        .into_any_element()
}

pub struct ThemesBlock {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<SettingsThemesView>>>,
    images: HashMap<String, Arc<Image>>,
    grid_width: Rc<Cell<f32>>,
    open_variant: Option<(String, String)>,
    dialog_focus: FocusHandle,
    dialog_open: bool,
    import: Option<Entity<super::theme_import::ThemeImportDialog>>,
}

impl ThemesBlock {
    pub fn new(client: Entity<CoreClient>, cx: &mut Context<Self>) -> Self {
        let view = CoreClient::subscribe::<Option<SettingsThemesView>>(
            &client,
            "settingsThemes",
            json!({}),
            cx,
        );
        cx.observe(&view, |_, _, cx| cx.notify()).detach();
        act(&client, cx, "settingsThemesMount", json!({}));
        Self {
            client,
            view,
            images: HashMap::new(),
            grid_width: Rc::new(Cell::new(0.)),
            open_variant: None,
            dialog_focus: cx.focus_handle(),
            dialog_open: false,
            import: None,
        }
    }

    fn image(&mut self, orb: &ThemeOrbView) -> Arc<Image> {
        self.images
            .entry(orb.svg.clone())
            .or_insert_with(|| {
                Arc::new(Image::from_bytes(
                    ImageFormat::Svg,
                    orb.svg.clone().into_bytes(),
                ))
            })
            .clone()
    }

    fn orb(&mut self, orb: &ThemeOrbView, size: f32, t: &Tokens) -> AnyElement {
        let image = self.image(orb);
        let border = (ORB_BORDER * size / ORB).max(1.);
        div()
            .relative()
            .flex_none()
            .size(px(size))
            .rounded(px(radius::FULL))
            .overflow_hidden()
            .border(px(border))
            .border_color(t.background)
            .bg(t.background)
            .shadow(edge_shadow(&orb.mode))
            .child(img(image).size_full().rounded(px(radius::FULL)))
            .into_any_element()
    }

    fn section_title(title: &str, t: &Tokens) -> gpui::Div {
        div()
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .text_color(fade(t.foreground, TITLE_OPACITY))
            .child(SharedString::from(title.to_string()))
    }

    fn pane(colors: &ThemePaneColorsView) -> gpui::Div {
        let line = rgba(WIREFRAME_LINE);
        let block = |left: f32, top: f32, width: f32, height: f32, fill: Rgba| {
            div()
                .absolute()
                .left(relative(left))
                .top(relative(top))
                .w(relative(width))
                .h(relative(height))
                .bg(fill)
        };
        let surface = color(&colors.surface);
        let message = color(&colors.message_surface);
        let action = color(&colors.message_action);
        let island_row = |row: usize, dot: Rgba| {
            div()
                .absolute()
                .left(relative(0.11))
                .right(relative(0.11))
                .top(relative(0.10 + row as f32 * 0.30))
                .h(relative(0.20))
                .flex()
                .items_center()
                .gap(px(4.))
                .child(
                    div()
                        .flex_none()
                        .size(px(5.))
                        .rounded(px(radius::FULL))
                        .bg(fade(dot, 0.55)),
                )
                .child(
                    div()
                        .h(relative(0.30))
                        .w(relative(0.52))
                        .rounded(px(2.))
                        .bg(line),
                )
        };
        div()
            .absolute()
            .top_0()
            .left_0()
            .size_full()
            .bg(color(&colors.canvas))
            .child(
                div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .left_0()
                    .w(relative(0.22))
                    .bg(color(&colors.sidebar))
                    .border_r_1()
                    .border_color(line),
            )
            .child(
                block(0.03, 0.08, 0.16, 0.08, surface)
                    .rounded(px(radius::MD))
                    .border_1()
                    .border_color(line),
            )
            .child(
                block(0.03, 0.22, 0.16, 0.07, color(&colors.accent_surface))
                    .rounded(px(radius::MD)),
            )
            .child(
                block(0.03, 0.32, 0.16, 0.07, message)
                    .rounded(px(radius::MD))
                    .opacity(0.7),
            )
            .child(
                block(0.03, 0.42, 0.16, 0.07, message)
                    .rounded(px(radius::MD))
                    .opacity(0.5),
            )
            .child(block(0.48, 0.11, 0.24, 0.09, message).rounded(px(radius::LG)))
            .child(block(0.27, 0.28, 0.34, 0.05, line).rounded(px(radius::SM)))
            .child(block(0.27, 0.38, 0.26, 0.05, line).rounded(px(radius::SM)))
            .child(
                div()
                    .absolute()
                    .bottom(relative(0.08))
                    .left(relative(0.26))
                    .right(relative(0.06))
                    .h(relative(0.15))
                    .flex()
                    .items_center()
                    .justify_between()
                    .px(px(4.))
                    .rounded(px(radius::MD))
                    .bg(surface)
                    .border_1()
                    .border_color(line)
                    .child(
                        div()
                            .h(relative(0.26))
                            .w(relative(0.34))
                            .rounded(px(radius::FULL))
                            .bg(line)
                            .opacity(0.7),
                    )
                    .child(
                        div()
                            .flex_none()
                            .size(px(12.))
                            .rounded(px(radius::FULL))
                            .bg(action),
                    ),
            )
            .child(
                div()
                    .absolute()
                    .right(relative(0.05))
                    .top(relative(0.08))
                    .h(relative(0.46))
                    .w(relative(0.20))
                    .rounded(px(radius::LG))
                    .bg(surface)
                    .border_1()
                    .border_color(line)
                    .shadow(vec![BoxShadow {
                        color: alpha(BLACK, 0.14).into(),
                        offset: point(px(0.), px(2.)),
                        blur_radius: px(5.),
                        spread_radius: px(0.),
                        inset: false,
                    }])
                    .child(island_row(0, rgba(0x34d399ff)))
                    .child(island_row(1, action))
                    .child(island_row(2, rgba(0xfbbf24ff))),
            )
    }

    fn wireframe(&self, panes: &[ThemeWireframePaneView], t: &Tokens) -> AnyElement {
        let grid = self.grid_width.get();
        let width = (grid - 2. * TILE_GAP) / 3. - 2. * TILE_PADDING - 2.;
        let layers = panes.iter().map(|pane| match pane.clip.as_deref() {
            Some(side) if width > 0. => {
                let half = width / 2. - 1.;
                let clip = div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .w(px(half))
                    .overflow_hidden();
                let clip = if side == "left" {
                    clip.left_0()
                } else {
                    clip.right_0()
                };
                let inner = div()
                    .absolute()
                    .top_0()
                    .bottom_0()
                    .w(px(width))
                    .child(Self::pane(&pane.colors));
                let inner = if side == "left" {
                    inner.left_0()
                } else {
                    inner.right_0()
                };
                clip.child(inner).into_any_element()
            }
            _ => Self::pane(&pane.colors).into_any_element(),
        });
        div()
            .relative()
            .w_full()
            .h(px(WIREFRAME_HEIGHT))
            .overflow_hidden()
            .rounded(px(WIREFRAME_RADIUS))
            .border_1()
            .border_color(fade(t.border, 0.6))
            .children(layers)
            .into_any_element()
    }

    fn mode_tile(&self, tile: &ThemeModeTileView, t: &Tokens) -> AnyElement {
        let client = self.client.clone();
        let mode = tile.mode.clone();
        let hover = fade(t.accent, 0.1);
        div()
            .id(SharedString::from(format!("theme-mode-{}", tile.mode)))
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .gap(px(TILE_INNER_GAP))
            .p(px(TILE_PADDING))
            .rounded(px(TILE_RADIUS))
            .border_1()
            .cursor_pointer()
            .map(|this| {
                if tile.active {
                    this.border_color(t.ring).bg(fade(t.accent, 0.3))
                } else {
                    this.border_color(fade(t.border, 0.7))
                        .bg(fade(t.card, 0.6))
                        .hover(move |s| s.bg(hover))
                }
            })
            .on_click(move |_: &ClickEvent, _, cx| {
                act(&client, cx, "settingsThemesMode", json!({ "mode": mode }));
            })
            .child(self.wireframe(&tile.panes, t))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_size(px(text::XS))
                    .line_height(px(text::XS_LINE))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(if tile.active {
                        t.foreground
                    } else {
                        t.muted_foreground
                    })
                    .child(SharedString::from(tile.label.clone())),
            )
            .into_any_element()
    }

    fn badge(icon: &str, size: f32, icon_size: f32, t: &Tokens) -> gpui::Div {
        div()
            .flex()
            .items_center()
            .justify_center()
            .size(px(size))
            .rounded(px(radius::FULL))
            .border_1()
            .border_color(fade(t.border, 0.7))
            .bg(t.background)
            .text_color(t.foreground)
            .shadow(small_shadow())
            .child(
                svg()
                    .path(SharedString::from(format!("icons/{icon}.svg")))
                    .size(px(icon_size))
                    .text_color(t.foreground),
            )
    }

    fn use_intent(
        &self,
        intent: Value,
        collection_id: Option<String>,
    ) -> impl Fn(&mut App) + 'static {
        let client = self.client.clone();
        move |cx: &mut App| {
            act(
                &client,
                cx,
                "settingsThemesUse",
                json!({ "intent": intent.clone(), "collectionId": collection_id.clone() }),
            );
        }
    }

    fn previews(&mut self, card: &ThemeCardView, t: &Tokens) -> AnyElement {
        let previews: Vec<AnyElement> = card
            .previews
            .iter()
            .map(|preview| {
                let orb = self.orb(&preview.orb, ORB, t);
                let apply = self.use_intent(
                    json!({ "steps": [preview.pick.clone()], "variantIndex": null }),
                    card.collection_id.clone(),
                );
                let ring = t.ring;
                div()
                    .id(SharedString::from(format!(
                        "theme-preview-{}-{}",
                        card.key, preview.mode
                    )))
                    .relative()
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_center()
                    .size(px(PREVIEW_BUTTON))
                    .rounded(px(radius::FULL))
                    .cursor_pointer()
                    .tooltip(Tooltip::text(preview.tooltip.clone()))
                    .on_click(move |_: &ClickEvent, _, cx| {
                        cx.stop_propagation();
                        apply(cx);
                    })
                    .child(orb)
                    .when(preview.picked, |this| {
                        this.child(
                            div()
                                .absolute()
                                .top_0()
                                .left_0()
                                .size_full()
                                .rounded(px(radius::FULL))
                                .border_2()
                                .border_color(ring),
                        )
                        .child(
                            Self::badge(&preview.badge_icon, BADGE, BADGE_ICON, t)
                                .absolute()
                                .bottom(px(BADGE_INSET))
                                .right(px(BADGE_INSET)),
                        )
                    })
                    .into_any_element()
            })
            .collect();
        div()
            .flex()
            .min_h(px(PREVIEW_ROW_MIN_HEIGHT))
            .items_center()
            .justify_center()
            .gap(px(PREVIEW_ROW_GAP))
            .px(px(PREVIEW_ROW_PADDING_X))
            .pt(px(PREVIEW_ROW_PADDING_TOP))
            .children(previews)
            .into_any_element()
    }

    fn variant_group(
        &mut self,
        card: &ThemeCardView,
        group: &ThemeVariantGroupView,
        width: f32,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let root_offset = if group.mode == "light" {
            -VARIANT_ROOT_OFFSET
        } else {
            VARIANT_ROOT_OFFSET
        };
        let center = width / 2.;
        let open = self
            .open_variant
            .as_ref()
            .is_some_and(|(key, mode)| key == &card.key && mode == &group.mode);
        let mut elements = Vec::new();
        let hover_key = (card.key.clone(), group.mode.clone());
        let root_orb = self.orb(&group.selected.orb, ORB, t);
        let select = self.use_intent(group.selected.select.clone(), card.collection_id.clone());
        elements.push(
            div()
                .id(SharedString::from(format!(
                    "theme-variant-{}-{}",
                    card.key, group.mode
                )))
                .absolute()
                .top(px(VARIANT_ROOT_TOP))
                .left(px(center + root_offset - ORB / 2.))
                .size(px(ORB))
                .rounded(px(radius::FULL))
                .cursor_pointer()
                .tooltip(Tooltip::text(group.tooltip.clone()))
                .on_hover(cx.listener(move |block, hovered: &bool, _, cx| {
                    if *hovered {
                        block.open_variant = Some(hover_key.clone());
                        cx.notify();
                    }
                }))
                .on_click(move |_: &ClickEvent, _, cx| {
                    cx.stop_propagation();
                    select(cx);
                })
                .child(root_orb)
                .when(group.active, |this| {
                    this.child(
                        div()
                            .absolute()
                            .top_0()
                            .left_0()
                            .size_full()
                            .rounded(px(radius::FULL))
                            .border_2()
                            .border_color(t.ring),
                    )
                    .child(
                        Self::badge(&group.badge_icon, VARIANT_BADGE, VARIANT_BADGE_ICON, t)
                            .absolute()
                            .bottom(px(-2.))
                            .right(px(-2.)),
                    )
                })
                .into_any_element(),
        );
        elements.push(
            div()
                .absolute()
                .bottom_0()
                .left(px(center + root_offset - VARIANT_LABEL_MAX_WIDTH / 2.))
                .w(px(VARIANT_LABEL_MAX_WIDTH))
                .flex()
                .justify_center()
                .child(
                    div()
                        .flex()
                        .min_w_0()
                        .items_center()
                        .gap(px(4.))
                        .text_size(px(11.))
                        .line_height(px(16.))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.foreground)
                        .child(
                            div()
                                .min_w_0()
                                .truncate()
                                .child(SharedString::from(group.selected.label.clone())),
                        )
                        .when_some(group.extra_count_label.clone(), |this, label| {
                            this.child(
                                div()
                                    .flex_none()
                                    .rounded(px(radius::FULL))
                                    .bg(t.muted)
                                    .px(px(4.))
                                    .text_size(px(10.))
                                    .line_height(px(14.))
                                    .text_color(t.muted_foreground)
                                    .child(SharedString::from(label)),
                            )
                        }),
                )
                .into_any_element(),
        );
        if open {
            let count = group.options.len();
            for (index, option) in group.options.iter().enumerate() {
                let progress = if count > 1 {
                    index as f32 / (count - 1) as f32 - 0.5
                } else {
                    0.
                };
                let x = center + root_offset + progress * VARIANT_SPREAD - VARIANT_OPTION / 2.;
                let y = VARIANT_OPTION_TOP + progress.abs() * VARIANT_LIFT;
                let option_orb = self.orb(&option.orb, VARIANT_OPTION_ORB, t);
                let select = self.use_intent(option.select.clone(), card.collection_id.clone());
                let border = if option.active {
                    t.ring
                } else {
                    fade(t.border, 0.7)
                };
                elements.push(
                    div()
                        .id(SharedString::from(format!(
                            "theme-variant-option-{}-{}-{index}",
                            card.key, group.mode
                        )))
                        .absolute()
                        .top(px(y))
                        .left(px(x))
                        .flex()
                        .items_center()
                        .justify_center()
                        .size(px(VARIANT_OPTION))
                        .rounded(px(radius::FULL))
                        .bg(t.background)
                        .border(px(if option.active { 2. } else { 1. }))
                        .border_color(border)
                        .shadow(small_shadow())
                        .cursor_pointer()
                        .tooltip(Tooltip::text(option.tooltip.clone()))
                        .on_click(move |_: &ClickEvent, _, cx| {
                            cx.stop_propagation();
                            select(cx);
                        })
                        .child(option_orb)
                        .into_any_element(),
                );
            }
        }
        elements
    }

    fn card(
        &mut self,
        card: &ThemeCardView,
        width: f32,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let use_card = self.use_intent(card.use_intent.clone(), card.collection_id.clone());
        let use_title = self.use_intent(card.use_intent.clone(), card.collection_id.clone());
        let top = match card.variant_navigation.as_ref() {
            Some(navigation) => {
                let groups: Vec<AnyElement> = navigation
                    .groups
                    .iter()
                    .flat_map(|group| self.variant_group(card, group, width, t, cx))
                    .collect();
                div()
                    .id(SharedString::from(format!("theme-variants-{}", card.key)))
                    .relative()
                    .h(px(VARIANT_AREA_HEIGHT))
                    .on_hover(cx.listener(|block, hovered: &bool, _, cx| {
                        if !*hovered && block.open_variant.take().is_some() {
                            cx.notify();
                        }
                    }))
                    .children(groups)
                    .into_any_element()
            }
            None => self.previews(card, t),
        };
        let mut actions: Vec<AnyElement> = Vec::new();
        let action_button = |id: String,
                             icon: &str,
                             variant: ButtonVariant,
                             tooltip: &str,
                             on_click: ActionHandler| {
            tooltip_wrap(
                SharedString::from(format!("{id}-tooltip")),
                tooltip,
                Button::new(SharedString::from(id))
                    .size(ButtonSize::IconXs)
                    .variant(variant)
                    .icon(icon.to_string())
                    .icon_size(ACTION_ICON)
                    .on_click(move |_: &ClickEvent, window, cx| {
                        cx.stop_propagation();
                        on_click(window, cx);
                    }),
            )
        };
        if let Some(duplicate) = card.duplicate.as_ref() {
            let client = self.client.clone();
            let key = card.key.clone();
            actions.push(action_button(
                format!("theme-duplicate-{}", card.key),
                "copy",
                ButtonVariant::Ghost,
                &duplicate.tooltip,
                Box::new(move |_, cx| {
                    act(
                        &client,
                        cx,
                        "settingsThemesDuplicate",
                        json!({ "key": key }),
                    );
                }),
            ));
        }
        if let Some(edit) = card.edit.as_ref() {
            let client = self.client.clone();
            let key = card.key.clone();
            actions.push(action_button(
                format!("theme-edit-{}", card.key),
                "pen-line",
                ButtonVariant::Ghost,
                &edit.tooltip,
                Box::new(move |_, cx| {
                    act(&client, cx, "settingsThemesEdit", json!({ "key": key }));
                }),
            ));
        }
        if let Some(export) = card.export.as_ref() {
            let client = self.client.clone();
            let theme_id = export.theme_id.clone();
            let filename = export.filename.clone();
            actions.push(action_button(
                format!("theme-export-{}", card.key),
                "upload",
                ButtonVariant::Ghost,
                &export.tooltip,
                Box::new(move |_, cx| {
                    let directory = std::env::var_os("HOME")
                        .map(|home| PathBuf::from(home).join("Downloads"))
                        .unwrap_or_default();
                    let receiver = cx.prompt_for_new_path(&directory, Some(&filename));
                    let client = client.clone();
                    let theme_id = theme_id.clone();
                    cx.spawn(async move |cx| {
                        if let Ok(Ok(Some(path))) = receiver.await {
                            cx.update(|cx| {
                                act(
                                    &client,
                                    cx,
                                    "settingsThemesExport",
                                    json!({ "themeId": theme_id, "path": path.to_string_lossy() }),
                                );
                            });
                        }
                    })
                    .detach();
                }),
            ));
        }
        if let Some(remove) = card.remove.as_ref() {
            let client = self.client.clone();
            let theme_id = remove.theme_id.clone();
            actions.push(action_button(
                format!("theme-remove-{}", card.key),
                "settings/trash-2",
                ButtonVariant::GhostDestructive,
                &remove.tooltip,
                Box::new(move |_, cx| {
                    act(
                        &client,
                        cx,
                        "settingsThemesRemoveStart",
                        json!({ "themeId": theme_id }),
                    );
                }),
            ));
        }
        let hover = fade(t.accent, 0.1);
        div()
            .id(SharedString::from(format!("theme-card-{}", card.key)))
            .flex()
            .flex_col()
            .flex_1()
            .min_w_0()
            .overflow_hidden()
            .rounded(px(CARD_RADIUS))
            .border_1()
            .border_color(fade(t.border, 0.7))
            .bg(fade(t.card, 0.6))
            .hover(move |s| s.bg(hover))
            .cursor_pointer()
            .tooltip(Tooltip::text(card.tooltip.clone()))
            .on_click(move |_: &ClickEvent, _, cx| use_card(cx))
            .child(top)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(FOOTER_GAP))
                    .px(px(FOOTER_PADDING_X))
                    .pt(px(FOOTER_PADDING_TOP))
                    .pb(px(FOOTER_PADDING_BOTTOM))
                    .child(
                        div().flex_1().min_w_0().child(
                            div()
                                .id(SharedString::from(format!("theme-title-{}", card.key)))
                                .min_w_0()
                                .truncate()
                                .text_size(px(text::SM))
                                .line_height(px(text::SM_LINE))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.foreground)
                                .on_click(move |_: &ClickEvent, _, cx| {
                                    cx.stop_propagation();
                                    use_title(cx);
                                })
                                .child(SharedString::from(card.title.clone())),
                        ),
                    )
                    .when(!actions.is_empty(), |this| {
                        this.child(
                            div()
                                .flex()
                                .flex_none()
                                .items_center()
                                .gap(px(ACTIONS_GAP))
                                .children(actions),
                        )
                    }),
            )
            .into_any_element()
    }

    fn removal_dialog(&mut self, removal: &ThemeRemovalView, t: &Tokens) -> AnyElement {
        let cancel = self.client.clone();
        let dismiss = self.client.clone();
        let confirm = self.client.clone();
        let escape = self.client.clone();
        let options: Vec<AnyElement> = if removal.can_remove_collection {
            removal
                .options
                .iter()
                .map(|option| {
                    let orbs: Vec<AnyElement> = option
                        .orbs
                        .iter()
                        .map(|orb| {
                            div()
                                .flex()
                                .flex_none()
                                .items_center()
                                .justify_center()
                                .size(px(REMOVAL_ORB_SLOT))
                                .child(self.orb(orb, REMOVAL_ORB, t))
                                .into_any_element()
                        })
                        .collect();
                    let client = self.client.clone();
                    let theme_id = option.theme_id.clone();
                    let checked = option.checked;
                    div()
                        .id(SharedString::from(format!(
                            "theme-remove-option-{}",
                            option.theme_id
                        )))
                        .relative()
                        .flex()
                        .flex_col()
                        .flex_1()
                        .min_w_0()
                        .min_h(px(REMOVAL_OPTION_MIN_HEIGHT))
                        .items_center()
                        .justify_center()
                        .gap(px(8.))
                        .p(px(REMOVAL_OPTION_PADDING))
                        .rounded(px(radius::LG))
                        .border_1()
                        .cursor_pointer()
                        .map(|this| {
                            if checked {
                                this.border_color(t.ring).bg(fade(t.accent, 0.2))
                            } else {
                                let hover = fade(t.muted, 0.4);
                                this.border_color(fade(t.border, 0.7))
                                    .bg(fade(t.muted, 0.25))
                                    .hover(move |s| s.bg(hover))
                            }
                        })
                        .on_click(move |_: &ClickEvent, _, cx| {
                            act(
                                &client,
                                cx,
                                "settingsThemesRemoveToggle",
                                json!({ "themeId": theme_id, "checked": !checked }),
                            );
                        })
                        .child(
                            div()
                                .absolute()
                                .top(px(8.))
                                .right(px(8.))
                                .flex()
                                .items_center()
                                .justify_center()
                                .size(px(REMOVAL_CHECK))
                                .rounded(px(radius::SM))
                                .border_1()
                                .map(|this| {
                                    if checked {
                                        this.border_color(t.primary).bg(t.primary).child(
                                            svg()
                                                .path("icons/check.svg")
                                                .size(px(12.))
                                                .text_color(t.primary_foreground),
                                        )
                                    } else {
                                        this.border_color(t.input).bg(t.background)
                                    }
                                }),
                        )
                        .child(
                            div()
                                .flex()
                                .min_h(px(48.))
                                .items_center()
                                .justify_center()
                                .gap(px(4.))
                                .children(orbs),
                        )
                        .child(
                            div()
                                .max_w_full()
                                .truncate()
                                .text_center()
                                .text_size(px(text::SM))
                                .line_height(px(text::SM_LINE))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.foreground)
                                .child(SharedString::from(option.label.clone())),
                        )
                        .into_any_element()
                })
                .collect()
        } else {
            Vec::new()
        };
        let mut rows: Vec<AnyElement> = Vec::new();
        let mut iter = options.into_iter();
        while let Some(first) = iter.next() {
            let second = iter.next();
            rows.push(
                div()
                    .flex()
                    .gap(px(REMOVAL_GRID_GAP))
                    .child(first)
                    .children(second.or_else(|| Some(div().flex_1().into_any_element())))
                    .into_any_element(),
            );
        }
        let disabled = removal.confirm_disabled;
        div()
            .track_focus(&self.dialog_focus)
            .on_key_down(move |event: &KeyDownEvent, _, cx| {
                if event.keystroke.key == "escape" {
                    cx.stop_propagation();
                    act(&escape, cx, "settingsThemesRemoveCancel", json!({}));
                }
            })
            .child(
                AlertDialogPopup::new("theme-removal-dialog")
                    .on_dismiss(move |_, cx| {
                        act(&dismiss, cx, "settingsThemesRemoveCancel", json!({}))
                    })
                    .child(
                        AlertDialogHeader::new()
                            .child(AlertDialogTitle::new(removal.title.clone()))
                            .child(AlertDialogDescription::new(removal.description.clone())),
                    )
                    .when(removal.can_remove_collection, |this| {
                        this.child(
                            div()
                                .id("theme-removal-options")
                                .flex()
                                .flex_col()
                                .gap(px(REMOVAL_GRID_GAP))
                                .max_h(px(REMOVAL_GRID_MAX_HEIGHT))
                                .overflow_y_scroll()
                                .px(px(REMOVAL_GRID_PADDING))
                                .pb(px(REMOVAL_GRID_PADDING))
                                .children(rows),
                        )
                    })
                    .child(
                        AlertDialogFooter::new()
                            .child(
                                Button::new("theme-removal-cancel")
                                    .variant(ButtonVariant::Outline)
                                    .label(removal.cancel_label.clone())
                                    .on_click(move |_: &ClickEvent, _, cx| {
                                        act(&cancel, cx, "settingsThemesRemoveCancel", json!({}));
                                    }),
                            )
                            .child(
                                Button::new("theme-removal-confirm")
                                    .variant(ButtonVariant::Destructive)
                                    .label(removal.confirm_label.clone())
                                    .disabled(disabled)
                                    .on_click(move |_: &ClickEvent, _, cx| {
                                        act(&confirm, cx, "settingsThemesRemoveConfirm", json!({}));
                                    }),
                            ),
                    ),
            )
            .into_any_element()
    }
}

impl Render for ThemesBlock {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.view.read(cx).data.clone().flatten() else {
            return div().into_any_element();
        };
        let t = theme::active(cx);
        let dialog_open = view.removal.is_some();
        if dialog_open && !self.dialog_open {
            self.dialog_focus.focus(window, cx);
        }
        self.dialog_open = dialog_open;
        let tiles: Vec<AnyElement> = view
            .mode_tiles
            .iter()
            .map(|tile| self.mode_tile(tile, &t))
            .collect();
        let width = self.grid_width.get();
        let columns = if width > 0. {
            (((width + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP)).floor() as usize).max(1)
        } else {
            3
        };
        let card_width = if width > 0. {
            (width - GRID_GAP * (columns as f32 - 1.)) / columns as f32
        } else {
            CARD_MIN_WIDTH
        };
        let cards: Vec<AnyElement> = view
            .cards
            .iter()
            .map(|card| self.card(card, card_width, &t, cx))
            .collect();
        let mut rows: Vec<AnyElement> = Vec::new();
        let mut iter = cards.into_iter().peekable();
        while iter.peek().is_some() {
            let mut row: Vec<AnyElement> = Vec::new();
            for _ in 0..columns {
                match iter.next() {
                    Some(card) => row.push(card),
                    None => row.push(div().flex_1().min_w_0().into_any_element()),
                }
            }
            rows.push(
                div()
                    .flex()
                    .w_full()
                    .gap(px(GRID_GAP))
                    .children(row)
                    .into_any_element(),
            );
        }
        let measure = self.grid_width.clone();
        let entity = cx.entity().downgrade();
        let create = self.client.clone();
        let add = self.client.clone();
        let theme_button = |id: &'static str, icon: &'static str, label: &str| {
            Button::new(id)
                .size(ButtonSize::Xs)
                .variant(ButtonVariant::Outline)
                .icon(icon)
                .label(label.to_string())
        };
        let removal = view
            .removal
            .as_ref()
            .map(|removal| self.removal_dialog(removal, &t));
        let client = self.client.clone();
        let import = self
            .import
            .get_or_insert_with(|| {
                cx.new(|cx| super::theme_import::ThemeImportDialog::new(client, window, cx))
            })
            .clone();
        div()
            .flex()
            .flex_col()
            .w_full()
            .gap(px(STACK_GAP))
            .child(Self::section_title(&view.color_scheme_title, &t).px(px(SECTION_INSET_X)))
            .child(div().flex().w_full().gap(px(TILE_GAP)).children(tiles))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .min_h(px(HEADER_MIN_HEIGHT))
                    .items_center()
                    .justify_between()
                    .gap(px(HEADER_GAP))
                    .px(px(SECTION_INSET_X))
                    .pt(px(HEADER_PADDING_TOP))
                    .child(Self::section_title(&view.theme_title, &t))
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .items_center()
                            .justify_end()
                            .gap(px(HEADER_ACTIONS_GAP))
                            .child(
                                theme_button(
                                    "theme-create",
                                    "paintbrush",
                                    &view.create_theme_label,
                                )
                                .on_click(
                                    move |_: &ClickEvent, _, cx| {
                                        act(&create, cx, "settingsThemesCreate", json!({}));
                                    },
                                ),
                            )
                            .child(
                                theme_button("theme-add", "plus", &view.add_theme_label).on_click(
                                    move |_: &ClickEvent, _, cx| {
                                        act(&add, cx, "settingsThemeImportOpen", json!({}));
                                    },
                                ),
                            ),
                    ),
            )
            .child(
                div()
                    .relative()
                    .flex()
                    .flex_col()
                    .w_full()
                    .gap(px(GRID_GAP))
                    .child(
                        canvas(
                            move |bounds, _, cx| {
                                let next = f32::from(bounds.size.width);
                                if (measure.get() - next).abs() > 0.5 {
                                    measure.set(next);
                                    let _ = entity.update(cx, |_, cx| cx.notify());
                                }
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .top_0()
                        .left_0()
                        .size_full(),
                    )
                    .children(rows),
            )
            .children(removal)
            .child(import)
            .into_any_element()
    }
}
