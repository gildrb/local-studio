use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;

use super::diff;
use super::model::{Branch, FileDiff, GitStatus, PullRequest, WritingStyle};
use super::process::{self, run, run_ok};

const QUICK: Duration = Duration::from_secs(15);
const SLOW: Duration = Duration::from_secs(60);
const NETWORK: Duration = Duration::from_secs(120);
const MAX_UNTRACKED_DIFFS: usize = 200;
const MAX_UNTRACKED_BYTES: u64 = 2 * 1024 * 1024;

fn git_args<'a>(project: &'a Path, args: &[&'a str]) -> Vec<&'a std::ffi::OsStr> {
    let mut all: Vec<&std::ffi::OsStr> = vec![
        "-C".as_ref(),
        project.as_os_str(),
        "-c".as_ref(),
        "core.quotepath=off".as_ref(),
        "-c".as_ref(),
        "color.ui=false".as_ref(),
    ];
    all.extend(args.iter().map(|arg| std::ffi::OsStr::new(*arg)));
    all
}

async fn git(project: &Path, args: &[&str], timeout: Duration) -> Result<String, String> {
    run_ok("git", git_args(project, args), project, timeout).await
}

async fn git_output(project: &Path, args: &[&str], timeout: Duration) -> Result<process::Output, String> {
    run("git", git_args(project, args), project, timeout, None).await
}

pub(crate) async fn is_repo(project: &Path) -> bool {
    git(project, &["rev-parse", "--is-inside-work-tree"], QUICK).await.is_ok_and(|out| out.trim() == "true")
}

pub(crate) async fn status(project: &Path) -> Result<GitStatus, String> {
    if !project.is_dir() {
        return Err(format!("{} is not a directory.", project.display()));
    }
    if !is_repo(project).await {
        return Ok(GitStatus {
            branch: None,
            upstream: None,
            ahead: 0,
            behind: 0,
            dirty: false,
            default_branch: None,
            pull_request: None,
            is_repo: false,
            changed_files: 0,
            has_remote: false,
        });
    }
    let porcelain = git(project, &["status", "--porcelain=v2", "--branch", "--untracked-files=normal"], QUICK).await?;
    let mut branch = None;
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut changed: u32 = 0;
    for line in porcelain.lines() {
        if let Some(value) = line.strip_prefix("# branch.head ") {
            branch = (value != "(detached)").then(|| value.to_string());
        } else if let Some(value) = line.strip_prefix("# branch.upstream ") {
            upstream = Some(value.to_string());
        } else if let Some(value) = line.strip_prefix("# branch.ab ") {
            for part in value.split(' ') {
                if let Some(count) = part.strip_prefix('+') {
                    ahead = count.parse().unwrap_or(0);
                } else if let Some(count) = part.strip_prefix('-') {
                    behind = count.parse().unwrap_or(0);
                }
            }
        } else if !line.starts_with('#') && !line.is_empty() {
            changed = changed.saturating_add(1);
        }
    }
    let has_remote = git(project, &["remote"], QUICK).await.is_ok_and(|remotes| !remotes.trim().is_empty());
    Ok(GitStatus {
        branch,
        upstream,
        ahead,
        behind,
        dirty: changed > 0,
        default_branch: default_branch(project).await,
        pull_request: None,
        is_repo: true,
        changed_files: changed,
        has_remote,
    })
}

pub(crate) async fn default_branch(project: &Path) -> Option<String> {
    if let Ok(head) = git(project, &["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], QUICK).await {
        let head = head.trim();
        if let Some(name) = head.strip_prefix("origin/") {
            return Some(name.to_string());
        }
    }
    for candidate in ["main", "master", "trunk", "develop"] {
        let reference = format!("refs/heads/{candidate}");
        if git(project, &["show-ref", "--verify", "--quiet", &reference], QUICK).await.is_ok() {
            return Some(candidate.to_string());
        }
        let remote = format!("refs/remotes/origin/{candidate}");
        if git(project, &["show-ref", "--verify", "--quiet", &remote], QUICK).await.is_ok() {
            return Some(candidate.to_string());
        }
    }
    None
}

pub(crate) async fn branches(project: &Path, query: &str, limit: u32) -> Result<(Vec<Branch>, u32), String> {
    let out = git(
        project,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname)%00%(HEAD)%00%(worktreepath)",
            "refs/heads",
            "refs/remotes",
        ],
        QUICK,
    )
    .await?;
    let needle = query.trim().to_lowercase();
    let mut local = Vec::new();
    let mut remote = Vec::new();
    for line in out.lines() {
        let mut fields = line.split('\0');
        let reference = fields.next().unwrap_or_default();
        let current = fields.next() == Some("*");
        let worktree = fields.next().filter(|path| !path.is_empty()).map(str::to_string);
        let (name, is_remote) = if let Some(name) = reference.strip_prefix("refs/heads/") {
            (name, false)
        } else if let Some(name) = reference.strip_prefix("refs/remotes/") {
            if name.ends_with("/HEAD") {
                continue;
            }
            (name, true)
        } else {
            continue;
        };
        if !needle.is_empty() && !name.to_lowercase().contains(&needle) {
            continue;
        }
        let branch = Branch { name: name.to_string(), remote: is_remote, current, worktree };
        if is_remote {
            remote.push(branch);
        } else if current {
            local.insert(0, branch);
        } else {
            local.push(branch);
        }
    }
    local.extend(remote);
    let total = u32::try_from(local.len()).unwrap_or(u32::MAX);
    if limit > 0 {
        local.truncate(limit as usize);
    }
    Ok((local, total))
}

