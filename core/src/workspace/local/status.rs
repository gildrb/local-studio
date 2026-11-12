use crate::workspace::model::{LocalController, LocalElsewhere, LocalEndpoint, LocalEngineState, LocalMachineStatus};

fn age(ms: i64) -> String {
    let seconds = (ms / 1000).max(0);
    match seconds {
        0..60 => format!("{seconds} s"),
        60..3600 => format!("{} min", seconds / 60),
        3600..86_400 => format!("{} h", seconds / 3600),
        _ => format!("{} d", seconds / 86_400),
    }
}

fn place(endpoint: &LocalEndpoint) -> String {
    match &endpoint.provider {
        Some(provider) if endpoint.controller_id.is_empty() => format!("{provider} at {}", endpoint.address),
        _ => format!("port {}", endpoint.port),
    }
}

fn confirmed(endpoint: &LocalEndpoint, now: i64) -> Option<String> {
    endpoint.confirmed_at_ms.map(|at| format!("confirmed {} ago", age(now - at)))
}

fn models(endpoints: &[&LocalEndpoint]) -> String {
    let mut all: Vec<&str> = endpoints.iter().flat_map(|endpoint| endpoint.models.iter().map(String::as_str)).collect();
    all.sort_unstable();
    all.dedup();
    all.join(", ")
}

fn status(controller: &LocalController) -> LocalMachineStatus {
    let any = |state| controller.endpoints.iter().any(|endpoint| endpoint.state == state);
    if controller.has_controller && !controller.reachable {
        LocalMachineStatus::Offline
    } else if any(LocalEngineState::Loaded) {
        LocalMachineStatus::Serving
    } else if controller.jobs.iter().any(|job| !job.failed) {
        LocalMachineStatus::Loading
    } else if any(LocalEngineState::Unreachable) {
        LocalMachineStatus::EngineUnreachable
    } else {
        LocalMachineStatus::NoModel
    }
}

fn serving(controller: &mut LocalController, now: i64) {
    let loaded: Vec<&LocalEndpoint> =
        controller.endpoints.iter().filter(|endpoint| endpoint.state == LocalEngineState::Loaded).collect();
    let Some(first) = loaded.first() else { return };
    let mut detail = vec![controller.name.clone(), place(first)];
    if first.stale {
        let since = confirmed(first, now).unwrap_or_else(|| "not confirmed yet".to_string());
        detail.push(match &first.error {
            Some(error) => format!("last {since}; the latest check failed: {error}"),
            None => format!("last {since}"),
        });
    } else if let Some(latency) = first.latency_ms.filter(|_| first.controller_id.is_empty()) {
        detail.push(format!("answered /models in {latency} ms"));
    }
    if loaded.len() > 1 {
        let more = loaded.len() - 1;
        detail.push(format!("{more} more engine{} running", if more == 1 { "" } else { "s" }));
    }
    let names = models(&loaded);
    controller.summary = if first.stale {
        format!(
            "{names} · not confirmed for {}",
            first.confirmed_at_ms.map_or_else(|| "a while".to_string(), |at| age(now - at))
        )
    } else {
        names.clone()
    };
    controller.headline = names;
    controller.detail = detail.join(" · ");
}

fn unreachable(controller: &mut LocalController, now: i64) {
    let down: Vec<&LocalEndpoint> =
        controller.endpoints.iter().filter(|endpoint| endpoint.state == LocalEngineState::Unreachable).collect();
    let Some(first) = down.first() else { return };
    let error = first.error.clone().unwrap_or_else(|| "It did not answer.".to_string());
    let last = models(&down);
    let base = format!("{} · {}: {error}", controller.name, place(first));
    let detail = if last.is_empty() {
        base
    } else {
        let since = confirmed(first, now).map(|since| format!(", {since}")).unwrap_or_default();
        format!("{base} It last served {last}{since}.")
    };
    controller.headline = format!("The engine on {} is not answering", controller.name);
    controller.summary = format!("Engine not answering: {error}");
    controller.detail = detail;
}

fn idle(controller: &mut LocalController) {
    controller.headline = format!("No model loaded on {}", controller.name);
    let empty = controller.endpoints.iter().find(|endpoint| endpoint.state == LocalEngineState::Empty);
    controller.summary = if empty.is_some() { "Engine up, no model loaded" } else { "No model loaded" }.to_string();
    controller.detail = if let Some(empty) = empty {
        format!("The engine at {} answered with an empty model list.", place(empty))
    } else if let Some(failed) = controller.jobs.iter().find(|job| job.failed) {
        failed.detail.clone()
    } else if let Some(elsewhere) = &controller.elsewhere {
        format!("{} is loaded on {}.", elsewhere.models, elsewhere.name)
    } else if controller.has_controller {
        format!("{} is idle. Load a model from the registry to serve it.", controller.name)
    } else {
        format!("No engine answers on {}.", controller.name)
    };
}

pub(super) fn describe(controllers: &mut [LocalController], now: i64) {
    for controller in controllers.iter_mut() {
        controller.status = status(controller);
    }
    let loaded_elsewhere: Vec<LocalElsewhere> = controllers
        .iter()
        .filter(|controller| controller.status == LocalMachineStatus::Serving)
        .map(|controller| {
            let loaded: Vec<&LocalEndpoint> =
                controller.endpoints.iter().filter(|endpoint| endpoint.state == LocalEngineState::Loaded).collect();
            LocalElsewhere { url: controller.url.clone(), name: controller.name.clone(), models: models(&loaded) }
        })
        .collect();
    for controller in controllers.iter_mut() {
        controller.elsewhere = (controller.status != LocalMachineStatus::Serving)
            .then(|| loaded_elsewhere.iter().find(|other| other.url != controller.url).cloned())
            .flatten();
        controller.note = (!controller.has_controller).then(|| {
            format!(
                "Hardware, decode and token figures need a Local controller on {}. Add one in Settings → Local.",
                controller.name
            )
        });
        match controller.status {
            LocalMachineStatus::Serving => serving(controller, now),
            LocalMachineStatus::EngineUnreachable => unreachable(controller, now),
            LocalMachineStatus::NoModel => idle(controller),
            LocalMachineStatus::Loading => {
                let job = controller.jobs.iter().find(|job| !job.failed);
                controller.headline =
                    format!("Loading {} on {}", job.map_or("a model", |job| job.recipe_id.as_str()), controller.name);
                controller.detail = job.map(|job| job.detail.clone()).unwrap_or_default();
                controller.summary = job.map(|job| format!("Loading {}", job.recipe_id)).unwrap_or_default();
            }
            LocalMachineStatus::Offline => {
                let last = models(&controller.endpoints.iter().collect::<Vec<_>>());
                let error = controller.error.clone().unwrap_or_else(|| "Its controller does not answer.".to_string());
                controller.headline = format!("{} is offline", controller.name);
                controller.summary.clone_from(&error);
                controller.detail = if last.is_empty() {
                    format!("{error} It shows live figures again once it reconnects.")
                } else {
                    format!("{error} It last ran {last}. It shows live figures again once it reconnects.")
                };
            }
        }
    }
}
