import type { ContextMenuItem, ThreadId } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  canSnooze,
  effectiveSnoozed,
  type SnoozePreset,
} from "@t3tools/client-runtime/state/thread-settled";

import { resolveSnoozePresets } from "./Sidebar.snooze";

/**
 * Ids for the per-thread action menu. Snooze presets are dispatched as
 * `snooze:<presetId>` so the union stays closed while the preset list
 * remains data-driven.
 */
export type ThreadActionMenuId =
  | "new-thread-on-branch"
  | "filter-by-project"
  | "project-settings"
  | "pin"
  | "unpin"
  | "settle"
  | "unsettle"
  | "auto-settle"
  | "auto-settle:enabled"
  | "auto-settle:disabled"
  | "snooze"
  | `snooze:${string}`
  | "unsnooze"
  | "rename"
  | "regenerate-title"
  | "mark-unread"
  | "copy"
  | "copy-path"
  | "copy-branch"
  | "copy-thread-id"
  | "archive"
  | "delete";

export interface ThreadActionMenuState {
  readonly branch: string | null;
  /**
   * Project scoping for the thread list. Null on surfaces with no scoped
   * list behind the menu (the chat header), where the item must not show.
   */
  readonly projectFilter: {
    readonly label: string;
    /** True when the list is already scoped to this thread's project. */
    readonly isActive: boolean;
  } | null;
  readonly isPinned: boolean;
  readonly isSettled: boolean;
  /** False while the user has turned automatic settlement off for this thread. */
  readonly autoSettleEnabled: boolean;
  readonly isSnoozed: boolean;
  readonly canSnoozeNow: boolean;
  readonly isRegeneratingTitle: boolean;
  /** Archive rejects a thread with an active turn, so disable it here rather than let the action fail. */
  readonly isRunning: boolean;
  readonly supports: {
    readonly settlement: boolean;
    /** Server understands thread.auto-settle.set. */
    readonly autoSettleOptOut: boolean;
    readonly snooze: boolean;
    readonly pinning: boolean;
    readonly titleRegeneration: boolean;
  };
  readonly snoozePresets: ReadonlyArray<SnoozePreset>;
}

/**
 * Single source for the per-thread action menu: the sidebar row's right-click
 * menu and the chat header menu share labels, ordering, and capability gating.
 * Each surface supplies state for the actions it supports.
 */
export function buildThreadActionMenuItems(
  state: ThreadActionMenuState,
): ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> {
  return [
    ...(state.branch
      ? [
          {
            id: "new-thread-on-branch" as const,
            label: `New thread on ${state.branch}`,
            icon: "message-square-plus",
          },
        ]
      : []),
    ...(state.supports.pinning
      ? [
          state.isPinned
            ? { id: "unpin" as const, label: "Unpin thread", icon: "pin-off" }
            : { id: "pin" as const, label: "Pin thread", icon: "pin" },
        ]
      : []),
    // Both lifecycle actions stay available on pinned threads: settling
    // clears the pin ("done" beats "keep on top"), and snoozing hides the
    // card until wake with the pin intact.
    ...(state.supports.settlement
      ? [
          state.isSettled
            ? { id: "unsettle" as const, label: "Un-settle thread", icon: "circle-check" }
            : { id: "settle" as const, label: "Settle thread", icon: "circle-check" },
        ]
      : []),
    ...(state.supports.snooze
      ? [
          state.isSnoozed
            ? { id: "unsnooze" as const, label: "Wake thread", icon: "clock" }
            : {
                id: "snooze" as const,
                label: "Snooze",
                icon: "clock",
                disabled: !state.canSnoozeNow,
                children: [
                  ...state.snoozePresets.map((preset) => ({
                    id: `snooze:${preset.id}` as const,
                    label: `${preset.label} (${preset.whenLabel})`,
                  })),
                  { id: "snooze:custom" as const, label: "Custom…", separatorBefore: true },
                ],
              },
        ]
      : []),
    { id: "rename", label: "Rename thread", icon: "pencil", separatorBefore: true },
    ...(state.supports.titleRegeneration
      ? [
          {
            id: "regenerate-title" as const,
            label: state.isRegeneratingTitle ? "Regenerating…" : "Regenerate title",
            icon: "refresh-cw",
            disabled: state.isRegeneratingTitle,
          },
        ]
      : []),
    { id: "mark-unread", label: "Mark unread", icon: "mail-open" },
    ...(state.projectFilter
      ? [
          {
            id: "filter-by-project" as const,
            label: state.projectFilter.isActive
              ? "Show all projects"
              : `Filter by ${state.projectFilter.label}`,
            icon: "folder-tree",
          },
        ]
      : []),
    // A submenu with the current option checked, not a one-shot action:
    // this is a setting, and it sits with the other per-thread settings
    // rather than the lifecycle verbs above. Disabled keeps long-running
    // threads out of the settled shelf no matter how quiet they get.
    ...(state.supports.autoSettleOptOut
      ? [
          {
            id: "auto-settle" as const,
            label: "Auto-settle behavior",
            icon: "timer",
            children: [
              {
                id: "auto-settle:enabled" as const,
                label: "Enabled",
                checked: state.autoSettleEnabled,
              },
              {
                id: "auto-settle:disabled" as const,
                label: "Disabled",
                checked: !state.autoSettleEnabled,
              },
            ],
          },
        ]
      : []),
    {
      id: "copy",
      label: "Copy",
      icon: "copy",
      separatorBefore: true,
      children: [
        { id: "copy-path", label: "Path", icon: "folder" },
        ...(state.branch
          ? [{ id: "copy-branch" as const, label: "Branch", icon: "git-branch" }]
          : []),
        { id: "copy-thread-id", label: "Thread ID", icon: "hash" },
      ],
    },
    { id: "project-settings", label: "Project settings", icon: "settings" },
    // Archive removes the thread from the sidebar while keeping its
    // conversation under Settings > Archived threads — distinct from Settle
    // (stays visible in the Settled shelf) and Delete (clears history for
    // good), so it sits beside Delete without borrowing its destructive
    // styling.
    {
      id: "archive",
      label: "Archive thread",
      icon: "archive",
      disabled: state.isRunning,
      separatorBefore: true,
    },
    {
      id: "delete",
      label: "Delete",
      destructive: true,
      icon: "trash",
    },
  ];
}

