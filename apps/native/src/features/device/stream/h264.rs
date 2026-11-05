const SEMU_MAGIC: u32 = 0x5345_4d55;
const SEMU_HEADER_BYTES: usize = 16;
const SEMU_FLAG_KEY: u8 = 1;
const NAL_SLICE_IDR: u8 = 5;
const NAL_SPS: u8 = 7;
const NAL_PPS: u8 = 8;
const NAL_AUD: u8 = 9;

pub struct SemuPacket<'a> {
    pub data: &'a [u8],
    pub is_key: Option<bool>,
}

pub fn parse_semu_packet(bytes: &[u8]) -> SemuPacket<'_> {
    if bytes.len() > SEMU_HEADER_BYTES
        && u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) == SEMU_MAGIC
        && bytes[4] == 1
    {
        return SemuPacket {
            data: &bytes[SEMU_HEADER_BYTES..],
            is_key: Some(bytes[5] & SEMU_FLAG_KEY != 0),
        };
    }
    SemuPacket {
        data: bytes,
        is_key: None,
    }
}

pub fn annexb_nals(buf: &[u8]) -> impl Iterator<Item = &[u8]> {
    let mut starts = Vec::new();
    let mut i = 0;
    while i + 2 < buf.len() {
        if buf[i] == 0 && buf[i + 1] == 0 {
            let code = if buf[i + 2] == 1 {
                3
            } else if i + 3 < buf.len() && buf[i + 2] == 0 && buf[i + 3] == 1 {
                4
            } else {
                0
            };
            if code > 0 {
                starts.push((i, i + code));
                i += code;
                continue;
            }
        }
        i += 1;
    }
    let ends: Vec<usize> = starts
        .iter()
        .skip(1)
        .map(|(start, _)| *start)
        .chain(std::iter::once(buf.len()))
        .collect();
    starts
        .into_iter()
        .zip(ends)
        .map(move |((_, body), end)| {
            let mut end = end;
            while end > body && buf[end - 1] == 0 {
                end -= 1;
            }
            &buf[body..end]
        })
        .filter(|nal| !nal.is_empty())
}

pub struct AccessUnitScan<'a> {
    pub is_key: bool,
    pub sps: Option<&'a [u8]>,
    pub pps: Option<&'a [u8]>,
}

pub fn scan_access_unit(buf: &[u8]) -> AccessUnitScan<'_> {
    let mut scan = AccessUnitScan {
        is_key: false,
        sps: None,
        pps: None,
    };
    for nal in annexb_nals(buf) {
        match nal[0] & 0x1f {
            NAL_SPS if scan.sps.is_none() => scan.sps = Some(nal),
            NAL_PPS if scan.pps.is_none() => scan.pps = Some(nal),
            NAL_SLICE_IDR => scan.is_key = true,
            _ => {}
        }
    }
    scan
}

#[cfg(target_os = "macos")]
pub fn annexb_to_avcc(buf: &[u8], out: &mut Vec<u8>) {
    out.clear();
    for nal in annexb_nals(buf) {
        if matches!(nal[0] & 0x1f, NAL_SPS | NAL_PPS | NAL_AUD) {
            continue;
        }
        out.extend_from_slice(&(nal.len() as u32).to_be_bytes());
        out.extend_from_slice(nal);
    }
}

#[cfg(target_os = "linux")]
pub fn avcc_to_annexb(buf: &[u8], length_size: usize, out: &mut Vec<u8>) {
    out.clear();
    let mut offset = 0;
    while offset + length_size <= buf.len() {
        let mut length = 0usize;
        for byte in &buf[offset..offset + length_size] {
            length = (length << 8) | usize::from(*byte);
        }
        offset += length_size;
        let end = (offset + length).min(buf.len());
        out.extend_from_slice(&[0, 0, 0, 1]);
        out.extend_from_slice(&buf[offset..end]);
        offset = end;
    }
}

pub struct AvccConfig {
    pub length_size: usize,
    pub sps: Vec<Vec<u8>>,
    pub pps: Vec<Vec<u8>>,
}

pub fn parse_avcc_config(record: &[u8]) -> Option<AvccConfig> {
    if record.len() < 7 || record[0] != 1 {
        return None;
    }
    let length_size = usize::from(record[4] & 0x03) + 1;
    let mut offset = 5;
    let read_sets = |count: usize, offset: &mut usize| -> Option<Vec<Vec<u8>>> {
        let mut sets = Vec::with_capacity(count);
        for _ in 0..count {
            let size = usize::from(u16::from_be_bytes([
                *record.get(*offset)?,
                *record.get(*offset + 1)?,
            ]));
            *offset += 2;
            sets.push(record.get(*offset..*offset + size)?.to_vec());
            *offset += size;
        }
        Some(sets)
    };
    let sps_count = usize::from(record[offset] & 0x1f);
    offset += 1;
    let sps = read_sets(sps_count, &mut offset)?;
    let pps_count = usize::from(*record.get(offset)?);
    offset += 1;
    let pps = read_sets(pps_count, &mut offset)?;
    (!sps.is_empty() && !pps.is_empty()).then_some(AvccConfig {
        length_size,
        sps,
        pps,
    })
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum AvccTag {
    Description,
    Keyframe,
    Delta,
    Seed,
}

#[derive(Default)]
pub struct AvccDemuxer {
    buffer: Vec<u8>,
}

impl AvccDemuxer {
    pub fn push(&mut self, bytes: &[u8], mut emit: impl FnMut(AvccTag, &[u8])) {
        self.buffer.extend_from_slice(bytes);
        let mut offset = 0;
        while self.buffer.len() - offset >= 4 {
            let length = u32::from_be_bytes([
                self.buffer[offset],
                self.buffer[offset + 1],
                self.buffer[offset + 2],
                self.buffer[offset + 3],
            ]) as usize;
            if self.buffer.len() - offset - 4 < length {
                break;
            }
            if length >= 1 {
                let tag = match self.buffer[offset + 4] {
                    1 => Some(AvccTag::Description),
                    2 => Some(AvccTag::Keyframe),
                    3 => Some(AvccTag::Delta),
                    4 => Some(AvccTag::Seed),
                    _ => None,
                };
                if let Some(tag) = tag {
                    emit(tag, &self.buffer[offset + 5..offset + 4 + length]);
                }
            }
            offset += 4 + length;
        }
        if offset > 0 {
            self.buffer.drain(..offset);
        }
    }
}
