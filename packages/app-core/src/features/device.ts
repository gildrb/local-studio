import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as Path from "node:path";

import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  captureDeviceScreenshot,
  DeviceScreenshotError,
} from "@t3tools/client-runtime/device/screenshot";
import type { DeviceHubAccess } from "@t3tools/client-runtime/state/deviceHubAccess";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  DeviceActionInput,
  type DeviceDetail,
  type DevicePermission,
  type DevicePlatform,
  type DeviceServiceState,
  type DeviceSummary,
  EnvironmentId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  buildDeviceControlsRailModel,
  DEVICE_RAIL_TEXT_SIZES,
  deviceScreenshotFileName,
} from "@t3tools/web/src/components/device/DeviceControlsRail.logic.ts";
import {
  buildDeviceHostUpdatesModel,
  type DeviceHostUpdateModel,
} from "@t3tools/web/src/components/device/DeviceHostUpdates.logic.ts";
import {
  buildDevicePanelModel,
  deviceHostLabel,
  deviceKey,
  deviceListRowDescription,
  devicePlatformLabel,
  deviceSetupNeeded,
  deviceSetupRequired,
  diffDeviceSessions,
} from "@t3tools/web/src/components/device/DevicePanel.logic.ts";
import {
  agentDeviceDescription,
  buildAgentDeviceSetupStatusModel,
  buildDeviceHubSetupStatusModel,
  buildDeviceSetupWizardModel,
  buildPlatformStatusModel,
  DEVICE_SETUP_STEPS,
  deviceHubDescription,
  platformSetupStatus,
  type DeviceSetupPending,
  type DeviceSetupStatusModel,
  type PlatformStatusModel,
} from "@t3tools/web/src/components/device/DeviceSetup.logic.ts";
import {
  DEVICE_COLOR_FILTERS,
  DEVICE_LOCATION_PRESETS,
  DEVICE_ORIENTATIONS,
  DEVICE_TEXT_SIZES,
  devicePermissions,
  mergeDeviceEventLog,
  parseDeviceLocation,
} from "@t3tools/web/src/components/device/DeviceToolsPanel.logic.ts";
import {
  readAndroidFold,
  setAndroidFold,
  type AndroidFoldState,
} from "@t3tools/web/src/components/device/deviceFold.ts";
import {
  type DeviceAxElement,
  type DeviceEventLogEntry,
  type DeviceForegroundInfo,
  fetchDeviceAxTree,
  subscribeDeviceEventLog,
  subscribeDeviceForeground,
} from "@t3tools/web/src/components/device/deviceHubApi.ts";
import {
  closeOrphanedDeviceMiniPlayer,
  showOpenedDeviceSession,
} from "@t3tools/web/src/components/device/deviceSessionSurfaces.ts";
import { usePreviewMiniPlayerStore } from "@t3tools/web/src/previewMiniPlayerStore.ts";
import { useRightPanelStore } from "@t3tools/web/src/rightPanelStore.ts";
import { formatEnvironmentQueryError } from "@t3tools/web/src/state/query.ts";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import {
  deviceScreenAtom,
  deviceSourceKey,
  EMPTY_DEVICE_STATE,
  readDeviceState,
} from "../deviceState.ts";
import {
  type DeviceAxElementView,
  type DeviceStreamView,
  deviceStreamService,
} from "../deviceStreams.ts";
import type { CoreFeature, FeatureContext } from "../feature.ts";
import { makeRouteRightPanelStateAtom } from "../rightPanelState.ts";

const AX_POLL_INTERVAL_MS = 2_000;
const FOLD_RETRY_MS = 3_000;
const FOLD_TIMEOUT_MS = 12_000;

type ChoiceOption<V> = { readonly value: string; readonly label: string; readonly selected: V };

export type DeviceHostUpdateView = DeviceHostUpdateModel;

export type DeviceSetupDialogView = {
  readonly environmentId: string;
  readonly step: number;
  readonly steps: ReadonlyArray<{ readonly label: string; readonly disabled: boolean }>;
  readonly hostUpdates: ReadonlyArray<DeviceHostUpdateView>;
  readonly hub: {
    readonly description: string;
    readonly enabled: boolean;
    readonly disabled: boolean;
    readonly status: DeviceSetupStatusModel | null;
  };
  readonly platforms: ReadonlyArray<PlatformStatusModel>;
  readonly check: { readonly disabled: boolean; readonly checking: boolean };
  readonly agent: {
    readonly description: string;
    readonly enabled: boolean;
    readonly disabled: boolean;
    readonly status: DeviceSetupStatusModel | null;
  };
  readonly failedDetail: string | null;
  readonly back: { readonly kind: "cancel" | "back"; readonly disabled: boolean };
  readonly next: {
    readonly kind: "continue" | "done";
    readonly label: string;
    readonly disabled: boolean;
  };
};

export type DeviceListRowView = {
  readonly hostId: string;
  readonly deviceId: string;
  readonly title: string;
  readonly description: string;
  readonly action: string;
  readonly pending: boolean;
  readonly disabled: boolean;
};

export type DeviceRailView = {
  readonly platform: DevicePlatform;
  readonly inputDisabled: boolean;
  readonly rotate: { readonly kind: "menu" | "button"; readonly disabled: boolean };
  readonly appearance: {
    readonly label: string;
    readonly icon: "sun" | "moon";
    readonly next: "light" | "dark";
    readonly disabled: boolean;
  };
  readonly textSize: {
    readonly disabled: boolean;
    readonly options: ReadonlyArray<ChoiceOption<boolean>>;
  };
  readonly toolsOpen: boolean;
  readonly screenshot: { readonly label: string; readonly disabled: boolean };
  readonly phoneView: { readonly disabled: boolean; readonly description: string | null };
  readonly flatViewDisabled: boolean;
  readonly fold: {
    readonly closed: boolean;
    readonly opened: boolean;
    readonly disabled: boolean;
    readonly error: string | null;
  } | null;
};

export type DeviceToolsView = {
  readonly isIos: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  readonly loading: boolean;
  readonly hostDiagnostics: string | null;
  readonly disabled: boolean;
  readonly foreground: string | null;
  readonly openUrl: { readonly value: string; readonly submitDisabled: boolean };
  readonly launchApp: {
    readonly placeholder: string;
    readonly value: string;
    readonly submitDisabled: boolean;
  };
  readonly settingsTitle: string;
  readonly appearance: string | null;
  readonly textSize: ReadonlyArray<ChoiceOption<boolean>>;
  readonly textSizeLabel: string | null;
  readonly liquidGlass: { readonly value: string | null; readonly disabled: boolean } | null;
  readonly colorFilter: {
    readonly options: ReadonlyArray<ChoiceOption<boolean>>;
    readonly label: string | null;
  } | null;
  readonly orientations: ReadonlyArray<ChoiceOption<boolean>> | null;
  readonly switches: ReadonlyArray<{
    readonly setting: string;
    readonly label: string;
    readonly checked: boolean;
    readonly disabled: boolean;
  }>;
  readonly axOverlay: { readonly checked: boolean; readonly disabled: boolean };
  readonly location: {
    readonly latitude: string;
    readonly longitude: string;
    readonly presets: ReadonlyArray<string>;
    readonly setDisabled: boolean;
    readonly canClear: boolean;
  };
  readonly permissions: {
    readonly appId: string;
    readonly placeholder: string;
    readonly options: ReadonlyArray<ChoiceOption<boolean>>;
    readonly label: string;
    readonly decideDisabled: boolean;
    readonly canReset: boolean;
  };
  readonly push: {
    readonly value: string;
    readonly inputDisabled: boolean;
    readonly submitDisabled: boolean;
    readonly hint: boolean;
  } | null;
  readonly eventLog: {
    readonly open: boolean;
    readonly entries: ReadonlyArray<{
      readonly id: number;
      readonly time: string;
      readonly summary: string;
    }>;
  } | null;
};

