use std::ffi::c_void;
use std::ptr::{self, NonNull};

use objc2_core_foundation::{
    CFBoolean, CFDictionary, CFNumber, CFRetained, CFString, CFType, kCFAllocatorNull,
};
use objc2_core_media::{
    CMBlockBuffer, CMFormatDescription, CMSampleBuffer, CMTime,
    CMVideoFormatDescriptionCreateFromH264ParameterSets,
};
use objc2_core_video::{
    CVImageBuffer, CVPixelBuffer, CVPixelBufferGetHeight, CVPixelBufferGetWidth, CVPixelBufferPool,
    kCVPixelBufferHeightKey, kCVPixelBufferIOSurfacePropertiesKey,
    kCVPixelBufferMetalCompatibilityKey, kCVPixelBufferPixelFormatTypeKey, kCVPixelBufferWidthKey,
    kCVPixelFormatType_420YpCbCr8BiPlanarFullRange, kCVReturnSuccess,
};
use objc2_video_toolbox::{
    VTDecodeFrameFlags, VTDecodeInfoFlags, VTDecompressionOutputCallbackRecord,
    VTDecompressionSession, VTPixelRotationSession, VTSessionSetProperty,
    kVTDecompressionPropertyKey_RealTime, kVTPixelRotationPropertyKey_Rotation, kVTRotation_180,
    kVTRotation_CCW90, kVTRotation_CW90,
};

use super::frame::{FramePixels, Rotation, VideoFrame};

#[derive(Clone)]
pub struct PixelBuffer(CFRetained<CVPixelBuffer>);

unsafe impl Send for PixelBuffer {}
unsafe impl Sync for PixelBuffer {}

impl PixelBuffer {
    pub fn retained(&self) -> CFRetained<CVPixelBuffer> {
        self.0.clone()
    }

    fn frame(buffer: CFRetained<CVPixelBuffer>) -> VideoFrame {
        VideoFrame {
            width: CVPixelBufferGetWidth(&buffer) as u32,
            height: CVPixelBufferGetHeight(&buffer) as u32,
            pixels: FramePixels::Surface(PixelBuffer(buffer)),
        }
    }
}

fn surface_attributes(size: Option<(u32, u32)>) -> CFRetained<CFDictionary<CFString, CFType>> {
    let format = CFNumber::new_i32(kCVPixelFormatType_420YpCbCr8BiPlanarFullRange as i32);
    let io_surface = CFDictionary::<CFType, CFType>::empty();
    let metal = CFBoolean::new(true);
    let mut keys: Vec<&CFString> = unsafe {
        vec![
            kCVPixelBufferPixelFormatTypeKey,
            kCVPixelBufferIOSurfacePropertiesKey,
            kCVPixelBufferMetalCompatibilityKey,
        ]
    };
    let mut values: Vec<&CFType> = vec![&format, &io_surface, metal];
    let width;
    let height;
    if let Some((w, h)) = size {
        width = CFNumber::new_i32(w as i32);
        height = CFNumber::new_i32(h as i32);
        unsafe {
            keys.push(kCVPixelBufferWidthKey);
            keys.push(kCVPixelBufferHeightKey);
        }
        values.push(&width);
        values.push(&height);
    }
    CFDictionary::from_slices(&keys, &values)
}

struct DecodeOutput {
    status: i32,
    buffer: Option<CFRetained<CVPixelBuffer>>,
}

unsafe extern "C-unwind" fn decode_output(
    _refcon: *mut c_void,
    frame_refcon: *mut c_void,
    status: i32,
    _flags: VTDecodeInfoFlags,
    image: *mut CVImageBuffer,
    _pts: CMTime,
    _duration: CMTime,
) {
    let Some(output) = (unsafe { frame_refcon.cast::<DecodeOutput>().as_mut() }) else {
        return;
    };
    output.status = status;
    if let Some(image) = NonNull::new(image) {
        output.buffer = Some(unsafe { CFRetained::retain(image) });
    }
}

pub struct VtDecoder {
    session: CFRetained<VTDecompressionSession>,
    format: CFRetained<CMFormatDescription>,
}

unsafe impl Send for VtDecoder {}

impl VtDecoder {
    pub fn new(sps: &[u8], pps: &[u8], length_size: usize) -> Result<Self, String> {
        let sets = [
            NonNull::new(sps.as_ptr().cast_mut()).ok_or("empty SPS")?,
            NonNull::new(pps.as_ptr().cast_mut()).ok_or("empty PPS")?,
        ];
        let sizes = [sps.len(), pps.len()];
        let mut format: *const CMFormatDescription = ptr::null();
        let status = unsafe {
            CMVideoFormatDescriptionCreateFromH264ParameterSets(
                None,
                2,
                NonNull::from(&sets[0]),
                NonNull::from(&sizes[0]),
                length_size as i32,
                NonNull::from(&mut format),
            )
        };
        let format = NonNull::new(format.cast_mut())
            .filter(|_| status == 0)
            .ok_or_else(|| format!("invalid H.264 parameter sets ({status})"))?;
        let format = unsafe { CFRetained::from_raw(format) };
        let attributes = surface_attributes(None);
        let callback = VTDecompressionOutputCallbackRecord {
            decompressionOutputCallback: Some(decode_output),
            decompressionOutputRefCon: ptr::null_mut(),
        };
        let mut session: *mut VTDecompressionSession = ptr::null_mut();
        let status = unsafe {
            VTDecompressionSession::create(
                None,
                &format,
                None,
                Some(attributes.as_opaque()),
                &callback,
                NonNull::from(&mut session),
            )
        };
        let session = NonNull::new(session)
            .filter(|_| status == 0)
            .ok_or_else(|| format!("VideoToolbox refused the stream ({status})"))?;
        let session = unsafe { CFRetained::from_raw(session) };
        unsafe {
            VTSessionSetProperty(
                &session,
                kVTDecompressionPropertyKey_RealTime,
                Some(CFBoolean::new(true)),
            );
        }
        Ok(Self { session, format })
    }

