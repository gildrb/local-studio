import type {
  PullRequestActor,
  PullRequestCheckStatus,
  PullRequestComment,
  PullRequestDetailView,
  PullRequestReaction,
  PullRequestReviewThread,
  SourceControlProviderKind,
} from "@t3tools/contracts";

import { formatRelativeTimeLabel } from "~/timestampFormat";
import {
  latestPullRequestReviewOutcomes,
  orderPullRequestComments,
  pullRequestFindingKey,
  pullRequestReviewOutcome,
  visibleBody,
  type PullRequestFinding,
  type PullRequestReviewOutcome,
} from "./pullRequestDetail.logic";
import {
  canEditPullRequestChangeRequest,
  canEditPullRequestComment,
} from "./pullRequestEditing.logic";
import {
  buildPullRequestActorModel,
  buildPullRequestLabelChipModel,
  pullRequestCheckStatusLabel,
  pullRequestCheckStatusModel,
  pullRequestReviewOutcomeLabel,
  pullRequestReviewOutcomeModel,
  pullRequestReviewOutcomeRingClassName,
  pullRequestReviewOutcomeStaleLabel,
  type PullRequestActorModel,
  type PullRequestLabelChipModel,
  type PullRequestSignalModel,
} from "./pullRequestPresentation.logic";

export const PULL_REQUEST_COMMENT_PAGE = 10;

export const PULL_REQUEST_SUMMARY_TOASTS = {
  descriptionSaveFailed: "Could not save the description",
  commentSaveFailed: "Could not save the comment",
  checkOpenFailed: "Unable to open check details",
} as const;

export type PullRequestTimeModel = {
  readonly iso: string;
  readonly relative: string;
  readonly absolute: string;
};

export type PullRequestFormatOptions = {
  readonly nowMs: number;
  readonly locale?: string | undefined;
  readonly timeZone?: string | undefined;
};

export function formatPullRequestTime(
  iso: string,
  options: PullRequestFormatOptions,
): PullRequestTimeModel {
  return {
    iso,
    relative: formatRelativeTimeLabel(iso, options.nowMs),
    absolute: new Date(iso).toLocaleString(
      options.locale,
      options.timeZone ? { timeZone: options.timeZone } : undefined,
    ),
  };
}

export function pullRequestReviewerKey(login: string): string {
  return login.toLowerCase();
}

