import { ProcessSignalActions } from "./ProcessSignalActions";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import {
  ActivityIcon,
  AlertTriangleIcon,
  BatteryIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CpuIcon,
  DatabaseIcon,
  GaugeIcon,
  HardDriveIcon,
  MemoryStickIcon,
  type LucideIcon,
} from "lucide-react";
import type { EnvironmentId, ServerProcessSignal } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import {
  useResourceTelemetry,
  useResourceTelemetryHistory,
} from "../../lib/resourceTelemetryState";
import { cn } from "../../lib/utils";
import { ensureLocalApi } from "../../localApi";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import {
  buildResourceLastSampleModel,
  buildResourceTelemetryFailureToast,
  buildResourceTelemetryModel,
  DEFAULT_RESOURCE_HISTORY_WINDOW_MS,
  resolveResourceHistoryQuery,
  resolveResourceTelemetryChange,
  type ResourceAggregateAccent,
  type ResourceAggregateCardModel,
  type ResourceAttributionColumnId,
  type ResourceAttributionSectionModel,
  type ResourceDetailRowModel,
  type ResourceHealthSourceModel,
  type ResourceHistoryBarModel,
  type ResourceHistoryLegendItemModel,
  type ResourceHistoryProcessColumnId,
  type ResourceHistoryWindowSelectorModel,
  type ResourceLiveProcessColumnId,
  type ResourceLiveProcessRowModel,
  type ResourceProcessCategoryDot,
  type ResourceProcessTreeSectionModel,
  type ResourceSourceStatusBadgeModel,
  type ResourceTelemetryIcon,
  type ResourceTelemetryStatModel,
  type ResourceTelemetryTone,
  type ResourceTimelineSectionModel,
} from "./ResourceTelemetryDiagnostics.logic";
import { SettingsSection, useRelativeTimeTick } from "./settingsLayout";

const RESOURCE_TELEMETRY_ICONS: Record<ResourceTelemetryIcon, LucideIcon> = {
  activity: ActivityIcon,
  battery: BatteryIcon,
  cpu: CpuIcon,
  database: DatabaseIcon,
  gauge: GaugeIcon,
  "hard-drive": HardDriveIcon,
  "memory-stick": MemoryStickIcon,
};

const CATEGORY_DOT_CLASS: Record<ResourceProcessCategoryDot, string> = {
  warning: "bg-warning",
  info: "bg-info",
  violet: "bg-violet-500",
  success: "bg-success",
};

const AGGREGATE_ACCENT_CLASS: Record<ResourceAggregateAccent, string> = {
  success: "bg-success/80",
  info: "bg-info/80",
  warning: "bg-warning/80",
};

const DETAIL_VALUE_TONE_CLASS: Record<ResourceTelemetryTone, string | undefined> = {
  default: undefined,
  warning: "text-warning-foreground",
  danger: "text-destructive",
};

const HISTORY_LEGEND_CLASS: Record<ResourceHistoryLegendItemModel["id"], string> = {
  cpu: "bg-foreground/70",
  read: "bg-info/70",
  write: "bg-warning/80",
};

const LIVE_PROCESS_HEADER_CLASS: Record<ResourceLiveProcessColumnId, string> = {
  process: "px-4 py-2 font-semibold sm:pl-5",
  category: "px-3 py-2 font-semibold",
  cpu: "px-3 py-2 text-right font-semibold",
  "cpu-time": "px-3 py-2 text-right font-semibold",
  memory: "px-3 py-2 text-right font-semibold",
  "read-rate": "px-3 py-2 text-right font-semibold",
  "write-rate": "px-3 py-2 text-right font-semibold",
  "read-total": "px-3 py-2 text-right font-semibold",
  "write-total": "px-3 py-2 text-right font-semibold",
  pid: "px-3 py-2 text-right font-semibold",
  kill: "px-2 py-2 text-right font-semibold sm:pr-4",
};

const HISTORY_PROCESS_HEADER_CLASS: Record<ResourceHistoryProcessColumnId, string> = {
  process: "px-4 py-2 font-semibold sm:pl-5",
  category: "px-3 py-2 font-semibold",
  "cpu-time": "px-3 py-2 text-right font-semibold",
  "peak-cpu": "px-3 py-2 text-right font-semibold",
  "peak-memory": "px-3 py-2 text-right font-semibold",
  read: "px-3 py-2 text-right font-semibold",
  write: "px-3 py-2 text-right font-semibold",
  samples: "px-3 py-2 text-right font-semibold",
  pid: "px-3 py-2 text-right font-semibold sm:pr-5",
};

