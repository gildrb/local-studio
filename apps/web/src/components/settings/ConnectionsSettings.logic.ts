import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthRelayReadScope,
  AuthRelayWriteScope,
  AuthReviewWriteScope,
  AuthTerminalOperateScope,
  type AdvertisedEndpoint,
  type AuthClientSession,
  type AuthEnvironmentScope,
  type AuthPairingLink,
  type DesktopBridge,
  type DesktopSshEnvironmentTarget,
  type DesktopWslState,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import type {
  ServerClientSessionRecord,
  ServerPairingLinkRecord,
} from "../../environments/primary/auth";
import { readHostedPairingRequest } from "../../hostedPairing";
import { getPairingTokenFromUrl, setPairingTokenOnUrl } from "../../pairingUrl";
import type { EnvironmentPresentation } from "../../state/environments";
import { resolveDesktopPairingUrl } from "./pairingUrls";

type WslEnableBridge = Pick<DesktopBridge, "setWslBackendEnabled" | "setWslDistro" | "setWslOnly">;

export const DEFAULT_TAILSCALE_SERVE_PORT = 443;
export const BACKEND_VALUE_DEFAULT_WSL = "backend:default-wsl";
export const BACKEND_VALUE_WSL_OFF = "backend:wsl-off";

const accessTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatAccessTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return accessTimestampFormatter.format(parsed);
}

export type PairingScopeOption = {
  readonly scope: AuthEnvironmentScope;
  readonly title: string;
  readonly description: string;
};

export const PAIRING_SCOPE_OPTIONS: ReadonlyArray<PairingScopeOption> = [
  {
    scope: AuthOrchestrationReadScope,
    title: "View environment",
    description: "Read threads, status, diffs, and configuration.",
  },
  {
    scope: AuthOrchestrationOperateScope,
    title: "Operate tasks",
    description: "Start tasks and perform changes in the environment.",
  },
  {
    scope: AuthTerminalOperateScope,
    title: "Use terminals",
    description: "Create terminals and send input to running shells.",
  },
  {
    scope: AuthReviewWriteScope,
    title: "Write reviews",
    description: "Create comments while reviewing changes.",
  },
  {
    scope: AuthAccessReadScope,
    title: "View access",
    description: "Inspect pairing links and authorized clients.",
  },
  {
    scope: AuthAccessWriteScope,
    title: "Manage access",
    description: "Issue and revoke credentials for other clients.",
  },
  {
    scope: AuthRelayReadScope,
    title: "View relay",
    description: "Inspect managed relay connectivity.",
  },
  {
    scope: AuthRelayWriteScope,
    title: "Manage relay",
    description: "Change managed tunnel connectivity.",
  },
];

export type ManualDesktopSshTargetInput = {
  readonly host: string;
  readonly username: string;
  readonly port: string;
};

export type ManualDesktopSshTargetResolution =
  | { readonly kind: "valid"; readonly target: DesktopSshEnvironmentTarget }
  | { readonly kind: "invalid"; readonly message: string };

