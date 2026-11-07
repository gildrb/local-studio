use std::rc::Rc;

use local_studio_core::{
    LocalEngine, ProviderApi, ProviderCredential, ProviderKind, ProviderModel, ProviderStatus, Update,
};

use crate::app::App;
use crate::fixtures::{conversation, provider, providers};

pub const SCENES: [&str; 3] = ["providers-pane", "providers-endpoint-dialog", "providers-endpoint-edit"];

fn models() -> Vec<ProviderModel> {
    [
        ("qwen3-coder-30b", "Qwen3 Coder 30B", 131_072),
        ("gpt-oss-120b", "gpt-oss-120b", 131_072),
        ("llama-3.3-70b", "Llama 3.3 70B", 65_536),
    ]
    .into_iter()
    .map(|(id, name, context_window)| ProviderModel { id: id.to_string(), name: name.to_string(), context_window })
    .collect()
}

fn endpoint() -> ProviderStatus {
    ProviderStatus {
        base_url: Some("http://office-gpu.lan:8000/v1".to_string()),
        api: Some(ProviderApi::OpenAiCompatible),
        models: models(),
        ..provider("office-vllm", "Office vLLM", ProviderKind::Custom, ProviderCredential::StoredKey, 3)
    }
}

fn updates() -> Vec<Update> {
    let mut all = providers();
    all.push(endpoint());
    all.push(ProviderStatus {
        base_url: Some("http://127.0.0.1:11434/v1".to_string()),
        api: Some(ProviderApi::OpenAiCompatible),
        ..provider("ollama", "Ollama", ProviderKind::Custom, ProviderCredential::NotRequired, 2)
    });
    vec![Update::Providers {
        providers: all,
        engines: vec![
            LocalEngine {
                id: "spark:8000".to_string(),
                controller: "spark".to_string(),
                port: 8000,
                base_url: "http://spark:18091/v1".to_string(),
                models: vec!["Qwen/Qwen3-Coder-30B-A3B-Instruct".to_string()],
                provider: "local-spark".to_string(),
                added: false,
            },
            LocalEngine {
                id: "workstation:8001".to_string(),
                controller: "workstation".to_string(),
                port: 8001,
                base_url: "http://workstation:18091/v1".to_string(),
                models: vec!["openai/gpt-oss-120b".to_string()],
                provider: "local-workstation".to_string(),
                added: true,
            },
        ],
        errors: vec!["models.json: providers.legacy.models[0] needs an id".to_string()],
    }]
}

pub fn stage(app: &Rc<App>, scene: &str) {
    match scene {
        "providers-pane" => {
            conversation(app, false);
            app.apply(updates());
            app.open_settings(Some("providers"));
        }
        "providers-endpoint-dialog" => {
            conversation(app, false);
            app.apply(updates());
            crate::providers::fixture_dialog(app, None, &models(), "http://office-gpu.lan:8000/v1");
        }
        "providers-endpoint-edit" => {
            conversation(app, false);
            app.apply(updates());
            crate::providers::present(app, Some(endpoint()));
        }
        _ => crate::scenes_pickers::stage(app, scene),
    }
}
