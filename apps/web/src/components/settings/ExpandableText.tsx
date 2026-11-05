import { InlineButton } from "../ui/button";
import { useId, useState } from "react";

import { cn } from "../../lib/utils";
import {
  buildExpandableTextModel,
  DEFAULT_EXPANDABLE_TEXT_EXPAND_LABEL,
} from "./ExpandableText.logic";

/**
 * Long error text clamped to a few lines with a toggle to reveal the rest.
 * Short single-line text renders as-is without the toggle.
 */
export function ExpandableText({
  text,
  className,
  collapsedClassName = "line-clamp-3",
  expandLabel = DEFAULT_EXPANDABLE_TEXT_EXPAND_LABEL,
}: {
  text: string;
  className?: string;
  collapsedClassName?: string;
  expandLabel?: string;
}) {
  const textId = useId();
  const [expanded, setExpanded] = useState(false);
  const model = buildExpandableTextModel({ text, expanded, expandLabel });

  return (
    <div className={cn("min-w-0", className)}>
      <div
        id={textId}
        className={cn(
          "whitespace-pre-wrap break-words",
          model.collapsed ? collapsedClassName : null,
        )}
      >
        {model.text}
      </div>
      {model.canExpand ? (
        <InlineButton
          aria-expanded={model.expanded}
          aria-controls={textId}
          tone="muted"
          className="mt-1"
          onClick={() => setExpanded((value) => !value)}
        >
          {model.toggleLabel}
        </InlineButton>
      ) : null}
    </div>
  );
}
