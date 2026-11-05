use gpui::component::input::InputState;
use gpui::component::input::TextareaState;
use gpui::component::input::{Enter, Escape, IndentInline, MoveDown, MoveUp, OutdentInline};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Bounds, ClickEvent, Entity, ExternalPaths, FontWeight, InteractiveElement,
    IntoElement, ParentElement, Pixels, RenderOnce, Rgba, SharedString, StatefulInteractiveElement,
    Styled, TextRun, Window, canvas, div, font, img, px, svg,
};
use serde_json::json;

use crate::app_core::client::CoreClient;
use crate::app_core::views::composer::{ComposerView, TraitsMenuView, TraitsOption};
use crate::app_core::views::composer_input::ComposerInteractionModeView;
use crate::app_core::views::model_picker::ModelPickerView;
use crate::app_core::views::sidebar::StageBackdrop;
use crate::features::chat::branch_toolbar::BranchToolbarHost;
use crate::features::chat::composer_input::{self, ComposerInput};
use crate::features::chat::composer_interactions;
use crate::features::chat::model_picker::ModelPicker;
use crate::features::chat::provider_instance_icon::{ProviderInstanceIcon, parse_accent};
use crate::platform::{COMPOSER_FONT, UI_FONT};
use crate::ui::menu::{MenuGroupLabel, MenuPopup, MenuRadioItem, MenuSeparator};
use crate::ui::popover::{Align, Side};
use crate::ui::textarea::bare_textarea;
use crate::ui::theme;
use crate::ui::theme::Appearance;
use crate::ui::theme::tokens::{Tokens, fade, glass_blur, glass_saturation};

const OVERLAY_TOP_PADDING: f32 = 8.;
const SURFACE_BOTTOM_PADDING: f32 = 20.;
const RESTING_CARD_HEIGHT: f32 = 144.;
const GUTTER_X: f32 = 20.;
const CARD_RADIUS: f32 = 22.;
const HIGHLIGHT: f32 = 0.03;
const OUTLINE: f32 = 0.05;
const EDITOR_PADDING_X: f32 = 16.;
const EDITOR_PADDING_TOP: f32 = 16.;
const EDITOR_PADDING_BOTTOM: f32 = 8.;
const EDITOR_MIN_HEIGHT: f32 = 70.;
const EDITOR_MAX_HEIGHT: f32 = 200.;
const PROMPT_LINE_RATIO: f32 = 1.625;
const FOOTER_PADDING_X: f32 = 16.;
const FOOTER_PADDING_BOTTOM: f32 = 16.;
const FOOTER_HEIGHT: f32 = 32.;
const FOOTER_PADDING_LEFT: f32 = 6.;
const CONTROL_HEIGHT: f32 = 28.;
const CONTROL_PADDING_X: f32 = 10.;
const CONTROL_GAP: f32 = 6.;
const CONTROL_RADIUS: f32 = 8.;
const CONTROL_TEXT: f32 = 14.;
const CONTROL_LINE: f32 = 20.;
const CONTROL_ICON: f32 = 16.;
const CONTROL_CHEVRON: f32 = 14.;
const CHEVRON_GAP: f32 = 4.;
const SEPARATOR_HEIGHT: f32 = 16.;
const CONTROL_BORDER: f32 = 1.;
const BLOCK_LEAD: f32 = 1. + CONTROL_GAP;
const MODEL_MIN_WIDTH: f32 = 52.;
const FOOTER_COMPACT_GAP: f32 = 6.;
const ACTIONS_GAP: f32 = 8.;
const ATTACH_SIZE: f32 = 28.;
const SEND_SIZE: f32 = 32.;
const SEND_GLYPH: f32 = 14.;
const STOP_GLYPH: f32 = 12.;
const DISABLED_OPACITY: f32 = 0.64;
const APPROVAL_EDITOR_PADDING_BOTTOM: f32 = 16.;
const DRAWER_INSET: f32 = 22.;
const DRAWER_OVERLAP: f32 = 16.;
const DRAWER_HEIGHT: f32 = 32.;
const DRAWER_FILL_RADIUS: f32 = 16.;
const DRAWER_OUTLINE_RADIUS: f32 = 18.;
const DRAWER_PADDING_TOP: f32 = 4.;
const DRAWER_PADDING_BOTTOM: f32 = 4.;
const DRAWER_PADDING_LEFT: f32 = 4.;
const DRAWER_PADDING_RIGHT: f32 = 8.;
const MENU_SIDE_OFFSET: f32 = 4.;
const OPTION_PADDING_X: f32 = 8.;
const OPTION_PADDING_Y: f32 = 4.;
const OPTION_RADIUS: f32 = 6.;
const OPTION_GAP: f32 = 6.;
const OPTION_ICON: f32 = 14.;
const OPTION_TITLE_TEXT: f32 = 14.;
const OPTION_TITLE_LINE: f32 = 20.;
const OPTION_DESCRIPTION_TEXT: f32 = 12.;
const OPTION_DESCRIPTION_LINE: f32 = 16.;
const OPTION_SELECTED: f32 = 0.08;
const GROUP_LABEL_PADDING_TOP: f32 = 6.;
const GROUP_LABEL_PADDING_BOTTOM: f32 = 4.;
const GROUP_NOTE_OPACITY: f32 = 0.8;
const GROUP_NOTE_PADDING_BOTTOM: f32 = 6.;
const DESCRIPTION_MAX_WIDTH: f32 = 224.;
const BADGE_TEXT: f32 = 10.;
const BADGE_HEIGHT: f32 = 16.;
const BADGE_PADDING_X: f32 = 3.;
const BADGE_RADIUS: f32 = 4.;
const BADGE_FILL: f32 = 0.0256;
const BADGE_GAP: f32 = 4.;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ComposerMenu {
    Traits,
    Access,
    Overflow,
}

