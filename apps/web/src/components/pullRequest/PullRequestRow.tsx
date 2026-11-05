import { SearchIcon } from "lucide-react";
import { PullRequestStackPopover } from "./PullRequestStackPopover";
import { memo, type RefCallback } from "react";

import { cn } from "~/lib/utils";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { PullRequestChecksPopover } from "./PullRequestChecksPopover";
import type { EnvironmentPullRequestEntry } from "./pullRequestList.logic";
import { showPullRequestLinkContextMenu } from "./pullRequestLinkContextMenu";
import {
  PULL_REQUEST_ROW_CLASS,
  PULL_REQUEST_ROW_NUMBER_CLASS,
  PullRequestRowAuthor,
  PullRequestRowGlyph,
  PullRequestRowLines,
} from "./PullRequestListRow";
import {
  PullRequestDiffStat,
  PullRequestLabelChip,
  PullRequestReviewDecisionGlyph,
} from "./pullRequestPresentation";
import { pullRequestFilterIconComponent } from "./PullRequestListFilters";
import {
  buildPullRequestRowModel,
  type PullRequestRowLabelModel,
  type PullRequestRowTarget,
} from "./PullRequestsPage.logic";

/**
 * Each slot past the first only appears once the meta line is wide enough to hold it, so a
 * narrow row shows one label and a "+N" while a wide one spreads out up to three. The "+N"
 * rides on whichever pill is the last visible one, and is hidden as soon as the next slot shows.
 */
// Each slot's pill appears at a wider row, and its overflow count yields to the next slot.
const LABEL_SLOTS = [
  { overflow: "@xl/pr-row-meta:hidden" },
  { overflow: "@3xl/pr-row-meta:hidden" },
  { overflow: "" },
] as const;

function PullRequestRowLabels({ labels }: { labels: ReadonlyArray<PullRequestRowLabelModel> }) {
  if (labels.length === 0) return null;
  return (
    <span className="flex min-w-0 items-center gap-1">
      {labels.map((label, index) => {
        const slot = LABEL_SLOTS[index];
        if (!slot) return null;
        return (
          <PullRequestLabelChip
            key={label.name}
            label={label}
            className={
              index === 0
                ? ""
                : index === 1
                  ? "hidden @xl/pr-row-meta:inline-flex"
                  : "hidden @3xl/pr-row-meta:inline-flex"
            }
          >
            {label.overflowLabel === null ? null : (
              <span className={cn("shrink-0", slot.overflow)}>{label.overflowLabel}</span>
            )}
          </PullRequestLabelChip>
        );
      })}
    </span>
  );
}

/**
 * The page row keeps a little more room around the shared lines than the panel, which sits in
 * a narrow column. The intrinsic size is the content box a skipped row reserves, which is the
 * two lines without the padding: a 56px row less 20px of `py-2.5`.
 */
const PAGE_ROW_CLASS = "px-3 py-2.5 [contain-intrinsic-block-size:36.5px]";

