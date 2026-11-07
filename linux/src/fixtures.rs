use std::rc::Rc;

use adw::prelude::*;
use local_studio_core::{
    AccessMode, Approval, Block, ColorScheme, Connection, ContextUsage, DiffHunk, DiffLine, DiffLineKind, FileChange,
    FileDiff, GitStatus, Item, ItemKind, Keybinding, LocalController, LocalEndpoint, LocalGpu, LocalHardware, LocalJob,
    LocalModelUsage, LocalRecipe, LocalRegistry, LocalRegistryMatch, LocalSnapshot, LocalUsage, ModelKey, ModelOption,
    ModelRef, NoticeLevel, Project, ProviderCredential, ProviderKind, ProviderStatus, QueuedMessage, RegistryModel,
    RegistryVariant, Settings, Shelf, ThreadInfo, ThreadRow, ThreadStatus, ToolKind, ToolState, TranscriptOp, Update,
    UsageByModel, UsageDay, UsageLimit, UsagePeriod, UsageReport,
};

use crate::app::{App, Dirty};
use crate::format;
use crate::state::{Page, State};

pub fn scenes() -> Vec<&'static str> {
    let mut all: Vec<&'static str> = SCENES.to_vec();
    all.extend(crate::scenes_providers::SCENES);
    all.extend(crate::scenes_pickers::SCENES);
    all.extend(crate::dashboard_scenes::SCENES);
    all.extend(crate::keyboard::SCENES);
    all
}

pub const SCENES: [&str; 55] = [
    "01-empty",
    "02-new-thread",
    "03-conversation",
    "04-conversation-expanded",
    "05-working-queue",
    "06-approval",
    "07-sidebar-hidden",
    "08-diff-panel",
    "09-terminal-drawer",
    "10-settings-general",
    "11-settings-keybindings",
    "12-local",
    "13-usage",
    "14-conversation-light",
    "15-command-palette",
    "16-composer-commands",
    "17-composer-mentions",
    "18-sidebar-search",
    "19-sidebar-multiselect",
    "20-files-panel",
    "21-file-preview",
    "22-pulls-panel",
    "23-agents-panel",
    "24-devices-panel",
    "25-browser-panel",
    "26-pull-requests-page",
    "27-project-search",
    "28-panel-launcher",
    "29-diff-split",
    "30-go-to-file",
    "31-composer-meter-stash",
    "32-pull-request-trigger",
    "33-onboarding",
    "34-project-settings",
    "35-theme-editor",
    "36-theme-midnight",
    "37-scroll-pill-minimap",
    "38-worktree-setup-scripts",
    "39-subagents-panel",
    "40-goal-fast-mode",
    "41-fan-out-compare",
    "42-skills-trigger",
    "43-project-defaults",
    "44-project-scripts",
    "45-clone-repository",
    "46-storage-settings",
    "47-banners-wide-sidebar",
    "48-snooze-custom",
    "49-commit-dialog",
    "50-review-comment",
    "51-palette-grouped",
    "52-theme-gildrb",
    "53-theme-gildrb-light",
    "54-gildrb-file-preview-light",
    "55-gildrb-diff-split",
];

pub const FOCUSED: &str = "t-sidebar";
const MINUTE: i64 = 60_000;

