import type {
  PreviewAutomationNavigateInput,
  PreviewAutomationRequest,
  ScopedThreadRef,
} from "@t3tools/contracts";

import { PreviewAutomationNavigationTimeoutError } from "./previewAutomationErrors";

export interface PreviewNavigationReadinessProbe {
  /** Throws when the runtime tab no longer backs the server tab. */
  readonly assertCurrent: () => void;
  readonly documentReadyState: () => Promise<unknown>;
  readonly status: () => Promise<{ readonly available: boolean; readonly loading: boolean }>;
  readonly sleep: (ms: number) => Promise<void>;
}

export async function waitForNavigationReadinessWith(
  probe: PreviewNavigationReadinessProbe,
  input: {
    readonly threadRef: ScopedThreadRef;
    readonly requestId: string;
    readonly tabId: string;
    readonly operation: PreviewAutomationRequest["operation"];
    readonly readiness: PreviewAutomationNavigateInput["readiness"];
    readonly timeoutMs: number;
  },
): Promise<void> {
  const targetReadiness = input.readiness ?? "load";
  probe.assertCurrent();
  if (targetReadiness === "none") return;
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() <= deadline) {
    probe.assertCurrent();
    if (targetReadiness === "domContentLoaded") {
      const readyState = await probe.documentReadyState();
      if (readyState === "interactive" || readyState === "complete") return;
    } else {
      const status = await probe.status();
      if (status.available && !status.loading) return;
    }
    await probe.sleep(50);
  }
  throw new PreviewAutomationNavigationTimeoutError({
    requestId: input.requestId,
    environmentId: input.threadRef.environmentId,
    threadId: input.threadRef.threadId,
    tabId: input.tabId,
    readiness: targetReadiness,
    timeoutMs: input.timeoutMs,
  });
}
