import type {
  EnvironmentId,
  PullRequestActor,
  PullRequestComment,
  PullRequestDetailView,
  PullRequestRef,
  ScopedThreadRef,
} from "@t3tools/contracts";
import {
  ChevronDownIcon,
  ExternalLinkIcon,
  FileCode2Icon,
  GitCommitHorizontalIcon,
  MessageSquareIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useAtomCommand } from "~/state/use-atom-command";

import { Button } from "../ui/button";
import { PullRequestEditButton } from "./PullRequestEditButton";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PullRequestMarkdown } from "./PullRequestMarkdown";
import { PullRequestMarkdownEditor } from "./PullRequestMarkdownEditor";
import { PullRequestReactionBar } from "./PullRequestReactions";
import {
  PullRequestActorAvatar,
  PullRequestDiffStat,
  PullRequestMetaLine,
  PullRequestReviewOutcomeIcon,
} from "./pullRequestPresentation";
import { PullRequestGlyph } from "./pullRequestIcons";
import { resolvePullRequestCommentSave } from "./PullRequestSummaryTab.logic";
import {
  buildPullRequestTimelineModel,
  PULL_REQUEST_TIMELINE_COMMENT_SAVE_FAILED,
  type PullRequestTimelineBodyModel,
  type PullRequestTimelineCardModel,
  type PullRequestTimelineReactionsModel,
  type PullRequestTimelineRowModel,
} from "./PullRequestTimelineTab.logic";

/** What every comment on the timeline needs to react; only the subject differs between them. */
interface ReactionSurface {
  readonly environmentId: EnvironmentId;
  /** Thread the timeline is shown beside, so body links can open in its in-app browser. */
  readonly threadRef: ScopedThreadRef | null;
  readonly reference: PullRequestRef;
  readonly onRefresh: () => void;
}

function TimelineBody({
  body,
  cwd,
  environmentId,
  threadRef,
}: {
  body: PullRequestTimelineBodyModel;
  cwd: string;
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef | null;
}) {
  return (
    <div className="mt-3">
      {body.markdown ? (
        <PullRequestMarkdown
          text={body.text}
          cwd={cwd}
          environmentId={environmentId}
          threadRef={threadRef}
        />
      ) : (
        <p className="whitespace-pre-wrap text-xs text-muted-foreground">{body.text}</p>
      )}
    </div>
  );
}

function ActorName({ login }: { login: string }) {
  return <span className="font-semibold text-foreground">{login}</span>;
}

function TimelineMarker({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <span
      className={cn(
        "absolute left-0 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center bg-background",
        className,
      )}
    >
      {children}
    </span>
  );
}

function IconMarker({ icon, className }: { icon: ReactNode; className?: string | undefined }) {
  return (
    <TimelineMarker className={className}>
      <span className="flex size-7 items-center justify-center bg-background text-muted-foreground">
        {icon}
      </span>
    </TimelineMarker>
  );
}

function ActorTimelineMarker({
  actors,
  className,
  fallback,
  muted = false,
}: {
  actors: ReadonlyArray<PullRequestActor>;
  className?: string | undefined;
  fallback: ReactNode;
  muted?: boolean;
}) {
  const actor = actors[0];
  return actor === undefined ? (
    <IconMarker className={className} icon={fallback} />
  ) : (
    <TimelineMarker className={className}>
      <PullRequestActorAvatar
        actor={actor}
        className={cn(
          "size-7 bg-muted text-3xs transition-opacity",
          muted && "opacity-45 grayscale",
        )}
      />
    </TimelineMarker>
  );
}

function OpenOnHostButton({
  url,
  ariaLabel,
  onOpen,
}: {
  url: string | null;
  ariaLabel: string;
  onOpen: (url: string) => void;
}) {
  return url === null ? null : (
    <Button
      size="icon-xs"
      variant="ghost-muted"
      className="-mr-1 -mt-1 shrink-0"
      aria-label={ariaLabel}
      onClick={() => onOpen(url)}
    >
      <ExternalLinkIcon className="size-3" />
    </Button>
  );
}

