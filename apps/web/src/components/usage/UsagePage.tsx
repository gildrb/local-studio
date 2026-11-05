import { ChatGptUsageButton } from "../settings/ChatGptUsageButton";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { useAtomValue } from "@effect/atom-react";
import { ProviderDriverKind, type EnvironmentId, type UsageProviderKind } from "@t3tools/contracts";
import {
  CircleAlertIcon,
  ChevronDownIcon,
  CircleDashedIcon,
  InfoIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { usePrimarySettings } from "../../hooks/useSettings";
import { environmentPresentations } from "../../state/presentation";
import { primaryServerKeybindingsAtom, serverEnvironment } from "../../state/server";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { isModelPickerOpen } from "../../modelPickerVisibility";
import { useUsage } from "../../state/usage";
import type { EnvironmentUsageStatus } from "../../state/usage.logic";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button, InlineButton } from "../ui/button";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { UsageLimitsPooled } from "./UsageLimitsPooled";
import { UsagePriceOverrides } from "./UsagePriceOverrides";
import { UsageProviderChart } from "./UsageProviderChart";
import { resolveUsageShortcut, type UsageMetric } from "./usageShortcuts";
import { useEscapeToGoBack } from "../../hooks/useNavigateBack";
import { PROVIDER_PRESENTATION } from "./usageProviders";
import { readUsagePagePreferences, saveUsagePagePreferences } from "./usagePagePreferences";
import {
  buildUsagePageModel,
  isUsageMetric,
  makeUsageWindow,
  resolveEnvironmentSelection,
  resolveLimitsRefreshTargets,
  resolveMetricSelection,
  resolveUsageRefresh,
  resolveUsageShortcutAction,
  resolveWindowSelection,
  type UsageBreakdown,
  type UsageContentModel,
  type UsageCursorEnableButtonModel,
  type UsageCursorPromptModel,
  type UsageEnvironmentFilterModel,
} from "./UsagePage.logic";

