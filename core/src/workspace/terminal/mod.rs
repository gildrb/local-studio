mod emulator;
mod keys;

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};

pub(crate) use self::emulator::preview;
use self::emulator::Emulator;
use super::model::{TerminalKey, TerminalMouse, TerminalScroll, TerminalSelect, TerminalSize};
use crate::model::{NoticeLevel, Update};
use crate::studio::Mailbox;

const FRAME: Duration = Duration::from_millis(16);
const READ_CHUNK: usize = 64 * 1024;
const CELL_WIDTH: u32 = 16;
const CELL_HEIGHT: u32 = 32;

pub(crate) enum Message {
    Output(Vec<u8>),
    Exited(Option<i32>),
    Write(Vec<u8>),
    Key(TerminalKey),
    Paste(String),
    Mouse(TerminalMouse),
    Scroll(TerminalScroll),
    Focus(bool),
    Select(TerminalSelect),
    Resize(TerminalSize),
    SelectionText(String),
    RecentOutput(String, u32),
}

pub(crate) struct Launch<'a> {
    pub(crate) cwd: &'a Path,
    pub(crate) cols: u16,
    pub(crate) rows: u16,
    pub(crate) scrollback: u32,
}

struct Handle {
    messages: Sender<Message>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub(crate) struct Terminals {
    open: Mutex<HashMap<String, Handle>>,
    next: Mutex<u64>,
}

fn pty_size(size: TerminalSize) -> PtySize {
    PtySize {
        rows: size.rows.max(1),
        cols: size.cols.max(1),
        pixel_width: u16::try_from(u32::from(size.cols) * size.cell_width).unwrap_or(u16::MAX),
        pixel_height: u16::try_from(u32::from(size.rows) * size.cell_height).unwrap_or(u16::MAX),
    }
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
    pub(crate) fn open(&self, mailbox: &Arc<Mailbox>, request: String, launch: &Launch<'_>) -> Result<String, String> {
        let size =
            TerminalSize { cols: launch.cols, rows: launch.rows, cell_width: CELL_WIDTH, cell_height: CELL_HEIGHT };
        let pair = native_pty_system()
            .openpty(pty_size(size))
            .map_err(|error| format!("could not open a terminal: {error}"))?;
        let mut command = CommandBuilder::new(shell());
        command.arg("-l");
        command.cwd(launch.cwd);
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
        let (input, inputs) = mpsc::channel::<Vec<u8>>();
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
        let (messages, inbox) = mpsc::channel();
        let output = messages.clone();
        let reader_thread = std::thread::Builder::new().name(format!("{id}-read")).spawn(move || {
            let mut buffer = vec![0; READ_CHUNK];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        if output.send(Message::Output(buffer[..count].to_vec())).is_err() {
                            break;
                        }
                    }
                }
            }
            let code = child.wait().ok().map(|status| i32::try_from(status.exit_code()).unwrap_or(i32::MAX));
            let _ = output.send(Message::Exited(code));
        });
        if let Err(error) = reader_thread {
            let _ = killer.kill();
            return Err(error.to_string());
        }
        mailbox.push(Update::TerminalOpened { request, terminal: id.clone() });
        let session = Session {
            id: id.clone(),
            mailbox: Arc::clone(mailbox),
            master: pair.master,
            input,
            scrollback: usize::try_from(launch.scrollback).unwrap_or(usize::MAX),
            size,
        };
        let terminal_thread = std::thread::Builder::new().name(format!("{id}-vt")).spawn(move || session.run(&inbox));
        if let Err(error) = terminal_thread {
            let _ = killer.kill();
            return Err(error.to_string());
        }
        self.open.lock().unwrap_or_else(PoisonError::into_inner).insert(id.clone(), Handle { messages, killer });
        Ok(id)
    }

    pub(crate) fn send(&self, terminal: String, message: Message) -> Result<(), String> {
        let open = self.open.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(entry) = open.get(&terminal) else { return Err(unknown(terminal)) };
        entry.messages.send(message).map_err(|_| "The terminal has closed.".to_string())
    }

    pub(crate) fn write(&self, terminal: String, data: Vec<u8>) -> Result<(), String> {
        self.send(terminal, Message::Write(data))
    }

    pub(crate) fn close(&self, terminal: String) -> Result<(), String> {
        let entry = self.open.lock().unwrap_or_else(PoisonError::into_inner).remove(&terminal);
        let Some(mut entry) = entry else { return Err(unknown(terminal)) };
        let _ = entry.killer.kill();
        Ok(())
    }

    pub(crate) fn close_all(&self) {
        let entries: Vec<Handle> =
            self.open.lock().unwrap_or_else(PoisonError::into_inner).drain().map(|(_, entry)| entry).collect();
        for mut entry in entries {
            let _ = entry.killer.kill();
        }
    }
}

