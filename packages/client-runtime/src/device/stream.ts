// @effect-diagnostics globalFetch:off globalTimers:off - This browser and WebView transport runs without an Effect runtime.
/* oxlint-disable unicorn/prefer-add-event-listener -- Each client owns its sockets and their handlers. */

/**
 * Framework-free client for expo-device-hub's per-device streams, reached
 * through the T3 proxy. One class handles both platforms because the hub
 * vendors two servers with different wire formats:
 *
 * - iOS (serve-sim): video is an HTTP `stream.avcc` body of length-prefixed
 *   envelopes (`u32be length, u8 tag, payload`; tag 1 avcC description,
 *   2 keyframe, 3 delta, 4 JPEG seed) decoded with WebCodecs; input goes over
 *   `helper/ws?device=<udid>` as `[tag][json]` packets. When WebCodecs is
 *   unavailable (plain-http remote origins) the MJPEG endpoint is used as an
 *   `<img>` source instead.
 * - Android (serve-emu): one WebSocket at `ws?device=<serial>&frame-meta=1`
 *   carries H.264 access units prefixed with a 16-byte "SEMU" header
 *   (magic, version, key flag, pts) and accepts JSON gestures upstream.
 *
 * The decoder only runs while frames arrive and the viewer is attached; a
 * hidden panel calls `stop()` so an idle device costs nothing on the GPU.
 */
import type { DuoCommand, DuoControlState } from "./duoControl.ts";
import { createCanvasFrameSink, type DeviceFrameSink } from "./frame.ts";
import type { DeviceHubAccess } from "./hubAccess.ts";
import {
  createDeviceInputSession,
  deviceStreamEndpoints,
  type DeviceHardwareButton,
  type DeviceKeyInput,
  type DeviceScreenSize,
  encodeDeviceInputPacket,
} from "./input.ts";
import type { DevicePlatform } from "@t3tools/contracts";

export type { DeviceHardwareButton, DeviceScreenSize } from "./input.ts";

export type DeviceStreamStatus = "connecting" | "streaming" | "error";

export interface DuoPanelSinks {
  readonly cover: DeviceFrameSink;
  readonly inner: DeviceFrameSink;
  /** Invalidate captured input synchronously, before React can commit the new layout. */
  readonly onScreen?: (screen: DeviceScreenSize) => void;
}

export interface DeviceStreamEvents {
  readonly onDuoControl?: (state: DuoControlState) => void;
  /** A fixed panel cannot be decoded; the owner should return to the active flat feed. */
  readonly onDuoUnavailable?: (detail?: string) => void;
  readonly onStatus: (status: DeviceStreamStatus, detail?: string) => void;
  readonly onScreen: (screen: DeviceScreenSize) => void;
  /** The proxy rejected the credential; the owner should refresh access and reconnect. */
  readonly onUnauthorized: () => void;
  /**
   * H.264 cannot be decoded here (no WebCodecs, or the simulator's profile is
   * unsupported); the owner should show an `<img>` instead of the canvas
   * and attach it with `setMjpegImage` so the client can observe real frames.
   */
  readonly onMjpegFallback: (url: string) => void;
  /** Whether touches and keys can currently reach the device. */
  readonly onInputConnected: (connected: boolean, detail?: string) => void;
}

export interface DeviceStreamTarget {
  readonly platform: DevicePlatform;
  readonly deviceId: string;
  readonly access: DeviceHubAccess;
  /** Native iOS WebViews can use MJPEG without cross-origin fetch or secure-context support. */
  readonly preferMjpeg?: boolean;
  /** Internal fixed-panel feeds share their parent's input session. */
  readonly panelId?: 1 | 3;
  readonly videoOnly?: boolean;
}

const RETRY_DELAY_MS = 1_000;
const FIRST_FRAME_TIMEOUT_MS = 15_000;
const MJPEG_FRAME_CHECK_MS = 250;
const FRAME_DURATION_US = 16_667;
const SEMU_MAGIC = 0x53454d55;
const SEMU_HEADER_BYTES = 16;
const SEMU_FLAG_KEY = 1;
const SOFT_DECODE_QUEUE = 8;

