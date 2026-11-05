import type { TimestampFormat } from "@t3tools/contracts/settings";
import type { TurnId } from "@t3tools/contracts";
import {
  deriveMessagesTimelineRows,
  resolveAssistantMessageCopyState,
  shouldPreserveAssistantLineBreaks,
  timelineRowBottomPadding,
  deriveUnsettledTurnId,
  type MessagesTimelineRow,
} from "@t3tools/web/src/components/chat/MessagesTimeline.logic.ts";
import { findRecordedWorktreeSetup } from "@t3tools/web/src/components/ChatView.logic.ts";
import {
  resolveAwaitingBootstrapTurn,
  resolveThreadIsCompacting,
  resolveThreadIsWorking,
  resolveThreadTurnState,
} from "@t3tools/web/src/components/chat/threadRunState.logic.ts";
import {
  deriveActiveWorkStartedAt,
  derivePhase,
  deriveTimelineEntries,
  deriveWorkLogEntries,
} from "@t3tools/web/src/session-logic.ts";
import {
  formatChatTimestampTooltip,
  formatDayAwareTimestamp,
} from "@t3tools/web/src/timestampFormat.ts";
import type { ChatFileAttachment, ChatMessage, Thread } from "@t3tools/web/src/types.ts";
import { resolveProposedPlanCardModel } from "@t3tools/web/src/components/chat/ProposedPlanCard.logic.ts";

import { applyMarkdownChips, type InlineSkill } from "./contextChips.ts";
import type { MarkdownDocView } from "./views/markdown.ts";
import { buildMarkdownDocument, type WorkspaceImageResolver } from "./markdownDocument.ts";
import { buildUserRowParts } from "./timelineUserRow.ts";
import {
  buildChangedFilesCardView,
  buildWorkRowView,
  type TimelineWorkContext,
  type TimelineWorkExpansion,
} from "./timelineWorkView.ts";
import type { TimelineRowEntry, TimelineRowView, TimelineUserImageView } from "./views/timeline.ts";
import type { MediaVideoView } from "./views/media.ts";

export type TimelineExpansion = TimelineWorkExpansion & {
  readonly turnIds: ReadonlySet<TurnId>;
  readonly workGroupIds: ReadonlySet<string>;
  readonly planIds: ReadonlySet<string>;
  readonly userMessageIds: ReadonlySet<string>;
};

type RowContext = {
  readonly workspaceRoot: string | undefined;
  readonly timestampFormat: TimestampFormat;
  readonly revertDisabled: boolean;
  readonly expandedPlanIds: ReadonlySet<string>;
  readonly userImageUrls: (message: ChatMessage) => ReadonlyArray<TimelineUserImageView>;
  readonly userVideo: (file: ChatFileAttachment) => MediaVideoView | null;
  readonly wordWrap: boolean;
  readonly canRunShellCommands: boolean;
  readonly work: TimelineWorkContext;
  readonly skills: ReadonlyArray<InlineSkill>;
  readonly expandedUserMessageIds: ReadonlySet<string>;
};

