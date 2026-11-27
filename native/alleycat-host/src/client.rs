use crate::wire::{
    ALPN, PROTOCOL_VERSION, LineReader, Request, Resume, hex_decode_32, read_frame, write_frame,
};
use iroh::Endpoint;
use iroh::EndpointAddr;
use iroh::EndpointId;
use iroh::RelayUrl;
use iroh::endpoint::presets;
use serde_json::{Value, json};
use std::str::FromStr;
use std::time::Duration;
use tokio::io::AsyncBufReadExt;
use tokio::sync::mpsc;

pub const DEFAULT_CLIENT_TOKEN: &str = "dev";
const TURN_STALL_TIMEOUT: Duration = Duration::from_secs(120);

pub enum ClientAction {
    ListAgents,
    RestartAgent { agent: String },
    Connect { agent: String, resume: Option<u64> },
    RunTurn {
        agent: String,
        text: String,
        resume: bool,
        expect_fragment: Option<String>,
        interrupt: bool,
        image_data_url: Option<String>,
        verify_image_input: bool,
    },
    ThreadPages { limit: u32 },
    SearchExec {
        query: String,
        expect_hit: String,
        exec_shell: String,
        exec_stdout_fragment: String,
    },
}

pub struct ClientOptions {
    pub node_id: String,
    pub relay: Option<String>,
    pub token: Option<String>,
}

pub async fn run(options: ClientOptions, action: ClientAction) -> Result<(), String> {
    match action {
        ClientAction::RunTurn {
            agent,
            text,
            resume,
            expect_fragment,
            interrupt,
            image_data_url,
            verify_image_input,
        } => {
            run_turn(
                options,
                agent,
                text,
                resume,
                expect_fragment,
                interrupt,
                image_data_url,
                verify_image_input,
            )
            .await
        }
        ClientAction::ThreadPages { limit } => run_threads(options, limit).await,
        ClientAction::SearchExec {
            query,
            expect_hit,
            exec_shell,
            exec_stdout_fragment,
        } => run_search_exec(options, query, expect_hit, exec_shell, exec_stdout_fragment).await,
        action => run_simple(options, action).await,
    }
}

async fn bind_endpoint() -> Result<Endpoint, String> {
    Endpoint::builder(presets::N0).bind().await.map_err(|error| format!("bind: {error}"))
}

async fn dial(options: &ClientOptions) -> Result<(Endpoint, iroh::endpoint::Connection), String> {
    let id_bytes = hex_decode_32(&options.node_id)?;
    let node_id = EndpointId::from_bytes(&id_bytes).map_err(|error| format!("node id: {error}"))?;
    let endpoint = bind_endpoint().await?;
    let mut addr = EndpointAddr::new(node_id);
    if let Some(relay) = &options.relay {
        let relay_url = RelayUrl::from_str(relay).map_err(|error| format!("relay: {error}"))?;
        addr = addr.with_relay_url(relay_url);
    }
    let connection = endpoint
        .connect(addr, ALPN)
        .await
        .map_err(|error| format!("connect: {error}"))?;
    Ok((endpoint, connection))
}

async fn connect_frame(
    connection: &iroh::endpoint::Connection,
    token: &str,
    agent: &str,
    resume: Option<u64>,
) -> Result<(iroh::endpoint::SendStream, iroh::endpoint::RecvStream), String> {
    let (mut send, mut recv) =
        connection.open_bi().await.map_err(|error| format!("open stream: {error}"))?;
    let request = Request::Connect {
        v: PROTOCOL_VERSION,
        token: token.to_string(),
        agent: agent.to_string(),
        resume: resume.map(|last_seq| Resume { last_seq }),
    };
    let payload = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
    write_frame(&mut send, &payload).await.map_err(|error| format!("write: {error}"))?;
    let response =
        read_frame(&mut recv).await.map_err(|error| format!("read response: {error}"))?;
    let text = String::from_utf8_lossy(&response).into_owned();
    println!("{text}");
    let parsed: Value =
        serde_json::from_str(&text).map_err(|error| format!("invalid connect response: {error}"))?;
    if parsed.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(format!("connect rejected: {text}"));
    }
    Ok((send, recv))
}

