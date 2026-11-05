import type {
  EnvironmentId,
  PullRequestCheck,
  PullRequestChecksState,
  PullRequestRef,
  ScopedThreadRef,
} from "@t3tools/contracts";

import { useOpenLink } from "~/browser/useOpenLink";
import { cn } from "~/lib/utils";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";

import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import {
  PullRequestCheckStatusIcon,
  pullRequestChecksStatePresentation,
} from "./pullRequestPresentation";
import {
  buildPullRequestChecksPopoverModel,
  buildPullRequestLazyChecksBodyModel,
  PULL_REQUEST_CHECK_OPEN_FAILURE_TITLE,
  type PullRequestChecksBodyModel,
} from "./PullRequestChecksPopover.logic";

/**
 * The checks behind the rollup, for a row that only carries the rollup. Mounted by the popup, so
 * the read starts when somebody opens it rather than once per row of a listing — the detail read
 * is a request per pull request, and a page of them at rest would be a hundred.
 */
function LazyChecksBody({
  environmentId,
  reference,
  threadRef,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  threadRef: ScopedThreadRef | null;
}) {
  const detailQuery = useEnvironmentQuery(
    pullRequestEnvironment.detail({ environmentId, input: reference }),
  );
  return (
    <ChecksBody
      body={buildPullRequestLazyChecksBodyModel({
        checks: detailQuery.data?.checks ?? null,
        isPending: detailQuery.isPending,
        error: detailQuery.error,
      })}
      threadRef={threadRef}
    />
  );
}

function ChecksBody({
  body,
  threadRef,
}: {
  body: PullRequestChecksBodyModel;
  threadRef: ScopedThreadRef | null;
}) {
  const openLink = useOpenLink(threadRef);
  if (body.kind === "none") return null;
  if (body.kind === "message") {
    return <p className="text-muted-foreground text-xs">{body.message}</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {/* Keyed by position as well as by name: the host is the one that decides how many runs
          share a name, and a repeated key is a rendering fault rather than a wrong list. */}
      {body.rows.map((row) => (
        <li key={row.key} className="flex items-center gap-2 text-xs">
          <PullRequestCheckStatusIcon status={row.statusKey} />
          <Tooltip>
            <TooltipTrigger render={<span className="min-w-0 flex-1 truncate">{row.name}</span>} />
            <TooltipPopup side="top">{row.tooltip}</TooltipPopup>
          </Tooltip>
          <span className="shrink-0 text-muted-foreground">{row.statusLabel}</span>
          {row.detailsUrl === null ? null : (
            <button
              type="button"
              className="shrink-0 text-primary hover:underline"
              onClick={() => {
                if (!row.detailsUrl) return;
                void openLink(row.detailsUrl).catch((error: unknown) => {
                  console.error(error);
                  toastManager.add({ type: "error", title: PULL_REQUEST_CHECK_OPEN_FAILURE_TITLE });
                });
              }}
            >
              {row.detailsLabel}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The checks indicator and what it opens, in both places a change request is shown: a listing
 * row, which knows only the rollup, and the detail header, which is already holding every check.
 *
 * `checks` decides between the two. Given them, nothing is read; without them, the popup reads
 * the detail itself, which is why the row must also say which environment it came from.
 */
export function PullRequestChecksPopover({
  checksState,
  checks,
  stale = false,
  environmentId,
  reference,
  threadRef = null,
  className,
}: {
  checksState: PullRequestChecksState;
  /** The checks already in hand, for the detail header. Absent on a listing row. */
  checks?: ReadonlyArray<PullRequestCheck>;
  stale?: boolean;
  environmentId?: EnvironmentId;
  reference?: PullRequestRef;
  /** Thread the popover sits beside; a listing row has none. */
  threadRef?: ScopedThreadRef | null;
  className?: string;
}) {
  const Icon = pullRequestChecksStatePresentation(checksState).Icon;
  const model = buildPullRequestChecksPopoverModel({
    checksState,
    checks: checks ?? null,
    stale,
    canReadLazily: environmentId !== undefined && reference !== undefined,
  });
  return (
    <Popover>
      {/* A listing row is itself a button, so the trigger renders as a span: a nested button is
          not valid inside one. The click is stopped here so opening the checks does not also
          select the row it sits on. */}
      <PopoverTrigger
        nativeButton={false}
        render={
          <span
            role="button"
            tabIndex={0}
            aria-label={model.trigger.ariaLabel}
            className={cn("inline-flex shrink-0 cursor-pointer items-center", className)}
          />
        }
        onClick={(event) => event.stopPropagation()}
      >
        <Icon aria-hidden className={cn("size-3.5", model.trigger.toneClassName)} />
      </PopoverTrigger>
      <PopoverPopup align="start" width="md" side="bottom">
        <p className="mb-2 font-medium text-sm">{model.title}</p>
        {model.summary === null ? null : (
          <p className="mb-2 text-muted-foreground text-xs">{model.summary}</p>
        )}
        {model.body.kind === "stale" ? (
          <p className="text-muted-foreground text-xs">{model.body.message}</p>
        ) : model.body.kind === "lazy" && environmentId !== undefined && reference !== undefined ? (
          <LazyChecksBody
            environmentId={environmentId}
            reference={reference}
            threadRef={threadRef}
          />
        ) : model.body.kind === "lazy" ? null : (
          <ChecksBody body={model.body} threadRef={threadRef} />
        )}
      </PopoverPopup>
    </Popover>
  );
}
