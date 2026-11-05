import type { ThreadId } from "@t3tools/contracts";
import type { NotificationMode } from "@t3tools/contracts/settings";

import { resolveSidebarThreadStatus, type SidebarThreadStatus } from "./components/Sidebar.logic";
import type { SidebarThreadSummary } from "./types";

export const NOTIFICATION_MODE_LABELS = {
  off: "Off",
  notifications: "Notifications only",
  sound: "Sound only",
  "notifications-and-sound": "Notifications with sound",
} satisfies Record<NotificationMode, string>;

export function hasNotificationSound(mode: NotificationMode) {
  return mode === "sound" || mode === "notifications-and-sound";
}

export function hasDesktopNotifications(mode: NotificationMode) {
  return mode === "notifications" || mode === "notifications-and-sound";
}

export type ThreadNotificationThread = Pick<
  SidebarThreadSummary,
  "hasPendingApprovals" | "hasPendingUserInput" | "session" | "backgroundLiveness"
> & {
  readonly id: ThreadId;
  readonly title: string;
  readonly archivedAt: string | null;
  readonly latestTurn: {
    readonly turnId: string;
    readonly state: string;
    readonly completedAt: string | null;
  } | null;
};

export type ThreadNotificationMemory = {
  readonly attention: string | null;
  readonly completion: number | null;
};

export type ThreadNotificationKind = "completion" | "input";

export type ThreadNotificationEvent = {
  readonly threadId: ThreadId;
  readonly threadTitle: string;
  readonly kind: ThreadNotificationKind;
  readonly status: SidebarThreadStatus;
  readonly title: string;
  readonly toastType: "success" | "error" | "warning";
};

export function resolveThreadNotificationEvents(
  previous: ReadonlyMap<ThreadId, ThreadNotificationMemory>,
  threads: ReadonlyArray<ThreadNotificationThread>,
): {
  readonly next: Map<ThreadId, ThreadNotificationMemory>;
  readonly events: ReadonlyArray<ThreadNotificationEvent>;
} {
  const next = new Map<ThreadId, ThreadNotificationMemory>();
  const events: ThreadNotificationEvent[] = [];
  for (const thread of threads) {
    let status = resolveSidebarThreadStatus(thread);
    if (status === "ready" && thread.latestTurn?.state === "error") status = "failed";
    const prior = previous.get(thread.id);
    const attention =
      status === "input" || status === "approval" || status === "failed"
        ? `${thread.latestTurn?.turnId ?? ""}:${status}`
        : null;
    const completedAt = Date.parse(thread.latestTurn?.completedAt ?? "");
    const completion =
      status === "ready" && thread.latestTurn?.state === "completed" && Number.isFinite(completedAt)
        ? completedAt
        : (prior?.completion ?? null);
    next.set(thread.id, { attention, completion });
    if (!prior || thread.archivedAt !== null) continue;
    const kind =
      attention && attention !== prior.attention
        ? "input"
        : completion !== null && (prior.completion === null || completion > prior.completion)
          ? "completion"
          : null;
    if (!kind) continue;
    events.push({
      threadId: thread.id,
      threadTitle: thread.title,
      kind,
      status,
      title:
        kind === "completion"
          ? "Thread completed"
          : status === "approval"
            ? "Approval needed"
            : status === "failed"
              ? "Thread failed"
              : "Input needed",
      toastType: kind === "completion" ? "success" : status === "failed" ? "error" : "warning",
    });
  }
  return { next, events };
}