#[allow(clippy::too_many_lines)]
pub fn stage(app: &Rc<App>, scene: &str) {
    match scene {
        "01-empty" => {
            app.apply(vec![
                Update::Connection { state: Connection::Ready },
                Update::Settings { settings: Settings::default() },
            ]);
        }
        "02-new-thread" => {
            app.apply(base());
            app.new_thread(Some(project_id("local-studio")));
            app.composer.set_text("");
        }
        "03-conversation" | "14-conversation-light" => {
            conversation(app, false);
            if scene == "14-conversation-light" {
                let settings = Settings { color_scheme: ColorScheme::Light, ..Settings::default() };
                app.apply(vec![Update::Settings { settings }]);
            }
        }
        "04-conversation-expanded" => {
            conversation(app, false);
            let ids: Vec<u64> = app
                .timeline
                .items()
                .iter()
                .filter(|item| {
                    matches!(
                        item.kind,
                        ItemKind::TurnSummary { turn: 2, .. } | ItemKind::Tool { kind: ToolKind::Command, .. }
                    )
                })
                .map(|item| item.id)
                .collect();
            for id in ids {
                app.timeline.toggle(id);
            }
        }
        "05-working-queue" => {
            conversation(app, true);
            app.apply(vec![Update::Queue {
                thread: FOCUSED.to_string(),
                queued: vec![QueuedMessage {
                    id: "q-1".to_string(),
                    text: "Also keep the toggle visible when the window is narrow".to_string(),
                    steering: false,
                    sending: false,
                }],
            }]);
        }
        "06-approval" => {
            conversation(app, true);
            app.apply(vec![Update::Approvals {
                thread: FOCUSED.to_string(),
                approvals: vec![Approval {
                    request_id: "approval-1".to_string(),
                    step: 7,
                    command: "cargo build -p local-studio-gtk && ./target/debug/local-studio --smoke".to_string(),
                    effects: vec!["process.spawn".to_string(), "fs.write: target/".to_string()],
                    agent: None,
                }],
            }]);
        }
        "07-sidebar-hidden" => {
            conversation(app, false);
            app.split.set_show_sidebar(false);
        }
        "08-diff-panel" => {
            conversation(app, false);
            app.panel.show("diff");
            app.panel.diff.set_fixture(&diff_files_public(), false);
        }
        "09-terminal-drawer" => {
            conversation(app, false);
            app.drawer.fixture(
                &[
                    "\x1b[1;34m~/code/local-studio\x1b[0m on \x1b[1;35m linux/gtk\x1b[0m\r\n❯ cargo clippy --all-targets -- -D warnings\r\n\x1b[1;32m    Checking\x1b[0m local-studio-core v0.1.0\r\n\x1b[1;32m    Checking\x1b[0m local-studio-gtk v0.1.0\r\n\x1b[1;32m    Finished\x1b[0m `dev` profile [unoptimized + debuginfo] target(s) in 14.82s\r\n\x1b[1;34m~/code/local-studio\x1b[0m on \x1b[1;35m linux/gtk\x1b[0m\r\n❯ ",
                    "\x1b[1;34m~/code/local-studio/linux\x1b[0m\r\n❯ git status --short\r\n\x1b[32m M\x1b[0m src/drawer.rs\r\n\x1b[32m M\x1b[0m src/panels.rs\r\n\x1b[31m??\x1b[0m src/diffview.rs\r\n❯ ",
                ],
                crate::drawer::Layout::SideBySide,
            );
        }
        "10-settings-general" => {
            conversation(app, false);
            app.open_settings(Some("general"));
            app.apply(vec![Update::Providers { providers: providers(), engines: Vec::new(), errors: Vec::new() }]);
        }
        "11-settings-keybindings" => {
            conversation(app, false);
            app.apply(vec![Update::Keybindings { bindings: keybindings() }]);
            app.open_settings(Some("keybindings"));
        }
        "12-local" => {
            app.apply(base());
            app.open_page(Page::Local);
            app.apply(vec![Update::Local { request: "fixture".to_string(), snapshot: local_snapshot() }]);
            if let Some(row) = first_expander(&app.local.root) {
                row.set_expanded(true);
            }
        }
        "15-command-palette" => {
            conversation(app, false);
            crate::palette::open(app);
        }
        "13-usage" => {
            app.apply(base());
            app.open_page(Page::Usage);
            app.apply(vec![Update::Usage { request: "fixture".to_string(), report: usage_report() }]);
        }
        _ => crate::scenes::stage(app, scene),
    }
}

pub fn teardown(app: &Rc<App>) {
    let dialog = app.settings.take();
    if let Some(dialog) = dialog {
        dialog.close();
    }
    if let Some(dialog) = app.window.visible_dialog() {
        dialog.force_close();
    }
    app.set_panel_maximized(false);
    app.panel.close_where(|_, _| false);
    app.panel.hide();
    app.drawer.reset();
    app.split.set_show_sidebar(true);
    app.sidebar.reset();
    app.composer.reset();
    app.composer.tools.set_fixture(&[]);
    crate::scenes_workflow::reset(app);
    crate::scenes_pickers::reset(app);
    app.branches.reset();
    app.timeline.clear();
    *app.state.borrow_mut() = State::default();
    crate::theme::color_scheme(ColorScheme::System);
    app.render(Dirty::all());
}

fn first_expander(widget: &impl IsA<gtk::Widget>) -> Option<adw::ExpanderRow> {
    let mut child = widget.as_ref().first_child();
    while let Some(current) = child {
        if let Some(row) = current.downcast_ref::<adw::ExpanderRow>() {
            return Some(row.clone());
        }
        if let Some(found) = first_expander(&current) {
            return Some(found);
        }
        child = current.next_sibling();
    }
    None
}

pub fn conversation(app: &Rc<App>, live: bool) {
    app.apply(base());
    app.select_thread(Some(FOCUSED.to_string()));
    let mut updates = vec![
        Update::Thread { thread: FOCUSED.to_string(), info: info(live) },
        Update::Transcript { thread: FOCUSED.to_string(), op: TranscriptOp::Reset { items: transcript(live) } },
        Update::GitStatus {
            project: project_id("local-studio"),
            status: GitStatus {
                branch: Some("linux/gtk".to_string()),
                upstream: Some("origin/linux/gtk".to_string()),
                ahead: 2,
                behind: 0,
                dirty: true,
                default_branch: Some("main".to_string()),
                pull_request: None,
                is_repo: true,
                changed_files: 4,
                has_remote: true,
            },
        },
    ];
    if live {
        let mut threads = threads();
        if let Some(row) = threads.iter_mut().find(|row| row.id == FOCUSED) {
            row.status = ThreadStatus::Working;
            row.status_since = Some(format::now_ms() - 47_000);
        }
        updates.push(Update::Threads { threads });
    }
    app.apply(updates);
}

