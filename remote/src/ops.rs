use local_studio_core::{PromptDraft, Studio};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

pub struct OpError {
    pub code: &'static str,
    pub message: String,
}

impl OpError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }

    pub fn to_value(&self) -> Value {
        json!({ "code": self.code, "message": self.message })
    }
}

pub fn arg<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T, OpError> {
    let value = args.get(key).cloned().unwrap_or(Value::Null);
    serde_json::from_value(value).map_err(|error| OpError::new("bad_args", format!("args.{key}: {error}")))
}

pub fn correlation(op: &str) -> Option<&'static str> {
    match op {
        "start_thread" => Some("draft"),
        "answer_approval" => None,
        _ => Some("request"),
    }
}

pub fn idempotent(op: &str) -> bool {
    matches!(op, "send" | "start_thread")
}

pub fn answered(op: &str) -> bool {
    matches!(
        op,
        "search_threads"
            | "list_archived"
            | "list_commands"
            | "list_skills"
            | "load_message_image"
            | "load_diff"
            | "list_pull_requests"
            | "load_pull_request"
            | "read_file"
    )
}

pub fn dispatch(
    studio: &Studio,
    op: &str,
    a: &Value,
    prompt: &mut dyn FnMut(&Value) -> Result<PromptDraft, OpError>,
) -> Result<(), OpError> {
    match op {
        "send" => {
            let (request, thread, delivery) = (arg(a, "request")?, arg(a, "thread")?, arg(a, "delivery")?);
            studio.send(request, thread, prompt(a.get("prompt").unwrap_or(&Value::Null))?, delivery);
        }
        "abort" => studio.abort(arg(a, "thread")?),
        "send_queued_now" => studio.send_queued_now(arg(a, "thread")?, arg(a, "queued")?),
        "remove_queued" => studio.remove_queued(arg(a, "thread")?, arg(a, "queued")?),
        "answer_approval" => studio.answer_approval(arg(a, "thread")?, arg(a, "request")?, arg(a, "answer")?),
        "answer_questions" => {
            return Err(OpError::new(
                "not_built",
                "answer_questions waits on question cards in Eukhe's daemon (issue #19); this server has no questions to answer",
            ));
        }
        "compact" => studio.compact(arg(a, "thread")?),
        "start_thread" => {
            let (draft, project, settings) = (arg(a, "draft")?, arg(a, "project")?, arg(a, "settings")?);
            studio.start_thread(draft, project, prompt(a.get("prompt").unwrap_or(&Value::Null))?, settings);
        }
        "rename_thread" => studio.rename_thread(arg(a, "thread")?, arg(a, "title")?),
        "regenerate_title" => studio.regenerate_title(arg(a, "thread")?),
        "fork_thread" => studio.fork_thread(arg(a, "thread")?),
        "set_archived" => studio.set_archived(arg(a, "thread")?, arg(a, "archived")?),
        "set_pinned" => studio.set_pinned(arg(a, "thread")?, arg(a, "pinned")?),
        "set_settled" => studio.set_settled(arg(a, "thread")?, arg(a, "settled")?),
        "snooze" => studio.snooze(arg(a, "thread")?, arg(a, "until")?),
        "mark_unread" => studio.mark_unread(arg(a, "thread")?, arg(a, "unread")?),
        "search_threads" => studio.search_threads(arg(a, "request")?, arg(a, "query")?, arg(a, "limit")?),
        "list_archived" => studio.list_archived(arg(a, "request")?),
        "load_models" => studio.load_models(),
        "set_model" => studio.set_model(arg(a, "thread")?, arg(a, "provider")?, arg(a, "model")?),
        "set_thinking_level" => studio.set_thinking_level(arg(a, "thread")?, arg(a, "level")?),
        "set_access_mode" => studio.set_access_mode(arg(a, "thread")?, arg(a, "mode")?),
        "list_commands" => studio.list_commands(arg(a, "request")?, arg(a, "project")?),
        "list_skills" => studio.list_skills(arg(a, "request")?, arg(a, "project")?),
        "cancel_subagent" => studio.cancel_subagent(arg(a, "thread")?, arg(a, "child")?),
        "load_message_image" => {
            studio.load_message_image(arg(a, "request")?, arg(a, "thread")?, arg(a, "entry")?, arg(a, "index")?);
        }
        "git_status" => studio.git_status(arg(a, "project")?),
        "load_diff" => studio.load_diff(arg(a, "request")?, arg(a, "project")?, arg(a, "scope")?),
        "list_pull_requests" => studio.list_pull_requests(arg(a, "request")?, arg(a, "project")?),
        "load_pull_request" => studio.load_pull_request(arg(a, "request")?, arg(a, "project")?, arg(a, "number")?),
        "read_file" => studio.read_file(arg(a, "request")?, arg(a, "project")?, arg(a, "relative")?),
        _ => return Err(OpError::new("not_remote", format!("{op} is not in the protocol 2 op table"))),
    }
    Ok(())
}
