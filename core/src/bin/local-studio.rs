use std::path::{Path, PathBuf};
use std::process::ExitCode;

use local_studio_core::plugins::{self, Capability, Catalog, Consent, Grants, Plugin, Source};
use local_studio_core::tunnel::{self, Ports, Status, Tunnel};

const USAGE: &str = "usage: local-studio plugin validate <dir>
       local-studio plugin list
       local-studio plugin install <dir | catalog id | git url@full sha>
       local-studio plugin grant <id> <capability...>
       local-studio plugin revoke <id> [capability...]
       local-studio plugin capabilities
       local-studio plugin hash <dir> [excluded path...]
       local-studio tunnel status [--json]
       local-studio tunnel request [--serve <port>] [--mcp <port>]
       local-studio tunnel up | down | release
       local-studio tunnel byo";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let outcome = match args.as_slice() {
        ["plugin", "validate", dir] => validate(Path::new(dir)),
        ["plugin", "list"] => list(),
        ["plugin", "install", source] => install(source),
        ["plugin", "grant", id, names @ ..] if !names.is_empty() => grant(id, names),
        ["plugin", "revoke", id, names @ ..] => revoke(id, names),
        ["plugin", "capabilities"] => {
            for capability in Capability::ALL {
                println!("{}: {}", capability.name(), capability.description());
            }
            Ok(())
        }
        ["plugin", "hash", dir, exclude @ ..] => {
            let exclude: Vec<String> = exclude.iter().map(ToString::to_string).collect();
            plugins::tree_hash(Path::new(dir), &exclude).map(|tree| println!("{tree}"))
        }
        ["tunnel", "status"] => run_tunnel(|t| Box::pin(t.status()), false),
        ["tunnel", "status", "--json"] => run_tunnel(|t| Box::pin(t.status()), true),
        ["tunnel", "request", flags @ ..] => request_ports(flags).and_then(|ports| {
            run_tunnel(
                move |t| {
                    Box::pin(t.request(ports, option_env!("LOCAL_STUDIO_CHANNEL").unwrap_or("dev"), |url| {
                        println!("Open this address and sign in with GitHub: {url}");
                        let _ = std::io::Write::flush(&mut std::io::stdout());
                        open_browser(url);
                    }))
                },
                false,
            )
        }),
        ["tunnel", "up"] => {
            let cloudflared =
                std::env::var_os("LS_CLOUDFLARED").map_or_else(|| PathBuf::from("cloudflared"), PathBuf::from);
            run_tunnel(move |t| Box::pin(async move { t.up(&cloudflared).await }), false)
        }
        ["tunnel", "down"] => run_tunnel(|t| Box::pin(t.down()), false),
        ["tunnel", "release"] => run_tunnel(|t| Box::pin(t.release()), false),
        ["tunnel", "byo"] => byo(),
        _ => {
            eprintln!("{USAGE}");
            return ExitCode::from(2);
        }
    };
    match outcome {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            for line in error.lines() {
                println!("error: {line}");
            }
            ExitCode::FAILURE
        }
    }
}

fn root() -> Result<PathBuf, String> {
    plugins::plugins_dir(None).ok_or_else(|| "HOME is not set".to_string())
}

fn validate(dir: &Path) -> Result<(), String> {
    let plugin = plugins::load(dir).map_err(|errors| errors.join("\n"))?;
    println!(
        "OK {} {} ({} skills, {} prompts, {} commands)",
        plugin.id,
        plugin.version,
        plugin.skills.len(),
        plugin.prompts.len(),
        plugin.commands.len()
    );
    asks(&plugin);
    Ok(())
}

fn asks(plugin: &Plugin) {
    if plugin.capabilities.is_empty() {
        println!("  asks for no capabilities");
    }
    for capability in &plugin.capabilities {
        println!("  asks for {}: {}", capability.name(), capability.description());
    }
    if let Some(mcp) = &plugin.mcp {
        println!("  MCP server {}: {} {}", plugin.mcp_name(), mcp.command.display(), mcp.args.join(" "));
        for (name, host) in &mcp.env {
            println!("  MCP server reads {host} from your environment as {name}");
        }
    }
}

fn consent_line(plugin: &Plugin, grants: &Grants) -> String {
    match grants.consent(plugin) {
        Consent::Ready => "ready".to_string(),
        Consent::NeedsConsent { missing } => {
            let names: Vec<&str> = missing.iter().map(|capability| capability.name()).collect();
            format!(
                "needs consent for {} (local-studio plugin grant {} {})",
                names.join(", "),
                plugin.id,
                names.join(" ")
            )
        }
    }
}

fn sync(root: &Path) -> Result<(), String> {
    let Some(agent) = plugins::agent_dir() else { return Ok(()) };
    if plugins::sync_agent(root, &agent)? {
        println!("updated mcpServers in {}", agent.join("settings.json").display());
    }
    Ok(())
}

