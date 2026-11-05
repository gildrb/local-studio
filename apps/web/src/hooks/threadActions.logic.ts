import {
  parseScopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import {
  type AtomCommandResult,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { isScratchProject } from "@t3tools/client-runtime/state/projects";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { canSnooze, threadWokeAt } from "@t3tools/client-runtime/state/thread-settled";
import type {
  ArchiveThreadInput,
  DeleteThreadInput,
  PinThreadInput,
  ReorderActiveThreadInput,
  ReorderPinnedThreadInput,
  SetThreadAutoSettleInput,
  SettleThreadInput,
  SnoozeThreadInput,
  StopThreadSessionInput,
  UnarchiveThreadInput,
  UnpinThreadInput,
  UnsettleThreadInput,
  UnsnoozeThreadInput,
} from "@t3tools/client-runtime/state/threads";
import {
  type ConfirmDialogOptions,
  EnvironmentId,
  type ScopedProjectRef,
  type ScopedThreadRef,
  type ServerConfig,
  type TerminalCloseInput,
  ThreadId,
  type VcsRemoveWorktreeInput,
  type VcsStatusInput,
} from "@t3tools/contracts";
import type { SidebarThreadSortOrder } from "@t3tools/contracts/settings";
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/unstable/reactivity";

import { getFallbackThreadIdAfterDelete, pinOrderKeyBetween } from "../components/Sidebar.logic";
import { formatWorktreePathForDisplay, getOrphanedWorktreePathForThread } from "../worktreeCleanup";
import type { ThreadUndoOptions } from "./showThreadUndoNotice.logic";
import * as ThreadUndo from "./threadUndo";

export class ThreadArchiveBlockedError extends Schema.TaggedError<ThreadArchiveBlockedError>()(
  "ThreadArchiveBlockedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "Cannot archive a running thread.";
  }
}

export class ThreadSettlementUnsupportedError extends Schema.TaggedError<ThreadSettlementUnsupportedError>()(
  "ThreadSettlementUnsupportedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "This environment's server does not support settling yet. Update the server to use Settle.";
  }
}

export class ThreadSnoozeUnsupportedError extends Schema.TaggedError<ThreadSnoozeUnsupportedError>()(
  "ThreadSnoozeUnsupportedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "This environment's server does not support snoozing yet. Update the server to use Snooze.";
  }
}

export class ThreadSnoozeBlockedError extends Schema.TaggedError<ThreadSnoozeBlockedError>()(
  "ThreadSnoozeBlockedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "This thread is waiting on you. Respond to the pending request before snoozing it.";
  }
}

export class ThreadAutoSettleOptOutUnsupportedError extends Schema.TaggedError<ThreadAutoSettleOptOutUnsupportedError>()(
  "ThreadAutoSettleOptOutUnsupportedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "This environment's server does not support turning auto-settle off per thread yet. Update the server to use it.";
  }
}

export class ThreadPinningUnsupportedError extends Schema.TaggedError<ThreadPinningUnsupportedError>()(
  "ThreadPinningUnsupportedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "This environment's server does not support pinning yet. Update the server to use Pin.";
  }
}

export class ThreadPinReorderUnsupportedError extends Schema.TaggedError<ThreadPinReorderUnsupportedError>()(
  "ThreadPinReorderUnsupportedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "This environment's server does not support reordering pinned threads yet. Update the server to reorder pins.";
  }
}

export class ThreadActiveReorderUnsupportedError extends Schema.TaggedError<ThreadActiveReorderUnsupportedError>()(
  "ThreadActiveReorderUnsupportedError",
  {
    environmentId: EnvironmentId,
    threadId: ThreadId,
  },
) {
  override get message(): string {
    return "Update this environment's server to reorder active threads.";
  }
}

/** A toast a thread action asks its host to show; "stacked" is the thread toast layout. */
export interface ThreadActionToast {
  readonly layout: "stacked" | "plain";
  readonly type: "error" | "warning" | "success";
  readonly title: string;
  readonly description?: string;
}

export type ThreadActionResult = AtomCommandResult<unknown, unknown>;

export type ThreadEnvironmentCommandRunner<Input> = (command: {
  readonly environmentId: EnvironmentId;
  readonly input: Input;
}) => Promise<ThreadActionResult>;

export type ThreadConfirm = (message: string, options?: ConfirmDialogOptions) => Promise<boolean>;

