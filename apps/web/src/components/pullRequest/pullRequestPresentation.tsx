import { Spinner } from "~/components/ui/spinner";
import type {
  PullRequestActor,
  PullRequestCheckStatus,
  PullRequestChecksState,
  PullRequestLabel,
  PullRequestMergeability,
  PullRequestReviewDecision,
  PullRequestState,
} from "@t3tools/contracts";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleXIcon,
  UserCheckIcon,
  UserRoundIcon,
  UserRoundXIcon,
} from "lucide-react";
import { Children, type CSSProperties, isValidElement, type ReactNode, useState } from "react";

import { cn } from "~/lib/utils";

import { Badge } from "../ui/badge";
import { InlineButton } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { PullRequestReviewOutcome } from "./pullRequestDetail.logic";
import {
  PullRequestGlyph,
  type PullRequestStatePresentation,
  type PullRequestGlyphIcon,
} from "./pullRequestIcons";
import {
  buildPullRequestLabelChipModel,
  formatPullRequestDiffStat,
  pullRequestActorLogin,
  pullRequestActorTooltip,
  pullRequestCheckStatusModel,
  pullRequestChecksStateModel,
  pullRequestReviewDecisionModel,
  pullRequestReviewOutcomeModel,
  resolvePullRequestConflictModel,
  resolvePullRequestStateModel,
} from "./pullRequestPresentation.logic";

const SIGNAL_ICONS = {
  spinner: Spinner,
  "circle-check": CircleCheckIcon,
  "circle-dot": CircleDotIcon,
  "circle-x": CircleXIcon,
  "circle-dashed": CircleDashedIcon,
  "user-check": UserCheckIcon,
  "user-round-x": UserRoundXIcon,
  "user-round": UserRoundIcon,
} as const;

/**
 * A host label as a flat tinted tag in the label's own color: a wash of it behind, the name
 * in a mix of it and the theme foreground. The mix leans to the foreground because hosts hand
 * out any color at all: at 30% of the label on light and 45% on dark, white, black and
 * GitHub's pale yellows all clear 4.5:1 on their wash, selected row included, and
 * saturated colors sit well above.
 * A label with no usable color falls back to the muted tag. Children ride after the name,
 * for an overflow count. The height is pinned so a labeled row is as tall as one without.
 */
export function PullRequestLabelChip({
  label,
  size = "sm",
  className,
  children,
}: {
  label: Pick<PullRequestLabel, "name" | "color">;
  size?: "sm" | "default";
  className?: string;
  children?: ReactNode;
}) {
  const { name, color } = buildPullRequestLabelChipModel(label);
  return (
    <Badge
      size={size}
      variant={color ? "label" : "secondary"}
      className={cn("min-w-0 max-w-40 shrink justify-start", className)}
      {...(color ? { style: { "--label": color } as CSSProperties } : {})}
    >
      <span className="truncate">{name}</span>
      {children}
    </Badge>
  );
}

/**
 * The review verdict as one glyph beside the checks glyph, so a row answers both "does it
 * build" and "did someone say yes" in the same spot. "Awaiting review" is only drawn when the
 * host reports it, which on GitHub means the branch rules require a review nobody has given.
 */
