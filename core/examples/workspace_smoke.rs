use std::io::{Read, Write};
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
    FileEntry, GitStatus, Keybinding, LocalDashboard, LocalSnapshot, MergeMethod, NewThreadWorkspace, ProjectScript,
    ProjectSettings, PromptDraft, ProviderStatus, PullRequestDetail, SearchHit, SendShortcut, Settings, SetupStage,
    SetupStageState, Shelf, SnapshotSound, Studio, StudioConfig, TerminalColor, TerminalFrame, TerminalKey,
    TerminalKeyAction, TerminalMods, TerminalMouse, TerminalMouseAction, TerminalMouseButton, TerminalPoint,
    TerminalRow, TerminalScroll, TerminalSelect, TerminalSize, ThreadRow, ThreadSettings, ThreadStatus, Update,
    UsagePeriod, UsageReport, Waker, WorktreeChoice, WritingStyle,
};
use serde_json::Map;

#[path = "support/real_model.rs"]
mod real_model;

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
    screens: Vec<(String, Screen)>,
    texts: Vec<(String, String)>,
    exited: Vec<(String, Option<i32>)>,
    usage: Vec<(String, UsageReport)>,
    local: Vec<(String, LocalSnapshot)>,
    dashboards: Vec<LocalDashboard>,
    providers: Option<Vec<ProviderStatus>>,
    settings: Option<Settings>,
    keybindings: Option<Vec<Keybinding>>,
    done: Vec<(String, String)>,
    failed: Vec<(String, String)>,
    details: Vec<(String, PullRequestDetail)>,
    devices: Vec<(String, Vec<Device>)>,
    project_scripts: Vec<(String, Vec<ProjectScript>)>,
    project_settings: Vec<(String, ProjectSettings, Settings)>,
    setups: Vec<(String, Vec<SetupStage>, bool, Option<String>)>,
    pulls: Vec<String>,
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
            || self.pulls.iter().any(|id| id == request)
            || self.texts.iter().any(|(id, _)| id == request)
    }

    fn screen(&self, terminal: &str) -> Option<&Screen> {
        self.screens.iter().find(|(id, _)| id == terminal).map(|(_, screen)| screen)
    }

    fn terminal_text(&self, terminal: &str) -> String {
        self.screen(terminal).map(|screen| screen.lines.join("\n")).unwrap_or_default()
    }

    fn text(&self, request: &str) -> Option<&str> {
        self.texts.iter().find(|(id, _)| id == request).map(|(_, text)| text.as_str())
    }

    fn frame(&mut self, terminal: String, frame: &TerminalFrame) {
        let index = if let Some(index) = self.screens.iter().position(|(id, _)| *id == terminal) {
            index
        } else {
            self.screens.push((terminal, Screen::default()));
            self.screens.len() - 1
        };
        self.screens[index].1.apply(frame);
    }

    fn status(&self, project: &str) -> Option<&GitStatus> {
        self.statuses.iter().rev().find(|(id, _)| id == project).map(|(_, status)| status)
    }
}

#[derive(Default)]
struct Screen {
    cols: u16,
    rows: u16,
    lines: Vec<String>,
    reds: usize,
    frames: usize,
    has_selection: bool,
    scrollback_len: u64,
    viewport_offset: u64,
}

impl Screen {
    fn apply(&mut self, frame: &TerminalFrame) {
        if frame.full || self.cols != frame.cols || self.rows != frame.rows {
            self.lines = vec![String::new(); usize::from(frame.rows)];
            self.reds = 0;
        }
        self.cols = frame.cols;
        self.rows = frame.rows;
        for row in &frame.dirty {
            if let Some(line) = self.lines.get_mut(usize::from(row.index)) {
                *line = row_text(row);
            }
            self.reds += row
                .runs
                .iter()
                .filter(|run| run.text.contains("red") && run.style.foreground == TerminalColor::Palette { index: 1 })
                .count();
        }
        self.frames += 1;
        self.has_selection = frame.has_selection;
        self.scrollback_len = frame.scrollback_len;
        self.viewport_offset = frame.viewport_offset;
    }

    fn row_of(&self, text: &str) -> Option<u16> {
        self.lines.iter().position(|line| line.trim_end() == text).and_then(|index| u16::try_from(index).ok())
    }
}

