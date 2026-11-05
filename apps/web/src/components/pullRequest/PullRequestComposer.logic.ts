import type { PullRequestDetailView, PullRequestReviewVerdict } from "@t3tools/contracts";

export type PullRequestComposerMode = "comment" | "review";

export type PullRequestComposerModel = {
  readonly visible: boolean;
  readonly canComment: boolean;
  readonly verdicts: ReadonlyArray<PullRequestReviewVerdict>;
  readonly mode: PullRequestComposerMode;
  readonly triggerLabel: string;
  readonly pendingBadge: string | null;
  readonly popupLabel: string;
  readonly modeToggle: {
    readonly ariaLabel: string;
    readonly options: ReadonlyArray<{
      readonly value: PullRequestComposerMode;
      readonly label: string;
    }>;
  } | null;
  readonly title: string;
  readonly discard: { readonly label: string } | null;
  readonly closeLabel: string;
  readonly requestChangesSummaryRequired: boolean;
};

export function pullRequestComposerOpenMode(reviewStarted: boolean): PullRequestComposerMode {
  return reviewStarted ? "review" : "comment";
}

export function buildPullRequestComposerModel(input: {
  readonly detail: Pick<PullRequestDetailView, "capabilities" | "viewerPermissions" | "provider">;
  readonly requestedMode: PullRequestComposerMode;
  readonly pendingCommentCount: number;
  readonly summaryStarted: boolean;
}): PullRequestComposerModel {
  const { detail, pendingCommentCount } = input;
  const canComment = detail.capabilities.comment && detail.viewerPermissions.comment;
  const verdicts = detail.capabilities.review.verdicts.filter((verdict) =>
    detail.viewerPermissions.verdicts.includes(verdict),
  );
  const reviewStarted = pendingCommentCount > 0 || input.summaryStarted;
  const mode: PullRequestComposerMode = canComment
    ? verdicts.length === 0
      ? "comment"
      : input.requestedMode
    : "review";
  return {
    visible: canComment || verdicts.length > 0,
    canComment,
    verdicts,
    mode,
    triggerLabel:
      pendingCommentCount > 0
        ? `Review pull request, ${pendingCommentCount} ${pendingCommentCount === 1 ? "comment" : "comments"} pending`
        : reviewStarted || !canComment
          ? "Review pull request"
          : "Comment on pull request",
    pendingBadge: pendingCommentCount > 0 ? String(pendingCommentCount) : null,
    popupLabel: "Pull request composer",
    modeToggle:
      canComment && verdicts.length > 0
        ? {
            ariaLabel: "Composer mode",
            options: [
              { value: "comment", label: "Comment" },
              {
                value: "review",
                label: pendingCommentCount > 0 ? `Review (${pendingCommentCount})` : "Review",
              },
            ],
          }
        : null,
    title: mode === "review" ? "Review pull request" : "Comment on pull request",
    discard:
      mode === "review" && pendingCommentCount > 0
        ? { label: "Discard pending line comments" }
        : null,
    closeLabel: "Close composer",
    requestChangesSummaryRequired: detail.provider === "forgejo",
  };
}

export type PullRequestCommentSubmitAction = "comment" | "close" | "reopen";

export type PullRequestCommentFormModel = {
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly disabled: boolean;
  readonly followUp: {
    readonly action: "close" | "reopen";
    readonly label: string;
    readonly destructive: boolean;
    readonly disabled: boolean;
  } | null;
  readonly submit: { readonly label: string; readonly disabled: boolean };
};

export const PULL_REQUEST_COMMENT_POST_FAILED = "Could not post the comment";

export function pullRequestCommentFollowUpAction(
  detail: Pick<PullRequestDetailView, "state" | "capabilities" | "viewerPermissions">,
): "close" | "reopen" | null {
  if (
    detail.state === "open" &&
    detail.capabilities.actions.includes("close") &&
    detail.viewerPermissions.actions.includes("close")
  ) {
    return "close";
  }
  if (
    detail.state === "closed" &&
    detail.capabilities.actions.includes("reopen") &&
    detail.viewerPermissions.actions.includes("reopen")
  ) {
    return "reopen";
  }
  return null;
}

export function buildPullRequestCommentFormModel(input: {
  readonly detail: Pick<PullRequestDetailView, "state" | "capabilities" | "viewerPermissions">;
  readonly body: string;
  readonly submitting: PullRequestCommentSubmitAction | null;
  readonly actionPending: boolean;
}): PullRequestCommentFormModel {
  const locked = input.submitting !== null || input.actionPending;
  const blocked = input.body.trim().length === 0 || locked;
  const followUp = pullRequestCommentFollowUpAction(input.detail);
  return {
    placeholder: "Leave a comment",
    ariaLabel: "Comment on this pull request",
    disabled: locked,
    followUp:
      followUp === null
        ? null
        : {
            action: followUp,
            destructive: followUp === "close",
            disabled: blocked,
            label:
              input.submitting === followUp
                ? followUp === "close"
                  ? "Closing..."
                  : "Reopening..."
                : followUp === "close"
                  ? "Close with comment"
                  : "Reopen with comment",
          },
    submit: {
      label: input.submitting === "comment" ? "Posting..." : "Comment",
      disabled: blocked,
    },
  };
}

export function resolvePullRequestCommentSubmit(input: {
  readonly body: string;
  readonly submitting: PullRequestCommentSubmitAction | null;
  readonly actionPending: boolean;
}): string | null {
  const trimmed = input.body.trim();
  if (trimmed.length === 0 || input.submitting !== null || input.actionPending) return null;
  return trimmed;
}
