import type { ThreadId, ToolActivityIcon, TurnId } from "@t3tools/contracts";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import {
  omitSupersededLifecycleMarkers,
  resolveViewedImageAsset,
  workEntryViewedImagePath,
} from "@t3tools/client-runtime/work-log/presentation";
import {
  getQuestionAnswerPreview,
  getQuestionTextPreview,
  hasQuestionAnswer,
} from "@t3tools/client-runtime/work-log/user-input";
import { toolActivityFaviconUrl } from "@t3tools/shared/favicon";
import {
  buildChangedFilesCardModel,
  buildChangedFilesTreeModel,
  INITIAL_CHANGED_FILES_EXPANSION_STATE,
  type ChangedFilesExpansionState,
  type ChangedFilesTreeNodeModel,
} from "@t3tools/web/src/components/chat/ChangedFilesTree.logic.ts";
import {
  buildDiffStatLabelModel,
  type DiffStat,
} from "@t3tools/web/src/components/chat/DiffStatLabel.logic.ts";
import {
  buildActivityGroupHeaderModel,
  buildPlainWorkEntryRowModel,
  formatWorkingTimerNow,
  liveWorkEntryLabel,
  thoughtPreviewText,
  toolGroupSummaryIconName,
  toolIconAcceptsTint,
  workEntryIconName,
  workEntryIsVisibleInGroup,
  type MessagesTimelineRow,
  type WorkEntryIconName,
} from "@t3tools/web/src/components/chat/MessagesTimeline.logic.ts";
import {
  workEntryDisplayIndicatesToolFailure,
  type WorkLogEntry,
} from "@t3tools/web/src/session-logic.ts";
import { formatDayAwareTimestamp } from "@t3tools/web/src/timestampFormat.ts";
import type { ChatMessage, TurnDiffSummary } from "@t3tools/web/src/types.ts";

import { buildMarkdownDocument, type WorkspaceImageResolver } from "./markdownDocument.ts";
import { resolvePierreFileIcon } from "./pierreIcon.ts";
import type {
  TimelineActivityDetailView,
  TimelineChangedFilesCardView,
  TimelineChangedFilesNodeView,
  TimelineDiffStatView,
  TimelineLiveActivityView,
  TimelineWorkEntryView,
  TimelineWorkIconView,
  TimelineWorkRowView,
} from "./views/timelineWork.ts";

export type TimelineWorkExpansion = {
  readonly workEntryIds: ReadonlySet<string>;
  readonly reasoningMessageIds: ReadonlySet<string>;
  readonly changedFilesDirectories: ReadonlyMap<string, ChangedFilesExpansionState>;
};

export type TimelineWorkContext = {
  readonly workspaceRoot: string | undefined;
  readonly timestampFormat: TimestampFormat;
  readonly threadId: ThreadId;
  readonly expansion: TimelineWorkExpansion;
  readonly changedFilesExpandedByTurnId: Readonly<Record<string, boolean>>;
  readonly isWorking: boolean;
  readonly unsettledTurnId: TurnId | null;
  readonly isCompacting: boolean;
  readonly isPreparingWorktree: boolean;
  readonly wordWrap: boolean;
  readonly resolveImage: WorkspaceImageResolver;
};

export function workIconView(
  name: WorkEntryIconName,
  toolIcon: ToolActivityIcon | undefined,
): TimelineWorkIconView {
  if (toolIcon === undefined) return { name, imageUrl: null, imageUrlDark: null };
  switch (toolIcon._tag) {
    case "website":
      return {
        name,
        imageUrl: toolActivityFaviconUrl(toolIcon, "light", 32),
        imageUrlDark: toolActivityFaviconUrl(toolIcon, "dark", 32),
      };
    case "themed-logo":
      return {
        name,
        imageUrl: toolIcon.logoUrl,
        imageUrlDark: toolIcon.logoUrlDark ?? toolIcon.logoUrl,
      };
    case "native-app":
      return { name, imageUrl: null, imageUrlDark: null };
  }
}

function workEntryView(
  entry: WorkLogEntry,
  context: TimelineWorkContext,
  displayLabel: string | undefined,
): TimelineWorkEntryView {
  const expanded = context.expansion.workEntryIds.has(entry.id);
  const viewedImagePath = workEntryViewedImagePath(entry);
  const viewedImage =
    viewedImagePath === null
      ? null
      : resolveViewedImageAsset(viewedImagePath, {
          threadId: context.threadId,
          workspaceRoot: context.workspaceRoot,
        });
  const model = buildPlainWorkEntryRowModel({
    workEntry: entry,
    workspaceRoot: context.workspaceRoot,
    displayLabel,
    viewedImagePath: viewedImage ? viewedImagePath : null,
    expanded,
  });
  return {
    id: entry.id,
    label: model.previewText,
    answerPreview: model.answerPreview,
    answerHighlighted: model.answerHighlighted,
    icon: workIconView(model.entryIconName, model.entryToolIcon),
    iconTone: model.iconTone,
    headingTone: model.headingTone,
    showTrailingFailureMark: model.showTrailingFailureMark,
    canExpand: model.canExpand,
    expanded,
    expandedBody: expanded && model.canExpand && !entry.questionAnswer ? model.expandedBody : null,
    timeLabel: formatDayAwareTimestamp(entry.createdAt, context.timestampFormat),
  };
}

