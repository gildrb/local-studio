import type { PanelToggleModel } from "@t3tools/web/src/components/chat/PanelLayoutControls.logic.ts";
import type { PullRequestChecksPopoverModel } from "@t3tools/web/src/components/pullRequest/PullRequestChecksPopover.logic.ts";
import type { MiddleTruncateSplit } from "@t3tools/web/src/components/ui/middleTruncate.logic.ts";
import type {
  PullRequestActivityUnavailableModel,
  PullRequestDetailModel,
  PullRequestDetailTab,
} from "@t3tools/web/src/components/pullRequest/PullRequestDetailPanel.logic.ts";
import type { PullRequestDetailGhostModel } from "@t3tools/web/src/components/pullRequest/PullRequestGhosts.logic.ts";
import type {
  PullRequestActorModel,
  PullRequestStateModel,
} from "@t3tools/web/src/components/pullRequest/pullRequestPresentation.logic.ts";
import type { MediaVideoView } from "./media.ts";
import type {
  PullRequestStackMenuModel,
  PullRequestStackPopoverModel,
} from "@t3tools/web/src/components/pullRequest/PullRequestStackMenu.logic.ts";
import type { PullRequestsPageModel } from "@t3tools/web/src/components/pullRequest/PullRequestsPage.logic.ts";
import type {
  PullRequestThreadLinksModel,
  PullRequestThreadPickerModel,
} from "@t3tools/web/src/components/pullRequest/PullRequestThreadLinks.logic.ts";
import type { PullRequestLabelPickerModel } from "@t3tools/web/src/components/pullRequest/PullRequestLabelPicker.logic.ts";
import type { PullRequestMarkdownEditorModel } from "@t3tools/web/src/components/pullRequest/PullRequestMarkdownEditor.logic.ts";
import type { PullRequestReviewerPickerModel } from "@t3tools/web/src/components/pullRequest/PullRequestReviewerPicker.logic.ts";
import type { PullRequestSummaryModel } from "@t3tools/web/src/components/pullRequest/PullRequestSummaryTab.logic.ts";
import type { PullRequestTimelineModel } from "@t3tools/web/src/components/pullRequest/PullRequestTimelineTab.logic.ts";
import type {
  PullRequestCommentFormModel,
  PullRequestComposerModel,
} from "@t3tools/web/src/components/pullRequest/PullRequestComposer.logic.ts";
import type { PullRequestReviewFormModel } from "@t3tools/web/src/components/pullRequest/PullRequestReviewForm.logic.ts";
import type { PullRequestCodeTabModel } from "@t3tools/web/src/components/pullRequest/PullRequestCodeTab.logic.ts";
import type { PullRequestReviewThreadCardModel } from "@t3tools/web/src/components/pullRequest/PullRequestReviewAnnotation.logic.ts";
import type { DiffFileTreeModel } from "@t3tools/web/src/components/diffs/diffFileTree.logic.ts";
import type { RightPanelDiffFileHeaderRow, RightPanelDiffRow } from "../features/rightPanelDiff.ts";
import type { PullRequestReactionBarModel } from "@t3tools/web/src/components/pullRequest/pullRequestReactions.logic.ts";

import type { MarkdownDocView } from "./markdown.ts";
import type { ProjectIconView } from "./sidebar.ts";

export type PullRequestsSearchFocusView = {
  readonly revision: number;
  readonly target: "condensed" | "inline";
};

export type PullRequestsPageView = {
  readonly model: PullRequestsPageModel;
  readonly filtersOpen: boolean;
  readonly authorQuery: string;
  readonly authorActors: Readonly<Record<string, PullRequestActorModel>>;
  readonly projectIcons: Readonly<Record<string, ProjectIconView>>;
  readonly stackTriggers: Readonly<Record<string, PullRequestStackPopoverModel>>;
  readonly rightPanel: PanelToggleModel;
  readonly rightPanelOpen: boolean;
  readonly searchRevision: number;
  readonly searchFocus: PullRequestsSearchFocusView | null;
};

