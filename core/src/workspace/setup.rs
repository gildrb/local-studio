use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::sync::{mpsc, oneshot, watch};

use super::model::{ProjectScript, SetupStage, SetupStageState};
use super::{git, process, Workspace};
use crate::model::{NoticeLevel, Update};
use crate::studio::Mailbox;

const TAIL_LINES: usize = 30;
const TAIL_CHARS: usize = 4000;
const PUSH_INTERVAL: Duration = Duration::from_millis(250);
const KILL_GRACE: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PreparedWorktree {
    Worktree(PathBuf),
    Local,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Signal {
    Running,
    Cancel,
    Local,
}

enum Outcome {
    Ready,
    Cancelled,
    Local,
}

#[derive(Default)]
pub(crate) struct Setups {
    controls: Mutex<HashMap<String, watch::Sender<Signal>>>,
    pids: Mutex<HashMap<String, u32>>,
}

impl Setups {
    pub(crate) fn signal(&self, draft: &str, signal: Signal) -> bool {
        let controls = self.controls.lock().unwrap_or_else(PoisonError::into_inner);
        controls.get(draft).is_some_and(|control| control.send(signal).is_ok())
    }

    fn register(&self, draft: &str) -> watch::Receiver<Signal> {
        let (sender, receiver) = watch::channel(Signal::Running);
        self.controls.lock().unwrap_or_else(PoisonError::into_inner).insert(draft.to_string(), sender);
        receiver
    }

    fn finish(&self, draft: &str) {
        self.controls.lock().unwrap_or_else(PoisonError::into_inner).remove(draft);
        self.pids.lock().unwrap_or_else(PoisonError::into_inner).remove(draft);
    }

    fn track(&self, draft: &str, pid: Option<u32>) {
        let mut pids = self.pids.lock().unwrap_or_else(PoisonError::into_inner);
        match pid {
            Some(pid) => pids.insert(draft.to_string(), pid),
            None => pids.remove(draft),
        };
    }

    pub(crate) fn stop_all(&self) {
        let pids: Vec<u32> =
            self.pids.lock().unwrap_or_else(PoisonError::into_inner).drain().map(|(_, pid)| pid).collect();
        for pid in pids {
            process::signal_pid_group("-KILL", pid);
        }
        self.controls.lock().unwrap_or_else(PoisonError::into_inner).clear();
    }
}

struct Progress {
    draft: String,
    stages: Vec<SetupStage>,
    tail: VecDeque<String>,
    mailbox: Arc<Mailbox>,
    pushed: Instant,
    dirty: bool,
}

impl Progress {
    fn new(draft: &str, names: Vec<String>, mailbox: Arc<Mailbox>) -> Self {
        Self {
            draft: draft.to_string(),
            stages: names
                .into_iter()
                .map(|name| SetupStage { name, state: SetupStageState::Pending, output_tail: String::new() })
                .collect(),
            tail: VecDeque::new(),
            mailbox,
            pushed: Instant::now(),
            dirty: false,
        }
    }

    fn set(&mut self, index: usize, state: SetupStageState) {
        if let Some(stage) = self.stages.get_mut(index) {
            stage.state = state;
        }
        self.tail.clear();
        self.push(false, None);
    }

    fn skip_from(&mut self, index: usize) {
        for stage in self.stages.iter_mut().skip(index) {
            if matches!(stage.state, SetupStageState::Pending | SetupStageState::Running) {
                stage.state = SetupStageState::Skipped;
            }
        }
    }

    fn output(&mut self, index: usize, line: &str) {
        self.tail.push_back(line.to_string());
        while self.tail.len() > TAIL_LINES {
            self.tail.pop_front();
        }
        let mut text: String = self.tail.iter().map(String::as_str).collect::<Vec<_>>().join("\n");
        if text.len() > TAIL_CHARS {
            let cut = text.len() - TAIL_CHARS;
            let start = (cut..text.len()).find(|index| text.is_char_boundary(*index)).unwrap_or(text.len());
            text = text[start..].to_string();
        }
        if let Some(stage) = self.stages.get_mut(index) {
            stage.output_tail = text;
        }
        self.dirty = true;
        if self.pushed.elapsed() >= PUSH_INTERVAL {
            self.push(false, None);
        }
    }

    fn flush(&mut self) {
        if self.dirty {
            self.push(false, None);
        }
    }

    fn push(&mut self, done: bool, error: Option<String>) {
        self.pushed = Instant::now();
        self.dirty = false;
        self.mailbox.push(Update::WorktreeSetup {
            thread: self.draft.clone(),
            stages: self.stages.clone(),
            done,
            error,
        });
    }
}

enum ScriptEnd {
    Exited(Option<i32>),
    Interrupted(Signal),
}

fn forward_lines<R: AsyncRead + Unpin + Send + 'static>(reader: R, lines: mpsc::UnboundedSender<String>) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(reader).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if lines.send(line).is_err() {
                break;
            }
        }
    });
}

