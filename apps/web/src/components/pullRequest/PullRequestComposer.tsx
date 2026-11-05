/**
 * The single floating control over a pull request. Commenting on the change and submitting the
 * review that carries the Code tab's line comments used to float as two buttons that crowded
 * each other and read as the same offer twice; they are two modes of one composer now.
 *
 * Opening picks the mode with work waiting in it, so a reader who has collected line comments
 * lands on the review and everyone else lands on the comment box. Either mode's draft survives
 * the toggle: they are separate texts going to separate places, and merging them would send a
 * summary as a comment or the reverse.
 */
import type { EnvironmentId, PullRequestDetailView, PullRequestRef } from "@t3tools/contracts";
import { MessageSquareIcon, Trash2Icon, XIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "../ui/button";
import { Popover, PopoverClose, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { PullRequestCommentForm } from "./PullRequestCommentForm";
import { PullRequestReviewForm } from "./PullRequestReviewForm";
import {
  pullRequestReviewKey,
  usePendingReviewComments,
  usePullRequestReviewStore,
} from "./pullRequestReviewStore";
import {
  buildPullRequestComposerModel,
  pullRequestComposerOpenMode,
} from "./PullRequestComposer.logic";

export function PullRequestComposer({
  environmentId,
  reference,
  detail,
  actionPending,
  onCommentAction,
  onCommented,
  onReviewSubmitted,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  detail: PullRequestDetailView;
  actionPending: boolean;
  onCommentAction: (
    body: string,
    action: "close" | "reopen",
  ) => Promise<{ readonly commentPosted: boolean }>;
  onCommented: () => void;
  onReviewSubmitted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reviewPending, setReviewPending] = useState(false);
  const [requestedMode, setRequestedMode] = useState<"comment" | "review">("comment");
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const reviewRef = useRef<HTMLTextAreaElement>(null);
  const pendingComments = usePendingReviewComments(reference);
  const clearComments = usePullRequestReviewStore((store) => store.clear);
  // A summary typed but not sent is review work too, and it outlives the popover. Selected as a
  // boolean rather than the text, so typing one does not re-render the composer per keystroke.
  const reviewKey = pullRequestReviewKey(reference);
  const summaryStarted = usePullRequestReviewStore(
    (store) => (store.summaries[reviewKey] ?? "").trim().length > 0,
  );
  const model = buildPullRequestComposerModel({
    detail,
    requestedMode,
    pendingCommentCount: pendingComments.length,
    summaryStarted,
  });
  if (!model.visible) return null;
  const { canComment, verdicts, mode } = model;
  const reviewStarted = pendingComments.length > 0 || summaryStarted;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setRequestedMode(pullRequestComposerOpenMode(reviewStarted));
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={<Button size="icon" variant="glass" />}
        // The only label this control has, so the pending count belongs in it: the badge beside
        // the icon is decorative and a reader who cannot see it still needs the number.
        aria-label={model.triggerLabel}
      >
        <MessageSquareIcon className="size-4" />
        {model.pendingBadge !== null ? (
          <span
            aria-hidden
            className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-info px-1 text-3xs font-semibold tabular-nums text-white"
          >
            {model.pendingBadge}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverPopup
        keepMounted
        side="top"
        align="end"
        sideOffset={8}
        width="lg"
        initialFocus={mode === "review" ? reviewRef : commentRef}
        aria-label={model.popupLabel}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          {model.modeToggle !== null ? (
            <ToggleGroup
              aria-label={model.modeToggle.ariaLabel}
              variant="segmented"
              value={[mode]}
              onValueChange={(next) => {
                const value = next[0];
                if (value === "comment" || value === "review") setRequestedMode(value);
              }}
            >
              {model.modeToggle.options.map((option) => (
                <Toggle key={option.value} value={option.value}>
                  {option.label}
                </Toggle>
              ))}
            </ToggleGroup>
          ) : (
            <PopoverTitle>{model.title}</PopoverTitle>
          )}
          <div className="flex items-center gap-1">
            {model.discard !== null ? (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={model.discard.label}
                title={model.discard.label}
                disabled={reviewPending}
                onClick={() => clearComments(reviewKey)}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            ) : null}
            <PopoverClose
              render={<Button size="icon-xs" variant="ghost" />}
              aria-label={model.closeLabel}
            >
              <XIcon className="size-3.5" />
            </PopoverClose>
          </div>
        </div>
        {/* Keep both forms mounted across toggles and dismissal so drafts and in-flight
            submit guards survive closing and reopening the composer. */}
        {verdicts.length > 0 ? (
          <div hidden={mode !== "review"}>
            <PullRequestReviewForm
              environmentId={environmentId}
              reference={reference}
              verdicts={verdicts}
              requestChangesSummaryRequired={model.requestChangesSummaryRequired}
              textareaRef={reviewRef}
              pending={reviewPending}
              onPendingChange={setReviewPending}
              onSubmitted={() => {
                setOpen(false);
                onReviewSubmitted();
              }}
            />
          </div>
        ) : null}
        {canComment ? (
          <div hidden={mode !== "comment"}>
            <PullRequestCommentForm
              environmentId={environmentId}
              reference={reference}
              detail={detail}
              actionPending={actionPending}
              textareaRef={commentRef}
              onCommentAction={onCommentAction}
              onCommented={onCommented}
              onClose={() => setOpen(false)}
            />
          </div>
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}
