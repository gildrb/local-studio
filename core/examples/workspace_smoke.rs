use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

use anyhow::{bail, ensure, Context};
use eukhe_client::daemon_client::DaemonClient;
use eukhe_types::daemon::DaemonCommand;
use local_studio_core::{
    AccessMode, Branch, ColorScheme, Connection, DaemonLaunch, Device, DiffLineKind, DiffScope, FileContent, FileDiff,
    FileEntry, GitStatus, Keybinding, LocalSnapshot, PromptDraft, ProviderStatus, PullRequestDetail, SearchHit,
    SendShortcut, Settings, Studio, StudioConfig, ThreadRow, ThreadSettings, ThreadStatus, Update, UsagePeriod,
    UsageReport, Waker, WorktreeChoice,
};
use serde_json::Map;

const STEP_TIMEOUT: Duration = Duration::from_secs(90);
const PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49,
    0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

#[derive(Default)]
struct Signal {
    pending: Mutex<bool>,
    ready: Condvar,
}

impl Waker for Signal {
    fn wake(&self) {
        *self.pending.lock().unwrap_or_else(PoisonError::into_inner) = true;
        self.ready.notify_one();
    }
}

impl Signal {
    fn wait(&self, timeout: Duration) {
        let pending = self.pending.lock().unwrap_or_else(PoisonError::into_inner);
        let (mut pending, _) = self
            .ready
            .wait_timeout_while(pending, timeout, |pending| !*pending)
            .unwrap_or_else(PoisonError::into_inner);
        *pending = false;
    }
}

#[derive(Default)]
struct View {
    connection: Option<Connection>,
    projects: Vec<String>,
    threads: Vec<ThreadRow>,
    started: Vec<(String, String)>,
    statuses: Vec<(String, GitStatus)>,
    branches: Vec<(String, Vec<Branch>, u32)>,
    diffs: Vec<(String, Vec<FileDiff>)>,
    files: Vec<(String, Vec<FileEntry>)>,
    contents: Vec<(String, String, FileContent)>,
    hits: Vec<(String, Vec<SearchHit>)>,
    terminals: Vec<(String, String)>,
    output: Vec<(String, Vec<u8>)>,
    exited: Vec<(String, Option<i32>)>,
    usage: Vec<(String, UsageReport)>,
    local: Vec<(String, LocalSnapshot)>,
    providers: Option<Vec<ProviderStatus>>,
    settings: Option<Settings>,
    keybindings: Option<Vec<Keybinding>>,
    done: Vec<(String, String)>,
    failed: Vec<(String, String)>,
    details: Vec<(String, PullRequestDetail)>,
    devices: Vec<(String, Vec<Device>)>,
}

impl View {
    fn failure(&self, request: &str) -> Option<&str> {
        self.failed.iter().find(|(id, _)| id == request).map(|(_, message)| message.as_str())
    }

    fn answered(&self, request: &str) -> bool {
        self.failure(request).is_some()
            || self.done.iter().any(|(id, _)| id == request)
            || self.branches.iter().any(|(id, _, _)| id == request)
            || self.diffs.iter().any(|(id, _)| id == request)
            || self.files.iter().any(|(id, _)| id == request)
            || self.contents.iter().any(|(id, _, _)| id == request)
            || self.hits.iter().any(|(id, _)| id == request)
            || self.terminals.iter().any(|(id, _)| id == request)
            || self.usage.iter().any(|(id, _)| id == request)
            || self.local.iter().any(|(id, _)| id == request)
            || self.details.iter().any(|(id, _)| id == request)
            || self.devices.iter().any(|(id, _)| id == request)
    }

    fn terminal_text(&self, terminal: &str) -> String {
        let bytes: Vec<u8> =
            self.output.iter().filter(|(id, _)| id == terminal).flat_map(|(_, data)| data.iter().copied()).collect();
        String::from_utf8_lossy(&bytes).into_owned()
    }

    fn status(&self, project: &str) -> Option<&GitStatus> {
        self.statuses.iter().rev().find(|(id, _)| id == project).map(|(_, status)| status)
    }
}

struct Harness {
    studio: Arc<Studio>,
    signal: Arc<Signal>,
    view: View,
    next: u32,
}

impl Harness {
    fn new(config: StudioConfig) -> anyhow::Result<Self> {
        let signal = Arc::new(Signal::default());
        let studio = Studio::new(config, Arc::clone(&signal) as Arc<dyn Waker>)?;
        Ok(Self { studio, signal, view: View::default(), next: 0 })
    }

    fn request(&mut self) -> String {
        self.next += 1;
        format!("r{}", self.next)
    }