const decoder = new TextDecoder();

const isWebCodecsSupported = (): boolean =>
  typeof globalThis !== "undefined" &&
  "VideoDecoder" in globalThis &&
  "EncodedVideoChunk" in globalThis;

/** Build the WebCodecs `avc1.PPCCLL` string from an avcC record or an SPS NAL. */
export function avcCodecString(bytes: Uint8Array): string {
  if (bytes.length < 4) return "avc1.42E01E";
  const hex = (byte: number) => byte.toString(16).padStart(2, "0");
  return `avc1.${hex(bytes[1]!)}${hex(bytes[2]!)}${hex(bytes[3]!)}`;
}

/** Split serve-emu's SEMU-framed message into metadata and the Annex-B payload. */
export function parseSemuPacket(raw: ArrayBuffer): {
  readonly data: Uint8Array;
  readonly isKey: boolean | null;
  readonly timestamp: number | null;
} {
  const bytes = new Uint8Array(raw);
  if (bytes.byteLength > SEMU_HEADER_BYTES) {
    const view = new DataView(raw, 0, SEMU_HEADER_BYTES);
    if (view.getUint32(0, false) === SEMU_MAGIC && view.getUint8(4) === 1) {
      const pts = view.getBigUint64(8, false);
      return {
        data: bytes.subarray(SEMU_HEADER_BYTES),
        isKey: (view.getUint8(5) & SEMU_FLAG_KEY) !== 0,
        timestamp: pts <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(pts) : null,
      };
    }
  }
  return { data: bytes, isKey: null, timestamp: null };
}

const isVideoSessionMessage = (text: string) => {
  try {
    const message = JSON.parse(text) as { type?: unknown };
    return message.type === "video-session";
  } catch {
    return false;
  }
};

/** Walk an Annex-B access unit for its keyframe flag and SPS bytes. */
export function scanAccessUnit(buf: Uint8Array): { isKey: boolean; sps: Uint8Array | null } {
  let isKey = false;
  let sps: Uint8Array | null = null;
  const len = buf.length;
  let i = 0;
  while (i + 2 < len) {
    if (buf[i] === 0 && buf[i + 1] === 0) {
      let codeLen = 0;
      if (buf[i + 2] === 1) codeLen = 3;
      else if (i + 3 < len && buf[i + 2] === 0 && buf[i + 3] === 1) codeLen = 4;
      if (codeLen) {
        const nalType = buf[i + codeLen]! & 0x1f;
        if (nalType === 7 && !sps) sps = buf.subarray(i + codeLen);
        if (nalType === 5) isKey = true;
        i += codeLen + 1;
        continue;
      }
    }
    i++;
  }
  return { isKey, sps };
}

export type AvccChunk = {
  readonly type: "description" | "keyframe" | "delta" | "seed";
  readonly payload: Uint8Array;
};

const AVCC_TAGS: Record<number, AvccChunk["type"] | undefined> = {
  1: "description",
  2: "keyframe",
  3: "delta",
  4: "seed",
};

/** Turns a fragmented AVCC byte stream into complete envelopes. */
export class AvccDemuxer {
  private buffer = new Uint8Array(64 * 1024);
  private length = 0;

  push(bytes: Uint8Array): AvccChunk[] {
    if (this.length + bytes.length > this.buffer.length) {
      let capacity = this.buffer.length;
      while (capacity < this.length + bytes.length) capacity *= 2;
      const grown = new Uint8Array(capacity);
      grown.set(this.buffer.subarray(0, this.length));
      this.buffer = grown;
    }
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;

    const chunks: AvccChunk[] = [];
    let offset = 0;
    while (this.length - offset >= 4) {
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + offset, 4);
      const frameLength = view.getUint32(0, false);
      if (this.length - offset - 4 < frameLength) break;
      if (frameLength >= 1) {
        const type = AVCC_TAGS[this.buffer[offset + 4]!];
        if (type) {
          chunks.push({ type, payload: this.buffer.slice(offset + 5, offset + 4 + frameLength) });
        }
      }
      offset += 4 + frameLength;
    }
    if (offset > 0) {
      this.buffer.copyWithin(0, offset, this.length);
      this.length -= offset;
    }
    return chunks;
  }

  reset(): void {
    this.length = 0;
  }
}

