use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

pub const HEADER_WITHIN: Duration = Duration::from_secs(5);
pub const HANDSHAKE_WITHIN: Duration = Duration::from_secs(10);
const OPENING_AT_ONCE: usize = 8;
const OPENING_PER_CLIENT: usize = 2;
const LOOPBACK_KEPT: usize = 2;
const FAILURES: usize = 5;
const FAILURE_WINDOW: Duration = Duration::from_secs(60);
const BAN: Duration = Duration::from_secs(600);

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Client {
    Loopback,
    Key(String),
}

impl fmt::Display for Client {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Loopback => f.write_str("loopback"),
            Self::Key(key) => f.write_str(key),
        }
    }
}

#[derive(Default)]
struct Record {
    failures: VecDeque<Instant>,
    banned_until: Option<Instant>,
}

#[derive(Default)]
struct Pending {
    total: usize,
    per: HashMap<Client, usize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Listener {
    Local,
    Tunnel,
}

#[derive(Default)]
pub struct Gate {
    records: Mutex<HashMap<Client, Record>>,
    pending: Arc<Mutex<[Pending; 2]>>,
}

pub struct Opening {
    pending: Arc<Mutex<[Pending; 2]>>,
    listener: Listener,
    client: Client,
}

impl Drop for Opening {
    fn drop(&mut self) {
        let mut all = self.pending.lock().unwrap_or_else(PoisonError::into_inner);
        let pending = &mut all[self.listener as usize];
        pending.total = pending.total.saturating_sub(1);
        if let Some(count) = pending.per.get_mut(&self.client) {
            *count -= 1;
            if *count == 0 {
                pending.per.remove(&self.client);
            }
        }
    }
}

impl Gate {
    pub fn banned(&self, client: &Client) -> bool {
        if *client == Client::Loopback {
            return false;
        }
        let records = self.records.lock().unwrap_or_else(PoisonError::into_inner);
        records.get(client).and_then(|record| record.banned_until).is_some_and(|until| until > Instant::now())
    }

    pub fn open(&self, listener: Listener, client: &Client) -> Option<Opening> {
        let mut all = self.pending.lock().unwrap_or_else(PoisonError::into_inner);
        let pending = &mut all[listener as usize];
        let mine = pending.per.get(client).copied().unwrap_or_default();
        let loopback = pending.per.get(&Client::Loopback).copied().unwrap_or_default();
        let kept = listener == Listener::Local
            && *client != Client::Loopback
            && pending.total - loopback >= OPENING_AT_ONCE - LOOPBACK_KEPT;
        if pending.total >= OPENING_AT_ONCE || mine >= OPENING_PER_CLIENT || kept {
            return None;
        }
        pending.total += 1;
        pending.per.insert(client.clone(), mine + 1);
        Some(Opening { pending: Arc::clone(&self.pending), listener, client: client.clone() })
    }

    pub fn fail(&self, client: &Client, pattern: &str, reason: &str) {
        eprintln!("local-studio-serve: refused {client} ({pattern}): {reason}");
        if *client == Client::Loopback {
            return;
        }
        let now = Instant::now();
        let mut records = self.records.lock().unwrap_or_else(PoisonError::into_inner);
        records.retain(|_, record| {
            record.failures.retain(|at| now.duration_since(*at) < FAILURE_WINDOW);
            !record.failures.is_empty() || record.banned_until.is_some_and(|until| until > now)
        });
        let record = records.entry(client.clone()).or_default();
        record.failures.push_back(now);
        if record.failures.len() >= FAILURES {
            record.failures.clear();
            record.banned_until = Some(now + BAN);
            eprintln!(
                "local-studio-serve: {client} failed {FAILURES} times within a minute and is refused for {} minutes",
                BAN.as_secs() / 60
            );
        }
    }
}
