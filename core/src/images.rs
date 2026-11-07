use std::io::Cursor;

use image::{ImageFormat, ImageReader};

use crate::model::ImageThumbnail;

const THUMBNAIL_EDGE: u32 = 512;
const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub(crate) fn thumbnail(mime_type: &str, encoded: &str) -> Option<ImageThumbnail> {
    let bytes = decode_base64(encoded)?;
    let reader = ImageReader::new(Cursor::new(&bytes)).with_guessed_format().ok()?;
    let format = reader.format();
    let image = reader.decode().ok()?;
    let (width, height) = (image.width(), image.height());
    if width <= THUMBNAIL_EDGE && height <= THUMBNAIL_EDGE {
        return Some(ImageThumbnail { mime_type: mime_type.to_string(), data: bytes, width, height });
    }
    let small = image.thumbnail(THUMBNAIL_EDGE, THUMBNAIL_EDGE);
    let (out_format, out_mime) = if format == Some(ImageFormat::Jpeg) {
        (ImageFormat::Jpeg, "image/jpeg")
    } else {
        (ImageFormat::Png, "image/png")
    };
    let mut data = Vec::new();
    let small = if out_format == ImageFormat::Jpeg { image::DynamicImage::ImageRgb8(small.to_rgb8()) } else { small };
    small.write_to(&mut Cursor::new(&mut data), out_format).ok()?;
    Some(ImageThumbnail { mime_type: out_mime.to_string(), data, width: small.width(), height: small.height() })
}

pub(crate) fn decode_base64(encoded: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(encoded.len() / 4 * 3);
    let mut buffer = 0u32;
    let mut bits = 0u32;
    for byte in encoded.bytes() {
        let value = match byte {
            b'=' => break,
            b' ' | b'\n' | b'\r' | b'\t' => continue,
            _ => u32::try_from(BASE64.iter().position(|candidate| *candidate == byte)?).ok()?,
        };
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(u8::try_from((buffer >> bits) & 0xff).ok()?);
        }
    }
    Some(out)
}

pub(crate) fn encode_base64(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let bytes = [chunk[0], chunk.get(1).copied().unwrap_or(0), chunk.get(2).copied().unwrap_or(0)];
        let triple = (u32::from(bytes[0]) << 16) | (u32::from(bytes[1]) << 8) | u32::from(bytes[2]);
        for position in 0..4 {
            if position <= chunk.len() {
                let index = usize::try_from((triple >> (18 - 6 * position)) & 0x3f).unwrap_or(0);
                out.push(char::from(BASE64[index]));
            } else {
                out.push('=');
            }
        }
    }
    out
}
