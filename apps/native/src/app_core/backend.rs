use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

const DEFAULT_PORT: u16 = 3773;
const DEFAULT_TAILSCALE_SERVE_PORT: u16 = 443;
const READINESS_PATH: &str = "/.well-known/t3/environment";
const READINESS_INTERVAL: Duration = Duration::from_millis(100);
const READINESS_TIMEOUT: Duration = Duration::from_secs(60);
const STOP_GRACE: Duration = Duration::from_secs(5);
const SOURCE_SERVER_ENTRY: &str = "apps/server/src/bin.ts";
const SOURCE_CORE_ENTRY: &str = "packages/app-core/src/main.ts";
const BUNDLED_SERVER_ENTRY: &str = "apps/server/dist/bin.mjs";
const BUNDLED_CORE_ENTRY: &str = "packages/app-core/src/main.mjs";
const APP_BUNDLE_ENV: &str = "LOCAL_STUDIO_APP_BUNDLE";
const CLEARED_ENV: [&str; 10] = [
    "T3CODE_PORT",
    "T3CODE_MODE",
    "T3CODE_NO_BROWSER",
    "T3CODE_HOST",
    "T3CODE_DESKTOP_WS_URL",
    "T3CODE_DESKTOP_LAN_ACCESS",
    "T3CODE_DESKTOP_LAN_HOST",
    "T3CODE_DESKTOP_HTTPS_ENDPOINTS",
    "T3CODE_TAILSCALE_SERVE",
    "T3CODE_TAILSCALE_SERVE_PORT",
];

static CHILDREN: Mutex<Vec<Child>> = Mutex::new(Vec::new());

#[derive(Clone, Debug)]
pub struct ServerInfo {
    pub http_url: String,
    pub ws_url: String,
    pub bootstrap_token: String,
}

pub struct CoreProcess {
    pub stdin: ChildStdin,
    pub stdout: ChildStdout,
}

pub struct Runtime {
    root: PathBuf,
    server_entry: PathBuf,
    core_entry: PathBuf,
    node: PathBuf,
    bundle: Option<PathBuf>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Bootstrap<'a> {
    mode: &'static str,
    no_browser: bool,
    port: u16,
    t3_home: &'a str,
    host: &'static str,
    desktop_bootstrap_token: &'a str,
    tailscale_serve_enabled: bool,
    tailscale_serve_port: u16,
}

pub fn t3_home() -> PathBuf {
    match std::env::var_os("LOCAL_STUDIO_T3_HOME") {
        Some(home) if !home.is_empty() => PathBuf::from(home),
        _ => dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".local-studio-t3"),
    }
}

fn bundled_runtime(exe: &Path) -> Option<Runtime> {
    let contents = exe.parent()?.parent()?;
    let bundle = contents.parent()?;
    let root = contents.join("Resources").join("app");
    let server_entry = root.join(BUNDLED_SERVER_ENTRY);
    let core_entry = root.join(BUNDLED_CORE_ENTRY);
    if bundle.extension()? != "app" || !server_entry.is_file() || !core_entry.is_file() {
        return None;
    }
    let node = std::env::var_os("LOCAL_STUDIO_NODE")
        .map(PathBuf::from)
        .unwrap_or_else(|| contents.join("MacOS").join("node"));
    Some(Runtime {
        root,
        server_entry,
        core_entry,
        node,
        bundle: Some(bundle.to_path_buf()),
    })
}

fn source_runtime() -> Result<Runtime, String> {
    let starts = [
        std::env::current_exe().ok(),
        std::env::current_dir().ok(),
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR"))),
    ];
    let root = starts
        .into_iter()
        .flatten()
        .find_map(|start| {
            start
                .ancestors()
                .find(|dir| dir.join(SOURCE_SERVER_ENTRY).is_file())
                .map(Path::to_path_buf)
        })
        .ok_or_else(|| {
            format!("cannot find {SOURCE_SERVER_ENTRY} above the binary or working directory")
        })?;
    Ok(Runtime {
        server_entry: root.join(SOURCE_SERVER_ENTRY),
        core_entry: root.join(SOURCE_CORE_ENTRY),
        node: std::env::var_os("LOCAL_STUDIO_NODE")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("node")),
        root,
        bundle: None,
    })
}

pub fn runtime() -> Result<Runtime, String> {
    let exe = std::env::current_exe()
        .and_then(fs::canonicalize)
        .map_err(|error| format!("cannot locate the running binary: {error}"))?;
    match bundled_runtime(&exe) {
        Some(runtime) => Ok(runtime),
        None => source_runtime(),
    }
}

