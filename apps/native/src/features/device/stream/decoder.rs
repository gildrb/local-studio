use super::frame::VideoFrame;
use super::h264::parse_avcc_config;

#[cfg(target_os = "linux")]
use super::decoder_linux::SoftDecoder;
#[cfg(target_os = "macos")]
use super::decoder_macos::VtDecoder;
#[cfg(target_os = "macos")]
use super::h264::annexb_to_avcc;
#[cfg(target_os = "linux")]
use super::h264::avcc_to_annexb;

pub fn avc_codec_string(bytes: &[u8]) -> String {
    match bytes.get(1..4) {
        Some([profile, constraints, level]) => {
            format!("avc1.{profile:02x}{constraints:02x}{level:02x}")
        }
        _ => "avc1.42e01e".to_string(),
    }
}

pub struct H264Decoder {
    #[cfg(target_os = "macos")]
    inner: VtDecoder,
    #[cfg(target_os = "linux")]
    inner: SoftDecoder,
    #[cfg(target_os = "linux")]
    length_size: usize,
    scratch: Vec<u8>,
}

impl H264Decoder {
    pub fn from_avcc_record(record: &[u8]) -> Result<Self, String> {
        let config = parse_avcc_config(record).ok_or("invalid avcC record")?;
        let (Some(sps), Some(pps)) = (config.sps.first(), config.pps.first()) else {
            return Err("avcC record without parameter sets".into());
        };
        Self::new(sps, pps, config.length_size)
    }

    pub fn from_parameter_sets(sps: &[u8], pps: &[u8]) -> Result<Self, String> {
        Self::new(sps, pps, 4)
    }

    #[cfg(target_os = "macos")]
    fn new(sps: &[u8], pps: &[u8], length_size: usize) -> Result<Self, String> {
        Ok(Self {
            inner: VtDecoder::new(sps, pps, length_size)?,
            scratch: Vec::new(),
        })
    }

    #[cfg(target_os = "linux")]
    fn new(sps: &[u8], pps: &[u8], length_size: usize) -> Result<Self, String> {
        Ok(Self {
            inner: SoftDecoder::new(sps, pps)?,
            length_size,
            scratch: Vec::new(),
        })
    }

    #[cfg(target_os = "macos")]
    pub fn decode_avcc(&mut self, data: &[u8]) -> Result<Option<VideoFrame>, String> {
        self.inner.decode(data)
    }

    #[cfg(target_os = "macos")]
    pub fn decode_annexb(&mut self, data: &[u8]) -> Result<Option<VideoFrame>, String> {
        annexb_to_avcc(data, &mut self.scratch);
        self.inner.decode(&self.scratch)
    }

    #[cfg(target_os = "linux")]
    pub fn decode_avcc(&mut self, data: &[u8]) -> Result<Option<VideoFrame>, String> {
        avcc_to_annexb(data, self.length_size, &mut self.scratch);
        self.inner.decode(&self.scratch)
    }

    #[cfg(target_os = "linux")]
    pub fn decode_annexb(&mut self, data: &[u8]) -> Result<Option<VideoFrame>, String> {
        self.inner.decode(data)
    }
}