export function PullRequestReviewDecisionGlyph({
  decision,
}: {
  decision: PullRequestReviewDecision;
}) {
  const presentation = pullRequestReviewDecisionModel(decision);
  const Icon = SIGNAL_ICONS[presentation.icon];
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
        <Icon aria-hidden className={cn("size-3.5", presentation.toneClassName)} />
        <span className="sr-only">{presentation.label}</span>
      </TooltipTrigger>
      <TooltipPopup>{presentation.label}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * How a pull request's state reads anywhere it appears: the thread badge, the right-panel tab,
 * the list, and the detail header all resolve through here so one pull request cannot look like
 * two different things in two places.
 *
 * Closed and merged take precedence over a stale draft flag.
 */
export function resolvePullRequestState(input: {
  readonly state: PullRequestState;
  readonly isDraft: boolean;
}): PullRequestStatePresentation {
  const model = resolvePullRequestStateModel(input);
  return {
    label: model.label,
    toneClassName: model.toneClassName,
    Icon: PullRequestGlyph[model.icon],
  };
}

export interface PullRequestConflictPresentation {
  readonly label: string;
  readonly toneClassName: string;
  readonly Icon: PullRequestGlyphIcon;
}

export function resolvePullRequestConflict(input: {
  readonly state: PullRequestState;
  readonly isDraft: boolean;
  readonly mergeability?: PullRequestMergeability;
  readonly baseBranch?: string;
}): PullRequestConflictPresentation | null {
  const model = resolvePullRequestConflictModel(input);
  if (model === null) return null;
  return {
    label: model.label,
    toneClassName: model.toneClassName,
    Icon: PullRequestGlyph[model.icon],
  };
}

export function PullRequestStateGlyph({
  state,
  isDraft,
  className,
}: {
  state: PullRequestState;
  isDraft: boolean;
  className?: string;
}) {
  const presentation = resolvePullRequestState({ state, isDraft });
  return (
    <Tooltip>
      {/* The list row is itself a button, so the trigger stays a span: an interactive one would
          nest a control inside that button and steal the row's click target. */}
      <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
        <presentation.Icon
          role="img"
          aria-label={presentation.label}
          className={cn("size-4 shrink-0", presentation.toneClassName, className)}
        />
      </TooltipTrigger>
      <TooltipPopup>{presentation.label}</TooltipPopup>
    </Tooltip>
  );
}

export function PullRequestConflictGlyph({
  state,
  isDraft,
  mergeability,
  baseBranch,
  className,
}: {
  state: PullRequestState;
  isDraft: boolean;
  mergeability?: PullRequestMergeability;
  baseBranch?: string;
  className?: string;
}) {
  const presentation = resolvePullRequestConflict({
    state,
    isDraft,
    ...(mergeability === undefined ? {} : { mergeability }),
    ...(baseBranch === undefined ? {} : { baseBranch }),
  });
  if (presentation === null) return null;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
        <presentation.Icon
          role="img"
          aria-label={presentation.label}
          className={cn("size-4 shrink-0", presentation.toneClassName, className)}
        />
      </TooltipTrigger>
      <TooltipPopup>{presentation.label}</TooltipPopup>
    </Tooltip>
  );
}

export function PullRequestCheckStatusIcon({ status }: { status: PullRequestCheckStatus }) {
  const presentation = pullRequestCheckStatusModel(status);
  const Icon = SIGNAL_ICONS[presentation.icon];
  return <Icon aria-hidden className={cn("size-3.5 shrink-0", presentation.toneClassName)} />;
}

/**
 * The rollup a listing row carries, which is one word rather than the checks behind it. The
 * headline is GitHub's own wording, so a reader who knows that page reads this one the same way.
 */
export function pullRequestChecksStatePresentation(state: PullRequestChecksState) {
  const model = pullRequestChecksStateModel(state);
  return { label: model.label, toneClassName: model.toneClassName, Icon: SIGNAL_ICONS[model.icon] };
}

/** Decorative: every caller says which verdict this is in words beside it. */
export function PullRequestReviewOutcomeIcon({
  outcome,
  className,
}: {
  outcome: PullRequestReviewOutcome;
  className?: string;
}) {
  const presentation = pullRequestReviewOutcomeModel(outcome);
  const Icon = SIGNAL_ICONS[presentation.icon];
  return (
    <Icon aria-hidden className={cn("size-3.5 shrink-0", presentation.toneClassName, className)} />
  );
}

export function PullRequestReviewOutcomeBadge({
  outcome,
  className,
}: {
  outcome: PullRequestReviewOutcome;
  className?: string;
}) {
  const presentation = pullRequestReviewOutcomeModel(outcome);
  const Icon = SIGNAL_ICONS[presentation.icon];
  return (
    <Badge size="sm" variant={presentation.badgeVariant} className={className}>
      <Icon aria-hidden className="size-3" />
      {presentation.label}
    </Badge>
  );
}

