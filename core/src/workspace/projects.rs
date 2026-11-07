use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::PoisonError;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::git::slug;
use super::model::{ProjectScript, ProjectSettings, Settings};
use super::{files, settings, ProjectAdder, Workspace};
use crate::model::{NoticeLevel, Update};

const PROJECT_FILE: &str = "local-studio.json";
const MAX_SCRIPTS: usize = 50;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct ProjectEntry {
    pub(crate) scripts: Vec<ProjectScript>,
    pub(crate) settings: ProjectSettings,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct ProjectFile {
    pub(crate) projects: BTreeMap<String, ProjectEntry>,
}

pub(crate) fn effective(global: &Settings, overrides: &ProjectSettings) -> Settings {
    let mut settings = global.clone();
    if let Some(provider) = &overrides.default_provider {
        settings.default_provider = Some(provider.clone());
    }
    if let Some(model) = &overrides.default_model {
        settings.default_model = Some(model.clone());
    }
    if let Some(level) = &overrides.default_thinking_level {
        settings.default_thinking_level = Some(level.clone());
    }
    if let Some(access) = overrides.default_access {
        settings.default_access = access;
    }
    if let Some(workspace) = overrides.new_thread_workspace {
        settings.new_thread_workspace = workspace;
    }
    if let Some(origin) = overrides.new_worktrees_start_from_origin {
        settings.new_worktrees_start_from_origin = origin;
    }
    settings
}

pub(crate) fn sanitize_overrides(mut overrides: ProjectSettings) -> ProjectSettings {
    let clean = |value: Option<String>| value.map(|text| text.trim().to_string()).filter(|text| !text.is_empty());
    overrides.default_provider = clean(overrides.default_provider);
    overrides.default_model = clean(overrides.default_model);
    overrides.default_thinking_level = clean(overrides.default_thinking_level);
    overrides
}

pub(crate) fn sanitize_scripts(scripts: Vec<ProjectScript>) -> Vec<ProjectScript> {
    let mut ids = BTreeSet::new();
    scripts
        .into_iter()
        .filter_map(|mut script| {
            script.name = script.name.trim().to_string();
            script.command = script.command.trim().to_string();
            if script.name.is_empty() || script.command.is_empty() {
                return None;
            }
            script.icon = script.icon.map(|icon| icon.trim().to_string()).filter(|icon| !icon.is_empty());
            script.keybinding = script.keybinding.map(|key| key.trim().to_lowercase()).filter(|key| !key.is_empty());
            let source = if script.id.trim().is_empty() { script.name.as_str() } else { script.id.trim() };
            let base = slug(source).to_lowercase();
            let mut id = base.clone();
            let mut suffix = 2;
            while !ids.insert(id.clone()) {
                id = format!("{base}-{suffix}");
                suffix += 1;
            }
            script.id = id;
            Some(script)
        })
        .take(MAX_SCRIPTS)
        .collect()
}

fn strip_jsonc(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut in_string = false;
    while let Some(character) = chars.next() {
        if in_string {
            out.push(character);
            if character == '\\' {
                if let Some(next) = chars.next() {
                    out.push(next);
                }
            } else if character == '"' {
                in_string = false;
            }
            continue;
        }
        match character {
            '"' => {
                in_string = true;
                out.push(character);
            }
            '/' if chars.peek() == Some(&'/') => {
                for next in chars.by_ref() {
                    if next == '\n' {
                        out.push('\n');
                        break;
                    }
                }
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut previous = ' ';
                for next in chars.by_ref() {
                    if previous == '*' && next == '/' {
                        break;
                    }
                    previous = next;
                }
            }
            _ => out.push(character),
        }
    }
    remove_trailing_commas(&out)
}

fn remove_trailing_commas(text: &str) -> String {
    let characters: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut in_string = false;
    let mut index = 0;
    while index < characters.len() {
        let character = characters[index];
        if in_string {
            out.push(character);
            if character == '\\' {
                if let Some(next) = characters.get(index + 1) {
                    out.push(*next);
                    index += 1;
                }
            } else if character == '"' {
                in_string = false;
            }
        } else if character == '"' {
            in_string = true;
            out.push(character);
        } else if character == ',' {
            let next = characters[index + 1..].iter().find(|next| !next.is_whitespace());
            if !matches!(next, Some('}' | ']')) {
                out.push(character);
            }
        } else {
            out.push(character);
        }
        index += 1;
    }
    out
}

pub(crate) fn import(root: &Path) -> Result<Vec<ProjectScript>, String> {
    let Ok(text) = std::fs::read_to_string(root.join(PROJECT_FILE)) else {
        return Err(format!("No {PROJECT_FILE} at the project root."));
    };
    let value: Value = serde_json::from_str(&strip_jsonc(&text))
        .map_err(|error| format!("{PROJECT_FILE} is not valid JSON: {error}"))?;
    let entries = value.get("scripts").and_then(Value::as_array).map_or(&[][..], Vec::as_slice);
    Ok(entries
        .iter()
        .map(|entry| {
            let text = |key: &str| entry.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
            let flag = |key: &str| entry.get(key).and_then(Value::as_bool);
            ProjectScript {
                id: text("id"),
                name: text("name"),
                command: text("command"),
                icon: Some(text("icon")).filter(|icon| !icon.is_empty()),
                keybinding: Some(text("keybinding")).filter(|key| !key.is_empty()),
                run_on_worktree_setup: flag("runOnWorktreeCreate")
                    .or_else(|| flag("runOnWorktreeSetup"))
                    .unwrap_or(false),
                wait_for_setup: flag("async")
                    .map(|background| !background)
                    .or_else(|| flag("waitForSetup"))
                    .unwrap_or(false),
            }
        })
        .collect())
}

pub(crate) fn merge_imported(existing: &[ProjectScript], imported: Vec<ProjectScript>) -> Vec<ProjectScript> {
    let mut merged: Vec<ProjectScript> = existing.to_vec();
    for script in imported {
        match merged.iter_mut().find(|current| current.name.eq_ignore_ascii_case(script.name.trim())) {
            Some(current) => {
                let id = current.id.clone();
                let keybinding = current.keybinding.clone();
                *current = ProjectScript { id, keybinding: script.keybinding.clone().or(keybinding), ..script };
            }
            None => merged.push(script),
        }
    }
    sanitize_scripts(merged)
}

impl Workspace {
    pub(crate) fn project_entry(&self, project: &str) -> ProjectEntry {
        let file = self.inner.project_file.lock().unwrap_or_else(PoisonError::into_inner);
        file.projects.get(project).cloned().unwrap_or_default()
    }

    pub(crate) fn effective_settings(&self, project: Option<&str>) -> Settings {
        let global = self.current_settings();
        match project {
            Some(project) => effective(&global, &self.project_entry(project).settings),
            None => global,
        }
    }

    pub(crate) fn set_project_adder(&self, adder: ProjectAdder) {
        *self.inner.project_adder.lock().unwrap_or_else(PoisonError::into_inner) = Some(adder);
    }

    fn push_project(&self, project: String) {
        let entry = self.project_entry(&project);
        let global = self.current_settings();
        self.push(Update::ProjectScripts { project: project.clone(), scripts: entry.scripts.clone() });
        self.push(Update::ProjectSettings {
            project,
            effective: effective(&global, &entry.settings),
            settings: entry.settings,
        });
    }

    pub(crate) fn push_overridden_projects(&self) {
        let projects: Vec<String> = self
            .inner
            .project_file
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .projects
            .iter()
            .filter(|(_, entry)| entry.settings != ProjectSettings::default())
            .map(|(project, _)| project.clone())
            .collect();
        for project in projects {
            self.push_project(project);
        }
    }

    fn edit_project(&self, project: String, change: impl FnOnce(&mut ProjectEntry)) {
        let snapshot = {
            let mut file = self.inner.project_file.lock().unwrap_or_else(PoisonError::into_inner);
            let entry = file.projects.entry(project.clone()).or_default();
            change(entry);
            if entry.scripts.is_empty() && entry.settings == ProjectSettings::default() {
                file.projects.remove(&project);
            }
            file.clone()
        };
        self.push_project(project);
        let workspace = self.clone();
        self.inner.runtime.spawn(async move {
            let _guard = workspace.inner.save_lock.lock().await;
            let path = workspace.inner.data_dir.join("project-workspace.json");
            let result = tokio::task::spawn_blocking(move || settings::save_json(&path, &snapshot))
                .await
                .map_err(|error| error.to_string())
                .and_then(|result| result);
            if let Err(message) = result {
                workspace.error(message);
            }
        });
    }

    pub(crate) fn load_project_settings(&self, project: String) {
        self.push_project(project);
    }

    pub(crate) fn set_project_scripts(&self, project: String, scripts: Vec<ProjectScript>) {
        let scripts = sanitize_scripts(scripts);
        self.edit_project(project, move |entry| entry.scripts = scripts);
    }

    pub(crate) fn update_project_settings(&self, project: String, overrides: ProjectSettings) {
        let overrides = sanitize_overrides(overrides);
        self.edit_project(project, move |entry| entry.settings = overrides);
    }

    pub(crate) fn import_project_scripts(&self, request: String, project: String) {
        let workspace = self.clone();
        let reply = request.clone();
        self.answer(request, async move {
            let root = files::root(&project)?;
            let imported =
                tokio::task::spawn_blocking(move || import(&root)).await.map_err(|error| error.to_string())??;
            let count = imported.len();
            let existing = workspace.project_entry(&project).scripts;
            let merged = merge_imported(&existing, imported);
            workspace.edit_project(project, move |entry| entry.scripts = merged);
            let message = format!("Imported {count} script(s) from {PROJECT_FILE}.");
            Ok(vec![Update::RequestDone { request: reply, message }])
        });
    }

    pub(crate) fn run_project_script(&self, request: String, project: String, script: String) {
        let workspace = self.clone();
        self.inner.runtime.spawn_blocking(move || {
            let inner = &workspace.inner;
            let found = workspace.project_entry(&project).scripts.into_iter().find(|candidate| candidate.id == script);
            let Some(found) = found else {
                workspace.push(Update::RequestFailed { request, message: format!("Unknown project script {script}.") });
                return;
            };
            let opened = files::root(&project)
                .and_then(|root| inner.terminals.open(&inner.runtime, &inner.mailbox, request.clone(), &root, 120, 32));
            match opened {
                Ok(terminal) => {
                    let mut line = found.command.into_bytes();
                    line.push(b'\n');
                    if let Err(message) = inner.terminals.write(terminal, line) {
                        inner.mailbox.notice(NoticeLevel::Error, message);
                    }
                }
                Err(message) => workspace.push(Update::RequestFailed { request, message }),
            }
        });
    }

    pub(crate) fn add_project_path(&self, path: String) {
        let adder = self.inner.project_adder.lock().unwrap_or_else(PoisonError::into_inner).clone();
        match adder {
            Some(adder) => adder(path),
            None => self.inner.mailbox.notice(NoticeLevel::Warning, "Add the cloned folder as a project manually."),
        }
    }
}