function rowView(row: MessagesTimelineRow, context: RowContext): TimelineRowView | null {
  const { workspaceRoot, timestampFormat } = context;
  const time = (iso: string) => formatDayAwareTimestamp(iso, timestampFormat);
  const tooltip = (iso: string) => formatChatTimestampTooltip(iso, timestampFormat);
  const withSkills = (document: MarkdownDocView) =>
    applyMarkdownChips(document, { skills: context.skills, resolveReference: null });
  switch (row.kind) {
    case "message": {
      const message = row.message;
      if (message.role === "user") {
        const parts = buildUserRowParts({
          message,
          imageUrls: context.userImageUrls(message),
          videoView: context.userVideo,
          workspaceRoot,
          wordWrap: context.wordWrap,
          resolveImage: context.work.resolveImage,
          skills: context.skills,
          expanded: context.expandedUserMessageIds.has(message.id),
        });
        return {
          kind: "user",
          id: row.id,
          messageId: message.id,
          ...parts,
          revertTurnCount: row.revertTurnCount ?? null,
          revertDisabled: context.revertDisabled,
          timeLabel: time(message.createdAt),
          timeTooltip: tooltip(message.createdAt),
        };
      }
      if (message.role === "reasoning") {
        if (message.text.trim().length === 0) return null;
        const expanded = context.work.expansion.reasoningMessageIds.has(message.id);
        return {
          kind: "reasoning",
          id: row.id,
          messageId: message.id,
          expanded,
          document: expanded
            ? withSkills(
                buildMarkdownDocument(
                  message.text,
                  {
                    cwd: workspaceRoot,
                    lineBreaks: true,
                    streaming: false,
                    wordWrap: context.wordWrap,
                    canRunShellCommands: false,
                  },
                  context.work.resolveImage,
                ),
              )
            : null,
          timeLabel: time(message.createdAt),
        };
      }
      const assistantText = message.text || (message.streaming ? "" : "(empty response)");
      const copy = resolveAssistantMessageCopyState({
        text: message.text ?? null,
        showCopyButton: row.showAssistantCopyButton,
        streaming: row.assistantCopyStreaming,
      });
      return {
        kind: "assistant",
        id: row.id,
        document: withSkills(
          buildMarkdownDocument(
            assistantText,
            {
              cwd: workspaceRoot,
              lineBreaks: shouldPreserveAssistantLineBreaks(assistantText),
              streaming: message.streaming,
              wordWrap: context.wordWrap,
              canRunShellCommands: context.canRunShellCommands,
            },
            context.work.resolveImage,
          ),
        ),
        copyText: copy.visible ? copy.text : null,
        streaming: message.streaming,
        showMeta: row.showAssistantMeta,
        showCopyButton: row.showAssistantCopyButton,
        timeLabel: time(message.updatedAt ?? message.createdAt),
        timeTooltip: tooltip(message.updatedAt ?? message.createdAt),
        changedFiles: buildChangedFilesCardView(row.assistantTurnDiffSummary, context.work),
      };
    }
    case "assistant-meta": {
      const copy = resolveAssistantMessageCopyState({
        text: row.message.text ?? null,
        showCopyButton: row.showAssistantCopyButton,
        streaming: row.assistantCopyStreaming,
      });
      return {
        kind: "assistant-meta",
        id: row.id,
        showCopyButton: row.showAssistantCopyButton,
        copyText: copy.visible ? copy.text : null,
        timeLabel: time(row.message.updatedAt ?? row.message.createdAt),
        timeTooltip: tooltip(row.message.updatedAt ?? row.message.createdAt),
      };
    }
    case "turn-fold":
      return {
        kind: "turn-fold",
        id: row.id,
        turnId: row.turnId,
        label: row.label,
        expanded: row.expanded,
        timeLabel: time(row.createdAt),
        timeTooltip: tooltip(row.createdAt),
      };
    case "work-toggle":
    case "work":
    case "work-live":
    case "activity-group":
    case "working":
    case "thinking":
    case "context-compaction":
      return buildWorkRowView(row, context.work);
    case "proposed-plan": {
      const card = resolveProposedPlanCardModel(row.proposedPlan.planMarkdown);
      const expanded = context.expandedPlanIds.has(row.proposedPlan.id);
      return {
        kind: "proposed-plan",
        id: row.id,
        planId: row.proposedPlan.id,
        title: card.title,
        markdown:
          card.canCollapse && !expanded ? (card.collapsedPreview ?? "") : card.displayedMarkdown,
        canCollapse: card.canCollapse,
        expanded,
        copyText: card.saveContents,
        downloadFilename: card.downloadFilename,
        canSave: workspaceRoot !== undefined && workspaceRoot.length > 0,
      };
    }
    case "worktree-setup":
    case "queued-message":
      return null;
  }
}

