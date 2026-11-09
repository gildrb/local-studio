use std::cell::{Cell, RefCell};
use std::path::PathBuf;
use std::rc::Rc;
use std::time::Duration;

use adw::prelude::*;
use gtk::glib;
use local_studio_core::{ApprovalAnswer, Block, Connection, ItemKind, KernelState, ModelKey, NoticeLevel, ToolState};

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
const KERNEL_PROMPT: &str =
    "List the files here and count them with Python: use the ipython tool once, then reply with only the count.";
const KERNEL_TIMEOUT: Duration = Duration::from_mins(15);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Kernel,
    Retry,
    Reinstalling,
    Retried,
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
    drive(app, phase, failed, TIMEOUT, move |app, phase, failed| advance(app, phase, failed, &project));
}

pub fn start_providers(app: &Rc<App>, failed: Rc<Cell<bool>>) {
    let phase = Rc::new(Cell::new(Phase::Endpoint));
    let base = std::env::var("LS_SMOKE_PROVIDER").unwrap_or_default();
    if base.is_empty() {
        finish(app, &phase, &failed, false, "set LS_SMOKE_PROVIDER to the provider_stub endpoint");
        return;
    }
    drive(app, phase, failed, TIMEOUT, move |app, phase, failed| providers(app, phase, failed, &base));
}

fn kernel_project(app: &Rc<App>, phase: &Rc<Cell<Phase>>, failed: &Rc<Cell<bool>>) -> Option<String> {
    let project = std::env::var_os("HOME").map_or_else(std::env::temp_dir, PathBuf::from).join("kernel-smoke");
    let created = std::fs::create_dir_all(&project).and_then(|()| {
        ["alpha.txt", "beta.txt", "gamma.txt"].iter().try_for_each(|name| std::fs::write(project.join(name), name))
    });
    if let Err(error) = created {
        finish(app, phase, failed, false, &format!("create {}: {error}", project.display()));
        return None;
    }
    Some(project.to_string_lossy().into_owned())
}

pub fn start_kernel(app: &Rc<App>, failed: Rc<Cell<bool>>, expect_install: bool) {
    let phase = Rc::new(Cell::new(Phase::Kernel));
    let Some(project) = kernel_project(app, &phase, &failed) else { return };
    let installing = Cell::new(false);
    drive(app, phase, failed, KERNEL_TIMEOUT, move |app, phase, failed| {
        kernel(app, phase, failed, &project, expect_install, &installing);
    });
}

pub fn start_kernel_offline(app: &Rc<App>, failed: Rc<Cell<bool>>) {
    let phase = Rc::new(Cell::new(Phase::Kernel));
    let uv = std::env::var("LS_SMOKE_UV").unwrap_or_default();
    if uv.is_empty() {
        finish(app, &phase, &failed, false, "set LS_SMOKE_UV to a uv binary the smoke links in after the failure");
        return;
    }
    let Some(project) = kernel_project(app, &phase, &failed) else { return };
    let previous = RefCell::new(None);
    drive(app, phase, failed, KERNEL_TIMEOUT, move |app, phase, failed| {
        offline(app, phase, failed, &project, &uv, &previous);
    });
}

fn kernel(
    app: &Rc<App>,
    phase: &Rc<Cell<Phase>>,
    failed: &Rc<Cell<bool>>,
    project: &str,
    expect_install: bool,
    installing: &Cell<bool>,
) {
    let state = app.state.borrow().kernel.clone();
    if matches!(state, Some(KernelState::Installing { .. })) && !installing.get() {
        installing.set(true);
        println!("ok   kernel install started on launch");
    }
    match phase.get() {
        Phase::Kernel => {
            if !matches!(app.state.borrow().connection, Some(Connection::Ready)) {
                return;
            }
            match state {
                Some(KernelState::Failed { message }) => {
                    finish(app, phase, failed, false, &format!("the kernel install failed: {message}"));
                }
                Some(KernelState::Unavailable { reason }) => {
                    finish(app, phase, failed, false, &format!("the kernel is unavailable: {reason}"));
                }
                Some(KernelState::Installed { python }) => {
                    if installing.get() != expect_install {
                        let problem = if expect_install {
                            "the kernel was never installed on a launch without one"
                        } else {
                            "a launch with an installed kernel installed it again"
                        };
                        finish(app, phase, failed, false, problem);
                        return;
                    }
                    let how = if installing.get() { "installed by this launch" } else { "no install on this launch" };
                    println!("ok   kernel installed at {python} ({how})");
                    phase.set(Phase::Project);
                    app.core.run(|studio| studio.add_project(project.to_string()));
                }
                _ => {}
            }
        }
        Phase::Project => send_kernel_prompt(app, phase),
        Phase::Opening => {
            if app.state.borrow().selected.is_some() {
                phase.set(Phase::Replying);
            }
        }
        Phase::Replying => kernel_reply(app, phase, failed),
        _ => {}
    }
}

