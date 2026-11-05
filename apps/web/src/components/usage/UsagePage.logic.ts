import {
  USAGE_CONTRACT_VERSION,
  type EnvironmentId,
  type KeybindingCommand,
  type ResolvedKeybindingsConfig,
  type ServerProvider,
  type UsageLimitSourceSnapshots,
  type UsageProviderKind,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { cursorKeychainAccessEnvironments } from "@t3tools/client-runtime/state/usage";
import {
  enumerateDays,
  enumerateHourStarts,
  formatCount,
  formatDateTimeShort,
  formatDayShort,
  formatHourShort,
  formatPercent,
  formatTokens,
  formatUsageContractMismatch,
  formatUsd,
  makeWindow,
} from "@t3tools/shared/usageFormat";
import { usesChatGptSharing } from "@t3tools/shared/usageLimits";
import {
  isCompatibleUsageContractVersion,
  isModelCostUnknown,
  type DailyTotals,
  type HourlyTotals,
  type MergedUsage,
} from "@t3tools/shared/usageMerge";

import { shortcutLabelForCommand } from "../../keybindings";
import type { EnvironmentUsageStatus } from "../../state/usage.logic";
import { sortModelsByTokens } from "./usageBreakdown";
import type { UsagePagePreferences } from "./usagePagePreferences";
import {
  buildUsageProviderChartModel,
  usageChartTitle,
  type UsageProviderChartModel,
} from "./UsageProviderChart.logic";
import { buildUsageLimitsModel, type UsageLimitsModel } from "./UsageLimits.logic";
import { PROVIDER_ORDER, USAGE_PROVIDER_STYLES, providersWithUsage } from "./usageProviders.logic";
import { METRIC_OPTIONS, WINDOW_OPTIONS, type UsageMetric } from "./usageShortcuts";

export type UsageWindowDays = UsagePagePreferences["windowDays"];
export type UsageBreakdown = "model" | "time";

export type UsagePagePresentation = {
  readonly entry: { readonly target: { readonly label: string } };
  readonly connection: { readonly phase: string };
  readonly serverConfig: {
    readonly providers?: readonly ServerProvider[] | undefined;
    readonly usageLimitSources?: UsageLimitSourceSnapshots | undefined;
  } | null;
};

export type UsagePagePresentations = ReadonlyMap<EnvironmentId, UsagePagePresentation>;

export type UsagePageInput = {
  readonly metric: UsageMetric;
  readonly windowDays: UsageWindowDays;
  readonly window: UsageSummaryInput;
  readonly breakdown: UsageBreakdown;
  readonly isRefreshing: boolean;
  readonly merged: MergedUsage;
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly selectedEnvironments: readonly EnvironmentUsageStatus[];
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly isPending: boolean;
  readonly isPartial: boolean;
  readonly presentations: UsagePagePresentations;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly limitsNowMs: number;
  readonly timestampFormat: TimestampFormat;
};

export type UsageOptionModel<T> = {
  readonly value: T;
  readonly key: string;
  readonly label: string;
  readonly title: string;
  readonly selected: boolean;
};

export type UsageEnvironmentIndicator =
  | { readonly kind: "scanning"; readonly srLabel: string }
  | { readonly kind: "issue"; readonly ariaLabel: string }
  | { readonly kind: "chevron" };

export type UsageEnvironmentFilterItem = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly checked: boolean;
  readonly status: string | null;
  readonly statusTone: "muted" | "error";
};

export type UsageEnvironmentFilterModel = {
  readonly label: string;
  readonly indicator: UsageEnvironmentIndicator;
  readonly allSelected: boolean;
  readonly allLabel: string;
  readonly items: readonly UsageEnvironmentFilterItem[];
  readonly emptyMessage: string | null;
  readonly partialMessage: string | null;
  readonly coverageNotices: readonly string[];
  readonly modelPricesLabel: string;
};

