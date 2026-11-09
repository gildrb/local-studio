use std::rc::Rc;

use adw::prelude::*;
use local_studio_core::{
    Goal, ModelKey, ProjectScript, ProjectSettings, Settings, SkillEntry, SkillSource, Subagent, Update,
};

use crate::app::App;
use crate::fixtures::{base, conversation, project_id, FOCUSED};
use crate::format;

const MINUTE: i64 = 60_000;

#[allow(clippy::too_many_lines)]
pub fn stage(app: &Rc<App>, scene: &str) {
    match scene {
        "39-subagents-panel" => {
            conversation(app, true);
            app.apply(vec![Update::Subagents { thread: FOCUSED.to_string(), agents: subagents() }]);
            app.panel.show("agents");
        }
        "40-goal-fast-mode" => {
            conversation(app, false);
            let info = app.state.borrow().info.clone();
            if let Some(mut info) = info {
                info.service_tiers = vec!["auto".to_string(), "flex".to_string(), "priority".to_string()];
                info.service_tier = Some("priority".to_string());
                info.goal = Some(Goal {
                    objective: "Ship the Linux client with parity to macOS".to_string(),
                    status: "in progress".to_string(),
                    active: true,
                    tokens_used: 182_400,
                    token_budget: Some(500_000),
                    time_used_seconds: 2_460,
                });
                app.apply(vec![Update::Thread { thread: FOCUSED.to_string(), info }]);
            }
        }
        "41-fan-out-compare" => {
            app.apply(base());
            app.new_thread(Some(project_id("local-studio")));
            app.state.borrow_mut().draft_settings.compare = vec![
                ModelKey { provider: "openai".to_string(), model: "gpt-5-codex".to_string() },
                ModelKey { provider: "local".to_string(), model: "qwen3-coder-30b".to_string() },
            ];
            app.composer.set_text("Refactor the drawer so every split remembers its size");
            app.render(crate::app::Dirty::all());
        }
        "42-skills-trigger" => {
            conversation(app, false);
            app.composer.type_text(app, "Use $re");
            app.composer.extras.skills_loaded(&skills());
        }
        "43-project-defaults" => {
            app.apply(base());
            app.apply(project_updates());
            crate::project::present(app, &project_id("local-studio"));
            crate::project::show_page("defaults");
        }
        "44-project-scripts" => {
            app.apply(base());
            app.apply(project_updates());
            crate::project::present(app, &project_id("local-studio"));
            crate::project::show_page("scripts");
        }
        "45-clone-repository" => {
            app.apply(base());
            gtk::prelude::WidgetExt::activate_action(&app.window, "win.clone-project", None).ok();
        }
        "46-storage-settings" => {
            app.apply(base());
            app.open_settings(Some("storage"));
        }
        "47-banners-wide-sidebar" => {
            conversation(app, false);
            app.split.set_min_sidebar_width(360.0);
            app.split.set_max_sidebar_width(360.0);
            app.apply(vec![Update::Providers {
                providers: vec![crate::fixtures::provider(
                    "anthropic",
                    "Anthropic",
                    local_studio_core::ProviderKind::BuiltIn,
                    local_studio_core::ProviderCredential::Missing,
                    4,
                )],
                engines: Vec::new(),
                errors: Vec::new(),
            }]);
            app.show_notice("git push failed: the remote rejected the update (non-fast-forward).");
        }
        "48-snooze-custom" => {
            app.apply(base());
            gtk::prelude::WidgetExt::activate_action(
                &app.window,
                "win.thread-snooze-custom",
                Some(&FOCUSED.to_variant()),
            )
            .ok();
        }
        "49-commit-dialog" => {
            conversation(app, false);
            crate::commit::present(app);
            crate::commit::files_loaded(&crate::fixtures::diff_files_public());
        }
        "50-review-comment" => {
            conversation(app, false);
            app.panel.show("diff");
            app.panel.diff.set_fixture(&crate::fixtures::diff_files_public(), false);
            app.composer.extras.add_context(
                "Review comment on linux/src/theme.rs",
                "+.ls-thread.selected { background: alpha(var(--accent-bg-color), 0.16); }\n\nUse the hairline token here too.",
            );
        }
        "52-theme-gildrb" => gildrb(app, local_studio_core::ColorScheme::Dark),
        "53-theme-gildrb-light" => gildrb(app, local_studio_core::ColorScheme::Light),
        "54-gildrb-file-preview-light" => {
            gildrb(app, local_studio_core::ColorScheme::Light);
            app.drawer.reset();
            app.panel.show("files");
            app.panel.files.preview(
                "linux/src/branches.rs",
                &local_studio_core::FileContent::Text {
                    text: crate::scenes::preview_sample(),
                    language: Some("rust".to_string()),
                },
            );
        }
        "55-gildrb-diff-split" => {
            gildrb(app, local_studio_core::ColorScheme::Dark);
            app.drawer.reset();
            app.panel.diff.set_fixture(&crate::fixtures::diff_files_public(), true);
            app.set_panel_maximized(true);
        }
        "51-palette-grouped" => {
            conversation(app, false);
            crate::palette::open(app);
        }
        "56-follow-up-bubble" | "57-follow-up-sending" => {
            let live = scene == "57-follow-up-sending";
            conversation(app, live);
            let text = "Also add a test for the shelf headers.".to_string();
            let pending = crate::state::PendingSend {
                request: "fixture-send".to_string(),
                thread: FOCUSED.to_string(),
                baseline: app.timeline.user_count(&text),
                queue_baseline: 0,
                draft: text.clone(),
                text,
                images: 0,
                queued: live,
            };
            app.state.borrow_mut().pending.push(pending);
            app.render_pending();
            app.render(crate::app::Dirty { composer: true, ..crate::app::Dirty::default() });
        }
        "59-kernel-banner" => {
            conversation(app, false);
            app.panel.show("diff");
            app.panel.diff.set_fixture(&crate::fixtures::diff_files_public(), false);
            let message = "uv could not download Python (network unreachable)".to_string();
            app.banners.render_kernel(Some(&local_studio_core::KernelState::Failed { message }), true);
        }
        _ => crate::scenes_providers::stage(app, scene),
    }
}

