use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

pub const DEFAULT_PORTS: Ports = Ports { serve: 18093, mcp: 8787 };
const STABLE_SERVICE: Option<&str> = None;
const SEAL_ALG: &str = "X25519-HKDF-SHA256-A256GCM";
const SEAL_INFO: &[u8] = b"ls-tunnels sealed token v1";
const RUNNABLE: [&str; 3] = ["approved", "live", "down"];
const NOT_OPEN: &str = "Hosted tunnels aren't open yet. Use your own Cloudflare account: local-studio tunnel byo";

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ports {
    pub serve: u16,
    pub mcp: u16,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub route: String,
    pub state: String,
    pub hostname: Option<String>,
    pub mcp_url: Option<String>,
    pub ws_url: Option<String>,
    pub ports: Ports,
    pub position: Option<u64>,
    pub release_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub rotation_required: bool,
    pub message: String,
    pub checked_at: String,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Saved {
    request_id: Option<String>,
    hostname: Option<String>,
    ports: Option<Ports>,
    #[serde(default)]
    pending: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct KeyFile {
    sign: String,
    seal: String,
}

struct Keys {
    sign: SigningKey,
    seal: StaticSecret,
}

impl Keys {
    fn sign_key(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.sign.verifying_key().as_bytes())
    }

    fn seal_key(&self) -> String {
        URL_SAFE_NO_PAD.encode(PublicKey::from(&self.seal).as_bytes())
    }
}

pub struct Tunnel {
    dir: PathBuf,
    service: Option<String>,
    http: reqwest::Client,
}

impl Tunnel {
    pub fn open(data_dir: Option<&str>) -> Result<Self, String> {
        let root = match data_dir.filter(|value| !value.is_empty()) {
            Some(explicit) => PathBuf::from(explicit),
            None => match std::env::var_os("LOCAL_STUDIO_DATA_DIR").filter(|value| !value.is_empty()) {
                Some(value) => PathBuf::from(value),
                None => crate::store::home_dir().ok_or("HOME is not set")?.join(".local-studio"),
            },
        };
        let service = std::env::var("LS_TUNNEL_SERVICE")
            .ok()
            .filter(|value| !value.is_empty())
            .or_else(|| STABLE_SERVICE.map(ToString::to_string))
            .map(|value| value.trim_end_matches('/').to_string());
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Self { dir: root.join("tunnel"), service, http })
    }

    #[must_use]
    pub fn token_path(&self) -> PathBuf {
        self.dir.join("token")
    }

    fn ensure_dir(&self) -> Result<(), String> {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&self.dir)
            .map_err(|error| format!("{}: {error}", self.dir.display()))?;
        fs::set_permissions(&self.dir, fs::Permissions::from_mode(0o700)).map_err(|error| error.to_string())
    }

    fn private_write(&self, name: &str, bytes: &[u8]) -> Result<(), String> {
        self.ensure_dir()?;
        let path = self.dir.join(name);
        let temp = self.dir.join(format!(".{name}.{}", std::process::id()));
        let _ = fs::remove_file(&temp);
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)
            .map_err(|error| format!("{}: {error}", temp.display()))?;
        file.write_all(bytes).and_then(|()| file.sync_all()).map_err(|error| error.to_string())?;
        fs::rename(&temp, &path).map_err(|error| format!("{}: {error}", path.display()))
    }

    fn keys(&self, create: bool) -> Result<Option<Keys>, String> {
        let path = self.dir.join("device.json");
        match fs::read(&path) {
            Ok(bytes) => {
                let file: KeyFile =
                    serde_json::from_slice(&bytes).map_err(|error| format!("{}: {error}", path.display()))?;
                let sign = seed(&file.sign).ok_or("device.json: bad signing key")?;
                let seal = seed(&file.seal).ok_or("device.json: bad sealing key")?;
                Ok(Some(Keys { sign: SigningKey::from_bytes(&sign), seal: StaticSecret::from(seal) }))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && create => {
                let sign = random::<32>()?;
                let seal = random::<32>()?;
                let file = KeyFile { sign: URL_SAFE_NO_PAD.encode(sign), seal: URL_SAFE_NO_PAD.encode(seal) };
                self.private_write("device.json", &serde_json::to_vec(&file).map_err(|error| error.to_string())?)?;
                Ok(Some(Keys { sign: SigningKey::from_bytes(&sign), seal: StaticSecret::from(seal) }))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(format!("{}: {error}", path.display())),
        }
    }

    fn saved(&self) -> Saved {
        fs::read(self.dir.join("state.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    fn save(&self, saved: &Saved) -> Result<(), String> {
        self.private_write("state.json", &serde_json::to_vec_pretty(saved).map_err(|error| error.to_string())?)
    }

    fn service(&self) -> Result<&str, String> {
        self.service.as_deref().ok_or_else(|| NOT_OPEN.to_string())
    }

    async fn call(&self, keys: &Keys, method: &str, path: &str, body: Option<&Value>) -> Result<(u16, Value), String> {
        let mut answer = self.call_once(keys, method, path, body).await?;
        for wait in [2, 4, 8] {
            if answer.0 != 429 || answer.1.get("error").and_then(Value::as_str) != Some("slow_down") {
                break;
            }
            tokio::time::sleep(Duration::from_secs(wait)).await;
            answer = self.call_once(keys, method, path, body).await?;
        }
        Ok(answer)
    }

    async fn call_once(
        &self,
        keys: &Keys,
        method: &str,
        path: &str,
        body: Option<&Value>,
    ) -> Result<(u16, Value), String> {
        let service = self.service()?;
        let url = reqwest::Url::parse(&format!("{service}{path}")).map_err(|error| error.to_string())?;
        let host = url.host_str().ok_or("the tunnel service address has no host")?.to_lowercase();
        let bytes = body.map(|value| serde_json::to_vec(value).unwrap_or_default()).unwrap_or_default();
        let ts = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_secs();
        let message = format!("{method}\n{host}\n{path}\n{ts}\n{}", hex(&Sha256::digest(&bytes)));
        let sig = URL_SAFE_NO_PAD.encode(keys.sign.sign(message.as_bytes()).to_bytes());
        let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|error| error.to_string())?;
        let mut request = self
            .http
            .request(method, url)
            .header("Authorization", format!("LSDevice key={},ts={ts},sig={sig}", keys.sign_key()));
        if body.is_some() {
            request = request.header("Content-Type", "application/json").body(bytes);
        }
        let response = request.send().await.map_err(|error| format!("couldn't reach the tunnel service: {error}"))?;
        let code = response.status().as_u16();
        let value = response.json::<Value>().await.unwrap_or(Value::Null);
        Ok((code, value))
    }

    async fn remote(&self, keys: &Keys) -> Result<Value, String> {
        let (code, value) = self.call(keys, "GET", "/v1/tunnel", None).await?;
        if code == 200 {
            return Ok(value);
        }
        if matches!(code, 401 | 403 | 404 | 410) {
            self.stop();
            let _ = fs::remove_file(self.token_path());
        }
        Err(refusal("status", code, &value))
    }

    fn settle(&self, status: &Status) {
        if !RUNNABLE.contains(&status.state.as_str()) {
            self.stop();
            let _ = fs::remove_file(self.token_path());
        }
    }

    pub async fn status(&self) -> Result<Status, String> {
        let saved = self.saved();
        let ports = saved.ports.unwrap_or(DEFAULT_PORTS);
        if self.service.is_none() {
            return Ok(local_status("none", NOT_OPEN, ports));
        }
        let Some(keys) = self.keys(false)? else {
            return Ok(local_status("none", "Request a tunnel, or use your own.", ports));
        };
        self.flush_reports(&keys).await;
        let value = self.remote(&keys).await?;
        let status = self.status_from(&value, ports);
        self.settle(&status);
        Ok(status)
    }

    fn status_from(&self, value: &Value, fallback: Ports) -> Status {
        let text = |key: &str| value.get(key).and_then(Value::as_str).map(ToString::to_string);
        let mut state = text("state").unwrap_or_else(|| "none".to_string());
        let ports = value
            .get("ports")
            .and_then(|ports| serde_json::from_value::<Ports>(ports.clone()).ok())
            .unwrap_or(fallback);
        let runnable = RUNNABLE.contains(&state.as_str());
        let running = self.running().is_some();
        let message = if state == "live" && running {
            "Live. claude.ai, ChatGPT and grok.com can use the MCP address.".to_string()
        } else if state == "live" {
            state = "down".to_string();
            "Cloudflare still shows a connector for this tunnel. If this machine just stopped, that clears within a minute; if not, another machine holds this tunnel's token.".to_string()
        } else if runnable && running {
            "cloudflared is running on this machine. Cloudflare shows it connected within a minute.".to_string()
        } else {
            text("message").unwrap_or_default()
        };
        let hostname = if runnable { text("hostname") } else { None };
        Status {
            route: if state == "none" { "none" } else { "hosted" }.to_string(),
            mcp_url: hostname.as_ref().map(|host| format!("https://{host}/mcp")),
            ws_url: hostname.as_ref().map(|host| format!("wss://{host}/v1/ws")),
            hostname,
            ports,
            position: value.get("position").and_then(Value::as_u64),
            release_at: text("releaseAt"),
            reason: text("reason"),
            rotation_required: value.get("rotationRequired").and_then(Value::as_bool).unwrap_or(false),
            message,
            checked_at: now_rfc3339(),
            state,
        }
    }

    pub async fn request(&self, ports: Ports, channel: &str, on_url: impl FnOnce(&str)) -> Result<Status, String> {
        self.service()?;
        let keys = self.keys(true)?.ok_or("no device keys")?;
        let listener = loopback()?;
        let port = listener.local_addr().map_err(|error| error.to_string())?.port();
        let verifier = random::<32>()?;
        let body = json!({
            "signKey": keys.sign_key(),
            "sealKey": keys.seal_key(),
            "channel": channel,
            "version": env!("CARGO_PKG_VERSION"),
            "platform": format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
            "ports": ports,
            "confirmChallenge": URL_SAFE_NO_PAD.encode(Sha256::digest(verifier)),
            "loopbackPort": port,
        });
        let (code, value) = self.call(&keys, "POST", "/v1/requests", Some(&body)).await?;
        if code != 201 {
            return Err(refusal("request", code, &value));
        }
        let id = value.get("id").and_then(Value::as_str).ok_or("the service gave no request id")?.to_string();
        let url = value.get("url").and_then(Value::as_str).ok_or("the service gave no sign-in address")?;
        let mut saved = self.saved();
        saved.request_id = Some(id.clone());
        saved.ports = Some(ports);
        self.save(&saved)?;
        on_url(url);
        let code = tokio::task::spawn_blocking(move || await_code(&listener, Duration::from_mins(15)))
            .await
            .map_err(|error| error.to_string())??;
        let confirm = json!({ "code": code, "verifier": URL_SAFE_NO_PAD.encode(verifier) });
        let (status, value) = self.call(&keys, "POST", &format!("/v1/requests/{id}/confirm"), Some(&confirm)).await?;
        if status != 200 {
            return Err(refusal("confirm", status, &value));
        }
        self.status().await
    }

    pub async fn up(&self, cloudflared: &Path) -> Result<Status, String> {
        let keys = self.keys(false)?.ok_or("No tunnel yet. Run local-studio tunnel request first.")?;
        let _lock = UpLock::take(&self.dir, false)?;
        let value = self.remote(&keys).await?;
        let status = self.status_from(&value, self.saved().ports.unwrap_or(DEFAULT_PORTS));
        self.settle(&status);
        if self.running().is_some() {
            return Ok(status);
        }
        if !RUNNABLE.contains(&status.state.as_str()) {
            return Err(format!("Nothing to start: the tunnel is {}. {}", status.state, status.message));
        }
        if status.rotation_required {
            return Err(
                "Restored after a second connector: rotate the Tychicus passcode, grants and phones first.".into()
            );
        }
        let hostname = status.hostname.clone().ok_or("the service gave no hostname")?;
        self.going_live(&hostname, status.ports).await?;
        let request_id = value.get("requestId").and_then(Value::as_str).ok_or("the service gave no request id")?;
        let token = self.fetch_token(&keys, request_id, &hostname).await?;
        self.private_write("token", token.as_bytes())?;
        drop(token);
        let started = self.launch(&keys, cloudflared, hostname, status.ports).await;
        if started.is_err() {
            self.stop();
            let _ = fs::remove_file(self.token_path());
        }
        started
    }

    async fn launch(&self, keys: &Keys, cloudflared: &Path, hostname: String, ports: Ports) -> Result<Status, String> {
        let mut saved = self.saved();
        saved.hostname = Some(hostname);
        saved.ports = Some(ports);
        self.save(&saved)?;
        let client_id = self.start(cloudflared)?;
        let mut saved = self.saved();
        if !saved.pending.contains(&client_id) {
            saved.pending.push(client_id);
        }
        self.save(&saved)?;
        for wait in [0, 1, 2, 4] {
            tokio::time::sleep(Duration::from_secs(wait)).await;
            self.flush_reports(keys).await;
            if self.saved().pending.is_empty() {
                break;
            }
        }
        if self.running().is_none() {
            return Err(format!("cloudflared stopped; see {}", self.dir.join("cloudflared.log").display()));
        }
        let status = self.status_from(&self.remote(keys).await?, ports);
        if !RUNNABLE.contains(&status.state.as_str()) {
            return Err(format!("The tunnel became {} while it started. {}", status.state, status.message));
        }
        Ok(status)
    }

    pub async fn down(&self) -> Result<Status, String> {
        let lock = UpLock::take(&self.dir, true)?;
        self.stop();
        drop(lock);
        let _ = fs::remove_file(self.token_path());
        self.status().await
    }

    pub async fn release(&self) -> Result<Status, String> {
        let keys = self.keys(false)?.ok_or("No tunnel to release.")?;
        let _lock = UpLock::take(&self.dir, true)?;
        self.stop();
        let _ = fs::remove_file(self.token_path());
        let (code, value) = self.call(&keys, "DELETE", "/v1/tunnel", None).await?;
        if code != 200 {
            return Err(refusal("release", code, &value));
        }
        let mut saved = self.saved();
        saved.hostname = None;
        saved.request_id = None;
        let ports = saved.ports.unwrap_or(DEFAULT_PORTS);
        self.save(&saved)?;
        Ok(self.status_from(&value, ports))
    }

    async fn fetch_token(&self, keys: &Keys, expect_request: &str, expect_host: &str) -> Result<String, String> {
        for _ in 0..2 {
            let (code, value) = self.call(keys, "GET", "/v1/tunnel?token=1", None).await?;
            if code == 409 {
                continue;
            }
            if code != 200 {
                return Err(refusal("token", code, &value));
            }
            let request_id = value.get("requestId").and_then(Value::as_str).ok_or("no request id with the token")?;
            let hostname = value.get("hostname").and_then(Value::as_str).ok_or("no hostname with the token")?;
            if request_id != expect_request || hostname != expect_host {
                return Err(
                    "The token came for a different request or hostname than the one checked. Run up again.".into()
                );
            }
            let sealed = value.get("sealed").ok_or("the service sent no token")?;
            return unseal(sealed, &keys.seal, request_id, hostname);
        }
        Err("The tunnel changed while the token was fetched. Check status and try again.".into())
    }

    async fn going_live(&self, hostname: &str, ports: Ports) -> Result<(), String> {
        let mcp = self
            .http
            .get(format!("http://127.0.0.1:{}/mcp", ports.mcp))
            .header("Host", hostname)
            .send()
            .await
            .map_err(|_| format!("Tychicus serve isn't answering on 127.0.0.1:{}. No auth, no tunnel.", ports.mcp))?;
        let challenge = mcp.headers().get("www-authenticate").and_then(|value| value.to_str().ok()).unwrap_or("");
        if mcp.status().as_u16() != 401 || !challenge.contains("resource_metadata") {
            return Err(format!(
                "127.0.0.1:{}/mcp must answer 401 with WWW-Authenticate naming resource_metadata; it answered {}. No auth, no tunnel.",
                ports.mcp,
                mcp.status().as_u16()
            ));
        }
        let health = |host: String| {
            self.http.get(format!("http://127.0.0.1:{}/v1/health", ports.serve)).header("Host", host).send()
        };
        let ours = health(hostname.to_string())
            .await
            .map_err(|_| format!("local-studio-serve isn't answering on 127.0.0.1:{}.", ports.serve))?;
        let ok = ours.status().as_u16() == 200
            && ours.json::<Value>().await.ok().and_then(|value| value.get("ok").and_then(Value::as_bool)) == Some(true);
        if !ok {
            return Err(format!(
                "local-studio-serve on 127.0.0.1:{} didn't answer health for {hostname}.",
                ports.serve
            ));
        }
        let other = health("check.invalid".to_string()).await.map_err(|error| error.to_string())?;
        if other.status().as_u16() != 403 {
            return Err(format!(
                "local-studio-serve answered {} for another Host; start it with --allow-host {hostname}.",
                other.status().as_u16()
            ));
        }
        Ok(())
    }

    async fn flush_reports(&self, keys: &Keys) {
        let mut saved = self.saved();
        if saved.pending.is_empty() {
            return;
        }
        let mut left = Vec::new();
        for id in &saved.pending {
            match self.call(keys, "POST", "/v1/tunnel/connector", Some(&json!({ "clientId": id }))).await {
                Ok((200, _)) => {}
                _ => left.push(id.clone()),
            }
        }
        if left != saved.pending {
            saved.pending = left;
            let _ = self.save(&saved);
        }
    }

    fn start(&self, cloudflared: &Path) -> Result<String, String> {
        self.ensure_dir()?;
        let log_path = self.dir.join("cloudflared.log");
        let log = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(&log_path)
            .map_err(|error| error.to_string())?;
        let err = log.try_clone().map_err(|error| error.to_string())?;
        let child = Command::new(cloudflared)
            .args(["tunnel", "--no-autoupdate", "run", "--token-file"])
            .arg(self.token_path())
            .stdin(Stdio::null())
            .stdout(log)
            .stderr(err)
            .process_group(0)
            .spawn()
            .map_err(|error| format!("couldn't start {}: {error}", cloudflared.display()))?;
        let pid = child.id();
        fs::write(self.dir.join("cloudflared.pid"), format!("{pid}\n")).map_err(|error| error.to_string())?;
        let deadline = Instant::now() + Duration::from_secs(30);
        while Instant::now() < deadline {
            let text = fs::read_to_string(&log_path).unwrap_or_default();
            if let Some(id) = connector_id(&text) {
                return Ok(id);
            }
            if self.running().is_none() {
                return Err(format!("cloudflared exited; see {}", log_path.display()));
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        self.stop();
        Err(format!("cloudflared printed no connector id in 30 seconds; see {}", log_path.display()))
    }

    fn running(&self) -> Option<u32> {
        let pid: u32 = fs::read_to_string(self.dir.join("cloudflared.pid")).ok()?.trim().parse().ok()?;
        let out = Command::new("ps").args(["-p", &pid.to_string(), "-o", "stat=,command="]).output().ok()?;
        let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (out.status.success()
            && !line.starts_with('Z')
            && line.contains("--token-file")
            && line.contains("cloudflared"))
        .then_some(pid)
    }

    fn stop(&self) {
        let Some(pid) = self.running() else {
            let _ = fs::remove_file(self.dir.join("cloudflared.pid"));
            return;
        };
        let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).status();
        let deadline = Instant::now() + Duration::from_secs(10);
        while self.running().is_some() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(100));
        }
        if self.running().is_some() {
            let _ = Command::new("kill").args(["-KILL", &pid.to_string()]).status();
        }
        let _ = fs::remove_file(self.dir.join("cloudflared.pid"));
    }
}

struct UpLock(#[allow(dead_code)] fs::File);

impl UpLock {
    fn take(dir: &Path, wait: bool) -> Result<Self, String> {
        fs::DirBuilder::new().recursive(true).mode(0o700).create(dir).map_err(|error| error.to_string())?;
        let path = dir.join("up.lock");
        let file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .open(&path)
            .map_err(|error| format!("{}: {error}", path.display()))?;
        if wait {
            file.lock().map_err(|error| format!("{}: {error}", path.display()))?;
        } else if file.try_lock().is_err() {
            return Err("Another local-studio tunnel up is already starting this tunnel.".into());
        }
        Ok(Self(file))
    }
}

fn local_status(state: &str, message: &str, ports: Ports) -> Status {
    Status {
        route: "none".into(),
        state: state.into(),
        hostname: None,
        mcp_url: None,
        ws_url: None,
        ports,
        position: None,
        release_at: None,
        reason: None,
        rotation_required: false,
        message: message.into(),
        checked_at: now_rfc3339(),
    }
}

fn refusal(what: &str, code: u16, value: &Value) -> String {
    let error = value.get("error").and_then(Value::as_str).unwrap_or("");
    let reason = match error {
        "has_tunnel" => "This machine already has a hosted tunnel.",
        "waitlist_full" => "The waitlist is full. Use your own Cloudflare account: local-studio tunnel byo",
        "too_many_requests" | "rate_limited" => "Too many tries. Wait an hour and try again.",
        "slow_down" => "The tunnel service asked to slow down. Try again in a minute.",
        "bad_ports" => "Those ports aren't allowed: use two different loopback ports from 1024 to 65535.",
        _ => "",
    };
    if reason.is_empty() {
        format!("{what} refused: {code} {error}").trim_end().to_string()
    } else {
        reason.to_string()
    }
}

fn loopback() -> Result<TcpListener, String> {
    for _ in 0..20 {
        let bytes = random::<2>()?;
        let port = 49152 + u16::from_be_bytes(bytes) % (65535 - 49152);
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)) {
            return Ok(listener);
        }
    }
    Err("no free loopback port for the sign-in".into())
}

