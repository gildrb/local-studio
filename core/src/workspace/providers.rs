use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, DirBuilder, OpenOptions};
use std::io::{ErrorKind, Write as _};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::sync::PoisonError;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::{StatusCode, Url};
use serde_json::{json, Map, Value};

use super::model::{
    CustomProvider, EndpointPreset, LocalController, LocalEngine, LocalEngineState, ProviderApi, ProviderCredential,
    ProviderKey, ProviderKind, ProviderModel, ProviderStatus,
};
use super::{ModelsReloader, Workspace};
use crate::model::{ModelOption, Update};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(10);
const LOCK_STALE: Duration = Duration::from_secs(10);
const LOCK_ATTEMPTS: u32 = 50;
const LOCK_DELAY: Duration = Duration::from_millis(20);
pub(super) const NO_KEY: &str = "none";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const ENDPOINT_HEADER: &str = "x-local-studio-endpoint";
const EXCERPT: usize = 200;

struct BuiltIn {
    id: &'static str,
    name: &'static str,
    env: &'static str,
}

const BUILT_INS: [BuiltIn; 16] = [
    BuiltIn { id: "openai", name: "OpenAI", env: "OPENAI_API_KEY" },
    BuiltIn { id: "anthropic", name: "Anthropic", env: "ANTHROPIC_API_KEY" },
    BuiltIn { id: "google", name: "Google Gemini", env: "GEMINI_API_KEY" },
    BuiltIn { id: "openrouter", name: "OpenRouter", env: "OPENROUTER_API_KEY" },
    BuiltIn { id: "groq", name: "Groq", env: "GROQ_API_KEY" },
    BuiltIn { id: "mistral", name: "Mistral", env: "MISTRAL_API_KEY" },
    BuiltIn { id: "xai", name: "xAI", env: "XAI_API_KEY" },
    BuiltIn { id: "deepseek", name: "DeepSeek", env: "DEEPSEEK_API_KEY" },
    BuiltIn { id: "together", name: "Together AI", env: "TOGETHER_API_KEY" },
    BuiltIn { id: "fireworks", name: "Fireworks", env: "FIREWORKS_API_KEY" },
    BuiltIn { id: "cerebras", name: "Cerebras", env: "CEREBRAS_API_KEY" },
    BuiltIn { id: "huggingface", name: "Hugging Face", env: "HF_TOKEN" },
    BuiltIn { id: "moonshotai", name: "Moonshot AI", env: "MOONSHOT_API_KEY" },
    BuiltIn { id: "zai", name: "Z.ai", env: "ZAI_API_KEY" },
    BuiltIn { id: "minimax", name: "MiniMax", env: "MINIMAX_API_KEY" },
    BuiltIn { id: "vercel-ai-gateway", name: "Vercel AI Gateway", env: "AI_GATEWAY_API_KEY" },
];

#[cfg_attr(feature = "ffi", uniffi::export)]
#[must_use]
pub fn endpoint_presets() -> Vec<EndpointPreset> {
    [
        ("Ollama", "http://127.0.0.1:11434/v1"),
        ("LM Studio", "http://127.0.0.1:1234/v1"),
        ("llama.cpp", "http://127.0.0.1:8080/v1"),
        ("vLLM", "http://127.0.0.1:8000/v1"),
    ]
    .into_iter()
    .map(|(name, base_url)| EndpointPreset {
        name: name.to_string(),
        base_url: base_url.to_string(),
        api: ProviderApi::OpenAiCompatible,
        needs_key: false,
    })
    .collect()
}

#[derive(Default)]
pub(super) struct ProviderState {
    catalog: Option<Vec<ModelOption>>,
    errors: Vec<String>,
    fleet: Vec<LocalController>,
}

#[derive(Default)]
pub(super) struct Files {
    pub(super) providers: Map<String, Value>,
    pub(super) auth: Map<String, Value>,
    errors: Vec<String>,
}

