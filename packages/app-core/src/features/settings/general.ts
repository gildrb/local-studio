import {
  ProviderInstanceId,
  type EnvironmentId,
  type DesktopUpdateState,
  type ServerProvider,
  type UnifiedSettings,
} from "@t3tools/contracts";
import type { ClientSettings } from "@t3tools/contracts/settings";
import { createModelSelection } from "@t3tools/shared/model";
import {
  buildAboutVersionModel,
  buildGeneralSettingsModel,
  readLastEnabledProjectGroupingMode,
  resolveLegacyFeaturesSearchJump,
  rememberEnabledProjectGroupingMode,
  resolveAutoSettleDaysDraft,
  resolveBackgroundActivityAdvancedChange,
  resolveDesktopUpdateButtonIntent,
  resolveGeneralSettingsChange,
  resolveTextGenerationModelChange,
  resolveTextGenerationModelOptionsChange,
  resolveTextGenerationModelState,
  resolveUpdateTrackChange,
  type AboutVersionModel,
  type BackgroundActivityAdvancedModel,
  type GeneralSettingsIntent,
  type GeneralSettingsLayoutItem,
  type GeneralSettingsMixedState,
  type GeneralSettingsModel,
  type GeneralSettingsResetKey,
  type GeneralSettingsRow,
  type GeneralSettingsSection,
  type GeneralSettingsSectionKey,
  type GeneralSettingsSelectKey,
  type GeneralSettingsSwitchKey,
  type TextGenerationModelState,
  type TokenStreamingWarningModel,
  describeDesktopUpdateFailure,
  describeUpdateCheckResult,
  type DesktopUpdateFailure,
} from "@t3tools/web/src/components/settings/GeneralSettings.logic.ts";
import {
  buildNotificationSettingsModel,
  resolveNotificationModeChange,
  resolveNotificationPermissionResult,
  type NotificationPermissionOutcome,
  type NotificationSettingsModel,
} from "@t3tools/web/src/components/settings/NotificationSettings.logic.ts";
import { threadNotificationsService } from "../threadNotifications.ts";
import {
  buildProjectDefaultsModel,
  resolveDefaultModelDisabledReason,
  resolveProjectDefaultsChange,
  resolveProjectDefaultsModelPicker,
  resolveProjectDefaultsModelTargets,
  type ProjectDefaultsChangeContext,
  type ProjectDefaultsIntent,
  type ProjectDefaultsModelPickerState,
  type ProjectDefaultsRow,
} from "@t3tools/web/src/components/settings/ProjectDefaultsSettings.logic.ts";
import { scopedSettingsAreMixed } from "@t3tools/web/src/components/settings/scopedSettings.ts";
import { requestConfirmDialog } from "@t3tools/web/src/confirmDialog.ts";
import { resolveScopedModelDisabledReason } from "@t3tools/web/src/components/settings/useScopedModelAvailability.logic.ts";
import { getCustomModelOptionsByInstance } from "@t3tools/web/src/modelSelection.ts";
import type { EnvironmentPresentation } from "@t3tools/web/src/state/environments.ts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import { readAppVersion } from "../../appVersion.ts";
import type { FeatureContext } from "../../feature.ts";
import {
  createSettingsModelPickers,
  resolveSettingsTraitsSelection,
  settingsModelPickerControl,
  type SettingsModelPickerControlView,
  type SettingsModelPickerPopupView,
  type SettingsModelPickerSource,
} from "./modelPickers.ts";
import type {
  SettingsRowScope,
  SettingsScopeContextSnapshot,
  SettingsScopeRuntime,
  SettingsSection,
} from "./scope.ts";

export type GeneralSettingsRowView = GeneralSettingsRow & {
  readonly rowScope: SettingsRowScope | null;
};

export type ProjectDefaultsRowView = ProjectDefaultsRow & {
  readonly rowScope: SettingsRowScope;
};