fn list() -> Result<(), String> {
    let root = root()?;
    println!("plugins dir: {}", root.display());
    let scan = plugins::scan(&root);
    let grants = Grants::load(&root)?;
    for plugin in &scan.plugins {
        println!("{} {}: {}", plugin.id, plugin.version, plugin.description);
        println!("  {}", consent_line(plugin, &grants));
        for skill in &plugin.skills {
            println!("  skill {} ({})", skill.name, plugin.source());
        }
        for prompt in &plugin.prompts {
            println!("  prompt {} ({})", prompt.name, plugin.source());
        }
        for capability in &plugin.capabilities {
            println!("  capability {}: {}", capability.name(), capability.description());
        }
    }
    for command in plugins::commands(&scan.plugins) {
        println!("command /{} ({}): {}", command.name, command.source, command.description);
    }
    for failure in &scan.failures {
        println!("failed {}:", failure.dir.display());
        for error in &failure.errors {
            println!("  error: {error}");
        }
    }
    if scan.failures.is_empty() {
        Ok(())
    } else {
        Err(format!("{} plugins failed to load", scan.failures.len()))
    }
}

fn install(arg: &str) -> Result<(), String> {
    let root = root()?;
    let source = Source::parse(arg)?;
    let catalog = Catalog::bundled()?;
    let installed = plugins::install(&root, &source, &catalog).map_err(|errors| {
        let mut lines = vec![format!("refused {arg}")];
        lines.extend(errors);
        lines.join("\n")
    })?;
    let plugin = &installed.plugin;
    match &installed.replaced {
        Some(old) => println!("installed {} {} over {old} into {}", plugin.id, plugin.version, plugin.dir.display()),
        None => println!("installed {} {} into {}", plugin.id, plugin.version, plugin.dir.display()),
    }
    println!("  {} files, tree {}", installed.files, installed.tree);
    asks(plugin);
    println!("  {}", consent_line(plugin, &Grants::load(&root)?));
    sync(&root)
}

fn installed(root: &Path, id: &str) -> Result<Plugin, String> {
    plugins::load(&root.join(id))
        .map_err(|errors| format!("{id} is not installed or does not load: {}", errors.join("; ")))
}

fn capabilities(names: &[&str]) -> Result<Vec<Capability>, String> {
    names.iter().map(|name| Capability::parse(name).ok_or_else(|| format!("unknown capability: {name}"))).collect()
}

fn grant(id: &str, names: &[&str]) -> Result<(), String> {
    let root = root()?;
    let plugin = installed(&root, id)?;
    let capabilities = capabilities(names)?;
    let mut grants = Grants::load(&root)?;
    grants.grant(&plugin, &capabilities)?;
    grants.save(&root)?;
    println!("{} {}: {}", plugin.id, plugin.version, consent_line(&plugin, &grants));
    sync(&root)
}

fn revoke(id: &str, names: &[&str]) -> Result<(), String> {
    let root = root()?;
    let capabilities = capabilities(names)?;
    let mut grants = Grants::load(&root)?;
    if !grants.revoke(id, &capabilities) {
        println!("{id}: nothing to revoke");
        return Ok(());
    }
    grants.save(&root)?;
    match installed(&root, id) {
        Ok(plugin) => println!("{} {}: {}", plugin.id, plugin.version, consent_line(&plugin, &grants)),
        Err(_) => println!("{id}: grants revoked"),
    }
    sync(&root)
}

type TunnelCall<'a> = std::pin::Pin<Box<dyn std::future::Future<Output = Result<Status, String>> + 'a>>;

fn run_tunnel(call: impl for<'a> FnOnce(&'a Tunnel) -> TunnelCall<'a>, as_json: bool) -> Result<(), String> {
    let tunnel = Tunnel::open(None)?;
    let runtime =
        tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|error| error.to_string())?;
    let status = runtime.block_on(call(&tunnel))?;
    if as_json {
        println!("{}", serde_json::to_string_pretty(&status).map_err(|error| error.to_string())?);
        return Ok(());
    }
    println!("{}: {}", status.state, status.message);
    if let Some(position) = status.position {
        println!("  place in line: {position}");
    }
    if let Some(mcp) = &status.mcp_url {
        println!("  MCP address: {mcp}");
    }
    if let Some(ws) = &status.ws_url {
        println!("  phone address: {ws}");
    }
    if let Some(at) = &status.release_at {
        println!("  released on {at} if left down");
    }
    Ok(())
}

fn request_ports(flags: &[&str]) -> Result<Ports, String> {
    let usage = "usage: local-studio tunnel request [--serve <port>] [--mcp <port>]";
    let mut ports = tunnel::DEFAULT_PORTS;
    let mut rest = flags.iter();
    while let Some(flag) = rest.next() {
        let value: u16 = rest.next().and_then(|value| value.parse().ok()).ok_or(usage)?;
        match *flag {
            "--serve" => ports.serve = value,
            "--mcp" => ports.mcp = value,
            _ => return Err(usage.to_string()),
        }
    }
    Ok(ports)
}

fn open_browser(url: &str) {
    if std::env::var_os("LS_TUNNEL_NO_BROWSER").is_some() {
        return;
    }
    let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    let _ = std::process::Command::new(opener)
        .arg(url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
}

fn byo() -> Result<(), String> {
    match std::process::Command::new("tychicus").args(["remote", "setup"]).status() {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!("tychicus remote setup exited with {status}")),
        Err(_) => Err("Install the Tychicus plugin, then run: tychicus remote setup".to_string()),
    }
}
