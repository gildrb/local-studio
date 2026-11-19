use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::time::{Duration, Instant};

use anyhow::{bail, ensure, Context};
use eukhe_client::daemon_client::DaemonClient;
use eukhe_types::daemon::DaemonCommand;
use local_studio_core::plugins::{self as plugin_store, Catalog, Consent, Source};
use local_studio_core::{
    AccessMode, CommandKind, Connection, DaemonLaunch, Item, ItemKind, Project, PromptDraft, SkillEntry, SlashCommand,
    Studio, StudioConfig, ThreadRow, ThreadSettings, ThreadStatus, ToolState, TranscriptOp, Update, Waker,
    WorktreeChoice,
};
use serde_json::{json, Map, Value};

const PROVIDER: &str = "local-fleet";
const MID: &str = "hf.co/LiquidAI/LFM2.5-8B-A1B-GGUF:Q4_K_M";
const SMALL: &str = "hf.co/LiquidAI/LFM3-1.7B-GGUF:Q4_K_M";
const MAX_TOKENS: u64 = 16_384;
const STEP: Duration = Duration::from_secs(120);
const BUILD: Duration = Duration::from_mins(25);
const REQUEST: &str = "a fan guard for a 40 mm fan. Run the stone commands with the bash tool in the current directory and stop when stone says the part is ready.";

struct Target {
    id: String,
    command: String,
    model: String,
}

impl Target {
    fn from_env() -> Self {
        let var = |name: &str, default: &str| {
            std::env::var(name).ok().filter(|value| !value.is_empty()).unwrap_or_else(|| default.to_string())
        };
        Self {
            id: var("PLUGIN_SMOKE_ID", "smoothstone"),
            command: var("PLUGIN_SMOKE_COMMAND", "stone"),
            model: var("PLUGIN_SMOKE_MODEL", MID),
        }
    }

    fn source(&self) -> String {
        format!("plugin:{}", self.id)
    }
}

#[derive(Default)]
struct Signal {
    pending: Mutex<bool>,
    ready: Condvar,
}

impl Waker for Signal {
    fn wake(&self) {
        *self.pending.lock().unwrap_or_else(PoisonError::into_inner) = true;
        self.ready.notify_one();
    }
}

impl Signal {
    fn wait(&self, timeout: Duration) {
        let pending = self.pending.lock().unwrap_or_else(PoisonError::into_inner);
        let (mut pending, _) = self
            .ready
            .wait_timeout_while(pending, timeout, |pending| !*pending)
            .unwrap_or_else(PoisonError::into_inner);
        *pending = false;
    }
}

#[derive(Default)]
struct View {
    connection: Option<Connection>,
    projects: Vec<Project>,
    threads: Vec<ThreadRow>,
    started: Vec<(String, String)>,
    transcripts: Vec<(String, Vec<Item>)>,
    notices: Vec<String>,
    commands: Option<(String, Vec<SlashCommand>)>,
    skills: Option<Vec<SkillEntry>>,
}

impl View {
    fn thread(&self, draft: &str) -> Option<String> {
        self.started.iter().find(|(key, _)| key == draft).map(|(_, thread)| thread.clone())
    }

    fn items(&self, thread: &str) -> &[Item] {
        self.transcripts.iter().find(|(key, _)| key == thread).map_or(&[], |(_, items)| items.as_slice())
    }

    fn idle(&self, thread: &str) -> bool {
        self.threads
            .iter()
            .find(|row| row.id == thread)
            .is_some_and(|row| !matches!(row.status, ThreadStatus::Working | ThreadStatus::Approval))
    }

    fn commands(&self, request: &str) -> Option<&[SlashCommand]> {
        self.commands.as_ref().filter(|(key, _)| key == request).map(|(_, commands)| commands.as_slice())
    }
}

struct Harness {
    studio: Arc<Studio>,
    signal: Arc<Signal>,
    view: View,
}

impl Harness {
    fn pump_until(&mut self, step: &str, limit: Duration, done: impl Fn(&View) -> bool) -> anyhow::Result<()> {
        let deadline = Instant::now() + limit;
        loop {
            for update in self.studio.tick() {
                self.apply(update)?;
            }
            if done(&self.view) {
                println!("ok   {step}");
                return Ok(());
            }
            let Some(left) = deadline.checked_duration_since(Instant::now()) else {
                bail!("timed out waiting for: {step}");
            };
            self.signal.wait(left.min(Duration::from_millis(500)));
        }
    }