export type GeneralSettingsView = {
  readonly layout: readonly GeneralSettingsLayoutItem[];
  readonly sections: Record<GeneralSettingsSectionKey, GeneralSettingsSection>;
  readonly rows: Readonly<Record<string, GeneralSettingsRowView | null>>;
  readonly tokenStreamingWarning: TokenStreamingWarningModel & { readonly open: boolean };
  readonly backgroundActivityAdvanced: BackgroundActivityAdvancedModel & {
    readonly open: boolean;
  };
  readonly notifications: NotificationSettingsModel;
  readonly about: AboutVersionModel;
  readonly projectDefaults: {
    readonly sectionId: string;
    readonly sectionTitle: string;
    readonly rows: readonly ProjectDefaultsRowView[];
  };
  readonly textGenerationPicker: SettingsModelPickerControlView | null;
  readonly defaultModelPicker: SettingsModelPickerControlView | null;
  readonly modelPicker: SettingsModelPickerPopupView | null;
  readonly legacyOpen: boolean;
};

type GeneralUiState = {
  readonly tokenStreamingWarningOpen: boolean;
  readonly backgroundActivityDialogOpen: boolean;
  readonly permissionMessage: string | null;
  readonly requesting: boolean;
  readonly legacyOpen: boolean;
  readonly isChangingUpdateChannel: boolean;
  readonly isUpdateActionPending: boolean;
};

const INITIAL_UI: GeneralUiState = {
  tokenStreamingWarningOpen: false,
  backgroundActivityDialogOpen: false,
  permissionMessage: null,
  requesting: false,
  legacyOpen: false,
  isChangingUpdateChannel: false,
  isUpdateActionPending: false,
};

const TEXT_GENERATION_PICKER = "text-generation-model";
const DEFAULT_MODEL_PICKER = "default-model";

const SWITCH_KEYS = [
  "projectGrouping",
  "workingShelf",
  "autoSettleMerged",
  "autoSettleInactive",
  "inAppNotifications",
  "hideWhitespaceChanges",
  "proactivePanels",
  "skillsInSlashMenu",
  "composerRichText",
  "composerCollapse",
  "providerUpdateChecks",
  "continueThreadsAfterRestart",
  "startFromOrigin",
  "unpinConfirmation",
  "archiveConfirmation",
  "deleteConfirmation",
  "legacyPlanMode",
  "legacyContextWindowIndicator",
  "legacySidebar",
] as const satisfies readonly GeneralSettingsSwitchKey[];

const SELECT_KEYS = [
  "timeFormat",
  "responseStreaming",
  "defaultDiffFileState",
  "diffLayout",
  "sendShortcut",
  "followUpBehavior",
  "backgroundActivity",
  "quitConfirmation",
] as const satisfies readonly GeneralSettingsSelectKey[];

const RESET_KEYS = [
  ...SWITCH_KEYS,
  ...SELECT_KEYS,
  "addProjectBaseDirectory",
  "textGenerationModel",
] as const satisfies readonly GeneralSettingsResetKey[];

const IntentSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("toggle"),
    key: Schema.Literals(SWITCH_KEYS),
    checked: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("select"),
    key: Schema.Literals(SELECT_KEYS),
    value: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({ kind: Schema.Literal("reset"), key: Schema.Literals(RESET_KEYS) }),
  Schema.Struct({
    kind: Schema.Literal("commit-add-project-base-directory"),
    value: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("commit-auto-settle-days"), days: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("confirm-token-streaming") }),
  Schema.Struct({ kind: Schema.Literal("use-paragraph-streaming") }),
  Schema.Struct({ kind: Schema.Literal("configure-background-activity") }),
]);

const ChangeParams = Schema.decodeUnknownSync(Schema.Struct({ intent: IntentSchema }));
const DraftParams = Schema.decodeUnknownSync(Schema.Struct({ draft: Schema.String }));
const OpenParams = Schema.decodeUnknownSync(Schema.Struct({ open: Schema.Boolean }));

const BackgroundIntentSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("set-shared-policy"),
    value: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("set-interval"),
    key: Schema.Literals([
      "automaticGitFetchInterval",
      "providerHealthRefreshInterval",
      "hostPowerMonitorActiveInterval",
      "hostPowerMonitorIdleInterval",
    ]),
    value: Schema.NullOr(Schema.Number),
  }),
  Schema.Struct({
    kind: Schema.Literal("set-pause"),
    key: Schema.Literals([
      "pauseWhenHostLocked",
      "pauseWhenHostLowPower",
      "pauseWhenClientLowPower",
      "pauseWhenOnBattery",
    ]),
    checked: Schema.Boolean,
  }),
  Schema.Struct({ kind: Schema.Literal("reset-all") }),
]);
const BackgroundParams = Schema.decodeUnknownSync(
  Schema.Struct({ intent: BackgroundIntentSchema }),
);

const ValueParams = Schema.decodeUnknownSync(
  Schema.Struct({ value: Schema.NullOr(Schema.String) }),
);

const AboutParams = Schema.decodeUnknownSync(
  Schema.Union([
    Schema.Struct({ kind: Schema.Literal("button") }),
    Schema.Struct({ kind: Schema.Literal("track"), value: Schema.NullOr(Schema.String) }),
  ]),
);

const ProjectDefaultsIntentSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("reset"),
    key: Schema.Literals([
      "model",
      "permissions",
      "workspace",
      "submodules",
      "auto-pull",
      "merge-method",
      "browser-access",
    ]),
  }),
  Schema.Struct({
    kind: Schema.Literal("select"),
    key: Schema.Literals(["permissions", "workspace", "submodules", "merge-method"]),
    value: Schema.Unknown,
  }),
  Schema.Struct({
    kind: Schema.Literal("toggle"),
    key: Schema.Literals(["auto-pull", "browser-access"]),
    checked: Schema.Boolean,
  }),
]);
const ProjectDefaultsParams = Schema.decodeUnknownSync(
  Schema.Struct({ intent: ProjectDefaultsIntentSchema }),
);

const LinkParams = Schema.decodeUnknownSync(
  Schema.Struct({
    route: Schema.Literals(["/settings/diagnostics", "/settings/open-source-licenses"]),
  }),
);

const PickerParams = Schema.decodeUnknownSync(
  Schema.Struct({ picker: Schema.Literals([TEXT_GENERATION_PICKER, DEFAULT_MODEL_PICKER]) }),
);
const PickerSearchParams = Schema.decodeUnknownSync(Schema.Struct({ query: Schema.String }));
const PickerRailParams = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const PickerInstanceParams = Schema.decodeUnknownSync(
  Schema.Struct({ instanceId: ProviderInstanceId }),
);
const PickerModelParams = Schema.decodeUnknownSync(
  Schema.Struct({ instanceId: ProviderInstanceId, slug: Schema.String }),
);
const TraitsParams = Schema.decodeUnknownSync(
  Schema.Struct({
    picker: Schema.Literals([TEXT_GENERATION_PICKER, DEFAULT_MODEL_PICKER]),
    descriptorId: Schema.String,
    value: Schema.String,
  }),
);

type GeneralDerived = {
  readonly settings: UnifiedSettings;
  readonly scopeContext: SettingsScopeContextSnapshot;
  readonly environmentId: EnvironmentId | null;
  readonly isEnvironmentScope: boolean;
  readonly textGeneration: TextGenerationModelState;
  readonly model: GeneralSettingsModel;
  readonly textGenerationSource: SettingsModelPickerSource | null;
  readonly defaults: ProjectDefaultsModelPickerState;
  readonly defaultsContext: ProjectDefaultsChangeContext;
  readonly defaultModelSource: SettingsModelPickerSource | null;
  readonly representative: EnvironmentPresentation | null;
};

