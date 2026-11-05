use std::cell::Cell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use gpui::Focusable;
use gpui::component::input::{InputEvent, InputState};
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, AppContext, Bounds, Context, CursorStyle, DispatchPhase, Entity, Global, Hsla,
    InteractiveElement, IntoElement, KeyDownEvent, MouseButton, MouseDownEvent, MouseMoveEvent,
    MouseUpEvent, ParentElement, PathBuilder, Pixels, Point, RecordedPaint, Render, ScrollHandle,
    ScrollWheelEvent, SharedString, StatefulInteractiveElement, Styled, Window, canvas, div, fill,
    linear_color_stop, linear_gradient, point, px, rgb, size,
};
use serde_json::{Value, json};

use crate::app_core::client::{CoreClient, ViewState};
use crate::app_core::views::theme_editor::{
    ThemeColorFieldView, ThemeEditorPickerView, ThemeEditorView,
};
use crate::ui::button::{Button, ButtonSize, ButtonVariant};
use crate::ui::dialog::dialog_glass;
use crate::ui::input::{Input, InputFont, InputSize};
use crate::ui::popover::{Align, PopoverPadding, PopoverPopup, Side, black, shadow};
use crate::ui::switch::Switch;
use crate::ui::theme;
use crate::ui::theme::color::{mix_oklab, parse_hex};
use crate::ui::theme::metrics::{radius, text};
use crate::ui::theme::roles::{role_colors, role_of};
use crate::ui::theme::tokens::{Tokens, fade};
use crate::ui::toggle::Toggle;
use crate::ui::toggle_group::ToggleGroup;
use crate::ui::tooltip::Tooltip;

const MARGIN: f32 = 8.;
const DEFAULT_INSET: f32 = 16.;
const PANEL_WIDTH: f32 = 416.;
const PANEL_MAX_HEIGHT: f32 = 672.;
const PANEL_VIEWPORT_GAP_X: f32 = 32.;
const PANEL_VIEWPORT_GAP_Y: f32 = 96.;
const MIN_WIDTH: f32 = 280.;
const MIN_HEIGHT: f32 = 220.;
const HEADER_KEEP_VISIBLE: f32 = 48.;
const FIELD_MIN_HEIGHT: f32 = 44.;
const SWATCH: f32 = 24.;
const HEX_INPUT_WIDTH: f32 = 112.;
const PICKER_WIDTH: f32 = 288.;
const PLANE_HEIGHT: f32 = 128.;
const PLANE_THUMB: f32 = 12.;
const HUE_HEIGHT: f32 = 24.;
const HUE_TRACK: f32 = 10.;
const HUE_THUMB: f32 = 16.;
const HUE_STOPS: [u32; 7] = [
    0xff0000, 0xffff00, 0x00ff00, 0x00ffff, 0x0000ff, 0xff00ff, 0xff0000,
];
const SPOTLIGHT_PADDING: f32 = 5.;
const DIMMER: u32 = 0x020308;
const DIMMER_ALPHA: f32 = 0.54;
const HOVER_LABEL_GAP: f32 = 5.6;

type PositionHandler = Rc<dyn Fn(Point<Pixels>, Bounds<Pixels>, &mut App)>;

struct ThemeEditorHandle(Entity<ThemeEditorHost>);

impl Global for ThemeEditorHandle {}

