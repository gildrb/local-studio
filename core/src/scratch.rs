use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path};

pub fn check_scratch_agent(agent: &Path) -> Result<(), String> {
    let auth = agent.join("auth.json");
    let metadata = std::fs::symlink_metadata(&auth).map_err(|error| {
        format!("{}: {error}; this run saves keys, so it needs its own scratch auth.json holding {{}}", auth.display())
    })?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "{} is a symlink; this run saves keys, so it needs its own scratch auth.json holding {{}}, never a link to real credentials",
            auth.display()
        ));
    }
    if !metadata.is_file() || metadata.nlink() != 1 {
        return Err(format!("{} must be a regular file with a single link", auth.display()));
    }
    let resolved = std::fs::canonicalize(agent).map_err(|error| format!("{}: {error}", agent.display()))?;
    if resolved
        .components()
        .any(|component| matches!(component, Component::Normal(name) if name == ".pi" || name == ".eukhe"))
    {
        return Err(format!("{} is a real agent dir; run against a scratch agent dir", agent.display()));
    }
    if !stored_keys_empty(agent) {
        return Err(format!("{} holds credentials; this run needs a scratch auth.json holding {{}}", auth.display()));
    }
    Ok(())
}

pub fn stored_keys_empty(agent: &Path) -> bool {
    std::fs::read(agent.join("auth.json"))
        .ok()
        .and_then(|data| serde_json::from_slice::<serde_json::Value>(&data).ok())
        .and_then(|value| value.as_object().map(serde_json::Map::is_empty))
        .unwrap_or(false)
}
