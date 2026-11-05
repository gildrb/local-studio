import { CheckIcon, CopyIcon } from "lucide-react";
import { useRef } from "react";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import {
  buildDiffFilePathCopyModel,
  resolveDiffFilePathCopy,
} from "./DiffFilePathCopyButton.logic";
import {
  ANCHORED_COPY_TOAST_TIMEOUT_MS,
  showAnchoredCopyErrorToast,
  showAnchoredCopySuccessToast,
} from "./ui/anchoredCopyToast";
import { Button } from "./ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function DiffFilePathCopyButton({ filePath }: { filePath: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard<void>({
    onCopy: () => showAnchoredCopySuccessToast(ref),
    onError: (error) => showAnchoredCopyErrorToast(ref, error),
    timeout: ANCHORED_COPY_TOAST_TIMEOUT_MS,
  });
  const model = buildDiffFilePathCopyModel(isCopied);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={ref}
            size="icon-micro"
            variant="ghost-muted"
            aria-label={model.ariaLabel}
            onClick={() => copyToClipboard(resolveDiffFilePathCopy(filePath).text, undefined)}
          />
        }
      >
        {model.icon === "check" ? (
          <CheckIcon className="size-3 text-success" />
        ) : (
          <CopyIcon className="size-3" />
        )}
      </TooltipTrigger>
      <TooltipPopup>
        <p>{model.tooltip}</p>
      </TooltipPopup>
    </Tooltip>
  );
}
