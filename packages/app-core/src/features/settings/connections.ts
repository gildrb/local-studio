import type { ServerUpdateState } from "@t3tools/client-runtime/state/server";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type AdvertisedEndpoint,
  type AuthEnvironmentScope,
  type AuthSessionId,
  type DesktopDiscoveredSshHost,
  type DesktopServerExposureState,
  type DesktopSshEnvironmentTarget,
  type DesktopWslState,
} from "@t3tools/contracts";
import { requestConfirmDialog } from "@t3tools/web/src/confirmDialog.ts";
import {
  buildServerUpdateActionModel,
  desktopAppUpdateConfirmMessage,
  desktopAppsUpdateConfirmMessage,
  resolveEligibleServerUpdateTargets,
  resolveServerUpdateInput,
  resolveServerUpdateSuccessToast,
  resolveUpdateCommandCopyToast,
  serverUpdateFailureMessage,
  serverUpdateStageLabel,
  UPDATE_COMMAND_COPY_FAILURE_TITLE,
  type ServerUpdateActionModel,
  type ServerUpdateTarget,
} from "@t3tools/web/src/components/ServerUpdateAction.logic.ts";
import {
  BACKEND_VALUE_WSL_OFF,
  PAIRING_SCOPE_OPTIONS,
  endpointDefaultPreferenceKey,
  formatDesktopSshConnectionError,
  toDesktopClientSessionRecord,
  toDesktopPairingLinkRecord,
} from "@t3tools/web/src/components/settings/ConnectionsSettings.logic.ts";
import {
  BACKEND_ADDED_TOAST,
  buildConnectionsSettingsModel,
  defaultPairingScopes,
  resolveAddSavedBackend,
  resolveConnectionsAccess,
  resolveConnectionsEndpointSelection,
  resolveConnectionsFailure,
  resolveConnectionsFailureTitle,
  resolveHasWslRegistrationToLose,
  resolveLoadBalancingEnvironments,
  resolveNetworkExposureConfirm,
  resolveNetworkExposureToggle,
  resolvePairingCopyErrorToast,
  resolvePairingCopyToast,
  resolvePairingScopePreset,
  resolvePairingScopeToggle,
  resolvePairingUrlCopyKind,
  resolveRemoveSavedBackend,
  resolveRevokeOtherClientsToast,
  resolveSavedBackendHostInput,
  resolveSavedEnvironments,
  resolveServerUpdateFacts,
  resolveSshConnectedToast,
  resolveTailscaleServeDisablePort,
  resolveTailscaleServePort,
  resolveTailscaleServeStartPortInput,
  resolveTailscaleSwitchChange,
  resolveTraceIdCopyToast,
  resolveWslConfirm,
  resolveWslModeSelection,
  resolveWslOnlyToggle,
  type ConnectionsSettingsModel,
  type NetworkExposureMode,
  type PairingCopyKind,
  type PairingLinkRowUiState,
  type PendingWslChange,
  type SavedBackendMode,
  type WslChangeDecision,
  type WslOperation,
} from "@t3tools/web/src/components/settings/ConnectionsSettingsSections.logic.ts";
import {
  buildEnvironmentIconMenuModel,
  resolveEnvironmentIconSelection,
  resolveEnvironmentOperateAccess,
  type EnvironmentIconMenuModel,
} from "@t3tools/web/src/components/settings/EnvironmentIconPicker.logic.ts";
import {
  buildGitHubRoutingSettingsModel,
  resolveGitHubRoutingChange,
  type GitHubRoutingSettingsModel,
} from "@t3tools/web/src/components/settings/GitHubRoutingSettings.logic.ts";
import {
  buildLocalEnvironmentSettingModel,
  describeLocalEnvironmentSettingFailure,
  resolveLocalEnvironmentSettingChange,
  type LocalEnvironmentSettingModel,
} from "@t3tools/web/src/components/settings/LocalEnvironmentSetting.logic.ts";
import { mergeEnvironmentSettings } from "@t3tools/web/src/settingsMerge.ts";
import { formatEnvironmentQueryError } from "@t3tools/web/src/state/query.ts";
import type { EnvironmentPresentation } from "@t3tools/web/src/state/environments.ts";
import { setDefaultAdvertisedEndpointKey } from "@t3tools/web/src/uiState.logic.ts";
import {
  resolveShortcutCommand,
  threadJumpIndexFromCommand,
} from "@t3tools/web/src/keybindings.ts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { readAppVersion } from "../../appVersion.ts";
import { clipboardService } from "../../clipboard.ts";
import type { FeatureContext } from "../../feature.ts";
import type { SettingsScopeRuntime, SettingsSection } from "./scope.ts";

type ReadAtom = <A>(atom: Atom.Atom<A>) => A;

export type ServerUpdateProgressView =
  | { readonly kind: "running"; readonly label: string }
  | { readonly kind: "failed"; readonly message: string };

export type ServerUpdateControlView = {
  readonly environmentId: EnvironmentId;
  readonly action: ServerUpdateActionModel;
};

export type ConnectionsEnvironmentRowView = {
  readonly environmentId: EnvironmentId;
  readonly iconMenu: EnvironmentIconMenuModel;
  readonly update: ServerUpdateControlView | null;
  readonly progress: ServerUpdateProgressView | null;
};

export type SettingsConnectionsView = {
  readonly model: ConnectionsSettingsModel;
  readonly localEnvironment: LocalEnvironmentSettingModel | null;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly primaryIconMenu: EnvironmentIconMenuModel | null;
  readonly primaryUpdate: ServerUpdateControlView | null;
  readonly primaryProgress: ServerUpdateProgressView | null;
  readonly rows: ReadonlyArray<ConnectionsEnvironmentRowView>;
  readonly updateAll: { readonly label: string; readonly disabled: boolean } | null;
  readonly githubRouting: GitHubRoutingSettingsModel | null;
  readonly createPairingLinkOpen: boolean;
  readonly revealPairingLinkId: string | null;
  readonly addEnvironmentOpen: boolean;
  readonly sshSuggestionsOpen: boolean;
};

type QueryState<A> = {
  readonly data: A | null;
  readonly error: string | null;
  readonly pending: boolean;
};

