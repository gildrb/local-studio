use std::rc::Rc;

use adw::prelude::*;
use gtk::{gdk, glib};
use local_studio_core::{
    Branch, Device, DevicePlatform, FileContent, FileEntry, ImageAttachment, ItemKind, PrCheck, PrComment, PrEvent,
    PullRequest, PullRequestDetail, SearchHit, SlashCommand, ThreadSearchHit, ToolKind, ToolState, TranscriptOp,
    Update,
};

use crate::app::{App, Dirty};
use crate::fixtures::{base, conversation, item, project_id, FOCUSED};
use crate::format;
use crate::state::Page;

const MINUTE: i64 = 60_000;

#[allow(clippy::too_many_lines)]
pub fn stage(app: &Rc<App>, scene: &str) {
    match scene {
        "16-composer-commands" => {
            app.apply(base());
            app.new_thread(Some(project_id("local-studio")));
            app.branches.set_fixture(
                true,
                Some(Branch { name: "feat/gtk-panels".to_string(), remote: false, current: false, worktree: None }),
            );
            app.composer.extras.set_fixture(
                vec!["linux/src/panels.rs".to_string()],
                vec![ImageAttachment { mime_type: "image/png".to_string(), data: swatch() }],
            );
            app.composer.set_text("/co");
            app.composer.extras.show_fixture_commands(commands(), "co");
            app.render(Dirty::all());
        }
        "17-composer-mentions" => {
            conversation(app, false);
            app.composer.set_text("Compare the sidebar with @side");
            app.composer.extras.show_fixture_mentions(&mentions());
        }
        "18-sidebar-search" => {
            conversation(app, false);
            app.sidebar.set_fixture_search("toggle", search_hits());
            app.render(Dirty { sidebar: true, ..Dirty::default() });
        }
        "19-sidebar-multiselect" => {
            conversation(app, false);
            app.sidebar.set_fixture_marks(&["t-done", "t-failed", "t-idle"]);
            app.sidebar.start_rename("t-approval");
            app.sidebar.set_hints(true);
            app.render(Dirty { sidebar: true, ..Dirty::default() });
        }
        "20-files-panel" => {
            conversation(app, false);
            app.panel.show("files");
            app.panel.files.loaded(&files());
        }
        "21-file-preview" => {
            conversation(app, false);
            app.panel.show("files");
            app.panel.files.preview(
                "linux/src/branches.rs",
                &FileContent::Text { text: PREVIEW.to_string(), language: Some("rust".to_string()) },
            );
        }
        "22-pulls-panel" => {
            conversation(app, false);
            app.panel.show("pulls");
            app.panel.pulls.loaded(&pulls());
            app.panel.pulls.detail(&pull_detail());
        }
        "23-agents-panel" => {
            conversation(app, false);
            let start = u64::try_from(app.timeline.items().len()).unwrap_or(0);
            let updates = agents()
                .into_iter()
                .enumerate()
                .map(|(offset, agent)| Update::Transcript {
                    thread: FOCUSED.to_string(),
                    op: TranscriptOp::Insert { index: start + u64::try_from(offset).unwrap_or(0), item: agent },
                })
                .collect();
            app.apply(updates);
            app.panel.show("agents");
        }
        "24-devices-panel" => {
            conversation(app, false);
            app.panel.show("devices");
            app.panel.devices.loaded(&devices());
        }
        "25-browser-panel" => {
            conversation(app, false);
            app.panel.show("browser");
            app.panel.browser.load_html(BROWSER);
        }
        "26-pull-requests-page" => {
            app.apply(base());
            app.open_page(Page::PullRequests);
            app.pulls.set_fixture(&pulls(), &pull_detail());
        }
        "28-panel-launcher" => {
            conversation(app, false);
            app.panel.toggle_panel();
        }
        "29-diff-split" => {
            conversation(app, false);
            app.panel.show("files");
            app.panel.show("diff");
            app.panel.diff.set_fixture(&crate::fixtures::diff_files_public(), true);
            app.set_panel_maximized(true);
        }
        "30-go-to-file" => {
            conversation(app, false);
            app.goto.present(app);
            app.goto.set_fixture("side", &mentions());
        }
        "31-composer-meter-stash" => {
            conversation(app, false);
            let settings =
                local_studio_core::Settings { context_window_meter: true, ..app.state.borrow().settings.clone() };
            app.apply(vec![Update::Settings { settings }]);
            app.composer.tools.set_fixture(&[
                "Refactor the drawer so splits remember their sizes",
                "Write the release notes for 0.5\n\n- drawer\n- launcher",
            ]);
            app.composer.extras.add_context(
                "Terminal",
                "$ cargo test -p local-studio-core\nrunning 42 tests\ntest result: ok. 42 passed",
            );
            app.composer.set_text("Why did the second run take longer?");
        }
        "32-pull-request-trigger" => {
            conversation(app, false);
            app.composer.type_text(app, "Follow up on #4");
            app.composer.extras.pulls_loaded(&pulls());
        }
        "33-onboarding" => {
            app.apply(vec![
                Update::Connection { state: local_studio_core::Connection::Ready },
                Update::Settings { settings: local_studio_core::Settings::default() },
            ]);
            crate::wizard::present(app);
        }
        "34-project-settings" => {
            app.apply(base());
            crate::project::present(app, &project_id("local-studio"));
        }
        "35-theme-editor" => {
            conversation(app, false);
            crate::themes::editor(app);
        }
        "36-theme-midnight" => {
            conversation(app, false);
            let settings = local_studio_core::Settings {
                theme: Some("Midnight".to_string()),
                ..app.state.borrow().settings.clone()
            };
            app.apply(vec![Update::Settings { settings }]);
        }
        "37-scroll-pill-minimap" => {
            conversation(app, true);
            app.timeline.scroll_to_start();
        }
        "27-project-search" => {
            conversation(app, false);
            app.search.present(app);
            app.search.set_fixture("Shelf::", &project_hits());
        }
        _ => {}
    }
}

