import type { DevicePlatform, DeviceServiceState } from "@t3tools/contracts";

const platformName = (platform: DevicePlatform) => (platform === "ios" ? "iOS" : "Android");

export const deviceHubDescription =
  "Enable this environment to open simulators and emulators, whether they run here or on a remote device host.";
export const agentDeviceDescription =
  "Allow new agent sessions in this environment to start and control local and remote devices, with required tools set up automatically.";

export type PlatformSetupStatus = { readonly ready: boolean; readonly message: string };

export function platformSetupStatus(
  state: DeviceServiceState,
  platform: DevicePlatform,
): PlatformSetupStatus {
  const availability = state.hosts
    .flatMap((host) => host.platforms)
    .find((candidate) => candidate.platform === platform);
  if (!availability?.available) {
    return {
      ready: false,
      message: availability?.reason ?? `${platformName(platform)} support was not detected.`,
    };
  }
  if (
    state.hostStatus === "ready" &&
    !state.devices.some((device) => device.platform === platform)
  ) {
    return {
      ready: false,
      message:
        platform === "ios"
          ? "Xcode is installed, but no iOS Simulator is available. Install a runtime in Xcode Settings → Components."
          : "The Android SDK is installed, but no virtual device exists. Create one in Android Studio → Device Manager.",
    };
  }
  return {
    ready: true,
    message:
      platform === "ios"
        ? "Xcode and iOS Simulator are available."
        : "The Android SDK and Emulator are available.",
  };
}

export type PlatformStatusModel = {
  readonly platform: string;
  readonly ready: boolean;
  readonly message: string;
};

export function buildPlatformStatusModel(input: {
  readonly platform: string;
  readonly status: PlatformSetupStatus;
  readonly compact: boolean;
}): PlatformStatusModel {
  return {
    platform: input.platform,
    ready: input.status.ready,
    message: input.compact && input.status.ready ? "Ready" : input.status.message,
  };
}

export type DeviceSetupStatusModel = {
  readonly pending: boolean;
  readonly label: string;
};

export function buildDeviceHubSetupStatusModel(input: {
  readonly state: Pick<DeviceServiceState, "hostStatus">;
  readonly pending: boolean;
  readonly compact: boolean;
}): DeviceSetupStatusModel | null {
  const { state, pending, compact } = input;
  if (!pending && state.hostStatus !== "ready") return null;
  return {
    pending,
    label: pending
      ? state.hostStatus === "installing"
        ? compact
          ? "Installing…"
          : "Installing device hub…"
        : state.hostStatus === "starting"
          ? compact
            ? "Starting…"
            : "Starting device hub…"
          : compact
            ? "Updating…"
            : "Updating device hub…"
      : "Device hub is ready.",
  };
}

export function buildAgentDeviceSetupStatusModel(input: {
  readonly state: Pick<DeviceServiceState, "hostStatus" | "agentAccessEnabled" | "hosts">;
  readonly pending: boolean;
  readonly compact: boolean;
}): DeviceSetupStatusModel | null {
  const { state, pending, compact } = input;
  if (pending) {
    return {
      pending: true,
      label:
        state.hostStatus === "installing"
          ? compact
            ? "Installing…"
            : "Installing agent tools…"
          : state.hostStatus === "starting"
            ? compact
              ? "Starting…"
              : "Starting agent tools…"
            : compact
              ? "Updating…"
              : "Updating agent access…",
    };
  }
  if (
    state.agentAccessEnabled &&
    state.hostStatus === "ready" &&
    state.hosts.some((host) => host.agentDeviceInstalled)
  ) {
    return { pending: false, label: "Agent tools are ready." };
  }
  return null;
}

export const DEVICE_SETUP_STEPS = ["Device hub", "Simulators", "Agent access"] as const;

export type DeviceSetupPending = "hub" | "check" | "agent" | "complete" | null;

export type DeviceSetupWizardModel = {
  readonly enabled: boolean;
  readonly busy: boolean;
  readonly stepDisabled: ReadonlyArray<boolean>;
  readonly hubSwitchDisabled: boolean;
  readonly hubStatusPending: boolean;
  readonly checkDisabled: boolean;
  readonly agentSwitchDisabled: boolean;
  readonly failedDetail: string | null;
  /** Step 0 cancels the dialog; later steps go back one step. */
  readonly back:
    | { readonly kind: "cancel" }
    | { readonly kind: "back"; readonly disabled: boolean };
  readonly next: {
    readonly kind: "continue" | "done";
    readonly label: string;
    readonly disabled: boolean;
  };
};

export function buildDeviceSetupWizardModel(input: {
  readonly state: Pick<DeviceServiceState, "hostStatus" | "hostStatusDetail">;
  readonly step: number;
  readonly pending: DeviceSetupPending;
}): DeviceSetupWizardModel {
  const { state, step, pending } = input;
  const enabled = state.hostStatus !== "disabled";
  const busy = state.hostStatus === "installing" || state.hostStatus === "starting";
  const forwardDisabled = state.hostStatus !== "ready" || pending !== null;
  return {
    enabled,
    busy,
    stepDisabled: DEVICE_SETUP_STEPS.map(
      (_, requested) => busy || pending !== null || requested > step,
    ),
    hubSwitchDisabled: busy || pending !== null,
    hubStatusPending: pending === "hub" || (busy && pending !== "agent"),
    checkDisabled: !enabled || busy || pending !== null,
    agentSwitchDisabled: !enabled || busy || pending !== null,
    failedDetail:
      state.hostStatus === "failed" && state.hostStatusDetail ? state.hostStatusDetail : null,
    back: step === 0 ? { kind: "cancel" } : { kind: "back", disabled: busy || pending !== null },
    next:
      step < DEVICE_SETUP_STEPS.length - 1
        ? { kind: "continue", label: "Continue", disabled: forwardDisabled }
        : {
            kind: "done",
            label: pending === "complete" ? "Saving…" : "Done",
            disabled: forwardDisabled,
          },
  };
}
