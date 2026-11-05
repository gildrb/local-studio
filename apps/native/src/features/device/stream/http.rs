use std::io::{self, BufRead, BufReader, Read, Write};
use std::sync::Arc;
use std::time::Duration;

use super::net::{self, Conn};
use super::session::{Shared, SocketGuard};

enum Body {
    Chunked { remaining: usize, done: bool },
    Length(usize),
    Close,
}

pub struct HttpResponse {
    pub status: u16,
    content_type: Option<String>,
    reader: BufReader<Conn>,
    body: Body,
    _guard: SocketGuard,
}

pub fn get(
    shared: &Arc<Shared>,
    url: &str,
    read_timeout: Option<Duration>,
) -> Result<HttpResponse, String> {
    let endpoint = net::endpoint(url)?;
    let mut conn = net::connect(&endpoint).map_err(|error| error.to_string())?;
    let guard = shared
        .register(conn.tcp())
        .map_err(|error| error.to_string())?;
    conn.tcp()
        .set_read_timeout(Some(read_timeout.unwrap_or(net::CONNECT_TIMEOUT)))
        .map_err(|error| error.to_string())?;
    let request = format!(
        "GET {} HTTP/1.1\r\nHost: {}\r\nAccept: */*\r\nConnection: close\r\nUser-Agent: LocalStudio\r\n\r\n",
        endpoint.target, endpoint.authority
    );
    conn.write_all(request.as_bytes())
        .and_then(|()| conn.flush())
        .map_err(|error| error.to_string())?;
    let mut reader = BufReader::with_capacity(64 * 1024, conn);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|error| error.to_string())?;
    let status = line
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or("malformed HTTP response")?;
    let mut content_type = None;
    let mut chunked = false;
    let mut length = None;
    loop {
        line.clear();
        if reader
            .read_line(&mut line)
            .map_err(|error| error.to_string())?
            == 0
        {
            return Err("connection closed during headers".into());
        }
        let header = line.trim_end();
        if header.is_empty() {
            break;
        }
        let Some((name, value)) = header.split_once(':') else {
            continue;
        };
        let value = value.trim();
        match name.trim().to_ascii_lowercase().as_str() {
            "content-type" => content_type = Some(value.to_string()),
            "transfer-encoding" => chunked = value.to_ascii_lowercase().contains("chunked"),
            "content-length" => length = value.parse::<usize>().ok(),
            _ => {}
        }
    }
    reader
        .get_ref()
        .tcp()
        .set_read_timeout(read_timeout)
        .map_err(|error| error.to_string())?;
    let body = if chunked {
        Body::Chunked {
            remaining: 0,
            done: false,
        }
    } else if let Some(length) = length {
        Body::Length(length)
    } else {
        Body::Close
    };
    Ok(HttpResponse {
        status,
        content_type,
        reader,
        body,
        _guard: guard,
    })
}

impl HttpResponse {
    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }

    pub fn boundary(&self) -> Option<String> {
        let content_type = self.content_type.as_deref()?;
        content_type.split(';').find_map(|part| {
            let (name, value) = part.trim().split_once('=')?;
            name.eq_ignore_ascii_case("boundary")
                .then(|| value.trim_matches('"').to_string())
        })
    }

    fn next_chunk(&mut self) -> io::Result<usize> {
        let mut line = String::new();
        self.reader.read_line(&mut line)?;
        if line.trim().is_empty() {
            line.clear();
            self.reader.read_line(&mut line)?;
        }
        let size = line.trim().split(';').next().unwrap_or("");
        usize::from_str_radix(size, 16)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "malformed chunk size"))
    }
}

impl Read for HttpResponse {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match &mut self.body {
            Body::Close => self.reader.read(buf),
            Body::Length(remaining) => {
                if *remaining == 0 {
                    return Ok(0);
                }
                let limit = buf.len().min(*remaining);
                let read = self.reader.read(&mut buf[..limit])?;
                *remaining -= read;
                Ok(read)
            }
            Body::Chunked { remaining, done } => {
                if *done {
                    return Ok(0);
                }
                if *remaining == 0 {
                    let size = self.next_chunk()?;
                    let Body::Chunked { remaining, done } = &mut self.body else {
                        return Ok(0);
                    };
                    if size == 0 {
                        *done = true;
                        return Ok(0);
                    }
                    *remaining = size;
                }
                let Body::Chunked { remaining, .. } = &mut self.body else {
                    return Ok(0);
                };
                let limit = buf.len().min(*remaining);
                let read = self.reader.read(&mut buf[..limit])?;
                if read == 0 {
                    return Err(io::ErrorKind::UnexpectedEof.into());
                }
                *remaining -= read;
                Ok(read)
            }
        }
    }
}
