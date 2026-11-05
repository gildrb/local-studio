import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { useParams, useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useComposerDraftStore } from "../composerDraftStore";
import { orderItemsByPreferredIds } from "../components/Sidebar.logic";
import { getProjectOrderKey, selectProjectGroupingSettings } from "../logicalProject";
import { readProjects, readThreadShell, useProjects, useThread } from "../state/entities";
import { readT3ProjectFile } from "../lib/t3ProjectFileDefaults";
import { environmentServerConfigsAtom } from "../state/server";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { legacyProjectCwdPreferenceKey } from "../uiState.logic";
import { useUiStateStore } from "../uiStateStore";
import { openNewThreadDraft, type NewThreadOptions, type NewThreadResult } from "./newThread.logic";
import { useClientSettings } from "./useSettings";

export function useNewThreadHandler() {
  const environmentServerConfigs = useAtomValue(environmentServerConfigsAtom);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const router = useRouter();

  return useCallback(
    (projectRef: ScopedProjectRef, options?: NewThreadOptions): Promise<NewThreadResult | null> =>
      openNewThreadDraft(
        {
          readServerSettings: (environmentId) =>
            environmentServerConfigs.get(environmentId)?.settings ?? null,
          projectGroupingSettings,
          currentRouteTarget: () =>
            resolveThreadRouteTarget(
              router.state.matches[router.state.matches.length - 1]?.params ?? {},
            ),
          currentLocation: () => router.state.location.href,
          navigateToDraft: async (draftId, { replace }) => {
            await router.navigate({ to: "/draft/$draftId", params: { draftId }, replace });
          },
          readProjects,
          readThreadShell,
          readT3ProjectFile,
        },
        projectRef,
        options,
      ),
    [environmentServerConfigs, projectGroupingSettings, router],
  );
}

export function useHandleNewThread() {
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const routeDraftId = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
  const activeThread = useThread(routeThreadRef);
  const getDraftThread = useComposerDraftStore((store) => store.getDraftThread);
  const activeDraftThread = useComposerDraftStore(() =>
    routeTarget
      ? routeTarget.kind === "server"
        ? getDraftThread(routeTarget.threadRef)
        : useComposerDraftStore.getState().getDraftSession(routeTarget.draftId)
      : null,
  );
  const projects = useProjects();
  const orderedProjects = useMemo(() => {
    return orderItemsByPreferredIds({
      items: projects,
      preferredIds: projectOrder,
      getId: getProjectOrderKey,
      getPreferenceIds: (project) => [
        getProjectOrderKey(project),
        legacyProjectCwdPreferenceKey(project.workspaceRoot),
      ],
    });
  }, [projectOrder, projects]);
  const handleNewThread = useNewThreadHandler();

  return {
    activeDraftThread,
    activeThread,
    defaultProjectRef: orderedProjects[0]
      ? scopeProjectRef(orderedProjects[0].environmentId, orderedProjects[0].id)
      : null,
    handleNewThread,
    routeDraftId,
    routeThreadRef,
  };
}