fn row_text(row: &TerminalRow) -> String {
    let mut line = String::new();
    let mut column = 0;
    for run in &row.runs {
        while column < run.column {
            line.push(' ');
            column += 1;
        }
        line.push_str(&run.text);
        column = run.column + run.cells;
    }
    line
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
            Update::TerminalFrame { terminal, frame } => view.frame(terminal, &frame),
            Update::TerminalText { request, text, .. } => view.texts.push((request, text)),
            Update::TerminalExited { terminal, code } => view.exited.push((terminal, code)),
            Update::Usage { request, report } => view.usage.push((request, report)),
            Update::Local { request, snapshot } => view.local.push((request, snapshot)),
            Update::LocalDashboard { dashboard } => view.dashboards.push(dashboard),
            Update::Providers { providers, .. } => view.providers = Some(providers),
            Update::Settings { settings } => view.settings = Some(settings),
            Update::Keybindings { bindings } => view.keybindings = Some(bindings),
            Update::PullRequestDetail { request, detail } => view.details.push((request, detail)),
            Update::Devices { request, devices } => view.devices.push((request, devices)),
            Update::PullRequests { request, .. } => view.pulls.push(request),
            Update::ProjectScripts { project, scripts } => view.project_scripts.push((project, scripts)),
            Update::ProjectSettings { project, settings, effective } => {
                view.project_settings.push((project, settings, effective));
            }
            Update::WorktreeSetup { thread, stages, done, error } => {
                if done {
                    println!(
                        "     setup {thread}: {:?} error {error:?}",
                        stages.iter().map(|stage| (&stage.name, stage.state, &stage.output_tail)).collect::<Vec<_>>()
                    );
                }
                view.setups.push((thread, stages, done, error));
            }
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
            | Update::ThreadSearch { .. }
            | Update::Daemon { .. }
            | Update::Skills { .. }
            | Update::Subagents { .. }
            | Update::MessageImage { .. }
            | Update::ProviderModels { .. } => {}
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

const GENERATED_MARK: &str = "smokegen";

const PR_TEMPLATE: &str = "## Summary\n\n## Testing\n";

const FAKE_GH: &str = r#"#!/bin/sh
case "$1 $2" in
  "pr view") cat "$FAKE_GH_DIR/pr-view.json" ;;
  "pr diff") cat "$FAKE_GH_DIR/pr-diff.patch" ;;
  "pr list") case "$*" in *"--head watched"*) cat "$FAKE_GH_DIR/pr-list.json" ;; *) echo "[]" ;; esac ;;
  "pr checkout") git checkout --quiet -B "pr-$3" ;;
  "pr merge") echo "$@" > "$FAKE_GH_DIR/last-merge.txt" ;;
  "pr create") printf '%s\n' "$@" > "$FAKE_GH_DIR/last-create.txt"; echo "https://github.com/smoke/repo/pull/7" ;;
  "repo view") echo '{"mergeCommitAllowed":false,"squashMergeAllowed":true,"rebaseMergeAllowed":true}' ;;
  "api "*) cat "$FAKE_GH_DIR/review-comments.json" ;;
  "repo create")
    git init --quiet --bare "$FAKE_GH_DIR/remote.git" &&
      git remote add origin "$FAKE_GH_DIR/remote.git" &&
      git push --quiet -u origin HEAD 2>/dev/null &&
      echo "https://github.com/smoke/$3" ;;
  *) echo "fake gh: unsupported $*" >&2; exit 1 ;;
esac
"#;

const PR_LIST: &str = r#"[{"number":7,"title":"Add feature","url":"https://github.com/smoke/repo/pull/7","state":"MERGED",
"headRefName":"watched","baseRefName":"main","statusCheckRollup":[]}]"#;

const LOCAL_STUDIO_JSON: &str = r#"{
  // JSONC is tolerated
  "scripts": [
    { "name": "Echo", "command": "echo setup-ran-in-$(basename \"$LOCAL_STUDIO_WORKTREE_PATH\")", "runOnWorktreeCreate": true, "async": false },
    { "name": "Hello", "command": "echo script-ran", "icon": "test" },
  ],
}
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

const FAKE_NVIDIA_SMI: &str = r"#!/bin/sh
case $1 in --query-gpu=*)
  printf '0, GPU-smoke-0, NVIDIA RTX PRO 6000 Blackwell Workstation Edition, 95000, 97887, 275.40, 275.00, 65, 100\n'
  printf '1, GPU-smoke-1, NVIDIA RTX PRO 6000 Blackwell Workstation Edition, 96000, 97887, 276.00, 275.00, 48, 100\n' ;;
esac
";

