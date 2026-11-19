mod access;
mod devices;
mod hub;
mod limits;
mod noise;
mod ops;
mod server;

use std::fmt::Write;
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context};
use base64::Engine;
use local_studio_core::{DaemonLaunch, Studio, StudioConfig};
use serde_json::{json, Value};
use tokio::net::TcpListener;

use crate::devices::{now_ms, Devices};
use crate::hub::Hub;
use crate::limits::Gate;
use crate::server::Server;

const DEFAULT_PORT: u16 = 18093;
const VERSION: &str = env!("LOCAL_STUDIO_BUILD_VERSION");
const CHANNEL: &str = env!("LOCAL_STUDIO_BUILD_CHANNEL");

const USAGE: &str = "usage:
  local-studio-serve serve [--port 18093] [--tunnel-port <port>] [--allow-host <name>]... [--allow-tunnel-host <name>]... [--url <wss url>]... [--notify <url>]... [--eukhe <path>] [--name <name>] [--data-dir <dir>]
  local-studio-serve pair [--url <wss url>] [--port 18093] [--name <name>] [--data-dir <dir>]
  local-studio-serve devices [--data-dir <dir>]
  local-studio-serve revoke (<device id or name> | --all) [--data-dir <dir>]";

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("local-studio-serve: {error:#}");
            ExitCode::FAILURE
        }
    }
}

struct Args(Vec<String>);

impl Args {
    fn take(&mut self, flag: &str) -> anyhow::Result<Option<String>> {
        let Some(at) = self.0.iter().position(|arg| arg == flag) else { return Ok(None) };
        if at + 1 >= self.0.len() {
            bail!("{flag} needs a value\n{USAGE}");
        }
        let value = self.0.remove(at + 1);
        self.0.remove(at);
        Ok(Some(value))
    }

    fn take_all(&mut self, flag: &str) -> anyhow::Result<Vec<String>> {
        let mut values = Vec::new();
        while let Some(value) = self.take(flag)? {
            values.push(value);
        }
        Ok(values)
    }

    fn port(&mut self) -> anyhow::Result<u16> {
        self.take("--port")?.map_or(Ok(DEFAULT_PORT), |port| port.parse().with_context(|| format!("--port {port}")))
    }

    fn data_dir(&mut self) -> anyhow::Result<PathBuf> {
        let explicit = self.take("--data-dir")?;
        local_studio_core::data_dir(explicit.as_deref()).map_err(|message| anyhow::anyhow!(message))
    }

    fn done(self) -> anyhow::Result<()> {
        match self.0.first() {
            Some(extra) => bail!("unexpected argument {extra}\n{USAGE}"),
            None => Ok(()),
        }
    }
}

fn run() -> anyhow::Result<()> {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let command = if args.first().is_some_and(|arg| !arg.starts_with('-')) { args.remove(0) } else { "serve".into() };
    let args = Args(args);
    match command.as_str() {
        "serve" => serve(args),
        "pair" => pair(args),
        "devices" => list(args),
        "revoke" => revoke(args),
        "help" => {
            println!("{USAGE}");
            Ok(())
        }
        other => bail!("unknown command {other}\n{USAGE}"),
    }
}

fn host_name() -> String {
    std::process::Command::new("hostname")
        .arg("-s")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "local-studio".to_string())
}

async fn stopped() {
    use tokio::signal::unix::{signal, SignalKind};
    let Ok(mut terminate) = signal(SignalKind::terminate()) else {
        tokio::signal::ctrl_c().await.ok();
        return;
    };
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = terminate.recv() => {}
    }
}

fn serve(mut args: Args) -> anyhow::Result<()> {
    let port = args.port()?;
    let tunnel_port = args
        .take("--tunnel-port")?
        .map(|port| port.parse::<u16>().with_context(|| format!("--tunnel-port {port}")))
        .transpose()?;
    let allowed = args.take_all("--allow-host")?;
    let tunnels = args.take_all("--allow-tunnel-host")?;
    if !tunnels.is_empty() && tunnel_port.is_none() {
        anyhow::bail!("--allow-tunnel-host needs --tunnel-port: the tunnel gets its own listener");
    }
    if tunnel_port == Some(port) {
        anyhow::bail!("--tunnel-port must differ from --port: one listener per route");
    }
    let mut urls = args.take_all("--url")?;
    let hooks = args.take_all("--notify")?;
    let launch = args
        .take("--eukhe")?
        .or_else(|| std::env::var("EUKHE_BIN").ok().filter(|value| !value.is_empty()))
        .map(|program| DaemonLaunch { program });
    let name = args.take("--name")?.unwrap_or_else(host_name);
    let data_dir = args.data_dir()?;
    args.done()?;
    if urls.is_empty() {
        urls = allowed.iter().chain(&tunnels).map(|host| format!("wss://{host}/v1/ws")).collect();
    }
    let (waker, notify) = hub::signal();
    let config = StudioConfig {
        socket_path: None,
        session_dir: None,
        data_dir: Some(data_dir.to_string_lossy().into_owned()),
        launch,
        controller_main: None,
    };
    let studio = Studio::new(config, waker).map_err(|error| anyhow::anyhow!("{error}"))?;
    let devices = Devices::new(&data_dir);
    let key = devices.static_key()?;
    let machine = json!({
        "id": devices.machine_id()?,
        "name": name,
        "os": std::env::consts::OS,
        "version": VERSION,
        "channel": CHANNEL,
        "urls": urls,
    });
    let runtime = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build()?;
    let served = runtime.block_on(async {
        let listener =
            TcpListener::bind(("127.0.0.1", port)).await.with_context(|| format!("listen on 127.0.0.1:{port}"))?;
        let tunnel = match tunnel_port {
            Some(tunnel_port) => Some(
                TcpListener::bind(("127.0.0.1", tunnel_port))
                    .await
                    .with_context(|| format!("listen on 127.0.0.1:{tunnel_port}"))?,
            ),
            None => None,
        };
        let hub = Hub::new(Arc::clone(&studio), machine, hooks)?;
        tokio::spawn(Arc::clone(&hub).pump(notify));
        tokio::spawn(Arc::clone(&hub).reap());
        eprintln!(
            "local-studio-serve: serving {} on http://127.0.0.1:{port}{} (pid {}, machine key {})",
            data_dir.display(),
            tunnel_port.map(|port| format!(", tunnel on http://127.0.0.1:{port}")).unwrap_or_default(),
            std::process::id(),
            &devices::hex(&key.public)[..16]
        );
        let server = Server { hub, devices, key, port, allowed, tunnels, gate: Gate::default() };
        server::run(listener, tunnel, Arc::new(server), stopped()).await;
        anyhow::Ok(())
    });
    studio.shutdown();
    runtime.shutdown_timeout(Duration::from_secs(2));
    drop(studio);
    served
}