function liveActivityView(input: {
  readonly label: string;
  readonly answerPreview: string | null;
  readonly iconName: WorkEntryIconName;
  readonly toolIcon: ToolActivityIcon | undefined;
  readonly failed: boolean;
  readonly active: boolean;
  readonly shimmer: boolean;
}): TimelineLiveActivityView {
  const animated = input.active && !input.failed;
  return {
    label: input.label,
    answerPreview: input.answerPreview,
    icon: workIconView(input.iconName, input.toolIcon),
    failed: input.failed,
    showTrailingFailureMark: input.failed && !toolIconAcceptsTint(input.iconName, input.toolIcon),
    shine: animated && !input.shimmer,
    shimmer: animated && input.shimmer,
  };
}

function reasoningTraceView(
  messages: ReadonlyArray<ChatMessage>,
  live: boolean,
  showHeader: boolean,
  context: TimelineWorkContext,
): TimelineActivityDetailView | null {
  const [first] = messages;
  if (first === undefined) return null;
  const expanded = !showHeader || context.expansion.reasoningMessageIds.has(first.id);
  const streaming =
    live &&
    messages.some((message) => message.streaming) &&
    context.isWorking &&
    first.turnId !== null &&
    first.turnId === context.unsettledTurnId;
  if (messages.every((message) => message.text.trim().length === 0) && !streaming) {
    return null;
  }
  const label = streaming ? "Thinking" : "Thought";
  const collapsedPreview = messages.find((message) => message.text.trim().length > 0)?.text.trim();
  return {
    kind: "reasoning",
    id: first.id,
    messageId: first.id,
    showHeader,
    expanded,
    streaming,
    headerText: expanded ? label : thoughtPreviewText(collapsedPreview ?? label, label),
    documents: expanded
      ? messages.map((message) =>
          buildMarkdownDocument(
            message.text,
            {
              cwd: context.workspaceRoot,
              lineBreaks: true,
              streaming: streaming && message.streaming,
              wordWrap: context.wordWrap,
              canRunShellCommands: false,
            },
            context.resolveImage,
          ),
        )
      : [],
  };
}

function activityDetails(
  row: Extract<MessagesTimelineRow, { kind: "activity-group" }>,
  showReasoningHeader: boolean,
  context: TimelineWorkContext,
): TimelineActivityDetailView[] {
  const details: TimelineActivityDetailView[] = [];
  let index = 0;
  while (index < row.entries.length) {
    const entry = row.entries[index];
    if (entry === undefined) break;
    if (entry.kind === "work") {
      const entries: WorkLogEntry[] = [];
      let next = row.entries[index];
      while (next !== undefined && next.kind === "work") {
        entries.push(next.entry);
        index += 1;
        next = row.entries[index];
      }
      const visible = omitSupersededLifecycleMarkers(entries, (work) => work).filter((work) =>
        workEntryIsVisibleInGroup(work, true),
      );
      if (visible.length > 0) {
        details.push({
          kind: "work",
          id: entry.id,
          entries: visible.map((work) => workEntryView(work, context, undefined)),
        });
      }
    } else {
      const messages: ChatMessage[] = [];
      let next = row.entries[index];
      while (next !== undefined && next.kind === "message") {
        messages.push(next.message);
        index += 1;
        next = row.entries[index];
      }
      const trace = reasoningTraceView(
        messages,
        row.active && index === row.entries.length,
        showReasoningHeader,
        context,
      );
      if (trace !== null) details.push(trace);
    }
  }
  return details;
}

function diffStatView(stat: DiffStat): TimelineDiffStatView {
  const model = buildDiffStatLabelModel(stat);
  return { additionsText: model.additionsText, deletionsText: model.deletionsText };
}

function changedFilesNodeView(node: ChangedFilesTreeNodeModel): TimelineChangedFilesNodeView {
  if (node.kind === "directory") {
    return {
      kind: "directory",
      key: node.key,
      path: node.path,
      name: node.name,
      indentPx: node.indentPx,
      expanded: node.expanded,
      icon: node.icon,
      stat: node.stat === null ? null : diffStatView(node.stat),
      children: node.children.map(changedFilesNodeView),
    };
  }
  return {
    kind: "file",
    key: node.key,
    path: node.path,
    name: node.name,
    indentPx: node.indentPx,
    showLeadingSpacer: node.showLeadingSpacer,
    icon: resolvePierreFileIcon(node.path),
    stat: node.stat === null ? null : diffStatView(node.stat),
  };
}