fn serve_stub_engine(listener: &TcpListener, born: Instant) {
    for mut stream in listener.incoming().flatten() {
        let mut request = Vec::new();
        let mut buffer = [0_u8; 1024];
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            match stream.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => request.extend_from_slice(&buffer[..read]),
            }
        }
        let head = String::from_utf8_lossy(&request);
        let path = head.split_whitespace().nth(1).unwrap_or_default();
        let elapsed = born.elapsed().as_millis();
        let ttft_millis = elapsed / 1000 * 346;
        let (kind, body) = match path {
            "/v1/models" => ("application/json", r#"{"data":[{"id":"smoke-model"}]}"#.to_string()),
            "/metrics" => (
                "text/plain; version=0.0.4",
                format!(
                    "vllm:generation_tokens_total{{model_name=\"smoke-model\"}} {}\nvllm:prompt_tokens_total{{model_name=\"smoke-model\"}} {}\nvllm:num_requests_running 4\nvllm:num_requests_waiting 0\nvllm:kv_cache_usage_perc 0.04\nvllm:time_to_first_token_seconds_sum {}.{:03}\nvllm:time_to_first_token_seconds_count {}\n",
                    elapsed * 2 / 5,
                    elapsed * 2,
                    ttft_millis / 1000,
                    ttft_millis % 1000,
                    elapsed / 1000,
                ),
            ),
            _ => ("application/json", "{}".to_string()),
        };
        let reply = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: {kind}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(reply.as_bytes());
    }
}

fn start_stub_engine(bin: &Path) -> anyhow::Result<u16> {
    use std::os::unix::fs::PermissionsExt;
    let smi = bin.join("nvidia-smi");
    std::fs::write(&smi, FAKE_NVIDIA_SMI)?;
    std::fs::set_permissions(&smi, std::fs::Permissions::from_mode(0o755))?;
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    let born = Instant::now();
    std::thread::spawn(move || serve_stub_engine(&listener, born));
    Ok(port)
}

fn install_fake_gh(root: &Path) -> anyhow::Result<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let bin = root.join("bin");
    let fixtures = root.join("fake-gh");
    std::fs::create_dir_all(&bin)?;
    std::fs::create_dir_all(&fixtures)?;
    std::fs::write(fixtures.join("pr-view.json"), PR_VIEW)?;
    std::fs::write(fixtures.join("pr-diff.patch"), PR_DIFF)?;
    std::fs::write(fixtures.join("review-comments.json"), REVIEW_COMMENTS)?;
    std::fs::write(fixtures.join("pr-list.json"), PR_LIST)?;
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
    let _credentials = real_model::install(&agent_dir)?;
    make_repo(&repo)?;
    let repo = repo.canonicalize()?;
    let port = free_port()?;
    install_fake_gh(&root)?;
    let engine = start_stub_engine(&root.join("bin"))?;
    println!("     stub engine on port {engine}");
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
    let outcome = second_run(&mut restarted, &repo.to_string_lossy());
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
    project_scripts_and_settings(harness, &project)?;
    worktree_setup(harness, &project)?;
    thread_links_and_forge(harness, &project)?;
    text_generation_and_cleanup(harness, &project)?;
    local(harness, port)
}

fn project_scripts_and_settings(harness: &mut Harness, project: &str) -> anyhow::Result<()> {
    let project = project.to_string();
    std::fs::write(Path::new(&project).join("local-studio.json"), LOCAL_STUDIO_JSON)?;
    let request = harness.request();
    harness.studio.import_project_scripts(request.clone(), project.clone());
    harness.answer("import scripts from local-studio.json (JSONC)", &request)?;
    let id = project.clone();
    harness.pump_until("imported scripts pushed", move |view| {
        view.project_scripts.iter().rev().find(|(owner, _)| *owner == id).is_some_and(|(_, scripts)| scripts.len() == 2)
    })?;
    let scripts = harness.view.project_scripts.last().map(|(_, scripts)| scripts.clone()).unwrap_or_default();
    println!("     scripts {:?}", scripts.iter().map(|script| (&script.id, &script.command)).collect::<Vec<_>>());
    ensure!(
        scripts[0].id == "echo" && scripts[0].run_on_worktree_setup && scripts[0].wait_for_setup,
        "setup script flags imported"
    );
    ensure!(scripts[1].id == "hello" && scripts[1].icon.as_deref() == Some("test"), "second script imported");
    let mut edited = scripts.clone();
    edited[1].keybinding = Some("CMD+SHIFT+1".to_string());
    harness.studio.set_project_scripts(project.clone(), edited);
    harness.pump_until("scripts edited", |view| {
        view.project_scripts.last().is_some_and(|(_, scripts)| scripts[1].keybinding.as_deref() == Some("cmd+shift+1"))
    })?;
    let request = harness.request();
    harness.studio.run_project_script(request.clone(), project.clone(), "hello".to_string());
    harness.answer("project script runs in a new terminal", &request)?;
    let terminal = harness.view.terminals.last().map(|(_, terminal)| terminal.clone()).context("terminal")?;
    let id = terminal.clone();
    harness.pump_until("script output streamed", move |view| view.terminal_text(&id).contains("script-ran"))?;
    harness.studio.close_terminal(terminal);

    let overrides = ProjectSettings {
        default_model: Some(real_model::MODEL.to_string()),
        new_thread_workspace: Some(NewThreadWorkspace::Worktree),
        new_worktrees_start_from_origin: Some(false),
        ..ProjectSettings::default()
    };
    harness.studio.update_project_settings(project.clone(), overrides);
    let id = project.clone();
    harness.pump_until("project overrides change the effective settings only for the project", move |view| {
        view.project_settings.iter().rev().find(|(owner, _, _)| *owner == id).is_some_and(|(_, settings, effective)| {
            settings.default_model.as_deref() == Some(real_model::MODEL)
                && effective.default_model.as_deref() == Some(real_model::MODEL)
                && effective.new_thread_workspace == NewThreadWorkspace::Worktree
                && !effective.new_worktrees_start_from_origin
        }) && view.settings.as_ref().is_some_and(|global| global.new_thread_workspace == NewThreadWorkspace::Local)
    })?;
    Ok(())
}

