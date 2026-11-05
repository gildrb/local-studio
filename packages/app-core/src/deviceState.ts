import type { DeviceScreenSize } from "@t3tools/client-runtime/device/stream";
import type { DeviceServiceState, EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { PreviewMiniPlayerSource } from "@t3tools/web/src/previewMiniPlayerStore.ts";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import type { FeatureContext } from "./feature.ts";

export const EMPTY_DEVICE_STATE: DeviceServiceState = {
  hosts: [],
  hostStatus: "disabled",
  hostStatuses: {},
  devices: [],
  sessions: [],
  onboardingCompleted: false,
  agentAccessEnabled: false,
  hubBasePath: "/api/device-hub",
  revision: 0,
};

export const deviceScreenAtom = Atom.family((_key: string) =>
  Atom.make<DeviceScreenSize | null>(null).pipe(Atom.keepAlive),
);

export function readDeviceState(
  get: Atom.AtomContext,
  context: FeatureContext,
  environmentId: EnvironmentId,
): { readonly state: DeviceServiceState; readonly loaded: boolean } {
  const result = get(context.state.deviceEnvironment.state({ environmentId, input: {} }));
  return AsyncResult.isSuccess(result)
    ? { state: result.value, loaded: true }
    : { state: EMPTY_DEVICE_STATE, loaded: false };
}

export function deviceSourceDetails(
  state: DeviceServiceState,
  source: Extract<PreviewMiniPlayerSource, { kind: "device" }>,
): { readonly name: string; readonly description: string } {
  const device = state.devices.find(
    (entry) => entry.hostId === source.hostId && entry.id === source.deviceId,
  );
  const hostLabel = state.hosts.find((host) => host.id === source.hostId)?.label ?? "Device host";
  return {
    name: device?.name ?? source.name,
    description: `${hostLabel} · ${device?.version ?? source.platform}`,
  };
}

export const deviceSourceKey = (
  route: ScopedThreadRef,
  target: { readonly hostId: string; readonly deviceId: string },
) => `${route.environmentId}:${target.hostId}:${target.deviceId}`;
