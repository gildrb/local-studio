import type {
  WorkEntryIconName,
  WorkEntryRowHeadingTone,
  WorkEntryRowIconTone,
} from "@t3tools/web/src/components/chat/MessagesTimeline.logic.ts";

import type { PierreIconView } from "../pierreIcon.ts";
import type { MarkdownDocView } from "./markdown.ts";

export type TimelineWorkIconView = {
  readonly name: WorkEntryIconName;
  readonly imageUrl: string | null;
  readonly imageUrlDark: string | null;
};

export type TimelineWorkEntryView = {
  readonly id: string;
  readonly label: string;
  readonly answerPreview: string | null;
  readonly answerHighlighted: boolean;
  readonly icon: TimelineWorkIconView;
  readonly iconTone: WorkEntryRowIconTone;
  readonly headingTone: WorkEntryRowHeadingTone;
  readonly showTrailingFailureMark: boolean;
  readonly canExpand: boolean;
  readonly expanded: boolean;
  readonly expandedBody: string | null;
  readonly timeLabel: string;
};

export type TimelineLiveActivityView = {
  readonly label: string;
  readonly answerPreview: string | null;
  readonly icon: TimelineWorkIconView;
  readonly failed: boolean;
  readonly showTrailingFailureMark: boolean;
  readonly shine: boolean;
  readonly shimmer: boolean;
};

export type TimelineReasoningTraceView = {
  readonly kind: "reasoning";
  readonly id: string;
  readonly messageId: string;
  readonly showHeader: boolean;
  readonly expanded: boolean;
  readonly streaming: boolean;
  readonly headerText: string;
  readonly documents: ReadonlyArray<MarkdownDocView>;
};

export type TimelineActivityDetailView =
  | {
      readonly kind: "work";
      readonly id: string;
      readonly entries: ReadonlyArray<TimelineWorkEntryView>;
    }
  | TimelineReasoningTraceView;

export type TimelineWorkingView = {
  readonly label: string;
  readonly compacting: boolean;
  readonly shimmer: boolean;
  readonly timerStartedAt: string | null;
  readonly timerText: string | null;
};

export type TimelineDiffStatView = {
  readonly additionsText: string;
  readonly deletionsText: string;
};

export type TimelineChangedFilesNodeView =
  | {
      readonly kind: "directory";
      readonly key: string;
      readonly path: string;
      readonly name: string;
      readonly indentPx: number;
      readonly expanded: boolean;
      readonly icon: "folder-open" | "folder-closed";
      readonly stat: TimelineDiffStatView | null;
      readonly children: ReadonlyArray<TimelineChangedFilesNodeView>;
    }
  | {
      readonly kind: "file";
      readonly key: string;
      readonly path: string;
      readonly name: string;
      readonly indentPx: number;
      readonly showLeadingSpacer: boolean;
      readonly icon: PierreIconView;
      readonly stat: TimelineDiffStatView | null;
    };

export type TimelineChangedFilesCardView = {
  readonly turnId: string;
  readonly countLabel: string;
  readonly stat: TimelineDiffStatView | null;
  readonly toggleAll: {
    readonly expanded: boolean;
    readonly tooltip: string;
    readonly icon: "chevrons-down-up" | "chevrons-up-down";
  } | null;
  readonly openDiff: {
    readonly label: string;
    readonly tooltip: string;
    readonly filePath: string | null;
  };
  readonly allDirectoriesExpanded: boolean;
  readonly expansionKey: string;
  readonly nodes: ReadonlyArray<TimelineChangedFilesNodeView>;
};

export type TimelineWorkRowView =
  | {
      readonly kind: "work-toggle";
      readonly id: string;
      readonly groupId: string;
      readonly summary: string;
      readonly icon: TimelineWorkIconView;
      readonly expanded: boolean;
      readonly hasFailure: boolean;
      readonly timeLabel: string;
    }
  | {
      readonly kind: "work";
      readonly id: string;
      readonly expandedGroup: boolean;
      readonly entries: ReadonlyArray<TimelineWorkEntryView>;
    }
  | {
      readonly kind: "work-live";
      readonly id: string;
      readonly groupId: string;
      readonly expanded: boolean;
      readonly activity: TimelineLiveActivityView;
    }
  | {
      readonly kind: "activity-group";
      readonly id: string;
      readonly groupId: string;
      readonly expanded: boolean;
      readonly activity: TimelineLiveActivityView;
      readonly details: ReadonlyArray<TimelineActivityDetailView>;
    }
  | {
      readonly kind: "working";
      readonly id: string;
      readonly working: TimelineWorkingView;
    }
  | {
      readonly kind: "thinking";
      readonly id: string;
      readonly visible: boolean;
    }
  | {
      readonly kind: "context-compaction";
      readonly id: string;
      readonly label: string;
    };
