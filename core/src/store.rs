use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::Context;
use serde::{Deserialize, Serialize};

use crate::model::{AccessMode, ModelKey};

const VERSION: u32 = 1;
const FILE: &str = "state.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredProject {
    pub(crate) path: String,
    pub(crate) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) icon: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct ThreadFlags {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) project: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "pinnedAt")]
    pub(crate) pin_order: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) settled_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) unsettled_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) snoozed_until: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) woke_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) done_at: Option<i64>,
    pub(crate) archived: bool,
    pub(crate) unread: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) access: Option<AccessMode>,
    pub(crate) additions: u32,
    pub(crate) deletions: u32,
    pub(crate) auto_settle_disabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) fan_out: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StateFile {
    version: u32,
    #[serde(default)]
    projects: Vec<StoredProject>,
    #[serde(default)]
    threads: BTreeMap<String, ThreadFlags>,
    #[serde(default)]
    favorites: Vec<ModelKey>,
    #[serde(default)]
    hidden: Vec<ModelKey>,
}

#[derive(Debug)]
pub(crate) struct Store {
    path: PathBuf,
    pub(crate) projects: Vec<StoredProject>,
    pub(crate) threads: BTreeMap<String, ThreadFlags>,
    pub(crate) favorites: Vec<ModelKey>,
    pub(crate) hidden: Vec<ModelKey>,
}

impl Store {
    pub(crate) fn open(data_dir: &Path) -> anyhow::Result<Self> {
        let path = data_dir.join(FILE);
        let file = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice::<StateFile>(&bytes)
                .with_context(|| format!("read the Local Studio state {}", path.display()))?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => StateFile {
                version: VERSION,
                projects: Vec::new(),
                threads: BTreeMap::new(),
                favorites: Vec::new(),
                hidden: Vec::new(),
            },
            Err(error) => return Err(error).with_context(|| format!("read {}", path.display())),
        };
        if file.version > VERSION {
            anyhow::bail!(
                "{} was written by a newer Local Studio (state version {}, this build reads {VERSION})",
                path.display(),
                file.version
            );
        }
        Ok(Self {
            path,
            projects: file.projects,
            threads: file.threads,
            favorites: file.favorites,
            hidden: file.hidden,
        })
    }

    pub(crate) fn project_id(&self, project: &str) -> Option<String> {
        if let Some(known) = self.projects.iter().find(|known| known.path == project) {
            return Some(known.path.clone());
        }
        let canonical = std::fs::canonicalize(project).ok()?;
        let canonical = canonical.to_string_lossy();
        self.projects.iter().find(|known| known.path == canonical).map(|known| known.path.clone())
    }

    pub(crate) fn flags(&self, thread: &str) -> ThreadFlags {
        self.threads.get(thread).cloned().unwrap_or_default()
    }

    pub(crate) fn update(&mut self, thread: &str, change: impl FnOnce(&mut ThreadFlags)) {
        let flags = self.threads.entry(thread.to_string()).or_default();
        change(flags);
        if *flags == ThreadFlags::default() {
            self.threads.remove(thread);
        }
    }

    pub(crate) fn save(&self) -> anyhow::Result<()> {
        let file = StateFile {
            version: VERSION,
            projects: self.projects.clone(),
            threads: self.threads.clone(),
            favorites: self.favorites.clone(),
            hidden: self.hidden.clone(),
        };
        let bytes = serde_json::to_vec_pretty(&file)?;
        let directory = self.path.parent().context("the state file has no directory")?;
        std::fs::create_dir_all(directory).with_context(|| format!("create {}", directory.display()))?;
        let temporary = directory.join(format!(".{FILE}.{}.tmp", std::process::id()));
        let mut handle = std::fs::File::create(&temporary).with_context(|| format!("write {}", temporary.display()))?;
        handle.write_all(&bytes)?;
        handle.sync_all()?;
        drop(handle);
        std::fs::rename(&temporary, &self.path).with_context(|| format!("replace {}", self.path.display()))
    }
}

pub(crate) fn data_dir(explicit: Option<&str>) -> Result<PathBuf, String> {
    if let Some(explicit) = explicit.filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(explicit));
    }
    if let Some(value) = std::env::var_os("LOCAL_STUDIO_DATA_DIR").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(value));
    }
    let home = home_dir().ok_or_else(|| "HOME is not set".to_string())?;
    if cfg!(target_os = "macos") {
        return Ok(home.join("Library").join("Application Support").join("Local Studio"));
    }
    let base = std::env::var_os("XDG_DATA_HOME")
        .filter(|value| !value.is_empty())
        .map_or_else(|| home.join(".local").join("share"), PathBuf::from);
    Ok(base.join("local-studio"))
}

pub(crate) fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").filter(|value| !value.is_empty()).map(PathBuf::from)
}