fn thread_settings(worktree: WorktreeChoice) -> ThreadSettings {
    real_model::thread_settings(AccessMode::FullAccess, worktree)
}

fn worktree_setup(harness: &mut Harness, project: &str) -> anyhow::Result<()> {
    let project = project.to_string();
    harness.studio.start_thread(
        "setup-draft".to_string(),
        Some(project.clone()),
        PromptDraft { text: "Reply with only the word hello.".to_string(), images: Vec::new(), files: Vec::new() },
        thread_settings(WorktreeChoice::NewWorktree { branch: "smoke/setup".to_string(), base: Some("main".into()) }),
    );
    harness.pump_until("worktree setup ran the local-studio.json setup script before the thread", |view| {
        view.setups.iter().any(|(draft, stages, done, error)| {
            draft == "setup-draft"
                && *done
                && error.is_none()
                && stages.iter().all(|stage| stage.state == SetupStageState::Done)
                && stages.iter().any(|stage| stage.output_tail.contains("setup-ran-in-smoke-setup"))
        })
    })?;
    harness.pump_until("thread started in the prepared worktree", |view| {
        view.started.iter().any(|(draft, _)| draft == "setup-draft")
    })?;

    let mut scripts = harness.view.project_scripts.last().map(|(_, scripts)| scripts.clone()).unwrap_or_default();
    scripts.push(ProjectScript {
        id: "slow".to_string(),
        name: "Slow".to_string(),
        command: "echo slow-started; sleep 60".to_string(),
        icon: None,
        keybinding: None,
        run_on_worktree_setup: true,
        wait_for_setup: true,
    });
    harness.studio.set_project_scripts(project.clone(), scripts);
    harness.pump_until("slow setup script saved", |view| {
        view.project_scripts.last().is_some_and(|(_, scripts)| scripts.iter().any(|script| script.id == "slow"))
    })?;
    for (draft, branch, cancel) in [("cancel-draft", "smoke/cancel", true), ("local-draft", "smoke/local", false)] {
        harness.studio.start_thread(
            draft.to_string(),
            Some(project.clone()),
            PromptDraft { text: "Reply with only the word local.".to_string(), images: Vec::new(), files: Vec::new() },
            thread_settings(WorktreeChoice::NewWorktree { branch: branch.to_string(), base: Some("main".into()) }),
        );
        let id = draft.to_string();
        harness.pump_until("slow setup script running", move |view| {
            view.setups.iter().any(|(owner, stages, _, _)| {
                *owner == id && stages.iter().any(|stage| stage.output_tail.contains("slow-started"))
            })
        })?;
        if cancel {
            harness.studio.cancel_worktree_setup(draft.to_string());
        } else {
            harness.studio.skip_worktree_setup(draft.to_string());
        }
        let id = draft.to_string();
        harness.pump_until(if cancel { "setup cancelled" } else { "work locally skips the setup" }, move |view| {
            view.setups.iter().any(|(owner, _, done, error)| {
                *owner == id && *done && (error.as_deref().is_some_and(|text| text.contains("cancelled")) == cancel)
            })
        })?;
        let worktree =
            Path::new(&std::env::var("LOCAL_STUDIO_DATA_DIR")?).join("worktrees/repo").join(branch.replace('/', "-"));
        ensure!(!worktree.exists(), "{} should be removed", worktree.display());
    }
    harness.pump_until("Work locally starts the thread in the project folder", |view| {
        view.started.iter().any(|(draft, _)| draft == "local-draft")
    })?;
    ensure!(!harness.view.started.iter().any(|(draft, _)| draft == "cancel-draft"), "cancelled draft never started");
    let mut scripts = harness.view.project_scripts.last().map(|(_, scripts)| scripts.clone()).unwrap_or_default();
    scripts.retain(|script| script.id != "slow");
    harness.studio.set_project_scripts(project, scripts);
    Ok(())
}

