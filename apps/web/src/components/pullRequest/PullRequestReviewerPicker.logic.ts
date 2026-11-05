import type { PullRequestReviewerCandidate } from "@t3tools/contracts";

import {
  buildPullRequestCandidatePickerModel,
  type PullRequestCandidatePickerCopy,
  type PullRequestCandidatePickerModel,
  type PullRequestCandidateToastModel,
} from "./PullRequestCandidatePicker.logic";
import { readableFailure } from "./pullRequestDetail.logic";
import {
  buildPullRequestActorModel,
  type PullRequestActorModel,
} from "./pullRequestPresentation.logic";

export const PULL_REQUEST_REVIEWER_PICKER_COPY: PullRequestCandidatePickerCopy = {
  icon: "user-plus",
  label: "Request a review",
  disabledReason: "Asking someone to review needs write access on this repository",
  searchLabel: "Search people with access",
  emptyLabel: "Nobody else has access to this repository.",
  noMatchLabel: "Nobody with access matches that.",
  errorLabel: "The people with access could not be read.",
  truncatedLabel:
    "This repository has more people with access than are listed here. Ask for the rest on the host.",
};

const REVIEWER_REQUEST_FAILURE_HINT =
  "The host refused it. Check that you have write access on this repository, and that they still have access to it.";

export function pullRequestReviewerCandidateKey(candidate: PullRequestReviewerCandidate): string {
  return `${candidate.kind}:${candidate.id}`;
}

export function filterPullRequestReviewerCandidates(
  candidates: ReadonlyArray<PullRequestReviewerCandidate>,
  query: string,
): ReadonlyArray<PullRequestReviewerCandidate> {
  if (query.length === 0) return candidates;
  const needle = query.toLowerCase();
  return candidates.filter(
    (candidate) =>
      candidate.login.toLowerCase().includes(needle) ||
      (candidate.name ?? "").toLowerCase().includes(needle),
  );
}

export type PullRequestReviewerCandidateRowModel = {
  readonly key: string;
  readonly actor: PullRequestActorModel;
  readonly kindLabel: string | null;
  readonly requested: boolean;
  readonly requestedAriaLabel: string;
};

export type PullRequestReviewerPickerInput = {
  readonly allowed: boolean;
  readonly query: string;
  readonly candidates: ReadonlyArray<PullRequestReviewerCandidate> | null;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly truncated: boolean;
  readonly changePending: boolean;
};

export type PullRequestReviewerPickerModel =
  PullRequestCandidatePickerModel<PullRequestReviewerCandidateRowModel>;

export function buildPullRequestReviewerPickerModel(
  input: PullRequestReviewerPickerInput,
): PullRequestReviewerPickerModel {
  return buildPullRequestCandidatePickerModel({
    copy: PULL_REQUEST_REVIEWER_PICKER_COPY,
    allowed: input.allowed,
    query: input.query,
    isPending: input.isPending && input.candidates === null,
    error: input.candidates === null ? input.error : null,
    rows: filterPullRequestReviewerCandidates(input.candidates ?? [], input.query).map(
      (candidate) => ({
        key: pullRequestReviewerCandidateKey(candidate),
        actor: buildPullRequestActorModel(candidate),
        kindLabel: candidate.kind === "team" ? "team" : null,
        requested: candidate.isRequested,
        requestedAriaLabel: "Already asked",
      }),
    ),
    truncated: input.truncated,
    changePending: input.changePending,
  });
}

export type PullRequestReviewerToggleDecision =
  | { readonly kind: "ignore" }
  | {
      readonly kind: "request";
      readonly reviewer: Pick<PullRequestReviewerCandidate, "id" | "kind">;
      readonly requested: boolean;
    };

export function resolvePullRequestReviewerToggle(input: {
  readonly candidate: PullRequestReviewerCandidate;
  readonly changePending: boolean;
}): PullRequestReviewerToggleDecision {
  if (input.changePending) return { kind: "ignore" };
  return {
    kind: "request",
    reviewer: { id: input.candidate.id, kind: input.candidate.kind },
    requested: !input.candidate.isRequested,
  };
}

export function pullRequestReviewerToggleToast(input: {
  readonly candidate: PullRequestReviewerCandidate;
  readonly failure: unknown;
  readonly failed: boolean;
}): PullRequestCandidateToastModel {
  const { candidate } = input;
  if (input.failed) {
    return {
      type: "error",
      title: candidate.isRequested
        ? `Could not take back the review request to ${candidate.login}`
        : `Could not ask ${candidate.login} for a review`,
      description: readableFailure(input.failure, REVIEWER_REQUEST_FAILURE_HINT),
    };
  }
  return {
    type: "success",
    title: candidate.isRequested
      ? `Review request to ${candidate.login} taken back`
      : `Review requested from ${candidate.login}`,
  };
}
