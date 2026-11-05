import type { EnvironmentMachineKind } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";

/**
 * One machine in a grouped settings list: icon, name, a single subtitle line,
 * and controls on the right. Every environment list on the Connections page
 * uses this so the lists share one rhythm.
 */
export function EnvironmentRow({
  kind,
  label,
  subtitle,
  below,
  dimmed = false,
  className,
  children,
}: {
  readonly kind: EnvironmentMachineKind;
  readonly label: string;
  readonly subtitle: ReactNode;
  /** Extra content under the subtitle, such as update progress. */
  readonly below?: ReactNode;
  readonly dimmed?: boolean;
  readonly className?: string;
  readonly children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2.5 sm:px-4",
        dimmed && "opacity-60",
        className,
      )}
    >
      <EnvironmentMachineIcon aria-hidden kind={kind} className="size-4 text-muted-foreground" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{label}</p>
        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        {below}
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}
