use serde::Deserialize;

use crate::app_core::views::context_chip::ContextChipView;
use crate::app_core::views::pierre_icon::PierreIconView;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MarkdownMediaKind {
    Image,
    Video,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MarkdownImageSource {
    Direct,
    Workspace,
    Blocked,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownGalleryView {
    pub linked_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum MarkdownInlineView {
    Text {
        text: String,
        bold: bool,
        italic: bool,
        strike: bool,
        code: bool,
        href: Option<String>,
    },
    Break,
    FileChip {
        label: String,
        icon: PierreIconView,
        target_path: String,
        display_path: String,
        panel_path: Option<String>,
        line: Option<u32>,
        copy_markdown: String,
    },
    Image {
        alt: String,
        media: MarkdownMediaKind,
        source: MarkdownImageSource,
        path: Option<String>,
        url: Option<String>,
        #[serde(default)]
        href: Option<String>,
        #[serde(default)]
        original_url: Option<String>,
        #[serde(default)]
        gallery: Option<MarkdownGalleryView>,
    },
    Favicon {
        host: String,
        brand: Option<LinkBrand>,
        url: Option<String>,
    },
    ContextReference {
        context_kind: String,
        context_id: String,
        label: String,
        copy_markdown: String,
    },
    ContextChip {
        chip: Box<ContextChipView>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownListItemView {
    pub checked: Option<bool>,
    pub blocks: Vec<MarkdownBlockView>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyntaxTokenView {
    pub text: String,
    pub dark: Option<String>,
    pub light: Option<String>,
    #[serde(default)]
    pub font_style: u8,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TableAlign {
    Left,
    Center,
    Right,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum MarkdownBlockView {
    Paragraph {
        inlines: Vec<MarkdownInlineView>,
    },
    Heading {
        depth: u8,
        inlines: Vec<MarkdownInlineView>,
    },
    List {
        ordered: bool,
        start: u32,
        depth: u32,
        spread: bool,
        items: Vec<MarkdownListItemView>,
    },
    Blockquote {
        alert: Option<String>,
        blocks: Vec<MarkdownBlockView>,
    },
    Code(Box<MarkdownCodeView>),
    Table(Box<MarkdownTableView>),
    Rule,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownTableView {
    pub align: Vec<Option<TableAlign>>,
    pub header: Vec<Vec<MarkdownInlineView>>,
    pub rows: Vec<Vec<Vec<MarkdownInlineView>>>,
    pub copy_markdown: String,
    pub copy_csv: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownCodeView {
    pub language: String,
    pub title: Option<String>,
    pub icon: Option<PierreIconView>,
    pub code: String,
    pub can_run: bool,
    pub lines: Vec<Vec<SyntaxTokenView>>,
    pub highlighted: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LinkBrand {
    Github,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownDocView {
    pub blocks: Vec<MarkdownBlockView>,
    pub word_wrap: bool,
}
