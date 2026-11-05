import type {
  EnvironmentId,
  PullRequestComment,
  PullRequestDetailView,
  PullRequestRef,
  ScopedThreadRef,
} from "@t3tools/contracts";
import {
  ArrowDownUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  HammerIcon,
  TagIcon,
  UsersIcon,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { useAtomCommand } from "~/state/use-atom-command";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { cn } from "~/lib/utils";
import { useOpenLink } from "~/browser/useOpenLink";

import { Button } from "../ui/button";
import { PullRequestEditButton } from "./PullRequestEditButton";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  PullRequestActorLabel,
  PullRequestCheckStatusIcon,
  PullRequestLabelChip,
  PullRequestReviewOutcomeBadge,
} from "./pullRequestPresentation";
import { PullRequestLabelPicker } from "./PullRequestLabelPicker";
import { PullRequestReviewerPicker } from "./PullRequestReviewerPicker";
import { PullRequestActivityUnavailableState } from "./PullRequestActivityUnavailableState";
import { type PullRequestFinding } from "./pullRequestDetail.logic";
import { PullRequestMarkdown } from "./PullRequestMarkdown";
import { PullRequestCommentBody } from "./PullRequestCommentBody";
import { PullRequestMarkdownEditor } from "./PullRequestMarkdownEditor";
import { PullRequestReactionBar } from "./PullRequestReactions";
import { PullRequestConversationGhost } from "./PullRequestGhosts";
import { sectionCollapseAnchorScrollTop } from "./pullRequestSummaryScroll.logic";
import {
  buildPullRequestSummaryModel,
  partitionPullRequestComments,
  PULL_REQUEST_COMMENT_PAGE,
  PULL_REQUEST_SUMMARY_TOASTS,
  resolvePullRequestCommentFinding,
  resolvePullRequestCommentSave,
  type PullRequestCollapsedCommentModel,
  type PullRequestCommentCardModel,
  type PullRequestCommentGroupModel,
  type PullRequestPagerModel,
} from "./PullRequestSummaryTab.logic";

