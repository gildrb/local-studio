import {
  type BackgroundActivityProfile,
  type DesktopUpdateChannel,
  type DesktopUpdateState,
  type EnvironmentId,
  type ModelSelection,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
  type SidebarProjectGroupingMode,
} from "@t3tools/contracts";
import {
  DEFAULT_UNIFIED_SETTINGS,
  type DiffLayout,
  MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
  type QuitConfirmationMode,
  type ResponseStreamingMode,
  type ServerSettings,
  type TimestampFormat,
  type UnifiedSettings,
} from "@t3tools/contracts/settings";
import { resolveServerBackgroundActivitySettings } from "@t3tools/shared/backgroundActivitySettings";
import { createModelSelection } from "@t3tools/shared/model";
import * as Duration from "effect/Duration";
import * as Equal from "effect/Equal";

import type { HostedAppChannel } from "../../hostedPairing";
import { resolveAppModelSelectionState } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  type ProviderInstanceEntry,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import type { ProviderOptions } from "../chat/TraitsPicker.logic";
import {
  canCheckForUpdate,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
} from "../desktopUpdate.logic";
import type { ScopedSettingsPatch } from "./scopedSettings";
import {
  backgroundActivityOverrideSettings,
  backgroundActivitySharedPolicySettings,
  durationToSeconds,
  isProjectGroupingEnabled,
  normalizeIntervalSeconds,
  projectGroupingModeFromToggle,
  PROVIDER_HEALTH_INTERVAL_STEP_SECONDS,
  resolveBackgroundActivityProfileOption,
} from "./SettingsPanels.logic";
import { searchableSetting, type SettingsSearchItemId } from "./settingsSearch";

export type SendShortcut = UnifiedSettings["sendShortcut"];
export type FollowUpBehavior = UnifiedSettings["followUpBehavior"];
export type DiffFileState = "expanded" | "collapsed";
export type BackgroundActivityProfileOption = BackgroundActivityProfile | "advanced";

export const RESPONSE_STREAMING_MODE_LABELS: Record<ResponseStreamingMode, string> = {
  turn: "Wait for the full response",
  paragraph: "Show finished paragraphs",
  token: "Token by token (legacy)",
};

export const RESPONSE_STREAMING_MODE_DESCRIPTIONS: Record<ResponseStreamingMode, string> = {
  turn: "Text appears once the agent finishes its turn.",
  paragraph: "Each paragraph or code block appears as soon as it is complete.",
  token:
    "Every token repaints the answer as it arrives. Slower and harder to read. Thinking traces still arrive a paragraph at a time.",
};

export const TIMESTAMP_FORMAT_LABELS: Record<TimestampFormat, string> = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
};

export const DIFF_LAYOUT_LABELS: Record<DiffLayout, string> = {
  stacked: "Stacked",
  split: "Split",
};

export const DIFF_FILE_STATE_LABELS: Record<DiffFileState, string> = {
  expanded: "Expanded",
  collapsed: "Collapsed",
};

export const FOLLOW_UP_BEHAVIOR_LABELS: Record<FollowUpBehavior, string> = {
  queue: "Queue",
  steer: "Steer",
};

export const QUIT_CONFIRMATION_MODE_LABELS: Record<QuitConfirmationMode, string> = {
  direct: "Direct",
  hold: "Hold",
  "double-click": "Double press",
};

export const BACKGROUND_ACTIVITY_PROFILE_LABELS: Record<BackgroundActivityProfile, string> = {
  balanced: "Balanced",
  performance: "Performance",
  "battery-saver": "Battery saver",
};

export const BACKGROUND_ACTIVITY_PROFILE_OPTION_LABELS: Record<
  BackgroundActivityProfileOption,
  string
> = {
  ...BACKGROUND_ACTIVITY_PROFILE_LABELS,
  advanced: "Advanced",
};

export const BACKGROUND_ACTIVITY_PROFILE_DESCRIPTIONS: Record<BackgroundActivityProfile, string> = {
  balanced: "Pauses probes for idle clients, locked hosts, or low power mode.",
  performance: "Allows scoped background probes while any subscribed client remains connected.",
  "battery-saver": "Also pauses background probes when the host or client is on battery.",
};

const ADVANCED_BACKGROUND_ACTIVITY_DESCRIPTION = "Uses custom intervals.";

export const DEFAULT_TEXT_GENERATION_DRIVER_KIND = ProviderDriverKind.make("codex");

export const AUTO_SETTLE_DEFAULT_DAYS = DEFAULT_UNIFIED_SETTINGS.sidebarAutoSettleAfterDays ?? 3;

const MIXED_LABEL = "Mixed";

const BACKGROUND_ACTIVITY_PROFILES: readonly BackgroundActivityProfile[] = [
  "balanced",
  "performance",
  "battery-saver",
];

export function responseStreamingModeLabel(value: ResponseStreamingMode | null): string {
  return value === null ? MIXED_LABEL : RESPONSE_STREAMING_MODE_LABELS[value];
}

export function backgroundActivityProfileOptionLabel(
  value: BackgroundActivityProfileOption | null,
): string {
  return value === null ? MIXED_LABEL : BACKGROUND_ACTIVITY_PROFILE_OPTION_LABELS[value];
}

export function resetBackgroundActivitySettings(): ScopedSettingsPatch {
  return {
    backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
  };
}

export function backgroundActivityProfileSettings(
  profile: BackgroundActivityProfile,
): ScopedSettingsPatch {
  return {
    backgroundActivity: {
      schemaVersion: 1,
      profile,
      overrides: {},
    },
  };
}

export type GeneralSettingsOption<V extends string> = {
  readonly value: V;
  readonly label: string;
  readonly description: string | null;
  readonly disabled: boolean;
};

export type GeneralSettingsIconButton = {
  readonly icon: "settings";
  readonly ariaLabel: string;
  readonly tooltip: string;
};

export type GeneralSettingsSwitchControl = {
  readonly kind: "switch";
  readonly ariaLabel: string;
  readonly checked: boolean;
  readonly mixed: boolean;
  readonly disabled: boolean;
  readonly disabledReason: string | null;
};

export type GeneralSettingsSelectControl<V extends string> = {
  readonly kind: "select";
  readonly ariaLabel: string;
  readonly value: V | null;
  readonly valueLabel: string;
  readonly options: readonly GeneralSettingsOption<V>[];
  readonly showSelectedIndicator: boolean;
  readonly disabled: boolean;
  readonly accessory: GeneralSettingsIconButton | null;
};

export type GeneralSettingsNumberInputControl = {
  readonly kind: "number-input";
  readonly ariaLabel: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
};

export type GeneralSettingsTextInputControl = {
  readonly kind: "text-input";
  readonly ariaLabel: string;
  readonly value: string;
  readonly placeholder: string;
};

export type GeneralSettingsLinkRoute = "/settings/diagnostics" | "/settings/open-source-licenses";

export type GeneralSettingsLinkControl = {
  readonly kind: "link";
  readonly label: string;
  readonly route: GeneralSettingsLinkRoute;
  readonly machine: EnvironmentId | null;
};

export type GeneralSettingsModelPickerControl = {
  readonly kind: "model-picker";
  readonly unavailableMessage: string | null;
  readonly activeInstanceId: ProviderInstanceId;
  readonly model: string;
  readonly driverKind: ProviderDriverKind;
  readonly triggerLabel: string | null;
  readonly showTraitsPicker: boolean;
  readonly canOpenProviderSetup: boolean;
};

export type GeneralSettingsControl =
  | GeneralSettingsSwitchControl
  | GeneralSettingsSelectControl<string>
  | GeneralSettingsNumberInputControl
  | GeneralSettingsTextInputControl
  | GeneralSettingsLinkControl
  | GeneralSettingsModelPickerControl;

export type GeneralSettingsRow<C extends GeneralSettingsControl = GeneralSettingsControl> = {
  readonly key: GeneralSettingsRowKey;
  readonly anchorId: string | null;
  readonly title: string;
  readonly titleTooltip: string | null;
  readonly description: string;
  readonly status: string | null;
  readonly serverScoped: boolean;
  readonly settingKeys: readonly (keyof ServerSettings)[];
  readonly resetLabel: string | null;
  readonly control: C;
};

export type GeneralSettingsSwitchRow = GeneralSettingsRow<GeneralSettingsSwitchControl>;
export type GeneralSettingsSelectRow<V extends string> = GeneralSettingsRow<
  GeneralSettingsSelectControl<V>
>;

