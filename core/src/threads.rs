use std::path::{Path, PathBuf};

use eukhe_client::saved_sessions::strip_signal_reply_rules;
use serde_json::Value;

use crate::model::{Project, Shelf, ThreadRow, ThreadStatus};
use crate::session::model_ref;
use crate::store::{StoredProject, ThreadFlags};

const DAY_MS: i64 = 86_400_000;
const TITLE_LIMIT: usize = 120;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SavedRow {
    pub(crate) id: String,
    pub(crate) path: String,
    pub(crate) cwd: String,
    pub(crate) title: Option<String>,
    pub(crate) modified: i64,
    pub(crate) provider: Option<String>,
    pub(crate) model: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RosterRow {
    pub(crate) session_id: String,
    pub(crate) active_session_id: Option<String>,
    pub(crate) session_file: Option<String>,
    pub(crate) cwd: String,
    pub(crate) title: Option<String>,
    pub(crate) provider: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) note: Option<String>,
    pub(crate) running: bool,
    pub(crate) failed: bool,
    pub(crate) updated_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct InboxPrefs {
    pub(crate) working_section: bool,
    pub(crate) auto_settle_inactive: bool,
    pub(crate) auto_settle_inactive_days: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct GitHead {
    pub(crate) branch: Option<String>,
    pub(crate) worktree: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct Facts {
    pub(crate) id: String,
    pub(crate) cwd: String,
    pub(crate) title: String,
    pub(crate) activity_at: i64,
    pub(crate) working: bool,
    pub(crate) run_started_at: Option<i64>,
    pub(crate) approval_since: Option<i64>,
    pub(crate) failed_at: Option<i64>,
    pub(crate) provider: Option<String>,
    pub(crate) model: Option<String>,
    pub(crate) note: Option<String>,
}

pub(crate) fn saved_rows(data: &Value) -> Vec<SavedRow> {
    let Some(rows) = data.get("sessions").and_then(Value::as_array) else { return Vec::new() };
    rows.iter()
        .filter(|row| {
            row.get("rlmDepth").and_then(Value::as_u64).unwrap_or(0) == 0
                && row.get("parentSessionPath").is_none_or(Value::is_null)
        })
        .filter_map(|row| {
            let text = |key: &str| row.get(key).and_then(Value::as_str);
            let model = row.get("model").and_then(model_ref);
            let title = text("name").filter(|name| !name.trim().is_empty()).map(str::to_string).or_else(|| {
                text("firstMessage")
                    .map(strip_signal_reply_rules)
                    .filter(|first| !first.trim().is_empty())
                    .map(str::to_string)
            });
            Some(SavedRow {
                id: text("id")?.to_string(),
                path: text("path")?.to_string(),
                cwd: text("cwd").unwrap_or_default().to_string(),
                title,
                modified: text("modified").and_then(parse_rfc3339).unwrap_or(0),
                provider: model.as_ref().map(|model| model.provider.clone()).filter(|value| !value.is_empty()),
                model: model.map(|model| model.id),
            })
        })
        .collect()
}

pub(crate) fn roster_row(entry: &Value) -> Option<RosterRow> {
    let summary = entry.get("summary")?;
    let text = |key: &str| summary.get(key).and_then(Value::as_str).filter(|value| !value.is_empty());
    if text("runtimeKind") == Some("subagent")
        || summary.get("rlmDepth").and_then(Value::as_u64).unwrap_or(0) > 0
        || text("parentSessionPath").is_some()
    {
        return None;
    }
    let model = summary.get("model").and_then(model_ref);
    let status = entry.get("status").and_then(Value::as_str).unwrap_or_default();
    let label = entry.get("statusLabel").and_then(Value::as_str).unwrap_or_default();
    Some(RosterRow {
        session_id: text("sessionId")?.to_string(),
        active_session_id: text("activeSessionId").map(str::to_string),
        session_file: text("sessionFile").map(str::to_string),
        cwd: text("cwd").unwrap_or_default().to_string(),
        title: text("sessionName").filter(|name| !name.trim().is_empty()).map(str::to_string).or_else(|| {
            text("firstMessage")
                .map(strip_signal_reply_rules)
                .filter(|first| !first.trim().is_empty())
                .map(str::to_string)
        }),
        provider: model.as_ref().map(|model| model.provider.clone()).filter(|value| !value.is_empty()),
        model: model.map(|model| model.id),
        note: text("note").map(str::to_string),
        running: status == "running",
        failed: label == "failed",
        updated_at: text("lastActivityAt").or_else(|| text("modified")).and_then(parse_rfc3339),
    })
}

pub(crate) fn clean_title(text: &str) -> String {
    let line = text.lines().map(str::trim).find(|line| !line.is_empty()).unwrap_or_default();
    if line.chars().count() <= TITLE_LIMIT {
        return line.to_string();
    }
    let mut cut: String = line.chars().take(TITLE_LIMIT).collect();
    cut.push('…');
    cut
}

pub(crate) fn project_for(cwd: &str, flags: &ThreadFlags, projects: &[StoredProject]) -> Option<String> {
    if let Some(project) = flags.project.as_ref().filter(|project| projects.iter().any(|known| &known.path == *project))
    {
        return Some(project.clone());
    }
    let cwd = Path::new(cwd);
    projects
        .iter()
        .filter(|project| cwd.starts_with(&project.path))
        .max_by_key(|project| project.path.len())
        .map(|project| project.path.clone())
}

pub(crate) fn project_record(project: &StoredProject) -> Project {
    Project {
        id: project.path.clone(),
        name: project.name.clone(),
        path: project.path.clone(),
        icon: project.icon.clone(),
        is_git: git_dir(Path::new(&project.path)).is_some(),
    }
}

pub(crate) fn git_head(cwd: &str) -> GitHead {
    let Some((dot_git, root)) = git_dir(Path::new(cwd)) else { return GitHead::default() };
    let (git_dir, worktree) = if dot_git.is_file() {
        let Ok(text) = std::fs::read_to_string(&dot_git) else { return GitHead::default() };
        let Some(target) = text.trim().strip_prefix("gitdir:").map(str::trim) else { return GitHead::default() };
        let target = root.join(target);
        let linked = target.components().any(|part| part.as_os_str() == "worktrees");
        (target, linked.then(|| root.to_string_lossy().into_owned()))
    } else {
        (dot_git, None)
    };
    let branch = std::fs::read_to_string(git_dir.join("HEAD"))
        .ok()
        .and_then(|head| head.trim().strip_prefix("ref: refs/heads/").map(str::to_string));
    GitHead { branch, worktree }
}

fn git_dir(start: &Path) -> Option<(PathBuf, PathBuf)> {
    start.ancestors().find_map(|dir| {
        let candidate = dir.join(".git");
        candidate.exists().then(|| (candidate, dir.to_path_buf()))
    })
}

pub(crate) fn row(
    facts: Facts,
    flags: &ThreadFlags,
    projects: &[StoredProject],
    prefs: InboxPrefs,
    head: GitHead,
    now: i64,
) -> (ThreadRow, i64) {
    let (status, status_since) = if facts.approval_since.is_some() {
        (ThreadStatus::Approval, facts.approval_since)
    } else if facts.working {
        (ThreadStatus::Working, facts.run_started_at)
    } else if facts.failed_at.is_some() {
        (ThreadStatus::Failed, facts.failed_at)
    } else if flags.woke_at.is_some() {
        (ThreadStatus::Woke, flags.woke_at)
    } else if flags.unread {
        (ThreadStatus::Done, flags.done_at)
    } else {
        (ThreadStatus::Idle, None)
    };
    let snoozed = flags.snoozed_until.filter(|until| *until > now);
    let auto_settled_at = (prefs.auto_settle_inactive
        && !facts.working
        && status == ThreadStatus::Idle
        && flags.unsettled_at.is_none_or(|at| at < facts.activity_at))
    .then(|| facts.activity_at.saturating_add(i64::from(prefs.auto_settle_inactive_days).saturating_mul(DAY_MS)))
    .filter(|at| *at <= now);
    let settled_at = flags.settled_at.or(auto_settled_at);
    let (shelf, updated_at, key) = if let Some(pinned_at) = flags.pinned_at {
        (Shelf::Pinned, facts.activity_at, -pinned_at)
    } else if let Some(until) = snoozed {
        (Shelf::Snoozed, facts.activity_at, -until)
    } else if let Some(settled_at) = settled_at.filter(|_| status != ThreadStatus::Working) {
        (Shelf::Settled, settled_at, settled_at)
    } else if prefs.working_section && status == ThreadStatus::Working {
        (Shelf::Working, facts.activity_at, facts.run_started_at.unwrap_or(facts.activity_at))
    } else {
        (Shelf::Active, facts.activity_at, facts.activity_at)
    };
    let project = project_for(&facts.cwd, flags, projects);
    (
        ThreadRow {
            id: facts.id,
            project,
            title: facts.title,
            shelf,
            status,
            status_since,
            updated_at,
            snoozed_until: snoozed,
            pinned: flags.pinned_at.is_some(),
            unread: flags.unread,
            branch: head.branch,
            worktree: head.worktree,
            provider: facts.provider,
            model: facts.model,
            additions: flags.additions,
            deletions: flags.deletions,
            note: facts.note,
            archived: flags.archived,
        },
        key,
    )
}

pub(crate) fn arrange(mut rows: Vec<(ThreadRow, i64)>) -> Vec<ThreadRow> {
    let rank = |shelf: Shelf| match shelf {
        Shelf::Pinned => 0,
        Shelf::Active => 1,
        Shelf::Working => 2,
        Shelf::Snoozed => 3,
        Shelf::Settled => 4,
    };
    rows.sort_by(|(left, left_key), (right, right_key)| {
        rank(left.shelf)
            .cmp(&rank(right.shelf))
            .then_with(|| right_key.cmp(left_key))
            .then_with(|| left.id.cmp(&right.id))
    });
    rows.into_iter().map(|(row, _)| row).collect()
}

pub(crate) fn parse_rfc3339(text: &str) -> Option<i64> {
    let text = text.trim();
    let (date, time) = text.split_once(['T', 't', ' '])?;
    let mut date_parts = date.splitn(3, '-');
    let year: i64 = date_parts.next()?.parse().ok()?;
    let month: i64 = date_parts.next()?.parse().ok()?;
    let day: i64 = date_parts.next()?.parse().ok()?;
    let (clock, offset_ms) = if let Some(clock) = time.strip_suffix(['Z', 'z']) {
        (clock, 0)
    } else {
        let split = time.rfind(['+', '-'])?;
        let (clock, offset) = time.split_at(split);
        let sign = if offset.starts_with('-') { -1 } else { 1 };
        let (hours, minutes) = offset.get(1..)?.split_once(':')?;
        let minutes = hours.parse::<i64>().ok()? * 60 + minutes.parse::<i64>().ok()?;
        (clock, sign * minutes * 60_000)
    };
    let mut clock_parts = clock.splitn(3, ':');
    let hour: i64 = clock_parts.next()?.parse().ok()?;
    let minute: i64 = clock_parts.next()?.parse().ok()?;
    let seconds = clock_parts.next()?;
    let (whole, fraction) = seconds.split_once('.').unwrap_or((seconds, ""));
    let second: i64 = whole.parse().ok()?;
    let millis: i64 = format!("{fraction:0<3}").get(..3)?.parse().ok()?;
    let days = days_from_civil(year, month, day);
    Some(((days * 24 + hour) * 60 + minute) * 60_000 + second * 1000 + millis - offset_ms)
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let month_index = (month + 9) % 12;
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}