async fn run_simple(options: ClientOptions, action: ClientAction) -> Result<(), String> {
    let token = options.token.clone().unwrap_or_else(|| DEFAULT_CLIENT_TOKEN.into());
    let (_endpoint, connection) = dial(&options).await?;
    match action {
        ClientAction::Connect { agent, resume } => {
            let (mut send, mut recv) = connect_frame(&connection, &token, &agent, resume).await?;
            pipe_stdin(&mut send, &mut recv).await;
            let _ = send.finish();
            Ok(())
        }
        ClientAction::ListAgents | ClientAction::RestartAgent { .. } => {
            let request = match &action {
                ClientAction::ListAgents => Request::ListAgents {
                    v: PROTOCOL_VERSION,
                    token,
                },
                ClientAction::RestartAgent { agent } => Request::RestartAgent {
                    v: PROTOCOL_VERSION,
                    token,
                    agent: agent.clone(),
                },
                _ => unreachable!("handled above"),
            };
            let (mut send, mut recv) =
                connection.open_bi().await.map_err(|error| format!("open stream: {error}"))?;
            let payload = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
            write_frame(&mut send, &payload)
                .await
                .map_err(|error| format!("write: {error}"))?;
            let response =
                read_frame(&mut recv).await.map_err(|error| format!("read response: {error}"))?;
            let text = String::from_utf8_lossy(&response).into_owned();
            println!("{text}");
            let _ = send.finish();
            let parsed: Value = serde_json::from_str(&text)
                .map_err(|error| format!("invalid response: {error}"))?;
            if parsed.get("ok").and_then(Value::as_bool) == Some(true) {
                Ok(())
            } else {
                Err(format!("request failed: {text}"))
            }
        }
        ClientAction::RunTurn { .. }
        | ClientAction::ThreadPages { .. }
        | ClientAction::SearchExec { .. } => unreachable!("handled above"),
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_turn(
    options: ClientOptions,
    agent: String,
    text: String,
    resume: bool,
    expect_fragment: Option<String>,
    interrupt: bool,
    image_data_url: Option<String>,
    verify_image_input: bool,
) -> Result<(), String> {
    let token = options.token.clone().unwrap_or_else(|| DEFAULT_CLIENT_TOKEN.into());
    if resume {
        let (_endpoint, connection) = dial(&options).await?;
        let (mut send, recv) = connect_frame(&connection, &token, &agent, None).await?;
        let _ = send.finish();
        drop((send, recv, connection));
    }
    let (_endpoint, connection) = dial(&options).await?;
    let (mut send, mut recv) = connect_frame(&connection, &token, &agent, None).await?;
    let mut reader = LineReader::new();
    let mut next_id = 1u64;
    let initialize = json!({
        "jsonrpc": "2.0",
        "id": next_id,
        "method": "initialize",
        "params": {
            "clientInfo": {
                "name": "alleycat-host-client",
                "version": env!("CARGO_PKG_VERSION"),
            },
        },
    });
    let (initialize_response, _) =
        exchange(&mut send, &mut recv, &mut reader, &initialize).await?;
    if initialize_response.get("method").and_then(Value::as_str) == Some("turn/completed") {
        return Err("unexpected turn/completed before turn/start".into());
    }
    let reply = json!({"jsonrpc": "2.0", "method": "initialized"});
    write_jsonl(&mut send, &reply).await?;
    next_id += 1;
    let cwd = std::env::current_dir()
        .map_err(|error| format!("cwd: {error}"))?
        .to_string_lossy()
        .into_owned();
    let thread_start =
        json!({"jsonrpc": "2.0", "id": next_id, "method": "thread/start", "params": {"cwd": cwd}});
    let (thread_response, _) = exchange(&mut send, &mut recv, &mut reader, &thread_start).await?;
    if thread_response.get("method").and_then(Value::as_str) == Some("turn/completed") {
        return Err("unexpected turn/completed before turn/start".into());
    }
    let thread_id = thread_response
        .pointer("/result/thread/id")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("thread/start missing result.thread.id: {thread_response}"))?
        .to_string();
    next_id += 1;
    let mut input = vec![json!({"type": "text", "text": text})];
    if let Some(image_url) = &image_data_url {
        input.push(json!({"type": "image", "url": image_url}));
    }
    let turn_start = json!({
        "jsonrpc": "2.0",
        "id": next_id,
        "method": "turn/start",
        "params": {"threadId": thread_id, "input": input},
    });
    let (turn_response, mut collected) =
        exchange(&mut send, &mut recv, &mut reader, &turn_start).await?;
    let mut completed =
        turn_response.get("method").and_then(Value::as_str) == Some("turn/completed");
    let turn_id = if completed {
        None
    } else {
        Some(
            turn_response
                .pointer("/result/turn/id")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    format!("turn/start missing result.turn.id: {turn_response}")
                })?
                .to_string(),
        )
    };
    if interrupt && !completed {
        let turn_id = turn_id.expect("turn id present before completion");
        next_id += 1;
        let turn_interrupt = json!({
            "jsonrpc": "2.0",
            "id": next_id,
            "method": "turn/interrupt",
            "params": {"threadId": thread_id, "turnId": turn_id},
        });
        let (response, more) =
            exchange(&mut send, &mut recv, &mut reader, &turn_interrupt).await?;
        collected.push_str(&more);
        completed =
            response.get("method").and_then(Value::as_str) == Some("turn/completed");
    }
    while !completed {
        let line = tokio::time::timeout(TURN_STALL_TIMEOUT, reader.next_line(&mut recv))
            .await
            .map_err(|_| "timed out waiting for app-server frames".to_string())?
            .ok_or("bridge stream closed before turn/completed")?;
        let frame: Value = serde_json::from_slice(&line)
            .map_err(|error| format!("invalid app-server frame: {error}"))?;
        println!("{}", String::from_utf8_lossy(&line));
        collect_message_text(&frame, &mut collected);
        if frame.get("method").and_then(Value::as_str) == Some("turn/completed") {
            break;
        }
        if let Some(error) = frame.pointer("/params/error") {
            return Err(format!("app-server error frame: {error}"));
        }
    }
    if verify_image_input {
        next_id += 1;
        let turns_request = json!({
            "jsonrpc": "2.0",
            "id": next_id,
            "method": "thread/turns/list",
            "params": {"threadId": thread_id, "limit": 10},
        });
        let (turns_response, _) = exchange(&mut send, &mut recv, &mut reader, &turns_request).await?;
        if !hydrates_image_input(&turns_response) {
            return Err("thread/turns/list hydration carries no image input item".into());
        }
        println!("== image input frame verified in thread/turns/list");
    }
    let _ = send.finish();
    if let Some(fragment) = &expect_fragment {
        if !collected.contains(fragment.as_str()) {
            return Err(format!(
                "fragment {fragment:?} not found in agent message text: {collected:?}"
            ));
        }
    }
    Ok(())
}

