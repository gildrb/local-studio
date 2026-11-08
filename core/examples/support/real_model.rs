use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

use anyhow::{ensure, Context};
use local_studio_core::{AccessMode, ThreadSettings, UsageReport, WorktreeChoice};

pub const PROVIDER: &str = "anthropic";
pub const MODEL: &str = "claude-haiku-5-5";
pub const THINKING: &str = "low";
pub const SOURCE_ENV: &str = "LOCAL_STUDIO_SMOKE_AGENT";

pub struct Credentials {
    auth: PathBuf,
}

impl Drop for Credentials {
    fn drop(&mut self) {
        if std::fs::remove_file(&self.auth).is_ok() {
            println!("ok   copied credentials removed ({})", self.auth.display());
        }
    }
}

pub fn install(agent_dir: &Path) -> anyhow::Result<Credentials> {
    let source = std::env::var_os(SOURCE_ENV).map(PathBuf::from).with_context(|| {
        format!("{SOURCE_ENV} must name an agent dir holding auth.json, models.json and settings.json for {PROVIDER}/{MODEL}")
    })?;
    std::fs::create_dir_all(agent_dir)?;
    let credentials = Credentials { auth: agent_dir.join("auth.json") };
    for name in ["auth.json", "models.json", "settings.json"] {
        let data = std::fs::read(source.join(name)).with_context(|| format!("read {}", source.join(name).display()))?;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(agent_dir.join(name))?;
        file.write_all(&data)?;
    }
    println!("     real model {PROVIDER}/{MODEL} thinking {THINKING}, credentials copied from {}", source.display());
    Ok(credentials)
}

pub fn thread_settings(access: AccessMode, worktree: WorktreeChoice) -> ThreadSettings {
    ThreadSettings {
        provider: Some(PROVIDER.to_string()),
        model: Some(MODEL.to_string()),
        thinking_level: Some(THINKING.to_string()),
        access,
        worktree,
    }
}

pub fn check_usage(report: &UsageReport) -> anyhow::Result<()> {
    let haiku = report.by_model.iter().find(|model| model.provider == PROVIDER && model.model == MODEL);
    println!(
        "     usage: {} sessions, {} tokens (in {} out {}), ${:.4}; {PROVIDER}/{MODEL} {} tokens ${:.4}",
        report.requests,
        report.total_tokens,
        report.input_tokens,
        report.output_tokens,
        report.cost_usd,
        haiku.map_or(0, |model| model.tokens),
        haiku.map_or(0.0, |model| model.cost_usd),
    );
    let haiku = haiku.context("the usage report has no entry for the real model")?;
    ensure!(
        report.input_tokens > 0 && report.output_tokens > 0 && haiku.tokens > 0,
        "the usage report counts no real tokens"
    );
    ensure!(haiku.cost_usd > 0.0, "the usage report prices the real model at $0");
    println!("ok   usage report counts real tokens and cost");
    Ok(())
}
