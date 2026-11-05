use serde::Deserialize;

use crate::app_core::views::markdown::{MarkdownDocView, SyntaxTokenView};
use crate::app_core::views::pierre_icon::PierreIconView;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ContextChipTone {
    Neutral,
    Image,
    Video,
    File,
    Mention,
    Terminal,
    Element,
    PreviewAnnotation,
    ReviewComment,
    PullRequest,
    PrOpen,
    PrDraft,
    PrMerged,
    PrClosed,
    Skill,
    Citation,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ContextChipState {
    Normal,
    Unresolved,
    Invalid,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ContextChipLabelWidth {
    Attachment,
    Citation,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ContextChipIconView {
    Pierre { icon: PierreIconView },
    Lucide { asset: String },
    Image { url: String },
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PullRequestDisplayState {
    Open,
    Draft,
    Closed,
    Merged,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ContextChipTooltipView {
    Text {
        text: String,
        code: bool,
    },
    PullRequest {
        number: u32,
        title: String,
        state: PullRequestDisplayState,
        state_label: String,
        head_branch: String,
        base_branch: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ContextChipActionView {
    None,
    Popover,
    OpenMention {
        path: String,
    },
    ExpandImage {
        message_id: String,
        attachment_id: String,
    },
    OpenAttachment {
        message_id: String,
        attachment_id: String,
    },
    ExpandVideo {
        message_id: String,
        attachment_id: String,
    },
    OpenPullRequest {
        url: String,
    },
    OpenCitation {
        href: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum SkillTextSegmentView {
    Text { text: String },
    Skill { label: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SourcePreviewView {
    pub lines: Vec<Vec<SyntaxTokenView>>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAnnotationElementView {
    pub key: String,
    pub selector: String,
    pub source_label: Option<String>,
    pub html_preview: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAnnotationImageView {
    pub url: Option<String>,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ContextChipDetailsView {
    Terminal {
        terminal_label: String,
        range_label: String,
        text: String,
    },
    Element {
        title: String,
        page_url: String,
        selector: String,
        source_label: Option<String>,
        html: Option<SourcePreviewView>,
        styles: Option<SourcePreviewView>,
    },
    PreviewAnnotation {
        image: Option<PreviewAnnotationImageView>,
        title: String,
        comment: Option<String>,
        target_summary: Option<String>,
        style_change_count: u32,
        elements: Vec<PreviewAnnotationElementView>,
    },
    ReviewComment {
        file_path: String,
        section_label: String,
        text: Option<Vec<SkillTextSegmentView>>,
        fence: Option<Box<MarkdownDocView>>,
        patch: Option<Box<MarkdownDocView>>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextChipView {
    pub key: String,
    pub tone: ContextChipTone,
    pub state: ContextChipState,
    pub icon: Option<ContextChipIconView>,
    pub label: String,
    pub label_width: Option<ContextChipLabelWidth>,
    pub size: Option<String>,
    pub tooltip: Option<ContextChipTooltipView>,
    pub copy_markdown: String,
    pub action: ContextChipActionView,
    pub disabled: bool,
    pub details: Option<Box<ContextChipDetailsView>>,
}
