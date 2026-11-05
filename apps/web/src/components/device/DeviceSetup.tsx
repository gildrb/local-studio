import { DeviceHostUpdates } from "./DeviceHostUpdates";
import type { DeviceServiceState, EnvironmentId } from "@t3tools/contracts";
import { Check, CircleAlert } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { DialogClose } from "~/components/ui/dialog";
import { WizardHeader, WizardPanel, WizardSteps, WizardFooter } from "~/components/ui/wizard";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";
import { deviceEnvironment } from "~/state/device";
import { useAtomCommand } from "~/state/use-atom-command";
import { cn } from "~/lib/utils";
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
  type PlatformSetupStatus,
} from "./DeviceSetup.logic";

export function DeviceSetup(props: {
  readonly environmentId: EnvironmentId;
  readonly state: DeviceServiceState;
  readonly onComplete?: () => void;
}) {
  const configure = useAtomCommand(deviceEnvironment.configure);
  const list = useAtomCommand(deviceEnvironment.list, { reportFailure: false });
  const [pending, setPending] = useState<DeviceSetupPending>(null);
  const [step, setStep] = useState(0);
  const wizard = buildDeviceSetupWizardModel({ state: props.state, step, pending });

  const update = async (
    kind: NonNullable<DeviceSetupPending>,
    input: { enabled?: boolean; agentAccessEnabled?: boolean; onboardingCompleted?: boolean },
  ) => {
    setPending(kind);
    try {
      const result = await configure({ environmentId: props.environmentId, input });
      if (kind === "complete" && result._tag === "Success") props.onComplete?.();
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <WizardHeader
        title="Set up devices"
        description="Review what runs on this environment before using simulators and emulators."
      >
        <WizardSteps
          steps={DEVICE_SETUP_STEPS}
          currentStep={step}
          onStepChange={setStep}
          isStepDisabled={(requested) => wizard.stepDisabled[requested] ?? true}
        />
      </WizardHeader>

      <WizardPanel>
        <DeviceHostUpdates state={props.state} environmentId={props.environmentId} />
        {step === 0 ? (
          <section className="space-y-3 text-sm">
            <h3 className="font-medium">Enable the device hub</h3>
            <div className="flex items-start justify-between gap-4">
              <p className="text-muted-foreground">{deviceHubDescription}</p>
              <Switch
                checked={wizard.enabled}
                disabled={wizard.hubSwitchDisabled}
                aria-label="Enable device hub"
                onCheckedChange={(checked) =>
                  void update("hub", {
                    enabled: Boolean(checked),
                    ...(checked ? {} : { agentAccessEnabled: false }),
                  })
                }
              />
            </div>
            <DeviceHubSetupStatus state={props.state} pending={wizard.hubStatusPending} />
          </section>
        ) : null}

        {step === 1 ? (
          <section className="space-y-3 text-sm">
            <h3 className="font-medium">Check simulator support</h3>
            <DevicePlatformSetup
              state={props.state}
              checking={pending === "check"}
              disabled={wizard.checkDisabled}
              onCheck={() => {
                setPending("check");
                void list({ environmentId: props.environmentId, input: {} }).finally(() =>
                  setPending(null),
                );
              }}
            />
          </section>
        ) : null}

        {step === 2 ? (
          <section className="space-y-3 text-sm">
            <h3 className="font-medium">Allow agent control</h3>
            <div className="flex items-start justify-between gap-4">
              <p className="text-muted-foreground">{agentDeviceDescription}</p>
              <Switch
                checked={props.state.agentAccessEnabled}
                disabled={wizard.agentSwitchDisabled}
                aria-label="Allow agents to control devices"
                onCheckedChange={(checked) =>
                  void update("agent", { agentAccessEnabled: Boolean(checked) })
                }
              />
            </div>
            <AgentDeviceSetupStatus state={props.state} pending={pending === "agent"} />
            <p className="text-xs text-muted-foreground">
              Leave this off to keep manual device controls without giving agents access.
            </p>
          </section>
        ) : null}
        {wizard.failedDetail ? (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {wizard.failedDetail}
          </p>
        ) : null}
      </WizardPanel>

      <WizardFooter>
        {wizard.back.kind === "cancel" ? (
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        ) : (
          <Button
            variant="outline"
            disabled={wizard.back.disabled}
            onClick={() => setStep(step - 1)}
          >
            Back
          </Button>
        )}
        {wizard.next.kind === "continue" ? (
          <Button disabled={wizard.next.disabled} onClick={() => setStep(step + 1)}>
            {wizard.next.label}
          </Button>
        ) : (
          <Button
            disabled={wizard.next.disabled}
            onClick={() => void update("complete", { onboardingCompleted: true })}
          >
            {wizard.next.label}
          </Button>
        )}
      </WizardFooter>
    </>
  );
}

export function DeviceHubSetupStatus({
  state,
  pending,
  compact = false,
}: {
  readonly state: DeviceServiceState;
  readonly pending: boolean;
  readonly compact?: boolean;
}) {
  const model = buildDeviceHubSetupStatusModel({ state, pending, compact });
  if (model === null) return null;
  return (
    <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
      {model.pending ? <Spinner size="xs" /> : <Check className="size-3 text-success" />}
      {model.label}
    </p>
  );
}

function DevicePlatformSetup(props: {
  readonly state: DeviceServiceState;
  readonly checking: boolean;
  readonly disabled: boolean;
  readonly onCheck: () => void;
}) {
  return (
    <div className="space-y-3">
      <PlatformStatus platform="iOS" status={platformSetupStatus(props.state, "ios")} />
      <PlatformStatus platform="Android" status={platformSetupStatus(props.state, "android")} />
      <p className="text-xs text-muted-foreground">
        You can use either platform. Fixing a missing platform does not block the other one.
      </p>
      <Button size="compact" variant="outline" disabled={props.disabled} onClick={props.onCheck}>
        {props.checking ? <Spinner size="xs" /> : null}
        {props.checking ? "Checking…" : "Check again"}
      </Button>
    </div>
  );
}

export function AgentDeviceSetupStatus(props: {
  readonly state: DeviceServiceState;
  readonly pending: boolean;
  readonly compact?: boolean;
}) {
  const model = buildAgentDeviceSetupStatusModel({
    state: props.state,
    pending: props.pending,
    compact: props.compact ?? false,
  });
  if (model === null) return null;
  return (
    <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
      {model.pending ? <Spinner size="xs" /> : <Check className="size-3 text-success" />}
      {model.label}
    </p>
  );
}

export function PlatformStatus(props: {
  readonly platform: string;
  readonly status: PlatformSetupStatus;
  readonly compact?: boolean;
}) {
  const model = buildPlatformStatusModel({
    platform: props.platform,
    status: props.status,
    compact: props.compact ?? false,
  });
  const Icon = model.ready ? Check : CircleAlert;
  return (
    <div
      className={cn("flex gap-2", !props.compact && "rounded-md border border-border/60 px-3 py-2")}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          model.ready ? "text-success" : "text-muted-foreground",
        )}
      />
      <div className={cn(props.compact && model.ready && "flex items-center gap-2")}>
        <p className="font-medium">{model.platform}</p>
        <p className="text-xs text-muted-foreground">{model.message}</p>
      </div>
    </div>
  );
}
