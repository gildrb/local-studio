import type { ServerProcessSignal } from "@t3tools/contracts";

import { InlineButton } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { buildProcessSignalActionsModel } from "./ProcessSignalActions.logic";

/** Process ownership and confirmation stay with the diagnostics view. */
export function ProcessSignalActions({
  disabled,
  onSignal,
}: {
  disabled: boolean;
  onSignal: (signal: ServerProcessSignal) => void;
}) {
  const model = buildProcessSignalActionsModel({ disabled });
  return (
    <div className="flex items-center justify-end gap-1.5">
      {model.actions.map((action) => (
        <Tooltip key={action.signal}>
          <TooltipTrigger
            render={
              <InlineButton
                disabled={action.disabled}
                aria-label={action.ariaLabel}
                tone={action.tone}
                onClick={() => onSignal(action.signal)}
              >
                {action.label}
              </InlineButton>
            }
          />
          <TooltipPopup side="top">{action.tooltip}</TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}