export type UsageSummaryRowModel =
  | {
      readonly kind: "usage";
      readonly key: string;
      readonly provider: UsageProviderKind;
      readonly label: string;
      readonly color: string;
      readonly sessionLabel: string;
      readonly valueLabel: string;
      readonly detailLabel: string;
    }
  | {
      readonly kind: "enable";
      readonly key: string;
      readonly environmentId: EnvironmentId;
      readonly environmentLabel: string;
      readonly label: string;
      readonly color: string;
      readonly button: UsageCursorEnableButtonModel;
    };

export type UsageCursorEnableButtonModel = {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly text: string;
  readonly ariaLabel: string;
  readonly tooltip: string | null;
};

export type UsageCursorPromptModel = {
  readonly title: string;
  readonly copy: string;
  readonly buttons: readonly UsageCursorEnableButtonModel[];
};

export type UsageMetricModel = {
  readonly label: string;
  readonly value: string;
};

export type UsageModelBreakdownRow = {
  readonly key: string;
  readonly provider: UsageProviderKind;
  readonly model: string;
  readonly costLabel: string;
  readonly costUnknown: boolean;
  readonly shareLabel: string;
  readonly tokensLabel: string;
};

export type UsageTimeBreakdownRow = {
  readonly key: string;
  readonly periodLabel: string;
  readonly providerCosts: readonly {
    readonly provider: UsageProviderKind;
    readonly label: string;
  }[];
  readonly totalLabel: string;
  readonly tokensLabel: string;
};

export type UsageBreakdownModel = {
  readonly title: string;
  readonly selected: UsageBreakdown;
  readonly options: readonly { readonly value: UsageBreakdown; readonly label: string }[];
  readonly emptyMessage: string;
  readonly model: {
    readonly headings: readonly string[];
    readonly rows: readonly UsageModelBreakdownRow[];
  };
  readonly time: {
    readonly periodHeading: string;
    readonly providerColumns: readonly {
      readonly provider: UsageProviderKind;
      readonly label: string;
    }[];
    readonly totalHeading: string;
    readonly tokensHeading: string;
    readonly valueColumnWidth: string;
    readonly columnCount: number;
    readonly rows: readonly UsageTimeBreakdownRow[];
  };
};

export type UsageContentModel =
  | { readonly kind: "no-environment"; readonly message: string }
  | {
      readonly kind: "limits";
      readonly limits: UsageLimitsModel;
      readonly cursorPrompt: UsageCursorPromptModel | null;
    }
  | {
      readonly kind: "loading";
      readonly providers: readonly UsageProviderKind[];
      readonly totalsTitle: string;
      readonly totalLabels: readonly string[];
      readonly breakdownTitle: string;
    }
  | {
      readonly kind: "usage";
      readonly sourceMessages: readonly string[];
      readonly headline: {
        readonly value: string;
        readonly sessionsLabel: string;
        readonly estimateNote: string | null;
        readonly unpriced: {
          readonly ariaLabel: string;
          readonly message: string;
        } | null;
      };
      readonly chatGptSharing: { readonly label: string } | null;
      readonly summaryRows: readonly UsageSummaryRowModel[];
      readonly showEnvironmentInRows: boolean;
      readonly chartTitle: string;
      readonly chart: UsageProviderChartModel;
      readonly totalsTitle: string;
      readonly totals: readonly UsageMetricModel[];
      readonly breakdown: UsageBreakdownModel;
    };

export type UsagePageModel = {
  readonly title: string;
  readonly breadcrumbLabel: string;
  readonly showingLimits: boolean;
  readonly environmentFilter: UsageEnvironmentFilterModel;
  readonly windowLabel: string | null;
  readonly metric: {
    readonly ariaLabel: string;
    readonly value: UsageMetric;
    readonly label: string;
    readonly options: readonly UsageOptionModel<UsageMetric>[];
  };
  readonly period: {
    readonly ariaLabel: string;
    readonly value: string;
    readonly label: string;
    readonly disabled: boolean;
    readonly options: readonly UsageOptionModel<UsageWindowDays>[];
  };
  readonly refresh: {
    readonly ariaLabel: string;
    readonly busy: boolean;
    readonly disabled: boolean;
    readonly icon: "refresh";
  };
  readonly content: UsageContentModel;
};

