use gpui::Refineable;
use gpui::prelude::FluentBuilder;
use gpui::{
    AnyElement, App, ElementId, FontWeight, InteractiveElement, IntoElement, ParentElement,
    RenderOnce, StyleRefinement, Styled, Window, div, px,
};

use crate::ui::theme;
use crate::ui::theme::metrics::{space, text};

pub const HEAD_HEIGHT: f32 = 40.;
pub const CELL_PADDING: f32 = space::S2;

#[derive(IntoElement, Default)]
pub struct Table {
    header: Option<TableHeader>,
    body: Option<TableBody>,
    style: StyleRefinement,
}

impl Table {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn header(mut self, header: TableHeader) -> Self {
        self.header = Some(header);
        self
    }

    pub fn body(mut self, body: TableBody) -> Self {
        self.body = Some(body);
        self
    }
}

impl Styled for Table {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for Table {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let mut table = div()
            .w_full()
            .flex()
            .flex_col()
            .text_size(px(text::XS))
            .line_height(px(text::XS_LINE));
        table.style().refine(&self.style);
        table.children(self.header).children(self.body)
    }
}

#[derive(IntoElement, Default)]
pub struct TableHeader {
    rows: Vec<TableRow>,
}

impl TableHeader {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn row(mut self, row: TableRow) -> Self {
        self.rows.push(row);
        self
    }
}

impl RenderOnce for TableHeader {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        div()
            .flex()
            .flex_col()
            .children(self.rows.into_iter().map(|row| row.bordered(true)))
    }
}

#[derive(IntoElement, Default)]
pub struct TableBody {
    rows: Vec<TableRow>,
}

impl TableBody {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn row(mut self, row: TableRow) -> Self {
        self.rows.push(row);
        self
    }

    pub fn rows(mut self, rows: impl IntoIterator<Item = TableRow>) -> Self {
        self.rows.extend(rows);
        self
    }
}

impl RenderOnce for TableBody {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let last = self.rows.len().saturating_sub(1);
        div().flex().flex_col().children(
            self.rows
                .into_iter()
                .enumerate()
                .map(move |(index, row)| row.bordered(index != last)),
        )
    }
}

#[derive(IntoElement)]
pub struct TableRow {
    id: ElementId,
    bordered: bool,
    selected: bool,
    expanded: bool,
    hoverable: bool,
    children: Vec<AnyElement>,
    style: StyleRefinement,
}

impl TableRow {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            bordered: true,
            selected: false,
            expanded: false,
            hoverable: true,
            children: Vec::new(),
            style: StyleRefinement::default(),
        }
    }

    pub fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }

    pub fn expanded(mut self, expanded: bool) -> Self {
        self.expanded = expanded;
        self
    }

    pub fn hoverable(mut self, hoverable: bool) -> Self {
        self.hoverable = hoverable;
        self
    }

    fn bordered(mut self, bordered: bool) -> Self {
        self.bordered = bordered;
        self
    }
}

impl ParentElement for TableRow {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl Styled for TableRow {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for TableRow {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = theme::active(cx);
        let half = t.row_hover;
        let mut row = div()
            .id(self.id)
            .w_full()
            .flex()
            .items_center()
            .when(self.bordered, |row| row.border_b_1().border_color(t.border))
            .when(self.expanded, |row| row.bg(half))
            .when(self.selected, |row| row.bg(t.muted))
            .when(self.hoverable && !self.selected, |row| {
                row.hover(move |style| style.bg(half))
            });
        row.style().refine(&self.style);
        row.children(self.children)
    }
}

#[derive(IntoElement)]
pub struct TableHead {
    children: Vec<AnyElement>,
    checkbox: bool,
    style: StyleRefinement,
}

impl TableHead {
    pub fn new() -> Self {
        Self {
            children: Vec::new(),
            checkbox: false,
            style: StyleRefinement::default(),
        }
    }

    pub fn checkbox(mut self, checkbox: bool) -> Self {
        self.checkbox = checkbox;
        self
    }
}

impl Default for TableHead {
    fn default() -> Self {
        Self::new()
    }
}

impl ParentElement for TableHead {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl Styled for TableHead {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for TableHead {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let mut head = div()
            .h(px(HEAD_HEIGHT))
            .flex()
            .items_center()
            .px(px(CELL_PADDING))
            .when(self.checkbox, |head| head.pr_0())
            .font_weight(FontWeight::MEDIUM)
            .whitespace_nowrap()
            .text_color(theme::active(cx).foreground);
        head.style().refine(&self.style);
        head.children(self.children)
    }
}

#[derive(IntoElement)]
pub struct TableCell {
    children: Vec<AnyElement>,
    checkbox: bool,
    style: StyleRefinement,
}

impl TableCell {
    pub fn new() -> Self {
        Self {
            children: Vec::new(),
            checkbox: false,
            style: StyleRefinement::default(),
        }
    }

    pub fn checkbox(mut self, checkbox: bool) -> Self {
        self.checkbox = checkbox;
        self
    }
}

impl Default for TableCell {
    fn default() -> Self {
        Self::new()
    }
}

impl ParentElement for TableCell {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl Styled for TableCell {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl RenderOnce for TableCell {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let mut cell = div()
            .flex()
            .items_center()
            .p(px(CELL_PADDING))
            .when(self.checkbox, |cell| cell.pr_0())
            .whitespace_nowrap();
        cell.style().refine(&self.style);
        cell.children(self.children)
    }
}
