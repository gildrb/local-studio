use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use serde_json::Value;

use super::model::{Device, DevicePlatform};
use super::process::{self, run_ok};

const QUICK: Duration = Duration::from_secs(20);
const BOOT: Duration = Duration::from_secs(120);
const STOP_GRACE: Duration = Duration::from_secs(5);
const AVD_PREFIX: &str = "avd:";

#[derive(Default)]
pub(crate) struct Devices {
    booted: Mutex<BTreeSet<String>>,
    emulators: Mutex<HashMap<String, Child>>,
}

fn android_tool(name: &str, subdir: &str) -> Option<PathBuf> {
    if let Some(path) = process::which(name) {
        return Some(path);
    }
    let mut roots: Vec<PathBuf> = ["ANDROID_HOME", "ANDROID_SDK_ROOT"]
        .iter()
        .filter_map(|key| std::env::var_os(key).filter(|value| !value.is_empty()).map(PathBuf::from))
        .collect();
    if let Some(home) = std::env::var_os("HOME") {
        roots.push(Path::new(&home).join("Library/Android/sdk"));
        roots.push(Path::new(&home).join("Android/Sdk"));
    }
    roots.into_iter().map(|root| root.join(subdir).join(name)).find(|path| path.is_file())
}

fn runtime_name(key: &str) -> String {
    let short = key.rsplit('.').next().unwrap_or(key);
    let mut parts = short.split('-');
    let platform = parts.next().unwrap_or_default();
    let version: Vec<&str> = parts.collect();
    if version.is_empty() {
        platform.to_string()
    } else {
        format!("{platform} {}", version.join("."))
    }
}

fn parse_simulators(json: &str) -> Vec<Device> {
    let Ok(value) = serde_json::from_str::<Value>(json) else { return Vec::new() };
    let Some(runtimes) = value.get("devices").and_then(Value::as_object) else { return Vec::new() };
    let mut devices = Vec::new();
    for (key, list) in runtimes {
        let runtime = runtime_name(key);
        if !runtime.starts_with("iOS") {
            continue;
        }
        for device in list.as_array().map_or(&[][..], Vec::as_slice) {
            if device.get("isAvailable").and_then(Value::as_bool) == Some(false) {
                continue;
            }
            let field = |name: &str| device.get(name).and_then(Value::as_str).unwrap_or_default().to_string();
            devices.push(Device {
                id: field("udid"),
                name: field("name"),
                platform: DevicePlatform::IosSimulator,
                state: field("state"),
                runtime: Some(runtime.clone()),
            });
        }
    }
    devices.sort_by(|left, right| right.runtime.cmp(&left.runtime).then_with(|| left.name.cmp(&right.name)));
    devices
}

fn parse_adb(output: &str) -> Vec<Device> {
    output
        .lines()
        .skip_while(|line| !line.starts_with("List of devices"))
        .skip(1)
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let id = fields.next()?.to_string();
            let raw_state = fields.next()?;
            let name = fields.find_map(|field| field.strip_prefix("model:")).map(|model| model.replace('_', " "));
            let state = match raw_state {
                "device" => "Booted".to_string(),
                "offline" => "Offline".to_string(),
                "unauthorized" => "Unauthorized".to_string(),
                other => other.to_string(),
            };
            let platform = if id.starts_with("emulator-") {
                DevicePlatform::AndroidEmulator
            } else {
                DevicePlatform::AndroidDevice
            };
            Some(Device {
                name: name.unwrap_or_else(|| id.clone()),
                id,
                platform,
                state,
                runtime: Some("Android".to_string()),
            })
        })
        .collect()
}

async fn stop_child(mut child: Child) -> Result<(), String> {
    tokio::task::spawn_blocking(move || process::stop_group(&mut child, STOP_GRACE))
        .await
        .map_err(|error| error.to_string())
}

