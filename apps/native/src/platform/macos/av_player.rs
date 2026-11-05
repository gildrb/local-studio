use std::ptr::{self, NonNull};

use objc2::AllocAnyThread;
use objc2::MainThreadMarker;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_av_foundation::{
    AVPlayer, AVPlayerItem, AVPlayerItemStatus, AVPlayerItemVideoOutput, AVPlayerTimeControlStatus,
    NSValueAVFoundationExtensions,
};
use objc2_core_foundation::{CFBoolean, CFDictionary, CFNumber, CFRetained, CFString, CFType};
use objc2_core_media::{CMTime, CMTimeFlags, kCMTimeZero};
use objc2_core_video::{
    CVPixelBuffer, kCVPixelBufferIOSurfacePropertiesKey, kCVPixelBufferMetalCompatibilityKey,
    kCVPixelBufferPixelFormatTypeKey, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
};
use objc2_foundation::{NSDictionary, NSString, NSURL};

const SEEK_TIMESCALE: i32 = 600;

/// One decoded picture the renderer samples directly from its IOSurface.
pub type PlayerFrame = CFRetained<CVPixelBuffer>;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PlayerStatus {
    pub ready: bool,
    pub error: Option<String>,
    pub playing: bool,
    pub waiting: bool,
    pub current: f64,
    pub duration: Option<f64>,
    pub buffered: f64,
}

/// An `AVPlayer` whose frames are pulled through `AVPlayerItemVideoOutput` as NV12
/// IOSurfaces, so GPUI draws them without a copy.
pub struct NativePlayer {
    player: Retained<AVPlayer>,
    item: Retained<AVPlayerItem>,
    output: Retained<AVPlayerItemVideoOutput>,
    latest: Option<PlayerFrame>,
}

fn pixel_buffer_attributes() -> CFRetained<CFDictionary<CFString, CFType>> {
    let format = CFNumber::new_i32(kCVPixelFormatType_420YpCbCr8BiPlanarFullRange as i32);
    let io_surface = CFDictionary::<CFType, CFType>::empty();
    let metal = CFBoolean::new(true);
    let keys: [&CFString; 3] = unsafe {
        [
            kCVPixelBufferPixelFormatTypeKey,
            kCVPixelBufferIOSurfacePropertiesKey,
            kCVPixelBufferMetalCompatibilityKey,
        ]
    };
    let values: [&CFType; 3] = [&format, &io_surface, metal];
    CFDictionary::from_slices(&keys, &values)
}

fn url_for(source: &str) -> Option<Retained<NSURL>> {
    let string = NSString::from_str(source);
    if source.starts_with('/') {
        Some(NSURL::fileURLWithPath(&string))
    } else {
        NSURL::URLWithString(&string)
    }
}

fn seconds(time: CMTime) -> Option<f64> {
    if !time.flags.contains(CMTimeFlags::Valid)
        || time.flags.intersects(CMTimeFlags::ImpliedValueFlagsMask)
    {
        return None;
    }
    let value = unsafe { time.seconds() };
    value.is_finite().then_some(value)
}

impl NativePlayer {
    pub fn new(source: &str, _wake: Box<dyn Fn() + Send + Sync>) -> Result<Self, String> {
        let mtm = MainThreadMarker::new().ok_or("Video playback must start on the main thread.")?;
        let url = url_for(source).ok_or("The video address is not valid.")?;
        let attributes = pixel_buffer_attributes();
        let attributes: &NSDictionary<NSString, AnyObject> =
            unsafe { &*ptr::from_ref(&*attributes).cast() };
        unsafe {
            let item = AVPlayerItem::playerItemWithURL(&url, mtm);
            let output = AVPlayerItemVideoOutput::initWithPixelBufferAttributes(
                AVPlayerItemVideoOutput::alloc(),
                Some(attributes),
            );
            item.addOutput(&output);
            let player = AVPlayer::playerWithPlayerItem(Some(&item), mtm);
            Ok(Self {
                player,
                item,
                output,
                latest: None,
            })
        }
    }

    pub fn play(&mut self) {
        unsafe { self.player.play() };
    }

    pub fn pause(&mut self) {
        unsafe { self.player.pause() };
    }

    pub fn set_muted(&mut self, muted: bool) {
        unsafe { self.player.setMuted(muted) };
    }

    pub fn seek(&mut self, seconds: f64) {
        unsafe {
            let time = CMTime::with_seconds(seconds.max(0.), SEEK_TIMESCALE);
            self.player
                .seekToTime_toleranceBefore_toleranceAfter(time, kCMTimeZero, kCMTimeZero);
        }
    }

    pub fn status(&self) -> PlayerStatus {
        unsafe {
            let error = match self.item.status() {
                AVPlayerItemStatus::Failed => Some(
                    self.item
                        .error()
                        .or_else(|| self.player.error())
                        .map(|error| error.localizedDescription().to_string())
                        .unwrap_or_else(|| "The video could not be played.".to_string()),
                ),
                _ => None,
            };
            let control = self.player.timeControlStatus();
            let buffered = self
                .item
                .loadedTimeRanges()
                .iter()
                .filter_map(|value| {
                    let range = value.CMTimeRangeValue();
                    Some(seconds(range.start)? + seconds(range.duration)?)
                })
                .fold(0., f64::max);
            PlayerStatus {
                ready: self.item.status() == AVPlayerItemStatus::ReadyToPlay,
                error,
                playing: control != AVPlayerTimeControlStatus::Paused,
                waiting: control == AVPlayerTimeControlStatus::WaitingToPlayAtSpecifiedRate,
                current: seconds(self.item.currentTime()).unwrap_or(0.),
                duration: seconds(self.item.duration()),
                buffered,
            }
        }
    }

    /// The picture for the item's current time, keeping the last one while no newer exists.
    pub fn frame(&mut self) -> Option<PlayerFrame> {
        unsafe {
            let time = self.item.currentTime();
            if self.output.hasNewPixelBufferForItemTime(time)
                && let Some(buffer) = self
                    .output
                    .copyPixelBufferForItemTime_itemTimeForDisplay(time, ptr::null_mut())
                && let Some(pointer) = NonNull::new(Retained::into_raw(buffer))
            {
                self.latest = Some(CFRetained::from_raw(pointer));
            }
        }
        self.latest.clone()
    }

    pub fn frame_size(frame: &PlayerFrame) -> (f32, f32) {
        (
            objc2_core_video::CVPixelBufferGetWidth(frame) as f32,
            objc2_core_video::CVPixelBufferGetHeight(frame) as f32,
        )
    }
}

impl Drop for NativePlayer {
    fn drop(&mut self) {
        unsafe {
            self.player.pause();
            self.item.removeOutput(&self.output);
            self.player.replaceCurrentItemWithPlayerItem(None);
        }
    }
}