    fn apply(&mut self, update: Update) -> anyhow::Result<()> {
        match update {
            Update::Connection { state } => self.view.connection = Some(state),
            Update::Projects { projects } => self.view.projects = projects,
            Update::Threads { threads } => self.view.threads = threads,
            Update::ThreadStarted { draft, thread } => self.view.started.push((draft, thread)),
            Update::Notice { level, text } => {
                println!("     notice {level:?}: {text}");
                self.view.notices.push(text);
            }
            Update::RequestFailed { request, message } => println!("     request {request} failed: {message}"),
            Update::Commands { request, commands } => self.view.commands = Some((request, commands)),
            Update::Skills { skills, .. } => self.view.skills = Some(skills),
            Update::Transcript { thread, op } => self.transcript(&thread, op)?,
            _ => {}
        }
        Ok(())
    }

    fn transcript(&mut self, thread: &str, op: TranscriptOp) -> anyhow::Result<()> {
        if !self.view.transcripts.iter().any(|(key, _)| key == thread) {
            self.view.transcripts.push((thread.to_string(), Vec::new()));
        }
        let items = &mut self.view.transcripts.iter_mut().find(|(key, _)| key == thread).context("transcript")?.1;
        match op {
            TranscriptOp::Reset { items: fresh } => *items = fresh,
            TranscriptOp::Insert { index, item } => {
                let index = usize::try_from(index)?;
                ensure!(index <= items.len(), "insert at {index} past {} items", items.len());
                items.insert(index, item);
            }
            TranscriptOp::Update { index, item } => {
                let index = usize::try_from(index)?;
                *items.get_mut(index).context("update past the end")? = item;
            }
        }
        Ok(())
    }

    fn list_commands(&mut self, request: &str) -> anyhow::Result<Vec<SlashCommand>> {
        self.studio.list_commands(request.to_string(), None);
        self.pump_until(&format!("command list {request}"), STEP, |view| view.commands(request).is_some())?;
        Ok(self.view.commands(request).unwrap_or_default().to_vec())
    }
}

fn settings(model: &str) -> ThreadSettings {
    ThreadSettings {
        provider: Some(PROVIDER.to_string()),
        model: Some(model.to_string()),
        thinking_level: None,
        access: AccessMode::FullAccess,
        worktree: WorktreeChoice::Local,
    }
}

fn prompt(text: &str) -> PromptDraft {
    PromptDraft { text: text.to_string(), images: Vec::new(), files: Vec::new() }
}

fn user_text(items: &[Item]) -> Vec<String> {
    items
        .iter()
        .filter_map(|item| match &item.kind {
            ItemKind::User { text, .. } => Some(text.clone()),
            _ => None,
        })
        .collect()
}

fn stone_calls(items: &[Item]) -> usize {
    items
        .iter()
        .filter(|item| {
            matches!(&item.kind, ItemKind::Tool { state: ToolState::Succeeded | ToolState::Failed, output, .. } if output.contains("NEXT:"))
        })
        .count()
}

fn write_private(path: &Path, data: &[u8]) -> anyhow::Result<()> {
    let mut file = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?;
    file.write_all(data)?;
    Ok(())
}

fn agent_dir(root: &Path, models: &Path, model: &str) -> anyhow::Result<PathBuf> {
    let agent = root.join("agent");
    std::fs::create_dir_all(&agent)?;
    let mut catalog: Value = serde_json::from_slice(&std::fs::read(models)?)?;
    let provider = catalog
        .get_mut("providers")
        .and_then(|providers| providers.get_mut(PROVIDER))
        .with_context(|| format!("{} has no {PROVIDER} provider", models.display()))?
        .clone();
    let mut provider = provider;
    for model in provider.get_mut("models").and_then(Value::as_array_mut).context("models")? {
        model["maxTokens"] = json!(MAX_TOKENS);
    }
    let catalog = json!({ "providers": { PROVIDER: provider } });
    write_private(&agent.join("models.json"), &serde_json::to_vec_pretty(&catalog)?)?;
    write_private(
        &agent.join("settings.json"),
        &serde_json::to_vec_pretty(&json!({ "defaultProvider": PROVIDER, "defaultModel": model }))?,
    )?;
    write_private(&agent.join("auth.json"), b"{}")?;
    println!("     scratch agent dir {} with only {PROVIDER} (auth.json is {{}})", agent.display());
    Ok(agent)
}

