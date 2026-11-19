use std::sync::{Mutex, PoisonError};

use serde::Deserialize;
use snow::{HandshakeState, TransportState};

pub const XX: &str = "Noise_XXpsk3_25519_ChaChaPoly_SHA256";
pub const KK: &str = "Noise_KK_25519_ChaChaPoly_SHA256";
pub const PROLOGUE: &[u8] = b"local-studio-remote/1\n";
pub const MAX_MESSAGE: usize = 65_535;
pub const MAX_HEADER: usize = 1024;
pub const MAX_JSON: usize = 8 << 20;
const TAG: usize = 16;
const PLAIN: usize = MAX_MESSAGE - TAG;
pub const JSON_FINAL: u8 = 0x01;
pub const JSON_MORE: u8 = 0x02;
pub const BLOB: u8 = 0x03;
pub const BLOB_ID: usize = 16;
const BLOB_HEAD: usize = 1 + BLOB_ID + 1;
const FINAL: u8 = 0x01;

#[derive(Debug, Deserialize)]
pub struct Header {
    pub v: u64,
    pub pattern: String,
    #[serde(default)]
    pub device: Option<String>,
    #[serde(default)]
    pub pair: Option<String>,
    pub protocol: u64,
    pub min_protocol: u64,
}

pub fn prologue(header: &str) -> Vec<u8> {
    let mut prologue = PROLOGUE.to_vec();
    prologue.extend_from_slice(header.as_bytes());
    prologue
}

pub fn parse_header(text: &str) -> Result<Header, String> {
    if text.len() > MAX_HEADER {
        return Err(format!("the opening header is {} bytes; at most {MAX_HEADER}", text.len()));
    }
    let header: Header =
        serde_json::from_str(text).map_err(|error| format!("the opening header is not valid: {error}"))?;
    if header.v != 1 {
        return Err(format!("opening header version {} is not 1", header.v));
    }
    match header.pattern.as_str() {
        "KK" if header.device.as_deref().is_some_and(|device| !device.is_empty() && device.len() <= 64) => Ok(header),
        "XXpsk3" if header.pair.as_deref().is_some_and(|pair| pair.len() == 16) => Ok(header),
        "KK" | "XXpsk3" => Err(format!("a {} header needs its device or pairing id", header.pattern)),
        other => Err(format!("unknown pattern {other:?}")),
    }
}

pub fn read(state: &mut HandshakeState, message: &[u8]) -> Result<Vec<u8>, snow::Error> {
    let mut payload = vec![0u8; MAX_MESSAGE];
    let length = state.read_message(message, &mut payload)?;
    payload.truncate(length);
    Ok(payload)
}

pub fn write(state: &mut HandshakeState, payload: &[u8]) -> Result<Vec<u8>, snow::Error> {
    let mut message = vec![0u8; MAX_MESSAGE];
    let length = state.write_message(payload, &mut message)?;
    message.truncate(length);
    Ok(message)
}

pub struct Channel(Mutex<TransportState>);

impl Channel {
    pub fn new(state: TransportState) -> Self {
        Self(Mutex::new(state))
    }

    pub fn seal(&self, record: &[u8]) -> Result<Vec<u8>, snow::Error> {
        let mut message = vec![0u8; record.len() + TAG];
        let length = self.0.lock().unwrap_or_else(PoisonError::into_inner).write_message(record, &mut message)?;
        message.truncate(length);
        Ok(message)
    }

    pub fn open(&self, message: &[u8]) -> Result<Vec<u8>, snow::Error> {
        let mut record = vec![0u8; message.len()];
        let length = self.0.lock().unwrap_or_else(PoisonError::into_inner).read_message(message, &mut record)?;
        record.truncate(length);
        Ok(record)
    }
}

pub fn json_records(text: &str) -> Vec<Vec<u8>> {
    let bytes = text.as_bytes();
    let chunks: Vec<&[u8]> = if bytes.is_empty() { vec![bytes] } else { bytes.chunks(PLAIN - 1).collect() };
    let last = chunks.len() - 1;
    chunks
        .into_iter()
        .enumerate()
        .map(|(at, chunk)| {
            let mut record = Vec::with_capacity(chunk.len() + 1);
            record.push(if at == last { JSON_FINAL } else { JSON_MORE });
            record.extend_from_slice(chunk);
            record
        })
        .collect()
}

pub fn blob_records(id: &[u8; BLOB_ID], data: &[u8]) -> Vec<Vec<u8>> {
    let chunks: Vec<&[u8]> = if data.is_empty() { vec![data] } else { data.chunks(PLAIN - BLOB_HEAD).collect() };
    let last = chunks.len() - 1;
    chunks
        .into_iter()
        .enumerate()
        .map(|(at, chunk)| {
            let mut record = Vec::with_capacity(chunk.len() + BLOB_HEAD);
            record.push(BLOB);
            record.extend_from_slice(id);
            record.push(if at == last { FINAL } else { 0 });
            record.extend_from_slice(chunk);
            record
        })
        .collect()
}

pub enum Inbound {
    Json(String),
    Chunk { blob: [u8; BLOB_ID], last: bool, data: Vec<u8> },
}

#[derive(Default)]
pub struct Joiner {
    json: Vec<u8>,
    open: bool,
}

impl Joiner {
    pub fn feed(&mut self, mut record: Vec<u8>) -> Result<Option<Inbound>, String> {
        let Some(&kind) = record.first() else { return Err("an empty record".to_string()) };
        match kind {
            JSON_FINAL | JSON_MORE => {
                if self.json.len() + record.len() - 1 > MAX_JSON {
                    return Err(format!("a JSON frame over {MAX_JSON} bytes"));
                }
                self.json.extend_from_slice(&record[1..]);
                if kind == JSON_MORE {
                    self.open = true;
                    return Ok(None);
                }
                self.open = false;
                let joined = std::mem::take(&mut self.json);
                String::from_utf8(joined)
                    .map(|text| Some(Inbound::Json(text)))
                    .map_err(|_| "a JSON frame is not UTF-8".to_string())
            }
            BLOB => {
                if self.open {
                    return Err("a blob record inside an unfinished JSON frame".to_string());
                }
                if record.len() < BLOB_HEAD {
                    return Err("a short blob record".to_string());
                }
                let mut blob = [0u8; BLOB_ID];
                blob.copy_from_slice(&record[1..=BLOB_ID]);
                let flags = record[BLOB_ID + 1];
                if flags & !FINAL != 0 {
                    return Err(format!("unknown blob flags {flags:#04x}"));
                }
                let data = record.split_off(BLOB_HEAD);
                Ok(Some(Inbound::Chunk { blob, last: flags & FINAL != 0, data }))
            }
            other => Err(format!("unknown record type {other:#04x}")),
        }
    }
}