export interface ThreadActionCommands {
  readonly archive: ThreadEnvironmentCommandRunner<ArchiveThreadInput>;
  readonly unarchive: ThreadEnvironmentCommandRunner<UnarchiveThreadInput>;
  readonly delete: ThreadEnvironmentCommandRunner<DeleteThreadInput>;
  readonly settle: ThreadEnvironmentCommandRunner<SettleThreadInput>;
  readonly unsettle: ThreadEnvironmentCommandRunner<UnsettleThreadInput>;
  readonly pin: ThreadEnvironmentCommandRunner<PinThreadInput>;
  readonly unpin: ThreadEnvironmentCommandRunner<UnpinThreadInput>;
  readonly setAutoSettle: ThreadEnvironmentCommandRunner<SetThreadAutoSettleInput>;
  readonly reorderPin: ThreadEnvironmentCommandRunner<ReorderPinnedThreadInput>;
  readonly reorderActive: ThreadEnvironmentCommandRunner<ReorderActiveThreadInput>;
  readonly snooze: ThreadEnvironmentCommandRunner<SnoozeThreadInput>;
  readonly unsnooze: ThreadEnvironmentCommandRunner<UnsnoozeThreadInput>;
  readonly stopSession: ThreadEnvironmentCommandRunner<StopThreadSessionInput>;
  readonly closeTerminal: ThreadEnvironmentCommandRunner<TerminalCloseInput>;
  readonly removeWorktree: ThreadEnvironmentCommandRunner<VcsRemoveWorktreeInput>;
  readonly refreshVcsStatus: ThreadEnvironmentCommandRunner<VcsStatusInput>;
}

export interface ThreadActionEnvironmentSupport {
  readonly settlement: (environmentId: EnvironmentId) => boolean;
  readonly snooze: (environmentId: EnvironmentId) => boolean;
  readonly pinning: (environmentId: EnvironmentId) => boolean;
  readonly pinReorder: (environmentId: EnvironmentId) => boolean;
  readonly activeReorder: (environmentId: EnvironmentId) => boolean;
  readonly autoSettleOptOut: (environmentId: EnvironmentId) => boolean;
}

export interface ThreadActionSettings {
  readonly sidebarThreadSortOrder: SidebarThreadSortOrder;
  readonly confirmThreadDelete: boolean;
  readonly confirmThreadUnpin: boolean;
}

export interface ThreadActionsDeps {
  readonly commands: ThreadActionCommands;
  readonly supports: ThreadActionEnvironmentSupport;
  readonly readThreadShell: (ref: ScopedThreadRef) => EnvironmentThreadShell | null;
  readonly readThreadShells: () => ReadonlyArray<EnvironmentThreadShell>;
  readonly readEnvironmentThreadRefs: (
    environmentId: EnvironmentId,
  ) => ReadonlyArray<ScopedThreadRef>;
  readonly readProject: (ref: ScopedProjectRef) => EnvironmentProject | null;
  readonly readServerConfig: (environmentId: EnvironmentId) => ServerConfig | undefined;
  readonly readSettings: () => ThreadActionSettings;
  /** The themed confirm dialog, or null when the host has none. */
  readonly readConfirm: () => ThreadConfirm | null;
  readonly currentRouteThreadRef: () => ScopedThreadRef | null;
  readonly navigateToThread: (
    ref: ScopedThreadRef,
    options: { readonly replace: boolean },
  ) => Promise<void>;
  readonly navigateHome: () => Promise<void>;
  readonly openNewThread: (projectRef: ScopedProjectRef) => Promise<unknown>;
  readonly markThreadVisited: (threadKey: string, visitedAt: string) => void;
  readonly refreshArchivedThreads: (environmentId: EnvironmentId) => void;
  /** Drops the client-side draft, upload and terminal state of a deleted thread. */
  readonly clearDeletedThreadState: (
    threadRef: ScopedThreadRef,
    projectRef: ScopedProjectRef,
  ) => void;
  readonly showUndoNotice: (options: ThreadUndoOptions) => void;
  readonly addToast: (toast: ThreadActionToast) => void;
}

