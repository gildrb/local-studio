import type { PullRequestListInput, PullRequestListResult } from "@t3tools/contracts";
import {
  mergePullRequestLists,
  resolveProjectPullRequestScope,
  type MergedPullRequestList,
  type ProjectPullRequestScope,
} from "@t3tools/web/src/components/pullRequest/pullRequestList.logic.ts";
import {
  createMergedEnvironmentQueryAtoms,
  type EnvironmentQueryTarget,
  type MergedEnvironmentQueryAtoms,
} from "@t3tools/web/src/state/mergedEnvironmentQuery.ts";
import { Atom } from "effect/unstable/reactivity";

import type { ThreadInput } from "./feature.ts";
import type { CoreState } from "./state.ts";

export type MergedPullRequestListState = {
  readonly data: MergedPullRequestList | null;
  readonly error: string | null;
  readonly isPending: boolean;
};

export type CorePullRequestQueries = {
  readonly listQuery: MergedEnvironmentQueryAtoms<PullRequestListInput, PullRequestListResult>;
  readonly listAtom: (
    targets: ReadonlyArray<EnvironmentQueryTarget<PullRequestListInput>>,
  ) => Atom.Atom<MergedPullRequestListState>;
};

const queries = new WeakMap<CoreState, CorePullRequestQueries>();

export function corePullRequestQueries(state: CoreState): CorePullRequestQueries {
  const existing = queries.get(state);
  if (existing !== undefined) return existing;
  const listQuery = createMergedEnvironmentQueryAtoms<PullRequestListInput, PullRequestListResult>(
    "gpui-pull-requests:list",
    (target) => state.pullRequestEnvironment.list(target),
  );
  const listAtoms = new WeakMap<object, Atom.Atom<MergedPullRequestListState>>();
  const created: CorePullRequestQueries = {
    listQuery,
    listAtom: (targets) => {
      const merged = listQuery.atom(targets);
      const cached = listAtoms.get(merged);
      if (cached !== undefined) return cached;
      const atom = Atom.make((get): MergedPullRequestListState => {
        const view = get(merged);
        return {
          data: mergePullRequestLists(view.values),
          error: view.error,
          isPending: view.isPending,
        };
      });
      listAtoms.set(merged, atom);
      return atom;
    },
  };
  queries.set(state, created);
  return created;
}

export function threadPullRequestScope(input: ThreadInput): ProjectPullRequestScope {
  return resolveProjectPullRequestScope({
    supportsPullRequests: input.serverConfig?.environment.capabilities.pullRequests === true,
    project: input.project,
  });
}
