use iroh::SecretKey;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

pub fn load_or_create(path: &Path) -> io::Result<SecretKey> {
    match fs::read(path) {
        Ok(bytes) => {
            let raw: [u8; 32] = bytes
                .as_slice()
                .try_into()
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "key file must contain exactly 32 bytes"))?;
            Ok(SecretKey::from_bytes(&raw))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            if let Some(parent) = path.parent() {
                if !parent.as_os_str().is_empty() {
                    fs::create_dir_all(parent)?;
                }
            }
            let key = SecretKey::generate();
            let mut file = open_new(path)?;
            file.write_all(&key.to_bytes())?;
            Ok(key)
        }
        Err(error) => Err(error),
    }
}

#[cfg(unix)]
fn open_new(path: &Path) -> io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    OpenOptions::new().write(true).create_new(true).mode(0o600).open(path)
}

#[cfg(not(unix))]
fn open_new(path: &Path) -> io::Result<std::fs::File> {
    OpenOptions::new().write(true).create_new(true).open(path)
}
