import { PermissionChecklist, PermissionContinueButton } from "../permissions/PermissionChecklist";
import { usePermissionStatus } from "../permissions/usePermissionStatus";
import type { DesktopSnapShotSetupAction, DesktopSnapShotState } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";
import { MacAccessibilityIcon, MacScreenRecordingIcon } from "../Icons";
import { CaptureShortcutConfig } from "./CaptureShortcutConfig";
import { Button } from "../ui/button";
import { Dialog, DialogDescription } from "../ui/dialog";
import { WizardSteps, WizardPopup, WizardHeader, WizardPanel, WizardFooter } from "../ui/wizard";
import {
  buildSnapShotSetupDialogModel,
  captureSetupInitialMacPermissions,
  captureSetupInitialStep,
  captureSetupPollsMacPermissions,
  resolveCaptureSetupStepChange,
  type CaptureSetupStep,
  type SnapShotSetupDialogIntent,
  type SnapShotSetupDialogPermission,
} from "./SnapShotSetupDialog.logic";

const PERMISSION_ICONS: Record<SnapShotSetupDialogPermission["icon"], ReactNode> = {
  "mac-screen-recording": <MacScreenRecordingIcon className="size-8 shrink-0 drop-shadow-sm" />,
  "mac-accessibility": <MacAccessibilityIcon className="size-8 shrink-0 drop-shadow-sm" />,
};