fn swatch() -> Vec<u8> {
    let (width, height) = (96_usize, 64_usize);
    let mut pixels = Vec::with_capacity(width * height * 4);
    for y in 0..height {
        for x in 0..width {
            let mix = u8::try_from((x * 255) / width).unwrap_or(255);
            let shade = u8::try_from((y * 120) / height).unwrap_or(120);
            pixels.extend_from_slice(&[
                52_u8.saturating_add(shade / 2),
                107_u8.saturating_sub(shade / 3),
                241,
                mix.max(120),
            ]);
        }
    }
    let texture = gdk::MemoryTexture::new(
        i32::try_from(width).unwrap_or(1),
        i32::try_from(height).unwrap_or(1),
        gdk::MemoryFormat::R8g8b8a8,
        &glib::Bytes::from_owned(pixels),
        width * 4,
    );
    texture.save_to_png_bytes().to_vec()
}

fn commands() -> Vec<SlashCommand> {
    [
        ("compact", "Summarize the conversation to free context", "Eukhe"),
        ("commit", "Commit the working tree with a generated message", "Project"),
        ("code-review", "Review the latest changes for bugs", "Skill"),
        ("context", "Show what is in the context window", "Eukhe"),
    ]
    .into_iter()
    .map(|(name, description, source)| SlashCommand {
        name: name.to_string(),
        description: description.to_string(),
        source: source.to_string(),
    })
    .collect()
}

fn mentions() -> Vec<SearchHit> {
    [
        ("linux/src/sidebar.rs", "linux/src"),
        ("macos/Sources/Features/Sidebar/", "macos/Sources/Features"),
        ("linux/src/sidebar.rs.orig", "linux/src"),
    ]
    .into_iter()
    .map(|(relative, preview)| SearchHit { relative: relative.to_string(), line: None, preview: preview.to_string() })
    .collect()
}

