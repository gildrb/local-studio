import type { DeviceServiceState, EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { deviceEnvironment } from "~/state/device";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildDeviceHostUpdatesModel } from "./DeviceHostUpdates.logic";

/** Shared by setup, Settings, and the Device panel so automatic updates stay visible. */
export function DeviceHostUpdates({
  state,
  environmentId,
}: {
  state: DeviceServiceState;
  environmentId: EnvironmentId;
}) {
  const retry = useAtomCommand(deviceEnvironment.list);
  const [pending, setPending] = useState<string | null>(null);
  if (state.hostStatus === "disabled") return null;
  const updates = buildDeviceHostUpdatesModel({ state, pendingHostId: pending });
  return (
    <div className="space-y-2">
      {updates.map((update) => (
        <div
          key={update.hostId}
          role={update.failed ? "alert" : "status"}
          className="flex items-start gap-3 rounded-md border border-border/60 px-3 py-2 text-xs"
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium">{update.label}</p>
            <p className="whitespace-pre-wrap break-words text-muted-foreground">{update.detail}</p>
            {update.hint !== null ? (
              <p className="mt-1 text-muted-foreground">{update.hint}</p>
            ) : null}
          </div>
          {update.retry !== null ? (
            <Button
              size="compact"
              variant="outline"
              disabled={update.retry.disabled}
              onClick={() => {
                setPending(update.hostId);
                void retry({ environmentId, input: { retryHostId: update.hostId } }).finally(() =>
                  setPending(null),
                );
              }}
            >
              {update.retry.label}
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
