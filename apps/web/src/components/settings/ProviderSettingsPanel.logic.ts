import {
  connectionStatusTitle,
  type EnvironmentConnectionPhase,
} from "@t3tools/client-runtime/connection";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  AuthOrchestrationOperateScope,
  type AuthSessionState,
  defaultInstanceIdForDriver,
  type EnvironmentId,
  type EnvironmentMachineKind,
  PROVIDER_DISPLAY_NAMES,
  ProviderDriverKind,
  type ProviderInstanceConfig,
  ProviderInstanceId,
  resolveEnvironmentMachineKind,
  resolveProviderInstanceEnabled,
  type ServerProvider,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { type ClientSettingsPatch, DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import {
  getBackgroundActivityPresetSettings,
  resolveServerBackgroundActivitySettings,
} from "@t3tools/shared/backgroundActivitySettings";
import * as Arr from "effect/Array";
import * as Duration from "effect/Duration";
import * as Equal from "effect/Equal";
import * as Result from "effect/Result";

import { isDesktopLocalConnectionTarget } from "../../connection/desktopLocal";
import { resolveAppModelSelectionState } from "../../modelSelection";
import type { EnvironmentPresentation } from "../../state/environments";
import { formatRelativeTime } from "../../timestampFormat";
import {
  isProviderSettingsUpdateCandidate,
  isProviderUpdateActive,
} from "../ProviderUpdateLaunchNotification.logic";
import { readCodexSetupMode } from "./CodexSetupSection.logic";
import {
  getDriverMeta,
  PROVIDER_DRIVER_METAS,
  type ProviderDriverIconKey,
} from "./providerDriverMeta.logic";
import { buildProviderStatusModel, type ProviderStatusModel } from "./providerStatus";
import {
  backgroundActivityOverrideSettings,
  buildProviderInstanceUpdatePatch,
  durationToSeconds,
  normalizeIntervalSeconds,
  PROVIDER_HEALTH_INTERVAL_STEP_SECONDS,
} from "./SettingsPanels.logic";
import { searchableSetting } from "./settingsSearch";
import {
  buildUsageProviderSettingsModel,
  type UsageProviderSettingsModel,
} from "./UsageProviderSettings.logic";

export interface ProviderEnvironmentOptionLike {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

export function isProviderSettingsEnvironmentAvailable(input: {
  readonly connectionPhase: EnvironmentConnectionPhase;
  readonly hasServerConfig: boolean;
}): boolean {
  return input.connectionPhase === "connected" && input.hasServerConfig;
}

export function buildProviderEnvironmentOptions<T extends ProviderEnvironmentOptionLike>(
  environments: ReadonlyArray<T>,
  primaryEnvironmentId: EnvironmentId | null,
  environmentIds?: readonly EnvironmentId[],
): ReadonlyArray<T> {
  const allowed = environmentIds ? new Set(environmentIds) : null;
  return environments
    .filter((environment) => !allowed || allowed.has(environment.environmentId))
    .toSorted((left, right) => {
      const leftIsPrimary = left.environmentId === primaryEnvironmentId;
      const rightIsPrimary = right.environmentId === primaryEnvironmentId;
      if (leftIsPrimary !== rightIsPrimary) {
        return leftIsPrimary ? -1 : 1;
      }
      return (
        left.label.localeCompare(right.label) ||
        String(left.environmentId).localeCompare(String(right.environmentId))
      );
    });
}

export function resolveSelectedProviderEnvironmentId(
  environments: ReadonlyArray<ProviderEnvironmentOptionLike>,
  selectedEnvironmentId: EnvironmentId | null,
  primaryEnvironmentId: EnvironmentId | null,
): EnvironmentId | null {
  if (
    selectedEnvironmentId !== null &&
    environments.some((environment) => environment.environmentId === selectedEnvironmentId)
  ) {
    return selectedEnvironmentId;
  }
  if (
    primaryEnvironmentId !== null &&
    environments.some((environment) => environment.environmentId === primaryEnvironmentId)
  ) {
    return primaryEnvironmentId;
  }
  return environments[0]?.environmentId ?? null;
}

export type ProviderEnvironmentAccess =
  | { readonly kind: "editable" }
  /** `reason` distinguishes waiting on the device from waiting on permissions. */
  | { readonly kind: "loading"; readonly reason: "config" | "permissions" }
  | { readonly kind: "read-only" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "error" };

/**
 * Whether the session may change provider configuration on an environment.
 * `pending` means the answer is still unknown, which must not be presented as
 * editable: rendering controls we already know might be rejected only turns a
 * permission problem into a failed write.
 */
export type ProviderOperateAccess = "granted" | "denied" | "pending";

/**
 * Resolve operate access from an environment's `/api/auth/session` answer.
 *
 * Cached session data wins over an in-flight revalidation. The session atoms
 * are SWR-backed, so they report `isPending` on every background refresh;
 * treating that as unknown would flip a working panel back to loading and
 * discard in-progress edits.
 *
 * `missingScopesAccess` decides the case where the session resolved but did
 * not report scopes: the primary serves the web app itself so its server
 * always reports them (absence means denial), while a remote device may run an
 * older server version that predates scope reporting, where denial would lock
 * out a legitimate session. The environment RPC layer stays authoritative
 * either way.
 */
function resolveSessionOperateAccess(input: {
  readonly session: Pick<AuthSessionState, "authenticated" | "scopes"> | null;
  readonly isPending: boolean;
  readonly hasError: boolean;
  readonly missingScopesAccess: "granted" | "denied";
}): ProviderOperateAccess {
  if (input.session === null) {
    if (input.isPending) {
      return "pending";
    }
    // A failed session fetch is a transport problem, not a permission
    // decision — locking the panel read-only would misreport it. Stay
    // optimistic; the environment RPC layer still rejects unauthorized writes.
    return input.hasError ? "granted" : "denied";
  }
  if (!input.session.authenticated) {
    return "denied";
  }
  if (input.session.scopes === undefined) {
    return input.missingScopesAccess;
  }
  return input.session.scopes.includes(AuthOrchestrationOperateScope) ? "granted" : "denied";
}

/** Operate access for the primary environment's own browser session. */
export function resolvePrimaryOperateAccess(input: {
  readonly isPrimary: boolean;
  readonly hasDesktopBridge: boolean;
  readonly session: Pick<AuthSessionState, "authenticated" | "scopes"> | null;
  readonly isPending: boolean;
  readonly hasError: boolean;
}): ProviderOperateAccess {
  if (!input.isPrimary || input.hasDesktopBridge) {
    return "granted";
  }
  return resolveSessionOperateAccess({
    session: input.session,
    isPending: input.isPending,
    hasError: input.hasError,
    missingScopesAccess: "denied",
  });
}

/**
 * Operate access for a non-primary environment, derived from the scopes its
 * `/api/auth/session` endpoint reports for this client's credential.
 */
export function resolveRemoteOperateAccess(input: {
  readonly session: Pick<AuthSessionState, "authenticated" | "scopes"> | null;
  readonly isPending: boolean;
  readonly hasError: boolean;
}): ProviderOperateAccess {
  return resolveSessionOperateAccess({
    ...input,
    missingScopesAccess: "granted",
  });
}

export function classifyProviderEnvironmentAccess(input: {
  readonly connectionPhase: EnvironmentConnectionPhase;
  readonly hasServerConfig: boolean;
  readonly operateAccess: ProviderOperateAccess;
}): ProviderEnvironmentAccess {
  if (input.connectionPhase === "error") {
    return { kind: "error" };
  }
  if (input.connectionPhase !== "connected") {
    return { kind: "unavailable" };
  }
  if (!input.hasServerConfig) {
    return { kind: "loading", reason: "config" };
  }
  if (input.operateAccess === "pending") {
    return { kind: "loading", reason: "permissions" };
  }
  if (input.operateAccess === "denied") {
    return { kind: "read-only" };
  }
  return { kind: "editable" };
}

export type ProviderSettingsTarget = {
  readonly environmentId?: EnvironmentId;
  readonly instanceId?: ProviderInstanceId;
  readonly scoped?: boolean;
  readonly environmentIds?: readonly EnvironmentId[];
};

export type ProviderEnvironmentTabModel = {
  readonly id: EnvironmentId;
  readonly label: string;
  readonly machineKind: EnvironmentMachineKind;
  readonly connectionPhase: EnvironmentConnectionPhase;
  readonly showStatusDot: boolean;
  readonly detail: string;
  readonly statusText: string;
  readonly accessibleLabel: string;
  readonly tooltip: string;
};

export type ProviderSettingsPlaceholderKind =
  | "device-unavailable"
  | "no-devices"
  | "loading-devices"
  | "loading"
  | "unavailable"
  | "error";

export type ProviderSettingsPlaceholderModel = {
  readonly kind: ProviderSettingsPlaceholderKind;
  readonly machineKind: EnvironmentMachineKind;
  readonly title: string;
  readonly description: string;
  readonly error: string | null;
  readonly showDeviceTabs: boolean;
  readonly section: { readonly id: string; readonly title: string };
};

export type ProviderEnvironmentPickerModelInput = {
  readonly environments: ReadonlyArray<EnvironmentPresentation>;
  readonly isReady: boolean;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly target: ProviderSettingsTarget;
  readonly selectedEnvironmentId: EnvironmentId | null;
};

export type ProviderEnvironmentPickerModel = {
  readonly ariaLabel: string;
  readonly tabs: ReadonlyArray<ProviderEnvironmentTabModel>;
  readonly showDeviceTabs: boolean;
  readonly effectiveEnvironmentId: EnvironmentId | null;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedEnvironmentCanRenderSettings: boolean;
  readonly selectedEnvironmentPlatformOs: string | null;
  readonly targetInstanceId: ProviderInstanceId | null;
  readonly placeholder: ProviderSettingsPlaceholderModel | null;
  readonly searchableEnvironmentId: EnvironmentId | null;
  readonly searchableCursorEnvironmentId: EnvironmentId | null;
};

function providerEnvironmentDetail(environment: EnvironmentPresentation): string {
  if (environment.entry.target._tag === "PrimaryConnectionTarget") return "Primary device";
  if (environment.relayManaged) return "T3 Connect";
  if (environment.entry.target._tag === "SshConnectionTarget") return "SSH";
  if (isDesktopLocalConnectionTarget(environment.entry.target)) return "Local device";
  return environment.displayUrl ?? "Remote device";
}

function canRenderProviderSettings(environment: EnvironmentPresentation): boolean {
  return isProviderSettingsEnvironmentAvailable({
    connectionPhase: environment.connection.phase,
    hasServerConfig: environment.serverConfig !== null,
  });
}

export function buildProviderEnvironmentPickerModel(
  input: ProviderEnvironmentPickerModelInput,
): ProviderEnvironmentPickerModel {
  const { target } = input;
  const options = buildProviderEnvironmentOptions(
    input.environments,
    input.primaryEnvironmentId,
    target.environmentIds,
  );
  const targetEnvironmentMissing =
    target.environmentId !== undefined &&
    input.selectedEnvironmentId === target.environmentId &&
    !options.some((environment) => environment.environmentId === target.environmentId);
  const effectiveEnvironmentId =
    target.scoped || targetEnvironmentMissing
      ? (target.environmentId ?? null)
      : resolveSelectedProviderEnvironmentId(
          options,
          input.selectedEnvironmentId,
          input.primaryEnvironmentId,
        );
  const selectedEnvironment =
    options.find((environment) => environment.environmentId === effectiveEnvironmentId) ?? null;
  const onlyPrimaryDevice =
    options.length === 1 && options[0]?.entry.target._tag === "PrimaryConnectionTarget";
  const showDeviceTabs = !target.scoped && !onlyPrimaryDevice && options.length > 0;
  const genericMachineKind = resolveEnvironmentMachineKind(null);
  const placeholder: ProviderSettingsPlaceholderModel | null = targetEnvironmentMissing
    ? {
        kind: "device-unavailable",
        machineKind: genericMachineKind,
        title: "Device unavailable",
        description: "Reconnect this device to set up its provider, or select another device.",
        error: null,
        showDeviceTabs,
        section: searchableSetting("providers"),
      }
    : options.length === 0
      ? {
          kind: input.isReady ? "no-devices" : "loading-devices",
          machineKind: genericMachineKind,
          title: input.isReady ? "No connected devices" : "Loading devices",
          description: input.isReady
            ? "Connect an execution environment before configuring providers."
            : "Reading connected execution environments.",
          error: null,
          showDeviceTabs: false,
          section: searchableSetting("providers"),
        }
      : null;
  return {
    ariaLabel: "Devices",
    tabs: options.map((environment) => {
      const detail = providerEnvironmentDetail(environment);
      const statusText = connectionStatusTitle(environment.connection);
      return {
        id: environment.environmentId,
        label: environment.label,
        machineKind: resolveEnvironmentMachineKind(environment.serverConfig),
        connectionPhase: environment.connection.phase,
        showStatusDot: environment.connection.phase !== "connected",
        detail,
        statusText,
        accessibleLabel: `${detail}, ${statusText}`,
        tooltip: `${detail} · ${statusText}`,
      };
    }),
    showDeviceTabs,
    effectiveEnvironmentId,
    selectedEnvironmentId: selectedEnvironment?.environmentId ?? null,
    selectedEnvironmentCanRenderSettings:
      selectedEnvironment !== null && canRenderProviderSettings(selectedEnvironment),
    selectedEnvironmentPlatformOs:
      selectedEnvironment?.serverConfig?.environment.platform.os ?? null,
    targetInstanceId:
      selectedEnvironment !== null &&
      (target.environmentId === undefined ||
        selectedEnvironment.environmentId === target.environmentId)
        ? (target.instanceId ?? null)
        : null,
    placeholder,
    searchableEnvironmentId: options.find(canRenderProviderSettings)?.environmentId ?? null,
    searchableCursorEnvironmentId:
      options.find(
        (environment) =>
          environment.serverConfig?.environment.platform.os === "darwin" &&
          isProviderSettingsEnvironmentAvailable({
            connectionPhase: environment.connection.phase,
            hasServerConfig: true,
          }),
      )?.environmentId ?? null,
  };
}

export function resolveProviderSearchTargetEnvironment(input: {
  readonly scoped: boolean;
  readonly searchTargetId: string | null;
  readonly picker: ProviderEnvironmentPickerModel;
}): EnvironmentId | null {
  const { picker } = input;
  if (input.scoped) return null;
  if (
    input.searchTargetId === "cursor-keychain-usage" &&
    (!picker.selectedEnvironmentCanRenderSettings ||
      picker.selectedEnvironmentPlatformOs !== "darwin") &&
    picker.searchableCursorEnvironmentId !== null
  ) {
    return picker.searchableCursorEnvironmentId;
  }
  if (
    (input.searchTargetId === "provider-health-check-interval" ||
      input.searchTargetId === "usage-providers") &&
    !picker.selectedEnvironmentCanRenderSettings &&
    picker.searchableEnvironmentId !== null
  ) {
    return picker.searchableEnvironmentId;
  }
  return null;
}

export type ProviderOperateAccessSource = "granted" | "primary-session" | "remote-session";

export function resolveProviderOperateAccessSource(input: {
  readonly isPrimary: boolean;
  readonly isElectron: boolean;
}): ProviderOperateAccessSource {
  if (!input.isPrimary) return "remote-session";
  return input.isElectron ? "granted" : "primary-session";
}

export type ProviderEnvironmentView =
  | { readonly kind: "placeholder"; readonly placeholder: ProviderSettingsPlaceholderModel }
  | { readonly kind: "settings"; readonly readOnly: boolean };

export function resolveProviderEnvironmentView(input: {
  readonly environment: EnvironmentPresentation;
  readonly operateAccess: ProviderOperateAccess;
  readonly showDeviceTabs: boolean;
}): ProviderEnvironmentView {
  const { environment } = input;
  const access = classifyProviderEnvironmentAccess({
    connectionPhase: environment.connection.phase,
    hasServerConfig: environment.serverConfig !== null,
    operateAccess: input.operateAccess,
  });
  if (access.kind === "editable" || access.kind === "read-only") {
    return { kind: "settings", readOnly: access.kind === "read-only" };
  }
  const isLoading = access.kind === "loading";
  return {
    kind: "placeholder",
    placeholder: {
      kind: access.kind,
      machineKind: resolveEnvironmentMachineKind(environment.serverConfig),
      title: isLoading
        ? "Loading provider settings"
        : access.kind === "error"
          ? "Could not connect to this device"
          : "Provider settings are unavailable",
      description: isLoading
        ? access.reason === "permissions"
          ? "Checking what this session is allowed to change."
          : `Waiting for ${environment.label}'s configuration.`
        : connectionStatusTitle(environment.connection),
      error: isLoading ? null : (environment.connection.error ?? null),
      showDeviceTabs: input.showDeviceTabs,
      section: searchableSetting("providers"),
    },
  };
}

export type ProviderLastCheckedModel =
  | { readonly kind: "missing" }
  | { readonly kind: "invalid"; readonly text: string }
  | {
      readonly kind: "relative";
      readonly prefix: string;
      readonly value: string;
      readonly suffix: string | null;
    };

export function buildProviderLastCheckedModel(
  lastCheckedAt: string | null,
  nowMs: number,
): ProviderLastCheckedModel {
  if (!lastCheckedAt) return { kind: "missing" };
  const relative = formatRelativeTime(lastCheckedAt, nowMs);
  if (!relative) return { kind: "invalid", text: "Checked unavailable" };
  return { kind: "relative", prefix: "Checked", value: relative.value, suffix: relative.suffix };
}

export type ProviderInstanceRow = {
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly driver: ProviderDriverKind;
  readonly isDefault: boolean;
  readonly isDirty: boolean;
};

function legacyProviderSettings(
  providers: UnifiedSettings["providers"],
  driver: ProviderDriverKind,
) {
  return Object.entries(providers).find(([key]) => key === driver)?.[1];
}

export function buildProviderInstanceRows(input: {
  readonly settings: UnifiedSettings;
  readonly serverProviders: ReadonlyArray<ServerProvider>;
}): ReadonlyArray<ProviderInstanceRow> {
  const { settings } = input;
  const visibleDrivers = PROVIDER_DRIVER_METAS.filter(
    (meta) =>
      meta.value !== "cursor" ||
      input.serverProviders.some(
        (provider) =>
          provider.instanceId === defaultInstanceIdForDriver(ProviderDriverKind.make("cursor")),
      ),
  ).map((meta) => meta.value);

  const instancesByDriver = new Map<
    ProviderDriverKind,
    Array<[ProviderInstanceId, ProviderInstanceConfig]>
  >();
  for (const [rawId, instance] of Object.entries(settings.providerInstances ?? {})) {
    const list = instancesByDriver.get(instance.driver) ?? [];
    list.push([ProviderInstanceId.make(rawId), instance]);
    instancesByDriver.set(instance.driver, list);
  }

  const defaultSlotIds = new Set<string>(
    visibleDrivers.map((driver) => String(defaultInstanceIdForDriver(driver))),
  );
  const visibleDriverKinds = new Set<ProviderDriverKind>(visibleDrivers);
  const rows: ProviderInstanceRow[] = [];

  for (const driver of visibleDrivers) {
    const defaultInstanceId = defaultInstanceIdForDriver(driver);
    const explicitInstance = settings.providerInstances?.[defaultInstanceId];
    // A remote device may run a server version whose settings predate this
    // driver, so the legacy mirror can be absent. Without either an explicit
    // instance or a legacy blob there is nothing to render for the slot.
    const legacyConfig = legacyProviderSettings(settings.providers, driver);
    const defaultLegacyConfig = legacyProviderSettings(DEFAULT_UNIFIED_SETTINGS.providers, driver);
    // The envelope is the single enabled flag: keep the legacy in-config
    // flag out of the synthesized blob, or an explicit `enabled: false`
    // would keep winning over the envelope and the Switch could never
    // turn a default-off provider on.
    const synthesizedInstance = (): ProviderInstanceConfig | undefined => {
      if (legacyConfig === undefined) {
        return undefined;
      }
      const { enabled: legacyEnabled, ...legacyConfigRest } = legacyConfig;
      return {
        driver,
        enabled: legacyEnabled,
        config: legacyConfigRest,
      } satisfies ProviderInstanceConfig;
    };
    const effectiveInstance = explicitInstance ?? synthesizedInstance();
    // Only the default slot depends on the legacy blob; custom instances for
    // the driver must still render even when the slot has nothing to show.
    if (effectiveInstance !== undefined) {
      rows.push({
        instanceId: defaultInstanceId,
        instance: effectiveInstance,
        driver,
        isDefault: true,
        isDirty: explicitInstance !== undefined || !Equal.equals(legacyConfig, defaultLegacyConfig),
      });
    }
    for (const [id, instance] of instancesByDriver.get(driver) ?? []) {
      if (id === defaultInstanceId) continue;
      rows.push({
        instanceId: id,
        instance,
        driver: instance.driver,
        isDefault: false,
        isDirty: false,
      });
    }
  }
  for (const [driver, list] of instancesByDriver) {
    if (visibleDriverKinds.has(driver)) continue;
    for (const [id, instance] of list) {
      rows.push({
        instanceId: id,
        instance,
        driver: instance.driver,
        isDefault: defaultSlotIds.has(String(id)),
        isDirty: false,
      });
    }
  }
  return rows;
}

export function configuredBinaryPath(config: unknown): string {
  if (config === null || typeof config !== "object" || !("binaryPath" in config)) return "";
  return typeof config.binaryPath === "string" ? config.binaryPath.trim() : "";
}

export type ProviderInstanceSetupKind = "antigravity" | "codex-managed";

export type ProviderInstanceUpdateModel = {
  readonly available: boolean;
  readonly running: boolean;
  readonly canRun: boolean;
};

export type ProviderInstanceRowModel = {
  readonly id: ProviderInstanceId;
  readonly order: number;
  readonly driver: ProviderDriverKind;
  readonly driverLabel: string | null;
  readonly label: string;
  readonly iconKey: ProviderDriverIconKey | null;
  readonly accentColor: string | null;
  readonly badgeLabel: string | null;
  readonly isDefault: boolean;
  readonly isDirty: boolean;
  readonly enabled: boolean;
  readonly selected: boolean;
  readonly status: ProviderStatusModel;
  readonly instance: ProviderInstanceConfig;
  readonly setup: ProviderInstanceSetupKind | null;
  readonly binaryPath: string;
  readonly canDelete: boolean;
  readonly resetLabel: string | null;
  readonly update: ProviderInstanceUpdateModel;
  readonly canInstallRecommended: boolean;
  readonly hiddenModels: ReadonlyArray<string>;
  readonly modelOrder: ReadonlyArray<string>;
  readonly favoriteModels: ReadonlyArray<string>;
};

export type ProviderSettingsActionModel = {
  readonly label: string;
  readonly icon: "refresh" | "plus";
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly busyText: string | null;
};

export type ProviderHealthIntervalModel = {
  readonly id: string;
  readonly title: string;
  readonly sectionTitle: string;
  readonly policyTooltip: string;
  readonly description: string;
  readonly value: number;
  readonly defaultValue: number;
  readonly min: number;
  readonly step: number;
  readonly unitLabel: string;
  readonly disabled: boolean;
  readonly resetLabel: string | null;
  readonly decrementAriaLabel: string;
  readonly inputAriaLabel: string;
  readonly incrementAriaLabel: string;
};

export type ProviderInstanceListModelInput = {
  readonly settings: UnifiedSettings;
  readonly serverProviders: ReadonlyArray<ServerProvider>;
  readonly environmentLabel: string;
  readonly readOnly: boolean;
  readonly selectedInstanceId: ProviderInstanceId | null;
  readonly targetInstanceId: ProviderInstanceId | null;
  readonly isRefreshing: boolean;
  readonly updatingInstanceIds: ReadonlyArray<ProviderInstanceId>;
};

export type ProviderInstanceListModel = {
  readonly section: { readonly id: string; readonly title: string };
  readonly readOnly: boolean;
  readonly lastCheckedAt: string | null;
  readonly refreshAction: ProviderSettingsActionModel | null;
  readonly addAction: ProviderSettingsActionModel | null;
  readonly readOnlyNotice: { readonly title: string; readonly description: string } | null;
  readonly rows: ReadonlyArray<ProviderInstanceRowModel>;
  readonly selectedInstanceId: ProviderInstanceId | null;
  readonly targetInstanceMissing: boolean;
  readonly emptyMessage: string | null;
  readonly healthInterval: ProviderHealthIntervalModel;
};

function latestProviderCheckedAt(serverProviders: ReadonlyArray<ServerProvider>): string | null {
  return serverProviders.reduce<string | null>(
    (latest, provider) =>
      latest === null || provider.checkedAt > latest ? provider.checkedAt : latest,
    null,
  );
}

function resolveSelectedRow(
  rows: ReadonlyArray<ProviderInstanceRow>,
  selectedInstanceId: ProviderInstanceId | null,
  targetInstanceId: ProviderInstanceId | null,
): { readonly row: ProviderInstanceRow | null; readonly targetInstanceMissing: boolean } {
  const targetInstanceMissing =
    targetInstanceId !== null &&
    selectedInstanceId === targetInstanceId &&
    !rows.some((row) => row.instanceId === targetInstanceId);
  return {
    row:
      rows.find((row) => row.instanceId === selectedInstanceId) ??
      (targetInstanceMissing ? null : (rows[0] ?? null)),
    targetInstanceMissing,
  };
}

function providerHealthInterval(settings: UnifiedSettings) {
  const resolved = resolveServerBackgroundActivitySettings(settings);
  return {
    resolved,
    seconds: durationToSeconds(resolved.providerHealthRefreshInterval),
    defaultSeconds: durationToSeconds(
      getBackgroundActivityPresetSettings(resolved.profile).providerHealthRefreshInterval,
    ),
  };
}

function findUpdateCandidate(
  serverProviders: ReadonlyArray<ServerProvider>,
  instanceId: ProviderInstanceId,
) {
  return serverProviders.findLast(
    (provider) => provider.instanceId === instanceId && isProviderSettingsUpdateCandidate(provider),
  );
}

function hasRecommendedInstall(provider: ServerProvider | undefined): boolean {
  return Boolean(
    provider?.compatibilityAdvisory?.message &&
    provider.compatibilityAdvisory.recommendedVersion &&
    provider.versionAdvisory?.canInstallVersion,
  );
}

export function buildProviderInstanceListModel(
  input: ProviderInstanceListModelInput,
): ProviderInstanceListModel {
  const { settings, serverProviders } = input;
  const rows = buildProviderInstanceRows({ settings, serverProviders });
  const selected = resolveSelectedRow(rows, input.selectedInstanceId, input.targetInstanceId);
  const updatingInstanceIds = new Set(input.updatingInstanceIds);
  const lastCheckedAt = latestProviderCheckedAt(serverProviders);
  const health = providerHealthInterval(settings);

  return {
    section: searchableSetting("providers"),
    readOnly: input.readOnly,
    lastCheckedAt,
    refreshAction: input.readOnly
      ? null
      : {
          label: "Refresh provider status",
          icon: "refresh",
          disabled: input.isRefreshing,
          busy: input.isRefreshing,
          busyText: input.isRefreshing ? "Refreshing providers" : null,
        },
    addAction: input.readOnly
      ? null
      : { label: "Add provider", icon: "plus", disabled: false, busy: false, busyText: null },
    readOnlyNotice: input.readOnly
      ? {
          title: "Limited permissions",
          description: `This session can view ${input.environmentLabel}'s providers but can't change their settings.`,
        }
      : null,
    rows: rows.map((row, order) => {
      const meta = getDriverMeta(row.driver);
      const liveProvider = serverProviders.find(
        (candidate) => candidate.instanceId === row.instanceId,
      );
      const enabled = resolveProviderInstanceEnabled(row.instance);
      const updateAvailable = findUpdateCandidate(serverProviders, row.instanceId) !== undefined;
      const updateRunning =
        updatingInstanceIds.has(row.instanceId) ||
        (liveProvider !== undefined && isProviderUpdateActive(liveProvider));
      const modelPreferences = settings.providerModelPreferences?.[row.instanceId];
      const codexManaged =
        row.driver === "codex" && readCodexSetupMode(row.instance.config) === "managed";
      return {
        id: row.instanceId,
        order,
        driver: row.driver,
        driverLabel: meta?.label ?? null,
        label: row.instance.displayName?.trim() || meta?.label || String(row.instance.driver),
        iconKey: meta?.iconKey ?? null,
        accentColor: normalizeProviderAccentColor(row.instance.accentColor) ?? null,
        badgeLabel: meta?.badgeLabel ?? null,
        isDefault: row.isDefault,
        isDirty: row.isDirty,
        enabled,
        selected: selected.row?.instanceId === row.instanceId,
        status: buildProviderStatusModel({ enabled, provider: liveProvider }),
        instance: row.instance,
        setup: row.driver === "antigravity" ? "antigravity" : codexManaged ? "codex-managed" : null,
        binaryPath: configuredBinaryPath(row.instance.config),
        canDelete: !row.isDefault,
        resetLabel:
          row.isDefault && row.isDirty
            ? `${meta?.label ?? String(row.driver)} provider settings`
            : null,
        update: {
          available: updateAvailable,
          running: updateRunning,
          canRun: updateAvailable && !updateRunning,
        },
        canInstallRecommended: hasRecommendedInstall(liveProvider),
        hiddenModels: modelPreferences?.hiddenModels ?? [],
        modelOrder: modelPreferences?.modelOrder ?? [],
        favoriteModels: Arr.filterMap(settings.favorites ?? [], (favorite) =>
          favorite.provider === row.instanceId ? Result.succeed(favorite.model) : Result.failVoid,
        ),
      };
    }),
    selectedInstanceId: selected.row?.instanceId ?? null,
    targetInstanceMissing: selected.targetInstanceMissing,
    emptyMessage:
      selected.row !== null
        ? null
        : selected.targetInstanceMissing
          ? "This provider instance is no longer available on this device."
          : "No providers configured.",
    healthInterval: {
      ...searchableSetting("provider-health-check-interval"),
      sectionTitle: "Advanced",
      policyTooltip:
        "This interval is configured here, then the shared Background activity policy decides whether provider probes may run when the timer fires. Custom intervals appear as Advanced in General settings.",
      description:
        "Refresh provider status, versions, and models in the background. Set to 0 to disable.",
      value: health.seconds,
      defaultValue: health.defaultSeconds,
      min: 0,
      step: PROVIDER_HEALTH_INTERVAL_STEP_SECONDS,
      unitLabel: "seconds",
      disabled: input.readOnly,
      resetLabel:
        health.seconds !== health.defaultSeconds ? "provider health check interval" : null,
      decrementAriaLabel: "Decrease provider health check interval",
      inputAriaLabel: "Provider health check interval in seconds",
      incrementAriaLabel: "Increase provider health check interval",
    },
  };
}

export type ProviderSettingsChange =
  | { readonly kind: "select-instance"; readonly instanceId: ProviderInstanceId }
  | {
      readonly kind: "update-instance";
      readonly instanceId: ProviderInstanceId;
      readonly next: ProviderInstanceConfig;
    }
  | { readonly kind: "enable-instance"; readonly instanceId: ProviderInstanceId }
  | {
      readonly kind: "set-codex-setup-mode";
      readonly instanceId: ProviderInstanceId;
      readonly setupMode: "managed" | "existing";
    }
  | { readonly kind: "remove-instance"; readonly instanceId: ProviderInstanceId }
  | { readonly kind: "reset-default-instance"; readonly instanceId: ProviderInstanceId }
  | {
      readonly kind: "set-hidden-models";
      readonly instanceId: ProviderInstanceId;
      readonly hiddenModels: ReadonlyArray<string>;
    }
  | {
      readonly kind: "set-model-order";
      readonly instanceId: ProviderInstanceId;
      readonly modelOrder: ReadonlyArray<string>;
    }
  | {
      readonly kind: "set-favorite-models";
      readonly instanceId: ProviderInstanceId;
      readonly models: ReadonlyArray<string>;
    }
  | { readonly kind: "add-instance" }
  | { readonly kind: "refresh" }
  | { readonly kind: "run-update"; readonly instanceId: ProviderInstanceId }
  | { readonly kind: "install-recommended"; readonly instanceId: ProviderInstanceId }
  | { readonly kind: "set-health-interval"; readonly seconds: number | null }
  | { readonly kind: "reset-health-interval" };

export type ProviderSettingsDecision =
  | { readonly kind: "none" }
  | { readonly kind: "select-instance"; readonly instanceId: ProviderInstanceId }
  | { readonly kind: "update-environment-settings"; readonly patch: Partial<UnifiedSettings> }
  | { readonly kind: "update-client-settings"; readonly patch: ClientSettingsPatch }
  | { readonly kind: "open-add-instance-dialog" }
  | { readonly kind: "refresh-providers" }
  | {
      readonly kind: "run-provider-update";
      readonly driver: ProviderDriverKind;
      readonly instanceId: ProviderInstanceId;
      readonly targetVersion: string | null;
    };

export type ProviderSettingsChangeInput = {
  readonly settings: UnifiedSettings;
  readonly serverProviders: ReadonlyArray<ServerProvider>;
  readonly readOnly: boolean;
  readonly isRefreshing: boolean;
  readonly updatingInstanceIds: ReadonlyArray<ProviderInstanceId>;
};

function withoutProviderInstanceKey<V>(
  record: Readonly<Record<ProviderInstanceId, V>> | undefined,
  key: ProviderInstanceId,
): Record<ProviderInstanceId, V> {
  const next: Record<ProviderInstanceId, V> = { ...record };
  delete next[key];
  return next;
}

function uniqueNonEmptySlugs(slugs: ReadonlyArray<string>): string[] {
  return [...new Set(slugs.filter((slug) => slug.trim().length > 0))];
}

function modelPreferencesPatch(
  settings: UnifiedSettings,
  instanceId: ProviderInstanceId,
  next: {
    readonly hiddenModels: ReadonlyArray<string>;
    readonly modelOrder: ReadonlyArray<string>;
  },
): ClientSettingsPatch {
  const hiddenModels = uniqueNonEmptySlugs(next.hiddenModels);
  const modelOrder = uniqueNonEmptySlugs(next.modelOrder);
  const rest = withoutProviderInstanceKey(settings.providerModelPreferences, instanceId);
  return {
    providerModelPreferences:
      hiddenModels.length === 0 && modelOrder.length === 0
        ? rest
        : { ...rest, [instanceId]: { hiddenModels, modelOrder } },
  };
}

function instanceUpdateDecision(
  settings: UnifiedSettings,
  row: ProviderInstanceRow,
  next: ProviderInstanceConfig,
  textGenerationModelSelection?: UnifiedSettings["textGenerationModelSelection"],
): ProviderSettingsDecision {
  return {
    kind: "update-environment-settings",
    patch: buildProviderInstanceUpdatePatch({
      settings,
      instanceId: row.instanceId,
      instance: next,
      driver: row.driver,
      isDefault: row.isDefault,
      textGenerationModelSelection,
    }),
  };
}

const NO_PROVIDER_SETTINGS_DECISION: ProviderSettingsDecision = { kind: "none" };

export function resolveProviderSettingsChange(
  input: ProviderSettingsChangeInput,
  change: ProviderSettingsChange,
): ProviderSettingsDecision {
  const { settings, serverProviders } = input;
  switch (change.kind) {
    case "select-instance":
      return { kind: "select-instance", instanceId: change.instanceId };
    case "add-instance":
      return input.readOnly ? NO_PROVIDER_SETTINGS_DECISION : { kind: "open-add-instance-dialog" };
    case "refresh":
      return input.isRefreshing ? NO_PROVIDER_SETTINGS_DECISION : { kind: "refresh-providers" };
    case "set-health-interval":
    case "reset-health-interval": {
      const health = providerHealthInterval(settings);
      return {
        kind: "update-environment-settings",
        patch: backgroundActivityOverrideSettings(settings.backgroundActivity, health.resolved, {
          providerHealthRefreshInterval:
            change.kind === "set-health-interval"
              ? Duration.seconds(normalizeIntervalSeconds(change.seconds))
              : undefined,
        }),
      };
    }
    case "set-favorite-models": {
      const favoriteModels = [
        ...new Set(
          Arr.filterMap(change.models, (slug) => {
            const trimmedSlug = slug.trim();
            return trimmedSlug.length > 0 ? Result.succeed(trimmedSlug) : Result.failVoid;
          }),
        ),
      ];
      return {
        kind: "update-client-settings",
        patch: {
          favorites: [
            ...(settings.favorites ?? []).filter(
              (favorite) => favorite.provider !== change.instanceId,
            ),
            ...favoriteModels.map((model) => ({ provider: change.instanceId, model })),
          ],
        },
      };
    }
    case "set-hidden-models":
    case "set-model-order": {
      const current = settings.providerModelPreferences?.[change.instanceId] ?? {
        hiddenModels: [],
        modelOrder: [],
      };
      return {
        kind: "update-client-settings",
        patch: modelPreferencesPatch(
          settings,
          change.instanceId,
          change.kind === "set-hidden-models"
            ? { hiddenModels: change.hiddenModels, modelOrder: current.modelOrder }
            : { hiddenModels: current.hiddenModels, modelOrder: change.modelOrder },
        ),
      };
    }
    case "run-update": {
      const candidate = findUpdateCandidate(serverProviders, change.instanceId);
      const running =
        input.updatingInstanceIds.includes(change.instanceId) ||
        serverProviders.some(
          (provider) =>
            provider.instanceId === change.instanceId && isProviderUpdateActive(provider),
        );
      if (candidate === undefined || running) return NO_PROVIDER_SETTINGS_DECISION;
      return {
        kind: "run-provider-update",
        driver: candidate.driver,
        instanceId: candidate.instanceId,
        targetVersion: null,
      };
    }
    case "install-recommended": {
      const liveProvider = serverProviders.find(
        (provider) => provider.instanceId === change.instanceId,
      );
      if (liveProvider === undefined || !hasRecommendedInstall(liveProvider)) {
        return NO_PROVIDER_SETTINGS_DECISION;
      }
      return {
        kind: "run-provider-update",
        driver: liveProvider.driver,
        instanceId: liveProvider.instanceId,
        targetVersion: liveProvider.compatibilityAdvisory?.recommendedVersion ?? null,
      };
    }
    case "update-instance":
    case "enable-instance":
    case "set-codex-setup-mode":
    case "remove-instance":
    case "reset-default-instance":
      break;
  }

  const row = buildProviderInstanceRows({ settings, serverProviders }).find(
    (candidate) => candidate.instanceId === change.instanceId,
  );
  if (row === undefined) return NO_PROVIDER_SETTINGS_DECISION;

  switch (change.kind) {
    case "update-instance": {
      const isDisabling =
        change.next.enabled === false && resolveProviderInstanceEnabled(row.instance);
      const textGenInstanceId = resolveAppModelSelectionState(settings, serverProviders).instanceId;
      return instanceUpdateDecision(
        settings,
        row,
        change.next,
        isDisabling && textGenInstanceId === row.instanceId
          ? DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection
          : undefined,
      );
    }
    case "enable-instance":
      return instanceUpdateDecision(settings, row, { ...row.instance, enabled: true });
    case "set-codex-setup-mode": {
      const config = row.instance.config;
      return instanceUpdateDecision(settings, row, {
        ...row.instance,
        enabled: true,
        config: {
          ...(config !== null && typeof config === "object" ? config : {}),
          enabled: true,
          setupMode: change.setupMode,
        },
      });
    }
    case "remove-instance":
      if (row.isDefault) return NO_PROVIDER_SETTINGS_DECISION;
      return {
        kind: "update-environment-settings",
        patch: {
          providerInstances: withoutProviderInstanceKey(settings.providerInstances, row.instanceId),
        },
      };
    case "reset-default-instance": {
      if (!row.isDefault) return NO_PROVIDER_SETTINGS_DECISION;
      const defaultLegacyProvider = legacyProviderSettings(
        DEFAULT_UNIFIED_SETTINGS.providers,
        row.driver,
      );
      if (defaultLegacyProvider === undefined) return NO_PROVIDER_SETTINGS_DECISION;
      return {
        kind: "update-environment-settings",
        patch: {
          providers: { ...settings.providers, [row.driver]: defaultLegacyProvider },
          providerInstances: withoutProviderInstanceKey(
            settings.providerInstances,
            defaultInstanceIdForDriver(row.driver),
          ),
        },
      };
    }
    default:
      return NO_PROVIDER_SETTINGS_DECISION;
  }
}

export function buildProviderUpdateFailureToast(input: {
  readonly driver: ProviderDriverKind;
  readonly errorMessage: string | null;
}): { readonly title: string; readonly description: string } {
  return {
    title: `Could not update ${PROVIDER_DISPLAY_NAMES[input.driver] ?? input.driver}`,
    description: input.errorMessage ?? "The provider update command could not be started.",
  };
}

export type ProviderSettingsModelInput = ProviderEnvironmentPickerModelInput & {
  readonly isElectron: boolean;
  readonly session: {
    readonly data: Pick<AuthSessionState, "authenticated" | "scopes"> | null;
    readonly isPending: boolean;
    readonly hasError: boolean;
  };
  readonly settings: UnifiedSettings;
  readonly serverProviders: ReadonlyArray<ServerProvider>;
  readonly selectedInstanceId: ProviderInstanceId | null;
  readonly isRefreshing: boolean;
  readonly updatingInstanceIds: ReadonlyArray<ProviderInstanceId>;
  readonly updatingCursorUsage: boolean;
  readonly addingUsageHub: boolean;
  readonly nowMs: number;
};

export type ProviderSettingsContentModel =
  | { readonly kind: "empty" }
  | { readonly kind: "placeholder"; readonly placeholder: ProviderSettingsPlaceholderModel }
  | {
      readonly kind: "settings";
      readonly environmentId: EnvironmentId;
      readonly environmentLabel: string;
      readonly readOnly: boolean;
      readonly instances: ProviderInstanceListModel;
      readonly lastChecked: ProviderLastCheckedModel;
      readonly usage: UsageProviderSettingsModel;
    };

export type ProviderSettingsModel = {
  readonly environmentPicker: ProviderEnvironmentPickerModel;
  readonly content: ProviderSettingsContentModel;
};

function resolveOperateAccess(
  input: ProviderSettingsModelInput,
  environment: EnvironmentPresentation,
): ProviderOperateAccess {
  const source = resolveProviderOperateAccessSource({
    isPrimary: environment.entry.target._tag === "PrimaryConnectionTarget",
    isElectron: input.isElectron,
  });
  if (source === "granted") return "granted";
  if (source === "primary-session") {
    return resolvePrimaryOperateAccess({
      isPrimary: true,
      hasDesktopBridge: false,
      session: input.session.data,
      isPending: input.session.isPending,
      hasError: input.session.hasError,
    });
  }
  return resolveRemoteOperateAccess({
    session: input.session.data,
    isPending: input.session.isPending,
    hasError: input.session.hasError,
  });
}

export function buildProviderSettingsModel(
  input: ProviderSettingsModelInput,
): ProviderSettingsModel {
  const environmentPicker = buildProviderEnvironmentPickerModel(input);
  if (environmentPicker.placeholder !== null) {
    return {
      environmentPicker,
      content: { kind: "placeholder", placeholder: environmentPicker.placeholder },
    };
  }
  const environment = input.environments.find(
    (candidate) => candidate.environmentId === environmentPicker.selectedEnvironmentId,
  );
  if (environment === undefined) {
    return { environmentPicker, content: { kind: "empty" } };
  }
  const view = resolveProviderEnvironmentView({
    environment,
    operateAccess: resolveOperateAccess(input, environment),
    showDeviceTabs: environmentPicker.showDeviceTabs,
  });
  if (view.kind === "placeholder") {
    return { environmentPicker, content: view };
  }
  return {
    environmentPicker,
    content: {
      kind: "settings",
      environmentId: environment.environmentId,
      environmentLabel: environment.label,
      readOnly: view.readOnly,
      instances: buildProviderInstanceListModel({
        settings: input.settings,
        serverProviders: input.serverProviders,
        environmentLabel: environment.label,
        readOnly: view.readOnly,
        selectedInstanceId: input.selectedInstanceId ?? environmentPicker.targetInstanceId,
        targetInstanceId: environmentPicker.targetInstanceId,
        isRefreshing: input.isRefreshing,
        updatingInstanceIds: input.updatingInstanceIds,
      }),
      lastChecked: buildProviderLastCheckedModel(
        latestProviderCheckedAt(input.serverProviders),
        input.nowMs,
      ),
      usage: buildUsageProviderSettingsModel({
        sources: input.settings.usageLimitSources,
        cursorKeychainUsageEnabled: input.settings.cursorKeychainUsageEnabled,
        platformOs: environment.serverConfig?.environment.platform.os ?? null,
        readOnly: view.readOnly,
        updatingCursor: input.updatingCursorUsage,
        adding: input.addingUsageHub,
      }),
    },
  };
}
