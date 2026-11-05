import type {
  BackgroundBooleanState,
  ResourceAttributionEntry,
  ResourceTelemetryAggregate,
  ResourceTelemetryHistory,
  ResourceTelemetryHistoryBucket,
  ResourceTelemetryIoSemantics,
  ResourceTelemetryProcess,
  ResourceTelemetryProcessCategory,
  ResourceTelemetryProcessSummary,
  ResourceTelemetrySnapshot,
  ResourceTelemetrySourceHealth,
  ResourceTelemetrySourceStatus,
  ServerProcessSignal,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import { formatRelativeTime } from "../../timestampFormat";

function processIdentityKey(process: ResourceTelemetryProcess): string {
  return `${process.identity.pid}:${process.identity.startTimeMs}`;
}

function processSummaryIdentityKey(process: ResourceTelemetryProcessSummary): string {
  return `${process.identity.pid}:${process.identity.startTimeMs}`;
}

export function visibleResourceTelemetryProcesses(
  processes: ReadonlyArray<ResourceTelemetryProcess>,
  collapsed: ReadonlySet<string>,
): ReadonlyArray<ResourceTelemetryProcess> {
  const childrenByParent = new Map<number, ResourceTelemetryProcess[]>();
  for (const process of processes) {
    const children = childrenByParent.get(process.ppid) ?? [];
    children.push(process);
    childrenByParent.set(process.ppid, children);
  }

  const hidden = new Set<string>();
  const hideDescendants = (pid: number): void => {
    for (const child of childrenByParent.get(pid) ?? []) {
      const key = processIdentityKey(child);
      if (hidden.has(key)) continue;
      hidden.add(key);
      hideDescendants(child.identity.pid);
    }
  };
  for (const process of processes) {
    if (collapsed.has(processIdentityKey(process))) {
      hideDescendants(process.identity.pid);
    }
  }
  return processes.filter((process) => !hidden.has(processIdentityKey(process)));
}

export function shouldShowResourceMonitorRetry(input: {
  readonly nativeStatus: ResourceTelemetrySourceStatus | null;
  readonly error: string | null;
}): boolean {
  return (
    (input.nativeStatus === null && input.error !== null) ||
    input.nativeStatus === "degraded" ||
    input.nativeStatus === "unavailable" ||
    input.nativeStatus === "stopped"
  );
}

export function resourceHistoryBarHeight(input: {
  readonly value: number;
  readonly max: number;
  readonly minimumVisiblePercent: number;
}): number {
  if (input.value <= 0) return 0;
  return Math.max(input.minimumVisiblePercent, (input.value / Math.max(1, input.max)) * 100);
}

export function resourceHistoryCpuScaleMax(
  buckets: ReadonlyArray<{ readonly avgCpuPercent: number }>,
): number {
  return Math.max(1, ...buckets.map((bucket) => bucket.avgCpuPercent));
}

const RESOURCE_HISTORY_WINDOWS = [
  { label: "5m", windowMs: 5 * 60_000, bucketMs: 15_000 },
  { label: "15m", windowMs: 15 * 60_000, bucketMs: 30_000 },
  { label: "30m", windowMs: 30 * 60_000, bucketMs: 60_000 },
  { label: "1h", windowMs: 60 * 60_000, bucketMs: 2 * 60_000 },
] as const;

export const DEFAULT_RESOURCE_HISTORY_WINDOW_MS = 15 * 60_000;

const WAITING_VALUE = "...";
const WRITE_WARNING_BYTES_PER_SECOND = 1_024 * 1_024;
const WRITE_DANGER_BYTES_PER_SECOND = 10 * 1_024 * 1_024;
const SPEED_LIMIT_WARNING_PERCENT = 80;
const MAX_PROCESS_INDENT_DEPTH = 7;
const PROCESS_INDENT_PX = 10;

function formatBytes(value: number): string {
  if (value < 1_024) return `${Math.round(value)} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let next = value;
  let unitIndex = -1;
  do {
    next /= 1_024;
    unitIndex += 1;
  } while (next >= 1_024 && unitIndex < units.length - 1);
  return `${next.toFixed(next >= 100 ? 0 : next >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatRate(value: number): string {
  return `${formatBytes(value)}/s`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatCpuTime(valueMs: number): string {
  const seconds = valueMs / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(minutes >= 10 ? 1 : 2)}m`;
  return `${(minutes / 60).toFixed(2)}h`;
}

function formatDurationMicros(value: number): string {
  if (value < 1_000) return `${Math.round(value)} µs`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(2)} ms`;
  return `${(value / 1_000_000).toFixed(2)} s`;
}

function formatSampleInterval(valueMs: number): string {
  if (valueMs < 1_000) return `${Math.max(0, Math.round(valueMs))} ms`;
  const seconds = valueMs / 1_000;
  return `${seconds.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${
    seconds === 1 ? "second" : "seconds"
  }`;
}

function formatProcessName(process: Pick<ResourceTelemetryProcess, "command" | "name">): string {
  if (process.name.trim()) return process.name;
  const firstToken = process.command.trim().split(/\s+/)[0] ?? process.command;
  const normalized = firstToken.replace(/^['"]|['"]$/g, "");
  return normalized.split(/[\\/]/).findLast((segment) => segment.length > 0) ?? normalized;
}

function categoryLabel(category: ResourceTelemetryProcessCategory): string {
  switch (category) {
    case "server":
      return "Server";
    case "server-child":
      return "Backend child";
    case "provider-root":
      return "Provider";
    case "terminal-root":
      return "Terminal";
    case "electron-main":
      return "Electron main";
    case "electron-renderer":
      return "Renderer";
    case "electron-gpu":
      return "GPU";
    case "electron-utility":
      return "Electron utility";
    case "resource-monitor":
      return "Monitor";
    case "unknown-t3":
      return "T3 process";
  }
}

export type ResourceProcessCategoryDot = "warning" | "info" | "violet" | "success";

function categoryDot(category: ResourceTelemetryProcessCategory): ResourceProcessCategoryDot {
  if (category === "resource-monitor") return "warning";
  if (category.startsWith("electron-")) return "info";
  if (category === "server") return "violet";
  return "success";
}

function ioSemanticsLabel(semantics: ResourceTelemetryIoSemantics): string {
  switch (semantics) {
    case "storage":
      return "Storage bytes";
    case "logical":
      return "Logical bytes";
    case "all-io":
      return "All I/O bytes";
    case "unavailable":
      return "Unavailable";
  }
}

function booleanStateLabel(
  value: BackgroundBooleanState,
  labels: { readonly true: string; readonly false: string },
): string {
  if (value === "true") return labels.true;
  if (value === "false") return labels.false;
  return "Unknown";
}

function canSignalProcess(process: ResourceTelemetryProcess): boolean {
  return (
    process.category === "server-child" ||
    process.category === "provider-root" ||
    process.category === "terminal-root"
  );
}

export type ResourceTelemetryIcon =
  | "activity"
  | "battery"
  | "cpu"
  | "database"
  | "gauge"
  | "hard-drive"
  | "memory-stick";

export type ResourceTelemetryTone = "default" | "warning" | "danger";

export type ResourceSourceStatusBadgeTone = "neutral" | ResourceTelemetryTone;

export type ResourceSourceStatusBadgeModel = {
  readonly prefix: string;
  readonly status: ResourceTelemetrySourceStatus;
  readonly text: string;
  readonly tone: ResourceSourceStatusBadgeTone;
};

function sourceStatusTone(status: ResourceTelemetrySourceStatus): ResourceTelemetryTone {
  if (status === "healthy") return "default";
  if (status === "starting" || status === "degraded") return "warning";
  return "danger";
}

function sourceStatusBadge(
  prefix: string,
  status: ResourceTelemetrySourceStatus,
): ResourceSourceStatusBadgeModel {
  return { prefix, status, text: status, tone: sourceStatusTone(status) };
}

export type ResourceLastSampleInput = {
  readonly sampledAtIso: string | null;
  readonly nowMs: number;
};

export type ResourceLastSampleModel =
  | { readonly kind: "waiting"; readonly label: string }
  | {
      readonly kind: "relative";
      readonly prefix: string;
      readonly value: string;
      readonly suffix: string | null;
    };

export function buildResourceLastSampleModel(
  input: ResourceLastSampleInput,
): ResourceLastSampleModel {
  const waiting: ResourceLastSampleModel = { kind: "waiting", label: "Waiting for sample" };
  if (input.sampledAtIso === null) return waiting;
  const relative = formatRelativeTime(input.sampledAtIso, input.nowMs);
  if (!relative) return waiting;
  return { kind: "relative", prefix: "Updated", value: relative.value, suffix: relative.suffix };
}

export type ResourceHistoryQuery = {
  readonly windowMs: number;
  readonly bucketMs: number;
};

export function resolveResourceHistoryQuery(selectedWindowMs: number): ResourceHistoryQuery {
  const selected =
    RESOURCE_HISTORY_WINDOWS.find((option) => option.windowMs === selectedWindowMs) ??
    RESOURCE_HISTORY_WINDOWS[1];
  return { windowMs: selected.windowMs, bucketMs: selected.bucketMs };
}

export type ResourceTelemetryModelInput = {
  readonly snapshot: ResourceTelemetrySnapshot | null;
  readonly snapshotError: string | null;
  readonly snapshotPending: boolean;
  readonly history: ResourceTelemetryHistory | null;
  readonly historyError: string | null;
  readonly historyPending: boolean;
  readonly selectedWindowMs: number;
  readonly collapsedProcessKeys: ReadonlyArray<string>;
  readonly signalingProcessKeys: ReadonlyArray<string>;
  readonly isRetrying: boolean;
};

export type ResourceRefreshControlModel = {
  readonly disabled: boolean;
  readonly refreshing: boolean;
  readonly ariaLabel: string;
  readonly tooltip: string | null;
};

export type ResourceTelemetryStatId =
  | "cpu"
  | "memory"
  | "process-count"
  | "read-throughput"
  | "write-throughput"
  | "speed-limit";

export type ResourceTelemetryStatModel = {
  readonly id: ResourceTelemetryStatId;
  readonly icon: ResourceTelemetryIcon;
  readonly label: string;
  readonly value: string;
  readonly detail: string | null;
  readonly tone: ResourceTelemetryTone;
};

export type ResourceMetricPairModel = {
  readonly id: "cpu" | "memory" | "read" | "write";
  readonly label: string;
  readonly value: string;
};

export type ResourceAggregateAccent = "success" | "info" | "warning";

export type ResourceAggregateCardModel = {
  readonly id: "backend" | "electron" | "monitor";
  readonly label: string;
  readonly accent: ResourceAggregateAccent;
  readonly processCountLabel: string;
  readonly metrics: ReadonlyArray<ResourceMetricPairModel>;
};

export type ResourceMonitorSectionModel = {
  readonly title: string;
  readonly icon: ResourceTelemetryIcon;
  readonly nativeBadge: ResourceSourceStatusBadgeModel | null;
  readonly lastSampleAtIso: string | null;
  readonly refresh: ResourceRefreshControlModel;
  readonly footprintTitle: string;
  readonly footprintDescription: string;
  readonly samplingLabel: string;
  readonly stats: ReadonlyArray<ResourceTelemetryStatModel>;
  readonly error: string | null;
  readonly aggregates: ReadonlyArray<ResourceAggregateCardModel> | null;
};

export type ResourceDetailRowModel = {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly tone: ResourceTelemetryTone;
};

export type ResourceHealthSourceModel = {
  readonly id: "native" | "desktop";
  readonly label: string;
  readonly description: string;
  readonly badge: ResourceSourceStatusBadgeModel;
};

export type ResourceHostStateContentModel =
  | { readonly kind: "signals"; readonly rows: ReadonlyArray<ResourceDetailRowModel> }
  | { readonly kind: "disconnected"; readonly title: string; readonly description: string };

export type ResourceCollectionHealthContentModel =
  | {
      readonly kind: "ready";
      readonly sources: ReadonlyArray<ResourceHealthSourceModel>;
      readonly rows: ReadonlyArray<ResourceDetailRowModel>;
    }
  | { readonly kind: "waiting"; readonly label: string };

export type ResourceRetryControlModel = {
  readonly visible: boolean;
  readonly disabled: boolean;
  readonly refreshing: boolean;
  readonly label: string;
};

export type ResourceHostSectionModel = {
  readonly title: string;
  readonly icon: ResourceTelemetryIcon;
  readonly retry: ResourceRetryControlModel;
  readonly hostStateTitle: string;
  readonly hostStateIcon: ResourceTelemetryIcon;
  readonly hostState: ResourceHostStateContentModel;
  readonly collectionTitle: string;
  readonly collectionIcon: ResourceTelemetryIcon;
  readonly collection: ResourceCollectionHealthContentModel;
};

export type ResourceHistoryWindowOptionModel = {
  readonly value: string;
  readonly label: string;
  readonly windowMs: number;
};

export type ResourceHistoryWindowSelectorModel = {
  readonly ariaLabel: string;
  readonly value: string;
  readonly options: ReadonlyArray<ResourceHistoryWindowOptionModel>;
};

export type ResourceHistoryLegendItemModel = {
  readonly id: "cpu" | "read" | "write";
  readonly label: string;
};

export type ResourceHistoryBarModel = {
  readonly id: string;
  readonly avgCpuPercent: number;
  readonly maxCpuPercent: number;
  readonly ioReadBytes: number;
  readonly ioWriteBytes: number;
  readonly cpuHeightPercent: number;
  readonly readHeightPercent: number;
  readonly writeHeightPercent: number;
  readonly tooltipLines: ReadonlyArray<string>;
};

export type ResourceTableColumnModel<Id extends string> = {
  readonly id: Id;
  readonly label: string;
  readonly align: "left" | "right";
};

export type ResourceHistoryProcessColumnId =
  | "process"
  | "category"
  | "cpu-time"
  | "peak-cpu"
  | "peak-memory"
  | "read"
  | "write"
  | "samples"
  | "pid";

export type ResourceHistoryProcessRowModel = {
  readonly id: string;
  readonly pid: number;
  readonly name: string;
  readonly commandTooltip: string;
  readonly categoryLabel: string;
  readonly cpuTime: string;
  readonly peakCpu: string;
  readonly peakMemory: string;
  readonly read: string;
  readonly write: string;
  readonly sampleCount: number;
};

export type ResourceTimelineSectionModel = {
  readonly title: string;
  readonly icon: ResourceTelemetryIcon;
  readonly windowSelector: ResourceHistoryWindowSelectorModel;
  readonly refresh: ResourceRefreshControlModel;
  readonly error: string | null;
  readonly legend: ReadonlyArray<ResourceHistoryLegendItemModel>;
  readonly bars: ReadonlyArray<ResourceHistoryBarModel>;
  readonly processColumns: ReadonlyArray<ResourceTableColumnModel<ResourceHistoryProcessColumnId>>;
  readonly processEmptyLabel: string | null;
  readonly processRows: ReadonlyArray<ResourceHistoryProcessRowModel>;
};

export type ResourceLiveProcessColumnId =
  | "process"
  | "category"
  | "cpu"
  | "cpu-time"
  | "memory"
  | "read-rate"
  | "write-rate"
  | "read-total"
  | "write-total"
  | "pid"
  | "kill";

export type ResourceProcessSignalModel = {
  readonly available: boolean;
  readonly disabled: boolean;
};

export type ResourceLiveProcessRowModel = {
  readonly id: string;
  readonly pid: number;
  readonly startTimeMs: number;
  readonly name: string;
  readonly commandTooltip: string;
  readonly indentPx: number;
  readonly hasChildren: boolean;
  readonly collapsed: boolean;
  readonly toggleLabel: string;
  readonly categoryLabel: string;
  readonly categoryDot: ResourceProcessCategoryDot;
  readonly cpu: string;
  readonly cpuTime: string;
  readonly memory: string;
  readonly readRate: string;
  readonly writeRate: string;
  readonly readTotal: string;
  readonly writeTotal: string;
  readonly ioSemanticsLabel: string;
  readonly signal: ResourceProcessSignalModel;
};

export type ResourceIdentityHintModel = {
  readonly label: string;
  readonly value: string;
};

export type ResourceProcessTreeSectionModel = {
  readonly title: string;
  readonly icon: ResourceTelemetryIcon;
  readonly identityHint: ResourceIdentityHintModel | null;
  readonly columns: ReadonlyArray<ResourceTableColumnModel<ResourceLiveProcessColumnId>>;
  readonly emptyLabel: string | null;
  readonly rows: ReadonlyArray<ResourceLiveProcessRowModel>;
};

export type ResourceAttributionColumnId =
  | "component"
  | "operation"
  | "logical-read"
  | "logical-write"
  | "count"
  | "time";

export type ResourceAttributionRowModel = {
  readonly id: string;
  readonly component: string;
  readonly operation: string;
  readonly logicalRead: string;
  readonly logicalWrite: string;
  readonly count: number;
  readonly duration: string;
};

export type ResourceAttributionSectionModel = {
  readonly title: string;
  readonly icon: ResourceTelemetryIcon;
  readonly headerNote: string;
  readonly description: string;
  readonly columns: ReadonlyArray<ResourceTableColumnModel<ResourceAttributionColumnId>>;
  readonly emptyLabel: string | null;
  readonly rows: ReadonlyArray<ResourceAttributionRowModel>;
};

export type ResourceTelemetryModel = {
  readonly monitor: ResourceMonitorSectionModel;
  readonly host: ResourceHostSectionModel;
  readonly timeline: ResourceTimelineSectionModel;
  readonly processTree: ResourceProcessTreeSectionModel;
  readonly attribution: ResourceAttributionSectionModel;
};

const LIVE_PROCESS_COLUMNS: ReadonlyArray<ResourceTableColumnModel<ResourceLiveProcessColumnId>> = [
  { id: "process", label: "Process", align: "left" },
  { id: "category", label: "Category", align: "left" },
  { id: "cpu", label: "CPU", align: "right" },
  { id: "cpu-time", label: "CPU Time", align: "right" },
  { id: "memory", label: "Memory", align: "right" },
  { id: "read-rate", label: "Read/s", align: "right" },
  { id: "write-rate", label: "Write/s", align: "right" },
  { id: "read-total", label: "Read Total", align: "right" },
  { id: "write-total", label: "Write Total", align: "right" },
  { id: "pid", label: "PID", align: "right" },
  { id: "kill", label: "Kill", align: "right" },
];

const HISTORY_PROCESS_COLUMNS: ReadonlyArray<
  ResourceTableColumnModel<ResourceHistoryProcessColumnId>
> = [
  { id: "process", label: "Process", align: "left" },
  { id: "category", label: "Category", align: "left" },
  { id: "cpu-time", label: "CPU Time", align: "right" },
  { id: "peak-cpu", label: "Peak CPU", align: "right" },
  { id: "peak-memory", label: "Peak Mem", align: "right" },
  { id: "read", label: "Read", align: "right" },
  { id: "write", label: "Write", align: "right" },
  { id: "samples", label: "Samples", align: "right" },
  { id: "pid", label: "PID", align: "right" },
];

const ATTRIBUTION_COLUMNS: ReadonlyArray<ResourceTableColumnModel<ResourceAttributionColumnId>> = [
  { id: "component", label: "Component", align: "left" },
  { id: "operation", label: "Operation", align: "left" },
  { id: "logical-read", label: "Logical Read", align: "right" },
  { id: "logical-write", label: "Logical Write", align: "right" },
  { id: "count", label: "Count", align: "right" },
  { id: "time", label: "Time", align: "right" },
];

const HISTORY_LEGEND: ReadonlyArray<ResourceHistoryLegendItemModel> = [
  { id: "cpu", label: "CPU average" },
  { id: "read", label: "I/O reads" },
  { id: "write", label: "I/O writes" },
];

function writeThroughputTone(aggregate: ResourceTelemetryAggregate | null): ResourceTelemetryTone {
  if (aggregate && aggregate.ioWriteBytesPerSecond >= WRITE_DANGER_BYTES_PER_SECOND) {
    return "danger";
  }
  if (aggregate && aggregate.ioWriteBytesPerSecond >= WRITE_WARNING_BYTES_PER_SECOND) {
    return "warning";
  }
  return "default";
}

function buildStats(
  snapshot: ResourceTelemetrySnapshot | null,
): ReadonlyArray<ResourceTelemetryStatModel> {
  const allT3 = snapshot?.groups.allT3 ?? null;
  const speedLimit = snapshot ? Option.getOrNull(snapshot.speedLimitPercent) : null;
  return [
    {
      id: "cpu",
      icon: "cpu",
      label: "Current CPU",
      value: allT3 ? formatPercent(allT3.currentCpuPercent) : WAITING_VALUE,
      detail: allT3 ? `${formatCpuTime(allT3.cpuTimeMs)} observed CPU time` : null,
      tone: "default",
    },
    {
      id: "memory",
      icon: "memory-stick",
      label: "Resident memory",
      value: allT3 ? formatBytes(allT3.currentRssBytes) : WAITING_VALUE,
      detail: allT3 ? `${formatBytes(allT3.peakRssBytes)} combined process peaks` : null,
      tone: "default",
    },
    {
      id: "process-count",
      icon: "activity",
      label: "Process count",
      value: allT3 ? String(allT3.processCount) : WAITING_VALUE,
      detail: allT3 ? `${allT3.processStarts} starts · ${allT3.processExits} exits` : null,
      tone: "default",
    },
    {
      id: "read-throughput",
      icon: "hard-drive",
      label: "Read throughput",
      value: allT3 ? formatRate(allT3.ioReadBytesPerSecond) : WAITING_VALUE,
      detail: allT3 ? `${formatBytes(allT3.ioReadBytes)} observed` : null,
      tone: "default",
    },
    {
      id: "write-throughput",
      icon: "database",
      label: "Write throughput",
      value: allT3 ? formatRate(allT3.ioWriteBytesPerSecond) : WAITING_VALUE,
      detail: allT3 ? `${formatBytes(allT3.ioWriteBytes)} observed` : null,
      tone: writeThroughputTone(allT3),
    },
    {
      id: "speed-limit",
      icon: "gauge",
      label: "CPU speed limit",
      value: snapshot
        ? speedLimit === null
          ? "Unknown"
          : `${speedLimit.toFixed(0)}%`
        : WAITING_VALUE,
      detail: snapshot ? `${snapshot.power.thermalState} thermal state` : null,
      tone: speedLimit !== null && speedLimit < SPEED_LIMIT_WARNING_PERCENT ? "warning" : "default",
    },
  ];
}

function buildAggregateCard(
  id: ResourceAggregateCardModel["id"],
  label: string,
  accent: ResourceAggregateAccent,
  aggregate: ResourceTelemetryAggregate,
): ResourceAggregateCardModel {
  return {
    id,
    label,
    accent,
    processCountLabel: `${aggregate.processCount} ${
      aggregate.processCount === 1 ? "process" : "processes"
    }`,
    metrics: [
      { id: "cpu", label: "CPU", value: formatPercent(aggregate.currentCpuPercent) },
      { id: "memory", label: "Memory", value: formatBytes(aggregate.currentRssBytes) },
      { id: "read", label: "Read", value: formatRate(aggregate.ioReadBytesPerSecond) },
      { id: "write", label: "Write", value: formatRate(aggregate.ioWriteBytesPerSecond) },
    ],
  };
}

function buildMonitorSection(input: ResourceTelemetryModelInput): ResourceMonitorSectionModel {
  const { snapshot } = input;
  return {
    title: "Resource monitor",
    icon: "activity",
    nativeBadge: snapshot ? sourceStatusBadge("Native", snapshot.health.native.status) : null,
    lastSampleAtIso: snapshot ? DateTime.formatIso(snapshot.readAt) : null,
    refresh: {
      disabled: input.snapshotPending,
      refreshing: input.snapshotPending,
      ariaLabel: "Refresh resource telemetry",
      tooltip: "Refresh telemetry snapshot",
    },
    footprintTitle: "T3 system footprint",
    footprintDescription:
      "Live native counters for the server, providers, terminals, desktop processes, and the monitor itself.",
    samplingLabel: `Sampling every ${
      snapshot ? formatSampleInterval(snapshot.sampleIntervalMs) : WAITING_VALUE
    }`,
    stats: buildStats(snapshot),
    error: input.snapshotError,
    aggregates: snapshot
      ? [
          buildAggregateCard("backend", "Backend + agents", "success", snapshot.groups.backend),
          buildAggregateCard("electron", "Desktop", "info", snapshot.groups.electron),
          buildAggregateCard("monitor", "Monitor overhead", "warning", snapshot.groups.monitor),
        ]
      : null,
  };
}

function hasHostPowerSignal(snapshot: ResourceTelemetrySnapshot): boolean {
  return (
    snapshot.power.onBattery !== "unknown" ||
    snapshot.power.lowPowerMode !== "unknown" ||
    snapshot.power.idle !== "unknown" ||
    snapshot.power.locked !== "unknown" ||
    snapshot.power.thermalState !== "unknown"
  );
}

function buildHostState(snapshot: ResourceTelemetrySnapshot | null): ResourceHostStateContentModel {
  if (snapshot === null || !hasHostPowerSignal(snapshot)) {
    return {
      kind: "disconnected",
      title: "Desktop host signals not connected",
      description:
        "Power, idle, lock, and thermal state are supplied by the desktop host. Process telemetry remains fully active in this browser session.",
    };
  }
  const { power } = snapshot;
  return {
    kind: "signals",
    rows: [
      {
        id: "power-source",
        label: "Power source",
        value: booleanStateLabel(power.onBattery, { true: "Battery", false: "External power" }),
        tone: "default",
      },
      {
        id: "low-power-mode",
        label: "Low power mode",
        value: booleanStateLabel(power.lowPowerMode, { true: "Enabled", false: "Disabled" }),
        tone: "default",
      },
      {
        id: "idle",
        label: "Idle",
        value: `${booleanStateLabel(power.idle, { true: "Idle", false: "Active" })}${
          power.idleSeconds === null ? "" : ` · ${Math.round(power.idleSeconds)}s`
        }`,
        tone: "default",
      },
      {
        id: "session",
        label: "Session",
        value: power.suspended
          ? "Suspended"
          : booleanStateLabel(power.locked, { true: "Locked", false: "Unlocked" }),
        tone: "default",
      },
      {
        id: "thermal",
        label: "Thermal",
        value: power.thermalState,
        tone:
          power.thermalState === "serious" || power.thermalState === "critical"
            ? "danger"
            : "default",
      },
    ],
  };
}

function buildHealthSource(
  id: ResourceHealthSourceModel["id"],
  label: string,
  health: ResourceTelemetrySourceHealth,
): ResourceHealthSourceModel {
  const expectedInBrowser =
    health.status === "unavailable" &&
    Option.exists(health.lastError, (error) => error.includes("'web' mode"));
  return {
    id,
    label,
    description: expectedInBrowser
      ? "Available when this page runs inside the desktop app."
      : Option.getOrElse(health.lastError, () => "No reported errors"),
    badge: expectedInBrowser
      ? { prefix: "", status: health.status, text: "Desktop only", tone: "neutral" }
      : sourceStatusBadge("", health.status),
  };
}

function buildCollectionHealth(
  snapshot: ResourceTelemetrySnapshot | null,
): ResourceCollectionHealthContentModel {
  if (snapshot === null) {
    return { kind: "waiting", label: "Waiting for collector health." };
  }
  const { health } = snapshot;
  return {
    kind: "ready",
    sources: [
      buildHealthSource("native", "Native process monitor", health.native),
      buildHealthSource("desktop", "Electron main process", health.desktop),
    ],
    rows: [
      {
        id: "collection-time",
        label: "Collection time",
        value: formatDurationMicros(health.collectionDurationMicros),
        tone: "default",
      },
      {
        id: "process-scan",
        label: "Process scan",
        value: `${health.retainedProcessCount}/${health.scannedProcessCount} retained`,
        tone: "default",
      },
      {
        id: "inaccessible",
        label: "Inaccessible",
        value: String(health.inaccessibleProcessCount),
        tone: health.inaccessibleProcessCount > 0 ? "warning" : "default",
      },
      {
        id: "sidecar",
        label: "Sidecar",
        value: Option.match(health.sidecarVersion, {
          onNone: () => "Unavailable",
          onSome: (version) =>
            `${version}${Option.match(health.sidecarPid, {
              onNone: () => "",
              onSome: (pid) => ` · PID ${pid}`,
            })}`,
        }),
        tone: "default",
      },
      {
        id: "restarts",
        label: "Restarts",
        value: String(health.restartCount),
        tone: "default",
      },
    ],
  };
}

function buildHostSection(input: ResourceTelemetryModelInput): ResourceHostSectionModel {
  return {
    title: "Host & collection",
    icon: "gauge",
    retry: {
      visible: shouldShowResourceMonitorRetry({
        nativeStatus: input.snapshot?.health.native.status ?? null,
        error: input.snapshotError,
      }),
      disabled: input.isRetrying,
      refreshing: input.isRetrying,
      label: "Retry monitor",
    },
    hostStateTitle: "Host state",
    hostStateIcon: "battery",
    hostState: buildHostState(input.snapshot),
    collectionTitle: "Collection health",
    collectionIcon: "gauge",
    collection: buildCollectionHealth(input.snapshot),
  };
}

function buildHistoryBars(
  buckets: ReadonlyArray<ResourceTelemetryHistoryBucket>,
): ReadonlyArray<ResourceHistoryBarModel> {
  const maxCpu = resourceHistoryCpuScaleMax(buckets);
  const maxIo = Math.max(1, ...buckets.map((bucket) => bucket.ioReadBytes + bucket.ioWriteBytes));
  return buckets.map((bucket) => ({
    id: DateTime.formatIso(bucket.startedAt),
    avgCpuPercent: bucket.avgCpuPercent,
    maxCpuPercent: bucket.maxCpuPercent,
    ioReadBytes: bucket.ioReadBytes,
    ioWriteBytes: bucket.ioWriteBytes,
    cpuHeightPercent: resourceHistoryBarHeight({
      value: bucket.avgCpuPercent,
      max: maxCpu,
      minimumVisiblePercent: 2,
    }),
    readHeightPercent: resourceHistoryBarHeight({
      value: bucket.ioReadBytes,
      max: maxIo,
      minimumVisiblePercent: 1,
    }),
    writeHeightPercent: resourceHistoryBarHeight({
      value: bucket.ioWriteBytes,
      max: maxIo,
      minimumVisiblePercent: 1,
    }),
    tooltipLines: [
      `CPU avg ${formatPercent(bucket.avgCpuPercent)}`,
      `CPU peak ${formatPercent(bucket.maxCpuPercent)}`,
      `Read ${formatBytes(bucket.ioReadBytes)}`,
      `Write ${formatBytes(bucket.ioWriteBytes)}`,
    ],
  }));
}

function buildHistoryProcessRow(
  process: ResourceTelemetryProcessSummary,
): ResourceHistoryProcessRowModel {
  return {
    id: processSummaryIdentityKey(process),
    pid: process.identity.pid,
    name: process.name || process.command,
    commandTooltip: process.command || process.name,
    categoryLabel: categoryLabel(process.category),
    cpuTime: formatCpuTime(process.cpuTimeMs),
    peakCpu: formatPercent(process.maxCpuPercent),
    peakMemory: formatBytes(process.peakRssBytes),
    read: formatBytes(process.ioReadBytes),
    write: formatBytes(process.ioWriteBytes),
    sampleCount: process.sampleCount,
  };
}

function buildTimelineSection(input: ResourceTelemetryModelInput): ResourceTimelineSectionModel {
  const topProcesses = input.history?.topProcesses ?? [];
  return {
    title: "Resource timeline",
    icon: "hard-drive",
    windowSelector: {
      ariaLabel: "Resource history period",
      value: String(input.selectedWindowMs),
      options: RESOURCE_HISTORY_WINDOWS.map((option) => ({
        value: String(option.windowMs),
        label: option.label,
        windowMs: option.windowMs,
      })),
    },
    refresh: {
      disabled: input.historyPending,
      refreshing: input.historyPending,
      ariaLabel: "Refresh resource history",
      tooltip: null,
    },
    error: input.historyError,
    legend: HISTORY_LEGEND,
    bars: buildHistoryBars(input.history?.buckets ?? []),
    processColumns: HISTORY_PROCESS_COLUMNS,
    processEmptyLabel:
      topProcesses.length === 0 ? "No retained process samples in this window." : null,
    processRows: topProcesses.map(buildHistoryProcessRow),
  };
}

function buildLiveProcessRow(
  process: ResourceTelemetryProcess,
  collapsedKeys: ReadonlySet<string>,
  signalingKeys: ReadonlySet<string>,
): ResourceLiveProcessRowModel {
  const id = processIdentityKey(process);
  const name = formatProcessName(process);
  const collapsed = collapsedKeys.has(id);
  const available = canSignalProcess(process);
  return {
    id,
    pid: process.identity.pid,
    startTimeMs: process.identity.startTimeMs,
    name,
    commandTooltip: process.command || process.name,
    indentPx: Math.min(process.depth, MAX_PROCESS_INDENT_DEPTH) * PROCESS_INDENT_PX,
    hasChildren: process.childPids.length > 0,
    collapsed,
    toggleLabel: collapsed ? `Expand ${name}` : `Collapse ${name}`,
    categoryLabel: categoryLabel(process.category),
    categoryDot: categoryDot(process.category),
    cpu: formatPercent(process.cpuPercent),
    cpuTime: formatCpuTime(process.cpuTimeMs),
    memory: formatBytes(process.residentBytes),
    readRate: formatRate(process.ioReadBytesPerSecond),
    writeRate: formatRate(process.ioWriteBytesPerSecond),
    readTotal: formatBytes(process.ioReadBytes),
    writeTotal: formatBytes(process.ioWriteBytes),
    ioSemanticsLabel: ioSemanticsLabel(process.ioSemantics),
    signal: { available, disabled: available && signalingKeys.has(id) },
  };
}

function buildProcessTreeSection(
  input: ResourceTelemetryModelInput,
): ResourceProcessTreeSectionModel {
  const collapsedKeys = new Set(input.collapsedProcessKeys);
  const signalingKeys = new Set(input.signalingProcessKeys);
  const visible = visibleResourceTelemetryProcesses(input.snapshot?.processes ?? [], collapsedKeys);
  return {
    title: "Live process tree",
    icon: "cpu",
    identityHint: input.snapshot ? { label: "Identity:", value: "PID + start time" } : null,
    columns: LIVE_PROCESS_COLUMNS,
    emptyLabel: visible.length === 0 ? "Waiting for the native process monitor." : null,
    rows: visible.map((process) => buildLiveProcessRow(process, collapsedKeys, signalingKeys)),
  };
}

function buildAttributionRow(entry: ResourceAttributionEntry): ResourceAttributionRowModel {
  return {
    id: `${entry.component}:${entry.operation}`,
    component: entry.component,
    operation: entry.operation,
    logicalRead: formatBytes(entry.logicalReadBytes),
    logicalWrite: formatBytes(entry.logicalWriteBytes),
    count: entry.count,
    duration: `${(entry.durationMs / 1_000).toFixed(2)}s`,
  };
}

function buildAttributionSection(
  input: ResourceTelemetryModelInput,
): ResourceAttributionSectionModel {
  const entries = input.snapshot?.attribution.entries ?? [];
  return {
    title: "Instrumented application I/O",
    icon: "database",
    headerNote: "Logical bytes by operation",
    description:
      "Native counters identify which process is reading or writing. These application-level counters identify known T3 operations so process spikes can be correlated with specific persistence and logging paths.",
    columns: ATTRIBUTION_COLUMNS,
    emptyLabel:
      entries.length === 0 ? "No instrumented application I/O has been recorded yet." : null,
    rows: entries.map(buildAttributionRow),
  };
}

export function buildResourceTelemetryModel(
  input: ResourceTelemetryModelInput,
): ResourceTelemetryModel {
  return {
    monitor: buildMonitorSection(input),
    host: buildHostSection(input),
    timeline: buildTimelineSection(input),
    processTree: buildProcessTreeSection(input),
    attribution: buildAttributionSection(input),
  };
}

export type ResourceTelemetryIntent =
  | { readonly kind: "select-window"; readonly value: string | null }
  | {
      readonly kind: "toggle-process";
      readonly processKey: string;
      readonly collapsedProcessKeys: ReadonlyArray<string>;
    }
  | {
      readonly kind: "signal-process";
      readonly processKey: string;
      readonly pid: number;
      readonly signal: ServerProcessSignal;
      readonly signalingProcessKeys: ReadonlyArray<string>;
      readonly hasEnvironment: boolean;
    };

export type ResourceTelemetryChange =
  | { readonly kind: "none" }
  | { readonly kind: "set-window"; readonly windowMs: number }
  | { readonly kind: "set-collapsed"; readonly collapsedProcessKeys: ReadonlyArray<string> }
  | { readonly kind: "send-signal"; readonly confirmMessage: string | null };

export function resolveResourceTelemetryChange(
  intent: ResourceTelemetryIntent,
): ResourceTelemetryChange {
  switch (intent.kind) {
    case "select-window": {
      const selected = RESOURCE_HISTORY_WINDOWS.find(
        (option) => String(option.windowMs) === intent.value,
      );
      return selected ? { kind: "set-window", windowMs: selected.windowMs } : { kind: "none" };
    }
    case "toggle-process": {
      const collapsed = intent.collapsedProcessKeys.includes(intent.processKey);
      return {
        kind: "set-collapsed",
        collapsedProcessKeys: collapsed
          ? intent.collapsedProcessKeys.filter((key) => key !== intent.processKey)
          : [...intent.collapsedProcessKeys, intent.processKey],
      };
    }
    case "signal-process": {
      if (!intent.hasEnvironment) return { kind: "none" };
      if (intent.signalingProcessKeys.includes(intent.processKey)) return { kind: "none" };
      return {
        kind: "send-signal",
        confirmMessage:
          intent.signal === "SIGKILL"
            ? `Send SIGKILL to process ${intent.pid}? This cannot be handled by the process.`
            : null,
      };
    }
  }
}

export type ResourceTelemetryFailure =
  | {
      readonly kind: "confirm-failed";
      readonly signal: ServerProcessSignal;
      readonly errorMessage: string | null;
    }
  | {
      readonly kind: "signal-rejected";
      readonly signal: ServerProcessSignal;
      readonly pid: number;
      readonly message: string | null;
    }
  | {
      readonly kind: "signal-failed";
      readonly signal: ServerProcessSignal;
      readonly errorMessage: string | null;
    }
  | { readonly kind: "retry-failed"; readonly errorMessage: string | null };

export type ResourceTelemetryToastModel = {
  readonly title: string;
  readonly description: string;
};

export function buildResourceTelemetryFailureToast(
  failure: ResourceTelemetryFailure,
): ResourceTelemetryToastModel {
  switch (failure.kind) {
    case "confirm-failed":
      return {
        title: "Could not confirm signal",
        description: failure.errorMessage ?? `Failed to send ${failure.signal}.`,
      };
    case "signal-rejected":
      return {
        title: `Could not send ${failure.signal}`,
        description:
          failure.message ?? `Failed to send ${failure.signal} to process ${failure.pid}.`,
      };
    case "signal-failed":
      return {
        title: `Could not send ${failure.signal}`,
        description: failure.errorMessage ?? `Failed to send ${failure.signal}.`,
      };
    case "retry-failed":
      return {
        title: "Could not restart resource monitor",
        description: failure.errorMessage ?? "The resource monitor retry failed.",
      };
  }
}
