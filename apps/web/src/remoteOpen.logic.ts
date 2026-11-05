import type { ConnectionTarget, EnvironmentPresentation } from "@t3tools/client-runtime/connection";
import {
  REMOTE_CAPABLE_EDITOR_IDS,
  type EditorId,
  type RemoteOpenTarget,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { isDesktopLocalConnectionTarget } from "./connection/desktopLocal";
import { isLoopbackHostname } from "./environments/primary/target";
import { getLocalStorageItem } from "./lib/localStorageItem";

export interface RemoteOpenHost {
  readonly kind: "ssh-alias" | RemoteOpenTarget["kind"];
  readonly host: string;
}

export type RemoteOpenState =
  | { readonly mode: "local-exec" }
  | { readonly mode: "remote-links"; readonly host: RemoteOpenHost }
  | { readonly mode: "remote-unavailable" };

export type RemoteOpenMode = RemoteOpenState["mode"];

export interface RemoteOpenResolution {
  readonly state: RemoteOpenState;
  readonly isResolved: boolean;
}

const LOCAL_EXEC: RemoteOpenState = { mode: "local-exec" };
const REMOTE_UNAVAILABLE: RemoteOpenState = { mode: "remote-unavailable" };
export const UNRESOLVED_REMOTE_OPEN: RemoteOpenResolution = {
  state: LOCAL_EXEC,
  isResolved: false,
};

function parseHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function resolveRemoteOpenState(input: {
  readonly target: ConnectionTarget | null;
  /** Real ssh alias for desktop-SSH environments; null elsewhere. */
  readonly sshAlias: string | null;
  /** Server-advertised hosts; undefined on servers that predate the feature. */
  readonly remoteOpenTargets: ReadonlyArray<RemoteOpenTarget> | undefined;
  /** True when running inside the desktop app's renderer. */
  readonly isDesktopRenderer: boolean;
}): RemoteOpenState {
  const { target } = input;
  // No catalog entry: keep today's exec behavior rather than guessing.
  if (target === null) {
    return LOCAL_EXEC;
  }
  if (target._tag === "PrimaryConnectionTarget") {
    // The desktop app manages its own primary backend, so it is always on
    // this machine even when its URL is not loopback (wsl-only mode binds
    // the WSL2 NAT address). In a browser, a loopback primary means the
    // browser runs on the serving machine; a tailnet/LAN URL means remote.
    if (input.isDesktopRenderer) {
      return LOCAL_EXEC;
    }
    const hostname = parseHostname(target.httpBaseUrl);
    if (hostname !== null && isLoopbackHostname(hostname)) {
      return LOCAL_EXEC;
    }
  } else if (isDesktopLocalConnectionTarget(target)) {
    return LOCAL_EXEC;
  }

  if (input.sshAlias !== null && input.sshAlias.length > 0) {
    return { mode: "remote-links", host: { kind: "ssh-alias", host: input.sshAlias } };
  }
  const advertised = input.remoteOpenTargets?.[0];
  if (advertised !== undefined) {
    return { mode: "remote-links", host: advertised };
  }
  return REMOTE_UNAVAILABLE;
}

export function resolveRemoteOpenResolution(
  presentation: EnvironmentPresentation | null,
  isDesktopRenderer: boolean,
): RemoteOpenResolution {
  if (presentation === null) {
    return UNRESOLVED_REMOTE_OPEN;
  }
  const profile = Option.getOrNull(presentation.entry.profile);
  const sshAlias =
    profile !== null && profile._tag === "SshConnectionProfile" ? profile.target.alias : null;
  return {
    state: resolveRemoteOpenState({
      target: presentation.entry.target,
      sshAlias,
      remoteOpenTargets: presentation.serverConfig?.remoteOpenTargets,
      isDesktopRenderer,
    }),
    isResolved: true,
  };
}

export const REMOTE_FALLBACK_EDITORS: ReadonlyArray<EditorId> = ["vscode"];

export function resolveProbedRemoteEditors(
  probed: ReadonlyArray<EditorId>,
): ReadonlyArray<EditorId> {
  const remoteCapable = probed.filter((id) => REMOTE_CAPABLE_EDITOR_IDS.includes(id));
  return remoteCapable.length > 0 ? remoteCapable : REMOTE_FALLBACK_EDITORS;
}

export const REMOTE_OPEN_HINT_KEY = "t3code:remote-open-hint-seen";

export function readRemoteOpenHintSeen(): boolean {
  return getLocalStorageItem(REMOTE_OPEN_HINT_KEY, Schema.Boolean) ?? false;
}