export function resolveManualDesktopSshTarget(
  input: ManualDesktopSshTargetInput,
): ManualDesktopSshTargetResolution {
  const rawHost = input.host.trim();
  if (rawHost.length === 0) {
    return { kind: "invalid", message: "SSH host or alias is required." };
  }

  let hostname = rawHost;
  let username = input.username.trim() || null;
  let port: number | null = null;

  const atIndex = hostname.lastIndexOf("@");
  if (atIndex > 0) {
    const inlineUsername = hostname.slice(0, atIndex).trim();
    hostname = hostname.slice(atIndex + 1).trim();
    if (!username && inlineUsername.length > 0) {
      username = inlineUsername;
    }
  }

  const bracketedHostMatch = /^\[([^\]]+)\](?::(\d+))?$/u.exec(hostname);
  if (bracketedHostMatch) {
    hostname = (bracketedHostMatch[1] ?? "").trim();
    if (bracketedHostMatch[2]) {
      port = Number.parseInt(bracketedHostMatch[2], 10);
    }
  } else {
    const [hostSegment = "", portSegment = "", ...rest] = hostname.split(":");
    if (rest.length === 0 && /^\d+$/u.test(portSegment)) {
      hostname = hostSegment.trim();
      port = Number.parseInt(portSegment, 10);
    }
  }

  const rawPort = input.port.trim();
  if (rawPort.length > 0) {
    port = Number.parseInt(rawPort, 10);
  }

  if (hostname.length === 0) {
    return { kind: "invalid", message: "SSH host or alias is required." };
  }

  if (port !== null && (!Number.isInteger(port) || port <= 0 || port > 65_535)) {
    return { kind: "invalid", message: "SSH port must be between 1 and 65535." };
  }

  return {
    kind: "valid",
    target: {
      alias: hostname,
      hostname,
      username,
      port,
    },
  };
}

export type PairingUrlFields = {
  readonly host: string;
  readonly pairingCode: string;
};

export function parsePairingUrlFields(input: string, baseOrigin: string): PairingUrlFields | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const urlLikeInput =
      /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//u.test(trimmed) || trimmed.startsWith("//")
        ? trimmed
        : `https://${trimmed}`;
    const url = new URL(urlLikeInput, baseOrigin);
    const hostedPairingRequest = readHostedPairingRequest(url);
    if (hostedPairingRequest) {
      return {
        host: hostedPairingRequest.host,
        pairingCode: hostedPairingRequest.token,
      };
    }

    const pairingCode = getPairingTokenFromUrl(url);
    if (!pairingCode) return null;
    return {
      host: url.origin,
      pairingCode,
    };
  } catch {
    return null;
  }
}

export type RemotePairingFieldsInput = {
  readonly host: string;
  readonly pairingCode: string;
  readonly baseOrigin: string;
};

export type RemotePairingFieldsResolution =
  | { readonly kind: "valid"; readonly fields: PairingUrlFields }
  | { readonly kind: "invalid"; readonly message: string };

export function resolveRemotePairingFields(
  input: RemotePairingFieldsInput,
): RemotePairingFieldsResolution {
  const parsedPairingUrl = parsePairingUrlFields(input.host, input.baseOrigin);
  if (parsedPairingUrl) return { kind: "valid", fields: parsedPairingUrl };

  const host = input.host.trim();
  const pairingCode = input.pairingCode.trim();
  if (!host) {
    return { kind: "invalid", message: "Enter a backend host." };
  }
  if (!pairingCode) {
    return { kind: "invalid", message: "Enter a pairing code." };
  }
  return { kind: "valid", fields: { host, pairingCode } };
}

export function formatDesktopSshConnectionError(error: unknown): string {
  const fallback = "Failed to connect SSH host.";
  const rawMessage = error instanceof Error ? error.message : fallback;
  const withoutIpcPrefix = rawMessage.replace(
    /^Error invoking remote method 'desktop:ensure-ssh-environment':\s*/u,
    "",
  );
  const withoutTaggedErrorPrefix = withoutIpcPrefix.replace(/^Ssh[A-Za-z]+Error:\s*/u, "");
  return withoutTaggedErrorPrefix.trim() || fallback;
}

