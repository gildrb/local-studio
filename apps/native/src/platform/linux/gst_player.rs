use std::sync::{Arc, LazyLock, Mutex};

use gpui::RenderImage;
use gstreamer as gst;
use gstreamer::prelude::*;
use gstreamer_app as gst_app;
use gstreamer_video as gst_video;
use gstreamer_video::prelude::*;

/// One decoded picture, uploaded to the sprite atlas once.
pub type PlayerFrame = Arc<RenderImage>;

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

#[derive(Default)]
struct Shared {
    latest: Option<PlayerFrame>,
    fresh: bool,
}

/// A GStreamer `playbin` whose video sink is an `appsink` handing BGRA frames to GPUI; the
/// sink stays synced to the pipeline clock, so frames arrive at their presentation time.
pub struct NativePlayer {
    playbin: gst::Element,
    bus: gst::Bus,
    shared: Arc<Mutex<Shared>>,
    latest: Option<PlayerFrame>,
    error: Option<String>,
    ready: bool,
    wants_play: bool,
    buffering: bool,
    ended: bool,
}

fn frame_from_sample(sample: &gst::Sample) -> Option<PlayerFrame> {
    let caps = sample.caps()?;
    let info = gst_video::VideoInfo::from_caps(caps).ok()?;
    let buffer = sample.buffer()?;
    let frame = gst_video::VideoFrameRef::from_buffer_ref_readable(buffer, &info).ok()?;
    let width = frame.width();
    let height = frame.height();
    let stride = usize::try_from(*frame.plane_stride().first()?).ok()?;
    let data = frame.plane_data(0).ok()?;
    let row = width as usize * 4;
    let mut pixels = Vec::with_capacity(row * height as usize);
    for line in 0..height as usize {
        pixels.extend_from_slice(data.get(line * stride..line * stride + row)?);
    }
    let image = image::RgbaImage::from_raw(width, height, pixels)?;
    Some(Arc::new(RenderImage::new([image::Frame::new(image)])))
}

fn uri_for(source: &str) -> String {
    if source.starts_with('/') {
        url::Url::from_file_path(source)
            .map(|url| url.to_string())
            .unwrap_or_else(|()| format!("file://{source}"))
    } else {
        source.to_string()
    }
}

static GSTREAMER: LazyLock<Result<(), String>> =
    LazyLock::new(|| gst::init().map_err(|error| error.to_string()));

impl NativePlayer {
    pub fn new(source: &str, wake: Box<dyn Fn() + Send + Sync>) -> Result<Self, String> {
        GSTREAMER.clone()?;
        let wake: Arc<dyn Fn() + Send + Sync> = Arc::from(wake);
        let shared = Arc::new(Mutex::new(Shared::default()));
        let caps = gst_video::VideoCapsBuilder::new()
            .format(gst_video::VideoFormat::Bgra)
            .build();
        let sink = gst_app::AppSink::builder()
            .caps(&caps)
            .sync(true)
            .max_buffers(2)
            .drop(true)
            .build();
        let publish = {
            let shared = shared.clone();
            let wake = wake.clone();
            move |sample: Option<gst::Sample>| {
                if let Some(frame) = sample.as_ref().and_then(frame_from_sample)
                    && let Ok(mut shared) = shared.lock()
                {
                    shared.latest = Some(frame);
                    shared.fresh = true;
                }
                wake();
            }
        };
        let preroll = publish.clone();
        sink.set_callbacks(
            gst_app::AppSinkCallbacks::builder()
                .new_preroll(move |sink| {
                    preroll(sink.pull_preroll().ok());
                    Ok(gst::FlowSuccess::Ok)
                })
                .new_sample(move |sink| {
                    publish(sink.pull_sample().ok());
                    Ok(gst::FlowSuccess::Ok)
                })
                .build(),
        );
        let playbin = gst::ElementFactory::make("playbin")
            .property("uri", uri_for(source))
            .property("video-sink", &sink)
            .build()
            .map_err(|error| error.to_string())?;
        let bus = playbin
            .bus()
            .ok_or("The video pipeline has no message bus.")?;
        {
            let wake = wake.clone();
            bus.set_sync_handler(move |_, _| {
                wake();
                gst::BusSyncReply::Pass
            });
        }
        playbin
            .set_state(gst::State::Paused)
            .map_err(|error| error.to_string())?;
        Ok(Self {
            playbin,
            bus,
            shared,
            latest: None,
            error: None,
            ready: false,
            wants_play: false,
            buffering: false,
            ended: false,
        })
    }

    fn apply_state(&self) {
        let state = if self.wants_play && !self.buffering {
            gst::State::Playing
        } else {
            gst::State::Paused
        };
        let _ = self.playbin.set_state(state);
    }

    pub fn play(&mut self) {
        if self.ended {
            self.seek(0.);
            self.ended = false;
        }
        self.wants_play = true;
        self.apply_state();
    }

    pub fn pause(&mut self) {
        self.wants_play = false;
        self.apply_state();
    }

    pub fn set_muted(&mut self, muted: bool) {
        self.playbin.set_property("mute", muted);
    }

    pub fn seek(&mut self, seconds: f64) {
        self.ended = false;
        let position = gst::ClockTime::from_nseconds((seconds.max(0.) * 1e9) as u64);
        let _ = self
            .playbin
            .seek_simple(gst::SeekFlags::FLUSH | gst::SeekFlags::ACCURATE, position);
    }

    fn drain_bus(&mut self) {
        while let Some(message) = self.bus.pop() {
            match message.view() {
                gst::MessageView::Error(error) => {
                    self.error = Some(error.error().to_string());
                }
                gst::MessageView::Eos(_) => {
                    self.ended = true;
                    self.wants_play = false;
                    let _ = self.playbin.set_state(gst::State::Paused);
                }
                gst::MessageView::AsyncDone(_) => self.ready = true,
                gst::MessageView::Buffering(buffering) => {
                    let buffering = buffering.percent() < 100;
                    if buffering != self.buffering {
                        self.buffering = buffering;
                        self.apply_state();
                    }
                }
                _ => {}
            }
        }
    }

    pub fn status(&mut self) -> PlayerStatus {
        self.drain_bus();
        let seconds = |time: gst::ClockTime| time.nseconds() as f64 / 1e9;
        let duration = self.playbin.query_duration::<gst::ClockTime>().map(seconds);
        let current = if self.ended {
            duration.unwrap_or(0.)
        } else {
            self.playbin
                .query_position::<gst::ClockTime>()
                .map(seconds)
                .unwrap_or(0.)
        };
        PlayerStatus {
            ready: self.ready,
            error: self.error.clone(),
            playing: self.wants_play,
            waiting: self.wants_play && self.buffering,
            current,
            duration,
            buffered: current,
        }
    }

    pub fn frame(&mut self) -> Option<PlayerFrame> {
        if let Ok(mut shared) = self.shared.lock()
            && shared.fresh
        {
            shared.fresh = false;
            self.latest = shared.latest.clone();
        }
        self.latest.clone()
    }

    pub fn frame_size(frame: &PlayerFrame) -> (f32, f32) {
        let size = frame.size(0);
        (i32::from(size.width) as f32, i32::from(size.height) as f32)
    }
}

impl Drop for NativePlayer {
    fn drop(&mut self) {
        self.bus.unset_sync_handler();
        let _ = self.playbin.set_state(gst::State::Null);
    }
}