    pub fn decode(&mut self, data: &[u8]) -> Result<Option<VideoFrame>, String> {
        if data.is_empty() {
            return Ok(None);
        }
        let mut block: *mut CMBlockBuffer = ptr::null_mut();
        let status = unsafe {
            CMBlockBuffer::create_with_memory_block(
                None,
                data.as_ptr().cast_mut().cast(),
                data.len(),
                kCFAllocatorNull,
                ptr::null(),
                0,
                data.len(),
                0,
                NonNull::from(&mut block),
            )
        };
        let block = NonNull::new(block)
            .filter(|_| status == 0)
            .ok_or_else(|| format!("cannot wrap the access unit ({status})"))?;
        let block = unsafe { CFRetained::from_raw(block) };
        let mut sample: *mut CMSampleBuffer = ptr::null_mut();
        let size = data.len();
        let status = unsafe {
            CMSampleBuffer::create_ready(
                None,
                Some(&block),
                Some(&self.format),
                1,
                0,
                ptr::null(),
                1,
                &size,
                NonNull::from(&mut sample),
            )
        };
        let sample = NonNull::new(sample)
            .filter(|_| status == 0)
            .ok_or_else(|| format!("cannot wrap the sample ({status})"))?;
        let sample = unsafe { CFRetained::from_raw(sample) };
        let mut output = DecodeOutput {
            status: 0,
            buffer: None,
        };
        let status = unsafe {
            self.session.decode_frame(
                &sample,
                VTDecodeFrameFlags::empty(),
                (&raw mut output).cast(),
                ptr::null_mut(),
            )
        };
        if status != 0 {
            return Err(format!("VideoToolbox decode failed ({status})"));
        }
        if output.status != 0 {
            return Err(format!("VideoToolbox decode failed ({})", output.status));
        }
        Ok(output.buffer.map(PixelBuffer::frame))
    }
}

impl Drop for VtDecoder {
    fn drop(&mut self) {
        unsafe { self.session.invalidate() };
    }
}

pub struct SurfaceRotator {
    session: CFRetained<VTPixelRotationSession>,
    rotation: Rotation,
    pool: Option<((u32, u32), CFRetained<CVPixelBufferPool>)>,
}

impl SurfaceRotator {
    pub fn new() -> Option<Self> {
        let mut session: *mut VTPixelRotationSession = ptr::null_mut();
        let status = unsafe { VTPixelRotationSession::create(None, NonNull::from(&mut session)) };
        let session = NonNull::new(session).filter(|_| status == 0)?;
        Some(Self {
            session: unsafe { CFRetained::from_raw(session) },
            rotation: Rotation::None,
            pool: None,
        })
    }

    pub fn rotate(&mut self, source: &PixelBuffer, rotation: Rotation) -> Option<VideoFrame> {
        if rotation != self.rotation {
            let value = unsafe {
                match rotation {
                    Rotation::Clockwise => kVTRotation_CW90,
                    Rotation::Half => kVTRotation_180,
                    Rotation::CounterClockwise => kVTRotation_CCW90,
                    Rotation::None => return None,
                }
            };
            let status = unsafe {
                VTSessionSetProperty(
                    &self.session,
                    kVTPixelRotationPropertyKey_Rotation,
                    Some(value),
                )
            };
            if status != 0 {
                return None;
            }
            self.rotation = rotation;
        }
        let width = CVPixelBufferGetWidth(&source.0) as u32;
        let height = CVPixelBufferGetHeight(&source.0) as u32;
        let size = if rotation.sideways() {
            (height, width)
        } else {
            (width, height)
        };
        if self.pool.as_ref().is_none_or(|(pooled, _)| *pooled != size) {
            let attributes = surface_attributes(Some(size));
            let mut pool: *mut CVPixelBufferPool = ptr::null_mut();
            let status = unsafe {
                CVPixelBufferPool::create(
                    None,
                    None,
                    Some(attributes.as_opaque()),
                    NonNull::from(&mut pool),
                )
            };
            let pool = NonNull::new(pool).filter(|_| status == kCVReturnSuccess)?;
            self.pool = Some((size, unsafe { CFRetained::from_raw(pool) }));
        }
        let (_, pool) = self.pool.as_ref()?;
        let mut target: *mut CVPixelBuffer = ptr::null_mut();
        let status = unsafe {
            CVPixelBufferPool::create_pixel_buffer(None, pool, NonNull::from(&mut target))
        };
        let target = NonNull::new(target).filter(|_| status == kCVReturnSuccess)?;
        let target = unsafe { CFRetained::from_raw(target) };
        let status = unsafe { self.session.rotate_image(&source.0, &target) };
        (status == 0).then(|| PixelBuffer::frame(target))
    }
}

impl Drop for SurfaceRotator {
    fn drop(&mut self) {
        unsafe { self.session.invalidate() };
    }
}