fn display_name(id: &str) -> String {
    if let Some(built_in) = BUILT_INS.iter().find(|built_in| built_in.id == id) {
        return built_in.name.to_string();
    }
    let known = match id {
        "openai-codex" => Some("OpenAI Codex"),
        "azure-openai-responses" => Some("Azure OpenAI"),
        "google-gemini-cli" => Some("Gemini CLI"),
        "google-antigravity" => Some("Antigravity"),
        "google-vertex" => Some("Vertex AI"),
        "github-copilot" => Some("GitHub Copilot"),
        "amazon-bedrock" => Some("Amazon Bedrock"),
        "ollama" => Some("Ollama"),
        "lmstudio" => Some("LM Studio"),
        "local" | "local-studio" => Some("Local"),
        _ => None,
    };
    if let Some(name) = known {
        return name.to_string();
    }
    id.split(['-', '_'])
        .filter(|word| !word.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            chars.next().map(|first| first.to_uppercase().collect::<String>() + chars.as_str()).unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn api_name(api: ProviderApi) -> &'static str {
    match api {
        ProviderApi::OpenAiCompatible => "openai-completions",
        ProviderApi::OpenAiResponses => "openai-responses",
        ProviderApi::Anthropic => "anthropic-messages",
    }
}

pub(super) fn api_of(name: &str) -> Option<ProviderApi> {
    match name {
        "openai-completions" => Some(ProviderApi::OpenAiCompatible),
        "openai-responses" => Some(ProviderApi::OpenAiResponses),
        "anthropic-messages" => Some(ProviderApi::Anthropic),
        _ => None,
    }
}

pub(super) fn text<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn is_built_in(id: &str) -> bool {
    BUILT_INS.iter().any(|built_in| built_in.id == id)
}

pub(super) fn is_custom(id: &str, entry: &Value) -> bool {
    !is_built_in(id)
        && text(entry, "baseUrl").is_some()
        && entry.get("models").and_then(Value::as_array).is_some_and(|models| !models.is_empty())
}

fn stored(auth: &Map<String, Value>, id: &str) -> Option<ProviderCredential> {
    match auth.get(id).and_then(|entry| text(entry, "type"))? {
        "api_key" => Some(ProviderCredential::StoredKey),
        "oauth" => Some(ProviderCredential::SignedIn),
        _ => None,
    }
}

pub(super) fn resolve_reference(key: &str) -> Option<String> {
    if key.is_empty() || key.starts_with('!') {
        return None;
    }
    match std::env::var(key) {
        Ok(value) => Some(value).filter(|value| !value.is_empty()),
        Err(_) => Some(key.to_string()),
    }
}

pub(super) fn stored_key(auth: &Map<String, Value>, id: &str) -> Option<String> {
    let entry = auth.get(id).filter(|entry| text(entry, "type") == Some("api_key"))?;
    text(entry, "key").and_then(resolve_reference)
}

fn models_of(entry: &Value) -> Vec<ProviderModel> {
    entry
        .get("models")
        .and_then(Value::as_array)
        .map(|models| {
            models
                .iter()
                .filter_map(|model| {
                    let id = text(model, "id")?.to_string();
                    Some(ProviderModel {
                        name: text(model, "name").unwrap_or(&id).to_string(),
                        context_window: model.get("contextWindow").and_then(Value::as_u64).unwrap_or(0),
                        id,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn statuses(state: &ProviderState, files: &Files) -> Vec<ProviderStatus> {
    let mut counts: BTreeMap<&str, (u32, bool)> = BTreeMap::new();
    for model in state.catalog.as_deref().unwrap_or_default() {
        let entry = counts.entry(model.provider.as_str()).or_insert((0, false));
        entry.0 = entry.0.saturating_add(1);
        entry.1 |= model.configured;
    }
    let mut statuses: Vec<ProviderStatus> = BUILT_INS
        .iter()
        .map(|built_in| {
            let (model_count, configured) = counts.get(built_in.id).copied().unwrap_or((0, false));
            let credential = stored(&files.auth, built_in.id).unwrap_or(if configured {
                ProviderCredential::Environment
            } else {
                ProviderCredential::Missing
            });
            ProviderStatus {
                id: built_in.id.to_string(),
                name: built_in.name.to_string(),
                kind: ProviderKind::BuiltIn,
                configured: configured || credential != ProviderCredential::Missing,
                credential,
                model_count,
                env_var: Some(built_in.env.to_string()),
                base_url: None,
                api: None,
                models: Vec::new(),
            }
        })
        .collect();
    let mut customs: Vec<ProviderStatus> = files
        .providers
        .iter()
        .filter(|(id, entry)| is_custom(id, entry))
        .map(|(id, entry)| {
            let (model_count, configured) = counts.get(id.as_str()).copied().unwrap_or((0, false));
            let credential = stored(&files.auth, id).unwrap_or(if text(entry, "apiKey") == Some(NO_KEY) {
                ProviderCredential::NotRequired
            } else {
                ProviderCredential::ModelsJson
            });
            ProviderStatus {
                id: id.clone(),
                name: text(entry, "name").filter(|name| !name.is_empty()).unwrap_or(id).to_string(),
                kind: ProviderKind::Custom,
                configured,
                credential,
                model_count,
                env_var: None,
                base_url: text(entry, "baseUrl").map(str::to_string),
                api: text(entry, "api").and_then(api_of),
                models: models_of(entry),
            }
        })
        .collect();
    customs.sort_by_key(|custom| custom.name.to_lowercase());
    let mut others: Vec<ProviderStatus> = counts
        .iter()
        .filter(|(id, (_, configured))| {
            *configured && !is_built_in(id) && !customs.iter().any(|custom| custom.id == **id)
        })
        .map(|(id, (model_count, _))| ProviderStatus {
            id: (*id).to_string(),
            name: display_name(id),
            kind: ProviderKind::Other,
            configured: true,
            credential: stored(&files.auth, id).unwrap_or(ProviderCredential::Environment),
            model_count: *model_count,
            env_var: None,
            base_url: None,
            api: None,
            models: Vec::new(),
        })
        .collect();
    others.sort_by(|left, right| left.name.cmp(&right.name));
    statuses.extend(customs);
    statuses.extend(others);
    statuses
}

fn slug(name: &str) -> String {
    let mut slug = String::new();
    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug = slug.trim_end_matches('-').to_string();
    if slug.is_empty() {
        "endpoint".to_string()
    } else {
        slug
    }
}

fn unique_id(name: &str, providers: &Map<String, Value>, taken: &BTreeSet<String>) -> String {
    let base = slug(name);
    let free = |id: &str| !providers.contains_key(id) && !taken.contains(id) && !is_built_in(id);
    let mut candidate = base.clone();
    let mut index = 1_u32;
    while !free(&candidate) {
        index = index.saturating_add(1);
        candidate = format!("{base}-{index}");
    }
    candidate
}

fn gateway(controller: &LocalController) -> String {
    format!("{}/v1", controller.url.trim_end_matches('/'))
}

fn engine_provider(controller: &LocalController, port: u16) -> String {
    format!("local-{}-{port}", slug(&controller.name))
}

fn engines(fleet: &[LocalController], providers: &Map<String, Value>) -> Vec<LocalEngine> {
    fleet
        .iter()
        .filter(|controller| controller.reachable && controller.has_controller)
        .flat_map(|controller| {
            controller
                .endpoints
                .iter()
                .filter(|endpoint| {
                    endpoint.state == LocalEngineState::Loaded
                        && !endpoint.controller_id.is_empty()
                        && !endpoint.models.is_empty()
                })
                .map(move |endpoint| {
                    let provider = engine_provider(controller, endpoint.port);
                    LocalEngine {
                        id: endpoint.id.clone(),
                        controller: controller.name.clone(),
                        port: endpoint.port,
                        base_url: gateway(controller),
                        models: endpoint.models.clone(),
                        added: providers.contains_key(&provider),
                        provider,
                    }
                })
        })
        .collect()
}

fn read_object(path: &Path) -> Result<Map<String, Value>, String> {
    let name = path.file_name().map_or_else(String::new, |name| name.to_string_lossy().into_owned());
    match fs::read(path) {
        Ok(bytes) if bytes.iter().all(u8::is_ascii_whitespace) => Ok(Map::new()),
        Ok(bytes) => match serde_json::from_slice::<Value>(&bytes) {
            Ok(Value::Object(object)) => Ok(object),
            Ok(_) => Err(format!("{name} is not a JSON object.")),
            Err(_) => Err(format!(
                "{name} is not plain JSON (comments or trailing commas?), so Local Studio will not rewrite it. Edit {} by hand.",
                path.display()
            )),
        },
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(Map::new()),
        Err(error) => Err(format!("Could not read {}: {error}", path.display())),
    }
}

pub(super) fn read_files(agent: Option<&Path>) -> Files {
    let Some(agent) = agent else { return Files::default() };
    let mut errors = Vec::new();
    let providers = match read_object(&agent.join("models.json")) {
        Ok(mut root) => match root.remove("providers") {
            Some(Value::Object(providers)) => providers,
            _ => Map::new(),
        },
        Err(error) => {
            errors.push(error);
            Map::new()
        }
    };
    let auth = read_object(&agent.join("auth.json")).unwrap_or_else(|error| {
        errors.push(error);
        Map::new()
    });
    Files { providers, auth, errors }
}

fn create_private_dir(dir: &Path) -> Result<(), String> {
    if dir.is_dir() {
        return Ok(());
    }
    DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)
        .map_err(|error| format!("Could not create {}: {error}", dir.display()))
}

fn replace_file(temporary: &Path, target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).mode(0o600).open(temporary)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    fs::rename(temporary, target)?;
    if let Some(parent) = target.parent() {
        fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
}

fn write_private(path: &Path, value: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    let target = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let parent = target.parent().map(Path::to_path_buf).unwrap_or_default();
    create_private_dir(&parent)?;
    let name = target.file_name().map_or_else(String::new, |name| name.to_string_lossy().into_owned());
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_nanos());
    let temporary = parent.join(format!(".{name}.{}.{nanos}.tmp", std::process::id()));
    replace_file(&temporary, &target, &bytes).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        format!("Could not save {}: {error}", target.display())
    })
}

struct AuthLock(PathBuf);

impl AuthLock {
    fn acquire(path: &Path) -> Result<Self, String> {
        let lock = path.with_file_name("auth.json.lock");
        if let Some(parent) = path.parent() {
            create_private_dir(parent)?;
        }
        for _ in 0..LOCK_ATTEMPTS {
            match fs::create_dir(&lock) {
                Ok(()) => return Ok(Self(lock)),
                Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                    let stale = match fs::symlink_metadata(&lock) {
                        Ok(metadata) if !metadata.is_dir() => fs::remove_file(&lock).is_ok(),
                        Ok(metadata) => {
                            metadata
                                .modified()
                                .ok()
                                .and_then(|at| at.elapsed().ok())
                                .is_some_and(|age| age > LOCK_STALE)
                                && fs::remove_dir(&lock).is_ok()
                        }
                        Err(_) => true,
                    };
                    if !stale {
                        std::thread::sleep(LOCK_DELAY);
                    }
                }
                Err(error) => return Err(format!("Could not lock {}: {error}", path.display())),
            }
        }
        Err(format!("{} is locked by another Eukhe process. Try again.", path.display()))
    }
}

impl Drop for AuthLock {
    fn drop(&mut self) {
        let _ = fs::remove_dir(&self.0);
    }
}

fn edit_models<T>(agent: &Path, edit: impl FnOnce(&mut Map<String, Value>) -> Result<T, String>) -> Result<T, String> {
    let path = agent.join("models.json");
    let mut root = read_object(&path)?;
    let Value::Object(providers) = root.entry("providers").or_insert_with(|| Value::Object(Map::new())) else {
        return Err("models.json has a \"providers\" value that is not an object.".to_string());
    };
    let result = edit(providers)?;
    write_private(&path, &Value::Object(root))?;
    Ok(result)
}

fn edit_auth(agent: &Path, edit: impl FnOnce(&mut Map<String, Value>) -> bool) -> Result<(), String> {
    let path = agent.join("auth.json");
    let _lock = AuthLock::acquire(&path)?;
    let mut auth = read_object(&path)?;
    if edit(&mut auth) {
        write_private(&path, &Value::Object(auth))?;
    }
    Ok(())
}

fn store_key(agent: &Path, id: &str, key: Option<&str>) -> Result<(), String> {
    edit_auth(agent, |auth| {
        if let Some(key) = key {
            auth.insert(id.to_string(), json!({ "type": "api_key", "key": key }));
            return true;
        }
        let remove = auth.get(id).is_some_and(|entry| text(entry, "type") == Some("api_key"));
        if remove {
            auth.remove(id);
        }
        remove
    })
}

fn provider_entry(
    existing: Option<&Value>,
    name: &str,
    base_url: &str,
    api: ProviderApi,
    models: &[ProviderModel],
) -> Value {
    let mut entry = existing.and_then(Value::as_object).cloned().unwrap_or_default();
    let mut previous: BTreeMap<String, Map<String, Value>> = entry
        .get("models")
        .and_then(Value::as_array)
        .map(|models| {
            models
                .iter()
                .filter_map(|model| Some((text(model, "id")?.to_string(), model.as_object()?.clone())))
                .collect()
        })
        .unwrap_or_default();
    entry.insert("name".to_string(), json!(name));
    entry.insert("baseUrl".to_string(), json!(base_url));
    entry.insert("api".to_string(), json!(api_name(api)));
    if entry.get("apiKey").and_then(Value::as_str).is_none_or(str::is_empty) {
        entry.insert("apiKey".to_string(), json!(NO_KEY));
    }
    let models = models
        .iter()
        .map(|model| {
            let mut object = previous.remove(&model.id).unwrap_or_default();
            object.insert("id".to_string(), json!(model.id));
            object.insert("name".to_string(), json!(if model.name.is_empty() { &model.id } else { &model.name }));
            if model.context_window > 0 {
                object.insert("contextWindow".to_string(), json!(model.context_window));
            }
            Value::Object(object)
        })
        .collect();
    entry.insert("models".to_string(), Value::Array(models));
    Value::Object(entry)
}

fn normalize_base(base_url: &str, api: ProviderApi) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    let url = Url::parse(trimmed).map_err(|_| format!("“{trimmed}” is not a URL."))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Enter an http:// or https:// base URL.".to_string());
    }
    Ok(match api {
        ProviderApi::Anthropic => trimmed.strip_suffix("/v1").unwrap_or(trimmed).to_string(),
        ProviderApi::OpenAiCompatible | ProviderApi::OpenAiResponses => trimmed.to_string(),
    })
}

pub(super) fn parse_models(value: &Value) -> Vec<ProviderModel> {
    let entries = value
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| value.get("models").and_then(Value::as_array))
        .or_else(|| value.as_array());
    let mut seen = BTreeSet::new();
    entries
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    let id = entry.as_str().or_else(|| text(entry, "id")).or_else(|| text(entry, "name"))?.trim();
                    if id.is_empty() || !seen.insert(id.to_string()) {
                        return None;
                    }
                    let name = ["display_name", "name"]
                        .iter()
                        .find_map(|key| text(entry, key))
                        .filter(|name| !name.trim().is_empty())
                        .unwrap_or(id);
                    let context_window = ["context_length", "max_context_length", "context_window", "max_model_len"]
                        .iter()
                        .find_map(|key| entry.get(key).and_then(Value::as_u64))
                        .unwrap_or(0);
                    Some(ProviderModel { id: id.to_string(), name: name.to_string(), context_window })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn excerpt(body: &str, key: Option<&str>) -> String {
    let mut body = body.split_whitespace().collect::<Vec<_>>().join(" ");
    if let Some(key) = key.filter(|key| !key.is_empty()) {
        body = body.replace(key, "•••");
    }
    if body.chars().count() > EXCERPT {
        body = body.chars().take(EXCERPT).collect::<String>() + "…";
    }
    body
}

async fn discover(base_url: &str, api: ProviderApi, key: Option<&str>) -> Result<(String, Vec<ProviderModel>), String> {
    let base = normalize_base(base_url, api)?;
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .map_err(|error| format!("Could not prepare the request: {error}"))?;
    let key = key.map(str::trim).filter(|key| !key.is_empty() && *key != NO_KEY);
    let mut candidates = vec![base.clone()];
    if api != ProviderApi::Anthropic && !base.ends_with("/v1") {
        candidates.push(format!("{base}/v1"));
    }
    let mut missing = String::new();
    for candidate in candidates {
        let url = match api {
            ProviderApi::Anthropic => format!("{candidate}/v1/models"),
            ProviderApi::OpenAiCompatible | ProviderApi::OpenAiResponses => format!("{candidate}/models"),
        };
        let mut request = client.get(&url).timeout(DISCOVERY_TIMEOUT);
        if let Some(key) = key {
            request = match api {
                ProviderApi::Anthropic => {
                    request.header("x-api-key", key).header("anthropic-version", ANTHROPIC_VERSION)
                }
                ProviderApi::OpenAiCompatible | ProviderApi::OpenAiResponses => request.bearer_auth(key),
            };
        }
        let response = request.send().await.map_err(|error| {
            if error.is_timeout() {
                format!("{url} did not answer within {} seconds.", DISCOVERY_TIMEOUT.as_secs())
            } else if error.is_connect() {
                format!("Could not connect to {url}.")
            } else {
                format!("Could not reach {url}.")
            }
        })?;
        let status = response.status();
        if status == StatusCode::NOT_FOUND {
            missing = format!("{url} answered 404 Not Found. Check the base URL.");
            continue;
        }
        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            return Err(if key.is_some() {
                format!("{url} rejected the API key (HTTP {}).", status.as_u16())
            } else {
                format!("{url} needs an API key (HTTP {}).", status.as_u16())
            });
        }
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format!("{url} answered HTTP {}: {}", status.as_u16(), excerpt(&body, key)));
        }
        let value: Value =
            response.json().await.map_err(|_| format!("{url} did not answer with a JSON list of models."))?;
        let models = parse_models(&value);
        if models.is_empty() {
            return Err(format!("{url} lists no models."));
        }
        return Ok((candidate, models));
    }
    Err(missing)
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tokio::task::spawn_blocking(work).await.map_err(|error| error.to_string())?
}

