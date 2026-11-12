use std::rc::Rc;

use local_studio_core::{
    ColorScheme, LocalController, LocalDashboard, LocalElsewhere, LocalEndpoint, LocalEngineState,
    LocalEngineTelemetry, LocalGpu, LocalGpuTelemetry, LocalHardware, LocalJob, LocalMachineStatus, LocalRecipe,
    LocalSnapshot, Settings, TokenHistory, Update,
};

use crate::app::App;
use crate::format;
use crate::state::Page;

pub const SCENES: [&str; 8] = [
    "local-dashboard",
    "local-dashboard-light",
    "local-dashboard-gildrb",
    "local-dashboard-gildrb-dark",
    "local-offline",
    "local-loading",
    "local-elsewhere",
    "local-engine-machine",
];

const MIB: u64 = 1_048_576;
const GIB: u64 = 1_073_741_824;
const POD_URL: &str = "http://127.0.0.1:18091";
const SERVER_URL: &str = "https://server.tail1234.ts.net";
const MODEL: &str = "DeepSeek-V4.1-Flash";
const SPIKES: [f64; 48] = [
    22.0, 35.0, 40.0, 25.0, 25.0, 60.0, 25.0, 5.0, 180.0, 40.0, 85.0, 50.0, 10.0, 5.0, 25.0, 5.0, 10.0, 120.0, 70.0,
    100.0, 5.0, 150.0, 5.0, 15.0, 4.0, 3.0, 5.0, 6.0, 4.0, 170.0, 30.0, 30.0, 32.0, 35.0, 70.0, 62.0, 10.0, 130.0, 8.0,
    5.0, 50.0, 10.0, 6.0, 30.0, 30.0, 30.0, 70.0, 126.0,
];

pub fn stage(app: &Rc<App>, scene: &str) {
    if !SCENES.contains(&scene) {
        crate::keyboard::stage(app, scene);
        return;
    }
    app.apply(crate::fixtures::base());
    let appearance = match scene {
        "local-dashboard-light" => Some((ColorScheme::Light, None)),
        "local-dashboard-gildrb" => Some((ColorScheme::Light, Some(crate::colors::GILDRB.to_string()))),
        "local-dashboard-gildrb-dark" => Some((ColorScheme::Dark, Some(crate::colors::GILDRB.to_string()))),
        _ => None,
    };
    if let Some((color_scheme, theme)) = appearance {
        let settings = Settings { color_scheme, theme, ..app.state.borrow().settings.clone() };
        app.apply(vec![Update::Settings { settings }]);
    }
    app.open_page(Page::Local);
    match scene {
        "local-offline" => {
            app.apply(vec![local(snapshot(pod()))]);
            let mut gone = pod();
            gone.reachable = false;
            gone.status = LocalMachineStatus::Offline;
            gone.error = Some("connect timed out after 3s".to_string());
            gone.headline = "rtx-6000-pod is offline".to_string();
            gone.detail = format!(
                "connect timed out after 3s It last ran {MODEL}. It shows live figures again once it reconnects."
            );
            gone.endpoints.clear();
            gone.hardware = None;
            app.apply(vec![local(snapshot(gone))]);
        }
        "local-loading" => {
            let mut loading = pod();
            loading.endpoints.clear();
            loading.status = LocalMachineStatus::Loading;
            loading.headline = "Loading glm-5.3-flash-sglang-2xrtx6000 on rtx-6000-pod".to_string();
            loading.detail = "Downloading weights · 42% · 61 of 146 GB".to_string();
            loading.jobs.push(LocalJob {
                id: "run-glm".to_string(),
                recipe_id: "glm-5.3-flash-sglang-2xrtx6000".to_string(),
                port: 8000,
                phase: "download".to_string(),
                progress: Some(0.42),
                message: None,
                failed: false,
                detail: "Downloading weights · 42% · 61 of 146 GB".to_string(),
            });
            app.apply(vec![local(snapshot(loading)), Update::LocalDashboard { dashboard: idle_dashboard() }]);
        }
        "local-elsewhere" | "local-engine-machine" => {
            let mut mac = pod();
            mac.name = "macbook".to_string();
            mac.endpoints.clear();
            mac.status = LocalMachineStatus::NoModel;
            mac.headline = "No model loaded on macbook".to_string();
            mac.detail = "qwen3.8-27b is loaded on server.".to_string();
            mac.summary = "No model loaded".to_string();
            mac.elsewhere = Some(LocalElsewhere {
                url: SERVER_URL.to_string(),
                name: "server".to_string(),
                models: "qwen3.8-27b".to_string(),
            });
            let snapshot = LocalSnapshot { controllers: vec![mac, engine_machine()], ..LocalSnapshot::default() };
            app.apply(vec![local(snapshot), Update::LocalDashboard { dashboard: idle_dashboard() }]);
            app.local.select(if scene == "local-elsewhere" { POD_URL } else { SERVER_URL });
            return;
        }
        _ => app.apply(vec![local(snapshot(pod())), Update::LocalDashboard { dashboard: dashboard() }]),
    }
    app.local.select(POD_URL);
}

