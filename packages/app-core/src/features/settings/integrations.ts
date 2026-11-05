import { randomUUID } from "node:crypto";

import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  type BrowserImportSource,
  type DeviceServiceState,
  EnvironmentId,
  type SshDeviceHostConfig,
} from "@t3tools/contracts";
import type { ClientSettings, ClientSettingsPatch } from "@t3tools/contracts/settings";
import { resolveEnvironmentOptionLabel } from "@t3tools/web/src/components/BranchToolbar.logic.ts";
import {
  buildDeviceHostAvailabilityModel,
  type DeviceHostAvailabilityItemModel,
} from "@t3tools/web/src/components/device/DeviceHostAvailability.logic.ts";
import {
  buildDeviceHostUpdatesModel,
  type DeviceHostUpdateModel,
} from "@t3tools/web/src/components/device/DeviceHostUpdates.logic.ts";
import {
  agentDeviceDescription,
  buildAgentDeviceSetupStatusModel,
  buildDeviceHubSetupStatusModel,
  buildPlatformStatusModel,
  deviceHubDescription,
  platformSetupStatus,
  type DeviceSetupStatusModel,
  type PlatformStatusModel,
} from "@t3tools/web/src/components/device/DeviceSetup.logic.ts";
import {
  buildDeviceToolVersionsModel,
  type DeviceToolVersionsModel,
} from "@t3tools/web/src/components/device/DeviceToolVersions.logic.ts";
import {
  BROWSER_PROFILE_REMOVAL_FAILED_MESSAGE,
  DEVICE_TOOL_UPDATE_FAILED_MESSAGE,
  browserProfileRemovalPatch,
  buildIntegrationsSettingsModel,
  clearBrowserProfileData,
  deviceConfigureRequest,
  deviceSettingsFailureToast,
  importFailureMessage,
  importFailureReason,
  resolveClearBrowserProfileData,
  resolveCreateBrowserProfile,
  resolveDeviceIntegrationToggle,
  resolveDeviceListRequest,
  resolveDevicePlatformsRevealed,
  resolveImportedProfileRegistration,
  resolveIntegrationsSettingsChange,
  resolveRemoveBrowserProfile,
  resolveRenameBrowserProfile,
  resolveSetDefaultBrowserProfile,
  resolveWizardImportBlock,
  wizardImportTargetMissing,
  type DeviceConfigureInput,
  type DeviceIntegrationModel,
  type DeviceIntegrationPending,
  type DeviceListAction,
  type DeviceTool,
  type DeviceToolUpdateError,
  type BrowserProfilesModel,
  type IntegrationsBrowserRowModel,
  type IntegrationsResettableSetting,
  type IntegrationsSettingsChange,
  type IntegrationsToast,
} from "@t3tools/web/src/components/settings/IntegrationsSettings.logic.ts";
import {
  FULL_DISK_ACCESS_OPEN_FAILED_MESSAGE,
  WIZARD_FAILED_STEP,
  buildBrowserImportWizardModel,
  buildFullDiskAccessStatusModel,
  fullDiskAccessRecheckStep,
  initialTargetSelection,
  initialWizardStep,
  isImportSourceReadable,
  outcomeToStep,
  refreshedSourceProfileDirectory,
  refreshedSourceStep,
  resolveWizardImport,
  type BrowserImportWizardModel,
  type FullDiskAccessStatusModel,
  type ImportOutcome,
  type WizardStep,
  type WizardTarget,
  type WizardTargetSelection,
} from "@t3tools/web/src/components/settings/browserImportWizard.logic.ts";
import {
  checkDeviceHostConnections,
  deviceHostConnectionKey,
  type DeviceHostCheck,
  type DeviceHostCheckTarget,
} from "@t3tools/web/src/components/settings/deviceHostConnectionChecks.ts";
import {
  buildDeviceHostEditorModel,
  buildDeviceHostListModel,
  canSaveDeviceHosts,
  deviceHostTestToast,
  deviceHostsSaveFailureToast,
  newDeviceHostDraft,
  resolveDeviceHostDraftChange,
  resolveDeviceHostEditorSubmit,
  resolveDeviceHostEditorTest,
  updateDeviceHosts,
  type DeviceHostChecks,
  type DeviceHostEditorModel,
  type DeviceHostListModel,
  type DeviceHostsSettingsModel,
} from "@t3tools/web/src/components/settings/deviceHostsSettings.logic.ts";
import type { EnvironmentPresentation } from "@t3tools/web/src/state/environments.ts";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

import {
  checkFullDiskAccess,
  importBrowserCookies,
  listBrowserImportSources,
  openFullDiskAccessSettings,
} from "../../browserImport.ts";
import { browserPreviewService } from "../../browserPreview.ts";
import { EMPTY_DEVICE_STATE, readDeviceState } from "../../deviceState.ts";
import type { FeatureContext } from "../../feature.ts";
import {
  createProjectDefaults,
  PROJECT_DEFAULTS_PICKER,
  type ProjectDefaultsView,
} from "./projectDefaults.ts";
import type { SettingsModelPickerPopupView } from "./modelPickers.ts";
import type { SettingsRowScope, SettingsScopeRuntime, SettingsSection } from "./scope.ts";
import { createSectionPickers } from "./sectionPickers.ts";

type Read = <A>(atom: Atom.Atom<A>) => A;

const SECTION = "integrations";
const PERMISSION_POLL_MS = 1_500;
const PERMISSION_CHECK_FAILED_MESSAGE =
  "Could not check permissions. We'll try again automatically.";

class ProfileLimitReachedError extends Error {
  constructor() {
    super("Browser profile limit reached.");
    this.name = "ProfileLimitReachedError";
  }
}

type WizardState = {
  readonly source: BrowserImportSource;
  readonly environmentId: EnvironmentId;
  readonly environmentName: string;
  readonly step: WizardStep;
  readonly sourceProfileDirectory: string;
  readonly target: WizardTargetSelection;
  readonly targetError: string | null;
  readonly newProfileId: string;
  readonly inFlight: boolean;
  readonly fullDiskAccess: boolean;
  readonly permissionError: string | null;
  readonly opening: boolean;
  readonly openingError: string | null;
};

