/**
 * Asking someone to review, from the row that says who is already reviewing.
 *
 * The people who may be asked are read only once this menu opens: on a large repository that is
 * a list of everyone with access, which is worth a request when somebody wants it and worth
 * nothing on every pull request they merely open.
 */
import type { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { toastManager } from "../ui/toast";
import { PullRequestCandidatePicker } from "./PullRequestCandidatePicker";
import { PullRequestActorLabel } from "./pullRequestPresentation";
import {
  buildPullRequestReviewerPickerModel,
  pullRequestReviewerCandidateKey,
  pullRequestReviewerToggleToast,
  resolvePullRequestReviewerToggle,
  type PullRequestReviewerCandidateRowModel,
} from "./PullRequestReviewerPicker.logic";

export function PullRequestReviewerPicker({
  environmentId,
  reference,
  allowed,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  /** False where the host would refuse this account's request, which is worth saying rather than
   * hiding: the control disabled with a reason answers the question its absence would raise. */
  allowed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  // Mounted with the menu closed, so nothing is asked of the host until it opens.
  const candidatesQuery = useEnvironmentQuery(
    open ? pullRequestEnvironment.reviewerCandidates({ environmentId, input: reference }) : null,
  );
  const requestReviewers = useAtomCommand(pullRequestEnvironment.requestReviewers, {
    reportFailure: false,
  });
  const candidateByKey = useMemo(
    () =>
      new Map(
        (candidatesQuery.data?.candidates ?? []).map(
          (candidate) => [pullRequestReviewerCandidateKey(candidate), candidate] as const,
        ),
      ),
    [candidatesQuery.data],
  );

  const model = buildPullRequestReviewerPickerModel({
    allowed,
    query,
    candidates: candidatesQuery.data?.candidates ?? null,
    isPending: candidatesQuery.isPending,
    error: candidatesQuery.error,
    truncated: candidatesQuery.data?.truncated === true,
    changePending: pending !== null,
  });

  const toggle = async (row: PullRequestReviewerCandidateRowModel) => {
    const candidate = candidateByKey.get(row.key);
    if (candidate === undefined) return;
    const decision = resolvePullRequestReviewerToggle({
      candidate,
      changePending: pending !== null,
    });
    if (decision.kind === "ignore") return;
    setPending(candidate.id);
    const result = await requestReviewers({
      environmentId,
      input: {
        ...reference,
        reviewers: [decision.reviewer],
        requested: decision.requested,
      },
    });
    setPending(null);
    toastManager.add(
      pullRequestReviewerToggleToast({
        candidate,
        failed: result._tag === "Failure",
        failure: result._tag === "Failure" ? squashAtomCommandFailure(result) : null,
      }),
    );
  };

  return (
    <PullRequestCandidatePicker
      model={model}
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      onSelect={(row) => void toggle(row)}
    >
      {(row) => (
        <>
          <PullRequestActorLabel actor={candidateByKey.get(row.key) ?? null} className="flex-1" />
          {row.kindLabel !== null ? (
            <span className="shrink-0 text-muted-foreground">{row.kindLabel}</span>
          ) : null}
          {row.requested ? (
            <CheckIcon aria-label={row.requestedAriaLabel} className="size-3.5 shrink-0" />
          ) : null}
        </>
      )}
    </PullRequestCandidatePicker>
  );
}