fn chosen_key(key: &ProviderKey) -> Option<String> {
    match key {
        ProviderKey::Set { key } => Some(key.trim().to_string()).filter(|key| !key.is_empty()),
        ProviderKey::Keep | ProviderKey::Clear => None,
    }
}

impl Workspace {
    pub(crate) fn set_models_reloader(&self, reloader: ModelsReloader) {
        *self.inner.models_reloader.lock().unwrap_or_else(PoisonError::into_inner) = Some(reloader);
    }

    fn reload_models(&self, request: String, message: String) {
        let reloader = self.inner.models_reloader.lock().unwrap_or_else(PoisonError::into_inner).clone();
        match reloader {
            Some(reloader) => reloader(Some((request, message))),
            None => self.push(Update::RequestDone { request, message }),
        }
    }

    fn agent(&self) -> Result<PathBuf, String> {
        self.inner
            .agent_dir
            .clone()
            .ok_or_else(|| "Eukhe's agent folder is unknown because HOME is not set.".to_string())
    }

    pub(crate) fn models_loaded(&self, models: &[ModelOption], errors: Vec<String>) {
        {
            let mut state = self.inner.providers.lock().unwrap_or_else(PoisonError::into_inner);
            state.catalog = Some(models.to_vec());
            state.errors = errors;
        }
        self.publish_providers();
    }

