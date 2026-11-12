use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::Context;
use eukhe_client::daemon_build::Build;
use eukhe_client::daemon_client::{is_connect_failure, DaemonClient, DaemonClientEvent};
use eukhe_client::launcher::ProcessLauncher;
use eukhe_types::daemon::DaemonCommand;
use serde_json::Value;
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::sync::watch;

use crate::studio::DaemonLaunch;

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

pub(crate) async fn connect(socket: &Path, launch: Option<&DaemonLaunch>) -> anyhow::Result<Connection> {
    match DaemonClient::connect(socket).await {
        Ok(connection) => return Ok(connection),
        Err(error) if !is_connect_failure(&error) => return Err(error),
        Err(error) => {
            let Some(launch) = launch else {
                return Err(error.context("no Eukhe daemon is running and none is configured to start"));
            };
            start(launch, socket).await?;
        }
    }
    DaemonClient::connect(socket).await
}

async fn start(launch: &DaemonLaunch, socket: &Path) -> anyhow::Result<()> {
    let mut command = Command::new(&launch.program);
    command.args(["--mode", "daemon", "--daemon-socket"]).arg(socket);
    if let Some(path) = crate::workspace::process::joined_path() {
        command.env("PATH", path);
    }
    let stop = format!("{} shutdown --force --daemon-socket '{}'", launch.program, socket.display());
    let launched = ProcessLauncher::new(command, socket, stop)
        .launch_background(Build::THIS)
        .await
        .with_context(|| format!("start the Eukhe daemon {}", launch.program))?;
    if let Some(mut child) = launched.spawned {
        std::thread::Builder::new()
            .name("eukhe-daemon-reaper".to_string())
            .spawn(move || child.wait())
            .context("watch the Eukhe daemon process")?;
    }
    Ok(())
}