pub fn base() -> Vec<Update> {
    vec![
        Update::Connection { state: Connection::Ready },
        Update::Settings { settings: Settings::default() },
        Update::Projects { projects: projects() },
        Update::Threads { threads: threads() },
        Update::Models {
            models: models(),
            favorites: vec![ModelKey { provider: "anthropic".to_string(), model: "claude-sonnet-4-5".to_string() }],
            hidden: Vec::new(),
        },
        Update::ArchivedThreads { request: "fixture".to_string(), threads: archived() },
    ]
}

pub fn project_id(name: &str) -> String {
    format!("/home/gil/code/{name}")
}

fn projects() -> Vec<Project> {
    ["local-studio", "eukhe", "dashboards"]
        .into_iter()
        .map(|name| Project {
            id: project_id(name),
            name: name.to_string(),
            path: project_id(name),
            icon: None,
            is_git: true,
        })
        .collect()
}

fn row(id: &str, project: &str, title: &str, shelf: Shelf, status: ThreadStatus, minutes: i64) -> ThreadRow {
    let now = format::now_ms();
    ThreadRow {
        id: id.to_string(),
        project: Some(project_id(project)),
        title: title.to_string(),
        shelf,
        status,
        status_since: Some(now - minutes * MINUTE),
        updated_at: now - minutes * MINUTE,
        snoozed_until: None,
        pinned: shelf == Shelf::Pinned,
        unread: status == ThreadStatus::Done,
        branch: None,
        worktree: None,
        provider: Some("anthropic".to_string()),
        model: Some("claude-sonnet-4-5".to_string()),
        additions: 0,
        deletions: 0,
        note: None,
        archived: false,
        auto_settle: true,
        live_agents: 0,
        fan_out: None,
        pull_request: None,
    }
}

fn threads() -> Vec<ThreadRow> {
    let now = format::now_ms();
    let mut rows = vec![
        row("t-release", "local-studio", "Ship the 0.4 release notes", Shelf::Pinned, ThreadStatus::Idle, 180),
        row(FOCUSED, "local-studio", "GTK sidebar inbox with shelves", Shelf::Active, ThreadStatus::Idle, 2),
        row("t-approval", "eukhe", "Daemon reconnect after worker crash", Shelf::Active, ThreadStatus::Approval, 6),
        row("t-done", "dashboards", "Fleet chart uses the shared palette", Shelf::Active, ThreadStatus::Done, 14),
        row("t-failed", "eukhe", "Bend proof for queue ordering", Shelf::Active, ThreadStatus::Failed, 38),
        row("t-idle", "local-studio", "Composer model picker favorites", Shelf::Active, ThreadStatus::Idle, 95),
        row("t-snooze-1", "dashboards", "Revisit GPU memory bar colors", Shelf::Snoozed, ThreadStatus::Idle, 600),
        row("t-snooze-2", "eukhe", "Bump tokio after the 1.48 release", Shelf::Snoozed, ThreadStatus::Idle, 1_440),
        row("t-settled-1", "local-studio", "Settings search index", Shelf::Settled, ThreadStatus::Idle, 2_880),
        row("t-settled-2", "dashboards", "Registry filter keeps focus", Shelf::Settled, ThreadStatus::Idle, 4_320),
        row("t-settled-3", "eukhe", "Faux engine fixtures for smoke", Shelf::Settled, ThreadStatus::Idle, 7_200),
    ];
    for row in &mut rows {
        match row.id.as_str() {
            FOCUSED => {
                row.branch = Some("linux/gtk".to_string());
                row.additions = 412;
                row.deletions = 37;
                row.live_agents = 2;
                row.pull_request = Some(pull(412, "Linux client on GTK4 and libadwaita", "OPEN"));
            }
            "t-release" => row.branch = Some("main".to_string()),
            "t-approval" => {
                row.branch = Some("fix/reconnect-backoff".to_string());
                row.worktree = Some("/home/gil/.local/share/local-studio/worktrees/eukhe/fix-reconnect".to_string());
                row.additions = 58;
                row.deletions = 12;
            }
            "t-done" => {
                row.branch = Some("feat/fleet-chart".to_string());
                row.additions = 96;
                row.deletions = 41;
                row.pull_request = Some(pull(409, "Fleet chart uses the shared palette", "MERGED"));
            }
            "t-idle" => {
                row.status = ThreadStatus::Monitoring;
                row.fan_out = Some("compare-1".to_string());
            }
            "t-snooze-1" => row.snoozed_until = Some(now + 2 * 60 * MINUTE),
            "t-snooze-2" => row.snoozed_until = Some(now + 3 * 24 * 60 * MINUTE),
            _ => {}
        }
    }
    rows
}

