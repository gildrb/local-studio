import { scopeProjectRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { canSnooze, type SnoozePreset } from "@t3tools/client-runtime/state/thread-settled";
import type {
  ContextMenuItem,
  ScopedProjectRef,
  ScopedThreadRef,
  ServerConfig,
  ThreadId,
} from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";

import type { NewThreadOnBranchOptions } from "../hooks/headerThreadMenu.logic";
import type {
  ThreadActionResult,
  ThreadActions,
  ThreadActionToast,
  ThreadConfirm,
} from "../hooks/threadActions.logic";
import type { CustomSnoozeChoice } from "./CustomSnoozeDialog.logic";
import { resolveSnoozePresets } from "./Sidebar.snooze";
import {
  buildThreadActionMenuItems,
  type HeaderThreadMenuIntent,
  resolveHeaderThreadMenuIntent,
  type ThreadActionMenuId,
} from "./threadActionMenu.logic";

export interface SidebarThreadMenuProjectGroup {
  readonly projectKey: string;
  readonly displayName: string;
  readonly memberProjectRefs: ReadonlyArray<{
    readonly environmentId: string;
    readonly projectId: string;
  }>;
}

export interface SidebarThreadMenu<G extends SidebarThreadMenuProjectGroup> {
  readonly items: ReadonlyArray<ContextMenuItem<ThreadActionMenuId>>;
  readonly snoozePresets: ReadonlyArray<SnoozePreset>;
  readonly isRegeneratingTitle: boolean;
  readonly projectGroup: G | null;
}

export function findSidebarThreadProjectGroup<G extends SidebarThreadMenuProjectGroup>(
  projectGroups: ReadonlyArray<G>,
  thread: Pick<EnvironmentThreadShell, "environmentId" | "projectId">,
): G | null {
  return (
    projectGroups.find((project) =>
      project.memberProjectRefs.some(
        (projectRef) =>
          projectRef.environmentId === thread.environmentId &&
          projectRef.projectId === thread.projectId,
      ),
    ) ?? null
  );
}

export function buildSidebarThreadMenu<G extends SidebarThreadMenuProjectGroup>(input: {
  readonly thread: EnvironmentThreadShell;
  readonly serverConfig: ServerConfig | undefined;
  readonly isSettled: boolean;
  readonly isSnoozed: boolean;
  readonly projectGroups: ReadonlyArray<G>;
  readonly projectScopeKey: string | null;
  readonly now: Date;
  readonly timestampFormat: TimestampFormat;
}): SidebarThreadMenu<G> {
  const { thread } = input;
  const capabilities = input.serverConfig?.environment.capabilities;
  const isRegeneratingTitle = thread.titleRegeneration != null;
  const snoozePresets = resolveSnoozePresets(input.now, input.timestampFormat);
  const projectGroup = findSidebarThreadProjectGroup(input.projectGroups, thread);
  const items = buildThreadActionMenuItems({
    branch: thread.branch ?? null,
    projectFilter: projectGroup
      ? {
          label: projectGroup.displayName,
          isActive: input.projectScopeKey === projectGroup.projectKey,
        }
      : null,
    isPinned: thread.pinnedAt != null,
    isSettled: input.isSettled,
    autoSettleEnabled: thread.autoSettleDisabledAt == null,
    isSnoozed: input.isSnoozed,
    canSnoozeNow: canSnooze(thread, { now: input.now.toISOString() }),
    isRegeneratingTitle,
    isRunning: thread.session?.status === "running" && thread.session.activeTurnId != null,
    supports: {
      settlement: capabilities?.threadSettlement === true,
      autoSettleOptOut: capabilities?.threadAutoSettleOptOut === true,
      snooze: capabilities?.threadSnooze === true,
      pinning: capabilities?.threadPinning === true,
      titleRegeneration: capabilities?.threadTitleRegeneration === true,
    },
    snoozePresets,
  });
  return { items, snoozePresets, isRegeneratingTitle, projectGroup };
}

export type SidebarThreadMenuIntent<G extends SidebarThreadMenuProjectGroup> =
  | { readonly kind: "set-project-scope"; readonly projectKey: string | null }
  | { readonly kind: "open-project-settings"; readonly projectGroup: G }
  | Exclude<HeaderThreadMenuIntent, { readonly kind: "project-settings" }>;

export function resolveSidebarThreadMenuIntent<G extends SidebarThreadMenuProjectGroup>(input: {
  readonly action: ThreadActionMenuId;
  readonly thread: EnvironmentThreadShell;
  readonly menu: SidebarThreadMenu<G>;
  readonly projectScopeKey: string | null;
  readonly projectCwd: string | null;
  readonly confirmThreadArchive: boolean;
  readonly confirmThreadDelete: boolean;
}): SidebarThreadMenuIntent<G> {
  const { projectGroup } = input.menu;
  if (input.action === "filter-by-project") {
    if (!projectGroup) return { kind: "none" };
    return {
      kind: "set-project-scope",
      projectKey:
        input.projectScopeKey === projectGroup.projectKey ? null : projectGroup.projectKey,
    };
  }
  if (input.action === "project-settings") {
    return projectGroup ? { kind: "open-project-settings", projectGroup } : { kind: "none" };
  }
  const intent = resolveHeaderThreadMenuIntent({
    action: input.action,
    thread: input.thread,
    snoozePresets: input.menu.snoozePresets,
    isRegeneratingTitle: input.menu.isRegeneratingTitle,
    projectCwd: input.projectCwd,
    confirmThreadArchive: input.confirmThreadArchive,
    confirmThreadDelete: input.confirmThreadDelete,
  });
  return intent.kind === "project-settings" ? { kind: "none" } : intent;
}

export interface SidebarThreadMenuDeps<G extends SidebarThreadMenuProjectGroup> {
  readonly attemptSnooze: (
    threadRef: ScopedThreadRef,
    preset: Pick<SnoozePreset, "snoozedUntil">,
  ) => void;
  readonly requestCustomSnooze: () => Promise<CustomSnoozeChoice | null>;
  readonly setProjectScopeKey: (projectKey: string | null) => void;
  readonly openProjectSettings: (projectGroup: G) => void;
  readonly openNewThread: (
    projectRef: ScopedProjectRef,
    options: NewThreadOnBranchOptions,
  ) => Promise<unknown>;
  readonly attemptSettle: (threadRef: ScopedThreadRef) => void;
  readonly attemptUnsettle: (threadRef: ScopedThreadRef) => void;
  readonly attemptUnsnooze: (threadRef: ScopedThreadRef) => void;
  readonly attemptPin: (threadRef: ScopedThreadRef) => void;
  readonly attemptUnpin: (threadRef: ScopedThreadRef) => void;
  readonly setThreadAutoSettle: ThreadActions["setThreadAutoSettle"];
  readonly startRename: (threadRef: ScopedThreadRef, title: string) => void;
  readonly regenerateTitle: (threadRef: ScopedThreadRef) => Promise<ThreadActionResult>;
  readonly markThreadUnread: (
    threadKey: string,
    latestTurnCompletedAt: string | null | undefined,
  ) => void;
  readonly copyPath: (path: string) => void;
  readonly copyBranch: (branch: string) => void;
  readonly copyThreadId: (threadId: ThreadId) => void;
  readonly confirm: ThreadConfirm;
  readonly archiveThread: ThreadActions["archiveThread"];
  readonly deleteThread: ThreadActions["deleteThread"];
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

export async function runSidebarThreadMenuIntent<G extends SidebarThreadMenuProjectGroup>(
  intent: SidebarThreadMenuIntent<G>,
  target: { readonly threadRef: ScopedThreadRef; readonly thread: EnvironmentThreadShell },
  deps: SidebarThreadMenuDeps<G>,
): Promise<void> {
  const { threadRef, thread } = target;
  const reportFailure = async (title: string, run: () => Promise<ThreadActionResult>) => {
    const result = await run();
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      deps.addToast(failureToast(title, squashAtomCommandFailure(result)));
    }
  };
  switch (intent.kind) {
    case "snooze":
      deps.attemptSnooze(threadRef, { snoozedUntil: intent.snoozedUntil });
      return;
    case "custom-snooze": {
      const preset = await deps.requestCustomSnooze();
      if (preset) deps.attemptSnooze(threadRef, preset);
      return;
    }
    case "set-project-scope":
      deps.setProjectScopeKey(intent.projectKey);
      return;
    case "open-project-settings":
      deps.openProjectSettings(intent.projectGroup);
      return;
    case "new-thread-on-branch": {
      const result = await settlePromise(() =>
        deps.openNewThread(scopeProjectRef(thread.environmentId, thread.projectId), intent.options),
      );
      if (result._tag === "Failure") {
        deps.addToast(failureToast(intent.failureTitle, squashAtomCommandFailure(result)));
      }
      return;
    }
    case "settle":
      deps.attemptSettle(threadRef);
      return;
    case "unsettle":
      deps.attemptUnsettle(threadRef);
      return;
    case "unsnooze":
      deps.attemptUnsnooze(threadRef);
      return;
    case "pin":
      deps.attemptPin(threadRef);
      return;
    case "unpin":
      deps.attemptUnpin(threadRef);
      return;
    case "set-auto-settle":
      await reportFailure(intent.failureTitle, () =>
        deps.setThreadAutoSettle(threadRef, intent.enabled),
      );
      return;
    case "rename":
      deps.startRename(threadRef, thread.title);
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
      deps.copyPath(intent.path);
      return;
    case "copy-branch":
      deps.copyBranch(intent.branch);
      return;
    case "copy-thread-id":
      deps.copyThreadId(intent.threadId);
      return;
    case "archive": {
      if (intent.confirmMessage !== null) {
        const message = intent.confirmMessage;
        const confirmed = await settlePromise(() => deps.confirm(message));
        if (confirmed._tag === "Failure" || !confirmed.value) return;
      }
      let didArchive = false;
      const result = await deps.archiveThread(threadRef, {
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
      const result = await deps.deleteThread(threadRef);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        deps.addToast(failureToast(intent.failureTitle, squashAtomCommandFailure(result)));
      }
      return;
    }
    case "none":
      return;
  }
}