export interface DeviceStreamClient {
  readonly start: () => void;
  readonly stop: () => void;
  /**
   * Own the displayed MJPEG image's source and frame/error observation.
   * `stop()` detaches it; attach a fresh image for each restart.
   */
  readonly setMjpegImage: (image: HTMLImageElement | null) => void;
  /** Normalized 0..1 coordinates in the displayed frame. */
  readonly sendTouch: (phase: "begin" | "move" | "end", x: number, y: number) => void;
  readonly sendKey: (event: DeviceKeyInput, phase: "down" | "up") => void;
  readonly pressButton: (button: DeviceHardwareButton) => void;
  readonly rotate: () => void;
  readonly setOrientation: (orientation: DeviceScreenSize["orientation"]) => void;
  readonly controlDuo: (command: DuoCommand) => void;
  /** Switch between one active feed and two fixed-panel feeds without replacing HID. */
  readonly setDuoPanels: (panels: DuoPanelSinks | null) => void;
  /** Model UVs already map to the hardware framebuffer. */
  readonly sendRawTouch: (phase: "begin" | "move" | "end", x: number, y: number) => void;
}

export function createDeviceStreamClient(
  target: DeviceStreamTarget,
  output: HTMLCanvasElement | DeviceFrameSink,
  events: DeviceStreamEvents,
): DeviceStreamClient {
  const { access, platform, deviceId } = target;
  const sink = "present" in output ? output : createCanvasFrameSink(output);
  const endpoints = deviceStreamEndpoints({
    platform,
    deviceId,
    access,
    ...(target.panelId ? { panelId: target.panelId } : {}),
  });
  const useWebCodecs = isWebCodecsSupported() && !(platform === "ios" && target.preferMjpeg);

  let stopped = true;
  let socket: WebSocket | null = null;
  let controller: AbortController | null = null;
  const retryTimers = new Map<"video" | "input", ReturnType<typeof setTimeout>>();
  let primeController: AbortController | null = null;
  let videoDecoder: VideoDecoder | null = null;
  let timestamp = 0;
  let awaitingKeyframe = true;
  let firstFrame = false;
  let configuring = false;
  let mjpeg = false;
  let generation = 0;
  let decoderEpoch = 0;
  let frameTimer: ReturnType<typeof setTimeout> | null = null;
  let videoReadTimer: ReturnType<typeof setTimeout> | null = null;
  let mjpegImage: HTMLImageElement | null = null;
  let releaseImage: (() => void) | null = null;
  let videoGeneration = 0;
  let panelClients: DeviceStreamClient[] = [];
  let panelSinks: DuoPanelSinks | null = null;
  const input = createDeviceInputSession({
    platform,
    isOpen: () => !stopped && socket?.readyState === WebSocket.OPEN,
    write: (packet) => socket?.send(encodeDeviceInputPacket(packet)),
    onScreen: (screen, previous) => {
      if (platform === "android") {
        events.onScreen(screen);
        return;
      }
      panelSinks?.onScreen?.(screen);
      events.onScreen(screen);
      // A surface election can leave an existing decoder on the former
      // encoder description. Reopen only video to acquire the elected
      // surface's seed and codec configuration; HID and the viewer stay.
      if (
        panelSinks &&
        screen.supportsPhysicalOrientation &&
        previous &&
        screen.screenId !== previous.screenId
      )
        startDuoVideo(panelSinks);
    },
    ...(events.onDuoControl ? { onDuoControl: events.onDuoControl } : {}),
  });

  const mjpegUrl = () => endpoints.mjpeg;
  const setStatus = (status: DeviceStreamStatus, detail?: string) => {
    if (!stopped) events.onStatus(status, detail);
  };

  const clearFrameTimer = () => {
    if (frameTimer !== null) clearTimeout(frameTimer);
    frameTimer = null;
  };

  const fail = (detail: string) => {
    if (stopped) return;
    stop();
    events.onInputConnected(false, detail);
    events.onStatus("error", detail);
  };

  const connecting = (detail?: string) => {
    firstFrame = false;
    if (frameTimer === null) {
      frameTimer = setTimeout(
        () => fail("No video received from the device. Reconnect to try again."),
        FIRST_FRAME_TIMEOUT_MS,
      );
    }
    setStatus("connecting", detail);
  };

  const frameReceived = () => {
    if (firstFrame) return;
    firstFrame = true;
    clearFrameTimer();
    setStatus("streaming");
  };

  const observeMjpegImage = () => {
    releaseImage?.();
    releaseImage = null;
    const image = mjpegImage;
    if (!image || stopped || !mjpeg) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let released = false;
    const check = () => {
      if (released || stopped) return;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (image.naturalWidth > 0 && image.naturalHeight > 0) frameReceived();
      else {
        // Multipart images may not emit load until the response ends. Stop checking after the first frame.
        timer = setTimeout(check, MJPEG_FRAME_CHECK_MS);
      }
    };
    const error = () => {
      if (!released) fail("Could not receive the device stream. Reconnect to try again.");
    };
    image.addEventListener("load", check);
    image.addEventListener("error", error);
    releaseImage = () => {
      released = true;
      if (timer !== null) clearTimeout(timer);
      image.removeEventListener("load", check);
      image.removeEventListener("error", error);
      image.removeAttribute("src");
    };
    image.src = mjpegUrl();
    check();
  };

  const setMjpegImage = (image: HTMLImageElement | null) => {
    if (mjpegImage === image) return;
    releaseImage?.();
    releaseImage = null;
    mjpegImage = image;
    observeMjpegImage();
  };

  const fallBackToMjpeg = () => {
    if (stopped || mjpeg) return;
    mjpeg = true;
    controller?.abort();
    controller = null;
    closeDecoder();
    connecting();
    events.onMjpegFallback(mjpegUrl());
    if (!releaseImage) observeMjpegImage();
  };

  const paint = (source: CanvasImageSource, width: number, height: number) => {
    if (stopped) return;
    if (platform === "android") input.frameSize(width, height);
    if (!sink.present(source, width, height)) {
      fail("Could not display the device stream. Reconnect to try again.");
      return;
    }
    frameReceived();
  };

  const closeDecoder = () => {
    decoderEpoch++;
    try {
      videoDecoder?.close();
    } catch {
      // Already closed.
    }
    videoDecoder = null;
    awaitingKeyframe = true;
  };

  const recoverDecoder = () => {
    if (platform === "ios") fallBackToMjpeg();
    else {
      closeDecoder();
      connecting("Video decoder restarted.");
      requestKeyframe();
    }
  };

  const makeDecoder = () => {
    const feedGeneration = videoGeneration;
    const decoder = new VideoDecoder({
      output: (frame) => {
        try {
          if (
            videoDecoder === decoder &&
            (platform !== "ios" || feedGeneration === videoGeneration)
          )
            paint(frame, frame.displayWidth, frame.displayHeight);
        } finally {
          frame.close();
        }
      },
      error: () => {
        if (
          stopped ||
          videoDecoder !== decoder ||
          (platform === "ios" && feedGeneration !== videoGeneration)
        )
          return;
        recoverDecoder();
      },
    });
    return decoder;
  };

  /** iOS can fall back to MJPEG when the stream's H.264 profile is unsupported. */
  const configureDecoder = async (
    config: VideoDecoderConfig,
    isCurrent = () => !stopped,
  ): Promise<boolean> => {
    const epoch = decoderEpoch;
    const full: VideoDecoderConfig = { ...config, optimizeForLatency: true };
    const support = await VideoDecoder.isConfigSupported(full).catch(() => ({ supported: false }));
    if (!isCurrent() || epoch !== decoderEpoch) return false;
    if (!support.supported) {
      if (platform === "android") fail(`This browser cannot decode ${config.codec}.`);
      return false;
    }
    try {
      if (!videoDecoder || videoDecoder.state === "closed") videoDecoder = makeDecoder();
      videoDecoder.configure(full);
      return true;
    } catch (cause) {
      if (platform === "android") fail(`Video decoder: ${(cause as Error).message}`);
      return false;
    }
  };

  const decode = (isKey: boolean, data: Uint8Array, pts?: number | null) => {
    if (!videoDecoder || videoDecoder.state !== "configured") return;
    if (awaitingKeyframe) {
      if (!isKey) return;
      awaitingKeyframe = false;
    }
    if (videoDecoder.decodeQueueSize > SOFT_DECODE_QUEUE) {
      recoverDecoder();
      return;
    }
    try {
      videoDecoder.decode(
        new EncodedVideoChunk({
          type: isKey ? "key" : "delta",
          timestamp: pts ?? timestamp,
          data,
        }),
      );
      timestamp += FRAME_DURATION_US;
    } catch {
      recoverDecoder();
    }
  };

  const requestKeyframe = () => {
    if (platform === "android" && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "reset-video", ack: false }));
    }
  };

  const scheduleRetry = (channel: "video" | "input", run: () => void) => {
    if (stopped || retryTimers.has(channel)) return;
    retryTimers.set(
      channel,
      setTimeout(() => {
        retryTimers.delete(channel);
        run();
      }, RETRY_DELAY_MS),
    );
  };

  const handleUnauthorized = () => {
    stop();
    events.onInputConnected(false);
    events.onUnauthorized();
  };

  // iOS video: fetch the AVCC body and demux into the decoder.
  const readIosVideo = async () => {
    const lifecycle = generation;
    const feedGeneration = ++videoGeneration;
    const demuxer = new AvccDemuxer();
    const videoController = new AbortController();
    controller = videoController;
    const isCurrent = () =>
      !stopped &&
      generation === lifecycle &&
      videoGeneration === feedGeneration &&
      controller === videoController;
    let retryDetail: string | undefined;
    try {
      const response = await fetch(endpoints.video, {
        signal: videoController.signal,
        credentials: access.credentials ? "include" : "same-origin",
      });
      if (!isCurrent()) {
        await response.body?.cancel();
        return;
      }
      if (response.status === 401 || response.status === 403) return handleUnauthorized();
      if (target.panelId && [400, 404, 405, 410].includes(response.status)) {
        await response.body?.cancel();
        setStatus("error", "This Device Hub does not provide fixed Duo display feeds.");
        return;
      }
      if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);
      const reader = response.body.getReader();
      for (;;) {
        // An AVCC body can stay open after its helper stops producing frames.
        const timer = setTimeout(() => {
          if (isCurrent()) fail("Device stream stopped receiving video. Reconnect to try again.");
        }, FIRST_FRAME_TIMEOUT_MS);
        videoReadTimer = timer;
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await reader.read();
        } finally {
          clearTimeout(timer);
          if (videoReadTimer === timer) videoReadTimer = null;
        }
        const { done, value } = result;
        if (!isCurrent()) return;
        if (done) break;
        for (const chunk of demuxer.push(value)) {
          switch (chunk.type) {
            case "seed":
              void createImageBitmap(new Blob([chunk.payload as BlobPart], { type: "image/jpeg" }))
                .then((bitmap) => {
                  try {
                    if (isCurrent()) paint(bitmap, bitmap.width, bitmap.height);
                  } finally {
                    bitmap.close();
                  }
                })
                .catch(() => {});
              break;
            case "description": {
              awaitingKeyframe = true;
              const configured = await configureDecoder(
                { codec: avcCodecString(chunk.payload), description: chunk.payload },
                isCurrent,
              );
              if (!isCurrent()) return;
              if (!configured) {
                await reader.cancel().catch(() => {});
                if (!isCurrent()) return;
                if (target.videoOnly)
                  setStatus(
                    "error",
                    `This browser cannot decode the Duo panel's ${avcCodecString(chunk.payload)} stream.`,
                  );
                else fallBackToMjpeg();
                return;
              }
              break;
            }
            case "keyframe":
            case "delta":
              decode(chunk.type === "keyframe", chunk.payload);
              break;
          }
        }
      }
    } catch (cause) {
      if (!isCurrent()) return;
      retryDetail = (cause as Error).message;
    }
    if (isCurrent()) {
      controller = null;
      videoController.abort();
      closeDecoder();
      connecting(retryDetail);
      scheduleRetry("video", () => void readIosVideo());
    }
  };

  /**
   * serve-sim's helper only accepts HID and pushes its screen config once
   * screen capture is running, and the AVCC stream does not reliably start
   * it. Touching the MJPEG endpoint does; one aborted request is enough.
   */
  const primeIosHelper = async (session: number) => {
    const controller = new AbortController();
    primeController = controller;
    const timeout = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await fetch(endpoints.mjpeg, {
        signal: controller.signal,
        credentials: access.credentials ? "include" : "same-origin",
      });
      if (stopped || generation !== session) return;
      if (response.status === 401 || response.status === 403) return handleUnauthorized();
      await response.body?.getReader().read();
    } catch {
      // A failed prime just means the socket may take a retry to come up.
    } finally {
      clearTimeout(timeout);
      controller.abort();
      if (primeController === controller) primeController = null;
    }
  };

  const startDuoVideo = (panels: DuoPanelSinks) => {
    for (const panel of panelClients) panel.stop();
    // Physical handoff elects a native surface. Fixed-panel encoders can keep
    // an inactive shutdown frame after election, so this build uses one active
    // feed instead of decoding a third stream alongside the two fixed feeds.
    const ids = input.screen()?.supportsPhysicalOrientation ? ([null] as const) : ([1, 3] as const);
    panelClients = ids.map((id) => {
      const output = id === 1 ? panels.cover : panels.inner;
      return createDeviceStreamClient(
        { ...target, ...(id === null ? {} : { panelId: id }), videoOnly: true },
        {
          present(source, width, height) {
            if (id === null) {
              return sink.present(source, width, height);
            }
            // An inactive native LCD can emit its shutdown black frame. Retain its last useful image.
            if (input.screen()?.screenId !== id) return true;
            const retained = output.present(source, width, height);
            const primary = sink.present(source, width, height);
            return retained && primary;
          },
        },
        {
          onStatus: (status, detail) => {
            if (status === "error") events.onDuoUnavailable?.(detail);
          },
          onScreen: () => {},
          onInputConnected: () => {},
          onMjpegFallback: () => {},
          onUnauthorized: handleUnauthorized,
        },
      );
    });
    for (const panel of panelClients) panel.start();
  };

  // iOS input socket; also carries the screen config the helper pushes.
  const connectIosInput = async () => {
    if (stopped) return;
    const session = generation;
    await primeIosHelper(session);
    if (stopped || generation !== session) return;
    const ws = new WebSocket(endpoints.iosInput);
    ws.binaryType = "arraybuffer";
    socket = ws;
    ws.onopen = () => {
      if (stopped || socket !== ws) return;
      for (const packet of input.opened()) ws.send(encodeDeviceInputPacket(packet));
      events.onInputConnected(true);
    };
    ws.onmessage = (event) => {
      if (stopped || socket !== ws) return;
      if (!(event.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(event.data);
      if (socket !== ws || stopped || bytes.length < 1) return;
      try {
        input.receive(bytes[0] ?? 0, JSON.parse(decoder.decode(bytes.subarray(1))));
      } catch {
        // Ignore malformed config frames.
      }
    };
    ws.onclose = (event) => {
      if (socket !== ws) return;
      socket = null;
      input.reset();
      if (stopped) return;
      events.onInputConnected(
        false,
        event.reason || (event.code === 1006 ? "input socket refused" : `closed ${event.code}`),
      );
      // A rejected HTTP upgrade surfaces as 1006, including an expired stream ticket.
      if (
        event.code === 1008 ||
        event.code === 4401 ||
        (event.code === 1006 && access.query.wsTicket)
      )
        return handleUnauthorized();
      scheduleRetry("input", () => void connectIosInput());
    };
    ws.onerror = () => ws.close();
  };

  // Android: one socket for video and input.
  const connectAndroid = () => {
    if (stopped) return;
    const ws = new WebSocket(endpoints.androidSocket);
    ws.binaryType = "arraybuffer";
    socket = ws;
    ws.onopen = () => {
      if (stopped || socket !== ws) return;
      connecting();
      events.onInputConnected(true);
    };
    ws.onmessage = (event) => {
      if (stopped || socket !== ws) return;
      if (typeof event.data === "string") {
        // The encoder restarts at a new size when the device rotates; the
        // next keyframe carries a fresh SPS, so the decoder is rebuilt from it.
        if (isVideoSessionMessage(event.data)) {
          closeDecoder();
          configuring = false;
          connecting();
          requestKeyframe();
        }
        return;
      }
      if (!(event.data instanceof ArrayBuffer)) return;
      const packet = parseSemuPacket(event.data);
      const needsScan =
        packet.isKey === null ||
        (packet.isKey && (!videoDecoder || videoDecoder.state !== "configured"));
      const scanned = needsScan ? scanAccessUnit(packet.data) : null;
      const isKey = packet.isKey ?? scanned?.isKey ?? false;
      if (scanned?.sps && (!videoDecoder || videoDecoder.state !== "configured")) {
        if (configuring) return;
        configuring = true;
        const epoch = decoderEpoch;
        const isCurrent = () => !stopped && socket === ws;
        void configureDecoder({ codec: avcCodecString(scanned.sps) }, isCurrent).then(
          (configured) => {
            if (!isCurrent() || epoch !== decoderEpoch) return;
            configuring = false;
            awaitingKeyframe = true;
            if (configured) requestKeyframe();
          },
        );
        return;
      }
      if (!videoDecoder || videoDecoder.state !== "configured") {
        if (!isKey) requestKeyframe();
        return;
      }
      decode(isKey, packet.data, packet.timestamp);
    };
    ws.onclose = (event) => {
      if (socket !== ws) return;
      socket = null;
      closeDecoder();
      if (stopped) return;
      events.onInputConnected(false, event.reason || `closed ${event.code}`);
      if (
        event.code === 1008 ||
        event.code === 4401 ||
        (event.code === 1006 && access.query.wsTicket)
      )
        return handleUnauthorized();
      configuring = false;
      connecting(event.reason || undefined);
      scheduleRetry("input", connectAndroid);
    };
    ws.onerror = () => ws.close();
  };

  const start = () => {
    if (!stopped) return;
    stopped = false;
    generation++;
    configuring = false;
    connecting();
    if (platform === "ios") {
      if (!target.videoOnly) void connectIosInput();
      if (useWebCodecs) void readIosVideo();
      else fallBackToMjpeg();
    } else if (useWebCodecs) {
      connectAndroid();
    } else {
      fail("This browser cannot decode the Android stream (WebCodecs unavailable).");
    }
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    generation++;
    videoGeneration++;
    input.reset();
    for (const panel of panelClients) panel.stop();
    panelClients = [];
    panelSinks = null;
    mjpeg = false;
    clearFrameTimer();
    if (videoReadTimer !== null) clearTimeout(videoReadTimer);
    videoReadTimer = null;
    releaseImage?.();
    releaseImage = null;
    mjpegImage = null;
    for (const timer of retryTimers.values()) clearTimeout(timer);
    retryTimers.clear();
    primeController?.abort();
    primeController = null;
    controller?.abort();
    controller = null;
    const discarded = socket;
    socket = null;
    discarded?.close();
    closeDecoder();
  };

  return {
    start,
    stop,
    setMjpegImage,
    controlDuo: input.controlDuo,
    sendRawTouch: input.sendRawTouch,
    setDuoPanels(panels) {
      if (platform !== "ios" || target.videoOnly || stopped || panelSinks === panels) return;
      if (panels && !input.screen()?.supportsHingeAngle) return;
      panelSinks = panels;
      videoGeneration++;
      controller?.abort();
      controller = null;
      closeDecoder();
      const retry = retryTimers.get("video");
      if (retry) clearTimeout(retry);
      retryTimers.delete("video");
      for (const panel of panelClients) panel.stop();
      panelClients = [];
      if (!panels) {
        if (useWebCodecs) void readIosVideo();
        return;
      }
      startDuoVideo(panels);
    },
    sendTouch: input.sendTouch,
    sendKey: input.sendKey,
    pressButton: input.pressButton,
    rotate: input.rotate,
    setOrientation: input.setOrientation,
  };
}