fn archived() -> Vec<ThreadRow> {
    let mut rows = vec![
        row("a-1", "local-studio", "Prototype the command palette", Shelf::Settled, ThreadStatus::Idle, 20_000),
        row("a-2", "eukhe", "Investigate flaky attach test", Shelf::Settled, ThreadStatus::Idle, 30_000),
    ];
    for row in &mut rows {
        row.archived = true;
    }
    rows
}

fn models() -> Vec<ModelOption> {
    let levels = vec!["off".to_string(), "low".to_string(), "medium".to_string(), "high".to_string()];
    [
        ("anthropic", "claude-sonnet-4-5", "Claude Sonnet 4.5", true),
        ("anthropic", "claude-opus-4-1", "Claude Opus 4.1", true),
        ("openai", "gpt-5-codex", "GPT-5 Codex", true),
        ("local", "qwen3-coder-30b", "Qwen3 Coder 30B", false),
    ]
    .into_iter()
    .map(|(provider, id, name, reasoning)| ModelOption {
        provider: provider.to_string(),
        id: id.to_string(),
        name: name.to_string(),
        reasoning,
        thinking_levels: if reasoning { levels.clone() } else { Vec::new() },
        context_window: 200_000,
        configured: true,
        service_tiers: if provider == "openai" {
            vec!["auto".to_string(), "flex".to_string(), "priority".to_string()]
        } else {
            Vec::new()
        },
    })
    .collect()
}

fn info(live: bool) -> ThreadInfo {
    ThreadInfo {
        thread: FOCUSED.to_string(),
        project: Some(project_id("local-studio")),
        title: "GTK sidebar inbox with shelves".to_string(),
        cwd: project_id("local-studio"),
        model: Some(ModelRef {
            provider: "anthropic".to_string(),
            id: "claude-sonnet-4-5".to_string(),
            name: Some("Claude Sonnet 4.5".to_string()),
            reasoning: true,
        }),
        thinking_level: "high".to_string(),
        thinking_levels: vec!["off".to_string(), "low".to_string(), "medium".to_string(), "high".to_string()],
        access: AccessMode::Supervised,
        busy: live,
        run_started_at: live.then(|| format::now_ms() - 47_000),
        compacting: false,
        retry_attempt: 0,
        queued: u32::from(live),
        context: Some(ContextUsage { tokens: 48_200, window: 200_000 }),
        branch: Some("linux/gtk".to_string()),
        worktree: None,
        service_tier: None,
        service_tiers: Vec::new(),
        goal: None,
    }
}

fn pull(number: u64, title: &str, state: &str) -> local_studio_core::PullRequest {
    local_studio_core::PullRequest {
        number,
        title: title.to_string(),
        url: format!("https://github.com/gildrb/local-studio/pull/{number}"),
        state: state.to_string(),
        checks: "passing".to_string(),
        head: "linux/gtk".to_string(),
        base: "main".to_string(),
    }
}

fn thumbnail() -> local_studio_core::ImageThumbnail {
    local_studio_core::ImageThumbnail {
        mime_type: "image/png".to_string(),
        data: crate::scenes::swatch(),
        width: 96,
        height: 64,
    }
}

pub fn item(id: u64, turn: u64, minutes: i64, kind: ItemKind) -> Item {
    Item { id, turn, created_at: Some(format::now_ms() - minutes * MINUTE), kind }
}

fn tool(id: u64, turn: u64, kind: ToolKind, name: &str, summary: &str, arguments: &str, output: &str) -> Item {
    let now = format::now_ms();
    item(
        id,
        turn,
        20,
        ItemKind::Tool {
            call_id: format!("call-{id}"),
            name: name.to_string(),
            kind,
            summary: summary.to_string(),
            arguments: arguments.to_string(),
            state: ToolState::Succeeded,
            output: output.to_string(),
            file_change: None,
            started_at: Some(now - 20 * MINUTE),
            ended_at: Some(now - 20 * MINUTE + 2_400),
        },
    )
}