pub(crate) fn slug(branch: &str) -> String {
    let slug: String =
        branch
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() || character == '.' || character == '_' {
                    character
                } else {
                    '-'
                }
            })
            .collect();
    let slug = slug.trim_matches(|character| character == '-' || character == '.').to_string();
    if slug.is_empty() {
        "worktree".to_string()
    } else {
        slug
    }
}

pub(crate) async fn create_worktree(
    project: &Path,
    root: &Path,
    branch: &str,
    base: Option<&str>,
) -> Result<PathBuf, String> {
    let branch = branch.trim();
    if branch.is_empty() {
        return Err("Branch name is empty.".to_string());
    }
    git(project, &["check-ref-format", "--branch", branch], QUICK)
        .await
        .map_err(|_| format!("`{branch}` is not a valid branch name."))?;
    let toplevel = git(project, &["rev-parse", "--show-toplevel"], QUICK).await?;
    let toplevel = PathBuf::from(toplevel.trim());
    let name = toplevel.file_name().map_or_else(|| "project".to_string(), |name| slug(&name.to_string_lossy()));
    let parent = root.join(name);
    std::fs::create_dir_all(&parent).map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    let mut path = parent.join(slug(branch));
    let mut suffix = 2;
    while path.exists() {
        path = parent.join(format!("{}-{suffix}", slug(branch)));
        suffix += 1;
    }
    let path_text = path.to_string_lossy().into_owned();
    let reference = format!("refs/heads/{branch}");
    let exists = git(project, &["show-ref", "--verify", "--quiet", &reference], QUICK).await.is_ok();
    let mut args = vec!["worktree", "add"];
    if exists {
        args.extend(["--", path_text.as_str(), branch]);
    } else {
        args.extend(["-b", branch, "--", path_text.as_str()]);
        if let Some(base) = base.map(str::trim).filter(|base| !base.is_empty()) {
            args.push(base);
        }
    }
    git(project, &args, SLOW).await?;
    Ok(path)
}

async fn has_head(project: &Path) -> bool {
    git(project, &["rev-parse", "--verify", "--quiet", "HEAD"], QUICK).await.is_ok()
}

async fn empty_tree(project: &Path) -> Result<String, String> {
    Ok(git(project, &["hash-object", "-t", "tree", "/dev/null"], QUICK).await?.trim().to_string())
}

