import { Toolbar } from "@base-ui/react/toolbar";
import { type ProviderInstanceId } from "@t3tools/contracts";
import { memo, useLayoutEffect, useRef, useState } from "react";
import { StarIcon } from "lucide-react";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import type { ModelPickerRailItem, ModelPickerRailSelection } from "./modelPicker.logic";

const SELECTED_INDICATOR_CLASS =
  "pointer-events-none absolute -right-1 top-1/2 z-10 h-5 w-0.75 -translate-y-1/2 rounded-l-full bg-primary";

/** Opens toward the rail so the list stays readable (not over the model names). */
const PICKER_TOOLTIP_SIDE = "left" as const;
const PICKER_TOOLTIP_SIDE_OFFSET = 8;

export const ModelPickerSidebar = memo(function ModelPickerSidebar(props: {
  label: string;
  selection: ModelPickerRailSelection;
  items: ReadonlyArray<ModelPickerRailItem>;
  onSelectInstance: (instanceId: ModelPickerRailSelection) => void;
  onFocusSearch: () => void;
}) {
  const [hoveredInstanceId, setHoveredInstanceId] = useState<ProviderInstanceId | null>(null);
  const sidebarContentRef = useRef<HTMLDivElement>(null);
  const [selectedIndicatorTop, setSelectedIndicatorTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const content = sidebarContentRef.current;
    if (!content) {
      return;
    }
    const selectedItem = Array.from(
      content.querySelectorAll<HTMLElement>("[data-model-picker-provider]"),
    ).find((item) => item.dataset.modelPickerProvider === props.selection);
    if (!selectedItem) {
      setSelectedIndicatorTop(null);
      return;
    }
    setSelectedIndicatorTop(selectedItem.offsetTop + selectedItem.offsetHeight / 2 - 10);
  }, [props.items, props.selection]);

  return (
    <Toolbar.Root
      className="w-11 shrink-0 overflow-hidden bg-muted/30"
      data-model-picker-sidebar="true"
      aria-label={props.label}
      orientation="vertical"
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === "ArrowRight") {
          event.preventDefault();
          props.onFocusSearch();
          return;
        }
      }}
    >
      <div className="h-full overflow-y-auto overscroll-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div ref={sidebarContentRef} className="relative flex min-h-full flex-col gap-1 p-1">
          {selectedIndicatorTop !== null ? (
            <div
              data-model-picker-selected-indicator="true"
              className={cn(
                SELECTED_INDICATOR_CLASS,
                "right-0 translate-y-0 transition-[top] duration-200 ease-out",
              )}
              style={{ top: selectedIndicatorTop }}
            />
          ) : null}
          {props.items.map((item) => {
            if (item.kind === "favorites") {
              return [
                <div key={item.id} className="relative w-full" data-model-picker-provider={item.id}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Toolbar.Button
                          className={cn(
                            "relative isolate flex w-full cursor-pointer aspect-square items-center justify-center rounded-md transition-colors hover:bg-foreground/10 focus-visible:bg-foreground/10 focus-visible:outline-none",
                          )}
                          onClick={() => props.onSelectInstance(item.id)}
                          type="button"
                          aria-label={item.label}
                          aria-pressed={item.active}
                        >
                          <StarIcon className="size-5 fill-current shrink-0" aria-hidden />
                        </Toolbar.Button>
                      }
                    />
                    <TooltipPopup
                      side={PICKER_TOOLTIP_SIDE}
                      sideOffset={PICKER_TOOLTIP_SIDE_OFFSET}
                      align="center"
                    >
                      {item.label}
                    </TooltipPopup>
                  </Tooltip>
                </div>,
                <div
                  key={`${item.id}-divider`}
                  className="border-b border-border/70"
                  aria-hidden="true"
                />,
              ];
            }

            const isHovered = hoveredInstanceId === item.id;
            const button = (
              <Toolbar.Button
                className={cn(
                  "relative isolate flex w-full cursor-pointer aspect-square items-center justify-center rounded-md transition-colors hover:bg-foreground/10 focus-visible:bg-foreground/10 focus-visible:outline-none",
                  item.disabled && "opacity-50 cursor-not-allowed hover:bg-transparent",
                )}
                data-provider-accent-color={item.accentColor}
                onClick={() => !item.disabled && props.onSelectInstance(item.id)}
                onMouseEnter={() => setHoveredInstanceId(item.id)}
                onMouseLeave={() =>
                  setHoveredInstanceId((current) => (current === item.id ? null : current))
                }
                onFocus={() => setHoveredInstanceId(item.id)}
                onBlur={() =>
                  setHoveredInstanceId((current) => (current === item.id ? null : current))
                }
                disabled={item.disabled}
                focusableWhenDisabled={!item.disabled}
                aria-pressed={item.active}
                type="button"
                aria-label={item.ariaLabel}
              >
                <ProviderInstanceIcon
                  driverKind={item.driverKind}
                  displayName={item.displayName}
                  accentColor={item.accentColor}
                  showBadge={item.showInstanceBadge}
                  className="size-6 z-30"
                  iconClassName="size-5"
                  indicatorBackground={
                    isHovered && !item.disabled
                      ? "var(--muted)"
                      : item.active
                        ? "var(--background)"
                        : "color-mix(in oklab, var(--muted) 30%, transparent)"
                  }
                  {...(item.accentColor ? { badgeClassName: "h-3 min-w-3 px-0.5 text-5xs" } : {})}
                />
              </Toolbar.Button>
            );

            const trigger = item.disabled ? (
              <span className="relative block w-full">{button}</span>
            ) : (
              button
            );

            return (
              <div key={item.id} className="relative w-full" data-model-picker-provider={item.id}>
                <Tooltip>
                  <TooltipTrigger render={trigger} />
                  <TooltipPopup
                    side={PICKER_TOOLTIP_SIDE}
                    sideOffset={PICKER_TOOLTIP_SIDE_OFFSET}
                    align="center"
                  >
                    {item.tooltip}
                  </TooltipPopup>
                </Tooltip>
              </div>
            );
          })}
        </div>
      </div>
    </Toolbar.Root>
  );
});
