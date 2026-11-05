import { SettingsGroup } from "./SettingsGroup";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { useAtomValue } from "@effect/atom-react";
import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { isElectron } from "../../env";
import { usePrimarySessionState } from "../../environments/primary";
import {
  useEnvironmentSettings,
  useUpdateClientSettings,
  useUpdateEnvironmentSettings,
} from "../../hooks/useSettings";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { cn } from "../../lib/utils";
import {
  useEnvironments,
  usePrimaryEnvironmentId,
  type EnvironmentPresentation,
} from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useEnvironmentSessionState } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  ConnectionStatusDot,
  connectionPhaseDotClassName,
  connectionPhasePingClassName,
} from "../ConnectionStatusDot";
import { ProviderUpdatesAction } from "../ProviderUpdatesAction";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { ScrollArea } from "../ui/scroll-area";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { AddProviderInstanceDialog } from "./AddProviderInstanceDialog";
import { ExpandableText } from "./ExpandableText";
import { ProviderInstanceCard } from "./ProviderInstanceCard";
import { UsageProviderSettings } from "./UsageProviderSettings";
import { ProviderSetupSection } from "./ProviderSetupSection";
import { readAntigravityAuthMethod } from "./ProviderSetupSection.logic";
import { CodexSetupSection, CodexManagedRuntimeFields } from "./CodexSetupSection";
import { getDriverOption } from "./providerDriverMeta";
import {
  PolicyTooltip,
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  useRelativeTimeTick,
  useSettingsSearchTargetId,
} from "./settingsLayout";
import {
  buildProviderEnvironmentPickerModel,
  buildProviderInstanceListModel,
  buildProviderLastCheckedModel,
  buildProviderUpdateFailureToast,
  type ProviderInstanceRowModel,
  type ProviderOperateAccess,
  type ProviderSettingsChange,
  type ProviderSettingsPlaceholderModel,
  type ProviderSettingsTarget,
  resolvePrimaryOperateAccess,
  resolveProviderEnvironmentView,
  resolveProviderOperateAccessSource,
  resolveProviderSearchTargetEnvironment,
  resolveProviderSettingsChange,
  resolveRemoteOperateAccess,
} from "./ProviderSettingsPanel.logic";

function ProviderLastChecked({ lastCheckedAt }: { lastCheckedAt: string | null }) {
  const nowMs = useRelativeTimeTick();
  const lastChecked = buildProviderLastCheckedModel(lastCheckedAt, nowMs);

  if (lastChecked.kind === "missing") {
    return null;
  }

  if (lastChecked.kind === "invalid") {
    return <span>{lastChecked.text}</span>;
  }

  return (
    <span>
      {lastChecked.suffix ? (
        <>
          {lastChecked.prefix} <span className="font-mono tabular-nums">{lastChecked.value}</span>{" "}
          {lastChecked.suffix}
        </>
      ) : (
        <>
          {lastChecked.prefix} {lastChecked.value}
        </>
      )}
    </span>
  );
}

// Shared by the editor grid and the placeholder states so switching devices
// never changes the card's footprint.
const providerCardHeightClassName =
  "@min-[48rem]/providers:h-[min(44rem,calc(100dvh-11rem))] @min-[48rem]/providers:min-h-[32rem]";

/**
 * Same chrome as the provider editor (section heading, floating device tabs,
 * tall card) for states that cannot render provider settings yet.
 */
function ProviderSettingsPlaceholder({
  section,
  deviceTabs,
  icon,
  title,
  description,
  children,
}: {
  readonly section: ProviderSettingsPlaceholderModel["section"];
  readonly deviceTabs?: ReactNode;
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly children?: ReactNode;
}) {
  return (
    <SettingsSection {...section} variant="plain">
      {deviceTabs ? (
        <div className="flex min-h-11 min-w-0 items-center px-3 sm:px-4">{deviceTabs}</div>
      ) : null}
      <SettingsGroup
        divided={false}
        className={cn(providerCardHeightClassName, "flex overflow-x-hidden overflow-y-auto")}
      >
        <Empty>
          <EmptyMedia variant="icon">{icon}</EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>{title}</EmptyTitle>
            <EmptyDescription>{description}</EmptyDescription>
          </EmptyHeader>
          {children ? <EmptyContent className="max-w-xl">{children}</EmptyContent> : null}
        </Empty>
      </SettingsGroup>
    </SettingsSection>
  );
}

