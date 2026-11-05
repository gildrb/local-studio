import { ProcessSignalActions } from "./ProcessSignalActions";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  FolderOpenIcon,
  InfoIcon,
} from "lucide-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ServerProcessSignal } from "@t3tools/contracts";
import type * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import { cn } from "../../lib/utils";
import { ensureLocalApi } from "../../localApi";
import { resolveAndPersistPreferredEditor } from "../../editorPreferences.logic";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { shellEnvironment } from "../../state/shell";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { ExpandableText } from "./ExpandableText";
import { ResourceTelemetryDiagnostics } from "./ResourceTelemetryDiagnostics";
import { SettingsPageContainer, SettingsSection, useRelativeTimeTick } from "./settingsLayout";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  buildDiagnosticsSettingsModel,
  buildTraceIdCellModel,
  DEFAULT_RESOURCE_HISTORY_WINDOW_MS,
  isProcessSignalTargetCurrent,
  resolveDiagnosticsAction,
  resolveOpenLogsDirectoryOutcome,
  resolveProcessSignalConfirmFailure,
  resolveProcessSignalOutcome,
  resolveResourceHistoryQueryInput,
  TRACE_ID_COPY_TARGET,
  TRACE_ID_COPY_TIMEOUT_MS,
  type DiagnosticsIntent,
  buildDiagnosticsLastCheckedModel,
  type DiagnosticsMessageModel,
  type DiagnosticsProcessRowModel,
  type DiagnosticsProcessTableModel,
  type DiagnosticsRefreshButtonModel,
  type DiagnosticsResourceBarModel,
  type DiagnosticsResourceTableModel,
  type DiagnosticsResourceWindowSelectorModel,
  type DiagnosticsStatModel,
} from "./DiagnosticsSettings.logic";

const NO_EXPANDED_TEXT_IDS: ReadonlyArray<string> = [];

function noWrap(value: string): string {
  return value.replaceAll(" ", "\u00a0");
}

function errorMessageOf(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}

function StatBlock({ stat }: { stat: DiagnosticsStatModel }) {
  return (
    <div className="min-w-0 border-border/60 px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-1.5 text-2xs font-medium uppercase tracking-widest text-muted-foreground/70">
        <span className="min-w-0 truncate">{stat.label}</span>
        {stat.tooltip ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="cursor-pointer inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 hover:text-foreground"
                  aria-label={stat.tooltipAriaLabel ?? undefined}
                >
                  <InfoIcon className="size-3" />
                </button>
              }
            />
            <TooltipPopup side="top">{stat.tooltip}</TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      <div
        className={cn(
          "mt-1 truncate font-mono text-lg font-semibold tabular-nums text-foreground",
          stat.tone === "warning" && "text-warning-foreground",
          stat.tone === "danger" && "text-destructive",
        )}
      >
        {stat.value}
      </div>
    </div>
  );
}

function StatsGrid({ stats }: { stats: ReadonlyArray<DiagnosticsStatModel> }) {
  return (
    <div className="relative grid grid-cols-2 sm:grid-cols-4">
      <span
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-border/60"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-border/60 sm:hidden"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-y-0 left-1/4 hidden w-px bg-border/60 sm:block"
        aria-hidden
      />
      <span
        className="pointer-events-none absolute inset-y-0 left-3/4 hidden w-px bg-border/60 sm:block"
        aria-hidden
      />
      {stats.map((stat) => (
        <StatBlock key={stat.id} stat={stat} />
      ))}
    </div>
  );
}

