use std::path::Path;
use std::time::Duration;

use serde_json::Value;

use super::diff;
use super::git::{GhPull, PR_FIELDS};
use super::model::{PrCheck, PrComment, PrEvent, PullRequestDetail};
use super::process::run_ok;
use super::time::parse_rfc3339_ms;

const SLOW: Duration = Duration::from_secs(60);
const DETAIL_FIELDS: &str = "body,author,createdAt,comments,reviews,commits,mergedAt,mergedBy,closedAt";
const EVENT_TEXT_CHARS: usize = 280;

pub(crate) async fn pull_request_detail(project: &Path, number: u64) -> Result<PullRequestDetail, String> {
    let number = number.to_string();
    let fields = format!("{PR_FIELDS},{DETAIL_FIELDS}");
    let view = run_ok("gh", ["pr", "view", number.as_str(), "--json", fields.as_str()], project, SLOW).await?;
    let patch = run_ok("gh", ["pr", "diff", number.as_str(), "--color", "never"], project, SLOW).await?;
    let endpoint = format!("repos/{{owner}}/{{repo}}/pulls/{number}/comments?per_page=100");
    let review = run_ok("gh", ["api", endpoint.as_str()], project, SLOW).await.unwrap_or_else(|_| "[]".to_string());
    parse_detail(&view, &patch, &review)
}

fn text(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

fn login(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(|actor| actor.get("login")).and_then(Value::as_str).map(str::to_string)
}

fn time(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(Value::as_str).and_then(parse_rfc3339_ms)
}

fn array<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value.get(key).and_then(Value::as_array).map_or(&[], Vec::as_slice)
}

fn summary(body: &str) -> String {
    let line = body.lines().map(str::trim).find(|line| !line.is_empty()).unwrap_or_default();
    if line.chars().count() <= EVENT_TEXT_CHARS {
        return line.to_string();
    }
    let mut cut: String = line.chars().take(EVENT_TEXT_CHARS).collect();
    cut.push('…');
    cut
}

fn check(value: &Value) -> PrCheck {
    let lower = |key: &str| text(value, key).to_lowercase();
    let is_context = value.get("__typename").and_then(Value::as_str) == Some("StatusContext");
    let (name, state, url) = if is_context {
        (text(value, "context"), lower("state"), value.get("targetUrl"))
    } else {
        let conclusion = lower("conclusion");
        let state = if conclusion.is_empty() { lower("status") } else { conclusion };
        (text(value, "name"), state, value.get("detailsUrl"))
    };
    PrCheck { name, state, url: url.and_then(Value::as_str).filter(|url| !url.is_empty()).map(str::to_string) }
}

pub(crate) fn parse_detail(view: &str, patch: &str, review_comments: &str) -> Result<PullRequestDetail, String> {
    let view: Value = serde_json::from_str(view).map_err(|error| format!("unexpected gh output: {error}"))?;
    let pull = serde_json::from_value::<GhPull>(view.clone())
        .map_err(|error| format!("unexpected gh output: {error}"))?
        .into_pull();
    let author = login(&view, "author");
    let created_at = time(&view, "createdAt");
    let mut comments: Vec<PrComment> = array(&view, "comments")
        .iter()
        .map(|comment| PrComment {
            author: login(comment, "author").unwrap_or_default(),
            body: text(comment, "body"),
            created_at: time(comment, "createdAt"),
            path: None,
            line: None,
        })
        .collect();
    let review: Value = serde_json::from_str(review_comments).unwrap_or(Value::Null);
    for comment in review.as_array().map_or(&[][..], Vec::as_slice) {
        let line = comment.get("line").or_else(|| comment.get("original_line")).and_then(Value::as_u64);
        comments.push(PrComment {
            author: login(comment, "user").unwrap_or_default(),
            body: text(comment, "body"),
            created_at: time(comment, "created_at"),
            path: comment.get("path").and_then(Value::as_str).map(str::to_string),
            line: line.and_then(|line| u32::try_from(line).ok()),
        });
    }
    comments.sort_by_key(|comment| comment.created_at.unwrap_or(i64::MAX));
    let mut timeline =
        vec![PrEvent { kind: "opened".to_string(), actor: author.clone(), created_at, text: pull.title.clone() }];
    for commit in array(&view, "commits") {
        let actor = array(commit, "authors")
            .first()
            .and_then(|person| {
                person
                    .get("login")
                    .and_then(Value::as_str)
                    .filter(|login| !login.is_empty())
                    .or_else(|| person.get("name").and_then(Value::as_str))
            })
            .map(str::to_string);
        timeline.push(PrEvent {
            kind: "commit".to_string(),
            actor,
            created_at: time(commit, "committedDate"),
            text: text(commit, "messageHeadline"),
        });
    }
    for comment in array(&view, "comments") {
        timeline.push(PrEvent {
            kind: "comment".to_string(),
            actor: login(comment, "author"),
            created_at: time(comment, "createdAt"),
            text: summary(&text(comment, "body")),
        });
    }
    for review in array(&view, "reviews") {
        let state = text(review, "state").to_lowercase();
        let body = summary(&text(review, "body"));
        timeline.push(PrEvent {
            kind: "review".to_string(),
            actor: login(review, "author"),
            created_at: time(review, "submittedAt"),
            text: if body.is_empty() { state } else { format!("{state}: {body}") },
        });
    }
    if let Some(merged_at) = time(&view, "mergedAt") {
        timeline.push(PrEvent {
            kind: "merged".to_string(),
            actor: login(&view, "mergedBy"),
            created_at: Some(merged_at),
            text: format!("into {}", pull.base),
        });
    } else if let Some(closed_at) = time(&view, "closedAt") {
        timeline.push(PrEvent {
            kind: "closed".to_string(),
            actor: None,
            created_at: Some(closed_at),
            text: String::new(),
        });
    }
    timeline.sort_by_key(|event| event.created_at.unwrap_or(i64::MAX));
    let checks = array(&view, "statusCheckRollup").iter().map(check).collect();
    Ok(PullRequestDetail {
        body: text(&view, "body"),
        author,
        created_at,
        files: diff::parse(patch),
        comments,
        timeline,
        checks,
        pull,
    })
}
