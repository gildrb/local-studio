use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use eukhe_types::daemon::DaemonCommand;
use serde::Deserialize;
use serde_json::{Map, Value};

use super::history::{self, DayTokens, HEATMAP_DAYS};
use super::model::{UsageBucket, UsageByModel, UsageLimit, UsagePeriod, UsageReport};
use super::time::{days_since_epoch, parse_rfc3339_ms, DAY_MS};
use crate::daemon::DaemonQuery;

const HOUR_MS: i64 = 3_600_000;
const TRANSCRIPT: &str = "main.jsonl";
const ASSISTANT_KIND: &str = "pi.assistant";

fn window(period: UsagePeriod, now: i64) -> (i64, i64, usize) {
    let days: i64 = match period {
        UsagePeriod::Day => return ((now.div_euclid(HOUR_MS) - 23) * HOUR_MS, HOUR_MS, 24),
        UsagePeriod::Week => 7,
        UsagePeriod::Month => 30,
        UsagePeriod::Quarter => 90,
    };
    ((days_since_epoch(now) - days + 1) * DAY_MS, DAY_MS, usize::try_from(days).unwrap_or(1))
}

pub(crate) async fn load(
    daemon: &DaemonQuery,
    ledger: Arc<Mutex<Ledger>>,
    period: UsagePeriod,
    now_ms: i64,
) -> Result<UsageReport, String> {
    let cwd = std::env::var_os("HOME").map_or_else(|| PathBuf::from("/"), PathBuf::from);
    let mut data = daemon
        .call(DaemonCommand::ListSavedSessions {
            id: None,
            active_session_id: None,
            cwd: Some(cwd.display().to_string()),
            session_dir: daemon.session_dir().map(|dir| dir.display().to_string()),
            scope: Value::Null,
            rest: Map::default(),
        })
        .await?;
    let rows = match data.get_mut("sessions").map(Value::take) {
        Some(Value::Array(rows)) => rows,
        _ => Vec::new(),
    };
    let mut report = tokio::task::spawn_blocking(move || {
        ledger.lock().unwrap_or_else(PoisonError::into_inner).report(&rows, period, now_ms)
    })
    .await
    .map_err(|error| format!("Computing usage failed: {error}"))?;
    let live = daemon
        .call(DaemonCommand::List {
            id: None,
            all: None,
            cwd: None,
            session_dir: None,
            include_client_owned: Some(true),
            rest: Map::default(),
        })
        .await
        .unwrap_or(Value::Null);
    let summaries = live.as_array().or_else(|| live.get("sessions").and_then(Value::as_array));
    report.limits = limits(summaries.map_or(&[], Vec::as_slice));
    Ok(report)
}

fn limits(summaries: &[Value]) -> Vec<UsageLimit> {
    let mut parked: BTreeMap<String, Option<i64>> = BTreeMap::new();
    for summary in summaries {
        let summary = summary.get("summary").unwrap_or(summary);
        let park = summary.get("quotaPark").filter(|park| park.is_object());
        let is_parked = summary.get("isQuotaParked").and_then(Value::as_bool).unwrap_or(false);
        if park.is_none() && !is_parked {
            continue;
        }
        let provider = park
            .and_then(|park| park.get("provider"))
            .or_else(|| summary.get("model").and_then(|model| model.get("provider")))
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let resets_at = park.and_then(|park| park.get("resumeAt")).and_then(Value::as_str).and_then(parse_rfc3339_ms);
        let entry = parked.entry(provider).or_insert(None);
        *entry = (*entry).max(resets_at);
    }
    parked
        .into_iter()
        .map(|(provider, resets_at)| UsageLimit {
            provider,
            window: "quota park".to_string(),
            used_percent: Some(100.0),
            resets_at,
            parked: true,
        })
        .collect()
}

#[derive(Clone, Copy, Default)]
struct Spend {
    read: u64,
    cache_read: u64,
    written: u64,
    cost: f64,
    requests: u64,
}

impl Spend {
    fn tokens(self) -> u64 {
        self.read.saturating_add(self.written)
    }
}

fn row_spend(value: Option<&Value>) -> Option<Spend> {
    let value = value.filter(|value| value.is_object())?;
    let number = |key: &str| value.get(key).and_then(Value::as_u64).unwrap_or(0);
    Some(Spend {
        read: number("inputTokens"),
        cache_read: 0,
        written: number("outputTokens"),
        cost: value.get("cost").and_then(Value::as_f64).unwrap_or(0.0),
        requests: 0,
    })
}

#[derive(Deserialize)]
struct Commit {
    #[serde(default)]
    writes: Vec<CommitWrite>,
}