function DiagnosticsMessages({ messages }: { messages: ReadonlyArray<DiagnosticsMessageModel> }) {
  if (messages.length === 0) return null;
  return (
    <div className="space-y-2 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground sm:px-5">
      {messages.map((message) => (
        <div
          key={message.id}
          className={cn(
            "flex items-start gap-2",
            message.tone === "warning" ? "text-warning-foreground" : "text-destructive",
          )}
        >
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>{message.message}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyRows({ label }: { label: string }) {
  return <div className="px-4 py-4 text-xs text-muted-foreground sm:px-5">{label}</div>;
}

function DiagnosticsTable({
  headers,
  children,
  minTableWidth = "min-w-[640px]",
  columnWidths,
}: {
  headers: ReadonlyArray<string>;
  children: ReactNode;
  minTableWidth?: string;
  columnWidths?: ReadonlyArray<string>;
}) {
  return (
    <ScrollArea
      radius="none"
      chainVerticalScroll
      scrollFade
      hideScrollbars
      className="w-full max-w-full"
    >
      <table
        className={cn("w-full text-left text-xs", minTableWidth, columnWidths && "table-fixed")}
      >
        {columnWidths ? (
          <colgroup>
            {headers.map((header, index) => (
              <col key={header} className={columnWidths[index]} />
            ))}
          </colgroup>
        ) : null}
        <thead className="border-b border-border/60 text-2xs uppercase tracking-widest text-muted-foreground/70">
          <tr>
            {headers.map((header, index) => (
              <th
                key={header}
                className={cn(
                  "whitespace-nowrap px-4 py-2.5 font-semibold first:sm:pl-5 last:sm:pr-5",
                  !columnWidths && index === headers.length - 1 && "w-px",
                )}
              >
                {noWrap(header)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">{children}</tbody>
      </table>
    </ScrollArea>
  );
}

function TraceIdCell({ traceId }: { traceId: string }) {
  const { copyToClipboard, isCopied: copied } = useCopyToClipboard({
    target: TRACE_ID_COPY_TARGET,
    timeout: TRACE_ID_COPY_TIMEOUT_MS,
  });
  const cell = buildTraceIdCellModel({ traceId, copied });

  return (
    <div className="flex w-full min-w-0 max-w-full items-center gap-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="min-w-0 flex-1 truncate font-mono text-2xs">{cell.shortTraceId}</span>
          }
        />
        <TooltipPopup side="top" variant="code">
          {cell.traceId}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label={cell.copyAriaLabel}
              onClick={() => copyToClipboard(cell.traceId)}
            >
              <CopyIcon className="size-3" />
            </Button>
          }
        />
        <TooltipPopup side="top">{cell.copyTooltip}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

function ProcessNameCell({
  row,
  onToggle,
}: {
  row: DiagnosticsProcessRowModel;
  onToggle: (pid: number) => void;
}) {
  const ChevronIcon = row.isExpanded ? ChevronDownIcon : ChevronRightIcon;

  return (
    <div
      className="grid min-w-0 grid-cols-[1.25rem_0.375rem_minmax(0,1fr)] items-center gap-2"
      style={{ paddingLeft: `${row.indentLevel * 10}px` }}
    >
      {row.toggle ? (
        <Button
          size="icon-micro"
          variant="ghost-muted"
          aria-label={row.toggle.ariaLabel}
          onClick={() => onToggle(row.pid)}
        >
          <ChevronIcon className="size-3.5" />
        </Button>
      ) : (
        <span className="size-5 shrink-0" aria-hidden="true" />
      )}
      <span className="size-1.5 shrink-0 rounded-full bg-success/80" />
      <Tooltip>
        <TooltipTrigger
          render={<span className="min-w-0 truncate font-medium text-foreground">{row.name}</span>}
        />
        <TooltipPopup side="top" variant="code">
          {row.command}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

const PROCESS_HEADER_CLASS_NAMES = [
  "px-4 py-2 font-semibold sm:pl-5",
  "px-3 py-2 text-right font-semibold",
  "px-3 py-2 text-right font-semibold",
  "px-3 py-2 font-semibold",
  "px-3 py-2 text-right font-semibold",
  "px-3 py-2 font-semibold",
  "p-2 text-right font-semibold sm:pr-4",
] as const;

function ProcessDiagnosticsTable({
  table,
  onSignal,
  onToggle,
}: {
  table: DiagnosticsProcessTableModel;
  onSignal: (pid: number, signal: ServerProcessSignal) => void;
  onToggle: (pid: number) => void;
}) {
  return (
    <div className="border-t border-border/60">
      <ScrollArea
        radius="none"
        chainVerticalScroll
        scrollFade
        hideScrollbars
        className="max-h-[min(64vh,44rem)] w-full max-w-full"
      >
        <table className="w-full min-w-[1040px] table-fixed text-left text-xs">
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[8%]" />
            <col className="w-[10%]" />
            <col className="w-[33%]" />
            <col className="w-[8%]" />
            <col className="w-[11%]" />
            <col className="w-[6%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 border-b border-border/60 bg-card text-2xs uppercase tracking-widest text-muted-foreground/70">
            <tr>
              {table.headers.map((header, index) => (
                <th key={header} className={PROCESS_HEADER_CLASS_NAMES[index]}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {table.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-4 text-xs text-muted-foreground sm:px-5">
                  {table.emptyLabel}
                </td>
              </tr>
            ) : null}
            {table.rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/20">
                <td className="px-4 py-2 align-middle sm:pl-5">
                  <ProcessNameCell row={row} onToggle={onToggle} />
                </td>
                <td className="px-3 py-2 text-right align-middle font-mono tabular-nums">
                  {row.cpu}
                </td>
                <td className="px-3 py-2 text-right align-middle font-mono tabular-nums">
                  {row.memory}
                </td>
                <td className="px-3 py-2 align-middle text-muted-foreground">
                  <Tooltip>
                    <TooltipTrigger
                      render={<span className="block truncate">{row.command}</span>}
                    />
                    <TooltipPopup side="top" variant="code">
                      {row.command}
                    </TooltipPopup>
                  </Tooltip>
                </td>
                <td className="px-3 py-2 text-right align-middle font-mono tabular-nums text-muted-foreground">
                  {row.pidLabel}
                </td>
                <td className="truncate px-3 py-2 align-middle text-muted-foreground">
                  {row.type}
                </td>
                <td className="p-2 align-middle sm:pr-4">
                  <ProcessSignalActions
                    disabled={row.signalDisabled}
                    onSignal={(signal) => onSignal(row.pid, signal)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

function ProcessResourceHistoryChart({
  bars,
}: {
  bars: ReadonlyArray<DiagnosticsResourceBarModel>;
}) {
  return (
    <div className="border-t border-border/60 px-4 py-3 sm:px-5">
      <div className="flex h-28 items-end gap-1 overflow-hidden rounded-sm bg-muted/10 p-2">
        {bars.map((bar) => (
          <Tooltip key={bar.id}>
            <TooltipTrigger
              render={
                <div className="flex h-full min-w-1 flex-1 items-end">
                  <div className="relative h-full w-full" aria-label={bar.ariaLabel}>
                    <div
                      className="absolute inset-x-0 bottom-0 rounded-t-sm bg-foreground/15 transition-colors"
                      style={{ height: `${bar.peakHeightPercent}%` }}
                    />
                    <div
                      className="absolute inset-x-0 bottom-0 rounded-t-sm bg-foreground/60 transition-colors"
                      style={{ height: `${bar.averageHeightPercent}%` }}
                    />
                  </div>
                </div>
              }
            />
            <TooltipPopup side="top">{bar.tooltip}</TooltipPopup>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

function ResourceHistoryWindowSelector({
  selector,
  onSelect,
}: {
  selector: DiagnosticsResourceWindowSelectorModel;
  onSelect: (value: string | undefined) => void;
}) {
  return (
    <ToggleGroup
      aria-label={selector.ariaLabel}
      variant="segmented"
      value={[selector.value]}
      onValueChange={(next) => onSelect(next[0])}
    >
      {selector.options.map((option) => (
        <Toggle key={option.value} value={option.value}>
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

const RESOURCE_HEADER_CLASS_NAMES = [
  "px-4 py-2 font-semibold sm:pl-5",
  "px-3 py-2 text-right font-semibold",
  "px-3 py-2 text-right font-semibold",
  "px-3 py-2 text-right font-semibold",
  "px-3 py-2 text-right font-semibold",
  "px-3 py-2 text-right font-semibold",
  "px-3 py-2 font-semibold",
  "px-3 py-2 text-right font-semibold sm:pr-5",
] as const;

function ProcessResourceHistoryTable({ table }: { table: DiagnosticsResourceTableModel }) {
  return (
    <div className="border-t border-border/60">
      <ScrollArea
        chainVerticalScroll
        scrollFade
        hideScrollbars
        className="max-h-[min(64vh,44rem)] w-full max-w-full"
      >
        <table className="w-full min-w-[980px] table-fixed text-left text-xs">
          <colgroup>
            <col className="w-[24%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[10%]" />
            <col className="w-[16%]" />
            <col className="w-[10%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 border-b border-border/60 bg-card text-2xs uppercase tracking-widest text-muted-foreground/70">
            <tr>
              {table.headers.map((header, index) => (
                <th key={header} className={RESOURCE_HEADER_CLASS_NAMES[index]}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {table.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-4 text-xs text-muted-foreground sm:px-5">
                  {table.emptyLabel}
                </td>
              </tr>
            ) : null}
            {table.rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/20">
                <td className="px-4 py-2 align-middle sm:pl-5">
                  <div
                    className="grid min-w-0 grid-cols-[1.25rem_0.375rem_minmax(0,1fr)] items-center gap-2"
                    style={{ paddingLeft: `${row.indentLevel * 10}px` }}
                    aria-label={row.ariaLabel}
                  >
                    <span className="size-5 shrink-0" aria-hidden="true" />
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        row.statusTone === "warning" ? "bg-warning/90" : "bg-success/80",
                      )}
                    />
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span className="min-w-0 truncate font-medium text-foreground">
                            {row.name}
                          </span>
                        }
                      />
                      <TooltipPopup side="top" variant="code">
                        {row.command}
                      </TooltipPopup>
                    </Tooltip>
                  </div>
                </td>
                <td className="px-3 py-2 text-right align-middle font-mono tabular-nums">
                  {row.cpuTime}
                </td>
                <td className="px-3 py-2 text-right align-middle font-mono tabular-nums">
                  {row.currentCpu}
                </td>
                <td className="px-3 py-2 text-right align-middle font-mono tabular-nums">
                  {row.averageCpu}
                </td>
                <td className="px-3 py-2 text-right align-middle font-mono tabular-nums">
                  {row.peakCpu}
                </td>
                <td className="px-3 py-2 text-right align-middle font-mono tabular-nums">
                  {row.maxMemory}
                </td>
                <td className="px-3 py-2 align-middle text-muted-foreground">
                  <Tooltip>
                    <TooltipTrigger
                      render={<span className="block truncate">{row.command}</span>}
                    />
                    <TooltipPopup side="top" variant="code">
                      {row.command}
                    </TooltipPopup>
                  </Tooltip>
                </td>
                <td className="px-3 py-2 text-right align-middle font-mono tabular-nums text-muted-foreground sm:pr-5">
                  {row.pidLabel}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

function DiagnosticsLastChecked({ checkedAt }: { checkedAt: DateTime.Utc | null }) {
  const nowMs = useRelativeTimeTick();
  const lastChecked = buildDiagnosticsLastCheckedModel({ checkedAt, nowMs });
  if (lastChecked.kind !== "relative") {
    return <span className="text-2xs text-muted-foreground/50">{lastChecked.label}</span>;
  }

  return (
    <span className="text-2xs text-muted-foreground/60">
      {lastChecked.suffix ? (
        <>
          {lastChecked.label} <span className="font-mono tabular-nums">{lastChecked.value}</span>{" "}
          {lastChecked.suffix}
        </>
      ) : (
        <>
          {lastChecked.label} {lastChecked.value}
        </>
      )}
    </span>
  );
}

function DiagnosticsRefreshButton({
  button,
  onClick,
}: {
  button: DiagnosticsRefreshButtonModel;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost-muted"
            disabled={button.disabled}
            onClick={onClick}
            aria-label={button.label}
          >
            <RefreshIcon refreshing={button.isPending} />
          </Button>
        }
      />
      <TooltipPopup side="top">{button.label}</TooltipPopup>
    </Tooltip>
  );
}

export function DiagnosticsSettingsPanel() {
  const { environment } = useSettingsScope();
  // The boundary only mounts this page when the selection resolves to one
  // connected environment, so the representative is the one to inspect.
  const environmentId = environment?.environmentId ?? null;
  const observability = environment?.serverConfig?.observability;
  const availableEditors = environment?.serverConfig?.availableEditors;
  const logsDirectoryPath = observability?.logsDirectoryPath ?? null;
  const signalServerProcess = useAtomCommand(serverEnvironment.signalProcess, {
    reportFailure: false,
  });
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, {
    reportFailure: false,
  });
  const [resourceWindowMs, setResourceWindowMs] = useState(DEFAULT_RESOURCE_HISTORY_WINDOW_MS);
  const { data, error, isPending, refresh } = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.traceDiagnostics({ environmentId, input: {} }),
  );
  const {
    data: processData,
    error: processError,
    isPending: isProcessPending,
    refresh: refreshProcesses,
  } = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.processDiagnostics({ environmentId, input: {} }),
  );
  const {
    data: resourceData,
    error: resourceError,
    isPending: isResourcePending,
    refresh: refreshResources,
  } = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.processResourceHistory({
          environmentId,
          input: resolveResourceHistoryQueryInput(resourceWindowMs),
        }),
  );
  const [isOpeningLogsDirectory, setIsOpeningLogsDirectory] = useState(false);
  const [openLogsDirectoryError, setOpenLogsDirectoryError] = useState<string | null>(null);
  const [signalingPid, setSignalingPid] = useState<number | null>(null);
  const [collapsedPids, setCollapsedPids] = useState<ReadonlyArray<number>>([]);
  const signalingPidRef = useRef<number | null>(null);
  const environmentIdRef = useRef(environmentId);
  const processDataRef = useRef(processData);
  useEffect(() => {
    processDataRef.current = processData;
  }, [processData]);
  useEffect(() => {
    environmentIdRef.current = environmentId;
    return () => {
      environmentIdRef.current = null;
    };
  }, [environmentId]);

  const model = useMemo(
    () =>
      buildDiagnosticsSettingsModel({
        nowMs: Date.now(),
        processes: { data: processData, error: processError, isPending: isProcessPending },
        resources: { data: resourceData, error: resourceError, isPending: isResourcePending },
        trace: { data, error, isPending },
        resourceWindowMs,
        collapsedPids,
        signalingPid,
        logsDirectoryPath,
        isOpeningLogsDirectory,
        openLogsDirectoryError,
        expandedTextIds: NO_EXPANDED_TEXT_IDS,
        copiedTraceId: null,
      }),
    [
      collapsedPids,
      data,
      error,
      isOpeningLogsDirectory,
      isPending,
      isProcessPending,
      isResourcePending,
      logsDirectoryPath,
      openLogsDirectoryError,
      processData,
      processError,
      resourceData,
      resourceError,
      resourceWindowMs,
      signalingPid,
    ],
  );

  const handleAction = (intent: DiagnosticsIntent) => {
    const decision = resolveDiagnosticsAction(intent, {
      environmentId: environmentIdRef.current,
      logsDirectoryPath,
      processes: processDataRef.current?.processes ?? [],
      signalingPid: signalingPidRef.current,
      collapsedPids,
    });
    switch (decision.kind) {
      case "none":
        return;
      case "refresh":
        if (decision.target === "processes") refreshProcesses();
        else if (decision.target === "resources") refreshResources();
        else refresh();
        return;
      case "set-resource-window":
        setResourceWindowMs(decision.windowMs);
        return;
      case "set-collapsed-pids":
        setCollapsedPids(decision.collapsedPids);
        return;
      case "show-open-logs-directory-error":
        setOpenLogsDirectoryError(decision.message);
        return;
      case "open-logs-directory":
        setIsOpeningLogsDirectory(true);
        setOpenLogsDirectoryError(null);
        void (async () => {
          const result = await openInEditor({
            environmentId: decision.environmentId,
            input: { cwd: decision.cwd, editor: decision.editor },
          });
          setIsOpeningLogsDirectory(false);
          const outcome = resolveOpenLogsDirectoryOutcome(
            result._tag === "Success"
              ? { kind: "succeeded" }
              : isAtomCommandInterrupted(result)
                ? { kind: "interrupted" }
                : {
                    kind: "failed",
                    errorMessage: errorMessageOf(squashAtomCommandFailure(result)),
                  },
          );
          if (outcome.kind === "show-error") setOpenLogsDirectoryError(outcome.message);
        })();
        return;
      case "signal-process": {
        const { environmentId: targetEnvironmentId, pid, signal, startTimeMs } = decision;
        signalingPidRef.current = pid;
        setSignalingPid(pid);
        const clearSignaling = () => {
          signalingPidRef.current = null;
          setSignalingPid(null);
        };
        void (async () => {
          if (decision.confirmation) {
            let confirmed = false;
            try {
              confirmed = await ensureLocalApi().dialogs.confirm(decision.confirmation.message, {
                variant: decision.confirmation.variant,
              });
            } catch (error) {
              clearSignaling();
              toastManager.add(resolveProcessSignalConfirmFailure(signal, errorMessageOf(error)));
              return;
            }
            if (!confirmed) {
              clearSignaling();
              return;
            }
          }
          if (
            !isProcessSignalTargetCurrent({
              targetEnvironmentId,
              environmentId: environmentIdRef.current,
              pid,
              startTimeMs,
              processes: processDataRef.current?.processes ?? [],
            })
          ) {
            clearSignaling();
            return;
          }

          try {
            const result = await signalServerProcess({
              environmentId: targetEnvironmentId,
              input: { pid, startTimeMs, signal },
            });
            const outcome = resolveProcessSignalOutcome(
              signal,
              result._tag === "Success"
                ? {
                    kind: "succeeded",
                    signaled: result.value.signaled,
                    message: Option.getOrNull(result.value.message),
                  }
                : isAtomCommandInterrupted(result)
                  ? { kind: "interrupted" }
                  : {
                      kind: "failed",
                      errorMessage: errorMessageOf(squashAtomCommandFailure(result)),
                    },
            );
            if (outcome.refreshProcesses) refreshProcesses();
            if (outcome.toast) toastManager.add(outcome.toast);
          } finally {
            clearSignaling();
          }
        })();
        return;
      }
    }
  };

  const { liveProcesses, resourceHistory, trace } = model;

  return (
    <SettingsPageContainer width="expanded" className="gap-10">
      <ResourceTelemetryDiagnostics environmentId={environmentId} />

      <SettingsSection
        title={liveProcesses.title}
        headerAction={
          <div className="flex items-center gap-1.5">
            <DiagnosticsLastChecked checkedAt={processData?.readAt ?? null} />
            <DiagnosticsRefreshButton
              button={liveProcesses.refresh}
              onClick={() =>
                handleAction({ kind: "refresh", target: liveProcesses.refresh.target })
              }
            />
          </div>
        }
      >
        <StatsGrid stats={liveProcesses.stats} />
        <DiagnosticsMessages messages={liveProcesses.messages} />
        <ProcessDiagnosticsTable
          table={liveProcesses.table}
          onSignal={(pid, signal) => handleAction({ kind: "signal-process", pid, signal })}
          onToggle={(pid) => handleAction({ kind: "toggle-process", pid })}
        />
      </SettingsSection>

      <SettingsSection
        title={resourceHistory.title}
        headerAction={
          <div className="flex items-center gap-1.5">
            <ResourceHistoryWindowSelector
              selector={resourceHistory.windowSelector}
              onSelect={(value) => handleAction({ kind: "select-resource-window", value })}
            />
            <DiagnosticsLastChecked checkedAt={resourceData?.readAt ?? null} />
            <DiagnosticsRefreshButton
              button={resourceHistory.refresh}
              onClick={() =>
                handleAction({ kind: "refresh", target: resourceHistory.refresh.target })
              }
            />
          </div>
        }
      >
        <StatsGrid stats={resourceHistory.stats} />
        <DiagnosticsMessages messages={resourceHistory.messages} />
        <ProcessResourceHistoryChart bars={resourceHistory.chart.bars} />
        <ProcessResourceHistoryTable table={resourceHistory.table} />
      </SettingsSection>

      <SettingsSection
        title={trace.title}
        headerAction={
          <div className="flex items-center gap-1.5">
            <DiagnosticsLastChecked checkedAt={data?.readAt ?? null} />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    disabled={trace.openLogs.disabled}
                    onClick={() =>
                      handleAction({
                        kind: "open-logs-directory",
                        editor: resolveAndPersistPreferredEditor(availableEditors ?? []),
                      })
                    }
                    aria-label={trace.openLogs.label}
                  >
                    <FolderOpenIcon />
                  </Button>
                }
              />
              <TooltipPopup side="top">{trace.openLogs.label}</TooltipPopup>
            </Tooltip>
            <DiagnosticsRefreshButton
              button={trace.refresh}
              onClick={() => handleAction({ kind: "refresh", target: trace.refresh.target })}
            />
          </div>
        }
      >
        <StatsGrid stats={trace.stats} />
        <DiagnosticsMessages messages={trace.messages} />
      </SettingsSection>

      <SettingsSection title={model.latestFailures.title}>
        {model.latestFailures.rows.length > 0 ? (
          <DiagnosticsTable headers={model.latestFailures.headers}>
            {model.latestFailures.rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 align-top text-xs font-medium text-foreground first:sm:pl-5">
                  {row.name}
                </td>
                <td className="max-w-[360px] px-4 py-3 align-top text-muted-foreground">
                  <ExpandableText
                    expandLabel={row.cause.expandLabel}
                    text={row.cause.content.text}
                  />
                </td>
                <td className="px-4 py-3 align-top font-mono tabular-nums">{row.duration}</td>
                <td className="whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums text-muted-foreground last:sm:pr-5">
                  {noWrap(row.ended)}
                </td>
              </tr>
            ))}
          </DiagnosticsTable>
        ) : (
          <EmptyRows label={model.latestFailures.emptyLabel} />
        )}
      </SettingsSection>

      <SettingsSection title={model.commonFailures.title}>
        {model.commonFailures.rows.length > 0 ? (
          <DiagnosticsTable headers={model.commonFailures.headers} minTableWidth="min-w-[760px]">
            {model.commonFailures.rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 align-top text-xs font-medium text-foreground first:sm:pl-5">
                  {row.name}
                </td>
                <td className="px-4 py-3 align-top font-mono tabular-nums">{row.count}</td>
                <td className="max-w-[360px] px-4 py-3 align-top text-muted-foreground">
                  <ExpandableText
                    expandLabel={row.cause.expandLabel}
                    text={row.cause.content.text}
                  />
                </td>
                <td className="w-px whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums text-muted-foreground last:sm:pr-5">
                  {noWrap(row.lastSeen)}
                </td>
              </tr>
            ))}
          </DiagnosticsTable>
        ) : (
          <EmptyRows label={model.commonFailures.emptyLabel} />
        )}
      </SettingsSection>

      <SettingsSection title={model.slowestSpans.title}>
        {model.slowestSpans.rows.length > 0 ? (
          <DiagnosticsTable
            headers={model.slowestSpans.headers}
            minTableWidth="min-w-[900px]"
            columnWidths={["w-[44%]", "w-[14%]", "w-[12%]", "w-[30%]"]}
          >
            {model.slowestSpans.rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 align-top text-xs font-medium text-foreground first:sm:pl-5">
                  {row.name}
                </td>
                <td className="px-4 py-3 align-top font-mono tabular-nums">{row.duration}</td>
                <td className="w-px whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums text-muted-foreground">
                  {noWrap(row.ended)}
                </td>
                <td className="min-w-0 whitespace-nowrap px-4 py-3 align-top text-muted-foreground last:sm:pr-5">
                  <TraceIdCell traceId={row.trace.traceId} />
                </td>
              </tr>
            ))}
          </DiagnosticsTable>
        ) : (
          <EmptyRows label={model.slowestSpans.emptyLabel} />
        )}
      </SettingsSection>

      <SettingsSection title={model.spanLogs.title}>
        {model.spanLogs.rows.length > 0 ? (
          <ScrollArea
            radius="none"
            chainVerticalScroll
            scrollFade
            hideScrollbars
            className="w-full max-w-full"
          >
            <table className="w-full min-w-[920px] table-fixed text-left text-xs">
              <colgroup>
                <col className="w-[11%]" />
                <col className="w-[9%]" />
                <col className="w-[24%]" />
                <col className="w-[26%]" />
                <col className="w-[30%]" />
              </colgroup>
              <thead className="border-b border-border/60 text-2xs uppercase tracking-widest text-muted-foreground/70">
                <tr>
                  {model.spanLogs.headers.map((header, index) => (
                    <th
                      key={header}
                      className={cn(
                        "whitespace-nowrap px-4 py-2.5 font-semibold",
                        index === 0 && "sm:pl-5",
                        index === model.spanLogs.headers.length - 1 && "sm:pr-5",
                      )}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {model.spanLogs.rows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/15">
                    <td className="whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums text-muted-foreground sm:pl-5">
                      {noWrap(row.time)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="inline-flex rounded bg-muted px-1.5 py-0.5 font-mono text-2xs font-medium uppercase text-foreground/80">
                        {row.level}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="truncate font-medium text-foreground">{row.spanName}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-muted-foreground">
                      <ExpandableText
                        collapsedClassName="line-clamp-2"
                        expandLabel={row.message.expandLabel}
                        text={row.message.content.text}
                      />
                    </td>
                    <td className="min-w-0 whitespace-nowrap px-4 py-3 align-top text-muted-foreground sm:pr-5">
                      <TraceIdCell traceId={row.trace.traceId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        ) : (
          <EmptyRows label={model.spanLogs.emptyLabel} />
        )}
      </SettingsSection>

      <SettingsSection title={model.topSpanNames.title}>
        {model.topSpanNames.rows.length > 0 ? (
          <DiagnosticsTable
            headers={model.topSpanNames.headers}
            minTableWidth="min-w-[760px]"
            columnWidths={["w-[48%]", "w-[13%]", "w-[13%]", "w-[13%]", "w-[13%]"]}
          >
            {model.topSpanNames.rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 align-top text-xs font-medium text-foreground first:sm:pl-5">
                  {row.name}
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums">
                  {row.count}
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums">
                  {row.failures}
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums">
                  {row.average}
                </td>
                <td className="whitespace-nowrap px-4 py-3 align-top font-mono tabular-nums last:sm:pr-5">
                  {row.max}
                </td>
              </tr>
            ))}
          </DiagnosticsTable>
        ) : (
          <EmptyRows label={model.topSpanNames.emptyLabel} />
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