fn thread_links_and_forge(harness: &mut Harness, project: &str) -> anyhow::Result<()> {
    let project = project.to_string();
    harness.pump_until("thread rows carry their branch PR and merged PRs auto-settle", |view| {
        view.threads.iter().any(|row| {
            row.branch.as_deref() == Some("watched")
                && row.pull_request.as_ref().is_some_and(|pull| pull.number == 7 && pull.state == "MERGED")
                && row.shelf == Shelf::Settled
        })
    })?;
    ensure!(
        harness.view.threads.iter().all(|row| row.branch.as_deref() == Some("watched") || row.pull_request.is_none()),
        "only threads on the PR's head branch carry it"
    );

    let request = harness.request();
    harness.studio.checkout_pull_request(request.clone(), project.clone(), 7);
    harness.answer("PR checked out into its own worktree", &request)?;
    let worktree = harness.view.done.last().map(|(_, path)| path.clone()).context("pr worktree")?;
    ensure!(worktree.contains("pr-7-feature"), "worktree named after the PR");
    let id = worktree.clone();
    harness.pump_until("PR worktree on the PR branch", move |view| {
        view.status(&id).is_some_and(|status| status.branch.as_deref() == Some("pr-7"))
    })?;

    let fixtures = PathBuf::from(std::env::var_os("FAKE_GH_DIR").context("fake gh")?);
    let request = harness.request();
    harness.studio.merge_pull_request(request.clone(), project.clone(), 7, None);
    harness.answer("merge with the repository default method", &request)?;
    let merged = std::fs::read_to_string(fixtures.join("last-merge.txt"))?;
    ensure!(merged.contains("--squash"), "repository default resolved to squash: {merged}");
    let request = harness.request();
    harness.studio.merge_pull_request(request.clone(), project.clone(), 7, Some(MergeMethod::Rebase));
    harness.answer("merge with an explicit method", &request)?;
    ensure!(std::fs::read_to_string(fixtures.join("last-merge.txt"))?.contains("--rebase"), "rebase");

    let parent = fixtures.join("clones");
    let request = harness.request();
    harness.studio.clone_project(
        request.clone(),
        fixtures.join("remote.git").to_string_lossy().into_owned(),
        parent.to_string_lossy().into_owned(),
    );
    harness.answer("clone a repository into a new project", &request)?;
    let checkout = harness.view.done.last().map(|(_, path)| path.clone()).context("clone path")?;
    ensure!(Path::new(&checkout).join(".git").is_dir(), "cloned");
    let id = checkout.clone();
    harness.pump_until("cloned folder added as a project", move |view| view.projects.contains(&id))?;
    Ok(())
}