fn tailscale_url() -> Option<String> {
    let output = std::process::Command::new("tailscale").args(["status", "--json"]).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let status: Value = serde_json::from_slice(&output.stdout).ok()?;
    let name = status.pointer("/Self/DNSName")?.as_str()?.trim_end_matches('.');
    (!name.is_empty()).then(|| format!("wss://{name}/v1/ws"))
}

fn encode(text: &str) -> String {
    let mut encoded = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(char::from(byte));
        } else {
            write!(encoded, "%{byte:02X}").ok();
        }
    }
    encoded
}

fn scheme(channel: &str) -> String {
    match channel {
        "stable" | "" => "localstudio".to_string(),
        other => format!("localstudio-{other}"),
    }
}

fn pair(mut args: Args) -> anyhow::Result<()> {
    let port = args.port()?;
    let url = args.take("--url")?;
    let name = args.take("--name")?.unwrap_or_else(host_name);
    let data_dir = args.data_dir()?;
    args.done()?;
    let url = url.or_else(tailscale_url).unwrap_or_else(|| format!("ws://127.0.0.1:{port}/v1/ws"));
    let devices = Devices::new(&data_dir);
    let (id, secret, _) = devices.open_pairing()?;
    let secret = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(secret.0);
    let link = format!("{}://pair?url={}&name={}&id={id}#{secret}", scheme(CHANNEL), encode(&url), encode(&name));
    let code = qrcode::QrCode::new(link.as_bytes())?;
    let picture = code
        .render::<qrcode::render::unicode::Dense1x2>()
        .dark_color(qrcode::render::unicode::Dense1x2::Light)
        .light_color(qrcode::render::unicode::Dense1x2::Dark)
        .quiet_zone(true)
        .build();
    println!("{picture}");
    println!("{link}");
    eprintln!(
        "Scan this with Local Studio on the phone within 10 minutes. It works once; a new code cancels this one."
    );
    if url.starts_with("wss://") {
        if let Some(host) = url.trim_start_matches("wss://").split('/').next() {
            eprintln!("Run serve with --allow-host {host} so the phone's connection is accepted.");
        }
    }
    Ok(())
}

fn ago(then: i64) -> String {
    let minutes = (now_ms() - then).max(0) / 60_000;
    match minutes {
        0 => "just now".to_string(),
        1..=59 => format!("{minutes} min ago"),
        60..=2879 => format!("{} h ago", minutes / 60),
        _ => format!("{} days ago", minutes / 1440),
    }
}

fn list(mut args: Args) -> anyhow::Result<()> {
    let data_dir = args.data_dir()?;
    args.done()?;
    let devices = Devices::new(&data_dir).list()?;
    if devices.is_empty() {
        println!("No paired devices. Run `local-studio-serve pair` to pair one.");
    }
    for device in devices {
        println!(
            "{}  {}  key {}  {} {} {}  paired {}, last seen {}",
            device.info.id,
            device.info.name,
            device.key.get(..16).unwrap_or_default(),
            device.info.platform,
            device.info.app,
            device.info.channel,
            ago(device.first_seen),
            ago(device.last_seen)
        );
    }
    Ok(())
}

fn revoke(mut args: Args) -> anyhow::Result<()> {
    let data_dir = args.data_dir()?;
    let devices = Devices::new(&data_dir);
    let gone = if args.0.iter().any(|arg| arg == "--all") {
        args.0.retain(|arg| arg != "--all");
        args.done()?;
        devices.revoke_all()?
    } else {
        let Some(device) = args.0.first().cloned() else { bail!("name the device to revoke, or --all\n{USAGE}") };
        args.0.remove(0);
        args.done()?;
        let gone = devices.revoke(&device)?;
        if gone.is_empty() {
            bail!("no paired device has the id or name {device}");
        }
        gone
    };
    if gone.is_empty() {
        println!("No paired devices to revoke.");
    }
    for device in gone {
        println!(
            "Revoked {} ({}). A running serve closes its socket within a second.",
            device.info.name, device.info.id
        );
    }
    Ok(())
}
