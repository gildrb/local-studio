use std::cell::Cell;
use std::path::PathBuf;
use std::rc::Rc;
use std::time::Duration;

use adw::prelude::*;
use gtk::glib;
use local_studio_core::{ApprovalAnswer, Block, Connection, ItemKind};

use crate::app::App;

const PROMPT: &str = "run the smoke command";
const TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Connecting,
    Project,
    Opening,
    Replying,
    Finished,
}

pub fn start(app: &Rc<App>, failed: Rc<Cell<bool>>) {
    let phase = Rc::new(Cell::new(Phase::Connecting));
    let project = std::env::var_os("HOME").map_or_else(std::env::temp_dir, PathBuf::from).join("smoke-project");
    if let Err(error) = std::fs::create_dir_all(&project) {
        finish(app, &phase, &failed, false, &format!("create {}: {error}", project.display()));
        return;
    }
    let tick_phase = Rc::clone(&phase);
    let tick_failed = Rc::clone(&failed);
    app.on_tick.replace(Some(Rc::new(move |app: &Rc<App>| {
        advance(app, &tick_phase, &tick_failed, &project.to_string_lossy());
    })));
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
            let sidebar_row =
                app.state.borrow().threads.iter().any(|row| Some(&row.id) == app.state.borrow().selected.as_ref());
            if !sidebar_row {
                finish(app, phase, failed, false, "the thread is missing from the sidebar inbox");
                return;
            }
            finish(app, phase, failed, true, &format!("{} transcript items rendered", items.len()));
        }
        Phase::Finished => {}
    }
}

fn finish(app: &Rc<App>, phase: &Rc<Cell<Phase>>, failed: &Rc<Cell<bool>>, passed: bool, detail: &str) {
    phase.set(Phase::Finished);
    failed.set(!passed);
    println!("{} linux smoke: {detail}", if passed { "PASS" } else { "FAIL" });
    app.on_tick.replace(None);
    app.application.quit();
}
