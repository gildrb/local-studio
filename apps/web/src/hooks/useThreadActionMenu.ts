import { requestCustomSnooze } from "../components/CustomSnoozeDialog.logic";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

import {
  buildHeaderThreadActionMenu,
  resolveHeaderThreadMenuIntent,
  type ThreadActionMenuId,
} from "../components/threadActionMenu.logic";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import {
  readEnvironmentSupportsAutoSettleOptOut,
  readEnvironmentSupportsPinning,
  readEnvironmentSupportsSettlement,
  readEnvironmentSupportsSnooze,
  readEnvironmentSupportsTitleRegeneration,
  readThreadShell,
  useProjects,
} from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { readLocalApi } from "../localApi";
import { selectProjectGroupingSettings } from "../logicalProject";
import { useUiStateStore } from "../uiStateStore";
import {
  resolveThreadProjectSettingsKey,
  runHeaderThreadMenuIntent,
} from "./headerThreadMenu.logic";
import { addThreadActionToast } from "./threadActionToast";
import { writeTextToClipboard } from "./useCopyToClipboard";
import { useNewThreadHandler } from "./useHandleNewThread";
import { useClientSettings } from "./useSettings";
import { useThreadActions } from "./useThreadActions";

/**
 * The per-thread action menu (pin, settle, snooze, rename, copy, delete…) as
 * a self-contained hook, for surfaces other than the sidebar row — today the
 * chat header. Renders through the native context-menu bridge and dispatches
 * through the same mutations the sidebar uses.
 */
export function useThreadActionMenu(input: {
  readonly threadRef: ScopedThreadRef | null;
  /** Fallback for "Copy path" when the thread has no worktree. */
  readonly projectCwd: string | null;
  readonly onStartRename: () => void;
}) {
  const { threadRef, projectCwd, onStartRename } = input;
  const router = useRouter();
  const projects = useProjects();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const actions = useThreadActions();
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const handleNewThread = useNewThreadHandler();
  const markThreadUnread = useUiStateStore((s) => s.markThreadUnread);
  const confirmThreadDelete = useClientSettings((s) => s.confirmThreadDelete);
  const confirmThreadArchive = useClientSettings((s) => s.confirmThreadArchive);
  const timestampFormat = useClientSettings((s) => s.timestampFormat);

  const openMenu = useCallback(
    (position: { x: number; y: number }) => {
      if (threadRef === null) return;
      void (async () => {
        const api = readLocalApi();
        if (!api) return;
        // Snapshot at open time — the menu is modal, so state read now is
        // what the user is looking at.
        const thread = readThreadShell(threadRef);
        if (!thread) return;
        const menu = buildHeaderThreadActionMenu({
          thread,
          supports: {
            settlement: readEnvironmentSupportsSettlement(threadRef.environmentId),
            autoSettleOptOut: readEnvironmentSupportsAutoSettleOptOut(threadRef.environmentId),
            snooze: readEnvironmentSupportsSnooze(threadRef.environmentId),
            pinning: readEnvironmentSupportsPinning(threadRef.environmentId),
            titleRegeneration: readEnvironmentSupportsTitleRegeneration(threadRef.environmentId),
          },
          now: new Date(),
          timestampFormat,
        });
        const clicked = await settlePromise(() => api.contextMenu.show(menu.items, position));
        if (clicked._tag === "Failure" || clicked.value === null) return;
        const action: ThreadActionMenuId = clicked.value;
        const intent = resolveHeaderThreadMenuIntent({
          action,
          thread,
          snoozePresets: menu.snoozePresets,
          isRegeneratingTitle: menu.isRegeneratingTitle,
          projectCwd,
          confirmThreadArchive,
          confirmThreadDelete,
        });
        await runHeaderThreadMenuIntent(
          intent,
          { threadRef, thread },
          {
            actions,
            requestCustomSnooze,
            openProjectSettings: (current) => {
              const projectKey = resolveThreadProjectSettingsKey({
                thread: current,
                projects,
                settings: projectGroupingSettings,
                primaryEnvironmentId,
              });
              if (projectKey === null) return;
              void router.navigate({
                to: "/projects/$projectKey",
                params: { projectKey },
              });
            },
            openNewThread: (projectRef, options) => handleNewThread(projectRef, options),
            startRename: onStartRename,
            regenerateTitle: (ref) =>
              updateThreadMetadata({
                environmentId: ref.environmentId,
                input: { threadId: ref.threadId, regenerateTitle: true },
              }),
            markThreadUnread,
            writeClipboard: writeTextToClipboard,
            confirm: (message, options) => api.dialogs.confirm(message, options),
            readThreadShell,
            addToast: addThreadActionToast,
          },
        );
      })();
    },
    [
      actions,
      confirmThreadArchive,
      confirmThreadDelete,
      handleNewThread,
      markThreadUnread,
      onStartRename,
      primaryEnvironmentId,
      projectCwd,
      projectGroupingSettings,
      projects,
      router,
      threadRef,
      timestampFormat,
      updateThreadMetadata,
    ],
  );

  const closeMenu = useCallback(() => {
    void readLocalApi()?.contextMenu.close();
  }, []);

  return { openMenu, closeMenu };
}
