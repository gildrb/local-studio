use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::model::{CommandKind, SlashCommand};

mod grants;
mod install;

pub use grants::{Consent, Grants, GRANTS};
pub use install::{install, tree_hash, Catalog, CatalogEntry, Installed, Source, MAX_FILE};

pub const MANIFEST: &str = "plugin.toml";
pub const MCP_PREFIX: &str = "plugin-";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Capability {
    McpServer,
    NativeHost,
    AskUser,
    SiteSecrets,
    Accessibility,
    SyntheticInput,
    ScreenCapture,
}

impl Capability {
    pub const ALL: [Capability; 7] = [
        Capability::McpServer,
        Capability::NativeHost,
        Capability::AskUser,
        Capability::SiteSecrets,
        Capability::Accessibility,
        Capability::SyntheticInput,
        Capability::ScreenCapture,
    ];

    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Capability::McpServer => "mcp-server",
            Capability::NativeHost => "native-host",
            Capability::AskUser => "ask-user",
            Capability::SiteSecrets => "site-secrets",
            Capability::Accessibility => "accessibility",
            Capability::SyntheticInput => "synthetic-input",
            Capability::ScreenCapture => "screen-capture",
        }
    }

    #[must_use]
    pub fn description(self) -> &'static str {
        match self {
            Capability::McpServer => "Run its own tool server for your sessions",
            Capability::NativeHost => "Register a helper that one browser extension can talk to",
            Capability::AskUser => "Ask you questions and ask before risky steps",
            Capability::SiteSecrets => "Fill your saved secrets into the sites they belong to",
            Capability::Accessibility => "Read and operate the windows and controls of other apps",
            Capability::SyntheticInput => "Move the pointer and press keys for you",
            Capability::ScreenCapture => "Take screenshots of app windows",
        }
    }

    #[must_use]
    pub fn parse(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|capability| capability.name() == name)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpServer {
    pub command: PathBuf,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plugin {
    pub id: String,
    pub version: String,
    pub description: String,
    pub dir: PathBuf,
    pub skills: Vec<PluginFile>,
    pub prompts: Vec<PluginFile>,
    pub commands: Vec<PluginCommand>,
    pub capabilities: Vec<Capability>,
    pub mcp: Option<McpServer>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginFile {
    pub name: String,
    pub description: String,
    pub path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginCommand {
    pub name: String,
    pub description: String,
    pub target: CommandTarget,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandTarget {
    Prompt(PathBuf),
    Skill(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginFailure {
    pub dir: PathBuf,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Scan {
    pub plugins: Vec<Plugin>,
    pub failures: Vec<PluginFailure>,
}

impl Plugin {
    #[must_use]
    pub fn source(&self) -> String {
        format!("plugin:{}", self.id)
    }

    #[must_use]
    pub fn skill(&self, name: &str) -> Option<&PluginFile> {
        self.skills.iter().find(|skill| skill.name == name)
    }

    #[must_use]
    pub fn asks(&self, capability: Capability) -> bool {
        self.capabilities.contains(&capability)
    }

    #[must_use]
    pub fn mcp_name(&self) -> String {
        format!("{MCP_PREFIX}{}", self.id)
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    id: String,
    version: String,
    description: String,
    skills: Option<String>,
    prompts: Option<String>,
    #[serde(default)]
    commands: Vec<ManifestCommand>,
    #[serde(default)]
    capabilities: Vec<String>,
    mcp: Option<ManifestMcp>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestMcp {
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestCommand {
    name: String,
    description: String,
    prompt: Option<String>,
    skill: Option<String>,
}

#[must_use]
pub fn plugins_dir(explicit_data_dir: Option<&str>) -> Option<PathBuf> {
    if let Some(explicit) = explicit_data_dir.filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(explicit).join("plugins"));
    }
    if let Some(value) = std::env::var_os("LOCAL_STUDIO_DATA_DIR").filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(value).join("plugins"));
    }
    crate::store::home_dir().map(|home| home.join(".local-studio").join("plugins"))
}

#[must_use]
pub fn scan(root: &Path) -> Scan {
    let mut scan = Scan::default();
    let Ok(entries) = std::fs::read_dir(root) else { return scan };
    let mut dirs: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .filter(|path| !path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with('.')))
        .collect();
    dirs.sort();
    let mut seen: HashSet<String> = HashSet::new();
    for dir in dirs {
        match load(&dir) {
            Ok(plugin) if !seen.insert(plugin.id.clone()) => {
                scan.failures.push(PluginFailure { dir, errors: vec![format!("duplicate plugin id: {}", plugin.id)] });
            }
            Ok(plugin) => scan.plugins.push(plugin),
            Err(errors) => scan.failures.push(PluginFailure { dir, errors }),
        }
    }
    scan
}

pub fn load(dir: &Path) -> Result<Plugin, Vec<String>> {
    let manifest_path = dir.join(MANIFEST);
    let text = std::fs::read_to_string(&manifest_path)
        .map_err(|error| vec![format!("cannot read {}: {error}", manifest_path.display())])?;
    let manifest: Manifest =
        toml::from_str(&text).map_err(|error| vec![format!("invalid {MANIFEST}: {}", error.message())])?;
    let mut errors: Vec<String> = Vec::new();
    if !valid_id(&manifest.id) {
        errors.push(format!("bad id: {:?} (use lowercase letters, digits and single hyphens)", manifest.id));
    }
    let folder = dir
        .canonicalize()
        .ok()
        .and_then(|path| path.file_name().and_then(|name| name.to_str()).map(str::to_string))
        .unwrap_or_default();
    if folder != manifest.id {
        errors.push(format!("id {:?} does not match the folder name {folder:?}", manifest.id));
    }
    if !valid_semver(&manifest.version) {
        errors.push(format!("bad version: {:?} (use semver, such as 1.0.0)", manifest.version));
    }
    if manifest.description.trim().is_empty() {
        errors.push("description is empty".to_string());
    }
    let capabilities = capabilities_in(&manifest.capabilities, &mut errors);
    let mcp = match (manifest.mcp, capabilities.contains(&Capability::McpServer)) {
        (Some(mcp), true) => mcp_in(dir, &manifest.id, mcp, &mut errors),
        (Some(_), false) => {
            errors.push("[mcp] needs the mcp-server capability".to_string());
            None
        }
        (None, true) => {
            errors.push("the mcp-server capability needs an [mcp] table".to_string());
            None
        }
        (None, false) => None,
    };
    let skills_dir = match &manifest.skills {
        Some(relative) => listed_dir(dir, relative, "skills", &mut errors),
        None => Some(dir.join("skills")).filter(|path| path.is_dir()),
    };
    let skills = skills_dir.map(|path| skills_in(&path, &mut errors)).unwrap_or_default();
    let prompts = manifest
        .prompts
        .as_deref()
        .and_then(|relative| listed_dir(dir, relative, "prompts", &mut errors))
        .map(|path| prompts_in(&path))
        .unwrap_or_default();
    let commands = commands_in(dir, manifest.commands, &skills, &mut errors);
    if !errors.is_empty() {
        return Err(errors);
    }
    Ok(Plugin {
        id: manifest.id,
        version: manifest.version,
        description: manifest.description,
        dir: dir.to_path_buf(),
        skills,
        prompts,
        commands,
        capabilities,
        mcp,
    })
}

fn capabilities_in(names: &[String], errors: &mut Vec<String>) -> Vec<Capability> {
    let mut capabilities: Vec<Capability> = Vec::new();
    for name in names {
        match Capability::parse(name) {
            Some(capability) if capabilities.contains(&capability) => {
                errors.push(format!("duplicate capability: {name}"));
            }
            Some(capability) => capabilities.push(capability),
            None => errors.push(format!("unknown capability: {name}")),
        }
    }
    capabilities
}

fn mcp_in(dir: &Path, id: &str, mcp: ManifestMcp, errors: &mut Vec<String>) -> Option<McpServer> {
    let command = match inside(dir, &mcp.command) {
        Ok(path) if path.is_file() => path,
        Ok(path) => {
            errors.push(format!("[mcp] command is missing: {}", path.display()));
            return None;
        }
        Err(error) => {
            errors.push(format!("[mcp] command: {error}"));
            return None;
        }
    };
    let prefix = env_prefix(id);
    let before = errors.len();
    for (name, host) in &mcp.env {
        if !valid_env_name(name) {
            errors.push(format!("[mcp] env: bad variable name: {name:?}"));
        }
        if !valid_env_name(host) || !host.starts_with(&prefix) {
            errors.push(format!("[mcp] env {name}: the host variable must start with {prefix}, not {host:?}"));
        }
    }
    (errors.len() == before).then_some(McpServer { command, args: mcp.args, env: mcp.env })
}

#[must_use]
pub fn env_prefix(id: &str) -> String {
    format!("LOCAL_STUDIO_PLUGIN_{}__", id.to_ascii_uppercase().replace('-', "_"))
}

fn valid_env_name(name: &str) -> bool {
    name.chars().next().is_some_and(|first| first.is_ascii_uppercase() || first == '_')
        && name.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

#[must_use]
pub fn mcp_servers(plugins: &[Plugin], grants: &Grants) -> Map<String, Value> {
    plugins
        .iter()
        .filter(|plugin| grants.consent(plugin) == Consent::Ready && plugin.asks(Capability::McpServer))
        .filter_map(|plugin| {
            let mcp = plugin.mcp.as_ref()?;
            let dir = absolute(&plugin.dir);
            let env: Map<String, Value> =
                mcp.env.iter().map(|(name, host)| (name.clone(), json!({ "env": host }))).collect();
            let mut entry = json!({
                "type": "stdio",
                "command": absolute(&mcp.command).to_string_lossy(),
                "args": mcp.args,
                "cwd": dir.to_string_lossy(),
            });
            if !env.is_empty() {
                entry["env"] = Value::Object(env);
            }
            Some((plugin.mcp_name(), entry))
        })
        .collect()
}

pub fn sync_mcp_servers(agent: &Path, plugins: &[Plugin], grants: &Grants) -> Result<bool, String> {
    let path = agent.join("settings.json");
    let mut settings = crate::workspace::providers::read_object(&path)?;
    let mut servers = match settings.remove("mcpServers") {
        None => Map::new(),
        Some(Value::Object(servers)) => servers,
        Some(_) => return Err(format!("{}: mcpServers is not a JSON object", path.display())),
    };
    let wanted = mcp_servers(plugins, grants);
    let current: Map<String, Value> =
        servers.iter().filter(|(name, _)| name.starts_with(MCP_PREFIX)).map(|(k, v)| (k.clone(), v.clone())).collect();
    if current == wanted {
        return Ok(false);
    }
    servers.retain(|name, _| !name.starts_with(MCP_PREFIX));
    servers.extend(wanted);
    settings.insert("mcpServers".to_string(), Value::Object(servers));
    crate::workspace::providers::write_private(&path, &Value::Object(settings))?;
    Ok(true)
}

#[must_use]
pub fn agent_dir() -> Option<PathBuf> {
    crate::daemon::agent_dir()
}

pub fn sync_agent(root: &Path, agent: &Path) -> Result<bool, String> {
    let grants = Grants::load(root)?;
    sync_mcp_servers(agent, &scan(root).plugins, &grants)
}

fn absolute(path: &Path) -> PathBuf {
    path.canonicalize().or_else(|_| std::path::absolute(path)).unwrap_or_else(|_| path.to_path_buf())
}

fn listed_dir(dir: &Path, relative: &str, what: &str, errors: &mut Vec<String>) -> Option<PathBuf> {
    match inside(dir, relative) {
        Ok(path) if path.is_dir() => Some(path),
        Ok(path) => {
            errors.push(format!("missing {what} dir: {}", path.display()));
            None
        }
        Err(error) => {
            errors.push(error);
            None
        }
    }
}

fn commands_in(
    dir: &Path,
    listed: Vec<ManifestCommand>,
    skills: &[PluginFile],
    errors: &mut Vec<String>,
) -> Vec<PluginCommand> {
    let mut names: HashSet<String> = HashSet::new();
    let mut commands: Vec<PluginCommand> = Vec::new();
    for command in listed {
        if !valid_command_name(&command.name) {
            errors.push(format!("bad command name: {:?}", command.name));
            continue;
        }
        if !names.insert(command.name.clone()) {
            errors.push(format!("duplicate command name: {}", command.name));
            continue;
        }
        let target = match (command.prompt, command.skill) {
            (Some(prompt), None) => match inside(dir, &prompt) {
                Ok(path) if path.is_file() => CommandTarget::Prompt(path),
                Ok(path) => {
                    errors.push(format!("command {}: missing prompt file: {}", command.name, path.display()));
                    continue;
                }
                Err(error) => {
                    errors.push(format!("command {}: {error}", command.name));
                    continue;
                }
            },
            (None, Some(skill)) if skills.iter().any(|entry| entry.name == skill) => CommandTarget::Skill(skill),
            (None, Some(skill)) => {
                errors.push(format!("command {}: missing skill: {skill}", command.name));
                continue;
            }
            _ => {
                errors.push(format!("command {}: set exactly one of prompt or skill", command.name));
                continue;
            }
        };
        commands.push(PluginCommand { name: command.name, description: command.description, target });
    }
    commands
}

#[must_use]
pub fn commands(plugins: &[Plugin]) -> Vec<SlashCommand> {
    plugins
        .iter()
        .flat_map(|plugin| {
            plugin.commands.iter().map(|command| SlashCommand {
                name: command.name.clone(),
                description: command.description.clone(),
                source: plugin.source(),
                kind: CommandKind::Plugin,
            })
        })
        .collect()
}

pub(crate) fn inside(dir: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if path.is_absolute()
        || path.components().any(|part| !matches!(part, std::path::Component::Normal(_) | std::path::Component::CurDir))
    {
        return Err(format!("path must stay inside the plugin: {relative}"));
    }
    Ok(dir.join(path))
}

fn skills_in(dir: &Path, errors: &mut Vec<String>) -> Vec<PluginFile> {
    let mut skills: Vec<PluginFile> = sorted_entries(dir)
        .into_iter()
        .filter(|path| path.is_dir())
        .filter_map(|path| {
            let file = path.join("SKILL.md");
            if !file.is_file() {
                errors.push(format!("missing skill file: {}", file.display()));
                return None;
            }
            let content = std::fs::read_to_string(&file).unwrap_or_default();
            let folder = path.file_name().and_then(|name| name.to_str()).unwrap_or_default().to_string();
            let name = frontmatter(&content, "name").unwrap_or(folder);
            let description = frontmatter(&content, "description").unwrap_or_default();
            Some(PluginFile { name, description, path: file })
        })
        .collect();
    skills.dedup_by(|a, b| a.name == b.name);
    skills
}

fn prompts_in(dir: &Path) -> Vec<PluginFile> {
    sorted_entries(dir)
        .into_iter()
        .filter(|path| path.is_file() && path.extension().is_some_and(|ext| ext == "md"))
        .filter_map(|path| {
            let name = path.file_stem()?.to_str()?.to_string();
            let content = std::fs::read_to_string(&path).unwrap_or_default();
            let description = frontmatter(&content, "description").unwrap_or_else(|| {
                content
                    .lines()
                    .map(str::trim)
                    .find(|line| !line.is_empty() && *line != "---")
                    .unwrap_or_default()
                    .to_string()
            });
            Some(PluginFile { name, description, path })
        })
        .collect()
}

fn sorted_entries(dir: &Path) -> Vec<PathBuf> {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|entries| entries.filter_map(Result::ok).map(|entry| entry.path()).collect())
        .unwrap_or_default();
    entries.sort();
    entries
}

fn frontmatter(content: &str, key: &str) -> Option<String> {
    let normalized = content.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let rest = normalized.strip_prefix("---\n")?;
    let end = rest.find("\n---")?;
    rest[..end].lines().find_map(|line| {
        let value = line.strip_prefix(key)?.strip_prefix(':')?.trim();
        let value = value.trim_matches(|c| c == '"' || c == '\'');
        (!value.is_empty()).then(|| value.to_string())
    })
}

pub(crate) fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && !id.starts_with('-')
        && !id.ends_with('-')
        && !id.contains("--")
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn valid_command_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with("skill:")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.'))
}

fn valid_semver(version: &str) -> bool {
    let (core, build) = version.split_once('+').map_or((version, None), |(core, build)| (core, Some(build)));
    let (core, pre) = core.split_once('-').map_or((core, None), |(core, pre)| (core, Some(pre)));
    let numbers: Vec<&str> = core.split('.').collect();
    let number = |part: &&str| {
        !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()) && (*part == "0" || !part.starts_with('0'))
    };
    let ident = |text: &str| {
        text.split('.').all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
    };
    numbers.len() == 3 && numbers.iter().all(number) && pre.is_none_or(ident) && build.is_none_or(ident)
}