function CommentIdentity({ card }: { card: PullRequestCommentCardModel }) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <PullRequestActorLabel
        actor={card.actor}
        profileUrl={card.authorProfileUrl}
        className="max-w-full"
      />
      <Tooltip>
        <TooltipTrigger
          render={
            card.timeUrl ? (
              <a
                href={card.timeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground hover:underline"
              />
            ) : (
              <span className="text-muted-foreground" />
            )
          }
        >
          <time dateTime={card.time.iso}>{card.time.relative}</time>
        </TooltipTrigger>
        <TooltipPopup>{card.timeTooltip}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

function CommentLocation({ card }: { card: PullRequestCommentCardModel }) {
  if (!card.location) return null;
  return (
    <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <Tooltip>
        <TooltipTrigger render={<span className="truncate font-mono" />}>
          {card.location.label}
        </TooltipTrigger>
        <TooltipPopup>{card.location.label}</TooltipPopup>
      </Tooltip>
      {card.location.outdated ? <span className="shrink-0">Outdated</span> : null}
    </div>
  );
}

/** What every remark in the conversation needs to be rewritten where it sits. */
interface CommentEditing {
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef | null;
  readonly editingId: string | null;
  readonly saving: boolean;
  readonly onEdit: (commentId: string | null) => void;
  readonly onSave: (commentId: string, body: string) => void;
}

/**
 * A remark's words, and the pencil that swaps them for the editor. The pencil is revealed by
 * hovering the remark, like the reaction bar's own, so the parent must carry `group`.
 */
function CommentBody({
  comment,
  card,
  editing,
  className,
}: {
  comment: PullRequestComment;
  card: PullRequestCommentCardModel;
  editing: CommentEditing;
  className?: string | undefined;
}) {
  if (editing.editingId === card.id) {
    return (
      <PullRequestMarkdownEditor
        className={className}
        value={comment.body}
        cwd={editing.cwd}
        environmentId={editing.environmentId}
        threadRef={editing.threadRef}
        label={card.editAriaLabel}
        saving={editing.saving}
        onSave={(body) => editing.onSave(card.id, body)}
        onCancel={() => editing.onEdit(null)}
      />
    );
  }
  return (
    <div className={cn("flex items-start gap-1", className)}>
      <PullRequestCommentBody
        key={card.id}
        className="min-w-0 flex-1"
        text={comment.body}
        cwd={editing.cwd}
        environmentId={editing.environmentId}
        threadRef={editing.threadRef}
      />
      {card.canEdit ? (
        <PullRequestEditButton
          aria-label={card.editAriaLabel}
          onClick={() => editing.onEdit(card.id)}
        />
      ) : null}
    </div>
  );
}

/** Finished work — a resolved conversation or a dismissed review — opens collapsed. */
function CollapsedComment({
  comment,
  item,
  editing,
  reactionBar,
}: {
  comment: PullRequestComment;
  item: PullRequestCollapsedCommentModel;
  editing: CommentEditing;
  reactionBar: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const statusTriggerRef = useRef<HTMLButtonElement>(null);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <article className="group rounded-lg border border-border/60 [contain-intrinsic-block-size:44px] [content-visibility:auto]">
        <div className="p-3">
          <div className="flex flex-wrap items-start gap-2">
            <CommentIdentity card={item} />
            <CollapsibleTrigger
              ref={statusTriggerRef}
              className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {item.statusLabel}
              <ChevronDownIcon
                aria-hidden
                className={cn("size-3.5 transition-transform", open && "rotate-180")}
              />
            </CollapsibleTrigger>
            {reactionBar}
          </div>
          <CommentLocation card={item} />
          {!open && item.preview !== null ? (
            <CollapsibleTrigger
              className="mt-2 block w-full truncate text-left text-xs text-muted-foreground hover:text-foreground"
              onClick={() => statusTriggerRef.current?.focus({ preventScroll: true })}
            >
              {item.preview}
            </CollapsibleTrigger>
          ) : null}
        </div>
        <CollapsiblePanel>
          {open ? (
            <div className="px-3 pb-3">
              {/* A dismissal carries no more words than an approval does, and an empty markdown
                  block reads as a card somebody forgot to fill in. */}
              {item.bodyVisible ? (
                <CommentBody className="mt-2" comment={comment} card={item} editing={editing} />
              ) : null}
            </div>
          ) : null}
        </CollapsiblePanel>
      </article>
    </Collapsible>
  );
}

function MetaRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-7 min-w-0 grid-cols-[6rem_minmax(0,1fr)] items-center gap-2 text-xs sm:min-h-6">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="min-w-0 text-foreground">{children}</span>
    </div>
  );
}