interface CopyToastTitles {
  readonly success: string;
  readonly failure: string;
}

export const THREAD_MENU_COPY_TOASTS: {
  readonly path: CopyToastTitles;
  readonly branch: CopyToastTitles;
  readonly threadId: CopyToastTitles;
} = {
  path: { success: "Path copied", failure: "Failed to copy path" },
  branch: { success: "Branch copied", failure: "Failed to copy branch" },
  threadId: { success: "Thread ID copied", failure: "Failed to copy thread ID" },
};

export type ThreadActionMenuSupports = ThreadActionMenuState["supports"];

export interface HeaderThreadActionMenu {
  readonly items: ReadonlyArray<ContextMenuItem<ThreadActionMenuId>>;
  readonly snoozePresets: ReadonlyArray<SnoozePreset>;
  readonly isRegeneratingTitle: boolean;
}

/**
 * The chat header's snapshot of the per-thread menu. It has no project-scoped
 * thread list behind it, so "Filter by project" stays sidebar-only.
 */
export function buildHeaderThreadActionMenu(input: {
  readonly thread: EnvironmentThreadShell;
  readonly supports: ThreadActionMenuSupports;
  readonly now: Date;
  readonly timestampFormat: TimestampFormat;
}): HeaderThreadActionMenu {
  const { thread, supports, now } = input;
  const isRegeneratingTitle = thread.titleRegeneration != null;
  const snoozePresets = resolveSnoozePresets(now, input.timestampFormat);
  const items = buildThreadActionMenuItems({
    branch: thread.branch ?? null,
    projectFilter: null,
    isPinned: thread.pinnedAt != null,
    isSettled: supports.settlement && thread.settledOverride === "settled",
    autoSettleEnabled: thread.autoSettleDisabledAt == null,
    isSnoozed: supports.snooze && effectiveSnoozed(thread, { now: now.toISOString() }),
    canSnoozeNow: canSnooze(thread, { now: now.toISOString() }),
    isRegeneratingTitle,
    isRunning: thread.session?.status === "running" && thread.session.activeTurnId != null,
    supports,
    snoozePresets,
  });
  return { items, snoozePresets, isRegeneratingTitle };
}