type ConnectionsUiState = {
  readonly networkAccess: QueryState<{
    readonly serverExposureState: DesktopServerExposureState;
    readonly advertisedEndpoints: ReadonlyArray<AdvertisedEndpoint>;
  }>;
  readonly wsl: QueryState<DesktopWslState>;
  readonly sshHosts: QueryState<ReadonlyArray<DesktopDiscoveredSshHost>>;
  readonly serverExposureError: string | null;
  readonly accessManagementError: string | null;
  readonly wslMutationError: string | null;
  readonly createdPairingCredentials: Readonly<Record<string, string>>;
  readonly pairingLinkUi: Readonly<Record<string, PairingLinkRowUiState>>;
  readonly revealPairingLinkId: string | null;
  readonly revokingPairingLinkId: string | null;
  readonly revokingClientSessionId: string | null;
  readonly isRevokingOtherClients: boolean;
  readonly createPairingLinkOpen: boolean;
  readonly pairingLabel: string;
  readonly pairingScopes: ReadonlyArray<AuthEnvironmentScope>;
  readonly isCreatingPairingLink: boolean;
  readonly addEnvironmentOpen: boolean;
  readonly mode: SavedBackendMode;
  readonly host: string;
  readonly pairingCode: string;
  readonly sshHost: string;
  readonly sshUsername: string;
  readonly sshPort: string;
  readonly sshSuggestionsOpen: boolean;
  readonly addError: string | null;
  readonly isAdding: boolean;
  readonly removingEnvironmentId: EnvironmentId | null;
  readonly isUpdatingServerExposure: boolean;
  readonly networkExposureDialogOpen: boolean;
  readonly pendingNetworkExposureMode: NetworkExposureMode | null;
  readonly endpointListExpanded: boolean;
  readonly isUpdatingTailscaleServe: boolean;
  readonly pendingTailscaleServeEndpoint: AdvertisedEndpoint | null;
  readonly tailscaleServePortInput: string;
  readonly tailscaleDisableDialogOpen: boolean;
  readonly isUpdatingWslBackend: boolean;
  readonly pendingWslChange: PendingWslChange | null;
  readonly localConfirmOpen: boolean;
  readonly localUpdating: boolean;
  readonly localError: string | null;
  readonly githubRoutingSaving: boolean;
  readonly updatingAll: boolean;
};

const EMPTY_QUERY = { data: null, error: null, pending: false } as const;

const INITIAL_UI: ConnectionsUiState = {
  networkAccess: EMPTY_QUERY,
  wsl: EMPTY_QUERY,
  sshHosts: EMPTY_QUERY,
  serverExposureError: null,
  accessManagementError: null,
  wslMutationError: null,
  createdPairingCredentials: {},
  pairingLinkUi: {},
  revealPairingLinkId: null,
  revokingPairingLinkId: null,
  revokingClientSessionId: null,
  isRevokingOtherClients: false,
  createPairingLinkOpen: false,
  pairingLabel: "",
  pairingScopes: defaultPairingScopes(),
  isCreatingPairingLink: false,
  addEnvironmentOpen: false,
  mode: "remote",
  host: "",
  pairingCode: "",
  sshHost: "",
  sshUsername: "",
  sshPort: "",
  sshSuggestionsOpen: false,
  addError: null,
  isAdding: false,
  removingEnvironmentId: null,
  isUpdatingServerExposure: false,
  networkExposureDialogOpen: false,
  pendingNetworkExposureMode: null,
  endpointListExpanded: false,
  isUpdatingTailscaleServe: false,
  pendingTailscaleServeEndpoint: null,
  tailscaleServePortInput: "443",
  tailscaleDisableDialogOpen: false,
  isUpdatingWslBackend: false,
  pendingWslChange: null,
  localConfirmOpen: false,
  localUpdating: false,
  localError: null,
  githubRoutingSaving: false,
  updatingAll: false,
};

const EnvironmentParams = Schema.decodeUnknownSync(Schema.Struct({ environmentId: EnvironmentId }));
const IdParams = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const OpenParams = Schema.decodeUnknownSync(Schema.Struct({ open: Schema.Boolean }));
const CheckedParams = Schema.decodeUnknownSync(Schema.Struct({ checked: Schema.Boolean }));
const ValueParams = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }));
const EndpointParams = Schema.decodeUnknownSync(Schema.Struct({ endpointId: Schema.String }));
const SetEnabledParams = Schema.decodeUnknownSync(
  Schema.Struct({ environmentId: EnvironmentId, enabled: Schema.Boolean }),
);
const IconParams = Schema.decodeUnknownSync(
  Schema.Struct({ environmentId: EnvironmentId, value: Schema.String }),
);
const RoutingParams = Schema.decodeUnknownSync(
  Schema.Struct({
    environmentId: EnvironmentId,
    permission: Schema.Literals(["off", "read", "read-write"]),
  }),
);
const ScopeParams = Schema.decodeUnknownSync(
  Schema.Struct({ scope: Schema.String, checked: Schema.Boolean }),
);
const PresetParams = Schema.decodeUnknownSync(
  Schema.Struct({ preset: Schema.Literals(["read-only", "standard"]) }),
);
const QrEndpointParams = Schema.decodeUnknownSync(
  Schema.Struct({ id: Schema.String, endpointId: Schema.String }),
);
const CopyParams = Schema.decodeUnknownSync(
  Schema.Struct({ id: Schema.String, target: Schema.Literals(["code", "qr-url"]) }),
);
const RevealParams = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.NullOr(Schema.String) }));
const ModeParams = Schema.decodeUnknownSync(
  Schema.Struct({ mode: Schema.Literals(["remote", "ssh"]) }),
);
const FieldParams = Schema.decodeUnknownSync(
  Schema.Struct({
    field: Schema.Literals(["host", "pairingCode", "sshHost", "sshUsername", "sshPort"]),
    value: Schema.String,
  }),
);
const AliasParams = Schema.decodeUnknownSync(Schema.Struct({ alias: Schema.String }));
const KeyDownParams = Schema.decodeUnknownSync(
  Schema.Struct({
    key: Schema.String,
    metaKey: Schema.Boolean,
    ctrlKey: Schema.Boolean,
    shiftKey: Schema.Boolean,
    altKey: Schema.Boolean,
  }),
);
const WslConfirmParams = Schema.decodeUnknownSync(
  Schema.Struct({ actionId: Schema.Literals(["wsl-only", "both", "confirm"]) }),
);
const LocalParams = Schema.decodeUnknownSync(
  Schema.Struct({
    intent: Schema.Union([
      Schema.Struct({ kind: Schema.Literal("toggle") }),
      Schema.Struct({ kind: Schema.Literal("dialog-open-change"), open: Schema.Boolean }),
      Schema.Struct({ kind: Schema.Literal("confirm") }),
    ]),
  }),
);