fn search_hits() -> Vec<ThreadSearchHit> {
    vec![
        ThreadSearchHit {
            thread: FOCUSED.to_string(),
            title: "GTK sidebar inbox with shelves".to_string(),
            snippet: "Make the sidebar toggle stay put when the sidebar collapses.".to_string(),
            project: Some(project_id("local-studio")),
        },
        ThreadSearchHit {
            thread: "t-idle".to_string(),
            title: "Composer model picker favorites".to_string(),
            snippet: "…the favorite toggle sits next to the visibility switch in Settings → Providers…".to_string(),
            project: Some(project_id("local-studio")),
        },
        ThreadSearchHit {
            thread: "t-done".to_string(),
            title: "Fleet chart uses the shared palette".to_string(),
            snippet: "Dark mode toggle keeps the accent at #346bf1.".to_string(),
            project: Some(project_id("dashboards")),
        },
    ]
}

fn files() -> Vec<FileEntry> {
    [
        ("controller", true, 0),
        ("core", true, 0),
        ("linux", true, 0),
        ("macos", true, 0),
        ("AGENTS.md", false, 1_534),
        ("Cargo.lock", false, 98_211),
        ("Cargo.toml", false, 812),
        ("README.md", false, 4_120),
        ("rust-toolchain.toml", false, 88),
    ]
    .into_iter()
    .map(|(name, directory, size)| FileEntry { name: name.to_string(), relative: name.to_string(), directory, size })
    .collect()
}

const PREVIEW: &str = "use local_studio_core::{Branch, WorktreeChoice};\n\npub fn choice(worktree: bool, pick: Option<Branch>) -> WorktreeChoice {\n    match (worktree, pick) {\n        (false, _) => WorktreeChoice::Local,\n        (true, Some(branch)) => match branch.worktree {\n            Some(path) => WorktreeChoice::Existing { path },\n            None => WorktreeChoice::NewWorktree { branch: branch.name, base: None },\n        },\n        (true, None) => WorktreeChoice::NewWorktree { branch: \"local-studio/draft\".to_string(), base: None },\n    }\n}\n";

fn pulls() -> Vec<PullRequest> {
    [
        (412, "Linux client on GTK4 and libadwaita", "OPEN", "passing", "linux/gtk"),
        (409, "Core: thread search and pinned order", "MERGED", "passing", "core/search"),
        (405, "Settings: keybinding recorder", "OPEN", "pending", "feat/keys"),
        (398, "Drop the legacy sidebar", "CLOSED", "failing", "chore/legacy"),
    ]
    .into_iter()
    .map(|(number, title, state, checks, head)| PullRequest {
        number,
        title: title.to_string(),
        url: format!("https://github.com/gildrb/local-studio/pull/{number}"),
        state: state.to_string(),
        checks: checks.to_string(),
        head: head.to_string(),
        base: "main".to_string(),
    })
    .collect()
}

fn pull_detail() -> PullRequestDetail {
    let now = format::now_ms();
    let pull = pulls().into_iter().next().unwrap_or_else(|| PullRequest {
        number: 0,
        title: String::new(),
        url: String::new(),
        state: String::new(),
        checks: String::new(),
        head: String::new(),
        base: String::new(),
    });
    PullRequestDetail {
        pull,
        body: "Adds the Linux client:\n\n- Sidebar inbox with shelves, search and bulk actions\n- Timeline, composer with `/` commands and `@` mentions\n- Right panel with diff, files, terminal, pull requests, agents, devices and a browser\n\nVerified with `--smoke` and `--snapshot` under xvfb.".to_string(),
        author: Some("gildrb".to_string()),
        created_at: Some(now - 26 * 60 * MINUTE),
        files: crate::fixtures::diff_files_public(),
        comments: vec![PrComment {
            author: "reviewer".to_string(),
            body: "The toggle position is stable now. Ship it.".to_string(),
            created_at: Some(now - 90 * MINUTE),
            path: Some("linux/src/header.rs".to_string()),
            line: Some(88),
        }],
        timeline: vec![
            PrEvent { kind: "opened".to_string(), actor: Some("gildrb".to_string()), created_at: Some(now - 26 * 60 * MINUTE), text: "Opened the pull request".to_string() },
            PrEvent { kind: "reviewed".to_string(), actor: Some("reviewer".to_string()), created_at: Some(now - 90 * MINUTE), text: "Approved".to_string() },
        ],
        checks: vec![
            PrCheck { name: "clippy (linux)".to_string(), state: "success".to_string(), url: None },
            PrCheck { name: "smoke (xvfb)".to_string(), state: "success".to_string(), url: None },
            PrCheck { name: "snapshot diff".to_string(), state: "pending".to_string(), url: None },
        ],
    }
}

