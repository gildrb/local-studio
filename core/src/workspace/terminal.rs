use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tokio::sync::mpsc;

use crate::model::Update;
use crate::studio::Mailbox;

const COALESCE: Duration = Duration::from_millis(16);
const MAX_CHUNK: usize = 64 * 1024;

enum Event {
    Output(Vec<u8>),
    Exited(Option<i32>),
}

struct Terminal {
    master: Box<dyn MasterPty + Send>,
    input: std::sync::mpsc::Sender<Vec<u8>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub(crate) struct Terminals {
    open: Mutex<HashMap<String, Terminal>>,
    next: Mutex<u64>,
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 }
}

fn shell() -> String {
    std::env::var("SHELL").ok().filter(|shell| !shell.is_empty() && Path::new(shell).is_file()).unwrap_or_else(|| {
        if Path::new("/bin/zsh").is_file() {
            "/bin/zsh".to_string()
        } else {
            "/bin/sh".to_string()
        }
    })
}

impl Terminals {
    pub(crate) fn open(
        &self,
        runtime: &tokio::runtime::Handle,
        mailbox: &Arc<Mailbox>,
        request: String,
        cwd: &Path,
        cols: u16,
        rows: u16,
    ) -> Result<String, String> {
        let pair = native_pty_system()
            .openpty(size(cols, rows))
            .map_err(|error| format!("could not open a terminal: {error}"))?;
        let mut command = CommandBuilder::new(shell());
        command.arg("-l");
        command.cwd(cwd);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        command.env("TERM_PROGRAM", "LocalStudio");
        if std::env::var_os("LANG").is_none() {
            command.env("LANG", "en_US.UTF-8");
        }
        let mut child =
            pair.slave.spawn_command(command).map_err(|error| format!("could not start the shell: {error}"))?;
        drop(pair.slave);
        let mut killer = child.clone_killer();
        let pipes = pair.master.try_clone_reader().and_then(|reader| Ok((reader, pair.master.take_writer()?)));
        let (mut reader, mut writer) = match pipes {
            Ok(pipes) => pipes,
            Err(error) => {
                let _ = killer.kill();
                return Err(error.to_string());
            }
        };
        let id = {
            let mut next = self.next.lock().unwrap_or_else(PoisonError::into_inner);
            *next += 1;
            format!("terminal-{next}")
        };
        let (input, inputs) = std::sync::mpsc::channel::<Vec<u8>>();
        let writer_thread = std::thread::Builder::new().name(format!("{id}-write")).spawn(move || {
            while let Ok(data) = inputs.recv() {
                if writer.write_all(&data).and_then(|()| writer.flush()).is_err() {
                    break;
                }
            }
        });
        if let Err(error) = writer_thread {
            let _ = killer.kill();
            return Err(error.to_string());
        }
        let (events, mut received) = mpsc::unbounded_channel();
        let reader_thread = std::thread::Builder::new().name(format!("{id}-read")).spawn(move || {
            let mut buffer = vec![0; 16 * 1024];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        if events.send(Event::Output(buffer[..count].to_vec())).is_err() {
                            break;
                        }
                    }
                }
            }
            let code = child.wait().ok().map(|status| i32::try_from(status.exit_code()).unwrap_or(i32::MAX));
            let _ = events.send(Event::Exited(code));
        });
        if let Err(error) = reader_thread {
            let _ = killer.kill();
            return Err(error.to_string());
        }
        self.open
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(id.clone(), Terminal { master: pair.master, input, killer });
        mailbox.push(Update::TerminalOpened { request, terminal: id.clone() });
        let mailbox = Arc::clone(mailbox);
        let opened = id.clone();
        runtime.spawn(async move {
            let mut exit: Option<Option<i32>> = None;
            while let Some(event) = received.recv().await {
                let mut data = match event {
                    Event::Output(data) => data,
                    Event::Exited(code) => {
                        exit = Some(code);
                        break;
                    }
                };
                let deadline = tokio::time::Instant::now() + COALESCE;
                while data.len() < MAX_CHUNK {
                    match tokio::time::timeout_at(deadline, received.recv()).await {
                        Ok(Some(Event::Output(more))) => data.extend_from_slice(&more),
                        Ok(Some(Event::Exited(code))) => {
                            exit = Some(code);
                            break;
                        }
                        Ok(None) | Err(_) => break,
                    }
                }
                mailbox.push(Update::TerminalOutput { terminal: id.clone(), data });
                if exit.is_some() {
                    break;
                }
            }
            mailbox.push(Update::TerminalExited { terminal: id, code: exit.flatten() });
        });
        Ok(opened)
    }

    pub(crate) fn write(&self, terminal: String, data: Vec<u8>) -> Result<(), String> {
        let open = self.open.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(entry) = open.get(&terminal) else { return Err(unknown(terminal)) };
        entry.input.send(data).map_err(|_| "The terminal has closed.".to_string())
    }

    pub(crate) fn resize(&self, terminal: String, cols: u16, rows: u16) -> Result<(), String> {
        let open = self.open.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(entry) = open.get(&terminal) else { return Err(unknown(terminal)) };
        entry.master.resize(size(cols, rows)).map_err(|error| error.to_string())
    }

    pub(crate) fn close(&self, terminal: String) -> Result<(), String> {
        let entry = self.open.lock().unwrap_or_else(PoisonError::into_inner).remove(&terminal);
        let Some(mut entry) = entry else { return Err(unknown(terminal)) };
        let _ = entry.killer.kill();
        Ok(())
    }

    pub(crate) fn close_all(&self) {
        let entries: Vec<Terminal> =
            self.open.lock().unwrap_or_else(PoisonError::into_inner).drain().map(|(_, entry)| entry).collect();
        for mut entry in entries {
            let _ = entry.killer.kill();
        }
    }
}

fn unknown(mut terminal: String) -> String {
    terminal.insert_str(0, "Unknown terminal ");
    terminal.push('.');
    terminal
}
