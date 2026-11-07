use std::cell::RefCell;
use std::rc::Rc;

use adw::prelude::*;
use local_studio_core::{DiffScope, FileDiff};

use crate::app::{App, Target};
use crate::format;

struct Open {
    list: gtk::ListBox,
    summary: gtk::Label,
    commit: gtk::Button,
}

thread_local! {
    static OPEN: RefCell<Option<Open>> = const { RefCell::new(None) };
}

pub fn present(app: &Rc<App>) {
    let Some(dir) = app.state.borrow().workspace_dir() else { return };
    let branch = app.state.borrow().git.get(&dir).and_then(|status| status.branch.clone()).unwrap_or_default();
    let dialog = adw::Dialog::builder().title("Commit Changes").content_width(560).content_height(520).build();
    let message = gtk::TextView::builder()
        .wrap_mode(gtk::WrapMode::WordChar)
        .top_margin(8)
        .bottom_margin(8)
        .left_margin(8)
        .right_margin(8)
        .build();
    message.add_css_class("ls-commit-message");
    let message_box = gtk::ScrolledWindow::builder().min_content_height(88).child(&message).build();
    message_box.add_css_class("ls-commit-box");
    let hint = gtk::Label::new(Some("Leave empty to generate a message from the changes and your writing style."));
    hint.add_css_class("ls-meta");
    hint.set_xalign(0.0);
    hint.set_wrap(true);
    let summary = gtk::Label::new(Some("Loading changes…"));
    summary.add_css_class("heading");
    summary.set_xalign(0.0);
    let list = gtk::ListBox::new();
    list.add_css_class("boxed-list");
    list.set_selection_mode(gtk::SelectionMode::None);
    let files =
        gtk::ScrolledWindow::builder().vexpand(true).hscrollbar_policy(gtk::PolicyType::Never).child(&list).build();
    let note = gtk::Label::new(Some("Every change in the working tree is staged (git add -A)."));
    note.add_css_class("ls-meta");
    note.set_xalign(0.0);
    let column = gtk::Box::new(gtk::Orientation::Vertical, 10);
    column.set_margin_top(12);
    column.set_margin_bottom(12);
    column.set_margin_start(16);
    column.set_margin_end(16);
    column.append(&message_box);
    column.append(&hint);
    column.append(&summary);
    column.append(&files);
    column.append(&note);
    let header = adw::HeaderBar::new();
    let commit =
        gtk::Button::with_label(&if branch.is_empty() { "Commit".to_string() } else { format!("Commit to {branch}") });
    commit.add_css_class("suggested-action");
    commit.set_sensitive(false);
    header.pack_end(&commit);
    let view = adw::ToolbarView::new();
    view.add_top_bar(&header);
    view.set_content(Some(&column));
    dialog.set_child(Some(&view));
    let (weak, closing) = (Rc::downgrade(app), dialog.clone());
    commit.connect_clicked(move |_| {
        let Some(app) = weak.upgrade() else { return };
        let buffer = message.buffer();
        let text = buffer.text(&buffer.start_iter(), &buffer.end_iter(), false).trim().to_string();
        let (request, dir) = (app.core.request(), dir.clone());
        app.toast("Committing…");
        app.core.run(|studio| studio.commit(request, dir, Some(text).filter(|text| !text.is_empty())));
        closing.close();
    });
    OPEN.with(|slot| slot.replace(Some(Open { list, summary, commit })));
    dialog.connect_closed(|_| {
        OPEN.with(|slot| slot.replace(None));
    });
    let dir = app.state.borrow().workspace_dir();
    if let Some(dir) = dir {
        let request = app.ask(Target::CommitFiles);
        app.core.run(|studio| studio.load_diff(request, dir, DiffScope::WorkingTree));
    }
    dialog.present(Some(&app.window));
}

pub fn files_loaded(files: &[FileDiff]) {
    OPEN.with(|slot| {
        let slot = slot.borrow();
        let Some(open) = slot.as_ref() else { return };
        open.list.remove_all();
        let (additions, deletions) =
            files.iter().fold((0, 0), |(add, del), file| (add + file.additions, del + file.deletions));
        open.summary.set_label(&match files.len() {
            0 => "No changes to commit".to_string(),
            1 => format!("1 file changed · +{additions} −{deletions}"),
            count => format!("{count} files changed · +{additions} −{deletions}"),
        });
        open.commit.set_sensitive(!files.is_empty());
        for file in files {
            let row = adw::ActionRow::builder()
                .title(format::escape(&file.path))
                .subtitle(format::escape(&format::capitalize(&file.status)))
                .build();
            let stats = gtk::Box::new(gtk::Orientation::Horizontal, 6);
            stats.set_valign(gtk::Align::Center);
            let add = gtk::Label::new(Some(&format!("+{}", file.additions)));
            add.add_css_class("ls-add");
            let del = gtk::Label::new(Some(&format!("−{}", file.deletions)));
            del.add_css_class("ls-del");
            stats.append(&add);
            stats.append(&del);
            row.add_suffix(&stats);
            open.list.append(&row);
        }
    });
}
