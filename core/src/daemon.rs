use std::future::Future;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use anyhow::{anyhow, Context};
use eukhe_client::daemon_build::{relation, Build, Relation};
use eukhe_client::daemon_client::{is_connect_failure, DaemonClient, DaemonClientEvent};
use eukhe_client::launcher::{ProcessLauncher, SocketTakeover};
use eukhe_types::daemon::DaemonCommand;
use serde_json::Value;
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::sync::watch;

use crate::studio::DaemonLaunch;

const SHUTDOWN_WAIT: Duration = Duration::from_secs(10);
const BUNDLED_BUILD: &str = "local-studio-bundled";

pub(crate) type Connection = (DaemonClient, UnboundedReceiver<DaemonClientEvent>);

#[derive(Clone)]
pub(crate) struct DaemonQuery {
    client: watch::Receiver<Option<DaemonClient>>,
    session_dir: Option<PathBuf>,
}

impl DaemonQuery {
    pub(crate) fn new(client: watch::Receiver<Option<DaemonClient>>, session_dir: Option<PathBuf>) -> Self {
        Self { client, session_dir }
    }

    pub(crate) fn session_dir(&self) -> Option<PathBuf> {
        self.session_dir.clone()
    }

    pub(crate) async fn call(&self, command: DaemonCommand) -> Result<Value, String> {
        let client = self.client.borrow().clone();
        let Some(client) = client else {
            return Err("Not connected to the Eukhe daemon.".to_string());
        };
        client.request_ok(command).await.map_err(|error| format!("{error:#}"))
    }
}

pub(crate) fn socket_path(explicit: Option<&str>) -> PathBuf {
    eukhe_client::paths::resolve_daemon_socket_path(explicit.map(Path::new))
}

pub(crate) fn agent_dir() -> Option<PathBuf> {
    eukhe_types::platform::dirs::agent_dir()
}

pub(crate) fn kernel_program(launch: Option<&DaemonLaunch>) -> Option<PathBuf> {
    launch.map(|launch| PathBuf::from(&launch.program)).filter(|program| program.is_file())
}

pub(crate) async fn connect(
    socket: &Path,
    launch: Option<&DaemonLaunch>,
    bundled: Option<&str>,
    interactive: bool,
) -> anyhow::Result<Connection> {
    let Some(launch) = launch else {
        return DaemonClient::connect(socket).await.map_err(|error| {
            if is_connect_failure(&error) {
                error.context("no Eukhe daemon is running and none is configured to start")
            } else {
                error
            }
        });
    };
    start(launch, socket, bundled, interactive).await?;
    DaemonClient::connect(socket).await
}

pub(crate) fn bundled_version(launch: Option<&DaemonLaunch>) -> Option<String> {
    let program = kernel_program(launch)?;
    let output = Command::new(program).arg("--version").output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let version = text.lines().next()?.trim().trim_start_matches("eukhe").trim().trim_start_matches('v');
    (output.status.success() && !version.is_empty()).then(|| version.to_string())
}

pub(crate) fn mismatch(bundled: &str, daemon: Build<'_>) -> Option<String> {
    if daemon.version == bundled {
        return None;
    }
    let app = Build { version: bundled, id: BUNDLED_BUILD };
    let how = match relation(app, daemon) {
        Relation::Older => "is older than",
        Relation::Newer => "is newer than",
        Relation::Same | Relation::Other => "is another build than",
    };
    Some(format!("Eukhe daemon {} {how} this app's {bundled}", daemon.version))
}

struct Takeover;

impl SocketTakeover for Takeover {
    fn shutdown_wait(&self) -> Duration {
        SHUTDOWN_WAIT
    }

    fn stop_holder(&self, socket_path: &Path, why: &str) -> impl Future<Output = anyhow::Result<()>> + Send {
        std::future::ready(Err(anyhow!(
            "{why}. Local Studio leaves the process holding {} running; stop it, then reconnect.",
            socket_path.display()
        )))
    }
}

async fn start(launch: &DaemonLaunch, socket: &Path, bundled: Option<&str>, interactive: bool) -> anyhow::Result<()> {
    let mut command = Command::new(&launch.program);
    command.args(["--mode", "daemon", "--daemon-socket"]).arg(socket);
    if let Some(path) = crate::workspace::process::joined_path() {
        command.env("PATH", path);
    }
    let stop = format!("{} shutdown --force --daemon-socket '{}'", launch.program, socket.display());
    let launcher = ProcessLauncher::new(command, socket, stop);
    let client = bundled.map_or(Build::THIS, |version| Build { version, id: BUNDLED_BUILD });
    let outcome = if interactive {
        launcher.launch_interactive(client, &Takeover).await
    } else {
        launcher.launch_background(client).await
    }
    .with_context(|| format!("start the Eukhe daemon {}", launch.program))?;
    if let Some(mut child) = outcome.spawned {
        std::thread::Builder::new()
            .name("eukhe-daemon-reaper".to_string())
            .spawn(move || child.wait())
            .context("watch the Eukhe daemon process")?;
    }
    Ok(())
}
