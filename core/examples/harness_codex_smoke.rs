use local_studio_core::{Harness, ModelOption};

#[path = "support/harness.rs"]
mod harness;

fn model(models: &[ModelOption]) -> Option<String> {
    let small = ["nano", "mini", "luna"];
    small
        .iter()
        .find_map(|size| models.iter().find(|model| model.id.contains(size)))
        .or_else(|| models.last())
        .map(|model| model.id.clone())
}

fn main() -> anyhow::Result<()> {
    harness::run(&harness::Target { name: "harness_codex_smoke", harness: Harness::Codex, provider: "codex", model })
}
