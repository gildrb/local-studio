use std::fmt::Write as _;
use std::path::Path;

use super::model::{Settings, WritingStyle};
use super::{git, Workspace};

fn writer_model(settings: &Settings) -> Option<(Option<String>, String)> {
    let model = settings.source_control_model.clone().or_else(|| settings.text_generation_model.clone())?;
    let provider = settings.source_control_provider.clone().or_else(|| settings.text_generation_provider.clone());
    Some((provider, model))
}

fn style_rules(settings: &Settings, recent: &[String]) -> String {
    let mut rules = match settings.writing_style {
        WritingStyle::ConventionalCommits => {
            "Use Conventional Commits (type(scope): summary, e.g. feat:, fix:, chore:).".to_string()
        }
        WritingStyle::RepoConventions => {
            let mut text = "Match the repository's existing commit style.".to_string();
            if !recent.is_empty() {
                text.push_str(" Recent subjects:\n");
                for subject in recent {
                    let _ = writeln!(text, "- {subject}");
                }
            }
            text
        }
        WritingStyle::Custom => String::new(),
    };
    let instructions = settings.writing_instructions.trim();
    if !instructions.is_empty() {
        let _ = write!(rules, "\nFollow these instructions:\n{instructions}");
    }
    rules
}

fn clean_reply(reply: &str) -> String {
    let trimmed = reply.trim();
    let unfenced = trimmed
        .strip_prefix("```")
        .map(|rest| rest.split_once('\n').map_or(rest, |(_, body)| body))
        .and_then(|rest| rest.strip_suffix("```"))
        .unwrap_or(trimmed);
    unfenced.trim().trim_matches(|character| character == '"' || character == '`').trim().to_string()
}

impl Workspace {
    async fn write_text(&self, settings: &Settings, prompt: String) -> Option<String> {
        let (provider, model) = writer_model(settings)?;
        let reply = self.inner.text.one_shot(prompt, provider, Some(model)).await.ok()?;
        Some(clean_reply(&reply)).filter(|text| !text.is_empty())
    }

    pub(crate) async fn generated_commit_message(&self, project: &Path) -> Option<String> {
        let settings = self.current_settings();
        writer_model(&settings)?;
        git::stage_all(project).await.ok()?;
        let changes = git::staged_summary(project).await.ok()?;
        if changes.trim().is_empty() {
            return None;
        }
        let recent = git::recent_subjects(project).await;
        let prompt = format!(
            "Write a git commit message for the staged changes below.\n{}\nReply with only the commit message: a subject line under 72 characters, optionally followed by a blank line and a short body.\n\nStaged changes:\n{changes}",
            style_rules(&settings, &recent)
        );
        self.write_text(&settings, prompt).await
    }

    pub(crate) async fn pull_request_text(&self, project: &Path, title: &str, body: &str) -> (String, String) {
        let settings = self.current_settings();
        let template = settings.follow_pr_templates.then(|| git::pull_request_template(project)).flatten();
        let (summary, last_subject) = git::branch_summary(project).await;
        let mut title = title.trim().to_string();
        let mut body = body.trim().to_string();
        if title.is_empty() || body.is_empty() {
            let mut prompt = format!(
                "Write a pull request for the branch below.\n{}\nReply with the title on the first line, then a blank line, then the description in Markdown.\n",
                style_rules(&settings, &[])
            );
            if let Some(template) = &template {
                let _ = write!(prompt, "\nFill in this pull request template for the description:\n{template}\n");
            }
            let _ = write!(prompt, "\nCommits and changes:\n{summary}");
            if let Some(reply) = self.write_text(&settings, prompt).await {
                let (generated_title, generated_body) =
                    reply.split_once('\n').map_or((reply.as_str(), ""), |(first, rest)| (first, rest));
                if title.is_empty() {
                    title = generated_title.trim().trim_start_matches('#').trim().to_string();
                }
                if body.is_empty() {
                    body = generated_body.trim().to_string();
                }
            }
        }
        if title.is_empty() {
            title = last_subject.unwrap_or_else(|| "Update".to_string());
        }
        if body.is_empty() {
            body = template.unwrap_or(summary);
        }
        (title, body)
    }
}