fn bootstrap_token() -> Result<String, String> {
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).map_err(|error| format!("cannot draw bootstrap token: {error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn can_listen(port: u16) -> bool {
    let hosts = [
        SocketAddr::from((Ipv4Addr::LOCALHOST, port)),
        SocketAddr::from((Ipv4Addr::UNSPECIFIED, port)),
        SocketAddr::from((Ipv6Addr::UNSPECIFIED, port)),
    ];
    hosts
        .iter()
        .all(|address| TcpListener::bind(address).is_ok())
}

fn free_port() -> Result<u16, String> {
    (DEFAULT_PORT..=u16::MAX)
        .find(|port| can_listen(*port))
        .ok_or_else(|| format!("no free port from {DEFAULT_PORT}"))
}

fn log_file(home: &Path, name: &str) -> Result<File, String> {
    let dir = home.join("logs");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("cannot create {}: {error}", dir.display()))?;
    let path = dir.join(name);
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("cannot open {}: {error}", path.display()))
}

#[cfg(unix)]
fn spawn_with_fd3(command: &mut Command, payload: &[u8]) -> Result<Child, String> {
    use std::os::fd::{FromRawFd, OwnedFd};
    use std::os::unix::process::CommandExt;

    let mut fds = [0; 2];
    if unsafe { libc::pipe(fds.as_mut_ptr()) } != 0 {
        return Err(format!(
            "cannot create bootstrap pipe: {}",
            std::io::Error::last_os_error()
        ));
    }
    let (read_end, write_end) =
        unsafe { (OwnedFd::from_raw_fd(fds[0]), OwnedFd::from_raw_fd(fds[1])) };
    for fd in fds {
        unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) };
    }
    let source = fds[0];
    unsafe {
        command.pre_exec(move || {
            if source == 3 {
                if libc::fcntl(3, libc::F_SETFD, 0) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
            } else if libc::dup2(source, 3) != 3 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let child = command
        .spawn()
        .map_err(|error| format!("cannot start server: {error}"))?;
    drop(read_end);
    let mut writer = File::from(write_end);
    writer
        .write_all(payload)
        .map_err(|error| format!("cannot write bootstrap envelope: {error}"))?;
    Ok(child)
}

fn track(child: Child) -> u32 {
    let pid = child.id();
    CHILDREN
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .push(child);
    pid
}

fn exited(pid: u32) -> Option<String> {
    let mut children = CHILDREN.lock().unwrap_or_else(|poison| poison.into_inner());
    let child = children.iter_mut().find(|child| child.id() == pid)?;
    match child.try_wait() {
        Ok(Some(status)) => Some(status.to_string()),
        _ => None,
    }
}

fn ready(port: u16) -> bool {
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_secs(1)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let request = format!(
        "GET {READINESS_PATH} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut head = [0u8; 16];
    let mut read = 0;
    while read < head.len() {
        match stream.read(&mut head[read..]) {
            Ok(0) | Err(_) => break,
            Ok(count) => read += count,
        }
    }
    let line = String::from_utf8_lossy(&head[..read]);
    line.starts_with("HTTP/1.1 2") || line.starts_with("HTTP/1.0 2")
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopLaunchSettings {
    pub local_environment_enabled: bool,
    server_exposure_mode: String,
    tailscale_serve_enabled: bool,
    tailscale_serve_port: u16,
}

impl Default for DesktopLaunchSettings {
    fn default() -> Self {
        Self {
            local_environment_enabled: true,
            server_exposure_mode: "local-only".into(),
            tailscale_serve_enabled: false,
            tailscale_serve_port: DEFAULT_TAILSCALE_SERVE_PORT,
        }
    }
}

pub fn desktop_launch_settings(home: &Path) -> DesktopLaunchSettings {
    fs::read_to_string(home.join("userdata").join("desktop-settings.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

#[cfg(unix)]
fn has_network_ipv4() -> bool {
    let mut addresses: *mut libc::ifaddrs = std::ptr::null_mut();
    if unsafe { libc::getifaddrs(&mut addresses) } != 0 {
        return false;
    }
    let mut found = false;
    let mut cursor = addresses;
    while !cursor.is_null() {
        let entry = unsafe { &*cursor };
        if !entry.ifa_addr.is_null()
            && i32::from(unsafe { (*entry.ifa_addr).sa_family }) == libc::AF_INET
        {
            let socket = unsafe { &*(entry.ifa_addr as *const libc::sockaddr_in) };
            let address = Ipv4Addr::from(u32::from_be(socket.sin_addr.s_addr));
            if !address.is_loopback() && !address.is_link_local() && !address.is_unspecified() {
                found = true;
                break;
            }
        }
        cursor = entry.ifa_next;
    }
    unsafe { libc::freeifaddrs(addresses) };
    found
}

#[cfg(not(unix))]
fn has_network_ipv4() -> bool {
    false
}

fn bind_host(settings: &DesktopLaunchSettings) -> &'static str {
    if settings.server_exposure_mode == "network-accessible" && has_network_ipv4() {
        "0.0.0.0"
    } else {
        "127.0.0.1"
    }
}

pub fn start_server(
    runtime: &Runtime,
    home: &Path,
    settings: &DesktopLaunchSettings,
) -> Result<ServerInfo, String> {
    fs::create_dir_all(home)
        .map_err(|error| format!("cannot create {}: {error}", home.display()))?;
    let token = bootstrap_token()?;
    let port = free_port()?;
    let home_text = home.to_string_lossy();
    let mut payload = serde_json::to_vec(&Bootstrap {
        mode: "desktop",
        no_browser: true,
        port,
        t3_home: &home_text,
        host: bind_host(settings),
        desktop_bootstrap_token: &token,
        tailscale_serve_enabled: settings.tailscale_serve_enabled,
        tailscale_serve_port: settings.tailscale_serve_port,
    })
    .map_err(|error| format!("cannot encode bootstrap envelope: {error}"))?;
    payload.push(b'\n');
    let log = log_file(home, "gpui-server.log")?;
    let errors = log
        .try_clone()
        .map_err(|error| format!("cannot share server log: {error}"))?;
    let mut command = Command::new(&runtime.node);
    command
        .arg(&runtime.server_entry)
        .args(["--bootstrap-fd", "3"])
        .current_dir(&runtime.root)
        .stdin(Stdio::null())
        .stdout(log)
        .stderr(errors);
    for name in CLEARED_ENV {
        command.env_remove(name);
    }
    #[cfg(unix)]
    let child = spawn_with_fd3(&mut command, &payload)?;
    #[cfg(not(unix))]
    let child = {
        let _ = &payload;
        return Err("starting the server needs a Unix platform".into());
    };
    let pid = track(child);
    let started = Instant::now();
    loop {
        if let Some(status) = exited(pid) {
            return Err(format!(
                "server exited before it was ready ({status}); see {}",
                home.join("logs/gpui-server.log").display()
            ));
        }
        if ready(port) {
            break;
        }
        if started.elapsed() > READINESS_TIMEOUT {
            return Err(format!("server did not become ready on port {port}"));
        }
        std::thread::sleep(READINESS_INTERVAL);
    }
    Ok(ServerInfo {
        http_url: format!("http://127.0.0.1:{port}"),
        ws_url: format!("ws://127.0.0.1:{port}"),
        bootstrap_token: token,
    })
}

pub fn start_core(runtime: &Runtime) -> Result<CoreProcess, String> {
    let mut command = Command::new(&runtime.node);
    command
        .arg("--experimental-eventsource")
        .arg(&runtime.core_entry)
        .current_dir(&runtime.root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    match &runtime.bundle {
        Some(bundle) => command.env(APP_BUNDLE_ENV, bundle),
        None => command.env_remove(APP_BUNDLE_ENV),
    };
    let mut child = command
        .spawn()
        .map_err(|error| format!("cannot start core: {error}"))?;
    let stdin = child.stdin.take().ok_or("core stdin unavailable")?;
    let stdout = child.stdout.take().ok_or("core stdout unavailable")?;
    track(child);
    Ok(CoreProcess { stdin, stdout })
}

#[cfg(unix)]
fn terminate(child: &Child) {
    unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGTERM) };
}

#[cfg(not(unix))]
fn terminate(child: &mut Child) {
    let _ = child.kill();
}

pub fn stop_all() {
    let mut children =
        std::mem::take(&mut *CHILDREN.lock().unwrap_or_else(|poison| poison.into_inner()));
    children.reverse();
    for child in children.iter_mut() {
        if matches!(child.try_wait(), Ok(None)) {
            terminate(child);
        }
    }
    let deadline = Instant::now() + STOP_GRACE;
    for child in children.iter_mut() {
        while matches!(child.try_wait(), Ok(None)) {
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

#[cfg(unix)]
pub fn relaunch() {
    use std::os::unix::process::CommandExt;
    stop_all();
    match std::env::current_exe() {
        Ok(exe) => {
            let error = Command::new(exe).args(std::env::args_os().skip(1)).exec();
            eprintln!("cannot relaunch: {error}");
        }
        Err(error) => eprintln!("cannot relaunch: {error}"),
    }
    std::process::exit(1);
}

#[cfg(not(unix))]
pub fn relaunch() {
    stop_all();
    if let Ok(exe) = std::env::current_exe() {
        let _ = Command::new(exe).args(std::env::args_os().skip(1)).spawn();
    }
    std::process::exit(0);
}

#[cfg(unix)]
pub fn stop_on_signals() {
    use signal_hook::consts::{SIGHUP, SIGINT, SIGTERM};
    match signal_hook::iterator::Signals::new([SIGTERM, SIGINT, SIGHUP]) {
        Ok(mut signals) => {
            std::thread::spawn(move || {
                if signals.forever().next().is_some() {
                    stop_all();
                    std::process::exit(0);
                }
            });
        }
        Err(error) => eprintln!("cannot watch signals: {error}"),
    }
}

#[cfg(not(unix))]
pub fn stop_on_signals() {}