    fn pump_until(&mut self, step: &str, done: impl Fn(&View) -> bool) -> anyhow::Result<()> {
        let deadline = Instant::now() + STEP_TIMEOUT;
        loop {
            for update in self.studio.tick() {
                self.apply(update);
            }
            if done(&self.view) {
                println!("ok   {step}");
                return Ok(());
            }
            let Some(left) = deadline.checked_duration_since(Instant::now()) else {
                bail!("timed out waiting for: {step}");
            };
            self.signal.wait(left.min(Duration::from_millis(200)));
        }
    }

    fn answer(&mut self, step: &str, request: &str) -> anyhow::Result<()> {
        let id = request.to_string();
        self.pump_until(step, move |view| view.answered(&id))?;
        if let Some(message) = self.view.failure(request) {
            bail!("{step} failed: {message}");
        }
        Ok(())
    }

    fn apply(&mut self, update: Update) {
        let view = &mut self.view;
        match update {
            Update::Connection { state } => view.connection = Some(state),
            Update::Projects { projects } => view.projects = projects.into_iter().map(|project| project.id).collect(),
            Update::Threads { threads } => view.threads = threads,
            Update::ThreadStarted { draft, thread } => view.started.push((draft, thread)),
            Update::GitStatus { project, status } => view.statuses.push((project, status)),
            Update::Branches { request, branches, total } => view.branches.push((request, branches, total)),
            Update::Diff { request, files } => view.diffs.push((request, files)),
            Update::Files { request, entries } => view.files.push((request, entries)),
            Update::FileContent { request, path, content } => view.contents.push((request, path, content)),
            Update::SearchResults { request, results } => view.hits.push((request, results)),
            Update::TerminalOpened { request, terminal } => view.terminals.push((request, terminal)),
            Update::TerminalOutput { terminal, data } => view.output.push((terminal, data)),
            Update::TerminalExited { terminal, code } => view.exited.push((terminal, code)),
            Update::Usage { request, report } => view.usage.push((request, report)),
            Update::Local { request, snapshot } => view.local.push((request, snapshot)),
            Update::Providers { providers } => view.providers = Some(providers),
            Update::Settings { settings } => view.settings = Some(settings),
            Update::Keybindings { bindings } => view.keybindings = Some(bindings),
            Update::PullRequestDetail { request, detail } => view.details.push((request, detail)),
            Update::Devices { request, devices } => view.devices.push((request, devices)),
            Update::RequestDone { request, message } => {
                println!("     done {request}: {message}");
                view.done.push((request, message));
            }
            Update::RequestFailed { request, message } => {
                println!("     failed {request}: {message}");
                view.failed.push((request, message));
            }
            Update::Notice { level, text } => println!("     notice {level:?}: {text}"),
            Update::Thread { .. }
            | Update::Transcript { .. }
            | Update::Approvals { .. }
            | Update::Queue { .. }
            | Update::ComposerText { .. }
            | Update::Models { .. }
            | Update::Commands { .. }
            | Update::Notification { .. }
            | Update::ArchivedThreads { .. }
            | Update::PullRequests { .. }
            | Update::ThreadSearch { .. } => {}
        }
    }
}

fn git(dir: &Path, args: &[&str]) -> anyhow::Result<String> {
    let output = Command::new("git").arg("-C").arg(dir).args(args).env("LC_ALL", "C").output()?;
    ensure!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn make_repo(repo: &Path) -> anyhow::Result<()> {
    std::fs::create_dir_all(repo.join("src"))?;
    git(repo, &["init", "--quiet", "-b", "main"])?;
    git(repo, &["config", "user.name", "Local Studio Smoke"])?;
    git(repo, &["config", "user.email", "smoke@localhost"])?;
    git(repo, &["config", "commit.gpgsign", "false"])?;
    std::fs::write(repo.join("README.md"), "# Smoke\n\nfirst line\nsecond line\nthird line\n")?;
    std::fs::write(repo.join("src/main.rs"), "fn main() {\n    println!(\"hello workspace\");\n}\n")?;
    std::fs::write(repo.join(".gitignore"), "ignored.txt\n")?;
    std::fs::write(repo.join("logo.png"), PNG)?;
    git(repo, &["add", "-A"])?;
    git(repo, &["commit", "--quiet", "-m", "Initial commit"])?;
    git(repo, &["checkout", "--quiet", "-b", "feature"])?;
    std::fs::write(repo.join("src/lib.rs"), "pub fn feature() -> u32 {\n    42\n}\n")?;
    git(repo, &["add", "-A"])?;
    git(repo, &["commit", "--quiet", "-m", "Add feature"])?;
    std::fs::write(repo.join("README.md"), "# Smoke\n\nfirst line\nsecond line changed\nthird line\n")?;
    std::fs::write(repo.join("notes.txt"), "untracked notes\n")?;
    std::fs::write(repo.join("ignored.txt"), "ignored\n")?;
    std::os::unix::fs::symlink("/etc/hosts", repo.join("escape"))?;
    Ok(())
}

fn free_port() -> anyhow::Result<u16> {
    Ok(TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}

const FAKE_GH: &str = r#"#!/bin/sh
case "$1 $2" in
  "pr view") cat "$FAKE_GH_DIR/pr-view.json" ;;
  "pr diff") cat "$FAKE_GH_DIR/pr-diff.patch" ;;
  "api "*) cat "$FAKE_GH_DIR/review-comments.json" ;;
  "repo create")
    git init --quiet --bare "$FAKE_GH_DIR/remote.git" &&
      git remote add origin "$FAKE_GH_DIR/remote.git" &&
      git push --quiet -u origin HEAD 2>/dev/null &&
      echo "https://github.com/smoke/$3" ;;
  *) echo "fake gh: unsupported $*" >&2; exit 1 ;;
