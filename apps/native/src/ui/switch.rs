use std::rc::Rc;

use gpui::prelude::FluentBuilder;
use gpui::{
    App, ClickEvent, ElementId, IntoElement, ParentElement, RenderOnce, SharedString, Styled,
    Window, div, px,
};

use super::button::{DISABLED_OPACITY, focus_ring, is_focus_visible, keyed_focus, shadow, uniform};
use crate::ui::theme;
use crate::ui::theme::color::{BLACK, alpha};
use crate::ui::theme::metrics::radius;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SwitchSize {
    #[default]
    Default,
    Sm,
}

impl SwitchSize {
    pub const fn thumb_size(self) -> f32 {
        match self {
            SwitchSize::Default => 16.,
            SwitchSize::Sm => 14.,
        }
    }

    pub const fn track(self) -> (f32, f32) {
        let thumb = self.thumb_size();
        (thumb * 2. - 2., thumb + 2.)
    }
}

pub const PADDING: f32 = 2.;

type ChangeHandler = Rc<dyn Fn(bool, &ClickEvent, &mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct Switch {
    id: ElementId,
    checked: bool,
    mixed: bool,
    disabled: bool,
    size: SwitchSize,
    accessibility_label: Option<SharedString>,
    on_change: Option<ChangeHandler>,
}

impl Switch {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            checked: false,
            mixed: false,
            disabled: false,
            size: SwitchSize::default(),
            accessibility_label: None,
            on_change: None,
        }
    }

    pub fn checked(mut self, checked: bool) -> Self {
        self.checked = checked;
        self
    }

    pub fn mixed(mut self, mixed: bool) -> Self {
        self.mixed = mixed;
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    pub fn size(mut self, size: SwitchSize) -> Self {
        self.size = size;
        self
    }

    pub fn accessibility_label(mut self, label: impl Into<SharedString>) -> Self {
        self.accessibility_label = Some(label.into());
        self
    }

    pub fn on_change(
        mut self,
        handler: impl Fn(bool, &ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_change = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for Switch {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let handle = keyed_focus(&self.id, window, cx);
        let focused = !self.disabled && is_focus_visible(&handle, window);
        let thumb_size = self.size.thumb_size();
        let (width, height) = self.size.track();
        let travel = thumb_size - 4.;
        let offset = if self.mixed {
            travel / 2.
        } else if self.checked {
            travel
        } else {
            0.
        };
        let track = if self.checked && !self.mixed {
            t.primary
        } else {
            t.input
        };
        let thumb = div()
            .flex_none()
            .size(px(thumb_size - 2.))
            .ml(px(offset))
            .rounded(px(radius::FULL))
            .bg(t.background)
            .shadow(vec![
                shadow(alpha(BLACK, 0.05), 1., 3., 0.),
                shadow(alpha(BLACK, 0.05), 1., 2., -1.),
            ])
            .when(self.mixed, |thumb| thumb.opacity(0.7));
        gpui::base::Switch::new(self.id)
            .track_focus(&handle)
            .checked(self.checked)
            .disabled(self.disabled)
            .when_some(self.accessibility_label, |s, label| {
                s.accessibility_label(label)
            })
            .when_some(self.on_change, |s, on_change| {
                s.on_change(move |checked, event, window, cx| on_change(checked, event, window, cx))
            })
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .w(px(width))
            .h(px(height))
            .p(px(PADDING))
            .rounded(px(radius::FULL))
            .bg(track)
            .when(!self.disabled, |s| s.cursor_pointer())
            .when(self.disabled, |s| s.opacity(DISABLED_OPACITY))
            .child(thumb)
            .when(focused, |s| {
                s.child(focus_ring(&t, uniform(height / 2.), 0.))
            })
    }
}