#[allow(clippy::too_many_lines)]
fn transcript(live: bool) -> Vec<Item> {
    let mut items = vec![
        item(1, 1, 30, ItemKind::User {
            text: "Sketch the sidebar inbox for the Linux client: one list across projects with Pinned, Active, Snoozed and Settled shelves.".to_string(),
            images: 0,
            entry: Some("entry-1".to_string()),
            thumbnails: Vec::new(),
        }),
        item(2, 1, 29, ItemKind::Assistant {
            blocks: vec![Block::Text {
                text: "The inbox is one `GtkListView` over a flat model of shelf headers and thread rows. The core already orders and shelves the threads, so the view only maps rows to widgets and splices the changed range.".to_string(),
            }],
            streaming: false,
            error: None,
            changed_files: Vec::new(),
        }),
        item(3, 2, 22, ItemKind::User {
            text: "Good. Build it, wire the context menu to the core, and run clippy.".to_string(),
            images: 1,
            entry: Some("entry-2".to_string()),
            thumbnails: vec![thumbnail()],
        }),
        item(4, 2, 21, ItemKind::Assistant {
            blocks: vec![
                Block::Thinking { text: "Start from the row model: card rows for Pinned and Active, slim rows for Snoozed and Settled.".to_string() },
                Block::Text { text: "Reading the current sidebar and the core's `ThreadRow`.".to_string() },
            ],
            streaming: false,
            error: None,
            changed_files: Vec::new(),
        }),
        tool(5, 2, ToolKind::Read, "read", "Read linux/src/sidebar.rs", "{\"path\":\"linux/src/sidebar.rs\"}", "use std::cell::RefCell;\n…"),
        tool(6, 2, ToolKind::Search, "search", "Search \"Shelf::\" in core/src", "{\"pattern\":\"Shelf::\"}", "core/src/threads.rs:88: Shelf::Pinned\ncore/src/threads.rs:91: Shelf::Snoozed"),
        item(7, 2, 19, ItemKind::Tool {
            call_id: "call-7".to_string(),
            name: "edit".to_string(),
            kind: ToolKind::Edit,
            summary: "Edit linux/src/sidebar.rs".to_string(),
            arguments: "{\"path\":\"linux/src/sidebar.rs\"}".to_string(),
            state: ToolState::Succeeded,
            output: String::new(),
            file_change: Some(FileChange { path: "linux/src/sidebar.rs".to_string(), additions: 214, deletions: 12, diff: "@@ -40,6 +40,18 @@\n+fn thread_widget(row: &ThreadRow) -> gtk::Widget {".to_string() }),
            started_at: None,
            ended_at: None,
        }),
        tool(
            8,
            2,
            ToolKind::Command,
            "bash",
            "cargo clippy --all-targets -- -D warnings",
            "{\"script\":\"cargo clippy --all-targets -- -D warnings\"}",
            "    Checking local-studio-core v0.1.0\n    Checking local-studio-gtk v0.1.0 (/home/gil/code/local-studio/linux)\n    Finished `dev` profile [unoptimized + debuginfo] target(s) in 14.82s",
        ),
        item(9, 2, 18, ItemKind::TurnSummary { turn: 2, duration_ms: 192_000, tool_count: 4 }),
        item(10, 2, 18, ItemKind::Assistant {
            blocks: vec![Block::Text {
                text: "Done. The sidebar now renders the inbox from the core's rows:\n\n- **Pinned** and **Active** use card rows with project, status and diff stats.\n- **Snoozed** and **Settled** are slim rows under collapsible shelf headers.\n- Right-click opens the thread menu: pin, settle, snooze, rename, mark unread, archive and delete.\n\n```rust\nlist.connect_activate(move |list, position| select(list, position));\n```\n\nClippy is clean with `-D warnings`.".to_string(),
            }],
            streaming: false,
            error: None,
            changed_files: vec![
                FileChange { path: "linux/src/sidebar.rs".to_string(), additions: 214, deletions: 12, diff: String::new() },
                FileChange { path: "linux/src/actions.rs".to_string(), additions: 168, deletions: 0, diff: String::new() },
                FileChange { path: "linux/src/theme.rs".to_string(), additions: 30, deletions: 25, diff: String::new() },
            ],
        }),
        item(11, 3, 4, ItemKind::Notice { level: NoticeLevel::Info, text: "Model switched to Claude Sonnet 4.5".to_string() }),
    ];
    if live {
        items.push(item(
            12,
            3,
            1,
            ItemKind::User {
                text: "Make the sidebar toggle stay put when the sidebar collapses.".to_string(),
                images: 0,
                entry: None,
                thumbnails: Vec::new(),
            },
        ));
        items.push(item(13, 3, 1, ItemKind::Assistant {
            blocks: vec![
                Block::Thinking { text: "The toggle lives in both header bars; only one is visible at a time.".to_string() },
                Block::Text { text: "Both header bars carry the toggle at the same x position, so hiding the sidebar swaps which one is visible".to_string() },
            ],
            streaming: true,
            error: None,
            changed_files: Vec::new(),
        }));
        items.push(item(
            14,
            3,
            1,
            ItemKind::Tool {
                call_id: "call-14".to_string(),
                name: "bash".to_string(),
                kind: ToolKind::Command,
                summary: "cargo build -p local-studio-gtk".to_string(),
                arguments: String::new(),
                state: ToolState::Running,
                output: String::new(),
                file_change: None,
                started_at: Some(format::now_ms() - 9_000),
                ended_at: None,
            },
        ));
    }
    items
}

