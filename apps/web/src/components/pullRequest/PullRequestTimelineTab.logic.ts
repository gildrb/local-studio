import type {
  PullRequestActor,
  PullRequestDetailView,
  PullRequestReaction,
} from "@t3tools/contracts";

import { formatRelativeTimeLabel } from "~/timestampFormat";
import {
  buildPullRequestTimeline,
  groupPullRequestTimelineConversations,
  isPullRequestVerdictStale,
  newestPullRequestCommitAt,
  pullRequestReviewOutcome,
  type PullRequestReviewOutcome,
  type PullRequestTimelineEvent,
} from "./pullRequestDetail.logic";
import { canEditPullRequestComment } from "./pullRequestEditing.logic";
import {
  formatPullRequestDiffStat,
  pullRequestActorLogin,
  pullRequestReviewOutcomeLabel,
  pullRequestReviewOutcomeStaleLabel,
  pullRequestReviewOutcomeToneClassName,
  type PullRequestDiffStatModel,
  type PullRequestGlyphId,
} from "./pullRequestPresentation.logic";

export const PULL_REQUEST_TIMELINE_COMMENT_SAVE_FAILED = "Could not save the comment";

export function friendlyPullRequestReviewState(value: string): string {
  const words = value.toLowerCase().replaceAll("_", " ").replaceAll("-", " ");
  return words.replace(/^\w/u, (letter) => letter.toUpperCase());
}

export type PullRequestTimelineBodyModel = {
  readonly text: string;
  readonly markdown: boolean;
};

export type PullRequestTimelineReactionsModel = {
  readonly visible: boolean;
  readonly canReact: boolean;
  readonly reactions: ReadonlyArray<PullRequestReaction>;
};

export type PullRequestTimelineCardModel = {
  readonly key: string;
  readonly id: string;
  readonly actorLogin: string;
  readonly title: string;
  readonly reviewStateLabel: string | null;
  readonly time: string;
  readonly path: string | null;
  readonly editable: boolean;
  readonly editAriaLabel: string;
  readonly url: string | null;
  readonly openAriaLabel: string;
  readonly body: PullRequestTimelineBodyModel | null;
  readonly reactions: PullRequestTimelineReactionsModel;
};

export type PullRequestTimelineRowModel =
  | {
      readonly kind: "conversation";
      readonly key: string;
      readonly markerActors: ReadonlyArray<PullRequestActor>;
      readonly countLabel: string;
      readonly authorsLabel: string;
      readonly cards: ReadonlyArray<PullRequestTimelineCardModel>;
    }
  | {
      readonly kind: "commit";
      readonly key: string;
      readonly oid: string;
      readonly ariaLabel: string;
      readonly title: string;
      readonly shortOid: string;
      readonly time: string;
      readonly markerActors: ReadonlyArray<PullRequestActor>;
      readonly additions: number | null;
      readonly deletions: number | null;
      readonly diffStat: PullRequestDiffStatModel | null;
    }
  | {
      readonly kind: "verdict";
      readonly key: string;
      readonly id: string;
      readonly markerActors: ReadonlyArray<PullRequestActor>;
      readonly actorLogin: string;
      readonly outcome: PullRequestReviewOutcome;
      readonly label: string;
      readonly toneClassName: string;
      readonly stale: boolean;
      readonly staleTooltip: string;
      readonly staleSrLabel: string;
      readonly time: string;
      readonly path: string | null;
      readonly url: string | null;
      readonly openAriaLabel: string;
      readonly body: PullRequestTimelineBodyModel | null;
      readonly reactions: PullRequestTimelineReactionsModel;
    }
  | {
      readonly kind: "lifecycle";
      readonly key: string;
      readonly icon: Extract<PullRequestGlyphId, "pullRequest" | "merged" | "closed">;
      readonly label: string;
      readonly actorLogin: string | null;
      readonly time: string;
    };

export type PullRequestTimelineInput = {
  readonly detail: PullRequestDetailView;
  readonly order: "newest" | "oldest";
  readonly nowMs: number;
  readonly locale?: string | undefined;
};

export type PullRequestTimelineModel = {
  readonly rows: ReadonlyArray<PullRequestTimelineRowModel>;
  readonly emptyLabel: string | null;
};

function eventBody(event: PullRequestTimelineEvent): PullRequestTimelineBodyModel | null {
  return event.body ? { text: event.body, markdown: event.markdown } : null;
}

function reactionsModel(
  event: PullRequestTimelineEvent,
  canReact: boolean,
): PullRequestTimelineReactionsModel {
  return {
    visible: canReact || event.reactions.length > 0,
    canReact,
    reactions: event.reactions,
  };
}