#[derive(Clone, Copy)]
struct ResizeStart {
    pointer: Point<Pixels>,
    origin: Point<Pixels>,
    width: f32,
    height: f32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PickerDrag {
    Plane,
    Hue,
}

#[derive(Clone)]
struct Hover {
    bounds: Bounds<Pixels>,
    radius: f32,
    label: SharedString,
}

#[derive(Clone)]
struct Region {
    bounds: Bounds<Pixels>,
    radius: f32,
}

pub struct ThemeEditorHost {
    client: Entity<CoreClient>,
    view: Entity<ViewState<Option<ThemeEditorView>>>,
    session: Option<u64>,
    name: Entity<InputState>,
    filter: Entity<InputState>,
    picker_hex: Entity<InputState>,
    picker_rgb: Entity<InputState>,
    hex_inputs: HashMap<String, Entity<InputState>>,
    position: Option<Point<Pixels>>,
    size: Option<(f32, f32)>,
    drag_offset: Option<Point<Pixels>>,
    resize: Option<ResizeStart>,
    panel_bounds: Rc<Cell<Option<Bounds<Pixels>>>>,
    swatch_bounds: HashMap<String, Bounds<Pixels>>,
    field_bounds: HashMap<String, Bounds<Pixels>>,
    scroll: ScrollHandle,
    pending_reveal: Option<(String, u64)>,
    handled_reveal: Option<u64>,
    hover: Option<Hover>,
    paint_mark: Rc<Cell<usize>>,
    usage_sent: Option<usize>,
    picker_drag: Option<PickerDrag>,
    consumed_press: bool,
}

fn act(client: &Entity<CoreClient>, cx: &mut App, action: &str, params: Value) {
    client.update(cx, |client, _| client.act(action, params));
}

fn color(value: &str) -> Hsla {
    parse_hex(value).unwrap_or(rgb(0x000000)).into()
}

fn transparent(hex: u32) -> Hsla {
    let mut color: Hsla = rgb(hex).into();
    color.a = 0.;
    color
}

fn region_radius(corner: Pixels) -> f32 {
    (f32::from(corner) + SPOTLIGHT_PADDING).clamp(7., 18.)
}

fn padded(bounds: Bounds<Pixels>) -> Bounds<Pixels> {
    Bounds {
        origin: point(
            bounds.origin.x - px(SPOTLIGHT_PADDING),
            bounds.origin.y - px(SPOTLIGHT_PADDING),
        ),
        size: size(
            bounds.size.width + px(SPOTLIGHT_PADDING * 2.),
            bounds.size.height + px(SPOTLIGHT_PADDING * 2.),
        ),
    }
}

fn excluded(paint: &RecordedPaint, panel: Option<Bounds<Pixels>>) -> bool {
    panel.is_some_and(|panel| {
        panel.contains(&paint.visible.origin) && panel.contains(&paint.visible.bottom_right())
    })
}

fn area(bounds: &Bounds<Pixels>) -> f32 {
    f32::from(bounds.size.width) * f32::from(bounds.size.height)
}

fn hit_test(
    paints: &[RecordedPaint],
    table: &[(&'static str, gpui::Rgba)],
    position: Point<Pixels>,
    panel: Option<Bounds<Pixels>>,
) -> Option<(&'static str, Bounds<Pixels>, Pixels)> {
    if panel.is_some_and(|panel| panel.contains(&position)) {
        return None;
    }
    let mut best: Option<(&'static str, Bounds<Pixels>, Pixels, f32)> = None;
    for paint in paints {
        if !paint.visible.contains(&position) || excluded(paint, panel) {
            continue;
        }
        let Some(role) = role_of(paint.color, table) else {
            continue;
        };
        let size = area(&paint.visible);
        if best.as_ref().is_none_or(|(_, _, _, best)| size <= *best) {
            best = Some((role, paint.bounds, paint.corner_radius, size));
        }
    }
    best.map(|(role, bounds, radius, _)| (role, bounds, radius))
}

fn usage_regions(
    paints: &[RecordedPaint],
    table: &[(&'static str, gpui::Rgba)],
    roles: &HashSet<&str>,
    panel: Option<Bounds<Pixels>>,
) -> Vec<Region> {
    let mut seen = HashSet::new();
    let mut regions = Vec::new();
    for paint in paints {
        if excluded(paint, panel) {
            continue;
        }
        let Some(role) = role_of(paint.color, table) else {
            continue;
        };
        if !roles.contains(role) {
            continue;
        }
        let key = (
            f32::from(paint.bounds.origin.x).round() as i32,
            f32::from(paint.bounds.origin.y).round() as i32,
            f32::from(paint.bounds.size.width).round() as i32,
            f32::from(paint.bounds.size.height).round() as i32,
        );
        if seen.insert(key) {
            regions.push(Region {
                bounds: paint.bounds,
                radius: region_radius(paint.corner_radius),
            });
        }
    }
    regions
}

fn paint_dimmer(holes: &[Bounds<Pixels>], viewport: Bounds<Pixels>, window: &mut Window) {
    let dim = Hsla {
        a: DIMMER_ALPHA,
        ..rgb(DIMMER).into()
    };
    let mut edges: Vec<f32> = vec![f32::from(viewport.top()), f32::from(viewport.bottom())];
    for hole in holes {
        edges.push(
            f32::from(hole.top()).clamp(f32::from(viewport.top()), f32::from(viewport.bottom())),
        );
        edges.push(
            f32::from(hole.bottom()).clamp(f32::from(viewport.top()), f32::from(viewport.bottom())),
        );
    }
    edges.sort_by(f32::total_cmp);
    edges.dedup();
    for band in edges.windows(2) {
        let (top, bottom) = (band[0], band[1]);
        if bottom - top <= 0. {
            continue;
        }
        let mut spans: Vec<(f32, f32)> = holes
            .iter()
            .filter(|hole| f32::from(hole.top()) <= top && f32::from(hole.bottom()) >= bottom)
            .map(|hole| (f32::from(hole.left()), f32::from(hole.right())))
            .collect();
        spans.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut cursor = f32::from(viewport.left());
        let right = f32::from(viewport.right());
        for (start, end) in spans.into_iter().chain([(right, right)]) {
            if start > cursor {
                window.paint_quad(fill(
                    Bounds::from_corners(
                        point(px(cursor), px(top)),
                        point(px(start.min(right)), px(bottom)),
                    ),
                    dim,
                ));
            }
            cursor = cursor.max(end);
        }
    }
}

impl ThemeEditorHost {
    pub fn install(client: &Entity<CoreClient>, window: &mut Window, cx: &mut App) {
        if cx.has_global::<ThemeEditorHandle>() {
            return;
        }
        let host = cx.new(|cx| Self::new(client.clone(), window, cx));
        cx.set_global(ThemeEditorHandle(host));
    }

    pub fn global(cx: &App) -> Option<Entity<ThemeEditorHost>> {
        cx.try_global::<ThemeEditorHandle>()
            .map(|handle| handle.0.clone())
    }

    fn new(client: Entity<CoreClient>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let view =
            CoreClient::subscribe::<Option<ThemeEditorView>>(&client, "themeEditor", json!({}), cx);
        cx.observe_in(&view, window, |host, _, window, cx| {
            host.sync(window, cx);
            cx.notify();
        })
        .detach();
        let name = Self::live_input(&client, "themeEditorName", None, window, cx);
        let filter = Self::live_input(&client, "themeEditorFilter", None, window, cx);
        let picker_hex = Self::live_input(
            &client,
            "themeEditorPickerHex",
            Some("themeEditorPickerBlur"),
            window,
            cx,
        );
        let picker_rgb = Self::live_input(
            &client,
            "themeEditorPickerRgb",
            Some("themeEditorPickerBlur"),
            window,
            cx,
        );
        Self {
            client,
            view,
            session: None,
            name,
            filter,
            picker_hex,
            picker_rgb,
            hex_inputs: HashMap::new(),
            position: None,
            size: None,
            drag_offset: None,
            resize: None,
            panel_bounds: Rc::new(Cell::new(None)),
            swatch_bounds: HashMap::new(),
            field_bounds: HashMap::new(),
            scroll: ScrollHandle::new(),
            pending_reveal: None,
            handled_reveal: None,
            hover: None,
            paint_mark: Rc::new(Cell::new(0)),
            usage_sent: None,
            picker_drag: None,
            consumed_press: false,
        }
    }

    fn live_input(
        client: &Entity<CoreClient>,
        action: &'static str,
        blur: Option<&'static str>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<InputState> {
        let state = cx.new(|cx| InputState::new(window, cx));
        let client = client.clone();
        cx.subscribe_in(
            &state,
            window,
            move |_, state, event: &InputEvent, _, cx| match event {
                InputEvent::Change => {
                    let value = state.read(cx).value().to_string();
                    act(&client, cx, action, json!({ "value": value }));
                }
                InputEvent::Blur => {
                    if let Some(blur) = blur {
                        act(&client, cx, blur, json!({}));
                    }
                }
                InputEvent::PressEnter { .. } | InputEvent::Focus => {}
            },
        )
        .detach();
        state
    }

    fn data(&self, cx: &App) -> Option<ThemeEditorView> {
        self.view.read(cx).data.clone().flatten()
    }

    fn set_input(state: &Entity<InputState>, value: &str, window: &mut Window, cx: &mut App) {
        if state.read(cx).focus_handle(cx).is_focused(window) || state.read(cx).value() == value {
            return;
        }
        let value = value.to_string();
        state.update(cx, |state, cx| state.set_value(value, window, cx));
    }

    fn sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(view) = self.data(cx) else {
            if self.session.take().is_some() {
                window.set_paint_recording(false);
                self.hex_inputs.clear();
                self.hover = None;
                self.usage_sent = None;
                self.picker_drag = None;
                self.position = None;
                self.size = None;
            }
            return;
        };
        if self.session != Some(view.session_id) {
            self.session = Some(view.session_id);
            self.hover = None;
            self.usage_sent = None;
            self.handled_reveal = None;
            self.pending_reveal = None;
            let name = view.model.name_field.value.clone();
            self.name
                .update(cx, |state, cx| state.set_value(name, window, cx));
            window.focus(&self.name.read(cx).focus_handle(cx), cx);
        }
        Self::set_input(&self.name, &view.model.name_field.value, window, cx);
        if let Some(filter) = view.model.colors.filter.as_ref() {
            Self::set_input(&self.filter, &filter.value, window, cx);
        }
        if let Some(picker) = view.picker.as_ref() {
            Self::set_input(&self.picker_hex, &picker.hex_draft, window, cx);
            Self::set_input(&self.picker_rgb, &picker.rgb_draft, window, cx);
        }
        for field in Self::fields(&view) {
            if let Some(state) = self.hex_inputs.get(&field.role) {
                Self::set_input(state, &field.editor_value, window, cx);
            }
        }
        if let Some(reveal) = view.reveal.as_ref()
            && self.handled_reveal != Some(reveal.revision)
        {
            self.handled_reveal = Some(reveal.revision);
            self.pending_reveal = Some((reveal.role.clone(), reveal.revision));
        }
        if !view.model.inspect.active {
            self.hover = None;
        }
        if view.model.highlight_roles.is_empty() {
            self.usage_sent = None;
        }
        let recording = view.model.inspect.active || !view.model.highlight_roles.is_empty();
        window.set_paint_recording(recording);
    }

    fn fields(view: &ThemeEditorView) -> Vec<&ThemeColorFieldView> {
        view.model
            .colors
            .guided_fields
            .iter()
            .chain(
                view.model
                    .colors
                    .groups
                    .iter()
                    .flat_map(|group| group.fields.iter()),
            )
            .collect()
    }

    fn hex_input(
        &mut self,
        field: &ThemeColorFieldView,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<InputState> {
        if let Some(state) = self.hex_inputs.get(&field.role) {
            return state.clone();
        }
        let state = cx.new(|cx| {
            let mut state = InputState::new(window, cx);
            state.set_value(field.editor_value.clone(), window, cx);
            state
        });
        let client = self.client.clone();
        let role = field.role.clone();
        cx.subscribe_in(
            &state,
            window,
            move |_, state, event: &InputEvent, _, cx| match event {
                InputEvent::Change => {
                    let value = state.read(cx).value().to_string();
                    act(
                        &client,
                        cx,
                        "themeEditorColor",
                        json!({ "role": role, "value": value }),
                    );
                }
                InputEvent::Focus => act(
                    &client,
                    cx,
                    "themeEditorSelectRole",
                    json!({ "role": role, "reveal": false }),
                ),
                InputEvent::Blur | InputEvent::PressEnter { .. } => {}
            },
        )
        .detach();
        self.hex_inputs.insert(field.role.clone(), state.clone());
        state
    }

    fn panel_metrics(&mut self, window: &Window, minimized: bool) -> (f32, f32, Option<f32>) {
        let viewport = window.viewport_size();
        let (vw, vh) = (f32::from(viewport.width), f32::from(viewport.height));
        if let Some((width, height)) = self.size {
            let width = width.min(vw - MARGIN * 2.).max(MIN_WIDTH);
            let height = height.min(vh - MARGIN * 2.).max(MIN_HEIGHT);
            self.size = Some((width, height));
        }
        let width = self.size.map_or(
            (vw - PANEL_VIEWPORT_GAP_X).min(PANEL_WIDTH),
            |(width, _)| width,
        );
        let max_height = if self.size.is_some() && !minimized {
            vh - MARGIN * 2.
        } else {
            (vh - PANEL_VIEWPORT_GAP_Y).min(PANEL_MAX_HEIGHT)
        };
        let height = if minimized {
            None
        } else {
            self.size.map(|(_, height)| height)
        };
        if let Some(position) = self.position {
            let rendered_height = height.unwrap_or_else(|| {
                self.panel_bounds
                    .get()
                    .map_or(0., |bounds| f32::from(bounds.size.height))
            });
            let x = f32::from(position.x)
                .min((vw - width - MARGIN).max(MARGIN))
                .max(MARGIN);
            let y = f32::from(position.y)
                .min((vh - HEADER_KEEP_VISIBLE).max(MARGIN))
                .min(
                    (vh - rendered_height - MARGIN)
                        .max(MARGIN)
                        .max(f32::from(position.y).min(vh - HEADER_KEEP_VISIBLE)),
                )
                .max(MARGIN);
            self.position = Some(point(px(x), px(y)));
        }
        (width, max_height, height)
    }

    fn clamp_drag(&self, x: f32, y: f32, window: &Window) -> Point<Pixels> {
        let viewport = window.viewport_size();
        let width = self
            .panel_bounds
            .get()
            .map_or(0., |bounds| f32::from(bounds.size.width));
        point(
            px(
                x.min((f32::from(viewport.width) - width - MARGIN).max(MARGIN))
                    .max(MARGIN),
            ),
            px(
                y.min((f32::from(viewport.height) - HEADER_KEEP_VISIBLE).max(MARGIN))
                    .max(MARGIN),
            ),
        )
    }

    fn reveal(&mut self) {
        let Some((role, _)) = self.pending_reveal.clone() else {
            return;
        };
        let (Some(field), Some(panel)) =
            (self.field_bounds.get(&role), self.scroll.bounds().into())
        else {
            return;
        };
        let viewport: Bounds<Pixels> = panel;
        let offset = self.scroll.offset();
        let top = field.top() - viewport.top();
        let bottom = field.bottom() - viewport.top();
        let height = viewport.size.height;
        let next_y = if top < px(0.) {
            offset.y - top
        } else if bottom > height {
            offset.y - (bottom - height)
        } else {
            offset.y
        };
        self.scroll.set_offset(point(offset.x, next_y));
        self.pending_reveal = None;
    }

    fn overlay(&self, view: &ThemeEditorView, t: &Tokens, cx: &mut Context<Self>) -> AnyElement {
        let entity = cx.entity().downgrade();
        let client = self.client.clone();
        let inspecting = view.model.inspect.active;
        let highlight: HashSet<String> = view.model.highlight_roles.iter().cloned().collect();
        let labels = view.role_labels.clone();
        let mark = self.paint_mark.clone();
        let panel = self.panel_bounds.clone();
        let hover = self.hover.clone();
        let usage_sent = self.usage_sent;
        let ring = t.ring;
        let table = role_colors(t);
        canvas(
            |_, _, _| (),
            move |bounds, _, window, cx| {
                mark.set(window.paint_recording_mark());
                let panel_bounds = panel.get();
                if inspecting {
                    let move_entity = entity.clone();
                    let move_table = table.clone();
                    let move_labels = labels.clone();
                    let move_mark = mark.clone();
                    let move_panel = panel.clone();
                    window.on_mouse_event(move |event: &MouseMoveEvent, phase, window, cx| {
                        if phase != DispatchPhase::Capture {
                            return;
                        }
                        let paints = window.recorded_paints();
                        let paints = &paints[..move_mark.get().min(paints.len())];
                        let next = hit_test(paints, &move_table, event.position, move_panel.get())
                            .map(|(role, bounds, corner)| Hover {
                                bounds: padded(bounds),
                                radius: region_radius(corner),
                                label: move_labels
                                    .get(role)
                                    .cloned()
                                    .unwrap_or_else(|| role.to_string())
                                    .into(),
                            });
                        if let Some(entity) = move_entity.upgrade() {
                            entity.update(cx, |host, cx| {
                                host.hover = next;
                                cx.notify();
                            });
                        }
                    });
                    let down_entity = entity.clone();
                    let down_client = client.clone();
                    let down_table = table.clone();
                    let down_mark = mark.clone();
                    let down_panel = panel.clone();
                    window.on_mouse_event(move |event: &MouseDownEvent, phase, window, cx| {
                        if phase != DispatchPhase::Capture {
                            return;
                        }
                        if down_panel
                            .get()
                            .is_some_and(|panel| panel.contains(&event.position))
                        {
                            return;
                        }
                        cx.stop_propagation();
                        window.prevent_default();
                        let paints = window.recorded_paints();
                        let paints = &paints[..down_mark.get().min(paints.len())];
                        let picked =
                            hit_test(paints, &down_table, event.position, down_panel.get());
                        if let Some(entity) = down_entity.upgrade() {
                            entity.update(cx, |host, cx| {
                                host.consumed_press = true;
                                host.hover = None;
                                cx.notify();
                            });
                        }
                        if let Some((role, _, _)) = picked {
                            act(
                                &down_client,
                                cx,
                                "themeEditorInspectPick",
                                json!({ "role": role }),
                            );
                        }
                    });
                    let key_client = client.clone();
                    window.on_key_event(move |event: &KeyDownEvent, phase, _, cx| {
                        if phase == DispatchPhase::Capture && event.keystroke.key == "escape" {
                            cx.stop_propagation();
                            act(&key_client, cx, "themeEditorInspectCancel", json!({}));
                        }
                    });
                    let scroll_entity = entity.clone();
                    window.on_mouse_event(move |_: &ScrollWheelEvent, phase, _, cx| {
                        if phase != DispatchPhase::Capture {
                            return;
                        }
                        if let Some(entity) = scroll_entity.upgrade() {
                            entity.update(cx, |host, cx| {
                                if host.hover.take().is_some() {
                                    cx.notify();
                                }
                            });
                        }
                    });
                }
                let up_entity = entity.clone();
                window.on_mouse_event(move |_: &MouseUpEvent, phase, _, cx| {
                    if phase != DispatchPhase::Capture {
                        return;
                    }
                    if let Some(entity) = up_entity.upgrade() {
                        let consumed = entity.update(cx, |host, _| {
                            std::mem::replace(&mut host.consumed_press, false)
                        });
                        if consumed {
                            cx.stop_propagation();
                        }
                    }
                });
                if !inspecting && !highlight.is_empty() {
                    let roles: HashSet<&str> = highlight.iter().map(String::as_str).collect();
                    let paints = window.recorded_paints();
                    let paints = &paints[..mark.get().min(paints.len())];
                    let regions = usage_regions(paints, &table, &roles, panel_bounds);
                    let count = regions.len();
                    if usage_sent != Some(count) {
                        let usage_entity = entity.clone();
                        let usage_client = client.clone();
                        window.defer(cx, move |_, cx| {
                            if let Some(entity) = usage_entity.upgrade() {
                                entity.update(cx, |host, _| host.usage_sent = Some(count));
                            }
                            act(
                                &usage_client,
                                cx,
                                "themeEditorUsage",
                                json!({ "count": count }),
                            );
                        });
                    }
                    let holes: Vec<Bounds<Pixels>> =
                        regions.iter().map(|region| padded(region.bounds)).collect();
                    if !holes.is_empty() {
                        paint_dimmer(&holes, bounds, window);
                    }
                    let glow_fill = fade(ring, 0.09);
                    let glow_stroke: Hsla =
                        fade(mix_oklab(ring, gpui::white().to_rgb(), 0.72), 0.92).into();
                    for (region, hole) in regions.iter().zip(holes.iter()) {
                        window.paint_quad(gpui::quad(
                            *hole,
                            px(region.radius),
                            glow_fill,
                            px(2.),
                            glow_stroke,
                            gpui::BorderStyle::Solid,
                        ));
                    }
                }
                if inspecting && let Some(hover) = hover.as_ref() {
                    let stroke: Hsla = mix_oklab(ring, gpui::white().to_rgb(), 0.7).into();
                    window.paint_quad(gpui::quad(
                        hover.bounds,
                        px(hover.radius),
                        fade(ring, 0.07),
                        px(1.),
                        stroke,
                        gpui::BorderStyle::Solid,
                    ));
                }
            },
        )
        .absolute()
        .top_0()
        .left_0()
        .size_full()
        .into_any_element()
    }

    fn hover_label(&self, t: &Tokens, viewport_width: Pixels) -> Option<AnyElement> {
        let hover = self.hover.as_ref()?;
        let above = f32::from(hover.bounds.top()) >= 32.;
        let label = div()
            .absolute()
            .left(hover.bounds.left())
            .max_w(px(192.))
            .overflow_hidden()
            .px(px(7.2))
            .py(px(3.2))
            .border_1()
            .border_color(mix_oklab(t.ring, t.border, 0.48))
            .rounded(px(6.4))
            .bg(t.popover)
            .shadow(vec![shadow(0., 4., 16., 0., black(0.24))])
            .text_color(t.popover_foreground)
            .text_size(px(11.))
            .line_height(px(16.))
            .font_weight(gpui::FontWeight::SEMIBOLD)
            .whitespace_nowrap()
            .text_ellipsis()
            .child(hover.label.clone());
        Some(
            if above {
                div()
                    .absolute()
                    .left_0()
                    .top_0()
                    .w(viewport_width)
                    .h(hover.bounds.top() - px(HOVER_LABEL_GAP))
                    .child(label.bottom_0())
            } else {
                label.top(hover.bounds.bottom() + px(HOVER_LABEL_GAP))
            }
            .into_any_element(),
        )
    }

    fn header(&self, view: &ThemeEditorView, t: &Tokens, cx: &mut Context<Self>) -> AnyElement {
        let model = &view.model;
        let entity = cx.entity().downgrade();
        let inspect_client = self.client.clone();
        let minimize_client = self.client.clone();
        let close_client = self.client.clone();
        div()
            .id("theme-editor-header")
            .flex()
            .flex_none()
            .items_center()
            .gap(px(4.))
            .border_b_1()
            .border_color(fade(t.border, 0.7))
            .px(px(12.))
            .py(px(8.))
            .cursor(if self.drag_offset.is_some() {
                CursorStyle::ClosedHand
            } else {
                CursorStyle::OpenHand
            })
            .on_mouse_down(MouseButton::Left, move |event, _, cx| {
                if let Some(entity) = entity.upgrade() {
                    entity.update(cx, |host, cx| {
                        if let Some(bounds) = host.panel_bounds.get() {
                            host.drag_offset = Some(event.position - bounds.origin);
                            cx.notify();
                        }
                    });
                }
            })
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .items_baseline()
                    .gap(px(8.))
                    .child(
                        div()
                            .flex_none()
                            .truncate()
                            .text_size(px(text::SM))
                            .line_height(px(text::SM_LINE))
                            .font_weight(gpui::FontWeight::MEDIUM)
                            .child(model.title.clone()),
                    )
                    .when_some(model.status_text.clone(), |this, status| {
                        this.child(
                            div()
                                .min_w_0()
                                .truncate()
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .text_color(t.muted_foreground)
                                .child(status),
                        )
                    }),
            )
            .child(
                div()
                    .id("theme-editor-inspect-tip")
                    .flex_none()
                    .tooltip(Tooltip::text(model.inspect.tooltip.clone()))
                    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .child(
                        Button::new("theme-editor-inspect")
                            .size(ButtonSize::Xs)
                            .variant(if model.inspect.active {
                                ButtonVariant::Secondary
                            } else {
                                ButtonVariant::Ghost
                            })
                            .pressed(model.inspect.active)
                            .icon("mouse-pointer-2")
                            .label(model.inspect.label.clone())
                            .accessibility_label(model.inspect.aria_label.clone())
                            .on_click(move |_, _, cx| {
                                act(&inspect_client, cx, "themeEditorInspect", json!({}))
                            }),
                    ),
            )
            .child(
                div()
                    .flex_none()
                    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .child(
                        Button::new("theme-editor-minimize")
                            .size(ButtonSize::IconXs)
                            .variant(ButtonVariant::Ghost)
                            .icon(model.minimize.icon.clone())
                            .accessibility_label(model.minimize.aria_label.clone())
                            .on_click(move |_, _, cx| {
                                act(&minimize_client, cx, "themeEditorMinimize", json!({}))
                            }),
                    ),
            )
            .child(
                div()
                    .flex_none()
                    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .child(
                        Button::new("theme-editor-close")
                            .size(ButtonSize::IconXs)
                            .variant(ButtonVariant::Ghost)
                            .icon("x")
                            .accessibility_label("Close the theme editor")
                            .on_click(move |_, _, cx| {
                                act(&close_client, cx, "themeEditorClose", json!({}))
                            }),
                    ),
            )
            .into_any_element()
    }

    fn row(label: AnyElement, control: AnyElement) -> AnyElement {
        div()
            .flex()
            .items_center()
            .gap(px(12.))
            .child(div().flex_1().min_w_0().child(label))
            .child(
                div()
                    .flex_grow(2.)
                    .flex_shrink(1.)
                    .flex_basis(px(0.))
                    .min_w_0()
                    .child(control),
            )
            .into_any_element()
    }

    fn row_label(label: &str) -> AnyElement {
        div()
            .text_size(px(text::SM))
            .line_height(px(text::SM_LINE))
            .font_weight(gpui::FontWeight::MEDIUM)
            .child(label.to_string())
            .into_any_element()
    }

    fn field(
        &mut self,
        field: &ThemeColorFieldView,
        view: &ThemeEditorView,
        t: &Tokens,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let hex = self.hex_input(field, window, cx);
        let entity = cx.entity().downgrade();
        let swatch_entity = cx.entity().downgrade();
        let toggle_client = self.client.clone();
        let picker_client = self.client.clone();
        let select_client = self.client.clone();
        let role = field.role.clone();
        let field_role = field.role.clone();
        let swatch_role = field.role.clone();
        let picker_role = field.role.clone();
        let select_role = field.role.clone();
        let label = field.label.clone();
        let swatch = color(&field.swatch_value);
        let tooltip = view
            .field_tooltips
            .get(&field.role)
            .cloned()
            .unwrap_or_default();
        div()
            .relative()
            .flex()
            .min_w_0()
            .min_h(px(FIELD_MIN_HEIGHT))
            .items_center()
            .gap(px(8.))
            .rounded(px(radius::LG))
            .px(px(8.))
            .py(px(6.))
            .when(field.selected, |this| {
                this.bg(fade(t.accent, 0.6)).border_1().border_color(t.ring)
            })
            .child(
                canvas(
                    move |bounds, _, cx| {
                        if let Some(entity) = entity.upgrade() {
                            entity.update(cx, |host, _| {
                                host.field_bounds.insert(field_role.clone(), bounds);
                            });
                        }
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .top_0()
                .left_0()
                .size_full(),
            )
            .child(
                div()
                    .id(SharedString::from(format!(
                        "theme-field-toggle-{}",
                        field.role
                    )))
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .items_center()
                    .rounded(px(radius::MD))
                    .cursor_pointer()
                    .text_size(px(text::SM))
                    .line_height(px(text::SM_LINE))
                    .text_color(t.muted_foreground)
                    .hover(|style| style.text_color(t.foreground))
                    .tooltip(Tooltip::text(field.toggle_tooltip.clone()))
                    .on_click(move |_, _, cx| {
                        act(
                            &toggle_client,
                            cx,
                            "themeEditorToggleRole",
                            json!({ "role": role }),
                        )
                    })
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .child(field.label.clone()),
                    ),
            )
            .child(
                div()
                    .ml_auto()
                    .flex()
                    .flex_none()
                    .items_center()
                    .gap(px(8.))
                    .child(
                        div()
                            .id(SharedString::from(format!(
                                "theme-field-swatch-{}",
                                field.role
                            )))
                            .relative()
                            .flex_none()
                            .size(px(SWATCH))
                            .rounded_full()
                            .border_1()
                            .border_color(fade(t.foreground, 0.3))
                            .cursor_pointer()
                            .tooltip(Tooltip::text(tooltip))
                            .child(
                                div()
                                    .absolute()
                                    .top_0()
                                    .left_0()
                                    .size_full()
                                    .rounded_full()
                                    .bg(swatch)
                                    .shadow(vec![shadow(0., 1., 2., 0., black(0.05))]),
                            )
                            .child(
                                canvas(
                                    move |bounds, _, cx| {
                                        if let Some(entity) = swatch_entity.upgrade() {
                                            entity.update(cx, |host, _| {
                                                host.swatch_bounds
                                                    .insert(swatch_role.clone(), bounds);
                                            });
                                        }
                                    },
                                    |_, _, _, _| {},
                                )
                                .absolute()
                                .top_0()
                                .left_0()
                                .size_full(),
                            )
                            .on_click(move |_, _, cx| {
                                act(
                                    &picker_client,
                                    cx,
                                    "themeEditorPickerOpen",
                                    json!({ "role": picker_role, "label": label }),
                                )
                            }),
                    )
                    .child(
                        div()
                            .w(px(HEX_INPUT_WIDTH))
                            .flex_none()
                            .on_mouse_down(MouseButton::Left, move |_, _, cx| {
                                act(
                                    &select_client,
                                    cx,
                                    "themeEditorSelectRole",
                                    json!({ "role": select_role, "reveal": false }),
                                )
                            })
                            .child(
                                Input::new(&hex)
                                    .size(InputSize::Compact)
                                    .font(InputFont::Mono)
                                    .invalid(!field.valid)
                                    .w_full(),
                            ),
                    ),
            )
            .into_any_element()
    }

    fn drag_surface(
        &self,
        kind: PickerDrag,
        on_position: PositionHandler,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let entity = cx.entity().downgrade();
        let dragging = self.picker_drag == Some(kind);
        canvas(
            |bounds, _, _| bounds,
            move |bounds, _, window, _| {
                let down_entity = entity.clone();
                let down_handler = on_position.clone();
                window.on_mouse_event(move |event: &MouseDownEvent, phase, _, cx| {
                    if phase != DispatchPhase::Bubble
                        || event.button != MouseButton::Left
                        || !bounds.contains(&event.position)
                    {
                        return;
                    }
                    if let Some(entity) = down_entity.upgrade() {
                        entity.update(cx, |host, cx| {
                            host.picker_drag = Some(kind);
                            cx.notify();
                        });
                    }
                    down_handler(event.position, bounds, cx);
                });
                if dragging {
                    let move_handler = on_position.clone();
                    window.on_mouse_event(move |event: &MouseMoveEvent, phase, _, cx| {
                        if phase == DispatchPhase::Bubble
                            && event.pressed_button == Some(MouseButton::Left)
                        {
                            move_handler(event.position, bounds, cx);
                        }
                    });
                    let up_entity = entity.clone();
                    window.on_mouse_event(move |_: &MouseUpEvent, phase, _, cx| {
                        if phase != DispatchPhase::Bubble {
                            return;
                        }
                        if let Some(entity) = up_entity.upgrade() {
                            entity.update(cx, |host, cx| {
                                host.picker_drag = None;
                                cx.notify();
                            });
                        }
                    });
                }
            },
        )
        .absolute()
        .top_0()
        .left_0()
        .size_full()
        .into_any_element()
    }

    fn picker(
        &self,
        picker: &ThemeEditorPickerView,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let anchor = *self.swatch_bounds.get(&picker.role)?;
        let hsv = picker.hsv;
        let plane_client = self.client.clone();
        let hue_client = self.client.clone();
        let close_client = self.client.clone();
        let ratio = |value: Pixels, origin: Pixels, length: Pixels| -> f64 {
            let length = f64::from(f32::from(length));
            if length <= 0. {
                return 0.;
            }
            (f64::from(f32::from(value - origin)) / length).clamp(0., 1.)
        };
        let plane_drag = self.drag_surface(
            PickerDrag::Plane,
            Rc::new(move |position, bounds, cx| {
                let s = ratio(position.x, bounds.origin.x, bounds.size.width);
                let v = 1. - ratio(position.y, bounds.origin.y, bounds.size.height);
                act(
                    &plane_client,
                    cx,
                    "themeEditorPickerHsv",
                    json!({ "h": hsv.h, "s": s, "v": v }),
                );
            }),
            cx,
        );
        let hue_drag = self.drag_surface(
            PickerDrag::Hue,
            Rc::new(move |position, bounds, cx| {
                let h = ratio(position.x, bounds.origin.x, bounds.size.width) * 360.;
                act(
                    &hue_client,
                    cx,
                    "themeEditorPickerHsv",
                    json!({ "h": h, "s": hsv.s, "v": hsv.v }),
                );
            }),
            cx,
        );
        let inner_width = PICKER_WIDTH - 24.;
        let thumb_left = hsv.s as f32 * (inner_width - PLANE_THUMB);
        let thumb_top = (1. - hsv.v as f32) * (PLANE_HEIGHT - PLANE_THUMB);
        let hue_left = (hsv.h / 360.) as f32 * (inner_width - HUE_THUMB);
        let current = color(&picker.current_color);
        let hue = color(&picker.hue_color);
        let thumb_shadow = vec![shadow(0., 0., 0., 1., black(0.4))];
        let caption = |label: &str| {
            div()
                .px(px(4.))
                .text_size(px(10.))
                .line_height(px(12.))
                .font_weight(gpui::FontWeight::SEMIBOLD)
                .text_color(t.muted_foreground)
                .child(label.to_uppercase())
        };
        let stops = HUE_STOPS;
        Some(
            PopoverPopup::new(
                SharedString::from(format!("theme-picker-{}", picker.role)),
                anchor,
            )
            .side(Side::Bottom)
            .align(Align::End)
            .side_offset(10.)
            .padding(PopoverPadding::None)
            .on_dismiss(move |_, cx| act(&close_client, cx, "themeEditorPickerClose", json!({})))
            .child(
                div()
                    .w(px(PICKER_WIDTH))
                    .bg(t.popover)
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .border_b_1()
                            .border_color(fade(t.border, 0.7))
                            .px(px(16.))
                            .py(px(12.))
                            .child(
                                div()
                                    .min_w_0()
                                    .child(
                                        div()
                                            .truncate()
                                            .text_size(px(text::XS))
                                            .line_height(px(text::XS_LINE))
                                            .font_weight(gpui::FontWeight::SEMIBOLD)
                                            .text_color(t.foreground)
                                            .child(picker.label.clone()),
                                    )
                                    .child(
                                        div()
                                            .text_size(px(11.))
                                            .line_height(px(16.))
                                            .text_color(t.muted_foreground)
                                            .child(picker.subtitle.clone()),
                                    ),
                            )
                            .child(
                                div()
                                    .flex_none()
                                    .size(px(28.))
                                    .rounded_full()
                                    .bg(current)
                                    .shadow(vec![shadow(0., 1., 2., 0., black(0.05))]),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(12.))
                            .p(px(12.))
                            .child(
                                div()
                                    .relative()
                                    .w_full()
                                    .h(px(PLANE_HEIGHT))
                                    .rounded(px(radius::LG))
                                    .overflow_hidden()
                                    .cursor_crosshair()
                                    .bg(hue)
                                    .child(div().absolute().top_0().left_0().size_full().bg(
                                        linear_gradient(
                                            90.,
                                            linear_color_stop(rgb(0xffffff), 0.),
                                            linear_color_stop(transparent(0xffffff), 1.),
                                        ),
                                    ))
                                    .child(div().absolute().top_0().left_0().size_full().bg(
                                        linear_gradient(
                                            0.,
                                            linear_color_stop(rgb(0x000000), 0.),
                                            linear_color_stop(transparent(0x000000), 1.),
                                        ),
                                    ))
                                    .child(
                                        div()
                                            .absolute()
                                            .left(px(thumb_left))
                                            .top(px(thumb_top))
                                            .size(px(PLANE_THUMB))
                                            .rounded_full()
                                            .border_2()
                                            .border_color(rgb(0xffffff))
                                            .shadow(thumb_shadow.clone()),
                                    )
                                    .child(plane_drag),
                            )
                            .child(
                                div()
                                    .relative()
                                    .flex()
                                    .items_center()
                                    .h(px(HUE_HEIGHT))
                                    .w_full()
                                    .cursor_pointer()
                                    .child(
                                        div()
                                            .flex()
                                            .w_full()
                                            .h(px(HUE_TRACK))
                                            .rounded_full()
                                            .overflow_hidden()
                                            .children(stops.windows(2).map(|pair| {
                                                div().flex_1().h_full().bg(linear_gradient(
                                                    90.,
                                                    linear_color_stop(rgb(pair[0]), 0.),
                                                    linear_color_stop(rgb(pair[1]), 1.),
                                                ))
                                            })),
                                    )
                                    .child(
                                        div()
                                            .absolute()
                                            .left(px(hue_left))
                                            .size(px(HUE_THUMB))
                                            .rounded_full()
                                            .border_2()
                                            .border_color(rgb(0xffffff))
                                            .bg(hue)
                                            .shadow(thumb_shadow),
                                    )
                                    .child(hue_drag),
                            )
                            .child(
                                div()
                                    .flex()
                                    .gap(px(8.))
                                    .child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .flex_1()
                                            .min_w_0()
                                            .gap(px(4.))
                                            .child(caption(&picker.hex_label))
                                            .child(
                                                Input::new(&self.picker_hex)
                                                    .size(InputSize::Sm)
                                                    .font(InputFont::Mono)
                                                    .w_full(),
                                            ),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .flex_col()
                                            .flex_grow(1.2)
                                            .flex_basis(px(0.))
                                            .min_w_0()
                                            .gap(px(4.))
                                            .child(caption(&picker.rgb_label))
                                            .child(
                                                Input::new(&self.picker_rgb)
                                                    .size(InputSize::Sm)
                                                    .font(InputFont::Mono)
                                                    .w_full(),
                                            ),
                                    ),
                            ),
                    ),
            )
            .into_any_element(),
        )
    }

    fn body(
        &mut self,
        view: &ThemeEditorView,
        t: &Tokens,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let model = view.model.clone();
        let appearance_client = self.client.clone();
        let advanced_client = self.client.clone();
        let lock_reason = model
            .appearance
            .options
            .iter()
            .find_map(|option| option.lock_reason.clone());
        let toggles = model.appearance.options.iter().map(|option| {
            let client = appearance_client.clone();
            let value = option.value.clone();
            Toggle::new(SharedString::from(format!(
                "theme-editor-appearance-{}",
                option.value
            )))
            .label(option.label.clone())
            .pressed(option.value == model.appearance.value)
            .disabled(option.locked)
            .on_change(move |_, _, _, cx| {
                act(
                    &client,
                    cx,
                    "themeEditorAppearance",
                    json!({ "appearance": value }),
                )
            })
        });
        let appearance = div()
            .id("theme-editor-appearance")
            .when_some(lock_reason, |this, reason| {
                this.tooltip(Tooltip::text(reason))
            })
            .child(ToggleGroup::new("theme-editor-appearance-group").items(toggles));
        let colors_header = div()
            .flex()
            .items_start()
            .gap(px(12.))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .child(Self::row_label(&model.colors.title))
                    .when_some(model.colors.subtitle.clone(), |this, subtitle| {
                        this.child(
                            div()
                                .text_size(px(text::XS))
                                .line_height(px(text::XS_LINE))
                                .text_color(t.muted_foreground)
                                .child(subtitle),
                        )
                    }),
            )
            .child(
                div()
                    .flex_grow(2.)
                    .flex_shrink(1.)
                    .flex_basis(px(0.))
                    .min_w_0()
                    .flex()
                    .items_start()
                    .gap(px(12.))
                    .when(model.colors.filter.is_some(), |this| {
                        this.child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .child(Input::new(&self.filter).size(InputSize::Sm).w_full()),
                        )
                    })
                    .child(
                        div()
                            .ml_auto()
                            .flex()
                            .flex_none()
                            .items_center()
                            .gap(px(8.))
                            .pt(px(2.))
                            .text_size(px(text::SM))
                            .font_weight(gpui::FontWeight::MEDIUM)
                            .child(model.colors.advanced_label.clone())
                            .child(
                                Switch::new("theme-editor-advanced")
                                    .checked(model.colors.advanced)
                                    .accessibility_label(model.colors.advanced_aria_label.clone())
                                    .on_change(move |checked, _, _, cx| {
                                        act(
                                            &advanced_client,
                                            cx,
                                            "themeEditorAdvanced",
                                            json!({ "checked": checked }),
                                        )
                                    }),
                            ),
                    ),
            );
        let fields: AnyElement = if model.colors.advanced {
            let mut groups = Vec::new();
            for group in &model.colors.groups {
                let rows: Vec<AnyElement> = group
                    .fields
                    .iter()
                    .map(|field| self.field(field, view, t, window, cx))
                    .collect();
                groups.push(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(8.))
                        .child(
                            div()
                                .text_size(px(text::SM))
                                .line_height(px(text::SM_LINE))
                                .font_weight(gpui::FontWeight::MEDIUM)
                                .text_color(t.foreground)
                                .child(group.title.clone()),
                        )
                        .child(div().flex().flex_col().gap(px(4.)).children(rows))
                        .into_any_element(),
                );
            }
            div()
                .flex()
                .flex_col()
                .gap(px(20.))
                .children(groups)
                .when_some(model.colors.empty_message.clone(), |this, message| {
                    this.child(
                        div()
                            .text_size(px(text::XS))
                            .line_height(px(text::XS_LINE))
                            .text_color(t.muted_foreground)
                            .child(message),
                    )
                })
                .into_any_element()
        } else {
            let rows: Vec<AnyElement> = model
                .colors
                .guided_fields
                .iter()
                .map(|field| self.field(field, view, t, window, cx))
                .collect();
            div()
                .flex()
                .flex_col()
                .gap(px(4.))
                .children(rows)
                .into_any_element()
        };
        div()
            .id("theme-editor-scroll")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .track_scroll(&self.scroll)
            .pt(px(12.))
            .pb(px(12.))
            .pl(px(12.))
            .pr(px(6.))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(12.))
                    .child(Self::row(
                        Self::row_label(&model.name_field.label),
                        Input::new(&self.name)
                            .size(InputSize::Sm)
                            .w_full()
                            .into_any_element(),
                    ))
                    .when_some(model.error.clone(), |this, error| {
                        this.child(
                            div()
                                .text_size(px(text::SM))
                                .line_height(px(text::SM_LINE))
                                .text_color(t.destructive_foreground)
                                .child(error),
                        )
                    })
                    .child(Self::row(
                        Self::row_label(&model.appearance.label),
                        appearance.into_any_element(),
                    ))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(12.))
                            .child(colors_header)
                            .child(fields),
                    ),
            )
            .into_any_element()
    }

    fn footer(&self, view: &ThemeEditorView, t: &Tokens) -> AnyElement {
        let cancel = self.client.clone();
        let submit = self.client.clone();
        let footer = &view.model.footer;
        div()
            .flex()
            .flex_none()
            .items_center()
            .justify_end()
            .gap(px(8.))
            .border_t_1()
            .border_color(fade(t.border, 0.7))
            .px(px(12.))
            .py(px(8.))
            .child(
                Button::new("theme-editor-cancel")
                    .size(ButtonSize::Sm)
                    .variant(ButtonVariant::Ghost)
                    .label(footer.cancel_label.clone())
                    .on_click(move |_, _, cx| act(&cancel, cx, "themeEditorClose", json!({}))),
            )
            .child(
                Button::new("theme-editor-submit")
                    .size(ButtonSize::Sm)
                    .when_some(footer.submit_icon.clone(), |button, icon| button.icon(icon))
                    .label(footer.submit_label.clone())
                    .disabled(footer.submit_disabled)
                    .on_click(move |_, _, cx| act(&submit, cx, "themeEditorSubmit", json!({}))),
            )
            .into_any_element()
    }

    fn resize_grip(&self, t: &Tokens, cx: &mut Context<Self>) -> AnyElement {
        let entity = cx.entity().downgrade();
        let stroke = fade(t.muted_foreground, 0.7);
        div()
            .absolute()
            .bottom_0()
            .right_0()
            .size(px(20.))
            .cursor(CursorStyle::ResizeUpLeftDownRight)
            .on_mouse_down(MouseButton::Left, move |event, _, cx| {
                cx.stop_propagation();
                if let Some(entity) = entity.upgrade() {
                    entity.update(cx, |host, cx| {
                        if let Some(bounds) = host.panel_bounds.get() {
                            if host.position.is_none() {
                                host.position = Some(bounds.origin);
                            }
                            host.resize = Some(ResizeStart {
                                pointer: event.position,
                                origin: bounds.origin,
                                width: f32::from(bounds.size.width),
                                height: f32::from(bounds.size.height),
                            });
                            cx.notify();
                        }
                    });
                }
            })
            .child(
                canvas(
                    |_, _, _| (),
                    move |bounds, _, window, _| {
                        let origin = point(bounds.right() - px(14.), bounds.bottom() - px(14.));
                        let unit = 10. / 8.;
                        let at = |x: f32, y: f32| {
                            point(origin.x + px(x * unit), origin.y + px(y * unit))
                        };
                        let mut builder = PathBuilder::stroke(px(1.2));
                        builder.move_to(at(7., 1.));
                        builder.line_to(at(1., 7.));
                        builder.move_to(at(7., 4.5));
                        builder.line_to(at(4.5, 7.));
                        if let Ok(path) = builder.build() {
                            window.paint_path(path, stroke);
                        }
                    },
                )
                .size_full(),
            )
            .into_any_element()
    }

    fn pointer_tracking(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        if self.drag_offset.is_none() && self.resize.is_none() {
            return None;
        }
        let entity = cx.entity().downgrade();
        Some(
            canvas(
                |_, _, _| (),
                move |_, _, window, _| {
                    let move_entity = entity.clone();
                    window.on_mouse_event(move |event: &MouseMoveEvent, phase, window, cx| {
                        if phase != DispatchPhase::Capture {
                            return;
                        }
                        if let Some(entity) = move_entity.upgrade() {
                            entity.update(cx, |host, cx| {
                                if let Some(offset) = host.drag_offset {
                                    let next = event.position - offset;
                                    host.position = Some(host.clamp_drag(
                                        f32::from(next.x),
                                        f32::from(next.y),
                                        window,
                                    ));
                                }
                                if let Some(start) = host.resize {
                                    let viewport = window.viewport_size();
                                    let max_width = (f32::from(viewport.width)
                                        - MARGIN
                                        - f32::from(start.origin.x))
                                    .max(MIN_WIDTH);
                                    let max_height = (f32::from(viewport.height)
                                        - MARGIN
                                        - f32::from(start.origin.y))
                                    .max(MIN_HEIGHT);
                                    let delta = event.position - start.pointer;
                                    host.size = Some((
                                        (start.width + f32::from(delta.x))
                                            .max(MIN_WIDTH)
                                            .min(max_width),
                                        (start.height + f32::from(delta.y))
                                            .max(MIN_HEIGHT)
                                            .min(max_height),
                                    ));
                                }
                                cx.notify();
                            });
                        }
                    });
                    let up_entity = entity.clone();
                    window.on_mouse_event(move |_: &MouseUpEvent, phase, _, cx| {
                        if phase != DispatchPhase::Capture {
                            return;
                        }
                        if let Some(entity) = up_entity.upgrade() {
                            entity.update(cx, |host, cx| {
                                host.drag_offset = None;
                                host.resize = None;
                                cx.notify();
                            });
                        }
                    });
                },
            )
            .absolute()
            .top_0()
            .left_0()
            .size_full()
            .into_any_element(),
        )
    }
}

