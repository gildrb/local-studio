pub(crate) mod dashboard;

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use reqwest::{Method, StatusCode, Url};
use serde_json::{json, Value};
use tokio::task::JoinSet;

use super::model::{
    LocalAction, LocalController, LocalDownload, LocalEndpoint, LocalGpu, LocalHardware, LocalJob, LocalModelUsage,
    LocalRecipe, LocalRecord, LocalRegistry, LocalRegistryMatch, LocalShare, LocalSnapshot, LocalTailnet, LocalUsage,
    RegistryModel, RegistryVariant, Settings, TailnetDevice, UsageDay,
};
use super::process;
use super::time::{day_key, monday_of, now_ms, parse_rfc3339_ms, DAY_MS};

const DEFAULT_URL: &str = "http://127.0.0.1:18091";
const HEALTH_TIMEOUT: Duration = Duration::from_secs(2);
const READ_TIMEOUT: Duration = Duration::from_secs(30);
const ACTION_TIMEOUT: Duration = Duration::from_secs(180);
const START_TIMEOUT: Duration = Duration::from_secs(30);
const STOP_GRACE: Duration = Duration::from_secs(3);

#[derive(Default)]
struct Cached {
    registry: Option<LocalRegistry>,
    tailnet: Option<LocalTailnet>,
    record: Option<LocalRecord>,
    share: Option<LocalShare>,
}

pub(crate) struct Local {
    client: reqwest::Client,
    data_root: PathBuf,
    cached: tokio::sync::Mutex<Cached>,
    spawned: Mutex<Option<Child>>,
    controller_main: Option<PathBuf>,
}

struct Endpoint {
    base: Url,
    key: Option<String>,
}