esac
"#;

const PR_VIEW: &str = r#"{"number":7,"title":"Add feature","url":"https://github.com/smoke/repo/pull/7","state":"OPEN",
"headRefName":"feature","baseRefName":"main",
"statusCheckRollup":[{"__typename":"CheckRun","name":"build","status":"COMPLETED","conclusion":"SUCCESS","detailsUrl":"https://ci.example/1"},
{"__typename":"StatusContext","context":"lint","state":"PENDING","targetUrl":""}],
"body":"Adds the feature.\n\nDetails follow.","author":{"login":"alice"},"createdAt":"2026-11-01T10:00:00Z",
"comments":[{"author":{"login":"bob"},"body":"Looks good\nmore","createdAt":"2026-11-01T12:00:00Z"}],
"reviews":[{"author":{"login":"carol"},"state":"APPROVED","body":"","submittedAt":"2026-11-02T09:00:00Z"}],
"commits":[{"oid":"abc123","messageHeadline":"Add feature","committedDate":"2026-11-01T09:30:00Z","authors":[{"login":"alice","name":"Alice"}]}],
"mergedAt":null,"mergedBy":null,"closedAt":null}"#;

const PR_DIFF: &str = "diff --git a/src/lib.rs b/src/lib.rs
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/src/lib.rs
@@ -0,0 +1,3 @@
+pub fn feature() -> u32 {
+    42
+}
";

const REVIEW_COMMENTS: &str = r#"[{"user":{"login":"dave"},"body":"nit: name","created_at":"2026-11-01T11:00:00Z","path":"src/lib.rs","line":2}]"#;

fn install_fake_gh(root: &Path) -> anyhow::Result<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let bin = root.join("bin");
    let fixtures = root.join("fake-gh");
    std::fs::create_dir_all(&bin)?;
    std::fs::create_dir_all(&fixtures)?;
    std::fs::write(fixtures.join("pr-view.json"), PR_VIEW)?;
    std::fs::write(fixtures.join("pr-diff.patch"), PR_DIFF)?;
    std::fs::write(fixtures.join("review-comments.json"), REVIEW_COMMENTS)?;
    let gh = bin.join("gh");
    std::fs::write(&gh, FAKE_GH)?;
    std::fs::set_permissions(&gh, std::fs::Permissions::from_mode(0o755))?;
    let path = std::env::var_os("PATH").unwrap_or_default();
    let joined = std::env::join_paths(std::iter::once(bin).chain(std::env::split_paths(&path)))?;
    std::env::set_var("PATH", joined);
    std::env::set_var("FAKE_GH_DIR", &fixtures);
    Ok(fixtures)
}

fn main() -> anyhow::Result<()> {
    let usage = "usage: workspace_smoke <eukhe-daemon> [scratch dir, default /tmp/ls-r2]";
    let mut args = std::env::args_os().skip(1);
    let daemon = PathBuf::from(args.next().context(usage)?);
    let base = args.next().map_or_else(|| PathBuf::from("/tmp/ls-r2"), PathBuf::from);
    let root = base.join(format!("run-{}", std::process::id()));
    let repo = root.join("repo");
    let agent_dir = root.join("agent");
    let data = root.join("data");
    std::fs::create_dir_all(&agent_dir)?;
    make_repo(&repo)?;
    let repo = repo.canonicalize()?;
    let port = free_port()?;
    install_fake_gh(&root)?;
    std::env::set_var("LOCAL_STUDIO_DATA_DIR", &data);
    std::env::set_var("LOCAL_STUDIO_CONTROLLER_URL", format!("http://127.0.0.1:{port}"));
    let socket = root.join("d.sock");
    let config = StudioConfig {
        socket_path: Some(socket.to_string_lossy().into_owned()),
        session_dir: Some(agent_dir.join("sessions").to_string_lossy().into_owned()),
        data_dir: None,
        launch: Some(DaemonLaunch {
            program: daemon.to_string_lossy().into_owned(),
            arguments: vec![
                "supervisor".to_string(),
                "--agent-dir".to_string(),
                agent_dir.to_string_lossy().into_owned(),
            ],
        }),
        controller_main: Some(concat!(env!("CARGO_MANIFEST_DIR"), "/../controller/src/main.ts").to_string()),
    };
    let outcome = drive(&config, &repo, port);
    let stopped = stop_daemon(&socket);
    outcome?;
    stopped?;
    println!("PASS workspace smoke ({})", root.display());
    Ok(())
}