export type HeaderThreadMenuIntent =
  | { readonly kind: "none" }
  | { readonly kind: "snooze"; readonly snoozedUntil: string; readonly failureTitle: string }
  | { readonly kind: "custom-snooze"; readonly failureTitle: string }
  | { readonly kind: "project-settings" }
  | {
      readonly kind: "new-thread-on-branch";
      readonly options: {
        readonly branch: string | null;
        readonly worktreePath: string | null;
        readonly envMode: "worktree" | "local";
        readonly startFromOrigin: false;
      };
      readonly failureTitle: string;
    }
  | {
      readonly kind: "settle" | "unsettle" | "unsnooze" | "pin" | "unpin" | "regenerate-title";
      readonly failureTitle: string;
    }
  | { readonly kind: "set-auto-settle"; readonly enabled: boolean; readonly failureTitle: string }
  | { readonly kind: "rename" }
  | { readonly kind: "mark-unread"; readonly latestTurnCompletedAt: string | null | undefined }
  | { readonly kind: "copy-path"; readonly path: string }
  | { readonly kind: "copy-path-unavailable"; readonly title: string; readonly description: string }
  | { readonly kind: "copy-branch"; readonly branch: string }
  | { readonly kind: "copy-thread-id"; readonly threadId: ThreadId }
  | {
      readonly kind: "archive";
      readonly confirmMessage: string | null;
      readonly failureTitle: string;
      readonly archivedFailureTitle: string;
    }
  | {
      readonly kind: "delete";
      readonly confirmMessage: string | null;
      readonly failureTitle: string;
    };

export function resolveHeaderThreadMenuIntent(input: {
  readonly action: ThreadActionMenuId;
  readonly thread: EnvironmentThreadShell;
  readonly snoozePresets: ReadonlyArray<SnoozePreset>;
  readonly isRegeneratingTitle: boolean;
  readonly projectCwd: string | null;
  readonly confirmThreadArchive: boolean;
  readonly confirmThreadDelete: boolean;
}): HeaderThreadMenuIntent {
  const { action, thread } = input;
  if (action.startsWith("snooze:")) {
    if (action === "snooze:custom") {
      return { kind: "custom-snooze", failureTitle: "Failed to snooze thread" };
    }
    const preset = input.snoozePresets.find((candidate) => `snooze:${candidate.id}` === action);
    return preset
      ? {
          kind: "snooze",
          snoozedUntil: preset.snoozedUntil,
          failureTitle: "Failed to snooze thread",
        }
      : { kind: "none" };
  }
  switch (action) {
    case "project-settings":
      return { kind: "project-settings" };
    case "new-thread-on-branch":
      // Explicit branch carry-over: reuse the thread's worktree when it
      // has one, otherwise its branch on the local checkout.
      return {
        kind: "new-thread-on-branch",
        options: {
          branch: thread.branch,
          worktreePath: thread.worktreePath,
          envMode: thread.worktreePath ? "worktree" : "local",
          startFromOrigin: false,
        },
        failureTitle: "Could not create thread",
      };
    case "settle":
      return { kind: "settle", failureTitle: "Failed to settle thread" };
    case "unsettle":
      return { kind: "unsettle", failureTitle: "Failed to un-settle thread" };
    case "unsnooze":
      return { kind: "unsnooze", failureTitle: "Failed to wake thread" };
    case "pin":
      return { kind: "pin", failureTitle: "Failed to pin thread" };
    case "unpin":
      return { kind: "unpin", failureTitle: "Failed to unpin thread" };
    case "auto-settle:enabled":
    case "auto-settle:disabled":
      return {
        kind: "set-auto-settle",
        enabled: action === "auto-settle:enabled",
        failureTitle: "Failed to update auto-settle",
      };
    case "rename":
      return { kind: "rename" };
    case "regenerate-title":
      return input.isRegeneratingTitle
        ? { kind: "none" }
        : { kind: "regenerate-title", failureTitle: "Failed to regenerate thread title" };
    case "mark-unread":
      return { kind: "mark-unread", latestTurnCompletedAt: thread.latestTurn?.completedAt };
    case "copy-path": {
      const workspacePath = thread.worktreePath ?? input.projectCwd;
      if (!workspacePath) {
        return {
          kind: "copy-path-unavailable",
          title: "Path unavailable",
          description: "This thread does not have a workspace path to copy.",
        };
      }
      return { kind: "copy-path", path: workspacePath };
    }
    case "copy-branch":
      return thread.branch ? { kind: "copy-branch", branch: thread.branch } : { kind: "none" };
    case "copy-thread-id":
      return { kind: "copy-thread-id", threadId: thread.id };
    case "archive":
      return {
        kind: "archive",
        confirmMessage: input.confirmThreadArchive ? `Archive thread "${thread.title}"?` : null,
        failureTitle: "Failed to archive thread",
        archivedFailureTitle: "Thread archived, but navigation failed",
      };
    case "delete":
      return {
        kind: "delete",
        confirmMessage: input.confirmThreadDelete
          ? [
              `Delete thread "${thread.title}"?`,
              "This permanently clears conversation history for this thread.",
            ].join("\n")
          : null,
        failureTitle: "Failed to delete thread",
      };
    default:
      return { kind: "none" };
  }
}
