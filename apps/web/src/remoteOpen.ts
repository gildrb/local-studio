/**
 * Remote open-in-editor: when this client is not on the environment's
 * machine, "Open" must hand the OS a `vscode://vscode-remote/ssh-remote+…`
 * deep link (local editor connects over SSH) instead of exec'ing an editor
 * on the environment host.
 *
 * Host precedence: a desktop-SSH environment's real `~/.ssh/config` alias
 * beats server-advertised names; among advertised names the tailnet MagicDNS
 * name beats mDNS `<hostname>.local` (server sends them in that order).
 */
import { type EditorId, type EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useEffect, useMemo, useState } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useEnvironmentPresentation } from "~/state/presentation";
import {
  REMOTE_FALLBACK_EDITORS,
  REMOTE_OPEN_HINT_KEY,
  resolveProbedRemoteEditors,
  resolveRemoteOpenResolution,
  type RemoteOpenResolution,
  type RemoteOpenState,
} from "./remoteOpen.logic";

export function useRemoteOpenResolution(environmentId: EnvironmentId | null): RemoteOpenResolution {
  const { presentation } = useEnvironmentPresentation(environmentId);
  return useMemo(
    () => resolveRemoteOpenResolution(presentation, window.desktopBridge !== undefined),
    [presentation],
  );
}

export function useRemoteOpenState(environmentId: EnvironmentId | null): RemoteOpenState {
  return useRemoteOpenResolution(environmentId).state;
}

/**
 * Editors offered in remote-link mode. The desktop app probes the machine the
 * renderer runs on; a browser cannot, so it offers VS Code only.
 */
let cachedProbedEditors: ReadonlyArray<EditorId> | null = null;

export function useRemoteCapableEditors(): ReadonlyArray<EditorId> {
  const [editors, setEditors] = useState<ReadonlyArray<EditorId>>(
    () => cachedProbedEditors ?? REMOTE_FALLBACK_EDITORS,
  );

  useEffect(() => {
    if (cachedProbedEditors !== null) {
      return;
    }
    const probe = window.desktopBridge?.probeRemoteEditors;
    if (probe === undefined) {
      cachedProbedEditors = REMOTE_FALLBACK_EDITORS;
      return;
    }
    let cancelled = false;
    probe().then(
      (ids) => {
        cachedProbedEditors = resolveProbedRemoteEditors(ids);
        if (!cancelled) {
          setEditors(cachedProbedEditors);
        }
      },
      () => {
        cachedProbedEditors = REMOTE_FALLBACK_EDITORS;
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return editors;
}

/**
 * Fire a remote editor deep link. In desktop, route through the Electron
 * shell so the OS handler opens without navigating the renderer; in a
 * browser, assign the location — unlike window.open this does not leave a
 * blank tab behind.
 *
 * Resolves false when the desktop shell refused the URL (e.g. an older
 * build whose protocol allowlist predates editor schemes) so callers do not
 * record a successful open that never happened.
 */
export async function openRemoteEditorUrl(url: string): Promise<boolean> {
  const bridge = window.desktopBridge;
  if (bridge !== undefined) {
    try {
      return await bridge.openExternal(url);
    } catch {
      return false;
    }
  }
  window.location.assign(url);
  return true;
}

/**
 * One-time "you need SSH keys on that machine" hint, shown in the picker menu
 * until the first remote open fires (we cannot observe SSH success from here,
 * so first click is the dismiss signal).
 */
export function useRemoteOpenHint(): readonly [seen: boolean, markSeen: () => void] {
  const [seen, setSeen] = useLocalStorage(REMOTE_OPEN_HINT_KEY, false, Schema.Boolean);
  return [seen, () => setSeen(true)] as const;
}
