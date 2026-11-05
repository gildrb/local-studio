import { connectionStatusText } from "@t3tools/client-runtime/connection";
import type { ServerUpdateState } from "@t3tools/client-runtime/state/server";
import {
  AuthAccessWriteScope,
  AuthAdministrativeScopes,
  AuthOrchestrationReadScope,
  AuthRelayWriteScope,
  AuthStandardClientScopes,
  resolveEnvironmentMachineKind,
  type AdvertisedEndpoint,
  type AuthEnvironmentScope,
  type DesktopDiscoveredSshHost,
  type DesktopServerExposureState,
  type DesktopSshEnvironmentTarget,
  type DesktopWslState,
  type EnvironmentId,
  type EnvironmentMachineKind,
  type ExecutionEnvironmentDescriptor,
  type ResolvedKeybindingsConfig,
  type ServerAuthPolicy,
  type ServerConfig,
  type ServerSelfUpdateCapability,
} from "@t3tools/contracts";
import * as Option from "effect/Option";

import { isDesktopLocalConnectionTarget } from "../../connection/desktopLocal";
import type {
  ServerClientSessionRecord,
  ServerPairingLinkRecord,
} from "../../environments/primary/auth";
import { isLoopbackHostname } from "../../environments/primary/target";
import {
  shortcutLabelForCommand,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
} from "../../keybindings";
import { filterDiscoveredSshHosts } from "../../state/desktopSshHosts";
import type { EnvironmentPresentation } from "../../state/environments";
import { formatElapsedDurationLabel, formatExpiresInLabel } from "../../timestampFormat";
import {
  resolveServerSelfUpdateCapability,
  resolveVersionMismatchForClient,
  supportsDesktopAppUpdate,
  supportsServerUpdateThreadContinuation,
  type VersionMismatch,
} from "../../versionSkew.logic";
import {
  BACKEND_VALUE_DEFAULT_WSL,
  BACKEND_VALUE_WSL_OFF,
  DEFAULT_TAILSCALE_SERVE_PORT,
  PAIRING_SCOPE_OPTIONS,
  endpointDefaultPreferenceKey,
  endpointShareHint,
  formatAccessTimestamp,
  isHostedAppPairingUrl,
  isQrShareableEndpoint,
  isTailscaleHttpsEndpoint,
  isWslSettingsRowVisible,
  parsePairingUrlFields,
  resolveAdvertisedEndpointPairingUrl,
  resolveCurrentOriginPairingUrl,
  resolveManualDesktopSshTarget,
  resolveRemotePairingFields,
  savedBackendStatus,
  selectPairingEndpoint,
  selectQrEndpointOption,
  sortDesktopClientSessions,
  sortDesktopPairingLinks,
  summarizeAuthorizedClients,
  type SavedBackendStatusTone,
} from "./ConnectionsSettings.logic";
import { formatDesktopSshTarget, environmentTransportLabel } from "./EnvironmentRow.logic";
import { resolveDesktopPairingUrl } from "./pairingUrls";
import { searchableSetting } from "./settingsSearch";

export type ConnectionsToast = {
  readonly title: string;
  readonly description: string;
};

export type ConnectionsSwitchModel = {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly ariaLabel: string;
};

export type ConnectionsButtonModel = {
  readonly label: string;
  readonly disabled: boolean;
};

export type ConnectionsBusyButtonModel = {
  readonly label: string;
  readonly busy: boolean;
  readonly disabled: boolean;
};

export type ConnectionsButtonVariant = "default" | "outline" | "destructive";

export type ServerUpdateFacts = {
  readonly versionMismatch: VersionMismatch | null;
  readonly selfUpdate: ServerSelfUpdateCapability | null;
  readonly desktopAppUpdate: boolean;
  readonly threadContinuation: boolean;
};

export function resolveServerUpdateFacts(
  serverConfig: ServerConfig | null,
  clientVersion: string,
): ServerUpdateFacts {
  return {
    versionMismatch: resolveVersionMismatchForClient(
      clientVersion,
      serverConfig?.environment.serverVersion,
    ),
    selfUpdate: resolveServerSelfUpdateCapability(serverConfig),
    desktopAppUpdate: supportsDesktopAppUpdate(serverConfig),
    threadContinuation: supportsServerUpdateThreadContinuation(serverConfig),
  };
}

export type AccessScopeSummaryModel = {
  readonly countLabel: string;
  readonly ariaLabel: string;
  readonly heading: string;
  readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
};

export function buildAccessScopeSummaryModel(
  scopes: ReadonlyArray<AuthEnvironmentScope>,
  label: string,
): AccessScopeSummaryModel {
  const countLabel = `${scopes.length} ${scopes.length === 1 ? "scope" : "scopes"}`;
  return {
    countLabel,
    ariaLabel: `${label}: show ${countLabel}`,
    heading: "Granted scopes",
    scopes,
  };
}

export type PairingCopyKind = "code" | "hosted-link" | "link";

export function resolvePairingUrlCopyKind(url: string): "hosted-link" | "link" {
  return isHostedAppPairingUrl(url) ? "hosted-link" : "link";
}

export function resolvePairingCopyToast(kind: PairingCopyKind): ConnectionsToast {
  return {
    title:
      kind === "hosted-link"
        ? "Hosted app link copied"
        : kind === "link"
          ? "Pairing URL copied"
          : "Pairing code copied",
    description:
      kind === "hosted-link"
        ? "Open it in the browser on the device you want to connect."
        : kind === "link"
          ? "Open it in the client you want to pair to this environment."
          : "Paste it into another client to finish pairing.",
  };
}

export function resolvePairingCopyErrorToast(input: {
  readonly kind: PairingCopyKind;
  readonly canCopyToClipboard: boolean;
  readonly errorMessage: string;
}): ConnectionsToast {
  return {
    title: input.canCopyToClipboard
      ? input.kind === "hosted-link"
        ? "Could not copy hosted app link"
        : input.kind === "link"
          ? "Could not copy pairing URL"
          : "Could not copy pairing code"
      : "Clipboard copy unavailable",
    description: input.canCopyToClipboard ? input.errorMessage : "Showing the full value instead.",
  };
}

export type PairingEndpointOptionModel = {
  readonly id: string;
  readonly preferenceKey: string;
  readonly label: string;
  readonly url: string;
  readonly detail: string;
  readonly qrShareable: boolean;
  readonly selected: boolean;
};

export type PairingLinkCodeAction = "copy-code" | "show-dialog" | null;

export type PairingLinkRevealModel = {
  readonly available: boolean;
  readonly title: string;
  readonly description: string;
  readonly value: string;
  readonly isUrl: boolean;
  readonly rows: number;
  readonly showQr: boolean;
  readonly qrTitle: string;
  readonly doneLabel: string;
  readonly copyCodeLabel: string | null;
};

export type PairingLinkQrPanelModel = {
  readonly visible: boolean;
  readonly endpointPickerVisible: boolean;
  readonly endpointPickerLabel: string;
  readonly endpointPickerAriaLabel: string;
  readonly url: string | null;
  readonly urlCopyKind: "hosted-link" | "link" | null;
  readonly copyLinkLabel: string;
  readonly copyCodeLabel: string;
  readonly canRenderQr: boolean;
  readonly qrTitle: string;
  readonly noQrMessage: string;
};

export type PairingLinkRowModel = {
  readonly id: string;
  readonly title: string;
  readonly expired: boolean;
  readonly createdTooltip: string;
  readonly expiresLabel: string;
  readonly expiresTooltip: string;
  readonly scopeSummary: AccessScopeSummaryModel;
  readonly hint: string | null;
  readonly hasCredential: boolean;
  readonly shareablePairingUrl: string | null;
  readonly shareButtonLabel: string | null;
  readonly codeAction: PairingLinkCodeAction;
  readonly codeActionLabel: string;
  readonly endpointOptions: ReadonlyArray<PairingEndpointOptionModel>;
  readonly selectedEndpointOptionId: string | null;
  readonly qrPanel: PairingLinkQrPanelModel;
  readonly reveal: PairingLinkRevealModel;
  readonly revoke: ConnectionsButtonModel;
};

export type PairingLinkRowModelInput = {
  readonly pairingLink: ServerPairingLinkRecord;
  readonly credential: string | undefined;
  readonly endpointUrl: string | null | undefined;
  readonly endpoints: ReadonlyArray<AdvertisedEndpoint>;
  readonly defaultEndpointKey: string | null;
  readonly revokingPairingLinkId: string | null;
  readonly nowMs: number;
  readonly currentHref: string;
  readonly canCopyToClipboard: boolean;
  readonly qrEndpointId: string | null;
  readonly failedCopyValue: string | null;
  readonly isQrPanelOpen: boolean;
};

const PAIRING_QR_TITLE = "Pairing link — scan to open on another device";