#[derive(Default)]
pub struct ComposerMenuState {
    open: Option<ComposerMenu>,
    traits_bounds: Bounds<Pixels>,
    access_bounds: Bounds<Pixels>,
    overflow_bounds: Bounds<Pixels>,
    model_bounds: Bounds<Pixels>,
    overlay_height: f32,
    stack_bounds: Option<Bounds<Pixels>>,
    form_width: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FooterBlock {
    Traits,
    Mode,
}

impl ComposerMenuState {
    fn bounds(&self, menu: ComposerMenu) -> Bounds<Pixels> {
        match menu {
            ComposerMenu::Traits => self.traits_bounds,
            ComposerMenu::Access => self.access_bounds,
            ComposerMenu::Overflow => self.overflow_bounds,
        }
    }

    fn set_bounds(&mut self, menu: ComposerMenu, bounds: Bounds<Pixels>) {
        match menu {
            ComposerMenu::Traits => self.traits_bounds = bounds,
            ComposerMenu::Access => self.access_bounds = bounds,
            ComposerMenu::Overflow => self.overflow_bounds = bounds,
        }
    }
}

pub const RESTING_HEIGHT: f32 =
    OVERLAY_TOP_PADDING + RESTING_CARD_HEIGHT + DRAWER_HEIGHT + SURFACE_BOTTOM_PADDING;
const HEIGHT_EPSILON: f32 = 0.5;

fn stage_art(stage: StageBackdrop, appearance: Appearance) -> &'static str {
    match (stage, appearance) {
        (StageBackdrop::Dev, Appearance::Dark) => "stage/dev-dark-button.svg",
        (StageBackdrop::Dev, Appearance::Light) => "stage/dev-light-button.svg",
        (StageBackdrop::Nightly, Appearance::Dark) => "stage/nightly-dark-button.svg",
        (StageBackdrop::Nightly, Appearance::Light) => "stage/nightly-light-button.svg",
    }
}

fn access_icon(mode: &str) -> &'static str {
    match mode {
        "approval-required" => "icons/lock.svg",
        "auto-accept-edits" => "icons/pen-line.svg",
        "auto" => "icons/sparkles.svg",
        _ => "icons/lock-open.svg",
    }
}

fn glyph(path: &'static str, size: f32, color: Rgba) -> gpui::Svg {
    svg()
        .path(path)
        .flex_none()
        .size(px(size))
        .text_color(color)
}

fn control(id: &'static str, t: &Tokens) -> gpui::Stateful<gpui::Div> {
    let hover_bg = t.accent;
    let hover_fg = t.foreground;
    div()
        .id(id)
        .flex()
        .flex_none()
        .items_center()
        .h(px(CONTROL_HEIGHT))
        .px(px(CONTROL_PADDING_X))
        .rounded(px(CONTROL_RADIUS))
        .border_1()
        .border_color(gpui::transparent_black())
        .text_size(px(CONTROL_TEXT))
        .line_height(px(CONTROL_LINE))
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.secondary_label)
        .whitespace_nowrap()
        .cursor_pointer()
        .hover(move |s| s.bg(hover_bg).text_color(hover_fg))
}

fn label(text: String, after_icon: bool) -> gpui::Div {
    div()
        .flex_none()
        .when(after_icon, |this| this.ml(px(CONTROL_GAP)))
        .child(SharedString::from(text))
}

fn chevron(t: &Tokens) -> gpui::Svg {
    glyph("icons/chevron-down.svg", CONTROL_CHEVRON, t.icon_muted).ml(px(CHEVRON_GAP))
}

fn separator(t: &Tokens) -> gpui::Div {
    div()
        .flex_none()
        .w(px(1.))
        .h(px(SEPARATOR_HEIGHT))
        .bg(t.border)
}

fn control_width(icon: bool, label: Option<f32>, chevron: bool) -> f32 {
    let icon_width = if icon { CONTROL_ICON } else { 0. };
    let label_width = label.map_or(0., |width| width + if icon { CONTROL_GAP } else { 0. });
    let chevron_width = if chevron {
        CHEVRON_GAP + CONTROL_CHEVRON
    } else {
        0.
    };
    2. * (CONTROL_PADDING_X + CONTROL_BORDER) + icon_width + label_width + chevron_width
}

fn text_width(window: &Window, text: &str) -> f32 {
    let mut run_font = font(UI_FONT);
    run_font.weight = FontWeight::MEDIUM;
    let run = TextRun {
        len: text.len(),
        font: run_font,
        ..Default::default()
    };
    f32::from(
        window
            .text_system()
            .shape_line(
                SharedString::from(text.to_string()),
                px(CONTROL_TEXT),
                &[run],
                None,
            )
            .width,
    )
}

fn menu_trigger(
    element: gpui::Stateful<gpui::Div>,
    menu: ComposerMenu,
    state: &Entity<ComposerMenuState>,
) -> gpui::Stateful<gpui::Div> {
    let toggle = state.clone();
    let measure = state.clone();
    element
        .relative()
        .on_click(move |_: &ClickEvent, _, cx| {
            toggle.update(cx, |state, cx| {
                state.open = if state.open == Some(menu) {
                    None
                } else {
                    Some(menu)
                };
                cx.notify();
            });
        })
        .child(
            canvas(
                move |bounds, _, cx| {
                    measure.update(cx, |state, _| state.set_bounds(menu, bounds));
                },
                |_, _, _, _| {},
            )
            .absolute()
            .size_full(),
        )
}