export const CURSOR_KEYCHAIN_COPY = "Requires access to your Cursor login in macOS Keychain.";
const TOTAL_LABELS = [
  "Processed tokens",
  "Cached input",
  "Uncached input",
  "Output",
  "Cache savings",
];

export function isUsageMetric(value: string | null | undefined): value is UsageMetric {
  return METRIC_OPTIONS.some((option) => option.value === value);
}

export function isUsageWindowDays(value: number): value is UsageWindowDays {
  return WINDOW_OPTIONS.some((option) => option.days === value);
}

export function makeUsageWindow(days: number, nowMs: number): UsageSummaryInput {
  return makeWindow(days, new Date(nowMs), days === 1 ? "hour" : "day");
}

function shortcutTitle(
  keybindings: ResolvedKeybindingsConfig,
  option: { readonly label: string; readonly command: KeybindingCommand },
): string {
  const shortcut = shortcutLabelForCommand(keybindings, option.command, {
    context: { usagePageOpen: true },
  });
  return shortcut ? `${option.label} (${shortcut})` : option.label;
}

/** Connected, configured environments inside the selection, which are the ones limits refresh. */
export function resolveLimitsRefreshTargets(
  presentations: UsagePagePresentations,
  selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null,
): readonly EnvironmentId[] {
  return [...presentations]
    .filter(
      ([environmentId, presentation]) =>
        presentation.connection.phase === "connected" &&
        presentation.serverConfig !== null &&
        (selectedEnvironmentIds === null || selectedEnvironmentIds.has(environmentId)),
    )
    .map(([environmentId]) => environmentId)
    .sort();
}

export function resolveEnvironmentSelection(input: {
  readonly environmentIds: readonly EnvironmentId[];
  readonly selectedIds: ReadonlySet<EnvironmentId> | null;
  readonly environmentId: EnvironmentId;
  readonly checked: boolean;
}): ReadonlySet<EnvironmentId> | null {
  const next = new Set(
    input.environmentIds.filter((id) => input.selectedIds === null || input.selectedIds.has(id)),
  );
  if (input.checked) next.add(input.environmentId);
  else next.delete(input.environmentId);
  return next.size === input.environmentIds.length ? null : next;
}

export type UsageMetricSelection = {
  readonly preferences: UsagePagePreferences;
  readonly resetLimitsClock: boolean;
};

export function resolveMetricSelection(
  metric: UsageMetric,
  windowDays: UsageWindowDays,
): UsageMetricSelection {
  return { preferences: { metric, windowDays }, resetLimitsClock: metric === "limits" };
}

export type UsageWindowSelection =
  | { readonly kind: "ignore" }
  | {
      readonly kind: "select";
      readonly preferences: UsagePagePreferences;
      readonly days: UsageWindowDays;
      readonly window: UsageSummaryInput;
    };

export function resolveWindowSelection(
  days: number,
  metric: UsageMetric,
  nowMs: number,
): UsageWindowSelection {
  if (!isUsageWindowDays(days)) return { kind: "ignore" };
  return {
    kind: "select",
    preferences: { metric, windowDays: days },
    days,
    window: makeUsageWindow(days, nowMs),
  };
}

export type UsageShortcutAction =
  | { readonly kind: "ignore" }
  | {
      readonly kind: "apply";
      readonly metric: UsageMetric | null;
      readonly windowDays: UsageWindowDays | null;
    };

export function resolveUsageShortcutAction(input: {
  readonly defaultPrevented: boolean;
  readonly repeat: boolean;
  readonly isComposing: boolean;
  readonly overlayOpen: boolean;
  readonly command: KeybindingCommand | null;
  readonly showingLimits: boolean;
}): UsageShortcutAction {
  if (input.defaultPrevented || input.repeat || input.isComposing || input.overlayOpen)
    return { kind: "ignore" };
  const metricOption = METRIC_OPTIONS.find((option) => option.command === input.command);
  const periodOption = WINDOW_OPTIONS.find((option) => option.command === input.command);
  if (!metricOption && !periodOption) return { kind: "ignore" };
  return {
    kind: "apply",
    metric: metricOption ? metricOption.value : null,
    windowDays: periodOption && !input.showingLimits ? periodOption.days : null,
  };
}

