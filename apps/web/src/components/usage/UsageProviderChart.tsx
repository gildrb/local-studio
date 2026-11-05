import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { PROVIDER_PRESENTATION } from "./usageProviders";
import {
  resolveUsageChartHoverIndex,
  type UsageProviderChartModel,
} from "./UsageProviderChart.logic";

export function UsageProviderChart({
  model,
  presentation,
}: {
  readonly model: UsageProviderChartModel;
  readonly presentation?: Partial<typeof PROVIDER_PRESENTATION>;
}) {
  const present = { ...PROVIDER_PRESENTATION, ...presentation };
  const periodCount = model.columns.length;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const hoverPositionRef = useRef<{ x: number; y: number } | null>(null);

  const positionTooltip = useCallback(() => {
    const plot = plotRef.current;
    const tooltip = tooltipRef.current;
    const hoverPosition = hoverPositionRef.current;
    if (plot === null || tooltip === null || hoverPosition === null) return;

    const gap = 12;
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    const plotWidth = plot.clientWidth;
    const plotHeight = plot.clientHeight;
    const preferredLeft =
      hoverPosition.x + gap + tooltipWidth <= plotWidth
        ? hoverPosition.x + gap
        : hoverPosition.x - gap - tooltipWidth;
    const preferredTop =
      hoverPosition.y + gap + tooltipHeight <= plotHeight
        ? hoverPosition.y + gap
        : hoverPosition.y - gap - tooltipHeight;
    const left = Math.min(Math.max(0, preferredLeft), Math.max(0, plotWidth - tooltipWidth));
    const top = Math.min(Math.max(0, preferredTop), Math.max(0, plotHeight - tooltipHeight));
    plot.style.setProperty("--usage-tooltip-left", `${left}px`);
    plot.style.setProperty("--usage-tooltip-top", `${top}px`);
  }, []);

  useLayoutEffect(() => {
    if (hoverIndex === null) return;
    positionTooltip();

    const plot = plotRef.current;
    const tooltip = tooltipRef.current;
    if (plot === null || tooltip === null || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(positionTooltip);
    observer.observe(plot);
    observer.observe(tooltip);
    return () => observer.disconnect();
  }, [hoverIndex, positionTooltip]);

  const handleMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const plot = plotRef.current;
      if (plot === null || periodCount === 0) return;
      const bounds = plot.getBoundingClientRect();
      if (bounds.width === 0) return;
      const localX = Math.min(bounds.width, Math.max(0, event.clientX - bounds.left));
      const localY = Math.min(bounds.height, Math.max(0, event.clientY - bounds.top));
      hoverPositionRef.current = { x: localX, y: localY };
      positionTooltip();
      setHoverIndex(resolveUsageChartHoverIndex(localX / bounds.width, periodCount));
    },
    [periodCount, positionTooltip],
  );

  const hovered = hoverIndex === null ? undefined : model.columns[hoverIndex];

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        {/* Axis labels sit outside the plot so they stay aligned to gridlines. */}
        <div className="relative h-56 w-14 shrink-0">
          {model.ticks.map((tick) => (
            <span
              key={tick.value}
              className="absolute right-0 -translate-y-1/2 text-3xs text-muted-foreground tabular-nums"
              style={{ top: tick.topPercent }}
            >
              {tick.label}
            </span>
          ))}
        </div>

        <div
          ref={plotRef}
          className="relative h-56 flex-1"
          onMouseMove={handleMove}
          onMouseLeave={() => {
            hoverPositionRef.current = null;
            setHoverIndex(null);
          }}
        >
          <svg
            className="h-full w-full"
            viewBox={model.viewBox}
            preserveAspectRatio="none"
            role="img"
            aria-label={model.ariaLabel}
          >
            {model.ticks.map((tick) => (
              <line
                key={tick.value}
                x1={0}
                x2={model.viewWidth}
                y1={tick.y}
                y2={tick.y}
                stroke="currentColor"
                strokeWidth={1}
                className="text-border"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {/* Fills first, then every stroke, so no series covers another's line. */}
            {model.paths.map(({ provider, area, color }) => (
              <path key={provider} d={area} fill={color} fillOpacity={0.12} />
            ))}
            {model.paths.map(({ provider, line, color }) => (
              <path
                key={provider}
                d={line}
                fill="none"
                stroke={color}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {hovered === undefined ? null : (
              <line
                x1={hovered.x}
                x2={hovered.x}
                y1={model.plotTop}
                y2={model.viewHeight}
                stroke="currentColor"
                strokeWidth={1}
                className="text-muted-foreground"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>

          {hovered === undefined ? null : (
            <div
              ref={tooltipRef}
              className="surface-glass pointer-events-none absolute z-10 min-w-36 max-w-full rounded-xl border border-border/50 px-2.5 py-2 text-xs shadow-lg"
              style={{
                left: "var(--usage-tooltip-left, 0px)",
                top: "var(--usage-tooltip-top, 0px)",
              }}
            >
              <div className="mb-1 text-muted-foreground">{hovered.tooltipTitle}</div>
              {hovered.rows.map((row) => {
                const Mark = present[row.provider].mark;
                return (
                  <div key={row.provider} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Mark className="size-3 shrink-0" aria-hidden />
                      {row.label}
                    </span>
                    <span className="text-foreground tabular-nums">{row.valueLabel}</span>
                  </div>
                );
              })}
              <div className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-1">
                <span className="text-muted-foreground">Total</span>
                <span className="text-foreground tabular-nums">{hovered.totalLabel}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-between pl-16 text-3xs text-muted-foreground uppercase">
        <span>{model.axisLabels.start}</span>
        <span>{model.axisLabels.middle}</span>
        <span>{model.axisLabels.end}</span>
      </div>
    </div>
  );
}