fn hydrates_image_input(response: &Value) -> bool {
    response
        .pointer("/result/data")
        .and_then(Value::as_array)
        .map(|turns| {
            turns.iter().any(|turn| {
                turn.get("items")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items.iter().any(|item| {
                            item.get("type").and_then(Value::as_str) == Some("userMessage")
                                && item
                                    .get("content")
                                    .and_then(Value::as_array)
                                    .map(|content| {
                                        content
                                            .iter()
                                            .any(|part| {
                                                part.get("type").and_then(Value::as_str)
                                                    == Some("image")
                                            })
                                    })
                                    .unwrap_or(false)
                        })
                    })
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

async fn boot_session(
    send: &mut iroh::endpoint::SendStream,
    recv: &mut iroh::endpoint::RecvStream,
    reader: &mut LineReader,
) -> Result<(), String> {
    let initialize = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "clientInfo": {
                "name": "alleycat-host-client",
                "version": env!("CARGO_PKG_VERSION"),
            },
        },
    });
    let (response, _) = exchange(send, recv, reader, &initialize).await?;
    if response.get("method").and_then(Value::as_str) == Some("turn/completed") {
        return Err("unexpected turn/completed before initialize".into());
    }
    let reply = json!({"jsonrpc": "2.0", "method": "initialized"});
    write_jsonl(send, &reply).await
}

