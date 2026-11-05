use std::cell::RefCell;
use std::ops::Range;
use std::rc::Rc;

use gpui::base::{TextSelection, TextSelectionHandle, TextSelectionRegistration, TextSelectionRun};
use gpui::{
    AnyElement, App, BorderStyle, Bounds, Corners, CursorStyle, Edges, Element, ElementId,
    GlobalElementId, Hitbox, HitboxBehavior, InspectorElementId, IntoElement, LayoutId,
    MouseButton, MouseUpEvent, PaintQuad, Pixels, Point, SharedString, StyledText, Window,
    transparent_black,
};

#[derive(Default)]
struct Collector {
    runs: Vec<TextSelectionRun>,
    ranges: Vec<Option<Range<usize>>>,
}

#[derive(Clone, Default)]
pub struct SelectionGroup(Rc<RefCell<Collector>>);

pub struct SelectableBlock {
    id: ElementId,
    group: SelectionGroup,
    copy_text: SharedString,
    child: AnyElement,
}

impl SelectableBlock {
    pub fn new(
        id: impl Into<ElementId>,
        group: SelectionGroup,
        copy_text: impl Into<SharedString>,
        child: impl IntoElement,
    ) -> Self {
        Self {
            id: id.into(),
            group,
            copy_text: copy_text.into(),
            child: child.into_any_element(),
        }
    }
}

fn document_order(bounds: Bounds<Pixels>) -> u64 {
    let top = (f32::from(bounds.top()) + 100_000.).max(0.) * 16.;
    let left = (f32::from(bounds.left()) + 100_000.).max(0.) * 4.;
    (top as u64) * 10_000_000 + left as u64
}

impl IntoElement for SelectableBlock {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for SelectableBlock {
    type RequestLayoutState = TextSelectionHandle;
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        Some(self.id.clone())
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        global_id: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let copy_text = self.copy_text.clone();
        let handle = match global_id {
            Some(global_id) => {
                window.with_element_state(global_id, |retained: Option<TextSelectionHandle>, _| {
                    let handle =
                        retained.unwrap_or_else(|| TextSelectionHandle::new(copy_text, cx));
                    (handle.clone(), handle)
                })
            }
            None => TextSelectionHandle::new(copy_text, cx),
        };
        handle.set_fallback_copy_text(self.copy_text.to_string(), cx);
        self.group.0.borrow_mut().runs.clear();
        (self.child.request_layout(window, cx), handle)
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        handle: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) {
        self.group.0.borrow_mut().runs.clear();
        self.child.prepaint(window, cx);
        let text_bounds = self
            .group
            .0
            .borrow()
            .runs
            .iter()
            .map(|run| run.layout().bounds())
            .collect::<Vec<_>>();
        let hitbox = window.insert_hitbox(bounds, HitboxBehavior::Normal);
        let registration = TextSelectionRegistration::new(hitbox, bounds)
            .with_document_order(document_order(bounds))
            .with_text_bounds(text_bounds)
            .with_rendered_element(handle, window, cx);
        handle.register(registration, window, cx);
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        handle: &mut Self::RequestLayoutState,
        _: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let runs = self.group.0.borrow().runs.clone();
        let before = TextSelection::selected_text(window, cx);
        let projection = handle.update_runs(&runs, cx);
        if before != TextSelection::selected_text(window, cx) {
            window.refresh();
        }
        self.group.0.borrow_mut().ranges = projection.ranges().to_vec();
        self.child.paint(window, cx);
    }
}

pub type LinkHandler = Rc<dyn Fn(&str, &mut App)>;

pub struct SelectableRun {
    group: SelectionGroup,
    text: SharedString,
    styled: StyledText,
    links: Rc<Vec<(Range<usize>, String)>>,
    on_link: Option<LinkHandler>,
}

impl SelectableRun {
    pub fn new(group: &SelectionGroup, text: SharedString, styled: StyledText) -> Self {
        Self {
            group: group.clone(),
            text,
            styled,
            links: Rc::new(Vec::new()),
            on_link: None,
        }
    }

