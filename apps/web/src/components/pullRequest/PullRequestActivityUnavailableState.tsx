import { RefreshIcon } from "~/components/ui/refresh-icon";

import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { buildPullRequestActivityUnavailableModel } from "./PullRequestDetailPanel.logic";

export function PullRequestActivityUnavailableState({
  error,
  onRetry,
  compact = false,
}: {
  error: string;
  onRetry: () => void;
  compact?: boolean;
}) {
  const model = buildPullRequestActivityUnavailableModel({ error, compact });
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-center",
        model.compact ? "py-3" : "min-h-48 px-4 py-10",
      )}
    >
      <p className="text-sm font-medium text-foreground">{model.title}</p>
      <p className="max-w-md text-xs text-muted-foreground">{model.message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <RefreshIcon aria-hidden size="sm" />
        {model.retryLabel}
      </Button>
    </div>
  );
}