pub fn diff_files_public() -> Vec<FileDiff> {
    let line = |kind, old: Option<u32>, new: Option<u32>, text: &str| DiffLine {
        kind,
        old_line: old,
        new_line: new,
        text: text.to_string(),
    };
    vec![
        FileDiff {
            path: "linux/src/header.rs".to_string(),
            old_path: None,
            status: "modified".to_string(),
            additions: 6,
            deletions: 2,
            binary: false,
            hunks: vec![DiffHunk {
                header: "@@ -84,9 +84,13 @@ impl Header {".to_string(),
                lines: vec![
                    line(DiffLineKind::Context, Some(84), Some(84), "    pub fn bind_split(&self, split: &adw::OverlaySplitView) {"),
                    line(DiffLineKind::Removed, Some(85), None, "        split.bind_property(\"show-sidebar\", &self.toggle, \"active\").build();"),
                    line(DiffLineKind::Removed, Some(86), None, "        self.toggle.set_visible(true);"),
                    line(DiffLineKind::Added, None, Some(85), "        split.bind_property(\"show-sidebar\", &self.toggle, \"active\")"),
                    line(DiffLineKind::Added, None, Some(86), "            .bidirectional()"),
                    line(DiffLineKind::Added, None, Some(87), "            .sync_create()"),
                    line(DiffLineKind::Added, None, Some(88), "            .build();"),
                    line(DiffLineKind::Added, None, Some(89), "        for widget in [self.toggle.upcast_ref(), self.new_thread.upcast_ref()] {"),
                    line(DiffLineKind::Added, None, Some(90), "            split.bind_property(\"show-sidebar\", widget, \"visible\").invert_boolean().build();"),
                    line(DiffLineKind::Context, Some(87), Some(91), "    }"),
                ],
            }],
        },
        FileDiff {
            path: "linux/src/theme.rs".to_string(),
            old_path: None,
            status: "modified".to_string(),
            additions: 2,
            deletions: 1,
            binary: false,
            hunks: vec![DiffHunk {
                header: "@@ -12,7 +12,8 @@".to_string(),
                lines: vec![
                    line(DiffLineKind::Context, Some(12), Some(12), ".ls-thread { border-radius: 10px; padding: 7px 10px; }"),
                    line(DiffLineKind::Removed, Some(13), None, ".ls-thread.selected { background: alpha(currentColor, 0.08); }"),
                    line(DiffLineKind::Added, None, Some(13), ".ls-thread.selected { background: alpha(var(--accent-bg-color), 0.16); }"),
                    line(DiffLineKind::Added, None, Some(14), ".ls-thread.selected { border-color: alpha(var(--accent-bg-color), 0.45); }"),
                ],
            }],
        },
    ]
}

pub fn provider(
    id: &str,
    name: &str,
    kind: ProviderKind,
    credential: ProviderCredential,
    count: u32,
) -> ProviderStatus {
    ProviderStatus {
        id: id.to_string(),
        name: name.to_string(),
        kind,
        configured: !matches!(credential, ProviderCredential::Missing),
        credential,
        model_count: count,
        env_var: (kind == ProviderKind::BuiltIn).then(|| format!("{}_API_KEY", id.to_uppercase())),
        base_url: None,
        api: None,
        models: Vec::new(),
    }
}

pub fn providers() -> Vec<ProviderStatus> {
    vec![
        provider("anthropic", "Anthropic", ProviderKind::BuiltIn, ProviderCredential::StoredKey, 9),
        provider("openai", "OpenAI", ProviderKind::BuiltIn, ProviderCredential::Environment, 14),
        provider("google", "Google", ProviderKind::BuiltIn, ProviderCredential::Missing, 6),
        provider("openrouter", "OpenRouter", ProviderKind::BuiltIn, ProviderCredential::Missing, 0),
    ]
}

fn keybindings() -> Vec<Keybinding> {
    [
        ("sidebar.toggle", "Sidebar: Toggle", Some("cmd+b"), None),
        ("chat.new", "Chat: New", Some("cmd+n"), Some("!terminalFocus")),
        ("chat.newWithoutProject", "Chat: New Without Project", Some("cmd+option+n"), None),
        ("commandPalette.toggle", "Command Palette: Toggle", Some("cmd+k"), Some("!terminalFocus")),
        ("terminal.toggle", "Terminal: Toggle", Some("cmd+j"), None),
        ("diff.toggle", "Diff: Toggle", Some("cmd+d"), Some("!terminalFocus")),
        ("thread.settle", "Thread: Settle", Some("cmd+shift+s"), None),
        ("thread.pin", "Thread: Pin", Some("cmd+shift+p"), None),
        ("thread.previous", "Thread: Previous", Some("cmd+shift+["), None),
        ("usage.open", "Usage: Open", Some("cmd+u"), None),
    ]
    .into_iter()
    .map(|(command, title, shortcut, when)| Keybinding {
        command: command.to_string(),
        title: title.to_string(),
        shortcut: shortcut.map(str::to_string),
        default_shortcut: shortcut.map(str::to_string),
        when: when.map(str::to_string),
    })
    .collect()
}

