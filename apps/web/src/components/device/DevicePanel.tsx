import { DeviceHostUpdates } from "./DeviceHostUpdates";
import type { DeviceSummary, ScopedThreadRef } from "@t3tools/contracts";
import { Smartphone, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
import { useRightPanelStore, type RightPanelSurface } from "~/rightPanelStore";
import { Button } from "~/components/ui/button";
import { DiscoveryList, DiscoveryListRow } from "~/components/ui/discovery-list";
import { Dialog } from "~/components/ui/dialog";
import { WizardPopup } from "~/components/ui/wizard";
import { Spinner } from "~/components/ui/spinner";
import { cn } from "~/lib/utils";
import { deviceEnvironment, useDeviceState } from "~/state/device";
import { formatEnvironmentQueryError } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { DeviceLoadingView } from "./DeviceLoadingView";
import {
  buildDevicePanelModel,
  deviceHostLabel,
  deviceKey,
  deviceListRowDescription,
  devicePlatformLabel,
  deviceSetupRequired,
} from "./DevicePanel.logic";
import { DeviceSetup } from "./DeviceSetup";
import { DeviceWorkspace } from "./DeviceWorkspace";
import { PreviewPanelShell, type PreviewPanelMode } from "../preview/PreviewPanelShell";

/** Each surface owns one host/device; only the visible surface streams. */
export function DevicePanel(props: {
  readonly mode: PreviewPanelMode;
  readonly threadRef: ScopedThreadRef;
  readonly surface: Extract<RightPanelSurface, { kind: "device" }>;
  readonly visible: boolean;
  readonly onDismissSetup: () => void;
}) {
  const { environmentId, threadId } = props.threadRef;
  const { state, loaded } = useDeviceState(environmentId);
  const list = useAtomCommand(deviceEnvironment.list, { reportFailure: false });
  const open = useAtomCommand(deviceEnvironment.open);
  const close = useAtomCommand(deviceEnvironment.close);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [pendingDevice, setPendingDevice] = useState<DeviceSummary | null>(null);
  const pendingDeviceKey = pendingDevice ? deviceKey(pendingDevice) : null;

  const hostDisabled = state.hostStatus === "disabled";

  // Opening setup never grants permission to install or start helpers.
  useEffect(() => {
    if (!props.visible || !loaded || hostDisabled) return;
    void list({ environmentId, input: {} });
  }, [environmentId, list, loaded, props.visible, hostDisabled]);

  const model = useMemo(
    () =>
      buildDevicePanelModel({
        state,
        loaded,
        threadId,
        target: props.surface.target,
        pendingDevice,
      }),
    [loaded, pendingDevice, props.surface.target, state, threadId],
  );
  const { activeDevice, activeSession } = model;

  const selectDevice = async (value: string) => {
    const device = state.devices.find((candidate) => deviceKey(candidate) === value);
    if (!device) return;
    setOperationError(null);
    setPendingDevice(device);
    try {
      const result = await open({
        environmentId,
        input: {
          threadId,
          hostId: device.hostId,
          deviceId: device.id,
          platform: device.platform,
        },
      });
      if (result._tag === "Failure") setOperationError(formatEnvironmentQueryError(result.cause));
      else
        useRightPanelStore.getState().openDevice(props.threadRef, {
          hostId: result.value.hostId,
          deviceId: result.value.deviceId,
          platform: device.platform,
          name: device.name,
        });
    } finally {
      setPendingDevice(null);
    }
  };

  // Floating the device closes the panel, like the browser's floating preview.
  const floatActive = () => {
    if (!activeDevice) return;
    usePreviewMiniPlayerStore.getState().open(props.threadRef, {
      kind: "device",
      hostId: activeDevice.hostId,
      deviceId: activeDevice.id,
      platform: activeDevice.platform,
      name: activeDevice.name,
    });
    useRightPanelStore.getState().close(props.threadRef);
  };

  const closeActive = (powerOff: boolean) => {
    if (!powerOff) {
      useRightPanelStore.getState().closeSurface(props.threadRef, props.surface.id);
      return;
    }
    if (!activeSession) return;
    setOperationError(null);
    void close({
      environmentId,
      input: {
        threadId,
        hostId: activeSession.hostId,
        deviceId: activeSession.deviceId,
        shutdown: powerOff,
      },
    }).then((result) => {
      if (result._tag === "Failure") setOperationError(formatEnvironmentQueryError(result.cause));
      else useRightPanelStore.getState().closeSurface(props.threadRef, props.surface.id);
    });
  };

  if (deviceSetupRequired(state, loaded)) {
    return (
      <Dialog
        open={props.visible}
        onOpenChange={(isOpen) => {
          if (!isOpen) props.onDismissSetup();
        }}
      >
        <WizardPopup>
          <DeviceSetup environmentId={environmentId} state={state} />
        </WizardPopup>
      </Dialog>
    );
  }

  const body = model.body;
  return (
    <PreviewPanelShell mode={props.mode}>
      {model.hostNotice ? (
        <div
          role="status"
          className="whitespace-pre-line border-b px-3 py-2 text-xs text-muted-foreground"
        >
          {model.hostNotice}
        </div>
      ) : null}
      <DeviceHostUpdates state={state} environmentId={environmentId} />
      {model.bootingNotice ? (
        <div role="status" className="border-b px-3 py-2 text-xs text-muted-foreground">
          {model.bootingNotice}
        </div>
      ) : null}
      {operationError ? (
        <div
          role="alert"
          className="flex items-start gap-2 border-b bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{operationError}</p>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Dismiss device error"
            onClick={() => setOperationError(null)}
          >
            <X className="size-3" />
          </Button>
        </div>
      ) : null}
      <div className="@container relative flex min-h-0 flex-1">
        {body.kind === "workspace" && activeDevice ? (
          <DeviceWorkspace
            key={`${environmentId}\u0000${deviceKey(activeDevice)}`}
            environmentId={environmentId}
            device={activeDevice}
            hostLabel={deviceHostLabel(state, activeDevice.hostId)}
            hostDiagnostics={state.hostStatusDetail}
            visible={props.visible}
            onFloat={floatActive}
            onClose={() => closeActive(false)}
            onPowerOff={() => closeActive(true)}
          />
        ) : body.kind === "loading" ? (
          <DeviceLoadingView
            name={body.name}
            description={body.description}
            stage="opening"
            message={body.message}
          />
        ) : body.kind === "list" ? (
          <div className="flex size-full flex-col overflow-y-auto px-5 py-8 text-sm text-muted-foreground">
            <div
              className={cn(
                "mx-auto flex w-full max-w-xl flex-col gap-6",
                body.emptyMessage !== null && "my-auto items-center text-center",
              )}
            >
              {body.emptyMessage !== null ? (
                <>
                  <Smartphone className="size-6 opacity-60" />
                  <p className="max-w-sm">{body.emptyMessage}</p>
                </>
              ) : null}
              {body.showGroups ? (
                <div className="w-full space-y-6 text-left">
                  {model.groups.map((group) => (
                    <section key={group.platform} className="space-y-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Smartphone className="size-4 shrink-0" />
                        <h3 className="font-medium">{devicePlatformLabel(group.platform)}</h3>
                      </div>
                      <DiscoveryList>
                        {group.devices.map((device) => (
                          <DiscoveryListRow
                            key={deviceKey(device)}
                            icon={
                              <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border/60">
                                <Smartphone className="size-4" />
                              </span>
                            }
                            title={device.name}
                            description={deviceListRowDescription(state, device)}
                            disabled={pendingDeviceKey !== null}
                            aria-label={`${device.booted ? "Open" : "Start"} ${device.name}`}
                            onClick={() => void selectDevice(deviceKey(device))}
                            action={
                              pendingDeviceKey === deviceKey(device) ? (
                                <Spinner size="xs" />
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  {device.booted ? "Open" : "Start"}
                                </span>
                              )
                            }
                          />
                        ))}
                      </DiscoveryList>
                    </section>
                  ))}
                </div>
              ) : null}
              {body.androidHint ? (
                <p className="max-w-sm text-xs">
                  No Android virtual devices found. Create one in Android Studio's Device Manager,
                  then refresh.
                </p>
              ) : null}
              {body.refresh ? (
                <Button
                  className={body.refresh.align === "start" ? "self-start" : "self-center"}
                  variant={body.refresh.variant}
                  size="sm"
                  onClick={() => void list({ environmentId, input: {} })}
                >
                  Refresh devices
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </PreviewPanelShell>
  );
}
