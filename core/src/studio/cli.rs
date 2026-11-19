use std::collections::HashMap;
use std::time::Duration;

use eukhe_types::daemon::SessionEvent;
use tokio::time::Instant;

use super::{now_ms, Actor, Command, Live, Thread, BODY_LIMIT, STOP_GRACE};
use crate::harness::{self, Driver, Envelope, Event, Image, Launch, Sink};
use crate::images;
use crate::model::{
    AccessMode, Approval, ApprovalAnswer, Harness, ModelOption, ModelRef, NoticeLevel, NotificationKind, Update,
};
use crate::session::LiveState;
use crate::transcript::Transcript;

const IDLE_KILL: Duration = Duration::from_secs(600);

pub(super) struct Cli {
    driver: Driver,
    generation: u64,
    used: Instant,
}

pub(super) fn name(harness: Harness) -> &'static str {
    match harness {
        Harness::ClaudeCode => "Claude Code",
        Harness::Codex => "Codex",
        Harness::Eukhe => "Eukhe",
    }
}

fn session_gone(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    ["no rollout", "not found", "no such thread", "unknown thread"].iter().any(|words| lower.contains(words))
}

pub(super) fn unsupported(harness: Harness, what: &str) -> String {
    format!("{} threads cannot {what} in Local Studio.", name(harness))
}

impl Actor {
    pub(super) fn harness(&self, id: &str) -> Option<Harness> {
        self.store.threads.get(id).map(|flags| flags.harness).filter(|harness| *harness != Harness::Eukhe)
    }

    pub(super) fn all_models(&self) -> Vec<ModelOption> {
        let mut models = self.models.clone();
        models.extend(harness::models(Harness::ClaudeCode));
        models.extend(self.codex_models.iter().cloned());
        models
    }

    fn model_ref(&self, harness: Harness, model: &str) -> ModelRef {
        let provider = harness::provider_of(harness);
        let option = self.all_models().into_iter().find(|option| option.provider == provider && option.id == model);
        ModelRef {
            provider: provider.to_string(),
            id: model.to_string(),
            name: option.map(|option| option.name),
            reasoning: true,
        }
    }

    fn thinking_levels(&self, harness: Harness, model: Option<&str>) -> Vec<String> {
        let provider = harness::provider_of(harness);
        let models = self.all_models();
        models
            .iter()
            .find(|option| option.provider == provider && Some(option.id.as_str()) == model)
            .or_else(|| models.iter().find(|option| option.provider == provider))
            .map(|option| option.thinking_levels.clone())
            .unwrap_or_default()
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) async fn cli_create(
        &mut self,
        draft: &str,
        harness: Harness,
        cwd: String,
        project: Option<String>,
        access: AccessMode,
        model: Option<String>,
        thinking: Option<String>,
        fan_out: Option<String>,
        prompt: &str,
    ) -> Result<String, String> {
        let id = harness::new_session_id();
        let now = now_ms();
        self.store.update(&id, |flags| {
            flags.harness = harness;
            flags.native_session = (harness == Harness::ClaudeCode).then(|| id.clone());
            flags.cwd = Some(cwd.clone());
            flags.model = model;
            flags.thinking_level = thinking;
            flags.activity_at = Some(now);
            flags.project = project;
            flags.access = Some(access);
            flags.fan_out = fan_out;
        });
        self.save();
        self.threads
            .insert(id.clone(), Thread { cwd: Some(cwd), prompt: Some(prompt.to_string()), ..Thread::default() });
        if let Err(error) = self.cli_open(&id).await {
            self.threads.remove(&id);
            self.store.threads.remove(&id);
            self.save();
            return Err(error);
        }
        self.mailbox.push(Update::ThreadStarted { draft: draft.to_string(), thread: id.clone() });
        self.dirty = true;
        Ok(id)
    }