function TimelineReactions({
  subjectId,
  model,
  surface,
}: {
  subjectId: string;
  model: PullRequestTimelineReactionsModel;
  surface: ReactionSurface;
}) {
  return model.visible ? (
    <PullRequestReactionBar
      className="ml-auto justify-end"
      reactions={model.reactions}
      canReact={model.canReact}
      subjectId={subjectId}
      environmentId={surface.environmentId}
      reference={surface.reference}
      onRefresh={surface.onRefresh}
    />
  ) : null;
}

function ConversationCard({
  card,
  editable,
  cwd,
  onOpen,
  surface,
}: {
  card: PullRequestTimelineCardModel;
  /** The remark behind this entry, only where this reader may rewrite it. */
  editable: PullRequestComment | null;
  cwd: string;
  onOpen: (url: string) => void;
  surface: ReactionSurface;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const updateComment = useAtomCommand(pullRequestEnvironment.updateComment, {
    reportFailure: false,
  });

  const save = async (body: string) => {
    if (editable === null) return;
    // A review's own summary is not a kind any host rewrites, which is why `editable` is never
    // one; the check is here because the comment's own type still allows it.
    const decision = resolvePullRequestCommentSave({ comment: editable, body, saving });
    if (decision.kind === "ignore") return;
    setSaving(true);
    const result = await updateComment({
      environmentId: surface.environmentId,
      input: {
        ...surface.reference,
        commentId: decision.commentId,
        kind: decision.commentKind,
        body: decision.body,
      },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: PULL_REQUEST_TIMELINE_COMMENT_SAVE_FAILED });
      return;
    }
    setEditing(false);
    surface.onRefresh();
  };

  return (
    <article className="group py-2">
      <div className="px-2">
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
              <ActorName login={card.actorLogin} />
              <span className="text-muted-foreground">{card.title}</span>
              {card.reviewStateLabel ? (
                <span className="text-3xs font-medium text-muted-foreground">
                  {card.reviewStateLabel}
                </span>
              ) : null}
            </div>
            <PullRequestMetaLine className="mt-1 flex-wrap text-2xs text-muted-foreground">
              <span>{card.time}</span>
              {card.path ? (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <FileCode2Icon aria-hidden className="size-3 shrink-0" />
                  <span className="truncate">{card.path}</span>
                </span>
              ) : null}
            </PullRequestMetaLine>
          </div>
          {editable !== null && !editing ? (
            <PullRequestEditButton
              className="-mt-1"
              aria-label={card.editAriaLabel}
              onClick={() => setEditing(true)}
            />
          ) : null}
          <TimelineReactions subjectId={card.id} model={card.reactions} surface={surface} />
          <OpenOnHostButton url={card.url} ariaLabel={card.openAriaLabel} onOpen={onOpen} />
        </div>
      </div>
      {editing && editable !== null ? (
        <div className="px-2 pb-2 pt-3">
          <PullRequestMarkdownEditor
            value={editable.body}
            cwd={cwd}
            environmentId={surface.environmentId}
            threadRef={surface.threadRef}
            label={card.editAriaLabel}
            saving={saving}
            onSave={(body) => void save(body)}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : card.body ? (
        <div className="px-2 pb-2">
          <TimelineBody
            body={card.body}
            cwd={cwd}
            environmentId={surface.environmentId}
            threadRef={surface.threadRef}
          />
        </div>
      ) : null}
    </article>
  );
}

function ConversationGroup({
  row,
  editable,
  cwd,
  onOpen,
  surface,
}: {
  row: Extract<PullRequestTimelineRowModel, { kind: "conversation" }>;
  editable: ReadonlyMap<string, PullRequestComment>;
  cwd: string;
  onOpen: (url: string) => void;
  surface: ReactionSurface;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative mb-5 pl-12 [contain-intrinsic-block-size:48px] [content-visibility:auto]">
      <ActorTimelineMarker
        actors={row.markerActors}
        className="top-6"
        fallback={<MessageSquareIcon className="size-3.5" />}
        muted={!open}
      />
      <Collapsible open={open} onOpenChange={setOpen}>
        <div>
          <CollapsibleTrigger
            className={cn(
              "flex w-full min-w-0 items-center gap-3 py-2 text-left transition-opacity hover:opacity-100",
              open ? "text-foreground opacity-100" : "text-muted-foreground opacity-55",
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold">{row.countLabel}</span>
              <span className="block truncate text-3xs text-muted-foreground">
                {row.authorsLabel}
              </span>
            </span>
            <ChevronDownIcon
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
          </CollapsibleTrigger>
          <CollapsiblePanel>
            {open ? (
              <div className="mt-1 space-y-1">
                {row.cards.map((card) => (
                  <ConversationCard
                    // Named with the pull request too: a remark's id is the host's own, and two
                    // pull requests can hand out the same one — which would leave one card's open
                    // editor standing over the other's remark.
                    key={card.key}
                    card={card}
                    editable={card.editable ? (editable.get(card.id) ?? null) : null}
                    cwd={cwd}
                    onOpen={onOpen}
                    surface={surface}
                  />
                ))}
              </div>
            ) : null}
          </CollapsiblePanel>
        </div>
      </Collapsible>
    </div>
  );
}

function CommitEvent({
  row,
  onOpen,
}: {
  row: Extract<PullRequestTimelineRowModel, { kind: "commit" }>;
  onOpen: (oid: string) => void;
}) {
  return (
    <button
      type="button"
      className="group relative mb-5 block w-full cursor-pointer rounded-sm pl-12 text-left outline-none [contain-intrinsic-block-size:48px] [content-visibility:auto] focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={row.ariaLabel}
      onClick={() => onOpen(row.oid)}
    >
      <ActorTimelineMarker
        actors={row.markerActors}
        fallback={<GitCommitHorizontalIcon className="size-3.5" />}
      />
      <div className="flex min-w-0 items-center gap-2.5 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-foreground transition-colors group-hover:text-primary">
            {row.title}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-3xs text-muted-foreground">
            <code className="font-mono">{row.shortOid}</code>
            <span>{row.time}</span>
          </div>
        </div>
        {row.additions !== null && row.deletions !== null ? (
          <PullRequestDiffStat
            additions={row.additions}
            deletions={row.deletions}
            className="ml-auto shrink-0 font-mono text-3xs"
          />
        ) : null}
      </div>
    </button>
  );
}

function LifecycleEvent({
  row,
}: {
  row: Extract<PullRequestTimelineRowModel, { kind: "lifecycle" }>;
}) {
  const Icon = PullRequestGlyph[row.icon];
  return (
    <div className="relative mb-5 pl-12 [contain-intrinsic-block-size:48px] [content-visibility:auto]">
      <IconMarker icon={<Icon className="size-3.5" />} />
      <div className="py-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {row.actorLogin !== null ? <ActorName login={row.actorLogin} /> : null}
          <span className="font-semibold text-foreground">{row.label}</span>
        </div>
        <div className="mt-0.5 text-2xs text-muted-foreground">{row.time}</div>
      </div>
    </div>
  );
}

/**
 * A verdict, as its own row rather than a line inside a collapsed conversation. It wears the
 * reviewer's face on the rail and the verdict's own icon beside their name, so "approved" reads
 * at a glance from the same place a merge or a commit does.
 */
function ReviewVerdictEvent({
  row,
  cwd,
  onOpen,
  surface,
}: {
  row: Extract<PullRequestTimelineRowModel, { kind: "verdict" }>;
  cwd: string;
  onOpen: (url: string) => void;
  surface: ReactionSurface;
}) {
  return (
    <div className="group relative mb-5 pl-12 [contain-intrinsic-block-size:48px] [content-visibility:auto]">
      {/* Pinned rather than centred: this row grows with a body, and a
          centred avatar drifts down beside it instead of sitting by the name. */}
      <ActorTimelineMarker
        actors={row.markerActors}
        className="top-6"
        fallback={<PullRequestReviewOutcomeIcon outcome={row.outcome} />}
      />
      <div className="flex min-w-0 flex-wrap items-start gap-2 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
            <ActorName login={row.actorLogin} />
            {/* The word alone, in the verdict's own colour — green for an approval, red for a
                request for changes. A verdict overtaken by later commits keeps its word and
                loses that colour: it still happened, and it no longer speaks for what is on the
                branch. Lowercased in the styling rather than the string, so what a screen reader
                announces stays the label every other surface uses. */}
            <Tooltip disabled={!row.stale}>
              <TooltipTrigger
                render={
                  <span
                    className={cn(
                      "font-medium lowercase",
                      row.stale ? "text-muted-foreground opacity-70" : row.toneClassName,
                    )}
                  />
                }
              >
                {row.label}
                {row.stale ? <span className="sr-only">{row.staleSrLabel}</span> : null}
              </TooltipTrigger>
              <TooltipPopup>{row.staleTooltip}</TooltipPopup>
            </Tooltip>
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <PullRequestMetaLine className="flex-wrap text-2xs text-muted-foreground">
              <span>{row.time}</span>
              {row.path ? (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <FileCode2Icon aria-hidden className="size-3 shrink-0" />
                  <span className="truncate">{row.path}</span>
                </span>
              ) : null}
            </PullRequestMetaLine>
          </div>
        </div>
        <TimelineReactions subjectId={row.id} model={row.reactions} surface={surface} />
        <OpenOnHostButton url={row.url} ariaLabel={row.openAriaLabel} onOpen={onOpen} />
      </div>
      {/* An approval usually carries no words. When it does they are the review, so they stay
          visible rather than being folded away with the ordinary conversation. */}
      {row.body ? (
        <TimelineBody
          body={row.body}
          cwd={cwd}
          environmentId={surface.environmentId}
          threadRef={surface.threadRef}
        />
      ) : null}
    </div>
  );
}

export function PullRequestTimelineTab({
  detail,
  environmentId,
  threadRef = null,
  reference,
  order,
  onOpenCommit,
  onRefresh,
}: {
  detail: PullRequestDetailView;
  environmentId: EnvironmentId;
  threadRef?: ScopedThreadRef | null;
  reference: PullRequestRef;
  order: "newest" | "oldest";
  onOpenCommit: (oid: string) => void;
  onRefresh: () => void;
}) {
  const model = buildPullRequestTimelineModel({ detail, order, nowMs: Date.now() });
  const surface: ReactionSurface = { environmentId, threadRef, reference, onRefresh };
  // A timeline entry keeps only what it draws, so the remarks this reader may rewrite are looked
  // up here by the id the entry carries.
  const editable = new Map(detail.comments.map((comment) => [comment.id, comment] as const));
  const openOnHost = (url: string) => {
    void readLocalApi()?.shell.openExternal(url);
  };

  return (
    <div className="h-full overflow-y-auto px-4 py-5">
      <div className="mx-auto max-w-3xl">
        <div className="relative">
          <span aria-hidden className="absolute bottom-5 left-[15px] top-1 w-px bg-border/45" />
          {model.rows.map((row) =>
            row.kind === "conversation" ? (
              <ConversationGroup
                key={row.key}
                row={row}
                editable={editable}
                cwd={detail.workspaceRoot}
                onOpen={openOnHost}
                surface={surface}
              />
            ) : row.kind === "commit" ? (
              <CommitEvent key={row.key} row={row} onOpen={onOpenCommit} />
            ) : row.kind === "verdict" ? (
              <ReviewVerdictEvent
                key={row.key}
                row={row}
                cwd={detail.workspaceRoot}
                onOpen={openOnHost}
                surface={surface}
              />
            ) : (
              <LifecycleEvent key={row.key} row={row} />
            ),
          )}
        </div>

        {model.emptyLabel !== null ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
            <PullRequestGlyph.pullRequest className="mb-2 size-5" />
            <p className="text-xs">{model.emptyLabel}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
