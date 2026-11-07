use std::path::Path;

use eukhe_types::slash_commands::parse_slash_command;
use serde_json::Value;

use crate::model::{CommandKind, SkillEntry, SkillSource, SlashCommand};

const SESSION_COMMANDS: [(&str, &str); 7] = [
    ("compact", "Compact the conversation context"),
    ("refine", "Refine the last answer"),
    ("goal", "Set, pause, resume or clear the session goal"),
    ("autonomous", "Run autonomously until the goal is met"),
    ("remind", "Schedule a reminder in this session"),
    ("force", "Force the next step past a guard"),
    ("dynamic-workflow", "Start a dynamic workflow"),
];

#[derive(Debug, Clone, Default)]
pub(crate) struct Resources {
    skills: Vec<Resource>,
    templates: Vec<Resource>,
}

#[derive(Debug, Clone)]
struct Resource {
    name: String,
    file_path: String,
    description: String,
    source: SkillSource,
}

impl Resources {
    pub(crate) fn parse(data: &Value) -> Self {
        let list = |key: &str| -> Vec<Resource> {
            data.get(key)
                .and_then(Value::as_array)
                .map(|entries| {
                    entries
                        .iter()
                        .filter_map(|entry| {
                            Some(Resource {
                                name: entry.get("name")?.as_str()?.to_string(),
                                file_path: entry.get("filePath")?.as_str()?.to_string(),
                                description: entry
                                    .get("description")
                                    .and_then(Value::as_str)
                                    .unwrap_or_default()
                                    .to_string(),
                                source: source(entry.get("sourceInfo")),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default()
        };
        Self { skills: list("skills"), templates: list("prompts") }
    }

    pub(crate) fn skills(&self) -> Vec<SkillEntry> {
        self.skills
            .iter()
            .map(|skill| SkillEntry {
                name: skill.name.clone(),
                description: skill.description.clone(),
                source: skill.source,
                path: skill.file_path.clone(),
            })
            .collect()
    }

    pub(crate) fn commands(&self) -> Vec<SlashCommand> {
        let mut commands: Vec<SlashCommand> = vec![SlashCommand {
            name: "model".to_string(),
            description: "Switch the response model for this thread".to_string(),
            source: "app".to_string(),
            kind: CommandKind::Command,
        }];
        commands.extend(SESSION_COMMANDS.iter().map(|(name, description)| SlashCommand {
            name: (*name).to_string(),
            description: (*description).to_string(),
            source: "session".to_string(),
            kind: CommandKind::Command,
        }));
        commands.extend(self.templates.iter().map(|template| SlashCommand {
            name: template.name.clone(),
            description: template.description.clone(),
            source: source_label(template.source).to_string(),
            kind: CommandKind::Template,
        }));
        commands.extend(self.skills.iter().map(|skill| SlashCommand {
            name: format!("skill:{}", skill.name),
            description: skill.description.clone(),
            source: source_label(skill.source).to_string(),
            kind: CommandKind::Skill,
        }));
        commands
    }

    pub(crate) fn expand(&self, text: &str) -> String {
        if let Some((name, args)) = parse_slash_command(text) {
            if let Some(skill_name) = name.strip_prefix("skill:") {
                if let Some(block) = self.skills.iter().find(|skill| skill.name == skill_name).and_then(skill_block) {
                    return if args.trim().is_empty() { block } else { format!("{block}\n\n{args}") };
                }
                return text.to_string();
            }
            if let Some(template) = self.templates.iter().find(|template| template.name == name) {
                if let Ok(content) = std::fs::read_to_string(&template.file_path) {
                    return substitute_args(&strip_frontmatter(&content), &words(&args));
                }
            }
            return text.to_string();
        }
        let mut blocks: Vec<String> = Vec::new();
        let mut used: Vec<&str> = Vec::new();
        for token in text.split(|c: char| c.is_whitespace() || matches!(c, ',' | '.' | ';' | ':' | '(' | ')')) {
            let Some(name) = token.strip_prefix('$') else { continue };
            if used.contains(&name) {
                continue;
            }
            if let Some(block) = self.skills.iter().find(|skill| skill.name == name).and_then(skill_block) {
                used.push(name);
                blocks.push(block);
            }
        }
        if blocks.is_empty() {
            return text.to_string();
        }
        blocks.push(text.to_string());
        blocks.join("\n\n")
    }
}

fn skill_block(skill: &Resource) -> Option<String> {
    let content = std::fs::read_to_string(&skill.file_path).ok()?;
    let base = Path::new(&skill.file_path).parent().map(|dir| dir.display().to_string()).unwrap_or_default();
    Some(format!(
        "<skill name=\"{}\" location=\"{}\">\nReferences are relative to {}.\n\n{}\n</skill>",
        skill.name,
        skill.file_path,
        base,
        strip_frontmatter(&content).trim()
    ))
}

fn source(info: Option<&Value>) -> SkillSource {
    let text = |key: &str| info.and_then(|info| info.get(key)).and_then(Value::as_str).unwrap_or_default();
    if text("origin") == "package" {
        return SkillSource::System;
    }
    match text("scope") {
        "user" => SkillSource::Personal,
        "project" => SkillSource::Repo,
        "temporary" => SkillSource::App,
        _ => SkillSource::System,
    }
}

fn source_label(source: SkillSource) -> &'static str {
    match source {
        SkillSource::App => "app",
        SkillSource::Repo => "repo",
        SkillSource::Project => "project",
        SkillSource::Personal => "personal",
        SkillSource::System => "system",
    }
}

fn strip_frontmatter(content: &str) -> String {
    let normalized = content.trim_start_matches('\u{feff}').replace("\r\n", "\n").replace('\r', "\n");
    let Some(rest) = normalized.strip_prefix("---") else { return normalized };
    let Some(end) = rest.find("\n---") else { return normalized };
    if rest.get(1..end).is_none_or(str::is_empty) {
        return normalized;
    }
    rest.get(end + 4..).unwrap_or_default().trim().to_string()
}

fn words(args: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut started = false;
    for c in args.chars() {
        match quote {
            Some(open) if c == open => quote = None,
            Some(_) => current.push(c),
            None if c == '"' || c == '\'' => {
                quote = Some(c);
                started = true;
            }
            None if c.is_whitespace() => {
                if started {
                    words.push(std::mem::take(&mut current));
                    started = false;
                }
            }
            None => {
                current.push(c);
                started = true;
            }
        }
    }
    if started {
        words.push(current);
    }
    words
}

fn substitute_args(content: &str, args: &[String]) -> String {
    let all = args.join(" ");
    let chars: Vec<char> = content.chars().collect();
    let mut out = String::with_capacity(content.len());
    let mut index = 0;
    while let Some(&c) = chars.get(index) {
        if c != '$' {
            out.push(c);
            index += 1;
            continue;
        }
        let rest: String = chars[index..].iter().take(10).collect();
        if rest.starts_with("$ARGUMENTS") {
            out.push_str(&all);
            index += "$ARGUMENTS".len();
            continue;
        }
        match chars.get(index + 1) {
            Some('@') => {
                out.push_str(&all);
                index += 2;
            }
            Some('{') => {
                let close = chars[index + 2..].iter().position(|c| *c == '}');
                let inner: Option<String> = close.map(|close| chars[index + 2..index + 2 + close].iter().collect());
                if let (Some(close), Some(range)) = (close, inner.as_deref().and_then(|inner| inner.strip_prefix("@:")))
                {
                    let mut parts = range.splitn(2, ':');
                    let start = parts.next().and_then(|start| start.parse::<usize>().ok()).unwrap_or(1);
                    let skip = start.saturating_sub(1);
                    let slice: Vec<&str> = match parts.next().and_then(|length| length.parse::<usize>().ok()) {
                        Some(length) => args.iter().skip(skip).take(length).map(String::as_str).collect(),
                        None => args.iter().skip(skip).map(String::as_str).collect(),
                    };
                    out.push_str(&slice.join(" "));
                    index += 2 + close + 1;
                } else {
                    out.push('$');
                    index += 1;
                }
            }
            Some(digit) if digit.is_ascii_digit() => {
                let mut end = index + 1;
                while chars.get(end).is_some_and(char::is_ascii_digit) {
                    end += 1;
                }
                let number: String = chars[index + 1..end].iter().collect();
                if let Some(value) = number.parse::<usize>().ok().and_then(|n| args.get(n.saturating_sub(1))) {
                    out.push_str(value);
                }
                index = end;
            }
            _ => {
                out.push('$');
                index += 1;
            }
        }
    }
    out
}