export type UsageRefreshAction =
  | { readonly kind: "ignore" }
  | { readonly kind: "limits" }
  | {
      readonly kind: "usage";
      readonly window: UsageSummaryInput;
      readonly windowChanged: boolean;
    };

export function resolveUsageRefresh(input: {
  readonly refreshing: boolean;
  readonly showingLimits: boolean;
  readonly windowDays: UsageWindowDays;
  readonly window: UsageSummaryInput;
  readonly nowMs: number;
}): UsageRefreshAction {
  if (input.refreshing) return { kind: "ignore" };
  if (input.showingLimits) return { kind: "limits" };
  const next = makeUsageWindow(input.windowDays, input.nowMs);
  return {
    kind: "usage",
    window: next,
    windowChanged:
      next.sinceDay !== input.window.sinceDay ||
      next.untilDay !== input.window.untilDay ||
      next.sinceTime !== input.window.sinceTime ||
      next.untilTime !== input.window.untilTime,
  };
}

export function buildCursorEnableButtonModel(
  environment: Pick<EnvironmentUsageStatus, "environmentId" | "label">,
  text: string,
  tooltip: boolean,
): UsageCursorEnableButtonModel {
  return {
    environmentId: environment.environmentId,
    environmentLabel: environment.label,
    text,
    ariaLabel: `Enable Cursor usage from ${environment.label}`,
    tooltip: tooltip ? CURSOR_KEYCHAIN_COPY : null,
  };
}

function environmentStatus(environment: EnvironmentUsageStatus): string {
  if (environment.error !== null) return "Unavailable";
  if (
    environment.summary !== null &&
    !isCompatibleUsageContractVersion(environment.summary.contractVersion, USAGE_CONTRACT_VERSION)
  )
    return "Update required";
  if (environment.summary === null) return "Scanning…";
  return environment.isPending ? "Refreshing…" : "Ready";
}

/**
 * Explains failed or incompatible environments and deduplicated transcripts.
 * Shown inside the environment filter so arriving results do not move the page.
 */
function coverageNotices(
  environments: readonly EnvironmentUsageStatus[],
  duplicateSources: readonly string[],
  contractMismatches: MergedUsage["contractMismatches"],
): readonly string[] {
  const mismatchByEnvironment = new Map(
    contractMismatches.map((mismatch) => [mismatch.environmentId, mismatch]),
  );
  return [
    ...environments
      .filter((environment) => environment.error !== null)
      .map((environment) => `${environment.label} could not report usage.`),
    ...environments.flatMap((environment) => {
      const mismatch = mismatchByEnvironment.get(environment.environmentId);
      return mismatch === undefined
        ? []
        : [formatUsageContractMismatch(environment.label, mismatch)];
    }),
    ...(duplicateSources.length > 0
      ? [
          `Counted once across environments sharing a transcript directory: ${duplicateSources.join(", ")}`,
        ]
      : []),
  ];
}