export function buildPairingLinkRowModel(input: PairingLinkRowModelInput): PairingLinkRowModel {
  const { pairingLink, credential, endpoints, defaultEndpointKey } = input;
  const currentOriginPairingUrl = credential
    ? resolveCurrentOriginPairingUrl(credential, input.currentHref)
    : null;
  const pairingEndpoint = selectPairingEndpoint(endpoints, defaultEndpointKey);
  const endpointPairingUrl =
    pairingEndpoint && credential
      ? resolveAdvertisedEndpointPairingUrl(pairingEndpoint, credential)
      : null;
  const copyOptions: Array<Omit<PairingEndpointOptionModel, "selected">> = [];
  if (credential) {
    for (const endpoint of endpoints) {
      if (endpoint.status === "unavailable") {
        continue;
      }
      const url = resolveAdvertisedEndpointPairingUrl(endpoint, credential);
      copyOptions.push({
        id: endpoint.id,
        preferenceKey: endpointDefaultPreferenceKey(endpoint),
        label: endpoint.label,
        url,
        detail: endpointShareHint(endpoint, url),
        qrShareable: isQrShareableEndpoint(endpoint),
      });
    }
  }
  const shareablePairingUrl =
    endpointPairingUrl ??
    (credential && input.endpointUrl != null && input.endpointUrl !== ""
      ? resolveDesktopPairingUrl(input.endpointUrl, credential)
      : isLoopbackHostname(new URL(input.currentHref).hostname)
        ? null
        : currentOriginPairingUrl);
  const revealValue = input.failedCopyValue ?? shareablePairingUrl ?? credential ?? "";
  const isRevealValueUrl = revealValue !== credential;
  const isRevealValueHostedAppPairingUrl = isRevealValueUrl && isHostedAppPairingUrl(revealValue);
  const isRevealValueQrShareable =
    copyOptions.find((option) => option.url === revealValue)?.qrShareable ?? true;
  const selectedQrOption = selectQrEndpointOption(
    copyOptions,
    input.qrEndpointId,
    defaultEndpointKey,
  );
  const qrPairingUrl = selectedQrOption?.url ?? shareablePairingUrl;
  const isRevoking = input.revokingPairingLinkId === pairingLink.id;

  return {
    id: pairingLink.id,
    title: pairingLink.label ?? "Pairing link",
    expired: new Date(pairingLink.expiresAt).getTime() <= input.nowMs,
    createdTooltip: `Link created at ${formatAccessTimestamp(pairingLink.createdAt)}`,
    expiresLabel: formatExpiresInLabel(pairingLink.expiresAt, input.nowMs),
    expiresTooltip: formatAccessTimestamp(pairingLink.expiresAt),
    scopeSummary: buildAccessScopeSummaryModel(pairingLink.scopes, "Pairing link scopes"),
    hint: !credential
      ? "Create a new link to share from this client."
      : shareablePairingUrl === null
        ? "Copy the token and pair from another client using this backend's reachable host."
        : null,
    hasCredential: credential !== undefined,
    shareablePairingUrl,
    shareButtonLabel: shareablePairingUrl && input.canCopyToClipboard ? "Share" : null,
    codeAction: !credential
      ? null
      : input.canCopyToClipboard
        ? shareablePairingUrl
          ? null
          : "copy-code"
        : "show-dialog",
    codeActionLabel: input.canCopyToClipboard
      ? "Copy code"
      : shareablePairingUrl
        ? "Show link"
        : "Show code",
    endpointOptions: copyOptions.map((option) => ({
      ...option,
      selected: option.id === selectedQrOption?.id,
    })),
    selectedEndpointOptionId: selectedQrOption?.id ?? null,
    qrPanel: {
      visible: input.isQrPanelOpen && qrPairingUrl !== null,
      endpointPickerVisible: copyOptions.length > 1,
      endpointPickerLabel: "Reach this machine via",
      endpointPickerAriaLabel: "Endpoint the pairing QR code and URL use",
      url: qrPairingUrl,
      urlCopyKind: qrPairingUrl === null ? null : resolvePairingUrlCopyKind(qrPairingUrl),
      copyLinkLabel: "Copy link",
      copyCodeLabel: "Copy code only",
      canRenderQr: selectedQrOption?.qrShareable ?? true,
      qrTitle: PAIRING_QR_TITLE,
      noQrMessage:
        "No QR for this endpoint. Another device scanning a loopback link would dial itself; copy the URL for use on this machine instead.",
    },
    reveal: {
      available: credential !== undefined,
      title: isRevealValueUrl
        ? isRevealValueHostedAppPairingUrl
          ? "Hosted app pairing link"
          : "Pairing link"
        : "Pairing code",
      description: isRevealValueUrl
        ? isRevealValueHostedAppPairingUrl
          ? "Clipboard copy is unavailable here. Open or manually copy this hosted app link on the device you want to connect."
          : "Clipboard copy is unavailable here. Open or manually copy this full pairing URL on the device you want to connect."
        : "Clipboard copy is unavailable here. Manually copy this code into another client.",
      value: revealValue,
      isUrl: isRevealValueUrl,
      rows: isRevealValueUrl ? 4 : 3,
      showQr: isRevealValueUrl && isRevealValueQrShareable,
      qrTitle: PAIRING_QR_TITLE,
      doneLabel: "Done",
      copyCodeLabel: input.canCopyToClipboard ? "Copy code" : null,
    },
    revoke: {
      label: isRevoking ? "Revoking…" : "Revoke",
      disabled: isRevoking,
    },
  };
}

export type ClientSessionRowModel = {
  readonly id: string;
  readonly title: string;
  readonly isLive: boolean;
  readonly statusTooltip: string;
  readonly currentBadgeLabel: string | null;
  readonly deviceInfo: string | null;
  readonly scopeSummary: AccessScopeSummaryModel;
  readonly revoke: ConnectionsButtonModel | null;
};

export type ClientSessionRowModelInput = {
  readonly clientSession: ServerClientSessionRecord;
  readonly revokingClientSessionId: string | null;
  readonly nowMs: number;
};

export function buildClientSessionRowModel(
  input: ClientSessionRowModelInput,
): ClientSessionRowModel {
  const { clientSession, nowMs } = input;
  const isLive = clientSession.current || clientSession.connected;
  const lastConnectedAt = clientSession.lastConnectedAt;
  const deviceInfoBits = [
    clientSession.client.deviceType !== "unknown"
      ? clientSession.client.deviceType[0]?.toUpperCase() + clientSession.client.deviceType.slice(1)
      : null,
    clientSession.client.os ?? null,
    clientSession.client.browser ?? null,
    clientSession.client.ipAddress ?? null,
  ].filter((value): value is string => value !== null);
  const isRevoking = input.revokingClientSessionId === clientSession.sessionId;
  return {
    id: clientSession.sessionId,
    title:
      clientSession.client.label ??
      ([clientSession.client.os, clientSession.client.browser].filter(Boolean).join(" · ") ||
        clientSession.subject),
    isLive,
    statusTooltip: isLive
      ? lastConnectedAt
        ? `Connected for ${formatElapsedDurationLabel(lastConnectedAt, nowMs)}`
        : "Connected"
      : lastConnectedAt
        ? `Last connected at ${formatAccessTimestamp(lastConnectedAt)}`
        : "Not connected yet.",
    currentBadgeLabel: clientSession.current ? "This device" : null,
    deviceInfo: deviceInfoBits.length > 0 ? deviceInfoBits.join(" · ") : null,
    scopeSummary: buildAccessScopeSummaryModel(clientSession.scopes, "Client scopes"),
    revoke: clientSession.current
      ? null
      : { label: isRevoking ? "Revoking…" : "Revoke", disabled: isRevoking },
  };
}

export type PairingScopePresetId = "read-only" | "standard";

export type PairingScopePresetModel = {
  readonly id: PairingScopePresetId;
  readonly label: string;
  readonly disabled: boolean;
};

export type PairingScopeOptionModel = {
  readonly scope: AuthEnvironmentScope;
  readonly title: string;
  readonly description: string;
  readonly checked: boolean;
  readonly disabled: boolean;
};

export type ConnectionsValidationModel = {
  readonly tone: "error" | "warning";
  readonly message: string;
};

export type CreatePairingLinkDialogModel = {
  readonly triggerLabel: string;
  readonly title: string;
  readonly description: string;
  readonly labelField: {
    readonly label: string;
    readonly placeholder: string;
    readonly value: string;
    readonly disabled: boolean;
  };
  readonly permissionsTitle: string;
  readonly permissionsDescription: string;
  readonly presets: ReadonlyArray<PairingScopePresetModel>;
  readonly scopeOptions: ReadonlyArray<PairingScopeOptionModel>;
  readonly validation: ConnectionsValidationModel | null;
  readonly cancel: ConnectionsButtonModel;
  readonly create: ConnectionsButtonModel;
};

export type CreatePairingLinkDialogModelInput = {
  readonly label: string;
  readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
  readonly isCreating: boolean;
};

export function defaultPairingScopes(): ReadonlyArray<AuthEnvironmentScope> {
  return [...AuthStandardClientScopes];
}

export function resolvePairingScopePreset(
  preset: PairingScopePresetId,
): ReadonlyArray<AuthEnvironmentScope> {
  return preset === "read-only" ? [AuthOrchestrationReadScope] : defaultPairingScopes();
}

export function resolvePairingScopeToggle(
  current: ReadonlyArray<AuthEnvironmentScope>,
  scope: AuthEnvironmentScope,
  checked: boolean,
): ReadonlyArray<AuthEnvironmentScope> {
  return checked ? [...current, scope] : current.filter((currentScope) => currentScope !== scope);
}

export function buildCreatePairingLinkDialogModel(
  input: CreatePairingLinkDialogModelInput,
): CreatePairingLinkDialogModel {
  const { scopes, isCreating } = input;
  return {
    triggerLabel: "Create link",
    title: "Create pairing link",
    description:
      "Generate a one-time link that another device can use to pair with this backend as an authorized client.",
    labelField: {
      label: "Client label (optional)",
      placeholder: "e.g. Living room iPad",
      value: input.label,
      disabled: isCreating,
    },
    permissionsTitle: "Permissions",
    permissionsDescription: "Limit what the paired client can do.",
    presets: [
      { id: "read-only", label: "Read only", disabled: isCreating },
      { id: "standard", label: "Standard", disabled: isCreating },
    ],
    scopeOptions: PAIRING_SCOPE_OPTIONS.map((option) => ({
      ...option,
      checked: scopes.includes(option.scope),
      disabled: isCreating,
    })),
    validation:
      scopes.length === 0
        ? { tone: "error", message: "Select at least one permission." }
        : scopes.includes(AuthAccessWriteScope)
          ? {
              tone: "warning",
              message: "This client can create or revoke access for other devices.",
            }
          : null,
    cancel: { label: "Cancel", disabled: isCreating },
    create: {
      label: isCreating ? "Creating…" : "Create link",
      disabled: isCreating || scopes.length === 0,
    },
  };
}

export type AuthorizedClientsHeaderModel = {
  readonly revokeOthers: ConnectionsButtonModel;
  readonly createLabel: string;
};

export function buildAuthorizedClientsHeaderModel(input: {
  readonly clientSessions: ReadonlyArray<ServerClientSessionRecord>;
  readonly isRevokingOtherClients: boolean;
}): AuthorizedClientsHeaderModel {
  return {
    revokeOthers: {
      label: input.isRevokingOtherClients ? "Revoking…" : "Revoke others",
      disabled:
        input.isRevokingOtherClients ||
        input.clientSessions.every((clientSession) => clientSession.current),
    },
    createLabel: "Create link",
  };
}

export function resolveRevokeOtherClientsToast(revokedCount: number): ConnectionsToast {
  return {
    title: revokedCount === 1 ? "Revoked 1 other client" : `Revoked ${revokedCount} clients`,
    description: "Other paired clients will need a new pairing link before reconnecting.",
  };
}

export type AdvertisedEndpointRowModel = {
  readonly id: string;
  readonly preferenceKey: string;
  readonly label: string;
  readonly url: string;
  readonly showUrl: boolean;
  readonly available: boolean;
  readonly isDefault: boolean;
  readonly setupRequiredLabel: string | null;
  readonly defaultBadgeLabel: string | null;
  readonly setupAction: ConnectionsButtonModel | null;
  readonly disableAction: ConnectionsButtonModel | null;
  readonly setDefaultLabel: string | null;
};

export type AdvertisedEndpointRowModelInput = {
  readonly endpoint: AdvertisedEndpoint;
  readonly defaultEndpointKey: string | null;
  readonly isUpdatingTailscaleServe: boolean;
};

