import { InfoIcon, RotateCwIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { buildDiffFileStatusModel, resolveDiffFileStatusClick } from "./DiffFileStatus.logic";

export function DiffFileStatus({
  error,
  truncated,
  retry,
}: {
  error?: boolean | undefined;
  truncated?: boolean | undefined;
  retry: () => void;
}) {
  const model = buildDiffFileStatusModel({ error, truncated });
  if (!model) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label={model.ariaLabel}
            onClick={(event) => {
              event.stopPropagation();
              if (resolveDiffFileStatusClick(model).kind === "retry") retry();
            }}
          />
        }
      >
        {model.icon === "rotate-cw" ? (
          <RotateCwIcon className="size-3" />
        ) : (
          <InfoIcon className="size-3" />
        )}
      </TooltipTrigger>
      <TooltipPopup>{model.tooltip}</TooltipPopup>
    </Tooltip>
  );
}