fn engine_machine() -> LocalController {
    LocalController {
        target: SERVER_URL.to_string(),
        url: SERVER_URL.to_string(),
        id: None,
        name: "server".to_string(),
        host: "server.tail1234.ts.net".to_string(),
        local: false,
        has_controller: false,
        reachable: true,
        status: LocalMachineStatus::Serving,
        headline: "qwen3.8-27b".to_string(),
        detail: format!("server · elpis at {SERVER_URL}/v1 · answered /models in 84 ms"),
        summary: "qwen3.8-27b".to_string(),
        note: Some(
            "Hardware, decode and token figures need a Local controller on server. Add one in Settings → Local."
                .to_string(),
        ),
        elsewhere: None,
        error: None,
        version: None,
        hardware: None,
        endpoints: vec![LocalEndpoint {
            id: "provider:elpis".to_string(),
            controller_id: String::new(),
            port: 443,
            pid: None,
            models: vec!["qwen3.8-27b".to_string()],
            state: LocalEngineState::Loaded,
            stale: false,
            error: None,
            confirmed_at_ms: Some(format::now_ms() - 3000),
            latency_ms: Some(84),
            address: format!("{SERVER_URL}/v1"),
            provider: Some("elpis".to_string()),
            job_id: None,
        }],
        jobs: Vec::new(),
        recipes: Vec::new(),
        requests: 0,
        tokens: 0,
        measured_requests: 0,
    }
}

fn local(snapshot: LocalSnapshot) -> Update {
    Update::Local { request: "fixture".to_string(), snapshot }
}

fn snapshot(pod: LocalController) -> LocalSnapshot {
    LocalSnapshot {
        controllers: vec![
            pod,
            offline("rtx-3090-pod", "http://100.88.4.31:18091"),
            offline("DGX Spark", "http://100.88.4.32:18091"),
        ],
        auto_model: Some(MODEL.to_string()),
        ..LocalSnapshot::default()
    }
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn mib(gib: f64) -> u64 {
    (gib * 1024.0) as u64
}

fn rtx_gpu(index: u32, used: f64) -> LocalGpu {
    LocalGpu {
        index,
        name: "NVIDIA RTX PRO 6000 Blackwell Workstation Edition".to_string(),
        card: Some("rtx-pro-6000".to_string()),
        memory_used_mib: mib(used),
        memory_total_mib: 96 * 1024,
        busy: true,
    }
}

fn recipe(id: &str, model: &str, engine: &str, context: u64, speed: f64, fits: bool) -> LocalRecipe {
    LocalRecipe {
        id: id.to_string(),
        model: model.to_string(),
        card: "rtx-pro-6000".to_string(),
        engine: engine.to_string(),
        cards: 2,
        context,
        tokens_per_second: Some(speed),
        fits,
        blocked: (!fits).then(|| "Needs 4 GPUs".to_string()),
        detail: format!("2 of 2 GPUs · full rig · {engine} · {}k context · {speed:.0} tok/s", context / 1000),
    }
}

fn pod() -> LocalController {
    LocalController {
        target: String::new(),
        url: POD_URL.to_string(),
        id: Some("ctl-rtx6000".to_string()),
        name: "rtx-6000-pod".to_string(),
        host: "127.0.0.1".to_string(),
        local: true,
        has_controller: true,
        reachable: true,
        status: LocalMachineStatus::Serving,
        headline: MODEL.to_string(),
        detail: "rtx-6000-pod · port 8000".to_string(),
        summary: MODEL.to_string(),
        note: None,
        elsewhere: None,
        error: None,
        version: Some("0.1.0".to_string()),
        hardware: Some(LocalHardware {
            cpus: 32,
            memory_total_bytes: 256 * GIB,
            memory_free_bytes: 180 * GIB,
            gpus: vec![rtx_gpu(0, 93.7), rtx_gpu(1, 93.5)],
            memory_used_bytes: 187 * GIB,
            memory_capacity_bytes: 192 * GIB,
            memory_label: "VRAM".to_string(),
            gpu_summary: "2× RTX PRO 6000".to_string(),
        }),
        endpoints: vec![LocalEndpoint {
            id: "ctl-rtx6000:8000".to_string(),
            controller_id: "ctl-rtx6000".to_string(),
            port: 8000,
            pid: Some(812),
            models: vec![MODEL.to_string()],
            state: LocalEngineState::Loaded,
            stale: false,
            error: None,
            confirmed_at_ms: None,
            latency_ms: Some(12),
            address: "127.0.0.1:8000".to_string(),
            provider: None,
            job_id: None,
        }],
        jobs: Vec::new(),
        recipes: vec![
            recipe("deepseek-v4.1-flash-vllm-2xrtx6000", MODEL, "vllm", 131_072, 410.0, true),
            recipe("glm-5.3-flash-sglang-2xrtx6000", "GLM-5.3-Flash", "sglang", 200_000, 320.0, true),
            recipe("qwen3.5-235b-vllm-4xrtx6000", "Qwen3.5-235B-A22B", "vllm", 262_144, 180.0, false),
        ],
        requests: 48_210,
        tokens: 3_400_000_000,
        measured_requests: 48_100,
    }
}

fn offline(name: &str, url: &str) -> LocalController {
    LocalController {
        target: url.to_string(),
        url: url.to_string(),
        id: None,
        name: name.to_string(),
        host: url.trim_start_matches("http://").trim_end_matches(":18091").to_string(),
        local: false,
        has_controller: true,
        reachable: false,
        status: LocalMachineStatus::Offline,
        headline: format!("{name} is offline"),
        detail: "connect timed out after 3s It shows live figures again once it reconnects.".to_string(),
        summary: "connect timed out after 3s".to_string(),
        note: None,
        elsewhere: None,
        error: Some("connect timed out after 3s".to_string()),
        version: None,
        hardware: None,
        endpoints: Vec::new(),
        jobs: Vec::new(),
        recipes: Vec::new(),
        requests: 0,
        tokens: 0,
        measured_requests: 0,
    }
}

fn telemetry_gpu(index: u32, used: f64, watts: f64, temperature: f64) -> LocalGpuTelemetry {
    LocalGpuTelemetry {
        index,
        name: "RTX PRO 6000 Blackwell".to_string(),
        memory_used_mib: mib(used),
        memory_total_mib: 96 * 1024,
        power_watts: Some(watts),
        power_limit_watts: Some(275.0),
        temperature_c: Some(temperature),
        utilization: Some(100.0),
    }
}

#[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn token_history() -> TokenHistory {
    let daily = (0_u64..378)
        .map(|day| {
            if day < 6 {
                return 0;
            }
            let hash = ((day * 7919 + 13) % 101) as f64 / 101.0;
            if hash <= 0.14 {
                return 0;
            }
            (hash * hash * hash * 24_000_000.0 * (1.0 + day as f64 / 378.0)) as u64
        })
        .collect();
    TokenHistory {
        since_day: Some("2025-11-03".to_string()),
        total: 3_404_000_000,
        read: 3_200_000_000,
        written: 204_000_000,
        last_week: 100_900_000,
        busiest_day: Some("2026-10-21".to_string()),
        busiest_tokens: 34_800_000,
        active_days: 314,
        tracked_days: 364,
        daily,
        last_day: "2026-11-01".to_string(),
    }
}

