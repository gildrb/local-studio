import {
  type PreviewAutomationNavigateInput,
  type PreviewAutomationRequest,
  type ScopedThreadRef,
} from "@t3tools/contracts";

import { isCurrentPreviewRuntimeTab } from "~/browser/previewRuntimeTabId";
import { readThreadPreviewState } from "~/previewStateStore";

import { previewBridge } from "./previewBridge";
import { PreviewAutomationTargetUnavailableError } from "./previewAutomationErrors";
import { waitForNavigationReadinessWith } from "./previewNavigationReadiness.logic";

export function assertPreviewRuntimeCurrent(
  threadRef: ScopedThreadRef,
  tabId: string,
  runtimeTabId: string,
  request: Pick<PreviewAutomationRequest, "operation" | "requestId">,
) {
  const state = readThreadPreviewState(threadRef);
  if (
    state.sessions[tabId] &&
    isCurrentPreviewRuntimeTab(threadRef, state.serverEpoch, tabId, runtimeTabId)
  ) {
    return state;
  }
  throw new PreviewAutomationTargetUnavailableError({
    requestId: request.requestId,
    operation: request.operation,
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    tabId,
    bridgeAvailable: Boolean(previewBridge),
  });
}

export async function waitForNavigationReadiness(
  threadRef: ScopedThreadRef,
  requestId: string,
  tabId: string,
  runtimeTabId: string,
  operation: PreviewAutomationRequest["operation"],
  readiness: PreviewAutomationNavigateInput["readiness"],
  timeoutMs: number,
): Promise<void> {
  const bridge = previewBridge;
  if (!bridge) return;
  await waitForNavigationReadinessWith(
    {
      assertCurrent: () => {
        assertPreviewRuntimeCurrent(threadRef, tabId, runtimeTabId, { operation, requestId });
      },
      documentReadyState: () =>
        bridge.automation.evaluate(runtimeTabId, { expression: "document.readyState" }),
      status: () => bridge.automation.status(runtimeTabId),
      sleep: (ms) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)),
    },
    { threadRef, requestId, tabId, operation, readiness, timeoutMs },
  );
}