#[derive(Deserialize)]
struct CommitWrite {
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    value: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Assistant<'a> {
    #[serde(default)]
    role: &'a str,
    #[serde(default)]
    provider: &'a str,
    #[serde(default)]
    model: &'a str,
    #[serde(default)]
    timestamp: i64,
    #[serde(default)]
    usage: Tokens,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Tokens {
    #[serde(default)]
    input: u64,
    #[serde(default)]
    output: u64,
    #[serde(default)]
    cache_read: u64,
    #[serde(default)]
    cache_write: u64,
    #[serde(default)]
    cost: Cost,
}

#[derive(Deserialize, Default)]
struct Cost {
    #[serde(default)]
    total: f64,
}

struct Call {
    at: i64,
    model: usize,
    spend: Spend,
}

#[derive(Default)]
struct Transcript {
    offset: u64,
    models: Vec<(String, String)>,
    calls: Vec<Call>,
}

impl Transcript {
    fn refresh(&mut self, file: &Path) -> std::io::Result<()> {
        let len = std::fs::metadata(file)?.len();
        if len < self.offset {
            *self = Self::default();
        }
        if len == self.offset {
            return Ok(());
        }
        let mut handle = File::open(file)?;
        handle.seek(SeekFrom::Start(self.offset))?;
        let mut bytes = Vec::new();
        handle.take(len - self.offset).read_to_end(&mut bytes)?;
        let Some(end) = bytes.iter().rposition(|byte| *byte == b'\n') else { return Ok(()) };
        for line in bytes[..end].split(|byte| *byte == b'\n') {
            self.fold(line);
        }
        self.offset = self.offset.saturating_add(u64::try_from(end + 1).unwrap_or(u64::MAX));
        Ok(())
    }

    fn fold(&mut self, line: &[u8]) {
        let Ok(text) = std::str::from_utf8(line) else { return };
        if !text.contains(ASSISTANT_KIND) {
            return;
        }
        let Ok(commit) = serde_json::from_str::<Commit>(text) else { return };
        for write in &commit.writes {
            if write.kind != "entry" || write.value.get("kind").and_then(Value::as_str) != Some(ASSISTANT_KIND) {
                continue;
            }
            let Some(message) = write.value.get("model").and_then(|model| model.get(0)) else { continue };
            let Ok(assistant) = Assistant::deserialize(message) else { continue };
            if assistant.role != "assistant" {
                continue;
            }
            let usage = &assistant.usage;
            let spend = Spend {
                read: usage.input.saturating_add(usage.cache_read).saturating_add(usage.cache_write),
                cache_read: usage.cache_read,
                written: usage.output,
                cost: usage.cost.total,
                requests: 1,
            };
            let model = self.model_index(assistant.provider, assistant.model);
            self.calls.push(Call { at: assistant.timestamp, model, spend });
        }
    }

    fn model_index(&mut self, provider: &str, model: &str) -> usize {
        if let Some(index) = self.models.iter().position(|(known, id)| known == provider && id == model) {
            return index;
        }
        self.models.push((provider.to_string(), model.to_string()));
        self.models.len() - 1
    }
}

#[derive(Default)]
pub(crate) struct Ledger {
    transcripts: HashMap<PathBuf, Transcript>,
}

impl Ledger {
    fn refresh(&mut self, rows: &[Value]) -> Vec<Option<PathBuf>> {
        let storages: Vec<Option<PathBuf>> = rows
            .iter()
            .map(|row| {
                let dir = PathBuf::from(row.get("path").and_then(Value::as_str)?);
                dir.join(TRANSCRIPT).is_file().then_some(dir)
            })
            .collect();
        let live: HashSet<&PathBuf> = storages.iter().flatten().collect();
        self.transcripts.retain(|dir, _| live.contains(dir));
        for dir in storages.iter().flatten() {
            let transcript = self.transcripts.entry(dir.clone()).or_default();
            if transcript.refresh(&dir.join(TRANSCRIPT)).is_err() {
                *transcript = Transcript::default();
            }
        }
        storages
    }

