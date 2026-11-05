import type { DeviceServiceState } from "@t3tools/contracts";

export type DeviceHostUpdateModel = {
  readonly hostId: string;
  readonly label: string;
  readonly failed: boolean;
  readonly detail: string;
  readonly hint: string | null;
  readonly retry: { readonly label: string; readonly disabled: boolean } | null;
};

export function buildDeviceHostUpdatesModel(input: {
  readonly state: Pick<
    DeviceServiceState,
    "hostStatus" | "hosts" | "hostStatuses" | "supportsHostRetry"
  >;
  readonly pendingHostId: string | null;
}): ReadonlyArray<DeviceHostUpdateModel> {
  const { state, pendingHostId } = input;
  if (state.hostStatus === "disabled") return [];
  return state.hosts.flatMap((host) => {
    const status = state.hostStatuses[host.id];
    if (!status || !["installing", "starting", "failed"].includes(status.status)) return [];
    const failed = status.status === "failed";
    return [
      {
        hostId: host.id,
        label: host.label,
        failed,
        detail:
          status.detail ??
          (failed
            ? "Device support could not start."
            : status.status === "installing"
              ? "Installing device tools…"
              : "Starting device tools…"),
        hint: failed
          ? "Check the host connection and network access, then retry. Your device settings are saved."
          : null,
        retry:
          failed && state.supportsHostRetry
            ? {
                label: pendingHostId === host.id ? "Retrying…" : "Retry",
                disabled: pendingHostId !== null,
              }
            : null,
      },
    ];
  });
}