export type GeneralSettingsRows = {
  readonly projectGrouping: GeneralSettingsSwitchRow;
  readonly workingShelf: GeneralSettingsSwitchRow;
  readonly autoSettleMerged: GeneralSettingsSwitchRow | null;
  readonly autoSettleInactive: GeneralSettingsSwitchRow | null;
  readonly autoSettleDays: GeneralSettingsRow<GeneralSettingsNumberInputControl> | null;
  readonly inAppNotifications: GeneralSettingsSwitchRow;
  readonly timeFormat: GeneralSettingsSelectRow<TimestampFormat>;
  readonly responseStreaming: GeneralSettingsSelectRow<ResponseStreamingMode>;
  readonly hideWhitespaceChanges: GeneralSettingsSwitchRow;
  readonly defaultDiffFileState: GeneralSettingsSelectRow<DiffFileState>;
  readonly diffLayout: GeneralSettingsSelectRow<DiffLayout>;
  readonly proactivePanels: GeneralSettingsSwitchRow;
  readonly skillsInSlashMenu: GeneralSettingsSwitchRow;
  readonly composerRichText: GeneralSettingsSwitchRow;
  readonly composerCollapse: GeneralSettingsSwitchRow;
  readonly sendShortcut: GeneralSettingsSelectRow<SendShortcut>;
  readonly followUpBehavior: GeneralSettingsSelectRow<FollowUpBehavior>;
  readonly providerUpdateChecks: GeneralSettingsSwitchRow;
  readonly continueThreadsAfterRestart: GeneralSettingsSwitchRow;
  readonly backgroundActivity: GeneralSettingsSelectRow<BackgroundActivityProfileOption>;
  readonly startFromOrigin: GeneralSettingsSwitchRow;
  readonly addProjectBaseDirectory: GeneralSettingsRow<GeneralSettingsTextInputControl>;
  readonly unpinConfirmation: GeneralSettingsSwitchRow;
  readonly archiveConfirmation: GeneralSettingsSwitchRow;
  readonly deleteConfirmation: GeneralSettingsSwitchRow;
  readonly quitConfirmation: GeneralSettingsSelectRow<QuitConfirmationMode> | null;
  readonly textGenerationModel: GeneralSettingsRow<GeneralSettingsModelPickerControl>;
  readonly diagnostics: GeneralSettingsRow<GeneralSettingsLinkControl>;
  readonly openSourceLicenses: GeneralSettingsRow<GeneralSettingsLinkControl>;
  readonly legacyPlanMode: GeneralSettingsSwitchRow;
  readonly legacyContextWindowIndicator: GeneralSettingsSwitchRow;
  readonly legacySidebar: GeneralSettingsSwitchRow;
};

export type GeneralSettingsRowKey = keyof GeneralSettingsRows;

export type GeneralSettingsEmbeddedPanel = "project-defaults" | "thread-notifications" | "about";

export type GeneralSettingsSectionItem =
  | { readonly kind: "row"; readonly key: GeneralSettingsRowKey }
  | { readonly kind: "embedded"; readonly panel: GeneralSettingsEmbeddedPanel };

export type GeneralSettingsSectionKey =
  | "organization"
  | "behavior"
  | "projects-and-threads"
  | "confirmations"
  | "text-generation"
  | "about"
  | "diagnostics"
  | "legacy-features";

export type GeneralSettingsSection = {
  readonly key: GeneralSettingsSectionKey;
  readonly anchorId: string | null;
  readonly title: string;
  readonly collapsible: boolean;
  readonly items: readonly GeneralSettingsSectionItem[];
};

export type GeneralSettingsLayoutItem =
  | { readonly kind: "embedded"; readonly panel: "project-defaults" }
  | { readonly kind: "section"; readonly key: GeneralSettingsSectionKey };

export type TokenStreamingWarningModel = {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly useParagraphsLabel: string;
};

export type BackgroundActivityIntervalKey =
  | "automaticGitFetchInterval"
  | "providerHealthRefreshInterval"
  | "hostPowerMonitorActiveInterval"
  | "hostPowerMonitorIdleInterval";

export type BackgroundActivityPauseKey =
  | "pauseWhenHostLocked"
  | "pauseWhenHostLowPower"
  | "pauseWhenClientLowPower"
  | "pauseWhenOnBattery";

export type BackgroundActivityIntervalField = {
  readonly key: BackgroundActivityIntervalKey;
  readonly title: string;
  readonly description: string;
  readonly valueSeconds: number;
  readonly min: number;
  readonly step: number;
  readonly unitLabel: string;
  readonly decrementAriaLabel: string;
  readonly inputAriaLabel: string;
  readonly incrementAriaLabel: string;
};

export type BackgroundActivityPauseToggle = {
  readonly key: BackgroundActivityPauseKey;
  readonly label: string;
  readonly checked: boolean;
};

export type BackgroundActivityAdvancedModel = {
  readonly title: string;
  readonly description: string;
  readonly sharedPolicy: {
    readonly title: string;
    readonly description: string;
    readonly ariaLabel: string;
    readonly value: BackgroundActivityProfile;
    readonly valueLabel: string;
    readonly options: readonly GeneralSettingsOption<BackgroundActivityProfile>[];
  };
  readonly intervals: readonly BackgroundActivityIntervalField[];
  readonly pauseToggles: readonly BackgroundActivityPauseToggle[];
  readonly resetLabel: string;
  readonly doneLabel: string;
};

export type TextGenerationModelState = {
  readonly providers: readonly ServerProvider[];
  readonly selection: ModelSelection;
  readonly instanceEntries: readonly ProviderInstanceEntry[];
  readonly instanceEntry: ProviderInstanceEntry | null;
  readonly driverKind: ProviderDriverKind;
  readonly hasTextGenerationProvider: boolean;
  readonly isDirty: boolean;
};

export type GeneralSettingsMixedState = {
  readonly responseStreamingMode: boolean;
  readonly backgroundActivity: boolean;
  readonly addProjectBaseDirectory: boolean;
  readonly textGenerationModelSelection: boolean;
  readonly sidebarAutoSettleOnMerge: boolean;
  readonly sidebarAutoSettleAfterDays: boolean;
  readonly enableProviderUpdateChecks: boolean;
  readonly continueThreadsAfterServerUpdate: boolean;
  readonly newWorktreesStartFromOrigin: boolean;
};

export type GeneralSettingsModelInput = {
  readonly settings: UnifiedSettings;
  readonly isMac: boolean;
  readonly isElectron: boolean;
  readonly environmentId: EnvironmentId | null;
  readonly isEnvironmentScope: boolean;
  readonly hasServerTargets: boolean;
  readonly supportsAutoSettlement: boolean;
  readonly supportsRestartContinuation: boolean;
  readonly mixed: GeneralSettingsMixedState;
  readonly textGeneration: TextGenerationModelState;
};

export type GeneralSettingsModel = {
  readonly layout: readonly GeneralSettingsLayoutItem[];
  readonly sections: Record<GeneralSettingsSectionKey, GeneralSettingsSection>;
  readonly rows: GeneralSettingsRows;
  readonly tokenStreamingWarning: TokenStreamingWarningModel;
  readonly backgroundActivityAdvanced: BackgroundActivityAdvancedModel;
};

export function resolveTextGenerationModelState(input: {
  readonly settings: UnifiedSettings;
  readonly serverProviders: readonly ServerProvider[];
}): TextGenerationModelState {
  const providers = input.serverProviders.filter(
    (provider) => provider.supportsTextGeneration !== false,
  );
  const selection = resolveAppModelSelectionState(input.settings, providers);
  const instanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), input.settings),
  );
  const instanceEntry =
    instanceEntries.find((entry) => entry.instanceId === selection.instanceId) ?? null;
  return {
    providers,
    selection,
    instanceEntries,
    instanceEntry,
    driverKind: instanceEntry?.driverKind ?? DEFAULT_TEXT_GENERATION_DRIVER_KIND,
    hasTextGenerationProvider: instanceEntries.some((entry) => entry.enabled && entry.isAvailable),
    isDirty: !Equal.equals(
      input.settings.textGenerationModelSelection ?? null,
      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
    ),
  };
}

function option<V extends string>(
  value: V,
  label: string,
  extra: { readonly description?: string; readonly disabled?: boolean } = {},
): GeneralSettingsOption<V> {
  return {
    value,
    label,
    description: extra.description ?? null,
    disabled: extra.disabled ?? false,
  };
}

function resetLabelWhen(changed: boolean, label: string): string | null {
  return changed ? label : null;
}

type RowHeader = {
  readonly anchorId: string | null;
  readonly title: string;
};

function anchoredHeader(id: SettingsSearchItemId): RowHeader {
  const anchor = searchableSetting(id);
  return { anchorId: anchor.id, title: anchor.title };
}

function row<C extends GeneralSettingsControl>(
  key: GeneralSettingsRowKey,
  header: RowHeader,
  fields: {
    readonly description: string;
    readonly resetLabel?: string | null;
    readonly serverScoped?: readonly (keyof ServerSettings)[];
    readonly status?: string | null;
    readonly titleTooltip?: string | null;
  },
  control: C,
): GeneralSettingsRow<C> {
  return {
    key,
    anchorId: header.anchorId,
    title: header.title,
    titleTooltip: fields.titleTooltip ?? null,
    description: fields.description,
    status: fields.status ?? null,
    serverScoped: fields.serverScoped !== undefined,
    settingKeys: fields.serverScoped ?? [],
    resetLabel: fields.resetLabel ?? null,
    control,
  };
}