pub(crate) async fn diff_against(
    project: &Path,
    base: Option<String>,
    paths: Option<&[String]>,
    ignore_whitespace: bool,
) -> Result<Vec<FileDiff>, String> {
    if !is_repo(project).await {
        return Err("This project is not a git repository.".to_string());
    }
    if paths.is_some_and(<[String]>::is_empty) {
        return Ok(Vec::new());
    }
    let base = match base {
        Some(base) => base,
        None if has_head(project).await => "HEAD".to_string(),
        None => empty_tree(project).await?,
    };
    let mut args =
        vec!["diff", "--no-color", "--no-ext-diff", "--find-renames", "--src-prefix=a/", "--dst-prefix=b/", "-U3"];
    if ignore_whitespace {
        args.push("-w");
    }
    args.push(base.as_str());
    args.push("--");
    if let Some(paths) = paths {
        args.extend(paths.iter().map(String::as_str));
    }
    let output = git_output(project, &args, SLOW).await?;
    if !output.success() {
        return Err(output.failure());
    }
    let mut files = diff::parse(&output.stdout);
    let mut untracked_args = vec!["ls-files", "--others", "--exclude-standard", "-z", "--"];
    if let Some(paths) = paths {
        untracked_args.extend(paths.iter().map(String::as_str));
    }
    let untracked = git(project, &untracked_args, QUICK).await?;
    for relative in untracked.split('\0').filter(|path| !path.is_empty()).take(MAX_UNTRACKED_DIFFS) {
        files.push(untracked_diff(project, relative).await);
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(files)
}

async fn untracked_diff(project: &Path, relative: &str) -> FileDiff {
    let absolute = project.join(relative);
    let size = std::fs::metadata(&absolute).map_or(0, |meta| meta.len());
    let placeholder = FileDiff {
        path: relative.to_string(),
        old_path: None,
        status: "added".to_string(),
        additions: 0,
        deletions: 0,
        binary: true,
        hunks: Vec::new(),
    };
    if size > MAX_UNTRACKED_BYTES {
        return placeholder;
    }
    let args = [
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-index",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        "--",
        "/dev/null",
        relative,
    ];
    match git_output(project, &args, QUICK).await {
        Ok(output) => diff::parse(&output.stdout)
            .into_iter()
            .next()
            .map(|mut file| {
                file.path = relative.to_string();
                file.old_path = None;
                file.status = "added".to_string();
                file
            })
            .unwrap_or(placeholder),
        Err(_) => placeholder,
    }
}

pub(crate) async fn merge_base(project: &Path, base: Option<String>) -> Result<String, String> {
    let requested = base.filter(|base| !base.trim().is_empty());
    let base = if let Some(base) = requested {
        base
    } else {
        let name = default_branch(project).await.ok_or("No default branch found; choose a base ref.")?;
        let remote = format!("refs/remotes/origin/{name}");
        if git(project, &["show-ref", "--verify", "--quiet", &remote], QUICK).await.is_ok() {
            format!("origin/{name}")
        } else {
            name
        }
    };
    let out = git(project, &["merge-base", &base, "HEAD"], QUICK).await.map_err(|error| format!("{base}: {error}"))?;
    Ok(out.trim().to_string())
}

pub(crate) async fn generated_message(project: &Path, style: WritingStyle) -> Result<String, String> {
    let names = git(project, &["diff", "--cached", "--name-status", "-z", "--find-renames"], QUICK).await?;
    let mut fields = names.split('\0').filter(|field| !field.is_empty());
    let mut paths = Vec::new();
    let mut statuses = BTreeSet::new();
    while let Some(status) = fields.next() {
        let kind = status.chars().next().unwrap_or('M');
        statuses.insert(kind);
        let path = if kind == 'R' || kind == 'C' {
            fields.next();
            fields.next()
        } else {
            fields.next()
        };
        if let Some(path) = path {
            paths.push(path.to_string());
        }
    }
    if paths.is_empty() {
        return Err("Nothing to commit.".to_string());
    }
    let verb = match (statuses.len(), statuses.iter().next()) {
        (1, Some('A')) => "Add",
        (1, Some('D')) => "Remove",
        (1, Some('R')) => "Rename",
        _ => "Update",
    };
    let names: Vec<String> = paths
        .iter()
        .map(|path| {
            Path::new(path).file_name().map_or_else(|| path.clone(), |name| name.to_string_lossy().into_owned())
        })
        .collect();
    let directories: BTreeSet<&str> =
        paths.iter().map(|path| path.rsplit_once('/').map_or("", |(directory, _)| directory)).collect();
    let subject = match names.len() {
        1 => format!("{verb} {}", names[0]),
        2 => format!("{verb} {} and {}", names[0], names[1]),
        3 => format!("{verb} {}, {} and {}", names[0], names[1], names[2]),
        count => match directories.iter().next() {
            Some(directory) if directories.len() == 1 && !directory.is_empty() => {
                format!("{verb} {directory} ({count} files)")
            }
            _ => format!("{verb} {}, {} and {} more files", names[0], names[1], count - 2),
        },
    };
    let conventional = match style {
        WritingStyle::ConventionalCommits => true,
        WritingStyle::Custom => false,
        WritingStyle::RepoConventions => uses_conventional_commits(project).await,
    };
    if conventional {
        let kind = if verb == "Add" { "feat" } else { "chore" };
        let mut chars = subject.chars();
        let lowered =
            chars.next().map(|first| first.to_lowercase().collect::<String>() + chars.as_str()).unwrap_or_default();
        return Ok(format!("{kind}: {lowered}"));
    }
    Ok(subject)
}

async fn uses_conventional_commits(project: &Path) -> bool {
    let Ok(log) = git(project, &["log", "-20", "--format=%s"], QUICK).await else { return false };
    let subjects: Vec<&str> = log.lines().filter(|line| !line.trim().is_empty()).collect();
    if subjects.is_empty() {
        return false;
    }
    let conventional = subjects
        .iter()
        .filter(|subject| {
            subject.split_once(": ").is_some_and(|(kind, _)| {
                let kind = kind.trim_end_matches('!');
                let kind = kind.split_once('(').map_or(kind, |(head, _)| head);
                !kind.is_empty() && kind.chars().all(|character| character.is_ascii_lowercase())
            })
        })
        .count();
    conventional * 2 >= subjects.len()
}

pub(crate) async fn commit(project: &Path, message: Option<String>, style: WritingStyle) -> Result<String, String> {
    git(project, &["add", "-A"], SLOW).await?;
    let staged = git_output(project, &["diff", "--cached", "--quiet"], QUICK).await?;
    if staged.success() {
        return Err("Nothing to commit.".to_string());
    }
    let message = match message.map(|text| text.trim().to_string()).filter(|text| !text.is_empty()) {
        Some(message) => message,
        None => generated_message(project, style).await?,
    };
    git(project, &["commit", "--quiet", "-m", &message], NETWORK).await?;
    let sha = git(project, &["rev-parse", "--short", "HEAD"], QUICK).await?;
    let subject = message.lines().next().unwrap_or_default();
    Ok(format!("Committed {} {subject}", sha.trim()))
}

pub(crate) async fn push(project: &Path) -> Result<String, String> {
    let status = status(project).await?;
    if !status.is_repo {
        return Err("This project is not a git repository.".to_string());
    }
    let branch = status.branch.ok_or("HEAD is detached; check out a branch to push.")?;
    if let Some(upstream) = status.upstream {
        git(project, &["push"], NETWORK).await?;
        return Ok(format!("Pushed {branch} to {upstream}"));
    }
    let remotes = git(project, &["remote"], QUICK).await?;
    let remotes: Vec<&str> = remotes.lines().map(str::trim).filter(|line| !line.is_empty()).collect();
    let remote = if remotes.contains(&"origin") {
        "origin"
    } else {
        remotes.first().copied().ok_or("This repository has no remote to push to.")?
    };
    git(project, &["push", "--set-upstream", remote, &branch], NETWORK).await?;
    Ok(format!("Pushed {branch} to {remote}/{branch}"))
}

pub(crate) const PR_FIELDS: &str = "number,title,url,state,headRefName,baseRefName,statusCheckRollup";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GhPull {
    number: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    state: String,
    #[serde(default)]
    head_ref_name: String,
    #[serde(default)]
    base_ref_name: String,
    #[serde(default)]
    status_check_rollup: Vec<Value>,
}

impl GhPull {
    pub(crate) fn into_pull(self) -> PullRequest {
        let checks = checks(&self.status_check_rollup);
        PullRequest {
            number: self.number,
            title: self.title,
            url: self.url,
            state: self.state,
            checks,
            head: self.head_ref_name,
            base: self.base_ref_name,
        }
    }
}

fn checks(rollup: &[Value]) -> String {
    if rollup.is_empty() {
        return "none".to_string();
    }
    let text =
        |value: &Value, key: &str| value.get(key).and_then(Value::as_str).unwrap_or_default().to_ascii_uppercase();
    let mut pending = false;
    for check in rollup {
        let conclusion = text(check, "conclusion");
        let state = text(check, "state");
        let status = text(check, "status");
        if matches!(conclusion.as_str(), "FAILURE" | "CANCELLED" | "TIMED_OUT" | "ACTION_REQUIRED" | "STARTUP_FAILURE")
            || matches!(state.as_str(), "FAILURE" | "ERROR")
        {
            return "failing".to_string();
        }
        if (!status.is_empty() && status != "COMPLETED") || matches!(state.as_str(), "PENDING" | "EXPECTED") {
            pending = true;
        }
    }
    if pending { "pending" } else { "passing" }.to_string()
}

pub(crate) async fn list_pull_requests(project: &Path) -> Result<Vec<PullRequest>, String> {
    let out =
        run_ok("gh", ["pr", "list", "--state", "all", "--limit", "50", "--json", PR_FIELDS], project, SLOW).await?;
    let pulls: Vec<GhPull> = serde_json::from_str(&out).map_err(|error| format!("unexpected gh output: {error}"))?;
    Ok(pulls.into_iter().map(GhPull::into_pull).collect())
}

pub(crate) async fn branch_pull_request(project: &Path, branch: &str) -> Option<PullRequest> {
    process::which("gh")?;
    let out = run_ok("gh", ["pr", "view", branch, "--json", PR_FIELDS], project, QUICK).await.ok()?;
    serde_json::from_str::<GhPull>(&out).ok().map(GhPull::into_pull)
}

pub(crate) async fn create_pull_request(
    project: &Path,
    title: &str,
    body: &str,
    draft: bool,
) -> Result<PullRequest, String> {
    let status = status(project).await?;
    let branch = status.branch.clone().ok_or("HEAD is detached; check out a branch first.")?;
    if status.upstream.is_none() || status.ahead > 0 {
        push(project).await?;
    }
    let mut args = vec!["pr", "create", "--head", branch.as_str(), "--title", title, "--body", body];
    if draft {
        args.push("--draft");
    }
    let out = run_ok("gh", &args, project, NETWORK).await?;
    let url =
        out.lines().rev().map(str::trim).find(|line| line.starts_with("http")).unwrap_or(branch.as_str()).to_string();
    let view = run_ok("gh", ["pr", "view", url.as_str(), "--json", PR_FIELDS], project, SLOW).await?;
    serde_json::from_str::<GhPull>(&view)
        .map(GhPull::into_pull)
        .map_err(|error| format!("unexpected gh output: {error}"))
}

pub(crate) async fn watch_dirs(project: &Path) -> Option<(PathBuf, PathBuf)> {
    let out = git(project, &["rev-parse", "--absolute-git-dir", "--git-common-dir"], QUICK).await.ok()?;
    let mut lines = out.lines();
    let git_dir = PathBuf::from(lines.next()?.trim());
    let common = lines.next()?.trim();
    let common = if Path::new(common).is_absolute() { PathBuf::from(common) } else { project.join(common) };
    Some((git_dir, common))
}

pub(crate) async fn fetch(project: &Path, auto_pull: bool) -> bool {
    if !is_repo(project).await {
        return false;
    }
    let Ok(remotes) = git(project, &["remote"], QUICK).await else { return false };
    if remotes.trim().is_empty() || git(project, &["fetch", "--quiet", "--prune"], NETWORK).await.is_err() {
        return false;
    }
    if auto_pull {
        if let Ok(status) = status(project).await {
            if status.upstream.is_some() && status.behind > 0 && status.ahead == 0 && !status.dirty {
                let _ = git(project, &["merge", "--ff-only", "--quiet", "@{upstream}"], SLOW).await;
            }
        }
    }
    true
}

pub(crate) async fn pull(project: &Path) -> Result<String, String> {
    let before = status(project).await?;
    if !before.is_repo {
        return Err("This project is not a git repository.".to_string());
    }
    let branch = before.branch.ok_or("HEAD is detached; check out a branch to pull.")?;
    let upstream = before.upstream.ok_or_else(|| format!("{branch} has no upstream branch; push it first."))?;
    git(project, &["fetch", "--quiet"], NETWORK).await?;
    let after = status(project).await?;
    if after.behind == 0 {
        return Ok(format!("{branch} is already up to date with {upstream}."));
    }
    if after.ahead > 0 {
        return Err(format!(
            "{branch} has diverged from {upstream}: {} local and {} remote commits. Rebase or merge it manually.",
            after.ahead, after.behind
        ));
    }
    git(project, &["merge", "--ff-only", "--quiet", "@{upstream}"], SLOW).await?;
    let plural = if after.behind == 1 { "" } else { "s" };
    Ok(format!("Fast-forwarded {branch} by {} commit{plural} from {upstream}.", after.behind))
}

pub(crate) async fn publish_repository(project: &Path, name: &str, private: bool) -> Result<String, String> {
    let name = name.trim();
    let valid = !name.is_empty()
        && !name.starts_with(['-', '.', '/'])
        && name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | '/'));
    if !valid {
        return Err(format!("`{name}` is not a valid repository name."));
    }
    if !is_repo(project).await {
        return Err("This project is not a git repository.".to_string());
    }
    if !has_head(project).await {
        return Err("Commit something before publishing the repository.".to_string());
    }
    let remotes = git(project, &["remote"], QUICK).await?;
    if remotes.lines().any(|remote| remote.trim() == "origin") {
        return Err("This repository already has an `origin` remote.".to_string());
    }
    let visibility = if private { "--private" } else { "--public" };
    let out = run_ok(
        "gh",
        ["repo", "create", name, visibility, "--source", ".", "--remote", "origin", "--push"],
        project,
        NETWORK,
    )
    .await?;
    let url = out.lines().map(str::trim).rfind(|line| line.starts_with("http")).unwrap_or(name).to_string();
    Ok(format!("Published {url}"))
}
