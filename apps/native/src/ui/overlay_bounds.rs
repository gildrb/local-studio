use std::cell::RefCell;
use std::panic;

use gpui::{
    AnyElement, App, Bounds, Element, ElementId, Global, GlobalElementId, InspectorElementId,
    IntoElement, LayoutId, Pixels, Window,
};

thread_local! {
    static FRAME: RefCell<Vec<Bounds<Pixels>>> = const { RefCell::new(Vec::new()) };
}

#[derive(Default)]
pub struct OpenOverlays(Vec<Bounds<Pixels>>);

impl Global for OpenOverlays {}

impl OpenOverlays {
    pub fn intersects(&self, frame: Bounds<Pixels>) -> bool {
        self.0.iter().any(|overlay| {
            overlay.size.width > Pixels::ZERO
                && overlay.size.height > Pixels::ZERO
                && overlay.intersects(&frame)
        })
    }
}

pub fn open_overlays(cx: &App) -> Option<&OpenOverlays> {
    cx.try_global::<OpenOverlays>()
}

pub fn commit_frame(cx: &mut App) {
    let current = FRAME.with(|frame| std::mem::take(&mut *frame.borrow_mut()));
    if cx
        .try_global::<OpenOverlays>()
        .is_some_and(|open| open.0 == current)
    {
        return;
    }
    if current.is_empty() && !cx.has_global::<OpenOverlays>() {
        return;
    }
    cx.set_global(OpenOverlays(current));
}

pub struct OverlayBounds {
    child: AnyElement,
}

pub fn tracked(child: impl IntoElement) -> OverlayBounds {
    OverlayBounds {
        child: child.into_any_element(),
    }
}

impl IntoElement for OverlayBounds {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for OverlayBounds {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        (self.child.request_layout(window, cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        FRAME.with(|frame| frame.borrow_mut().push(bounds));
        self.child.prepaint(window, cx);
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        self.child.paint(window, cx);
    }
}
