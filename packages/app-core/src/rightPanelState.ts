import type { ScopedThreadRef } from "@t3tools/contracts";
import { deriveThreadAgentPanelModel } from "@t3tools/web/src/components/AgentsPanel.logic.ts";
import { resolvePanelToggleLiveAgentCount } from "@t3tools/web/src/components/chat/PanelLayoutControls.logic.ts";
import { derivePhase } from "@t3tools/web/src/session-logic.ts";
import {
  selectActiveRightPanelSurface,
  selectThreadRightPanelState,
  useRightPanelStore,
  type RightPanelSurface,
  type ThreadRightPanelState,
} from "@t3tools/web/src/rightPanelStore.ts";
import { resolveStorage } from "@t3tools/web/src/lib/storage.ts";
import { Atom } from "effect/unstable/reactivity";
import { createJSONStorage } from "zustand/middleware";

import type { ThreadInput } from "./feature.ts";

export type RouteRightPanelState = {
  readonly route: ScopedThreadRef;
  readonly state: ThreadRightPanelState;
  readonly activeSurface: RightPanelSurface | null;
};

export function persistRightPanelStore(storage: Storage): Promise<void> {
  useRightPanelStore.persist.setOptions({
    storage: createJSONStorage(() => resolveStorage(storage)),
  });
  return Promise.resolve(useRightPanelStore.persist.rehydrate());
}

export const rightPanelStoreAtom = Atom.make((get) => {
  get.addFinalizer(useRightPanelStore.subscribe((value) => get.setSelf(value)));
  return useRightPanelStore.getState();
});

/** File surfaces with unsaved edits, by project key `${environmentId}:${workspaceRoot}`. */
export const pendingFileSurfaceIdsAtom = Atom.make<ReadonlyMap<string, ReadonlySet<string>>>(
  new Map(),
).pipe(Atom.keepAlive);

export function makeRouteRightPanelStateAtom(
  routeAtom: Atom.Atom<ScopedThreadRef | null>,
): Atom.Atom<RouteRightPanelState | null> {
  return Atom.make((get): RouteRightPanelState | null => {
    const route = get(routeAtom);
    if (route === null) return null;
    const { byThreadKey } = get(rightPanelStoreAtom);
    return {
      route,
      state: selectThreadRightPanelState(byThreadKey, route),
      activeSurface: selectActiveRightPanelSurface(byThreadKey, route),
    };
  });
}

export function readRightPanelToggleState(
  get: Atom.AtomContext,
  route: ScopedThreadRef,
  thread: Pick<ThreadInput["thread"], "activities" | "session">,
): { readonly rightPanelOpen: boolean; readonly liveAgentCount: number } {
  const { byThreadKey } = get(rightPanelStoreAtom);
  const rightPanelOpen = selectThreadRightPanelState(byThreadKey, route).isOpen;
  return {
    rightPanelOpen,
    liveAgentCount: resolvePanelToggleLiveAgentCount({
      rightPanelOpen,
      activeSurfaceKind: selectActiveRightPanelSurface(byThreadKey, route)?.kind ?? null,
      liveAgentCount: deriveThreadAgentPanelModel({
        activities: thread.activities,
        sessionPhase: derivePhase(thread.session ?? null),
      }).liveCount,
    }),
  };
}
