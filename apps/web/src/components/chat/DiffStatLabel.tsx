import { memo } from "react";
import { cn } from "~/lib/utils";

import { buildDiffStatLabelModel } from "./DiffStatLabel.logic";

export const DiffStatLabel = memo(function DiffStatLabel(props: {
  additions: number;
  deletions: number;
  className?: string;
  showParentheses?: boolean;
  layout?: "aligned" | "inline";
}) {
  const { additions, deletions, className, showParentheses = false, layout = "aligned" } = props;
  const model = buildDiffStatLabelModel({ additions, deletions });
  return (
    <>
      {showParentheses && <span className="text-muted-foreground/70">(</span>}
      <span
        role="group"
        aria-label={model.ariaLabel}
        className={cn(
          layout === "inline"
            ? "inline-flex items-center gap-1 tabular-nums align-middle"
            : "inline-grid grid-cols-[4ch_4ch] gap-2 text-right tabular-nums align-middle",
          className,
        )}
      >
        <span aria-hidden="true" className="font-mono text-diff-addition">
          {model.additionsText}
        </span>
        <span aria-hidden="true" className="font-mono text-diff-deletion">
          {model.deletionsText}
        </span>
      </span>
      {showParentheses && <span className="text-muted-foreground/70">)</span>}
    </>
  );
});