function deriveGeneral(input: {
  readonly settings: UnifiedSettings;
  readonly scopeContext: SettingsScopeContextSnapshot;
  readonly environments: readonly EnvironmentPresentation[];
  readonly clientSettings: ClientSettings;
  readonly isMac: boolean;
}): GeneralDerived {
  const { settings, scopeContext, environments, clientSettings } = input;
  const { scope, environment, connectedEnvironments, targets, target } = scopeContext;
  const environmentId = environment?.environmentId ?? null;
  const isEnvironmentScope = scope.environmentIds.length === 1 && environmentId !== null;
  const serverProviders: readonly ServerProvider[] = environment?.serverConfig?.providers ?? [];
  const supports = (capability: "threadAutoSettlement" | "threadRestartContinuation") =>
    connectedEnvironments.length > 0 &&
    connectedEnvironments.every(
      (candidate) => candidate.serverConfig?.environment.capabilities[capability] === true,
    );
  const mixedOf = (key: keyof GeneralSettingsMixedState) => scopedSettingsAreMixed(targets, [key]);
  const mixed: GeneralSettingsMixedState = {
    responseStreamingMode: mixedOf("responseStreamingMode"),
    backgroundActivity: mixedOf("backgroundActivity"),
    addProjectBaseDirectory: mixedOf("addProjectBaseDirectory"),
    textGenerationModelSelection: mixedOf("textGenerationModelSelection"),
    sidebarAutoSettleOnMerge: mixedOf("sidebarAutoSettleOnMerge"),
    sidebarAutoSettleAfterDays: mixedOf("sidebarAutoSettleAfterDays"),
    enableProviderUpdateChecks: mixedOf("enableProviderUpdateChecks"),
    continueThreadsAfterServerUpdate: mixedOf("continueThreadsAfterServerUpdate"),
    newWorktreesStartFromOrigin: mixedOf("newWorktreesStartFromOrigin"),
  };
  const textGeneration = resolveTextGenerationModelState({ settings, serverProviders });
  const model = buildGeneralSettingsModel({
    settings,
    isMac: input.isMac,
    isElectron: false,
    environmentId,
    isEnvironmentScope,
    hasServerTargets: connectedEnvironments.length > 0,
    supportsAutoSettlement: supports("threadAutoSettlement"),
    supportsRestartContinuation: supports("threadRestartContinuation"),
    mixed,
    textGeneration,
  });
  const picker = model.rows.textGenerationModel.control;
  const textGenerationEntry = textGeneration.instanceEntry;
  const textGenerationSource: SettingsModelPickerSource | null =
    picker.unavailableMessage !== null
      ? null
      : {
          contextInput: {
            activeInstanceId: picker.activeInstanceId,
            model: picker.model,
            instanceEntries: textGeneration.instanceEntries,
            modelOptionsByInstance: getCustomModelOptionsByInstance(
              settings,
              textGeneration.providers,
              textGeneration.selection.instanceId,
              textGeneration.selection.model,
            ),
            lockedProvider: null,
            canOpenProviderSetup: picker.canOpenProviderSetup && environmentId !== null,
            favorites: clientSettings.favorites,
          },
          triggerLabel: picker.triggerLabel,
          disabledReason: (instanceId, modelSlug) =>
            resolveScopedModelDisabledReason({
              settings,
              entries: textGeneration.instanceEntries,
              targets,
              environments,
              instanceId,
              model: modelSlug,
            }),
          traits:
            picker.showTraitsPicker && textGenerationEntry
              ? {
                  provider: picker.driverKind,
                  models: textGenerationEntry.models,
                  model: picker.model,
                  modelOptions: textGeneration.selection.options,
                  planModeEnabled: settings.planModeEnabled,
                }
              : null,
        };
  const representative = target
    ? (environments.find((candidate) => candidate.environmentId === target.environmentId) ?? null)
    : null;
  const defaults = resolveProjectDefaultsModelPicker({
    providers: representative?.serverConfig?.providers ?? [],
    settings,
  });
  const defaultsContext: ProjectDefaultsChangeContext = {
    settings,
    entries: defaults.entries,
    modelTargets: resolveProjectDefaultsModelTargets({ targets, environments }),
  };
  const { selection, activeEntry } = defaults;
  const mixedModel = scopedSettingsAreMixed(targets, ["defaultModelSelection"]);
  const defaultModelSource: SettingsModelPickerSource | null =
    selection && activeEntry
      ? {
          contextInput: {
            activeInstanceId: selection.instanceId,
            model: selection.model,
            instanceEntries: defaults.entries,
            modelOptionsByInstance: defaults.modelOptions,
            lockedProvider: null,
            canOpenProviderSetup: true,
            favorites: clientSettings.favorites,
          },
          triggerLabel: mixedModel ? "Mixed" : null,
          disabledReason: (instanceId, modelSlug) =>
            resolveDefaultModelDisabledReason(defaultsContext, instanceId, modelSlug),
          traits: mixedModel
            ? null
            : {
                provider: activeEntry.driverKind,
                models: activeEntry.models,
                model: selection.model,
                modelOptions: selection.options ?? [],
                planModeEnabled: settings.planModeEnabled,
              },
        }
      : null;
  return {
    settings,
    scopeContext,
    environmentId,
    isEnvironmentScope,
    textGeneration,
    model,
    textGenerationSource,
    defaults,
    defaultsContext,
    defaultModelSource,
    representative,
  };
}

