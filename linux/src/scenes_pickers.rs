use std::rc::Rc;

use adw::prelude::*;
use local_studio_core::{Branch, GitStatus, Update};

use crate::app::{App, Dirty};
use crate::fixtures::{base, conversation, project_id};

pub const SCENES: [&str; 5] = ["picker-access", "picker-thinking", "picker-branches", "picker-project", "picker-stash"];

pub fn stage(app: &Rc<App>, scene: &str) {
    match scene {
        "picker-access" => {
            conversation(app, false);
            app.composer.open_picker("access");
        }
        "picker-thinking" => {
            conversation(app, false);
            app.composer.open_picker("thinking");
        }
        "picker-branches" => branches(app),
        "picker-project" => {
            draft(app);
            app.hero.project.popup();
        }
        "picker-stash" => {
            conversation(app, false);
            app.composer.tools.set_fixture(&[
                "Refactor the drawer so splits remember their sizes",
                "Write the release notes for 0.5\n\n- drawer\n- launcher",
                "Check the GPU bars against the shared palette",
            ]);
            app.composer.tools.stash.popup();
        }
        _ => crate::dashboard_scenes::stage(app, scene),
    }
}

pub fn reset(app: &Rc<App>) {
    close(app.window.upcast_ref());
}

fn close(widget: &gtk::Widget) {
    let mut child = widget.first_child();
    while let Some(current) = child {
        if let Some(popover) = current.downcast_ref::<gtk::Popover>() {
            popover.popdown();
        }
        close(&current);
        child = current.next_sibling();
    }
}

fn draft(app: &Rc<App>) {
    app.apply(base());
    app.new_thread(Some(project_id("local-studio")));
    app.apply(vec![Update::GitStatus {
        project: project_id("local-studio"),
        status: GitStatus {
            branch: Some("linux/gtk".to_string()),
            upstream: Some("origin/linux/gtk".to_string()),
            ahead: 0,
            behind: 0,
            dirty: false,
            default_branch: Some("main".to_string()),
            pull_request: None,
            is_repo: true,
            changed_files: 0,
            has_remote: true,
        },
    }]);
    app.composer.set_text("");
}

fn branches(app: &Rc<App>) {
    draft(app);
    app.branches.preset(true, None);
    app.render(Dirty::all());
    app.branches.open_branch();
    let branch = |name: &str, current: bool, remote: bool, worktree: Option<&str>| Branch {
        name: name.to_string(),
        remote,
        current,
        worktree: worktree.map(str::to_string),
    };
    app.branches.loaded(
        &[
            branch("linux/gtk", true, false, None),
            branch("main", false, false, None),
            branch("feat/gtk-panels", false, false, Some("/home/gil/code/local-studio-worktrees/gtk-panels")),
            branch("swift/k", false, false, None),
            branch("origin/main", false, true, None),
            branch("origin/linux/gtk", false, true, None),
        ],
        24,
    );
}
