use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};

use anyhow::Context;
use serde_json::{json, Value};

const MODELS: [&str; 2] = ["stub-1", "stub-2"];

struct Request {
    method: String,
    path: String,
    authorization: Option<String>,
    body: Vec<u8>,
}

fn read_request(stream: &TcpStream) -> anyhow::Result<Request> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    let mut length = 0_usize;
    let mut authorization = None;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 || header.trim().is_empty() {
            break;
        }
        let Some((name, value)) = header.split_once(':') else { continue };
        let value = value.trim().to_string();
        match name.trim().to_ascii_lowercase().as_str() {
            "content-length" => length = value.parse().unwrap_or(0),
            "authorization" => authorization = Some(value),
            _ => {}
        }
    }
    let mut body = vec![0_u8; length];
    reader.read_exact(&mut body)?;
    Ok(Request { method, path, authorization, body })
}

fn respond(mut stream: &TcpStream, status: &str, content_type: &str, body: &str) -> anyhow::Result<()> {
    write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )?;
    stream.flush()?;
    Ok(())
}

fn chunk(value: &Value) -> String {
    format!("data: {value}\n\n")
}

fn serve(stream: &TcpStream, key: &str) -> anyhow::Result<()> {
    let request = read_request(stream)?;
    let expected = format!("Bearer {key}");
    let auth = match request.authorization.as_deref() {
        None => "no key",
        Some(value) if value == expected => "key ok",
        Some(_) => "other key",
    };
    eprintln!("provider_stub: {} {} ({auth})", request.method, request.path);
    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/v1/models") => {
            if auth == "other key" {
                return respond(stream, "401 Unauthorized", "application/json", r#"{"error":{"message":"bad key"}}"#);
            }
            let data: Vec<Value> = MODELS
                .iter()
                .map(|id| json!({ "id": id, "object": "model", "owned_by": "stub", "context_length": 32768 }))
                .collect();
            respond(stream, "200 OK", "application/json", &json!({ "object": "list", "data": data }).to_string())
        }
        ("POST", "/v1/chat/completions") => {
            let body: Value = serde_json::from_slice(&request.body).unwrap_or(Value::Null);
            let model = body.get("model").and_then(Value::as_str).unwrap_or("unknown").to_string();
            let text = format!("Stub reply from {model} ({auth}).");
            let mut stream_body = String::new();
            for (index, piece) in text.split_inclusive(' ').enumerate() {
                let delta = if index == 0 {
                    json!({ "role": "assistant", "content": piece })
                } else {
                    json!({ "content": piece })
                };
                stream_body.push_str(&chunk(
                    &json!({ "id": "chatcmpl-stub", "object": "chat.completion.chunk", "model": model, "choices": [{ "index": 0, "delta": delta, "finish_reason": null }] }),
                ));
            }
            stream_body.push_str(&chunk(&json!({
                "id": "chatcmpl-stub",
                "object": "chat.completion.chunk",
                "model": model,
                "choices": [{ "index": 0, "delta": {}, "finish_reason": "stop" }],
                "usage": { "prompt_tokens": 12, "completion_tokens": 6, "total_tokens": 18 }
            })));
            stream_body.push_str("data: [DONE]\n\n");
            respond(stream, "200 OK", "text/event-stream", &stream_body)
        }
        _ => respond(stream, "404 Not Found", "application/json", r#"{"error":{"message":"not found"}}"#),
    }
}

fn main() -> anyhow::Result<()> {
    let key = std::env::args().nth(1).context("usage: provider_stub <expected key>")?;
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    println!("{}", listener.local_addr()?.port());
    std::io::stdout().flush()?;
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let key = key.clone();
        std::thread::spawn(move || {
            if let Err(error) = serve(&stream, &key) {
                eprintln!("provider_stub: {error:#}");
            }
        });
    }
    Ok(())
}
