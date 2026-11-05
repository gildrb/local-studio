import { useRouter } from "@tanstack/react-router";
import { useMemo, useRef } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { terminalEnvironment } from "../state/terminal";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { vcsEnvironment } from "../state/vcs";
import { useNewThreadHandler } from "./useHandleNewThread";
import { refreshArchivedThreadsForEnvironment } from "../lib/archivedThreadsState";
import { releaseComposerDraftUploads } from "../lib/composerDraftUploads";
import { readLocalApi } from "../localApi";
import {
  readEnvironmentSupportsAutoSettleOptOut,
  readEnvironmentSupportsPinning,
  readEnvironmentSupportsPinReorder,
  readEnvironmentSupportsActiveReorder,
  readEnvironmentSupportsSettlement,
  readEnvironmentSupportsSnooze,
  readEnvironmentThreadRefs,
  readProject,
  readThreadShell,
  readThreadShells,
} from "../state/entities";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { useUiStateStore } from "../uiStateStore";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";
import { useClientSettings } from "./useSettings";
import { showThreadUndoNotice } from "./showThreadUndoNotice";
import { useAtomCommand } from "../state/use-atom-command";
import { addThreadActionToast } from "./threadActionToast";
import { createThreadActions, type ThreadActions } from "./threadActions.logic";

export function useThreadActions(): ThreadActions {
  const closeTerminal = useAtomCommand(terminalEnvironment.close);
  const archiveThreadMutation = useAtomCommand(threadEnvironment.archive, {
    reportFailure: false,
  });
  const unarchiveThreadMutation = useAtomCommand(threadEnvironment.unarchive, {
    reportFailure: false,
  });
  const deleteThreadMutation = useAtomCommand(threadEnvironment.delete, {
    reportFailure: false,
  });
  const settleThreadMutation = useAtomCommand(threadEnvironment.settle, {
    reportFailure: false,
  });
  const unsettleThreadMutation = useAtomCommand(threadEnvironment.unsettle, {
    reportFailure: false,
  });
  const pinThreadMutation = useAtomCommand(threadEnvironment.pin, {
    reportFailure: false,
  });
  const unpinThreadMutation = useAtomCommand(threadEnvironment.unpin, {
    reportFailure: false,
  });
  const setThreadAutoSettleMutation = useAtomCommand(threadEnvironment.setAutoSettle, {
    reportFailure: false,
  });
  const reorderPinnedThreadMutation = useAtomCommand(threadEnvironment.reorderPin, {
    reportFailure: false,
  });
  const reorderActiveThreadMutation = useAtomCommand(threadEnvironment.reorderActive, {
    reportFailure: false,
  });
  const snoozeThreadMutation = useAtomCommand(threadEnvironment.snooze, {
    reportFailure: false,
  });
  const unsnoozeThreadMutation = useAtomCommand(threadEnvironment.unsnooze, {
    reportFailure: false,
  });
  const stopThreadSession = useAtomCommand(threadEnvironment.stopSession);
  const removeWorktree = useAtomCommand(vcsEnvironment.removeWorktree, {
    reportFailure: false,
  });
  const refreshVcsStatus = useAtomCommand(vcsEnvironment.refreshStatus, {
    reportFailure: false,
  });
  const sidebarThreadSortOrder = useClientSettings((settings) => settings.sidebarThreadSortOrder);
  const confirmThreadDelete = useClientSettings((settings) => settings.confirmThreadDelete);
  const confirmThreadUnpin = useClientSettings((settings) => settings.confirmThreadUnpin);
  // Settings are read when an action runs, so the actions keep one identity.
  const settingsRef = useRef({ sidebarThreadSortOrder, confirmThreadDelete, confirmThreadUnpin });
  settingsRef.current = { sidebarThreadSortOrder, confirmThreadDelete, confirmThreadUnpin };
  const clearComposerDraftForThread = useComposerDraftStore((store) => store.clearDraftThread);
  const clearProjectDraftThreadById = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadById,
  );
  const clearTerminalUiState = useTerminalUiStateStore((state) => state.clearTerminalUiState);
  const markThreadVisited = useUiStateStore((state) => state.markThreadVisited);
  const router = useRouter();
  const handleNewThread = useNewThreadHandler();
  // Keep a ref so archiveThread can call handleNewThread without depending on
  // it — handleNewThread is inherently unstable (depends on the projects list)
  // and would otherwise cascade new references into every sidebar row.
  const handleNewThreadRef = useRef(handleNewThread);
  handleNewThreadRef.current = handleNewThread;

  return useMemo(
    () =>
      createThreadActions({
        commands: {
          archive: archiveThreadMutation,
          unarchive: unarchiveThreadMutation,
          delete: deleteThreadMutation,
          settle: settleThreadMutation,
          unsettle: unsettleThreadMutation,
          pin: pinThreadMutation,
          unpin: unpinThreadMutation,
          setAutoSettle: setThreadAutoSettleMutation,
          reorderPin: reorderPinnedThreadMutation,
          reorderActive: reorderActiveThreadMutation,
          snooze: snoozeThreadMutation,
          unsnooze: unsnoozeThreadMutation,
          stopSession: stopThreadSession,
          closeTerminal,
          removeWorktree,
          refreshVcsStatus,
        },
        supports: {
          settlement: readEnvironmentSupportsSettlement,
          snooze: readEnvironmentSupportsSnooze,
          pinning: readEnvironmentSupportsPinning,
          pinReorder: readEnvironmentSupportsPinReorder,
          activeReorder: readEnvironmentSupportsActiveReorder,
          autoSettleOptOut: readEnvironmentSupportsAutoSettleOptOut,
        },
        readThreadShell,
        readThreadShells,
        readEnvironmentThreadRefs,
        readProject,
        readServerConfig: (environmentId) =>
          appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId),
        readSettings: () => settingsRef.current,
        readConfirm: () => {
          const localApi = readLocalApi();
          return localApi ? (message, options) => localApi.dialogs.confirm(message, options) : null;
        },
        currentRouteThreadRef: () =>
          resolveThreadRouteRef(
            router.state.matches[router.state.matches.length - 1]?.params ?? {},
          ),
        navigateToThread: (ref, { replace }) =>
          router.navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(ref),
            ...(replace ? { replace: true } : {}),
          }),
        navigateHome: () => router.navigate({ to: "/", replace: true }),
        openNewThread: (projectRef) => handleNewThreadRef.current(projectRef),
        markThreadVisited,
        refreshArchivedThreads: refreshArchivedThreadsForEnvironment,
        clearDeletedThreadState: (threadRef, projectRef) => {
          releaseComposerDraftUploads(threadRef);
          clearComposerDraftForThread(threadRef);
          clearProjectDraftThreadById(projectRef, threadRef);
          clearTerminalUiState(threadRef);
        },
        showUndoNotice: showThreadUndoNotice,
        addToast: addThreadActionToast,
      }),
    [
      archiveThreadMutation,
      clearComposerDraftForThread,
      clearProjectDraftThreadById,
      clearTerminalUiState,
      closeTerminal,
      deleteThreadMutation,
      markThreadVisited,
      pinThreadMutation,
      refreshVcsStatus,
      removeWorktree,
      reorderActiveThreadMutation,
      reorderPinnedThreadMutation,
      router,
      setThreadAutoSettleMutation,
      settleThreadMutation,
      snoozeThreadMutation,
      stopThreadSession,
      unarchiveThreadMutation,
      unpinThreadMutation,
      unsettleThreadMutation,
      unsnoozeThreadMutation,
    ],
  );
}
