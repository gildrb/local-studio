import { useState } from "react";

import { isLocalEnvironmentDisabled } from "../../localEnvironment";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import {
  buildLocalEnvironmentSettingModel,
  describeLocalEnvironmentSettingFailure,
  resolveLocalEnvironmentSettingChange,
  type LocalEnvironmentSettingIntent,
} from "./LocalEnvironmentSetting.logic";
import { SettingsRow } from "./settingsLayout";

// Toggling relaunches the desktop app, so the switch only reflects the value
// this process started with; there is no live state to keep in sync.
export function LocalEnvironmentSetting() {
  const setEnabled = window.desktopBridge?.setLocalEnvironmentEnabled;
  const [enabled] = useState(() => !isLocalEnvironmentDisabled());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const model = buildLocalEnvironmentSettingModel({
    available: setEnabled !== undefined,
    enabled,
    confirmOpen,
    isUpdating,
    error,
  });
  if (!setEnabled || model === null) return null;

  const dispatch = async (intent: LocalEnvironmentSettingIntent) => {
    const change = resolveLocalEnvironmentSettingChange({ enabled, isUpdating, intent });
    if (change.kind === "none") return;
    if (change.kind === "set-dialog") {
      setConfirmOpen(change.open);
      if (change.clearError) setError(null);
      return;
    }
    setIsUpdating(true);
    setError(null);
    try {
      await setEnabled(change.enabled);
    } catch (cause) {
      setError(describeLocalEnvironmentSettingFailure(cause));
      setIsUpdating(false);
    }
  };

  return (
    <>
      <SettingsRow
        id={model.id}
        title={model.title}
        description={model.description}
        control={
          <Switch
            checked={model.switch.checked}
            disabled={model.switch.disabled}
            onCheckedChange={() => void dispatch({ kind: "toggle" })}
            aria-label={model.switch.ariaLabel}
          />
        }
      />
      <AlertDialog
        open={model.dialog.open}
        onOpenChange={(open) => void dispatch({ kind: "dialog-open-change", open })}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{model.dialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{model.dialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          {model.dialog.error !== null ? (
            <p className="px-6 pb-4 text-sm text-destructive">{model.dialog.error}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogClose
              disabled={model.dialog.cancelDisabled}
              render={<Button variant="outline" />}
            >
              {model.dialog.cancelLabel}
            </AlertDialogClose>
            <Button
              variant={model.dialog.confirm.variant}
              disabled={model.dialog.confirm.disabled}
              onClick={() => void dispatch({ kind: "confirm" })}
            >
              {model.dialog.confirm.busy ? (
                <>
                  <Spinner size="sm" />
                  {model.dialog.confirm.label}
                </>
              ) : (
                model.dialog.confirm.label
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