async fn run_threads(options: ClientOptions, limit: u32) -> Result<(), String> {
    let token = options.token.clone().unwrap_or_else(|| DEFAULT_CLIENT_TOKEN.into());
    let (_endpoint, connection) = dial(&options).await?;
    let (mut send, mut recv) = connect_frame(&connection, &token, "eukhe", None).await?;
    let mut reader = LineReader::new();
    boot_session(&mut send, &mut recv, &mut reader).await?;
    let mut next_id = 2u64;
    let list_request = json!({
        "jsonrpc": "2.0",
        "id": next_id,
        "method": "thread/list",
        "params": {"limit": limit},
    });
    let (list_response, _) = exchange(&mut send, &mut recv, &mut reader, &list_request).await?;
    let page = list_response
        .pointer("/result/data")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("thread/list returned no data array: {list_response}"))?;
    if page.is_empty() {
        return Err("thread/list page is empty; run a turn first".into());
    }
    println!(
        "== thread/list page 1: {} thread(s), nextCursor: {}",
        page.len(),
        list_response
            .pointer("/result/nextCursor")
            .map(|cursor| cursor.to_string())
            .unwrap_or_else(|| "null".into())
    );
    let thread_id = page[0]
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("thread/list entry missing id: {:#}", page[0]))?
        .to_string();
    if let Some(cursor) = list_response.pointer("/result/nextCursor").and_then(Value::as_str) {
        next_id += 1;
        let more_request = json!({
            "jsonrpc": "2.0",
            "id": next_id,
            "method": "thread/list",
            "params": {"limit": limit, "cursor": cursor},
        });
        let (more_response, _) = exchange(&mut send, &mut recv, &mut reader, &more_request).await?;
        let more = more_response
            .pointer("/result/data")
            .and_then(Value::as_array)
            .ok_or_else(|| format!("thread/list cursor page returned no data: {more_response}"))?;
        if more.is_empty() {
            return Err("thread/list cursor page is empty".into());
        }
        println!("== thread/list cursor page: {} thread(s)", more.len());
    }
    next_id += 1;
    let read_request = json!({
        "jsonrpc": "2.0",
        "id": next_id,
        "method": "thread/read",
        "params": {"threadId": thread_id},
    });
    let (read_response, _) = exchange(&mut send, &mut recv, &mut reader, &read_request).await?;
    let read_id = read_response
        .pointer("/result/thread/id")
        .and_then(Value::as_str)
        .ok_or_else(|| format!("thread/read returned no thread id: {read_response}"))?;
    if read_id != thread_id {
        return Err(format!("thread/read returned {read_id}, expected {thread_id}"));
    }
    println!("== thread/read ok for {thread_id}");
    next_id += 1;
    let turns_probe_request = json!({
        "jsonrpc": "2.0",
        "id": next_id,
        "method": "thread/turns/list",
        "params": {"threadId": thread_id, "limit": 5, "itemsView": "notLoaded"},
    });
    let (turns_probe, _) =
        exchange(&mut send, &mut recv, &mut reader, &turns_probe_request).await?;
    let probe_turns = turns_probe
        .pointer("/result/data")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("thread/turns/list returned no data: {turns_probe}"))?;
    if probe_turns.is_empty() {
        return Err("thread/turns/list notLoaded probe returned no turns".into());
    }
    for turn in probe_turns {
        if turn.get("itemsView").and_then(Value::as_str) != Some("notLoaded") {
            return Err(format!("notLoaded probe returned itemsView: {turn}"));
        }
        if turn.get("items").and_then(Value::as_array).map(Vec::is_empty) != Some(true) {
            return Err(format!("notLoaded probe returned non-empty items: {turn}"));
        }
    }
    println!("== thread/turns/list notLoaded probe ok ({} turn(s))", probe_turns.len());
    next_id += 1;
    let turns_request = json!({
        "jsonrpc": "2.0",
        "id": next_id,
        "method": "thread/turns/list",
        "params": {"threadId": thread_id, "limit": 5},
    });
    let (turns_response, _) = exchange(&mut send, &mut recv, &mut reader, &turns_request).await?;
    let turns = turns_response
        .pointer("/result/data")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("thread/turns/list returned no data: {turns_response}"))?;
    if turns.is_empty() {
        return Err("thread/turns/list returned no turns for a thread with history".into());
    }
    println!("== thread/turns/list ok ({} turn(s))", turns.len());
    let _ = send.finish();
    Ok(())
}

