import type { UsageProviderKind } from "@t3tools/contracts";
import type { DailyTotals, HourlyTotals } from "@t3tools/shared/usageMerge";
import {
  formatDayShort,
  formatHourShort,
  formatRelativeHourShort,
  formatTokens,
  formatUsd,
} from "@t3tools/shared/usageFormat";

import {
  PROVIDER_ORDER,
  USAGE_PROVIDER_STYLES,
  type UsageProviderStyle,
} from "./usageProviders.logic";

export const USAGE_CHART_VIEW_WIDTH = 960;
export const USAGE_CHART_VIEW_HEIGHT = 260;
export const USAGE_CHART_PLOT_TOP = 8;
const TICK_COUNT = 4;

export type UsageChartMetric = "tokens" | "cost";
export type UsageChartResolution = "day" | "hour";

/** One day's per-provider values, shared by the paths and the hover readout. */
export type DayColumn = {
  readonly bands: readonly {
    readonly provider: UsageProviderKind;
    readonly value: number;
  }[];
  readonly total: number;
};

type Point = {
  readonly x: number;
  readonly y: number;
};

type CurveSegment = {
  readonly from: Point;
  readonly c1: Point;
  readonly c2: Point;
  readonly to: Point;
};

export type UsageProviderChartInput = {
  readonly providers: readonly UsageProviderKind[];
  readonly days: readonly string[];
  readonly daily: readonly DailyTotals[];
  readonly hours: readonly string[];
  readonly hourly: readonly HourlyTotals[];
  readonly metric: UsageChartMetric;
  readonly referenceTime: string | undefined;
  readonly resolution: UsageChartResolution;
  readonly timeZone: string;
  readonly styleOverrides?: Partial<Record<UsageProviderKind, UsageProviderStyle>> | undefined;
};

export type UsageProviderChartTick = {
  readonly value: number;
  readonly y: number;
  readonly topPercent: string;
  readonly label: string;
};

export type UsageProviderChartPath = {
  readonly provider: UsageProviderKind;
  readonly color: string;
  readonly area: string;
  readonly line: string;
};

export type UsageProviderChartTooltipRow = {
  readonly provider: UsageProviderKind;
  readonly label: string;
  readonly valueLabel: string;
};

export type UsageProviderChartColumn = {
  readonly period: string;
  readonly x: number;
  readonly tooltipTitle: string;
  readonly rows: readonly UsageProviderChartTooltipRow[];
  readonly totalLabel: string;
};

export type UsageProviderChartModel = {
  readonly viewWidth: number;
  readonly viewHeight: number;
  readonly plotTop: number;
  readonly viewBox: string;
  readonly ariaLabel: string;
  readonly ticks: readonly UsageProviderChartTick[];
  readonly paths: readonly UsageProviderChartPath[];
  readonly columns: readonly UsageProviderChartColumn[];
  readonly axisLabels: {
    readonly start: string;
    readonly middle: string;
    readonly end: string;
  };
};

function valueFor(
  totals: DailyTotals | HourlyTotals | undefined,
  provider: UsageProviderKind,
  metric: UsageChartMetric,
): number {
  const entry = totals?.byProvider.get(provider);
  if (entry === undefined) return 0;
  return metric === "tokens" ? entry.totalTokens : entry.costUsd;
}

export function buildPeriodColumns(
  periods: readonly string[],
  byPeriod: ReadonlyMap<string, DailyTotals | HourlyTotals>,
  metric: UsageChartMetric,
): readonly DayColumn[] {
  return periods.map((period) => {
    const entry = byPeriod.get(period);
    const bands = PROVIDER_ORDER.map((provider) => ({
      provider,
      value: valueFor(entry, provider, metric),
    }));
    return { bands, total: bands.reduce((sum, band) => sum + band.value, 0) };
  });
}