const ATTRIBUTION_HEADER_CLASS: Record<ResourceAttributionColumnId, string> = {
  component: "px-4 py-2 font-semibold sm:pl-5",
  operation: "px-3 py-2 font-semibold",
  "logical-read": "px-3 py-2 text-right font-semibold",
  "logical-write": "px-3 py-2 text-right font-semibold",
  count: "px-3 py-2 text-right font-semibold",
  time: "px-3 py-2 text-right font-semibold sm:pr-5",
};

function TelemetryIcon({ icon, className }: { icon: ResourceTelemetryIcon; className: string }) {
  const Icon = RESOURCE_TELEMETRY_ICONS[icon];
  return <Icon className={className} />;
}

function SourceStatusBadge({ badge }: { badge: ResourceSourceStatusBadgeModel }) {
  const { tone } = badge;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-3xs font-semibold uppercase tracking-widest",
        tone === "neutral" && "border-border/70 bg-muted/45 text-muted-foreground",
        tone === "default" && "border-success/25 bg-success/10 text-success-foreground",
        tone === "warning" && "border-warning/30 bg-warning/10 text-warning-foreground",
        tone === "danger" && "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          tone === "neutral" && "bg-muted-foreground/55",
          tone === "default" && "bg-success",
          tone === "warning" && "bg-warning",
          tone === "danger" && "bg-destructive",
        )}
      />
      {badge.prefix} {badge.text}
    </span>
  );
}

function LastSampleLabel({ sampledAtIso }: { sampledAtIso: string | null }) {
  const nowMs = useRelativeTimeTick();
  const lastSample = buildResourceLastSampleModel({ sampledAtIso, nowMs });
  if (lastSample.kind === "waiting") {
    return <span className="text-2xs text-muted-foreground/55">{lastSample.label}</span>;
  }
  return (
    <span className="text-2xs text-muted-foreground/60">
      {lastSample.prefix} <span className="font-mono tabular-nums">{lastSample.value}</span>
      {lastSample.suffix ? ` ${lastSample.suffix}` : ""}
    </span>
  );
}

function IconStat({ stat }: { stat: ResourceTelemetryStatModel }) {
  return (
    <div className="group min-w-0 px-4 py-4 sm:px-5">
      <div className="flex items-center gap-2 text-3xs font-semibold uppercase tracking-widest text-muted-foreground/70">
        <span className="text-muted-foreground/55 transition-colors group-hover:text-foreground/65">
          <TelemetryIcon icon={stat.icon} className="size-3.5" />
        </span>
        <span className="truncate">{stat.label}</span>
      </div>
      <div
        className={cn(
          "mt-2.5 truncate font-mono text-2xl font-semibold tracking-tighter tabular-nums text-foreground",
          stat.tone === "warning" && "text-warning-foreground",
          stat.tone === "danger" && "text-destructive",
        )}
      >
        {stat.value}
      </div>
      {stat.detail ? (
        <div className="mt-1.5 truncate text-3xs text-muted-foreground/60">{stat.detail}</div>
      ) : null}
    </div>
  );
}

function AggregateCard({ card }: { card: ResourceAggregateCardModel }) {
  return (
    <div className="relative overflow-hidden border-t border-border/60 px-4 py-4 first:border-t-0 md:border-t-0 md:border-l md:first:border-l-0 sm:px-5">
      <span
        className={cn(
          "absolute inset-x-5 top-0 h-0.5 rounded-full opacity-75",
          AGGREGATE_ACCENT_CLASS[card.accent],
        )}
      />
      <div className="flex items-center justify-between gap-3">
        <div className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground/75">
          {card.label}
        </div>
        <div className="rounded-md bg-muted/55 px-1.5 py-0.5 font-mono text-3xs tabular-nums text-muted-foreground/70">
          {card.processCountLabel}
        </div>
      </div>
      <div className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-2.5">
        {card.metrics.map((metric) => (
          <MetricPair key={metric.id} label={metric.label} value={metric.value} />
        ))}
      </div>
    </div>
  );
}

function MetricPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground/45">
        {label}
      </div>
      <div className="truncate font-mono text-xs font-medium tabular-nums text-foreground/90">
        {value}
      </div>
    </div>
  );
}

function HealthSource({ source }: { source: ResourceHealthSourceModel }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-border/50 py-3 first:border-t-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{source.label}</div>
        <div className="mt-1 text-2xs leading-relaxed text-muted-foreground/65">
          {source.description}
        </div>
      </div>
      <SourceStatusBadge badge={source.badge} />
    </div>
  );
}

function DetailRow({ row }: { row: ResourceDetailRowModel }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border/50 py-2.5 first:border-t-0">
      <span className="text-2xs text-muted-foreground/75">{row.label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-right font-mono text-2xs tabular-nums text-foreground/85",
          DETAIL_VALUE_TONE_CLASS[row.tone],
        )}
      >
        {row.value}
      </span>
    </div>
  );
}

function HistoryWindowSelector({
  selector,
  onSelect,
}: {
  selector: ResourceHistoryWindowSelectorModel;
  onSelect: (value: string | null) => void;
}) {
  return (
    <ToggleGroup
      aria-label={selector.ariaLabel}
      variant="segmented"
      value={[selector.value]}
      onValueChange={(next) => onSelect(next[0] ?? null)}
    >
      {selector.options.map((option) => (
        <Toggle key={option.windowMs} value={option.value}>
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

function ResourceHistoryChart({
  legend,
  bars,
}: {
  legend: ReadonlyArray<ResourceHistoryLegendItemModel>;
  bars: ReadonlyArray<ResourceHistoryBarModel>;
}) {
  return (
    <div className="border-t border-border/60 px-4 py-4 sm:px-5">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-3xs text-muted-foreground/65">
        {legend.map((item) => (
          <span key={item.id} className="inline-flex items-center gap-1.5">
            <span className={cn("h-1.5 w-3 rounded-full", HISTORY_LEGEND_CLASS[item.id])} />{" "}
            {item.label}
          </span>
        ))}
      </div>
      <div className="flex h-32 items-end gap-1 overflow-hidden rounded-lg border border-border/40 bg-muted/8 px-2 pt-3 pb-2">
        {bars.map((bar) => (
          <Tooltip key={bar.id}>
            <TooltipTrigger
              render={
                <div className="grid h-full min-w-1 flex-1 grid-cols-3 items-end gap-px">
                  <span
                    className="block rounded-t-sm bg-foreground/65"
                    style={{ height: `${bar.cpuHeightPercent}%` }}
                  />
                  <span
                    className="block rounded-t-sm bg-info/70"
                    style={{ height: `${bar.readHeightPercent}%` }}
                  />
                  <span
                    className="block rounded-t-sm bg-warning/80"
                    style={{ height: `${bar.writeHeightPercent}%` }}
                  />
                </div>
              }
            />
            <TooltipPopup side="top" className="text-left">
              <div className="space-y-0.5">
                {bar.tooltipLines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            </TooltipPopup>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

function ProcessTreeName({
  row,
  onToggle,
}: {
  row: ResourceLiveProcessRowModel;
  onToggle: (processKey: string) => void;
}) {
  const ChevronIcon = row.collapsed ? ChevronRightIcon : ChevronDownIcon;
  return (
    <div
      className="grid min-w-0 grid-cols-[1.25rem_0.375rem_minmax(0,1fr)] items-center gap-2"
      style={{ paddingLeft: `${row.indentPx}px` }}
    >
      {row.hasChildren ? (
        <Button
          size="icon-micro"
          variant="ghost-muted"
          onClick={() => onToggle(row.id)}
          aria-label={row.toggleLabel}
        >
          <ChevronIcon className="size-3.5" />
        </Button>
      ) : (
        <span className="size-5" aria-hidden />
      )}
      <span className={cn("size-1.5 rounded-full", CATEGORY_DOT_CLASS[row.categoryDot])} />
      <Tooltip>
        <TooltipTrigger
          render={<span className="min-w-0 truncate font-medium text-foreground">{row.name}</span>}
        />
        <TooltipPopup side="top" variant="code">
          {row.commandTooltip}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

function ProcessActions({
  row,
  onSignal,
}: {
  row: ResourceLiveProcessRowModel;
  onSignal: (row: ResourceLiveProcessRowModel, signal: ServerProcessSignal) => void;
}) {
  if (!row.signal.available) {
    return <span className="text-3xs text-muted-foreground/35">—</span>;
  }
  return (
    <ProcessSignalActions
      disabled={row.signal.disabled}
      onSignal={(signal) => onSignal(row, signal)}
    />
  );
}

function ProcessTable({
  section,
  onToggle,
  onSignal,
}: {
  section: ResourceProcessTreeSectionModel;
  onToggle: (processKey: string) => void;
  onSignal: (row: ResourceLiveProcessRowModel, signal: ServerProcessSignal) => void;
}) {
  return (
    <div className="border-t border-border/60">
      <ScrollArea
        chainVerticalScroll
        scrollFade
        hideScrollbars
        className="max-h-[min(68vh,48rem)] w-full max-w-full"
      >
        <table className="w-full min-w-[1320px] table-fixed text-left text-xs">
          <colgroup>
            <col className="w-[20%]" />
            <col className="w-[10%]" />
            <col className="w-[7%]" />
            <col className="w-[8%]" />
            <col className="w-[9%]" />
            <col className="w-[9%]" />
            <col className="w-[9%]" />
            <col className="w-[10%]" />
            <col className="w-[8%]" />
            <col className="w-[6%]" />
            <col className="w-[4%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 border-b border-border/60 bg-card text-3xs uppercase tracking-widest text-muted-foreground/65">
            <tr>
              {section.columns.map((column) => (
                <th key={column.id} className={LIVE_PROCESS_HEADER_CLASS[column.id]}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {section.emptyLabel !== null ? (
              <tr>
                <td
                  colSpan={section.columns.length}
                  className="px-4 py-5 text-xs text-muted-foreground sm:px-5"
                >
                  {section.emptyLabel}
                </td>
              </tr>
            ) : null}
            {section.rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/20">
                <td className="px-4 py-2 sm:pl-5">
                  <ProcessTreeName row={row} onToggle={onToggle} />
                </td>
                <td className="truncate px-3 py-2 text-2xs text-muted-foreground">
                  {row.categoryLabel}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{row.cpu}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{row.cpuTime}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{row.memory}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-info-foreground">
                  {row.readRate}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-warning-foreground">
                  {row.writeRate}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {row.readTotal}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  <Tooltip>
                    <TooltipTrigger render={<span>{row.writeTotal}</span>} />
                    <TooltipPopup side="top">{row.ioSemanticsLabel}</TooltipPopup>
                  </Tooltip>
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {row.pid}
                </td>
                <td className="px-2 py-2 text-right sm:pr-4">
                  <ProcessActions row={row} onSignal={onSignal} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

function HistoryProcessTable({ section }: { section: ResourceTimelineSectionModel }) {
  return (
    <div className="border-t border-border/60">
      <ScrollArea
        chainVerticalScroll
        scrollFade
        hideScrollbars
        className="max-h-[28rem] w-full max-w-full"
      >
        <table className="w-full min-w-[1020px] table-fixed text-left text-xs">
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[11%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[11%]" />
            <col className="w-[11%]" />
            <col className="w-[11%]" />
            <col className="w-[7%]" />
            <col className="w-[5%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 border-b border-border/60 bg-card text-3xs uppercase tracking-widest text-muted-foreground/65">
            <tr>
              {section.processColumns.map((column) => (
                <th key={column.id} className={HISTORY_PROCESS_HEADER_CLASS[column.id]}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {section.processEmptyLabel !== null ? (
              <tr>
                <td
                  colSpan={section.processColumns.length}
                  className="px-4 py-5 text-xs text-muted-foreground sm:px-5"
                >
                  {section.processEmptyLabel}
                </td>
              </tr>
            ) : null}
            {section.processRows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/20">
                <td className="px-4 py-2 sm:pl-5">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span className="block truncate font-medium text-foreground">
                          {row.name}
                        </span>
                      }
                    />
                    <TooltipPopup side="top" variant="code">
                      {row.commandTooltip}
                    </TooltipPopup>
                  </Tooltip>
                </td>
                <td className="truncate px-3 py-2 text-2xs text-muted-foreground">
                  {row.categoryLabel}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{row.cpuTime}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{row.peakCpu}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{row.peakMemory}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-info-foreground">
                  {row.read}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-warning-foreground">
                  {row.write}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {row.sampleCount}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground sm:pr-5">
                  {row.pid}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

function AttributionTable({ section }: { section: ResourceAttributionSectionModel }) {
  return (
    <div className="overflow-x-auto border-t border-border/60">
      <table className="w-full min-w-[720px] table-fixed text-left text-xs">
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-[28%]" />
          <col className="w-[14%]" />
          <col className="w-[14%]" />
          <col className="w-[10%]" />
          <col className="w-[12%]" />
        </colgroup>
        <thead className="border-b border-border/60 text-3xs uppercase tracking-widest text-muted-foreground/65">
          <tr>
            {section.columns.map((column) => (
              <th key={column.id} className={ATTRIBUTION_HEADER_CLASS[column.id]}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {section.emptyLabel !== null ? (
            <tr>
              <td
                colSpan={section.columns.length}
                className="px-4 py-5 text-xs text-muted-foreground sm:px-5"
              >
                {section.emptyLabel}
              </td>
            </tr>
          ) : null}
          {section.rows.map((row) => (
            <tr key={row.id} className="hover:bg-muted/20">
              <td className="truncate px-4 py-2 font-medium text-foreground sm:pl-5">
                {row.component}
              </td>
              <td className="truncate px-3 py-2 text-muted-foreground">{row.operation}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-info-foreground">
                {row.logicalRead}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-warning-foreground">
                {row.logicalWrite}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums">{row.count}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground sm:pr-5">
                {row.duration}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResourceTelemetryDiagnostics({
  environmentId,
}: {
  environmentId: EnvironmentId | null;
}) {
  const [windowMs, setWindowMs] = useState(DEFAULT_RESOURCE_HISTORY_WINDOW_MS);
  const telemetry = useResourceTelemetry(environmentId);
  const retryTelemetry = telemetry.retry;
  const history = useResourceTelemetryHistory(resolveResourceHistoryQuery(windowMs), environmentId);
  const signalServerProcess = useAtomCommand(serverEnvironment.signalProcess, {
    reportFailure: false,
  });
  const [collapsedProcessKeys, setCollapsedProcessKeys] = useState<ReadonlyArray<string>>([]);
  const [signalingKeys, setSignalingKeys] = useState<ReadonlyArray<string>>([]);
  const signalingKeysRef = useRef<ReadonlyArray<string>>([]);
  const environmentIdRef = useRef(environmentId);
  useEffect(() => {
    environmentIdRef.current = environmentId;
    return () => {
      environmentIdRef.current = null;
    };
  }, [environmentId]);
  const [isRetrying, setIsRetrying] = useState(false);

  const model = useMemo(
    () =>
      buildResourceTelemetryModel({
        snapshot: telemetry.data,
        snapshotError: telemetry.error,
        snapshotPending: telemetry.isPending,
        history: history.data,
        historyError: history.error,
        historyPending: history.isPending,
        selectedWindowMs: windowMs,
        collapsedProcessKeys,
        signalingProcessKeys: signalingKeys,
        isRetrying,
      }),
    [
      collapsedProcessKeys,
      history.data,
      history.error,
      history.isPending,
      isRetrying,
      signalingKeys,
      telemetry.data,
      telemetry.error,
      telemetry.isPending,
      windowMs,
    ],
  );
  const { monitor, host, timeline, processTree, attribution } = model;

  const selectWindow = useCallback((value: string | null) => {
    const change = resolveResourceTelemetryChange({ kind: "select-window", value });
    if (change.kind === "set-window") setWindowMs(change.windowMs);
  }, []);

  const toggleProcess = useCallback((processKey: string) => {
    setCollapsedProcessKeys((current) => {
      const change = resolveResourceTelemetryChange({
        kind: "toggle-process",
        processKey,
        collapsedProcessKeys: current,
      });
      return change.kind === "set-collapsed" ? change.collapsedProcessKeys : current;
    });
  }, []);

  const signalProcess = useCallback(
    async (row: ResourceLiveProcessRowModel, signal: ServerProcessSignal) => {
      const targetEnvironmentId = environmentIdRef.current;
      const change = resolveResourceTelemetryChange({
        kind: "signal-process",
        processKey: row.id,
        pid: row.pid,
        signal,
        signalingProcessKeys: signalingKeysRef.current,
        hasEnvironment: targetEnvironmentId !== null,
      });
      if (change.kind !== "send-signal" || targetEnvironmentId === null) return;
      const identityKey = row.id;
      const nextSignalingKeys = [...signalingKeysRef.current, identityKey];
      signalingKeysRef.current = nextSignalingKeys;
      setSignalingKeys(nextSignalingKeys);
      const clearSignaling = () => {
        const next = signalingKeysRef.current.filter((key) => key !== identityKey);
        signalingKeysRef.current = next;
        setSignalingKeys(next);
      };

      if (change.confirmMessage !== null) {
        let confirmed = false;
        try {
          confirmed = await ensureLocalApi().dialogs.confirm(change.confirmMessage, {
            variant: "destructive",
          });
        } catch (error) {
          clearSignaling();
          toastManager.add({
            type: "error",
            ...buildResourceTelemetryFailureToast({
              kind: "confirm-failed",
              signal,
              errorMessage: error instanceof Error ? error.message : null,
            }),
          });
          return;
        }
        if (!confirmed) {
          clearSignaling();
          return;
        }
      }
      if (environmentIdRef.current !== targetEnvironmentId) {
        clearSignaling();
        return;
      }
      void signalServerProcess({
        environmentId: targetEnvironmentId,
        input: {
          pid: row.pid,
          startTimeMs: row.startTimeMs,
          signal,
        },
      })
        .then((result) => {
          if (result._tag === "Failure") {
            if (isAtomCommandInterrupted(result)) return;
            throw squashAtomCommandFailure(result);
          }
          if (result.value.signaled) return;
          toastManager.add({
            type: "error",
            ...buildResourceTelemetryFailureToast({
              kind: "signal-rejected",
              signal,
              pid: row.pid,
              message: Option.getOrNull(result.value.message),
            }),
          });
        })
        .catch((error: unknown) => {
          toastManager.add({
            type: "error",
            ...buildResourceTelemetryFailureToast({
              kind: "signal-failed",
              signal,
              errorMessage: error instanceof Error ? error.message : null,
            }),
          });
        })
        .finally(() => {
          clearSignaling();
        });
    },
    [signalServerProcess],
  );

  const retryCollector = useCallback(() => {
    setIsRetrying(true);
    void retryTelemetry()
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          ...buildResourceTelemetryFailureToast({
            kind: "retry-failed",
            errorMessage: error instanceof Error ? error.message : null,
          }),
        });
      })
      .finally(() => {
        setIsRetrying(false);
      });
  }, [retryTelemetry]);

  return (
    <>
      <SettingsSection
        title={monitor.title}
        icon={<TelemetryIcon icon={monitor.icon} className="size-4 text-muted-foreground" />}
        headerAction={
          <div className="flex items-center gap-2">
            {monitor.nativeBadge ? <SourceStatusBadge badge={monitor.nativeBadge} /> : null}
            <LastSampleLabel sampledAtIso={monitor.lastSampleAtIso} />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-micro"
                    variant="ghost"
                    disabled={monitor.refresh.disabled}
                    onClick={telemetry.refresh}
                    aria-label={monitor.refresh.ariaLabel}
                  >
                    <RefreshIcon size="xs" refreshing={monitor.refresh.refreshing} />
                  </Button>
                }
              />
              <TooltipPopup side="top">{monitor.refresh.tooltip}</TooltipPopup>
            </Tooltip>
          </div>
        }
      >
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm/5">
          <div className="flex flex-col gap-3 border-b border-border/60 bg-linear-to-r from-muted/45 via-muted/20 to-transparent px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div>
              <div className="text-3xs font-semibold uppercase tracking-widest text-muted-foreground/70">
                {monitor.footprintTitle}
              </div>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
                {monitor.footprintDescription}
              </p>
            </div>
            <div className="flex items-center gap-2 text-3xs text-muted-foreground/65">
              <span className="size-1.5 rounded-full bg-success" />
              {monitor.samplingLabel}
            </div>
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-border/55 md:grid-cols-3">
            {monitor.stats.map((stat) => (
              <IconStat key={stat.id} stat={stat} />
            ))}
          </div>
          {monitor.error ? (
            <div className="flex items-start gap-2 border-t border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-destructive sm:px-5">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>{monitor.error}</span>
            </div>
          ) : null}
          {monitor.aggregates ? (
            <div className="grid border-t border-border/60 bg-muted/10 md:grid-cols-3">
              {monitor.aggregates.map((card) => (
                <AggregateCard key={card.id} card={card} />
              ))}
            </div>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection
        title={host.title}
        icon={<TelemetryIcon icon={host.icon} className="size-4 text-muted-foreground" />}
        headerAction={
          host.retry.visible ? (
            <Button
              size="xs"
              variant="outline"
              disabled={host.retry.disabled}
              onClick={retryCollector}
            >
              <RefreshIcon size="xs" refreshing={host.retry.refreshing} />
              {host.retry.label}
            </Button>
          ) : null
        }
      >
        <div className="grid overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xs/5 md:grid-cols-2 md:divide-x md:divide-border/60">
          <div className="px-4 py-4 sm:px-5">
            <div className="mb-3 flex items-center gap-2 text-3xs font-semibold uppercase tracking-widest text-muted-foreground/70">
              <span className="flex size-6 items-center justify-center rounded-md bg-muted/60">
                <TelemetryIcon icon={host.hostStateIcon} className="size-3.5" />
              </span>
              {host.hostStateTitle}
            </div>
            {host.hostState.kind === "signals" ? (
              <>
                {host.hostState.rows.map((row) => (
                  <DetailRow key={row.id} row={row} />
                ))}
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-5">
                <div className="text-sm font-medium text-foreground">{host.hostState.title}</div>
                <p className="mt-1.5 max-w-sm text-2xs leading-relaxed text-muted-foreground/70">
                  {host.hostState.description}
                </p>
              </div>
            )}
          </div>
          <div className="border-t border-border/60 px-4 py-4 md:border-t-0 sm:px-5">
            <div className="mb-3 flex items-center gap-2 text-3xs font-semibold uppercase tracking-widest text-muted-foreground/70">
              <span className="flex size-6 items-center justify-center rounded-md bg-muted/60">
                <TelemetryIcon icon={host.collectionIcon} className="size-3.5" />
              </span>
              {host.collectionTitle}
            </div>
            {host.collection.kind === "ready" ? (
              <>
                {host.collection.sources.map((source) => (
                  <HealthSource key={source.id} source={source} />
                ))}
                {host.collection.rows.map((row) => (
                  <DetailRow key={row.id} row={row} />
                ))}
              </>
            ) : (
              <div className="py-4 text-xs text-muted-foreground">{host.collection.label}</div>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title={timeline.title}
        icon={<TelemetryIcon icon={timeline.icon} className="size-4 text-muted-foreground" />}
        headerAction={
          <div className="flex items-center gap-2">
            <HistoryWindowSelector selector={timeline.windowSelector} onSelect={selectWindow} />
            <Button
              size="icon-micro"
              variant="ghost"
              disabled={timeline.refresh.disabled}
              onClick={history.refresh}
              aria-label={timeline.refresh.ariaLabel}
            >
              <RefreshIcon size="xs" refreshing={timeline.refresh.refreshing} />
            </Button>
          </div>
        }
      >
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xs/5">
          {timeline.error ? (
            <div className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-3 text-xs text-destructive sm:px-5">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>{timeline.error}</span>
            </div>
          ) : null}
          <ResourceHistoryChart legend={timeline.legend} bars={timeline.bars} />
          <HistoryProcessTable section={timeline} />
        </div>
      </SettingsSection>

      <SettingsSection
        title={processTree.title}
        icon={<TelemetryIcon icon={processTree.icon} className="size-4 text-muted-foreground" />}
        headerAction={
          processTree.identityHint ? (
            <span className="text-3xs text-muted-foreground/55">
              {processTree.identityHint.label}{" "}
              <span className="font-mono">{processTree.identityHint.value}</span>
            </span>
          ) : null
        }
      >
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xs/5">
          <ProcessTable section={processTree} onToggle={toggleProcess} onSignal={signalProcess} />
        </div>
      </SettingsSection>

      <SettingsSection
        title={attribution.title}
        icon={<TelemetryIcon icon={attribution.icon} className="size-4 text-muted-foreground" />}
        headerAction={
          <span className="text-3xs text-muted-foreground/55">{attribution.headerNote}</span>
        }
      >
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xs/5">
          <div className="bg-muted/15 px-4 py-3 text-2xs leading-relaxed text-muted-foreground sm:px-5">
            {attribution.description}
          </div>
          <AttributionTable section={attribution} />
        </div>
      </SettingsSection>
    </>
  );
}