export function pullRequestReviewStateLabel(state: string): string {
  const words = state.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function pullRequestCommentPreview(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/^\s*>?\s*\[!\w+\]\s*$/gmu, "")
    .replace(/!?(\[([^\]]+)\])\([^)]*\)/gu, "$2")
    .replace(/^[\s>#*-]+/gmu, "")
    .replace(/[*`]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function pullRequestCommentAuthorProfileUrl(input: {
  readonly provider: SourceControlProviderKind;
  readonly actor: PullRequestActor | null;
  readonly url: string;
}): string | null {
  return input.provider === "github" && input.actor && !input.actor.login.endsWith("[bot]")
    ? new URL(`/${encodeURIComponent(input.actor.login)}`, input.url).toString()
    : null;
}

export function pullRequestGroupAuthorProfileUrl(input: {
  readonly provider: SourceControlProviderKind;
  readonly actor: PullRequestActor | null;
  readonly url: string;
}): string | null {
  const { actor } = input;
  if (input.provider !== "github" || !actor) return null;
  return new URL(
    actor.isBot || actor.login.endsWith("[bot]")
      ? `/apps/${encodeURIComponent(actor.login.replace(/\[bot\]$/, ""))}`
      : `/${encodeURIComponent(actor.login)}`,
    input.url,
  ).toString();
}

export type PullRequestCommentPartition = {
  readonly threadByCommentId: ReadonlyMap<string, PullRequestReviewThread>;
  readonly active: ReadonlyArray<PullRequestComment>;
  readonly finished: ReadonlyArray<PullRequestComment>;
  readonly bots: ReadonlyArray<PullRequestComment>;
};

export function partitionPullRequestComments(
  detail: Pick<PullRequestDetailView, "reviewThreads" | "comments">,
): PullRequestCommentPartition {
  const threadByCommentId = new Map(
    detail.reviewThreads.flatMap((thread) =>
      thread.comments.map((comment) => [comment.id, thread] as const),
    ),
  );
  const active: PullRequestComment[] = [];
  const finished: PullRequestComment[] = [];
  const bots: PullRequestComment[] = [];
  for (const comment of detail.comments) {
    const isFinished =
      threadByCommentId.get(comment.id)?.isResolved ||
      pullRequestReviewOutcome(comment.reviewState) === "dismissed";
    const bot = comment.author?.isBot === true || comment.author?.login.endsWith("[bot]");
    (isFinished ? finished : bot ? bots : active).push(comment);
  }
  return { threadByCommentId, active, finished, bots };
}

export function resolvePullRequestCommentFinding(
  comment: PullRequestComment,
  thread: PullRequestReviewThread | undefined,
): PullRequestFinding | null {
  const outcome = pullRequestReviewOutcome(comment.reviewState);
  if ((comment.kind !== "review" && comment.kind !== "review-comment") || outcome === "approved") {
    return null;
  }
  if (thread === undefined) {
    return visibleBody(comment.body) === null ? null : { kind: "comment", comment };
  }
  return { kind: "thread", thread };
}

export type PullRequestFixButtonModel = {
  readonly label: string;
  readonly disabled: boolean;
};

function fixButton(
  finding: PullRequestFinding,
  pendingFinding: string | null,
  label: string,
): PullRequestFixButtonModel {
  return {
    label: pendingFinding === pullRequestFindingKey(finding) ? "Preparing..." : label,
    disabled: pendingFinding !== null,
  };
}

export type PullRequestCommentCardModel = {
  readonly key: string;
  readonly id: string;
  readonly actor: PullRequestActor | null;
  readonly author: PullRequestActorModel;
  readonly authorProfileUrl: string | null;
  readonly time: PullRequestTimeModel;
  readonly timeUrl: string | null;
  readonly timeTooltip: string;
  readonly outcome: {
    readonly outcome: PullRequestReviewOutcome;
    readonly label: string;
    readonly badgeVariant: "success" | "error" | "outline";
  } | null;
  readonly reviewStateLabel: string | null;
  readonly location: { readonly label: string; readonly outdated: boolean } | null;
  readonly fix: PullRequestFixButtonModel | null;
  readonly body: string | null;
  readonly bodyVisible: boolean;
  readonly canEdit: boolean;
  readonly editAriaLabel: string;
  readonly reactions: ReadonlyArray<PullRequestReaction>;
  readonly canReact: boolean;
};

export type PullRequestCommentCardInput = {
  readonly detail: PullRequestDetailView;
  readonly comment: PullRequestComment;
  readonly thread: PullRequestReviewThread | undefined;
  readonly pendingFinding: string | null;
  readonly fixFindingLabel: string;
  readonly canFix: boolean;
  readonly format: PullRequestFormatOptions;
};

export function buildPullRequestCommentCardModel(
  input: PullRequestCommentCardInput,
): PullRequestCommentCardModel {
  const { comment, detail, thread } = input;
  const body = visibleBody(comment.body);
  const outcome = pullRequestReviewOutcome(comment.reviewState);
  const finding = resolvePullRequestCommentFinding(comment, thread);
  const canEdit = canEditPullRequestComment(detail, comment);
  const path = thread?.path ?? comment.path;
  const time = formatPullRequestTime(comment.createdAt, input.format);
  return {
    key: `${detail.url}:${comment.id}`,
    id: comment.id,
    actor: comment.author,
    author: buildPullRequestActorModel(comment.author),
    authorProfileUrl: pullRequestCommentAuthorProfileUrl({
      provider: detail.provider,
      actor: comment.author,
      url: detail.url,
    }),
    time,
    timeUrl: comment.url,
    timeTooltip: `${time.absolute}${comment.url ? " · Open comment on host" : ""}`,
    outcome: outcome
      ? {
          outcome,
          label: pullRequestReviewOutcomeLabel(outcome),
          badgeVariant: pullRequestReviewOutcomeModel(outcome).badgeVariant,
        }
      : null,
    reviewStateLabel:
      outcome === null && comment.reviewState
        ? pullRequestReviewStateLabel(comment.reviewState)
        : null,
    location: path
      ? {
          label: `${path}${thread?.line ? `:${thread.line}` : ""}`,
          outdated: thread?.isOutdated === true,
        }
      : null,
    fix:
      input.canFix && finding !== null
        ? fixButton(finding, input.pendingFinding, input.fixFindingLabel)
        : null,
    body,
    bodyVisible: body !== null || canEdit,
    canEdit,
    editAriaLabel: "Edit comment",
    reactions: comment.reactions ?? [],
    canReact: detail.capabilities.reactions === true,
  };
}

export type PullRequestCollapsedCommentModel = PullRequestCommentCardModel & {
  readonly statusLabel: string;
  readonly preview: string | null;
};

export function buildPullRequestCollapsedCommentModel(
  input: PullRequestCommentCardInput,
): PullRequestCollapsedCommentModel {
  const card = buildPullRequestCommentCardModel(input);
  return {
    ...card,
    key: input.comment.id,
    statusLabel: input.thread?.isResolved ? "Resolved" : "Review dismissed",
    preview: card.body === null ? null : pullRequestCommentPreview(card.body),
  };
}

export type PullRequestCommentGroupModel = {
  readonly label: string;
  readonly avatars: ReadonlyArray<{
    readonly key: string;
    readonly actor: PullRequestActor | null;
    readonly profileUrl: string | null;
  }>;
  readonly overflowLabel: string | null;
  readonly authorsLabel: string;
  readonly filesLabel: string | null;
  readonly latest: PullRequestTimeModel | null;
};

export function buildPullRequestCommentGroupModel(input: {
  readonly label: string;
  readonly comments: ReadonlyArray<PullRequestComment>;
  readonly provider: SourceControlProviderKind;
  readonly url: string;
  readonly format: PullRequestFormatOptions;
}): PullRequestCommentGroupModel {
  const authors = [
    ...new Map(
      input.comments.map((comment) => [
        pullRequestReviewerKey(comment.author?.login ?? "ghost"),
        comment.author,
      ]),
    ).values(),
  ];
  const fileCount = new Set(
    input.comments.flatMap((comment) => (comment.path ? [comment.path] : [])),
  ).size;
  const latest = input.comments.reduce<string | null>(
    (date, comment) => (date === null || comment.createdAt > date ? comment.createdAt : date),
    null,
  );
  return {
    label: input.label,
    avatars: authors.slice(0, 3).map((actor) => ({
      key: actor?.login ?? "ghost",
      actor,
      profileUrl: pullRequestGroupAuthorProfileUrl({
        provider: input.provider,
        actor,
        url: input.url,
      }),
    })),
    overflowLabel: authors.length > 3 ? `+${authors.length - 3}` : null,
    authorsLabel: `${authors.length} ${authors.length === 1 ? "author" : "authors"}`,
    filesLabel: fileCount > 0 ? `· ${fileCount} ${fileCount === 1 ? "file" : "files"}` : null,
    latest: latest ? formatPullRequestTime(latest, input.format) : null,
  };
}

export type PullRequestReviewerEntryModel = {
  readonly key: string;
  readonly actor: PullRequestActor | null;
  readonly avatar: PullRequestActorModel;
  readonly outcome: PullRequestReviewOutcome | null;
  readonly stale: boolean;
  readonly ringClassName: string | null;
  readonly outcomeLabel: string | null;
  readonly tooltip: string;
};

export function buildPullRequestReviewerEntries(
  detail: Pick<PullRequestDetailView, "reviewers" | "comments" | "commits">,
): ReadonlyArray<PullRequestReviewerEntryModel> {
  const reviewOutcomes = latestPullRequestReviewOutcomes(detail.comments, detail.commits);
  const outcomeByLogin = new Map(
    reviewOutcomes.flatMap((entry) =>
      entry.actor ? [[pullRequestReviewerKey(entry.actor.login), entry] as const] : [],
    ),
  );
  const raw = [
    ...detail.reviewers.map((actor) => ({
      key: actor.login,
      actor,
      outcome: outcomeByLogin.get(pullRequestReviewerKey(actor.login))?.outcome ?? null,
      stale: outcomeByLogin.get(pullRequestReviewerKey(actor.login))?.stale ?? false,
    })),
    ...reviewOutcomes
      .filter(
        (entry) =>
          !detail.reviewers.some(
            (actor) =>
              entry.actor !== null &&
              pullRequestReviewerKey(actor.login) === pullRequestReviewerKey(entry.actor.login),
          ),
      )
      .map((entry) => ({
        key: entry.key,
        actor: entry.actor,
        outcome: entry.outcome,
        stale: entry.stale,
      })),
  ];
  return raw.map((entry) => {
    const login = entry.actor?.login ?? "ghost";
    const named =
      entry.actor?.name && entry.actor.name !== login ? `${entry.actor.name} (@${login})` : login;
    const outcomeLabel = entry.outcome
      ? entry.stale
        ? pullRequestReviewOutcomeStaleLabel(entry.outcome)
        : pullRequestReviewOutcomeLabel(entry.outcome)
      : null;
    return {
      key: entry.key,
      actor: entry.actor,
      avatar: buildPullRequestActorModel(entry.actor),
      outcome: entry.outcome,
      stale: entry.stale,
      ringClassName: entry.outcome
        ? pullRequestReviewOutcomeRingClassName(entry.outcome, entry.stale)
        : null,
      outcomeLabel,
      tooltip: outcomeLabel ? `${named} — ${outcomeLabel}` : named,
    };
  });
}

export type PullRequestCheckRowModel = {
  readonly key: string;
  readonly name: string;
  readonly status: PullRequestSignalModel;
  readonly statusKey: PullRequestCheckStatus;
  readonly statusLabel: string;
  readonly url: string | null;
  readonly fix: PullRequestFixButtonModel | null;
};

export type PullRequestChecksSectionModel =
  | { readonly kind: "stale"; readonly message: string; readonly refreshLabel: string }
  | { readonly kind: "empty"; readonly message: string }
  | { readonly kind: "rows"; readonly rows: ReadonlyArray<PullRequestCheckRowModel> };

export type PullRequestLabelTextParts = ReadonlyArray<string>;

export type PullRequestPagerModel = {
  readonly label: string;
  readonly parts: PullRequestLabelTextParts;
};

function olderPager(hidden: number, noun: string): PullRequestPagerModel | null {
  if (hidden <= 0) return null;
  const parts = [
    "Show ",
    String(Math.min(hidden, PULL_REQUEST_COMMENT_PAGE)),
    ` older ${noun}`,
    hidden === 1 ? "" : "s",
    " (",
    String(hidden),
    " hidden)",
  ];
  return { label: parts.join(""), parts };
}

function recentPager(shown: number, noun: string): PullRequestPagerModel | null {
  if (shown <= PULL_REQUEST_COMMENT_PAGE) return null;
  const parts = ["Show only ", String(PULL_REQUEST_COMMENT_PAGE), ` recent ${noun}s`];
  return { label: parts.join(""), parts };
}

export type PullRequestSummaryInput = {
  readonly detail: PullRequestDetailView;
  readonly activityPending: boolean;
  readonly activityError: string | null;
  readonly checksStale: boolean;
  readonly pendingFinding: string | null;
  readonly fixFindingLabel: string;
  readonly fixCheckLabel: string;
  readonly canFix: boolean;
  readonly shownComments: number;
  readonly shownBotComments: number;
  readonly botGroupOpened: boolean;
  readonly commentOrder: "newest" | "oldest";
  readonly editingDescription: boolean;
  readonly format: PullRequestFormatOptions;
};

export type PullRequestSummaryModel = {
  readonly reviewers: {
    readonly label: string;
    readonly emptyLabel: string | null;
    readonly entries: ReadonlyArray<PullRequestReviewerEntryModel>;
    readonly picker: { readonly visible: boolean; readonly allowed: boolean };
  };
  readonly labels: {
    readonly visible: boolean;
    readonly label: string;
    readonly emptyLabel: string | null;
    readonly chips: ReadonlyArray<PullRequestLabelChipModel>;
    readonly picker: { readonly visible: boolean; readonly allowed: boolean };
  };
  readonly description: {
    readonly title: string;
    readonly editing: boolean;
    readonly text: string;
    readonly canEdit: boolean;
    readonly editAriaLabel: string;
    readonly editorLabel: string;
    readonly editorPlaceholder: string;
  };
  readonly checks: {
    readonly title: string;
    readonly body: PullRequestChecksSectionModel;
  };
  readonly comments: {
    readonly title: string;
    readonly order: { readonly label: string; readonly ariaLabel: string };
    readonly state: "loading" | "error" | "ready";
    readonly truncatedNotice: string | null;
    readonly emptyLabel: string | null;
    readonly visible: ReadonlyArray<PullRequestCommentCardModel>;
    readonly showOlder: PullRequestPagerModel | null;
    readonly showRecent: PullRequestPagerModel | null;
    readonly bots: {
      readonly group: PullRequestCommentGroupModel;
      readonly visible: ReadonlyArray<PullRequestCommentCardModel>;
      readonly showOlder: PullRequestPagerModel | null;
      readonly showRecent: PullRequestPagerModel | null;
    } | null;
    readonly finished: {
      readonly group: PullRequestCommentGroupModel;
      readonly items: ReadonlyArray<PullRequestCollapsedCommentModel>;
    } | null;
  };
};

export function buildPullRequestSummaryModel(
  input: PullRequestSummaryInput,
): PullRequestSummaryModel {
  const { detail, format } = input;
  const partition = partitionPullRequestComments(detail);
  const recent = partition.active.slice(Math.max(0, partition.active.length - input.shownComments));
  const hidden = partition.active.length - recent.length;
  const recentBots = partition.bots.slice(
    Math.max(0, partition.bots.length - input.shownBotComments),
  );
  const hiddenBots = partition.bots.length - recentBots.length;
  const card = (comment: PullRequestComment) =>
    buildPullRequestCommentCardModel({
      detail,
      comment,
      thread: partition.threadByCommentId.get(comment.id),
      pendingFinding: input.pendingFinding,
      fixFindingLabel: input.fixFindingLabel,
      canFix: input.canFix,
      format,
    });
  const botCount = partition.bots.length;
  const finishedCount = partition.finished.length;
  const reviewerEntries = buildPullRequestReviewerEntries(detail);
  return {
    reviewers: {
      label: "Reviewers",
      emptyLabel: reviewerEntries.length === 0 ? "None" : null,
      entries: reviewerEntries,
      picker: {
        visible:
          detail.capabilities.reviewers.request && detail.capabilities.reviewers.listCandidates,
        allowed: detail.viewerPermissions.requestReviewers,
      },
    },
    labels: {
      visible: detail.labels.length > 0 || detail.capabilities.labels === true,
      label: "Labels",
      emptyLabel: detail.labels.length === 0 ? "None" : null,
      chips: detail.labels.map(buildPullRequestLabelChipModel),
      picker: {
        visible: detail.capabilities.labels === true,
        allowed: detail.viewerPermissions.labels !== false,
      },
    },
    description: {
      title: "Description",
      editing: input.editingDescription,
      text: detail.body.trim().length > 0 ? detail.body : "_No description provided._",
      canEdit: canEditPullRequestChangeRequest(detail),
      editAriaLabel: "Edit description",
      editorLabel: "Pull request description",
      editorPlaceholder: "Describe this pull request",
    },
    checks: {
      title: "Checks",
      body: input.checksStale
        ? { kind: "stale", message: "Check details are out of date.", refreshLabel: "Refresh" }
        : detail.checks.length === 0
          ? { kind: "empty", message: "No checks reported." }
          : {
              kind: "rows",
              rows: detail.checks.map((check, index) => {
                const failing = check.status === "failure" || check.status === "cancelled";
                return {
                  key: `${index}:${check.name}:${check.url ?? ""}`,
                  name: check.name,
                  status: pullRequestCheckStatusModel(check.status),
                  statusKey: check.status,
                  statusLabel: pullRequestCheckStatusLabel(check),
                  url: check.url,
                  fix:
                    input.canFix && failing
                      ? fixButton(
                          { kind: "check", check },
                          input.pendingFinding,
                          input.fixCheckLabel,
                        )
                      : null,
                };
              }),
            },
    },
    comments: {
      title: `Comments (${detail.commentCount})`,
      order: {
        label: input.commentOrder === "newest" ? "Newest first" : "Oldest first",
        ariaLabel:
          input.commentOrder === "newest"
            ? "Show oldest comments first"
            : "Show newest comments first",
      },
      state: input.activityPending ? "loading" : input.activityError ? "error" : "ready",
      truncatedNotice: detail.commentsTruncated
        ? `This conversation is longer than this page reads in one go. The most recent ${detail.comments.length} are here; open it on the host to read the rest.`
        : null,
      emptyLabel: detail.comments.length === 0 ? "No comments yet." : null,
      visible: orderPullRequestComments(recent, input.commentOrder).map(card),
      showOlder: olderPager(hidden, "comment"),
      showRecent: recentPager(input.shownComments, "comment"),
      bots:
        botCount > 0
          ? {
              group: buildPullRequestCommentGroupModel({
                label: `${botCount} bot comment${botCount === 1 ? "" : "s"}`,
                comments: partition.bots,
                provider: detail.provider,
                url: detail.url,
                format,
              }),
              visible: input.botGroupOpened
                ? orderPullRequestComments(recentBots, input.commentOrder).map(card)
                : [],
              showOlder: olderPager(hiddenBots, "bot comment"),
              showRecent: recentPager(input.shownBotComments, "bot comment"),
            }
          : null,
      finished:
        finishedCount > 0
          ? {
              group: buildPullRequestCommentGroupModel({
                label: `${finishedCount} resolved or dismissed comment${
                  finishedCount === 1 ? "" : "s"
                }`,
                comments: partition.finished,
                provider: detail.provider,
                url: detail.url,
                format,
              }),
              items: orderPullRequestComments(partition.finished, input.commentOrder).map(
                (comment) =>
                  buildPullRequestCollapsedCommentModel({
                    detail,
                    comment,
                    thread: partition.threadByCommentId.get(comment.id),
                    pendingFinding: input.pendingFinding,
                    fixFindingLabel: input.fixFindingLabel,
                    canFix: false,
                    format,
                  }),
              ),
            }
          : null,
    },
  };
}

export type PullRequestCommentSaveDecision =
  | { readonly kind: "ignore" }
  | {
      readonly kind: "save";
      readonly commentId: string;
      readonly commentKind: Exclude<PullRequestComment["kind"], "review">;
      readonly body: string;
    };

export function resolvePullRequestCommentSave(input: {
  readonly comment: Pick<PullRequestComment, "id" | "kind">;
  readonly body: string;
  readonly saving: boolean;
}): PullRequestCommentSaveDecision {
  const { comment } = input;
  if (input.saving || comment.kind === "review") return { kind: "ignore" };
  return { kind: "save", commentId: comment.id, commentKind: comment.kind, body: input.body };
}