function PullRequestRowImpl({
  entry,
  selected,
  showProjectTitle,
  showProvider,
  environmentLabel,
  matchedElsewhere,
  statsKey,
  statsRef,
  onSelect,
}: {
  entry: EnvironmentPullRequestEntry;
  selected: boolean;
  showProjectTitle: boolean;
  /** Only when the list spans more than one host, where the repository alone is ambiguous. */
  showProvider: boolean;
  /** Names the server this row was read from, where the list spans more than one. */
  environmentLabel?: string;
  /**
   * A search found this, but in something the row does not show — a description, a comment, a
   * commit message. Saying so is the difference between a result and an apparently random row.
   */
  matchedElsewhere?: boolean;
  /** Used by the list's shared visibility observer to defer optional line-count reads. */
  statsKey?: string;
  statsRef?: RefCallback<HTMLButtonElement>;
  onSelect: (entry: PullRequestRowTarget) => void;
}) {
  const row = buildPullRequestRowModel({
    entry,
    selected,
    showProjectTitle,
    showProvider,
    environmentLabel,
    matchedElsewhere,
    nowMs: Date.now(),
  });
  const ProviderIcon =
    row.provider === null
      ? null
      : pullRequestFilterIconComponent({ kind: "provider", id: row.provider.icon });
  return (
    <button
      ref={statsRef}
      data-pull-request-stats-key={statsKey}
      type="button"
      aria-current={row.selected ? "true" : undefined}
      onClick={() => onSelect(entry)}
      className={cn(
        PULL_REQUEST_ROW_CLASS,
        PAGE_ROW_CLASS,
        "cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        // Offscreen rows are skipped for style, layout and paint: a long list costs what the
        // viewport shows, not what the pages have loaded. The intrinsic size keeps the
        // scrollbar honest while a row is skipped.
        "[content-visibility:auto]",
        row.selected ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <PullRequestRowGlyph
        state={entry.state}
        isDraft={entry.isDraft}
        mergeability={entry.mergeability}
        baseBranch={entry.baseBranch}
        // On the title line rather than between the lines, as main aligns it.
        className="mt-0.75 self-start"
      />
      <PullRequestRowLines
        number={
          // The number carries the link, here as much as on the detail: a right-click on it
          // copies the pull request's own address rather than opening the editing menu.
          <span
            className={PULL_REQUEST_ROW_NUMBER_CLASS}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void showPullRequestLinkContextMenu({
                url: row.url,
                openLabel: row.openOnHostLabel,
                position: { x: event.clientX, y: event.clientY },
              });
            }}
          >
            {row.numberLabel}
          </span>
        }
        title={row.title}
        signals={
          <>
            {row.checks === null ? null : (
              <PullRequestChecksPopover
                checksState={row.checks.state}
                environmentId={entry.environmentId}
                reference={{
                  projectId: entry.projectId,
                  repository: entry.repository,
                  number: entry.number,
                }}
              />
            )}
            {/* Only a verdict the host actually reports: an approval, a request for changes,
                or a review the branch rules still require. No glyph on the common case of a
                pull request nobody has reviewed, so a row only wears a person when the person
                has said something. */}
            {entry.reviewDecision === undefined ? null : (
              <PullRequestReviewDecisionGlyph decision={entry.reviewDecision} />
            )}
          </>
        }
        status={
          <>
            {row.stack ? (
              <PullRequestStackPopover
                environmentId={entry.environmentId}
                reference={{
                  projectId: entry.projectId,
                  host: entry.host,
                  repository: entry.repository,
                  number: entry.number,
                }}
                membership={row.stack}
                onSelect={(target) =>
                  onSelect({ ...target, host: entry.host, environmentId: entry.environmentId })
                }
              />
            ) : null}
            <PullRequestDiffStat
              additions={entry.additions}
              deletions={entry.deletions}
              className="font-mono"
            />
          </>
        }
        metaClassName="@container/pr-row-meta"
        meta={
          <>
            {row.matchedElsewhere ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="flex min-w-6 items-center gap-1 overflow-hidden rounded-full border border-border/60 px-1 text-3xs" />
                  }
                >
                  <span className="sr-only">{row.matchedElsewhere.label}</span>
                  <SearchIcon aria-hidden className="size-3 shrink-0" />
                  <span aria-hidden className="hidden truncate @xs/pr-row-meta:block">
                    {row.matchedElsewhere.label}
                  </span>
                </TooltipTrigger>
                <TooltipPopup side="top">{row.matchedElsewhere.tooltip}</TooltipPopup>
              </Tooltip>
            ) : null}
            {row.provider && ProviderIcon ? (
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
                  <ProviderIcon aria-label={row.provider.name} className="size-3" />
                </TooltipTrigger>
                <TooltipPopup>{row.provider.name}</TooltipPopup>
              </Tooltip>
            ) : null}
            <PullRequestRowAuthor
              actor={entry.author}
              className="min-w-3.5 max-w-40"
              labelClassName="sr-only @xs/pr-row-meta:not-sr-only @xs/pr-row-meta:truncate"
            />
            {row.repositoryLabel === null ? null : (
              <span className="truncate">{row.repositoryLabel}</span>
            )}
            {row.environmentLabel === null ? null : (
              <span className="min-w-0 max-w-32 truncate">{row.environmentLabel}</span>
            )}
            <PullRequestRowLabels labels={row.labels} />
          </>
        }
        updatedLabel={row.updatedLabel}
      />
    </button>
  );
}

/**
 * Memoized: the list re-renders on every keystroke of a search and every status poll, and a
 * row whose entry, selection and match state are unchanged has nothing new to say. Effective
 * because the route hands it a stable `onSelect`.
 */
export const PullRequestRow = memo(PullRequestRowImpl);
