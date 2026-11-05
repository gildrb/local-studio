import type {
  EditorId,
  EnvironmentId,
  ServerProcessDiagnosticsEntry,
  ServerProcessDiagnosticsResult,
  ServerProcessResourceHistoryInput,
  ServerProcessResourceHistoryResult,
  ServerProcessSignal,
  ServerTraceDiagnosticsResult,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import { formatRelativeTimeLabel, getRelativeTimeState } from "../../timestampFormat";
import {
  buildExpandableTextModel,
  DEFAULT_EXPANDABLE_TEXT_EXPAND_LABEL,
  type ExpandableTextModel,
} from "./ExpandableText.logic";
import {
  buildProcessSignalActionsModel,
  type ProcessSignalActionsModel,
} from "./ProcessSignalActions.logic";

export const DEFAULT_RESOURCE_HISTORY_WINDOW_MS = 15 * 60_000;
export const TRACE_ID_COPY_TARGET = "trace ID";
export const TRACE_ID_COPY_TIMEOUT_MS = 1_200;

const RESOURCE_HISTORY_WINDOWS = [
  { label: "5m", windowMs: 5 * 60_000, bucketMs: 30_000 },
  { label: "15m", windowMs: 15 * 60_000, bucketMs: 60_000 },
  { label: "30m", windowMs: 30 * 60_000, bucketMs: 2 * 60_000 },
  { label: "1h", windowMs: 60 * 60_000, bucketMs: 5 * 60_000 },
] as const;

const DEFAULT_RESOURCE_HISTORY_WINDOW = RESOURCE_HISTORY_WINDOWS[1];

const NUMBER_FORMAT = new Intl.NumberFormat();

const PLACEHOLDER_VALUE = "...";

function formatCount(value: number): string {
  return NUMBER_FORMAT.format(value);
}

function formatDuration(value: number): string {
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)} s`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"] as const;
  let unitIndex = -1;
  let next = value;
  do {
    next /= 1024;
    unitIndex += 1;
  } while (next >= 1024 && unitIndex < units.length - 1);
  return `${next.toFixed(next >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatCpuTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(minutes >= 10 ? 1 : 2)}m`;
  return `${(minutes / 60).toFixed(2)}h`;
}

function formatRelative(value: DateTime.Utc, nowMs: number): string {
  return formatRelativeTimeLabel(DateTime.formatIso(value), nowMs);
}

function formatProcessName(command: string): string {
  const firstToken = command.trim().split(/\s+/)[0];
  if (!firstToken) return command;
  const normalized = firstToken.replace(/^['"]|['"]$/g, "");
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? normalized;
}

function formatShortProcessName(command: string): string {
  const name = formatProcessName(command);
  return name.length > 42 ? `${name.slice(0, 39)}...` : name;
}

function formatProcessType(process: ServerProcessDiagnosticsEntry): string {
  if (process.depth > 0) return "Subprocess";
  if (/\b(codex|claude|opencode|cursor)\b/i.test(process.command)) return "Agent";
  return "Process";
}

export type DiagnosticsQueryState<A> = {
  readonly data: A | null;
  readonly error: string | null;
  readonly isPending: boolean;
};

export type DiagnosticsSettingsModelInput = {
  readonly nowMs: number;
  readonly processes: DiagnosticsQueryState<ServerProcessDiagnosticsResult>;
  readonly resources: DiagnosticsQueryState<ServerProcessResourceHistoryResult>;
  readonly trace: DiagnosticsQueryState<ServerTraceDiagnosticsResult>;
  readonly resourceWindowMs: number;
  readonly collapsedPids: ReadonlyArray<number>;
  readonly signalingPid: number | null;
  readonly logsDirectoryPath: string | null;
  readonly isOpeningLogsDirectory: boolean;
  readonly openLogsDirectoryError: string | null;
  readonly expandedTextIds: ReadonlyArray<string>;
  readonly copiedTraceId: string | null;
};

export type DiagnosticsTone = "default" | "warning" | "danger";

export type DiagnosticsStatModel = {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly tooltip: string | null;
  readonly tooltipAriaLabel: string | null;
  readonly tone: DiagnosticsTone;
};

export type DiagnosticsLastCheckedModel =
  | { readonly kind: "missing"; readonly label: string }
  | { readonly kind: "invalid"; readonly label: string }
  | {
      readonly kind: "relative";
      readonly label: string;
      readonly value: string;
      readonly suffix: string | null;
    };

export type DiagnosticsMessageModel = {
  readonly id: string;
  readonly message: string;
  readonly tone: "warning" | "danger";
  readonly icon: "alert-triangle";
};

export type DiagnosticsRefreshTarget = "processes" | "resources" | "trace";

export type DiagnosticsRefreshButtonModel = {
  readonly target: DiagnosticsRefreshTarget;
  readonly label: string;
  readonly isPending: boolean;
  readonly disabled: boolean;
  readonly icon: "refresh";
};

export type DiagnosticsOpenLogsButtonModel = {
  readonly label: string;
  readonly disabled: boolean;
  readonly icon: "folder-open";
};

export type DiagnosticsOptionModel = {
  readonly value: string;
  readonly label: string;
};

export type DiagnosticsResourceWindowSelectorModel = {
  readonly ariaLabel: string;
  readonly value: string;
  readonly options: ReadonlyArray<DiagnosticsOptionModel>;
};

export type DiagnosticsExpandableCellModel = {
  readonly id: string;
  readonly collapsedLines: number;
  readonly expandLabel: string;
  readonly content: ExpandableTextModel;
};

export type TraceIdCellModelInput = {
  readonly traceId: string;
  readonly copied: boolean;
};

export type TraceIdCellModel = {
  readonly traceId: string;
  readonly shortTraceId: string;
  readonly copied: boolean;
  readonly copyAriaLabel: string;
  readonly copyTooltip: string;
  readonly icon: "copy";
};

export type DiagnosticsProcessToggleModel = {
  readonly ariaLabel: string;
  readonly icon: "chevron-down" | "chevron-right";
};

export type DiagnosticsProcessRowModel = {
  readonly id: string;
  readonly pid: number;
  readonly pidLabel: string;
  readonly name: string;
  readonly command: string;
  readonly indentLevel: number;
  readonly isExpanded: boolean;
  readonly toggle: DiagnosticsProcessToggleModel | null;
  readonly statusTone: "success";
  readonly cpu: string;
  readonly memory: string;
  readonly type: string;
  readonly signalDisabled: boolean;
  readonly signalActions: ProcessSignalActionsModel;
};

export type DiagnosticsProcessTableModel = {
  readonly headers: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<DiagnosticsProcessRowModel>;
  readonly emptyLabel: string;
};

export type DiagnosticsLiveProcessesModel = {
  readonly id: "live-processes";
  readonly title: string;
  readonly lastChecked: DiagnosticsLastCheckedModel;
  readonly refresh: DiagnosticsRefreshButtonModel;
  readonly stats: ReadonlyArray<DiagnosticsStatModel>;
  readonly messages: ReadonlyArray<DiagnosticsMessageModel>;
  readonly table: DiagnosticsProcessTableModel;
};

export type DiagnosticsResourceBarModel = {
  readonly id: string;
  readonly peakHeightPercent: number;
  readonly averageHeightPercent: number;
  readonly ariaLabel: string;
  readonly tooltip: string;
};

export type DiagnosticsResourceRowModel = {
  readonly id: string;
  readonly pid: number;
  readonly pidLabel: string;
  readonly name: string;
  readonly command: string;
  readonly ariaLabel: string;
  readonly indentLevel: number;
  readonly isServerRoot: boolean;
  readonly statusTone: "warning" | "success";
  readonly cpuTime: string;
  readonly currentCpu: string;
  readonly averageCpu: string;
  readonly peakCpu: string;
  readonly maxMemory: string;
};

export type DiagnosticsResourceTableModel = {
  readonly headers: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<DiagnosticsResourceRowModel>;
  readonly emptyLabel: string;
};

export type DiagnosticsResourceHistoryModel = {
  readonly id: "resource-history";
  readonly title: string;
  readonly windowSelector: DiagnosticsResourceWindowSelectorModel;
  readonly lastChecked: DiagnosticsLastCheckedModel;
  readonly refresh: DiagnosticsRefreshButtonModel;
  readonly stats: ReadonlyArray<DiagnosticsStatModel>;
  readonly messages: ReadonlyArray<DiagnosticsMessageModel>;
  readonly chart: { readonly bars: ReadonlyArray<DiagnosticsResourceBarModel> };
  readonly table: DiagnosticsResourceTableModel;
};

export type DiagnosticsTraceModel = {
  readonly id: "trace-diagnostics";
  readonly title: string;
  readonly lastChecked: DiagnosticsLastCheckedModel;
  readonly openLogs: DiagnosticsOpenLogsButtonModel;
  readonly refresh: DiagnosticsRefreshButtonModel;
  readonly stats: ReadonlyArray<DiagnosticsStatModel>;
  readonly messages: ReadonlyArray<DiagnosticsMessageModel>;
};

export type DiagnosticsTableSectionModel<Row> = {
  readonly id: string;
  readonly title: string;
  readonly headers: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<Row>;
  readonly emptyLabel: string;
};

export type DiagnosticsLatestFailureRowModel = {
  readonly id: string;
  readonly name: string;
  readonly cause: DiagnosticsExpandableCellModel;
  readonly duration: string;
  readonly ended: string;
};

export type DiagnosticsCommonFailureRowModel = {
  readonly id: string;
  readonly name: string;
  readonly count: string;
  readonly cause: DiagnosticsExpandableCellModel;
  readonly lastSeen: string;
};

export type DiagnosticsSlowSpanRowModel = {
  readonly id: string;
  readonly name: string;
  readonly duration: string;
  readonly ended: string;
  readonly trace: TraceIdCellModel;
};

export type DiagnosticsSpanLogRowModel = {
  readonly id: string;
  readonly time: string;
  readonly level: string;
  readonly spanName: string;
  readonly message: DiagnosticsExpandableCellModel;
  readonly trace: TraceIdCellModel;
};

export type DiagnosticsTopSpanRowModel = {
  readonly id: string;
  readonly name: string;
  readonly count: string;
  readonly failures: string;
  readonly average: string;
  readonly max: string;
};

export type DiagnosticsSettingsModel = {
  readonly liveProcesses: DiagnosticsLiveProcessesModel;
  readonly resourceHistory: DiagnosticsResourceHistoryModel;
  readonly trace: DiagnosticsTraceModel;
  readonly latestFailures: DiagnosticsTableSectionModel<DiagnosticsLatestFailureRowModel>;
  readonly commonFailures: DiagnosticsTableSectionModel<DiagnosticsCommonFailureRowModel>;
  readonly slowestSpans: DiagnosticsTableSectionModel<DiagnosticsSlowSpanRowModel>;
  readonly spanLogs: DiagnosticsTableSectionModel<DiagnosticsSpanLogRowModel>;
  readonly topSpanNames: DiagnosticsTableSectionModel<DiagnosticsTopSpanRowModel>;
};

export function resolveResourceHistoryQueryInput(
  windowMs: number,
): ServerProcessResourceHistoryInput {
  const selected =
    RESOURCE_HISTORY_WINDOWS.find((option) => option.windowMs === windowMs) ??
    DEFAULT_RESOURCE_HISTORY_WINDOW;
  return { windowMs: selected.windowMs, bucketMs: selected.bucketMs };
}

export function buildTraceIdCellModel(input: TraceIdCellModelInput): TraceIdCellModel {
  return {
    traceId: input.traceId,
    shortTraceId:
      input.traceId.length <= 32
        ? input.traceId
        : `${input.traceId.slice(0, 18)}...${input.traceId.slice(-10)}`,
    copied: input.copied,
    copyAriaLabel: input.copied ? "Copied trace ID" : "Copy trace ID",
    copyTooltip: input.copied ? "Copied" : "Copy full trace ID",
    icon: "copy",
  };
}

export type DiagnosticsLastCheckedModelInput = {
  readonly checkedAt: DateTime.Utc | null;
  readonly nowMs: number;
};

export function buildDiagnosticsLastCheckedModel(
  input: DiagnosticsLastCheckedModelInput,
): DiagnosticsLastCheckedModel {
  const relative = getRelativeTimeState(
    input.checkedAt ? DateTime.formatIso(input.checkedAt) : null,
    input.nowMs,
  );
  if (relative.status === "missing") return { kind: "missing", label: "Checking" };
  if (relative.status === "invalid") return { kind: "invalid", label: "Checked unavailable" };
  return { kind: "relative", label: "Checked", value: relative.value, suffix: relative.suffix };
}

function buildStat(input: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly tooltip?: string;
  readonly tone?: DiagnosticsTone;
}): DiagnosticsStatModel {
  return {
    id: input.id,
    label: input.label,
    value: input.value,
    tooltip: input.tooltip ?? null,
    tooltipAriaLabel: input.tooltip ? `${input.label} details` : null,
    tone: input.tone ?? "default",
  };
}

function buildMessage(
  id: string,
  message: string | null,
  tone: DiagnosticsMessageModel["tone"] = "danger",
): DiagnosticsMessageModel[] {
  return message ? [{ id, message, tone, icon: "alert-triangle" }] : [];
}

function buildExpandableCell(input: {
  readonly id: string;
  readonly text: string;
  readonly expandLabel: string;
  readonly collapsedLines: number;
  readonly expandedTextIds: ReadonlySet<string>;
}): DiagnosticsExpandableCellModel {
  return {
    id: input.id,
    collapsedLines: input.collapsedLines,
    expandLabel: input.expandLabel,
    content: buildExpandableTextModel({
      text: input.text,
      expanded: input.expandedTextIds.has(input.id),
      expandLabel: input.expandLabel,
    }),
  };
}

function buildLiveProcessesModel(
  input: DiagnosticsSettingsModelInput,
): DiagnosticsLiveProcessesModel {
  const { data, error, isPending } = input.processes;
  const diagnosticsError = data ? Option.getOrNull(data.error) : null;
  const collapsedPids = new Set(input.collapsedPids);
  const visibleProcesses: ServerProcessDiagnosticsEntry[] = [];
  let hiddenChildDepth: number | null = null;
  for (const process of data?.processes ?? []) {
    if (hiddenChildDepth !== null) {
      if (process.depth > hiddenChildDepth) continue;
      hiddenChildDepth = null;
    }
    visibleProcesses.push(process);
    if (collapsedPids.has(process.pid)) {
      hiddenChildDepth = process.depth;
    }
  }

  return {
    id: "live-processes",
    title: "Live Processes",
    lastChecked: buildDiagnosticsLastCheckedModel({
      checkedAt: data?.readAt ?? null,
      nowMs: input.nowMs,
    }),
    refresh: {
      target: "processes",
      label: "Refresh process diagnostics",
      isPending,
      disabled: isPending,
      icon: "refresh",
    },
    stats: [
      buildStat({
        id: "child-processes",
        label: "Child Processes",
        value: data ? formatCount(data.processCount) : PLACEHOLDER_VALUE,
      }),
      buildStat({
        id: "cpu",
        label: "CPU",
        value: data ? formatPercent(data.totalCpuPercent) : PLACEHOLDER_VALUE,
        tooltip:
          "Total CPU across live child processes of the current server process. The desktop shell and other parent processes are not included.",
      }),
      buildStat({
        id: "memory",
        label: "Memory",
        value: data ? formatBytes(data.totalRssBytes) : PLACEHOLDER_VALUE,
        tooltip:
          "Total resident memory across live child processes of the current server process. The desktop shell and other parent processes are not included.",
      }),
      buildStat({
        id: "server-pid",
        label: "Server PID",
        value: data ? String(data.serverPid) : PLACEHOLDER_VALUE,
      }),
    ],
    messages: [
      ...buildMessage("process-diagnostics-error", diagnosticsError?.message ?? null),
      ...buildMessage("process-query-error", error),
    ],
    table: {
      headers: ["Name", "CPU", "Memory", "Command", "PID", "Type", "Kill"],
      emptyLabel:
        isPending && data === null
          ? "Loading live processes..."
          : "No live descendant processes found.",
      rows: visibleProcesses.map((process) => {
        const name = formatProcessName(process.command);
        const isExpanded = !collapsedPids.has(process.pid);
        return {
          id: String(process.pid),
          pid: process.pid,
          pidLabel: String(process.pid),
          name,
          command: process.command,
          indentLevel: Math.min(process.depth, 6),
          isExpanded,
          toggle:
            process.childPids.length > 0
              ? {
                  ariaLabel: isExpanded ? `Collapse ${name}` : `Expand ${name}`,
                  icon: isExpanded ? "chevron-down" : "chevron-right",
                }
              : null,
          statusTone: "success",
          cpu: formatPercent(process.cpuPercent),
          memory: formatBytes(process.rssBytes),
          type: formatProcessType(process),
          signalDisabled: input.signalingPid === process.pid,
          signalActions: buildProcessSignalActionsModel({
            disabled: input.signalingPid === process.pid,
          }),
        };
      }),
    },
  };
}

function buildResourceHistoryModel(
  input: DiagnosticsSettingsModelInput,
): DiagnosticsResourceHistoryModel {
  const { data, error, isPending } = input.resources;
  const resourceError = data ? Option.getOrNull(data.error) : null;
  const buckets = data?.buckets ?? [];
  const processes = data?.topProcesses ?? [];
  const maxCpuPercent = Math.max(1, ...buckets.map((bucket) => bucket.maxCpuPercent));
  const shallowestChildDepth = processes.reduce<number | null>((minDepth, process) => {
    if (process.isServerRoot) return minDepth;
    return minDepth === null ? process.depth : Math.min(minDepth, process.depth);
  }, null);

  return {
    id: "resource-history",
    title: "Resource History",
    windowSelector: {
      ariaLabel: "Process history period",
      value: String(input.resourceWindowMs),
      options: RESOURCE_HISTORY_WINDOWS.map((option) => ({
        value: String(option.windowMs),
        label: option.label,
      })),
    },
    lastChecked: buildDiagnosticsLastCheckedModel({
      checkedAt: data?.readAt ?? null,
      nowMs: input.nowMs,
    }),
    refresh: {
      target: "resources",
      label: "Refresh resource history",
      isPending,
      disabled: isPending,
      icon: "refresh",
    },
    stats: [
      buildStat({
        id: "cpu-time",
        label: "CPU Time",
        value: data ? formatCpuTime(data.totalCpuSecondsApprox) : PLACEHOLDER_VALUE,
        tooltip:
          "Approximate active CPU time for the T3 server root process and its descendants during the selected window. It grows only while sampled processes use CPU and older samples leave as the window moves.",
      }),
      buildStat({
        id: "samples",
        label: "Samples",
        value: data ? formatCount(data.retainedSampleCount) : PLACEHOLDER_VALUE,
        tooltip:
          "In-memory process samples retained by the server. This resets when the server restarts.",
      }),
      buildStat({
        id: "interval",
        label: "Interval",
        value: data ? formatDuration(data.sampleIntervalMs) : PLACEHOLDER_VALUE,
      }),
      buildStat({
        id: "processes",
        label: "Processes",
        value: data ? formatCount(data.topProcesses.length) : PLACEHOLDER_VALUE,
      }),
    ],
    messages: [
      ...buildMessage("resource-history-error", resourceError?.message ?? null),
      ...buildMessage("resource-query-error", error),
    ],
    chart: {
      bars: buckets.map((bucket) => ({
        id: DateTime.formatIso(bucket.startedAt),
        peakHeightPercent: Math.max(2, (bucket.maxCpuPercent / maxCpuPercent) * 100),
        averageHeightPercent: Math.max(2, (bucket.avgCpuPercent / maxCpuPercent) * 100),
        ariaLabel: `Average CPU ${bucket.avgCpuPercent.toFixed(1)}%, peak CPU ${bucket.maxCpuPercent.toFixed(1)}%`,
        tooltip: `Avg ${bucket.avgCpuPercent.toFixed(1)}%, peak ${bucket.maxCpuPercent.toFixed(1)}%`,
      })),
    },
    table: {
      headers: ["Process", "CPU Time", "Current", "Average", "Peak", "Max Mem", "Command", "PID"],
      emptyLabel:
        isPending && data === null
          ? "Collecting process resource samples..."
          : "No process resource samples found for this window.",
      rows: processes.map((process) => {
        const name = formatShortProcessName(process.command);
        return {
          id: process.processKey,
          pid: process.pid,
          pidLabel: String(process.pid),
          name,
          command: process.command,
          ariaLabel: `${process.isServerRoot ? "Root" : "Child"} process ${name}`,
          indentLevel: Math.min(
            process.isServerRoot || shallowestChildDepth === null
              ? 0
              : Math.max(1, process.depth - shallowestChildDepth + 1),
            6,
          ),
          isServerRoot: process.isServerRoot,
          statusTone: process.isServerRoot ? "warning" : "success",
          cpuTime: formatCpuTime(process.cpuSecondsApprox),
          currentCpu: formatPercent(process.currentCpuPercent),
          averageCpu: formatPercent(process.avgCpuPercent),
          peakCpu: formatPercent(process.maxCpuPercent),
          maxMemory: formatBytes(process.maxRssBytes),
        };
      }),
    },
  };
}

function buildTraceModel(input: DiagnosticsSettingsModelInput): DiagnosticsTraceModel {
  const { data, error, isPending } = input.trace;
  const traceError = data ? Option.getOrNull(data.error) : null;
  const partialFailure = data ? Option.getOrElse(data.partialFailure, () => false) : false;

  return {
    id: "trace-diagnostics",
    title: "Trace Diagnostics",
    lastChecked: buildDiagnosticsLastCheckedModel({
      checkedAt: data?.readAt ?? null,
      nowMs: input.nowMs,
    }),
    openLogs: {
      label: "Open logs folder",
      disabled: !input.logsDirectoryPath || input.isOpeningLogsDirectory,
      icon: "folder-open",
    },
    refresh: {
      target: "trace",
      label: "Refresh trace diagnostics",
      isPending,
      disabled: isPending,
      icon: "refresh",
    },
    stats: [
      buildStat({
        id: "spans",
        label: "Spans",
        value: data ? formatCount(data.recordCount) : PLACEHOLDER_VALUE,
      }),
      buildStat({
        id: "failures",
        label: "Failures",
        value: data ? formatCount(data.failureCount) : PLACEHOLDER_VALUE,
        tone: data && data.failureCount > 0 ? "danger" : "default",
      }),
      buildStat({
        id: "slow-spans",
        label: "Slow Spans",
        value: data ? formatCount(data.slowSpanCount) : PLACEHOLDER_VALUE,
        tooltip: data
          ? `Spans with a duration of ${formatDuration(data.slowSpanThresholdMs)} or longer.`
          : "Spans at or above the configured slow-span threshold.",
        tone: data && data.slowSpanCount > 0 ? "warning" : "default",
      }),
      buildStat({
        id: "parse-errors",
        label: "Parse Errors",
        value: data ? formatCount(data.parseErrorCount) : PLACEHOLDER_VALUE,
        tone: data && data.parseErrorCount > 0 ? "warning" : "default",
      }),
    ],
    messages: [
      ...buildMessage("open-logs-directory-error", input.openLogsDirectoryError),
      ...buildMessage(
        "trace-diagnostics-error",
        traceError && partialFailure
          ? `Some trace files could not be read, so diagnostics may be incomplete. ${traceError.message}`
          : (traceError?.message ?? null),
        partialFailure ? "warning" : "danger",
      ),
      ...buildMessage("trace-query-error", error),
    ],
  };
}

export function buildDiagnosticsSettingsModel(
  input: DiagnosticsSettingsModelInput,
): DiagnosticsSettingsModel {
  const { data, isPending } = input.trace;
  const isInitialLoading = isPending && data === null;
  const expandedTextIds = new Set(input.expandedTextIds);

  return {
    liveProcesses: buildLiveProcessesModel(input),
    resourceHistory: buildResourceHistoryModel(input),
    trace: buildTraceModel(input),
    latestFailures: {
      id: "latest-failures",
      title: "Latest Failures",
      headers: ["Span", "Cause", "Duration", "Ended"],
      emptyLabel: isInitialLoading ? "Loading failures..." : "No failed spans found.",
      rows: (data?.latestFailures ?? []).map((failure) => {
        const id = `${failure.traceId}:${failure.spanId}`;
        return {
          id,
          name: failure.name,
          cause: buildExpandableCell({
            id: `${id}:cause`,
            text: failure.cause,
            expandLabel: DEFAULT_EXPANDABLE_TEXT_EXPAND_LABEL,
            collapsedLines: 3,
            expandedTextIds,
          }),
          duration: formatDuration(failure.durationMs),
          ended: formatRelative(failure.endedAt, input.nowMs),
        };
      }),
    },
    commonFailures: {
      id: "common-failures",
      title: "Most Common Failures",
      headers: ["Span", "Count", "Cause", "Last Seen"],
      emptyLabel: isInitialLoading ? "Loading failure groups..." : "No repeated failures found.",
      rows: (data?.commonFailures ?? []).map((failure) => {
        const id = `${failure.name}:${failure.cause}`;
        return {
          id,
          name: failure.name,
          count: formatCount(failure.count),
          cause: buildExpandableCell({
            id: `${id}:cause`,
            text: failure.cause,
            expandLabel: DEFAULT_EXPANDABLE_TEXT_EXPAND_LABEL,
            collapsedLines: 3,
            expandedTextIds,
          }),
          lastSeen: formatRelative(failure.lastSeenAt, input.nowMs),
        };
      }),
    },
    slowestSpans: {
      id: "slowest-spans",
      title: "Slowest Spans",
      headers: ["Span", "Duration", "Ended", "Trace"],
      emptyLabel: isInitialLoading ? "Loading slow spans..." : "No spans found.",
      rows: (data?.slowestSpans ?? []).map((span) => ({
        id: `${span.traceId}:${span.spanId}`,
        name: span.name,
        duration: formatDuration(span.durationMs),
        ended: formatRelative(span.endedAt, input.nowMs),
        trace: buildTraceIdCellModel({
          traceId: span.traceId,
          copied: input.copiedTraceId === span.traceId,
        }),
      })),
    },
    spanLogs: {
      id: "span-logs",
      title: "Span Logs",
      headers: ["Time", "Level", "Span", "Message", "Trace"],
      emptyLabel: isInitialLoading ? "Loading recent logs..." : "No warnings or errors found.",
      rows: (data?.latestWarningAndErrorLogs ?? []).map((event) => {
        const id = `${event.traceId}:${event.spanId}:${DateTime.formatIso(event.seenAt)}:${event.message}`;
        return {
          id,
          time: formatRelative(event.seenAt, input.nowMs),
          level: event.level,
          spanName: event.spanName,
          message: buildExpandableCell({
            id: `${id}:message`,
            text: event.message,
            expandLabel: "Show full message",
            collapsedLines: 2,
            expandedTextIds,
          }),
          trace: buildTraceIdCellModel({
            traceId: event.traceId,
            copied: input.copiedTraceId === event.traceId,
          }),
        };
      }),
    },
    topSpanNames: {
      id: "top-span-names",
      title: "Top Span Names",
      headers: ["Span", "Count", "Failures", "Average", "Max"],
      emptyLabel: isInitialLoading ? "Loading span names..." : "No spans found.",
      rows: (data?.topSpansByCount ?? []).map((span) => ({
        id: span.name,
        name: span.name,
        count: formatCount(span.count),
        failures: formatCount(span.failureCount),
        average: formatDuration(span.averageDurationMs),
        max: formatDuration(span.maxDurationMs),
      })),
    },
  };
}

export type DiagnosticsIntent =
  | { readonly kind: "refresh"; readonly target: DiagnosticsRefreshTarget }
  | { readonly kind: "select-resource-window"; readonly value: string | undefined }
  | { readonly kind: "toggle-process"; readonly pid: number }
  | { readonly kind: "open-logs-directory"; readonly editor: EditorId | null }
  | {
      readonly kind: "signal-process";
      readonly pid: number;
      readonly signal: ServerProcessSignal;
    };

export type DiagnosticsActionContext = {
  readonly environmentId: EnvironmentId | null;
  readonly logsDirectoryPath: string | null;
  readonly processes: ReadonlyArray<ServerProcessDiagnosticsEntry>;
  readonly signalingPid: number | null;
  readonly collapsedPids: ReadonlyArray<number>;
};

export type ProcessSignalConfirmation = {
  readonly message: string;
  readonly variant: "destructive";
};

export type DiagnosticsActionDecision =
  | { readonly kind: "none" }
  | { readonly kind: "refresh"; readonly target: DiagnosticsRefreshTarget }
  | { readonly kind: "set-resource-window"; readonly windowMs: number }
  | { readonly kind: "set-collapsed-pids"; readonly collapsedPids: ReadonlyArray<number> }
  | { readonly kind: "show-open-logs-directory-error"; readonly message: string }
  | {
      readonly kind: "open-logs-directory";
      readonly environmentId: EnvironmentId;
      readonly cwd: string;
      readonly editor: EditorId;
    }
  | {
      readonly kind: "signal-process";
      readonly environmentId: EnvironmentId;
      readonly pid: number;
      readonly startTimeMs: number;
      readonly signal: ServerProcessSignal;
      readonly confirmation: ProcessSignalConfirmation | null;
    };

export function resolveDiagnosticsAction(
  intent: DiagnosticsIntent,
  context: DiagnosticsActionContext,
): DiagnosticsActionDecision {
  switch (intent.kind) {
    case "refresh":
      return { kind: "refresh", target: intent.target };
    case "select-resource-window": {
      const selected = RESOURCE_HISTORY_WINDOWS.find(
        (option) => String(option.windowMs) === intent.value,
      );
      return selected
        ? { kind: "set-resource-window", windowMs: selected.windowMs }
        : { kind: "none" };
    }
    case "toggle-process":
      return {
        kind: "set-collapsed-pids",
        collapsedPids: context.collapsedPids.includes(intent.pid)
          ? context.collapsedPids.filter((pid) => pid !== intent.pid)
          : [...context.collapsedPids, intent.pid],
      };
    case "open-logs-directory": {
      if (!context.logsDirectoryPath) return { kind: "none" };
      if (!intent.editor) {
        return { kind: "show-open-logs-directory-error", message: "No available editors found." };
      }
      if (context.environmentId === null) {
        return { kind: "show-open-logs-directory-error", message: "No environment is selected." };
      }
      return {
        kind: "open-logs-directory",
        environmentId: context.environmentId,
        cwd: context.logsDirectoryPath,
        editor: intent.editor,
      };
    }
    case "signal-process": {
      const process = context.processes.find((entry) => entry.pid === intent.pid);
      if (context.environmentId === null || process === undefined) return { kind: "none" };
      if (context.signalingPid !== null) return { kind: "none" };
      return {
        kind: "signal-process",
        environmentId: context.environmentId,
        pid: intent.pid,
        startTimeMs: process.startTimeMs,
        signal: intent.signal,
        confirmation:
          intent.signal === "SIGKILL"
            ? {
                message: `Send SIGKILL to process ${intent.pid}? This cannot be handled by the process.`,
                variant: "destructive",
              }
            : null,
      };
    }
  }
}

export type DiagnosticsCommandFailure =
  | { readonly kind: "interrupted" }
  | { readonly kind: "failed"; readonly errorMessage: string | null };

export type OpenLogsDirectoryResult = { readonly kind: "succeeded" } | DiagnosticsCommandFailure;

export type OpenLogsDirectoryOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "show-error"; readonly message: string };

export function resolveOpenLogsDirectoryOutcome(
  result: OpenLogsDirectoryResult,
): OpenLogsDirectoryOutcome {
  if (result.kind !== "failed") return { kind: "none" };
  return { kind: "show-error", message: result.errorMessage ?? "Unable to open logs folder." };
}

export type DiagnosticsToastModel = {
  readonly type: "error" | "info";
  readonly title: string;
  readonly description: string;
};

export function resolveProcessSignalConfirmFailure(
  signal: ServerProcessSignal,
  errorMessage: string | null,
): DiagnosticsToastModel {
  return {
    type: "error",
    title: "Could not confirm signal",
    description: errorMessage ?? `Failed to send ${signal}.`,
  };
}

export type ProcessSignalTargetInput = {
  readonly targetEnvironmentId: EnvironmentId;
  readonly environmentId: EnvironmentId | null;
  readonly pid: number;
  readonly startTimeMs: number;
  readonly processes: ReadonlyArray<ServerProcessDiagnosticsEntry>;
};

export function isProcessSignalTargetCurrent(input: ProcessSignalTargetInput): boolean {
  if (input.environmentId !== input.targetEnvironmentId) return false;
  return (
    input.processes.find((entry) => entry.pid === input.pid)?.startTimeMs === input.startTimeMs
  );
}

export type ProcessSignalResult =
  | { readonly kind: "succeeded"; readonly signaled: boolean; readonly message: string | null }
  | DiagnosticsCommandFailure;

export type ProcessSignalOutcome = {
  readonly refreshProcesses: boolean;
  readonly toast: DiagnosticsToastModel | null;
};

export function resolveProcessSignalOutcome(
  signal: ServerProcessSignal,
  result: ProcessSignalResult,
): ProcessSignalOutcome {
  if (result.kind === "interrupted") return { refreshProcesses: false, toast: null };
  if (result.kind === "failed") {
    return {
      refreshProcesses: false,
      toast: {
        type: "error",
        title: `Could not send ${signal}`,
        description: result.errorMessage ?? `Failed to send ${signal}.`,
      },
    };
  }
  if (result.signaled) return { refreshProcesses: true, toast: null };
  if (result.message?.includes("not a live descendant")) {
    return {
      refreshProcesses: true,
      toast: {
        type: "info",
        title: "Process already exited",
        description: "The process is not a child of the T3 Server. It might already have exited.",
      },
    };
  }
  return {
    refreshProcesses: true,
    toast: {
      type: "error",
      title: `Could not send ${signal}`,
      description: result.message ?? `Failed to send ${signal}.`,
    },
  };
}