fn copy_dir(from: &Path, to: &Path) -> anyhow::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn main() -> anyhow::Result<()> {
    let usage = "usage: [PLUGIN_SMOKE_ID=smoothstone PLUGIN_SMOKE_COMMAND=stone PLUGIN_SMOKE_MODEL=<model>] plugin_smoke <eukhe> <scratch dir> <models.json> <plugin dir | catalog id> | plugin_smoke --stop <socket>";
    let args: Vec<PathBuf> = std::env::args_os().skip(1).map(PathBuf::from).collect();
    if args.first().is_some_and(|arg| arg.as_os_str() == "--stop") {
        return stop_daemon(args.get(1).context(usage)?);
    }
    let [daemon, root, models, plugin] = args.as_slice() else { bail!(usage) };
    let target = Target::from_env();
    ensure!(
        target.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
        "PLUGIN_SMOKE_ID must be a plain plugin id, not a path: {:?}",
        target.id
    );
    let agent = agent_dir(root, models, &target.model)?;
    let data = root.join("data");
    let plugins = data.join("plugins");
    if plugin.is_dir() {
        copy_dir(plugin, &plugins.join(&target.id))?;
    } else {
        install_from_catalog(&plugins, &plugin.to_string_lossy(), &target)?;
    }
    std::fs::create_dir_all(plugins.join("broken"))?;
    std::fs::write(plugins.join("broken").join("plugin.toml"), "id = \"broken\"\nversion = 1\n")?;
    let work = root.join("work");
    std::fs::create_dir_all(&work)?;
    Command::new("git").args(["init", "-q", "-b", "main"]).current_dir(&work).status()?;
    std::env::set_var("LOCAL_STUDIO_DATA_DIR", &data);
    std::env::set_var("EUKHE_CODING_AGENT_DIR", &agent);
    let socket = root.join("d.sock");
    let config = StudioConfig {
        socket_path: Some(socket.to_string_lossy().into_owned()),
        session_dir: Some(agent.join("sessions").to_string_lossy().into_owned()),
        data_dir: None,
        controller_main: None,
        launch: Some(DaemonLaunch { program: daemon.to_string_lossy().into_owned() }),
    };
    let signal = Arc::new(Signal::default());
    let studio = Studio::new(config, Arc::clone(&signal) as Arc<dyn Waker>)?;
    let mut harness = Harness { studio, signal, view: View::default() };
    let outcome = drive(&mut harness, &work, &plugins, &target).and_then(|()| no_plugin_servers(&agent));
    harness.studio.shutdown();
    let stopped = stop_daemon(&socket);
    outcome?;
    stopped?;
    println!("PASS plugin smoke");
    Ok(())
}

fn install_from_catalog(plugins: &Path, id: &str, target: &Target) -> anyhow::Result<()> {
    ensure!(id == target.id, "catalog id {id} is not PLUGIN_SMOKE_ID {}", target.id);
    let catalog = Catalog::bundled().map_err(anyhow::Error::msg)?;
    let entry = catalog.entry(id).with_context(|| format!("{id} is not in the bundled catalog"))?;
    let installed = plugin_store::install(plugins, &Source::Catalog(id.to_string()), &catalog)
        .map_err(|errors| anyhow::anyhow!("catalog install refused: {}", errors.join("; ")))?;
    ensure!(installed.tree == entry.tree, "installed tree {} is not the pinned {}", installed.tree, entry.tree);
    ensure!(installed.plugin.dir == plugins.join(id), "installed into {}", installed.plugin.dir.display());
    ensure!(installed.consent == Consent::Ready, "{id} needs consent: {:?}", installed.consent);
    println!(
        "ok   check 1: {id} {} installed through the catalog at {} ({} files, {})",
        installed.plugin.version,
        &entry.rev[..12],
        installed.files,
        installed.tree
    );
    Ok(())
}

fn no_plugin_servers(agent: &Path) -> anyhow::Result<()> {
    let settings: Value = serde_json::from_slice(&std::fs::read(agent.join("settings.json"))?)?;
    let servers = settings.get("mcpServers").and_then(Value::as_object);
    ensure!(
        servers.is_none_or(|servers| !servers.keys().any(|name| name.starts_with(plugin_store::MCP_PREFIX))),
        "a plugin without the mcp-server capability got an mcpServers entry: {servers:?}"
    );
    println!("ok   no plugin MCP server registered for a plugin that asks for none");
    Ok(())
}

