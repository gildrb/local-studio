#![cfg_attr(feature = "ffi", allow(unsafe_code))]

mod daemon;
mod model;
mod session;
mod store;
mod studio;
mod threads;
mod transcript;
mod workspace;

pub use model::{
    AccessMode, Approval, ApprovalAnswer, Block, Connection, ContextUsage, Delivery, FileChange, ImageAttachment, Item,
    ItemKind, ModelKey, ModelOption, ModelRef, NoticeLevel, NotificationKind, Project, PromptDraft, QueuedMessage,
    Shelf, SlashCommand, ThreadInfo, ThreadRow, ThreadSearchHit, ThreadSettings, ThreadStatus, ToolKind, ToolState,
    TranscriptOp, Update, WorktreeChoice,
};
pub use studio::{DaemonLaunch, Studio, StudioConfig, StudioError, Waker};
pub use workspace::model::*;

#[cfg(feature = "ffi")]
uniffi::setup_scaffolding!("local_studio_core");
