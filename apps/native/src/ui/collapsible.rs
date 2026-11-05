use std::rc::Rc;

use gpui::Refineable;
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, ClickEvent, ElementId, InteractiveElement, IntoElement, ParentElement,
    RenderOnce, StatefulInteractiveElement, StyleRefinement, Styled, Window, div,
};

type OpenChange = Rc<dyn Fn(bool, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Collapsible {
    id: ElementId,
    open: bool,
    disabled: bool,
    trigger: Option<AnyElement>,
    children: Vec<AnyElement>,
    on_open_change: Option<OpenChange>,
    style: StyleRefinement,
}

impl Collapsible {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            open: false,
            disabled: false,
            trigger: None,
            children: Vec::new(),
            on_open_change: None,
            style: StyleRefinement::default(),
        }
    }

    pub fn open(mut self, open: bool) -> Self {
        self.open = open;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn trigger(mut self, trigger: impl IntoElement) -> Self {
        self.trigger = Some(trigger.into_any_element());
        self
    }

    pub fn on_open_change(
        mut self,
        handler: impl Fn(bool, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_open_change = Some(Rc::new(handler));
        self
    }
}

impl ParentElement for Collapsible {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl Styled for Collapsible {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for Collapsible {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let open = self.open;
        let mut root = div().id(self.id.clone()).flex().flex_col();
        root.style().refine(&self.style);
        let trigger = self.trigger.map(|trigger| {
            div()
                .id((self.id.clone(), "trigger"))
                .when(!self.disabled, |this| this.cursor_pointer())
                .when_some(
                    self.on_open_change.filter(|_| !self.disabled),
                    |this, handler| {
                        this.on_click(move |_: &ClickEvent, window, cx| handler(!open, window, cx))
                    },
                )
                .child(trigger)
        });
        root.children(trigger).when(open, |this| {
            this.child(div().overflow_hidden().children(self.children))
        })
    }
}
