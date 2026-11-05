import type { ReactNode } from "react";
import type { DeviceToolVersions as ToolVersions } from "@t3tools/contracts";
import { InlineButton } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { buildDeviceToolVersionsModel } from "./DeviceToolVersions.logic";

export function DeviceToolVersions({
  tools,
  action,
  kind,
  owner,
  error,
}: {
  tools: ToolVersions | undefined;
  action?: ReactNode;
  kind?: keyof ToolVersions;
  owner?: string | undefined;
  error?: string | undefined;
}) {
  const model = buildDeviceToolVersionsModel({ tools, kind, owner, error });
  return (
    <Popover>
      <PopoverTrigger
        aria-label={model.ariaLabel ?? undefined}
        render={<InlineButton tone="muted" />}
      >
        {model.triggerLabel}
      </PopoverTrigger>
      <PopoverPopup align="end" width="md">
        <PopoverTitle>{model.title}</PopoverTitle>
        {model.rows ? (
          <div className="mt-4 divide-y divide-border/50">
            {model.rows.map((row) => (
              <div key={row.name ?? model.title} className="space-y-2 py-3 first:pt-0 last:pb-0">
                {row.name !== null ? <p className="text-xs font-medium">{row.name}</p> : null}
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">Running</dt>
                  <dd className="text-right font-mono">{row.running}</dd>
                  <dt className="text-muted-foreground">Required</dt>
                  <dd className="text-right font-mono">{row.required}</dd>
                  <dt className="text-muted-foreground">Installed</dt>
                  <dd className="text-right font-mono break-words">{row.installed}</dd>
                </dl>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">{model.emptyMessage}</p>
        )}
        <p className="mt-4 border-t border-border/50 pt-3 text-xs text-muted-foreground">
          {model.footer}
        </p>
        {model.error !== null ? (
          <p role="status" className="mt-2 text-xs text-destructive">
            {model.error}
          </p>
        ) : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </PopoverPopup>
    </Popover>
  );
}