/** Shape-preserving cubic tangents that cannot overshoot spiky usage data. */
function monotoneTangents(points: readonly Point[]): readonly number[] {
  const count = points.length;
  if (count < 2) return [0];

  const slopes: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const dx = (points[index + 1]?.x ?? 0) - (points[index]?.x ?? 0);
    const dy = (points[index + 1]?.y ?? 0) - (points[index]?.y ?? 0);
    slopes.push(dx === 0 ? 0 : dy / dx);
  }

  const tangents: number[] = Array.from({ length: count }, () => 0);
  tangents[0] = slopes[0] ?? 0;
  tangents[count - 1] = slopes[count - 2] ?? 0;
  for (let index = 1; index < count - 1; index += 1) {
    const previous = slopes[index - 1] ?? 0;
    const next = slopes[index] ?? 0;
    tangents[index] = previous * next <= 0 ? 0 : (previous + next) / 2;
  }

  for (let index = 0; index < count - 1; index += 1) {
    const slope = slopes[index] ?? 0;
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const a = (tangents[index] ?? 0) / slope;
    const b = (tangents[index + 1] ?? 0) / slope;
    const magnitude = a * a + b * b;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[index] = scale * a * slope;
      tangents[index + 1] = scale * b * slope;
    }
  }

  return tangents;
}

function smoothCurve(points: readonly Point[]): readonly CurveSegment[] {
  if (points.length < 2) return [];
  const tangents = monotoneTangents(points);
  const segments: CurveSegment[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (from === undefined || to === undefined) continue;
    const dx = to.x - from.x;
    segments.push({
      from,
      c1: { x: from.x + dx / 3, y: from.y + ((tangents[index] ?? 0) * dx) / 3 },
      c2: { x: to.x - dx / 3, y: to.y - ((tangents[index + 1] ?? 0) * dx) / 3 },
      to,
    });
  }
  return segments;
}

function curvePath(segments: readonly CurveSegment[]): string {
  const first = segments[0];
  if (first === undefined) return "";
  let path = `M${first.from.x.toFixed(2)},${first.from.y.toFixed(2)}`;
  for (const segment of segments) {
    path += ` C${segment.c1.x.toFixed(2)},${segment.c1.y.toFixed(2)} ${segment.c2.x.toFixed(2)},${segment.c2.y.toFixed(2)} ${segment.to.x.toFixed(2)},${segment.to.y.toFixed(2)}`;
  }
  return path;
}

/**
 * Builds a scale whose maximum is a readable 1/2/5 x 10^n step at or above the
 * peak.
 *
 * Rounding the maximum *up* is the point: stopping at the last step below the
 * peak leaves the tallest day drawn past the top of the plot, where it is
 * clipped.
 */
export function niceScale(peak: number, count: number): { max: number; ticks: readonly number[] } {
  if (peak <= 0) return { max: 0, ticks: [0] };

  const rawStep = peak / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized > 5 ? 10 : normalized > 2 ? 5 : normalized > 1 ? 2 : 1) * magnitude;

  const max = Math.ceil(peak / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 1e-6; value += step) ticks.push(value);
  return { max, ticks };
}

export function formatUsageChartValue(metric: UsageChartMetric, value: number): string {
  return metric === "tokens" ? formatTokens(value) : formatUsd(value);
}

export function usageChartTitle(metric: UsageChartMetric, resolution: UsageChartResolution) {
  return `${resolution === "hour" ? "Hourly" : "Daily"} ${metric === "tokens" ? "processed tokens" : "cost"}`;
}