function EnvironmentUnavailablePlaceholder({
  environmentId,
  placeholder,
  deviceTabs,
}: {
  readonly environmentId: EnvironmentId;
  readonly placeholder: ProviderSettingsPlaceholderModel;
  readonly deviceTabs?: ReactNode;
}) {
  // No spinner: this state can persist indefinitely for a wedged device, and a
  // continuously repainting animation would run the whole time.
  return (
    <ProviderSettingsPlaceholder
      section={placeholder.section}
      deviceTabs={deviceTabs}
      icon={<EnvironmentMachineIcon kind={placeholder.machineKind} />}
      title={placeholder.title}
      description={placeholder.description}
    >
      {placeholder.error ? (
        <ExpandableText
          key={environmentId}
          text={placeholder.error}
          className="w-full text-left font-mono text-xs leading-relaxed text-muted-foreground"
        />
      ) : null}
    </ProviderSettingsPlaceholder>
  );
}

export function ProviderSettingsPanel(target: ProviderSettingsTarget) {
  return (
    <SettingsPageContainer width="wide" className="@container/providers gap-8">
      <ProviderSettingsPanelContent
        key={`${target.environmentId ?? ""}:${target.instanceId ?? ""}`}
        {...target}
      />
    </SettingsPageContainer>
  );
}

function ProviderSettingsPanelContent(target: ProviderSettingsTarget) {
  const { environments, isReady } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const searchTargetId = useSettingsSearchTargetId();
  // Raw user intent; the effective selection is re-derived every render so a
  // device that drops out of the catalog falls back without erasing the pick —
  // if it reappears (e.g. after a reconnect) the selection is restored.
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<EnvironmentId | null>(
    target.environmentId ?? primaryEnvironmentId,
  );
  const picker = buildProviderEnvironmentPickerModel({
    environments,
    isReady,
    primaryEnvironmentId,
    target,
    selectedEnvironmentId,
  });
  const selectedEnvironment =
    environments.find(
      (environment) => environment.environmentId === picker.selectedEnvironmentId,
    ) ?? null;
  const searchTargetEnvironmentId = resolveProviderSearchTargetEnvironment({
    scoped: target.scoped ?? false,
    searchTargetId,
    picker,
  });
  useEffect(() => {
    if (searchTargetEnvironmentId !== null) {
      setSelectedEnvironmentId(searchTargetEnvironmentId);
    }
  }, [searchTargetEnvironmentId]);
  const deviceTabs = picker.showDeviceTabs ? (
    <ScrollArea radius="none" hideScrollbars scrollFade className="h-11 min-w-0 flex-1">
      <ToggleGroup
        aria-label={picker.ariaLabel}
        variant="segmented"
        className="my-2"
        value={picker.effectiveEnvironmentId ? [picker.effectiveEnvironmentId] : []}
        onValueChange={(next) => {
          const tab = picker.tabs.find((option) => option.id === next[0]);
          if (tab) setSelectedEnvironmentId(tab.id);
        }}
      >
        {picker.tabs.map((tab) => (
          <Tooltip key={tab.id}>
            <TooltipTrigger
              render={
                <Toggle value={tab.id}>
                  <EnvironmentMachineIcon
                    kind={tab.machineKind}
                    className="size-3.5 shrink-0"
                    aria-hidden
                  />
                  <span className="max-w-40 truncate">{tab.label}</span>
                  {tab.showStatusDot ? (
                    <ConnectionStatusDot
                      dotClassName={connectionPhaseDotClassName(tab.connectionPhase)}
                      pingClassName={connectionPhasePingClassName(tab.connectionPhase)}
                    />
                  ) : null}
                  <span className="sr-only">{tab.accessibleLabel}</span>
                </Toggle>
              }
            />
            <TooltipPopup side="top">{tab.tooltip}</TooltipPopup>
          </Tooltip>
        ))}
      </ToggleGroup>
    </ScrollArea>
  ) : null;

  return (
    <>
      {picker.placeholder ? (
        <ProviderSettingsPlaceholder
          section={picker.placeholder.section}
          deviceTabs={picker.placeholder.showDeviceTabs ? deviceTabs : undefined}
          icon={<EnvironmentMachineIcon kind={picker.placeholder.machineKind} />}
          title={picker.placeholder.title}
          description={picker.placeholder.description}
        />
      ) : null}

      {selectedEnvironment ? (
        <SelectedEnvironmentProviderSettings
          key={selectedEnvironment.environmentId}
          environment={selectedEnvironment}
          deviceTabs={deviceTabs}
          targetInstanceId={picker.targetInstanceId ?? undefined}
        />
      ) : null}
    </>
  );
}