export function SnapShotSetupDialog({
  state,
  initialStep,
  wasEnabled,
  includeAccessibility,
  busy: actionBusy,
  error,
  shortcutInput,
  shortcutStatus,
  shortcutChanged,
  canSaveShortcut,
  onSaveShortcut,
  onEnable,
  onAction,
  onRefresh,
  onClose,
  onLeaveStep,
}: {
  state: DesktopSnapShotState;
  initialStep: CaptureSetupStep;
  wasEnabled: boolean;
  includeAccessibility: boolean;
  busy: boolean;
  error: string | null;
  shortcutInput: ReactNode;
  shortcutStatus: string | null | undefined;
  shortcutChanged: boolean;
  canSaveShortcut: boolean;
  onSaveShortcut: () => Promise<boolean>;
  onEnable: () => Promise<boolean>;
  onAction: (action: DesktopSnapShotSetupAction) => Promise<void>;
  onRefresh: () => Promise<DesktopSnapShotState | undefined>;
  onClose: (completed: boolean) => Promise<void>;
  onLeaveStep: () => void;
}) {
  const [step, setStep] = useState(() => captureSetupInitialStep(state, initialStep));
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  const busy = actionBusy || checking || configBusy;
  const permissionStatus = usePermissionStatus(
    async () => {
      const refreshed = await onRefresh();
      if (!refreshed?.macPermissions) throw new Error("Permission status unavailable");
      return refreshed.macPermissions;
    },
    captureSetupInitialMacPermissions(state),
    captureSetupPollsMacPermissions(state, step, busy),
  );
  const model = buildSnapShotSetupDialogModel({
    state,
    step,
    wasEnabled,
    includeAccessibility,
    actionBusy,
    checking,
    checked,
    configBusy,
    error,
    permissionStatus: permissionStatus.status,
    permissionError: permissionStatus.error,
    shortcutStatus: shortcutStatus ?? null,
    shortcutChanged,
    canSaveShortcut,
  });
  const changeStep = (next: CaptureSetupStep) => {
    onLeaveStep();
    setChecked(false);
    setStep(next);
  };
  const checkAgain = async () => {
    if (busy) return;
    setChecking(true);
    setChecked(false);
    try {
      setChecked((await onRefresh()) !== undefined);
    } finally {
      setChecking(false);
    }
  };
  const runIntent = async (intent: SnapShotSetupDialogIntent) => {
    switch (intent.kind) {
      case "action":
        return onAction(intent.action);
      case "check-again":
        return checkAgain();
      case "enable-and-continue":
        if (await onEnable()) changeStep("shortcut");
        return;
      case "finish":
        if (!intent.saveShortcut || (await onSaveShortcut())) await onClose(true);
        return;
    }
  };
  const access = model.access;
  const shortcut = model.shortcut;
  const advanced = model.advanced;
  const primary = model.primaryButton;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && model.dismissible) void onClose(false);
      }}
    >
      <WizardPopup showCloseButton={model.dismissible}>
        <WizardHeader title={model.title}>
          <WizardSteps
            steps={model.steps.map((item) => item.label)}
            currentStep={model.currentStepIndex}
            isStepDisabled={(index) => model.steps[index]?.disabled ?? true}
            onStepChange={(index) => {
              const next = resolveCaptureSetupStepChange(index, step);
              if (next) changeStep(next);
            }}
          />
        </WizardHeader>
        <WizardPanel>
          <div className="space-y-4 text-sm">
            <div className="space-y-2" aria-live="polite">
              <h3 className="flex items-center gap-2 font-medium">{model.heading.title}</h3>
              <DialogDescription>{model.heading.description}</DialogDescription>
            </div>
            {access ? (
              <>
                <p
                  role="status"
                  aria-atomic="true"
                  className={
                    access.checkMessage !== null ? "text-xs text-muted-foreground" : "sr-only"
                  }
                >
                  {access.checkMessage}
                </p>
                {access.permissions ? (
                  <PermissionChecklist
                    busy={model.busy}
                    permissions={access.permissions.map((permission) => ({
                      id: permission.id,
                      icon: PERMISSION_ICONS[permission.icon],
                      title: permission.title,
                      description: permission.description,
                      granted: permission.granted,
                      onAllow: () => void onAction(permission.action),
                    }))}
                  />
                ) : null}
                {access.permissionError ? (
                  <p role="status" className="text-xs text-muted-foreground">
                    {access.permissionError}
                  </p>
                ) : null}
                {access.reinstallHelperButton ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={access.reinstallHelperButton.disabled}
                    onClick={() => {
                      if (access.reinstallHelperButton)
                        void onAction(access.reinstallHelperButton.action);
                    }}
                  >
                    {access.reinstallHelperButton.label}
                  </Button>
                ) : null}
              </>
            ) : shortcut?.kind === "config" ? (
              <CaptureShortcutConfig
                state={state}
                disabled={shortcut.disabled}
                onBusyChange={setConfigBusy}
                onSaved={onRefresh}
                onComplete={() => onClose(true)}
              />
            ) : shortcut?.kind === "inline" ? (
              <div className="space-y-3">
                {shortcutInput}
                {shortcut.status ? (
                  <p className="text-xs text-muted-foreground" role="status">
                    {shortcut.status}
                  </p>
                ) : null}
                {shortcut.retryButton ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={shortcut.retryButton.disabled}
                    onClick={() => {
                      if (shortcut.retryButton) void onAction(shortcut.retryButton.action);
                    }}
                  >
                    {shortcut.retryButton.label}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {model.accessAlert !== null ? (
              <p role="alert" className="text-destructive">
                {model.accessAlert}
              </p>
            ) : null}
            {model.errorAlert !== null ? (
              <p role="alert" className="text-destructive">
                {model.errorAlert}
              </p>
            ) : null}
            {advanced ? (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">{advanced.summary}</summary>
                <div className="mt-3 space-y-3">
                  {advanced.details.map((detail) => (
                    <p key={detail} className="break-words">
                      {detail}
                    </p>
                  ))}
                  {advanced.includedNote !== null ? <p>{advanced.includedNote}</p> : null}
                  {advanced.disableExtensionButton ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={advanced.disableExtensionButton.disabled}
                      onClick={() => {
                        if (advanced.disableExtensionButton)
                          void onAction(advanced.disableExtensionButton.action);
                      }}
                    >
                      {advanced.disableExtensionButton.label}
                    </Button>
                  ) : null}
                  {advanced.removeHelperButton ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={advanced.removeHelperButton.disabled}
                      onClick={() => {
                        if (advanced.removeHelperButton)
                          void onAction(advanced.removeHelperButton.action);
                      }}
                    >
                      {advanced.removeHelperButton.label}
                    </Button>
                  ) : null}
                </div>
              </details>
            ) : null}
          </div>
        </WizardPanel>
        <WizardFooter>
          {model.backButton ? (
            <Button
              variant="ghost"
              disabled={model.backButton.disabled}
              onClick={() => changeStep("access")}
            >
              {model.backButton.label}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            disabled={model.closeButton.disabled}
            onClick={() => void onClose(false)}
          >
            {model.closeButton.label}
          </Button>
          {primary?.kind === "permission-continue" ? (
            <PermissionContinueButton
              ready={primary.ready}
              busy={primary.busy}
              onClick={() => runIntent(primary.intent)}
            >
              {primary.label}
            </PermissionContinueButton>
          ) : primary?.kind === "button" ? (
            <Button
              disabled={primary.disabled}
              aria-busy={primary.ariaBusy ?? undefined}
              onClick={() => void runIntent(primary.intent)}
            >
              {primary.label}
            </Button>
          ) : null}
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}