export interface ThreadActions {
  readonly archiveThread: (
    target: ScopedThreadRef,
    opts?: { onArchived?: () => void },
  ) => Promise<ThreadActionResult>;
  readonly unarchiveThread: (
    target: ScopedThreadRef,
    opts?: { navigate?: boolean },
  ) => Promise<ThreadActionResult>;
  readonly deleteThread: (
    target: ScopedThreadRef,
    opts?: { deletedThreadKeys?: ReadonlySet<string> },
  ) => Promise<ThreadActionResult>;
  readonly confirmAndDeleteThread: (target: ScopedThreadRef) => Promise<ThreadActionResult>;
  readonly settleThread: (target: ScopedThreadRef) => Promise<ThreadActionResult>;
  readonly unsettleThread: (target: ScopedThreadRef) => Promise<ThreadActionResult>;
  readonly snoozeThread: (
    target: ScopedThreadRef,
    snoozedUntil: string,
  ) => Promise<ThreadActionResult>;
  readonly unsnoozeThread: (target: ScopedThreadRef) => Promise<ThreadActionResult>;
  readonly pinThread: (
    target: ScopedThreadRef,
    opts?: { orderKey?: string },
  ) => Promise<ThreadActionResult>;
  readonly unpinThread: (target: ScopedThreadRef) => Promise<ThreadActionResult>;
  readonly confirmAndUnpinThread: (target: ScopedThreadRef) => Promise<ThreadActionResult>;
  readonly reorderPinnedThread: (
    target: ScopedThreadRef,
    orderKey: string,
  ) => Promise<ThreadActionResult>;
  readonly reorderActiveThread: (
    target: ScopedThreadRef,
    orderKey: string,
  ) => Promise<ThreadActionResult>;
  readonly setThreadAutoSettle: (
    target: ScopedThreadRef,
    enabled: boolean,
  ) => Promise<ThreadActionResult>;
}

export async function requestThreadUnpinConfirmation(input: {
  enabled: boolean;
  title: string;
  confirm: ((message: string) => Promise<boolean>) | null;
}) {
  const { confirm } = input;
  if (!input.enabled || confirm === null) {
    return AsyncResult.success(true);
  }

  return settlePromise(() =>
    confirm(
      [
        `Unpin thread "${input.title}"?`,
        "This will move the thread out of your pinned section.",
      ].join("\n"),
    ),
  );
}

/** Report navigation separately so a completed deletion can still finish worktree cleanup. */
export async function navigateAfterThreadDeletion(
  navigate: () => Promise<void>,
  addToast: (toast: ThreadActionToast) => void,
) {
  const result = await settlePromise(navigate);
  if (result._tag === "Failure") {
    const error = squashAtomCommandFailure(result);
    addToast({
      layout: "stacked",
      type: "error",
      title: "Thread deleted, but navigation failed",
      description: error instanceof Error ? error.message : "An error occurred.",
    });
  }
}

/** Key that sorts before every arranged pinned thread, so a fresh pin lands
    at the top of the run. Undefined (keyless, sorts with the legacy block)
    when key math can't produce one — pinning must never fail on placement. */
function topOfPinnedRunOrderKey(shells: ReadonlyArray<EnvironmentThreadShell>): string | undefined {
  let firstKey: string | null = null;
  for (const shell of shells) {
    if (shell.pinnedAt == null || shell.pinOrderKey == null) continue;
    if (firstKey === null || shell.pinOrderKey < firstKey) firstKey = shell.pinOrderKey;
  }
  return pinOrderKeyBetween(null, firstKey) ?? undefined;
}

function failed(error: Error): ThreadActionResult {
  return AsyncResult.failure(Cause.fail(error));
}