fn text_generation_and_cleanup(harness: &mut Harness, project: &str) -> anyhow::Result<()> {
    let project = project.to_string();
    git(Path::new(&project), &["fetch", "--quiet", "origin"])?;
    git(Path::new(&project), &["reset", "--quiet", "--hard", "origin/watched"])?;
    let fixtures = PathBuf::from(std::env::var_os("FAKE_GH_DIR").context("fake gh")?);
    let mut settings = harness.view.settings.clone().context("settings")?;
    settings.text_generation_provider = Some(real_model::PROVIDER.to_string());
    settings.text_generation_model = Some(real_model::MODEL.to_string());
    settings.writing_style = WritingStyle::Custom;
    settings.writing_instructions =
        format!("Begin the commit subject or pull request title with the word {GENERATED_MARK}.");
    settings.worktree_cleanup_unchanged = true;
    harness.studio.update_settings(settings);
    harness.pump_until("text model and cleanup rule saved", |view| {
        view.settings.as_ref().is_some_and(|settings| settings.worktree_cleanup_unchanged)
    })?;
    std::fs::write(Path::new(&project).join("GENERATED.md"), "generated\n")?;
    let request = harness.request();
    harness.studio.commit(request.clone(), project.clone(), None);
    harness.answer("commit message from the text generation model", &request)?;
    let subject = git(Path::new(&project), &["log", "-1", "--format=%s"])?;
    ensure!(
        subject.to_lowercase().contains(GENERATED_MARK),
        "the commit subject did not come from the model following the writing instructions: {subject}"
    );
    println!("     generated subject {:?}", subject.trim());

    std::fs::create_dir_all(Path::new(&project).join(".github"))?;
    std::fs::write(Path::new(&project).join(".github/pull_request_template.md"), PR_TEMPLATE)?;
    let request = harness.request();
    harness.studio.create_pull_request(request.clone(), project.clone(), String::new(), String::new(), false);
    harness.answer("PR title and body from the text model with the template", &request)?;
    let created = std::fs::read_to_string(fixtures.join("last-create.txt"))?;
    let body = created.split_once("--body\n").map(|(_, body)| body.trim()).context("gh got no --body")?;
    ensure!(
        body.contains("## Summary") && body != PR_TEMPLATE.trim(),
        "the PR body is not the model's filled-in template: {created}"
    );
    println!("     generated PR text {:?}", created.lines().skip_while(|line| *line != "--title").nth(1));

    let request = harness.request();
    harness.studio.cleanup_worktrees(request.clone());
    harness.answer("worktree retention sweep", &request)?;
    let message = harness.view.done.last().map(|(_, message)| message.clone()).unwrap_or_default();
    ensure!(message.contains("smoke-worktree"), "the unchanged smoke/worktree is removed: {message}");
    ensure!(!message.contains("smoke-setup"), "worktrees of open threads are protected: {message}");
    Ok(())
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

const ENTER: u32 = 36;
const KEY_C: u32 = if cfg!(target_os = "macos") { 0x08 } else { 54 };

fn cell_size(cols: u16, rows: u16) -> TerminalSize {
    TerminalSize { cols, rows, cell_width: 16, cell_height: 32 }
}

fn click(harness: &Harness, terminal: &str, action: TerminalMouseAction, column: u16, row: u16) {
    let mouse = TerminalMouse {
        action,
        button: Some(TerminalMouseButton::Left),
        x: f64::from(column) * 16.0 + 4.0,
        y: f64::from(row) * 32.0 + 8.0,
        mods: TerminalMods::default(),
    };
    harness.studio.terminal_mouse(terminal.to_string(), mouse);
}

fn terminal(harness: &mut Harness, project: &str) -> anyhow::Result<()> {
    let request = harness.request();
    harness.studio.open_terminal(request.clone(), project.to_string(), 100, 30);
    harness.answer("terminal opened", &request)?;
    let terminal = harness.view.terminals.last().map(|(_, terminal)| terminal.clone()).context("terminal id")?;
    let id = terminal.clone();
    harness.pump_until("first terminal frame is a full screen", move |view| {
        view.screen(&id).is_some_and(|screen| screen.cols == 100 && screen.rows == 30)
    })?;
    harness.studio.resize_terminal(terminal.clone(), cell_size(120, 40));
    let id = terminal.clone();
    harness.pump_until("resize yields a 120x40 frame", move |view| {
        view.screen(&id).is_some_and(|screen| screen.cols == 120 && screen.rows == 40)
    })?;
    harness
        .studio
        .write_terminal(terminal.clone(), b"echo hi-from-$((40+2)); printf '\\033[31mred\\033[0m\\n'".to_vec());
    let enter = TerminalKey {
        action: TerminalKeyAction::Press,
        code: ENTER,
        mods: TerminalMods::default(),
        text: None,
        unshifted: 0,
        composing: false,
    };
    harness.studio.terminal_key(terminal.clone(), enter);
    let id = terminal.clone();
    harness.pump_until("echo through the PTY shows in a frame", move |view| {
        view.screen(&id).is_some_and(|screen| screen.row_of("hi-from-42").is_some())
    })?;
    let id = terminal.clone();
    harness.pump_until("SGR colour arrives as a palette run", move |view| {
        view.screen(&id).is_some_and(|screen| screen.reds > 0 && screen.row_of("red").is_some())
    })?;
    let screen = harness.view.screen(&terminal).context("screen")?;
    let row = screen.row_of("hi-from-42").context("echo row")?;
    println!("     {} frames, echo on row {row}", screen.frames);

    harness.studio.terminal_select(terminal.clone(), TerminalSelect::Line { at: TerminalPoint { column: 0, row } });
    let id = terminal.clone();
    harness.pump_until("line selection marks the frame", move |view| {
        view.screen(&id).is_some_and(|screen| screen.has_selection)
    })?;
    let request = harness.request();
    harness.studio.terminal_selection_text(request.clone(), terminal.clone());
    harness.answer("selection text", &request)?;
    let selected = harness.view.text(&request).unwrap_or_default().to_string();
    ensure!(selected == "hi-from-42", "line selection text was {selected:?}");

    harness.studio.terminal_select(terminal.clone(), TerminalSelect::Clear);
    for action in [
        TerminalMouseAction::Press,
        TerminalMouseAction::Release,
        TerminalMouseAction::Press,
        TerminalMouseAction::Release,
    ] {
        click(harness, &terminal, action, 1, row);
    }
    let id = terminal.clone();
    harness.pump_until("double click selects a word", move |view| {
        view.screen(&id).is_some_and(|screen| screen.has_selection)
    })?;
    let request = harness.request();
    harness.studio.terminal_selection_text(request.clone(), terminal.clone());
    harness.answer("word text", &request)?;
    let word = harness.view.text(&request).unwrap_or_default().to_string();
    ensure!(!word.is_empty() && "hi-from-42".contains(word.as_str()), "double click selected {word:?}");
    println!("     double click selected {word:?}");

    let request = harness.request();
    harness.studio.terminal_recent_output(request.clone(), terminal.clone(), 20);
    harness.answer("recent output", &request)?;
    let recent = harness.view.text(&request).unwrap_or_default().to_string();
    ensure!(recent.contains("hi-from-42") && recent.contains("red"), "recent output was {recent:?}");
    reflow_and_scroll(harness, &terminal)?;
    harness.studio.close_terminal(terminal.clone());
    let id = terminal.clone();
    harness
        .pump_until("terminal exited after close", move |view| view.exited.iter().any(|(exited, _)| *exited == id))?;
    Ok(())
}

fn reflow_and_scroll(harness: &mut Harness, terminal: &str) -> anyhow::Result<()> {
    let terminal = terminal.to_string();
    harness.studio.write_terminal(terminal.clone(), b"printf 'cat-%s\\n' ready; cat\n".to_vec());
    let id = terminal.clone();
    harness.pump_until("cat holds the foreground so the shell cannot redraw", move |view| {
        view.screen(&id).is_some_and(|screen| screen.row_of("cat-ready").is_some())
    })?;
    harness.studio.resize_terminal(terminal.clone(), cell_size(6, 40));
    let id = terminal.clone();
    harness.pump_until("narrow resize reflows the echo", move |view| {
        view.screen(&id).is_some_and(|screen| {
            screen.cols == 6 && screen.lines.windows(2).any(|pair| pair[0] == "hi-fro" && pair[1].trim_end() == "m-42")
        })
    })?;
    harness.studio.resize_terminal(terminal.clone(), cell_size(120, 40));
    let id = terminal.clone();
    harness.pump_until("widening restores the width", move |view| {
        view.screen(&id).is_some_and(|screen| screen.cols == 120)
    })?;
    let top = TerminalScroll { lines: -10_000, x: 0.0, y: 0.0, mods: TerminalMods::default() };
    harness.studio.terminal_scroll(terminal.clone(), top);
    let id = terminal.clone();
    harness.pump_until("widening reflows the echo back onto one row", move |view| {
        view.screen(&id).is_some_and(|screen| screen.row_of("hi-from-42").is_some())
    })?;
    let bottom = TerminalScroll { lines: 10_000, x: 0.0, y: 0.0, mods: TerminalMods::default() };
    harness.studio.terminal_scroll(terminal.clone(), bottom);
    let interrupt = TerminalKey {
        action: TerminalKeyAction::Press,
        code: KEY_C,
        mods: TerminalMods { control: true, ..TerminalMods::default() },
        text: Some("c".to_string()),
        unshifted: u32::from('c'),
        composing: false,
    };
    harness.studio.terminal_key(terminal.clone(), interrupt);
    let id = terminal.clone();
    harness.pump_until("ctrl+c through the key encoder ends cat", move |view| {
        view.screen(&id).is_some_and(|screen| screen.lines.iter().any(|line| line.trim_end() == "^C"))
    })?;

    harness.studio.write_terminal(terminal.clone(), b"seq 1 300\n".to_vec());
    let id = terminal.clone();
    harness.pump_until("long output fills the scrollback", move |view| {
        view.screen(&id).is_some_and(|screen| screen.row_of("300").is_some() && screen.scrollback_len > 200)
    })?;
    let scroll = TerminalScroll { lines: -10, x: 0.0, y: 0.0, mods: TerminalMods::default() };
    harness.studio.terminal_scroll(terminal.clone(), scroll);
    let id = terminal.clone();
    harness.pump_until("scrolling moves the viewport into history", move |view| {
        view.screen(&id).is_some_and(|screen| {
            screen.viewport_offset + 10 == screen.scrollback_len && screen.row_of("300").is_none()
        })
    })?;

    Ok(())
}

fn terminal_and_commit(harness: &mut Harness, project: &str) -> anyhow::Result<()> {
    terminal(harness, project)?;
    let project = project.to_string();

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
    ensure!(!settings.onboarding_completed, "onboarding starts incomplete");
    settings.onboarding_completed = true;
    settings.custom_themes = r#"[{"name":"Smoke"}]"#.to_string();
    settings.glass_opacity = 250;
    settings.snapshot_sound = SnapshotSound::CameraShutter;
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
        PromptDraft {
            text: "Use the bash tool to run exactly this command once: `echo usage-ok`. Then reply with only the word done.".to_string(),
            images: Vec::new(),
            files: Vec::new(),
        },
        thread_settings(WorktreeChoice::Local),
    );
    harness
        .pump_until("thread started for usage", |view| view.started.iter().any(|(draft, _)| draft == "usage-draft"))?;
    let thread = harness.view.started.iter().find(|(draft, _)| draft == "usage-draft").map(|(_, id)| id.clone());
    let thread = thread.context("thread id")?;
    let id = thread.clone();
    harness.pump_until("thread finished", move |view| {
        view.threads.iter().any(|row| row.id == id && matches!(row.status, ThreadStatus::Done | ThreadStatus::Failed))
    })?;
    let finished = harness.view.threads.iter().find(|row| row.id == thread).map(|row| row.status);
    ensure!(finished != Some(ThreadStatus::Failed), "the usage turn failed; the real model did not answer");
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
    real_model::check_usage(&report)?;

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
        local_dashboard(harness)?;
    } else {
        println!("skip Local snapshot: bun is not installed");
    }
    Ok(())
}