fn days(count: usize, scale: u64) -> Vec<UsageDay> {
    let today = format::now_ms() / 86_400_000;
    (0..count)
        .map(|index| {
            let offset = i64::try_from(count - 1 - index).unwrap_or(0);
            let day = today - offset;
            let tokens = scale * ((u64::try_from(index).unwrap_or(0) * 7 + 3) % 11 + 2);
            let date = gtk::glib::DateTime::from_unix_utc(day * 86_400)
                .ok()
                .and_then(|date| date.format("%Y-%m-%d").ok())
                .map(|text| text.to_string())
                .unwrap_or_default();
            #[allow(clippy::cast_precision_loss)]
            let cost = tokens as f64 / 1_000_000.0 * 3.2;
            UsageDay { day: date, tokens, cost_usd: cost }
        })
        .collect()
}

#[allow(clippy::too_many_lines)]
fn local_snapshot() -> LocalSnapshot {
    let recipes = vec![
        LocalRecipe {
            id: "qwen3-coder-30b-vllm".to_string(),
            model: "Qwen/Qwen3-Coder-30B-A3B-Instruct".to_string(),
            card: "RTX 4090".to_string(),
            engine: "vllm".to_string(),
            cards: 2,
            context: 131_072,
            tokens_per_second: Some(85.0),
            fits: true,
            blocked: None,
            detail: "2 of 2 GPUs · vllm · 128k context · 85 tok/s".to_string(),
        },
        LocalRecipe {
            id: "gpt-oss-20b-sglang".to_string(),
            model: "openai/gpt-oss-20b".to_string(),
            card: "RTX 4090".to_string(),
            engine: "sglang".to_string(),
            cards: 1,
            context: 65_536,
            tokens_per_second: Some(140.0),
            fits: true,
            blocked: None,
            detail: "1 of 2 GPUs · sglang · 64k context · 140 tok/s".to_string(),
        },
    ];
    let server = LocalController {
        target: String::new(),
        url: "http://127.0.0.1:18091".to_string(),
        id: Some("ctl-server".to_string()),
        name: "server".to_string(),
        host: "server.tail1234.ts.net".to_string(),
        local: true,
        reachable: true,
        error: None,
        version: Some("0.4.2".to_string()),
        hardware: Some(LocalHardware {
            cpus: 16,
            memory_total_bytes: 128_000_000_000,
            memory_free_bytes: 90_000_000_000,
            gpus: vec![
                LocalGpu {
                    index: 0,
                    name: "NVIDIA GeForce RTX 4090".to_string(),
                    card: Some("RTX 4090".to_string()),
                    memory_used_mib: 21_000,
                    memory_total_mib: 24_564,
                    busy: true,
                },
                LocalGpu {
                    index: 1,
                    name: "NVIDIA GeForce RTX 4090".to_string(),
                    card: Some("RTX 4090".to_string()),
                    memory_used_mib: 20_400,
                    memory_total_mib: 24_564,
                    busy: true,
                },
            ],
            memory_used_bytes: 43_400_000_000,
            memory_capacity_bytes: 51_500_000_000,
            memory_label: "VRAM".to_string(),
            gpu_summary: "2× RTX 4090".to_string(),
        }),
        endpoints: vec![LocalEndpoint {
            id: "ep-1".to_string(),
            controller_id: "ctl-server".to_string(),
            port: 8000,
            pid: Some(4242),
            models: vec!["qwen3-coder-30b".to_string()],
            live: true,
            job_id: None,
        }],
        jobs: Vec::new(),
        recipes: recipes.clone(),
        requests: 18_420,
        tokens: 412_000_000,
        measured_requests: 18_100,
    };
    let studio = LocalController {
        target: "http://studio.tail1234.ts.net:18091".to_string(),
        url: "http://studio.tail1234.ts.net:18091".to_string(),
        id: Some("ctl-studio".to_string()),
        name: "studio".to_string(),
        host: "studio.tail1234.ts.net".to_string(),
        local: false,
        reachable: true,
        error: None,
        version: Some("0.4.2".to_string()),
        hardware: Some(LocalHardware {
            cpus: 24,
            memory_total_bytes: 192_000_000_000,
            memory_free_bytes: 120_000_000_000,
            gpus: Vec::new(),
            memory_used_bytes: 72_000_000_000,
            memory_capacity_bytes: 192_000_000_000,
            memory_label: "Memory".to_string(),
            gpu_summary: "Apple M2 Ultra".to_string(),
        }),
        endpoints: Vec::new(),
        jobs: vec![LocalJob {
            id: "run-7".to_string(),
            recipe_id: "gpt-oss-120b-mlx".to_string(),
            port: 8001,
            phase: "downloading".to_string(),
            progress: Some(0.4),
            message: Some("model-00003-of-00007.safetensors".to_string()),
            failed: false,
            detail: "downloading 40% · model-00003-of-00007.safetensors".to_string(),
        }],
        recipes: Vec::new(),
        requests: 2_310,
        tokens: 61_000_000,
        measured_requests: 2_200,
    };
    let laptop = LocalController {
        target: "http://laptop.tail1234.ts.net:18091".to_string(),
        url: "http://laptop.tail1234.ts.net:18091".to_string(),
        id: None,
        name: "laptop".to_string(),
        host: "laptop.tail1234.ts.net".to_string(),
        local: false,
        reachable: false,
        error: Some("Offline".to_string()),
        version: None,
        hardware: None,
        endpoints: Vec::new(),
        jobs: Vec::new(),
        recipes: Vec::new(),
        requests: 0,
        tokens: 0,
        measured_requests: 0,
    };
    let variant = |id: &str, engine: &str, hardware: &str, count: u32, size: f64, recommended: bool, fits: bool| {
        RegistryVariant {
            id: id.to_string(),
            status: "verified".to_string(),
            engine: engine.to_string(),
            hardware_id: hardware.to_string(),
            hardware_count: count,
            format: Some("safetensors".to_string()),
            precision: Some("bf16".to_string()),
            size_gb: Some(size),
            launch_kind: "docker".to_string(),
            evidence: true,
            recommended,
            fits,
        }
    };
    LocalSnapshot {
        controllers: vec![server, studio, laptop],
        registry: Some(LocalRegistry {
            controller: String::new(),
            all: false,
            commit: Some("8c1f2e94d1".to_string()),
            error: None,
            matches: vec![LocalRegistryMatch {
                name: "RTX 4090".to_string(),
                memory_gb: Some(24.0),
                count: 2,
                hardware_id: Some("rtx-4090".to_string()),
                hardware_name: Some("RTX 4090".to_string()),
            }],
            total: 42,
            models: vec![
                RegistryModel {
                    repo: "Qwen/Qwen3-Coder-30B-A3B-Instruct".to_string(),
                    variants: vec![
                        variant("qwen3-coder-30b-vllm", "vllm", "rtx-4090", 2, 61.0, true, true),
                        variant("qwen3-coder-30b-sglang", "sglang", "rtx-4090", 2, 61.0, false, true),
                    ],
                },
                RegistryModel {
                    repo: "openai/gpt-oss-20b".to_string(),
                    variants: vec![variant("gpt-oss-20b-sglang", "sglang", "rtx-4090", 1, 13.0, true, true)],
                },
                RegistryModel {
                    repo: "openai/gpt-oss-120b".to_string(),
                    variants: vec![variant("gpt-oss-120b-vllm", "vllm", "h100", 2, 65.0, true, false)],
                },
            ],
            downloads: Vec::new(),
        }),
        usage: LocalUsage {
            today_tokens: 3_400_000,
            week_tokens: 28_900_000,
            all_tokens: 473_000_000,
            requests: 20_730,
            measured_requests: 20_300,
            daily: days(30, 900_000),
            models: vec![
                LocalModelUsage {
                    model: "qwen3-coder-30b".to_string(),
                    requests: 15_210,
                    share_percent: 73.0,
                    tokens: 351_000_000,
                    measured: true,
                },
                LocalModelUsage {
                    model: "gpt-oss-20b".to_string(),
                    requests: 5_520,
                    share_percent: 27.0,
                    tokens: 122_000_000,
                    measured: true,
                },
            ],
        },
        tailnet: None,
        record: None,
        share: None,
        auto_model: Some("qwen3-coder-30b".to_string()),
        generated_at: None,
        error: None,
    }
}