export function buildAdvertisedEndpointRowModel(
  input: AdvertisedEndpointRowModelInput,
): AdvertisedEndpointRowModel {
  const { endpoint, isUpdatingTailscaleServe } = input;
  const preferenceKey = endpointDefaultPreferenceKey(endpoint);
  const isDefault = preferenceKey === input.defaultEndpointKey;
  const isAvailable = endpoint.status === "available";
  const isTailscale = isTailscaleHttpsEndpoint(endpoint);
  const needsTailscaleSetup = isTailscale && endpoint.status !== "available";
  const restartingLabel = "Restarting…";
  return {
    id: endpoint.id,
    preferenceKey,
    label: endpoint.label,
    url: endpoint.httpBaseUrl,
    showUrl: !needsTailscaleSetup,
    available: isAvailable,
    isDefault,
    setupRequiredLabel: isAvailable ? null : "Setup required",
    defaultBadgeLabel: isDefault ? "Default" : null,
    setupAction: needsTailscaleSetup
      ? {
          label: isUpdatingTailscaleServe ? restartingLabel : "Setup",
          disabled: isUpdatingTailscaleServe,
        }
      : null,
    disableAction:
      isTailscale && endpoint.status === "available"
        ? {
            label: isUpdatingTailscaleServe ? restartingLabel : "Disable",
            disabled: isUpdatingTailscaleServe,
          }
        : null,
    setDefaultLabel: !needsTailscaleSetup && !isDefault ? "Set as default" : null,
  };
}

export type ConnectionsEndpointSelection = {
  readonly networkAccessible: boolean;
  readonly remotelyReachable: boolean;
  readonly tailscaleHttpsEndpoint: AdvertisedEndpoint | null;
  readonly visibleNetworkEndpoints: ReadonlyArray<AdvertisedEndpoint>;
  readonly visibleEndpoints: ReadonlyArray<AdvertisedEndpoint>;
  readonly defaultNetworkEndpoint: AdvertisedEndpoint | null;
  readonly defaultEndpointKey: string | null;
};

export type ConnectionsEndpointSelectionInput = {
  readonly isDesktop: boolean;
  readonly serverExposureState: DesktopServerExposureState | null;
  readonly authPolicy: ServerAuthPolicy | null;
  readonly advertisedEndpoints: ReadonlyArray<AdvertisedEndpoint>;
  readonly savedDefaultEndpointKey: string | null;
};

export function resolveConnectionsEndpointSelection(
  input: ConnectionsEndpointSelectionInput,
): ConnectionsEndpointSelection {
  const networkAccessible = input.isDesktop
    ? input.serverExposureState?.mode === "network-accessible"
    : input.authPolicy === "remote-reachable";
  const tailscaleHttpsEndpoint = input.advertisedEndpoints.find(isTailscaleHttpsEndpoint) ?? null;
  const visibleNetworkEndpoints = networkAccessible
    ? input.advertisedEndpoints.filter((endpoint) => !isTailscaleHttpsEndpoint(endpoint))
    : [];
  const visibleEndpoints = tailscaleHttpsEndpoint
    ? [...visibleNetworkEndpoints, tailscaleHttpsEndpoint]
    : visibleNetworkEndpoints;
  const defaultNetworkEndpoint = selectPairingEndpoint(
    visibleNetworkEndpoints,
    input.savedDefaultEndpointKey,
  );
  const defaultEndpoint =
    defaultNetworkEndpoint ??
    selectPairingEndpoint(
      tailscaleHttpsEndpoint ? [tailscaleHttpsEndpoint] : [],
      input.savedDefaultEndpointKey,
    );
  return {
    networkAccessible,
    remotelyReachable: networkAccessible || tailscaleHttpsEndpoint?.status === "available",
    tailscaleHttpsEndpoint,
    visibleNetworkEndpoints,
    visibleEndpoints,
    defaultNetworkEndpoint,
    defaultEndpointKey: defaultEndpoint ? endpointDefaultPreferenceKey(defaultEndpoint) : null,
  };
}

export type NetworkAccessDescriptionModel =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "endpoint";
      readonly prefix: string;
      readonly url: string;
      readonly hiddenEndpointCount: number;
      readonly expandable: boolean;
      readonly expanded: boolean;
      readonly toggleLabel: string | null;
    };

export type NetworkAccessRowModel =
  | {
      readonly kind: "toggle";
      readonly id: string;
      readonly title: string;
      readonly description: NetworkAccessDescriptionModel;
      readonly status: string | null;
      readonly switch: ConnectionsSwitchModel;
    }
  | {
      readonly kind: "locked";
      readonly id: string;
      readonly title: string;
      readonly description: string;
      readonly switch: ConnectionsSwitchModel;
      readonly tooltip: string;
    };

export type NetworkAccessRowModelInput = {
  readonly isDesktop: boolean;
  readonly selection: ConnectionsEndpointSelection;
  readonly serverExposureState: DesktopServerExposureState | null;
  readonly serverExposureError: string | null;
  readonly authPolicy: ServerAuthPolicy | null;
  readonly isUpdatingServerExposure: boolean;
  readonly endpointListExpanded: boolean;
};

export function buildNetworkAccessRowModel(
  input: NetworkAccessRowModelInput,
): NetworkAccessRowModel {
  const setting = searchableSetting("network-access");
  const ariaLabel = "Enable network access";
  if (!input.isDesktop) {
    return {
      kind: "locked",
      id: setting.id,
      title: setting.title,
      description:
        input.authPolicy === "remote-reachable"
          ? "Remote access is already configured. Change network exposure where the server starts."
          : "Only this machine can connect. Restart with a non-loopback host for remote pairing.",
      switch: { checked: input.selection.networkAccessible, disabled: true, ariaLabel },
      tooltip:
        "Network exposure changes restart the backend and must be controlled where the server process is launched.",
    };
  }
  const state = input.serverExposureState;
  const endpoint = input.selection.defaultNetworkEndpoint;
  const hiddenEndpointCount = Math.max(input.selection.visibleNetworkEndpoints.length - 1, 0);
  const description: NetworkAccessDescriptionModel = input.selection.networkAccessible
    ? endpoint
      ? {
          kind: "endpoint",
          prefix: "Reachable at",
          url: endpoint.httpBaseUrl,
          hiddenEndpointCount,
          expandable: hiddenEndpointCount > 0,
          expanded: input.endpointListExpanded,
          toggleLabel:
            hiddenEndpointCount > 0
              ? input.endpointListExpanded
                ? "Hide"
                : `+${hiddenEndpointCount}`
              : null,
        }
      : {
          kind: "text",
          text: state?.endpointUrl
            ? `Reachable at ${state.endpointUrl}`
            : state?.advertisedHost
              ? `Exposed on all interfaces. Pairing links use ${state.advertisedHost}.`
              : "Exposed on all interfaces.",
        }
    : { kind: "text", text: state ? "Limited to this machine." : "Loading…" };
  return {
    kind: "toggle",
    id: setting.id,
    title: setting.title,
    description,
    status: input.serverExposureError,
    switch: {
      checked: state?.mode === "network-accessible",
      disabled: !state || input.isUpdatingServerExposure,
      ariaLabel,
    },
  };
}

export type NetworkExposureMode = DesktopServerExposureState["mode"];

export function resolveNetworkExposureToggle(checked: boolean): NetworkExposureMode {
  return checked ? "network-accessible" : "local-only";
}

export type NetworkExposureConfirmDecision =
  | { readonly kind: "ignore" }
  | { readonly kind: "apply"; readonly mode: NetworkExposureMode };

export function resolveNetworkExposureConfirm(
  pendingMode: NetworkExposureMode | null,
): NetworkExposureConfirmDecision {
  return pendingMode === null ? { kind: "ignore" } : { kind: "apply", mode: pendingMode };
}

export type ConnectionsDialogModel = {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly cancel: ConnectionsButtonModel;
  readonly confirm: ConnectionsBusyButtonModel;
  readonly confirmVariant: ConnectionsButtonVariant;
};

export function buildNetworkExposureDialogModel(input: {
  readonly open: boolean;
  readonly pendingMode: NetworkExposureMode | null;
  readonly isUpdating: boolean;
}): ConnectionsDialogModel {
  const enabling = input.pendingMode === "network-accessible";
  return {
    open: input.open,
    title: enabling ? "Enable network access?" : "Disable network access?",
    description: enabling
      ? "Let your other devices connect to T3 Code over the network. Pair devices to give them access. T3 Code will restart."
      : "Devices connected over your local network will disconnect. Existing tunnels, such as T3 Connect or Tailscale HTTPS, keep working. T3 Code will restart.",
    cancel: { label: "Cancel", disabled: input.isUpdating },
    confirm: {
      label: input.isUpdating
        ? "Restarting…"
        : enabling
          ? "Restart and enable"
          : "Restart and disable",
      busy: input.isUpdating,
      disabled: input.pendingMode === null || input.isUpdating,
    },
    confirmVariant: "default",
  };
}

export type TailscaleRowModel = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly switch: ConnectionsSwitchModel | null;
};

export function buildTailscaleRowModel(input: {
  readonly endpoint: AdvertisedEndpoint | null;
  readonly isUpdating: boolean;
}): TailscaleRowModel {
  const setting = searchableSetting("tailscale-https");
  const { endpoint } = input;
  return {
    id: setting.id,
    title: setting.title,
    description: endpoint
      ? endpoint.status === "available"
        ? endpoint.httpBaseUrl
        : "Use Tailscale Serve to expose this backend through a MagicDNS HTTPS URL."
      : "Start Tailscale to set up HTTPS access through MagicDNS.",
    switch: endpoint
      ? {
          checked: endpoint.status === "available",
          disabled: input.isUpdating,
          ariaLabel: "Enable Tailscale HTTPS",
        }
      : null,
  };
}

export type TailscaleSwitchDecision = "setup" | "disable";

export function resolveTailscaleSwitchChange(checked: boolean): TailscaleSwitchDecision {
  return checked ? "setup" : "disable";
}

export function resolveTailscaleServeStartPortInput(
  serverExposureState: DesktopServerExposureState | null,
): string {
  return String(serverExposureState?.tailscaleServePort ?? DEFAULT_TAILSCALE_SERVE_PORT);
}

export function resolveTailscaleServeDisablePort(
  serverExposureState: DesktopServerExposureState | null,
): number {
  return serverExposureState?.tailscaleServePort ?? DEFAULT_TAILSCALE_SERVE_PORT;
}

export type TailscaleServePortResolution =
  | { readonly kind: "valid"; readonly port: number }
  | { readonly kind: "invalid" };

export function resolveTailscaleServePort(portInput: string): TailscaleServePortResolution {
  const trimmed = portInput.trim();
  const parsed = Number(trimmed);
  return /^\d+$/u.test(trimmed) && Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535
    ? { kind: "valid", port: parsed }
    : { kind: "invalid" };
}

export function resolveTailscaleServeBaseUrl(
  endpoint: AdvertisedEndpoint | null,
  portInput: string,
): string | null {
  if (!endpoint) return null;
  const port = resolveTailscaleServePort(portInput);
  if (port.kind === "invalid") return endpoint.httpBaseUrl;
  if (port.port === DEFAULT_TAILSCALE_SERVE_PORT) {
    return endpoint.httpBaseUrl;
  }
  try {
    const url = new URL(endpoint.httpBaseUrl);
    url.port = String(port.port);
    return url.toString().replace(/\/$/u, "");
  } catch {
    return endpoint.httpBaseUrl;
  }
}