async fn run_search_exec(
    options: ClientOptions,
    query: String,
    expect_hit: String,
    exec_shell: String,
    exec_stdout_fragment: String,
) -> Result<(), String> {
    let token = options.token.clone().unwrap_or_else(|| DEFAULT_CLIENT_TOKEN.into());
    let cwd = std::env::current_dir()
        .map_err(|error| format!("cwd: {error}"))?
        .to_string_lossy()
        .into_owned();
    let (_endpoint, connection) = dial(&options).await?;
    let (mut send, mut recv) = connect_frame(&connection, &token, "eukhe", None).await?;
    let mut reader = LineReader::new();
    boot_session(&mut send, &mut recv, &mut reader).await?;
    let mut next_id = 2u64;
    let search_request = json!({
        "jsonrpc": "2.0",
        "id": next_id,
        "method": "fuzzyFileSearch",
        "params": {"query": query, "roots": [cwd]},
    });
    let (search_response, _) =
        exchange(&mut send, &mut recv, &mut reader, &search_request).await?;
    let files = search_response
        .pointer("/result/files")
        .and_then(Value::as_array)
        .ok_or_else(|| format!("fuzzyFileSearch returned no files: {search_response}"))?;
    let hit = files.iter().any(|file| {
        file.get("file_name")
            .and_then(Value::as_str)
            .map(|name| name.contains(&expect_hit))
            .unwrap_or(false)
    });
    if !hit {
        return Err(format!(
            "fuzzyFileSearch found no file_name containing {expect_hit:?} in {} result(s)",
            files.len()
        ));
    }
    println!("== fuzzyFileSearch hit for {query:?}");
    next_id += 1;
    let exec_request = json!({
        "jsonrpc": "2.0",
        "id": next_id,
        "method": "command/exec",
        "params": {
            "command": ["/bin/sh", "-c", exec_shell],
            "cwd": cwd,
            "timeoutMs": 15_000,
            "outputBytesCap": 65_536,
        },
    });
    let (exec_response, _) = exchange(&mut send, &mut recv, &mut reader, &exec_request).await?;
    let exit_code = exec_response
        .pointer("/result/exitCode")
        .and_then(Value::as_i64)
        .ok_or_else(|| format!("command/exec returned no exitCode: {exec_response}"))?;
    if exit_code != 0 {
        return Err(format!("command/exec exited {exit_code}: {exec_response}"));
    }
    let stdout = exec_response
        .pointer("/result/stdout")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !stdout.contains(&exec_stdout_fragment) {
        return Err(format!(
            "command/exec stdout missing {exec_stdout_fragment:?}: {stdout:?}"
        ));
    }
    println!("== command/exec ok: {stdout:?}");
    let _ = send.finish();
    Ok(())
}

