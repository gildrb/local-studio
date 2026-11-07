use std::collections::BTreeMap;
use std::path::PathBuf;

use eukhe_types::daemon::DaemonCommand;
use serde_json::{Map, Value};

use super::model::{UsageByModel, UsageDay, UsagePeriod, UsageReport};
use super::time::{day_key, days_since_epoch, parse_rfc3339_ms, DAY_MS};
use crate::daemon::DaemonQuery;

fn window_days(period: UsagePeriod) -> i64 {
    match period {
        UsagePeriod::Day => 1,
        UsagePeriod::Week => 7,
        UsagePeriod::Month => 30,
        UsagePeriod::Quarter => 90,
    }
}

pub(crate) async fn load(daemon: &DaemonQuery, period: UsagePeriod, now_ms: i64) -> Result<UsageReport, String> {
    let cwd = std::env::var_os("HOME").map_or_else(|| PathBuf::from("/"), PathBuf::from);
    let data = daemon
        .call(DaemonCommand::ListSavedSessions {
            id: None,
            active_session_id: None,
            cwd: Some(cwd.display().to_string()),
            session_dir: daemon.session_dir().map(|dir| dir.display().to_string()),
            scope: Value::Null,
            rest: Map::default(),
        })
        .await?;
    let rows = data.get("sessions").and_then(Value::as_array).cloned().unwrap_or_default();
    Ok(aggregate(&rows, period, now_ms))
}

struct Spend {
    input: u64,
    output: u64,
    cost: f64,
}

fn spend(value: Option<&Value>) -> Option<Spend> {
    let value = value.filter(|value| value.is_object())?;
    let number = |key: &str| value.get(key).and_then(Value::as_u64).unwrap_or(0);
    Some(Spend {
        input: number("inputTokens"),
        output: number("outputTokens"),
        cost: value.get("cost").and_then(Value::as_f64).unwrap_or(0.0),
    })
}

pub(crate) fn aggregate(rows: &[Value], period: UsagePeriod, now_ms: i64) -> UsageReport {
    let days = window_days(period);
    let since = now_ms - days * DAY_MS;
    let first_day = days_since_epoch(since);
    let last_day = days_since_epoch(now_ms);
    let mut daily: BTreeMap<i64, (u64, f64)> = (first_day..=last_day).map(|day| (day, (0, 0.0))).collect();
    let mut by_model: BTreeMap<(String, String), (u64, f64, u64)> = BTreeMap::new();
    let mut report = UsageReport {
        period,
        total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0.0,
        requests: 0,
        by_model: Vec::new(),
        daily: Vec::new(),
    };
    for row in rows {
        let Some(modified) = row.get("modified").and_then(Value::as_str).and_then(parse_rfc3339_ms) else { continue };
        if modified < since || modified > now_ms + DAY_MS {
            continue;
        }
        let own = spend(row.get("usage"));
        let deleted = spend(row.get("deletedDescendantUsage"));
        if own.is_none() && deleted.is_none() {
            continue;
        }
        let model = row.get("model");
        let provider = model.and_then(|model| model.get("provider")).and_then(Value::as_str).unwrap_or("unknown");
        let model_id = model
            .and_then(|model| model.get("modelId").or_else(|| model.get("id")))
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let mut tokens = 0;
        let mut cost = 0.0;
        for part in [own, deleted].into_iter().flatten() {
            report.input_tokens += part.input;
            report.output_tokens += part.output;
            tokens += part.input + part.output;
            cost += part.cost;
        }
        report.total_tokens += tokens;
        report.cost_usd += cost;
        report.requests += 1;
        let entry = by_model.entry((provider.to_string(), model_id.to_string())).or_insert((0, 0.0, 0));
        entry.0 += tokens;
        entry.1 += cost;
        entry.2 += 1;
        let day = daily.entry(days_since_epoch(modified).clamp(first_day, last_day)).or_insert((0, 0.0));
        day.0 += tokens;
        day.1 += cost;
    }
    let mut models: Vec<UsageByModel> = by_model
        .into_iter()
        .map(|((provider, model), (tokens, cost_usd, requests))| UsageByModel {
            provider,
            model,
            tokens,
            cost_usd,
            requests,
        })
        .collect();
    models.sort_by(|left, right| right.tokens.cmp(&left.tokens).then_with(|| left.model.cmp(&right.model)));
    report.by_model = models;
    report.daily = daily
        .into_iter()
        .map(|(day, (tokens, cost_usd))| UsageDay { day: day_key(day * DAY_MS), tokens, cost_usd })
        .collect();
    report
}
