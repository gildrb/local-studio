"use client";

import type { DesktopPreviewTabState, ScopedThreadRef } from "@t3tools/contracts";
import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import * as Option from "effect/Option";
import { useEffect, useEffectEvent, useMemo, useRef } from "react";

import {
  flushPendingFaviconsForThread,
  recordFaviconForThread,
  useFaviconProjectRefForThread,
} from "~/browserFaviconStore";
import { useBrowserPointerStore } from "~/browser/browserPointerStore";
import { applyPreviewDesktopState } from "~/previewStateStore";
import { previewEnvironment } from "~/state/preview";
import { usePreparedConnection } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import { previewBridge } from "./previewBridge";
import {
  buildReportInput,
  projectDesktopState,
  shouldClearBrowserPointer,
} from "./previewBridge.logic";

/**
 * Mirrors low-latency desktop state into the store and reflects navigation
 * events back to the server. Webview lifetime is owned by ElectronBrowserHost.
 */
export function usePreviewBridge(input: {
  threadRef: ScopedThreadRef;
  tabId: string;
  runtimeTabId: string;
}): void {
  const { threadRef, tabId, runtimeTabId } = input;
  const clearBrowserPointer = useBrowserPointerStore((state) => state.clear);
  const reportStatus = useAtomCommand(previewEnvironment.reportStatus, "preview status report");
  const bridge = previewBridge;
  const threadKey = scopedThreadKey(threadRef);
  const stableThreadRef = useMemo(() => {
    const parsed = parseScopedThreadKey(threadKey);
    if (!parsed) throw new Error(`Invalid scoped thread key: ${threadKey}`);
    return parsed;
  }, [threadKey]);
  const projectRef = useFaviconProjectRefForThread(stableThreadRef);
  const preparedConnection = usePreparedConnection(stableThreadRef.environmentId);
  const environmentHostname = Option.isSome(preparedConnection)
    ? new URL(preparedConnection.value.httpBaseUrl).hostname
    : undefined;

  // One bridge subscription does both jobs (mirror state + forward to
  // server) so the desktop bridge keeps a single listener entry per tab.
  const lastReportedUrl = useRef<string | null>(null);
  const lastReportedKind = useRef<DesktopPreviewTabState["navStatus"]["kind"] | null>(null);
  const lastDesktopNavStatus = useRef<DesktopPreviewTabState["navStatus"] | null>(null);
  const handleStateChange = useEffectEvent(
    (changedTabId: string, state: DesktopPreviewTabState): void => {
      if (changedTabId !== runtimeTabId) return;
      if (shouldClearBrowserPointer(lastDesktopNavStatus.current, state.navStatus)) {
        clearBrowserPointer(runtimeTabId);
      }
      lastDesktopNavStatus.current = state.navStatus;
      applyPreviewDesktopState(stableThreadRef, tabId, projectDesktopState(state));
      if (state.favicon) {
        recordFaviconForThread(stableThreadRef, state.favicon, projectRef, environmentHostname);
      }
      const reported = buildReportInput({
        threadId: stableThreadRef.threadId,
        tabId,
        state,
        lastReportedUrl: lastReportedUrl.current,
        lastReportedKind: lastReportedKind.current,
      });
      if (!reported) return;
      lastReportedUrl.current = reported.lastReportedUrl;
      lastReportedKind.current = reported.lastReportedKind;
      void reportStatus({
        environmentId: stableThreadRef.environmentId,
        input: reported.input,
      });
    },
  );
  useEffect(() => {
    if (!bridge || typeof window === "undefined") return;
    lastReportedUrl.current = null;
    lastReportedKind.current = null;
    lastDesktopNavStatus.current = null;
    return bridge.onStateChange(handleStateChange);
  }, [bridge, runtimeTabId, stableThreadRef, tabId]);
  useEffect(() => {
    if (!projectRef) return;
    flushPendingFaviconsForThread(stableThreadRef, projectRef, environmentHostname);
  }, [environmentHostname, projectRef, stableThreadRef]);
}
