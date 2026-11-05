mod decoder;
#[cfg(target_os = "linux")]
mod decoder_linux;
#[cfg(target_os = "macos")]
mod decoder_macos;
mod frame;
mod h264;
mod http;
mod keys;
mod net;
mod screen;
mod session;
mod socket;

use serde::Deserialize;
use serde_json::Value;
use tungstenite::Message;

pub use screen::DeviceScreen;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Packet {
    Tagged { tag: u8, payload: Value },
    Json { payload: Value },
}

pub fn receive_packet(stream: u64, packet: Value) {
    let message = match serde_json::from_value::<Packet>(packet) {
        Ok(Packet::Tagged { tag, payload }) => {
            let mut bytes = vec![tag];
            if serde_json::to_writer(&mut bytes, &payload).is_err() {
                return;
            }
            Message::binary(bytes)
        }
        Ok(Packet::Json { payload }) => Message::text(payload.to_string()),
        Err(error) => {
            eprintln!("device: unreadable input packet ({error})");
            return;
        }
    };
    session::send_packet(stream, message);
}
