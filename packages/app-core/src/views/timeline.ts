import type { PierreIconView } from "../pierreIcon.ts";
import type { SyntaxLine } from "../syntaxHighlight.ts";
import type { MarkdownDocView } from "./markdown.ts";
import type { MediaVideoView } from "./media.ts";
import type { TimelineChangedFilesCardView, TimelineWorkRowView } from "./timelineWork.ts";

export type TimelineUserImageView = {
  readonly id: string;
  readonly name: string;
  readonly url: string | null;
};

export type TimelineSnapShotAccessibilityView =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "json"; readonly lines: ReadonlyArray<SyntaxLine> }
  | { readonly kind: "unnamed" }
  | { readonly kind: "none" };

export type TimelineSnapShotView = {
  readonly appName: string;
  readonly appInitial: string;
  readonly appIconPath: string | null;
  readonly windowTitle: string;
  readonly includesAccessibility: boolean;
  readonly accessibility: TimelineSnapShotAccessibilityView;
};

export type TimelineUserGridImageView = {
  readonly id: string;
  readonly name: string;
  readonly url: string | null;
  readonly snapShot: TimelineSnapShotView | null;
};

export type TimelineUserVideoView = {
  readonly id: string;
  readonly name: string;
  readonly video: MediaVideoView | null;
};

export type TimelineUserFileView = {
  readonly id: string;
  readonly name: string;
  readonly icon: PierreIconView;
  readonly downloadable: boolean;
};

export type TimelineRowView =
  | TimelineWorkRowView
  | {
      readonly kind: "user";
      readonly id: string;
      readonly messageId: string;
      readonly text: string;
      readonly document: MarkdownDocView | null;
      readonly images: ReadonlyArray<TimelineUserGridImageView>;
      readonly videos: ReadonlyArray<TimelineUserVideoView>;
      readonly files: ReadonlyArray<TimelineUserFileView>;
      readonly unknownAttachments: ReadonlyArray<TimelineUserFileView>;
      readonly collapsible: boolean;
      readonly expanded: boolean;
      readonly copyText: string | null;
      readonly revertTurnCount: number | null;
      readonly revertDisabled: boolean;
      readonly timeLabel: string;
      readonly timeTooltip: string;
    }
  | {
      readonly kind: "assistant";
      readonly id: string;
      readonly document: MarkdownDocView;
      readonly copyText: string | null;
      readonly streaming: boolean;
      readonly showMeta: boolean;
      readonly showCopyButton: boolean;
      readonly timeLabel: string;
      readonly timeTooltip: string;
      readonly changedFiles: TimelineChangedFilesCardView | null;
    }
  | {
      readonly kind: "assistant-meta";
      readonly id: string;
      readonly showCopyButton: boolean;
      readonly copyText: string | null;
      readonly timeLabel: string;
      readonly timeTooltip: string;
    }
  | {
      readonly kind: "reasoning";
      readonly id: string;
      readonly messageId: string;
      readonly expanded: boolean;
      readonly document: MarkdownDocView | null;
      readonly timeLabel: string;
    }
  | {
      readonly kind: "turn-fold";
      readonly id: string;
      readonly turnId: string;
      readonly label: string;
      readonly timeLabel: string;
      readonly timeTooltip: string;
      readonly expanded: boolean;
    }
  | {
      readonly kind: "proposed-plan";
      readonly id: string;
      readonly planId: string;
      readonly title: string;
      readonly markdown: string;
      readonly canCollapse: boolean;
      readonly expanded: boolean;
      readonly copyText: string;
      readonly downloadFilename: string;
      readonly canSave: boolean;
    };

export type TimelineRowEntry = TimelineRowView & { readonly paddingBottom: number };

export type TimelineView = {
  readonly threadKey: string | null;
  readonly loading: boolean;
  readonly scrollRevision: number;
  readonly rows: ReadonlyArray<TimelineRowEntry>;
};