export function createGeneralSettings(
  context: FeatureContext,
  scope: SettingsScopeRuntime,
): SettingsSection {
  const { registry, storage } = context;
  const uiAtom = Atom.make<GeneralUiState>(INITIAL_UI).pipe(Atom.keepAlive);
  const pickers = createSettingsModelPickers({
    registry,
    platform: context.platform,
    updateClientSettings: context.updateClientSettings,
  });
  const appVersion = readAppVersion();

  const patchUi = (patch: Partial<GeneralUiState>) =>
    registry.set(uiAtom, { ...registry.get(uiAtom), ...patch });

  let lastExpandedLegacyTargetId: string | null = null;
  const applyLegacySearchJump = (searchTargetId: string | null) => {
    const jump = resolveLegacyFeaturesSearchJump({
      searchTargetId,
      lastExpandedTargetId: lastExpandedLegacyTargetId,
    });
    lastExpandedLegacyTargetId = jump.lastExpandedTargetId;
    if (jump.expand) patchUi({ legacyOpen: true });
  };
  registry.subscribe(scope.searchTargetAtom, (target) => applyLegacySearchJump(target.targetId));

  const current = (): GeneralDerived =>
    deriveGeneral({
      settings: registry.get(scope.scopedSettingsAtom),
      scopeContext: registry.get(scope.scopeContextAtom),
      environments: registry.get(scope.environmentsAtom),
      clientSettings: registry.get(context.clientSettingsAtom),
      isMac: scope.isMac,
    });

  const aboutModel = (updateState: DesktopUpdateState, ui: GeneralUiState): AboutVersionModel =>
    buildAboutVersionModel({
      appVersion,
      isElectron: true,
      hasDesktopBridge: true,
      hostedAppChannel: null,
      updateState,
      isChangingUpdateChannel: ui.isChangingUpdateChannel,
      isUpdateActionPending: ui.isUpdateActionPending,
    });

  const viewAtom = Atom.make((get): GeneralSettingsView | null => {
    if (get(scope.sectionAtom) !== "general") return null;
    const derived = deriveGeneral({
      settings: get(scope.scopedSettingsAtom),
      scopeContext: get(scope.scopeContextAtom),
      environments: get(scope.environmentsAtom),
      clientSettings: get(context.clientSettingsAtom),
      isMac: scope.isMac,
    });
    const { model, settings, scopeContext } = derived;
    const ui = get(uiAtom);
    const pickerState = get(pickers.stateAtom);
    const keybindings = get(context.state.primaryServerConfigAtom)?.keybindings ?? [];
    const rows: Record<string, GeneralSettingsRowView | null> = {};
    for (const [key, row] of Object.entries(model.rows)) {
      rows[key] =
        row === null
          ? null
          : {
              ...row,
              rowScope: row.serverScoped
                ? scope.rowScope(get, { serverScoped: true, settingKeys: row.settingKeys })
                : null,
            };
    }
    const defaultsModel = buildProjectDefaultsModel({
      category: "general",
      scopeKind: scopeContext.scope.kind,
      connectedEnvironmentCount: scopeContext.connectedEnvironments.length,
      settings,
      targetSettings: scopeContext.target?.settings ?? null,
      targets: scopeContext.targets,
      modelPicker: derived.defaults,
    });
    const popup =
      derived.textGenerationSource !== null &&
      pickers.popup(pickerState, TEXT_GENERATION_PICKER, derived.textGenerationSource, keybindings);
    const defaultPopup =
      derived.defaultModelSource !== null &&
      pickers.popup(pickerState, DEFAULT_MODEL_PICKER, derived.defaultModelSource, keybindings);
    return {
      layout: model.layout,
      sections: model.sections,
      rows,
      tokenStreamingWarning: { ...model.tokenStreamingWarning, open: ui.tokenStreamingWarningOpen },
      backgroundActivityAdvanced: {
        ...model.backgroundActivityAdvanced,
        open: ui.backgroundActivityDialogOpen && derived.isEnvironmentScope,
      },
      notifications: buildNotificationSettingsModel({
        mode: settings.notificationMode,
        permissionMessage: ui.permissionMessage,
        requesting: ui.requesting,
      }),
      about: aboutModel(get(context.desktop.updates.stateAtom), ui),
      projectDefaults: {
        sectionId: defaultsModel.sectionId,
        sectionTitle: defaultsModel.sectionTitle,
        rows: defaultsModel.rows.map((row) => ({
          ...row,
          rowScope: scope.rowScope(get, {
            serverScoped: true,
            settingKeys: row.settingKeys,
            mixed: row.mixed,
          }),
        })),
      },
      textGenerationPicker:
        derived.textGenerationSource === null
          ? null
          : settingsModelPickerControl(derived.textGenerationSource),
      defaultModelPicker:
        derived.defaultModelSource === null
          ? null
          : settingsModelPickerControl(derived.defaultModelSource),
      modelPicker: popup || defaultPopup || null,
      legacyOpen: ui.legacyOpen,
    };
  });

  const applyDecision = async (intent: GeneralSettingsIntent) => {
    const derived = current();
    const decision = resolveGeneralSettingsChange({
      settings: derived.settings,
      isMac: scope.isMac,
      isEnvironmentScope: derived.isEnvironmentScope,
      lastEnabledProjectGroupingMode: readLastEnabledProjectGroupingMode(storage),
      intent,
    });
    switch (decision.kind) {
      case "none":
        return;
      case "patch":
        await scope.updateScopedSettings(decision.patch);
        return;
      case "set-project-grouping":
        if (decision.rememberMode !== null) {
          rememberEnabledProjectGroupingMode(storage, decision.rememberMode);
        }
        await scope.updateScopedSettings(decision.patch);
        return;
      case "open-token-streaming-warning":
        patchUi({ tokenStreamingWarningOpen: true });
        return;
      case "patch-and-close-token-streaming-warning":
        patchUi({ tokenStreamingWarningOpen: false });
        await scope.updateScopedSettings(decision.patch);
        return;
      case "open-background-activity-dialog":
        patchUi({ backgroundActivityDialogOpen: true });
        return;
    }
  };

  const pickerSource = (picker: string): SettingsModelPickerSource | null => {
    const derived = current();
    return picker === TEXT_GENERATION_PICKER
      ? derived.textGenerationSource
      : derived.defaultModelSource;
  };

  const applyProjectDefaults = async (intent: ProjectDefaultsIntent) => {
    const change = resolveProjectDefaultsChange(intent, current().defaultsContext);
    if (change.kind === "rejected") {
      context.addToast({ layout: "plain", ...change.toast });
      return;
    }
    if (change.kind === "patch") await scope.updateScopedSettings(change.patch);
  };

  return {
    views: { settingsGeneral: viewAtom },
    actions: {
      settingsGeneralMount: async () => {
        registry.set(uiAtom, INITIAL_UI);
        pickers.close();
        lastExpandedLegacyTargetId = null;
        applyLegacySearchJump(registry.get(scope.searchTargetAtom).targetId);
        return null;
      },
      settingsGeneralLegacyOpen: async (params) => {
        patchUi({ legacyOpen: OpenParams(params).open });
        return null;
      },
      settingsGeneralChange: async (params) => {
        await applyDecision(ChangeParams(params).intent);
        return null;
      },
      settingsGeneralAutoSettleDraft: async (params) => {
        const days = resolveAutoSettleDaysDraft(DraftParams(params).draft);
        if (days !== null) await applyDecision({ kind: "commit-auto-settle-days", days });
        return null;
      },
      settingsGeneralTokenStreamingWarning: async (params) => {
        patchUi({ tokenStreamingWarningOpen: OpenParams(params).open });
        return null;
      },
      settingsGeneralBackgroundActivityDialog: async (params) => {
        patchUi({ backgroundActivityDialogOpen: OpenParams(params).open });
        return null;
      },
      settingsGeneralBackgroundActivity: async (params) => {
        const patch = resolveBackgroundActivityAdvancedChange({
          settings: current().settings,
          intent: BackgroundParams(params).intent,
        });
        if (patch) await scope.updateScopedSettings(patch);
        return null;
      },
      settingsGeneralNotificationMode: async (params) => {
        const change = resolveNotificationModeChange({
          value: ValueParams(params).value,
          notificationApiAvailable: true,
          isSecureContext: true,
        });
        if (change.kind === "ignore") return null;
        patchUi({ permissionMessage: null });
        if (change.kind === "unsupported") {
          patchUi({ permissionMessage: change.message });
          return null;
        }
        if (change.kind === "apply") {
          await scope.updateScopedSettings(change.patch);
          return null;
        }
        patchUi({ requesting: true });
        let outcome: NotificationPermissionOutcome;
        try {
          outcome = await threadNotificationsService(context).requestPermission();
        } finally {
          patchUi({ requesting: false });
        }
        const decision = resolveNotificationPermissionResult({ mode: change.mode, outcome });
        if (decision.kind === "message") {
          patchUi({ permissionMessage: decision.message });
          return null;
        }
        await scope.updateScopedSettings(decision.patch);
        return null;
      },
      settingsGeneralAbout: async (params) => {
        const intent = AboutParams(params);
        const updates = context.desktop.updates;
        const ui = registry.get(uiAtom);
        const updateState = registry.get(updates.stateAtom);
        const model = aboutModel(updateState, ui);
        const showFailure = (failure: DesktopUpdateFailure, error: unknown) =>
          context.addToast({
            layout: "plain",
            type: "error",
            ...describeDesktopUpdateFailure(failure, error),
          });
        if (intent.kind === "track") {
          const track = model.updateTrack;
          if (track === null) return null;
          const change = resolveUpdateTrackChange({
            source: track.source,
            value: intent.value,
            selected: track.value,
            canSetDesktopChannel: true,
          });
          if (change.kind !== "set-desktop-channel") return null;
          patchUi({ isChangingUpdateChannel: true });
          void updates
            .setChannel(change.channel)
            .catch((error: unknown) => showFailure("change-channel", error))
            .finally(() => patchUi({ isChangingUpdateChannel: false }));
          return null;
        }
        const button = resolveDesktopUpdateButtonIntent({
          hasDesktopBridge: true,
          canCheckForUpdate: true,
          updateState,
          isUpdateActionPending: ui.isUpdateActionPending,
        });
        if (button.kind === "download") {
          void updates.download().catch((error: unknown) => showFailure("download", error));
          return null;
        }
        if (button.kind === "install") {
          patchUi({ isUpdateActionPending: true });
          let confirmed = false;
          try {
            confirmed = await (requestConfirmDialog(button.confirmationMessage) ??
              Promise.reject(new Error("Confirmations are not available in the native app yet.")));
          } catch (error) {
            patchUi({ isUpdateActionPending: false });
            showFailure("confirm-install", error);
            return null;
          }
          if (!confirmed) {
            patchUi({ isUpdateActionPending: false });
            return null;
          }
          void updates
            .install()
            .catch((error: unknown) => showFailure("install", error))
            .finally(() => patchUi({ isUpdateActionPending: false }));
          return null;
        }
        if (button.kind === "check") {
          void updates
            .check("settings")
            .then((result) => {
              const toast = describeUpdateCheckResult(result);
              if (toast) context.addToast({ layout: "plain", type: "error", ...toast });
            })
            .catch((error: unknown) => showFailure("check", error));
        }
        return null;
      },
      settingsGeneralProjectDefaults: async (params) => {
        await applyProjectDefaults(ProjectDefaultsParams(params).intent);
        return null;
      },
      settingsGeneralOpenLink: async (params) => {
        const { route } = LinkParams(params);
        context.navigate({ kind: "settings", section: route.slice("/settings/".length) });
        return null;
      },
      settingsGeneralPickerOpen: async (params) => {
        const { picker } = PickerParams(params);
        if (pickers.openPicker() === picker) {
          pickers.close();
          return null;
        }
        const source = pickerSource(picker);
        if (source !== null) pickers.open(picker, source);
        return null;
      },
      settingsGeneralPickerClose: async () => {
        pickers.close();
        return null;
      },
      settingsGeneralPickerSearch: async (params) => {
        pickers.setSearch(PickerSearchParams(params).query);
        return null;
      },
      settingsGeneralPickerRail: async (params) => {
        const { id } = PickerRailParams(params);
        pickers.setRail(id === "favorites" ? "favorites" : ProviderInstanceId.make(id));
        return null;
      },
      settingsGeneralPickerToggleLegacy: async (params) => {
        pickers.toggleLegacy(PickerInstanceParams(params).instanceId);
        return null;
      },
      settingsGeneralPickerFavorite: async (params) => {
        const { instanceId, slug } = PickerModelParams(params);
        await pickers.toggleFavorite(instanceId, slug);
        return null;
      },
      settingsGeneralPickerSetup: async (params) => {
        const picker = pickers.openPicker();
        PickerInstanceParams(params);
        pickers.close();
        if (picker === DEFAULT_MODEL_PICKER && current().representative === null) return null;
        context.navigate({ kind: "settings", section: "providers" });
        return null;
      },
      settingsGeneralPickerSelect: async (params) => {
        const picker = pickers.openPicker();
        if (picker === null) return null;
        const source = pickerSource(picker);
        if (source === null) return null;
        const { instanceId, slug } = PickerModelParams(params);
        const selection = pickers.resolveSelection(source, instanceId, slug);
        if (selection === null) return null;
        pickers.close();
        if (picker === DEFAULT_MODEL_PICKER) {
          await applyProjectDefaults({
            kind: "model",
            selection: createModelSelection(selection.instanceId, selection.model),
          });
          return null;
        }
        const derived = current();
        const change = resolveTextGenerationModelChange({
          settings: derived.settings,
          providers: derived.textGeneration.providers,
          instanceId: selection.instanceId,
          model: selection.model,
          disabledReason: source.disabledReason(selection.instanceId, selection.model),
        });
        if (change.kind === "reject") {
          context.addToast({ layout: "plain", type: "error", ...change.toast });
          return null;
        }
        await scope.updateScopedSettings(change.patch);
        return null;
      },
      settingsGeneralTraitsSelect: async (params) => {
        const { picker, descriptorId, value } = TraitsParams(params);
        const source = pickerSource(picker);
        if (source === null || source.traits === null) return null;
        const options = resolveSettingsTraitsSelection(source.traits, descriptorId, value);
        if (options === null) return null;
        const { activeInstanceId, model } = source.contextInput;
        if (picker === DEFAULT_MODEL_PICKER) {
          await applyProjectDefaults({
            kind: "model",
            selection: createModelSelection(activeInstanceId, model, options.next),
          });
          return null;
        }
        const derived = current();
        await scope.updateScopedSettings(
          resolveTextGenerationModelOptionsChange({
            settings: derived.settings,
            providers: derived.textGeneration.providers,
            instanceId: activeInstanceId,
            model,
            options: options.next,
          }),
        );
        return null;
      },
    },
  };
}