export type PullRequestStackLayerView = {
  readonly number: number;
  readonly title: string;
  readonly subtitle: string;
  readonly state: PullRequestStateModel;
  readonly current: boolean;
  readonly disabled: boolean;
};

export type PullRequestPopoverView =
  | {
      readonly kind: "checks";
      readonly anchor: string;
      readonly model: PullRequestChecksPopoverModel;
    }
  | {
      readonly kind: "stack";
      readonly anchor: string;
      readonly number: number;
      readonly notice: string | null;
      readonly stale: boolean;
      readonly retryLabel: string | null;
      readonly message: string | null;
      readonly layers: ReadonlyArray<PullRequestStackLayerView>;
      readonly base: string | null;
    };

export type PullRequestDetailGateView =
  | { readonly kind: "ghost"; readonly ghost: PullRequestDetailGhostModel }
  | { readonly kind: "unavailable"; readonly title: string; readonly description: string };

export type PullRequestDetailStackMenuView = {
  readonly model: PullRequestStackMenuModel;
  readonly notice: string | null;
  readonly stale: boolean;
  readonly layers: ReadonlyArray<PullRequestStackLayerView>;
  readonly dialogLayers: ReadonlyArray<PullRequestStackLayerView>;
  readonly base: string;
};

export type PullRequestDetailThreadLinksView = {
  readonly model: PullRequestThreadLinksModel;
  readonly countVisible: boolean;
  readonly picker: PullRequestThreadPickerModel | null;
  readonly pickerQuery: string;
};

export type PullRequestDetailShellView = {
  readonly surfaceId: string;
  readonly context: "page" | "thread";
  readonly gate: PullRequestDetailGateView | null;
  readonly ghost: PullRequestDetailGhostModel | null;
  readonly model: PullRequestDetailModel | null;
  readonly confirmationOpen: boolean;
  readonly mountedTabs: ReadonlyArray<PullRequestDetailTab>;
  readonly unavailable: { readonly refreshing: boolean; readonly gitHubUrl: string | null };
  readonly stackMenu: PullRequestDetailStackMenuView | null;
  readonly threadLinks: PullRequestDetailThreadLinksView | null;
  readonly titleRevision: number;
  readonly checksTrigger: PullRequestChecksPopoverModel["trigger"] | null;
  readonly activityUnavailable: PullRequestActivityUnavailableModel | null;
  readonly branchSplits: {
    readonly base: MiddleTruncateSplit | null;
    readonly head: MiddleTruncateSplit | null;
  };
};

export type PullRequestBodySegmentView =
  | { readonly kind: "markdown"; readonly id: string; readonly document: MarkdownDocView }
  | { readonly kind: "video"; readonly id: string; readonly video: MediaVideoView }
  | {
      readonly kind: "attachment";
      readonly id: string;
      readonly url: string;
      readonly label: string;
    };

export type PullRequestBodyView = {
  readonly segments: ReadonlyArray<PullRequestBodySegmentView>;
};

export type PullRequestMarkdownEditorView = {
  readonly target: string;
  readonly revision: number;
  readonly initial: string;
  readonly label: string;
  readonly placeholder: string | null;
  readonly model: PullRequestMarkdownEditorModel;
  readonly preview: PullRequestBodyView | null;
};

export type PullRequestSummaryPickerView = {
  readonly open: boolean;
  readonly query: string;
  readonly model: PullRequestReviewerPickerModel | PullRequestLabelPickerModel;
};

export type PullRequestSummaryView = {
  readonly url: string;
  readonly active: boolean;
  readonly model: PullRequestSummaryModel;
  readonly description: PullRequestBodyView;
  readonly bodies: Readonly<Record<string, PullRequestBodyView>>;
  readonly reactions: Readonly<Record<string, PullRequestReactionBarModel>>;
  readonly reactionPicker: string | null;
  readonly fixable: Readonly<Record<string, boolean>>;
  readonly editor: PullRequestMarkdownEditorView | null;
  readonly saving: boolean;
  readonly reviewers: PullRequestSummaryPickerView | null;
  readonly labels: PullRequestSummaryPickerView | null;
  readonly activityUnavailable: PullRequestActivityUnavailableModel | null;
  readonly groupActors: Readonly<Record<string, PullRequestActorModel>>;
};

