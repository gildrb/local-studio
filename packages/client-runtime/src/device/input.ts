// @effect-diagnostics globalTimers:off - The Duo control queue owns its transaction timeout.
/**
 * Input and control protocol for expo-device-hub's per-device streams,
 * independent of any transport. A stream owner forwards its input socket's
 * lifecycle and messages here and writes the returned packets to the socket:
 *
 * - iOS (serve-sim): `[tag][json]` binary packets over `helper/ws`; the helper
 *   pushes its screen config (0x82) and Duo control replies (0x90).
 * - Android (serve-emu): JSON text gestures on the shared video socket.
 */
import type { DevicePlatform } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  createDuoControl,
  type DuoCommand,
  type DuoControlState,
  type DuoPose,
} from "./duoControl.ts";
import { type DeviceHubAccess, withDeviceHubQuery } from "./hubAccess.ts";

export interface DeviceScreenSize {
  readonly width: number;
  readonly height: number;
  readonly orientation: "portrait" | "portrait_upside_down" | "landscape_left" | "landscape_right";
  readonly screenId?: number;
  readonly supportsHingeAngle?: boolean;
  readonly supportsPhysicalOrientation?: boolean;
  readonly hingeAngle?: number;
  readonly hingePose?: DuoPose | null;
  readonly tableMode?: boolean;
  readonly tableModeAvailable?: boolean;
}

export type DeviceHardwareButton = "home" | "back" | "recents" | "power" | "appSwitcher";

/** One message for the input socket: a tagged binary JSON packet (iOS) or a JSON text frame (Android). */
export type DeviceInputPacket =
  | { readonly kind: "tagged"; readonly tag: number; readonly payload: unknown }
  | { readonly kind: "json"; readonly payload: unknown };

/** The parts of a DOM `KeyboardEvent` the device protocols read. */
export interface DeviceKeyInput {
  readonly code: string;
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}

// serve-sim binary WS message tags (client -> helper).
const IOS_MSG_TOUCH = 0x03;
const IOS_MSG_BUTTON = 0x04;
const IOS_MSG_KEY = 0x06;
const IOS_MSG_ORIENTATION = 0x07;
const IOS_MSG_HARDWARE_KEYBOARD = 0x0d;
const IOS_MSG_CONTROL = 0x10;
// helper -> client.
export const IOS_TAG_SCREEN_CONFIG = 0x82;
export const IOS_TAG_CONTROL_REPLY = 0x90;

const screenConfigSchema = Schema.Struct({
  width: Schema.Finite.check(Schema.isGreaterThan(0)),
  height: Schema.Finite.check(Schema.isGreaterThan(0)),
  orientation: Schema.Literals([
    "portrait",
    "portrait_upside_down",
    "landscape_left",
    "landscape_right",
  ]),
  screenId: Schema.optionalKey(Schema.Number),
  supportsHingeAngle: Schema.optionalKey(Schema.Boolean),
  supportsPhysicalOrientation: Schema.optionalKey(Schema.Boolean),
  hingeAngle: Schema.optionalKey(
    Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 180 })),
  ),
  hingePose: Schema.optionalKey(
    Schema.NullOr(Schema.Literals(["closed", "book", "open", "laptop", "tent"])),
  ),
  tableMode: Schema.optionalKey(Schema.Boolean),
  tableModeAvailable: Schema.optionalKey(Schema.Boolean),
});
const controlReplySchema = Schema.Struct({
  requestId: Schema.Int,
  ok: Schema.Boolean,
  error: Schema.optionalKey(Schema.String),
});
const decodeScreenConfig = Schema.decodeUnknownOption(screenConfigSchema);
const decodeControlReply = Schema.decodeUnknownOption(controlReplySchema);

const encoder = new TextEncoder();

/** Serialize a packet the way the hub expects it on the wire. */
export function encodeDeviceInputPacket(
  packet: DeviceInputPacket,
): Uint8Array<ArrayBuffer> | string {
  if (packet.kind === "json") return JSON.stringify(packet.payload);
  const json = encoder.encode(JSON.stringify(packet.payload));
  const out = new Uint8Array(1 + json.length);
  out[0] = packet.tag;
  out.set(json, 1);
  return out;
}

const tagged = (tag: number, payload: unknown): DeviceInputPacket => ({
  kind: "tagged",
  tag,
  payload,
});
const json = (payload: unknown): DeviceInputPacket => ({ kind: "json", payload });

const HID_USAGE_BY_CODE: Readonly<Record<string, number>> = {
  Enter: 0x28,
  Escape: 0x29,
  Backspace: 0x2a,
  Tab: 0x2b,
  Space: 0x2c,
  Minus: 0x2d,
  Equal: 0x2e,
  BracketLeft: 0x2f,
  BracketRight: 0x30,
  Backslash: 0x31,
  Semicolon: 0x33,
  Quote: 0x34,
  Backquote: 0x35,
  Comma: 0x36,
  Period: 0x37,
  Slash: 0x38,
  Delete: 0x4c,
  ArrowRight: 0x4f,
  ArrowLeft: 0x50,
  ArrowDown: 0x51,
  ArrowUp: 0x52,
  ControlLeft: 0xe0,
  ShiftLeft: 0xe1,
  AltLeft: 0xe2,
  MetaLeft: 0xe3,
  ControlRight: 0xe4,
  ShiftRight: 0xe5,
  AltRight: 0xe6,
  MetaRight: 0xe7,
};