#[derive(IntoElement)]
pub struct ChatComposer {
    view: ComposerView,
    editor: Entity<TextareaState>,
    client: Entity<CoreClient>,
    menus: Entity<ComposerMenuState>,
    stage: Option<StageBackdrop>,
    model_picker: Option<(ModelPickerView, Entity<InputState>)>,
    hero: Option<gpui::AnyElement>,
    input: Option<Entity<ComposerInput>>,
}

impl ChatComposer {
    pub fn new(
        view: &ComposerView,
        editor: Entity<TextareaState>,
        client: Entity<CoreClient>,
        menus: Entity<ComposerMenuState>,
        stage: Option<StageBackdrop>,
    ) -> Self {
        Self {
            view: view.clone(),
            editor,
            client,
            menus,
            stage,
            model_picker: None,
            hero: None,
            input: None,
        }
    }

    pub fn model_picker(
        mut self,
        view: Option<&ModelPickerView>,
        search: Entity<InputState>,
    ) -> Self {
        self.model_picker = view.map(|view| (view.clone(), search));
        self
    }

    pub fn hero(mut self, headline: Option<gpui::AnyElement>) -> Self {
        self.hero = headline;
        self
    }

    pub fn input(mut self, input: Option<Entity<ComposerInput>>) -> Self {
        self.input = input;
        self
    }

    pub fn timeline_inset(&self, cx: &App) -> f32 {
        let measured = self.menus.read(cx).overlay_height;
        if measured > 0. {
            measured
        } else {
            RESTING_HEIGHT
        }
    }

    pub fn stack_obstacle(&self, cx: &App) -> Option<(Bounds<Pixels>, f32)> {
        let state = self.menus.read(cx);
        state
            .stack_bounds
            .map(|bounds| (bounds, state.overlay_height))
    }