export function sortDesktopPairingLinks(
  links: ReadonlyArray<ServerPairingLinkRecord>,
): ReadonlyArray<ServerPairingLinkRecord> {
  return [...links].toSorted(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

export function summarizeAuthorizedClients(
  sessions: ReadonlyArray<ServerClientSessionRecord>,
  links: ReadonlyArray<ServerPairingLinkRecord>,
): string {
  const parts = [
    `${sessions.length} ${sessions.length === 1 ? "client" : "clients"}`,
    links.length > 0
      ? `${links.length} ${links.length === 1 ? "pairing link" : "pairing links"}`
      : null,
  ];
  return parts.filter((part): part is string => part !== null).join(" · ");
}

export function sortDesktopClientSessions(
  sessions: ReadonlyArray<ServerClientSessionRecord>,
): ReadonlyArray<ServerClientSessionRecord> {
  return [...sessions].toSorted((left, right) => {
    if (left.current !== right.current) {
      return left.current ? -1 : 1;
    }
    if (left.connected !== right.connected) {
      return left.connected ? -1 : 1;
    }
    return new Date(right.issuedAt).getTime() - new Date(left.issuedAt).getTime();
  });
}

export function toDesktopPairingLinkRecord(pairingLink: AuthPairingLink): ServerPairingLinkRecord {
  return {
    ...pairingLink,
    createdAt: DateTime.formatIso(pairingLink.createdAt),
    expiresAt: DateTime.formatIso(pairingLink.expiresAt),
  };
}

export function toDesktopClientSessionRecord(
  clientSession: AuthClientSession,
): ServerClientSessionRecord {
  return {
    ...clientSession,
    issuedAt: DateTime.formatIso(clientSession.issuedAt),
    expiresAt: DateTime.formatIso(clientSession.expiresAt),
    lastConnectedAt:
      clientSession.lastConnectedAt === null
        ? null
        : DateTime.formatIso(clientSession.lastConnectedAt),
  };
}

export function isTailscaleHttpsEndpoint(endpoint: AdvertisedEndpoint): boolean {
  return endpoint.id.startsWith("tailscale-magicdns:");
}

export function endpointDefaultPreferenceKey(endpoint: AdvertisedEndpoint): string {
  if (endpoint.id.startsWith("desktop-loopback:")) {
    return "desktop-core:loopback:http";
  }
  if (endpoint.id.startsWith("desktop-lan:")) {
    return "desktop-core:lan:http";
  }
  if (endpoint.id.startsWith("tailscale-ip:")) {
    return "tailscale:ip:http";
  }
  if (isTailscaleHttpsEndpoint(endpoint)) {
    return "tailscale:magicdns:https";
  }

  let scheme = "unknown";
  try {
    scheme = new URL(endpoint.httpBaseUrl).protocol.replace(/:$/u, "");
  } catch {
    scheme = "unknown";
  }

  return `${endpoint.provider.id}:${endpoint.reachability}:${scheme}:${endpoint.label}`;
}

export function selectPairingEndpoint(
  endpoints: ReadonlyArray<AdvertisedEndpoint>,
  defaultEndpointKey?: string | null,
): AdvertisedEndpoint | null {
  const availableEndpoints = endpoints.filter((endpoint) => endpoint.status !== "unavailable");
  if (defaultEndpointKey) {
    const selectedEndpoint = availableEndpoints.find(
      (endpoint) => endpointDefaultPreferenceKey(endpoint) === defaultEndpointKey,
    );
    if (selectedEndpoint) {
      return selectedEndpoint;
    }
  }
  return (
    availableEndpoints.find((endpoint) => endpoint.isDefault) ??
    availableEndpoints.find((endpoint) => endpoint.reachability !== "loopback") ??
    availableEndpoints.find((endpoint) => endpoint.compatibility.hostedHttpsApp === "compatible") ??
    null
  );
}

export function resolveAdvertisedEndpointPairingUrl(
  endpoint: AdvertisedEndpoint,
  credential: string,
): string {
  return resolveDesktopPairingUrl(endpoint.httpBaseUrl, credential);
}

export function resolveCurrentOriginPairingUrl(credential: string, currentHref: string): string {
  const url = new URL("/pair", currentHref);
  return setPairingTokenOnUrl(url, credential).toString();
}

export function isHostedAppPairingUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.pathname === "/pair" && url.searchParams.has("host");
  } catch {
    return false;
  }
}