fn drive(config: &StudioConfig, repo: &Path, port: u16) -> anyhow::Result<()> {
    let mut harness = Harness::new(config.clone())?;
    let outcome = first_run(&mut harness, repo, port);
    harness.studio.shutdown();
    outcome?;
    if TcpStream::connect(("127.0.0.1", port)).is_ok() {
        bail!("the Local controller on port {port} is still running after shutdown");
    }
    println!("ok   controller stopped with the studio");
    let mut restarted = Harness::new(config.clone())?;
    let outcome = second_run(&mut restarted);
    restarted.studio.shutdown();
    outcome
}

fn first_run(harness: &mut Harness, repo: &Path, port: u16) -> anyhow::Result<()> {
    let project = git_basics(harness, repo)?;
    diffs_and_worktree(harness, &project)?;
    files(harness, &project)?;
    terminal_and_commit(harness, &project)?;
    forge(harness, &project)?;
    devices(harness)?;
    settings_providers_usage(harness, &project)?;
    local(harness, port)
}

fn forge(harness: &mut Harness, project: &str) -> anyhow::Result<()> {
    let project = project.to_string();
    let fixtures = PathBuf::from(std::env::var_os("FAKE_GH_DIR").context("fake gh")?);
    let request = harness.request();
    harness.studio.publish_repository(request.clone(), project.clone(), "smoke-repo".to_string(), true);
    harness.answer("publish repository through gh repo create", &request)?;
    ensure!(git(Path::new(&project), &["remote"])?.trim() == "origin", "origin added");
    harness.pump_until("published branch tracks origin and reports a remote", |view| {
        view.status(&project)
            .is_some_and(|status| status.upstream.as_deref() == Some("origin/watched") && status.has_remote)
    })?;
    let request = harness.request();
    harness.studio.publish_repository(request.clone(), project.clone(), "smoke-repo".to_string(), true);
    let id = request.clone();
    harness.pump_until("second publish refused", move |view| view.answered(&id))?;
    ensure!(harness.view.failure(&request).is_some_and(|message| message.contains("origin")), "refused");

    let clone = fixtures.join("clone");
    git(&fixtures, &["clone", "--quiet", "--branch", "watched", "remote.git", "clone"])?;
    git(&clone, &["config", "user.name", "Remote Smoke"])?;
    git(&clone, &["config", "user.email", "remote@localhost"])?;
    std::fs::write(clone.join("REMOTE.md"), "from the remote\n")?;
    git(&clone, &["add", "-A"])?;
    git(&clone, &["commit", "--quiet", "-m", "Remote change"])?;
    git(&clone, &["push", "--quiet", "origin", "watched"])?;
    let request = harness.request();
    harness.studio.pull(request.clone(), project.clone());
    harness.answer("fast-forward pull", &request)?;
    ensure!(Path::new(&project).join("REMOTE.md").is_file(), "pulled file present");
    ensure!(
        harness.view.done.last().is_some_and(|(_, message)| message.contains("Fast-forwarded watched by 1 commit")),
        "ff message"
    );

    std::fs::write(clone.join("REMOTE.md"), "remote again\n")?;
    git(&clone, &["commit", "--quiet", "-am", "Remote again"])?;
    git(&clone, &["push", "--quiet", "origin", "watched"])?;
    std::fs::write(Path::new(&project).join("LOCAL.md"), "local work\n")?;
    git(Path::new(&project), &["add", "LOCAL.md"])?;
    git(Path::new(&project), &["commit", "--quiet", "-m", "Local change"])?;
    let request = harness.request();
    harness.studio.pull(request.clone(), project.clone());
    let id = request.clone();
    harness.pump_until("diverged pull refused", move |view| view.answered(&id))?;
    ensure!(harness.view.failure(&request).is_some_and(|message| message.contains("diverged")), "divergence reported");

    let request = harness.request();
    harness.studio.load_pull_request(request.clone(), project.clone(), 7);
    harness.answer("pull request detail from recorded gh output", &request)?;
    let (_, detail) = harness.view.details.last().cloned().context("detail")?;
    println!(
        "     pr #{} {} checks {:?} files {:?} comments {:?} timeline {:?}",
        detail.pull.number,
        detail.pull.checks,
        detail.checks.iter().map(|check| (&check.name, &check.state)).collect::<Vec<_>>(),
        detail.files.iter().map(|file| (&file.path, file.additions)).collect::<Vec<_>>(),
        detail.comments.iter().map(|comment| (&comment.author, &comment.path, comment.line)).collect::<Vec<_>>(),
        detail.timeline.iter().map(|event| event.kind.as_str()).collect::<Vec<_>>()
    );
    ensure!(
        detail.pull.number == 7 && detail.pull.checks == "pending" && detail.author.as_deref() == Some("alice"),
        "pull"
    );
    ensure!(detail.body.starts_with("Adds the feature."), "body");
    ensure!(
        detail.checks.len() == 2 && detail.checks[0].state == "success" && detail.checks[1].state == "pending",
        "checks"
    );
    ensure!(detail.files.len() == 1 && detail.files[0].path == "src/lib.rs" && detail.files[0].additions == 3, "files");
    ensure!(
        detail.comments.len() == 2
            && detail.comments[0].author == "dave"
            && detail.comments[0].path.as_deref() == Some("src/lib.rs")
            && detail.comments[0].line == Some(2),
        "comments sorted with the review comment first"
    );
    ensure!(
        detail.timeline.iter().map(|event| event.kind.as_str()).collect::<Vec<_>>()
            == ["commit", "opened", "comment", "review"],
        "timeline order"
    );
    Ok(())
}