export type TailscaleServeSetupDialogModel = {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly portLabel: string;
  readonly portValue: string;
  readonly portDisabled: boolean;
  readonly validationMessage: string | null;
  readonly endpointLabel: string;
  readonly baseUrl: string | null;
  readonly baseUrlText: string;
  readonly cancel: ConnectionsButtonModel;
  readonly confirm: ConnectionsBusyButtonModel;
};

export function buildTailscaleServeSetupDialogModel(input: {
  readonly pendingEndpoint: AdvertisedEndpoint | null;
  readonly portInput: string;
  readonly isUpdating: boolean;
}): TailscaleServeSetupDialogModel {
  const portValid = resolveTailscaleServePort(input.portInput).kind === "valid";
  const baseUrl = resolveTailscaleServeBaseUrl(input.pendingEndpoint, input.portInput);
  return {
    open: input.pendingEndpoint !== null,
    title: "Set up Tailscale HTTPS?",
    description:
      "T3 Code will restart the local backend with Tailscale Serve enabled and ask Tailscale to proxy HTTPS traffic to this backend.",
    portLabel: "HTTPS port",
    portValue: input.portInput,
    portDisabled: input.isUpdating,
    validationMessage: portValid ? null : "Enter a port from 1 to 65535.",
    endpointLabel: "HTTPS endpoint",
    baseUrl,
    baseUrlText: baseUrl ?? "Pending MagicDNS endpoint",
    cancel: { label: "Cancel", disabled: input.isUpdating },
    confirm: {
      label: input.isUpdating ? "Restarting…" : "Enable",
      busy: input.isUpdating,
      disabled: input.isUpdating || !portValid,
    },
  };
}

export function buildTailscaleServeDisableDialogModel(input: {
  readonly open: boolean;
  readonly isUpdating: boolean;
}): ConnectionsDialogModel {
  return {
    open: input.open,
    title: "Disable Tailscale HTTPS?",
    description: "T3 Code will restart the local backend without Tailscale Serve.",
    cancel: { label: "Cancel", disabled: input.isUpdating },
    confirm: {
      label: input.isUpdating ? "Restarting…" : "Restart and disable",
      busy: input.isUpdating,
      disabled: input.isUpdating,
    },
    confirmVariant: "destructive",
  };
}

export type PendingWslChange =
  | { readonly kind: "disable"; readonly wasWslOnly: boolean }
  | { readonly kind: "distro"; readonly nextDistro: string | null }
  | { readonly kind: "enable"; readonly nextDistro: string | null }
  | { readonly kind: "wsl-only"; readonly nextValue: boolean };

export type WslOperation =
  | { readonly kind: "disable"; readonly clearWslOnly: boolean }
  | { readonly kind: "set-distro"; readonly distro: string | null }
  | { readonly kind: "set-wsl-only"; readonly value: boolean };

export type WslChangeDecision =
  | { readonly kind: "ignore" }
  | { readonly kind: "confirm"; readonly change: PendingWslChange }
  | { readonly kind: "apply"; readonly operation: WslOperation };

export function resolveWslModeSelection(input: {
  readonly value: string;
  readonly state: DesktopWslState;
  readonly hasWslRegistrationToLose: boolean;
}): WslChangeDecision {
  const { value, state, hasWslRegistrationToLose } = input;
  const defaultDistroName = state.distros.find((distro) => distro.isDefault)?.name ?? null;
  if (value === BACKEND_VALUE_WSL_OFF) {
    if (!state.enabled && !state.wslOnly) return { kind: "ignore" };
    const wasWslOnly = state.wslOnly;
    if (hasWslRegistrationToLose || wasWslOnly) {
      return { kind: "confirm", change: { kind: "disable", wasWslOnly } };
    }
    return { kind: "apply", operation: { kind: "disable", clearWslOnly: false } };
  }
  const nextDistro = value === BACKEND_VALUE_DEFAULT_WSL ? null : value;
  const resolvedNext = nextDistro ?? defaultDistroName;
  if (!state.enabled) {
    return { kind: "confirm", change: { kind: "enable", nextDistro } };
  }
  const resolvedCurrent = state.distro ?? defaultDistroName;
  if (resolvedCurrent === resolvedNext) return { kind: "ignore" };
  if (hasWslRegistrationToLose || state.wslOnly) {
    return { kind: "confirm", change: { kind: "distro", nextDistro } };
  }
  return { kind: "apply", operation: { kind: "set-distro", distro: nextDistro } };
}

export function resolveWslOnlyToggle(input: {
  readonly enabled: boolean;
  readonly state: DesktopWslState | null;
}): WslChangeDecision {
  if (!input.state || input.state.wslOnly === input.enabled) return { kind: "ignore" };
  return { kind: "confirm", change: { kind: "wsl-only", nextValue: input.enabled } };
}

export function resolveWslConfirm(pending: PendingWslChange | null): WslChangeDecision {
  if (!pending || pending.kind === "enable") return { kind: "ignore" };
  switch (pending.kind) {
    case "disable":
      return { kind: "apply", operation: { kind: "disable", clearWslOnly: pending.wasWslOnly } };
    case "distro":
      return { kind: "apply", operation: { kind: "set-distro", distro: pending.nextDistro } };
    case "wsl-only":
      return { kind: "apply", operation: { kind: "set-wsl-only", value: pending.nextValue } };
  }
}

export type WslSelectOptionModel = {
  readonly value: string;
  readonly label: string;
};

export type WslSettingsModel =
  | { readonly kind: "hidden" }
  | {
      readonly kind: "load-error";
      readonly id: string;
      readonly title: string;
      readonly description: string;
      readonly error: string | null;
      readonly retry: ConnectionsButtonModel;
    }
  | {
      readonly kind: "unavailable";
      readonly id: string;
      readonly title: string;
      readonly description: string;
      readonly error: string | null;
      readonly switchToWindows: ConnectionsButtonModel;
    }
  | {
      readonly kind: "picker";
      readonly id: string;
      readonly title: string;
      readonly description: string;
      readonly status: string | null;
      readonly select: {
        readonly value: string;
        readonly label: string;
        readonly ariaLabel: string;
        readonly disabled: boolean;
        readonly options: ReadonlyArray<WslSelectOptionModel>;
      };
      readonly wslOnly: {
        readonly title: string;
        readonly description: string;
        readonly switch: ConnectionsSwitchModel;
      } | null;
    };

export type WslSettingsModelInput = {
  readonly state: DesktopWslState | null;
  readonly error: string | null;
  readonly canManageLocalBackend: boolean;
  readonly isLoading: boolean;
  readonly isUpdating: boolean;
};

export function buildWslSettingsModel(input: WslSettingsModelInput): WslSettingsModel {
  const { state, error, isUpdating } = input;
  const setting = searchableSetting("wsl-backend");
  if (!state) {
    if (isWslSettingsRowVisible({ state: null, error }) && input.canManageLocalBackend) {
      return {
        kind: "load-error",
        id: setting.id,
        title: setting.title,
        description: "Couldn't load the WSL backend state.",
        error,
        retry: { label: input.isLoading ? "Retrying…" : "Retry", disabled: input.isLoading },
      };
    }
    return { kind: "hidden" };
  }
  if (!isWslSettingsRowVisible({ state, error })) {
    return { kind: "hidden" };
  }
  if (!state.available) {
    return {
      kind: "unavailable",
      id: setting.id,
      title: setting.title,
      description:
        "WSL is unavailable, so Windows is running instead. Turn WSL off to clear this preference.",
      error,
      switchToWindows: { label: "Switch to Windows", disabled: isUpdating },
    };
  }
  const defaultDistroName = state.distros.find((distro) => distro.isDefault)?.name ?? null;
  const selectValue = !state.enabled
    ? BACKEND_VALUE_WSL_OFF
    : (state.distro ?? defaultDistroName ?? BACKEND_VALUE_DEFAULT_WSL);
  return {
    kind: "picker",
    id: setting.id,
    title: setting.title,
    description:
      "Run the selected WSL distro alongside Windows. Projects remain on their current filesystem.",
    status:
      error ??
      (state.preflightError ? `WSL backend couldn't start: ${state.preflightError}` : null),
    select: {
      value: selectValue,
      label:
        selectValue === BACKEND_VALUE_WSL_OFF
          ? "Off"
          : selectValue === BACKEND_VALUE_DEFAULT_WSL
            ? "Default distro"
            : selectValue,
      ariaLabel: "WSL backend",
      disabled: isUpdating,
      options: [
        { value: BACKEND_VALUE_WSL_OFF, label: "Off" },
        ...(state.distros.length === 0
          ? [{ value: BACKEND_VALUE_DEFAULT_WSL, label: "Default distro" }]
          : state.distros.map((distro) => ({
              value: distro.name,
              label: `${distro.name}${distro.isDefault ? " (default)" : ""}`,
            }))),
      ],
    },
    wslOnly: state.enabled
      ? {
          title: "WSL only",
          description: "Run only the WSL backend. T3 Code restarts when this changes.",
          switch: { checked: state.wslOnly, disabled: isUpdating, ariaLabel: "Run WSL only" },
        }
      : null,
  };
}

export type WslConfirmActionId = "wsl-only" | "both" | "confirm";

export type WslConfirmActionModel = {
  readonly id: WslConfirmActionId;
  readonly label: string;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly variant: ConnectionsButtonVariant;
};

export type WslConfirmDialogModel = {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly cancel: ConnectionsButtonModel;
  readonly actions: ReadonlyArray<WslConfirmActionModel>;
};

export function buildWslConfirmDialogModel(input: {
  readonly pending: PendingWslChange | null;
  readonly isUpdating: boolean;
}): WslConfirmDialogModel {
  const { pending, isUpdating } = input;
  const busyLabel = "Applying…";
  const title =
    pending?.kind === "disable"
      ? pending.wasWslOnly
        ? "Turn off WSL and switch back to Windows?"
        : "Disable WSL backend?"
      : pending?.kind === "distro"
        ? "Switch WSL distro?"
        : pending?.kind === "enable"
          ? "Start the WSL backend"
          : pending?.nextValue
            ? "Run only the WSL backend?"
            : "Re-enable the Windows backend?";
  const description =
    pending?.kind === "disable"
      ? pending.wasWslOnly
        ? "T3 Code will restart on the Windows backend. Threads and projects opened against WSL stay safe inside the distro and become available again when you re-enable WSL."
        : "The WSL backend will stop. Threads and projects opened against WSL stay safe inside the distro, but they'll be unavailable in T3 Code until you re-enable WSL."
      : pending?.kind === "distro"
        ? "T3 Code will restart the WSL backend on the new distro. Sessions still running on the current distro will be interrupted."
        : pending?.kind === "enable"
          ? "Run the WSL backend alongside the Windows one, or stop the Windows backend and use only WSL? You can change this later from Settings."
          : pending?.nextValue
            ? "T3 Code will restart and start only the WSL backend. Your Windows-side projects won't be accessible until you turn this off again."
            : "T3 Code will restart and bring the Windows backend back up alongside WSL.";
  const actions: ReadonlyArray<WslConfirmActionModel> =
    pending?.kind === "enable"
      ? [
          {
            id: "wsl-only",
            label: isUpdating ? busyLabel : "Use only WSL",
            busy: isUpdating,
            disabled: isUpdating,
            variant: "outline",
          },
          {
            id: "both",
            label: isUpdating ? busyLabel : "Run both backends",
            busy: isUpdating,
            disabled: isUpdating,
            variant: "default",
          },
        ]
      : [
          {
            id: "confirm",
            label: isUpdating
              ? busyLabel
              : pending?.kind === "disable"
                ? pending.wasWslOnly
                  ? "Switch to Windows"
                  : "Disable WSL"
                : pending?.kind === "distro"
                  ? "Switch distro"
                  : pending?.nextValue
                    ? "Restart and enable"
                    : "Restart and disable",
            busy: isUpdating,
            disabled: isUpdating,
            variant:
              pending?.kind === "disable" || (pending?.kind === "wsl-only" && pending.nextValue)
                ? "destructive"
                : "default",
          },
        ];
  return {
    open: pending !== null,
    title,
    description,
    cancel: { label: "Cancel", disabled: isUpdating },
    actions,
  };
}

