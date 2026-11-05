import type {
  PullRequestActor,
  PullRequestCheck,
  PullRequestCheckStatus,
  PullRequestChecksState,
  PullRequestLabel,
  PullRequestMergeability,
  PullRequestReviewDecision,
  PullRequestState,
} from "@t3tools/contracts";

import type { PullRequestReviewOutcome } from "./pullRequestDetail.logic";
import { pullRequestLabelColor } from "./pullRequestList.logic";

export type PullRequestGlyphId =
  | "pullRequest"
  | "reopen"
  | "draft"
  | "closed"
  | "merged"
  | "conflicting"
  | "stack"
  | "link"
  | "unlink";

export type PullRequestStateKey = PullRequestState | "draft";

export type PullRequestStateModel = {
  readonly key: PullRequestStateKey;
  readonly label: string;
  readonly toneClassName: string;
  readonly icon: PullRequestGlyphId;
};

export const PULL_REQUEST_STATE_MODELS = {
  open: {
    key: "open",
    label: "Open",
    toneClassName: "text-emerald-600 dark:text-emerald-300/90",
    icon: "pullRequest",
  },
  draft: {
    key: "draft",
    label: "Draft",
    toneClassName: "text-zinc-500 dark:text-zinc-400/80",
    icon: "draft",
  },
  closed: {
    key: "closed",
    label: "Closed",
    toneClassName: "text-red-600 dark:text-red-300/90",
    icon: "closed",
  },
  merged: {
    key: "merged",
    label: "Merged",
    toneClassName: "text-violet-600 dark:text-violet-300/90",
    icon: "merged",
  },
} as const satisfies Record<PullRequestStateKey, PullRequestStateModel>;

export function pullRequestStateKey(input: {
  readonly state: PullRequestState;
  readonly isDraft: boolean;
}): PullRequestStateKey {
  return input.state === "open" && input.isDraft ? "draft" : input.state;
}

export function resolvePullRequestStateModel(input: {
  readonly state: PullRequestState;
  readonly isDraft: boolean;
}): PullRequestStateModel {
  return PULL_REQUEST_STATE_MODELS[pullRequestStateKey(input)];
}

export type PullRequestConflictModel = {
  readonly label: string;
  readonly toneClassName: string;
  readonly icon: "conflicting";
};

export function resolvePullRequestConflictModel(input: {
  readonly state: PullRequestState;
  readonly isDraft: boolean;
  readonly mergeability?: PullRequestMergeability;
  readonly baseBranch?: string;
}): PullRequestConflictModel | null {
  if (input.state !== "open" || input.isDraft || input.mergeability !== "conflicting") {
    return null;
  }
  return {
    label: input.baseBranch ? `Conflicts with ${input.baseBranch}` : "Has conflicts",
    toneClassName: "text-destructive",
    icon: "conflicting",
  };
}

export type PullRequestSignalIconId =
  | "spinner"
  | "circle-check"
  | "circle-dot"
  | "circle-x"
  | "circle-dashed"
  | "user-check"
  | "user-round-x"
  | "user-round";

export type PullRequestSignalModel = {
  readonly label: string;
  readonly toneClassName: string;
  readonly icon: PullRequestSignalIconId;
};

const SUCCESS_TONE_CLASS_NAME = "text-emerald-600 dark:text-emerald-300/90";

const PULL_REQUEST_CHECK_STATUS_MODELS = {
  pending: { label: "Running", icon: "spinner", toneClassName: "text-amber-500" },
  "action-required": {
    label: "Awaiting action",
    icon: "circle-dot",
    toneClassName: "text-amber-600 dark:text-amber-400/90",
  },
  success: { label: "Passed", icon: "circle-check", toneClassName: SUCCESS_TONE_CLASS_NAME },
  failure: { label: "Failed", icon: "circle-x", toneClassName: "text-destructive" },
  cancelled: { label: "Cancelled", icon: "circle-x", toneClassName: "text-destructive" },
  skipped: { label: "Skipped", icon: "circle-dashed", toneClassName: "text-muted-foreground/70" },
  neutral: { label: "Neutral", icon: "circle-dashed", toneClassName: "text-muted-foreground/70" },
} as const satisfies Record<PullRequestCheckStatus, PullRequestSignalModel>;

export function pullRequestCheckStatusModel(
  status: PullRequestCheckStatus,
): PullRequestSignalModel {
  return PULL_REQUEST_CHECK_STATUS_MODELS[status];
}