    pub(crate) fn report(&mut self, rows: &[Value], period: UsagePeriod, now: i64) -> UsageReport {
        let storages = self.refresh(rows);
        let mut tally = Tally::new(period, now);
        for (row, storage) in rows.iter().zip(&storages) {
            let modified = row.get("modified").and_then(Value::as_str).and_then(parse_rfc3339_ms);
            let created = row.get("created").and_then(Value::as_str).and_then(parse_rfc3339_ms);
            if let Some(first) = created.or(modified) {
                tally.first_day =
                    Some(tally.first_day.map_or(days_since_epoch(first), |day| day.min(days_since_epoch(first))));
            }
            let fallback = modified.unwrap_or(now);
            let transcript = storage
                .as_ref()
                .and_then(|dir| self.transcripts.get(dir))
                .filter(|transcript| !transcript.calls.is_empty());
            tally.touched = false;
            if let Some(transcript) = transcript {
                for call in &transcript.calls {
                    let (provider, model) = &transcript.models[call.model];
                    tally.add(if call.at > 0 { call.at } else { fallback }, provider, model, call.spend);
                }
            } else if let Some(spend) = row_spend(row.get("usage")) {
                let (provider, model) = row_model(row);
                tally.add(fallback, provider, model, spend);
            }
            if let Some(spend) = row_spend(row.get("deletedDescendantUsage")) {
                let (provider, model) = row_model(row);
                tally.add(fallback, provider, model, spend);
            }
            if tally.touched {
                tally.sessions += 1;
            }
        }
        tally.finish()
    }
}

fn row_model(row: &Value) -> (&str, &str) {
    let model = row.get("model");
    let provider = model.and_then(|model| model.get("provider")).and_then(Value::as_str).unwrap_or("unknown");
    let id = model
        .and_then(|model| model.get("modelId").or_else(|| model.get("id")))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    (provider, id)
}

struct Tally<'a> {
    period: UsagePeriod,
    now: i64,
    start: i64,
    step: i64,
    buckets: Vec<(u64, f64)>,
    total: Spend,
    sessions: u64,
    touched: bool,
    by_model: BTreeMap<(&'a str, &'a str), Spend>,
    days: BTreeMap<i64, Spend>,
    first_day: Option<i64>,
}

impl<'a> Tally<'a> {
    fn new(period: UsagePeriod, now: i64) -> Self {
        let (start, step, count) = window(period, now);
        Self {
            period,
            now,
            start,
            step,
            buckets: vec![(0, 0.0); count],
            total: Spend::default(),
            sessions: 0,
            touched: false,
            by_model: BTreeMap::new(),
            days: BTreeMap::new(),
            first_day: None,
        }
    }

    fn add(&mut self, at: i64, provider: &'a str, model: &'a str, spend: Spend) {
        let at = at.min(self.now);
        merge(self.days.entry(days_since_epoch(at)).or_default(), spend);
        if at < self.start {
            return;
        }
        let index = usize::try_from((at - self.start) / self.step).unwrap_or(0).min(self.buckets.len() - 1);
        let bucket = &mut self.buckets[index];
        bucket.0 = bucket.0.saturating_add(spend.tokens());
        bucket.1 += spend.cost;
        merge(&mut self.total, spend);
        merge(self.by_model.entry((provider, model)).or_default(), spend);
        self.touched = true;
    }

    fn finish(self) -> UsageReport {
        let today = days_since_epoch(self.now);
        let mut daily_cost_usd = vec![0.0; HEATMAP_DAYS];
        let mut lifetime_cost_usd = 0.0;
        for (day, spend) in &self.days {
            lifetime_cost_usd += spend.cost;
            if let Some(slot) = history::heatmap_slot(*day, today) {
                daily_cost_usd[slot] += spend.cost;
            }
        }
        let days =
            self.days.iter().map(|(day, spend)| DayTokens { day: *day, read: spend.read, written: spend.written });
        let lifetime = history::token_history(days, self.first_day, self.now);
        let mut by_model: Vec<UsageByModel> = self
            .by_model
            .into_iter()
            .map(|((provider, model), spend)| UsageByModel {
                provider: provider.to_string(),
                model: model.to_string(),
                tokens: spend.tokens(),
                cost_usd: spend.cost,
                requests: spend.requests,
            })
            .collect();
        by_model.sort_by(|left, right| right.tokens.cmp(&left.tokens).then_with(|| left.model.cmp(&right.model)));
        let series = self
            .buckets
            .iter()
            .zip(0_i64..)
            .map(|((tokens, cost_usd), index)| UsageBucket {
                start_ms: self.start + index * self.step,
                tokens: *tokens,
                cost_usd: *cost_usd,
            })
            .collect();
        UsageReport {
            period: self.period,
            total_tokens: self.total.tokens(),
            input_tokens: self.total.read,
            cache_read_tokens: self.total.cache_read,
            output_tokens: self.total.written,
            cost_usd: self.total.cost,
            requests: self.total.requests,
            sessions: self.sessions,
            by_model,
            series,
            series_step_ms: self.step,
            lifetime,
            lifetime_cost_usd,
            daily_cost_usd,
            limits: Vec::new(),
        }
    }
}

fn merge(into: &mut Spend, spend: Spend) {
    into.read = into.read.saturating_add(spend.read);
    into.cache_read = into.cache_read.saturating_add(spend.cache_read);
    into.written = into.written.saturating_add(spend.written);
    into.cost += spend.cost;
    into.requests = into.requests.saturating_add(spend.requests);
}