fn gildrb(app: &Rc<App>, scheme: local_studio_core::ColorScheme) {
    conversation(app, false);
    let settings = Settings {
        theme: Some(crate::colors::GILDRB.to_string()),
        color_scheme: scheme,
        ..app.state.borrow().settings.clone()
    };
    app.apply(vec![Update::Settings { settings }]);
    app.panel.show("diff");
    app.panel.diff.set_fixture(&crate::fixtures::diff_files_public(), false);
    app.drawer.fixture(
        &["\x1b[38;5;3m~/code/local-studio\x1b[0m on \x1b[35m linux/gtk\x1b[0m\r\n\x1b[1m❯\x1b[0m cargo test\r\n   \x1b[32mCompiling\x1b[0m local-studio-gtk v0.1.0\r\n\x1b[31merror\x1b[0m: 1 warning treated as error\r\n\x1b[33mwarning\x1b[0m: unused import\r\n\x1b[36minfo\x1b[0m: retrying with \x1b[34m--offline\x1b[0m\r\n\x1b[1m❯\x1b[0m "],
        crate::drawer::Layout::Stacked,
    );
}

pub fn reset(app: &App) {
    app.split.set_min_sidebar_width(288.0);
    app.split.set_max_sidebar_width(288.0);
    app.banners.notice.set_revealed(false);
    app.banners.provider.set_revealed(false);
    app.banners.kernel.set_revealed(false);
}

fn subagents() -> Vec<Subagent> {
    let now = format::now_ms();
    let agent = |id: &str, title: &str, running: bool, minutes: i64, tokens: u64| Subagent {
        id: id.to_string(),
        title: title.to_string(),
        status: if running { "running".to_string() } else { "completed".to_string() },
        running,
        started_at: Some(now - minutes * MINUTE),
        duration_ms: (!running).then_some(u64::try_from(minutes * MINUTE).unwrap_or(0)),
        tokens,
        current_tool: running.then(|| "read".to_string()),
        note: None,
        model: Some("claude-sonnet-4-5".to_string()),
        answer: (!running).then(|| "The drawer keeps one VTE per pane; splits are nested GtkPaned.".to_string()),
    };
    vec![
        agent("a-1", "Map the terminal drawer code", false, 4, 18_200),
        agent("a-2", "Audit the theme CSS for contrast", true, 2, 9_400),
        agent("a-3", "Find every keybinding without a handler", true, 1, 3_100),
    ]
}

fn skills() -> Vec<SkillEntry> {
    [
        ("release-notes", "Draft release notes from merged pull requests", SkillSource::Repo),
        ("refactor", "Plan and apply a refactor in small commits", SkillSource::Personal),
        ("review", "Review the latest diff for bugs and style", SkillSource::App),
        ("requirements", "Turn a request into a checklist", SkillSource::System),
    ]
    .into_iter()
    .map(|(name, description, source)| SkillEntry {
        name: name.to_string(),
        description: description.to_string(),
        source,
        path: format!("~/.agents/skills/{name}/SKILL.md"),
    })
    .collect()
}

fn project_updates() -> Vec<Update> {
    let project = project_id("local-studio");
    let script = |id: &str, name: &str, command: &str, keys: Option<&str>, setup: bool| ProjectScript {
        id: id.to_string(),
        name: name.to_string(),
        command: command.to_string(),
        icon: None,
        keybinding: keys.map(str::to_string),
        run_on_worktree_setup: setup,
        wait_for_setup: setup,
    };
    let settings = ProjectSettings {
        default_provider: Some("openai".to_string()),
        default_model: Some("gpt-5-codex".to_string()),
        default_thinking_level: Some("high".to_string()),
        default_access: None,
        new_thread_workspace: Some(local_studio_core::NewThreadWorkspace::Worktree),
        new_worktrees_start_from_origin: None,
    };
    vec![
        Update::ProjectScripts {
            project: project.clone(),
            scripts: vec![
                script("install", "Install", "bun install", None, true),
                script("dev", "Dev server", "bun run dev", Some("ctrl+shift+r"), false),
                script("check", "Check", "cargo clippy --workspace -- -D warnings", None, false),
            ],
        },
        Update::ProjectSettings { project, settings, effective: Settings::default() },
    ]
}
