use local_studio_core::{Harness, ModelOption};

#[path = "support/harness.rs"]
mod harness;

fn model(models: &[ModelOption]) -> Option<String> {
    models.iter().find(|model| model.id == "haiku").map(|model| model.id.clone())
}

fn main() -> anyhow::Result<()> {
    harness::run(&harness::Target {
        name: "harness_claude_smoke",
        harness: Harness::ClaudeCode,
        provider: "claude-code",
        model,
    })
}
