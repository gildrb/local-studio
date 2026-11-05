/**
 * The review half of the floating composer: the summary and the verdict that sends it, together
 * with whatever line comments the review is holding. The count of those lives on the composer's
 * trigger and mode toggle, and each pending card can be dropped from the diff, so neither is
 * repeated here. The popover around it belongs to PullRequestComposer.
 */
import type { EnvironmentId, PullRequestRef, PullRequestReviewVerdict } from "@t3tools/contracts";
import { CheckIcon, MessageSquareIcon, XCircleIcon } from "lucide-react";
import { useState, type RefObject } from "react";

import { pullRequestEnvironment } from "~/state/pullRequests";
import { useAtomCommand } from "~/state/use-atom-command";

import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import {
  buildPullRequestReviewFormModel,
  PULL_REQUEST_REVIEW_FAILURE_TITLE,
  resolvePullRequestReviewSubmit,
  type PullRequestReviewVerdictIcon,
  type PullRequestReviewVerdictOption,
} from "./PullRequestReviewForm.logic";
import {
  pullRequestReviewKey,
  usePendingReviewComments,
  usePullRequestReviewStore,
} from "./pullRequestReviewStore";

function VerdictIcon({ icon }: { icon: PullRequestReviewVerdictIcon }) {
  switch (icon) {
    case "message-square":
      return <MessageSquareIcon className="size-3" />;
    case "check":
      return <CheckIcon className="size-3" />;
    case "x-circle":
      return <XCircleIcon className="size-3" />;
  }
}

export function PullRequestReviewForm({
  environmentId,
  reference,
  verdicts,
  requestChangesSummaryRequired,
  textareaRef,
  pending,
  onPendingChange,
  onSubmitted,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  verdicts: ReadonlyArray<PullRequestReviewVerdict>;
  requestChangesSummaryRequired: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  pending: boolean;
  onPendingChange: (pending: boolean) => void;
  onSubmitted: () => void;
}) {
  const [requestedVerdict, setRequestedVerdict] = useState<PullRequestReviewVerdict>("comment");
  const comments = usePendingReviewComments(reference);
  const reviewKey = pullRequestReviewKey(reference);
  // The panel stays mounted while the selected pull request changes. Keeping summaries beside
  // the keyed line-comment drafts makes the selected pull request's body correct on the first
  // render, before an effect could reset state left behind by the previous one.
  const body = usePullRequestReviewStore((store) => store.summaries[reviewKey] ?? "");
  const removeComments = usePullRequestReviewStore((store) => store.removeComments);
  const setSummary = usePullRequestReviewStore((store) => store.setSummary);
  const clearSummary = usePullRequestReviewStore((store) => store.clearSummary);
  const submitReview = useAtomCommand(pullRequestEnvironment.submitReview, {
    reportFailure: false,
  });

  const model = buildPullRequestReviewFormModel({
    verdicts,
    requestedVerdict,
    requestChangesSummaryRequired,
    body,
    pendingCommentCount: comments.length,
    pending,
  });

  const submit = async (verdict: PullRequestReviewVerdictOption) => {
    const submittedBody = body;
    const submittedComments = comments;
    onPendingChange(true);
    const result = await submitReview({
      environmentId,
      input: {
        ...reference,
        verdict: verdict.value,
        body: submittedBody,
        comments: submittedComments,
      },
    });
    onPendingChange(false);
    if (result._tag === "Failure") {
      // The draft is kept: whatever went wrong, retyping the review is not the answer.
      toastManager.add({ type: "error", title: PULL_REQUEST_REVIEW_FAILURE_TITLE });
      return;
    }
    // More remarks may have been added while the host was accepting this snapshot. Leave those,
    // and any summary revised in the meantime, ready for the next review.
    removeComments(
      reviewKey,
      submittedComments.map((comment) => comment.id),
    );
    clearSummary(reviewKey, submittedBody);
    toastManager.add({ type: "success", title: verdict.sent });
    onSubmitted();
  };

  return (
    <>
      <Textarea
        ref={textareaRef}
        rows={3}
        value={body}
        placeholder={model.summaryPlaceholder}
        aria-label={model.summaryAriaLabel}
        onChange={(event) => setSummary(reviewKey, event.target.value)}
      />
      <div className="mt-2 flex justify-between gap-2">
        <Select
          value={model.selected?.value ?? null}
          disabled={model.verdictDisabled}
          onValueChange={(value) => {
            if (value !== null) setRequestedVerdict(value);
          }}
        >
          <SelectTrigger size="xs" className="w-auto min-w-0" aria-label={model.verdictAriaLabel}>
            <span className="flex items-center gap-1.5">
              {model.selected ? <VerdictIcon icon={model.selected.icon} /> : null}
              {model.selected?.label}
            </span>
          </SelectTrigger>
          <SelectPopup side="top" alignItemWithTrigger={false}>
            {model.options.map((verdict) => (
              <SelectItem key={verdict.value} value={verdict.value}>
                <span className="flex items-center gap-1.5">
                  <VerdictIcon icon={verdict.icon} />
                  {verdict.label}
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button
          size="xs"
          disabled={model.submitDisabled}
          onClick={() => {
            const decision = resolvePullRequestReviewSubmit(model, pending);
            if (decision.kind === "submit") void submit(decision.verdict);
          }}
        >
          {model.submitLabel}
        </Button>
      </div>
    </>
  );
}