    pub(super) async fn cli_open(&mut self, id: &str) -> Result<String, String> {
        let harness = self.harness(id).ok_or_else(|| format!("Unknown thread {id}."))?;
        if self.drivers.contains_key(id) {
            if let Some(active) = self.live_active(id) {
                return Ok(active);
            }
        }
        if let Some(mut stale) = self.drivers.remove(id) {
            stale.driver.kill();
        }
        let flags = self.store.flags(id);
        let cwd = flags
            .cwd
            .clone()
            .or_else(|| self.threads.get(id).and_then(|thread| thread.cwd.clone()))
            .unwrap_or_else(|| self.home.clone());
        let native = flags.native_session.clone().unwrap_or_default();
        let resume = match harness {
            Harness::ClaudeCode => harness::claude_session_exists(&cwd, &native),
            Harness::Codex => !native.is_empty(),
            Harness::Eukhe => false,
        };
        let launch = Launch {
            harness,
            native,
            resume,
            cwd: cwd.clone(),
            model: flags.model.clone(),
            effort: flags.thinking_level.clone(),
            access: flags.access.unwrap_or(AccessMode::FullAccess),
        };
        self.generation += 1;
        let generation = self.generation;
        let opened = match Driver::open(launch.clone(), Sink::new(id, generation, self.cli.clone())).await {
            Ok(opened) => opened,
            Err(error) if harness == Harness::Codex && resume && session_gone(&error) => {
                self.mailbox.notice(
                    NoticeLevel::Warning,
                    format!("Codex could not resume this thread ({error}); it continues in a new Codex session."),
                );
                self.generation += 1;
                let fresh = Launch { resume: false, native: String::new(), ..launch };
                Driver::open(fresh, Sink::new(id, self.generation, self.cli.clone())).await?
            }
            Err(error) => return Err(error),
        };
        let generation = self.generation;
        if flags.native_session.as_deref() != Some(opened.native.as_str()) {
            let native = opened.native.clone();
            self.store.update(id, |flags| flags.native_session = Some(native));
            self.save();
        }
        let model = flags.model.as_deref().map(|model| self.model_ref(harness, model));
        let thinking_levels = self.thinking_levels(harness, flags.model.as_deref());
        let thread = self.threads.entry(id.to_string()).or_default();
        thread.cwd = Some(cwd.clone());
        if thread.live.is_none() || resume {
            let state = LiveState {
                session_id: id.to_string(),
                cwd,
                model,
                thinking_level: flags.thinking_level.clone().unwrap_or_default(),
                thinking_levels,
                ..LiveState::default()
            };
            let mut transcript = Transcript::default();
            transcript.reset(&opened.history, false);
            transcript.take_settled();
            thread.live = Some(Live {
                active: format!("{}:{id}", harness::provider_of(harness)),
                seen: 0,
                state,
                transcript,
                approvals: Vec::new(),
                sending: Vec::new(),
                shown: HashMap::new(),
            });
        }
        let last_user_at = thread.live.as_ref().and_then(|live| live.transcript.last_user_at());
        let active = thread.live.as_ref().map(|live| live.active.clone()).unwrap_or_default();
        self.drivers.insert(id.to_string(), Cli { driver: opened.driver, generation, used: Instant::now() });
        self.note_user_at(id, last_user_at);
        if self.focused.as_deref() == Some(id) {
            self.emit_focus(id);
        }
        self.dirty = true;
        Ok(active)
    }

    pub(super) async fn cli_send(
        &mut self,
        id: &str,
        text: &str,
        images: Vec<Image>,
        steer: bool,
    ) -> Result<(), String> {
        let cli = self.drivers.get_mut(id).ok_or_else(|| "The thread is not open.".to_string())?;
        cli.used = Instant::now();
        cli.driver.send(text, images, steer).await
    }

    pub(super) fn cli_images(prompt: &crate::model::PromptDraft) -> Vec<Image> {
        prompt
            .images
            .iter()
            .map(|image| Image { mime_type: image.mime_type.clone(), data: images::encode_base64(&image.data) })
            .collect()
    }

    pub(super) async fn cli_stop(&mut self, id: &str) {
        if !self.running(id) {
            self.mailbox.notice(NoticeLevel::Info, "That thread is not running.");
            return;
        }
        let Some(cli) = self.drivers.get_mut(id) else {
            self.forget_run(id);
            self.mailbox.notice(NoticeLevel::Info, "The thread had no running process; it no longer shows as working.");
            return;
        };
        let result = cli.driver.interrupt().await;
        self.threads.entry(id.to_string()).or_default().stopping = Some(Instant::now());
        match result {
            Ok(()) => self.later(STOP_GRACE, Command::StopCheck { thread: id.to_string() }),
            Err(error) => {
                self.mailbox.notice(NoticeLevel::Warning, format!("The stop request did not go through: {error}"));
                self.itself.send(Command::StopCheck { thread: id.to_string() }).ok();
            }
        }
    }

    pub(super) async fn cli_stop_check(&mut self, id: &str) {
        let harness = self.harness(id).unwrap_or_default();
        if let Some(mut cli) = self.drivers.remove(id) {
            cli.driver.kill();
        }
        let title = self.title(id);
        self.forget_run(id);
        self.mailbox.notice(
            NoticeLevel::Warning,
            format!(
                "“{title}” did not stop within {} s, so Local Studio stopped its {} process.",
                STOP_GRACE.as_secs(),
                name(harness)
            ),
        );
        self.reopen_focused(id).await;
    }

