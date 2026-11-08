use std::cell::Cell;
use std::path::PathBuf;
use std::rc::Rc;
use std::time::Duration;

use adw::prelude::*;
use gtk::glib;
use local_studio_core::{ApprovalAnswer, Block, Connection, ItemKind, ModelKey, ToolState};

use crate::app::App;

const PROMPT: &str = "Use the bash tool to run exactly this command once: `echo smoke-ok > smoke.txt && cat smoke.txt`. Then reply with only the word done.";
const MARK: &str = "smoke-ok";
const PROVIDER: &str = "anthropic";
const MODEL: &str = "claude-haiku-5-5";
const THINKING: &str = "low";
const TIMEOUT: Duration = Duration::from_secs(300);
const TERMINAL_MARK: &str = "smoke-term";
const STUB_KEY: &str = "smoke-key";
const STUB_NAME: &str = "Smoke Stub";
const FOLLOW_UP: &str = "Smoke follow-up: without using any tools, reply with only the word again.";
const REJECTED: &str = "smoke rejected send";
const MISSING: &str = "smoke-missing-thread";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Connecting,
    Project,
    Opening,
    Replying,
    FollowUp,
    Rejected,
    Workspace,
    Terminal,
    Typing,
    Chat,
    Endpoint,
    Discovering,
    Adding,
    Removing,
    Keys,
    Finished,
}

pub fn start(app: &Rc<App>, failed: Rc<Cell<bool>>) {
    let phase = Rc::new(Cell::new(Phase::Connecting));
    let project = std::env::var_os("HOME").map_or_else(std::env::temp_dir, PathBuf::from).join("smoke-project");
    if let Err(error) = std::fs::create_dir_all(&project) {
        finish(app, &phase, &failed, false, &format!("create {}: {error}", project.display()));
        return;
    }
    let project = project.to_string_lossy().into_owned();
    drive(app, phase, failed, move |app, phase, failed| advance(app, phase, failed, &project));
}

pub fn start_providers(app: &Rc<App>, failed: Rc<Cell<bool>>) {
    let phase = Rc::new(Cell::new(Phase::Endpoint));
    let base = std::env::var("LS_SMOKE_PROVIDER").unwrap_or_default();
    if base.is_empty() {
        finish(app, &phase, &failed, false, "set LS_SMOKE_PROVIDER to the provider_stub endpoint");
        return;
    }
    drive(app, phase, failed, move |app, phase, failed| providers(app, phase, failed, &base));
}

fn drive(
    app: &Rc<App>,
    phase: Rc<Cell<Phase>>,
    failed: Rc<Cell<bool>>,
    step: impl Fn(&Rc<App>, &Rc<Cell<Phase>>, &Rc<Cell<bool>>) + 'static,
) {
    let step = Rc::new(step);
    let (tick_phase, tick_failed, tick_step) = (Rc::clone(&phase), Rc::clone(&failed), Rc::clone(&step));
    app.on_tick.replace(Some(Rc::new(move |app: &Rc<App>| {
        tick_step(app, &tick_phase, &tick_failed);
    })));
    let (poll_phase, poll_failed, poll_app) = (Rc::clone(&phase), Rc::clone(&failed), Rc::downgrade(app));
    glib::timeout_add_local(Duration::from_millis(250), move || {
        let Some(app) = poll_app.upgrade() else { return glib::ControlFlow::Break };
        if poll_phase.get() == Phase::Finished {
            return glib::ControlFlow::Break;
        }
        if matches!(
            poll_phase.get(),
            Phase::Endpoint | Phase::Discovering | Phase::Adding | Phase::Removing | Phase::Keys
        ) {
            step(&app, &poll_phase, &poll_failed);
        }
        glib::ControlFlow::Continue
    });
    let weak = Rc::downgrade(app);
    glib::timeout_add_local_once(TIMEOUT, move || {
        let Some(app) = weak.upgrade() else { return };
        if phase.get() != Phase::Finished {
            let detail = format!("timed out while {:?}", phase.get());
            finish(&app, &phase, &failed, false, &detail);
        }
    });
}

