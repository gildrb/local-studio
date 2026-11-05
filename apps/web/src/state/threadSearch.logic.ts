import type { EnvironmentThreadSearchMatch } from "@t3tools/client-runtime/state/thread-search";
import type { EnvironmentId } from "@t3tools/contracts";

export const THREAD_SEARCH_DEBOUNCE_MS = 200;
export const EMPTY_THREAD_SEARCH_MATCHES: ReadonlyArray<EnvironmentThreadSearchMatch> =
  Object.freeze([]);

export type ThreadSearchRequest = {
  readonly canSearch: boolean;
  readonly isDebouncing: boolean;
  readonly settledQuery: string | null;
};

export type ThreadSearchState = {
  readonly matches: ReadonlyArray<EnvironmentThreadSearchMatch>;
  readonly isPending: boolean;
};

export function resolveThreadSearchRequest(input: {
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
  readonly normalizedQuery: string;
  readonly debouncedQuery: string;
}): ThreadSearchRequest {
  const canSearch = input.environmentIds.length > 0 && input.normalizedQuery.length >= 2;
  return {
    canSearch,
    isDebouncing: canSearch && input.normalizedQuery !== input.debouncedQuery,
    settledQuery:
      canSearch && input.normalizedQuery === input.debouncedQuery ? input.debouncedQuery : null,
  };
}

export function resolveThreadSearchState(
  request: ThreadSearchRequest,
  result: {
    readonly matches: ReadonlyArray<EnvironmentThreadSearchMatch>;
    readonly isLoading: boolean;
  },
): ThreadSearchState {
  return {
    matches: request.isDebouncing ? EMPTY_THREAD_SEARCH_MATCHES : result.matches,
    isPending: request.canSearch && (request.isDebouncing || result.isLoading),
  };
}
