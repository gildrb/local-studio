use std::fmt::Write as _;
use std::os::unix::fs::PermissionsExt;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use sha2::{Digest, Sha256};

use super::{inside, load, valid_id, Consent, Grants, Plugin, MANIFEST};

pub const MAX_FILE: u64 = 10 * 1024 * 1024;
const BUNDLED_CATALOG: &str = include_str!("../../../examples/plugins/catalog.toml");

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Source {
    Dir(PathBuf),
    Git { url: String, rev: String },
    Catalog(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogEntry {
    pub id: String,
    pub git: String,
    pub rev: String,
    #[serde(default)]
    pub subdir: Option<String>,
    pub tree: String,
    #[serde(default)]
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Catalog {
    #[serde(default, rename = "plugin")]
    pub plugins: Vec<CatalogEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Installed {
    pub plugin: Plugin,
    pub replaced: Option<String>,
    pub consent: Consent,
    pub files: usize,
    pub tree: String,
}

impl Source {
    pub fn parse(arg: &str) -> Result<Self, String> {
        if valid_id(arg) {
            return Ok(Source::Catalog(arg.to_string()));
        }
        let path = Path::new(arg);
        if path.is_dir() {
            return Ok(Source::Dir(path.to_path_buf()));
        }
        match arg.rsplit_once('@') {
            Some((url, rev)) if !url.is_empty() && full_sha(rev) => {
                Ok(Source::Git { url: url.to_string(), rev: rev.to_string() })
            }
            _ if arg.contains("://")
                || arg.contains('@')
                || path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("git")) =>
            {
                Err(format!(
                    "a git source must be pinned to a full commit SHA (40 hex characters) as <url>@<sha>, not {arg}"
                ))
            }
            _ => Err(format!("not a plugin folder, a catalog id or a git source <url>@<sha>: {arg}")),
        }
    }
}

impl Catalog {
    pub fn parse(text: &str) -> Result<Self, String> {
        let catalog: Catalog = toml::from_str(text).map_err(|error| format!("invalid catalog: {}", error.message()))?;
        for entry in &catalog.plugins {
            if !valid_id(&entry.id) {
                return Err(format!("catalog: bad id {:?}", entry.id));
            }
            if !full_sha(&entry.rev) {
                return Err(format!("catalog {}: rev must be a full commit SHA", entry.id));
            }
            if !entry.tree.strip_prefix("sha256:").is_some_and(|hex| hex.len() == 64 && is_hex(hex)) {
                return Err(format!("catalog {}: tree must be sha256:<64 hex>", entry.id));
            }
        }
        Ok(catalog)
    }

    pub fn bundled() -> Result<Self, String> {
        Self::parse(BUNDLED_CATALOG)
    }

    #[must_use]
    pub fn entry(&self, id: &str) -> Option<&CatalogEntry> {
        self.plugins.iter().find(|entry| entry.id == id)
    }
}

fn is_hex(text: &str) -> bool {
    text.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

fn full_sha(rev: &str) -> bool {
    rev.len() == 40 && is_hex(rev)
}

struct Scratch(PathBuf);

impl Scratch {
    fn new(root: &Path, what: &str) -> Result<Self, Vec<String>> {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_nanos());
        let dir = root.join(format!(".{what}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).map_err(|error| vec![format!("cannot create {}: {error}", dir.display())])?;
        Ok(Self(dir))
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub fn install(root: &Path, source: &Source, catalog: &Catalog) -> Result<Installed, Vec<String>> {
    std::fs::create_dir_all(root).map_err(|error| vec![format!("cannot create {}: {error}", root.display())])?;
    match source {
        Source::Dir(dir) => place(root, dir, &[], None),
        Source::Git { url, rev } => {
            let fetched = Scratch::new(root, "fetch")?;
            fetch(url, rev, &fetched.0)?;
            place(root, &fetched.0, &[], None)
        }
        Source::Catalog(id) => {
            let entry = catalog
                .entry(id)
                .ok_or_else(|| vec![format!("{id} is not in the plugin catalog (use ./{id} for a folder)")])?;
            let fetched = Scratch::new(root, "fetch")?;
            fetch(&entry.git, &entry.rev, &fetched.0)?;
            let dir = match &entry.subdir {
                Some(subdir) => inside(&fetched.0, subdir).map_err(|error| vec![error])?,
                None => fetched.0.clone(),
            };
            place(root, &dir, &entry.exclude, Some(&entry.tree))
        }
    }
}

fn place(root: &Path, source: &Path, exclude: &[String], expected: Option<&str>) -> Result<Installed, Vec<String>> {
    let entries = walk(source, exclude).map_err(|error| vec![error])?;
    let tree = hash_entries(source, &entries).map_err(|error| vec![error])?;
    if let Some(expected) = expected.filter(|expected| *expected != tree) {
        return Err(vec![format!("tree hash mismatch: the catalog pins {expected}, the fetched plugin is {tree}")]);
    }
    let refusals = refusals(source, &entries);
    if !refusals.is_empty() {
        return Err(refusals);
    }
    let id = manifest_id(source)?;
    let staging = Scratch::new(root, "install")?;
    let staged = staging.0.join(&id);
    copy(source, &staged, &entries).map_err(|error| vec![error])?;
    load(&staged)?;
    let target = root.join(&id);
    let replaced = load(&target).ok().map(|old| old.version);
    let old = staging.0.join(".old");
    let moved = target.exists();
    if moved {
        std::fs::rename(&target, &old)
            .map_err(|error| vec![format!("cannot move the installed {id} aside: {error}")])?;
    }
    if let Err(error) = std::fs::rename(&staged, &target) {
        if moved {
            let _ = std::fs::rename(&old, &target);
        }
        return Err(vec![format!("cannot install {}: {error}", target.display())]);
    }
    let plugin = load(&target)?;
    let grants = Grants::load(root).map_err(|error| vec![error])?;
    let consent = grants.consent(&plugin);
    Ok(Installed {
        plugin,
        replaced,
        consent,
        files: entries.iter().filter(|entry| !matches!(entry.kind, Kind::Dir)).count(),
        tree,
    })
}

fn manifest_id(source: &Path) -> Result<String, Vec<String>> {
    #[derive(Deserialize)]
    struct Id {
        id: String,
    }
    let path = source.join(MANIFEST);
    let text =
        std::fs::read_to_string(&path).map_err(|error| vec![format!("cannot read {}: {error}", path.display())])?;
    let id: Id = toml::from_str(&text).map_err(|error| vec![format!("invalid {MANIFEST}: {}", error.message())])?;
    if valid_id(&id.id) {
        Ok(id.id)
    } else {
        Err(vec![format!("bad id: {:?} (use lowercase letters, digits and hyphens)", id.id)])
    }
}

fn fetch(url: &str, rev: &str, into: &Path) -> Result<(), Vec<String>> {
    let git = |args: &[&str]| -> Result<String, String> {
        let output = Command::new("git")
            .arg("-C")
            .arg(into)
            .args(["-c", "advice.detachedHead=false", "-c", "core.symlinks=true"])
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(|error| format!("cannot run git: {error}"))?;
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            Err(format!("git {}: {}", args.join(" "), String::from_utf8_lossy(&output.stderr).trim()))
        }
    };
    git(&["init", "-q"]).map_err(|error| vec![error])?;
    if git(&["fetch", "-q", "--depth", "1", "--", url, rev]).is_err() {
        git(&["fetch", "-q", "--", url, "+refs/heads/*:refs/remotes/source/*", "+refs/tags/*:refs/tags/*"])
            .map_err(|error| vec![error])?;
    }
    git(&["checkout", "-q", "--detach", rev]).map_err(|error| vec![error])?;
    let head = git(&["rev-parse", "HEAD"]).map_err(|error| vec![error])?;
    if head != rev {
        return Err(vec![format!("git checked out {head}, not the pinned {rev}")]);
    }
    std::fs::remove_dir_all(into.join(".git")).map_err(|error| vec![format!("cannot drop .git: {error}")])
}

#[derive(Debug)]
enum Kind {
    File { size: u64, executable: bool },
    Link(PathBuf),
    Dir,
    Other,
}

#[derive(Debug)]
struct Entry {
    path: String,
    kind: Kind,
}

fn walk(root: &Path, exclude: &[String]) -> Result<Vec<Entry>, String> {
    let excluded: Vec<PathBuf> = exclude
        .iter()
        .map(|relative| inside(Path::new(""), relative).map(|path| path.components().collect()))
        .collect::<Result<_, _>>()?;
    let mut entries: Vec<Entry> = Vec::new();
    let mut pending: Vec<PathBuf> = vec![PathBuf::new()];
    while let Some(relative) = pending.pop() {
        let dir = root.join(&relative);
        let listing = std::fs::read_dir(&dir).map_err(|error| format!("cannot read {}: {error}", dir.display()))?;
        for item in listing {
            let item = item.map_err(|error| error.to_string())?;
            let name = item.file_name();
            let path = relative.join(&name);
            if (relative.as_os_str().is_empty() && name == ".git") || excluded.contains(&path) {
                continue;
            }
            let meta = std::fs::symlink_metadata(item.path()).map_err(|error| error.to_string())?;
            let text = path.to_str().ok_or_else(|| format!("not a UTF-8 path: {}", path.display()))?.to_string();
            let kind = if meta.file_type().is_symlink() {
                Kind::Link(std::fs::read_link(item.path()).map_err(|error| error.to_string())?)
            } else if meta.is_dir() {
                pending.push(path);
                Kind::Dir
            } else if meta.is_file() {
                Kind::File { size: meta.len(), executable: meta.permissions().mode() & 0o111 != 0 }
            } else {
                Kind::Other
            };
            entries.push(Entry { path: text, kind });
        }
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}

fn stays_inside(link: &str, target: &Path) -> bool {
    if target.is_absolute() {
        return false;
    }
    let mut depth: usize = Path::new(link).components().count().saturating_sub(1);
    for part in target.components() {
        match part {
            Component::Normal(_) => depth += 1,
            Component::CurDir => {}
            Component::ParentDir if depth > 0 => depth -= 1,
            _ => return false,
        }
    }
    true
}

fn resolves_inside(root: &Path, link: &str) -> bool {
    let Ok(base) = std::fs::canonicalize(root) else {
        return false;
    };
    std::fs::canonicalize(root.join(link)).is_ok_and(|real| real.starts_with(&base))
}

fn refusals(root: &Path, entries: &[Entry]) -> Vec<String> {
    let mut refusals: Vec<String> = Vec::new();
    for entry in entries {
        match &entry.kind {
            Kind::Link(target) if !stays_inside(&entry.path, target) || !resolves_inside(root, &entry.path) => {
                refusals.push(format!(
                    "symlink points outside the plugin or nowhere: {} -> {}",
                    entry.path,
                    target.display()
                ));
            }
            Kind::File { size, .. } if *size > MAX_FILE => {
                refusals.push(format!("file over 10 MB: {} ({size} bytes)", entry.path));
            }
            Kind::File { executable: true, .. } if !entry.path.starts_with("bin/") => {
                refusals.push(format!("executable outside bin/: {}", entry.path));
            }
            Kind::Other => refusals.push(format!("not a regular file, folder or symlink: {}", entry.path)),
            _ => {}
        }
    }
    refusals
}

fn hash_entries(root: &Path, entries: &[Entry]) -> Result<String, String> {
    let mut listing = String::new();
    for entry in entries {
        match &entry.kind {
            Kind::File { executable, .. } => {
                let path = root.join(&entry.path);
                let bytes = std::fs::read(&path).map_err(|error| format!("cannot read {}: {error}", path.display()))?;
                let mode = if *executable { "x" } else { "-" };
                let _ = writeln!(listing, "F {mode} {} {}", hex(&Sha256::digest(&bytes)), entry.path);
            }
            Kind::Link(target) => {
                let digest = Sha256::digest(target.as_os_str().as_encoded_bytes());
                let _ = writeln!(listing, "L - {} {}", hex(&digest), entry.path);
            }
            Kind::Dir | Kind::Other => {}
        }
    }
    Ok(format!("sha256:{}", hex(&Sha256::digest(listing.as_bytes()))))
}

pub fn tree_hash(root: &Path, exclude: &[String]) -> Result<String, String> {
    hash_entries(root, &walk(root, exclude)?)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut text, byte| {
        let _ = write!(text, "{byte:02x}");
        text
    })
}

fn copy(source: &Path, target: &Path, entries: &[Entry]) -> Result<(), String> {
    std::fs::create_dir_all(target).map_err(|error| format!("cannot create {}: {error}", target.display()))?;
    for entry in entries {
        let from = source.join(&entry.path);
        let to = target.join(&entry.path);
        let result = match &entry.kind {
            Kind::Dir => std::fs::create_dir_all(&to),
            Kind::File { .. } => std::fs::copy(&from, &to).map(|_| ()),
            Kind::Link(link) => std::os::unix::fs::symlink(link, &to),
            Kind::Other => Ok(()),
        };
        result.map_err(|error| format!("cannot copy {}: {error}", entry.path))?;
    }
    Ok(())
}
