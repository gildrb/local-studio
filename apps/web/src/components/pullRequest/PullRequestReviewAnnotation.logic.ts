import type { PullRequestReviewThread, PullRequestThreadComment } from "@t3tools/contracts";

import { mergePullRequestThreadComments } from "./pullRequestDetail.logic";

export type PullRequestReviewThreadCardModel = {
  readonly resolved: boolean;
  readonly statusLabel: string;
  readonly outdatedLabel: string | null;
  readonly fix: { readonly label: string; readonly disabled: boolean } | null;
  readonly resolve: { readonly label: string; readonly disabled: boolean } | null;
  readonly comments: ReadonlyArray<PullRequestThreadComment>;
  readonly loadMore: { readonly label: string; readonly disabled: boolean } | null;
  readonly nextCursor: string | null;
  readonly reply: {
    readonly label: string;
    readonly placeholder: string;
    readonly ariaLabel: string;
    readonly cancelLabel: string;
    readonly disabled: boolean;
  } | null;
  readonly editLabel: string;
};

export function buildPullRequestReviewThreadCardModel(input: {
  readonly thread: PullRequestReviewThread;
  readonly loadedPage: {
    readonly comments: ReadonlyArray<PullRequestThreadComment>;
    readonly nextCursor: string | null;
  } | null;
  readonly pending: boolean;
  readonly fixPending: boolean;
  readonly fixLabel: string;
  readonly canFix: boolean;
  readonly canResolve: boolean;
  readonly canReply: boolean;
  readonly loadingMore: boolean;
}): PullRequestReviewThreadCardModel {
  const { thread } = input;
  const comments = mergePullRequestThreadComments(
    thread.comments,
    input.loadedPage?.comments ?? [],
  );
  const nextCursor =
    input.loadedPage === null ? (thread.nextCommentsCursor ?? null) : input.loadedPage.nextCursor;
  const commentCount = thread.commentCount ?? comments.length;
  return {
    resolved: thread.isResolved,
    statusLabel: `${thread.isResolved ? "Resolved" : "Open"} · ${commentCount} ${
      commentCount === 1 ? "comment" : "comments"
    }`,
    outdatedLabel: thread.isOutdated ? "outdated" : null,
    fix: input.canFix
      ? {
          label: input.fixPending ? "Preparing..." : input.fixLabel,
          disabled: input.pending || input.fixPending,
        }
      : null,
    resolve: input.canResolve
      ? { label: thread.isResolved ? "Unresolve" : "Resolve", disabled: input.pending }
      : null,
    comments,
    loadMore:
      nextCursor === null
        ? null
        : {
            label: input.loadingMore ? "Loading..." : "Load more comments",
            disabled: input.loadingMore,
          },
    nextCursor,
    reply: input.canReply
      ? {
          label: "Reply",
          placeholder: "Reply",
          ariaLabel: "Reply to this conversation",
          cancelLabel: "Cancel",
          disabled: input.pending,
        }
      : null,
    editLabel: "Edit comment",
  };
}