type HostEditorState = {
  readonly host: SshDeviceHostConfig;
  readonly draft: SshDeviceHostConfig;
  readonly isNew: boolean;
  readonly original: SshDeviceHostConfig | null;
  readonly checks: DeviceHostChecks;
};

type IntegrationsUi = {
  readonly sources: ReadonlyArray<BrowserImportSource> | null;
  readonly wizard: WizardState | null;
  readonly pendingRemoval: { readonly id: string; readonly name: string } | null;
  readonly removalError: string | null;
  readonly removalInFlight: boolean;
  readonly importInFlight: boolean;
  readonly deviceKey: string | null;
  readonly devicePending: DeviceIntegrationPending | null;
  readonly platformsRevealed: boolean;
  readonly updateError: DeviceToolUpdateError | null;
  readonly hostsBusy: boolean;
  readonly checks: DeviceHostChecks;
  readonly editor: HostEditorState | null;
  readonly retrying: Readonly<Record<string, string | null>>;
  readonly updatesPending: string | null;
};

const INITIAL_UI: IntegrationsUi = {
  sources: null,
  wizard: null,
  pendingRemoval: null,
  removalError: null,
  removalInFlight: false,
  importInFlight: false,
  deviceKey: null,
  devicePending: null,
  platformsRevealed: false,
  updateError: null,
  hostsBusy: false,
  checks: {},
  editor: null,
  retrying: {},
  updatesPending: null,
};

export type IntegrationsWizardView = BrowserImportWizardModel & {
  readonly fullDiskAccess: {
    readonly granted: boolean;
    readonly busy: boolean;
    readonly ready: boolean;
    readonly allowLabel: string;
    readonly allowedLabel: string;
    readonly status: FullDiskAccessStatusModel;
  };
};

export type IntegrationsDeviceControlsView = DeviceIntegrationModel & {
  readonly hubDescription: string;
  readonly agentDescription: string;
  readonly hubRowScope: SettingsRowScope;
  readonly agentRowScope: SettingsRowScope;
  readonly hubVersions: DeviceToolVersionsModel;
  readonly agentVersions: DeviceToolVersionsModel;
  readonly hubStatus: DeviceSetupStatusModel | null;
  readonly agentStatus: DeviceSetupStatusModel | null;
  readonly platformStatuses: ReadonlyArray<PlatformStatusModel>;
  readonly hostUpdates: ReadonlyArray<DeviceHostUpdateModel>;
};

export type IntegrationsDeviceHostRowView = DeviceHostListModel["hosts"][number] & {
  readonly versions: DeviceToolVersionsModel;
};

export type IntegrationsDeviceHostGroupView = {
  readonly environmentId: EnvironmentId;
  readonly heading: string | null;
  readonly emptyMessage: string | null;
  readonly hosts: ReadonlyArray<IntegrationsDeviceHostRowView>;
};

export type IntegrationsDeviceHostEditorView = Omit<DeviceHostEditorModel, "connection"> & {
  readonly connection: Omit<DeviceHostEditorModel["connection"], "results"> & {
    readonly results: ReadonlyArray<
      Omit<NonNullable<DeviceHostEditorModel["connection"]["results"]>[number], "platforms"> & {
        readonly platforms: ReadonlyArray<DeviceHostAvailabilityItemModel> | null;
      }
    > | null;
  };
};

export type IntegrationsDeviceHostsView = DeviceHostsSettingsModel & {
  readonly rowScope: SettingsRowScope;
  readonly groupsView: ReadonlyArray<IntegrationsDeviceHostGroupView>;
  readonly editor: IntegrationsDeviceHostEditorView | null;
};

export type IntegrationsSettingsView = {
  readonly defaults: ProjectDefaultsView;
  readonly modelPicker: SettingsModelPickerPopupView | null;
  readonly browser: { readonly id: string; readonly title: string };
  readonly browserUnavailableMessage: string | null;
  readonly browserRows: ReadonlyArray<IntegrationsBrowserRowModel>;
  readonly devices: { readonly id: string; readonly title: string };
  readonly deviceControls: IntegrationsDeviceControlsView;
  readonly deviceHosts: IntegrationsDeviceHostsView;
  readonly wizard: IntegrationsWizardView | null;
};

const BrowserChangeParams = Schema.decodeUnknownSync(
  Schema.Struct({
    id: Schema.String,
    value: Schema.optional(Schema.NullOr(Schema.String)),
    checked: Schema.optional(Schema.Boolean),
  }),
);
const DimensionParams = Schema.decodeUnknownSync(
  Schema.Struct({
    axis: Schema.Literals(["width", "height"]),
    value: Schema.NullOr(Schema.Number),
  }),
);
const IdParams = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const RenameParams = Schema.decodeUnknownSync(
  Schema.Struct({ profileId: Schema.String, name: Schema.String }),
);
const ProfileActionParams = Schema.decodeUnknownSync(
  Schema.Struct({
    profileId: Schema.String,
    action: Schema.Literals(["setDefault", "clearData", "remove"]),
  }),
);
const SourceParams = Schema.decodeUnknownSync(Schema.Struct({ sourceId: Schema.String }));
const DirectoryParams = Schema.decodeUnknownSync(Schema.Struct({ directory: Schema.String }));
const TargetParams = Schema.decodeUnknownSync(
  Schema.Struct({
    kind: Schema.Literals(["new", "existing"]),
    profileId: Schema.optional(Schema.String),
  }),
);
const ToggleParams = Schema.decodeUnknownSync(
  Schema.Struct({ tool: Schema.Literals(["hub", "agent"]), checked: Schema.Boolean }),
);
const ListParams = Schema.decodeUnknownSync(
  Schema.Struct({
    kind: Schema.Literals(["update", "inspect", "refresh"]),
    tool: Schema.optional(Schema.Literals(["hub", "agent"])),
  }),
);
const HostParams = Schema.decodeUnknownSync(
  Schema.Struct({ environmentId: Schema.String, hostId: Schema.String }),
);
const HostIdParams = Schema.decodeUnknownSync(Schema.Struct({ hostId: Schema.String }));
const FieldParams = Schema.decodeUnknownSync(
  Schema.Struct({
    field: Schema.Literals(["label", "target", "identityFile", "port"]),
    value: Schema.String,
  }),
);

