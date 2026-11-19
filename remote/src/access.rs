fn split_authority(authority: &str) -> (String, Option<u16>) {
    let authority = authority.trim().to_ascii_lowercase();
    if let Some(rest) = authority.strip_prefix('[') {
        let Some((inside, after)) = rest.split_once(']') else { return (authority, None) };
        let port = after.strip_prefix(':').and_then(|port| port.parse().ok());
        return (format!("[{inside}]"), port);
    }
    match authority.rsplit_once(':') {
        Some((name, port)) if !name.contains(':') => match port.parse() {
            Ok(port) => (name.to_string(), Some(port)),
            Err(_) => (authority, None),
        },
        _ => (authority, None),
    }
}

pub fn named(host: &str, names: &[String]) -> bool {
    let (name, _) = split_authority(host);
    !name.is_empty() && names.iter().any(|allowed| split_authority(allowed).0 == name)
}

pub fn host_allowed(host: &str, port: u16, allowed: &[String]) -> bool {
    let (name, given) = split_authority(host);
    if name.is_empty() {
        return false;
    }
    let loopback = matches!(name.as_str(), "127.0.0.1" | "localhost") && given == Some(port);
    loopback || named(host, allowed)
}

pub fn same_origin(origin: &str, host: &str) -> bool {
    let Some((scheme, authority)) = origin.trim().split_once("://") else { return false };
    let default = match scheme.to_ascii_lowercase().as_str() {
        "http" | "ws" => 80,
        "https" | "wss" => 443,
        _ => return false,
    };
    if authority.contains('/') || authority.contains('@') {
        return false;
    }
    let (origin_name, origin_port) = split_authority(authority);
    let (host_name, host_port) = split_authority(host);
    !origin_name.is_empty()
        && origin_name == host_name
        && origin_port.unwrap_or(default) == host_port.unwrap_or(default)
}

pub fn origin_allowed(origin: Option<&str>, host: &str) -> bool {
    origin.is_none_or(|origin| same_origin(origin, host))
}
