use gpui::{AnyElement, IntoElement, ParentElement, ScrollHandle, Styled, div, point, px};

use crate::features::pull_requests::row::AnchorBounds;

pub const ROOT: &str = "sticky:root";

pub fn key(name: &str) -> String {
    format!("sticky:{name}")
}

pub struct Pinned {
    pub name: String,
    pub top: f32,
    pub natural_top: f32,
}

pub fn pinned<'a>(
    frames: &AnchorBounds,
    scroll: &ScrollHandle,
    names: impl IntoIterator<Item = &'a str>,
    header_height: f32,
) -> Option<Pinned> {
    let frames = frames.borrow();
    let root = frames.get(ROOT)?;
    let scroll_top = -f32::from(scroll.offset().y);
    names.into_iter().find_map(|name| {
        let bounds = frames.get(&key(name))?;
        let top = f32::from(bounds.top() - root.top());
        let bottom = top + f32::from(bounds.size.height);
        (top < scroll_top && bottom > scroll_top).then(|| Pinned {
            name: name.to_string(),
            top: (bottom - scroll_top - header_height).min(0.),
            natural_top: top,
        })
    })
}

pub fn anchor_collapse(pinned: &Pinned, scroll: &ScrollHandle) {
    let offset = scroll.offset();
    scroll.set_offset(point(offset.x, px(-pinned.natural_top.max(0.))));
}

pub fn overlay(top: f32, header: AnyElement) -> AnyElement {
    div()
        .absolute()
        .left_0()
        .right_0()
        .top(px(top))
        .child(header)
        .into_any_element()
}
