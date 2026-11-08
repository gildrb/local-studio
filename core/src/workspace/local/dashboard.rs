use std::time::{Duration, Instant};

use reqwest::Method;
use serde_json::Value;

use super::{array, float, optional_text, port, small, strings, text, unsigned, Endpoint, Local};
use crate::workspace::history::{self, DayTokens};
use crate::workspace::model::{LocalDashboard, LocalEngineTelemetry, LocalGpuTelemetry, Settings, TokenHistory};
use crate::workspace::time::{days_since_epoch, now_ms, parse_rfc3339_ms};

const HISTORY_EVERY: Duration = Duration::from_secs(60);
const TELEMETRY_TIMEOUT: Duration = Duration::from_secs(8);
const MIB: u64 = 1024 * 1024;

pub(crate) struct DashboardWatch {
    controller: String,
    endpoint: Option<Endpoint>,
    history: Option<(Instant, Value)>,
}

impl DashboardWatch {
    pub(crate) fn new(controller: String) -> Self {
        Self { controller, endpoint: None, history: None }
    }
}

fn whole(value: &Value, key: &str) -> Option<u32> {
    value.get(key).and_then(Value::as_u64).and_then(|value| u32::try_from(value).ok())
}

fn short_name(name: &str) -> String {
    let name = name.strip_prefix("NVIDIA ").unwrap_or(name);
    let name = name.strip_prefix("GeForce ").unwrap_or(name);
    name.replace(" Blackwell Workstation Edition", " Blackwell").replace(" Workstation Edition", "")
}

fn gpu(value: &Value) -> LocalGpuTelemetry {
    LocalGpuTelemetry {
        index: small(value, "index"),
        name: short_name(&text(value, "name")),
        memory_used_mib: unsigned(value, "memoryUsedMiB"),
        memory_total_mib: unsigned(value, "memoryTotalMiB"),
        power_watts: float(value, "powerW"),
        power_limit_watts: float(value, "powerLimitW"),
        temperature_c: float(value, "temperatureC"),
        utilization: float(value, "utilization"),
    }
}

fn day_number(day: &str) -> Option<i64> {
    parse_rfc3339_ms(&format!("{day}T00:00:00Z")).map(days_since_epoch)
}

fn token_history(days: &[Value], now: i64) -> TokenHistory {
    let days = days.iter().filter_map(|day| {
        let number = day_number(&text(day, "day"))?;
        Some(DayTokens { day: number, read: unsigned(day, "prompt"), written: unsigned(day, "generation") })
    });
    history::token_history(days, None, now)
}

fn dashboard(controller: &str, live: &Value, history: Option<&Value>, now: i64) -> LocalDashboard {
    let current = live.get("live").unwrap_or(&Value::Null);
    let peaks = live.get("peaks").unwrap_or(&Value::Null);
    let gpus: Vec<LocalGpuTelemetry> = array(live, "gpus").iter().map(gpu).collect();
    let mut names: Vec<String> = Vec::new();
    for gpu in &gpus {
        if !names.contains(&gpu.name) {
            names.push(gpu.name.clone());
        }
    }
    let vram: u64 = gpus.iter().map(|gpu| gpu.memory_total_mib).sum::<u64>() * MIB;
    let memory = live.get("memory").unwrap_or(&Value::Null);
    let (memory_used_bytes, memory_total_bytes) = if vram > 0 {
        (gpus.iter().map(|gpu| gpu.memory_used_mib).sum::<u64>() * MIB, vram)
    } else {
        let total = unsigned(memory, "totalBytes");
        (total.saturating_sub(unsigned(memory, "freeBytes")), total)
    };
    let running = whole(current, "running");
    let decode_tps = float(current, "decodeTps");
    let decode = history.and_then(|history| history.get("decode")).unwrap_or(&Value::Null);
    let step = decode.get("stepSeconds").and_then(Value::as_i64).map_or(0, |seconds| seconds * 1000);
    LocalDashboard {
        controller: controller.to_string(),
        error: None,
        engines: array(live, "engines")
            .iter()
            .map(|engine| LocalEngineTelemetry {
                port: port(engine, "port"),
                models: strings(engine, "models"),
                kind: optional_text(engine, "kind"),
                loaded_at_ms: optional_text(engine, "loadedAt").as_deref().and_then(parse_rfc3339_ms),
            })
            .collect(),
        decode_tps,
        per_request_tps: decode_tps
            .zip(running.filter(|running| *running > 0))
            .map(|(tps, running)| tps / f64::from(running)),
        running,
        running_peak: whole(peaks, "running"),
        waiting: whole(current, "waiting"),
        kv_percent: float(current, "kvPercent"),
        kv_peak_percent: float(peaks, "kvPercent"),
        first_token_ms: float(current, "ttftMs"),
        first_token_best_ms: float(peaks, "ttftBestMs"),
        power_watts: gpus.iter().filter_map(|gpu| gpu.power_watts).reduce(|sum, watts| sum + watts),
        power_limit_watts: gpus.iter().filter_map(|gpu| gpu.power_limit_watts).reduce(|sum, watts| sum + watts),
        gpu_name: names.join(" / "),
        gpus,
        memory_used_bytes,
        memory_total_bytes,
        decode_series: array(decode, "values").iter().filter_map(Value::as_f64).collect(),
        decode_series_start_ms: optional_text(decode, "start").as_deref().and_then(parse_rfc3339_ms).unwrap_or(0),
        decode_series_step_ms: step,
        tokens: token_history(history.map_or(&[], |history| array(history, "days")), now),
        generated_at_ms: optional_text(live, "generatedAt").as_deref().and_then(parse_rfc3339_ms).unwrap_or(now),
    }
}

impl Local {
    pub(crate) async fn dashboard(&self, settings: &Settings, watch: &mut DashboardWatch) -> LocalDashboard {
        match self.telemetry(settings, watch).await {
            Ok(live) => {
                dashboard(&watch.controller, &live, watch.history.as_ref().map(|(_, history)| history), now_ms())
            }
            Err(error) => {
                let error = if error.contains("/api/telemetry") {
                    "This machine runs an older Local controller without live figures. Update it to see them."
                        .to_string()
                } else {
                    error
                };
                LocalDashboard { controller: watch.controller.clone(), error: Some(error), ..LocalDashboard::default() }
            }
        }
    }

    async fn telemetry(&self, settings: &Settings, watch: &mut DashboardWatch) -> Result<Value, String> {
        let endpoint = if let Some(endpoint) = watch.endpoint.take() {
            endpoint
        } else {
            let root = self.ensure(settings).await?;
            self.target(&root, &watch.controller).await?
        };
        let stale = watch.history.as_ref().is_none_or(|(at, _)| at.elapsed() >= HISTORY_EVERY);
        let path = if stale { "/api/telemetry?history=1" } else { "/api/telemetry" };
        let value = self.request(&endpoint, Method::GET, path, None, TELEMETRY_TIMEOUT).await?;
        watch.endpoint = Some(endpoint);
        if let Some(history) = value.get("history").filter(|_| stale) {
            watch.history = Some((Instant::now(), history.clone()));
        }
        Ok(value)
    }
}
