use std::path::PathBuf;

use eukhe_client::daemon_client::DaemonClient;
use eukhe_types::daemon::{DaemonCommand, DaemonSessionLifecycle, PromptInput};
use serde_json::{json, Map, Value};
use tokio::sync::watch;

#[derive(Clone)]
pub(crate) struct TextGen {
    client: watch::Receiver<Option<DaemonClient>>,
    session_dir: Option<PathBuf>,
    home: String,
}

impl TextGen {
    pub(crate) fn new(
        client: watch::Receiver<Option<DaemonClient>>,
        session_dir: Option<PathBuf>,
        home: String,
    ) -> Self {
        Self { client, session_dir, home }
    }

    pub(crate) async fn one_shot(
        &self,
        prompt: String,
        provider: Option<String>,
        model: Option<String>,
    ) -> Result<String, String> {
        let client = self.client.borrow().clone().ok_or_else(|| "Not connected to the Eukhe daemon.".to_string())?;
        let mut config = json!({ "cwd": self.home });
        if let Some(dir) = &self.session_dir {
            config["sessionDir"] = Value::String(dir.to_string_lossy().into_owned());
        }
        if let Some(script) = std::env::var_os("EUKHE_FAUX_SCRIPT").filter(|value| !value.is_empty()) {
            config["script"] = Value::String(script.to_string_lossy().into_owned());
        }
        if let (Some(provider), Some(model)) = (provider, model) {
            config["provider"] = Value::String(provider);
            config["model"] = Value::String(model);
        }
        let created = client
            .request_ok(DaemonCommand::Create {
                id: None,
                session_path: None,
                continue_recent: None,
                no_session: Some(true),
                name: None,
                config: Some(config),
                runtime_metadata: None,
                lifecycle: Some(DaemonSessionLifecycle::ClientOwned),
                env: None,
                launch_env: None,
                rest: Map::default(),
            })
            .await
            .map_err(|error| format!("{error:#}"))?;
        let active = created
            .get("activeSessionId")
            .and_then(Value::as_str)
            .ok_or_else(|| "The daemon opened a session without an id.".to_string())?
            .to_string();
        let answer = ask(&client, &active, prompt).await;
        let killed =
            client.request_ok(DaemonCommand::Kill { id: None, active_session_id: active, rest: Map::default() }).await;
        let answer = answer?;
        killed.map_err(|error| format!("{error:#}"))?;
        Ok(answer)
    }
}

async fn ask(client: &DaemonClient, active: &str, prompt: String) -> Result<String, String> {
    client
        .request_ok(DaemonCommand::PromptAndWait {
            id: None,
            active_session_id: active.to_string(),
            message: prompt,
            input: PromptInput {
                content: None,
                images: None,
                streaming_behavior: None,
                queue_if_busy: None,
                expand_prompt_templates: None,
                source: None,
                agent_message_id: None,
                custom_message: None,
                queue_key: None,
                prefix_messages: None,
                admission_id: None,
                rlm_notice_nonce: None,
                reply_to: None,
            },
            rest: Map::default(),
        })
        .await
        .map_err(|error| format!("{error:#}"))?;
    let data = client
        .request_ok(DaemonCommand::GetLastAssistantText {
            id: None,
            active_session_id: active.to_string(),
            rest: Map::default(),
        })
        .await
        .map_err(|error| format!("{error:#}"))?;
    data.get("text")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| "The model returned no text.".to_string())
}