fn local_dashboard(harness: &mut Harness) -> anyhow::Result<()> {
    harness.studio.watch_local_dashboard(Some(String::new()));
    harness.pump_until("live dashboard from the stub engine's /metrics and the fake nvidia-smi", |view| {
        view.dashboards.last().is_some_and(|dashboard| {
            dashboard.error.is_none()
                && dashboard.decode_tps.is_some_and(|tps| (tps - 400.0).abs() < 60.0)
                && dashboard.running == Some(4)
                && dashboard.kv_percent.is_some_and(|kv| (kv - 4.0).abs() < 0.01)
                && dashboard.first_token_ms.is_some_and(|ms| (ms - 346.0).abs() < 1.0)
                && dashboard.gpus.len() == 2
                && dashboard.power_watts.is_some_and(|watts| (watts - 551.4).abs() < 0.01)
                && dashboard
                    .engines
                    .iter()
                    .any(|engine| engine.models == ["smoke-model"] && engine.loaded_at_ms.is_some())
        })
    })?;
    harness.studio.watch_local_dashboard(Some(String::new()));
    harness.pump_until("dashboard history: 24 h decode series and today's tokens", |view| {
        view.dashboards.last().is_some_and(|dashboard| {
            dashboard.decode_series.len() == 288
                && dashboard.tokens.daily.last().is_some_and(|today| *today > 0)
                && dashboard.tokens.read > dashboard.tokens.written
                && dashboard.tokens.active_days == 1
        })
    })?;
    let dashboard = harness.view.dashboards.last().cloned().context("dashboard")?;
    println!(
        "     dashboard decode {:?} tok/s, per request {:?}, first token {:?} ms (best {:?}), in flight {:?} (peak {:?}), kv {:?}% (peak {:?}), {} × {}, {} of {} bytes, {:?} W of {:?} W, tokens {} ({} read, {} written) since {:?}",
        dashboard.decode_tps,
        dashboard.per_request_tps,
        dashboard.first_token_ms,
        dashboard.first_token_best_ms,
        dashboard.running,
        dashboard.running_peak,
        dashboard.kv_percent,
        dashboard.kv_peak_percent,
        dashboard.gpus.len(),
        dashboard.gpu_name,
        dashboard.memory_used_bytes,
        dashboard.memory_total_bytes,
        dashboard.power_watts,
        dashboard.power_limit_watts,
        dashboard.tokens.total,
        dashboard.tokens.read,
        dashboard.tokens.written,
        dashboard.tokens.since_day,
    );
    harness.studio.watch_local_dashboard(None);
    Ok(())
}