/** The per-thread command flows (undo, confirmations, cleanup, navigation) shared by every surface. */
export function createThreadActions(deps: ThreadActionsDeps): ThreadActions {
  const { commands, supports } = deps;

  const resolveThreadTarget = (target: ScopedThreadRef) => {
    const thread = deps.readThreadShell(target);
    if (!thread) {
      return null;
    }
    return {
      thread,
      threadRef: target,
    };
  };

  const unarchiveThread: ThreadActions["unarchiveThread"] = async (target, opts = {}) => {
    ThreadUndo.invalidate("archive", scopedThreadKey(target));
    const result = await commands.unarchive({
      environmentId: target.environmentId,
      input: { threadId: target.threadId },
    });
    if (result._tag === "Failure") {
      return result;
    }
    deps.refreshArchivedThreads(target.environmentId);
    if (opts.navigate) {
      return settlePromise(() => deps.navigateToThread(target, { replace: false }));
    }
    return result;
  };

  const archiveThread: ThreadActions["archiveThread"] = async (target, opts = {}) => {
    const resolved = resolveThreadTarget(target);
    if (!resolved) return AsyncResult.success(undefined);
    const { thread, threadRef } = resolved;
    if (thread.session?.status === "running" && thread.session.activeTurnId != null) {
      return failed(
        new ThreadArchiveBlockedError({
          environmentId: threadRef.environmentId,
          threadId: threadRef.threadId,
        }),
      );
    }

    const currentRouteThreadRef = deps.currentRouteThreadRef();
    const shouldNavigateToDraft =
      currentRouteThreadRef?.threadId === threadRef.threadId &&
      currentRouteThreadRef.environmentId === threadRef.environmentId;
    const action = ThreadUndo.begin("archive", scopedThreadKey(threadRef));
    const archiveResult = await commands.archive({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
    if (archiveResult._tag === "Failure") {
      action.finish();
      return archiveResult;
    }
    const wokeAt = threadWokeAt(thread, { now: new Date().toISOString() });
    if (wokeAt !== null) {
      deps.markThreadVisited(scopedThreadKey(threadRef), wokeAt);
    }
    deps.refreshArchivedThreads(threadRef.environmentId);
    opts.onArchived?.();
    deps.showUndoNotice({
      action: "Archived",
      claim: action,
      // Undo also brings the reader back when archiving moved them to a draft.
      undo: () => unarchiveThread(threadRef, { navigate: shouldNavigateToDraft }),
      failureTitle: "Failed to undo archive",
    });

    if (shouldNavigateToDraft) {
      const navigationResult = await settlePromise(() =>
        deps.openNewThread(scopeProjectRef(thread.environmentId, thread.projectId)),
      );
      if (navigationResult._tag === "Failure") {
        return navigationResult;
      }
      return archiveResult;
    }

    return archiveResult;
  };

  const deleteThread: ThreadActions["deleteThread"] = async (target, opts = {}) => {
    const resolved = resolveThreadTarget(target);
    if (!resolved) {
      // Thread not in main store (e.g. archived thread) — dispatch delete directly.
      const result = await commands.delete({
        environmentId: target.environmentId,
        input: { threadId: target.threadId },
      });
      if (result._tag === "Success") {
        deps.refreshArchivedThreads(target.environmentId);
      }
      return result;
    }
    const { thread, threadRef } = resolved;
    const threads = deps.readEnvironmentThreadRefs(threadRef.environmentId).flatMap((ref) => {
      const shell = deps.readThreadShell(ref);
      return shell === null ? [] : [shell];
    });
    const threadProject = deps.readProject({
      environmentId: threadRef.environmentId,
      projectId: thread.projectId,
    });
    const deletedIds =
      opts.deletedThreadKeys && opts.deletedThreadKeys.size > 0
        ? new Set<ThreadId>(
            [...opts.deletedThreadKeys].flatMap((threadKey) => {
              const ref = parseScopedThreadKey(threadKey);
              return ref && ref.environmentId === threadRef.environmentId ? [ref.threadId] : [];
            }),
          )
        : undefined;
    const survivingThreads =
      deletedIds && deletedIds.size > 0
        ? threads.filter((entry) => entry.id === threadRef.threadId || !deletedIds.has(entry.id))
        : threads;
    const orphanedWorktreePath = getOrphanedWorktreePathForThread(
      survivingThreads,
      threadRef.threadId,
    );
    const displayWorktreePath = orphanedWorktreePath
      ? formatWorktreePathForDisplay(orphanedWorktreePath)
      : null;
    const environmentConfig = deps.readServerConfig(threadRef.environmentId);
    // A Scratch thread's folder is not a git worktree, and deleting the
    // thread keeps its files.
    const canDeleteWorktree =
      orphanedWorktreePath !== null &&
      threadProject !== null &&
      !isScratchProject(threadProject, environmentConfig?.scratchWorkspaceRoot);
    const confirm = deps.readConfirm();
    let shouldDeleteWorktree = false;
    const environmentSettings = environmentConfig?.settings;
    const automaticWorktreeCleanup = environmentSettings
      ? resolveWorktreeCleanup(environmentSettings, thread.projectId).worktreeOnDelete
      : false;
    if (canDeleteWorktree && confirm && !automaticWorktreeCleanup) {
      const confirmationResult = await settlePromise(() =>
        confirm(
          [
            "This thread is the only one linked to this worktree:",
            displayWorktreePath ?? orphanedWorktreePath,
            "",
            "Delete the worktree too?",
          ].join("\n"),
          { variant: "destructive" },
        ),
      );
      if (confirmationResult._tag === "Failure") {
        return confirmationResult;
      }
      shouldDeleteWorktree = confirmationResult.value;
    }

    if (thread.session && thread.session.status !== "stopped") {
      await commands.stopSession({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      });
    }

    await commands.closeTerminal({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, deleteHistory: true },
    });

    const deletedThreadIds = deletedIds ?? new Set<ThreadId>();
    const currentRouteThreadRef = deps.currentRouteThreadRef();
    const shouldNavigateToFallback =
      currentRouteThreadRef?.threadId === threadRef.threadId &&
      currentRouteThreadRef.environmentId === threadRef.environmentId;
    const fallbackThreadId = getFallbackThreadIdAfterDelete({
      threads,
      deletedThreadId: threadRef.threadId,
      deletedThreadIds,
      sortOrder: deps.readSettings().sidebarThreadSortOrder,
    });
    const deleteResult = await commands.delete({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
    if (deleteResult._tag === "Failure") {
      return deleteResult;
    }
    deps.refreshArchivedThreads(threadRef.environmentId);
    deps.clearDeletedThreadState(
      threadRef,
      scopeProjectRef(threadRef.environmentId, thread.projectId),
    );

    if (shouldNavigateToFallback) {
      const fallbackThread = fallbackThreadId
        ? deps.readThreadShell(scopeThreadRef(threadRef.environmentId, fallbackThreadId))
        : null;
      await navigateAfterThreadDeletion(
        () =>
          fallbackThread
            ? deps.navigateToThread(
                scopeThreadRef(fallbackThread.environmentId, fallbackThread.id),
                {
                  replace: true,
                },
              )
            : deps.navigateHome(),
        deps.addToast,
      );
    }

    if (!shouldDeleteWorktree || !orphanedWorktreePath || !threadProject) {
      return deleteResult;
    }

    const removeResult = await commands.removeWorktree({
      environmentId: threadRef.environmentId,
      input: {
        cwd: threadProject.workspaceRoot,
        path: orphanedWorktreePath,
        force: true,
      },
    });
    const refreshResult =
      removeResult._tag === "Success"
        ? await commands.refreshVcsStatus({
            environmentId: threadRef.environmentId,
            input: { cwd: threadProject.workspaceRoot },
          })
        : null;
    const cleanupFailure =
      removeResult._tag === "Failure"
        ? removeResult
        : refreshResult?._tag === "Failure"
          ? refreshResult
          : null;
    if (cleanupFailure) {
      const removalFailed = removeResult._tag === "Failure";
      const error = squashAtomCommandFailure(cleanupFailure);
      const message = error instanceof Error ? error.message : "An error occurred.";
      console.error("Worktree cleanup failed after thread deletion", {
        threadId: threadRef.threadId,
        projectCwd: threadProject.workspaceRoot,
        worktreePath: orphanedWorktreePath,
        error,
      });
      deps.addToast({
        layout: "stacked",
        type: "error",
        title: removalFailed
          ? "Failed to delete worktree"
          : "Worktree deleted, but Git status refresh failed",
        description: removalFailed
          ? `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`
          : message,
      });
      // The thread was deleted. Cleanup has its own toast; returning its
      // failure would make callers incorrectly report a thread deletion error.
    }
    return deleteResult;
  };

  const unsettleThread: ThreadActions["unsettleThread"] = async (target) => {
    if (!supports.settlement(target.environmentId)) {
      return failed(
        new ThreadSettlementUnsupportedError({
          environmentId: target.environmentId,
          threadId: target.threadId,
        }),
      );
    }
    ThreadUndo.invalidate("settle", scopedThreadKey(target));
    // reason "user" pins the thread active: auto-settle (PR merged /
    // inactivity) stays suppressed until real activity clears the pin.
    return commands.unsettle({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, reason: "user" },
    });
  };

  /** Turns automatic settlement (inactivity, merged PR) on or off for one thread. */
  const setThreadAutoSettle: ThreadActions["setThreadAutoSettle"] = async (target, enabled) => {
    if (!supports.autoSettleOptOut(target.environmentId)) {
      return failed(
        new ThreadAutoSettleOptOutUnsupportedError({
          environmentId: target.environmentId,
          threadId: target.threadId,
        }),
      );
    }
    return commands.setAutoSettle({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, enabled },
    });
  };

  const pinThread: ThreadActions["pinThread"] = async (target, opts = {}) => {
    // Version skew: never send the command to a server that predates it.
    if (!supports.pinning(target.environmentId)) {
      return failed(
        new ThreadPinningUnsupportedError({
          environmentId: target.environmentId,
          threadId: target.threadId,
        }),
      );
    }
    // Every pin path places the thread at the top of the arranged run:
    // callers with a better anchor (the sidebar, which knows the displayed
    // order) pass their own key; everyone else (chat header, context menus)
    // gets the default so the same action never places differently.
    // orderKey rides only to servers that decode it; pre-reorder servers
    // get the bare pin they understand and the thread stays keyless.
    const orderKey = supports.pinReorder(target.environmentId)
      ? (opts.orderKey ?? topOfPinnedRunOrderKey(deps.readThreadShells()))
      : undefined;
    ThreadUndo.invalidate("pin", scopedThreadKey(target));
    return commands.pin({
      environmentId: target.environmentId,
      input: {
        threadId: target.threadId,
        ...(orderKey !== undefined ? { orderKey } : {}),
      },
    });
  };

  const unpinThread: ThreadActions["unpinThread"] = async (target) => {
    if (!supports.pinning(target.environmentId)) {
      return failed(
        new ThreadPinningUnsupportedError({
          environmentId: target.environmentId,
          threadId: target.threadId,
        }),
      );
    }
    const thread = deps.readThreadShell(target);
    const orderKey = thread?.pinOrderKey ?? undefined;
    const action = ThreadUndo.begin("pin", scopedThreadKey(target));
    const result = await commands.unpin({
      environmentId: target.environmentId,
      input: { threadId: target.threadId },
    });
    if (result._tag === "Success" && action.isCurrent()) {
      deps.showUndoNotice({
        action: "Unpinned",
        claim: action,
        undo: () => pinThread(target, orderKey === undefined ? {} : { orderKey }),
        failureTitle: "Failed to undo unpin",
      });
    } else {
      action.finish();
    }
    return result;
  };

  const settleThread: ThreadActions["settleThread"] = async (target) => {
    // Version skew: never send the command to a server that predates it —
    // the raw protocol rejection would read as a random failure.
    if (!supports.settlement(target.environmentId)) {
      return failed(
        new ThreadSettlementUnsupportedError({
          environmentId: target.environmentId,
          threadId: target.threadId,
        }),
      );
    }
    const resolved = resolveThreadTarget(target);
    const wokeAt = resolved
      ? threadWokeAt(resolved.thread, { now: new Date().toISOString() })
      : null;
    // Settling also drops the pin and the snooze server-side, so Undo
    // has to put those back as well.
    const pinOrderKey = resolved?.thread.pinnedAt != null ? resolved.thread.pinOrderKey : null;
    const wasPinned = resolved?.thread.pinnedAt != null;
    const snoozedUntil = resolved?.thread.snoozedUntil ?? null;
    // An older unpin/snooze Undo would re-pin or re-snooze, and the server
    // treats either as a promotion that un-settles; settling supersedes them.
    ThreadUndo.invalidate("pin", scopedThreadKey(target));
    ThreadUndo.invalidate("snooze", scopedThreadKey(target));
    const action = ThreadUndo.begin("settle", scopedThreadKey(target));
    const result = await commands.settle({
      environmentId: target.environmentId,
      input: { threadId: target.threadId },
    });
    if (result._tag !== "Success") {
      action.finish();
      return result;
    }
    if (wokeAt !== null) {
      deps.markThreadVisited(scopedThreadKey(target), wokeAt);
    }
    deps.showUndoNotice({
      action: "Settled",
      claim: action,
      undo: async () => {
        const unsettled = await unsettleThread(target);
        if (unsettled._tag !== "Success") return unsettled;
        if (wasPinned) {
          const pinned = await pinThread(
            target,
            pinOrderKey == null ? {} : { orderKey: pinOrderKey },
          );
          if (pinned._tag !== "Success") return pinned;
        }
        if (snoozedUntil !== null) {
          return commands.snooze({
            environmentId: target.environmentId,
            input: { threadId: target.threadId, snoozedUntil },
          });
        }
        return unsettled;
      },
      failureTitle: "Failed to undo settle",
    });
    return result;
  };

  const confirmAndUnpinThread: ThreadActions["confirmAndUnpinThread"] = async (target) => {
    const confirm = deps.readConfirm();
    const resolved = resolveThreadTarget(target);
    const confirmationResult = await requestThreadUnpinConfirmation({
      enabled: deps.readSettings().confirmThreadUnpin,
      title: resolved?.thread.title ?? "this thread",
      confirm: confirm ? (message) => confirm(message) : null,
    });
    if (confirmationResult._tag === "Failure") {
      return confirmationResult;
    }
    if (!confirmationResult.value) {
      return AsyncResult.success(undefined);
    }
    return unpinThread(target);
  };

  const reorderPinnedThread: ThreadActions["reorderPinnedThread"] = async (target, orderKey) => {
    // Callers (the sidebar drag handler) only enable dragging on
    // reorder-capable environments; this guard covers races around
    // capability changes mid-drag.
    if (!supports.pinReorder(target.environmentId)) {
      return failed(
        new ThreadPinReorderUnsupportedError({
          environmentId: target.environmentId,
          threadId: target.threadId,
        }),
      );
    }
    ThreadUndo.invalidate("pin", scopedThreadKey(target));
    return commands.reorderPin({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, orderKey },
    });
  };

  const reorderActiveThread: ThreadActions["reorderActiveThread"] = async (target, orderKey) => {
    if (!supports.activeReorder(target.environmentId)) {
      return failed(
        new ThreadActiveReorderUnsupportedError({
          environmentId: target.environmentId,
          threadId: target.threadId,
        }),
      );
    }
    return commands.reorderActive({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, orderKey },
    });
  };

  const unsnoozeThread: ThreadActions["unsnoozeThread"] = async (target) => {
    if (!supports.snooze(target.environmentId)) {
      return failed(
        new ThreadSnoozeUnsupportedError({
          environmentId: target.environmentId,
          threadId: target.threadId,
        }),
      );
    }
    ThreadUndo.invalidate("snooze", scopedThreadKey(target));
    return commands.unsnooze({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, reason: "user" },
    });
  };

  const snoozeThread: ThreadActions["snoozeThread"] = async (target, snoozedUntil) => {
    // Version skew: never send the command to a server that predates it.
    if (!supports.snooze(target.environmentId)) {
      return failed(
        new ThreadSnoozeUnsupportedError({
          environmentId: target.environmentId,
          threadId: target.threadId,
        }),
      );
    }
    const resolved = resolveThreadTarget(target);
    // Blocked-on-you work and queued turns can't be snoozed away —
    // client-side twin of the server invariants so the UI rejects before
    // a round trip.
    if (resolved && !canSnooze(resolved.thread, { now: new Date().toISOString() })) {
      return failed(
        new ThreadSnoozeBlockedError({
          environmentId: resolved.threadRef.environmentId,
          threadId: resolved.threadRef.threadId,
        }),
      );
    }
    const action = ThreadUndo.begin("snooze", scopedThreadKey(target));
    const result = await commands.snooze({
      environmentId: target.environmentId,
      input: { threadId: target.threadId, snoozedUntil },
    });
    if (result._tag !== "Success") {
      action.finish();
      return result;
    }
    // Snooze hides the row, so keep its confirmation in the sidebar.
    deps.showUndoNotice({
      action: "Snoozed",
      claim: action,
      undo: () => unsnoozeThread(target),
      failureTitle: "Failed to wake thread",
    });
    return result;
  };

  const confirmAndDeleteThread: ThreadActions["confirmAndDeleteThread"] = async (target) => {
    const confirm = deps.readConfirm();
    const resolved = resolveThreadTarget(target);

    if (deps.readSettings().confirmThreadDelete && confirm) {
      const title = resolved?.thread.title ?? "this thread";
      const confirmationResult = await settlePromise(() =>
        confirm(
          [
            `Delete thread "${title}"?`,
            "This permanently clears conversation history for this thread.",
          ].join("\n"),
          { variant: "destructive" },
        ),
      );
      if (confirmationResult._tag === "Failure") {
        return confirmationResult;
      }
      if (!confirmationResult.value) {
        return AsyncResult.success(undefined);
      }
    }

    return deleteThread(target);
  };

  return {
    archiveThread,
    unarchiveThread,
    deleteThread,
    confirmAndDeleteThread,
    settleThread,
    unsettleThread,
    snoozeThread,
    unsnoozeThread,
    pinThread,
    unpinThread,
    confirmAndUnpinThread,
    reorderPinnedThread,
    reorderActiveThread,
    setThreadAutoSettle,
  };
}