function progressView(state: ServerUpdateState): ServerUpdateProgressView | null {
  if (state.status === "idle") return null;
  if (state.status === "failed") return { kind: "failed", message: state.message };
  return { kind: "running", label: serverUpdateStageLabel(state.stage) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createConnectionsSettings(
  context: FeatureContext,
  scope: SettingsScopeRuntime,
): SettingsSection {
  const { registry, state, desktop } = context;
  const appVersion = readAppVersion();
  const uiAtom = Atom.make(INITIAL_UI).pipe(Atom.keepAlive);
  const update = (patch: Partial<ConnectionsUiState>) =>
    registry.set(uiAtom, { ...registry.get(uiAtom), ...patch });
  const ui = () => registry.get(uiAtom);
  const pendingUpdates = new Set<EnvironmentId>();
  const nowAtom = Atom.make(Date.now()).pipe(Atom.keepAlive);
  let tick: NodeJS.Timeout | undefined;
  registry.subscribe(scope.sectionAtom, (section) => {
    if (section === "connections") {
      if (tick === undefined) {
        registry.set(nowAtom, Date.now());
        tick = setInterval(() => registry.set(nowAtom, Date.now()), 1_000);
      }
      return;
    }
    clearInterval(tick);
    tick = undefined;
  });

  const toastError = (title: string, description: string) =>
    context.addToast({ layout: "stacked", type: "error", title, description });
  const toastSuccess = (toast: { readonly title: string; readonly description: string }) =>
    context.addToast({ layout: "plain", type: "success", ...toast });

  const environmentsAtom = Atom.make((get) => get(scope.environmentsAtom));
  const primaryEnvironmentAtom = Atom.make((get): EnvironmentPresentation | null => {
    const primaryId = get(state.primaryEnvironmentIdAtom);
    return (
      get(environmentsAtom).find((environment) => environment.environmentId === primaryId) ?? null
    );
  });

  const accessAtom = Atom.make(() =>
    resolveConnectionsAccess({
      isDesktop: true,
      localEnvironmentDisabled: !desktop.localEnvironmentEnabled,
      sessionAuthenticated: false,
      sessionScopes: null,
      sessionAuthPolicy: null,
    }),
  );

  const accessChangesAtom = Atom.make((get) => {
    const primaryId = get(state.primaryEnvironmentIdAtom);
    if (!get(accessAtom).canManageLocalBackend || primaryId === null) {
      return { pairingLinks: [], clientSessions: [], isLoading: false, error: null };
    }
    const result = get(
      state.authEnvironment.accessChanges({ environmentId: primaryId, input: null }),
    );
    const event = Option.getOrNull(AsyncResult.value(result));
    return {
      pairingLinks:
        event?.type === "snapshot"
          ? event.payload.pairingLinks.map(toDesktopPairingLinkRecord)
          : [],
      clientSessions:
        event?.type === "snapshot"
          ? event.payload.clientSessions.map(toDesktopClientSessionRecord)
          : [],
      isLoading: event === null && result._tag !== "Failure",
      error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
    };
  });

  const operateAccessFor = (get: ReadAtom, environmentId: EnvironmentId) => {
    const result = get(state.environmentSession.sessionStateAtom(environmentId));
    return resolveEnvironmentOperateAccess({
      isPrimary: get(state.primaryEnvironmentIdAtom) === environmentId,
      isElectron: true,
      primarySession: { session: null, isPending: false, hasError: false },
      remoteSession: {
        session: Option.getOrNull(AsyncResult.value(result)),
        isPending: result.waiting,
        hasError: result._tag === "Failure",
      },
    });
  };

  const continueThreadsFor = (get: ReadAtom, environmentId: EnvironmentId) =>
    mergeEnvironmentSettings(
      get(state.serverEnvironment.settingsValueAtom(environmentId)) ?? DEFAULT_SERVER_SETTINGS,
      get(context.clientSettingsAtom),
    ).continueThreadsAfterServerUpdate;

  const updateControl = (
    environmentId: EnvironmentId,
    target: {
      readonly label: string;
      readonly serverLabel: string;
      readonly targetVersion: string;
      readonly selfUpdate: ServerUpdateTarget["selfUpdate"];
      readonly desktopAppUpdate: boolean;
    },
  ): ServerUpdateControlView => ({
    environmentId,
    action: buildServerUpdateActionModel({
      serverLabel: target.serverLabel,
      selfUpdate: target.selfUpdate,
      desktopAppUpdate: target.desktopAppUpdate,
      targetVersion: target.targetVersion,
      label: target.label,
    }),
  });

  const modelAtom = Atom.make((get): ConnectionsSettingsModel => {
    const current = get(uiAtom);
    const environments = get(environmentsAtom);
    const primaryEnvironment = get(primaryEnvironmentAtom);
    const primaryId = primaryEnvironment?.environmentId ?? null;
    const savedEnvironments = resolveSavedEnvironments(environments);
    const access = get(accessAtom);
    const accessChanges = get(accessChangesAtom);
    const serverConfig = get(state.primaryServerConfigAtom);
    return buildConnectionsSettingsModel({
      isDesktop: true,
      cloudEnabled: false,
      currentHref: desktop.serverHttpUrl ?? "http://127.0.0.1/",
      canCopyToClipboard: true,
      nowMs: get(nowAtom),
      platform: context.platform,
      keybindings: serverConfig?.keybindings ?? [],
      access,
      primaryEnvironment,
      primaryUpdateState: get(state.serverEnvironment.updateStateAtom(primaryId)),
      primaryUpdateFacts: resolveServerUpdateFacts(
        primaryEnvironment?.serverConfig ?? null,
        appVersion,
      ),
      environments,
      savedEnvironmentStates: savedEnvironments.map((environment) => ({
        environment,
        serverUpdateState: get(state.serverEnvironment.updateStateAtom(environment.environmentId)),
        updateFacts: resolveServerUpdateFacts(environment.serverConfig, appVersion),
        discoveredDescriptor: undefined,
      })),
      serverExposureState: current.networkAccess.data?.serverExposureState ?? null,
      serverExposureError: current.serverExposureError ?? current.networkAccess.error,
      advertisedEndpoints: current.networkAccess.data?.advertisedEndpoints ?? [],
      savedDefaultEndpointKey: get(context.uiStateAtom).defaultAdvertisedEndpointKey,
      endpointListExpanded: current.endpointListExpanded,
      isUpdatingServerExposure: current.isUpdatingServerExposure,
      networkExposureDialogOpen: current.networkExposureDialogOpen,
      pendingNetworkExposureMode: current.pendingNetworkExposureMode,
      isUpdatingTailscaleServe: current.isUpdatingTailscaleServe,
      pendingTailscaleServeEndpoint: current.pendingTailscaleServeEndpoint,
      tailscaleServePortInput: current.tailscaleServePortInput,
      tailscaleDisableDialogOpen: current.tailscaleDisableDialogOpen,
      wslState: current.wsl.data,
      wslError: current.wslMutationError ?? current.wsl.error,
      isLoadingWslState: current.wsl.pending && current.wsl.data === null,
      isUpdatingWslBackend: current.isUpdatingWslBackend,
      pendingWslChange: current.pendingWslChange,
      cloudLink: {
        isSignedIn: false,
        isPending: false,
        isUpdatingTunnel: false,
        isUpdatingPreference: false,
        managedTunnelActive: false,
        publishAgentActivity: false,
        operationError: null,
        linkError: null,
      },
      accessManagement: {
        pairingLinks: accessChanges.pairingLinks,
        clientSessions: accessChanges.clientSessions,
        isLoading: accessChanges.isLoading,
        error: current.accessManagementError ?? accessChanges.error,
        isRevokingOtherClients: current.isRevokingOtherClients,
        revokingPairingLinkId: current.revokingPairingLinkId,
        revokingClientSessionId: current.revokingClientSessionId,
        createdPairingCredentials: current.createdPairingCredentials,
        pairingLinkUi: current.pairingLinkUi,
      },
      createPairingLink: {
        label: current.pairingLabel,
        scopes: current.pairingScopes,
        isCreating: current.isCreatingPairingLink,
      },
      addEnvironment: {
        mode: current.mode,
        isAdding: current.isAdding,
        error: current.addError,
        host: current.host,
        pairingCode: current.pairingCode,
        sshHost: current.sshHost,
        sshUsername: current.sshUsername,
        sshPort: current.sshPort,
        discoveredHostsError: current.sshHosts.error,
        isLoadingDiscoveredHosts: current.sshHosts.pending && current.sshHosts.data === null,
        discoveredHosts: current.sshHosts.data ?? [],
      },
      removingEnvironmentId: current.removingEnvironmentId,
    });
  });

  const viewAtom = Atom.make((get): SettingsConnectionsView | null => {
    if (get(scope.sectionAtom) !== "connections") return null;
    const current = get(uiAtom);
    const model = get(modelAtom);
    const environments = get(environmentsAtom);
    const primaryEnvironment = get(primaryEnvironmentAtom);
    const primaryId = primaryEnvironment?.environmentId ?? null;
    const savedEnvironments = resolveSavedEnvironments(environments);
    const primaryVersion = model.primary.kind === "managed" ? model.primary.version : null;
    const primaryControl = primaryVersion?.control ?? null;
    const eligibleAll = resolveEligibleServerUpdateTargets(model.remoteEnvironments.updateTargets);
    return {
      model,
      localEnvironment: buildLocalEnvironmentSettingModel({
        available: true,
        enabled: desktop.localEnvironmentEnabled,
        confirmOpen: current.localConfirmOpen,
        isUpdating: current.localUpdating,
        error: current.localError,
      }),
      primaryEnvironmentId: primaryId,
      primaryIconMenu:
        primaryId === null
          ? null
          : buildEnvironmentIconMenuModel({
              serverConfig: primaryEnvironment?.serverConfig ?? null,
              operateAccess: operateAccessFor(get, primaryId),
            }),
      primaryUpdate:
        primaryId !== null && primaryControl?.kind === "update"
          ? updateControl(primaryId, primaryControl)
          : null,
      primaryProgress: progressView(get(state.serverEnvironment.updateStateAtom(primaryId))),
      rows: model.remoteEnvironments.rows.map((row) => {
        const environment = environments.find((entry) => entry.environmentId === row.id);
        return {
          environmentId: row.id,
          iconMenu: buildEnvironmentIconMenuModel({
            serverConfig: environment?.serverConfig ?? null,
            operateAccess: operateAccessFor(get, row.id),
          }),
          update: row.update === null ? null : updateControl(row.id, row.update),
          progress: row.showUpdateProgress
            ? progressView(get(state.serverEnvironment.updateStateAtom(row.id)))
            : null,
        };
      }),
      updateAll:
        model.remoteEnvironments.updateTargets.length > 0
          ? { label: "Update all", disabled: current.updatingAll || eligibleAll.length === 0 }
          : null,
      githubRouting: buildGitHubRoutingSettingsModel({
        environments: resolveLoadBalancingEnvironments(primaryEnvironment, savedEnvironments),
        permissions: get(state.environmentCatalog.githubRoutingPermissionsValueAtom),
        catalogReady: get(state.environmentCatalog.catalogValueAtom).isReady,
        saving: current.githubRoutingSaving,
      }),
      createPairingLinkOpen: current.createPairingLinkOpen,
      revealPairingLinkId: current.revealPairingLinkId,
      addEnvironmentOpen: current.addEnvironmentOpen,
      sshSuggestionsOpen: current.sshSuggestionsOpen,
    };
  });

  const loadQuery = async <K extends "networkAccess" | "wsl" | "sshHosts">(
    key: K,
    load: () => Promise<NonNullable<ConnectionsUiState[K]["data"]>>,
  ) => {
    update({ [key]: { ...ui()[key], pending: true } });
    try {
      const data = await load();
      update({ [key]: { data, error: null, pending: false } });
    } catch (error) {
      update({ [key]: { ...ui()[key], error: errorMessage(error), pending: false } });
    }
  };
  const refreshNetworkAccess = () => loadQuery("networkAccess", desktop.getNetworkAccess);
  const refreshWsl = () => loadQuery("wsl", desktop.getWslState);
  const refreshSshHosts = () => loadQuery("sshHosts", desktop.discoverSshHosts);

  const updateServer = async (target: ServerUpdateTarget, failureTitle: string) => {
    if (pendingUpdates.has(target.environmentId)) return;
    pendingUpdates.add(target.environmentId);
    try {
      const result = await runAtomCommand(
        registry,
        state.serverEnvironment.updateServer,
        { environmentId: target.environmentId, input: resolveServerUpdateInput(target) },
        { label: "server update", reportFailure: false },
      );
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        throw squashAtomCommandFailure(result);
      }
      toastSuccess(
        resolveServerUpdateSuccessToast({
          serverLabel: target.serverLabel,
          selfUpdate: target.selfUpdate,
          targetVersion: result.value.targetVersion,
        }),
      );
    } catch (error) {
      context.addToast({
        layout: "plain",
        type: "error",
        title: failureTitle,
        description: serverUpdateFailureMessage(error),
      });
    } finally {
      pendingUpdates.delete(target.environmentId);
    }
  };

  const confirm = (message: string, variant?: "destructive") =>
    requestConfirmDialog(message, variant === undefined ? undefined : { variant }) ??
    Promise.reject(new Error("Confirmations are not available in the native app yet."));

  const runServerUpdate = async (environmentId: EnvironmentId) => {
    const view = registry.get(viewAtom);
    if (view === null) return;
    const isPrimary = environmentId === view.primaryEnvironmentId;
    const primaryVersion =
      view.model.primary.kind === "managed" ? view.model.primary.version : null;
    const source = isPrimary
      ? primaryVersion?.control?.kind === "update"
        ? primaryVersion.control
        : null
      : (view.model.remoteEnvironments.rows.find((row) => row.id === environmentId)?.update ??
        null);
    if (source === null) return;
    const action = buildServerUpdateActionModel({
      serverLabel: source.serverLabel,
      selfUpdate: source.selfUpdate,
      desktopAppUpdate: source.desktopAppUpdate,
      targetVersion: source.targetVersion,
      label: source.label,
    });
    if (action.kind === "desktop-app-required") return;
    if (action.manualCommand !== null) {
      const command = action.manualCommand;
      try {
        await clipboardService(context).writeText(command);
        toastSuccess(resolveUpdateCommandCopyToast({ command, serverLabel: source.serverLabel }));
      } catch (error) {
        context.addToast({
          layout: "plain",
          type: "error",
          title: UPDATE_COMMAND_COPY_FAILURE_TITLE,
          description: errorMessage(error),
        });
      }
      return;
    }
    if (pendingUpdates.has(environmentId)) return;
    if (action.confirmDesktopApp) {
      const confirmed = await confirm(desktopAppUpdateConfirmMessage(source.serverLabel));
      if (!confirmed) return;
    }
    await updateServer(
      {
        environmentId,
        serverLabel: source.serverLabel,
        selfUpdate: source.selfUpdate,
        desktopAppUpdate: source.desktopAppUpdate,
        threadContinuation: source.threadContinuation,
        targetVersion: source.targetVersion,
        continueThreadsAfterServerUpdate: continueThreadsFor(registry.get, environmentId),
      },
      "Server update failed",
    );
  };

  const runUpdateAll = async () => {
    if (ui().updatingAll) return;
    const view = registry.get(viewAtom);
    if (view === null) return;
    update({ updatingAll: true });
    try {
      const available = resolveEligibleServerUpdateTargets(
        view.model.remoteEnvironments.updateTargets,
      ).filter((target) => !pendingUpdates.has(target.environmentId));
      const desktopTargets = available.filter((target) => target.selfUpdate === "desktop-managed");
      if (desktopTargets.length > 0) {
        const confirmed = await confirm(
          desktopAppsUpdateConfirmMessage(desktopTargets.map((target) => target.serverLabel)),
        );
        if (!confirmed) return;
      }
      await Promise.all(
        available.map((target) => updateServer(target, `${target.serverLabel} update failed`)),
      );
    } finally {
      update({ updatingAll: false });
    }
  };

  const primaryHttpBaseUrl = () => {
    if (desktop.serverHttpUrl === null) throw new Error("The local environment is turned off.");
    return desktop.serverHttpUrl;
  };

  const applyWslOperation = async (operation: WslOperation) => {
    update({ isUpdatingWslBackend: true, wslMutationError: null });
    try {
      if (operation.kind === "disable") {
        await desktop.setWslBackendEnabled(false);
        if (operation.clearWslOnly) await desktop.setWslOnly(false);
      } else if (operation.kind === "set-distro") {
        await desktop.setWslDistro(operation.distro);
      } else {
        await desktop.setWslOnly(operation.value);
      }
    } catch (error) {
      const failure = resolveConnectionsFailure({ kind: "wsl" }, error);
      update({ wslMutationError: failure.message });
      toastError(failure.title, failure.message);
    } finally {
      update({ isUpdatingWslBackend: false });
      void refreshWsl();
    }
  };

  const applyWslDecision = (decision: WslChangeDecision) => {
    if (decision.kind === "confirm") update({ pendingWslChange: decision.change });
    if (decision.kind === "apply") void applyWslOperation(decision.operation);
  };

  const connectSshTarget = async (target: DesktopSshEnvironmentTarget) => {
    update({ isAdding: true, addError: null });
    const result = await runAtomCommand(
      registry,
      state.onboarding.connectSsh,
      { target, label: "" },
      { label: "connect SSH environment", reportFailure: false },
    );
    if (result._tag === "Failure") {
      update({
        isAdding: false,
        ...(isAtomCommandInterrupted(result)
          ? {}
          : { addError: formatDesktopSshConnectionError(squashAtomCommandFailure(result)) }),
      });
      return;
    }
    update({
      host: "",
      pairingCode: "",
      sshHost: "",
      sshUsername: "",
      sshPort: "",
      addEnvironmentOpen: false,
      isAdding: false,
    });
    toastSuccess(resolveSshConnectedToast(target.alias));
  };

  const submitAdd = async () => {
    const current = ui();
    const decision = resolveAddSavedBackend({
      mode: current.mode,
      host: current.host,
      pairingCode: current.pairingCode,
      sshHost: current.sshHost,
      sshUsername: current.sshUsername,
      sshPort: current.sshPort,
      baseOrigin: desktop.serverHttpUrl ?? "http://127.0.0.1",
    });
    if (decision.kind === "ssh-invalid") {
      update({ addError: decision.message });
      return;
    }
    if (decision.kind === "connect-ssh") {
      await connectSshTarget(decision.target);
      return;
    }
    if (decision.kind === "remote-invalid") {
      update({ addError: decision.message });
      toastError(resolveConnectionsFailureTitle({ kind: "add-backend" }), decision.message);
      return;
    }
    update({ isAdding: true, addError: null });
    const result = await runAtomCommand(
      registry,
      state.onboarding.connectPairing,
      { host: decision.host, pairingCode: decision.pairingCode },
      { label: "add environment", reportFailure: false },
    );
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = resolveConnectionsFailure(
          { kind: "add-backend" },
          squashAtomCommandFailure(result),
        );
        update({ addError: failure.message });
        toastError(failure.title, failure.message);
      }
      update({ isAdding: false });
      return;
    }
    update({
      host: "",
      pairingCode: "",
      sshHost: "",
      sshUsername: "",
      sshPort: "",
      addEnvironmentOpen: false,
      isAdding: false,
    });
    toastSuccess(BACKEND_ADDED_TOAST);
  };

  const pairingRow = (id: string) => {
    const model = registry.get(modelAtom);
    return model.primary.kind === "managed"
      ? (model.primary.authorizedClients?.pairingLinks.find((row) => row.id === id) ?? null)
      : null;
  };

  const copyPairingValue = async (id: string, value: string, kind: PairingCopyKind) => {
    try {
      await clipboardService(context).writeText(value);
      toastSuccess(resolvePairingCopyToast(kind));
    } catch (error) {
      setLinkUi(id, { failedCopyValue: value });
      update({ revealPairingLinkId: id });
      context.addToast({
        layout: "stacked",
        type: "error",
        ...resolvePairingCopyErrorToast({
          kind,
          canCopyToClipboard: true,
          errorMessage: errorMessage(error),
        }),
      });
    }
  };

  const setLinkUi = (id: string, patch: Partial<PairingLinkRowUiState>) => {
    const currentUi = ui().pairingLinkUi[id] ?? {
      qrEndpointId: null,
      failedCopyValue: null,
      isQrPanelOpen: false,
    };
    update({ pairingLinkUi: { ...ui().pairingLinkUi, [id]: { ...currentUi, ...patch } } });
  };

  const findEndpoint = (endpointId: string) =>
    ui().networkAccess.data?.advertisedEndpoints.find((endpoint) => endpoint.id === endpointId) ??
    null;

  const startTailscaleSetup = (endpoint: AdvertisedEndpoint) =>
    update({
      tailscaleServePortInput: resolveTailscaleServeStartPortInput(
        ui().networkAccess.data?.serverExposureState ?? null,
      ),
      pendingTailscaleServeEndpoint: endpoint,
    });

  const selectSshHost = async (alias: string) => {
    if (ui().isAdding) return;
    update({ isAdding: true, addError: null, sshHost: alias, sshSuggestionsOpen: false });
    let resolved: DesktopSshEnvironmentTarget;
    try {
      resolved = await desktop.resolveSshHost(alias);
    } catch (error) {
      update({ addError: formatDesktopSshConnectionError(error), isAdding: false });
      return;
    }
    update({
      sshUsername: resolved.username ?? "",
      sshPort: resolved.port === null ? "" : String(resolved.port),
    });
    await connectSshTarget(resolved);
  };

  return {
    views: { settingsConnections: viewAtom },
    actions: {
      connectionsMount: async () => {
        void refreshNetworkAccess();
        void refreshWsl();
        return null;
      },
      connectionsLocalEnvironment: async (params) => {
        const { intent } = LocalParams(params);
        const current = ui();
        const change = resolveLocalEnvironmentSettingChange({
          enabled: desktop.localEnvironmentEnabled,
          isUpdating: current.localUpdating,
          intent,
        });
        if (change.kind === "none") return null;
        if (change.kind === "set-dialog") {
          update({
            localConfirmOpen: change.open,
            ...(change.clearError ? { localError: null } : {}),
          });
          return null;
        }
        update({ localUpdating: true, localError: null });
        try {
          await desktop.setLocalEnvironmentEnabled(change.enabled);
        } catch (error) {
          update({
            localUpdating: false,
            localError: describeLocalEnvironmentSettingFailure(error),
          });
        }
        return null;
      },
      connectionsSetIcon: async (params) => {
        const { environmentId, value } = IconParams(params);
        const environment = registry
          .get(environmentsAtom)
          .find((entry) => entry.environmentId === environmentId);
        const model = buildEnvironmentIconMenuModel({
          serverConfig: environment?.serverConfig ?? null,
          operateAccess: operateAccessFor(registry.get, environmentId),
        });
        const selection = resolveEnvironmentIconSelection({
          lock: model.lock,
          detected: model.detected,
          next: value,
        });
        if (selection.kind === "none") return null;
        await runAtomCommand(
          registry,
          state.serverEnvironment.updateSettings,
          { environmentId, input: { patch: selection.patch } },
          { label: "environment icon" },
        );
        return null;
      },
      connectionsServerUpdate: async (params) => {
        await runServerUpdate(EnvironmentParams(params).environmentId);
        return null;
      },
      connectionsUpdateAll: async () => {
        await runUpdateAll();
        return null;
      },
      connectionsNetworkToggle: async (params) => {
        update({
          pendingNetworkExposureMode: resolveNetworkExposureToggle(CheckedParams(params).checked),
          networkExposureDialogOpen: true,
        });
        return null;
      },
      connectionsNetworkDialog: async (params) => {
        if (ui().isUpdatingServerExposure) return null;
        const { open } = OpenParams(params);
        update(
          open
            ? { networkExposureDialogOpen: true }
            : { networkExposureDialogOpen: false, pendingNetworkExposureMode: null },
        );
        return null;
      },
      connectionsNetworkConfirm: async () => {
        const decision = resolveNetworkExposureConfirm(ui().pendingNetworkExposureMode);
        if (decision.kind === "ignore") return null;
        update({ isUpdatingServerExposure: true, serverExposureError: null });
        try {
          await desktop.setServerExposureMode(decision.mode);
          update({
            networkExposureDialogOpen: false,
            isUpdatingServerExposure: false,
            pendingNetworkExposureMode: null,
          });
          void refreshNetworkAccess();
        } catch (error) {
          const failure = resolveConnectionsFailure({ kind: "network-exposure" }, error);
          update({
            networkExposureDialogOpen: false,
            pendingNetworkExposureMode: null,
            serverExposureError: failure.message,
            isUpdatingServerExposure: false,
          });
          toastError(failure.title, failure.message);
        }
        return null;
      },
      connectionsToggleEndpointList: async () => {
        update({ endpointListExpanded: !ui().endpointListExpanded });
        return null;
      },
      connectionsSetDefaultEndpoint: async (params) => {
        const endpoint = findEndpoint(EndpointParams(params).endpointId);
        if (endpoint === null) return null;
        context.updateUiState((current) =>
          setDefaultAdvertisedEndpointKey(current, endpointDefaultPreferenceKey(endpoint)),
        );
        return null;
      },
      connectionsTailscaleToggle: async (params) => {
        const model = registry.get(modelAtom);
        const selection = resolveConnectionsEndpointSelection({
          isDesktop: true,
          serverExposureState: ui().networkAccess.data?.serverExposureState ?? null,
          authPolicy: null,
          advertisedEndpoints: ui().networkAccess.data?.advertisedEndpoints ?? [],
          savedDefaultEndpointKey: registry.get(context.uiStateAtom).defaultAdvertisedEndpointKey,
        });
        const endpoint = selection.tailscaleHttpsEndpoint;
        if (endpoint === null || model.primary.kind !== "managed") return null;
        if (resolveTailscaleSwitchChange(CheckedParams(params).checked) === "setup") {
          startTailscaleSetup(endpoint);
        } else {
          update({ tailscaleDisableDialogOpen: true });
        }
        return null;
      },
      connectionsTailscaleSetup: async (params) => {
        const endpoint = findEndpoint(EndpointParams(params).endpointId);
        if (endpoint !== null) startTailscaleSetup(endpoint);
        return null;
      },
      connectionsTailscalePort: async (params) => {
        update({ tailscaleServePortInput: ValueParams(params).value });
        return null;
      },
      connectionsTailscaleSetupCancel: async () => {
        if (!ui().isUpdatingTailscaleServe) update({ pendingTailscaleServeEndpoint: null });
        return null;
      },
      connectionsTailscaleSetupConfirm: async () => {
        const port = resolveTailscaleServePort(ui().tailscaleServePortInput);
        if (port.kind !== "valid") return null;
        update({ isUpdatingTailscaleServe: true, serverExposureError: null });
        try {
          await desktop.setTailscaleServeEnabled({ enabled: true, port: port.port });
          update({ pendingTailscaleServeEndpoint: null });
          void refreshNetworkAccess();
        } catch (error) {
          const failure = resolveConnectionsFailure({ kind: "tailscale-setup" }, error);
          update({ serverExposureError: failure.message });
          toastError(failure.title, failure.message);
        } finally {
          update({ isUpdatingTailscaleServe: false });
        }
        return null;
      },
      connectionsTailscaleDisable: async () => {
        update({ tailscaleDisableDialogOpen: true });
        return null;
      },
      connectionsTailscaleDisableCancel: async () => {
        if (!ui().isUpdatingTailscaleServe) update({ tailscaleDisableDialogOpen: false });
        return null;
      },
      connectionsTailscaleDisableConfirm: async () => {
        update({ isUpdatingTailscaleServe: true, serverExposureError: null });
        try {
          await desktop.setTailscaleServeEnabled({
            enabled: false,
            port: resolveTailscaleServeDisablePort(
              ui().networkAccess.data?.serverExposureState ?? null,
            ),
          });
          update({ tailscaleDisableDialogOpen: false });
          void refreshNetworkAccess();
        } catch (error) {
          const failure = resolveConnectionsFailure({ kind: "tailscale-disable" }, error);
          update({ serverExposureError: failure.message });
          toastError(failure.title, failure.message);
        } finally {
          update({ isUpdatingTailscaleServe: false });
        }
        return null;
      },
      connectionsWslSelect: async (params) => {
        const wslState = ui().wsl.data;
        if (wslState === null) return null;
        applyWslDecision(
          resolveWslModeSelection({
            value: ValueParams(params).value,
            state: wslState,
            hasWslRegistrationToLose: resolveHasWslRegistrationToLose(
              registry.get(environmentsAtom),
            ),
          }),
        );
        return null;
      },
      connectionsWslSwitchToWindows: async () => {
        const wslState = ui().wsl.data;
        if (wslState === null) return null;
        applyWslDecision(
          resolveWslModeSelection({
            value: BACKEND_VALUE_WSL_OFF,
            state: wslState,
            hasWslRegistrationToLose: resolveHasWslRegistrationToLose(
              registry.get(environmentsAtom),
            ),
          }),
        );
        return null;
      },
      connectionsWslOnly: async (params) => {
        applyWslDecision(
          resolveWslOnlyToggle({ enabled: CheckedParams(params).checked, state: ui().wsl.data }),
        );
        return null;
      },
      connectionsWslConfirm: async (params) => {
        const { actionId } = WslConfirmParams(params);
        const pending = ui().pendingWslChange;
        if (pending === null) return null;
        if (actionId === "confirm") {
          const decision = resolveWslConfirm(pending);
          if (decision.kind !== "apply") return null;
          update({ pendingWslChange: null });
          await applyWslOperation(decision.operation);
          return null;
        }
        if (pending.kind !== "enable") return null;
        update({ pendingWslChange: null, isUpdatingWslBackend: true, wslMutationError: null });
        try {
          await desktop.setWslBackendEnabled(true);
        } catch (error) {
          const failure = resolveConnectionsFailure({ kind: "wsl" }, error);
          update({ wslMutationError: failure.message });
          toastError(failure.title, failure.message);
        } finally {
          update({ isUpdatingWslBackend: false });
          void refreshWsl();
        }
        return null;
      },
      connectionsWslCancel: async () => {
        if (!ui().isUpdatingWslBackend) update({ pendingWslChange: null });
        return null;
      },
      connectionsWslRetry: async () => {
        update({ wslMutationError: null });
        await refreshWsl();
        return null;
      },
      connectionsCreateLinkOpen: async (params) => {
        const { open } = OpenParams(params);
        update(
          open
            ? { createPairingLinkOpen: true }
            : {
                createPairingLinkOpen: false,
                pairingLabel: "",
                pairingScopes: defaultPairingScopes(),
              },
        );
        return null;
      },
      connectionsCreateLinkLabel: async (params) => {
        update({ pairingLabel: ValueParams(params).value });
        return null;
      },
      connectionsCreateLinkPreset: async (params) => {
        update({ pairingScopes: resolvePairingScopePreset(PresetParams(params).preset) });
        return null;
      },
      connectionsCreateLinkScope: async (params) => {
        const { scope, checked } = ScopeParams(params);
        const option = PAIRING_SCOPE_OPTIONS.find((entry) => entry.scope === scope);
        if (option === undefined) return null;
        update({
          pairingScopes: resolvePairingScopeToggle(ui().pairingScopes, option.scope, checked),
        });
        return null;
      },
      connectionsCreateLinkSubmit: async () => {
        const current = ui();
        if (current.isCreatingPairingLink || current.pairingScopes.length === 0) return null;
        update({ isCreatingPairingLink: true });
        try {
          const result = await runAtomCommand(
            registry,
            state.primaryAuthHttp.createPairingCredential,
            {
              httpBaseUrl: primaryHttpBaseUrl(),
              label: current.pairingLabel,
              scopes: current.pairingScopes,
            },
            { label: "create pairing link", reportFailure: false },
          );
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          const created = result.value;
          update({
            createdPairingCredentials: {
              ...ui().createdPairingCredentials,
              [created.id]: created.credential,
            },
            pairingLabel: "",
            pairingScopes: defaultPairingScopes(),
            createPairingLinkOpen: false,
          });
        } catch (error) {
          const failure = resolveConnectionsFailure({ kind: "create-pairing-link" }, error);
          toastError(failure.title, failure.message);
        } finally {
          update({ isCreatingPairingLink: false });
        }
        return null;
      },
      connectionsRevokeLink: async (params) => {
        const { id } = IdParams(params);
        update({ revokingPairingLinkId: id, accessManagementError: null });
        try {
          const result = await runAtomCommand(
            registry,
            state.primaryAuthHttp.revokePairingLink,
            { httpBaseUrl: primaryHttpBaseUrl(), id },
            { label: "revoke pairing link", reportFailure: false },
          );
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        } catch (error) {
          const failure = resolveConnectionsFailure({ kind: "revoke-pairing-link" }, error);
          update({ accessManagementError: failure.message });
          toastError(failure.title, failure.message);
        } finally {
          update({ revokingPairingLinkId: null });
        }
        return null;
      },
      connectionsRevokeClient: async (params) => {
        const { id } = IdParams(params);
        const session = registry
          .get(accessChangesAtom)
          .clientSessions.find((entry) => entry.sessionId === id);
        if (session === undefined) return null;
        const sessionId: AuthSessionId = session.sessionId;
        update({ revokingClientSessionId: id, accessManagementError: null });
        try {
          const result = await runAtomCommand(
            registry,
            state.primaryAuthHttp.revokeClient,
            { httpBaseUrl: primaryHttpBaseUrl(), sessionId },
            { label: "revoke client", reportFailure: false },
          );
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        } catch (error) {
          const failure = resolveConnectionsFailure({ kind: "revoke-client" }, error);
          update({ accessManagementError: failure.message });
          toastError(failure.title, failure.message);
        } finally {
          update({ revokingClientSessionId: null });
        }
        return null;
      },
      connectionsRevokeOthers: async () => {
        update({ isRevokingOtherClients: true, accessManagementError: null });
        try {
          const result = await runAtomCommand(
            registry,
            state.primaryAuthHttp.revokeOtherClients,
            { httpBaseUrl: primaryHttpBaseUrl() },
            { label: "revoke other clients", reportFailure: false },
          );
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          toastSuccess(resolveRevokeOtherClientsToast(result.value.revokedCount));
        } catch (error) {
          const failure = resolveConnectionsFailure({ kind: "revoke-other-clients" }, error);
          update({ accessManagementError: failure.message });
          toastError(failure.title, failure.message);
        } finally {
          update({ isRevokingOtherClients: false });
        }
        return null;
      },
      connectionsLinkQrToggle: async (params) => {
        const { id } = IdParams(params);
        setLinkUi(id, { isQrPanelOpen: !(ui().pairingLinkUi[id]?.isQrPanelOpen ?? false) });
        return null;
      },
      connectionsLinkQrEndpoint: async (params) => {
        const { id, endpointId } = QrEndpointParams(params);
        setLinkUi(id, { qrEndpointId: endpointId });
        return null;
      },
      connectionsLinkCopy: async (params) => {
        const { id, target } = CopyParams(params);
        const row = pairingRow(id);
        if (row === null) return null;
        if (target === "code") {
          const credential = ui().createdPairingCredentials[id];
          if (credential !== undefined) await copyPairingValue(id, credential, "code");
          return null;
        }
        const url = row.qrPanel.url;
        if (url !== null) await copyPairingValue(id, url, resolvePairingUrlCopyKind(url));
        return null;
      },
      connectionsLinkReveal: async (params) => {
        const { id } = RevealParams(params);
        if (id === null) {
          const previous = ui().revealPairingLinkId;
          if (previous !== null) setLinkUi(previous, { failedCopyValue: null });
        }
        update({ revealPairingLinkId: id });
        return null;
      },
      connectionsAddOpen: async (params) => {
        const { open } = OpenParams(params);
        update(open ? { addEnvironmentOpen: true } : { addEnvironmentOpen: false, addError: null });
        if (open && ui().mode === "ssh") void refreshSshHosts();
        return null;
      },
      connectionsAddMode: async (params) => {
        const { mode } = ModeParams(params);
        update({ mode });
        if (mode === "ssh") void refreshSshHosts();
        return null;
      },
      connectionsAddField: async (params) => {
        const { field, value } = FieldParams(params);
        if (field === "host") {
          const decision = resolveSavedBackendHostInput(
            value,
            desktop.serverHttpUrl ?? "http://127.0.0.1",
          );
          update(
            decision.kind === "pairing-url"
              ? { host: decision.host, pairingCode: decision.pairingCode }
              : { host: decision.host },
          );
          return null;
        }
        update({ [field]: value, ...(field === "sshHost" ? { sshSuggestionsOpen: true } : {}) });
        return null;
      },
      connectionsAddSuggestions: async (params) => {
        update({ sshSuggestionsOpen: OpenParams(params).open });
        return null;
      },
      connectionsAddSubmit: async () => {
        await submitAdd();
        return null;
      },
      connectionsAddHostKeyDown: async (params) => {
        const event = KeyDownParams(params);
        const view = registry.get(viewAtom);
        if (view === null || !view.sshSuggestionsOpen) return false;
        const suggestions = view.model.remoteEnvironments.addEnvironmentDialog.ssh.suggestions;
        if (!suggestions.hasContent) return false;
        const command = resolveShortcutCommand(
          event,
          registry.get(state.primaryServerConfigAtom)?.keybindings ?? [],
          { platform: context.platform, context: { modelPickerOpen: false } },
        );
        const index = threadJumpIndexFromCommand(command ?? "");
        const item = index === null ? undefined : suggestions.items[index];
        if (item === undefined) return false;
        await selectSshHost(item.alias);
        return true;
      },
      connectionsAddSelectHost: async (params) => {
        await selectSshHost(AliasParams(params).alias);
        return null;
      },
      connectionsSetEnabled: async (params) => {
        const { environmentId, enabled } = SetEnabledParams(params);
        update({ addError: null });
        const result = await runAtomCommand(
          registry,
          state.environmentCatalog.setEnabled,
          { environmentId, enabled },
          { label: "switch environment", reportFailure: false },
        );
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const failure = resolveConnectionsFailure(
            { kind: "set-backend-enabled", enabled },
            squashAtomCommandFailure(result),
          );
          update({ addError: failure.message });
          toastError(failure.title, failure.message);
        }
        return null;
      },
      connectionsRemove: async (params) => {
        const { environmentId } = EnvironmentParams(params);
        const environment = registry
          .get(environmentsAtom)
          .find((entry) => entry.environmentId === environmentId);
        if (environment === undefined) return null;
        const decision = resolveRemoveSavedBackend({ environment, cloudEnabled: false });
        if (decision.kind !== "confirm") return null;
        const confirmed = await confirm(decision.message, "destructive");
        if (confirmed !== true) return null;
        update({ removingEnvironmentId: environmentId, addError: null });
        const result = await runAtomCommand(
          registry,
          state.environmentCatalog.remove,
          environmentId,
          { label: "remove environment", reportFailure: false },
        );
        update({ removingEnvironmentId: null });
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const failure = resolveConnectionsFailure(
            { kind: "remove-backend" },
            squashAtomCommandFailure(result),
          );
          update({ addError: failure.message });
          toastError(failure.title, failure.message);
        }
        return null;
      },
      connectionsCopyTraceId: async (params) => {
        const { environmentId } = EnvironmentParams(params);
        const row = registry
          .get(modelAtom)
          .remoteEnvironments.rows.find((entry) => entry.id === environmentId);
        const traceId = row?.menu.copyTraceId?.traceId;
        if (traceId === undefined) return null;
        try {
          await clipboardService(context).writeText(traceId);
          toastSuccess(resolveTraceIdCopyToast(traceId));
        } catch (error) {
          const failure = resolveConnectionsFailure({ kind: "copy-trace-id" }, error);
          toastError(failure.title, failure.message);
        }
        return null;
      },
      connectionsGitHubRouting: async (params) => {
        const { environmentId, permission } = RoutingParams(params);
        const change = resolveGitHubRoutingChange({ environmentId, permission });
        if (change.kind === "none") return null;
        update({ githubRoutingSaving: true });
        const result = await runAtomCommand(
          registry,
          state.environmentCatalog.setGitHubRoutingPermission,
          { environmentId: change.environmentId, permission: change.permission },
          { label: "GitHub routing", reportFailure: false },
        );
        update({ githubRoutingSaving: false });
        if (result._tag === "Failure") {
          context.addToast({ layout: "plain", type: "error", title: change.failureToastTitle });
        }
        return null;
      },
    },
  };
}
