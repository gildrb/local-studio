/**
 * Putting a label on, and taking one off, from the row that says which it already wears.
 *
 * The repository's labels are read only once this menu opens, for the reason the reviewer menu
 * reads its people then: they are worth a request when somebody wants them and worth nothing on
 * every pull request they merely open.
 */
import type { EnvironmentId, PullRequestRef } from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";
import { useState } from "react";

import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { toastManager } from "../ui/toast";
import { PullRequestCandidatePicker } from "./PullRequestCandidatePicker";
import {
  buildPullRequestLabelPickerModel,
  pullRequestLabelToggleFailureToast,
  resolvePullRequestLabelToggle,
  type PullRequestLabelCandidateRowModel,
} from "./PullRequestLabelPicker.logic";

export function PullRequestLabelPicker({
  environmentId,
  reference,
  allowed,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  /** False where the host would refuse this account's change. Disabled with the reason rather
   * than hidden, like the reviewer control beside it. */
  allowed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  // Mounted with the menu closed, so nothing is asked of the host until it opens.
  const candidatesQuery = useEnvironmentQuery(
    open ? pullRequestEnvironment.labelCandidates({ environmentId, input: reference }) : null,
  );
  const setLabels = useAtomCommand(pullRequestEnvironment.setLabels, { reportFailure: false });

  const model = buildPullRequestLabelPickerModel({
    allowed,
    query,
    candidates: candidatesQuery.data?.candidates ?? null,
    isPending: candidatesQuery.isPending,
    error: candidatesQuery.error,
    truncated: candidatesQuery.data?.truncated === true,
    changePending: pending !== null,
  });

  const toggle = async (row: PullRequestLabelCandidateRowModel) => {
    const candidate = { name: row.name, isApplied: row.applied };
    const decision = resolvePullRequestLabelToggle({ candidate, changePending: pending !== null });
    if (decision.kind === "ignore") return;
    setPending(decision.label);
    const result = await setLabels({
      environmentId,
      input: { ...reference, labels: [decision.label], applied: decision.applied },
    });
    setPending(null);
    if (result._tag === "Failure") {
      toastManager.add(
        pullRequestLabelToggleFailureToast({
          candidate,
          failure: squashAtomCommandFailure(result),
        }),
      );
    }
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
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full bg-muted-foreground"
            {...(row.color ? { style: { backgroundColor: row.color } } : {})}
          />
          <span className="min-w-0 flex-1 truncate">
            {row.name}
            {row.description ? (
              <span className="text-muted-foreground"> · {row.description}</span>
            ) : null}
          </span>
          {row.applied ? (
            <CheckIcon aria-label={row.appliedAriaLabel} className="size-3.5 shrink-0" />
          ) : null}
        </>
      )}
    </PullRequestCandidatePicker>
  );
}