    pub fn links(mut self, links: Vec<(Range<usize>, String)>, on_link: LinkHandler) -> Self {
        self.links = Rc::new(links);
        self.on_link = Some(on_link);
        self
    }
}

fn selection_quads(
    start: Point<Pixels>,
    end: Point<Pixels>,
    bounds: Bounds<Pixels>,
    line_height: Pixels,
) -> Vec<Bounds<Pixels>> {
    if start.y == end.y {
        return vec![Bounds::from_corners(
            start,
            Point::new(end.x, end.y + line_height),
        )];
    }
    let mut quads = vec![Bounds::from_corners(
        start,
        Point::new(bounds.right(), start.y + line_height),
    )];
    if end.y > start.y + line_height {
        quads.push(Bounds::from_corners(
            Point::new(bounds.left(), start.y + line_height),
            Point::new(bounds.right(), end.y),
        ));
    }
    quads.push(Bounds::from_corners(
        Point::new(bounds.left(), end.y),
        Point::new(end.x, end.y + line_height),
    ));
    quads
}

impl IntoElement for SelectableRun {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for SelectableRun {
    type RequestLayoutState = ();
    type PrepaintState = (usize, Option<Hitbox>);

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        global_id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        self.styled
            .request_layout(global_id, inspector_id, window, cx)
    }

    fn prepaint(
        &mut self,
        global_id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        self.styled
            .prepaint(global_id, inspector_id, bounds, &mut (), window, cx);
        let mut collector = self.group.0.borrow_mut();
        let index = collector.runs.len();
        collector.runs.push(
            TextSelectionRun::new(self.text.clone(), self.styled.layout().clone(), bounds)
                .with_document_order(index as u64),
        );
        let hitbox =
            (!self.links.is_empty()).then(|| window.insert_hitbox(bounds, HitboxBehavior::Normal));
        (index, hitbox)
    }

    fn paint(
        &mut self,
        global_id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        (index, hitbox): &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let layout = self.styled.layout().clone();
        let range = self.group.0.borrow().ranges.get(*index).cloned().flatten();
        if let Some(range) = range {
            let color = gpui::base::Theme::global(cx).tokens.colors.selection;
            if let (Some(start), Some(end)) = (
                layout.position_for_index(range.start),
                layout.position_for_index(range.end),
            ) {
                for quad in selection_quads(start, end, layout.bounds(), layout.line_height()) {
                    window.paint_quad(PaintQuad {
                        bounds: quad,
                        background: color.into(),
                        corner_radii: Corners::default(),
                        border_widths: Edges::default(),
                        border_color: transparent_black(),
                        border_style: BorderStyle::default(),
                    });
                }
            }
        }
        self.styled.paint(
            global_id,
            inspector_id,
            bounds,
            &mut (),
            &mut (),
            window,
            cx,
        );
        let Some(hitbox) = hitbox.clone() else {
            return;
        };
        let link_at = {
            let links = self.links.clone();
            let layout = layout.clone();
            move |position: Point<Pixels>| {
                let index = layout.index_for_position(position).ok()?;
                links
                    .iter()
                    .find(|(range, _)| range.contains(&index))
                    .map(|(_, href)| href.clone())
            }
        };
        if hitbox.is_hovered(window) && link_at(window.mouse_position()).is_some() {
            window.set_cursor_style(CursorStyle::PointingHand, &hitbox);
        }
        let on_link = self.on_link.clone();
        window.on_mouse_event(move |event: &MouseUpEvent, phase, window, cx| {
            if !phase.bubble()
                || event.button != MouseButton::Left
                || !hitbox.is_hovered(window)
                || !TextSelection::selected_text(window, cx).is_empty()
            {
                return;
            }
            if let (Some(href), Some(on_link)) = (link_at(event.position), on_link.as_ref()) {
                on_link(&href, cx);
            }
        });
    }
}
