/**
 * The comment half of the floating composer: a remark on the pull request itself, optionally
 * the one that closes or reopens it. The popover around it belongs to PullRequestComposer.
 */
import type { EnvironmentId, PullRequestDetailView, PullRequestRef } from "@t3tools/contracts";
import { SendIcon } from "lucide-react";
import { useState, type RefObject } from "react";

import { useAtomCommand } from "~/state/use-atom-command";
import { pullRequestEnvironment } from "~/state/pullRequests";

import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { PullRequestGlyph } from "./pullRequestIcons";
import {
  buildPullRequestCommentFormModel,
  PULL_REQUEST_COMMENT_POST_FAILED,
  resolvePullRequestCommentSubmit,
  type PullRequestCommentSubmitAction,
} from "./PullRequestComposer.logic";

export function PullRequestCommentForm({
  environmentId,
  reference,
  detail,
  actionPending,
  textareaRef,
  onCommentAction,
  onCommented,
  onClose,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  detail: PullRequestDetailView;
  actionPending: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onCommentAction: (
    body: string,
    action: "close" | "reopen",
  ) => Promise<{ readonly commentPosted: boolean }>;
  onCommented: () => void;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState<"comment" | "close" | "reopen" | null>(null);
  const postComment = useAtomCommand(pullRequestEnvironment.comment, { reportFailure: false });
  const model = buildPullRequestCommentFormModel({ detail, body, submitting, actionPending });

  const submit = async (action: PullRequestCommentSubmitAction) => {
    const trimmed = resolvePullRequestCommentSubmit({ body, submitting, actionPending });
    if (trimmed === null) return;
    setSubmitting(action);
    if (action !== "comment") {
      const result = await onCommentAction(trimmed, action);
      if (result.commentPosted) {
        setBody("");
        onClose();
      }
      setSubmitting(null);
      return;
    }
    const result = await postComment({
      environmentId,
      input: {
        ...reference,
        body: trimmed,
      },
    });
    if (result._tag === "Failure") {
      setSubmitting(null);
      toastManager.add({ type: "error", title: PULL_REQUEST_COMMENT_POST_FAILED });
      return;
    }
    setBody("");
    setSubmitting(null);
    onClose();
    onCommented();
  };

  return (
    <div className="space-y-2">
      <Textarea
        ref={textareaRef}
        // Locked while posting: the body is cleared on success, which would otherwise throw
        // away a new draft typed while the request was still in flight.
        disabled={model.disabled}
        value={body}
        rows={3}
        placeholder={model.placeholder}
        aria-label={model.ariaLabel}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey) &&
            !event.shiftKey &&
            !event.altKey
          ) {
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) void submit("comment");
          }
        }}
      />
      <div className="flex flex-wrap justify-end gap-2">
        {model.followUp === null ? null : (
          <Button
            size="xs"
            variant={model.followUp.destructive ? "destructive-outline" : "outline"}
            disabled={model.followUp.disabled}
            onClick={() => {
              if (model.followUp !== null) void submit(model.followUp.action);
            }}
          >
            {model.followUp.action === "close" ? (
              <PullRequestGlyph.closed className="size-3.5" />
            ) : (
              <PullRequestGlyph.reopen className="size-3.5" />
            )}
            {model.followUp.label}
          </Button>
        )}
        <Button
          size="xs"
          variant="outline"
          disabled={model.submit.disabled}
          onClick={() => void submit("comment")}
        >
          <SendIcon className="size-3.5" />
          {model.submit.label}
        </Button>
      </div>
    </div>
  );
}