export function isWorkflowApprovalCheck(check: Pick<PullRequestCheck, "status" | "url">): boolean {
  return (
    check.status === "action-required" &&
    check.url !== null &&
    /\/actions\/runs\/\d+(?:\/|$)/u.test(check.url)
  );
}

export function pullRequestCheckStatusLabel(
  check: Pick<PullRequestCheck, "status" | "url">,
): string {
  return isWorkflowApprovalCheck(check)
    ? "Awaiting approval"
    : PULL_REQUEST_CHECK_STATUS_MODELS[check.status].label;
}

export type PullRequestChecksStateModel = {
  readonly label: string;
  readonly toneClassName: string;
  readonly icon: "circle-check" | "circle-x" | "circle-dot";
};

const PULL_REQUEST_CHECKS_STATE_MODELS = {
  passing: {
    label: "All checks have passed",
    icon: "circle-check",
    toneClassName: SUCCESS_TONE_CLASS_NAME,
  },
  failing: {
    label: "Some checks were not successful",
    icon: "circle-x",
    toneClassName: "text-destructive",
  },
  pending: {
    label: "Some checks haven't completed yet",
    icon: "circle-dot",
    toneClassName: "text-amber-600 dark:text-amber-400/90",
  },
} as const satisfies Record<PullRequestChecksState, PullRequestChecksStateModel>;

export function pullRequestChecksStateModel(
  state: PullRequestChecksState,
): PullRequestChecksStateModel {
  return PULL_REQUEST_CHECKS_STATE_MODELS[state];
}

export function pullRequestChecksState(
  checks: ReadonlyArray<PullRequestCheck>,
): PullRequestChecksState | null {
  if (checks.length === 0) return null;
  const statuses = new Set(checks.map((check) => check.status));
  if (statuses.has("failure") || statuses.has("cancelled")) return "failing";
  if (statuses.has("pending") || statuses.has("action-required")) return "pending";
  return statuses.has("success") ? "passing" : null;
}

export function summarizePullRequestChecks(checks: ReadonlyArray<PullRequestCheck>): string {
  if (checks.length === 0) return "No checks reported";
  const actionRequired = checks.filter((check) => check.status === "action-required");
  const workflowApprovalRequired = actionRequired.filter(isWorkflowApprovalCheck).length;
  const otherActionRequired = actionRequired.length - workflowApprovalRequired;
  const failed = checks.filter(
    (check) => check.status === "failure" || check.status === "cancelled",
  ).length;
  const pending = checks.filter((check) => check.status === "pending").length;
  const passed = checks.filter((check) => check.status === "success").length;
  if (failed > 0) return `${failed} of ${checks.length} failing`;
  if (workflowApprovalRequired > 0 && otherActionRequired > 0) {
    return `${workflowApprovalRequired} ${workflowApprovalRequired === 1 ? "workflow" : "workflows"} and ${otherActionRequired} ${otherActionRequired === 1 ? "check" : "checks"} awaiting action`;
  }
  if (workflowApprovalRequired > 0) {
    return `${workflowApprovalRequired} ${workflowApprovalRequired === 1 ? "workflow" : "workflows"} awaiting approval`;
  }
  if (otherActionRequired > 0) {
    return `${otherActionRequired} ${otherActionRequired === 1 ? "check" : "checks"} awaiting action`;
  }
  if (pending > 0) return `${pending} of ${checks.length} running`;
  return passed === checks.length ? "All checks passed" : `${passed} of ${checks.length} passing`;
}

const PULL_REQUEST_REVIEW_DECISION_MODELS = {
  approved: { icon: "user-check", label: "Approved", toneClassName: SUCCESS_TONE_CLASS_NAME },
  "changes-requested": {
    icon: "user-round-x",
    label: "Changes requested",
    toneClassName: "text-amber-600/90 dark:text-amber-400/80",
  },
  "review-required": {
    icon: "user-round",
    label: "Awaiting review",
    toneClassName: "text-muted-foreground/60",
  },
} as const satisfies Record<PullRequestReviewDecision, PullRequestSignalModel>;

export function pullRequestReviewDecisionModel(
  decision: PullRequestReviewDecision,
): PullRequestSignalModel {
  return PULL_REQUEST_REVIEW_DECISION_MODELS[decision];
}

export type PullRequestReviewOutcomeModel = {
  readonly label: string;
  readonly toneClassName: string;
  readonly icon: "circle-check" | "circle-x" | "circle-dashed";
  readonly ringClassName: string;
  readonly staleRingClassName: string;
  readonly badgeVariant: "success" | "error" | "outline";
};