export function resolveHasWslRegistrationToLose(
  environments: ReadonlyArray<EnvironmentPresentation>,
): boolean {
  return environments.some((environment) =>
    isDesktopLocalConnectionTarget(environment.entry.target),
  );
}

export type CloudLinkSwitchModel = ConnectionsSwitchModel & {
  readonly disabledReason: string | null;
};

export type CloudLinkRowModel = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: string | null;
  readonly switch: CloudLinkSwitchModel;
};

export type CloudLinkModel = {
  readonly managedTunnel: CloudLinkRowModel | null;
  readonly publishAgentActivity: CloudLinkRowModel;
};

export type CloudLinkModelInput = {
  readonly isDesktop: boolean;
  readonly canManageRelay: boolean;
  readonly isSignedIn: boolean;
  readonly isPending: boolean;
  readonly isUpdatingTunnel: boolean;
  readonly isUpdatingPreference: boolean;
  readonly managedTunnelActive: boolean;
  readonly publishAgentActivity: boolean;
  readonly operationError: string | null;
  readonly linkError: string | null;
};

export function buildCloudLinkModel(input: CloudLinkModelInput): CloudLinkModel {
  const disabledReason = !input.isSignedIn
    ? "Sign in to T3 Connect to manage this environment."
    : !input.canManageRelay
      ? "Your session does not have permission to manage T3 Connect access."
      : null;
  const disabled =
    !input.canManageRelay ||
    !input.isSignedIn ||
    input.isPending ||
    input.isUpdatingTunnel ||
    input.isUpdatingPreference;
  const tunnelSetting = searchableSetting("t3-connect");
  const publishSetting = searchableSetting("publish-agent-activity");
  return {
    managedTunnel: input.isDesktop
      ? {
          id: tunnelSetting.id,
          title: tunnelSetting.title,
          description: input.managedTunnelActive
            ? "This environment is available to your other devices through T3 Connect."
            : "Make this environment available to your other devices through T3 Connect.",
          status: input.operationError ?? input.linkError,
          switch: {
            checked: input.managedTunnelActive,
            disabled,
            disabledReason,
            ariaLabel: "Enable T3 Connect",
          },
        }
      : null,
    publishAgentActivity: {
      id: publishSetting.id,
      title: publishSetting.title,
      description: "Send activity to mobile notifications and Live Activities without T3 Connect.",
      status: null,
      switch: {
        checked: input.publishAgentActivity,
        disabled,
        disabledReason,
        ariaLabel: "Publish agent activity to mobile clients",
      },
    },
  };
}

export function resolveManagedTunnelToast(input: {
  readonly enabled: boolean;
  readonly publishAgentActivity: boolean;
}): ConnectionsToast {
  return {
    title: input.enabled
      ? "T3 Connect linked"
      : input.publishAgentActivity
        ? "T3 Connect tunnel disabled"
        : "T3 Connect unlinked",
    description: input.enabled
      ? "This environment is available through T3 Connect."
      : input.publishAgentActivity
        ? "The managed tunnel was removed. Agent activity publishing stays on."
        : "This environment is no longer available through T3 Connect.",
  };
}

export function resolvePublishAgentActivityToast(enabled: boolean): ConnectionsToast {
  return {
    title: enabled ? "Agent activity enabled" : "Agent activity disabled",
    description: enabled
      ? "This environment publishes agent activity to your mobile clients."
      : "This environment will stop publishing agent activity.",
  };
}

export type SavedBackendUpdateActionModel = {
  readonly label: string;
  readonly serverLabel: string;
  readonly targetVersion: string;
  readonly selfUpdate: ServerSelfUpdateCapability | null;
  readonly desktopAppUpdate: boolean;
  readonly threadContinuation: boolean;
};

export type SavedBackendRowModel = {
  readonly id: EnvironmentId;
  readonly label: string;
  readonly machineKind: EnvironmentMachineKind;
  readonly dimmed: boolean;
  readonly subtitle: string;
  readonly subtitleTone: SavedBackendStatusTone;
  readonly statusTooltip: string;
  readonly showUpdateProgress: boolean;
  readonly update: SavedBackendUpdateActionModel | null;
  readonly toggle: ConnectionsSwitchModel & { readonly tooltip: string };
  readonly menu: {
    readonly ariaLabel: string;
    readonly disabled: boolean;
    readonly copyTraceId: { readonly label: string; readonly traceId: string } | null;
    readonly removeLabel: string;
  };
};

export type SavedBackendRowModelInput = {
  readonly environment: EnvironmentPresentation;
  readonly removingEnvironmentId: EnvironmentId | null;
  readonly serverUpdateState: ServerUpdateState;
  readonly updateFacts: ServerUpdateFacts;
  readonly discoveredDescriptor: ExecutionEnvironmentDescriptor | undefined;
};

export function resolveEnvironmentRowMachineKind(
  serverConfig: ServerConfig | null,
  descriptor: ExecutionEnvironmentDescriptor | undefined,
): EnvironmentMachineKind {
  return resolveEnvironmentMachineKind(
    serverConfig ?? (descriptor === undefined ? null : { environment: descriptor }),
  );
}

export function buildSavedBackendRowModel(input: SavedBackendRowModelInput): SavedBackendRowModel {
  const { environment, serverUpdateState, updateFacts } = input;
  const unsupported = environment.connection.phase === "unsupported";
  const enabled = environment.entry.enabled && !unsupported;
  const isConnected = environment.connection.phase === "connected";
  const isRemoving = input.removingEnvironmentId === environment.environmentId;
  const versionMismatch = updateFacts.versionMismatch;
  const resumingServerUpdate =
    serverUpdateState.status === "running" && serverUpdateState.stage === "resuming";
  const status = savedBackendStatus(environment);
  const serverVersion = environment.serverConfig?.environment.serverVersion ?? null;
  const showUpdateAction =
    enabled &&
    isConnected &&
    versionMismatch !== null &&
    (serverUpdateState.status === "idle" || serverUpdateState.status === "failed");
  const errorTraceId = environment.connection.traceId;
  return {
    id: environment.environmentId,
    label: environment.label,
    machineKind: resolveEnvironmentRowMachineKind(
      environment.serverConfig,
      input.discoveredDescriptor,
    ),
    dimmed: !enabled,
    subtitle: [
      environmentTransportLabel(environment),
      resumingServerUpdate ? "Restarting" : status.text,
      enabled && versionMismatch ? serverVersion : null,
    ]
      .filter((value): value is string => value !== null)
      .join(" · "),
    subtitleTone: enabled && status.tone === "error" && !resumingServerUpdate ? "error" : "muted",
    statusTooltip: `${
      unsupported
        ? (environment.connection.error ?? connectionStatusText(environment.connection))
        : enabled
          ? connectionStatusText(environment.connection)
          : "Switched off"
    }${
      versionMismatch
        ? `\nUpdate available: ${versionMismatch.serverVersion} → ${versionMismatch.clientVersion}`
        : ""
    }`,
    showUpdateProgress: serverUpdateState.status !== "idle",
    update:
      showUpdateAction && versionMismatch
        ? {
            label: serverUpdateState.status === "failed" ? "Retry update" : "Update",
            serverLabel: `${environment.label} server`,
            targetVersion: versionMismatch.clientVersion,
            selfUpdate: updateFacts.selfUpdate,
            desktopAppUpdate: updateFacts.desktopAppUpdate,
            threadContinuation: updateFacts.threadContinuation,
          }
        : null,
    toggle: {
      checked: enabled,
      disabled: isRemoving || unsupported,
      ariaLabel: `${enabled ? "Switch off" : "Switch on"} ${environment.label}`,
      tooltip: unsupported ? "Client not supported" : enabled ? "Switch off" : "Switch on",
    },
    menu: {
      ariaLabel: `More actions for ${environment.label}`,
      disabled: isRemoving,
      copyTraceId: errorTraceId ? { label: "Copy trace ID", traceId: errorTraceId } : null,
      removeLabel: isRemoving ? "Removing…" : "Remove from this device…",
    },
  };
}

export function resolveTraceIdCopyToast(traceId: string): ConnectionsToast {
  return { title: "Trace ID copied", description: traceId };
}

export type SavedServerUpdateState = {
  readonly environment: EnvironmentPresentation;
  readonly updateStatus: ServerUpdateState["status"];
  readonly updateFacts: ServerUpdateFacts;
};

export type SavedServerUpdateTarget = {
  readonly environmentId: EnvironmentId;
  readonly serverLabel: string;
  readonly selfUpdate: ServerSelfUpdateCapability;
  readonly desktopAppUpdate: boolean;
  readonly threadContinuation: boolean;
  readonly continueThreadsAfterServerUpdate: boolean;
  readonly targetVersion: string;
};

export function resolveSavedServerUpdateTargets(
  states: ReadonlyArray<SavedServerUpdateState>,
): ReadonlyArray<SavedServerUpdateTarget> {
  return states.flatMap(({ environment, updateStatus, updateFacts }) => {
    const mismatch = updateFacts.versionMismatch;
    const selfUpdate = updateFacts.selfUpdate;
    const desktopAppUpdate = updateFacts.desktopAppUpdate;
    if (
      !mismatch ||
      updateStatus === "running" ||
      !environment.entry.enabled ||
      environment.connection.phase !== "connected" ||
      isDesktopLocalConnectionTarget(environment.entry.target) ||
      selfUpdate === null ||
      (selfUpdate === "desktop-managed" && !desktopAppUpdate)
    ) {
      return [];
    }
    return [
      {
        environmentId: environment.environmentId,
        serverLabel: environment.label,
        selfUpdate,
        desktopAppUpdate,
        threadContinuation: updateFacts.threadContinuation,
        continueThreadsAfterServerUpdate:
          environment.serverConfig?.settings.continueThreadsAfterServerUpdate ?? false,
        targetVersion: mismatch.clientVersion,
      },
    ];
  });
}

