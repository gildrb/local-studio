use std::fmt;
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context};
use serde::{Deserialize, Serialize};

pub const PAIRING_TTL_MS: i64 = 10 * 60 * 1000;
pub const KEY_BYTES: usize = 32;
const PAIRING_ID_BYTES: usize = 8;

pub struct Psk(pub [u8; KEY_BYTES]);

impl fmt::Debug for Psk {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Psk(..)")
    }
}

pub struct StaticKey {
    pub private: Vec<u8>,
    pub public: Vec<u8>,
}

impl fmt::Debug for StaticKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("StaticKey(..)")
    }
}

pub fn random<const N: usize>() -> anyhow::Result<[u8; N]> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).map_err(|error| anyhow::anyhow!("get random bytes: {error}"))?;
    Ok(bytes)
}

pub fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut text = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        text.push(char::from(DIGITS[usize::from(byte >> 4)]));
        text.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    text
}

pub fn unhex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) {
        return None;
    }
    (0..text.len()).step_by(2).map(|at| u8::from_str_radix(text.get(at..at + 2)?, 16).ok()).collect()
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or_default()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub app: String,
    #[serde(default)]
    pub channel: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    #[serde(flatten)]
    pub info: DeviceInfo,
    pub key: String,
    pub first_seen: i64,
    pub last_seen: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Ledger {
    machine_id: String,
    devices: Vec<Device>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pairing {
    id: String,
    secret: String,
    expires_at: i64,
}

pub struct Devices {
    folder: PathBuf,
    ledger: PathBuf,
    pairing: PathBuf,
    lock: PathBuf,
    key: PathBuf,
}

struct Held(std::fs::File);

impl Drop for Held {
    fn drop(&mut self) {
        self.0.unlock().ok();
    }
}

impl Devices {
    pub fn new(data_dir: &Path) -> Self {
        let folder = data_dir.join("remote");
        Self {
            ledger: folder.join("devices.json"),
            pairing: folder.join("pairing.json"),
            lock: folder.join("devices.lock"),
            key: folder.join("static.key"),
            folder,
        }
    }

    fn hold(&self) -> anyhow::Result<Held> {
        std::fs::create_dir_all(&self.folder).with_context(|| format!("create {}", self.folder.display()))?;
        std::fs::set_permissions(&self.folder, std::fs::Permissions::from_mode(0o700))
            .with_context(|| format!("restrict {}", self.folder.display()))?;
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .open(&self.lock)
            .with_context(|| format!("open {}", self.lock.display()))?;
        file.lock().with_context(|| format!("lock {}", self.lock.display()))?;
        Ok(Held(file))
    }

    fn read(&self) -> anyhow::Result<Ledger> {
        match std::fs::read(&self.ledger) {
            Ok(bytes) => serde_json::from_slice(&bytes).with_context(|| format!("read {}", self.ledger.display())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Ledger::default()),
            Err(error) => Err(error).with_context(|| format!("read {}", self.ledger.display())),
        }
    }

    fn edit<T>(&self, change: impl FnOnce(&mut Ledger) -> anyhow::Result<T>) -> anyhow::Result<T> {
        let _held = self.hold()?;
        let mut ledger = self.read()?;
        let result = change(&mut ledger)?;
        write_private(&self.ledger, &serde_json::to_vec_pretty(&ledger)?)?;
        Ok(result)
    }

    pub fn machine_id(&self) -> anyhow::Result<String> {
        let known = self.read()?.machine_id;
        if !known.is_empty() {
            return Ok(known);
        }
        self.edit(|ledger| {
            if ledger.machine_id.is_empty() {
                ledger.machine_id = hex(&random::<16>()?);
            }
            Ok(ledger.machine_id.clone())
        })
    }

    pub fn static_key(&self) -> anyhow::Result<StaticKey> {
        let _held = self.hold()?;
        match std::fs::read(&self.key) {
            Ok(bytes) => {
                let mode = std::fs::metadata(&self.key)?.permissions().mode() & 0o777;
                if mode & 0o077 != 0 {
                    bail!("{} is readable by others (mode {mode:o}); it must be 0600", self.key.display());
                }
                if bytes.len() != KEY_BYTES * 2 {
                    bail!("{} is not a static key pair", self.key.display());
                }
                let (private, public) = bytes.split_at(KEY_BYTES);
                Ok(StaticKey { private: private.to_vec(), public: public.to_vec() })
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let params = crate::noise::KK.parse()?;
                let pair = snow::Builder::new(params).generate_keypair()?;
                let mut bytes = pair.private.clone();
                bytes.extend_from_slice(&pair.public);
                write_private(&self.key, &bytes)?;
                Ok(StaticKey { private: pair.private, public: pair.public })
            }
            Err(error) => Err(error).with_context(|| format!("read {}", self.key.display())),
        }
    }

    pub fn open_pairing(&self) -> anyhow::Result<(String, Psk, i64)> {
        let _held = self.hold()?;
        let id = hex(&random::<PAIRING_ID_BYTES>()?);
        let secret = random::<KEY_BYTES>()?;
        let expires_at = now_ms() + PAIRING_TTL_MS;
        let pairing = Pairing { id: id.clone(), secret: hex(&secret), expires_at };
        write_private(&self.pairing, &serde_json::to_vec(&pairing)?)?;
        Ok((id, Psk(secret), expires_at))
    }

    fn open(&self) -> anyhow::Result<Option<Pairing>> {
        match std::fs::read(&self.pairing) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes).ok()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error).with_context(|| format!("read {}", self.pairing.display())),
        }
    }

    pub fn pairing(&self, id: &str) -> anyhow::Result<Result<Psk, &'static str>> {
        let _held = self.hold()?;
        let Some(pairing) = self.open()? else { return Ok(Err("no pairing is open")) };
        if pairing.id != id {
            return Ok(Err("no open pairing has this id"));
        }
        if pairing.expires_at < now_ms() {
            std::fs::remove_file(&self.pairing).ok();
            return Ok(Err("the pairing expired"));
        }
        let secret = unhex(&pairing.secret)
            .and_then(|bytes| <[u8; KEY_BYTES]>::try_from(bytes).ok())
            .context("the open pairing's secret is malformed")?;
        Ok(Ok(Psk(secret)))
    }

    pub fn complete_pairing(&self, id: &str, info: DeviceInfo, key: &[u8]) -> anyhow::Result<Result<(), &'static str>> {
        if info.id.trim().is_empty() || info.id.len() > 64 {
            return Ok(Err("the device record names no usable device id"));
        }
        let _held = self.hold()?;
        match self.open()? {
            Some(pairing) if pairing.id == id && pairing.expires_at >= now_ms() => {}
            _ => return Ok(Err("the pairing was used or expired during the handshake")),
        }
        let mut ledger = self.read()?;
        if ledger.devices.iter().any(|device| device.info.id == info.id) {
            return Ok(Err("a device with this id is already paired"));
        }
        std::fs::remove_file(&self.pairing).with_context(|| format!("remove {}", self.pairing.display()))?;
        let now = now_ms();
        ledger.devices.push(Device { info, key: hex(key), first_seen: now, last_seen: now });
        write_private(&self.ledger, &serde_json::to_vec_pretty(&ledger)?)?;
        Ok(Ok(()))
    }

    pub fn device(&self, id: &str) -> anyhow::Result<Option<Device>> {
        Ok(self.read()?.devices.into_iter().find(|device| device.info.id == id))
    }

    pub fn seen(&self, id: &str, name: Option<&str>, app: Option<&str>, channel: Option<&str>) -> anyhow::Result<()> {
        self.edit(|ledger| {
            let now = now_ms();
            for known in ledger.devices.iter_mut().filter(|known| known.info.id == id) {
                known.last_seen = now;
                for (field, value) in
                    [(&mut known.info.name, name), (&mut known.info.app, app), (&mut known.info.channel, channel)]
                {
                    if let Some(value) = value.filter(|value| !value.is_empty() && value.len() <= 128) {
                        *field = value.to_string();
                    }
                }
            }
            Ok(())
        })
    }

    pub fn list(&self) -> anyhow::Result<Vec<Device>> {
        Ok(self.read()?.devices)
    }

    pub fn revoke(&self, device: &str) -> anyhow::Result<Vec<Device>> {
        self.edit(|ledger| {
            let (gone, kept) =
                ledger.devices.drain(..).partition(|known| known.info.id == device || known.info.name == device);
            ledger.devices = kept;
            Ok(gone)
        })
    }

    pub fn revoke_all(&self) -> anyhow::Result<Vec<Device>> {
        self.edit(|ledger| Ok(std::mem::take(&mut ledger.devices)))
    }
}

pub fn write_private(path: &Path, contents: &[u8]) -> anyhow::Result<()> {
    let folder = path.parent().with_context(|| format!("{} has no folder", path.display()))?;
    std::fs::create_dir_all(folder).with_context(|| format!("create {}", folder.display()))?;
    let name = path.file_name().with_context(|| format!("{} has no file name", path.display()))?.to_string_lossy();
    let staging = folder.join(format!(".{name}.{}.tmp", std::process::id()));
    let written = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&staging)
        .and_then(|mut file| {
            file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
            file.write_all(contents)?;
            file.sync_all()
        })
        .and_then(|()| std::fs::rename(&staging, path));
    if let Err(error) = written {
        std::fs::remove_file(&staging).ok();
        return Err(error).with_context(|| format!("write {}", path.display()));
    }
    Ok(())
}