function Section({
  title,
  defaultOpen = true,
  keepMounted = false,
  actions,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  keepMounted?: boolean;
  /** Heading controls stay separate from the collapse trigger so they remain independently usable. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const headingRef = useRef<HTMLDivElement>(null);
  const setOpenWithScrollAnchor = (nextOpen: boolean) => {
    if (!nextOpen) {
      const heading = headingRef.current;
      const section = heading?.closest<HTMLElement>("[data-pull-request-summary-section]");
      const scroller = heading?.closest<HTMLElement>("[data-pull-request-summary-scroll]");
      if (heading && section && scroller) {
        const target = sectionCollapseAnchorScrollTop({
          scrollTop: scroller.scrollTop,
          viewportTop: scroller.getBoundingClientRect().top,
          sectionTop: section.getBoundingClientRect().top,
          headingTop: heading.getBoundingClientRect().top,
        });
        // Synchronous with the press: React commits the collapsed height before the browser
        // paints, so the reader sees the heading they pressed stay put rather than a jump first.
        if (target !== null) scroller.scrollTop = target;
      }
    }
    setOpen(nextOpen);
  };
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpenWithScrollAnchor}
      render={<section aria-label={title} />}
      data-pull-request-summary-section
    >
      {/* The heading rides the top of the scroll box the way a diff's file header does, so a
          section can be collapsed from wherever its body has been read to rather than only from
          where it started. Opaque, because the rows it covers scroll beneath it. */}
      <div
        ref={headingRef}
        className="sticky top-0 z-10 flex w-full items-center bg-background pr-4"
      >
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 px-4 py-3 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
          <span>{title}</span>
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3.5 text-muted-foreground/60 transition-transform",
              open && "rotate-90",
            )}
          />
        </CollapsibleTrigger>
        {actions}
      </div>
      <CollapsiblePanel keepMounted={keepMounted}>
        <div className="px-4 pb-4">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function CommentGroup({
  group,
  children,
  onOpenChange,
}: {
  group: PullRequestCommentGroupModel;
  children: ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <Collapsible onOpenChange={onOpenChange}>
        <div className="flex items-center gap-3 pl-3">
          <div className="flex shrink-0 -space-x-1.5">
            {group.avatars.map((avatar) => (
              // The ring separates the overlapping faces; it belongs to the stack, not the actor.
              <span
                key={avatar.key}
                className="relative flex rounded-full ring-2 ring-background hover:z-10 focus-within:z-10"
              >
                <PullRequestActorLabel
                  actor={avatar.actor}
                  profileUrl={avatar.profileUrl}
                  variant="avatar"
                />
              </span>
            ))}
            {group.overflowLabel !== null ? (
              <span className="relative flex size-6 items-center justify-center rounded-full bg-muted text-3xs text-muted-foreground ring-2 ring-background">
                {group.overflowLabel}
              </span>
            ) : null}
          </div>
          <CollapsibleTrigger
            aria-label={group.label}
            className="group flex min-w-0 flex-1 items-center gap-3 rounded-md py-3 pr-3 text-left hover:bg-muted/30"
          >
            <span className="min-w-0 flex-1 space-y-1">
              <span className="block text-xs font-medium text-foreground/90">{group.label}</span>
              <span className="flex flex-wrap gap-x-1.5 text-2xs text-muted-foreground">
                <span>{group.authorsLabel}</span>
                {group.filesLabel !== null ? <span>{group.filesLabel}</span> : null}
                {group.latest ? (
                  <span>
                    · Latest{" "}
                    <Tooltip>
                      <TooltipTrigger render={<time dateTime={group.latest.iso} />}>
                        {group.latest.relative}
                      </TooltipTrigger>
                      <TooltipPopup>{group.latest.absolute}</TooltipPopup>
                    </Tooltip>
                  </span>
                ) : null}
              </span>
            </span>
            <ChevronRightIcon
              aria-hidden
              className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90"
            />
          </CollapsibleTrigger>
        </div>
        <CollapsiblePanel keepMounted>
          <div className="border-t border-border/60 px-3 pb-3">{children}</div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}

function PagerButton({
  pager,
  variant,
  onClick,
}: {
  pager: PullRequestPagerModel | null;
  variant: "outline" | "ghost";
  onClick: () => void;
}) {
  return pager === null ? null : (
    <Button size="sm" variant={variant} className="w-full" onClick={onClick}>
      {pager.parts}
    </Button>
  );
}

export function PullRequestSummaryTab({
  environmentId,
  threadRef,
  reference,
  detail,
  activityPending,
  checksStale = false,
  activityError,
  pendingFinding,
  fixFindingLabel = "Fix in a thread",
  fixCheckLabel = "Fix",
  onFixFinding,
  onRefresh,
  onRefreshChecks = onRefresh,
}: {
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef | null;
  reference: PullRequestRef;
  detail: PullRequestDetailView;
  activityPending: boolean;
  checksStale?: boolean;
  activityError: string | null;
  /** The hand-off currently preparing, if any, so only the finding it belongs to says so. */
  pendingFinding?: string | null;
  fixFindingLabel?: string;
  fixCheckLabel?: string;
  onFixFinding?: (finding: PullRequestFinding) => void;
  onRefresh: () => void;
  onRefreshChecks?: () => void;
}) {
  // Keyed by the pull request, so opening another one starts at the end of its conversation
  // rather than wherever the last one had been read back to.
  const [shown, setShown] = useState({ url: detail.url, count: PULL_REQUEST_COMMENT_PAGE });
  const [openedBotGroup, setOpenedBotGroup] = useState<string | null>(null);
  const [shownBots, setShownBots] = useState({
    url: detail.url,
    count: PULL_REQUEST_COMMENT_PAGE,
  });
  const shownBotComments =
    shownBots.url === detail.url ? shownBots.count : PULL_REQUEST_COMMENT_PAGE;
  const shownComments = shown.url === detail.url ? shown.count : PULL_REQUEST_COMMENT_PAGE;
  const [commentOrder, setCommentOrder] = useState<"newest" | "oldest">("newest");

  const openLink = useOpenLink(threadRef);
  const openCheck = (url: string) => {
    void openLink(url).catch((error: unknown) => {
      console.error(error);
      toastManager.add({ type: "error", title: PULL_REQUEST_SUMMARY_TOASTS.checkOpenFailed });
    });
  };

  const update = useAtomCommand(pullRequestEnvironment.update, { reportFailure: false });
  const updateComment = useAtomCommand(pullRequestEnvironment.updateComment, {
    reportFailure: false,
  });
  // Keyed by the pull request, like the comment window above it, so an editor left open never
  // reappears over the next pull request's description.
  const [bodyScope, setBodyScope] = useState<string | null>(null);
  const [bodySaving, setBodySaving] = useState(false);
  // The remark being rewritten, named with the pull request it belongs to: a comment id is the
  // host's own, and two hosts — or two pull requests on Azure DevOps, which numbers a remark
  // inside its thread — hand out the same one. Without the pull request beside it, opening a
  // different one would leave its like-numbered remark sitting open in an editor.
  const [commentScope, setCommentScope] = useState<{
    readonly pullRequest: string;
    readonly commentId: string;
  } | null>(null);
  const [commentSaving, setCommentSaving] = useState(false);
  const editingCommentId = commentScope?.pullRequest === detail.url ? commentScope.commentId : null;

  const model = buildPullRequestSummaryModel({
    detail,
    activityPending,
    activityError,
    checksStale,
    pendingFinding: pendingFinding ?? null,
    fixFindingLabel,
    fixCheckLabel,
    canFix: onFixFinding !== undefined,
    shownComments,
    shownBotComments,
    botGroupOpened: openedBotGroup === detail.url,
    commentOrder,
    editingDescription: bodyScope === detail.url,
    format: { nowMs: Date.now() },
  });
  const partition = partitionPullRequestComments(detail);
  const commentById = new Map(detail.comments.map((comment) => [comment.id, comment] as const));

  const saveBody = async (body: string) => {
    if (bodySaving) return;
    setBodySaving(true);
    const result = await update({ environmentId, input: { ...reference, body } });
    setBodySaving(false);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: PULL_REQUEST_SUMMARY_TOASTS.descriptionSaveFailed });
      return;
    }
    setBodyScope(null);
    onRefresh();
  };

  const commentEditing: CommentEditing = {
    cwd: detail.workspaceRoot,
    environmentId,
    threadRef,
    editingId: editingCommentId,
    saving: commentSaving,
    onEdit: (commentId) =>
      setCommentScope(commentId === null ? null : { pullRequest: detail.url, commentId }),
    onSave: async (commentId, body) => {
      const comment = commentById.get(commentId);
      if (comment === undefined) return;
      // A review's own summary is not a kind any host rewrites, which is why no pencil is ever
      // offered on one; the check is here because the comment's own type still allows it.
      const decision = resolvePullRequestCommentSave({ comment, body, saving: commentSaving });
      if (decision.kind === "ignore") return;
      setCommentSaving(true);
      const result = await updateComment({
        environmentId,
        input: {
          ...reference,
          commentId: decision.commentId,
          kind: decision.commentKind,
          body: decision.body,
        },
      });
      setCommentSaving(false);
      if (result._tag === "Failure") {
        toastManager.add({ type: "error", title: PULL_REQUEST_SUMMARY_TOASTS.commentSaveFailed });
        return;
      }
      setCommentScope(null);
      onRefresh();
    },
  };

  const reactionBarFor = (card: PullRequestCommentCardModel) => (
    <PullRequestReactionBar
      reactions={card.reactions}
      canReact={card.canReact}
      subjectId={card.id}
      environmentId={environmentId}
      reference={reference}
      onRefresh={onRefresh}
      className="ml-auto justify-end"
    />
  );

  const renderComment = (card: PullRequestCommentCardModel) => {
    const comment = commentById.get(card.id);
    if (comment === undefined) return null;
    const finding = resolvePullRequestCommentFinding(
      comment,
      partition.threadByCommentId.get(comment.id),
    );
    return (
      <article
        key={card.key}
        // Offscreen comments skip style, layout and paint. Bot comments carry pages of
        // highlighted code, and the conversation is below the description either way.
        className="group rounded-lg border border-border/60 bg-background [contain-intrinsic-block-size:160px] [content-visibility:auto]"
      >
        <div className="flex flex-wrap items-start gap-2 rounded-t-lg bg-muted/25 px-3 py-2.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <CommentIdentity card={card} />
            {card.outcome ? (
              <PullRequestReviewOutcomeBadge outcome={card.outcome.outcome} />
            ) : card.reviewStateLabel ? (
              <span>{card.reviewStateLabel}</span>
            ) : null}
          </div>
          {/* Review remarks only. A plain conversation comment is talk, not a finding,
                      and offering to fix one would promise more than it says. */}
          {onFixFinding && finding && card.fix ? (
            <Button
              size="xs"
              variant="ghost"
              className="-mt-1 shrink-0"
              disabled={card.fix.disabled}
              onClick={() => onFixFinding(finding)}
            >
              <HammerIcon className="size-3" />
              {card.fix.label}
            </Button>
          ) : null}
          {reactionBarFor(card)}
        </div>
        <div className="px-3">
          <CommentLocation card={card} />
        </div>
        {/* A verdict usually carries no words, and an empty markdown block reads as
                          a card somebody forgot to fill in — the badge above already said it.
                          Kept where this reader may rewrite the remark: the pencil lives in here,
                          and hiding the block would take away the only way back to it. */}
        {card.bodyVisible ? (
          <CommentBody
            className="px-3 py-3"
            comment={comment}
            card={card}
            editing={commentEditing}
          />
        ) : null}
      </article>
    );
  };

  const comments = model.comments;
  const showOlderComments = (
    <PagerButton
      pager={comments.showOlder}
      variant="outline"
      onClick={() =>
        setShown({ url: detail.url, count: shownComments + PULL_REQUEST_COMMENT_PAGE })
      }
    />
  );

  return (
    <div className="h-full overflow-y-auto" data-pull-request-summary-scroll>
      <section className="px-4 pt-2.5 pb-1">
        <div className="space-y-2">
          <MetaRow icon={<UsersIcon className="size-3.5" />} label={model.reviewers.label}>
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
              {model.reviewers.emptyLabel !== null ? (
                <span className="text-muted-foreground">{model.reviewers.emptyLabel}</span>
              ) : (
                <span className="flex items-center -space-x-1">
                  {model.reviewers.entries.map((entry) => (
                    <Tooltip key={entry.key}>
                      {/* A verdict rides the face that earned it rather than a row of its own:
                          the ring sits outside the one that separates overlapping avatars, so
                          it reads at a glance without adding anything to scroll past. */}
                      <TooltipTrigger
                        render={
                          <span
                            className={cn(
                              "relative rounded-full hover:z-10",
                              // The verdict replaces the separator rather than ringing it. Both
                              // occupy the same 2px immediately outside a 16px avatar, so the
                              // colour costs no size: anything drawn further out would be a
                              // halo wide enough to eclipse the neighbour this stack overlaps
                              // by 4px. Painted by this wrapper because a child's box-shadow
                              // covers its parent's, never the other way round.
                              entry.ringClassName ?? undefined,
                            )}
                          />
                        }
                      >
                        <PullRequestActorLabel
                          actor={entry.actor}
                          tooltip={false}
                          variant="avatar"
                        />
                        {/* Colour alone says nothing to a reader who cannot see it, and the
                            login beside this is already in the accessible name. */}
                        {entry.outcomeLabel !== null ? (
                          <span className="sr-only">{entry.outcomeLabel}</span>
                        ) : null}
                      </TooltipTrigger>
                      <TooltipPopup side="bottom">{entry.tooltip}</TooltipPopup>
                    </Tooltip>
                  ))}
                </span>
              )}
              {/* Shown wherever the host can take a review request at all, and disabled with the
                  reason where this account may not make one: a control that vanishes teaches
                  nobody why, and "you need write access" is the answer to the question a reader
                  actually has. Azure DevOps is the exception — it takes a reviewer but will not
                  say who could be one, so there is nothing to open. */}
              {model.reviewers.picker.visible ? (
                <PullRequestReviewerPicker
                  environmentId={environmentId}
                  reference={reference}
                  allowed={model.reviewers.picker.allowed}
                />
              ) : null}
            </span>
          </MetaRow>
          {/* The row is shown empty only where a label could be put on it from here; on a host
              with none to offer, an empty row is a row about nothing. */}
          {model.labels.visible ? (
            <MetaRow icon={<TagIcon className="size-3.5" />} label={model.labels.label}>
              <span className="flex min-w-0 flex-wrap items-center gap-1">
                {model.labels.emptyLabel !== null ? (
                  <span className="text-muted-foreground">{model.labels.emptyLabel}</span>
                ) : (
                  detail.labels.map((label) => (
                    <PullRequestLabelChip
                      key={label.name}
                      label={label}
                      size="default"
                      className="max-w-48"
                    />
                  ))
                )}
                {model.labels.picker.visible ? (
                  <PullRequestLabelPicker
                    environmentId={environmentId}
                    reference={reference}
                    allowed={model.labels.picker.allowed}
                  />
                ) : null}
              </span>
            </MetaRow>
          ) : null}
        </div>
      </section>

      <Section key={`description:${detail.url}`} title={model.description.title} keepMounted>
        <div className="group">
          {model.description.editing ? (
            <PullRequestMarkdownEditor
              // Empty is a real answer here: saving nothing is how a description is cleared.
              allowEmpty
              value={detail.body}
              cwd={detail.workspaceRoot}
              environmentId={environmentId}
              threadRef={threadRef}
              label={model.description.editorLabel}
              placeholder={model.description.editorPlaceholder}
              saving={bodySaving}
              onSave={(body) => void saveBody(body)}
              onCancel={() => setBodyScope(null)}
            />
          ) : (
            <div className="flex items-start gap-1">
              <PullRequestMarkdown
                className="min-w-0 flex-1"
                text={model.description.text}
                cwd={detail.workspaceRoot}
                environmentId={environmentId}
                threadRef={threadRef}
              />
              {model.description.canEdit ? (
                <PullRequestEditButton
                  aria-label={model.description.editAriaLabel}
                  onClick={() => setBodyScope(detail.url)}
                />
              ) : null}
            </div>
          )}
        </div>
      </Section>

      <Section key={`checks:${detail.url}`} title={model.checks.title} defaultOpen={false}>
        {model.checks.body.kind === "stale" ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{model.checks.body.message}</span>
            <Button size="xs" variant="ghost" onClick={onRefreshChecks}>
              {model.checks.body.refreshLabel}
            </Button>
          </div>
        ) : model.checks.body.kind === "empty" ? (
          <p className="text-xs text-muted-foreground">{model.checks.body.message}</p>
        ) : (
          model.checks.body.rows.map((row, index) => {
            const check = detail.checks[index];
            return (
              <div
                // Position too: the host decides how many runs share a name, and a repeated
                // key would be a rendering fault on top of whatever the list already says.
                key={row.key}
                className="group flex items-center gap-2 rounded-md pr-1 hover:bg-accent/60"
              >
                <button
                  type="button"
                  disabled={!row.url}
                  onClick={() => row.url && openCheck(row.url)}
                  className={cn(
                    "flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-2 text-left text-xs leading-5 [&>svg]:mt-0.5",
                    row.url ? "cursor-pointer" : "cursor-default",
                  )}
                >
                  <PullRequestCheckStatusIcon status={row.statusKey} />
                  <span className="min-w-0 flex-1 wrap-anywhere">{row.name}</span>
                  <span className="shrink-0 text-muted-foreground">{row.statusLabel}</span>
                </button>
                {/* Only where there is something to fix. A passing check has no failure to
                      reproduce, and the button would be an invitation to waste a thread. */}
                {onFixFinding && row.fix && check ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="shrink-0"
                    disabled={row.fix.disabled}
                    onClick={() => onFixFinding({ kind: "check", check })}
                  >
                    <HammerIcon className="size-3" />
                    {row.fix.label}
                  </Button>
                ) : null}
              </div>
            );
          })
        )}
      </Section>

      <Section
        title={comments.title}
        actions={
          <Button
            size="xs"
            variant="ghost-muted"
            className="shrink-0"
            aria-label={comments.order.ariaLabel}
            onClick={() => setCommentOrder((value) => (value === "newest" ? "oldest" : "newest"))}
          >
            <ArrowDownUpIcon aria-hidden className="size-3" />
            {comments.order.label}
          </Button>
        }
      >
        {comments.state === "loading" ? (
          <PullRequestConversationGhost />
        ) : comments.state === "error" && activityError ? (
          <PullRequestActivityUnavailableState compact error={activityError} onRetry={onRefresh} />
        ) : (
          <>
            {comments.truncatedNotice !== null ? (
              <p className="mb-2 rounded-md border border-warning/30 bg-warning-surface px-2 py-1.5 text-xs">
                {comments.truncatedNotice}
              </p>
            ) : null}
            {comments.emptyLabel !== null ? (
              <p className="py-2 text-xs text-muted-foreground">{comments.emptyLabel}</p>
            ) : (
              <div className="space-y-3">
                {commentOrder === "oldest" ? showOlderComments : null}
                {comments.visible.map(renderComment)}
                {commentOrder === "newest" ? showOlderComments : null}
                <PagerButton
                  pager={comments.showRecent}
                  variant="ghost"
                  onClick={() => setShown({ url: detail.url, count: PULL_REQUEST_COMMENT_PAGE })}
                />
                {comments.bots ? (
                  <CommentGroup
                    key={`bots:${detail.url}`}
                    group={comments.bots.group}
                    onOpenChange={(open) => {
                      if (open) setOpenedBotGroup(detail.url);
                    }}
                  >
                    <div className="space-y-3 pt-2">
                      {comments.bots.visible.map(renderComment)}
                      <PagerButton
                        pager={comments.bots.showOlder}
                        variant="outline"
                        onClick={() =>
                          setShownBots({
                            url: detail.url,
                            count: shownBotComments + PULL_REQUEST_COMMENT_PAGE,
                          })
                        }
                      />
                      <PagerButton
                        pager={comments.bots.showRecent}
                        variant="ghost"
                        onClick={() =>
                          setShownBots({ url: detail.url, count: PULL_REQUEST_COMMENT_PAGE })
                        }
                      />
                    </div>
                  </CommentGroup>
                ) : null}
                {comments.finished ? (
                  <CommentGroup key={detail.url} group={comments.finished.group}>
                    <div className="space-y-2 pt-2">
                      {comments.finished.items.map((item) => {
                        const comment = commentById.get(item.id);
                        return comment === undefined ? null : (
                          <CollapsedComment
                            key={item.key}
                            comment={comment}
                            item={item}
                            editing={commentEditing}
                            reactionBar={reactionBarFor(item)}
                          />
                        );
                      })}
                    </div>
                  </CommentGroup>
                ) : null}
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
