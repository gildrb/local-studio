use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::model::KernelState;
use super::{process, Workspace};
use crate::model::{NoticeLevel, Update};

const CHECK_TIMEOUT: Duration = Duration::from_secs(60);
const INSTALL_TIMEOUT: Duration = Duration::from_mins(30);
const UNMANAGED: &str = "This Local Studio has no bundled eukhe binary. Run `eukhe kernel install` where the Eukhe daemon it attaches to is installed.";

pub(crate) struct Kernel {
    program: Mutex<Option<PathBuf>>,
    state: Mutex<KernelState>,
    install: Mutex<Option<u32>>,
}

impl Default for Kernel {
    fn default() -> Self {
        Self { program: Mutex::new(None), state: Mutex::new(KernelState::Checking), install: Mutex::new(None) }
    }
}

enum Check {
    Ready { python: String, version: String, source: String },
    Missing(String),
    Broken(String),
}

impl From<Check> for KernelState {
    fn from(check: Check) -> Self {
        match check {
            Check::Ready { python, version, source } => Self::Ready { python, version, source },
            Check::Missing(_) => Self::Missing,
            Check::Broken(reason) => Self::Unavailable { reason },
        }
    }
}

impl Workspace {
    pub(crate) fn start_kernel(&self, program: Option<PathBuf>) {
        self.inner.kernel.program.lock().unwrap_or_else(PoisonError::into_inner).clone_from(&program);
        let workspace = self.clone();
        self.inner.runtime.spawn(async move {
            workspace.set_kernel(KernelState::Checking);
            let Some(program) = program else {
                workspace.set_kernel(KernelState::Unavailable { reason: UNMANAGED.to_string() });
                return;
            };
            workspace.set_kernel(check(&program).await.into());
        });
    }

    pub(crate) fn install_kernel(&self) {
        {
            let mut state = self.inner.kernel.state.lock().unwrap_or_else(PoisonError::into_inner);
            if matches!(*state, KernelState::Checking | KernelState::Installing { .. }) {
                return;
            }
            *state = KernelState::Installing { detail: None };
        }
        let program = self.inner.kernel.program.lock().unwrap_or_else(PoisonError::into_inner).clone();
        let workspace = self.clone();
        self.inner.runtime.spawn(async move {
            match program {
                Some(program) => workspace.run_kernel_install(&program).await,
                None => workspace.set_kernel(KernelState::Unavailable { reason: UNMANAGED.to_string() }),
            }
        });
    }

    pub(crate) fn stop_kernel_install(&self) {
        if let Some(pid) = self.inner.kernel.install.lock().unwrap_or_else(PoisonError::into_inner).take() {
            process::signal_pid_group("-TERM", pid);
        }
    }

    fn set_kernel(&self, state: KernelState) {
        state.clone_into(&mut self.inner.kernel.state.lock().unwrap_or_else(PoisonError::into_inner));
        self.push(Update::Kernel { state });
    }

    async fn run_kernel_install(&self, program: &Path) {
        self.set_kernel(KernelState::Installing { detail: None });
        let state = match tokio::time::timeout(INSTALL_TIMEOUT, self.kernel_install(program)).await {
            Ok(Ok(())) => match check(program).await {
                Check::Missing(reason) => {
                    KernelState::Failed { message: format!("The install finished but no Python works: {reason}") }
                }
                check => {
                    if matches!(check, Check::Ready { .. }) {
                        self.inner.mailbox.notice(NoticeLevel::Info, "Python is installed for the ipython tool.");
                    }
                    check.into()
                }
            },
            Ok(Err(message)) => KernelState::Failed { message },
            Err(_) => KernelState::Failed {
                message: format!("The install did not finish within {} minutes.", INSTALL_TIMEOUT.as_secs() / 60),
            },
        };
        self.set_kernel(state);
    }

    async fn kernel_install(&self, program: &Path) -> Result<(), String> {
        let mut child = command(program, &["kernel", "install"])
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .process_group(0)
            .spawn()
            .map_err(|error| format!("Could not run {}: {error}", program.display()))?;
        *self.inner.kernel.install.lock().unwrap_or_else(PoisonError::into_inner) = child.id();
        let mut errors = Vec::new();
        if let Some(stderr) = child.stderr.take() {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let line = line.rsplit('\r').next().unwrap_or_default().trim().to_string();
                if line.is_empty() {
                    continue;
                }
                self.set_kernel(KernelState::Installing { detail: Some(line.clone()) });
                errors.push(line);
            }
        }
        let status = child.wait().await;
        self.inner.kernel.install.lock().unwrap_or_else(PoisonError::into_inner).take();
        let status = status.map_err(|error| format!("The install stopped: {error}"))?;
        if status.success() {
            return Ok(());
        }
        Err(failure(&errors, status.code()))
    }
}

async fn check(program: &Path) -> Check {
    let output =
        tokio::time::timeout(CHECK_TIMEOUT, command(program, &["kernel", "install", "--check"]).output()).await;
    let output = match output {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => return Check::Broken(format!("Could not run {}: {error}", program.display())),
        Err(_) => return Check::Broken("Checking for a Python timed out.".to_string()),
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.lines().next().unwrap_or_default().trim();
    if output.status.success() {
        return ready(line).unwrap_or_else(|| Check::Broken(format!("Unexpected answer from eukhe: {line}")));
    }
    if let Some(reason) = line.strip_prefix("no python: ") {
        return Check::Missing(reason.to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let lines: Vec<String> =
        stderr.lines().map(str::trim).filter(|line| !line.is_empty()).map(str::to_string).collect();
    Check::Broken(failure(&lines, output.status.code()))
}

fn ready(line: &str) -> Option<Check> {
    let (python, rest) = line.strip_prefix("ready: ")?.rsplit_once(" (Python ")?;
    let (version, source) = rest.strip_suffix(')')?.split_once(", ")?;
    (!python.is_empty()).then(|| Check::Ready {
        python: python.to_string(),
        version: version.to_string(),
        source: source.to_string(),
    })
}

fn command(program: &Path, args: &[&str]) -> Command {
    let mut command = Command::new(program);
    command.args(args).stdin(Stdio::null()).env("NO_COLOR", "1").kill_on_drop(true);
    if let Some(path) = process::joined_path() {
        command.env("PATH", path);
    }
    command
}

fn failure(lines: &[String], code: Option<i32>) -> String {
    let start = lines.iter().position(|line| line.starts_with("Error: ")).unwrap_or(lines.len().saturating_sub(6));
    let text = lines[start..]
        .iter()
        .take(8)
        .map(|line| line.strip_prefix("Error: ").unwrap_or(line))
        .collect::<Vec<_>>()
        .join("\n");
    if text.is_empty() {
        format!("eukhe exited with status {}", code.map_or_else(|| "unknown".to_string(), |code| code.to_string()))
    } else {
        text
    }
}