export type DevicePanelBodyView =
  | { readonly kind: "setup" }
  | {
      readonly kind: "workspace";
      readonly key: string;
      readonly errorBanner: string | null;
      readonly stream: DeviceStreamView;
      readonly rail: DeviceRailView;
      readonly tools: DeviceToolsView | null;
    }
  | {
      readonly kind: "loading";
      readonly name: string;
      readonly description: string;
      readonly message: string;
    }
  | {
      readonly kind: "list";
      readonly emptyMessage: string | null;
      readonly groups: ReadonlyArray<{
        readonly label: string;
        readonly rows: ReadonlyArray<DeviceListRowView>;
      }>;
      readonly androidHint: boolean;
      readonly refresh: {
        readonly variant: "ghost" | "outline";
        readonly align: "start" | "center";
      } | null;
    };

export type DevicePanelView = {
  readonly surfaceId: string;
  readonly environmentId: string;
  readonly hostNotice: string | null;
  readonly hostUpdates: ReadonlyArray<DeviceHostUpdateView>;
  readonly bootingNotice: string | null;
  readonly operationError: string | null;
  readonly body: DevicePanelBodyView;
};

type ToolsFields = {
  readonly openUrl: string;
  readonly launchApp: string;
  readonly latitude: string;
  readonly longitude: string;
  readonly permissionApp: string;
  readonly permission: DevicePermission;
  readonly push: string;
};

type WorkspaceUi = {
  readonly toolsOpen: boolean;
  readonly axOverlay: boolean;
  readonly screenshotPending: boolean;
  readonly screenshotError: string | null;
  readonly detail: DeviceDetail | null;
  readonly pending: boolean;
  readonly error: string | null;
  readonly foreground: DeviceForegroundInfo | null | undefined;
  readonly axElements: ReadonlyArray<DeviceAxElement>;
  readonly fold: AndroidFoldState | null;
  readonly foldPending: boolean;
  readonly foldError: string | null;
  readonly eventLogOpen: boolean;
  readonly eventLog: ReadonlyArray<DeviceEventLogEntry>;
  readonly fields: ToolsFields;
};

const INITIAL_WORKSPACE: WorkspaceUi = {
  toolsOpen: false,
  axOverlay: false,
  screenshotPending: false,
  screenshotError: null,
  detail: null,
  pending: false,
  error: null,
  foreground: undefined,
  axElements: [],
  fold: null,
  foldPending: false,
  foldError: null,
  eventLogOpen: false,
  eventLog: [],
  fields: {
    openUrl: "",
    launchApp: "",
    latitude: "",
    longitude: "",
    permissionApp: "",
    permission: "camera",
    push: "",
  },
};

type PanelUi = {
  readonly operationError: string | null;
  readonly pendingDevice: DeviceSummary | null;
};

const INITIAL_PANEL: PanelUi = { operationError: null, pendingDevice: null };

type SetupState = {
  /** A thread whose "Add device" opened setup; null while only the panel's own setup shows. */
  readonly route: ScopedThreadRef | null;
  readonly step: number;
  readonly pending: DeviceSetupPending;
};

const INITIAL_SETUP: SetupState = { route: null, step: 0, pending: null };
const setupAtoms = new WeakMap<FeatureContext, Atom.Writable<SetupState>>();

function setupAtomFor(context: FeatureContext): Atom.Writable<SetupState> {
  const existing = setupAtoms.get(context);
  if (existing) return existing;
  const atom = Atom.make<SetupState>(INITIAL_SETUP).pipe(Atom.keepAlive);
  setupAtoms.set(context, atom);
  return atom;
}

/** "Add device" opens setup until devices are onboarded, then a device tab. */
export function addDeviceSurface(context: FeatureContext, route: ScopedThreadRef): void {
  const result = context.registry.get(
    context.state.deviceEnvironment.state({ environmentId: route.environmentId, input: {} }),
  );
  const deviceState = AsyncResult.isSuccess(result) ? result.value : EMPTY_DEVICE_STATE;
  if (deviceSetupNeeded(deviceState)) {
    context.registry.set(setupAtomFor(context), { ...INITIAL_SETUP, route });
    return;
  }
  useRightPanelStore.getState().open(route, "device");
}

type LiveWorkspace = {
  readonly key: string;
  readonly route: ScopedThreadRef;
  readonly surfaceId: string;
  readonly environmentId: EnvironmentId;
  readonly device: DeviceSummary;
  readonly visible: boolean;
  readonly access: DeviceHubAccess | null;
};

const decodeAction = Schema.decodeUnknownSync(DeviceActionInput);
const SelectParams = Schema.decodeUnknownSync(
  Schema.Struct({ hostId: Schema.String, deviceId: Schema.String }),
);
const HostRetryParams = Schema.decodeUnknownSync(
  Schema.Struct({ environmentId: Schema.String, hostId: Schema.String }),
);
const StepParams = Schema.decodeUnknownSync(Schema.Struct({ step: Schema.Number }));
const EnabledParams = Schema.decodeUnknownSync(Schema.Struct({ enabled: Schema.Boolean }));
const ButtonParams = Schema.decodeUnknownSync(
  Schema.Struct({ button: Schema.Literals(["home", "back", "recents"]) }),
);
const ActParams = Schema.decodeUnknownSync(Schema.Struct({ body: Schema.Unknown }));
const FoldParams = Schema.decodeUnknownSync(
  Schema.Struct({ posture: Schema.Literals(["closed", "opened"]) }),
);
const FieldParams = Schema.decodeUnknownSync(
  Schema.Struct({
    field: Schema.Literals([
      "openUrl",
      "launchApp",
      "latitude",
      "longitude",
      "permissionApp",
      "push",
    ]),
    value: Schema.String,
  }),
);
const SubmitParams = Schema.decodeUnknownSync(
  Schema.Struct({ field: Schema.Literals(["openUrl", "launchApp", "push"]) }),
);
const LabelParams = Schema.decodeUnknownSync(Schema.Struct({ label: Schema.String }));
const ValueParams = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }));
const DecisionParams = Schema.decodeUnknownSync(
  Schema.Struct({ decision: Schema.Literals(["grant", "revoke", "reset"]) }),
);

