use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};

use gpui::RenderImage;
use image::codecs::jpeg::JpegDecoder;
use image::{ColorType, ImageDecoder};

#[cfg(target_os = "macos")]
pub use super::decoder_macos::PixelBuffer;

#[derive(Clone)]
pub enum FramePixels {
    #[cfg(target_os = "macos")]
    Surface(PixelBuffer),
    Image(Arc<RenderImage>),
}

#[derive(Clone)]
pub struct VideoFrame {
    pub width: u32,
    pub height: u32,
    pub pixels: FramePixels,
}

impl VideoFrame {
    pub fn from_bgra(width: u32, height: u32, pixels: Vec<u8>) -> Option<Self> {
        let buffer = image::RgbaImage::from_raw(width, height, pixels)?;
        Some(Self {
            width,
            height,
            pixels: FramePixels::Image(Arc::new(RenderImage::new([image::Frame::new(buffer)]))),
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Rotation {
    #[default]
    None,
    Clockwise,
    Half,
    CounterClockwise,
}

impl Rotation {
    pub fn from_degrees(degrees: i32) -> Self {
        match degrees.rem_euclid(360) {
            90 => Self::Clockwise,
            180 => Self::Half,
            270 => Self::CounterClockwise,
            _ => Self::None,
        }
    }

    pub fn sideways(self) -> bool {
        matches!(self, Self::Clockwise | Self::CounterClockwise)
    }

    fn encode(self) -> u8 {
        self as u8
    }

    fn decode(value: u8) -> Self {
        match value {
            1 => Self::Clockwise,
            2 => Self::Half,
            3 => Self::CounterClockwise,
            _ => Self::None,
        }
    }
}

#[derive(Default)]
pub struct Rotator {
    #[cfg(target_os = "macos")]
    surfaces: Option<super::decoder_macos::SurfaceRotator>,
}

impl Rotator {
    pub fn rotate(&mut self, frame: &VideoFrame, rotation: Rotation) -> Option<VideoFrame> {
        if rotation == Rotation::None {
            return None;
        }
        match &frame.pixels {
            #[cfg(target_os = "macos")]
            FramePixels::Surface(buffer) => {
                if self.surfaces.is_none() {
                    self.surfaces = super::decoder_macos::SurfaceRotator::new();
                }
                self.surfaces.as_mut()?.rotate(buffer, rotation)
            }
            FramePixels::Image(image) => {
                let bytes = image.as_bytes(0)?;
                rotate_bgra(frame.width, frame.height, bytes, rotation)
            }
        }
    }
}

#[derive(Clone)]
pub struct Presented {
    pub source: VideoFrame,
    pub display: Option<VideoFrame>,
    pub rotation: Rotation,
}

impl Presented {
    pub fn new(source: VideoFrame, rotation: Rotation, rotator: &mut Rotator) -> Self {
        let display = rotator.rotate(&source, rotation);
        Self {
            source,
            display,
            rotation,
        }
    }

    pub fn shown(&self) -> &VideoFrame {
        self.display.as_ref().unwrap_or(&self.source)
    }

    pub fn images(&self) -> impl Iterator<Item = &Arc<RenderImage>> {
        [Some(&self.source), self.display.as_ref()]
            .into_iter()
            .flatten()
            .filter_map(|frame| match &frame.pixels {
                FramePixels::Image(image) => Some(image),
                #[cfg(target_os = "macos")]
                FramePixels::Surface(_) => None,
            })
    }
}

#[derive(Clone)]
pub struct FrameSlot {
    latest: Arc<Mutex<Option<Presented>>>,
    rotation: Arc<AtomicU8>,
    wake: Arc<dyn Fn() + Send + Sync>,
}

impl FrameSlot {
    pub fn new(rotation: Rotation, wake: impl Fn() + Send + Sync + 'static) -> Self {
        Self {
            latest: Arc::new(Mutex::new(None)),
            rotation: Arc::new(AtomicU8::new(rotation.encode())),
            wake: Arc::new(wake),
        }
    }

    pub fn set_rotation(&self, rotation: Rotation) {
        self.rotation.store(rotation.encode(), Ordering::Relaxed);
    }

    pub fn publish(&self, frame: VideoFrame, rotator: &mut Rotator) {
        let rotation = Rotation::decode(self.rotation.load(Ordering::Relaxed));
        let presented = Presented::new(frame, rotation, rotator);
        let Ok(mut latest) = self.latest.lock() else {
            return;
        };
        let was_empty = latest.is_none();
        *latest = Some(presented);
        drop(latest);
        if was_empty {
            (self.wake)();
        }
    }

    pub fn take(&self) -> Option<Presented> {
        self.latest.lock().ok().and_then(|mut latest| latest.take())
    }
}

pub fn rotate_bgra(
    width: u32,
    height: u32,
    pixels: &[u8],
    rotation: Rotation,
) -> Option<VideoFrame> {
    let (w, h) = (width as usize, height as usize);
    if pixels.len() < w * h * 4 {
        return None;
    }
    let (out_w, out_h) = if rotation.sideways() { (h, w) } else { (w, h) };
    let mut out = vec![0u8; w * h * 4];
    for y in 0..h {
        let row = &pixels[y * w * 4..(y + 1) * w * 4];
        for (x, pixel) in row.as_chunks::<4>().0.iter().enumerate() {
            let (nx, ny) = match rotation {
                Rotation::Clockwise => (h - 1 - y, x),
                Rotation::CounterClockwise => (y, w - 1 - x),
                Rotation::Half => (w - 1 - x, h - 1 - y),
                Rotation::None => (x, y),
            };
            let to = (ny * out_w + nx) * 4;
            out[to..to + 4].copy_from_slice(pixel);
        }
    }
    VideoFrame::from_bgra(out_w as u32, out_h as u32, out)
}

#[derive(Default)]
pub struct JpegFrames {
    scratch: Vec<u8>,
}

impl JpegFrames {
    pub fn decode(&mut self, bytes: &[u8]) -> Option<VideoFrame> {
        let decoder = JpegDecoder::new(std::io::Cursor::new(bytes)).ok()?;
        let (width, height) = decoder.dimensions();
        let color = decoder.color_type();
        let size = usize::try_from(decoder.total_bytes()).ok()?;
        self.scratch.resize(size, 0);
        decoder.read_image(&mut self.scratch).ok()?;
        let pixels = (width as usize) * (height as usize);
        let mut out = Vec::with_capacity(pixels * 4);
        match color {
            ColorType::Rgb8 => {
                for [r, g, b] in self.scratch.as_chunks::<3>().0 {
                    out.extend_from_slice(&[*b, *g, *r, 255]);
                }
            }
            ColorType::L8 => {
                for &luma in &self.scratch {
                    out.extend_from_slice(&[luma, luma, luma, 255]);
                }
            }
            ColorType::Rgba8 => {
                for [r, g, b, a] in self.scratch.as_chunks::<4>().0 {
                    out.extend_from_slice(&[*b, *g, *r, *a]);
                }
            }
            _ => return None,
        }
        VideoFrame::from_bgra(width, height, out)
    }
}