fn agents() -> Vec<local_studio_core::Item> {
    let now = format::now_ms();
    [
        (
            40,
            "Explore the eukhe client API for device control",
            ToolState::Succeeded,
            "Found list/boot/shutdown on the workspace; devices come from xcrun simctl and adb.",
            Some(now - 3 * MINUTE),
        ),
        (41, "Write the Files surface", ToolState::Running, "", None),
        (
            42,
            "Check WebKitGTK in nixpkgs",
            ToolState::Failed,
            "webkitgtk_4_1 only links GTK 3; use webkitgtk_6_0.",
            Some(now - MINUTE),
        ),
    ]
    .into_iter()
    .map(|(id, summary, state, output, ended)| {
        item(
            id,
            4,
            2,
            ItemKind::Tool {
                call_id: format!("agent-{id}"),
                name: "agent".to_string(),
                kind: ToolKind::Agent,
                summary: summary.to_string(),
                arguments: String::new(),
                state,
                output: output.to_string(),
                file_change: None,
                started_at: Some(now - 6 * MINUTE),
                ended_at: ended,
            },
        )
    })
    .collect()
}

fn devices() -> Vec<Device> {
    [
        ("pixel-8", "Pixel 8 API 35", DevicePlatform::AndroidEmulator, "running", Some("Android 15")),
        ("tablet", "Pixel Tablet API 34", DevicePlatform::AndroidEmulator, "shutdown", Some("Android 14")),
        ("serial-1", "Pixel 7 (USB)", DevicePlatform::AndroidDevice, "device", None),
    ]
    .into_iter()
    .map(|(id, name, platform, state, runtime)| Device {
        id: id.to_string(),
        name: name.to_string(),
        platform,
        state: state.to_string(),
        runtime: runtime.map(str::to_string),
    })
    .collect()
}

const BROWSER: &str = "<html><body style='margin:0;font-family:sans-serif;background:#0a0a0a;color:#ececec'><div style='padding:28px'><div style='font-size:12px;opacity:.6'>localhost:5173</div><h1 style='font-size:22px;margin:10px 0'>Fleet dashboard</h1><div style='display:flex;gap:10px'><div style='flex:1;background:#111;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px'><div style='opacity:.6;font-size:12px'>Tokens today</div><div style='font-size:22px;font-weight:600'>3.4M</div></div><div style='flex:1;background:#111;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px'><div style='opacity:.6;font-size:12px'>Requests</div><div style='font-size:22px;font-weight:600'>20.7k</div></div></div><div style='margin-top:14px;height:120px;border-radius:12px;background:linear-gradient(90deg,#346bf1 0 12%,transparent 12% 16%,#346bf1 16% 40%,transparent 40% 44%,#346bf1 44% 70%,transparent 70% 74%,#346bf1 74% 100%);opacity:.85'></div></div></body></html>";

fn project_hits() -> Vec<SearchHit> {
    [
        ("core/src/threads.rs", 88, "Shelf::Pinned => rows.sort_by_key(|row| row.pin_order),"),
        ("core/src/threads.rs", 91, "Shelf::Snoozed if row.snoozed_until > now => Shelf::Snoozed,"),
        ("linux/src/sidebar.rs", 402, "(Shelf::Pinned, \"\"),"),
        ("linux/src/sidebar.rs", 406, "(Shelf::Settled, \"Settled\"),"),
        ("macos/Sources/Features/Sidebar/SidebarRows.swift", 57, "case .pinned: PinnedRow(row: row)"),
    ]
    .into_iter()
    .map(|(relative, line, preview)| SearchHit {
        relative: relative.to_string(),
        line: Some(line),
        preview: preview.to_string(),
    })
    .collect()
}