const toastError = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

/** Runs one side effect per key while its spec is present, restarting it when the spec changes. */
function reconcile<S>(
  registry: FeatureContext["registry"],
  atom: Atom.Atom<ReadonlyMap<string, S>>,
  start: (key: string, spec: S) => () => void,
) {
  const running = new Map<string, { readonly fingerprint: string; readonly stop: () => void }>();
  registry.subscribe(
    atom,
    (next) => {
      for (const [key, entry] of running) {
        const spec = next.get(key);
        if (spec === undefined || JSON.stringify(spec) !== entry.fingerprint) {
          running.delete(key);
          entry.stop();
        }
      }
      for (const [key, spec] of next) {
        if (running.has(key)) continue;
        running.set(key, { fingerprint: JSON.stringify(spec), stop: start(key, spec) });
      }
    },
    { immediate: true },
  );
}

export function createDeviceFeature(context: FeatureContext): CoreFeature {
  const { registry, state } = context;
  const streams = deviceStreamService(context);
  const routePanelAtom = makeRouteRightPanelStateAtom(context.routeAtom);
  const panelUiAtom = Atom.make<ReadonlyMap<string, PanelUi>>(new Map()).pipe(Atom.keepAlive);
  const workspaceUiAtom = Atom.make<ReadonlyMap<string, WorkspaceUi>>(new Map()).pipe(
    Atom.keepAlive,
  );
  const setupAtom = setupAtomFor(context);
  const hostRetryAtom = Atom.make<ReadonlyMap<string, string | null>>(new Map()).pipe(
    Atom.keepAlive,
  );

  const patchPanel = (surfaceKey: string, update: (current: PanelUi) => PanelUi) => {
    const next = new Map(registry.get(panelUiAtom));
    next.set(surfaceKey, update(next.get(surfaceKey) ?? INITIAL_PANEL));
    registry.set(panelUiAtom, next);
  };
  const readWorkspace = (key: string) =>
    registry.get(workspaceUiAtom).get(key) ?? INITIAL_WORKSPACE;
  const patchWorkspace = (key: string, update: (current: WorkspaceUi) => WorkspaceUi) => {
    const next = new Map(registry.get(workspaceUiAtom));
    next.set(key, update(next.get(key) ?? INITIAL_WORKSPACE));
    registry.set(workspaceUiAtom, next);
  };

  const surfaceKeyOf = (route: ScopedThreadRef, surfaceId: string) =>
    `${scopedThreadKey(route)}\u0000${surfaceId}`;

  const deviceStateNow = (environmentId: EnvironmentId): DeviceServiceState => {
    const result = registry.get(state.deviceEnvironment.state({ environmentId, input: {} }));
    return AsyncResult.isSuccess(result) ? result.value : EMPTY_DEVICE_STATE;
  };

  /** The active device surface of the open thread, whether or not the panel shows it. */
  const activeSurfaceAtom = Atom.make((get) => {
    const panel = get(routePanelAtom);
    if (panel === null || panel.activeSurface?.kind !== "device") return null;
    return {
      route: panel.route,
      surface: panel.activeSurface,
      visible: panel.state.isOpen,
    };
  });

  const liveWorkspaceAtom = Atom.make((get): LiveWorkspace | null => {
    const active = get(activeSurfaceAtom);
    if (active === null) return null;
    const { route, surface, visible } = active;
    const { state: deviceState, loaded } = readDeviceState(get, context, route.environmentId);
    if (deviceSetupRequired(deviceState, loaded)) return null;
    const pending = get(panelUiAtom).get(surfaceKeyOf(route, surface.id))?.pendingDevice ?? null;
    const model = buildDevicePanelModel({
      state: deviceState,
      loaded,
      threadId: route.threadId,
      target: surface.target,
      pendingDevice: pending,
    });
    const device = model.activeDevice;
    if (model.body.kind !== "workspace" || device === undefined) return null;
    return {
      key: deviceSourceKey(route, { hostId: device.hostId, deviceId: device.id }),
      route,
      surfaceId: surface.id,
      environmentId: route.environmentId,
      device,
      visible,
      access: streams.readAccess(get, route.environmentId, device.hostId),
    };
  });

  const currentWorkspace = () => {
    const live = registry.get(liveWorkspaceAtom);
    if (live === null) throw new Error("No device is open in the panel.");
    return live;
  };

  // ── useDeviceControls: one confirmed settings snapshot and serialized actions per device.
  const controls = new Map<
    string,
    {
      busy: boolean;
      generation: number;
      visibleRead: { environmentId: EnvironmentId; hostId: string; deviceId: string } | null;
    }
  >();
  const controlsFor = (key: string) => {
    let entry = controls.get(key);
    if (!entry) {
      entry = { busy: false, generation: 0, visibleRead: null };
      controls.set(key, entry);
    }
    return entry;
  };
  const readDetail = (request: {
    environmentId: EnvironmentId;
    hostId: string;
    deviceId: string;
  }) =>
    runAtomCommand(
      registry,
      state.deviceEnvironment.detail,
      {
        environmentId: request.environmentId,
        input: { hostId: request.hostId, deviceId: request.deviceId },
      },
      { label: "device detail", reportFailure: false },
    );
  const applyDetail = (key: string, result: Awaited<ReturnType<typeof readDetail>>) => {
    if (result._tag === "Success")
      patchWorkspace(key, (current) => ({ ...current, detail: result.value, error: null }));
    else
      patchWorkspace(key, (current) => ({
        ...current,
        detail: null,
        error: formatEnvironmentQueryError(result.cause),
      }));
  };
  const runDeviceAction = async (live: LiveWorkspace, body: unknown) => {
    const entry = controlsFor(live.key);
    const ui = readWorkspace(live.key);
    if (entry.busy || ui.detail === null || !live.visible) return;
    const input = decodeAction({
      ...(typeof body === "object" && body !== null ? body : {}),
      hostId: live.device.hostId,
      deviceId: live.device.id,
    });
    entry.busy = true;
    // A settings read started before this action must not overwrite its confirmed result.
    const revision = ++entry.generation;
    patchWorkspace(live.key, (current) => ({ ...current, pending: true, error: null }));
    try {
      const result = await runAtomCommand(
        registry,
        state.deviceEnvironment.action,
        { environmentId: live.environmentId, input },
        { label: "device action", reportFailure: false },
      );
      if (entry.generation !== revision) {
        const request = entry.visibleRead;
        if (!request) return;
        // Reopening can read settings before the host command finishes. Confirm them again
        // after it settles, keeping actions serialized through this refresh.
        const refreshRevision = ++entry.generation;
        const refreshed = await readDetail(request);
        if (entry.generation === refreshRevision) applyDetail(live.key, refreshed);
        return;
      }
      if (result._tag === "Success")
        patchWorkspace(live.key, (current) => ({ ...current, detail: result.value }));
      else
        patchWorkspace(live.key, (current) => ({
          ...current,
          error: formatEnvironmentQueryError(result.cause),
        }));
    } finally {
      entry.busy = false;
      patchWorkspace(live.key, (current) => ({ ...current, pending: false }));
    }
  };

  // ── Effects keyed by what the web mounts.
  const renderedAtom = Atom.make((get): ReadonlyMap<string, { readonly surface: string }> => {
    const live = get(liveWorkspaceAtom);
    return live === null ? new Map() : new Map([[live.key, { surface: live.surfaceId }]]);
  });
  reconcile(registry, renderedAtom, (key) => () => {
    const next = new Map(registry.get(workspaceUiAtom));
    next.delete(key);
    registry.set(workspaceUiAtom, next);
  });

  const visibleAtom = Atom.make(
    (
      get,
    ): ReadonlyMap<
      string,
      { readonly environmentId: string; readonly hostId: string; readonly deviceId: string }
    > => {
      const live = get(liveWorkspaceAtom);
      return live === null || !live.visible
        ? new Map()
        : new Map([
            [
              live.key,
              {
                environmentId: live.environmentId,
                hostId: live.device.hostId,
                deviceId: live.device.id,
              },
            ],
          ]);
    },
  );
  reconcile(registry, visibleAtom, (key, spec) => {
    const entry = controlsFor(key);
    const revision = ++entry.generation;
    const request = {
      environmentId: EnvironmentId.make(spec.environmentId),
      hostId: spec.hostId,
      deviceId: spec.deviceId,
    };
    entry.visibleRead = request;
    void readDetail(request).then((result) => {
      if (entry.generation === revision) applyDetail(key, result);
    });
    return () => {
      entry.visibleRead = null;
      entry.generation++;
    };
  });

  const accessSpec = (live: LiveWorkspace) =>
    live.access === null
      ? null
      : {
          access: live.access,
          platform: live.device.platform,
          deviceId: live.device.id,
        };

  const foregroundAtom = Atom.make((get) => {
    const live = get(liveWorkspaceAtom);
    const spec = live?.visible ? accessSpec(live) : null;
    return live === null || spec === null ? new Map() : new Map([[live.key, spec]]);
  });
  reconcile(registry, foregroundAtom, (key, spec) => {
    let active = true;
    const unsubscribe = subscribeDeviceForeground(spec, (app) => {
      if (active) patchWorkspace(key, (current) => ({ ...current, foreground: app }));
    });
    return () => {
      active = false;
      unsubscribe();
      patchWorkspace(key, (current) => ({ ...current, foreground: undefined }));
    };
  });

  const axAtom = Atom.make((get) => {
    const live = get(liveWorkspaceAtom);
    if (live === null || !live.visible) return new Map();
    const spec = accessSpec(live);
    const ui = get(workspaceUiAtom).get(live.key);
    return spec === null || !ui?.axOverlay ? new Map() : new Map([[live.key, spec]]);
  });
  reconcile(registry, axAtom, (key, target) => {
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const poll = async () => {
      controller = new AbortController();
      try {
        const tree = await fetchDeviceAxTree(target, controller.signal);
        if (!stopped) patchWorkspace(key, (current) => ({ ...current, axElements: tree.elements }));
      } catch {
        // Keep the last good tree; the next poll retries.
      }
      if (!stopped) timer = setTimeout(() => void poll(), AX_POLL_INTERVAL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      controller?.abort();
      clearTimeout(timer);
      patchWorkspace(key, (current) => ({ ...current, axElements: [] }));
    };
  });

  const foldAtom = Atom.make((get) => {
    const live = get(liveWorkspaceAtom);
    if (
      live === null ||
      !live.visible ||
      live.device.platform !== "android" ||
      live.access === null
    )
      return new Map();
    const stream = streams.state(get, live.key);
    const ui = get(workspaceUiAtom).get(live.key) ?? INITIAL_WORKSPACE;
    const screen = get(deviceScreenAtom(live.key));
    if (stream.status !== "streaming" || ui.foldPending || screen === null) return new Map();
    return new Map([
      [
        live.key,
        {
          access: live.access,
          deviceId: live.device.id,
          width: screen.width,
          height: screen.height,
        },
      ],
    ]);
  });
  reconcile(registry, foldAtom, (key, spec) => {
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      void readAndroidFold(spec.access, spec.deviceId, controller.signal)
        .then((fold) => {
          if (!controller.signal.aborted) patchWorkspace(key, (current) => ({ ...current, fold }));
        })
        .catch(() => {
          if (!controller.signal.aborted) retry = setTimeout(read, FOLD_RETRY_MS);
        });
    };
    read();
    return () => {
      controller.abort();
      clearTimeout(retry);
    };
  });

  const eventLogAtom = Atom.make((get) => {
    const live = get(liveWorkspaceAtom);
    if (live === null || live.device.platform !== "ios") return new Map();
    const spec = accessSpec(live);
    const ui = get(workspaceUiAtom).get(live.key);
    return spec === null || !ui?.toolsOpen || !ui.eventLogOpen
      ? new Map()
      : new Map([[live.key, spec]]);
  });
  reconcile(registry, eventLogAtom, (key, spec) => {
    const unsubscribe = subscribeDeviceEventLog(spec, (incoming, reset) => {
      patchWorkspace(key, (current) => ({
        ...current,
        eventLog: mergeDeviceEventLog(current.eventLog, incoming, reset),
      }));
    });
    return () => {
      unsubscribe();
      patchWorkspace(key, (current) => ({ ...current, eventLog: [] }));
    };
  });

  // Opening the panel lists devices; setup never grants permission to install or start helpers.
  const listAtom = Atom.make((get) => {
    const active = get(activeSurfaceAtom);
    if (active === null || !active.visible) return new Map();
    const { state: deviceState, loaded } = readDeviceState(
      get,
      context,
      active.route.environmentId,
    );
    if (!loaded || deviceState.hostStatus === "disabled") return new Map();
    return new Map([[active.route.environmentId, { surface: active.surface.id }]]);
  });
  reconcile(registry, listAtom, (environmentId) => {
    void runAtomCommand(
      registry,
      state.deviceEnvironment.list,
      { environmentId: EnvironmentId.make(environmentId), input: {} },
      { label: "device list", reportFailure: false },
    );
    return () => {};
  });

  // A device the agent opens floats over chat or becomes a panel tab.
  const sessionBaselines = new Map<string, ReadonlySet<string>>();
  registry.subscribe(
    Atom.make((get) => {
      const route = get(context.routeAtom);
      if (route === null) return null;
      const { state: deviceState, loaded } = readDeviceState(get, context, route.environmentId);
      if (!loaded) return null;
      return {
        route,
        sessions: deviceState.sessions,
        devices: deviceState.devices,
        floating: get(context.clientSettingsAtom).browserAutoShowFloatingPreview,
      };
    }),
    (value) => {
      if (value === null) return;
      const threadKey = `${value.route.environmentId}:${value.route.threadId}`;
      const { baseline, opened } = diffDeviceSessions({
        state: { sessions: value.sessions, devices: value.devices },
        threadId: value.route.threadId,
        previous: sessionBaselines.get(threadKey),
      });
      sessionBaselines.set(threadKey, baseline);
      for (const target of opened) showOpenedDeviceSession(value.route, target, value.floating);
      closeOrphanedDeviceMiniPlayer(value.route, value.sessions);
    },
    { immediate: true },
  );

  // ── Views.
  const setupDialogAtom = Atom.make((get): DeviceSetupDialogView | null => {
    const setup = get(setupAtom);
    const active = get(activeSurfaceAtom);
    let environmentId: EnvironmentId | null = null;
    if (active !== null && active.visible) {
      const { state: deviceState, loaded } = readDeviceState(
        get,
        context,
        active.route.environmentId,
      );
      if (deviceSetupRequired(deviceState, loaded)) environmentId = active.route.environmentId;
    }
    const route = get(context.routeAtom);
    if (
      environmentId === null &&
      setup.route !== null &&
      route !== null &&
      scopedThreadKey(route) === scopedThreadKey(setup.route)
    )
      environmentId = setup.route.environmentId;
    if (environmentId === null) return null;
    const { state: deviceState } = readDeviceState(get, context, environmentId);
    const wizard = buildDeviceSetupWizardModel({
      state: deviceState,
      step: setup.step,
      pending: setup.pending,
    });
    return {
      environmentId,
      step: setup.step,
      steps: DEVICE_SETUP_STEPS.map((label, index) => ({
        label,
        disabled: wizard.stepDisabled[index] ?? true,
      })),
      hostUpdates: buildDeviceHostUpdatesModel({
        state: deviceState,
        pendingHostId: get(hostRetryAtom).get(environmentId) ?? null,
      }),
      hub: {
        description: deviceHubDescription,
        enabled: wizard.enabled,
        disabled: wizard.hubSwitchDisabled,
        status: buildDeviceHubSetupStatusModel({
          state: deviceState,
          pending: wizard.hubStatusPending,
          compact: false,
        }),
      },
      platforms: (["ios", "android"] as const).map((platform) =>
        buildPlatformStatusModel({
          platform: platform === "ios" ? "iOS" : "Android",
          status: platformSetupStatus(deviceState, platform),
          compact: false,
        }),
      ),
      check: { disabled: wizard.checkDisabled, checking: setup.pending === "check" },
      agent: {
        description: agentDeviceDescription,
        enabled: deviceState.agentAccessEnabled,
        disabled: wizard.agentSwitchDisabled,
        status: buildAgentDeviceSetupStatusModel({
          state: deviceState,
          pending: setup.pending === "agent",
          compact: false,
        }),
      },
      failedDetail: wizard.failedDetail,
      back:
        wizard.back.kind === "cancel"
          ? { kind: "cancel", disabled: false }
          : { kind: "back", disabled: wizard.back.disabled },
      next: wizard.next,
    };
  });

  const toolsView = (
    live: LiveWorkspace,
    ui: WorkspaceUi,
    hostDiagnostics: string | undefined,
  ): DeviceToolsView => {
    const isIos = live.device.platform === "ios";
    const settings = ui.detail?.settings;
    const disabled = ui.pending || ui.detail === null || !live.visible;
    const foregroundApp =
      ui.foreground === undefined ? (ui.detail?.foregroundApp ?? null) : ui.foreground;
    const options = <V extends string>(
      list: ReadonlyArray<{ readonly value: V; readonly label: string }>,
      current: V | null | undefined,
    ) =>
      list.map((entry) => ({
        value: entry.value,
        label: entry.label,
        selected: entry.value === current,
      }));
    const label = <V extends string>(
      list: ReadonlyArray<{ readonly value: V; readonly label: string }>,
      current: V | null | undefined,
    ) => list.find((entry) => entry.value === current)?.label ?? null;
    const switchRow = (setting: string, text: string, checked: boolean | undefined) => ({
      setting,
      label: text,
      checked: checked ?? false,
      disabled: disabled || checked === undefined,
    });
    const permissionApp = ui.fields.permissionApp.trim() || (foregroundApp?.id ?? "");
    const permissions = devicePermissions(live.device.platform);
    return {
      isIos,
      pending: ui.pending,
      error: ui.error,
      loading: ui.detail === null && !ui.error,
      hostDiagnostics: hostDiagnostics ?? null,
      disabled,
      foreground: foregroundApp?.id ?? null,
      openUrl: {
        value: ui.fields.openUrl,
        submitDisabled: disabled || ui.fields.openUrl.trim().length === 0,
      },
      launchApp: {
        placeholder: isIos ? "Bundle ID to launch" : "Package name to launch",
        value: ui.fields.launchApp,
        submitDisabled: disabled || ui.fields.launchApp.trim().length === 0,
      },
      settingsTitle: isIos ? "Simulator" : "Emulator",
      appearance: settings?.appearance ?? null,
      textSize: options(DEVICE_TEXT_SIZES, settings?.textSize),
      textSizeLabel: label(DEVICE_TEXT_SIZES, settings?.textSize),
      liquidGlass: isIos
        ? {
            value: settings?.liquidGlass ?? null,
            disabled: disabled || settings?.liquidGlass === undefined,
          }
        : null,
      colorFilter: isIos
        ? {
            options: options(DEVICE_COLOR_FILTERS, settings?.colorFilter),
            label: label(DEVICE_COLOR_FILTERS, settings?.colorFilter),
          }
        : null,
      orientations: isIos ? null : options(DEVICE_ORIENTATIONS, null),
      switches: isIos
        ? [
            switchRow("reduceMotion", "Reduce Motion", settings?.reduceMotion),
            switchRow("increaseContrast", "Increase Contrast", settings?.increaseContrast),
            switchRow("reduceTransparency", "Reduce Transparency", settings?.reduceTransparency),
            switchRow("showBorders", "Show Borders", settings?.showBorders),
            switchRow("voiceOver", "VoiceOver", settings?.voiceOver),
          ]
        : [
            switchRow("reduceMotion", "Reduce Motion", settings?.reduceMotion),
            switchRow("networkEnabled", "Network", settings?.networkEnabled),
          ],
      axOverlay: { checked: ui.axOverlay, disabled: live.access === null },
      location: {
        latitude: ui.fields.latitude,
        longitude: ui.fields.longitude,
        presets: DEVICE_LOCATION_PRESETS.map((preset) => preset.label),
        setDisabled:
          disabled || parseDeviceLocation(ui.fields.latitude, ui.fields.longitude) === null,
        canClear: isIos,
      },
      permissions: {
        appId: ui.fields.permissionApp,
        placeholder: foregroundApp?.id || "App ID",
        options: options(permissions, ui.fields.permission),
        label: label(permissions, ui.fields.permission) ?? "Unknown",
        decideDisabled: disabled || !permissionApp,
        canReset: isIos,
      },
      push: isIos
        ? {
            value: ui.fields.push,
            inputDisabled: disabled || !foregroundApp,
            submitDisabled: disabled || !foregroundApp || ui.fields.push.trim().length === 0,
            hint: !foregroundApp,
          }
        : null,
      eventLog:
        isIos && live.access !== null
          ? {
              open: ui.eventLogOpen,
              entries: ui.eventLog.map((entry) => ({
                id: entry.id,
                time: entry.timestamp.slice(11, 19),
                summary: entry.summary,
              })),
            }
          : null,
    };
  };

  const panelAtom = Atom.make((get): DevicePanelView | null => {
    const active = get(activeSurfaceAtom);
    if (active === null) return null;
    const { route, surface, visible } = active;
    const environmentId = route.environmentId;
    const { state: deviceState, loaded } = readDeviceState(get, context, environmentId);
    const surfaceKey = surfaceKeyOf(route, surface.id);
    const panelUi = get(panelUiAtom).get(surfaceKey) ?? INITIAL_PANEL;
    if (deviceSetupRequired(deviceState, loaded)) {
      return {
        surfaceId: surface.id,
        environmentId,
        hostNotice: null,
        hostUpdates: [],
        bootingNotice: null,
        operationError: null,
        body: { kind: "setup" },
      };
    }
    const model = buildDevicePanelModel({
      state: deviceState,
      loaded,
      threadId: route.threadId,
      target: surface.target,
      pendingDevice: panelUi.pendingDevice,
    });
    const pendingKey = panelUi.pendingDevice ? deviceKey(panelUi.pendingDevice) : null;
    const body = ((): DevicePanelBodyView => {
      const live = get(liveWorkspaceAtom);
      if (model.body.kind === "workspace" && live !== null) {
        const ui = get(workspaceUiAtom).get(live.key) ?? INITIAL_WORKSPACE;
        const device = live.device;
        const stream = streams.view(
          get,
          {
            key: live.key,
            environmentId,
            hostId: device.hostId,
            deviceId: device.id,
            platform: device.platform,
            name: device.name,
            description: `${deviceHostLabel(deviceState, device.hostId)} · ${device.version}`,
          },
          {
            visible,
            compact: false,
            controlsRail: true,
            axElements: ui.axElements.map((element): DeviceAxElementView => ({
              id: element.id,
              label: element.label,
              x: element.x,
              y: element.y,
              width: element.width,
              height: element.height,
            })),
          },
        );
        const streamState = streams.state(get, live.key);
        const streaming = visible && live.access !== null && streamState.status === "streaming";
        const rail = buildDeviceControlsRailModel({
          platform: device.platform,
          inputConnected: visible && live.access !== null && streamState.inputConnected,
          controlsDisabled: ui.pending || ui.detail === null || !visible,
          settings: ui.detail?.settings,
          streaming,
          phoneUnavailableReason: "3D is not available in the native app yet.",
          keyboardAttached: null,
          screenshotPending: ui.screenshotPending,
        });
        const foldEnabled = streaming;
        return {
          kind: "workspace",
          key: live.key,
          errorBanner: ui.screenshotError ?? (ui.error && !ui.toolsOpen ? ui.error : null),
          stream,
          rail: {
            platform: device.platform,
            inputDisabled: rail.inputDisabled,
            rotate: rail.rotate,
            appearance: rail.appearance,
            textSize: {
              disabled: rail.textSize.disabled,
              options: DEVICE_RAIL_TEXT_SIZES.map(([value, text]) => ({
                value,
                label: text,
                selected: value === rail.textSize.value,
              })),
            },
            toolsOpen: ui.toolsOpen,
            screenshot: rail.screenshot,
            phoneView: rail.phoneView,
            flatViewDisabled: rail.flatViewDisabled,
            fold:
              device.platform === "android" && ui.fold?.supported && visible
                ? {
                    closed: ui.fold.posture === "closed",
                    opened: ui.fold.posture === "opened",
                    disabled: ui.foldPending || !foldEnabled,
                    error: ui.foldError,
                  }
                : null,
          },
          tools: ui.toolsOpen ? toolsView(live, ui, deviceState.hostStatusDetail) : null,
        };
      }
      if (model.body.kind === "loading" || model.body.kind === "workspace") {
        return model.body.kind === "loading"
          ? model.body
          : { kind: "loading", name: "Devices", description: "", message: "Finding devices…" };
      }
      const list = model.body;
      return {
        kind: "list",
        emptyMessage: list.emptyMessage,
        groups: list.showGroups
          ? model.groups.map((group) => ({
              label: devicePlatformLabel(group.platform),
              rows: group.devices.map((device) => ({
                hostId: device.hostId,
                deviceId: device.id,
                title: device.name,
                description: deviceListRowDescription(deviceState, device),
                action: device.booted ? "Open" : "Start",
                pending: pendingKey === deviceKey(device),
                disabled: pendingKey !== null,
              })),
            }))
          : [],
        androidHint: list.androidHint,
        refresh: list.refresh,
      };
    })();
    return {
      surfaceId: surface.id,
      environmentId,
      hostNotice: model.hostNotice,
      hostUpdates: buildDeviceHostUpdatesModel({
        state: deviceState,
        pendingHostId: get(hostRetryAtom).get(environmentId) ?? null,
      }),
      bootingNotice: model.bootingNotice,
      operationError: panelUi.operationError,
      body,
    };
  });

  // ── Actions.
  const currentActive = () => {
    const active = registry.get(activeSurfaceAtom);
    if (active === null) throw new Error("No device surface is open.");
    return active;
  };

  const configure = async (
    kind: NonNullable<DeviceSetupPending>,
    input: { enabled?: boolean; agentAccessEnabled?: boolean; onboardingCompleted?: boolean },
  ) => {
    const dialog = registry.get(setupDialogAtom);
    if (dialog === null) return;
    registry.set(setupAtom, { ...registry.get(setupAtom), pending: kind });
    try {
      const result = await runAtomCommand(
        registry,
        state.deviceEnvironment.configure,
        { environmentId: EnvironmentId.make(dialog.environmentId), input },
        { label: "configure devices" },
      );
      if (kind === "complete" && result._tag === "Success") {
        const setup = registry.get(setupAtom);
        if (setup.route !== null) useRightPanelStore.getState().open(setup.route, "device");
        registry.set(setupAtom, INITIAL_SETUP);
        return;
      }
    } finally {
      registry.set(setupAtom, { ...registry.get(setupAtom), pending: null });
    }
  };

  const closeSetup = () => {
    const setup = registry.get(setupAtom);
    const active = registry.get(activeSurfaceAtom);
    registry.set(setupAtom, INITIAL_SETUP);
    if (setup.route !== null) return;
    if (active === null) return;
    // Dismissing the panel's setup closes the device tab and keeps the panel open.
    useRightPanelStore.getState().closeSurface(active.route, active.surface.id);
    useRightPanelStore.getState().show(active.route);
  };

  const selectDevice = async (hostId: string, deviceId: string) => {
    const { route, surface } = currentActive();
    const deviceState = deviceStateNow(route.environmentId);
    const device = deviceState.devices.find(
      (candidate) => candidate.hostId === hostId && candidate.id === deviceId,
    );
    if (!device) return;
    const surfaceKey = surfaceKeyOf(route, surface.id);
    patchPanel(surfaceKey, () => ({ operationError: null, pendingDevice: device }));
    try {
      const result = await runAtomCommand(
        registry,
        state.deviceEnvironment.open,
        {
          environmentId: route.environmentId,
          input: {
            threadId: route.threadId,
            hostId: device.hostId,
            deviceId: device.id,
            platform: device.platform,
          },
        },
        { label: "open device" },
      );
      if (result._tag === "Failure")
        patchPanel(surfaceKey, (current) => ({
          ...current,
          operationError: formatEnvironmentQueryError(result.cause),
        }));
      else
        useRightPanelStore.getState().openDevice(route, {
          hostId: result.value.hostId,
          deviceId: result.value.deviceId,
          platform: device.platform,
          name: device.name,
        });
    } finally {
      patchPanel(surfaceKey, (current) => ({ ...current, pendingDevice: null }));
    }
  };

  const updateField = (key: string, field: keyof ToolsFields, value: string) =>
    patchWorkspace(key, (current) => ({
      ...current,
      fields: { ...current.fields, [field]: value },
    }));

  const changeFold = (posture: "closed" | "opened") => {
    const live = currentWorkspace();
    const ui = readWorkspace(live.key);
    const fold = ui.fold;
    if (ui.foldPending || fold === null || live.access === null) return;
    const body = registry.get(panelAtom)?.body;
    if (body?.kind !== "workspace" || body.rail.fold?.disabled !== false) return;
    patchWorkspace(live.key, (current) => ({ ...current, foldPending: true, foldError: null }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FOLD_TIMEOUT_MS);
    void setAndroidFold(live.access, live.device.id, posture, controller.signal)
      .then((next) => patchWorkspace(live.key, (current) => ({ ...current, fold: next })))
      .catch((cause: unknown) =>
        patchWorkspace(live.key, (current) => ({
          ...current,
          foldError: controller.signal.aborted
            ? "Fold command timed out."
            : toastError(cause, "Could not change fold posture."),
        })),
      )
      .finally(() => {
        clearTimeout(timeout);
        patchWorkspace(live.key, (current) => ({ ...current, foldPending: false }));
      });
  };

  const saveScreenshot = async () => {
    const live = currentWorkspace();
    const access = live.access;
    if (access === null || readWorkspace(live.key).screenshotPending || !live.visible) return;
    patchWorkspace(live.key, (current) => ({
      ...current,
      screenshotPending: true,
      screenshotError: null,
    }));
    try {
      const image = await captureDeviceScreenshot(
        { access, platform: live.device.platform, deviceId: live.device.id },
        new AbortController().signal,
      );
      const directory = Path.join(homedir(), "Downloads");
      await mkdir(directory, { recursive: true });
      const path = Path.join(directory, deviceScreenshotFileName(live.device.name, Date.now()));
      await writeFile(path, new Uint8Array(await image.arrayBuffer()));
      context.addToast({
        layout: "plain",
        type: "success",
        title: "Screenshot saved",
        description: path,
      });
    } catch (cause) {
      if (cause instanceof DeviceScreenshotError && cause.status === 401)
        streams.refreshAccess(live.environmentId);
      patchWorkspace(live.key, (current) => ({
        ...current,
        screenshotError: toastError(cause, "Screenshot capture failed. Try again."),
      }));
    } finally {
      patchWorkspace(live.key, (current) => ({ ...current, screenshotPending: false }));
    }
  };

  const closeActive = async (powerOff: boolean) => {
    const live = currentWorkspace();
    const route = live.route;
    if (!powerOff) {
      useRightPanelStore.getState().closeSurface(route, live.surfaceId);
      return;
    }
    const surfaceKey = surfaceKeyOf(route, live.surfaceId);
    patchPanel(surfaceKey, (current) => ({ ...current, operationError: null }));
    const result = await runAtomCommand(
      registry,
      state.deviceEnvironment.close,
      {
        environmentId: live.environmentId,
        input: {
          threadId: route.threadId,
          hostId: live.device.hostId,
          deviceId: live.device.id,
          shutdown: true,
        },
      },
      { label: "power off device" },
    );
    if (result._tag === "Failure")
      patchPanel(surfaceKey, (current) => ({
        ...current,
        operationError: formatEnvironmentQueryError(result.cause),
      }));
    else useRightPanelStore.getState().closeSurface(route, live.surfaceId);
  };

  return {
    views: { devicePanel: panelAtom, deviceSetup: setupDialogAtom },
    actions: {
      ...streams.actions,
      devicePanelSelect: async (params) => {
        const { hostId, deviceId } = SelectParams(params);
        await selectDevice(hostId, deviceId);
        return null;
      },
      devicePanelRefresh: async () => {
        const { route } = currentActive();
        await runAtomCommand(
          registry,
          state.deviceEnvironment.list,
          { environmentId: route.environmentId, input: {} },
          { label: "device list", reportFailure: false },
        );
        return null;
      },
      devicePanelDismissError: async () => {
        const { route, surface } = currentActive();
        patchPanel(surfaceKeyOf(route, surface.id), (current) => ({
          ...current,
          operationError: null,
        }));
        return null;
      },
      deviceHostRetry: async (params) => {
        const { environmentId, hostId } = HostRetryParams(params);
        const set = (value: string | null) => {
          const next = new Map(registry.get(hostRetryAtom));
          next.set(environmentId, value);
          registry.set(hostRetryAtom, next);
        };
        set(hostId);
        try {
          await runAtomCommand(
            registry,
            state.deviceEnvironment.list,
            { environmentId: EnvironmentId.make(environmentId), input: { retryHostId: hostId } },
            { label: "retry device host" },
          );
        } finally {
          set(null);
        }
        return null;
      },
      deviceSetupStep: async (params) => {
        const { step } = StepParams(params);
        const dialog = registry.get(setupDialogAtom);
        if (dialog === null || dialog.steps[step]?.disabled !== false) return null;
        registry.set(setupAtom, { ...registry.get(setupAtom), step });
        return null;
      },
      deviceSetupBack: async () => {
        const dialog = registry.get(setupDialogAtom);
        if (dialog === null) return null;
        if (dialog.back.kind === "cancel") {
          closeSetup();
          return null;
        }
        if (dialog.back.disabled) return null;
        registry.set(setupAtom, { ...registry.get(setupAtom), step: dialog.step - 1 });
        return null;
      },
      deviceSetupNext: async () => {
        const dialog = registry.get(setupDialogAtom);
        if (dialog === null || dialog.next.disabled) return null;
        if (dialog.next.kind === "continue") {
          registry.set(setupAtom, { ...registry.get(setupAtom), step: dialog.step + 1 });
          return null;
        }
        await configure("complete", { onboardingCompleted: true });
        return null;
      },
      deviceSetupDismiss: async () => {
        closeSetup();
        return null;
      },
      deviceSetupHub: async (params) => {
        const { enabled } = EnabledParams(params);
        const dialog = registry.get(setupDialogAtom);
        if (dialog === null || dialog.hub.disabled) return null;
        await configure("hub", { enabled, ...(enabled ? {} : { agentAccessEnabled: false }) });
        return null;
      },
      deviceSetupAgent: async (params) => {
        const { enabled } = EnabledParams(params);
        const dialog = registry.get(setupDialogAtom);
        if (dialog === null || dialog.agent.disabled) return null;
        await configure("agent", { agentAccessEnabled: enabled });
        return null;
      },
      deviceSetupCheck: async () => {
        const dialog = registry.get(setupDialogAtom);
        if (dialog === null || dialog.check.disabled) return null;
        registry.set(setupAtom, { ...registry.get(setupAtom), pending: "check" });
        try {
          await runAtomCommand(
            registry,
            state.deviceEnvironment.list,
            { environmentId: EnvironmentId.make(dialog.environmentId), input: {} },
            { label: "device list", reportFailure: false },
          );
        } finally {
          registry.set(setupAtom, { ...registry.get(setupAtom), pending: null });
        }
        return null;
      },
      deviceButton: async (params) => {
        const { button } = ButtonParams(params);
        streams.session(currentWorkspace().key)?.pressButton(button);
        return null;
      },
      deviceRotate: async () => {
        streams.session(currentWorkspace().key)?.rotate();
        return null;
      },
      deviceAct: async (params) => {
        const { body } = ActParams(params);
        await runDeviceAction(currentWorkspace(), body);
        return null;
      },
      deviceToolsToggle: async () => {
        const live = currentWorkspace();
        patchWorkspace(live.key, (current) => ({ ...current, toolsOpen: !current.toolsOpen }));
        return null;
      },
      deviceToolsClose: async () => {
        const live = currentWorkspace();
        patchWorkspace(live.key, (current) => ({ ...current, toolsOpen: false }));
        return null;
      },
      deviceAxOverlay: async (params) => {
        const { enabled } = EnabledParams(params);
        const live = currentWorkspace();
        if (live.access === null) return null;
        patchWorkspace(live.key, (current) => ({ ...current, axOverlay: enabled }));
        return null;
      },
      deviceEventLogToggle: async () => {
        const live = currentWorkspace();
        patchWorkspace(live.key, (current) => ({
          ...current,
          eventLogOpen: !current.eventLogOpen,
        }));
        return null;
      },
      deviceScreenshot: async () => {
        await saveScreenshot();
        return null;
      },
      deviceFloat: async () => {
        const live = currentWorkspace();
        usePreviewMiniPlayerStore.getState().open(live.route, {
          kind: "device",
          hostId: live.device.hostId,
          deviceId: live.device.id,
          platform: live.device.platform,
          name: live.device.name,
        });
        useRightPanelStore.getState().close(live.route);
        return null;
      },
      deviceClosePanel: async () => {
        await closeActive(false);
        return null;
      },
      devicePowerOff: async () => {
        await closeActive(true);
        return null;
      },
      deviceFold: async (params) => {
        changeFold(FoldParams(params).posture);
        return null;
      },
      deviceToolsField: async (params) => {
        const { field, value } = FieldParams(params);
        updateField(currentWorkspace().key, field, value);
        return null;
      },
      deviceToolsSubmit: async (params) => {
        const { field } = SubmitParams(params);
        const live = currentWorkspace();
        const ui = readWorkspace(live.key);
        const value = ui.fields[field].trim();
        if (!value) return null;
        const foregroundApp =
          ui.foreground === undefined ? (ui.detail?.foregroundApp ?? null) : ui.foreground;
        if (field === "push" && !foregroundApp) return null;
        await runDeviceAction(
          live,
          field === "openUrl"
            ? { type: "openUrl", url: value }
            : field === "launchApp"
              ? { type: "launchApp", appId: value }
              : { type: "sendPush", appId: foregroundApp?.id, payload: value },
        );
        updateField(live.key, field, "");
        return null;
      },
      deviceForegroundAct: async (params) => {
        const { value } = ValueParams(params);
        const live = currentWorkspace();
        const ui = readWorkspace(live.key);
        const foregroundApp =
          ui.foreground === undefined ? (ui.detail?.foregroundApp ?? null) : ui.foreground;
        if (!foregroundApp) return null;
        await runDeviceAction(live, {
          type: value === "terminate" ? "terminateApp" : "launchApp",
          appId: foregroundApp.id,
        });
        return null;
      },
      deviceLocationPreset: async (params) => {
        const { label } = LabelParams(params);
        const preset = DEVICE_LOCATION_PRESETS.find((candidate) => candidate.label === label);
        if (!preset) return null;
        const live = currentWorkspace();
        updateField(live.key, "latitude", String(preset.latitude));
        updateField(live.key, "longitude", String(preset.longitude));
        await runDeviceAction(live, {
          type: "setLocation",
          latitude: preset.latitude,
          longitude: preset.longitude,
        });
        return null;
      },
      deviceLocationSet: async () => {
        const live = currentWorkspace();
        const { fields } = readWorkspace(live.key);
        const parsed = parseDeviceLocation(fields.latitude, fields.longitude);
        if (parsed === null) return null;
        await runDeviceAction(live, { type: "setLocation", ...parsed });
        return null;
      },
      deviceLocationClear: async () => {
        const live = currentWorkspace();
        updateField(live.key, "latitude", "");
        updateField(live.key, "longitude", "");
        await runDeviceAction(live, { type: "clearLocation" });
        return null;
      },
      devicePermissionSelect: async (params) => {
        const { value } = ValueParams(params);
        const live = currentWorkspace();
        const permission = devicePermissions(live.device.platform).find(
          (entry) => entry.value === value,
        );
        if (!permission) return null;
        patchWorkspace(live.key, (current) => ({
          ...current,
          fields: { ...current.fields, permission: permission.value },
        }));
        return null;
      },
      devicePermissionDecide: async (params) => {
        const { decision } = DecisionParams(params);
        const live = currentWorkspace();
        const ui = readWorkspace(live.key);
        const foregroundApp =
          ui.foreground === undefined ? (ui.detail?.foregroundApp ?? null) : ui.foreground;
        const appId = ui.fields.permissionApp.trim() || (foregroundApp?.id ?? "");
        if (!appId) return null;
        await runDeviceAction(live, {
          type: "setPermission",
          appId,
          permission: ui.fields.permission,
          decision,
        });
        return null;
      },
    },
  };
}