function SelectedEnvironmentProviderSettings({
  environment,
  deviceTabs,
  targetInstanceId,
}: {
  readonly environment: EnvironmentPresentation;
  readonly deviceTabs?: ReactNode;
  readonly targetInstanceId?: ProviderInstanceId | undefined;
}) {
  // The desktop app owns its primary server outright; a browser session
  // checks the scopes its cookie session was granted.
  const accessSource = resolveProviderOperateAccessSource({
    isPrimary: environment.entry.target._tag === "PrimaryConnectionTarget",
    isElectron,
  });
  if (accessSource === "granted") {
    return (
      <AccessGatedProviderSettings
        environment={environment}
        operateAccess="granted"
        deviceTabs={deviceTabs}
        targetInstanceId={targetInstanceId}
      />
    );
  }
  if (accessSource === "primary-session") {
    return (
      <PrimarySessionGatedProviderSettings
        environment={environment}
        deviceTabs={deviceTabs}
        targetInstanceId={targetInstanceId}
      />
    );
  }
  return (
    <RemoteSessionGatedProviderSettings
      environment={environment}
      deviceTabs={deviceTabs}
      targetInstanceId={targetInstanceId}
    />
  );
}

function PrimarySessionGatedProviderSettings({
  environment,
  deviceTabs,
  targetInstanceId,
}: {
  readonly environment: EnvironmentPresentation;
  readonly deviceTabs?: ReactNode;
  readonly targetInstanceId?: ProviderInstanceId | undefined;
}) {
  const primarySessionState = usePrimarySessionState();
  const operateAccess = resolvePrimaryOperateAccess({
    isPrimary: true,
    hasDesktopBridge: false,
    session: primarySessionState.data,
    isPending: primarySessionState.isPending,
    hasError: primarySessionState.error !== null,
  });
  return (
    <AccessGatedProviderSettings
      environment={environment}
      operateAccess={operateAccess}
      deviceTabs={deviceTabs}
      targetInstanceId={targetInstanceId}
    />
  );
}

function RemoteSessionGatedProviderSettings({
  environment,
  deviceTabs,
  targetInstanceId,
}: {
  readonly environment: EnvironmentPresentation;
  readonly deviceTabs?: ReactNode;
  readonly targetInstanceId?: ProviderInstanceId | undefined;
}) {
  const sessionState = useEnvironmentSessionState(environment.environmentId);
  const operateAccess = resolveRemoteOperateAccess({
    session: sessionState.data,
    isPending: sessionState.isPending,
    hasError: sessionState.hasError,
  });
  return (
    <AccessGatedProviderSettings
      environment={environment}
      operateAccess={operateAccess}
      deviceTabs={deviceTabs}
      targetInstanceId={targetInstanceId}
    />
  );
}

function AccessGatedProviderSettings({
  environment,
  operateAccess,
  deviceTabs,
  targetInstanceId,
}: {
  readonly environment: EnvironmentPresentation;
  readonly operateAccess: ProviderOperateAccess;
  readonly deviceTabs?: ReactNode;
  readonly targetInstanceId?: ProviderInstanceId | undefined;
}) {
  const view = resolveProviderEnvironmentView({
    environment,
    operateAccess,
    showDeviceTabs: Boolean(deviceTabs),
  });
  if (view.kind === "placeholder") {
    return (
      <EnvironmentUnavailablePlaceholder
        environmentId={environment.environmentId}
        placeholder={view.placeholder}
        deviceTabs={deviceTabs}
      />
    );
  }
  return (
    <EnvironmentProviderSettings
      environmentId={environment.environmentId}
      environmentLabel={environment.label}
      readOnly={view.readOnly}
      deviceTabs={deviceTabs}
      targetInstanceId={targetInstanceId}
    />
  );
}

