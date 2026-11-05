import type { PullRequestLabelCandidate } from "@t3tools/contracts";

import {
  buildPullRequestCandidatePickerModel,
  type PullRequestCandidatePickerCopy,
  type PullRequestCandidatePickerModel,
  type PullRequestCandidateToastModel,
} from "./PullRequestCandidatePicker.logic";
import { readableFailure } from "./pullRequestDetail.logic";
import { pullRequestLabelColor } from "./pullRequestList.logic";

export const PULL_REQUEST_LABEL_PICKER_COPY: PullRequestCandidatePickerCopy = {
  icon: "tag",
  label: "Change labels",
  disabledReason: "Changing labels needs triage access on this repository",
  searchLabel: "Search labels",
  emptyLabel: "This repository has no labels.",
  noMatchLabel: "No label matches that.",
  errorLabel: "The labels could not be read.",
  truncatedLabel:
    "This repository has more labels than are listed here. Apply the rest on the host.",
};

const LABEL_CHANGE_FAILURE_HINT =
  "The host refused it. Check that you have triage access on this repository.";

export function filterPullRequestLabelCandidates(
  candidates: ReadonlyArray<PullRequestLabelCandidate>,
  query: string,
): ReadonlyArray<PullRequestLabelCandidate> {
  if (query.length === 0) return candidates;
  const needle = query.toLowerCase();
  return candidates.filter(
    (candidate) =>
      candidate.name.toLowerCase().includes(needle) ||
      (candidate.description ?? "").toLowerCase().includes(needle),
  );
}

export type PullRequestLabelCandidateRowModel = {
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly color: string | null;
  readonly applied: boolean;
  readonly appliedAriaLabel: string;
};

export type PullRequestLabelPickerInput = {
  readonly allowed: boolean;
  readonly query: string;
  readonly candidates: ReadonlyArray<PullRequestLabelCandidate> | null;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly truncated: boolean;
  readonly changePending: boolean;
};

export type PullRequestLabelPickerModel =
  PullRequestCandidatePickerModel<PullRequestLabelCandidateRowModel>;

export function buildPullRequestLabelPickerModel(
  input: PullRequestLabelPickerInput,
): PullRequestLabelPickerModel {
  return buildPullRequestCandidatePickerModel({
    copy: PULL_REQUEST_LABEL_PICKER_COPY,
    allowed: input.allowed,
    query: input.query,
    isPending: input.isPending && input.candidates === null,
    error: input.candidates === null ? input.error : null,
    rows: filterPullRequestLabelCandidates(input.candidates ?? [], input.query).map(
      (candidate) => ({
        key: candidate.name,
        name: candidate.name,
        description: candidate.description ? candidate.description : null,
        color: pullRequestLabelColor(candidate.color),
        applied: candidate.isApplied,
        appliedAriaLabel: "Applied",
      }),
    ),
    truncated: input.truncated,
    changePending: input.changePending,
  });
}

export type PullRequestLabelToggleDecision =
  | { readonly kind: "ignore" }
  | { readonly kind: "set"; readonly label: string; readonly applied: boolean };

export function resolvePullRequestLabelToggle(input: {
  readonly candidate: Pick<PullRequestLabelCandidate, "name" | "isApplied">;
  readonly changePending: boolean;
}): PullRequestLabelToggleDecision {
  if (input.changePending) return { kind: "ignore" };
  return { kind: "set", label: input.candidate.name, applied: !input.candidate.isApplied };
}

export function pullRequestLabelToggleFailureToast(input: {
  readonly candidate: Pick<PullRequestLabelCandidate, "name" | "isApplied">;
  readonly failure: unknown;
}): PullRequestCandidateToastModel {
  return {
    type: "error",
    title: input.candidate.isApplied
      ? `Could not take ${input.candidate.name} off`
      : `Could not put ${input.candidate.name} on`,
    description: readableFailure(input.failure, LABEL_CHANGE_FAILURE_HINT),
  };
}
