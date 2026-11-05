import type {
  DevicePlatform,
  DeviceServiceState,
  DeviceSession,
  DeviceSummary,
} from "@t3tools/contracts";

export const devicePlatformLabel = (platform: DevicePlatform) =>
  platform === "ios" ? "iOS Simulators" : "Android Emulators";

export const deviceKey = (device: Pick<DeviceSummary, "hostId" | "id">) =>
  `${device.hostId}\u0000${device.id}`;

export const deviceHostLabel = (state: DeviceServiceState, hostId: string) =>
  state.hosts.find((host) => host.id === hostId)?.label ?? "Device host";

export type DeviceGroup = {
  readonly platform: DevicePlatform;
  readonly devices: ReadonlyArray<DeviceSummary>;
};

export function groupDevices(state: DeviceServiceState): ReadonlyArray<DeviceGroup> {
  const groups: DeviceGroup[] = [];
  for (const platform of ["ios", "android"] as const) {
    const devices = state.devices
      .filter((device) => device.platform === platform)
      .toSorted((a, b) => Number(b.booted) - Number(a.booted) || a.name.localeCompare(b.name));
    if (devices.length > 0) groups.push({ platform, devices });
  }
  return groups;
}

/** Devices need setup until onboarding completes on an enabled hub. */
export const deviceSetupNeeded = (state: DeviceServiceState) =>
  !state.onboardingCompleted || state.hostStatus === "disabled";

/** Opening setup never grants permission to install or start helpers. */
export const deviceSetupRequired = (state: DeviceServiceState, loaded: boolean) =>
  loaded && deviceSetupNeeded(state);

export type DevicePanelModel = {
  readonly activeSession: DeviceSession | undefined;
  readonly activeDevice: DeviceSummary | undefined;
  readonly hostReady: boolean;
  readonly hostBusy: boolean;
  /** Host diagnostics shown above an empty panel. */
  readonly hostNotice: string | null;
  readonly bootingNotice: string | null;
  readonly groups: ReadonlyArray<DeviceGroup>;
  readonly body:
    | { readonly kind: "workspace" }
    | {
        readonly kind: "loading";
        readonly name: string;
        readonly description: string;
        readonly message: string;
      }
    | {
        readonly kind: "list";
        readonly emptyMessage: string | null;
        readonly showGroups: boolean;
        readonly androidHint: boolean;
        readonly refresh: {
          readonly variant: "ghost" | "outline";
          readonly align: "start" | "center";
        } | null;
      };
};

export function buildDevicePanelModel(input: {
  readonly state: DeviceServiceState;
  readonly loaded: boolean;
  readonly threadId: string;
  readonly target: { readonly hostId: string; readonly deviceId: string } | undefined;
  readonly pendingDevice: DeviceSummary | null;
}): DevicePanelModel {
  const { state, loaded, threadId, target, pendingDevice } = input;
  const sessions = state.sessions.filter((session) => session.threadId === threadId);
  const activeSession = target
    ? sessions.find(
        (session) => session.deviceId === target.deviceId && session.hostId === target.hostId,
      )
    : undefined;
  const activeDevice = activeSession
    ? state.devices.find(
        (device) => device.hostId === activeSession.hostId && device.id === activeSession.deviceId,
      )
    : undefined;
  const groups = groupDevices(state);
  const bootingDevices =
    state.bootingDevices?.filter((device) => device.threadId === threadId) ?? [];
  const hostReady = Object.values(state.hostStatuses).some((host) => host.status === "ready");
  const hostBusy =
    !hostReady &&
    Object.values(state.hostStatuses).some(
      (host) => host.status === "installing" || host.status === "starting",
    );
  const unavailablePlatforms = state.hosts.flatMap((host) =>
    host.platforms.filter((platform) => !platform.available),
  );
  const body: DevicePanelModel["body"] =
    activeDevice && activeSession
      ? { kind: "workspace" }
      : pendingDevice || hostBusy || !loaded
        ? {
            kind: "loading",
            name: pendingDevice?.name ?? "Devices",
            description: pendingDevice
              ? `${deviceHostLabel(state, pendingDevice.hostId)} · ${pendingDevice.version}`
              : "",
            message: pendingDevice
              ? pendingDevice.booted
                ? "Opening device…"
                : "Starting device…"
              : state.hostStatus === "installing"
                ? (state.hostStatusDetail ?? "Installing device support…")
                : "Finding devices…",
          }
        : {
            kind: "list",
            emptyMessage:
              groups.length === 0
                ? state.hostStatus === "failed"
                  ? (state.hostStatusDetail ?? "The device hub failed to start.")
                  : "No simulators or emulators were found on this environment."
                : null,
            showGroups: hostReady && groups.length > 0,
            androidHint:
              hostReady &&
              !state.devices.some((device) => device.platform === "android") &&
              !unavailablePlatforms.some((platform) => platform.platform === "android"),
            refresh:
              loaded && !hostBusy
                ? groups.length > 0
                  ? { variant: "ghost", align: "start" }
                  : { variant: "outline", align: "center" }
                : null,
          };
  return {
    activeSession,
    activeDevice,
    hostReady,
    hostBusy,
    hostNotice:
      hostReady && !activeDevice && state.hostStatusDetail ? state.hostStatusDetail : null,
    bootingNotice:
      bootingDevices.length > 0
        ? `Starting ${bootingDevices.map((device) => device.name).join(", ")}… This can take a minute.`
        : null,
    groups,
    body,
  };
}

export const deviceListRowDescription = (state: DeviceServiceState, device: DeviceSummary) =>
  `${state.hosts.find((host) => host.id === device.hostId)?.label} · ${device.version} · ${device.booted ? "Running" : "Stopped"}`;

export type OpenedDeviceSession = {
  readonly hostId: string;
  readonly deviceId: string;
  readonly platform: DevicePlatform;
  readonly name: string;
};

/**
 * Device sessions a thread gained since the last snapshot. The first snapshot
 * is a baseline: persisted tabs restore themselves, and existing sessions must
 * not resurrect closed tabs. A session whose device summary has not arrived
 * yet stays out of the baseline so a later snapshot opens it.
 */
export function diffDeviceSessions(input: {
  readonly state: Pick<DeviceServiceState, "sessions" | "devices">;
  readonly threadId: string;
  readonly previous: ReadonlySet<string> | undefined;
}): {
  readonly baseline: ReadonlySet<string>;
  readonly opened: ReadonlyArray<OpenedDeviceSession>;
} {
  const sessions = input.state.sessions.filter((session) => session.threadId === input.threadId);
  const key = (session: DeviceSession) => `${session.hostId}:${session.deviceId}`;
  const deviceFor = (session: DeviceSession) =>
    input.state.devices.find(
      (entry) => entry.hostId === session.hostId && entry.id === session.deviceId,
    );
  const baseline = new Set(sessions.filter((session) => deviceFor(session) !== undefined).map(key));
  const previous = input.previous;
  if (!previous) return { baseline, opened: [] };
  const opened = sessions.flatMap((session) => {
    if (previous.has(key(session))) return [];
    const device = deviceFor(session);
    if (!device) return [];
    return [
      {
        hostId: session.hostId,
        deviceId: session.deviceId,
        platform: device.platform,
        name: device.name,
      },
    ];
  });
  return { baseline, opened };
}
