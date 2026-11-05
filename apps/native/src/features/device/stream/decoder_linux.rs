use openh264::decoder::Decoder;
use openh264::formats::YUVSource;

use super::frame::VideoFrame;

pub struct SoftDecoder {
    decoder: Decoder,
}

impl SoftDecoder {
    pub fn new(sps: &[u8], pps: &[u8]) -> Result<Self, String> {
        let mut decoder = Decoder::new().map_err(|error| error.to_string())?;
        let mut sets = Vec::with_capacity(sps.len() + pps.len() + 8);
        for set in [sps, pps] {
            sets.extend_from_slice(&[0, 0, 0, 1]);
            sets.extend_from_slice(set);
        }
        decoder.decode(&sets).map_err(|error| error.to_string())?;
        Ok(Self { decoder })
    }

    pub fn decode(&mut self, annexb: &[u8]) -> Result<Option<VideoFrame>, String> {
        let Some(yuv) = self
            .decoder
            .decode(annexb)
            .map_err(|error| error.to_string())?
        else {
            return Ok(None);
        };
        let (width, height) = yuv.dimensions();
        let mut pixels = vec![0u8; width * height * 4];
        yuv.write_rgba8(&mut pixels);
        for [r, _, b, _] in pixels.as_chunks_mut::<4>().0 {
            std::mem::swap(r, b);
        }
        Ok(VideoFrame::from_bgra(width as u32, height as u32, pixels))
    }
}
