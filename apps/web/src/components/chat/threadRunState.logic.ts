import type { ServerProvider, ThreadId, WorktreeSetupSnapshot } from "@t3tools/contracts";

import type { ChatMessage, SessionPhase, Thread } from "../../types";
import { latestTurnStartFailureId } from "../ChatView.logic";

export function resolveThreadTurnState(thread: Pick<Thread, "latestTurn" | "session"> | undefined) {
  const activeLatestTurn = thread?.latestTurn ?? null;
  const activeRunningTurnId =
    (thread?.session?.status === "running" ? thread.session.activeTurnId : null) ??
    (activeLatestTurn?.state === "running" ? activeLatestTurn.turnId : null);
  return { activeLatestTurn, activeRunningTurnId };
}

export function resolveThreadIsWorking(input: {
  readonly phase: SessionPhase;
  readonly isSendBusy: boolean;
  readonly isConnecting: boolean;
  readonly isRevertingCheckpoint: boolean;
  readonly isCompacting: boolean;
  readonly awaitingBootstrapTurn: boolean;
}): boolean {
  return (
    input.phase === "running" ||
    input.isSendBusy ||
    input.isConnecting ||
    input.isRevertingCheckpoint ||
    input.isCompacting ||
    input.awaitingBootstrapTurn
  );
}

export function isCompactCommandMessage(message: ChatMessage): boolean {
  const text = message.text.trim().toLowerCase();
  return message.role === "user" && text === "/compact" && !message.attachments?.length;
}

export function resolveThreadIsCompacting(input: {
  readonly thread: Thread | undefined;
  readonly activeLatestTurn: Thread["latestTurn"];
  readonly phase: SessionPhase;
  readonly isSendBusy: boolean;
  readonly optimisticUserMessages: ReadonlyArray<ChatMessage>;
}): boolean {
  const { thread, activeLatestTurn, phase, isSendBusy } = input;
  const optimisticCompactionMessage = input.optimisticUserMessages.at(-1);
  const pendingCompactionMessage =
    isSendBusy &&
    optimisticCompactionMessage !== undefined &&
    isCompactCommandMessage(optimisticCompactionMessage)
      ? optimisticCompactionMessage
      : thread?.messages.findLast(isCompactCommandMessage);
  const compactRequestIsActive =
    pendingCompactionMessage !== undefined &&
    (pendingCompactionMessage.createdAt >
      (activeLatestTurn?.requestedAt ?? pendingCompactionMessage.createdAt) ||
      (activeLatestTurn?.state === "running" &&
        pendingCompactionMessage.createdAt === activeLatestTurn.requestedAt));
  const compactionSettled =
    pendingCompactionMessage !== undefined &&
    (latestTurnStartFailureId(thread, pendingCompactionMessage.id) !== null ||
      thread?.activities.some((activity) => {
        if (activity.kind !== "context-compaction") return false;
        const payload = activity.payload as { readonly requestId?: unknown } | null | undefined;
        return payload?.requestId === pendingCompactionMessage.id;
      }));
  return (
    (isSendBusy || phase === "connecting" || phase === "running") &&
    compactRequestIsActive &&
    !compactionSettled
  );
}

// The server records a running worktree setup on the thread for the whole
// bootstrap window. That record, with no turn yet, is how a reload or another
// client sees a worktree still being prepared, so it counts as working like
// the local dispatch that started it. It settles on every failure path and
// on restart, so this cannot outlive the setup. The placeholder "starting"
// session is not used here: an ordinary first turn projects one too, and it
// already drives the connecting state on its own.
export function resolveAwaitingBootstrapTurn(input: {
  readonly serverThread: Thread | null | undefined;
  readonly routeThreadId: ThreadId;
  readonly recordedWorktreeSetup: WorktreeSetupSnapshot | null;
}): boolean {
  return (
    input.serverThread !== null &&
    input.serverThread !== undefined &&
    input.serverThread.id === input.routeThreadId &&
    input.serverThread.latestTurn === null &&
    input.recordedWorktreeSetup?.phase === "running"
  );
}

export function resolveSupportsConversationRollback(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly sessionProviderInstanceId: ServerProvider["instanceId"] | null | undefined;
  readonly activeProvider: ServerProvider | null;
}): boolean {
  const conversationProvider =
    input.providers.find((status) => status.instanceId === input.sessionProviderInstanceId) ??
    input.activeProvider;
  return (
    conversationProvider !== null && conversationProvider.supportsConversationRollback !== false
  );
}

export interface ThreadCompactAvailability {
  readonly unavailable: boolean;
  readonly disabledReason: string | null;
}

export function resolveThreadCompactAvailability(input: {
  readonly thread: Pick<Thread, "messages"> | null | undefined;
  readonly hasProject: boolean;
  readonly isServerThread: boolean;
  readonly manualCompactionProviderAvailable: boolean;
  readonly isWorking: boolean;
  readonly threadDetailLoading: boolean;
  readonly isPreparingWorktree: boolean;
  readonly environmentUnavailable: boolean;
  readonly feedbackUploading: boolean;
  readonly pendingApprovalCount: number;
  readonly pendingUserInputCount: number;
  readonly showPlanFollowUpPrompt: boolean;
}): ThreadCompactAvailability {
  const hasCompactableConversation =
    input.thread?.messages.some(
      (message) => message.role === "user" && !isCompactCommandMessage(message),
    ) ?? false;
  const unavailable =
    !input.thread ||
    !hasCompactableConversation ||
    !input.hasProject ||
    !input.isServerThread ||
    !input.manualCompactionProviderAvailable ||
    input.isWorking ||
    input.threadDetailLoading ||
    input.isPreparingWorktree ||
    input.environmentUnavailable ||
    input.feedbackUploading ||
    input.pendingApprovalCount > 0 ||
    input.pendingUserInputCount > 0 ||
    input.showPlanFollowUpPrompt;
  return {
    unavailable,
    disabledReason: unavailable
      ? !input.hasProject
        ? "Choose a project before compacting"
        : !input.manualCompactionProviderAvailable
          ? "Compaction is unavailable for this provider"
          : "Compacting is unavailable right now"
      : null,
  };
}