export function UsagePage() {
  const [preferences, setPreferences] = useState(readUsagePagePreferences);
  useEscapeToGoBack();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const [windowSelection, setWindowSelection] = useState(() => ({
    days: preferences.windowDays,
    window: makeUsageWindow(preferences.windowDays, Date.now()),
  }));
  const metric = preferences.metric;
  const showingLimits = metric === "limits";
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [limitsNow, setLimitsNow] = useState(() => Date.now());
  const refreshingRef = useRef(false);
  const [breakdown, setBreakdown] = useState<UsageBreakdown>("model");
  const [selectedEnvironmentIds, setSelectedEnvironmentIds] =
    useState<ReadonlySet<EnvironmentId> | null>(null);
  const { days: windowDays, window } = windowSelection;
  const { merged, environments, selectedEnvironments, isPending, isPartial, refresh } = useUsage(
    window,
    selectedEnvironmentIds,
  );
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });

  const model = buildUsagePageModel({
    metric,
    windowDays,
    window,
    breakdown,
    isRefreshing,
    merged,
    environments,
    selectedEnvironments,
    selectedEnvironmentIds,
    isPending,
    isPartial,
    presentations,
    keybindings,
    limitsNowMs: limitsNow,
    timestampFormat,
  });

  const selectWindow = (days: number) => {
    const selection = resolveWindowSelection(days, metric, Date.now());
    if (selection.kind === "ignore") return;
    setPreferences(selection.preferences);
    saveUsagePagePreferences(selection.preferences);
    setWindowSelection({ days: selection.days, window: selection.window });
  };
  const selectMetric = (nextMetric: UsageMetric) => {
    const selection = resolveMetricSelection(nextMetric, windowDays);
    if (selection.resetLimitsClock) setLimitsNow(Date.now());
    setPreferences(selection.preferences);
    saveUsagePagePreferences(selection.preferences);
  };
  const limitsRefreshTargets = resolveLimitsRefreshTargets(presentations, selectedEnvironmentIds);
  const refreshLimits = async (automatic = false, afterPending = false) => {
    try {
      await Promise.all(
        limitsRefreshTargets.map((environmentId) =>
          refreshUsageLimits(
            environmentId,
            () => refreshProviders({ environmentId, input: {} }),
            automatic,
            afterPending,
          ),
        ),
      );
    } finally {
      setLimitsNow(Date.now());
    }
  };
  const onUsageKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const overlayOpen = isCommandPaletteOpen() || isModelPickerOpen();
    const action = resolveUsageShortcutAction({
      defaultPrevented: event.defaultPrevented,
      repeat: event.repeat,
      isComposing: event.isComposing,
      overlayOpen,
      command:
        event.defaultPrevented || event.repeat || event.isComposing || overlayOpen
          ? null
          : resolveUsageShortcut(event, keybindings),
      showingLimits,
    });
    if (action.kind === "ignore") return;

    event.preventDefault();
    event.stopPropagation();
    if (action.metric !== null) selectMetric(action.metric);
    if (action.windowDays !== null) selectWindow(action.windowDays);
  });

  useEffect(() => {
    globalThis.window.addEventListener("keydown", onUsageKeyDown, true);
    return () => globalThis.window.removeEventListener("keydown", onUsageKeyDown, true);
  }, []);

  const refreshWindow = () => {
    const action = resolveUsageRefresh({
      refreshing: refreshingRef.current,
      showingLimits,
      windowDays,
      window,
      nowMs: Date.now(),
    });
    if (action.kind === "ignore") return;
    refreshingRef.current = true;
    setIsRefreshing(true);
    const settle = () => {
      refreshingRef.current = false;
      setIsRefreshing(false);
    };
    if (action.kind === "limits") {
      void refreshLimits().finally(settle);
      return;
    }
    if (action.windowChanged) setWindowSelection({ days: windowDays, window: action.window });
    void refresh(action.window).finally(settle);
  };
  const connectedLimitsEnvironments = limitsRefreshTargets.join(",");
  const autoRefreshLimits = useEffectEvent(() => {
    void refreshLimits(true);
  });
  useEffect(() => {
    if (showingLimits && connectedLimitsEnvironments) autoRefreshLimits();
  }, [showingLimits, connectedLimitsEnvironments]);

  const onCursorEnabled = () => {
    void refresh();
    void refreshLimits(false, true);
  };
  const onMetricChange = (value: string | null | undefined) => {
    if (isUsageMetric(value)) selectMetric(value);
  };
  const refreshButton = (
    <Button
      onClick={refreshWindow}
      aria-label={model.refresh.ariaLabel}
      aria-busy={model.refresh.busy}
      disabled={model.refresh.disabled}
      size="icon-sm"
      variant="ghost"
    >
      <RefreshIcon size="sm" refreshing={model.refresh.busy} />
    </Button>
  );

  const topbarContent = (
    <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-2 xl:flex">
      <WorkspaceBreadcrumb ariaLabel={model.breadcrumbLabel} className="col-span-2 min-w-0">
        <WorkspaceBreadcrumbItem>
          <h1>{model.title}</h1>
        </WorkspaceBreadcrumbItem>
        <WorkspaceBreadcrumbSeparator />
        <WorkspaceBreadcrumbItem current className="min-w-10">
          <UsageEnvironmentFilter
            filter={model.environmentFilter}
            environments={environments}
            selectedEnvironmentIds={selectedEnvironmentIds}
            onSelectionChange={setSelectedEnvironmentIds}
          />
        </WorkspaceBreadcrumbItem>
      </WorkspaceBreadcrumb>
      {model.windowLabel !== null ? (
        <span className="hidden min-w-0 truncate text-xs text-muted-foreground 2xl:block">
          {model.windowLabel}
        </span>
      ) : null}
      <div className="ms-auto hidden min-w-0 items-center justify-end gap-2 xl:flex">
        <ToggleGroup
          aria-label={model.metric.ariaLabel}
          variant="segmented"
          value={[model.metric.value]}
          onValueChange={(next) => onMetricChange(next[0])}
        >
          {model.metric.options.map((option) => (
            <Toggle key={option.key} value={option.key} title={option.title}>
              {option.label}
            </Toggle>
          ))}
        </ToggleGroup>
        {/* The period does not apply to Limits, so it stays in place but
            disabled; unmounting it shifted the metric toggle ~300px. */}
        <ToggleGroup
          aria-label={model.period.ariaLabel}
          variant="segmented"
          value={[model.period.value]}
          disabled={model.period.disabled}
          onValueChange={(next) => {
            const value = next[0];
            if (value) selectWindow(Number(value));
          }}
        >
          {model.period.options.map((option) => (
            <Toggle key={option.key} value={option.key} title={option.title}>
              {option.label}
            </Toggle>
          ))}
        </ToggleGroup>
        {refreshButton}
      </div>
      <div className="col-span-2 ms-auto flex min-w-0 items-center justify-end gap-1 xl:hidden">
        <Select value={model.metric.value} onValueChange={onMetricChange}>
          <SelectTrigger
            aria-label={model.metric.ariaLabel}
            size="compact"
            variant="ghost"
            className="w-auto min-w-0"
          >
            <SelectValue>{model.metric.label}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {model.metric.options.map((option) => (
              <SelectItem key={option.key} value={option.key} title={option.title}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Select
          value={model.period.value}
          disabled={model.period.disabled}
          onValueChange={(value) => selectWindow(Number(value))}
        >
          <SelectTrigger
            aria-label={model.period.ariaLabel}
            size="compact"
            variant="ghost"
            className="w-auto min-w-0"
          >
            <SelectValue>{model.period.label}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {model.period.options.map((option) => (
              <SelectItem key={option.key} value={option.key} title={option.title}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        {refreshButton}
      </div>
    </div>
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron} className="h-auto">
          {topbarContent}
        </WorkspacePageHeader>

        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="wide">
            <UsageContent
              content={model.content}
              breakdownChange={setBreakdown}
              onCursorEnabled={onCursorEnabled}
            />
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

function UsageContent({
  content,
  breakdownChange,
  onCursorEnabled,
}: {
  readonly content: UsageContentModel;
  readonly breakdownChange: (breakdown: UsageBreakdown) => void;
  readonly onCursorEnabled: () => void;
}) {
  if (content.kind === "no-environment") {
    return <p className="text-sm text-muted-foreground">{content.message}</p>;
  }
  if (content.kind === "limits") {
    return (
      <UsageLimitsPooled
        model={content.limits}
        cursorPrompt={
          content.cursorPrompt !== null ? (
            <CursorEnableLimits prompt={content.cursorPrompt} onEnabled={onCursorEnabled} />
          ) : null
        }
      />
    );
  }
  if (content.kind === "loading") return <UsageSkeleton content={content} />;
  return (
    <>
      {content.sourceMessages.map((message) => (
        <p key={message} className="mb-4 text-sm text-muted-foreground">
          {message}
        </p>
      ))}
      <section className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-1">
            <span className="text-4xl font-semibold text-foreground tabular-nums">
              {content.headline.value}
            </span>
            <span className="text-xs text-muted-foreground">
              {content.headline.sessionsLabel}
              {content.headline.estimateNote !== null && (
                <>
                  {content.headline.estimateNote}
                  {content.headline.unpriced !== null && (
                    <>
                      {" "}
                      <Popover>
                        <PopoverTrigger
                          openOnHover
                          render={<InlineButton tone="muted" />}
                          aria-label={content.headline.unpriced.ariaLabel}
                        >
                          <InfoIcon className="size-3" aria-hidden />
                        </PopoverTrigger>
                        <PopoverPopup side="top" tooltipStyle>
                          {content.headline.unpriced.message}
                        </PopoverPopup>
                      </Popover>
                    </>
                  )}
                </>
              )}
            </span>
          </div>

          {content.chatGptSharing !== null ? (
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{content.chatGptSharing.label}</span>
              <ChatGptUsageButton size="xs" />
            </div>
          ) : null}

          {content.summaryRows.map((row) => {
            if (row.kind === "enable") {
              return (
                <div
                  key={row.key}
                  className="flex min-w-0 items-baseline justify-between gap-4 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: row.color }}
                    />
                    <ProviderMark provider="cursor" className="size-4" />
                    <span className="truncate">{row.label}</span>
                  </span>
                  <CursorEnableButton button={row.button} onEnabled={onCursorEnabled} />
                </div>
              );
            }
            return (
              <div key={row.key} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: row.color }}
                    />
                    <ProviderMark provider={row.provider} className="size-4" />
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="truncate">{row.label}</span>
                      <span className="shrink-0 whitespace-nowrap text-2xs text-muted-foreground tabular-nums">
                        {row.sessionLabel}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-medium text-foreground tabular-nums">
                    {row.valueLabel}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">{row.detailLabel}</span>
              </div>
            );
          })}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <h2 className="text-sm font-medium text-foreground">{content.chartTitle}</h2>
          <UsageProviderChart model={content.chart} />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-foreground">{content.totalsTitle}</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 py-1 md:grid-cols-5">
          {content.totals.map((metric) => (
            <Metric key={metric.label} label={metric.label} value={metric.value} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-foreground">{content.breakdown.title}</h2>
          <ToggleGroup
            aria-label="Usage breakdown"
            variant="segmented"
            value={[content.breakdown.selected]}
            onValueChange={(next) => {
              const value = next[0];
              if (value === "model" || value === "time") breakdownChange(value);
            }}
          >
            {content.breakdown.options.map((option) => (
              <Toggle key={option.value} value={option.value}>
                {option.label}
              </Toggle>
            ))}
          </ToggleGroup>
        </div>

        {content.breakdown.selected === "model" ? (
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-2/5" />
              <col className="w-1/5" />
              <col className="w-1/5" />
              <col className="w-1/5" />
            </colgroup>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                {content.breakdown.model.headings.map((heading, index) => (
                  <th
                    key={heading}
                    className={index === 0 ? "py-2 font-normal" : "py-2 text-right font-normal"}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {content.breakdown.model.rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-muted-foreground">
                    {content.breakdown.emptyMessage}
                  </td>
                </tr>
              ) : (
                content.breakdown.model.rows.map((row) => (
                  <tr
                    key={row.key}
                    className="border-b border-border/50 transition-colors hover:bg-muted/50"
                  >
                    <td className="py-2 text-foreground">
                      <span className="flex items-center gap-2">
                        <ProviderMark provider={row.provider} className="size-3.5" />
                        {row.model}
                      </span>
                    </td>
                    <td className="py-2 text-right text-foreground tabular-nums">
                      {row.costUnknown ? (
                        <span className="text-muted-foreground">{row.costLabel}</span>
                      ) : (
                        row.costLabel
                      )}
                    </td>
                    <td className="py-2 text-right text-muted-foreground tabular-nums">
                      {row.shareLabel}
                    </td>
                    <td className="py-2 text-right text-muted-foreground tabular-nums">
                      {row.tokensLabel}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-2/5" />
              {content.breakdown.time.providerColumns.map((column) => (
                <col
                  key={column.provider}
                  style={{ width: content.breakdown.time.valueColumnWidth }}
                />
              ))}
              <col style={{ width: content.breakdown.time.valueColumnWidth }} />
              <col style={{ width: content.breakdown.time.valueColumnWidth }} />
            </colgroup>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 font-normal">{content.breakdown.time.periodHeading}</th>
                {content.breakdown.time.providerColumns.map((column) => (
                  <th key={column.provider} className="py-2 text-right font-normal">
                    {column.label}
                  </th>
                ))}
                <th className="py-2 text-right font-normal">
                  {content.breakdown.time.totalHeading}
                </th>
                <th className="py-2 text-right font-normal">
                  {content.breakdown.time.tokensHeading}
                </th>
              </tr>
            </thead>
            <tbody>
              {content.breakdown.time.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={content.breakdown.time.columnCount}
                    className="py-6 text-center text-muted-foreground"
                  >
                    {content.breakdown.emptyMessage}
                  </td>
                </tr>
              ) : (
                content.breakdown.time.rows.map((row) => (
                  <tr
                    key={row.key}
                    className="border-b border-border/50 transition-colors hover:bg-muted/50"
                  >
                    <td className="py-2 text-foreground">{row.periodLabel}</td>
                    {row.providerCosts.map((cost) => (
                      <td
                        key={cost.provider}
                        className="py-2 text-right text-muted-foreground tabular-nums"
                      >
                        {cost.label}
                      </td>
                    ))}
                    <td className="py-2 text-right text-foreground tabular-nums">
                      {row.totalLabel}
                    </td>
                    <td className="py-2 text-right text-muted-foreground tabular-nums">
                      {row.tokensLabel}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function CursorEnableButton({
  button,
  onEnabled,
}: {
  readonly button: UsageCursorEnableButtonModel;
  readonly onEnabled: () => void;
}) {
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "enable Cursor account usage",
  });
  const [pending, setPending] = useState(false);
  const enable = async () => {
    setPending(true);
    try {
      const result = await updateSettings({
        environmentId: button.environmentId,
        input: { patch: { cursorKeychainUsageEnabled: true } },
      });
      if (result._tag === "Success") onEnabled();
    } finally {
      setPending(false);
    }
  };
  if (button.tooltip === null) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        aria-busy={pending}
        aria-label={button.ariaLabel}
        onClick={() => void enable()}
      >
        {button.text}
      </Button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <InlineButton
            disabled={pending}
            aria-busy={pending}
            aria-label={button.ariaLabel}
            onClick={() => void enable()}
          >
            {button.text}
          </InlineButton>
        }
      />
      <TooltipPopup>{button.tooltip}</TooltipPopup>
    </Tooltip>
  );
}

function CursorEnableLimits({
  prompt,
  onEnabled,
}: {
  readonly prompt: UsageCursorPromptModel;
  readonly onEnabled: () => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
        <ProviderInstanceIcon
          driverKind={ProviderDriverKind.make("cursor")}
          displayName={prompt.title}
          indicatorBackground="var(--background)"
          className="size-5"
          iconClassName="size-4 text-foreground/80"
        />
        {prompt.title}
      </h2>
      <div className="flex flex-col items-start gap-3 rounded-lg border border-border/60 p-4">
        <p className="text-xs text-muted-foreground">{prompt.copy}</p>
        <div className="flex flex-wrap gap-2">
          {prompt.buttons.map((button) => (
            <CursorEnableButton key={button.environmentId} button={button} onEnabled={onEnabled} />
          ))}
        </div>
      </div>
    </section>
  );
}

/** Brand mark for the harness a row belongs to. */
function ProviderMark({
  provider,
  className,
}: {
  readonly provider: UsageProviderKind;
  readonly className: string;
}) {
  const Mark = PROVIDER_PRESENTATION[provider].mark;
  return <Mark className={cn("shrink-0", className)} aria-hidden />;
}

export function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-base font-medium text-foreground tabular-nums">{value}</span>
    </div>
  );
}

/** Environment selection and scan progress share a permanent header control. */
function UsageEnvironmentFilter({
  filter,
  environments,
  selectedEnvironmentIds,
  onSelectionChange,
}: {
  readonly filter: UsageEnvironmentFilterModel;
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly onSelectionChange: (ids: ReadonlySet<EnvironmentId> | null) => void;
}) {
  const [modelPricesOpen, setModelPricesOpen] = useState(false);
  return (
    <>
      <Menu>
        <MenuTrigger
          render={<InlineButton />}
          className="group/usage-environment min-w-0 max-w-full"
        >
          <span className="min-w-0 truncate">{filter.label}</span>
          <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
            {filter.indicator.kind === "scanning" ? (
              <>
                <CircleDashedIcon className="size-3.5" aria-hidden />
                <span className="sr-only">{filter.indicator.srLabel}</span>
              </>
            ) : filter.indicator.kind === "issue" ? (
              <CircleAlertIcon
                className="size-3.5 text-warning-foreground"
                aria-label={filter.indicator.ariaLabel}
              />
            ) : (
              <ChevronDownIcon
                className="size-3.5 opacity-0 transition-opacity group-hover/usage-environment:opacity-100 group-focus-visible/usage-environment:opacity-100 group-data-popup-open/usage-environment:opacity-100"
                aria-hidden
              />
            )}
          </span>
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuCheckboxItem
            checked={filter.allSelected}
            closeOnClick={false}
            onCheckedChange={(checked) => onSelectionChange(checked ? null : new Set())}
          >
            {filter.allLabel}
          </MenuCheckboxItem>
          <MenuSeparator />
          {filter.items.map((item) => (
            <MenuCheckboxItem
              key={item.environmentId}
              checked={item.checked}
              closeOnClick={false}
              onCheckedChange={(checked) =>
                onSelectionChange(
                  resolveEnvironmentSelection({
                    environmentIds: environments.map((environment) => environment.environmentId),
                    selectedIds: selectedEnvironmentIds,
                    environmentId: item.environmentId,
                    checked,
                  }),
                )
              }
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.status !== null ? (
                  <span
                    className={cn(
                      "shrink-0 text-xs text-muted-foreground",
                      item.statusTone === "error" && "text-destructive",
                    )}
                  >
                    {item.status}
                  </span>
                ) : null}
              </span>
            </MenuCheckboxItem>
          ))}
          {filter.emptyMessage !== null ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">{filter.emptyMessage}</p>
          ) : null}
          {filter.partialMessage !== null ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">{filter.partialMessage}</p>
          ) : null}
          {filter.coverageNotices.length > 0 ? (
            <div className="flex flex-col gap-1 border-t border-border px-2 py-2 text-xs text-muted-foreground">
              {filter.coverageNotices.map((notice) => (
                <span key={notice}>{notice}</span>
              ))}
            </div>
          ) : null}
          <MenuSeparator />
          <MenuItem onClick={() => setModelPricesOpen(true)}>
            <SlidersHorizontalIcon aria-hidden />
            {filter.modelPricesLabel}
          </MenuItem>
        </MenuPopup>
      </Menu>
      {modelPricesOpen ? (
        <UsagePriceOverrides
          usage={environments}
          initialSelectedEnvironmentIds={selectedEnvironmentIds}
          onOpenChange={setModelPricesOpen}
        />
      ) : null}
    </>
  );
}

/**
 * Stand-in with the loaded page's shape, using the shared `Skeleton` bars so it
 * breathes with the same `animate-skeleton` pulse as every other loading state.
 * Replaced by results as soon as the first environment answers.
 */
function UsageSkeleton({
  content,
}: {
  readonly content: Extract<UsageContentModel, { readonly kind: "loading" }>;
}) {
  return (
    <>
      <section className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-10 w-36" />
            <Skeleton className="h-4 w-32" />
          </div>
          {content.providers.map((provider) => (
            <div key={provider} className="flex flex-col gap-1">
              <div className="flex min-h-5 items-center justify-between gap-4">
                <span className="flex items-center gap-2">
                  <Skeleton shape="pill" className="size-2 shrink-0" />
                  <Skeleton shape="pill" className="size-4 shrink-0" />
                  <Skeleton className="h-3.5 w-20" />
                </span>
                <Skeleton className="h-3.5 w-14" />
              </div>
              <Skeleton className="h-4 w-36" />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <Skeleton className="h-5 w-24" />
          <div className="flex flex-col gap-1">
            <Skeleton className="ml-16 h-56" />
            <Skeleton className="ml-16 h-4" />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-foreground">{content.totalsTitle}</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 py-1 md:grid-cols-5">
          {content.totalLabels.map((label) => (
            <div key={label} className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">{label}</span>
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-foreground">{content.breakdownTitle}</h2>
          <Skeleton shape="card" className="h-7 w-28" />
        </div>
        <Skeleton className="h-44" />
      </section>
    </>
  );
}