const PULL_REQUEST_REVIEW_OUTCOME_MODELS = {
  approved: {
    label: "Approved",
    icon: "circle-check",
    toneClassName: SUCCESS_TONE_CLASS_NAME,
    ringClassName: "ring-2 ring-emerald-500 dark:ring-emerald-400",
    staleRingClassName:
      "ring-2 ring-[color-mix(in_srgb,var(--color-emerald-500)_35%,var(--background))] dark:ring-[color-mix(in_srgb,var(--color-emerald-400)_35%,var(--background))]",
    badgeVariant: "success",
  },
  "changes-requested": {
    label: "Changes requested",
    icon: "circle-x",
    toneClassName: "text-destructive",
    ringClassName: "ring-2 ring-destructive",
    staleRingClassName: "ring-2 ring-[color-mix(in_srgb,var(--destructive)_35%,var(--background))]",
    badgeVariant: "error",
  },
  dismissed: {
    label: "Review dismissed",
    icon: "circle-dashed",
    toneClassName: "text-muted-foreground/70",
    ringClassName: "ring-2 ring-muted-foreground/60",
    staleRingClassName:
      "ring-2 ring-[color-mix(in_srgb,var(--contrast-muted-foreground)_30%,var(--background))]",
    badgeVariant: "outline",
  },
} as const satisfies Record<PullRequestReviewOutcome, PullRequestReviewOutcomeModel>;

export function pullRequestReviewOutcomeModel(
  outcome: PullRequestReviewOutcome,
): PullRequestReviewOutcomeModel {
  return PULL_REQUEST_REVIEW_OUTCOME_MODELS[outcome];
}

export function pullRequestReviewOutcomeToneClassName(outcome: PullRequestReviewOutcome): string {
  return PULL_REQUEST_REVIEW_OUTCOME_MODELS[outcome].toneClassName;
}

export function pullRequestReviewOutcomeRingClassName(
  outcome: PullRequestReviewOutcome,
  stale = false,
): string {
  const model = PULL_REQUEST_REVIEW_OUTCOME_MODELS[outcome];
  return stale ? model.staleRingClassName : model.ringClassName;
}

export function pullRequestReviewOutcomeLabel(outcome: PullRequestReviewOutcome): string {
  return PULL_REQUEST_REVIEW_OUTCOME_MODELS[outcome].label;
}

export function pullRequestReviewOutcomeStaleLabel(outcome: PullRequestReviewOutcome): string {
  return `${PULL_REQUEST_REVIEW_OUTCOME_MODELS[outcome].label} earlier changes`;
}

const OPEN_ON_HOST_LABELS: Partial<Record<string, string>> = {
  github: "Open on GitHub",
  gitlab: "Open on GitLab",
  forgejo: "Open on Forgejo",
  bitbucket: "Open on Bitbucket",
  "azure-devops": "Open on Azure DevOps",
};

export function openOnHostLabel(provider: string): string {
  return OPEN_ON_HOST_LABELS[provider] ?? "Open on host";
}

export type PullRequestActorModel = {
  readonly login: string;
  readonly initial: string;
  readonly avatarUrl: string | null;
  readonly tooltip: string;
};

export function pullRequestActorLogin(actor: PullRequestActor | null): string {
  return actor?.login ?? "ghost";
}

export function pullRequestActorTooltip(actor: PullRequestActor | null): string {
  const login = pullRequestActorLogin(actor);
  return actor?.name && actor.name !== login ? `${actor.name} (@${login})` : login;
}

export function buildPullRequestActorModel(actor: PullRequestActor | null): PullRequestActorModel {
  const login = pullRequestActorLogin(actor);
  return {
    login,
    initial: login.slice(0, 1).toUpperCase(),
    avatarUrl: actor?.avatarUrl ?? null,
    tooltip: pullRequestActorTooltip(actor),
  };
}

export type PullRequestDiffStatModel = {
  readonly additions: string;
  readonly deletions: string;
};

export function formatPullRequestDiffStat(
  additions: number,
  deletions: number,
  locale?: string,
): PullRequestDiffStatModel | null {
  if (additions === 0 && deletions === 0) return null;
  return {
    additions: `+${additions.toLocaleString(locale)}`,
    deletions: `-${deletions.toLocaleString(locale)}`,
  };
}

export type PullRequestLabelChipModel = {
  readonly name: string;
  readonly color: string | null;
};

export function buildPullRequestLabelChipModel(
  label: Pick<PullRequestLabel, "name" | "color">,
): PullRequestLabelChipModel {
  return { name: label.name, color: pullRequestLabelColor(label.color) };
}