export function PullRequestActorAvatar({
  actor,
  className,
}: {
  actor: PullRequestActor | null;
  className?: string;
}) {
  const login = pullRequestActorLogin(actor);
  const avatarUrl = actor?.avatarUrl ?? null;
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  return avatarUrl === null || failedAvatarUrl === avatarUrl ? (
    // Not every host reports an avatar, and a private host may refuse the browser's request.
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-3xs font-medium text-muted-foreground",
        className,
      )}
    >
      {login.slice(0, 1).toUpperCase()}
    </span>
  ) : (
    <img
      aria-hidden
      alt=""
      src={avatarUrl}
      loading="lazy"
      className={cn("size-4 shrink-0 rounded-full bg-muted object-cover", className)}
      onError={() => setFailedAvatarUrl(avatarUrl)}
    />
  );
}

/**
 * GitHub attributes work from a deleted account to "ghost"; say the same word everywhere.
 *
 * An actor as a login beside its avatar, or as the avatar alone. With a profile URL the actor
 * is an inline link; `className` places it and never restyles it.
 */
export function PullRequestActorLabel({
  actor,
  className,
  variant = "label",
  tooltip = true,
  profileUrl,
}: {
  actor: PullRequestActor | null;
  className?: string;
  variant?: "label" | "avatar";
  tooltip?: boolean;
  profileUrl?: string | null;
}) {
  const login = pullRequestActorLogin(actor);
  const label = (
    <span className={cn("flex min-w-0 items-center", variant === "label" && "gap-1.5")}>
      <PullRequestActorAvatar actor={actor} />
      <span className={variant === "label" ? "truncate font-medium text-foreground" : "sr-only"}>
        {login}
      </span>
    </span>
  );
  const placement = cn("flex min-w-0 shrink", className);
  if (!tooltip) return <span className={placement}>{label}</span>;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          profileUrl ? (
            <InlineButton
              className={placement}
              render={
                <a
                  href={profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${login}'s profile`}
                />
              }
            />
          ) : (
            <span className={placement} />
          )
        }
      >
        {label}
      </TooltipTrigger>
      <TooltipPopup side="top">
        {pullRequestActorTooltip(actor)}
        {profileUrl ? " · Open profile" : ""}
      </TooltipPopup>
    </Tooltip>
  );
}

/** Added and removed lines, coloured the way every host colours them. */
export function PullRequestDiffStat({
  additions,
  deletions,
  className,
}: {
  additions: number;
  deletions: number;
  className?: string;
}) {
  // Not every host reports line counts. Showing "+0 -0" would read as an empty change set
  // rather than as a missing one, so the stat is left out instead.
  const stat = formatPullRequestDiffStat(additions, deletions);
  if (stat === null) {
    return null;
  }
  return (
    <span className={cn("inline-flex items-baseline gap-1 tabular-nums", className)}>
      <span className="text-diff-addition-foreground">{stat.additions}</span>
      <span className="text-diff-deletion">{stat.deletions}</span>
    </span>
  );
}

/**
 * Dot-separated metadata. It owns the separator, and draws one only between the segments that
 * survive, so a caller can render `{condition ? <span/> : null}` without leaving a stray dot.
 * `Children.toArray` drops the nullish entries and keys what remains, which a plain array
 * check would not do for a single child or a fragment. A separator borrows the key of the
 * segment it precedes, so it stays stable without counting positions.
 */
function separatorKey(segment: ReactNode): string {
  return `separator:${isValidElement(segment) ? String(segment.key) : String(segment)}`;
}

export function PullRequestMetaLine({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const segments = Children.toArray(children);
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      {segments.flatMap((segment, index) =>
        index === 0
          ? segment
          : [
              <span
                aria-hidden
                className="shrink-0 text-muted-foreground/50"
                key={separatorKey(segment)}
              >
                ·
              </span>,
              segment,
            ],
      )}
    </span>
  );
}
