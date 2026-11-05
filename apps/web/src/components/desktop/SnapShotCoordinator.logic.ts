import type { ScopedThreadRef } from "@t3tools/contracts";

import { type DraftId, useComposerDraftStore } from "../../composerDraftStore";
import { beginSnapShotAnimation } from "../../lib/snapShotAnimation";

export type SnapShotCaptureTarget = DraftId | ScopedThreadRef;

export function resolveExistingSnapShotTargetWith(
  target: SnapShotCaptureTarget,
  routeThreadRef: ScopedThreadRef | null,
  readThreadShell: (ref: ScopedThreadRef) => object | null,
): SnapShotCaptureTarget | null {
  const store = useComposerDraftStore.getState();
  if (typeof target === "string") {
    const draftSession = store.getDraftSession(target);
    if (draftSession?.promotedTo) return draftSession.promotedTo;
    return draftSession ? target : null;
  }
  const targetIsCurrentRoute =
    routeThreadRef !== null &&
    routeThreadRef.environmentId === target.environmentId &&
    routeThreadRef.threadId === target.threadId;
  return targetIsCurrentRoute ||
    store.getDraftSessionByRef(target) !== null ||
    readThreadShell(target) !== null
    ? target
    : null;
}

export async function beginSnapShotAnimationWhenReady(
  id: string,
  target: Promise<SnapShotCaptureTarget | null>,
  pendingStarts: Set<string>,
): Promise<void> {
  pendingStarts.add(id);
  try {
    const resolvedTarget = await target;
    if (pendingStarts.delete(id) && resolvedTarget) {
      beginSnapShotAnimation(id, resolvedTarget);
    }
  } finally {
    pendingStarts.delete(id);
  }
}

export function resolveSnapShotTargetOnce(
  resolutionRef: { current: Promise<SnapShotCaptureTarget | null> | null },
  resolveTarget: () => Promise<SnapShotCaptureTarget | null>,
): Promise<SnapShotCaptureTarget | null> {
  if (resolutionRef.current) return resolutionRef.current;
  const resolution = resolveTarget().finally(() => {
    if (resolutionRef.current === resolution) resolutionRef.current = null;
  });
  resolutionRef.current = resolution;
  return resolution;
}

// A capture keeps its destination even after its animation unmounts or the window blurs.
export function resolveSnapShotDeliveryTarget(
  targets: Map<string, Promise<SnapShotCaptureTarget | null>>,
  id: string,
  resolveTarget: () => Promise<SnapShotCaptureTarget | null>,
): Promise<SnapShotCaptureTarget | null> {
  const existing = targets.get(id);
  if (existing) return existing;
  const target = resolveTarget().catch(() => null);
  targets.set(id, target);
  void target.then((resolved) => {
    if (!resolved && targets.get(id) === target) targets.delete(id);
  });
  return target;
}
