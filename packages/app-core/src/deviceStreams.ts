import {
  createDeviceInputSession,
  deviceStreamEndpoints,
  type DeviceInputSession,
  type DeviceScreenSize,
  shouldForwardDeviceKeyDown,
} from "@t3tools/client-runtime/device/input";
import type { DeviceHubAccess } from "@t3tools/client-runtime/state/deviceHubAccess";
import type { DevicePlatform, EnvironmentId } from "@t3tools/contracts";
import { fitDeviceFrame } from "@t3tools/web/src/components/device/deviceFrameLayout.ts";
import {
  DEVICE_CONTROLS_RAIL_WIDTH,
  deviceDisplayAspect,
  deviceDisplayRotation,
  deviceInputDisconnectedNotice,
  deviceMediaBox,
  deviceStreamLoadingMessage,
} from "@t3tools/web/src/components/device/DeviceStreamView.logic.ts";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { deviceScreenAtom } from "./deviceState.ts";
import type { FeatureAction, FeatureContext } from "./feature.ts";

export type DeviceStreamStatus = "connecting" | "streaming" | "error";

/** Everything Rust needs to open the device's transport. A new generation restarts it. */
export type DeviceStreamTargetView = {
  readonly key: string;
  readonly generation: number;
  readonly platform: DevicePlatform;
  readonly video: string;
  readonly mjpeg: string;
  readonly iosInput: string;
  readonly androidSocket: string;
  /** A 1006 close means an expired ticket when the socket authenticates with one. */
  readonly ticketed: boolean;
};