fn devices(harness: &mut Harness) -> anyhow::Result<()> {
    let request = harness.request();
    harness.studio.list_devices(request.clone());
    harness.answer("device listing", &request)?;
    let devices = harness.view.devices.last().map(|(_, devices)| devices.clone()).unwrap_or_default();
    println!(
        "     devices {:?}",
        devices.iter().map(|device| (&device.name, device.platform, &device.state)).take(6).collect::<Vec<_>>()
    );
    let request = harness.request();
    harness.studio.boot_device(request.clone(), "not-a-device".to_string());
    let id = request.clone();
    harness.pump_until("unknown device refused", move |view| view.answered(&id))?;
    ensure!(harness.view.failure(&request).is_some_and(|message| message.contains("Unknown device")), "unknown");
    Ok(())
}

fn git_basics(harness: &mut Harness, repo: &Path) -> anyhow::Result<String> {
    let project = repo.to_string_lossy().into_owned();
    harness.pump_until("settings and keybindings pushed on start", |view| {
        view.settings.is_some() && view.keybindings.is_some()
    })?;
    harness.pump_until("daemon connected", |view| matches!(view.connection, Some(Connection::Ready)))?;
    harness.studio.add_project(project.clone());
    harness.pump_until("project added", |view| !view.projects.is_empty())?;
    let project = harness.view.projects[0].clone();

    harness.studio.git_status(project.clone());
    harness.pump_until("git status", |view| view.status(&project).is_some())?;
    let status = harness.view.status(&project).cloned().context("no status")?;
    println!("     status {status:?}");
    ensure!(status.is_repo && status.branch.as_deref() == Some("feature") && status.dirty, "unexpected status");
    ensure!(status.default_branch.as_deref() == Some("main"), "default branch should be main");
    ensure!(status.changed_files == 3, "README.md, notes.txt and the escape symlink should be changed");
    ensure!(!status.has_remote, "a fresh repo has no remote");

    let request = harness.request();
    harness.studio.list_branches(request.clone(), project.clone(), String::new(), 10);
    harness.answer("branch listing", &request)?;
    let (_, branches, total) = harness.view.branches.last().cloned().context("no branches")?;
    println!("     branches {:?} total {total}", branches.iter().map(|branch| &branch.name).collect::<Vec<_>>());
    ensure!(branches.first().is_some_and(|branch| branch.name == "feature" && branch.current), "current first");
    ensure!(branches.iter().any(|branch| branch.name == "main" && !branch.current), "main listed");
    let request = harness.request();
    harness.studio.list_branches(request.clone(), project.clone(), "MAI".to_string(), 10);
    harness.answer("branch query", &request)?;
    let (_, branches, _) = harness.view.branches.last().cloned().context("no branches")?;
    ensure!(branches.len() == 1 && branches[0].name == "main", "query filters branches");
    Ok(project)
}