function hidUsageForCode(code: string): number | null {
  if (/^Key[A-Z]$/.test(code)) return 0x04 + (code.charCodeAt(3) - 65);
  if (/^Digit[1-9]$/.test(code)) return 0x1e + (code.charCodeAt(5) - 49);
  if (code === "Digit0") return 0x27;
  return HID_USAGE_BY_CODE[code] ?? null;
}

const ANDROID_KEYCODE_BY_KEY: Readonly<Record<string, number>> = {
  ArrowUp: 19,
  ArrowDown: 20,
  ArrowLeft: 21,
  ArrowRight: 22,
  Tab: 61,
  Enter: 66,
  Backspace: 67,
  Delete: 112,
  Home: 122,
  End: 123,
  PageUp: 92,
  PageDown: 93,
};

const IOS_ORIENTATIONS: ReadonlyArray<DeviceScreenSize["orientation"]> = [
  "portrait",
  "landscape_left",
  "portrait_upside_down",
  "landscape_right",
];

/** The focused screen keeps Command shortcuts for the app, except reload. */
export const shouldForwardDeviceKeyDown = (key: Pick<DeviceKeyInput, "metaKey" | "key">) =>
  !key.metaKey || key.key === "r" || key.key === "R";

/** Hub endpoints for one device stream, credentials included. */
export function deviceStreamEndpoints(target: {
  readonly platform: DevicePlatform;
  readonly deviceId: string;
  readonly access: DeviceHubAccess;
  readonly panelId?: 1 | 3;
}) {
  const vendor = target.platform === "ios" ? "/vendor/serve-sim" : "/vendor/serve-emu";
  const device = encodeURIComponent(target.deviceId);
  const httpUrl = (path: string) =>
    withDeviceHubQuery(`${target.access.httpBase}${vendor}${path}`, target.access);
  const wsUrl = (path: string) =>
    withDeviceHubQuery(`${target.access.wsBase}${vendor}${path}`, target.access);
  return {
    video: httpUrl(
      `/helper/${device}${target.panelId ? `/panel/${target.panelId}` : ""}/stream.avcc`,
    ),
    mjpeg: httpUrl(`/helper/${device}/stream.mjpeg`),
    iosInput: wsUrl(`/helper/ws?device=${device}`),
    androidSocket: wsUrl(`/ws?device=${device}&frame-meta=1`),
  };
}

export interface DeviceInputSession {
  /** Packets to write as soon as the input socket opens. */
  readonly opened: () => ReadonlyArray<DeviceInputPacket>;
  /** A message the iOS helper pushed over the input socket. */
  readonly receive: (tag: number, payload: unknown) => void;
  /** Android reports its screen through decoded frame sizes; true when it changed. */
  readonly frameSize: (width: number, height: number) => boolean;
  /** The input socket closed or the stream stopped. */
  readonly reset: () => void;
  readonly screen: () => DeviceScreenSize | null;
  /** Normalized 0..1 coordinates in the displayed frame. */
  readonly sendTouch: (phase: "begin" | "move" | "end", x: number, y: number) => void;
  /** Model UVs already map to the hardware framebuffer. */
  readonly sendRawTouch: (phase: "begin" | "move" | "end", x: number, y: number) => void;
  readonly sendKey: (event: DeviceKeyInput, phase: "down" | "up") => void;
  readonly pressButton: (button: DeviceHardwareButton) => void;
  readonly rotate: () => void;
  readonly setOrientation: (orientation: DeviceScreenSize["orientation"]) => void;
  readonly controlDuo: (command: DuoCommand) => void;
}

/**
 * The input half of a device stream: maps touches, keys and buttons onto the
 * platform's packets, tracks the screen the device reports, and serializes
 * Duo control transactions against the helper's replies.
 */