async fn write_jsonl(
    send: &mut iroh::endpoint::SendStream,
    frame: &Value,
) -> Result<(), String> {
    let mut line = serde_json::to_vec(frame).map_err(|error| error.to_string())?;
    line.push(b'\n');
    send.write_all(&line).await.map_err(|error| format!("write: {error}"))
}

async fn read_jsonl(
    recv: &mut iroh::endpoint::RecvStream,
    reader: &mut LineReader,
) -> Result<Value, String> {
    let line = tokio::time::timeout(TURN_STALL_TIMEOUT, reader.next_line(recv))
        .await
        .map_err(|_| "timed out waiting for app-server frame".to_string())?
        .ok_or("bridge stream closed before reply")?;
    let frame: Value = serde_json::from_slice(&line)
        .map_err(|error| format!("invalid app-server frame: {error}"))?;
    println!("{}", String::from_utf8_lossy(&line));
    Ok(frame)
}

async fn exchange(
    send: &mut iroh::endpoint::SendStream,
    recv: &mut iroh::endpoint::RecvStream,
    reader: &mut LineReader,
    request: &Value,
) -> Result<(Value, String), String> {
    let id = request.get("id").cloned();
    write_jsonl(send, request).await?;
    let mut collected = String::new();
    loop {
        let response = read_jsonl(recv, reader).await?;
        collect_message_text(&response, &mut collected);
        if response.get("method").and_then(Value::as_str) == Some("turn/completed") {
            return Ok((response, collected));
        }
        if response.get("id") != id.as_ref() {
            continue;
        }
        if response.get("error").is_some() {
            return Err(format!("request failed: {response}"));
        }
        return Ok((response, collected));
    }
}

fn collect_message_text(frame: &Value, collected: &mut String) {
    let Some(method) = frame.get("method").and_then(Value::as_str) else { return };
    let Some(params) = frame.get("params") else { return };
    if method == "item/agentMessage/delta" {
        if let Some(delta) = params.get("delta").and_then(Value::as_str) {
            collected.push_str(delta);
        }
    }
    if method == "item/completed" {
        if let Some(item) = params.get("item") {
            if item.get("type").and_then(Value::as_str) == Some("agentMessage") {
                if let Some(text) = item.get("text").and_then(Value::as_str) {
                    collected.push_str(text);
                }
            }
        }
    }
}

async fn pipe_stdin(send: &mut iroh::endpoint::SendStream, recv: &mut iroh::endpoint::RecvStream) {
    let (lines_tx, mut lines_rx) = mpsc::channel::<String>(16);
    let stdin_task = tokio::spawn(async move {
        let mut stdin = tokio::io::BufReader::new(tokio::io::stdin());
        let mut line = String::new();
        loop {
            line.clear();
            match stdin.read_line(&mut line).await {
                Ok(0) | Err(_) => return,
                Ok(_) => {
                    if lines_tx.send(line.trim_end_matches(['\n', '\r']).to_string()).await.is_err()
                    {
                        return;
                    }
                }
            }
        }
    });
    let mut line_reader = LineReader::new();
    let mut stdin_open = true;
    loop {
        tokio::select! {
            line = lines_rx.recv(), if stdin_open => match line {
                Some(line) => {
                    let mut frame = line.into_bytes();
                    frame.push(b'\n');
                    if send.write_all(&frame).await.is_err() {
                        break;
                    }
                }
                None => {
                    stdin_open = false;
                    let _ = send.finish();
                }
            },
            incoming = line_reader.next_line(recv) => match incoming {
                Some(line) => println!("{}", String::from_utf8_lossy(&line)),
                None => break,
            },
        }
    }
    stdin_task.abort();
    let _ = send.finish();
}