fn diffs_and_worktree(harness: &mut Harness, project: &str) -> anyhow::Result<()> {
    let project = project.to_string();
    let request = harness.request();
    harness.studio.load_diff(request.clone(), project.clone(), DiffScope::WorkingTree);
    harness.answer("working-tree diff", &request)?;
    let files = harness.view.diffs.last().map(|(_, files)| files.clone()).unwrap_or_default();
    for file in &files {
        println!(
            "     diff {} {} +{} -{} hunks {}",
            file.status,
            file.path,
            file.additions,
            file.deletions,
            file.hunks.len()
        );
    }
    let readme = files.iter().find(|file| file.path == "README.md").context("README.md diff")?;
    ensure!(readme.status == "modified" && readme.additions == 1 && readme.deletions == 1, "README stats");
    let added = readme.hunks[0].lines.iter().find(|line| line.kind == DiffLineKind::Added).context("added line")?;
    ensure!(
        added.new_line == Some(4) && added.old_line.is_none() && added.text == "second line changed",
        "line numbers"
    );
    let removed = readme.hunks[0].lines.iter().find(|line| line.kind == DiffLineKind::Removed).context("removed")?;
    ensure!(removed.old_line == Some(4) && removed.text == "second line", "removed line numbers");
    ensure!(
        files.iter().any(|file| file.path == "notes.txt" && file.status == "added" && file.additions == 1),
        "untracked file shows as added"
    );
    ensure!(!files.iter().any(|file| file.path == "ignored.txt"), "ignored file excluded");

    let request = harness.request();
    harness.studio.load_diff(request.clone(), project.clone(), DiffScope::Branch { base: Some("main".to_string()) });
    harness.answer("branch diff against main", &request)?;
    let files = harness.view.diffs.last().map(|(_, files)| files.clone()).unwrap_or_default();
    ensure!(files.iter().any(|file| file.path == "src/lib.rs" && file.status == "added"), "branch diff has lib.rs");
    ensure!(files.iter().any(|file| file.path == "README.md"), "branch diff includes uncommitted work");

    let request = harness.request();
    harness.studio.load_diff(request.clone(), project.clone(), DiffScope::LatestTurn { thread: "unknown".into() });
    harness.answer("latest-turn diff without turns", &request)?;
    ensure!(harness.view.diffs.last().is_some_and(|(_, files)| files.is_empty()), "no turns → empty diff");

    let request = harness.request();
    harness.studio.create_worktree(request.clone(), project.clone(), "smoke/worktree".to_string(), Some("main".into()));
    harness.answer("worktree created", &request)?;
    let worktree = harness.view.done.last().map(|(_, path)| path.clone()).context("worktree path")?;
    ensure!(Path::new(&worktree).join("README.md").is_file(), "worktree checked out");
    harness.pump_until("worktree status", |view| {
        view.status(&worktree).is_some_and(|status| status.branch.as_deref() == Some("smoke/worktree"))
    })?;
    Ok(())
}

fn files(harness: &mut Harness, project: &str) -> anyhow::Result<()> {
    let project = project.to_string();
    let request = harness.request();
    harness.studio.list_directory(request.clone(), project.clone(), String::new());
    harness.answer("directory listing", &request)?;
    let entries = harness.view.files.last().map(|(_, entries)| entries.clone()).unwrap_or_default();
    println!("     entries {:?}", entries.iter().map(|entry| &entry.relative).collect::<Vec<_>>());
    ensure!(entries.first().is_some_and(|entry| entry.directory && entry.name == "src"), "folders first");
    ensure!(entries.iter().any(|entry| entry.name == "README.md" && entry.size > 0), "README listed");
    ensure!(!entries.iter().any(|entry| entry.name == "ignored.txt" || entry.name == ".git"), "ignored hidden");

    let request = harness.request();
    harness.studio.read_file(request.clone(), project.clone(), "src/main.rs".to_string());
    harness.answer("read text file", &request)?;
    let (_, path, content) = harness.view.contents.last().cloned().context("content")?;
    ensure!(
        path == "src/main.rs"
            && matches!(&content, FileContent::Text { text, language } if text.contains("hello workspace") && language.as_deref() == Some("rust")),
        "text content"
    );
    let request = harness.request();
    harness.studio.read_file(request.clone(), project.clone(), "logo.png".to_string());
    harness.answer("read image file", &request)?;
    ensure!(
        harness.view.contents.last().is_some_and(|(_, _, content)| matches!(content, FileContent::Image { mime_type, data } if mime_type == "image/png" && data.len() == PNG.len())),
        "image content"
    );
    for (step, relative) in [
        ("traversal rejected", "../../../../etc/hosts"),
        ("symlink escape rejected", "escape"),
        ("absolute rejected", "/etc/hosts"),
    ] {
        let request = harness.request();
        harness.studio.read_file(request.clone(), project.clone(), relative.to_string());
        let id = request.clone();
        harness.pump_until(step, move |view| view.answered(&id))?;
        let message = harness.view.failure(&request).context("traversal must fail")?;
        ensure!(message.contains("outside the project"), "unexpected message {message}");
    }
    let request = harness.request();
    harness.studio.list_directory(request.clone(), project.clone(), "..".to_string());
    let id = request.clone();
    harness.pump_until("listing the parent rejected", move |view| view.answered(&id))?;
    ensure!(harness.view.failure(&request).is_some(), "parent listing must fail");

    let request = harness.request();
    harness.studio.search_files(request.clone(), project.clone(), "mainrs".to_string(), 5);
    harness.answer("fuzzy file search", &request)?;
    let hits = harness.view.hits.last().map(|(_, hits)| hits.clone()).unwrap_or_default();
    println!("     file hits {:?}", hits.iter().map(|hit| &hit.relative).collect::<Vec<_>>());
    ensure!(hits.first().is_some_and(|hit| hit.relative == "src/main.rs"), "src/main.rs ranks first");
    let request = harness.request();
    harness.studio.search_text(request.clone(), project.clone(), "hello".to_string(), 10);
    harness.answer("text search", &request)?;
    let hits = harness.view.hits.last().map(|(_, hits)| hits.clone()).unwrap_or_default();
    println!("     text hits {hits:?}");
    ensure!(
        hits.iter()
            .any(|hit| hit.relative == "src/main.rs" && hit.line == Some(2) && hit.preview.contains("hello workspace")),
        "text hit with line"
    );
    Ok(())
}