export function endpointShareHint(endpoint: AdvertisedEndpoint, url: string): string {
  if (isHostedAppPairingUrl(url)) {
    return "Opens the hosted app, no install needed";
  }
  switch (endpoint.reachability) {
    case "lan":
      return "Devices on the same network";
    case "private-network":
      return "Devices on your private network";
    case "public":
      return "Reachable from anywhere";
    case "loopback":
      return "Clients on this machine";
  }
}

export type SavedBackendStatusTone = "muted" | "error";

export type SavedBackendStatus = {
  readonly text: string;
  readonly tone: SavedBackendStatusTone;
};

export function savedBackendStatus(environment: EnvironmentPresentation): SavedBackendStatus {
  if (!environment.entry.enabled && environment.connection.phase !== "unsupported")
    return { text: "Off", tone: "muted" };
  const { connection } = environment;
  switch (connection.phase) {
    case "connected":
      return { text: "Connected", tone: "muted" };
    case "connecting":
      return { text: "Connecting", tone: "muted" };
    case "reconnecting":
      return {
        text: connection.error ? `Reconnecting: ${connection.error}` : "Reconnecting",
        tone: "error",
      };
    case "unsupported":
      return { text: "Client not supported", tone: "muted" };
    case "error":
      return {
        text: connection.error ? `Connection failed: ${connection.error}` : "Connection failed",
        tone: "error",
      };
    case "offline":
      return { text: "Offline", tone: "muted" };
    case "available":
      return { text: "Not connected", tone: "muted" };
  }
}

/**
 * A QR code encoding a loopback URL makes the scanning device dial itself, so
 * loopback endpoints stay copyable from the endpoint menu but are never
 * offered as QR targets.
 */
export function isQrShareableEndpoint(endpoint: AdvertisedEndpoint): boolean {
  return endpoint.status !== "unavailable" && endpoint.reachability !== "loopback";
}

export function isWslSettingsRowVisible(input: {
  readonly state: DesktopWslState | null;
  readonly error: string | null;
}): boolean {
  const { state, error } = input;
  return state ? state.available || state.enabled || state.wslOnly : error !== null;
}

export type QrEndpointOption = {
  /** Unique per endpoint instance (AdvertisedEndpoint.id); safe as a React key. */
  readonly id: string;
  /**
   * Stable per endpoint *type* (endpointDefaultPreferenceKey). Multiple
   * endpoints can share one, so it is only used to match the saved default.
   */
  readonly preferenceKey: string;
  /** False for endpoints that stay copyable but must never render as a QR. */
  readonly qrShareable: boolean;
};

/**
 * Resolves which endpoint the share panel shows: the user's explicit pick,
 * else the saved default endpoint, else the first QR-shareable option (so the
 * panel never opens on a loopback QR), else the first option. A stale
 * selectedId (endpoint disappeared) falls back rather than blanking the panel.
 */
export function selectQrEndpointOption<T extends QrEndpointOption>(
  options: ReadonlyArray<T>,
  selectedId: string | null,
  defaultPreferenceKey: string | null,
): T | null {
  return (
    (selectedId !== null ? options.find((option) => option.id === selectedId) : undefined) ??
    (defaultPreferenceKey !== null
      ? options.find((option) => option.preferenceKey === defaultPreferenceKey)
      : undefined) ??
    options.find((option) => option.qrShareable) ??
    options[0] ??
    null
  );
}

export async function applyWslEnableSelection(input: {
  readonly bridge: WslEnableBridge;
  readonly mode: "both" | "wsl-only";
  readonly nextDistro: string | null;
  readonly persistedDistro: string | null;
}): Promise<DesktopWslState> {
  const { bridge, mode, nextDistro, persistedDistro } = input;

  // Stage every preference before enabling. The desktop only relaunches for
  // mode/distro changes while WSL is active, so the final enable observes the
  // complete selection and is the only call that may relaunch.
  await bridge.setWslOnly(mode === "wsl-only");
  if (persistedDistro !== nextDistro) {
    await bridge.setWslDistro(nextDistro);
  }
  return await bridge.setWslBackendEnabled(true);
}
