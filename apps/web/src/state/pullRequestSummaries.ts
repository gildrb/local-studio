import type {
  EnvironmentId,
  PullRequestListEntry,
  PullRequestRef,
  PullRequestSummary,
} from "@t3tools/contracts";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

export interface ObservedPullRequestSummary {
  readonly summary: PullRequestSummary;
  /** Client arrival time, the only ordering older servers leave us for same-dated snapshots. */
  readonly observedAt: number;
}

export const observedPullRequestSummaryAtom = Atom.family((key: string) =>
  Atom.make<ObservedPullRequestSummary | null>(null).pipe(
    Atom.setIdleTTL(5 * 60_000),
    Atom.withLabel(`web-pull-requests:observed-summary:${key}`),
  ),
);

/**
 * Positive when `incoming` is the newer snapshot. Merged is final. Then the host's own update
 * time, then the server's read-start time, which survives its caches; a snapshot without one
 * never beats a stamped read. Zero when neither side carries a read time.
 */
function compareSummaries(current: PullRequestSummary, incoming: PullRequestSummary): number {
  const merged = Number(incoming.state === "merged") - Number(current.state === "merged");
  if (merged !== 0) return merged;
  const updated = Date.parse(incoming.updatedAt) - Date.parse(current.updatedAt);
  if (updated !== 0) return updated;
  if (current.observedAt === undefined && incoming.observedAt === undefined) return 0;
  return (incoming.observedAt ?? -Infinity) - (current.observedAt ?? -Infinity);
}

export function newestPullRequestSummary(
  current: PullRequestSummary | null,
  observed: PullRequestSummary | null,
): PullRequestSummary | null {
  if (current === null) return observed;
  if (observed === null) return current;
  return compareSummaries(current, observed) >= 0 ? observed : current;
}

/** Reuse list status without treating its deferred line-count placeholders as real stats. */
export function pullRequestListEntryToSummary(entry: PullRequestListEntry): PullRequestSummary {
  return {
    provider: entry.provider,
    projectId: entry.projectId,
    repository: entry.repository,
    number: entry.number,
    title: entry.title,
    url: entry.url,
    state: entry.state,
    isDraft: entry.isDraft,
    headBranch: entry.headBranch,
    baseBranch: entry.baseBranch,
    updatedAt: entry.updatedAt,
    ...(entry.observedAt === undefined ? {} : { observedAt: entry.observedAt }),
    author: entry.author,
    ...(entry.reviewDecision === undefined ? {} : { reviewDecision: entry.reviewDecision }),
    ...(entry.checksState === undefined ? {} : { checksState: entry.checksState }),
    mergeability: entry.mergeability,
  };
}

// A project has one remote, so its id already pins the host. Leaving the host out lets a list
// row, a hostless legacy reference and a URL-derived thread reference share one entry.
export function pullRequestSummaryKey(
  environmentId: EnvironmentId,
  reference: PullRequestRef,
): string {
  return JSON.stringify([
    environmentId,
    reference.projectId,
    reference.repository.toLowerCase(),
    reference.number,
  ]);
}

/** The observation to hold after `incoming` arrives. Returns `current` itself on a tie. */
export function newestPullRequestObservation(
  current: ObservedPullRequestSummary | null,
  incoming: ObservedPullRequestSummary | null,
): ObservedPullRequestSummary | null {
  if (current === null) return incoming;
  if (incoming === null) return current;
  let order = compareSummaries(current.summary, incoming.summary);
  // Client clocks only break ties between snapshots that both lack a server read time.
  if (
    order === 0 &&
    current.summary.observedAt === undefined &&
    incoming.summary.observedAt === undefined
  ) {
    order = incoming.observedAt - current.observedAt;
  }
  if (!(order > 0)) return current;
  // A sparse summary must not erase known status, or carry old detail stats into a new list read.
  return {
    ...incoming,
    summary: {
      ...incoming.summary,
      isDraft: incoming.summary.isDraft ?? current.summary.isDraft,
      mergeability: incoming.summary.mergeability ?? current.summary.mergeability,
      reviewDecision:
        incoming.summary.reviewDecision === undefined
          ? current.summary.reviewDecision
          : incoming.summary.reviewDecision,
      checksState:
        incoming.summary.checksState === undefined
          ? current.summary.checksState
          : incoming.summary.checksState,
    },
  };
}

export function observePullRequestSummary(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentId,
  reference: PullRequestRef,
  summary: PullRequestSummary,
  observedAt: number,
): void {
  const atom = observedPullRequestSummaryAtom(pullRequestSummaryKey(environmentId, reference));
  registry.modify(atom, (previous) => {
    const next = newestPullRequestObservation(previous, { summary, observedAt });
    return next === previous ? [false, previous] : [true, next];
  });
}
