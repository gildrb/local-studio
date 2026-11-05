import { useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { buildRedactedSensitiveTextModel } from "./RedactedSensitiveText.logic";

export function RedactedSensitiveText(props: {
  readonly value: string | null | undefined;
  readonly ariaLabel: string;
  readonly revealTooltip: string;
  readonly hideTooltip: string;
  readonly className?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const model = useMemo(
    () =>
      buildRedactedSensitiveTextModel({
        value: props.value,
        revealed,
        ariaLabel: props.ariaLabel,
        revealTooltip: props.revealTooltip,
        hideTooltip: props.hideTooltip,
      }),
    [props.value, revealed, props.ariaLabel, props.revealTooltip, props.hideTooltip],
  );

  if (!model) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={cn(
              "min-w-0 cursor-pointer rounded-sm font-mono text-2xs leading-normal transition hover:text-foreground",
              model.revealed
                ? "text-muted-foreground"
                : "select-none text-muted-foreground blur-xs",
              props.className,
            )}
            onClick={() => setRevealed((current) => !current)}
            aria-label={model.ariaLabel}
          >
            {model.text}
          </button>
        }
      />
      <TooltipPopup side="top">{model.tooltip}</TooltipPopup>
    </Tooltip>
  );
}
