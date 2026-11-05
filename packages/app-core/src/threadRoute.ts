import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { mergeEnvironmentThread } from "@t3tools/client-runtime/state/threads";
import { DEFAULT_SERVER_SETTINGS, type ScopedThreadRef } from "@t3tools/contracts";
import type { ClientSettings } from "@t3tools/contracts/settings";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  buildLocalDraftThread,
  resolveDraftPromotionNavigationTarget,
  threadHasStarted,
} from "@t3tools/web/src/components/ChatView.logic.ts";
import {
  type DraftId,
  type DraftThreadState,
  finalizePromotedDraftThreadByRef,
  getComposerDraftState,
  markPromotedDraftThreadByRef,
  useComposerDraftStore,
} from "@t3tools/web/src/composerDraftStore.ts";
import { NO_PROVIDER_MODEL_SELECTION } from "@t3tools/web/src/providerInstances.ts";
import { mergeEnvironmentSettings } from "@t3tools/web/src/settingsMerge.ts";
import type { Thread } from "@t3tools/web/src/types.ts";
import type { ThreadRouteTarget } from "@t3tools/web/src/threadRoutes.ts";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import type { ThreadInput } from "./feature.ts";
import type { CoreState } from "./state.ts";

export type { ThreadRouteTarget } from "@t3tools/web/src/threadRoutes.ts";

type DraftRouteDecision =
  | { readonly kind: "none" }
  | { readonly kind: "home" }
  | {
      readonly kind: "draft";
      readonly markPromoted: ScopedThreadRef | null;
      readonly canonical: ScopedThreadRef | null;
    }
  | { readonly kind: "finalize"; readonly threadRef: ScopedThreadRef };

export function createThreadRoute(registry: AtomRegistry.AtomRegistry, state: CoreState) {
  const draftStoreAtom = Atom.make((get) => {
    get.addFinalizer(useComposerDraftStore.subscribe((value) => get.setSelf(value)));
    return useComposerDraftStore.getState();
  });

  const routeTargetAtom = Atom.make<ThreadRouteTarget | null>(null).pipe(Atom.keepAlive);

  const routeDraftSessionAtom = Atom.make((get): DraftThreadState | null => {
    const target = get(routeTargetAtom);
    const store = get(draftStoreAtom);
    if (target === null) return null;
    return target.kind === "draft"
      ? store.getDraftSession(target.draftId)
      : store.getDraftSessionByRef(target.threadRef);
  });

  let lastRef: ScopedThreadRef | null = null;
  const routeAtom = Atom.make((get): ScopedThreadRef | null => {
    const target = get(routeTargetAtom);
    let next: ScopedThreadRef | null = null;
    if (target?.kind === "server") {
      next = target.threadRef;
    } else if (target?.kind === "draft") {
      const session = get(routeDraftSessionAtom);
      next = session === null ? null : scopeThreadRef(session.environmentId, session.threadId);
    }
    if (
      next !== null &&
      lastRef !== null &&
      next.environmentId === lastRef.environmentId &&
      next.threadId === lastRef.threadId
    ) {
      return lastRef;
    }
    lastRef = next;
    return next;
  });

  const routeDraftIdAtom = Atom.make((get): DraftId | null => {
    const target = get(routeTargetAtom);
    return target?.kind === "draft" ? target.draftId : null;
  });

  const decisionAtom = Atom.make((get): DraftRouteDecision => {
    const target = get(routeTargetAtom);
    if (target === null) return { kind: "none" };
    const store = get(draftStoreAtom);
    if (target.kind === "server") {
      const detail = get(state.environmentThreadDetails.detailAtom(target.threadRef));
      return threadHasStarted(detail) && store.getDraftThreadByRef(target.threadRef) !== null
        ? { kind: "finalize", threadRef: target.threadRef }
        : { kind: "none" };
    }
    const session = get(routeDraftSessionAtom);
    if (session === null) return { kind: "home" };
    const reservedRef = scopeThreadRef(session.environmentId, session.threadId);
    const reservedShell = get(state.environmentThreadShells.threadShellAtom(reservedRef));
    const inferredRef = reservedShell === null ? null : reservedRef;
    const serverThreadRef = session.promotedTo ?? inferredRef;
    const serverThread =
      serverThreadRef === null
        ? null
        : mergeEnvironmentThread(
            get(state.environmentThreadDetails.detailAtom(serverThreadRef)),
            get(state.environmentThreadShells.threadShellAtom(serverThreadRef)),
          );
    return {
      kind: "draft",
      markPromoted: inferredRef !== null && !session.promotedTo ? inferredRef : null,
      canonical: resolveDraftPromotionNavigationTarget({
        serverThreadRef,
        serverThread,
        backgroundSubmissionPending:
          serverThreadRef !== null &&
          store.backgroundSubmissionThreadKeys[scopedThreadKey(serverThreadRef)] === true,
      }),
    };
  });

  const start = (onNavigate: (target: ThreadRouteTarget | null) => void) =>
    registry.subscribe(
      decisionAtom,
      (decision) => {
        switch (decision.kind) {
          case "none":
            return;
          case "home":
            onNavigate(null);
            return;
          case "finalize":
            finalizePromotedDraftThreadByRef(decision.threadRef);
            return;
          case "draft":
            if (decision.markPromoted !== null) markPromotedDraftThreadByRef(decision.markPromoted);
            if (decision.canonical !== null) {
              onNavigate({ kind: "server", threadRef: decision.canonical });
            }
            return;
        }
      },
      { immediate: true },
    );

  const threadInputAtom = (input: {
    readonly clientSettingsAtom: Atom.Atom<ClientSettings>;
    readonly routeThreadAtom: Atom.Atom<{
      readonly route: ScopedThreadRef;
      readonly thread: Thread;
    } | null>;
  }) =>
    Atom.make((get): ThreadInput | null => {
      const route = get(routeAtom);
      if (route === null) return null;
      const draftId = get(routeDraftIdAtom);
      const draftThread = get(routeDraftSessionAtom);
      const serverThread = get(input.routeThreadAtom)?.thread ?? null;
      const projectId = serverThread?.projectId ?? draftThread?.projectId ?? null;
      const project = get(state.environmentProjects.projectsAtom).find(
        (candidate) =>
          candidate.environmentId === route.environmentId && candidate.id === projectId,
      );
      const serverConfig = get(state.serverEnvironment.configValueAtom(route.environmentId));
      const clientSettings = get(input.clientSettingsAtom);
      let thread = serverThread;
      if (thread === null && draftThread !== null) {
        const settings = mergeEnvironmentSettings(
          serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS,
          clientSettings,
        );
        thread = buildLocalDraftThread(
          route.threadId,
          draftThread,
          resolveProjectSettings(settings, project?.id ?? null, project).settings
            .defaultModelSelection ?? NO_PROVIDER_MODEL_SELECTION,
        );
      }
      if (thread === null) return null;
      return {
        route,
        draftId,
        draftThread,
        isServerThread: serverThread !== null,
        thread,
        project,
        serverConfig,
        clientSettings,
        draft: getComposerDraftState(get(draftStoreAtom), draftId ?? route),
      };
    });

  return {
    draftStoreAtom,
    routeTargetAtom,
    routeAtom,
    routeDraftIdAtom,
    routeDraftSessionAtom,
    threadInputAtom,
    start,
  };
}