const SELECT_CHANGES: Readonly<
  Record<string, (value: string | null) => IntegrationsSettingsChange>
> = {
  "browser-default-zoom": (value) => ({ kind: "zoomSelect", value }),
  "browser-default-appearance": (value) => ({ kind: "appearanceSelect", value }),
  "browser-recording-frame-rate": (value) => ({ kind: "frameRateSelect", value }),
  "browser-link-target": (value) => ({ kind: "linkTargetSelect", value }),
};

const SWITCH_CHANGES: Readonly<Record<string, (checked: boolean) => IntegrationsSettingsChange>> = {
  "browser-recording-key-presses": (checked) => ({ kind: "recordingKeyPressesToggle", checked }),
  "browser-recording-mouse-presses": (checked) => ({
    kind: "recordingMousePressesToggle",
    checked,
  }),
  "browser-auto-show-floating-preview": (checked) => ({
    kind: "autoShowFloatingPreviewToggle",
    checked,
  }),
};

const RESET_SETTINGS: Readonly<Record<string, IntegrationsResettableSetting>> = {
  "browser-default-viewport": "browserDefaultViewport",
  "browser-default-zoom": "browserDefaultZoomFactor",
  "browser-default-appearance": "browserDefaultAppearance",
  "browser-recording-frame-rate": "browserRecordingFrameRate",
  "browser-link-target": "browserLinkTarget",
  "browser-auto-show-floating-preview": "browserAutoShowFloatingPreview",
};

const connected = (environment: EnvironmentPresentation) =>
  environment.connection.phase === "connected" && environment.serverConfig !== null;

