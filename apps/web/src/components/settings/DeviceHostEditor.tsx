import { useState } from "react";
import type { SshDeviceHostConfig } from "@t3tools/contracts";
import { CheckIcon, MonitorIcon, XIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../ui/dialog";
import { DeviceHostAvailability } from "../device/DeviceHostAvailability";
import { useHostConnectionChecks } from "./useHostConnectionChecks";
import type { DeviceHostCheckTarget } from "./deviceHostConnectionChecks";
import {
  buildDeviceHostEditorModel,
  resolveDeviceHostDraftChange,
  resolveDeviceHostEditorSubmit,
  resolveDeviceHostEditorTest,
} from "./deviceHostsSettings.logic";

export function DeviceHostEditor({
  host,
  isNew,
  targets,
  busy,
  onSave,
  onClose,
}: {
  host: SshDeviceHostConfig;
  isNew: boolean;
  targets: ReadonlyArray<DeviceHostCheckTarget>;
  busy: boolean;
  onSave: (host: SshDeviceHostConfig) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(host);
  const { checks, testConnection } = useHostConnectionChecks(targets);
  const modelInput = { host, draft, isNew, targets, busy, checks };
  const model = buildDeviceHostEditorModel(modelInput);
  const { fields } = model;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && model.closeable) onClose();
      }}
    >
      <DialogPopup
        showCloseButton={model.closeable}
        render={
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const decision = resolveDeviceHostEditorSubmit(modelInput);
              if (decision.kind === "save") onSave(decision.host);
            }}
          />
        }
      >
        <DialogHeader>
          <DialogTitle>{model.title}</DialogTitle>
          <DialogDescription>{model.description}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <label className="block space-y-1.5 text-sm">
            <span>{fields.label.label}</span>
            <Input
              autoFocus
              required={fields.label.required}
              value={fields.label.value}
              disabled={fields.label.disabled}
              onChange={(event) =>
                setDraft(resolveDeviceHostDraftChange(draft, "label", event.target.value))
              }
              placeholder={fields.label.placeholder}
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span>{fields.target.label}</span>
            <Input
              required={fields.target.required}
              value={fields.target.value}
              disabled={fields.target.disabled}
              onChange={(event) =>
                setDraft(resolveDeviceHostDraftChange(draft, "target", event.target.value))
              }
              placeholder={fields.target.placeholder}
            />
          </label>
          <details open={model.sshOptions.open || undefined} className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              {model.sshOptions.summary}
            </summary>
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
              <label className="block space-y-1.5">
                <span>{fields.identityFile.label}</span>
                <Input
                  value={fields.identityFile.value}
                  disabled={fields.identityFile.disabled}
                  onChange={(event) =>
                    setDraft(
                      resolveDeviceHostDraftChange(draft, "identityFile", event.target.value),
                    )
                  }
                  placeholder={fields.identityFile.placeholder}
                />
              </label>
              <label className="block space-y-1.5">
                <span>{fields.port.label}</span>
                <Input
                  type="number"
                  min={fields.port.min ?? undefined}
                  max={fields.port.max ?? undefined}
                  value={fields.port.value}
                  disabled={fields.port.disabled}
                  onChange={(event) =>
                    setDraft(resolveDeviceHostDraftChange(draft, "port", event.target.value))
                  }
                  placeholder={fields.port.placeholder}
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{model.sshOptions.hint}</p>
          </details>
          <div className="rounded-lg border border-border/60">
            <div className="flex items-center justify-between gap-3 px-3 py-2.5">
              <p role="status" className="text-xs text-muted-foreground">
                {model.connection.status}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={model.connection.testButton.disabled}
                onClick={() => {
                  const testHost = resolveDeviceHostEditorTest(draft);
                  if (testHost !== null) void testConnection(testHost);
                }}
              >
                {model.connection.checking ? <Spinner size="xs" /> : null}{" "}
                {model.connection.testButton.label}
              </Button>
            </div>
            {model.connection.results ? (
              <ul className="border-t border-border/60 divide-y divide-border/40">
                {model.connection.results.map((result) => (
                  <li key={result.environmentId} className="px-3 py-2.5 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate font-medium">{result.label}</span>
                      <span
                        className={`flex shrink-0 items-center gap-1.5 ${result.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
                      >
                        {result.icon === "spinner" ? (
                          <Spinner size="xs" />
                        ) : result.icon === "monitor" ? (
                          <MonitorIcon className="size-3" />
                        ) : result.icon === "x" ? (
                          <XIcon className="size-3" />
                        ) : (
                          <CheckIcon className="size-3" />
                        )}{" "}
                        {result.statusLabel}
                      </span>
                    </div>
                    {result.platforms ? (
                      <div className="mt-1.5">
                        <DeviceHostAvailability platforms={result.platforms} />
                      </div>
                    ) : null}
                    {result.error ? (
                      <details className="mt-1.5 text-muted-foreground">
                        <summary className="cursor-pointer">{result.error.summary}</summary>
                        <p className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words">
                          {result.error.detail}
                        </p>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={model.cancel.disabled} onClick={onClose}>
            {model.cancel.label}
          </Button>
          <Button type="submit" disabled={model.save.disabled}>
            {model.save.busy ? <Spinner size="xs" /> : null} {model.save.label}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