export function buildUsageEnvironmentFilterModel(input: {
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly selectedEnvironments: readonly EnvironmentUsageStatus[];
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly showUsageStatus: boolean;
  readonly isPartial: boolean;
  readonly duplicateSources: readonly string[];
  readonly contractMismatches: MergedUsage["contractMismatches"];
}): UsageEnvironmentFilterModel {
  const allSelected = input.selectedEnvironmentIds === null;
  const onlySelected = input.selectedEnvironments[0];
  const pendingCount = input.selectedEnvironments.filter(
    (environment) =>
      environment.error === null && (environment.isPending || environment.summary === null),
  ).length;
  const hasIssue =
    input.selectedEnvironments.some((environment) => environment.error !== null) ||
    input.contractMismatches.length > 0;
  return {
    label: allSelected
      ? "All environments"
      : input.selectedEnvironments.length === 1 && onlySelected
        ? onlySelected.label
        : `${input.selectedEnvironments.length} environments`,
    indicator:
      input.showUsageStatus && pendingCount > 0
        ? {
            kind: "scanning",
            srLabel: `${pendingCount} ${pendingCount === 1 ? "environment" : "environments"} still scanning${input.isPartial ? "; totals are partial" : ""}`,
          }
        : input.showUsageStatus && hasIssue
          ? { kind: "issue", ariaLabel: "Some environments could not report usage" }
          : { kind: "chevron" },
    allSelected,
    allLabel: "All environments",
    items: input.environments.map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.label,
      checked:
        input.selectedEnvironmentIds === null ||
        input.selectedEnvironmentIds.has(environment.environmentId),
      status: input.showUsageStatus ? environmentStatus(environment) : null,
      statusTone: environment.error !== null ? "error" : "muted",
    })),
    emptyMessage: input.environments.length === 0 ? "No environments connected." : null,
    partialMessage:
      input.showUsageStatus && input.isPartial
        ? "Totals are partial while selected environments scan."
        : null,
    coverageNotices: input.showUsageStatus
      ? coverageNotices(
          input.selectedEnvironments,
          input.duplicateSources,
          input.contractMismatches,
        )
      : [],
    modelPricesLabel: "Model prices",
  };
}

function sourceMessagesOf(environments: readonly EnvironmentUsageStatus[]): readonly string[] {
  return [
    ...new Set(
      environments.flatMap(
        (environment) =>
          environment.summary?.sources.flatMap((source) =>
            source.message &&
            !source.action &&
            (source.status === "partial" ||
              source.status === "failed" ||
              source.fingerprint.provider === "cursor")
              ? [source.message]
              : [],
          ) ?? [],
      ),
    ),
  ];
}

function buildBreakdownModel(
  input: UsagePageInput,
  activeProviders: readonly UsageProviderKind[],
): UsageBreakdownModel {
  const { merged, metric, breakdown, window } = input;
  const isPast24Hours = input.windowDays === 1;
  const models =
    breakdown === "model" && metric === "tokens"
      ? sortModelsByTokens(merged.models)
      : merged.models;
  // Newest first: the window can run 90 periods, so the interesting end
  // belongs at the top of the table.
  const periods: readonly (DailyTotals | HourlyTotals)[] = (
    isPast24Hours ? merged.hourly : merged.daily
  ).toReversed();
  return {
    title: "Breakdown",
    selected: breakdown,
    options: [
      { value: "model", label: "Model" },
      { value: "time", label: isPast24Hours ? "Hour" : "Day" },
    ],
    emptyMessage: "No activity in this window.",
    model: {
      headings: ["Model", "Cost", "Share", "Tokens"],
      rows: models.map((model) => ({
        key: `${model.provider}:${model.model}`,
        provider: model.provider,
        model: model.model,
        costUnknown: isModelCostUnknown(model),
        costLabel: isModelCostUnknown(model) ? "Unpriced" : formatUsd(model.costUsd),
        shareLabel: isModelCostUnknown(model) ? "—" : formatPercent(model.costShare),
        tokensLabel: formatTokens(model.totalTokens),
      })),
    },
    time: {
      periodHeading: isPast24Hours ? "Hour" : "Day",
      providerColumns: activeProviders.map((provider) => ({
        provider,
        label: USAGE_PROVIDER_STYLES[provider].label,
      })),
      totalHeading: "Total",
      tokensHeading: "Tokens",
      valueColumnWidth: `${60 / (activeProviders.length + 2)}%`,
      columnCount: activeProviders.length + 3,
      rows: periods.map((period) => ({
        key: "hourStart" in period ? period.hourStart : period.day,
        periodLabel:
          "hourStart" in period
            ? formatHourShort(period.hourStart, window.timeZone)
            : formatDayShort(period.day),
        providerCosts: activeProviders.map((provider) => ({
          provider,
          label: formatUsd(period.byProvider.get(provider)?.costUsd ?? 0),
        })),
        totalLabel: formatUsd(period.costUsd),
        tokensLabel: formatTokens(period.totalTokens),
      })),
    },
  };
}