fn terminal_and_commit(harness: &mut Harness, project: &str) -> anyhow::Result<()> {
    let project = project.to_string();
    let request = harness.request();
    harness.studio.open_terminal(request.clone(), project.clone(), 100, 30);
    harness.answer("terminal opened", &request)?;
    let terminal = harness.view.terminals.last().map(|(_, terminal)| terminal.clone()).context("terminal id")?;
    harness.studio.resize_terminal(terminal.clone(), 120, 40);
    harness.studio.write_terminal(terminal.clone(), b"echo hi-from-$((40+2))\n".to_vec());
    let id = terminal.clone();
    harness.pump_until("terminal echoed", move |view| view.terminal_text(&id).contains("hi-from-42"))?;
    harness.studio.close_terminal(terminal.clone());
    let id = terminal.clone();
    harness
        .pump_until("terminal exited after close", move |view| view.exited.iter().any(|(exited, _)| *exited == id))?;

    let request = harness.request();
    harness.studio.commit(request.clone(), project.clone(), None);
    harness.answer("commit with generated message", &request)?;
    let subject = git(Path::new(&project), &["log", "-1", "--format=%s"])?;
    println!("     committed: {}", subject.trim());
    ensure!(subject.contains("README.md") && subject.contains("notes.txt"), "generated message names files");
    harness.pump_until("clean after commit", |view| view.status(&project).is_some_and(|status| !status.dirty))?;
    git(Path::new(&project), &["checkout", "--quiet", "-b", "watched"])?;
    harness.pump_until("watcher pushed git status after an outside checkout", |view| {
        view.status(&project).is_some_and(|status| status.branch.as_deref() == Some("watched"))
    })?;

    let request = harness.request();
    harness.studio.push(request.clone(), project.clone());
    let id = request.clone();
    harness.pump_until("push without a remote answers", move |view| view.answered(&id))?;
    ensure!(harness.view.failure(&request).is_some_and(|message| message.contains("no remote")), "push must fail");
    Ok(())
}