    pub(super) fn cli_answer(&mut self, id: &str, request: &str, answer: ApprovalAnswer) {
        let result = match self.drivers.get_mut(id) {
            Some(cli) => cli.driver.answer(request, answer),
            None => Err("That approval is no longer pending.".to_string()),
        };
        if let Err(error) = result {
            self.mailbox.notice(NoticeLevel::Warning, error);
        }
        self.settle_approval(id, request);
    }

    pub(super) async fn cli_rename(&mut self, id: &str, title: &str) {
        self.store.update(id, |flags| flags.title = Some(title.to_string()));
        self.save();
        self.threads.entry(id.to_string()).or_default().title = Some(title.to_string());
        if let Some(cli) = self.drivers.get_mut(id) {
            if let Err(error) = cli.driver.rename(title).await {
                self.mailbox.notice(NoticeLevel::Warning, error);
            }
        }
        self.emit_info(id);
        self.dirty = true;
    }

    pub(super) fn cli_delete(&mut self, id: &str) {
        if let Some(mut cli) = self.drivers.remove(id) {
            cli.driver.kill();
        }
        let cwd = self.threads.get(id).and_then(|thread| thread.cwd.clone()).or_else(|| self.store.flags(id).cwd);
        let worktree = cwd.and_then(|cwd| crate::threads::git_head(&cwd).worktree);
        self.workspace.thread_deleted(worktree);
        self.threads.remove(id);
        self.store.threads.remove(id);
        self.save();
        if self.focused.as_deref() == Some(id) {
            self.focused = None;
        }
        self.dirty = true;
    }

    pub(super) async fn cli_compact(&mut self, id: &str) {
        let result = match self.cli_open(id).await {
            Ok(_) => match self.drivers.get_mut(id) {
                Some(cli) => cli.driver.compact().await,
                None => Err("The thread is not open.".to_string()),
            },
            Err(error) => Err(error),
        };
        if let Err(error) = result {
            self.mailbox.notice(NoticeLevel::Error, error);
        }
    }

    pub(super) fn cli_access(&mut self, id: &str, mode: AccessMode) {
        let Some(cli) = self.drivers.get_mut(id) else { return };
        if let Err(error) = cli.driver.set_access(mode) {
            self.mailbox.notice(NoticeLevel::Error, error);
        }
    }

    pub(super) fn cli_model(
        &mut self,
        id: &str,
        provider: Option<String>,
        model: Option<String>,
        level: Option<String>,
    ) -> Result<(), String> {
        let harness = self.harness(id).ok_or_else(|| format!("Unknown thread {id}."))?;
        if let (Some(provider), Some(model)) = (provider, model) {
            if harness::harness_of(&provider) != harness {
                return Err(format!(
                    "A {} thread keeps its harness; start a new thread to use a {provider} model.",
                    name(harness)
                ));
            }
            self.store.update(id, |flags| flags.model = Some(model.clone()));
            self.save();
            if let Some(cli) = self.drivers.get_mut(id) {
                cli.driver.set_model(&model)?;
            }
            let reference = self.model_ref(harness, &model);
            let levels = self.thinking_levels(harness, Some(&model));
            if let Some(live) = self.threads.get_mut(id).and_then(|thread| thread.live.as_mut()) {
                live.state.model = Some(reference);
                live.state.thinking_levels = levels;
            }
        }
        if let Some(level) = level {
            self.store.update(id, |flags| flags.thinking_level = Some(level.clone()));
            self.save();
            let running = self.running(id);
            if let Some(cli) = self.drivers.get_mut(id) {
                if let Err(error) = cli.driver.set_effort(&level) {
                    if running {
                        self.mailbox.notice(NoticeLevel::Info, error);
                    } else if let Some(mut cli) = self.drivers.remove(id) {
                        cli.driver.kill();
                    }
                }
            }
            if let Some(live) = self.threads.get_mut(id).and_then(|thread| thread.live.as_mut()) {
                live.state.thinking_level = level;
            }
        }
        self.emit_info(id);
        self.dirty = true;
        Ok(())
    }

    pub(super) async fn cli_restart(&mut self, id: &str) -> Result<String, String> {
        if let Some(mut cli) = self.drivers.remove(id) {
            cli.driver.kill();
        }
        if let Some(thread) = self.threads.get_mut(id) {
            thread.pending_run = false;
            thread.pending_at = None;
            thread.run_started_at = None;
            if let Some(live) = thread.live.as_mut() {
                live.state.busy = false;
                live.approvals.clear();
            }
        }
        self.cli_open(id).await
    }

