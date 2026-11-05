import { runAtomCommand, type AtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { requestConfirmDialog } from "@t3tools/web/src/confirmDialog.ts";
import { useComposerDraftStore } from "@t3tools/web/src/composerDraftStore.ts";
import {
  createThreadUndoNotices,
  type ThreadUndoAction,
  type ThreadUndoNotices,
} from "@t3tools/web/src/hooks/showThreadUndoNotice.logic.ts";
import {
  createThreadActions,
  type ThreadActions,
  type ThreadConfirm,
  type ThreadEnvironmentCommandRunner,
} from "@t3tools/web/src/hooks/threadActions.logic.ts";
import { useTerminalUiStateStore } from "@t3tools/web/src/terminalUiStateStore.ts";
import { markThreadVisited } from "@t3tools/web/src/uiState.logic.ts";
import { Atom } from "effect/unstable/reactivity";

import type { CoreFeature, FeatureContext } from "./feature.ts";

export type ThreadUndoNoticeView = { readonly action: ThreadUndoAction; readonly count: number };

export interface CoreThreadActions {
  readonly actions: ThreadActions;
  readonly undoNotices: ThreadUndoNotices;
  /** The themed confirm dialog, shared with every feature through the web's confirm queue. */
  readonly confirm: ThreadConfirm;
  readonly feature: CoreFeature;
}

const instances = new WeakMap<FeatureContext, CoreThreadActions>();

/** The web's thread command flows (undo, confirmations, cleanup, navigation) bound to the core. */
export function coreThreadActions(context: FeatureContext): CoreThreadActions {
  const existing = instances.get(context);
  if (existing !== undefined) return existing;
  const { registry, state } = context;
  const run =
    <Input, A, E>(
      command: AtomCommand<{ readonly environmentId: EnvironmentId; readonly input: Input }, A, E>,
      reportFailure: boolean,
    ): ThreadEnvironmentCommandRunner<Input> =>
    (args) =>
      runAtomCommand(registry, command, args, { reportFailure });
  const capabilities = (environmentId: EnvironmentId) =>
    registry.get(state.environmentServerConfigsAtom).get(environmentId)?.environment.capabilities;
  const confirm: ThreadConfirm = (message, options) =>
    requestConfirmDialog(message, options) ??
    Promise.reject(new Error("Confirmations are not available in the native app yet."));
  const undoNotices = createThreadUndoNotices((toast) => {
    context.addToast(toast);
  });
  const actions = createThreadActions({
    commands: {
      archive: run(state.threadEnvironment.archive, false),
      unarchive: run(state.threadEnvironment.unarchive, false),
      delete: run(state.threadEnvironment.delete, false),
      settle: run(state.threadEnvironment.settle, false),
      unsettle: run(state.threadEnvironment.unsettle, false),
      pin: run(state.threadEnvironment.pin, false),
      unpin: run(state.threadEnvironment.unpin, false),
      setAutoSettle: run(state.threadEnvironment.setAutoSettle, false),
      reorderPin: run(state.threadEnvironment.reorderPin, false),
      reorderActive: run(state.threadEnvironment.reorderActive, false),
      snooze: run(state.threadEnvironment.snooze, false),
      unsnooze: run(state.threadEnvironment.unsnooze, false),
      stopSession: run(state.threadEnvironment.stopSession, true),
      closeTerminal: run(state.terminalEnvironment.close, true),
      removeWorktree: run(state.vcsEnvironment.removeWorktree, false),
      refreshVcsStatus: run(state.vcsEnvironment.refreshStatus, false),
    },
    supports: {
      settlement: (environmentId) => capabilities(environmentId)?.threadSettlement === true,
      snooze: (environmentId) => capabilities(environmentId)?.threadSnooze === true,
      pinning: (environmentId) => capabilities(environmentId)?.threadPinning === true,
      pinReorder: (environmentId) => capabilities(environmentId)?.threadPinReorder === true,
      activeReorder: (environmentId) => capabilities(environmentId)?.threadActiveReorder === true,
      autoSettleOptOut: (environmentId) =>
        capabilities(environmentId)?.threadAutoSettleOptOut === true,
    },
    readThreadShell: (ref) => registry.get(state.environmentThreadShells.threadShellAtom(ref)),
    readThreadShells: () => registry.get(state.environmentThreadShells.threadShellsAtom),
    readEnvironmentThreadRefs: (environmentId) =>
      registry.get(state.environmentThreadShells.environmentThreadRefsAtom(environmentId)),
    readProject: (ref) => registry.get(state.environmentProjects.projectAtom(ref)),
    readServerConfig: (environmentId) =>
      registry.get(state.environmentServerConfigsAtom).get(environmentId),
    readSettings: () => registry.get(context.clientSettingsAtom),
    readConfirm: () => confirm,
    currentRouteThreadRef: () => {
      const target = registry.get(context.routeTargetAtom);
      return target?.kind === "server" ? target.threadRef : null;
    },
    navigateToThread: async (ref) => context.navigateToThread(ref),
    navigateHome: async () => context.navigateHome(),
    openNewThread: (projectRef) => context.openNewThread(projectRef),
    markThreadVisited: (threadKey, visitedAt) =>
      context.updateUiState((current) => markThreadVisited(current, threadKey, visitedAt)),
    refreshArchivedThreads: (environmentId) =>
      registry.refresh(
        state.orchestrationEnvironment.archivedShellSnapshot({ environmentId, input: {} }),
      ),
    clearDeletedThreadState: (threadRef, projectRef) => {
      const drafts = useComposerDraftStore.getState();
      const draft = drafts.getComposerDraft(threadRef);
      if (draft)
        context.attachmentUploads.releaseDraftAttachments([...draft.images, ...draft.files]);
      drafts.clearDraftThread(threadRef);
      drafts.clearProjectDraftThreadById(projectRef, threadRef);
      useTerminalUiStateStore.getState().clearTerminalUiState(threadRef);
    },
    showUndoNotice: undoNotices.show,
    addToast: (toast) => {
      context.addToast(toast);
    },
  });
  const noticeAtom = Atom.make((get): ThreadUndoNoticeView | null => {
    get.addFinalizer(undoNotices.store.subscribe(() => get.setSelf(noticeView())));
    return noticeView();
  });
  const noticeView = (): ThreadUndoNoticeView | null => {
    const notice = undoNotices.store.getState().notice;
    return notice === null ? null : { action: notice.action, count: notice.count };
  };
  const instance: CoreThreadActions = {
    actions,
    undoNotices,
    confirm,
    feature: {
      views: { threadUndoNotice: noticeAtom },
      actions: {
        threadUndoLatest: async () => undoNotices.undoLatest(),
      },
    },
  };
  instances.set(context, instance);
  return instance;
}

export function createThreadActionsFeature(context: FeatureContext): CoreFeature {
  return coreThreadActions(context).feature;
}
