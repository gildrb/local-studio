use std::collections::HashMap;

use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, Bounds, Entity, FocusHandle, InteractiveElement, IntoElement, ParentElement,
    Pixels, Point, StatefulInteractiveElement, Styled, Window, canvas, div,
};

use crate::ui::menu::{MenuDensity, MenuPopup, MenuSubTrigger};

pub struct OverflowMenuState {
    pub open: bool,
    pub bounds: Bounds<Pixels>,
    pub focus: FocusHandle,
    pub sub: Option<&'static str>,
    sub_bounds: HashMap<&'static str, Bounds<Pixels>>,
    sub_popup_bounds: Option<Bounds<Pixels>>,
}

pub type OverflowMenu = Entity<OverflowMenuState>;

pub fn overflow_menu(window: &mut Window, cx: &mut App) -> OverflowMenu {
    window.use_keyed_state("header-actions-overflow", cx, |_, cx| OverflowMenuState {
        open: false,
        bounds: Bounds::default(),
        focus: cx.focus_handle(),
        sub: None,
        sub_bounds: HashMap::new(),
        sub_popup_bounds: None,
    })
}

pub fn set_overflow_open(menu: &OverflowMenu, open: bool, cx: &mut App) {
    menu.update(cx, |state, cx| {
        state.open = open;
        if !open {
            state.sub = None;
            state.sub_popup_bounds = None;
        }
        cx.notify();
    });
}

/// Whether a pointer-down at `point` belongs to the menu (its trigger or the open submenu).
pub fn owns_pointer(menu: &OverflowMenu, point: Point<Pixels>, cx: &App) -> bool {
    let state = menu.read(cx);
    state.bounds.contains(&point)
        || (state.sub.is_some()
            && state
                .sub_popup_bounds
                .is_some_and(|bounds| bounds.contains(&point)))
}

pub fn measured_trigger(menu: &OverflowMenu, element: impl IntoElement) -> gpui::Div {
    let measure = menu.clone();
    div().relative().flex_none().child(element).child(
        canvas(
            move |bounds, _, cx| measure.update(cx, |state, _| state.bounds = bounds),
            |_, _, _, _| {},
        )
        .absolute()
        .size_full(),
    )
}

/// A touch-density submenu row inside the header overflow menu; hovering opens its popup.
pub fn sub_trigger(
    menu: &OverflowMenu,
    key: &'static str,
    trigger: MenuSubTrigger,
    on_open: impl Fn(&mut App) + 'static,
    cx: &App,
) -> AnyElement {
    let open = menu.read(cx).sub == Some(key);
    let hover = menu.clone();
    let measure = menu.clone();
    div()
        .relative()
        .child(
            trigger
                .density(MenuDensity::Touch)
                .open(open)
                .on_hover(move |hovered, _, cx| {
                    if !*hovered {
                        return;
                    }
                    let opened = hover.update(cx, |state, cx| {
                        let opened = state.sub != Some(key);
                        if opened {
                            state.sub = Some(key);
                            state.sub_popup_bounds = None;
                            cx.notify();
                        }
                        opened
                    });
                    if opened {
                        on_open(cx);
                    }
                }),
        )
        .child(
            canvas(
                move |bounds, _, cx| {
                    measure.update(cx, |state, _| {
                        state.sub_bounds.insert(key, bounds);
                    })
                },
                |_, _, _, _| {},
            )
            .absolute()
            .size_full(),
        )
        .into_any_element()
}

/// The submenu popup for `key`, shown while its trigger row is the hovered submenu.
pub fn sub_popup(
    menu: &OverflowMenu,
    key: &'static str,
    children: Vec<AnyElement>,
    cx: &App,
) -> Option<AnyElement> {
    let state = menu.read(cx);
    if !state.open || state.sub != Some(key) {
        return None;
    }
    let bounds = state.sub_bounds.get(key).copied().unwrap_or_default();
    let measure = menu.clone();
    Some(
        MenuPopup::sub(
            gpui::SharedString::from(format!("header-overflow-sub-popup-{key}")),
            bounds,
        )
        .children(children)
        .child(
            canvas(
                move |bounds, _, cx| {
                    measure.update(cx, |state, _| state.sub_popup_bounds = Some(bounds))
                },
                |_, _, _, _| {},
            )
            .absolute()
            .size_full(),
        )
        .into_any_element(),
    )
}

/// Keeps a submenu's rows and its popup together so the popup layers above the parent menu.
pub fn with_sub_popup(row: AnyElement, popup: Option<AnyElement>) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .child(row)
        .when_some(popup, |this, popup| this.child(popup))
        .into_any_element()
}

/// A top-level overflow row that is not a submenu; hovering it closes any open submenu.
pub fn plain_row(
    menu: &OverflowMenu,
    id: impl Into<gpui::ElementId>,
    row: AnyElement,
) -> AnyElement {
    let hover = menu.clone();
    div()
        .id(id)
        .on_hover(move |hovered, _, cx| {
            if *hovered {
                hover.update(cx, |state, cx| {
                    if state.sub.take().is_some() {
                        cx.notify();
                    }
                });
            }
        })
        .child(row)
        .into_any_element()
}
