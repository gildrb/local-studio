import type { EnvironmentId, UnifiedSettings } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
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
import { Switch } from "../ui/switch";
import { AddUsageLimitSourceDialog } from "./AddUsageLimitSourceDialog";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import {
  buildUsageProviderSettingsModel,
  resolveUsageProviderSettingsChange,
  type UsageProviderHubRow,
} from "./UsageProviderSettings.logic";

/** Hub management follows the selected device and access rules of provider settings. */
export function UsageProviderSettings({
  environmentId,
  environmentLabel,
  sources,
  cursorKeychainUsageEnabled,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly sources: UnifiedSettings["usageLimitSources"];
  readonly cursorKeychainUsageEnabled: boolean;
  readonly readOnly: boolean;
}) {
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const updateCursorSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "update Cursor account usage",
  });
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const platform = useAtomValue(serverEnvironment.configValueAtom(environmentId))?.environment
    .platform;
  const [adding, setAdding] = useState(false);
  const [updatingCursor, setUpdatingCursor] = useState(false);
  const model = buildUsageProviderSettingsModel({
    sources,
    cursorKeychainUsageEnabled,
    platformOs: platform?.os ?? null,
    readOnly,
    updatingCursor,
    adding,
  });

  const setCursorUsageEnabled = async (enabled: boolean) => {
    const decision = resolveUsageProviderSettingsChange({
      kind: "set-cursor-keychain-usage",
      enabled,
    });
    setUpdatingCursor(true);
    try {
      const result = await updateCursorSettings({
        environmentId,
        input: { patch: decision.patch },
      });
      if (result._tag === "Success") {
        await refreshProviders({ environmentId, input: {} });
      }
    } finally {
      setUpdatingCursor(false);
    }
  };

  const removeHub = (id: string) => {
    updateSettings(resolveUsageProviderSettingsChange({ kind: "remove-hub", id }).patch);
  };

  return (
    <>
      <SettingsSection
        {...model.section}
        headerAction={
          model.addAction ? (
            <Button size="xs" variant="outline" onClick={() => setAdding(true)}>
              <PlusIcon className="size-3" aria-hidden />
              {model.addAction.label}
            </Button>
          ) : null
        }
      >
        {model.cursorKeychainRow ? (
          <SettingsRow
            id={model.cursorKeychainRow.id}
            title={model.cursorKeychainRow.title}
            description={model.cursorKeychainRow.description}
            control={
              <Switch
                aria-label={model.cursorKeychainRow.ariaLabel}
                checked={model.cursorKeychainRow.value}
                disabled={model.cursorKeychainRow.disabled}
                onCheckedChange={(enabled) => void setCursorUsageEnabled(enabled)}
              />
            }
          />
        ) : null}
        {model.emptyLabel !== null ? (
          <SettingsRow title={model.emptyLabel} />
        ) : (
          model.hubs.map((hub) => (
            <SettingsRow
              key={hub.id}
              title={hub.label}
              description={<span className="break-all">{hub.description}</span>}
              control={
                hub.removable ? (
                  <RemoveUsageProviderButton hub={hub} onConfirm={() => removeHub(hub.id)} />
                ) : null
              }
            />
          ))
        )}
      </SettingsSection>
      {model.showAddDialog ? (
        <AddUsageLimitSourceDialog
          open
          onOpenChange={setAdding}
          environmentId={environmentId}
          environmentLabel={environmentLabel}
        />
      ) : null}
    </>
  );
}

/** Removing a hub deletes its stored management key, so it requires confirmation. */
function RemoveUsageProviderButton({
  hub,
  onConfirm,
}: {
  readonly hub: UsageProviderHubRow;
  readonly onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        {hub.removeLabel}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{hub.removeConfirmation.title}</AlertDialogTitle>
            <AlertDialogDescription>{hub.removeConfirmation.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {hub.removeConfirmation.cancelLabel}
            </AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              {hub.removeConfirmation.confirmLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