function buildSummaryRows(
  input: UsagePageInput,
  activeProviders: readonly UsageProviderKind[],
  cursorAccessEnvironments: readonly EnvironmentUsageStatus[],
): readonly UsageSummaryRowModel[] {
  const { merged, metric } = input;
  const rows: UsageSummaryRowModel[] = activeProviders.map((provider) => {
    const totals = merged.providers.find((entry) => entry.provider === provider);
    const share = metric === "cost" ? (totals?.costShare ?? 0) : (totals?.tokenShare ?? 0);
    const sessions = totals?.sessions ?? 0;
    return {
      kind: "usage",
      key: provider,
      provider,
      label: USAGE_PROVIDER_STYLES[provider].label,
      color: USAGE_PROVIDER_STYLES[provider].color,
      sessionLabel: `${formatCount(sessions)} ${sessions === 1 ? "session" : "sessions"}`,
      valueLabel:
        metric === "cost"
          ? formatUsd(totals?.costUsd ?? 0)
          : formatTokens(totals?.totalTokens ?? 0),
      detailLabel:
        metric === "cost"
          ? `${formatPercent(share)} of cost · ${formatTokens(totals?.totalTokens ?? 0)} tokens`
          : `${formatPercent(share)} of tokens · ${formatUsd(totals?.costUsd ?? 0)}`,
    };
  });
  const showEnvironment = input.selectedEnvironments.length > 1;
  rows.splice(
    Math.max(activeProviders.indexOf("codex"), activeProviders.indexOf("claude")) + 1,
    0,
    ...cursorAccessEnvironments.map((environment): UsageSummaryRowModel => ({
      kind: "enable",
      key: `enable:${environment.environmentId}`,
      environmentId: environment.environmentId,
      environmentLabel: environment.label,
      label: `Cursor${showEnvironment ? ` · ${environment.label}` : ""}`,
      color: USAGE_PROVIDER_STYLES.cursor.color,
      button: buildCursorEnableButtonModel(environment, "Enable", true),
    })),
  );
  return rows;
}

function buildContent(input: UsagePageInput): UsageContentModel {
  const showingLimits = input.metric === "limits";
  const subject = showingLimits ? "limits" : "usage";
  if (input.selectedEnvironments.length === 0) {
    return {
      kind: "no-environment",
      message:
        input.environments.length === 0
          ? `Connect an environment to see ${subject}.`
          : `Select an environment to see ${subject}.`,
    };
  }
  const cursorAccessEnvironments = cursorKeychainAccessEnvironments(input.selectedEnvironments);
  if (showingLimits) {
    return {
      kind: "limits",
      limits: buildUsageLimitsModel({
        presentations: input.presentations,
        selectedEnvironmentIds: input.selectedEnvironmentIds,
        nowMs: input.limitsNowMs,
        timestampFormat: input.timestampFormat,
        hasCursorPrompt: cursorAccessEnvironments.length > 0,
      }),
      cursorPrompt:
        cursorAccessEnvironments.length > 0
          ? {
              title: "Cursor",
              copy: CURSOR_KEYCHAIN_COPY,
              buttons: cursorAccessEnvironments.map((environment) =>
                buildCursorEnableButtonModel(
                  environment,
                  cursorAccessEnvironments.length > 1 ? `Enable on ${environment.label}` : "Enable",
                  false,
                ),
              ),
            }
          : null,
    };
  }
  if (input.isPending) {
    return {
      kind: "loading",
      providers: PROVIDER_ORDER,
      totalsTitle: "Totals",
      totalLabels: TOTAL_LABELS,
      breakdownTitle: "Breakdown",
    };
  }
  const { merged, metric, window } = input;
  const chartMetric = metric === "cost" ? "cost" : "tokens";
  const resolution = input.windowDays === 1 ? "hour" : "day";
  const activeProviders = providersWithUsage(merged.providers);
  return {
    kind: "usage",
    sourceMessages: sourceMessagesOf(input.selectedEnvironments),
    headline: {
      value: metric === "cost" ? formatUsd(merged.costUsd) : formatTokens(merged.totalTokens),
      sessionsLabel: `${formatCount(merged.sessions)} sessions`,
      estimateNote: metric === "cost" ? " · API estimate" : null,
      unpriced:
        metric === "cost" && merged.costQuality.unpricedShare > 0
          ? {
              ariaLabel: "Unpriced usage details",
              message: `API estimate excludes ${formatPercent(merged.costQuality.unpricedShare)} unpriced records.`,
            }
          : null,
    },
    chatGptSharing: [...input.presentations].some(
      ([id, presentation]) =>
        (input.selectedEnvironmentIds === null || input.selectedEnvironmentIds.has(id)) &&
        presentation.serverConfig?.providers?.some(usesChatGptSharing),
    )
      ? { label: "ChatGPT shared usage" }
      : null,
    summaryRows: buildSummaryRows(input, activeProviders, cursorAccessEnvironments),
    showEnvironmentInRows: input.selectedEnvironments.length > 1,
    chartTitle: usageChartTitle(chartMetric, resolution),
    chart: buildUsageProviderChartModel({
      providers: activeProviders,
      days: enumerateDays(window.sinceDay, window.untilDay),
      daily: merged.daily,
      hours:
        window.sinceTime === undefined || window.untilTime === undefined
          ? []
          : enumerateHourStarts(window.sinceTime, window.untilTime),
      hourly: merged.hourly,
      metric: chartMetric,
      referenceTime: window.untilTime,
      resolution,
      timeZone: window.timeZone,
    }),
    totalsTitle: "Totals",
    totals: [
      { label: "Processed tokens", value: formatTokens(merged.totalTokens) },
      { label: "Cached input", value: formatTokens(merged.cachedInputTokens) },
      { label: "Uncached input", value: formatTokens(merged.uncachedInputTokens) },
      { label: "Output", value: formatTokens(merged.outputTokens) },
      { label: "Cache savings", value: formatUsd(merged.costQuality.cacheSavingsUsd) },
    ],
    breakdown: buildBreakdownModel(input, activeProviders),
  };
}

