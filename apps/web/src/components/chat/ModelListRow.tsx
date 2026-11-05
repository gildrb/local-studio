import { memo } from "react";
import { CheckIcon, StarIcon } from "lucide-react";
import { PROVIDER_ICON_BY_PROVIDER } from "./providerIconUtils";
import { ComboboxItem } from "../ui/combobox";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import type { ModelPickerModelRow } from "./modelPicker.logic";

export const ModelListRow = memo(function ModelListRow(props: {
  index: number;
  row: ModelPickerModelRow;
  onToggleFavorite: () => void;
}) {
  const { row } = props;
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[row.driverKind] ?? null;

  const item = (
    <ComboboxItem
      hideIndicator
      index={props.index}
      value={row.key}
      disabled={Boolean(row.disabledReason)}
      className={cn(
        "group relative w-full !min-w-0 max-w-full cursor-pointer",
        row.disabledReason && "data-disabled:pointer-events-auto data-disabled:cursor-not-allowed",
      )}
    >
      <div className="min-w-0 flex-1 text-left">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 truncate text-xs font-medium leading-snug">{row.label}</div>
          {row.newBadge ? (
            <span
              className="shrink-0 rounded border border-update/35 bg-update/15 px-0.5 py-px text-3xs font-bold uppercase leading-none tracking-wide text-update-foreground"
              aria-label={row.newBadge.ariaLabel}
            >
              {row.newBadge.label}
            </span>
          ) : null}
          {row.unavailableLabel ? (
            <Badge variant="outline" size="sm">
              {row.unavailableLabel}
            </Badge>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          {ProviderIcon ? <ProviderIcon className="size-3 shrink-0" /> : null}
          <span className="truncate text-xs font-normal leading-snug text-muted-foreground/70">
            {row.providerLabel}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {row.showSelection && row.selected ? (
          <CheckIcon className="size-3.5" aria-hidden="true" />
        ) : null}
        {row.jumpLabel ? <Kbd>{row.jumpLabel}</Kbd> : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost-muted"
                className="-mr-1 shrink-0"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onToggleFavorite();
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                }}
                disabled={Boolean(row.disabledReason)}
                aria-label={row.favoriteActionLabel}
              >
                <StarIcon
                  className={cn("size-3.5 sm:size-3", row.favorite && "fill-current text-warning")}
                />
              </Button>
            }
          />
          <TooltipPopup side="top" align="center">
            {row.favoriteActionLabel}
          </TooltipPopup>
        </Tooltip>
      </div>
    </ComboboxItem>
  );

  if (!row.disabledReason) {
    return item;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={item} />
      <TooltipPopup side="left" align="center">
        {row.disabledReason}
      </TooltipPopup>
    </Tooltip>
  );
});
