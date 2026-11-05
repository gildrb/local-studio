import type {
  EnvironmentId,
  EnvironmentMachineKind,
  PullRequestAction,
  PullRequestActivity,
  PullRequestActor,
  PullRequestChecksState,
  PullRequestDetail,
  PullRequestDetailView,
  PullRequestListEntry,
  PullRequestMergeability,
  PullRequestMergeMethod,
  PullRequestRef,
  PullRequestState,
  PullRequestSummary,
  PullRequestUpdateMethod,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import { changeRequestRepositoryUrl } from "@t3tools/shared/changeRequestUrl";

import { formatRelativeTimeLabel } from "~/timestampFormat";
import {
  latestPullRequestReviewOutcomes,
  PULL_REQUEST_MERGE_METHOD_LABELS,
  pullRequestActionMenuHasGroup,
  pullRequestActionNeedsHostRefresh,
  pullRequestHandoffLabels,
  readableFailure,
  resolveBaseFreshness,
  resolvePullRequestMergeMethod,
  resolvePullRequestPrimaryControl,
} from "./pullRequestDetail.logic";
import { canEditPullRequestChangeRequest } from "./pullRequestEditing.logic";
import type { PickableEnvironment } from "./pullRequestProjectAssignment.logic";
import {
  buildPullRequestActorModel,
  formatPullRequestDiffStat,
  openOnHostLabel,
  pullRequestChecksState,
  pullRequestChecksStateModel,
  pullRequestReviewOutcomeToneClassName,
  resolvePullRequestStateModel,
  summarizePullRequestChecks,
  type PullRequestActorModel,
  type PullRequestDiffStatModel,
  type PullRequestGlyphId,
  type PullRequestStateModel,
} from "./pullRequestPresentation.logic";

export type PullRequestDetailTab = "summary" | "timeline" | "code";

export type PullRequestDetailTabModel = {
  readonly value: PullRequestDetailTab;
  readonly label: string;
};

export const PULL_REQUEST_DETAIL_TABS: ReadonlyArray<PullRequestDetailTabModel> = [
  { value: "summary", label: "Summary" },
  { value: "timeline", label: "Timeline" },
  { value: "code", label: "Code" },
];

export function resolveVisiblePullRequestDetailTabs(
  detail: { readonly capabilities: { readonly diff: boolean } } | null,
): ReadonlyArray<PullRequestDetailTabModel> {
  return PULL_REQUEST_DETAIL_TABS.filter(
    (item) => item.value !== "code" || detail === null || detail.capabilities.diff,
  );
}

export function resolvePullRequestDetailTabChange(
  next: string | undefined,
  visibleTabs: ReadonlyArray<PullRequestDetailTabModel>,
): PullRequestDetailTab | null {
  return visibleTabs.find((item) => item.value === next)?.value ?? null;
}

export function resolvePullRequestDetailTabFallback(
  tab: PullRequestDetailTab,
  visibleTabs: ReadonlyArray<PullRequestDetailTabModel>,
): PullRequestDetailTab | null {
  return visibleTabs.some((item) => item.value === tab) ? null : "summary";
}

const ACTION_SUCCESS_LABELS: Record<PullRequestAction, string> = {
  merge: "Pull request merged",
  ready: "Marked ready for review",
  draft: "Converted to draft",
  close: "Pull request closed",
  reopen: "Pull request reopened",
  "update-branch": "Branch updated with the base branch",
  "enable-auto-merge":
    "Auto-merge turned on — merges as soon as this is ready, sooner if it already is",
  "disable-auto-merge": "Auto-merge turned off",
  revert: "Revert pull request opened",
  "approve-workflows": "Workflows approved",
};

const ACTION_FAILURE_LABELS: Record<PullRequestAction, string> = {
  merge: "Could not merge this pull request",
  ready: "Could not mark this ready for review",
  draft: "Could not convert this to a draft",
  close: "Could not close this pull request",
  reopen: "Could not reopen this pull request",
  "update-branch": "Could not update this branch",
  "enable-auto-merge": "Could not turn on auto-merge",
  "disable-auto-merge": "Could not turn off auto-merge",
  revert: "Could not open a revert pull request",
  "approve-workflows": "Could not approve workflows",
};

const ACTION_FAILURE_HINTS: Record<PullRequestAction, string> = {
  merge:
    "The host refused the merge. Check that you have write access, that the checks it requires have passed, and that the branch is not conflicting.",
  ready: "The host refused it. Check that you have write access to this repository.",
  draft: "The host refused it. Check that you have write access to this repository.",
  close: "The host refused it. Check that you have write access, or that you opened it.",
  reopen:
    "The host refused it. Check that you have write access, and that the branch still exists.",
  "update-branch":
    "The host refused it. Check that you have write access to the branch — one from a fork also needs its author to allow edits from maintainers — and that it does not conflict with the base.",
  "enable-auto-merge":
    "The host refused it. Check that this repository allows auto-merge, that you have write access, and that there is something left for it to wait on.",
  "disable-auto-merge":
    "The host refused it. Check that you have write access, and that the merge has not already happened.",
  revert:
    "The host refused it. Check that you have write access and that this pull request was merged on the host.",
  "approve-workflows":
    "The host refused it. Check that you have Actions write access and that these workflow runs are still awaiting approval.",
};

const UPDATE_BRANCH_REBASE_FAILURE_HINT =
  "The host refused it. A rebase stops at the first commit that does not apply cleanly; updating with a merge commit may still work.";

export type PullRequestToastModel = {
  readonly type: "success" | "error" | "warning" | "loading";
  readonly title: string;
  readonly description?: string;
};

export type PullRequestActionOutcome = {
  readonly toast: PullRequestToastModel;
  readonly refresh: "host" | "detail" | "none";
  readonly succeeded: boolean;
};

export function resolvePullRequestActionOutcome(input: {
  readonly action: PullRequestAction;
  readonly updateMethod: PullRequestUpdateMethod | undefined;
  readonly failed: boolean;
  readonly failure: unknown;
}): PullRequestActionOutcome {
  if (input.failed) {
    const hint =
      input.updateMethod === "rebase"
        ? UPDATE_BRANCH_REBASE_FAILURE_HINT
        : ACTION_FAILURE_HINTS[input.action];
    return {
      toast: {
        type: "error",
        title: ACTION_FAILURE_LABELS[input.action],
        description: readableFailure(input.failure, hint),
      },
      refresh: "none",
      succeeded: false,
    };
  }
  return {
    toast: { type: "success", title: ACTION_SUCCESS_LABELS[input.action] },
    refresh: pullRequestActionNeedsHostRefresh(input.action) ? "host" : "detail",
    succeeded: true,
  };
}

export const PULL_REQUEST_COMMENT_POST_FAILURE_TITLE = "Could not post the comment";
export const PULL_REQUEST_CHECKOUT_COMMAND_COPY_FAILURE_TITLE = "Could not copy checkout command";

export type PullRequestConfirmableAction =
  | "merge"
  | "close"
  | "enable-auto-merge"
  | "revert"
  | "approve-workflows";

export type PullRequestConfirmationModel = {
  readonly title: string;
  readonly description: string;
  readonly cancelLabel: string;
  readonly confirmLabel: string;
  readonly destructive: boolean;
  readonly confirmDisabled: boolean;
};

export function buildPullRequestConfirmationModel(input: {
  readonly action: PullRequestConfirmableAction;
  readonly referenceNumber: number;
  readonly mergeMethod: PullRequestMergeMethod;
  readonly workflowApprovalsRequired: number;
  readonly actionPending: boolean;
}): PullRequestConfirmationModel {
  const number = input.referenceNumber;
  const approvals = input.workflowApprovalsRequired;
  const titles: Record<PullRequestConfirmableAction, string> = {
    merge: "Merge pull request?",
    "enable-auto-merge": "Enable auto-merge?",
    revert: "Revert these changes?",
    "approve-workflows": "Approve workflows to run?",
    close: "Close pull request?",
  };
  const descriptions: Record<PullRequestConfirmableAction, string> = {
    merge: `This merges #${number} using ${input.mergeMethod}.`,
    "enable-auto-merge": `This merges #${number} using ${input.mergeMethod} as soon as the host considers it ready, which may be immediately.`,
    revert: `This opens a new pull request that reverses the changes merged by #${number}.`,
    "approve-workflows": `This allows ${approvals} ${approvals === 1 ? "workflow" : "workflows"} from #${number} to run. Review the code and workflow changes first.`,
    close: `This closes #${number} without merging it.`,
  };
  const confirmLabels: Record<PullRequestConfirmableAction, string> = {
    merge: PULL_REQUEST_MERGE_METHOD_LABELS[input.mergeMethod],
    "enable-auto-merge": "Enable auto-merge",
    revert: "Create revert PR",
    "approve-workflows": "Approve and run",
    close: "Close",
  };
  return {
    title: titles[input.action],
    description: descriptions[input.action],
    cancelLabel: "Cancel",
    confirmLabel: confirmLabels[input.action],
    destructive: input.action === "close",
    confirmDisabled: input.actionPending,
  };
}

export type PullRequestActionRequest = {
  readonly action: PullRequestAction;
  readonly mergeMethod?: PullRequestMergeMethod;
};

export function resolvePullRequestConfirmedAction(
  action: PullRequestConfirmableAction,
  mergeMethod: PullRequestMergeMethod,
): PullRequestActionRequest {
  return action === "merge" || action === "enable-auto-merge"
    ? { action, mergeMethod }
    : { action };
}

export type PullRequestTitleSaveDecision =
  | { readonly kind: "ignore" }
  | { readonly kind: "discard" }
  | { readonly kind: "save"; readonly title: string };

export function resolvePullRequestTitleSave(input: {
  readonly draft: string;
  readonly currentTitle: string | null;
  readonly saving: boolean;
}): PullRequestTitleSaveDecision {
  const title = input.draft.trim();
  if (input.currentTitle === null || input.saving) return { kind: "ignore" };
  if (title.length === 0 || title === input.currentTitle) return { kind: "discard" };
  return { kind: "save", title };
}

export function resolvePullRequestTitleKey(key: string): "save" | "cancel" | "none" {
  return key === "Enter" ? "save" : key === "Escape" ? "cancel" : "none";
}

export function pullRequestTitleSaveFailureToast(failure: unknown): PullRequestToastModel {
  return {
    type: "error",
    title: "The title could not be saved",
    description: readableFailure(failure, "The host refused the new title."),
  };
}

export function resolvePullRequestChromeCondensed(input: {
  readonly previous: boolean;
  readonly scrollTop: number;
  readonly foldHeight: number;
  readonly condensedRowHeight: number;
}): { readonly condensed: boolean; readonly compensation: number | null } {
  if (input.previous) {
    return {
      condensed: !(input.scrollTop < 4 && input.foldHeight > 0),
      compensation: null,
    };
  }
  if (input.foldHeight > 0 && input.scrollTop > input.foldHeight + 32) {
    return { condensed: true, compensation: -(input.foldHeight - input.condensedRowHeight) };
  }
  return { condensed: false, compensation: null };
}

export type PullRequestHandoffRoute =
  | { readonly kind: "ignore" }
  | { readonly kind: "composer"; readonly toast: PullRequestToastModel }
  | { readonly kind: "thread" };

function askPromptDescription(promptLength: number): string {
  return promptLength > 0
    ? "The question is in the composer — read it over, then send."
    : "The pull request is in the composer — type your question, then send.";
}

export function resolvePullRequestAskRoute(input: {
  readonly hasDetail: boolean;
  readonly handoff: string | null;
  readonly hasComposer: boolean;
  readonly promptLength: number;
}): PullRequestHandoffRoute {
  if (!input.hasDetail || input.handoff !== null) return { kind: "ignore" };
  if (input.hasComposer) {
    return {
      kind: "composer",
      toast: {
        type: "success",
        title: "Added to the composer",
        description: askPromptDescription(input.promptLength),
      },
    };
  }
  return { kind: "thread" };
}

export const PULL_REQUEST_THREAD_OPEN_FAILURE_TOAST: PullRequestToastModel = {
  type: "error",
  title: "Could not open a thread",
  description: "Try again from the project, or open a thread first.",
};

export function pullRequestAskedToast(promptLength: number): PullRequestToastModel {
  return {
    type: "success",
    title: "Asked in a thread",
    description: askPromptDescription(promptLength),
  };
}

export function resolvePullRequestHandoffRoute(input: {
  readonly hasSummary: boolean;
  readonly handoff: string | null;
  readonly hasComposer: boolean;
  readonly hasTask: boolean;
  readonly hasCheckoutRoot: boolean;
}): PullRequestHandoffRoute {
  if (!input.hasSummary || input.handoff !== null) return { kind: "ignore" };
  if (input.hasComposer && input.hasTask) {
    return {
      kind: "composer",
      toast: {
        type: "success",
        title: "Added to the composer",
        description: "The task is in the composer — read it over, then send.",
      },
    };
  }
  return input.hasCheckoutRoot ? { kind: "thread" } : { kind: "ignore" };
}

export const PULL_REQUEST_CHECKOUT_TOASTS = {
  preparing: { type: "loading", title: "Preparing the pull request checkout..." },
  threadFailed: {
    type: "error",
    title: "Could not open a thread for the checkout",
    description: "Try again from the project, or open a thread first.",
  },
  stale: {
    type: "warning",
    title: "Checked out, but not on the latest commits",
    description:
      "The checkout could not be moved onto the pull request's latest commits, so the code there is older than the pull request. Uncommitted work or local commits keep it where it is.",
  },
} as const satisfies Record<string, PullRequestToastModel>;

export function pullRequestCheckoutFailureToast(message: string | null): PullRequestToastModel {
  return {
    type: "error",
    title: "Could not prepare the pull request checkout",
    ...(message ? { description: message } : {}),
  };
}

export function pullRequestCheckoutUnpointedToast(branch: string): PullRequestToastModel {
  return {
    type: "error",
    title: "Checked out, but the thread stayed where it was",
    description: `The checkout is ready on \`${branch}\`. Point a thread at it from the branch picker, then ask again.`,
  };
}

export function pullRequestCheckoutResultToast(input: {
  readonly mode: "worktree" | "local";
  readonly isOnPullRequestHead: boolean;
  readonly hasTask: boolean;
}): PullRequestToastModel {
  if (!input.isOnPullRequestHead) return PULL_REQUEST_CHECKOUT_TOASTS.stale;
  if (input.hasTask) {
    return {
      type: "success",
      title: "Checkout ready",
      description: "The task is in the composer — read it over, then send.",
    };
  }
  return {
    type: "success",
    title: input.mode === "local" ? "Checked out here" : "Checked out",
    description:
      input.mode === "local"
        ? "This repository is on the pull request's branch, with a thread open on it."
        : "The pull request is in its own worktree, with a thread open on it.",
  };
}

export function pullRequestDetailKey(reference: PullRequestRef): string {
  return `${reference.projectId}:${reference.host ?? ""}:${reference.repository}#${reference.number}`;
}

export function matchPullRequestListEntry(
  listEntry: PullRequestListEntry | null,
  reference: PullRequestRef,
): PullRequestListEntry | null {
  return listEntry?.projectId === reference.projectId &&
    listEntry.repository.toLowerCase() === reference.repository.toLowerCase() &&
    (reference.host === undefined ||
      listEntry.host.toLowerCase() === reference.host.toLowerCase()) &&
    listEntry.number === reference.number
    ? listEntry
    : null;
}

export function mergePullRequestDetailSummary(
  detail: PullRequestDetail | null,
  summary: PullRequestSummary | null,
): PullRequestDetail | null {
  if (detail === null || summary === null || summary === detail) return detail;
  return {
    ...detail,
    title: summary.title,
    state: summary.state,
    headBranch: summary.headBranch,
    baseBranch: summary.baseBranch,
    updatedAt: summary.updatedAt,
    author: summary.author ?? detail.author,
    additions: summary.additions ?? detail.additions,
    deletions: summary.deletions ?? detail.deletions,
    changedFiles: summary.changedFiles ?? detail.changedFiles,
    mergeability: summary.mergeability ?? detail.mergeability,
    closedAt: summary.closedAt === undefined ? detail.closedAt : summary.closedAt,
    mergedAt: summary.mergedAt === undefined ? detail.mergedAt : summary.mergedAt,
    isDraft: summary.isDraft ?? detail.isDraft,
  };
}

export function applyPullRequestActivity(
  detail: PullRequestDetail | null,
  activity: PullRequestActivity | null,
): PullRequestDetailView | null {
  if (detail === null) return null;
  return {
    ...detail,
    author: activity?.author ?? detail.author,
    reviewers: activity?.reviewers ?? detail.reviewers,
    comments: activity?.comments ?? [],
    commentCount: activity?.commentCount ?? 0,
    commentsTruncated: activity?.commentsTruncated ?? false,
    reviewThreads: activity?.reviewThreads ?? [],
    commits: activity?.commits ?? [],
    reactions: activity?.reactions ?? [],
  };
}

export function pullRequestAuthorProfileUrl(input: {
  readonly provider: SourceControlProviderKind;
  readonly author: PullRequestActor | null;
  readonly repositoryUrl: string | null;
}): string | null {
  return input.provider === "github" &&
    input.author !== null &&
    !input.author.login.endsWith("[bot]") &&
    input.repositoryUrl !== null
    ? new URL(`/${encodeURIComponent(input.author.login)}`, input.repositoryUrl).toString()
    : null;
}

export function pullRequestAllowedMergeMethods(
  detail: Pick<PullRequestDetail, "capabilities" | "mergeCapabilities"> | null,
): ReadonlyArray<PullRequestMergeMethod> {
  return detail
    ? detail.capabilities.mergeMethods.filter((method) => detail.mergeCapabilities[method])
    : [];
}

export type PullRequestChecksResolution = {
  readonly state: PullRequestChecksState | null;
  readonly stale: boolean;
  readonly summary: string | null;
};

export function resolvePullRequestChecks(input: {
  readonly detail: Pick<PullRequestDetail, "checks"> | null;
  readonly sharedChecksState: PullRequestChecksState | null | undefined;
}): PullRequestChecksResolution {
  const detailChecksState = input.detail ? pullRequestChecksState(input.detail.checks) : null;
  const latestChecksState =
    input.sharedChecksState === undefined ? detailChecksState : input.sharedChecksState;
  const state =
    latestChecksState !== "failing" &&
    input.detail?.checks.some((check) => check.status === "action-required")
      ? "pending"
      : latestChecksState;
  const stale = state !== detailChecksState;
  const summary = stale
    ? state === null
      ? "No checks reported"
      : pullRequestChecksStateModel(state).label
    : input.detail
      ? summarizePullRequestChecks(input.detail.checks)
      : null;
  return { state, stale, summary };
}

function plural(count: number, one: string, many: string, locale: string | undefined): string {
  return `${count.toLocaleString(locale)} ${count === 1 ? one : many}`;
}

export type PullRequestDetailButtonModel = {
  readonly label: string;
  readonly ariaLabel: string;
  readonly tooltip: string;
  readonly disabled: boolean;
};

export type PullRequestCheckoutOptionModel = {
  readonly mode: "worktree" | "local";
  readonly icon: "git-branch" | "folder-git";
  readonly title: string;
  readonly description: string;
};

export type PullRequestEnvironmentOptionModel = {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly machine: EnvironmentMachineKind | "server";
};

export type PullRequestEnvironmentPickerModel = {
  readonly visible: boolean;
  readonly value: EnvironmentId;
  readonly disabled: boolean;
  readonly options: ReadonlyArray<PullRequestEnvironmentOptionModel>;
};

export type PullRequestCheckoutControlModel = PullRequestDetailButtonModel & {
  readonly visible: boolean;
  readonly options: ReadonlyArray<PullRequestCheckoutOptionModel>;
  readonly environments: PullRequestEnvironmentPickerModel;
};

export type PullRequestPrimaryModel =
  | { readonly kind: "resolve"; readonly button: PullRequestDetailButtonModel }
  | { readonly kind: "ready"; readonly button: PullRequestDetailButtonModel }
  | { readonly kind: "enable-auto-merge"; readonly button: PullRequestDetailButtonModel }
  | { readonly kind: "auto-merge-armed"; readonly label: string; readonly tooltip: string }
  | { readonly kind: "merge"; readonly button: PullRequestDetailButtonModel }
  | { readonly kind: "state"; readonly state: PullRequestStateModel }
  | null;

export type PullRequestFreshnessModel = {
  readonly summary: string;
  readonly note: string;
  readonly disabled: boolean;
  readonly methods: ReadonlyArray<{
    readonly method: PullRequestUpdateMethod;
    readonly label: string;
  }>;
};

export type PullRequestMenuItemModel = {
  readonly visible: boolean;
  readonly label: string;
  readonly disabled: boolean;
};

export type PullRequestDescribedMenuItemModel = PullRequestMenuItemModel & {
  readonly description: string;
};

export type PullRequestLifecycleMenuModel = {
  readonly action: "close" | "reopen" | "revert";
  readonly label: string;
  readonly icon: Extract<PullRequestGlyphId, "closed" | "reopen"> | "rotate-ccw";
  readonly destructive: boolean;
  readonly confirm: boolean;
  readonly disabled: boolean;
};

export type PullRequestDetailMenuModel = {
  readonly trigger: { readonly ariaLabel: string; readonly refreshing: boolean };
  readonly refresh: PullRequestMenuItemModel;
  readonly ask: PullRequestDescribedMenuItemModel;
  readonly explain: PullRequestDescribedMenuItemModel;
  readonly fixFindings: PullRequestMenuItemModel;
  readonly environments: PullRequestEnvironmentPickerModel;
  readonly actionGroup: {
    readonly visible: boolean;
    readonly draftToggle: PullRequestMenuItemModel & {
      readonly action: "ready" | "draft";
      readonly icon: Extract<PullRequestGlyphId, "pullRequest" | "draft">;
    };
    readonly mergeNow: PullRequestMenuItemModel;
    readonly autoMerge: PullRequestMenuItemModel & {
      readonly action: "disable-auto-merge" | "enable-auto-merge";
    };
    readonly mergeMethods: {
      readonly visible: boolean;
      readonly separatorBefore: boolean;
      readonly value: PullRequestMergeMethod;
      readonly disabled: boolean;
      readonly options: ReadonlyArray<{
        readonly method: PullRequestMergeMethod;
        readonly label: string;
      }>;
    };
    readonly separatorAfter: boolean;
  };
  readonly openOnHost: { readonly label: string; readonly url: string };
  readonly copyLink: {
    readonly label: string;
    readonly shortcut: string | null;
    readonly value: string;
  };
  readonly copyNumber: {
    readonly label: string;
    readonly shortcut: string | null;
    readonly value: string;
  };
  readonly lifecycle: PullRequestLifecycleMenuModel | null;
};

export type PullRequestDetailHeaderModel = {
  readonly repository: {
    readonly label: string;
    readonly url: string | null;
    readonly tooltip: string;
  };
  readonly number: {
    readonly label: string;
    readonly ariaLabel: string;
    readonly tooltip: string;
    readonly url: string;
  };
  readonly state: PullRequestStateModel;
  readonly title: string;
  readonly author: PullRequestActorModel;
  readonly authorProfileUrl: string | null;
  readonly updatedRelative: string;
  readonly updatedLabel: string;
  readonly checkoutCommand: string | null;
  readonly branches: {
    readonly base: string;
    readonly head: string;
    readonly stacked: boolean;
    readonly stackedAriaLabel: string;
    readonly baseTooltip: string;
    readonly arrowAriaLabel: string;
    readonly headCopyLabel: string;
    readonly headCopiedLabel: string;
  };
  readonly freshness: PullRequestFreshnessModel | null;
  readonly changedFiles: {
    readonly count: string;
    readonly ariaLabel: string;
    readonly label: string;
  };
  readonly additions: number;
  readonly deletions: number;
  readonly diffStat: PullRequestDiffStatModel | null;
  readonly titleEditor: {
    readonly editing: boolean;
    readonly draft: string;
    readonly canEdit: boolean;
    readonly editAriaLabel: string;
    readonly inputAriaLabel: string;
    readonly inputDisabled: boolean;
    readonly cancelLabel: string;
    readonly cancelDisabled: boolean;
    readonly saveLabel: string;
    readonly saveDisabled: boolean;
  };
};

export type PullRequestDetailActionsModel = {
  readonly retryStack: { readonly visible: boolean; readonly label: string };
  readonly stackMenu: {
    readonly visible: boolean;
    readonly canMerge: boolean;
    readonly canRebase: boolean;
    readonly mergeMethod: PullRequestMergeMethod;
  };
  readonly threadLinksCountVisible: boolean;
  readonly checkout: PullRequestCheckoutControlModel;
  readonly armedBadge: { readonly label: string; readonly tooltip: string } | null;
  readonly primary: PullRequestPrimaryModel;
};

export type PullRequestDetailNavModel =
  | {
      readonly kind: "summary";
      readonly approveWorkflows: PullRequestDetailButtonModel | null;
      readonly checks: {
        readonly state: PullRequestChecksState | null;
        readonly stale: boolean;
        readonly summary: string | null;
        readonly ariaLabel: string;
      };
    }
  | {
      readonly kind: "timeline";
      readonly dimmed: boolean;
      readonly comments: { readonly label: string; readonly ariaLabel: string };
      readonly commits: { readonly label: string; readonly ariaLabel: string };
      readonly approvals: {
        readonly label: string;
        readonly srLabel: string;
        readonly toneClassName: string;
      } | null;
      readonly order: { readonly label: string; readonly ariaLabel: string };
    }
  | { readonly kind: "code" };

export type PullRequestDetailBodyModel =
  | { readonly kind: "unavailable"; readonly error: string }
  | { readonly kind: "detail"; readonly timeline: "loading" | "error" | "ready" }
  | { readonly kind: "empty" };

export type PullRequestDetailInput = {
  readonly referenceNumber: number;
  readonly detail: PullRequestDetailView | null;
  readonly detailPending: boolean;
  readonly detailError: string | null;
  readonly handoffSummary: {
    readonly state: PullRequestState;
    readonly mergeability?: PullRequestMergeability | undefined;
  } | null;
  readonly context: "page" | "thread";
  readonly hasBack: boolean;
  readonly hasClose: boolean;
  readonly hasComposer: boolean;
  readonly handoff: string | null;
  readonly checkoutRootAvailable: boolean;
  readonly pendingAction: PullRequestAction | null;
  readonly refreshing: boolean;
  readonly canMergeSinglePullRequest: boolean;
  readonly mergeMethod: {
    readonly current: PullRequestMergeMethod | null;
    readonly projectDefault: PullRequestMergeMethod | undefined;
    readonly lastSelected: PullRequestMergeMethod;
  };
  readonly sharedChecksState: PullRequestChecksState | null | undefined;
  readonly isStackedPullRequest: boolean;
  readonly stack: {
    readonly hasStack: boolean;
    readonly supportsActions: boolean;
    readonly failed: boolean;
    readonly fresh: boolean;
  };
  readonly tab: PullRequestDetailTab;
  readonly timelineOrder: "newest" | "oldest";
  readonly activityPending: boolean;
  readonly activityError: string | null;
  readonly titleDraft: string | null;
  readonly titleSaving: boolean;
  readonly checkoutCommand: string | null;
  readonly shortcuts: { readonly copyLink: string | null; readonly copyNumber: string | null };
  readonly confirmation: PullRequestConfirmableAction;
  readonly pickableEnvironments: ReadonlyArray<PickableEnvironment>;
  readonly actingEnvironmentId: EnvironmentId;
  readonly nowMs: number;
  readonly locale?: string | undefined;
};

export type PullRequestDetailModel = {
  readonly loading: boolean;
  readonly ghostActions: {
    readonly visible: boolean;
    readonly resolveConflicts: boolean;
  };
  readonly chrome: {
    readonly visible: boolean;
    readonly bordered: boolean;
    readonly back: {
      readonly visible: boolean;
      readonly ariaLabel: string;
      readonly tooltip: string;
    };
    readonly close: { readonly visible: boolean; readonly ariaLabel: string };
  };
  readonly header: PullRequestDetailHeaderModel | null;
  readonly actions: PullRequestDetailActionsModel;
  readonly resolveConflicts: PullRequestDetailButtonModel;
  readonly menu: PullRequestDetailMenuModel | null;
  readonly tabs: {
    readonly items: ReadonlyArray<PullRequestDetailTabModel>;
    readonly active: PullRequestDetailTab;
  };
  readonly nav: PullRequestDetailNavModel | null;
  readonly body: PullRequestDetailBodyModel;
  readonly checks: PullRequestChecksResolution;
  readonly handoffLabels: {
    readonly fixFinding: string;
    readonly fixCheck: string;
    readonly fixFindings: string;
  };
  readonly selectedMergeMethod: PullRequestMergeMethod;
  readonly workflowApprovalsRequired: number;
  readonly confirmation: PullRequestConfirmationModel;
  readonly composerVisible: boolean;
};

const CHECKOUT_OPTIONS: ReadonlyArray<PullRequestCheckoutOptionModel> = [
  {
    mode: "worktree",
    icon: "git-branch",
    title: "In a separate worktree",
    description: "Its own folder and thread. Nothing you have open moves.",
  },
  {
    mode: "local",
    icon: "folder-git",
    title: "In this repository",
    description: "Switches the branch you are working in, like `gh pr checkout`.",
  },
];

function button(label: string, disabled: boolean): PullRequestDetailButtonModel {
  return { label, ariaLabel: label, tooltip: label, disabled };
}

function buildFreshnessModel(
  detail: PullRequestDetailView,
  actionPending: boolean,
  locale: string | undefined,
): PullRequestFreshnessModel | null {
  const freshness = resolveBaseFreshness(detail);
  if (freshness === null) return null;
  const behind =
    freshness.behindBy === null
      ? ""
      : ` by ${plural(freshness.behindBy, "commit", "commits", locale)}`;
  return {
    summary: `This branch is out-of-date with ${detail.baseBranch}${behind}.`,
    note: "Changes can be cleanly merged.",
    disabled: actionPending,
    methods: freshness.methods.map((method) => ({
      method,
      label: method === "rebase" ? "Update with rebase" : "Update branch",
    })),
  };
}

export function buildPullRequestDetailModel(input: PullRequestDetailInput): PullRequestDetailModel {
  const { detail, handoff, locale } = input;
  const actionPending = input.pendingAction !== null;
  const can = (action: PullRequestAction) =>
    detail?.capabilities.actions.includes(action) === true &&
    detail.viewerPermissions.actions.includes(action);
  const allowedMergeMethods = pullRequestAllowedMergeMethods(detail);
  const selectedMergeMethod = resolvePullRequestMergeMethod(
    allowedMergeMethods,
    input.mergeMethod.current,
    input.mergeMethod.projectDefault,
    input.mergeMethod.lastSelected,
  );
  const selectedMergeMethodLabel = PULL_REQUEST_MERGE_METHOD_LABELS[selectedMergeMethod];
  const pendingAutoMergeLabel = `Auto-merge (${selectedMergeMethodLabel.toLowerCase()})`;
  const conflicting = detail?.state === "open" && detail.mergeability === "conflicting";
  const autoMergeArmed = detail?.state === "open" && detail.autoMergeEnabled === true;
  const armedMergeMethod = detail?.autoMergeMethod;
  const armedAutoMergeLabel = armedMergeMethod
    ? `Auto-merge (${PULL_REQUEST_MERGE_METHOD_LABELS[armedMergeMethod].toLowerCase()})`
    : "Auto-merge";
  const workflowApprovalsRequired =
    detail?.state === "open" ? (detail.workflowApprovalsRequired ?? 0) : 0;
  const checks = resolvePullRequestChecks({
    detail,
    sharedChecksState: input.sharedChecksState,
  });
  const primaryControl = detail
    ? resolvePullRequestPrimaryControl({
        state: detail.state,
        isDraft: detail.isDraft,
        mergeability: detail.mergeability,
        checksState: checks.state,
        autoMergeEnabled: detail.autoMergeEnabled,
        hasMergeMethod: allowedMergeMethods.length > 0,
        canMerge: input.canMergeSinglePullRequest && can("merge"),
        canMarkReady: can("ready"),
        canEnableAutoMerge: input.canMergeSinglePullRequest && can("enable-auto-merge"),
      })
    : null;
  const showsDraftToggle =
    detail?.state === "open" &&
    can(detail.isDraft ? "ready" : "draft") &&
    !(detail.isDraft && primaryControl === "ready");
  const showsAutoMerge =
    input.canMergeSinglePullRequest &&
    detail?.state === "open" &&
    ((autoMergeArmed && can("disable-auto-merge")) ||
      (!autoMergeArmed &&
        primaryControl !== "enable-auto-merge" &&
        !detail.isDraft &&
        !conflicting &&
        can("enable-auto-merge") &&
        allowedMergeMethods.length > 0));
  const showsMergeNow =
    input.canMergeSinglePullRequest &&
    detail?.state === "open" &&
    (primaryControl === "enable-auto-merge" || primaryControl === "auto-merge-armed") &&
    can("merge") &&
    !detail.isDraft &&
    !conflicting &&
    allowedMergeMethods.length > 0;
  const showsMergeMethods =
    detail?.state === "open" &&
    can("merge") &&
    !detail.isDraft &&
    !conflicting &&
    allowedMergeMethods.length > 1;
  const statePresentation = detail
    ? resolvePullRequestStateModel({ state: detail.state, isDraft: detail.isDraft })
    : null;
  const showsApproveWorkflows =
    workflowApprovalsRequired > 0 && !checks.stale && can("approve-workflows");
  const approvalCount =
    detail && !detail.commentsTruncated
      ? latestPullRequestReviewOutcomes(detail.comments, detail.commits).filter(
          (entry) => entry.outcome === "approved" && !entry.stale,
        ).length
      : 0;
  const handoffLabels = pullRequestHandoffLabels(input.hasComposer);
  const visibleTabs = resolveVisiblePullRequestDetailTabs(detail);
  const environments: PullRequestEnvironmentPickerModel = {
    visible: input.pickableEnvironments.length > 0,
    value: input.actingEnvironmentId,
    disabled: handoff !== null,
    options: input.pickableEnvironments.map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.label,
      machine: environment.machine ?? "server",
    })),
  };
  const checkingOut = handoff?.startsWith("checkout") === true;
  const checkoutLabel = checkingOut ? "Checking out..." : "Check out";
  const resolveLabel = handoff === "conflicts" ? "Preparing..." : "Resolve conflicts";
  const resolveConflicts = button(
    resolveLabel,
    handoff !== null || (!input.hasComposer && !input.checkoutRootAvailable),
  );
  const repositoryUrl = detail === null ? null : changeRequestRepositoryUrl(detail.url);

  const primary: PullRequestPrimaryModel =
    primaryControl === "resolve"
      ? { kind: "resolve", button: resolveConflicts }
      : primaryControl === "ready"
        ? { kind: "ready", button: button("Ready for review", actionPending) }
        : primaryControl === "enable-auto-merge"
          ? {
              kind: "enable-auto-merge",
              button: button(
                input.pendingAction === "enable-auto-merge" ? "Enabling..." : pendingAutoMergeLabel,
                actionPending,
              ),
            }
          : primaryControl === "auto-merge-armed"
            ? {
                kind: "auto-merge-armed",
                label: armedAutoMergeLabel,
                tooltip: `${armedAutoMergeLabel}: the host will merge this on its own once its requirements are met`,
              }
            : primaryControl === "merge"
              ? {
                  kind: "merge",
                  button: button(
                    input.pendingAction === "merge" ? "Merging..." : selectedMergeMethodLabel,
                    actionPending,
                  ),
                }
              : (primaryControl === "merged" || primaryControl === "closed") &&
                  statePresentation !== null
                ? { kind: "state", state: statePresentation }
                : null;

  const header: PullRequestDetailHeaderModel | null =
    detail === null || statePresentation === null
      ? null
      : {
          repository: {
            label: detail.repository,
            url: repositoryUrl,
            tooltip: repositoryUrl ? `Open ${detail.repository} repository` : detail.repository,
          },
          number: {
            label: `#${detail.number}`,
            ariaLabel: `Open pull request #${detail.number} on host`,
            tooltip: openOnHostLabel(detail.provider),
            url: detail.url,
          },
          state: statePresentation,
          title: detail.title,
          author: buildPullRequestActorModel(detail.author),
          authorProfileUrl: pullRequestAuthorProfileUrl({
            provider: detail.provider,
            author: detail.author,
            repositoryUrl,
          }),
          updatedRelative: formatRelativeTimeLabel(detail.updatedAt, input.nowMs),
          updatedLabel: `updated ${formatRelativeTimeLabel(detail.updatedAt, input.nowMs)}`,
          checkoutCommand: input.checkoutCommand,
          branches: {
            base: detail.baseBranch,
            head: detail.headBranch,
            stacked: input.isStackedPullRequest,
            stackedAriaLabel: "Stacked pull request",
            baseTooltip: input.isStackedPullRequest
              ? `Stacked on ${detail.baseBranch}`
              : detail.baseBranch,
            arrowAriaLabel: "receives changes from",
            headCopyLabel: "Copy pull request branch",
            headCopiedLabel: "Branch name copied",
          },
          freshness: buildFreshnessModel(detail, actionPending, locale),
          changedFiles: {
            count: detail.changedFiles.toLocaleString(locale),
            ariaLabel: `${detail.changedFiles.toLocaleString(locale)} changed ${
              detail.changedFiles === 1 ? "file" : "files"
            }`,
            label: plural(detail.changedFiles, "file", "files", locale),
          },
          additions: detail.additions,
          deletions: detail.deletions,
          diffStat: formatPullRequestDiffStat(detail.additions, detail.deletions, locale),
          titleEditor: {
            editing: input.titleDraft !== null,
            draft: input.titleDraft ?? detail.title,
            canEdit: canEditPullRequestChangeRequest(detail),
            editAriaLabel: "Edit title",
            inputAriaLabel: "Pull request title",
            inputDisabled: input.titleSaving,
            cancelLabel: "Cancel",
            cancelDisabled: input.titleSaving,
            saveLabel: input.titleSaving ? "Saving..." : "Save",
            saveDisabled: input.titleSaving || (input.titleDraft ?? "").trim().length === 0,
          },
        };

  const menu: PullRequestDetailMenuModel | null =
    detail === null
      ? null
      : {
          trigger: {
            ariaLabel: input.refreshing ? "Refreshing pull request" : "More pull request actions",
            refreshing: input.refreshing,
          },
          refresh: { visible: true, label: "Refresh", disabled: input.refreshing },
          ask: {
            visible: true,
            label: handoff === "ask" ? "Opening..." : "Ask a question",
            description: input.hasComposer
              ? "Adds the pull request to this thread's composer."
              : "Opens a thread that knows which pull request you mean.",
            disabled: handoff !== null,
          },
          explain: {
            visible: true,
            label: handoff === "explain" ? "Opening..." : "Explain this PR",
            description: "A walk through the diff and what to read closely.",
            disabled: handoff !== null,
          },
          fixFindings: {
            visible: true,
            label: handoff === "findings" ? "Preparing..." : handoffLabels.fixFindings,
            disabled: handoff !== null,
          },
          environments,
          actionGroup: {
            visible: detail.state === "open",
            draftToggle: {
              visible: showsDraftToggle,
              action: detail.isDraft ? "ready" : "draft",
              icon: detail.isDraft ? "pullRequest" : "draft",
              label: detail.isDraft ? "Ready for review" : "Convert to draft",
              disabled: actionPending,
            },
            mergeNow: { visible: showsMergeNow, label: "Merge now", disabled: actionPending },
            autoMerge:
              autoMergeArmed && can("disable-auto-merge")
                ? {
                    visible: true,
                    action: "disable-auto-merge",
                    label: "Disable auto-merge",
                    disabled: actionPending,
                  }
                : {
                    visible: showsAutoMerge,
                    action: "enable-auto-merge",
                    label: "Enable auto-merge",
                    disabled: actionPending,
                  },
            mergeMethods: {
              visible: showsMergeMethods,
              separatorBefore: showsDraftToggle || showsMergeNow || showsAutoMerge,
              value: selectedMergeMethod,
              disabled: actionPending,
              options: allowedMergeMethods.map((method) => ({
                method,
                label: PULL_REQUEST_MERGE_METHOD_LABELS[method],
              })),
            },
            separatorAfter: pullRequestActionMenuHasGroup(
              showsDraftToggle,
              showsAutoMerge || showsMergeNow,
              showsMergeMethods,
            ),
          },
          openOnHost: { label: openOnHostLabel(detail.provider), url: detail.url },
          copyLink: { label: "Copy link", shortcut: input.shortcuts.copyLink, value: detail.url },
          copyNumber: {
            label: "Copy PR number",
            shortcut: input.shortcuts.copyNumber,
            value: `#${input.referenceNumber}`,
          },
          lifecycle:
            detail.state === "open" && can("close")
              ? {
                  action: "close",
                  label: "Close pull request",
                  icon: "closed",
                  destructive: true,
                  confirm: true,
                  disabled: actionPending,
                }
              : detail.state === "closed" && can("reopen")
                ? {
                    action: "reopen",
                    label: "Reopen pull request",
                    icon: "reopen",
                    destructive: false,
                    confirm: false,
                    disabled: actionPending,
                  }
                : detail.state === "merged" && can("revert")
                  ? {
                      action: "revert",
                      label: "Revert changes",
                      icon: "rotate-ccw",
                      destructive: false,
                      confirm: true,
                      disabled: actionPending,
                    }
                  : null,
        };

  const timelineDimmed = input.activityPending || input.activityError !== null;
  const countLabel = (count: number) =>
    input.activityError !== null ? "—" : input.activityPending ? "…" : count.toLocaleString(locale);
  const nav: PullRequestDetailNavModel | null =
    detail === null
      ? null
      : input.tab === "summary"
        ? {
            kind: "summary",
            approveWorkflows: showsApproveWorkflows
              ? button(
                  input.pendingAction === "approve-workflows"
                    ? "Approving..."
                    : "Approve workflows to run",
                  actionPending,
                )
              : null,
            checks: {
              state: checks.state,
              stale: checks.stale,
              summary: checks.summary,
              ariaLabel: checks.summary ? `Checks: ${checks.summary}` : "Checks",
            },
          }
        : input.tab === "timeline"
          ? {
              kind: "timeline",
              dimmed: timelineDimmed,
              comments: {
                label: countLabel(detail.commentCount),
                ariaLabel:
                  input.activityError !== null
                    ? "Comments unavailable"
                    : plural(detail.commentCount, "comment", "comments", locale),
              },
              commits: {
                label: countLabel(detail.commits.length),
                ariaLabel:
                  input.activityError !== null
                    ? "Commits unavailable"
                    : plural(detail.commits.length, "commit", "commits", locale),
              },
              approvals:
                approvalCount > 0
                  ? {
                      label: approvalCount.toLocaleString(locale),
                      srLabel: approvalCount === 1 ? "approval" : "approvals",
                      toneClassName: pullRequestReviewOutcomeToneClassName("approved"),
                    }
                  : null,
              order: {
                label: input.timelineOrder === "newest" ? "Newest first" : "Oldest first",
                ariaLabel:
                  input.timelineOrder === "newest"
                    ? "Show oldest activity first"
                    : "Show newest activity first",
              },
            }
          : { kind: "code" };

  const body: PullRequestDetailBodyModel =
    input.detailError !== null && detail === null
      ? { kind: "unavailable", error: input.detailError }
      : detail !== null
        ? {
            kind: "detail",
            timeline: input.activityPending
              ? "loading"
              : input.activityError !== null
                ? "error"
                : "ready",
          }
        : { kind: "empty" };

  return {
    loading: input.detailPending && detail === null,
    ghostActions: {
      visible: input.handoffSummary !== null,
      resolveConflicts:
        input.handoffSummary?.state === "open" &&
        input.handoffSummary.mergeability === "conflicting",
    },
    chrome: {
      visible: detail !== null || input.hasClose,
      bordered: detail !== null,
      back: {
        visible: input.hasBack,
        ariaLabel: "Back to this thread's pull requests",
        tooltip: "Back to pull requests",
      },
      close: { visible: input.hasClose, ariaLabel: "Collapse pull request panel" },
    },
    header,
    actions: {
      retryStack: {
        visible:
          detail !== null &&
          !input.stack.hasStack &&
          input.stack.supportsActions &&
          input.stack.failed,
        label: "Retry stack lookup",
      },
      stackMenu: {
        visible: detail !== null && input.stack.hasStack,
        canMerge:
          input.stack.fresh &&
          input.stack.supportsActions &&
          can("merge") &&
          allowedMergeMethods.length > 0,
        canRebase:
          input.stack.fresh &&
          input.stack.supportsActions &&
          detail?.viewerPermissions.stackRebase === true,
        mergeMethod: selectedMergeMethod,
      },
      threadLinksCountVisible: input.context === "page",
      checkout: {
        visible: input.context === "page",
        label: checkoutLabel,
        ariaLabel: checkoutLabel,
        tooltip: "Check out this pull request",
        disabled: handoff !== null || !input.checkoutRootAvailable,
        options: CHECKOUT_OPTIONS,
        environments,
      },
      armedBadge:
        autoMergeArmed && primaryControl !== "auto-merge-armed"
          ? {
              label: armedAutoMergeLabel,
              tooltip: `${armedAutoMergeLabel}: the host will merge this on its own once its requirements are met`,
            }
          : null,
      primary,
    },
    resolveConflicts,
    menu,
    tabs: { items: visibleTabs, active: input.tab },
    nav,
    body,
    checks,
    handoffLabels,
    selectedMergeMethod,
    workflowApprovalsRequired,
    confirmation: buildPullRequestConfirmationModel({
      action: input.confirmation,
      referenceNumber: input.referenceNumber,
      mergeMethod: selectedMergeMethod,
      workflowApprovalsRequired,
      actionPending,
    }),
    composerVisible: detail !== null,
  };
}

export type PullRequestActivityUnavailableModel = {
  readonly title: string;
  readonly message: string;
  readonly retryLabel: string;
  readonly compact: boolean;
};

export function buildPullRequestActivityUnavailableModel(input: {
  readonly error: string;
  readonly compact: boolean;
}): PullRequestActivityUnavailableModel {
  return {
    title: "Could not load pull request activity",
    message: input.error,
    retryLabel: "Retry",
    compact: input.compact,
  };
}