export type PullRequestTimelineView = {
  readonly url: string;
  readonly active: boolean;
  readonly model: PullRequestTimelineModel;
  readonly markers: Readonly<Record<string, PullRequestActorModel>>;
  readonly bodies: Readonly<Record<string, PullRequestBodyView>>;
  readonly reactions: Readonly<Record<string, PullRequestReactionBarModel>>;
  readonly reactionPicker: string | null;
  readonly editor: PullRequestMarkdownEditorView | null;
  readonly saving: boolean;
};

export type PullRequestComposerView = {
  readonly open: boolean;
  readonly model: PullRequestComposerModel;
  readonly comment: {
    readonly model: PullRequestCommentFormModel;
    readonly revision: number;
    readonly body: string;
  };
  readonly review: {
    readonly model: PullRequestReviewFormModel;
    readonly summary: string;
    readonly revision: number;
    readonly pending: boolean;
  } | null;
};

export type PullRequestCodeSegmentView =
  | {
      readonly kind: "rows";
      readonly rows: ReadonlyArray<RightPanelDiffRow>;
      readonly lines: ReadonlyArray<{
        readonly oldLine: number | null;
        readonly newLine: number | null;
      } | null>;
    }
  | {
      readonly kind: "annotations";
      readonly threadIds: ReadonlyArray<string>;
      readonly pendingIds: ReadonlyArray<string>;
      readonly draft: boolean;
    };

export type PullRequestCodeFileView = {
  readonly key: string;
  readonly path: string;
  readonly changeIcon: RightPanelDiffFileHeaderRow["changeIcon"];
  readonly segments: ReadonlyArray<PullRequestCodeSegmentView>;
};

export type PullRequestCodeThreadView = {
  readonly id: string;
  readonly resolved: boolean;
  readonly statusLabel: string;
  readonly outdatedLabel: string | null;
  readonly fix: PullRequestReviewThreadCardModel["fix"];
  readonly resolve: PullRequestReviewThreadCardModel["resolve"];
  readonly loadMore: PullRequestReviewThreadCardModel["loadMore"];
  readonly reply: PullRequestReviewThreadCardModel["reply"];
  readonly replyRevision: number;
  readonly editLabel: string;
  readonly comments: ReadonlyArray<{
    readonly id: string;
    readonly author: PullRequestActorModel;
    readonly time: string;
    readonly body: PullRequestBodyView;
    readonly canEdit: boolean;
  }>;
};

export type PullRequestCodeView = {
  readonly active: boolean;
  readonly model: PullRequestCodeTabModel;
  readonly files: ReadonlyArray<PullRequestCodeFileView>;
  readonly threads: Readonly<Record<string, PullRequestCodeThreadView>>;
  readonly reactions: Readonly<Record<string, PullRequestReactionBarModel>>;
  readonly reactionPicker: string | null;
  readonly raw: ReadonlyArray<{ readonly reason: string; readonly text: string }>;
  readonly tree: DiffFileTreeModel | null;
  readonly wordWrap: boolean;
  readonly layout: "stacked" | "split";
  readonly orphansOpen: boolean;
  readonly reveal: { readonly key: string; readonly revision: number } | null;
  readonly editor: PullRequestMarkdownEditorView | null;
  readonly editorThreadId: string | null;
  readonly canCommentOnLines: boolean;
  readonly pending: Readonly<Record<string, { readonly body: string }>>;
  readonly pendingLabel: string;
  readonly pendingRemoveLabel: string;
  readonly draft: {
    readonly revision: number;
    readonly selection: {
      readonly fileKey: string;
      readonly startSide: "left" | "right";
      readonly startLine: number;
      readonly side: "left" | "right";
      readonly line: number;
    };
    readonly rangeLabel: string;
    readonly ariaLabel: string;
    readonly placeholder: string;
    readonly hint: string;
    readonly cancelLabel: string;
    readonly submitLabel: string;
    readonly secondaryLabel: string;
  } | null;
};
