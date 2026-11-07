use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::LazyLock;
use std::time::Duration;

use tokio::io::AsyncWriteExt;
use tokio::process::Command;

pub(crate) struct Output {
    pub(crate) code: Option<i32>,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
}

impl Output {
    pub(crate) fn success(&self) -> bool {
        self.code == Some(0)
    }

    pub(crate) fn failure(&self) -> String {
        let text = self.stderr.trim();
        let text = if text.is_empty() { self.stdout.trim() } else { text };
        if text.is_empty() {
            return format!(
                "exited with status {}",
                self.code.map_or_else(|| "unknown".to_string(), |code| code.to_string())
            );
        }
        text.lines().filter(|line| !line.trim().is_empty()).take(6).collect::<Vec<_>>().join("\n")
    }
}

static SEARCH_PATH: LazyLock<Vec<PathBuf>> = LazyLock::new(|| {
    let mut paths: Vec<PathBuf> =
        std::env::var_os("PATH").map(|value| std::env::split_paths(&value).collect()).unwrap_or_default();
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let user = std::env::var("USER").unwrap_or_default();
    let mut extra = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/run/current-system/sw/bin"),
        PathBuf::from("/nix/var/nix/profiles/default/bin"),
        PathBuf::from(format!("/etc/profiles/per-user/{user}/bin")),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
    ];
    if let Some(home) = home {
        extra.push(home.join(".nix-profile/bin"));
        extra.push(home.join(".bun/bin"));
        extra.push(home.join(".local/bin"));
        extra.push(home.join(".local/share/mise/shims"));
        extra.push(home.join(".local/share/mise/installs/bun/latest/bin"));
    }
    for path in extra {
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
    paths
});

pub(crate) fn search_path() -> &'static [PathBuf] {
    &SEARCH_PATH
}

pub(crate) fn which(program: &str) -> Option<PathBuf> {
    search_path().iter().map(|dir| dir.join(program)).find(|candidate| candidate.is_file())
}

pub(crate) fn joined_path() -> Option<std::ffi::OsString> {
    std::env::join_paths(search_path()).ok()
}

pub(crate) async fn run<I, S>(
    program: &str,
    args: I,
    cwd: &Path,
    timeout: Duration,
    stdin: Option<&[u8]>,
) -> Result<Output, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let executable = which(program).ok_or_else(|| format!("`{program}` was not found on this Mac."))?;
    let mut command = Command::new(executable);
    command
        .args(args)
        .current_dir(cwd)
        .env("LC_ALL", "C")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .env("NO_COLOR", "1")
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(path) = joined_path() {
        command.env("PATH", path);
    }
    let mut child = command.spawn().map_err(|error| format!("could not run {program}: {error}"))?;
    if let (Some(input), Some(mut pipe)) = (stdin, child.stdin.take()) {
        pipe.write_all(input).await.map_err(|error| format!("could not write to {program}: {error}"))?;
        drop(pipe);
    }
    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(Ok(output)) => Ok(Output {
            code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        }),
        Ok(Err(error)) => Err(format!("{program} failed: {error}")),
        Err(_) => Err(format!("{program} timed out after {}s", timeout.as_secs())),
    }
}

pub(crate) async fn run_ok<I, S>(program: &str, args: I, cwd: &Path, timeout: Duration) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let output = run(program, args, cwd, timeout, None).await?;
    if output.success() {
        Ok(output.stdout)
    } else {
        Err(output.failure())
    }
}