impl Devices {
    pub(crate) async fn list(&self) -> (Vec<Device>, Vec<String>) {
        let root = Path::new("/");
        let mut devices = Vec::new();
        let mut missing = Vec::new();
        if process::which("xcrun").is_some() {
            match run_ok("xcrun", ["simctl", "list", "-j", "devices", "available"], root, QUICK).await {
                Ok(json) => devices.extend(parse_simulators(&json)),
                Err(error) => missing.push(format!("iOS simulators are unavailable: {error}")),
            }
        } else {
            missing.push("iOS simulators need Xcode on macOS.".to_string());
        }
        let mut running_avds = BTreeSet::new();
        if let Some(adb) = android_tool("adb", "platform-tools") {
            let adb = adb.to_string_lossy().into_owned();
            if let Ok(out) = run_ok(&adb, ["devices", "-l"], root, QUICK).await {
                for mut device in parse_adb(&out) {
                    if device.platform == DevicePlatform::AndroidEmulator && device.state == "Booted" {
                        let avd = run_ok(&adb, ["-s", device.id.as_str(), "emu", "avd", "name"], root, QUICK).await;
                        if let Some(avd) = avd.ok().and_then(|out| {
                            out.lines()
                                .map(str::trim)
                                .find(|line| !line.is_empty() && *line != "OK")
                                .map(str::to_string)
                        }) {
                            device.name = avd.replace('_', " ");
                            running_avds.insert(avd);
                        }
                    }
                    devices.push(device);
                }
            }
        } else {
            missing.push("Android devices need adb (Android SDK platform-tools).".to_string());
        }
        if let Some(emulator) = android_tool("emulator", "emulator") {
            if let Ok(out) = run_ok(&emulator.to_string_lossy(), ["-list-avds"], root, QUICK).await {
                for avd in out.lines().map(str::trim).filter(|line| !line.is_empty() && !line.starts_with("INFO")) {
                    if running_avds.contains(avd) {
                        continue;
                    }
                    devices.push(Device {
                        id: format!("{AVD_PREFIX}{avd}"),
                        name: avd.replace('_', " "),
                        platform: DevicePlatform::AndroidEmulator,
                        state: "Shutdown".to_string(),
                        runtime: Some("Android".to_string()),
                    });
                }
            }
        }
        (devices, missing)
    }

    async fn find(&self, device: &str) -> Result<Device, String> {
        let (devices, _) = self.list().await;
        devices.into_iter().find(|candidate| candidate.id == device).ok_or_else(|| format!("Unknown device {device}."))
    }

    pub(crate) async fn boot(&self, device: &str) -> Result<String, String> {
        let found = self.find(device).await?;
        if let Some(avd) = device.strip_prefix(AVD_PREFIX) {
            let emulator = android_tool("emulator", "emulator").ok_or("The Android emulator is not installed.")?;
            let mut command = Command::new(emulator);
            command.args(["-avd", avd]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
            process::own_group(&mut command);
            let child = command.spawn().map_err(|error| format!("could not start the emulator: {error}"))?;
            self.emulators.lock().unwrap_or_else(PoisonError::into_inner).insert(avd.to_string(), child);
            return Ok(format!("Starting {}", found.name));
        }
        match found.platform {
            DevicePlatform::IosSimulator if found.state == "Booted" => Ok(format!("{} is already booted.", found.name)),
            DevicePlatform::IosSimulator => {
                run_ok("xcrun", ["simctl", "boot", device], Path::new("/"), BOOT).await?;
                self.booted.lock().unwrap_or_else(PoisonError::into_inner).insert(device.to_string());
                Ok(format!("Booted {}", found.name))
            }
            DevicePlatform::AndroidEmulator | DevicePlatform::AndroidDevice => {
                Ok(format!("{} is already running.", found.name))
            }
        }
    }

    pub(crate) async fn shutdown(&self, device: &str) -> Result<String, String> {
        if let Some(avd) = device.strip_prefix(AVD_PREFIX) {
            let child = self.emulators.lock().unwrap_or_else(PoisonError::into_inner).remove(avd);
            stop_child(child.ok_or_else(|| format!("{avd} is not running."))?).await?;
            return Ok(format!("Stopped {}", avd.replace('_', " ")));
        }
        let found = self.find(device).await?;
        match found.platform {
            DevicePlatform::IosSimulator => {
                run_ok("xcrun", ["simctl", "shutdown", device], Path::new("/"), BOOT).await?;
                self.booted.lock().unwrap_or_else(PoisonError::into_inner).remove(device);
                Ok(format!("Shut down {}", found.name))
            }
            DevicePlatform::AndroidEmulator => {
                let avd = found.name.replace(' ', "_");
                let spawned = self.emulators.lock().unwrap_or_else(PoisonError::into_inner).remove(&avd);
                if let Some(child) = spawned {
                    stop_child(child).await?;
                } else {
                    let adb = android_tool("adb", "platform-tools").ok_or("adb is not installed.")?;
                    run_ok(&adb.to_string_lossy(), ["-s", device, "emu", "kill"], Path::new("/"), QUICK).await?;
                }
                Ok(format!("Stopped {}", found.name))
            }
            DevicePlatform::AndroidDevice => Err("Physical devices cannot be shut down from Local Studio.".to_string()),
        }
    }

    pub(crate) fn shutdown_all(&self) {
        let booted = std::mem::take(&mut *self.booted.lock().unwrap_or_else(PoisonError::into_inner));
        if let Some(xcrun) = process::which("xcrun") {
            for device in booted {
                let _ = Command::new(&xcrun)
                    .args(["simctl", "shutdown", &device])
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status();
            }
        }
        let emulators: Vec<Child> =
            self.emulators.lock().unwrap_or_else(PoisonError::into_inner).drain().map(|(_, child)| child).collect();
        for mut child in emulators {
            process::stop_group(&mut child, STOP_GRACE);
        }
    }
}
