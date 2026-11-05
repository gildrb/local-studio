use std::io;
use std::sync::Arc;
use std::sync::mpsc;

use tungstenite::handshake::HandshakeError;
use tungstenite::{Error, Message, WebSocket};

use super::net::{self, Conn, Waker};
use super::session::{Shared, SocketGuard};

pub struct Closed {
    pub code: u16,
    pub reason: String,
}

impl Closed {
    fn abnormal() -> Self {
        Self {
            code: 1006,
            reason: String::new(),
        }
    }
}

pub enum Opened {
    Socket(Box<WebSocket<Conn>>, SocketGuard),
    Refused { status: Option<u16> },
}

pub fn open(shared: &Arc<Shared>, url: &str) -> Opened {
    let refused = Opened::Refused { status: None };
    let Ok(endpoint) = net::endpoint(url) else {
        return refused;
    };
    let Ok(conn) = net::connect(&endpoint) else {
        return refused;
    };
    let Ok(guard) = shared.register(conn.tcp()) else {
        return refused;
    };
    if conn
        .tcp()
        .set_read_timeout(Some(net::CONNECT_TIMEOUT))
        .and_then(|()| conn.tcp().set_write_timeout(Some(net::CONNECT_TIMEOUT)))
        .is_err()
    {
        return refused;
    }
    match tungstenite::client::client(url, conn) {
        Ok((socket, _)) => {
            let tcp = socket.get_ref().tcp();
            if tcp.set_read_timeout(None).is_err()
                || tcp.set_write_timeout(None).is_err()
                || tcp.set_nonblocking(true).is_err()
            {
                return refused;
            }
            Opened::Socket(Box::new(socket), guard)
        }
        Err(HandshakeError::Failure(Error::Http(response))) => Opened::Refused {
            status: Some(response.status().as_u16()),
        },
        Err(_) => refused,
    }
}

fn would_block(error: &Error) -> bool {
    matches!(error, Error::Io(io) if io.kind() == io::ErrorKind::WouldBlock)
}

pub fn run(
    shared: &Arc<Shared>,
    socket: &mut WebSocket<Conn>,
    on_open: impl FnOnce(),
    mut on_message: impl FnMut(Message, &mut Vec<Message>),
) -> Option<Closed> {
    let Ok(waker) = Waker::new().map(Arc::new) else {
        return Some(Closed::abnormal());
    };
    let (queue, inbox) = mpsc::channel::<Message>();
    shared.set_input(Some((queue, waker.clone())));
    on_open();
    let closed = pump(shared, socket, &waker, &inbox, &mut on_message);
    shared.set_input(None);
    if closed.is_none() {
        let _ = socket.close(None);
        let _ = socket.flush();
    }
    closed
}

fn pump(
    shared: &Arc<Shared>,
    socket: &mut WebSocket<Conn>,
    waker: &Waker,
    inbox: &mpsc::Receiver<Message>,
    on_message: &mut impl FnMut(Message, &mut Vec<Message>),
) -> Option<Closed> {
    let mut replies = Vec::new();
    loop {
        if shared.is_stopped() {
            return None;
        }
        for message in inbox.try_iter().chain(replies.drain(..)) {
            match socket.write(message) {
                Ok(()) => {}
                Err(error) if would_block(&error) => {}
                Err(_) => return Some(Closed::abnormal()),
            }
        }
        let pending = match socket.flush() {
            Ok(()) => false,
            Err(error) if would_block(&error) => true,
            Err(_) => return Some(Closed::abnormal()),
        };
        loop {
            match socket.read() {
                Ok(Message::Close(frame)) => {
                    let _ = socket.flush();
                    return Some(match frame {
                        Some(frame) => Closed {
                            code: frame.code.into(),
                            reason: frame.reason.to_string(),
                        },
                        None => Closed {
                            code: 1005,
                            reason: String::new(),
                        },
                    });
                }
                Ok(message) => on_message(message, &mut replies),
                Err(error) if would_block(&error) => break,
                Err(_) => return Some(Closed::abnormal()),
            }
            if shared.is_stopped() {
                return None;
            }
        }
        if !replies.is_empty() {
            continue;
        }
        if waker.wait(socket.get_ref().tcp(), pending).is_err() {
            return Some(Closed::abnormal());
        }
    }
}
