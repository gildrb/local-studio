import type {
  PullRequestCheck,
  PullRequestCheckStatus,
  PullRequestChecksState,
} from "@t3tools/contracts";

import {
  pullRequestCheckStatusLabel,
  pullRequestCheckStatusModel,
  pullRequestChecksStateModel,
  summarizePullRequestChecks,
  type PullRequestChecksStateModel,
  type PullRequestSignalModel,
} from "./pullRequestPresentation.logic";

export const PULL_REQUEST_CHECK_OPEN_FAILURE_TITLE = "Unable to open check details";

const NO_CHECKS_REPORTED = "No checks reported";

export type PullRequestCheckRowModel = {
  readonly key: string;
  readonly name: string;
  readonly tooltip: string;
  readonly status: PullRequestSignalModel;
  readonly statusKey: PullRequestCheckStatus;
  readonly statusLabel: string;
  readonly detailsUrl: string | null;
  readonly detailsLabel: string;
};

export type PullRequestChecksBodyModel =
  | { readonly kind: "none" }
  | { readonly kind: "message"; readonly message: string }
  | { readonly kind: "rows"; readonly rows: ReadonlyArray<PullRequestCheckRowModel> };

export function buildPullRequestCheckRows(
  checks: ReadonlyArray<PullRequestCheck>,
): ReadonlyArray<PullRequestCheckRowModel> {
  return checks.map((check, index) => ({
    key: `${index}:${check.name}`,
    name: check.name,
    tooltip: check.description ?? check.name,
    status: pullRequestCheckStatusModel(check.status),
    statusKey: check.status,
    statusLabel: pullRequestCheckStatusLabel(check),
    detailsUrl: check.url,
    detailsLabel: "Details",
  }));
}

export function buildPullRequestChecksBodyModel(
  checks: ReadonlyArray<PullRequestCheck>,
): PullRequestChecksBodyModel {
  return checks.length === 0
    ? { kind: "message", message: NO_CHECKS_REPORTED }
    : { kind: "rows", rows: buildPullRequestCheckRows(checks) };
}

export function buildPullRequestLazyChecksBodyModel(input: {
  readonly checks: ReadonlyArray<PullRequestCheck> | null;
  readonly isPending: boolean;
  readonly error: string | null;
}): PullRequestChecksBodyModel {
  if (input.error !== null) return { kind: "message", message: input.error };
  if (input.checks === null) {
    return { kind: "message", message: input.isPending ? "Loading checks…" : NO_CHECKS_REPORTED };
  }
  return buildPullRequestChecksBodyModel(input.checks);
}

export type PullRequestChecksPopoverInput = {
  readonly checksState: PullRequestChecksState;
  readonly checks: ReadonlyArray<PullRequestCheck> | null;
  readonly stale: boolean;
  readonly canReadLazily: boolean;
};

export type PullRequestChecksPopoverModel = {
  readonly trigger: PullRequestChecksStateModel & { readonly ariaLabel: string };
  readonly title: string;
  readonly summary: string | null;
  readonly body:
    | PullRequestChecksBodyModel
    | { readonly kind: "stale"; readonly message: string }
    | { readonly kind: "lazy" };
};

export function buildPullRequestChecksPopoverModel(
  input: PullRequestChecksPopoverInput,
): PullRequestChecksPopoverModel {
  const presentation = pullRequestChecksStateModel(input.checksState);
  return {
    trigger: { ...presentation, ariaLabel: `Checks: ${presentation.label}` },
    title: presentation.label,
    summary: input.checks === null || input.stale ? null : summarizePullRequestChecks(input.checks),
    body: input.stale
      ? {
          kind: "stale",
          message: "Check details are out of date. Refresh the pull request to update them.",
        }
      : input.checks !== null
        ? buildPullRequestChecksBodyModel(input.checks)
        : input.canReadLazily
          ? { kind: "lazy" }
          : { kind: "none" },
  };
}
