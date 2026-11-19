use std::path::{Path, PathBuf};
use std::process::ExitCode;

use local_studio_core::plugins::{self, Capability, Catalog, Consent, Grants, Plugin, Source};

const USAGE: &str = "usage: local-studio plugin validate <dir>
       local-studio plugin list
       local-studio plugin install <dir | catalog id | git url@full sha>
       local-studio plugin grant <id> <capability...>
       local-studio plugin revoke <id> [capability...]
       local-studio plugin capabilities
       local-studio plugin hash <dir> [excluded path...]";

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