function switchControl(
  ariaLabel: string,
  checked: boolean,
  extra: {
    readonly mixed?: boolean;
    readonly disabledReason?: string | null;
  } = {},
): GeneralSettingsSwitchControl {
  const disabledReason = extra.disabledReason ?? null;
  return {
    kind: "switch",
    ariaLabel,
    checked,
    mixed: extra.mixed ?? false,
    disabled: disabledReason !== null,
    disabledReason,
  };
}

function selectControl<V extends string>(input: {
  readonly ariaLabel: string;
  readonly value: V | null;
  readonly options: readonly GeneralSettingsOption<V>[];
  readonly valueLabel?: string;
  readonly showSelectedIndicator?: boolean;
  readonly accessory?: GeneralSettingsIconButton | null;
}): GeneralSettingsSelectControl<V> {
  const selected = input.options.find((candidate) => candidate.value === input.value);
  return {
    kind: "select",
    ariaLabel: input.ariaLabel,
    value: input.value,
    valueLabel: input.valueLabel ?? selected?.label ?? MIXED_LABEL,
    options: input.options,
    showSelectedIndicator: input.showSelectedIndicator ?? false,
    disabled: false,
    accessory: input.accessory ?? null,
  };
}

export function buildSendShortcutOptions(isMac: boolean): GeneralSettingsOption<SendShortcut>[] {
  const modifierLabel = isMac ? "⌘" : "Ctrl";
  return [
    option("enter", "Enter"),
    option("mod-enter-multiline", `${modifierLabel} + Enter for multiline prompts`),
    option("mod-enter", `${modifierLabel} + Enter always`),
  ];
}

function followUpBehaviorDescription(sendShortcut: SendShortcut, isMac: boolean): string {
  const modifierLabel = isMac ? "⌘" : "Ctrl";
  return (
    "Queue follow-ups while the agent runs or steer the current run. " +
    (sendShortcut === "mod-enter-multiline"
      ? `Press ${modifierLabel} + Enter for single-line prompts or ${modifierLabel} + Shift + Enter for multiline prompts to do the opposite for one message.`
      : `Press ${modifierLabel}${sendShortcut === "mod-enter" ? " + Shift" : ""} + Enter to do the opposite for one message.`)
  );
}

export function buildTokenStreamingWarningModel(): TokenStreamingWarningModel {
  return {
    title: "Token by token is a worse experience",
    description:
      "Token streaming repaints the message on every delta. It is slower, harder to read, and costs more CPU on every connected device. This mode stays only for backwards compatibility. Use paragraph streaming instead.",
    confirmLabel: "Use token by token",
    cancelLabel: "Cancel",
    useParagraphsLabel: "Use paragraphs",
  };
}

const BACKGROUND_ACTIVITY_PAUSE_LABELS: ReadonlyArray<{
  readonly key: BackgroundActivityPauseKey;
  readonly label: string;
}> = [
  { key: "pauseWhenHostLocked", label: "Pause when host is locked" },
  { key: "pauseWhenHostLowPower", label: "Pause on host low power" },
  { key: "pauseWhenClientLowPower", label: "Pause on client low power" },
  { key: "pauseWhenOnBattery", label: "Pause on battery" },
];

const INTERVAL_NORMALIZE_MINIMUM: Record<BackgroundActivityIntervalKey, number> = {
  automaticGitFetchInterval: 0,
  providerHealthRefreshInterval: 0,
  hostPowerMonitorActiveInterval: 5,
  hostPowerMonitorIdleInterval: 5,
};

export function buildBackgroundActivityAdvancedModel(
  settings: UnifiedSettings,
): BackgroundActivityAdvancedModel {
  const resolved = resolveServerBackgroundActivitySettings(settings);
  return {
    title: "Background Activity",
    description: "Tune the shared power policy and the background intervals that feed it.",
    sharedPolicy: {
      title: "Shared policy",
      description: "Controls whether background work may run after a subscribed interval fires.",
      ariaLabel: "Shared background policy",
      value: resolved.profile,
      valueLabel: BACKGROUND_ACTIVITY_PROFILE_LABELS[resolved.profile],
      options: BACKGROUND_ACTIVITY_PROFILES.map((profile) =>
        option(profile, BACKGROUND_ACTIVITY_PROFILE_LABELS[profile], {
          description: BACKGROUND_ACTIVITY_PROFILE_DESCRIPTIONS[profile],
        }),
      ),
    },
    intervals: [
      {
        key: "automaticGitFetchInterval",
        title: searchableSetting("git-fetch-interval").title,
        description: "Refresh remote branch status in the background.",
        valueSeconds: durationToSeconds(resolved.automaticGitFetchInterval),
        min: 0,
        step: 5,
        unitLabel: "seconds",
        decrementAriaLabel: "Decrease Git fetch interval",
        inputAriaLabel: "Git fetch interval in seconds",
        incrementAriaLabel: "Increase Git fetch interval",
      },
      {
        key: "providerHealthRefreshInterval",
        title: "Provider health interval",
        description: "Refresh provider availability, versions, auth state, and model metadata.",
        valueSeconds: durationToSeconds(resolved.providerHealthRefreshInterval),
        min: 0,
        step: PROVIDER_HEALTH_INTERVAL_STEP_SECONDS,
        unitLabel: "seconds",
        decrementAriaLabel: "Decrease provider health interval",
        inputAriaLabel: "Provider health interval in seconds",
        incrementAriaLabel: "Increase provider health interval",
      },
      {
        key: "hostPowerMonitorActiveInterval",
        title: "Host power monitor",
        description: "Poll host power state while clients are active.",
        valueSeconds: durationToSeconds(resolved.hostPowerMonitorActiveInterval),
        min: 5,
        step: 5,
        unitLabel: "seconds",
        decrementAriaLabel: "Decrease active host power interval",
        inputAriaLabel: "Active host power interval in seconds",
        incrementAriaLabel: "Increase active host power interval",
      },
      {
        key: "hostPowerMonitorIdleInterval",
        title: "Idle host monitor",
        description: "Poll host power state when no foreground client is active.",
        valueSeconds: durationToSeconds(resolved.hostPowerMonitorIdleInterval),
        min: 5,
        step: 30,
        unitLabel: "seconds",
        decrementAriaLabel: "Decrease idle host power interval",
        inputAriaLabel: "Idle host power interval in seconds",
        incrementAriaLabel: "Increase idle host power interval",
      },
    ],
    pauseToggles: BACKGROUND_ACTIVITY_PAUSE_LABELS.map(({ key, label }) => ({
      key,
      label,
      checked: resolved[key],
    })),
    resetLabel: "Reset all",
    doneLabel: "Done",
  };
}

export type BackgroundActivityAdvancedIntent =
  | { readonly kind: "set-shared-policy"; readonly value: string | null }
  | {
      readonly kind: "set-interval";
      readonly key: BackgroundActivityIntervalKey;
      readonly value: number | null;
    }
  | {
      readonly kind: "set-pause";
      readonly key: BackgroundActivityPauseKey;
      readonly checked: boolean;
    }
  | { readonly kind: "reset-all" };

function isBackgroundActivityProfile(value: string | null): value is BackgroundActivityProfile {
  return value === "balanced" || value === "performance" || value === "battery-saver";
}

export function resolveBackgroundActivityAdvancedChange(input: {
  readonly settings: UnifiedSettings;
  readonly intent: BackgroundActivityAdvancedIntent;
}): ScopedSettingsPatch | null {
  const { settings, intent } = input;
  switch (intent.kind) {
    case "set-shared-policy":
      if (!isBackgroundActivityProfile(intent.value)) return null;
      return {
        backgroundActivity: backgroundActivitySharedPolicySettings(settings, intent.value),
      };
    case "set-interval":
      return backgroundActivityOverrideSettings(
        settings.backgroundActivity,
        resolveServerBackgroundActivitySettings(settings),
        {
          [intent.key]: Duration.seconds(
            normalizeIntervalSeconds(intent.value, INTERVAL_NORMALIZE_MINIMUM[intent.key]),
          ),
        },
      );
    case "set-pause":
      return backgroundActivityOverrideSettings(
        settings.backgroundActivity,
        resolveServerBackgroundActivitySettings(settings),
        { [intent.key]: intent.checked },
      );
    case "reset-all":
      return resetBackgroundActivitySettings();
  }
}

// The legacy rows sit behind the fold, so a settings-search jump has to
// expand the section before its target can mount and scroll.
const LEGACY_FEATURE_TARGET_IDS: ReadonlySet<string> = new Set([
  "legacy-plan-mode",
  "legacy-context-window-indicator",
  "legacy-sidebar",
]);