fn advance(app: &Rc<App>, phase: &Rc<Cell<Phase>>, failed: &Rc<Cell<bool>>, project: &str) {
    match phase.get() {
        Phase::Connecting => {
            if let Some(Connection::Lost { reason }) = &app.state.borrow().connection {
                println!("     connection lost: {reason}");
            }
            if !matches!(app.state.borrow().connection, Some(Connection::Ready)) {
                return;
            }
            println!("ok   connected to the Eukhe daemon");
            phase.set(Phase::Project);
            app.core.run(|studio| studio.add_project(project.to_string()));
        }
        Phase::Project => {
            let first = app.state.borrow().projects.first().map(|project| project.id.clone());
            let Some(first) = first else { return };
            println!("ok   project added in the sidebar: {first}");
            phase.set(Phase::Opening);
            app.new_thread(Some(first));
            {
                let mut state = app.state.borrow_mut();
                state.draft_settings.model =
                    Some(ModelKey { provider: PROVIDER.to_string(), model: MODEL.to_string() });
                state.draft_settings.thinking = Some(THINKING.to_string());
            }
            println!("     real model {PROVIDER}/{MODEL} thinking {THINKING}");
            app.composer.set_text(PROMPT);
            app.composer.submit(app);
        }
        Phase::Opening => {
            if app.state.borrow().selected.is_none() {
                return;
            }
            println!("ok   draft promoted to a thread and focused");
            phase.set(Phase::Replying);
        }
        Phase::Replying => {
            let pending = {
                let state = app.state.borrow();
                state.selected.clone().zip(state.approvals.first().map(|approval| approval.request_id.clone()))
            };
            if let Some((thread, request)) = pending {
                println!("ok   approval shown in the composer; approving");
                app.core.run(|studio| studio.answer_approval(thread, request, ApprovalAnswer::Approve));
                return;
            }
            let busy = app.state.borrow().info.as_ref().is_none_or(|info| info.busy);
            let items = app.timeline.items().clone();
            let answered = items.last().is_some_and(|item| {
                matches!(&item.kind, ItemKind::Assistant { blocks, streaming: false, .. }
                    if blocks.iter().any(|block| matches!(block, Block::Text { text } if !text.trim().is_empty())))
            });
            if busy || !answered {
                return;
            }
            for item in &items {
                println!("     item {:?}", item.kind);
            }
            if let Err(problem) = verify_turn(app, &items, project) {
                finish(app, phase, failed, false, &problem);
                return;
            }
            println!(
                "ok   real bash call wrote smoke.txt and the streamed reply rendered ({} transcript items)",
                items.len()
            );
            app.composer.set_text(FOLLOW_UP);
            app.composer.submit(app);
            if !app.timeline.local_texts().iter().any(|text| text == FOLLOW_UP) {
                finish(app, phase, failed, false, "the follow-up was not drawn when it was sent");
                return;
            }
            println!("ok   follow-up bubble drawn the moment it was sent");
            phase.set(Phase::FollowUp);
        }
        Phase::FollowUp | Phase::Rejected => follow_up(app, phase, failed, project),
        Phase::Workspace => {
            let mention = app.composer.extras.suggestions().iter().any(|item| item == "@notes.md");
            let file = app.panel.files.names().iter().any(|name| name == "notes.md");
            let hits = app.sidebar.hit_count() > 0;
            if mention && file && hits {
                println!("ok   @ mention, Files surface and thread search answered through the core");
                phase.set(Phase::Terminal);
                app.drawer.add(app, crate::drawer::Layout::SideBySide);
            }
        }
        Phase::Terminal | Phase::Typing | Phase::Chat => terminal(app, phase),
        Phase::Keys => keys(app, phase, failed),
        Phase::Endpoint | Phase::Discovering | Phase::Adding | Phase::Removing | Phase::Finished => {}
    }
}