export function buildTimelineRows(input: {
  readonly thread: Thread;
  readonly optimisticUserMessages: ReadonlyArray<ChatMessage>;
  readonly isSendBusy: boolean;
  readonly isRevertingCheckpoint: boolean;
  readonly localDispatchStartedAt: string | null;
  readonly supportsConversationRollback: boolean;
  readonly workspaceRoot: string | undefined;
  readonly timestampFormat: TimestampFormat;
  readonly expansion: TimelineExpansion;
  readonly userImageUrls: (message: ChatMessage) => ReadonlyArray<TimelineUserImageView>;
  readonly userVideo: (file: ChatFileAttachment) => MediaVideoView | null;
  readonly changedFilesExpandedByTurnId: Readonly<Record<string, boolean>>;
  readonly wordWrap: boolean;
  readonly canRunShellCommands: boolean;
  readonly resolveImage: WorkspaceImageResolver;
  readonly skills: ReadonlyArray<InlineSkill>;
}): TimelineRowEntry[] {
  const { thread } = input;
  const { activeLatestTurn, activeRunningTurnId } = resolveThreadTurnState(thread);
  const phase = derivePhase(thread.session ?? null);
  const isCompacting = resolveThreadIsCompacting({
    thread,
    activeLatestTurn,
    phase,
    isSendBusy: input.isSendBusy,
    optimisticUserMessages: input.optimisticUserMessages,
  });
  const awaitingBootstrapTurn = resolveAwaitingBootstrapTurn({
    serverThread: thread,
    routeThreadId: thread.id,
    recordedWorktreeSetup: findRecordedWorktreeSetup(thread.activities, thread.id),
  });
  const isWorking = resolveThreadIsWorking({
    phase,
    isSendBusy: input.isSendBusy,
    isConnecting: false,
    isRevertingCheckpoint: input.isRevertingCheckpoint,
    isCompacting,
    awaitingBootstrapTurn,
  });
  const serverIds = new Set(thread.messages.map((message) => message.id));
  const pendingMessages = input.optimisticUserMessages.filter(
    (message) => !serverIds.has(message.id),
  );
  const messages =
    pendingMessages.length === 0 ? thread.messages : [...thread.messages, ...pendingMessages];
  const latestUserMessageAt =
    thread.messages.findLast((message) => message.role === "user")?.createdAt ?? null;
  const activeWorkStartedAt = deriveActiveWorkStartedAt(
    activeLatestTurn,
    thread.session ?? null,
    input.localDispatchStartedAt,
    latestUserMessageAt,
  );
  const timelineEntries = deriveTimelineEntries(
    messages,
    thread.proposedPlans,
    deriveWorkLogEntries(thread.activities),
  );
  const rows = deriveMessagesTimelineRows({
    timelineEntries,
    latestTurn: activeLatestTurn,
    runningTurnId: activeRunningTurnId,
    expandedTurnIds: input.expansion.turnIds,
    expandedWorkGroupIds: input.expansion.workGroupIds,
    isWorking,
    activeTurnStartedAt: activeWorkStartedAt,
    turnDiffSummaries: thread.checkpoints,
    supportsConversationRollback: input.supportsConversationRollback,
  });
  const work: TimelineWorkContext = {
    workspaceRoot: input.workspaceRoot,
    timestampFormat: input.timestampFormat,
    threadId: thread.id,
    expansion: input.expansion,
    changedFilesExpandedByTurnId: input.changedFilesExpandedByTurnId,
    isWorking,
    unsettledTurnId: deriveUnsettledTurnId(activeLatestTurn, activeRunningTurnId),
    isCompacting,
    isPreparingWorktree: awaitingBootstrapTurn,
    wordWrap: input.wordWrap,
    resolveImage: input.resolveImage,
  };
  return rows.flatMap((row) => {
    const view = rowView(row, {
      workspaceRoot: input.workspaceRoot,
      timestampFormat: input.timestampFormat,
      revertDisabled: input.isRevertingCheckpoint || isWorking,
      expandedPlanIds: input.expansion.planIds,
      userImageUrls: input.userImageUrls,
      userVideo: input.userVideo,
      wordWrap: input.wordWrap,
      canRunShellCommands: input.canRunShellCommands,
      work,
      skills: input.skills,
      expandedUserMessageIds: input.expansion.userMessageIds,
    });
    return view === null ? [] : [{ ...view, paddingBottom: timelineRowBottomPadding(row) }];
  });
}