fn usage_report() -> UsageReport {
    UsageReport {
        period: UsagePeriod::Week,
        total_tokens: 48_300_000,
        input_tokens: 44_100_000,
        output_tokens: 4_200_000,
        cost_usd: 61.42,
        requests: 37,
        by_model: vec![
            UsageByModel {
                provider: "anthropic".to_string(),
                model: "claude-sonnet-4-5".to_string(),
                tokens: 31_200_000,
                cost_usd: 44.10,
                requests: 22,
            },
            UsageByModel {
                provider: "openai".to_string(),
                model: "gpt-5-codex".to_string(),
                tokens: 12_900_000,
                cost_usd: 17.32,
                requests: 11,
            },
            UsageByModel {
                provider: "local".to_string(),
                model: "qwen3-coder-30b".to_string(),
                tokens: 4_200_000,
                cost_usd: 0.0,
                requests: 4,
            },
        ],
        daily: days(7, 4_000_000),
        limits: vec![
            UsageLimit {
                provider: "anthropic".to_string(),
                window: "5-hour".to_string(),
                used_percent: Some(62.0),
                resets_at: Some(format::now_ms() + 95 * MINUTE),
                parked: false,
            },
            UsageLimit {
                provider: "anthropic".to_string(),
                window: "Weekly".to_string(),
                used_percent: Some(28.0),
                resets_at: Some(format::now_ms() + 3 * 24 * 60 * MINUTE),
                parked: false,
            },
            UsageLimit {
                provider: "openai".to_string(),
                window: "5-hour".to_string(),
                used_percent: Some(100.0),
                resets_at: Some(format::now_ms() + 40 * MINUTE),
                parked: true,
            },
        ],
    }
}
