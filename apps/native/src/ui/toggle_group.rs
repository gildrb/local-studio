use gpui::prelude::FluentBuilder;
use gpui::{
    App, Axis, Corners, ElementId, IntoElement, ParentElement, Refineable, RenderOnce,
    StyleRefinement, Styled, Window, px,
};

use super::toggle::{Toggle, ToggleSize, ToggleVariant};
use crate::ui::theme;
use crate::ui::theme::metrics::radius;
use crate::ui::theme::tokens::fade;

pub const GAP: f32 = 2.;
pub const SEGMENTED_PADDING: f32 = 2.;

#[derive(IntoElement)]
pub struct ToggleGroup {
    id: ElementId,
    variant: ToggleVariant,
    size: Option<ToggleSize>,
    items: Vec<Toggle>,
    style: StyleRefinement,
}

impl ToggleGroup {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            variant: ToggleVariant::Segmented,
            size: None,
            items: Vec::new(),
            style: StyleRefinement::default(),
        }
    }

    pub fn variant(mut self, variant: ToggleVariant) -> Self {
        self.variant = variant;
        self
    }

    pub fn size(mut self, size: ToggleSize) -> Self {
        self.size = Some(size);
        self
    }

    pub fn item(mut self, toggle: Toggle) -> Self {
        self.items.push(toggle);
        self
    }

    pub fn items(mut self, toggles: impl IntoIterator<Item = Toggle>) -> Self {
        self.items.extend(toggles);
        self
    }
}

impl Styled for ToggleGroup {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for ToggleGroup {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let variant = self.variant;
        let size = self.size.unwrap_or(if variant == ToggleVariant::Segmented {
            ToggleSize::Segmented
        } else {
            ToggleSize::Default
        });
        let count = self.items.len();
        let joined = !matches!(variant, ToggleVariant::Segmented | ToggleVariant::Default);
        let item_radius = px(size.metrics().radius);
        let items = self
            .items
            .into_iter()
            .enumerate()
            .map(|(index, mut toggle)| {
                let variant = toggle.variant.unwrap_or(variant);
                toggle.variant = Some(variant);
                toggle.size = Some(toggle.size.unwrap_or(size));
                if joined {
                    let first = index == 0;
                    let last = index + 1 == count;
                    let zero = px(0.);
                    toggle.corners = Some(Corners {
                        top_left: if first { item_radius } else { zero },
                        bottom_left: if first { item_radius } else { zero },
                        top_right: if last { item_radius } else { zero },
                        bottom_right: if last { item_radius } else { zero },
                    });
                    toggle.drop_left_border = !first;
                    toggle.drop_right_border = !last;
                }
                toggle
            });
        let mut group = gpui::base::ToggleGroup::new(self.id)
            .axis(Axis::Horizontal)
            .flex()
            .flex_none()
            .items_center()
            .when(!joined, |g| g.gap(px(GAP)))
            .when(variant == ToggleVariant::Segmented, |g| {
                g.p(px(SEGMENTED_PADDING))
                    .rounded(px(radius::LG))
                    .bg(fade(t.input, 0.4))
            })
            .children(items);
        group.style().refine(&self.style);
        group
    }
}
