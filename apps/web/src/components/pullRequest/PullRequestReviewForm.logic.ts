import type { PullRequestReviewVerdict } from "@t3tools/contracts";

export type PullRequestReviewVerdictIcon = "message-square" | "check" | "x-circle";

export type PullRequestReviewVerdictOption = {
  readonly value: PullRequestReviewVerdict;
  readonly label: string;
  readonly sent: string;
  readonly icon: PullRequestReviewVerdictIcon;
};

export const PULL_REQUEST_REVIEW_VERDICTS: ReadonlyArray<PullRequestReviewVerdictOption> = [
  { value: "comment", label: "Comment", sent: "Review submitted", icon: "message-square" },
  { value: "approve", label: "Approve", sent: "Pull request approved", icon: "check" },
  {
    value: "request-changes",
    label: "Request changes",
    sent: "Changes requested",
    icon: "x-circle",
  },
];

export const PULL_REQUEST_REVIEW_FAILURE_TITLE = "The review could not be submitted";

export type PullRequestReviewFormInput = {
  readonly verdicts: ReadonlyArray<PullRequestReviewVerdict>;
  readonly requestedVerdict: PullRequestReviewVerdict;
  readonly requestChangesSummaryRequired: boolean;
  readonly body: string;
  readonly pendingCommentCount: number;
  readonly pending: boolean;
};

export type PullRequestReviewFormModel = {
  readonly summaryPlaceholder: string;
  readonly summaryAriaLabel: string;
  readonly verdictAriaLabel: string;
  readonly verdictDisabled: boolean;
  readonly options: ReadonlyArray<PullRequestReviewVerdictOption>;
  readonly selected: PullRequestReviewVerdictOption | null;
  readonly submitLabel: string;
  readonly submitDisabled: boolean;
};

export function canSubmitPullRequestReview(input: {
  readonly verdict: PullRequestReviewVerdict;
  readonly requestChangesSummaryRequired: boolean;
  readonly body: string;
  readonly pendingCommentCount: number;
}): boolean {
  return input.verdict === "request-changes" && input.requestChangesSummaryRequired
    ? input.body.trim().length > 0
    : input.verdict === "approve" || input.body.trim().length > 0 || input.pendingCommentCount > 0;
}

export function buildPullRequestReviewFormModel(
  input: PullRequestReviewFormInput,
): PullRequestReviewFormModel {
  const options = PULL_REQUEST_REVIEW_VERDICTS.filter((verdict) =>
    input.verdicts.includes(verdict.value),
  );
  const selected =
    options.find((verdict) => verdict.value === input.requestedVerdict) ?? options[0] ?? null;
  return {
    summaryPlaceholder:
      input.requestChangesSummaryRequired && input.verdicts.includes("request-changes")
        ? "Summarize your review (required to request changes)"
        : "Summarize your review (optional)",
    summaryAriaLabel: "Review summary",
    verdictAriaLabel: "Review verdict",
    verdictDisabled: input.pending,
    options,
    selected,
    submitLabel: input.pending ? "Submitting..." : "Submit review",
    submitDisabled:
      input.pending ||
      selected === null ||
      !canSubmitPullRequestReview({
        verdict: selected.value,
        requestChangesSummaryRequired: input.requestChangesSummaryRequired,
        body: input.body,
        pendingCommentCount: input.pendingCommentCount,
      }),
  };
}

export type PullRequestReviewSubmitDecision =
  | { readonly kind: "ignore" }
  | { readonly kind: "submit"; readonly verdict: PullRequestReviewVerdictOption };

export function resolvePullRequestReviewSubmit(
  model: PullRequestReviewFormModel,
  pending: boolean,
): PullRequestReviewSubmitDecision {
  if (pending || model.selected === null) return { kind: "ignore" };
  return { kind: "submit", verdict: model.selected };
}