    fn close_menus(&self) -> impl Fn(&mut App) + 'static {
        let menus = self.menus.clone();
        move |cx: &mut App| {
            menus.update(cx, |state, cx| {
                state.open = None;
                cx.notify();
            });
        }
    }

    fn group_label(label: &str, t: &Tokens) -> gpui::Div {
        div()
            .px(px(OPTION_PADDING_X))
            .pt(px(GROUP_LABEL_PADDING_TOP))
            .pb(px(GROUP_LABEL_PADDING_BOTTOM))
            .text_size(px(OPTION_DESCRIPTION_TEXT))
            .line_height(px(OPTION_DESCRIPTION_LINE))
            .font_weight(FontWeight::MEDIUM)
            .text_color(t.muted_foreground)
            .child(SharedString::from(label.to_string()))
    }

    fn group_note(text: &str, t: &Tokens) -> gpui::Div {
        div()
            .px(px(OPTION_PADDING_X))
            .pb(px(GROUP_NOTE_PADDING_BOTTOM))
            .text_size(px(OPTION_DESCRIPTION_TEXT))
            .line_height(px(OPTION_DESCRIPTION_LINE))
            .text_color(fade(t.muted_foreground, GROUP_NOTE_OPACITY))
            .child(SharedString::from(text.to_string()))
    }

    fn trait_option(
        &self,
        t: &Tokens,
        section_id: &str,
        option: &TraitsOption,
        selected: bool,
        disabled: bool,
    ) -> AnyElement {
        let selected_bg = fade(t.foreground, OPTION_SELECTED);
        let hover_bg = t.accent;
        let client = self.client.clone();
        let close = self.close_menus();
        let descriptor_id = section_id.to_string();
        let value = option.id.clone();
        div()
            .id(SharedString::from(format!(
                "composer-trait-{section_id}-{}",
                option.id
            )))
            .flex()
            .flex_col()
            .px(px(OPTION_PADDING_X))
            .py(px(OPTION_PADDING_Y))
            .rounded(px(OPTION_RADIUS))
            .text_size(px(OPTION_TITLE_TEXT))
            .line_height(px(OPTION_TITLE_LINE))
            .text_color(t.foreground)
            .when(disabled, |this| this.opacity(DISABLED_OPACITY))
            .when(selected, |this| this.bg(selected_bg))
            .when(!selected && !disabled, |this| {
                this.cursor_pointer()
                    .hover(move |s| s.bg(hover_bg))
                    .on_click(move |_: &ClickEvent, _, cx| {
                        let params = json!({ "descriptorId": descriptor_id, "value": value });
                        client.update(cx, |client, _| client.act("selectTrait", params));
                        close(cx);
                    })
            })
            .child(
                div()
                    .flex()
                    .items_center()
                    .child(label(option.label.clone(), false))
                    .when(option.is_default, |this| {
                        this.child(
                            div()
                                .flex()
                                .flex_none()
                                .items_center()
                                .ml(px(BADGE_GAP))
                                .h(px(BADGE_HEIGHT))
                                .px(px(BADGE_PADDING_X))
                                .rounded(px(BADGE_RADIUS))
                                .bg(fade(gpui::white().into(), BADGE_FILL))
                                .text_size(px(BADGE_TEXT))
                                .line_height(px(BADGE_TEXT))
                                .font_weight(FontWeight::MEDIUM)
                                .child("Default"),
                        )
                    }),
            )
            .when_some(option.description.clone(), |this, description| {
                this.child(
                    div()
                        .max_w(px(DESCRIPTION_MAX_WIDTH))
                        .text_size(px(OPTION_DESCRIPTION_TEXT))
                        .line_height(px(OPTION_DESCRIPTION_LINE))
                        .text_color(fade(t.muted_foreground, GROUP_NOTE_OPACITY))
                        .child(SharedString::from(description)),
                )
            })
            .into_any_element()
    }

    fn traits_menu(&self, t: &Tokens, trigger: Bounds<Pixels>) -> Option<MenuPopup> {
        let children = self.traits_menu_children(t)?;
        let close = self.close_menus();
        Some(
            MenuPopup::new("composer-traits-menu", trigger)
                .side(Side::Top)
                .align(Align::Start)
                .side_offset(MENU_SIDE_OFFSET)
                .on_dismiss(move |_, cx| close(cx))
                .children(children),
        )
    }

    fn traits_menu_children(&self, t: &Tokens) -> Option<Vec<AnyElement>> {
        let menu = self.view.traits_menu.as_ref()?;
        let mut children: Vec<AnyElement> = Vec::new();
        match menu {
            TraitsMenuView::Unavailable { items } => {
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        children.push(MenuSeparator::new().into_any_element());
                    }
                    children.push(Self::group_label(&item.label, t).into_any_element());
                    children.push(Self::group_note(&item.value, t).into_any_element());
                }
            }
            TraitsMenuView::Controls { selects, booleans } => {
                for (index, section) in selects.iter().enumerate() {
                    if index > 0 {
                        children.push(MenuSeparator::new().into_any_element());
                    }
                    children.push(Self::group_label(&section.label, t).into_any_element());
                    if let Some(notice) = section.notice.as_deref() {
                        children.push(Self::group_note(notice, t).into_any_element());
                    }
                    for option in &section.options {
                        children.push(self.trait_option(
                            t,
                            &section.id,
                            option,
                            option.id == section.selected_value,
                            section.disabled,
                        ));
                    }
                }
                for (index, section) in booleans.iter().enumerate() {
                    if index > 0 || !selects.is_empty() {
                        children.push(MenuSeparator::new().into_any_element());
                    }
                    children.push(Self::group_label(&section.label, t).into_any_element());
                    for option in &section.options {
                        children.push(self.trait_option(
                            t,
                            &section.id,
                            option,
                            option.id == section.selected_value,
                            false,
                        ));
                    }
                }
            }
        }
        Some(children)
    }

    fn access_menu(&self, t: &Tokens, trigger: Bounds<Pixels>) -> MenuPopup {
        let selected_bg = fade(t.foreground, OPTION_SELECTED);
        let hover_bg = t.accent;
        let rows = self.view.access_options.iter().map(|option| {
            let selected = option.mode == self.view.access.mode;
            let client = self.client.clone();
            let menus = self.menus.clone();
            let mode = option.mode.clone();
            div()
                .id(SharedString::from(format!(
                    "composer-access-{}",
                    option.mode
                )))
                .flex()
                .flex_col()
                .px(px(OPTION_PADDING_X))
                .py(px(OPTION_PADDING_Y))
                .rounded(px(OPTION_RADIUS))
                .cursor_pointer()
                .when(selected, |this| this.bg(selected_bg))
                .when(!selected, |this| this.hover(move |s| s.bg(hover_bg)))
                .on_click(move |_: &ClickEvent, _, cx| {
                    let mode = mode.clone();
                    client.update(cx, |client, _| {
                        client.act("setRuntimeMode", json!({ "mode": mode }))
                    });
                    menus.update(cx, |state, cx| {
                        state.open = None;
                        cx.notify();
                    });
                })
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(OPTION_GAP))
                        .text_size(px(OPTION_TITLE_TEXT))
                        .line_height(px(OPTION_TITLE_LINE))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.foreground)
                        .child(glyph(
                            access_icon(&option.mode),
                            OPTION_ICON,
                            t.muted_foreground,
                        ))
                        .child(label(option.label.clone(), false)),
                )
                .child(
                    div()
                        .whitespace_nowrap()
                        .text_size(px(OPTION_DESCRIPTION_TEXT))
                        .line_height(px(OPTION_DESCRIPTION_LINE))
                        .text_color(t.muted_foreground)
                        .child(SharedString::from(option.description.clone())),
                )
        });
        let menus = self.menus.clone();
        MenuPopup::new("composer-access-menu", trigger)
            .side(Side::Top)
            .align(Align::Start)
            .side_offset(MENU_SIDE_OFFSET)
            .on_dismiss(move |_, cx| {
                menus.update(cx, |state, cx| {
                    state.open = None;
                    cx.notify();
                });
            })
            .children(rows)
    }

    fn controls(&self, t: &Tokens, window: &Window, cx: &App) -> gpui::Div {
        let input_view = self
            .input
            .as_ref()
            .and_then(|input| input.read(cx).view(cx));
        let footer = input_view.map(|view| view.footer);
        let interaction = input_view.and_then(|view| view.interaction_mode.clone());
        let mut items: Vec<AnyElement> = Vec::new();
        let mut fixed_width = 0.;
        if let Some(model) = self.view.model.as_ref() {
            fixed_width = control_width(
                model.driver_kind.is_some(),
                Some(text_width(window, &model.label)),
                true,
            );
            let accent = model.accent_color.as_deref().and_then(parse_accent);
            let picker_open = self.model_picker.is_some();
            let client = self.client.clone();
            let menus = self.menus.clone();
            let measure = self.menus.clone();
            items.push(
                control("composer-model", t)
                    .relative()
                    .flex_shrink(1.)
                    .min_w(px(MODEL_MIN_WIDTH))
                    .on_click(move |_: &ClickEvent, _, cx| {
                        if picker_open {
                            return;
                        }
                        menus.update(cx, |state, cx| {
                            state.open = None;
                            cx.notify();
                        });
                        client.update(cx, |client, _| {
                            client.act("openModelPicker", serde_json::json!({}))
                        });
                    })
                    .child(
                        canvas(
                            move |bounds, _, cx| {
                                measure.update(cx, |state, _| state.model_bounds = bounds);
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full(),
                    )
                    .when_some(model.driver_kind.clone(), |this, driver| {
                        let icon = ProviderInstanceIcon::new(
                            driver,
                            model.initials.clone(),
                            t.muted_foreground,
                        )
                        .icon_size(CONTROL_ICON);
                        this.child(if model.show_instance_badge {
                            icon.badge(accent, t.background)
                        } else {
                            icon
                        })
                    })
                    .child(
                        div()
                            .min_w_0()
                            .truncate()
                            .when(model.driver_kind.is_some(), |this| this.ml(px(CONTROL_GAP)))
                            .child(SharedString::from(model.label.clone())),
                    )
                    .child(chevron(t).flex_none())
                    .into_any_element(),
            );
        }
        let mut blocks: Vec<(FooterBlock, f32, f32)> = Vec::new();
        if let Some(traits) = self.view.traits.as_ref() {
            blocks.push((
                FooterBlock::Traits,
                BLOCK_LEAD + control_width(false, Some(text_width(window, traits)), true),
                BLOCK_LEAD + control_width(true, None, true),
            ));
        }
        let plan_widths = interaction.as_ref().map(|mode| {
            (
                BLOCK_LEAD
                    + CONTROL_GAP
                    + control_width(true, Some(text_width(window, &mode.label)), false),
                BLOCK_LEAD + CONTROL_GAP + control_width(true, None, false),
            )
        });
        blocks.push((
            FooterBlock::Mode,
            BLOCK_LEAD
                + control_width(
                    true,
                    Some(text_width(window, &self.view.access.label)),
                    true,
                )
                + plan_widths.map_or(0., |(natural, _)| natural),
            BLOCK_LEAD
                + control_width(true, None, true)
                + plan_widths.map_or(0., |(_, icon_only)| icon_only),
        ));
        let hidden = footer.map_or(0, |footer| footer.hidden_count.min(blocks.len()));
        let icon_only = footer.map_or(0, |footer| footer.icon_only_count.min(blocks.len()));
        let count = blocks.len();
        for (index, (block, _, _)) in blocks.iter().enumerate() {
            if index >= count - hidden {
                continue;
            }
            items.push(
                self.footer_block(*block, index >= count - icon_only, interaction.as_ref(), t)
                    .into_any_element(),
            );
        }
        if hidden > 0 {
            items.push(
                menu_trigger(
                    control("composer-overflow", t),
                    ComposerMenu::Overflow,
                    &self.menus,
                )
                .child(glyph(
                    "icons/ellipsis.svg",
                    CONTROL_ICON,
                    t.muted_foreground,
                ))
                .into_any_element(),
            );
        }
        let measurement = json!({
            "gap": CONTROL_GAP,
            "naturalFixedWidth": fixed_width,
            "minimumFixedWidth": MODEL_MIN_WIDTH,
            "blockWidths": blocks.iter().map(|(_, natural, _)| *natural).collect::<Vec<_>>(),
            "iconOnlyBlockWidths": blocks.iter().map(|(_, _, icon_only)| *icon_only).collect::<Vec<_>>(),
            "overflowWidth": control_width(true, None, false),
        });
        let input = self.input.clone();
        let menus = self.menus.clone();
        div()
            .relative()
            .flex()
            .flex_1()
            .min_w_0()
            .items_center()
            .gap(px(CONTROL_GAP))
            .children(items)
            .when_some(input, |this, input| {
                this.child(
                    canvas(
                        move |bounds, _, cx| {
                            let mut measurement = measurement.clone();
                            measurement["hostWidth"] = json!(f32::from(bounds.size.width));
                            measurement["formWidth"] = json!(menus.read(cx).form_width);
                            input.update(cx, |input, cx| input.report_footer(measurement, cx));
                        },
                        |_, _, _, _| {},
                    )
                    .absolute()
                    .size_full(),
                )
            })
    }

    fn footer_block(
        &self,
        block: FooterBlock,
        icon_only: bool,
        interaction: Option<&ComposerInteractionModeView>,
        t: &Tokens,
    ) -> gpui::Div {
        let container = div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(CONTROL_GAP))
            .child(separator(t));
        match block {
            FooterBlock::Traits => container.child(
                menu_trigger(
                    control("composer-traits", t),
                    ComposerMenu::Traits,
                    &self.menus,
                )
                .when(icon_only, |this| {
                    this.child(glyph("icons/brain.svg", CONTROL_ICON, t.muted_foreground))
                })
                .when(!icon_only, |this| {
                    this.children(self.view.traits.clone().map(|traits| label(traits, false)))
                })
                .child(chevron(t)),
            ),
            FooterBlock::Mode => container
                .child(
                    menu_trigger(
                        control("composer-access", t),
                        ComposerMenu::Access,
                        &self.menus,
                    )
                    .child(glyph(
                        access_icon(&self.view.access.mode),
                        CONTROL_ICON,
                        t.muted_foreground,
                    ))
                    .when(!icon_only, |this| {
                        this.child(label(self.view.access.label.clone(), true))
                    })
                    .child(chevron(t)),
                )
                .when_some(interaction.cloned(), |this, mode| {
                    let plan = mode.mode == "plan";
                    let client = self.client.clone();
                    this.child(separator(t)).child(
                        control("composer-interaction-mode", t)
                            .on_click(move |_: &ClickEvent, _, cx| {
                                client.update(cx, |client, _| {
                                    client.act("toggleInteractionMode", json!({}))
                                });
                            })
                            .when(plan, |this| {
                                this.bg(t.accent).text_color(t.accent_foreground)
                            })
                            .child(glyph(
                                if plan {
                                    "icons/pencil-ruler.svg"
                                } else {
                                    "icons/bot.svg"
                                },
                                CONTROL_ICON,
                                if plan {
                                    t.accent_foreground
                                } else {
                                    t.muted_foreground
                                },
                            ))
                            .when(!icon_only, |this| this.child(label(mode.label, true))),
                    )
                }),
        }
    }

    fn overflow_menu(&self, t: &Tokens, trigger: Bounds<Pixels>, cx: &App) -> Option<MenuPopup> {
        let input_view = self
            .input
            .as_ref()
            .and_then(|input| input.read(cx).view(cx))?;
        let hidden = input_view.footer.hidden_count;
        if hidden == 0 {
            return None;
        }
        let traits_hidden = self.view.traits.is_some() && hidden >= 2;
        let mut children: Vec<AnyElement> = Vec::new();
        if traits_hidden && let Some(traits) = self.traits_menu_children(t) {
            children.extend(traits);
            children.push(MenuSeparator::new().into_any_element());
        }
        if let Some(mode) = input_view.interaction_mode.as_ref() {
            children.push(MenuGroupLabel::new("Mode").into_any_element());
            for (value, text) in [("default", "Chat"), ("plan", "Plan")] {
                let client = self.client.clone();
                let close = self.close_menus();
                let selected = mode.mode == value;
                children.push(
                    MenuRadioItem::new(SharedString::from(format!(
                        "composer-overflow-mode-{value}"
                    )))
                    .checked(selected)
                    .on_click(move |_, _, cx| {
                        if !selected {
                            client.update(cx, |client, _| {
                                client.act("toggleInteractionMode", json!({}))
                            });
                        }
                        close(cx);
                    })
                    .child(text)
                    .into_any_element(),
                );
            }
            children.push(MenuSeparator::new().into_any_element());
        }
        children.push(MenuGroupLabel::new("Access").into_any_element());
        for option in &self.view.access_options {
            let client = self.client.clone();
            let close = self.close_menus();
            let selected = option.mode == self.view.access.mode;
            let mode = option.mode.clone();
            children.push(
                MenuRadioItem::new(SharedString::from(format!(
                    "composer-overflow-access-{}",
                    option.mode
                )))
                .checked(selected)
                .on_click(move |_, _, cx| {
                    if !selected {
                        let mode = mode.clone();
                        client.update(cx, |client, _| {
                            client.act("setRuntimeMode", json!({ "mode": mode }))
                        });
                    }
                    close(cx);
                })
                .child(SharedString::from(option.label.clone()))
                .into_any_element(),
            );
        }
        let close = self.close_menus();
        Some(
            MenuPopup::new("composer-overflow-menu", trigger)
                .side(Side::Top)
                .align(Align::Start)
                .side_offset(MENU_SIDE_OFFSET)
                .on_dismiss(move |_, cx| close(cx))
                .children(children),
        )
    }

    fn send_button(&self, t: &Tokens) -> gpui::Stateful<gpui::Div> {
        let enabled = self.view.has_sendable_content;
        let art = self.stage.map(|stage| stage_art(stage, t.appearance));
        div()
            .id("composer-send")
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .size(px(SEND_SIZE))
            .rounded_full()
            .overflow_hidden()
            .when(art.is_none(), |this| this.bg(t.message_action))
            .when(!enabled, |this| this.opacity(DISABLED_OPACITY))
            .when(enabled, |this| {
                let client = self.client.clone();
                this.cursor_pointer()
                    .on_click(move |_: &ClickEvent, _, cx| {
                        client.update(cx, |client, _| client.act("send", json!({})));
                    })
            })
            .when_some(art, |this, path| {
                this.child(img(path).absolute().inset_0().size(px(SEND_SIZE)))
            })
            .child(glyph(
                "icons/composer-send.svg",
                SEND_GLYPH,
                if art.is_some() {
                    gpui::white().into()
                } else {
                    t.message_action_foreground
                },
            ))
    }

    fn stop_button(&self, t: &Tokens) -> gpui::Stateful<gpui::Div> {
        let client = self.client.clone();
        let hover = t.destructive;
        div()
            .id("composer-stop")
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .size(px(SEND_SIZE))
            .rounded_full()
            .bg(fade(t.destructive, 0.9))
            .hover(move |s| s.bg(hover))
            .cursor_pointer()
            .on_click(move |_: &ClickEvent, _, cx| {
                client.update(cx, |client, _| client.act("interrupt", json!({})));
            })
            .child(glyph(
                "icons/composer-stop.svg",
                STOP_GLYPH,
                gpui::white().into(),
            ))
    }

    fn actions(&self, t: &Tokens, cx: &App) -> gpui::Div {
        let attach_hover = t.accent;
        let can_attach = self
            .input
            .as_ref()
            .and_then(|input| input.read(cx).view(cx))
            .is_some_and(|view| view.can_attach);
        let interaction = if self.view.pending_action.is_some() || self.view.plan_action.is_some() {
            let stop = self
                .view
                .running
                .then(|| self.stop_button(t).into_any_element());
            composer_interactions::primary_actions(&self.view, stop, &self.client, t, cx)
        } else {
            None
        };
        div()
            .flex()
            .flex_none()
            .items_center()
            .gap(px(ACTIONS_GAP))
            .when(can_attach, |this| {
                let client = self.client.clone();
                this.child(
                    div()
                        .id("composer-attach")
                        .flex()
                        .items_center()
                        .justify_center()
                        .size(px(ATTACH_SIZE))
                        .rounded(px(CONTROL_RADIUS))
                        .cursor_pointer()
                        .hover(move |s| s.bg(attach_hover))
                        .on_click(move |_: &ClickEvent, _, cx| {
                            composer_input::pick_files(&client, cx)
                        })
                        .child(glyph(
                            "icons/paperclip.svg",
                            CONTROL_ICON,
                            t.muted_foreground,
                        )),
                )
            })
            .map(|this| match interaction {
                Some(interaction) => this.child(interaction),
                None => this
                    .when(self.view.running, |this| this.child(self.stop_button(t)))
                    .when(
                        !self.view.running || self.view.has_sendable_content,
                        |this| this.child(self.send_button(t)),
                    ),
            })
    }

    fn context_strip(&self, fill: Rgba, cx: &App) -> Option<gpui::Div> {
        let toolbar = BranchToolbarHost::strip(cx)?;
        let outline = fade(gpui::white().into(), OUTLINE);
        Some(
            div()
                .relative()
                .mx(px(DRAWER_INSET))
                .h(px(DRAWER_HEIGHT))
                .child(
                    div()
                        .absolute()
                        .top(px(-DRAWER_OVERLAP))
                        .left_0()
                        .right_0()
                        .bottom_0()
                        .rounded_b(px(DRAWER_FILL_RADIUS))
                        .backdrop_blur(px(glass_blur(&theme::active(cx))))
                        .backdrop_saturate(glass_saturation(&theme::active(cx)))
                        .bg(fill),
                )
                .child(
                    div()
                        .absolute()
                        .top_0()
                        .left_0()
                        .right_0()
                        .bottom_0()
                        .border_l_1()
                        .border_r_1()
                        .border_b_1()
                        .border_color(outline)
                        .rounded_b(px(DRAWER_OUTLINE_RADIUS)),
                )
                .child(
                    div()
                        .absolute()
                        .inset_0()
                        .flex()
                        .items_center()
                        .pt(px(DRAWER_PADDING_TOP))
                        .pb(px(DRAWER_PADDING_BOTTOM))
                        .pl(px(DRAWER_PADDING_LEFT))
                        .pr(px(DRAWER_PADDING_RIGHT))
                        .child(toolbar),
                ),
        )
    }
}

