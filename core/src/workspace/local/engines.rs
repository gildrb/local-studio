use std::collections::HashMap;
use std::net::IpAddr;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use reqwest::{StatusCode, Url};
use serde_json::Value;

use super::{is_loopback, normalize};
use crate::workspace::model::{LocalController, LocalEndpoint, LocalEngineState, LocalMachineStatus, ProviderApi};
use crate::workspace::providers::{self, NO_KEY};
use crate::workspace::time::now_ms;

const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
const PROBE_WAIT: Duration = Duration::from_millis(2500);
const RESOLVE_TIMEOUT: Duration = Duration::from_secs(2);
const PROBE_EVERY_MS: i64 = 4_000;
const RESOLVE_EVERY_MS: i64 = 60_000;
const MISSES: u32 = 3;
const STALE_AFTER_MS: i64 = 15_000;

#[derive(Clone)]
pub(super) struct Target {
    key: String,
    id: String,
    name: String,
    base: String,
    secret: Option<String>,
    url: Url,
}

#[derive(Default)]
struct Probe {
    models: Vec<String>,
    state: Option<LocalEngineState>,
    confirmed_at_ms: Option<i64>,
    failures: u32,
    error: Option<String>,
    latency_ms: Option<u32>,
    checked_at_ms: i64,
    running: bool,
}

#[derive(Default)]
pub(super) struct Engines {
    probes: Arc<Mutex<HashMap<String, Probe>>>,
    resolved: tokio::sync::Mutex<HashMap<String, (i64, Vec<IpAddr>)>>,
    commands: Mutex<HashMap<String, String>>,
}

fn bare_host(url: &Url) -> String {
    url.host_str().unwrap_or_default().trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase()
}

fn private_host(url: &Url) -> bool {
    let host = bare_host(url);
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => {
            let [first, second, ..] = ip.octets();
            ip.is_loopback() || ip.is_private() || ip.is_link_local() || (first == 100 && (second & 0xc0) == 64)
        }
        Ok(IpAddr::V6(ip)) => {
            let first = ip.segments()[0];
            ip.is_loopback() || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
        }
        Err(_) => {
            !host.contains('.')
                || [".local", ".lan", ".home", ".internal", ".home.arpa", ".localhost", ".ts.net"]
                    .iter()
                    .any(|suffix| host.ends_with(suffix))
        }
    }
}

fn machine_name(host: &str) -> String {
    if host == "localhost" || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback()) {
        return "localhost".to_string();
    }
    if host.parse::<IpAddr>().is_ok() {
        return host.to_string();
    }
    host.split('.').next().unwrap_or(host).to_string()
}

impl Engines {
    fn secret(&self, raw: &str) -> Option<String> {
        let Some(command) = raw.strip_prefix('!') else { return providers::resolve_reference(raw) };
        let mut commands = self.commands.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(found) = commands.get(raw) {
            return Some(found.clone());
        }
        let output = Command::new("bash")
            .arg("-c")
            .arg(command)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .ok()
            .filter(|output| output.status.success())?;
        let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if value.is_empty() {
            return None;
        }
        commands.insert(raw.to_string(), value.clone());
        Some(value)
    }

    pub(super) fn targets(&self, agent: Option<&Path>, gateways: &[String]) -> Vec<Target> {
        let files = providers::read_files(agent);
        files
            .providers
            .iter()
            .filter_map(|(id, entry)| {
                if !providers::is_custom(id, entry)
                    || providers::text(entry, "api").and_then(providers::api_of) == Some(ProviderApi::Anthropic)
                {
                    return None;
                }
                let base = normalize(providers::text(entry, "baseUrl")?);
                let url = Url::parse(&base).ok().filter(|url| matches!(url.scheme(), "http" | "https"))?;
                if !private_host(&url) || gateways.iter().any(|gateway| base.starts_with(gateway.as_str())) {
                    return None;
                }
                let stored = files
                    .auth
                    .get(id)
                    .filter(|stored| providers::text(stored, "type") == Some("api_key"))
                    .and_then(|stored| providers::text(stored, "key"));
                let secret = stored
                    .or_else(|| providers::text(entry, "apiKey"))
                    .and_then(|raw| self.secret(raw))
                    .filter(|key| !key.is_empty() && key != NO_KEY);
                Some(Target {
                    key: format!("{id} {base}"),
                    id: id.clone(),
                    name: providers::text(entry, "name").unwrap_or(id).to_string(),
                    base,
                    secret,
                    url,
                })
            })
            .collect()
    }
}