    pub(super) fn cli_idle(&mut self) {
        let idle: Vec<String> = self
            .drivers
            .iter()
            .filter(|(id, cli)| {
                cli.used.elapsed() >= IDLE_KILL
                    && !self.running(id)
                    && self
                        .threads
                        .get(id.as_str())
                        .and_then(|thread| thread.live.as_ref())
                        .is_none_or(|live| live.approvals.is_empty())
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in idle {
            if let Some(mut cli) = self.drivers.remove(&id) {
                cli.driver.kill();
            }
            if self.focused.as_deref() != Some(id.as_str()) {
                if let Some(thread) = self.threads.get_mut(&id) {
                    thread.live = None;
                }
            }
        }
    }

    pub(super) fn cli_shutdown(&mut self) {
        for (_, mut cli) in self.drivers.drain() {
            cli.driver.kill();
        }
    }

    pub(super) async fn cli_event(&mut self, envelope: Envelope) {
        let Envelope { thread: id, generation, event } = envelope;
        let harness = self.harness(&id).unwrap_or_default();
        if let Event::Usage(spend) = &event {
            if let Err(error) = harness::record_usage(&self.data_dir, &id, harness, spend) {
                self.mailbox.notice(NoticeLevel::Warning, format!("Could not record usage: {error}"));
            }
            return;
        }
        let Some(cli) = self.drivers.get_mut(&id).filter(|cli| cli.generation == generation) else { return };
        cli.used = Instant::now();
        match event {
            Event::Session(event) => self.apply_event(&id, &event, 0).await,
            Event::Approval(approval) => self.add_approval(id, approval),
            Event::ApprovalSettled(request) => self.settle_approval(&id, &request),
            Event::Context(context) => {
                if let Some(live) = self.threads.get_mut(&id).and_then(|thread| thread.live.as_mut()) {
                    live.state.context = Some(context);
                }
                self.emit_info(&id);
            }
            Event::Model(model) => {
                let reference = self.model_ref(harness, &model);
                if let Some(live) = self.threads.get_mut(&id).and_then(|thread| thread.live.as_mut()) {
                    if live.state.model.as_ref().is_none_or(|known| known.id != model) {
                        live.state.model = Some(reference);
                    }
                }
                self.emit_info(&id);
                self.dirty = true;
            }
            Event::Usage(_) => {}
            Event::Stopped(reason) => {
                if let Some(mut cli) = self.drivers.remove(&id) {
                    cli.driver.kill();
                }
                self.cli_halt(&id).await;
                let title = self.title(&id);
                let body = format!(
                    "{} stopped on an account problem: {reason}. Local Studio will not retry; check the sign-in or plan in a terminal, then send again.",
                    name(harness)
                );
                self.mailbox.notice(NoticeLevel::Error, format!("“{title}”: {body}"));
                self.mailbox.push(Update::Notification {
                    thread: id,
                    kind: NotificationKind::Failed,
                    title,
                    body: super::truncate(&body, BODY_LIMIT),
                });
            }
            Event::Exited(failure) => {
                self.drivers.remove(&id);
                let was = self.running(&id);
                self.cli_halt(&id).await;
                if was || failure.is_some() {
                    let reason = failure.unwrap_or_else(|| "it exited during the turn".to_string());
                    self.mailbox.notice(NoticeLevel::Warning, format!("{} stopped: {reason}", name(harness)));
                }
            }
        }
    }

    async fn cli_halt(&mut self, id: &str) {
        let busy = self.threads.get(id).and_then(|thread| thread.live.as_ref()).is_some_and(|live| live.state.busy);
        if busy {
            if let Some(thread) = self.threads.get_mut(id) {
                thread.failed_at = Some(now_ms());
            }
            self.apply_event(id, &SessionEvent::AgentEnd { messages: Vec::new() }, 0).await;
        }
        if let Some(thread) = self.threads.get_mut(id) {
            thread.pending_run = false;
            thread.pending_at = None;
            thread.stopping = None;
            thread.run_started_at = None;
            if let Some(live) = thread.live.as_mut() {
                live.approvals.clear();
            }
        }
        if self.focused.as_deref() == Some(id) {
            self.emit_approvals(id);
        }
        self.emit_info(id);
        self.dirty = true;
    }

    pub(super) fn add_approval(&mut self, id: String, approval: Approval) {
        let body = super::truncate(&approval.command, BODY_LIMIT);
        let Some(live) = self.threads.get_mut(&id).and_then(|thread| thread.live.as_mut()) else { return };
        live.approvals.retain(|(known, _)| known.request_id != approval.request_id);
        live.approvals.push((approval, now_ms()));
        self.emit_approvals(&id);
        let title = self.title(&id);
        self.mailbox.push(Update::Notification { thread: id, kind: NotificationKind::NeedsApproval, title, body });
        self.dirty = true;
    }

    pub(super) fn load_codex_models(&self) {
        let itself = self.itself.clone();
        tokio::spawn(async move {
            if let Ok(models) = harness::codex_models().await {
                itself.send(Command::HarnessModels { models }).ok();
            }
        });
    }
}