fn settings_providers_usage(harness: &mut Harness, project: &str) -> anyhow::Result<()> {
    let project = project.to_string();
    let mut settings = harness.view.settings.clone().context("settings")?;
    settings.color_scheme = ColorScheme::Dark;
    settings.send_shortcut = SendShortcut::ModEnter;
    settings.working_section = true;
    settings.code_font_size = 15;
    settings.fleet_key = String::new();
    harness.studio.update_settings(settings);
    harness.pump_until("settings saved", |view| {
        view.settings.as_ref().is_some_and(|settings| settings.color_scheme == ColorScheme::Dark)
    })?;
    harness.studio.set_keybinding("sidebar.toggle".to_string(), Some("Shift+Cmd+B".to_string()));
    harness.studio.set_keybinding("terminal.toggle".to_string(), None);
    harness.pump_until("keybindings updated", |view| {
        view.keybindings.as_ref().is_some_and(|bindings| {
            bindings.iter().any(|binding| {
                binding.command == "sidebar.toggle" && binding.shortcut.as_deref() == Some("cmd+shift+b")
            }) && bindings.iter().any(|binding| binding.command == "terminal.toggle" && binding.shortcut.is_none())
        })
    })?;

    harness.studio.load_providers();
    harness.pump_until("providers derived from the model catalog", |view| {
        view.providers.as_ref().is_some_and(|providers| !providers.is_empty())
    })?;
    println!("     providers {:?}", harness.view.providers);

    harness.studio.start_thread(
        "usage-draft".to_string(),
        Some(project.clone()),
        PromptDraft { text: "run the smoke command".to_string(), images: Vec::new(), files: Vec::new() },
        ThreadSettings {
            provider: None,
            model: None,
            thinking_level: None,
            access: AccessMode::FullAccess,
            worktree: WorktreeChoice::Local,
        },
    );
    harness
        .pump_until("thread started for usage", |view| view.started.iter().any(|(draft, _)| draft == "usage-draft"))?;
    let thread = harness.view.started.iter().find(|(draft, _)| draft == "usage-draft").map(|(_, id)| id.clone());
    let thread = thread.context("thread id")?;
    let id = thread.clone();
    harness.pump_until("thread finished", move |view| {
        view.threads.iter().any(|row| row.id == id && matches!(row.status, ThreadStatus::Done | ThreadStatus::Idle))
    })?;
    let request = harness.request();
    harness.studio.load_usage(request.clone(), UsagePeriod::Day);
    harness.answer("usage report", &request)?;
    let (_, report) = harness.view.usage.last().cloned().context("usage")?;
    println!(
        "     usage requests {} tokens {} (in {} out {}) cost {:.4} models {:?} days {:?} limits {:?}",
        report.requests,
        report.total_tokens,
        report.input_tokens,
        report.output_tokens,
        report.cost_usd,
        report.by_model,
        report.daily.iter().map(|day| (&day.day, day.tokens)).collect::<Vec<_>>(),
        report.limits
    );
    ensure!(report.requests >= 1 && !report.by_model.is_empty() && !report.daily.is_empty(), "usage covers the run");

    let request = harness.request();
    harness.studio.load_diff(request.clone(), project.clone(), DiffScope::LatestTurn { thread });
    harness.answer("latest-turn diff after a turn", &request)?;
    Ok(())
}

fn local(harness: &mut Harness, port: u16) -> anyhow::Result<()> {
    if which("bun") {
        let request = harness.request();
        harness.studio.local_snapshot(request.clone());
        harness.answer("Local snapshot from a controller the core started", &request)?;
        let (_, snapshot) = harness.view.local.last().cloned().context("snapshot")?;
        println!(
            "     local controllers {:?} usage requests {} registry {:?}",
            snapshot
                .controllers
                .iter()
                .map(|controller| (&controller.name, controller.local, controller.reachable))
                .collect::<Vec<_>>(),
            snapshot.usage.requests,
            snapshot.registry.as_ref().map(|registry| (&registry.error, registry.models.len()))
        );
        ensure!(
            snapshot.controllers.iter().any(|controller| controller.local && controller.reachable),
            "self controller"
        );
        ensure!(TcpStream::connect(("127.0.0.1", port)).is_ok(), "controller listens on the temp port");
        let request = harness.request();
        harness.studio.local_action(
            request.clone(),
            local_studio_core::LocalAction::Rename { controller: String::new(), name: "smoke-box".to_string() },
        );
        harness.answer("Local rename action", &request)?;
        ensure!(
            harness.view.local.last().is_some_and(|(_, snapshot)| snapshot
                .controllers
                .iter()
                .any(|controller| controller.name == "smoke-box")),
            "rename reflected"
        );
    } else {
        println!("skip Local snapshot: bun is not installed");
    }
    Ok(())
}

fn second_run(harness: &mut Harness) -> anyhow::Result<()> {
    harness.pump_until("persisted settings and keybindings reload", |view| {
        view.settings.as_ref().is_some_and(|settings| {
            settings.color_scheme == ColorScheme::Dark
                && settings.send_shortcut == SendShortcut::ModEnter
                && settings.working_section
                && settings.code_font_size == 15
        }) && view.keybindings.as_ref().is_some_and(|bindings| {
            bindings.iter().any(|binding| {
                binding.command == "sidebar.toggle" && binding.shortcut.as_deref() == Some("cmd+shift+b")
            })
        })
    })
}

fn which(program: &str) -> bool {
    Command::new("/usr/bin/which").arg(program).output().is_ok_and(|output| output.status.success())
        || std::env::var_os("HOME").is_some_and(|home| Path::new(&home).join(".bun/bin").join(program).is_file())
}

fn stop_daemon(socket: &Path) -> anyhow::Result<()> {
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    runtime.block_on(async {
        let (client, _events) = DaemonClient::connect(socket).await?;
        client
            .request_ok(DaemonCommand::Shutdown { id: None, force: Some(true), if_idle: None, rest: Map::default() })
            .await?;
        println!("ok   daemon stopped");
        anyhow::Ok(())
    })
}
