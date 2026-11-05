use std::io::{self, Read, Write};
use std::net::{Shutdown, TcpStream, ToSocketAddrs};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use rustls::pki_types::ServerName;
use rustls::{ClientConfig, ClientConnection, RootCertStore, StreamOwned};

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

pub struct Endpoint {
    host: String,
    port: u16,
    tls: bool,
    pub authority: String,
    pub target: String,
}

pub fn endpoint(raw: &str) -> Result<Endpoint, String> {
    let url = url::Url::parse(raw).map_err(|error| error.to_string())?;
    let tls = match url.scheme() {
        "http" | "ws" => false,
        "https" | "wss" => true,
        scheme => return Err(format!("unsupported scheme {scheme}")),
    };
    let host = url.host_str().ok_or("missing host")?.to_string();
    let port = url.port_or_known_default().ok_or("missing port")?;
    let authority = match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.clone(),
    };
    let target = match url.query() {
        Some(query) => format!("{}?{query}", url.path()),
        None => url.path().to_string(),
    };
    let host = host
        .strip_prefix('[')
        .and_then(|inner| inner.strip_suffix(']'))
        .map(str::to_string)
        .unwrap_or(host);
    Ok(Endpoint {
        host,
        port,
        tls,
        authority,
        target,
    })
}

pub enum Conn {
    Plain(TcpStream),
    Tls(Box<StreamOwned<ClientConnection, TcpStream>>),
}

impl Conn {
    pub fn tcp(&self) -> &TcpStream {
        match self {
            Conn::Plain(stream) => stream,
            Conn::Tls(stream) => &stream.sock,
        }
    }
}

impl Read for Conn {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match self {
            Conn::Plain(stream) => stream.read(buf),
            Conn::Tls(stream) => stream.read(buf),
        }
    }
}

impl Write for Conn {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match self {
            Conn::Plain(stream) => stream.write(buf),
            Conn::Tls(stream) => stream.write(buf),
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        match self {
            Conn::Plain(stream) => stream.flush(),
            Conn::Tls(stream) => stream.flush(),
        }
    }
}

static TLS_CONFIG: LazyLock<Option<Arc<ClientConfig>>> = LazyLock::new(|| {
    let mut roots = RootCertStore::empty();
    roots.add_parsable_certificates(rustls_native_certs::load_native_certs().certs);
    ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .ok()
        .map(|builder| Arc::new(builder.with_root_certificates(roots).with_no_client_auth()))
});

pub fn connect(endpoint: &Endpoint) -> io::Result<Conn> {
    let mut last = io::Error::new(io::ErrorKind::NotFound, "no address");
    let mut stream = None;
    for address in (endpoint.host.as_str(), endpoint.port).to_socket_addrs()? {
        match TcpStream::connect_timeout(&address, CONNECT_TIMEOUT) {
            Ok(connected) => {
                stream = Some(connected);
                break;
            }
            Err(error) => last = error,
        }
    }
    let stream = stream.ok_or(last)?;
    stream.set_nodelay(true)?;
    if !endpoint.tls {
        return Ok(Conn::Plain(stream));
    }
    let name = ServerName::try_from(endpoint.host.clone())
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
    let config = TLS_CONFIG
        .clone()
        .ok_or_else(|| io::Error::other("TLS is unavailable"))?;
    let connection = ClientConnection::new(config, name).map_err(io::Error::other)?;
    Ok(Conn::Tls(Box::new(StreamOwned::new(connection, stream))))
}

pub fn shutdown(stream: &TcpStream) {
    let _ = stream.shutdown(Shutdown::Both);
}

pub struct Waker {
    read: OwnedFd,
    write: OwnedFd,
}

impl Waker {
    pub fn new() -> io::Result<Self> {
        let mut fds = [0 as RawFd; 2];
        if unsafe { libc::pipe(fds.as_mut_ptr()) } != 0 {
            return Err(io::Error::last_os_error());
        }
        let (read, write) = unsafe { (OwnedFd::from_raw_fd(fds[0]), OwnedFd::from_raw_fd(fds[1])) };
        for fd in [&read, &write] {
            let flags = unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_GETFL) };
            if flags < 0
                || unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) }
                    < 0
            {
                return Err(io::Error::last_os_error());
            }
        }
        Ok(Self { read, write })
    }

    pub fn wake(&self) {
        let byte = 1u8;
        unsafe { libc::write(self.write.as_raw_fd(), (&raw const byte).cast(), 1) };
    }

    fn drain(&self) {
        let mut buf = [0u8; 64];
        while unsafe { libc::read(self.read.as_raw_fd(), buf.as_mut_ptr().cast(), buf.len()) } > 0 {
        }
    }

    pub fn wait(&self, socket: &TcpStream, write: bool) -> io::Result<()> {
        let mut events = libc::POLLIN;
        if write {
            events |= libc::POLLOUT;
        }
        let mut fds = [
            libc::pollfd {
                fd: socket.as_raw_fd(),
                events,
                revents: 0,
            },
            libc::pollfd {
                fd: self.read.as_raw_fd(),
                events: libc::POLLIN,
                revents: 0,
            },
        ];
        let result = unsafe { libc::poll(fds.as_mut_ptr(), 2, 1_000) };
        if result < 0 {
            let error = io::Error::last_os_error();
            if error.kind() != io::ErrorKind::Interrupted {
                return Err(error);
            }
        }
        if fds[1].revents != 0 {
            self.drain();
        }
        Ok(())
    }
}
