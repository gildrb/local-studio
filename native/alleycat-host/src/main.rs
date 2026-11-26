mod bridge;
mod client;
mod host;
mod keys;
mod wire;

use bridge::Bridge;
use client::{ClientAction, ClientOptions};
use host::AlleycatHandler;
use iroh::Endpoint;
use iroh::endpoint::presets;
use iroh::protocol::Router;
use std::path::PathBuf;
use std::process::ExitCode;

const USAGE: &str = "usage:
  alleycat-host serve [--pipe-url <url>] [--pipe-token <token>] [--key-file <path>] [--relay <url>]
  alleycat-host client --node-id <hex> [--relay <url>] [--token <token>] <list-agents | restart-agent --agent <name> | connect --agent <name> [--resume-seq <seq>] | run-turn --text <text> [--agent <name>] [--resume] [--expect-fragment <s>] [--interrupt]>";

struct ServeOptions {
    pipe_url: Option<String>,
    pipe_token: Option<String>,
    key_file: Option<PathBuf>,
    relay: Option<String>,
}

impl Default for ServeOptions {
    fn default() -> Self {
        Self {
            pipe_url: None,
            pipe_token: None,
            key_file: None,
            relay: None,
        }
    }
}

enum Command {
    Serve(ServeOptions),
    Client {
        options: ClientOptions,
        action: ClientAction,
    },
    Help,
}

#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = match parse_command(&args) {
        Ok(command) => command,
        Err(error) => {
            eprintln!("{error}\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    let result = match command {
        Command::Help => {
            println!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Command::Serve(options) => run_serve(options).await,
        Command::Client { options, action } => client::run(options, action).await,
    };
    if let Err(error) = result {
        eprintln!("{error}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

fn parse_command(args: &[String]) -> Result<Command, String> {
    let Some(first) = args.first() else { return Err("missing subcommand".into()) };
    match first.as_str() {
        "serve" => parse_serve(&args[1..]),
        "client" => parse_client(&args[1..]),
        "--help" | "-h" | "help" => Ok(Command::Help),
        other => Err(format!("unknown subcommand {other:?}")),
    }
}

fn take_value<'a>(args: &'a [String], index: &mut usize, flag: &str) -> Result<&'a str, String> {
    *index += 1;
    args.get(*index).map(String::as_str).ok_or_else(|| format!("missing value for {flag}"))
}

fn parse_serve(args: &[String]) -> Result<Command, String> {
    let mut options = ServeOptions::default();
    let mut index = 0;
    while index < args.len() {
        let flag = args[index].as_str();
        match flag {
            "--pipe-url" => options.pipe_url = Some(take_value(args, &mut index, flag)?.into()),
            "--pipe-token" => options.pipe_token = Some(take_value(args, &mut index, flag)?.into()),
            "--key-file" => options.key_file = Some(take_value(args, &mut index, flag)?.into()),
            "--relay" => options.relay = Some(take_value(args, &mut index, flag)?.into()),
            other => return Err(format!("unknown serve flag {other:?}")),
        }
        index += 1;
    }
    Ok(Command::Serve(options))
}

fn parse_client(args: &[String]) -> Result<Command, String> {
    let mut node_id = None;
    let mut relay = None;
    let mut token = None;
    let mut index = 0;
    while let Some(flag) = args.get(index).map(String::as_str) {
        match flag {
            "--node-id" => node_id = Some(take_value(args, &mut index, flag)?.into()),
            "--relay" => relay = Some(take_value(args, &mut index, flag)?.into()),
            "--token" => token = Some(take_value(args, &mut index, flag)?.into()),
            _ => break,
        }
        index += 1;
    }
    let node_id = node_id.ok_or("client requires --node-id <hex>")?;
    let Some(action) = args.get(index).map(String::as_str) else {
        return Err("missing client action".into());
    };
    index += 1;
    let mut agent = None;
    let mut resume = None;
    let mut run_turn_text = None;
    let mut run_turn_resume = false;
    let mut run_turn_fragment = None;
    let mut run_turn_interrupt = false;
    while index < args.len() {
        let flag = args[index].as_str();
        match flag {
            "--agent" => agent = Some(take_value(args, &mut index, flag)?.into()),
            "--resume-seq" => {
                let value = take_value(args, &mut index, flag)?;
                resume =
                    Some(value.parse::<u64>().map_err(|error| format!("--resume-seq: {error}"))?);
            }
            "--text" => run_turn_text = Some(take_value(args, &mut index, flag)?.into()),
            "--resume" => run_turn_resume = true,
            "--expect-fragment" => {
                run_turn_fragment = Some(take_value(args, &mut index, flag)?.into())
            }
            "--interrupt" => run_turn_interrupt = true,
            other => return Err(format!("unknown client flag {other:?}")),
        }
        index += 1;
    }
    let client_options = ClientOptions { node_id, relay, token };
    let action = match action {
        "list-agents" => ClientAction::ListAgents,
        "restart-agent" => ClientAction::RestartAgent {
            agent: agent.ok_or("restart-agent requires --agent <name>")?,
        },
        "connect" => ClientAction::Connect {
            agent: agent.ok_or("connect requires --agent <name>")?,
            resume,
        },
        "run-turn" => {
            let text = run_turn_text.ok_or("run-turn requires --text <text>")?;
            ClientAction::RunTurn {
                agent: agent.unwrap_or_else(|| "main".into()),
                text,
                resume: run_turn_resume,
                expect_fragment: run_turn_fragment,
                interrupt: run_turn_interrupt,
            }
        }
        other => return Err(format!("unknown client action {other:?}")),
    };
    Ok(Command::Client { options: client_options, action })
}

async fn run_serve(options: ServeOptions) -> Result<(), String> {
    let key_file = options
        .key_file
        .or_else(|| std::env::var("KEY_FILE").ok().map(PathBuf::from))
        .ok_or("serve requires --key-file or KEY_FILE")?;
    let pipe_url = options.pipe_url.or_else(|| std::env::var("PIPE_URL").ok());
    let pipe_token = options.pipe_token.or_else(|| std::env::var("PIPE_TOKEN").ok());
    let relay = options.relay.or_else(|| std::env::var("RELAY").ok());
    let pipe_url = pipe_url.ok_or("serve requires --pipe-url or PIPE_URL")?;
    let pipe_token = pipe_token.ok_or("serve requires --pipe-token or PIPE_TOKEN")?;
    let key = keys::load_or_create(&key_file)
        .map_err(|error| format!("key file {key_file:?}: {error}"))?;
    let bridge = Bridge::Pipe(bridge::PipeBridge::spawn(pipe_url, pipe_token));
    let endpoint = Endpoint::builder(presets::N0)
        .secret_key(key)
        .bind()
        .await
        .map_err(|error| format!("endpoint bind: {error}"))?;
    println!("alleycat-host node_id {}", wire::hex_encode(endpoint.id().as_bytes()));
    if let Some(relay) = relay {
        eprintln!("relay stored for later (unused in v1): {relay}");
    }
    let router = Router::builder(endpoint.clone())
        .accept(wire::ALPN, AlleycatHandler::new(bridge))
        .spawn();
    tokio::signal::ctrl_c().await.map_err(|error| format!("signal: {error}"))?;
    router.shutdown().await.map_err(|error| format!("router shutdown: {error}"))?;
    Ok(())
}