fn second_run(harness: &mut Harness, project: &str) -> anyhow::Result<()> {
    harness.studio.load_project_settings(project.to_string());
    let id = project.to_string();
    harness.pump_until("project scripts and overrides persisted", move |view| {
        view.project_scripts.iter().any(|(owner, scripts)| *owner == id && scripts.len() == 2)
            && view.project_settings.iter().any(|(owner, settings, effective)| {
                *owner == id
                    && settings.default_model.as_deref() == Some(real_model::MODEL)
                    && effective.new_thread_workspace == NewThreadWorkspace::Worktree
            })
    })?;
    harness.pump_until("persisted settings and keybindings reload", |view| {
        view.settings.as_ref().is_some_and(|settings| {
            settings.color_scheme == ColorScheme::Dark
                && settings.send_shortcut == SendShortcut::ModEnter
                && settings.working_section
                && settings.code_font_size == 15
                && settings.onboarding_completed
                && settings.custom_themes == r#"[{"name":"Smoke"}]"#
                && settings.glass_opacity == 100
                && settings.snapshot_sound == SnapshotSound::CameraShutter
                && !settings.snapshot_enabled
        }) && view.keybindings.as_ref().is_some_and(|bindings| {
            bindings.iter().any(|binding| {
                binding.command == "sidebar.toggle" && binding.shortcut.as_deref() == Some("cmd+shift+b")
            })
        })
    })?;
    let request = harness.request();
    harness.studio.load_usage(request.clone(), UsagePeriod::Day);
    harness.answer("usage report for the whole run", &request)?;
    let (_, report) = harness.view.usage.last().cloned().context("usage")?;
    real_model::check_usage(&report)
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