export function resolveSavedEnvironments(
  environments: ReadonlyArray<EnvironmentPresentation>,
): ReadonlyArray<EnvironmentPresentation> {
  return environments.filter(
    (environment) => environment.entry.target._tag !== "PrimaryConnectionTarget",
  );
}

export function resolveListedEnvironments(
  savedEnvironments: ReadonlyArray<EnvironmentPresentation>,
): ReadonlyArray<EnvironmentPresentation> {
  return savedEnvironments.filter(
    (environment) => !isDesktopLocalConnectionTarget(environment.entry.target),
  );
}

export function resolveLoadBalancingEnvironments(
  primaryEnvironment: EnvironmentPresentation | null,
  savedEnvironments: ReadonlyArray<EnvironmentPresentation>,
): ReadonlyArray<EnvironmentPresentation> {
  return [
    ...(primaryEnvironment ? [primaryEnvironment] : []),
    ...savedEnvironments.filter((environment) => environment.entry.enabled),
  ];
}

export function resolveUnsavedDiscoveredSshHosts(
  discoveredHosts: ReadonlyArray<DesktopDiscoveredSshHost>,
  savedEnvironments: ReadonlyArray<EnvironmentPresentation>,
): ReadonlyArray<DesktopDiscoveredSshHost> {
  const keys = new Set<string>();
  for (const environment of savedEnvironments) {
    const profile = environment.entry.profile;
    if (
      environment.entry.target._tag !== "SshConnectionTarget" ||
      Option.isNone(profile) ||
      profile.value._tag !== "SshConnectionProfile"
    ) {
      continue;
    }
    const target = profile.value.target;
    keys.add(target.alias);
    keys.add(formatDesktopSshTarget(target));
  }
  return discoveredHosts.filter(
    (target) => !keys.has(target.alias) && !keys.has(formatDesktopSshTarget(target)),
  );
}

export type SshHostSuggestionItemModel = {
  readonly key: string;
  readonly alias: string;
  readonly address: string | null;
  readonly shortcutLabel: string | null;
};

export type SshHostSuggestionsModel = {
  readonly hasContent: boolean;
  readonly state: "loading" | "list" | "empty";
  readonly loadingLabel: string;
  readonly emptyLabel: string;
  readonly items: ReadonlyArray<SshHostSuggestionItemModel>;
};

export type SshHostSuggestionsModelInput = {
  readonly isDesktop: boolean;
  readonly isLoading: boolean;
  readonly unsavedHosts: ReadonlyArray<DesktopDiscoveredSshHost>;
  readonly query: string;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly platform: string;
};

export function buildSshHostSuggestionsModel(
  input: SshHostSuggestionsModelInput,
): SshHostSuggestionsModel {
  const filteredHosts = filterDiscoveredSshHosts(input.unsavedHosts, input.query);
  return {
    hasContent: input.isDesktop && (input.isLoading || input.unsavedHosts.length > 0),
    state: input.isLoading ? "loading" : filteredHosts.length > 0 ? "list" : "empty",
    loadingLabel: "Loading hosts…",
    emptyLabel: `No hosts match "${input.query.trim()}".`,
    items: filteredHosts.map((target, index) => {
      const address = formatDesktopSshTarget(target);
      const shortcutCommand = index < 9 ? threadJumpCommandForIndex(index) : null;
      return {
        key: `${target.alias}:${target.hostname}:${target.port ?? ""}`,
        alias: target.alias,
        address: address !== target.alias ? address : null,
        shortcutLabel: shortcutCommand
          ? shortcutLabelForCommand(input.keybindings, shortcutCommand, input.platform)
          : null,
      };
    }),
  };
}

export function resolveSshHostShortcutTarget(
  command: string | null,
  filteredHosts: ReadonlyArray<DesktopDiscoveredSshHost>,
): DesktopDiscoveredSshHost | null {
  const index = threadJumpIndexFromCommand(command ?? "");
  return index === null ? null : (filteredHosts[index] ?? null);
}

export type SavedBackendMode = "remote" | "ssh";

export type SavedBackendHostInputDecision =
  | { readonly kind: "pairing-url"; readonly host: string; readonly pairingCode: string }
  | { readonly kind: "host"; readonly host: string };

export function resolveSavedBackendHostInput(
  value: string,
  baseOrigin: string,
): SavedBackendHostInputDecision {
  const parsed = parsePairingUrlFields(value, baseOrigin);
  return parsed
    ? { kind: "pairing-url", host: parsed.host, pairingCode: parsed.pairingCode }
    : { kind: "host", host: value };
}

export type AddSavedBackendInput = {
  readonly mode: SavedBackendMode;
  readonly host: string;
  readonly pairingCode: string;
  readonly sshHost: string;
  readonly sshUsername: string;
  readonly sshPort: string;
  readonly baseOrigin: string;
};

export type AddSavedBackendDecision =
  | { readonly kind: "ssh-invalid"; readonly message: string }
  | { readonly kind: "connect-ssh"; readonly target: DesktopSshEnvironmentTarget }
  | { readonly kind: "remote-invalid"; readonly message: string }
  | { readonly kind: "connect-pairing"; readonly host: string; readonly pairingCode: string };

export function resolveAddSavedBackend(input: AddSavedBackendInput): AddSavedBackendDecision {
  if (input.mode === "ssh") {
    const target = resolveManualDesktopSshTarget({
      host: input.sshHost,
      username: input.sshUsername,
      port: input.sshPort,
    });
    return target.kind === "invalid"
      ? { kind: "ssh-invalid", message: target.message }
      : { kind: "connect-ssh", target: target.target };
  }
  const remote = resolveRemotePairingFields({
    host: input.host,
    pairingCode: input.pairingCode,
    baseOrigin: input.baseOrigin,
  });
  return remote.kind === "invalid"
    ? { kind: "remote-invalid", message: remote.message }
    : { kind: "connect-pairing", ...remote.fields };
}

export function resolveSshConnectedToast(alias: string): ConnectionsToast {
  return {
    title: "Environment connected",
    description: `${alias} is ready over an SSH-managed tunnel.`,
  };
}

export const BACKEND_ADDED_TOAST: ConnectionsToast = {
  title: "Backend added",
  description: "The environment is saved and will reconnect on app startup.",
};

export type SavedBackendRemoveDecision =
  | { readonly kind: "t3-connect-dialog" }
  | { readonly kind: "confirm"; readonly message: string };

export function resolveRemoveSavedBackend(input: {
  readonly environment: EnvironmentPresentation;
  readonly cloudEnabled: boolean;
}): SavedBackendRemoveDecision {
  if (input.environment.relayManaged && input.cloudEnabled) {
    return { kind: "t3-connect-dialog" };
  }
  return {
    kind: "confirm",
    message: `Remove ${input.environment.label} from this device?\nThis forgets its pairing, credentials, and cached threads here. Switch it off instead to keep it saved.`,
  };
}

export type ConnectionsFailureAction =
  | { readonly kind: "network-exposure" }
  | { readonly kind: "tailscale-setup" }
  | { readonly kind: "tailscale-disable" }
  | { readonly kind: "revoke-pairing-link" }
  | { readonly kind: "revoke-client" }
  | { readonly kind: "revoke-other-clients" }
  | { readonly kind: "create-pairing-link" }
  | { readonly kind: "add-backend" }
  | { readonly kind: "remove-backend" }
  | { readonly kind: "set-backend-enabled"; readonly enabled: boolean }
  | { readonly kind: "wsl" }
  | { readonly kind: "copy-trace-id" };

export type ConnectionsFailure = {
  readonly title: string;
  readonly message: string;
};

function failureCopy(action: ConnectionsFailureAction): {
  readonly title: string;
  readonly fallback: string;
} {
  switch (action.kind) {
    case "network-exposure":
      return {
        title: "Could not update network access",
        fallback: "Failed to update network exposure.",
      };
    case "tailscale-setup":
      return {
        title: "Could not set up Tailscale HTTPS",
        fallback: "Failed to configure Tailscale HTTPS.",
      };
    case "tailscale-disable":
      return {
        title: "Could not disable Tailscale HTTPS",
        fallback: "Failed to disable Tailscale HTTPS.",
      };
    case "revoke-pairing-link":
      return { title: "Could not revoke pairing link", fallback: "Failed to revoke pairing link." };
    case "revoke-client":
      return {
        title: "Could not revoke client access",
        fallback: "Failed to revoke client access.",
      };
    case "revoke-other-clients":
      return {
        title: "Could not revoke other clients",
        fallback: "Failed to revoke other clients.",
      };
    case "create-pairing-link":
      return { title: "Could not create pairing URL", fallback: "Failed to create pairing URL." };
    case "add-backend":
      return { title: "Could not add backend", fallback: "Failed to add backend." };
    case "remove-backend":
      return { title: "Could not remove backend", fallback: "Failed to remove backend." };
    case "set-backend-enabled":
      return {
        title: `Could not switch backend ${action.enabled ? "on" : "off"}`,
        fallback: `Failed to switch the backend ${action.enabled ? "on" : "off"}.`,
      };
    case "wsl":
      return { title: "Could not change WSL backend", fallback: "Failed to update WSL backend." };
    case "copy-trace-id":
      return { title: "Could not copy trace ID", fallback: "Failed to copy trace ID." };
  }
}

export function resolveConnectionsFailureTitle(action: ConnectionsFailureAction): string {
  return failureCopy(action).title;
}

export function resolveConnectionsFailure(
  action: ConnectionsFailureAction,
  error: unknown,
): ConnectionsFailure {
  const copy = failureCopy(action);
  return {
    title: copy.title,
    message: error instanceof Error ? error.message : copy.fallback,
  };
}

export type ConnectionModeCardModel = {
  readonly mode: SavedBackendMode;
  readonly title: string;
  readonly description: string;
  readonly icon: "chevrons-left-right-ellipsis" | "terminal";
  readonly selected: boolean;
  readonly disabled: boolean;
};

export type AddEnvironmentDialogModel = {
  readonly triggerLabel: string;
  readonly title: string;
  readonly description: string;
  readonly mode: SavedBackendMode;
  readonly modeCards: ReadonlyArray<ConnectionModeCardModel>;
  readonly remote: {
    readonly hostLabel: string;
    readonly hostPlaceholder: string;
    readonly hostValue: string;
    readonly pairingCodeLabel: string;
    readonly pairingCodePlaceholder: string;
    readonly pairingCodeValue: string;
    readonly hint: string;
    readonly error: string | null;
  };
  readonly ssh: {
    readonly hostLabel: string;
    readonly hostPlaceholder: string;
    readonly hostValue: string;
    readonly usernameLabel: string;
    readonly usernamePlaceholder: string;
    readonly usernameValue: string;
    readonly portLabel: string;
    readonly portPlaceholder: string;
    readonly portValue: string;
    readonly suggestions: SshHostSuggestionsModel;
    readonly error: string | null;
  };
  readonly fieldsDisabled: boolean;
  readonly submit: ConnectionsButtonModel;
};