function uniqueConversationActors(
  events: ReadonlyArray<PullRequestTimelineEvent>,
): ReadonlyArray<PullRequestActor> {
  const actors = new Map<string, PullRequestActor>();
  for (const event of events) {
    const actor = event.actor;
    if (actor !== null && !actors.has(actor.login)) actors.set(actor.login, actor);
  }
  return [...actors.values()];
}

function lifecyclePresentation(kind: PullRequestTimelineEvent["kind"]): {
  readonly icon: Extract<PullRequestGlyphId, "pullRequest" | "merged" | "closed">;
  readonly label: string;
} {
  if (kind === "opened") return { icon: "pullRequest", label: "Pull request opened" };
  if (kind === "merged") return { icon: "merged", label: "Pull request merged" };
  return { icon: "closed", label: "Pull request closed" };
}

export function buildPullRequestTimelineModel(
  input: PullRequestTimelineInput,
): PullRequestTimelineModel {
  const { detail, nowMs, locale } = input;
  const events = buildPullRequestTimeline(detail);
  const newestCommitAt = newestPullRequestCommitAt(detail.commits);
  const canReact = detail.capabilities.reactions === true;
  const editable = new Set(
    detail.comments
      .filter((comment) => canEditPullRequestComment(detail, comment))
      .map((comment) => comment.id),
  );
  const orderedEvents = input.order === "newest" ? events : events.toReversed();
  const time = (at: string) => formatRelativeTimeLabel(at, nowMs);
  const rows = groupPullRequestTimelineConversations(orderedEvents).flatMap(
    (row): ReadonlyArray<PullRequestTimelineRowModel> => {
      if (row.kind === "comments") {
        const first = row.events[0];
        if (first === undefined) return [];
        const actors = uniqueConversationActors(row.events);
        return [
          {
            kind: "conversation",
            key: `comments:${first.id}`,
            markerActors: actors,
            countLabel: `${row.events.length.toLocaleString(locale)} ${
              row.events.length === 1 ? "comment" : "comments"
            }`,
            authorsLabel: `${actors.length.toLocaleString(locale)} ${
              actors.length === 1 ? "author" : "authors"
            } · ${time(first.at)}`,
            cards: row.events.map((event) => ({
              key: `${detail.projectId}#${detail.number}:${event.id}`,
              id: event.id,
              actorLogin: pullRequestActorLogin(event.actor),
              title: event.title,
              reviewStateLabel: event.reviewState
                ? friendlyPullRequestReviewState(event.reviewState)
                : null,
              time: time(event.at),
              path: event.path,
              editable: editable.has(event.id),
              editAriaLabel: "Edit comment",
              url: event.url,
              openAriaLabel: "Open activity on host",
              body: eventBody(event),
              reactions: reactionsModel(event, canReact),
            })),
          },
        ];
      }
      const event = row.event;
      if (event.kind === "commit") {
        return [
          {
            kind: "commit",
            key: event.id,
            oid: event.id,
            ariaLabel: `View commit ${event.id}`,
            title: event.body ?? "Untitled commit",
            shortOid: event.id.slice(0, 7),
            time: time(event.at),
            markerActors: event.commitAuthors,
            additions: event.additions,
            deletions: event.deletions,
            diffStat:
              event.additions !== null && event.deletions !== null
                ? formatPullRequestDiffStat(event.additions, event.deletions, locale)
                : null,
          },
        ];
      }
      const outcome = pullRequestReviewOutcome(event.reviewState);
      if (outcome !== null) {
        return [
          {
            kind: "verdict",
            key: event.id,
            id: event.id,
            markerActors: event.actor ? [event.actor] : [],
            actorLogin: pullRequestActorLogin(event.actor),
            outcome,
            label: pullRequestReviewOutcomeLabel(outcome),
            toneClassName: pullRequestReviewOutcomeToneClassName(outcome),
            stale: isPullRequestVerdictStale(event.at, newestCommitAt),
            staleTooltip: pullRequestReviewOutcomeStaleLabel(outcome),
            staleSrLabel: ", before the latest commits",
            time: time(event.at),
            path: event.path,
            url: event.url,
            openAriaLabel: "Open activity on host",
            body: eventBody(event),
            reactions: reactionsModel(event, canReact),
          },
        ];
      }
      const presentation = lifecyclePresentation(event.kind);
      return [
        {
          kind: "lifecycle",
          key: event.id,
          icon: presentation.icon,
          label: presentation.label,
          actorLogin: event.actor ? event.actor.login : null,
          time: time(event.at),
        },
      ];
    },
  );
  return { rows, emptyLabel: events.length === 0 ? "No activity yet." : null };
}