export function resolveLegacyFeaturesSearchJump(input: {
  readonly searchTargetId: string | null;
  readonly lastExpandedTargetId: string | null;
}): { readonly lastExpandedTargetId: string | null; readonly expand: boolean } {
  if (input.searchTargetId === null) {
    // A handled jump clears the target; forgetting it here lets a later
    // jump to the same row expand the section again.
    return { lastExpandedTargetId: null, expand: false };
  }
  if (
    !LEGACY_FEATURE_TARGET_IDS.has(input.searchTargetId) ||
    input.lastExpandedTargetId === input.searchTargetId
  ) {
    return { lastExpandedTargetId: input.lastExpandedTargetId, expand: false };
  }
  return { lastExpandedTargetId: input.searchTargetId, expand: true };
}

export function resolveAutoSettleDaysDraft(draft: string): number | null {
  // Number(), not parseInt: "3.5" must be rejected (not truncated to a
  // committed 3 while the field shows 3.5) — commit only when the
  // persisted value matches the displayed one.
  const parsed = Number(draft);
  return Number.isInteger(parsed) &&
    parsed >= MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS &&
    parsed <= MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS
    ? parsed
    : null;
}

export const LAST_ENABLED_PROJECT_GROUPING_MODE_KEY = "t3code:last-enabled-project-grouping-mode";

export function readLastEnabledProjectGroupingMode(
  storage: Pick<Storage, "getItem">,
): SidebarProjectGroupingMode {
  try {
    return storage.getItem(LAST_ENABLED_PROJECT_GROUPING_MODE_KEY) === "repository_path"
      ? "repository_path"
      : "repository";
  } catch {
    return "repository";
  }
}

