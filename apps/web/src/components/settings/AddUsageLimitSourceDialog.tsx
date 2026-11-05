import type { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  type AddUsageLimitSourceDraft,
  buildAddUsageLimitSourceDialogModel,
  EMPTY_ADD_USAGE_LIMIT_SOURCE_DRAFT,
  resolveAddUsageLimitSource,
} from "./AddUsageLimitSourceDialog.logic";

/**
 * Adds a CLIProxyAPI hub from provider settings on one environment. The
 * management key is sent once and kept in that server's secret store;
 * settings only ever carry a redaction marker for it afterwards.
 */
export function AddUsageLimitSourceDialog({
  open,
  onOpenChange,
  environmentId,
  environmentLabel,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [draft, setDraft] = useState<AddUsageLimitSourceDraft>(EMPTY_ADD_USAGE_LIMIT_SOURCE_DRAFT);
  const model = buildAddUsageLimitSourceDialogModel({ environmentLabel, draft });

  const reset = () => {
    setDraft(EMPTY_ADD_USAGE_LIMIT_SOURCE_DRAFT);
  };

  const save = () => {
    const decision = resolveAddUsageLimitSource(draft);
    if (decision.kind === "invalid") return;
    // The patch names only this entry; the server merges it into its map.
    updateSettings(decision.patch);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{model.title}</DialogTitle>
          <DialogDescription>{model.description}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            {model.fields.map((field) => (
              <div key={field.id} className="grid gap-1.5">
                <Label htmlFor={field.id}>{field.label}</Label>
                <Input
                  id={field.id}
                  type={field.type ?? undefined}
                  autoComplete={field.autoComplete ?? undefined}
                  placeholder={field.placeholder ?? undefined}
                  value={field.value}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDraft((current) => ({ ...current, [field.key]: value }));
                  }}
                  autoFocus={field.autoFocus}
                />
              </div>
            ))}
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            {model.cancelLabel}
          </Button>
          <Button onClick={save} disabled={!model.canSave}>
            {model.saveLabel}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
