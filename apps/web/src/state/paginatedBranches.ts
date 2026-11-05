import type { VcsListRefsResult, VcsRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";

const DEFAULT_NEXT_PAGE_DISTANCE_PX = 96;

export function isPaginatedBranchesNextPagePending<E>(
  results: ReadonlyArray<AsyncResult.AsyncResult<VcsListRefsResult, E>>,
): boolean {
  const lastResult = results.at(-1);
  return (
    results.length > 1 &&
    lastResult?.waiting === true &&
    Option.isNone(AsyncResult.value(lastResult))
  );
}

export interface PaginatedBranchesState {
  readonly data: VcsListRefsResult | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly isFetchingNextPage: boolean;
}

export function mergePaginatedBranchPages<E>(
  results: ReadonlyArray<AsyncResult.AsyncResult<VcsListRefsResult, E>>,
): PaginatedBranchesState {
  const values = results.flatMap((result) => {
    const value = Option.getOrNull(AsyncResult.value(result));
    return value === null ? [] : [value];
  });
  const refs = new Map<string, VcsRef>();
  for (const value of values) {
    for (const ref of value.refs) {
      refs.set(ref.name, ref);
    }
  }
  const first = values[0] ?? null;
  const last = values.at(-1) ?? null;
  const data: VcsListRefsResult | null =
    first === null || last === null
      ? null
      : {
          refs: [...refs.values()],
          isRepo: first.isRepo,
          hasPrimaryRemote: first.hasPrimaryRemote,
          nextCursor: last.nextCursor,
          totalCount: Math.max(...values.map((value) => value.totalCount)),
        };
  const failed = results.find((result) => result._tag === "Failure");
  const error =
    failed?._tag === "Failure"
      ? (() => {
          const cause = Cause.squash(failed.cause);
          return cause instanceof Error && cause.message.trim().length > 0
            ? cause.message
            : "Failed to load refs.";
        })()
      : null;
  return {
    data,
    error,
    isPending: results.some((result) => result.waiting),
    isFetchingNextPage: isPaginatedBranchesNextPagePending(results),
  };
}

export function appendBranchPageCursor(
  cursors: ReadonlyArray<number | undefined>,
  nextCursor: number,
): ReadonlyArray<number | undefined> {
  return cursors.includes(nextCursor) ? cursors : [...cursors, nextCursor];
}

export function shouldLoadNextBranchPageAfterScroll({
  previousScrollTop,
  scrollTop,
  scrollHeight,
  clientHeight,
  distanceThreshold = DEFAULT_NEXT_PAGE_DISTANCE_PX,
}: {
  previousScrollTop: number | null;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  distanceThreshold?: number;
}): boolean {
  if (previousScrollTop === null || scrollTop <= previousScrollTop) {
    return false;
  }

  return scrollHeight - scrollTop - clientHeight <= distanceThreshold;
}
