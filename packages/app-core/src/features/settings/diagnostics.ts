import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ServerProcessSignal } from "@t3tools/contracts";
import {
  buildDiagnosticsLastCheckedModel,
  buildDiagnosticsSettingsModel,
  DEFAULT_RESOURCE_HISTORY_WINDOW_MS,
  isProcessSignalTargetCurrent,
  resolveDiagnosticsAction,
  resolveOpenLogsDirectoryOutcome,
  resolveProcessSignalConfirmFailure,
  resolveProcessSignalOutcome,
  resolveResourceHistoryQueryInput,
  TRACE_ID_COPY_TIMEOUT_MS,
  type DiagnosticsIntent,
  type DiagnosticsLastCheckedModel,
  type DiagnosticsSettingsModel,
  type DiagnosticsToastModel,
} from "@t3tools/web/src/components/settings/DiagnosticsSettings.logic.ts";
import {
  buildResourceLastSampleModel,
  buildResourceTelemetryFailureToast,
  buildResourceTelemetryModel,
  DEFAULT_RESOURCE_HISTORY_WINDOW_MS as DEFAULT_TELEMETRY_WINDOW_MS,
  resolveResourceHistoryQuery,
  resolveResourceTelemetryChange,
  type ResourceLastSampleModel,
  type ResourceTelemetryModel,
  type ResourceTelemetryToastModel,
} from "@t3tools/web/src/components/settings/ResourceTelemetryDiagnostics.logic.ts";
import { resolveAndPersistPreferredEditor } from "@t3tools/web/src/editorPreferences.logic.ts";
import { requestConfirmDialog } from "@t3tools/web/src/confirmDialog.ts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import { clipboardService } from "../../clipboard.ts";
import type { FeatureContext } from "../../feature.ts";
import { readQuery } from "../../pullRequestShared.ts";
import type { SettingsScopeRuntime, SettingsSection } from "./scope.ts";

export type DiagnosticsSettingsView = {
  readonly telemetry: ResourceTelemetryModel;
  readonly diagnostics: DiagnosticsSettingsModel;
};

export type DiagnosticsClockView = {
  readonly lastSample: ResourceLastSampleModel;
  readonly processes: DiagnosticsLastCheckedModel;
  readonly resources: DiagnosticsLastCheckedModel;
  readonly trace: DiagnosticsLastCheckedModel;
};

type DiagnosticsUi = {
  readonly resourceWindowMs: number;
  readonly collapsedPids: ReadonlyArray<number>;
  readonly signalingPid: number | null;
  readonly isOpeningLogsDirectory: boolean;
  readonly openLogsDirectoryError: string | null;
  readonly expandedTextIds: ReadonlyArray<string>;
  readonly copiedTraceId: string | null;
  readonly telemetryWindowMs: number;
  readonly collapsedProcessKeys: ReadonlyArray<string>;
  readonly signalingProcessKeys: ReadonlyArray<string>;
  readonly isRetrying: boolean;
};

const INITIAL_UI: DiagnosticsUi = {
  resourceWindowMs: DEFAULT_RESOURCE_HISTORY_WINDOW_MS,
  collapsedPids: [],
  signalingPid: null,
  isOpeningLogsDirectory: false,
  openLogsDirectoryError: null,
  expandedTextIds: [],
  copiedTraceId: null,
  telemetryWindowMs: DEFAULT_TELEMETRY_WINDOW_MS,
  collapsedProcessKeys: [],
  signalingProcessKeys: [],
  isRetrying: false,
};

const Signal = Schema.Literals(["SIGINT", "SIGKILL"]);
const RefreshParams = Schema.decodeUnknownSync(
  Schema.Struct({ target: Schema.Literals(["processes", "resources", "trace"]) }),
);
const WindowParams = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }));
const PidParams = Schema.decodeUnknownSync(Schema.Struct({ pid: Schema.Number }));
const SignalParams = Schema.decodeUnknownSync(
  Schema.Struct({ pid: Schema.Number, signal: Signal }),
);
const TextParams = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const TraceParams = Schema.decodeUnknownSync(Schema.Struct({ traceId: Schema.String }));
const ProcessKeyParams = Schema.decodeUnknownSync(Schema.Struct({ processKey: Schema.String }));
const TelemetrySignalParams = Schema.decodeUnknownSync(
  Schema.Struct({
    processKey: Schema.String,
    pid: Schema.Number,
    startTimeMs: Schema.Number,
    signal: Signal,
  }),
);