export function rememberEnabledProjectGroupingMode(
  storage: Pick<Storage, "setItem">,
  mode: SidebarProjectGroupingMode,
): void {
  if (mode === "separate") return;
  try {
    storage.setItem(LAST_ENABLED_PROJECT_GROUPING_MODE_KEY, mode);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

export function buildGeneralSettingsModel(input: GeneralSettingsModelInput): GeneralSettingsModel {
  const { settings, mixed, isEnvironmentScope, textGeneration } = input;
  const defaults = DEFAULT_UNIFIED_SETTINGS;
  const resolvedBackgroundActivity = resolveServerBackgroundActivitySettings(settings);
  const backgroundActivityProfileOption = resolveBackgroundActivityProfileOption(settings);
  const backgroundActivityValue = mixed.backgroundActivity ? null : backgroundActivityProfileOption;
  const responseStreamingValue = mixed.responseStreamingMode
    ? null
    : settings.responseStreamingMode;
  const sendShortcutOptions = buildSendShortcutOptions(input.isMac);
  const showAutoSettlement = input.supportsAutoSettlement;

  const rows: GeneralSettingsRows = {
    projectGrouping: row(
      "projectGrouping",
      anchoredHeader("project-grouping"),
      {
        description: "Combine matching repositories across environments.",
        resetLabel: resetLabelWhen(
          settings.sidebarProjectGroupingMode !== defaults.sidebarProjectGroupingMode,
          "project grouping",
        ),
      },
      switchControl(
        "Project grouping",
        isProjectGroupingEnabled(settings.sidebarProjectGroupingMode),
      ),
    ),
    workingShelf: row(
      "workingShelf",
      anchoredHeader("working-shelf"),
      {
        description:
          "Fold working and monitoring threads into a Working section. They return to the top of the inbox when they need you.",
        resetLabel: resetLabelWhen(
          settings.sidebarWorkingShelfEnabled !== defaults.sidebarWorkingShelfEnabled,
          "working section",
        ),
      },
      switchControl("Working section (beta)", settings.sidebarWorkingShelfEnabled),
    ),
    autoSettleMerged: showAutoSettlement
      ? row(
          "autoSettleMerged",
          anchoredHeader("auto-settle-merged-threads"),
          {
            description:
              "Settle a thread when its pull request merges. Closed pull requests still settle automatically.",
            serverScoped: ["sidebarAutoSettleOnMerge"],
            resetLabel: resetLabelWhen(
              settings.sidebarAutoSettleOnMerge !== defaults.sidebarAutoSettleOnMerge,
              "auto-settle on merge",
            ),
          },
          switchControl("Auto-settle merged threads", settings.sidebarAutoSettleOnMerge, {
            mixed: mixed.sidebarAutoSettleOnMerge,
          }),
        )
      : null,
    autoSettleInactive: showAutoSettlement
      ? row(
          "autoSettleInactive",
          anchoredHeader("auto-settle-inactive-threads"),
          {
            description: "Sidebar threads with no activity for this long settle automatically.",
            serverScoped: ["sidebarAutoSettleAfterDays"],
            resetLabel: resetLabelWhen(
              settings.sidebarAutoSettleAfterDays !== defaults.sidebarAutoSettleAfterDays,
              "auto-settle",
            ),
          },
          switchControl(
            "Auto-settle inactive threads",
            settings.sidebarAutoSettleAfterDays !== null,
            { mixed: mixed.sidebarAutoSettleAfterDays },
          ),
        )
      : null,
    autoSettleDays:
      showAutoSettlement && settings.sidebarAutoSettleAfterDays !== null
        ? row(
            "autoSettleDays",
            { anchorId: null, title: searchableSetting("days-before-auto-settle").title },
            {
              description: "Any new activity un-settles a thread automatically.",
              serverScoped: ["sidebarAutoSettleAfterDays"],
            },
            {
              kind: "number-input",
              ariaLabel: "Days of inactivity before auto-settle",
              value: settings.sidebarAutoSettleAfterDays,
              min: MIN_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
              max: MAX_SIDEBAR_AUTO_SETTLE_AFTER_DAYS,
            },
          )
        : null,
    inAppNotifications: row(
      "inAppNotifications",
      anchoredHeader("in-app-notifications"),
      {
        description:
          "Show a toast when another thread finishes, fails, or needs input or approval while this app has focus.",
      },
      switchControl("In-app notifications", settings.inAppNotificationsEnabled),
    ),
    timeFormat: row(
      "timeFormat",
      anchoredHeader("time-format"),
      {
        description: "System default follows your browser or OS clock preference.",
        resetLabel: resetLabelWhen(
          settings.timestampFormat !== defaults.timestampFormat,
          "time format",
        ),
      },
      selectControl({
        ariaLabel: "Timestamp format",
        value: settings.timestampFormat,
        options: [
          option("locale", TIMESTAMP_FORMAT_LABELS.locale),
          option("12-hour", TIMESTAMP_FORMAT_LABELS["12-hour"]),
          option("24-hour", TIMESTAMP_FORMAT_LABELS["24-hour"]),
        ],
      }),
    ),
    responseStreaming: row(
      "responseStreaming",
      anchoredHeader("response-streaming"),
      {
        description: mixed.responseStreamingMode
          ? "The selected targets use different streaming modes."
          : RESPONSE_STREAMING_MODE_DESCRIPTIONS[settings.responseStreamingMode],
        serverScoped: ["responseStreamingMode"],
        resetLabel: resetLabelWhen(
          settings.responseStreamingMode !== defaults.responseStreamingMode,
          "response streaming",
        ),
      },
      selectControl({
        ariaLabel: "Response streaming",
        value: responseStreamingValue,
        valueLabel: responseStreamingModeLabel(responseStreamingValue),
        options: [
          option("turn", RESPONSE_STREAMING_MODE_LABELS.turn, {
            description: RESPONSE_STREAMING_MODE_DESCRIPTIONS.turn,
          }),
          option("paragraph", RESPONSE_STREAMING_MODE_LABELS.paragraph, {
            description: RESPONSE_STREAMING_MODE_DESCRIPTIONS.paragraph,
          }),
          option("token", RESPONSE_STREAMING_MODE_LABELS.token, {
            description: RESPONSE_STREAMING_MODE_DESCRIPTIONS.token,
          }),
        ],
      }),
    ),
    hideWhitespaceChanges: row(
      "hideWhitespaceChanges",
      anchoredHeader("hide-whitespace-changes"),
      {
        description: "Set whether the diff panel ignores whitespace-only edits by default.",
        resetLabel: resetLabelWhen(
          settings.diffIgnoreWhitespace !== defaults.diffIgnoreWhitespace,
          "diff whitespace changes",
        ),
      },
      switchControl("Hide whitespace changes by default", settings.diffIgnoreWhitespace),
    ),
    defaultDiffFileState: row(
      "defaultDiffFileState",
      anchoredHeader("default-diff-file-state"),
      {
        description:
          "Start with files expanded or collapsed when opening diffs or a pull request's Code tab.",
        resetLabel: resetLabelWhen(
          settings.diffFilesCollapsed !== defaults.diffFilesCollapsed,
          "default diff file state",
        ),
      },
      selectControl<DiffFileState>({
        ariaLabel: "Default diff file state",
        value: settings.diffFilesCollapsed ? "collapsed" : "expanded",
        options: [
          option("expanded", DIFF_FILE_STATE_LABELS.expanded),
          option("collapsed", DIFF_FILE_STATE_LABELS.collapsed),
        ],
      }),
    ),
    diffLayout: row(
      "diffLayout",
      anchoredHeader("diff-layout"),
      {
        description:
          "Show diffs stacked or side by side. The toggle in the diff toolbar changes this too.",
        resetLabel: resetLabelWhen(settings.diffLayout !== defaults.diffLayout, "diff layout"),
      },
      selectControl({
        ariaLabel: "Diff layout",
        value: settings.diffLayout,
        options: [
          option("stacked", DIFF_LAYOUT_LABELS.stacked),
          option("split", DIFF_LAYOUT_LABELS.split),
        ],
      }),
    ),
    proactivePanels: row(
      "proactivePanels",
      anchoredHeader("proactive-panels"),
      {
        description:
          "Open linked pull requests first. Otherwise, open the working tree diff for changes to at least 3 files or 50 lines.",
        resetLabel: resetLabelWhen(
          settings.proactivePanelsEnabled !== defaults.proactivePanelsEnabled,
          "proactive panels",
        ),
      },
      switchControl("Proactive panels", settings.proactivePanelsEnabled),
    ),
    skillsInSlashMenu: row(
      "skillsInSlashMenu",
      anchoredHeader("skills-in-slash-menu"),
      {
        description:
          "Also include skills in the / command menu. Skills always appear when you type $.",
        resetLabel: resetLabelWhen(
          settings.showSkillsInSlashMenu !== defaults.showSkillsInSlashMenu,
          "skills in slash menu",
        ),
      },
      switchControl("Show skills in slash menu", settings.showSkillsInSlashMenu),
    ),
    composerRichText: row(
      "composerRichText",
      anchoredHeader("composer-rich-text"),
      {
        description: "Show formatted Markdown as you type.",
        resetLabel: resetLabelWhen(
          settings.composerRichTextEnabled !== defaults.composerRichTextEnabled,
          "rich text composer",
        ),
      },
      switchControl("Rich text composer", settings.composerRichTextEnabled),
    ),
    composerCollapse: row(
      "composerCollapse",
      anchoredHeader("composer-collapse"),
      {
        description:
          "Rest the composer of an existing thread into a single line when you scroll the conversation. Focus the composer or start typing to expand it again.",
        resetLabel: resetLabelWhen(
          settings.composerCollapseOnScroll !== defaults.composerCollapseOnScroll,
          "collapse composer on scroll",
        ),
      },
      switchControl("Collapse composer on scroll", settings.composerCollapseOnScroll),
    ),
    sendShortcut: row(
      "sendShortcut",
      anchoredHeader("send-shortcut"),
      {
        description: "Choose when Enter sends a prompt or inserts a new line",
        resetLabel: resetLabelWhen(
          settings.sendShortcut !== defaults.sendShortcut,
          "send shortcut",
        ),
      },
      selectControl({
        ariaLabel: "Send shortcut",
        value: settings.sendShortcut,
        options: sendShortcutOptions,
        showSelectedIndicator: true,
      }),
    ),
    followUpBehavior: row(
      "followUpBehavior",
      anchoredHeader("follow-up-behavior"),
      {
        description: followUpBehaviorDescription(settings.sendShortcut, input.isMac),
        resetLabel: resetLabelWhen(
          settings.followUpBehavior !== defaults.followUpBehavior,
          "follow-up behavior",
        ),
      },
      selectControl({
        ariaLabel: "Follow-up behavior",
        value: settings.followUpBehavior,
        valueLabel:
          settings.followUpBehavior === "queue"
            ? FOLLOW_UP_BEHAVIOR_LABELS.queue
            : FOLLOW_UP_BEHAVIOR_LABELS.steer,
        options: [
          option("queue", FOLLOW_UP_BEHAVIOR_LABELS.queue),
          option("steer", FOLLOW_UP_BEHAVIOR_LABELS.steer),
        ],
      }),
    ),
    providerUpdateChecks: row(
      "providerUpdateChecks",
      anchoredHeader("provider-update-checks"),
      {
        description: "Check installed provider CLIs for newer available versions.",
        serverScoped: ["enableProviderUpdateChecks"],
        resetLabel: resetLabelWhen(
          settings.enableProviderUpdateChecks !== defaults.enableProviderUpdateChecks,
          "provider update checks",
        ),
      },
      switchControl("Check provider versions", settings.enableProviderUpdateChecks, {
        mixed: mixed.enableProviderUpdateChecks,
      }),
    ),
    continueThreadsAfterRestart: row(
      "continueThreadsAfterRestart",
      anchoredHeader("continue-threads-after-server-update"),
      {
        description:
          "Automatically resume interrupted threads after an update, crash, or machine restart on the selected environments.",
        serverScoped: ["continueThreadsAfterServerUpdate"],
        status: input.supportsRestartContinuation
          ? null
          : "All selected connected environments must support restart continuation.",
        resetLabel: resetLabelWhen(
          input.supportsRestartContinuation &&
            settings.continueThreadsAfterServerUpdate !== defaults.continueThreadsAfterServerUpdate,
          "continue threads after restarts",
        ),
      },
      switchControl("Continue threads after restarts", settings.continueThreadsAfterServerUpdate, {
        mixed: mixed.continueThreadsAfterServerUpdate,
        disabledReason: input.supportsRestartContinuation
          ? null
          : "All selected connected environments must support restart continuation.",
      }),
    ),
    backgroundActivity: row(
      "backgroundActivity",
      anchoredHeader("background-activity"),
      {
        titleTooltip:
          "This shared policy gates background work such as Git refreshes and provider health probes after their individual intervals elapse.",
        description:
          backgroundActivityProfileOption === "advanced"
            ? `${ADVANCED_BACKGROUND_ACTIVITY_DESCRIPTION} Shared policy: ${
                BACKGROUND_ACTIVITY_PROFILE_LABELS[resolvedBackgroundActivity.profile]
              }.`
            : BACKGROUND_ACTIVITY_PROFILE_DESCRIPTIONS[resolvedBackgroundActivity.profile],
        serverScoped: ["backgroundActivity"],
        resetLabel: resetLabelWhen(
          !Equal.equals(settings.backgroundActivity, defaults.backgroundActivity),
          "background activity",
        ),
      },
      selectControl<BackgroundActivityProfileOption>({
        ariaLabel: "Background activity profile",
        value: backgroundActivityValue,
        valueLabel: backgroundActivityProfileOptionLabel(backgroundActivityValue),
        options: [
          ...BACKGROUND_ACTIVITY_PROFILES.map((profile) =>
            option<BackgroundActivityProfileOption>(
              profile,
              BACKGROUND_ACTIVITY_PROFILE_LABELS[profile],
              { description: BACKGROUND_ACTIVITY_PROFILE_DESCRIPTIONS[profile] },
            ),
          ),
          option<BackgroundActivityProfileOption>(
            "advanced",
            isEnvironmentScope
              ? BACKGROUND_ACTIVITY_PROFILE_OPTION_LABELS.advanced
              : `${BACKGROUND_ACTIVITY_PROFILE_OPTION_LABELS.advanced} (one environment)`,
            {
              description: ADVANCED_BACKGROUND_ACTIVITY_DESCRIPTION,
              disabled: !isEnvironmentScope,
            },
          ),
        ],
        accessory:
          backgroundActivityProfileOption === "advanced" && isEnvironmentScope
            ? {
                icon: "settings",
                ariaLabel: "Configure advanced background activity",
                tooltip: "Configure background activity",
              }
            : null,
      }),
    ),
    startFromOrigin: row(
      "startFromOrigin",
      anchoredHeader("start-from-origin"),
      {
        description:
          "Creates the worktree from the latest matching branch on origin instead of your local branch.",
        serverScoped: ["newWorktreesStartFromOrigin"],
        resetLabel: resetLabelWhen(
          settings.newWorktreesStartFromOrigin !== defaults.newWorktreesStartFromOrigin,
          "new worktrees start from origin",
        ),
      },
      switchControl(
        "Start new worktrees from origin by default",
        settings.newWorktreesStartFromOrigin,
        { mixed: mixed.newWorktreesStartFromOrigin },
      ),
    ),
    addProjectBaseDirectory: row(
      "addProjectBaseDirectory",
      anchoredHeader("add-project-starts-in"),
      {
        description: 'Leave empty to use "~/" when the Add Project browser opens.',
        serverScoped: ["addProjectBaseDirectory"],
        resetLabel: resetLabelWhen(
          settings.addProjectBaseDirectory !== defaults.addProjectBaseDirectory,
          "add project base directory",
        ),
      },
      {
        kind: "text-input",
        ariaLabel: "Add project base directory",
        value: mixed.addProjectBaseDirectory ? "" : settings.addProjectBaseDirectory,
        placeholder: mixed.addProjectBaseDirectory ? MIXED_LABEL : "~/",
      },
    ),
    unpinConfirmation: row(
      "unpinConfirmation",
      anchoredHeader("unpin-confirmation"),
      {
        description: "Ask before unpinning a thread from the pinned section.",
        resetLabel: resetLabelWhen(
          settings.confirmThreadUnpin !== defaults.confirmThreadUnpin,
          "unpin confirmation",
        ),
      },
      switchControl("Confirm thread unpinning", settings.confirmThreadUnpin),
    ),
    archiveConfirmation: row(
      "archiveConfirmation",
      anchoredHeader("archive-confirmation"),
      {
        description:
          "Require a second click on the inline archive action before a thread is archived.",
        resetLabel: resetLabelWhen(
          settings.confirmThreadArchive !== defaults.confirmThreadArchive,
          "archive confirmation",
        ),
      },
      switchControl("Confirm thread archiving", settings.confirmThreadArchive),
    ),
    deleteConfirmation: row(
      "deleteConfirmation",
      anchoredHeader("delete-confirmation"),
      {
        description: "Ask before deleting a thread and its chat history.",
        resetLabel: resetLabelWhen(
          settings.confirmThreadDelete !== defaults.confirmThreadDelete,
          "delete confirmation",
        ),
      },
      switchControl("Confirm thread deletion", settings.confirmThreadDelete),
    ),
    quitConfirmation: input.isElectron
      ? row(
          "quitConfirmation",
          anchoredHeader("quit-confirmation"),
          {
            description: "Hold mode also quits on two quick presses.",
            resetLabel: resetLabelWhen(
              settings.confirmQuit !== defaults.confirmQuit,
              "quit shortcut behavior",
            ),
          },
          selectControl({
            ariaLabel: "Quit shortcut behavior",
            value: settings.confirmQuit,
            options: [
              option("direct", QUIT_CONFIRMATION_MODE_LABELS.direct),
              option("hold", QUIT_CONFIRMATION_MODE_LABELS.hold),
              option("double-click", QUIT_CONFIRMATION_MODE_LABELS["double-click"]),
            ],
          }),
        )
      : null,
    textGenerationModel: row(
      "textGenerationModel",
      anchoredHeader("text-generation-model"),
      {
        description:
          "Used for thread titles and other generated text on connected devices with this provider. Source control can override it.",
        serverScoped: ["textGenerationModelSelection"],
        resetLabel: resetLabelWhen(
          input.hasServerTargets && textGeneration.isDirty,
          "text generation model",
        ),
      },
      {
        kind: "model-picker",
        unavailableMessage: !input.hasServerTargets
          ? "Connect an environment to choose its text generation model."
          : !textGeneration.hasTextGenerationProvider
            ? "No text generation providers available."
            : null,
        activeInstanceId: textGeneration.selection.instanceId,
        model: textGeneration.selection.model,
        driverKind: textGeneration.driverKind,
        triggerLabel: mixed.textGenerationModelSelection ? MIXED_LABEL : null,
        showTraitsPicker: textGeneration.instanceEntry !== null,
        canOpenProviderSetup: Boolean(input.environmentId),
      },
    ),
    diagnostics: row(
      "diagnostics",
      anchoredHeader("diagnostics"),
      {
        description: isEnvironmentScope
          ? "Inspect processes, resource use, and logs on this environment."
          : "Inspect processes, resource use, and logs on one environment at a time.",
      },
      {
        kind: "link",
        label: "View diagnostics",
        route: "/settings/diagnostics",
        machine: input.environmentId,
      },
    ),
    openSourceLicenses: row(
      "openSourceLicenses",
      anchoredHeader("open-source-licenses"),
      {
        description: "Notices for dependencies, assets, and optional tools used by T3 Code.",
      },
      {
        kind: "link",
        label: "View licenses",
        route: "/settings/open-source-licenses",
        machine: null,
      },
    ),
    legacyPlanMode: row(
      "legacyPlanMode",
      anchoredHeader("legacy-plan-mode"),
      {
        description: "Restore Build/Plan, /plan, /default, and Shift+Tab. Off uses build mode.",
      },
      switchControl("Plan mode (legacy)", settings.planModeEnabled),
    ),
    legacyContextWindowIndicator: row(
      "legacyContextWindowIndicator",
      anchoredHeader("legacy-context-window-indicator"),
      {
        description: "Shows context window usage as a circular indicator in the composer.",
      },
      switchControl("Context window indicator (legacy)", settings.contextWindowMeterEnabled),
    ),
    legacySidebar: row(
      "legacySidebar",
      anchoredHeader("legacy-sidebar"),
      {
        description: "Restore per-project thread trees instead of the default flat sidebar.",
      },
      switchControl("Sidebar (legacy)", settings.legacySidebarEnabled),
    ),
  };

  const rowItem = (key: GeneralSettingsRowKey): GeneralSettingsSectionItem => ({
    kind: "row",
    key,
  });
  const visibleRows = (
    keys: readonly GeneralSettingsRowKey[],
  ): readonly GeneralSettingsSectionItem[] => keys.filter((key) => rows[key] !== null).map(rowItem);

  const section = (
    key: GeneralSettingsSectionKey,
    title: string,
    items: readonly GeneralSettingsSectionItem[],
    extra: { readonly anchorId?: string | null; readonly collapsible?: boolean } = {},
  ): GeneralSettingsSection => ({
    key,
    anchorId: extra.anchorId === undefined ? key : extra.anchorId,
    title,
    collapsible: extra.collapsible ?? false,
    items,
  });

  return {
    layout: [
      { kind: "embedded", panel: "project-defaults" },
      { kind: "section", key: "organization" },
      { kind: "section", key: "behavior" },
      { kind: "section", key: "projects-and-threads" },
      { kind: "section", key: "confirmations" },
      { kind: "section", key: "text-generation" },
      { kind: "section", key: "about" },
      { kind: "section", key: "diagnostics" },
      { kind: "section", key: "legacy-features" },
    ],
    sections: {
      organization: section(
        "organization",
        "Organization",
        visibleRows([
          "projectGrouping",
          "workingShelf",
          "autoSettleMerged",
          "autoSettleInactive",
          "autoSettleDays",
        ]),
      ),
      behavior: section("behavior", "Behavior", [
        { kind: "embedded", panel: "thread-notifications" },
        ...visibleRows([
          "inAppNotifications",
          "timeFormat",
          "responseStreaming",
          "hideWhitespaceChanges",
          "defaultDiffFileState",
          "diffLayout",
          "proactivePanels",
          "skillsInSlashMenu",
          "composerRichText",
          "composerCollapse",
          "sendShortcut",
          "followUpBehavior",
          "providerUpdateChecks",
          "continueThreadsAfterRestart",
          "backgroundActivity",
        ]),
      ]),
      "projects-and-threads": section(
        "projects-and-threads",
        "Projects & threads",
        visibleRows(["startFromOrigin", "addProjectBaseDirectory"]),
      ),
      confirmations: section(
        "confirmations",
        "Confirmations",
        visibleRows([
          "unpinConfirmation",
          "archiveConfirmation",
          "deleteConfirmation",
          "quitConfirmation",
        ]),
      ),
      "text-generation": section(
        "text-generation",
        "Text generation",
        visibleRows(["textGenerationModel"]),
      ),
      about: section("about", "About", [{ kind: "embedded", panel: "about" }]),
      diagnostics: section(
        "diagnostics",
        "Diagnostics",
        visibleRows(["diagnostics", "openSourceLicenses"]),
        { anchorId: null },
      ),
      "legacy-features": section(
        "legacy-features",
        "Legacy features",
        visibleRows(["legacyPlanMode", "legacyContextWindowIndicator", "legacySidebar"]),
        { collapsible: true },
      ),
    },
    rows,
    tokenStreamingWarning: buildTokenStreamingWarningModel(),
    backgroundActivityAdvanced: buildBackgroundActivityAdvancedModel(settings),
  };
}

export type GeneralSettingsSwitchKey =
  | "projectGrouping"
  | "workingShelf"
  | "autoSettleMerged"
  | "autoSettleInactive"
  | "inAppNotifications"
  | "hideWhitespaceChanges"
  | "proactivePanels"
  | "skillsInSlashMenu"
  | "composerRichText"
  | "composerCollapse"
  | "providerUpdateChecks"
  | "continueThreadsAfterRestart"
  | "startFromOrigin"
  | "unpinConfirmation"
  | "archiveConfirmation"
  | "deleteConfirmation"
  | "legacyPlanMode"
  | "legacyContextWindowIndicator"
  | "legacySidebar";

export type GeneralSettingsSelectKey =
  | "timeFormat"
  | "responseStreaming"
  | "defaultDiffFileState"
  | "diffLayout"
  | "sendShortcut"
  | "followUpBehavior"
  | "backgroundActivity"
  | "quitConfirmation";

export type GeneralSettingsResetKey =
  | GeneralSettingsSwitchKey
  | GeneralSettingsSelectKey
  | "addProjectBaseDirectory"
  | "textGenerationModel";

export type GeneralSettingsIntent =
  | { readonly kind: "toggle"; readonly key: GeneralSettingsSwitchKey; readonly checked: boolean }
  | {
      readonly kind: "select";
      readonly key: GeneralSettingsSelectKey;
      readonly value: string | null;
    }
  | { readonly kind: "reset"; readonly key: GeneralSettingsResetKey }
  | { readonly kind: "commit-add-project-base-directory"; readonly value: string }
  | { readonly kind: "commit-auto-settle-days"; readonly days: number }
  | { readonly kind: "confirm-token-streaming" }
  | { readonly kind: "use-paragraph-streaming" }
  | { readonly kind: "configure-background-activity" };

export type GeneralSettingsDecision =
  | { readonly kind: "none" }
  | { readonly kind: "patch"; readonly patch: ScopedSettingsPatch }
  | {
      readonly kind: "set-project-grouping";
      readonly patch: ScopedSettingsPatch;
      readonly rememberMode: SidebarProjectGroupingMode | null;
    }
  | { readonly kind: "open-token-streaming-warning" }
  | {
      readonly kind: "patch-and-close-token-streaming-warning";
      readonly patch: ScopedSettingsPatch;
    }
  | { readonly kind: "open-background-activity-dialog" };

export type GeneralSettingsChangeInput = {
  readonly settings: UnifiedSettings;
  readonly isMac: boolean;
  readonly isEnvironmentScope: boolean;
  readonly lastEnabledProjectGroupingMode: SidebarProjectGroupingMode;
  readonly intent: GeneralSettingsIntent;
};

const NO_CHANGE: GeneralSettingsDecision = { kind: "none" };

function patch(value: ScopedSettingsPatch): GeneralSettingsDecision {
  return { kind: "patch", patch: value };
}

function resolveToggle(
  input: GeneralSettingsChangeInput,
  key: GeneralSettingsSwitchKey,
  checked: boolean,
): GeneralSettingsDecision {
  switch (key) {
    case "projectGrouping": {
      const current = input.settings.sidebarProjectGroupingMode;
      const rememberMode = !checked && current !== "separate" ? current : null;
      return {
        kind: "set-project-grouping",
        rememberMode,
        patch: {
          sidebarProjectGroupingMode: projectGroupingModeFromToggle(
            checked,
            rememberMode ?? input.lastEnabledProjectGroupingMode,
          ),
        },
      };
    }
    case "workingShelf":
      return patch({ sidebarWorkingShelfEnabled: checked });
    case "autoSettleMerged":
      return patch({ sidebarAutoSettleOnMerge: checked });
    case "autoSettleInactive":
      return patch({ sidebarAutoSettleAfterDays: checked ? AUTO_SETTLE_DEFAULT_DAYS : null });
    case "inAppNotifications":
      return patch({ inAppNotificationsEnabled: checked });
    case "hideWhitespaceChanges":
      return patch({ diffIgnoreWhitespace: checked });
    case "proactivePanels":
      return patch({ proactivePanelsEnabled: checked });
    case "skillsInSlashMenu":
      return patch({ showSkillsInSlashMenu: checked });
    case "composerRichText":
      return patch({ composerRichTextEnabled: checked });
    case "composerCollapse":
      return patch({ composerCollapseOnScroll: checked });
    case "providerUpdateChecks":
      return patch({ enableProviderUpdateChecks: checked });
    case "continueThreadsAfterRestart":
      return patch({ continueThreadsAfterServerUpdate: checked });
    case "startFromOrigin":
      return patch({ newWorktreesStartFromOrigin: checked });
    case "unpinConfirmation":
      return patch({ confirmThreadUnpin: checked });
    case "archiveConfirmation":
      return patch({ confirmThreadArchive: checked });
    case "deleteConfirmation":
      return patch({ confirmThreadDelete: checked });
    case "legacyPlanMode":
      return patch({ planModeEnabled: checked });
    case "legacyContextWindowIndicator":
      return patch({ contextWindowMeterEnabled: checked });
    case "legacySidebar":
      return patch({ legacySidebarEnabled: checked });
  }
}

function resolveSelect(
  input: GeneralSettingsChangeInput,
  key: GeneralSettingsSelectKey,
  value: string | null,
): GeneralSettingsDecision {
  switch (key) {
    case "timeFormat":
      return value === "locale" || value === "12-hour" || value === "24-hour"
        ? patch({ timestampFormat: value })
        : NO_CHANGE;
    case "responseStreaming":
      // The legacy path needs an explicit confirmation.
      if (value === "token") return { kind: "open-token-streaming-warning" };
      return value === "turn" || value === "paragraph"
        ? patch({ responseStreamingMode: value })
        : NO_CHANGE;
    case "defaultDiffFileState":
      return value === "expanded" || value === "collapsed"
        ? patch({ diffFilesCollapsed: value === "collapsed" })
        : NO_CHANGE;
    case "diffLayout":
      return value === "stacked" || value === "split" ? patch({ diffLayout: value }) : NO_CHANGE;
    case "sendShortcut": {
      const selected = buildSendShortcutOptions(input.isMac).find(
        (candidate) => candidate.value === value,
      );
      return selected ? patch({ sendShortcut: selected.value }) : NO_CHANGE;
    }
    case "followUpBehavior":
      return value === "queue" || value === "steer"
        ? patch({ followUpBehavior: value })
        : NO_CHANGE;
    case "backgroundActivity":
      if (value === "advanced") {
        return input.isEnvironmentScope ? { kind: "open-background-activity-dialog" } : NO_CHANGE;
      }
      return isBackgroundActivityProfile(value)
        ? patch(backgroundActivityProfileSettings(value))
        : NO_CHANGE;
    case "quitConfirmation":
      return value === "direct" || value === "hold" || value === "double-click"
        ? patch({ confirmQuit: value })
        : NO_CHANGE;
  }
}

function resolveReset(key: GeneralSettingsResetKey): ScopedSettingsPatch {
  const defaults = DEFAULT_UNIFIED_SETTINGS;
  switch (key) {
    case "projectGrouping":
      return { sidebarProjectGroupingMode: defaults.sidebarProjectGroupingMode };
    case "workingShelf":
      return { sidebarWorkingShelfEnabled: defaults.sidebarWorkingShelfEnabled };
    case "autoSettleMerged":
      return { sidebarAutoSettleOnMerge: defaults.sidebarAutoSettleOnMerge };
    case "autoSettleInactive":
      return { sidebarAutoSettleAfterDays: defaults.sidebarAutoSettleAfterDays };
    case "inAppNotifications":
      return { inAppNotificationsEnabled: defaults.inAppNotificationsEnabled };
    case "timeFormat":
      return { timestampFormat: defaults.timestampFormat };
    case "responseStreaming":
      return { responseStreamingMode: defaults.responseStreamingMode };
    case "hideWhitespaceChanges":
      return { diffIgnoreWhitespace: defaults.diffIgnoreWhitespace };
    case "defaultDiffFileState":
      return { diffFilesCollapsed: defaults.diffFilesCollapsed };
    case "diffLayout":
      return { diffLayout: defaults.diffLayout };
    case "proactivePanels":
      return { proactivePanelsEnabled: defaults.proactivePanelsEnabled };
    case "skillsInSlashMenu":
      return { showSkillsInSlashMenu: defaults.showSkillsInSlashMenu };
    case "composerRichText":
      return { composerRichTextEnabled: defaults.composerRichTextEnabled };
    case "composerCollapse":
      return { composerCollapseOnScroll: defaults.composerCollapseOnScroll };
    case "sendShortcut":
      return { sendShortcut: defaults.sendShortcut };
    case "followUpBehavior":
      return { followUpBehavior: defaults.followUpBehavior };
    case "providerUpdateChecks":
      return { enableProviderUpdateChecks: defaults.enableProviderUpdateChecks };
    case "continueThreadsAfterRestart":
      return { continueThreadsAfterServerUpdate: defaults.continueThreadsAfterServerUpdate };
    case "backgroundActivity":
      return resetBackgroundActivitySettings();
    case "startFromOrigin":
      return { newWorktreesStartFromOrigin: defaults.newWorktreesStartFromOrigin };
    case "addProjectBaseDirectory":
      return { addProjectBaseDirectory: defaults.addProjectBaseDirectory };
    case "unpinConfirmation":
      return { confirmThreadUnpin: defaults.confirmThreadUnpin };
    case "archiveConfirmation":
      return { confirmThreadArchive: defaults.confirmThreadArchive };
    case "deleteConfirmation":
      return { confirmThreadDelete: defaults.confirmThreadDelete };
    case "quitConfirmation":
      return { confirmQuit: defaults.confirmQuit };
    case "textGenerationModel":
      return { textGenerationModelSelection: defaults.textGenerationModelSelection };
    case "legacyPlanMode":
      return { planModeEnabled: defaults.planModeEnabled };
    case "legacyContextWindowIndicator":
      return { contextWindowMeterEnabled: defaults.contextWindowMeterEnabled };
    case "legacySidebar":
      return { legacySidebarEnabled: defaults.legacySidebarEnabled };
  }
}

export function resolveGeneralSettingsChange(
  input: GeneralSettingsChangeInput,
): GeneralSettingsDecision {
  const { intent } = input;
  switch (intent.kind) {
    case "toggle":
      return resolveToggle(input, intent.key, intent.checked);
    case "select":
      return resolveSelect(input, intent.key, intent.value);
    case "reset":
      return patch(resolveReset(intent.key));
    case "commit-add-project-base-directory":
      return patch({ addProjectBaseDirectory: intent.value });
    case "commit-auto-settle-days":
      return patch({ sidebarAutoSettleAfterDays: intent.days });
    case "confirm-token-streaming":
      return {
        kind: "patch-and-close-token-streaming-warning",
        patch: { responseStreamingMode: "token" },
      };
    case "use-paragraph-streaming":
      return {
        kind: "patch-and-close-token-streaming-warning",
        patch: { responseStreamingMode: "paragraph" },
      };
    case "configure-background-activity":
      return { kind: "open-background-activity-dialog" };
  }
}

export type TextGenerationModelChange =
  | {
      readonly kind: "reject";
      readonly toast: { readonly title: string; readonly description: string };
    }
  | { readonly kind: "patch"; readonly patch: ScopedSettingsPatch };

export function resolveTextGenerationModelChange(input: {
  readonly settings: UnifiedSettings;
  readonly providers: readonly ServerProvider[];
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly disabledReason: string | null;
}): TextGenerationModelChange {
  if (input.disabledReason) {
    return {
      kind: "reject",
      toast: { title: "Text generation model not saved", description: input.disabledReason },
    };
  }
  return {
    kind: "patch",
    patch: {
      textGenerationModelSelection: resolveAppModelSelectionState(
        {
          ...input.settings,
          textGenerationModelSelection: createModelSelection(input.instanceId, input.model),
        },
        input.providers,
      ),
    },
  };
}

export function resolveTextGenerationModelOptionsChange(input: {
  readonly settings: UnifiedSettings;
  readonly providers: readonly ServerProvider[];
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  readonly options: ProviderOptions | undefined;
}): ScopedSettingsPatch {
  return {
    textGenerationModelSelection: resolveAppModelSelectionState(
      {
        ...input.settings,
        textGenerationModelSelection: createModelSelection(
          input.instanceId,
          input.model,
          input.options,
        ),
      },
      input.providers,
    ),
  };
}

export type UpdateTrackSource = "desktop" | "hosted";

export type AboutVersionModelInput = {
  readonly appVersion: string;
  readonly isElectron: boolean;
  readonly hasDesktopBridge: boolean;
  readonly hostedAppChannel: HostedAppChannel | null;
  readonly updateState: DesktopUpdateState | null;
  readonly isChangingUpdateChannel: boolean;
  readonly isUpdateActionPending: boolean;
};

export type AboutVersionButtonModel = {
  readonly label: string;
  readonly disabled: boolean;
  readonly tooltip: string | null;
};

export type AboutUpdateTrackModel = {
  readonly source: UpdateTrackSource;
  readonly title: string;
  readonly description: string;
  readonly ariaLabel: string;
  readonly value: DesktopUpdateChannel;
  readonly valueLabel: string;
  readonly options: readonly GeneralSettingsOption<DesktopUpdateChannel>[];
  readonly disabled: boolean;
};

export type AboutVersionModel = {
  readonly version: {
    readonly title: string;
    readonly version: string;
    readonly description: string;
    readonly button: AboutVersionButtonModel | null;
  };
  readonly updateTrack: AboutUpdateTrackModel | null;
};

const DESKTOP_UPDATE_ACTION_LABELS: Partial<Record<string, string>> = {
  download: "Download",
  install: "Install",
};

const DESKTOP_UPDATE_STATUS_LABELS: Partial<Record<string, string>> = {
  checking: "Checking…",
  downloading: "Downloading…",
  "up-to-date": "Up to Date",
};

export function buildAboutVersionModel(input: AboutVersionModelInput): AboutVersionModel {
  const showUpdateControls = input.isElectron || input.hostedAppChannel !== null;
  const updateState = input.updateState;
  const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";
  const description =
    showUpdateControls && (action === "download" || action === "install")
      ? "Update available."
      : "Current version of the application.";
  const button: AboutVersionButtonModel | null = showUpdateControls
    ? {
        label:
          DESKTOP_UPDATE_ACTION_LABELS[action] ??
          DESKTOP_UPDATE_STATUS_LABELS[updateState?.status ?? ""] ??
          "Check for Updates",
        disabled:
          (action === "none"
            ? !canCheckForUpdate(updateState)
            : isDesktopUpdateButtonDisabled(updateState)) || input.isUpdateActionPending,
        tooltip: updateState ? getDesktopUpdateButtonTooltip(updateState) : null,
      }
    : null;

  const selectedUpdateChannel = updateState?.channel ?? "latest";
  const selectedHostedAppChannel = input.hasDesktopBridge ? null : input.hostedAppChannel;
  const updateTrack: AboutUpdateTrackModel | null = !showUpdateControls
    ? null
    : input.hasDesktopBridge
      ? {
          source: "desktop",
          title: "Update track",
          description: "Use stable releases or nightly builds. Switch back anytime.",
          ariaLabel: "Update track",
          value: selectedUpdateChannel,
          valueLabel: selectedUpdateChannel === "nightly" ? "Nightly" : "Stable",
          options: [option("latest", "Stable"), option("nightly", "Nightly")],
          disabled: input.isChangingUpdateChannel,
        }
      : selectedHostedAppChannel
        ? {
            source: "hosted",
            title: "Update track",
            description: "Switches the hosted app release channel.",
            ariaLabel: "Update track",
            value: selectedHostedAppChannel,
            valueLabel: selectedHostedAppChannel === "nightly" ? "Nightly" : "Latest",
            options: [option("latest", "Latest"), option("nightly", "Nightly")],
            disabled: false,
          }
        : null;

  return {
    version: { title: "Version", version: input.appVersion, description, button },
    updateTrack,
  };
}

export type UpdateTrackChange =
  | { readonly kind: "none" }
  | { readonly kind: "set-desktop-channel"; readonly channel: DesktopUpdateChannel }
  | { readonly kind: "open-hosted-channel"; readonly channel: HostedAppChannel };

export function resolveUpdateTrackChange(input: {
  readonly source: UpdateTrackSource;
  readonly value: string | null;
  readonly selected: DesktopUpdateChannel;
  readonly canSetDesktopChannel: boolean;
}): UpdateTrackChange {
  const value = input.value;
  if ((value !== "latest" && value !== "nightly") || value === input.selected) {
    return { kind: "none" };
  }
  if (input.source === "hosted") return { kind: "open-hosted-channel", channel: value };
  return input.canSetDesktopChannel
    ? { kind: "set-desktop-channel", channel: value }
    : { kind: "none" };
}

export type DesktopUpdateButtonIntent =
  | { readonly kind: "none" }
  | { readonly kind: "download" }
  | { readonly kind: "install"; readonly confirmationMessage: string }
  | { readonly kind: "check" };

export function resolveDesktopUpdateButtonIntent(input: {
  readonly hasDesktopBridge: boolean;
  readonly canCheckForUpdate: boolean;
  readonly updateState: DesktopUpdateState | null;
  readonly isUpdateActionPending: boolean;
}): DesktopUpdateButtonIntent {
  if (!input.hasDesktopBridge) return { kind: "none" };
  const updateState = input.updateState;
  const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";
  if (action === "download") return { kind: "download" };
  if (action === "install") {
    if (input.isUpdateActionPending) return { kind: "none" };
    return {
      kind: "install",
      confirmationMessage: getDesktopUpdateInstallConfirmationMessage(
        updateState ?? { availableVersion: null, downloadedVersion: null },
      ),
    };
  }
  return input.canCheckForUpdate ? { kind: "check" } : { kind: "none" };
}

export type DesktopUpdateFailure =
  | "change-channel"
  | "download"
  | "confirm-install"
  | "install"
  | "check";

export type DesktopUpdateToast = {
  readonly title: string;
  readonly description: string;
};

const DESKTOP_UPDATE_FAILURE_TEXT: Record<
  DesktopUpdateFailure,
  { readonly title: string; readonly fallback: string }
> = {
  "change-channel": {
    title: "Could not change update track",
    fallback: "Update track change failed.",
  },
  download: { title: "Could not download update", fallback: "Download failed." },
  "confirm-install": { title: "Could not confirm update", fallback: "Update confirmation failed." },
  install: { title: "Could not install update", fallback: "Install failed." },
  check: { title: "Could not check for updates", fallback: "Update check failed." },
};

export function describeDesktopUpdateFailure(
  failure: DesktopUpdateFailure,
  error: unknown,
): DesktopUpdateToast {
  const text = DESKTOP_UPDATE_FAILURE_TEXT[failure];
  return {
    title: text.title,
    description: error instanceof Error ? error.message : text.fallback,
  };
}

export function describeUpdateCheckResult(result: {
  readonly checked: boolean;
  readonly state: Pick<DesktopUpdateState, "message">;
}): DesktopUpdateToast | null {
  if (result.checked) return null;
  return {
    title: "Could not check for updates",
    description: result.state.message ?? "Automatic updates are not available in this build.",
  };
}