    pub(crate) fn fleet_seen(&self, fleet: Vec<LocalController>) {
        self.inner.providers.lock().unwrap_or_else(PoisonError::into_inner).fleet = fleet;
        self.publish_providers();
    }

    fn publish_providers(&self) {
        let files = read_files(self.inner.agent_dir.as_deref());
        let update = {
            let state = self.inner.providers.lock().unwrap_or_else(PoisonError::into_inner);
            let mut errors = state.errors.clone();
            for error in &files.errors {
                if !errors.contains(error) {
                    errors.push(error.clone());
                }
            }
            Update::Providers {
                providers: statuses(&state, &files),
                engines: engines(&state.fleet, &files.providers),
                errors,
            }
        };
        self.push(update);
    }

    pub(crate) fn load_providers(&self) {
        self.publish_providers();
        let workspace = self.clone();
        self.inner.runtime.spawn(async move {
            let fleet = workspace.inner.local.fleet(&workspace.current_settings()).await;
            workspace.fleet_seen(fleet);
        });
    }

    fn taken_ids(&self) -> BTreeSet<String> {
        let state = self.inner.providers.lock().unwrap_or_else(PoisonError::into_inner);
        state.catalog.iter().flatten().map(|model| model.provider.clone()).collect()
    }

    pub(crate) fn discover_provider_models(
        &self,
        request: String,
        base_url: String,
        api: ProviderApi,
        key: Option<String>,
        provider: Option<String>,
    ) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let key = match (key.filter(|key| !key.trim().is_empty()), provider) {
                (Some(key), _) => Some(key),
                (None, Some(provider)) => {
                    let agent = workspace.agent()?;
                    blocking(move || Ok(stored_key(&read_object(&agent.join("auth.json"))?, &provider))).await?
                }
                (None, None) => None,
            };
            let (base_url, models) = discover(&base_url, api, key.as_deref()).await?;
            Ok(vec![Update::ProviderModels { request: reply, base_url, models }])
        });
    }

    pub(crate) fn add_custom_provider(&self, request: String, provider: CustomProvider) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let agent = workspace.agent()?;
            let name = provider.name.trim().to_string();
            if name.is_empty() {
                return Err("Enter a name for the endpoint.".to_string());
            }
            let key = chosen_key(&provider.key);
            let (base_url, models) = match provider.models.filter(|models| !models.is_empty()) {
                Some(models) => (normalize_base(&provider.base_url, provider.api)?, models),
                None => discover(&provider.base_url, provider.api, key.as_deref()).await?,
            };
            let _guard = workspace.inner.providers_lock.lock().await;
            let taken = workspace.taken_ids();
            let label = name.clone();
            blocking(move || {
                let id = edit_models(&agent, |providers| {
                    let id = unique_id(&name, providers, &taken);
                    providers.insert(id.clone(), provider_entry(None, &name, &base_url, provider.api, &models));
                    Ok(id)
                })?;
                if let Some(key) = key {
                    store_key(&agent, &id, Some(&key))?;
                }
                Ok(())
            })
            .await?;
            workspace.reload_models(reply, format!("Added {label}."));
            Ok(Vec::new())
        });
    }

    pub(crate) fn update_custom_provider(&self, request: String, id: String, provider: CustomProvider) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let agent = workspace.agent()?;
            let name = provider.name.trim().to_string();
            if name.is_empty() {
                return Err("Enter a name for the endpoint.".to_string());
            }
            let base_url = normalize_base(&provider.base_url, provider.api)?;
            let _guard = workspace.inner.providers_lock.lock().await;
            let label = name.clone();
            blocking(move || {
                edit_models(&agent, |providers| {
                    let existing = providers
                        .get(&id)
                        .filter(|entry| is_custom(&id, entry))
                        .ok_or_else(|| format!("{id} is not a custom endpoint in models.json."))?;
                    let models = provider
                        .models
                        .clone()
                        .filter(|models| !models.is_empty())
                        .unwrap_or_else(|| models_of(existing));
                    let mut entry = provider_entry(Some(existing), &name, &base_url, provider.api, &models);
                    if provider.key == ProviderKey::Clear {
                        entry["apiKey"] = json!(NO_KEY);
                    }
                    providers.insert(id.clone(), entry);
                    Ok(())
                })?;
                match &provider.key {
                    ProviderKey::Keep => Ok(()),
                    ProviderKey::Set { .. } => store_key(&agent, &id, chosen_key(&provider.key).as_deref()),
                    ProviderKey::Clear => store_key(&agent, &id, None),
                }
            })
            .await?;
            workspace.reload_models(reply, format!("Saved {label}."));
            Ok(Vec::new())
        });
    }

    pub(crate) fn remove_custom_provider(&self, request: String, id: String) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let agent = workspace.agent()?;
            let _guard = workspace.inner.providers_lock.lock().await;
            let name = blocking(move || {
                let name = edit_models(&agent, |providers| {
                    let entry = providers
                        .remove(&id)
                        .filter(|entry| is_custom(&id, entry))
                        .ok_or_else(|| format!("{id} is not a custom endpoint in models.json."))?;
                    Ok(text(&entry, "name").unwrap_or(&id).to_string())
                })?;
                store_key(&agent, &id, None)?;
                Ok(name)
            })
            .await?;
            workspace.reload_models(reply, format!("Removed {name}."));
            Ok(Vec::new())
        });
    }

    pub(crate) fn refresh_provider_models(&self, request: String, id: String) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let agent = workspace.agent()?;
            let files = {
                let agent = agent.clone();
                blocking(move || Ok(read_files(Some(&agent)))).await?
            };
            let entry = files
                .providers
                .get(&id)
                .filter(|entry| is_custom(&id, entry))
                .ok_or_else(|| format!("{id} is not a custom endpoint in models.json."))?;
            let api = text(entry, "api")
                .and_then(api_of)
                .ok_or_else(|| format!("{id} uses an API Local Studio cannot query."))?;
            let key = stored_key(&files.auth, &id).or_else(|| text(entry, "apiKey").and_then(resolve_reference));
            let (base_url, models) = discover(text(entry, "baseUrl").unwrap_or_default(), api, key.as_deref()).await?;
            let name = text(entry, "name").unwrap_or(&id).to_string();
            let count = models.len();
            let _guard = workspace.inner.providers_lock.lock().await;
            blocking(move || {
                edit_models(&agent, |providers| {
                    let existing = providers.get(&id).ok_or_else(|| format!("{id} was removed meanwhile."))?;
                    let entry = provider_entry(Some(existing), &name, &base_url, api, &models);
                    providers.insert(id.clone(), entry);
                    Ok(())
                })
            })
            .await?;
            workspace.reload_models(reply, format!("Found {count} model{}.", if count == 1 { "" } else { "s" }));
            Ok(Vec::new())
        });
    }

    pub(crate) fn set_provider_key(&self, request: String, provider: String, key: Option<String>) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let agent = workspace.agent()?;
            let key = key.map(|key| key.trim().to_string()).filter(|key| !key.is_empty());
            let message = if key.is_some() {
                format!("Saved the {} key.", display_name(&provider))
            } else {
                format!("Removed the {} key.", display_name(&provider))
            };
            let _guard = workspace.inner.providers_lock.lock().await;
            blocking(move || store_key(&agent, &provider, key.as_deref())).await?;
            workspace.reload_models(reply, message);
            Ok(Vec::new())
        });
    }

    pub(crate) fn use_local_engine(&self, request: String, engine: String) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let agent = workspace.agent()?;
            let found = {
                let state = workspace.inner.providers.lock().unwrap_or_else(PoisonError::into_inner);
                state.fleet.iter().find_map(|controller| {
                    let endpoint = controller.endpoints.iter().find(|endpoint| endpoint.id == engine)?;
                    Some((
                        engine_provider(controller, endpoint.port),
                        format!("{} · {}", controller.name, endpoint.port),
                        gateway(controller),
                        endpoint.models.clone(),
                    ))
                })
            };
            let (id, name, base_url, models) = found.ok_or("That engine is no longer running. Refresh the fleet.")?;
            let models: Vec<ProviderModel> = models
                .into_iter()
                .map(|model| ProviderModel { name: model.clone(), id: model, context_window: 0 })
                .collect();
            let key = workspace.inner.local.key(&workspace.current_settings());
            let _guard = workspace.inner.providers_lock.lock().await;
            let label = name.clone();
            blocking(move || {
                edit_models(&agent, |providers| {
                    let mut entry =
                        provider_entry(providers.get(&id), &name, &base_url, ProviderApi::OpenAiCompatible, &models);
                    if let Some(object) = entry.as_object_mut() {
                        let headers = object.entry("headers").or_insert_with(|| json!({}));
                        if let Some(headers) = headers.as_object_mut() {
                            headers.insert(ENDPOINT_HEADER.to_string(), json!(engine));
                        }
                    }
                    providers.insert(id.clone(), entry);
                    Ok(())
                })?;
                store_key(&agent, &id, key.as_deref())
            })
            .await?;
            workspace.reload_models(reply, format!("Added {label}."));
            Ok(Vec::new())
        });
    }
}