impl RenderOnce for ChatComposer {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let open_menu = self.menus.read(cx).open.and_then(|menu| {
            let trigger = self.menus.read(cx).bounds(menu);
            match menu {
                ComposerMenu::Traits => self.traits_menu(&t, trigger),
                ComposerMenu::Access => Some(self.access_menu(&t, trigger)),
                ComposerMenu::Overflow => self.overflow_menu(&t, trigger, cx),
            }
        });
        let model_picker = self.model_picker.as_ref().map(|(view, search)| {
            ModelPicker::new(
                view,
                self.menus.read(cx).model_bounds,
                search.clone(),
                self.client.clone(),
            )
        });
        let fill = fade(t.surface_raised, t.glass_opacity);
        let outline = fade(gpui::white().into(), OUTLINE);
        let highlight = fade(gpui::white().into(), HIGHLIGHT);
        let dark = t.appearance == Appearance::Dark;
        let approval_pending = self.view.approval_pending;
        let input = self.input.clone();
        let shelf = input
            .as_ref()
            .and_then(|input| input.read(cx).attachment_shelf(cx));
        let menu_drawer = input
            .as_ref()
            .and_then(|input| input.read(cx).menu_drawer(cx));
        let menu_open = menu_drawer.is_some();
        let menu_has_items = input
            .as_ref()
            .is_some_and(|input| input.read(cx).menu_has_items(cx));
        let toggles_mode = input.as_ref().is_some_and(|input| {
            input
                .read(cx)
                .view(cx)
                .is_some_and(|view| view.interaction_mode.is_some())
        });
        let mut textarea = bare_textarea(
            &self.editor,
            EDITOR_MIN_HEIGHT,
            EDITOR_MAX_HEIGHT,
            EDITOR_PADDING_X,
            0.,
            self.view.editor_disabled,
        )
        .items_start()
        .font_family(COMPOSER_FONT)
        .text_size(px(t.prompt_font_size))
        .line_height(px(t.prompt_font_size * PROMPT_LINE_RATIO));
        if let Some(input) = input.as_ref() {
            let client = self.client.clone();
            textarea = textarea
                .token(input.read(cx).token_renderer())
                .on_paste(move |item, _, cx| composer_input::paste(&client, item, cx));
        }
        let key_client = self.client.clone();
        let drop_client = self.client.clone();
        let drop_ring = t.ring;
        let footer_compact = input
            .as_ref()
            .and_then(|input| input.read(cx).view(cx))
            .is_some_and(|view| view.footer.compact);
        let card = div()
            .relative()
            .flex()
            .flex_col()
            .rounded(px(CARD_RADIUS))
            .backdrop_blur(px(glass_blur(&t)))
            .backdrop_saturate(glass_saturation(&t))
            .bg(fill)
            .child({
                let measure = self.menus.clone();
                canvas(
                    move |bounds, _, cx| {
                        let width = f32::from(bounds.size.width);
                        measure.update(cx, |state, _| state.form_width = width);
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full()
            })
            .when(menu_open, |card| {
                let client = key_client.clone();
                card.capture_action(move |_: &Escape, _, cx| {
                    client.update(cx, |client, _| client.act("composerMenuDismiss", json!({})));
                    cx.stop_propagation();
                })
            })
            .when(menu_has_items, |card| {
                let (up, down, enter, tab) = (
                    key_client.clone(),
                    key_client.clone(),
                    key_client.clone(),
                    key_client.clone(),
                );
                card.capture_action(move |_: &MoveUp, _, cx| {
                    up.update(cx, |client, _| {
                        client.act("composerMenuMove", json!({ "key": "ArrowUp" }))
                    });
                    cx.stop_propagation();
                })
                .capture_action(move |_: &MoveDown, _, cx| {
                    down.update(cx, |client, _| {
                        client.act("composerMenuMove", json!({ "key": "ArrowDown" }))
                    });
                    cx.stop_propagation();
                })
                .capture_action(move |_: &Enter, _, cx| {
                    enter.update(cx, |client, _| {
                        client.act("composerMenuSelect", json!({ "itemId": null }))
                    });
                    cx.stop_propagation();
                })
                .capture_action(move |_: &IndentInline, _, cx| {
                    tab.update(cx, |client, _| {
                        client.act("composerMenuSelect", json!({ "itemId": null }))
                    });
                    cx.stop_propagation();
                })
            })
            .when(toggles_mode, |card| {
                let client = key_client.clone();
                card.capture_action(move |_: &OutdentInline, _, cx| {
                    client.update(cx, |client, _| {
                        client.act("toggleInteractionMode", json!({}))
                    });
                    cx.stop_propagation();
                })
            })
            .drag_over::<ExternalPaths>(move |style, _, _, _| {
                style.border_1().border_color(drop_ring)
            })
            .on_drop(move |paths: &ExternalPaths, _, cx| {
                composer_input::add_paths(&drop_client, paths.paths(), cx)
            })
            .child(
                div()
                    .pt(px(EDITOR_PADDING_TOP))
                    .pb(px(if approval_pending {
                        APPROVAL_EDITOR_PADDING_BOTTOM
                    } else {
                        EDITOR_PADDING_BOTTOM
                    }))
                    .text_size(px(t.prompt_font_size))
                    .line_height(px(t.prompt_font_size * PROMPT_LINE_RATIO))
                    .children(shelf)
                    .child(textarea),
            )
            .when(!approval_pending, |card| {
                card.child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .when(footer_compact, |this| this.gap(px(FOOTER_COMPACT_GAP)))
                        .h(px(FOOTER_HEIGHT))
                        .mb(px(FOOTER_PADDING_BOTTOM))
                        .pl(px(FOOTER_PADDING_LEFT))
                        .pr(px(FOOTER_PADDING_X))
                        .child(self.controls(&t, window, cx))
                        .child(self.actions(&t, cx)),
                )
            });
        let drawer = composer_interactions::top_drawer(&self.client, fill, &t, cx);
        let strip = self.context_strip(fill, cx);
        let outline_bottom = if strip.is_some() { DRAWER_HEIGHT } else { 0. };
        let hero = self.hero;
        let centered = hero.is_some();
        div()
            .absolute()
            .left_0()
            .right_0()
            .bottom_0()
            .when(centered, |this| this.top_0().flex().items_center())
            .when(!centered, |this| this.pt(px(OVERLAY_TOP_PADDING)))
            .children(open_menu)
            .children(model_picker)
            .px(px(GUTTER_X))
            .child(
                div()
                    .relative()
                    .mx_auto()
                    .w_full()
                    .when_some(t.chat_max_width, |this, width| this.max_w(px(width)))
                    .when(!centered, |this| this.pb(px(SURFACE_BOTTOM_PADDING)))
                    .child({
                        let measure = self.menus.clone();
                        canvas(
                            move |bounds, _, cx| {
                                let height = f32::from(bounds.size.height) + OVERLAY_TOP_PADDING;
                                let stack = (!centered).then_some(bounds);
                                measure.update(cx, |state, cx| {
                                    if (state.overlay_height - height).abs() > HEIGHT_EPSILON
                                        || state.stack_bounds != stack
                                    {
                                        state.overlay_height = height;
                                        state.stack_bounds = stack;
                                        cx.notify();
                                    }
                                });
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .size_full()
                    })
                    .when_some(hero, |this, headline| {
                        this.child(
                            div()
                                .absolute()
                                .left_0()
                                .right_0()
                                .bottom(gpui::relative(1.))
                                .child(headline),
                        )
                    })
                    .child(
                        div().flex().flex_col().children(drawer).child(
                            div()
                                .relative()
                                .flex()
                                .flex_col()
                                .when_some(menu_drawer, |this, menu| {
                                    this.child(div().relative().h_0().child(menu))
                                })
                                .child(card)
                                .children(strip)
                                .child(
                                    div()
                                        .absolute()
                                        .top_0()
                                        .left_0()
                                        .right_0()
                                        .bottom(px(outline_bottom))
                                        .rounded(px(CARD_RADIUS))
                                        .border_1()
                                        .border_color(outline)
                                        .when(dark, |this| {
                                            this.child(
                                                div()
                                                    .absolute()
                                                    .inset_0()
                                                    .rounded(px(CARD_RADIUS - 1.))
                                                    .border_t_1()
                                                    .border_color(highlight),
                                            )
                                        }),
                                ),
                        ),
                    ),
            )
    }
}
