import { scopeProjectRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";

import type { CustomSnoozeChoice } from "../components/CustomSnoozeDialog.logic";
import {
  type HeaderThreadMenuIntent,
  THREAD_MENU_COPY_TOASTS,
} from "../components/threadActionMenu.logic";
import { deriveLogicalProjectKeyFromSettings, derivePhysicalProjectKey } from "../logicalProject";
import { buildPhysicalToLogicalProjectKeyMap } from "../sidebarProjectGrouping";
import type {
  ThreadActionResult,
  ThreadActions,
  ThreadActionToast,
  ThreadConfirm,
} from "./threadActions.logic";

export type NewThreadOnBranchOptions = Extract<
  HeaderThreadMenuIntent,
  { readonly kind: "new-thread-on-branch" }
>["options"];

export interface HeaderThreadMenuDeps {
  readonly actions: Pick<
    ThreadActions,
    | "settleThread"
    | "unsettleThread"
    | "snoozeThread"
    | "unsnoozeThread"
    | "pinThread"
    | "confirmAndUnpinThread"
    | "setThreadAutoSettle"
    | "archiveThread"
    | "deleteThread"
  >;
  readonly requestCustomSnooze: () => Promise<CustomSnoozeChoice | null>;
  readonly openProjectSettings: (thread: EnvironmentThreadShell) => void;
  readonly openNewThread: (
    projectRef: ScopedProjectRef,
    options: NewThreadOnBranchOptions,
  ) => Promise<unknown>;
  readonly startRename: () => void;
  readonly regenerateTitle: (threadRef: ScopedThreadRef) => Promise<ThreadActionResult>;
  readonly markThreadUnread: (
    threadKey: string,
    latestTurnCompletedAt: string | null | undefined,
  ) => void;
  /** Resolves false when there was nothing to copy; rejects when the clipboard refused. */
  readonly writeClipboard: (value: string, target: string) => Promise<boolean>;
  readonly confirm: ThreadConfirm;
  readonly readThreadShell: (ref: ScopedThreadRef) => EnvironmentThreadShell | null;
  readonly addToast: (toast: ThreadActionToast) => void;
}

function failureToast(title: string, error: unknown): ThreadActionToast {
  return {
    layout: "stacked",
    type: "error",
    title,
    description: error instanceof Error ? error.message : "An error occurred.",
  };
}

/** The logical project key the project settings page is addressed by. */
export function resolveThreadProjectSettingsKey(input: {
  readonly thread: Pick<EnvironmentThreadShell, "environmentId" | "projectId">;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly settings: ProjectGroupingSettings;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): string | null {
  const project = input.projects.find(
    (candidate) =>
      candidate.environmentId === input.thread.environmentId &&
      candidate.id === input.thread.projectId,
  );
  if (!project) return null;
  const logicalProjectKeyByPhysicalKey = buildPhysicalToLogicalProjectKeyMap({
    projects: input.projects,
    settings: input.settings,
    primaryEnvironmentId: input.primaryEnvironmentId,
  });
  return (
    logicalProjectKeyByPhysicalKey.get(derivePhysicalProjectKey(project)) ??
    deriveLogicalProjectKeyFromSettings(project, input.settings)
  );
}

/**
 * Runs one resolved header menu intent. Settle and snooze never navigate
 * away: the caller is acting on the thread they are reading.
 */
export async function runHeaderThreadMenuIntent(
  intent: HeaderThreadMenuIntent,
  target: { readonly threadRef: ScopedThreadRef; readonly thread: EnvironmentThreadShell },
  deps: HeaderThreadMenuDeps,
): Promise<void> {
  const { threadRef, thread } = target;
  const { actions } = deps;
  const reportFailure = async (title: string, run: () => Promise<ThreadActionResult>) => {
    const result = await run();
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      deps.addToast(failureToast(title, squashAtomCommandFailure(result)));
    }
  };
  const copy = (
    value: string,
    target: string,
    toasts: { readonly success: string; readonly failure: string },
  ) => {
    void deps.writeClipboard(value, target).then(
      (didCopy) => {
        if (!didCopy) return;
        deps.addToast({
          layout: "plain",
          type: "success",
          title: toasts.success,
          description: value,
        });
      },
      (error: unknown) => {
        console.error(error);
        deps.addToast(failureToast(toasts.failure, error));
      },
    );
  };
  switch (intent.kind) {
    case "snooze":
      await reportFailure(intent.failureTitle, () =>
        actions.snoozeThread(threadRef, intent.snoozedUntil),
      );
      return;
    case "custom-snooze": {
      const preset = await deps.requestCustomSnooze();
      if (!preset) return;
      await reportFailure(intent.failureTitle, () =>
        actions.snoozeThread(threadRef, preset.snoozedUntil),
      );
      return;
    }
    case "project-settings":
      deps.openProjectSettings(thread);
      return;
    case "new-thread-on-branch": {
      const result = await settlePromise(() =>
        deps.openNewThread(
          scopeProjectRef(threadRef.environmentId, thread.projectId),
          intent.options,
        ),
      );
      if (result._tag === "Failure") {
        deps.addToast(failureToast(intent.failureTitle, squashAtomCommandFailure(result)));
      }
      return;
    }
    case "settle":
      await reportFailure(intent.failureTitle, () => actions.settleThread(threadRef));
      return;
    case "unsettle":
      await reportFailure(intent.failureTitle, () => actions.unsettleThread(threadRef));
      return;
    case "unsnooze":
      await reportFailure(intent.failureTitle, () => actions.unsnoozeThread(threadRef));
      return;
    case "pin":
      await reportFailure(intent.failureTitle, () => actions.pinThread(threadRef));
      return;
    case "unpin":
      await reportFailure(intent.failureTitle, () => actions.confirmAndUnpinThread(threadRef));
      return;
    case "set-auto-settle":
      await reportFailure(intent.failureTitle, () =>
        actions.setThreadAutoSettle(threadRef, intent.enabled),
      );
      return;
    case "rename":
      deps.startRename();
      return;
    case "regenerate-title":
      await reportFailure(intent.failureTitle, () => deps.regenerateTitle(threadRef));
      return;
    case "mark-unread":
      deps.markThreadUnread(scopedThreadKey(threadRef), intent.latestTurnCompletedAt);
      return;
    case "copy-path-unavailable":
      deps.addToast({
        layout: "stacked",
        type: "error",
        title: intent.title,
        description: intent.description,
      });
      return;
    case "copy-path":
      copy(intent.path, "text", THREAD_MENU_COPY_TOASTS.path);
      return;
    case "copy-branch":
      copy(intent.branch, "branch name", THREAD_MENU_COPY_TOASTS.branch);
      return;
    case "copy-thread-id":
      copy(intent.threadId, "text", THREAD_MENU_COPY_TOASTS.threadId);
      return;
    case "archive": {
      if (intent.confirmMessage !== null) {
        const message = intent.confirmMessage;
        const confirmed = await settlePromise(() => deps.confirm(message));
        if (confirmed._tag === "Failure" || !confirmed.value) return;
      }
      let didArchive = false;
      const result = await actions.archiveThread(threadRef, {
        onArchived: () => {
          didArchive = true;
        },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        deps.addToast(
          failureToast(
            didArchive ? intent.archivedFailureTitle : intent.failureTitle,
            squashAtomCommandFailure(result),
          ),
        );
      }
      return;
    }
    case "delete": {
      if (intent.confirmMessage !== null) {
        const message = intent.confirmMessage;
        const confirmed = await settlePromise(() =>
          deps.confirm(message, { variant: "destructive" }),
        );
        if (confirmed._tag === "Failure" || !confirmed.value) return;
      }
      const deleted = await actions.deleteThread(threadRef);
      if (
        deleted._tag === "Failure" &&
        !isAtomCommandInterrupted(deleted) &&
        // A failure with the thread already gone is worktree cleanup
        // failing after a successful delete — deleteThread has toasted
        // that itself, and "Failed to delete thread" would be a lie.
        deps.readThreadShell(threadRef) !== null
      ) {
        deps.addToast(failureToast(intent.failureTitle, squashAtomCommandFailure(deleted)));
      }
      return;
    }
    case "none":
      return;
  }
}