fn await_code(listener: &TcpListener, wait: Duration) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|error| error.to_string())?;
    let deadline = Instant::now() + wait;
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(code) = answer(stream) {
                    return Ok(code);
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("The sign-in wasn't finished in 15 minutes. Request again.".into())
}

fn answer(mut stream: TcpStream) -> Option<String> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut buf = [0u8; 4096];
    let n = stream.read(&mut buf).ok()?;
    let head = String::from_utf8_lossy(&buf[..n]);
    let target = head.lines().next()?.strip_prefix("GET ")?.split(' ').next()?.to_string();
    let code = target.strip_prefix("/confirmed?").and_then(|query| {
        query.split('&').find_map(|pair| pair.strip_prefix("code=")).filter(|code| {
            !code.is_empty() && code.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        })
    });
    let reply = if code.is_some() {
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\nConfirmed. Go back to Local Studio.\n"
    } else {
        "HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
    };
    let _ = stream.write_all(reply.as_bytes());
    code.map(ToString::to_string)
}

fn unseal(sealed: &Value, secret: &StaticSecret, request_id: &str, hostname: &str) -> Result<String, String> {
    let field = |key: &str| {
        sealed
            .get(key)
            .and_then(Value::as_str)
            .and_then(|text| URL_SAFE_NO_PAD.decode(text).ok())
            .ok_or_else(|| format!("sealed token: bad {key}"))
    };
    if sealed.get("v").and_then(Value::as_u64) != Some(1) || sealed.get("alg").and_then(Value::as_str) != Some(SEAL_ALG)
    {
        return Err("sealed token: unknown format".into());
    }
    let epk: [u8; 32] = field("epk")?.try_into().map_err(|_| "sealed token: bad epk")?;
    let nonce: [u8; 12] = field("nonce")?.try_into().map_err(|_| "sealed token: bad nonce")?;
    let ct = field("ct")?;
    let recipient = PublicKey::from(secret);
    let shared = secret.diffie_hellman(&PublicKey::from(epk));
    if !shared.was_contributory() {
        return Err("sealed token: low-order key".into());
    }
    let mut salt = epk.to_vec();
    salt.extend_from_slice(recipient.as_bytes());
    let mut key = [0u8; 32];
    Hkdf::<Sha256>::new(Some(&salt), shared.as_bytes())
        .expand(SEAL_INFO, &mut key)
        .map_err(|_| "sealed token: key derivation failed")?;
    let aad = format!("ls-tunnels/v1\n{request_id}\n{hostname}");
    let plain = Aes256Gcm::new(&key.into())
        .decrypt(Nonce::from_slice(&nonce), Payload { msg: &ct, aad: aad.as_bytes() })
        .map_err(|_| "sealed token: it doesn't open with this device's key")?;
    String::from_utf8(plain).map_err(|_| "sealed token: not text".into())
}

fn connector_id(log: &str) -> Option<String> {
    log.lines().find_map(|line| {
        let rest = &line[line.find("Connector ID")? + "Connector ID".len()..];
        let id = rest.trim_start_matches([':', ' ', '=']).split_whitespace().next()?.to_lowercase();
        (id.len() == 36 && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')).then_some(id)
    })
}

fn seed(text: &str) -> Option<[u8; 32]> {
    URL_SAFE_NO_PAD.decode(text).ok()?.try_into().ok()
}

fn random<const N: usize>() -> Result<[u8; N], String> {
    let mut bytes = [0u8; N];
    getrandom::getrandom(&mut bytes).map_err(|error| error.to_string())?;
    Ok(bytes)
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut out, b| {
        let _ = write!(out, "{b:02x}");
        out
    })
}

fn now_rfc3339() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let days = i64::try_from(secs / 86_400).unwrap_or(0);
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}
