import { useAtomValue } from "@effect/atom-react";
import {
  createLinkedPullRequestSummaryAtomFamily,
  createPullRequestEnvironmentAtoms,
  createPullRequestStackAtomFamily,
} from "@t3tools/client-runtime/state/pull-requests";
import type {
  EnvironmentId,
  PullRequestListInput,
  PullRequestListStatsInput,
  PullRequestRef,
  PullRequestSummary,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useLayoutEffect, useMemo } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  mergePullRequestLists,
  type EnvironmentPullRequestStat,
  type MergedPullRequestList,
} from "../components/pullRequest/pullRequestList.logic";
import {
  createMergedEnvironmentQueryAtoms,
  type EnvironmentQueryTarget,
} from "./mergedEnvironmentQuery";
import {
  newestPullRequestObservation,
  observedPullRequestSummaryAtom,
  observePullRequestSummary,
  pullRequestListEntryToSummary,
  pullRequestSummaryKey,
} from "./pullRequestSummaries";

export const pullRequestEnvironment = createPullRequestEnvironmentAtoms(connectionAtomRuntime);
export const linkedPullRequestDetailAtom = createLinkedPullRequestSummaryAtomFamily(
  connectionAtomRuntime,
  pullRequestEnvironment.refreshes,
);

export function useSharedPullRequestSummary(
  environmentId: EnvironmentId | null,
  reference: PullRequestRef | null,
  current: PullRequestSummary | null,
  observedAt: number | null = null,
): PullRequestSummary | null {
  const key =
    environmentId === null || reference === null
      ? "none"
      : pullRequestSummaryKey(environmentId, reference);
  const atom = observedPullRequestSummaryAtom(key);
  const observed = useAtomValue(atom);
  useLayoutEffect(() => {
    if (environmentId === null || reference === null || current === null || observedAt === null)
      return;
    observePullRequestSummary(appAtomRegistry, environmentId, reference, current, observedAt);
  }, [current, environmentId, reference, observedAt]);
  return (
    newestPullRequestObservation(
      observed,
      current === null || observedAt === null ? null : { summary: current, observedAt },
    )?.summary ?? current
  );
}
export const pullRequestStackAtom = createPullRequestStackAtomFamily(
  connectionAtomRuntime,
  pullRequestEnvironment.refreshes,
);

function createMergedEnvironmentQuery<Input, A>(
  label: string,
  atomFor: (
    target: EnvironmentQueryTarget<Input>,
  ) => Atom.Atom<AsyncResult.AsyncResult<A, unknown>>,
) {
  const atoms = createMergedEnvironmentQueryAtoms(label, atomFor);
  return function useMergedQuery(targets: ReadonlyArray<EnvironmentQueryTarget<Input>>) {
    const key = JSON.stringify(targets);
    const view = useAtomValue(atoms.atom(targets));
    const refresh = useCallback(
      (override?: ReadonlyArray<EnvironmentQueryTarget<Input>>) => {
        const refreshTargets =
          override ?? (JSON.parse(key) as ReadonlyArray<EnvironmentQueryTarget<Input>>);
        for (const atom of new Set(refreshTargets.map(atomFor))) {
          appAtomRegistry.refresh(atom);
        }
      },
      [key],
    );
    return { ...view, refresh };
  };
}

const usePullRequestListsQuery = createMergedEnvironmentQuery(
  "web-pull-requests:list",
  pullRequestEnvironment.list,
);

const usePullRequestStatsQuery = createMergedEnvironmentQuery(
  "web-pull-requests:list-stats",
  pullRequestEnvironment.listStats,
);

const usePullRequestTurnRefreshQuery = createMergedEnvironmentQuery(
  "web-pull-requests:turn-refreshes",
  ({ environmentId }: EnvironmentQueryTarget<Readonly<Record<string, never>>>) =>
    pullRequestEnvironment.refreshes({ environmentId, input: {} }),
);

export function usePullRequestTurnRefreshes(
  environmentIds: ReadonlyArray<EnvironmentId>,
): ReadonlyArray<readonly [EnvironmentId, number]> {
  return usePullRequestTurnRefreshQuery(
    environmentIds.map((environmentId) => ({ environmentId, input: {} })),
  ).values;
}

export function usePullRequestTurnRefresh(environmentId: EnvironmentId): number | null {
  const result = useAtomValue(pullRequestEnvironment.refreshes({ environmentId, input: {} }));
  return Option.getOrNull(AsyncResult.value(result));
}

export interface MergedPullRequestListView {
  readonly data: MergedPullRequestList | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: (targets?: ReadonlyArray<EnvironmentQueryTarget<PullRequestListInput>>) => void;
}

/** One listing per environment, merged into the single list the page renders. */
export function usePullRequestList(
  targets: ReadonlyArray<EnvironmentQueryTarget<PullRequestListInput>>,
): MergedPullRequestListView {
  const query = usePullRequestListsQuery(targets);
  useLayoutEffect(() => {
    for (const [environmentId, answer, observedAt] of query.observations) {
      for (const entry of answer.entries) {
        observePullRequestSummary(
          appAtomRegistry,
          environmentId,
          {
            projectId: entry.projectId,
            host: entry.host,
            repository: entry.repository,
            number: entry.number,
          },
          pullRequestListEntryToSummary(entry),
          observedAt,
        );
      }
    }
  }, [query.observations]);
  const data = useMemo(() => mergePullRequestLists(query.values), [query.values]);
  return { data, error: query.error, isPending: query.isPending, refresh: query.refresh };
}

/** The line counts for the rows on screen, asked of each environment for its own rows. */
export function usePullRequestListStats(
  targets: ReadonlyArray<EnvironmentQueryTarget<PullRequestListStatsInput>>,
): {
  readonly stats: ReadonlyArray<EnvironmentPullRequestStat> | null;
  readonly isPending: boolean;
  readonly refresh: (
    targets?: ReadonlyArray<EnvironmentQueryTarget<PullRequestListStatsInput>>,
  ) => void;
} {
  const query = usePullRequestStatsQuery(targets);
  const stats = useMemo(
    () =>
      query.values.length === 0
        ? null
        : query.values.flatMap(([environmentId, result]) =>
            result.stats.map((stat) => ({ ...stat, environmentId })),
          ),
    [query.values],
  );
  return { stats, isPending: query.isPending, refresh: query.refresh };
}
