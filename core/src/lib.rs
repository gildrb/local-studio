#![cfg_attr(feature = "ffi", allow(unsafe_code))]

mod daemon;
mod harness;
mod highlight;
mod images;
mod model;
mod oneshot;
pub mod plugins;
mod scratch;
mod session;
mod skills;
mod store;
mod studio;
mod threads;
mod transcript;
pub mod tunnel;
mod workspace;

pub use highlight::{highlight, highlight_lines, CodeSegment, SyntaxKind};
pub use model::{
    AccessMode, Approval, ApprovalAnswer, Block, CommandKind, Connection, ContextUsage, DaemonMismatch, Delivery,
    FileChange, Goal, Harness, ImageAttachment, ImageThumbnail, Item, ItemKind, ModelKey, ModelOption, ModelRef,
    NoticeLevel, NotificationKind, Project, PromptDraft, QueuedMessage, Shelf, SkillEntry, SkillSource, SlashCommand,
    Subagent, ThreadInfo, ThreadRow, ThreadSearchHit, ThreadSettings, ThreadStatus, ToolKind, ToolState, TranscriptOp,
    Update, WorktreeChoice,
};
pub use scratch::{check_scratch_agent, stored_keys_empty};
pub use studio::{DaemonLaunch, Studio, StudioConfig, StudioError, Waker};
pub use workspace::model::*;
pub use workspace::{endpoint_presets, terminal_preview};

#[cfg(feature = "ffi")]
uniffi::setup_scaffolding!("local_studio_core");