export function buildUsagePageModel(input: UsagePageInput): UsagePageModel {
  const showingLimits = input.metric === "limits";
  const { window } = input;
  return {
    title: "Usage",
    breadcrumbLabel: "Usage breadcrumb",
    showingLimits,
    environmentFilter: buildUsageEnvironmentFilterModel({
      environments: input.environments,
      selectedEnvironments: input.selectedEnvironments,
      selectedEnvironmentIds: input.selectedEnvironmentIds,
      showUsageStatus: !showingLimits,
      isPartial: input.isPartial,
      duplicateSources: input.merged.duplicateSources,
      contractMismatches: input.merged.contractMismatches,
    }),
    windowLabel: showingLimits
      ? null
      : input.windowDays === 1 && window.sinceTime !== undefined && window.untilTime !== undefined
        ? `${formatDateTimeShort(window.sinceTime, window.timeZone)} to ${formatDateTimeShort(window.untilTime, window.timeZone)}`
        : `${formatDayShort(window.sinceDay)} to ${formatDayShort(window.untilDay)}`,
    metric: {
      ariaLabel: "Usage metric",
      value: input.metric,
      label: METRIC_OPTIONS.find((option) => option.value === input.metric)?.label ?? "",
      options: METRIC_OPTIONS.map((option) => ({
        value: option.value,
        key: option.value,
        label: option.label,
        title: shortcutTitle(input.keybindings, option),
        selected: option.value === input.metric,
      })),
    },
    period: {
      ariaLabel: "Usage period",
      value: String(input.windowDays),
      label: WINDOW_OPTIONS.find((option) => option.days === input.windowDays)?.label ?? "",
      disabled: showingLimits,
      options: WINDOW_OPTIONS.map((option) => ({
        value: option.days,
        key: String(option.days),
        label: option.label,
        title: shortcutTitle(input.keybindings, option),
        selected: option.days === input.windowDays,
      })),
    },
    refresh: {
      ariaLabel: showingLimits ? "Refresh limits" : "Refresh usage",
      busy: input.isRefreshing,
      disabled: input.isRefreshing,
      icon: "refresh",
    },
    content: buildContent(input),
  };
}