struct Session {
    id: String,
    mailbox: Arc<Mailbox>,
    master: Box<dyn MasterPty + Send>,
    input: Sender<Vec<u8>>,
    scrollback: usize,
    size: TerminalSize,
}

impl Session {
    fn run(self, inbox: &Receiver<Message>) {
        let mut emulator = match Emulator::new(self.size, self.scrollback) {
            Ok(emulator) => emulator,
            Err(error) => {
                self.mailbox.notice(NoticeLevel::Error, format!("The terminal could not start: {error}"));
                self.mailbox.push(Update::TerminalExited { terminal: self.id, code: None });
                return;
            }
        };
        let mut pending = true;
        let mut last: Option<Instant> = None;
        loop {
            let received = if pending {
                let wait = last.map_or(Duration::ZERO, |last| (last + FRAME).saturating_duration_since(Instant::now()));
                match inbox.recv_timeout(wait) {
                    Ok(message) => Some(message),
                    Err(RecvTimeoutError::Timeout) => None,
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            } else {
                match inbox.recv() {
                    Ok(message) => Some(message),
                    Err(_) => break,
                }
            };
            let mut exited = None;
            if let Some(message) = received {
                match self.handle(&mut emulator, message) {
                    Ok(Outcome::Idle) => {}
                    Ok(Outcome::Changed) => pending = true,
                    Ok(Outcome::Exited(code)) => {
                        pending = true;
                        exited = Some(code);
                    }
                    Err(error) => self.mailbox.notice(NoticeLevel::Error, format!("Terminal: {error}")),
                }
            }
            let due = last.is_none_or(|last| last.elapsed() >= FRAME);
            if pending && (due || exited.is_some()) {
                match emulator.frame(false) {
                    Ok(Some(frame)) => self.mailbox.push_frame(&self.id, frame),
                    Ok(None) => {}
                    Err(error) => self.mailbox.notice(NoticeLevel::Error, format!("Terminal: {error}")),
                }
                pending = false;
                last = Some(Instant::now());
            }
            if let Some(code) = exited {
                self.mailbox.push(Update::TerminalExited { terminal: self.id.clone(), code });
            }
        }
    }

    fn handle(&self, emulator: &mut Emulator, message: Message) -> Result<Outcome, String> {
        let error = |error: libghostty_vt::Error| error.to_string();
        let outcome = match message {
            Message::Output(data) => {
                emulator.feed(&data);
                self.reply(emulator.replies());
                Outcome::Changed
            }
            Message::Exited(code) => Outcome::Exited(code),
            Message::Write(data) => {
                self.reply(data);
                Outcome::Idle
            }
            Message::Key(key) => {
                self.reply(emulator.key(&key).map_err(error)?);
                Outcome::Changed
            }
            Message::Paste(text) => {
                self.reply(emulator.paste(&text).map_err(error)?);
                Outcome::Changed
            }
            Message::Mouse(mouse) => {
                self.reply(emulator.mouse(&mouse).map_err(error)?);
                Outcome::Changed
            }
            Message::Scroll(scroll) => {
                self.reply(emulator.scroll(&scroll).map_err(error)?);
                Outcome::Changed
            }
            Message::Focus(focused) => {
                self.reply(emulator.focus(focused).map_err(error)?);
                Outcome::Idle
            }
            Message::Select(selection) => {
                emulator.select(selection).map_err(error)?;
                Outcome::Changed
            }
            Message::Resize(size) => {
                if size != emulator.size() {
                    emulator.resize(size).map_err(error)?;
                    self.master.resize(pty_size(emulator.size())).map_err(|error| error.to_string())?;
                }
                Outcome::Changed
            }
            Message::SelectionText(request) => {
                self.answer(request, emulator.selection_text());
                Outcome::Idle
            }
            Message::RecentOutput(request, lines) => {
                self.answer(request, emulator.recent(lines));
                Outcome::Idle
            }
        };
        Ok(outcome)
    }

    fn answer(&self, request: String, text: Result<String, libghostty_vt::Error>) {
        self.mailbox.push(match text {
            Ok(text) => Update::TerminalText { request, terminal: self.id.clone(), text },
            Err(error) => Update::RequestFailed { request, message: error.to_string() },
        });
    }

    fn reply(&self, data: Vec<u8>) {
        if !data.is_empty() {
            let _ = self.input.send(data);
        }
    }
}

enum Outcome {
    Idle,
    Changed,
    Exited(Option<i32>),
}

fn unknown(mut terminal: String) -> String {
    terminal.insert_str(0, "Unknown terminal ");
    terminal.push('.');
    terminal
}
