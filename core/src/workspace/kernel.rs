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
    Ready(String),
    Missing,
    Broken(String),
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
            match check(&program).await {
                Check::Ready(python) => workspace.set_kernel(KernelState::Installed { python }),
                Check::Missing => workspace.run_kernel_install(&program).await,
                Check::Broken(reason) => workspace.set_kernel(KernelState::Unavailable { reason }),
            }
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
            Ok(Ok(python)) => {
                self.inner.mailbox.notice(NoticeLevel::Info, "The Python kernel is installed.");
                KernelState::Installed { python }
            }
            Ok(Err(message)) => KernelState::Failed { message },
            Err(_) => KernelState::Failed {
                message: format!("The install did not finish within {} minutes.", INSTALL_TIMEOUT.as_secs() / 60),
            },
        };
        self.set_kernel(state);
    }

    async fn kernel_install(&self, program: &Path) -> Result<String, String> {
        let mut child = command(program, &["kernel", "install"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0)
            .spawn()
            .map_err(|error| format!("Could not run {}: {error}", program.display()))?;
        *self.inner.kernel.install.lock().unwrap_or_else(PoisonError::into_inner) = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let mut python = None;
        let mut errors = Vec::new();
        let read_stdout = async {
            let Some(stdout) = stdout else { return };
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let line = line.trim();
                if let Some(ready) = ready(line) {
                    python = Some(ready.to_string());
                } else if !line.is_empty() && !line.starts_with("unused: ") {
                    self.set_kernel(KernelState::Installing { detail: Some(line.to_string()) });
                }
            }
        };
        let read_stderr = async {
            let Some(stderr) = stderr else { return };
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let line = line.rsplit('\r').next().unwrap_or_default().trim().to_string();
                if !line.is_empty() {
                    errors.push(line);
                }
            }
        };
        tokio::join!(read_stdout, read_stderr);
        let status = child.wait().await;
        self.inner.kernel.install.lock().unwrap_or_else(PoisonError::into_inner).take();
        let status = status.map_err(|error| format!("The install stopped: {error}"))?;
        if status.success() {
            return python.ok_or_else(|| "The install finished without naming its Python.".to_string());
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
        Err(_) => return Check::Broken("Checking the Python kernel timed out.".to_string()),
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.lines().next().unwrap_or_default().trim();
    if output.status.success() {
        return ready(line).map_or(Check::Missing, |python| Check::Ready(python.to_string()));
    }
    if line.starts_with("not fetched") {
        return Check::Missing;
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let lines: Vec<String> =
        stderr.lines().map(str::trim).filter(|line| !line.is_empty()).map(str::to_string).collect();
    Check::Broken(failure(&lines, output.status.code()))
}

fn command(program: &Path, args: &[&str]) -> Command {
    let mut command = Command::new(program);
    command.args(args).stdin(Stdio::null()).env("NO_COLOR", "1").kill_on_drop(true);
    if let Some(path) = process::joined_path() {
        command.env("PATH", path);
    }
    command
}

fn ready(line: &str) -> Option<&str> {
    line.trim().strip_prefix("ready: ").map(str::trim).filter(|python| !python.is_empty())
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