export function buildChangedFilesCardView(
  summary: TurnDiffSummary | undefined,
  context: TimelineWorkContext,
): TimelineChangedFilesCardView | null {
  if (summary === undefined || summary.files.length === 0) return null;
  const allDirectoriesExpanded = context.changedFilesExpandedByTurnId[summary.turnId] ?? false;
  const card = buildChangedFilesCardModel({ files: summary.files, allDirectoriesExpanded });
  const tree = buildChangedFilesTreeModel({
    files: summary.files,
    allDirectoriesExpanded,
    expansionState:
      context.expansion.changedFilesDirectories.get(summary.turnId) ??
      INITIAL_CHANGED_FILES_EXPANSION_STATE,
  });
  return {
    turnId: summary.turnId,
    countLabel: card.countLabel,
    stat: card.stat === null ? null : diffStatView(card.stat),
    toggleAll:
      card.toggleAllDirectories === null
        ? null
        : {
            expanded: card.toggleAllDirectories.expanded,
            tooltip: card.toggleAllDirectories.tooltip,
            icon: card.toggleAllDirectories.icon,
          },
    openDiff: {
      label: card.openDiff.label,
      tooltip: card.openDiff.tooltip,
      filePath: card.openDiff.filePath,
    },
    allDirectoriesExpanded,
    expansionKey: tree.expansionKey,
    nodes: tree.nodes.map(changedFilesNodeView),
  };
}

export function buildWorkRowView(
  row: MessagesTimelineRow,
  context: TimelineWorkContext,
): TimelineWorkRowView | null {
  switch (row.kind) {
    case "work-toggle":
      return {
        kind: "work-toggle",
        id: row.id,
        groupId: row.groupId,
        summary: row.summary,
        icon: workIconView(
          row.summaryToolIcon ?? row.toolSurface ?? toolGroupSummaryIconName(row.summaryKind),
          row.toolIcon,
        ),
        expanded: row.expanded,
        hasFailure: row.hasFailure,
        timeLabel: formatDayAwareTimestamp(row.createdAt, context.timestampFormat),
      };
    case "work": {
      const entries = row.groupedEntries.filter((entry) =>
        workEntryIsVisibleInGroup(entry, row.isExpandedToolGroup),
      );
      return {
        kind: "work",
        id: row.id,
        expandedGroup: row.isExpandedToolGroup,
        entries: entries.map((entry) =>
          workEntryView(entry, context, row.isExpandedToolGroup ? undefined : row.displayLabel),
        ),
      };
    }
    case "work-live": {
      const questionHeading = row.entry.questionAnswer
        ? getQuestionTextPreview(row.entry.questionAnswer)
        : "";
      const iconName = workEntryIconName(row.entry);
      return {
        kind: "work-live",
        id: row.id,
        groupId: row.groupId,
        expanded: row.expanded,
        activity: liveActivityView({
          label:
            questionHeading || liveWorkEntryLabel(row.entry, context.workspaceRoot, row.active),
          answerPreview:
            row.entry.questionAnswer && hasQuestionAnswer(row.entry.questionAnswer)
              ? getQuestionAnswerPreview(row.entry.questionAnswer)
              : null,
          iconName,
          toolIcon: row.entry.toolIcon ?? row.entry.toolSource?.icon,
          failed: workEntryDisplayIndicatesToolFailure(row.entry),
          active: row.active,
          shimmer: false,
        }),
      };
    }
    case "activity-group": {
      const header = buildActivityGroupHeaderModel(row, context.workspaceRoot);
      return {
        kind: "activity-group",
        id: row.id,
        groupId: row.groupId,
        expanded: row.expanded,
        activity: liveActivityView({
          label: header.label,
          answerPreview: null,
          iconName: header.iconName,
          toolIcon: header.toolIcon,
          failed: header.failed,
          active: row.active,
          shimmer: header.thinking,
        }),
        details: row.expanded ? activityDetails(row, header.visibleWorkCount > 0, context) : [],
      };
    }
    case "working": {
      const busy = context.isPreparingWorktree || context.isCompacting;
      const startedAt = busy || !row.createdAt ? null : row.createdAt;
      return {
        kind: "working",
        id: row.id,
        working: {
          label: context.isPreparingWorktree
            ? "Setting up worktree…"
            : context.isCompacting
              ? "Compacting…"
              : startedAt
                ? "Working for "
                : "Working...",
          compacting: !context.isPreparingWorktree && context.isCompacting,
          shimmer: busy,
          timerStartedAt: startedAt,
          timerText: startedAt === null ? null : formatWorkingTimerNow(startedAt),
        },
      };
    }
    case "thinking":
      return {
        kind: "thinking",
        id: row.id,
        visible: !(context.isPreparingWorktree || context.isCompacting),
      };
    case "context-compaction":
      return { kind: "context-compaction", id: row.id, label: row.label };
    case "message":
    case "assistant-meta":
    case "turn-fold":
    case "proposed-plan":
    case "worktree-setup":
    case "queued-message":
      return null;
  }
}