export type AddEnvironmentDialogModelInput = {
  readonly isDesktop: boolean;
  readonly mode: SavedBackendMode;
  readonly isAdding: boolean;
  readonly error: string | null;
  readonly host: string;
  readonly pairingCode: string;
  readonly sshHost: string;
  readonly sshUsername: string;
  readonly sshPort: string;
  readonly discoveredHostsError: string | null;
  readonly isLoadingDiscoveredHosts: boolean;
  readonly unsavedDiscoveredHosts: ReadonlyArray<DesktopDiscoveredSshHost>;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly platform: string;
};

export function buildAddEnvironmentDialogModel(
  input: AddEnvironmentDialogModelInput,
): AddEnvironmentDialogModel {
  const modeCards: Array<ConnectionModeCardModel> = [
    {
      mode: "remote",
      title: "Remote link",
      description: "Enter a backend host and pairing code.",
      icon: "chevrons-left-right-ellipsis",
      selected: input.mode === "remote",
      disabled: input.isAdding,
    },
  ];
  if (input.isDesktop) {
    modeCards.push({
      mode: "ssh",
      title: "SSH",
      description: "Use local SSH config, agent, and tunnels for the backend.",
      icon: "terminal",
      selected: input.mode === "ssh",
      disabled: input.isAdding,
    });
  }
  return {
    triggerLabel: "Add environment",
    title: "Add Environment",
    description: "Pair another environment to this client.",
    mode: input.mode,
    modeCards,
    remote: {
      hostLabel: "Host",
      hostPlaceholder: "backend.example.com",
      hostValue: input.host,
      pairingCodeLabel: "Pairing code",
      pairingCodePlaceholder: "PAIRCODE",
      pairingCodeValue: input.pairingCode,
      hint: "Paste a full pairing URL here to fill both fields automatically.",
      error: input.error,
    },
    ssh: {
      hostLabel: "SSH host or alias",
      hostPlaceholder: "Search hosts or type devbox",
      hostValue: input.sshHost,
      usernameLabel: "Username",
      usernamePlaceholder: "root",
      usernameValue: input.sshUsername,
      portLabel: "Port",
      portPlaceholder: "22",
      portValue: input.sshPort,
      suggestions: buildSshHostSuggestionsModel({
        isDesktop: input.isDesktop,
        isLoading: input.isLoadingDiscoveredHosts,
        unsavedHosts: input.unsavedDiscoveredHosts,
        query: input.sshHost,
        keybindings: input.keybindings,
        platform: input.platform,
      }),
      error:
        input.error || input.discoveredHostsError
          ? (input.error ?? input.discoveredHostsError)
          : null,
    },
    fieldsDisabled: input.isAdding,
    submit: {
      label: input.isAdding ? "Adding…" : "Add environment",
      disabled: input.isAdding,
    },
  };
}

export type RemoteEnvironmentsEmptyStateModel = {
  readonly icon: "chevrons-left-right-ellipsis";
  readonly title: string;
  readonly description: string;
};

export function buildRemoteEnvironmentsEmptyStateModel(
  cloudEnabled: boolean,
): RemoteEnvironmentsEmptyStateModel {
  return {
    icon: "chevrons-left-right-ellipsis",
    title: "No saved remote environments",
    description: cloudEnabled
      ? "Click “Add environment” to pair another environment, or connect one from T3 Connect."
      : "Click “Add environment” to pair another environment.",
  };
}

export type RemoteEnvironmentsEmptyMode = "cloud-rows" | "empty" | "none";

export function resolveRemoteEnvironmentsEmptyMode(input: {
  readonly cloudEnabled: boolean;
  readonly savedEnvironmentCount: number;
}): RemoteEnvironmentsEmptyMode {
  return input.cloudEnabled ? "cloud-rows" : input.savedEnvironmentCount === 0 ? "empty" : "none";
}

export type ConnectionsAccess = {
  readonly sessionScopes: ReadonlyArray<AuthEnvironmentScope> | null;
  readonly authPolicy: ServerAuthPolicy | null;
  readonly canManageLocalBackend: boolean;
  readonly canManageRelay: boolean;
};

export type ConnectionsAccessInput = {
  readonly isDesktop: boolean;
  readonly localEnvironmentDisabled: boolean;
  readonly sessionAuthenticated: boolean;
  readonly sessionScopes: ReadonlyArray<AuthEnvironmentScope> | null;
  readonly sessionAuthPolicy: ServerAuthPolicy | null;
};

export function resolveConnectionsAccess(input: ConnectionsAccessInput): ConnectionsAccess {
  const sessionScopes = input.isDesktop
    ? AuthAdministrativeScopes
    : input.sessionAuthenticated
      ? input.sessionScopes
      : null;
  return {
    sessionScopes,
    authPolicy: input.isDesktop ? null : input.sessionAuthPolicy,
    canManageLocalBackend:
      !input.localEnvironmentDisabled && (sessionScopes?.includes(AuthAccessWriteScope) ?? false),
    canManageRelay: sessionScopes?.includes(AuthRelayWriteScope) ?? false,
  };
}

export type VersionRowModel = {
  readonly title: string;
  readonly description:
    | { readonly kind: "progress" }
    | { readonly kind: "text"; readonly text: string };
  readonly control:
    | ({ readonly kind: "update" } & SavedBackendUpdateActionModel)
    | { readonly kind: "up-to-date"; readonly text: string }
    | null;
};

export type VersionRowModelInput = {
  readonly environment: EnvironmentPresentation | null;
  readonly updateState: ServerUpdateState;
  readonly updateFacts: ServerUpdateFacts;
};

export function buildVersionRowModel(input: VersionRowModelInput): VersionRowModel {
  const { environment, updateState, updateFacts } = input;
  const serverConfig = environment?.serverConfig ?? null;
  const mismatch = updateFacts.versionMismatch;
  return {
    title: "Version",
    description:
      updateState.status !== "idle"
        ? { kind: "progress" }
        : {
            kind: "text",
            text:
              [serverConfig?.environment.serverVersion ?? null, environment?.displayUrl ?? null]
                .filter((value): value is string => value !== null)
                .join(" · ") || "Loading…",
          },
    control:
      mismatch && environment !== null && updateState.status !== "running"
        ? {
            kind: "update",
            label:
              updateState.status === "failed"
                ? "Retry update"
                : `Update to ${mismatch.clientVersion}`,
            serverLabel: `${environment.label} server`,
            targetVersion: mismatch.clientVersion,
            selfUpdate: updateFacts.selfUpdate,
            desktopAppUpdate: updateFacts.desktopAppUpdate,
            threadContinuation: updateFacts.threadContinuation,
          }
        : updateState.status === "idle" && serverConfig
          ? { kind: "up-to-date", text: "Up to date" }
          : null,
  };
}

export type PrimaryEnvironmentHeaderModel = {
  readonly id: string;
  readonly title: string;
  readonly iconKind: EnvironmentMachineKind;
  readonly menuAriaLabel: string | null;
};

export function buildPrimaryEnvironmentHeaderModel(input: {
  readonly isDesktop: boolean;
  readonly environment: EnvironmentPresentation | null;
}): PrimaryEnvironmentHeaderModel {
  const serverConfig = input.environment?.serverConfig ?? null;
  return {
    id: CONNECTIONS_ENVIRONMENT_SETTING.id,
    title: input.environment?.label ?? (input.isDesktop ? "This machine" : "Primary environment"),
    iconKind: serverConfig ? resolveEnvironmentMachineKind(serverConfig) : "desktop",
    menuAriaLabel: input.environment !== null ? "More actions for this machine" : null,
  };
}

export const CONNECTIONS_ENVIRONMENT_SETTING = searchableSetting("connections-environment");

export const REMOTE_ENVIRONMENTS_SETTING = searchableSetting("remote-environments");

export const ADMINISTRATIVE_ACCESS_ROW = {
  title: "Administrative access",
  description:
    "Pairing links and client-session management require the access:write scope for this backend.",
} as const;

export type AuthorizedClientsModel = {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly error: string | null;
  readonly emptyMessage: string | null;
  readonly header: AuthorizedClientsHeaderModel;
  readonly pairingLinks: ReadonlyArray<PairingLinkRowModel>;
  readonly clientSessions: ReadonlyArray<ClientSessionRowModel>;
};

export type PairingLinkRowUiState = {
  readonly qrEndpointId: string | null;
  readonly failedCopyValue: string | null;
  readonly isQrPanelOpen: boolean;
};

export type AuthorizedClientsModelInput = {
  readonly pairingLinks: ReadonlyArray<ServerPairingLinkRecord>;
  readonly clientSessions: ReadonlyArray<ServerClientSessionRecord>;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly isRevokingOtherClients: boolean;
  readonly revokingPairingLinkId: string | null;
  readonly revokingClientSessionId: string | null;
  readonly createdPairingCredentials: Readonly<Record<string, string>>;
  readonly pairingLinkUi: Readonly<Record<string, PairingLinkRowUiState>>;
  readonly endpointUrl: string | null | undefined;
  readonly selection: ConnectionsEndpointSelection;
  readonly nowMs: number;
  readonly currentHref: string;
  readonly canCopyToClipboard: boolean;
};

export function resolveAuthorizedClientsEmptyMessage(input: {
  readonly pairingLinkCount: number;
  readonly clientSessionCount: number;
  readonly isLoading: boolean;
}): string | null {
  return input.pairingLinkCount === 0 && input.clientSessionCount === 0 && !input.isLoading
    ? "No pairing links or client sessions."
    : null;
}

export function buildAuthorizedClientsModel(
  input: AuthorizedClientsModelInput,
): AuthorizedClientsModel {
  const pairingLinks = sortDesktopPairingLinks(input.pairingLinks);
  const clientSessions = sortDesktopClientSessions(input.clientSessions);
  return {
    id: "authorized-clients",
    title: "Authorized clients",
    summary: summarizeAuthorizedClients(clientSessions, pairingLinks),
    error: input.error,
    emptyMessage: resolveAuthorizedClientsEmptyMessage({
      pairingLinkCount: pairingLinks.length,
      clientSessionCount: clientSessions.length,
      isLoading: input.isLoading,
    }),
    header: buildAuthorizedClientsHeaderModel({
      clientSessions,
      isRevokingOtherClients: input.isRevokingOtherClients,
    }),
    pairingLinks: pairingLinks
      .map((pairingLink) => {
        const ui = input.pairingLinkUi[pairingLink.id];
        return buildPairingLinkRowModel({
          pairingLink,
          credential: input.createdPairingCredentials[pairingLink.id],
          endpointUrl: input.endpointUrl,
          endpoints: input.selection.visibleEndpoints,
          defaultEndpointKey: input.selection.defaultEndpointKey,
          revokingPairingLinkId: input.revokingPairingLinkId,
          nowMs: input.nowMs,
          currentHref: input.currentHref,
          canCopyToClipboard: input.canCopyToClipboard,
          qrEndpointId: ui?.qrEndpointId ?? null,
          failedCopyValue: ui?.failedCopyValue ?? null,
          isQrPanelOpen: ui?.isQrPanelOpen ?? false,
        });
      })
      .filter((row) => !row.expired),
    clientSessions: clientSessions.map((clientSession) =>
      buildClientSessionRowModel({
        clientSession,
        revokingClientSessionId: input.revokingClientSessionId,
        nowMs: input.nowMs,
      }),
    ),
  };
}