#[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn decode_series() -> Vec<f64> {
    (0..288)
        .map(|index| {
            let position = f64::from(index) / 6.0;
            let slot = position as usize;
            let lower = SPIKES[slot.min(SPIKES.len() - 1)];
            let upper = SPIKES[(slot + 1).min(SPIKES.len() - 1)];
            (lower + (upper - lower) * position.fract()) * 3.1
        })
        .collect()
}

fn dashboard() -> LocalDashboard {
    let now = format::now_ms();
    let step = 300_000;
    let gpus = vec![telemetry_gpu(0, 93.7, 275.0, 65.0), telemetry_gpu(1, 93.5, 276.0, 48.0)];
    let memory_used_bytes = gpus.iter().map(|gpu| gpu.memory_used_mib).sum::<u64>() * MIB;
    let memory_total_bytes = gpus.iter().map(|gpu| gpu.memory_total_mib).sum::<u64>() * MIB;
    LocalDashboard {
        controller: String::new(),
        error: None,
        engines: vec![LocalEngineTelemetry {
            port: 8000,
            models: vec![MODEL.to_string()],
            kind: Some("vllm".to_string()),
            loaded_at_ms: Some(now - 86_400_000 - 7_200_000),
        }],
        decode_tps: Some(391.6),
        per_request_tps: Some(97.9),
        running: Some(4),
        running_peak: Some(8),
        waiting: Some(0),
        kv_percent: Some(4.0),
        kv_peak_percent: Some(17.0),
        first_token_ms: Some(346.0),
        first_token_best_ms: Some(32.0),
        power_watts: Some(551.0),
        power_limit_watts: Some(550.0),
        gpu_name: "RTX PRO 6000 Blackwell".to_string(),
        gpus,
        memory_used_bytes,
        memory_total_bytes,
        decode_series: decode_series(),
        decode_series_start_ms: (now / step) * step + step - 288 * step,
        decode_series_step_ms: step,
        tokens: token_history(),
        generated_at_ms: now,
    }
}

fn idle_dashboard() -> LocalDashboard {
    let mut idle = dashboard();
    for gpu in &mut idle.gpus {
        gpu.power_watts = Some(62.0);
        gpu.memory_used_mib = 600;
    }
    let series =
        idle.decode_series.iter().enumerate().map(|(index, value)| if index < 200 { *value } else { 0.0 }).collect();
    LocalDashboard {
        engines: Vec::new(),
        decode_tps: None,
        per_request_tps: None,
        running: None,
        running_peak: None,
        waiting: None,
        kv_percent: None,
        kv_peak_percent: None,
        first_token_ms: None,
        first_token_best_ms: None,
        power_watts: Some(124.0),
        memory_used_bytes: 2 * 600 * MIB,
        decode_series: series,
        ..idle
    }
}