fn offline(
    app: &Rc<App>,
    phase: &Rc<Cell<Phase>>,
    failed: &Rc<Cell<bool>>,
    project: &str,
    uv: &str,
    previous: &RefCell<Option<String>>,
) {
    let state = app.state.borrow().kernel.clone();
    match phase.get() {
        Phase::Kernel => {
            if !matches!(app.state.borrow().connection, Some(Connection::Ready)) {
                return;
            }
            match state {
                Some(KernelState::Failed { message }) => {
                    println!("ok   the launch's auto-install failed without uv: {message}");
                    phase.set(Phase::Project);
                    app.core.run(|studio| studio.add_project(project.to_string()));
                }
                Some(KernelState::Installed { .. }) => {
                    finish(app, phase, failed, false, "the kernel installed although uv was unavailable");
                }
                _ => {}
            }
        }
        Phase::Retry | Phase::Reinstalling => match state {
            Some(KernelState::Installing { .. }) => phase.set(Phase::Reinstalling),
            Some(KernelState::Installed { python }) => {
                println!("ok   Retry installed the kernel at {python}");
                previous.replace(app.state.borrow().selected.clone());
                send_kernel_prompt(app, phase);
            }
            Some(KernelState::Failed { message }) if phase.get() == Phase::Reinstalling => {
                finish(app, phase, failed, false, &format!("Retry failed: {message}"));
            }
            _ => {}
        },
        Phase::Project => {
            previous.replace(app.state.borrow().selected.clone());
            send_kernel_prompt(app, phase);
        }
        Phase::Opening => {
            let selected = app.state.borrow().selected.clone();
            if selected.is_some() && selected != *previous.borrow() {
                phase.set(if previous.borrow().is_some() { Phase::Retried } else { Phase::Replying });
            }
        }
        Phase::Replying => {
            let Some(items) = turn_done(app) else { return };
            if items.iter().any(|item| matches!(&item.kind, ItemKind::Tool { name, .. } if name == "ipython")) {
                finish(app, phase, failed, false, "ipython was offered while the kernel could not start");
                return;
            }
            let notices = items
                .iter()
                .filter(|item| {
                    matches!(&item.kind, ItemKind::Notice { level: NoticeLevel::Warning, text }
                        if text.to_lowercase().contains("kernel"))
                })
                .count();
            if notices != 1 {
                finish(app, phase, failed, false, &format!("expected one kernel warning notice, found {notices}"));
                return;
            }
            println!("ok   one kernel warning notice row and no ipython call ({} transcript items)", items.len());
            let bin = std::env::var_os("HOME").map_or_else(std::env::temp_dir, PathBuf::from).join(".local/bin");
            let linked = std::fs::create_dir_all(&bin).and_then(|()| std::os::unix::fs::symlink(uv, bin.join("uv")));
            if let Err(error) = linked {
                finish(app, phase, failed, false, &format!("link uv into {}: {error}", bin.display()));
                return;
            }
            println!("     uv is now available; pressing Retry");
            phase.set(Phase::Retry);
            WidgetExt::activate_action(&app.window, "win.install-kernel", None).ok();
        }
        Phase::Retried => kernel_reply(app, phase, failed),
        _ => {}
    }
}

fn send_kernel_prompt(app: &Rc<App>, phase: &Rc<Cell<Phase>>) {
    let first = app.state.borrow().projects.first().map(|project| project.id.clone());
    let Some(first) = first else { return };
    phase.set(Phase::Opening);
    app.new_thread(Some(first));
    {
        let mut state = app.state.borrow_mut();
        state.draft_settings.model = Some(ModelKey { provider: PROVIDER.to_string(), model: MODEL.to_string() });
        state.draft_settings.thinking = Some(THINKING.to_string());
    }
    println!("     real model {PROVIDER}/{MODEL} thinking {THINKING}");
    app.composer.set_text(KERNEL_PROMPT);
    app.composer.submit(app);
}

fn turn_done(app: &Rc<App>) -> Option<Vec<local_studio_core::Item>> {
    let pending = {
        let state = app.state.borrow();
        state.selected.clone().zip(state.approvals.first().map(|approval| approval.request_id.clone()))
    };
    if let Some((thread, request)) = pending {
        println!("ok   approval shown in the composer; approving");
        app.core.run(|studio| studio.answer_approval(thread, request, ApprovalAnswer::Approve));
        return None;
    }
    let busy = app.state.borrow().info.as_ref().is_none_or(|info| info.busy);
    let items = app.timeline.items().clone();
    let answered = items.last().is_some_and(|item| {
        matches!(&item.kind, ItemKind::Assistant { blocks, streaming: false, .. }
            if blocks.iter().any(|block| matches!(block, Block::Text { text } if !text.trim().is_empty())))
    });
    if busy || !answered {
        return None;
    }
    for item in &items {
        println!("     item {:?}", item.kind);
    }
    Some(items)
}

fn kernel_reply(app: &Rc<App>, phase: &Rc<Cell<Phase>>, failed: &Rc<Cell<bool>>) {
    let Some(items) = turn_done(app) else { return };
    if items.iter().any(|item| format!("{:?}", item.kind).contains("kernel is not installed")) {
        finish(app, phase, failed, false, "the transcript reports the Python kernel as not installed");
        return;
    }
    let python = items.iter().any(
        |item| matches!(&item.kind, ItemKind::Tool { name, state: ToolState::Succeeded, .. } if name == "ipython"),
    );
    if !python {
        finish(app, phase, failed, false, "the turn finished without a succeeded ipython call");
        return;
    }
    finish(
        app,
        phase,
        failed,
        true,
        &format!("kernel: a real ipython call succeeded ({} transcript items)", items.len()),
    );
}

fn drive(
    app: &Rc<App>,
    phase: Rc<Cell<Phase>>,
    failed: Rc<Cell<bool>>,
    timeout: Duration,
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
    glib::timeout_add_local_once(timeout, move || {
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
        Phase::Endpoint
        | Phase::Discovering
        | Phase::Adding
        | Phase::Removing
        | Phase::Kernel
        | Phase::Retry
        | Phase::Reinstalling
        | Phase::Retried
        | Phase::Finished => {}
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