fn follow_up(app: &Rc<App>, phase: &Rc<Cell<Phase>>, failed: &Rc<Cell<bool>>, project: &str) {
    match phase.get() {
        Phase::FollowUp => {
            let pending = {
                let state = app.state.borrow();
                state.selected.clone().zip(state.approvals.first().map(|approval| approval.request_id.clone()))
            };
            if let Some((thread, request)) = pending {
                app.core.run(|studio| studio.answer_approval(thread, request, ApprovalAnswer::Approve));
                return;
            }
            let busy = app.state.borrow().info.as_ref().is_none_or(|info| info.busy);
            if busy || !app.timeline.local_texts().is_empty() || app.timeline.user_count(FOLLOW_UP) != 1 {
                return;
            }
            let items = app.timeline.items().clone();
            let asked = items
                .iter()
                .rposition(|item| matches!(&item.kind, ItemKind::User { text, .. } if text.trim() == FOLLOW_UP));
            let replied = asked.is_some_and(|asked| {
                items[asked..].iter().any(|item| {
                    matches!(&item.kind, ItemKind::Assistant { blocks, streaming: false, .. }
                        if blocks.iter().any(|block| matches!(block, Block::Text { text } if !text.trim().is_empty())))
                })
            });
            if !replied {
                return;
            }
            println!(
                "ok   the local bubble gave way to the core's user item and the real model answered the follow-up"
            );
            app.state.borrow_mut().selected = Some(MISSING.to_string());
            app.composer.set_text(REJECTED);
            app.composer.submit(app);
            if !app.timeline.local_texts().iter().any(|text| text == REJECTED) {
                finish(app, phase, failed, false, "the rejected send was not drawn when it was sent");
                return;
            }
            phase.set(Phase::Rejected);
        }
        Phase::Rejected => {
            if !app.state.borrow().pending.is_empty() {
                return;
            }
            let restored = app.composer.text() == REJECTED && app.timeline.local_texts().is_empty();
            if !restored {
                finish(app, phase, failed, false, "a rejected send did not remove its bubble and restore the composer");
                return;
            }
            println!("ok   a rejected send removed its bubble and returned the text to the composer");
            app.composer.set_text("");
            let thread = app.state.borrow().threads.first().map(|row| row.id.clone());
            app.select_thread(thread);
            if let Err(error) = std::fs::write(std::path::Path::new(project).join("notes.md"), "smoke notes\n") {
                finish(app, phase, failed, false, &format!("write notes.md: {error}"));
                return;
            }
            phase.set(Phase::Workspace);
            app.composer.type_text(app, "look at @notes");
            app.panel.show("files");
            app.sidebar.search_text("smoke");
        }
        _ => {}
    }
}

fn verify_turn(app: &Rc<App>, items: &[local_studio_core::Item], project: &str) -> Result<(), String> {
    let state = app.state.borrow();
    if !state.threads.iter().any(|row| Some(&row.id) == state.selected.as_ref()) {
        return Err("the thread is missing from the sidebar inbox".to_string());
    }
    let tool = items.iter().any(|item| {
        matches!(&item.kind, ItemKind::Tool { state: ToolState::Succeeded, output, .. } if output.contains(MARK))
    });
    let written = std::fs::read_to_string(std::path::Path::new(project).join("smoke.txt")).unwrap_or_default();
    if !tool || written.trim() != MARK {
        return Err("the turn finished without a real bash call writing smoke.txt".to_string());
    }
    let model = state.info.as_ref().and_then(|info| info.model.clone());
    if !model.as_ref().is_some_and(|model| model.provider == PROVIDER && model.id == MODEL) {
        return Err(format!("the thread ran on {model:?}, not {PROVIDER}/{MODEL}"));
    }
    Ok(())
}

fn terminal(app: &Rc<App>, phase: &Rc<Cell<Phase>>) {
    let expected = format!("{TERMINAL_MARK}-42");
    match phase.get() {
        Phase::Terminal => {
            if app.drawer.focused_text().trim().is_empty() {
                return;
            }
            println!("ok   terminal opened and rendered a prompt");
            phase.set(Phase::Typing);
            app.drawer.type_text(app, &format!("echo {TERMINAL_MARK}-$((40 + 2))"));
        }
        Phase::Typing => {
            if !app.drawer.focused_text().lines().any(|line| line.trim() == expected) {
                return;
            }
            println!("ok   keys reached the shell through the core encoder and the output came back as frames");
            phase.set(Phase::Chat);
            app.drawer.add_focused_to_chat(app);
        }
        Phase::Chat if app.composer.extras.context_texts().iter().any(|text| text.contains(&expected)) => {
            println!("ok   Add to Chat put the recent terminal output in the composer");
            phase.set(Phase::Keys);
        }
        _ => {}
    }
}