export function createDeviceInputSession(options: {
  readonly platform: DevicePlatform;
  /** Whether the input socket is open right now. */
  readonly isOpen: () => boolean;
  /** Write one packet; throws when the socket refuses it. */
  readonly write: (packet: DeviceInputPacket) => void;
  readonly onScreen: (screen: DeviceScreenSize, previous: DeviceScreenSize | null) => void;
  readonly onDuoControl?: (state: DuoControlState) => void;
}): DeviceInputSession {
  const { platform } = options;
  let screen: DeviceScreenSize | null = null;
  let rotationCursor: DeviceScreenSize["orientation"] | null = null;
  let pendingOrientation: { requestId: number } | null = null;

  const duoControl = createDuoControl({
    send(request) {
      if (!options.isOpen() || !screen?.supportsHingeAngle) return false;
      if (request.command.control === "physical" && !screen.supportsPhysicalOrientation)
        return false;
      try {
        pendingOrientation = null;
        if (request.command.control === "orientation") {
          const value = request.command.value;
          pendingOrientation = { requestId: request.requestId };
          rotationCursor = value;
          // Upstream serializes orientation with hinge commands, then broadcasts config.
          // An orientation-locked app can keep its framebuffer orientation after the sensor rotates.
          options.write(tagged(IOS_MSG_ORIENTATION, { orientation: value }));
        } else options.write(tagged(IOS_MSG_CONTROL, request));
        return true;
      } catch {
        return false;
      }
    },
    onChange(state) {
      if (!state.pending) pendingOrientation = null;
      options.onDuoControl?.(state);
    },
  });

  const send = (packet: DeviceInputPacket) => {
    if (options.isOpen()) options.write(packet);
  };

  const rawPoint = (x: number, y: number) => {
    // serve-sim streams the raw framebuffer; rotated devices need input
    // remapped into that raw space.
    if (platform !== "ios" || !screen || screen.width > screen.height) return { x, y };
    switch (screen.orientation) {
      case "landscape_left":
        return { x: y, y: 1 - x };
      case "landscape_right":
        return { x: 1 - y, y: x };
      case "portrait_upside_down":
        return { x: 1 - x, y: 1 - y };
      default:
        return { x, y };
    }
  };

  return {
    opened: () =>
      platform === "ios" ? [tagged(IOS_MSG_HARDWARE_KEYBOARD, { enabled: false })] : [],
    receive(tag, payload) {
      if (tag === IOS_TAG_CONTROL_REPLY) {
        const reply = decodeControlReply(payload);
        if (Option.isSome(reply)) duoControl.receive(reply.value);
        return;
      }
      if (tag !== IOS_TAG_SCREEN_CONFIG) return;
      const config = decodeScreenConfig(payload);
      if (Option.isNone(config)) return;
      const previous = screen;
      screen = config.value;
      if (screen.hingePose && screen.hingePose !== previous?.hingePose)
        rotationCursor = screen.hingePose === "laptop" ? "landscape_left" : "portrait";
      else if (screen.orientation !== previous?.orientation) rotationCursor = screen.orientation;
      options.onScreen(screen, previous);
      if (pendingOrientation) {
        const receipt = pendingOrientation;
        pendingOrientation = null;
        duoControl.receive({ requestId: receipt.requestId, ok: true });
      }
    },
    frameSize(width, height) {
      if (platform !== "android" || (screen?.width === width && screen.height === height))
        return false;
      const previous = screen;
      screen = { width, height, orientation: width > height ? "landscape_left" : "portrait" };
      options.onScreen(screen, previous);
      return true;
    },
    reset() {
      duoControl.clear();
      rotationCursor = null;
    },
    screen: () => screen,
    sendTouch(phase, x, y) {
      if (platform === "ios") {
        send(tagged(IOS_MSG_TOUCH, { type: phase, ...rawPoint(x, y) }));
        return;
      }
      const action = phase === "begin" ? "down" : phase === "move" ? "move" : "up";
      send(json({ type: "touch", action, x, y }));
    },
    sendRawTouch(phase, x, y) {
      if (platform === "ios") send(tagged(IOS_MSG_TOUCH, { type: phase, x, y }));
    },
    sendKey(event, phase) {
      if (platform === "ios") {
        const usage = hidUsageForCode(event.code);
        if (usage !== null) send(tagged(IOS_MSG_KEY, { type: phase, usage }));
        return;
      }
      if (phase !== "down") return;
      if (event.key === "Escape") return send(json({ type: "back" }));
      const keycode = ANDROID_KEYCODE_BY_KEY[event.key];
      if (keycode !== undefined) return send(json({ type: "key", keycode }));
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
        send(json({ type: "text", text: event.key }));
      }
    },
    pressButton(button) {
      if (platform === "ios") {
        const name =
          button === "home"
            ? "home"
            : button === "appSwitcher"
              ? "app_switcher"
              : button === "power"
                ? "lock"
                : null;
        if (name) send(tagged(IOS_MSG_BUTTON, { button: name }));
        return;
      }
      const type = button === "appSwitcher" ? "recents" : button;
      if (type === "home" || type === "back" || type === "recents" || type === "power") {
        send(json({ type }));
      }
    },
    rotate() {
      if (platform !== "ios") return;
      const current = screen?.supportsHingeAngle
        ? (rotationCursor ?? screen.orientation)
        : (screen?.orientation ?? "portrait");
      const next =
        IOS_ORIENTATIONS[(IOS_ORIENTATIONS.indexOf(current) + 1) % IOS_ORIENTATIONS.length] ??
        "portrait";
      if (screen?.supportsHingeAngle) {
        rotationCursor = next;
        duoControl.enqueue({ control: "orientation", value: next });
      } else send(tagged(IOS_MSG_ORIENTATION, { orientation: next }));
    },
    setOrientation(orientation) {
      if (platform === "ios") send(tagged(IOS_MSG_ORIENTATION, { orientation }));
    },
    controlDuo: duoControl.enqueue,
  };
}