export type DeviceAxElementView = {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type DeviceStreamView = {
  readonly key: string;
  readonly platform: DevicePlatform;
  /** The panel draws on the app background; floating viewers use a dark backdrop. */
  readonly compact: boolean;
  readonly target: DeviceStreamTargetView | null;
  readonly status: DeviceStreamStatus;
  readonly mjpeg: boolean;
  readonly controlsInset: number;
  readonly frame: { readonly width: number; readonly height: number };
  readonly media: {
    readonly width: number;
    readonly height: number;
    readonly left: number;
    readonly top: number;
  };
  readonly rotation: number;
  readonly inputNotice: string | null;
  readonly loading: {
    readonly name: string;
    readonly description: string;
    readonly message: string;
    readonly error: boolean;
  } | null;
  readonly axElements: ReadonlyArray<DeviceAxElementView>;
};

export type DeviceStreamState = {
  readonly status: DeviceStreamStatus;
  readonly detail: string | undefined;
  readonly inputConnected: boolean;
  readonly inputDetail: string | undefined;
  readonly mjpeg: boolean;
  readonly host: { readonly width: number; readonly height: number };
  readonly generation: number;
};

const INITIAL_STREAM: DeviceStreamState = {
  status: "connecting",
  detail: undefined,
  inputConnected: false,
  inputDetail: undefined,
  mjpeg: false,
  host: { width: 0, height: 0 },
  generation: 0,
};

const Phase = Schema.Literals(["begin", "move", "end"]);
const Platform = Schema.Literals(["ios", "android"]);

const StreamEventParams = Schema.decodeUnknownSync(
  Schema.Struct({
    key: Schema.String,
    stream: Schema.Number,
    platform: Platform,
    event: Schema.Union([
      Schema.Struct({
        kind: Schema.Literal("status"),
        status: Schema.Literals(["connecting", "streaming", "error"]),
        detail: Schema.optional(Schema.String),
      }),
      Schema.Struct({
        kind: Schema.Literal("input"),
        connected: Schema.Boolean,
        detail: Schema.optional(Schema.String),
      }),
      Schema.Struct({
        kind: Schema.Literal("message"),
        tag: Schema.Number,
        payload: Schema.Unknown,
      }),
      Schema.Struct({
        kind: Schema.Literal("frameSize"),
        width: Schema.Number,
        height: Schema.Number,
      }),
      Schema.Struct({ kind: Schema.Literal("mjpeg") }),
      Schema.Struct({ kind: Schema.Literal("unauthorized") }),
      Schema.Struct({ kind: Schema.Literal("stopped") }),
    ]),
  }),
);

const StreamInputParams = Schema.decodeUnknownSync(
  Schema.Struct({
    key: Schema.String,
    stream: Schema.Number,
    platform: Platform,
    input: Schema.Union([
      Schema.Struct({
        kind: Schema.Literal("touch"),
        phase: Phase,
        x: Schema.Number,
        y: Schema.Number,
      }),
      Schema.Struct({
        kind: Schema.Literal("key"),
        phase: Schema.Literals(["down", "up"]),
        code: Schema.String,
        key: Schema.String,
        metaKey: Schema.Boolean,
        ctrlKey: Schema.Boolean,
      }),
    ]),
  }),
);

const StreamLayoutParams = Schema.decodeUnknownSync(
  Schema.Struct({ key: Schema.String, width: Schema.Number, height: Schema.Number }),
);
const StreamKeyParams = Schema.decodeUnknownSync(Schema.Struct({ key: Schema.String }));

export type DeviceStreamSource = {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly hostId: string;
  readonly deviceId: string;
  readonly platform: DevicePlatform;
  readonly name: string;
  readonly description: string;
};

export type DeviceStreamViewOptions = {
  readonly visible: boolean;
  readonly compact: boolean;
  readonly controlsRail: boolean;
  readonly axElements: ReadonlyArray<DeviceAxElementView>;
};

export interface DeviceStreamService {
  readonly view: (
    get: Atom.AtomContext,
    source: DeviceStreamSource,
    options: DeviceStreamViewOptions,
  ) => DeviceStreamView;
  readonly state: (get: Atom.AtomContext, key: string) => DeviceStreamState;
  readonly readAccess: (
    get: Atom.AtomContext,
    environmentId: EnvironmentId,
    hostId: string,
  ) => DeviceHubAccess | null;
  /** The input session while its socket is open. */
  readonly session: (key: string) => DeviceInputSession | null;
  readonly refreshAccess: (environmentId: EnvironmentId) => void;
  readonly actions: Readonly<Record<string, FeatureAction>>;
}

const services = new WeakMap<FeatureContext, DeviceStreamService>();

/** One shared owner of every device stream's state, keyed by `environment:host:device`. */
export function deviceStreamService(context: FeatureContext): DeviceStreamService {
  const existing = services.get(context);
  if (existing) return existing;
  const service = createDeviceStreamService(context);
  services.set(context, service);
  return service;
}

function createDeviceStreamService(context: FeatureContext): DeviceStreamService {
  const { registry } = context;
  const streamsAtom = Atom.make<ReadonlyMap<string, DeviceStreamState>>(new Map()).pipe(
    Atom.keepAlive,
  );
  const environments = new Map<string, EnvironmentId>();
  const sessions = new Map<
    string,
    { readonly stream: number; readonly session: DeviceInputSession; open: boolean }
  >();

  const patch = (key: string, update: (current: DeviceStreamState) => DeviceStreamState) => {
    const next = new Map(registry.get(streamsAtom));
    next.set(key, update(next.get(key) ?? INITIAL_STREAM));
    registry.set(streamsAtom, next);
  };

  const readAccess = (
    get: Atom.AtomContext,
    environmentId: EnvironmentId,
    hostId: string,
  ): DeviceHubAccess | null => {
    const result = get(context.state.deviceHubAccess(environmentId));
    return AsyncResult.isSuccess(result)
      ? { ...result.value, query: { ...result.value.query, hostId } }
      : null;
  };

  const sessionFor = (key: string, stream: number, platform: DevicePlatform) => {
    const current = sessions.get(key);
    if (current && current.stream === stream) return current;
    current?.session.reset();
    const entry: { readonly stream: number; readonly session: DeviceInputSession; open: boolean } =
      {
        stream,
        open: false,
        session: createDeviceInputSession({
          platform,
          isOpen: () => sessions.get(key) === entry && entry.open,
          write: (packet) => context.send({ t: "device", stream, packet }),
          onScreen: (screen) => registry.set(deviceScreenAtom(key), screen),
        }),
      };
    sessions.set(key, entry);
    return entry;
  };

  const refreshAccess = (environmentId: EnvironmentId) =>
    registry.refresh(context.state.deviceHubAccess(environmentId));

  const view: DeviceStreamService["view"] = (get, source, options) => {
    environments.set(source.key, source.environmentId);
    const state = get(streamsAtom).get(source.key) ?? INITIAL_STREAM;
    const screen: DeviceScreenSize | null = get(deviceScreenAtom(source.key));
    const access = readAccess(get, source.environmentId, source.hostId);
    const aspect = deviceDisplayAspect(source.platform, screen);
    const controlsInset = options.controlsRail ? DEVICE_CONTROLS_RAIL_WIDTH : 0;
    const frame = fitDeviceFrame(aspect, state.host.width, state.host.height, controlsInset);
    const rotation = deviceDisplayRotation(source.platform, screen);
    const live = options.visible && access !== null;
    const status: DeviceStreamStatus = live ? state.status : "connecting";
    return {
      key: source.key,
      platform: source.platform,
      compact: options.compact,
      target: live
        ? {
            key: source.key,
            generation: state.generation,
            platform: source.platform,
            ...deviceStreamEndpoints({
              platform: source.platform,
              deviceId: source.deviceId,
              access,
            }),
            ticketed: Boolean(access.query.wsTicket),
          }
        : null,
      status,
      mjpeg: state.mjpeg,
      controlsInset,
      frame,
      media: deviceMediaBox(frame, rotation),
      rotation,
      inputNotice:
        status === "streaming" && !state.inputConnected
          ? deviceInputDisconnectedNotice(state.inputDetail)
          : null,
      loading:
        status === "streaming"
          ? null
          : {
              name: source.name,
              description: source.description,
              message: deviceStreamLoadingMessage(status, state.detail),
              error: status === "error",
            },
      axElements: options.axElements,
    };
  };

  const actions: Record<string, FeatureAction> = {
    deviceStreamEvent: async (params) => {
      const { key, stream, platform, event } = StreamEventParams(params);
      if (event.kind === "stopped") {
        const entry = sessions.get(key);
        if (entry?.stream === stream) {
          entry.session.reset();
          sessions.delete(key);
        }
        registry.set(deviceScreenAtom(key), null);
        patch(key, (current) => ({
          ...INITIAL_STREAM,
          host: current.host,
          generation: current.generation,
        }));
        return null;
      }
      const entry = sessionFor(key, stream, platform);
      switch (event.kind) {
        case "status":
          patch(key, (current) => ({ ...current, status: event.status, detail: event.detail }));
          return null;
        case "input":
          entry.open = event.connected;
          if (event.connected) {
            for (const packet of entry.session.opened())
              context.send({ t: "device", stream, packet });
          } else entry.session.reset();
          patch(key, (current) => ({
            ...current,
            inputConnected: event.connected,
            inputDetail: event.detail,
          }));
          return null;
        case "message":
          entry.session.receive(event.tag, event.payload);
          return null;
        case "frameSize":
          entry.session.frameSize(event.width, event.height);
          return null;
        case "mjpeg":
          patch(key, (current) => ({ ...current, mjpeg: true }));
          return null;
        case "unauthorized": {
          // A fresh ticket changes the target, which restarts the stream.
          const environmentId = environments.get(key);
          if (environmentId !== undefined) refreshAccess(environmentId);
          return null;
        }
      }
    },
    deviceStreamInput: async (params) => {
      const { key, stream, platform, input } = StreamInputParams(params);
      const entry = sessionFor(key, stream, platform);
      if (!entry.open) return null;
      if (input.kind === "touch") {
        entry.session.sendTouch(input.phase, input.x, input.y);
        return null;
      }
      if (input.phase === "down" && !shouldForwardDeviceKeyDown(input)) return null;
      entry.session.sendKey(input, input.phase);
      return null;
    },
    deviceStreamLayout: async (params) => {
      const { key, width, height } = StreamLayoutParams(params);
      const current = (registry.get(streamsAtom).get(key) ?? INITIAL_STREAM).host;
      if (current.width !== width || current.height !== height)
        patch(key, (state) => ({ ...state, host: { width, height } }));
      return null;
    },
    deviceStreamReconnect: async (params) => {
      const { key } = StreamKeyParams(params);
      // An expired ticket surfaces as unauthorized on restart and refreshes access then.
      patch(key, (current) => ({ ...current, generation: current.generation + 1 }));
      return null;
    },
  };

  return {
    view,
    state: (get, key) => get(streamsAtom).get(key) ?? INITIAL_STREAM,
    readAccess,
    session: (key) => {
      const entry = sessions.get(key);
      return entry?.open ? entry.session : null;
    },
    refreshAccess,
    actions,
  };
}