export function EnvironmentProviderSettings({
  environmentId,
  environmentLabel,
  readOnly = false,
  deviceTabs,
  targetInstanceId,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly deviceTabs?: ReactNode;
  readonly targetInstanceId?: ProviderInstanceId | undefined;
  /**
   * Grey out and freeze every write control when this session's credential
   * lacks `orchestration:operate` on the environment. Selecting providers
   * still works so the real configuration stays readable; switches, forms,
   * and the health interval are inert so no write is offered and then rejected.
   */
  readonly readOnly?: boolean;
}) {
  const settings = useEnvironmentSettings(environmentId);
  // Provider instances hold per-machine credentials and binaries, so this
  // page always edits exactly the environment it displays.
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const updateClientSettings = useUpdateClientSettings();
  const serverProviders =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const refreshServerProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const updateProvider = useAtomCommand(serverEnvironment.updateProvider, {
    reportFailure: false,
  });
  const [isRefreshingProviders, setIsRefreshingProviders] = useState(false);
  const [isAddInstanceDialogOpen, setIsAddInstanceDialogOpen] = useState(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState<ProviderInstanceId | null>(
    targetInstanceId ?? null,
  );
  const [updatingProviderInstanceIds, setUpdatingProviderInstanceIds] = useState<
    ReadonlySet<ProviderInstanceId>
  >(() => new Set());
  const refreshingRef = useRef(false);
  const updatingInstanceIdsRef = useRef<Set<ProviderInstanceId>>(new Set());

  const updatingInstanceIds = [...updatingProviderInstanceIds];
  const model = buildProviderInstanceListModel({
    settings,
    serverProviders,
    environmentLabel,
    readOnly,
    selectedInstanceId,
    targetInstanceId: targetInstanceId ?? null,
    isRefreshing: isRefreshingProviders,
    updatingInstanceIds,
  });
  const healthInterval = model.healthInterval;

  const refreshProviders = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setIsRefreshingProviders(true);
    void (async () => {
      const result = await refreshServerProviders({
        environmentId,
        input: { refreshModels: true },
      });
      refreshingRef.current = false;
      setIsRefreshingProviders(false);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        console.warn("Failed to refresh providers", {
          operation: "refresh-providers",
          environmentId,
          ...safeErrorLogAttributes(squashAtomCommandFailure(result)),
        });
      }
    })();
  }, [environmentId, refreshServerProviders]);

  const runProviderUpdate = useCallback(
    async (candidate: {
      readonly driver: ProviderDriverKind;
      readonly instanceId: ProviderInstanceId;
      readonly targetVersion: string | null;
    }) => {
      // Ref-based re-entry guard, mirroring refreshProviders: a state updater
      // may run after this function returns, so it cannot gate the dispatch.
      if (updatingInstanceIdsRef.current.has(candidate.instanceId)) {
        return;
      }
      updatingInstanceIdsRef.current.add(candidate.instanceId);
      setUpdatingProviderInstanceIds((previous) => new Set(previous).add(candidate.instanceId));

      const result = await updateProvider({
        environmentId,
        input: {
          provider: candidate.driver,
          instanceId: candidate.instanceId,
          ...(candidate.targetVersion ? { targetVersion: candidate.targetVersion } : {}),
        },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            ...buildProviderUpdateFailureToast({
              driver: candidate.driver,
              errorMessage: error instanceof Error ? error.message : null,
            }),
          }),
        );
      }
      updatingInstanceIdsRef.current.delete(candidate.instanceId);
      setUpdatingProviderInstanceIds((previous) => {
        if (!previous.has(candidate.instanceId)) {
          return previous;
        }
        const next = new Set(previous);
        next.delete(candidate.instanceId);
        return next;
      });
    },
    [environmentId, updateProvider],
  );

  const applyChange = (change: ProviderSettingsChange) => {
    const decision = resolveProviderSettingsChange(
      {
        settings,
        serverProviders,
        readOnly,
        isRefreshing: isRefreshingProviders,
        updatingInstanceIds,
      },
      change,
    );
    switch (decision.kind) {
      case "none":
        return;
      case "select-instance":
        setSelectedInstanceId(decision.instanceId);
        return;
      case "update-environment-settings":
        updateSettings(decision.patch);
        return;
      case "update-client-settings":
        updateClientSettings(decision.patch);
        return;
      case "open-add-instance-dialog":
        setIsAddInstanceDialogOpen(true);
        return;
      case "refresh-providers":
        refreshProviders();
        return;
      case "run-provider-update":
        void runProviderUpdate(decision);
        return;
    }
  };

  const renderProviderInstance = (row: ProviderInstanceRowModel, mode: "list" | "editor") => {
    const liveProvider = serverProviders.find((candidate) => candidate.instanceId === row.id);
    const isEditor = mode === "editor";

    return (
      <ProviderInstanceCard
        key={row.id}
        instanceId={row.id}
        instance={row.instance}
        driverOption={getDriverOption(row.driver)}
        liveProvider={liveProvider}
        mode={mode}
        selected={mode === "list" && row.selected}
        onSelect={
          mode === "list"
            ? () => applyChange({ kind: "select-instance", instanceId: row.id })
            : undefined
        }
        readOnly={readOnly}
        runtime={
          isEditor && row.setup === "codex-managed" ? (
            <CodexManagedRuntimeFields
              environmentId={environmentId}
              instanceId={row.id}
              provider={liveProvider}
            />
          ) : undefined
        }
        setup={
          isEditor && row.setup === "antigravity" ? (
            <ProviderSetupSection
              environmentId={environmentId}
              environmentLabel={environmentLabel}
              instanceId={row.id}
              provider={liveProvider}
              binaryPath={row.binaryPath}
              authMethod={readAntigravityAuthMethod(row.instance.config)}
              enabled={row.enabled}
              readOnly={readOnly}
              onEnable={() => applyChange({ kind: "enable-instance", instanceId: row.id })}
            />
          ) : isEditor && row.setup === "codex-managed" ? (
            <CodexSetupSection
              environmentId={environmentId}
              instanceId={row.id}
              provider={liveProvider}
              mode="managed"
              enabled={row.enabled}
              readOnly={readOnly}
              onModeChange={(setupMode) =>
                applyChange({ kind: "set-codex-setup-mode", instanceId: row.id, setupMode })
              }
            />
          ) : null
        }
        onUpdate={(next) => applyChange({ kind: "update-instance", instanceId: row.id, next })}
        onDelete={
          isEditor && row.canDelete
            ? () => applyChange({ kind: "remove-instance", instanceId: row.id })
            : undefined
        }
        headerAction={
          isEditor && row.resetLabel !== null ? (
            <SettingResetButton
              label={row.resetLabel}
              onClick={() => applyChange({ kind: "reset-default-instance", instanceId: row.id })}
            />
          ) : null
        }
        hiddenModels={row.hiddenModels}
        favoriteModels={row.favoriteModels}
        modelOrder={row.modelOrder}
        onHiddenModelsChange={(hiddenModels) =>
          applyChange({ kind: "set-hidden-models", instanceId: row.id, hiddenModels })
        }
        onFavoriteModelsChange={(models) =>
          applyChange({ kind: "set-favorite-models", instanceId: row.id, models })
        }
        onModelOrderChange={(modelOrder) =>
          applyChange({ kind: "set-model-order", instanceId: row.id, modelOrder })
        }
        onInstallRecommended={
          isEditor && row.canInstallRecommended
            ? () => applyChange({ kind: "install-recommended", instanceId: row.id })
            : undefined
        }
        onRunUpdate={
          isEditor && row.update.available
            ? () => applyChange({ kind: "run-update", instanceId: row.id })
            : undefined
        }
        isUpdating={isEditor ? row.update.running : undefined}
      />
    );
  };

  const selectedRow = model.rows.find((row) => row.id === model.selectedInstanceId) ?? null;

  return (
    <>
      <SettingsSection
        {...model.section}
        variant="plain"
        headerAction={
          <div className="flex min-w-0 items-center gap-2">
            <ProviderUpdatesAction />
            {model.refreshAction === null ? (
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                <ProviderLastChecked lastCheckedAt={model.lastCheckedAt} />
              </span>
            ) : (
              <>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="xs"
                        variant="ghost-muted"
                        disabled={model.refreshAction.disabled}
                        aria-busy={model.refreshAction.busy}
                        onClick={() => applyChange({ kind: "refresh" })}
                      >
                        <RefreshIcon refreshing={model.refreshAction.busy} />
                        <span className="sr-only">{model.refreshAction.label}</span>
                        <span className="hidden min-w-0 truncate sm:inline">
                          {model.refreshAction.busyText ?? (
                            <ProviderLastChecked lastCheckedAt={model.lastCheckedAt} />
                          )}
                        </span>
                      </Button>
                    }
                  />
                  <TooltipPopup side="top">{model.refreshAction.label}</TooltipPopup>
                </Tooltip>
                {model.addAction ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="icon-xs"
                          variant="ghost-muted"
                          onClick={() => applyChange({ kind: "add-instance" })}
                          aria-label={model.addAction.label}
                        >
                          <PlusIcon />
                        </Button>
                      }
                    />
                    <TooltipPopup side="top">{model.addAction.label}</TooltipPopup>
                  </Tooltip>
                ) : null}
              </>
            )}
          </div>
        }
      >
        {deviceTabs ? (
          <div className="flex min-h-11 min-w-0 items-center gap-2 px-3 sm:px-4">{deviceTabs}</div>
        ) : null}
        {model.readOnlyNotice ? (
          <SettingsGroup divided={false} className="overflow-hidden">
            <SettingsRow
              title={model.readOnlyNotice.title}
              description={model.readOnlyNotice.description}
            />
          </SettingsGroup>
        ) : null}
        <SettingsGroup
          divided={false}
          className={cn(
            providerCardHeightClassName,
            "overflow-hidden @min-[48rem]/providers:grid @min-[48rem]/providers:grid-cols-[17rem_minmax(0,1fr)]",
          )}
        >
          <div className="border-b border-border/60 bg-muted/10 @min-[48rem]/providers:flex @min-[48rem]/providers:min-h-0 @min-[48rem]/providers:flex-col @min-[48rem]/providers:border-r @min-[48rem]/providers:border-b-0">
            <ScrollArea
              scrollFade
              chainVerticalScroll
              className="@min-[48rem]/providers:min-h-0 @min-[48rem]/providers:flex-1"
            >
              <div className="divide-y divide-border/50">
                {model.rows.map((row) => renderProviderInstance(row, "list"))}
              </div>
            </ScrollArea>
          </div>

          <div className="min-w-0 @min-[48rem]/providers:min-h-0">
            {selectedRow ? (
              <ScrollArea scrollFade chainVerticalScroll className="@min-[48rem]/providers:h-full">
                <div className="space-y-6 p-4">{renderProviderInstance(selectedRow, "editor")}</div>
              </ScrollArea>
            ) : (
              <div className="p-6 text-sm text-muted-foreground">{model.emptyMessage}</div>
            )}
          </div>
        </SettingsGroup>
      </SettingsSection>

      <UsageProviderSettings
        key={environmentId}
        environmentId={environmentId}
        environmentLabel={environmentLabel}
        sources={settings.usageLimitSources}
        cursorKeychainUsageEnabled={settings.cursorKeychainUsageEnabled}
        readOnly={readOnly}
      />

      <SettingsSection title={healthInterval.sectionTitle}>
        <SettingsRow
          id={healthInterval.id}
          title={
            <span className="inline-flex items-center gap-1.5">
              {healthInterval.title}
              <PolicyTooltip>{healthInterval.policyTooltip}</PolicyTooltip>
            </span>
          }
          description={healthInterval.description}
          resetAction={
            healthInterval.resetLabel !== null ? (
              <span
                inert={healthInterval.disabled}
                className={healthInterval.disabled ? "opacity-50" : undefined}
              >
                <SettingResetButton
                  label={healthInterval.resetLabel}
                  onClick={() => applyChange({ kind: "reset-health-interval" })}
                />
              </span>
            ) : null
          }
          control={
            <div
              inert={healthInterval.disabled}
              aria-disabled={healthInterval.disabled || undefined}
              className={cn(
                "flex shrink-0 items-center gap-2",
                healthInterval.disabled && "opacity-50 select-none",
              )}
            >
              <NumberField
                value={healthInterval.value}
                min={healthInterval.min}
                step={healthInterval.step}
                size="sm"
                className="w-32"
                onValueChange={(value) =>
                  applyChange({ kind: "set-health-interval", seconds: value })
                }
              >
                <NumberFieldGroup>
                  <NumberFieldDecrement aria-label={healthInterval.decrementAriaLabel} />
                  <NumberFieldInput aria-label={healthInterval.inputAriaLabel} />
                  <NumberFieldIncrement aria-label={healthInterval.incrementAriaLabel} />
                </NumberFieldGroup>
              </NumberField>
              <span className="text-xs text-muted-foreground">{healthInterval.unitLabel}</span>
            </div>
          }
        />
      </SettingsSection>

      {isAddInstanceDialogOpen ? (
        <AddProviderInstanceDialog
          open
          environmentId={environmentId}
          environmentLabel={environmentLabel}
          onOpenChange={setIsAddInstanceDialogOpen}
        />
      ) : null}
    </>
  );
}
