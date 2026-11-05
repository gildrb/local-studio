import type {
  DesktopPreviewTabState,
  PreviewReportStatusInput,
  ThreadId,
} from "@t3tools/contracts";

import type { DesktopPreviewOverlay } from "~/previewState.logic";

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function shouldClearBrowserPointer(
  previous: DesktopPreviewTabState["navStatus"] | null,
  current: DesktopPreviewTabState["navStatus"],
): boolean {
  if (!previous) return false;
  if (current.kind === "Loading" && previous.kind !== "Loading") return true;
  if (current.kind === "Idle" || previous.kind === "Idle") return false;
  return current.url !== previous.url;
}

export function projectDesktopState(state: DesktopPreviewTabState): DesktopPreviewOverlay {
  const navOrigin = state.navStatus.kind === "Idle" ? null : originOf(state.navStatus.url);
  return {
    hasWebContents: state.webContentsId !== null,
    canGoBack: state.canGoBack,
    canGoForward: state.canGoForward,
    loading: state.navStatus.kind === "Loading",
    zoomFactor: state.zoomFactor,
    pictureInPicture: state.pictureInPicture,
    colorScheme: state.colorScheme,
    audioMuted: state.audioMuted,
    audible: state.audible,
    controller: state.controller,
    favicon: state.favicon && originOf(state.favicon.pageUrl) === navOrigin ? state.favicon : null,
  };
}

/**
 * Decide whether a state change warrants an RPC to the server, and shape
 * the report payload.
 *
 * - Idle never reports — the tab is post-close or pre-load and the server
 *   already knows the canonical state from `open` / `closed`.
 * - We dedupe on (kind, url): consecutive Loading→Loading→Loading for the
 *   same URL collapses to a single RPC, ditto Success.
 * - LoadFailed always reports (the server uses it to emit `failed`).
 */
export function buildReportInput(args: {
  readonly threadId: ThreadId;
  readonly tabId: string;
  readonly state: DesktopPreviewTabState;
  readonly lastReportedUrl: string | null;
  readonly lastReportedKind: DesktopPreviewTabState["navStatus"]["kind"] | null;
}): {
  readonly input: PreviewReportStatusInput;
  readonly lastReportedUrl: string;
  readonly lastReportedKind: DesktopPreviewTabState["navStatus"]["kind"];
} | null {
  const { threadId, tabId, state, lastReportedUrl, lastReportedKind } = args;
  const status = state.navStatus;
  if (status.kind === "Idle") return null;

  // Skip if we've already reported the same kind+url. LoadFailed always
  // reports (rapid duplicate failures are unusual and worth surfacing).
  const sameAsLast =
    status.kind !== "LoadFailed" &&
    status.kind === lastReportedKind &&
    status.url === lastReportedUrl;
  if (sameAsLast) return null;

  const base = {
    threadId,
    tabId,
    canGoBack: state.canGoBack,
    canGoForward: state.canGoForward,
  };
  if (status.kind === "LoadFailed") {
    return {
      input: {
        ...base,
        navStatus: {
          _tag: "LoadFailed",
          url: status.url,
          title: status.title,
          code: status.code,
          description: status.description,
        },
      },
      lastReportedUrl: status.url,
      lastReportedKind: "LoadFailed",
    };
  }
  return {
    input: {
      ...base,
      navStatus: { _tag: status.kind, url: status.url, title: status.title },
    },
    lastReportedUrl: status.url,
    lastReportedKind: status.kind,
  };
}