fn shell() -> String {
    std::env::var("SHELL").ok().filter(|shell| Path::new(shell).is_file()).unwrap_or_else(|| "/bin/sh".to_string())
}

fn stop_script(pid: Option<u32>) {
    let Some(pid) = pid else { return };
    process::signal_pid_group("-TERM", pid);
    tokio::spawn(async move {
        tokio::time::sleep(KILL_GRACE).await;
        process::signal_pid_group("-KILL", pid);
    });
}

async fn run_script(
    setups: &Setups,
    progress: &mut Progress,
    index: usize,
    script: &ProjectScript,
    project: &Path,
    worktree: &Path,
    signal: &mut watch::Receiver<Signal>,
) -> Result<ScriptEnd, String> {
    let mut command = tokio::process::Command::new(shell());
    command
        .args(["-lc", &script.command])
        .current_dir(worktree)
        .env("LOCAL_STUDIO_PROJECT_ROOT", project)
        .env("LOCAL_STUDIO_WORKTREE_PATH", worktree)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(path) = process::joined_path() {
        command.env("PATH", path);
    }
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command.spawn().map_err(|error| format!("could not run {}: {error}", script.name))?;
    let pid = child.id();
    setups.track(&progress.draft, pid);
    let (lines, mut received) = mpsc::unbounded_channel();
    if let Some(stdout) = child.stdout.take() {
        forward_lines(stdout, lines.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        forward_lines(stderr, lines);
    }
    let mut flush = tokio::time::interval(PUSH_INTERVAL);
    let end = loop {
        tokio::select! {
            Some(line) = received.recv() => progress.output(index, &line),
            _ = flush.tick() => progress.flush(),
            status = child.wait() => {
                while let Ok(line) = received.try_recv() {
                    progress.output(index, &line);
                }
                break ScriptEnd::Exited(status.ok().and_then(|status| status.code()));
            }
            changed = signal.changed() => {
                let current = *signal.borrow();
                if changed.is_err() || current == Signal::Cancel || current == Signal::Local {
                    stop_script(pid);
                    let _ = child.wait().await;
                    break ScriptEnd::Interrupted(if changed.is_err() { Signal::Cancel } else { current });
                }
            }
        }
    };
    setups.track(&progress.draft, None);
    Ok(end)
}

impl Workspace {
    pub(crate) fn cancel_worktree_setup(&self, thread: String) {
        self.signal_setup(thread, Signal::Cancel);
    }

    pub(crate) fn skip_worktree_setup(&self, thread: String) {
        self.signal_setup(thread, Signal::Local);
    }

    fn signal_setup(&self, thread: String, signal: Signal) {
        if !self.inner.setups.signal(&thread, signal) {
            self.inner.mailbox.notice(NoticeLevel::Info, thread + " has no worktree setup running.");
        }
    }

    pub(crate) async fn prepare_worktree(
        &self,
        draft: &str,
        project: &Path,
        branch: &str,
        base: Option<&str>,
    ) -> Result<PreparedWorktree, String> {
        let project_key = project.to_string_lossy().into_owned();
        let scripts: Vec<ProjectScript> = self
            .project_entry(&project_key)
            .scripts
            .into_iter()
            .filter(|script| script.run_on_worktree_setup)
            .collect();
        let effective = self.effective_settings(Some(&project_key));
        let mut names = vec!["Create worktree".to_string()];
        names.extend(scripts.iter().map(|script| script.name.clone()));
        let mut progress = Progress::new(draft, names, Arc::clone(&self.inner.mailbox));
        let mut signal = self.inner.setups.register(draft);
        progress.set(0, SetupStageState::Running);
        let base = match base.map(str::trim).filter(|base| !base.is_empty()) {
            Some(base) => Some(base.to_string()),
            None if effective.new_worktrees_start_from_origin => git::origin_base(project).await,
            None => None,
        };
        let created =
            git::create_worktree(project, &self.inner.data_dir.join("worktrees"), branch, base.as_deref()).await;
        let worktree = match created {
            Ok(path) => path,
            Err(error) => {
                progress.set(0, SetupStageState::Failed);
                progress.skip_from(1);
                progress.push(true, Some(error.clone()));
                self.inner.setups.finish(draft);
                return Err(error);
            }
        };
        progress.set(0, SetupStageState::Done);
        let early = *signal.borrow_and_update();
        if early != Signal::Running {
            let _ = git::remove_worktree(project, &worktree).await;
            progress.skip_from(1);
            self.inner.setups.finish(draft);
            return if early == Signal::Local {
                progress.push(true, None);
                Ok(PreparedWorktree::Local)
            } else {
                progress.push(true, Some("Worktree setup was cancelled.".to_string()));
                Err("Worktree setup was cancelled.".to_string())
            };
        }
        if scripts.is_empty() {
            progress.push(true, None);
            self.inner.setups.finish(draft);
            return Ok(PreparedWorktree::Worktree(worktree));
        }
        let (ready, outcome) = oneshot::channel();
        let run = SetupRun {
            workspace: self.clone(),
            last_waiting: scripts.iter().rposition(|script| script.wait_for_setup),
            scripts,
            progress,
            signal,
            draft: draft.to_string(),
            project: project.to_path_buf(),
            worktree: worktree.clone(),
        };
        self.inner.runtime.spawn(run.run(ready));
        match outcome.await {
            Ok(Outcome::Ready) | Err(_) => Ok(PreparedWorktree::Worktree(worktree)),
            Ok(Outcome::Local) => Ok(PreparedWorktree::Local),
            Ok(Outcome::Cancelled) => Err("Worktree setup was cancelled.".to_string()),
        }
    }
}

struct SetupRun {
    workspace: Workspace,
    scripts: Vec<ProjectScript>,
    last_waiting: Option<usize>,
    progress: Progress,
    signal: watch::Receiver<Signal>,
    draft: String,
    project: PathBuf,
    worktree: PathBuf,
}

impl SetupRun {
    async fn run(mut self, ready: oneshot::Sender<Outcome>) {
        let setups = &self.workspace.inner.setups;
        let mut ready = Some(ready);
        if self.last_waiting.is_none() {
            if let Some(ready) = ready.take() {
                let _ = ready.send(Outcome::Ready);
            }
        }
        let mut error = None;
        for (offset, script) in self.scripts.iter().enumerate() {
            let index = offset + 1;
            self.progress.set(index, SetupStageState::Running);
            let end =
                run_script(setups, &mut self.progress, index, script, &self.project, &self.worktree, &mut self.signal)
                    .await;
            match end {
                Ok(ScriptEnd::Exited(Some(0))) => self.progress.set(index, SetupStageState::Done),
                Ok(ScriptEnd::Exited(code)) => {
                    self.progress.set(index, SetupStageState::Failed);
                    let status = code.map_or_else(|| "a signal".to_string(), |code| format!("status {code}"));
                    error = Some(format!("{} exited with {status}.", script.name));
                }
                Ok(ScriptEnd::Interrupted(interrupt)) => {
                    self.progress.set(index, SetupStageState::Skipped);
                    self.progress.skip_from(index + 1);
                    if let Some(ready) = ready.take() {
                        let _ = git::remove_worktree(&self.project, &self.worktree).await;
                        let outcome = if interrupt == Signal::Local { Outcome::Local } else { Outcome::Cancelled };
                        let message =
                            (interrupt == Signal::Cancel).then(|| "Worktree setup was cancelled.".to_string());
                        self.progress.push(true, message);
                        let _ = ready.send(outcome);
                    } else {
                        self.progress.push(true, Some("Worktree setup was cancelled.".to_string()));
                    }
                    setups.finish(&self.draft);
                    return;
                }
                Err(failure) => {
                    self.progress.set(index, SetupStageState::Failed);
                    error = Some(failure);
                }
            }
            if error.is_some() {
                self.progress.skip_from(index + 1);
                break;
            }
            if Some(offset) == self.last_waiting {
                if let Some(ready) = ready.take() {
                    let _ = ready.send(Outcome::Ready);
                }
            }
        }
        self.progress.push(true, error);
        if let Some(ready) = ready.take() {
            let _ = ready.send(Outcome::Ready);
        }
        setups.finish(&self.draft);
    }
}