fn text(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

fn optional_text(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn unsigned(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn ratio(part: u64, whole: u64) -> f64 {
    if whole == 0 {
        return 0.0;
    }
    let scaled = part.saturating_mul(10_000) / whole;
    f64::from(u32::try_from(scaled).unwrap_or(u32::MAX)) / 100.0
}

fn small(value: &Value, key: &str) -> u32 {
    u32::try_from(unsigned(value, key)).unwrap_or(u32::MAX)
}

fn port(value: &Value, key: &str) -> u16 {
    u16::try_from(unsigned(value, key)).unwrap_or(0)
}

fn float(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

fn flag(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn array<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value.get(key).and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn strings(value: &Value, key: &str) -> Vec<String> {
    array(value, key).iter().filter_map(Value::as_str).map(str::to_string).collect()
}

fn pretty(value: Option<&Value>) -> String {
    value.and_then(|value| serde_json::to_string_pretty(value).ok()).unwrap_or_default()
}

fn host_of(url: &str) -> String {
    Url::parse(url).ok().and_then(|url| url.host_str().map(str::to_string)).unwrap_or_else(|| url.to_string())
}

fn normalize(url: &str) -> String {
    url.trim().trim_end_matches('/').to_string()
}

fn tokens_of(usage: &[Value], since: &str, until: &str) -> u64 {
    usage
        .iter()
        .filter_map(|row| row.get("tokens").and_then(Value::as_object))
        .flat_map(|days| days.iter())
        .filter(|(day, _)| day.as_str() >= since && day.as_str() <= until)
        .map(|(_, count)| count.as_u64().unwrap_or(0))
        .sum()
}

fn hardware(value: &Value) -> LocalHardware {
    let gpus: Vec<LocalGpu> = array(value, "gpus")
        .iter()
        .map(|gpu| LocalGpu {
            index: small(gpu, "index"),
            name: text(gpu, "name"),
            card: optional_text(gpu, "card"),
            memory_used_mib: unsigned(gpu, "memoryUsedMiB"),
            memory_total_mib: unsigned(gpu, "memoryTotalMiB"),
            busy: flag(gpu, "busy"),
        })
        .collect();
    let cpus = small(value, "cpus");
    let memory_total_bytes = unsigned(value, "memTotalBytes");
    let memory_free_bytes = unsigned(value, "memFreeBytes");
    let vram: u64 = gpus.iter().map(|gpu| gpu.memory_total_mib).sum::<u64>() * 1024 * 1024;
    let (memory_used_bytes, memory_capacity_bytes, memory_label) = if vram > 0 {
        (gpus.iter().map(|gpu| gpu.memory_used_mib).sum::<u64>() * 1024 * 1024, vram, "VRAM")
    } else {
        (memory_total_bytes.saturating_sub(memory_free_bytes), memory_total_bytes, "Memory")
    };
    let mut names: Vec<String> = Vec::new();
    for gpu in &gpus {
        let name = gpu.name.strip_prefix("NVIDIA ").unwrap_or(&gpu.name);
        let name = name.strip_prefix("GeForce ").unwrap_or(name);
        let name = name.replace(" Blackwell Workstation Edition", "").replace(" Workstation Edition", "");
        if !names.contains(&name) {
            names.push(name);
        }
    }
    let gpu_summary =
        if names.is_empty() { format!("{cpus} CPUs") } else { format!("{}× {}", gpus.len(), names.join(" / ")) };
    LocalHardware {
        cpus,
        memory_total_bytes,
        memory_free_bytes,
        gpus,
        memory_used_bytes,
        memory_capacity_bytes,
        memory_label: memory_label.to_string(),
        gpu_summary,
    }
}

fn endpoint(value: &Value) -> LocalEndpoint {
    LocalEndpoint {
        id: text(value, "id"),
        controller_id: text(value, "controllerId"),
        port: port(value, "port"),
        pid: value.get("pid").and_then(Value::as_u64).and_then(|pid| u32::try_from(pid).ok()),
        models: strings(value, "models"),
        live: flag(value, "live"),
        job_id: optional_text(value, "jobId"),
    }
}

fn job(value: &Value) -> LocalJob {
    let phase = text(value, "phase");
    let progress = float(value, "progress");
    let message = optional_text(value, "message").filter(|message| !message.is_empty());
    let mut detail = phase.clone();
    if let Some(progress) = progress {
        let _ = write!(detail, " {}%", (progress * 100.0).round());
    }
    if let Some(message) = &message {
        let _ = write!(detail, " · {message}");
    }
    LocalJob {
        id: text(value, "id"),
        recipe_id: text(value, "recipeId"),
        port: port(value, "port"),
        failed: phase == "failed",
        phase,
        progress,
        message,
        detail,
    }
}

fn recipe(value: &Value, rig: usize) -> LocalRecipe {
    let cards = small(value, "cards");
    let engine = text(value, "engine");
    let context = unsigned(value, "ctx");
    let tokens_per_second = float(value, "tps");
    let fits = flag(value, "fits");
    let blocked = optional_text(value, "blocked");
    let gpus = format!(
        "{cards} of {rig} GPU{}{}",
        if rig == 1 { "" } else { "s" },
        if cards as usize == rig && rig > 1 { " · full rig" } else { "" }
    );
    let detail = if fits {
        let mut parts = vec![gpus, engine.clone()];
        if context > 0 {
            parts.push(format!("{}k context", (context + 500) / 1000));
        }
        if let Some(tps) = tokens_per_second {
            parts.push(format!("{tps:.0} tok/s"));
        }
        parts.join(" · ")
    } else {
        let reason =
            blocked.as_deref().unwrap_or_default().split([':', ';']).next().unwrap_or_default().trim().to_string();
        format!("{gpus} · {engine} · {reason}")
    };
    LocalRecipe {
        id: text(value, "id"),
        model: text(value, "model"),
        card: text(value, "card"),
        engine,
        cards,
        context,
        tokens_per_second,
        fits,
        blocked,
        detail,
    }
}

fn registry(controller: &str, all: bool, value: &Value) -> LocalRegistry {
    LocalRegistry {
        controller: controller.to_string(),
        all,
        commit: optional_text(value, "commit"),
        error: optional_text(value, "error"),
        matches: array(value, "matches")
            .iter()
            .map(|entry| LocalRegistryMatch {
                name: text(entry, "name"),
                memory_gb: float(entry, "memoryGb"),
                count: small(entry, "count"),
                hardware_id: optional_text(entry, "hardwareId"),
                hardware_name: optional_text(entry, "hardwareName"),
            })
            .collect(),
        total: small(value, "total"),
        models: array(value, "models")
            .iter()
            .map(|model| RegistryModel {
                repo: text(model, "repo"),
                variants: array(model, "variants")
                    .iter()
                    .map(|variant| RegistryVariant {
                        id: text(variant, "id"),
                        status: text(variant, "status"),
                        engine: text(variant, "engine"),
                        hardware_id: text(variant, "hardwareId"),
                        hardware_count: small(variant, "hardwareCount"),
                        format: optional_text(variant, "format"),
                        precision: optional_text(variant, "precision"),
                        size_gb: float(variant, "sizeGb"),
                        launch_kind: text(variant, "launchKind"),
                        evidence: flag(variant, "evidence"),
                        recommended: flag(variant, "recommended"),
                        fits: flag(variant, "fits"),
                    })
                    .collect(),
            })
            .collect(),
        downloads: value
            .get("downloads")
            .and_then(Value::as_object)
            .map(|downloads| {
                downloads
                    .iter()
                    .map(|(recipe, state)| LocalDownload {
                        recipe: recipe.clone(),
                        state: state.as_str().unwrap_or_default().to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
    }
}

fn registry_error(controller: &str, all: bool, error: String) -> LocalRegistry {
    LocalRegistry {
        controller: controller.to_string(),
        all,
        commit: None,
        error: Some(error),
        matches: Vec::new(),
        total: 0,
        models: Vec::new(),
        downloads: Vec::new(),
    }
}

fn usage(root: &Value) -> LocalUsage {
    let rows = array(root, "usage");
    let now = optional_text(root, "generatedAt").as_deref().and_then(parse_rfc3339_ms).unwrap_or_else(now_ms);
    let today = day_key(now);
    let monday = day_key(monday_of(now));
    let measured_requests: u64 = rows.iter().map(|row| unsigned(row, "measuredRequests")).sum();
    let requests: u64 = rows.iter().map(|row| unsigned(row, "requests")).sum();
    let daily = (0..30)
        .rev()
        .map(|offset| {
            let day = day_key(now - offset * DAY_MS);
            UsageDay { tokens: tokens_of(rows, &day, &day), day, cost_usd: 0.0 }
        })
        .collect();
    let mut models: Vec<LocalModelUsage> = rows
        .iter()
        .map(|row| {
            let row_requests = unsigned(row, "requests");
            LocalModelUsage {
                model: text(row, "model"),
                requests: row_requests,
                share_percent: ratio(row_requests, requests),
                tokens: tokens_of(std::slice::from_ref(row), "", "9999"),
                measured: unsigned(row, "measuredRequests") > 0,
            }
        })
        .collect();
    models.sort_by(|left, right| right.tokens.cmp(&left.tokens).then_with(|| right.requests.cmp(&left.requests)));
    LocalUsage {
        today_tokens: tokens_of(rows, &today, "9999"),
        week_tokens: tokens_of(rows, &monday, "9999"),
        all_tokens: tokens_of(rows, "", "9999"),
        requests,
        measured_requests,
        daily,
        models,
    }
}

fn controller(link: &Value, snapshot: Option<&Value>, recipes: Option<&Value>) -> LocalController {
    let url = text(link, "url");
    let id = optional_text(link, "id");
    let local = flag(link, "self");
    let host = host_of(&url);
    let usage_rows = array(link, "usage");
    let hardware = snapshot.and_then(|snapshot| snapshot.get("hardware")).map(hardware);
    let rig = hardware.as_ref().map_or(0, |hardware| hardware.gpus.len());
    let endpoints = snapshot
        .map(|snapshot| {
            array(snapshot, "endpoints")
                .iter()
                .map(endpoint)
                .filter(|endpoint| endpoint.live && id.as_deref().is_none_or(|id| endpoint.controller_id == id))
                .collect()
        })
        .unwrap_or_default();
    let jobs = snapshot
        .map(|snapshot| {
            array(snapshot, "jobs")
                .iter()
                .map(job)
                .filter(|job| job.phase != "ready" && job.phase != "stopped")
                .collect()
        })
        .unwrap_or_default();
    let mut recipes: Vec<LocalRecipe> = recipes
        .map(|recipes| array(recipes, "recipes").iter().map(|entry| recipe(entry, rig)).collect())
        .unwrap_or_default();
    recipes.sort_by(|left, right| {
        right
            .cards
            .cmp(&left.cards)
            .then_with(|| right.tokens_per_second.unwrap_or(0.0).total_cmp(&left.tokens_per_second.unwrap_or(0.0)))
            .then_with(|| left.model.cmp(&right.model))
    });
    LocalController {
        target: if local { String::new() } else { url.clone() },
        name: optional_text(link, "name").unwrap_or_else(|| host.clone()),
        host,
        url,
        id,
        local,
        reachable: flag(link, "reachable"),
        error: optional_text(link, "error"),
        version: snapshot
            .and_then(|snapshot| snapshot.get("controller"))
            .and_then(|info| optional_text(info, "version")),
        hardware,
        endpoints,
        jobs,
        recipes,
        requests: usage_rows.iter().map(|row| unsigned(row, "requests")).sum(),
        tokens: tokens_of(usage_rows, "", "9999"),
        measured_requests: usage_rows.iter().map(|row| unsigned(row, "measuredRequests")).sum(),
    }
}

fn tailnet(value: &Value) -> LocalTailnet {
    LocalTailnet {
        available: flag(value, "available"),
        devices: array(value, "devices")
            .iter()
            .map(|device| {
                let controller = device.get("controller").filter(|controller| controller.is_object());
                TailnetDevice {
                    name: text(device, "name"),
                    ip: text(device, "ip"),
                    os: text(device, "os"),
                    controller_url: controller.and_then(|controller| optional_text(controller, "url")),
                    controller_name: controller.and_then(|controller| optional_text(controller, "name")),
                    linked: flag(device, "linked"),
                }
            })
            .collect(),
    }
}

fn record(controller: &str, id: &str, value: &Value) -> LocalRecord {
    let weights = value.get("weights").filter(|weights| weights.is_object());
    LocalRecord {
        controller: controller.to_string(),
        id: id.to_string(),
        command: optional_text(value, "command"),
        weights_repo: weights.and_then(|weights| optional_text(weights, "repo")),
        weights_revision: weights.and_then(|weights| optional_text(weights, "revision")),
        weights_include: weights.and_then(|weights| optional_text(weights, "include")),
        recipe_json: pretty(value.get("recipe")),
        model_instance_json: pretty(value.get("modelInstance")),
        model_json: pretty(value.get("model")),
        hardware_json: pretty(value.get("hardware")),
    }
}

fn share(controller: &str, port: u16, value: &Value) -> LocalShare {
    LocalShare {
        controller: controller.to_string(),
        port,
        target: text(value, "target"),
        branch: text(value, "branch"),
        title: text(value, "title"),
        body: text(value, "body"),
        files: array(value, "files").iter().map(|file| text(file, "path")).collect(),
        reused: strings(value, "reused"),
        redactions: strings(value, "redactions"),
        issues: strings(value, "issues"),
        blockers: strings(value, "blockers"),
        pull_request_url: None,
    }
}

fn encode_segment(segment: &str) -> String {
    let mut encoded = String::new();
    for byte in segment.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(char::from(byte));
        } else {
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}

fn find_bun() -> Option<PathBuf> {
    process::which("bun")
}

fn controller_script(configured: Option<&Path>) -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("LOCAL_STUDIO_CONTROLLER_MAIN").filter(|path| !path.is_empty()) {
        return Some(PathBuf::from(path));
    }
    if let Some(path) = configured.filter(|path| path.is_file()) {
        return Some(path.to_path_buf());
    }
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../controller/src/main.ts");
    source.canonicalize().ok().filter(|path| path.is_file())
}

fn is_loopback(url: &Url) -> bool {
    match url.host_str() {
        Some("localhost") => true,
        Some(host) => host
            .trim_start_matches('[')
            .trim_end_matches(']')
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback()),
        None => false,
    }
}

impl Local {
    pub(crate) fn new(data_dir: &Path, controller_main: Option<PathBuf>) -> Self {
        Self {
            client: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
            data_root: data_dir.join("controller"),
            cached: tokio::sync::Mutex::new(Cached::default()),
            spawned: Mutex::new(None),
            controller_main,
        }
    }

    fn base_url(settings: &Settings) -> Result<Url, String> {
        let raw = std::env::var("LOCAL_STUDIO_CONTROLLER_URL")
            .ok()
            .filter(|url| !url.trim().is_empty())
            .or_else(|| Some(settings.local_controller_url.clone()).filter(|url| !url.trim().is_empty()))
            .unwrap_or_else(|| DEFAULT_URL.to_string());
        Url::parse(raw.trim()).map_err(|error| format!("Invalid Local controller URL: {error}"))
    }

    fn fleet_key(&self, settings: &Settings) -> Option<String> {
        if !settings.fleet_key.is_empty() {
            return Some(settings.fleet_key.clone());
        }
        let config: Value = serde_json::from_slice(&std::fs::read(self.data_root.join("config.json")).ok()?).ok()?;
        optional_text(&config, "fleetKey").filter(|key| !key.is_empty())
    }

    async fn request(
        &self,
        endpoint: &Endpoint,
        method: Method,
        path: &str,
        body: Option<Value>,
        timeout: Duration,
    ) -> Result<Value, String> {
        let url = endpoint.base.join(path).map_err(|error| error.to_string())?;
        let mut request = self.client.request(method, url).timeout(timeout);
        if let Some(key) = &endpoint.key {
            request = request.bearer_auth(key);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.map_err(|error| {
            if error.is_timeout() {
                format!("The Local controller at {} did not answer in time.", endpoint.base)
            } else {
                format!("Local controller unavailable at {}.", endpoint.base)
            }
        })?;
        let status = response.status();
        let value: Value = response.json().await.unwrap_or(Value::Null);
        if status == StatusCode::UNAUTHORIZED {
            return Err("The Local controller needs the fleet key. Set it in Settings → Local.".to_string());
        }
        if !status.is_success() {
            let message = value
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
                .map_or_else(|| format!("Local controller error {status}"), str::to_string);
            return Err(message);
        }
        Ok(value)
    }

    async fn healthy(&self, base: &Url) -> bool {
        let Ok(url) = base.join("/api/health") else { return false };
        match self.client.get(url).timeout(HEALTH_TIMEOUT).send().await {
            Ok(response) => response.status().is_success(),
            Err(_) => false,
        }
    }

    fn spawned_alive(&self) -> bool {
        let mut spawned = self.spawned.lock().unwrap_or_else(PoisonError::into_inner);
        let alive = spawned.as_mut().is_some_and(|child| matches!(child.try_wait(), Ok(None)));
        if !alive {
            *spawned = None;
        }
        alive
    }

    fn spawn_controller(&self, base: &Url) -> Result<(), String> {
        let bun = find_bun().ok_or("bun is not installed, so Local Studio cannot start a Local controller.")?;
        let script =
            controller_script(self.controller_main.as_deref()).ok_or("The Local controller sources were not found.")?;
        let port = base.port_or_known_default().unwrap_or(18091);
        std::fs::create_dir_all(&self.data_root).map_err(|error| error.to_string())?;
        let log = std::fs::File::create(self.data_root.join("controller.log")).map_err(|error| error.to_string())?;
        let log_err = log.try_clone().map_err(|error| error.to_string())?;
        let mut command = Command::new(bun);
        command
            .arg(&script)
            .current_dir(script.parent().unwrap_or(Path::new("/")))
            .env("LOCAL_STUDIO_CONTROLLER_HOME", &self.data_root)
            .env("LOCAL_STUDIO_CONTROLLER_PORT", port.to_string())
            .env("LOCAL_STUDIO_CONTROLLER_HOST", "127.0.0.1")
            .stdin(Stdio::null())
            .stdout(log)
            .stderr(log_err);
        process::own_group(&mut command);
        let child = command.spawn().map_err(|error| format!("could not start the Local controller: {error}"))?;
        *self.spawned.lock().unwrap_or_else(PoisonError::into_inner) = Some(child);
        Ok(())
    }

    async fn ensure(&self, settings: &Settings) -> Result<Endpoint, String> {
        let base = Self::base_url(settings)?;
        if !self.healthy(&base).await {
            if !settings.start_controller {
                return Err(format!("No Local controller answers at {base}."));
            }
            if !is_loopback(&base) {
                return Err(format!("No Local controller answers at {base}."));
            }
            if !self.spawned_alive() {
                self.spawn_controller(&base)?;
            }
            let started = Instant::now();
            loop {
                if self.healthy(&base).await {
                    break;
                }
                if !self.spawned_alive() {
                    return Err(format!(
                        "The Local controller exited during startup; see {}.",
                        self.data_root.join("controller.log").display()
                    ));
                }
                if started.elapsed() > START_TIMEOUT {
                    return Err("The Local controller did not start in time.".to_string());
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }
        Ok(Endpoint { base, key: self.fleet_key(settings) })
    }

    async fn target(&self, root: &Endpoint, controller: &str) -> Result<Endpoint, String> {
        let controller = normalize(controller);
        if controller.is_empty() || controller == normalize(root.base.as_str()) {
            return Ok(Endpoint { base: root.base.clone(), key: root.key.clone() });
        }
        let graph = self.request(root, Method::GET, "/api/snapshot", None, READ_TIMEOUT).await?;
        let reachable = array(&graph, "controllers")
            .iter()
            .any(|link| flag(link, "reachable") && normalize(&text(link, "url")) == controller);
        if !reachable {
            return Err("That controller is not reachable from this machine's fleet.".to_string());
        }
        let base = Url::parse(&controller).map_err(|error| error.to_string())?;
        Ok(Endpoint { base, key: root.key.clone() })
    }

    pub(crate) async fn snapshot(&self, settings: &Settings) -> Result<LocalSnapshot, String> {
        let root = self.ensure(settings).await?;
        self.assemble(&root).await
    }

    pub(crate) async fn fleet(&self, settings: &Settings) -> Vec<LocalController> {
        let Ok(base) = Self::base_url(settings) else { return Vec::new() };
        if !self.healthy(&base).await {
            return Vec::new();
        }
        let root = Endpoint { base, key: self.fleet_key(settings) };
        let Ok(graph) = self.request(&root, Method::GET, "/api/snapshot", None, READ_TIMEOUT).await else {
            return Vec::new();
        };
        let mut controllers = Vec::new();
        for link in array(&graph, "controllers").iter().filter(|link| flag(link, "reachable")) {
            let snapshot = if flag(link, "self") {
                Some(graph.clone())
            } else {
                let Ok(base) = Url::parse(&text(link, "url")) else { continue };
                let endpoint = Endpoint { base, key: root.key.clone() };
                self.request(&endpoint, Method::GET, "/api/snapshot", None, HEALTH_TIMEOUT).await.ok()
            };
            controllers.push(controller(link, snapshot.as_ref(), None));
        }
        controllers
    }

    pub(crate) fn key(&self, settings: &Settings) -> Option<String> {
        self.fleet_key(settings)
    }

    async fn assemble(&self, root: &Endpoint) -> Result<LocalSnapshot, String> {
        let graph = self.request(root, Method::GET, "/api/snapshot", None, READ_TIMEOUT).await?;
        let mut tasks = JoinSet::new();
        for (index, link) in array(&graph, "controllers").iter().enumerate() {
            if !flag(link, "reachable") {
                continue;
            }
            let local = flag(link, "self");
            let endpoint = if local {
                Endpoint { base: root.base.clone(), key: root.key.clone() }
            } else {
                match Url::parse(&text(link, "url")) {
                    Ok(base) => Endpoint { base, key: root.key.clone() },
                    Err(_) => continue,
                }
            };
            let client = self.client.clone();
            let own = local.then(|| graph.clone());
            tasks.spawn(async move {
                let fetch = |path: &'static str| {
                    let client = client.clone();
                    let url = endpoint.base.join(path);
                    let key = endpoint.key.clone();
                    async move {
                        let url = url.ok()?;
                        let mut request = client.get(url).timeout(READ_TIMEOUT);
                        if let Some(key) = key {
                            request = request.bearer_auth(key);
                        }
                        let response = request.send().await.ok()?;
                        if !response.status().is_success() {
                            return None;
                        }
                        response.json::<Value>().await.ok()
                    }
                };
                let snapshot = match own {
                    Some(own) => Some(own),
                    None => fetch("/api/snapshot").await,
                };
                let recipes = fetch("/api/recipes").await;
                (index, snapshot, recipes)
            });
        }
        let mut fetched: BTreeMap<usize, (Option<Value>, Option<Value>)> = BTreeMap::new();
        while let Some(result) = tasks.join_next().await {
            if let Ok((index, snapshot, recipes)) = result {
                fetched.insert(index, (snapshot, recipes));
            }
        }
        let controllers = array(&graph, "controllers")
            .iter()
            .enumerate()
            .map(|(index, link)| {
                let (snapshot, recipes) = fetched.remove(&index).unwrap_or((None, None));
                controller(link, snapshot.as_ref(), recipes.as_ref())
            })
            .collect();
        let mut cached = self.cached.lock().await;
        let refresh =
            cached.registry.as_ref().is_none_or(|registry| registry.error.is_some() && registry.models.is_empty());
        if refresh {
            let (controller, all) = cached
                .registry
                .as_ref()
                .map_or((String::new(), false), |registry| (registry.controller.clone(), registry.all));
            cached.registry = Some(self.load_registry(root, &controller, all).await);
        }
        Ok(LocalSnapshot {
            controllers,
            registry: cached.registry.clone(),
            usage: usage(&graph),
            tailnet: cached.tailnet.clone(),
            record: cached.record.clone(),
            share: cached.share.clone(),
            auto_model: optional_text(&graph, "auto"),
            generated_at: optional_text(&graph, "generatedAt"),
            error: None,
        })
    }

    async fn load_registry(&self, root: &Endpoint, controller: &str, all: bool) -> LocalRegistry {
        let endpoint = match self.target(root, controller).await {
            Ok(endpoint) => endpoint,
            Err(error) => return registry_error(controller, all, error),
        };
        let path = if all { "/api/registry?all=1" } else { "/api/registry" };
        match self.request(&endpoint, Method::GET, path, None, READ_TIMEOUT).await {
            Ok(value) => registry(controller, all, &value),
            Err(error) => registry_error(controller, all, error),
        }
    }

    pub(crate) async fn act(&self, settings: &Settings, action: LocalAction) -> Result<LocalSnapshot, String> {
        let root = self.ensure(settings).await?;
        match action {
            LocalAction::Registry { .. }
            | LocalAction::Inspect { .. }
            | LocalAction::Download { .. }
            | LocalAction::PreviewShare { .. }
            | LocalAction::Share { .. } => self.registry_action(&root, action).await?,
            LocalAction::ScanTailnet
            | LocalAction::Deploy { .. }
            | LocalAction::Connect { .. }
            | LocalAction::Disconnect { .. }
            | LocalAction::Rename { .. }
            | LocalAction::RunRecipe { .. }
            | LocalAction::StopRun { .. }
            | LocalAction::StopPort { .. } => self.fleet_action(&root, action).await?,
        }
        self.assemble(&root).await
    }

    async fn fleet_action(&self, root: &Endpoint, action: LocalAction) -> Result<(), String> {
        match action {
            LocalAction::ScanTailnet => {
                let value = self.request(root, Method::GET, "/api/tailnet", None, ACTION_TIMEOUT).await?;
                self.cached.lock().await.tailnet = Some(tailnet(&value));
            }
            LocalAction::Deploy { ip, name } => {
                self.request(
                    root,
                    Method::POST,
                    "/api/tailnet/deploy",
                    Some(json!({ "ip": ip, "name": name })),
                    ACTION_TIMEOUT,
                )
                .await?;
                self.cached.lock().await.tailnet = None;
            }
            LocalAction::Connect { url } => {
                self.request(root, Method::POST, "/api/peers", Some(json!({ "url": url })), ACTION_TIMEOUT).await?;
                self.cached.lock().await.tailnet = None;
            }
            LocalAction::Disconnect { url } => {
                self.request(
                    root,
                    Method::POST,
                    "/api/peers",
                    Some(json!({ "url": url, "remove": true })),
                    ACTION_TIMEOUT,
                )
                .await?;
            }
            LocalAction::Rename { controller, name } => {
                let endpoint = self.target(root, &controller).await?;
                self.request(&endpoint, Method::POST, "/api/name", Some(json!({ "name": name })), ACTION_TIMEOUT)
                    .await?;
            }
            LocalAction::RunRecipe { controller, recipe, replace } => {
                let endpoint = self.target(root, &controller).await?;
                let path = format!("/api/recipes/{}/run", encode_segment(&recipe));
                self.request(&endpoint, Method::POST, &path, Some(json!({ "replace": replace })), ACTION_TIMEOUT)
                    .await?;
            }
            LocalAction::StopRun { controller, run } => {
                let endpoint = self.target(root, &controller).await?;
                let path = format!("/api/runs/{}/stop", encode_segment(&run));
                self.request(&endpoint, Method::POST, &path, Some(json!({})), ACTION_TIMEOUT).await?;
            }
            LocalAction::StopPort { controller, port } => {
                let endpoint = self.target(root, &controller).await?;
                let path = format!("/api/ports/{port}/stop");
                self.request(&endpoint, Method::POST, &path, Some(json!({})), ACTION_TIMEOUT).await?;
            }
            LocalAction::Registry { .. }
            | LocalAction::Inspect { .. }
            | LocalAction::Download { .. }
            | LocalAction::PreviewShare { .. }
            | LocalAction::Share { .. } => {}
        }
        Ok(())
    }

    async fn registry_action(&self, root: &Endpoint, action: LocalAction) -> Result<(), String> {
        match action {
            LocalAction::Registry { controller, all } => {
                let loaded = self.load_registry(root, &controller, all).await;
                self.cached.lock().await.registry = Some(loaded);
            }
            LocalAction::Inspect { controller, record: id } => {
                let endpoint = self.target(root, &controller).await?;
                let path = format!("/api/registry/records/{}", encode_segment(&id));
                let value = self.request(&endpoint, Method::GET, &path, None, READ_TIMEOUT).await?;
                self.cached.lock().await.record = Some(record(&controller, &id, &value));
            }
            LocalAction::Download { controller, record: id } => {
                let endpoint = self.target(root, &controller).await?;
                self.request(
                    &endpoint,
                    Method::POST,
                    "/api/registry/download",
                    Some(json!({ "recipeId": id })),
                    ACTION_TIMEOUT,
                )
                .await?;
                let (registry_controller, all) = {
                    let cached = self.cached.lock().await;
                    cached
                        .registry
                        .as_ref()
                        .map_or((controller.clone(), false), |registry| (registry.controller.clone(), registry.all))
                };
                let loaded = self.load_registry(root, &registry_controller, all).await;
                self.cached.lock().await.registry = Some(loaded);
            }
            LocalAction::PreviewShare { controller, port } => {
                let endpoint = self.target(root, &controller).await?;
                let path = format!("/api/registry/share?port={port}");
                let value = self.request(&endpoint, Method::GET, &path, None, ACTION_TIMEOUT).await?;
                self.cached.lock().await.share = Some(share(&controller, port, &value));
            }
            LocalAction::Share { controller, port } => {
                let endpoint = self.target(root, &controller).await?;
                let value = self
                    .request(
                        &endpoint,
                        Method::POST,
                        "/api/registry/share",
                        Some(json!({ "port": port, "confirm": true })),
                        ACTION_TIMEOUT,
                    )
                    .await?;
                let url = optional_text(&value, "url");
                let mut cached = self.cached.lock().await;
                if let Some(existing) =
                    cached.share.as_mut().filter(|existing| existing.port == port && existing.controller == controller)
                {
                    existing.pull_request_url = url;
                } else {
                    let mut created = share(&controller, port, &Value::Null);
                    created.pull_request_url = url;
                    cached.share = Some(created);
                }
            }
            LocalAction::ScanTailnet
            | LocalAction::Deploy { .. }
            | LocalAction::Connect { .. }
            | LocalAction::Disconnect { .. }
            | LocalAction::Rename { .. }
            | LocalAction::RunRecipe { .. }
            | LocalAction::StopRun { .. }
            | LocalAction::StopPort { .. } => {}
        }
        Ok(())
    }

    pub(crate) fn shutdown(&self) {
        let Some(mut child) = self.spawned.lock().unwrap_or_else(PoisonError::into_inner).take() else { return };
        process::stop_group(&mut child, STOP_GRACE);
    }
}