export function createIntegrationsSettings(
  context: FeatureContext,
  scope: SettingsScopeRuntime,
): SettingsSection {
  const { registry, state } = context;
  const preview = browserPreviewService(context);
  const uiAtom = Atom.make<IntegrationsUi>(INITIAL_UI).pipe(Atom.keepAlive);
  const ui = () => registry.get(uiAtom);
  const read: Read = (atom) => registry.get(atom);
  const patchUi = (patch: Partial<IntegrationsUi>) => registry.set(uiAtom, { ...ui(), ...patch });
  const patchWizard = (patch: Partial<WizardState>) => {
    const wizard = ui().wizard;
    if (wizard !== null) patchUi({ wizard: { ...wizard, ...patch } });
  };
  const clientSettings = () => registry.get(context.clientSettingsAtom);
  const defaults = createProjectDefaults(context, scope, SECTION);
  const pickers = createSectionPickers(context, "settingsIntegrations", {
    [PROJECT_DEFAULTS_PICKER]: defaults.binding,
  });

  const toast = (value: IntegrationsToast) =>
    context.addToast({
      layout: "plain",
      type: value.type,
      title: value.title,
      ...(value.description === undefined ? {} : { description: value.description }),
    });

  const updateClient = (patch: ClientSettingsPatch) =>
    context.updateClientSettings((current) => ({ ...current, ...patch }));

  const applyChange = async (change: IntegrationsSettingsChange) => {
    const patch = resolveIntegrationsSettingsChange(change);
    if (patch !== null) await updateClient(patch);
  };

  const allEnvironments = (get: Read) => ({
    environments: get(scope.environmentsAtom),
    ready: get(state.environmentCatalog.catalogValueAtom).isReady,
  });

  const primaryEnvironment = (get: Read): EnvironmentPresentation | null => {
    const primaryId = get(state.primaryEnvironmentIdAtom);
    return primaryId === null
      ? null
      : (get(scope.environmentsAtom).find(
          (environment) => environment.environmentId === primaryId,
        ) ?? null);
  };

  const selectedDeviceEnvironment = (get: Read): EnvironmentId | null => {
    const selected = get(scope.scopeContextAtom).environment;
    return selected !== null && connected(selected) ? selected.environmentId : null;
  };

  const hostTargets = (get: Read): ReadonlyArray<DeviceHostCheckTarget> =>
    get(scope.scopeContextAtom).environments.map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.label,
      connected: environment.connection.phase === "connected",
    }));

  const deviceKeyAtom = Atom.make((get) => {
    if (get(scope.sectionAtom) !== SECTION) return null;
    return `${selectedDeviceEnvironment(get)}:${JSON.stringify(get(scope.scopeContextAtom).search)}`;
  });
  registry.subscribe(
    deviceKeyAtom,
    (key) => {
      if (key === null || key === ui().deviceKey) return;
      patchUi({ deviceKey: key, devicePending: null, platformsRevealed: false, updateError: null });
    },
    { immediate: true },
  );

  const profilesInput = (get: Read, current: IntegrationsUi) => {
    const { environments, ready } = allEnvironments(get);
    return {
      settingsHydrated: true,
      bridgeAvailable: true,
      environmentsReady: ready,
      environmentCount: environments.length,
      primaryEnvironmentAvailable: primaryEnvironment(get) !== null,
      importInFlight: current.importInFlight,
      sources: current.sources,
      pendingRemoval: current.pendingRemoval,
      removalError: current.removalError,
      removalInFlight: current.removalInFlight,
    };
  };

  const modelAtom = Atom.make((get) => {
    if (get(scope.sectionAtom) !== SECTION) return null;
    const current = get(uiAtom);
    const settings: ClientSettings = get(context.clientSettingsAtom);
    const scopeContext = get(scope.scopeContextAtom);
    const projectScope =
      scopeContext.scope.kind === "project" || scopeContext.scope.kind === "checkout";
    const environmentId = selectedDeviceEnvironment(get);
    const device = environmentId === null ? null : readDeviceState(get, context, environmentId);
    const deviceState: DeviceServiceState | null = device?.state ?? null;
    const scopedSettings = get(scope.scopedSettingsAtom);
    const connectedEnvironments = scopeContext.connectedEnvironments;
    const platformsRevealed = resolveDevicePlatformsRevealed({
      platformsRevealed: current.platformsRevealed,
      enabled: scopedSettings.enableDeviceSupport,
      hostStatus: deviceState?.hostStatus ?? "disabled",
      pending: current.devicePending,
    });
    const hostLists = connectedEnvironments.map((environment) => ({
      environment,
      state: readDeviceState(get, context, environment.environmentId).state,
    }));
    const model = buildIntegrationsSettingsModel({
      isElectron: true,
      settings,
      profiles: profilesInput(get, current),
      deviceControls: {
        environmentId,
        enabled: scopedSettings.enableDeviceSupport,
        agentAccessEnabled: scopedSettings.enableAgentDeviceAccess,
        loaded: device?.loaded ?? false,
        state: deviceState ?? EMPTY_DEVICE_STATE,
        projectScope,
        connectedEnvironments,
        anyHubEnabled: connectedEnvironments.some(
          (environment) => environment.serverConfig?.settings.enableDeviceSupport,
        ),
        pending: current.devicePending,
        updateError: current.updateError,
        platformsRevealed,
      },
      deviceHosts: {
        environmentId,
        projectScope,
        busy: current.hostsBusy,
        editing: current.editor !== null,
        connectedEnvironments,
      },
      deviceHostLists: hostLists.map(({ environment, state: hostState }) => ({
        environmentId: environment.environmentId,
        hosts: environment.serverConfig?.settings.deviceHosts ?? [],
        busy: projectScope || current.hostsBusy,
        deviceState: hostState,
        checks: current.checks,
        retryingHostId: current.retrying[environment.environmentId] ?? null,
      })),
    });
    return { model, current, environmentId, deviceState, hostLists, platformsRevealed };
  });

  const wizardView = (wizard: WizardState, model: BrowserProfilesModel): IntegrationsWizardView => {
    const built = buildBrowserImportWizardModel({
      step: wizard.step,
      source: wizard.source,
      destinationEnvironmentName: wizard.environmentName,
      targetProfiles: model.wizardTargetProfiles,
      canCreateProfile: model.canCreateProfile,
      sourceProfileDirectory: wizard.sourceProfileDirectory,
      target: wizard.target,
      targetError: wizard.targetError,
    });
    const ready = wizard.permissionError === null && wizard.fullDiskAccess;
    const stillRequired = built.step.kind === "fullDiskAccess" && built.step.stillRequired;
    return {
      ...built,
      fullDiskAccess: {
        granted: wizard.fullDiskAccess,
        busy: wizard.opening,
        ready,
        allowLabel: "Allow",
        allowedLabel: "Allowed",
        status: buildFullDiskAccessStatusModel({
          ready,
          stillRequired,
          openingError: wizard.openingError,
          permissionError: wizard.permissionError,
        }),
      },
    };
  };

  const profilesModel = (
    rows: ReadonlyArray<IntegrationsBrowserRowModel>,
  ): BrowserProfilesModel | null => {
    const row = rows.find((candidate) => candidate.kind === "profiles");
    return row?.kind === "profiles" ? row : null;
  };

  const viewAtom = Atom.make((get): IntegrationsSettingsView | null => {
    const derived = get(modelAtom);
    if (derived === null) return null;
    const { model, current, environmentId, deviceState, hostLists } = derived;
    const defaultsView = defaults.view(get);
    const state = deviceState ?? EMPTY_DEVICE_STATE;
    const localTools = model.deviceControls.localTools ?? undefined;
    const controls = model.deviceControls;
    const hubKeys = controls.hub.settingKeys;
    const agentKeys = controls.agent.settingKeys;
    const hubRowScope = scope.rowScope(get, { serverScoped: true, settingKeys: [...hubKeys] });
    const agentRowScope = scope.rowScope(get, { serverScoped: true, settingKeys: [...agentKeys] });
    const editor = current.editor;
    const targets = hostTargets(get);
    const profiles = profilesModel(model.browserRows);
    return {
      defaults: defaultsView.view,
      modelPicker: pickers.popup(get, { [PROJECT_DEFAULTS_PICKER]: defaultsView.source }),
      browser: model.browser,
      browserUnavailableMessage: model.browser.unavailableMessage,
      browserRows: model.browserRows,
      devices: model.devices,
      deviceControls: {
        ...controls,
        hubDescription: deviceHubDescription,
        agentDescription: agentDeviceDescription,
        hubRowScope,
        agentRowScope,
        hubVersions: buildDeviceToolVersionsModel({ tools: localTools, kind: "hub" }),
        agentVersions: buildDeviceToolVersionsModel({ tools: localTools, kind: "agent" }),
        hubStatus: controls.hub.showSetupStatus
          ? buildDeviceHubSetupStatusModel({ state, pending: true, compact: true })
          : null,
        agentStatus: controls.agent.showSetupStatus
          ? buildAgentDeviceSetupStatusModel({ state, pending: true, compact: true })
          : null,
        platformStatuses: [
          buildPlatformStatusModel({
            platform: "iOS",
            status: platformSetupStatus(state, "ios"),
            compact: true,
          }),
          buildPlatformStatusModel({
            platform: "Android",
            status: platformSetupStatus(state, "android"),
            compact: true,
          }),
        ],
        hostUpdates:
          controls.showHostUpdates && environmentId !== null
            ? buildDeviceHostUpdatesModel({
                state: { ...state, hosts: state.hosts.filter((host) => host.kind === "local") },
                pendingHostId: current.updatesPending,
              })
            : [],
      },
      deviceHosts: {
        ...model.deviceHosts,
        rowScope: scope.rowScope(get, {
          serverScoped: true,
          settingKeys: [...model.deviceHosts.settingKeys],
        }),
        groupsView: hostLists.map(({ environment }, index) => {
          const list = model.deviceHostLists[index];
          const hosts = environment.serverConfig?.settings.deviceHosts ?? [];
          return {
            environmentId: environment.environmentId,
            heading: model.deviceHosts.groups[index]?.heading ?? null,
            emptyMessage: list?.emptyMessage ?? null,
            hosts: (list?.hosts ?? []).map((row, rowIndex) => ({
              ...row,
              versions: buildDeviceToolVersionsModel({
                tools: row.tools ?? undefined,
                owner: environment.label,
                error: row.toolInspectionError ?? undefined,
              }),
              id: hosts[rowIndex]?.id ?? row.id,
            })),
          };
        }),
        editor:
          editor === null
            ? null
            : (() => {
                const built = buildDeviceHostEditorModel({
                  host: editor.host,
                  draft: editor.draft,
                  isNew: editor.isNew,
                  targets,
                  busy: current.hostsBusy,
                  checks: editor.checks,
                });
                return {
                  ...built,
                  connection: {
                    ...built.connection,
                    results:
                      built.connection.results?.map((result) => ({
                        ...result,
                        platforms:
                          result.platforms === null
                            ? null
                            : buildDeviceHostAvailabilityModel(result.platforms),
                      })) ?? null,
                  },
                };
              })(),
      },
      wizard:
        current.wizard === null || profiles === null ? null : wizardView(current.wizard, profiles),
    };
  });

  const currentProfiles = () => {
    const derived = registry.get(modelAtom);
    return derived === null ? null : profilesModel(derived.model.browserRows);
  };

  const environmentIds = () =>
    registry.get(scope.environmentsAtom).map((environment) => environment.environmentId);

  const loadSources = () => {
    void listBrowserImportSources().then(
      (sources) => patchUi({ sources }),
      () => patchUi({ sources: ui().sources ?? [] }),
    );
  };

  const refreshImportSource = async (
    sourceId: BrowserImportSource["id"],
  ): Promise<BrowserImportSource | undefined> => {
    try {
      const latest = await listBrowserImportSources();
      patchUi({ sources: latest });
      return latest.find((source) => source.id === sourceId);
    } catch {
      return undefined;
    }
  };

  const createProfile = async (baseName: string) => {
    const creation = resolveCreateBrowserProfile({
      settingsHydrated: true,
      importInFlight: ui().importInFlight,
      currentProfiles: clientSettings().browserProfiles,
      baseName,
      profileId: `profile-${randomUUID()}`,
    });
    if (creation !== null) await updateClient(creation.patch);
  };

  const clearProfileData = (id: string, name: string) => {
    const { environments, ready } = allEnvironments(read);
    const decision = resolveClearBrowserProfileData({
      settingsHydrated: true,
      importInFlight: ui().importInFlight,
      bridgeAvailable: true,
      environmentsReady: ready,
      environmentCount: environments.length,
      name,
    });
    if (decision.kind === "ignore") return;
    if (decision.kind === "unavailable") {
      toast(decision.toast);
      return;
    }
    void clearBrowserProfileData(preview, environmentIds(), id).then(
      () => toast(decision.successToast),
      () => toast(decision.failureToast),
    );
  };

  const removeProfile = async (id: string) => {
    const model = currentProfiles();
    const decision = resolveRemoveBrowserProfile({
      settingsHydrated: true,
      importInFlight: ui().importInFlight,
      removalAvailable: model?.removalAvailable ?? false,
    });
    if (decision.kind === "ignore") return;
    if (decision.kind === "unavailable") {
      patchUi({ removalError: decision.error });
      return;
    }
    patchUi({ removalError: null, removalInFlight: true });
    const ready = registry.get(state.environmentCatalog.catalogValueAtom).isReady;
    try {
      await clearBrowserProfileData(preview, ready ? environmentIds() : [], id);
    } catch {
      patchUi({ removalError: BROWSER_PROFILE_REMOVAL_FAILED_MESSAGE, removalInFlight: false });
      return;
    }
    await updateClient(browserProfileRemovalPatch(clientSettings(), id));
    patchUi({ removalInFlight: false, pendingRemoval: null });
  };

  const runWizardImport = async (
    wizard: WizardState,
    input: { readonly sourceProfileDirectory: string; readonly target: WizardTarget },
  ): Promise<ImportOutcome> => {
    const blocked = resolveWizardImportBlock({
      bridgeAvailable: true,
      settingsHydrated: true,
      importInFlight: ui().importInFlight,
      target: input.target,
      currentProfiles: clientSettings().browserProfiles,
    });
    if (blocked !== null) return blocked;
    patchUi({ importInFlight: true });
    const { source } = wizard;
    try {
      const result = await importBrowserCookies(preview, {
        environmentId: wizard.environmentId,
        sourceId: source.id,
        sourceProfileDirectory: input.sourceProfileDirectory,
        targetProfileId: input.target.profileId,
      });
      if (wizardImportTargetMissing(input.target, clientSettings().browserProfiles)) {
        return { kind: "blocked", reason: "readFailed" };
      }
      let targetName: string;
      if (input.target.kind === "new") {
        if (result.imported > 0) {
          try {
            await context.updateClientSettings((current) => {
              const registration = resolveImportedProfileRegistration(
                current.browserProfiles,
                input.target.profileId,
                source.name,
              );
              if (registration.kind === "existing") return current;
              if (registration.kind === "limitReached") throw new ProfileLimitReachedError();
              return { ...current, browserProfiles: registration.browserProfiles };
            });
            targetName =
              clientSettings().browserProfiles.find(
                (profile) => profile.id === input.target.profileId,
              )?.name ?? source.name;
          } catch (cause) {
            await clearBrowserProfileData(
              preview,
              [wizard.environmentId],
              input.target.profileId,
            ).catch(() => undefined);
            const reason =
              cause instanceof ProfileLimitReachedError ? "profileLimitReached" : "profileNotSaved";
            throw new Error(importFailureMessage(source.id, reason), { cause });
          }
        } else {
          targetName = source.name;
        }
      } else {
        targetName = input.target.name;
      }
      return {
        kind: "imported",
        imported: result.imported,
        skipped: result.skipped,
        skippedDomains: result.skippedDomains,
        targetName,
      };
    } catch (cause) {
      return { kind: "blocked", reason: importFailureReason(cause) };
    } finally {
      patchUi({ importInFlight: false });
    }
  };

  const wizardImport = () => {
    const wizard = ui().wizard;
    const profiles = currentProfiles();
    if (wizard === null || profiles === null) return;
    const decision = resolveWizardImport({
      importInFlight: wizard.inFlight,
      selection: wizard.target,
      newProfileId: wizard.newProfileId,
      targetProfiles: profiles.wizardTargetProfiles,
    });
    if (decision.kind === "ignore") return;
    if (decision.kind === "targetUnavailable") {
      patchWizard({ targetError: decision.targetError, step: decision.step });
      return;
    }
    patchWizard({ targetError: null, inFlight: true, step: decision.step });
    void runWizardImport(wizard, {
      sourceProfileDirectory: wizard.sourceProfileDirectory,
      target: decision.target,
    })
      .then(
        (outcome) => patchWizard({ step: outcomeToStep(outcome) }),
        () => patchWizard({ step: WIZARD_FAILED_STEP }),
      )
      .finally(() => patchWizard({ inFlight: false }));
  };

  const recheckSource = (
    check: "browser" | "fullDiskAccess",
    nextStep: (refreshed: BrowserImportSource | undefined) => WizardStep,
  ) => {
    const wizard = ui().wizard;
    if (wizard === null) return;
    patchWizard({ step: { step: "checking", check } });
    void refreshImportSource(wizard.source.id).then(
      (refreshed) => {
        const latest = ui().wizard;
        if (latest === null) return;
        patchWizard({
          ...(refreshed === undefined
            ? {}
            : {
                source: refreshed,
                sourceProfileDirectory: refreshedSourceProfileDirectory(
                  latest.sourceProfileDirectory,
                  refreshed,
                ),
              }),
          step: nextStep(refreshed),
        });
      },
      () => patchWizard({ step: WIZARD_FAILED_STEP }),
    );
  };

  let permissionTimer: ReturnType<typeof setInterval> | null = null;
  let permissionChecking = false;
  const refreshPermission = async () => {
    const wizard = ui().wizard;
    if (wizard === null || permissionChecking) return;
    permissionChecking = true;
    try {
      const granted = await checkFullDiskAccess();
      patchWizard({ fullDiskAccess: granted, permissionError: null });
    } catch {
      patchWizard({ permissionError: PERMISSION_CHECK_FAILED_MESSAGE });
    }
    permissionChecking = false;
  };
  const permissionStepAtom = Atom.make((get) => get(uiAtom).wizard?.step.step === "fullDiskAccess");
  registry.subscribe(
    permissionStepAtom,
    (active) => {
      if (active && permissionTimer === null) {
        void refreshPermission();
        permissionTimer = setInterval(() => void refreshPermission(), PERMISSION_POLL_MS);
      } else if (!active && permissionTimer !== null) {
        clearInterval(permissionTimer);
        permissionTimer = null;
      }
    },
    { immediate: true },
  );

  const configureDevices = async (kind: "hub" | "agent", input: DeviceConfigureInput) => {
    if (registry.get(modelAtom)?.environmentId == null) return;
    const environments = registry.get(scope.scopeContextAtom).environments;
    patchUi({ devicePending: kind });
    try {
      const results = await Promise.allSettled(
        environments.map(async (environment) => {
          if (!connected(environment)) throw new Error("Environment disconnected");
          return runAtomCommand(
            registry,
            state.deviceEnvironment.configure,
            { environmentId: environment.environmentId, input: deviceConfigureRequest(input) },
            { label: "configure devices", reportFailure: false },
          );
        }),
      );
      const failed = environments.filter((_, index) => {
        const result = results[index];
        return result?.status !== "fulfilled" || result.value._tag === "Failure";
      });
      if (failed.length > 0) {
        toast(deviceSettingsFailureToast(failed.map((environment) => environment.label)));
      }
    } finally {
      patchUi({ devicePending: null });
    }
  };

  const runDeviceList = (action: DeviceListAction) => {
    const environmentId = registry.get(modelAtom)?.environmentId ?? null;
    if (environmentId === null) return;
    const request = resolveDeviceListRequest(action);
    patchUi({
      devicePending: request.pending,
      ...(action.kind === "update" ? { updateError: null } : {}),
    });
    void runAtomCommand(
      registry,
      state.deviceEnvironment.list,
      { environmentId, input: request.input },
      { label: "device list", reportFailure: false },
    )
      .then((result) => {
        if (action.kind === "update" && result._tag === "Failure") {
          patchUi({
            updateError: { tool: action.tool, message: DEVICE_TOOL_UPDATE_FAILED_MESSAGE },
          });
        }
      })
      .finally(() => patchUi({ devicePending: null }));
  };

  const projectScopeNow = () => {
    const kind = registry.get(scope.scopeContextAtom).scope.kind;
    return kind === "project" || kind === "checkout";
  };

  const saveHosts = async (
    host: SshDeviceHostConfig,
    remove: boolean,
    original: SshDeviceHostConfig = host,
  ) => {
    const environmentId = registry.get(modelAtom)?.environmentId ?? null;
    if (!canSaveDeviceHosts({ environmentId, projectScope: projectScopeNow() })) return;
    const environments = registry.get(scope.scopeContextAtom).environments;
    patchUi({ hostsBusy: true });
    try {
      const results = await Promise.allSettled(
        environments.map(async (environment) => {
          const serverConfig = environment.serverConfig;
          if (environment.connection.phase !== "connected" || serverConfig === null) {
            throw new Error("Environment disconnected");
          }
          return runAtomCommand(
            registry,
            state.serverEnvironment.updateSettings,
            {
              environmentId: environment.environmentId,
              input: {
                patch: {
                  deviceHosts: updateDeviceHosts(
                    serverConfig.settings.deviceHosts,
                    host,
                    remove,
                    original,
                  ),
                },
              },
            },
            { label: "device hosts update", reportFailure: false },
          );
        }),
      );
      const failed = environments.filter((_, index) => {
        const result = results[index];
        return result?.status !== "fulfilled" || result.value._tag === "Failure";
      });
      if (failed.length === 0) patchUi({ editor: null });
      else toast(deviceHostsSaveFailureToast(failed.map((environment) => environment.label)));
    } finally {
      patchUi({ hostsBusy: false });
    }
  };

  const runningChecks = new Set<string>();
  const testConnection = async (
    host: SshDeviceHostConfig,
    checkScope: "list" | "editor",
    readChecks: () => DeviceHostChecks,
    write: (checks: DeviceHostChecks) => void,
  ): Promise<Readonly<Record<string, DeviceHostCheck>> | undefined> => {
    const key = deviceHostConnectionKey(host);
    const scopeKey = `${checkScope}:${key}`;
    if (runningChecks.has(scopeKey)) return undefined;
    runningChecks.add(scopeKey);
    write({ ...readChecks(), [key]: {} });
    const results: Record<string, DeviceHostCheck> = {};
    try {
      await checkDeviceHostConnections(
        hostTargets(read),
        host,
        async (environmentId, input) => {
          const result = await runAtomCommand(
            registry,
            state.deviceEnvironment.testHost,
            { environmentId, input },
            { label: "device host test", reportFailure: false },
          );
          if (result._tag === "Failure") throw new Error(Cause.pretty(result.cause));
          return result.value;
        },
        (environmentId, result) => {
          results[environmentId] = result;
          const checks = readChecks();
          write({ ...checks, [key]: { ...checks[key], [environmentId]: result } });
        },
      );
      return results;
    } finally {
      runningChecks.delete(scopeKey);
    }
  };
  const listChecks = () => ui().checks;
  const writeListChecks = (checks: DeviceHostChecks) => patchUi({ checks });
  const editorChecks = () => ui().editor?.checks ?? {};
  const writeEditorChecks = (checks: DeviceHostChecks) => {
    const editor = ui().editor;
    if (editor !== null) patchUi({ editor: { ...editor, checks } });
  };

  const findHost = (environmentId: string, hostId: string) =>
    registry
      .get(scope.scopeContextAtom)
      .connectedEnvironments.find((environment) => environment.environmentId === environmentId)
      ?.serverConfig?.settings.deviceHosts.find((host) => host.id === hostId);

  return {
    views: { settingsIntegrations: viewAtom },
    actions: {
      ...pickers.actions,
      settingsIntegrationsMount: async () => {
        const current = ui();
        registry.set(uiAtom, {
          ...INITIAL_UI,
          importInFlight: current.importInFlight,
          removalInFlight: current.removalInFlight,
          deviceKey: current.deviceKey,
          devicePending: current.devicePending,
          platformsRevealed: current.platformsRevealed,
          updateError: current.updateError,
        });
        pickers.reset();
        return null;
      },
      settingsIntegrationsDefaults: defaults.changeAction,
      settingsIntegrationsBrowserChange: async (params) => {
        const { id, value, checked } = BrowserChangeParams(params);
        const settings = clientSettings();
        if (id === "browser-default-viewport") {
          await applyChange({
            kind: "viewportSelect",
            current: settings.browserDefaultViewport,
            value: value ?? null,
          });
          return null;
        }
        const select = SELECT_CHANGES[id];
        if (select !== undefined) await applyChange(select(value ?? null));
        const toggle = SWITCH_CHANGES[id];
        if (toggle !== undefined && checked !== undefined) await applyChange(toggle(checked));
        return null;
      },
      settingsIntegrationsViewportDimension: async (params) => {
        const { axis, value } = DimensionParams(params);
        await applyChange({
          kind: "viewportDimension",
          current: clientSettings().browserDefaultViewport,
          axis,
          value,
        });
        return null;
      },
      settingsIntegrationsViewportRotate: async () => {
        await applyChange({
          kind: "viewportRotate",
          current: clientSettings().browserDefaultViewport,
        });
        return null;
      },
      settingsIntegrationsBrowserReset: async (params) => {
        const setting = RESET_SETTINGS[IdParams(params).id];
        if (setting !== undefined) await applyChange({ kind: "reset", setting });
        return null;
      },
      settingsIntegrationsProfilesMenuOpen: async () => {
        loadSources();
        return null;
      },
      settingsIntegrationsProfileCreate: async () => {
        await createProfile("New profile");
        return null;
      },
      settingsIntegrationsProfileImport: async (params) => {
        const { sourceId } = SourceParams(params);
        const profiles = currentProfiles();
        const item = profiles?.addMenu.importSources.find((candidate) => candidate.id === sourceId);
        const source = ui().sources?.find((candidate) => candidate.id === sourceId);
        const primary = primaryEnvironment(read);
        if (item === undefined || item.disabled || primary === null || source === undefined) {
          return null;
        }
        if (profiles === null) return null;
        patchUi({
          wizard: {
            source,
            environmentId: primary.environmentId,
            environmentName: resolveEnvironmentOptionLabel({
              isPrimary: true,
              environmentId: primary.environmentId,
              runtimeLabel: primary.label,
            }),
            step: initialWizardStep(source),
            sourceProfileDirectory: source.profiles[0]?.directory ?? "",
            target: initialTargetSelection(
              profiles.canCreateProfile,
              profiles.wizardTargetProfiles,
            ),
            targetError: null,
            newProfileId: `profile-${randomUUID()}`,
            inFlight: false,
            fullDiskAccess: false,
            permissionError: null,
            opening: false,
            openingError: null,
          },
        });
        return null;
      },
      settingsIntegrationsProfileRename: async (params) => {
        const { profileId, name } = RenameParams(params);
        const patch = resolveRenameBrowserProfile({
          settingsHydrated: true,
          importInFlight: ui().importInFlight,
          currentProfiles: clientSettings().browserProfiles,
          profileId,
          next: name,
        });
        if (patch !== null) await updateClient(patch);
        return null;
      },
      settingsIntegrationsProfileAction: async (params) => {
        const { profileId, action } = ProfileActionParams(params);
        const profile = currentProfiles()?.profiles.find((candidate) => candidate.id === profileId);
        if (profile === undefined) return null;
        if (action === "setDefault") {
          const patch = resolveSetDefaultBrowserProfile({ settingsHydrated: true, profileId });
          if (patch !== null) await updateClient(patch);
        } else if (action === "clearData") {
          clearProfileData(profile.id, profile.name);
        } else {
          patchUi({ pendingRemoval: { id: profile.id, name: profile.name } });
        }
        return null;
      },
      settingsIntegrationsRemovalCancel: async () => {
        if (!ui().removalInFlight) patchUi({ pendingRemoval: null, removalError: null });
        return null;
      },
      settingsIntegrationsRemovalConfirm: async () => {
        const pending = ui().pendingRemoval;
        if (pending !== null && currentProfiles()?.removalAvailable === true) {
          await removeProfile(pending.id);
        }
        return null;
      },
      settingsIntegrationsWizardClose: async () => {
        const derived = registry.get(viewAtom);
        if (derived?.wizard?.closeable !== false) patchUi({ wizard: null });
        return null;
      },
      settingsIntegrationsWizardQuitRechecked: async () => {
        recheckSource("browser", refreshedSourceStep);
        return null;
      },
      settingsIntegrationsWizardSourceProfile: async (params) => {
        patchWizard({ sourceProfileDirectory: DirectoryParams(params).directory });
        return null;
      },
      settingsIntegrationsWizardTarget: async (params) => {
        const { kind, profileId } = TargetParams(params);
        const target: WizardTargetSelection | null =
          kind === "new"
            ? { kind: "new" }
            : profileId === undefined
              ? null
              : { kind: "existing", profileId };
        if (target !== null) patchWizard({ target, targetError: null });
        return null;
      },
      settingsIntegrationsWizardImport: async () => {
        wizardImport();
        return null;
      },
      settingsIntegrationsWizardAllow: async () => {
        const wizard = ui().wizard;
        if (wizard === null || wizard.opening) return null;
        patchWizard({ opening: true, openingError: null });
        try {
          await openFullDiskAccessSettings();
        } catch {
          patchWizard({ openingError: FULL_DISK_ACCESS_OPEN_FAILED_MESSAGE });
        } finally {
          patchWizard({ opening: false });
        }
        return null;
      },
      settingsIntegrationsWizardGranted: async () => {
        const view = registry.get(viewAtom)?.wizard;
        if (
          view?.step.kind !== "fullDiskAccess" ||
          !view.fullDiskAccess.ready ||
          view.fullDiskAccess.busy
        ) {
          return null;
        }
        if (view.step.onGranted === "import") wizardImport();
        else recheckSource("fullDiskAccess", fullDiskAccessRecheckStep);
        return null;
      },
      settingsIntegrationsDeviceToggle: async (params) => {
        const { tool, checked } = ToggleParams(params);
        const decision = resolveDeviceIntegrationToggle({
          target: tool,
          checked,
          projectScope: projectScopeNow(),
        });
        if (decision.kind === "scopedPatch") await scope.updateScopedSettings(decision.patch);
        else await configureDevices(decision.pending, decision.input);
        return null;
      },
      settingsIntegrationsDeviceList: async (params) => {
        const { kind, tool } = ListParams(params);
        const action: DeviceListAction | null =
          kind === "update"
            ? tool === undefined
              ? null
              : { kind: "update", tool: tool satisfies DeviceTool }
            : { kind };
        if (action !== null) runDeviceList(action);
        return null;
      },
      settingsIntegrationsDeviceUpdateRetry: async (params) => {
        const { hostId } = HostIdParams(params);
        const environmentId = registry.get(modelAtom)?.environmentId ?? null;
        if (environmentId === null || ui().updatesPending !== null) return null;
        patchUi({ updatesPending: hostId });
        await runAtomCommand(
          registry,
          state.deviceEnvironment.list,
          { environmentId, input: { retryHostId: hostId } },
          { label: "retry device host" },
        ).finally(() => patchUi({ updatesPending: null }));
        return null;
      },
      settingsIntegrationsHostRetry: async (params) => {
        const { environmentId, hostId } = HostParams(params);
        if (ui().retrying[environmentId] != null) return null;
        patchUi({ retrying: { ...ui().retrying, [environmentId]: hostId } });
        await runAtomCommand(
          registry,
          state.deviceEnvironment.list,
          { environmentId: EnvironmentId.make(environmentId), input: { retryHostId: hostId } },
          { label: "retry device host" },
        ).finally(() => patchUi({ retrying: { ...ui().retrying, [environmentId]: null } }));
        return null;
      },
      settingsIntegrationsHostTest: async (params) => {
        const { environmentId, hostId } = HostParams(params);
        const host = findHost(environmentId, hostId);
        if (host === undefined) return null;
        const results = await testConnection(host, "list", listChecks, writeListChecks);
        if (results === undefined) return null;
        toast(
          deviceHostTestToast({
            hostLabel: host.label,
            targets: hostTargets(read),
            results,
          }),
        );
        return null;
      },
      settingsIntegrationsHostAdd: async () => {
        const draft = newDeviceHostDraft(randomUUID());
        patchUi({ editor: { host: draft, draft, isNew: true, original: null, checks: {} } });
        return null;
      },
      settingsIntegrationsHostEdit: async (params) => {
        const { environmentId, hostId } = HostParams(params);
        const host = findHost(environmentId, hostId);
        if (host !== undefined) {
          patchUi({ editor: { host, draft: host, isNew: false, original: host, checks: {} } });
        }
        return null;
      },
      settingsIntegrationsHostRemove: async (params) => {
        const { environmentId, hostId } = HostParams(params);
        const host = findHost(environmentId, hostId);
        if (host !== undefined) await saveHosts(host, true);
        return null;
      },
      settingsIntegrationsHostEditorField: async (params) => {
        const { field, value } = FieldParams(params);
        const editor = ui().editor;
        if (editor !== null) {
          patchUi({
            editor: { ...editor, draft: resolveDeviceHostDraftChange(editor.draft, field, value) },
          });
        }
        return null;
      },
      settingsIntegrationsHostEditorTest: async () => {
        const editor = ui().editor;
        if (editor === null) return null;
        const host = resolveDeviceHostEditorTest(editor.draft);
        if (host !== null) await testConnection(host, "editor", editorChecks, writeEditorChecks);
        return null;
      },
      settingsIntegrationsHostEditorSave: async () => {
        const editor = ui().editor;
        if (editor === null) return null;
        const decision = resolveDeviceHostEditorSubmit({
          host: editor.host,
          draft: editor.draft,
          isNew: editor.isNew,
          targets: hostTargets(read),
          busy: ui().hostsBusy,
          checks: editor.checks,
        });
        if (decision.kind === "save")
          await saveHosts(decision.host, false, editor.original ?? decision.host);
        return null;
      },
      settingsIntegrationsHostEditorClose: async () => {
        if (!ui().hostsBusy) patchUi({ editor: null });
        return null;
      },
    },
  };
}