async fn ask(client: &reqwest::Client, target: &Target) -> Result<(Vec<String>, u32), String> {
    let started = Instant::now();
    let mut request = client.get(format!("{}/models", target.base)).timeout(PROBE_TIMEOUT);
    if let Some(secret) = &target.secret {
        request = request.bearer_auth(secret);
    }
    let response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            format!("No answer to /models within {} s.", PROBE_TIMEOUT.as_secs())
        } else if error.is_connect() {
            format!("Could not connect to {}.", bare_host(&target.url))
        } else {
            format!("The request to {} failed.", bare_host(&target.url))
        }
    })?;
    let status = response.status();
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return Err(if target.secret.is_some() {
            format!("HTTP {}: the endpoint rejected the {} key.", status.as_u16(), target.name)
        } else {
            format!("HTTP {}: the endpoint needs an API key for {}.", status.as_u16(), target.name)
        });
    }
    if !status.is_success() {
        return Err(format!("HTTP {} from /models.", status.as_u16()));
    }
    let value: Value = response.json().await.map_err(|_| "/models did not answer with JSON.".to_string())?;
    let latency = u32::try_from(started.elapsed().as_millis()).unwrap_or(u32::MAX);
    Ok((providers::parse_models(&value).into_iter().map(|model| model.id).collect(), latency))
}

fn settle(probe: &mut Probe, result: Result<(Vec<String>, u32), String>, now: i64) {
    probe.checked_at_ms = now;
    probe.running = false;
    match result {
        Ok((models, latency)) => {
            probe.state = Some(if models.is_empty() { LocalEngineState::Empty } else { LocalEngineState::Loaded });
            probe.models = models;
            probe.failures = 0;
            probe.error = None;
            probe.confirmed_at_ms = Some(now);
            probe.latency_ms = Some(latency);
        }
        Err(error) => {
            probe.failures += 1;
            probe.error = Some(error);
            let keep = probe.state == Some(LocalEngineState::Loaded) && probe.failures < MISSES;
            probe.state = Some(if keep { LocalEngineState::Loaded } else { LocalEngineState::Unreachable });
        }
    }
}

fn endpoint(target: &Target, probe: &Probe, now: i64) -> Option<LocalEndpoint> {
    let state = probe.state?;
    let outdated = state == LocalEngineState::Loaded
        && (probe.failures > 0 || probe.confirmed_at_ms.is_none_or(|at| now - at > STALE_AFTER_MS));
    Some(LocalEndpoint {
        id: format!("provider:{}", target.id),
        controller_id: String::new(),
        port: target.url.port_or_known_default().unwrap_or(0),
        pid: None,
        models: probe.models.clone(),
        state,
        stale: outdated,
        error: probe.error.clone(),
        confirmed_at_ms: probe.confirmed_at_ms,
        latency_ms: probe.latency_ms,
        address: target.base.clone(),
        provider: Some(target.name.clone()),
        job_id: None,
    })
}

impl Engines {
    pub(super) async fn refresh(&self, client: &reqwest::Client, targets: &[Target]) {
        let now = now_ms();
        let mut handles = Vec::new();
        {
            let mut probes = self.probes.lock().unwrap_or_else(PoisonError::into_inner);
            probes.retain(|key, _| targets.iter().any(|target| &target.key == key));
            for target in targets {
                let probe = probes.entry(target.key.clone()).or_default();
                if probe.running || now - probe.checked_at_ms < PROBE_EVERY_MS {
                    continue;
                }
                probe.running = true;
                let probes = Arc::clone(&self.probes);
                let client = client.clone();
                let target = target.clone();
                handles.push(tokio::spawn(async move {
                    let result = ask(&client, &target).await;
                    if let Some(probe) = probes.lock().unwrap_or_else(PoisonError::into_inner).get_mut(&target.key) {
                        settle(probe, result, now_ms());
                    }
                }));
            }
        }
        let deadline = tokio::time::Instant::now() + PROBE_WAIT;
        for handle in handles {
            if tokio::time::timeout_at(deadline, handle).await.is_err() {
                break;
            }
        }
    }