function errorMessageOf(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}

export function createDiagnosticsSettings(
  context: FeatureContext,
  scope: SettingsScopeRuntime,
): SettingsSection {
  const { registry, state } = context;
  const uiAtom = Atom.make<DiagnosticsUi>(INITIAL_UI).pipe(Atom.keepAlive);
  const nowAtom = Atom.make(Date.now()).pipe(Atom.keepAlive);
  let tick: NodeJS.Timeout | undefined;
  let copiedTimer: NodeJS.Timeout | undefined;

  const update = (patch: Partial<DiagnosticsUi>) =>
    registry.set(uiAtom, { ...registry.get(uiAtom), ...patch });

  const environmentIdAtom = Atom.make(
    (get): EnvironmentId | null => get(scope.scopeContextAtom).environment?.environmentId ?? null,
  );
  const environmentConfig = (environmentId: EnvironmentId | null) =>
    environmentId === null
      ? null
      : (registry.get(state.environmentServerConfigsAtom).get(environmentId) ?? null);

  const traceAtom = (environmentId: EnvironmentId) =>
    state.serverEnvironment.traceDiagnostics({ environmentId, input: {} });
  const processesAtom = (environmentId: EnvironmentId) =>
    state.serverEnvironment.processDiagnostics({ environmentId, input: {} });
  const resourcesAtom = (environmentId: EnvironmentId, windowMs: number) =>
    state.serverEnvironment.processResourceHistory({
      environmentId,
      input: resolveResourceHistoryQueryInput(windowMs),
    });
  const telemetryAtom = (environmentId: EnvironmentId) =>
    state.serverEnvironment.resourceTelemetry({ environmentId, input: {} });
  const telemetryHistoryAtom = (environmentId: EnvironmentId, windowMs: number) =>
    state.serverEnvironment.resourceTelemetryHistory({
      environmentId,
      input: resolveResourceHistoryQuery(windowMs),
    });

  const queriesAtom = Atom.make((get) => {
    const environmentId = get(environmentIdAtom);
    const ui = get(uiAtom);
    return {
      environmentId,
      processes: readQuery(get, environmentId === null ? null : processesAtom(environmentId)),
      resources: readQuery(
        get,
        environmentId === null ? null : resourcesAtom(environmentId, ui.resourceWindowMs),
      ),
      trace: readQuery(get, environmentId === null ? null : traceAtom(environmentId)),
      telemetry: readQuery(get, environmentId === null ? null : telemetryAtom(environmentId)),
      telemetryHistory: readQuery(
        get,
        environmentId === null ? null : telemetryHistoryAtom(environmentId, ui.telemetryWindowMs),
      ),
    };
  });

  const viewAtom = Atom.make((get): DiagnosticsSettingsView | null => {
    if (get(scope.sectionAtom) !== "diagnostics") return null;
    const ui = get(uiAtom);
    const queries = get(queriesAtom);
    const environmentId = queries.environmentId;
    const serverConfig =
      environmentId === null
        ? null
        : (get(state.environmentServerConfigsAtom).get(environmentId) ?? null);
    return {
      telemetry: buildResourceTelemetryModel({
        snapshot: queries.telemetry.data,
        snapshotError: queries.telemetry.error,
        snapshotPending: environmentId !== null && queries.telemetry.isPending,
        history: queries.telemetryHistory.data,
        historyError: queries.telemetryHistory.error,
        historyPending: environmentId !== null && queries.telemetryHistory.isPending,
        selectedWindowMs: ui.telemetryWindowMs,
        collapsedProcessKeys: ui.collapsedProcessKeys,
        signalingProcessKeys: ui.signalingProcessKeys,
        isRetrying: ui.isRetrying,
      }),
      diagnostics: buildDiagnosticsSettingsModel({
        nowMs: Date.now(),
        processes: {
          data: queries.processes.data,
          error: queries.processes.error,
          isPending: environmentId !== null && queries.processes.isPending,
        },
        resources: {
          data: queries.resources.data,
          error: queries.resources.error,
          isPending: environmentId !== null && queries.resources.isPending,
        },
        trace: {
          data: queries.trace.data,
          error: queries.trace.error,
          isPending: environmentId !== null && queries.trace.isPending,
        },
        resourceWindowMs: ui.resourceWindowMs,
        collapsedPids: ui.collapsedPids,
        signalingPid: ui.signalingPid,
        logsDirectoryPath: serverConfig?.observability?.logsDirectoryPath ?? null,
        isOpeningLogsDirectory: ui.isOpeningLogsDirectory,
        openLogsDirectoryError: ui.openLogsDirectoryError,
        expandedTextIds: ui.expandedTextIds,
        copiedTraceId: ui.copiedTraceId,
      }),
    };
  });

  const clockAtom = Atom.make((get): DiagnosticsClockView | null => {
    if (get(scope.sectionAtom) !== "diagnostics") return null;
    const nowMs = get(nowAtom);
    const queries = get(queriesAtom);
    const telemetry = queries.telemetry.data;
    return {
      lastSample: buildResourceLastSampleModel({
        sampledAtIso: telemetry === null ? null : DateTime.formatIso(telemetry.readAt),
        nowMs,
      }),
      processes: buildDiagnosticsLastCheckedModel({
        checkedAt: queries.processes.data?.readAt ?? null,
        nowMs,
      }),
      resources: buildDiagnosticsLastCheckedModel({
        checkedAt: queries.resources.data?.readAt ?? null,
        nowMs,
      }),
      trace: buildDiagnosticsLastCheckedModel({
        checkedAt: queries.trace.data?.readAt ?? null,
        nowMs,
      }),
    };
  });

  registry.subscribe(scope.sectionAtom, (section) => {
    if (section === "diagnostics") {
      if (tick === undefined) {
        registry.set(nowAtom, Date.now());
        tick = setInterval(() => registry.set(nowAtom, Date.now()), 1_000);
      }
      return;
    }
    clearInterval(tick);
    tick = undefined;
  });

  const toast = (model: DiagnosticsToastModel) =>
    context.addToast({
      layout: "plain",
      type: model.type,
      title: model.title,
      description: model.description,
    });
  const telemetryToast = (model: ResourceTelemetryToastModel) =>
    context.addToast({ layout: "plain", type: "error", ...model });

  const confirm = (message: string) =>
    requestConfirmDialog(message, { variant: "destructive" }) ??
    Promise.reject(new Error("Confirmations are not available in the native app yet."));

  const handle = (intent: DiagnosticsIntent) => {
    const ui = registry.get(uiAtom);
    const queries = registry.get(queriesAtom);
    const environmentId = queries.environmentId;
    const decision = resolveDiagnosticsAction(intent, {
      environmentId,
      logsDirectoryPath: environmentConfig(environmentId)?.observability?.logsDirectoryPath ?? null,
      processes: queries.processes.data?.processes ?? [],
      signalingPid: ui.signalingPid,
      collapsedPids: ui.collapsedPids,
    });
    switch (decision.kind) {
      case "none":
        return;
      case "refresh":
        if (environmentId === null) return;
        if (decision.target === "processes") registry.refresh(processesAtom(environmentId));
        else if (decision.target === "resources")
          registry.refresh(resourcesAtom(environmentId, ui.resourceWindowMs));
        else registry.refresh(traceAtom(environmentId));
        return;
      case "set-resource-window":
        update({ resourceWindowMs: decision.windowMs });
        return;
      case "set-collapsed-pids":
        update({ collapsedPids: decision.collapsedPids });
        return;
      case "show-open-logs-directory-error":
        update({ openLogsDirectoryError: decision.message });
        return;
      case "open-logs-directory":
        update({ isOpeningLogsDirectory: true, openLogsDirectoryError: null });
        void (async () => {
          const result = await runAtomCommand(
            registry,
            state.shellEnvironment.openInEditor,
            {
              environmentId: decision.environmentId,
              input: { cwd: decision.cwd, editor: decision.editor },
            },
            { reportFailure: false },
          );
          update({ isOpeningLogsDirectory: false });
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
          if (outcome.kind === "show-error") update({ openLogsDirectoryError: outcome.message });
        })();
        return;
      case "signal-process": {
        const { environmentId: targetEnvironmentId, pid, signal, startTimeMs } = decision;
        update({ signalingPid: pid });
        const clearSignaling = () => update({ signalingPid: null });
        void (async () => {
          if (decision.confirmation) {
            let confirmed = false;
            try {
              confirmed = await confirm(decision.confirmation.message);
            } catch (error) {
              clearSignaling();
              toast(resolveProcessSignalConfirmFailure(signal, errorMessageOf(error)));
              return;
            }
            if (!confirmed) {
              clearSignaling();
              return;
            }
          }
          const current = registry.get(queriesAtom);
          if (
            !isProcessSignalTargetCurrent({
              targetEnvironmentId,
              environmentId: current.environmentId,
              pid,
              startTimeMs,
              processes: current.processes.data?.processes ?? [],
            })
          ) {
            clearSignaling();
            return;
          }
          try {
            const result = await runAtomCommand(
              registry,
              state.serverEnvironment.signalProcess,
              { environmentId: targetEnvironmentId, input: { pid, startTimeMs, signal } },
              { reportFailure: false },
            );
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
            if (outcome.refreshProcesses) registry.refresh(processesAtom(targetEnvironmentId));
            if (outcome.toast) toast(outcome.toast);
          } finally {
            clearSignaling();
          }
        })();
        return;
      }
    }
  };

  const signalTelemetryProcess = async (input: {
    readonly processKey: string;
    readonly pid: number;
    readonly startTimeMs: number;
    readonly signal: ServerProcessSignal;
  }) => {
    const targetEnvironmentId = registry.get(environmentIdAtom);
    const change = resolveResourceTelemetryChange({
      kind: "signal-process",
      processKey: input.processKey,
      pid: input.pid,
      signal: input.signal,
      signalingProcessKeys: registry.get(uiAtom).signalingProcessKeys,
      hasEnvironment: targetEnvironmentId !== null,
    });
    if (change.kind !== "send-signal" || targetEnvironmentId === null) return;
    update({
      signalingProcessKeys: [...registry.get(uiAtom).signalingProcessKeys, input.processKey],
    });
    const clearSignaling = () =>
      update({
        signalingProcessKeys: registry
          .get(uiAtom)
          .signalingProcessKeys.filter((key) => key !== input.processKey),
      });
    if (change.confirmMessage !== null) {
      let confirmed = false;
      try {
        confirmed = await confirm(change.confirmMessage);
      } catch (error) {
        clearSignaling();
        telemetryToast(
          buildResourceTelemetryFailureToast({
            kind: "confirm-failed",
            signal: input.signal,
            errorMessage: errorMessageOf(error),
          }),
        );
        return;
      }
      if (!confirmed) {
        clearSignaling();
        return;
      }
    }
    if (registry.get(environmentIdAtom) !== targetEnvironmentId) {
      clearSignaling();
      return;
    }
    try {
      const result = await runAtomCommand(
        registry,
        state.serverEnvironment.signalProcess,
        {
          environmentId: targetEnvironmentId,
          input: { pid: input.pid, startTimeMs: input.startTimeMs, signal: input.signal },
        },
        { reportFailure: false },
      );
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        throw squashAtomCommandFailure(result);
      }
      if (result.value.signaled) return;
      telemetryToast(
        buildResourceTelemetryFailureToast({
          kind: "signal-rejected",
          signal: input.signal,
          pid: input.pid,
          message: Option.getOrNull(result.value.message),
        }),
      );
    } catch (error) {
      telemetryToast(
        buildResourceTelemetryFailureToast({
          kind: "signal-failed",
          signal: input.signal,
          errorMessage: errorMessageOf(error),
        }),
      );
    } finally {
      clearSignaling();
    }
  };

  return {
    views: { settingsDiagnostics: viewAtom, settingsDiagnosticsClock: clockAtom },
    actions: {
      settingsDiagnosticsMount: async () => {
        registry.set(uiAtom, INITIAL_UI);
        return null;
      },
      settingsDiagnosticsRefresh: async (params) => {
        handle({ kind: "refresh", target: RefreshParams(params).target });
        return null;
      },
      settingsDiagnosticsWindow: async (params) => {
        handle({ kind: "select-resource-window", value: WindowParams(params).value });
        return null;
      },
      settingsDiagnosticsToggleProcess: async (params) => {
        handle({ kind: "toggle-process", pid: PidParams(params).pid });
        return null;
      },
      settingsDiagnosticsSignal: async (params) => {
        const { pid, signal } = SignalParams(params);
        handle({ kind: "signal-process", pid, signal });
        return null;
      },
      settingsDiagnosticsOpenLogs: async () => {
        const config = environmentConfig(registry.get(environmentIdAtom));
        handle({
          kind: "open-logs-directory",
          editor: resolveAndPersistPreferredEditor(config?.availableEditors ?? []),
        });
        return null;
      },
      settingsDiagnosticsToggleText: async (params) => {
        const { id } = TextParams(params);
        const current = registry.get(uiAtom).expandedTextIds;
        update({
          expandedTextIds: current.includes(id)
            ? current.filter((entry) => entry !== id)
            : [...current, id],
        });
        return null;
      },
      settingsDiagnosticsCopyTrace: async (params) => {
        const { traceId } = TraceParams(params);
        await clipboardService(context).writeText(traceId);
        update({ copiedTraceId: traceId });
        clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => update({ copiedTraceId: null }), TRACE_ID_COPY_TIMEOUT_MS);
        return null;
      },
      settingsTelemetryRefresh: async () => {
        const environmentId = registry.get(environmentIdAtom);
        if (environmentId !== null) registry.refresh(telemetryAtom(environmentId));
        return null;
      },
      settingsTelemetryHistoryRefresh: async () => {
        const environmentId = registry.get(environmentIdAtom);
        if (environmentId !== null)
          registry.refresh(
            telemetryHistoryAtom(environmentId, registry.get(uiAtom).telemetryWindowMs),
          );
        return null;
      },
      settingsTelemetryWindow: async (params) => {
        const change = resolveResourceTelemetryChange({
          kind: "select-window",
          value: WindowParams(params).value,
        });
        if (change.kind === "set-window") update({ telemetryWindowMs: change.windowMs });
        return null;
      },
      settingsTelemetryToggleProcess: async (params) => {
        const change = resolveResourceTelemetryChange({
          kind: "toggle-process",
          processKey: ProcessKeyParams(params).processKey,
          collapsedProcessKeys: registry.get(uiAtom).collapsedProcessKeys,
        });
        if (change.kind === "set-collapsed")
          update({ collapsedProcessKeys: change.collapsedProcessKeys });
        return null;
      },
      settingsTelemetrySignal: async (params) => {
        await signalTelemetryProcess(TelemetrySignalParams(params));
        return null;
      },
      settingsTelemetryRetry: async () => {
        const environmentId = registry.get(environmentIdAtom);
        update({ isRetrying: true });
        try {
          if (environmentId === null) throw new Error("No environment is selected.");
          const result = await runAtomCommand(
            registry,
            state.serverEnvironment.retryResourceTelemetry,
            { environmentId, input: {} },
            { reportFailure: false },
          );
          if (result._tag === "Failure") throw Cause.squash(result.cause);
        } catch (error) {
          telemetryToast(
            buildResourceTelemetryFailureToast({
              kind: "retry-failed",
              errorMessage: errorMessageOf(error),
            }),
          );
        } finally {
          update({ isRetrying: false });
        }
        return null;
      },
    },
  };
}