fn providers(app: &Rc<App>, phase: &Rc<Cell<Phase>>, failed: &Rc<Cell<bool>>, base: &str) {
    let stub = |state: &crate::state::State| {
        state.providers.iter().find(|provider| provider.name == STUB_NAME).map(|provider| provider.id.clone())
    };
    match phase.get() {
        Phase::Endpoint => {
            let ready = {
                let state = app.state.borrow();
                matches!(state.connection, Some(Connection::Ready)) && state.providers_loaded
            };
            if !ready {
                return;
            }
            println!("ok   connected to the Eukhe daemon and loaded providers");
            phase.set(Phase::Discovering);
            crate::providers::open_dialog_discover(app, base, STUB_KEY);
        }
        Phase::Discovering => {
            let Some((models, ready)) = crate::providers::dialog_state() else {
                finish(app, phase, failed, false, "the endpoint dialog closed before discovery");
                return;
            };
            if models == 0 || !ready {
                return;
            }
            println!("ok   Test Connection discovered {models} models from the stub endpoint");
            phase.set(Phase::Adding);
            crate::providers::dialog_save(app);
        }
        Phase::Adding => {
            let added = stub(&app.state.borrow());
            let Some(id) = added.filter(|_| crate::providers::dialog_state().is_none()) else { return };
            let models =
                app.state.borrow().providers.iter().find(|provider| provider.id == id).map_or(0, |p| p.model_count);
            println!("ok   endpoint added through the dialog ({models} models) and listed as a custom provider");
            phase.set(Phase::Removing);
            crate::providers::remove(app, &id);
        }
        Phase::Removing => {
            if stub(&app.state.borrow()).is_some() {
                return;
            }
            finish(app, phase, failed, true, "custom endpoint discovered, added and removed through the dialog");
        }
        _ => {}
    }
}

fn keys(app: &Rc<App>, phase: &Rc<Cell<Phase>>, failed: &Rc<Cell<bool>>) {
    if WidgetExt::activate_action(&app.window, crate::keyboard::NEW_THREAD_HERE, None).is_err() {
        finish(app, phase, failed, false, "the Ctrl+T action is not installed");
        return;
    }
    let draft = {
        let state = app.state.borrow();
        state.selected.is_none() && state.draft_project.is_some()
    };
    if !draft {
        finish(app, phase, failed, false, "Ctrl+T did not open a new thread in the current project");
        return;
    }
    println!("ok   Ctrl+T opened a new thread in the current project");
    app.composer.set_text("alpha beta gamma\nsecond line");
    let mut results = Vec::new();
    for keys in ["\u{1b}gg0dw", "dd", "u"] {
        crate::vim::vim_feed(app, keys);
        results.push(app.composer.text());
    }
    let expected = ["beta gamma\nsecond line", "second line", "beta gamma\nsecond line"];
    if results != expected {
        finish(app, phase, failed, false, &format!("vim produced {results:?} for dw, dd, u; expected {expected:?}"));
        return;
    }
    let mode = app.composer.vim.mode();
    println!("ok   vim composer edits (dw, dd, u), ending in {mode:?} mode");
    app.composer.set_text("");
    finish(app, phase, failed, true, "inbox, timeline, composer, workspace, terminal and keyboard exercised");
}

fn finish(app: &Rc<App>, phase: &Rc<Cell<Phase>>, failed: &Rc<Cell<bool>>, passed: bool, detail: &str) {
    phase.set(Phase::Finished);
    failed.set(!passed);
    println!("{} linux smoke: {detail}", if passed { "PASS" } else { "FAIL" });
    app.on_tick.replace(None);
    app.application.quit();
}