    async fn addresses(&self, host: &str) -> Vec<IpAddr> {
        if let Ok(ip) = host.parse::<IpAddr>() {
            return vec![ip];
        }
        let now = now_ms();
        if let Some((at, ips)) = self.resolved.lock().await.get(host) {
            if now - at < RESOLVE_EVERY_MS {
                return ips.clone();
            }
        }
        let ips = match tokio::time::timeout(RESOLVE_TIMEOUT, tokio::net::lookup_host((host, 0))).await {
            Ok(Ok(found)) => found.map(|address| address.ip()).collect(),
            _ => Vec::new(),
        };
        self.resolved.lock().await.insert(host.to_string(), (now, ips.clone()));
        ips
    }

    async fn owner(&self, target: &Target, controllers: &[LocalController]) -> Option<usize> {
        if is_loopback(&target.url) {
            return controllers.iter().position(|controller| controller.has_controller && controller.local);
        }
        let host = bare_host(&target.url);
        let ips = self.addresses(&host).await;
        for (index, controller) in controllers.iter().enumerate().filter(|(_, controller)| controller.has_controller) {
            let other = controller.host.trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
            if other == host || self.addresses(&other).await.iter().any(|ip| ips.contains(ip)) {
                return Some(index);
            }
        }
        None
    }

    pub(super) async fn place(&self, targets: &[Target], controllers: &mut Vec<LocalController>) {
        let now = now_ms();
        let found: Vec<(Target, LocalEndpoint)> = {
            let probes = self.probes.lock().unwrap_or_else(PoisonError::into_inner);
            targets
                .iter()
                .filter_map(|target| {
                    probes
                        .get(&target.key)
                        .and_then(|probe| endpoint(target, probe, now))
                        .map(|ep| (target.clone(), ep))
                })
                .collect()
        };
        for (target, found) in found {
            if let Some(index) = self.owner(&target, controllers).await {
                let controller = &mut controllers[index];
                if let Some(existing) = controller
                    .endpoints
                    .iter_mut()
                    .find(|existing| existing.port == found.port && !existing.controller_id.is_empty())
                {
                    existing.provider.get_or_insert(target.name.clone());
                } else {
                    controller.endpoints.push(found);
                }
                continue;
            }
            let host = bare_host(&target.url);
            let index = controllers.iter().position(|machine| !machine.has_controller && machine.host == host);
            let index = index.unwrap_or_else(|| {
                let url = format!("{}://{}", target.url.scheme(), target.url.host_str().unwrap_or_default());
                controllers.push(LocalController {
                    target: url.clone(),
                    url,
                    id: None,
                    name: machine_name(&host),
                    host,
                    local: false,
                    has_controller: false,
                    reachable: false,
                    status: LocalMachineStatus::NoModel,
                    headline: String::new(),
                    detail: String::new(),
                    summary: String::new(),
                    note: None,
                    elsewhere: None,
                    error: None,
                    version: None,
                    hardware: None,
                    endpoints: Vec::new(),
                    jobs: Vec::new(),
                    recipes: Vec::new(),
                    requests: 0,
                    tokens: 0,
                    measured_requests: 0,
                });
                controllers.len() - 1
            });
            let machine = &mut controllers[index];
            machine.endpoints.push(found);
            machine.reachable = machine.endpoints.iter().any(|ep| ep.state != LocalEngineState::Unreachable);
            machine.error =
                if machine.reachable { None } else { machine.endpoints.iter().find_map(|ep| ep.error.clone()) };
        }
    }
}
