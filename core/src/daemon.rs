use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use anyhow::Context;
use eukhe_client::daemon_client::{is_connect_failure, DaemonClient, DaemonClientEvent};
use eukhe_types::daemon::DaemonCommand;
use serde_json::Value;
use tokio::sync::mpsc::UnboundedReceiver;
use tokio::sync::watch;
use tokio::time::Instant;

use crate::studio::DaemonLaunch;

const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const PROBE_INTERVAL: Duration = Duration::from_millis(50);

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

pub(crate) fn socket_path(explicit: Option<&str>) -> Result<PathBuf, String> {
    explicit
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("EUKHE_DAEMON_SOCKET").filter(|value| !value.is_empty()).map(PathBuf::from))
        .ok_or_else(|| "no daemon socket configured".to_string())
}

pub(crate) fn agent_dir(launch: Option<&DaemonLaunch>) -> Option<PathBuf> {
    launch
        .and_then(|launch| launch.arguments.iter().skip_while(|argument| *argument != "--agent-dir").nth(1))
        .map(|dir| eukhe_types::platform::dirs::expand_tilde(dir))
        .or_else(eukhe_types::platform::dirs::agent_dir)
}

pub(crate) fn kernel_program(launch: Option<&DaemonLaunch>) -> Option<PathBuf> {
    launch
        .and_then(|launch| Path::new(&launch.program).parent().map(|dir| dir.join("eukhe")))
        .filter(|program| program.is_file())
}

pub(crate) async fn connect(socket: &Path, launch: Option<&DaemonLaunch>) -> anyhow::Result<Connection> {
    match DaemonClient::connect(socket).await {
        Ok(connection) => return Ok(connection),
        Err(error) if !is_connect_failure(&error) => return Err(error),
        Err(error) => {
            let Some(launch) = launch else {
                return Err(error.context("no Eukhe daemon is running and none is configured to start"));
            };
            spawn(launch, socket)?;
        }
    }
    let deadline = Instant::now() + STARTUP_TIMEOUT;
    loop {
        tokio::time::sleep(PROBE_INTERVAL).await;
        match DaemonClient::connect(socket).await {
            Ok(connection) => return Ok(connection),
            Err(error) if is_connect_failure(&error) && Instant::now() < deadline => {}
            Err(error) => return Err(error.context("the Eukhe daemon did not start")),
        }
    }
}

fn spawn(launch: &DaemonLaunch, socket: &Path) -> anyhow::Result<()> {
    use std::os::unix::process::CommandExt;
    let mut command = Command::new(&launch.program);
    command
        .args(&launch.arguments)
        .arg("--socket")
        .arg(socket)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0);
    if let Some(path) = crate::workspace::process::joined_path() {
        command.env("PATH", path);
    }
    let mut child = command.spawn().with_context(|| format!("start the Eukhe daemon {}", launch.program))?;
    std::thread::Builder::new()
        .name("eukhe-daemon-reaper".to_string())
        .spawn(move || child.wait())
        .context("watch the Eukhe daemon process")?;
    Ok(())
}
