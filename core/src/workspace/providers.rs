use std::collections::BTreeMap;

use super::model::ProviderStatus;
use crate::model::ModelOption;

fn display_name(id: &str) -> String {
    let known = match id {
        "anthropic" => Some("Anthropic"),
        "openai" => Some("OpenAI"),
        "openai-codex" => Some("OpenAI Codex"),
        "azure-openai-responses" => Some("Azure OpenAI"),
        "google" => Some("Google"),
        "google-gemini-cli" => Some("Gemini CLI"),
        "google-antigravity" => Some("Antigravity"),
        "google-vertex" => Some("Vertex AI"),
        "github-copilot" => Some("GitHub Copilot"),
        "xai" => Some("xAI"),
        "groq" => Some("Groq"),
        "cerebras" => Some("Cerebras"),
        "openrouter" => Some("OpenRouter"),
        "mistral" => Some("Mistral"),
        "deepseek" => Some("DeepSeek"),
        "amazon-bedrock" => Some("Amazon Bedrock"),
        "zai" => Some("Z.ai"),
        "minimax" => Some("MiniMax"),
        "ollama" => Some("Ollama"),
        "lmstudio" => Some("LM Studio"),
        "local" | "local-studio" => Some("Local"),
        "faux" => Some("Faux"),
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

pub(crate) fn statuses(models: &[ModelOption]) -> Vec<ProviderStatus> {
    let mut providers: BTreeMap<&str, (u32, bool)> = BTreeMap::new();
    for model in models {
        let entry = providers.entry(model.provider.as_str()).or_insert((0, false));
        entry.0 = entry.0.saturating_add(1);
        entry.1 |= model.configured;
    }
    let mut statuses: Vec<ProviderStatus> = providers
        .into_iter()
        .map(|(id, (model_count, configured))| ProviderStatus {
            id: id.to_string(),
            name: display_name(id),
            configured,
            model_count,
            auth: if configured { "configured" } else { "missing" }.to_string(),
        })
        .collect();
    statuses.sort_by(|left, right| right.configured.cmp(&left.configured).then_with(|| left.name.cmp(&right.name)));
    statuses
}
