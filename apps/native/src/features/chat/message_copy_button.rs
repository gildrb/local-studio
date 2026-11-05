use std::time::Duration;

use gpui::prelude::FluentBuilder;
use gpui::{
    App, Bounds, ClipboardItem, ElementId, InteractiveElement, IntoElement, ParentElement, Pixels,
    RenderOnce, SharedString, StatefulInteractiveElement, Styled, Window, canvas, div, px, svg,
};

use crate::ui::theme;
use crate::ui::tooltip::{Tooltip, TooltipPopup, TooltipVariant};

const SIZE: f32 = 24.;
const RADIUS: f32 = 8.;
const ICON: f32 = 12.;
const COPIED_TIMEOUT: Duration = Duration::from_millis(1000);

#[derive(IntoElement)]
pub struct MessageCopyButton {
    id: SharedString,
    text: String,
}

impl MessageCopyButton {
    pub fn new(id: impl Into<SharedString>, text: String) -> Self {
        Self {
            id: id.into(),
            text,
        }
    }
}

impl RenderOnce for MessageCopyButton {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let copied = window.use_keyed_state(
            ElementId::Name(SharedString::from(format!("{}.copied", self.id))),
            cx,
            |_, _| false,
        );
        let bounds = window.use_keyed_state(
            ElementId::Name(SharedString::from(format!("{}.bounds", self.id))),
            cx,
            |_, _| Bounds::<Pixels>::default(),
        );
        let is_copied = *copied.read(cx);
        let anchor = *bounds.read(cx);
        let hover_bg = t.accent;
        let text = self.text;
        let state = copied.clone();
        let measure = bounds.clone();
        div()
            .id(self.id)
            .relative()
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .size(px(SIZE))
            .rounded(px(RADIUS))
            .when(!is_copied, |this| {
                this.cursor_pointer()
                    .hover(move |style| style.bg(hover_bg))
                    .tooltip(Tooltip::text("Copy message"))
                    .on_click(move |_, _, cx| {
                        cx.write_to_clipboard(ClipboardItem::new_string(text.clone()));
                        state.update(cx, |value, cx| {
                            *value = true;
                            cx.notify();
                        });
                        let state = state.clone();
                        cx.spawn(async move |cx| {
                            cx.background_executor().timer(COPIED_TIMEOUT).await;
                            state.update(cx, |value, cx| {
                                *value = false;
                                cx.notify();
                            })
                        })
                        .detach();
                    })
            })
            .child(
                svg()
                    .path(if is_copied {
                        "icons/check.svg"
                    } else {
                        "icons/copy.svg"
                    })
                    .size(px(ICON))
                    .text_color(if is_copied {
                        t.primary
                    } else {
                        t.muted_foreground
                    }),
            )
            .child(
                canvas(
                    move |bounds, _, cx| {
                        measure.update(cx, |value, _| *value = bounds);
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            )
            .when(is_copied, |this| {
                this.child(TooltipPopup::new(anchor, "Copied!").variant(TooltipVariant::Glass))
            })
    }
}