impl Render for ThemeEditorHost {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.data(cx) else {
            return div().into_any_element();
        };
        let t = theme::active(cx);
        let minimized = view.model.minimize.minimized;
        self.reveal();
        let (width, max_height, height) = self.panel_metrics(window, minimized);
        let viewport = window.viewport_size();
        let overlay = self.overlay(&view, &t, cx);
        let hover_label = if view.model.inspect.active {
            self.hover_label(&t, viewport.width)
        } else {
            None
        };
        let header = self.header(&view, &t, cx);
        let content = if minimized {
            None
        } else {
            Some((
                self.body(&view, &t, window, cx),
                self.footer(&view, &t),
                self.resize_grip(&t, cx),
            ))
        };
        let picker = view
            .picker
            .as_ref()
            .and_then(|picker| self.picker(picker, &t, cx));
        let panel_cell = self.panel_bounds.clone();
        let mut panel = dialog_glass(&t)
            .id("theme-editor-panel")
            .absolute()
            .flex()
            .flex_col()
            .overflow_hidden()
            .rounded(px(radius::XL))
            .text_color(t.popover_foreground)
            .w(px(width))
            .occlude()
            .child(
                canvas(
                    move |bounds, _, _| panel_cell.set(Some(bounds)),
                    |_, _, _, _| {},
                )
                .absolute()
                .top_0()
                .left_0()
                .size_full(),
            )
            .child(header);
        panel = match self.position {
            Some(position) => panel.left(position.x).top(position.y),
            None => panel.right(px(DEFAULT_INSET)).bottom(px(DEFAULT_INSET)),
        };
        if !minimized {
            panel = panel.max_h(px(max_height));
        }
        if let Some(height) = height {
            panel = panel.h(px(height));
        }
        if let Some((body, footer, grip)) = content {
            panel = panel.child(body).child(footer).child(grip);
        }
        div()
            .absolute()
            .top_0()
            .left_0()
            .size_full()
            .child(overlay)
            .children(hover_label)
            .child(panel)
            .children(self.pointer_tracking(cx))
            .children(picker)
            .into_any_element()
    }
}