fn drive(harness: &mut Harness, work: &Path, plugins: &Path, target: &Target) -> anyhow::Result<()> {
    let studio = Arc::clone(&harness.studio);
    let source = target.source();
    let name = &target.command;
    let gone_prompt = format!("/{name} Reply with only the word gone.");
    harness.pump_until("daemon connected", STEP, |view| matches!(view.connection, Some(Connection::Ready)))?;
    studio.add_project(work.to_string_lossy().into_owned());
    harness.pump_until("project added", STEP, |view| view.projects.len() == 1)?;
    let project = harness.view.projects[0].id.clone();

    let commands = harness.list_commands("before")?;
    let stone = commands
        .iter()
        .find(|command| command.name == *name)
        .with_context(|| format!("/{name} is not in the palette"))?;
    ensure!(stone.source == source && stone.kind == CommandKind::Plugin, "/{name} has the wrong source: {stone:?}");
    println!("ok   check 2 core: /{name} listed, source {}, kind {:?}", stone.source, stone.kind);
    ensure!(
        commands.iter().any(|command| command.name == "skill:smoothstone" && command.source == source),
        "the plugin skill is not in the palette"
    );
    ensure!(commands.iter().any(|command| command.name == "compact"), "session commands are missing");
    ensure!(
        harness.view.notices.iter().any(|notice| notice.contains("broken")),
        "the broken plugin raised no notice: {:?}",
        harness.view.notices
    );
    println!("ok   check 5: broken plugin reported in a notice, {} and session commands still listed", target.id);

    studio.start_thread(
        "stone".to_string(),
        Some(project.clone()),
        prompt(&format!("/{name} {REQUEST}")),
        settings(&target.model),
    );
    harness.pump_until("stone thread started", STEP, |view| view.thread("stone").is_some())?;
    let thread = harness.view.thread("stone").context("no stone thread")?;
    studio.select_thread(Some(thread.clone()));
    harness.pump_until(&format!("the /{name} prompt reached the model expanded"), STEP, |view| {
        user_text(view.items(&thread)).iter().any(|text| text.contains("stone status") && text.contains(REQUEST))
    })?;
    let started = Instant::now();
    harness.pump_until(&format!("the /{name} turn finished on {}", target.model), BUILD, |view| view.idle(&thread))?;
    studio.select_thread(Some(thread.clone()));
    harness.pump_until("stone transcript reloaded", STEP, |view| !view.items(&thread).is_empty())?;
    let calls = stone_calls(harness.view.items(&thread));
    println!("     {calls} stone tool calls in {:?}", started.elapsed());
    for item in harness.view.items(&thread).iter().rev().take(2) {
        println!("     last item {:.400}", format!("{:?}", item.kind));
    }
    ensure!(calls > 0, "the /{name} turn ended without running stone");
    check_part(work)?;
    std::fs::remove_dir_all(plugins.join(&target.id))?;
    let commands = harness.list_commands("after")?;
    ensure!(!commands.iter().any(|command| command.source == source), "the removed plugin is still listed");
    ensure!(commands.iter().any(|command| command.name == "compact"), "session commands vanished with the plugin");
    studio.start_thread("gone".to_string(), Some(project), prompt(&gone_prompt), settings(SMALL));
    harness.pump_until("gone thread started", STEP, |view| view.thread("gone").is_some())?;
    let gone = harness.view.thread("gone").context("no gone thread")?;
    studio.select_thread(Some(gone.clone()));
    harness.pump_until("the next turn after removal finished", STEP * 3, |view| {
        view.idle(&gone) && !user_text(view.items(&gone)).is_empty()
    })?;
    let sent = user_text(harness.view.items(&gone));
    ensure!(sent.iter().all(|text| text.trim() == gone_prompt), "/{name} still expanded after removal: {sent:?}");
    println!("ok   check 4: plugin folder removed, /{name} gone from the palette and sent as plain text on the next turn, no restart");
    Ok(())
}

fn check_part(work: &Path) -> anyhow::Result<()> {
    let job = work.join("stone-job");
    let status: Value = serde_json::from_slice(&std::fs::read(job.join("status.json")).context("no stone job")?)?;
    println!("     stone status: {}", status.get("last_result").unwrap_or(&Value::Null));
    let stl = job.join("fan_guard.stl");
    ensure!(stl.is_file(), "no fan_guard.stl in {}", job.display());
    let output = Command::new("stone").arg("check").arg(&stl).output().context("run stone check")?;
    let text = String::from_utf8_lossy(&output.stdout);
    print!("{text}");
    ensure!(output.status.success() && !text.contains("FAIL"), "stone check rejected {}", stl.display());
    println!("ok   check 3: {} passes stone check", stl.display());
    Ok(())
}

fn stop_daemon(socket: &Path) -> anyhow::Result<()> {
    if !socket.exists() {
        return Ok(());
    }
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    runtime.block_on(async {
        let (client, _events) = DaemonClient::connect(socket).await?;
        client
            .request_ok(DaemonCommand::Shutdown { id: None, force: Some(true), if_idle: None, rest: Map::default() })
            .await?;
        println!("ok   scratch daemon stopped");
        anyhow::Ok(())
    })
}
