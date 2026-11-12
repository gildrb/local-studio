use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{bail, ensure, Context};
use eukhe_client::daemon_client::DaemonClient;
use eukhe_types::daemon::DaemonCommand;
use local_studio_core::{
    DaemonLaunch, LocalController, LocalEndpoint, LocalEngineState, LocalMachineStatus, LocalSnapshot, Studio,
    StudioConfig, Update, Waker,
};
use serde_json::{json, Map};

const CONTROLLER_PORT: u16 = 18091;
const OK: u8 = 0;
const SLOW: u8 = 1;
const HANG: u8 = 2;
const SLOW_FOR: Duration = Duration::from_secs(4);
const HANG_FOR: Duration = Duration::from_secs(15);
const POLL: Duration = Duration::from_secs(3);

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

struct Stub {
    port: u16,
    mode: Arc<AtomicU8>,
    alive: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}

fn serve(mut stream: TcpStream, model: &str, mode: u8) {
    let mut request = Vec::new();
    let mut buffer = [0_u8; 1024];
    while !request.windows(4).any(|window| window == b"\r\n\r\n") {
        match stream.read(&mut buffer) {
            Ok(0) | Err(_) => return,
            Ok(read) => request.extend_from_slice(&buffer[..read]),
        }
    }
    let line = String::from_utf8_lossy(&request);
    let path = line.split_whitespace().nth(1).unwrap_or_default().to_string();
    match mode {
        SLOW => thread::sleep(SLOW_FOR),
        HANG => thread::sleep(HANG_FOR),
        _ => {}
    }
    let (status, body) = if path.ends_with("/models") {
        ("200 OK", json!({ "object": "list", "data": [{ "id": model, "object": "model" }] }).to_string())
    } else {
        ("404 Not Found", json!({ "error": "not found" }).to_string())
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

impl Stub {
    fn start(host: &str, model: &str) -> anyhow::Result<Self> {
        let listener = TcpListener::bind((host, 0))?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        let mode = Arc::new(AtomicU8::new(OK));
        let alive = Arc::new(AtomicBool::new(true));
        let (worker_mode, worker_alive, model) = (Arc::clone(&mode), Arc::clone(&alive), model.to_string());
        let worker = thread::spawn(move || {
            while worker_alive.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let _ = stream.set_nonblocking(false);
                        let (model, mode) = (model.clone(), worker_mode.load(Ordering::SeqCst));
                        thread::spawn(move || serve(stream, &model, mode));
                    }
                    Err(_) => thread::sleep(Duration::from_millis(25)),
                }
            }
        });
        Ok(Self { port, mode, alive, worker: Some(worker) })
    }

    fn set(&self, mode: u8) {
        self.mode.store(mode, Ordering::SeqCst);
    }

    fn stop(&mut self) {
        self.alive.store(false, Ordering::SeqCst);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

struct Harness {
    studio: Arc<Studio>,
    signal: Arc<Signal>,
    next: u32,
    started: Instant,
}

impl Harness {
    fn snapshot(&mut self) -> anyhow::Result<LocalSnapshot> {
        self.next += 1;
        let request = format!("local-{}", self.next);
        self.studio.local_snapshot(request.clone());
        let deadline = Instant::now() + Duration::from_secs(60);
        loop {
            for update in self.studio.tick() {
                match update {
                    Update::Local { request: id, snapshot } if id == request => return Ok(snapshot),
                    Update::RequestFailed { request: id, message } if id == request => {
                        bail!("snapshot failed: {message}")
                    }
                    _ => {}
                }
            }
            let Some(left) = deadline.checked_duration_since(Instant::now()) else { bail!("no snapshot answer") };
            self.signal.wait(left.min(Duration::from_millis(250)));
        }
    }

    fn until(
        &mut self,
        step: &str,
        limit: Duration,
        mut check: impl FnMut(&LocalSnapshot) -> anyhow::Result<bool>,
    ) -> anyhow::Result<LocalSnapshot> {
        let deadline = Instant::now() + limit;
        loop {
            let snapshot = self.snapshot()?;
            print(self.started, &snapshot);
            if check(&snapshot)? {
                println!("ok   {step}");
                return Ok(snapshot);
            }
            ensure!(Instant::now() < deadline, "timed out: {step}");
            thread::sleep(POLL);
        }
    }
}

fn describe(endpoint: &LocalEndpoint) -> String {
    let age =
        endpoint.confirmed_at_ms.map_or_else(|| "never".to_string(), |at| format!("{} ms ago", (now_ms() - at).max(0)));
    format!(
        "{} [{:?}{}] models={:?} latency={:?} confirmed={age} error={:?}",
        endpoint.address,
        endpoint.state,
        if endpoint.stale { ", stale" } else { "" },
        endpoint.models,
        endpoint.latency_ms,
        endpoint.error
    )
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or_default()
}

fn print(started: Instant, snapshot: &LocalSnapshot) {
    println!("---- t+{}s", started.elapsed().as_secs());
    for controller in &snapshot.controllers {
        println!(
            "     {} ({}) {:?}: {} | {}{}",
            controller.name,
            if controller.has_controller { "controller" } else { "no controller" },
            controller.status,
            controller.headline,
            controller.detail,
            controller.elsewhere.as_ref().map(|elsewhere| format!(" | link → {}", elsewhere.name)).unwrap_or_default()
        );
        for endpoint in &controller.endpoints {
            println!("       {}", describe(endpoint));
        }
    }
}

fn find(snapshot: &LocalSnapshot, port: u16) -> Option<(&LocalController, &LocalEndpoint)> {
    snapshot.controllers.iter().find_map(|controller| {
        controller.endpoints.iter().find(|endpoint| endpoint.port == port).map(|endpoint| (controller, endpoint))
    })
}

fn state(snapshot: &LocalSnapshot, port: u16) -> Option<(LocalEngineState, bool)> {
    find(snapshot, port).map(|(_, endpoint)| (endpoint.state, endpoint.stale))
}

fn listening() -> Vec<u16> {
    let output = Command::new("ss").args(["-H", "-ltn"]).output().map(|output| output.stdout).unwrap_or_default();
    String::from_utf8_lossy(&output)
        .lines()
        .filter_map(|line| line.split_whitespace().nth(3)?.rsplit(':').next()?.parse().ok())
        .collect()
}

fn write_private(path: &Path, content: &str) -> anyhow::Result<()> {
    std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(path)?.write_all(content.as_bytes())?;
    Ok(())
}

fn stop_daemon(socket: &Path) -> anyhow::Result<()> {
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    runtime.block_on(async {
        let (client, _events) = DaemonClient::connect(socket).await?;
        client
            .request_ok(DaemonCommand::Shutdown { id: None, force: Some(true), if_idle: None, rest: Map::default() })
            .await?;
        anyhow::Ok(())
    })
}

fn main() -> anyhow::Result<()> {
    let usage = "usage: local_smoke <eukhe> <scratch dir> <remote bind ip> <remote host name>";
    let mut args = std::env::args().skip(1);
    let daemon = PathBuf::from(args.next().context(usage)?);
    let root = PathBuf::from(args.next().context(usage)?).join(format!("run-{}", std::process::id()));
    let bind = args.next().context(usage)?;
    let remote_name = args.next().context(usage)?;
    ensure!(
        TcpStream::connect(("127.0.0.1", CONTROLLER_PORT)).is_err(),
        "something already answers on {CONTROLLER_PORT}"
    );
    let busy = listening();
    let mut local = Stub::start("127.0.0.1", "stub-local-model")?;
    let mut remote = Stub::start(&bind, "stub-remote-model")?;
    println!("ok   stubs: local 127.0.0.1:{} remote {bind}:{} ({remote_name})", local.port, remote.port);
    let agent = root.join("agent");
    let data = root.join("data");
    std::fs::create_dir_all(&agent)?;
    std::fs::create_dir_all(data.join("controller"))?;
    let mut providers = json!({
        "stub-remote": {
            "name": "stub-remote",
            "baseUrl": format!("http://{remote_name}:{}/v1", remote.port),
            "api": "openai-completions",
            "apiKey": "none",
            "models": [{ "id": "stub-remote-model" }]
        }
    });
    if let (Ok(base), Ok(model), Ok(key)) =
        (std::env::var("LOCAL_SMOKE_BASE"), std::env::var("LOCAL_SMOKE_MODEL"), std::env::var("LOCAL_SMOKE_API_KEY"))
    {
        providers["real-endpoint"] = json!({ "name": "real-endpoint", "baseUrl": base, "api": "openai-completions", "apiKey": key, "models": [{ "id": model }] });
    }
    write_private(&agent.join("models.json"), &json!({ "providers": providers }).to_string())?;
    write_private(&agent.join("auth.json"), "{}")?;
    let mut exclude: Vec<u16> = busy;
    exclude.push(remote.port);
    write_private(
        &data.join("controller/config.json"),
        &json!({
            "name": "smoke-box",
            "fleetKey": format!("local-smoke-{}", std::process::id()),
            "excludePorts": exclude,
            "registry": { "url": "", "dir": root.join("registry"), "ref": "none" },
            "modelsDir": root.join("models"),
        })
        .to_string(),
    )?;
    std::env::set_var("LOCAL_STUDIO_DATA_DIR", &data);
    std::env::set_var("EUKHE_CODING_AGENT_DIR", &agent);
    std::env::set_var("LOCAL_STUDIO_CONTROLLER_URL", format!("http://127.0.0.1:{CONTROLLER_PORT}"));
    let socket = root.join("d.sock");
    let config = StudioConfig {
        socket_path: Some(socket.to_string_lossy().into_owned()),
        session_dir: Some(agent.join("sessions").to_string_lossy().into_owned()),
        data_dir: None,
        launch: Some(DaemonLaunch { program: daemon.to_string_lossy().into_owned() }),
        controller_main: Some(concat!(env!("CARGO_MANIFEST_DIR"), "/../controller/src/main.ts").to_string()),
    };
    let signal = Arc::new(Signal::default());
    let studio = Studio::new(config, Arc::clone(&signal) as Arc<dyn Waker>)?;
    let mut harness = Harness { studio: Arc::clone(&studio), signal, next: 0, started: Instant::now() };
    let outcome = drive(&mut harness, &mut local, &mut remote);
    studio.shutdown();
    local.stop();
    remote.stop();
    let stopped = stop_daemon(&socket);
    outcome?;
    stopped?;
    println!("PASS local smoke ({})", root.display());
    Ok(())
}

fn drive(harness: &mut Harness, local: &mut Stub, remote: &mut Stub) -> anyhow::Result<()> {
    let (lp, rp) = (local.port, remote.port);
    let loaded = |snapshot: &LocalSnapshot, port| state(snapshot, port) == Some((LocalEngineState::Loaded, false));
    harness.until("both engines loaded", Duration::from_secs(90), |snapshot| {
        Ok(loaded(snapshot, lp) && loaded(snapshot, rp))
    })?;
    let snapshot = harness.snapshot()?;
    let (machine, _) = find(&snapshot, rp).context("remote engine")?;
    ensure!(
        !machine.has_controller && machine.note.is_some(),
        "the remote engine sits on a machine without a controller"
    );
    println!("ok   remote machine {} explains telemetry: {:?}", machine.name, machine.note);
    if std::env::var("LOCAL_SMOKE_BASE").is_ok() {
        let (machine, real) = snapshot
            .controllers
            .iter()
            .flat_map(|controller| controller.endpoints.iter().map(move |endpoint| (controller, endpoint)))
            .find(|(_, endpoint)| endpoint.provider.as_deref() == Some("real-endpoint"))
            .context("the real custom endpoint")?;
        println!("ok   real endpoint on {}: {}", machine.name, describe(real));
        ensure!(real.state == LocalEngineState::Loaded, "the real endpoint is loaded");
    }
    local.set(SLOW);
    remote.set(SLOW);
    let started = Instant::now();
    harness.until("a slow engine (4 s per /v1/models) stays loaded for 45 s", Duration::from_secs(60), |snapshot| {
        for port in [lp, rp] {
            let (current, _) = state(snapshot, port).context("engine vanished while slow")?;
            ensure!(current == LocalEngineState::Loaded, "port {port} left 'loaded' while slow: {current:?}");
        }
        let remote_latency = find(snapshot, rp).and_then(|(_, endpoint)| endpoint.latency_ms).unwrap_or(0);
        Ok(started.elapsed() > Duration::from_secs(45) && remote_latency >= 3500)
    })?;
    local.set(HANG);
    remote.set(HANG);
    let mut stale = (false, false);
    harness.until(
        "an engine that stops answering turns stale, then unreachable",
        Duration::from_secs(180),
        |snapshot| {
            for (index, port) in [lp, rp].into_iter().enumerate() {
                let current = state(snapshot, port);
                ensure!(current.is_some(), "port {port} vanished instead of turning unreachable");
                if current == Some((LocalEngineState::Loaded, true)) {
                    if index == 0 {
                        stale.0 = true;
                    } else {
                        stale.1 = true;
                    }
                }
            }
            Ok(state(snapshot, lp).map(|(state, _)| state) == Some(LocalEngineState::Unreachable)
                && state(snapshot, rp).map(|(state, _)| state) == Some(LocalEngineState::Unreachable))
        },
    )?;
    ensure!(stale.0 && stale.1, "both engines showed 'loaded, stale' before 'unreachable'");
    local.set(OK);
    remote.set(OK);
    harness.until("both engines recover", Duration::from_secs(90), |snapshot| {
        Ok(loaded(snapshot, lp) && loaded(snapshot, rp))
    })?;
    local.stop();
    harness.until(
        "the local engine goes away: no model loaded, link to the remote one",
        Duration::from_secs(60),
        |snapshot| {
            let Some(own) =
                snapshot.controllers.iter().find(|controller| controller.has_controller && controller.local)
            else {
                bail!("the local controller is missing")
            };
            Ok(state(snapshot, lp).is_none()
                && own.status == LocalMachineStatus::NoModel
                && own.headline.contains(&own.name)
                && own.elsewhere.is_some())
        },
    )?;
    remote.stop();
    harness.until("the remote engine goes away: unreachable with the error", Duration::from_secs(90), |snapshot| {
        Ok(find(snapshot, rp).is_some_and(|(machine, endpoint)| {
            endpoint.state == LocalEngineState::Unreachable
                && endpoint.error.is_some()
                && (machine.status == LocalMachineStatus::EngineUnreachable
                    || machine.status == LocalMachineStatus::Serving)
        }))
    })?;
    Ok(())
}