export function buildUsageProviderChartModel(
  input: UsageProviderChartInput,
): UsageProviderChartModel {
  const styles = { ...USAGE_PROVIDER_STYLES, ...input.styleOverrides };
  const periods = input.resolution === "hour" ? input.hours : input.days;
  const byPeriod: ReadonlyMap<string, DailyTotals | HourlyTotals> =
    input.resolution === "hour"
      ? new Map(input.hourly.map((entry) => [entry.hourStart, entry]))
      : new Map(input.daily.map((entry) => [entry.day, entry]));
  const format = (value: number) => formatUsageChartValue(input.metric, value);
  const formatPeriod = (period: string) =>
    input.resolution === "hour" ? formatHourShort(period, input.timeZone) : formatDayShort(period);
  const formatTooltipPeriod = (period: string) =>
    input.resolution === "hour" && input.referenceTime !== undefined
      ? formatRelativeHourShort(period, input.referenceTime, input.timeZone)
      : formatPeriod(period);

  const columns = periods.length === 0 ? [] : buildPeriodColumns(periods, byPeriod, input.metric);
  // The scale tops out at the largest single provider-period, not the sum:
  // layered series each measure from zero, so a combined peak would leave
  // the plot permanently half empty.
  const peak = columns.reduce(
    (max, column) => column.bands.reduce((inner, band) => Math.max(inner, band.value), max),
    0,
  );
  const scale = periods.length === 0 ? { max: 0, ticks: [0] } : niceScale(peak, TICK_COUNT);
  const stepX =
    periods.length === 0 || periods.length === 1
      ? 0
      : USAGE_CHART_VIEW_WIDTH / (periods.length - 1);
  // Leave room above the top gridline so the constant-width stroke is not
  // clipped when a series reaches the peak.
  const toY = (value: number) =>
    periods.length === 0 || scale.max === 0
      ? USAGE_CHART_VIEW_HEIGHT
      : USAGE_CHART_VIEW_HEIGHT -
        (value / scale.max) * (USAGE_CHART_VIEW_HEIGHT - USAGE_CHART_PLOT_TOP);

  const built =
    periods.length === 0
      ? []
      : input.providers.map((provider) => {
          const providerIndex = PROVIDER_ORDER.indexOf(provider);
          const line = curvePath(
            smoothCurve(
              columns.map((column, periodIndex) => ({
                x: periodIndex * stepX,
                y: toY(column.bands[providerIndex]?.value ?? 0),
              })),
            ),
          );
          return {
            provider,
            color: styles[provider].color,
            total: columns.reduce(
              (sum, column) => sum + (column.bands[providerIndex]?.value ?? 0),
              0,
            ),
            area:
              line === ""
                ? ""
                : `${line} L${USAGE_CHART_VIEW_WIDTH},${USAGE_CHART_VIEW_HEIGHT} L0,${USAGE_CHART_VIEW_HEIGHT} Z`,
            line,
          };
        });

  const middle = periods[Math.floor(periods.length / 2)];
  const first = periods[0];
  const last = periods[periods.length - 1];

  return {
    viewWidth: USAGE_CHART_VIEW_WIDTH,
    viewHeight: USAGE_CHART_VIEW_HEIGHT,
    plotTop: USAGE_CHART_PLOT_TOP,
    viewBox: `0 0 ${USAGE_CHART_VIEW_WIDTH} ${USAGE_CHART_VIEW_HEIGHT}`,
    ariaLabel: `${usageChartTitle(input.metric, input.resolution)} by provider`,
    ticks: scale.ticks.map((tick) => {
      const y = toY(tick);
      return {
        value: tick,
        y,
        topPercent: `${(y / USAGE_CHART_VIEW_HEIGHT) * 100}%`,
        label: tick === 0 ? "0" : format(tick),
      };
    }),
    // Paint the heavier series first so the lighter one is not buried.
    paths: built
      .toSorted((a, b) => b.total - a.total)
      .map(({ provider, color, area, line }) => ({ provider, color, area, line })),
    columns: periods.map((period, index) => {
      const column = columns[index];
      return {
        period,
        x: index * stepX,
        tooltipTitle: formatTooltipPeriod(period),
        rows: input.providers.map((provider) => ({
          provider,
          label: styles[provider].label,
          valueLabel: format(column?.bands.find((band) => band.provider === provider)?.value ?? 0),
        })),
        totalLabel: format(column?.total ?? 0),
      };
    }),
    axisLabels: {
      start: first === undefined ? "" : formatPeriod(first),
      middle: middle === undefined ? "" : formatPeriod(middle),
      end: last === undefined ? "" : formatPeriod(last),
    },
  };
}

export function resolveUsageChartHoverIndex(fraction: number, periodCount: number): number | null {
  if (periodCount === 0) return null;
  const index = Math.round(fraction * (periodCount - 1));
  return Math.min(periodCount - 1, Math.max(0, index));
}