export type ConnectionsPrimarySectionModel =
  | {
      readonly kind: "managed";
      readonly header: PrimaryEnvironmentHeaderModel;
      readonly version: VersionRowModel | null;
      readonly networkAccess: NetworkAccessRowModel | null;
      readonly endpointRows: ReadonlyArray<AdvertisedEndpointRowModel>;
      readonly tailscale: TailscaleRowModel | null;
      readonly wsl: WslSettingsModel | null;
      readonly cloudLink: CloudLinkModel | null;
      readonly authorizedClients: AuthorizedClientsModel | null;
      readonly createPairingLinkDialog: CreatePairingLinkDialogModel;
      readonly networkExposureDialog: ConnectionsDialogModel;
      readonly wslConfirmDialog: WslConfirmDialogModel;
      readonly tailscaleDisableDialog: ConnectionsDialogModel;
      readonly tailscaleSetupDialog: TailscaleServeSetupDialogModel;
    }
  | {
      readonly kind: "restricted";
      readonly id: string;
      readonly title: string;
      readonly administrativeAccess: { readonly title: string; readonly description: string };
      readonly cloudLink: CloudLinkModel | null;
    };

export type RemoteEnvironmentsSectionModel = {
  readonly id: string;
  readonly title: string;
  readonly updateTargets: ReadonlyArray<SavedServerUpdateTarget>;
  readonly addEnvironmentDialog: AddEnvironmentDialogModel;
  readonly rows: ReadonlyArray<SavedBackendRowModel>;
  readonly emptyMode: RemoteEnvironmentsEmptyMode;
  readonly emptyState: RemoteEnvironmentsEmptyStateModel;
};

export const REMOTE_ENVIRONMENTS_TITLE = "Environments";

export type ConnectionsSettingsModel = {
  readonly primary: ConnectionsPrimarySectionModel;
  readonly remoteEnvironments: RemoteEnvironmentsSectionModel;
  readonly loadBalancingEnvironmentIds: ReadonlyArray<EnvironmentId>;
};

export type SavedEnvironmentInput = {
  readonly environment: EnvironmentPresentation;
  readonly serverUpdateState: ServerUpdateState;
  readonly updateFacts: ServerUpdateFacts;
  readonly discoveredDescriptor: ExecutionEnvironmentDescriptor | undefined;
};

export type ConnectionsSettingsModelInput = {
  readonly isDesktop: boolean;
  readonly cloudEnabled: boolean;
  readonly currentHref: string;
  readonly canCopyToClipboard: boolean;
  readonly nowMs: number;
  readonly platform: string;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly access: ConnectionsAccess;
  readonly primaryEnvironment: EnvironmentPresentation | null;
  readonly primaryUpdateState: ServerUpdateState;
  readonly primaryUpdateFacts: ServerUpdateFacts;
  readonly environments: ReadonlyArray<EnvironmentPresentation>;
  readonly savedEnvironmentStates: ReadonlyArray<SavedEnvironmentInput>;
  readonly serverExposureState: DesktopServerExposureState | null;
  readonly serverExposureError: string | null;
  readonly advertisedEndpoints: ReadonlyArray<AdvertisedEndpoint>;
  readonly savedDefaultEndpointKey: string | null;
  readonly endpointListExpanded: boolean;
  readonly isUpdatingServerExposure: boolean;
  readonly networkExposureDialogOpen: boolean;
  readonly pendingNetworkExposureMode: NetworkExposureMode | null;
  readonly isUpdatingTailscaleServe: boolean;
  readonly pendingTailscaleServeEndpoint: AdvertisedEndpoint | null;
  readonly tailscaleServePortInput: string;
  readonly tailscaleDisableDialogOpen: boolean;
  readonly wslState: DesktopWslState | null;
  readonly wslError: string | null;
  readonly isLoadingWslState: boolean;
  readonly isUpdatingWslBackend: boolean;
  readonly pendingWslChange: PendingWslChange | null;
  readonly cloudLink: Omit<CloudLinkModelInput, "isDesktop" | "canManageRelay">;
  readonly accessManagement: Omit<
    AuthorizedClientsModelInput,
    "endpointUrl" | "selection" | "nowMs" | "currentHref" | "canCopyToClipboard"
  >;
  readonly createPairingLink: CreatePairingLinkDialogModelInput;
  readonly addEnvironment: Omit<
    AddEnvironmentDialogModelInput,
    "isDesktop" | "unsavedDiscoveredHosts" | "keybindings" | "platform"
  > & { readonly discoveredHosts: ReadonlyArray<DesktopDiscoveredSshHost> };
  readonly removingEnvironmentId: EnvironmentId | null;
};

export function buildConnectionsSettingsModel(
  input: ConnectionsSettingsModelInput,
): ConnectionsSettingsModel {
  const { access, isDesktop } = input;
  const cloudLink = input.cloudEnabled
    ? buildCloudLinkModel({
        ...input.cloudLink,
        isDesktop,
        canManageRelay: access.canManageRelay,
      })
    : null;
  const selection = resolveConnectionsEndpointSelection({
    isDesktop,
    serverExposureState: input.serverExposureState,
    authPolicy: access.authPolicy,
    advertisedEndpoints: input.advertisedEndpoints,
    savedDefaultEndpointKey: input.savedDefaultEndpointKey,
  });
  const managesDesktopBackend = access.canManageLocalBackend && isDesktop;
  const primary: ConnectionsPrimarySectionModel =
    isDesktop || access.canManageLocalBackend
      ? {
          kind: "managed",
          header: buildPrimaryEnvironmentHeaderModel({
            isDesktop,
            environment: input.primaryEnvironment,
          }),
          version: access.canManageLocalBackend
            ? buildVersionRowModel({
                environment: input.primaryEnvironment,
                updateState: input.primaryUpdateState,
                updateFacts: input.primaryUpdateFacts,
              })
            : null,
          networkAccess: access.canManageLocalBackend
            ? buildNetworkAccessRowModel({
                isDesktop,
                selection,
                serverExposureState: input.serverExposureState,
                serverExposureError: input.serverExposureError,
                authPolicy: access.authPolicy,
                isUpdatingServerExposure: input.isUpdatingServerExposure,
                endpointListExpanded: input.endpointListExpanded,
              })
            : null,
          endpointRows:
            managesDesktopBackend && input.endpointListExpanded
              ? selection.visibleNetworkEndpoints.map((endpoint) =>
                  buildAdvertisedEndpointRowModel({
                    endpoint,
                    defaultEndpointKey: selection.defaultEndpointKey,
                    isUpdatingTailscaleServe: input.isUpdatingTailscaleServe,
                  }),
                )
              : [],
          tailscale: managesDesktopBackend
            ? buildTailscaleRowModel({
                endpoint: selection.tailscaleHttpsEndpoint,
                isUpdating: input.isUpdatingTailscaleServe,
              })
            : null,
          wsl: managesDesktopBackend
            ? buildWslSettingsModel({
                state: input.wslState,
                error: input.wslError,
                canManageLocalBackend: access.canManageLocalBackend,
                isLoading: input.isLoadingWslState,
                isUpdating: input.isUpdatingWslBackend,
              })
            : null,
          cloudLink: access.canManageLocalBackend ? cloudLink : null,
          authorizedClients: selection.remotelyReachable
            ? buildAuthorizedClientsModel({
                ...input.accessManagement,
                endpointUrl: input.serverExposureState?.endpointUrl,
                selection,
                nowMs: input.nowMs,
                currentHref: input.currentHref,
                canCopyToClipboard: input.canCopyToClipboard,
              })
            : null,
          createPairingLinkDialog: buildCreatePairingLinkDialogModel(input.createPairingLink),
          networkExposureDialog: buildNetworkExposureDialogModel({
            open: input.networkExposureDialogOpen,
            pendingMode: input.pendingNetworkExposureMode,
            isUpdating: input.isUpdatingServerExposure,
          }),
          wslConfirmDialog: buildWslConfirmDialogModel({
            pending: input.pendingWslChange,
            isUpdating: input.isUpdatingWslBackend,
          }),
          tailscaleDisableDialog: buildTailscaleServeDisableDialogModel({
            open: input.tailscaleDisableDialogOpen,
            isUpdating: input.isUpdatingTailscaleServe,
          }),
          tailscaleSetupDialog: buildTailscaleServeSetupDialogModel({
            pendingEndpoint: input.pendingTailscaleServeEndpoint,
            portInput: input.tailscaleServePortInput,
            isUpdating: input.isUpdatingTailscaleServe,
          }),
        }
      : {
          kind: "restricted",
          ...CONNECTIONS_ENVIRONMENT_SETTING,
          administrativeAccess: ADMINISTRATIVE_ACCESS_ROW,
          cloudLink,
        };

  const savedEnvironments = resolveSavedEnvironments(input.environments);
  const listedIds = new Set(
    resolveListedEnvironments(savedEnvironments).map((environment) => environment.environmentId),
  );
  const { discoveredHosts, ...addEnvironment } = input.addEnvironment;
  return {
    primary,
    remoteEnvironments: {
      id: REMOTE_ENVIRONMENTS_SETTING.id,
      title: REMOTE_ENVIRONMENTS_TITLE,
      updateTargets: resolveSavedServerUpdateTargets(
        input.savedEnvironmentStates.map((state) => ({
          environment: state.environment,
          updateStatus: state.serverUpdateState.status,
          updateFacts: state.updateFacts,
        })),
      ),
      addEnvironmentDialog: buildAddEnvironmentDialogModel({
        ...addEnvironment,
        isDesktop,
        unsavedDiscoveredHosts: resolveUnsavedDiscoveredSshHosts(
          discoveredHosts,
          savedEnvironments,
        ),
        keybindings: input.keybindings,
        platform: input.platform,
      }),
      rows: input.savedEnvironmentStates
        .filter((state) => listedIds.has(state.environment.environmentId))
        .map((state) =>
          buildSavedBackendRowModel({
            environment: state.environment,
            removingEnvironmentId: input.removingEnvironmentId,
            serverUpdateState: state.serverUpdateState,
            updateFacts: state.updateFacts,
            discoveredDescriptor: state.discoveredDescriptor,
          }),
        ),
      emptyMode: resolveRemoteEnvironmentsEmptyMode({
        cloudEnabled: input.cloudEnabled,
        savedEnvironmentCount: savedEnvironments.length,
      }),
      emptyState: buildRemoteEnvironmentsEmptyStateModel(input.cloudEnabled),
    },
    loadBalancingEnvironmentIds: resolveLoadBalancingEnvironments(
      input.primaryEnvironment,
      savedEnvironments,
    ).map((environment) => environment.environmentId),
  };
}
